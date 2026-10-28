import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
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
  const acceptPath = join(project, 'accept.txt'), preservePath = join(project, 'preserve.txt'), recreatePath = join(project, 'recreate.txt'), noRestorePath = join(project, 'no-restore.txt');
  await Promise.all([retryPath, legacyPath, unknownPath, closeA, closeB, acceptPath, preservePath, recreatePath, noRestorePath].map(target => writeFile(target, 'base\n')));
  const aliasA = join(project, 'alias-a'), aliasB = join(project, 'alias-b'), link = join(project, 'alias-link');
  await mkdir(aliasA); await mkdir(aliasB); await symlink(aliasA, link);
  const aliasPath = join(link, 'file.txt'), directPath = join(aliasA, 'file.txt'), otherPath = join(aliasB, 'file.txt');
  await writeFile(directPath, 'base\n'); await writeFile(otherPath, 'base\n');
  const heldA = join(project, 'held-a'), heldB = join(project, 'held-b'), heldLink = join(project, 'held-link');
  await mkdir(heldA); await mkdir(heldB); await symlink(heldA, heldLink);
  const heldPath = join(heldLink, 'file.txt');
  await writeFile(join(heldA, 'file.txt'), 'base\n'); await writeFile(join(heldB, 'file.txt'), 'base\n');
  const fake = await createFakeCodex(root), daemon = fileDaemonFixture();
  let release!: () => void, releaseAlias!: () => void, aliasEntered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const aliasGate = new Promise<void>(resolve => { releaseAlias = resolve; });
  const aliasWriting = new Promise<void>(resolve => { aliasEntered = resolve; });
  let writes = 0, completed = false;
  for (const method of fileMethods) fake.handlers.set(method, async params => {
    if (method === 'fs/writeFile' && ++writes === 1) await gate;
    if (method === 'fs/writeFile' && params.path === directPath) { aliasEntered(); await aliasGate; }
    return daemon(method, record(params));
  });
  const { renderer, adapterPath } = await nativeFixture(root);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { EditorView } from '@codemirror/view';
    import { BrowserWorkbenchClient } from './src/renderer/app/client.ts';
    import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
    import { readFileRecovery, updateFileRecovery } from './src/renderer/panels/file-save-recovery.ts';
    import { updateBrowserAtom } from './src/renderer/storage/ui-atoms.ts';
    const client = new BrowserWorkbenchClient();
    const host = client.host.bind(client);
    let holdNext = false, loseNext = false, releaseReceipt, closeMode = 'ok', releaseClose, closeCalls = 0, closed = 0, releaseAtoms, sawAtomTransaction = false;
    const calls = [];
    client.host = async (...args) => {
      calls.push({endpoint:args[0],params:structuredClone(args[1])});
      if (args[0] === 'terminal') {
        if (args[1].operation === 'close') {
          closeCalls++;
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
      recoveryAt(scope, root, target) { return readFileRecovery(JSON.stringify([scope,'local',root,target])); },
      calls() { return calls; }, closeCalls() { return closeCalls; },
      changeRecovery(scope, target, update) {
        return updateBrowserAtom('codex-yard.file-save-recovery.v1:' + JSON.stringify([scope,'local',cwd,target]), value => ({...value,...update}));
      },
      clearRecovery(scope, target) {
        return updateBrowserAtom('codex-yard.file-save-recovery.v1:' + JSON.stringify([scope,'local',cwd,target]), () => null);
      },
      async tryUnchangedRestore(scope, target, confirmed) {
        try {
          await updateFileRecovery(JSON.stringify([scope,'local',cwd,target]), confirmed.id, value => ({...value}), confirmed);
          return null;
        } catch (error) { return error.message; }
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
    release(); releaseAlias();
    await context.close(); await browser.close(); await app.close(); await fake.close();
    if (completed) await rm(root, { recursive: true, force: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const dialogs: string[] = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.accept(); });
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
    await page.getByRole('alert').filter({ hasText: 'Could not retain file recovery' }).waitFor();
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
    await page.getByRole('alert').filter({ hasText: /atomically|another page/i }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close panel here only' }).isVisible(), true);
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('close', path), closeA), beforeA);
    assert.equal(await page.evaluate(async path => (await (window as any).fixture.fileRecovery('close', path)).id, closeB), 'other-page-record');
    assert.equal(await page.evaluate(() => (window as any).fixture.closed()), 0);
    await newerPage.evaluate(({ path, before }) => (window as any).fixture.changeRecovery('close', path, before), { path: closeB, before: beforeB });
    await page.getByRole('tab', { name: /close-b.txt/ }).click();
    await page.getByRole('button', { name: 'Review recovery' }).click();
    await page.getByRole('button', { name: 'Review recovery' }).waitFor({ state: 'detached' });
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
    await page.getByRole('tab', { name: /unknown.txt/ }).click();
    await page.evaluate(() => { (window as any).fixture.failNextAtomTransaction(); (window as any).fixture.edit(1, 'N'); });
    await page.getByRole('alert').filter({ hasText: 'Could not retain file edits' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'UNbase\n');
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('uncertain', path), unknownPath), unknown);
    await page.evaluate(() => (window as any).fixture.terminalClose('fail'));
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'terminal could not be closed' }).waitFor();
    const closeCalls = await page.evaluate(() => (window as any).fixture.closeCalls());
    await page.getByRole('button', { name: 'Close panel here only' }).click();
    await page.waitForFunction(() => (window as any).fixture.closed() === 2);
    await page.getByRole('tab', { name: 'Terminal' }).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => (window as any).fixture.closeCalls()), closeCalls);
    assert.match(dialogs.at(-1)!, /terminal may still be running.*Copy unsaved local edits/i);
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('uncertain', path), unknownPath), unknown);

    for (const [scope, target, editFirst] of [['accept-first-read', acceptPath, false], ['preserve-first-read', preservePath, true]] as const) {
      await newerPage.evaluate(({ cwd, path, scope }) => (window as any).fixture.render({scopeId:scope,cwd,
        request:{id:scope,scopeId:scope,hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: target, scope });
      await newerPage.getByRole('textbox', { name: `File: ${target}` }).waitFor();
      await newerPage.evaluate(() => (window as any).fixture.edit(0, 'X'));
      await newerPage.getByRole('button', { name: 'Save file' }).click();
      await newerPage.waitForFunction(() => !document.querySelector('[role="tab"][aria-selected="true"] [aria-label="Unsaved changes"]'));
      await newerPage.evaluate(() => (window as any).fixture.edit(1, 'Y'));
      await newerPage.evaluate(() => (window as any).fixture.flush());
      const other = await newerPage.evaluate(async ({ scope, path }) => (window as any).fixture.fileRecovery(scope, path), { scope, path: target });
      assert.equal(other.draft, 'XYbase\n');
      await page.evaluate(({ cwd, path, scope }) => { (window as any).fixture.failNextAtomTransaction();
        (window as any).fixture.render({scopeId:scope,cwd,request:{id:scope,scopeId:scope,hostId:'local',cwd,kind:'file',path}}); }, { cwd: project, path: target, scope });
      await page.getByRole('alert').filter({ hasText: 'File recovery is unavailable' }).waitFor();
      assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'Xbase\n');
      if (editFirst) await page.evaluate(() => (window as any).fixture.edit(0, 'mine '));
      await page.getByRole('button', { name: 'Review recovery' }).click();
      if (editFirst) {
        await page.getByRole('alert').filter({ hasText: 'Another page owns a different recovery' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'mine Xbase\n');
        assert.deepEqual(await newerPage.evaluate(async ({ scope, path }) => (window as any).fixture.fileRecovery(scope, path), { scope, path: target }), other);
      } else {
        await page.getByRole('button', { name: 'Review recovery' }).waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');
        assert.deepEqual(await page.evaluate(async ({ scope, path }) => (window as any).fixture.fileRecovery(scope, path), { scope, path: target }), other);
      }
    }

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'recreate',cwd,
      request:{id:'recreate',scopeId:'recreate',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: recreatePath });
    await page.getByRole('textbox', { name: `File: ${recreatePath}` }).waitFor();
    await page.evaluate(() => (window as any).fixture.edit(0, 'X'));
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.waitForFunction(() => !document.querySelector('[role="tab"][aria-selected="true"] [aria-label="Unsaved changes"]'));
    const confirmed = await page.evaluate(async path => (window as any).fixture.fileRecovery('recreate', path), recreatePath);
    await newerPage.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'recreate',cwd,
      request:{id:'recreate-other',scopeId:'recreate',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: recreatePath });
    await newerPage.getByRole('textbox', { name: `File: ${recreatePath}` }).waitFor();
    assert.equal(await newerPage.evaluate(async path => (window as any).fixture.fileRecovery('recreate', path), recreatePath), undefined);
    assert.match(await page.evaluate(async ({ path, confirmed }) => (window as any).fixture.tryUnchangedRestore('recreate', path, confirmed),
      { path: recreatePath, confirmed }), /File recovery changed in another page/);
    assert.equal(await page.evaluate(async path => (window as any).fixture.fileRecovery('recreate', path), recreatePath), undefined);
    await page.evaluate(() => (window as any).fixture.edit(1, 'Y'));
    await page.waitForFunction(async path => (await (window as any).fixture.fileRecovery('recreate', path))?.draft === 'XYbase\n', recreatePath);
    const recreated = await page.evaluate(async path => (window as any).fixture.fileRecovery('recreate', path), recreatePath);
    assert.equal(recreated.id, confirmed.id);
    assert.equal(recreated.draft, 'XYbase\n');
    assert.equal(recreated.revision, confirmed.revision + 1);

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'no-restore',cwd,
      request:{id:'no-restore',scopeId:'no-restore',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: noRestorePath });
    await page.getByRole('textbox', { name: `File: ${noRestorePath}` }).waitFor();
    await page.evaluate(() => { (window as any).fixture.loseNextSave(); (window as any).fixture.edit(0, 'X'); });
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
    await newerPage.evaluate(path => (window as any).fixture.clearRecovery('no-restore', path), noRestorePath);
    await page.evaluate(() => (window as any).fixture.edit(1, 'Y'));
    await page.getByRole('alert').filter({ hasText: 'Could not retain file edits' }).waitFor();
    assert.equal(await page.evaluate(async path => (window as any).fixture.fileRecovery('no-restore', path), noRestorePath), undefined);
    await page.getByRole('button', { name: 'Review recovery' }).click();
    await page.getByRole('alert').filter({ hasText: 'Another page owns a different recovery' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');
    assert.equal(await page.evaluate(async path => (window as any).fixture.fileRecovery('no-restore', path), noRestorePath), undefined);

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'alias-original',cwd,
      request:{id:'alias-original',scopeId:'alias-original',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: aliasPath });
    await page.getByRole('textbox', { name: `File: ${aliasPath}` }).waitFor();
    await page.evaluate(() => (window as any).fixture.edit(0, 'A'));
    await page.getByRole('button', { name: 'Save file' }).click();
    await aliasWriting;
    await page.evaluate(() => (window as any).fixture.client.suspend());
    await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
    await page.evaluate(() => (window as any).fixture.client.resume());
    const aliasId = await page.evaluate(async path => (await (window as any).fixture.fileRecovery('alias-original', path)).id, aliasPath);
    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'alias-other',cwd,
      request:{id:'alias-other',scopeId:'alias-other',hostId:'local',cwd,kind:'file',path}}), { cwd: aliasA, path: directPath });
    await page.getByRole('textbox', { name: `File: ${directPath}` }).waitFor();
    await page.evaluate(() => (window as any).fixture.edit(0, 'B'));
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByRole('alert').filter({ hasText: 'Another save' }).waitFor();
    const aliasRecovery = await page.evaluate(async ({ cwd, path }) => (window as any).fixture.recoveryAt('alias-other', cwd, path), { cwd: aliasA, path: directPath });
    assert.equal(aliasRecovery.checkId, aliasId);
    assert.deepEqual(aliasRecovery.query, { cwd: project, path: aliasPath });
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'still unknown' }).waitFor();
    const statusCall = await page.evaluate(() => (window as any).fixture.calls().filter((call: any) => call.endpoint === 'workspace-file-save-status').at(-1).params);
    assert.equal(statusCall.cwd, aliasA);
    assert.equal(statusCall.path, directPath);
    assert.equal(statusCall.queryCwd, project);
    assert.equal(statusCall.queryPath, aliasPath);
    await unlink(link); await symlink(aliasB, link);
    releaseAlias();
    await page.waitForFunction(async ({ cwd, path, id, queryCwd, queryPath }) =>
      (await (window as any).fixture.client.host('workspace-file-save-status', {hostId:'local',cwd,path,operationId:id,queryCwd,queryPath})).outcome === 'conflict',
    { cwd: aliasA, path: directPath, id: aliasId, queryCwd: project, queryPath: aliasPath });
    assert.equal(await readFile(directPath, 'utf8'), 'Abase\n');
    assert.equal(await readFile(otherPath, 'utf8'), 'base\n');
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    const aliasTerminal = await page.evaluate(async ({ cwd, path }) => (window as any).fixture.recoveryAt('alias-other', cwd, path), { cwd: aliasA, path: directPath });
    assert.equal(aliasTerminal.phase, 'conflict');
    assert.equal((await page.evaluate(({ cwd, path, id, queryCwd, queryPath }) => (window as any).fixture.client.host('workspace-file-save-status',
      {hostId:'local',cwd,path,operationId:id,queryCwd,queryPath}), {cwd:aliasA,path:directPath,id:aliasId,queryCwd:project,queryPath:aliasPath})).targetMatch, 'same');
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    await page.evaluate(({ cwd }) => (window as any).fixture.render({scopeId:'alias-original',cwd,request:null}), { cwd: project });
    await page.getByRole('textbox', { name: `File: ${aliasPath}` }).waitFor();
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    const switched = await page.evaluate(async path => (window as any).fixture.fileRecovery('alias-original', path), aliasPath);
    assert.equal(switched.phase, 'conflict');
    assert.equal((await page.evaluate(({ cwd, path, id }) => (window as any).fixture.client.host('workspace-file-save-status',
      {hostId:'local',cwd,path,operationId:id}), {cwd:project,path:aliasPath,id:aliasId})).targetMatch, 'different');
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'Abase\n');
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    await page.getByRole('textbox', { name: `File: ${aliasPath}` }).press('Control+s');
    assert.equal(await readFile(otherPath, 'utf8'), 'base\n');

    await page.reload();
    await page.getByRole('textbox', { name: `File: ${path}` }).waitFor();
    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'alias-original',cwd,
      request:{id:'alias-refresh',scopeId:'alias-original',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: aliasPath });
    await page.getByRole('textbox', { name: `File: ${aliasPath}` }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'Abase\n');

    await unlink(link); await symlink(aliasA, link);
    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'alias-guard',cwd,
      request:{id:'alias-guard',scopeId:'alias-guard',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: aliasPath });
    await page.getByRole('textbox', { name: `File: ${aliasPath}` }).waitFor();
    await page.evaluate(() => (window as any).fixture.edit(0, 'G'));
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.waitForFunction(() => !document.querySelector('[role="tab"][aria-selected="true"] [aria-label="Unsaved changes"]'));
    assert.equal(await readFile(directPath, 'utf8'), 'GAbase\n');
    await writeFile(otherPath, 'GAbase\n');
    await unlink(link); await symlink(aliasB, link);
    const writesBeforeGuard = writes;
    await page.evaluate(() => (window as any).fixture.edit(0, 'H'));
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.equal(writes, writesBeforeGuard);
    assert.equal(await readFile(otherPath, 'utf8'), 'GAbase\n');
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);

    await page.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'held-conflict',cwd,
      request:{id:'held-conflict',scopeId:'held-conflict',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: heldPath });
    await page.getByRole('textbox', { name: `File: ${heldPath}` }).waitFor();
    await page.evaluate(() => { (window as any).fixture.hold(); (window as any).fixture.edit(0, 'X'); });
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.waitForFunction(() => (window as any).fixture.held());
    await page.evaluate(() => (window as any).fixture.edit(1, 'Y'));
    await page.waitForFunction(async path => (await (window as any).fixture.fileRecovery('held-conflict', path))?.draft === 'XYbase\n', heldPath);
    await newerPage.evaluate(({ cwd, path }) => (window as any).fixture.render({scopeId:'held-conflict',cwd,
      request:{id:'held-conflict-other',scopeId:'held-conflict',hostId:'local',cwd,kind:'file',path}}), { cwd: project, path: heldPath });
    await newerPage.getByRole('textbox', { name: `File: ${heldPath}` }).waitFor();
    await unlink(heldLink); await symlink(heldB, heldLink);
    await newerPage.getByRole('button', { name: 'Check save result' }).click();
    await newerPage.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    const heldConflict = await newerPage.evaluate(async path => (window as any).fixture.fileRecovery('held-conflict', path), heldPath);
    assert.equal(heldConflict.phase, 'conflict');
    const heldStatus = await newerPage.evaluate(({ cwd, path, id }) => (window as any).fixture.client.host('workspace-file-save-status',
      {hostId:'local',cwd,path,operationId:id}), {cwd:project,path:heldPath,id:heldConflict.checkId});
    assert.equal(heldStatus.outcome, 'saved'); assert.equal(heldStatus.targetMatch, 'different');
    assert.equal(heldConflict.draft, 'XYbase\n');
    assert.equal(await readFile(join(heldB, 'file.txt'), 'utf8'), heldConflict.saved);
    await page.evaluate(() => (window as any).fixture.release());
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.deepEqual(await page.evaluate(async path => (window as any).fixture.fileRecovery('held-conflict', path), heldPath), heldConflict);
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    await page.getByRole('textbox', { name: `File: ${heldPath}` }).press('Control+s');
    assert.equal(await readFile(join(heldB, 'file.txt'), 'utf8'), 'base\n');
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
    await writeFile(join(root, 'failure.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`File recovery browser failure artifacts: ${root}`, { cause: error });
  }
});
