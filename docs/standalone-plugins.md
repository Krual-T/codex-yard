# Standalone capabilities and plugin setup

Yard is an independent Codex client and capability host. Build, startup, conversations, plugin management and supported Computer Use must work with Codex App absent or closed. Node, the Codex CLI, the configured model provider and each plugin's documented system dependencies remain prerequisites. Checked-in App UI resources provide the reference interface; Yard supplies the runtime services.

## Choose the capability

| Capability | Standalone implementation | Setup |
| --- | --- | --- |
| Session tools exposed as `codex_app` | Yard's checked-in adapter and Codex backend | Included with Yard; the tool namespace is historical and does not require the desktop App |
| Persistent JavaScript | `yard-node` plugin, MCP server `yard_node` | Install the repository plugin and use standalone Node >=24.5 |
| Desktop control | `yard-computer`, MCP server `yard_computer` | Explicit Linux X11 display or Windows driver; see below |
| Local Word, PDF, spreadsheets, PPT and templates | `yard-artifacts` Skill and public Python libraries | Install the plugin, Python environment and rendering tools |
| Browser/Chrome | Public Chrome DevTools MCP | Register the MCP and provide standalone Chrome |
| Task titles | Existing Codex Task Title Organizer | Install its marketplace/plugin; review Hooks for automatic checkpoints |
| Completion notifications | Yard Web Push | Follow [browser notification setup](browser-notifications.md) |
| Remote connectors exposed as `codex_apps` | The connector's own server and account | Configure its supported MCP/OAuth endpoint; validate network and authorization separately |

An `enabled = true` entry is a preference. Check that the package is installed, its Skill appears in the selected backend, its MCP connects, and an actual operation succeeds. The five App-oriented Office/template packages may require an additional artifact runtime. This repository does not provision that private runtime; `yard-artifacts` provides the local file workflow through public dependencies. Cloud document APIs, live Excel, OCR and advanced Office features have separate prerequisites.

## Install the Yard packages

Run on the **selected execution host** using the same Codex home as its Yard backend. A terminal's default home can differ from the daemon's home. Inspect the service's existing `CODEX_HOME` and `AGENTS_CODEX_BIN` before installing; keep existing credentials and policy settings.

```bash
yard_codex_home=/absolute/path/to/the-existing-codex-home
yard_checkout=/absolute/path/to/codex-yard
CODEX_HOME="$yard_codex_home" codex plugin marketplace add "$yard_checkout"
CODEX_HOME="$yard_codex_home" codex plugin add yard-node@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add yard-artifacts@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin add yard-computer@codex-yard
CODEX_HOME="$yard_codex_home" codex plugin list
```

Reuse an existing `codex-yard` marketplace registration. Keep its checkout at a stable path. On Windows, set `$env:CODEX_HOME` in PowerShell before the equivalent `codex plugin` commands. The CLI/backend must support native plugins; enable `[features] plugins = true` in its existing configuration if disabled. Merge into the existing section rather than adding a second `[features]` table. Installation does not grant tool approval or install operating-system dependencies.

Open a **new conversation on that host** and check for `yard-node:javascript`, `yard-artifacts:files` and `yard-computer:use-computer`. Confirm the `yard_node` and selected `yard_computer` tools connect, then run the acceptance actions below. Older loaded conversations can retain their original tool inventory. A successful CLI installation in another Codex home or backend does not update them.

## Persistent JavaScript

`yard_node.evaluate` runs ordinary Node JavaScript in one persistent child process per MCP session. It supports top-level await, redeclaration, console output, the final expression and image results:

```javascript
let count = 41;
await Promise.resolve();
++count;
```

Run `count` in a second call and expect `42`. Import with `await yardNode.import('node:fs/promises')` or an installed package name. Package resolution starts in `process.cwd()`; use `process.chdir('/absolute/task/directory')` before task-local imports. Native `import()` inside the inspector evaluation has no module loader; use `yardNode.import`. Emit PNG/JPEG results with `yardNode.emitImage({bytes, mimeType})`.

The kernel uses Node's in-process inspector API without opening a debug port. It does not implement App-specific `nodeRepl.rpc`, BrowserLib or notification pipes. Use the dedicated browser, computer and Yard notification integrations for those operations.

Evaluations are serialized. The default timeout is 30 seconds, adjustable to 60 seconds. Code and text output each have a 64 KiB limit; image output has an 8 MiB limit. `reset`, timeout, cancellation of a running evaluation, process exit and output overflow discard the kernel and invalidate already queued code from that generation. Cancelling a queued evaluation only cancels that call before its code starts. A new evaluation waits for the previous kernel to exit. Ordinary JavaScript errors keep the kernel usable. Files, network effects and separately spawned processes remain; cancelled code is never retried. The kernel runs under the MCP session's account and policy and is not a sandbox.

For lifecycle acceptance, start a delayed evaluation that writes a completion file, close Yard's page, and reopen the same conversation. The file and a retained variable must show that the backend completed the operation. Closing the page does not unload the backend-owned MCP; stopping/unloading the session or backend discards its in-memory state.

After the standalone workflow passes, an old App-backed `mcp_servers.node_repl` entry can be disabled with its existing `enabled` setting. Retain its original values for rollback and update project instructions to call `yard_node`. Scripts that use private App RPC need migration to dedicated MCP tools. Removing the old entry or uninstalling the App is unnecessary for testing the replacement.

## Local file artifacts

Install a dedicated Python environment on the execution host, outside the plugin cache. For Linux:

```bash
python3 -m venv /absolute/path/to/yard-artifacts-venv
/absolute/path/to/yard-artifacts-venv/bin/python -m pip install -r "$yard_checkout/plugins/yard-artifacts/requirements.txt"
```

Use Python 3.11 or newer. On Windows, create the environment with `py -3 -m venv C:\path\yard-artifacts-venv`, then use its `Scripts\python.exe -m pip install -r ...`. Set `YARD_ARTIFACTS_PYTHON` to that interpreter in the environment available to the Codex execution tools, or put its absolute path in the project's instructions. Setting it only in a browser or an unrelated shell does not change the daemon's environment. The Skill uses the named interpreter; no Office MCP process is required.

The pinned dependencies provide `python-docx`, `openpyxl`, `python-pptx`, `reportlab`, `pypdf` and Pillow. Their [Word](https://python-docx.readthedocs.io/), [spreadsheet](https://openpyxl.readthedocs.io/), [presentation](https://python-pptx.readthedocs.io/), [PDF authoring](https://docs.reportlab.com/) and [PDF reading](https://pypdf.readthedocs.io/) documentation describes supported file features. Local templates are copied and reopened with the matching library, preserving relevant styles, slide masters and formulas.

For PDF export, layout inspection and formula calculation, install **Writer, Calc and Impress**, plus Poppler and suitable fonts. A `soffice` executable from `libreoffice-core` alone cannot load these file types. On Debian/Ubuntu:

```bash
sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress poppler-utils fonts-noto-cjk
```

On other systems, install [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) and a Poppler distribution supported by that environment, and make `soffice`, `pdftoppm` and `pdfinfo` available. `YARD_ARTIFACTS_SOFFICE` can name an absolute LibreOffice executable. These are file-based tools; a running Microsoft Office installation is unnecessary. Actual platform validation is recorded under Verification below.

Accept the setup by creating and reopening one `.docx`, `.xlsx`, `.pptx` and PDF, and editing a copy of a template. Recalculate a workbook containing `=SUM(B2:B3)` with inputs `20` and `22`, then reopen it with `openpyxl.load_workbook(..., data_only=True)` and expect `42`. `openpyxl` stores formulas without calculating them. Export the document and deck to PDF with a private LibreOffice profile, then render and inspect pages:

```bash
soffice -env:UserInstallation=file:///absolute/task/lo-profile --headless --convert-to pdf --outdir /absolute/task/rendered /absolute/task/document.docx
pdftoppm -png /absolute/task/rendered/document.pdf /absolute/task/rendered/document
```

Inspect the PNGs for clipping, missing glyphs and overlap. A successful save does not establish layout fidelity. Existing redlines, macros, SmartArt, animation and live/cloud documents require their own supported workflow and checks.

## Browser and Chrome

The public [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) works with standalone Chrome and Node. Register a pinned version in the same Codex home, for example with a separate headless browser profile:

```bash
CODEX_HOME="$yard_codex_home" codex mcp add chrome_devtools -- npx --yes chrome-devtools-mcp@1.12.0 --headless --isolated --no-usage-statistics --no-performance-crux
CODEX_HOME="$yard_codex_home" codex mcp list
```

Provide `--executablePath=/absolute/path/to/chrome` if Chrome is not found. The first `npx` run needs npm registry access; for a service with restricted network/PATH, install that pinned package in a stable private tool directory and register its entry point with an absolute standalone Node path. No App resource path is needed.

To operate an existing, authorized browser instead, use the server's `--browserUrl=http://127.0.0.1:9222` or supported `--autoConnect` setup. Remote debugging must already be enabled by the browser owner. Keep CDP on loopback and use a dedicated debugging profile; a WSL loopback address may refer to a different network namespace from Windows Chrome. Do not expose the debugging port or replace the user's default profile as a connection workaround.

Open a new conversation and perform a real navigation, snapshot, text fill and click on a disposable test page. A connection plus a list of tools does not verify browser control. Browser/Chrome Skills that call private App BrowserLib need to use this MCP's tools for the standalone workflow.

## Titles, notifications and remote connectors

The existing [title organizer installation guide](https://github.com/znbsf/codex-task-title-organizer/blob/main/INSTALL.md) provides its own marketplace:

```bash
CODEX_HOME="$yard_codex_home" codex plugin marketplace add znbsf/codex-task-title-organizer --ref main
CODEX_HOME="$yard_codex_home" codex plugin add codex-task-title-organizer@codex-task-title-organizer
```

It needs Python 3 with `sqlite3` on the execution host. Review and trust its specific Hooks through the backend's supported Hooks interface before expecting automatic checkpoints. Manual Skill availability and automatic Hook execution are separate checks. Follow the upstream upgrade/refresh procedure for loaded tasks; validate a successful title-tool call and its next checkpoint. Yard already hosts the session/title tools; no desktop App is needed for those calls.

Use [Yard Web Push](browser-notifications.md) for completion notifications. An old hook pointing into a versioned Windows App directory or private pipe is not part of Yard's notification setup.

`codex_apps` remote connectors and Yard's `codex_app` session tools have different owners. For a remote connector, register its documented MCP endpoint with `codex mcp add`, complete its supported OAuth flow and test one account-authorized read. Yard forwards native MCP/OAuth operations. Endpoint reachability, subscriptions and server-side authorization remain prerequisites; another machine's failed connection is not a known-good reference. Never copy another user's token store to repair access.

## Remove or undo an integration

In the same Codex home, use `codex plugin remove yard-node@codex-yard` (or the other package name) and `codex mcp remove chrome_devtools` for registrations created during setup. Remove the marketplace with `codex plugin marketplace remove codex-yard` only when no remaining packages use it. Existing loaded sessions can retain processes until unloaded. Retain user-created files, model credentials and unrelated configuration.

The built-in Computer mount is independently selected by Yard's `.env`; remove only its `YARD_COMPUTER_*` selection and start a new conversation to stop adding it. Plugin removal alone does not undo that explicit mount. Remove an artifact environment only after confirming it contains no deliverables or shared dependencies.

## Common connection failures

| Symptom | Check and action |
| --- | --- |
| Enabled plugin has no Skill/tool | Install in the selected host's actual Codex home, inspect `codex plugin list`, then verify a new conversation's inventory |
| Linux reports `Exec format error` for `npx.cmd` | Use Linux Node/npx for a Linux MCP such as Draw.io. A Windows `.cmd` launcher cannot execute directly as a Linux program |
| A tool points into a versioned Windows App or `/usr/lib/chatgpt` directory | Register its standalone executable/package instead; App upgrades can remove those installation paths |
| Windows Computer has no interactive desktop | Check the actual Windows process session and unlock state; a connected SSH session is commonly Session 0 |
| Screenshot coordinates do not match the intended screen | Read the returned driver/display and dimensions. WSLg/X11 and the Windows primary monitor are different targets |
| File generation works but export/recalculation fails | Verify the selected Python interpreter, Writer/Calc/Impress components, Poppler and fonts; inspect actual converted content |
| MCP gets HTTP 401/403, TLS failure or timeout | Verify that endpoint's account/authorization and route from the backend host. A successful npm/GitHub request does not verify another service |
| OAuth opens an unreachable loopback URL | Use the connector's supported callback/tunnel configuration on the backend host; the Yard browser and backend can be on different machines |

Preserve `enabled:false` and per-tool approval settings when reconnecting a service. Connection repair does not require changing the user's permission policy. WSL startup, inherited Codex-home permissions, SSH identities and missing old working directories are host-administration concerns; diagnose them in the actual service environment without rewriting them as plugin installation steps.

## Plugin management

The original Plugins page uses the selected execution host's Codex connection. Yard forwards marketplace addition/removal/upgrade, plugin listing/search/read/install/uninstall/reconciliation and sharing, Skill reads, MCP OAuth and MCP resource/tool/event requests. Codex owns package installation, configuration, credentials and MCP process lifecycle. Yard does not copy its plugin registry or token store.

An installation response means the backend accepted/completed that installation according to its native protocol. An interrupted write can already have changed the backend: Yard preserves the error and never replays it. Refresh the installed list before repeating a user operation. MCP completion and event notifications use the same host connection.

Open Plugins to install from an existing marketplace. Add the Yard checkout as a local marketplace to find its packages. A local path refers to the selected Codex host. Network marketplaces and services still require network access and, where applicable, a logged-in account.

OAuth callbacks execute on the backend machine. In a cross-device or SSH deployment, use the MCP server's supported callback configuration and an existing reachable HTTPS endpoint or tunnel. A loopback URL on the backend is not reachable merely because the remote browser can open Yard. App-specific plugins also need their actual host service; installing a package does not start that service.

## Linux Computer Use setup

Yard includes its own `yard-computer` MCP runtime under `plugins/yard-computer/`. Its default Linux driver uses X11 screen 0, `xdotool`, ImageMagick `import`, `xclip` and `flock` from util-linux. Select a local display such as `:0`, `:99` or `:99.0`. It has no dependency on Codex App binaries, private App sockets or an App browser window. Other X11 screens, native Wayland and macOS are outside the supported drivers.

Install the system tools on the machine that will run the desktop. On Debian/Ubuntu:

```bash
sudo apt install xdotool imagemagick xclip util-linux
```

In Yard's `.env`, explicitly select that machine's X11 display and, if needed, its authorization file:

```dotenv
YARD_COMPUTER_DISPLAY=:0
YARD_COMPUTER_XAUTHORITY=/path/to/.Xauthority
```

Start Yard normally and open a new local conversation with a model/provider that supports image inputs and tool calls. Ask it to take a Computer screenshot, then operate the application. The screenshot appears in the normal MCP tool result. The display selection remains on the Yard machine when a phone or another computer opens its web interface. Existing loaded conversations retain their original MCP configuration; use a new conversation to adopt the setting. Closing the web page leaves the daemon's tool process available for the conversation.

Yard passes explicit transport, environment and timeout fields for `mcp_servers.yard_computer` when starting/forking or cold-resuming local conversations. Native conversation tools and the scheduler use the same configuration source. Dotted field overrides preserve an existing `enabled:false` and per-server or per-tool approval policy. This works with an already-running daemon and leaves its saved global configuration intact. The built-in mount is controlled by Yard's display setting and the backend's `mcp_servers.yard_computer` settings, independently of installing or uninstalling the package. The package supplies the Skill and a standalone transport for other clients. An explicit same-name definition takes precedence over that package transport; configure the built-in server's policy under `mcp_servers.yard_computer`. SSH conversations use their execution host's configured tools; Yard does not redirect them to the server's local desktop.

A headless host needs a virtual desktop, plus the applications to control. For example, install `xvfb`, start a private X11 session using the host's normal session/access controls, and set `YARD_COMPUTER_DISPLAY` to its display number. Keep that session running with Yard. Tests use a temporary Xvfb display and a disposable browser; they never connect to the operator's desktop.

On a compositing X11 desktop, check that a screenshot includes a newly opened application before sending input. If ImageMagick omits that window, set `YARD_COMPUTER_IMPORT` to an executable wrapper that calls `import -descend "$@"`. The [`-descend` option](https://imagemagick.org/import/) reads the window hierarchy. This setting was needed for the deployed KDE X11 desktop on 2026-11-08; screenshots, clicks and Chinese text replacement then passed through the production Yard connection. A user-local ImageMagick installation can put its library/module environment in the same wrapper.

## Windows Computer Use setup

The same `yard_computer` MCP has an explicit Windows driver, using standalone **Windows Node >=24.5**, Windows PowerShell, .NET and public User32/GDI APIs on Windows 10 version 1703 or newer. Its process must belong to the signed-in, unlocked interactive desktop. SSH/service Session 0, UAC secure desktops and elevated target windows are unsupported. It captures and controls the **primary monitor** with physical pixel coordinates starting at its top left. Windows uses Unicode `SendInput` and leaves the clipboard untouched.

For a Linux/WSL Yard, make `plugins/yard-computer/` available at a stable Windows-readable location and explicitly configure both paths in Yard's `.env`:

```dotenv
YARD_COMPUTER_DRIVER=windows
YARD_COMPUTER_WINDOWS_NODE="/mnt/c/Program Files/nodejs/node.exe"
YARD_COMPUTER_WINDOWS_SERVER="C:/yard-tools/yard-computer/server.ts"
```

The copied folder needs `server.ts`, `desktop.ts`, `windows.ts` and a parent `package.json` with `"type":"module"`. Preserve that complete package when upgrading. A Windows-visible UNC path to the same source is also possible when the selected Node account can read it. `--driver=windows` is carried in the MCP argv because WSL environment variables do not automatically propagate into Windows programs.

Launching a Windows executable from WSL does not by itself grant access to the logged-in desktop. Verify the actual process session. If it runs in Session 0, arrange the service within the logged-in user's supported interactive-session setup before using this driver. The driver reports the condition and sends no input; it does not alter startup settings or attempt a session/security bypass. Yard's main server remains validated on Linux; this driver does not establish native Windows support for every Yard host feature.

When installing the plugin directly into a Windows Codex backend, select `YARD_COMPUTER_DRIVER=windows` in the MCP process environment or explicitly register `node C:\path\server.ts --driver=windows` as `yard_computer`. Use independent Node, a stable package path and the existing MCP approval policy. Keep only one active same-name transport definition.

Run `node scripts/verify-computer-windows.ts` from an **idle Windows desktop session** to exercise the real driver against its own temporary test window. It requires 60 seconds of initial desktop inactivity and stops if the window loses focus. Evidence stays in a temporary directory or `YARD_WINDOWS_EVIDENCE`; inspect its report and PNGs, then remove them. It does not change existing applications or clipboard data.

## Computer actions and failure behavior

The `computer` tool supports screenshots, mouse movement, single/double/triple clicks, dragging, text entry, key combinations, scrolling and a wait of up to two seconds. Coordinates use the full desktop's absolute pixels. Each successful operation returns a PNG plus the display, width and height; observe a screenshot before choosing coordinates. Input bounds and key names are checked before execution. Screenshots travel in tool results and are not written to disk by the runtime.

On Linux X11, ASCII text uses keyboard events in the focused application. Unicode text updates X11 PRIMARY with the new text, checks that it can be read back, then uses a middle click: click the editable target and keep the pointer over it. To replace text, select it and delete it with Backspace before typing. The application must support middle-click paste. PRIMARY keeps the new text, served by an xclip owner until another selection replaces it or the X session ends. This also lets slow applications read the text later. The runtime never writes the main CLIPBOARD, including its images and rich text. Each call accepts at most 1000 characters; split longer text across calls.

The Node MCP adapter communicates over stdio. The daemon owns tool approvals and process lifetime. The runtime preserves the session's approval rules. A per-X-server OS lock serializes the complete action and following screenshot across separate MCP processes, so two conversations cannot interleave a drag. Another conversation can change the screen between calls; take a fresh observation when switching tasks. A crashed parent releases its lock through pipe closure.

MCP cancellation aborts the matching request while it is queued, waiting for a desktop lock or executing a command. Each input command checks cancellation before starting. Closing the stdio session or a normal SIGTERM/SIGINT cancels pending calls, interrupts child commands and lets a drag release its mouse button before releasing the display lock. A hard process kill or machine failure can interrupt that cleanup; inspect the desktop before continuing after such a failure.

Input is never retried. If an input command or its following screenshot fails, the result states that the desktop may already have changed. Inspect a new screenshot before deciding whether to repeat an action. A drag attempts to release its mouse button even after an intermediate failure. Missing dependencies, display access and unsupported platforms produce explicit errors without falling back to another desktop.

Cancellation stops further input and waits for child-process and mouse-button cleanup. Pointer movements, text already entered and changes to PRIMARY remain in effect.

Windows serializes complete input-and-screenshot calls with a per-session named OS mutex. Each finite helper checks cancellation before submitting input and while waiting; it attempts key/button release after a partial `SendInput` result. Cancellation waits for helper exit and mutex cleanup, with a five-second forced-stop fallback if the helper is stuck. Hard termination can interrupt cleanup. Input and its effects are never rolled back or replayed; take a fresh screenshot after failure. Two conversations can still change the desktop between calls.

## Verification

`npm run typecheck` and `npm test` cover the protocol bridge, MCP framing and failures, explicit desktop configuration and the driver contract without a graphical session or App installation. `npm run test:plugins:cli` checks plugin installation/removal and Skill/MCP loading in an isolated real CLI home. `npm run test:computer:cli` additionally needs Xvfb, ImageMagick, xdotool, xclip and Chromium. It checks a disposable desktop, image delivery and actual mouse/keyboard effects through an isolated CLI and a scripted local model provider. These checks use no personal model account or conversations.

For release validation, run the checks from a clean checkout while masking the desktop App installation directories. Record the actual CLI version separately from the pinned UI version. Real account OAuth, platform-specific plugins and a user's physical desktop require their own environment validation.

On 2026-11-21, a clean source export including the latest local main changes, with `/usr/lib/chatgpt`, `/opt` and the user's plugin cache masked, passed type checking, all **429 portable tests** and **11 real CLI/plugin/UI lifecycle checks**, using standalone Node `24.16.0` and Codex CLI `0.169.1`. Persistent JavaScript and an image result passed; an already-started evaluation completed after the Yard WebSocket disconnected, and its variable survived reconnection. Direct MCP calls used no model account or model request.

The public Chrome DevTools MCP `1.12.0`, registered through `codex mcp add` in a disposable CLI home, passed actual navigation, snapshot, text fill and button click against a local fixture under the same App/cache masks. Python `3.14.2` with the pinned artifact dependencies created and reopened all four file types, reused Word/PPT templates, recalculated the spreadsheet total to `42`, and exported documents/slides with LibreOffice `24.2.7.2`. Poppler page PNGs were visually inspected, including Chinese text. The Office validation used isolated public packages and rendering components.

Windows 11 with standalone Windows Node `24.11.1` and PowerShell `5.1.26100.9818` passed a `2560 × 1440` primary-monitor screenshot, Unicode input, a received Ctrl+A shortcut and selection replacement, wheel events, click, drag, cancellation and subsequent mutex recovery in the temporary WinForms fixture. The clipboard sequence stayed unchanged. Node filesystem permissions were restricted to the temporary test tree; the helper used Windows system APIs. The App remained installed during this Windows run, and neither its process nor the deployed Yard was stopped. Linux X11's earlier physical/virtual desktop acceptance remains recorded below; no new X11 behavior was added in this change.

On 2026-11-08, a clean checkout with `/usr/lib/chatgpt` and `/opt` masked passed type checking, all 209 tests, the seven plugin lifecycle/UI checks and the real CLI computer checks. Codex CLI `0.164.0` and reference UI `26.1013.40934` completed 20 consecutive Unicode replacements, 15 image-bearing MCP calls, display actions, policy preservation and continuation after the Yard connection closed. PRIMARY remained readable 300/500 ms after input; the main CLIPBOARD PNG stayed intact. The model provider and desktop were isolated fixtures; no personal account or physical desktop was used.
