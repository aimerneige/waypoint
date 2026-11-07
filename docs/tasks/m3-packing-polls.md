# 任务 M3：行李清单 + 小投票

前置：M0–M2 已完成。先阅读 `spec.md` 第 3、4.5、4.7、2.4、2.5 节，`docs/decisions.md`（D15 的动态字段先例；D18、D19 由本任务写入），`docs/sync-protocol.md`，以及现有实体注册表、trip_rates 的动态字段实现、前端分层。
任务书即已确认方案，范围内的架构、接口、数据结构、依赖改动均已批准，无需等待确认，直接实施。不要 git commit。

## 1. 关键设计决策（写入 decisions.md）
- **D18 每人一份的状态用"按用户分键的动态字段"存放在实体上**：行李个人勾选 `checked.<userId>`、投票 `vote.<userId>`。服务端只允许 actor 写自己的键（他人键 → 拒绝 `forbidden_field`）。好处：字段级 LWW 下不同成员同时勾选/投票互不冲突；同一人多设备离线修改按正常冲突规则处理；不需要"每人一条记录"的实体（那种做法在同一用户两台设备离线各自创建时会撞 entityId）。实体注册表需支持动态字段定义（键前缀 + 键校验 + 值校验 + 权限函数），trip_rates 若已有类似实现则统一为同一机制。
- **D19 个人物品的含义**：`scope=personal` 表示"每个成员都要带"的物品，每人各自勾选（`checked.<userId>`）；可选 `ownerUserId` 表示"仅此成员需要带"（只有他本人显示与勾选）。`scope=shared` 为公共物品，必须指定 `assigneeUserId`，用 `packed`（bool）+ `packedBy` 记录，仅负责人或 owner 可改 `packed`。用户模板为用户级数据（不属于行程），通过在线接口保存。

## 2. 实体与接口
### packing_item（任何成员可 create / update 名称与分类 / delete / restore）
name（1–100）、category（可空 ≤30）、scope（personal|shared）、ownerUserId（可空，仅 personal）、assigneeUserId（shared 必填，须为当前成员）、packed（bool，仅 shared；仅 assignee 或 owner 可写）、packedBy（服务端忽略客户端值，按 actor 写入——或由前端随 packed 一起写 actor，服务端校验等于 actor）、`checked.<userId>`（bool，仅 personal；只能写自己的键；ownerUserId 非空时只有该用户可写）、sortOrder（分数索引）。跨字段规则按完整状态校验。
### poll（任何成员可 create；question/multiChoice/deadline 仅创建者可改；delete 仅创建者或 owner）
question（1–200）、multiChoice（bool）、deadline（可空，RFC3339 时间）、closedAt（**客户端不可写**，仅服务器 op）、`vote.<userId>`（optionId 数组；单选时长度 ≤1，多选时去重；空数组 = 撤票；只能写自己的键）。
- 服务端拒绝：poll 已 closedAt 或 serverTime > deadline 后的投票与选项追加 → 拒绝码 `poll_closed`（确定性业务拒绝，加入持久化列表与协议文档拒绝码表；前端中文"投票已截止"）。投票引用不存在或已删除的选项 → `invalid_op`。
### poll_option（任何成员可 create（追加选项），仅创建者或 poll 创建者可 update/delete）
pollId、text（1–100）、sortOrder。
### 在线接口
- `POST /api/trips/{tripId}/polls/{pollId}/close`：poll 创建者或 owner；生成 server op 设置 closedAt；离线置灰。
- 用户行李模板：`GET/POST /api/me/packing-templates`、`PUT/DELETE /api/me/packing-templates/{id}`；表 `packing_templates(id, user_id, name, items jsonb, created_at, updated_at)`，items 为 `[{name, category, scope}]`，每用户 ≤ 50 个模板、每模板 ≤ 200 项。前端缓存到本地以便离线套用。

## 3. 前端
### 行李（底部导航"清单"）
- 分两区：**我的物品**（personal：通用项 + 仅我的项，显示我的勾选状态）与 **公共物品**（显示负责人头像/昵称、是否已装；我负责的排在前面）。进度条：我已装 x/y、公共已装 x/y。
- 每项一行（≥48px），整行可点切换勾选（仅有权限时），乐观更新、离线可用。
- 新增物品（Fab）：名称、分类、个人/公共、公共时选负责人（默认自己）、个人时可选"仅我需要带"。
- 模板：系统预设（海岛、滑雪、城市观光、证件类，内置于前端 `domain/packing-presets.ts`，每个 15–30 项，含合理的个人/公共默认）+ 我的模板（在线接口 + 本地缓存）。"套用模板"弹层：逐项可切换个人/公共、公共项选负责人，确认后批量生成 op。"另存为模板"（在线）。
- 公共物品"负责人"可改（共享编辑）；他人看到负责人变更。
- 出发提醒横幅：以行程时区计算，startDate 前 3 天起至出发当天，打开应用（进入该行程或我的行程列表）时显示："你还有 N 件公共物品未装"（我是负责人的）与"你还有 N 件个人物品未勾选"；可"今天不再提示"（按日记在本地）。通过 `platform/notify` 接口实现（Web：应用内横幅）。
- 修改记录：字段中文名；`checked.<userId>` 显示为"X 勾选了 / 取消勾选"，`vote.<userId>` 显示为"X 投给了 …"。
### 投票（"更多 → 投票"）
- 列表：进行中 / 已结束；每个投票卡片显示问题、截止时间（倒计时文本）、票数领先项。
- 详情：选项列表，每项显示票数、比例条、投票人头像/昵称（实名）；单选为单选按钮、多选为复选；可改票、撤票；可追加选项（未截止）；创建者/owner 可"关闭投票"（在线）、编辑问题与截止时间。
- 截止后或关闭后：投票控件禁用并显示"已截止"；离线投出的票若被服务器以 `poll_closed` 拒绝，按 M0.6 机制进入"未生效的修改"，原因"投票已截止"，本地回滚。
- 新建投票：问题、选项（至少 2 个，可动态增删）、单选/多选、可选截止时间（日期 + 时间，按设备本地时区输入，存 RFC3339）。

## 4. 测试
- 后端集成：动态字段权限（写他人 checked/vote 被拒）、单选多票被拒、截止/关闭后投票与追加选项被拒（`poll_closed` 持久化幂等）、shared 物品非负责人改 packed 被拒、owner 可改、模板接口与上限。
- 前端单测：出发提醒计算（时区边界、出发前 3 天、出发当天、已过出发日不提醒）、模板套用生成的 op、投票计数（撤票、多选、已删除选项不计）。
- Playwright（手机视口）：
  1. 套用"证件类"模板（部分改为公共并指定负责人 B）→ A、B 各自勾选个人物品互不影响 → B 勾选公共物品已装 → A 看到已装且无法勾选该公共物品。
  2. 出发提醒：创建 startDate 为今天+2 天的行程 → 负责人看到横幅；"今天不再提示"后刷新不再出现。
  3. 两人同时（在线）投票 → 双方实时看到票数与投票人。
  4. B 离线投票 → A 关闭投票 → B 上线 → B 的票被拒、"未生效的修改"显示"投票已截止"、本地票数回滚。
  5. 另存为模板 → 新行程套用"我的模板"。

## 验收（你必须全部跑通）
1. `make gen` 无差异；`go vet`、`make test-integration`、前端 lint / 单测 / build 通过。
2. `make e2e` 全部通过，连续 2 次无失败（含此前全部用例）。
3. 截图（不提交）：手机行李清单（含进度、公共物品负责人）、套用模板弹层、出发提醒横幅、投票列表、投票详情（单选/多选）；亮暗各一份。
4. 更新 decisions.md（D18、D19）、spec.md（3 节 PackingItem / Poll 字段说明、4.5 个人物品含义）、sync-protocol.md（动态字段、`poll_closed`）。
5. 结束后 `docker compose --profile dev down`（不加 -v）；不要 prune、不要动其它项目。

最终回复用中文：完成内容、验收命令及结果、截图路径、偏离之处及原因。
