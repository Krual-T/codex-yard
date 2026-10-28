# React + TypeScript migration boundaries

The migration keeps the pinned App 26.1013.40934 application, transport,
services and React tree. The boundaries below render from project-authored
TypeScript source. This is incremental reconstruction of the shipped behavior;
the upstream App's original TSX source is not available.

| Boundary | Authored source | Existing caller and retained dependencies |
| --- | --- | --- |
| Relative time presentation | `src/renderer/shared/relative-time.tsx` | `app-initial`'s `YEc` / exported `j$`; official clock `vIa`, locale `ca`, calendar calculation `VEc`, localized message `W`, and the original React object `AIa` |
| User message disclosure | `src/renderer/messages/collapsible-user-message-content.tsx` | `collapsible-user-message-content`'s `C` / exported `t`; official measurement/collapse hook, print atom, search registration, Markdown preview context, button, localized messages, icons and React object `E` |
| Shared task row | `src/renderer/shared/task-row.tsx`, `task-row-types.ts` | `app-initial`'s `GTc` / exported `U$`; original row primitives, atoms, hover/action callbacks, drag services, platform checks and React `cEc`; sidebar, scheduled and automation consumers |
| Sidebar conversation row | `src/renderer/sidebar/conversation-row.tsx` | `vEc`; existing task row, animated title and class names; navigation, thread/project data and selection stay upstream |
| PR status badge | `src/renderer/sidebar/status-badge.ts` | `hzc` / exported `KJ`; original icon and tooltip. Static contracts cover upstream badge data; real-page PR metadata is conditional and is not included in the current UI acceptance |
| Markdown code presentation | `src/renderer/markdown/code-block.tsx`, `mermaid-placeholder.tsx` | `app-initial`'s `Ard` and `trd`; original preview context, language service, snippet/highlighter, Mermaid renderer and locale; authored visibility and loading presentation |
| Code frame and controls | `src/renderer/markdown/code-block-frame.tsx` | `app-shared`'s `zzn`; original copy-result button/clipboard, wrap preference, theme, LaTeX renderer and primitives; authored action bar and preview/source layout |
| Home composer layout | `src/renderer/composer/home-composer-layout.tsx` | `app-primary`'s `RBt`; original feature gates, model scope, layout children and controller identity |
| Main composer view | `src/renderer/composer/main-composer.tsx`, `composer-types.ts` | `app-initial`'s `y_d`; original editor engine, motion/presentation contexts, surface parts and voice components; authored editor/accessory/footer composition |
| Controller lifecycle | `src/renderer/composer/composer-controller.ts` | `BSd` / `wEe`; original controller creation, document schema, context and preferences; authored pending input/IME/selection transfer, subscriptions and owned-controller cleanup |
| Draft scope and submit shortcuts | `src/renderer/composer/composer-draft-scope.tsx`, `composer-submit-controls.ts` | Only `Mpt`'s draft/provider/root composition and `cut`; original draft atoms, scope/key, serialization, shortcut service and submit/queue callbacks. The rest of `Mpt`, `hpt`, `p9e` and queue UI remain subsequent boundaries |
| Queue editing orchestration | `src/renderer/composer/composer-queue-edit.ts`, `composer-queue-types.ts` | `alt` and its local `olt/slt` logic; original controller, scoped atoms, queue actions, attachment services, undo history and transport. Authored edit races, draft/attachment restoration, delete/undo/redo and send-now routing; queue presentation remains upstream |
| User message and body | `src/renderer/messages/user-message.tsx` | `user-message`'s `Rt` and `yt`; original scope, editing draft atom, Markdown, editor, clipboard and primitives; authored message/actions/selection and edit/copy orchestration |
| File and image attachments | `src/renderer/messages/user-message-attachments.tsx`, `user-message-image.tsx` | `gn`, `pn`, `fn`; original filesystem/image services, context menu, dialog/overlay/editor and thread identity; authored routing, asynchronous loading, controlled navigation and focus restoration |
| Settings root | `src/renderer/settings/settings-page.tsx`, `settings-types.ts` | `settings-page`'s `_i`; original configuration scope, visibility/host/router hooks, sidebar, shell, section content and dialog; authored navigation guard, search targets and route/host composition |
| General section composition | `src/renderer/settings/sections/general.tsx` | `Js` and its `Ys/Xs/Zs` arrangements; original access/host/feature gates, Windows service and individual preference rows |
| Appearance composition and theme form | `src/renderer/settings/sections/appearance.tsx`, `theme-variants.tsx`, `theme-form.tsx` | Route `f`, preferences `tc`, variant dispatch `Qa` and form `$a`; original theme hook `hn`, configuration atoms, clipboard/toasts and lower pickers/dialog/slider. Authored advanced/separate-mode state, theme import/export and color/font patches |
| Appearance mode and font sizes | `src/renderer/settings/sections/appearance-controls.tsx` | `yc/kc/Ac/jc/Mc`; original configuration writers/schema, font limits, artwork, input and tooltip primitives; authored radio and font-input interaction |

The timestamp entry is shared by local and remote sidebar rows, pending worktree
rows, hover cards and other lazy pages. The same defaults, message identifiers,
relative formatting options and clock subscriptions apply to those consumers.
Several sidebar layouts hide inline timestamps. The existing conversation hover
card exposes the timestamp in those layouts; this migration keeps that behavior.
The disclosure entry is used by local, remote and pending user messages and static
transcripts. Its authored message/body parents retain the original Markdown,
links, host context and message actions. It retains code block clipping, print restoration, search reveal and
hidden controls' accessibility handling.

## File ownership

| Area | Responsibility |
| --- | --- |
| `src/renderer/shared/`, `sidebar/` | Shared rows, timestamps and sidebar presentation; upstream services supply business data |
| `src/renderer/messages/`, `markdown/` | Message and Markdown display; upstream services own conversation state, parser/highlighting and host operations |
| `src/renderer/composer/` | Input UI and controller boundaries; reuse the existing document, draft, scope and transport |
| `src/renderer/settings/` | Root navigation and section UI; retain the original configuration scope and host services |
| `src/renderer/components.ts` | Explicit exports of component factories |
| `src/native/renderer-migration.ts` | Explicit pinned, uniquely matched function seams |
| `src/native/server.ts`, `src/native/visualizations.ts`, `scripts/build-native.ts` | Resource delivery, cache namespace and authored component build |
| `test/renderer-*.test.ts`, `scripts/verify-renderer-migration.ts`, `scripts/verify-renderer-settings.ts`, `scripts/verify-queue.ts` | Boundary checks and isolated page verification |

Development areas have separate source branches; shared integration is owned by
the migration manager. Badge callers require PR metadata. The Web host currently
has no GitHub service or Git worker support; ordinary local-row acceptance does
not prove the conditional badge is mounted.

## Runtime integration

The server adapts only its responses for the explicitly listed fixed functions.
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

Adapted response modules and the authored bundle use `no-store`: their upstream
filenames do not identify project-authored changes. Unchanged hashed vendor
assets retain immutable caching. Only actually adapted responses are cached in
the server's memory.

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

The script checks actual React fiber names on the home and local-conversation
pages, one authored module load, typing and the existing model menu, sidebar rows
and hover card, disclosure expansion/collapse, upstream print-state restoration,
exact code copy, word-wrap persistence, LaTeX source/preview, deferred or rendered
Mermaid content, file cards and image preview navigation, reload and desktop/tablet
layouts. It also visits the actual settings routes; targeted component checks cover
dirty navigation, host selection and search/redirect behavior. Account-backed validation and clean
checkout startup are recorded separately with their actual CLI/backend versions;
App 26.1013.40934 identifies the resource reference, not the daemon version.

The shared time contract also covers a non-sidebar `<time>` consumer with
`relative`/`elapsed` options, clock changes and English/French formatting. This
contract check does not claim that every lazy page has been exercised.

For focused settings acceptance, run `npm run test:renderer-settings:ui` after
building, under the same UI lock. `AGENTS_SETTINGS_EVIDENCE` selects its private
output directory. It checks actual authored General/Appearance fibers, native
mode labels, theme copy/import validation and cancellation, separate variants,
font input normalization and saved mode/font-size restoration after reload.
`npm run test:queue` exercises the actual queue edit/delete/requeue/reload path
and uses V8 coverage to confirm that the authored queue hook executes. These
scripts use disposable protocol peers; they do not perform real model inference.

## Later batches

The full Web frontend is still being restored. Remaining work includes route and
shell components, project/thread state and groups, turn and remaining message parents,
the rest of Markdown, the remaining main-composer application controls and queue presentation, menus,
remaining settings rows/controls and sections, file/terminal/diff/Chrome/output wrappers, Mini and conditional
product pages. Third-party libraries and protocol/host services may remain
dependencies; application UI in the same bundles is not implicitly exempt.
Each boundary must be used by the actual page and preserve its existing behavior
before its migration is considered complete.
