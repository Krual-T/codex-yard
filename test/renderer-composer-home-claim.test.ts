import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

test('legacy home drafts are claimed once by the actual composer', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
    import { composerDraftAtomKey, openComposerDraft, readComposerDraftVersions } from './src/renderer/composer/composer-draft-store.ts';
    import { readBrowserAtoms, updateBrowserAtom } from './src/renderer/storage/ui-atoms.ts';
    const state={controller:null,snapshots:[]};
    const client={async rpc(method){if(method==='model/list'||method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('Unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting')return {value:params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
        throw Error('Unexpected host '+method)},subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let props={client,context:{hostId:'local',threadId:null,draftId:'first',cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},onDraftChange(value){state.snapshots.push(value)},
      async onSubmit(){},async onInterrupt(){}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,readBrowserAtoms,updateBrowserAtom,readComposerDraftVersions,composerDraftAtomKey,
      render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props))},
      async open(context){return openComposerDraft({cwd:'/fixture',...context},await readBrowserAtoms())},
      async hold(){const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('codex-yard.ui-atoms.v1',1);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve()}});
        await new Promise((resolve,reject)=>{let first=true;const loop=()=>{const req=store.get('native-atoms');
          req.onerror=()=>reject(req.error);req.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve()}}};loop()});
        this.release=()=>{released=true;return done}},
      failWrites(){this.put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){
        if(this.name==='atoms')throw Error('fixture quota');return window.fixture.put.apply(this,args)}},
      restoreWrites(){IDBObjectStore.prototype.put=this.put},
      async root(){return new Promise((resolve,reject)=>{const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
        request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result, tx=db.transaction('atoms','readonly');
          const get=tx.objectStore('atoms').get('native-atoms');get.onerror=()=>reject(get.error);
          get.onsuccess=()=>{resolve(get.result);db.close()}}})}
    };
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const script = bundle.outputFiles[0]!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  async function pageFor(context: BrowserContext, raw?: string): Promise<Page> {
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    if (raw !== undefined) await page.evaluate(value => localStorage.setItem('native-atoms', value), raw);
    await page.addScriptTag({ content: script }); return page;
  }
  async function mount(page: Page, draftId: string) {
    await page.evaluate(value => (window as any).fixture.render({ context: { draftId: value } }), draftId);
    await page.waitForFunction(value => (window as any).fixture.state.snapshots.some((s: any) => s.owner.draftId === value), draftId);
  }
  async function versions(page: Page, draftId: string) {
    return page.evaluate(value => (window as any).fixture.readComposerDraftVersions({ hostId: 'local', threadId: null, draftId: value }), draftId);
  }
  try {
    await t.test('two pages race for one home draft without cloning it, including alias and opaque data', async () => {
      const context = await browser.newContext();
      const raw = '{\n "composer-prompt-drafts-v2":{"new-conversation":{"prompt":"Legacy home","extra":{"keep":true}},"old-client":"Alias draft"},'
        + '"composer-prompt-drafts-v1":{"new-conversation":"Older home"},"draft-thread-identities-v1":{"new-conversation":"old-client"},"unrelated":17\n}';
      try {
        const a = await pageFor(context, raw), b = await pageFor(context), blocker = await pageFor(context);
        await blocker.evaluate(async () => { await (window as any).fixture.readBrowserAtoms(); await (window as any).fixture.hold(); });
        await Promise.all([a.evaluate(() => (window as any).fixture.render({ context: { draftId: 'home-a' } })),
          b.evaluate(() => (window as any).fixture.render({ context: { draftId: 'home-b' } }))]);
        await a.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('live A');
        await b.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('live B');
        await blocker.evaluate(() => (window as any).fixture.release());
        await Promise.all([a.waitForFunction(() => (window as any).fixture.state.snapshots.some((s: any) => s.draft.text === 'live A')),
          b.waitForFunction(() => (window as any).fixture.state.snapshots.some((s: any) => s.draft.text === 'live B'))]);
        const [av, bv] = await Promise.all([versions(a, 'home-a'), versions(b, 'home-b')]);
        const winners = [av, bv].filter(view => view.versions.some((v: any) => v.draft.text === 'Legacy home'));
        assert.equal(winners.length, 1);
        assert.ok(av.versions.some((v: any) => v.draft.text === 'live A'));
        assert.ok(bv.versions.some((v: any) => v.draft.text === 'live B'));
        assert.deepEqual(winners[0].versions.map((v: any) => v.draft.text).filter((text: string) => !text.startsWith('live ')).sort(),
          ['Alias draft', 'Legacy home', 'Older home']);
        const first = winners[0].versions.find((v: any) => v.draft.text === 'Legacy home');
        assert.deepEqual(first.draft.preserved.draft.extra, { keep: true });
        assert.match(first.draft.blocked, /额外上下文/);
        assert.equal([av, bv].filter(view => view.versions.length === 1).length, 1);
        const winner = av.versions.some((v: any) => v.draft.text === 'Legacy home') ? a : b;
        const winnerId = winner === a ? 'home-a' : 'home-b';
        await winner.getByText('其他页面或旧数据中有 3 份独立草稿。').waitFor();
        await winner.reload(); await winner.addScriptTag({ content: script }); await mount(winner, winnerId);
        assert.equal(await winner.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), winnerId === 'home-a' ? 'live A' : 'live B');
        assert.equal((await versions(winner, winnerId)).versions.length, 4);
        const attempts = await a.evaluate(async () => { const f = (window as any).fixture;
          return Promise.all([
            f.open({ hostId: 'local', threadId: null, draftId: 'explicit', legacyDraftKey: 'old-client' }),
            f.open({ hostId: 'local', threadId: null, draftId: 'panel', placement: 'side-chat', legacyDraftKey: 'new-conversation' }),
            f.open({ hostId: 'remote', threadId: null, draftId: 'remote', legacyDraftKey: 'new-conversation' }),
          ]);
        });
        assert.ok(attempts.every((view: any) => view.versions.length === 1 && view.versions[0].draft.text === ''));
        const afterBinding = await a.evaluate(async () => { const f = (window as any).fixture;
          await f.updateBrowserAtom('client-thread-bindings-v1', () => ({ 'old-client': 'created-thread' }));
          return f.open({ hostId: 'local', threadId: 'created-thread', draftId: 'different-owner' });
        });
        assert.deepEqual(afterBinding.versions.map((v: any) => v.draft.text), ['']);
        assert.equal((await a.evaluate(() => (window as any).fixture.root())).legacyRaw, raw);
        assert.equal(await a.evaluate(() => localStorage.getItem('native-atoms')), raw);
      } finally { await context.close(); }
    });

    await t.test('an already initialized home keeps its new content and offers the old draft after upgrade', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context, '{}'); await mount(page, 'existing');
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('Independent draft');
        await page.waitForFunction(() => (window as any).fixture.state.snapshots.some((s: any) => s.draft.text === 'Independent draft'));
        await page.evaluate(() => (window as any).fixture.updateBrowserAtom('composer-prompt-drafts-v1', () => ({ 'new-conversation': 'Restored old draft' })));
        await page.reload(); await page.addScriptTag({ content: script }); await mount(page, 'existing');
        assert.equal(await editor.inputValue(), 'Independent draft');
        await page.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();
        await page.getByText('选择草稿版本').click(); await page.getByRole('button', { name: 'Restored old draft' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Restored old draft');
        assert.equal(await editor.inputValue(), 'Restored old draft');
        assert.deepEqual((await versions(page, 'existing')).versions.map((v: any) => v.draft.text).sort(), ['Independent draft', 'Restored old draft']);
      } finally { await context.close(); }
    });

    await t.test('already imported versions and bound thread aliases are not copied into a new home', async () => {
      const context = await browser.newContext();
      const raw = JSON.stringify({ 'composer-prompt-drafts-v1': { 'new-conversation': 'Old home', 'bound-client': 'Thread draft' },
        'draft-thread-identities-v1': { 'new-conversation': 'bound-client' }, 'client-thread-bindings-v1': { 'bound-client': 'thread-1' } });
      try {
        const page = await pageFor(context, raw); await mount(page, 'original');
        assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), 'Old home');
        await page.evaluate(() => (window as any).fixture.updateBrowserAtom((window as any).fixture.composerDraftAtomKey, (store: any) => {
          const claims = { ...store.claims }; delete claims['native-atoms:home:new-conversation']; return { ...store, claims };
        }));
        const result = await page.evaluate(async () => { const f = (window as any).fixture;
          return { fresh: await f.open({ hostId: 'local', threadId: null, draftId: 'fresh' }),
            thread: await f.open({ hostId: 'local', threadId: 'thread-1', draftId: 'thread-1' }) };
        });
        assert.deepEqual(result.fresh.versions.map((v: any) => v.draft.text), ['']);
        assert.deepEqual(result.thread.versions.map((v: any) => v.draft.text), ['Thread draft']);
        assert.equal((await versions(page, 'original')).versions[0].draft.text, 'Old home');
      } finally { await context.close(); }
    });

    await t.test('a failed transaction leaves the old draft available to a later successful owner', async () => {
      const context = await browser.newContext();
      try {
        const a = await pageFor(context, JSON.stringify({ 'composer-prompt-drafts-v1': { 'new-conversation': 'Retry me' } }));
        await a.evaluate(async () => { const f = (window as any).fixture; await f.readBrowserAtoms(); f.failWrites(); f.render(); });
        await a.getByRole('alert').filter({ hasText: '无法恢复草稿' }).waitFor();
        await a.evaluate(() => (window as any).fixture.restoreWrites());
        const b = await pageFor(context); await mount(b, 'successful');
        assert.equal(await b.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), 'Retry me');
        await a.reload(); await a.addScriptTag({ content: script }); await mount(a, 'first');
        assert.equal(await a.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), '');
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
