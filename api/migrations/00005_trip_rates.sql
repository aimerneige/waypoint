-- +goose Up
WITH added AS (
 UPDATE trips t SET last_seq = last_seq + 1
 WHERE NOT EXISTS (SELECT 1 FROM entity_state e WHERE e.trip_id=t.id AND e.entity='trip_rates' AND e.entity_id=t.id)
 RETURNING id, owner_id, last_seq
), states AS (
 INSERT INTO entity_state(trip_id,entity,entity_id,fields,field_seq,field_actor,created_by,created_seq,updated_seq)
 SELECT id,'trip_rates',id,'{}','{}','{}',owner_id,last_seq,last_seq FROM added
 RETURNING trip_id,created_by,created_seq
)
INSERT INTO ops(trip_id,server_seq,op_id,actor_user_id,schema_version,entity,entity_id,kind,fields,base_seq,changes,conflicts,entity_deleted,client_time,origin)
SELECT trip_id,created_seq,gen_random_uuid(),created_by,1,'trip_rates',trip_id,'create','{}','{}','{}','[]',false,now(),'server' FROM states;

-- +goose Down
-- 已发布的同步序号与操作日志不可回退，保留补建实体。
SELECT 1;
