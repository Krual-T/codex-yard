# Yard 状态归属与迁移

核对日期：2026-11-18。后端基准为独立 Codex CLI / app server `0.164.0`，固定界面为 `26.1013.40934`。已逐项处理服务端、浏览器及固定界面中发现的重复持久状态；下表记录实际存储归属。通用存储仍允许动态键，后续新增能力需要继续核对其权威来源。

2026-11-21 复查 React 工作区与 CLI `0.169.1`：历史、运行状态、项目、置顶和普通队列继续使用上述后端。工作区补齐已读回执：内容显示在前台并滚动到底部后，确认本次读取的 `readState.revision`；并发新活动由后端版本检查保护。旧浏览器未读集合在宿主初始化时清理，两套界面共用这一入口。

长对话只需显示到最新历史页即可确认已读，最早未读轮次可以位于更早的分页。首次历史读取先取回执，再取最新内容；写回继续携带 `expectedRevision`。确认失败释放本页的尝试标记，恢复焦点或历史刷新时可以重试。对话藏在设置等页面背后时保留未读，重新显示且滚动到底部后再确认。

React 侧栏按已有排序保留项目的前 5 条、Recents 的前 20 条，同时显示已加载的运行中、未读、待输入／授权和当前打开的普通会话。启动侧栏复用同一选择函数；手动收起项目或分组后，标题显示已加载范围的活动数量。归档和隐藏规则仍由普通列表决定，当前路由不会补回已归档会话，也不扫描首屏之外的活跃任务。

运行状态、已读回执和待处理请求的通知会让同主机的在途列表与 metadata 查询失效。完成通知保留最后确认的行，后续刷新通过一次 `thread/read(includeTurns: false)` 同时确认状态与回执，再应用到列表；读取失败保留原行并提示待同步，沿用 15 秒及回到前台时的对账重试。浏览器只在内存中记录待确认 ID 和请求代次，不增加持久状态。

## 后端状态与浏览器投影

| 对象 | 当前权威来源与行为 | Yard 保留的数据 |
| --- | --- | --- |
| 会话未读 | `thread/list.readStates`、`thread/read.readState`、`thread/readState/changed`；阅读和手动标记调用携带 `expectedRevision` 的 update | 页面内存；清除旧浏览器 unread 集合，不把旧集合导入后端 |
| 会话置顶与组内顺序 | 内置 Pinned section、`thread/section/move`、`section_position`；界面与十二项对话工具共用后端 | 已确认结果的内存视图；混合主机或页面的排列槽位 |
| 项目目录、名称、根目录与时间 | `project/*`；旧路径 ID 在原生 `Project.metadata` 保存别名，界面显示原生 ID | 跨主机聚合与选择偏好；旧目录只作为一次迁移输入 |
| 会话归属 | `Thread.projectId`；新建直接用 `thread/start.projectId`，已有会话调用 metadata update | 已加载结果内存；独立 projectless 意图仍保存 |
| 侧边对话父子关系 | CLI 0.169.1 的 `thread/fork.attachToSource`、`Thread.attachedToThreadId` 与定向 `thread/list`；历史和运行任务由后端保存 | 页面内存保存 Summary 子列表、分页与通知投影；不增加持久关系表，详见[侧边对话](sidechat-threads.md) |
| 项目顺序 | 同主机通过 `project/move`；旧 globals 与 unified-sidebar 项目拖动均接后端 | 跨主机、ChatGPT 与页面的混排槽位；单主机纯项目顺序退出持久副本 |
| 项目外观、项目置顶、按项目手动会话顺序 | `Project.metadata` 中的 `yard.projectAppearance`、`yard.projectPinned`、`yard.projectThreadOrder` | 原生协议没有这些专用字段，因此使用同一个后端对象保存 Yard 的 UI 约定 |
| 自定义分组名称、成员与顺序 | `threadSection/*`、`Thread.section`；补齐现有 PinnedThreads 的六项 section 服务，原界面命令负责创建、移动、重排、改名和删除 | 浏览器只保存跨主机逻辑组映射、混入的项目／页面导航、折叠与组排列；未确认的新建意图保留到原生 ID 返回 |
| 普通待发消息 | 启用现有 `Xjn` 后端队列；所有消息先核对提交设置，再使用 `thread/queue/*` | 后端确认接收后删除本地项；特殊模型／权限设置、未准备附件、暂停及提交结果未知的意图继续保留 |
| PR 附件主体 | `thread/attachment/add/list/remove`；读取确认回填成功后清理旧 `pull-request-attachment-records-v3` 主体 | 分支导航、PR 与工作树关联、回填进度和实际文件字节 |
| 定时任务已存在轮次的状态、摘要和错误 | 在线读取后端线程与 turn summary；不再持久保存一套可覆盖在线结果的顶层字段 | 调度阶段、领取／恢复关联；离线或会话删除后的最后已观察历史快照 |
| 定时任务已读与归档 | 收件箱动作写原生 receipt 和 archive/unarchive，其他客户端修改同步投影；旧标记带 revision 迁移 | 旧调度轮次已复核、后续普通消息仍未读时，保留原生 receipt 无法表达的独立轮次复核意图 |
| 远端摘要 | `thread/list/read` 与通知；原 cloud 分支改页面内存，移除旧动态持久键 | Yard SSH 原本走主机 RPC；不会用历史摘要中的旧未读字段覆盖 receipt |
| 有效权限与推导默认值 | 已有会话采用后端 settings；config-derived、heartbeat 投影转内存 | 创建前显式权限选择、最近模型与 picker 显示偏好 |
| 工作区／输出路径 | 项目根目录由后端项目恢复；已知线程中与后端 cwd 相同的 hints／输出路径不再持久保存 | 创建前位置和 projectless 输出意图；显式不同的输出目录仍有独立意义 |
| MCP 工具目录 | live `mcp-global-entrypoints-v2` 改内存；清理五个仅出现在固定快照退出清单的退休目录族 | 后端插件／MCP 配置仍由原生接口负责；不增设插件数据库 |
| Statsig 遗留缓存 | IndexedDB 接收旧 localStorage 缓存后删除旧键，验证迁移确认再清理 | 外部配置缓存与 stable ID／session 身份；其权威源属于功能配置服务 |

关键实现：[backend-sidebar-state.ts](../src/native/backend-sidebar-state.ts)、[thread-projects.ts](../src/native/thread-projects.ts)、[native-app-tools.ts](../lib/native-app-tools.ts)、[browser-sidebar-sections.ts](../src/native/browser-sidebar-sections.ts)、[browser-sidebar-orders.ts](../src/native/browser-sidebar-orders.ts)、[browser-state-convergence.ts](../src/native/browser-state-convergence.ts)、[automation-projection.ts](../src/native/automation-projection.ts)。自有 renderer 适配器保持版本匹配检查，上游 vendor 文件未修改。

## 迁移、刷新与排序

服务启动把旧 `projects.json`、桌面目录导入保存为一次性迁移输入。每个执行主机先读取原生目录，再导入缺少的项目、归属与置顶；后端已有值优先。后端确认和旧输入收缩保存均成功后，该主机的旧值退出持久化。连接、写入或本地保存失败会保留输入以供恢复。已经删除的会话引用会清理；遗留读取仅把与本次ID精确匹配的-32600 `thread not loaded`识别为失效引用，写入错误继续上报并保留输入。正常重启不会把旧项目重新导回。

迁移按本机与 SSH 主机隔离。默认置顶读取只刷新已经连接的主机，离线 SSH 保留尚未迁移的输入，接通时继续。原生项目变更和归属事件更新内存；CLI 0.164 没有 section 变更通知，因此显式写入后、网页重连和返回焦点时刷新 sections。变更 SSH 端点时清除旧主机内存投影。

项目、归属、置顶和分组的完整接口在 CLI 0.156.0 与 0.164.0 上通过真实后端验证，宿主根据初始化版本启用迁移。0.147.0 缺少项目接口与分组外观，0.144.6 还缺少分组接口；这些 SSH 主机继续使用原有 Yard 数据，更新后端后在下次连接迁移。混合组只保留旧主机的成员和必要关联，已确认的原生成员由后端读取。普通对话、旧主机置顶、分组及撤销继续可用。会话工具和调度器在连接目标主机后解析原生项目 ID；旧后端创建会话时省略原生 projectId，归属由兼容路径保存。已读回执仍要求 0.164.0 协议。

目录刷新期间收到新的项目通知会再次读取，避免发布已过期的顺序。远端断线不阻断本机校准；删除 SSH profile 会清理其浏览器分组映射，混入的独立导航项继续保留。分组在页面内往返保留原界面的迁移、删除标记，避免重复迁移；尚未确认的跨主机移除意图单独保存，确认后清理。显式创建同名分组会生成不同原生 ID。

`thread/list` 单次只接受一个 `sortKey`（`created_at`、`updated_at`、`recency_at`、`section_position`）和 `asc/desc`；位置排序要求指定 section。普通首屏仍取最近 50 条，Yard 在已加载结果中按“非运行中的未读、进行中、其余”分档，档内最近时间倒序；完整界面沿用原分页。置顶、自定义分组和显式手动顺序按各自语义排列。迁移旧引用、读取 section 成员和收件箱归档校准有定向查询；普通列表没有新增全历史扫描。

React 侧栏保留后端提供的未读、运行和最近活动摘要，合并分页后重新排序；项目手动顺序读取后端项目 metadata。点击、悬停和恢复待回答问题都会保留正在运行的圆圈。`node scripts/verify-thread-read-state.ts --source` 使用真实隔离 CLI 和两个浏览器验证已读同步、排序及运行状态；`node scripts/verify-workspace-mobile-notifications.ts` 覆盖分页、移动输入及通知路由。

原生分组也支持 API key 模式。适配只给侧栏分组记录提供 `yard-app-server` 本地范围标识，不改变全局账号或登录状态。

队列迁移先重新读取后端，以 client message ID 确认此前提交；只迁移提交设置兼容的连续前缀。后端无法表达的逐消息模型／权限意图保留在客户端，防止越过这些消息改变执行顺序。请求发出后的未知结果不会自动重放写入。

## 仍由 Yard 独立拥有的状态

| 状态 | 保留理由 |
| --- | --- |
| SSH profiles、自动连接、远端 cwd 与所选主机 | 原生 remote-control 配对不提供等价 OpenSSH profile CRUD；这些是执行入口与导航偏好 |
| 跨主机、页面、ChatGPT 内容的混排，未分组会话的全局手动排列 | 每个后端只知道自己的项目与单个 section；不存在跨后端或任意导航对象的统一位置 |
| `sidebar-thread-metadata`、thread descriptions、pinned turns、本人访问时间 | 会话颜色／emoji、个人描述、轮次收藏与访问历史没有对应的原生线程字段 |
| 调度规则、时区、下次触发、幂等领取和服务锁 | 原生会话队列不承担周期调度；历史快照用于删除或离线后的结果展示 |
| Web Push、设备身份、投递结果与去重游标 | 后端提供任务事实，Yard 负责无网页时的投递；watch 不承担会话已读语义 |
| 端口转发规则、Chrome 配对与页面租约 | 是设备能力、连接所有权与用户选择，运行状态只在内存 |
| 草稿、prompt-history、retained documents、乐观会话 ID、待发送元素评论 | 未提交内容、恢复关联和编辑历史；确认发送的对话内容进入后端 |
| 预热 ID、创建通知缓冲与可见性 | 宿主按主机和 `thread-prewarm-start` 返回的 ID 管理，仅保存在内存；首次 `turn/start` 发布正式对话，未使用预热10分钟后核对历史并清理 |
| 文件上传、附件转存与 projectless 工作目录 | 保存真实文件字节；原生 attachment payload 只提供引用与结构化内容 |
| 模型显示启停与 catalog owner | 用户显示偏好；实际 provider 配置由 config/read/update 管理，60 秒目录缓存只在内存 |
| worktree starting ref、local-env selections、recent actions | 用户选择的执行起点与操作意图 |
| code-review recent PRs、pinned PRs | 访问顺序和收藏；不是 PR 当前事实的权威副本 |
| external-agent import progress、visualization share jobs | 导入与发布的恢复协调状态 |
| tab、diff、文件树、折叠、宠物、最近访问与引导 | 界面／编辑偏好 |
| Cloud、Aeon、Pages、Library、Orbit 服务数据 | 属于各自服务域；独立 CLI 的 thread API 不表达其业务语义 |
| 配置注册备份、固定 vendor、构建资源、压缩缓存 | 配置回滚或交付／性能产物，不是第二套用户会话库 |

预热沿用固定官方宿主的生命周期语义。CLI可能先通知创建、后返回创建响应，宿主在预热请求期间缓冲该主机的创建通知，拿到ID后过滤预热并放行其他对话。通知、普通列表、启动列表和原生侧栏投影使用相同的预热ID；显示不依赖标题、预览或历史是否已经加载。首次发送会将同一ID发布给连接该主机的页面；外部首轮通知也会使其显示。

过期及显式丢弃只允许删除本次宿主创建且尚未使用的预热，并再次读取运行状态和分页或旧式历史。CLI对未落盘预热返回“首条用户消息前历史不可用”时，按对应ID和错误码精确识别为空历史；其他读取失败保留数据。宿主关闭清理内存与计时器，正常对话继续由后端保存。

## 存储入口覆盖

服务端业务状态的直接写入口已逐一检查：`server.ts` 的通用 globals/settings、`thread-projects.ts`、`thread-pins.ts`、`native-app-tools.ts`、`model-providers.ts`、`pet-overlay.ts`、`port-forwarding.ts`、`automations.ts`、`notifications.ts`；文件字节由 `files.ts` 处理。`hosts.ts` 只读桌面导入，配置快照加载器只读匿名捕获。

浏览器自有写入口包括 `browser-host.ts` 的 `native-atoms`、`statsig-storage.ts` 的 IndexedDB／旧 localStorage、`browser-bridge.ts` 的评论／设备标识、`port-forwarding-view.tsx` 的本设备关联，以及原界面的 persisted-atom 实现。会话历史、终端、provider 路由、发送锁、Chrome 配对、资源缓存还保留进程内状态；这些不形成新的跨重启权威记录。

固定界面导出的 86 个全局键按下面的语义核对。列出键名不代表 Yard 的当前流程会写入该键；实际运行只抽取键名对照，未导出值。

| 范围 | 全局键 |
| --- | --- |
| 项目主体与迁移 | `local-projects`、`remote-projects`、`app-server-project-id-by-legacy-project-id-by-host`、`app-server-projects-migration-by-host`、`app-server-pending-project-deletions-by-host` |
| 归属与工作区 | `thread-project-assignments`、`thread-project-membership-host-ids`、`projectless-thread-ids`、`thread-workspace-root-hints`、`thread-projectless-output-directories`、`project-writable-roots`、`thread-writable-roots`、`active-workspace-roots`、`electron-saved-workspace-roots`、`electron-workspace-root-labels`、`project-files` |
| 置顶、顺序、外观、选择 | `pinned-thread-ids`、`app-server-migrated-pinned-thread-ids-by-host`、`pinned-project-ids`、`sidebar-project-thread-orders`、`sidebar-thread-metadata`、`project-order`、`project-appearances`、`selected-project`、`selected-remote-host-id`、`active-remote-project-id`、`connection-group-order`、`open-in-target-preferences` |
| 连接与运行入口 | `codex-managed-remote-connections`、`remote-cwds-by-host-and-workspace`、`remote-connection-max-retry-attempts`、`remote-connection-auto-connect-by-host-id`、`remote-connection-analytics-id-by-host-id`、`remote-project-connection-backfill-completed`、`host-id-remote-control-allowed`、`added-remote-control-env-ids`、`codex-mobile-has-connected-device`、`queued-follow-ups`、`persisted-atom-state` |
| Git 与工作树偏好 | `git-branch-prefix`、`git-always-force-push`、`git-create-pull-request-as-draft`、`git-pull-request-merge-method`、`git-pr-poll-interval-seconds`、`git-review-mode`、`git-show-sidebar-pr-icons`、`git-worktree-root`、`git-commit-instructions`、`git-pr-instructions`、`git-pr-watch-auto-merge`、`git-pr-watch-instructions`、`worktree-upstream-refresh-mode`、`worktree-auto-cleanup-enabled`、`worktree-auto-cleanup-unpackaged-override-enabled`、`worktree-keep-count` |
| 通知与入口显示 | `notifications-turn-mode`、`notifications-permissions-enabled`、`notifications-questions-enabled`、`notifications-dot-enabled`、`ia-waiting-on-user-followup-seconds`、`ambient-suggestions-enabled`、`codex-micro-agent-source`、`codex-micro-layout`、`mac-menu-bar-enabled`、`dock-icon-preference`、`reduced-motion-preference`、`hotkey-window-projectless-default-enabled` |
| 身份、引导、模型入口 | `statsig-stable-id`、`viewed2025-09-15-full-chatgpt-auth-nux`、`viewed2025-09-15-apikey-auth-nux`、`windows-wsl-reminder-dismissed-date`、`show-copilot-login-first`、`use-copilot-auth-if-available`、`copilot-default-model`、`desktop-app-beta-preferences-by-account-id`、`desktop-first-seen-at-ms` |
| 浏览器、插件与调试 | `global-dictation-force-lock-debug-enabled`、`debug-chrome-pages-enabled`、`primary-runtime-update-jitter-ms`、`site-creator-bundled-plugin-auto-install-disabled`、`browser-use-bundled-plugin-auto-install-disabled`、`computer-use-bundled-plugin-auto-install-disabled`、`image-guided-assets-bundled-plugin-auto-install-disabled`、`browser-annotation-screenshots-mode`、`browser-download-directory`、`browser-download-prompt-enabled` |

浏览器还使用动态键和分片记录，例如远端摘要、草稿、搜索上下文与服务缓存。此次额外核对了会改变归属结论的持久族：未读、两类置顶顺序、自定义分组、项目／聊天顺序、队列、附件回填、权限默认值、会话描述、turn 置顶、用户活动时间和远端摘要；普通 tab／diff／折叠偏好及云产品前缀按上表中的职责保留。`thread-descriptions-v1`、`pinned-conversation-turns-v1`、`thread-user-activity-times-v1` 分别属于客户端描述、消息定位收藏和本人的访问时间，当前协议没有等价的原生字段。

## 验证与运行边界

便携测试覆盖后端优先、旧数据收缩、磁盘失败、断线／未知写入、主机隔离、外部修改、原生位置排序和普通首屏上限。真实 CLI 验证使用独立 CODEX_HOME、loopback Responses provider 与可丢弃数据；队列、附件、分组与 receipt 使用浏览器动作验收。最终39947232的干净源码归档在 App 安装和个人配置不可见时通过构建、类型检查及331项测试，真实CLI 0.156、0.164重启后的53条有效历史与陈旧引用迁移通过。其前端源码及其余实现的96ddd20f归档通过七组运行与界面验证。正式39947232部署、HTTP与HTTPS资源检查及实际页面验收已完成。

定时任务的历史只包含 Yard 最后观察到的结果。若 Yard 停止期间后端完成并被外部删除，历史保留已有快照或未知状态，不补造最终结果，也不重新发送任务。旧已读／归档迁移遇 revision 冲突或未知回复会保存诊断，等待明确动作重试。

此次检索覆盖当前自有代码的所有直接持久化入口、固定 assets 的持久 wrapper 与调用、86 个导出 global 键和相关动态族。退休目录族核对全 assets 读写入口；云服务域与插件新键有开放边界，不声明一个永久封闭的完整键集合。
