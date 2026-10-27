<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[English](README.md)

通过浏览器继续使用本机和 SSH 主机上的 Codex 会话，在同一工作台查看文件、使用终端、操作 Chrome 和查看交互可视化。

这是一个实验阶段的独立项目。当前复用用户本机 **Codex App 26.1013.40934** 的编译界面，自有宿主和扩展采用 TypeScript + React。运行所需的原版界面、字体、图标等资源由用户自己的安装包提供，仓库只包含自有适配代码。[第三方组件说明](THIRD_PARTY.md)

## 当前功能与后续方向

当前支持共享 daemon 会话、本机与已登记 SSH 项目、工作区标签、历史恢复、待发消息、图片粘贴、临时侧聊、文件、终端、Chrome 配对和元素引用，以及聊天中的交互 HTML 可视化。

后续方向是多任务工作台：协助理清和分配需求，集中查看各 Agent 的工作与进度，通过生产者—消费者队列分发任务。任务 dashboard 和调度仍属于待开发功能。

## 运行

当前服务端验证环境为 Linux，需要 Node.js 24.5+、指定版本的 Codex App 资源、已运行的 Codex daemon，以及本机安装的官方 App Tools MCP 适配器。连接必须使用与既有会话相同的账号和 `CODEX_HOME`。

在仓库根目录执行：

```bash
npm ci
# 安装包位于非默认位置时，先显式导入：
npm run copy:renderer -- --archive /path/to/app.asar
npm start
```

默认安装包位置是 `/usr/lib/chatgpt/resources/app.asar`，符合时可省略导入命令。已有固定资源副本会继续复用。其他版本需更新适配后使用。

打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)。将 `.env.example` 复制为 `.env` 后可设置端口、数据目录、工作目录和连接地址。`AGENTS_APP_TOOLS_ADAPTER` 可指定官方适配器路径。Unix socket 的完整路径上限为 107 字节，隔离工作树宜设置较短的私有数据目录。

跨设备访问时，用私有隧道或带身份认证的 HTTPS 反向代理，并将 `AGENTS_PUBLIC_ORIGIN` 设为完整且精确的 HTTPS 来源。服务只监听回环地址；它可以访问文件和执行命令，没有多用户登录系统。[部署边界](SECURITY.md)

原版界面会访问外部配置和事件服务，模型请求仍使用 Codex 中配置的提供方。网络需要代理时，可设置标准 `HTTPS_PROXY` 与 `NO_PROXY`。

## 开发验证

```bash
npm ci
npm run typecheck
npm test
```

普通测试会构建自有宿主，并使用临时 daemon 与界面 fixture，无需 Codex App。两项执行真实官方 MCP 适配器的测试单独运行：

```bash
npm run test:app-tools
```

`scripts/verify-*.ts` 中的完整界面验收脚本需要本机安装包，部分会创建真实测试对话或执行命令，运行前应检查其配置。CI 只执行普通测试。

会话历史由 Codex 保存；网页草稿保存在浏览器；运行状态、导入资源和构建产物位于 Git 忽略的 `.local/`。仓库不附带个人账号数据或功能配置快照。

当前仍受指定界面版本约束，Git/工作树操作与通用自动化尚未完整接通；两台实体 iPhone、Windows Chrome 配对和 2 秒启动目标仍需继续验证或实现。

项目源码采用 [MIT](LICENSE)。用户本机提供的 Codex App 资源及第三方依赖沿用各自条款。本项目与 OpenAI 无隶属或背书关系。
