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

test('a close barrier observes a concurrently closed operation once and preserves draft on failure', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SideChatController} from './src/renderer/side-chat/controller.ts';
    import {SideChatPanel} from './src/renderer/side-chat/SideChatPanel.tsx';
    const state={closes:[],retries:[],barriers:[],gates:{}};
    const hosts=['success','failure'];
    const views=Object.fromEntries(hosts.map(host=>{
      const thread={id:'child-'+host,name:null,cwd:'/synthetic',turns:[],status:{type:'idle'}};
      return [host,{operationId:'op-'+host,parent:{hostId:host,threadId:'parent-'+host,cwd:'/synthetic'},childId:thread.id,
        child:{thread,options:{}},fork:{status:'received',error:null},inject:{status:'received',error:null},
        close:{requested:false,status:'idle',error:null},recoveryError:null}];
    }));
    const controllers=Object.fromEntries(hosts.map(host=>{
      const port={read:async()=>structuredClone(views[host]),prepare:async()=>structuredClone(views[host]),
        start:async()=>structuredClone(views[host]),retry:async()=>{state.retries.push(host);return structuredClone(views[host]);},
        close:async()=>{state.retries.push('close-'+host);return structuredClone(views[host]);},
        retryPersistence:async()=>{state.retries.push('persistence-'+host);return structuredClone(views[host]);},subscribe:()=>()=>{}};
      return [host,new SideChatController({hostId:host,parentThreadId:'parent-'+host,draftId:'draft-'+host,port,
        restored:views[host],canDispatch:()=>true,onPrepared:async()=>{}})];
    }));
    const client={async rpc(method){if(method==='thread/queue/list'||method==='model/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('unexpected rpc '+method);},
      async host(endpoint){if(endpoint==='get-setting')return {value:'enter'};throw Error('unexpected host '+endpoint);},
      subscribe:()=>()=>{},async reply(){}};
    let selected='success';const root=createRoot(document.getElementById('root'));
    function render(){root.render(<>{hosts.map(host=><SideChatPanel key={host} client={client} controller={controllers[host]}
      open={selected===host} history={{hostId:host,threadId:'child-'+host,thread:views[host].child.thread,options:{},
        loading:false,historyComplete:true,streamGap:false,error:null,canSubmit:true,canInterrupt:true,retry(){}}}
      onClose={()=>state.closes.push(host)} onBeforeClose={async scope=>{
        state.barriers.push({host,operationId:scope.operationId,draftId:scope.draftId});
        await new Promise((resolve,reject)=>{state.gates[host]={resolve,reject};});}}
      onSubmit={async()=>{throw Error('unexpected submission');}} onInterrupt={async()=>{}} />)}</>);}
    window.peer={state,controllers,views,render,select(host){selected=host;render();},
      async prepareClose(host){views[host].close={requested:true,status:'prepare-failed',error:'synthetic prepare failure'};await controllers[host].read();},
      async markClosed(host){views[host].close={requested:true,status:'closed',error:null};await controllers[host].read();},
      release(host){state.gates[host].resolve();},reject(host){state.gates[host].reject(Error('synthetic close gate failure'));}};
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
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.fill('success retained draft');
    await page.evaluate(() => (window as any).peer.prepareClose('success'));
    await page.getByRole('button', { name: '继续操作' }).click();
    await page.waitForFunction(() => !!(window as any).peer.state.gates.success);
    await page.evaluate(() => (window as any).peer.markClosed('success'));
    await page.getByText(/宿主已关闭此侧聊/).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.closes), []);
    await page.evaluate(() => (window as any).peer.release('success'));
    await page.waitForFunction(() => (window as any).peer.state.closes.length === 1);
    await page.evaluate(async () => { const p=(window as any).peer; await p.controllers.success.read();p.render(); });
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.closes), ['success']);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.retries), []);
    assert.equal(await page.locator('.yard-side-chat:visible .yard-side-chat__draft textarea').first().inputValue(), 'success retained draft');

    await page.evaluate(() => (window as any).peer.select('failure'));
    await editor.fill('failure retained draft');
    await page.evaluate(() => (window as any).peer.prepareClose('failure'));
    await page.getByRole('button', { name: '继续操作' }).click();
    await page.waitForFunction(() => !!(window as any).peer.state.gates.failure);
    await page.evaluate(() => (window as any).peer.markClosed('failure'));
    await page.getByText(/宿主已关闭此侧聊/).waitFor();
    await page.evaluate(() => (window as any).peer.reject('failure'));
    await page.getByText(/synthetic close gate failure/).waitFor();
    const retained = page.locator('.yard-side-chat:visible .yard-side-chat__draft textarea').first();
    assert.equal(await retained.inputValue(), 'failure retained draft');
    await retained.focus(); await retained.evaluate((node: HTMLTextAreaElement) => node.select());
    assert.ok(await retained.evaluate((node: HTMLTextAreaElement) => node.selectionEnd > node.selectionStart));
    assert.equal(await page.getByRole('button', { name: '关闭侧聊', exact: true }).isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.closes), ['success']);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.retries), []);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.barriers), [
      {host:'success',operationId:'op-success',draftId:'draft-success'},
      {host:'failure',operationId:'op-failure',draftId:'draft-failure'},
    ]);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
