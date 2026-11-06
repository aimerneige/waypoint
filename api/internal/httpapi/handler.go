package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"waypoint/internal/config"
	"waypoint/internal/db"
)

type Server struct {
	pool                  *pgxpool.Pool
	queries               *db.Queries
	config                config.Config
	mail                  *mailQueue
	ipLimit, accountLimit *limiter
	hub                   *eventHub
}

func New(pool *pgxpool.Pool, c config.Config, m Mailer) (http.Handler, func()) {
	if m == nil {
		if c.SMTPHost == "" {
			m = LogMailer{}
		} else {
			m = SMTPMailer{Config: c}
		}
	}
	q := newMailQueue(m)
	s := &Server{pool: pool, queries: db.New(pool), config: c, mail: q, ipLimit: newLimiter(60, time.Minute), accountLimit: newLimiter(20, time.Minute), hub: newEventHub()}
	return newHandler(s), q.close
}
func newHandler(s *Server) http.Handler {
	strict := NewStrictHandlerWithOptions(s, []StrictMiddlewareFunc{requireLogin}, StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
			if isBodyTooLarge(err) {
				writeError(w, fail(413, "payload_too_large", "请求体过大"))
				return
			}
			writeError(w, fail(400, "invalid_request", "请求格式不正确"))
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) { writeError(w, err) },
	})
	router := chi.NewRouter()
	router.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeError(w, fail(404, "not_found", "接口不存在")) })
	router.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, fail(405, "method_not_allowed", "请求方法不支持"))
	})
	return s.middleware(HandlerWithOptions(strict, ChiServerOptions{BaseRouter: router, ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
		writeError(w, fail(400, "invalid_request", "请求参数不正确"))
	}}))
}

func (s *Server) Healthz(context.Context, HealthzRequestObject) (HealthzResponseObject, error) {
	return Healthz200JSONResponse{Status: "ok"}, nil
}

func (s *Server) Readyz(ctx context.Context, _ ReadyzRequestObject) (ReadyzResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := s.pool.Ping(ctx); err != nil {
		slog.Error("Readiness failed", "error", err)
		return nil, fail(503, "unavailable", "数据库暂时不可用")
	}
	return Readyz200JSONResponse{Status: "ok"}, nil
}
