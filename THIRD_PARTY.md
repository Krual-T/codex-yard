# Third-party components

## Codex App resources

Codex App **26.1013.40934** is the historical UI behavior reference. Its compiled `webview/` resources and `codex-app-tools/` Node adapter remain tracked under `vendor/codex-app/26.1013.40934/` during the migration. The owned React entry and build no longer load the snapshot renderer; remaining reference tests and resource helpers are being replaced before deleting the snapshot. A desktop app installation and a separate App package download are not required.

The snapshot was extracted from [OpenAI's versioned Linux package](https://persistent.oaistatic.com/codex-app-prod/linux/arch/26.1013.40934/x86_64/chatgpt-bin-26.1013.40934-1-x86_64.pkg.tar.zst). The web files and adapter are preserved byte-for-byte, including bundled copyright and license notices. The repository does not contain the package archive, desktop executable, original App TypeScript/TSX sources, account data, or downloaded configuration responses.

The project's MIT license applies to project-authored source and excludes `vendor/codex-app/` and the nine upstream sprite sheets in `public/pets/`. The compiled App code, its bundled dependencies, and the sprites retain their existing copyrights and terms; this repository does not relicense them. See the [vendor notice](vendor/codex-app/LICENSE), retained upstream notices, the [pet provenance and notice](public/pets/NOTICE.md), and [OpenAI's applicable terms](https://openai.com/policies/service-terms/).

Compatibility with other App reference versions or CLI/daemon versions is not assumed. The CLI/daemon versions and the separate UI reference version are documented in README.md.

## Package dependencies

The npm dependencies are declared in `package.json` and locked in `package-lock.json`. They retain the licenses and notices distributed in their packages. `npm ci` installs them locally; `node_modules/` stays outside Git. The owned React application is bundled from `src/native/browser-entry.ts` and the authored renderer modules; its npm dependencies are not part of the App snapshot. Build output preserves embedded legal comments but does not collect every package license into `.local/renderer/`; distributors of generated assets must retain the applicable package licenses and notices alongside them.

The owned file editor uses the MIT-licensed CodeMirror 6 packages for editing, commands, search and language support. These packages and their language parsers come from npm, with their packaged licenses; no original App editor bundle is copied into the source tree.

KaTeX and its fonts come from the npm `katex` package and are included in the renderer output by esbuild. The PDF worker is copied from the npm `pdfjs-dist` package to `.local/renderer/pdf.worker.min.mjs`; the PDF viewer loads it from the same origin. Their package licenses and notices remain applicable to these generated resources.

The nine upstream WebP sprite sheets are tracked separately under `public/pets/` with their original provenance and notice. They are not npm packages or project-authored artwork. The server must expose those files for the Mini pet consumer to load them.

The host uses the npm `chrome-devtools-mcp` runtime dependency for local Chrome integration. The Chrome companion bundles this project's transport and declares the same `chrome-devtools-mcp` version and `ws` as dependencies, installed separately on the access computer. It is generated into `.local/` during the host build and does not contain Chrome, browser profiles, cookies, or paired-device credentials.

The pinned `qrcode.react` package is an ISC-licensed React QR renderer that includes the MIT-licensed QR Code Generator; its distributed `LICENSE` and embedded notices apply. The published npm package identifies the QR Code Generator license but omits the referenced source directory containing its complete notice. The [upstream notice at the 4.2.0 tag](https://github.com/zpao/qrcode.react/blob/v4.2.0/src/third-party/qrcodegen/LICENSE) is retained below. This dependency is intended for the browser-auth component when that component and its host are integrated.

```text
QR Code generator library (TypeScript)

Copyright (c) Project Nayuki.
https://www.nayuki.io/page/qr-code-generator-library

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Codex and OpenAI names identify the products with which this independent project interoperates. No affiliation or endorsement is claimed.
