package httpapi

import (
	"context"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"testing"
)

func TestM2LedgerIntegration(t *testing.T) {
	f := syncFixture(t)
	push := func(actor, token, entity, id, kind string, fields map[string]any, status OpResultStatus) OpResult {
		t.Helper()
		op := f.op(actor, id, kind, fields, nil)
		op.Entity = entity
		r := f.push(token, op)[0]
		if r.Status != status {
			t.Fatalf("%s %s %v: %+v", entity, kind, fields, r)
		}
		if status == Rejected && r.Error.Code != "invalid_op" {
			t.Fatalf("unexpected error: %+v", r)
		}
		return r
	}
	rates := push(f.userA, f.a, "trip_rates", f.trip, "update", map[string]any{"JPY": "0.048", "USD": "7.1"}, Accepted)
	if rates.ServerSeq == nil {
		t.Fatal("missing seq")
	}
	for _, fields := range []map[string]any{{"CNY": "1"}, {"jpy": "1"}, {"JPY": "0"}, {"JPY": 0.1}, {"JPY": "1.12345678901"}} {
		push(f.userA, f.a, "trip_rates", f.trip, "update", fields, Rejected)
	}
	for _, kind := range []string{"create", "delete", "restore"} {
		push(f.userA, f.a, "trip_rates", f.trip, kind, map[string]any{}, Rejected)
	}
	wrong := f.op(f.userA, uuid.NewString(), "update", map[string]any{}, nil)
	wrong.Entity = "trip_rates"
	if r := f.push(f.a, wrong)[0]; r.Status != Rejected || r.Error.Code != "entity_not_found" {
		t.Fatal(r)
	}
	push(f.userA, f.a, "trip_rates", f.trip, "update", map[string]any{"JPY": nil}, Accepted)
	exid := uuid.NewString()
	exchange := map[string]any{"ownerUserId": f.userA, "currency": "JPY", "cnyPaid": 500, "foreignReceived": 100, "date": "2026-12-01"}
	push(f.userA, f.a, "exchange", exid, "create", exchange, Accepted)
	for _, kind := range []string{"update", "delete", "restore"} {
		push(f.userB, f.b, "exchange", exid, kind, map[string]any{}, Rejected)
	}
	push(f.userB, f.b, "exchange", uuid.NewString(), "create", exchange, Rejected)
	for _, patch := range []map[string]any{{"currency": "CNY"}, {"cnyPaid": 0}, {"foreignReceived": 1.5}, {"date": "2026-02-30"}, {"ownerUserId": f.userB}, {"time": "24:00"}} {
		push(f.userA, f.a, "exchange", exid, "update", patch, Rejected)
	}
	for _, kind := range []string{"delete", "restore"} {
		push(f.userA, f.a, "exchange", exid, kind, map[string]any{}, Accepted)
	}
	expense := map[string]any{"title": "午餐", "date": "2026-12-01", "amount": 100, "currency": "JPY", "method": "cash", "payerUserId": f.userA, "rateSource": "wallet", "split": map[string]any{"mode": "equal", "members": []any{f.userB, f.userA}}}
	eid := uuid.NewString()
	push(f.userA, f.a, "expense", eid, "create", expense, Accepted)
	push(f.userB, f.b, "expense", uuid.NewString(), "create", expense, Rejected)
	for _, patch := range []map[string]any{{"amount": 101}, {"currency": "USD"}, {"method": "card"}, {"payerUserId": f.userB}} {
		push(f.userB, f.b, "expense", eid, "update", patch, Rejected)
	}
	push(f.userB, f.b, "expense", eid, "update", map[string]any{"title": "共享编辑", "note": "朋友修改"}, Accepted)
	push(f.userB, f.b, "expense", eid, "update", map[string]any{"date": "2026-12-02", "time": "10:00", "rateSource": "manual", "rate": "0.06"}, Accepted)
	push(f.userB, f.b, "expense", eid, "update", map[string]any{"rateSource": "wallet", "rate": nil}, Accepted)
	for _, patch := range []map[string]any{{"currency": "CNY"}, {"method": "cny"}, {"rateSource": "manual"}, {"rateSource": "actual"}, {"rateSource": "default"}, {"split": map[string]any{"mode": "equal", "members": []any{f.userA, f.userA}}}, {"split": map[string]any{"mode": "equal", "members": []any{uuid.NewString()}}}, {"split": map[string]any{"mode": "shares", "members": []any{f.userA}}}, {"amount": 1e12 + 1}} {
		push(f.userA, f.a, "expense", eid, "update", patch, Rejected)
	}
	push(f.userA, f.a, "expense", eid, "update", map[string]any{"rateSource": "manual", "rate": "0.05"}, Accepted)
	push(f.userA, f.a, "expense", eid, "update", map[string]any{"rateSource": "wallet"}, Rejected)
	push(f.userA, f.a, "expense", eid, "update", map[string]any{"rateSource": "actual", "rate": nil, "amountCny": 501}, Accepted)
	push(f.userA, f.a, "expense", eid, "update", map[string]any{"rateSource": "wallet", "amountCny": nil}, Accepted)
	f.exec("UPDATE trip_members SET left_at=now() WHERE trip_id=$1 AND user_id=$2", f.trip, f.userB)
	push(f.userA, f.a, "expense", eid, "update", map[string]any{"split": expense["split"]}, Accepted)
	tid := uuid.NewString()
	transfer := map[string]any{"fromUserId": f.userA, "toUserId": f.userB, "amountCny": 500, "date": "2026-12-01"}
	push(f.userA, f.a, "settlement_transfer", tid, "create", transfer, Accepted)
	for _, kind := range []string{"delete", "restore"} {
		push(f.userA, f.a, "settlement_transfer", tid, kind, map[string]any{}, Accepted)
	}
	push(f.userA, f.a, "settlement_transfer", tid, "update", map[string]any{"amountCny": 600}, Rejected)
	transfer["toUserId"] = f.userA
	push(f.userA, f.a, "settlement_transfer", uuid.NewString(), "create", transfer, Rejected)
	transfer["toUserId"] = uuid.NewString()
	push(f.userA, f.a, "settlement_transfer", uuid.NewString(), "create", transfer, Rejected)
}

func TestM2RatesMigrationIntegration(t *testing.T) {
	f := syncFixture(t)
	f.exec("DELETE FROM entity_state WHERE trip_id=$1 AND entity='trip_rates'", f.trip)
	before := f.pull(0, 500).LatestSeq
	source, err := os.ReadFile(filepath.Join("..", "..", "migrations", "00005_trip_rates.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(context.Background(), string(source)); err != nil {
		t.Fatal(err)
	}
	snap := f.snapshot()
	if snap.Seq != before+1 {
		t.Fatalf("migration seq: %d -> %d", before, snap.Seq)
	}
	found := false
	for _, e := range snap.Entities {
		if e.Entity == "trip_rates" {
			found = true
			if e.EntityId.String() != f.trip || len(e.Fields) != 0 {
				t.Fatal(e)
			}
		}
	}
	if !found {
		t.Fatal("rates missing")
	}
	ops := f.pull(before, 500).Ops
	if len(ops) != 1 || ops[0].Origin != "server" || ops[0].Kind != "create" {
		t.Fatal(ops)
	}
	if _, err = f.pool.Exec(context.Background(), string(source)); err != nil {
		t.Fatal(err)
	}
	if f.snapshot().Seq != before+1 {
		t.Fatal("migration is not idempotent")
	}
}
