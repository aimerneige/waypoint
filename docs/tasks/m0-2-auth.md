# 任务 M0.2：后端账号与鉴权

前置：M0.1 骨架已完成。先阅读 `spec.md` 第 1 节、第 7.2/7.3 节，`docs/decisions.md` D2/D7/D8，以及现有 `api/`、`openapi/openapi.yaml` 结构，沿用其约定（strict server、sqlc、goose embed、slog）。
本任务只做**后端**（含 OpenAPI 契约与 `make gen` 后的前端类型更新），不做前端页面。

## 数据表（goose 新迁移）
- `users`：id uuid、email（citext 或小写归一化后唯一）、password_hash、nickname、avatar_url null、email_verified_at null、created_at、updated_at。
- `sessions`：id、user_id、token_hash（sha256，唯一索引）、created_at、last_seen_at、expires_at、user_agent、ip。数据库**只存哈希**。
- `email_tokens`：id、user_id、purpose（verify_email | reset_password）、token_hash 唯一、expires_at、used_at null、created_at。
- `login_failures`（或 users 上的计数字段）：记录连续失败次数与锁定截止时间。

## 规则
- 令牌：32 字节 crypto/rand，base64url 编码；会话令牌、邮件令牌均只存 sha256 哈希。
- 密码：argon2id（x/crypto/argon2），参数写成常量（如 m=64MiB, t=3, p=2），编码为 PHC 字符串以便将来升级参数；最少 8 位。
- 会话有效期 30 天，滚动续期：每次请求若距上次续期超过 24 小时则把 expires_at 延到 now+30d（避免每个请求都写库）。
- Cookie：名 `wp_session`，httpOnly、SameSite=Lax、Path=/、Secure 由配置 `COOKIE_SECURE`（默认 true；`.env.example` 开发时说明 localhost 下浏览器允许 Secure Cookie）。
- Bearer：`Authorization: Bearer <token>` 与 Cookie 共用 sessions 表。登录/注册请求体可带 `tokenDelivery: "cookie" | "bearer"`（默认 cookie）；bearer 时在响应体返回令牌、不设 Cookie。
- CSRF：双提交令牌。服务器在任意响应中若无 `wp_csrf` Cookie 则下发（非 httpOnly、SameSite=Lax、随机值）；对 Cookie 鉴权的非安全方法（POST/PUT/PATCH/DELETE）要求请求头 `X-CSRF-Token` 等于该 Cookie，否则 403。Bearer 鉴权请求跳过 CSRF。未登录的写接口（注册、登录、找回密码等）同样校验 CSRF。提供 `GET /api/auth/csrf` 让前端获取/刷新。
- 鉴权中间件把当前 user 与 session 放入 context；提供统一的"需登录"包装，未登录返回 401（错误体格式统一，见下）。
- 统一错误响应：`{ "error": { "code": "snake_case_code", "message": "中文提示" } }`，在 OpenAPI 中定义为公共组件并用于所有接口。
- 限流：进程内令牌桶，按 IP 与按账号（邮箱）两个维度，作用于登录、注册、找回密码、重发验证邮件；超限返回 429 + Retry-After。连续登录失败 10 次锁定账号 15 分钟（写数据库），锁定期间返回与密码错误不同的错误码 `account_locked`。
- 客户端 IP：只有当直连地址属于 `TRUSTED_PROXIES`（CIDR 列表，默认 compose 内网常见网段 + 127.0.0.1/8）时才采信 `X-Forwarded-For`。
- 邮件：定义 `Mailer` 接口，实现 SMTP（net/smtp 或成熟库，支持 STARTTLS/隐式 TLS，按 SMTP_* 配置）与 `log` 实现（SMTP_HOST 为空时打印到日志，便于开发）。发送放 goroutine/简单队列，**失败不影响注册结果**，记日志。邮件正文中文，链接一律用 `PUBLIC_BASE_URL` 拼接，**禁止使用请求 Host**。前端路由约定：`/verify-email?token=…`、`/reset-password?token=…`。
- 邮箱验证：注册后发送；24 小时有效、一次性；重发会作废旧的未用令牌；已验证用户重发直接返回成功。
- 找回密码：30 分钟有效、一次性；无论邮箱是否存在都返回相同响应；重置成功后删除该用户全部会话。
- 修改密码（需旧密码）：删除该用户**其它**会话，保留当前会话。
- 注销：删除当前会话并清 Cookie。

## 接口（全部写进 openapi.yaml）
- `GET  /api/auth/csrf`
- `POST /api/auth/register` {email, password, nickname, tokenDelivery?} → 用户 + （bearer 时）token
- `POST /api/auth/login` {email, password, tokenDelivery?}
- `POST /api/auth/logout`
- `POST /api/auth/verify-email` {token}
- `POST /api/auth/resend-verification`（需登录）
- `POST /api/auth/forgot-password` {email}
- `POST /api/auth/reset-password` {token, newPassword}
- `POST /api/auth/change-password` {oldPassword, newPassword}（需登录）
- `GET  /api/me`、`PATCH /api/me` {nickname?, avatarUrl?}
- 用户对象：id、email、nickname、avatarUrl、emailVerified。

## Compose
- 新增 `mailpit` 服务，放在 compose profile `dev` 中（`docker compose --profile dev up`），Web UI 端口映射到主机 `MAILPIT_UI_PORT`（默认 8025）；`.env.example` 注明开发时 `SMTP_HOST=mailpit SMTP_PORT=1025`。
- 新增配置 `COOKIE_SECURE`、`TRUSTED_PROXIES` 写入 config 与 `.env.example`。

## 测试（必须）
- 单测：argon2 编码/校验、令牌生成与哈希、限流器、可信代理 IP 解析、CSRF 中间件。
- 集成测试（真实 PostgreSQL，TEST_DATABASE_URL）覆盖：注册→登录→/me→注销后 401；Cookie 写请求缺 CSRF 头被拒、Bearer 写请求无需 CSRF；滚动续期；邮箱验证令牌一次性与过期；找回密码对不存在邮箱响应相同、重置后旧会话全部失效；修改密码保留当前会话；连续失败锁定；限流 429。邮件用测试 Mailer 捕获内容，断言链接以 PUBLIC_BASE_URL 开头且与请求 Host 无关。

## 验收（你必须全部跑通）
1. `make gen` 后无多余差异；`go vet ./...`、`go test ./...`（含集成测试）通过；前端 `npm run lint && npm run build` 仍通过。
2. `docker compose --profile dev up -d --build` 后用 curl 走一遍：取 CSRF → 注册 → 在 mailpit API（`http://localhost:8025/api/v1/messages`）里看到验证邮件且链接以 PUBLIC_BASE_URL 开头 → 验证邮箱 → /me 显示 emailVerified=true → 注销。
3. 结束后 `docker compose --profile dev down`（不加 -v）。不要 `docker system prune`，不要动其它项目的容器镜像。

## 约束
- 不要 git commit。最终回复用中文：完成内容、新增接口列表、验收命令及实际结果、偏离任务书之处及原因。
