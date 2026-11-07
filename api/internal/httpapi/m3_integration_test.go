package httpapi

import (
	"encoding/json"
	"github.com/google/uuid"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestM3PackingPollsIntegration(t *testing.T) {
	f := syncFixture(t)
	push := func(actor, token, entity, id, kind string, fields map[string]any, code string) ClientOp {
		t.Helper()
		op := f.op(actor, id, kind, fields, nil)
		op.Entity = entity
		r := f.push(token, op)[0]
		if code == "" {
			if r.Status != Accepted {
				t.Fatalf("%s %s: %+v", entity, kind, r)
			}
		} else {
			if r.Status != Rejected || r.Error.Code != code {
				t.Fatalf("want %s: %+v", code, r)
			}
			if again := f.push(token, op)[0]; !reflect.DeepEqual(r, again) {
				t.Fatal("rejection not idempotent")
			}
		}
		return op
	}
	personal := uuid.NewString()
	push(f.userA, f.a, "packing_item", personal, "create", map[string]any{"name": "护照", "scope": "personal"}, "")
	push(f.userA, f.a, "packing_item", personal, "update", map[string]any{"checked." + f.userB: true}, "forbidden_field")
	push(f.userA, f.a, "packing_item", personal, "update", map[string]any{"checked." + f.userA: true}, "")
	push(f.userB, f.b, "packing_item", personal, "update", map[string]any{"checked." + f.userB: false}, "")
	push(f.userB, f.b, "packing_item", personal, "update", map[string]any{"packed": true}, "invalid_op")
	only := uuid.NewString()
	push(f.userA, f.a, "packing_item", only, "create", map[string]any{"name": "药", "scope": "personal", "ownerUserId": f.userA}, "")
	push(f.userB, f.b, "packing_item", only, "update", map[string]any{"checked." + f.userB: true}, "forbidden_field")
	shared := uuid.NewString()
	push(f.userB, f.b, "packing_item", shared, "create", map[string]any{"name": "相机", "scope": "shared", "assigneeUserId": f.userA}, "")
	push(f.userB, f.b, "packing_item", shared, "update", map[string]any{"packed": true}, "forbidden_field")
	push(f.userB, f.b, "packing_item", shared, "update", map[string]any{"assigneeUserId": f.userB, "packed": true}, "forbidden_field")
	push(f.userA, f.a, "packing_item", shared, "update", map[string]any{"assigneeUserId": f.userB}, "")
	push(f.userB, f.b, "packing_item", shared, "update", map[string]any{"packed": true}, "")
	push(f.userA, f.a, "packing_item", shared, "update", map[string]any{"packed": false}, "")
	push(f.userB, f.b, "packing_item", shared, "update", map[string]any{"packed": true, "packedBy": f.userA}, "forbidden_field")
	push(f.userA, f.a, "packing_item", uuid.NewString(), "create", map[string]any{"name": "x", "scope": "shared"}, "invalid_op")
	push(f.userA, f.a, "packing_item", shared, "update", map[string]any{"assigneeUserId": uuid.NewString()}, "invalid_op")
	poll := uuid.NewString()
	push(f.userB, f.b, "poll", poll, "create", map[string]any{"question": "吃什么", "multiChoice": false}, "")
	a, b := uuid.NewString(), uuid.NewString()
	for _, id := range []string{a, b} {
		push(f.userA, f.a, "poll_option", id, "create", map[string]any{"pollId": poll, "text": id}, "")
	}
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userB: []any{a}}, "forbidden_field")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{a, b}}, "invalid_op")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{uuid.NewString()}}, "invalid_op")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{a}}, "")
	push(f.userB, f.b, "poll", poll, "update", map[string]any{"vote." + f.userB: []any{b}}, "")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{}}, "")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"question": "x"}, "forbidden_field")
	push(f.userB, f.b, "poll", poll, "update", map[string]any{"closedAt": time.Now().Format(time.RFC3339)}, "invalid_op")
	push(f.userB, f.b, "poll", poll, "update", map[string]any{"multiChoice": true}, "")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{a, a}}, "invalid_op")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{a, b}}, "")
	push(f.userB, f.b, "poll_option", b, "delete", nil, "")
	push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{b}}, "invalid_op")
	push(f.userB, f.b, "poll", poll, "update", map[string]any{"deadline": time.Now().Add(-time.Minute).Format(time.RFC3339)}, "")
	closedVote := push(f.userA, f.a, "poll", poll, "update", map[string]any{"vote." + f.userA: []any{a}}, "poll_closed")
	push(f.userA, f.a, "poll_option", uuid.NewString(), "create", map[string]any{"pollId": poll, "text": "后加"}, "poll_closed")
	push(f.userB, f.b, "poll", poll, "update", map[string]any{"deadline": nil}, "")
	if r := f.push(f.a, closedVote)[0]; r.Error == nil || r.Error.Code != "poll_closed" {
		t.Fatal("cached rejection changed")
	}
	path := "/api/trips/" + f.trip + "/polls/" + poll + "/close"
	// owner 也可关闭他人创建的投票。
	if w := f.call("POST", path, nil, f.a, false, false); w.Code != 204 {
		t.Fatalf("close: %d %s", w.Code, w.Body)
	}
	seq := f.snapshot().Seq
	if w := f.call("POST", path, nil, f.a, false, false); w.Code != 204 {
		t.Fatalf("close: %d %s", w.Code, w.Body)
	}
	if f.snapshot().Seq != seq {
		t.Fatal("close not idempotent")
	}
	push(f.userB, f.b, "poll", poll, "update", map[string]any{"vote." + f.userB: []any{}}, "poll_closed")
	push(f.userB, f.b, "poll_option", uuid.NewString(), "create", map[string]any{"pollId": poll, "text": "晚了"}, "poll_closed")
	for _, e := range f.snapshot().Entities {
		if e.Entity == "packing_item" && e.EntityId.String() == shared && e.Fields["packedBy"] != f.userA {
			t.Fatal("packedBy not assigned by server")
		}
	}
	otherPoll := uuid.NewString()
	push(f.userA, f.a, "poll", otherPoll, "create", map[string]any{"question": "权限", "multiChoice": false}, "")
	otherOption := uuid.NewString()
	push(f.userA, f.a, "poll_option", otherOption, "create", map[string]any{"pollId": otherPoll, "text": "选项"}, "")
	for _, kind := range []string{"update", "delete", "restore"} {
		patch := map[string]any{}
		if kind == "update" {
			patch["text"] = "越权"
		}
		push(f.userB, f.b, "poll_option", otherOption, kind, patch, "forbidden_field")
	}
	push(f.userB, f.b, "poll", otherPoll, "delete", nil, "forbidden_field")
	f.expect(f.call("POST", "/api/trips/"+f.trip+"/polls/"+otherPoll+"/close", nil, f.b, false, false), 403)
	if w := f.call("POST", "/api/trips/"+f.trip+"/polls/"+otherPoll+"/close", nil, f.a, false, false); w.Code != 204 {
		t.Fatal(w.Code, w.Body)
	}
	push(f.userA, f.a, "packing_item", personal, "update", map[string]any{"checked." + f.userA: "true"}, "invalid_op")
	push(f.userA, f.a, "packing_item", personal, "update", map[string]any{"checked.bad": true}, "invalid_op")
}

func TestM3TemplatesIntegration(t *testing.T) {
	f := syncFixture(t)
	path := "/api/me/packing-templates"
	body := map[string]any{"name": "我的模板", "items": []any{map[string]any{"name": "护照", "category": "证件", "scope": "personal"}}}
	first := f.expect(f.call("POST", path, body, f.a, false, false), 200)
	id := first["id"].(string)
	w := f.call("GET", path, nil, f.b, false, false)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal(w.Body)
	}
	f.expect(f.call("PUT", path+"/"+id, body, f.b, false, false), 404)
	f.expect(f.call("DELETE", path+"/"+id, nil, f.b, false, false), 404)
	f.expect(f.call("PUT", path+"/"+id, body, f.a, false, false), 200)
	oversized := make([]any, 201)
	for i := range oversized {
		oversized[i] = map[string]any{"name": "x", "category": "", "scope": "shared"}
	}
	f.expect(f.call("POST", path, map[string]any{"name": "x", "items": oversized}, f.a, false, false), 400)
	f.expect(f.call("PUT", path+"/"+id, map[string]any{"name": "200 项", "items": oversized[:200]}, f.a, false, false), 200)
	f.expect(f.call("POST", path, map[string]any{"name": "非法", "items": []any{map[string]any{"name": "x", "category": "", "scope": "unknown"}}}, f.a, false, false), 400)
	for i := 1; i < 50; i++ {
		f.expect(f.call("POST", path, body, f.a, false, false), 200)
	}
	f.expect(f.call("POST", path, body, f.a, false, false), 400)
	w = f.call("GET", path, nil, f.a, false, false)
	var rows []PackingTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 50 {
		t.Fatal(len(rows))
	}
	if w := f.call("DELETE", path+"/"+id, nil, f.a, false, false); w.Code != 204 {
		t.Fatalf("delete: %d %s", w.Code, w.Body)
	}
	f.expect(f.call("POST", path, body, f.a, false, false), 200)
}
