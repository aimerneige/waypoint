-- name: GetAppMeta :one
SELECT value FROM app_meta WHERE key = $1;
