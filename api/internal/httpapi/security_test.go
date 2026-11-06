package httpapi

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPassword(t *testing.T) {
	encoded := hashPassword("密码abcdefgh")
	if !strings.HasPrefix(encoded, "$argon2id$v=19$m=65536,t=3,p=2$") || !checkPassword("密码abcdefgh", encoded) || checkPassword("incorrect", encoded) {
		t.Fatal("PHC encoding/verification failed")
	}
	if encoded == hashPassword("密码abcdefgh") {
		t.Fatal("salt reused")
	}
	for _, v := range []string{"", "$argon2id$v=19$m=0,t=0,p=0$x$x", "$argon2id$v=18$m=65536,t=3,p=2$x$x", encoded + "$"} {
		if checkPassword("password", v) {
			t.Fatal("accepted invalid PHC")
		}
	}
}
func TestTokens(t *testing.T) {
	a, b := newToken(), newToken()
	decoded, err := base64.RawURLEncoding.DecodeString(a)
	if err != nil || len(decoded) != 32 || a == b || len(tokenHash(a)) != 32 || string(tokenHash(a)) == string(tokenHash(b)) {
		t.Fatal("token generation/hash failed")
	}
	if string(tokenHash(a)) != string(tokenHash(a)) {
		t.Fatal("hash not deterministic")
	}
}
func TestLimiter(t *testing.T) {
	l := newLimiter(2, time.Second)
	now := time.Now()
	for range 2 {
		if ok, _ := l.allow("a", now); !ok {
			t.Fatal("early rejection")
		}
	}
	if ok, retry := l.allow("a", now); ok || retry != 1 {
		t.Fatal("missing rate limit")
	}
	if ok, _ := l.allow("b", now); !ok {
		t.Fatal("keys not isolated")
	}
	if ok, _ := l.allow("a", now.Add(time.Second)); !ok {
		t.Fatal("not refilled")
	}
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() { l.allow("concurrent", now) })
	}
	wg.Wait()
}
func TestClientIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("172.16.0.0/12")}
	for _, tc := range []struct{ remote, forwarded, want string }{
		{"8.8.8.8:123", "1.2.3.4", "8.8.8.8"},
		{"127.0.0.1:123", "1.2.3.4", "1.2.3.4"},
		{"127.0.0.1:123", "9.9.9.9, 1.2.3.4, 172.18.0.3", "1.2.3.4"},
		{"127.0.0.1:123", "bad", "127.0.0.1"},
		{"[::ffff:127.0.0.1]:123", "1.2.3.4", "1.2.3.4"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = tc.remote
		r.Header.Set("X-Forwarded-For", tc.forwarded)
		if got := clientIP(r, trusted); got != tc.want {
			t.Errorf("%+v: %s", tc, got)
		}
	}
}
func TestCSRF(t *testing.T) {
	s := &Server{}
	handler := s.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if state(r.Context()).csrf == "" {
			t.Fatal("missing csrf state")
		}
		w.WriteHeader(204)
	}))
	for _, tc := range []struct {
		method, cookie, header string
		want                   int
	}{
		{"GET", "", "", 204}, {"HEAD", "", "", 204}, {"POST", "", "", 403},
		{"POST", "csrf", "", 403}, {"POST", "csrf", "wrong", 403}, {"POST", "csrf", "csrf", 204},
		{"PATCH", "csrf", "csrf", 204}, {"DELETE", "csrf", "", 403},
	} {
		r := httptest.NewRequest(tc.method, "/", nil)
		if tc.cookie != "" {
			r.AddCookie(&http.Cookie{Name: "wp_csrf", Value: tc.cookie})
		}
		r.Header.Set("X-CSRF-Token", tc.header)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("%+v: %d", tc, w.Code)
		}
		if tc.cookie == "" && len(w.Result().Cookies()) == 0 {
			t.Fatal("missing issued csrf cookie")
		}
	}
}

type captureMailer struct{ messages chan Mail }

func (m *captureMailer) Send(_ context.Context, msg Mail) error { m.messages <- msg; return nil }
