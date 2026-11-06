package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	values := map[string]string{"DATABASE_URL": "postgres://db/waypoint", "PUBLIC_BASE_URL": "http://127.0.0.1", "SIGNING_KEY": "test", "UPLOAD_DIR": "/tmp/uploads", "SMTP_HOST": "mail", "SMTP_PORT": "1025", "SMTP_USER": "user", "SMTP_PASSWORD": "password", "SMTP_FROM": "waypoint"}
	get := func(key string) string { return values[key] }
	c, err := load(get)
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 8080 || c.MaxUploadMB != 32 || len(c.CORSAllowedOrigins) != 0 {
		t.Fatalf("unexpected defaults: %+v", c)
	}
	if !c.CookieSecure || c.SMTPTLSMode != "starttls" || len(c.TrustedProxies) == 0 {
		t.Fatalf("unexpected security defaults: %+v", c)
	}
	for _, key := range []string{"DATABASE_URL", "PUBLIC_BASE_URL", "SIGNING_KEY", "UPLOAD_DIR", "SMTP_FROM"} {
		t.Run(key, func(t *testing.T) {
			old := values[key]
			delete(values, key)
			defer func() { values[key] = old }()
			if _, err := load(get); err == nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("expected %s error, got %v", key, err)
			}
		})
	}
	for _, key := range []string{"PORT", "MAX_UPLOAD_MB", "SMTP_PORT"} {
		for _, value := range []string{"bad", "0", "-1", "9999999999"} {
			old := values[key]
			values[key] = value
			if _, err := load(get); err == nil {
				t.Errorf("accepted %s=%s", key, value)
			}
			values[key] = old
		}
	}
	values["PUBLIC_BASE_URL"] = "/relative"
	if _, err := load(get); err == nil {
		t.Fatal("accepted relative base URL")
	}
}

func TestAuthConfig(t *testing.T) {
	base := map[string]string{"DATABASE_URL": "postgres://db/test", "PUBLIC_BASE_URL": "https://example.com", "SIGNING_KEY": "test", "UPLOAD_DIR": "/tmp/uploads"}
	get := func(k string) string { return base[k] }
	c, err := load(get)
	if err != nil || c.SMTPHost != "" || c.SMTPPort != 587 {
		t.Fatalf("log mail configuration: %+v %v", c, err)
	}
	base["COOKIE_SECURE"] = "false"
	c, err = load(get)
	if err != nil || c.CookieSecure {
		t.Fatal("COOKIE_SECURE=false ignored")
	}
	for _, tc := range []struct{ key, value string }{{"COOKIE_SECURE", "invalid"}, {"TRUSTED_PROXIES", "127.0.0.1"}, {"SMTP_TLS_MODE", "invalid"}, {"PUBLIC_BASE_URL", "https://example.com/?evil=query"}, {"PUBLIC_BASE_URL", "https://user:password@example.com"}} {
		old := base[tc.key]
		base[tc.key] = tc.value
		if _, err := load(get); err == nil {
			t.Errorf("accepted %s=%s", tc.key, tc.value)
		}
		base[tc.key] = old
	}
}
