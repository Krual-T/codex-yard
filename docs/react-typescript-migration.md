# React + TypeScript migration

The Web frontend now enters through the project-owned renderer under
`src/renderer/`. Its React application, conversation state, composers, messages,
settings and workspace views are maintained as TypeScript source. Codex CLI is
the external protocol backend. The current architecture and implementation
contracts are described in the [standalone renderer design](standalone-renderer-design.md).

The earlier reconstruction stage injected component factories into fixed
functions in the compiled Codex App interface. That integration has been retired.
The remaining home-layout and shared-task-row factories had no application
callers: only their snapshot-comparison tests imported them. Those isolated
factories and tests have been removed. The running home and sidebar continue
through `src/renderer/app/App.tsx` and
`src/renderer/sidebar/StandaloneSidebar.tsx`.

## Validation

Run `npm ci`, `npm run typecheck` and `npm test`. The owned renderer's browser
fixtures use disposable protocol peers and isolated browser state; these checks
do not perform real model inference. Tests of actual Codex protocol behavior
must record the CLI/daemon version and distinguish scripted local providers from
account-backed inference.

Complete migration acceptance still requires deleting the entire
`vendor/codex-app/` directory and validating a clean checkout with the desktop
installation unavailable. That acceptance includes installation, build, actual
`npm start`, the existing Web features and the distribution contents. Until
those checks finish, a working owned renderer is an intermediate result.

Third-party assets retained outside the snapshot keep their original license
terms; see [THIRD_PARTY.md](../THIRD_PARTY.md).
