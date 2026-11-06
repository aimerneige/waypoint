package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"waypoint/internal/config"
	"waypoint/migrations"
)

const testCSRF = "0123456789012345678901234567890123456789012"

type authTest struct {
	t       *testing.T
	pool    *pgxpool.Pool
	handler http.Handler
	mail    *captureMailer
	email   string
}

func authFixture(t *testing.T) *authTest {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(context.Background(), pool); err != nil {
		pool.Close()
		t.Fatal(err)
	}
	mailer := &captureMailer{messages: make(chan Mail, 64)}
	handler, closeMailer := New(pool, config.Config{CookieSecure: true, PublicBaseURL: "https://public.example/waypoint"}, mailer)
	f := &authTest{t: t, pool: pool, handler: handler, mail: mailer, email: uuid.NewString() + "@example.com"}
	t.Cleanup(func() {
		closeMailer()
		for _, query := range []string{"DELETE FROM users WHERE email=$1", "DELETE FROM login_failures WHERE email=$1"} {
			if _, err := pool.Exec(context.Background(), query, f.email); err != nil {
				t.Error(err)
			}
		}
		pool.Close()
	})
	return f
}
func (f *authTest) call(method, path string, body any, token string, cookie, csrf bool) *httptest.ResponseRecorder {
	f.t.Helper()
	var data string
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			f.t.Fatal(err)
		}
		data = string(b)
	}
	r := httptest.NewRequest(method, "http://evil.example"+path, strings.NewReader(data))
	r.Host = "evil.example"
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: "wp_csrf", Value: testCSRF})
	if csrf {
		r.Header.Set("X-CSRF-Token", testCSRF)
	}
	if token != "" {
		if cookie {
			r.AddCookie(&http.Cookie{Name: "wp_session", Value: token})
		} else {
			r.Header.Set("Authorization", "Bearer "+token)
		}
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}
func (f *authTest) expect(w *httptest.ResponseRecorder, status int) map[string]any {
	f.t.Helper()
	if w.Code != status {
		f.t.Fatalf("want %d got %d: %s", status, w.Code, w.Body)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		f.t.Fatal(err)
	}
	return body
}
func (f *authTest) register(cookie bool) string {
	f.t.Helper()
	body := map[string]any{"email": strings.ToUpper(f.email), "password": "password123", "nickname": "测试用户"}
	if !cookie {
		body["tokenDelivery"] = "bearer"
	}
	w := f.call("POST", "/api/auth/register", body, "", false, true)
	result := f.expect(w, 200)
	if result["user"].(map[string]any)["email"] != f.email {
		f.t.Fatal("email not normalized")
	}
	if !cookie {
		for _, c := range w.Result().Cookies() {
			if c.Name == "wp_session" {
				f.t.Fatal("bearer set session cookie")
			}
		}
		return result["token"].(string)
	}
	if _, ok := result["token"]; ok {
		f.t.Fatal("cookie response leaked token")
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == "wp_session" {
			if !c.Secure || !c.HttpOnly || c.Path != "/" || c.SameSite != http.SameSiteLaxMode {
				f.t.Fatal("unsafe session cookie")
			}
			return c.Value
		}
	}
	f.t.Fatal("missing session cookie")
	return ""
}
func (f *authTest) login(password string) string {
	f.t.Helper()
	result := f.expect(f.call("POST", "/api/auth/login", map[string]any{"email": f.email, "password": password, "tokenDelivery": "bearer"}, "", false, true), 200)
	return result["token"].(string)
}
func (f *authTest) mailToken(path string) string {
	f.t.Helper()
	select {
	case m := <-f.mail.messages:
		for _, field := range strings.Fields(m.Body) {
			if strings.HasPrefix(field, "https://") {
				if !strings.HasPrefix(field, "https://public.example/waypoint"+path+"?token=") || strings.Contains(field, "evil.example") {
					f.t.Fatalf("unsafe mail link: %s", field)
				}
				u, err := url.Parse(field)
				if err != nil {
					f.t.Fatal(err)
				}
				return u.Query().Get("token")
			}
		}
		f.t.Fatal("mail missing link")
	case <-time.After(3 * time.Second):
		f.t.Fatal("mail not delivered")
	}
	return ""
}
func (f *authTest) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(), query, args...); err != nil {
		f.t.Fatal(err)
	}
}

func TestAuthLifecycleIntegration(t *testing.T) {
	f := authFixture(t)
	csrf := f.call("GET", "/api/auth/csrf", nil, "", false, false)
	if f.expect(csrf, 200)["token"] != testCSRF {
		t.Fatal("csrf mismatch")
	}
	cookie := f.register(true)
	f.mailToken("/verify-email")
	f.expect(f.call("GET", "/api/me", nil, cookie, true, false), 200)
	f.expect(f.call("PATCH", "/api/me", map[string]any{"nickname": "新昵称"}, cookie, true, false), 403)
	f.expect(f.call("POST", "/api/auth/login", map[string]any{"email": f.email, "password": "password123"}, "", false, false), 403)
	f.expect(f.call("PATCH", "/api/me", map[string]any{"nickname": "新昵称", "avatarUrl": "https://example.com/avatar.png"}, cookie, true, true), 200)
	profile := f.expect(f.call("PATCH", "/api/me", map[string]any{"nickname": "仅改昵称"}, cookie, true, true), 200)
	if profile["avatarUrl"] != "https://example.com/avatar.png" {
		t.Fatal("omitted avatar changed")
	}
	profile = f.expect(f.call("PATCH", "/api/me", map[string]any{"avatarUrl": nil}, cookie, true, true), 200)
	if profile["avatarUrl"] != nil {
		t.Fatal("null avatar did not clear")
	}
	bearer := f.login("password123")
	f.expect(f.call("PATCH", "/api/me", map[string]any{"nickname": "Bearer昵称"}, bearer, false, false), 200)
	f.expect(f.call("POST", "/api/auth/logout", nil, bearer, false, false), 200)
	f.expect(f.call("GET", "/api/me", nil, bearer, false, false), 401)
	w := f.call("POST", "/api/auth/logout", nil, cookie, true, true)
	f.expect(w, 200)
	cleared := false
	for _, c := range w.Result().Cookies() {
		if c.Name == "wp_session" && c.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatal("cookie not cleared")
	}
	f.expect(f.call("GET", "/api/me", nil, cookie, true, false), 401)
}
func TestSessionRenewalIntegration(t *testing.T) {
	f := authFixture(t)
	token := f.register(true)
	f.exec("UPDATE sessions SET last_seen_at=now()-interval '25 hours',expires_at=now()+interval '1 day' WHERE token_hash=$1", tokenHash(token))
	w := f.call("GET", "/api/me", nil, token, true, false)
	f.expect(w, 200)
	var expires, last time.Time
	if err := f.pool.QueryRow(context.Background(), "SELECT expires_at,last_seen_at FROM sessions WHERE token_hash=$1", tokenHash(token)).Scan(&expires, &last); err != nil {
		t.Fatal(err)
	}
	if time.Until(expires) < 29*24*time.Hour || time.Since(last) > time.Minute {
		t.Fatal("session not renewed")
	}
	found := false
	for _, c := range w.Result().Cookies() {
		if c.Name == "wp_session" && c.Expires.After(time.Now().Add(29*24*time.Hour)) {
			found = true
		}
	}
	if !found {
		t.Fatal("cookie not renewed")
	}
	f.expect(f.call("GET", "/api/me", nil, token, true, false), 200)
	var again time.Time
	if err := f.pool.QueryRow(context.Background(), "SELECT last_seen_at FROM sessions WHERE token_hash=$1", tokenHash(token)).Scan(&again); err != nil {
		t.Fatal(err)
	}
	if !again.Equal(last) {
		t.Fatal("renewed before 24h")
	}
	f.exec("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", tokenHash(token))
	f.expect(f.call("GET", "/api/me", nil, token, true, false), 401)
}
func TestEmailVerificationIntegration(t *testing.T) {
	f := authFixture(t)
	token := f.register(false)
	old := f.mailToken("/verify-email")
	f.expect(f.call("POST", "/api/auth/resend-verification", nil, token, false, false), 200)
	expired := f.mailToken("/verify-email")
	f.expect(f.call("POST", "/api/auth/verify-email", map[string]any{"token": old}, "", false, true), 400)
	f.exec("UPDATE email_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", tokenHash(expired))
	f.expect(f.call("POST", "/api/auth/verify-email", map[string]any{"token": expired}, "", false, true), 400)
	f.expect(f.call("POST", "/api/auth/resend-verification", nil, token, false, false), 200)
	fresh := f.mailToken("/verify-email")
	f.expect(f.call("POST", "/api/auth/verify-email", map[string]any{"token": fresh}, "", false, true), 200)
	f.expect(f.call("POST", "/api/auth/verify-email", map[string]any{"token": fresh}, "", false, true), 400)
	me := f.expect(f.call("GET", "/api/me", nil, token, false, false), 200)
	if me["emailVerified"] != true {
		t.Fatal("not verified")
	}
	f.expect(f.call("POST", "/api/auth/resend-verification", nil, token, false, false), 200)
	select {
	case <-f.mail.messages:
		t.Fatal("verified user sent mail")
	case <-time.After(30 * time.Millisecond):
	}
}
func TestPasswordResetIntegration(t *testing.T) {
	f := authFixture(t)
	first := f.register(false)
	f.mailToken("/verify-email")
	second := f.login("password123")
	known := f.call("POST", "/api/auth/forgot-password", map[string]any{"email": f.email}, "", false, true)
	f.expect(known, 200)
	missingEmail := uuid.NewString() + "@example.com"
	missing := f.call("POST", "/api/auth/forgot-password", map[string]any{"email": missingEmail}, "", false, true)
	f.expect(missing, 200)
	if known.Body.String() != missing.Body.String() {
		t.Fatal("forgot-password exposes account existence")
	}
	reset := f.mailToken("/reset-password")
	f.exec("UPDATE email_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", tokenHash(reset))
	f.expect(f.call("POST", "/api/auth/reset-password", map[string]any{"token": reset, "newPassword": "newpassword123"}, "", false, true), 400)
	f.expect(f.call("POST", "/api/auth/forgot-password", map[string]any{"email": f.email}, "", false, true), 200)
	reset = f.mailToken("/reset-password")
	f.expect(f.call("POST", "/api/auth/reset-password", map[string]any{"token": reset, "newPassword": "newpassword123"}, "", false, true), 200)
	f.expect(f.call("POST", "/api/auth/reset-password", map[string]any{"token": reset, "newPassword": "anotherpassword"}, "", false, true), 400)
	for _, token := range []string{first, second} {
		f.expect(f.call("GET", "/api/me", nil, token, false, false), 401)
	}
	f.login("newpassword123")
}
func TestChangePasswordIntegration(t *testing.T) {
	f := authFixture(t)
	current := f.register(false)
	other := f.login("password123")
	f.expect(f.call("POST", "/api/auth/change-password", map[string]any{"oldPassword": "incorrect", "newPassword": "newpassword123"}, current, false, false), 400)
	f.expect(f.call("POST", "/api/auth/change-password", map[string]any{"oldPassword": "password123", "newPassword": "newpassword123"}, current, false, false), 200)
	f.expect(f.call("GET", "/api/me", nil, current, false, false), 200)
	f.expect(f.call("GET", "/api/me", nil, other, false, false), 401)
	f.login("newpassword123")
}
func TestAccountLockIntegration(t *testing.T) {
	f := authFixture(t)
	f.register(false)
	for i := 1; i <= 10; i++ {
		body := f.expect(f.call("POST", "/api/auth/login", map[string]any{"email": f.email, "password": "incorrect"}, "", false, true), 401)
		code := body["error"].(map[string]any)["code"]
		expected := "invalid_credentials"
		if i == 10 {
			expected = "account_locked"
		}
		if code != expected {
			t.Fatalf("failure %d: %v", i, body)
		}
	}
	body := f.expect(f.call("POST", "/api/auth/login", map[string]any{"email": f.email, "password": "password123"}, "", false, true), 401)
	if body["error"].(map[string]any)["code"] != "account_locked" {
		t.Fatal("lock bypassed with correct password")
	}
	f.exec("UPDATE login_failures SET locked_until=now()-interval '1 second' WHERE email=$1", f.email)
	f.expect(f.call("POST", "/api/auth/login", map[string]any{"email": f.email, "password": "incorrect"}, "", false, true), 401)
	var failures int
	if err := f.pool.QueryRow(context.Background(), "SELECT failures FROM login_failures WHERE email=$1", f.email).Scan(&failures); err != nil {
		t.Fatal(err)
	}
	if failures != 1 {
		t.Fatal("expired lock did not reset count")
	}
	f.login("password123")
}
func TestRateLimitIntegration(t *testing.T) {
	for _, dimension := range []string{"account", "ip"} {
		t.Run(dimension, func(t *testing.T) {
			f := authFixture(t)
			limit := 20
			if dimension == "ip" {
				limit = 60
			}
			for i := 0; i <= limit; i++ {
				email := f.email
				if dimension == "ip" {
					email = fmt.Sprintf("%d-%s", i, email)
				}
				w := f.call("POST", "/api/auth/forgot-password", map[string]any{"email": email}, "", false, true)
				if i < limit {
					f.expect(w, 200)
				} else {
					f.expect(w, 429)
					if w.Header().Get("Retry-After") == "" {
						t.Fatal("missing Retry-After")
					}
				}
			}
		})
	}
}

func TestTokenConsumptionConcurrentIntegration(t *testing.T) {
	f := authFixture(t)
	f.register(false)
	token := f.mailToken("/verify-email")
	results := make(chan int, 2)
	for range 2 {
		go func() {
			results <- f.call("POST", "/api/auth/verify-email", map[string]any{"token": token}, "", false, true).Code
		}()
	}
	first, second := <-results, <-results
	if !((first == 200 && second == 400) || (first == 400 && second == 200)) {
		t.Fatalf("one-time token consumed concurrently: %d %d", first, second)
	}
}

type failingMailer struct{}

func (failingMailer) Send(context.Context, Mail) error { return fmt.Errorf("test SMTP unavailable") }
func TestMailFailureIntegration(t *testing.T) {
	f := authFixture(t)
	handler, closeMailer := New(f.pool, config.Config{CookieSecure: true, PublicBaseURL: "https://public.example"}, failingMailer{})
	defer closeMailer()
	f.handler = handler
	token := f.register(false)
	f.expect(f.call("GET", "/api/me", nil, token, false, false), 200)
}
