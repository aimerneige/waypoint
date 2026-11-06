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
	for _, key := range []string{"DATABASE_URL", "PUBLIC_BASE_URL", "SIGNING_KEY", "UPLOAD_DIR", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"} {
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
