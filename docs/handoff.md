# 交接说明（新会话先读这里）

> 更新于 2026-11-07。阅读顺序：本文件 → `spec.md`（唯一开发与验收依据）→ `docs/decisions.md`（决策理由）→ `target.md`（需求概览）。

## 当前状态
- 阶段：**需求与架构设计已完成，尚未开始写代码。**
- 已提交：`target.md`、`spec.md`（commit 5edb884），以及本目录文档。
- 仓库无远程地址，未推送。
- spec.md 第 9 节"待定事项"已清空，所有架构决策已确定；主色具体色值在 M0 定稿。

## 下一步：M0（等待用户明确下达开发指令后才开始）
M0 范围（详见 spec 第 8 节）：
- monorepo 骨架：前端（Vite + React + TS + shadcn/ui + Tailwind + Dexie + vite-plugin-pwa）、后端（Go + chi + pgx/sqlc + goose）、OpenAPI 契约
- Dockerfile（多阶段）+ docker-compose（web/Caddy、api、postgres、backup）+ `.env.example`
- 注册登录（邮箱 + SMTP 验证与找回密码）、会话（Cookie + 预留 Bearer）、CSRF、限流
- 行程创建、成员与角色、邀请链接
- 本地数据库、op 生成与发送队列、推送 / 拉取、SSE 通知、冲突检测与提示、拒绝回滚、修改记录基础
- 通用 UI 基础：设计令牌（淡蓝主色、亮 / 暗主题）、底部导航、响应式弹层（Drawer / Dialog）、返回手势关闭弹层、Sonner 提示条
- 验收：两台设备离线各自修改后恢复网络数据一致，冲突有提示，被拒绝的 op 正确回滚

建议 M0 拆成多个子任务分别委派（例如：骨架 + compose → 鉴权 → 同步协议后端 → 同步层前端 → UI 基础），每步验收后再进行下一步。

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
