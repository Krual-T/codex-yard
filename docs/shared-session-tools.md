# Shared conversation tools

Codex App and Yard share persistent conversations through the Codex daemon. Opening a conversation in either client must preserve its identity, active turn and native tool configuration. Common conversation tools must remain available when the other client is closed.

The existing Yard host injects its private four-tool `mcp_servers.codex_app` definition when starting a thread or resuming an unloaded thread. Already loaded threads retain their earlier configuration. The installed App also owns the `codex_app` definition and its private native pipe. Using this name for both hosts makes availability depend on the client that loaded the thread first.

## Runtime ownership

Register one user-configured MCP named `codex_yard`, using a repository TypeScript entry point. Codex starts it as a normal stdio MCP process. It connects to the same daemon using the existing `CodexConnection` and reuses `createAppTools` and the pinned adapter for MCP transport. No HTTP server or browser tab is required. The process owns only its connection, temporary adapter pipe and adapter child; it never stops the shared daemon.

Yard stops injecting `mcp_servers.codex_app` into `thread/start`, `thread/fork` and `thread/resume`. It keeps its existing pipe handler for already loaded conversations until those references expire naturally. Native App tools remain owned by the App. Both clients load the shared `codex_yard` server from the same user configuration. The adapter's internal `codex_app` descriptor namespace is a transport detail; the registered MCP server name gives the model the distinct `mcp__codex_yard__*` names.

The tool entry point uses an explicit socket when supplied, otherwise asks the installed Codex CLI to start or reuse its daemon. It must not fall back to a second stdio backend or another Codex home. Remote sessions need the same installation on their execution host; this change does not install or forward local filesystem paths to SSH hosts.

## Conversation operations

Reuse the existing current-thread title handler and add a daemon-backed tool handler for `list_projects`, `list_threads`, `read_thread`, `create_thread`, `send_message_to_thread` and `wait_threads`. Operations target the current execution host. Caller identity comes from MCP metadata. Tool descriptions distinguish a persistent main conversation from a subagent. Shared `list_projects` uses `project/list`, returning Codex native projects and their continuation cursor. The existing HTTP tools retain the separate Yard directory list; the two sources are not merged.

Reads use daemon RPCs, bounded pagination and output limits. `read_thread` uses metadata-only `thread/read` and `thread/items/list`, whose 0.164 protocol supports items across the entire thread. It never resumes its target. Pages default to 60 items, at most 100, in descending order, with a continuation cursor. Text fields are capped at 4,000 characters by default and 20,000 when requested, with a 200,000-character text budget for the whole page; truncated fields are marked. Command and tool output is omitted by default. Creation requires a title and first message: an empty thread may not yet have a rollout that another client can resume. The handler submits the first turn directly on the connection that created it. A created thread inherits the caller's working directory unless the caller explicitly supplies an absolute directory; it uses the daemon's configured permissions and model defaults. Optional model and reasoning settings are applied only when explicitly supplied. Creation returns the new identity even if a subsequent title or prompt operation fails, so the caller can recover without creating a duplicate.

Sending resumes the target without MCP or model overrides, then makes exactly one `turn/start` submission. The daemon atomically starts a new turn or adds input to the existing active turn; the result returns the actual `turn.id`. There is no read-then-steer decision. A transport timeout or disconnect after a write is reported as uncertain and is never automatically retried. Self-send is rejected. Waiting returns all target states when any target stops being active or needs attention, or after cancellation or a timeout of at most 30 seconds. `idle`, `notLoaded`, errors and timeout remain distinct; unloaded does not imply completion. Cancellation never interrupts a target.

## Activation and rollback

The repository documents the exact `codex mcp add codex_yard` command and its rollback, `codex mcp remove codex_yard`. Registration is explicit and does not replace a pre-existing server configuration. After registration, `config/mcpServer/reload` queues the new server for loaded conversations; the effect on a running turn must be verified against the actual supported CLI. No task is interrupted or daemon restarted to activate the server. Existing runtime overrides may require a later unload/reload; activation reports actual per-thread readiness rather than assuming the reload applied.

Persistent user configuration is activated only after a concrete configuration, verification result and rollback command are available for approval. Public commits contain no user paths, conversations or credentials.

Approval is scoped per tool: reads and the current title may be approved; creation and cross-conversation sending keep `prompt` by default. Under `approval_policy = "never"`, prompting tools are rejected. The isolated probe verifies the explicit title approval with that policy. No blanket `approve` is inherited from the old private pipe definition. See [configuration and rollback](conversation-tools.md) for the exact registration.

## Verification

Exercise App-shaped and Yard-shaped clients against one disposable daemon: create and resume in both orders, open simultaneously, keep the active turn, and verify the native MCP configuration is unchanged. Test shared MCP calls with real metadata, caller and target identity, bounded history, simultaneous sends, uncertain writes and adapter cancellation. Close the Yard host while shared tools remain callable. Run repository type checking and tests. Use a clean exported checkout with desktop resources unavailable for standalone verification; record the actual CLI and App resource versions separately.

The real CLI probe uses an isolated Codex home and a local scripted provider. It verifies model-visible tools and calls before and after MCP reload without sending personal data or creating user conversations. App process behavior is checked against the installed App's native MCP configuration code; synthetic clients do not count as a full desktop UI test.

Independent design review accepted the distinct server and existing transport reuse, and required one submission path, native project-list semantics and explicit bounded read/wait results. Those changes are included. The read path uses the protocol's cross-thread item pagination directly, avoiding an additional turn-list query whose result would not be consumed.
