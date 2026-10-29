import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

test('composer drafts commit and recover across isolated renderer pages', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 150_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, bindComposerDraftToThread, readComposerDraft, clearComposerDraftRevision } from './src/renderer/composer/StandaloneComposer.tsx';
    import { readComposerDraftVersions, composerDraftAtomKey } from './src/renderer/composer/composer-draft-store.ts';
    import { readBrowserAtom, readBrowserAtoms } from './src/renderer/storage/ui-atoms.ts';
    const state={controller:null,snapshots:[],submissions:[],consumed:[]};
    const client={async rpc(method){
      if(method==='model/list'||method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};
      throw Error('Unexpected RPC '+method);
    },async host(method,params){if(method==='get-setting')return {value:params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
      throw Error('Unexpected host '+method);},subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let resolveSubmit, rejectSubmit;
    let props={client,context:{hostId:'local',threadId:'thread-1',draftId:'thread-1',cwd:'/fixture'},busy:false,
      initialOptions:{permissionProfileId:'profile-existing',sandboxMode:'read-only',approvalsReviewer:'user',
        approvalPolicy:{granular:{sandbox_approval:true,rules:false,skill_approval:true,request_permissions:false,mcp_elicitations:true}}},
      onDraftController(value){state.controller=value},onDraftChange(value){state.snapshots.push(value)},
      onPrefillConsumed(id){state.consumed.push(id)},
      onSubmit(draft,options,action,description){state.submissions.push(structuredClone({draft,options,action,description}));
        return new Promise((resolve,reject)=>{resolveSubmit=resolve;rejectSubmit=reject});},async onInterrupt(){}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,bindComposerDraftToThread,readComposerDraft,readComposerDraftVersions,clearComposerDraftRevision,readBrowserAtom,readBrowserAtoms,composerDraftAtomKey,
      render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));},
      resolveSubmit(){resolveSubmit()},rejectSubmit(){rejectSubmit(Error('fixture unknown response'))},
      async hold(){
        const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('codex-yard.ui-atoms.v1',1);
          req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve()}});
        await new Promise((resolve,reject)=>{let first=true;const loop=()=>{const req=store.get('native-atoms');
          req.onerror=()=>reject(req.error);req.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve()}}};loop()});
        this.release=()=>{released=true;return done};
      },
      failWrites(){this.put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){
        if(this.name==='atoms')throw Error('fixture quota');return window.fixture.put.apply(this,args)}},
      failFirstWrite(){this.put=IDBObjectStore.prototype.put;let failed=false;IDBObjectStore.prototype.put=function(...args){
        if(this.name==='atoms'&&!failed){failed=true;throw Error('fixture quota')}return window.fixture.put.apply(this,args)}},
      restoreWrites(){IDBObjectStore.prototype.put=this.put},
      trackTransactions(){this.transaction=IDBDatabase.prototype.transaction;this.transactions=0;
        IDBDatabase.prototype.transaction=function(...args){window.fixture.transactions++;return window.fixture.transaction.apply(this,args)}},
      restoreTransactions(){IDBDatabase.prototype.transaction=this.transaction}
    };
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const script = bundle.outputFiles[0]!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  async function setup(context: BrowserContext, initial?: { native?: string; archive?: Record<string, string> }): Promise<Page> {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    if (initial) await page.evaluate(value => {
      if (value.native !== undefined) localStorage.setItem('native-atoms', value.native);
      for (const [key, raw] of Object.entries(value.archive ?? {})) localStorage.setItem(key, raw);
    }, initial);
    await page.addScriptTag({ content: script });
    return page;
  }
  async function mount(page: Page, changes: unknown = {}) {
    await page.evaluate(changes => (window as any).fixture.render(changes), changes);
    await page.waitForFunction(() => (window as any).fixture.state.snapshots.length > 0);
  }
  async function saved(page: Page) { await page.waitForFunction(() => {
    const f = (window as any).fixture, snapshot = f.state.controller?.snapshot();
    return snapshot && f.state.snapshots.some((value: any) => value.revision === snapshot.revision);
  }); }
  try {
    await t.test('two pages preserve divergent edits and separate new draft IDs after refresh', async () => {
      const context = await browser.newContext();
      try {
        const a = await setup(context), b = await setup(context), blocker = await setup(context);
        await mount(a); await mount(b);
        const trace = await browser.newBrowserCDPSession();
        const events: unknown[] = [];
        trace.on('Tracing.dataCollected', payload => events.push(...payload.value));
        await trace.send('Tracing.start', { categories: 'blink.user_timing', options: 'record-as-much-as-possible' });
        await a.evaluate(() => performance.mark('draft-fixture-page-a'));
        await b.evaluate(() => performance.mark('draft-fixture-page-b'));
        const complete = new Promise<void>(resolve => trace.once('Tracing.tracingComplete', () => resolve()));
        await trace.send('Tracing.end'); await complete; await trace.detach();
        const processFor = (name: string) => events.find((value): value is { name: string; pid: number } =>
          value !== null && typeof value === 'object' && 'name' in value && value.name === name
          && 'pid' in value && typeof value.pid === 'number')?.pid;
        const processA = processFor('draft-fixture-page-a'), processB = processFor('draft-fixture-page-b');
        assert.ok(processA && processB, 'renderer trace marks were recorded');
        assert.notEqual(processA, processB, 'the competing pages use different renderer processes');
        t.diagnostic('Competing renderer process IDs: ' + processA + ', ' + processB);
        await blocker.evaluate(() => (window as any).fixture.hold());
        const editorA = a.getByRole('textbox', { name: '和 Codex 一起工作' });
        const editorB = b.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editorA.fill('page A'); await editorB.fill('page B');
        await a.getByText('正在保存草稿…').waitFor(); await b.getByText('正在保存草稿…').waitFor();
        await a.evaluate(() => { const f = (window as any).fixture; f.flushed = false;
          f.flushResult = f.state.controller.flush(f.state.controller.snapshot().owner).then((value: boolean) => { f.flushed = true; return value; }); });
        assert.equal(await a.evaluate(() => (window as any).fixture.flushed), false);
        await blocker.evaluate(() => (window as any).fixture.release());
        assert.equal(await a.evaluate(() => (window as any).fixture.flushResult), true);
        await saved(a); await saved(b);
        await a.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();
        const versions = await a.evaluate(async () => {
          const f = (window as any).fixture;
          return (await f.readComposerDraftVersions(f.state.controller.snapshot().owner)).versions.map((v: any) => v.draft.text).sort();
        });
        assert.deepEqual(versions, ['page A', 'page B']);
        await a.reload(); await a.addScriptTag({ content: script }); await mount(a);
        await a.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();
        await a.getByText('选择草稿版本').click();
        const initial = await editorA.inputValue();
        const selected = initial === 'page A' ? 'page B' : 'page A';
        await a.getByRole('button', { name: selected }).click();
        await a.waitForFunction(value => (window as any).fixture.state.controller.snapshot().draft.text === value, selected);
        assert.equal(await editorA.inputValue(), selected);
        await a.getByRole('button', { name: '发送', exact: true }).click();
        await a.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const sent = await a.evaluate(() => (window as any).fixture.state.submissions[0]);
        assert.deepEqual(sent.description.overrides, {});
        await a.evaluate(() => (window as any).fixture.resolveSubmit());
        await a.getByRole('button', { name: '发送', exact: true }).waitFor();
        const remaining = await a.evaluate(async s => {
          const f = (window as any).fixture; return (await f.readComposerDraftVersions(s.owner)).versions.map((v: any) => v.draft.text);
        }, sent.description);
        assert.deepEqual(remaining, [initial]);
        await a.evaluate(() => (window as any).fixture.render({ context: { threadId: null, draftId: 'new-a' } }));
        await b.evaluate(() => (window as any).fixture.render({ context: { threadId: null, draftId: 'new-b' } }));
        await a.waitForFunction(() => (window as any).fixture.state.controller.snapshot().owner.draftId === 'new-a');
        await b.waitForFunction(() => (window as any).fixture.state.controller.snapshot().owner.draftId === 'new-b');
        await editorA.fill('new A'); await editorB.fill('new B'); await saved(a); await saved(b);
        await a.reload(); await a.addScriptTag({ content: script });
        await mount(a, { context: { threadId: null, draftId: 'new-a' } });
        assert.equal(await editorA.inputValue(), 'new A');
        await b.reload(); await b.addScriptTag({ content: script });
        await mount(b, { context: { threadId: null, draftId: 'new-b' } });
        assert.equal(await editorB.inputValue(), 'new B');
      } finally { await context.close(); }
    });

    await t.test('a created thread explicitly adopts the submitted owner without losing a newer draft', async () => {
      const context = await browser.newContext();
      try {
        const page = await setup(context);
        await mount(page, { context: { hostId: 'ssh-fixture', threadId: null, draftId: 'new-fixture' } });
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('submitted A'); await saved(page);
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const submission = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
        const original = submission.description.owner;
        const created = { ...original, threadId: 'created-thread' };
        assert.deepEqual(original, { hostId: 'ssh-fixture', threadId: null, draftId: 'new-fixture' });
        await editor.fill('newer B'); await saved(page);
        const newer = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), created), null);
        const invalid = await page.evaluate(async ({ original, created }) => {
          const bind = (window as any).fixture.bindComposerDraftToThread;
          const failure = async (owner: any, threadId: string) => {
            try { await bind(owner, threadId); return 'unexpected success'; } catch (error) { return (error as Error).message; }
          };
          return [await failure({ ...original, draftId: 'unknown-draft' }, created.threadId),
            await failure({ ...original, threadId: 'existing-thread' }, created.threadId), await failure(original, '  ')];
        }, { original, created });
        assert.match(invalid[0], /尚未初始化/);
        assert.match(invalid[1], /原始新会话身份/);
        assert.match(invalid[2], /线程 ID/);

        const rejected = await page.evaluate(async ({ original, created }) => {
          const f = (window as any).fixture;
          f.failWrites();
          try { await f.bindComposerDraftToThread(original, created.threadId); return 'unexpected success'; }
          catch (error) { return (error as Error).message; }
          finally { f.restoreWrites(); }
        }, { original, created });
        assert.match(rejected, /quota/);
        assert.equal(await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), created), null);
        assert.equal((await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), original)).draft.text, 'newer B');
        await page.evaluate(async ({ original, created }) => {
          const f = (window as any).fixture;
          await f.state.controller.flush(original);
          await f.bindComposerDraftToThread(original, created.threadId);
          await f.bindComposerDraftToThread(original, created.threadId);
          f.oldController = f.state.controller;
        }, { original, created });
        const boundA = await page.evaluate(async ({ created, revision }) =>
          (window as any).fixture.readComposerDraft(created, revision), { created, revision: submission.description.revision });
        assert.deepEqual(boundA.owner, created);
        assert.equal(boundA.draft.text, 'submitted A');
        const boundB = await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), created);
        assert.deepEqual(boundB.owner, created);
        assert.equal(boundB.revision, newer.revision);
        assert.equal(boundB.draft.text, 'newer B');
        assert.equal(await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), { ...created, threadId: 'unrelated-thread' }), null);
        assert.equal(await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), { ...created, hostId: 'other-host' }), null);

        await page.evaluate(created => (window as any).fixture.render({ context: created }), created);
        await page.waitForFunction(threadId => (window as any).fixture.state.controller?.snapshot()?.owner.threadId === threadId, created.threadId);
        await page.waitForFunction(threadId => (window as any).fixture.state.snapshots.some((value: any) =>
          value.owner.threadId === threadId && value.draft.text === 'newer B'), created.threadId);
        assert.equal(await editor.inputValue(), 'newer B');
        const stale = await page.evaluate(async original => {
          const f = (window as any).fixture;
          return { snapshot: f.oldController.snapshot(), old: await f.oldController.update(original, (draft: any) => ({ ...draft, text: 'stale' })),
            wrongOwner: await f.state.controller.update(original, (draft: any) => ({ ...draft, text: 'wrong owner' })) };
        }, original);
        assert.deepEqual(stale, { snapshot: null, old: false, wrongOwner: false });
        await editor.fill('newer B on thread'); await saved(page);
        const latest = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        const oldView = await page.evaluate(async ({ original, revision }) =>
          (window as any).fixture.readComposerDraft(original, revision), { original, revision: latest.revision });
        assert.deepEqual(oldView.owner, original);
        assert.equal(oldView.draft.text, 'newer B on thread');
        assert.equal(await page.evaluate(async ({ original, revision }) =>
          (window as any).fixture.clearComposerDraftRevision(original, revision), { original, revision: submission.description.revision }), true);
        assert.equal(await page.evaluate(async ({ created, revision }) =>
          (window as any).fixture.readComposerDraft(created, revision), { created, revision: submission.description.revision }), null);
        assert.equal((await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), created)).draft.text, 'newer B on thread');
        await page.evaluate(() => (window as any).fixture.resolveSubmit());
        await page.reload(); await page.addScriptTag({ content: script });
        await mount(page, { context: created });
        assert.equal(await editor.inputValue(), 'newer B on thread');
        const conflict = await page.evaluate(async original => {
          try { await (window as any).fixture.bindComposerDraftToThread(original, 'different-thread'); return 'unexpected success'; }
          catch (error) { return (error as Error).message; }
        }, original);
        assert.match(conflict, /已关联其他线程/);
        await page.evaluate(async ({ original, created }) => (window as any).fixture.bindComposerDraftToThread(original, created.threadId), { original, created });
        assert.equal((await page.evaluate(owner => (window as any).fixture.readComposerDraft(owner), created)).draft.text, 'newer B on thread');
      } finally { await context.close(); }
    });

    await t.test('submitted version is durable, describes only explicit overrides and clears exactly that revision', async () => {
      const context = await browser.newContext();
      try {
        const page = await setup(context); await mount(page);
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('first message'); await saved(page);
        await page.getByRole('combobox', { name: '沙箱权限' }).selectOption('workspace-write');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const submission = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
        assert.equal(submission.draft.text, 'first message');
        assert.equal(submission.options.approvalsReviewer, 'user');
        assert.deepEqual(submission.options.approvalPolicy, { granular: { sandbox_approval: true, rules: false,
          skill_approval: true, request_permissions: false, mcp_elicitations: true } });
        assert.deepEqual(submission.action, { type: 'send' });
        assert.deepEqual(submission.description.overrides, { sandboxMode: 'workspace-write', permissionProfileId: undefined });
        assert.equal((await page.evaluate(async s => (window as any).fixture.readComposerDraft(s.owner, s.revision), submission.description)).draft.text, 'first message');
        await editor.fill('next message'); await saved(page);
        await page.evaluate(() => (window as any).fixture.resolveSubmit());
        await page.getByRole('button', { name: '发送', exact: true }).waitFor();
        assert.equal(await page.evaluate(s => (window as any).fixture.readComposerDraft(s.owner, s.revision), submission.description), null);
        assert.equal(await editor.inputValue(), 'next message');
        const newest = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot();
          return f.readComposerDraft(current.owner, current.revision);
        });
        assert.equal(newest.draft.text, 'next message');
        assert.equal(await page.evaluate(async s => (window as any).fixture.clearComposerDraftRevision(s.owner, s.revision), submission.description), false);
        await page.reload(); await page.addScriptTag({ content: script }); await mount(page);
        assert.equal(await editor.inputValue(), 'next message');
      } finally { await context.close(); }
    });

    await t.test('aborted transactions never report success and keep the visible draft for retry', async () => {
      const context = await browser.newContext();
      try {
        const page = await setup(context); await mount(page);
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await page.evaluate(() => (window as any).fixture.failWrites());
        await editor.fill('retry me');
        await page.getByRole('alert').filter({ hasText: '草稿未能保存' }).waitFor();
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '发送未确认' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
        assert.equal(await editor.inputValue(), 'retry me');
        const flush = await page.evaluate(async () => { const f = (window as any).fixture, owner = f.state.controller.snapshot().owner;
          try { await f.state.controller.flush(owner); return 'unexpected success'; } catch (error) { return (error as Error).message; } });
        assert.match(flush, /未能保存/);
        const failedUpdate = await page.evaluate(async () => {
          const f = (window as any).fixture, before = f.state.controller.snapshot();
          try { await f.state.controller.update(before.owner, (draft: any) => ({ ...draft, text: 'not committed' })); return 'unexpected success'; }
          catch (error) { return (error as Error).message; }
        });
        assert.match(failedUpdate, /未能保存/);
        assert.equal(await editor.inputValue(), 'retry me');
        await page.evaluate(() => (window as any).fixture.restoreWrites());
        await page.getByRole('button', { name: '重试保存' }).click();
        await page.getByRole('alert').filter({ hasText: '草稿未能保存' }).waitFor({ state: 'detached' });
        await saved(page);
        await page.reload(); await page.addScriptTag({ content: script }); await mount(page);
        assert.equal(await editor.inputValue(), 'retry me');
      } finally { await context.close(); }
    });

    await t.test('queue and steer capture their persisted revisions without replaying an uncertain result', async () => {
      const context = await browser.newContext();
      try {
        const page = await setup(context); await mount(page, { busy: true, activeTurnId: 'turn-fixture' });
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('queued message'); await saved(page);
        await page.getByRole('button', { name: '排队', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const queued = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
        assert.deepEqual(queued.action, { type: 'queue' });
        assert.deepEqual(queued.description.overrides, {});
        assert.equal((await page.evaluate(s => (window as any).fixture.readComposerDraft(s.owner, s.revision), queued.description)).draft.text, 'queued message');
        await page.evaluate(() => (window as any).fixture.rejectSubmit());
        await page.getByRole('alert').filter({ hasText: '发送结果：fixture unknown response' }).waitFor();
        assert.equal(await editor.inputValue(), 'queued message');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 1);
        await page.getByRole('button', { name: '发送到当前任务', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 2);
        const steer = await page.evaluate(() => (window as any).fixture.state.submissions[1]);
        assert.deepEqual(steer.action, { type: 'steer', turnId: 'turn-fixture' });
        assert.equal((await page.evaluate(s => (window as any).fixture.readComposerDraft(s.owner, s.revision), steer.description)).draft.text, 'queued message');
        await page.evaluate(() => (window as any).fixture.resolveSubmit());
        await page.getByRole('button', { name: '排队', exact: true }).waitFor();
      } finally { await context.close(); }
    });

    await t.test('failed external removal does not leak into an edit made during its transaction', async () => {
      const context = await browser.newContext();
      try {
        const page = await setup(context), blocker = await setup(context); await mount(page);
        await page.evaluate(async () => { const f = (window as any).fixture, s = f.state.controller.snapshot();
          await f.state.controller.update(s.owner, (draft: any) => ({ ...draft, references: [{ id: 'r', text: 'keep reference' }] })); });
        await blocker.evaluate(() => (window as any).fixture.hold());
        await page.evaluate(() => { const f = (window as any).fixture, s = f.state.controller.snapshot();
          f.trackTransactions(); f.failFirstWrite();
          f.pending = f.state.controller.update(s.owner, (draft: any) => ({ ...draft, references: [] }))
            .then(() => 'unexpected success', (error: Error) => error.message); });
        await page.waitForFunction(() => (window as any).fixture.transactions > 0);
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('newer edit');
        await blocker.evaluate(() => (window as any).fixture.release());
        assert.match(await page.evaluate(() => (window as any).fixture.pending), /未能保存/);
        await page.evaluate(() => { const f = (window as any).fixture; f.restoreWrites(); f.restoreTransactions(); });
        await saved(page);
        const snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(snapshot.draft.text, 'newer edit');
        assert.equal(snapshot.draft.references[0].text, 'keep reference');
        await page.reload(); await page.addScriptTag({ content: script }); await mount(page);
        assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), 'newer edit');
        await page.getByText('keep reference').waitFor();
      } finally { await context.close(); }
    });

    await t.test('imports exact old draft bytes once and retains unknown or malformed data', async () => {
      const context = await browser.newContext();
      try {
        const key = 'codex-yard.composer.v2:' + JSON.stringify(['local', 'thread-1']);
        const unknown = 'codex-yard.composer.v1:' + JSON.stringify(['unknown', null, '/x']);
        const raw = '{ "revision":"old", "prefills":[], "draft":{"text":"from archive","images":[],"files":[],"references":[],"skills":[]} }';
        const page = await setup(context, { archive: { [key]: raw, [unknown]: '{broken raw' } });
        await mount(page);
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        assert.equal(await editor.inputValue(), 'from archive');
        assert.deepEqual(await page.evaluate(async () => {
          const f = (window as any).fixture; return (await f.readBrowserAtom(f.composerDraftAtomKey)).archive;
        }), { [key]: raw, [unknown]: '{broken raw' });
        await page.evaluate(key => localStorage.setItem(key, 'changed old archive'), key);
        await editor.fill('authoritative'); await saved(page);
        await page.reload(); await page.addScriptTag({ content: script }); await mount(page);
        assert.equal(await editor.inputValue(), 'authoritative');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), 'changed old archive');
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
