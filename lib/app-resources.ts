import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rendererVersion = '26.1013.40934';
export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export const runtimeRoot = join(projectRoot, 'vendor', 'codex-app', rendererVersion);
export const rendererRoot = join(runtimeRoot, 'webview');
// Keep the conversation service deployable when the desktop UI snapshot is removed.
export const nativeToolsVersion = '26.1013.40934';
export const bundledAppToolsAdapter = join(projectRoot, 'vendor', 'native-app-tools', nativeToolsVersion, 'server.mjs');
