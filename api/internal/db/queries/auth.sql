-- name: CreateUser :one
INSERT INTO users (email,password_hash,nickname) VALUES ($1,$2,$3) RETURNING *;
-- name: UserByEmail :one
SELECT * FROM users WHERE email=$1;
-- name: UserByID :one
SELECT * FROM users WHERE id=$1;
-- name: LockUser :one
SELECT * FROM users WHERE id=$1 FOR UPDATE;
-- name: UpdateProfile :one
UPDATE users SET nickname=$2, avatar_url=$3, updated_at=now() WHERE id=$1 RETURNING *;
-- name: SetPassword :exec
UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1;
-- name: VerifyUser :exec
UPDATE users SET email_verified_at=coalesce(email_verified_at,now()), updated_at=now() WHERE id=$1;
-- name: CreateSession :one
INSERT INTO sessions (user_id,token_hash,expires_at,user_agent,ip) VALUES ($1,$2,$3,$4,$5) RETURNING *;
-- name: SessionByHash :one
SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now();
-- name: RenewSession :one
UPDATE sessions SET last_seen_at=now(), expires_at=now()+interval '30 days' WHERE id=$1 AND expires_at>now() AND last_seen_at<now()-interval '24 hours' RETURNING *;
-- name: DeleteSession :exec
DELETE FROM sessions WHERE id=$1;
-- name: DeleteUserSessions :exec
DELETE FROM sessions WHERE user_id=$1;
-- name: DeleteOtherSessions :exec
DELETE FROM sessions WHERE user_id=$1 AND id<>$2;
-- name: InvalidateEmailTokens :exec
UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL;
-- name: CreateEmailToken :exec
INSERT INTO email_tokens (user_id,purpose,token_hash,expires_at) VALUES ($1,$2,$3,$4);
-- name: EmailTokenByHash :one
SELECT * FROM email_tokens WHERE token_hash=$1 AND purpose=$2;
-- name: ConsumeEmailToken :one
UPDATE email_tokens SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at>now() RETURNING *;
-- name: EnsureLoginFailures :exec
INSERT INTO login_failures (email) VALUES ($1) ON CONFLICT DO NOTHING;
-- name: LockLoginFailures :one
SELECT * FROM login_failures WHERE email=$1 FOR UPDATE;
-- name: RecordLoginFailure :one
UPDATE login_failures SET failures=CASE WHEN locked_until<=now() THEN 1 ELSE failures+1 END,
 locked_until=CASE WHEN locked_until<=now() THEN NULL WHEN failures+1>=10 THEN now()+interval '15 minutes' ELSE NULL END
 WHERE email=$1 RETURNING *;
-- name: ClearLoginFailures :exec
DELETE FROM login_failures WHERE email=$1;
