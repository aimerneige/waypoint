-- +goose Up
CREATE TABLE packing_templates (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,
 items jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX packing_templates_user_id ON packing_templates(user_id);

-- +goose Down
DROP TABLE packing_templates;
