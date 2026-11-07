-- name: GetFile :one
SELECT * FROM files WHERE id=$1;
-- name: InsertFile :exec
INSERT INTO files(id,trip_id,uploader_id,mime,size,sha256) VALUES($1,$2,$3,$4,$5,$6);
-- name: CanReadFile :one
SELECT EXISTS(SELECT 1 FROM entity_state WHERE trip_id=$1 AND entity='voucher' AND NOT deleted AND fields->>'fileId'=sqlc.arg(file_id)::text AND (visible_to_user_id IS NULL OR visible_to_user_id=sqlc.arg(user_id)))::boolean;
-- name: OrphanFiles :many
SELECT f.* FROM files f WHERE f.created_at < $1 AND NOT EXISTS(SELECT 1 FROM entity_state e WHERE e.trip_id=f.trip_id AND e.entity='voucher' AND e.fields->>'fileId'=f.id::text);
-- name: DeleteFile :exec
DELETE FROM files WHERE id=$1;
