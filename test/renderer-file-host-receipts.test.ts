import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { nativeFixture } from './native-fixture.ts';

async function waitForBrowser(check: () => Promise<unknown>) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for the asynchronous browser condition.');
}

test('file panels recover actual host failed, blocked and lost receipts without replay', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-host-receipts-browser-'), project = join(root, 'project');
  await mkdir(project);
  const a = join(project, 'a'), b = join(project, 'b'), link = join(project, 'link');
  const pendingDir = join(project, 'pending'), pendingLink = join(project, 'pending-link');
  await mkdir(a); await mkdir(b); await mkdir(pendingDir);
  await symlink(a, link); await symlink(pendingDir, pendingLink);
  const failedTarget = join(link, 'file.txt'), failedA = join(a, 'file.txt'), failedB = join(b, 'file.txt');
  const pendingTarget = join(pendingLink, 'file.txt'), pendingFile = join(pendingDir, 'file.txt');
  const storageFile = join(project, 'storage.txt');
  await Promise.all([failedA, failedB, pendingFile, storageFile].map(path => writeFile(path, 'base\n')));

  const fake = await createFakeCodex(root), daemon = fileDaemonFixture();
  let release!: () => void, entered!: () => void, failed = false, writes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { entered = resolve; });
  for (const method of fileMethods) fake.handlers.set(method, async params => {
    if (method === 'fs/writeFile') {
      writes++;
      if (params.path === failedA && !failed) { failed = true; throw new Error('fixture write denied'); }
      if (params.path === pendingFile) { entered(); await gate; }
    }
    return daemon(method, record(params));
  });
  const { renderer, adapterPath } = await nativeFixture(root);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { EditorView } from '@codemirror/view';
    import { BrowserWorkbenchClient } from './src/renderer/app/client.ts';
    import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
    import { readFileRecovery } from './src/renderer/panels/file-save-recovery.ts';
    const client = new BrowserWorkbenchClient();
    const host = client.host.bind(client), calls = [];
    let loseNext = false, failStorage = false, barrier, nextRequest = 0;
    client.host = async (...args) => {
      calls.push({endpoint:args[0],params:structuredClone(args[1])});
      const result = await host(...args);
      if (args[0] === 'workspace-file-save' && loseNext) { loseNext = false; throw new Error('fixture lost response'); }
      if (args[0] === 'workspace-file-save' && failStorage) {
        failStorage = false;
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...params) { IDBDatabase.prototype.transaction = original; throw new Error('fixture storage failure'); };
      }
      return result;
    };
    let props = {client,scopeId:'none',hostId:'local',cwd:${JSON.stringify(project)},request:null,
      appearance:{theme:'light',codeFontSize:13,codeLineHeight:20},onRequestConsumed() {},onClose() {},
      onRecoveryBarrier(value) { barrier = value; }};
    const reactRoot = createRoot(document.getElementById('root'));
    function render() { reactRoot.render(React.createElement(WorkspacePanels, props)); }
    window.fixture = {
      open(scopeId,cwd,path) { props = {...props,scopeId,cwd,request:{id:String(++nextRequest),scopeId,hostId:'local',cwd,kind:'file',path}}; render(); },
      edit(text) { const view = EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content')); view.dispatch({changes:{from:0,insert:text}}); },
      text() { return EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content')).state.doc.toString(); },
      recovery(scopeId,cwd,path) { return readFileRecovery(JSON.stringify([scopeId,'local',cwd,path])); },
      loseNext() { loseNext = true; }, failStorage() { failStorage = true; }, calls() { return calls; },
      flush() { if (!barrier) throw new Error('missing recovery barrier'); return barrier(); },
    };
    render();
  ` }, bundle: true, write: false, format: 'iife', outdir: 'host-receipts-fixture', loader: { '.css': 'css' } });
  await writeFile(join(renderer, 'fixture.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text);
  await writeFile(join(renderer, 'fixture.css'), `html,body,#root{height:100%;margin:0}\n${bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text}`);
  await writeFile(join(renderer, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data'),
    workspace: root, renderer, adapterPath, port: 0 });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), CODEX_HOME: join(root, 'codex') } });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  let completed = false;
  t.after(async () => {
    release(); await context.close(); await browser.close(); await app.close(); await fake.close();
    if (completed) await rm(root, { recursive: true, force: true });
  });
  async function newPage() {
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    page.on('dialog', dialog => { void dialog.accept(); });
    await page.goto(new URL('/index.html', app.url).href);
    return page;
  }
  async function open(page: Page, scope: string, cwd: string, path: string) {
    await page.evaluate(({scope,cwd,path}) => (window as any).fixture.open(scope,cwd,path), {scope,cwd,path});
    await page.getByRole('textbox', { name: `File: ${path}` }).waitFor();
  }
  async function recovery(page: Page, scope: string, cwd: string, path: string) {
    return page.evaluate(({scope,cwd,path}) => (window as any).fixture.recovery(scope,cwd,path), {scope,cwd,path});
  }
  let page: Page | undefined;
  try {
    page = await newPage();
    await open(page, 'failed', project, failedTarget);
    await page.evaluate(() => (window as any).fixture.edit('X'));
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'fixture write denied'}).waitFor();
    const failedRecovery = await recovery(page, 'failed', project, failedTarget);
    assert.equal(failedRecovery.phase, 'failed'); assert.equal(failedRecovery.guardOperationId, failedRecovery.id);
    await unlink(link); await symlink(b, link);
    await page.evaluate(() => (window as any).fixture.loseNext());
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    const conflictRecovery = await recovery(page, 'failed', project, failedTarget);
    assert.notEqual(conflictRecovery.id, failedRecovery.id);
    const conflictCall = await page.evaluate(() => (window as any).fixture.calls().filter((call: any) => call.endpoint === 'workspace-file-save').at(-1));
    assert.equal(conflictCall.params.guardOperationId, failedRecovery.id);
    await page.reload(); await open(page, 'failed', project, failedTarget);
    assert.equal((await recovery(page, 'failed', project, failedTarget)).id, conflictRecovery.id);
    await page.getByRole('button', {name:'Check save result'}).click();
    await page.getByRole('alert').filter({hasText:'File changed on disk'}).waitFor();
    assert.equal(await page.getByRole('button', {name:'Save file'}).isDisabled(), true);
    assert.equal(await readFile(failedA, 'utf8'), 'base\n'); assert.equal(await readFile(failedB, 'utf8'), 'base\n');
    assert.equal(writes, 1);

    const original = await newPage(), other = await newPage();
    await open(original, 'original', project, pendingTarget);
    await original.evaluate(() => (window as any).fixture.edit('A'));
    await original.getByRole('button', {name:'Save file'}).click();
    await writing;
    const originalRecovery = await recovery(original, 'original', project, pendingTarget);
    await open(other, 'blocked', pendingDir, pendingFile);
    await other.evaluate(() => { (window as any).fixture.edit('B'); (window as any).fixture.loseNext(); });
    await other.getByRole('button', {name:'Save file'}).click();
    await other.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    const blockedRecovery = await recovery(other, 'blocked', pendingDir, pendingFile);
    assert.notEqual(blockedRecovery.id, originalRecovery.id);
    await other.reload(); await open(other, 'blocked', pendingDir, pendingFile);
    await other.getByRole('button', {name:'Check save result'}).click();
    await other.getByRole('alert').filter({hasText:'still unknown'}).waitFor();
    const recovered = await recovery(other, 'blocked', pendingDir, pendingFile);
    assert.equal(recovered.id, blockedRecovery.id); assert.equal(recovered.checkId, originalRecovery.id);
    assert.deepEqual(recovered.query, {cwd:project,path:pendingTarget}); assert.equal(recovered.submitted, false);
    const checks = await other.evaluate(() => (window as any).fixture.calls().filter((call: any) => call.endpoint === 'workspace-file-save-status'));
    assert.deepEqual(checks.map((call: any) => call.params.operationId), [blockedRecovery.id, originalRecovery.id]);
    assert.equal(writes, 2); assert.equal(await readFile(pendingFile, 'utf8'), 'base\n');
    release();
    await waitForBrowser(() => original.evaluate(async ({scope,cwd,path}: any) => (await (window as any).fixture.recovery(scope,cwd,path))?.phase === 'saved',
      {scope:'original',cwd:project,path:pendingTarget}));
    await other.getByRole('button', {name:'Check save result'}).click();
    await other.getByRole('alert').filter({hasText:'File changed on disk'}).waitFor();
    assert.equal(await other.evaluate(() => (window as any).fixture.text()), 'Bbase\n');
    assert.equal(await readFile(pendingFile, 'utf8'), 'Abase\n'); assert.equal(writes, 2);

    const storage = await newPage();
    await open(storage, 'storage', project, storageFile);
    await storage.evaluate(() => { (window as any).fixture.edit('S'); (window as any).fixture.failStorage(); });
    await storage.getByRole('button', {name:'Save file'}).click();
    await storage.getByRole('alert').filter({hasText:'Could not retain file recovery'}).waitFor();
    assert.equal(await readFile(storageFile, 'utf8'), 'Sbase\n');
    await assert.rejects(storage.evaluate(() => (window as any).fixture.flush()));
    await storage.getByRole('button', {name:'Review recovery'}).click();
    await storage.getByRole('button', {name:'Check save result'}).click();
    await storage.getByRole('button', {name:'Check save result'}).waitFor({state:'detached'});
    await storage.evaluate(() => (window as any).fixture.flush());
    assert.equal((await recovery(storage, 'storage', project, storageFile)).phase, 'saved');
    assert.equal(writes, 3);
    completed = true;
  } catch (error) {
    await page?.screenshot({path:join(root, 'failure.png')}).catch(() => {});
    await writeFile(join(root, 'failure.txt'), String(error));
    throw new Error(`File host receipt browser failure artifacts: ${root}`, {cause:error});
  }
});
