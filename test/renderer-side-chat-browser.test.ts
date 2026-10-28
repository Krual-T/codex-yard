import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('side panel keeps the real composer across hidden, host changes, failure and close', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {SideChatController} from './src/renderer/side-chat/controller.ts';
    import {SideChatPanel} from './src/renderer/side-chat/SideChatPanel.tsx';
    const state = {calls:[], submissions:[], closes:[], failGate:false, failIDB:false, failClose:true, subscribers:new Set()};
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      if (state.failIDB) throw Error('synthetic IDB transaction failure');
      return originalTransaction.apply(this,args);
    };
    const thread = host => ({id:'child-' + host,name:null,cwd:'/synthetic/' + host,turns:[{id:'turn-' + host,status:'completed',itemsView:'full',
      items:[{id:'message-' + host,type:'agentMessage',text:'History ' + host}]}],status:{type:'idle'}});
    const views = {};
    const calls = (name,id) => state.calls.push({name,id});
    const port = {
      async prepare(hostId,parentThreadId) {
        calls('prepare',hostId); return views[hostId] = {operationId:'op-' + hostId,parent:{hostId,threadId:parentThreadId,cwd:'/synthetic/' + hostId,
          workspaceRoots:['/synthetic/' + hostId],project:{id:'project-' + hostId},archived:false,
          options:{model:'model-' + hostId,effort:null,mode:'plan'}},childId:null,child:null,
          fork:{status:'waiting',error:null},inject:{status:'waiting',error:null},close:{requested:false,status:'idle',error:null},instructionSource:'host-config'};
      },
      async start(id) { calls('start',id); const host=id.slice(3), v=views[host];
        v.childId='child-' + host; v.child={thread:thread(host),options:{...v.parent.options}};
        v.fork.status='received'; v.inject.status='received'; return structuredClone(v); },
      async read(id) {calls('read',id); return structuredClone(views[id.slice(3)]);},
      async retry(id) {calls('retry',id); const v=views[id.slice(3)]; v.close.status='closed'; v.close.error=null; return structuredClone(v);},
      async close(id) {calls('close',id); const v=views[id.slice(3)]; v.close.requested=true;
        v.close.status=state.failClose?'prepare-failed':'closed'; v.close.error=state.failClose?'synthetic close failure':null; return structuredClone(v);},
      async retryPersistence(id) {calls('retryPersistence',id); return structuredClone(views[id.slice(3)]);},
      subscribe(listener) {state.subscribers.add(listener);return()=>state.subscribers.delete(listener);},
    };
    const client = {
      async rpc(method,params={},host='a') {
        if(method==='thread/queue/list') return {data:[],nextCursor:null};
        if(method==='model/list') return {data:[{id:'model-'+host,model:'model-'+host,displayName:'Model '+host,isDefault:true,
          defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};
        if(method==='config/read') return {config:{model:'model-'+host,model_reasoning_effort:null}};
        if(method==='turn/interrupt') return {};
        throw Error('unexpected synthetic RPC '+method);
      },
      async host(endpoint) {if(endpoint==='get-setting') return {value:'enter'};throw Error('unexpected synthetic host '+endpoint);},
      subscribe() {return ()=>{};},async reply() {throw Error('unexpected reply');}
    };
    const controllers = Object.fromEntries(['a','b','c'].map(host=>[host,new SideChatController({hostId:host,parentThreadId:'parent-'+host,
      draftId:'draft-side-'+host,port,canDispatch:()=>true,async onPrepared(scope){state.calls.push({name:'link',scope});}})]));
    const histories = Object.fromEntries(['a','b','c'].map(host=>[host,{hostId:host,threadId:'child-'+host,thread:thread(host),loading:false,
      options:{model:'model-'+host,effort:null,mode:'plan'},historyComplete:true,streamGap:false,error:null,expired:false,canSubmit:true,retry(){state.calls.push({name:'retryHistory',host});}}]));
    let selected='a', visible=true, replaceCalls=[];
    let rejectSend;
    const root=createRoot(document.getElementById('root'));
    function render() {root.render(<>{['a','b','c'].map(host=><SideChatPanel key={host} client={client} controller={controllers[host]}
      open={visible && selected===host} history={histories[host]} onClose={()=>state.closes.push(host)}
      onBeforeClose={async scope=>{state.calls.push({name:'barrier',scope:{...scope,draftController:!!scope.draftController}});
        if(state.failGate) throw Error('synthetic unresolved send');}}
      onSubmit={(description,draft,options,action,controller)=>{state.submissions.push({description,draft,options,action,owner:controller.snapshot().owner});
        return new Promise((_resolve,reject)=>{rejectSend=reject;});}}
      onReplaceExpired={scope=>{replaceCalls.push({...scope,draftController:!!scope.draftController});}} />)}</>);}
    window.peer={state,controllers,histories,views,render,select(host){selected=host;visible=true;render();},
      hide(){visible=false;render();},show(){visible=true;render();},rejectSend(){rejectSend(Error('unknown send'));},
      replaceCalls,markNode(host){window.savedNode=document.querySelectorAll('.yard-side-chat')[['a','b','c'].indexOf(host)].querySelector('textarea');},
      sameNode(host){return window.savedNode===document.querySelectorAll('.yard-side-chat')[['a','b','c'].indexOf(host)].querySelector('textarea');}};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root" style="height:100vh"></main>' }) : route.abort());
    await page.goto('http://localhost/');
    await page.addStyleTag({ content: [
      ':root{--yard-bg:#17211d;--yard-fg:#f1f5ef;--yard-surface:#2c3b32;--yard-border:#65776b;--yard-muted:#c1d0c4;--yard-accent:#87c8a1;--yard-ui-font:Arial;--yard-content-font:Georgia;--yard-font-size:15px}body{margin:0}',
      ...['src/renderer/side-chat/side-chat.css', 'src/renderer/composer/standalone-composer.css', 'src/renderer/messages/standalone-messages.css']
        .map(path => readFileSync(path, 'utf8')),
    ].join('\n') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.calls), []);
    await page.getByRole('button', { name: '打开侧聊' }).click(); await page.getByText('History a').waitFor();
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.fill('initial side draft'); await editor.press('Enter');
    await page.waitForFunction(() => (window as any).peer.state.submissions.length === 1);
    const sent = await page.evaluate(() => (window as any).peer.state.submissions[0]);
    assert.deepEqual(sent.description.owner, { hostId: 'a', threadId: 'child-a', draftId: 'draft-side-a' });
    assert.deepEqual(sent.owner, sent.description.owner); assert.equal(sent.options.mode, 'plan'); assert.ok(sent.description.revision);
    await editor.fill('newer side draft'); await page.evaluate(() => (window as any).peer.rejectSend());
    await page.locator('.yard-side-chat:visible').getByText(/发送未确认/).waitFor();
    await page.evaluate(() => (window as any).peer.markNode('a'));
    await page.evaluate(() => (window as any).peer.hide());
    assert.equal(await page.locator('.yard-side-chat').first().isHidden(), true);
    assert.equal(await page.evaluate(() => (window as any).peer.sameNode('a')), true);
    await page.evaluate(() => (window as any).peer.show());
    assert.equal(await editor.inputValue(), 'newer side draft');
    assert.equal(await page.evaluate(() => (window as any).peer.sameNode('a')), true);
    await page.evaluate(() => { const p=(window as any).peer; p.histories.a.error='no rollout found'; p.histories.a.canSubmit=false; p.render(); });
    await page.getByText('no rollout found').waitFor(); assert.equal(await editor.inputValue(), 'newer side draft');
    assert.equal(await page.getByRole('button', { name: '开始新侧聊' }).count(), 0);
    await page.getByRole('button', { name: '重试加载' }).click();
    assert.equal(await page.evaluate(() => (window as any).peer.state.calls.filter((c:any)=>c.name==='retryHistory').length), 1);
    await page.evaluate(async () => { const p=(window as any).peer; await p.controllers.b.start(); p.select('b'); });
    await page.getByText('History b').waitFor(); await editor.fill('draft b');
    await page.evaluate(() => { const p=(window as any).peer; p.histories.b={...p.histories.a}; p.render(); });
    await page.getByText('正在等待该侧聊的会话投影。').waitFor();
    assert.equal(await page.getByText('History a').isVisible(), false); assert.equal(await editor.inputValue(), 'draft b');
    await page.evaluate(() => { const p=(window as any).peer; p.histories.b={hostId:'b',threadId:'child-b',thread:p.views.b.child.thread,
      options:{model:'model-b',effort:null,mode:'plan'},loading:false,historyComplete:true,streamGap:false,error:null,expired:false,canSubmit:true,retry(){}}; p.render(); });
    await page.getByText('History b').waitFor();
    await page.evaluate(() => { const p=(window as any).peer; p.histories.b.historyComplete=false; p.histories.b.streamGap=true; p.render(); });
    await page.getByText(/部分进行中的内容尚未收到/).waitFor(); await editor.press('Enter');
    await page.locator('.yard-side-chat:visible').getByText(/发送未确认/).waitFor();
    assert.equal(await page.evaluate(() => (window as any).peer.state.submissions.length), 1);
    assert.equal(await editor.inputValue(), 'draft b');
    await page.evaluate(() => { const p=(window as any).peer; p.histories.b.historyComplete=true; p.histories.b.streamGap=false; p.render(); });
    const styling = await page.locator('.yard-side-chat:visible').evaluate(element => ({background:getComputedStyle(element).backgroundColor,
      font:getComputedStyle(element).fontFamily,size:getComputedStyle(element).fontSize,scroll:element.scrollWidth,width:element.clientWidth}));
    assert.equal(styling.background, 'rgb(23, 33, 29)'); assert.match(styling.font, /Arial/); assert.equal(styling.size, '15px');
    assert.ok(styling.scroll <= styling.width, JSON.stringify(styling));
    if (process.env.SIDE_CHAT_SCREENSHOTS) await page.screenshot({ path: join(process.env.SIDE_CHAT_SCREENSHOTS, 'side-chat-host-mobile.png') });
    await page.evaluate(() => { const p=(window as any).peer; p.state.failIDB=true; });
    await editor.fill('unsaved b'); await page.getByText(/草稿未能保存/).first().waitFor();
    await page.evaluate(() => (window as any).peer.markNode('b'));
    await page.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '关闭侧聊', exact: true }).click();
    await page.getByText(/无法关闭侧聊，草稿已保留/).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved b'); assert.equal(await page.evaluate(() => (window as any).peer.sameNode('b')), true);
    assert.equal(await page.evaluate(() => (window as any).peer.state.calls.filter((c:any)=>c.name==='close').length), 0);
    await page.evaluate(() => { const p=(window as any).peer; p.state.failIDB=false; p.select('a'); });
    await page.getByText('no rollout found').waitFor();
    await page.evaluate(() => (window as any).peer.markNode('a'));
    await page.evaluate(() => { const p=(window as any).peer; p.histories.a.error=null; p.histories.a.canSubmit=true; p.state.failGate=true; p.render(); });
    await page.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    let dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: '关闭侧聊？' }).waitFor();
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
    await page.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    await dialog.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    await page.getByText(/synthetic unresolved send/).waitFor();
    assert.equal(await editor.inputValue(), 'newer side draft');
    assert.equal(await page.evaluate(() => (window as any).peer.state.calls.filter((c:any)=>c.name==='close').length), 0);
    await page.evaluate(() => { (window as any).peer.state.failGate=false; });
    await page.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    await page.getByText('synthetic close failure').waitFor();
    assert.equal(await page.evaluate(() => (window as any).peer.sameNode('a')), true);
    assert.equal(await page.locator('.yard-side-chat:visible textarea').inputValue(), 'newer side draft');
    assert.equal(await page.locator('.yard-side-chat:visible .yard-side-chat__composer').evaluate(e => (e as HTMLElement).inert), true);
    await page.getByRole('button', { name: '继续操作' }).click();
    await page.waitForFunction(() => (window as any).peer.state.closes.includes('a'));
    assert.equal(await page.evaluate(() => (window as any).peer.state.calls.filter((c:any)=>c.name==='close').length), 1);
    await page.evaluate(() => { const p=(window as any).peer; p.select('b'); p.histories.b.expired=true; p.histories.b.canSubmit=false; p.render(); });
    await page.getByText(/临时侧聊已过期/).waitFor();
    await page.getByRole('button', { name: '开始新侧聊' }).click();
    await page.getByText(/无法开始新侧聊，原草稿已保留/).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved b');
    assert.equal(await page.evaluate(() => (window as any).peer.replaceCalls.length), 0);
    await page.evaluate(() => { const p=(window as any).peer; p.histories.b.expired=false;
      p.views.b.close={requested:true,status:'prepare-failed',error:'restored close failure'};
      for (const subscriber of p.state.subscribers) subscriber({hostId:'b',operationId:'op-b'}); p.render(); });
    await page.getByRole('button', { name: '继续操作' }).click();
    await page.getByText(/无法继续关闭，草稿已保留/).waitFor();
    assert.equal(await page.locator('.yard-side-chat:visible textarea').inputValue(), 'unsaved b');
    assert.equal(await page.evaluate(() => (window as any).peer.state.calls.filter((c:any)=>c.name==='retry'&&c.id==='op-b').length), 0);
    await page.evaluate(async () => { const p=(window as any).peer; p.select('c'); await p.controllers.c.start(); });
    await page.getByText('History c').waitFor(); await editor.fill('retained c draft');
    await page.evaluate(() => { const p=(window as any).peer; p.histories.c.expired=true; p.histories.c.canSubmit=false; p.render(); });
    await page.getByRole('button', { name: '开始新侧聊' }).click();
    await page.waitForFunction(() => (window as any).peer.replaceCalls.length === 1);
    const replaced = await page.evaluate(() => (window as any).peer.replaceCalls[0]);
    assert.deepEqual(replaced, {hostId:'c',parentThreadId:'parent-c',childThreadId:'child-c',operationId:'op-c',draftId:'draft-side-c',draftController:true});
    assert.equal(await page.getByRole('button', { name: '开始新侧聊' }).isDisabled(), true);
    assert.equal(await page.locator('.yard-side-chat:visible textarea').inputValue(), 'retained c draft');
    await page.setViewportSize({ width: 1100, height: 760 });
    if (process.env.SIDE_CHAT_SCREENSHOTS) await page.screenshot({ path: join(process.env.SIDE_CHAT_SCREENSHOTS, 'side-chat-host-desktop.png') });
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
