# Waypoint

结伴旅行应用。已实现账号、行程与成员管理、离线行程条目、按字段同步、冲突恢复、未生效修改重试及本地修改记录。

## 环境与目录

需要 Go 1.26、Node.js 22、npm、Docker Compose。

```text
openapi/openapi.yaml          唯一接口契约
api/cmd/api/                  API 入口及 healthcheck 子命令
api/internal/config/          环境变量配置与测试
api/internal/httpapi/         strict server 生成代码及实现
api/internal/db/queries/      SQL 查询；父目录为 sqlc 生成代码
api/migrations/               嵌入式 goose 迁移
web/src/api/                  生成类型、可配置 API 客户端
web/src/{domain,data,sync,platform,ui,features}/
deploy/Caddyfile              静态文件、SPA 回退、API 反代
deploy/backup/                每日数据库及 uploads 备份
```

## 开发

```sh
cp .env.example .env
cd web && npm ci && cd ..
make gen
make dev-db
```

`make dev-db` 使用 `docker-compose.dev.yml`，只启动 PostgreSQL，将端口映射到 `127.0.0.1:${DEV_DB_PORT:-55432}`，供支持回环端口转发的本机开发和 psql 使用。Rootless Docker 的 pasta + implicit 端口驱动不转发此回环端口；不要为此将数据库改绑 `0.0.0.0`，该环境可使用 Compose 内的 API 和下述容器测试。生产 Compose 不暴露数据库。支持回环转发的环境可导出 `.env`，改用主机地址和可写目录，再启动后端：

```sh
set -a
. ./.env
set +a
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${DEV_DB_PORT:-55432}/${POSTGRES_DB}?sslmode=disable"
export UPLOAD_DIR=/tmp/waypoint-uploads
export SMTP_HOST= # 本地开发将邮件及链接写入日志
cd api && go run ./cmd/api
```

前端另开终端执行 `cd web && npm run dev`，Vite 将 `/api` 代理到本地 8080。`VITE_API_BASE_URL` 为构建时可选配置，默认同源相对路径。

```sh
make test
make lint
make build
make test-integration
cd api && go vet ./...
```

`make test-integration` 自动启动 PostgreSQL、创建独立的 `waypoint_test` 库，再通过开发覆盖文件中 `test` profile 的 `gotest` 服务运行 `go test -race -count=1 -v ./...`。该服务使用 `golang:1.26`，挂载 `./api`，通过 Compose 网络连接 `postgres:5432/waypoint_test`；数据库账号由 Compose 读取 `.env`，不依赖主机数据库端口或临时转发。`GOMODCACHE`、`GOCACHE` 分别使用命名卷缓存，`--rm` 自动删除测试容器。测试只清理自己创建的账号，不使用开发库。直接运行 `go test` 且未设置 `TEST_DATABASE_URL` 时跳过数据库测试。集成测试覆盖账号生命周期、CSRF、令牌有效期及一次性、会话撤销、滚动续期、账号锁定与限流。Go 工具由 go.mod 的 tool 指令管理，无需全局安装。修改接口或 SQL 后运行 `make gen`，一并保留生成文件；禁止手改生成文件。

Mailpit 放在主 Compose 的 `dev` profile：`docker compose --profile dev up -d --build`，Web UI 和 API 位于 `http://localhost:${MAILPIT_UI_PORT:-8025}`。默认 `MAILPIT_BIND=127.0.0.1`；Rootless Docker（pasta）环境需要在 `.env` 中设 `MAILPIT_BIND=0.0.0.0` 才能从主机访问，这会向局域网开放 Mailpit，仅限开发使用，数据库仍只绑定回环。开发 `.env` 配置 `SMTP_HOST=mailpit SMTP_PORT=1025 SMTP_TLS_MODE=none`，账号密码留空。正式 SMTP 使用 `SMTP_TLS_MODE=starttls`（默认）或 `implicit`，并填写对应端口及凭据。邮件使用容量 64 的单 worker 队列，发送失败或队列满只记日志，不回滚注册；用户可重发。邮件链接始终取自 `PUBLIC_BASE_URL`。结束后执行 `docker compose --profile dev down`（不加 `-v`），保留数据库及缓存卷。

Cookie 默认 `COOKIE_SECURE=true`；localhost 下浏览器允许 Secure Cookie，非 localhost 的纯 HTTP 开发需显式设为 false。写请求先 `GET /api/auth/csrf` 获取 `wp_csrf`，随后携带同值 `X-CSRF-Token`。登录/注册默认交付 httpOnly 会话 Cookie，`tokenDelivery=bearer` 时仅返回令牌，后续有效 Bearer 请求免 CSRF。会话 30 天有效，每隔 24 小时续期；退出、重置密码会立即撤销相应会话。限流按 IP（突发 60）和邮箱（突发 20）分别每分钟补一个令牌，四个受限接口共享额度，超限返回 429 和 Retry-After。连续失败 10 次锁定 15 分钟。只有直连 IP 属于 `TRUSTED_PROXIES` 才信任转发头，并从右向左查找首个非可信代理地址。

## 部署与备份

```sh
cp .env.example .env
docker compose up -d --build
docker compose ps
curl -f http://localhost:8088/api/readyz
curl -f http://localhost:8088/
curl -f http://localhost:8088/some/spa/route
docker compose exec backup sh /backup/run.sh
docker compose exec backup find /backups -maxdepth 2 -type f
docker compose down
```

上线前替换数据库密码、签名密钥、SMTP 参数、站点地址和 PUBLIC_BASE_URL；生产 SMTP 应配置 TLS。API 使用非 root 静态镜像，收到 SIGTERM 后优雅关闭，启动时自动执行嵌入式迁移。`PORT` 在本地可改，Compose 固定为 8080 以匹配反代。配置错误会在启动时明确报出变量名。

默认站点为纯 HTTP，主机端口 8088/8443，可通过 WEB_HTTP_PORT/WEB_HTTPS_PORT 调整。正式 HTTPS 部署应配置站点及外部端口转发。所有服务带健康检查；备份健康检查检测循环心跳，备份失败导致进程退出并由 Compose 重启。备份容器每日执行一次，BACKUP_ON_START=1 可启动即执行。每次备份目录同时包含 PostgreSQL custom-format dump 和 uploads.tar.gz，成功后才发布目录；保留由 BACKUP_KEEP_DAYS 控制（默认 14，按整日清理）。`down` 保留四个数据卷，禁止误用 `down -v`。

恢复时先停止 API 写入，在独立数据库验证 `pg_restore`，同时还原配套 uploads 归档后再切换。不要只恢复其中一份。当前骨架没有上传写入，后续上传业务需配合备份一致性策略。

MAX_UPLOAD_MB 默认 32；CADDY_MAX_BODY_SIZE 默认 33MB（请求封装余量），调整时同步修改。CORS_ALLOWED_ORIGINS 只预留配置，尚未启用跨域行为。PWA 仅预缓存应用外壳，不缓存 API；更新策略为 prompt，页面提示后由用户点击刷新。字体与图标均随应用打包，不访问外部 CDN。

## 浏览器端到端验收

```sh
cd web && npx playwright install chromium && cd ..
docker compose --profile dev up -d --build --wait
make e2e
# 稳定性验收：每轮重置 API 内存中的注册限流，保留数据库
for round in 1 2 3; do
  docker compose restart api && make e2e || break
done
docker compose --profile dev down
```

Playwright 包含手机和桌面项目；`web/e2e/m0-sync.spec.ts` 在两个独立手机浏览器上下文中覆盖离线合并、冲突恢复、拒绝回滚与重试、删除后编辑、成员移除和离线退出清理。所有同步等待使用状态或可见数据条件，无固定 sleep。测试需开发 Mailpit 可从主机访问；失败的截图和 trace 位于 `web/test-results/`。M0 手机亮暗截图自动输出至 `web/e2e/screenshots/m0-{itinerary,editor,conflicts,rejected,history}-{light,dark}.png`，不提交。不要同时运行会重建相同 Compose 服务的集成测试和 e2e。
