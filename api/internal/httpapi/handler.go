package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) http.Handler {
	return HandlerFromMux(NewStrictHandler(&Server{pool: pool}, nil), chi.NewRouter())
}

func (s *Server) Healthz(context.Context, HealthzRequestObject) (HealthzResponseObject, error) {
	return Healthz200JSONResponse{Status: "ok"}, nil
}

func (s *Server) Readyz(ctx context.Context, _ ReadyzRequestObject) (ReadyzResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := s.pool.Ping(ctx); err != nil {
		return Readyz503JSONResponse{Status: "unavailable"}, nil
	}
	return Readyz200JSONResponse{Status: "ok"}, nil
}
