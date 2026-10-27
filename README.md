<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[简体中文](README.zh-CN.md)

A self-hosted browser workspace for Codex. Continue local and SSH-hosted conversations, inspect files, use terminals, and work with Chrome from one interface.

Install Node.js and Codex CLI, sign in, and start the workspace. A desktop Codex App installation is not required. On first start, the setup script downloads a fixed official package and extracts the web interface and Node tool adapter; later starts reuse that local cache.

This is an experimental, independent project with a TypeScript host and React extensions. Its current interface is based on **Codex App 26.1013.40934**. OpenAI's compiled resources are downloaded from OpenAI and excluded from this repository. See [third-party components](THIRD_PARTY.md).

## Current capabilities

- Continue conversations through the existing Codex daemon, including registered SSH hosts.
- Use project navigation, workspace tabs, conversation history, queued messages, image attachments, and temporary side chats.
- Browse files and use terminals through Codex's existing host interfaces.
- Pair an existing Chrome browser, navigate pages, and attach selected elements to a conversation.
- Display interactive HTML visualizations and the app's Mini interface.

The next product direction is a task dashboard: clarify and assign work, see which Agent is doing what, and distribute queued tasks to available workers. That scheduler and dashboard are planned features. The current source provides the conversation workspace.

## Versions and requirements

| Component | Version | Role |
| --- | --- | --- |
| Codex CLI / fresh daemon | `0.164.0` | Verified without a desktop installation: automatic backend startup, web interface, and a real model reply |
| Existing Codex daemon | `0.163.0` | Previously validated with local and SSH conversations, files, terminals, and browser integration |
| Codex App interface | `26.1013.40934` | Fixed UI reference and downloaded resource version |
| Node.js | `>=24.5` | Tested with `24.16.0`; server platform currently validated on Linux x64 |

The CLI on your PATH and an already-running daemon can have different versions. `codex app-server daemon version` reports both; the workspace's `/api/status` reports `appServerVersion` and `rendererVersion`. Other combinations require validation before being listed as supported.

## Run from source

With Node.js installed, install and sign in to the validated CLI version if needed:

```bash
npm install -g @openai/codex@0.164.0
codex login
```

Then:

```bash
git clone https://github.com/Krual-T/codex-yard.git
cd codex-yard
npm ci
npm start
```

The first run downloads about **494 MiB** from OpenAI's versioned distribution URL and prepares the local web resources. It does not install or launch the desktop app. `npm start` builds this project's host, then asks Codex CLI to start or reuse its daemon. Closing the web server leaves that shared daemon running.

The cached interface and tool adapter stay pinned when Codex App updates. CLI and daemon compatibility are tracked separately. A fresh setup needs access to the official download; an existing cache is reused without downloading again. For an offline setup with that same official Arch package already available, run `npm run copy:renderer -- --package /path/to/chatgpt-bin-26.1013.40934-1-x86_64.pkg.tar.zst` first.

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). To customize the server, copy `.env.example` to `.env`. `AGENTS_CODEX_BIN` selects a CLI executable; `AGENTS_CODEX_SOCKET` connects directly to an existing backend and skips automatic daemon startup. `AGENTS_APP_TOOLS_ADAPTER` overrides the cached adapter if needed. Use a short private `AGENTS_DATA_DIR` when necessary: the complete Unix socket path must fit within 107 bytes.

For remote access, set `AGENTS_PUBLIC_ORIGIN` to the exact HTTPS origin and use a private tunnel or an authenticated reverse proxy. The server listens on loopback. It exposes file access and command execution with the connected account's permissions; it does not provide a multi-user login system. See [deployment boundaries](SECURITY.md).

The original interface contacts external configuration and event services. Normal Codex requests also use your configured model provider. A private network does not make model execution offline. Set standard proxy variables only if your network requires them.

## Development

```bash
npm ci
npm run typecheck
npm test
```

`npm test` builds only this project's host bundles and uses disposable daemon/renderer fixtures. Two tests that execute the official MCP adapter are excluded from this default run. After preparing the fixed resources, run them explicitly:

```bash
npm run test:app-tools
```

Full UI validation scripts in `scripts/verify-*.ts` use a configured CLI backend and prepared web resources and may create real test conversations or execute commands. Inspect a script's configuration before running it against your own account. GitHub CI runs the portable tests, not these live checks.

| Directory | Purpose |
| --- | --- |
| `src/native/` | Browser bridge, HTTP/WebSocket host, files, terminals, preferences, visualizations |
| `src/browser-reuse/` | Chrome pairing, panel integration, element references |
| `lib/` | Codex transport, host tools, permissions, protocol types |
| `scripts/` | Build, local renderer import, optional live validation |
| `test/` | Portable tests and opt-in installed-adapter checks |

State, imported renderer resources, build output, and generated Chrome companion packages live in ignored `.local/`. Conversations remain in Codex; browser drafts remain in the browser's storage. No account data or configuration snapshot is supplied with this repository.

## Known limits

- Compatibility depends on private desktop interfaces and the pinned renderer version.
- Full desktop parity, Git/worktree operations, and general automation are incomplete.
- Existing sessions owned by a separate stdio backend may require coordination before another client can continue them.
- Physical iPhone behavior and Windows Chrome pairing still need dedicated validation.
- The sub-two-second startup target has not been reached.

## License

Project source is supplied under the [MIT license](LICENSE). Downloaded Codex App resources and third-party dependencies retain their own terms. This project is not affiliated with or endorsed by OpenAI.
