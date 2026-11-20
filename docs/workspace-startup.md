# 工作区启动

Yard 启动优化保留原版界面、草稿、权限、历史恢复及本地/SSH 能力，缩短从打开页面到完整工作区可交互的时间。界面快照为 `26.1013.40934`。改动在项目自有 TypeScript 和资源适配器中完成，vendor 原件保持原样。

## 执行顺序与复用

轻量侧栏沿用现有独立 React 根，原版工作区保留自己的 React 运行时。下载、全局初始化、原版首次挂载分别测量。侧栏交接完成并经过两帧表示工作区绘制完成；主要交互指标为从打开页面到点击原版编辑器、真实按键并绘制完成的时间。另记输入事件到绘制的延迟，以及包含自动化定位等待的请求到绘制时间。

1. 原版 host services 准备完毕后，提前启动原版 `iEu` 持久状态恢复。它仍执行原来的迁移、主窗口写权限判断、外部状态订阅和五秒超时恢复。
2. `dEu` 在 render/useState initializer 中纯读取稳定的恢复函数及 hydration 状态，尚未完成时仍显示原版 loading，已完成时直接渲染子树。首次子树提交同时读取原版 `pTt`/`Ky`，使持久化 context 与原版一致：宿主恢复为 enabled/disabled，超时仍为 pending。只有 effect setup 实际调用恢复函数时才把订阅交给 provider；被丢弃或挂起的 render 不消耗订阅，页面仍负责未接管记录的清理。接管后由 provider 的 effect 清理；StrictMode 第二次 effect setup 重用原版恢复器。特殊窗口和带 excludedKeys 的 provider 走原有流程。
3. 身份、app-info、os-info、配置仍遵循原版真实读取及权限语义，不引入磁盘身份缓存。配置快照下载沿用现有提前下载及 SDK profile 校验。
4. 普通窗口保留路由模块的原版并发预取，根节点不再等待这条 promise；React 原有的 Suspense 处理路由就绪。特殊窗口按原有路径加载，预加载器检查原版 avatar/spotlight 窗口标记。
5. 首页后台 `thread/list` 的后续游标页在工作区绘制事件 `yard-workspace-ready` 后再等 1.5 秒，给最初的输入留出时间。首个列表页、用户输入和操作请求保持现有路径。侧栏的 pointer/key/wheel 交互立即放行分页，编辑器输入保留这段延迟；从首次等待算起的 15 秒上限仍然有效。直接打开会话继续由已有 HistoryStartup 管理：历史就绪后的两帧、用户交互或超时释放，工作区绘制事件不会结束这段优先期。初始路由统一按服务端 meta、通知查询参数、真实 pathname 的顺序读取，直接路径不误判为首页。

初始侧栏用骨架占据尚未就绪的导航、列表和账号区域，元数据返回后立即显示可选择的真实对话。启动根自带字体、行高和布局样式，并读取现有 `native-atoms` 中的侧栏宽度与窗口缩放，使工作区 CSS 到达和原版接管时保持一致的尺寸与排版。骨架支持浅色、深色和减少动态效果；列表读取失败时保留连接提示，完整工作区继续启动。上述偏好只读，状态保存和草稿交接沿用原来的所有权。

持久状态预加载只在同一页面的启动过程中转交一次，不增加长期存储，也不跨账号复用 QueryClient。服务端及客户端的持久化确认语义保持同步。

## 首页输入与初始化调度

空白普通首页可以先输入纯文本。输入框属于现有侧栏启动根；原编辑器确认路由、原草稿和宿主持久化权限后，接收文本、选区和触屏焦点。输入法组合完成后再交接；如果出现原草稿或路由变化，未接收的文字留在本页的只读恢复区。已有首页草稿、直达会话和特殊窗口使用原来的编辑器路径。发送、附件和权限控制仍由原版负责。

启动层的右侧按原版首页布局预留顶部标签栏、Logo与标题区、底部输入卡片及项目栏。输入卡片沿用原版的宽度、底部间距、圆角和字体；权限与模型区域先显示骨架。项目与语言来自同一次启动元数据读取，提前输入可随多行文本增高。`--check-handoff` 对比明暗主题、120%缩放及手机布局下，输入卡片、标题和Logo接管前后的坐标与尺寸，同时验证延迟CSS不会改变启动层布局。

临时输入框启用时，构建产物按已有调用顺序执行 27 个固定版本的单次初始化函数，在已完成的表达式之间让出主线程。收到输入后先给浏览器一次绘制机会。原版服务与 React 根等待初始化完成；没有临时输入框时，继续走同步入口。生成模块沿用版本化 URL 和 gzip 缓存，vendor 文件原样保留。构建检查函数形状、命中数和输出语法；分段启动失败会停止本轮，不在已有部分初始化的页面上重调同步入口。

早期输入绘制与原版工作区绘制分开计量。在 180 个会话、五个项目、四个主机的同机冷缓存样本中，从导航起第 0.8 秒尝试输入，默认构建五轮在 0.843–0.889 秒绘制输入；原版工作区在 5.70–6.06 秒绘制。另在 10 Mbps、50 ms 模拟网络下测了三轮，列表 0.739–0.788 秒，输入 0.921–0.994 秒，完整工作区 13.19–13.40 秒。两帧是浏览器绘制近似，不代表发送已经就绪，也不代表现场 INP。

`flock /tmp/agents-workbench-heavy.lock sh -c 'npm run build && node scripts/verify-startup-draft.ts'` 验证输入、晚到选区、输入法、草稿保留与冲突、历史导航、触屏和原版发送。启动指标脚本可选 `AGENTS_STARTUP_EARLY_INPUT_AT=800`，用真实按键验证早期绘制和原编辑器接管。

## 完整工作区一秒门槛

每轮使用新浏览器上下文，从导航开始计时。原版外框、可命中的原版编辑器和真实的左栏对话行都出现、启动遮罩移除后，再等待两次动画帧；取独立探针与工作区绘制标记中较晚的时间。随后真实输入一个字符，再点击左栏并确认历史内容加载。临时输入框、先行列表及同轮暖启动不参与门槛。每轮冷启动都须小于 1000 ms；门槛失败时仍写出 `result.json`。这里在测首页接管，持久草稿、直达历史会话和发送用独立回归覆盖。

```sh
flock /tmp/agents-workbench-heavy.lock sh -c 'npm run build && node scripts/verify-sidebar-startup.ts --require-full-under-1s'
```

2026-11-18：同机 180 会话、五项目、四主机的样本中，Brotli 候选原版接管分别为 5.94、5.53、7.40 秒，输入与导航检查通过，耗时门槛失败。10 Mbps、50 ms 模拟网络下，四个关键资产合计少传 1,052,808 字节，三组交替测试的完整绘制中位数从 13.46 降至 12.62 秒。解压后的 JavaScript 保持一致，客户端初始化与首次挂载仍在关键路径。

## 按需加载实验

文件入口 `Kxs`、文件查看器 `Vxs`、标签控制器 `ZXo`、设置共享组件 `Gwl`、MCP 派生状态 `UL` 的拆分仍作为隔离实验。初步实验缩短了全局初始化，完整冷启动未取得稳定改善；当前生产适配器不包含这五组改动。固定 bundle 下载体积仍单独报告。未来适配必须明确被删父调用和实际读取边界，并验证首次使用；保留原版注册表和组件。

## 状态所有权与异常

预加载器持有原版订阅及最近一次真实 hydration 状态，effect setup 接管后成为唯一清理者。重复 host-sync 继续通知同一个 provider；提前收到 updated 事件的合并规则仍由 `iEu` 负责。失败及超时走原版恢复逻辑，不伪造 hydration 成功。

分页等待仅存在于 browser-host 的请求发出前，释放后按原有 RPC 请求、错误和断线规则处理；不缓存分页结果、不重试写操作、不吞掉错误。页面关闭后使用原来的 transport 生命周期。

## 验证及交付

运行 TypeScript 检查与模块完整测试。对恢复器提前完成、未完成、重复 sync、effect 清理/重建、特殊窗口及超时路径做行为测试。对分页首屏放行、后续等待、用户提前释放及超时恢复做行为测试。

同一隔离实例至少三轮冷/暖启动，对比打开页面至完整输入绘制完成的时间，检查四个主机、历史点击及后台分页。验证工作区绘制事件不会释放直接历史会话。实际操作覆盖文件预览、标签、设置、模型/MCP 和真实 CLI 历史/流式返回，并在桌面 App 安装不可用时完成验证。未得到稳定收益的适配不进入交付。最终更新 immutable URL namespace，从干净归档部署；服务更新前依照项目规则检查其他任务及业务占用，保留共享 daemon 与通知/转发状态。

2026-11-18：结构独立审阅通过，TypeScript 和 277 项测试通过。对照正式版本 `6cbbd7b2`，三轮交换先后顺序的本机 HTTP 合成场景包含 180 个会话、五个项目和四个主机。完整工作区绘制中位数从冷/暖 7.27/3.49 秒降至 6.83/3.40 秒；真实点击及按键后的输入绘制从 9.45/5.70 秒降至 7.66/4.03 秒。两次动画帧作为绘制近似；输入指标包含自动化定位及命令等待，不是现场 INP。列表绘制约 0.29/0.13 秒。主模块解压体积仍约 14.4 MB，以上改动没有拆小它；该场景的完整工作区尚未达到一秒。

最终版本保持首次子树提交的持久化 context 与原版一致；App 安装及个人配置不可用时，两轮完整标签页、草稿、刷新、平板尺寸切换回归通过。完整绘制的单轮耗时仍有波动，三轮首次输入均提前。

## React + TypeScript 隔离候选

设置 `AGENTS_SOURCE_WORKSPACE=1` 后，常规 `npm start` 入口使用 React + TypeScript 工作区；数据目录、Codex daemon、HTTPS 来源校验和宿主权限沿用现有配置。未设置时使用固定的上游界面。候选仍在对齐原版功能与样式，不应将切换入口视为已完成全部对齐。

Yard 自有 React 入口复用原版样式资源和现有宿主协议，启动时并行读取侧栏和当前会话历史。候选已接通本地会话导航、近两轮历史与翻页、ProseMirror 输入、旧版纯文本草稿，以及继续会话和新建会话发送。首页可从后端项目中选择目录，也可启动无项目会话；发送前重新确认账号，并由 CLI 解析目录和当前权限。已有会话在原线程上发送；新会话沿用宿主隐藏创建流程，用户切离后不再向未提交的新会话发送。页面收到回执才清除同一份草稿；断线或超时导致投递结果未知时保留草稿，不自动重发。

当前会话订阅 CLI 的真实消息片段，消息区按浏览器帧更新。输入区订阅当前运行轮次的 ID，不随每个片段重渲染。打开已有运行轮次时先读历史，再附着到对应 CLI 会话并接收后续片段；轮次结束后以持久历史为准。Enter 发送，Shift+Enter 换行，输入法组合期间保留选词事件。停止操作提交当前线程和轮次 ID，保留后来写入的草稿。新会话在后端确认后加入左栏，等待后端的快速列表包含该线程时采用其真实排序。

本地侧聊沿用 App Server 保存的父子关系，Summary 可见时按父 ID 读取。右栏的「New tab → Side chat」从当前父会话创建附属会话；侧聊与父会话共用历史加载和编辑器实现，各自保存草稿。桌面右栏保留主对话可操作，窄屏由侧聊覆盖；关闭后，CLI 继续执行，Summary 可以重新打开已有的侧聊。真实 CLI 回归覆盖这两种布局、隐藏 Summary 时的请求数、刷新后的会话和草稿恢复。

Summary 的 Outputs 创建菜单会把带插件引用的请求追加到当前草稿，一次撤销即可去掉整段。打开 Outputs 后，候选从已加载的助手回复中发现当前会话目录内的文件链接，只查文件元数据。用户打开文件后再读取内容，HTML 复用隔离预览；支持文本、图片预览和文件下载。Office/PDF 暂只支持下载，远端站点及结构化产物待接入。

输入区先绘制，再从 CLI 读取当前会话设置或首页配置。设置到达后只读取当前主机的首批模型，用于显示正式名称；模型翻页、供应商和权限列表仍在打开相应菜单时加载。模型与推理强度的修改只在用户操作时提交，拖动滑杆只更新预览，释放后提交。首页沿用当前 profile 的配置保存；会话内使用 `thread/settings/update`，写入前由当前目录和 CLI 权限目录复核。选择新会话权限后，只有实际发送时才按该目录创建会话。切换设置保留当前草稿，不会自动发送。全访问提示沿用原版的本地隐藏偏好。

加号菜单的文件入口复用现有 HTTP 上传，支持本机选文件、拖放和粘贴。同名文件有独立的暂存路径。SSH 会话把暂存文件通过现有附件服务传至目标主机，再提交对应路径。提交时向 App Server 传递原版请求格式：普通文件使用附件路径，图片再添加 `localImage` 输入。上传未完成时暂停发送，失败保留文字草稿，切换项目或会话后忽略旧上传的回执。收到发送回执后只移除本次发送的附件。文件夹和加号菜单的其他动作待接入。

已登记的 SSH 主机沿用现有连接及自动连接偏好，各自查询侧栏数据；本地编辑器和对话列表无需等待 SSH 握手。会话、实时流、命令审批和草稿按主机加会话 ID 区分。支持旧版 SSH 深链接。本轮覆盖远端已有会话；远端新建、右侧面板和主机管理尚未接入。

标题栏终端入口和 Ctrl+` 复用已有 PTY 宿主。终端的 xterm.js 和样式在用户打开时才请求。会话终端使用该会话所属主机和目录；切到另一会话时保留已打开的终端，显式关闭终端由宿主清理。首页右侧入口按原版打开全宽终端，隐藏后再次打开复用会话，保留编辑器与草稿。真实 CLI 测试核对两种布局的键盘输入、目录、输出和会话复用。原版右侧工具的新标签、SSH 终端显示和剩余窗口布局仍待对照。

会话标题直接可编辑。Enter 或失焦提交给 App Server，Escape 取消；保存失败保留输入，标题和侧栏只显示已确认的名字。会话同时出现在固定、项目和最近区域时，仅一个位置标记为选中。窄屏左栏按原版宽度 240 px 显示；点选会话或点正文后维持展开，由侧栏按钮关闭。

左栏行菜单已接通改名、置顶、取消置顶、归档。置顶沿用后端顺序，已置顶会话仅显示在 Pinned；刷新后从后端恢复。归档成功后从左栏移除，归档的是当前会话时回到首页。原版行菜单里的已读状态、移动、派生、复制和永久删除等操作待接入。

命令审批按当前宿主连接、会话、轮次和请求 ID 管理。待审批时保留编辑器及草稿，显示命令或网络目标、原因和可选决定。用户点选后只向当前连接发送一次决定，等 App Server 确认或轮次结束后恢复编辑器。断线清掉旧连接的待审批项，不补发决定。文件修改、通用权限申请、长期规则修改和 MCP 询问暂未接入。

回复先支持纯文本绘制，有 Markdown 时按需加载 Outputs 共用的解析器。标题、列表、表格、代码块和链接经 React 渲染；原始 HTML 仍显示为文本。回复复制保留 Markdown，代码块可单独复制和切换换行。历史向上滚动按原始游标加载，不影响当前回复的绘制。语法高亮和消息的其他操作待对齐。

有时间戳的轮次显示日期，执行过程置于提问和最终回复之间。首屏读取摘要；展开当前轮次后才请求该轮的详细活动，按原始游标翻页。失败时保留最终回复，展开态提供重试；收起再打开复用已读详情。

构建后用以下测试检查候选：

```sh
npm run build
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --exercise-send
flock /tmp/agents-workbench-heavy.lock node scripts/verify-source-workspace-cli.ts
flock /tmp/agents-workbench-heavy.lock node scripts/verify-source-workspace-ssh.ts
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-outputs
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-toolbar
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-attachments
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-header
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-mobile-sidebar
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-sidebar-actions
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-approval
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-messages
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-activity
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-message-menu
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-profile
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-tool-routes
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-search
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-home-project
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-home-terminal
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-right-tools
flock /tmp/agents-workbench-heavy.lock node scripts/verify-workspace-style.ts --probe-shell-actions
flock /tmp/agents-workbench-heavy.lock node scripts/verify-sidebar-startup.ts --source-candidate
flock /tmp/agents-workbench-heavy.lock node scripts/verify-sidebar-startup.ts --source-candidate --source-direct-history
```

样式测试在独立的后端与浏览器上下文中重建同一份合成会话，比较浅色桌面、深色桌面和窄屏下的首页、侧栏、会话、输入和草稿恢复。截图、元素尺寸及差异范围保存在 `.local/workspace-style/`，出现像素差异则失败。`--probe-outputs` 对照创建菜单和追加草稿，检查该操作没有发送消息。`--probe-toolbar` 对照模型滑杆、权限菜单和全访问提示的隐藏偏好。`--probe-attachments` 对照加号菜单和选文件后的草稿。`--probe-header` 对照标题编辑态；`--probe-mobile-sidebar` 以触屏事件验证左栏开关和点击行为。真实 CLI 回归覆盖设置保存、滑杆拖动、同名文件、粘贴图片、上传失败、切换会话和改名。通过 `--control` 让两侧都运行原版，可定位动效和异步状态带来的拍摄差异。

标题区和窄屏左栏调整后的对照见 `.local/workspace-style-header-mobile-final/report.json`。候选编辑器冷加载后 209–240 ms 可命中；浅色桌面、深色桌面和窄屏会话分别还有 50,551、43,050、48,471 个差异像素。触屏行为检查通过，像素门槛仍未通过。

窄屏左栏打开后占用正文宽度，收起后正文恢复全宽。`--probe-mobile-sidebar` 检查原版与候选都满足该行为。390 × 844 下，两者打开左栏后的正文和输入框均为 149 px、93 px 宽；全访问提示折行和侧栏操作仍有像素差异，见 `.local/workspace-style-mobile-reserved/report.json`。

`--probe-sidebar-actions` 对照置顶、取消置顶及归档，三项动作检查通过后仍比较原版与候选菜单截图。真实 CLI 测试另核验刷新后的置顶、从行菜单改名和后端归档结果。

窄屏行尾提供置顶和归档快捷操作，桌面在悬停或键盘聚焦时显示。归档运行中的会话需要明确确认；确认时重新读取轮次，轮次变化后重新询问。触屏对照验证置顶、取消置顶、归档和草稿保留，候选还验证取消不发中断及只停止重新确认的轮次，见 `.local/workspace-style-mobile-quick-actions/report.json`。

`--probe-approval` 用隔离协议后端验证原版与候选的审批卡、拒绝回包和草稿恢复；候选额外验证两条并行会话互不影响。审批状态行为通过，整页截图仍有差异。

`--probe-messages` 对照富文本结构、剪贴板内容、代码换行和滚动加载旧消息。验证记录见 `.local/workspace-messages-check/report.json`；这些操作通过，整页截图仍有差异。

`--probe-activity` 验证折叠时不请求详情、展开只读取该轮、分页、命令输出及重复展开。日期和命令行调整后，展开态有 56,336 个差异像素，仍未通过像素门禁。

`--probe-message-menu` 对照回复菜单。候选按选中轮次向当前主机发起独立分支。真实 CLI 0.169.1 已验证旧回复分支排除后续轮次、不发送新提示、保持只读权限，返回源会话后恢复草稿。

候选账号菜单沿用宿主身份与 Mini 状态。设置、插件目录和 Mini 复用固定版本页面，打开相应工具后浏览器才请求其主模块。`--probe-tool-routes` 验证请求时机、从设置返回原会话、插件目录绘制、Help 键盘操作、Mini 开关和草稿恢复。插件目录在离线合成样本中不安装插件。`--probe-profile` 对照账号菜单，整页还有 30,296 个差异像素。

搜索面板在用户打开后挂载，输入查询后才向已连接主机发起状态库内的标题搜索；旧查询回包不会覆盖当前结果。项目预览先显示 5 条，每次「Show more」追加 10 条。`--probe-search` 验证原版和候选的展开步进；候选另验证打开首屏之外的会话、返回恢复草稿和键盘操作。修正测试宿主的恢复会话游标后，截图等待模型状态就绪。见 `.local/workspace-style-search-project-aligned/report.json`，面板的命令清单和截图仍有差异。

对齐模型正式名称、项目和会话行位置、文字颜色及快捷操作显示条件后，15 张截图仍有差异。其中浅色桌面首页为 10,897 像素、会话为 18,799 像素，窄屏会话为 43,692 像素。报告见 `.local/workspace-style-row-aligned/report.json`；真实 CLI 回归见 `.local/workspace-source-cli-model-label-final/report.json`。

首页的项目选择随第一批会话返回，使用原版在宿主持久化的 `selected-project`。清除项目和刷新均保留草稿；已保存项目不可用时，须显式选择项目或无项目才可发送。`--probe-home-project` 在原版和候选验证恢复与清除，并核对写入的原生值。真实 CLI 回归在刷新后发送并核对项目和目录，见 `.local/workspace-source-cli-saved-project/report.json`。同机 10 Mbps、50 ms 三轮候选首页左栏和编辑器可用为 656–672 ms、按键绘制为 835–884 ms，再点击会话到历史绘制为从导航起 1,021–1,067 ms，见 `.local/source-startup-saved-project/result.json`。

会话标题栏操作复用改名、置顶、侧聊、整段分支和安全归档。消息级分支继续严格按选中的 turn ID 截止。标题栏与侧栏归档共用进行中会话的确认，确认前后核对实际 turn ID。真实 CLI 验证侧聊、两种分支、返回原草稿与归档，见 `.local/workspace-source-cli-header-actions-final/report.json`。

标题栏 Copy 子菜单支持本机会话链接、Markdown 和工作目录。点击复制 Markdown 才按原始游标分页读取历史。隔离对照中，52 轮历史的剪贴板文本与顺序一致，候选仅在点击时请求两页；见 `.local/workspace-style-chat-copy-aligned/report.json`。Fork 子菜单和原版一样先展开，再选择 Fork chat。真实 CLI 通过整段分支、消息级分支和返回草稿校验，见 `.local/workspace-source-cli-fork-submenu/report.json`。远程链接与菜单截图仍待对齐。

搜索里的 Go to scheduled tasks 按需打开现有 Scheduled 页面，运行结果跳转回 React 工作区。隔离验证覆盖创建、执行、暂停、异常解除、结果会话和导航前原草稿，见 `.local/workspace-source-scheduled-verified/result.json`。原版标题菜单的附着定时任务表单可打开，但实际保存会被现有宿主拒绝，见 `.local/workspace-style-original-attached-save/reference/schedule-create.json`。现有独立定时任务仍沿用同一个调度服务。

Recents 首次仅挂载 20 行。滚轮、触屏滚动和键盘可在原列表继续加载；已收到的元数据按需展示，耗尽后按主机请求下一页，刷新时忽略返回的旧页。54 条会话的隔离对照从 20 行滚动到 54 行，可打开最后一条真实会话。候选只在滚动后请求一次后续游标，见 `.local/workspace-style-recents-paging/report.json`。

Recents 可以折叠后恢复已加载的范围，折叠和重开均不请求下一页。对齐首页项目高亮、标题内项目入口和输入区工具栏后，15 张截图仍有差异，浅色桌面首页为 5,320 像素、会话为 14,246 像素，390px 宽会话为 42,572 像素。对照见 `.local/workspace-style-selected-project-aligned/report.json`。320px 和 390px 下，全访问提示可以独立滚动，测试逐个命中配置和发送控件，并覆盖触屏置顶和安全归档，见 `.local/workspace-style-narrow-composer-done/report.json`。

会话消息对齐原版气泡宽度、正文行高和回复操作区。从固定版本的图标目录在构建时读取 13 个图标的静态矢量，候选页不执行目录所在的应用模块。浅色桌面首页和会话的差异降到 4,573 和 11,850 像素，见 `.local/workspace-style-pinned-icons-full/report.json`。320px、390px 下，标题、会话菜单、终端、Summary 和侧栏按钮分别可命中，见 `.local/workspace-style-pinned-icons-compact/report.json`。窄屏全访问提示仍有布局差异。真实 CLI 回归见 `.local/workspace-source-cli-pinned-icons/report.json`。

同机 10 Mbps、50 ms 三轮冷缓存下，图标对齐后的首页真实编辑器和左栏绘制为 674–718 ms，键入绘制为 833–890 ms，随后点击到历史绘制为从导航起 983–1,073 ms。见 `.local/source-startup-pinned-icons/result.json`；完整工作区及正式 HTTPS 验收仍未通过。

CPU 剖析采到消息区提交阶段的同步滚动高度读取；关闭的 Outputs 菜单还会下载文档图标。现在用布局完成后的尺寸通知跟随滚动，切到更早历史时不抢回位置；打开 Outputs 菜单才挂载选项。键盘打开、草稿插入和历史翻页的隔离浏览器行为检查通过，截图仍有差异，见 `.local/workspace-style-lazy-output/report.json` 和 `.local/workspace-style-scrolling-history/report.json`。三轮直达会话在 657–675 ms 显示并可操作，键入绘制为 817–854 ms；三轮均未请求关闭菜单的文档图标或原应用 JS，见 `.local/source-startup-layout-after-paint/result.json`。

从左栏选择会话和浏览器前进、后退时，导航事件直接发起原有首屏历史请求，React 挂载后消耗同一个结果。10 Mbps、50 ms 的三轮冷启中，首页绘制 657–682 ms，首次字符绘制 873–883 ms；实际点击到历史出现 98–108 ms，每次只读取一页。先输入、清空再点击会话的整个脚本从导航起 1,023–1,033 ms。见 `.local/source-startup-nav-overlap/result.json`。

React 富文本复用固定版本的标题、列表和代码块样式，以及浅色、深色的基础色值。候选多轮会话的标题和代码块边界与参考相差不到 0.3 px；富文本整页仍有 24,820 个差异像素。加载旧消息时保留正在看的位置，继续滚动可到达最早回复。复制 Markdown、复制代码、换行和旧消息可达性均通过，见 `.local/workspace-style-anchored-history/report.json`。语法高亮和滚动状态的像素差异待对齐。

基础色对齐后，普通浅色、深色、窄屏会话分别仍有 12,208、12,550、35,291 个差异像素，见 `.local/workspace-style-palette-full/report.json`。10 Mbps、50 ms 同机冷缓存直达会话三轮，左栏、实际历史和编辑器同时绘制为 667–693 ms，首次按键绘制为 847–870 ms，见 `.local/source-startup-palette-direct/result.json`。352 项自动化测试和真实 CLI 回归通过，CLI 报告见 `.local/workspace-source-cli-palette/report.json`。

对话右侧工具复用原版新标签页布局，接入侧聊和当前对话目录的真实 PTY。打开工具列表不会启动终端；收起再打开保留终端内容，关闭终端标签释放会话。快速重开 Outputs 菜单时重新将焦点交给第一项。真实 CLI 回归见 `.local/workspace-source-cli-right-tools-width/report.json`。桌面工具打开后，候选父编辑器宽度与原版相差 0.75 px；800px、390px 测试无横向溢出，收起恢复编辑器。文件、网址搜索和多标签待接入，工具整页截图仍有差异，见 `.local/workspace-style-right-tools-width/report.json`。

本轮 10 Mbps、50 ms 三次冷缓存直达中，左栏、实际历史和编辑器同时绘制在 667–681 ms，首次按键绘制在 862–885 ms；终端仍只在打开时加载。见 `.local/source-startup-right-tools-direct/result.json`。

右侧 Files 接回既有工作区目录和 CLI 模糊搜索接口。打开工具页时不读取目录，进入文件工具或提交搜索后才查询。真实 CLI 0.169.1 验证嵌套目录、返回上级、搜索、文本预览和下载字节一致，保留父会话草稿，见 `.local/workspace-source-cli-files-final/report.json`。接通第三张工具卡片和搜索后，桌面工具页差异降到 29,336 像素，见 `.local/workspace-style-right-files/report.json`；网址入口仍待接入。352 项测试通过。三轮同条件冷启动同时绘制为 666–671 ms，首次键入为 828–878 ms，见 `.local/source-startup-files-direct/result.json`。

右栏接回多标签和网址入口。换标签、暂时收起、展开全宽时保留已有的 PTY 和网页文档，关闭单个标签只释放对应资源。新标签页复用原版文件与网址搜索布局；用户提交网址后才创建 iframe。沙箱保留脚本和表单，限制顶层导航与同源访问；禁止嵌入的网站不自动代理或连接 Chrome。网页刷新恢复、Chrome 连接及标注不在本轮，触屏注入在隔离 iframe 内未通过。真实 CLI 验证切换标签保留终端进程和父草稿，见 `.local/workspace-source-cli-multi-tools/report.json`；浏览器对照验证两页导航、表单、键盘切换和 390px 视口，见 `.local/workspace-browser-source-final/result.json`。原版对照回到 `about:blank` 后仍显示静态空页，尚未通过原版独立用例。

同机 10 Mbps、50 ms 三次冷缓存直达，React 候选的真实编辑器、左栏和回复同时出现于 663–717 ms，首次键入绘制在 839–944 ms，见 `.local/source-startup-multi-tools-direct/result.json`。对照原版阈值调整权限标签后，浅色桌面工具页仍有 28,693 个差异像素，会话页仍有 12,208 个，见 `.local/workspace-style-right-compact-control/report.json`。352 项测试与 TypeScript 检查通过；完整接管和正式 HTTPS 门槛仍未通过。

网页全屏时用同一个 ProseMirror 实例显示底部紧凑输入框；空白工具页保持不显示输入框。`verify-embedded-browser.ts --source --compact` 在 320、390、800 和 1280px 逐个命中编辑器、附件、侧栏、页签和退出按钮，核对浮动态写入与切回后的草稿。见 `.local/workspace-browser-compact-source-final/result.json`。原版自身复测在工具页和会话页没有像素差异，首页输入区有 25 个差异像素，见 `.local/workspace-style-right-control-reference/report.json`；像素门槛未放宽。

品牌菜单复用原版转发管理窗口。点击管理项才下载组件并读取现有规则；键盘打开菜单、Escape 返回及关闭管理后回焦均有隔离测试。菜单截图仍有 11,044 个差异像素，管理窗口所在页有 4,460 个。见 `.local/workspace-style-product-menu-built/report.json`。浮动输入框使用目标工具链支持的选择器，Chromium 的四种宽度检查继续通过，见 `.local/workspace-browser-compact-compatible/result.json`。

右栏分隔线在显示分栏时启用，尺寸沿用原版保存的宽度比例。键盘调宽、拖动、双击复位和刷新恢复均通过双渲染器对照；初始同为 639.25 px，拖到 556 px 后刷新均保持 556 px。权限提示高度相差约 0.02 px，默认宽度工具页的像素差异从 28,693 降到 18,381。见 `.local/workspace-style-pane-resize/report.json` 和两侧的 `pane-resize.json`。

`--source-candidate` 在与原版相同的本机 HTTP 合成样本中测候选。有 180 条会话、五个项目，四个模拟主机均连通。三轮新浏览器上下文测试中，左栏和真实编辑器同时可命中为 270–299 ms；随后真实按键绘制为从导航起 384–426 ms，点选对话至历史内容出现后的两帧为 567–593 ms。后两项包含自动化发出命令的耗时。该模式与 `--require-full-under-1s` 互斥，独立结果见 `.local/source-startup-all-hosts/result.json`。`verify-source-workspace-ssh.ts` 另外使用两个独立的协议后端，验证慢连接、本地和 SSH 同 ID 对话的草稿隔离、附件字节、发送和审批回包。

候选页先执行宿主脚本，连接和第一批本地会话读取与样式下载重叠，工作区挂载时复用同一个请求。候选不跑原版的侧栏分组刷新，本身的侧栏样式响应支持 gzip，样式内容未变。相同合成样本用 10 Mbps、50 ms 模拟网络，三轮冷导航中宿主握手为 296–331 ms，首批会话数据为 317–353 ms，左栏和真实编辑器同时可用为 639–652 ms，按键绘制为 794–847 ms；接着点会话到历史绘制为从导航起 961–1,029 ms。起始对照见 `.local/source-startup-profile-shaped/result.json`，本轮见 `.local/source-startup-profile-reduced/result.json`。这些数据反映候选同机隔离路径，正式 HTTPS 验收尚未运行。

`--source-direct-history` 单独测冷缓存直达会话，等待左栏、编辑器和实际回复都可命中并经过两帧，随后在保留网络限制的同一页按键。10 Mbps、50 ms 下的起始对照为同屏可用 715–730 ms、输入绘制 870–944 ms，见 `.local/source-startup-direct-history/result.json`。把第一页历史读取移到宿主脚本后，三轮在导航起 228–231 ms 发起、325–330 ms 收到，React 在 546–572 ms 取用。同屏可用为 661–726 ms，输入绘制为 869–942 ms。每轮断言同一会话第一页只读一次；报告见 `.local/source-startup-direct-history-prefetch/result.json`。

本机试用用 `node scripts/verify-source-workspace-cli.ts --preview`。它显示临时会话的本地链接，使用隔离的 CLI 和脚本化响应，45 分钟后清理。

项目行在悬停、键盘聚焦或触屏操作时显示更多和新建对话。详情卡支持移入、Escape 关闭和回焦；打开才读取项目会话数和运行状态。置顶、改名和来源文件夹复用相同宿主状态。`--probe-project-hover`、`--probe-project-touch` 通过，真实 CLI 0.169.1 复测见 `.local/workspace-source-cli-project-hover/report.json`。对照 `.local/workspace-style-project-aligned/report.json`，浅色和深色的项目悬停分别有 12,408 和 13,006 个差异像素。项目分组、批量归档和文件管理入口待接入。

会话保留中文进度消息与工具执行的原始顺序，聚合相邻工具，并可展开命令、文件改动、工具结果和计划。长代码和表格在各自容器内滚动。`--probe-activity-stream` 验证实时流、隔离另一会话、收尾恢复及窄屏无横向溢出；双渲染器 `--probe-activity` 的历史和命令交互通过，展开命令仍有 36,654 个差异像素，见 `.local/workspace-style-transcript-current/report.json`。TypeScript 检查和 355 项测试通过。

同机 10 Mbps、50 ms 三轮冷缓存直达会话中，左栏、历史和真实编辑器同时绘制为 686–709 ms；实际输入绘制从导航起为 963–1,049 ms，两轮超过一秒，含自动化发出按键的耗时。见 `.local/source-startup-project-10mbps/result.json`。正式 HTTPS 门禁未运行。

项目菜单接入分组、新建分组、打开项目目录及批量归档。分组沿用原版偏好，从磁盘恢复项目位置；浏览器在文件面板打开目录。归档前从宿主取得完整项目范围；发现会话范围或运行轮次变化时要求重新确认，不中断未经确认的轮次。`--probe-project-operations` 核对原版菜单及确认框，并验证候选的分组刷新、取消归档、运行中重新确认和保留无关会话，见 `.local/workspace-style-project-operations-positioned/report.json`。最终菜单在打开时才挂载内容；鼠标、键盘及窄屏触控通过，报告见 `.local/workspace-style-project-hover-lazy/report.json` 和 `.local/workspace-style-project-touch-lazy/report.json`。浅色项目菜单的截图差异从 31,494 降到 14,423 像素，深色从 31,649 降到 12,829，整页门禁仍未通过。356 项测试通过，真实 CLI 回归见 `.local/workspace-source-cli-project-operations/report.json`。

同条件冷缓存直达会话，提前挂载菜单时三轮为 755–810 ms，同时测到 1,140–1,228 ms 键入绘制；按需挂载后三轮为 689–799 ms、1,009–1,154 ms。见 `.local/source-startup-project-menu/result.json` 和 `.local/source-startup-project-menu-lazy/result.json`。

### 功能和 UI 对照

项目标记可以从悬停卡片和编辑弹窗修改。30 个矢量图标、Emoji、八种颜色、搜索和清除均接入原版的项目外观元数据；选择立即保存，刷新后恢复。真实 CLI 0.169.1 验证颜色和图标写入原生项目。浅色和深色下的交互通过，`--probe-project-touch` 另验证 390 px 下的触控开合和清除。整页像素门禁仍有差异：浅色、深色的图标面板分别相差 27,082 和 33,538 像素，差异计入背景工作区。见 `.local/workspace-style-project-marker-light-dark/report.json` 与 `.local/workspace-style-project-marker-touch-fixed/report.json`。

待发消息使用宿主原生队列，支持排队、转为当前轮补充、删除、重排、移回编辑器、中断后恢复及本地侧聊转移。浏览器用例验证刷新、排队预览、触控和编辑附件恢复，见 `.local/queue-source-parity-with-files/result.json`、`.local/queue-source-parity-mobile/result.json`。真实 CLI 的 `--queue-only` 验证跨客户端队列更新、刷新、停止后保留、恢复同一条提交和保留独立草稿，见 `.local/workspace-source-cli-queue/report.json`。待发的原生输入类型中，浏览器无法安全重建的内容不提供移回编辑器或侧聊转移。

文件审批和阻塞式 Agent 提问复用宿主的原生请求。文件审批从同一轮的改动项显示路径和增删计数，支持拒绝、单次允许、允许本次会话的编辑；提问支持推荐选项、逐题切换、键盘确认、自由填写、跳过和关闭。等待时保留输入草稿，不发出普通消息。侧栏和 Work 显示对应状态，宽窄卡片分别按原版布局。

`--probe-input-requests` 用隔离的模拟宿主，对比原版与 React 版在桌面浅色、桌面深色和 390 px 窄屏的表现。两边收到一致的审批及提问回包，并验证关闭卡片后恢复草稿。命令审批、实时 Work、TypeScript 检查和 356 项测试也通过。整页像素门禁仍未通过：深色文件审批与提问分别有 40,337 和 32,172 个差异像素，含卡片外的工作区。见 `.local/workspace-style-input-requests-responsive/report.json`。

网络与文件访问审批返回当前宿主请求的实际权限和范围，支持拒绝、允许本轮及允许本会话。标准 MCP 表单逐题收集文本、数字、布尔值、单选和多选；跳过仅翻页，取消才结束表单。网页授权需要先打开链接，再明确确认，第一次点击不回传接受。标准表单与 URL 模式以 [MCP 官方 SDK 文档](https://ts.sdk.modelcontextprotocol.io/v2/servers/elicitation) 和 CLI 0.169.1 的实际协议为准。

`--probe-external-requests` 以隔离模拟宿主对照原版与 React 版，共 45 组浅色、深色和 390 px 窄屏截图。审批范围、表单类型和取消、外链两步确认及原草稿恢复通过；整页像素门禁仍未通过，浅色网络审批相差 41,454 像素，浅色网页授权相差 33,907 像素。见 `.local/workspace-style-external-requests-final/report.json`。类型检查、356 项测试、命令及文件审批回归通过；真实 CLI 0.169.1 的发送、停止、导航和附件等回归见 `.local/workspace-source-cli-external-requests/report.json`。审批与 MCP 的专用回包由模拟宿主验证，未用真实账号授予权限。

原版仍是默认入口。浏览器工作区仍需对齐 MCP 扩展表单和用户验证、复杂工具和产物状态、语音，以及整页像素差异。先验收功能和 UI，再恢复一秒门禁和正式 HTTPS 验收。历史报告里的 `localEditorReadyAt` 仅指可命中编辑器的时间。

### 工作区接管验收清单

先走通本地与远程项目的日常路径：打开历史、翻页、发起新对话、修改、归档与恢复。每类操作核对实际主机和会话 ID，刷新后复查结果。再按原版逐屏检查浅色、深色和窄屏，覆盖悬停、焦点、键盘、触屏以及空态、加载、失败和重试。

| 区域 | 目前能走通 | 仍待补齐或验收 |
| --- | --- | --- |
| 本地项目与历史 | 项目历史、翻页、项目内及无项目新建对话；改名、置顶、取消置顶、归档和分支已在真实 CLI 验证 | 候选左栏的添加项目入口；归档列表、恢复与删除管理 |
| SSH 项目与历史 | 已登记主机的连接、项目分组、打开历史、发送、附件、独立草稿；隔离测试验证改名、置顶、取消置顶和归档 | 远程项目行新建对话；主机管理、项目录入与远程归档恢复全流程；在真实 SSH 主机验收 |
| 项目和侧栏 | 展开折叠、更多分页、标题搜索、项目悬停详情、新建按钮、编辑名称和来源目录、分组、项目标记、批量归档；设置和插件页面仍复用原版 | 移动会话归属、已读状态和完整会话菜单；项目和导航跨主机操作、工具提示和交互样式对照 |
| 输入和发送 | 草稿、输入法、换行、附件、模型与推理强度、权限、发送、停止、排队和补充消息 | 远程新会话、语音、原版附件菜单的剩余选项 |
| 消息和历史 | 流式输出、历史翻页、Markdown、声明语言的代码块着色和复制、按轮分支；最近一轮单段文字编辑与重发、失败卡片、保留停止前的正文和操作 | 含位置标注或同一轮多条用户输入的编辑；未声明语言的代码、消息内图片、剩余消息操作和折叠后的窄屏落点 |
| Work 和审批 | 实时进度、命令、文件改动、工具结果、计划；展开历史详情；命令、文件、权限审批、Agent 提问和标准 MCP 表单；重连和长等待提示 | 复杂工具结果、扩展表单和原生身份验证；工作过程样式及侧栏失败标记 |
| 对话右栏 | 本地侧聊、目录和文件搜索、预览与下载、终端、基础网页标签、产物入口和本轮文件差异 | Git 变更来源切换、文件操作及 Undo；远程右栏、结构化产物和完整浏览器操作 |

新增的 `verify-source-workspace-ssh.ts` 用例在两个隔离协议宿主注册相同 ID 的会话。从远程项目打开历史后，浏览器验证改名、跨刷新保持置顶、取消置顶、归档及刷新后仍从列表移除；本地同 ID 的会话保持原状。见 `.local/workspace-source-ssh-core-audit/report.json`。用例不建立实际 SSH 连接。

### 对话状态与右栏

从输入框发送后，先显示 Thinking；收到进度或工具项后，Working 默认展开。相邻工具项按事件顺序归组，进度消息和计划隔开不同工具组。手动收起 Working 后，最终回复出现前仍显示最近一条进度。完成时，Work 默认收起；最近一次打开命令或 MCP 结果的回合会保持展开，用户手动开合优先。只展开工具组不会改变 Work 的收尾行为。最终回复在 Work 外，展开收起不会隐藏回复。回复里的工作区文件链接和 Outputs 共用右栏预览页签，取内容仍走原文件服务。

`--probe-turn-presentation` 从输入框真发消息，在同一隔离协议场景中逐步发送进度、读取、编辑、命令和最终回复事件，对照桌面浅色、桌面深色及 390 px 窄屏。33 组截图已保存，状态和开合检查通过；候选另验证文件内容及页签复用。整页像素门禁仍未通过，桌面浅色流式回复和窄屏流式回复分别有 48,185 和 60,690 个差异像素。见 `.local/workspace-turn-presentation-paired-final/report.json`。类型检查、356 项测试、实时工具流和文件审批、提问及 MCP 回归通过。

本地对话运行时，输入框上方显示改动文件数和增删行数。结束后，回复正文与消息操作之间显示改动卡片，整卡和「View changes」都能打开同一个 Changes 页签。打开后默认铺满工作区，保留原输入框和草稿；可收回右栏。桌面默认分栏，窄屏默认统一视图，支持切换视图、换行、展开折叠、按文件定位。已打开的页签跟随 [Codex App Server](https://developers.openai.com/codex/app-server#turn-events) 的 `turn/diff/updated` 更新；历史按已经落盘、成功完成的文件项恢复，不把提议、失败或拒绝的修改计入。Changes 当前只读；Undo 等待宿主提供可撤销快照。

在隔离协议宿主下，`--probe-turn-presentation` 新验了运行中点计数、结束后键盘打开、复用页签、刷新后重新查看和切换不丢草稿。桌面浅色、深色和 390 px 窄屏共 39 组截图，交互断言全部通过；整页像素门禁未过，浅色流式回复相差 30,517 像素，浅色完成后 Changes 相差 92,756 像素。见 `.local/workspace-turn-changes-verify/report.json`。类型检查、358 项测试通过。用 `node scripts/verify-workspace-style.ts --candidate-only --probe-turn-presentation --preview-turn` 可打开隔离样例；默认 45 分钟关闭。

后端错误中的 `willRetry` 决定是否显示重连，最终失败以该轮保存的错误为准（[Codex App Server 错误协议](https://developers.openai.com/codex/app-server#errors)）。React 入口共用原版 Yard 的长等待提示；用户可停止当前轮或复制续接草稿。两处停止按钮共用当前轮的停止操作，断线和失败不会触发客户端自动重发。主动停止后保留已输出的正文和消息操作；失败卡片上方保留失败前的进度，保留编辑器内未发送的内容。

`verify-turn-progress.ts` 用同一份隔离协议脚本对照两个入口，覆盖桌面浅色、390 px 深色以及切换会话后的停止。原版在该失败样例刷新后未显示卡片；候选通过补读这一轮恢复已保存的错误和工作过程。浅色并排截图仍可见候选缺少左栏红色失败标记和消息悬停编辑。有存档的报告在 `.local/turn-terminal-reference-final/result.json` 和 `.local/turn-terminal-candidate-final/result.json`。真实 CLI 0.169.1 另通过发送、停止、草稿、分支和右栏回归，见 `.local/workspace-source-cli-turn-recovery/report.json`。

最近一轮的消息悬停会出现复制和编辑，窄屏可触控。行内编辑共用底部的 ProseMirror 配置，保留底部草稿和原消息附件。取消不写入历史；Send 先核对账号和最新轮次，再调用 [`thread/revert`](https://learn.chatgpt.com/docs/app-server#revert-thread-history) 和同一线程的 `turn/start`，沿用执行端权限。回退只影响历史；文件保持原状。后端拒绝替换或结果待确认时，保留可复制的编辑内容，不自动重提。

`verify-workspace-edit-message.ts` 记录固定原版与候选的编辑截图、取消和协议调用。原版在该合成历史样例中调用了回退和提交，但传给 `turn/start` 的输入为空；真实发送的验收用 `verify-source-workspace-cli.ts --edit-only` 跑独立的 CLI 0.169.1 与回环模型接口，核对刷新后的消息、保留的上一轮、附件、底部草稿和文件内容。候选另通过 390 px 触控、另一端更新后禁止回退和提交失败后保留输入。报告位于 `.local/workspace-edit-message-candidate/result.json` 和 `.local/workspace-source-cli-edit-message/report.json`。

React 入口在 HTML 上使用与原版一致的 Yard 语言设置默认值，保留已保存的语言覆盖。Chromium 桌面对照中，浏览器为 en-US、Yard 为 zh-CN 时，原版实际字体是 Noto Sans CJK SC；修改前候选用 Arial。修改后两侧字形、编辑卡片尺寸 734 × 100 px、行高 18.9 px 和 Send 尺寸一致。另对照了 en-US 覆盖，见两侧的 `edit-style.json`。360 项测试和类型检查通过；`--probe-turn-presentation` 复跑 39 组截图，交互断言通过，整页像素门禁仍未通过，见 `.local/workspace-turn-presentation-edit-message/report.json`。

工具过程按事件顺序分组。连续读取、命令、编辑、MCP、动态工具和网页搜索共享一条摘要；运行中在组标题显示当前工具，进度消息和阶段回复会分隔工具组。阶段回复随 Work 一起折叠，最终回复保持可见。刷新后，只在打开 Work 时分页读取该轮完整过程。展开保留阅读位置；滚回底部或点击向下按钮恢复跟随。

子 Agent 创建独立显示，状态由同一轮的 App Server 事件更新。时间线与本机右栏 Summary 都能打开对应子对话；关闭标签保留父会话草稿。远程子会话从同一主机入口打开，目前未与本机右栏对齐。

`verify-workspace-tool-groups.ts` 使用隔离的 0.169.1 协议场景，对照浅色、深色和 390 px 触屏。覆盖运行中展开、工具完成、失败结果、阶段回复顺序、刷新后恢复和子 Agent 标签。证据见 `.local/workspace-tool-groups-*/report.json`。真实 CLI 另通过发送、停止、草稿和右栏回归（`.local/workspace-source-cli-tool-groups/report.json`）；专用 MCP 和子 Agent 事件由隔离场景验证。39 张全页对照的交互通过，像素门禁仍未过（`.local/workspace-style-turn-grouped-full/report.json`）。

继续对齐工具详情卡尺寸和图标、窄屏状态，右栏 Sources、产物、Changes 的其余操作和远程工具。右栏、左侧项目与对话区都在 1:1 验收范围内。

命令组保留「工具摘要 → 命令行 → Shell 日志」两层展开。工具项按事件 ID 保留组件身份；组里加入第二个工具时，已打开的日志不收起。命令和输出分别复制，长日志在卡内滚动；运行时显示输出增量，完成时显示成功或退出码。消息操作条使用后端时间，触屏保留复制和编辑；同一会话连续发送时不插入多余的日期分隔。

`verify-workspace-tool-groups.ts --probe-presentation` 记录浅色、深色和 390 px 触屏的原版及候选对照。桌面日志正文宽度、颜色、13 px 字号和 19.5 px 行高与原版相同，垂直位置仍相差约 4 px。窄屏正文宽 338 px，两侧各 26 px，候选没有复现原版验收中内层容器横移的问题。报告位于 `.local/workspace-tool-presentation-*/`。MCP、动态工具和网页活动的详情及右栏 Sources 入口仍待完整对齐。

类型检查与 360 项测试通过，真实 CLI 0.169.1 的发送、停止、历史、草稿和右栏回归通过。整段会话的交互断言通过；39 组整页对照仍有像素差，见 `.local/workspace-style-tool-presentation-full/report.json`。

### MCP、网页与右栏 Sources

本地会话的 Summary 增加 Sources。MCP 按提供方和工具归组，保留每次调用的结果；网页搜索次数包含重复查询，详情只列唯一查询和实际打开的页面。搜索结果链接不计作已访问页面。对话里的 MCP 和右栏共用结果组件。Sources 优先展示结构化结果，普通文本仍能从原始输出弹窗查看和复制。

「View all」打开同一个 Sources 标签并保留当前输入框。网页和附件沿用已有右栏浏览器和文件预览，切回 Sources 保留展开状态。加号复用输入框文件选择，插件子菜单读取已启用插件，选择后插入 Codex 可识别的 `plugin://` 引用。Sources 订阅 [React 外部存储快照](https://react.dev/reference/react/useSyncExternalStore)；刷新后展开 Work 才读取完整工具事件，Summary 不会额外预读。

`verify-workspace-tool-groups.ts --probe-sources` 通过固定原版与 React 版的桌面浅色、深色、390 px 三组对照。React 版另验证打开网页后返回、保留草稿、刷新后复现 Sources、上传文件和带插件引用发送、从 Sources 读回附件。实际插件调用与授权未包含在隔离用例中。类型检查、363 项测试、真实 CLI 0.169.1 的发送、停止、草稿和右栏回归通过。

整页仍有像素差。12 组截图对照见 `.local/workspace-sources-image-differences.json`，原始输出弹窗仍有代码高亮、尺寸和蒙层差异。原版窄屏打开 Sources 后需要点外侧收起摘要，本版本打开时直接收起。远程右栏 Sources、文件夹选择和连接器组件仍待对齐。

### 对话中的 MCP 确认

确认请求在输入区显示入口，弹窗分组展示执行端发来的内容和作用范围。取消、关闭和 Esc 不答复执行端；确认后只发送一次结果，等执行端解除阻塞，再恢复同一份草稿。无法显示的表单支持 Skip 和 Dismiss，分别返回 `decline` 和 `cancel`。键盘关闭后焦点回到触发按钮；危险确认先聚焦 Cancel，符合 [W3C 对话框键盘指导](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)。

`verify-workspace-style.ts --probe-mcp-confirmation` 在浅色、深色和 390 px 窄屏对照了 24 组截图。打开、取消、提交、回包和草稿断言通过，另验证 React 版的键盘焦点和重复提交防护。桌面浅色弹窗整页差异从 1,070,660 降为 49,887 个像素，弹窗宽 480 px，两个版本高度仍相差约 3 px。报告见 `.local/workspace-mcp-confirmation-reviewed/report.json`；整页像素门禁仍未通过。

类型检查、363 项测试、普通提问和 MCP 请求回归通过。另用独立的真实 CLI 0.169.1 验证发送、流式消息、停止、草稿和右栏；MCP 确认及其权限边界由隔离协议用例验证。

已处理的 MCP 确认和普通表单在 Work 显示为可展开的记录。位置跟随请求到达前最后一个工具或消息，审批前后的工具维持各自的分组。只有观察到本页发送答复且执行端确认请求解除，才显示具体答复；请求撤回或由其他端处理时显示 Completed。记录按主机、会话和轮次分开，留在当前页面内存，切换会话可以回看。原版刷新后也不保留这类记录；[App Server](https://learn.chatgpt.com/docs/app-server#mcp-server-elicitation-requests) 的解除通知仅携带请求和会话 ID，刷新后仍从后端读取已保存的工具与回复。

`verify-workspace-style.ts --probe-mcp-history` 对照了浅色、深色和 390 px 窄屏的 36 组截图。交互通过，包括两侧工具排序、展开已处理和已撤回的记录、切换会话、刷新后从后端读取。浅色 Work 展开整页有 24,090 个像素差，整页门禁仍未通过。报告见 `.local/workspace-mcp-history-final/report.json`。

### 对话中的普通问答

普通提问在 Work 的原位置从 `Asking question(s)` 更新为可展开的 `Asked … question(s)`。相邻命令和文件操作仍各自分组。选项和自填答案可回看，敏感回答只保留掩码；撤回或跳过显示 `No answer provided`。回执只存在当前页面，保留会话切换语义，不写入历史。按 [App Server 协议](https://learn.chatgpt.com/docs/app-server#toolrequestuserinput)，解除通知也可能来自清理请求；只有已提交的同一请求在收到解除通知后才显示其回答。连发提问时，固定原版的撤回用例关闭输入卡后仍暂留 `Asking question`。权限等待继续由审批卡和侧栏展示，审批完成后不额外写入可见 Work 记录。

重建后，`verify-workspace-style.ts --probe-input-requests --probe-external-requests` 完成 69 组浅色、深色和 390 px 对照，键盘打开、工具顺序、回复、跳过、撤回、审批回包和草稿恢复均通过。浅色问答展开整页仍有 33,620 个差异像素，报告见 `.local/workspace-question-receipts-reviewed/report.json`；整页像素门禁继续生效。类型检查、367 项测试、MCP 历史回归和隔离真实 CLI 0.169.1 回归通过。问答和审批回包使用模拟宿主，未在真实账号授予权限。

Work 标题的点击区只包文字和箭头，分隔线仍占满正文宽度。三组视口中，两版测试标题均宽 72.234 px，首个工具行距标题顶部 42 px；标题和问答文本的行高均为 21 px。按 [Playwright 视觉对照指引](https://playwright.dev/docs/test-snapshots)，两版使用同一浏览器环境和视口。69 组截图及几何记录见 `.local/workspace-work-layout-dismiss/`；桌面浅色问答展开差异降至 29,498 像素，整页门禁仍未过。

普通提问的 Dismiss（含 Escape）先答复空答案，再停止该请求所在的轮次；Skip 和宿主撤回继续该轮。两版隔离协议用例验证了调用顺序、轮次范围和草稿恢复。类型检查、367 项测试、运行与收尾状态回归、隔离真实 CLI 0.169.1 的发送、停止和右侧工具回归通过。

### 实时工具组与命令结果

工具组展开后最多占 224 px，可在组内滚动。命令完成时，已展开的结果立即更新；外层可保留最后一个运行标题。纯命令组收到进度消息后可继续显示 Thinking，新组开始时旧组显示 Ran commands。含读取和编辑的混合组，以及问答回执后的组，保留各自的工具摘要。标题变化沿用组首条目的键，[保留同一个 React 展开组件的状态](https://react.dev/learn/preserving-and-resetting-state)。Work 运行计时沿用工作区语言；页面在后台时暂停计时更新，返回后按开始时间重新计算。

`verify-workspace-tool-groups.ts --probe-group-states` 用同一协议事件验证命令完成、追加工具、流式进度、长组内滚动、流式正文和收尾。桌面和 390 px 各跑浅、深色，共 36 组配对截图；组内可滚到底查看结果，草稿保留。`.local/workspace-group-stages/` 保存报告。整页像素门禁仍未通过：桌面浅色流式回复还有 29,256 个差异像素；窄屏 Shell 复制按钮的显隐也与原版有差异。

### 流式回复中的代码

声明语言的 Markdown 代码块复用固定资源的语法着色器和主题颜色，第一次遇到代码时才加载着色器。模型输出保留为文本和语法标记。语言未识别、着色器加载失败或代码超过 64 Ki 个字符时保留纯文本。流式代码的围栏闭合后显示复制；若回复先结束，已输出的代码仍可复制。换行开关在增量和收尾时保持原位，复制保留代码原文。

同一条 `--probe-group-states` 回放接入了混合工具组后的分段代码、向上滚动阅读、新输出到达、回到底部、复制和刷新。证据见 `.local/workspace-conversation-states/`。桌面和 390 px 浅深色的代码尺寸、关键词颜色与 36 px 控件尺寸均一致。向上滚动阅读时，两版都保持位置。复测 390 px 长回合，打开过命令结果后两版自然完成时均保留 Work 展开；代码块顶部距视口顶边分别为 133.20 和 133.25 px。两边都手动收起后，落点仍差约 7 px，代码图标也有差异。更早约 214 px 的差值来自原版额外点击屏幕外的 Work 标题。

`--probe-work-settlement` 对照了自然完成、仅打开工具分组、查看具体命令结果、查看后手动收起和主动停止。打开过的单条命令切换到历史行时，两版都收起该命令的输出，外层 Work 保持展开。React 版用例延迟完整活动响应，确认摘要生效后仍能看到进度、最终回复取自摘要，详情到达后才替换屏幕上的活动。桌面深色、390 px 浅色、长回合与重复 MCP 共 42 组配对截图，见 `.local/work-inspection-final/`。369 项测试和隔离真实 CLI 0.169.1 回归通过。停止计时与标题按钮样式、整页视觉验收仍有差异。

### 对话中的图片附件

用户消息直接渲染结构化图片。随消息保存的图片读取原数据，磁盘图片按会话主机走现有文件通道。发送时附带的文字说明和结构化图片指向同一路径时，消息里只显示一张缩略图。文件消失时显示错误，方框尺寸保持不变。

点击缩略图打开全屏预览，支持按键切图、缩放和下载原图；关闭后回到触发缩略图。焦点限制在原生 [modal dialog](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element) 内。`node scripts/verify-workspace-message-images.ts --source` 验证 React 版，省略 `--source` 跑固定原版。桌面与 390 px 两种宽度、浅色与深色均有对照截图。缩略图为 80 px，间距 8 px；预览的起始尺寸、位置和首个缩放档位一致，缩略图在整页里的纵向位置差 1.25–1.5 px。原图下载的字节、磁盘文件消失和刷新恢复都有断言，证据见 `.local/workspace-message-images/`。

本轮覆盖用户上传的图片。原版图片编辑、触屏捏合缩放、助手生成的图片和真实 SSH 对照留待验收。原版隔离样本中，缺失文件仍留在加载态；React 版显示失败。关闭回焦行为也有差异。

### 重复 MCP 调用和原始输出

Work 将相邻、同一提供方与工具身份的成功调用折成一行，以首个调用 ID 作为 [React 列表键](https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key)。第三次调用加入时，组内已展开的结果保持原位。正在运行或失败的调用、交互式工具和被其他操作隔开的调用保留各自的行。Sources 仍按整个会话归集，同一工具的非相邻调用也能在那里一起查看。

Work 和 Sources 共用原始输出弹窗。成功和失败 JSON 保留各自的结果类型和原始载荷，复制内容与弹窗一致；只在打开时生成原始 JSON。弹窗桌面宽 520 px，390 px 视口宽约 359 px，长代码区高 512 px 并独立滚动。窄屏 Shell 复制键默认隐藏，鼠标或键盘焦点进入对应区域时显示。

`verify-workspace-tool-groups.ts --probe-repeated-mcp` 对照桌面和 390 px 浅、深色共 28 组截图，覆盖成功合并、失败分隔、结果复制、键盘关闭及刷新后恢复。报告在 `.local/workspace-mcp-repeat/`。类型检查、367 项测试、Sources 和 Shell 浏览器回归、隔离真实 CLI 0.169.1 回归通过。整页视觉门禁仍保留；该 MCP 用例使用隔离协议宿主。

历史 Work 里只有一条已完成的普通命令时，和原版一样点一次就展开 Shell。两版通过了同一套历史分页、命令展开和重复开合检查。桌面浅色展开 Shell 的整页截图仍有 26,149 个差异像素，报告见 `.local/workspace-mcp-repeat/work-visual/report.json`。实时多工具组及刷新重开回归通过。

### 对话内交互式工具卡片

工具声明 `ui://` 页面时，卡片在当轮工具调用的位置显示，和普通工具组分开。资源就绪后，卡片接收工具输入和结果；打开原始输出可以查看 JSON。收起 Work 和本轮完成后的摘要更新都保留同一个卡片实例。历史摘要省略卡片条目时，展开 Work 会从完整记录恢复。资源或握手失败时，卡片保留文本结果和 Retry 入口。

卡片使用 [MCP Apps 消息协议](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html) 和 [Codex App Server 的 UI 资源读取接口](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#mcp-app-ui)。卡片运行在独立沙箱，不能直接访问父页面或网络。按钮通过会话所属宿主调用同一 MCP 服务中允许卡片使用的只读工具。

`node scripts/verify-workspace-tool-groups.ts --source --probe-mcp-app` 可重跑 React 版；省略 `--source` 运行固定原版，加 `--narrow` 或 `--dark` 切换视口和主题。桌面、390 px 和浅深色共记录 32 张 React 版截图及 16 张原版对照截图，交互断言通过。固定原版仅在隔离测试档开启 MCP Apps；记录了卡片外框、加载、Work 开合和右栏入口，原版卡片内容未完成握手。卡片内容和整页样式还未通过 1:1 验收。

`node scripts/verify-source-workspace-cli.ts --mcp-app-only` 用真实 CLI 0.169.1、独立 MCP 进程和本地脚本化模型响应验证了模型调用、UI 资源读取、卡片按钮回包及保存历史；普通真实 CLI 回归和 367 项测试也通过。证据见 `.local/workspace-mcp-app/`。

### 交互式工具的右栏标签

本地会话的「Open app in tab」默认打开全宽标签。退成分栏后，消息里保留一行入口，点它会选中同一个标签。收起右栏或切换标签会保留工具页面，关闭该标签才将卡片移回消息。关闭最后一个工具标签后，键盘焦点回到卡片入口。桌面非选中标签的关闭按钮在悬停或聚焦时显示，触屏直接显示。

React 保持同一个 [portal 容器](https://react.dev/reference/react-dom/createPortal)，借助浏览器 [`moveBefore()`](https://developer.chrome.com/blog/movebefore-api) 转移 iframe；卡片内部状态和尚未返回的工具调用都保留。没有该 API 的浏览器切换位置时重新初始化 iframe，复用已读取的资源。iframe 仍使用原有沙箱及会话范围，并收到 [MCP Apps 显示模式更新](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#display-modes)。

`verify-workspace-tool-groups.ts --probe-mcp-app-tab` 对照桌面和 390 px 的浅深色布局，共 36 组配对截图。加 `--source` 验证 React 版，加 `--no-atomic-move` 验证重载回退。原版的隔离卡片内页仍停在加载；原版 390 px 分栏的右栏开关超出视口，Yard 在该宽度保留覆盖布局和可点按的控件。整页像素仍未对齐。

隔离真实 CLI 0.169.1 用例实际在右栏调用 MCP 工具，关闭标签后检查回包和主对话草稿。记录见 `.local/workspace-mcp-app-tab/`。SSH 右栏接入见下节；托管连接器和旧版组件仍待接入。

### 消息恢复、运行计时和原版消息样式（11 月 20 日）

当前会话在连接恢复、回到前台或重新联网时重新订阅，并分页补齐到上次看到的轮次。生成中的完整活动也会恢复；可见页面每 15 秒核对一次保存记录。恢复读取合并执行，保留已收到的增量、工具完成状态和活动顺序。宿主连接关闭后，新请求立即返回错误，避免 WebSocket 丢弃请求后一直等到超时。恢复路径只重读和订阅，发送与工具操作仍走各自的提交入口。

`Working for …` 使用后端保存的开始时间，每秒更新，重新进入保留此前已用时间；开始通知尚未包含时间时先记录接收时间，保存记录返回后校正。真实 CLI 0.169.1 的两个独立页面验证了断线期间漏掉 4 轮对话后的分页补齐、生成中刷新、离线期间结束、计时继续递增、无重复消息和草稿保留。见 `.local/workspace-sync-cli/final/report.json`。

思考标题按原版 `dZa/fZa` 提取最后一行可见 Markdown，过滤评论，并按实时工具阶段替换标题。保存后的 Work 不额外插入思考摘要。消息链接复用固定资源的 Mention 类、图片和文件 SVG，保留原版字重、视觉基线、焦点环与悬停虚线；默认深色主题补齐原版主题提供方的蓝色变量。工具的成功、提问、重连和等待输入图标也取自固定资源。

桌面浅色、深色和 390 px 的链接颜色、字重、SVG、尺寸、基线与 hover 样式对照通过；Enter 与 Space 打开对应文件预览通过。桌面和窄屏深色的思考状态回放、流光动画、工具组和滚动条对照通过，证据见 `.local/workspace-final-ui/`。类型检查、372 项测试、工具组回归和隔离真实 CLI 常规回归通过。全工作区 1:1 验收继续沿用各节的待办；Changes 按当前要求暂缓。

### SSH 会话右栏与宿主隔离（11 月 20 日）

SSH 会话现在渲染同一个右栏组件。Summary 中的侧边对话和子智能体在右栏打开，主会话与草稿保留；新建侧边对话、发送、排队消息转移使用该会话的宿主。侧边对话草稿及附件按宿主和会话分别保存。工具标签、终端和 MCP 页面沿用已有组件，浏览器标签的会话标识也包含宿主。Changes 继续保留当前范围。

Outputs 的存在检查、文件预览、下载、目录浏览、模糊搜索，以及 Sources 的附件和插件列表都显式传入宿主，复用现有文件服务和 Codex RPC。文件组件和调用接口要求提供宿主参数，类型检查可以发现漏传的入口。排队消息转移若被后端明确拒绝，恢复到目标侧边对话的草稿和附件；未知提交结果保留检查提示，避免自动重发。

`node scripts/verify-source-workspace-ssh.ts` 使用两个独立协议后端，刻意共用主会话、侧边对话、轮次及审批 ID。验证了草稿隔离、右栏打开与关闭、远程分支创建和发送、Outputs 与文件工具、Sources、排队消息转移及拒绝后的刷新恢复，也继续覆盖远程附件、审批、重命名、固定和归档。证据见 `.local/source-ssh-panels/report.json`。这是隔离协议验收；真实 SSH 的图片与 MCP 右栏对照仍需补齐。

372 项测试与隔离真实 CLI 0.169.1 常规回归通过；后者覆盖本机终端、右栏工具、文件操作、发送与流式消息、输入法、停止及侧边对话，记录见 `.local/source-cli-ssh-panels/report.json`。本节修复宿主请求与状态归属，整页视觉和其他功能的待验收范围仍按前文记录。

### 生成图片与图片查看记录（11 月 20 日）

React 对话区接入 `imageGeneration`，按固定资源的画廊布局显示主图、缩略图、自然比例和生成中点阵；生成结果优先使用保存路径，文件请求携带原会话宿主。图片查看记录使用原版图片图标，只合并连续的 `imageView`，展开后复用已有图片预览和下载组件。

隔离协议回放覆盖历史图片、选择缩略图、图片比例、生成占位、完成后的文件地址、查看分组、下载字节、重新联网和刷新后的去重，记录见 `.local/generated-images-source/`；原版画廊与 Canvas 入口的对照见 `.local/generated-images-original/`。当前 React 主图打开现有预览；原版独立 Canvas 标签中的编辑工具仍待接入，不能据此宣称图片功能全部对齐。

### 实时工具标题与侧栏历史同步（11 月 20 日）

对照固定资源 `inline-followup` 的 `Xe/Ze` 和活动标题组件，活跃工具组使用当前操作或公开思考标题；等待下一步时显示带原版流光的 Thinking。读文件完成后、探索仍继续时保留当前文件标题。结束活动后再显示工具汇总，轮次完成后保留正式回答。浅色桌面与深色窄屏的混合工具回放覆盖上述切换，记录见 `.local/live-operation-original/`、`.local/live-operation-source/` 和 `.local/live-operation-source-mobile/`。

侧栏监听会话与项目的变更事件，按宿主合并 100 ms 内的刷新；运行状态与归档即时反映。回到前台、重新联网和连接恢复时补查，可见页面每 15 秒核对一次。只刷新已加载的宿主，逐字消息不会触发列表读取。列表重新读取已展开的页，使用修订号排除过期结果，首次读取也不会覆盖更新后的数据。

两个隔离协议后端共用会话 ID，验证了外部新建、运行状态、重命名、排序、归档与恢复、离线漏失更新，以及多页历史刷新后保留旧页并删除归档项；13 项 SSH 综合检查通过，记录见 `.local/sidebar-live-updates/report.json`。类型检查、372 项测试和真实 CLI 0.169.1 常规回归通过，后者记录见 `.local/source-cli-live-ui/report.json`。这些结果覆盖本节修复，完整工作区的 1:1 验收仍在继续。
