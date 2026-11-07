# M0 同步协议（schemaVersion 1）

本文档与 `openapi/openapi.yaml` 共同作为前端 M0.5 的实现依据。所有路径相对同域站点；写请求使用 M0.2 的 CSRF 双提交，或有效的 Bearer 会话令牌。服务端部署为单实例，SSE hub 在进程内运行。

## 操作与序号

客户端生成并持久保存非空 UUID `opId`、`entityId`。同一操作重试必须沿用原 `opId`；修正已被确定性业务拒绝的修改必须生成新 `opId`。版本拒绝不缓存，升级后沿用原 `opId` 重试。

```json
{
  "opId": "55f37ea1-98ba-43cd-8bd2-da3cb3e4eb95",
  "tripId": "bc361a34-20b2-403e-b79a-a5c360d835c9",
  "actorUserId": "89cf346e-ddd3-42a2-82ce-94087578967c",
  "schemaVersion": 1,
  "entity": "itinerary_item",
  "entityId": "428833bc-83ab-4003-8dd7-cf5cd6c91361",
  "kind": "update",
  "fields": {"title": "东京站集合", "place": null},
  "baseSeq": {"title": 4, "place": 4},
  "clientTime": "2026-11-07T09:00:00+09:00"
}
```

`actorUserId` 必须等于会话用户，`tripId` 必须等于请求路径。时间只供展示，所有排序与冲突判定只使用 `serverSeq`。

每个行程的序号独立，从 1 开始；数据库事务先锁定行程行，再分配 `last_seq + 1`。拒绝、重复和回滚不消耗序号；接受的无变化操作仍记录并消耗一个序号。新行程已有 `trip create` 和创建者 `member create`，因此创建响应的 `latestSeq=2`。所有客户端操作与服务器操作共用这一序列。

服务端全局序列无空洞，但用户可见的序列可以跳号：`visible_to_user_id` 非空的操作仅该用户可见。不能用序号是否连续判断丢失。M0 没有可创建私有实体的客户端接口，此字段为 M4 预留。

## 实体与应用规则

`itinerary_item` 允许任何当前成员 create/update/delete/restore。create 必填 `title`（字符串 1–200 字符）、`date`（真实日期 YYYY-MM-DD）；`place` 可省略、可为 null，非空值须为最多 200 字符的字符串。update 仅提交要改的字段；null 与省略不同。delete/restore 的 fields 必须为空对象。未知实体、未知字段、类型或日期错误均逐条拒绝，message 指出相关字段。

create 遇到已有 ID（包括软删除）拒绝；其余 kind 遇到不存在的 ID 拒绝。delete 为软删除，重复 delete 仍记日志；restore 取消删除并清空删除元数据，重复 restore 仍记日志。

M1 保持 schemaVersion 1，`itinerary_item` 新增可选 startTime/endTime、timezone/endTimezone、endDate、bookingInfo、voucherIds、wishItemId 和 sortOrder；`wish_item` 新增 title（必填）、note、url、place，任何当前成员可 create/update/delete/restore。字段校验见 `docs/tasks/m1-wishlist-itinerary.md` 第 1 节；endDate 与 date 对合并后的实体进行比较，更新单个字段也不能产生倒置日期。心愿已安排状态由未删除行程项的 wishItemId 推导。

update 按字段最后写入胜出：`fieldSeq[field] > baseSeq[field]` 且服务器值与新值不同，则接受写入，同时返回冲突。baseSeq 缺省按 0；字段值相同不产生 change、不更新该字段的 fieldSeq/fieldActor，也不产生冲突。不同字段互不干扰。

```json
{
  "field": "title",
  "overwrittenValue": "A 修改",
  "overwrittenSeq": 5,
  "overwrittenActor": "89cf346e-ddd3-42a2-82ce-94087578967c"
}
```

冲突没有阻止写入。前端展示覆盖提示；“恢复旧值”应生成一条新的 update，字段值取 overwrittenValue，baseSeq 取当前已知序号。

对已删除实体的 update 照常写字段但保持删除，结果含 `entityDeleted:true`、`deletedBy`，提示用户选择 restore。不要自动恢复。

完整日志在客户端 op 字段之外增加 `serverSeq`、`serverTime`、`changes`、`conflicts`、`entityDeleted`、`origin`。`changes` 为 `{字段: {old, new}}`，新建字段的 old 为 null；delete/restore 的实际状态变化使用保留元字段 `deleted`，不属于可写的 fields。fieldSeq/fieldActor 只追踪实体业务字段；删除状态使用 deletedBy/deletedSeq 追踪。

## 推送

`POST /api/trips/{tripId}/ops`，请求 `{ "ops": [op, ...] }`，最多 200 条、请求体最多 2 MiB。默认其他请求上限为 16 KiB；未来 `POST /api/trips/{tripId}/uploads` 已预留按 `MAX_UPLOAD_MB` 计算的路由上限，目前没有上传接口。

批次严格按输入顺序执行，每条一个事务；单条业务拒绝不阻断后续操作。并发请求在同一行程行锁上串行提交；数据库异常或权限中途失效会停止当前请求，先前已提交的操作保持有效。此时重发原批次，由 opId 去重恢复。不同请求间无整批原子性，不要假设批内序号连续。

响应 HTTP 200：

```json
{
  "results": [
    {"opId":"55f37ea1-98ba-43cd-8bd2-da3cb3e4eb95","status":"accepted","serverSeq":6,"conflicts":[],"entityDeleted":false},
    {"opId":"5ca854d1-e6bd-49f6-a671-a071b1855b48","status":"duplicate","serverSeq":5},
    {"opId":"e3aef0fe-59db-4028-b0d9-bd6292061312","status":"rejected","error":{"code":"invalid_op","message":"字段非法 title"}}
  ]
}
```

accepted/duplicate 均可停止发送，客户端记录 acceptedSeq 并保留本地操作，直到拉取游标越过该序号再删除，避免乐观视图闪回。确定性业务 rejected 应回滚本地效果，放入未生效列表；其拒绝结果持久化，重复提交同一个 opId 返回原拒绝。upgrade_required/server_outdated 取决于版本环境，不写入 rejected_ops，保留队列并在升级后使用原 opId 重新提交。升级链缺失等内部错误也不持久化，恢复后重试原操作。全局 opId 不可被其他行程/用户复用，否则拒绝 invalid_op，且不泄露原操作。

未登录 HTTP 401；非当前成员 HTTP 403；行程不存在 HTTP 404。整批所有结果均为版本拒绝时 HTTP 426，统一错误体给出首条版本拒绝原因；混合批次保持 HTTP 200 并逐条返回。无论哪种响应方式，版本拒绝都不持久化。请求体超限 HTTP 413：`{"error":{"code":"payload_too_large","message":"请求体过大"}}`。传输层错误不应直接当作整批业务拒绝。

## 拉取、快照与历史

`GET /api/trips/{tripId}/ops?after=0&limit=500` 返回 `{ops, latestSeq, hasMore}`。after 非负，limit 为 1–500，默认 500。ops 按 serverSeq 升序，包含完整日志，过滤不可见记录。hasMore 表示仍有未返回的可见记录。

有下一页时，用当前页最后一条 op 的 serverSeq 继续请求；hasMore=false 时可以把游标推进至 latestSeq（包括跳过不可见序号）。事务保证返回的 latestSeq 与列表来自同一快照。不要用客户端当前时间或 SSE 的序号替代已完成拉取的游标。

`GET /api/trips/{tripId}/snapshot` 返回：

```text
{
  seq,
  trip: {id, name, startDate, endDate, timezone, baseCurrency, ownerId, latestSeq, createdAt, role},
  members: [{userId, nickname, avatarUrl, role, joinedAt, leftAt}],
  entities: [{entity, entityId, fields, fieldSeq, fieldActor,
              createdBy, createdSeq, updatedSeq, deleted, deletedBy, deletedSeq}]
}
```

seq、trip、全部成员（含已退出者）及当前用户可见的实体在一个 REPEATABLE READ 事务内读取。成员资料来自对应 member 实体状态。entities 包含 trip/member 与已删除实体，删除元数据允许 null。新设备可原子替换本地权威状态，再从 seq 拉取；不得直接丢弃自己的未发送队列，应在权威状态上重新叠加。

`GET /api/trips/{tripId}/history?entity=itinerary_item&entityId=UUID&before=N&limit=500` 返回 `{ops:[完整日志]}`，按 serverSeq 倒序，before 为不包含边界。entity/entityId 均可省略，不传 entity 时可查看行程时间线；默认不限制上边界。limit 规则同拉取，隐私过滤一致。

## SSE

`GET /api/trips/{tripId}/events` 返回 `text/event-stream`，需要当前成员身份。Web EventSource 使用同域 Cookie；原生端可使用支持 Bearer 的流式客户端。

```text
event: seq
data: {"latestSeq":6}

: heartbeat

event: revoked
data: {}
```

连接后立即发送 seq；新操作提交后再通知。通知可合并，只有序号，没有实体数据；仍须调用拉取。每 25 秒发送注释心跳。在首次发送、收到通知及每次心跳前，查询数据库确认原会话仍存在且未过期；注销、修改密码或重置密码删除该会话后，下次检查发送 unauthorized 并关闭，不再发送普通 seq 或心跳。数据库查询失败也关闭连接。终止通知单独保存，不会被普通 seq 合并覆盖。

| SSE 事件 | 数据 | 客户端处理 |
| --- | --- | --- |
| seq | `{latestSeq:N}` | 拉取新操作 |
| unauthorized | `{}` | 关闭订阅，保留本地数据和队列；重新登录同账号后重连 |
| revoked | `{}` | 关闭订阅并停止该行程同步；重新加入后建立新连接 |
| trip_deleted | `{}` | 关闭订阅并停止该行程同步，提示行程已删除 |

修改密码沿用 M0.2 行为：保留发起修改的会话，删除其他会话；只有失效会话的 SSE 连接会收到 unauthorized。注释心跳不是 SSE 业务事件。

服务端使用 ResponseController 清除写超时，断开时清理订阅。Caddy 的 `flush_interval -1` 保证即时转发。SSE 不保证离线期间事件重放：重连立即读取 latestSeq，另用启动、网络恢复、重新可见及前台每 60 秒拉取兜底。

## 在线管理接口与服务器操作

| 接口 | 权限与效果 |
| --- | --- |
| POST /api/trips | 登录用户创建；生成 trip create、创建者 member create |
| GET /api/trips | 当前参与的行程，含 role/latestSeq |
| GET /api/trips/{tripId} | 当前成员读取 |
| PATCH /api/trips/{tripId} | owner 修改设置，生成 trip update |
| DELETE /api/trips/{tripId} | owner 硬删除六张业务表中该行程数据，发送 trip_deleted；之后返回 trip_not_found |
| POST /api/trips/{tripId}/transfer-owner | owner，body `{userId}`；目标必须是当前成员，生成 trip update 和双方 member role update；转给自己不变更 |
| DELETE /api/trips/{tripId}/members/{userId} | owner 移除他人，生成 member leftAt update，发送 revoked |
| POST /api/trips/{tripId}/leave | 自行退出，owner 须先转让，生成 member leftAt update，发送 revoked |
| POST /api/trips/{tripId}/invites | 已验证邮箱的 owner，body `{expiresInHours?}`；省略为永久，指定值为 1–8760 小时 |
| GET /api/trips/{tripId}/invites | owner 读取邀请列表 |
| DELETE /api/trips/{tripId}/invites/{inviteId} | owner 作废邀请 |
| GET /api/invites/{token} | 匿名可读，仅返回 tripName、ownerNickname、valid；未知 token 返回空名称与 valid=false |
| POST /api/invites/{token}/accept | 登录用户；新成员生成 member create；重新加入生成 member restore + update，清空 leftAt；已是成员直接返回，不增加序号 |
| PATCH /api/me | 每个当前所在行程生成 member nickname/avatarUrl update，更新与资料写入同事务 |

邀请 token 是 43 字符随机 base64url 字符串，服务端不拼接链接。行程 name 为 1–200 字符且不可全空白；endDate ≥ startDate、日期差不超过 90 天；timezone 须是 IANA 名称，不接受 Local；结算币种固定 CNY。

客户端不得写 trip/member；它们只接受服务器生成的操作，`origin=server`、actorUserId 为执行在线操作的用户。重放字段如下：

| 实体 | entityId | fields |
| --- | --- | --- |
| trip | 行程 ID | name、startDate、endDate、timezone、baseCurrency、ownerId |
| member | 用户 ID（以 tripId 隔离） | userId、nickname、avatarUrl（可 null）、role（owner/member）、joinedAt、leftAt（可 null） |

这些操作与客户端操作共用 seq、changes、快照、历史和 SSE。加入时间与退出时间均为服务器时间；保留已退出成员资料用于审计。邀请创建/作废本身不属于同步实体，不增加序号。

## 拒绝码与客户端处理

| code | 含义 | 客户端处理 |
| --- | --- | --- |
| invalid_op | 未知实体/字段、类型/格式错误、ID 被其他用户或行程使用、路径与 op.tripId 不同 | 回滚并展示 message；修正后用新 opId |
| actor_mismatch | actorUserId 与会话不符 | 停止跨账号队列提交，校验本地用户隔离 |
| entity_readonly | 客户端试图写 trip/member | 回滚；使用在线管理接口 |
| entity_exists | create 的 entityId 已存在，包括软删除 | 拉取确认；不能用 create 覆盖 |
| entity_not_found | update/delete/restore 的实体不存在 | 拉取确认，提示用户修正或丢弃 |
| upgrade_required | schemaVersion 低于最低支持版本 | 保留队列，提示升级；不缓存拒绝，升级后用原 opId 重试 |
| server_outdated | schemaVersion 高于服务器版本 | 提示服务端升级；保留队列，恢复兼容后用原 opId 重试 |
| unauthorized | 未登录/会话失效，HTTP 401 | 保留本地数据只读与队列，重新登录同账号后继续 |
| not_member | 非当前成员/被移除，HTTP 403 | 停止同步，提示已失去权限；不能把本批次当作全部未提交 |
| trip_not_found | 行程已删除或不存在，HTTP 404 | 停止该行程同步，提示行程不存在 |
| owner_required | 当前角色不是 owner，HTTP 403 | 刷新成员角色，禁用管理入口 |
| owner_must_transfer | owner 不能直接退出/被移除 | 先在线转让 owner |
| email_not_verified | 未验证邮箱不能创建邀请，HTTP 403 | 引导验证/重发邮件 |
| invalid_invite | 邀请过期、作废或未知，HTTP 400 | 提示重新索取邀请 |
| invite_not_found | 待作废邀请不存在，HTTP 404 | 刷新邀请列表 |
| invalid_trip | 行程名称或日期范围不合法，HTTP 400 | 修正设置 |
| invalid_timezone | 时区不合法，HTTP 400 | 选择 IANA 时区 |
| invalid_request | 请求结构/分页/数量/有效期非法，HTTP 400 | 修正请求；保留待提交队列 |
| payload_too_large | 超过路由请求体限制，HTTP 413 | 拆小批次，保留原 opId |
| csrf_invalid | Cookie 写请求的 CSRF 校验失败，HTTP 403 | 刷新 CSRF 令牌后重试原批次 |
| internal_error / unavailable | 服务器或数据库暂不可用，HTTP 500/503 | 退避重试原批次，可能已有部分提交 |
| rate_limited | 账号相关接口限流，HTTP 429 | 按 Retry-After 等待后重试 |
| not_found / method_not_allowed | 路径/方法不支持，HTTP 404/405 | 检查客户端接口版本 |

只有确定性业务拒绝（invalid_op、actor_mismatch、entity_readonly、entity_exists、entity_not_found）进入 rejected_ops。版本拒绝与升级链缺失等内部错误不持久化；迁移会清除旧实现已缓存的版本拒绝。整体鉴权、CSRF、格式及大小错误不代表该请求的全部操作都已经写入拒绝表。账号注册、密码和邮件令牌的专用错误沿用 M0.2 契约。

## 版本策略与验收

当前 `CurrentSchemaVersion=1`、`MinSupportedSchemaVersion=1`。升级链按 fromVersion 逐级执行，转换后再进行实体校验。增加兼容版本时补齐升级函数并调整最低版本；不能跳过缺失的转换步骤。单元测试以假的 v0→v1 字段迁移演示链路，生产没有接受 v0。

真实 PostgreSQL 测试：`make test-integration`（包含 `-race`）。单元测试与静态检查：`cd api && go test ./... && go vet ./...`。生成一致性：`make gen` 再比较三个生成文件；前端：`cd web && npm run lint && npm run build`。

可复现双用户验收：`docker compose --profile dev up -d --build` 后运行 `python scripts/verify-sync.py`。脚本实际调用 curl 注册两个用户、经 Mailpit 取邮件并验证、创建/接受邀请、以 `curl -N` 经 8088 订阅 SSE、验证推拉和冲突，最后删除验收行程。运行前需开发环境 Mailpit 可从 8025 访问，支持环境变量 SYNC_VERIFY_URL / SYNC_VERIFY_MAIL_URL。结束执行 `docker compose --profile dev down`，保留卷。
