package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"waypoint/internal/db"
)

func ownKey(op ClientOp, key string) error {
	if key != op.ActorUserId.String() {
		return fail(400, "forbidden_field", "只能修改自己的勾选或投票")
	}
	return nil
}
func validBool(v any) bool { _, ok := v.(bool); return ok }
func validTimestamp(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}
func validVotes(v any) bool {
	a, ok := v.([]any)
	if !ok || len(a) > 200 {
		return false
	}
	seen := map[string]bool{}
	for _, id := range a {
		if !validUUID(id) || seen[id.(string)] {
			return false
		}
		seen[id.(string)] = true
	}
	return true
}
func init() {
	base := entities["itinerary_item"]
	dynamic := func(prefix string, validate func(any) bool) []DynamicFieldDef {
		return []DynamicFieldDef{{Prefix: prefix, Key: func(k string) bool { return validUUID(k) }, Field: FieldDef{Validate: validate}, Permission: ownKey}}
	}
	entities["packing_item"] = EntityDef{Name: "packing_item", Kinds: base.Kinds, Permission: base.Permission, Dynamic: dynamic("checked.", validBool), Fields: map[string]FieldDef{
		"name": {Required: true, Validate: stringField(1, 100)}, "category": {Nullable: true, Validate: stringField(0, 30)}, "scope": {Required: true, Validate: choice("personal", "shared")}, "ownerUserId": {Nullable: true, Validate: validUUID}, "assigneeUserId": {Nullable: true, Validate: validUUID}, "packed": {Validate: validBool}, "packedBy": {Nullable: true, Validate: validUUID}, "sortOrder": base.Fields["sortOrder"],
	}}
	entities["poll"] = EntityDef{Name: "poll", Kinds: base.Kinds, Permission: base.Permission, Dynamic: dynamic("vote.", validVotes), Fields: map[string]FieldDef{
		"question": {Required: true, Validate: stringField(1, 200)}, "multiChoice": {Required: true, Validate: validBool}, "deadline": {Nullable: true, Validate: validTimestamp},
	}}
	entities["poll_option"] = EntityDef{Name: "poll_option", Kinds: base.Kinds, Permission: base.Permission, Fields: map[string]FieldDef{
		"pollId": {Required: true, Validate: validUUID}, "text": {Required: true, Validate: stringField(1, 100)}, "sortOrder": base.Fields["sortOrder"],
	}}
}
func pollClosed(fields map[string]any, now time.Time) bool {
	if fields["closedAt"] != nil {
		return true
	}
	if s, ok := fields["deadline"].(string); ok {
		end, err := time.Parse(time.RFC3339Nano, s)
		return err == nil && now.After(end)
	}
	return false
}
func (s *Server) validatePackingPollState(ctx context.Context, q *db.Queries, op ClientOp, e db.EntityState, fields map[string]any) error {
	if op.Entity != "packing_item" && op.Entity != "poll" && op.Entity != "poll_option" {
		return nil
	}
	bad := func(m string) error { return fail(400, "invalid_op", m) }
	forbidden := func() error { return fail(400, "forbidden_field", "没有权限修改此字段或实体") }
	merged := map[string]any{}
	for k, v := range fields {
		merged[k] = v
	}
	for k, v := range op.Fields {
		merged[k] = v
	}
	actor := op.ActorUserId.String()
	member, err := q.GetMember(ctx, db.GetMemberParams{TripID: uid(op.TripId), UserID: uid(op.ActorUserId)})
	if err != nil {
		return err
	}
	if op.Entity == "packing_item" {
		if op.Kind == ClientOpKindDelete || op.Kind == ClientOpKindRestore {
			return nil
		}
		if merged["scope"] == "personal" {
			if merged["assigneeUserId"] != nil || merged["packed"] != nil || merged["packedBy"] != nil {
				return bad("个人物品不能设置公共装箱状态")
			}
			for k := range op.Fields {
				if len(k) > 8 && k[:8] == "checked." && merged["ownerUserId"] != nil && merged["ownerUserId"] != actor {
					return forbidden()
				}
			}
		} else {
			if merged["ownerUserId"] != nil || !validUUID(merged["assigneeUserId"]) {
				return bad("公共物品必须指定负责人")
			}
			// 负责人和装箱状态同时变化时，按原负责人鉴权，避免接管后越权勾选。
			assignee := fields["assigneeUserId"]
			if op.Kind == ClientOpKindCreate {
				assignee = merged["assigneeUserId"]
			}
			if _, ok := op.Fields["packed"]; ok && member.Role != "owner" && assignee != actor {
				return forbidden()
			}
			for k := range merged {
				if len(k) > 8 && k[:8] == "checked." {
					return bad("公共物品不能设置个人勾选")
				}
			}
			if v, ok := op.Fields["packedBy"]; ok && (v != actor || op.Fields["packed"] == nil) {
				return forbidden()
			}
			if _, ok := op.Fields["packed"]; ok {
				op.Fields["packedBy"] = actor
			}
		}
		for _, key := range []string{"ownerUserId", "assigneeUserId"} {
			if id, ok := merged[key].(string); ok {
				m, err := q.GetMember(ctx, db.GetMemberParams{TripID: uid(op.TripId), UserID: uid(uuid.MustParse(id))})
				if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.LeftAt.Valid) {
					return bad("指定成员必须是当前成员")
				}
				if err != nil {
					return err
				}
			}
		}
		return nil
	}
	if op.Entity == "poll" {
		creator := e.CreatedBy == uid(op.ActorUserId) || op.Kind == ClientOpKindCreate
		if op.Kind == ClientOpKindDelete || op.Kind == ClientOpKindRestore {
			if !creator && member.Role != "owner" {
				return forbidden()
			}
			return nil
		}
		for k := range op.Fields {
			if k == "question" || k == "multiChoice" || k == "deadline" {
				if !creator {
					return forbidden()
				}
			}
		}
		var votes []any
		voting := false
		for k, v := range op.Fields {
			if len(k) > 5 && k[:5] == "vote." {
				voting = true
				votes = v.([]any)
			}
		}
		if voting && pollClosed(fields, time.Now()) {
			return fail(400, "poll_closed", "投票已截止")
		}
		for k, v := range merged {
			if len(k) > 5 && k[:5] == "vote." && merged["multiChoice"] == false && len(v.([]any)) > 1 {
				return bad("单选投票最多选择一项")
			}
		}
		if len(votes) > 0 {
			// 一次读取选项集合，避免逐票查询。
			rows, err := q.ListEntities(ctx, db.ListEntitiesParams{TripID: uid(op.TripId), UserID: uid(op.ActorUserId)})
			if err != nil {
				return err
			}
			valid := map[string]bool{}
			for _, row := range rows {
				if row.Entity == "poll_option" && !row.Deleted {
					f, err := decode[map[string]any](row.Fields)
					if err != nil {
						return err
					}
					if f["pollId"] == op.EntityId.String() {
						valid[uuid.UUID(row.EntityID.Bytes).String()] = true
					}
				}
			}
			for _, id := range votes {
				if !valid[id.(string)] {
					return bad("投票选项不存在或已删除")
				}
			}
		}
		return nil
	}
	if fields["pollId"] != nil && fields["pollId"] != merged["pollId"] {
		return bad("选项不可移动至其他投票")
	}
	poll, err := q.GetEntity(ctx, db.GetEntityParams{TripID: uid(op.TripId), Entity: "poll", EntityID: uid(uuid.MustParse(merged["pollId"].(string)))})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && poll.Deleted) {
		return bad("投票不存在")
	}
	if err != nil {
		return err
	}
	pf, err := decode[map[string]any](poll.Fields)
	if err != nil {
		return err
	}
	if op.Kind == ClientOpKindCreate || op.Kind == ClientOpKindRestore {
		if pollClosed(pf, time.Now()) {
			return fail(400, "poll_closed", "投票已截止")
		}
	}
	if op.Kind != ClientOpKindCreate && e.CreatedBy != uid(op.ActorUserId) && poll.CreatedBy != uid(op.ActorUserId) {
		return forbidden()
	}
	return nil
}

func (s *Server) ClosePoll(ctx context.Context, r ClosePollRequestObject) (ClosePollResponseObject, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	_, m, err := s.membership(ctx, q, r.TripId, false, true)
	if err != nil {
		return nil, err
	}
	e, err := q.GetEntity(ctx, db.GetEntityParams{TripID: uid(r.TripId), Entity: "poll", EntityID: uid(r.PollId)})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && e.Deleted) {
		return nil, fail(404, "entity_not_found", "投票不存在")
	}
	if err != nil {
		return nil, err
	}
	if e.CreatedBy != state(ctx).user.ID && m.Role != "owner" {
		return nil, fail(403, "forbidden_field", "仅创建者或 owner 可关闭投票")
	}
	fields, err := decode[map[string]any](e.Fields)
	if err != nil {
		return nil, err
	}
	if fields["closedAt"] == nil {
		if err = s.serverOp(ctx, q, r.TripId, "poll", r.PollId, ClientOpKindUpdate, map[string]any{"closedAt": time.Now().UTC().Format(time.RFC3339Nano)}); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.hub.notify(r.TripId)
	return ClosePoll204Response{}, nil
}
