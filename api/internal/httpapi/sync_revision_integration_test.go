package httpapi

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestVersionRejectionRetryIntegration(t *testing.T) {
	f := syncFixture(t)
	for _, version := range []int{0, 2} {
		op := f.op(f.userA, uuid.NewString(), "create", map[string]any{"title": "版本重试", "date": "2026-12-01"}, nil)
		op.SchemaVersion = version
		before := f.pull(0, 500).LatestSeq
		for range 2 {
			f.expect(f.call("POST", "/api/trips/"+f.trip+"/ops", PushBody{Ops: []ClientOp{op}}, f.a, false, false), 426)
		}
		var n int
		if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM rejected_ops WHERE op_id=$1", op.OpId).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 || f.pull(0, 500).LatestSeq != before {
			t.Fatal("version rejection was persisted or consumed a sequence")
		}
		op.SchemaVersion = 1
		result := f.push(f.a, op)[0]
		if result.Status != Accepted || result.ServerSeq == nil || *result.ServerSeq != before+1 {
			t.Fatalf("same opId after upgrade: %+v", result)
		}
		if result = f.push(f.a, op)[0]; result.Status != Duplicate {
			t.Fatalf("accepted retry was not idempotent: %+v", result)
		}
	}
}

func TestSSESessionInvalidationIntegration(t *testing.T) {
	for _, reason := range []string{"logout_heartbeat", "change_password", "reset_password", "expired"} {
		t.Run(reason, func(t *testing.T) {
			f := syncFixture(t)
			server := httptest.NewServer(f.handler)
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/trips/"+f.trip+"/events", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+f.a)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				t.Fatalf("SSE status: %d", resp.StatusCode)
			}
			scanner := bufio.NewScanner(resp.Body)
			// 完整读完首个事件，后续不能再收到普通 seq 或心跳。
			for _, want := range []string{"event: seq", "data: {\"latestSeq\":4}", ""} {
				if !scanner.Scan() || scanner.Text() != want {
					t.Fatalf("initial SSE: %q, %v", scanner.Text(), scanner.Err())
				}
			}
			switch reason {
			case "logout_heartbeat":
				f.expect(f.call("POST", "/api/auth/logout", nil, f.a, false, false), 200)
			case "change_password":
				other := f.login("password123")
				f.expect(f.call("POST", "/api/auth/change-password", map[string]any{"oldPassword": "password123", "newPassword": "newpassword123"}, other, false, false), 200)
				f.expect(f.call("GET", "/api/me", nil, other, false, false), 200)
			case "reset_password":
				f.expect(f.call("POST", "/api/auth/forgot-password", map[string]any{"email": f.email}, "", false, true), 200)
				token := f.mailToken("/reset-password")
				f.expect(f.call("POST", "/api/auth/reset-password", map[string]any{"token": token, "newPassword": "newpassword123"}, "", false, true), 200)
			case "expired":
				f.exec("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", tokenHash(f.a))
			}
			if reason != "logout_heartbeat" {
				f.push(f.b, f.op(f.userB, uuid.NewString(), "create", map[string]any{"title": "触发会话检查", "date": "2026-12-01"}, nil))
			}
			if !scanner.Scan() || scanner.Text() != "event: unauthorized" {
				t.Fatalf("expected unauthorized, got %q: %v", scanner.Text(), scanner.Err())
			}
			for scanner.Scan() {
				if scanner.Text() != "" && scanner.Text() != "data: {}" {
					t.Fatalf("unexpected event after unauthorized: %q", scanner.Text())
				}
			}
			if err := scanner.Err(); err != nil {
				t.Fatalf("SSE should close normally: %v", err)
			}
		})
	}
}
