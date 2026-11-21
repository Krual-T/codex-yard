# Third-party components

## Codex App resources

The current interface is based on Codex App **26.1013.40934**. Its compiled `webview/` resources and `codex-app-tools/` Node adapter are tracked as ordinary Git files under `vendor/codex-app/26.1013.40934/`. Build and startup read that snapshot directly. A desktop app installation and a separate App package download are not required.

The snapshot was extracted from [OpenAI's versioned Linux package](https://persistent.oaistatic.com/codex-app-prod/linux/arch/26.1013.40934/x86_64/chatgpt-bin-26.1013.40934-1-x86_64.pkg.tar.zst). The web files and adapter are preserved byte-for-byte, including bundled copyright and license notices. The repository does not contain the package archive, desktop executable, original App TypeScript/TSX sources, account data, or downloaded configuration responses.

The project's MIT license applies to project-authored source and excludes `vendor/codex-app/`. The compiled App code and its bundled dependencies retain their existing copyrights and terms; this repository does not relicense them. See the [vendor notice](vendor/codex-app/LICENSE), retained upstream notices, and [OpenAI's applicable terms](https://openai.com/policies/service-terms/).

Changes to Codex App's private module exports or host contracts can require updates to the version boundary in `src/native/renderer-assets.ts` and the corresponding host code. Compatibility with other renderer versions is not assumed. The CLI/daemon versions and the separate UI reference version are documented in README.md.

The React workspace build reads named SVG shapes from the pinned renderer for its chrome icons. The icon artwork retains its upstream terms. The extraction reads literals at build time and does not run or serve the icon catalog's JavaScript to the workspace.

The project-authored New tab surface in `src/native/new-tab-view.tsx` follows the
layout and action composition inspected in App **26.1111.21308** (Windows package
**26.1111.2228.0**, `webview/assets/async/350901.9887d1d57a.js`). It uses the
checked-in renderer's action registry, search, menus, tab lifecycle and React
runtime through `new-tab-renderer.ts`. The newer package is a development
reference; its code and installed resources are not loaded at runtime, and the
fixed upstream snapshot remains unchanged.

## Native conversation tool adapter and derived kernel

`vendor/native-app-tools/26.1013.40934/server.mjs` is the unmodified official
`codex-app-tools/server.mjs` from the same package. The tool host uses this copy
so that its runtime does not depend on the old renderer snapshot directory.

`vendor/native-app-tools/26.1013.40934/portable-tools.mjs` contains a bounded subset
of the same App snapshot: its twelve conversation-tool descriptors, strict argument
schemas, history projection, passive wait kernel, Markdown formatting, model
validation, ancestry helper and delegation-input constructor, including their
dependencies and retained bundled notices. `scripts/extract-native-tools.ts`
selects upstream lexical bindings and bundles this subset with esbuild; the
original snapshot is unchanged. The browser HTML entity decoder is the sole
platform port inside the copied kernel and uses `entities.decodeHTMLStrict`.

This derived code retains the upstream copyrights and terms and is excluded from
the project's MIT grant. See its [notice](vendor/native-app-tools/LICENSE).
The declaration file, extraction script and daemon/Yard I/O adapter are
project-authored. The extraction script also copies the official adapter without
changes. Neither runtime artifact starts or imports a desktop renderer.

## Package dependencies

The npm dependencies are declared in `package.json` and locked in `package-lock.json`. They retain the licenses and notices distributed in their packages. `npm ci` installs them locally; `node_modules/` stays outside Git.

`web-push` 4.0.0 (MPL-2.0) supplies Web Push encryption and VAPID signing. Its source and dependencies are installed as npm packages, retain their shipped notices, and are used by the server without modification. They are not included in the browser bundles or the Chrome companion.

The Chrome companion bundles this project's transport and declares dependencies on `chrome-devtools-mcp` and `ws`. It is generated into `.local/` during the host build. It does not contain Chrome, browser profiles, cookies, or paired-device credentials.

Codex and OpenAI names identify the products with which this independent project interoperates. No affiliation or endorsement is claimed.

## Original Node REPL and Sky runtime

`vendor/node-repl/0.0.30-20261014203459-0849368674e2/linux-x64` retains the original Linux x64 `node_repl` executable and upstream manifest from the Codex App CUA runtime (archive version `0.0.30/20261014203459-0849368674e2`). It also contains original `@oai/sky` 0.7.8, the Linux helper, and shipped `@statsig/js-client` / `@statsig/client-core` 3.33.3. The upstream Node notice is retained as `UPSTREAM-NODE-LICENSE`; package notices remain alongside their files. That Node notice does not relicense other components. No executable is translated or patched; standalone Node launches it through Yard's project-authored configuration. `lib/sky-service.ts` adds turn-owned input cleanup around the original RPC service.

`vendor/node-repl/app-26.1117.3838.0/win32-x64` contains the original Windows `node_repl.exe`, Sky **0.7.24** with its original native/Swift helpers and DLLs, Statsig dependencies and upstream manifest from App **26.1117.3838.0**. Its original `bin/node_modules` tree is stored under `lib/node_modules` to match the independent runtime layout; file contents are unchanged. Windows Node and Codex CLI remain separately installed prerequisites. The WSL input/pipe transports are project-authored TypeScript and do not modify upstream resources.

## Original plugin resources and file runtime

The packages `plugins/documents`, `pdf`, `spreadsheets`, `presentations` and `template-creator` originate from the locally available OpenAI primary-runtime plugin snapshot **26.909.61513**. `plugins/browser` and `chrome` retain the bundled original snapshot **26.1103.60933**, including the original browser service/client and Linux x64 extension host. The Windows x64 extension host was copied unchanged from App **26.1117.3838.0**. `plugins/computer-use` retains Sky's Linux Skill and platform references, with a Yard-authored package manifest/lifecycle hooks. Source names, versions, scripts and shipped notices are preserved. The five file Skills add a short standalone-runtime setup paragraph; `runtime.ts` is project-authored. Original Browser/Chrome Skill files remain unchanged.

The copied upstream files retain their individual copyrights and terms and are excluded from this project's MIT grant. A package manifest's license label does not override a more specific retained file notice. The public Yard snapshot retains these notices and does not relicense copied resources.

`artifacts:prepare` explicitly copies an already available original primary-runtime dependency tree to a private directory outside the App/cache. The validated bundle is **26.909.61513**, including `@oai/artifact-tool` **2.8.59** and its original dependency/notices tree. That runtime, user files, accounts and validation outputs are not committed. Preparation and verification scripts are project-authored. Local copying preserves the upstream declarations; any separate distribution must follow each resource's applicable terms.
