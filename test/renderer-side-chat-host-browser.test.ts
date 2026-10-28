import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createSideChatHost } from '../src/native/side-chat.ts';
import type { SideChatDependencies, SideChatOperation, SideChatStore } from '../src/native/side-chat.ts';
import type { LateRpcTerminal } from '../lib/codex-protocol.ts';

class Store implements SideChatStore {
  values = new Map<string, SideChatOperation>();
  chain: Promise<unknown> = Promise.resolve();
  fail?: (next: SideChatOperation, previous: SideChatOperation) => boolean;
  async create(op: SideChatOperation) { this.values.set(op.operationId, structuredClone(op)); }
  async read(id: string) { await this.chain.catch(() => {}); return structuredClone(this.values.get(id) ?? null); }
  async update(id: string, change: (value: SideChatOperation) => SideChatOperation) {
    const next = this.chain.catch(() => {}).then(() => {
      const current = this.values.get(id); if (!current) throw Error('missing operation');
      const updated = change(structuredClone(current));
      if (this.fail?.(updated, current)) throw Error('synthetic late receipt persistence failure');
      this.values.set(id, structuredClone(updated)); return structuredClone(updated);
    });
    this.chain = next; return next;
  }
}
async function eventually(check: () => boolean | Promise<boolean>) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('host receipt did not arrive');
}

test('the React panel consumes actual E host operations over an isolated synthetic peer', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const store = new Store(), calls: { host: string; method: string; params: Record<string, unknown>; generation: string }[] = [];
  const scopes: unknown[] = []; let boundaryLate: ((terminal: LateRpcTerminal) => void | Promise<void>) | undefined;
  let recoveryError: string | null = null;
  const options = { model: 'synthetic-model', effort: null, serviceTier: 'default', mode: 'plan' };
  const deps: SideChatDependencies = {
    store,
    async resolveParent(hostId, threadId) { return { hostId, threadId, connectionGeneration: 'original-generation', cwd: '/synthetic/project',
      workspaceRoots: ['/synthetic/project'], archived: false, model: 'synthetic-model', modelProvider: 'synthetic-provider', effort: null,
      serviceTier: null, sandboxPolicy: { type: 'readOnly' }, project: { id: 'project' },
      submitOptions: { model: 'synthetic-model', effort: null, mode: 'plan', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only' } }; },
    async request(host, method, params, _mutating, late, generation) {
      calls.push({ host, method, params: structuredClone(params), generation });
      if (method === 'config/read') return { config: { developer_instructions: 'host-only instruction' } };
      if (method === 'thread/fork') return { thread: { id: 'child', name: null, cwd: '/synthetic/project', turns: [],
        status: { type: 'idle' }, ephemeral: true, forkedFromId: 'parent' }, cwd: '/synthetic/project',
        runtimeWorkspaceRoots: ['/synthetic/project'], model: 'synthetic-model', modelProvider: 'synthetic-provider',
        reasoningEffort: null, serviceTier: 'default', sandbox: { type: 'readOnly' }, approvalPolicy: 'on-request', approvalsReviewer: 'user' };
      if (method === 'thread/inject_items') { boundaryLate = late; throw Error('synthetic boundary response lost'); }
      if (method === 'thread/unsubscribe') return { status: 'unsubscribed' };
      throw Error('unexpected method');
    },
    classifyFailure() { return 'unknown'; },
    async prepareClose(scope) { scopes.push({ prepare: scope }); },
    async cleanup(scope) { scopes.push({ cleanup: scope }); },
    onRecoveryError(_id, error) { recoveryError = error instanceof Error ? error.message : String(error); },
  };
  const host = createSideChatHost(deps);
  function projection(op: SideChatOperation) {
    const receipt = op.fork.receipt as { thread?: { id: string; name: string | null; cwd: string; turns: unknown[]; status: unknown } } | undefined;
    const thread = receipt?.thread;
    return { operationId: op.operationId, parent: { hostId: op.parent.hostId, threadId: op.parent.threadId, cwd: op.parent.cwd },
      childId: op.childId ?? null, child: op.fork.status === 'received' && thread
        ? { thread: { id: thread.id, name: thread.name, cwd: thread.cwd, turns: thread.turns, status: thread.status }, options } : null,
      fork: { status: op.fork.status, error: op.fork.error ?? null }, inject: { status: op.inject.status, error: op.inject.error ?? null },
      close: { requested: op.close.requested, status: op.close.status, error: op.close.error ?? null }, recoveryError };
  }
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SideChatController} from './src/renderer/side-chat/controller.ts';
    import {SideChatPanel} from './src/renderer/side-chat/SideChatPanel.tsx';
    const state={links:[],submits:[],closes:0,failGate:true}, listeners=new Set();
    async function invoke(method,body) { const response=await fetch('/side/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json(); if(!response.ok) throw Error(result.error); return result; }
    const port={prepare:(hostId,parentThreadId)=>invoke('prepare',{hostId,parentThreadId}),start:id=>{
      if(!state.links.some(link=>link.operationId===id&&link.hostId==='host-a'&&link.parentThreadId==='parent'&&link.draftId==='side-draft'))
        throw Error('start preceded the persisted draft link');
      return invoke('start',{id});},
      read:id=>invoke('read',{id}),retry:id=>invoke('retry',{id}),close:id=>invoke('close',{id}),
      retryPersistence:id=>invoke('retryPersistence',{id}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
    const controller=new SideChatController({hostId:'host-a',parentThreadId:'parent',draftId:'side-draft',port,
      canDispatch:()=>true,onPrepared:async scope=>{state.links.push(scope);}});
    const client={async rpc(method){if(method==='thread/queue/list'||method==='model/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('unexpected rpc '+method);},async host(endpoint){if(endpoint==='get-setting')return {value:'enter'};
      throw Error('unexpected host '+endpoint);},subscribe:()=>()=>{},async reply(){}};
    const history={hostId:'host-a',threadId:'child',thread:{id:'child',name:null,cwd:'/synthetic/project',turns:[],status:{type:'idle'}},
      options:{model:'synthetic-model',effort:null,serviceTier:'default',mode:'plan'},loading:false,historyComplete:true,streamGap:false,
      error:null,canSubmit:true,canInterrupt:true,retry(){}};
    let open=true;const root=createRoot(document.getElementById('root'));
    function render(){root.render(<SideChatPanel client={client} controller={controller} open={open} history={history}
      onClose={()=>state.closes++} onBeforeClose={async()=>{if(state.failGate)throw Error('synthetic pending send');}}
      onInterrupt={async()=>{throw Error('unexpected interrupt');}}
      onSubmit={async(description,draft,options,action,draftController)=>{state.submits.push({description,draft,options,action,owner:draftController.snapshot().owner});}}/>);}
    window.peer={state,controller,hide(){open=false;render();},show(){open=true;render();},hint(value){for(const fn of listeners)fn(value);}};render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = [], projections: unknown[] = []; let reads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' });
      if (!path.startsWith('/side/')) return route.abort();
      try {
        const body = route.request().postDataJSON() as { hostId?: string; parentThreadId?: string; id?: string };
        const action = path.slice('/side/'.length);
        const op = action === 'prepare' ? await host.prepare({ hostId: body.hostId!, threadId: body.parentThreadId! })
          : action === 'start' ? await host.start(body.id!) : action === 'read' ? (reads++, await host.read(body.id!))
            : action === 'retry' ? await host.retry(body.id!) : action === 'close' ? await host.close(body.id!)
              : action === 'retryPersistence' ? await host.retryPersistence(body.id!) : (() => { throw Error('unknown operation'); })();
        if (action === 'retryPersistence') recoveryError = null;
        const view = projection(op); projections.push(view);
        return route.fulfill({ json: view });
      } catch (error) { return route.fulfill({ status: 500, json: { error: error instanceof Error ? error.message : String(error) } }); }
    });
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: '打开侧聊' }).click();
    await page.getByText(/synthetic boundary response lost/).waitFor();
    const id = await page.evaluate(() => (window as any).peer.controller.getSnapshot().view.operationId as string);
    assert.deepEqual(await page.evaluate(() => (window as any).peer.state.links),
      [{hostId:'host-a',parentThreadId:'parent',operationId:id,draftId:'side-draft'}]);
    assert.equal(await page.evaluate(() => (window as any).peer.controller.getSnapshot().view.childId), 'child');
    assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).count(), 0);
    assert.deepEqual(calls.map(call => call.method), ['config/read', 'thread/fork', 'thread/inject_items']);
    assert.doesNotMatch(JSON.stringify(projections), /host-only instruction|configuredInstructions|forkParams|attemptId|boundaryItems/);
    await page.getByRole('button', { name: '核对结果' }).click(); await page.getByRole('button', { name: '核对结果' }).click();
    assert.equal(calls.filter(call => call.method === 'thread/inject_items').length, 1);
    await eventually(() => reads >= 2);
    const beforeForeign = reads;
    await page.evaluate(id => (window as any).peer.hint({hostId:'host-b',operationId:id}), id);
    await page.waitForTimeout(50); assert.equal(reads, beforeForeign);
    let failures = 0;
    store.fail = (next, previous) => previous.inject.status === 'unknown' && next.inject.status === 'received' && failures++ === 0;
    await boundaryLate!({ outcome: 'success', result: {} });
    await eventually(() => recoveryError !== null);
    await page.evaluate(id => (window as any).peer.hint({hostId:'host-a',operationId:id}), id);
    await page.getByText(/synthetic late receipt persistence failure/).waitFor();
    assert.equal(await page.evaluate(() => (window as any).peer.controller.getSnapshot().phase), 'inject-unknown');
    await page.getByRole('button', { name: '重试保存回执' }).click();
    await eventually(async () => (await host.read(id)).inject.status === 'received');
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await editor.waitFor();
    await editor.fill('side message'); await editor.press('Enter');
    await page.waitForFunction(() => (window as any).peer.state.submits.length === 1);
    const sent = await page.evaluate(() => (window as any).peer.state.submits[0]);
    assert.deepEqual(sent.description.owner, {hostId:'host-a',threadId:'child',draftId:'side-draft'});
    assert.deepEqual(sent.owner, sent.description.owner); assert.equal(sent.options.mode, 'plan');
    await editor.fill('later draft'); await page.evaluate(() => (window as any).peer.hide());
    assert.equal(await page.locator('.yard-side-chat').isHidden(), true);
    await page.evaluate(() => (window as any).peer.show()); assert.equal(await editor.inputValue(), 'later draft');
    await page.getByRole('button', {name:'关闭侧聊',exact:true}).click();
    await page.getByRole('dialog').getByRole('button', {name:'关闭侧聊',exact:true}).click();
    await page.getByText(/synthetic pending send/).waitFor(); assert.equal(await editor.inputValue(), 'later draft');
    assert.equal(calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
    await page.evaluate(() => { (window as any).peer.state.failGate=false; });
    await page.getByRole('button', {name:'关闭侧聊',exact:true}).click();
    await page.getByRole('dialog').getByRole('button', {name:'关闭侧聊',exact:true}).click();
    await page.waitForFunction(() => (window as any).peer.state.closes === 1);
    assert.equal((await host.read(id)).close.status, 'closed');
    assert.equal(calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
    assert.ok(calls.every(call => call.host === 'host-a' && call.generation === 'original-generation'));
    assert.deepEqual(scopes, [{prepare:{operationId:id,hostId:'host-a',parentThreadId:'parent',childThreadId:'child'}},
      {cleanup:{operationId:id,hostId:'host-a',parentThreadId:'parent',childThreadId:'child'}}]);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
