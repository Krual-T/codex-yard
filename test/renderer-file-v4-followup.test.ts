import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

async function waitForBrowser(check: () => Promise<unknown>) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for the asynchronous browser condition.');
}

test('file recovery protects distinct page drafts and follows durable host receipts', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-v4-followup-');
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { EditorView } from '@codemirror/view';
    import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
    import { readFileRecovery } from './src/renderer/panels/file-save-recovery.ts';
    import { updateBrowserAtom } from './src/renderer/storage/ui-atoms.ts';
    const state = { calls:[], files:{}, mode:'saved', status:'saved', closed:0, release:null, releaseStatus:null };
    let barrier;
    function failNextTransaction() {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        IDBDatabase.prototype.transaction = original;
        throw new Error('synthetic storage failure');
      };
    }
    const client = {
      async host(endpoint, params = {}) {
        state.calls.push({endpoint, params:structuredClone(params)});
        const contents = () => state.files[params.path] ?? 'base\\n';
        if (endpoint === 'workspace-directory-entries') return {entries:[]};
        if (endpoint === 'workspace-files') return {text:contents()};
        if (endpoint === 'read-file-binary') return {contentsBase64:btoa(contents()),mimeType:'text/plain'};
        if (endpoint === 'workspace-file-save') {
          if (state.mode === 'held') return new Promise(resolve => { state.release = () => resolve({outcome:'saved'}); });
          if (state.mode === 'lost') throw new Error('synthetic lost response');
          if (state.mode === 'failed') return {outcome:'failed',operationId:params.operationId,error:'synthetic daemon failure'};
          if (state.mode === 'pre-error') throw Object.assign(new Error('synthetic pre-receipt failure'),{uncertain:false});
          if (state.mode === 'guard' && params.guardOperationId) return {outcome:'conflict'};
          state.files[params.path] = params.contents;
          if (state.mode === 'storage-fail') failNextTransaction();
          return {outcome:'saved'};
        }
        if (endpoint === 'workspace-file-save-status') {
          if (state.status === 'hold-blocked') return new Promise(resolve => {
            state.releaseStatus = () => resolve({outcome:'blocked',operationId:'original-operation',query:{cwd:'/original',path:'/original/link.txt'}});
          });
          if (state.status === 'blocked' && !params.queryCwd) return {outcome:'blocked',operationId:'original-operation',query:{cwd:'/original',path:'/original/link.txt'}};
          if (state.status === 'blocked') return {outcome:'failed',targetMatch:'same'};
          if (state.status === 'different') return {outcome:'saved',targetMatch:'different'};
          return {outcome:state.status,targetMatch:'same'};
        }
        throw new Error('Unexpected synthetic endpoint ' + endpoint);
      },
      subscribe() { return () => {}; },
    };
    let props = {client,scopeId:'initial',hostId:'local',cwd:'/w',appearance:{theme:'light',codeFontSize:13,codeLineHeight:20},
      request:null,onRequestConsumed() {},onClose() {state.closed++;},onRecoveryBarrier(value) {barrier = value;}};
    let requestId = 0;
    const root = createRoot(document.getElementById('root'));
    function render() { root.render(React.createElement(WorkspacePanels, props)); }
    const key = (scope, path) => JSON.stringify([scope,'local','/w',path]);
    window.fixture = {
      state,
      open(scope, path) { props = {...props,scopeId:scope,request:{id:String(++requestId),scopeId:scope,hostId:'local',cwd:'/w',kind:'file',path}}; render(); },
      edit(at, text) { const view = EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content')); view.dispatch({changes:{from:at,insert:text}}); },
      text() { return EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content')).state.doc.toString(); },
      recovery(scope, path) { return readFileRecovery(key(scope,path)); },
      changeRecovery(scope, path, update) { return updateBrowserAtom('codex-yard.file-save-recovery.v1:' + key(scope,path), value => ({...value,...update})); },
      flush() { if (!barrier) throw new Error('missing recovery barrier'); return barrier(); },
    };
    render();
  ` }, bundle: true, write: false, format: 'iife', outdir: 'file-followup-fixture', loader: { '.css': 'css' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  const contexts: BrowserContext[] = [];
  let completed = false;
  t.after(async () => { await Promise.all(contexts.map(context => context.close())); await browser.close(); if (completed) await rm(root, { recursive: true, force: true }); });
  async function mount(page: Page) {
    await page.addStyleTag({ content: 'html,body,#root{height:100%;margin:0}' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
  }
  async function newPage(context: BrowserContext) {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.route('http://127.0.0.1:47838/**', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><html><body><div id="root"></div></body></html>' }));
    await page.goto('http://127.0.0.1:47838/');
    await mount(page);
    return page;
  }
  async function makeContext() { const context = await browser.newContext({ viewport:{width:1100,height:760} }); contexts.push(context); return context; }
  async function open(page: Page, scope: string, path: string) {
    await page.evaluate(({scope,path}) => (window as any).fixture.open(scope,path), {scope,path});
    await page.getByRole('textbox', {name:`File: ${path}`}).waitFor();
  }
  const dialogs: string[] = [];
  function confirm(page: Page) { page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.accept(); }); }
  let page: Page | undefined;
  try {
    const shared = await makeContext();
    page = await newPage(shared); const other = await newPage(shared); confirm(page); confirm(other);
    await open(page, 'shared', '/w/shared.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'held'; f.edit(0,'X'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.waitForFunction(() => !!(window as any).fixture.state.release);
    await page.evaluate(() => (window as any).fixture.edit(1,'Y'));
    await waitForBrowser(() => page!.evaluate(async () => (await (window as any).fixture.recovery('shared','/w/shared.txt'))?.draft === 'XYbase\n'));
    await open(other, 'shared', '/w/shared.txt');
    await other.evaluate(() => { const f = (window as any).fixture; f.state.status = 'different'; f.edit(0,'B'); });
    await other.evaluate(() => (window as any).fixture.flush());
    await other.getByRole('button', {name:'Check save result'}).click();
    await other.getByRole('alert').filter({hasText:'File changed on disk'}).waitFor();
    const otherRecord = await other.evaluate(() => (window as any).fixture.recovery('shared','/w/shared.txt'));
    assert.equal(otherRecord.draft, 'BXYbase\n'); assert.equal(otherRecord.phase, 'conflict');
    await page.evaluate(() => (window as any).fixture.state.release());
    await page.getByRole('alert').filter({hasText:'Another page owns a different recovery'}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'XYbase\n');
    await assert.rejects(page.evaluate(() => (window as any).fixture.flush()), /Another page owns a different recovery/);
    await page.getByRole('button', {name:'Review recovery'}).click();
    await page.getByRole('alert').filter({hasText:'Another page owns a different recovery'}).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.recovery('shared','/w/shared.txt')), otherRecord);
    await page.getByRole('button', {name:'Close shared.txt'}).click();
    await page.getByRole('tab', {name:/shared.txt/}).waitFor({state:'detached'});
    assert.match(dialogs.at(-1)!, /Copy unsaved local edits first/);
    assert.deepEqual(await other.evaluate(() => (window as any).fixture.recovery('shared','/w/shared.txt')), otherRecord);

    page = await newPage(await makeContext()); confirm(page);
    await open(page, 'atomic', '/w/a.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'failed'; f.edit(0,'A'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'synthetic daemon failure'}).waitFor();
    const first = await page.evaluate(() => (window as any).fixture.recovery('atomic','/w/a.txt'));
    assert.equal(first.guardOperationId, first.id);
    await open(page, 'atomic', '/w/b.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'lost'; f.edit(0,'B'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    const originalSecond = await page.evaluate(() => (window as any).fixture.recovery('atomic','/w/b.txt'));
    await page.evaluate(() => (window as any).fixture.changeRecovery('atomic','/w/b.txt',{draft:'other page',revision:99}));
    const second = await page.evaluate(() => (window as any).fixture.recovery('atomic','/w/b.txt'));
    await page.getByRole('button', {name:'Close panel',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'File recovery changed in another page'}).first().waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.closed), 0);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.recovery('atomic','/w/a.txt')), first);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.recovery('atomic','/w/b.txt')), second);
    await assert.rejects(page.evaluate(() => (window as any).fixture.flush()), /File recovery changed in another page/);
    await page.evaluate(record => (window as any).fixture.changeRecovery('atomic','/w/b.txt',record), originalSecond);
    await page.getByRole('button', {name:'Review recovery'}).click();
    await page.getByRole('button', {name:'Review recovery'}).waitFor({state:'detached'});
    await page.evaluate(() => (window as any).fixture.flush());

    page = await newPage(await makeContext()); confirm(page);
    await open(page, 'failed', '/w/alias.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'failed'; f.edit(0,'A'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'synthetic daemon failure'}).waitFor();
    const failed = await page.evaluate(() => (window as any).fixture.recovery('failed','/w/alias.txt'));
    await page.evaluate(() => { (window as any).fixture.state.mode = 'pre-error'; });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'synthetic pre-receipt failure'}).waitFor();
    const preReceipt = await page.evaluate(() => (window as any).fixture.recovery('failed','/w/alias.txt'));
    assert.equal(preReceipt.guardOperationId, failed.id);
    await page.evaluate(() => { (window as any).fixture.state.mode = 'guard'; });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'File changed on disk'}).waitFor();
    const attempts = await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.endpoint === 'workspace-file-save'));
    assert.equal(attempts.length, 3); assert.equal(attempts[1].params.guardOperationId, failed.id); assert.equal(attempts[2].params.guardOperationId, failed.id);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.files['/w/alias.txt']), undefined);

    page = await newPage(await makeContext()); confirm(page);
    await open(page, 'blocked', '/w/lost.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'lost'; f.state.status = 'blocked'; f.edit(0,'L'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    const submitted = await page.evaluate(() => (window as any).fixture.recovery('blocked','/w/lost.txt'));
    await page.evaluate(() => (window as any).fixture.changeRecovery('blocked','/w/lost.txt',
      {terminalOutcome:'saved',targetMatch:'different',futureField:{kept:true}}));
    await page.reload(); await mount(page);
    await page.evaluate(() => { (window as any).fixture.state.status = 'blocked'; });
    await open(page, 'blocked', '/w/lost.txt');
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    await page.getByRole('button', {name:'Check save result'}).click();
    await waitForBrowser(() => page!.evaluate(async () => (await (window as any).fixture.recovery('blocked','/w/lost.txt'))?.phase === 'failed'));
    const recovered = await page.evaluate(() => (window as any).fixture.recovery('blocked','/w/lost.txt'));
    assert.equal(recovered.id, submitted.id); assert.equal(recovered.checkId, 'original-operation');
    assert.deepEqual(recovered.query, {cwd:'/original',path:'/original/link.txt'}); assert.equal(recovered.submitted, false);
    assert.equal(recovered.guardOperationId, 'original-operation');
    assert.equal(recovered.terminalOutcome, 'saved'); assert.equal(recovered.targetMatch, 'different');
    assert.deepEqual(recovered.futureField, {kept:true});
    const statuses = await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.endpoint === 'workspace-file-save-status'));
    assert.equal(statuses.length, 2); assert.equal(statuses[0].params.operationId, submitted.id);
    assert.deepEqual(statuses[1].params, {hostId:'local',cwd:'/w',path:'/w/lost.txt',operationId:'original-operation',queryCwd:'/original',queryPath:'/original/link.txt'});
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.endpoint === 'workspace-file-save').length), 0);

    page = await newPage(await makeContext()); confirm(page);
    await open(page, 'lost-conflict', '/w/conflict.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'lost'; f.state.status = 'conflict'; f.edit(0,'C'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    await page.reload(); await mount(page);
    await page.evaluate(() => { (window as any).fixture.state.status = 'conflict'; });
    await open(page, 'lost-conflict', '/w/conflict.txt');
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    await page.getByRole('button', {name:'Check save result'}).click();
    await page.getByRole('alert').filter({hasText:'File changed on disk'}).waitFor();
    assert.equal(await page.getByRole('button', {name:'Save file'}).isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.endpoint === 'workspace-file-save').length), 0);

    const racing = await makeContext();
    page = await newPage(racing); const racingOther = await newPage(racing); confirm(page); confirm(racingOther);
    await open(page, 'status-race', '/w/status-race.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'lost'; f.state.status = 'hold-blocked'; f.edit(0,'R'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    await page.getByRole('button', {name:'Check save result'}).click();
    await page.waitForFunction(() => !!(window as any).fixture.state.releaseStatus);
    await open(racingOther, 'status-race', '/w/status-race.txt');
    await racingOther.evaluate(() => { (window as any).fixture.state.status = 'failed'; });
    await racingOther.getByRole('button', {name:'Check save result'}).click();
    await waitForBrowser(() => racingOther.evaluate(async () => (await (window as any).fixture.recovery('status-race','/w/status-race.txt'))?.phase === 'failed'));
    const terminalRecord = await racingOther.evaluate(() => (window as any).fixture.recovery('status-race','/w/status-race.txt'));
    await page.evaluate(() => (window as any).fixture.state.releaseStatus());
    await page.getByRole('alert').filter({hasText:'File recovery changed in another page'}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.endpoint === 'workspace-file-save-status').length), 1);
    await assert.rejects(page.evaluate(() => (window as any).fixture.flush()), /File recovery changed in another page/);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.recovery('status-race','/w/status-race.txt')), terminalRecord);
    await page.getByRole('button', {name:'Review recovery'}).click();
    await page.getByRole('button', {name:'Review recovery'}).waitFor({state:'detached'});
    await page.evaluate(() => (window as any).fixture.flush());

    page = await newPage(await makeContext()); confirm(page);
    await open(page, 'storage', '/w/storage.txt');
    await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'storage-fail'; f.edit(0,'S'); });
    await page.getByRole('button', {name:'Save file'}).click();
    await page.getByRole('alert').filter({hasText:'Could not retain file recovery'}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.text()), 'Sbase\n');
    await page.getByRole('button', {name:'Review recovery'}).click();
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    await page.evaluate(() => (window as any).fixture.flush());
    await page.getByRole('button', {name:'Check save result'}).click();
    await waitForBrowser(() => page!.evaluate(async () => (await (window as any).fixture.recovery('storage','/w/storage.txt'))?.phase === 'saved'));
    await page.evaluate(() => (window as any).fixture.flush());
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.endpoint === 'workspace-file-save').length), 1);
    assert.equal(await page.getByRole('button', {name:'Save file'}).isDisabled(), true);
    completed = true;
  } catch (error) {
    await page?.screenshot({ path: join(root,'failure.png') }).catch(() => {});
    await writeFile(join(root,'failure.txt'), String(error));
    throw new Error(`File recovery follow-up artifacts: ${root}`, {cause:error});
  }
});
