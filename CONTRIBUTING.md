# Contributing

Use a topic branch and keep each change focused. Production modules use strict TypeScript; new UI uses React and TypeScript. Reuse the existing Codex transport and host interfaces when extending a feature.

Run `npm ci`, `npm run typecheck`, and `npm test` before submitting a change. These commands work without Codex App. If a change affects the official MCP adapter, prepare the pinned resources and also run `npm run test:app-tools`. Renderer integration changes require a full-UI check using the pinned App resource version and a validated Codex CLI backend. Keep the CLI/daemon and App reference versions separate in validation reports.

Describe the user-visible behavior, the changed host contract, and the validation performed. Include remaining platform or runtime limitations. Use synthetic conversations for screenshots and reports.

Keep compiled Codex resources, runtime state, personal machine paths, account data, and private validation logs out of commits. See [third-party components](THIRD_PARTY.md) and [deployment boundaries](SECURITY.md).
