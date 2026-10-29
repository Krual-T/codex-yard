import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('composer captures submit authority before the durable retain waits', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 180_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    import {readComposerDraftVersions} from './src/renderer/composer/composer-draft-store.ts';
    import {readUnknownQueueStarts} from './src/renderer/composer/standalone-queue-storage.ts';
    const state={controller:null,captures:[],submissions:[],checks:0,connected:true,authorized:true,
      connectionRevision:1,ownerRevision:1,failCapture:false,lastAssertion:null,parentEntered:false,holdParent:false,
      queue:[],listeners:new Set(),queueStarts:[],queueAssertion:null,holdAcquire:false,acquireWaiting:false,releases:[],transactionsAfterCapture:0};
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){
      if(state.captures.length&&args[0]==='atoms'&&args[1]==='readwrite')state.transactionsAfterCapture++;
      return transaction.apply(this,args);
    };
    let releaseParent,releaseAcquire;
    const client={async rpc(method){if(method==='model/list')return {data:[],nextCursor:null};
        if(method==='thread/queue/list')return {data:structuredClone(state.queue),nextCursor:null};
        if(method==='config/read')return {config:{}};throw Error('unexpected RPC '+method)},
      async host(method,params={}){if(method==='get-setting')return {exists:true,value:params.key==='composerEnterBehavior'?'enter':
          params.key==='followUpQueueMode'?'queue':params.key==='composerPlainTextMode'?false:undefined};
        if(method==='queued-follow-up-send-lock-acquire'){if(state.holdAcquire){state.acquireWaiting=true;
          await new Promise(resolve=>{releaseAcquire=resolve});state.acquireWaiting=false;}return {acquired:true};}
        if(method==='queued-follow-up-send-lock-release'){state.releases.push(structuredClone(params));return {};}
        throw Error('unexpected host '+method)},subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener)},
      async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    let props={client,context:{hostId:'fixture-host',threadId:'fixture-thread',draftId:'fixture-draft',cwd:'/fixture'},
      busy:false,activeTurnId:'fixture-turn',onDraftController(value){state.controller=value},
      captureSubmissionAuthority(owner){
        if(state.failCapture||!state.connected||!state.authorized)throw Error('fixture authority unavailable');
        const connection=state.connectionRevision,ownership=state.ownerRevision;
        const assertion=()=>{state.checks++;if(!state.connected||!state.authorized||state.connectionRevision!==connection||state.ownerRevision!==ownership)
          throw Error('fixture authority changed')};
        state.lastAssertion=assertion;state.captures.push({owner:structuredClone(owner),connection,ownership});return assertion;
      },
      async onSubmit(draft,options,action,description,assertion){
        state.parentEntered=true;state.receivedSameAssertion=assertion===state.lastAssertion;
        if(state.holdParent)await new Promise(resolve=>{releaseParent=resolve});
        assertion?.();state.submissions.push(structuredClone({draft,options,action,description}));
      },async onInterrupt(){},async onStartQueued(id,assertion){state.queueAssertion=assertion;assertion?.();state.queueStarts.push(id)}};
    window.fixture={state,readComposerDraftVersions,readUnknownQueueStarts,
      render(changes={}){props={...props,...changes};root.render(React.createElement(StandaloneComposer,props));},
      reconnect(){state.connected=false;state.connectionRevision++;state.connected=true},
      regrant(){state.authorized=false;state.ownerRevision++;state.authorized=true},
      releaseParent(){releaseParent()},
      releaseAcquire(){releaseAcquire()},
      setQueue(){state.queue=[{id:'fixture-queued',clientUserMessageId:'fixture-client',input:[{type:'text',text:'queued item',text_elements:[]}]}];
        for(const listener of state.listeners)listener({type:'mcp-notification',hostId:'fixture-host',method:'thread/queue/changed',params:{threadId:'fixture-thread'}})},
      async hold(){
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
          request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve()}});
        await new Promise((resolve,reject)=>{let first=true;const poll=()=>{const request=store.get('native-atoms');
          request.onerror=()=>reject(request.error);request.onsuccess=()=>{if(!released)poll();if(first){first=false;resolve()}}};poll()});
        this.release=()=>{released=true;return done};
      }};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const script = bundle.outputFiles[0]!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const owner = { hostId: 'fixture-host', threadId: 'fixture-thread', draftId: 'fixture-draft' };
  try {
    for (const scenario of [
      { name: 'send after disconnect and reconnect', busy: false, button: '发送', invalidation: 'reconnect', action: { type: 'send' } },
      { name: 'queue after owner access is revoked and regranted', busy: true, button: '排队', invalidation: 'regrant', action: { type: 'queue' } },
      { name: 'steer after disconnect and reconnect', busy: true, button: '发送到当前任务', invalidation: 'reconnect', action: { type: 'steer', turnId: 'fixture-turn' } },
    ] as const) {
      await t.test(scenario.name, async () => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage(), blocker = await context.newPage();
          page.setDefaultTimeout(10_000); blocker.setDefaultTimeout(10_000);
          for (const target of [page, blocker]) {
            await target.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
            await target.goto('http://localhost/'); await target.addScriptTag({ content: script });
            await target.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
          }
          await page.evaluate(busy => (window as any).fixture.render({ busy }), scenario.busy);
          const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
          await editor.fill('retained ' + scenario.name);
          assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
          const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
          assert.deepEqual(before.owner, owner);
          const button = page.getByRole('button', { name: scenario.button, exact: true });
          await button.waitFor(); await page.waitForFunction(name => {
            const button = Array.from(document.querySelectorAll('button')).find(value => value.textContent === name);
            return button && !button.disabled;
          }, scenario.button);
          await blocker.evaluate(() => (window as any).fixture.hold());
          await button.click();
          await page.waitForFunction(() => (window as any).fixture.state.captures.length === 1);
          await page.waitForFunction(() => (window as any).fixture.state.transactionsAfterCapture > 0);
          await page.getByRole('button', { name: '发送中', exact: true }).waitFor();
          assert.equal(await page.evaluate(() => (window as any).fixture.state.parentEntered), false);
          assert.equal(await page.evaluate(() => (window as any).fixture.state.checks), 0);
          await page.evaluate(method => (window as any).fixture[method](), scenario.invalidation);
          assert.deepEqual(await page.evaluate(() => ({ connected: (window as any).fixture.state.connected,
            authorized: (window as any).fixture.state.authorized })), { connected: true, authorized: true });
          await blocker.evaluate(() => (window as any).fixture.release());
          await page.getByRole('alert').filter({ hasText: '无法发送，草稿已保留：fixture authority changed' }).waitFor();
          assert.equal(await page.evaluate(() => (window as any).fixture.state.parentEntered), false);
          assert.equal(await editor.inputValue(), 'retained ' + scenario.name);
          const view = await page.evaluate(() => {
            const f = (window as any).fixture; return f.readComposerDraftVersions(f.state.controller.snapshot().owner);
          });
          assert.ok(view.versions.some((value: any) => value.revision === before.revision && value.draft.text === before.draft.text));
          assert.ok(view.retained.some((value: any) => value.revision === before.revision && value.draft.text === before.draft.text));

          await page.reload(); await page.addScriptTag({ content: script });
          await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
          await page.evaluate(busy => (window as any).fixture.render({ busy }), scenario.busy);
          await page.waitForFunction(value => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === value,
            'retained ' + scenario.name);
          const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
          await page.waitForFunction(name => {
            const button = Array.from(document.querySelectorAll('button')).find(value => value.textContent === name);
            return button && !button.disabled;
          }, scenario.button);
          await button.click();
          await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
          const result = await page.evaluate(() => ({ captures: (window as any).fixture.state.captures,
            submission: (window as any).fixture.state.submissions[0], checks: (window as any).fixture.state.checks,
            same: (window as any).fixture.state.receivedSameAssertion }));
          assert.deepEqual(result.captures[0].owner, owner);
          assert.deepEqual(result.submission.action, scenario.action);
          assert.deepEqual(result.submission.description.owner, owner);
          assert.equal(result.submission.description.revision, current.revision);
          assert.equal(result.submission.draft.text, current.draft.text);
          assert.equal(result.same, true);
          assert.equal(result.checks, 2);
        } finally { await context.close(); }
      });
    }

    await t.test('capture failure retains the existing version without invoking the parent', async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage(); page.setDefaultTimeout(10_000);
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
        await page.goto('http://localhost/'); await page.addScriptTag({ content: script });
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await editor.fill('capture refused');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        await page.evaluate(() => { (window as any).fixture.state.failCapture = true; });
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '无法发送，草稿已保留：fixture authority unavailable' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.parentEntered), false);
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
        const view = await page.evaluate(() => { const f = (window as any).fixture; return f.readComposerDraftVersions(f.state.controller.snapshot().owner); });
        assert.ok(view.versions.some((value: any) => value.revision === before.revision && value.draft.text === 'capture refused'));
        assert.equal(view.retained.length, 0);
      } finally { await context.close(); }
    });

    await t.test('the parent can recheck the same original assertion after its own wait', async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage(); page.setDefaultTimeout(10_000);
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
        await page.goto('http://localhost/'); await page.addScriptTag({ content: script });
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await editor.fill('after parent wait');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        await page.evaluate(() => { (window as any).fixture.state.holdParent = true; });
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.parentEntered);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.receivedSameAssertion), true);
        await page.evaluate(() => { (window as any).fixture.regrant(); (window as any).fixture.releaseParent(); });
        await page.getByRole('alert').filter({ hasText: 'fixture authority changed' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
        assert.equal(await editor.inputValue(), 'after parent wait');
      } finally { await context.close(); }
    });

    await t.test('composer forwards its owner authority to the actual queued-start control', async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage(); page.setDefaultTimeout(10_000);
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
        await page.goto('http://localhost/'); await page.addScriptTag({ content: script });
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
        await page.evaluate(() => { const f = (window as any).fixture; f.state.holdAcquire = true; f.setQueue(); });
        const start = page.getByRole('button', { name: '立即发送待发送消息' });
        await start.waitFor(); await page.waitForFunction(() => {
          const button = document.querySelector('button[aria-label="立即发送待发送消息"]') as HTMLButtonElement | null;
          return button && !button.disabled;
        });
        await start.click();
        await page.waitForFunction(() => (window as any).fixture.state.acquireWaiting);
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.captures[0].owner), owner);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.queueStarts.length), 0);
        await page.evaluate(() => { const f = (window as any).fixture; f.regrant(); f.state.holdAcquire = false; f.releaseAcquire(); });
        await page.getByRole('alert').filter({ hasText: '原队列点击的连接或权限已改变' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.queueStarts.length), 0);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.releases.filter((value: any) => !value.sent).length), 1);
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.readUnknownQueueStarts('fixture-host', 'fixture-thread')), []);
        await start.click();
        await page.waitForFunction(() => (window as any).fixture.state.queueStarts.length === 1);
        const result = await page.evaluate(() => ({ captures: (window as any).fixture.state.captures,
          starts: (window as any).fixture.state.queueStarts, hasAssertion: typeof (window as any).fixture.state.queueAssertion === 'function' }));
        assert.deepEqual(result.captures.map((value: any) => value.owner), [owner, owner]);
        assert.deepEqual(result.starts, ['fixture-queued']);
        assert.equal(result.hasAssertion, true);
        assert.equal(await page.evaluate(() => {
          const f = (window as any).fixture; f.reconnect();
          try { f.state.queueAssertion(); return false; } catch { return true; }
        }), true);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
