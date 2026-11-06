package httpapi

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"waypoint/internal/config"
)

type Mail struct{ To, Subject, Body string }
type Mailer interface {
	Send(context.Context, Mail) error
}
type LogMailer struct{}

func (LogMailer) Send(_ context.Context, m Mail) error {
	slog.Info("Development email", "to", m.To, "subject", m.Subject, "body", m.Body)
	return nil
}

type SMTPMailer struct{ Config config.Config }

func (s SMTPMailer) Send(ctx context.Context, m Mail) error {
	c := s.Config
	from, err := mail.ParseAddress(c.SMTPFrom)
	if err != nil {
		return err
	}
	to, err := mail.ParseAddress(m.To)
	if err != nil {
		return err
	}
	address := net.JoinHostPort(c.SMTPHost, fmt.Sprint(c.SMTPPort))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	deadline := time.Now().Add(15 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return err
	}
	tlsConfig := &tls.Config{ServerName: c.SMTPHost, MinVersion: tls.VersionTLS12}
	if c.SMTPTLSMode == "implicit" {
		secured := tls.Client(conn, tlsConfig)
		if err := secured.HandshakeContext(ctx); err != nil {
			return err
		}
		conn = secured
	}
	client, err := smtp.NewClient(conn, c.SMTPHost)
	if err != nil {
		return err
	}
	defer client.Close()
	if c.SMTPTLSMode == "starttls" {
		if err := client.StartTLS(tlsConfig); err != nil {
			return err
		}
	}
	if c.SMTPUser != "" {
		if err := client.Auth(smtp.PlainAuth("", c.SMTPUser, c.SMTPPassword, c.SMTPHost)); err != nil {
			return err
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return err
	}
	if err := client.Rcpt(to.Address); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	body := "From: " + from.String() + "\r\nTo: " + to.String() + "\r\nSubject: " + mime.QEncoding.Encode("utf-8", m.Subject) + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + strings.ReplaceAll(m.Body, "\n", "\r\n")
	if _, err := writer.Write([]byte(body)); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

type mailQueue struct {
	jobs   chan Mail
	done   chan struct{}
	mailer Mailer
}

func newMailQueue(m Mailer) *mailQueue {
	q := &mailQueue{jobs: make(chan Mail, 64), done: make(chan struct{}), mailer: m}
	go func() {
		defer close(q.done)
		for job := range q.jobs {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			err := q.mailer.Send(ctx, job)
			cancel()
			if err != nil {
				slog.Error("Send email failed", "error", err)
			}
		}
	}()
	return q
}
func (q *mailQueue) enqueue(m Mail) {
	select {
	case q.jobs <- m:
	default:
		slog.Error("Email queue full", "to", m.To)
	}
}
func (q *mailQueue) close() { close(q.jobs); <-q.done }
