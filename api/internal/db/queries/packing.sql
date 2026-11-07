-- name: ListPackingTemplates :many
SELECT * FROM packing_templates WHERE user_id=$1 ORDER BY created_at,id;
-- name: CountPackingTemplates :one
SELECT count(*) FROM packing_templates WHERE user_id=$1;
-- name: CreatePackingTemplate :one
INSERT INTO packing_templates(id,user_id,name,items) VALUES($1,$2,$3,$4) RETURNING *;
-- name: UpdatePackingTemplate :one
UPDATE packing_templates SET name=$3,items=$4,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *;
-- name: DeletePackingTemplate :execrows
DELETE FROM packing_templates WHERE id=$1 AND user_id=$2;
