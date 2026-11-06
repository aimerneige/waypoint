package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"waypoint/internal/db"
)

func (s *Server) PushOps(ctx context.Context, r PushOpsRequestObject) (PushOpsResponseObject, error) {
	if _, _, e := s.membership(ctx, s.queries, r.TripId, false, false); e != nil {
		return nil, e
	}
	if r.Body == nil || len(r.Body.Ops) > 200 {
		return nil, fail(400, "invalid_request", "ops 最多 200 条")
	}
	out := []OpResult{}
	for _, op := range r.Body.Ops {
		result, e := s.pushOne(ctx, r.TripId, op)
		if e != nil {
			return nil, e
		}
		out = append(out, result)
	}
	// 整批都因版本不兼容被拒绝时，使用整体升级错误；混合批次仍逐条返回。
	if len(out) > 0 {
		allVersions := true
		for _, result := range out {
			if result.Error == nil || (result.Error.Code != "upgrade_required" && result.Error.Code != "server_outdated") {
				allVersions = false
				break
			}
		}
		if allVersions {
			return nil, fail(426, out[0].Error.Code, out[0].Error.Message)
		}
	}
	return PushOps200JSONResponse{Results: out}, nil
}
func fullOp(o db.Op) (FullOp, error) {
	r := FullOp{OpId: uuid.UUID(o.OpID.Bytes), TripId: uuid.UUID(o.TripID.Bytes), ActorUserId: uuid.UUID(o.ActorUserID.Bytes), SchemaVersion: int(o.SchemaVersion), Entity: o.Entity, EntityId: uuid.UUID(o.EntityID.Bytes), Kind: FullOpKind(o.Kind), ClientTime: o.ClientTime.Time, ServerTime: o.ServerTime.Time, ServerSeq: o.ServerSeq, Origin: FullOpOrigin(o.Origin), EntityDeleted: o.EntityDeleted}
	var e error
	if r.Fields, e = decode[map[string]any](o.Fields); e != nil {
		return r, e
	}
	if r.BaseSeq, e = decode[map[string]int64](o.BaseSeq); e != nil {
		return r, e
	}
	if r.Changes, e = decode[map[string]Change](o.Changes); e != nil {
		return r, e
	}
	r.Conflicts, e = decode[[]Conflict](o.Conflicts)
	return r, e
}
func fullOps(rows []db.Op) ([]FullOp, error) {
	out := []FullOp{}
	for _, r := range rows {
		o, e := fullOp(r)
		if e != nil {
			return nil, e
		}
		out = append(out, o)
	}
	return out, nil
}
func pageLimit(n *int) (int32, error) {
	if n == nil {
		return 500, nil
	}
	if *n < 1 || *n > 500 {
		return 0, fail(400, "invalid_request", "limit 须为 1–500")
	}
	return int32(*n), nil
}
func (s *Server) PullOps(ctx context.Context, r PullOpsRequestObject) (PullOpsResponseObject, error) {
	limit, e := pageLimit(r.Params.Limit)
	if e != nil {
		return nil, e
	}
	after := int64(0)
	if r.Params.After != nil {
		after = *r.Params.After
	}
	if after < 0 {
		return nil, fail(400, "invalid_request", "after 不可为负数")
	}
	tx, e := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	t, _, e := s.membership(ctx, q, r.TripId, false, false)
	if e != nil {
		return nil, e
	}
	rows, e := q.PullOps(ctx, db.PullOpsParams{TripID: t.ID, AfterSeq: after, UserID: state(ctx).user.ID, RowLimit: limit + 1})
	if e != nil {
		return nil, e
	}
	more := len(rows) > int(limit)
	if more {
		rows = rows[:limit]
	}
	out, e := fullOps(rows)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return PullOps200JSONResponse{Ops: out, LatestSeq: t.LastSeq, HasMore: more}, nil
}
func publicEntity(e db.EntityState) (EntityState, error) {
	r := EntityState{Entity: e.Entity, EntityId: uuid.UUID(e.EntityID.Bytes), CreatedBy: uuid.UUID(e.CreatedBy.Bytes), CreatedSeq: e.CreatedSeq, UpdatedSeq: e.UpdatedSeq, Deleted: e.Deleted, DeletedBy: nullableValue(uuid.UUID(e.DeletedBy.Bytes), e.DeletedBy.Valid), DeletedSeq: nullableValue(e.DeletedSeq.Int64, e.DeletedSeq.Valid)}
	var err error
	if r.Fields, err = decode[map[string]any](e.Fields); err != nil {
		return r, err
	}
	if r.FieldSeq, err = decode[map[string]int64](e.FieldSeq); err != nil {
		return r, err
	}
	r.FieldActor, err = decode[map[string]uuid.UUID](e.FieldActor)
	return r, err
}
func (s *Server) GetSnapshot(ctx context.Context, r GetSnapshotRequestObject) (GetSnapshotResponseObject, error) {
	tx, e := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	t, m, e := s.membership(ctx, q, r.TripId, false, false)
	if e != nil {
		return nil, e
	}
	rows, e := q.ListEntities(ctx, db.ListEntitiesParams{TripID: t.ID, UserID: state(ctx).user.ID})
	if e != nil {
		return nil, e
	}
	out := Snapshot{Seq: t.LastSeq, Trip: publicTrip(t, m.Role), Members: []Member{}, Entities: []EntityState{}}
	for _, row := range rows {
		entity, err := publicEntity(row)
		if err != nil {
			return nil, err
		}
		out.Entities = append(out.Entities, entity)
	}
	// 成员资料取实体状态，确保与同步日志、快照游标一致。
	for _, entity := range out.Entities {
		if entity.Entity != "member" {
			continue
		}
		b, err := json.Marshal(entity.Fields)
		if err != nil {
			return nil, err
		}
		member, err := decode[Member](b)
		if err != nil {
			return nil, err
		}
		out.Members = append(out.Members, member)
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return GetSnapshot200JSONResponse(out), nil
}
func (s *Server) GetHistory(ctx context.Context, r GetHistoryRequestObject) (GetHistoryResponseObject, error) {
	if _, _, e := s.membership(ctx, s.queries, r.TripId, false, false); e != nil {
		return nil, e
	}
	limit, e := pageLimit(r.Params.Limit)
	if e != nil {
		return nil, e
	}
	before := int64(math.MaxInt64)
	if r.Params.Before != nil {
		before = *r.Params.Before
	}
	if before < 1 {
		return nil, fail(400, "invalid_request", "before 须大于零")
	}
	entity := ""
	if r.Params.Entity != nil {
		entity = *r.Params.Entity
	}
	id := pgtype.UUID{}
	if r.Params.EntityId != nil {
		id = uid(*r.Params.EntityId)
	}
	rows, e := s.queries.HistoryOps(ctx, db.HistoryOpsParams{TripID: uid(r.TripId), EntityFilter: entity, EntityIDFilter: id, BeforeSeq: before, UserID: state(ctx).user.ID, RowLimit: limit})
	if e != nil {
		return nil, e
	}
	out, e := fullOps(rows)
	if e != nil {
		return nil, e
	}
	return GetHistory200JSONResponse{Ops: out}, nil
}
func (s *Server) profileOps(ctx context.Context, q *db.Queries, u db.User) ([]uuid.UUID, error) {
	trips, e := q.ListTrips(ctx, u.ID)
	if e != nil {
		return nil, e
	}
	ids := []uuid.UUID{}
	for _, trip := range trips {
		if _, e = q.LockTrip(ctx, trip.ID); errors.Is(e, pgx.ErrNoRows) {
			continue
		} else if e != nil {
			return nil, e
		}
		m, err := q.GetMember(ctx, db.GetMemberParams{TripID: trip.ID, UserID: u.ID})
		if err != nil {
			return nil, err
		}
		if m.LeftAt.Valid {
			continue
		}
		var avatar any
		if u.AvatarUrl.Valid {
			avatar = u.AvatarUrl.String
		}
		id := uuid.UUID(trip.ID.Bytes)
		if e = s.serverOp(ctx, q, id, "member", uuid.UUID(u.ID.Bytes), ClientOpKindUpdate, map[string]any{"nickname": u.Nickname, "avatarUrl": avatar}); e != nil {
			return nil, e
		}
		ids = append(ids, id)
	}
	return ids, nil
}
