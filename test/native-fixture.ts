import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rendererVersion } from '../scripts/copy-renderer.ts';

// The fake daemon never launches an MCP adapter. Supply a readable fixture
// path for the host's configuration checks, without installing Codex Desktop.
export const fixtureAdapterPath = fileURLToPath(import.meta.url);

export async function nativeFixture(root: string) {
  const renderer = join(root, 'renderer');
  await mkdir(renderer);
  await writeFile(join(renderer, 'renderer.json'), JSON.stringify({ version: rendererVersion }));
  await writeFile(join(renderer, 'index.html'), '<html><head><title>ChatGPT</title><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;;"></head><body><div id="root"></div><script type="module" src="./assets/index-acf264e41d60.js"></script></body></html>');
  return { renderer, adapterPath: fixtureAdapterPath };
}
