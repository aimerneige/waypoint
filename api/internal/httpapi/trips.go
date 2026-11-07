package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"waypoint/internal/db"
)

func publicTrip(t db.Trip, role string) Trip {
	return Trip{Id: uuid.UUID(t.ID.Bytes), Name: t.Name, StartDate: t.StartDate.Time.Format("2006-01-02"), EndDate: t.EndDate.Time.Format("2006-01-02"), Timezone: t.Timezone, BaseCurrency: t.BaseCurrency, OwnerId: uuid.UUID(t.OwnerID.Bytes), LatestSeq: t.LastSeq, CreatedAt: t.CreatedAt.Time, Role: role}
}
func tripFields(t db.Trip) map[string]any {
	return map[string]any{"name": t.Name, "startDate": t.StartDate.Time.Format("2006-01-02"), "endDate": t.EndDate.Time.Format("2006-01-02"), "timezone": t.Timezone, "baseCurrency": t.BaseCurrency, "ownerId": uuid.UUID(t.OwnerID.Bytes).String()}
}
func memberFields(m db.TripMember, u db.User) map[string]any {
	var avatar, left any
	if u.AvatarUrl.Valid {
		avatar = u.AvatarUrl.String
	}
	if m.LeftAt.Valid {
		left = m.LeftAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return map[string]any{"userId": uuid.UUID(u.ID.Bytes).String(), "nickname": u.Nickname, "avatarUrl": avatar, "role": m.Role, "joinedAt": m.JoinedAt.Time.UTC().Format(time.RFC3339Nano), "leftAt": left}
}
func (s *Server) CreateTrip(ctx context.Context, r CreateTripRequestObject) (CreateTripResponseObject, error) {
	if r.Body == nil {
		return nil, fail(400, "invalid_request", "请填写行程信息")
	}
	a, z, err := validateTrip(*r.Body)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	u, err := q.LockUser(ctx, state(ctx).user.ID)
	if err != nil {
		return nil, err
	}
	t, err := q.CreateTrip(ctx, db.CreateTripParams{ID: uid(uuid.New()), Name: r.Body.Name, StartDate: a, EndDate: z, Timezone: r.Body.Timezone, OwnerID: u.ID})
	if err != nil {
		return nil, err
	}
	m, err := q.JoinMember(ctx, db.JoinMemberParams{TripID: t.ID, UserID: u.ID, Role: "owner"})
	if err != nil {
		return nil, err
	}
	id := uuid.UUID(t.ID.Bytes)
	if err = s.serverOp(ctx, q, id, "trip", id, ClientOpKindCreate, tripFields(t)); err != nil {
		return nil, err
	}
	if err = s.serverOp(ctx, q, id, "member", uuid.UUID(u.ID.Bytes), ClientOpKindCreate, memberFields(m, u)); err != nil {
		return nil, err
	}
	if err = s.serverOp(ctx, q, id, "trip_rates", id, ClientOpKindCreate, map[string]any{}); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	t.LastSeq = 3
	s.hub.notify(id)
	return CreateTrip200JSONResponse(publicTrip(t, "owner")), nil
}
func (s *Server) ListTrips(ctx context.Context, _ ListTripsRequestObject) (ListTripsResponseObject, error) {
	rows, err := s.queries.ListTrips(ctx, state(ctx).user.ID)
	if err != nil {
		return nil, err
	}
	out := []Trip{}
	for _, r := range rows {
		out = append(out, publicTrip(db.Trip{ID: r.ID, Name: r.Name, StartDate: r.StartDate, EndDate: r.EndDate, Timezone: r.Timezone, BaseCurrency: r.BaseCurrency, OwnerID: r.OwnerID, LastSeq: r.LastSeq, CreatedAt: r.CreatedAt}, r.Role))
	}
	return ListTrips200JSONResponse{Trips: out}, nil
}
func (s *Server) GetTrip(ctx context.Context, r GetTripRequestObject) (GetTripResponseObject, error) {
	t, m, e := s.membership(ctx, s.queries, r.TripId, false, false)
	if e != nil {
		return nil, e
	}
	return GetTrip200JSONResponse(publicTrip(t, m.Role)), nil
}
func (s *Server) PatchTrip(ctx context.Context, r PatchTripRequestObject) (PatchTripResponseObject, error) {
	if r.Body == nil {
		return nil, fail(400, "invalid_request", "请填写设置")
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	t, _, e := s.membership(ctx, q, r.TripId, true, true)
	if e != nil {
		return nil, e
	}
	b := TripBody{Name: t.Name, StartDate: t.StartDate.Time.Format("2006-01-02"), EndDate: t.EndDate.Time.Format("2006-01-02"), Timezone: t.Timezone}
	if r.Body.Name != nil {
		b.Name = *r.Body.Name
	}
	if r.Body.StartDate != nil {
		b.StartDate = *r.Body.StartDate
	}
	if r.Body.EndDate != nil {
		b.EndDate = *r.Body.EndDate
	}
	if r.Body.Timezone != nil {
		b.Timezone = *r.Body.Timezone
	}
	a, z, e := validateTrip(b)
	if e != nil {
		return nil, e
	}
	t.Name = b.Name
	t.StartDate = a
	t.EndDate = z
	t.Timezone = b.Timezone
	if e = q.UpdateTrip(ctx, db.UpdateTripParams{ID: t.ID, Name: t.Name, StartDate: a, EndDate: z, Timezone: t.Timezone, OwnerID: t.OwnerID}); e != nil {
		return nil, e
	}
	if e = s.serverOp(ctx, q, r.TripId, "trip", r.TripId, ClientOpKindUpdate, tripFields(t)); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	t.LastSeq++
	s.hub.notify(r.TripId)
	return PatchTrip200JSONResponse(publicTrip(t, "owner")), nil
}
func (s *Server) DeleteTrip(ctx context.Context, r DeleteTripRequestObject) (DeleteTripResponseObject, error) {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	if _, _, e = s.membership(ctx, q, r.TripId, true, true); e != nil {
		return nil, e
	}
	if e = q.DeleteTrip(ctx, uid(r.TripId)); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	s.hub.terminate(r.TripId, uuid.Nil, "trip_deleted")
	if e = s.storage.Delete(r.TripId.String(), ""); e != nil {
		return nil, e
	}
	return DeleteTrip200JSONResponse{Message: "行程已删除"}, nil
}
func (s *Server) TransferOwner(ctx context.Context, r TransferOwnerRequestObject) (TransferOwnerResponseObject, error) {
	if r.Body == nil {
		return nil, fail(400, "invalid_request", "请选择成员")
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	t, _, e := s.membership(ctx, q, r.TripId, true, true)
	if e != nil {
		return nil, e
	}
	target := uid(r.Body.UserId)
	m, e := q.GetMember(ctx, db.GetMemberParams{TripID: t.ID, UserID: target})
	if errors.Is(e, pgx.ErrNoRows) || (e == nil && m.LeftAt.Valid) {
		return nil, fail(400, "not_member", "目标不是当前成员")
	}
	if e != nil {
		return nil, e
	}
	if target == t.OwnerID {
		return TransferOwner200JSONResponse{Message: "owner 未改变"}, nil
	}
	if e = q.UpdateTrip(ctx, db.UpdateTripParams{ID: t.ID, Name: t.Name, StartDate: t.StartDate, EndDate: t.EndDate, Timezone: t.Timezone, OwnerID: target}); e != nil {
		return nil, e
	}
	if e = s.serverOp(ctx, q, r.TripId, "trip", r.TripId, ClientOpKindUpdate, map[string]any{"ownerId": r.Body.UserId.String()}); e != nil {
		return nil, e
	}
	for _, item := range []struct {
		id   pgtype.UUID
		role string
	}{{t.OwnerID, "member"}, {target, "owner"}} {
		if e = q.SetMemberRole(ctx, db.SetMemberRoleParams{TripID: t.ID, UserID: item.id, Role: item.role}); e != nil {
			return nil, e
		}
		if e = s.serverOp(ctx, q, r.TripId, "member", uuid.UUID(item.id.Bytes), ClientOpKindUpdate, map[string]any{"role": item.role}); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	s.hub.notify(r.TripId)
	return TransferOwner200JSONResponse{Message: "owner 已转让"}, nil
}
func (s *Server) leave(ctx context.Context, trip, target uuid.UUID, owner bool) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	t, _, e := s.membership(ctx, q, trip, owner, true)
	if e != nil {
		return e
	}
	if t.OwnerID == uid(target) {
		return fail(400, "owner_must_transfer", "owner 须先转让")
	}
	m, e := q.GetMember(ctx, db.GetMemberParams{TripID: t.ID, UserID: uid(target)})
	if errors.Is(e, pgx.ErrNoRows) || (e == nil && m.LeftAt.Valid) {
		return fail(400, "not_member", "目标不是当前成员")
	}
	if e != nil {
		return e
	}
	m, e = q.LeaveMember(ctx, db.LeaveMemberParams{TripID: t.ID, UserID: uid(target)})
	if e != nil {
		return e
	}
	if e = s.serverOp(ctx, q, trip, "member", target, ClientOpKindUpdate, map[string]any{"leftAt": m.LeftAt.Time.UTC().Format(time.RFC3339Nano)}); e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	s.hub.terminate(trip, target, "revoked")
	s.hub.notify(trip)
	return nil
}
func (s *Server) RemoveMember(ctx context.Context, r RemoveMemberRequestObject) (RemoveMemberResponseObject, error) {
	if e := s.leave(ctx, r.TripId, r.UserId, true); e != nil {
		return nil, e
	}
	return RemoveMember200JSONResponse{Message: "成员已移除"}, nil
}
func (s *Server) LeaveTrip(ctx context.Context, r LeaveTripRequestObject) (LeaveTripResponseObject, error) {
	if e := s.leave(ctx, r.TripId, uuid.UUID(state(ctx).user.ID.Bytes), false); e != nil {
		return nil, e
	}
	return LeaveTrip200JSONResponse{Message: "已退出行程"}, nil
}

func publicInvite(i db.Invite) Invite {
	return Invite{Id: uuid.UUID(i.ID.Bytes), TripId: uuid.UUID(i.TripID.Bytes), Token: i.Token, CreatedBy: uuid.UUID(i.CreatedBy.Bytes), CreatedAt: i.CreatedAt.Time, ExpiresAt: nullableValue(i.ExpiresAt.Time, i.ExpiresAt.Valid), RevokedAt: nullableValue(i.RevokedAt.Time, i.RevokedAt.Valid)}
}
func validInvite(i db.Invite) bool {
	return !i.RevokedAt.Valid && (!i.ExpiresAt.Valid || i.ExpiresAt.Time.After(time.Now()))
}
func (s *Server) CreateInvite(ctx context.Context, r CreateInviteRequestObject) (CreateInviteResponseObject, error) {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	if _, _, e = s.membership(ctx, q, r.TripId, true, true); e != nil {
		return nil, e
	}
	if !state(ctx).user.EmailVerifiedAt.Valid {
		return nil, fail(403, "email_not_verified", "请先验证邮箱")
	}
	expiry := pgtype.Timestamptz{}
	if r.Body != nil && r.Body.ExpiresInHours != nil {
		n := *r.Body.ExpiresInHours
		if n < 1 || n > 8760 {
			return nil, fail(400, "invalid_request", "有效期须为 1–8760 小时")
		}
		expiry = timestamp(time.Now().Add(time.Duration(n) * time.Hour))
	}
	i, e := q.CreateInvite(ctx, db.CreateInviteParams{ID: uid(uuid.New()), TripID: uid(r.TripId), Token: newToken(), CreatedBy: state(ctx).user.ID, ExpiresAt: expiry})
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return CreateInvite200JSONResponse(publicInvite(i)), nil
}
func (s *Server) ListInvites(ctx context.Context, r ListInvitesRequestObject) (ListInvitesResponseObject, error) {
	if _, _, e := s.membership(ctx, s.queries, r.TripId, true, false); e != nil {
		return nil, e
	}
	rows, e := s.queries.ListInvites(ctx, uid(r.TripId))
	if e != nil {
		return nil, e
	}
	out := []Invite{}
	for _, i := range rows {
		out = append(out, publicInvite(i))
	}
	return ListInvites200JSONResponse{Invites: out}, nil
}
func (s *Server) RevokeInvite(ctx context.Context, r RevokeInviteRequestObject) (RevokeInviteResponseObject, error) {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	if _, _, e = s.membership(ctx, q, r.TripId, true, true); e != nil {
		return nil, e
	}
	n, e := q.RevokeInvite(ctx, db.RevokeInviteParams{TripID: uid(r.TripId), ID: uid(r.InviteId)})
	if e != nil {
		return nil, e
	}
	if n == 0 {
		return nil, fail(404, "invite_not_found", "邀请不存在")
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return RevokeInvite200JSONResponse{Message: "邀请已作废"}, nil
}
func (s *Server) PreviewInvite(ctx context.Context, r PreviewInviteRequestObject) (PreviewInviteResponseObject, error) {
	i, e := s.queries.GetInvite(ctx, r.Token)
	if errors.Is(e, pgx.ErrNoRows) {
		return PreviewInvite200JSONResponse{Valid: false}, nil
	}
	if e != nil {
		return nil, e
	}
	t, e := s.queries.GetTrip(ctx, i.TripID)
	if errors.Is(e, pgx.ErrNoRows) {
		return PreviewInvite200JSONResponse{Valid: false}, nil
	}
	if e != nil {
		return nil, e
	}
	u, e := s.queries.UserByID(ctx, t.OwnerID)
	if e != nil {
		return nil, e
	}
	return PreviewInvite200JSONResponse{TripName: t.Name, OwnerNickname: u.Nickname, Valid: validInvite(i)}, nil
}
func (s *Server) AcceptInvite(ctx context.Context, r AcceptInviteRequestObject) (AcceptInviteResponseObject, error) {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	u, e := q.LockUser(ctx, state(ctx).user.ID)
	if e != nil {
		return nil, e
	}
	i, e := q.GetInvite(ctx, r.Token)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fail(400, "invalid_invite", "邀请无效或已过期")
	}
	if e != nil {
		return nil, e
	}
	t, e := q.LockTrip(ctx, i.TripID)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fail(404, "trip_not_found", "行程不存在")
	}
	if e != nil {
		return nil, e
	}
	m, e := q.GetMember(ctx, db.GetMemberParams{TripID: t.ID, UserID: u.ID})
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	if e == nil && !m.LeftAt.Valid {
		return AcceptInvite200JSONResponse(publicTrip(t, m.Role)), nil
	}
	i, e = q.GetInvite(ctx, r.Token)
	if e != nil {
		return nil, e
	}
	if !validInvite(i) {
		return nil, fail(400, "invalid_invite", "邀请无效或已过期")
	}
	rejoin := m.LeftAt.Valid
	m, e = q.JoinMember(ctx, db.JoinMemberParams{TripID: t.ID, UserID: u.ID, Role: "member"})
	if e != nil {
		return nil, e
	}
	trip := uuid.UUID(t.ID.Bytes)
	user := uuid.UUID(u.ID.Bytes)
	if rejoin {
		if e = s.serverOp(ctx, q, trip, "member", user, ClientOpKindRestore, map[string]any{}); e != nil {
			return nil, e
		}
	}
	kind := ClientOpKindCreate
	if rejoin {
		kind = ClientOpKindUpdate
	}
	if e = s.serverOp(ctx, q, trip, "member", user, kind, memberFields(m, u)); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	t.LastSeq++
	if rejoin {
		t.LastSeq++
	}
	s.hub.notify(trip)
	return AcceptInvite200JSONResponse(publicTrip(t, "member")), nil
}
