import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';

test('Mini replies with native-host request references from the disposable daemon', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async t => {
  if (!existsSync('.local/visualization-sandbox.js')) { t.skip('Run npm run build:host before testing the actual host'); return; }
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { BrowserWorkbenchClient } from './src/renderer/app/client.ts';
    import { StandaloneMini } from './src/renderer/mini/index.tsx';
    const client=new BrowserWorkbenchClient(), root=createRoot(document.getElementById('root'));
    const records=[], replies=[], resolutions=[];
    let bridge='connecting', host={state:'connecting',fresh:false,revision:'0'}, pending=[], revision=0, petOpen=null;
    const same=(a,b)=>a.hostId===b.hostId&&a.id===b.id&&a.generation===b.generation;
    const send=async message=>{await client.connect();client.socket.send(JSON.stringify(message))};
    function render(){root.render(React.createElement(StandaloneMini,{client,send,bridgeState:bridge,
      hostConnections:{local:host},pendingRequests:pending,
      activities:[{hostId:'local',threadId:'fixture-thread',title:'Fixture',status:'waiting',requests:records}],
      onOpenThread(){},onOpenRequest(){},onExpand(){},onInputDraftChange(){},onBeforeQuickChatClose:async()=>true,
      onRespond:async(ref,result)=>{const item=records.find(value=>same(value.request.requestRef,ref));
        if(!item||item.request.outcome!=='ready'||!pending.some(value=>same(value,ref)))return;
        item.request.outcome='sending';replies.push(ref);render();
        try{await client.reply(ref,{result});item.request.outcome='sent';pending=pending.filter(value=>!same(value,ref))}
        catch(error){item.request.outcome=error.uncertain?'unknown':'expired';item.request.error=error.message}render()}
    }))}
    client.subscribe(event=>{
      if(event.type==='avatar-overlay-open-state-changed'&&typeof event.isOpen==='boolean')petOpen=event.isOpen;
      if(event.type==='workbench-pet-state'&&typeof event.state?.isOpen==='boolean')petOpen=event.state.isOpen;
      if(event.method==='serverRequest/resolved'&&event.requestRef)resolutions.push(event.requestRef);
      if(event.type==='connection-state'){bridge=event.state;
        if(event.state!=='connected'){pending=[];petOpen=null;host={...host,fresh:false}}render()}
      if(event.type==='codex-app-server-connection-changed'&&event.hostId==='local'){
        host={...host,state:event.state,fresh:false};
        if(event.state!=='connected')pending=pending.filter(ref=>ref.hostId!=='local');render()}
      if(event.type==='mcp-request'){
        const ref=event.requestRef, count=records.filter(value=>value.request.requestRef.id===ref.id).length+1;
        pending=[...pending,ref];records.push({kind:'approval',request:{requestRef:ref,title:'Request '+ref.id,
          outcome:'ready',choices:[{label:'Reply '+ref.id+' '+count,result:{decision:'accept'}}]}});render()}
    });
    window.nativeMiniHarness={records,replies,resolutions,ready:()=>bridge==='connected'&&host.state==='connected',
      hostState:()=>host.state,bridgeState:()=>bridge,petReady:()=>typeof petOpen==='boolean',
      refresh(){host={...host,fresh:true,revision:String(++revision)};render()},
      async reconnectHost(){await client.rpc('model/list')},suspend(){client.suspend()},async resume(){await client.resume()},
      async open(){if(typeof petOpen!=='boolean')throw Error('Pet state is not confirmed');
        await send({type:'avatar-overlay-open',isOpen:petOpen})},close(){client.close();root.unmount()}};
    render();void client.connect();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const root = await mkdtemp('/tmp/yard-mini-daemon-');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.after(async () => { await browser?.close(); await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, hostCatalog: { hosts: [], projects: [], assignments: {} } });
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [], wireReplies: any[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.type === 'mcp-response') wireReplies.push(message);
  }));
  await page.route('**/workbench-entry.js', route => route.abort());
  await page.goto(app.url);
  await page.addStyleTag({ content: readFileSync('src/renderer/mini/mini.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.waitForFunction(() => (window as any).nativeMiniHarness.ready());
  await page.waitForFunction(() => (window as any).nativeMiniHarness.petReady());
  await page.evaluate(() => (window as any).nativeMiniHarness.open());
  for (const id of ['first', 'second']) fake.send({ id, method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture-thread' } });
  await page.getByRole('button', { name: 'Reply second 1' }).waitFor();
  await page.evaluate(() => (window as any).nativeMiniHarness.refresh());
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Reply first 1')?.disabled);
  const refs = await page.evaluate(() => (window as any).nativeMiniHarness.records.map((value: any) => value.request.requestRef));
  assert.equal(refs[0].hostId, 'local');
  assert.equal(refs[1].hostId, 'local');
  assert.notEqual(refs[0].generation, refs[1].generation);
  await page.getByRole('button', { name: 'Reply first 1' }).click();
  await fake.waitFor(message => message.id === 'first' && 'result' in message);
  await page.getByRole('button', { name: 'Reply second 1' }).click();
  await fake.waitFor(message => message.id === 'second' && 'result' in message);
  fake.send({ method: 'serverRequest/resolved', params: { requestId: 'first', threadId: 'fixture-thread' } });
  await page.waitForFunction(() => (window as any).nativeMiniHarness.resolutions.length === 1);
  assert.deepEqual(await page.evaluate(() => (window as any).nativeMiniHarness.resolutions[0]), refs[0]);
  fake.send({ id: 'first', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture-thread' } });
  await page.getByRole('button', { name: 'Reply first 2' }).waitFor();
  await page.getByRole('button', { name: 'Reply first 2' }).click();
  await fake.waitFor(() => fake.messages.filter(message => message.id === 'first' && 'result' in message).length === 2);
  const allRefs = await page.evaluate(() => (window as any).nativeMiniHarness.records.map((value: any) => value.request.requestRef));
  assert.notEqual(allRefs[0].generation, allRefs[2].generation);
  assert.deepEqual(await page.evaluate(() => (window as any).nativeMiniHarness.replies), allRefs);
  assert.deepEqual(wireReplies.map(message => ({ hostId: message.hostId, id: message.response.id, generation: message.generation })), allRefs);
  assert.deepEqual(fake.messages.filter(message => ['first', 'second'].includes(String(message.id)) && 'result' in message)
    .map(message => message.result), [{ decision: 'accept' }, { decision: 'accept' }, { decision: 'accept' }]);

  fake.send({ id: 'host-loss', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture-thread' } });
  await page.getByRole('button', { name: 'Reply host-loss 1' }).waitFor();
  fake.disconnect();
  await page.waitForFunction(() => (window as any).nativeMiniHarness.hostState() === 'disconnected');
  assert.equal(await page.getByRole('button', { name: 'Reply host-loss 1' }).isDisabled(), true);
  await page.evaluate(() => (window as any).nativeMiniHarness.reconnectHost());
  await page.waitForFunction(() => (window as any).nativeMiniHarness.hostState() === 'connected');
  fake.send({ id: 'host-loss', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture-thread' } });
  await page.getByRole('button', { name: 'Reply host-loss 2' }).waitFor();
  await page.evaluate(() => (window as any).nativeMiniHarness.refresh());
  assert.equal(await page.getByRole('button', { name: 'Reply host-loss 1' }).isDisabled(), true);
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Reply host-loss 2')?.disabled);
  await page.getByRole('button', { name: 'Reply host-loss 2' }).click();
  await fake.waitFor(message => message.id === 'host-loss' && 'result' in message);

  fake.send({ id: 'bridge-loss', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture-thread' } });
  await page.getByRole('button', { name: 'Reply bridge-loss 1' }).waitFor();
  await page.evaluate(() => (window as any).nativeMiniHarness.suspend());
  await page.waitForFunction(() => (window as any).nativeMiniHarness.bridgeState() === 'disconnected');
  assert.equal(await page.getByRole('button', { name: 'Reply bridge-loss 1' }).isDisabled(), true);
  await page.evaluate(() => (window as any).nativeMiniHarness.resume());
  await page.evaluate(() => (window as any).nativeMiniHarness.reconnectHost());
  await page.waitForFunction(() => (window as any).nativeMiniHarness.ready());
  fake.send({ id: 'bridge-loss', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture-thread' } });
  await page.getByRole('button', { name: 'Reply bridge-loss 2' }).waitFor();
  await page.evaluate(() => (window as any).nativeMiniHarness.refresh());
  assert.equal(await page.getByRole('button', { name: 'Reply bridge-loss 1' }).isDisabled(), true);
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Reply bridge-loss 2')?.disabled);
  await page.getByRole('button', { name: 'Reply bridge-loss 2' }).click();
  await fake.waitFor(message => message.id === 'bridge-loss' && 'result' in message);
  const finalRefs = await page.evaluate(() => (window as any).nativeMiniHarness.records.map((value: any) => value.request.requestRef));
  assert.notEqual(finalRefs[3].generation, finalRefs[4].generation);
  assert.notEqual(finalRefs[5].generation, finalRefs[6].generation);
  assert.deepEqual(await page.evaluate(() => (window as any).nativeMiniHarness.replies),
    [finalRefs[0], finalRefs[1], finalRefs[2], finalRefs[4], finalRefs[6]]);
  assert.deepEqual(wireReplies.map(message => ({ hostId: message.hostId, id: message.response.id, generation: message.generation })),
    [finalRefs[0], finalRefs[1], finalRefs[2], finalRefs[4], finalRefs[6]]);
  assert.deepEqual(errors, []);
  await page.evaluate(() => (window as any).nativeMiniHarness.close());
});
