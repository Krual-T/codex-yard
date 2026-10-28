import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('queue starts use the committed marker receipt and recover a known undispatched release', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneQueue} from './src/renderer/composer/standalone-queue.tsx';
    import {readUnknownQueueRecovery} from './src/renderer/composer/standalone-queue-storage.ts';
    const state={starts:0,acquires:0,releases:[],failRelease:false,failRead:false,failedReads:0};
    const client={async rpc(method){if(method==='thread/queue/list')return {data:[{id:'q',clientUserMessageId:'client-q',
        input:[{type:'text',text:'queued',text_elements:[]}]}],nextCursor:null};
      if(method==='thread/items/list')return {data:[],nextCursor:null};throw Error('unexpected RPC '+method)},
      async host(method,params){if(method==='queued-follow-up-send-lock-acquire'){state.acquires++;return {acquired:true};}
        if(method==='queued-follow-up-send-lock-release'){state.releases.push(structuredClone(params));
          if(state.failRelease){state.failRelease=false;throw Error('synthetic release failure')}return {};}
        throw Error('unexpected host '+method)},subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let root;
    const fixture={state,
      render(){root=createRoot(document.getElementById('root'));root.render(React.createElement(StandaloneQueue,{client,hostId:'ssh-fixture',threadId:'thread',busy:false,refreshVersion:0,
        async onStartQueued(){state.starts++;throw Error('synthetic unknown response')}}));},
      unmount(){root.unmount()},recovery(){return readUnknownQueueRecovery('ssh-fixture','thread')},
      failReadAfterMarker(){const put=IDBObjectStore.prototype.put,get=IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.put=function(value,...args){const repo=value?.atoms?.['codex-yard.queue-unknown.v2'];
          if(repo && Object.values(repo.queues).some(items=>Array.isArray(items)&&items.some(item=>item.id==='q')))state.failRead=true;
          return put.call(this,value,...args)};
        IDBObjectStore.prototype.get=function(...args){if(this.name==='atoms'&&state.failRead){state.failRead=false;state.failedReads++;throw Error('synthetic read failure')}
          return get.apply(this,args)};
        this.restore=()=>{IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.get=get};},
      async hold(){const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('codex-yard.ui-atoms.v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve()}});
        await new Promise((resolve,reject)=>{let first=true;const loop=()=>{const req=store.get('native-atoms');req.onerror=()=>reject(req.error);
          req.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve()}}};loop()});
        this.release=()=>{released=true;return done}}};
    window.fixture=fixture;
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  async function pageFor(context: Awaited<ReturnType<typeof browser.newContext>>) {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    return page;
  }
  try {
    await t.test('a failed later storage read does not prevent dispatch or claim a known failure', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context);
        await page.evaluate(() => (window as any).fixture.render());
        const send = page.getByRole('button', { name: '立即发送待发送消息' }); await send.waitFor();
        await page.evaluate(() => (window as any).fixture.failReadAfterMarker());
        await send.click();
        await page.waitForFunction(() => (window as any).fixture.state.starts === 1 && (window as any).fixture.state.failedReads > 0);
        await page.evaluate(() => (window as any).fixture.restore());
        const result = await page.evaluate(async () => ({ state: (window as any).fixture.state, recovery: await (window as any).fixture.recovery() }));
        assert.equal(result.state.starts, 1); assert.equal(result.state.releases.length, 0);
        assert.equal(result.recovery.markers.length, 1); assert.equal(result.recovery.releases.length, 0);
      } finally { await context.close(); }
    });
    await t.test('unmount before dispatch records sent:false and resumes a failed lock release', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context), blocker = await pageFor(context);
        await page.evaluate(() => (window as any).fixture.render());
        const send = page.getByRole('button', { name: '立即发送待发送消息' }); await send.waitFor();
        await page.waitForFunction(() => !(document.querySelector('[aria-label="立即发送待发送消息"]') as HTMLButtonElement).disabled);
        await blocker.evaluate(() => (window as any).fixture.hold());
        await page.evaluate(() => { (window as any).fixture.state.failRelease = true; });
        await send.click();
        await page.waitForFunction(() => (window as any).fixture.state.acquires === 1);
        await page.evaluate(() => (window as any).fixture.unmount());
        await blocker.evaluate(() => (window as any).fixture.release());
        await page.waitForFunction(() => (window as any).fixture.state.releases.length === 1);
        const failed = await page.evaluate(() => (window as any).fixture.recovery());
        assert.equal(failed.markers.length, 1); assert.equal(failed.releases.length, 1);
        assert.equal(failed.releases[0].sent, false);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.starts), 0);
        await page.evaluate(() => (window as any).fixture.render());
        await page.waitForFunction(() => (window as any).fixture.state.releases.length === 2);
        await page.waitForFunction(async () => (await (window as any).fixture.recovery()).markers.length === 0);
        const state = await page.evaluate(() => (window as any).fixture.state);
        assert.equal(state.starts, 0);
        assert.ok(state.releases.every((release: any) => release.sent === false && release.hostId === 'ssh-fixture'));
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
