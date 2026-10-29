# Native conversation tools

Yard previously exposed four handwritten conversation tools. It now runs twelve
tools in a permanent Node host, using the shipped App's catalog, strict schemas,
history projection, wait kernel, Markdown formatting, model validation, ancestry
and delegation-input constructor. A thread created through Yard can be continued
by another client while retaining its tools, including after all Yard pages close.

This change covers conversation tools on the execution host's daemon. An explicit
registration lets Windows App, Linux App and Yard share that host. Native Windows
UI testing and migration of production conversations remain release checks.

## Execution and copied-code boundary

The unmodified official adapter, copied to
`vendor/native-app-tools/26.1013.40934/server.mjs`, connects to the private
`${dataDir}/app-tools.sock` pipe supplied by `lib/app-tools.ts`. The permanent
`lib/native-app-tools.ts` host routes business I/O through existing
`CodexConnection` transports and Yard project/state services. Browser pages do
not own tool calls.

`vendor/native-app-tools/26.1013.40934/portable-tools.mjs` is a bounded generated
closure from App 26.1013.40934's original compiled modules. It imports no renderer
and runs without a desktop installation or DOM. The sole platform substitution
inside the closure replaces the browser HTML-entity decoder with
`entities.decodeHTMLStrict`. Upstream files remain unchanged. Its provenance and
copyright boundary are in `THIRD_PARTY.md`.

Regenerate from the pinned upstream snapshot with:

```sh
node scripts/extract-native-tools.ts
```

An optional first argument supplies an extracted snapshot's `webview/assets`
directory. The extractor generates the kernel and copies the official adapter.
Normal builds use these checked-in artifacts and do not need to extract or load
the full UI. Their vendor directory survives removal of the old renderer snapshot.

The catalog contains `list_projects`, `create_thread`, `fork_thread`,
`list_threads`, `list_archived_threads`, `read_thread`, `wait_threads`,
`send_message_to_thread`, `set_thread_pinned`, `set_thread_archived`,
`set_thread_title` and `set_thread_read_state`.

## Calls, concurrency and cancellation

The original MCP adapter supplies the caller host, thread, turn and business
call ID. A bounded host cache retains the same execution promise for a repeated
business call, including an uncertain write result. Transport IDs never replace
the business ID, and a reconnect never triggers an automatic write retry.

Sending uses the native delegation constructor: supported servers receive
`toolOutput` in namespace `codex_app`; older versions receive the original text
envelope. `turn/start` handles idle and active destinations atomically. Omitted
model/effort overrides preserve destination settings. The original root-turn ID
is read from the caller rather than invented from its current turn. Self sends
and native ancestor sends are refused.

History reads remain passive. The copied wait kernel retains its generation and
revision cursors, final-text suppression and commentary filtering. Cancellation
stops the caller's wait without interrupting the target turn. Single-thread
lookups and waits connect only their preferred/declared host; fallback discovery connects
additional hosts only when needed. Explicit destination hosts cannot silently
redirect a write to another machine.

Pin writes use Yard's durable `pinned-thread-ids` state and serialize persistence.
A queued write checks cancellation immediately before mutation; persistence
failure restores the affected state. Pins belong to this Yard instance, and do
not synchronize Windows App preferences. Read state uses CLI 0.164.0's actual
`thread/readState/update` operation with `expectedRevision`; a conflict returns
an error without retrying or claiming success.

## Mount lifecycle and existing conversations

New local starts and forks carry the stable Yard host configuration. Resuming or
sending to an unloaded local thread also supplies that configuration. Already
loaded threads retain their existing mount, preserving a healthy native App
connection and its settings.

With stdio mounts, an isolated CLI 0.164.0 experiment confirmed that both global
`config/mcpServer/reload` and loaded-thread `thread/resume` overrides retain an
explicit per-thread MCP definition. A disabled definition stays disabled.
Changing `thread_unload_delay_secs` through resume also leaves the loaded
runtime's original retention setting in effect. Therefore these operations are
not an immediate migration mechanism for already-loaded obsolete mounts.

Cold resume adopts the stable host after the last client unsubscribes and the
daemon unloads the idle thread. The verification uses
`thread_unload_delay_secs=0` only inside a disposable Codex home to make this
boundary observable. The default delay is 1800 seconds, and active work or other
subscribers keep a thread loaded. No production retention setting is changed.

For permanent availability across local App/CLI creation, a deployment must also
register the stable `codex_app` definition in that daemon's user configuration.
Existing obsolete mounts require a coordinated idle migration; the public
protocol has no guarded immediate unload RPC. A shared daemon restart must wait
for all affected work to finish and explicit deployment approval.

## Explicit registration for App and Yard

Start the new Yard Node host against the intended daemon and a stable private
data directory. Inspect the proposed registration with the same settings:

```sh
npm run tools:configure -- --socket /absolute/path/to/app-server-control.sock --data-dir /absolute/path/to/private/data
```

This command reads the live tool catalog and the daemon's base user configuration.
Its JSON output contains the proposed `codex_app` definition, the configuration
path and a `hostReady` result. It does not write configuration. Use the deployed
checkout and permanent adapter/data paths, since the resulting entry must survive
task-worktree removal.

After reviewing that plan, append `--apply` to install it. The command requires
all twelve tools to be available. It refuses to replace a different explicit
`codex_app` entry. Before adding a new entry it saves a private mode-0600 copy of
the configuration under `$CODEX_HOME/backups/`, then uses `config/batchWrite`
with the daemon's configuration version. New and cold-resumed threads read it.
Other settings remain in place. Repeating an identical registration is harmless.
An uncertain write is reported for inspection and never retried automatically.
Neither mode resumes a conversation or restarts a shared service.

The command leaves loaded MCP runtimes in place. CLI 0.164.0's global MCP reload
can merge an old per-thread HTTP `url` with the new stdio transport fields and
reject the mixed definition. Registration therefore avoids that global reload;
the integration probe preserves an already-loaded HTTP mount while new threads
receive the stdio default.

The remote `buildMcpCodexConfig` branch in shipped Windows App 26.1023.6123.0 and
Linux App 26.1013.40934 checks the execution host's saved configuration. When
`mcp_servers.codex_app` exists, that branch skips desktop-supplied native tool
injection. This permits the explicit same-name definition above to serve SSH
conversations without changing either App binary. This behavior was checked in
the shipped code; the integration probe models App protocol clients.

Connect Windows App to the execution host over SSH. A Linux App on that host can
connect directly to the same daemon using `CODEX_APP_SERVER_WS_URL`, retaining
its local projects. Yard connects to the daemon's Unix socket. CLI 0.164.0 gives
an explicit server definition precedence over a same-name plugin registration;
the integration probe installs an enabled `codex-app-tools@openai-bundled` fixture
and verifies the change from its original tool to all twelve registered tools.
See the [versioned CLI registration rules](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/codex-mcp/src/catalog.rs).
All clients then address the same thread IDs and server-side tool host. A normal
Linux App launch without a shared-daemon endpoint can still start a separate
stdio backend. Windows-local projects use their own execution host.

Closing a desktop App or all Yard pages leaves the Node tool host running.
Stopping that Node process stops tool service until it restarts. Run the host
under the deployment's process supervisor with the same data directory and
socket path. The official adapter reconnects on the next explicit call after a
host restart; an in-flight write is not automatically repeated.

For rollback, remove only this registered entry with `codex mcp remove codex_app`
using the same Codex home. New and cold-resumed threads read that change. Consult
the private backup to restore the prior entry if needed; preserve unrelated
configuration changes. Existing loaded conversations follow the idle migration
boundary described above in either direction.

## Service boundaries

The native schemas also describe managed-worktree and ChatGPT Work variants.
Those branches return explicit unavailable-service errors in this host. Managed
worktree ownership, desktop navigation/terminals, ChatGPT/cloud conversations,
automations and plugin-management services are not supplied by this kernel.
Remote daemon tool injection is not yet installed; existing remote mounts are
preserved. No unsupported desktop/cloud tools are advertised as executable.

The original Windows App also contains its own full implementation. The isolated
test models its protocol client. A read-only check of Windows App 26.1023.6123.0's
running native pipe returned 32 default tools and 44 tools for `threadStartKind:
"all"`. That catalog check did not execute its business tools or verify Windows
UI continuation. It is a newer App version than the copied kernel.

## Verification and rollout

Run `npm run typecheck` and `npm test`. Targeted tests exercise original schema
limits, paginated history, wait cursors, commentary/cancellation, destination
settings, business-call deduplication, offline-host isolation, cold-target
injection, model validation and read-state conflicts.

`node scripts/verify-app-tool-reload.ts` starts an isolated real CLI daemon with a
private temporary Codex home and local synthetic Responses endpoint. It exercises
all twelve tools through the official adapter, cross-client continuation, closed
Yard pages, preservation of a healthy native mount and the old-mount lifecycle.
It also exercises the configuration command, preservation of unrelated settings,
private backups, new threads from global configuration, three simultaneous
clients, precedence over a real enabled plugin fixture, removal of a simulated
Windows tool host, idle migration and stable-pipe
reconnection with durable pins after the Node host restarts.
It uses no account, personal conversations or shared services and removes its
temporary state on exit.

The implementation at `b041c8f4` passed typecheck and all 154 portable tests.
A fresh detached checkout with offline-installed dependencies repeated those
checks and the real CLI 0.164.0 probe while the entire desktop installation was
hidden by a mount namespace. The probe also verified a model-generated native
MCP call with real caller metadata, simultaneous App/Yard subscriptions and
delegation while a target response was held: the same running turn remained
in progress and subsequently completed successfully.

Before activation, review the exact source commit, stable socket/adapter paths,
daemon configuration diff, affected loaded threads and available idle window.
Back up the prior configuration. Rollback restores that configuration and Yard
source, then follows the same idle migration boundary. Durable conversations are
preserved; uncertain writes are inspected rather than retried.
