# Development

Read README.md and CONTRIBUTING.md before changing the project. Use a focused topic branch and an isolated worktree for ongoing changes. Preserve existing user changes.

Production modules and new scripts use strict TypeScript. New UI uses React. Prefer the existing Codex transport and host interfaces over a second implementation of the same capability.

Run `npm run typecheck` and `npm test` for code changes. Portable tests use fixtures and do not require Codex App. Run `npm run test:app-tools` for changes to the installed MCP adapter integration. Full UI validation requires the pinned local app resources and an authorized test account.

Never commit `.local/`, `.env`, imported app resources, credentials, user conversations, or private validation artifacts. Do not restart a shared instance or modify the user's Codex/Chrome configuration as part of ordinary testing.
