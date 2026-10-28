import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { nativeFixture } from './native-fixture.ts';
import { editorText, fileText, resolveFilePath, toBase64 } from '../src/renderer/files/file-service.ts';

const chromePath = '/usr/bin/google-chrome';

test('file paths, Unicode bytes and line endings retain their host representation', () => {
  assert.equal(resolveFilePath('/workspace/project', '../other/./file.txt'), '/workspace/other/file.txt');
  assert.equal(resolveFilePath('/workspace/project', 'file:///tmp/example'), 'file:///tmp/example');
  assert.equal(editorText('one\r\ntwo\r\n'), 'one\ntwo\n');
  assert.equal(fileText('one\nchanged\n', 'one\r\ntwo\r\n'), 'one\r\nchanged\r\n');
  assert.equal(fileText('one\nchanged\n', 'one\rtwo\r'), 'one\rchanged\r');
  assert.throws(() => fileText('changed\n', 'one\r\ntwo\n'), /mixed line endings/);
  assert.equal(Buffer.from(toBase64('中文\n'), 'base64').toString('utf8'), '中文\n');
});

function samplePdf() {
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('workspace file panels use the real host with a disposable synthetic daemon', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-panels-');
  const project = join(root, 'project');
  const other = join(root, 'other');
  await mkdir(join(project, 'folder'), { recursive: true });
  await mkdir(other);
  const original = 'first line\nsecond line\nthird line\n';
  await writeFile(join(project, 'notes.txt'), original);
  await writeFile(join(project, 'folder', 'nested.txt'), 'nested contents');
  await writeFile(join(project, 'slow.txt'), 'slow contents');
  await writeFile(join(project, 'fast.txt'), 'fast contents');
  await writeFile(join(project, 'data.bin'), Buffer.from([0, 1, 127, 255, 65]));
  await writeFile(join(project, 'late-binary.txt'), Buffer.concat([Buffer.alloc(4096, 65), Buffer.from([255])]));
  await writeFile(join(project, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
  await writeFile(join(project, 'report.pdf'), samplePdf());
  await writeFile(join(other, 'other.txt'), 'other scope');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  t.after(async () => {
    await context?.close();
    await browser?.close();
    await app?.close();
    await fake.close();
    await rm(root, { recursive: true, force: true });
  });
  const fileRpc = fileDaemonFixture();
  for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, record(params)));
  const { renderer, adapterPath } = await nativeFixture(root);
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
      const state = { calls: [], references: [], dirty: [], closed: 0, delayedPath: null, release: null };
      const socket = new WebSocket(location.origin.replace('http', 'ws') + '/native-host');
      const opened = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
      const pending = new Map(); let sequence = 0;
      socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        const key = message.type === 'fetch-response' ? message.requestId : message.type === 'mcp-response' ? message.message.id : null;
        if (!pending.has(key)) return;
        const { resolve, reject } = pending.get(key); pending.delete(key);
        const error = message.type === 'fetch-response' ? (message.responseType === 'success' ? null : message.error) : message.message.error?.message;
        if (error) reject(new Error(error)); else resolve(message.type === 'fetch-response' ? message.body : message.message.result);
      };
      async function send(message, key) {
        await opened;
        return new Promise((resolve, reject) => { pending.set(key, {resolve, reject}); socket.send(JSON.stringify(message)); });
      }
      const client = {
        async host(endpoint, params = {}) {
          state.calls.push({ kind: 'host', endpoint, params: structuredClone(params) });
          const id = 'host-' + ++sequence;
          const result = await send({type:'fetch', requestId:id, url:'vscode://codex/' + endpoint, body:JSON.stringify(params)}, id);
          if (endpoint === 'workspace-files' && params.operation === 'read' && params.path === state.delayedPath) {
            await new Promise(resolve => { state.release = resolve; });
          }
          return result;
        },
        async rpc(method, params = {}, hostId = 'local') {
          state.calls.push({ kind: 'rpc', method, params: structuredClone(params), hostId });
          const id = 'rpc-' + ++sequence;
          return send({type:'mcp-request', hostId, request:{id, method, params}}, id);
        },
        subscribe() { return () => {}; },
        async reply() { throw new Error('unexpected approval'); },
      };
      let props = {client, hostId:'local', cwd:${JSON.stringify(project)}, request:{id:'initial', kind:'file', path:'notes.txt', line:2, column:3},
        onReference: draft => state.references.push(draft), onDirtyChange: dirty => state.dirty.push(dirty), onClose: () => state.closed++};
      const root = createRoot(document.getElementById('root'));
      window.fixture = {state, render(changes) { props = {...props, ...changes}; root.render(React.createElement(WorkspacePanels, props)); },
        release() { state.delayedPath = null; state.release?.(); }};
      window.fixture.render({});
    ` },
    bundle: true, write: false, format: 'iife', outdir: 'fixture-output', loader: { '.css': 'css' },
  });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  await writeFile(join(renderer, 'fixture.js'), javascript);
  await writeFile(join(renderer, 'fixture.css'), `html,body,#root{height:100%;margin:0}\n${css}`);
  await writeFile(join(renderer, 'index.html'), '<!doctype html><html><head><title>Fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data'), workspace: root,
    renderer, adapterPath, port: 0 });
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1100, height: 760 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(7_000);
  const errors: string[] = [];
  const browserConsole: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserConsole.push(message.text()); });
  await page.goto(app.url);

  const editor = page.getByRole('textbox', { name: `File: ${join(project, 'notes.txt')}` });
  try { await editor.waitFor(); }
  catch (cause) {
    throw new Error(`File did not open: ${await page.locator('body').innerText()}; page errors: ${errors.join('; ')}; console: ${browserConsole.join('; ')}; calls: ${JSON.stringify(await page.evaluate(() => (window as any).fixture?.state.calls))}`, { cause });
  }
  assert.equal(await editor.inputValue(), original);
  assert.equal(await editor.evaluate(element => (element as HTMLTextAreaElement).selectionStart), 'first line\nse'.length);
  await page.getByRole('button', { name: 'Add file to conversation' }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.references[0]), {
    text: '', images: [], files: [{ path: join(project, 'notes.txt'), name: 'notes.txt' }],
  });
  await page.getByRole('button', { name: 'folder', exact: true }).click();
  await page.getByRole('button', { name: 'nested.txt', exact: true }).click();
  await page.getByRole('textbox', { name: `File: ${join(project, 'folder', 'nested.txt')}` }).waitFor();
  await page.getByRole('tab', { name: 'notes.txt' }).click();
  await editor.fill('unsaved edit');
  await page.getByRole('button', { name: 'Save file' }).click();
  await page.getByRole('alert').filter({ hasText: /附件|只允许/ }).waitFor();
  assert.equal(await editor.inputValue(), 'unsaved edit');
  assert.equal(await readFile(join(project, 'notes.txt'), 'utf8'), original);
  assert.equal(fake.calls('fs/writeFile').length, 0);

  await page.evaluate(other => (window as any).fixture.render({ cwd: other, request: null }), other);
  await page.getByRole('button', { name: 'other.txt', exact: true }).waitFor();
  await page.evaluate(project => (window as any).fixture.render({ cwd: project, request: null }), project);
  await page.getByRole('tab', { name: /notes.txt/ }).click();
  assert.equal(await editor.inputValue(), 'unsaved edit');
  await writeFile(join(project, 'notes.txt'), 'external change');
  await page.getByRole('button', { name: 'Save file' }).click();
  await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
  assert.equal(await editor.inputValue(), 'unsaved edit');
  assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.kind === 'rpc' && call.method === 'fs/writeFile').length), 1);

  await page.evaluate(path => { (window as any).fixture.state.delayedPath = path; }, join(project, 'slow.txt'));
  await page.getByRole('button', { name: 'slow.txt', exact: true }).click();
  await page.waitForFunction(() => Boolean((window as any).fixture.state.release));
  await page.getByRole('button', { name: 'fast.txt', exact: true }).click();
  const fast = page.getByRole('textbox', { name: `File: ${join(project, 'fast.txt')}` });
  await fast.waitFor();
  await page.evaluate(() => (window as any).fixture.release());
  assert.equal(await fast.inputValue(), 'fast contents');
  await page.getByRole('tab', { name: 'slow.txt' }).click();
  assert.equal(await page.getByRole('textbox', { name: `File: ${join(project, 'slow.txt')}` }).inputValue(), 'slow contents');

  await page.getByRole('button', { name: 'data.bin', exact: true }).click();
  await page.getByLabel(`Binary: ${join(project, 'data.bin')}`).waitFor();
  assert.match(await page.getByLabel(`Binary: ${join(project, 'data.bin')}`).innerText(), /00 01 7f ff 41/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file' }).click();
  assert.deepEqual(await readFile(await (await download).path()), Buffer.from([0, 1, 127, 255, 65]));
  await page.getByRole('button', { name: 'late-binary.txt', exact: true }).click();
  await page.getByLabel(`Binary: ${join(project, 'late-binary.txt')}`).waitFor();
  assert.match(await page.getByLabel(`Binary: ${join(project, 'late-binary.txt')}`).innerText(), /00001000  ff/);
  await page.getByRole('button', { name: 'image.png', exact: true }).click();
  const image = page.getByRole('img', { name: join(project, 'image.png') });
  await image.waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('img')?.naturalWidth));
  await page.getByRole('button', { name: 'report.pdf', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'PDF preview is unavailable' }).waitFor();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file' }).click();
  assert.deepEqual(await readFile(await (await pdfDownload).path()), samplePdf());
  const screenshotDir = process.env.AGENTS_PANEL_SCREENSHOTS;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, 'pdf.png') });
  }
  assert.deepEqual(browserConsole.filter(message => /content security policy|refused to frame/i.test(message)), []);

  await page.getByRole('tab', { name: /notes.txt/ }).click();
  if (screenshotDir) {
    await page.screenshot({ path: join(screenshotDir, 'desktop.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole('button', { name: 'Hide files' }).click();
  await page.getByRole('button', { name: 'Show files' }).click();
  assert.ok(await page.evaluate(() => (window as any).fixture.state.dirty.includes(true)));
  page.once('dialog', dialog => void dialog.dismiss());
  await page.getByRole('button', { name: 'Close panel' }).click();
  assert.equal(await page.evaluate(() => (window as any).fixture.state.closed), 0);
  assert.deepEqual(errors, []);
});
