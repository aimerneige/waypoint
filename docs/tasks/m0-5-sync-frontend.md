# 任务 M0.5：前端本地数据库 + 同步层 + 行程 / 成员 / 邀请页面

前置：M0.1–M0.4 已完成。先阅读 `docs/sync-protocol.md`（后端协议，**唯一实现依据**）、`spec.md` 第 1.2、2、7.5 节、`docs/decisions.md`，以及现有 `web/` 代码（UI 组件、API 客户端、会话 store、platform 接口）。
若发现协议文档与后端实际行为不一致，以后端代码为准修正文档，并在最终回复中列出。

## 1. 模型：已确认状态 + 待发送操作重放（必须按此实现）
- 每个实体在本地保存两份：`server`（只由服务器 op/快照更新的已确认状态：fields、fieldSeq、fieldActor、deleted…）与 `view`（= server 状态上按顺序重放本地尚未确认的 op 得到的结果，界面只读 view）。
- 本地写入：生成 op（`opId`=crypto.randomUUID、`schemaVersion`=当前版本、`baseSeq`=该字段在 **server** 状态中的 fieldSeq、`clientTime`）→ 写入 outbox → 重算该实体 view。同一个 Dexie 事务完成，保证原子。
- 推送结果：`accepted`/`duplicate` → outbox 中该 op 标记 `acceptedSeq`，**暂不删除**，直到拉取游标越过该 seq 再删除（避免界面闪回）；`rejected` → 移入 `rejected` 表（含错误码与信息），重算 view（即回滚）。
- 拉取：按 seq 顺序把服务器 op 应用到 server 状态，推进行程 `lastSeq`，删除已被越过的 accepted op，重算受影响实体的 view。
- 以上应用/重放逻辑放在 `src/domain/ops.ts`（纯函数，不依赖 Dexie/React），单测覆盖：create/update/delete/restore、对已删除实体 update、重放顺序、回滚、幂等（重复应用同一 server op 无副作用）。
- 拉到的 op 同时存入本地 `ops` 表（M0.6 用于离线查看修改记录与冲突提示）。

## 2. Dexie（src/data/）
- 每个用户一个数据库：`waypoint-u-<userId>`（多账号隔离）。表至少：`trips`（行程元数据、角色、lastSeq、access: ok|revoked|deleted）、`entities`（主键 [tripId+entity+entityId]，含 server 与 view，按 [tripId+entity] 建索引）、`outbox`（自增本地顺序）、`rejected`、`ops`（[tripId+serverSeq]）、`notices`（冲突 / 被删除等提示，M0.6 展示）、`meta`。
- 版本迁移从 version(1) 开始，后续加表/索引必须写 upgrade。
- 按实体的读写函数：`useEntities(tripId, entity)`（useLiveQuery，过滤 view.deleted）、`createEntity`、`updateEntity(只传变更字段)`、`deleteEntity`、`restoreEntity`——**所有写入只能经由这一统一入口**。

## 3. 同步引擎（src/sync/，与 React 无关）
- 触发：应用启动、`online` 事件、页面重新可见、SSE 收到 seq > lastSeq、前台每 60 秒兜底、本地写入后防抖约 300ms。
- 每个行程单飞（同时只有一个同步流程），流程：推送 outbox（≤200 条/批，按本地顺序）→ 拉取至 hasMore=false。首次（lastSeq=0）先取快照再拉增量。
- 行程发现：在线时调用 `GET /api/trips` 更新本地行程列表，并在后台同步**全部**所在行程（离线时可查看所有行程）；SSE 只为当前打开的行程建立（EventSource，同源 Cookie 鉴权）。
- 网络错误 / 5xx / 超时：指数退避 + 抖动（1s 起、上限 60s），不阻塞界面。
- 401：会话 store 置 `expired`，停止同步，outbox 保留；重新登录后自动继续。
- 403 `not_member` / SSE `revoked`：行程标记 revoked，清除该行程本地数据，丢弃其 outbox（提示"你已被移出行程 X，N 条未同步修改已丢弃"）。404 `trip_not_found` / SSE `trip_deleted`：同理标记 deleted。
- `upgrade_required` / 426：停止推送，显示"需要更新应用"提示（与 PWA 更新提示衔接）。
- 同步状态接入 M0.4 的 SyncStatus：已同步 / 同步中 / 离线（N 条待同步）/ 有修改未生效（rejected 非空）。
- 用可注入的 transport（fetch 封装）实现，便于测试；写单测：用内存假服务器（按协议实现最小行为：seq、幂等、拒绝、冲突）覆盖 推送→拉取、拒绝回滚、accepted 保留至越过、退避、401 保留队列、revoked 清除。

## 4. 页面（数据一律来自 Dexie，网络只由同步层与在线操作访问）
- `/`（我的行程）：本地行程列表（名称、日期、角色）；"新建行程"（ResponsiveOverlay 表单：名称、开始/结束日期（手机原生 date input）、时区（默认浏览器时区，可搜索选择常用 IANA 时区））——在线操作，离线置灰。创建成功后立即同步并进入行程。
- 行程"更多"→**成员**：从本地 `member` 实体读取；显示昵称、头像首字母、角色、"已退出成员"；owner 可移除成员、转让 owner；成员可退出行程（二次确认）。均为在线操作。
- **设置**（owner）：修改名称 / 日期 / 时区（在线）；删除行程（输入行程名二次确认，在线）。非 owner 只读。
- **邀请**（owner，在成员页内）：生成邀请链接（有效期：1 天 / 7 天 / 30 天 / 永不）、列表、复制 / 分享（platform/share）、作废；邮箱未验证时提示先验证并提供重发按钮。链接按 `location.origin + /join/<token>` 生成。
- `/join/:token` 接入：加入成功后触发同步并跳转行程。
- 行程页顶部显示行程名与 SyncStatus；"行程"tab 本任务仍为占位（M0.6 实现 ItineraryItem 列表）。
- 已 revoked / deleted 的行程从列表移除并提示一次。

## 5. Playwright（追加）
- 创建行程 → 生成邀请 → 第二个浏览器上下文（另一用户）通过链接加入 → 双方成员页都看到对方（验证 SSE/拉取生效）。
- owner 移除成员 → 被移除方页面提示并从列表消失。
- 离线（`context.setOffline(true)`）后刷新，行程列表与成员仍可查看。

## 验收（你必须全部跑通）
1. `npm run lint`、`npm run test -- --run`、`npm run build` 通过；后端测试仍通过（若改了后端）。
2. `docker compose --profile dev up -d --build` 后 `make e2e` 全部通过（含 M0.4 用例）。
3. 结束后 `docker compose --profile dev down`（不加 -v）；不要 prune、不要动其它项目。

## 约束
- 任务书即已确认方案，范围内改动均已批准，无需等待确认，直接实施。不要 git commit。
- 最终回复用中文：完成内容、本地表结构、同步状态机说明、验收命令及结果、协议文档修正、偏离之处及原因。
