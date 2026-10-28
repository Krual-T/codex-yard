import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { nativeFixture } from './native-fixture.ts';

test('file recovery retains the original pending operation and later edits across scopes and refresh', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-unknown-browser-'), project = join(root, 'project');
  await mkdir(project);
  const path = join(project, 'mixed.txt'), original = '\ufeffhello\r\nworld\nend\r';
  await writeFile(path, original);
  const receiptPath = join(project, 'late-receipt.txt');
  await writeFile(receiptPath, 'base\n');
  const retryPath = join(project, 'retry.txt'), legacyPath = join(project, 'legacy.txt'), unknownPath = join(project, 'unknown.txt');
  const closeA = join(project, 'close-a.txt'), closeB = join(project, 'close-b.txt');
  await Promise.all([retryPath, legacyPath, unknownPath, closeA, closeB].map(target => writeFile(target, 'base\n')));
  const fake = await createFakeCodex(root), daemon = fileDaemonFixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writes = 0, completed = false;
  for (const method of fileMethods) fake.handlers.set(method, async params => {
    if (method === 'fs/writeFile' && ++writes === 1) await gate;
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
    import { updateBrowserAtom } from './src/renderer/storage/ui-atoms.ts';
    const client = new BrowserWorkbenchClient();
    const host = client.host.bind(client);
    let holdNext = false, loseNext = false, releaseReceipt, closeMode = 'ok', releaseClose, closed = 0, releaseAtoms, sawAtomTransaction = false;
    client.host = async (...args) => {
      if (args[0] === 'terminal') {
        if (args[1].operation === 'close') {
          if (closeMode === 'fail') throw new Error('fixture terminal close failure');
          if (closeMode === 'delay') await new Promise(resolve => { releaseClose = resolve; });
        }
        return {};
      }
      const result = await host(...args);
      if (args[0] === 'workspace-file-save' && loseNext) { loseNext = false; throw new Error('fixture lost save response'); }
      if (args[0] === 'workspace-file-save' && holdNext) {
        holdNext = false;
        await new Promise(resolve => { releaseReceipt = resolve; });
      }
      return result;
    };
    const cwd = ${JSON.stringify(project)}, path = ${JSON.stringify(path)};
    let barrier;
    let props = {client, scopeId:'thread-a', hostId:'local', cwd,
      appearance:{theme:'light',codeFontSize:13,codeLineHeight:20},
      request:{id:'initial',scopeId:'thread-a',hostId:'local',cwd,kind:'file',path},
      onRequestConsumed() {}, onClose() { closed++; }, onRecoveryBarrier(value) { barrier = value; }};
    const root = createRoot(document.getElementById('root'));
    const render = () => root.render(React.createElement(WorkspacePanels, props));
    window.fixture = {
      client,
      render(changes) { props = {...props,...changes}; render(); },
      edit(at, text) { const view = EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content')); view.dispatch({changes:{from:at,insert:text}}); },
      text() { return EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content')).state.doc.toString(); },
      recovery(scope) { return readFileRecovery(JSON.stringify([scope,'local',cwd,path])); },
      fileRecovery(scope, target) { return readFileRecovery(JSON.stringify([scope,'local',cwd,target])); },
      changeRecovery(scope, target, update) {
        return updateBrowserAtom('codex-yard.file-save-recovery.v1:' + JSON.stringify([scope,'local',cwd,target]), value => ({...value,...update}));
      },
      failNextAtomTransaction() {
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...args) {
          IDBDatabase.prototype.transaction = original;
          throw new Error('fixture storage failure');
        };
      },
      async holdAtoms() {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const tx = db.transaction('atoms', 'readwrite'), store = tx.objectStore('atoms');
        let active = true;
        releaseAtoms = () => { active = false; };
        await new Promise((resolve, reject) => {
          let first = true;
          const keep = () => {
            const request = store.get('native-atoms');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { if (active) keep(); if (first) { first = false; resolve(); } };
          };
          keep();
        });
      },
      releaseAtoms() { releaseAtoms?.(); },
      watchAtomTransaction() {
        sawAtomTransaction = false;
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...args) {
          IDBDatabase.prototype.transaction = original; sawAtomTransaction = true;
          return original.apply(this, args);
        };
      },
      sawAtomTransaction() { return sawAtomTransaction; },
      terminalClose(mode) { closeMode = mode; releaseClose = null; },
      terminalWaiting() { return Boolean(releaseClose); }, releaseTerminal() { releaseClose?.(); }, closed() { return closed; },
      status(id) { return client.host('workspace-file-save-status',{hostId:'local',cwd,path,operationId:id}); },
      hold() { holdNext = true; releaseReceipt = null; }, held() { return Boolean(releaseReceipt); }, release() { releaseReceipt?.(); },
      loseNextSave() { loseNext = true; },
      flush() { if (!barrier) throw new Error('Recovery barrier not registered'); return barrier(); },
    };
    render();
  ` }, bundle: true, write: false, format: 'iife', outdir: 'unknown-fixture', loader: { '.css': 'css' } });
  await writeFile(join(renderer, 'fixture.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text);
  await writeFile(join(renderer, 'fixture.css'), `html,body,#root{height:100%;margin:0}\n${bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text}`);
  await writeFile(join(renderer, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data'),
    workspace: root, renderer, adapterPath, port: 0 });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), CODEX_HOME: join(root, 'codex') } });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  t.after(async () => {
    release();
    await context.close(); await browser.close(); await app.close(); await fake.close();
    if (completed) await rm(root, { recursive: true, force: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('dialog', dialog => void dialog.accept());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(new URL('/index.html', app.url).href);
    await page.getByRole('textbox', { name: `File: ${path}` }).waitFor();
    await page.evaluate(() => (window as any).fixture.edit(0, 'A'));
    await page.getByRole('button', { name: 'Save file' }).click();
    await fake.waitForCall('fs/writeFile');
    const operationId = await page.evaluate(async () => (await (window as any).fixture.recovery('thread-a')).id);
    assert.equal(await readFile(path, 'utf8'), original);
    await page.evaluate(() => (window as any).fixture.client.suspend());
    await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
    await page.evaluate(() => (window as any).fixture.client.resume());
    await page.evaluate(() => (window as any).fixture.edit(1, 'B'));
    await page.evaluate(() => (window as any).fixture.flush());
    await page.waitForFunction(async () => (await (window as any).fixture.recovery('thread-a'))?.draft === '\ufeffABhello\r\nworld\nend\r');
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'still unknown' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    assert.equal(writes, 1);
    await page.getByRole('button', { name: 'Close mixed.txt' }).click();
    await page.getByRole('tab', { name: /mixed.txt/ }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'mixed.txt', exact: true }).click();
    await page.getByRole('textbox', { name: `File: ${path}` }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'ABhello\nworld\nend\n');
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'draft-b',
      request:{id:'other',scopeId:'draft-b',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path });
    await page.waitForFunction(() => { try { return (window as any).fixture.text() === 'hello\nworld\nend\n'; } catch { return false; } });
    await page.evaluate(() => (window as any).fixture.edit(0, 'other '));
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByRole('alert').filter({ hasText: 'Another save' }).waitFor();
    assert.equal(writes, 1);
    await page.evaluate(() => (window as any).fixture.render({scopeId:'thread-a',request:null}));
    await page.waitForFunction(() => { try { return (window as any).fixture.text() === 'ABhello\nworld\nend\n'; } catch { return false; } });
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'ABhello\nworld\nend\n');
    await page.reload();
    await page.getByRole('textbox', { name: `File: ${path}` }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'ABhello\nworld\nend\n');
    assert.equal(await page.evaluate(async () => (await (window as any).fixture.recovery('thread-a')).id), operationId);
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'still unknown' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal(writes, 1);

    release();
    await page.waitForFunction(async id => (await (window as any).fixture.status(id)).outcome === 'saved', operationId);
    assert.equal(await readFile(path, 'utf8'), '\ufeffAhello\r\nworld\nend\r');
    const newerPage = await context.newPage();
    newerPage.setDefaultTimeout(10_000);
    await newerPage.goto(new URL('/index.html', app.url).href);
    await newerPage.getByRole('textbox', { name: `File: ${path}` }).waitFor();
    assert.equal(await newerPage.evaluate(() => (window as any).fixture.text()), 'ABhello\nworld\nend\n');
    await newerPage.getByRole('button', { name: 'Check save result' }).click();
    await newerPage.getByRole('button', { name: 'Check save result' }).waitFor({ state: 'detached' });
    assert.equal(await newerPage.getByRole('button', { name: 'Save file' }).isEnabled(), true);
    await newerPage.getByRole('button', { name: 'Save file' }).click();
    await newerPage.waitForFunction(() => !document.querySelector('[role="tab"][aria-selected="true"] [aria-label="Unsaved changes"]'));
    assert.equal(await readFile(path, 'utf8'), '\ufeffABhello\r\nworld\nend\r');
    assert.equal(writes, 2);
    const newerId = await newerPage.evaluate(async () => (await (window as any).fixture.recovery('thread-a')).id);
    assert.notEqual(newerId, operationId);
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'File recovery changed in another page' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'ABhello\nworld\nend\n');
    assert.equal(await newerPage.evaluate(async () => (await (window as any).fixture.recovery('thread-a')).id), newerId);
    await page.getByRole('button', { name: 'Review recovery' }).click();
    await page.getByRole('alert').filter({ hasText: 'Another page owns a different recovery' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'ABhello\nworld\nend\n');
    await page.getByRole('button', { name: 'Close mixed.txt' }).click();
    await page.getByRole('tab', { name: /mixed.txt/ }).waitFor({ state: 'detached' });
    assert.equal(await newerPage.evaluate(async () => (await (window as any).fixture.recovery('thread-a')).id), newerId);
    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'draft-b',
      request:{id:'other-again',scopeId:'draft-b',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path });
    await page.waitForFunction(() => { try { return (window as any).fixture.text() === 'other hello\nworld\nend\n'; } catch { return false; } });
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'other hello\nworld\nend\n');
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'other hello\nworld\nend\n');
    assert.equal(writes, 2);

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'receipt-a',
      request:{id:'receipt',scopeId:'receipt-a',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: receiptPath });
    await page.waitForFunction(() => { try { return (window as any).fixture.text() === 'base\n'; } catch { return false; } });
    await page.evaluate(() => { (window as any).fixture.hold(); (window as any).fixture.edit(0, 'X'); });
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.waitForFunction(() => (window as any).fixture.held());
    await page.evaluate(() => (window as any).fixture.edit(1, 'Y'));
    await page.waitForFunction(async path => (await (window as any).fixture.fileRecovery('receipt-a', path))?.draft === 'XYbase\n', receiptPath);
    const oldReceiptId = await page.evaluate(async path => (await (window as any).fixture.fileRecovery('receipt-a', path)).id, receiptPath);
    await newerPage.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'receipt-a',
      request:{id:'receipt-other',scopeId:'receipt-a',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: receiptPath });
    await newerPage.waitForFunction(() => { try { return (window as any).fixture.text() === 'XYbase\n'; } catch { return false; } });
    await newerPage.getByRole('button', { name: 'Check save result' }).click();
    await newerPage.getByRole('button', { name: 'Check save result' }).waitFor({ state: 'detached' });
    await newerPage.getByRole('button', { name: 'Save file' }).click();
    await newerPage.waitForFunction(() => !document.querySelector('[role="tab"][aria-selected="true"] [aria-label="Unsaved changes"]'));
    const newReceiptId = await newerPage.evaluate(async path => (await (window as any).fixture.fileRecovery('receipt-a', path)).id, receiptPath);
    assert.notEqual(newReceiptId, oldReceiptId);
    assert.equal(await readFile(receiptPath, 'utf8'), 'XYbase\n');
    await page.evaluate(() => (window as any).fixture.release());
    await page.getByRole('alert').filter({ hasText: 'recovery could not be updated' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');
    assert.equal(await newerPage.evaluate(async path => (await (window as any).fixture.fileRecovery('receipt-a', path)).id, receiptPath), newReceiptId);
    assert.equal(writes, 4);

    await page.getByRole('button', { name: 'Review recovery' }).click();
    await page.getByRole('alert').filter({ hasText: 'Another page owns a different recovery' }).waitFor();
    await page.getByRole('button', { name: 'Close late-receipt.txt' }).click();
    await page.getByRole('tab', { name: /late-receipt.txt/ }).waitFor({ state: 'detached' });
    assert.equal(await newerPage.evaluate(async path => (await (window as any).fixture.fileRecovery('receipt-a', path)).id, receiptPath), newReceiptId);

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'retry',
      request:{id:'retry',scopeId:'retry',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: retryPath });
    await page.waitForFunction(() => { try { return (window as any).fixture.text() === 'base\n'; } catch { return false; } });
    await page.evaluate(() => { (window as any).fixture.hold(); (window as any).fixture.edit(0, 'X'); });
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.waitForFunction(() => (window as any).fixture.held());
    await page.evaluate(() => { (window as any).fixture.failNextAtomTransaction(); (window as any).fixture.edit(1, 'Y'); });
    await page.getByRole('alert').filter({ hasText: 'Could not retain file edits' }).waitFor();
    await page.getByRole('button', { name: 'Review recovery' }).click();
    await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
    await page.evaluate(() => (window as any).fixture.flush());
    const retried = await page.evaluate(async path => (window as any).fixture.fileRecovery('retry', path), retryPath);
    assert.equal(retried.draft, 'XYbase\n');
    assert.equal(Object.hasOwn(retried, 'expectedContents'), false);
    await page.evaluate(() => (window as any).fixture.release());
    await page.getByRole('button', { name: 'Check save result' }).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');

    await page.evaluate(({ path }) => (window as any).fixture.changeRecovery('legacy', path, {
      id:'legacy',checkId:'legacy',submitted:true,phase:'failed',expectedContents:'old field',contents:'old',
      saved:'base\n',draft:'legacy\n',revision:1,extra:{from:'old version'},
    }), { path: legacyPath });
    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'legacy',
      request:{id:'legacy',scopeId:'legacy',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: legacyPath });
    await page.waitForFunction(() => { try { return (window as any).fixture.text() === 'legacy\n'; } catch { return false; } });
    await page.evaluate(() => (window as any).fixture.edit(0, 'X'));
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.waitForFunction(() => !document.querySelector('[role="tab"][aria-selected="true"] [aria-label="Unsaved changes"]'));
    const legacy = await page.evaluate(async path => (window as any).fixture.fileRecovery('legacy', path), legacyPath);
    assert.equal(legacy.expectedContents, 'old field');
    assert.deepEqual(legacy.extra, { from: 'old version' });
    assert.equal(legacy.draft, 'Xlegacy\n');

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'uncertain',
      request:{id:'uncertain',scopeId:'uncertain',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: unknownPath });
    await page.getByRole('textbox', { name: `File: ${unknownPath}` }).waitFor();
    await page.evaluate(() => { (window as any).fixture.loseNextSave(); (window as any).fixture.edit(0, 'U'); });
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
    const unknown = await page.evaluate(async path => (window as any).fixture.fileRecovery('uncertain', path), unknownPath);
    assert.equal(unknown.phase, 'unknown');

    for (const [index, target] of [closeA, closeB].entries()) {
      await page.evaluate(({ cwd, path, id }) => (window as any).fixture.render({scopeId:'close',
        request:{id,scopeId:'close',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: target, id: `close-${index}` });
      await page.getByRole('textbox', { name: `File: ${target}` }).waitFor();
      await page.evaluate(() => (window as any).fixture.edit(0, 'X'));
      await page.getByRole('button', { name: 'Save file' }).click();
      await page.waitForFunction(() => !document.querySelector('[role="tab"][aria-selected="true"] [aria-label="Unsaved changes"]'));
      assert.equal(await page.evaluate(async path => (await (window as any).fixture.fileRecovery('close', path))?.phase, target), 'saved');
      await page.evaluate(() => (window as any).fixture.edit(1, 'Y'));
      await page.evaluate(() => (window as any).fixture.flush());
    }
    const beforeA = await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeA);
    const beforeB = await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeB);
    await page.evaluate(({ cwd }) => (window as any).fixture.render({request:{id:'closing-terminal',scopeId:'close',hostId:'local',cwd,kind:'terminal'}}), { cwd: project });
    await page.getByRole('tab', { name: 'Terminal' }).waitFor();
    await page.getByRole('tab', { name: /close-a.txt/ }).click();
    await page.evaluate(() => (window as any).fixture.terminalClose('fail'));
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'terminal could not be closed' }).waitFor();
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeA), beforeA);
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeB), beforeB);
    assert.equal(await page.evaluate(() => (window as any).fixture.closed()), 0);

    await page.getByRole('textbox', { name: `File: ${closeA}` }).focus();
    await page.evaluate(() => (window as any).fixture.terminalClose('delay'));
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.terminalWaiting());
    await page.evaluate(() => (document.querySelector('.yard-editor-container:not([hidden]) .cm-content') as HTMLElement | null)?.focus());
    await page.keyboard.type('late input');
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');
    await newerPage.evaluate(({ path }) => (window as any).fixture.changeRecovery('close', path, { id: 'other-page-record' }), { path: closeB });
    await newerPage.evaluate(() => (window as any).fixture.holdAtoms());
    await page.evaluate(() => (window as any).fixture.watchAtomTransaction());
    await page.evaluate(() => (window as any).fixture.releaseTerminal());
    await page.waitForFunction(() => (window as any).fixture.sawAtomTransaction());
    await page.evaluate(() => (document.querySelector('.yard-editor-container:not([hidden]) .cm-content') as HTMLElement | null)?.focus());
    await page.keyboard.type('during transaction');
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');
    await newerPage.evaluate(() => (window as any).fixture.releaseAtoms());
    await page.getByRole('alert').filter({ hasText: /atomically|another page/i }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close panel here only' }).isVisible(), true);
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeA), beforeA);
    assert.equal(await page.evaluate(async path => (await (window as any).fixture.fileRecovery('close', path)).id, closeB), 'other-page-record');
    assert.equal(await page.evaluate(() => (window as any).fixture.closed()), 0);
    await newerPage.evaluate(({ path, before }) => (window as any).fixture.changeRecovery('close', path, before), { path: closeB, before: beforeB });
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.closed() === 1);
    assert.equal(await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeA), undefined);
    assert.equal(await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeB), undefined);
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('uncertain', path), unknownPath), unknown);

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'uncertain',
      request:{id:'uncertain-reopen',scopeId:'uncertain',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: unknownPath });
    await page.getByRole('textbox', { name: `File: ${unknownPath}` }).waitFor();
    await page.evaluate(({ cwd }) => (window as any).fixture.render({request:{id:'local-only-terminal',scopeId:'uncertain',hostId:'local',cwd,kind:'terminal'}}), { cwd: project });
    await page.getByRole('tab', { name: 'Terminal' }).waitFor();
    await page.evaluate(() => (window as any).fixture.terminalClose('fail'));
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'terminal could not be closed' }).waitFor();
    await page.evaluate(() => (window as any).fixture.terminalClose('ok'));
    await page.getByRole('button', { name: 'Close panel here only' }).click();
    await page.waitForFunction(() => (window as any).fixture.closed() === 2);
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('uncertain', path), unknownPath), unknown);
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
    await writeFile(join(root, 'failure.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`File recovery browser failure artifacts: ${root}`, { cause: error });
  }
});
