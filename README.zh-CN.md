<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[English](README.md)

通过浏览器继续使用本机和 SSH 主机上的 Codex 会话，在同一工作台查看文件、使用终端、操作 Chrome 和查看交互可视化。

网页入口、React 组件、应用状态、TypeScript 宿主和 Node 工具适配器由本仓库源码维护。React、编辑器等通用库通过 npm 安装，Codex CLI/daemon 通过协议提供会话与工具后端。运行环境需要 Node.js 和 Codex CLI。

这是一个实验阶段的独立项目，以 **Codex App 26.1013.40934** 为历史交互参考。保留的第三方宠物图片附有[来源与声明](public/pets/NOTICE.md)，npm 依赖保留各自随包分发的许可证。[第三方组件说明](THIRD_PARTY.md)

页面由自有 React + TypeScript 源码维护，历史 App 快照已从仓库删除；安装、构建、启动和分发使用本仓库源码及 npm 依赖。[实现设计](docs/standalone-renderer-design.md)记录状态归属、协议契约和能力边界。

Mini/Pets 已禁用，已有草稿和状态保留，旧启用偏好不能重新唤起。主界面的临时侧聊仍保留。

## 当前功能与后续方向

当前支持共享 daemon 会话、本机与已登记 SSH 项目、工作区标签、历史恢复、待发消息、图片粘贴、临时侧聊、文件、终端、Chrome 配对和元素引用，以及聊天中的交互 HTML 可视化。

后续方向是多任务工作台：协助理清和分配需求，集中查看各 Agent 的工作与进度，通过生产者—消费者队列分发任务。任务 dashboard 和调度仍属于待开发功能。

## 版本与运行条件

对话工具由常驻宿主提供，包含创建、分叉、发送、等待、历史、标题、归档、置顶和已读等十二项；复用原版参数校验、历史投影和等待逻辑，关闭 Yard 页面后仍可执行。已加载旧对话的迁移、桌面与云端能力边界见[工具说明](docs/native-app-tools.md)。

| 组件 | 版本 | 用途与验证范围 |
| --- | --- | --- |
| Codex CLI/daemon | `0.164.0` | 隔离协议与界面检查，包含 CLI 管理的一次性 daemon |
| Codex CLI | `0.163.0-alpha.10.2` | 经 Unix listener 验证协议、界面及本地/SSH 文件操作 |
| Codex App 界面 | `26.1013.40934` | 历史行为参考，与后端版本分别记录 |
| Node.js | `>=24.5` | 使用 `24.16.0` 验证；当前已验证的服务端平台为 Linux x64 |

兼容性检查使用可丢弃配置，需要模型响应时使用本地脚本 provider；这不代表已验证其他后端版本或外部模型服务。

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

`npm start` 执行项目构建，提供网页入口与本地资源，并调用 Codex CLI 启动或复用 daemon；退出网页服务会保留共享 daemon。前端根据本仓库源码和锁定的 npm 依赖构建。安装依赖与调用模型仍使用相应网络连接。

打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)。将 `.env.example` 复制为 `.env` 后可设置端口、数据目录、工作目录和连接地址。`AGENTS_CODEX_BIN` 指定 CLI 可执行文件；`AGENTS_CODEX_SOCKET` 直接连接已有后端并跳过自动启动；`AGENTS_APP_TOOLS_ADAPTER` 可指定兼容的自定义 Node 适配器，默认使用本项目源码。Unix socket 的完整路径上限为 107 字节，必要时设置较短的私有 `AGENTS_DATA_DIR`。

要让连接同一 daemon 的桌面端共用十二项对话工具，在已部署的检出目录执行 `npm run tools:configure` 查看配置计划，确认后追加 `-- --apply`。配置备份、旧会话迁移和三端接入方式见[注册说明](docs/native-app-tools.md#explicit-registration-for-app-and-yard)。

跨设备访问时，用私有隧道或带身份认证的 HTTPS 反向代理，并将 `AGENTS_PUBLIC_ORIGIN` 设为完整且精确的 HTTPS 来源。服务只监听回环地址；它可以访问文件和执行命令，没有多用户登录系统。[部署边界](SECURITY.md)

模型请求使用 Codex 中配置的提供方；远程目录读取、Chrome 等功能使用其对应服务。网络需要代理时，可设置标准 `HTTPS_PROXY` 与 `NO_PROXY`。

## 开发验证

```bash
npm ci
npm run typecheck
npm test
```

`npm test` 先构建项目，再用可丢弃数据和后端夹具检查自有模块。只运行 Node 工具适配器测试时执行：

```bash
npm run test:app-tools
```

界面检查覆盖实际网页入口、交互和宿主请求，合成后端或脚本 provider 可用于不依赖个人账号的可重复验证。部分可选 `scripts/verify-*.ts` 模式连接配置的 CLI，可能创建对话或执行命令，运行前应检查配置并使用可丢弃测试数据。验证结果分别记录源码提交、实际 CLI/daemon 版本及夹具范围。CI 执行普通测试。

| 目录 | 内容 |
| --- | --- |
| `src/renderer/` | React + TypeScript 组件、应用状态、草稿、设置和产品页面 |
| `src/native/` | 网页桥接、HTTP/WebSocket 宿主、文件、终端、偏好与可视化 |
| `src/browser-reuse/` | Chrome 配对、面板和元素引用 |
| `lib/` | Codex 传输、工具、权限和协议类型 |
| `public/` | HTML、项目图标和附带声明的宠物图片 |
| `scripts/`、`test/` | 构建、验证入口及模块/宿主/浏览器测试 |

持久会话历史由 Codex 保存；草稿和恢复数据保存在浏览器存储及私有宿主数据目录。运行状态、构建产物和生成的 Chrome companion 默认位于 Git 忽略的 `.local/`。账号数据与机器配置不进入 Git。

后端兼容性随 Codex 协议版本变化。临时侧聊使用 ephemeral 会话，其历史和重连能力与持久对话不同；恢复失败时保留状态，不自动重发。Git/工作树操作与通用自动化尚未完整接通；实体 iPhone、Windows Chrome 配对和 2 秒启动目标仍需继续验证或实现。

自有项目源码采用 [MIT](LICENSE)。第三方包和保留的[宠物图片](public/pets/NOTICE.md)保留原有版权与条款，本项目的 MIT 授权不重新许可这些内容；详见[第三方组件说明](THIRD_PARTY.md)。本项目与 OpenAI 无隶属或背书关系。
