# 任务 M0.1：项目骨架 + Docker Compose + OpenAPI 生成链路

先完整阅读 `spec.md`（尤其第 7 节）与 `docs/decisions.md`。本任务**只搭骨架**，不实现注册登录、行程、同步等业务（后续子任务做）。

## 目录结构（必须遵守）
```
waypoint/
  openapi/openapi.yaml        # 唯一接口契约，OpenAPI 3.0.x
  api/                        # Go 后端，module 名 `waypoint`
    cmd/api/main.go
    internal/config/          # 环境变量配置，缺必填项启动即失败并给出明确错误
    internal/httpapi/         # oapi-codegen 生成代码（gen.go）+ handler 实现
    internal/db/              # sqlc 生成代码
    internal/db/queries/*.sql
    migrations/*.sql          # goose 迁移，用 embed 打包进二进制，启动时自动执行
    sqlc.yaml  oapi-codegen.yaml
  web/                        # 前端
    src/domain/ data/ sync/ platform/ ui/ features/   # 按 spec 7.5 分层，先放 index.ts 占位
    src/api/schema.d.ts       # 由 openapi.yaml 生成
  deploy/Caddyfile
  deploy/backup/              # 备份脚本
  Dockerfile.web  Dockerfile.api（或单个多 target Dockerfile）
  docker-compose.yml
  .env.example
  Makefile                    # 常用命令入口
  README.md                   # 开发与运行说明（中文）
```

## 后端要求
- Go 1.26（worker 已装）。chi 路由 + oapi-codegen 生成 **strict server**（chi-server）。
- 代码生成工具（oapi-codegen、sqlc、goose）通过 go.mod 的 `tool` 指令管理，用 `go tool xxx` 调用，不要求全局安装。
- pgx v5 连接池；goose 迁移 embed 进二进制，启动时自动执行；先建一张最小表证明链路通（如 `app_meta`），并给 sqlc 一条查询。
- log/slog JSON 日志；优雅关闭（SIGTERM）。
- 配置项至少：`PORT`(默认 8080)、`DATABASE_URL`、`PUBLIC_BASE_URL`、`SIGNING_KEY`、`UPLOAD_DIR`、`MAX_UPLOAD_MB`(默认 32)、`SMTP_HOST/PORT/USER/PASSWORD/FROM`、`CORS_ALLOWED_ORIGINS`(预留 M6，默认空)。
- 接口：`GET /api/healthz`（进程存活）与 `GET /api/readyz`（含数据库连通），均在 openapi.yaml 中定义并通过生成代码实现。所有 API 路径前缀 `/api`。
- 测试：config 单测；一个使用真实 PostgreSQL 的集成测试（通过环境变量 `TEST_DATABASE_URL` 提供，未设置则 skip），验证迁移可执行与 readyz。

## 前端要求
- Vite + React 19 + TypeScript（strict）+ Tailwind CSS v4 + shadcn/ui 初始化（components.json、`cn` 工具、至少加入 button 组件证明可用）。只用 npm。
- 依赖按 spec 7.5 安装：react-router v7、dexie + dexie-react-hooks、zustand、sonner、vaul、lucide-react、react-hook-form、zod、vite-plugin-pwa。其余（dnd-kit、cmdk、react-day-picker）留到用时再装。
- openapi-typescript 生成 `src/api/schema.d.ts`，openapi-fetch 作为客户端，baseUrl 可配置（默认相对路径，为 M6 预留）。
- vite-plugin-pwa：manifest（name Waypoint、简体中文、主题色暂用淡蓝占位）、占位图标（自己生成简单 SVG/PNG，不引用外部 CDN）、预缓存应用外壳；更新策略为 **prompt**（不自动刷新），留出"有更新，点击刷新"的接入点。
- 开发服务器把 `/api` 代理到本机 8080。
- 首页只需显示 "Waypoint" 和调用 `/api/healthz` 的结果。
- Vitest 配置好并有一个示例测试；ESLint（typescript-eslint）+ Prettier 配好。
- 不引用任何外部 CDN 资源；字体用打包的 Inter（@fontsource 或 fontsource-variable）。

## Docker / Compose
- 多阶段构建：web = Node 22 构建 → 产物复制进 Caddy 镜像；api = Go 编译静态二进制（CGO_ENABLED=0）→ distroless static nonroot。
- compose 服务：`web`(Caddy)、`api`、`postgres`(17)、`backup`；卷：`pgdata`、`uploads`、`backups`、`caddy_data`。compose 项目名固定 `waypoint`。
- 所有服务有健康检查；`api` 在 `postgres` healthy 后启动，`web` 在 `api` healthy 后启动。distroless 无 shell，api 健康检查请给二进制加 `healthcheck` 子命令。
- `api` 不映射主机端口；只有 `web` 映射，主机端口由 `WEB_HTTP_PORT`/`WEB_HTTPS_PORT` 配置（默认 8088/8443，避免与 worker 上其它服务冲突）。
- Caddyfile：站点地址用 `{$WAYPOINT_DOMAIN}`，开发默认 `http://localhost`（纯 HTTP）；`/api/*` 反代到 `api:8080`（SSE 需 `flush_interval -1`）；其余静态文件 + SPA 回退到 index.html；`request_body max_size` 与 MAX_UPLOAD_MB 一致（取 33MB 留余量）；`sw.js` 与 `index.html` 禁止长缓存，带哈希的资源长缓存。
- backup：基于 postgres 镜像，循环脚本每日 `pg_dump -Fc` + 打包 uploads 卷到 backups 卷，保留最近 `BACKUP_KEEP_DAYS`(默认 14) 天；启动时可用 `BACKUP_ON_START=1` 立即执行一次。
- `.env.example` 列出全部变量并带中文注释；代码中不得出现任何域名。

## Makefile 目标
`gen`（oapi-codegen + sqlc + openapi-typescript）、`dev-db`（只起 postgres 供本地开发）、`test`（Go 测试 + 前端测试）、`lint`、`build`、`up`、`down`。

## 验收（你必须自己全部跑通再结束）
1. `make gen` 后 `git status` 无多余差异（生成代码已提交到工作区且是最新的）。
2. `cd api && go vet ./... && go test ./...`（包括设置 TEST_DATABASE_URL 后的集成测试）通过。
3. `cd web && npm run lint && npm run test -- --run && npm run build` 通过。
4. `cp .env.example .env` 后 `docker compose up -d --build`，所有服务变为 healthy；`curl http://localhost:8088/api/readyz` 返回成功；`curl http://localhost:8088/` 返回首页；`curl http://localhost:8088/some/spa/route` 回退到首页。
5. 手动触发一次备份，确认 backups 卷中出现 dump 文件。
6. 验收结束后执行 `docker compose down`（不加 -v）；不要删除 worker 上其它项目的镜像/容器。worker 磁盘余量紧张（约 30G），不要 `docker system prune`，构建时注意不要留下大量悬空镜像。

## 约束
- 不要 git commit，完成后由架构师验收再提交。`.env`、node_modules、构建产物要在 .gitignore 中。
- 最终回复用中文，列出：目录树概要、关键选型与版本、每条验收命令的实际结果、任何偏离本任务书的地方及原因。
