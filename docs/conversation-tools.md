# Conversation tools in App and Yard

Register the shared `codex_yard` MCP once on the machine running Codex. App and Yard must use that machine's same Codex home and daemon. The stdio process runs independently of the Yard HTTP server and desktop window. Yard leaves the native `codex_app` configuration to the desktop App.

Use a stable checkout with Node.js 24.5 or later and its dependencies installed. The registered path must remain available after closing your development worktree. Inspect an existing `codex_yard` definition before changing it; do not register a second copy under another name.

```bash
codex mcp add codex_yard -- node /absolute/path/to/codex-yard/scripts/conversation-mcp.ts
```

The launcher starts or reuses the Codex CLI daemon. `AGENTS_CODEX_BIN` selects the CLI executable. An explicit `AGENTS_CODEX_SOCKET` connects to a particular daemon without starting another one. For SSH conversations, install and register the MCP on that execution host with host-local paths; a local registration cannot forward itself to a remote daemon.

Configure approval for these tools in the same user-level `config.toml`. The following keeps approvals for creating and sending to another conversation, while allowing reads and the current conversation's title. It does not change the session's approval policy or permissions.

```toml
[mcp_servers.codex_yard]
command = "node"
args = ["/absolute/path/to/codex-yard/scripts/conversation-mcp.ts"]
startup_timeout_sec = 20
default_tools_approval_mode = "prompt"

[mcp_servers.codex_yard.tools.list_projects]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.list_threads]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.read_thread]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.wait_threads]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.set_thread_title]
approval_mode = "approve"
```

With `approval_policy = "never"`, tools that require a prompt are rejected. To use `create_thread` and `send_message_to_thread`, choose a session policy that permits approval, or explicitly approve those two tools in user configuration. Registration never enables those writes without an approval decision.

| Tool | Behavior |
| --- | --- |
| `list_projects` | Pages through Codex native projects on this host. Yard's saved directories remain separate. |
| `list_threads` | Lists unarchived main conversations and their status, with a continuation cursor. |
| `read_thread` | Reads a bounded page of history without resuming the target. Outputs are omitted by default; truncated text and continuation cursors are explicit. |
| `set_thread_title` | Renames the calling conversation only, using MCP caller metadata. |
| `create_thread` | Requires a title and first message. Inherits the caller's directory and the daemon's model and permission defaults; returns the new identity even after a later naming or submission failure. |
| `send_message_to_thread` | Sends once to another main conversation. The daemon starts a turn or adds input to its active turn, retaining its settings. An uncertain result must be checked in history before retrying. |
| `wait_threads` | Returns all states when any target is no longer active or needs attention. Unloaded, idle, error and timeout remain distinct. Cancellation does not interrupt targets. |

Apply changed MCP configuration using the app-server `config/mcpServer/reload` RPC. Loaded conversations refresh at a turn boundary; a running turn continues with its current tools. Check `mcpServerStatus/list` with the target `threadId`, `serverName: "codex_yard"` and `detail: "toolsAndAuthOnly"`: expect `runtimeStatus: "connected"`, no tools error, and seven tools. Refreshing a browser page alone does not perform this backend reload.

To roll back the registration:

```bash
codex mcp remove codex_yard
```

Then reload MCP configuration again. This leaves conversation history and native App tools intact. The source change also keeps Yard's existing private pipe alive for already loaded older conversations; newly started or resumed conversations use the shared registration.

For an isolated backend check, build the host and run:

```bash
npm run build:host
node scripts/verify-shared-mcp.ts
```

This uses a temporary Codex home, a separate real CLI backend and a local scripted model provider. It exercises reload during an active turn, both client orders, simultaneous joins, real MCP call metadata, active-turn input, native MCP preservation and calling shared tools after Yard shuts down. It never opens user conversations or calls an external model. Validated with Codex CLI **0.164.0**, Node **24.16.0** and the checked-in **26.1013.40934** adapter. App-shaped clients in this probe do not constitute a desktop GUI test.
