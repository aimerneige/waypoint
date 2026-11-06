package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                                              int
	DatabaseURL, PublicBaseURL, SigningKey, UploadDir string
	MaxUploadMB                                       int
	SMTPHost, SMTPUser, SMTPPassword, SMTPFrom        string
	SMTPPort                                          int
	CORSAllowedOrigins                                []string
}

func Load() (Config, error) { return load(os.Getenv) }

func load(get func(string) string) (Config, error) {
	c := Config{}
	for _, item := range []struct {
		name string
		dest *string
	}{
		{"DATABASE_URL", &c.DatabaseURL}, {"PUBLIC_BASE_URL", &c.PublicBaseURL},
		{"SIGNING_KEY", &c.SigningKey}, {"UPLOAD_DIR", &c.UploadDir},
		{"SMTP_HOST", &c.SMTPHost}, {"SMTP_USER", &c.SMTPUser},
		{"SMTP_PASSWORD", &c.SMTPPassword}, {"SMTP_FROM", &c.SMTPFrom},
	} {
		*item.dest = get(item.name)
		if strings.TrimSpace(*item.dest) == "" {
			return c, fmt.Errorf("%s is required", item.name)
		}
	}
	for _, item := range []struct {
		name          string
		fallback, max int
		dest          *int
	}{
		{"PORT", 8080, 65535, &c.Port}, {"MAX_UPLOAD_MB", 32, 1048576, &c.MaxUploadMB}, {"SMTP_PORT", 0, 65535, &c.SMTPPort},
	} {
		value := get(item.name)
		if value == "" && item.fallback != 0 {
			*item.dest = item.fallback
			continue
		}
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > item.max {
			return c, fmt.Errorf("%s must be an integer between 1 and %d", item.name, item.max)
		}
		*item.dest = n
	}
	u, err := url.Parse(c.PublicBaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return c, fmt.Errorf("PUBLIC_BASE_URL must be an absolute HTTP(S) URL")
	}
	for _, origin := range strings.Split(get("CORS_ALLOWED_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			c.CORSAllowedOrigins = append(c.CORSAllowedOrigins, origin)
		}
	}
	return c, nil
}
