# Development

Read README.md and CONTRIBUTING.md before changing the project. Use a focused topic branch and an isolated worktree for ongoing changes. Preserve existing user changes.

Production modules and new scripts use strict TypeScript. New UI uses React. Prefer the existing Codex transport and host interfaces over a second implementation of the same capability.

Run `npm run typecheck` and `npm test` for code changes. Portable tests include the vendored resource and official MCP adapter checks and do not require Codex App. Full UI validation requires a Codex CLI backend and an authorized test account. Validate standalone deployment from a clean checkout with the desktop installation unavailable. Record the actual CLI/daemon version separately from the App UI reference version.

The fixed App web resources are tracked under `vendor/codex-app/`; the standalone Node tool adapter and derived kernel are under `vendor/native-app-tools/`. Preserve upstream files and notices; keep custom changes in project-authored modules and update THIRD_PARTY.md when replacing the snapshot. Never commit `.local/`, `.env`, credentials, user conversations, or private validation artifacts. Do not restart a shared instance or modify the user's Codex/Chrome configuration as part of ordinary testing.
