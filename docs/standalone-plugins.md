# Original tools and standalone plugin setup

Yard selects independent tool transports for its local sessions. It shares the existing Codex backend and Codex home with other clients. Starting Yard does not edit `config.toml`, install plugins, reload MCP globally or stop a loaded session.

## Names and ownership

| Capability | Model-visible name | Implementation / prerequisites |
| --- | --- | --- |
| Conversation management | `codex_app` | Original adapter and conversation kernel, hosted by Yard |
| Persistent JavaScript | `node_repl`: `js`, `js_reset`, `js_add_node_module_dir`, hidden `turn_ended` | Original executable, independent Node and Codex CLI |
| Computer Use | `computer-use:computer-use`, `@oai/sky` through `node_repl` | Original Sky library/helper; selected X11 desktop or independent Windows interactive host |
| Word | `documents:documents` | Original Skill/scripts and copied file runtime |
| PDF | `pdf:pdf` | Original Skill/scripts and copied file runtime |
| Spreadsheet files | `spreadsheets:Spreadsheets` | Original Skill/scripts and `@oai/artifact-tool` |
| PPT | `presentations:Presentations` | Original Skill/scripts and `@oai/artifact-tool` |
| Personal templates | `template-creator:template-creator` | Original generator; its generated Skills live in the selected Codex home |
| Chrome | `chrome:control-chrome` | Original Browser service/client, official browser extension, independent native messaging host |
| In-app Browser | `browser:control-in-app-browser` | Original package and Yard-owned Chromium backend; no browser extension required |
| Title organization | `codex-task-title-organizer:organize-codex-task-titles` | Install the existing title organizer separately; it is not one of the file plugins |
| Connectors | `codex_apps` | Their own MCP endpoint, account and OAuth; independent from Yard's `codex_app` conversation tools |
| Notifications | Yard Web Push | [Browser notifications](browser-notifications.md) |

The five file plugins are separate packages with their original Skill names, descriptions, bodies, scripts and notices. Their short Yard setup paragraph replaces the App's workspace dependency loader with the package's `runtime.ts`. Native MCP descriptions, parameter schemas and annotations come directly from the original Node executable. Computer Use is a library behind that REPL, rather than a renamed `yard_computer` tool.

The repository includes original **Linux x64** Node/Sky/Chrome resources and original **Windows x64** Node/Sky/extension-host resources. The Yard server is validated on Linux, including WSL controlling a Windows desktop. Windows desktop access uses an independent host in the signed-in user session. Other architectures need matching original assets and platform validation. The original Node executable is compiled native code; it is copied, not translated into TypeScript. Yard's configuration and lifecycle adapters are TypeScript.

## What changes in a session

New, forked, prewarmed, scheduled and cold-resumed local sessions read effective configuration for their **target working directory**. Yard replaces the `node_repl` transport as one table, retaining `enabled`, `required`, tool approvals and timeouts, and removes old App command/URL/pipe settings. Existing caller overrides are preserved. A failed configuration read stops that operation. SSH sessions use the execution host's configuration.

Installed canonical packages are selected in the session. An installed duplicate from another marketplace is disabled only in that session. When original `browser` or `chrome` is installed, Yard also disables `unified-computer-use@openai-bundled` in that session because it supplies the App-managed `cua_repl` backend. Installed `yard-node` is disabled there; `yard-artifacts` is disabled after all five replacements exist, and `yard-computer` after its replacement exists. Their source remains for existing installations and the earlier Windows driver; they are absent from the new marketplace catalog. Explicit legacy MCP entries in your configuration still need migration if they independently register a second server.

The native thread configuration receives a nested `plugins` table keyed by each complete plugin ID. This lets the backend load the original Skill catalog while its shared plugin setting remains off. Yard's Skill catalog uses native plugin metadata and installed cache paths, retaining individual Skill disable settings. In the pinned interface, choose plugin Skills from the composer's Skill picker and manage packages in Settings → Plugins; its standalone Skills settings page lists non-plugin Skills.

A loaded conversation keeps the backend's current tools and kernel when opened from another client. Open a new conversation or fork to adopt the new runtime. If App and Yard race to cold-resume the same conversation, the backend's first loaded configuration wins. Yard does not execute diagnostic JavaScript to identify or reset that kernel. To keep an App toolset and a Yard toolset concurrently, use separate conversations on the same backend.

MCP tools and Skills form part of the model context. Restoring names and schemas reduces avoidable differences; runtime paths, the setup paragraph, installed Skills and tool ordering can still change the prompt prefix. Cache hit rates have not been measured. See [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Install packages once

Run on the selected execution host, with the **existing backend's** Codex home. Keep the marketplace checkout at a stable path. Reuse an existing registration instead of creating another one.

```bash
yard_codex_home=/absolute/path/to/existing-codex-home
yard_checkout=/absolute/path/to/codex-yard
CODEX_HOME="$yard_codex_home" codex plugin marketplace add "$yard_checkout"
CODEX_HOME="$yard_codex_home" codex plugin add documents@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add pdf@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add spreadsheets@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add presentations@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add template-creator@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add computer-use@codex-yard
# Install these when their browser connection prerequisites below are ready.
CODEX_HOME="$yard_codex_home" codex plugin add chrome@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add browser@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin list
```

The backend must support native plugins; keep `[features] plugins = true` in its existing configuration if necessary. Plugin installation enables a package in the shared configuration. Review its required hooks as described below before turning it off. For Yard-only use, set that new package's `enabled` to `false` in Codex Settings → Plugins or its existing `[plugins."documents@codex-yard"]` table (repeat for the other new packages). Yard enables installed replacements per session. Keep the existing App marketplace entries and other settings. This is a one-time installation choice; Yard startup performs no configuration writes. On PowerShell, set `$env:CODEX_HOME` before the equivalent CLI commands.

Open a new local Yard conversation and check Skills and MCP status, then run actual operations. `enabled = true` alone does not mean a package is installed or its external service is connected.

Review the installed `computer-use` / browser hooks and allow the selected hooks after inspection. The pinned interface's Settings → Hooks reads the shared plugin configuration. For a Yard-only package that is globally off, temporarily enable it in Settings → Plugins, open a new Yard conversation and approve its hooks in the native **Review hooks** dialog, then turn the package off again in Settings → Plugins. A CLI 0.171 client can also inspect a loaded Yard thread directly with `hooks/list` and its `threadId`. Native Codex keeps new or changed hooks untrusted until approval. Computer Use needs its `Stop`, `Interrupt` and `SubagentStop` hooks to release held input at turn end. Yard does not approve hooks automatically or write their trust state at startup.

## Original Node REPL

The pinned snapshot is `vendor/node-repl/0.0.30-20261014203459-0849368674e2/linux-x64`. It includes the original `node_repl`, Sky 0.7.8, its helper and shipped Statsig dependencies. Yard uses its own Node executable (`process.execPath`), or `YARD_NODE_REPL_NODE`, and the standalone Codex CLI from `AGENTS_CODEX_BIN` / `PATH`. It does not use `--disable-sandbox`.

Set `YARD_NODE_REPL_ROOT` only for an independently prepared matching runtime root containing `bin/node_repl` (`.exe` on Windows) and `lib/node_modules`. Do not point it at a versioned App installation. Yard explicitly forwards its selected `CODEX_HOME` to Node REPL so the Browser service's auxiliary CLI reads the same configuration, including when Yard uses a custom home. CLI and runtime sandbox protocols must be compatible; Linux validation used **Codex CLI 0.169.1**, Node **24.16.0**, original runtime **0.0.30/20261014203459-0849368674e2**. These versions are separate from the pinned Yard UI.

Use native dynamic imports, `nodeRepl.write`, `nodeRepl.emitImage` and the original context helpers:

```javascript
let count = 41;
nodeRepl.write(++count);
const path = await import('node:path');
nodeRepl.write(path.basename(nodeRepl.cwd));
```

Bindings remain until native reset or kernel teardown. Timeout/cancellation behavior belongs to the original supervisor; Yard never retries submitted code. Closing a Yard page does not stop the backend-owned execution. The CLI's administrative `mcpServer/tool/call` path does not reproduce model-turn authority: test writes and desktop actions through an actual model turn. Keep the native approval and sandbox configuration in effect when testing.

Permission validation with CLI 0.169.1 found a concrete boundary: the default read-only conversation with `approval_policy = "never"` rejects the model's Node tool call. Explicit `mcp_servers.node_repl.tools.js.approval_mode = "approve"` authorizes execution and permits a repository write, even in that read-only conversation. The administrative tool-call endpoint also executes outside that model approval check. Yard preserves these native settings; it does not add `approve` for Node. Review an inherited explicit approval if you expect read-only execution. These probes verify native approval behavior, not an independent OS filesystem boundary after explicit tool approval.

## Prepare the original file runtime

Prepare once from an already available, authorized **original primary runtime**. Copying its dependency tree is explicit; Yard startup does not download it or install OS packages.

```bash
npm run artifacts:prepare -- \
  --source /absolute/path/to/original/codex-primary-runtime
```

The default independent destination is `~/.local/share/codex-yard/artifact-runtime`. Use `--destination /absolute/private/directory` to select another new directory. Preparation validates platform/architecture, preserves relative symlinks and notices, stages the copy and renames it into place. It does not overwrite an existing destination. The source cache may then be unavailable; runtime operations use the copied tree.

Each installed file plugin has `runtime.ts`, which returns `nodePath`, `pythonPath`, `nodeModulesPath`, `overrideBinDir` and `fallbackBinDir` from `runtime.json`. Run it with independent Node. For a custom destination, pass the manifest explicitly:

```bash
node /absolute/installed/documents/runtime.ts /absolute/private/directory/runtime.json
```

Alternatively set `YARD_ARTIFACT_RUNTIME_MANIFEST` in the **actual execution process**. Setting it only in Yard's `.env` does not change an already-running Codex daemon or its shell tools. Use the returned interpreter paths. Link the returned `nodeModulesPath` as `node_modules` in a private build directory for authored `.mjs` imports, put the returned override directory first on that command's PATH, and use fallback binaries as needed. No global npm/Python installation is required.

The validated original Linux bundle is **26.909.61513**, `@oai/artifact-tool` **2.8.59**, with its Node/Python, LibreOffice and Poppler. The original document renderer locates the copied LibreOffice relative to its Python interpreter. Cloud Docs/Slides/Sheets exports and `spreadsheets:excel-live-control` require their authorized connectors; their presence in package metadata does not supply an account. Local files and the original personal-template generator work independently. The generator writes only to the chosen `CODEX_HOME/skills`; test it with a disposable home before personal installation.

Run `node scripts/verify-artifact-runtime.ts` on the destination host after preparation. Matching Linux/x64 alone does not ensure matching system libraries: on Ubuntu 22.04, the copied LibreOffice and Poppler from this bundle report missing `GLIBC_2.38` / `GLIBCXX_3.4.31`. Its Python and artifact-tool work there. For that host, install the distribution's compatible `libreoffice-writer` and `poppler-utils`, then explicitly select those tools in the **private runtime copy**. This keeps the original renderer and its runtime-relative discovery working:

```bash
# Install through your host's normal package-management process first:
# sudo apt-get install --no-install-recommends libreoffice-writer poppler-utils
yard_runtime_override="$(node plugins/documents/runtime.ts | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).overrideBinDir))')"
yard_runtime_backup="${yard_runtime_override}.before-system-tools"
mkdir "$yard_runtime_backup"
for yard_tool in soffice libreoffice pdfinfo pdftoppm pdftocairo pdftotext pdffonts pdfimages; do
  test -x "/usr/bin/$yard_tool" || exit 1
  if test -e "$yard_runtime_override/$yard_tool" || test -L "$yard_runtime_override/$yard_tool"; then
    mv "$yard_runtime_override/$yard_tool" "$yard_runtime_backup/$yard_tool"
  fi
  ln -s "/usr/bin/$yard_tool" "$yard_runtime_override/$yard_tool"
done
node scripts/verify-artifact-runtime.ts
```

Choose a new backup directory for a later change. To undo this selection, remove only these new links and move the saved entries back. The destination still needs compatible fonts and the libraries required by its selected tools; keep their package versions with the deployment record. The preparation command performs no OS package installation or system-library upgrade.

## Computer Use on Linux

Install `computer-use`, select an X11 screen 0 explicitly, and make its accessibility session available to Yard:

```dotenv
YARD_COMPUTER_DISPLAY=:0
# If this desktop requires an authority file:
# YARD_COMPUTER_XAUTHORITY=/absolute/path/to/.Xauthority
```

Start Yard from the selected desktop's session, or supply that session's `DBUS_SESSION_BUS_ADDRESS` (and `AT_SPI_BUS` / `XDG_RUNTIME_DIR` when used) in its environment. Yard forwards these values in the per-session MCP definition because an existing daemon does not inherit its launch environment. The desktop needs X11 libraries, a D-Bus session, AT-SPI services and an application with accessibility enabled. Screenshot and coordinate actions can work through the X11 fallback; original clipboard/text and accessibility actions need AT-SPI. Native Wayland is not covered by this validation.

A headless host can use its own Xvfb desktop and `dbus-run-session`, with applications started inside the same session. Tests use that isolated arrangement and never select the operator's desktop. Sky's original helper owns screenshot, window/tree, clipboard, click and text behavior. Yard's small service adapter releases held keys and drag handles for their originating turn on `Stop`, `Interrupt` and `SubagentStop`; plugin hooks call the original hidden `turn_ended` tool. Keep the plugin enabled and its hooks trusted in the conversation.

The original Linux helper releases keys on exit but can leave an active drag button held. A small Yard stdio forwarder preserves the native protocol and, when its parent exits, ends only a drag started through that helper. It waits for the original cleanup response before closing the helper. This covers cancellation/reset that destroys the trusted-service process before turn hooks can run; it adds no desktop API or persistent service.

## Windows desktop from WSL

Install independent Windows Node.js (24.5 or later) and a native Windows Codex CLI `.exe`. The Linux CLI remains the conversation backend. The original Windows desktop helper also needs a Windows CLI and a private Windows Codex home for its own control process; it does not use the App installation or replace the shared WSL backend.

Run the setup with standalone Node from this checkout. It previews changes first; `--apply` prepares the copied runtime, backs up the previous host/task configuration and registers the current user's **interactive**, limited-privilege logon task:

```powershell
node scripts/install-windows-computer.ts --codex C:\standalone\codex.exe
node scripts/install-windows-computer.ts --codex C:\standalone\codex.exe --apply
```

`--auth-source` selects an existing authorized `auth.json`; the default is the Windows user's `.codex/auth.json`. The private helper home receives that file without the old App's config, model catalog or MCP paths. `--destination`, `--codex-home`, `--task-name` and `--pipe` select explicit locations. Keep the generated backups private. Windows must be signed in with its desktop unlocked. SSH-created processes normally run in Session 0 and cannot substitute for this interactive host.

Windows native Node REPL also needs a user-interactive session: the copied executable completed `initialize`, `tools/list` and JavaScript under an interactive task with independent Node 24.11.1. The same probe from SSH Session 0 failed to start its kernel with `0xC0000142`; changing Node versions did not resolve that environment restriction. The supported Yard deployment described here runs the Linux REPL in WSL and uses the interactive Windows host for desktop actions.

Set these in the WSL Yard service's `.env`, then open a new Yard conversation:

```dotenv
YARD_COMPUTER_TARGET=windows
YARD_WINDOWS_NODE="C:\Program Files\nodejs\node.exe"
YARD_WINDOWS_SKY_PIPE=\\.\pipe\codex-yard-computer-use
```

Do not also select `YARD_COMPUTER_DISPLAY`. WSL forwards the original helper protocol through the private named pipe. The Windows host owns the original helper, its Windows parent PID and input release. Disconnect cleanup waits for pending operations, sends the original `end_turn` and `close`, and reports cleanup failures. The Skill reads `sky.target` and chooses the original Windows reference before using its window/screenshot arguments.

To remove this host, finish active desktop work, stop and unregister its named scheduled task, and retain or remove its private installation as needed. The installer prints the private backup's `restore.ps1` command. That script restores the previous host, runtime, authentication and task registration; it leaves the restored task stopped for inspection before starting it. Keep the shared WSL Codex home and daemon intact.

## Chrome and Browser connection

The original Browser/Chrome client, trusted browser service, documentation and **Linux x64** native extension host are copied into their respective packages. Yard binds the trusted `browser` service when either package is installed. Chrome still requires the official browser extension and native messaging registration pointing at the stable **copied** extension host; an App-version path can break after App upgrades.

For an explicit Chrome setup, inspect the installed Chrome package's `scripts/installManifest.mjs`. It exports `install`; directly executing the module does not perform registration. Save and run this `.mjs` script with standalone Node, replacing the absolute paths with stable independent paths:

```javascript
import { install } from '/absolute/installed/chrome/scripts/installManifest.mjs';
await install({ appServerRuntimePaths: {
  codexCliPath: '/absolute/path/to/standalone/codex',
  nodePath: '/absolute/path/to/standalone/node',
  nodeReplPath: '/absolute/yard/vendor/node-repl/0.0.30-20261014203459-0849368674e2/linux-x64/bin/node_repl',
} });
```

This is an administrative setup command: on Linux it writes NativeMessagingHosts manifests for supported browsers, and on Windows the original installer also writes HKCU registration. It is not run by Yard startup or tests against a personal profile. Use the host binary matching the browser's OS/architecture; a WSL Linux host cannot replace the Windows native host. Retain existing manifests for rollback and validate with the installed extension's diagnostics. Account/browser authorization remains with the original extension.

For Windows Chrome from WSL, use the Windows native host and standalone Windows executables. `node scripts/install-windows-chrome.ts --codex C:\standalone\codex.exe` previews registration; `--apply` backs up the original manifest/registry registration and copies the Chrome package to a stable Windows directory. Reconnect the official extension afterwards. Set `YARD_CHROME_WINDOWS=true` and `YARD_WINDOWS_NODE` in WSL Yard. Yard bridges only extension backends, excluding an App-owned `iab`. Multiple connected Chrome profiles require an explicit `YARD_CHROME_WINDOWS_PIPE` selector. A missing extension remains a browser installation prerequisite; package installation alone does not establish a working Chrome connection.

`YARD_BROWSER_BACKEND_PATHS` supplies compatible socket paths, separated by the execution platform's path-list delimiter. This explicit list replaces the original service's default socket discovery. Yard adds its configured IAB and Windows Chrome bridge sockets to the list. When combining Yard IAB with Linux Chrome, also put the actual independent extension socket in `YARD_BROWSER_BACKEND_PATHS`; otherwise only IAB will be discovered. Retain existing manifests for rollback and validate with the installed extension's diagnostics. Chrome's platform registration and framing are described in the [official native-messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging); WSL path/argument handling follows [Microsoft's interoperability documentation](https://learn.microsoft.com/en-us/windows/wsl/filesystems).

## In-app Browser without an extension

Install `browser@codex-yard` and an independent Chromium executable, then set:

```dotenv
YARD_BROWSER_EXECUTABLE=/absolute/path/to/chromium
YARD_BROWSER_HEADLESS=true
```

Yard starts Chromium lazily and hosts the original `iab` pipe contract. The original Browser Skill/client/service still implement DOM reading, Playwright actions, screenshots and their approvals. No GPT/ChatGPT browser extension, App process or App resource path is required. In a local chat, open a tool tab and select **Agent Browser** to see and interact with the same tabs as the Agent. Closing the panel or resetting Node REPL preserves the host's pages. The original Stop hook closes temporary Agent-created tabs; `markHandoff` / `markDeliverable` and user-created tabs survive. Different conversations receive separate tabs.

This host currently accepts unrestricted network policy only. It rejects a restricted policy before attaching or executing browser actions because worker/frame coverage is incomplete. Keep native policy and approval settings; the host does not silently weaken a restriction. Chromium retains its normal OS sandbox. Supply a correctly configured executable; Yard does not download a browser or disable its sandbox at startup. The browser profile stays under Yard's private data directory. Browser tabs belong to the running Yard service; a service restart closes its browser process.

## Connectors, titles and deployment checks

Configure `codex_apps` with its supported endpoint and account; validate OAuth and network on the execution host. The local connector failed in the initial comparison and was not a healthy baseline. An App-independent Yard conversation host does not provide third-party connector credentials. Use the existing title-organizer plugin for its Skill/hooks, and Yard Web Push for completion notifications rather than old Windows App paths/pipes.

| Symptom | Check |
| --- | --- |
| Plugin enabled but no Skill | Correct backend/Codex home, installed package, enabled session and new conversation |
| Permission warnings in WSL | Linux user's own Codex home/ownership; avoid inheriting Windows `CODEX_HOME` |
| Service cannot find Linux Node | Independent Linux Node on the service PATH; a Windows Node path does not provide it |
| SSH alias unavailable in WSL | The WSL user's SSH configuration, key access and reachable target/port |
| Old thread cannot start a tool | Its stored cwd still exists; do not silently redirect execution |
| MCP URL fails | Backend-side DNS, proxy, TLS, supported endpoint and login, followed by an actual tool call |
| OAuth callback unreachable | Callback/tunnel configuration on the backend; remote browser loopback differs from backend loopback |
| Chrome host missing after App upgrade | Native messaging manifest uses a stable independent host path |
| Read-only Node or desktop denial | Effective project/turn/tool policy and CLI/runtime metadata; keep sandbox enforcement |

Keep each execution host's configuration and prerequisites explicit. Updating Yard does not repair unrelated SSH aliases, network settings or historical working directories.

## Validation and rollback

Run `npm run typecheck` and `npm test`. `node scripts/verify-plugins.ts --ui` uses a disposable CLI home to install/uninstall all eight packages, check exact original descriptors, render Plugins and test disconnect/reset. `dbus-run-session -- node scripts/verify-original-runtime.ts` additionally needs Xvfb (`AGENTS_TEST_XVFB` or the test fixture path) and disposable Chromium; it exercises the actual model/tool path, default MCP approval denial and an explicit per-tool-approved write without an external model. `node scripts/verify-artifact-runtime.ts` exercises original file generation/rendering and template create/update against the prepared manifest. `node scripts/verify-original-iab.ts` runs the original Browser client/service through native Node REPL and a disposable CLI/model loopback, including shared panel state, lifecycle, reset and rejection of restricted network policy.

For standalone acceptance, mask the App installation and the original primary-runtime cache while those probes run. Evidence, runtime copies and outputs remain private under `.local/`; no account or conversation data belongs in Git. Upstream provenance and retained terms are listed in [THIRD_PARTY.md](../THIRD_PARTY.md).

To roll back, revert this session-configuration change and remove only packages installed for this migration. Keep the previous App plugin entries and configuration. The backend retains loaded sessions until their normal unload; no shared daemon restart is required. Keep generated user documents and template Skills unless their owner requests removal.
