# Development

## Product invariant: independent operation

Yard is an independent Codex client and capability host. All supported features, including plugin management and Computer Use, must build, start and operate when Codex App is not installed or is closed. Implement required host services in Yard or use explicitly documented standalone dependencies. Runtime access to an installed App's binaries, resources, private sockets or running process cannot satisfy this requirement. The checked-in, versioned UI/adapter snapshots may remain reference assets; the Codex CLI, model provider, OS permissions and documented plugin runtimes remain prerequisites.

For each integration, verify the actual user action and capability lifecycle with the App installation unavailable. Closing the Yard page must preserve work owned by the persistent Yard service or Codex backend. Report supported platforms and remaining environment prerequisites precisely. Computer Use setup and service ownership are described in `docs/standalone-plugins.md`.

## Development workflow

Run the npm commands below from the repository root. Keep development and validation in a focused topic branch and an isolated worktree, and preserve existing changes. The published repository contains the source, tests and runtime resources needed to build Yard independently.

Read README.md and CONTRIBUTING.md before changing the project. Use a focused topic branch and an isolated worktree for ongoing changes. Preserve existing user changes.

Production modules and new scripts use strict TypeScript. New UI uses React. Prefer the existing Codex transport and host interfaces over a second implementation of the same capability.

Run `npm run typecheck` and `npm test` for code changes. Portable tests include the vendored resource and official MCP adapter checks and do not require Codex App. Full UI validation requires a Codex CLI backend and an authorized test account. Validate standalone deployment from a clean checkout with the desktop installation unavailable. Record the actual CLI/daemon version separately from the App UI reference version.

The fixed App web resources are tracked under `vendor/codex-app/`; the standalone Node tool adapter and derived kernel are under `vendor/native-app-tools/`. Preserve upstream files and notices; keep custom changes in project-authored modules and update THIRD_PARTY.md when replacing the snapshot. Never commit `.local/`, `.env`, credentials, user conversations, or private validation artifacts. Do not restart a shared instance or modify the user's Codex/Chrome configuration as part of ordinary testing.
