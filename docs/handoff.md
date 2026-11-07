# 交接说明（新会话先读这里）

> 更新于 2026-11-07。阅读顺序：本文件 → `spec.md`（唯一开发与验收依据）→ `docs/decisions.md`（决策理由）→ `target.md`（需求概览）。

## 当前状态（2026-11-07）
- 用户已授权：架构师（Claude）自主推进 M0–M5，验收通过即继续，遇阻碍才停；**M6 不做**（无移动设备）。
- M0 拆为 6 个子任务，任务书在 `docs/tasks/`，按顺序委派 codex：
  - [x] M0.1 骨架 + compose + OpenAPI 生成链路
  - [x] M0.2 后端账号与鉴权
  - [x] M0.3 后端同步协议 + 行程/成员/邀请 + ItineraryItem（产出 `docs/sync-protocol.md`）
  - [x] M0.4 前端 UI 基础 + 账号页面 + Playwright（主色在此定稿 → D13）
  - [x] M0.5 前端本地库 + 同步层 + 行程/成员/邀请页面
  - [x] M0.6 ItineraryItem 列表 + 冲突/拒绝/修改记录界面 + 退出清理 + M0 端到端验收
- **M0–M5 全部完成（2026-11-07）**。M6 不做。部署见 `docs/deploy.md`，安全清单 `docs/security-checklist.md`，e2e 覆盖 `docs/e2e-coverage.md`。
- **上线阻塞（需用户提供）**：公网域名与 DNS、部署服务器、SMTP 账号（含 SPF/DKIM），然后按 docs/deploy.md 配置 `.env`。
- **后续改进（非阻塞）**：
  - CSP 目前含 `script-src unsafe-eval`（heic2any 需要）：改用 libheif-js（WASM）后可收紧为 `wasm-unsafe-eval`。
  - 凭证全屏查看层仍露出应用顶栏，应覆盖整个视口；PDF 默认缩放 50% 偏小，应按宽度自适应。
  - worker 磁盘余量约 21G（Docker 构建缓存约 288G，属共用守护进程，清理需用户决定）。
- 验收流程：读 codex 报告 → 自己在 worker 上重跑 lint/test/`make test-integration`/compose 冒烟 → 审关键代码 → 提交。

## 环境注意
- worker 是 Rootless Docker + pasta：**只有绑定 0.0.0.0 的发布端口能从主机访问**，127.0.0.1 绑定无效。worker 在局域网且防火墙放行高位端口，所以数据库不对外；集成测试在 compose 网络内的 `gotest` 容器中跑（`make test-integration`）；mailpit 用 `MAILPIT_BIND=0.0.0.0`（已写入 worker 的 `.env`）。
- worker 的 `~/.codex/AGENTS.md` 要求高风险改动先等确认：委派提示必须写明"任务书即已确认方案，无需等待确认"。
- 磁盘余量约 29G，禁止 `docker system prune`。

## 工作方式（来自项目 CLAUDE.md 与用户偏好）
- 本机（东京节点，3 核 2G）只做架构与任务拆解；**禁止在本机克隆仓库、安装依赖、编译测试**。
- 代码与算力在远程主机 `worker`：`/home/aiagent/workspace/vibe-websites/waypoint`，通过 `ssh worker` 操作。
- 流程：分析 → 委派 → 验收。优先委派给 codex（yolo 模式），也可用 agy。
- 用户要求：讨论中有错误直接毫不留情地指出；明确下达开发指令前不写代码。

## worker 环境
- codex 0.166.0、agy 位于 `~/.local/bin`，**非登录 shell 的 PATH 里没有**，必须用 `bash -lc "..."` 调用。
- 委派命令模板：
  ```sh
  ssh worker bash -lc cd /home/aiagent/workspace/vibe-websites/waypoint && codex exec --dangerously-bypass-approvals-and-sandbox -o /tmp/codex-last.md "<任务描述>"
  ```
  （`-o` 把最终回复写入文件，便于验收；`--json` 可输出事件流。长任务建议后台运行。）
- 工具链：Node 22.22.2（npm，无 pnpm / bun）、Go 1.26.10、Docker 29.9.3、Docker Compose v5.7.0、python3。
- git 作者已在 worker 配置；提交信息结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 远程 shell 是 zsh：命令中避免未加引号的 `=====`（会被当作命令替换），通配符无匹配会报错。

## 兄弟项目参考（同目录 `vibe-websites/`）
- paypie-website、exchange-website：React 19 + Vite + mdui + Playwright，静态部署到 GitHub Pages（`deploy.sh`）。
- tessera-website：Svelte 5 + Vite。index-website：React + Tailwind v4。
- Waypoint 与它们不同：有 Go 后端，使用 compose 私有部署。
