package config

import (
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AuthRateLimitIP, AuthRateLimitAccount             int
	Port                                              int
	DatabaseURL, PublicBaseURL, SigningKey, UploadDir string
	MaxUploadMB                                       int
	SMTPHost, SMTPUser, SMTPPassword, SMTPFrom        string
	SMTPPort                                          int
	CORSAllowedOrigins                                []string
	CookieSecure                                      bool
	TrustedProxies                                    []netip.Prefix
	SMTPTLSMode                                       string
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
		{"AUTH_RATE_LIMIT_IP_PER_MINUTE", 60, 1000000, &c.AuthRateLimitIP}, {"AUTH_RATE_LIMIT_ACCOUNT_PER_MINUTE", 20, 1000000, &c.AuthRateLimitAccount},
		{"PORT", 8080, 65535, &c.Port}, {"MAX_UPLOAD_MB", 32, 1048576, &c.MaxUploadMB}, {"SMTP_PORT", 587, 65535, &c.SMTPPort},
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
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return c, fmt.Errorf("PUBLIC_BASE_URL must be an absolute HTTP(S) URL")
	}
	c.SMTPHost, c.SMTPUser, c.SMTPPassword, c.SMTPFrom = get("SMTP_HOST"), get("SMTP_USER"), get("SMTP_PASSWORD"), get("SMTP_FROM")
	if c.SMTPHost != "" && c.SMTPFrom == "" {
		return c, fmt.Errorf("SMTP_FROM is required when SMTP_HOST is set")
	}
	c.SMTPTLSMode = get("SMTP_TLS_MODE")
	if c.SMTPTLSMode == "" {
		c.SMTPTLSMode = "starttls"
	}
	if c.SMTPTLSMode != "starttls" && c.SMTPTLSMode != "implicit" && c.SMTPTLSMode != "none" {
		return c, fmt.Errorf("SMTP_TLS_MODE must be starttls, implicit or none")
	}
	c.CookieSecure = true
	if v := get("COOKIE_SECURE"); v != "" {
		c.CookieSecure, err = strconv.ParseBool(v)
		if err != nil {
			return c, fmt.Errorf("COOKIE_SECURE must be a boolean")
		}
	}
	proxies := get("TRUSTED_PROXIES")
	if proxies == "" {
		proxies = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
	}
	for _, v := range strings.Split(proxies, ",") {
		p, err := netip.ParsePrefix(strings.TrimSpace(v))
		if err != nil {
			return c, fmt.Errorf("TRUSTED_PROXIES contains invalid CIDR: %s", v)
		}
		c.TrustedProxies = append(c.TrustedProxies, p)
	}
	for _, origin := range strings.Split(get("CORS_ALLOWED_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			c.CORSAllowedOrigins = append(c.CORSAllowedOrigins, origin)
		}
	}
	return c, nil
}
