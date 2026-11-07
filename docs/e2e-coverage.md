# 规格覆盖矩阵

用例均运行 mobile 和 desktop 两个项目。M5 逐页检查及跨模块旅途使用项目视口（375×812 / 1280×800）；既有 M0–M4 的部分双端同步场景保留两个独立手机上下文，M1 另测桌面拖拽。文件位于 `web/e2e/`；算法、恶意请求与时间边界使用单元/集成测试补充，不把服务端鉴权仅交给 UI 测试。

| spec 功能点 | 浏览器用例 | 补充验证 |
| --- | --- | --- |
| 1.1 注册、登录、昵称/头像、改密、保留当前会话 | auth.spec.ts 账号流程 | TestAuthLifecycleIntegration、TestChangePasswordIntegration |
| 邮箱验证、邀请前验证、一次性与期限 | auth.spec.ts 邀请；m0/m1/m2/m3/m4/m5 的邮件验证 | TestEmailVerificationIntegration、TestTokenConsumptionConcurrentIntegration |
| 找回密码、重置撤销会话、不枚举邮箱、Host 安全 | auth.spec.ts 找回密码 | TestPasswordResetIntegration；auth.go 固定 PublicBaseURL |
| Cookie / Bearer、CSRF、续期、过期与锁定限流 | auth.spec.ts、m0-sync.spec.ts | TestCSRF、TestSessionRenewalIntegration、TestAccountLockIntegration、TestRateLimitIntegration、TestSSESessionInvalidationIntegration |
| 1.2 多行程、邀请有效期/作废、成员移除、转让 owner、设置/删除 | auth.spec.ts 邀请加入；m0-sync.spec.ts；m3-packing-polls.spec.ts 转让 | TestTripLifecycleIntegration、TestInvitesIntegration |
| 1.3 当前成员与角色鉴权、私有文件、签名 URL | m0-sync.spec.ts、m4-vouchers.spec.ts | TestSyncVisibilityIntegration、TestM4FilesIntegration |
| 2.1 本地读写、队列、恢复网络、SSE、常驻状态 | m0-sync.spec.ts、m5-offline-journey.spec.ts | sync/engine.test.ts、TestSSEIntegration |
| 2.2 幂等 op、serverSeq 排序与 clientTime 不可信 | m0-sync.spec.ts | TestSyncProtocolIntegration、TestSyncConcurrentIntegration |
| 2.3 字段合并、同字段覆盖、通知、恢复、软删后编辑 | m0-sync.spec.ts、m1-wishlist.spec.ts、m2-ledger.spec.ts、m5-offline-journey.spec.ts | domain/ops.test.ts |
| 2.4 离线新增/编辑/删除/恢复、在线权限操作禁用 | auth.spec.ts、m0/m1/m2/m3/m4、m5-offline-journey.spec.ts | TestM1EntityValidationIntegration、TestM2LedgerIntegration、TestM3PackingPollsIntegration |
| 2.5 拒绝、回滚、重试/丢弃、移除/过期后队列保留 | m0-sync.spec.ts、m3-packing-polls.spec.ts、m5-offline-journey.spec.ts | sync/engine.test.ts、TestVersionRejectionRetryIntegration |
| 2.6 单项历史、行程时间线、字段旧值/新值 | m0/m1/m2/m3、m5-polish.spec.ts | TestSyncProtocolIntegration |
| 2.7 离线外壳、版本提示、旧 op、退出清理、多账号隔离 | auth.spec.ts 离线外壳；m0-sync.spec.ts；m4-vouchers.spec.ts | TestUpgradeChain、TestVersionRejectionRetryIntegration、platform/session.test.ts |
| 3 数据模型与货币精度 | m1/m2/m3/m4 各模块 | domain/*.test.ts、各里程碑集成测试 |
| 4.1 心愿新增/改/删、安排到日期、拖拽、撤销/移回、并发推导 | m1-wishlist.spec.ts；m5-offline-journey.spec.ts | domain/itinerary.test.ts |
| 4.2 日期分组、时间/无时间排序、跨时区、预订信息/关联凭证、历史 | m1-wishlist.spec.ts、m4-vouchers.spec.ts | domain/itinerary.test.ts |
| 4.3 CNY/刷卡/现金、币种、分类/日期/备注/付款人/分摊、manual/actual/default/wallet | m2-ledger.spec.ts；m5-offline-journey.spec.ts | domain/ledger.test.ts、TestM2LedgerIntegration |
| 钱包换汇、加权成本、负余额警告、现金写权限 | m2-ledger.spec.ts | domain/ledger.test.ts、TestM2LedgerIntegration |
| 对账、筛选、实际扣款、汇率影响范围 | m2-ledger.spec.ts；m5-polish.spec.ts | domain/ledger.test.ts |
| 4.4 精确最少转账、每人展开、标记/撤销、估算/离线警告、一致结算 | m2-ledger.spec.ts、m5-offline-journey.spec.ts | domain/ledger.test.ts：取整、守恒、DP 最优、超 20 人退化 |
| 4.5 系统/用户模板、跨行程/离线套用、独立勾选、公共负责人、出发提醒/当天隐藏 | m3-packing-polls.spec.ts；m5-offline-journey.spec.ts | domain/packing-polls.test.ts、data/packing.test.ts、TestM3TemplatesIntegration |
| 4.6 PDF/JPEG/PNG/HEIC、32MB、私有默认/隔离、共享关联 | m4-vouchers.spec.ts | domain/vouchers.test.ts、TestM4FilesIntegration |
| 凭证离线下载/占用/取消/恢复、排队上传、缓存清理、可见性替换、分享/查看器 | m4-vouchers.spec.ts；m5-offline-journey.spec.ts | data/voucher-files.test.ts、TestM4SlowUploadDoesNotBlockOpsIntegration |
| 4.7 单选/多选、实名票数、追加选项、改/撤票、关闭、截止拒绝 | m3-packing-polls.spec.ts、m5-offline-journey.spec.ts | domain/packing-polls.test.ts、TestM3PackingPollsIntegration |
| 5 手动默认汇率、首次填写、变更影响计数、仅 default 重算、并发冲突 | m2-ledger.spec.ts | domain/ledger.test.ts、TestM2RatesMigrationIntegration |
| 6/6.1 主题、PWA、手机/桌面、返回手势、尺寸、空/加载状态、长文本、axe、焦点、安全区 | auth.spec.ts、m5-polish.spec.ts、各模块亮/暗截图 | ui/theme/contrast.test.ts、ui/overlay-history.test.ts |
| 本地 1000 行程 + 1000 账目、tab 300ms | m5-performance.spec.ts | 实际 DOM 数量与浏览器 performance.now 测量，不依赖网络 |
| 7.4 Compose/Caddy HTTPS、安全头、备份恢复、升级准备 | HTTPS 环境跑完整套件 | scripts/restore-drill.sh；docs/deploy.md、security-checklist.md |
| 7.6 M6 预留 | Cookie/Bearer 与 platform 既有测试 | 原生构建、系统分享 UI、真机 iOS 手势不属于 M5 自动化能力 |

截图位于忽略的 `web/e2e/screenshots/`；失败 trace 位于 `web/test-results/`。M5 尺寸检查仅豁免由上传按钮代理且透明的文件 input；图标按钮和自定义复选框没有尺寸白名单。safe-area 使用 CSS 注入额外 34px，配合 320px 截图检查。原生 iOS 键盘与系统分享仍需真机验证。
