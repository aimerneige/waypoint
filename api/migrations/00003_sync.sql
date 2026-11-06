-- +goose Up
CREATE TABLE trips (
 id uuid PRIMARY KEY, name text NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
 timezone text NOT NULL, base_currency text NOT NULL DEFAULT 'CNY' CHECK (base_currency='CNY'),
 owner_id uuid NOT NULL REFERENCES users(id), last_seq bigint NOT NULL DEFAULT 0 CHECK(last_seq>=0),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date>=start_date AND end_date-start_date<=90)
);
CREATE TABLE trip_members (
 trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('owner','member')),
 joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, PRIMARY KEY(trip_id,user_id)
);
CREATE INDEX trip_members_user ON trip_members(user_id,trip_id) WHERE left_at IS NULL;
CREATE TABLE invites (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id), expires_at timestamptz,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ops (
 trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE, server_seq bigint NOT NULL,
 op_id uuid NOT NULL UNIQUE, actor_user_id uuid NOT NULL REFERENCES users(id), schema_version integer NOT NULL,
 entity text NOT NULL, entity_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('create','update','delete','restore')),
 fields jsonb NOT NULL, base_seq jsonb NOT NULL, changes jsonb NOT NULL, conflicts jsonb NOT NULL,
 entity_deleted boolean NOT NULL, client_time timestamptz NOT NULL, server_time timestamptz NOT NULL DEFAULT now(),
 origin text NOT NULL CHECK(origin IN ('client','server')), visible_to_user_id uuid,
 PRIMARY KEY(trip_id,server_seq)
);
CREATE TABLE entity_state (
 trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE, entity text NOT NULL, entity_id uuid NOT NULL,
 fields jsonb NOT NULL, field_seq jsonb NOT NULL, field_actor jsonb NOT NULL,
 created_by uuid NOT NULL, created_seq bigint NOT NULL, updated_seq bigint NOT NULL,
 deleted boolean NOT NULL DEFAULT false, deleted_by uuid, deleted_seq bigint, visible_to_user_id uuid,
 PRIMARY KEY(trip_id,entity,entity_id)
);
CREATE TABLE rejected_ops (
 op_id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES users(id), code text NOT NULL, message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- +goose Down
DROP TABLE rejected_ops;
DROP TABLE entity_state;
DROP TABLE ops;
DROP TABLE invites;
DROP TABLE trip_members;
DROP TABLE trips;
