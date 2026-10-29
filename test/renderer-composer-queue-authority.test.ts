import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';

test('queue mutations retain the original authority through the real browser client and IDB', {
  skip: !existsSync(process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const clientOverride = process.env.YARD_TEST_CLIENT_SOURCE;
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {BrowserWorkbenchClient} from './src/renderer/app/client.ts';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    import {StandaloneQueue} from './src/renderer/composer/standalone-queue.tsx';
    import {readUnknownQueueRecovery} from './src/renderer/composer/standalone-queue-storage.ts';
    import {readComposerDraft} from './src/renderer/composer/composer-draft-store.ts';
    const client=new BrowserWorkbenchClient(), root=createRoot(document.getElementById('root')), aux=createRoot(document.getElementById('aux'));
    const state={controller:null,epoch:0,captures:[],bindings:[],events:[],daemonFailures:0,settled:0,holdMethod:null,blockConnect:false,
      waiting:false,resume:null,realDaemon:typeof client.captureDaemonConnection==='function'};
    const authorities=new WeakMap(), connect=client.connect.bind(client);
    client.connect=()=>{
      const opened=connect();
      if(!state.blockConnect)return opened;
      state.blockConnect=false;
      return opened.then(()=>new Promise(resolve=>{state.waiting=true;state.resume=()=>{state.waiting=false;resolve()}}));
    };
    client.subscribe(event=>state.events.push(event));
    let props={client,context:{hostId:'local',threadId:'thread',draftId:'draft',cwd:'/fixture'},busy:false,
      onDraftController(controller){state.controller=controller},
      captureSubmissionAuthority(owner){
        const epoch=state.epoch, socket=client.socket;
        const connection=state.realDaemon?client.captureDaemonConnection(owner.hostId):{
          generation:'fixture',assertOriginal(){if(client.socket!==socket||socket.readyState!==WebSocket.OPEN)throw Error('socket changed')}
        };
        const original=()=>{try{connection.assertOriginal()}catch(error){state.daemonFailures++;throw error}if(state.epoch!==epoch||!state.controller||
          JSON.stringify(state.controller.snapshot()?.owner)!==JSON.stringify(owner))throw Error('owner changed')};
        original();authorities.set(original,{owner:structuredClone(owner),connection});
        state.captures.push({owner:structuredClone(owner),epoch,generation:connection.generation});return original;
      },
      dispatchQueueMutation(method,params,hostId,original,guard){
        const grant=authorities.get(original);if(!grant||grant.owner.hostId!==hostId)throw Error('lost original authority');
        state.bindings.push({method,hostId,generation:grant.connection.generation,owner:grant.owner});
        if(state.holdMethod===method){state.holdMethod=null;state.blockConnect=true}
        return client.rpc(method,params,hostId,{daemonConnectionGeneration:grant.connection.generation,assertBeforeSend:guard}).finally(()=>state.settled++);
      },
      async onStartQueued(id,guard,original){
        const grant=authorities.get(original);if(!grant)throw Error('lost start original authority');
        state.bindings.push({method:'thread/queue/start',hostId:grant.owner.hostId,generation:grant.connection.generation,owner:grant.owner});
        if(state.holdMethod==='thread/queue/start'){state.holdMethod=null;state.blockConnect=true}
        try { await client.rpc('thread/queue/start',{threadId:'thread',queuedSubmissionId:id},grant.owner.hostId,
          {daemonConnectionGeneration:grant.connection.generation,assertBeforeSend:guard}); } finally { state.settled++; }
      },
      async onSubmit(){throw Error('unexpected submit')},async onInterrupt(){}};
    window.fixture={state,render(changes={}){props={...props,...changes};root.render(React.createElement(StandaloneComposer,props))},
      renderAux(version){const owner=state.controller.snapshot().owner;aux.render(React.createElement(StandaloneQueue,{
        client,hostId:'local',threadId:'thread',busy:false,refreshVersion:version,
        captureAuthority:()=>props.captureSubmissionAuthority(owner),dispatchQueueMutation:props.dispatchQueueMutation,onStartQueued:props.onStartQueued}))},
      async seed(){const owner=state.controller.snapshot().owner;return state.controller.update(owner,draft=>({...draft,text:'retained draft'}))},
      recovery(){return readUnknownQueueRecovery('local','thread')},readDraft:readComposerDraft,close(){root.unmount();client.close()}};
    window.fixture.render();void client.connect();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
    plugins: clientOverride ? [{ name: 'frozen-client', setup(builder) {
      builder.onResolve({ filter: /^\.\/src\/renderer\/app\/client\.ts$/ }, () => ({ path: clientOverride, namespace: 'frozen-client' }));
      builder.onLoad({ filter: /.*/, namespace: 'frozen-client' }, () => ({ contents: readFileSync(clientOverride, 'utf8'),
        resolveDir: `${process.cwd()}/src/renderer/app`, loader: 'ts' }));
    } }] : [] });
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<main id="root"></main><aside id="aux"></aside>'); });
  const peers = new WebSocketServer({ server });
  const sessions: { socket: WebSocket; queue: any[]; frames: any[]; releases: any[]; failRelease: boolean; holdAcquire: boolean; acquire: any }[] = [];
  const send = (socket: WebSocket, message: unknown) => socket.send(JSON.stringify(message));
  peers.on('connection', socket => {
    const peer = { socket, queue: ['a', 'b', 'c'].map(id => ({ id, clientUserMessageId: `client-${id}`,
      input: [{ type: 'text', text: `queued-${id}`, text_elements: [] }] })), frames: [] as any[], releases: [] as any[],
      failRelease: false, holdAcquire: false, acquire: null as any };
    sessions.push(peer);
    socket.on('message', bytes => {
      const frame = JSON.parse(String(bytes)); peer.frames.push(frame);
      if (frame.type === 'ready') {
        send(socket, { type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected', daemonConnectionGeneration: 'g1' });
      } else if (frame.type === 'mcp-request') {
        const { id, method, params } = frame.request;
        let result: unknown;
        if (method === 'thread/queue/list') result = { data: structuredClone(peer.queue), nextCursor: null };
        else if (method === 'thread/items/list') result = { data: [], nextCursor: null };
        else if (method === 'model/list') result = { data: [{ id: 'fixture', model: 'fixture', displayName: 'Fixture', isDefault: true,
          defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null };
        else if (method === 'config/read') result = { config: { model: 'fixture', model_reasoning_effort: 'high', approval_policy: 'on-request', sandbox_mode: 'workspace-write', service_tier: null } };
        else if (method === 'thread/queue/reorder') { peer.queue = params.queuedSubmissionIds.map((id: string) => peer.queue.find(item => item.id === id)); result = {}; }
        else if (method === 'thread/queue/delete' || method === 'thread/queue/start') {
          peer.queue = peer.queue.filter(item => item.id !== params.queuedSubmissionId); result = { deleted: true };
        } else { send(socket, { type: 'mcp-response', message: { id, error: { code: -32601, message: `unexpected ${method}` } } }); return; }
        send(socket, { type: 'mcp-response', message: { id, result } });
      } else if (frame.type === 'fetch') {
        const endpoint = String(frame.url).split('/').at(-1), params = JSON.parse(frame.body);
        if (endpoint === 'queued-follow-up-send-lock-acquire' && peer.holdAcquire) { peer.acquire = frame; return; }
        if (endpoint === 'queued-follow-up-send-lock-release') {
          peer.releases.push(params);
          if (peer.failRelease) { send(socket, { type: 'fetch-response', requestId: frame.requestId, responseType: 'error', error: 'synthetic release failure' }); return; }
        }
        const body = endpoint === 'queued-follow-up-send-lock-acquire' ? { acquired: true }
          : endpoint === 'get-setting' ? { value: params.key === 'followUpQueueMode' ? 'queue' : undefined } : {};
        send(socket, { type: 'fetch-response', requestId: frame.requestId, responseType: 'success', body });
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ executablePath: process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--process-per-tab', '--disable-background-networking'] });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => peers.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve())); });
  const open = async () => {
    const before = sessions.length, context = await browser.newContext(), page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.setDefaultTimeout(8_000); await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    if (!await page.evaluate(() => Boolean((window as any).fixture))) throw new Error(`Fixture did not initialize: ${errors.join('; ')}`);
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner && (window as any).fixture.state.events.some((event: any) => event.type === 'codex-app-server-connection-changed'));
    await page.getByRole('button', { name: '立即发送待发送消息' }).first().waitFor();
    await page.waitForFunction(() => !(document.querySelector('[aria-label="立即发送待发送消息"]') as HTMLButtonElement).disabled);
    if (process.env.YARD_REQUIRE_DAEMON_CONNECTION) assert.equal(await page.evaluate(() => (window as any).fixture.state.realDaemon), true);
    await page.evaluate(() => (window as any).fixture.seed());
    return { context, page, peer: sessions[before]!, errors };
  };
  const mutations = (frames: any[]) => frames.filter(frame => frame.type === 'mcp-request' && ['thread/queue/reorder', 'thread/queue/delete', 'thread/queue/start'].includes(frame.request.method));
  const checkDraft = async (page: any) => assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), 'retained draft');
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 8_000;
    while (!check()) { if (Date.now() > deadline) throw Error('Timed out waiting for the synthetic peer'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  await t.test('missing parent dispatch disables writes and normal actions carry the same original grant', async () => {
    const { context, page, peer, errors } = await open();
    try {
      await page.evaluate(() => (window as any).fixture.render({ dispatchQueueMutation: undefined }));
      assert.equal(await page.getByRole('button', { name: '删除待发送消息' }).first().isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '下移待发送消息' }).first().isDisabled(), true);
      assert.equal(mutations(peer.frames).length, 0);
      await page.evaluate(() => (window as any).fixture.render({ captureSubmissionAuthority: undefined }));
      assert.equal(await page.getByRole('button', { name: '立即发送待发送消息' }).first().isDisabled(), true);
    } finally { await context.close(); }
    assert.deepEqual(errors, []);
  });
  await t.test('normal reorder, delete and start use the original owner and grant', async () => {
    const { context, page, peer, errors } = await open();
    try {
      const clicked = await page.evaluate(() => { const f = (window as any).fixture; const before = f.state.captures.length;
        (document.querySelector('[aria-label="下移待发送消息"]') as HTMLButtonElement).click(); return f.state.captures.length - before; });
      assert.equal(clicked, 1, 'capture occurs synchronously during the click');
      await wait(() => mutations(peer.frames).length === 1);
      await page.getByText('queued-b', { exact: true }).waitFor();
      await page.waitForFunction(() => !(document.querySelector('[aria-label="删除待发送消息"]') as HTMLButtonElement).disabled);
      await page.getByRole('button', { name: '删除待发送消息' }).first().click();
      await wait(() => mutations(peer.frames).length === 2);
      await page.waitForFunction(() => !(document.querySelector('[aria-label="立即发送待发送消息"]') as HTMLButtonElement).disabled);
      await page.getByRole('button', { name: '立即发送待发送消息' }).first().click();
      await wait(() => mutations(peer.frames).length === 3 && peer.releases.length === 1);
      const frames = mutations(peer.frames);
      assert.deepEqual(frames.map(frame => frame.request.method), ['thread/queue/reorder', 'thread/queue/delete', 'thread/queue/start']);
      assert.deepEqual(frames[0].request.params.queuedSubmissionIds, ['b', 'a', 'c']);
      assert.equal(frames[1].request.params.queuedSubmissionId, 'b');
      assert.equal(frames[2].request.params.queuedSubmissionId, 'a');
      assert.deepEqual(peer.queue.map(item => item.id), ['c']);
      if (process.env.YARD_REQUIRE_DAEMON_CONNECTION) assert.ok(frames.every(frame => frame.daemonConnectionGeneration === 'g1'));
      const bindings = await page.evaluate(() => (window as any).fixture.state.bindings);
      assert.deepEqual(bindings.map((item: any) => item.method), frames.map(frame => frame.request.method));
      assert.ok(bindings.every((item: any) => item.hostId === 'local' && item.owner.threadId === 'thread' && item.owner.draftId === 'draft'));
      assert.equal(peer.releases[0].sent, true); await checkDraft(page);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  for (const [name, label, method] of [
    ['reorder', '下移待发送消息', 'thread/queue/reorder'], ['delete', '删除待发送消息', 'thread/queue/delete'],
    ['start', '立即发送待发送消息', 'thread/queue/start'],
  ] as const) await t.test(`${name} refuses an owner ABA while the real client waits before dispatch`, async () => {
    const { context, page, peer, errors } = await open();
    try {
      await page.evaluate((value: string) => { (window as any).fixture.state.holdMethod = value; }, method);
      const captured = await page.evaluate((name: string) => { const state = (window as any).fixture.state, before = state.captures.length;
        (document.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement).click(); return state.captures.length - before; }, label);
      assert.equal(captured, 1, 'each control captures before its first await');
      await page.waitForFunction(() => (window as any).fixture.state.waiting);
      await page.evaluate(() => { const state = (window as any).fixture.state; state.epoch += 2; state.resume(); });
      await page.getByRole('alert').filter({ hasText: '未发送请求' }).waitFor();
      assert.equal(mutations(peer.frames).length, 0); await checkDraft(page);
      if (name === 'start') {
        await wait(() => peer.releases.length === 1); assert.equal(peer.releases[0].sent, false);
        assert.equal((await page.evaluate(() => (window as any).fixture.recovery())).markers.length, 0);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await t.test('start captures before the IDB wait and refuses a revoked original grant', async () => {
    const { context, page, peer, errors } = await open();
    const blocker = await context.newPage();
    try {
      await blocker.goto(`http://127.0.0.1:${port}/`);
      await blocker.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('codex-yard.ui-atoms.v1', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        const tx = db.transaction('atoms', 'readwrite'), store = tx.objectStore('atoms'); let released = false;
        const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); });
        await new Promise<void>((resolve, reject) => { let first = true; const loop = () => { const req = store.get('native-atoms'); req.onerror = () => reject(req.error);
          req.onsuccess = () => { if (!released) loop(); if (first) { first = false; resolve(); } }; }; loop(); });
        (window as any).releaseHeld = () => { released = true; return done; };
      });
      const captured = await page.evaluate(() => { const state = (window as any).fixture.state, before = state.captures.length;
        (document.querySelector('[aria-label="立即发送待发送消息"]') as HTMLButtonElement).click(); return state.captures.length - before; });
      assert.equal(captured, 1);
      await wait(() => peer.frames.some(frame => frame.type === 'fetch' && frame.url.endsWith('/queued-follow-up-send-lock-acquire')));
      await page.evaluate(() => { (window as any).fixture.state.epoch += 2; });
      await blocker.evaluate(() => (window as any).releaseHeld());
      await page.getByRole('alert').filter({ hasText: '未发送请求' }).waitFor();
      await wait(() => peer.releases.length === 1);
      assert.equal(peer.releases[0].sent, false); assert.equal(mutations(peer.frames).length, 0);
      assert.equal((await page.evaluate(() => (window as any).fixture.recovery())).markers.length, 0);
      await checkDraft(page); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await t.test('start refuses an owner ABA while the send lock is being acquired', async () => {
    const { context, page, peer, errors } = await open();
    try {
      peer.holdAcquire = true;
      const captured = await page.evaluate(() => { const state = (window as any).fixture.state, before = state.captures.length;
        (document.querySelector('[aria-label="立即发送待发送消息"]') as HTMLButtonElement).click(); return state.captures.length - before; });
      assert.equal(captured, 1);
      await wait(() => peer.acquire !== null);
      await page.evaluate(() => { (window as any).fixture.state.epoch += 2; });
      send(peer.socket, { type: 'fetch-response', requestId: peer.acquire.requestId, responseType: 'success', body: { acquired: true } });
      await page.getByRole('alert').filter({ hasText: '未发送请求' }).waitFor();
      await wait(() => peer.releases.length === 1);
      assert.equal(peer.releases[0].sent, false); assert.equal(mutations(peer.frames).length, 0);
      assert.equal((await page.evaluate(() => (window as any).fixture.recovery())).markers.length, 0);
      await checkDraft(page); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await t.test('daemon generation ABA cannot authorize an older click', async () => {
    const { context, page, peer, errors } = await open();
    try {
      await page.evaluate(() => { (window as any).fixture.state.holdMethod = 'thread/queue/delete'; });
      await page.getByRole('button', { name: '删除待发送消息' }).first().click();
      await page.waitForFunction(() => (window as any).fixture.state.waiting);
      send(peer.socket, { type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected', daemonConnectionGeneration: 'g2' });
      send(peer.socket, { type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected', daemonConnectionGeneration: 'g1' });
      await page.waitForFunction(() => (window as any).fixture.state.events.filter((event: any) => event.type === 'codex-app-server-connection-changed').length >= 3);
      await page.evaluate(() => (window as any).fixture.state.resume());
      await page.getByRole('alert').filter({ hasText: '未发送请求' }).waitFor();
      if (process.env.YARD_REQUIRE_DAEMON_CONNECTION) assert.ok(await page.evaluate(() => (window as any).fixture.state.daemonFailures) > 0);
      assert.equal(mutations(peer.frames).length, 0); await checkDraft(page); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await t.test('a queue change during the client wait cancels the original delete', async () => {
    const { context, page, peer, errors } = await open();
    try {
      await page.evaluate(() => { (window as any).fixture.state.holdMethod = 'thread/queue/delete'; });
      await page.getByRole('button', { name: '删除待发送消息' }).first().click();
      await page.waitForFunction(() => (window as any).fixture.state.waiting);
      peer.queue[0].input[0].text = 'changed by another writer';
      send(peer.socket, { type: 'mcp-notification', hostId: 'local', method: 'thread/queue/changed', params: { threadId: 'thread' } });
      await page.waitForFunction(() => (window as any).fixture.state.events.some((event: any) => event.method === 'thread/queue/changed'));
      await page.evaluate(() => (window as any).fixture.state.resume());
      await page.getByRole('alert').filter({ hasText: '未发送请求' }).waitFor();
      assert.equal(mutations(peer.frames).length, 0); assert.equal(peer.queue[0].input[0].text, 'changed by another writer');
      await checkDraft(page); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await t.test('a queue resubscription cannot revive an older pending action', async () => {
    const { context, page, peer, errors } = await open();
    try {
      await page.evaluate(() => (window as any).fixture.renderAux(0));
      const aux = page.locator('#aux');
      await aux.getByRole('button', { name: '删除待发送消息' }).first().waitFor();
      await page.waitForFunction(() => !(document.querySelector('#aux [aria-label="删除待发送消息"]') as HTMLButtonElement).disabled);
      await page.evaluate(() => { (window as any).fixture.state.holdMethod = 'thread/queue/delete'; });
      await aux.getByRole('button', { name: '删除待发送消息' }).first().click();
      await page.waitForFunction(() => (window as any).fixture.state.waiting);
      const reads = peer.frames.filter(frame => frame.type === 'mcp-request' && frame.request.method === 'thread/queue/list').length;
      await page.evaluate(() => (window as any).fixture.renderAux(1));
      await wait(() => peer.frames.filter(frame => frame.type === 'mcp-request' && frame.request.method === 'thread/queue/list').length > reads);
      await page.evaluate(() => (window as any).fixture.state.resume());
      await page.waitForFunction(() => (window as any).fixture.state.settled === 1);
      assert.equal(mutations(peer.frames).length, 0); await checkDraft(page); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await t.test('switching the actual composer owner prevents the old delete and retains its draft', async () => {
    const { context, page, peer, errors } = await open();
    try {
      const owner = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().owner);
      await page.evaluate(() => { (window as any).fixture.state.holdMethod = 'thread/queue/delete'; });
      await page.getByRole('button', { name: '删除待发送消息' }).first().click();
      await page.waitForFunction(() => (window as any).fixture.state.waiting);
      await page.evaluate(() => (window as any).fixture.render({ context: { hostId: 'local', threadId: 'other', draftId: 'other', cwd: '/fixture' } }));
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.threadId === 'other');
      await page.evaluate(() => (window as any).fixture.state.resume());
      await page.waitForFunction(() => (window as any).fixture.state.settled === 1);
      assert.equal(mutations(peer.frames).length, 0);
      assert.equal((await page.evaluate((value: any) => (window as any).fixture.readDraft(value), owner)).draft.text, 'retained draft');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await t.test('a failed release retains the not-sent marker until local cleanup succeeds', async () => {
    const { context, page, peer, errors } = await open();
    try {
      peer.failRelease = true;
      await page.evaluate(() => { (window as any).fixture.state.holdMethod = 'thread/queue/start'; });
      await page.getByRole('button', { name: '立即发送待发送消息' }).first().click();
      await page.waitForFunction(() => (window as any).fixture.state.waiting);
      await page.evaluate(() => { const state = (window as any).fixture.state; state.epoch += 2; state.resume(); });
      await wait(() => peer.releases.length > 0);
      let recovery = await page.evaluate(() => (window as any).fixture.recovery());
      assert.equal(recovery.markers.length, 1); assert.equal(recovery.releases.length, 1);
      assert.equal(recovery.releases[0].sent, false); assert.equal(mutations(peer.frames).length, 0);
      peer.failRelease = false;
      await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === '重新核对'); button?.click(); });
      const deadline = Date.now() + 8_000;
      do { recovery = await page.evaluate(() => (window as any).fixture.recovery());
        if (!recovery.markers.length && !recovery.releases.length) break;
        if (Date.now() > deadline) throw Error('Timed out waiting for release recovery');
        await new Promise(resolve => setTimeout(resolve, 20));
      } while (true);
      assert.equal(mutations(peer.frames).length, 0); await checkDraft(page); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
