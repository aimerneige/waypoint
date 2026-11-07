-- name: LockTrip :one
SELECT * FROM trips WHERE id=$1 FOR UPDATE;

-- name: AllTripMembers :many
SELECT * FROM trip_members WHERE trip_id=$1;
-- name: GetTrip :one
SELECT * FROM trips WHERE id=$1;
-- name: CreateTrip :one
INSERT INTO trips(id,name,start_date,end_date,timezone,owner_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: UpdateTrip :exec
UPDATE trips SET name=$2,start_date=$3,end_date=$4,timezone=$5,owner_id=$6 WHERE id=$1;
-- name: DeleteTrip :exec
DELETE FROM trips WHERE id=$1;
-- name: NextSeq :one
UPDATE trips SET last_seq=last_seq+1 WHERE id=$1 RETURNING last_seq;
-- name: ListTrips :many
SELECT t.*,m.role FROM trips t JOIN trip_members m ON m.trip_id=t.id WHERE m.user_id=$1 AND m.left_at IS NULL ORDER BY t.id;
-- name: GetMember :one
SELECT * FROM trip_members WHERE trip_id=$1 AND user_id=$2;
-- name: JoinMember :one
INSERT INTO trip_members(trip_id,user_id,role) VALUES($1,$2,$3)
ON CONFLICT(trip_id,user_id) DO UPDATE SET left_at=NULL,joined_at=now(),role=excluded.role RETURNING *;
-- name: SetMemberRole :exec
UPDATE trip_members SET role=$3 WHERE trip_id=$1 AND user_id=$2;
-- name: LeaveMember :one
UPDATE trip_members SET left_at=now() WHERE trip_id=$1 AND user_id=$2 RETURNING *;
-- name: CreateInvite :one
INSERT INTO invites(id,trip_id,token,created_by,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *;
-- name: GetInvite :one
SELECT * FROM invites WHERE token=$1;
-- name: ListInvites :many
SELECT * FROM invites WHERE trip_id=$1 ORDER BY created_at,id;
-- name: RevokeInvite :execrows
UPDATE invites SET revoked_at=COALESCE(revoked_at,now()) WHERE trip_id=$1 AND id=$2;
-- name: GetEntity :one
SELECT * FROM entity_state WHERE trip_id=$1 AND entity=$2 AND entity_id=$3;
-- name: SaveEntity :exec
INSERT INTO entity_state(trip_id,entity,entity_id,fields,field_seq,field_actor,created_by,created_seq,updated_seq,deleted,deleted_by,deleted_seq,visible_to_user_id)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
ON CONFLICT(trip_id,entity,entity_id) DO UPDATE SET fields=excluded.fields,field_seq=excluded.field_seq,field_actor=excluded.field_actor,updated_seq=excluded.updated_seq,deleted=excluded.deleted,deleted_by=excluded.deleted_by,deleted_seq=excluded.deleted_seq;
-- name: ListEntities :many
SELECT * FROM entity_state WHERE trip_id=$1 AND (visible_to_user_id IS NULL OR visible_to_user_id=sqlc.arg(user_id)) ORDER BY entity,entity_id;
-- name: GetOp :one
SELECT * FROM ops WHERE op_id=$1;
-- name: GetRejected :one
SELECT * FROM rejected_ops WHERE op_id=$1;
-- name: RejectOp :exec
INSERT INTO rejected_ops(op_id,trip_id,actor_user_id,code,message) VALUES($1,$2,$3,$4,$5);
-- name: InsertOp :exec
INSERT INTO ops(trip_id,server_seq,op_id,actor_user_id,schema_version,entity,entity_id,kind,fields,base_seq,changes,conflicts,entity_deleted,client_time,origin,visible_to_user_id)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16);
-- name: PullOps :many
SELECT * FROM ops WHERE trip_id=$1 AND server_seq>sqlc.arg(after_seq) AND (visible_to_user_id IS NULL OR visible_to_user_id=sqlc.arg(user_id)) ORDER BY server_seq LIMIT sqlc.arg(row_limit);
-- name: HistoryOps :many
SELECT * FROM ops WHERE trip_id=$1 AND (sqlc.arg(entity_filter)::text='' OR entity=sqlc.arg(entity_filter)) AND (sqlc.narg(entity_id_filter)::uuid IS NULL OR entity_id=sqlc.narg(entity_id_filter)) AND server_seq<sqlc.arg(before_seq) AND (visible_to_user_id IS NULL OR visible_to_user_id=sqlc.arg(user_id)) ORDER BY server_seq DESC LIMIT sqlc.arg(row_limit);
-- name: LockOpID :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(op_id)::text,0));

