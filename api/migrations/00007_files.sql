-- +goose Up
CREATE TABLE files (
 id uuid PRIMARY KEY,
 trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 uploader_id uuid NOT NULL REFERENCES users(id),
 mime text NOT NULL,
 size bigint NOT NULL,
 sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_trip_id ON files(trip_id);

-- +goose Down
DROP TABLE files;
