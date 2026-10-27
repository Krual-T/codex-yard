import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rendererVersion = '26.1013.40934';
export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export const runtimeRoot = join(projectRoot, 'vendor', 'codex-app', rendererVersion);
export const rendererRoot = join(runtimeRoot, 'webview');
export const bundledAppToolsAdapter = join(runtimeRoot, 'codex-app-tools', 'server.mjs');
