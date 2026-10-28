import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';

test('Mini consumes real browser-client requests and distinguishes daemon loss, bridge loss and parent outcomes', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { BrowserWorkbenchClient } from './src/renderer/app/client.ts';
    import { StandaloneMini } from './src/renderer/mini/index.tsx';
    const client=new BrowserWorkbenchClient();
    const calls={replies:[],actions:[],opened:[]}, records=[];
    let pending=[],bridge='connecting',root;
    const hosts={local:{state:'connected',fresh:true,revision:'l1'},'ssh-a':{state:'connected',fresh:true,revision:'r1'}};
    let action={id:'stop',kind:'stop',label:'Stop task',turnId:'turn-1',outcome:'ready'};
    const same=(a,b)=>a.hostId===b.hostId&&a.id===b.id&&a.generation===b.generation;
    function render(){const activities=[{hostId:'ssh-a',threadId:'remote',title:'Remote work',status:'waiting',
      requests:records.filter(x=>x.request.requestRef.hostId==='ssh-a'),actions:[action]},
      {hostId:'local',threadId:'local',title:'Local work',status:'waiting',requests:records.filter(x=>x.request.requestRef.hostId==='local')}];
      root.render(React.createElement(StandaloneMini,{client,send:async()=>{await client.host('test-pet-state')},activities,bridgeState:bridge,
        hostConnections:hosts,pendingRequests:pending,onOpenThread:value=>calls.opened.push(value),onExpand(){},
        onBeforeQuickChatClose:async()=>true,onInputDraftChange:(ref,draft)=>{records.find(x=>same(x.request.requestRef,ref)).request.inputDraft=draft;render()},
        onNotificationAction:async(identity,value)=>{calls.actions.push({identity,turnId:value.turnId,id:value.id,kind:value.kind});action={...action,outcome:'sent'};render()},
        onRespond:async(ref,result)=>{const item=records.find(x=>same(x.request.requestRef,ref)).request;
          if(item.outcome!=='ready'||!pending.some(value=>same(value,ref)))return;
          item.outcome='sending';render();calls.replies.push({ref,result});
          try{await client.reply(ref,{result});item.outcome='sent'}catch(error){item.error=error.message;
            item.outcome=error.uncertain?'unknown':pending.some(value=>same(value,ref))?'ready':'expired'}render()}}));}
    client.subscribe(event=>{
      if(event.type==='connection-state'){bridge=event.state;
        if(event.state!=='connected'){pending=[];for(const host of Object.keys(hosts))hosts[host]={...hosts[host],fresh:false}}render();}
      if(event.type==='codex-app-server-connection-changed'){
        hosts[event.hostId]={...hosts[event.hostId],state:event.state,fresh:false};
        if(event.state!=='connected')pending=pending.filter(ref=>ref.hostId!==event.hostId);render();}
      if(event.type==='fixture-expired'){pending=pending.filter(ref=>!same(ref,event.ref));render()}
      if(event.type==='mcp-request'){
        const ref=event.requestRef, id=String(event.request.id);if(!pending.some(value=>same(value,ref)))pending=[...pending,ref];
        if(!records.some(item=>same(item.request.requestRef,ref))){
          let item;
          if(id==='question')item={kind:'question',request:{requestRef:ref,title:'Question',outcome:'ready',inputDraft:{},questions:[
            {id:'q',header:'Target',question:'Choose target',isOther:true,isSecret:false,options:[{label:'First',description:''},{label:'Second',description:''}]}]}};
          else if(id==='complex')item={kind:'open',request:{requestRef:ref,title:'Review complex request',outcome:'ready'}};
          else item={kind:'approval',request:{requestRef:ref,title:id,outcome:'ready',choices:[{label:'Reply '+id,result:{decision:'accept'}}]}};
          records.push(item);
        }render();}
    });
    function mount(){root=createRoot(document.getElementById('root'));render()}
    window.miniRequestsHarness={calls,records,ready:()=>bridge==='connected'&&pending.some(ref=>ref.id==='question'),
      refresh(host,revision){hosts[host]={...hosts[host],state:'connected',fresh:true,revision};render()},
      nextTurn(){action={...action,turnId:'turn-2',outcome:'ready'};render()},
      remount(){root.unmount();mount()},close(){client.close();root.unmount()}};
    mount();setTimeout(()=>{void client.connect()},50);
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div>'); });
  const webSockets = new WebSocketServer({ server });
  const messages: any[] = [];
  let socket: WebSocket | undefined;
  const refs = [
    {hostId:'ssh-a',id:'A',generation:'generation-a'}, {hostId:'ssh-a',id:'B',generation:'generation-b'},
    {hostId:'ssh-a',id:'known',generation:'generation-known'}, {hostId:'ssh-a',id:'expired',generation:'generation-expired'},
    {hostId:'ssh-a',id:'unknown',generation:'generation-unknown'}, {hostId:'ssh-a',id:'question',generation:'generation-question'},
    {hostId:'ssh-a',id:'complex',generation:'generation-complex'}, {hostId:'local',id:'local',generation:'generation-local'},
  ];
  const active = [...refs];
  const same = (left: typeof refs[number], right: typeof refs[number]) => left.hostId === right.hostId && left.id === right.id && left.generation === right.generation;
  let knownAttempts = 0;
  function emit(value: unknown) { assert.ok(socket); socket.send(JSON.stringify(value)); }
  webSockets.on('connection', connection => {
    socket = connection;
    connection.on('message', data => {
      const message = JSON.parse(String(data)); messages.push(message);
      if (message.type === 'ready') {
        for (const ref of active) emit({type:'mcp-request',hostId:ref.hostId,requestRef:ref,
          request:{id:ref.id,method:'item/commandExecution/requestApproval',params:{threadId:'fixture'}}});
      } else if (message.type === 'fetch') {
        const endpoint = String(message.url).split('/').at(-1);
        emit({type:'fetch-response',requestId:message.requestId,responseType:'success',body:endpoint === 'get-settings' ? {values:{}} : {avatars:[]}});
        if (endpoint === 'test-pet-state') emit({type:'workbench-pet-state',state:{isOpen:true,visibility:'always-visible',position:null}});
      } else if (message.type === 'mcp-response') {
        const ref = {hostId:message.hostId,id:message.response.id,generation:message.generation};
        if (ref.id === 'unknown') { connection.terminate(); return; }
        if (ref.id === 'expired') {
          const index = active.findIndex(value => same(value, ref)); if (index >= 0) active.splice(index, 1);
          emit({type:'fixture-expired',ref});
          emit({type:'server-request-response',requestId:message.requestId,error:'expired ref',uncertain:false}); return;
        }
        if (ref.id === 'known' && knownAttempts++ === 0) {
          emit({type:'server-request-response',requestId:message.requestId,error:'not forwarded',uncertain:false}); return;
        }
        const index = active.findIndex(value => same(value, ref)); if (index >= 0) active.splice(index, 1);
        emit({type:'server-request-response',requestId:message.requestId,success:true});
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addStyleTag({ content: readFileSync('src/renderer/mini/mini.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: 'Reply A' }).waitFor();
    await page.evaluate(() => { (window as any).miniRequestsHarness.refresh('local','l2'); (window as any).miniRequestsHarness.refresh('ssh-a','r2'); });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reply A')?.disabled);
    assert.equal(await page.getByRole('button', { name: 'Reply A' }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Reply B' }).isEnabled(), true);

    const local = active.findIndex(ref => ref.hostId === 'local'); if (local >= 0) active.splice(local, 1);
    emit({type:'codex-app-server-connection-changed',hostId:'local',state:'disconnected'});
    await page.waitForFunction(() => (document.querySelector('button')?.textContent ?? '') !== '');
    await page.getByText('Connection lost. Activity paused.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reply A' }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Reply local' }).isDisabled(), true);
    emit({type:'codex-app-server-connection-changed',hostId:'local',state:'connected'});
    await page.evaluate(() => (window as any).miniRequestsHarness.refresh('local','l3'));
    await page.getByText('Request expired. Open the conversation to check its status.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reply A' }).isEnabled(), true);
    await page.getByRole('button', { name: 'Reply A' }).click();
    await page.getByRole('button', { name: 'Reply B' }).click();
    await page.waitForFunction(() => (window as any).miniRequestsHarness.calls.replies.length === 2);
    assert.deepEqual((await page.evaluate(() => (window as any).miniRequestsHarness.calls.replies)).map((item: any) => item.ref), refs.slice(0, 2));

    await page.getByRole('button', { name: 'Reply known' }).click();
    await page.getByText('Not sent: not forwarded').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reply known' }).isEnabled(), true);
    await page.getByRole('button', { name: 'Reply known' }).click();
    await page.getByRole('button', { name: 'Reply expired' }).click();
    await page.getByText('Request expired. Open the conversation to check its status. expired ref').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reply expired' }).isDisabled(), true);

    await page.getByRole('radio', { name: 'Second' }).check();
    await page.evaluate(() => (window as any).miniRequestsHarness.remount());
    await page.getByRole('radio', { name: 'Second' }).waitFor();
    assert.equal(await page.getByRole('radio', { name: 'Second' }).isChecked(), true);
    await page.getByRole('button', { name: 'Open conversation' }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).miniRequestsHarness.calls.opened), [{hostId:'ssh-a',threadId:'remote'}]);
    await page.getByRole('button', { name: 'Stop task' }).click();
    assert.equal(await page.getByRole('button', { name: 'Stop task' }).isDisabled(), true);
    await page.evaluate(() => (window as any).miniRequestsHarness.nextTurn());
    await page.getByRole('button', { name: 'Stop task' }).click();
    assert.deepEqual((await page.evaluate(() => (window as any).miniRequestsHarness.calls.actions)).map((value: any) => value.turnId), ['turn-1', 'turn-2']);

    await page.getByRole('button', { name: 'Reply unknown' }).click();
    await page.getByText('Response could not be confirmed.', { exact: false }).waitFor();
    await page.waitForFunction(() => (window as any).miniRequestsHarness.records.some((x: any) => x.request.requestRef.id === 'unknown' && x.request.outcome === 'unknown'));
    assert.equal(await page.getByRole('button', { name: 'Submit answer' }).isDisabled(), true);
    await page.waitForFunction(() => (window as any).miniRequestsHarness.ready());
    await page.evaluate(() => { (window as any).miniRequestsHarness.refresh('local','l4'); (window as any).miniRequestsHarness.refresh('ssh-a','r3'); });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Submit answer')?.disabled);
    assert.equal(await page.getByRole('button', { name: 'Reply unknown' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await page.waitForFunction(() => (window as any).miniRequestsHarness.calls.replies.some((item: any) => item.ref.id === 'question'));
    const question = (await page.evaluate(() => (window as any).miniRequestsHarness.calls.replies)).find((item: any) => item.ref.id === 'question');
    assert.deepEqual(question, {ref:refs[5],result:{answers:{q:{answers:['Second']}}}});
    const wireRefs = messages.filter(value => value.type === 'mcp-response').map(value => ({hostId:value.hostId,id:value.response.id,generation:value.generation}));
    assert.deepEqual(wireRefs.slice(0, 2), refs.slice(0, 2));
    assert.deepEqual(errors, []);
    await page.evaluate(() => (window as any).miniRequestsHarness.close());
  } finally {
    await browser.close();
    webSockets.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
