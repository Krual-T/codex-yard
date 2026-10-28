# Contributing

Use a topic branch and keep each change focused. Production modules use strict TypeScript; new UI uses React and TypeScript. Reuse the existing Codex transport and host interfaces when extending a feature.

Run `npm ci`, `npm run typecheck`, and `npm test` for code changes before submitting them. The build compiles this project's renderer and host with locked npm dependencies. Use disposable data and backend fixtures for portable checks; renderer integration changes also need an actual UI check. Record the source commit, actual CLI/daemon version and fixture scope separately from the historical App behavior reference.

Describe the user-visible behavior, the changed host contract, and the validation performed. Include remaining platform or runtime limitations. Use synthetic conversations for screenshots and reports.

Keep browser behavior in the project's React + TypeScript source and reuse the existing Codex protocol connection. Install general third-party libraries through npm and preserve their packaged notices. Retained pet images keep their [provenance and terms](public/pets/NOTICE.md); do not add a compiled App renderer or fallback runtime. Runtime state, personal machine paths, account data and private validation logs stay out of commits. See [third-party components](THIRD_PARTY.md) and [deployment boundaries](SECURITY.md).

For standalone acceptance, use a clean committed checkout with the desktop installation unavailable. Install dependencies, build, start and exercise the application there; inspect the emitted build inputs and distribution files for snapshot dependencies. Use a disposable CLI backend and scripted provider where possible. Tests against a real provider require an authorized test account and must report that scope explicitly.
