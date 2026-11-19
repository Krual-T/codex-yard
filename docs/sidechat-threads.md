# Summary 中的侧边对话

在本机或 SSH 对话中打开“新建标签页 → 侧边聊天”，新对话会自动保存在父对话中。右上角 Summary 沿用原生 `Side chats` 区块与列表样式，文案跟随界面语言；没有侧边对话时不显示区块。打开的标签页与后端保存的子对话按 ID 合并，每个对话只显示一次，左侧保持原生列表样式。

点击列表项会打开或聚焦右侧的原生侧边标签页，父对话保留在主区域。关闭面板会保留消息和运行中的任务。刷新网页或重启 Yard 与 App Server 后，也能从父对话的 Summary 重新打开。

空白侧边对话先显示原生 `Side chat` / `Side chat {index}` 默认名；开始交流后沿用原生内容标题生成流程，并以 App Server 保存的标题为准。尚无标题、或上一版只保存了默认名称时，使用原生标签的内容标题或消息预览。自定义标题优先保留，已有历史和名称不做批量改写。

本机侧边对话复用 Yard 常驻工具宿主的 `codex_app.set_thread_title`。智能体省略 `threadId` 即可给当前侧边对话改名，标题保存到 App Server，右侧标签与父对话的 Summary 同步更新。新建侧边对话的指令明确允许在主题清楚后自主命名，遵循用户命名约定，并优先采用用户指定的名称；已经打开的侧边对话也可以直接要求它改名。关闭面板或重启后，常驻工具与保存的标题继续有效。SSH 侧边对话使用执行主机已有的工具配置，Yard 不会在远端自动安装工具。

## 后端与兼容边界

本机或 SSH **实际连接的 App Server 必须为 CLI 0.169.1 或更新版本**。宿主已启用 `experimentalApi`，通过原生接口保存关系：

```json
{"method":"thread/fork","params":{"threadId":"parent-id","attachToSource":true,"ephemeral":false,"excludeTurns":true}}
```

响应中的 `thread.attachedToThreadId` 是目录归属；`forkedFromId` 记录派生来源。普通 `thread/list` 不返回附属子项，显示 Summary 时使用：

```json
{"method":"thread/list","params":{"attachedToThreadId":"parent-id","limit":50,"sortKey":"created_at","sortDirection":"asc"}}
```

列表按创建时间排列，每页 50 条，可见 Summary 按页补齐当前对话的子项，沿用原生列表的折叠与展开。多个视图共享请求，初始侧栏不扫描父项。浏览器只维护当前页面的列表、分页和通知投影，关系与历史均以 App Server 为准。恢复当前子对话时读取原始协议中的归属，避免固定旧界面的解码器丢弃新字段后把子项插入顶层。重新打开保存的子对话复用原生侧边标签页的加载、恢复和关闭流程，不再创建新 fork。

该实验接口要求父对话已经持久化、使用分页历史并保存在目标主机。旧后端会在创建前显示升级提示；连接 SSH 不会自动升级远端 CLI。已有临时侧边对话与云端侧边对话沿用原有生命周期，本次没有提供已有对话的迁移或拖动换父目录。`parentThreadId` 属于子智能体的派生关系，目录使用 `attachedToThreadId`。

## 验证

```sh
npm run typecheck
npm test
flock /tmp/agents-workbench-heavy.lock npm run test:sidechat:cli
```

独立验证脚本使用真实 CLI、一次性的 `CODEX_HOME`、本地 Responses 测试服务和 Chromium，无需个人账号或外部模型。它覆盖英文界面、空区块隐藏、原生列表去重、模型实际调用改名工具且保留父标题、Summary 按需查询、右侧打开且父对话保持、关闭与重开、刷新、窄屏、嵌套子项关闭后通过常驻工具改名与完成，以及 Yard 和 App Server 重启后的消息恢复和再次自主改名。

`AGENTS_TEST_CODEX_BIN`、`AGENTS_TEST_CHROMIUM` 可选择独立依赖；离线时 `AGENTS_TEST_CONFIGURATION_SNAPSHOT` 可提供匿名配置快照。证据写入忽略目录 `.local/sidechat-threads/`，`AGENTS_SIDECHAT_EVIDENCE` 可调整输出位置。`AGENTS_TEST_MASKED_APP` 用于验收时确认被隔离的 App 安装目录为空。

布局变更另外执行 `test:sidebar-toggle:ui` 与 `scripts/verify-conversation-history-cli.ts`，使用同一个重型浏览器锁。固定界面为 `26.1013.40934`；自有适配位于 `sidechat-thread-renderer.ts`、`sidechat-thread-view.ts` 与 `browser-sidechat-threads.ts`，上游 vendor 原文件保持原样。
