# Third-party components

## Codex App resources

The current interface is based on Codex App **26.1013.40934**. Its compiled `webview/` resources and `codex-app-tools/` Node adapter are tracked as ordinary Git files under `vendor/codex-app/26.1013.40934/`. Build and startup read that snapshot directly. A desktop app installation and a separate App package download are not required.

The snapshot was extracted from [OpenAI's versioned Linux package](https://persistent.oaistatic.com/codex-app-prod/linux/arch/26.1013.40934/x86_64/chatgpt-bin-26.1013.40934-1-x86_64.pkg.tar.zst). The web files and adapter are preserved byte-for-byte, including bundled copyright and license notices. The repository does not contain the package archive, desktop executable, original App TypeScript/TSX sources, account data, or downloaded configuration responses.

The project's MIT license applies to project-authored source and excludes `vendor/codex-app/`. The compiled App code and its bundled dependencies retain their existing copyrights and terms; this repository does not relicense them. See the [vendor notice](vendor/codex-app/LICENSE), retained upstream notices, and [OpenAI's applicable terms](https://openai.com/policies/service-terms/).

Changes to Codex App's private module exports or host contracts can require updates to the version boundary in `src/native/renderer-assets.ts` and the corresponding host code. Compatibility with other renderer versions is not assumed. The CLI/daemon versions and the separate UI reference version are documented in README.md.

## Package dependencies

The npm dependencies are declared in `package.json` and locked in `package-lock.json`. They retain the licenses and notices distributed in their packages. `npm ci` installs them locally; `node_modules/` stays outside Git.

The Chrome companion bundles this project's transport and declares dependencies on `chrome-devtools-mcp` and `ws`. It is generated into `.local/` during the host build. It does not contain Chrome, browser profiles, cookies, or paired-device credentials.

Codex and OpenAI names identify the products with which this independent project interoperates. No affiliation or endorsement is claimed.
