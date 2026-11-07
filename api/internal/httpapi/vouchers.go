package httpapi

import (
	"context"
	"errors"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"waypoint/internal/db"
)

func init() {
	base := entities["itinerary_item"]
	entities["voucher"] = EntityDef{Name: "voucher", Kinds: base.Kinds, Permission: base.Permission, Fields: map[string]FieldDef{
		"type":       {Required: true, Validate: choice("flight", "hotel", "ticket", "visa", "insurance", "other")},
		"title":      {Required: true, Validate: stringField(1, 200)},
		"fileId":     {Required: true, Validate: validUUID},
		"mime":       {Required: true, Validate: choice("application/pdf", "image/jpeg", "image/png")},
		"size":       {Required: true, Validate: func(v any) bool { n, ok := v.(float64); return ok && n > 0 && n == math.Trunc(n) }},
		"visibility": {Required: true, Validate: choice("trip", "private")},
		"note":       {Nullable: true, Validate: stringField(0, 500)},
	}}
}

func (s *Server) validateVoucher(ctx context.Context, q *db.Queries, op ClientOp, e db.EntityState, fields map[string]any) error {
	if op.Entity != "voucher" {
		return nil
	}
	if op.Kind != ClientOpKindCreate {
		if _, ok := op.Fields["visibility"]; ok {
			return fail(400, "invalid_op", "可见性仅可在创建时设置")
		}
		m, err := q.GetMember(ctx, db.GetMemberParams{TripID: uid(op.TripId), UserID: uid(op.ActorUserId)})
		if err != nil {
			return err
		}
		if e.CreatedBy != uid(op.ActorUserId) && !(op.Kind == ClientOpKindDelete && m.Role == "owner" && fields["visibility"] == "trip") {
			return fail(400, "forbidden_field", "仅上传者可修改凭证")
		}
	}
	if op.Kind == ClientOpKindDelete || op.Kind == ClientOpKindRestore {
		return nil
	}
	merged := map[string]any{}
	for k, v := range fields {
		merged[k] = v
	}
	for k, v := range op.Fields {
		merged[k] = v
	}
	f, err := q.GetFile(ctx, uid(uuid.MustParse(merged["fileId"].(string))))
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(400, "invalid_op", "凭证文件尚未上传")
	}
	if err != nil {
		return err
	}
	if f.TripID != uid(op.TripId) || f.UploaderID != uid(op.ActorUserId) || f.Mime != merged["mime"] || float64(f.Size) != merged["size"] {
		return fail(400, "invalid_op", "文件与凭证信息不一致")
	}
	return nil
}
