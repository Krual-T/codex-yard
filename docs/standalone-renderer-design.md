# 自有 React + TypeScript Web 前端

状态：实施设计 v1，2026-10-28。来源为 manager 分支 `193dd730` 后续；覆盖当前 Yard Web 的 F00–F23 功能账。用户的新目标要求移除整个 `vendor/codex-app/` 后仍可安装、构建、启动和验收。本设计替代固定函数注入方案，旧来源保留为行为研究和可复用源码。

## 入口与现有能力

浏览器加载自有 HTML、CSS 和 `src/native/browser-entry.ts` 生成的 bundle。入口直接从 npm 导入 React、`react-dom/client`，挂载 `src/renderer/app/App.tsx`。应用自己管理路由、页面树、交互和浏览器状态。最终构建、服务器静态路由和部署产物均没有 App 快照路径或回退。

当前入口仍调用 `Ag/jg`，`browser-host.ts` 仍动态导入快照 RPC 基类，不能作为新入口继续使用。服务器读取快照 `renderer.json/index.html`，构建还拒绝打入 npm React，这些限制随自有入口一起移除。旧 `renderer-migration.ts` 的函数替换在替代消费者上线后删除，不继续扩大接缝。

| 已有能力与仓库证据 | 本次处理与实际消费者 |
| --- | --- |
| `lib/codex.ts` 的 CodexConnection 连接既有 daemon、握手、关联请求、过滤配置、区分写请求结果未知 | 保留；服务器继续拥有 CLI 连接生命周期，浏览器不直接实现 daemon 传输 |
| `src/native/server.ts` `/native-host` 的 mcp-request/response、fetch、通知和 host 路由 | 保留现有显式 wire envelope；自有 WorkbenchClient 替代原版私有 MessagePort/RPC 引擎 |
| `thread-projects.ts`、server 的 settings/global-state JSON、hosts.ts、queued-send-locks.ts | 保留权威持久来源、项目/host 标识和写入语义；侧栏、设置、队列直接消费这些服务 |
| `files.ts`、`browser-files.ts`、terminal.ts、ssh.ts | 保留文件/SSH/终端服务及权限校验；替换继承私有 RpcTarget 的浏览器封装，挂接自有文件和终端组件 |
| `src/browser-reuse` Chrome MCP、client broker/router 与 TSX webview | 复用服务和可独立的 React 组件；移除依赖原版路由/dispatcher 的 install 组合，元素引用写入自有 composer 草稿 |
| `visualization-sandbox.ts`、visualizations.ts 与 host-tools.ts | 保留受限 opaque-origin sandbox 和已实现宿主工具；重建自有输出/iframe 控件及明确 MessagePort 协议，删除快照文本替换 |
| `lib/app-tools.ts` 默认启动快照 codex-app-tools/server.mjs | 必须替换：自有 stdio MCP 适配器暴露既有工具目录并调用现有受限 host handler。保留每个调用的 thread/turn/call 上下文、取消和错误，不能以禁用工具通过启动 |
| 旧迁移的 composer/messages/settings/sidebar 源码工厂 | 复用已恢复逻辑与行为样本；React、控件、状态、parser 和 host 服务改由自有源码或 npm 提供 |

## 状态、路由与模块契约

Manager 负责入口、shell/路由、WorkbenchClient、会话 reducer、共享契约、服务集成和构建。A 负责 composer/草稿/提交控件/队列，B 负责消息/Markdown/工具展示，D 负责设置/主题/自有控件。共享契约在 `src/renderer/workbench-contract.ts`；组件通过 props 接收真实客户端和当前 host/thread/cwd，直接使用 npm React。没有注入 framework 或第二套业务服务。

WorkbenchClient 只有三个跨模块操作：`rpc(method,params,hostId)`、`host(endpoint,params)` 和事件 `subscribe`。它使用当前 `/native-host` WebSocket，关联请求 id、超时及响应错误，连接建立后发送 ready，通知保持原 envelope。审批请求以服务端请求 id 保存在会话控制层，用户响应只发给原 host/连接；断线后作失效处理。额外 reply 操作由 manager 随审批消费者直接加入契约。

App 以 `/`、`/local/:threadId`、`/settings/:section` 和已存在的独立页面路由为入口，并兼容当前 host 查询参数、旧会话别名和分享后的直接链接。页面历史使用浏览器 History API；模块不另存一份当前会话。非默认路由逐项按 F20/F23 实证恢复，未核实分支保持打开。

会话 reducer 维护当前 host 下的 thread 摘要、加载中的 turn/item 和通知 delta；CLI 的 thread/turn/queue 始终是业务权威来源。初次选择先 thread/read(includeTurns)，需要发送时才 resume；thread/start/turn/start 由单个提交控制链执行。Composer 的 text/images/files/references 草稿属于浏览器交互状态，按 host/thread 或新会话 cwd 分区；成功回执后清除对应版本，失败保留，较新的编辑不得被较旧提交清空。A 的 onSubmit 回调由 manager 会话控制器提供；队列通过 thread/queue/* 和现有发送锁，不创建第二份持久业务队列。

消息组件接收 CLI ThreadSummary/turn/items，负责逐类型展示、正文/附件/复制/编辑/代码和工具活动。未知 item 以可展开的明确类型与数据展示，不悄悄丢弃。Markdown parser、高亮、数学、Mermaid 等采用按真实功能需要引入的包管理依赖；应用特有链接、文件路径、复制、外部资源和展示策略留在自有 TSX。

设置页通过 get-settings/set-setting、get/set-global-state 以及 CLI config/read/batchWrite 访问原有配置。后端已过滤敏感配置，界面不接触认证 token/env。所有变更等待服务回执，显示保存失败，按 host 定位；界面主题等本地偏好与 CLI 模型配置分别写回既有来源。平台不支持的操作继续显示当前明确错误/空态。

## 兼容、并发和断线

原 dataDir 的 settings/global-state、项目分配和 host catalog 保持形态。浏览器 `native-atoms` 先按旧 key 读取，识别 client-thread-bindings、tab/sidebar/theme/draft/queue 草稿的真实形状后逐项适配；保留原值和未知字段，禁止以清空数据完成迁移。新写入只有一个所属组件/服务负责。跨 tab 的 UI 偏好通过 storage 事件更新；业务通知仍由各自 CLI 连接提供。

| 场景 | 所有者与结果 |
| --- | --- |
| 切换 thread 时旧 read 晚返回 | App 以 host/thread 和读取代次匹配，旧结果不会覆盖新页 |
| 流式增量与完整读取交错 | reducer 按 thread/turn/item id 更新；先订阅、缓存读取期间的通知，读取后按序应用；重连重新读取而非重复 delta |
| socket 断线或写请求超时 | client 拒绝在途请求并标记结果未知；不重放写入。保留草稿，重连读取 thread/queue 核对后让用户决定再发送 |
| 多页面同时消费队列 | 使用既有 host 发送锁与 CLI 队列 id；成功后 release(sent)，失败保持条目，失联先核对状态 |
| 审批/工具取消与连接变化 | 绑定原 host/id，已失效请求不能对新连接回复；每个工具调用保留取消链和明确错误 |
| 文件/终端/Chrome 不可用 | 对应组件呈现真实失败并保留可恢复输入；终端输入和 mutation 均不自动重发 |

## 实施与验收

第一批走通自有页面启动、会话列表/read、消息、输入/中断、通知和审批链，再按 inventory 完成侧栏、队列、菜单、设置、面板、Chrome、输出及附属窗口。设计冻结后由原 C 会话按 technical_design_reviewer 的原文职责做只读协议委派审阅；实际代码与文档仍须逐批审阅。

每个功能关闭都需要自有入口/状态/服务/资产归属、真实消费者使用证据、针对失败/并发的行为检查和必要 typecheck/npm test。原版差异测试仅为过渡研究，最终运行测试不得读取 vendor。现有 189 项通过只证明旧结构，不作为新架构完成证据。

删除快照前，逐条清理 app-resources、静态路由、MCP adapter、mini/pet 资产、字体/图标、CSS、动态导入、构建脚本、验证脚本、测试和分发说明。第三方资产通过包管理或项目自有资源替代，保留适用 notices。最终从不含整个 vendor/codex-app 的干净来源安装/构建/启动/完整测试，检查 bundle metafile、部署目录和浏览器网络，真实 CLI 只读验证与隔离 synthetic peer 验证分别记录；需要真实推理时交 Leader 裁定授权。

本设计描述目标行为，目前尚未证明新入口可运行。CLI 0.164.0、现有 daemon 0.163.0 与历史 UI 参考 26.1013.40934 分开记录；正式 8765、个人数据/模型/配置、共享 daemon 和 App 保持现有运行状态。
