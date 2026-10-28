# Development

Read README.md and CONTRIBUTING.md before changing the project. Use a focused topic branch and an isolated worktree for ongoing changes. Preserve existing user changes.

Production modules and new scripts use strict TypeScript. New UI uses React. Prefer the existing Codex transport and host interfaces over a second implementation of the same capability.

Run `npm run typecheck` and `npm test` for code changes. Portable checks use project-authored modules and disposable fixtures. UI integration changes also need the actual browser entry and host requests checked. Use disposable CLI sessions and a local scripted provider where possible; a real-provider check requires an authorized test account. Validate standalone operation from a clean checkout with the desktop installation unavailable, including installation, build, actual startup and UI behavior. Record the source commit, actual CLI/daemon version and fixture scope separately from the historical App UI reference.

Keep the frontend, state and tool adapter in project-authored React/TypeScript modules. General third-party libraries come from package management; do not add compiled Codex App code or a snapshot fallback to the build, runtime or distribution. Preserve the retained non-code pet images' notice and update THIRD_PARTY.md when third-party boundaries change. Never commit `.local/`, `.env`, credentials, user conversations or private validation artifacts. Do not restart a shared instance or modify the user's Codex/Chrome configuration as part of ordinary testing.
