# Contributing

Clone this repository and run the commands below from its root. Keep runtime state and personal configuration outside commits.

Use a topic branch and keep each change focused. Production modules use strict TypeScript; new UI uses React and TypeScript. Reuse the existing Codex transport and host interfaces when extending a feature.

Run `npm ci`, `npm run typecheck`, and `npm test` before submitting a change. These commands work without Codex App and include the vendored official adapter checks. Renderer integration changes require a full-UI check using the pinned App resource version and a validated Codex CLI backend. Keep the CLI/daemon and App reference versions separate in validation reports.

For source-workspace settings, plugins, skills or scheduling changes, run `flock /tmp/agents-workbench-heavy.lock npm run test:workspace-pages:ui` and `node scripts/verify-automations.ts --source-workspace`. These use disposable fixtures to check document reuse, settings persistence and errors, plugin operations, retained terminals and chat drafts. Validate the real backend with `node scripts/verify-automation-cli.ts --ui --source-workspace` and `node scripts/verify-plugins.ts --ui --source-workspace`, under the same browser lock. Both CLI checks use temporary Codex homes and avoid personal accounts.

Describe the user-visible behavior, the changed host contract, and the validation performed. Include remaining platform or runtime limitations. Use synthetic conversations for screenshots and reports.

`npm run test:hooks:ui` checks the native Hooks review dialog against an isolated real CLI and a loopback scripted model provider. It covers opening without approving, a missing lazy chunk, the persistent refresh action and retained draft, and approval persistence after reload. It uses disposable configuration and conversations; evidence stays under ignored `.local/hooks-review/`. `AGENTS_TEST_CHROMIUM` selects Chromium and `AGENTS_HOOKS_EVIDENCE` selects the evidence directory.

For sidebar layout or motion changes, run `flock /tmp/agents-workbench-heavy.lock npm run test:sidebar-toggle:ui`. This uses disposable conversations with the pinned renderer and writes screenshots and timing evidence to `.local/sidebar-toggle/`. Set `AGENTS_TEST_CONFIGURATION_SNAPSHOT` to an existing anonymous configuration snapshot when offline. The check covers repeated toggles, interrupted transitions, retained drafts and scroll position, hover peeks, resizing, narrow screens, keyboard access and reduced motion. Run `scripts/verify-conversation-history-cli.ts` separately to validate the real Codex CLI backend.

`flock /tmp/agents-workbench-heavy.lock npm run test:sidebar-visibility:ui` checks the React sidebar with disposable protocol fixtures: important chats beyond the preview, collapsed activity counts, delayed list/metadata responses, failure recovery, two pages, archives, cursor paging and narrow screens. It also checks opening completed conversations whose first unread turn is on an earlier history page, retrying failed read confirmations, and retaining unread activity behind Settings. `node scripts/verify-thread-read-state.ts --source` validates the React read-receipt lifecycle, including paginated unread history, against an isolated real CLI and loopback provider. Evidence stays under `.local/`.

Keep the fixed compiled Codex UI resources under `vendor/codex-app/` and the standalone tool adapter/kernel under `vendor/native-app-tools/`, with their original notices and provenance. Put custom behavior in the project's TypeScript/React modules. Runtime state, personal machine paths, account data, and private validation logs stay out of commits. See [third-party components](THIRD_PARTY.md) and [deployment boundaries](SECURITY.md).
