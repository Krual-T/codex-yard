<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[简体中文](README.zh-CN.md)

A self-hosted browser workspace for Codex. Continue local and SSH-hosted conversations, inspect files, use terminals, and work with Chrome from one interface.

Install Node.js and Codex CLI, sign in, and start the workspace. The fixed web interface and Node tool adapter are checked into Git under `vendor/codex-app/26.1013.40934/`. A normal clone contains the runtime resources, with no desktop App installation or App package download during build or startup.

This is an experimental, independent project with a TypeScript host and React extensions. Its current interface is based on **Codex App 26.1013.40934**. The vendored interface is compiled upstream JavaScript, CSS, fonts and assets; the App's original TypeScript/TSX source is not included. See [third-party components](THIRD_PARTY.md).

Authored React + TypeScript modules handle shared rows and timestamps, message
disclosure, code blocks and the home input layout inside the existing page. The
full frontend migration is ongoing; see the [migration boundaries](docs/react-typescript-migration.md).

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
| Codex | `0.164.0` | Verified deployment without the desktop App: automatic backend startup, web interface, and a real model reply |
| Codex | `0.163.0` | Verified local and SSH conversations, files, terminals, and browser integration |
| Codex App interface | `26.1013.40934` | Fixed UI reference and resource snapshot tracked in Git |
| Node.js | `>=24.5` | Tested with `24.16.0`; server platform currently validated on Linux x64 |

The table records tested versions and their validation scope. Other Codex versions have not yet been validated.

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

`npm start` builds this project's host, reads the checked-in resources, then asks Codex CLI to start or reuse its daemon. Closing the web server leaves that shared daemon running. The resource snapshot occupies about **531 MiB** in the checkout and uses ordinary Git files, so Git LFS and a separate App resource download are unnecessary.

The interface and tool adapter change only when their Git snapshot is updated; local Codex App updates do not replace them. Codex backend compatibility is validated separately from the UI snapshot. Package installation and model requests still need their normal network access.

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). To customize the server, copy `.env.example` to `.env`. `AGENTS_CODEX_BIN` selects a CLI executable; `AGENTS_CODEX_SOCKET` connects directly to an existing backend and skips automatic daemon startup. `AGENTS_APP_TOOLS_ADAPTER` overrides the vendored adapter if needed. Use a short private `AGENTS_DATA_DIR` when necessary: the complete Unix socket path must fit within 107 bytes.

For remote access, set `AGENTS_PUBLIC_ORIGIN` to the exact HTTPS origin and use a private tunnel or an authenticated reverse proxy. The server listens on loopback. It exposes file access and command execution with the connected account's permissions; it does not provide a multi-user login system. See [deployment boundaries](SECURITY.md).

The original interface contacts external configuration and event services. Normal Codex requests also use your configured model provider. A private network does not make model execution offline. Set standard proxy variables only if your network requires them.

## Development

```bash
npm ci
npm run typecheck
npm test
```

`npm test` builds this project's host bundles and uses disposable backends. It checks that the vendored interface is served and runs the official MCP adapter integration tests using the checked-in adapter. To run just the adapter tests:

```bash
npm run test:app-tools
```

Full UI validation scripts in `scripts/verify-*.ts` use a configured CLI backend and may create real test conversations or execute commands. Inspect a script's configuration before running it against your own account. GitHub CI runs the portable tests, not these live checks.

| Directory | Purpose |
| --- | --- |
| `src/native/` | Browser bridge, HTTP/WebSocket host, files, terminals, preferences, visualizations |
| `src/browser-reuse/` | Chrome pairing, panel integration, element references |
| `src/renderer/` | Authored React UI using the pinned renderer's React, state and services |
| `lib/` | Codex transport, host tools, permissions, protocol types |
| `scripts/` | Build and optional live validation |
| `test/` | Portable tests, including the vendored official adapter |
| `vendor/codex-app/` | Fixed upstream compiled interface, assets, notices, and Node tool adapter |

Runtime state, host build output, and generated Chrome companion packages live in ignored `.local/`. Conversations remain in Codex; browser drafts remain in the browser's storage. No account data or configuration snapshot is supplied with this repository.

## Known limits

- Compatibility depends on private desktop interfaces and the pinned renderer version.
- Full desktop parity, Git/worktree operations, and general automation are incomplete.
- Existing sessions owned by a separate stdio backend may require coordination before another client can continue them.
- Physical iPhone behavior and Windows Chrome pairing still need dedicated validation.
- The sub-two-second startup target has not been reached.

## License

Project-authored source is supplied under the [MIT license](LICENSE). Files under `vendor/codex-app/` are third-party compiled resources and are excluded from that MIT grant; their existing copyrights, notices and terms remain applicable. See the [vendor notice](vendor/codex-app/LICENSE). This project is not affiliated with or endorsed by OpenAI.
