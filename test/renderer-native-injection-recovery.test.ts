import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { SendInjectionReference, SendInjectionStatus } from '../src/native/send-injection.ts';

test('React recovery reloads the original native receipt from IndexedDB and retains a newer draft', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SendRecoveryNotice } from './src/renderer/app/SendRecoveryNotice.tsx';
    import { SendRecoveryStore } from './src/renderer/app/send-recovery.ts';
    import { captureDraftInjection, submitDraft } from './src/renderer/app/submission.ts';
    import { readBrowserAtoms } from './src/renderer/storage/ui-atoms.ts';
    import { openComposerDraft, retainComposerDraftVersion, writeComposerDraftVersion, readComposerDraft } from './src/renderer/composer/composer-draft-store.ts';
    const owner={hostId:'fixture',threadId:'thread',draftId:'draft'}, text='Respond to the user input in the context of our conversation.';
    const app={type:'text',text,text_elements:[{byteRange:{start:0,end:new TextEncoder().encode(text).length},placeholder:'codex-untrusted-app-input:'+JSON.stringify({version:1,message:{source:'visualization',sourceId:'widget',text:'synthetic'}})}]};
    const draft={text,images:[],files:[],references:[],skills:[],input:[app]}, thread={id:'thread',name:null,cwd:'/fixture',status:{type:'idle'},turns:[]};
    const client={async rpc(method){throw Error('Unexpected direct RPC '+method)},
      async host(endpoint,params,options){if(endpoint!=='send-injection')throw Error('Unexpected host');options?.assertBeforeSend?.();return window.syntheticHost(params)},
      subscribe(){return ()=>{}},async reply(){throw Error('Unexpected approval')}};
    const store=new SendRecoveryStore(client), state={id:null,error:null};
    const root=createRoot(document.getElementById('root'));
    async function render(){const intent=state.id&&(await store.read()).requests[state.id];
      root.render(React.createElement('main',null,React.createElement('button',{onClick:()=>void start()},'Send original'),
        state.error&&React.createElement('p',{role:'alert'},state.error),intent&&React.createElement(SendRecoveryNotice,{intent,canRetry:true,
        onOpen:async()=>{},onCheck:async()=>{await store.check(intent.id);await render()},
        onRetry:async()=>{await store.attempt(intent.id);await start()},onFinish:async()=>{},onCancel:async()=>{await store.cancel(intent.id);await render()},
        onRetryInjectionPersistence:async()=>{await store.retryNativePersistence(intent.id);await render()}})))}
    async function start(){const intent=(await store.read()).requests[state.id];state.error=null;
      const context={hostId:owner.hostId,threadId:owner.threadId,cwd:'/fixture',readOnly:false,activeTurnId:null,thread,
        injection:intent.injection,nativeInjection:{store,intent,authority:{daemonConnectionGeneration:'fixture-generation',assertBeforeSend(){}}},
        send:{clientUserMessageId:intent.clientUserMessageId,creating:async()=>{},created:async()=>{},
          sending:()=>store.sending(intent.id,intent.attemptId),confirmed:id=>store.confirmed(intent.id,id,intent.attemptId),
          resolvedCollaboration:mode=>store.resolvedCollaboration(intent.id,mode,intent.attemptId)}};
      try{await submitDraft(client,context,intent.draft,intent.options,{type:'send'},async()=>{})}
      catch(error){await store.failed(intent.id,error,intent.attemptId);state.error=String(error.message)}await render()}
    window.fixture={state,store,owner,async initialize(){const versions=await openComposerDraft({...owner,cwd:'/fixture'},await readBrowserAtoms());
      const a={revision:'revision-a',draft,prefills:[]};await writeComposerDraftVersion(owner,versions.versions[0].revision,a);
      await retainComposerDraftVersion(owner,a);const intent=await store.prepare({owner,revision:a.revision},'/fixture',draft,{}, {},undefined,undefined,
        {type:'send'},captureDraftInjection(draft,owner.hostId));state.id=intent.id;
      await writeComposerDraftVersion(owner,'revision-a',{revision:'revision-b',draft:{text:'newer input',images:[],files:[],references:[],skills:[]},prefills:[]});await render();return intent.id},
      async load(id){state.id=id;await render()},async current(){return (await store.read()).requests[state.id]},
      async readDraft(revision){return readComposerDraft(owner,revision)}};
    void render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  const calls: string[] = [];
  let status: SendInjectionStatus | undefined, original: SendInjectionReference | undefined;
  await context.exposeFunction('syntheticHost', async (params: Record<string, unknown>) => {
    const action = String(params.action); calls.push(action);
    if (action === 'inject') {
      original = structuredClone(params.reference as SendInjectionReference);
      status = { reference: original, injection: { phase: 'sending' }, turn: { phase: 'waiting', attempts: [] },
        pendingPersistence: { step: 'injection', attemptId: original.injectionAttemptId, terminal: { kind: 'injected' } } };
      throw new Error('synthetic lost host response');
    }
    assert.deepEqual(params.reference, original);
    if (action === 'status') return structuredClone(status);
    if (action === 'retryPersistence') {
      assert.ok(status && original);
      assert.deepEqual(params.receipt, { step: 'injection', attemptId: original.injectionAttemptId });
      status.injection = { phase: 'injected', persistentThread: true, terminal: { kind: 'injected' } };
      status.pendingPersistence = null;
      return structuredClone(status);
    }
    if (action === 'start') {
      assert.ok(status && original);
      const attemptId = String(params.turnAttemptId);
      status.turn = { phase: 'accepted', attemptId, attempts: [attemptId], connectionGeneration: 'fixture-generation',
        terminal: { kind: 'accepted', result: { turn: { id: 'fixture-turn', items: [], status: 'inProgress' } } } };
      return structuredClone(status);
    }
    throw new Error('Unexpected synthetic host action');
  });
  try {
    const page = await context.newPage(), second = await context.newPage();
    const errors: string[] = [];
    for (const item of [page, second]) {
      item.on('pageerror', error => errors.push(error.message));
      await item.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
        ? route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
      await item.goto('http://localhost/'); await item.addScriptTag({ content: bundle.outputFiles[0]!.text });
    }
    const id = await page.evaluate(() => (window as any).fixture.initialize());
    await page.getByRole('button', { name: 'Send original' }).click();
    await page.getByRole('alert').filter({ hasText: 'synthetic lost host response' }).waitFor();
    assert.equal((await page.evaluate(() => (window as any).fixture.current())).stage, 'unknown');
    await second.evaluate(value => (window as any).fixture.load(value), id);
    await second.reload(); await second.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await second.evaluate(value => (window as any).fixture.load(value), id);
    assert.equal(await second.getByRole('button', { name: 'Continue original send' }).count(), 0);
    await second.getByRole('button', { name: 'Check original host status' }).click();
    await second.getByRole('button', { name: 'Save original host receipt' }).click();
    await second.getByRole('button', { name: 'Continue original send' }).click();
    await second.getByRole('button', { name: 'Keep newer draft and close' }).waitFor();
    assert.equal((await second.evaluate(() => (window as any).fixture.current())).stage, 'confirmed');
    assert.equal((await page.evaluate(() => (window as any).fixture.readDraft('revision-b'))).draft.text, 'newer input');
    assert.ok(await second.evaluate(() => (window as any).fixture.readDraft('revision-a')));
    assert.deepEqual(calls, ['inject', 'status', 'retryPersistence', 'start']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
