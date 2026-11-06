package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"waypoint/internal/db"
)

type requestKey struct{}
type requestState struct {
	w             http.ResponseWriter
	r             *http.Request
	user          db.User
	session       db.Session
	authenticated bool
	bearer        bool
	csrf          string
}

func state(ctx context.Context) *requestState { return ctx.Value(requestKey{}).(*requestState) }

type apiError struct {
	status        int
	code, message string
}

func (e *apiError) Error() string                 { return e.code }
func fail(status int, code, message string) error { return &apiError{status, code, message} }
func writeError(w http.ResponseWriter, err error) {
	var e *apiError
	if !errors.As(err, &e) {
		slog.Error("Request failed", "error", err)
		e = &apiError{500, "internal_error", "服务器暂时不可用"}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.status)
	if err := json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": e.code, "message": e.message}}); err != nil {
		slog.Error("Write error response failed", "error", err)
	}
}
func clientIP(r *http.Request, trusted []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	isTrusted := func(a netip.Addr) bool {
		for _, p := range trusted {
			if p.Contains(a.Unmap()) {
				return true
			}
		}
		return false
	}
	if !isTrusted(addr) {
		return addr.String()
	}
	chain := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(chain) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if err != nil {
			return addr.String()
		}
		addr = a
		if !isTrusted(a) {
			break
		}
	}
	return addr.String()
}
func (s *Server) cookie(name, value string, expires time.Time, httpOnly bool) *http.Cookie {
	return &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: httpOnly, Secure: s.config.CookieSecure, SameSite: http.SameSiteLaxMode, Expires: expires}
}
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st := &requestState{w: w, r: r}
		w.Header().Set("Cache-Control", "no-store")
		if c, err := r.Cookie("wp_csrf"); err == nil && len(c.Value) == 43 {
			st.csrf = c.Value
		} else {
			st.csrf = newToken()
			http.SetCookie(w, s.cookie("wp_csrf", st.csrf, time.Now().Add(30*24*time.Hour), false))
		}
		token := ""
		if header := r.Header.Get("Authorization"); header != "" {
			parts := strings.Fields(header)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				writeError(w, fail(401, "unauthorized", "请重新登录"))
				return
			}
			token = parts[1]
			st.bearer = true
		} else if c, err := r.Cookie("wp_session"); err == nil {
			token = c.Value
		}
		if token != "" {
			session, err := s.queries.SessionByHash(r.Context(), tokenHash(token))
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				writeError(w, err)
				return
			}
			if err == nil {
				user, err := s.queries.UserByID(r.Context(), session.UserID)
				if err != nil {
					writeError(w, err)
					return
				}
				if time.Since(session.LastSeenAt.Time) > 24*time.Hour {
					renewed, err := s.queries.RenewSession(r.Context(), session.ID)
					if err != nil && !errors.Is(err, pgx.ErrNoRows) {
						writeError(w, err)
						return
					}
					if err == nil {
						session = renewed
					}
					if !st.bearer {
						http.SetCookie(w, s.cookie("wp_session", token, session.ExpiresAt.Time, true))
					}
				}
				st.user, st.session, st.authenticated = user, session, true
			}
			if st.bearer && !st.authenticated {
				writeError(w, fail(401, "unauthorized", "请重新登录"))
				return
			}
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" && !(st.bearer && st.authenticated) {
			c, err := r.Cookie("wp_csrf")
			if err != nil || c.Value == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
				writeError(w, fail(403, "csrf_invalid", "请求校验失败，请刷新后重试"))
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestKey{}, st)))
	})
}
func requireLogin(next StrictHandlerFunc, operation string) StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		switch operation {
		case "Logout", "ResendVerification", "ChangePassword", "GetMe", "UpdateMe":
			if !state(ctx).authenticated {
				return nil, fail(401, "unauthorized", "请先登录")
			}
		}
		return next(ctx, w, r, request)
	}
}
