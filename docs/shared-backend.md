# Yard、CLI 和桌面 App 共用后端

一台执行主机保留一个常驻 Codex app-server daemon，三个客户端都连接它。配置、认证、会话和 SQLite 由这个后端使用的 `CODEX_HOME` 管理；Yard 自己的调度、推送订阅和网页偏好仍放在 `AGENTS_DATA_DIR`。

下面的 Unix socket 接入已用 Linux Codex `0.171.0` 验证。Windows 桌面端已用 App `26.1111.2228.0` 验证 WebSocket 接入同一个 WSL daemon。App 的 WebSocket 环境变量来自该安装包的实际实现，属于版本相关的接入方式；升级桌面端后需要复验。

## 选定唯一目录

WSL 使用 Linux 用户自己的目录，例如 `/home/alice/.codex`。`.codex-app` 只是自定义目录名；目录的后缀不决定后端版本或是否依赖 App。

```bash
export CODEX_HOME="$HOME/.codex"
export CODEX_SQLITE_HOME="$CODEX_HOME/sqlite"
codex app-server daemon start
codex app-server daemon version
```

`start` 返回 JSON，记录实际 `socketPath`、`cliVersion` 和 `appServerVersion`。CLI 与 daemon 可以分别升级，部署时按实际返回值确认版本。启动进程的环境会被 daemon 保留；更新代理或 PATH 后，需要在空闲窗口重启 daemon 才能生效。

## CLI 和 Yard

CLI 显式指定后端，连接失败时会直接报错：

```bash
codex --remote "unix://$CODEX_HOME/app-server-control/app-server-control.sock"
codex --remote "unix://$CODEX_HOME/app-server-control/app-server-control.sock" resume --all
codex exec --remote "unix://$CODEX_HOME/app-server-control/app-server-control.sock" "你的任务"
```

支持自动附加的 CLI 也可以发现同一 home 的 daemon。需要固定权威后端时，使用显式 `--remote`，避免自动附加失败后的内嵌后端回退。`--no-daemon` 会主动选择独立运行。

Codex `0.171.0` 的独立 `codex review` 命令会拒绝 `--remote`，共享入口应保留该错误。需要在同一后端审查代码时，可在已连接的 TUI 中使用 `/review`。管理命令与用户显式选择的独立运行模式按各自语义执行。

Yard 的 `.env` 使用同一个目录和 socket：

```dotenv
CODEX_HOME=/home/alice/.codex
CODEX_SQLITE_HOME=/home/alice/.codex/sqlite
AGENTS_CODEX_BIN=/home/alice/.local/bin/codex
AGENTS_CODEX_SOCKET=/home/alice/.codex/app-server-control/app-server-control.sock
```

设置 `AGENTS_CODEX_SOCKET` 后，Yard 直接连接该 socket，daemon 的启动由常驻服务或启动脚本负责。启动脚本应显式设置 Linux Node/CLI 所在的 PATH；Windows 的 `wsl --exec` 会使用另一套启动环境。

## Windows 桌面端连接 WSL

已验证的 Windows App 在“本机使用 WSL”模式下会另启 stdio 后端。要让它连接已有 daemon，可在 WSL 的回环地址提供一个 TCP 到 Unix socket 的字节转发入口，再让 App 通过 WebSocket 连接。

以下 Node 24 TypeScript 示例负责转发协议数据。把它放在自己的服务目录，由独立于桌面 App 的启动入口托管：

```ts
import { createServer, createConnection } from 'node:net';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = process.env.CODEX_HOME || join(homedir(), '.codex');
const socketPath = join(home, 'app-server-control/app-server-control.sock');
createServer(client => {
  const upstream = createConnection(socketPath);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  client.pipe(upstream).pipe(client);
}).listen(18766, '127.0.0.1');
```

这个入口把访问交给执行转发进程的 Linux 用户，只应绑定本机回环地址。远程访问继续使用已有的 SSH 或认证隧道。WSL 镜像网络可通过 Windows `127.0.0.1` 访问；其他网络模式需要先验证 Windows 到 WSL 的 localhost 转发。

在启动 Windows App 的 PowerShell 环境中设置：

```powershell
$env:CODEX_APP_SERVER_WS_URL = 'ws://127.0.0.1:18766/rpc'
[Environment]::SetEnvironmentVariable('CODEX_APP_SERVER_WS_URL', $env:CODEX_APP_SERVER_WS_URL, 'User')
```

确认 App 没有使用 `CODEX_APP_SERVER_FORCE_CLI=1`，然后从当前已登录的 Windows 桌面重新启动 App。用户环境变量需要由启动它的进程重新读取；已有 Explorer/终端可以通过环境变更广播或重新登录刷新。SSH 的 Session 0 无法正常承载桌面窗口，远程重启应使用该用户已登录的交互会话。

Windows `CODEX_HOME` 通常指向 Windows 用户目录。WSL 的 Linux 启动脚本应显式覆盖为 Linux home。若 Windows 变量值本来就是默认目录，也可移除该用户变量，以及 `WSLENV` 中对应的 `CODEX_HOME/p` 项，让两个系统各自计算默认路径。Windows App 的前端偏好与缓存可以继续存放在 Windows 用户目录。

Windows 的 CLI 入口可调用 `wsl.exe --distribution Ubuntu --exec <Linux CLI 入口>`。Linux 入口统一设置 home、启动或复用 daemon，并为会话命令指定 `--remote`。保留调用者的工作目录和命令参数。

## 切换与验收

迁移前核对所有后端的运行任务，安排空闲窗口，并备份配置、认证、SQLite 和会话文件。共享同一个数据库的旧进程也需要退出。数据库中的 rollout 路径可能指向不同 home，移动目录时需一并迁移路径并核对原本可读的文件。插件还需要保留配置中引用的 marketplace；例如 `.tmp/bundled-marketplaces` 可能保存实际插件目录，应按引用迁移。旧目录先归档，验证完成后再按保留策略清理。

分别检查 Yard `/api/status`、CLI 的会话选择器、桌面端日志中的初始化结果。三端应报告同一 daemon 版本，桌面端应连接指定的本机 WebSocket，执行主机只保留一个实际 app-server 会话后端。更新进程和协议转发进程各有自己的进程号。

关闭桌面 App 后，daemon、转发入口和 Yard 应继续工作。WSL 镜像网络下，Windows HTTPS 与 Linux HTTP 使用不同端口，便于重启时独立绑定。

MCP 配置也随权威 home 统一。插件还需要完成实际安装，并具有对应平台的独立运行时；固定到 App 版本目录的 Node REPL、Computer Use 服务或私有管道仍需迁移。相关要求见[独立插件与 Computer Use](standalone-plugins.md)及[对话工具注册](native-app-tools.md#explicit-registration-for-app-and-yard)。

后端生命周期和 CLI 自动附加机制见 [OpenAI daemon 文档](https://github.com/openai/codex/blob/main/codex-rs/app-server-daemon/README.md)；WSL 通信机制见 [Microsoft 网络文档](https://learn.microsoft.com/en-us/windows/wsl/networking)。
