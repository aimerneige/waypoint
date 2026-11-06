package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpgradeChain(t *testing.T) {
	chain := map[int]OpUpgrade{0: func(op ClientOp) (ClientOp, error) {
		op.Fields = map[string]any{"title": op.Fields["name"]}
		return op, nil
	}}
	op, err := upgrade(ClientOp{Fields: map[string]any{"name": "旧版本"}}, 0, chain)
	if err != nil || op.SchemaVersion != 1 || op.Fields["title"] != "旧版本" {
		t.Fatalf("upgrade: %+v %v", op, err)
	}
	if _, err = upgrade(ClientOp{}, 0, map[int]OpUpgrade{}); err == nil {
		t.Fatal("missing upgrade accepted")
	}
}
func TestRouteBodyLimits(t *testing.T) {
	s := &Server{}
	handler := s.middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	for _, tc := range []struct {
		path    string
		n, want int
	}{{"/api/auth/login", 16384, 204}, {"/api/auth/login", 16385, 413}, {"/api/trips/id/ops", 20000, 204}, {"/api/trips/id/ops", 2*1024*1024 + 1, 413}} {
		r := httptest.NewRequest("POST", tc.path, strings.NewReader(strings.Repeat("x", tc.n)))
		r.AddCookie(&http.Cookie{Name: "wp_csrf", Value: testCSRF})
		r.Header.Set("X-CSRF-Token", testCSRF)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s %d: %d %s", tc.path, tc.n, w.Code, w.Body)
		}
	}
}
