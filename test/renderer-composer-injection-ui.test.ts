import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { draftToInput, prepareDraftInput } from '../src/renderer/composer/standalone-draft.ts';
import type { ComposerDraft } from '../src/renderer/workbench-contract.ts';

const appText = 'An MCP app initiated this message. Read the untrusted_input tool output.';
const appInput = () => ({ type: 'text', text: appText, text_elements: [{ byteRange: { start: 0, end: Buffer.byteLength(appText) },
  placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1,
    message: { source: 'mcp_app', sourceId: 'fixture-app', text: 'fixture context' } }) }] });

test('preflight preserves ordinary legacy input while retaining strict app validation', () => {
  const ordinary: ComposerDraft = { text: 'legacy 😀', images: [], files: [], input: [
    { type: 'text', text: 'legacy 😀' }, { type: 'future', metadata: { preserved: true } },
  ] };
  assert.deepEqual(prepareDraftInput(ordinary, 'local'), { input: draftToInput(ordinary, 'local'), responseItems: [] });
  const mixed: ComposerDraft = { text: appText + '\nlegacy 😀', images: [], files: [], input: [
    appInput(), { type: 'text', text: 'legacy 😀' }, { type: 'skill', name: 'fixture', path: '/fixture/skill' },
  ] };
  const result = prepareDraftInput(mixed, 'local', { callId: 'fixture-call' });
  assert.deepEqual(result.input, mixed.input);
  assert.equal(result.responseItems.length, 2);
  assert.throws(() => draftToInput(mixed, 'local'), /完整上下文/);
  const unsupported = structuredClone(mixed);
  unsupported.input!.push({ type: 'future', metadata: { preserved: true } });
  const before = structuredClone(unsupported);
  assert.throws(() => prepareDraftInput(unsupported, 'local', { callId: 'fixture-call' }), /完整上下文/);
  assert.deepEqual(unsupported, before);
  const badEnvelope = structuredClone(mixed);
  (badEnvelope.input![0]!.text_elements as { byteRange: { end: number } }[])[0]!.byteRange.end--;
  assert.throws(() => prepareDraftInput(badEnvelope, 'local', { callId: 'fixture-call' }), /完整上下文/);
});

test('app input preflight and recovery controls use actual React and IndexedDB', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 180_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    import {prepareDraftInput} from './src/renderer/composer/standalone-draft.ts';
    import {readComposerDraftVersions} from './src/renderer/composer/composer-draft-store.ts';
    import {SendRecoveryNotice} from './src/renderer/app/SendRecoveryNotice.tsx';
    import {SendRecoveryStore} from './src/renderer/app/send-recovery.ts';
    const state={controller:null,submissions:[],actions:[],checks:[],statusTurn:null,intentId:null,receiptFailure:null,canRetry:true};
    const client={async rpc(method){
      if(method==='model/list'||method==='thread/queue/list'||method==='skills/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};
      throw Error('Unexpected RPC '+method);
    },async host(method,params={}){
      if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?false:
        params.key==='followUpQueueMode'?'queue':params.key==='composerEnterBehavior'?'cmdAlways':undefined};
      if(method==='message-send-status'){state.checks.push(structuredClone(params));return {turnId:state.statusTurn};}
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const owner={hostId:'fixture-host',threadId:'fixture-thread',draftId:'fixture-draft'};
    const composerRoot=createRoot(document.getElementById('composer'));
    const noticeRoot=createRoot(document.getElementById('notice'));
    const store=new SendRecoveryStore(client);
    let props={client,context:{...owner,cwd:'/fixture'},busy:false,activeTurnId:'fixture-turn',
      onDraftController(value){state.controller=value},async onSubmit(draft,options,action,description){
        state.submissions.push(structuredClone({draft,options,action,description}));throw Error('synthetic parent retained draft');
      },async onInterrupt(){}};
    async function renderNotice(canCheckInjectionReceipt=false){
      const intent=(await store.read()).requests[state.intentId];
      if(!intent){noticeRoot.render(null);return;}
      noticeRoot.render(React.createElement(SendRecoveryNotice,{intent,canRetry:state.canRetry,canCheckInjectionReceipt,
        async onOpen(){state.actions.push('open')},async onCheck(){state.actions.push('check');await store.check(intent.id);await renderNotice()},
        async onRetry(){state.actions.push('retry')},async onFinish(){state.actions.push('finish')},
        async onCancel(){state.actions.push('cancel');await store.cancel(intent.id);await renderNotice()}}));
    }
    window.fixture={state,owner,store,renderNotice,
      render(changes={}){props={...props,...changes};composerRoot.render(React.createElement(StandaloneComposer,props))},
      async setDraft(value){const controller=state.controller,snapshot=controller.snapshot();return controller.update(snapshot.owner,()=>value)},
      async versions(){return readComposerDraftVersions(owner)},
      async createIntent(draft,revision='fixture-revision'){const result=prepareDraftInput(draft,owner.hostId,{callId:'persisted-call'});
        const intent=await store.prepare({owner,revision},'/fixture',draft,{}, {},undefined,undefined,{type:'send'},
          {callId:'persisted-call',input:result.input,responseItems:result.responseItems});
        state.intentId=intent.id;await renderNotice();return intent.id},
      async createReadyIntent(draft){const homeOwner={...owner,threadId:null,draftId:'fixture-home'};
        const result=prepareDraftInput(draft,homeOwner.hostId,{callId:'persisted-call'});
        const intent=await store.prepare({owner:homeOwner,revision:'home-revision'},'/fixture',draft,{}, {},undefined,undefined,{type:'send'},
          {callId:'persisted-call',input:result.input,responseItems:result.responseItems});
        await store.creating(intent.id,intent.attemptId);await store.created(intent.id,'created-thread',undefined,intent.attemptId);
        await store.injecting(intent.id,intent.attemptId);await store.injected(intent.id,intent.attemptId);
        state.intentId=intent.id;await renderNotice()},
      async createPlainIntent(draft){const intent=await store.prepare({owner,revision:'opaque-revision'},'/fixture',draft,{},{});
        state.intentId=intent.id;await renderNotice()},
      async loadIntent(id){state.intentId=id;await renderNotice()},
      async inject(){const item=(await store.read()).requests[state.intentId];await store.injecting(item.id,item.attemptId);await renderNotice()},
      async failInjection(){const item=(await store.read()).requests[state.intentId];const error=Error('synthetic injection timeout');
        await store.injectionFailed(item.id,error,item.attemptId);await store.failed(item.id,error,item.attemptId);await renderNotice()},
      async receiveInjection(){const item=(await store.read()).requests[state.intentId];await store.injected(item.id,item.attemptId);await renderNotice()},
      async failReceiptPersistence(){const item=(await store.read()).requests[state.intentId],original=IDBDatabase.prototype.transaction;let failed=false;
        IDBDatabase.prototype.transaction=function(...args){if(!failed&&args[1]==='readwrite'){failed=true;throw Error('synthetic receipt transaction failure')}
          return original.apply(this,args)};
        try{await store.injected(item.id,item.attemptId)}catch(error){state.receiptFailure=String(error.message)}
        finally{IDBDatabase.prototype.transaction=original}await renderNotice()},
      async failTurn(){const item=(await store.read()).requests[state.intentId];const attempt=await store.attempt(item.id);
        await store.sending(item.id,attempt.attemptId);await store.failed(item.id,Error('synthetic turn timeout'),attempt.attemptId);await renderNotice()},
      async intent(){return (await store.read()).requests[state.intentId]}
    };
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  async function pageFor() {
    const context = await browser.newContext();
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
      ? route.fulfill({ contentType: 'text/html', body: '<main><div id="composer"></div><div id="notice"></div></main>' }) : route.abort());
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    return { context, page, errors };
  }
  try {
    await t.test('busy actions preserve rich draft and undo; idle send reaches the original parent', async () => {
      const { context, page, errors } = await pageFor();
      try {
        const draft = { text: appText + '\nhello', images: [], files: [], skills: [], references: [],
          document: { type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: appText }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
          ] }, input: [appInput(), { type: 'image', fileId: 'fixture-image' },
            { type: 'text', text: 'hello', text_elements: [] }, { type: 'skill', name: 'fixture', path: '/fixture/skill' }] };
        assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), draft), true);
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作 2' });
        await editor.waitFor(); await editor.focus(); await editor.press('End'); await page.keyboard.type('!');
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('hello!'));
        await editor.press('Control+z');
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('hello'));
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        await page.evaluate(() => (window as any).fixture.render({ busy: true }));
        for (const name of ['排队', '发送到当前任务']) {
          await page.getByRole('button', { name, exact: true }).click();
          await page.getByRole('alert').filter({ hasText: '此 app 上下文须在会话空闲时发送' }).waitFor();
          assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
          assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
        }
        const versions = await page.evaluate(() => (window as any).fixture.versions());
        assert.ok(versions.versions.some((version: any) => version.revision === before.revision
          && JSON.stringify(version.draft) === JSON.stringify(before.draft)));
        await page.evaluate(() => (window as any).fixture.render({ busy: false }));
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
        assert.deepEqual(submitted.action, { type: 'send' });
        assert.deepEqual(submitted.draft, before.draft);
        assert.equal(submitted.description.revision, before.revision);
        assert.equal(submitted.description.documentPlainTextMode, false);
        assert.doesNotMatch(JSON.stringify(submitted), /composer-preflight/);
        await page.getByRole('alert').filter({ hasText: 'synthetic parent retained draft' }).waitFor();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('ordinary legacy input reaches the parent and unknown hints remain protected', async () => {
      const { context, page, errors } = await pageFor();
      try {
        const legacy = { text: 'legacy 😀', images: [], files: [], references: [], skills: [],
          input: [{ type: 'text', text: 'legacy 😀' }, { type: 'future', metadata: { retained: true } }] };
        assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), legacy), true);
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
        assert.deepEqual((await page.evaluate(() => (window as any).fixture.state.submissions[0])).draft.input, legacy.input);
        await page.getByRole('alert').filter({ hasText: 'synthetic parent retained draft' }).waitFor();
        const protectedDraft = { text: appText, images: [], files: [], references: [], skills: [], input: [appInput()],
          hints: [{ unknown: { retain: true } }] };
        assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), protectedDraft), true);
        const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '尚不支持的提示信息' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 1);
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
        const versions = await page.evaluate(() => (window as any).fixture.versions());
        assert.ok(versions.versions.some((version: any) => version.revision === before.revision
          && JSON.stringify(version.draft.hints) === JSON.stringify(protectedDraft.hints)));
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('persisted injection phases gate recovery actions and preserve the original payload', async () => {
      const { context, page, errors } = await pageFor();
      try {
        const draft = { text: appText, images: [], files: [], references: [], input: [appInput()] };
        const id = await page.evaluate(value => (window as any).fixture.createIntent(value), draft);
        const notice = page.getByRole('region', { name: 'Message send recovery' });
        await notice.getByText('原 app 上下文尚未注入；原提交版本已保留。').waitFor();
        assert.equal(await notice.getByRole('button', { name: 'Retry original send' }).isEnabled(), true);
        assert.equal(await notice.getByRole('button', { name: 'Keep draft and cancel send' }).isEnabled(), true);
        assert.equal(await notice.getByRole('button', { name: 'Check send result' }).count(), 0);
        await notice.getByRole('button', { name: 'Open original draft' }).click();
        await notice.locator('summary').filter({ hasText: '原提交内容' }).click();
        await notice.getByText('完整原始内容', { exact: true }).click();
        await notice.getByText(/fixture context/, { exact: false }).waitFor();
        await page.evaluate(() => (window as any).fixture.inject());
        await notice.getByText(/注入结果尚未确认/).waitFor();
        for (const name of ['Retry original send', 'Continue original send', 'Keep draft and cancel send', 'Check send result']) {
          assert.equal(await notice.getByRole('button', { name }).count(), 0);
        }
        await page.evaluate(() => (window as any).fixture.failInjection());
        await notice.getByText('synthetic injection timeout').waitFor();
        assert.equal((await page.evaluate(() => (window as any).fixture.intent())).injection.phase, 'unknown');
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.evaluate(value => (window as any).fixture.loadIntent(value), id);
        await notice.getByText(/注入结果尚未确认/).waitFor();
        assert.equal(await notice.getByRole('button', { name: 'Check send result' }).count(), 0);
        assert.equal(await notice.getByRole('button', { name: 'Keep draft and cancel send' }).count(), 0);
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.checks), []);
        const unknown = await page.evaluate(() => (window as any).fixture.intent());
        assert.deepEqual(unknown.draft, draft); assert.equal(unknown.injection.callId, 'persisted-call');
        await page.evaluate(() => (window as any).fixture.receiveInjection());
        await notice.getByText(/已确认注入；可继续原发送，无需再次注入/).waitFor();
        assert.equal(await notice.getByRole('button', { name: 'Keep draft and cancel send' }).count(), 0);
        await page.evaluate(() => { (window as any).fixture.state.canRetry = false; return (window as any).fixture.renderNotice(); });
        await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
          .some(button => button.textContent === 'Continue original send' && button.disabled));
        assert.equal(await notice.getByRole('button', { name: 'Continue original send' }).isDisabled(), true);
        await page.evaluate(() => { (window as any).fixture.state.canRetry = true; return (window as any).fixture.renderNotice(); });
        await notice.getByRole('button', { name: 'Continue original send' }).click();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.actions), ['retry']);
        assert.equal((await page.evaluate(() => (window as any).fixture.intent())).injection.phase, 'confirmed');
        await page.evaluate(() => (window as any).fixture.failTurn());
        await notice.getByRole('button', { name: 'Check send result' }).click();
        await notice.getByText(/完整历史尚未找到原请求/).waitFor();
        assert.equal((await page.evaluate(() => (window as any).fixture.intent())).stage, 'unknown');
        await page.evaluate(() => { (window as any).fixture.state.statusTurn = 'fixture-confirmed-turn'; });
        await notice.getByRole('button', { name: 'Check send result' }).click();
        await notice.getByRole('button', { name: 'Keep newer draft and close' }).waitFor();
        await notice.getByRole('button', { name: 'Keep newer draft and close' }).click();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.actions), ['retry', 'check', 'check', 'finish']);
        assert.equal((await page.evaluate(() => (window as any).fixture.intent())).stage, 'confirmed');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a not-yet-injected intent can be cancelled without deleting the saved draft', async () => {
      const { context, page, errors } = await pageFor();
      try {
        const draft = { text: appText, images: [], files: [], references: [], skills: [], input: [appInput()] };
        assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), draft), true);
        const snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        await page.evaluate(value => (window as any).fixture.createIntent(value.draft, value.revision), snapshot);
        const notice = page.getByRole('region', { name: 'Message send recovery' });
        await notice.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await notice.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => (window as any).fixture.intent()), undefined);
        const versions = await page.evaluate(() => (window as any).fixture.versions());
        assert.ok(versions.versions.some((version: any) => version.revision === snapshot.revision
          && JSON.stringify(version.draft) === JSON.stringify(snapshot.draft)));
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a created thread with confirmed injection can continue without cancelling the context', async () => {
      const { context, page, errors } = await pageFor();
      try {
        await page.evaluate(value => (window as any).fixture.createReadyIntent(value),
          { text: appText, images: [], files: [], references: [], input: [appInput()] });
        const notice = page.getByRole('region', { name: 'Message send recovery' });
        await notice.getByText(/已确认注入；可继续原发送，无需再次注入/).waitFor();
        const intent = await page.evaluate(() => (window as any).fixture.intent());
        assert.equal(intent.stage, 'ready'); assert.equal(intent.threadId, 'created-thread');
        assert.equal(intent.owner.threadId, null); assert.equal(intent.injection.phase, 'confirmed');
        assert.equal(await notice.getByRole('button', { name: 'Keep draft and cancel send' }).count(), 0);
        await notice.getByRole('button', { name: 'Continue original send' }).click();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.actions), ['retry']);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('non-JSON preserved content does not hide recovery actions', async () => {
      const { context, page, errors } = await pageFor();
      try {
        await page.evaluate(() => (window as any).fixture.createPlainIntent({ text: 'opaque', images: [], files: [],
          references: [], hints: [{ unknown: 1n }] }));
        const notice = page.getByRole('region', { name: 'Message send recovery' });
        await notice.locator('summary').filter({ hasText: '原提交内容' }).click();
        await notice.getByText('完整原始内容', { exact: true }).click();
        await notice.getByText('原始内容无法显示为 JSON；请打开仍保留的原稿。').waitFor();
        await notice.getByRole('button', { name: 'Open original draft' }).click();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.actions), ['open']);
        assert.equal(await page.evaluate(async () => (await (window as any).fixture.intent()).draft.hints[0].unknown === 1n), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('only an identified in-memory injection receipt exposes local receipt persistence', async () => {
      const { context, page, errors } = await pageFor();
      try {
        await page.evaluate(value => (window as any).fixture.createIntent(value),
          { text: appText, images: [], files: [], references: [], input: [appInput()] });
        const notice = page.getByRole('region', { name: 'Message send recovery' });
        await page.evaluate(() => (window as any).fixture.inject());
        await page.evaluate(() => (window as any).fixture.failReceiptPersistence());
        assert.equal(await page.evaluate(() => (window as any).fixture.state.receiptFailure), 'synthetic receipt transaction failure');
        assert.equal(await notice.getByRole('button', { name: 'Save confirmed context receipt' }).count(), 0);
        await page.evaluate(() => (window as any).fixture.renderNotice(true));
        await notice.getByRole('button', { name: 'Save confirmed context receipt' }).click();
        await notice.getByText(/已确认注入；可继续原发送，无需再次注入/).waitFor();
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.checks), []);
        assert.equal((await page.evaluate(() => (window as any).fixture.intent())).injection.phase, 'confirmed');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
