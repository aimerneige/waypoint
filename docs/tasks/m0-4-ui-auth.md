# 任务 M0.4：前端 UI 基础 + 账号页面 + Playwright

前置：M0.1–M0.3 已完成。先阅读 `spec.md` 第 1.1、2.7、6、7.5、7.6 节，`docs/decisions.md` D9/D10，以及现有 `web/`、`openapi/openapi.yaml`。
本任务只做**前端**（必要时可小改 Caddyfile / compose），不改后端行为。行程、成员、同步相关页面**不在本任务**（M0.5 基于本地数据库实现），这里只放占位。

## 1. 设计令牌与主题（主色在此定稿）
- 在 `src/style.css` 用 CSS 变量定义 shadcn 令牌（background、foreground、card、popover、primary、primary-foreground、secondary、muted、accent、destructive、border、input、ring、radius 等）亮暗两套，并接入 Tailwind v4 `@theme inline`。
- 主色色相：天蓝（约 205°）。初始方案（可微调，但必须满足对比度）：
  - 亮色：accent/选中背景 `#E3F1FC`，primary（主按钮底色，配白字）`#1B65A6`，ring `#3D9BE0`，background `#F7FAFC`，foreground `#0F1B26`。
  - 暗色：primary（淡蓝直接作主色）`#8FCBF5`，primary-foreground `#0A2236`，background `#0E141B`，card `#151D26`，foreground `#E6EDF3`，accent `#1C3347`。
- 新增 `src/ui/theme/contrast.test.ts`：计算 WCAG 对比度，断言亮暗两套中所有"文字/背景"组合（foreground/background、primary-foreground/primary、muted-foreground/background、accent-foreground/accent、destructive-foreground/destructive、card-foreground/card）≥ 4.5。令牌值在一个 TS 文件中定义并生成/对应 CSS，保证测试检查的就是实际使用的值。
- 最终色值写入 `docs/decisions.md` 新增条目 D13（主色定稿）。
- 主题切换：跟随系统 / 亮 / 暗，存 localStorage；`index.html` 内联脚本在首帧前设置 class，避免闪烁；同步更新 `<meta name="theme-color">`。
- 尺寸覆盖（spec 6.1）：按钮与输入框高度 ≥ 44px、触摸区 ≥ 44×44、列表行 ≥ 48px、正文 16px、输入框 16px（防 iOS 放大）、安全区适配。修改 shadcn 组件源码实现，不要在业务里逐个覆盖。

## 2. 通用组件（src/ui/）
用 shadcn CLI 或手工加入：button、input、label、form（react-hook-form + zod）、card、separator、skeleton、dropdown-menu、dialog、drawer（vaul）、sonner、badge、avatar、switch、alert。
- **ResponsiveOverlay**：宽 < 640px 用 Drawer，≥ 640px 用 Dialog，统一 API（open、onOpenChange、title、description、children、footer）。业务代码不得直接区分。
- **返回手势关闭弹层（通用机制）**：`OverlayHistory` 管理器——弹层打开时 `history.pushState` 压入带标记的记录，按返回键/手势（popstate）时关闭**最上层**弹层而不是路由后退；代码关闭弹层时若栈顶是自己的记录则 `history.back()` 消耗掉；支持嵌套弹层；弹层打开期间发生路由跳转时正确清理。Drawer 下滑关闭、点遮罩关闭都走同一出口。写单元测试（jsdom 或 happy-dom）覆盖嵌套与代码关闭。
- **AppShell / TripLayout**：进入行程后底部导航 4 项：行程 / 账本 / 清单 / 更多（Lucide 图标 + 文字，选中态用 accent 背景）；宽 ≥ 840px 改为左侧导航栏，内容区 max-width（约 960px）居中。底部导航适配 `safe-area-inset-bottom`。
- **Fab**：右下角悬浮主操作按钮，避开底部导航与安全区。
- **Toast**：Sonner 底部居中；封装 `toast.undoable(message, onUndo)`。
- **SyncStatus**：常驻同步状态指示（已同步 / 同步中 / 离线（N 条待同步）/ 有修改未生效），本任务从 Zustand store 读取占位状态，M0.5 接入真实数据。
- **按钮加载态**：`<Button loading>` 显示 spinner 并禁用，防重复提交。
- 页面过渡与按压态：按钮 active 明显按压态（缩放或加深），尊重 `prefers-reduced-motion`。

## 3. API 客户端与鉴权（src/api、src/platform）
- openapi-fetch 客户端中间件：对非 GET 请求自动附加 `X-CSRF-Token`（读 `wp_csrf` Cookie，没有则先调 `GET /api/auth/csrf`）；CSRF 403 时刷新令牌重试一次；统一超时（如 15s，AbortController）；把错误体 `{error:{code,message}}` 转为类型化的 `ApiError`。
- `platform/auth`：接口 `{ mode: 'cookie' | 'bearer', getAuthHeaders(), onLogin(resp), onLogout() }`，Web 实现为 cookie；保留 bearer 实现骨架（token 存取经 `platform/secureStore` 接口，Web 下不实现）。
- `platform/` 下按 spec 7.6 建立 `storage`、`notify`、`share`、`pick`、`secureStore` 接口与 Web 默认实现（storage/notify 可先空实现+TODO，share 用 Web Share API 回退复制到剪贴板）。
- 会话状态 store（Zustand）：currentUser、status（unknown | authenticated | anonymous | expired）。启动时：先从 localStorage `wp:lastUser` 恢复（离线可启动），再请求 `/api/me` 校验；离线或网络错误时保持本地用户；401 → 若有本地用户则进入 `expired`（全局横幅"登录已失效，重新登录后继续同步"，数据只读），否则 anonymous。
- `navigator.storage.persist()` 在登录后申请一次；iOS Safari 且非 standalone 时显示一次性"添加到主屏幕"引导（可关闭，记住选择）。

## 4. 页面（src/features/，React Router v7 数据路由）
- `/login`、`/register`、`/forgot-password`、`/reset-password?token=`、`/verify-email?token=`：zod 校验、错误码映射为中文提示、限流 429 显示"请稍后再试"、`account_locked` 单独提示。登录后跳回 `?next=`（只允许站内相对路径，防开放重定向）。
- `/account`：昵称修改、修改密码、重发验证邮件（未验证时显示提示条）、主题切换、退出登录（本任务只清会话与 `wp:lastUser`；本地数据清空在 M0.6 接入，这里留钩子 `onBeforeLogout`）。
- `/`：已登录显示"我的行程"占位页（M0.5 实现），未登录跳 `/login`。
- `/join/:token`：调用 `GET /api/invites/{token}` 展示行程名与邀请人；已登录点"加入"→ accept → 跳转行程；未登录则引导登录/注册，完成后带 `next` 回到此页自动加入。
- `/trips/:tripId/*`：TripLayout + 四个占位子页面；"更多"页列出 凭证 / 投票 / 成员 / 设置 / 修改记录（链接占位）。
- 需联网的按钮在离线时置灰并提示"需要联网"（提供 `useOnline()` hook）。
- PWA 更新提示：接入 `virtual:pwa-register/react`，有新版本时显示提示条"有更新，点击刷新"。

## 5. PWA 资源与 Caddy 修正
- 生成 PNG 图标 192/512（含 maskable）与 `apple-touch-icon` 180，manifest 引用；iOS meta 标签（apple-mobile-web-app-capable、status-bar-style）。
- Caddyfile：`/assets/*` 不存在的文件应返回 404，而不是回退 index.html（目前会被回退且带 immutable 长缓存，有缓存毒化风险）。

## 6. Playwright
- 安装 @playwright/test 与 chromium（`npx playwright install chromium`，不要装全部浏览器）。配置两个项目：手机（375×812，isMobile、hasTouch）与桌面（1280×800）。baseURL 默认 `http://localhost:8088`（compose 栈），可用环境变量覆盖。
- 提供测试辅助：通过 mailpit API 取最新邮件链接。
- 用例：注册 → 收到验证邮件 → 打开链接验证成功 → 退出 → 登录 → 账户页改昵称；找回密码流程；手机视口下打开 Drawer 后 `page.goBack()` 关闭弹层且 URL/页面不后退；桌面视口同一操作显示为 Dialog；主题切换后刷新不闪烁（检查首帧 class）；离线（`context.setOffline(true)`）后刷新页面仍能打开应用外壳并显示本地用户。
- `make e2e`：确保 compose（含 dev profile 的 mailpit）已起、运行 Playwright。

## 验收（你必须全部跑通）
1. `make gen` 无差异；`npm run lint`、`npm run test -- --run`（含对比度与 OverlayHistory 测试）、`npm run build` 通过。
2. `docker compose --profile dev up -d --build` 后 `make e2e` 两个项目全部通过。
3. 用 Playwright 截取手机与桌面、亮与暗的登录页和行程占位页截图存到 `web/e2e/screenshots/`（加入 .gitignore，不提交），在最终回复里列出路径，供架构师查看。
4. 结束后 `docker compose --profile dev down`（不加 -v）；不要 prune、不要动其它项目。

## 约束
- 任务书即已确认方案，范围内改动均已批准，无需等待确认，直接实施。不要 git commit。不引用任何外部 CDN。最终回复用中文：完成内容、最终色值与对比度表、验收命令及结果、截图路径、偏离之处及原因。
