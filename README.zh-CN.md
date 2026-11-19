<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[English](README.md)

2026-10-30 起在 LifeKernel 的 `projects/codex-yard/` 统一维护。独立仓库 `main` 截至 `bf1ac091` 的历史已通过 Git subtree 导入，日常开发使用 LifeKernel 的分支和提交。

通过浏览器继续使用本机和 SSH 主机上的 Codex 会话，在同一工作台查看文件、使用终端、浏览网页和查看交互可视化。

**Yard 是独立运行的 Codex 客户端与能力宿主。即使未安装或已关闭 Codex App，构建、启动、对话、插件管理与已支持的 Computer Use 都应正常使用。** Yard 自己提供所需运行服务，各项功能明确列出系统依赖；Codex CLI 和已配置的模型提供方仍是运行前提。这是 Yard 的产品基本定位，也是新增功能的验收要求。

部署机准备好 Node.js 和 Codex CLI，完成登录后即可启动。固定版本的网页界面与 Node 工具适配器已纳入 Git，位于 `vendor/codex-app/26.1013.40934/`；普通 clone 即可取得，构建和启动无需安装桌面 App 或另行下载 App 资源包。

这是一个实验阶段的独立项目。当前界面对标 **Codex App 26.1013.40934**，自有宿主和扩展采用 TypeScript + React。仓库内的原版界面是编译后的 JS、CSS、字体和其他资源，不包含 App 原始 TypeScript / TSX 源码。[第三方组件说明](THIRD_PARTY.md)

## 当前功能与后续方向

当前支持共享 daemon 会话、本机与 SSH 项目、SSH 连接发现和新增、侧栏聊天置顶、工作区标签、历史恢复、待发消息、文件与图片粘贴、侧边对话、文件、终端、右栏网页，以及聊天中的交互 HTML 可视化。

CLI 0.169.1 或更新版本上，新建本机与 SSH 侧边对话会保存在父对话右上角 Summary 中，左侧对话列表保持原样。子对话也可以继续创建侧边对话。关闭面板保留历史与运行任务，刷新或重启后可以重新打开，详见[侧边对话](docs/sidechat-threads.md)。

进入本机或 SSH 会话时默认显示最新内容，先读取最近两轮的提问、最终回复和耗时。正在进行的轮次额外读取最近一页过程，显示摘要省略的已完成进度回复；Work 可以在运行中展开并补齐该轮过程，重复展开复用缓存。向上滚动读取旧消息并保留阅读位置。已保存的消息可以在会话运行环境恢复、模型列表和 MCP 状态仍未返回时显示。

执行中的会话会显示后端重试、执行主机断线状态。查看当前任务期间，两分钟没有收到新进展就显示等待提示，可停止任务，或复制续接草稿。草稿从最近五轮摘要中提取当前请求、最近已完成的回复和文件路径，省略图片数据。核对草稿、停止原任务后，在同一执行主机的新对话中发送；更早的要求可自行补充。正在运行的工具和等待审批继续使用原状态。网络重试由 Codex 后端负责，Yard 保留提供方的超时配置。

定时任务由 Yard 服务独立执行。Codex App 和全部网页关闭后，仍会按计划新建会话，并保存运行记录。

浏览器通知支持任务完成、失败和等待审批或回答提醒。电脑和平板分别在 Settings → General → Notifications 中开启，关闭 Yard 网页后也可通过 Web Push 接收。

后续方向是多任务工作台：协助理清和分配需求，集中查看各 Agent 的工作与进度，通过生产者—消费者队列分发任务。工作分配与 dashboard 仍属于待开发功能。

## 版本与运行条件

对话工具由常驻宿主提供，包含创建、分叉、发送、等待、历史、标题、归档、置顶和已读等十二项；复用原版参数校验、历史投影和等待逻辑，关闭 Yard 页面后仍可执行。已加载旧对话的迁移、桌面与云端能力边界见[工具说明](docs/native-app-tools.md)。

| 组件 | 版本 | 用途与验证范围 |
| --- | --- | --- |
| Codex | `0.169.1` | 持久侧边对话及原生父子归属要求此版本或更新版本 |
| Codex | `0.164.0` | 已验证无需桌面 App 的部署：自动启动后端、网页加载与真实模型回复 |
| Codex | `0.163.0` | 已验证本机和 SSH 对话、文件、终端与浏览器接入 |
| Codex App 界面 | `26.1013.40934` | 对标复刻基准，也是 Git 跟踪的固定资源版本 |
| Node.js | `>=24.5` | 使用 `24.16.0` 验证；当前已验证的服务端平台为 Linux x64 |

项目、归属、置顶和分组迁移已通过 Codex CLI 0.156.0、0.164.0 验证；已读回执需要 0.164.0 协议。更旧的 SSH 后端继续保留原有 Yard 侧栏状态，升级后再迁移；连接时不会升级主机的 CLI。

## 运行

先准备 Node.js；尚未安装对应 CLI 或登录时执行：

```bash
npm install -g @openai/codex@0.169.1
codex login
```

在 LifeKernel 检出目录执行：

```bash
cd projects/codex-yard
npm ci
npm start
```

`npm start` 构建自有宿主、读取仓库内资源后，调用 Codex CLI 启动或复用 daemon；退出网页服务会保留共享 daemon。资源快照在检出目录中约占 **531 MiB**，以普通 Git 文件保存，无需 Git LFS 或单独下载 App 资源。

会话已读／未读复用 app server，自动阅读确认和手动标记均携带后端 revision 写入，并清除旧浏览器未读标记。时间排序下，已加载会话按“未读且未在运行、进行中、其余”排列，组内按最近时间倒序。首批仍取最近 50 条，后续沿用原分页，不增加历史扫描；置顶和显式手动顺序保留。项目、归属、置顶、自定义分组和设置兼容的待发消息均复用后端，旧数据按主机迁移；浏览器保留跨主机导航偏好与未提交意图。完整归属与恢复规则见[状态归属与迁移](docs/state-ownership.md)。

界面与工具适配器随 Git 提交固定，桌面 App 更新不会替换它们；Codex 后端的兼容性与界面快照分开验证。安装 npm 依赖与调用模型仍需要相应网络连接。

打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)。将 `.env.example` 复制为 `.env` 后可设置端口、数据目录、工作目录和连接地址。`AGENTS_CODEX_BIN` 指定 CLI 可执行文件；`AGENTS_CODEX_SOCKET` 直接连接已有后端并跳过自动启动；`AGENTS_APP_TOOLS_ADAPTER` 可覆盖仓库内的工具适配器路径。Unix socket 的完整路径上限为 107 字节，隔离工作树宜设置较短的私有数据目录。

要让连接同一 daemon 的桌面端共用十二项对话工具，在已部署的检出目录执行 `npm run tools:configure` 查看配置计划，确认后追加 `-- --apply`。配置备份、旧会话迁移和三端接入方式见[注册说明](docs/native-app-tools.md#explicit-registration-for-app-and-yard)。

跨设备访问时，用私有隧道或带身份认证的 HTTPS 反向代理，并将 `AGENTS_PUBLIC_ORIGIN` 设为完整且精确的 HTTPS 来源。服务只监听回环地址；它可以访问文件和执行命令，没有多用户登录系统。[部署边界](SECURITY.md)

原版界面会访问外部配置和事件服务，模型请求仍使用 Codex 中配置的提供方。网络需要代理时，可设置标准 `HTTPS_PROXY` 与 `NO_PROXY`。

在“设置 → 连接”添加 SSH：发现功能读取服务器的 `~/.ssh/config` 及其 `Include` 文件，也可以手动填写。连接配置保存在 Yard 的 `native-state.json`；聊天置顶与顺序保存在对应执行主机的原生 Pinned section，侧栏与对话工具共用同一后端状态。Yard 首次读取桌面端已登记的 SSH 连接，随后在 Yard 中的编辑保存在自己的数据目录。

## 右栏网页

New tab 只保留中间的文件／网址搜索框，打开网页后才显示地址栏和导航按钮。输入网址后，由访问 Yard 的设备浏览器直接在右栏渲染，支持页面内输入、滚动、链接和表单。刷新 Yard 会恢复手动打开的网址；地址栏的前进、后退记录在 Yard 输入的网址，网页内的跨站跳转无法同步到地址栏及其历史。

网站需要允许嵌入（`frame-ancestors` / `X-Frame-Options`），登录状态受浏览器第三方 Cookie 和存储策略影响。HTTPS Yard 通常需要打开 HTTPS 网站，本地来源以浏览器允许的范围为准。站点策略原样保留。网页无需配套程序或桌面 App，已移除 Chrome 配对工具栏。直接网页中的 localhost 指向访问设备。

## 文件粘贴与拖入

在输入框粘贴复制的文件，或把文件拖入输入区。Yard 上传浏览器提供的文件内容并保留文件名，再由原附件管理器处理本机与 SSH 对话。单个文件上限为 10 MiB；上传失败会显示提示，上传期间切换对话会丢弃待添加的附件。

文件粘贴需要浏览器在剪贴板事件中提供文件内容。若浏览器只提供文字或路径，可从附件菜单选择文件。

## 文件预览

HTML 文件预览支持最大 64 MiB 的自包含 UTF-8 页面，与会话内可视化的 5 MB 上限分别处理。本机会话中的 `http://localhost:<端口>/*.html`（含 `127.0.0.1`、`[::1]`）通过 Yard 读取，访问 Yard 的电脑和平板可直接打开。预览脚本在隔离环境运行，不转发浏览器凭据、不跟随重定向，也不提供相邻资源文件；其他本机服务可使用端口转发。

Markdown 文件预览通过 Yard 的文件接口加载引用图片，沿用文档所在的本机或已登记 SSH 主机。支持绝对路径、相对文档目录的路径、`file://` URL、编码文件名及引用式图片写法。

## 端口转发

打开左上角 Codex Yard 下拉菜单 → 端口转发管理，首次将“本设备”关联到当前电脑或平板；未关联时先显示设置。关联后按来源服务展示列表，状态、停止和打开操作都对应当前设备。点击“转发到本机”即可使用已有服务；如需更正设备关联，从“设备设置”进入。设备沿用“设置 → 连接”的 SSH 配置，也可明确选择 Yard 运行主机。

新增服务时填写来源设备、服务地址和端口，以及本地端口，接收端固定为本设备。相同来源设备、服务地址和服务端口的旧规则合并为一项服务；在另一台设备启动时创建或复用该设备自己的转发，其他设备的转发继续独立运行。“⋯”中的编辑、删除只作用于本机转发，复制地址得到本机 `127.0.0.1:<本地端口>`。旧规则直接沿用。

流量经过 Yard：它连接来源机器，并通过 SSH 反向转发在接收设备的回环地址建立监听。SSH 私钥留在 Yard，浏览器和接收设备无需保存来源机器的私钥。接收设备必须运行 SSH 服务并授权 Yard 登录，服务端需允许 TCP 转发；安卓可使用 Termux sshd，电脑需启用兼容的 SSH 服务。Yard 主机需安装支持 ControlMaster 的 OpenSSH 客户端，当前在 Linux 验证。来源与接收设备无需安装 Codex 或 Node。

转发支持 TCP，包括 HTTP、数据库和 SSH。关闭网页后保持运行；SSH 断线时显示错误，点击“转发到本机”重连。Yard 重启会停止转发并保留规则，需要手动启动。修改 SSH 连接会停止相关转发。数据经过 Yard，两端都必须能从 Yard 访问。

## 插件与 Computer Use

Plugins 页面通过所选 Codex 主机的原生协议管理 marketplace、安装和卸载插件，并发起 MCP 授权。已有 Skills 和 MCP 工具沿用后端配置。依赖特定应用宿主的插件，还需要为 Yard 准备能够独立运行的对应服务。

Yard 自带 Linux X11 的 Computer Use 运行时，支持截图、鼠标、键盘、文本输入、拖拽和滚动。安装 `xdotool`、ImageMagick、`xclip` 和 util-linux，在 Yard 的 `.env` 中设置 `YARD_COMPUTER_DISPLAY`，需要时另设 `YARD_COMPUTER_XAUTHORITY`，启动后新开本机对话即可使用。无显示器服务器可以使用虚拟 X11 桌面；控制目标始终是 Yard 执行机器上选定的桌面。[设置、插件包与运行边界](docs/standalone-plugins.md)

## 定时任务

在 Scheduled → Create 旁的菜单 → Set up manually 中填写提示词、项目和时间。每次执行新建一个会话；任务详情保留历史，可点击进入会话。编辑、暂停、恢复和立即执行沿用原页面。Yard 的 Node 服务需要常驻，可交给已有服务管理器；关闭网页或 Codex App 不影响调度，停止 Yard 或关机期间无法执行。

任务和运行记录保存在 Yard 自己的数据目录，启动不读取桌面 App 的任务库。服务恢复后，每个漏跑任务合并补跑一次，再安排未来时间。同一任务尚未完成时不会重叠启动；请求结果丢失时也不会自动重发。核查已有会话或近期会话后，可在该条记录下解除阻塞。

当前支持在已有本机、SSH 项目或新建的无项目目录执行，继承 CLI 后端已配置的权限。需要审批时，浏览器通知可提醒你打开会话处理。自动创建工作树、heartbeat、环境初始化脚本和自动归档暂未提供。[调度与恢复设计](docs/scheduled-tasks.md)

## 浏览器通知

打开 Settings → General → Notifications（设置 → 常规 → 通知），点击“开启本设备通知”，允许浏览器发送通知。电脑和平板上的浏览器分别开启，可选择任务完成、执行失败和等待审批或回答三类提醒；点击“测试通知”检查接入情况。点击任务通知会进入对应会话。升级后已开启的设备订阅继续保留。

Web Push 通过浏览器推送服务和 Service Worker 接收消息，关闭 Yard 网页后仍可工作。Yard 和 Codex 后端需要常驻；跨设备访问需要 HTTPS，并允许通知、保持浏览器推送服务可连通。系统的后台设置会影响到达时间，电脑完全退出浏览器后可能暂停接收。密钥、订阅和任务观察状态保存在现有私有数据目录。[接入、投递与验证说明](docs/browser-notifications.md)

## 开发验证

`npm run test:file-paste:ui` 使用两个隔离的真实 CLI 后端和本机模型响应，检查文件粘贴与拖入、上传字节、同名文件、SSH 传输、失败提示及切换对话。普通文件使用 DOM 剪贴板夹具，文字与图片使用真实 Ctrl+V；系统文件管理器的实际剪贴板需要在对应设备验证。结果保存在忽略的 `.local/file-paste/`。

`npm run test:history:ui` 用可丢弃协议夹具和固定界面，验证模型、MCP 与会话恢复持续等待时正文仍能显示，以及同页切换、向上翻页和原有工具过程入口；加上 `-- --baseline` 可对照原历史读取流程。`npm run test:history:cli` 使用隔离的真实 CLI 与本机脚本提供方，验证打开、原有过程展开、切换及继续发送并显示流式回复。两者均不读取个人会话或调用外部模型账号，需要 Chromium，后者另需 Codex CLI。共享环境按约定持重型测试锁运行，证据保存在忽略目录 `.local/conversation-history/`。

`npm run test:turn-progress:ui` 使用固定界面和可丢弃协议后端，验证无进展提示、后端重试、恢复输出、续接草稿、停止任务、同页切换与手机布局；需要 Chromium，按约定持重型测试锁运行，证据保存在忽略目录 `.local/turn-progress/`。

```bash
npm ci
npm run typecheck
npm test
```

普通测试会构建自有宿主，使用临时后端，检查仓库内界面的资源服务，并执行官方 MCP 适配器集成测试，无需 Codex App。只运行适配器测试时执行：

```bash
npm run test:app-tools
```

`scripts/verify-*.ts` 中的完整界面验收脚本需要 CLI 后端，部分会创建真实测试对话或执行命令，运行前应检查其配置。CI 只执行普通测试。

`npm run test:read-state:cli` 使用独立 CLI `0.164.0`、本机脚本模型服务和两个独立 Chromium context，验证列表排序、自动已读、手动未读、跨浏览器同步、刷新保留及旧标记清理；无需个人账号或外部模型请求。证据保存在忽略的 `.local/thread-read-state/`，可通过 `AGENTS_READ_STATE_EVIDENCE` 修改目录。

`npm run test:previews:ui -- 说明.md` 使用隔离 CLI、本机模型响应和浏览器检查 Markdown 图片的六种引用方式。离线运行时，通过 `AGENTS_TEST_CONFIGURATION_SNAPSHOT` 提供兼容的匿名界面配置。加上 `AGENTS_PREVIEW_SSH=1` 可检查 SSH 主机路由；夹具通过回环连接模拟远端传输，使用尺寸不同的本机和远端图片识别读错主机的情况。

`npm run test:automations:ui` 使用可丢弃的协议夹具，验证原 Scheduled 页面和结果待核实时的解除操作。`npm run test:automations:cli` 启动隔离 CLI 后端与本机模型响应夹具，验证无网页调度、重启恢复、延后审批，再使用该后端验收原页面；不使用个人账号或外部模型请求。`AGENTS_TEST_CODEX_BIN` 和 `AGENTS_TEST_CHROMIUM` 可指定可执行文件，证据保存在忽略目录 `.local/automations-*`。

`npm run test:port-forwarding:ui` 使用临时 OpenSSH 服务、临时密钥、隔离 CLI 和浏览器，验证真正的 SSH 来源连接、接收端反向转发、端口冲突、菜单操作、平板布局、关闭网页继续转发和重启后的规则保留。需要 `ssh`、`ssh-keygen`、`sshd`、CLI 与 Chromium；不使用个人账号或外部模型请求。`AGENTS_TEST_SSHD` 可指定 sshd；`AGENTS_TEST_BROWSER_WS` 可接入独立测试浏览器。证据保存在忽略目录 `.local/port-forwarding/`，临时密钥随夹具删除。

`npm run test:notifications:ui` 使用隔离 CLI、本机模型响应和全新 Chromium，验证现有 Settings 中的通知控制、刷新后的偏好保留、平板布局，以及全部 Yard 页面关闭后的实际 Service Worker 通知显示。使用一次性订阅与本机加密接收端，通过 CDP 注入推送；公共推送服务投递和实体设备后台策略需要在对应设备验证。证据保存在忽略目录 `.local/browser-notifications/`。

`npm run test:host-preferences:ui` 在临时浏览器和数据目录中验证 SSH 新增与聊天置顶，默认使用合成后端。可通过 `AGENTS_TEST_CODEX_SOCKET`、`AGENTS_TEST_CODEX_HOME` 和 `AGENTS_TEST_THREAD_ID` 接入可丢弃的 CLI 夹具；测试聊天需命名为 `SSH and pin fixture` 且已有一轮完成的对话。SSH 传输仍使用本机测试流。`AGENTS_TEST_CHROMIUM` 指定 Chromium，`AGENTS_TEST_CONFIGURATION_SNAPSHOT` 可提供兼容的匿名功能配置快照。

`npm run test:embedded-browser:ui` 使用可丢弃的网站和合成后端，验证网页直接渲染、触控输入、表单、滚动、地址导航、平板布局、刷新恢复及网站拒绝嵌入。设置 `AGENTS_EMBEDDED_TEST_SOCKET`、`AGENTS_EMBEDDED_TEST_CODEX_HOME` 和 `AGENTS_EMBEDDED_TEST_THREAD` 可接入隔离 CLI，测试会话需已有完整回复 `内嵌网页验收内容`。同样支持上述 Chromium 和匿名配置快照变量。证据保存在忽略目录 `.local/embedded-browser/`；实体 iPad Safari 的 Cookie 和键盘仍需设备验证。

会话历史由 Codex 保存；网页草稿保存在浏览器；运行状态与自有宿主的构建产物位于 Git 忽略的 `.local/`。固定 App 资源位于 Git 跟踪的 `vendor/codex-app/`。仓库不附带个人账号数据或功能配置快照。

当前仍受指定界面版本约束，Git/工作树操作与通用自动化尚未完整接通；两台实体 iPhone、Windows Chrome 配对和 2 秒启动目标仍需继续验证或实现。[宿主接口覆盖记录](docs/host-interface-coverage.md)列出了已接入的会话、搜索和设置操作，以及仍缺少实现的原生宿主功能。

自有项目源码采用 [MIT](LICENSE)。`vendor/codex-app/` 和 `vendor/native-app-tools/` 下的第三方编译资源不在此 MIT 授权范围内，保留原有版权、声明与适用条款，详见[第三方组件说明](THIRD_PARTY.md)。本项目与 OpenAI 无隶属或背书关系。
