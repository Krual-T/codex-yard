# Third-party components

## Codex App resources

The current interface is based on Codex App **26.1013.40934**. Its compiled `webview/` resources and `codex-app-tools/` Node adapter are tracked as ordinary Git files under `vendor/codex-app/26.1013.40934/`. Build and startup read that snapshot directly. A desktop app installation and a separate App package download are not required.

The snapshot was extracted from [OpenAI's versioned Linux package](https://persistent.oaistatic.com/codex-app-prod/linux/arch/26.1013.40934/x86_64/chatgpt-bin-26.1013.40934-1-x86_64.pkg.tar.zst). The web files and adapter are preserved byte-for-byte, including bundled copyright and license notices. The repository does not contain the package archive, desktop executable, original App TypeScript/TSX sources, account data, or downloaded configuration responses.

The project's MIT license applies to project-authored source and excludes `vendor/codex-app/`. The compiled App code and its bundled dependencies retain their existing copyrights and terms; this repository does not relicense them. See the [vendor notice](vendor/codex-app/LICENSE), retained upstream notices, and [OpenAI's applicable terms](https://openai.com/policies/service-terms/).

Changes to Codex App's private module exports or host contracts can require updates to the version boundary in `src/native/renderer-assets.ts` and the corresponding host code. Compatibility with other renderer versions is not assumed. The CLI/daemon versions and the separate UI reference version are documented in README.md.

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

The Chrome companion bundles this project's transport and declares dependencies on `chrome-devtools-mcp` and `ws`. It is generated into `.local/` during the host build. It does not contain Chrome, browser profiles, cookies, or paired-device credentials.

Codex and OpenAI names identify the products with which this independent project interoperates. No affiliation or endorsement is claimed.
