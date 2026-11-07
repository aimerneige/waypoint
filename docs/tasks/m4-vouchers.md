# 任务 M4：凭证夹

前置：M0–M3 已完成。先阅读 `spec.md` 第 1.3、2.7、3、4.6、7.2、7.6 节，`docs/decisions.md`（D20–D22 由本任务写入），`docs/sync-protocol.md`（visible_to_user_id 预留），以及现有 platform 接口、同步引擎、M1 的 itinerary_item.voucherIds。
任务书即已确认方案，范围内的架构、接口、数据结构、依赖改动均已批准，无需等待确认，直接实施。不要 git commit。

## 1. 关键设计决策（写入 decisions.md）
- **D20 关联只存一处**：凭证与行程项的关联只存在 `itinerary_item.voucherIds`（M1 已有字段）；凭证详情中"关联的行程"由此反向推导。spec 第 3 节 Voucher 的 linkedItineraryIds 改为说明"由行程项推导"。
- **D21 可见性创建后不可修改**：私有凭证的 op 与状态通过 `visible_to_user_id` 只对上传者可见。若允许 trip→private，已同步到他人设备的数据无法撤回；private→trip 时他人缺少历史完整状态。故 `visibility` 仅在 create 时设置，update 中出现即拒绝 `invalid_op`。界面"更改可见性"实现为：用同一文件创建新凭证（新 entityId、新可见性）+ 删除旧凭证，并提示"他人设备上已缓存的旧文件无法远程清除"（仅 trip→private 时）。
- **D22 文件 ID 由客户端生成，先传文件后推 op**：离线时文件存本地上传队列；联网后同步引擎先 `PUT` 上传文件（幂等），成功后才推送引用该 fileId 的 voucher op。服务端校验 voucher 的 fileId 存在、属于本行程、上传者 = actor。

## 2. 后端
- 表 `files(id uuid PK（客户端生成）, trip_id, uploader_id, mime, size, sha256, created_at)`；文件存储接口 `Storage`（`Put/Open/Delete`），本地文件系统实现，路径 `UPLOAD_DIR/<tripId>/<fileId>`，写入先写临时文件再原子 rename。
- `PUT /api/trips/{tripId}/files/{fileId}`（当前成员；请求体为原始文件字节，`Content-Type` 为 mime；路由级请求体上限 `MAX_UPLOAD_MB`）：
  - 只接受 `application/pdf`、`image/jpeg`、`image/png`，并**校验文件头魔数**与声明的 mime 一致；超限 413。
  - 幂等：同一 fileId 已存在且 sha256 相同 → 200；不同内容或不同上传者 → 409 `file_conflict`。
  - 前端在上传前已把 HEIC 转为 JPEG；服务端不接受 HEIC。
- 实体 `voucher`（任何成员 create；仅上传者可 update/delete/restore；owner 也可 delete 全组可见的凭证）：type（flight|hotel|ticket|visa|insurance|other）、title（1–200）、fileId、mime、size、visibility（trip|private，仅 create）、note（可空 ≤500）。create 时 visibility=private ⇒ 服务端为该实体与其所有 op 设置 `visible_to_user_id = actor`；pull / snapshot / history 已按此过滤（补测试确认私有凭证对他人在三种接口中都完全不可见，包括 entity 计数与 changes）。
- 下载：`POST /api/trips/{tripId}/files/{fileId}/link`（当前成员，且该文件被一个对其可见的未删除 voucher 引用，或其本人是上传者）→ 返回 `{url}`，形如 `/api/files/{fileId}?exp=<unix>&sig=<HMAC-SHA256(SIGNING_KEY, fileId|exp|userId)>&u=<userId>`，有效期 5 分钟；`GET /api/files/{fileId}` 校验签名与过期（无需 Cookie，便于 `<img>`/pdf.js 直接加载），`http.ServeContent` 支持 Range，响应头 `Content-Type` 为存储的 mime、`X-Content-Type-Options: nosniff`、`Content-Disposition: inline`、`Cache-Control: private, max-age=300`、`Content-Security-Policy: sandbox`（防止 PDF/图片之外的内容执行）。
- 清理：后台定时任务（API 进程内，每小时）删除创建超过 24 小时且未被任何 voucher（含已删除）引用的孤儿文件；行程删除时删除该行程目录。被软删除的 voucher 保留文件（可恢复）。
- 备份：确认 backup 服务打包 uploads 卷时与数据库一致性的说明写入 README（M0.1 已有，按需补充）。

## 3. 前端
- `platform/storage`（Web 实现）：凭证文件缓存用 Cache Storage（键 `/offline-files/<userId>/<fileId>`），提供 `put/get/delete/list/usage`；退出登录清理（M0.6 预留的清理函数接入）。上传队列中的待传文件存 IndexedDB（Blob）。
- 同步引擎：新增"文件上传"阶段：推送 op 前，先上传该行程 outbox 中被 voucher create 引用、但尚未上传的文件（带重试退避、进度）；上传 409/415/413 视为确定性失败 → 对应 voucher op 进入"未生效的修改"（原因中文：文件过大 / 格式不支持 / 文件冲突）。
- 自动离线：同步完成后后台下载当前用户可见的所有凭证文件（并发 2，仅在线且非省流量模式时；`navigator.connection.saveData` 为真则只手动下载），已缓存的跳过（按 sha256/size 校验）。
- 凭证页（"更多 → 凭证"）：按类型分组；每项显示标题、类型图标、可见性（锁形图标表示仅自己）、大小、"已离线可用 / 下载中 / 未离线"状态；顶部显示离线占用空间总计；单个文件可"取消离线"（删除缓存，且不再自动下载，记住选择）/"重新离线"。
- 上传：Fab → 选择文件（`platform/pick`：`<input type=file accept="application/pdf,image/*">`，手机可拍照）→ 前端校验 32MB；HEIC/HEIF 使用 `heic2any`（**懒加载**独立 chunk）转 JPEG；选择类型（签证、保险默认"仅自己可见"，其余默认全组）、标题（默认文件名）、备注、可选择关联到行程项（写入那些 itinerary_item 的 voucherIds）。离线时文件进入上传队列，凭证立即在列表中显示"待上传"。
- 查看器：图片用 `react-zoom-pan-pinch`（双指缩放、双击放大）；PDF 用 `pdfjs-dist`（懒加载，worker 打包进应用，不用 CDN），逐页渲染、可缩放。优先读离线缓存，无缓存时在线获取签名链接。"分享/保存"按钮走 `platform/share`（Web Share API 分享文件，不支持时下载）。
- 行程项编辑表单：新增"关联凭证"多选（只列出我可见的凭证）；行程项卡片显示凭证图标，一键打开查看器。
- 修改记录：voucher 字段中文名；私有凭证仅本人可见其记录。

## 4. 测试
- 后端集成：魔数校验（把 PNG 声明为 PDF 被拒）、大小限制 413、PUT 幂等与 409、非成员无法上传/取链接、签名过期/篡改/他人 userId 失效、私有凭证在 pull/snapshot/history/link 对他人不可见、visibility 在 update 中被拒、孤儿清理（可注入时钟）、删除行程删除文件目录。
- 前端单测：上传队列与 op 依赖顺序（文件未传成功不推 op）、离线缓存状态机、HEIC 检测（按魔数而非扩展名）。
- Playwright（手机视口；测试文件放 `web/e2e/fixtures/`：小 PDF、小 PNG、1 个小 HEIC 样本）：
  1. A 上传 PDF（全组可见）并关联到行程项 → B 在凭证页看到"已离线可用"、在行程项一键打开 PDF 查看器。
  2. A 上传"签证"（默认仅自己）→ B 的凭证页、修改记录、行程时间线都看不到；直接请求该文件的 link 接口返回 403/404。
  3. 离线（setOffline）后打开已缓存的凭证仍可查看（图片与 PDF）。
  4. A 离线上传图片 → 列表显示"待上传" → 恢复网络后自动上传并对 B 可见。
  5. 上传 33MB 文件被前端拦截；"取消离线"后占用空间减少；退出登录后 Cache Storage 中该用户的凭证缓存被清空。
  6. HEIC 样本上传后以 JPEG 存储并可查看。

## 验收（你必须全部跑通）
1. `make gen` 无差异；`go vet`、`make test-integration`、前端 lint / 单测 / build 通过；确认 heic2any 与 pdfjs 为独立懒加载 chunk（构建产物中不进入首屏入口包），并在回复中列出首屏 JS 体积。
2. `make e2e` 全部通过，连续 2 次无失败（含此前全部用例）。
3. 截图（不提交）：凭证列表（含离线状态与占用空间）、上传表单、图片查看器、PDF 查看器、行程项关联凭证；亮暗各一份。
4. 更新 decisions.md（D20–D22）、spec.md 相应条目、sync-protocol.md（文件上传与签名下载、新拒绝原因）、README（uploads 与备份）。
5. 结束后 `docker compose --profile dev down`（不加 -v）；不要 prune、不要动其它项目。

最终回复用中文：完成内容、验收命令及结果、首屏 JS 体积、截图路径、偏离之处及原因。
