import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('composer leases drain real attachment, reference and queue edits before the parent switches owners', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    import {readComposerDraft} from './src/renderer/composer/composer-draft-store.ts';
    import {addUnknownQueueStart,prepareUnknownQueueRelease,readUnknownQueueStarts,removeUnknownQueueStart} from './src/renderer/composer/standalone-queue-storage.ts';
    const state={controller:null, snapshots:[], uploadWaiting:false, removalWaiting:false, queueWaiting:false,
      queued:[{id:'queue-1',clientUserMessageId:'client-1',input:[{type:'text',text:'queued',text_elements:[]}]}], result:null,
      holdSubmit:false,submitWaiting:false,submitCalls:0,lockReleaseWaiting:false,lockReleasePending:0,lockReleaseSent:[],queueChecks:0,failNextList:false};
    let resolveUpload, rejectUpload, resolveRemoval, rejectRemoval, resolveQueue, resolveSubmit, resolveLockRelease, rejectLockRelease;
    window.fetch = async (url) => {
      if (String(url)==='/api/files/uploads') {
        state.uploadWaiting=true;
        return new Promise((resolve,reject)=>{resolveUpload=()=>{state.uploadWaiting=false;resolve(new Response(JSON.stringify({uploadId:'upload'}),{status:200}))};
          rejectUpload=()=>{state.uploadWaiting=false;reject(Error('synthetic upload failure'))}});
      }
      if (String(url).startsWith('/api/files/upload?')) return new Response(JSON.stringify({fsPath:'/synthetic/upload.png'}),{status:200});
      throw Error('Unexpected fetch');
    };
    const client={async rpc(method,params) {
      if(method==='model/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};
      if(method==='thread/queue/list'){state.queueChecks++;if(state.failNextList){state.failNextList=false;throw Error('synthetic list failure')}
        return {data:structuredClone(state.queued),nextCursor:null};}
      if(method==='thread/items/list')return {data:[{item:{type:'userMessage',clientId:'client-1'}}],nextCursor:null};
      if(method==='thread/queue/update') {state.queueWaiting=true;await new Promise(resolve=>{resolveQueue=resolve});
        state.queued[0].input=params.input;state.queueWaiting=false;return {};}
      throw Error('Unexpected RPC '+method);
    },async host(method,params) {
      if(method==='get-setting')return {exists:true,value:params.key==='composerEnterBehavior'?'cmdAlways':params.key==='composerPlainTextMode'?false:'queue'};
      if(method==='queued-follow-up-send-lock-release'){state.lockReleaseSent.push(params.sent);state.lockReleasePending++;state.lockReleaseWaiting=true;try{await new Promise((resolve,reject)=>{resolveLockRelease=resolve;rejectLockRelease=reject})}finally{state.lockReleasePending--;state.lockReleaseWaiting=state.lockReleasePending>0}return {};}
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let props={client,context:{hostId:'local',threadId:null,draftId:'draft-a',cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},onDraftChange(value){state.snapshots.push(structuredClone(value))},
      onRemoveReference(){state.removalWaiting=true;return new Promise((resolve,reject)=>{
        resolveRemoval=()=>{state.removalWaiting=false;resolve()};rejectRemoval=()=>{state.removalWaiting=false;reject(Error('synthetic reference failure'))}})},
      async onSubmit(){state.submitCalls++;if(state.holdSubmit){state.submitWaiting=true;await new Promise(resolve=>{resolveSubmit=resolve});state.submitWaiting=false}},async onInterrupt(){}};
    const root=createRoot(document.getElementById('root'));
    const fixture={state,readComposerDraft,lease:null,oldController:null,oldOwner:null,
      render(changes={}) {props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));},
      freeze() {const controller=state.controller, owner=controller.snapshot().owner;
        const lease=controller.freeze(owner);if(!lease)return false;
        fixture.lease=lease;fixture.oldController=controller;fixture.oldOwner=owner;state.result=null;
        state.flush=lease.flush().then(value=>{state.result=value;return value});return true;},
      release(){fixture.lease.release()},resolveUpload(){resolveUpload()},rejectUpload(){rejectUpload()},
      resolveRemoval(){resolveRemoval()},rejectRemoval(){rejectRemoval()},resolveQueue(){resolveQueue()},resolveSubmit(){resolveSubmit()},
      async addUnknown(){state.queued=[];await addUnknownQueueStart('local','queue-thread',{id:'queue-1',clientUserMessageId:'client-1',lockId:'lock-1'});},
      async addRejected(){state.queued=[{id:'queue-1',clientUserMessageId:'client-1',input:[{type:'text',text:'queued',text_elements:[]}]}];
        const marker={id:'queue-1',clientUserMessageId:'client-1',lockId:'lock-1'};
        await addUnknownQueueStart('local','queue-thread',marker);await prepareUnknownQueueRelease('local','queue-thread',marker,false);},
      async addOpaque(){state.queued=[{id:'queue-1',clientUserMessageId:'client-1',input:[{type:'text',text:'queued',text_elements:[]}]}];
        await addUnknownQueueStart('local','queue-thread',{id:'queue-1',clientUserMessageId:'client-1',lockId:'lock-opaque',release:'sent'});},
      async removeOpaque(){await removeUnknownQueueStart('local','queue-thread',{id:'queue-1',clientUserMessageId:'client-1',lockId:'lock-opaque'});},
      readUnknown(){return readUnknownQueueStarts('local','queue-thread')},
      resolveLockRelease(){resolveLockRelease()},rejectLockRelease(){rejectLockRelease(Error('synthetic lock failure'))}};
    window.fixture=fixture;fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://composer.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://composer.test/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => (window as any).fixture.state.snapshots.length > 0);
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.fill('retained');
    await page.getByRole('button', { name: '富文本编辑' }).click();
    const rich = page.locator('.ProseMirror');
    await rich.focus();
    await rich.evaluate(element => {
      const node = element.querySelector('p')!.firstChild!;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 8);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await page.getByRole('button', { name: '粗体' }).click();
    await rich.locator('strong').waitFor();
    const image = { name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from('synthetic image') };

    await t.test('a slow file is durable before switching, and new input is blocked synchronously', async () => {
      await page.locator('input[type=file]').setInputFiles(image);
      await page.waitForFunction(() => (window as any).fixture.state.uploadWaiting);
      const start = await page.evaluate(async () => {
        const f = (window as any).fixture, ok = f.freeze(), owner = f.oldOwner;
        return { ok, inert: document.querySelector('.standalone-composer > div')!.hasAttribute('inert'),
          duplicate: f.state.controller.freeze(owner), wrong: f.state.controller.freeze({ ...owner, hostId: 'other' }),
          update: await f.state.controller.update(owner, (draft: any) => ({ ...draft, text: 'wrong' })) };
      });
      assert.deepEqual(start, { ok: true, inert: true, duplicate: null, wrong: null, update: false });
      await page.keyboard.insertText('blocked');
      assert.equal(await page.evaluate(() => (window as any).fixture.state.result), null);
      assert.equal(await page.evaluate(() => (window as any).fixture.oldController.snapshot().draft.text), '**retained**');
      await page.evaluate(() => (window as any).fixture.resolveUpload());
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      const durable = await page.evaluate(async () => {
        const f = (window as any).fixture, snapshot = f.oldController.snapshot();
        return { snapshot, saved: await f.readComposerDraft(f.oldOwner, snapshot.revision) };
      });
      assert.equal(durable.saved.draft.images[0].path, '/synthetic/upload.png');
      assert.equal(durable.saved.draft.document.content[0].content[0].marks[0].type, 'strong');
      await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-b', draftId: 'draft-b' } }));
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'draft-b');
      assert.equal(await page.evaluate(() => (window as any).fixture.oldController.snapshot()), null);
      await page.evaluate(() => (window as any).fixture.release());
      await editor.fill('other owner');
      await page.evaluate(() => (window as any).fixture.render({ context: { threadId: null, draftId: 'draft-a' } }));
      await rich.locator('strong').waitFor();
      await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await rich.locator('strong').waitFor();
      await page.locator('.standalone-composer__image img').waitFor();
      assert.equal(await rich.locator('strong').innerText(), 'retained');
    });

    await t.test('pending rich DOM and link edits cannot be left behind', async () => {
      await page.getByRole('button', { name: '链接', exact: true }).click();
      await page.getByRole('textbox', { name: '链接地址' }).fill('https://fixture.test');
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), false);
      await page.getByRole('alert').filter({ hasText: '链接编辑' }).waitFor();
      await page.getByRole('button', { name: '链接', exact: true }).click();
      await rich.focus();
      assert.equal(await rich.evaluate(element => {
        element.querySelector('strong')!.firstChild!.textContent = 'retained observer';
        return (window as any).fixture.freeze();
      }), true);
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      const saved = await page.evaluate(async () => {
        const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
        return f.readComposerDraft(snapshot.owner, snapshot.revision);
      });
      assert.match(saved.draft.text, /retained observer/);
      assert.equal(saved.draft.document.content[0].content[0].marks[0].type, 'strong');
      await page.evaluate(() => (window as any).fixture.release());
      await rich.focus(); await page.keyboard.press('Control+z');
      await page.waitForFunction(() => !(window as any).fixture.state.controller.snapshot().draft.text.includes('observer'));
    });

    await t.test('failure keeps the original component and release restores input and undo', async () => {
      await rich.focus(); await page.keyboard.press('End'); await page.keyboard.type(' edit');
      await page.locator('input[type=file]').setInputFiles(image);
      await page.waitForFunction(() => (window as any).fixture.state.uploadWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.evaluate(() => (window as any).fixture.rejectUpload());
      await page.waitForFunction(() => (window as any).fixture.state.result === false);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.controller === (window as any).fixture.oldController), true);
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('alert').filter({ hasText: 'synthetic upload failure' }).waitFor();
      assert.match(await rich.innerText(), /retained edit/);
      await rich.focus(); await page.keyboard.press('End'); await page.keyboard.type(' again');
      assert.match(await rich.innerText(), /retained edit again/);
      await page.keyboard.press('Control+z');
      await page.waitForFunction(() => !(window as any).fixture.state.controller.snapshot().draft.text.includes('again'));
      await page.keyboard.press('Control+Shift+z');
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('edit again'));
      assert.match(await rich.innerText(), /retained edit again/);
    });

    await t.test('cancellation invalidates the pending drain while the accepted file and later edits survive', async () => {
      await page.locator('input[type=file]').setInputFiles(image);
      await page.waitForFunction(() => (window as any).fixture.state.uploadWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.evaluate(() => (window as any).fixture.release());
      await page.waitForFunction(() => (window as any).fixture.state.result === false);
      await rich.focus(); await page.keyboard.press('End'); await page.keyboard.type(' after cancel');
      await page.evaluate(() => (window as any).fixture.resolveUpload());
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.images.length === 2);
      const saved = await page.evaluate(async () => {
        const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
        await f.state.controller.flush(snapshot.owner);
        return f.readComposerDraft(snapshot.owner, snapshot.revision);
      });
      assert.match(saved.draft.text, /after cancel/);
      assert.equal(saved.draft.images.length, 2);
    });

    await t.test('an aborted draft transaction retains the imported attachment and exposes recovery', async () => {
      await page.locator('input[type=file]').setInputFiles(image);
      await page.waitForFunction(() => (window as any).fixture.state.uploadWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
          if (this.name === 'atoms') throw Error('synthetic quota failure');
          return f.originalPut.apply(this, args);
        };
        f.resolveUpload();
      });
      await page.waitForFunction(() => (window as any).fixture.state.result === false);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.images.length), 3);
      await page.evaluate(() => { const f = (window as any).fixture; IDBObjectStore.prototype.put = f.originalPut; f.release(); });
      await page.getByRole('alert').filter({ hasText: 'synthetic quota failure' }).waitFor();
      await page.getByRole('button', { name: '重试保存' }).click();
      await page.waitForFunction(async () => {
        const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
        const saved = await f.readComposerDraft(snapshot.owner, snapshot.revision);
        return saved?.draft.images.length === 3;
      });
    });

    await t.test('a concurrent page cannot replace the frozen projection until release', async () => {
      const second = await context.newPage();
      try {
        await second.route('**/*', route => new URL(route.request().url()).origin === 'http://composer.test'
          ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
        await second.goto('http://composer.test/'); await second.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await second.locator('.ProseMirror strong').waitFor();
        await page.evaluate(async () => {
          const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
          await f.state.controller.flush(snapshot.owner);
        });
        const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
        await page.waitForFunction(() => (window as any).fixture.state.result === true);
        const secondRich = second.locator('.ProseMirror');
        await secondRich.focus(); await second.keyboard.press('Control+End'); await second.keyboard.type(' external');
        await second.evaluate(async () => {
          const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
          await f.state.controller.flush(snapshot.owner);
        });
        await page.getByText(/其他页面或旧数据中有/).waitFor();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
        await page.evaluate(() => (window as any).fixture.release());
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('external'));
      } finally { await second.close(); }
    });

    await t.test('a prefill received during a lease is recovered on release', async () => {
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      await page.evaluate(() => {
        (window as any).fixture.render({ prefill: { id: 'late-prefill', draft: { text: 'late incoming', images: [], files: [] } } });
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => (window as any).fixture.lease.flush()), false);
      await page.evaluate(() => (window as any).fixture.release());
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.pendingDrafts?.some((draft: any) => draft.text === 'late incoming'));
      await page.evaluate(() => (window as any).fixture.render({ prefill: null }));
    });

    await t.test('an in-flight reference removal is drained and a failed removal blocks switching', async () => {
      await page.evaluate(async () => {
        const f = (window as any).fixture, s = f.state.controller.snapshot();
        await f.state.controller.update(s.owner, (draft: any) => ({ ...draft, references: [{ id: 'ref', text: 'Original reference' }] }));
      });
      await page.getByRole('button', { name: '移除引用' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.removalWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.result), null);
      await page.evaluate(() => (window as any).fixture.rejectRemoval());
      await page.waitForFunction(() => (window as any).fixture.state.result === false);
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('alert').filter({ hasText: 'synthetic reference failure' }).waitFor();
      await page.getByText('Original reference').waitFor();
      await page.getByRole('button', { name: '移除引用' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.removalWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.evaluate(() => (window as any).fixture.resolveRemoval());
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.references.length), 0);
      await page.evaluate(() => (window as any).fixture.release());
    });

    await t.test('IME and unsaved queue editing refuse the lease; an accepted queue save is drained', async () => {
      await rich.focus();
      await rich.dispatchEvent('compositionstart', { data: '' });
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), false);
      await page.getByRole('alert').filter({ hasText: '输入法' }).waitFor();
      await rich.dispatchEvent('compositionend', { data: '' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.evaluate(() => (window as any).fixture.release());
      await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'queue-thread', draftId: 'queue-draft' } }));
      await page.getByRole('button', { name: '编辑待发送消息' }).click();
      await page.getByRole('textbox', { name: '编辑待发送消息' }).fill('new queued content');
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), false);
      await page.getByRole('alert').filter({ hasText: '队列编辑' }).waitFor();
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.queueWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.result), null);
      await page.evaluate(() => (window as any).fixture.resolveQueue());
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.queued[0].input[0].text), 'new queued content');
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('button', { name: '编辑待发送消息' }).click();
      await page.getByRole('textbox', { name: '编辑待发送消息' }).fill('saved but refresh failed');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.queueWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.evaluate(() => { const f = (window as any).fixture; f.state.failNextList = true; f.resolveQueue(); });
      await page.waitForFunction(() => (window as any).fixture.state.result === false);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.queued[0].input[0].text), 'saved but refresh failed');
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('alert').filter({ hasText: 'synthetic list failure' }).waitFor();
    });

    await t.test('a history-confirmed queue lock release is included in the drain', async () => {
      await page.evaluate(() => (window as any).fixture.addUnknown());
      await page.waitForFunction(() => (window as any).fixture.state.lockReleaseWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.result), null);
      await page.evaluate(() => (window as any).fixture.resolveLockRelease());
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      await page.evaluate(() => (window as any).fixture.release());
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.readUnknown()), []);
      await page.evaluate(() => (window as any).fixture.addUnknown());
      await page.waitForFunction(() => (window as any).fixture.state.lockReleaseWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.evaluate(() => (window as any).fixture.rejectLockRelease());
      await page.waitForFunction(() => (window as any).fixture.state.result === false);
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('alert').filter({ hasText: 'synthetic lock failure' }).waitFor();
      assert.equal((await page.evaluate(() => (window as any).fixture.readUnknown())).length, 1);
      await page.waitForFunction(() => (window as any).fixture.state.lockReleaseWaiting);
      await page.evaluate(() => (window as any).fixture.resolveLockRelease());
      await page.waitForFunction(async () => (await (window as any).fixture.readUnknown()).length === 0);
    });

    await t.test('a known rejected queue start resumes only its lock release', async () => {
      await page.evaluate(() => (window as any).fixture.addRejected());
      await page.waitForFunction(() => (window as any).fixture.state.lockReleaseWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.result), null);
      await page.evaluate(() => (window as any).fixture.resolveLockRelease());
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.readUnknown()), []);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.lockReleaseSent.at(-1)), false);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.queued[0].id), 'queue-1');
      await page.evaluate(() => (window as any).fixture.release());
    });

    await t.test('an unknown legacy release field is preserved without releasing a lock', async () => {
      const prior = await page.evaluate(() => (window as any).fixture.state.lockReleaseSent.length);
      await page.evaluate(() => (window as any).fixture.addOpaque());
      await page.getByRole('status').filter({ hasText: '1 条消息的发送结果未知' }).waitFor();
      const checks = await page.evaluate(() => (window as any).fixture.state.queueChecks);
      await page.getByRole('button', { name: '重新核对' }).click();
      await page.waitForFunction(count => (window as any).fixture.state.queueChecks > count, checks);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      const state = await page.evaluate(async () => ({
        markers: await (window as any).fixture.readUnknown(),
        calls: (window as any).fixture.state.lockReleaseSent.length,
      }));
      assert.equal(state.markers[0].release, 'sent');
      assert.equal(state.calls, prior);
      await page.evaluate(() => (window as any).fixture.removeOpaque());
      await page.getByRole('status').filter({ hasText: '发送结果未知' }).waitFor({ state: 'detached' });
    });

    await t.test('a failed submission retention blocks the lease and leaves the draft mounted', async () => {
      await editor.fill('retain this failed submission');
      await page.evaluate(async () => {
        const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
        await f.state.controller.flush(snapshot.owner);
      });
      const start = await page.evaluate(() => {
        const f = (window as any).fixture;
        f.originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
          if (this.name === 'atoms') throw Error('synthetic submission retention failure');
          return f.originalPut.apply(this, args);
        };
        const button = document.querySelector('.standalone-composer__submit') as HTMLButtonElement;
        const disabled = button.disabled;
        button.click();
        return { disabled, frozen: f.freeze() };
      });
      try {
        assert.deepEqual(start, { disabled: false, frozen: true });
        await page.waitForFunction(() => (window as any).fixture.state.result !== null).catch(async reason => {
          const state = await page.evaluate(() => {
            const f = (window as any).fixture;
            return { result: f.state.result, submitCalls: f.state.submitCalls, lockReleasePending: f.state.lockReleasePending };
          });
          throw new Error('Submission drain did not settle: ' + JSON.stringify(state), { cause: reason });
        });
        assert.equal(await page.evaluate(() => (window as any).fixture.state.result), false);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.submitCalls), 0);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), 'retain this failed submission');
      } finally {
        await page.evaluate(() => { const f = (window as any).fixture; IDBObjectStore.prototype.put = f.originalPut; f.release(); });
      }
      await page.getByRole('alert').filter({ hasText: 'synthetic submission retention failure' }).waitFor();
    });

    await t.test('a frozen first-send callback cannot clear the draft until release', async () => {
      await editor.fill('send while navigation is preparing');
      await page.evaluate(() => { (window as any).fixture.state.holdSubmit = true; });
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.submitWaiting);
      assert.equal(await page.evaluate(() => (window as any).fixture.freeze()), true);
      await page.waitForFunction(() => (window as any).fixture.state.result === true);
      await page.evaluate(() => (window as any).fixture.resolveSubmit());
      assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), 'send while navigation is preparing');
      await page.evaluate(() => (window as any).fixture.release());
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === '');
    });
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
