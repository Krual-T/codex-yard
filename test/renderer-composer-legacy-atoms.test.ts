import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

test('composer recovers transactional legacy atoms without overwriting later input', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput, readComposerDraft } from './src/renderer/composer/StandaloneComposer.tsx';
    import { readComposerDraftVersions } from './src/renderer/composer/composer-draft-store.ts';
    import { readBrowserAtoms, updateBrowserAtom } from './src/renderer/storage/ui-atoms.ts';
    const state={controller:null,snapshots:[],submissions:[],consumed:[]};
    const client={async rpc(method){
      if(method==='model/list'||method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('Unexpected RPC '+method);
    },async host(method,params){if(method==='get-setting')return {exists:true,value:params.key==='composerEnterBehavior'?'cmdAlways':params.key==='composerPlainTextMode'?false:'queue'};
      throw Error('Unexpected host '+method)},subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let props={client,context:{hostId:'local',threadId:'thread-1',draftId:'client',cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},onDraftChange(value){state.snapshots.push(value)},
      onPrefillConsumed(id){state.consumed.push(id)},
      onSubmit:async(draft)=>state.submissions.push({draft:structuredClone(draft),input:draftToInput(draft,'local')}),
      onInterrupt:async()=>{}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,readBrowserAtoms,updateBrowserAtom,readComposerDraftVersions,readComposerDraft,
      render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props))},
      async hold(){
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
          request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve()}});
        await new Promise((resolve,reject)=>{let first=true;const loop=()=>{const request=store.get('native-atoms');
          request.onerror=()=>reject(request.error);request.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve()}}};loop()});
        this.release=()=>{released=true;return done};
      }};
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const script = bundle.outputFiles[0]!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function pageWith(raw: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext(), page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.evaluate(value => localStorage.setItem('native-atoms', value), raw);
    await page.addScriptTag({ content: script });
    return { context, page };
  }
  async function saved(page: Page) { await page.waitForFunction(() => {
    const f = (window as any).fixture, snapshot = f.state.controller?.snapshot();
    return snapshot && f.state.snapshots.some((value: any) => value.revision === snapshot.revision);
  }); }
  try {
    await t.test('uses current atom records and retains rich marks through editing, refresh and submit', async () => {
      const archive = '{\n "composer-prompt-drafts-v1":{"client":"archived text"},"unrelated":true\n}';
      const { context, page } = await pageWith(archive);
      try {
        const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Current', marks: [{ type: 'strong' }] }] }] };
        await page.evaluate(async document => {
          const f = (window as any).fixture;
          await f.readBrowserAtoms();
          await f.updateBrowserAtom('client-thread-bindings-v1', () => ({ client: 'thread-1' }));
          await f.updateBrowserAtom('composer-prompt-drafts-v2', () => ({ client: { prompt: '**Current**' } }));
          await f.updateBrowserAtom('composer-retained-documents-v1', () => ({
            'local:thread-1': { document, plainTextMode: false, prompt: '**Current**' },
          }));
          f.render();
        }, document);
        const editor = page.locator('.ProseMirror');
        await editor.locator('strong').waitFor();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document), document);
        await editor.focus(); await editor.press('End'); await page.keyboard.type(' edited');
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('edited'));
        await saved(page);
        const beforeRefresh = await page.evaluate(async () => { const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
          return { snapshot, versions: await f.readComposerDraftVersions(snapshot.owner) }; });
        await page.reload(); await page.addScriptTag({ content: script }); await page.evaluate(() => (window as any).fixture.render());
        await editor.waitFor();
        const afterRefresh = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(afterRefresh.revision, beforeRefresh.snapshot.revision, JSON.stringify(beforeRefresh.versions));
        assert.match(await editor.innerText(), /Current edited/);
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
        assert.match(submitted.input[0].text, /edited/);
        assert.equal(submitted.draft.document.content[0].content[0].marks[0].type, 'strong');
        assert.equal(await page.evaluate(() => localStorage.getItem('native-atoms')), archive);
      } finally { await context.close(); }
    });

    await t.test('late owner reads cannot overwrite input and the previous owner keeps both versions', async () => {
      const { context, page } = await pageWith(JSON.stringify({ 'composer-prompt-drafts-v1': { a: 'Old A', b: 'Old B' } }));
      try {
        await page.evaluate(async () => { const f = (window as any).fixture; await f.readBrowserAtoms(); await f.hold();
          f.render({ context: { threadId: 'thread-a', draftId: 'same', legacyDraftKey: 'a' } }); });
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('new A');
        await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-b', legacyDraftKey: 'b' } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.threadId === 'thread-b');
        await editor.fill('new B');
        await page.evaluate(() => (window as any).fixture.release()); await saved(page);
        await page.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();
        assert.equal(await editor.inputValue(), 'new B');
        await page.getByText('选择草稿版本').click(); await page.getByRole('button', { name: 'Old B' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Old B');
        assert.equal(await editor.inputValue(), 'Old B');
        await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-a', legacyDraftKey: 'a' } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.threadId === 'thread-a');
        await page.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();
        assert.equal(await editor.inputValue(), 'new A');
        await page.getByText('选择草稿版本').click(); await page.getByRole('button', { name: 'Old A' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Old A');
        assert.equal(await editor.inputValue(), 'Old A');
      } finally { await context.close(); }
    });

    await t.test('the real local thread identity offers every trusted bound alias after refresh', async () => {
      const atoms = { 'client-thread-bindings-v1': { first: 'thread-1', second: 'thread-1' },
        'composer-prompt-drafts-v1': { first: 'first alias', second: 'second alias' } };
      const { context, page } = await pageWith(JSON.stringify(atoms));
      try {
        await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'thread-1' } }));
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await page.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();
        assert.equal(await editor.inputValue(), 'first alias');
        await page.getByText('选择草稿版本').click(); await page.getByRole('button', { name: 'second alias' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'second alias');
        await page.reload(); await page.addScriptTag({ content: script });
        await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'thread-1' } }));
        await page.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();
        const texts = await page.evaluate(async () => { const f = (window as any).fixture;
          return (await f.readComposerDraftVersions(f.state.controller.snapshot().owner)).versions.map((v: any) => v.draft.text).sort(); });
        assert.deepEqual(texts, ['first alias', 'second alias']);
      } finally { await context.close(); }
    });

    await t.test('prefill is acknowledged only after commit and survives alongside legacy content', async () => {
      const { context, page } = await pageWith(JSON.stringify({ 'composer-prompt-drafts-v1': { client: 'Old original' } }));
      try {
        await page.evaluate(async () => { const f = (window as any).fixture; await f.readBrowserAtoms(); await f.hold(); });
        const prefill = { id: 'structured', draft: { text: '**Prefilled**', images: [], files: [],
          document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prefilled', marks: [{ type: 'strong' }] }] }] },
          input: [{ type: 'future', metadata: { keep: true } }, { type: 'text', text: '**Prefilled**', text_elements: [] }],
          hints: [{ range: [1, 3] }], references: [{ id: 'browser:fixture', text: 'reference', context: { source: 'fixture' } }] } };
        await page.evaluate(prefill => (window as any).fixture.render({ prefill }), prefill);
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.consumed), []);
        assert.equal(await page.getByText('reference', { exact: true }).count(), 0);
        await page.evaluate(() => (window as any).fixture.release());
        await page.waitForFunction(() => (window as any).fixture.state.consumed.includes('structured'));
        await page.getByRole('button', { name: '切换草稿' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === '**Prefilled**');
        await saved(page);
        let snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.deepEqual(snapshot.draft.document, prefill.draft.document);
        assert.deepEqual(snapshot.draft.input, prefill.draft.input);
        assert.deepEqual(snapshot.draft.hints, prefill.draft.hints);
        assert.deepEqual(snapshot.draft.references, prefill.draft.references);
        await page.reload(); await page.addScriptTag({ content: script }); await page.evaluate(() => (window as any).fixture.render());
        await page.getByRole('button', { name: '切换草稿' }).waitFor();
        const versions = await page.evaluate(async () => { const f = (window as any).fixture;
          return (await f.readComposerDraftVersions(f.state.controller.snapshot().owner)).versions; });
        const recovered = versions.find((value: any) => value.draft.text === '**Prefilled**');
        assert.deepEqual(recovered.draft.document, prefill.draft.document);
        assert.deepEqual(recovered.draft.input, prefill.draft.input);
        assert.deepEqual(recovered.draft.hints, prefill.draft.hints);
        assert.deepEqual(recovered.draft.references, prefill.draft.references);
        assert.equal(recovered.draft.pendingDrafts[0].text, 'Old original');
      } finally { await context.close(); }
    });

    await t.test('malformed native atoms retain raw bytes and never fall back to a changed archive', async () => {
      const { context, page } = await pageWith('{broken original');
      try {
        await page.evaluate(() => (window as any).fixture.render());
        await page.getByRole('alert').filter({ hasText: '旧浏览器偏好无法转换' }).waitFor();
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('preserved edit');
        await page.getByRole('alert').filter({ hasText: '草稿未能保存' }).waitFor();
        await page.evaluate(() => localStorage.setItem('native-atoms', JSON.stringify({ 'composer-prompt-drafts-v1': { client: 'fake fallback' } })));
        await page.getByRole('button', { name: '重试保存' }).click();
        await page.getByRole('alert').filter({ hasText: '旧浏览器偏好无法转换' }).waitFor();
        assert.equal(await editor.inputValue(), 'preserved edit');
        const root = await page.evaluate(() => new Promise<any>((resolve, reject) => {
          const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => { const db = request.result, tx = db.transaction('atoms', 'readonly'), get = tx.objectStore('atoms').get('native-atoms');
            get.onsuccess = () => { resolve(get.result); db.close(); }; get.onerror = () => reject(get.error); };
        }));
        assert.equal(root.legacyRaw, '{broken original');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
