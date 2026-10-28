import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

test('composer recovers legacy atoms transactionally without losing newer drafts', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    import { readBrowserAtoms, updateBrowserAtom } from './src/renderer/storage/ui-atoms.ts';
    const state={controller:null,submissions:[],consumed:[]};
    const client={async rpc(method){
      if(method==='model/list') return {data:[],nextCursor:null};
      if(method==='config/read') return {config:{}};
      if(method==='thread/queue/list') return {data:[],nextCursor:null};
      throw Error('Unexpected RPC '+method);
    },async host(method,params){
      if(method==='get-setting') return {value:params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let props={client,context:{hostId:'local',threadId:'thread-1',draftId:'client',cwd:'/fixture'},busy:false,
      onDraftController(controller){state.controller=controller},
      onPrefillConsumed(id){state.consumed.push(id)},
      onSubmit:async(draft)=>state.submissions.push({draft:structuredClone(draft),input:draftToInput(draft,'local')}),
      onInterrupt:async()=>{}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,readBrowserAtoms,updateBrowserAtom,
      render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));},
      async hold(){
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
          request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');
        let released=false, finish;
        const done=new Promise((resolve,reject)=>{finish=resolve;tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();finish();}});
        await new Promise((resolve,reject)=>{
          let first=true;
          const loop=()=>{const request=store.get('native-atoms');request.onerror=()=>reject(request.error);
            request.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve();}};};
          loop();
        });
        this.release=()=>{released=true;return done;};
      }};
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const script = bundle.outputFiles[0]!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function pageWith(raw: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.evaluate(value => localStorage.setItem('native-atoms', value), raw);
    await page.addScriptTag({ content: script });
    return { context, page };
  }
  try {
    await t.test('uses the current atom record, retains archive bytes, edits and refreshes a rich document', async () => {
      const archive = '{\n  "composer-prompt-drafts-v1": {"client":"archived text"}, "unrelated": true\n}';
      const { context, page } = await pageWith(archive);
      try {
        const document = { type: 'doc', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Current', marks: [{ type: 'strong' }] },
        ] }] };
        await page.evaluate(async document => {
          const fixture = (window as any).fixture;
          await fixture.readBrowserAtoms();
          await fixture.updateBrowserAtom('client-thread-bindings-v1', () => ({ client: 'thread-1' }));
          await fixture.updateBrowserAtom('composer-prompt-drafts-v2', () => ({ client: { prompt: '**Current**' } }));
          await fixture.updateBrowserAtom('composer-retained-documents-v1', () => ({
            'local:thread-1': { document, plainTextMode: false, prompt: '**Current**' },
          }));
          fixture.render();
        }, document);
        const editor = page.locator('.ProseMirror');
        await editor.locator('strong').waitFor();
        assert.equal(await editor.locator('strong').innerText(), 'Current');
        assert.equal(await page.evaluate(() => localStorage.getItem('native-atoms')), archive);
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document), document);
        await editor.focus(); await editor.press('End'); await page.keyboard.type(' edited');
        await page.reload(); await page.addScriptTag({ content: script });
        await page.evaluate(() => (window as any).fixture.render());
        await editor.waitFor();
        assert.match(await editor.innerText(), /Current edited/);
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
        assert.match(submitted.input[0].text, /Current/);
        assert.match(submitted.input[0].text, /edited/);
        assert.equal(submitted.draft.document.content[0].content[0].marks[0].type, 'strong');
        assert.equal(await page.evaluate(() => localStorage.getItem('native-atoms')), archive);
      } finally { await context.close(); }
    });

    await t.test('delayed transactions respect owner changes and park old and new content separately', async () => {
      const atoms = { 'composer-prompt-drafts-v1': { a: 'Old A', b: 'Old B', c: 'Old C' } };
      const { context, page } = await pageWith(JSON.stringify(atoms));
      try {
        await page.evaluate(async () => {
          const fixture = (window as any).fixture;
          await fixture.readBrowserAtoms(); await fixture.hold();
          fixture.render({ context: { threadId: 'thread-a', draftId: 'same', legacyDraftKey: 'a' } });
        });
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('newer text');
        await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-b', legacyDraftKey: 'b' } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.threadId === 'thread-b');
        await page.evaluate(() => (window as any).fixture.release());
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.pendingDrafts?.length === 1);
        let snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(snapshot.owner.threadId, 'thread-b');
        assert.equal(snapshot.draft.text, 'newer text');
        assert.equal(snapshot.draft.pendingDrafts[0].text, 'Old B');
        assert.doesNotMatch(JSON.stringify(snapshot), /Old A/);
        await page.reload(); await page.addScriptTag({ content: script });
        await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-b', draftId: 'same', legacyDraftKey: 'b' } }));
        await page.getByRole('button', { name: '切换草稿' }).click();
        assert.equal(await editor.inputValue(), 'Old B');
        snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(snapshot.draft.pendingDrafts[0].text, 'newer text');

        await page.evaluate(async () => {
          const fixture = (window as any).fixture;
          await fixture.hold();
          fixture.render({ context: { hostId: 'local', threadId: 'thread-c', draftId: 'host-a', legacyDraftKey: 'c' } });
        });
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'host-a');
        await editor.fill('local edit');
        await page.evaluate(() => (window as any).fixture.render({ context: {
          hostId: 'ssh-fixture', threadId: 'remote', draftId: 'host-b', legacyDraftKey: undefined,
        } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'host-b');
        await editor.fill('remote edit');
        await page.evaluate(() => (window as any).fixture.release());
        await page.waitForFunction(() => {
          const value = JSON.parse(localStorage.getItem('codex-yard.composer.v2:' + JSON.stringify(['ssh-fixture', 'host-b']))!);
          return !value.legacyPending;
        });
        snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(snapshot.owner.hostId, 'ssh-fixture');
        assert.equal(snapshot.draft.text, 'remote edit');
        assert.doesNotMatch(JSON.stringify(snapshot), /Old C|local edit/);
        await page.evaluate(() => (window as any).fixture.render({ context: {
          hostId: 'local', threadId: 'thread-c', draftId: 'host-a', legacyDraftKey: 'c',
        } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.pendingDrafts?.length === 1);
        snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(snapshot.draft.text, 'local edit');
        assert.equal(snapshot.draft.pendingDrafts[0].text, 'Old C');
      } finally { await context.close(); }
    });

    await t.test('prefill metadata and edits survive a refresh while the legacy transaction is blocked', async () => {
      const { context, page } = await pageWith(JSON.stringify({ 'composer-prompt-drafts-v1': { client: 'Old original' } }));
      try {
        await page.evaluate(() => (window as any).fixture.readBrowserAtoms());
        const blocker = await context.newPage();
        await blocker.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
        await blocker.goto('http://localhost/'); await blocker.addScriptTag({ content: script });
        await blocker.evaluate(() => (window as any).fixture.hold());
        const prefill = { id: 'structured', draft: { text: '**Prefilled**', images: [], files: [],
          document: { type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'text', text: 'Prefilled', marks: [{ type: 'strong' }] },
          ] }] }, input: [{ type: 'future', metadata: { keep: true } },
            { type: 'text', text: '**Prefilled**', text_elements: [] }], hints: [{ range: [1, 3] }],
          references: [{ id: 'browser:fixture', text: 'reference', context: { source: 'fixture' } }] } };
        await page.evaluate(prefill => (window as any).fixture.render({ prefill }), prefill);
        await page.waitForFunction(() => (window as any).fixture.state.consumed.includes('structured'));
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-yard.composer.v2:' + JSON.stringify(['local', 'client']))!).legacyPending), true);
        await page.reload(); await page.addScriptTag({ content: script });
        await page.evaluate(() => (window as any).fixture.render());
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.draft.hints?.length === 1);
        let snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.deepEqual(snapshot.draft.document, prefill.draft.document);
        assert.deepEqual(snapshot.draft.input, prefill.draft.input);
        assert.deepEqual(snapshot.draft.hints, prefill.draft.hints);
        assert.deepEqual(snapshot.draft.references, prefill.draft.references);
        await blocker.evaluate(() => (window as any).fixture.release());
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.pendingDrafts?.[0]?.text === 'Old original');
        snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.deepEqual(snapshot.draft.document, prefill.draft.document);
        assert.deepEqual(snapshot.draft.input, prefill.draft.input);
        assert.deepEqual(snapshot.draft.hints, prefill.draft.hints);
        assert.deepEqual(snapshot.draft.references, prefill.draft.references);
        assert.equal(snapshot.draft.text, '**Prefilled**');
        await page.reload(); await page.addScriptTag({ content: script });
        await page.evaluate(() => (window as any).fixture.render());
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.draft.pendingDrafts?.length === 1);
        snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.deepEqual(snapshot.draft.input, prefill.draft.input);
        assert.deepEqual(snapshot.draft.hints, prefill.draft.hints);
      } finally { await context.close(); }
    });

    await t.test('a failed draft write is retryable without losing either version', async () => {
      const { context, page } = await pageWith(JSON.stringify({ 'composer-prompt-drafts-v1': { client: 'Original' } }));
      try {
        await page.evaluate(async () => {
          const fixture = (window as any).fixture;
          await fixture.readBrowserAtoms(); await fixture.hold(); fixture.render();
        });
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('new text');
        await page.evaluate(() => {
          const fixture = (window as any).fixture;
          fixture.originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key.startsWith('codex-yard.composer.v2:')) throw Error('fixture quota');
            return fixture.originalSetItem.call(this, key, value);
          };
          return fixture.release();
        });
        await page.getByRole('alert').filter({ hasText: '恢复的草稿未能保存' }).waitFor();
        assert.equal(await editor.inputValue(), 'new text');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-yard.composer.v2:' + JSON.stringify(['local', 'client']))!).legacyPending), true);
        await page.evaluate(() => { Storage.prototype.setItem = (window as any).fixture.originalSetItem; });
        await page.getByRole('button', { name: '重试恢复' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.pendingDrafts?.[0]?.text === 'Original');
        await page.reload(); await page.addScriptTag({ content: script });
        await page.evaluate(() => (window as any).fixture.render());
        await page.getByRole('button', { name: '切换草稿' }).waitFor();
        assert.equal(await editor.inputValue(), 'new text');
        assert.equal((await page.evaluate(() => (window as any).fixture.state.controller.snapshot())).draft.pendingDrafts[0].text, 'Original');
      } finally { await context.close(); }
    });

    await t.test('a competing saved revision prevents recovery from overwriting either page', async () => {
      const { context, page } = await pageWith(JSON.stringify({ 'composer-prompt-drafts-v1': { client: 'Old original' } }));
      try {
        await page.evaluate(async () => {
          const fixture = (window as any).fixture;
          await fixture.readBrowserAtoms(); await fixture.hold(); fixture.render();
        });
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('this page');
        const key = 'codex-yard.composer.v2:' + JSON.stringify(['local', 'client']);
        const mine = await page.evaluate(key => localStorage.getItem(key)!, key);
        const otherPage = await context.newPage();
        await otherPage.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '' }));
        await otherPage.goto('http://localhost/');
        await otherPage.evaluate(key => {
          const saved = JSON.parse(localStorage.getItem(key)!);
          saved.revision = 'other-page'; saved.draft.text = 'other page';
          localStorage.setItem(key, JSON.stringify(saved));
        }, key);
        await page.evaluate(() => (window as any).fixture.release());
        await page.getByRole('alert').filter({ hasText: '草稿已在其他页面修改' }).waitFor();
        assert.equal(await editor.inputValue(), 'this page');
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).draft.text, key), 'other page');
        assert.equal((await page.evaluate(() => (window as any).fixture.readBrowserAtoms()))['composer-prompt-drafts-v1'].client, 'Old original');
        await otherPage.evaluate(({ key, mine }) => localStorage.setItem(key, mine), { key, mine });
        await page.getByRole('button', { name: '重试恢复' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.pendingDrafts?.[0]?.text === 'Old original');
        assert.equal(await editor.inputValue(), 'this page');
      } finally { await context.close(); }
    });

    await t.test('malformed imported atoms remain authoritative and never fall back to changed archive bytes', async () => {
      const { context, page } = await pageWith('{broken original');
      try {
        await page.evaluate(() => (window as any).fixture.render());
        await page.getByRole('alert').filter({ hasText: '旧浏览器偏好无法转换' }).waitFor();
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('preserved edit');
        await page.evaluate(() => localStorage.setItem('native-atoms', JSON.stringify({ 'composer-prompt-drafts-v1': { client: 'fake fallback' } })));
        await page.getByRole('button', { name: '重试恢复' }).click();
        await page.getByRole('alert').filter({ hasText: '旧浏览器偏好无法转换' }).waitFor();
        assert.equal(await editor.inputValue(), 'preserved edit');
        const root = await page.evaluate(() => new Promise<any>((resolve, reject) => {
          const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction('atoms', 'readonly'), get = tx.objectStore('atoms').get('native-atoms');
            get.onsuccess = () => { resolve(get.result); db.close(); };
            get.onerror = () => reject(get.error);
          };
        }));
        assert.equal(root.legacyRaw, '{broken original');
        await page.reload(); await page.addScriptTag({ content: script });
        await page.evaluate(() => (window as any).fixture.render());
        await page.getByRole('alert').filter({ hasText: '旧浏览器偏好无法转换' }).waitFor();
        assert.equal(await editor.inputValue(), 'preserved edit');
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
