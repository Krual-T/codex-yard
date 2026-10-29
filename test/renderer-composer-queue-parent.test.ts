import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

test('queue edit is bound to the real composer owner and original dispatch authority', {
  skip: !existsSync(process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer, draftToInput} from './src/renderer/composer/StandaloneComposer.tsx';
    import {readUnknownQueueRecovery} from './src/renderer/composer/standalone-queue-storage.ts';
    import {readComposerDraftVersions} from './src/renderer/composer/composer-draft-store.ts';
    const original={id:'queue-a',clientUserMessageId:'client-a',input:[
      {type:'text',text:'first',text_elements:[]},
      {type:'image',url:'data:image/png;base64,AA=='},
      {type:'skill',name:'skill',path:'/fixture/skill'},
      {type:'mention',name:'file',path:'/fixture/file'},
      {type:'text',text:'world',text_elements:[{byteRange:{start:0,end:5},placeholder:'world'}]}
    ]};
    const state={queue:JSON.parse(sessionStorage.getItem('parent-queue')||'null')||structuredClone([original]),
      calls:[],submissions:[],listeners:new Set(),controller:null,controllers:new WeakSet(),authorities:new WeakMap(),
      captures:[],accepts:[],generation:0,mode:'success',release:null,rejectNext:false,lease:null,leaseStatus:null};
    const saveQueue=()=>sessionStorage.setItem('parent-queue',JSON.stringify(state.queue));
    const notify=()=>{for(const fn of state.listeners)fn({type:'mcp-notification',hostId:'local',method:'thread/queue/changed',params:{threadId:'thread-a'}})};
    const client={
      async rpc(method,params={},host='local'){
        state.calls.push({method,params:structuredClone(params),host});
        if(method==='model/list')return {data:[{id:'fixture',model:'fixture',displayName:'Fixture',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};
        if(method==='config/read')return {config:{model:'fixture',model_reasoning_effort:'high',approval_policy:'on-request',sandbox_mode:'workspace-write',service_tier:null}};
        if(method==='thread/queue/list')return {data:structuredClone(state.queue),nextCursor:null};
        if(method==='thread/items/list')return {data:[],nextCursor:null};
        if(method==='thread/queue/delete'){
          const i=state.queue.findIndex(item=>item.id===params.queuedSubmissionId);
          if(i<0)return {deleted:false}; state.queue.splice(i,1);saveQueue();notify();return {deleted:true};
        }
        if(method==='thread/queue/add'){
          state.queue.push({id:'requeued',clientUserMessageId:params.clientUserMessageId,input:structuredClone(params.input)});
          saveQueue();notify();return {queuedSubmission:state.queue.at(-1)};
        }
        throw Error('unexpected RPC '+method);
      },
      async host(endpoint,params={},options={}){
        if(endpoint==='get-setting')return {value:params.key==='followUpQueueMode'?'queue':undefined};
        if(endpoint==='codex-home')return {codexHome:'/fixture/codex'};
        if(endpoint!=='queue-edit')throw Error('unexpected host '+endpoint);
        if(state.mode==='hold')await new Promise(resolve=>state.release=resolve);
        options.assertBeforeSend();
        state.calls.push({endpoint,params:structuredClone(params)});
        if(state.mode==='changed')state.queue[0].input[0].text='changed by another Yard write';
        const page=await client.rpc('thread/queue/list',{threadId:params.threadId},params.hostId);
        const item=page.data.find(item=>item.id===params.entry.id);
        if(!item||JSON.stringify(item)!==JSON.stringify(params.entry))return 'changed';
        const result=await client.rpc('thread/queue/delete',{threadId:params.threadId,queuedSubmissionId:params.entry.id},params.hostId);
        if(!result.deleted)return 'changed';
        if(state.mode==='unknown')throw Error('fixture lost delete receipt');
        if(state.mode==='hold-after')await new Promise(resolve=>state.release=resolve);
        return 'deleted';
      },
      subscribe(fn){state.listeners.add(fn);return ()=>state.listeners.delete(fn)},
      async reply(){throw Error('unexpected approval')}
    };
    let props={client,context:{hostId:'local',threadId:'thread-a',draftId:'draft-a',cwd:'/fixture'},busy:true,activeTurnId:'turn',
      onDraftController(controller){
        state.controller=controller;
        if(controller&&!state.controllers.has(controller)){
          state.controllers.add(controller);
          const accept=controller.acceptCommittedVersion.bind(controller);
          controller.acceptCommittedVersion=async(before,after)=>{
            state.accepts.push(structuredClone({before,after}));
            if(state.rejectNext){state.rejectNext=false;return false}
            return accept(before,after);
          };
        }
      },
      captureSubmissionAuthority(owner){
        const generation=state.generation, captured=structuredClone(owner);
        const authority=()=>{if(generation!==state.generation||!state.controller||JSON.stringify(state.controller.snapshot()?.owner)!==JSON.stringify(captured))throw Error('original owner or connection changed')};
        authority();state.captures.push(captured);state.authorities.set(authority,{owner:captured,generation,daemon:'fixture-daemon-token'});return authority;
      },
      async removeQueuedOriginal(entry,authority,assertBeforeSend){
        const grant=state.authorities.get(authority);
        if(!grant)throw Error('original authority identity was lost');
        return client.host('queue-edit',{hostId:grant.owner.hostId,threadId:grant.owner.threadId,entry,
          daemonConnectionGeneration:grant.daemon},{assertBeforeSend});
      },
      async onSubmit(draft,options,action,description,authority){
        authority();state.submissions.push({draft:structuredClone(draft),action:structuredClone(action),description:structuredClone(description)});
        if(action.type==='queue')await client.rpc('thread/queue/add',{threadId:description.owner.threadId,input:draftToInput(draft,description.owner.hostId),clientUserMessageId:'requeued-client'},description.owner.hostId);
      },
      async onInterrupt(){}
    };
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,original,draftToInput,readUnknownQueueRecovery,readComposerDraftVersions,
      render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props))},
      async seed(){const owner=state.controller.snapshot().owner;return state.controller.update(owner,draft=>({...draft,text:'existing main draft',
        references:[{id:'reference',text:'preserve',context:{source:'fixture'}}],pendingDrafts:[{text:'older draft',images:[],files:[]}]}))},
      freeze(){const owner=state.controller.snapshot().owner;state.lease=state.controller.freeze(owner);
        if(!state.lease){state.leaseStatus='refused';return}state.leaseStatus='waiting';state.lease.flush().then(value=>state.leaseStatus=value?'ready':'failed')}
    };
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--process-per-tab', '--disable-background-networking'] });
  const errors: string[] = [];
  const open = async () => {
    const context = await browser.newContext(), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.setDefaultTimeout(8_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByText('first world', { exact: true }).waitFor();
    await page.waitForFunction(() => !!(window as any).fixture.state.controller?.snapshot()
      && !(document.querySelector('button[aria-label="编辑待发送消息"]') as HTMLButtonElement)?.disabled);
    return { context, page };
  };
  const edit = (page: Page) => page.getByRole('button', { name: '编辑待发送消息' });
  const close = async (context: BrowserContext) => context.close();
  try {
    await t.test('the selected input reaches the actual composer and is queued only by a user action', async () => {
      const { context, page } = await open();
      try {
        assert.equal(await page.evaluate(() => (window as any).fixture.seed()), true);
        const synchronous = await page.evaluate(() => {
          (document.querySelector('button[aria-label="编辑待发送消息"]') as HTMLButtonElement).click();
          const state = (window as any).fixture.state;
          return { captures: state.captures, frozen: !!document.querySelector('.standalone-composer > div[inert]') };
        });
        assert.deepEqual(synchronous.captures, [{ hostId: 'local', threadId: 'thread-a', draftId: 'draft-a' }]);
        assert.equal(synchronous.frozen, true);
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'first\nworld');
        const transferred = await page.evaluate(() => { const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
          return { input:f.draftToInput(snapshot.draft,'local'), original:f.original, draft:snapshot.draft,
            calls:f.state.calls, submissions:f.state.submissions, queue:f.state.queue }; });
        assert.deepEqual(transferred.input, transferred.original.input);
        assert.deepEqual(transferred.queue, []);
        assert.equal(transferred.draft.pendingDrafts[0].text, 'older draft');
        assert.equal(transferred.draft.pendingDrafts[1].text, 'existing main draft');
        assert.equal(transferred.draft.pendingDrafts[1].references[0].context.source, 'fixture');
        assert.deepEqual(transferred.submissions, []);
        const request = transferred.calls.find((call: any) => call.endpoint === 'queue-edit');
        assert.deepEqual(request.params, { hostId: 'local', threadId: 'thread-a', entry: transferred.original,
          daemonConnectionGeneration: 'fixture-daemon-token' });
        assert.equal(transferred.calls.filter((call: any) => call.method === 'thread/queue/delete').length, 1);
        const firstText = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作) 1$/ });
        const secondText = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作) 2$/ });
        assert.equal(await firstText.inputValue(), 'first');
        assert.equal(await secondText.inputValue(), 'world');
        await firstText.fill('first edited');
        await page.getByRole('button', { name: '排队', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const queued = await page.evaluate(() => { const f = (window as any).fixture;
          return { action:f.state.submissions[0].action, queue:f.state.queue, original:f.original }; });
        assert.deepEqual(queued.action, { type: 'queue' });
        assert.deepEqual(queued.queue[0].input, [{ ...queued.original.input[0], text:'first edited' }, ...queued.original.input.slice(1)]);
      } finally { await close(context); }
    });
    await t.test('navigation lease waits for the registered owner operation', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'hold'; });
        await edit(page).click();
        await page.waitForFunction(() => typeof (window as any).fixture.state.release === 'function');
        await page.evaluate(() => (window as any).fixture.freeze());
        assert.equal(await page.evaluate(() => (window as any).fixture.state.leaseStatus), 'waiting');
        await page.evaluate(() => (window as any).fixture.state.release());
        await page.waitForFunction(() => (window as any).fixture.state.leaseStatus === 'ready');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), 'first\nworld');
        await page.evaluate(() => (window as any).fixture.state.lease.release());
      } finally { await close(context); }
    });
    await t.test('changed authority before dispatch retains the original entry without deleting it', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'hold'; });
        await edit(page).click();
        await page.waitForFunction(() => typeof (window as any).fixture.state.release === 'function');
        await page.evaluate(() => { const state = (window as any).fixture.state; state.generation++; state.release(); });
        await page.getByText('队列消息未确认删除，原内容已保留。').waitFor();
        const data = await page.evaluate(async () => { const f = (window as any).fixture;
          return { queue:f.state.queue, recovery:await f.readUnknownQueueRecovery('local','thread-a'), calls:f.state.calls, original:f.original }; });
        assert.deepEqual(data.queue, [data.original]);
        assert.equal(data.recovery.edits[0].stage, 'not-sent');
        assert.equal(data.calls.filter((call: any) => call.method === 'thread/queue/delete').length, 0);
      } finally { await close(context); }
    });
    await t.test('the Yard read detects an entry changed before its delete', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'changed'; });
        await edit(page).click();
        await page.getByText('队列消息未确认删除，原内容已保留。').waitFor();
        const data = await page.evaluate(async () => { const f = (window as any).fixture;
          return { queue:f.state.queue, recovery:await f.readUnknownQueueRecovery('local','thread-a'), calls:f.state.calls, original:f.original }; });
        assert.equal(data.queue[0].input[0].text, 'changed by another Yard write');
        assert.deepEqual(data.recovery.edits[0].entry, data.original);
        assert.equal(data.recovery.edits[0].stage, 'conflict');
        assert.equal(data.calls.filter((call: any) => call.method === 'thread/queue/delete').length, 0);
      } finally { await close(context); }
    });
    await t.test('an unknown receipt survives reload and is never replayed', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'unknown'; });
        await edit(page).click();
        await page.getByText('队列删除结果未知，不会自动重试。').waitFor();
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.getByText('队列删除结果未知，不会自动重试。').waitFor();
        const data = await page.evaluate(async () => { const f = (window as any).fixture;
          return { queue:f.state.queue, recovery:await f.readUnknownQueueRecovery('local','thread-a'), calls:f.state.calls, original:f.original }; });
        assert.deepEqual(data.queue, []);
        assert.deepEqual(data.recovery.edits[0].entry, data.original);
        assert.equal(data.recovery.edits[0].stage, 'deleting');
        assert.equal(data.calls.filter((call: any) => call.method === 'thread/queue/delete' || call.endpoint === 'queue-edit').length, 0);
      } finally { await close(context); }
    });
    await t.test('a confirmed late delete stays with its original owner', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'hold-after'; });
        await edit(page).click();
        await page.waitForFunction(() => typeof (window as any).fixture.state.release === 'function');
        await page.evaluate(() => (window as any).fixture.render({ context: { draftId:'draft-b' } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'draft-b');
        await page.evaluate(() => (window as any).fixture.state.release());
        await page.getByText('队列删除已确认，原消息可恢复到输入区。').waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), '');
        await page.getByRole('button', { name: '恢复到输入区' }).click();
        await page.getByRole('alert').filter({ hasText: '恢复记录属于其他输入区' }).waitFor();
        await page.evaluate(() => (window as any).fixture.render({ context: { draftId:'draft-a' } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'draft-a');
        await page.getByRole('button', { name: '恢复到输入区' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'first\nworld');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'thread/queue/delete').length), 1);
      } finally { await close(context); }
    });
    await t.test('an unwired parent leaves edit disabled without deleting', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => (window as any).fixture.render({ removeQueuedOriginal:undefined }));
        await page.waitForFunction(() => (document.querySelector('button[aria-label="编辑待发送消息"]') as HTMLButtonElement)?.disabled);
        assert.equal(await edit(page).isDisabled(), true);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'thread/queue/delete').length), 0);
      } finally { await close(context); }
    });
    await t.test('a refused persisted version retries the original before and after through the controller', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.rejectNext = true; });
        await edit(page).click();
        await page.getByText('队列消息已保存为草稿，等待输入区接收。').waitFor();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'first\nworld');
        const saved = await page.evaluate(async () => { const f = (window as any).fixture;
          return { recovery:await f.readUnknownQueueRecovery('local','thread-a'), snapshot:f.state.controller.snapshot() }; });
        assert.equal(saved.recovery.edits[0].before.draft.text, '');
        assert.equal(saved.recovery.edits[0].after.draft.text, 'first\nworld');
        assert.equal(saved.snapshot.draft.text, 'first\nworld');
        await page.getByRole('button', { name: '接收已保存草稿' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'first\nworld');
        const data = await page.evaluate(() => { const state = (window as any).fixture.state;
          return { accepts:state.accepts, calls:state.calls }; });
        assert.deepEqual(data.accepts[0], data.accepts[1]);
        assert.equal(data.calls.filter((call: any) => call.method === 'thread/queue/delete').length, 1);
      } finally { await close(context); }
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
