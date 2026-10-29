<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[简体中文](README.zh-CN.md)

A self-hosted browser workspace for Codex. Continue local and SSH-hosted conversations, inspect files, use terminals, and work with Chrome from one interface.

The browser entry, React components, state, TypeScript host and Node tool adapter are maintained in this repository. React, editors and other libraries are installed through npm; Codex CLI/daemon provides the external conversation and tool backend. Running the workspace requires Node.js and Codex CLI.

This is an experimental, independent project. **Codex App 26.1013.40934** is its historical UI behavior reference. Retained third-party pet images have their own [notice](public/pets/NOTICE.md); package dependencies keep their distributed licenses. See [third-party components](THIRD_PARTY.md).

This branch is completing the React + TypeScript migration. The default renderer is project-authored and the reference snapshot has been removed. Final feature integration and validation from a clean checkout are still in progress. See the [current implementation design](docs/standalone-renderer-design.md).

Mini/Pets is disabled. Existing drafts and saved state are retained; its old enabled preference cannot reopen it. Temporary side chats remain available in the main workspace.

## Current capabilities

- Continue conversations through the existing Codex daemon, including registered SSH hosts.
- Use project navigation, workspace tabs, conversation history, queued messages, image attachments, and temporary side chats.
- Browse files and use terminals through Codex's existing host interfaces.
- Pair an existing Chrome browser, navigate pages, and attach selected elements to a conversation.
- Display interactive HTML visualizations.
- Use twelve native conversation tools through a permanent host, with the original
  argument schemas, history projection and passive wait behavior. See
  [tool behavior and migration limits](docs/native-app-tools.md).

The next product direction is a task dashboard: clarify and assign work, see which Agent is doing what, and distribute queued tasks to available workers. That scheduler and dashboard are planned features. The current source provides the conversation workspace.

## Versions and requirements

| Component | Version | Role |
| --- | --- | --- |
| Codex CLI/daemon | `0.164.0` | Isolated protocol and UI checks, including a disposable CLI-managed daemon |
| Codex CLI | `0.163.0-alpha.10.2` | Isolated protocol, UI and local/SSH file checks through a Unix listener |
| Codex App interface | `26.1013.40934` | Historical behavior reference, recorded separately from backend versions |
| Node.js | `>=24.5` | Tested with `24.16.0`; server platform currently validated on Linux x64 |

These are tested backend versions. Current migration checks use disposable configuration and, where responses are needed, a local scripted provider. Final validation of the complete migrated application remains in progress; other backend versions have not been validated.

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

`npm start` runs the project build, serves the browser entry and local assets, and asks Codex CLI to start or reuse its daemon. Closing the web server leaves that shared daemon running. Frontend changes are built from this repository's source and locked npm dependencies. Package installation and model requests use their normal network connections.

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). To customize the server, copy `.env.example` to `.env`. `AGENTS_CODEX_BIN` selects a CLI executable; `AGENTS_CODEX_SOCKET` connects directly to an existing backend and skips automatic daemon startup. `AGENTS_APP_TOOLS_ADAPTER` selects an optional compatible custom Node adapter; the default comes from this project's source. Use a short private `AGENTS_DATA_DIR` when necessary: the complete Unix socket path must fit within 107 bytes.

To share the twelve conversation tools with desktop clients using that daemon,
preview `npm run tools:configure` from the deployed checkout. Add `-- --apply`
after reviewing the plan. See [registration and migration](docs/native-app-tools.md#explicit-registration-for-app-and-yard).

For remote access, set `AGENTS_PUBLIC_ORIGIN` to the exact HTTPS origin and use a private tunnel or an authenticated reverse proxy. The server listens on loopback. It exposes file access and command execution with the connected account's permissions; it does not provide a multi-user login system. See [deployment boundaries](SECURITY.md).

Codex requests use your configured model provider. Features that read remote catalogs or work with Chrome also depend on their corresponding services. Set standard proxy variables only if your network requires them.

## Development

```bash
npm ci
npm run typecheck
npm test
```

`npm test` runs the build and checks project-authored modules with disposable data and backend fixtures. To run just the Node tool adapter tests:

```bash
npm run test:app-tools
```

UI checks cover the actual browser entry, interactions and host requests. A scripted backend or provider makes these checks reproducible without a personal account. Some optional `scripts/verify-*.ts` modes use a configured CLI backend and may create conversations or execute commands; inspect their configuration and use disposable test data. Record the source commit, actual CLI/daemon version and fixture scope with each result. GitHub CI runs the portable tests.

| Directory | Purpose |
| --- | --- |
| `src/native/` | Browser bridge, HTTP/WebSocket host, files, terminals, preferences, visualizations |
| `src/browser-reuse/` | Chrome pairing, panel integration, element references |
| `src/renderer/` | React + TypeScript components, application state, drafts, settings and product pages |
| `lib/` | Codex transport, host tools, permissions, protocol types |
| `scripts/` | Build and optional live validation |
| `test/` | Module, host and browser tests with disposable fixtures |
| `public/` | Project HTML, branding and retained pet images with their notice |

Runtime state, build output and generated Chrome companion packages live in ignored `.local/` unless configured otherwise. Codex stores persisted conversation history; drafts and recovery data use browser storage and the private host data directory. Account data and machine-specific configuration stay outside Git.

## Known limits

- Backend compatibility depends on the Codex protocol version.
- Temporary side chats use ephemeral backend sessions. Their history and reconnect capabilities differ from persisted conversations; a failed resume must not trigger an automatic resend.
- Full desktop parity, Git/worktree operations, and general automation are incomplete.
- Existing sessions owned by a separate stdio backend may require coordination before another client can continue them.
- Physical iPhone behavior and Windows Chrome pairing still need dedicated validation.
- The sub-two-second startup target has not been reached.

## License

Project-authored source is supplied under the [MIT license](LICENSE). Third-party packages and the retained [pet images](public/pets/NOTICE.md) keep their existing copyrights and terms; this project's MIT grant does not relicense them. See [third-party components](THIRD_PARTY.md). This project is not affiliated with or endorsed by OpenAI.
