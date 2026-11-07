# 任务 M5：手机端打磨 + 端到端测试补全 + 部署准备

前置：M0–M4 已完成。先阅读 `spec.md` 第 6、7.4、8 节，`docs/decisions.md`，README，以及全部前端页面与 e2e。
任务书即已确认方案，范围内改动均已批准，无需等待确认，直接实施。不要 git commit。

## 1. 手机端打磨（以 375×812 为基准，同时检查 320 宽与 ≥840 桌面）
逐页审查并修复（列出修复清单写入最终回复）。**先处理 `docs/polish-backlog.md` 中的全部条目**，再做以下检查：
- 尺寸规范（spec 6.1）：所有可点元素 ≥44×44、相邻间距 ≥8、列表行 ≥48、正文 16px。写一个 Playwright 检查脚本：遍历主要页面，查找可见的 button/a/[role=button]/input，报告小于 44×44 的元素（允许白名单需注明理由），作为 e2e 用例。
- 安全区：底部导航、Fab、底部面板在 iPhone 刘海/手势条下不被遮挡（Playwright 用 CSS 注入模拟 safe-area 值截图检查）。
- 空状态：每个列表（行程、心愿、账目、钱包、行李、投票、凭证、提示、修改记录）都有带说明与主操作的空状态。
- 加载与骨架：本地数据首次加载前显示骨架，不闪烁空状态。
- 长文本：标题/地点/预订信息超长时截断或换行合理，不撑破布局（e2e 用 200 字标题截图检查）。
- 无障碍：所有图标按钮有 aria-label；表单错误与输入关联（aria-describedby）；焦点可见；Drawer/Dialog 打开时焦点移入、关闭后返回触发元素。用 `@axe-core/playwright` 对主要页面跑检查，0 个 serious/critical 违规。
- 性能：首屏 JS（gzip）目标 ≤ 250KB，超出则按路由拆分（React.lazy）；记录优化前后体积。本地数据读取页面切换无可感知延迟（e2e 中对 1000 条行程项 + 1000 笔账目的行程，切换 tab 后 300ms 内渲染完成）。
- iOS 体验：输入框聚焦不放大（16px）、`overscroll-behavior` 防止下拉露底、主屏启动有合适的 `apple-touch-startup-image` 或背景色、状态栏颜色随主题。
- 处理 lint 中遗留的 react-refresh 警告。

## 2. 端到端测试补全
- 汇总一份覆盖矩阵（`docs/e2e-coverage.md`）：spec 每个功能点 → 对应用例；补齐缺失项。
- 跨模块离线大场景（`web/e2e/m5-offline-journey.spec.ts`）：两人行程，A、B 都离线一段"旅途"：安排心愿、改行程、记账（刷卡外币 + 现金）、勾行李、投票、上传凭证；途中 A 关闭投票（在线）；恢复网络后断言：两边所有页面数据一致、冲突提示正确、被拒操作（截止后的投票）回滚、结算结果两边相同。
- 稳定性：`make e2e` 连续 5 次 0 失败；全套用时记录在回复中。
- `make e2e` 同时跑手机与桌面两个项目；新增 `make e2e-ui` 便于本地调试（可选）。

## 3. 部署准备（不对外发布，只准备与本地验证）
- 生产 Compose 审查：镜像固定版本（不使用 latest）、`restart`、资源限制（api 512M、postgres 1G、web 256M 可调）、日志轮转（json-file max-size/max-file）、只读根文件系统（api 可用 `read_only: true` + tmpfs）、`no-new-privileges`、postgres 不暴露端口。
- Caddy：`WAYPOINT_DOMAIN` 为真实域名时自动 HTTPS（ACME）；添加安全响应头（HSTS、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、CSP：`default-src 'self'`，按实际需要放行 `img-src blob: data:`、`worker-src 'self' blob:` 等，不允许任何外部来源），并确认应用在该 CSP 下全部功能正常（e2e 在生产模式 compose 下跑一遍）。
- 本地模拟生产：提供 `docker-compose.prod-local.yml`（或文档步骤），以 `WAYPOINT_DOMAIN=localhost` + Caddy `tls internal` 在 8443 跑 HTTPS，`COOKIE_SECURE=true`，Playwright（ignoreHTTPSErrors）跑一遍冒烟用例。
- 备份与恢复演练脚本 `scripts/restore-drill.sh`：从 backups 卷最新备份恢复到临时数据库与临时 uploads 目录，校验表行数与文件数量一致；在 README 写恢复步骤。
- 升级流程文档：拉代码 → `docker compose build` → `up -d`（迁移自动执行）→ 回滚方式；schemaVersion 升级时的注意事项。
- `docs/deploy.md`：服务器要求、DNS、防火墙（只开 80/443）、`.env` 必填项与生成强随机 `SIGNING_KEY` / 数据库密码的命令、SMTP 配置与测试方法、首次启动检查清单、监控建议（`/api/readyz`）。
- 安全自查清单（写入 `docs/security-checklist.md` 并逐项给出结论）：CSRF、会话、限流、Host 头不参与链接生成、文件魔数校验、签名 URL、私有凭证不可见、CORS 默认关闭、SQL 全部参数化（sqlc）、依赖漏洞（`npm audit --omit=dev`、`govulncheck ./...` 结果，修复 high 及以上）。

## 验收（你必须全部跑通）
1. `make gen` 无差异；`go vet`、`govulncheck`、`make test-integration`、前端 lint（0 警告）/ 单测 / build 通过。
2. `make e2e` 连续 5 次 0 失败（含尺寸检查、axe 检查、离线大场景）。
3. 本地 HTTPS 生产模式冒烟通过；恢复演练脚本成功。
4. 截图（不提交）：每个主要页面手机亮/暗、320 宽关键页、桌面主要页。
5. 结束后 `docker compose --profile dev down`（及 prod-local 的 down，不加 -v）；不要 prune、不要动其它项目。

最终回复用中文：打磨修复清单、体积前后对比、e2e 5 次结果与用时、安全清单结论、部署前需要用户提供的信息（域名、SMTP 账号等）、偏离之处及原因。
