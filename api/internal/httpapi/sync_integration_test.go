package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type syncTest struct {
	*authTest
	a, b, userA, userB, trip, invite string
}

func syncFixture(t *testing.T) *syncTest {
	f := authFixture(t)
	a := f.register(false)
	g := authFixture(t)
	b := g.register(false)
	u := f.expect(f.call("GET", "/api/me", nil, a, false, false), 200)["id"].(string)
	v := f.expect(f.call("GET", "/api/me", nil, b, false, false), 200)["id"].(string)
	trip := f.expect(f.call("POST", "/api/trips", map[string]any{"name": "日本旅行", "startDate": "2026-12-01", "endDate": "2026-12-10", "timezone": "Asia/Tokyo"}, a, false, false), 200)["id"].(string)
	t.Cleanup(func() { f.exec("DELETE FROM trips WHERE id=$1", trip) })
	f.expect(f.call("POST", "/api/trips/"+trip+"/invites", map[string]any{}, a, false, false), 403)
	f.expect(f.call("POST", "/api/auth/verify-email", map[string]any{"token": f.mailToken("/verify-email")}, "", false, true), 200)
	invite := f.expect(f.call("POST", "/api/trips/"+trip+"/invites", map[string]any{}, a, false, false), 200)["token"].(string)
	f.expect(f.call("POST", "/api/invites/"+invite+"/accept", nil, b, false, false), 200)
	return &syncTest{f, a, b, u, v, trip, invite}
}
func (f *syncTest) op(actor, entity, kind string, fields map[string]any, base map[string]int64) ClientOp {
	if fields == nil {
		fields = map[string]any{}
	}
	if base == nil {
		base = map[string]int64{}
	}
	return ClientOp{OpId: uuid.New(), TripId: uuid.MustParse(f.trip), ActorUserId: uuid.MustParse(actor), SchemaVersion: 1, Entity: "itinerary_item", EntityId: uuid.MustParse(entity), Kind: ClientOpKind(kind), Fields: fields, BaseSeq: base, ClientTime: time.Now().UTC()}
}
func (f *syncTest) push(token string, ops ...ClientOp) []OpResult {
	f.t.Helper()
	w := f.call("POST", "/api/trips/"+f.trip+"/ops", PushBody{Ops: ops}, token, false, false)
	f.expect(w, 200)
	var r PushResult
	if e := json.Unmarshal(w.Body.Bytes(), &r); e != nil {
		f.t.Fatal(e)
	}
	return r.Results
}
func (f *syncTest) pull(after int64, limit int) PullResult {
	f.t.Helper()
	w := f.call("GET", fmt.Sprintf("/api/trips/%s/ops?after=%d&limit=%d", f.trip, after, limit), nil, f.a, false, false)
	f.expect(w, 200)
	var r PullResult
	if e := json.Unmarshal(w.Body.Bytes(), &r); e != nil {
		f.t.Fatal(e)
	}
	return r
}
func (f *syncTest) snapshot() Snapshot {
	f.t.Helper()
	w := f.call("GET", "/api/trips/"+f.trip+"/snapshot", nil, f.a, false, false)
	f.expect(w, 200)
	var r Snapshot
	if e := json.Unmarshal(w.Body.Bytes(), &r); e != nil {
		f.t.Fatal(e)
	}
	return r
}
func TestSyncProtocolIntegration(t *testing.T) {
	f := syncFixture(t)
	id := uuid.NewString()
	create := f.op(f.userA, id, "create", map[string]any{"title": "原始", "date": "2026-12-01", "place": nil}, nil)
	r := f.push(f.a, create)[0]
	if r.Status != Accepted || *r.ServerSeq != 4 {
		t.Fatalf("create: %+v", r)
	}
	duplicate := f.push(f.a, create)[0]
	if duplicate.Status != Duplicate || *duplicate.ServerSeq != 4 || f.pull(0, 500).LatestSeq != 4 {
		t.Fatalf("duplicate: %+v", duplicate)
	}
	a := f.op(f.userA, id, "update", map[string]any{"title": "A"}, map[string]int64{"title": 4})
	b := f.op(f.userB, id, "update", map[string]any{"title": "B"}, map[string]int64{"title": 4})
	f.push(f.a, a)
	r = f.push(f.b, b)[0]
	if r.Status != Accepted || len(*r.Conflicts) != 1 {
		t.Fatalf("conflict: %+v", r)
	}
	c := (*r.Conflicts)[0]
	if c.OverwrittenValue.GetOrEmpty() != "A" || c.OverwrittenSeq != 5 || c.OverwrittenActor.String() != f.userA {
		t.Fatalf("conflict: %+v", c)
	}
	r = f.push(f.a, f.op(f.userA, id, "update", map[string]any{"title": "B"}, nil))[0]
	if len(*r.Conflicts) != 0 {
		t.Fatal("same value conflicts")
	}
	r = f.push(f.a, f.op(f.userA, id, "update", map[string]any{"place": "东京"}, map[string]int64{"place": 4}))[0]
	if len(*r.Conflicts) != 0 {
		t.Fatal("independent field conflicts")
	}
	f.push(f.a, f.op(f.userA, id, "delete", nil, nil))
	r = f.push(f.b, f.op(f.userB, id, "update", map[string]any{"title": "删除后修改"}, nil))[0]
	if r.Status != Accepted || r.EntityDeleted == nil || !*r.EntityDeleted || r.DeletedBy.String() != f.userA {
		t.Fatalf("deleted update: %+v", r)
	}
	f.push(f.a, f.op(f.userA, id, "restore", nil, nil))
	r = f.push(f.b, f.op(f.userB, id, "update", map[string]any{"place": nil}, nil))[0]
	if *r.EntityDeleted {
		t.Fatal("restore failed")
	}
	invalid := []struct {
		code   string
		change func(*ClientOp)
	}{
		{"entity_readonly", func(o *ClientOp) { o.Entity = "trip" }}, {"entity_readonly", func(o *ClientOp) { o.Entity = "member" }},
		{"invalid_op", func(o *ClientOp) { o.Entity = "unknown" }}, {"invalid_op", func(o *ClientOp) { o.Fields = map[string]any{"unknown": "x"} }},
		{"invalid_op", func(o *ClientOp) { o.Fields = map[string]any{"title": 123} }}, {"invalid_op", func(o *ClientOp) { o.Fields = map[string]any{"title": ""} }},
		{"invalid_op", func(o *ClientOp) { o.Fields = map[string]any{"date": "2026-02-30"} }}, {"invalid_op", func(o *ClientOp) { o.Fields = map[string]any{"place": strings.Repeat("长", 201)} }},
		{"upgrade_required", func(o *ClientOp) { o.SchemaVersion = 0 }}, {"server_outdated", func(o *ClientOp) { o.SchemaVersion = 2 }},
		{"actor_mismatch", func(o *ClientOp) { o.ActorUserId = uuid.MustParse(f.userB) }}, {"entity_not_found", func(o *ClientOp) { o.EntityId = uuid.New() }},
		{"entity_exists", func(o *ClientOp) { o.Kind = ClientOpKindCreate; o.Fields = create.Fields }},
	}
	for _, tc := range invalid {
		o := f.op(f.userA, id, "update", map[string]any{"title": "x"}, nil)
		tc.change(&o)
		// 混合批次保留逐条版本拒绝结果。
		first := f.push(f.a, o, f.op(f.userA, id, "update", map[string]any{}, nil))[0]
		second := f.push(f.a, o, f.op(f.userA, id, "update", map[string]any{}, nil))[0]
		if first.Status != Rejected || first.Error.Code != tc.code || !reflect.DeepEqual(first, second) {
			t.Fatalf("%s: %+v %+v", tc.code, first, second)
		}
	}
	// 单条拒绝不会中断后续操作。
	bad := f.op(f.userA, id, "update", map[string]any{"bad": true}, nil)
	good := f.op(f.userA, id, "update", map[string]any{"title": "最终"}, nil)
	results := f.push(f.a, bad, good)
	if results[0].Status != Rejected || results[1].Status != Accepted {
		t.Fatal(results)
	}
	all := []FullOp{}
	after := int64(0)
	for {
		page := f.pull(after, 2)
		all = append(all, page.Ops...)
		if !page.HasMore {
			break
		}
		after = page.Ops[len(page.Ops)-1].ServerSeq
	}
	snapshot := f.snapshot()
	if int64(len(all)) != snapshot.Seq {
		t.Fatalf("pagination: %d vs %d", len(all), snapshot.Seq)
	}
	replay := map[string]map[string]any{}
	seqs := map[string]map[string]int64{}
	deleted := map[string]bool{}
	for _, op := range all {
		key := op.Entity + op.EntityId.String()
		if replay[key] == nil {
			replay[key] = map[string]any{}
			seqs[key] = map[string]int64{}
		}
		for field, v := range op.Fields {
			old, present := replay[key][field]
			if !present || !reflect.DeepEqual(old, v) {
				replay[key][field] = v
				seqs[key][field] = op.ServerSeq
			}
		}
		if op.Kind == FullOpKindDelete {
			deleted[key] = true
		}
		if op.Kind == FullOpKindRestore {
			deleted[key] = false
		}
	}
	for _, e := range snapshot.Entities {
		key := e.Entity + e.EntityId.String()
		if !reflect.DeepEqual(e.Fields, replay[key]) || !reflect.DeepEqual(e.FieldSeq, seqs[key]) || e.Deleted != deleted[key] {
			t.Fatalf("replay mismatch: %+v vs %v %v", e, replay[key], seqs[key])
		}
	}
	history := f.expect(f.call("GET", "/api/trips/"+f.trip+"/history?entity=itinerary_item&entityId="+id+"&limit=2", nil, f.a, false, false), 200)["ops"].([]any)
	if len(history) != 2 || history[0].(map[string]any)["serverSeq"].(float64) <= history[1].(map[string]any)["serverSeq"].(float64) {
		t.Fatal("history ordering")
	}
	f.expect(f.call("GET", "/api/trips/"+f.trip+"/ops?limit=501", nil, f.a, false, false), 400)
	f.expect(f.call("GET", "/api/trips/"+f.trip, nil, "", false, false), 401)
	for _, v := range []int{0, 2} {
		o := f.op(f.userA, id, "update", map[string]any{}, nil)
		o.SchemaVersion = v
		f.expect(f.call("POST", "/api/trips/"+f.trip+"/ops", PushBody{Ops: []ClientOp{o}}, f.a, false, false), 426)
	}
}

func TestSyncVisibilityIntegration(t *testing.T) {
	f := syncFixture(t)
	private := uuid.NewString()
	public := uuid.NewString()
	r := f.push(f.a, f.op(f.userA, private, "create", map[string]any{"title": "私有", "date": "2026-12-01"}, nil))[0]
	f.exec("UPDATE ops SET visible_to_user_id=$1 WHERE trip_id=$2 AND server_seq=$3", f.userB, f.trip, *r.ServerSeq)
	f.exec("UPDATE entity_state SET visible_to_user_id=$1 WHERE trip_id=$2 AND entity_id=$3", f.userB, f.trip, private)
	f.push(f.a, f.op(f.userA, public, "create", map[string]any{"title": "公共", "date": "2026-12-01"}, nil))
	page := f.pull(3, 1)
	if len(page.Ops) != 1 || page.Ops[0].EntityId.String() != public || page.HasMore || page.LatestSeq != 5 {
		t.Fatalf("visibility page: %+v", page)
	}
	for _, e := range f.snapshot().Entities {
		if e.EntityId.String() == private {
			t.Fatal("private entity leaked")
		}
	}
	w := f.call("GET", "/api/trips/"+f.trip+"/history?entityId="+private, nil, f.a, false, false)
	body := f.expect(w, 200)
	if len(body["ops"].([]any)) != 0 {
		t.Fatal("private history leaked")
	}
	w = f.call("GET", "/api/trips/"+f.trip+"/ops?after=3", nil, f.b, false, false)
	body = f.expect(w, 200)
	if len(body["ops"].([]any)) != 2 {
		t.Fatal("private owner cannot pull")
	}
}

func TestSyncConcurrentIntegration(t *testing.T) {
	f := syncFixture(t)
	before := f.pull(0, 500).LatestSeq
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, actor := range []struct{ user, token string }{{f.userA, f.a}, {f.userB, f.b}} {
		wg.Add(1)
		go func(user, token string) {
			defer wg.Done()
			ops := []ClientOp{}
			for range 100 {
				ops = append(ops, f.op(user, uuid.NewString(), "create", map[string]any{"title": "并发", "date": "2026-12-01"}, nil))
			}
			w := f.call("POST", "/api/trips/"+f.trip+"/ops", PushBody{Ops: ops}, token, false, false)
			codes <- w.Code
		}(actor.user, actor.token)
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatal(code)
		}
	}
	page := f.pull(before, 500)
	if len(page.Ops) != 200 || page.LatestSeq != before+200 {
		t.Fatalf("sequence count %d %d", len(page.Ops), page.LatestSeq)
	}
	for i, o := range page.Ops {
		if o.ServerSeq != before+int64(i)+1 {
			t.Fatal("sequence gap")
		}
	}
}

func TestTripLifecycleIntegration(t *testing.T) {
	f := syncFixture(t)
	path := "/api/trips/" + f.trip
	f.expect(f.call("PATCH", path, map[string]any{"name": "修改行程"}, f.a, false, false), 200)
	f.expect(f.call("PATCH", path, map[string]any{"name": "越权"}, f.b, false, false), 403)
	f.expect(f.call("PATCH", path, map[string]any{"endDate": "2026-11-01"}, f.a, false, false), 400)
	f.expect(f.call("PATCH", path, map[string]any{"endDate": "2027-12-01"}, f.a, false, false), 400)
	f.expect(f.call("PATCH", path, map[string]any{"timezone": "Not/AZone"}, f.a, false, false), 400)
	f.expect(f.call("POST", path+"/leave", nil, f.a, false, false), 400)
	f.expect(f.call("PATCH", "/api/me", map[string]any{"nickname": "新昵称", "avatarUrl": "https://example.com/a.png"}, f.b, false, false), 200)
	snapshot := f.snapshot()
	found := false
	for _, m := range snapshot.Members {
		if m.UserId.String() == f.userB {
			found = m.Nickname == "新昵称" && m.AvatarUrl.GetOrEmpty() == "https://example.com/a.png"
		}
	}
	if !found {
		t.Fatal("profile not synchronized")
	}
	f.expect(f.call("POST", path+"/transfer-owner", map[string]any{"userId": f.userB}, f.a, false, false), 200)
	f.expect(f.call("DELETE", path+"/members/"+f.userA, nil, f.b, false, false), 200)
	f.expect(f.call("POST", path+"/ops", PushBody{Ops: []ClientOp{}}, f.a, false, false), 403)
	f.expect(f.call("GET", path+"/snapshot", nil, f.a, false, false), 403)
	f.expect(f.call("POST", "/api/invites/"+f.invite+"/accept", nil, f.a, false, false), 200)
	var left *time.Time
	if e := f.pool.QueryRow(context.Background(), "SELECT left_at FROM trip_members WHERE trip_id=$1 AND user_id=$2", f.trip, f.userA).Scan(&left); e != nil || left != nil {
		t.Fatalf("rejoin: %v %v", left, e)
	}
	f.expect(f.call("POST", path+"/leave", nil, f.a, false, false), 200)
	ops := f.expect(f.call("GET", path+"/ops", nil, f.b, false, false), 200)["ops"].([]any)
	want := []struct{ entity, kind string }{{"trip", "create"}, {"member", "create"}, {"member", "create"}, {"trip", "update"}, {"member", "update"}, {"trip", "update"}, {"member", "update"}, {"member", "update"}, {"member", "update"}, {"member", "restore"}, {"member", "update"}, {"member", "update"}}
	if len(ops) != len(want) {
		t.Fatalf("server ops: %d want %d", len(ops), len(want))
	}
	for i, expected := range want {
		op := ops[i].(map[string]any)
		if op["entity"] != expected.entity || op["kind"] != expected.kind || op["origin"] != "server" || op["serverSeq"] != float64(i+1) {
			t.Fatalf("server op %d: %v", i, op)
		}
	}
	if ops[5].(map[string]any)["fields"].(map[string]any)["ownerId"] != f.userB {
		t.Fatal("transfer owner op missing")
	}
	f.expect(f.call("DELETE", path, nil, f.b, false, false), 200)
	f.expect(f.call("GET", path, nil, f.b, false, false), 404)
	f.expect(f.call("POST", path+"/ops", PushBody{}, f.b, false, false), 404)
	for _, table := range []string{"trips", "trip_members", "invites", "ops", "entity_state", "rejected_ops"} {
		column := "trip_id"
		if table == "trips" {
			column = "id"
		}
		var n int
		if e := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table+" WHERE "+column+"=$1", f.trip).Scan(&n); e != nil || n != 0 {
			t.Fatalf("delete %s: %d %v", table, n, e)
		}
	}
}

func TestInvitesIntegration(t *testing.T) {
	f := syncFixture(t)
	path := "/api/trips/" + f.trip
	g := authFixture(t)
	outsider := g.register(false)
	f.expect(f.call("GET", path, nil, outsider, false, false), 403)
	f.expect(f.call("POST", path+"/ops", PushBody{}, outsider, false, false), 403)
	preview := f.expect(f.call("GET", "/api/invites/"+f.invite, nil, "", false, false), 200)
	if len(preview) != 3 || preview["valid"] != true {
		t.Fatal(preview)
	}
	create := func() map[string]any {
		return f.expect(f.call("POST", path+"/invites", map[string]any{"expiresInHours": 1}, f.a, false, false), 200)
	}
	expired := create()
	f.exec("UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=$1", expired["id"])
	f.expect(f.call("POST", "/api/invites/"+expired["token"].(string)+"/accept", nil, outsider, false, false), 400)
	revoked := create()
	f.expect(f.call("DELETE", path+"/invites/"+revoked["id"].(string), nil, f.a, false, false), 200)
	f.expect(f.call("POST", "/api/invites/"+revoked["token"].(string)+"/accept", nil, outsider, false, false), 400)
	f.expect(f.call("POST", path+"/invites", map[string]any{}, f.b, false, false), 403)
	f.expect(f.call("GET", path+"/invites", nil, f.a, false, false), 200)
	before := f.pull(0, 500).LatestSeq
	f.expect(f.call("POST", "/api/invites/"+f.invite+"/accept", nil, f.b, false, false), 200)
	if f.pull(0, 500).LatestSeq != before {
		t.Fatal("duplicate join wrote op")
	}
}

func TestSSEIntegration(t *testing.T) {
	for _, terminal := range []string{"revoked", "trip_deleted"} {
		t.Run(terminal, func(t *testing.T) {
			f := syncFixture(t)
			server := httptest.NewServer(f.handler)
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			req, e := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/trips/"+f.trip+"/events", nil)
			if e != nil {
				t.Fatal(e)
			}
			req.Header.Set("Authorization", "Bearer "+f.b)
			resp, e := http.DefaultClient.Do(req)
			if e != nil {
				t.Fatal(e)
			}
			defer resp.Body.Close()
			scanner := bufio.NewScanner(resp.Body)
			next := func(want string) {
				t.Helper()
				for scanner.Scan() {
					if scanner.Text() == "event: "+want {
						return
					}
				}
				t.Fatalf("missing %s: %v", want, scanner.Err())
			}
			next("seq")
			f.push(f.a, f.op(f.userA, uuid.NewString(), "create", map[string]any{"title": "SSE", "date": "2026-12-01"}, nil))
			next("seq")
			if terminal == "revoked" {
				f.expect(f.call("DELETE", "/api/trips/"+f.trip+"/members/"+f.userB, nil, f.a, false, false), 200)
			} else {
				f.expect(f.call("DELETE", "/api/trips/"+f.trip, nil, f.a, false, false), 200)
			}
			next(terminal)
		})
	}
}
