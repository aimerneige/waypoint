-- +goose Up
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (email = lower(email)),
 password_hash text NOT NULL,
 nickname text NOT NULL,
 avatar_url text,
 email_verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 user_agent text NOT NULL,
 ip text NOT NULL
);
CREATE INDEX sessions_user_id ON sessions(user_id);
CREATE TABLE email_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
 token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_id ON email_tokens(user_id);
CREATE TABLE login_failures (
 email text PRIMARY KEY,
 failures integer NOT NULL DEFAULT 0,
 locked_until timestamptz
);
-- +goose Down
DROP TABLE login_failures;
DROP TABLE email_tokens;
DROP TABLE sessions;
DROP TABLE users;
