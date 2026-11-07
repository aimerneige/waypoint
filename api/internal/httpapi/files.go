package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"waypoint/internal/db"
)

func logFileError(err error) { slog.Error("File operation failed", "error", err) }
func fileMime(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return "application/pdf"
	case bytes.HasPrefix(b, []byte{0x89, 'P', 'N', 'G', 13, 10, 26, 10}):
		return "image/png"
	case bytes.HasPrefix(b, []byte{0xff, 0xd8, 0xff}):
		return "image/jpeg"
	}
	return ""
}
func (s *Server) UploadFile(ctx context.Context, r UploadFileRequestObject) (UploadFileResponseObject, error) {
	if _, _, err := s.membership(ctx, s.queries, r.TripId, false, false); err != nil {
		return nil, err
	}
	if r.FileId == uuid.Nil {
		return nil, fail(400, "invalid_request", "fileId 无效")
	}
	mime := state(ctx).r.Header.Get("Content-Type")
	if mime != "application/pdf" && mime != "image/png" && mime != "image/jpeg" {
		return nil, fail(415, "unsupported_media_type", "格式不支持或文件头与 MIME 不符")
	}
	var header [512]byte
	n, err := io.ReadFull(r.Body, header[:])
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		if isBodyTooLarge(err) {
			return nil, fail(413, "payload_too_large", "请求体过大")
		}
		return nil, fail(400, "invalid_request", "请求体读取失败")
	}
	if fileMime(header[:n]) != mime {
		return nil, fail(415, "unsupported_media_type", "格式不支持或文件头与 MIME 不符")
	}
	sum := sha256.New()
	staged, err := s.storage.Stage(io.TeeReader(io.MultiReader(bytes.NewReader(header[:n]), r.Body), sum))
	if err != nil {
		if isBodyTooLarge(err) {
			return nil, fail(413, "payload_too_large", "请求体过大")
		}
		return nil, err
	}
	defer func() {
		if err := staged.Discard(); err != nil {
			logFileError(err)
		}
	}()
	hash := hex.EncodeToString(sum.Sum(nil))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	if err = q.LockOpID(ctx, "file:"+r.FileId.String()); err != nil {
		return nil, err
	}
	// 接收文件期间成员可能已退出或行程已删除，提交前重新校验，但不锁行程行。
	if _, _, err = s.membership(ctx, q, r.TripId, false, false); err != nil {
		return nil, err
	}
	old, err := q.GetFile(ctx, uid(r.FileId))
	if err == nil {
		if old.TripID != uid(r.TripId) || old.UploaderID != state(ctx).user.ID || old.Sha256 != hash {
			return nil, fail(409, "file_conflict", "文件冲突")
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	} else {
		if err = q.InsertFile(ctx, db.InsertFileParams{ID: uid(r.FileId), TripID: uid(r.TripId), UploaderID: state(ctx).user.ID, Mime: mime, Size: staged.Size(), Sha256: hash}); err != nil {
			return nil, err
		}
		if err = staged.Commit(r.TripId.String(), r.FileId.String()); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return UploadFile200JSONResponse{Sha256: hash}, nil
}
func (s *Server) signature(file uuid.UUID, exp int64, user uuid.UUID) string {
	h := hmac.New(sha256.New, []byte(s.config.SigningKey))
	// hash.Hash.Write 不返回错误。
	_, _ = fmt.Fprintf(h, "%s|%d|%s", file, exp, user)
	return hex.EncodeToString(h.Sum(nil))
}
func (s *Server) FileLink(ctx context.Context, r FileLinkRequestObject) (FileLinkResponseObject, error) {
	if _, _, err := s.membership(ctx, s.queries, r.TripId, false, false); err != nil {
		return nil, err
	}
	f, err := s.queries.GetFile(ctx, uid(r.FileId))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", "文件不存在")
	}
	if err != nil {
		return nil, err
	}
	if f.TripID != uid(r.TripId) {
		return nil, fail(404, "not_found", "文件不存在")
	}
	allowed, err := s.queries.CanReadFile(ctx, db.CanReadFileParams{TripID: uid(r.TripId), FileID: r.FileId.String(), UserID: state(ctx).user.ID})
	if err != nil {
		return nil, err
	}
	if !allowed && f.UploaderID != state(ctx).user.ID {
		return nil, fail(403, "forbidden_field", "无法访问此文件")
	}
	user := uuid.UUID(state(ctx).user.ID.Bytes)
	exp := time.Now().Add(5 * time.Minute).Unix()
	return FileLink200JSONResponse{Url: fmt.Sprintf("/api/files/%s?exp=%d&sig=%s&u=%s", r.FileId, exp, s.signature(r.FileId, exp, user), user), Sha256: f.Sha256}, nil
}

type fileResponse struct {
	s *Server
	r *http.Request
	f db.File
}

func (r fileResponse) VisitDownloadFileResponse(w http.ResponseWriter) error {
	f, err := r.s.storage.Open(uuid.UUID(r.f.TripID.Bytes).String(), uuid.UUID(r.f.ID.Bytes).String())
	if err != nil {
		return err
	}
	defer func() {
		if err := f.Close(); err != nil {
			logFileError(err)
		}
	}()
	w.Header().Set("Content-Type", r.f.Mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Security-Policy", "sandbox")
	http.ServeContent(w, r.r, "", r.f.CreatedAt.Time, f)
	return nil
}
func (s *Server) DownloadFile(ctx context.Context, r DownloadFileRequestObject) (DownloadFileResponseObject, error) {
	p := r.Params
	expected := s.signature(r.FileId, p.Exp, p.U)
	if p.Exp <= time.Now().Unix() || p.Exp > time.Now().Add(5*time.Minute).Unix() || !hmac.Equal([]byte(expected), []byte(p.Sig)) {
		return nil, fail(403, "invalid_signature", "下载链接无效或已过期")
	}
	f, err := s.queries.GetFile(ctx, uid(r.FileId))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", "文件不存在")
	}
	if err != nil {
		return nil, err
	}
	return fileResponse{s, state(ctx).r, f}, nil
}
func (s *Server) cleanOrphanFiles(ctx context.Context, now time.Time) error {
	rows, err := s.queries.OrphanFiles(ctx, pgtype.Timestamptz{Time: now.Add(-24 * time.Hour), Valid: true})
	if err != nil {
		return err
	}
	for _, f := range rows {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		// 与上传、创建凭证共用行程锁，清理过程中不会出现新引用。
		_, err = q.LockTrip(ctx, f.TripID)
		if errors.Is(err, pgx.ErrNoRows) {
			rollback(ctx, tx)
			continue
		}
		if err != nil {
			rollback(ctx, tx)
			return err
		}
		var referenced bool
		err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM entity_state WHERE trip_id=$1 AND entity='voucher' AND fields->>'fileId'=$2)", f.TripID, uuid.UUID(f.ID.Bytes).String()).Scan(&referenced)
		if err == nil && !referenced {
			err = s.storage.Delete(uuid.UUID(f.TripID.Bytes).String(), uuid.UUID(f.ID.Bytes).String())
			if err == nil {
				err = q.DeleteFile(ctx, f.ID)
			}
		}
		if err != nil {
			rollback(ctx, tx)
			return err
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) startFileCleanup() func() {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		timer := time.NewTicker(time.Hour)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-timer.C:
				if err := s.cleanOrphanFiles(ctx, now); err != nil && ctx.Err() == nil {
					logFileError(err)
				}
			}
		}
	}()
	return func() { cancel(); <-done }
}
