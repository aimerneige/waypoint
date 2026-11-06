-- +goose Up
CREATE TABLE app_meta (
    key text PRIMARY KEY,
    value text NOT NULL
);
INSERT INTO app_meta (key, value) VALUES ('schema', '1');

-- +goose Down
DROP TABLE app_meta;
