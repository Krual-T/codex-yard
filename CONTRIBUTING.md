# Contributing

Work in LifeKernel's `projects/codex-yard/` module and follow LifeKernel's `.agents/development.md`. Completed work is committed and integrated into LifeKernel's local `main`; run the commands below from this module directory.

Use a topic branch and keep each change focused. Production modules use strict TypeScript; new UI uses React and TypeScript. Reuse the existing Codex transport and host interfaces when extending a feature.

Run `npm ci`, `npm run typecheck`, and `npm test` before submitting a change. These commands work without Codex App and include the vendored official adapter checks. Renderer integration changes require a full-UI check using the pinned App resource version and a validated Codex CLI backend. Keep the CLI/daemon and App reference versions separate in validation reports.

Describe the user-visible behavior, the changed host contract, and the validation performed. Include remaining platform or runtime limitations. Use synthetic conversations for screenshots and reports.

For sidebar layout or motion changes, run `flock /tmp/agents-workbench-heavy.lock npm run test:sidebar-toggle:ui`. This uses disposable conversations with the pinned renderer and writes screenshots and timing evidence to `.local/sidebar-toggle/`. Set `AGENTS_TEST_CONFIGURATION_SNAPSHOT` to an existing anonymous configuration snapshot when offline. The check covers repeated toggles, interrupted transitions, retained drafts and scroll position, hover peeks, resizing, narrow screens, keyboard access and reduced motion. Run `scripts/verify-conversation-history-cli.ts` separately to validate the real Codex CLI backend.

Keep the fixed compiled Codex UI resources under `vendor/codex-app/` and the standalone tool adapter/kernel under `vendor/native-app-tools/`, with their original notices and provenance. Put custom behavior in the project's TypeScript/React modules. Runtime state, personal machine paths, account data, and private validation logs stay out of commits. See [third-party components](THIRD_PARTY.md) and [deployment boundaries](SECURITY.md).
