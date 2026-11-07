# 部署与升级

Waypoint 只准备部署，不在本次任务中对外发布。API 单实例；不要横向扩容，否则内存限流和 SSE 广播不能跨实例工作。

## 主机与网络

建议 Linux、2 CPU、4GB RAM、至少 20GB 可用磁盘，安装 Docker Engine 与 Compose v2。另为数据库、凭证及 14 天备份预留容量。只向公网开放 TCP 80/443（SSH 仅管理网）；PostgreSQL 和 API 不映射端口。将真实域名 A/AAAA 指向主机，确认 IPv6 路由可用后再发布 AAAA。

`.env` 中填写 `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、同凭据的 `DATABASE_URL`、`SIGNING_KEY`、`PUBLIC_BASE_URL=https://你的域名`、`WAYPOINT_DOMAIN=你的域名`、`COOKIE_SECURE=true`。公网使用 `WEB_HTTP_PORT=80`、`WEB_HTTPS_PORT=443`，不要给真实域名加 `http://`，Caddy 会自动申请及续期 ACME 证书。`WAYPOINT_TLS` 留空。使用 `openssl rand -hex 32` 分别生成数据库密码和签名密钥；不要复用示例密钥或提交 `.env`。

SMTP 必填：`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`，以及 `SMTP_TLS_MODE=starttls`（通常 587）或 `implicit`（通常 465）。配置发信域 SPF/DKIM/DMARC。注册测试账号，收取验证邮件，验证链接只包含 PUBLIC_BASE_URL；再执行找回密码并验证重置链接一次性使用。开发 Mailpit 的明文模式不能用于正式部署。

## 首次启动

1. 检查 `.env` 权限（`chmod 600 .env`）、域名、SMTP、卷备份容量和防火墙。
2. `docker compose build`，随后 `docker compose up -d --wait`。迁移由 API 自动执行。
3. `docker compose ps` 确认健康；`curl -f https://你的域名/api/readyz`；检查 SPA 深链接及安全响应头。
4. 注册、验证邮箱、创建行程、邀请另一账号、上传共享/私有凭证、离线修改后恢复网络，确认无 CSP 错误。
5. 停止 API，执行一次备份及恢复演练（README），然后重新启动 API。
6. 不启用 dev profile，不公开 Mailpit；不要使用 `down -v`。

CSP 禁止所有外部来源。`style-src 'unsafe-inline'` 用于 Radix/Vaul/缩放布局；现有 heic2any 解码器在 Blob Worker 内使用 `new Function`，因此 script-src 保留 `unsafe-eval`。不允许内联脚本，主题初始化使用同源 theme-init.js；替换 HEIC 解码器后应移除此例外。文件仅使用同源及 blob/data 图片，Worker 仅同源及 blob。

## 本地 HTTPS 验证

先关闭开发服务（不删卷），然后：

```sh
AUTH_RATE_LIMIT_IP_PER_MINUTE=6000 AUTH_RATE_LIMIT_ACCOUNT_PER_MINUTE=6000 docker compose -f docker-compose.yml -f docker-compose.prod-local.yml --profile dev up -d --build --wait
cd web
E2E_BASE_URL=https://localhost:8443 npx playwright test
cd ..
docker compose -f docker-compose.yml -f docker-compose.prod-local.yml --profile dev down
```

prod-local 强制 `tls internal` 和 Secure Cookie。Playwright 配置接受本地 CA；手工浏览器需信任 Caddy CA。此处 dev profile 只用于验证邮件，命令中的临时环境变量提高密集验收的注册限流；不要写入正式 `.env`。不叠加 dev 覆盖文件，保证 PostgreSQL 不暴露端口；正式部署仍使用默认限流，并由独立集成测试验证限流行为。

Chromium 的 Service Worker 脚本拉取不继承 context 的 `ignoreHTTPSErrors`，因此配置仅在目标为 `https://localhost` 时添加浏览器级 `--ignore-certificate-errors`。此例外只用于本地自签 CA 验收，真实域名不会启用该浏览器参数。

## 升级与回滚

升级前记录 git revision 及 `docker compose images` 的镜像 ID，给当前 api/web 镜像添加保留标签；暂停 API 写入并备份成对的数据库和 uploads。拉取代码后 `docker compose build` → `docker compose up -d --wait` → 检查 readyz、日志及冒烟流程。构建后只按已记录 ID 删除本项目不再使用的旧镜像，禁止全局 prune。发布镜像和基础镜像固定版本/摘要；新版本应使用新的发布标签保留可回滚产物。

仅应用回滚：将保留镜像重新标为 Compose 的 waypoint-api:m5 / waypoint-web:m5，`docker compose up -d --no-build --wait`。数据库迁移不保证可逆：若旧二进制不兼容新 schema，停止 API，恢复升级前数据库与配套 uploads，再启动旧镜像；不要盲目执行 down migration。

`schemaVersion` 升级需保留旧队列兼容或明确返回 upgrade_required，不能静默丢弃离线 op。先验证旧版本排队操作，再发布新客户端；提示用户更新 Service Worker。IndexedDB 升级需使用新增版本迁移，不可删除用户队列。

## 监控

从 HTTPS 外部探测 `/api/readyz`，监控响应时间、5xx、容器重启/OOM、数据库与 uploads/备份磁盘容量、最近成功备份时间、SMTP 失败及证书到期。日志已按 10MB × 3 轮转，备份失败会退出并由 Compose 重启；至少定期异机复制加密备份并执行恢复演练。不要在监控记录会话、验证码或签名下载 URL。
