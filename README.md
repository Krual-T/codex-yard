# Codex Yard

[简体中文](README.zh-CN.md)

A self-hosted browser workspace for Codex. Continue local and SSH-hosted conversations, inspect files, use terminals, and work with Chrome from one interface.

This is an experimental, independent project. It currently uses the compiled interface from a locally installed **Codex App 26.1013.40934**, with a TypeScript host and React extensions. The app interface and its assets are supplied by your own installation and are excluded from this repository. See [third-party components](THIRD_PARTY.md).

## Current capabilities

- Continue conversations through the existing Codex daemon, including registered SSH hosts.
- Use project navigation, workspace tabs, conversation history, queued messages, image attachments, and temporary side chats.
- Browse files and use terminals through Codex's existing host interfaces.
- Pair an existing Chrome browser, navigate pages, and attach selected elements to a conversation.
- Display interactive HTML visualizations and the app's Mini interface.

The next product direction is a task dashboard: clarify and assign work, see which Agent is doing what, and distribute queued tasks to available workers. That scheduler and dashboard are planned features. The current source provides the conversation workspace.

## Requirements

- Linux and Node.js **24.5 or newer**. Other server platforms have not been validated.
- Your own Codex App **26.1013.40934** installation or retained matching local archive. Other renderer versions require an adapter update.
- A running Codex daemon, using the same account and `CODEX_HOME` as your existing sessions.
- The installed Codex App Tools MCP adapter. Its default Linux location is `/usr/lib/chatgpt/resources/plugins/openai-bundled/plugins/codex-app-tools/server.mjs`.

The repository can be type-checked and tested without Codex App. Running the full UI requires the local resources listed above.

## Run from source

From the repository root:

```bash
npm ci
# When app.asar is outside the default Linux installation path:
npm run copy:renderer -- --archive /path/to/app.asar
npm start
```

If the matching installation is at `/usr/lib/chatgpt/resources/app.asar`, omit the `copy:renderer` command. `npm start` builds the host and copies the renderer on first use. A previously copied renderer stays pinned when the desktop app updates.

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). To customize the server, copy `.env.example` to `.env`. Set `AGENTS_APP_TOOLS_ADAPTER` if the installed adapter is elsewhere. Use a short private `AGENTS_DATA_DIR` when necessary: the complete Unix socket path must fit within 107 bytes.

For remote access, set `AGENTS_PUBLIC_ORIGIN` to the exact HTTPS origin and use a private tunnel or an authenticated reverse proxy. The server listens on loopback. It exposes file access and command execution with the connected account's permissions; it does not provide a multi-user login system. See [deployment boundaries](SECURITY.md).

The original interface contacts external configuration and event services. Normal Codex requests also use your configured model provider. A private network does not make model execution offline. Set standard proxy variables only if your network requires them.

## Development

```bash
npm ci
npm run typecheck
npm test
```

`npm test` builds only this project's host bundles and uses disposable daemon/renderer fixtures. Two tests that execute the installed official MCP adapter are excluded from this default run. With Codex App installed, run them explicitly:

```bash
npm run test:app-tools
```

Full UI validation scripts in `scripts/verify-*.ts` use a configured local installation and may create real test conversations or execute commands. Inspect a script's configuration before running it against your own account. GitHub CI runs the portable tests, not these live checks.

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

Project source is supplied under the [MIT license](LICENSE). Local Codex App resources and third-party dependencies retain their own terms. This project is not affiliated with or endorsed by OpenAI.
