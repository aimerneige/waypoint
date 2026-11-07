package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"waypoint/internal/db"
)

func templateBody(b *PackingTemplateBody) ([]byte, error) {
	if b == nil || !stringField(1, 100)(b.Name) || strings.TrimSpace(b.Name) == "" || b.Items == nil || len(b.Items) > 200 {
		return nil, fail(400, "invalid_request", "模板名称或项目数量非法（最多 200 项）")
	}
	for _, item := range b.Items {
		if !stringField(1, 100)(item.Name) || !stringField(0, 30)(item.Category) || !item.Scope.Valid() {
			return nil, fail(400, "invalid_request", "模板项目字段非法")
		}
	}
	return json.Marshal(b.Items)
}
func publicTemplate(row db.PackingTemplate) (PackingTemplate, error) {
	items, err := decode[[]PackingTemplateItem](row.Items)
	return PackingTemplate{Id: uuid.UUID(row.ID.Bytes), Name: row.Name, Items: items, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time}, err
}
func (s *Server) ListPackingTemplates(ctx context.Context, _ ListPackingTemplatesRequestObject) (ListPackingTemplatesResponseObject, error) {
	rows, err := s.queries.ListPackingTemplates(ctx, state(ctx).user.ID)
	if err != nil {
		return nil, err
	}
	out := ListPackingTemplates200JSONResponse{}
	for _, row := range rows {
		item, err := publicTemplate(row)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}
func (s *Server) CreatePackingTemplate(ctx context.Context, r CreatePackingTemplateRequestObject) (CreatePackingTemplateResponseObject, error) {
	items, err := templateBody(r.Body)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	// 用户行锁让并发创建也严格遵守每用户 50 个模板上限。
	if _, err = q.LockUser(ctx, state(ctx).user.ID); err != nil {
		return nil, err
	}
	count, err := q.CountPackingTemplates(ctx, state(ctx).user.ID)
	if err != nil {
		return nil, err
	}
	if count >= 50 {
		return nil, fail(400, "invalid_request", "每位用户最多保存 50 个模板")
	}
	row, err := q.CreatePackingTemplate(ctx, db.CreatePackingTemplateParams{ID: uid(uuid.New()), UserID: state(ctx).user.ID, Name: r.Body.Name, Items: items})
	if err != nil {
		return nil, err
	}
	out, err := publicTemplate(row)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return CreatePackingTemplate200JSONResponse(out), nil
}
func (s *Server) UpdatePackingTemplate(ctx context.Context, r UpdatePackingTemplateRequestObject) (UpdatePackingTemplateResponseObject, error) {
	items, err := templateBody(r.Body)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.UpdatePackingTemplate(ctx, db.UpdatePackingTemplateParams{ID: uid(r.Id), UserID: state(ctx).user.ID, Name: r.Body.Name, Items: items})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", "模板不存在")
	}
	if err != nil {
		return nil, err
	}
	out, err := publicTemplate(row)
	return UpdatePackingTemplate200JSONResponse(out), err
}
func (s *Server) DeletePackingTemplate(ctx context.Context, r DeletePackingTemplateRequestObject) (DeletePackingTemplateResponseObject, error) {
	n, err := s.queries.DeletePackingTemplate(ctx, db.DeletePackingTemplateParams{ID: uid(r.Id), UserID: state(ctx).user.ID})
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, fail(404, "not_found", "模板不存在")
	}
	return DeletePackingTemplate204Response{}, nil
}
