<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[English](README.md)

通过浏览器继续使用本机和 SSH 主机上的 Codex 会话，在同一工作台查看文件、使用终端、操作 Chrome 和查看交互可视化。

部署机准备好 Node.js 和 Codex CLI，完成登录后即可启动，无需安装桌面 Codex App。首次启动会从官方地址自动下载固定版本的资源包，提取网页界面与 Node 工具适配器，后续直接复用本地缓存。

这是一个实验阶段的独立项目。当前界面对标 **Codex App 26.1013.40934**，自有宿主和扩展采用 TypeScript + React。原版编译资源由启动脚本从 OpenAI 下载，不随本仓库发布。[第三方组件说明](THIRD_PARTY.md)

## 当前功能与后续方向

当前支持共享 daemon 会话、本机与已登记 SSH 项目、工作区标签、历史恢复、待发消息、图片粘贴、临时侧聊、文件、终端、Chrome 配对和元素引用，以及聊天中的交互 HTML 可视化。

后续方向是多任务工作台：协助理清和分配需求，集中查看各 Agent 的工作与进度，通过生产者—消费者队列分发任务。任务 dashboard 和调度仍属于待开发功能。

## 版本与运行条件

| 组件 | 版本 | 用途与验证范围 |
| --- | --- | --- |
| Codex CLI / 全新 daemon | `0.164.0` | 已在屏蔽桌面 App 安装的环境验证：自动启动后端、网页加载与真实模型回复 |
| 已有 Codex daemon | `0.163.0` | 此前已验证本机和 SSH 对话、文件、终端与浏览器接入 |
| Codex App 界面 | `26.1013.40934` | 对标复刻基准，也是自动下载的固定资源版本 |
| Node.js | `>=24.5` | 使用 `24.16.0` 验证；当前已验证的服务端平台为 Linux x64 |

机器上安装的 CLI 和正在运行的 daemon 可能版本不同。`codex app-server daemon version` 可同时查看两者；工作台的 `/api/status` 返回执行后端的 `appServerVersion` 与界面资源的 `rendererVersion`。其他组合需要验证后再标记为支持。

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

首次启动从 OpenAI 的固定版本地址下载约 **494 MiB** 的包并准备网页资源，不安装或启动桌面 App。`npm start` 构建自有宿主后，调用 Codex CLI 启动或复用 daemon；退出网页服务会保留共享 daemon。

界面与工具适配器使用固定缓存，桌面 App 更新不会替换它们；CLI 和 daemon 的兼容性另外验证。全新部署需要能够访问官方资源地址，缓存存在后无需重复下载。如果已经有同版本的官方 Arch 包，可先执行 `npm run copy:renderer -- --package /path/to/chatgpt-bin-26.1013.40934-1-x86_64.pkg.tar.zst`，离线准备这些资源。

打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)。将 `.env.example` 复制为 `.env` 后可设置端口、数据目录、工作目录和连接地址。`AGENTS_CODEX_BIN` 指定 CLI 可执行文件；`AGENTS_CODEX_SOCKET` 直接连接已有后端并跳过自动启动；`AGENTS_APP_TOOLS_ADAPTER` 可覆盖默认缓存中的工具适配器路径。Unix socket 的完整路径上限为 107 字节，隔离工作树宜设置较短的私有数据目录。

跨设备访问时，用私有隧道或带身份认证的 HTTPS 反向代理，并将 `AGENTS_PUBLIC_ORIGIN` 设为完整且精确的 HTTPS 来源。服务只监听回环地址；它可以访问文件和执行命令，没有多用户登录系统。[部署边界](SECURITY.md)

原版界面会访问外部配置和事件服务，模型请求仍使用 Codex 中配置的提供方。网络需要代理时，可设置标准 `HTTPS_PROXY` 与 `NO_PROXY`。

## 开发验证

```bash
npm ci
npm run typecheck
npm test
```

普通测试会构建自有宿主，并使用临时 daemon 与界面 fixture，无需 Codex App。准备好固定资源后，可单独运行包含两项真实官方 MCP 集成的测试：

```bash
npm run test:app-tools
```

`scripts/verify-*.ts` 中的完整界面验收脚本需要 CLI 后端与已准备的网页资源，部分会创建真实测试对话或执行命令，运行前应检查其配置。CI 只执行普通测试。

会话历史由 Codex 保存；网页草稿保存在浏览器；运行状态、导入资源和构建产物位于 Git 忽略的 `.local/`。仓库不附带个人账号数据或功能配置快照。

当前仍受指定界面版本约束，Git/工作树操作与通用自动化尚未完整接通；两台实体 iPhone、Windows Chrome 配对和 2 秒启动目标仍需继续验证或实现。

项目源码采用 [MIT](LICENSE)。从官方下载的 Codex App 资源及第三方依赖沿用各自条款。本项目与 OpenAI 无隶属或背书关系。
