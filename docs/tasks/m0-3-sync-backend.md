# 任务 M0.3：后端同步协议 + 行程 / 成员 / 邀请 + ItineraryItem

前置：M0.1、M0.2 已完成。先阅读 `spec.md` 第 1.2、1.3、2、3 节，`docs/decisions.md`（尤其 D3、D12），以及现有 `api/` 代码，沿用其约定（strict server、sqlc、统一错误体、鉴权中间件、CSRF）。
本任务只做**后端**（含 OpenAPI 与 `make gen` 后的前端类型），并编写协议文档 `docs/sync-protocol.md`（中文，供前端实现依据）。

## 1. 核心设计（必须按此实现）

### 1.1 序号
- `serverSeq` **按行程递增**（每个行程从 1 开始、无空洞）。分配方式：在事务中 `SELECT ... FROM trips WHERE id=$1 FOR UPDATE` 锁定行程行，`last_seq + 1` 后写回。这样同一行程的 op 串行提交，拉取方按 seq 游标读取不会漏数据。**不要用全局 bigserial**（并发事务乱序提交会导致拉取漏读）。

### 1.2 表
- `trips`：id、name、start_date、end_date、timezone（IANA）、base_currency 固定 'CNY'、owner_id、last_seq、created_at。
- `trip_members`：trip_id、user_id、role（owner|member）、joined_at、left_at null。主键 (trip_id, user_id)；重新加入时清空 left_at。
- `invites`：id、trip_id、token（随机 22+ 字符 base64url，唯一）、created_by、expires_at null、revoked_at null、created_at。
- `ops`：trip_id、server_seq（主键 (trip_id, server_seq)）、op_id uuid 全局唯一、actor_user_id、schema_version、entity、entity_id、kind、fields jsonb、base_seq jsonb、changes jsonb（{字段: {old, new}}，用于修改记录）、conflicts jsonb（见 1.4）、entity_deleted bool（对已删除实体的 update）、client_time、server_time、origin（client|server）、visible_to_user_id uuid null（为 M4 私有凭证预留：非空时只有该用户能拉到）。
- `entity_state`：主键 (trip_id, entity, entity_id)；fields jsonb（当前值）、field_seq jsonb（{字段: 最后写入的 serverSeq}）、field_actor jsonb（{字段: 最后写入者 userId}）、created_by、created_seq、updated_seq、deleted bool、deleted_by、deleted_seq、visible_to_user_id null。
- `rejected_ops`：op_id 主键、trip_id、actor_user_id、code、message、created_at —— 相同 opId 重复提交返回同样的拒绝结果（幂等）。

### 1.3 实体注册表（Go）
统一的 `EntityDef`：实体名、字段定义（类型、校验、是否 create 必填、是否可空）、允许的 kind、权限函数（actor 角色、实体当前状态 → 允许/拒绝码）。M0 注册：
- `itinerary_item`（客户端 op 可写）：`title` 字符串 1–200 必填；`date` YYYY-MM-DD 必填；`place` 字符串 ≤200 可空。任何当前成员可 create/update/delete/restore。
- `trip`、`member`：**只能由服务器生成**（origin=server），客户端提交这两种实体的 op 一律拒绝 `entity_readonly`。
未知实体、未知字段、类型错误 → 拒绝 `invalid_op`（message 指明字段）。设计要便于 M1–M4 追加实体。

### 1.4 应用规则（每条 op 一个事务）
1. 校验：会话用户 = actorUserId；是该行程当前成员（否则 `not_member`）；schemaVersion 兼容（见 1.5）；实体/字段/权限校验。
2. 幂等：op_id 已在 ops → 返回 `duplicate` + 原 serverSeq；已在 rejected_ops → 返回原拒绝。
3. `create`：entity_id 已存在 → 拒绝 `entity_exists`。
4. `update`：实体不存在 → 拒绝 `entity_not_found`。逐字段：若 `field_seq[f] > baseSeq[f]`（baseSeq 缺省视为 0）且服务器当前值 ≠ 新值 → 照常应用并在 conflicts 中记录 `{field, overwrittenValue, overwrittenSeq, overwrittenActor}`。新值与当前值相同的字段不产生 change。实体已删除 → 照常写入字段但保持删除，op 标记 `entity_deleted=true` 并返回 deletedBy。
5. `delete`：软删除（已删除则视为无变化但仍记录）；`restore`：取消删除。
6. 写入 ops（含 changes、conflicts），更新 entity_state，提交后通知 SSE。
- 推送接口：`POST /api/trips/{tripId}/ops` body `{ops: [...]}`，最多 200 条、按顺序逐条处理；单条被拒绝不影响后续。响应逐条：`{opId, status: accepted|duplicate|rejected, serverSeq?, conflicts?, entityDeleted?, deletedBy?, error?{code,message}}`。整体级错误（未登录 401、非成员 403、需要升级 426）用 HTTP 状态码。

### 1.5 schemaVersion
- 常量 `CurrentSchemaVersion=1`、`MinSupportedSchemaVersion=1`；实现升级函数链 `upgrade(op, fromVersion)`（目前为空链，但结构到位并有单测演示一个假的 v0→v1 升级）。低于最小版本 → 拒绝 `upgrade_required`；高于当前 → 拒绝 `server_outdated`。

### 1.6 拉取与快照
- `GET /api/trips/{tripId}/ops?after=N&limit=500` → `{ops:[完整 op，含 serverSeq、serverTime、actorUserId、changes、conflicts、entityDeleted、origin], latestSeq, hasMore}`；按 visible_to_user_id 过滤。
- `GET /api/trips/{tripId}/snapshot` → `{seq, trip, members:[...], entities:[{entity, entityId, fields, fieldSeq, deleted, ...}]}`，seq 与数据在同一个可重复读事务内取得，保证一致。
- 修改记录：`GET /api/trips/{tripId}/history?entity=&entityId=&before=&limit=` 返回 op 列表（含 changes），按 serverSeq 倒序；不传 entity 为行程级时间线。

### 1.7 服务器生成的 op
行程设置与成员变化都**写成 origin=server 的 op**（actor 为操作用户），走同一条 seq、同一套 SSE 与修改记录，客户端只通过拉取得到它们：
- 创建行程：`trip` create（name/startDate/endDate/timezone/baseCurrency/ownerId）+ 创建者 `member` create。
- 修改行程设置、转让 owner：`trip` update（ownerId）+ 双方 `member` update（role）。
- 加入 / 重新加入：`member` create 或 restore + update；移除 / 退出：`member` update（leftAt）。member 字段：userId、nickname、avatarUrl、role、joinedAt、leftAt。
- 用户修改昵称/头像（M0.2 的 PATCH /api/me）：在其所有当前所在行程中生成 `member` update。

### 1.8 在线接口（全部 OpenAPI）
- `POST /api/trips` {name, startDate, endDate, timezone}；`GET /api/trips`（我当前所在的行程，含 role、latestSeq）；`GET /api/trips/{id}`；`PATCH /api/trips/{id}`（owner）；`DELETE /api/trips/{id}`（owner，硬删除行程及其全部 ops/状态/邀请/成员；之后访问返回 404 `trip_not_found`，并通过 SSE 发 `trip_deleted` 事件）。
- `POST /api/trips/{id}/transfer-owner` {userId}（owner，目标须为当前成员）。
- `DELETE /api/trips/{id}/members/{userId}`（owner 移除他人）；`POST /api/trips/{id}/leave`（成员自行退出；owner 必须先转让）。
- 邀请：`POST /api/trips/{id}/invites` {expiresInHours?}（owner 且**邮箱已验证**，否则 `email_not_verified`）、`GET /api/trips/{id}/invites`（owner）、`DELETE /api/trips/{id}/invites/{inviteId}`（作废）；`GET /api/invites/{token}`（无需登录：返回行程名、owner 昵称、是否有效；不泄露其它信息）；`POST /api/invites/{token}/accept`（需登录；已是成员则直接返回）。后端只返回 token，链接由前端拼接。
- 行程日期校验：endDate ≥ startDate，跨度 ≤ 90 天；timezone 必须是合法 IANA 名。

### 1.9 SSE
- `GET /api/trips/{tripId}/events`（需成员）：`text/event-stream`。连接后立即发送 `event: seq` `data: {"latestSeq":N}`；有新 op 时再发；每 25 秒发注释心跳；被移除时发 `event: revoked` 后关闭；行程删除时发 `trip_deleted` 后关闭。
- 进程内 hub 按 tripId 广播；连接不能被 http.Server 的 WriteTimeout 掐断（用 `http.ResponseController` 处理）；连接断开时清理。可以不经 strict server 实现，但必须写进 openapi.yaml。
- 确认 Caddy 反代对 SSE 不缓冲（M0.1 已配置 flush_interval，验证之）。

## 2. 测试（必须，集成测试用真实 PostgreSQL）
- 幂等：同一 op 提交两次 → 第二次 duplicate、seq 不变；被拒绝的 op 重复提交 → 相同拒绝。
- 并发：两个 goroutine 各推 100 条到同一行程 → seq 1..200 无空洞无重复。
- 冲突：A、B 都基于 seq=s 修改同一字段，后到者 conflicts 记录前者值；修改不同字段 → 无冲突、两者都生效；新值相同 → 无冲突。
- 删除后 update → accepted + entityDeleted；restore 后正常。
- 拒绝：非成员、被移除成员、客户端写 trip/member、未知字段、字段非法、旧/新 schemaVersion。
- 拉取分页与 hasMore；快照与"从 0 重放全部 op"得到的状态一致。
- 服务器 op：创建行程、改设置、转让、邀请加入、移除、退出、改昵称都产生正确的 op。
- 邀请：过期/作废/未验证邮箱不能创建；重新加入清空 leftAt。
- SSE：推送后订阅者收到 seq；移除成员时收到 revoked。
- 删除行程：数据全部清除，后续请求 404。

## 3. 文档
`docs/sync-protocol.md`：op 格式、seq 语义、推送/拉取/快照/SSE 接口、冲突与 conflicts 结构、拒绝码全表（code → 含义 → 客户端应如何处理）、schemaVersion 策略、服务器生成 op 的实体字段。前端 M0.5 将完全按该文档实现。

## 验收（你必须全部跑通）
1. `make gen` 无多余差异；`go vet ./...`、`go test ./...`（含集成测试，可用 `-race`）通过；前端 lint + build 通过。
2. `docker compose --profile dev up -d --build` 后用 curl 演示：两个用户 → A 建行程 → A 验证邮箱后建邀请 → B 接受 → B 订阅 SSE（`curl -N` 经 web 的 8088 端口）→ A 推送 itinerary_item → B 的 SSE 收到 seq → B 拉取到该 op → A、B 基于同一 seq 改同一字段产生冲突。
3. 结束后 `docker compose --profile dev down`（不加 -v）；不要 prune、不要动其它项目。

## 约束
- 不要 git commit。最终回复用中文：完成内容、接口与表清单、验收命令及实际结果、偏离之处及原因。
