# 决策记录

> 记录 Waypoint 设计讨论中的关键决策、理由与被否决的方案。
> 最终规格以 `spec.md` 为准；本文档用于回答"为什么这样定"，避免重复讨论。
> 讨论日期：2026-11-07

---

## D1. 必须有后端，不能做纯静态站
- 兄弟项目（paypie、exchange、tessera 等）都是 Vite 静态站，用 `deploy.sh` 推到 GitHub Pages，数据只存在浏览器本地。
- Waypoint 要求"全组共用一份"，必须有服务端存储与同步，部署方式与兄弟项目不同。

## D2. 需要注册登录 + 严格鉴权（推翻原需求"不用注册"）
- 原需求"点链接即加入、不用注册"意味着链接即全部权限、身份可冒充，修改记录里的"谁改的"不可信。
- 凭证夹含护照、签证等敏感文件，最终决定做账号体系 + 严格鉴权 + 邀请链接加入。
- 代价：朋友必须先注册才能加入。
- 账号用**邮箱 + SMTP**（邮箱验证、找回密码）；被否决：用户名 + 管理员重置密码。

## D3. 离线策略：离线可看全部、可做大部分修改，联网后同步
- 用户确认目标是弱网 / 无网时可查看全部数据并做部分修改。
- 结论：允许离线修改是可控的，前提是按数据类型区分（见 spec 2.4）：新增类、单人写入类放心离线；共享编辑类按字段最后写入胜出 + 冲突提示；删除用软删除；权限 / 全局操作必须联网。
- 不使用 CRDT（Yjs / Automerge）：它们的历史不是人类可读的"谁把什么从 A 改成 B"，修改记录还得另做一套；自研操作日志同时解决同步与审计。
- 排序只信任服务器序号，不信任客户端时钟。
- 离线修改真正的难点（已写入 spec）：离线期间被移出行程 / 会话过期 → 服务器逐条校验并回滚被拒绝的修改；旧版本客户端排队的修改 → op 带 schemaVersion；退出登录必须清空本地数据。

## D4. 汇率：完全手动维护，不接入任何外部汇率
- 曾讨论接入 Visa 等卡组织的历史结算汇率，最终否决。理由：
  - Visa 官网汇率计算器背后不是公开 API，可能变更、限流、拦截云服务器 IP；Visa Developer 的官方 FX API 需要申请资质，且官方论坛称其汇率用于 Visa Direct 转账，与消费汇率不一致。
  - 国内发行的外币 Visa / Mastercard 卡多以美元入账再由银行购汇，卡组织汇率本来就不等于实际人民币扣款。
  - 抓取官网数据可能违反服务条款。
- 最终方案：行程级"默认汇率"（每币种一个，手动设置）+ 每笔可改 + 事后对照银行账单补实际扣款 + 对账视图。
- 现金汇率：原需求"按那次的汇率"在多次换汇时有歧义。改为**钱包归个人**，现金支出默认按钱包**加权平均成本**，可手改；剩余外币归钱包主人，不参与结算。钱包归个人也避免了多人离线花同一钱包导致超支。

## D5. AA 结算：精确最少转账
- 严格最少转账次数是 NP 难问题，常用贪心只保证 ≤ n−1 笔，不保证最少。
- 小组规模 ≤ 20 人，用子集穷举求精确最优；超出时退化为贪心并注明。
- 结算只在前端计算（结果由已同步数据唯一确定），服务器不计算。

## D6. 出发提醒：首版只做应用内提醒
- 网页没有可靠的离线定时通知（Notification Triggers API 已被放弃）；iOS Web Push 需要添加到主屏幕（16.4+）且由服务器发送。
- 首版：打开应用时显示横幅。M6 原生客户端用本地定时通知实现离线准时提醒。

## D7. 后端：Go + PostgreSQL + Docker Compose，不用 Redis
- 用户指定 Go、PostgreSQL、Docker 构建、Compose 部署。
- 曾计划用 Redis 做限流、会话缓存、发布订阅、下载令牌，用户决定砍掉。替代方案见 spec 7.3：会话直接查 PG；进程内限流；进程内 SSE 广播；HMAC 签名下载 URL。
- 约束：API 单实例部署。以后要多实例时用 PG LISTEN/NOTIFY，仍无需 Redis。
- 即便有 Redis，也不应缓存业务数据：数据量小，加缓存只会增加失效问题。
- 会话用不透明令牌 + httpOnly Cookie，不用 JWT（前后端同域）；为 M6 预留 Bearer 令牌。
- 已否决的后端方案：Cloudflare Workers + Durable Objects + R2；Node + SQLite。
- 接口契约用 OpenAPI + oapi-codegen 生成 Go 服务端与前端 TS 类型（Go 后端不能与前端共享 TS 代码）。

## D8. 部署：不耦合域名
- 程序只监听固定端口（默认 8080），只在 compose 内网暴露。
- 域名与 HTTPS 只在 Caddyfile 中通过环境变量配置，部署阶段处理。
- 唯一例外：邮件链接需要完整网址，用环境变量 `PUBLIC_BASE_URL`，禁止从请求 Host 头推断（防止 Host 头注入把重置链接指向攻击者域名）。
- 私有主机部署。

## D9. 前端：React + shadcn/ui，简约现代风格
设计方向的讨论过程（已最终确定，不再变更）：
1. 用户先提出：视觉参考 Modrinth、交互借鉴 Material、组件基于 shadcn/ui。
   - 当时指出：Modrinth 是偏桌面的目录站，手机端只能借视觉元素；不要照搬其品牌（标志性绿色、Logo）；shadcn 默认尺寸偏桌面；返回手势要关闭弹层。
2. 改为以 MD3 为核心。分析 MD3 组件库：
   - Angular Material：M3 官方实现、最完整（推荐过），但用户坚持用 React。
   - MUI：仍以 MD2 外观为主，没有完整的 M3。
   - @material/web：2024 年起维护模式，不可选。
   - mdui 2：MD3 完整，但社区小（paypie、exchange 在用）。
3. 最终：用 React，不卡死 MD3，要简约现代 → **shadcn/ui**。
   - 对比过：Mantine（全家桶、偏后台观感）、Ionic React（手机手感最好，但路由基于 React Router v5、原生 App 观感、桌面差、难定制）、HeroUI（社区较小、大版本变动频繁）、MUI、mdui。
   - shadcn 风险：底层 Radix 维护节奏放缓，shadcn 已开始支持 Base UI；组件源码在项目内，可自行修复。
- 主色：**淡蓝色**。淡蓝底配白字对比度不够，亮色主题中淡蓝用于背景强调 / 选中 / 高亮，主按钮用同色相深蓝；暗色主题淡蓝可直接作主色配深色文字。具体色值 M0 定稿。

## D10. 原生客户端：M6 预留，现在不做
- Ionic 本身只是 UI 库，打包客户端的是 Capacitor（WebView 包装，不是编译成原生代码），且不挑 UI 库，shadcn 应用同样可以打包。所以"想要客户端"不是选 Ionic 的理由。
- 客户端能解决：iOS 存储被清理、离线定时提醒、凭证存文件系统、原生分享 / 拍照。
- 代价：iOS 需要 macOS + Xcode + Apple 开发者账号（每年 99 美元），worker 是 Linux 无法构建 iOS；Android 门槛低（APK 直接分发，可在 Docker 中构建）；客户端来源是 localhost，与 API 跨域，Cookie 不可用 → 需要 Bearer 令牌；客户端长期停留旧版本 → op 版本兼容为硬性要求。
- 决定：首版纯 PWA，M6 先出 Android。现阶段只预留：Bearer 鉴权、`platform/` 能力接口（storage / notify / share / secureStore）、可配置 API 地址、CORS 白名单。

## D11. 其它定稿参数
- 结算币种固定人民币。
- 小组规模按 2–20 人设计。
- 凭证单文件上限 32 MB。
- 凭证可见性：全组 / 仅自己（签证、保险默认仅自己）。
- 手机上拖拽体验差：心愿池保留拖拽，但"安排到…"按钮是主路径。

## D12. M0 同步验证实体：ItineraryItem 最小字段
- M0 没有业务实体，但验收要求"两台设备离线各自修改后数据一致"，同步引擎需要真实实体来验证。
- 决定：M0 直接实现 `ItineraryItem` 的最小字段（title、date、place，含软删除），配一个简单列表界面；M1 在此基础上补全行程表其余字段与交互。
- 被否决：临时测试实体（M1 还要删除，白写代码）。

## D13. M0.4 主色定稿：天蓝

- 亮色：background `#F7FAFC`、foreground `#0F1B26`、card/popover `#FFFFFF`；primary `#1B65A6` 配 `#FFFFFF`；accent/secondary `#E3F1FC` 配 `#173E60`；muted `#EAF0F5`、muted-foreground `#526372`；destructive `#B42332` 配 `#FFFFFF`；border/input `#BDCADA`；ring `#3D9BE0`。
- 暗色：background `#0E141B`、foreground `#E6EDF3`、card/popover `#151D26`；primary `#8FCBF5` 配 `#0A2236`；accent/secondary `#1C3347` 配 `#D1E9FC`；muted `#202C38`、muted-foreground `#A6B5C3`；destructive `#F6A5AE` 配 `#400C16`；border/input `#435467`；ring `#8FCBF5`。
- card/popover 文字沿用 foreground。圆角基础值 `0.75rem`。浅蓝用于亮色强调背景，深蓝主按钮保证白字对比度。
- TS 令牌在 `web/src/ui/theme/tokens.ts`，CSS 对应值由单元测试逐主题、逐变量核对，避免测试与实际界面脱节。

| 文字 / 背景 | 亮色对比度 | 暗色对比度 |
| --- | ---: | ---: |
| foreground / background | 16.63 | 15.66 |
| primary-foreground / primary | 6.07 | 9.29 |
| muted-foreground / background | 5.92 | 8.83 |
| accent-foreground / accent | 9.64 | 10.39 |
| destructive-foreground / destructive | 6.51 | 8.51 |
| card-foreground / card | 17.43 | 14.38 |
| popover-foreground / popover | 17.43 | 14.38 |
| secondary-foreground / secondary | 9.64 | 10.39 |

全部达到 WCAG AA 正文要求（≥ 4.5:1）。
