import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('queue marker migration, concurrent pages and UI recovery use one transaction authority', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneQueue} from './src/renderer/composer/standalone-queue.tsx';
    import {addUnknownQueueStart,readUnknownQueueStarts,removeUnknownQueueStart,queueUnknownAtomKey} from './src/renderer/composer/standalone-queue-storage.ts';
    import {readBrowserAtom} from './src/renderer/storage/ui-atoms.ts';
    const state={queue:[
      {id:'q1',clientUserMessageId:'client1',input:[{type:'text',text:'first',text_elements:[]},{type:'image',url:'fixture'}]},
      {id:'q2',clientUserMessageId:'client2',input:[{type:'text',text:'second',text_elements:[]}]}
    ],history:[],calls:[],starts:[],listeners:new Set()};
    const client={
      async rpc(method,params,hostId){
        state.calls.push({method,params:structuredClone(params),hostId});
        if(method==='thread/queue/list'){
          const offset=params.cursor===''?1:0;
          return {data:structuredClone(state.queue.slice(offset,offset+1)),nextCursor:offset===0&&state.queue.length>1?'':null};
        }
        if(method==='thread/items/list')return {data:state.history.map(item=>({item})),nextCursor:null};
        if(method==='thread/queue/update'){
          const item=state.queue.find(item=>item.id===params.queuedSubmissionId);item.input=structuredClone(params.input);
          window.fixture.notify();return {queuedSubmission:structuredClone(item)};
        }
        throw Error('unexpected RPC '+method);
      },
      async host(endpoint,params){state.calls.push({endpoint,params:structuredClone(params)});return endpoint.endsWith('acquire')?{acquired:true}:{};},
      subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener);},
      async reply(){throw Error('unexpected approval');}
    };
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,store:{add:addUnknownQueueStart,read:readUnknownQueueStarts,remove:removeUnknownQueueStart,atom:queueUnknownAtomKey,readAtom:readBrowserAtom},
      notify(){for(const f of state.listeners)f({type:'mcp-notification',hostId:'local',method:'thread/queue/changed',params:{threadId:'thread'}});},
      render(){root.render(React.createElement(StandaloneQueue,{client,hostId:'local',threadId:'thread',busy:false,refreshVersion:0,
        async onStartQueued(id){state.starts.push(id);throw Error('fixture response lost');}}));},
      async hold(){
        const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('codex-yard.ui-atoms.v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve();}});
        await new Promise((resolve,reject)=>{let first=true;const loop=()=>{const req=store.get('native-atoms');req.onerror=()=>reject(req.error);req.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve();}};};loop();});
        this.release=()=>{released=true;return done;};
      }};
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const context = await browser.newContext();
  try {
    const open = async () => {
      const page = await context.newPage(); page.setDefaultTimeout(8_000);
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
      await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      return page;
    };
    const a = await open(), b = await open(), blocker = await open();
    const trace = await browser.newBrowserCDPSession(), events: unknown[] = [];
    trace.on('Tracing.dataCollected', payload => events.push(...payload.value));
    await trace.send('Tracing.start', {categories:'blink.user_timing',options:'record-as-much-as-possible'});
    await a.evaluate(() => performance.mark('queue-fixture-page-a'));
    await b.evaluate(() => performance.mark('queue-fixture-page-b'));
    const complete = new Promise<void>(resolve => trace.once('Tracing.tracingComplete', () => resolve()));
    await trace.send('Tracing.end'); await complete; await trace.detach();
    const processFor = (name: string) => events.find((value): value is {name:string;pid:number} =>
      value !== null && typeof value === 'object' && 'name' in value && value.name === name && 'pid' in value && typeof value.pid === 'number')?.pid;
    const processA = processFor('queue-fixture-page-a'), processB = processFor('queue-fixture-page-b');
    assert.ok(processA && processB, 'renderer trace marks were recorded');
    assert.notEqual(processA, processB, 'the competing pages use different renderer processes');
    t.diagnostic('Competing renderer process IDs: ' + processA + ', ' + processB);
    const legacyKey = 'codex-yard.queue-unknown.v1:' + JSON.stringify(['ssh', 'legacy']);
    const malformedKey = 'codex-yard.queue-unknown.v1:' + JSON.stringify(['ssh', 'bad']);
    const legacyRaw = '[ {"id":"old","clientUserMessageId":"old-client","lockId":"old-lock","extra":1} ]';
    await a.evaluate(({ legacyKey, malformedKey, legacyRaw }) => {
      localStorage.setItem(legacyKey, legacyRaw); localStorage.setItem(malformedKey, '{bad original');
    }, { legacyKey, malformedKey, legacyRaw });
    assert.equal((await a.evaluate(() => (window as any).fixture.store.read('ssh', 'legacy')))[0].extra, 1);
    assert.equal(await b.evaluate(async () => {
      try { await (window as any).fixture.store.read('ssh', 'bad'); return false; } catch { return true; }
    }), true);
    const atom = await a.evaluate(async () => (window as any).fixture.store.readAtom((window as any).fixture.store.atom));
    assert.equal(atom.archive[legacyKey], legacyRaw);
    assert.equal(atom.archive[malformedKey], '{bad original');
    await a.evaluate(({ legacyKey }) => localStorage.setItem(legacyKey, '[]'), { legacyKey });
    assert.equal((await b.evaluate(() => (window as any).fixture.store.read('ssh', 'legacy'))).length, 1);

    await blocker.evaluate(() => (window as any).fixture.hold());
    await Promise.all([a, b].map((page, side) => page.evaluate(side => {
      const f = (window as any).fixture; f.finished = false;
      f.adding = Promise.all(Array.from({length:30}, (_, i) => f.store.add('ssh', 'parallel', {id:side + ':' + i,clientUserMessageId:'c' + side + ':' + i,lockId:'l' + side + ':' + i}))).then(() => {f.finished = true;});
    }, side)));
    assert.equal(await a.evaluate(() => (window as any).fixture.finished), false);
    assert.equal(await b.evaluate(() => (window as any).fixture.finished), false);
    await blocker.evaluate(() => (window as any).fixture.release());
    await Promise.all([a, b].map(page => page.evaluate(() => (window as any).fixture.adding)));
    const parallel = await a.evaluate(() => (window as any).fixture.store.read('ssh', 'parallel'));
    assert.equal(parallel.length, 60);
    assert.equal(new Set(parallel.map((item: any) => item.id)).size, 60);
    const duplicate = await Promise.all([a, b].map((page, side) => page.evaluate(async side => {
      try { await (window as any).fixture.store.add('ssh', 'duplicate', {id:'same',clientUserMessageId:'client',lockId:'lock' + side}); return true; } catch { return false; }
    }, side)));
    assert.equal(duplicate.filter(Boolean).length, 1);
    const old = { id: 'revision', clientUserMessageId: 'client', lockId: 'old' }, next = { ...old, lockId: 'new' };
    await a.evaluate(async old => { const s = (window as any).fixture.store; await s.add('ssh', 'exact', old); await s.remove('ssh', 'exact', old); }, old);
    await b.evaluate(next => (window as any).fixture.store.add('ssh', 'exact', next), next);
    assert.equal((await a.evaluate(old => (window as any).fixture.store.remove('ssh', 'exact', old), old)).removed, false);
    assert.deepEqual(await b.evaluate(() => (window as any).fixture.store.read('ssh', 'exact')), [next]);

    await a.evaluate(() => (window as any).fixture.render());
    await b.evaluate(() => (window as any).fixture.render());
    await a.getByText('second', {exact:true}).waitFor();
    assert.equal(await a.evaluate(() => (window as any).fixture.state.calls.some((call: any) => call.params?.cursor === '')), true);
    await a.getByRole('button', {name:'编辑待发送消息'}).first().click();
    await a.getByRole('textbox', {name:'编辑待发送消息'}).fill('local edit');
    await a.evaluate(() => { const f = (window as any).fixture; f.state.queue[0].input[0].text = 'remote edit'; f.notify(); });
    await a.getByRole('alert').filter({hasText:'队列消息已更改'}).waitFor();
    assert.equal(await a.getByRole('textbox', {name:'编辑待发送消息'}).inputValue(), 'local edit');
    assert.equal(await a.getByRole('button', {name:'保存',exact:true}).isDisabled(), true);
    await a.getByRole('button', {name:'取消',exact:true}).click();
    await a.getByRole('button', {name:'编辑待发送消息'}).first().click();
    await a.getByRole('textbox', {name:'编辑待发送消息'}).fill('edited');
    await a.getByRole('button', {name:'保存',exact:true}).click();
    await a.getByText('edited',{exact:true}).waitFor();
    const edited = await a.evaluate(() => (window as any).fixture.state.queue[0]);
    assert.equal(edited.clientUserMessageId, 'client1');
    assert.deepEqual(edited.input[1], {type:'image',url:'fixture'});
    await a.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      (window as any).restorePut = () => { IDBObjectStore.prototype.put = original; };
      IDBObjectStore.prototype.put = function(...args) { if(this.name === 'atoms') throw new DOMException('fixture quota','QuotaExceededError'); return original.apply(this,args); };
    });
    await a.getByRole('button', {name:'立即发送待发送消息'}).first().click();
    await a.getByRole('alert').filter({hasText:'已暂停队列操作'}).waitFor();
    assert.equal(await a.evaluate(() => (window as any).fixture.state.starts.length), 0);
    assert.equal(await a.evaluate(() => (window as any).fixture.state.calls.some((c: any) => c.endpoint?.endsWith('release') && c.params.sent === false)), true);
    await a.evaluate(() => (window as any).restorePut());
    await a.getByRole('button', {name:'重试读取'}).click();
    await a.getByRole('button', {name:'立即发送待发送消息'}).first().waitFor({state:'visible'});
    await Promise.all([a.getByRole('button', {name:'立即发送待发送消息'}).first().click(), b.getByRole('button', {name:'立即发送待发送消息'}).last().click()]);
    await a.getByRole('status').filter({hasText:'2 条消息的发送结果未知'}).waitFor();
    await b.getByRole('status').filter({hasText:'2 条消息的发送结果未知'}).waitFor();
    assert.deepEqual((await a.evaluate(() => (window as any).fixture.store.read('local', 'thread'))).map((x: any) => x.id).sort(), ['q1','q2']);
    await a.reload(); await a.addScriptTag({content:bundle.outputFiles[0]!.text}); await a.evaluate(() => (window as any).fixture.render());
    await a.getByRole('status').filter({hasText:'2 条消息的发送结果未知'}).waitFor();
    await a.evaluate(() => {
      const f = (window as any).fixture; f.state.queue = [f.state.queue[1]]; f.state.history = [{type:'userMessage',clientId:'client1'}];
    });
    await a.getByRole('button', {name:'重新核对'}).click();
    await a.getByRole('status').filter({hasText:'1 条消息的发送结果未知'}).waitFor();
    await b.getByRole('status').filter({hasText:'1 条消息的发送结果未知'}).waitFor();
    await a.evaluate(() => {
      const f = (window as any).fixture; f.state.queue = []; f.state.history.push({type:'userMessage',clientId:'client2'}); f.notify();
    });
    await a.getByRole('status').filter({hasText:'发送结果未知'}).waitFor({state:'detached'});
    assert.equal(await a.evaluate(() => (window as any).fixture.state.starts.length), 0);
    assert.equal(await a.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.endpoint?.endsWith('release') && c.params.sent === true).length), 2);
    assert.deepEqual(await a.evaluate(() => (window as any).fixture.store.read('local', 'thread')), []);
    await a.evaluate(async () => {
      const f = (window as any).fixture;
      await f.store.add('local', 'thread', {id:'q3',clientUserMessageId:'client3',lockId:'lock3'});
    });
    await a.getByRole('status').filter({hasText:'1 条消息的发送结果未知'}).waitFor();
    await a.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      (window as any).restorePut = () => { IDBObjectStore.prototype.put = original; };
      IDBObjectStore.prototype.put = function(...args) { if(this.name === 'atoms') throw new DOMException('fixture abort','QuotaExceededError'); return original.apply(this,args); };
      const f = (window as any).fixture; f.state.history.push({type:'userMessage',clientId:'client3'}); f.notify();
    });
    await a.getByRole('alert').filter({hasText:'已暂停队列操作'}).waitFor();
    assert.equal((await a.evaluate(() => (window as any).fixture.store.read('local', 'thread'))).length, 1);
    assert.equal(await a.evaluate(() => (window as any).fixture.state.calls.some((c: any) => c.endpoint?.endsWith('release') && c.params.messageId === 'q3')), false);
    await a.evaluate(() => (window as any).restorePut());
    await a.getByRole('button', {name:'重试读取'}).click();
    await a.getByRole('status').filter({hasText:'发送结果未知'}).waitFor({state:'detached'});
    assert.deepEqual(await a.evaluate(() => (window as any).fixture.store.read('local', 'thread')), []);
    await a.evaluate(() => {
      const f = (window as any).fixture;
      f.state.queue = [{id:'q4',clientUserMessageId:'client4',input:[{type:'text',text:'original',text_elements:[]}]}]; f.notify();
    });
    await a.getByRole('button', {name:'编辑待发送消息'}).click();
    await a.getByRole('textbox', {name:'编辑待发送消息'}).fill('unfinished edit');
    await a.evaluate(() => {const f = (window as any).fixture; f.state.queue = []; f.notify();});
    await a.getByRole('status').filter({hasText:'队列消息已不在列表中'}).waitFor();
    assert.equal(await a.getByRole('textbox', {name:'编辑待发送消息'}).inputValue(), 'unfinished edit');
    assert.equal(await a.evaluate(() => (window as any).fixture.state.starts.length), 0);
  } finally { await context.close(); await browser.close(); }
});
