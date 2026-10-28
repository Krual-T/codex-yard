import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const chromePath = '/usr/bin/google-chrome';

test('side panel isolates host history, drafts, late reads and close confirmation', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SideChatController } from './src/renderer/side-chat/controller.ts';
    import { SideChatPanel } from './src/renderer/side-chat/SideChatPanel.tsx';
    const state = { calls: [], submissions: [], subscribers: new Set(), closeCount: 0, failRead: true, delayRead: false, delayRestore: false, expired: false };
    let releaseRead, releaseRestore, rejectSend;
    const thread = host => ({ id: 'child-' + host, name: null, cwd: '/synthetic/' + host, turns: [], status: { type: 'idle' } });
    const client = {
      async rpc(method, params = {}, host = 'a') {
        state.calls.push({method, params: structuredClone(params), host});
        if (method === 'thread/read') {
          if (host === 'a' && state.failRead) throw Error('synthetic history failure');
          if (host === 'a' && state.delayRead) await new Promise(resolve => { releaseRead = resolve; });
          return {thread: thread(host)};
        }
        if (method === 'thread/turns/list') return {data:[{id:'history-' + host, status:'completed', itemsView:'full',
          items:[{id:'message-' + host, type:'agentMessage', text:'History ' + host}]}],nextCursor:null};
        if (method === 'thread/queue/list') return {data:[],nextCursor:null};
        if (method === 'model/list') return {data:[{id:'model-' + host, model:'model-' + host, displayName:'Model ' + host,
          isDefault:true, defaultReasoningEffort:'high', supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};
        if (method === 'config/read') return {config:{model:'model-' + host, model_reasoning_effort:'high'}};
        if (method === 'turn/interrupt') return {};
        throw Error('Unexpected synthetic RPC: ' + method);
      },
      async host(endpoint) { if (endpoint === 'get-setting') return {value:'enter'}; throw Error('Unexpected synthetic host: ' + endpoint); },
      subscribe(listener) { state.subscribers.add(listener); return () => state.subscribers.delete(listener); },
      async reply() { throw Error('unexpected reply'); },
    };
    function parent(host) { return {hostId:host,threadId:'parent-' + host,cwd:'/synthetic/' + host,archived:false,
      workspaceRoots:['/synthetic/' + host],projectId:'project-' + host,options:{model:'model-' + host,effort:'high',mode:'plan'},
      developerInstructions:{text:'Base ' + host,source:'synthetic parent'},forkConfig:{},
      capabilities:{ephemeralFork:true,boundaryInjection:true,preventGoalContinuation:true,discard:'unsubscribe'}}; }
    const operations = { async execute(operation) { state.calls.push({operation:structuredClone(operation)});
      return {outcome:'success',result:operation.kind === 'fork' ? {thread:thread(operation.hostId)} : operation.kind === 'discard' ? {status:'unsubscribed'} : {}}; },
      async prepareClose(scope) {state.calls.push({prepareClose:structuredClone(scope)});},
      async cleanup(scope) {state.calls.push({cleanup:structuredClone(scope)});},
      async interrupt(scope) {state.calls.push({interrupt:structuredClone(scope)});} };
    const controllers = {a:new SideChatController(parent('a'),'draft-side-a',operations), b:new SideChatController(parent('b'),'draft-side-b',operations)};
    let activeClient = client;
    const root = createRoot(document.getElementById('root'));
    const submit = (description,draft,options,action,controller) => {
      state.submissions.push({description:structuredClone(description),draft:structuredClone(draft),options:structuredClone(options),
        action:structuredClone(action),controllerOwner:controller.snapshot().owner});
      return new Promise((_resolve,reject)=>{rejectSend=reject;});
    };
    window.peer = {state,controllers,client,render(host) { root.render(React.createElement(SideChatPanel,{
      client:activeClient,controller:controllers[host],open:true,onClose(){state.closeCount++;},onSubmit:submit,
      async onRestoreSubscription(scope) {state.calls.push({restore:structuredClone(scope)});
        if (state.delayRestore) await new Promise(resolve => {releaseRestore = resolve;});
        return state.expired ? {status:'expired'} : {status:'restored'};},
      onReplaceExpired(scope) {state.calls.push({replace:structuredClone(scope)});} })); },
      replaceClient(host) {activeClient = {...client}; this.render(host);},
      hide() {root.render(null);},emit(event) { for(const listener of state.subscribers) listener(event); },
      rejectSend() {rejectSend(Error('synthetic unknown send'));},releaseRead() {releaseRead?.();},releaseRestore() {releaseRestore?.();} };
    window.peer.render('a');
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root" style="height:100vh"></main>' }) : route.abort());
    await page.goto('http://localhost/');
    await page.addStyleTag({ content: [
      ':root{--yard-bg:#17211d;--yard-fg:#f1f5ef;--yard-surface:#2c3b32;--yard-border:#65776b;--yard-muted:#c1d0c4;--yard-accent:#87c8a1;--yard-ui-font:Arial;--yard-content-font:Georgia;--yard-font-size:15px}body{margin:0}',
      ...['src/renderer/side-chat/side-chat.css', 'src/renderer/composer/standalone-composer.css', 'src/renderer/messages/standalone-messages.css']
        .map(path => readFileSync(path, 'utf8')),
    ].join('\n') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    assert.equal(await page.evaluate(() => (window as any).peer.state.calls.length), 0);
    await page.getByRole('button', { name: '打开侧聊' }).click();
    await page.getByText('synthetic history failure').waitFor();
    assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).count(), 0);
    assert.equal(await page.getByText('No messages yet').count(), 0);
    await page.evaluate(() => { (window as any).peer.state.failRead = false; });
    await page.getByRole('button', { name: '重试加载' }).click();
    await page.getByText('History a').waitFor();
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.fill('initial side draft');
    await editor.press('Enter');
    await page.waitForFunction(() => (window as any).peer.state.submissions.length === 1);
    const sent = await page.evaluate(() => (window as any).peer.state.submissions[0]);
    assert.deepEqual(sent.description.owner, { hostId: 'a', threadId: 'child-a', draftId: 'draft-side-a' });
    assert.deepEqual(sent.controllerOwner, sent.description.owner);
    assert.equal(sent.options.model, 'model-a'); assert.equal(sent.options.mode, 'plan');
    assert.ok(sent.description.revision); assert.equal(sent.action.type, 'send');
    await editor.fill('newer side draft');
    await page.evaluate(() => (window as any).peer.rejectSend());
    await page.getByText(/发送未确认/).waitFor();
    assert.equal(await editor.inputValue(), 'newer side draft');
    await page.evaluate(async () => { await (window as any).peer.controllers.b.start(); (window as any).peer.render('b'); });
    await page.getByText('History b').waitFor();
    assert.equal(await editor.inputValue(), '');
    await page.evaluate(() => (window as any).peer.emit({type:'codex-app-server-connection-changed',hostId:'a',state:'disconnected'}));
    assert.equal(await editor.count(), 1);
    await page.evaluate(() => { const peer = (window as any).peer; peer.state.delayRestore = true;
      peer.emit({type:'codex-app-server-connection-changed',hostId:'b',state:'disconnected'}); });
    await page.getByText(/侧聊连接已中断/).waitFor();
    assert.equal(await editor.count(), 0);
    await page.getByRole('button', { name: '重试加载' }).click();
    await page.waitForFunction(() => (window as any).peer.state.calls.some((call: any) => call.restore));
    await page.evaluate(() => { const peer = (window as any).peer;
      peer.emit({type:'connection-state',state:'disconnected'}); peer.releaseRestore(); });
    await page.getByText(/侧聊连接已中断/).waitFor();
    assert.equal(await editor.count(), 0);
    await page.evaluate(() => { (window as any).peer.state.delayRestore = false; });
    await page.getByRole('button', { name: '重试加载' }).click();
    await page.getByText('History b').waitFor();
    const restores = await page.evaluate(() => (window as any).peer.state.calls.filter((call: any) => call.restore));
    assert.equal(restores.length, 2);
    assert.deepEqual(restores[1].restore, {hostId:'b',parentThreadId:'parent-b',childThreadId:'child-b'});
    await editor.fill('draft b');
    await page.evaluate(() => {
      const peer = (window as any).peer;
      peer.emit({type:'mcp-notification',hostId:'a',method:'turn/started',params:{threadId:'child-b',turn:{id:'foreign',status:'inProgress',items:[]}}});
      peer.emit({type:'mcp-notification',hostId:'b',method:'turn/started',params:{threadId:'child-a',turn:{id:'foreign',status:'inProgress',items:[]}}});
      peer.emit({type:'mcp-notification',hostId:'b',method:'item/completed',params:{threadId:'child-b',turnId:'live',item:{id:'ok',type:'agentMessage',text:'Only child b'}}});
    });
    await page.getByText('Only child b').waitFor();
    assert.equal(await page.getByText('History a').count(), 0);
    await page.evaluate(() => { (window as any).peer.state.delayRead = true; (window as any).peer.render('a'); });
    await page.getByText(/侧聊订阅已失效/).waitFor();
    await page.getByRole('button', { name: '重试加载' }).click();
    await page.getByText('正在加载会话历史…').waitFor();
    await page.evaluate(() => (window as any).peer.render('b'));
    await page.getByText('History b').waitFor();
    await page.evaluate(() => (window as any).peer.releaseRead());
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('History a').count(), 0);
    assert.equal(await editor.inputValue(), 'draft b');
    await page.evaluate(() => { (window as any).peer.state.delayRead = false; (window as any).peer.render('a'); });
    await page.getByText('History a').waitFor();
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === 'newer side draft');
    assert.equal(await editor.inputValue(), 'newer side draft');
    await page.evaluate(() => { const peer = (window as any).peer; peer.hide(); });
    await page.waitForFunction(() => !document.querySelector('.yard-side-chat'));
    await page.evaluate(() => { const peer = (window as any).peer; peer.emit({type:'connection-state',state:'disconnected'}); peer.render('a'); });
    await page.getByText(/侧聊订阅已失效/).waitFor();
    assert.equal(await editor.count(), 0);
    await page.getByRole('button', { name: '重试加载' }).click();
    await page.getByText('History a').waitFor();
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === 'newer side draft');
    const beforeClientChange = await page.evaluate(() => (window as any).peer.state.calls.filter((call: any) => call.restore).length);
    await page.evaluate(() => (window as any).peer.replaceClient('a'));
    await page.getByText(/侧聊订阅已失效/).waitFor();
    assert.equal(await page.evaluate(() => (window as any).peer.state.calls.filter((call: any) => call.restore).length), beforeClientChange);
    await page.getByRole('button', { name: '重试加载' }).click();
    await page.getByText('History a').waitFor();
    const styling = await page.locator('.yard-side-chat').evaluate(element => ({ background: getComputedStyle(element).backgroundColor,
      font: getComputedStyle(element).fontFamily, fontSize: getComputedStyle(element).fontSize, scroll: element.scrollWidth, width: element.clientWidth }));
    assert.equal(styling.background, 'rgb(23, 33, 29)'); assert.match(styling.font, /Arial/); assert.equal(styling.fontSize, '15px');
    assert.ok(styling.scroll <= styling.width, JSON.stringify(styling));
    if (process.env.SIDE_CHAT_SCREENSHOTS) await page.screenshot({ path: join(process.env.SIDE_CHAT_SCREENSHOTS, 'side-chat-mobile.png') });
    await page.setViewportSize({ width: 1100, height: 760 });
    if (process.env.SIDE_CHAT_SCREENSHOTS) await page.screenshot({ path: join(process.env.SIDE_CHAT_SCREENSHOTS, 'side-chat-desktop.png') });
    await page.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: '关闭侧聊？' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    await page.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    await dialog.getByRole('button', { name: '关闭侧聊', exact: true }).click();
    await page.waitForFunction(() => (window as any).peer.state.closeCount === 1);
    const discards = await page.evaluate(() => (window as any).peer.state.calls.filter((call: any) => call.operation?.kind === 'discard'));
    assert.equal(discards.length, 1); assert.equal(discards[0].operation.hostId, 'a');
    assert.deepEqual(discards[0].operation.params, { threadId: 'child-a' });
    await page.evaluate(() => { const peer = (window as any).peer; peer.state.expired = true;
      peer.emit({type:'codex-app-server-connection-changed',hostId:'b',state:'disconnected'}); peer.render('b'); });
    await page.getByText(/侧聊订阅已失效/).waitFor();
    await page.getByRole('button', { name: '重试加载' }).click();
    await page.getByText(/临时侧聊已过期/).waitFor();
    assert.equal(await editor.count(), 0);
    await page.getByRole('button', { name: '开始新侧聊' }).click();
    const replacement = await page.evaluate(() => (window as any).peer.state.calls.filter((call: any) => call.replace));
    assert.deepEqual(replacement, [{replace:{hostId:'b',parentThreadId:'parent-b',childThreadId:'child-b',draftId:'draft-side-b'}}]);
    assert.equal(await page.getByRole('button', { name: '开始新侧聊' }).isDisabled(), true);
    assert.deepEqual(failures, []);
  } finally { await context.close(); await browser.close(); }
});
