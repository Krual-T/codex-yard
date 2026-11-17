# Standalone plugins and Computer Use

Yard is an independent Codex client and capability host. Build, startup, conversations, plugin management and supported Computer Use must work with Codex App absent or closed. Node, the Codex CLI, the configured model provider and each plugin's documented system dependencies remain prerequisites. Checked-in App UI resources provide the reference interface; Yard supplies the runtime services.

## Plugin management

The original Plugins page uses the selected execution host's Codex connection. Yard forwards marketplace addition/removal/upgrade, plugin listing/search/read/install/uninstall/reconciliation and sharing, Skill reads, MCP OAuth and MCP resource/tool/event requests. Codex owns package installation, configuration, credentials and MCP process lifecycle. Yard does not copy its plugin registry or token store.

An installation response means the backend accepted/completed that installation according to its native protocol. An interrupted write can already have changed the backend: Yard preserves the error and never replays it. Refresh the installed list before repeating a user operation. MCP completion and event notifications use the same host connection.

Open Plugins to install from an existing marketplace. Add the Yard checkout's `.agents/plugins/marketplace.json` as a local marketplace to find `yard-computer`. A local path refers to the selected Codex host. Network marketplaces and services still require network access and, where applicable, a logged-in account.

OAuth callbacks execute on the backend machine. In a cross-device or SSH deployment, use the MCP server's supported callback configuration and an existing reachable HTTPS endpoint or tunnel. A loopback URL on the backend is not reachable merely because the remote browser can open Yard. App-specific plugins also need their actual host service; installing a package does not start that service.

## Computer Use setup

Yard includes its own `yard-computer` MCP runtime under `plugins/yard-computer/`. It uses Linux X11 screen 0, `xdotool`, ImageMagick `import`, `xclip` and `flock` from util-linux. Select a local display such as `:0`, `:99` or `:99.0`. It has no dependency on Codex App binaries, private App sockets or an App browser window. Other X11 screens, native Wayland, macOS and Windows desktop control are outside this runtime's supported platforms.

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

## Actions and failure behavior

The `computer` tool supports screenshots, mouse movement, single/double/triple clicks, dragging, text entry, key combinations, scrolling and a wait of up to two seconds. Coordinates use the full desktop's absolute pixels. Each successful operation returns a PNG plus the display, width and height; observe a screenshot before choosing coordinates. Input bounds and key names are checked before execution. Screenshots travel in tool results and are not written to disk by the runtime.

ASCII text uses keyboard events in the focused application. Unicode text updates X11 PRIMARY with the new text, checks that it can be read back, then uses a middle click: click the editable target and keep the pointer over it. To replace text, select it and delete it with Backspace before typing. The application must support middle-click paste. PRIMARY keeps the new text, served by an xclip owner until another selection replaces it or the X session ends. This also lets slow applications read the text later. The runtime never writes the main CLIPBOARD, including its images and rich text. Each call accepts at most 1000 characters; split longer text across calls.

The Node MCP adapter communicates over stdio. The daemon owns tool approvals and process lifetime. The runtime preserves the session's approval rules. A per-X-server OS lock serializes the complete action and following screenshot across separate MCP processes, so two conversations cannot interleave a drag. Another conversation can change the screen between calls; take a fresh observation when switching tasks. A crashed parent releases its lock through pipe closure.

MCP cancellation aborts the matching request while it is queued, waiting for a desktop lock or executing a command. Each input command checks cancellation before starting. Closing the stdio session or a normal SIGTERM/SIGINT cancels pending calls, interrupts child commands and lets a drag release its mouse button before releasing the display lock. A hard process kill or machine failure can interrupt that cleanup; inspect the desktop before continuing after such a failure.

Input is never retried. If an input command or its following screenshot fails, the result states that the desktop may already have changed. Inspect a new screenshot before deciding whether to repeat an action. A drag attempts to release its mouse button even after an intermediate failure. Missing dependencies, display access and unsupported platforms produce explicit errors without falling back to another desktop.

Cancellation stops further input and waits for child-process and mouse-button cleanup. Pointer movements, text already entered and changes to PRIMARY remain in effect.

## Verification

`npm run typecheck` and `npm test` cover the protocol bridge, MCP framing and failures, explicit desktop configuration and the driver contract without a graphical session or App installation. `npm run test:plugins:cli` checks plugin installation/removal and Skill/MCP loading in an isolated real CLI home. `npm run test:computer:cli` additionally needs Xvfb, ImageMagick, xdotool, xclip and Chromium. It checks a disposable desktop, image delivery and actual mouse/keyboard effects through an isolated CLI and a scripted local model provider. These checks use no personal model account or conversations.

For release validation, run the checks from a clean checkout while masking the desktop App installation directories. Record the actual CLI version separately from the pinned UI version. Real account OAuth, platform-specific plugins and a user's physical desktop require their own environment validation.

On 2026-11-08, a clean checkout with `/usr/lib/chatgpt` and `/opt` masked passed type checking, all 209 tests, the seven plugin lifecycle/UI checks and the real CLI computer checks. Codex CLI `0.164.0` and reference UI `26.1013.40934` completed 20 consecutive Unicode replacements, 15 image-bearing MCP calls, display actions, policy preservation and continuation after the Yard connection closed. PRIMARY remained readable 300/500 ms after input; the main CLIPBOARD PNG stayed intact. The model provider and desktop were isolated fixtures; no personal account or physical desktop was used.
