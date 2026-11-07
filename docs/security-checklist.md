# M5 安全自查

| 检查 | 结论与证据 |
| --- | --- |
| CSRF | Cookie 写请求校验双提交 token，Bearer 路径独立；TestCSRF 与账号 e2e 覆盖 |
| 会话 | 不透明令牌服务端哈希存储，httpOnly / SameSite / Secure Cookie；30 天、滚动续期、退出/改密/重置撤销，集成测试覆盖 |
| 限流 | IP 与账号分别限流，登录失败锁定；仅信任配置代理，集成测试覆盖 |
| Host 注入 | 邮件链接来自 PUBLIC_BASE_URL，配置不从请求 Host 推断；邀请链接由浏览器同源生成 |
| 文件类型 | 前后端按魔数验证，大小限制、幂等、SHA-256；M4 文件集成测试与 e2e 覆盖伪装文件/超限 |
| 签名 URL | HMAC 绑定 fileId、userId、到期时间；五分钟失效，下载仍校验身份与可见性 |
| 私有凭证 | 实体、操作、snapshot、history 按用户过滤；创建后禁止直接改可见性，M4 双用户测试覆盖 |
| CORS | 默认不启用跨域，白名单配置仅预留 |
| SQL | sqlc 查询及既有事务内直接 pgx 查询均使用参数绑定；恢复统计脚本中的动态表名用 PostgreSQL format %I 转义 |
| 依赖漏洞 | npm audit --omit=dev：0；govulncheck ./...：0。已将 x/crypto 定向升级到 v0.58.1-0.20261009181718-2f1f834330b2，消除未导入的 openpgp 模块公告 GO-2026-5932；无 high/critical 待修复 |
| 生产容器 | API/web 只读根、tmpfs、no-new-privileges、内存上限、日志轮转；PG 不暴露端口，固定基础镜像摘要 |
| CSP | 禁止外部来源、内联脚本与 `unsafe-eval`；`script-src 'self' 'wasm-unsafe-eval'` 仅允许同源脚本与 `libheif-js` WASM 编译，pdf.js 设置 `isEvalSupported: false`；因 `sonner`、`vaul`、`react-zoom-pan-pinch` 的 ESM 入口在加载时直接调用 `document.createElement('style')` 注入样式且无独立 CSS 导出，同时 `@radix-ui` 依赖的 `react-remove-scroll`/`react-style-singleton` 在弹层打开时动态注入 `<style>` 元素，故保留 `style-src 'self' 'unsafe-inline'`（残余风险：若存在 HTML 注入点可注入样式，但全站由 React 自动转义、未使用 `dangerouslySetInnerHTML`，且 `default-src/img-src/font-src/connect-src` 均锁定为 `'self'`，无法通过样式外带数据到外部源）；全套 e2e 已启用 `securitypolicyviolation` 与 console 0 违规断言 |
| 备份 | 成对备份数据库与 uploads，恢复到唯一临时库/目录，比较各表行数和文件数；精确一致备份须停 API |

自动检查不能代替人工渗透测试；上线前必须替换开发密钥、配置真实域名及 SMTP，限制管理入口。此次不对外发布。
