import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/native/visualization-sandbox.ts'], outfile: '.local/visualization-sandbox.js',
  bundle: true, format: 'iife', target: ['safari17', 'chrome120'], logLevel: 'info',
});

// A downloadable Node companion, containing our compiled TypeScript transport.
// npm installs the same pinned official MCP on the access computer; no Chrome
// executable, custom CDP client, or browser profile is included.
const project = fileURLToPath(new URL('..', import.meta.url));
const clientDir = fileURLToPath(new URL('../.local/chrome-client/', import.meta.url));
await mkdir(clientDir, { recursive: true });
await build({
  absWorkingDir: project, entryPoints: ['src/browser-reuse/client.ts'], outfile: '.local/chrome-client/client.mjs',
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'info',
});
const dependencies = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (typeof dependencies.dependencies?.['chrome-devtools-mcp'] !== 'string' || typeof dependencies.dependencies?.ws !== 'string') {
  throw new Error('Chrome companion requires chrome-devtools-mcp and ws runtime dependencies.');
}
await writeFile(join(clientDir, 'package.json'), JSON.stringify({
  name: 'codex-yard-chrome-client', version: '0.4.0', private: true, type: 'module',
  description: 'Connect this computer’s existing Chrome to Codex Yard using official Chrome DevTools MCP',
  bin: { 'codex-yard-chrome': './client.mjs' }, engines: { node: '>=22.12' }, files: ['client.mjs'],
  dependencies: { 'chrome-devtools-mcp': dependencies.dependencies['chrome-devtools-mcp'], ws: dependencies.dependencies.ws },
}, null, 2) + '\n');
const packed = JSON.parse(execFileSync('npm', ['pack', './.local/chrome-client', '--pack-destination', '.local', '--ignore-scripts', '--json'], { cwd: project, encoding: 'utf8' }));
await rename(new URL('../.local/' + packed[0].filename, import.meta.url), new URL('../.local/chrome-client.tgz', import.meta.url));
const renderer = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: { 'workbench-entry': 'src/native/browser-entry.ts' }, outdir: '.local/renderer',
  bundle: true, splitting: true, format: 'esm', target: ['safari17', 'chrome120'], sourcemap: true,
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' },
  assetNames: 'assets/[name]-[hash]', chunkNames: 'chunks/[name]-[hash]',
  metafile: true, logLevel: 'info',
});
await writeFile(join(project, '.local', 'renderer-metafile.json'), JSON.stringify(renderer.metafile, null, 2) + '\n');
// PDF.js uses its managed worker from the same origin; no blob frame or snapshot.
await copyFile(join(project, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), join(project, '.local/renderer/pdf.worker.min.mjs'));
