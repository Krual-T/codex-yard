# 自有 React + TypeScript Web 前端

状态：实施设计 v12，2026-10-29，完整功能和快照退役仍在实施。覆盖当前 Yard Web 的 F00–F23 功能账；不得以首批叶组件代替全量。用户要求移除整个 `vendor/codex-app/` 后仍可安装、构建、启动和验收。本设计替代固定函数注入方案，旧来源保留为行为研究和可复用源码。

## 入口与现有能力

浏览器加载自有 HTML、CSS 和 `src/native/browser-entry.ts` 生成的 bundle。入口直接从 npm 导入 React、`react-dom/client`，挂载 `src/renderer/app/App.tsx`。应用自己管理路由、页面树、交互和浏览器状态。最终构建、服务器静态路由和部署产物均没有 App 快照路径或回退。

原入口调用 `Ag/jg`，`browser-host.ts` 动态导入快照 RPC 基类；这些不再用于自有入口。自有 HTML 位于 `public/index.html`，构建由 npm React 生成 `.local/renderer`，服务器的自有页面静态资源只从该目录服务；文件API、受限可视化iframe、Chrome companion下载分别沿用既有路由及权限边界。旧 `renderer-migration.ts`、资源元数据和原工厂在替代消费者上线后定向删除；最终检查从源码导入、bundle metafile、打包清单及运行网络四处排除加载路径。

| 已有能力与仓库证据 | 本次处理与实际消费者 |
| --- | --- |
| `lib/codex.ts` 的 CodexConnection 连接既有 daemon、握手、关联请求、过滤配置、区分写请求结果未知 | 保留；服务器继续拥有 CLI 连接生命周期，浏览器不直接实现 daemon 传输 |
| `src/native/server.ts` `/native-host` 的 mcp-request/response、fetch、通知和 host 路由 | 保留现有显式 wire envelope；自有 WorkbenchClient 替代原版私有 MessagePort/RPC 引擎 |
| `thread-projects.ts`、server 的 settings/global-state JSON、hosts.ts、queued-send-locks.ts | 保留权威持久来源、项目/host 标识和写入语义；侧栏、设置、队列直接消费这些服务 |
| `files.ts`、`browser-files.ts`、terminal.ts、ssh.ts | 保留文件/SSH/终端服务及权限校验；替换继承私有 RpcTarget 的浏览器封装，挂接自有文件和终端组件 |
| `src/browser-reuse` Chrome MCP、client broker/router 与 TSX webview | 复用服务和可独立的 React 组件；移除依赖原版路由/dispatcher 的 install 组合，元素引用写入自有 composer 草稿 |
| `visualization-sandbox.ts`、visualizations.ts 与 host-tools.ts | 保留受限 opaque-origin sandbox 和已实现宿主工具；重建自有输出/iframe 控件及明确 MessagePort 协议，删除快照文本替换 |
| `lib/app-tools.ts` 与 `lib/owned-tools-adapter.ts` | 自有 stdio MCP 适配器暴露既有工具目录并调用受限 host handler。CLI0.164 的隔离脚本provider实测：模型调用含thread/turn/call，直接工具调用只保证thread；后两者缺失表示null，不伪造ID。支持初始化/目录/调用/取消/错误/断线，部署保留两个TS文件相邻路径 |
| 旧迁移的 composer/messages/settings/sidebar 源码工厂 | 复用已恢复逻辑与行为样本；React、控件、状态、parser 和 host 服务改由自有源码或 npm 提供 |

## 状态、路由与模块契约

Manager 负责入口、shell/路由、WorkbenchClient、会话 reducer、共享契约、服务集成和构建。A 负责 composer/草稿/提交控件/队列，B 负责消息/Markdown/工具展示，D 负责设置/主题/自有控件。共享契约在 `src/renderer/workbench-contract.ts`；组件通过 props 接收真实客户端和当前 host/thread/cwd，直接使用 npm React。没有注入 framework 或第二套业务服务。

WorkbenchClient 提供 `rpc(method,params,hostId)`、`host(endpoint,params)`、事件 `subscribe` 和审批 `reply(ref,response)`。它使用 `/native-host` WebSocket，关联请求id、超时及响应错误，建立后发送ready。reply为必需方法，反向请求有必填ServerRequestEvent.requestRef；浏览器验证后才交UI。审批ref由服务端产生，包含hostId、每个请求唯一的generation和原请求id，并在宿主绑定原连接。generation不是host代次，同host的不同请求可有不同值。只向收到请求的原连接发送，禁止回复时自动重连；resolved/取消/断开使原ref失效，同ID新请求不能接受旧ref。服务端发送回执表示已转发，不能声称daemon已完成业务处理；发送不确定时保留未知结果，不能自动再次批准。

App 以 `/`、`/local/:threadId`、`/settings/:section` 和已存在的独立页面路由为入口，并兼容当前host查询参数、旧会话别名和分享后的直接链接。页面历史使用History API；模块不另存一份当前会话。设置接收必填的pathname/search/hash/history state及onNavigate，导航携带replace/back语义，不保留initialSection或第二份section权威状态；内部切换、重定向、host更换、关闭和back/forward均经过同一个未保存守卫。非默认路由逐项按F20/F23实证恢复，未核实分支保持打开。

App 的 ConversationSessions 按实际host/thread复用现有loadThread和thread-state reducer，只维护CLI数据的界面投影。主页面、Mini和侧聊可以同时引用同一会话，首次可写消费者以thread/resume(excludeTurns:true)订阅，最后一个消费者离开才unsubscribe；归档消费者不resume，最后一个可写消费者离开时解除订阅，保留只读投影。每个key串行处理原订阅、读取与释放，旧代次结果不发布到新连接。读取先取元数据，再完整分页thread/turns/list(itemsView:full)，非full（含summary/notLoaded/缺省或未知值）turn继续分页thread/items/list；重复游标或失败显示真实错误，不静默截断。

首次进入无投影的会话可显示加载页。后台历史核对、完成事件、revert和断线恢复保留已挂载编辑器；历史完整标记先失效，只有完整读取后恢复。不能以加载占位卸载正在等待回执的编辑器，丢掉错误或内存稿。桥断线使全部实际host投影失效，单host daemon断线只影响该host；重连重新订阅，不能把旧连接回执作为新订阅证明。该服务没有第二套传输、发送账本或会话业务状态；CLI仍为历史权威。当前主页面已经接入，Mini和侧聊的真实消费者接线仍须验收。

订阅权限与历史完整性分开：缓存的 options/thread 不授权写入。最后一个 owner 离开时立即撤销权限、使读取代次和连续性失效；所有缓存项（含无 owner 的创建投影）在桥或所属 host 断线时失效。resume/unsubscribe 的结果未知时保持原操作围栏，复用 WorkbenchClient 既有 pending request 和 CodexConnection 的原请求迟到终态观察；仅同一原连接的终态能解除，观察超时不算终态，不重复订阅。重连另起实际订阅。被切走的活动区间保持缺口提示，后续 item/started 不抹掉已丢区间，直到完整终态历史核对。回退只使历史完整性失效，不清空已挂载编辑器的 thread。外部 archive 同步撤销 canSubmit，同时保持原 composer 挂载并 inert；恢复归档后可继续原稿。队列启动及发送在等待 ready 后再次核对实际 host/thread、导航代次、归档及活动 turn。

新会话先冻结提交版本和 clientUserMessageId，再 thread/start，保存真实 thread、设置、原稿身份及所选项目 ID。BrowserWorkbenchClient 在原响应结算时同步发布创建回执，使共享会话源采用该连接的真实订阅；不再保存 Entry.created 重复初始投影。持久 creation 是恢复材料，不是新连接订阅证明；绑定原稿、安装路由和事件监听后才 turn/start。实际 CLI0.164/0.163 的新空会话尚无 rollout，resume 和完整历史会拒绝；有准确持久创建材料时可用 includeTurns:false 核对元数据并保留草稿，其余错误仍显示真实错误。Leader 两版实证同时说明：换连接后明确首发仍会执行且 CID 持久，但无 turn/completed 通知并为 notSubscribed。因此不得把 resume 失败当作输入未执行，也不得自动重发或把旧创建回执重新视为订阅。新连接空会话的明确首发与后续订阅恢复仍是须独立接齐的消费者，不以当前保留稿的错误态关闭功能。

设置 history.state 只保存来源 host/thread 或 project ID 与返回 URL，不保存易过期路径。整页刷新后从 thread-project-state 和正确 host 的 thread/read 重新核对；不按 cwd 猜项目，不把另一 host 的同 ID 记录借给当前页。父级按解析后的 settings 路由（含插件路径 host）同步传递 scopeStatus；源未就绪或失败时只暂停 Plugins/Hooks/Skills，General/Appearance 仍可用，失败可明确 Retry。当前 controller 的 dirty/unknown 状态保留，不因暂时卸载把未完成写当作成功。

CLI0.164和隔离桌面CLI0.163.0-alpha.10.2的脚本provider实测都表明：活动assistant前缀不在thread/read、turns/items或resume结果中；turn/completed还可能是itemsView:summary。arrival eventCursor不能代表快照包含范围。观察到item/started的项从起点应用delta；读取期间保留本地已观察投影，完成item按ID替换。未观察起点的活动项仅展示明确标注的已收到后缀，不能伪称完整；新打开/重连显示活动内容尚未完整的提示，完成后重新读取完整历史。summary/notLoaded/缺省或未知itemsView均按不完整合并已有items；只有明确full且终态的历史可移除省略项。读取晚于完成通知返回时保留已观察完成项和终态，再以完整历史核对。该限制的实际UI与共享daemon版本仍须验收。

草稿属于浏览器状态，身份为host、必填稳定clientThreadId/draftId、placement和旧draftKey；cwd是上下文，不能把同cwd的两个新草稿合并。兼容native-atoms中composer-prompt-drafts-v2/v1、composer-retained-documents-v1、client-thread-bindings-v1及draft-thread-identities-v1，保留document marks/attrs、ordered input、text_elements、hints、图片fileId/detail和浏览器引用上下文。无法转换的旧内容保留原值并显示恢复选项，不以空串覆盖。成功回执只清除所提交版本，失败及更晚编辑保留。

composer-drafts.v3是同一UI atom根中的事务记录，首次导入精确旧v1/v2字节；可信本地反向绑定和带host证据的远程身份决定可读取的旧稿。不同旧值和并发编辑保留独立版本，界面可选择，不能以最后写入覆盖另一页。组件先保留提交revision，再调用App并传owner/revision/explicit overrides。导航守卫冻结当前输入并await controller.flush；存储失败保持挂载。thread/start回执允许一次明确的null→thread身份绑定，原提交owner不改写、过期controller仍失效。按原owner/revision清理A，不能清掉较新的B或其他冲突版本。

普通send的send-recovery记录只保存不可变的提交意图，不作为另一份可编辑草稿。prepared/creating/ready/sending/unknown/failed/confirmed阶段和原clientUserMessageId在对应写入之前完成事务；thread绑定随创建回执保存。跨页竞争靠该事务的阶段检查阻止重复写。已确认的失败可由用户显式重试原版本，未知结果只能通过既有host的message-send-status完整分页核对userMessage.clientId。找不到不能证明未发送，故保持未知、不重放。确认后只清理原revision；清理失败或页面中途离开时，独立于原composer挂载的全局恢复区仍可处理。创建结果未知且没有thread回执时保持待核对，不能猜目标或重建会话。

会话设置是CLI权威值的显示投影。未修改的sandbox、permission profile、审批和collaboration配置不随普通发送重建；App传递composer显式改动，只有实际更改的字段进入turn/start。选择新的sandbox明确清除冲突profile，其余完整策略和developer_instructions保持后端原值。项目新增在现有native-state写入区间内读、合并、持久化并在失败时回滚；首发使用用户所选项目ID，不用cwd推测同路径项目。旧项目归属枚举只读取已连接host，不为只读侧栏唤醒已关闭SSH。侧栏列表按host、归档过滤与请求代次隔离；搜索遍历全部分页，标签的只读性来自目标本身的归档事实。

输入回调的action必填，判别联合区分send/queue/steer，steer必带目标turnId；保留granular审批、permissions profile、reviewer等协议值。编辑使用原消息行内编辑，回调返回Promise并固定hostId/threadId/turnId/itemId，format/hints保持原始可缺省语义，保留完整有序输入；引用prefill不承担编辑身份。默认仅最后一条user消息可编辑、拒绝活动tail；回退前将编辑内容、目标和clientUserMessageId保存在既有native-atoms中明确versioned恢复记录，未知字段保留。单一提交控制链将thread/revert(beforeTurnId)和turn/start(turnTrigger:edit_user_message)放在同一Yard会话写入区间，和普通发送/queue/start串行。回退已确认但启动失败时保留恢复入口，重试只启动、不再回退；结果未知先读历史按clientUserMessageId核对，未能证明时要求用户核对，不自动重发。外部客户端不受Yard锁约束，回退前重读完整历史和活动状态核对，daemon没有原子compare-and-revert时保留并发限制，不伪称跨客户端原子。修改文本只变更可证明安全的text及引用range，不丢失格式/上下文。队列权威来源为thread/queue/*，queue/start前App恢复订阅；host/thread活动互斥、host/thread/message已发回执及CLI queue id用于结果核对，无法证明时保持未知，不自动重试或假定条目仍在。临时UI恢复记录不形成第二份业务队列。

消息组件接收 CLI ThreadSummary/turn/items，负责逐类型展示、正文/附件/复制/编辑/代码和工具活动。未知 item 以可展开的明确类型与数据展示，不悄悄丢弃。Markdown parser、高亮、数学、Mermaid 等采用按真实功能需要引入的包管理依赖；应用特有链接、文件路径、复制、外部资源和展示策略留在自有 TSX。

设置通过get/set-setting、get/set-global-state、get/set-persisted-atom和CLI config/read/batchWrite访问原来源。后两个atom端点由浏览器WorkbenchClient处理，复用updatedAtom和旧native-atoms key；读、条件检查、更新位于同一个IndexedDB readwrite事务，事务完成后才回成功，失败拒绝。成功后本页订阅及跨页BroadcastChannel只发送失效键，消费者异步重读唯一权威记录。UI偏好是全局host设置，CLI配置是执行host作用域；界面不接触token/env。config/read(includeLayers:true)取得实际user层file/version，缺可信版本不写，冲突保留编辑。实际CLI0.164及桌面0.163-alpha只提供可写base user层，不支持旧profile/profiles配置；当前模型与effort按该层真实file/version写顶层键，不发明目标。其他后端多层按真实身份选择，不以合成fixture当本机能力。

共用native-state.json的项目、偏好、pet与SSH自动连接变更共享一个串行提交区间，包含读取旧值、修改内存、捕获快照、原子写入和失败回滚。不能只串行文件写入，否则会保存其他尚未提交的内存值。成功持久化后才广播；较晚编辑不被旧回执覆盖。原设置保存须连接真实消费者：composerEnterBehavior、followUpQueueMode、主题字体、终端位置等，不能只证明值写入。平台原先不支持的操作保留准确错误/空态，不能用“不支持”代替已有Web功能。

host工具read_thread在真实server接线中使用turnLimit/cursor分页历史，按includeOutputs投影，默认最新10轮、每轮最新60项、不含输出，按maxOutputCharsPerItem（默认4000）截断输出并返回可继续读取较早turn/items的游标；不能把外层参数检查或mock handler测试当作真实实现。取消沿MCP适配器到host请求，断线不重放写入。

## 兼容、并发和断线

编辑恢复使用既有 `native-atoms` 中的 `codex-yard.message-edits.v1`，按 host/thread 保留 origin、完整 editor、草稿版本及提交阶段；它只保存 UI 恢复数据，CLI 历史仍是会话权威。服务端以 host/thread 串行执行完整来源核对、回退、启动，正常发送和队列启动使用同一区间。回退已确认而启动失败时只允许 retry-start；任何未知结果先用原 clientUserMessageId 只读检查，检查确认未启动后必须由另一次明确点击触发启动。

每份提交还保存实际发送时的 editor sessionId/revision。只读核对保留该版本；如果用户在旧请求未知期间继续写了新稿，旧请求“已启动”只确认旧稿，返回可见说明并保留新稿，不能进入当前稿的成功清理路径。刷新也保留这个区别。跨页编辑采用读取时观察值与事务内当前值比对；冲突保留草稿并要求刷新核对，写请求不自动重放。

浏览器UI atom统一保存于`codex-yard.ui-atoms.v1`数据库、`atoms`对象仓库中的`native-atoms`单记录。首次读写在同一readwrite事务中导入旧localStorage JSON，保留所有未知键及精确原始字节；无法转换的JSON或根类型也保存原始字节并阻止编辑。导入完成后只读写IndexedDB，不双写、不回退到localStorage；旧原值是只读恢复材料。所有消费者改为异步读取，条件更新函数必须在事务内同步执行，失败或配额错误中止事务。BroadcastChannel只通知键，不携带或保存另一套权威值；遗漏通知不影响下一次读取的正确性。编辑CAS也在同一记录事务中核对，跨页旧观察不能覆盖新稿。草稿原有独立scope/revision逻辑继续保留，旧native-atoms导入消费者须使用本模块读取。

之前Web Lock加MessageChannel在实际双页400次写入中丢1条，材料保留。Chromium的renderer缓存和pending mutation使JavaScript锁不能等价于持久事务，不能靠延长等待关闭。采用浏览器原生事务后，验证首次并发导入、400次跨页更新及新页面回读、未知字段、malformed原值、事务中止和实际App客户端。无同步子页面或自制确认协议。参考[IndexedDB事务调度](https://www.w3.org/TR/IndexedDB/#transaction-scheduling)；具体检查结果随来源提交记录，其他浏览器仍需实际验收。

原dataDir的settings/global-state、host catalog保持权威。项目assignment/projectless/output/workspace hint迁到明确host/thread键；旧local/remote记录只有在能证明host时适配，不可推导的原记录保留并显示待确认，不默认为local。接口响应/事件带host/thread，撤销、reset及批量操作同样限定身份。浏览器native-atoms按旧key导入，识别tab/sidebar/theme/draft/queue的实际形态；同时保留workbench.browser-comments.v1和既有Chrome client身份，不换配对身份或删批注。跨tab atom失效通知通过BroadcastChannel，业务通知仍由各自CLI连接提供。

| 场景 | 所有者与结果 |
| --- | --- |
| 切换 thread 时旧 read 晚返回 | App 以 host/thread 和读取代次匹配，旧结果不会覆盖新页 |
| 编辑触发thread/reverted时历史读取未完成 | 回退使之前读取代次失效，清除旧buffer并重读；完整分页历史移除缺失的已存turn，仅保留本次读取之后确实收到的新活动，不永久合并已删除历史 |
| 流式增量与完整读取交错 | 已观察started项保留流投影；完成历史按ID替换；未观察前缀明确提示，summary合并；不根据到达游标重复追加delta |
| socket 断线或写请求超时 | client 拒绝在途请求并标记结果未知；不重放写入。保留草稿，重连读取 thread/queue 核对后让用户决定再发送 |
| 浏览器缓存挂起与恢复 | pagehide.persisted挂起socket并保留订阅，pageshow.persisted重连、刷新历史/项目/偏好；最终离开才close。缓存恢复不重放写入，真实BFcache资格和整页仍需单独验证 |
| 多页面同时消费队列 | host/thread活动互斥、host/thread/message已发回执和CLI queue id；成功release(sent)，未知结果先核对queue及历史，不能假定条目仍在或重发 |
| 审批/工具取消与连接变化 | 绑定原host/daemon连接代次/id，resolved和断开使ref失效；转发回执与不确定发送分别报告 |
| 文件/终端/Chrome 不可用 | 对应组件呈现真实失败并保留可恢复输入；终端输入和 mutation 均不自动重发 |

可视化继续使用独立opaque-origin iframe和严格CSP。父页面只接受当前iframe的source、初始化ID和一次性MessagePort，切页/卸载撤销端口。端口仅实现现有widget请求目录，禁止向内容提供通用WorkbenchClient.rpc/host。sendFollowUp走可见确认/预填再由输入链提交；文件读取仍受原host路径与权限约束。

首页身份是每个host的sessionStorage指针，实际稿仍由既有IDB事务保存。首发创建回执将原draftId绑定到真实thread；离开已flush的首页或从持久回执启动时，只轮换已经被该host/thread消费的首页指针。直接访问 `/`、显式New chat和切host均使用该host尚未消费的身份；刷新保留当前未发送稿。旧单UUID指针保留为其他host的迁移身份，不删除原稿/绑定。旧原版new-conversation稿的首次事务认领仍由composer迁移消费者继续补齐。

Chrome和可视化通过App实际工具栏及消息链接进入同一侧面板。Chrome批注保持原host/thread/draft归属，新建thread沿原稿身份使用同一批注；向composer同步必须等待原稿事务成功，再串行处理后续批注版本，避免插入未完成时丢失删除。移除和已发送确认按精确引用版本操作，旧发送不得清理后来批注。可视化Tweak和carousel选择保存在原widget状态服务；每次发送冻结当时的modelContent与标准references为untrusted上下文，privateContent不进入模型输入，未知发送恢复复用被冻结内容。队列上下文能力、live分支和完整F18/F19体验仍需逐项验收。

普通发送、queue add和steer共同使用事务中的不可变提交版本：原host/thread/draft、clientUserMessageId、动作与steer的expectedTurnId。每次显式重试先轮换attemptId，创建/发送钩子在写前核实token和阶段；旧页面的失败或状态核对不能降低新attempt的状态。prepared/ready/failed不执行核对，也保留取消/重试；已发而未知的请求只读核对，不能根据暂未找到而重发。queue先按精确client ID遍历实际队列，被消费后再查完整历史；steer还须命中原turn。正向回执只清理原提交revision，保留较新稿。队列的结构上下文能力仍需依据原消费者继续补齐。

项目新建入口显式携带临时workspace分组身份，不根据project.id与路径是否相等猜测；真实项目ID可等于路径。S04在实际页面以两个相同cwd项目且第二个真实ID等于cwd验证首发归属。

消息编辑的未知请求保留原 clientId 和实际提交版本；暂未在历史找到不证明请求未执行，不转换为可重试失败。核对已发送的旧 A 只清理对应 revision，较新 B 保留。导航由消息编辑 controller 提供冻结租约，App 在第一次 await 前同步设置原生 inert，排空消息编辑、composer 及文件恢复事务；失败仍挂载并释放租约，成功等新路由实际提交后再释放。面板接入原 onRecoveryBarrier，不引入第二套草稿。

旧首页 new-conversation 槽位只在原 IDB 事务内认领一次，保留精确原记录和旧别名；输入发生在认领等待期间也不能被旧稿覆盖。实际会话目标组件直接读写 CLI thread/goal，富文本往返仍以原 objective 为准，暂停创建不启动 turn。队列手动启动也先持久保存原 CID，未知回执不自动重放。目标预算、未知结果和其他剩余体验仍按功能账推进。

文件保存将操作 ID、原内容及较新编辑保存在浏览器恢复记录，宿主先持久化同路径围栏再调用 daemon，刷新只核对原操作。已接入的原规范路径、原RPC晚到终态与恢复事务继续保留；F的后续v4来源将原查询归属与当前canonical target分别核对，未知或路径冲突不能直接再次保存，终端持续关闭失败须显式保留恢复并脱离本页。该候选正独立审阅，尚非本组集成证据。已有字节比较不承诺对外部 writer 的原子 CAS，普通读到旧内容或missing不能解除未知写入。

共享attempt/check、queue/steer身份、project fallback及旧请求成功只清理原revision已经接入；局部证据不关闭全功能。完整ref父级审批状态、特殊模式和较新编辑的显式继续出口按实际消费者接线，避免将旧快照或读取结果作为新的写授权。

## 当前交付顺序与验收

共享会话组先证明主页面使用同一服务且不回归输入、消息编辑、首发空历史、队列和断线。Mini与侧聊随后使用各自不可变host/thread/draft及实际controller，复用同一SendRecoveryStore、submitDraft和原revision清理。它们不能调用主route闭包冒充自己的提交，也不能因隐藏面板而卸载有未保存数据的输入。Mini审批消费完整pending refs和父级结果状态；复杂表单、URL和高风险请求打开完整对话，简单审批才就地处理。内置pet资源保留原notice和MIT排除，自定义资源沿现有宿主来源。

临时侧聊由自有native/side-chat服务持久冻结原操作和fork/inject/unsubscribe回执，浏览器只消费安全投影。实际CLI0.164与0.163拒绝ephemeral+deferGoalContinuation组合；采用已验证的ephemeral fork、明确host-config或已知thread override来源的隔离developer指令，以及developer/user双条边界注入。null effort不作为model_reasoning_effort写入。父运行时私有override无法从普通config/read推断，不能声称已恢复不可见值；也不能因此永久隐藏原Web入口。边界失败保留child，未知不重发；关闭先协调原child输入和共享发送，再按原连接回执清理。新连接read可读或notSubscribed不证明原订阅恢复/停止，不能据此丢弃草稿。首轮模型是否实际消费指令、活动goal及SSH边界仍须分别记录证据，真实额外推理须Leader裁定。

C/core-v11冻结6d15的开放问题按真实归属修订：批注显示/编辑必须对应草稿完整引用版本，旧批注须有实际认领入口；Preferences保留首次原始exists/value并接条件写；SSH配置读取也需在原提交区间复制；Hook等未知写须由宿主原请求身份围栏且仅可信终态解除；settings history.state保留来源身份与返回路由、刷新按权威源恢复；旧A确认后较新B需显式无损rebase，并在宿主revert前再次核对原CID及内容签名；共享编辑器消费根字号。读取配置或历史本身不能消除一个仍可能迟到的写请求。终端位置、代码主题、diff标记及其余已存偏好的实际消费继续逐项完成。

浏览器引用的显式删除与prepare共同使用原IDB事务：删除先提交则阻止旧引用进入新意图；prepare先提交则原意图不可变，后来删除不等于撤销已授权请求。显式原发送重试显示并使用冻结内容。确认消费只清理同owner/revision对应版本，较新引用及其他草稿保留。两种顺序都须行为验证。

各功能关闭须有自有入口、状态/服务/资产归属、真实消费者使用证据、针对失败和并发的检查，以及必要npm run typecheck/npm test。CLI证据、合成peer实际App和组件测试分别记录。旧vendor oracle仅作过渡研究，最终测试不得读取快照；不能以静态页面、默认隐藏、空实现或改变既有断言来关闭功能。共享会话组首次整页发现后台loading卸载编辑器的实际回归；修订保留挂载后，原断言的实际App19组/errors=[]、21项定向及typecheck通过。完整442项441通过、唯一旧Language textbox驱动失败由设置组修订，零跳过；这不是全量迁移或最终无vendor验收。

最终逐条退休app-resources、旧configuration/bootstrap、私有工厂和oracle、静态路由、验证脚本和文档中的真实快照消费者，再删除整个vendor/codex-app。第三方库通过包管理使用；部署保留自有stdio适配器及必要notice。无快照干净检出执行npm ci、构建、typecheck、完整测试、实际启动及功能验收；检查bundle metafile、部署文件和运行网络，证明没有快照代码、动态加载或回退。Codex CLI0.164.0、既有daemon0.163.0、隔离桌面CLI0.163.0-alpha.10.2和历史UI参考26.1013.40934分开记录。

设计与实际来源按稳定提交独立审阅。C是原持久审阅会话按technical_design_reviewer职责执行的只读协议委派，不声称原生命名角色加载。最终F00–F23及无vendor干净来源尚未关闭；本地提交和PR材料由Leader收口，不推送、发布远端PR、合入main或正式部署。正式8765、App、共享daemon、个人会话/配置/默认模型保持既有状态。
