# 任务 M2：多币种记账 + 默认汇率 + 对账视图 + AA 结算

前置：M0、M1 已完成。先阅读 `spec.md` 第 3、4.3、4.4、5 节，`docs/decisions.md`（D4、D5、D15–D17 由本任务写入），`docs/sync-protocol.md`，以及现有实体注册表与前端分层。
任务书即已确认方案，范围内的架构、接口、数据结构、依赖改动均已批准，无需等待确认，直接实施。不要 git commit。

## 0. 前置修正：建立统一的列表与操作模式（M1 验收遗留，M2–M4 都要复用）
M1 截图暴露的界面问题，先修正并沉淀为通用组件，再做账本：
- **操作菜单**：不要用 `<details>"更多操作"` 展开一排大按钮。新增 `ui/action-menu.tsx`：卡片右上角"⋯"图标按钮（44×44），手机打开底部操作面板（Drawer，每项 48px 行，危险操作红色），桌面打开 DropdownMenu。行程条目的 上移/下移/移到其它天/移回心愿池/删除，心愿的 编辑/删除 全部迁移到该菜单；只有最主要的一个操作（如心愿的"安排到…"）留在卡片上。
- **紧凑列表卡片**：新增 `ui/list-card.tsx` 约定：标题行（标题 + 右侧状态徽标/金额 + ⋯菜单）、次要信息一行（地点 · 时间等用"·"连接，muted 色，单行截断）、可选的描述行（最多 2 行截断）。卡片内边距 12–16px，行间距 4px，不再每个字段单独一段大间距。心愿卡片、行程条目卡片改用此结构；心愿的"查看链接"改为标题旁的外链图标。
- **顶栏紧凑**：手机顶栏不得换行。同步状态在窄屏只显示图标 + 短文本（"已同步" / "离线·1" / "同步中" / "未生效·2"），完整文案放 aria-label 与点击后的详情；"账户"改为头像首字母圆形按钮。
- **桌面细节**：左侧导航栏全高（sticky、`height: 100dvh`），边框贯穿；拖拽手柄改为卡片左侧的低调 `GripVertical` 图标（muted 色、无背景，悬停时显示），不要白色方块按钮。
- **Playwright 语言环境**：`playwright.config.ts` 设置 `locale: zh-CN`、`timezoneId: Asia/Shanghai`，使原生日期/时间输入与真实用户一致（M1 截图中出现 "11/11/2026"、"11:00 PM"）。
- 修正后重新生成 M1 截图（`m1-*.png`）供验收对比。

## 1. 关键设计决策（写入 decisions.md）
- **D15 默认汇率存为单一实体 `trip_rates`**：entityId = tripId，由服务器在创建行程时生成（origin=server 的 create，fields 为空）；已有行程由迁移补建（迁移中按协议写入 server op，分配序号）。客户端只能 update，字段名为币种代码（`^[A-Z]{3}$`，不得为 CNY），值为汇率十进制字符串或 null（删除该币种）。这样多人离线修改不同币种互不冲突，同一币种按字段级 LWW + 冲突提示处理。
- **D16 派生金额不落库**：`rateSource=default` 的账目不存 rate / amountCny，计算时取 trip_rates 当前值；`rateSource=wallet` 同样不存，按钱包加权平均成本实时推导；`manual` 存 rate；`actual` 存 amountCny（rate 显示为 amountCny 反推）；`cny` 支付 rate 固定 1。修改默认汇率无需批量改账目，"只重算 default 来源账目"由此天然成立；补记更早的换汇也会自动修正之后现金支出的成本。
- **D17 钱包不建实体**：钱包 = (成员, 币种)，由该成员的换汇记录与现金支出推导。

## 2. 实体（后端注册表校验 + 前端类型）
### exchange（换汇，只有 createdBy 本人可 update/delete/restore；create 时 ownerUserId 必须等于 actor）
ownerUserId（UUID）、currency（`^[A-Z]{3}$`，非 CNY）、cnyPaid（整数，分，>0）、foreignReceived（整数，外币最小单位，>0）、date（YYYY-MM-DD）、time（可空 HH:MM）、note（可空 ≤500）。
### expense（任何成员可 create；update/delete/restore：任何成员可（共享编辑），但 method=cash 的账目只有付款人本人可改金额/币种/方式字段——服务端校验）
| 字段 | 说明 |
|---|---|
| title | 必填 1–200 |
| category | 可空：food/transport/lodging/ticket/shopping/other |
| date / time | 日期必填，时间可空 |
| amount | 整数，原币最小单位，>0，≤ 1e12 |
| currency | `^[A-Z]{3}$` |
| method | card / cash / cny |
| cardNote | 可空 ≤50（仅 card 有意义） |
| payerUserId | card/cny 手选；cash 必须 = actor（服务端校验 create 时） |
| rateSource | default / wallet / manual / actual（cny 方式固定视为 1，rateSource 忽略） |
| rate | 仅 manual：十进制字符串 `^\d{1,9}(\.\d{1,10})?$` 且 > 0 |
| amountCny | 仅 actual：整数，分，>0 |
| split | `{ "mode": "equal", "members": [userId…] }`，members 非空、去重、均为该行程成员（含已退出成员）；预留 mode shares/amounts 结构但 v1 仅接受 equal |
| note | 可空 ≤500 |
跨字段规则（服务端校验每次 op 应用后的**完整状态**，不合法则拒绝 `invalid_op` 并给出中文说明）：method=cny ⇒ currency=CNY；currency=CNY ⇒ method=cny 或 card/cash 时 rate 视为 1；manual ⇒ rate 必填；actual ⇒ amountCny 必填；cash ⇒ currency≠CNY。
### settlement_transfer（任何成员可 create；delete/restore 用于撤销）
fromUserId、toUserId（不同、均为成员）、amountCny（分，>0）、date、note（可空）。
### trip_rates（见 D15）

## 3. 前端 domain（纯函数，单测覆盖率要求最高）
- `money.ts`：币种小数位用 `Intl.NumberFormat(..., {style:'currency', currency}).resolvedOptions().maximumFractionDigits`，并内置覆盖表（如 TWD 显示 0 位、但存储按 ISO 2 位 —— 统一按 ISO，不做特例，写测试锁定 JPY=0、KRW=0、USD=2、EUR=2、CNY=2、KWD=3）；金额解析（输入"1,234.5"→最小单位整数，超出小数位报错）与格式化（"¥1,234.50"、"JPY 1,234"）。
- `decimal.ts`：基于 BigInt 的定点小数运算（或引入 `decimal.js-light`），禁止浮点参与金额。折算：`amountCny(分) = roundHalfUp(amount × rate × 10^(2 − minorDigits))`。
- `wallet.ts`：按 (date, time 空视为 00:00, createdSeq) 时间顺序处理该成员该币种的换汇与现金支出，维护 余额 与 成本池（CNY 分，高精度）：换汇 → 余额 += foreign、成本池 += cnyPaid；支出 x → 平均成本 = 成本池/余额，支出的 CNY = x × 平均成本，成本池 -= 该值，余额 -= x。余额不足时：按最近一次平均成本计价（无任何换汇则无法推导 → 账目状态"缺少汇率"，提示手动填写），钱包显示负余额警告。输出：每笔现金支出的推导汇率与 amountCny、钱包当前余额与平均成本。
- `expense.ts`：解析每笔账目的生效汇率、amountCny、状态（估算 / 已核实 / 手动 / 钱包成本 / 缺少汇率）。card + default ⇒ "估算"；card + actual ⇒ "已核实"。
- `split.ts`：均分取整——总额整除人数，余数分按成员 userId 字典序依次各加 1 分，总和精确等于 amountCny。
- `settlement.ts`：每人净额 = 付款 amountCny 总和 − 分摊总和 + 已转出 − 已收到（按 settlement_transfer）。缺少汇率的账目不参与并计数提示。最少转账：非零净额人数 ≤ 20 时精确算法——对子集位掩码 DP 求最多数量的"净额和为零的互不相交分组"（dp[mask] = mask 内最多零和分组数，sum[mask]==0 时 dp 可 +1），转账数 = 非零人数 − 分组数；再在每组内按确定顺序（金额大者优先、userId 字典序）配对生成转账。> 20 人退化为贪心并返回 `exact=false`。结果完全确定、可复现。
- 单测必须覆盖：取整总和精确、余数分配顺序；结算最优性（与暴力枚举在随机小样本 n≤8 上对比转账数，数百组随机种子）；DP 在 n=20 时耗时 < 1s；钱包加权平均（多次换汇、穿插支出、余额不足、补记更早换汇导致重算）；default 汇率修改只影响 default 来源；各币种小数位。

## 4. 页面（features/ledger，底部导航"账本"）
- **账本首页**：顶部汇总（我已付 / 我应摊 / 我的净额，全组总支出 CNY）；账目列表按日期分组倒序，每项显示标题、原币金额、折合 CNY、付款人、状态徽标（估算/已核实/手动/钱包/缺少汇率）、分摊人数。筛选：付款人、币种、方式、状态。Fab 新增账目。
- **记账表单**（ResponsiveOverlay，手机为底部全高面板）：金额（`inputmode=decimal`，大字号）+ 币种选择（常用币种在前：行程已设默认汇率的币种 + CNY；可搜索全部 ISO 币种，cmdk）、方式分段选择（刷卡/现金/人民币）、付款人（cash 时锁定为自己）、标题、分类、日期时间、分摊成员（默认全部当前成员，可多选，已退出成员默认不选）、高级：汇率（显示当前生效汇率与来源，可改为手动汇率或直接填实际人民币金额）、卡片备注、备注。实时预览折合 CNY 与每人分摊。
  - 首次使用某外币且 trip_rates 无该币种时（card 方式），表单内提示填写默认汇率，保存时同时更新 trip_rates。
- **默认汇率设置**（"更多 → 设置"内或账本页入口）：每个币种一行，可修改/删除；修改前提示"将影响 N 笔按默认汇率计算的账目"。
- **钱包**：我的各币种钱包卡片（余额、平均成本），换汇记录列表与新增换汇表单；余额不足的现金账目显示警告。
- **对账视图**：列出所有"估算"刷卡账目，可按付款人、卡片备注、日期筛选；逐笔快速填入"实际扣款人民币"（行内输入，保存即 rateSource=actual）；顶部显示每人 已核实 / 待核实 笔数与金额。
- **结算页**：转账建议列表（谁 → 谁 多少元，"标记已转账"生成 settlement_transfer，提示条可撤销）；每人明细（可展开：付了哪些账、摊了哪些账、已转账）；已标记的转账列表（可撤销）；警示："N 笔刷卡未核实实际扣款，结果为估算"；离线时"可能缺少他人未同步的账目"；缺少汇率的账目提示；> 20 人时"结果为近似"。
- 修改记录：expense / exchange / settlement_transfer / trip_rates 字段中文名映射，金额按币种格式化显示。

## 5. 测试
- 后端集成：各实体字段与跨字段校验、权限（他人不可改我的换汇；cash 账目他人不可改金额/币种/方式）、trip_rates 只能 update 且 CNY 被拒、旧行程迁移补建 trip_rates。
- 前端单测见第 3 节。
- Playwright（手机视口）：
  1. 设置 JPY 默认汇率 → 刷卡记一笔 JPY 账（估算）→ 改默认汇率提示影响 1 笔 → 折合金额变化 → 对账视图填实际扣款 → 变为已核实，再改默认汇率不再变化。
  2. 换汇两次（不同汇率）→ 现金支出 → 显示加权平均汇率；他人账号不能编辑该现金账目的金额。
  3. 三人行程记 3 笔账（含不能整除的金额）→ 结算页转账建议、每人明细金额正确（与 domain 计算的期望值比对）→ 标记已转账 → 净额更新 → 撤销。
  4. 离线记账（刷卡外币 + 现金）→ 恢复后他人看到一致的金额与结算结果。
  5. 两人离线同时修改同一币种默认汇率 → 冲突提示出现。

## 验收（你必须全部跑通）
1. `make gen` 无差异；`go vet`、`make test-integration`、前端 lint / 单测 / build 通过。
2. `make e2e` 全部通过，连续 2 次无失败（含 M0、M1 用例）。
3. 截图（不提交）：手机账本首页、记账表单（外币刷卡、现金）、对账视图、钱包、结算页；亮暗各一份。
4. 更新 decisions.md（D15–D17）、spec.md 相应条目（如 Wallet 改为推导、Expense 字段）。
5. 结束后 `docker compose --profile dev down`（不加 -v）；不要 prune、不要动其它项目。

最终回复用中文：完成内容、算法说明、验收命令及结果、截图路径、偏离之处及原因。
