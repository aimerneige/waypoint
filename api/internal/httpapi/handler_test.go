package httpapi

import (
	"context"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"waypoint/internal/db"
	"waypoint/migrations"
)

func TestPostgresReadiness(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for range 2 {
		if err := migrations.Up(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	value, err := db.New(pool).GetAppMeta(ctx, "schema")
	if err != nil || value != "1" {
		t.Fatalf("migration/query: value=%q err=%v", value, err)
	}
	for _, path := range []string{"/api/healthz", "/api/readyz"} {
		r := httptest.NewRecorder()
		New(pool).ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 200 || r.Body.String() != "{\"status\":\"ok\"}\n" {
			t.Fatalf("%s: %d %s", path, r.Code, r.Body)
		}
	}
	pool.Close()
	r := httptest.NewRecorder()
	New(pool).ServeHTTP(r, httptest.NewRequest("GET", "/api/readyz", nil))
	if r.Code != 503 {
		t.Fatalf("expected unavailable, got %d", r.Code)
	}
}
