package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"waypoint/internal/config"
	"waypoint/internal/httpapi"
	"waypoint/migrations"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	var err error
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		err = healthcheck()
	} else {
		err = run()
	}
	if err != nil {
		slog.Error("API failed", "error", err)
		os.Exit(1)
	}
}

func healthcheck() error {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/api/readyz")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("readiness returned %d", resp.StatusCode)
	}
	return nil
}

func run() error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(startup, c.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := migrations.Up(startup, pool); err != nil {
		return err
	}
	if err := os.MkdirAll(c.UploadDir, 0700); err != nil {
		return fmt.Errorf("create upload directory: %w", err)
	}
	handler, closeMailer := httpapi.New(pool, c, nil)
	defer closeMailer()
	server := &http.Server{Addr: ":" + strconv.Itoa(c.Port), Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	slog.Info("API listening", "port", c.Port)
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			return fmt.Errorf("shutdown: %w", err)
		}
	}
	return nil
}
