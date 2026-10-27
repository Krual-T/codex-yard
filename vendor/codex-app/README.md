# Codex App resource snapshot

Version: **26.1013.40934**.

Source: [OpenAI's versioned Linux package](https://persistent.oaistatic.com/codex-app-prod/linux/arch/26.1013.40934/x86_64/chatgpt-bin-26.1013.40934-1-x86_64.pkg.tar.zst).

- `26.1013.40934/webview/`: all 20,201 files from `usr/lib/chatgpt/resources/app.asar` → `webview/`, including JavaScript, CSS, fonts, icons, sprites, WebAssembly and upstream notices.
- `26.1013.40934/codex-app-tools/`: the original `usr/lib/chatgpt/resources/plugins/openai-bundled/plugins/codex-app-tools/` directory, including its Node server and plugin descriptors.
- `webview/renderer.json`: repository metadata identifying the snapshot; this is the only added file inside the extracted web directory.

Upstream files are preserved unchanged and stored in regular Git, without LFS. The host resolves them through `lib/app-resources.ts` and never downloads an App package at startup. Custom behavior belongs in the project's TypeScript/React host and extensions.

The snapshot excludes the desktop executable, the package archive, account data and runtime configuration. It contains compiled output, not the App's original TypeScript/TSX source. Copyright and license boundaries are described in [LICENSE](LICENSE) and [THIRD_PARTY.md](../../THIRD_PARTY.md).
