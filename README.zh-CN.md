<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[English](README.md)

通过浏览器继续使用本机和 SSH 主机上的 Codex 会话，在同一工作台查看文件、使用终端、操作 Chrome 和查看交互可视化。

部署机准备好 Node.js 和 Codex CLI，完成登录后即可启动。固定版本的网页界面与 Node 工具适配器已纳入 Git，位于 `vendor/codex-app/26.1013.40934/`；普通 clone 即可取得，构建和启动无需安装桌面 App 或另行下载 App 资源包。

这是一个实验阶段的独立项目。当前界面对标 **Codex App 26.1013.40934**，自有宿主和扩展采用 TypeScript + React。仓库内的原版界面是编译后的 JS、CSS、字体和其他资源，不包含 App 原始 TypeScript / TSX 源码。[第三方组件说明](THIRD_PARTY.md)

自有 React + TypeScript 模块已接入现有页面，负责共享会话行与时间、用户消息及附件、代码块、主输入区视图/controller/草稿边界和设置导航。完整前端迁移仍在推进；[迁移边界与文件归属](docs/react-typescript-migration.md)说明实际接管范围、保留的上游依赖及验证入口。

## 当前功能与后续方向

当前支持共享 daemon 会话、本机与已登记 SSH 项目、工作区标签、历史恢复、待发消息、图片粘贴、临时侧聊、文件、终端、Chrome 配对和元素引用，以及聊天中的交互 HTML 可视化。

后续方向是多任务工作台：协助理清和分配需求，集中查看各 Agent 的工作与进度，通过生产者—消费者队列分发任务。任务 dashboard 和调度仍属于待开发功能。

## 版本与运行条件

| 组件 | 版本 | 用途与验证范围 |
| --- | --- | --- |
| Codex | `0.164.0` | 已验证无需桌面 App 的部署：自动启动后端、网页加载与真实模型回复 |
| Codex | `0.163.0` | 已验证本机和 SSH 对话、文件、终端与浏览器接入 |
| Codex App 界面 | `26.1013.40934` | 对标复刻基准，也是 Git 跟踪的固定资源版本 |
| Node.js | `>=24.5` | 使用 `24.16.0` 验证；当前已验证的服务端平台为 Linux x64 |

上表记录已验证的版本和对应范围，其他 Codex 版本暂未验证。

## 运行

先准备 Node.js；尚未安装对应 CLI 或登录时执行：

```bash
npm install -g @openai/codex@0.164.0
codex login
```

然后：

```bash
git clone https://github.com/Krual-T/codex-yard.git
cd codex-yard
npm ci
npm start
```

`npm start` 构建自有宿主、读取仓库内资源后，调用 Codex CLI 启动或复用 daemon；退出网页服务会保留共享 daemon。资源快照在检出目录中约占 **531 MiB**，以普通 Git 文件保存，无需 Git LFS 或单独下载 App 资源。

界面与工具适配器随 Git 提交固定，桌面 App 更新不会替换它们；Codex 后端的兼容性与界面快照分开验证。安装 npm 依赖与调用模型仍需要相应网络连接。

打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)。将 `.env.example` 复制为 `.env` 后可设置端口、数据目录、工作目录和连接地址。`AGENTS_CODEX_BIN` 指定 CLI 可执行文件；`AGENTS_CODEX_SOCKET` 直接连接已有后端并跳过自动启动；`AGENTS_APP_TOOLS_ADAPTER` 可覆盖仓库内的工具适配器路径。Unix socket 的完整路径上限为 107 字节，隔离工作树宜设置较短的私有数据目录。

跨设备访问时，用私有隧道或带身份认证的 HTTPS 反向代理，并将 `AGENTS_PUBLIC_ORIGIN` 设为完整且精确的 HTTPS 来源。服务只监听回环地址；它可以访问文件和执行命令，没有多用户登录系统。[部署边界](SECURITY.md)

原版界面会访问外部配置和事件服务，模型请求仍使用 Codex 中配置的提供方。网络需要代理时，可设置标准 `HTTPS_PROXY` 与 `NO_PROXY`。

## 开发验证

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

会话历史由 Codex 保存；网页草稿保存在浏览器；运行状态与自有宿主的构建产物位于 Git 忽略的 `.local/`。固定 App 资源位于 Git 跟踪的 `vendor/codex-app/`。仓库不附带个人账号数据或功能配置快照。

当前仍受指定界面版本约束，Git/工作树操作与通用自动化尚未完整接通；两台实体 iPhone、Windows Chrome 配对和 2 秒启动目标仍需继续验证或实现。

自有项目源码采用 [MIT](LICENSE)。`vendor/codex-app/` 下的第三方编译资源不在此 MIT 授权范围内，保留原有版权、声明与适用条款，详见[资源声明](vendor/codex-app/LICENSE)。本项目与 OpenAI 无隶属或背书关系。
