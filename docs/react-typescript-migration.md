# React + TypeScript migration boundaries

The first migration keeps the pinned App 26.1013.40934 application, transport,
services and React tree. Two existing leaves now render from project-authored
TypeScript source. This is incremental reconstruction of the shipped behavior;
the upstream App's original TSX source is not available.

| Boundary | Authored source | Existing caller and retained dependencies |
| --- | --- | --- |
| Relative time presentation | `src/renderer/sidebar/relative-time.tsx` | `app-initial`'s `YEc` / exported `j$`; official clock `vIa`, locale `ca`, calendar calculation `VEc`, localized message `W`, and the original React object `AIa` |
| User message disclosure | `src/renderer/messages/collapsible-user-message-content.tsx` | `collapsible-user-message-content`'s `C` / exported `t`; official measurement/collapse hook, print atom, search registration, Markdown preview context, button, localized messages, icons and React object `E` |

The timestamp entry is shared by local and remote sidebar rows, pending worktree
rows, hover cards and other lazy pages. The same defaults, message identifiers,
relative formatting options and clock subscriptions apply to those consumers.
Several sidebar layouts hide inline timestamps. The existing conversation hover
card exposes the timestamp in those layouts; this migration keeps that behavior.
The message entry is used by local, remote and pending user messages and static
transcripts. Its parent still renders Markdown, links, host context and message
actions. It retains code block clipping, print restoration, search reveal and
hidden controls' accessibility handling.

## File ownership

| Area | Responsibility |
| --- | --- |
| `src/renderer/sidebar/` | Stateless list presentation; upstream services supply time, locale and business data |
| `src/renderer/messages/` | Message display leaves; upstream services own conversation and disclosure state |
| `src/renderer/components.ts` | Explicit exports of the two component factories |
| `src/native/renderer-migration.ts` | The two pinned, uniquely matched function seams |
| `src/native/server.ts`, `src/native/visualizations.ts`, `scripts/build-native.ts` | Resource delivery, cache namespace and authored component build |
| `test/renderer-*.test.ts`, `scripts/verify-renderer-migration.ts` | Boundary checks and isolated page verification |

The two development areas have separate source branches; shared integration is
owned by the migration manager. A status-badge candidate remains on its source
branch for a later batch with PR metadata fixtures.

## Runtime integration

The server adapts only its responses for the two fixed function boundaries.
It verifies the exact function start/end boundaries match once before substituting a small wrapper;
`vendor/codex-app/` and its notices remain unchanged. Unrelated functions and
exports stay upstream. A missing or ambiguous upstream boundary fails and requires
an explicit migration update.

Each wrapper creates its authored component once, passes the original initialized
React and service objects, and renders that component through the existing JSX
runtime. There is no additional React root, dispatcher, conversation store or
DOM overlay. The build rejects runtime React imports in the authored component
bundle. The `web-renderer-v2` namespace keeps older immutable resource caches
from bypassing these seams; bootstrap, preloads and lazy imports use that same
namespace.

## Validation

Run `npm run typecheck` and `npm test`. The portable suite covers the pinned seam
guards and source components, alongside the existing resource and MCP adapter
checks. The message component also exercises DOM observers and cleanup when an
isolated Chrome executable is available; its DOM check skips on machines without
that executable.

After building, run `npm run test:renderer-migration:ui` with the existing UI
validation lock. It uses the real pinned renderer with disposable protocol data
and a fresh headless browser. Set `AGENTS_TEST_CHROMIUM` when needed and
`AGENTS_TEST_CONFIGURATION_SNAPSHOT` to an authorized local bootstrap snapshot
for offline configuration. `AGENTS_MIGRATION_EVIDENCE` selects the private output
directory. No personal sessions, shared daemon or default model are changed.

The script checks the actual React fiber names in the existing page, one authored
module load, the existing sidebar hover card, disclosure expansion/collapse, upstream print-state restoration,
code copy, reload and desktop/tablet layouts. Account-backed validation and clean
checkout startup are recorded separately with their actual CLI/backend versions;
App 26.1013.40934 identifies the resource reference, not the daemon version.

## Later batches

Project/thread selection, ordering, drag interactions, menus, PR metadata,
conversation state, Markdown rendering and the composer remain upstream. Future
batches should follow an existing prop/service boundary and prove that the
authored component is used by the actual page before expanding the scope.
