import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { chromeCommand } from '../src/browser-reuse/chrome-mcp.ts';
import { builtinPetAssets } from '../src/renderer/mini/model.ts';

test('the actual runtime dependencies resolve and the companion declares the same versions', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const companion = JSON.parse(await readFile('.local/chrome-client/package.json', 'utf8'));
  assert.equal(companion.dependencies['chrome-devtools-mcp'], manifest.dependencies['chrome-devtools-mcp']);
  assert.equal(companion.dependencies.ws, manifest.dependencies.ws);
  const command = chromeCommand({ browserUrl: 'http://127.0.0.1:9222' });
  assert.equal(command.command, process.execPath);
  assert.match(command.args[0], /chrome-devtools-mcp[\\/]build[\\/]src[\\/]bin[\\/]chrome-devtools-mcp\.js$/);
  await access(command.args[0]);
  const qr = renderToStaticMarkup(createElement(QRCodeSVG, { value: 'disposable test payload', size: 128, marginSize: 4, title: 'Test QR' }));
  assert.match(qr, /<svg\b/);
  assert.match(qr, /<path\b/);
  assert.match(qr, /Test QR/);
  for (const name of ['chrome-devtools-mcp', 'qrcode.react', 'katex', 'pdfjs-dist']) {
    assert.ok((await readFile(join('node_modules', name, 'LICENSE'), 'utf8')).length > 0, name);
  }
});

test('build outputs include the managed PDF worker, KaTeX fonts, and referenced pet files', async () => {
  assert.deepEqual(await readFile('.local/renderer/pdf.worker.min.mjs'), await readFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'));
  const css = await readFile('.local/renderer/workbench-entry.css', 'utf8');
  const metafile = JSON.parse(await readFile('.local/renderer-metafile.json', 'utf8'));
  const fonts = Object.keys(metafile.outputs as Record<string, unknown>).filter(path => /\.(?:woff2?|ttf)$/.test(path));
  assert.ok(fonts.length > 0);
  assert.ok(Object.keys(metafile.inputs as Record<string, unknown>).some(path => /node_modules\/katex\/dist\/fonts\//.test(path)));
  for (const font of fonts) {
    assert.ok(css.includes(basename(font)), font);
    assert.ok((await readFile(font)).length > 0, font);
  }
  const notice = await readFile('public/pets/NOTICE.md', 'utf8');
  for (const path of Object.values(builtinPetAssets)) {
    assert.match(path, /^\/pets\/[^/]+\.webp$/);
    assert.ok((await readFile(join('public', path))).length > 0, path);
    assert.ok(notice.includes(basename(path)), path);
  }
});
