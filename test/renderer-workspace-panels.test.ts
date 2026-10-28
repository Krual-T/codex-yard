import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { editFileText, editorText, previewMimeType, resolveFilePath, toBase64 } from '../src/renderer/files/file-service.ts';
import { diffRows } from '../src/renderer/diff/diff-service.ts';

const chromePath = '/usr/bin/google-chrome';

test('file paths, Unicode bytes and line endings retain their host representation', () => {
  assert.equal(resolveFilePath('/workspace/project', '../other/./file.txt'), '/workspace/other/file.txt');
  assert.equal(resolveFilePath('/workspace/project', 'file:///tmp/example'), 'file:///tmp/example');
  assert.equal(editorText('one\r\ntwo\r\n'), 'one\ntwo\n');
  const mixed = 'one\r\ntwo\nthree\rfour\r\n';
  assert.equal(editFileText(mixed, 'one\nTWO\nthree\nfour\n', { start: 4, end: 7, inputType: 'insertText' }), 'one\r\nTWO\nthree\rfour\r\n');
  assert.equal(editFileText(mixed, 'one\ntwo\nextra\nthree\nfour\n', { start: 8, end: 8, inputType: 'insertText' }), 'one\r\ntwo\nextra\rthree\rfour\r\n');
  assert.equal(editFileText(mixed, 'one\nthree\nfour\n', { start: 4, end: 8, inputType: 'deleteContentBackward' }), 'one\r\nthree\rfour\r\n');
  assert.equal(editFileText('a\r\na\nb', 'a\nb', { start: 0, end: 2, inputType: 'deleteContentForward' }), 'a\nb');
  assert.equal(Buffer.from(toBase64('中文\n'), 'base64').toString('utf8'), '中文\n');
  assert.equal(previewMimeType('/test.webm', 'application/octet-stream'), 'video/webm');
  assert.equal(previewMimeType('/test.ogg', 'application/octet-stream'), 'audio/ogg');
  assert.equal(previewMimeType('/test.webm', 'image/png'), 'image/png');
});

test('unified diffs retain target paths and only offer valid new-file line locations', () => {
  const patch = [
    'diff --git a/one.txt b/one.txt', '--- a/one.txt', '+++ b/one.txt', '@@ -2,2 +2,2 @@', ' unchanged', '-old', '+new',
    'diff --git a/deleted.txt b/deleted.txt', '--- a/deleted.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone',
    'diff --git a/second.txt b/second.txt', '--- a/second.txt', '+++ b/second.txt', '@@ -0,0 +1 @@', '+added',
  ].join('\n');
  const rows = diffRows(patch);
  assert.deepEqual(rows.find(row => row.text === ' unchanged'), { text: ' unchanged', kind: 'context', path: 'one.txt', oldLine: 2, newLine: 2 });
  assert.deepEqual(rows.find(row => row.text === '+new'), { text: '+new', kind: 'add', path: 'one.txt', newLine: 3 });
  assert.deepEqual(rows.find(row => row.text === '-gone'), { text: '-gone', kind: 'delete', oldLine: 1 });
  assert.equal(rows.find(row => row.text === '+added')?.path, 'second.txt');
  assert.equal(diffRows('@@ -0,0 +1 @@\n+added', '/selected.txt')[1].path, '/selected.txt');
  assert.equal(diffRows('+++ "b/ambiguous\\040name"\n@@ -0,0 +1 @@\n+x')[2].path, undefined);
});

function samplePdf() {
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  const stream = (text: string) => {
    const content = `BT /F1 16 Tf 20 100 Td (${text}) Tj ET`;
    return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('First PDF page'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    stream('Second PDF page'),
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

function sampleWav() {
  const rate = 8000, samples = rate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * Math.PI / 10) * 5000), 44 + index * 2);
  return wav;
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
  await writeFile(join(project, 'mixed.txt'), 'one\r\ntwo\nthree\rfour\r\n');
  await writeFile(join(project, 'folder', 'nested.txt'), 'nested contents');
  await writeFile(join(project, 'slow.txt'), 'slow contents');
  await writeFile(join(project, 'fast.txt'), 'fast contents');
  await writeFile(join(project, 'diff-target.txt'), 'first\nnew\nthird\n');
  await writeFile(join(project, 'data.bin'), Buffer.from([0, 1, 127, 255, 65]));
  await writeFile(join(project, 'late-binary.txt'), Buffer.concat([Buffer.alloc(4096, 65), Buffer.from([255])]));
  await writeFile(join(project, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
  await writeFile(join(project, 'report.pdf'), samplePdf());
  await writeFile(join(project, 'sound.wav'), sampleWav());
  await writeFile(join(project, 'broken.wav'), Buffer.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, 0]));
  await writeFile(join(project, 'broken.pdf'), '%PDF-1.4\nnot a PDF');
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
  await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', join(renderer, 'pdf.worker.min.mjs'));
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
      const state = { calls: [], references: [], dirty: [], consumed: [], closed: 0, delayedPath: null, release: null, writes: [], writeOutcome: 'unknown' };
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
          if (endpoint === 'workspace-file-save') { state.writes.push(structuredClone(params)); return window.fixtureSave(params, state.writeOutcome); }
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
      let props = {client, scopeId:'thread-a', hostId:'local', cwd:${JSON.stringify(project)},
        request:{id:'initial',scopeId:'thread-a',hostId:'local',cwd:${JSON.stringify(project)},kind:'file',path:'notes.txt',line:2,column:3},
        onRequestConsumed: id => state.consumed.push(id), onReference: draft => state.references.push(draft),
        onDirtyChange: dirty => state.dirty.push(dirty), onClose: () => state.closed++};
      const root = createRoot(document.getElementById('root'));
      window.fixture = {state,
        render(changes) { const next = {...props, ...changes};
          if (changes.request) next.request = {scopeId:next.scopeId,hostId:next.hostId,cwd:next.cwd,...changes.request};
          props = next; root.render(React.createElement(WorkspacePanels, props)); },
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
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  context = await browser.newContext({ viewport: { width: 1100, height: 760 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(7_000);
  const errors: string[] = [];
  const browserConsole: string[] = [];
  const requestedUrls: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserConsole.push(message.text()); });
  page.on('request', request => requestedUrls.push(request.url()));
  await page.exposeFunction('fixtureSave', async (params: { hostId: string; cwd: string; path: string; expectedContents: string; contents: string }, mode: string) => {
    assert.equal(params.hostId, 'local');
    assert.equal(params.cwd, project);
    assert.ok(params.path.startsWith(project + '/'));
    if (mode === 'unknown') throw new Error('synthetic disconnect');
    if (await readFile(params.path, 'utf8') !== params.expectedContents) return { outcome: 'conflict' };
    await writeFile(params.path, params.contents);
    if (mode === 'unknown-applied') throw new Error('synthetic disconnect after write');
    return { outcome: 'saved' };
  });
  await page.goto(app.url);
  const videoBytes = await page.evaluate(async () => {
    if (!MediaRecorder.isTypeSupported('video/mp4')) throw new Error('Chrome cannot record the MP4 fixture');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const drawing = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    let frame = 0;
    const timer = setInterval(() => { drawing.fillStyle = frame++ % 2 ? '#c03030' : '#3060c0'; drawing.fillRect(0, 0, 64, 64); }, 80);
    await new Promise(resolve => setTimeout(resolve, 900));
    clearInterval(timer); recorder.stop(); await done; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/mp4' }).arrayBuffer()));
  });
  await writeFile(join(project, 'clip.mp4'), Buffer.from(videoBytes));
  await page.getByRole('button', { name: 'Refresh files' }).click();

  const editor = page.getByRole('textbox', { name: `File: ${join(project, 'notes.txt')}` });
  try { await editor.waitFor(); }
  catch (cause) {
    throw new Error(`File did not open: ${await page.locator('body').innerText()}; page errors: ${errors.join('; ')}; console: ${browserConsole.join('; ')}; calls: ${JSON.stringify(await page.evaluate(() => (window as any).fixture?.state.calls))}`, { cause });
  }
  assert.equal(await editor.inputValue(), original);
  assert.equal(await editor.getAttribute('readonly'), null);
  assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
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
  await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
  assert.equal(await editor.inputValue(), 'unsaved edit');
  assert.equal(await readFile(join(project, 'notes.txt'), 'utf8'), original);
  assert.equal(fake.calls('fs/writeFile').length, 0);
  assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Check save result' }).click();
  await page.getByRole('button', { name: 'Check save result' }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => (window as any).fixture.state.writes.length), 1);

  await page.evaluate(() => (window as any).fixture.render({scopeId:'draft-b',request:null}));
  assert.equal(await page.getByRole('tab', { name: /notes.txt/ }).count(), 0);
  await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
  assert.equal(await editor.inputValue(), original);
  await editor.fill('draft b');
  await page.evaluate(() => (window as any).fixture.render({scopeId:'thread-a',request:null}));
  assert.equal(await editor.inputValue(), 'unsaved edit');
  await page.evaluate(() => (window as any).fixture.render({scopeId:'draft-b',request:null}));
  assert.equal(await editor.inputValue(), 'draft b');
  await page.evaluate(() => (window as any).fixture.render({scopeId:'thread-a',request:null}));
  assert.equal(await editor.inputValue(), 'unsaved edit');

  await page.evaluate(other => (window as any).fixture.render({ cwd: other, request: null }), other);
  await page.getByRole('button', { name: 'other.txt', exact: true }).waitFor();
  await page.evaluate(project => (window as any).fixture.render({ cwd: project, request: null }), project);
  await page.getByRole('tab', { name: /notes.txt/ }).click();
  assert.equal(await editor.inputValue(), 'unsaved edit');
  await writeFile(join(project, 'notes.txt'), 'external change');
  await page.evaluate(() => { (window as any).fixture.state.writeOutcome = 'saved'; });
  await page.getByRole('button', { name: 'Save file' }).click();
  await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
  assert.equal(await editor.inputValue(), 'unsaved edit');
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.writes[1]), {
    hostId: 'local', cwd: project, path: join(project, 'notes.txt'), expectedContents: original, contents: 'unsaved edit',
  });
  assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.kind === 'rpc' && call.method === 'fs/writeFile').length), 0);

  await page.getByRole('button', { name: 'mixed.txt', exact: true }).click();
  const mixedEditor = page.getByRole('textbox', { name: `File: ${join(project, 'mixed.txt')}` });
  await mixedEditor.waitFor();
  await mixedEditor.evaluate(element => { const input = element as HTMLTextAreaElement; input.focus(); input.setSelectionRange(4, 7); });
  await page.keyboard.insertText('TWO');
  await page.getByRole('button', { name: 'Save file' }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Save file"]') as HTMLButtonElement)?.disabled);
  assert.equal(await readFile(join(project, 'mixed.txt'), 'utf8'), 'one\r\nTWO\nthree\rfour\r\n');

  await page.evaluate(() => { (window as any).fixture.state.writeOutcome = 'unknown-applied'; });
  await mixedEditor.evaluate(element => { const input = element as HTMLTextAreaElement; input.focus(); input.setSelectionRange(0, 0); });
  await page.keyboard.insertText('A');
  await page.getByRole('button', { name: 'Save file' }).click();
  await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
  await mixedEditor.evaluate(element => { const input = element as HTMLTextAreaElement; input.focus(); input.setSelectionRange(1, 1); });
  await page.keyboard.insertText('B');
  const writesBeforeCheck = await page.evaluate(() => (window as any).fixture.state.writes.length);
  await page.getByRole('button', { name: 'Check save result' }).click();
  await page.getByRole('button', { name: 'Check save result' }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => (window as any).fixture.state.writes.length), writesBeforeCheck);
  assert.equal(await readFile(join(project, 'mixed.txt'), 'utf8'), 'Aone\r\nTWO\nthree\rfour\r\n');
  assert.equal(await mixedEditor.inputValue(), 'ABone\nTWO\nthree\nfour\n');
  await page.evaluate(() => { (window as any).fixture.state.writeOutcome = 'saved'; });
  await page.getByRole('button', { name: 'Save file' }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Save file"]') as HTMLButtonElement)?.disabled);
  assert.equal(await readFile(join(project, 'mixed.txt'), 'utf8'), 'ABone\r\nTWO\nthree\rfour\r\n');

  await page.evaluate(() => (window as any).fixture.render({scopeId:'draft-b',request:{id:'stale',scopeId:'thread-a',hostId:'old-host',cwd:'/old-cwd',kind:'file',path:'fast.txt'}}));
  await page.waitForFunction(() => (window as any).fixture.state.consumed.includes('stale'));
  assert.equal(await page.getByRole('tab', { name: /fast.txt/ }).count(), 0);
  await page.evaluate(() => (window as any).fixture.render({scopeId:'thread-a',request:null}));

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

  let releaseDownload!: () => void;
  let finishDownload!: () => void;
  const delayedDownload = new Promise<void>(resolve => { releaseDownload = resolve; });
  const downloadFinished = new Promise<void>(resolve => { finishDownload = resolve; });
  await page.route('**/api/files/download?*', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== join(project, 'slow.txt')) return route.continue();
    await delayedDownload;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'late download failure' }) });
    finishDownload();
  });
  await page.getByRole('button', { name: 'Download file' }).click();
  await page.getByRole('button', { name: 'Close slow.txt' }).click();
  await page.getByRole('button', { name: 'slow.txt', exact: true }).click();
  await page.getByRole('textbox', { name: `File: ${join(project, 'slow.txt')}` }).waitFor();
  releaseDownload();
  await downloadFinished;
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('alert').filter({ hasText: 'late download failure' }).count(), 0);

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
  await page.getByRole('button', { name: 'sound.wav', exact: true }).click();
  const audio = page.getByLabel(`Audio: ${join(project, 'sound.wav')}`);
  await audio.waitFor();
  await audio.evaluate(async element => { (element as HTMLAudioElement).muted = true; await (element as HTMLAudioElement).play(); });
  await page.waitForFunction(() => (document.querySelector('audio')?.currentTime ?? 0) > 0);
  assert.equal(await audio.evaluate(element => (element as HTMLAudioElement).duration), 2);
  await page.getByRole('button', { name: 'clip.mp4', exact: true }).click();
  const video = page.getByLabel(`Video: ${join(project, 'clip.mp4')}`);
  await video.waitFor();
  await video.evaluate(async element => { (element as HTMLVideoElement).muted = true; await (element as HTMLVideoElement).play(); });
  await page.waitForFunction(() => Boolean(document.querySelector('video')?.videoWidth && document.querySelector('video')!.currentTime > 0));
  assert.equal(await video.evaluate(element => (element as HTMLVideoElement).videoWidth), 64);
  await page.getByRole('button', { name: 'broken.wav', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Media preview failed' }).waitFor();
  await page.getByRole('button', { name: 'report.pdf', exact: true }).click();
  await page.getByLabel('PDF page 1').waitFor();
  await page.locator('.yard-pdf-text-layer').getByText('First PDF page').waitFor();
  assert.ok(requestedUrls.some(url => new URL(url).pathname === '/pdf.worker.min.mjs'));
  const firstWidth = await page.getByLabel('PDF page 1').evaluate(element => element.getBoundingClientRect().width);
  assert.ok(await page.getByLabel('PDF page 1').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 !== 3 && value < 100);
  }));
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForFunction(width => document.querySelector('canvas')!.getBoundingClientRect().width > width, firstWidth);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.locator('.yard-pdf-text-layer').getByText('Second PDF page').waitFor();
  assert.equal(await page.getByLabel('PDF page', { exact: true }).innerText(), '2 / 2');
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.locator('.yard-pdf-text-layer').getByText('First PDF page').waitFor();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file' }).click();
  assert.deepEqual(await readFile(await (await pdfDownload).path()), samplePdf());
  const screenshotDir = process.env.AGENTS_PANEL_SCREENSHOTS;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, 'pdf.png') });
  }
  await page.getByRole('button', { name: 'broken.pdf', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'PDF preview:' }).waitFor();
  assert.deepEqual(browserConsole.filter(message => /content security policy|refused to frame/i.test(message)), []);

  const patch = '@@ -1,3 +1,3 @@\n first\n-old\n+new\n third\n';
  await page.evaluate(diff => (window as any).fixture.render({ request: { id: 'diff-1', kind: 'diff', path: 'diff-target.txt', diff } }), patch);
  await page.getByLabel('Diff').getByText('+new', { exact: true }).waitFor();
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'diff.png') });
  await page.getByRole('button', { name: 'Add file to conversation' }).click();
  assert.equal(await page.evaluate(() => (window as any).fixture.state.references.at(-1).files[0].path), join(project, 'diff-target.txt'));
  await page.getByRole('button', { name: `Open ${join(project, 'diff-target.txt')} line 2` }).click();
  const target = page.getByRole('textbox', { name: `File: ${join(project, 'diff-target.txt')}` });
  await target.waitFor();
  assert.equal(await target.evaluate(element => (element as HTMLTextAreaElement).selectionStart), 'first\n'.length);
  await page.evaluate(() => (window as any).fixture.render({ request: { id: 'diff-2', kind: 'diff' } }));
  await page.getByRole('status').filter({ hasText: 'Diff is unavailable' }).waitFor();

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
