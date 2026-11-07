# 任务 M5b：上线前加固——收紧 CSP + 凭证全屏查看

前置：M0–M5 已完成（HEAD 649b710）。先阅读 `docs/handoff.md`、`docs/security-checklist.md`、`docs/deploy.md`、`deploy/Caddyfile`、`docker-compose.prod-local.yml`、`web/src/features/voucher-*.tsx`、`web/src/ui/responsive-overlay.tsx`、`web/src/ui/overlay-history.ts`。
任务书即架构师已确认的方案，范围内改动（含替换依赖）均已批准，无需等待确认，直接实施。不要 git commit。

## 1. 收紧 CSP
目标 CSP（以生产 Caddyfile 为准）：
```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';        # 见下方第 3 点，能收紧则收紧
img-src 'self' blob: data:;
font-src 'self';
connect-src 'self';
worker-src 'self' blob:;
frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
```
1. **移除 `script-src 'unsafe-eval'`**：用基于 libheif 的 WASM 方案替换 `heic2any`（如 `heic-to` 或 `libheif-js` 的 wasm 构建，自行评估选型：维护状态、包体积、是否需要 eval）。要求：WASM 文件随应用打包、同源加载，不使用任何 CDN；保持懒加载独立 chunk，不进入首屏（`npm run build` 的首屏预算检查仍需通过）；HEIC/HEIF 转 JPEG 质量 0.9 左右，保留现有魔数检测逻辑。
2. **pdf.js 不得依赖 eval**：确认 `pdfjs-dist` 调用时设置 `isEvalSupported: false`，worker 同源加载。
3. **style-src**：尝试拆分为 `style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'`（只允许内联 style 属性，不允许运行时注入 `<style>` 元素）。若 Sonner、vaul 等库运行时注入 `<style>` 元素导致失效，优先改为构建期静态引入它们的 CSS（如 sonner 的样式文件）；确实无法做到时保留 `style-src 'self' 'unsafe-inline'`，并在 security-checklist 中写明原因与残余风险。
4. **CSP 违规检测**：新增 e2e 辅助：每个页面注入 `securitypolicyviolation` 事件监听并收集 console 中的 CSP 报错，用例结束时断言为空。对所有现有用例启用（fixture 方式），确保全应用在严格 CSP 下 0 违规。dev 栈的 Caddy 也必须下发与生产相同的 CSP（若当前只在生产配置中下发，改为共用片段），这样 `make e2e` 就能发现违规。
5. 更新 `docs/security-checklist.md`、`docs/deploy.md` 中 CSP 相关条目，删除"保留 unsafe-eval"的偏离说明。

## 2. 凭证全屏查看
当前查看层仍露出应用顶栏，PDF 默认 50% 偏小。要求：
- 查看层通过 Portal 渲染，`position: fixed; inset: 0`，覆盖整个视口（包括应用顶栏、底部导航），z-index 高于所有页面元素；背景使用 `--background`（暗色主题同样适配）；适配 `safe-area-inset-*`。
- 顶部栏：返回（← 图标按钮，aria-label"关闭"）、标题（单行截断）、分享/保存（图标按钮）。顶部栏之外区域全部用于内容。
- PDF：默认**适应宽度**（按容器宽度计算缩放，窗口尺寸/旋转变化时重新适配）；支持双指缩放与 +/− 按钮；纵向连续滚动显示所有页（懒渲染可见页附近的页面，避免大 PDF 一次渲染全部）；页码指示"第 i / N 页"浮于底部。
- 图片：默认适应屏幕（contain），双指缩放、双击放大/还原，缩放后可拖动。
- "关联的行程"等元信息移到顶部栏的 ⓘ 信息按钮中（打开小弹层），不占用查看区域。
- 关闭方式：返回按钮、手机返回手势（复用 OverlayHistory）、桌面 Esc 键；关闭后焦点回到触发元素。
- 打开时锁定背景页面滚动。

## 3. 测试
- Playwright：手机视口打开 PDF 与图片凭证，断言查看层边界等于视口（顶栏不可见：`elementFromPoint` 于顶部 10px 处命中查看层而非应用顶栏）、PDF canvas 宽度 ≥ 视口宽度的 90%、`page.goBack()` 关闭查看层、Esc 关闭（桌面）。
- HEIC 样本上传在严格 CSP 下成功转换并可查看（无 CSP 违规）。
- 截图（不提交）：手机与桌面、亮与暗的 PDF 与图片全屏查看。

## 验收（你必须全部跑通）
1. `make gen` 无差异；`cd api && go vet ./...`、`make test-integration` 通过；`cd web && npm run lint`（0 警告）、`npm run test -- --run`、`npm run build`（首屏预算通过，列出 HEIC/PDF chunk 与 wasm 文件大小）。
2. `make e2e` 连续 2 次全部通过，且所有用例 0 CSP 违规。
3. 本地 HTTPS 生产模式（`docker-compose.prod-local.yml`）下全套 e2e 通过，`curl -sI https://localhost:8443/` 输出的 CSP 头与本任务目标一致（在回复中贴出）。
4. 结束后 `docker compose --profile dev down` 及 prod-local 栈 down（不加 -v）。磁盘仅约 21G：禁止 `docker system prune` / `builder prune`，不要动其它项目，避免留下悬空镜像。
5. 不要 git commit。最终回复用中文：CSP 最终值、HEIC 方案选型理由与体积、style-src 能否收紧及原因、查看器改动、验收命令与结果、截图路径、偏离之处。
