# Third-party components

## Codex App resources

The current interface depends on Codex App **26.1013.40934**. `scripts/copy-renderer.ts` reads a user-supplied local `app.asar` and extracts its `webview/` directory into ignored `.local/renderer-26.1013.40934/`.

The repository does not contain that archive, compiled interface, fonts, logos, sprites, downloaded configuration responses, or the official App Tools adapter. The user supplies the adapter from their own installation. The project's MIT license covers the source in this repository and does not grant rights to those external components.

Changes to Codex App's private module exports or host contracts can require updates to the version boundary in `src/native/renderer-assets.ts` and the corresponding host code. Compatibility with other renderer versions is not assumed.

## Package dependencies

The npm dependencies are declared in `package.json` and locked in `package-lock.json`. They retain the licenses and notices distributed in their packages. `npm ci` installs them locally; `node_modules/` stays outside Git.

The Chrome companion bundles this project's transport and declares dependencies on `chrome-devtools-mcp` and `ws`. It is generated into `.local/` during the host build. It does not contain Chrome, browser profiles, cookies, or paired-device credentials.

Codex and OpenAI names identify the products with which this independent project interoperates. No affiliation or endorsement is claimed.
