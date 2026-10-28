import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('scoped interrupt and the real queue preserve dispatch and lock boundaries', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SideChatController} from './src/renderer/side-chat/controller.ts';
    import {SideChatPanel} from './src/renderer/side-chat/SideChatPanel.tsx';
    import {readUnknownQueueStarts} from './src/renderer/composer/standalone-queue-storage.ts';
    const state={rpc:[],checks:[],interrupts:[],starts:[],releases:[],persistence:[],generation:'original',queueMode:'not-sent',acquires:0,showPending:false};
    let releaseAcquire;
    const thread={id:'child',name:null,cwd:'/synthetic',turns:[],status:{type:'idle'}};
    const history={hostId:'a',threadId:'child',thread,options:{},loading:false,historyComplete:true,streamGap:false,error:null,
      canSubmit:true,canInterrupt:true,retry(){}};
    const view={operationId:'operation-a',parent:{hostId:'a',threadId:'parent',cwd:'/synthetic'},childId:'child',
      child:{thread:structuredClone(thread),options:{}},fork:{status:'received',error:null},inject:{status:'received',error:null},
      close:{requested:false,status:'idle',error:null},recoveryError:null};
    const port={read:async()=>structuredClone(view),prepare:async()=>structuredClone(view),start:async()=>structuredClone(view),
      retry:async()=>structuredClone(view),close:async()=>structuredClone(view),retryPersistence:async()=>structuredClone(view),subscribe:()=>()=>{}};
    const controller=new SideChatController({hostId:'a',parentThreadId:'parent',draftId:'side-draft',restored:view,port,canDispatch:()=>true,onPrepared:async()=>{}});
    const pendingView={...structuredClone(view),operationId:'operation-pending',inject:{status:'inflight',error:null}};
    const pendingPort={...port,read:async()=>structuredClone(pendingView),retryPersistence:async id=>{state.persistence.push(id);return structuredClone(pendingView);}};
    const pendingController=new SideChatController({hostId:'a',parentThreadId:'parent',draftId:'pending-draft',restored:pendingView,
      port:pendingPort,canDispatch:()=>true,onPrepared:async()=>{}});
    const client={async rpc(method,params,host){state.rpc.push({method,params,host});
      if(method==='thread/queue/list') return {data:[{id:'queued-1',clientUserMessageId:'message-1',input:[{type:'text',text:'queued text',text_elements:[]}]}],nextCursor:null};
      if(method==='model/list')return {data:[],nextCursor:null}; if(method==='config/read')return {config:{}};
      throw Error('unexpected RPC '+method);},
      async host(endpoint,request){if(endpoint==='get-setting')return {value:'enter'};
        if(endpoint==='queued-follow-up-send-lock-acquire'){state.acquires++;if(state.acquires===1)return new Promise(resolve=>{releaseAcquire=()=>resolve({acquired:true});});return {acquired:true};}
        if(endpoint==='queued-follow-up-send-lock-release'){state.releases.push(request);return {};}
        throw Error('unexpected host endpoint '+endpoint);}, subscribe:()=>()=>{},async reply(){}};
    const root=createRoot(document.getElementById('root'));
    function render(){root.render(<><SideChatPanel client={client} controller={controller} open={!state.showPending} history={{...history}}
      onClose={()=>{}} onBeforeClose={async()=>{}} onSubmit={async()=>{throw Error('unexpected submission');}}
      onInterrupt={async scope=>{state.checks.push(scope);
        if(state.generation!=='original'||history.thread.turns[0]?.id!==scope.turnId||history.thread.turns[0]?.status!=='inProgress')
          throw Object.assign(Error('original connection unavailable'),{uncertain:false});
        state.interrupts.push(scope);}}
      onStartQueued={async(id,scope)=>{state.starts.push({id,scope});
        if(state.queueMode==='not-sent')throw Object.assign(Error('sender not dispatched'),{uncertain:false});
        throw Error('unknown sender outcome');}} />
      <SideChatPanel client={client} controller={pendingController} open={state.showPending} history={null}
        onClose={()=>{}} onBeforeClose={async()=>{}} onSubmit={async()=>{}} onInterrupt={async()=>{}} /></>);}
    window.peer={state,history,render,releaseAcquire:()=>releaseAcquire(),unknown:()=>readUnknownQueueStarts('a','child'),
      busy(){history.thread={...history.thread,status:{type:'active'},turns:[{id:'turn-original',status:'inProgress',itemsView:'full',items:[]}]};render();},
      idle(){history.thread={...history.thread,status:{type:'idle'},turns:[]};history.historyComplete=true;render();}};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => { const p=(window as any).peer; p.busy(); p.history.canInterrupt=false; p.history.error='no rollout found'; p.render(); });
    const stop = page.getByRole('button', { name: '停止', exact: true }); await stop.click();
    await page.getByText(/当前连接没有可确认的运行任务/).waitFor();
    assert.equal(await page.evaluate(() => (window as any).peer.state.checks.length), 0);
    await page.evaluate(() => { const p=(window as any).peer; p.history.error=null; p.history.canInterrupt=true; p.state.generation='new'; p.render(); });
    await stop.click(); await page.getByText(/original connection unavailable/).waitFor();
    assert.equal(await page.evaluate(() => (window as any).peer.state.interrupts.length), 0);
    await page.evaluate(() => { (window as any).peer.state.generation='original'; });
    await stop.click(); await page.waitForFunction(() => (window as any).peer.state.interrupts.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.interrupts[0]),
      {hostId:'a',parentThreadId:'parent',operationId:'operation-a',draftId:'side-draft',childThreadId:'child',turnId:'turn-original'});
    assert.equal(await page.evaluate(() => (window as any).peer.state.rpc.filter((x:any)=>x.method==='turn/interrupt').length), 0);
    await page.evaluate(() => (window as any).peer.idle());
    const send = page.getByRole('button', { name: '立即发送待发送消息' }); await send.waitFor();
    await page.waitForFunction(() => !(document.querySelector('[aria-label="立即发送待发送消息"]') as HTMLButtonElement)?.disabled);
    await send.click(); await page.waitForFunction(() => (window as any).peer.state.acquires === 1);
    await page.evaluate(() => { const p=(window as any).peer; p.busy(); p.history.historyComplete=false; p.render(); });
    await page.getByRole('button', { name: '停止', exact: true }).waitFor();
    await page.evaluate(() => (window as any).peer.releaseAcquire());
    await page.waitForFunction(() => (window as any).peer.state.releases.length === 1);
    assert.equal(await page.evaluate(() => (window as any).peer.state.starts.length), 0);
    assert.equal(await page.evaluate(() => (window as any).peer.state.releases[0].sent), false);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.unknown()), []);
    await page.evaluate(() => (window as any).peer.idle());
    await send.click(); await page.waitForFunction(() => (window as any).peer.state.releases.length === 2);
    assert.equal(await page.evaluate(() => (window as any).peer.state.releases[1].sent), false);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.unknown()), []);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.starts[0]),
      {id:'queued-1',scope:{hostId:'a',parentThreadId:'parent',operationId:'operation-a',draftId:'side-draft',childThreadId:'child'}});
    await page.evaluate(() => { (window as any).peer.state.queueMode='unknown'; });
    await send.click(); await page.locator('.standalone-queue [role="status"]').filter({ hasText: '发送结果未知' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).peer.state.releases.length), 2);
    assert.equal((await page.evaluate(() => (window as any).peer.unknown())).length, 1);
    assert.equal(await send.isDisabled(), true);
    await page.evaluate(() => { const p=(window as any).peer; p.state.showPending=true; p.render(); });
    await page.getByText('正在准备侧聊…').waitFor();
    await page.getByRole('button', { name: '重试保存回执' }).click();
    await page.waitForFunction(() => (window as any).peer.state.persistence.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.persistence), ['operation-pending']);
    assert.equal(await page.evaluate(() => (window as any).peer.state.rpc.filter((x:any)=>x.method==='thread/fork').length), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
