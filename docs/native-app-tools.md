# Native conversation tools

Yard previously exposed four handwritten conversation tools. It now runs twelve
tools in a permanent Node host, using the shipped App's catalog, strict schemas,
history projection, wait kernel, Markdown formatting, model validation, ancestry
and delegation-input constructor. A thread created through Yard can be continued
by another client while retaining its tools, including after all Yard pages close.

This change covers the local-daemon conversation tools. Full App service parity,
recovery of already-loaded obsolete mounts and native Windows UI testing remain
separate release requirements described below.

## Execution and copied-code boundary

The unmodified official `codex-app-tools/server.mjs` connects to the private
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
directory. Normal builds use the checked-in kernel and do not need to extract or
load the full UI. The kernel's own vendor directory survives removal of the old
renderer snapshot.

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

An isolated CLI 0.164.0 experiment confirmed that both global
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
This patch does not silently edit that file or restart a shared daemon. Existing
obsolete mounts require a coordinated idle migration; the public protocol has no
guarded immediate unload RPC. A shared daemon restart must wait for all affected
work to finish and explicit deployment approval.

## Service boundaries

The native schemas also describe managed-worktree and ChatGPT Work variants.
Those branches return explicit unavailable-service errors in this host. Managed
worktree ownership, desktop navigation/terminals, ChatGPT/cloud conversations,
automations and plugin-management services are not supplied by this kernel.
Remote daemon tool injection is not yet installed; existing remote mounts are
preserved. No unsupported desktop/cloud tools are advertised as executable.

The original Windows App keeps its own full implementation. The isolated test
models its protocol client; a real Windows App interaction has not been verified.

## Verification and rollout

Run `npm run typecheck` and `npm test`. Targeted tests exercise original schema
limits, paginated history, wait cursors, commentary/cancellation, destination
settings, business-call deduplication, offline-host isolation, cold-target
injection, model validation and read-state conflicts.

`node scripts/verify-app-tool-reload.ts` starts an isolated real CLI daemon with a
private temporary Codex home and local synthetic Responses endpoint. It exercises
all twelve tools through the official adapter, cross-client continuation, closed
Yard pages, preservation of a healthy native mount and the old-mount lifecycle.
It uses no account, personal conversations or shared services and removes its
temporary state on exit.

Before activation, review the exact source commit, stable socket/adapter paths,
daemon configuration diff, affected loaded threads and available idle window.
Back up the prior configuration. Rollback restores that configuration and Yard
source, then follows the same idle migration boundary. Durable conversations are
preserved; uncertain writes are inspected rather than retried.
