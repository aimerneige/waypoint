package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oapi-codegen/nullable"
	"waypoint/internal/db"
)

const CurrentSchemaVersion = 1
const MinSupportedSchemaVersion = 1

type OpUpgrade func(ClientOp) (ClientOp, error)

var opUpgrades = map[int]OpUpgrade{}

func upgrade(op ClientOp, fromVersion int, chain map[int]OpUpgrade) (ClientOp, error) {
	for v := fromVersion; v < CurrentSchemaVersion; v++ {
		fn, ok := chain[v]
		if !ok {
			return op, fmt.Errorf("missing upgrade from schema %d", v)
		}
		var err error
		op, err = fn(op)
		if err != nil {
			return op, err
		}
		op.SchemaVersion = v + 1
	}
	return op, nil
}

type FieldDef struct {
	Required, Nullable bool
	Validate           func(any) bool
}
type EntityDef struct {
	Name       string
	Fields     map[string]FieldDef
	Kinds      map[ClientOpKind]bool
	Readonly   bool
	Permission func(string, db.EntityState) error
}

func stringField(min, max int) func(any) bool {
	return func(v any) bool {
		s, ok := v.(string)
		return ok && utf8.RuneCountInString(s) >= min && utf8.RuneCountInString(s) <= max
	}
}
func validDate(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	t, e := time.Parse("2006-01-02", s)
	return e == nil && t.Format("2006-01-02") == s
}

var entities = map[string]EntityDef{
	"trip": {Name: "trip", Readonly: true}, "member": {Name: "member", Readonly: true},
	"itinerary_item": {Name: "itinerary_item", Fields: map[string]FieldDef{
		"title": {Required: true, Validate: stringField(1, 200)}, "date": {Required: true, Validate: validDate}, "place": {Nullable: true, Validate: stringField(0, 200)},
	}, Kinds: map[ClientOpKind]bool{ClientOpKindCreate: true, ClientOpKindUpdate: true, ClientOpKindDelete: true, ClientOpKindRestore: true}, Permission: func(role string, _ db.EntityState) error {
		if role != "owner" && role != "member" {
			return fail(403, "not_member", "您不是当前成员")
		}
		return nil
	}},
}

func validateOp(op ClientOp) error {
	if op.OpId == uuid.Nil {
		return fail(400, "invalid_op", "opId 必须是非空 UUID")
	}
	if op.SchemaVersion < MinSupportedSchemaVersion {
		return fail(426, "upgrade_required", "请升级客户端后重试")
	}
	if op.SchemaVersion > CurrentSchemaVersion {
		return fail(426, "server_outdated", "服务器尚不支持此版本")
	}
	def, ok := entities[op.Entity]
	if !ok {
		return fail(400, "invalid_op", "entity 未知")
	}
	if def.Readonly {
		return fail(400, "entity_readonly", "entity 仅允许服务器写入")
	}
	if op.EntityId == uuid.Nil || op.ClientTime.IsZero() || !def.Kinds[op.Kind] {
		return fail(400, "invalid_op", "entityId、clientTime 或 kind 非法")
	}
	if op.Fields == nil {
		return fail(400, "invalid_op", "fields 必须是对象")
	}
	if op.BaseSeq == nil {
		return fail(400, "invalid_op", "baseSeq 必须是对象")
	}
	if (op.Kind == ClientOpKindDelete || op.Kind == ClientOpKindRestore) && len(op.Fields) > 0 {
		return fail(400, "invalid_op", "fields 在 delete/restore 时必须为空")
	}
	for f, v := range op.Fields {
		d, ok := def.Fields[f]
		if !ok {
			return fail(400, "invalid_op", "未知字段 "+f)
		}
		if v == nil && d.Nullable {
			continue
		}
		if !d.Validate(v) {
			return fail(400, "invalid_op", "字段非法 "+f)
		}
	}
	if op.Kind == ClientOpKindCreate {
		for f, d := range def.Fields {
			if _, ok := op.Fields[f]; d.Required && !ok {
				return fail(400, "invalid_op", "缺少字段 "+f)
			}
		}
	}
	for f, seq := range op.BaseSeq {
		if _, ok := def.Fields[f]; !ok || seq < 0 {
			return fail(400, "invalid_op", "baseSeq 字段非法 "+f)
		}
	}
	return nil
}
func uid(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func nullableValue[T any](v T, valid bool) nullable.Nullable[T] {
	if !valid {
		return nullable.NewNullNullable[T]()
	}
	return nullable.NewNullableWithValue(v)
}
func jsonValue(v any) nullable.Nullable[any] { return nullableValue(v, v != nil) }
func decode[T any](b []byte) (T, error)      { var v T; err := json.Unmarshal(b, &v); return v, err }

func (s *Server) membership(ctx context.Context, q *db.Queries, trip uuid.UUID, owner bool, lock bool) (db.Trip, db.TripMember, error) {
	var t db.Trip
	var err error
	if lock {
		t, err = q.LockTrip(ctx, uid(trip))
	} else {
		t, err = q.GetTrip(ctx, uid(trip))
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return t, db.TripMember{}, fail(404, "trip_not_found", "行程不存在")
	}
	if err != nil {
		return t, db.TripMember{}, err
	}
	m, err := q.GetMember(ctx, db.GetMemberParams{TripID: t.ID, UserID: state(ctx).user.ID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.LeftAt.Valid) {
		return t, m, fail(403, "not_member", "您不是当前成员")
	}
	if err != nil {
		return t, m, err
	}
	if owner && m.Role != "owner" {
		return t, m, fail(403, "owner_required", "仅 owner 可以操作")
	}
	return t, m, nil
}
func rejectResult(id uuid.UUID, code, message string) OpResult {
	r := OpResult{OpId: id, Status: Rejected}
	r.Error = &struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}{code, message}
	return r
}

func (s *Server) pushOne(ctx context.Context, trip uuid.UUID, op ClientOp) (OpResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OpResult{}, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	if err = q.LockOpID(ctx, op.OpId.String()); err != nil {
		return OpResult{}, err
	}
	_, _, err = s.membership(ctx, q, trip, false, true)
	if err != nil {
		return OpResult{}, err
	}
	old, err := q.GetOp(ctx, uid(op.OpId))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return OpResult{}, err
	}
	if err == nil {
		if old.TripID != uid(trip) || old.ActorUserID != state(ctx).user.ID {
			return rejectResult(op.OpId, "invalid_op", "opId 已被使用"), nil
		}
		return OpResult{OpId: op.OpId, Status: Duplicate, ServerSeq: &old.ServerSeq}, nil
	}
	rej, err := q.GetRejected(ctx, uid(op.OpId))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return OpResult{}, err
	}
	if err == nil {
		if rej.TripID != uid(trip) || rej.ActorUserID != state(ctx).user.ID {
			return rejectResult(op.OpId, "invalid_op", "opId 已被使用"), nil
		}
		return rejectResult(op.OpId, rej.Code, rej.Message), nil
	}
	var validation error
	if op.SchemaVersion >= MinSupportedSchemaVersion && op.SchemaVersion <= CurrentSchemaVersion {
		op, validation = upgrade(op, op.SchemaVersion, opUpgrades)
		if validation != nil {
			return OpResult{}, validation
		}
	}
	if validation == nil {
		validation = validateOp(op)
	}
	if op.ActorUserId != uuid.UUID(state(ctx).user.ID.Bytes) {
		validation = fail(400, "actor_mismatch", "actorUserId 与会话用户不符")
	}
	if op.TripId != trip {
		validation = fail(400, "invalid_op", "tripId 与路径不符")
	}
	var result OpResult
	if validation == nil {
		result, validation = s.applyOp(ctx, q, op, "client")
	}
	if validation != nil {
		var ae *apiError
		if !errors.As(validation, &ae) {
			return OpResult{}, validation
		}
		result = rejectResult(op.OpId, ae.code, ae.message)
		switch ae.code {
		case "upgrade_required", "server_outdated":
			return result, nil
		case "invalid_op", "actor_mismatch", "entity_readonly", "entity_exists", "entity_not_found":
			// 仅缓存确定性的业务拒绝，环境和版本变化后仍需重新评估。
		default:
			return OpResult{}, validation
		}
		if err = q.RejectOp(ctx, db.RejectOpParams{OpID: uid(op.OpId), TripID: uid(trip), ActorUserID: state(ctx).user.ID, Code: ae.code, Message: ae.message}); err != nil {
			return OpResult{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return OpResult{}, err
	}
	if result.Status == Accepted {
		s.hub.notify(trip)
	}
	return result, nil
}

// 调用者持有行程行锁，序号和状态必须与日志在同一个事务中提交。
func (s *Server) applyOp(ctx context.Context, q *db.Queries, op ClientOp, origin string) (OpResult, error) {
	if op.Fields == nil {
		op.Fields = map[string]any{}
	}
	if op.BaseSeq == nil {
		op.BaseSeq = map[string]int64{}
	}
	e, err := q.GetEntity(ctx, db.GetEntityParams{TripID: uid(op.TripId), Entity: op.Entity, EntityID: uid(op.EntityId)})
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return OpResult{}, err
	}
	if op.Kind == ClientOpKindCreate && exists {
		return OpResult{}, fail(400, "entity_exists", "实体已经存在")
	}
	if op.Kind != ClientOpKindCreate && !exists {
		return OpResult{}, fail(400, "entity_not_found", "实体不存在")
	}
	if origin == "client" {
		m, err := q.GetMember(ctx, db.GetMemberParams{TripID: uid(op.TripId), UserID: state(ctx).user.ID})
		if err != nil {
			return OpResult{}, err
		}
		if err := entities[op.Entity].Permission(m.Role, e); err != nil {
			return OpResult{}, err
		}
	}
	fields := map[string]any{}
	seqs := map[string]int64{}
	actors := map[string]uuid.UUID{}
	if exists {
		if fields, err = decode[map[string]any](e.Fields); err != nil {
			return OpResult{}, err
		}
		if seqs, err = decode[map[string]int64](e.FieldSeq); err != nil {
			return OpResult{}, err
		}
		if actors, err = decode[map[string]uuid.UUID](e.FieldActor); err != nil {
			return OpResult{}, err
		}
	}
	seq, err := q.NextSeq(ctx, uid(op.TripId))
	if err != nil {
		return OpResult{}, err
	}
	if !exists {
		e = db.EntityState{TripID: uid(op.TripId), Entity: op.Entity, EntityID: uid(op.EntityId), CreatedBy: uid(op.ActorUserId), CreatedSeq: seq}
	}
	changes := map[string]Change{}
	conflicts := []Conflict{}
	for f, v := range op.Fields {
		old, present := fields[f]
		if present && reflect.DeepEqual(old, v) {
			continue
		}
		if origin == "client" && seqs[f] > op.BaseSeq[f] && !reflect.DeepEqual(old, v) {
			conflicts = append(conflicts, Conflict{Field: f, OverwrittenValue: jsonValue(old), OverwrittenSeq: seqs[f], OverwrittenActor: actors[f]})
		}
		changes[f] = Change{Old: jsonValue(old), New: jsonValue(v)}
		fields[f] = v
		seqs[f] = seq
		actors[f] = op.ActorUserId
	}
	entityDeleted := op.Kind == ClientOpKindUpdate && e.Deleted
	if op.Kind == ClientOpKindDelete && !e.Deleted {
		changes["deleted"] = Change{Old: jsonValue(false), New: jsonValue(true)}
		e.Deleted = true
		e.DeletedBy = uid(op.ActorUserId)
		e.DeletedSeq = pgtype.Int8{Int64: seq, Valid: true}
	}
	if op.Kind == ClientOpKindRestore && e.Deleted {
		changes["deleted"] = Change{Old: jsonValue(true), New: jsonValue(false)}
		e.Deleted = false
		e.DeletedBy = pgtype.UUID{}
		e.DeletedSeq = pgtype.Int8{}
	}
	values := []any{fields, seqs, actors, op.Fields, op.BaseSeq, changes, conflicts}
	encoded := make([][]byte, len(values))
	for i, v := range values {
		encoded[i], err = json.Marshal(v)
		if err != nil {
			return OpResult{}, err
		}
	}
	if err = q.SaveEntity(ctx, db.SaveEntityParams{TripID: e.TripID, Entity: e.Entity, EntityID: e.EntityID, Fields: encoded[0], FieldSeq: encoded[1], FieldActor: encoded[2], CreatedBy: e.CreatedBy, CreatedSeq: e.CreatedSeq, UpdatedSeq: seq, Deleted: e.Deleted, DeletedBy: e.DeletedBy, DeletedSeq: e.DeletedSeq, VisibleToUserID: e.VisibleToUserID}); err != nil {
		return OpResult{}, err
	}
	if err = q.InsertOp(ctx, db.InsertOpParams{TripID: uid(op.TripId), ServerSeq: seq, OpID: uid(op.OpId), ActorUserID: uid(op.ActorUserId), SchemaVersion: int32(op.SchemaVersion), Entity: op.Entity, EntityID: uid(op.EntityId), Kind: string(op.Kind), Fields: encoded[3], BaseSeq: encoded[4], Changes: encoded[5], Conflicts: encoded[6], EntityDeleted: entityDeleted, ClientTime: timestamp(op.ClientTime), Origin: origin, VisibleToUserID: e.VisibleToUserID}); err != nil {
		return OpResult{}, err
	}
	r := OpResult{OpId: op.OpId, Status: Accepted, ServerSeq: &seq, Conflicts: &conflicts, EntityDeleted: &entityDeleted}
	if entityDeleted {
		v := uuid.UUID(e.DeletedBy.Bytes)
		r.DeletedBy = &v
	}
	return r, nil
}

func (s *Server) serverOp(ctx context.Context, q *db.Queries, trip uuid.UUID, entity string, id uuid.UUID, kind ClientOpKind, fields map[string]any) error {
	_, err := s.applyOp(ctx, q, ClientOp{OpId: uuid.New(), TripId: trip, ActorUserId: uuid.UUID(state(ctx).user.ID.Bytes), SchemaVersion: CurrentSchemaVersion, Entity: entity, EntityId: id, Kind: kind, Fields: fields, BaseSeq: map[string]int64{}, ClientTime: time.Now().UTC()}, "server")
	return err
}
func validateTrip(b TripBody) (pgtype.Date, pgtype.Date, error) {
	a, e := time.Parse("2006-01-02", b.StartDate)
	z, e2 := time.Parse("2006-01-02", b.EndDate)
	if e != nil || e2 != nil || z.Before(a) || z.Sub(a) > 90*24*time.Hour || !stringField(1, 200)(b.Name) || strings.TrimSpace(b.Name) == "" {
		return pgtype.Date{}, pgtype.Date{}, fail(400, "invalid_trip", "行程名称或日期非法，跨度最多 90 天")
	}
	if b.Timezone == "" || b.Timezone == "Local" {
		return pgtype.Date{}, pgtype.Date{}, fail(400, "invalid_timezone", "timezone 必须是 IANA 时区")
	}
	if _, e := time.LoadLocation(b.Timezone); e != nil {
		return pgtype.Date{}, pgtype.Date{}, fail(400, "invalid_timezone", "timezone 必须是 IANA 时区")
	}
	return pgtype.Date{Time: a, Valid: true}, pgtype.Date{Time: z, Valid: true}, nil
}
