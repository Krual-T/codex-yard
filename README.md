<img src="public/brand/icon.svg" alt="Codex Yard" width="72" height="72">

# Codex Yard

[简体中文](README.zh-CN.md)

Maintained in the LifeKernel repository at `projects/codex-yard/` since 2026-10-30. The standalone repository's `main` history through `bf1ac091` was imported with Git subtree. Day-to-day changes use LifeKernel branches and commits.

A self-hosted browser workspace for Codex. Continue local and SSH-hosted conversations, inspect files, use terminals, and browse web pages from one interface.

**Yard is an independent Codex client and capability host.** Building, starting, chatting, managing plugins and using supported Computer Use must work when Codex App is absent or closed. Yard owns the required runtime services and documents each feature's system dependencies. The Codex CLI and configured model provider remain prerequisites.

Install Node.js and Codex CLI, sign in, and start the workspace. The fixed web interface and Node tool adapter are checked into Git under `vendor/codex-app/26.1013.40934/`. A normal clone contains the runtime resources, with no desktop App installation or App package download during build or startup.

This is an experimental, independent project with a TypeScript host and React extensions. Its current interface is based on **Codex App 26.1013.40934**. The vendored interface is compiled upstream JavaScript, CSS, fonts and assets; the App's original TypeScript/TSX source is not included. See [third-party components](THIRD_PARTY.md).

## Current capabilities

- Continue conversations through the existing Codex daemon, including registered SSH hosts.
- Discover and add SSH profiles in Settings → Connections, and pin chats from the sidebar menu.
- Use project navigation, workspace tabs, conversation history, queued messages, and file and image attachments. New local and SSH side chats are saved in their parent conversation’s Summary on CLI 0.169.1 or later; closing their panel preserves their history and running work. See [side chats](docs/sidechat-threads.md).
- Open local and SSH chats at the latest content with two turn summaries. A running turn also reads its recent activity to recover completed progress messages; its Work control can load the remaining activity. Scroll up for older messages. Persisted messages can appear while runtime restoration, model discovery and MCP status are still pending.
- See retry or connection status during an active turn. After two minutes without observed progress, stop the task or copy a continuation draft with recent results and file paths for a new chat on the same host.
- Browse files and use terminals through Codex's existing host interfaces.
- Open web pages directly in the side panel using the visiting device’s browser.
- Display interactive HTML visualizations and the app's Mini interface.
- Preview Word, Excel, PowerPoint, PDF, Markdown and HTML files inside Yard.
- Schedule recurring prompts from Scheduled, with persistent task and run history. Yard runs them while Codex App and all browser pages are closed.
- Receive task completion, failure and approval/input reminders through browser Web Push, including while Yard tabs are closed. Enable each browser in Settings → General → Notifications.
- Use twelve native conversation tools through a permanent host, with the original
  argument schemas, history projection and passive wait behavior. See
  [tool behavior and migration limits](docs/native-app-tools.md).

The next product direction is a task dashboard: clarify and assign work, see which Agent is doing what, and distribute queued tasks to available workers. Worker assignment and its dashboard are planned features. Recurring prompts already run in the Yard service.

## Versions and requirements

| Component | Version | Role |
| --- | --- | --- |
| Codex | `0.169.1` | Required for persistent side chats and native parent/child relationships |
| Codex | `0.164.0` | Verified deployment without the desktop App: automatic backend startup, web interface, and a real model reply |
| Codex | `0.163.0` | Verified local and SSH conversations, files, terminals, and browser integration |
| Codex App interface | `26.1013.40934` | Fixed UI reference and resource snapshot tracked in Git |
| Node.js | `>=24.5` | Tested with `24.16.0`; server platform currently validated on Linux x64 |

Project, membership, pin and section migration is verified with Codex CLI 0.156.0 and 0.164.0. Read receipts require the 0.164.0 protocol. Older SSH backends retain their existing Yard sidebar state and migrate after an upgrade; connecting does not upgrade their CLI.

## Run from source

With Node.js installed, install and sign in to the validated CLI version if needed:

```bash
npm install -g @openai/codex@0.169.1
codex login
```

From your LifeKernel checkout:

```bash
cd projects/codex-yard
npm ci
npm start
```

`npm start` builds this project's host, reads the checked-in resources, then asks Codex CLI to start or reuse its daemon. Closing the web server leaves that shared daemon running. The resource snapshot occupies about **531 MiB** in the checkout and uses ordinary Git files, so Git LFS and a separate App resource download are unnecessary.

The interface and tool adapter change only when their Git snapshot is updated; local Codex App updates do not replace them. Codex backend compatibility is validated separately from the UI snapshot. Package installation and model requests still need their normal network access.

Settings → General → 模型供应商 reads config-defined providers and controls which appear in the composer. The model menu has two levels: provider, then model, with the existing effort control. DeepSeek Flash and V4 Pro use native Responses and expose Low/High/Max. This integration targets CLI 0.164.0; see [provider configuration, catalogs and compatibility](docs/model-providers.md).

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). To customize the server, copy `.env.example` to `.env`. `AGENTS_CODEX_BIN` selects a CLI executable; `AGENTS_CODEX_SOCKET` connects directly to an existing backend and skips automatic daemon startup. `AGENTS_APP_TOOLS_ADAPTER` overrides the vendored adapter if needed. Use a short private `AGENTS_DATA_DIR` when necessary: the complete Unix socket path must fit within 107 bytes.

The sidebar opens with up to 50 current local conversations, read directly from the backend while the full workspace loads. You can select a conversation immediately; the workspace keeps that selection when it takes over. This initial view includes project membership and available pins, and does not load conversation history. SSH lists and the composer become available as the full workspace starts. `npm run test:startup:ui` records both initial-list paint and workspace takeover; add `-- --check-handoff` to verify selection during startup.

Unread state comes from app-server, shared with other clients of that backend. Automatic read acknowledgements and manual marks use its revision-guarded updates; old browser unread markers are removed. With chronological sorting, loaded conversations rank unread inactive threads first, active threads second, then other threads, newest first within each group. The initial request remains limited to 50; existing pagination continues without an extra history scan. Pinned and explicit manual orders stay in place. Projects, membership, pins, sections and compatible queued messages use the same backend. Legacy data is migrated per host; browser preferences retain cross-host navigation and unsent intent. See [State ownership and migration](docs/state-ownership.md).

To share the twelve conversation tools with desktop clients using that daemon,
preview `npm run tools:configure` from the deployed checkout. Add `-- --apply`
after reviewing the plan. See [registration and migration](docs/native-app-tools.md#explicit-registration-for-app-and-yard).

For remote access, set `AGENTS_PUBLIC_ORIGIN` to the exact HTTPS origin and use a private tunnel or an authenticated reverse proxy. The server listens on loopback. It exposes file access and command execution with the connected account's permissions; it does not provide a multi-user login system. See [deployment boundaries](SECURITY.md).

The original interface contacts external configuration and event services. Normal Codex requests also use your configured model provider. A private network does not make model execution offline. Set standard proxy variables only if your network requires them.

SSH discovery reads explicit aliases from the server's `~/.ssh/config` and its `Include` files. Manual profiles remain in Yard's `native-state.json`; chat pins and their order live in the selected host's app-server Pinned section. The sidebar and conversation tools share that backend state. Yard initially reads registered desktop SSH profiles; edits made in Yard stay in Yard's data directory.

## Web pages in the side panel

Ordinary clicks on web links in conversations open in the right panel. Modified clicks and an explicit external-browser destination keep opening in the visiting device's browser. Links outside a conversation, including authentication flows, keep their external destination.

New tab has one central file/URL search. Enter a URL to render it inside Yard using the visiting device's browser; the address bar and navigation controls appear after a page opens. Text entry, scrolling, links and forms run in that page. Reloading Yard restores the submitted URL; the address controls track URLs entered in Yard. Cross-origin navigation within a page cannot update Yard's address bar or navigation history.

Sites must allow embedding with `frame-ancestors` / `X-Frame-Options`. Their login sessions depend on the browser's third-party cookie and storage policies, and HTTPS Yard pages require HTTPS target sites except where the browser permits local origins. Yard preserves the site's policies. Web pages need no companion or desktop App. The page toolbar for Chrome pairing has been removed. Loopback addresses in direct pages refer to the visiting device.

Yard itself allows only same-origin embedding by default. To show a separate Yard development preview in the panel, set `AGENTS_EMBEDDING_ORIGINS` **on the preview instance** to the exact trusted parent origins, separated by spaces (for example `"http://127.0.0.1:8765 https://workbench.example.com:8765"`). Different ports count as different origins. Use the preview's HTTPS address when accessing Yard remotely. This permits the trusted site to embed and control the preview UI; it does not add parent origins to the API or WebSocket allowlist. A reverse proxy in front of the preview must also permit document navigation from the trusted parent.

## Pasting and dropping files

Paste copied files into the composer or drop them onto it. Yard uploads the browser-provided bytes, preserving filenames, then uses the existing attachment manager for local and SSH conversations. Each ordinary file can be up to 64 MiB. For SSH conversations, the Yard service copies the staged bytes directly to the selected host, avoiding large browser WebSocket messages. Clipboard images retain their 10 MiB limit. Upload failures appear in the composer; switching conversations during upload discards the pending attachment.

File paste requires the browser to expose file contents in its clipboard event. If it supplies only text or a path, select the file through the attachment menu.

## File previews

The checked-in document viewers render `.docx`, `.xlsx`, `.pptx` and PDF. Markdown uses the existing rich-text preview; small CSV files open as source text. HTML opens in a sandboxed page with Preview / Source controls; scripts can run inside that page while access to Yard's document, storage and host APIs stays isolated. HTML previews support self-contained UTF-8 files up to 64 MiB and the same public resource origins as visualizations. Relative sibling assets are not served by this endpoint.

Markdown file previews load image references through Yard's file transport on the document's local or registered SSH host. Absolute paths, paths relative to the Markdown file, `file://` URLs, URL-encoded names and reference-style images are supported.

Self-contained `http://localhost:<port>/*.html` links from local conversations also open through Yard, so a visiting computer or tablet reads the page on the Yard machine. These pages use the same 64 MiB ceiling and sandbox as HTML file previews. Yard does not forward browser credentials or follow redirects. Other local services can use Port forwarding. Inline conversation visualizations retain their separate 5 MB limit.

Binary document reads use HTTP, so they do not inherit the JSON WebSocket's 10 MiB read limit. The HTTP transfer ceiling is 64 MiB; each viewer can request a smaller limit (the Office importer requests 40 MiB). Text/RPC reads retain their existing 10 MiB limit. Registered SSH hosts use the same bounded reads and retain their selected host identity. Downloads preserve the original file bytes.

Legacy `.doc`, `.xls`, `.ppt` and OpenDocument formats currently download for opening in a local office application. Yard does not install an office conversion service.

## Port forwarding

Open the top-left Codex Yard menu → 端口转发管理 (Port forwarding) and associate this browser with its receiving device once. Until association is complete, the panel shows setup. The service list then shows this client's forwarding status; select 转发到本机 (Forward to this device), Stop or the open-web icon. Device settings lets you correct the association. Devices reuse Settings → Connections; the Yard machine is also an explicit option.

Add a service by entering its source device, address/port and local port. The receiver is fixed to the associated device. Existing rules with the same source device, address and service port appear as one service. Starting it on another client creates or reuses that client's own listener, preserving other clients' forwarding. Editing and deleting under “⋯” affect the current client's instance; copying gives its local address. Each receiving device uses `127.0.0.1:<local port>`. Existing saved rules remain compatible.

Yard connects to both devices and relays traffic through SSH, with a reverse listener on the receiver's loopback address. Private keys stay on Yard. The receiver needs an SSH server that authorizes Yard and permits TCP forwarding, such as Termux sshd on Android or a compatible computer SSH server. Yard needs an OpenSSH client with ControlMaster support, verified on Linux. Neither endpoint needs Codex or Node.

TCP services including HTTP, databases and SSH are supported. Closing the page keeps forwarding active. Disconnected SSH tunnels report an error and can be restarted manually. Restarting Yard stops tunnels and preserves rules for manual startup; changing an SSH profile stops its tunnels. Yard must be able to reach both endpoints and carries all forwarded traffic.

## Plugins and Computer Use

The Plugins page uses the selected Codex host's native marketplace, plugin installation/removal and MCP authorization APIs. Existing Skills and MCP tools keep using the backend's configuration. Plugins that depend on an application-specific host also need that service to run independently of Codex App.

Yard supplies its own Linux X11 Computer Use runtime: screenshots, mouse, keyboard, text entry, dragging and scrolling. Install `xdotool`, ImageMagick, `xclip` and util-linux, set `YARD_COMPUTER_DISPLAY` (and `YARD_COMPUTER_XAUTHORITY` when needed) in Yard's `.env`, then start Yard and open a new local conversation. A virtual X11 desktop works on headless hosts. The selected desktop runs on the Yard execution machine. [Setup, plugin package and runtime boundaries](docs/standalone-plugins.md).

## Scheduled tasks

Open Scheduled → Create options → Set up manually, choose a project and schedule, and save the prompt. Each run creates a new conversation; the existing task details show its history and open that conversation. Pause, resume, edit and Run now use the same page. Keep the Yard Node service running, for example under your existing service manager. Closing browser pages or Codex App does not stop scheduling; stopping Yard or the machine does.

Yard stores tasks and runs in its own data directory. It does not load the desktop App's task database or require its scheduler. After downtime, each overdue task runs once and advances to its next future time. An unfinished run blocks another run of the same task. An uncertain write is never resent automatically: inspect the conversation or recent chats, then use the recovery action below that run to release the block.

Tasks use an existing local or SSH project directory, or a new projectless directory. They inherit the CLI backend's configured permissions; approval requests wait for you to open the conversation. Browser notifications can alert you to completion, failure or requests for input. Automatic worktree creation, heartbeat runs, environment setup scripts and automatic archiving are not provided. See [scheduling design and recovery](docs/scheduled-tasks.md).

## Browser notifications

Open Settings → General → Notifications, select 开启本设备通知 and allow notifications. Set which task states to receive and use 测试通知 to check this browser. Enable the computer and tablet browsers separately. Clicking a notification opens its conversation. Existing device subscriptions continue to work after upgrading.

Web Push uses the browser's push service and a Service Worker, so the Yard page can be closed. Yard and Codex must remain running. HTTPS (or local loopback), notification permission and access to the browser's push service are required; delivery also depends on OS background settings. Fully exiting a desktop browser can pause delivery. Private VAPID keys, subscriptions and observations stay in the existing private data directory. [Setup, delivery and verification](docs/browser-notifications.md).

## Development

Homepage startup seeds the renderer's existing sidebar query cache with current project, pin and membership settings. Conversation lists continue to use live backend reads. Immutable renderer assets are adapted and compressed once in a bounded 64 MiB service cache, with startup modules prepared before accepting pages. The anonymous configuration capture uses private HTTP revalidation across reloads.

`npm run test:startup:ui` measures three cold/reload pairs against 180 synthetic conversations, five projects and three simulated SSH hosts. It checks opening a conversation, background pagination/connections, an empty sidebar and a collapsed mobile sidebar. Run it under the shared heavy-browser lock. `AGENTS_STARTUP_SOURCE` selects another built checkout for a baseline; `AGENTS_STARTUP_CONFIGURATION` optionally supplies an anonymous configuration capture directory. Evidence stays in ignored `.local/sidebar-startup/`; timings depend on the browser and hardware.

Local and SSH conversations initially read the latest two turn summaries with `thread/turns/list`. These contain the user message, final answer and timing. Running turns also read one recent item page, plus the opening items when needed, to recover completed commentary omitted by summaries. Work can expand a running turn and load its remaining pages; subsequent toggles reuse its cache. Opening a chat starts at the latest content, while scrolling up retains the native viewport behavior. Older message pages remain summaries until expanded. Explicit full-transcript consumers and the navigation rail retain their existing reads.

`npm run test:history:ui` opens the pinned interface against a disposable protocol fixture. It holds model, MCP and runtime restoration requests pending, checks that messages appear independently, then verifies lazy activity expansion, failure/retry, cached toggles, same-page switching and older-message scrolling. Pass `-- --baseline` to compare the previous three-full-turn reader and its original disclosure. `npm run test:history:cli` repeats opening, native activity expansion, switching and a streamed follow-up with an isolated real CLI and a loopback scripted provider. Neither script uses personal conversations or an external model account. Both need Chromium; the second also needs Codex CLI. Run browser checks under the shared heavy-test lock when applicable. Evidence stays in ignored `.local/conversation-history/`.

`npm run test:file-paste:ui` uses two isolated real CLI backends, a loopback model provider and a temporary OpenSSH server to check file paste/drop, exact upload bytes, equal filenames, 64 MiB local and SSH attachments, upload errors and conversation switching. This check requires OpenSSH client/server tools. Files use DOM clipboard fixtures; text and images use trusted Ctrl+V. Physical operating-system file clipboards require device validation. Evidence stays in ignored `.local/file-paste/`.

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

`npm run test:read-state:cli` uses a disposable CLI `0.164.0`, a scripted loopback model provider and two independent Chromium contexts. It checks priority order, automatic and manual read marks, synchronization, reloads and legacy marker removal. It needs no personal account or external model requests. Evidence stays in ignored `.local/thread-read-state/`; `AGENTS_READ_STATE_EVIDENCE` selects its output directory.

`npm run test:turn-progress:ui` uses the fixed renderer and a disposable backend to check silent waits, native retry events, resumed output, continuation drafts, native interruption, same-page navigation and phone layout. It requires Chromium; evidence stays in ignored `.local/turn-progress/`. Run it under the shared heavy-browser lock. The timer uses progress observed while viewing the turn; running tools and pending approvals keep their native status. Copying reads at most five recent turn summaries and keeps the current request and latest completed answer, omitting image data. Review the draft, stop the original task, then send it in a new chat on the same execution host. Codex owns network retries; Yard does not replay tasks or alter provider timeouts.

`npm run test:automations:ui` checks the original Scheduled page using a disposable protocol fixture, including recovery after a lost write reply. `npm run test:automations:cli` starts an isolated CLI backend and a loopback scripted model provider, checks scheduling with no browser, restart recovery and delayed approvals, then runs the same UI against that backend. It uses no personal account or external model requests. `AGENTS_TEST_CODEX_BIN` and `AGENTS_TEST_CHROMIUM` select the installed executables. Evidence stays under ignored `.local/automations-*`.

`npm run test:port-forwarding:ui` uses a disposable OpenSSH server and keys, an isolated CLI and browser to verify actual SSH forwarding, remote port conflicts, menu controls, tablet layout, page-independent tunnels and persisted rules after restart. It requires `ssh`, `ssh-keygen`, `sshd`, the CLI and Chromium. No personal account or external model requests are used. `AGENTS_TEST_SSHD` selects sshd; `AGENTS_TEST_BROWSER_WS` connects a separate test browser. Evidence stays under ignored `.local/port-forwarding/`; temporary keys are removed with the fixture.

`npm run test:previews:ui` starts an isolated real CLI and a loopback scripted provider, then opens Word (including a file above 10 MiB), Excel, PowerPoint, PDF, HTML, Markdown and CSV from actual conversation links. It checks rendered content, embedded images, loaded slide counts, HTML interaction and isolation, source switching, and download byte preservation. It uses no personal account or external model requests. The executable and browser connection variables above also apply; provide a compatible anonymous bootstrap through `AGENTS_TEST_CONFIGURATION_SNAPSHOT` for this offline UI fixture. `AGENTS_PREVIEW_DOCX` and `AGENTS_PREVIEW_DOCX_TEXT` optionally select a private large Word file and expected text. Evidence stays under ignored `.local/file-previews/`; temporary inputs and the CLI data directory are removed afterward.

Use `AGENTS_PREVIEW_SSH=1 npm run test:previews:ui -- 说明.md` to verify Markdown image host routing with a loopback SSH transport fixture. Local and remote images have different dimensions, so the check detects reads from the wrong host.

`npm run test:notifications:ui` checks the existing Settings controls, saved preferences after reloading, tablet layout and actual Service Worker notification display with an isolated CLI and scripted provider, including after every Yard page closes. It uses disposable subscription data and a local encrypted receiver with CDP push injection; public push-service delivery and physical device policies require device validation. Evidence stays under ignored `.local/browser-notifications/`.

`npm run test:host-preferences:ui` checks SSH addition, sidebar pins, archive persistence and restoration in a disposable browser and data directory. It uses a synthetic backend by default; `AGENTS_TEST_CODEX_SOCKET`, `AGENTS_TEST_CODEX_HOME` and `AGENTS_TEST_THREAD_ID` can select a disposable CLI fixture. The fixture chat must be named `SSH and pin fixture` and contain a completed turn. With a running second turn, set `AGENTS_LIFECYCLE_ACTIVE=1` to also confirm Stop and archive and check that the turn was interrupted. SSH transport stays on a loopback test stream. `AGENTS_TEST_CHROMIUM` selects Chromium; `AGENTS_TEST_CONFIGURATION_SNAPSHOT` can supply a compatible anonymous configuration snapshot.

`npm run test:new-chat:ui` checks that a project's first message opens its conversation and appears while backend creation is still pending. Set `AGENTS_NEW_CHAT_ENTRY=global` to exercise the sidebar's top New chat button, or also set `AGENTS_NEW_CHAT_KEY=Control+Enter` to verify the renderer's background-send shortcut stays on the new-chat page. It uses a synthetic backend by default and supports the same disposable CLI variables; the selected CLI fixture must have a completed assistant message containing exactly `Previous conversation response`.

`npm run test:mobile-input:ui` checks touch entry without composer autofocus, tap-to-type, keyboard resize and scroll, draft preservation, message bubble spacing and wrapping, and desktop focus. It uses four phone/tablet viewport sizes with synthetic `VisualViewport` events in Chromium. It supports the same disposable CLI variables; the selected fixture must be named `Mobile chat`, with a completed reply `Mobile fixture response` and a user message starting with `长消息换行`. Physical Android Chrome and iPhone Safari keyboards still need device validation.

`npm run test:embedded-browser:ui` uses disposable websites and a synthetic backend to check direct rendering, touch input, forms, scrolling, address navigation, tablet layouts, reload recovery and a site's refusal to embed. Set `AGENTS_EMBEDDED_TEST_SOCKET`, `AGENTS_EMBEDDED_TEST_CODEX_HOME` and `AGENTS_EMBEDDED_TEST_THREAD` to validate against a disposable CLI conversation with a completed reply exactly `内嵌网页验收内容`. The Chromium and anonymous configuration snapshot variables above also apply. Evidence stays under ignored `.local/embedded-browser/`. Physical iPad Safari cookies and keyboard behavior require device validation.

| Directory | Purpose |
| --- | --- |
| `src/native/` | Browser bridge, HTTP/WebSocket host, files, terminals, preferences, visualizations |
| `src/browser-reuse/` | Chrome pairing, panel integration, element references |
| `lib/` | Codex transport, host tools, permissions, protocol types |
| `scripts/` | Build and optional live validation |
| `test/` | Portable tests, including the vendored official adapter |
| `vendor/codex-app/` | Fixed upstream compiled interface, assets, notices, and Node tool adapter |

Runtime state, host build output, and generated Chrome companion packages live in ignored `.local/`. Conversations remain in Codex; browser drafts remain in the browser's storage. No account data or configuration snapshot is supplied with this repository.

## Known limits

- See [host interface coverage](docs/host-interface-coverage.md) for connected conversation/search/settings controls and the remaining native host gaps.
- Compatibility depends on private desktop interfaces and the pinned renderer version.
- Full desktop parity, Git/worktree operations, and general automation are incomplete.
- Existing sessions owned by a separate stdio backend may require coordination before another client can continue them.
- Physical iPhone behavior and Windows Chrome pairing still need dedicated validation.
- The sub-two-second startup target has not been reached.

## License

Project-authored source is supplied under the [MIT license](LICENSE). Files under `vendor/codex-app/` and `vendor/native-app-tools/` are third-party compiled resources and are excluded from that MIT grant; their existing copyrights, notices and terms remain applicable. See [third-party components](THIRD_PARTY.md). This project is not affiliated with or endorsed by OpenAI.
