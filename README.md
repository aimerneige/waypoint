# Waypoint

结伴旅行应用。当前为 M0.1 骨架，仅提供首页、存活/就绪检查、数据库迁移与生成链路，无注册、行程或同步业务。

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

Compose 不对主机暴露 PostgreSQL。Linux worker 本地开发可取得容器地址：

```sh
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' waypoint-postgres-1
```

在单独终端导出 `.env` 配置，将 `DATABASE_URL` 中的 `postgres` 改为上述地址，将 `UPLOAD_DIR` 改为可写本地目录，再启动后端：

```sh
set -a
. ./.env
set +a
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@<容器IP>:5432/${POSTGRES_DB}?sslmode=disable"
export UPLOAD_DIR=/tmp/waypoint-uploads
cd api && go run ./cmd/api
```

Rootless Docker 无法从主机直连容器 IP 时，可在 Compose 网络内运行 Go 命令，例如（在项目根目录）：

```sh
docker run --rm --network waypoint_default \
  -v "$PWD/api:/src" -w /src \
  -e 'TEST_DATABASE_URL=postgres://waypoint:waypoint_dev_only@postgres:5432/waypoint?sslmode=disable' \
  golang:1.26 sh -c 'go vet ./... && go test ./...'
```

其他平台可使用 Docker 提供的端口转发开发方式；生产 Compose 仍只暴露 web。前端另开终端执行 `cd web && npm run dev`，Vite 将 `/api` 代理到本地 8080。`VITE_API_BASE_URL` 为构建时可选配置，默认同源相对路径。

```sh
make test
make lint
make build
# 使用专用测试数据库；测试会创建 app_meta，但不会清库
cd api
TEST_DATABASE_URL='<真实 PostgreSQL 连接串>' go test ./...
go vet ./...
```

未设置 `TEST_DATABASE_URL` 时仅跳过真实数据库集成测试。集成测试验证迁移可重复执行、sqlc 查询、健康接口与数据库不可用时的 503。Go 工具由 go.mod 的 tool 指令管理，使用 `go tool oapi-codegen`、`go tool sqlc`、`go tool goose`，无需全局安装。修改接口后运行 `make gen`，一并保留生成文件；禁止手改生成文件。

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

上线前替换数据库密码、签名密钥、SMTP 参数、站点地址和 PUBLIC_BASE_URL。SMTP 在此阶段仅校验配置，不发送邮件。API 使用非 root 静态镜像，收到 SIGTERM 后优雅关闭，启动时自动执行嵌入式迁移。`PORT` 在本地可改，Compose 固定为 8080 以匹配反代。配置错误会在启动时明确报出变量名。

默认站点为纯 HTTP，主机端口 8088/8443，可通过 WEB_HTTP_PORT/WEB_HTTPS_PORT 调整。正式 HTTPS 部署应配置站点及外部端口转发。所有服务带健康检查；备份健康检查检测循环心跳，备份失败导致进程退出并由 Compose 重启。备份容器每日执行一次，BACKUP_ON_START=1 可启动即执行。每次备份目录同时包含 PostgreSQL custom-format dump 和 uploads.tar.gz，成功后才发布目录；保留由 BACKUP_KEEP_DAYS 控制（默认 14，按整日清理）。`down` 保留四个数据卷，禁止误用 `down -v`。

恢复时先停止 API 写入，在独立数据库验证 `pg_restore`，同时还原配套 uploads 归档后再切换。不要只恢复其中一份。当前骨架没有上传写入，后续上传业务需配合备份一致性策略。

MAX_UPLOAD_MB 默认 32；CADDY_MAX_BODY_SIZE 默认 33MB（请求封装余量），调整时同步修改。CORS_ALLOWED_ORIGINS 只预留配置，尚未启用跨域行为。PWA 仅预缓存应用外壳，不缓存 API；更新策略为 prompt，页面提示后由用户点击刷新。字体与图标均随应用打包，不访问外部 CDN。

此任务不实现 M0 后续子任务中的鉴权、平台能力、同步协议、持久存储申请或响应式弹层。
