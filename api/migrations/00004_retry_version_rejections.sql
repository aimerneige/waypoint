-- +goose Up
-- 旧实现缓存的版本拒绝不能阻止升级后的同一操作重试。
DELETE FROM rejected_ops WHERE code IN ('upgrade_required', 'server_outdated');

-- +goose Down
-- 版本拒绝不属于持久业务数据，无需恢复。
