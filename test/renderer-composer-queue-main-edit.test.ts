import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('queue edit uses the composer controller and retains exact recovery receipts', {
  skip: !existsSync(process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React, {useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneQueue} from './src/renderer/composer/standalone-queue.tsx';
    import {useComposerDraft} from './src/renderer/composer/use-composer-draft.ts';
    import {draftToInput} from './src/renderer/composer/standalone-draft.ts';
    import {readUnknownQueueRecovery} from './src/renderer/composer/standalone-queue-storage.ts';
    import {readComposerDraftVersions} from './src/renderer/composer/composer-draft-store.ts';
    const original = {id:'q1',clientUserMessageId:'client-1',input:[
      {type:'text',text:'hello',text_elements:[]},
      {type:'image',url:'data:image/png;base64,AA=='},
      {type:'skill',name:'skill',path:'/skills/skill'},
      {type:'mention',name:'file',path:'/fixture/file'},
      {type:'text',text:'world',text_elements:[{byteRange:{start:0,end:5},placeholder:'world'}]}
    ]};
    const state = {queue:JSON.parse(sessionStorage.getItem('fixture-queue') || 'null') || structuredClone([original]),
      calls:[],listeners:new Set(),controller:null,loaded:false,mode:'success',generation:0,editing:false,pending:false,
      pendingLink:false, gate:null, release:null, binding:true, wrongHost:false, frozen:false, owner:'draft-a'};
    function notify(){for(const listener of state.listeners)listener({type:'mcp-notification',hostId:'local',method:'thread/queue/changed',params:{threadId:'thread'}})}
    const client = {
      async rpc(method,params){state.calls.push(method);
        if(method==='thread/queue/list')return {data:structuredClone(state.queue),nextCursor:null};
        if(method==='thread/items/list')return {data:[],nextCursor:null};
        throw Error('unexpected RPC '+method)},
      async host(method){throw Error('unexpected host '+method)},
      subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener)}
    };
    function Session({owner}){
      const [frozen,setFrozen]=useState(false), [,setPulse]=useState(0);
      const guard=useRef(()=>!state.editing), link=useRef(false);
      link.current=state.pendingLink;
      const value=useComposerDraft({hostId:'local',threadId:'thread',draftId:owner,cwd:'/fixture'},undefined,undefined,guard,setFrozen,link);
      state.controller=value.controller; state.loaded=value.loaded; state.frozen=frozen; state.link=link;
      state.force=()=>setPulse(value=>value+1);
      state.changeDraft=value.changeDraft;
      function binding(){
        if(!state.binding)return null;
        const captured=structuredClone(value.owner), generation=state.generation;
        const operation=value.controller.beginExternalOperation(captured);
        if(!operation)return null;
        const assertAuthority=()=>{if(generation!==state.generation)throw Error('fixture authority changed')};
        return {owner:state.wrongHost?{...captured,hostId:'other'}:captured,operation,assertAuthority,async deleteIfUnchanged(entry,assertBeforeSend){
          assertBeforeSend();
          if(state.mode==='hold')await new Promise(resolve=>state.release=resolve);
          assertBeforeSend(); state.calls.push('conditional-delete');
          if(state.mode==='changed'){
            state.queue[0].input[0].text='changed elsewhere';
            sessionStorage.setItem('fixture-queue',JSON.stringify(state.queue));
          }
          const item=state.queue.find(item=>item.id===entry.id);
          if(!item || JSON.stringify(item)!==JSON.stringify(entry))return 'changed';
          state.queue=state.queue.filter(item=>item.id!==entry.id);
          sessionStorage.setItem('fixture-queue',JSON.stringify(state.queue));
          if(state.mode==='unknown')throw Error('fixture lost receipt');
          if(state.mode==='hold-after')await new Promise(resolve=>state.release=resolve);
          if(state.mode==='pending-link'){state.pendingLink=true;state.link.current=true;state.force()}
          if(state.mode==='receipt-failure'){
            const put=IDBObjectStore.prototype.put; let failed=false;
            IDBObjectStore.prototype.put=function(...args){
              const edits=args[0]?.atoms?.['codex-yard.queue-unknown.v2']?.editIntents;
              if(!failed && edits && Object.values(edits).some(item=>item.stage==='deleted')){
                failed=true; IDBObjectStore.prototype.put=put; throw Error('fixture receipt write failed');
              }
              return put.apply(this,args);
            };
          }
          return 'deleted';
        }};
      }
      return React.createElement(React.Fragment,null,
        React.createElement('textarea',{'aria-label':'Main draft',value:value.stored.draft.text,disabled:frozen,onChange:e=>void value.changeDraft(d=>({...d,text:e.target.value}))}),
        React.createElement(StandaloneQueue,{client,hostId:'local',threadId:'thread',busy:false,refreshVersion:0,
          beginOperation:value.beginOperation,beginQueueEdit:state.binding?binding:undefined,onQueueDraftCommitted:(before,after)=>value.controller.acceptCommittedVersion(before,after),
          onEditStateChange:(editing,pending)=>{state.editing=editing;state.pending=pending},frozen}));
    }
    function App(){const [owner,setOwner]=useState(state.owner);state.setOwner=setOwner;
      return React.createElement(Session,{key:owner,owner});}
    createRoot(document.getElementById('root')).render(React.createElement(App));
    window.fixture={state,original,notify,draftToInput,readUnknownQueueRecovery,readComposerDraftVersions,
      failWrites(){const put=IDBObjectStore.prototype.put;this.restore=()=>IDBObjectStore.prototype.put=put;
        IDBObjectStore.prototype.put=function(...args){if(this.name==='atoms')throw Error('fixture quota');return put.apply(this,args)}},
      changeOwner(id){state.owner=id;state.setOwner(id)},
      async snapshot(){return state.controller.snapshot()},
      async seed(){return state.controller.update(state.controller.snapshot().owner,draft=>({...draft,text:'existing draft',
        references:[{id:'ref',text:'keep',context:{fixture:'original'}}],pendingDrafts:[{text:'older draft',images:[],files:[]}]}))}
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const executablePath = process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome';
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--process-per-tab', '--disable-background-networking'] });
  const errors: string[] = [];
  const openPage = async (context: import('playwright-core').BrowserContext) => {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => (window as any).fixture.state.loaded);
    await page.getByText('hello world', { exact: true }).waitFor();
    return page;
  };
  const open = async () => {
    const context = await browser.newContext(), page = await openPage(context);
    return { context, page };
  };
  const edit = (page: import('playwright-core').Page) => page.getByRole('button', { name: '编辑待发送消息' });
  try {
    await t.test('atomic deletion transfers all input and parks the existing draft', async () => {
      const { context, page } = await open();
      try {
        assert.equal(await page.evaluate(() => (window as any).fixture.seed()), true);
        await edit(page).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'hello\nworld');
        const data = await page.evaluate(async () => {
          const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
          return { snapshot, input:f.draftToInput(snapshot.draft,'local'), original:f.original.input,
            recovery:await f.readUnknownQueueRecovery('local','thread'), calls:f.state.calls, queue:f.state.queue };
        });
        assert.deepEqual(data.input, data.original);
        assert.deepEqual(data.queue, []);
        assert.equal(data.snapshot.draft.pendingDrafts[0].text, 'older draft');
        assert.equal(data.snapshot.draft.pendingDrafts[1].text, 'existing draft');
        assert.equal(data.snapshot.draft.pendingDrafts[1].references[0].context.fixture, 'original');
        assert.equal(data.calls.filter((call: string) => call === 'conditional-delete').length, 1);
        assert.ok(!data.calls.some((call: string) => /queue\/(add|update|start)|turn\/start/.test(call)));
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.waitForFunction(() => (window as any).fixture.state.loaded);
        assert.equal((await page.evaluate(() => (window as any).fixture.state.controller.snapshot())).draft.text, 'hello\nworld');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.includes('conditional-delete')), false);
      } finally { await context.close(); }
    });
    await t.test('a changed queue entry is not deleted and original content survives reload', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'changed'; });
        await edit(page).click();
        await page.getByText('队列消息未确认删除，原内容已保留。').waitFor();
        const result = await page.evaluate(async () => { const f = (window as any).fixture;
          return { queue:f.state.queue, recovery:await f.readUnknownQueueRecovery('local','thread'), original:f.original }; });
        assert.equal(result.queue[0].input[0].text, 'changed elsewhere');
        assert.deepEqual(result.recovery.edits[0].entry, result.original);
        assert.equal(result.recovery.edits[0].stage, 'conflict');
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.getByText('队列消息未确认删除，原内容已保留。').waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.includes('conditional-delete')), false);
      } finally { await context.close(); }
    });
    await t.test('a lost delete receipt stays unknown even when the item is absent', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'unknown'; });
        await edit(page).click();
        await page.getByText('队列删除结果未知，不会自动重试。').waitFor();
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.getByText('队列删除结果未知，不会自动重试。').waitFor();
        const result = await page.evaluate(async () => { const f = (window as any).fixture;
          return { queue:f.state.queue, recovery:await f.readUnknownQueueRecovery('local','thread'), calls:f.state.calls,
            draft:f.state.controller.snapshot().draft, original:f.original }; });
        assert.deepEqual(result.queue, []);
        assert.equal(result.recovery.edits[0].stage, 'deleting');
        assert.deepEqual(result.recovery.edits[0].entry, result.original);
        assert.equal(result.draft.text, '');
        assert.ok(!result.calls.includes('conditional-delete'));
      } finally { await context.close(); }
    });
    await t.test('IDB failures stop dispatch or preserve a known receipt for local retry', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => (window as any).fixture.failWrites());
        await edit(page).click();
        await page.getByRole('textbox', { name: '未保存的队列原始内容' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.includes('conditional-delete')), false);
        await page.evaluate(() => (window as any).fixture.restore());
      } finally { await context.close(); }
      const second = await open();
      try {
        await second.page.evaluate(() => { (window as any).fixture.state.mode = 'receipt-failure'; });
        await edit(second.page).click();
        await second.page.getByText('删除已确认，但回执尚未保存；请重试保存回执。').waitFor();
        await second.page.getByRole('button', { name: '重试保存回执' }).click();
        await second.page.getByRole('button', { name: '恢复到输入区' }).waitFor();
        await second.page.getByRole('button', { name: '恢复到输入区' }).click();
        await second.page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'hello\nworld');
        assert.equal(await second.page.evaluate(() => (window as any).fixture.state.calls.filter((call: string) => call === 'conditional-delete').length), 1);
      } finally { await second.context.close(); }
    });
    await t.test('owner or authority changes prevent late deletion or replacement', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'hold'; });
        await edit(page).click();
        await page.waitForFunction(() => typeof (window as any).fixture.state.release === 'function');
        await page.evaluate(() => { const f = (window as any).fixture; f.state.generation++; f.state.release(); });
        await page.getByText('队列消息未确认删除，原内容已保留。').waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.queue.length), 1);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.includes('conditional-delete')), false);
      } finally { await context.close(); }
    });
    await t.test('confirmed deletion after owner changes remains scoped to the original draft', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'hold-after'; });
        await edit(page).click();
        await page.waitForFunction(() => typeof (window as any).fixture.state.release === 'function');
        await page.evaluate(() => (window as any).fixture.changeOwner('draft-b'));
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.owner.draftId === 'draft-b');
        await page.evaluate(() => (window as any).fixture.state.release());
        await page.getByText('队列删除已确认，原消息可恢复到输入区。').waitFor();
        await page.getByRole('button', { name: '恢复到输入区' }).click();
        await page.getByRole('alert').filter({ hasText: '恢复记录属于其他输入区' }).waitFor();
        assert.equal((await page.evaluate(() => (window as any).fixture.state.controller.snapshot())).draft.text, '');
        await page.evaluate(() => (window as any).fixture.changeOwner('draft-a'));
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.owner.draftId === 'draft-a');
        await page.getByRole('button', { name: '恢复到输入区' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'hello\nworld');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: string) => call === 'conditional-delete').length), 1);
      } finally { await context.close(); }
    });
    await t.test('a refused committed draft can be explicitly accepted with its original receipt', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.mode = 'pending-link'; });
        await edit(page).click();
        await page.getByText('队列消息已保存为草稿，等待输入区接收。').waitFor();
        const result = await page.evaluate(async () => { const f = (window as any).fixture;
          return { recovery:await f.readUnknownQueueRecovery('local','thread'), snapshot:f.state.controller.snapshot() }; });
        assert.equal(result.recovery.edits[0].stage, 'committed');
        assert.equal(result.recovery.edits[0].before.draft.text, '');
        assert.equal(result.recovery.edits[0].after.draft.text, 'hello\nworld');
        assert.equal(result.snapshot.draft.text, '');
        await page.evaluate(() => { const state = (window as any).fixture.state; state.pendingLink = false; state.link.current = false; state.force(); });
        await page.getByRole('button', { name: '接收已保存草稿' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'hello\nworld');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: string) => call === 'conditional-delete').length), 1);
      } finally { await context.close(); }
    });
    await t.test('missing conditional deletion never falls back to ID-only deletion', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { const state = (window as any).fixture.state; state.binding = false; state.force(); });
        await page.waitForFunction(() => (document.querySelector('button[aria-label="编辑待发送消息"]') as HTMLButtonElement)?.disabled);
        assert.equal(await edit(page).isDisabled(), true);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.queue.length), 1);
        assert.ok(!(await page.evaluate(() => (window as any).fixture.state.calls)).includes('thread/queue/delete'));
      } finally { await context.close(); }
    });
    await t.test('a binding for a different host is rejected before deletion', async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => { (window as any).fixture.state.wrongHost = true; });
        await edit(page).click();
        await page.getByRole('alert').filter({ hasText: '原队列和输入区身份不一致' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.queue.length), 1);
        assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.includes('conditional-delete')), false);
        assert.equal(await page.evaluate(async () => (await (window as any).fixture.readUnknownQueueRecovery('local', 'thread')).edits.length), 0);
      } finally { await context.close(); }
    });
    await t.test('two pages share the original recovery atom for one in-flight entry', async () => {
      const { context, page } = await open();
      try {
        const other = await openPage(context);
        await page.evaluate(() => { (window as any).fixture.state.mode = 'hold'; });
        await edit(page).click();
        await page.waitForFunction(() => typeof (window as any).fixture.state.release === 'function');
        await other.getByText('队列删除结果未知，不会自动重试。').waitFor();
        assert.equal(await edit(other).isDisabled(), true);
        const shared = await other.evaluate(async () => (window as any).fixture.readUnknownQueueRecovery('local', 'thread'));
        assert.equal(shared.edits.length, 1);
        assert.equal(shared.edits[0].entry.id, 'q1');
        assert.equal(await other.evaluate(() => (window as any).fixture.state.calls.includes('conditional-delete')), false);
        await page.evaluate(() => (window as any).fixture.state.release());
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === 'hello\nworld');
      } finally { await context.close(); }
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
