package httpapi

import (
	"github.com/google/uuid"
	"testing"
)

func TestM1EntityValidationIntegration(t *testing.T) {
	f := syncFixture(t)
	id := uuid.NewString()
	fields := map[string]any{"title": "夜航", "date": "2026-12-01", "startTime": "23:00", "endTime": "08:30", "endDate": "2026-12-02", "timezone": "Asia/Tokyo", "endTimezone": "Europe/Paris", "bookingInfo": "订单 123", "voucherIds": []any{uuid.NewString()}, "wishItemId": uuid.NewString(), "sortOrder": "a0"}
	if r := f.push(f.a, f.op(f.userA, id, "create", fields, nil))[0]; r.Status != Accepted {
		t.Fatalf("valid create: %+v", r)
	}
	invalid := []map[string]any{{"startTime": "24:00"}, {"endTime": "9:00"}, {"timezone": "Mars/Olympus"}, {"endTimezone": "Local"}, {"endDate": "2026-11-30"}, {"date": "2026-12-03"}, {"voucherIds": []any{"not-uuid"}}, {"wishItemId": "bad"}, {"sortOrder": "a-0"}, {"sortOrder": ""}}
	for _, fields := range invalid {
		if r := f.push(f.b, f.op(f.userB, id, "update", fields, nil))[0]; r.Status != Rejected || r.Error.Code != "invalid_op" {
			t.Fatalf("accepted invalid fields %v: %+v", fields, r)
		}
	}
	wish := f.op(f.userB, uuid.NewString(), "create", map[string]any{"title": "博物馆", "note": "预约", "place": "东京", "url": "https://example.com/path"}, nil)
	wish.Entity = "wish_item"
	if r := f.push(f.b, wish)[0]; r.Status != Accepted {
		t.Fatalf("wish: %+v", r)
	}
	for _, url := range []string{"javascript:alert(1)", "/relative", "ftp://example.com", "https:///missing-host"} {
		op := f.op(f.userA, wish.EntityId.String(), "update", map[string]any{"url": url}, nil)
		op.Entity = "wish_item"
		if r := f.push(f.a, op)[0]; r.Status != Rejected {
			t.Fatalf("accepted %s", url)
		}
	}
	for _, kind := range []string{"update", "delete", "restore"} {
		fields := map[string]any{}
		if kind == "update" {
			fields["note"] = nil
		}
		op := f.op(f.userA, wish.EntityId.String(), kind, fields, nil)
		op.Entity = "wish_item"
		if r := f.push(f.a, op)[0]; r.Status != Accepted {
			t.Fatalf("wish %s: %+v", kind, r)
		}
	}
	snap := f.snapshot()
	found := false
	for _, e := range snap.Entities {
		if e.EntityId.String() == id {
			found = true
			if e.Fields["endDate"] != "2026-12-02" || e.Fields["bookingInfo"] != "订单 123" {
				t.Fatalf("fields lost: %+v", e)
			}
		}
	}
	if !found {
		t.Fatal("missing itinerary snapshot")
	}
}
