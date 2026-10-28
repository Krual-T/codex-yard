import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/native/visualization-sandbox.ts'], outfile: '.local/visualization-sandbox.js',
  bundle: true, format: 'iife', target: ['safari17', 'chrome120'], logLevel: 'info',
});
await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/native/browser-host.ts'], outfile: '.local/native-host.js',
  bundle: true, format: 'iife', target: ['safari17', 'chrome120'], sourcemap: true,
  logLevel: 'info',
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
await writeFile(join(clientDir, 'package.json'), JSON.stringify({
  name: 'codex-yard-chrome-client', version: '0.4.0', private: true, type: 'module',
  description: 'Connect this computer’s existing Chrome to Codex Yard using official Chrome DevTools MCP',
  bin: { 'codex-yard-chrome': './client.mjs' }, engines: { node: '>=22.12' }, files: ['client.mjs'],
  dependencies: { 'chrome-devtools-mcp': dependencies.devDependencies['chrome-devtools-mcp'], ws: dependencies.dependencies.ws },
}, null, 2) + '\n');
const packed = JSON.parse(execFileSync('npm', ['pack', './.local/chrome-client', '--pack-destination', '.local', '--ignore-scripts', '--json'], { cwd: project, encoding: 'utf8' }));
await rename(new URL('../.local/' + packed[0].filename, import.meta.url), new URL('../.local/chrome-client.tgz', import.meta.url));
await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/native/browser-entry.ts'], outfile: '.local/workbench-entry.js',
  bundle: true, format: 'esm', target: ['safari17', 'chrome120'], sourcemap: true,
  logLevel: 'info',
});

const rendererComponents = await build({
  absWorkingDir: project,
  entryPoints: ['src/renderer/components.ts'], outfile: '.local/renderer-components.js',
  bundle: true, format: 'esm', target: ['safari17', 'chrome120'], sourcemap: 'inline',
  metafile: true, logLevel: 'info',
});
if (Object.keys(rendererComponents.metafile.inputs).some(path => /node_modules\/react(?:-dom)?\//.test(path))) {
  throw new Error('Authored renderer components must use the pinned renderer’s React runtime');
}
