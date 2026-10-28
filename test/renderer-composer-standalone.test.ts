import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const chromePath = '/usr/bin/google-chrome';

test('standalone composer preserves drafts, routes settings and controls the authoritative queue', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
      const state = { calls: [], submissions: [], queues: {}, subscribers: new Set(), lock: true, failAdd: false, failStart: false, interruptFail: false };
      let seq = 0, resolveSubmit, rejectSubmit;
      const key = (host, thread) => host + ':' + thread;
      const notify = (host, thread) => { for (const listener of state.subscribers) listener({type:'mcp-notification', hostId:host, method:'thread/queue/changed', params:{threadId:thread}}); };
      const client = {
        async rpc(method, params = {}, host = 'local') {
          state.calls.push({method, params:structuredClone(params), host});
          if (method === 'model/list') return {data:[{id:'model-a',model:'model-a',displayName:'Model A',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{id:'model-b',model:'model-b',displayName:'Model B',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null};
          if (method === 'config/read') return {config:{model:'model-a',model_reasoning_effort:'high',approval_policy:'on-request',sandbox_mode:'workspace-write',service_tier:null}};
          if (method === 'fs/createDirectory' || method === 'fs/writeFile') return {};
          const queue = state.queues[key(host, params.threadId)] ||= [];
          if (method === 'thread/queue/list') return {data:structuredClone(queue), nextCursor:null};
          if (method === 'thread/queue/add') {
            const item = {id:'q' + ++seq,input:structuredClone(params.input),clientUserMessageId:params.clientUserMessageId};
            queue.push(item); notify(host, params.threadId);
            if (state.failAdd) throw Error('fixture uncertain response');
            return {queuedSubmission:item};
          }
          if (method === 'thread/queue/update') { const item=queue.find(item=>item.id===params.queuedSubmissionId); item.input=structuredClone(params.input); notify(host, params.threadId); return {queuedSubmission:item}; }
          if (method === 'thread/queue/delete') { const i=queue.findIndex(item=>item.id===params.queuedSubmissionId); if(i<0)return {deleted:false}; queue.splice(i,1); notify(host, params.threadId); return {deleted:true}; }
          if (method === 'thread/queue/reorder') { const next=params.queuedSubmissionIds.map(id=>queue.find(item=>item.id===id)); queue.splice(0,queue.length,...next); notify(host, params.threadId); return {}; }
          if (method === 'thread/queue/start') { const i=queue.findIndex(item=>item.id===params.queuedSubmissionId); if(i<0)throw Error('missing item'); queue.splice(i,1); notify(host, params.threadId); if(state.failStart)throw Error('fixture unknown start'); return {turn:{id:'turn'}}; }
          throw Error('Unexpected fixture RPC: ' + method);
        },
        async host(endpoint, params = {}) {
          state.calls.push({endpoint, params:structuredClone(params)});
          if (endpoint === 'queued-follow-up-send-lock-acquire') return {acquired:state.lock};
          if (endpoint === 'queued-follow-up-send-lock-release') return null;
          if (endpoint === 'codex-home') return {codexHome:'/fixture/codex'};
          if (endpoint === 'workspace-files') return {text:'fixture file preview'};
          throw Error('Unexpected fixture host operation: ' + endpoint);
        },
        subscribe(listener) { state.subscribers.add(listener); return () => state.subscribers.delete(listener); }
      };
      let props = {client,context:{hostId:'local',threadId:'thread-a',cwd:'/fixture/a'},busy:false,
        onSubmit(draft,options) { state.submissions.push({draft:structuredClone(draft),options:structuredClone(options)}); return new Promise((resolve,reject)=>{resolveSubmit=resolve;rejectSubmit=reject;}); },
        async onInterrupt() { if(state.interruptFail) throw Error('fixture stop failure'); }};
      const root = createRoot(document.getElementById('root'));
      window.fixture = {state, render(changes={}) {props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));},
        resolveSubmit(){resolveSubmit();}, rejectSubmit(){rejectSubmit(Error('fixture submit failure'));}};
      window.fixture.render();
    ` },
    bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' });
      if (url.pathname === '/api/files/uploads') return route.fulfill({ json: { uploadId: 'upload', directory: '/fixture' } });
      if (url.pathname === '/api/files/upload') return route.fulfill({ json: { label: url.searchParams.get('name'), fsPath: '/fixture/' + url.searchParams.get('name'), path: '/fixture/' + url.searchParams.get('name') } });
      return route.abort();
    });
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await page.locator('select[aria-label="模型"] option[value="model-b"]').waitFor({ state: 'attached' });
    await page.getByLabel('模型').selectOption('model-b');
    await page.getByLabel('推理强度').selectOption('low');
    await page.getByLabel('审批策略').selectOption('never');
    await page.getByLabel('沙箱权限').selectOption('read-only');
    await page.getByLabel('快速').check();
    await page.getByLabel('计划').check();
    await editor.fill('first draft');
    await editor.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    await editor.press('Shift+Enter');
    assert.match(await editor.inputValue(), /\n/);
    await editor.fill('first draft');
    await editor.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(submitted.draft.text, 'first draft');
    assert.deepEqual(submitted.options, { model: 'model-b', effort: 'low', approvalPolicy: 'never', sandboxMode: 'read-only', serviceTier: 'fast', mode: 'plan' });
    await editor.fill('newer edit');
    await page.evaluate(() => (window as any).fixture.resolveSubmit());
    await page.getByRole('button', { name: '发送', exact: true }).waitFor();
    assert.equal(await editor.inputValue(), 'newer edit');
    await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-b' } }));
    await editor.fill('other thread');
    await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-a' } }));
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === 'newer edit');
    await page.evaluate(() => (window as any).fixture.render({ prefill: {id:'ref-1',draft:{text:'',images:[],files:[],references:[{id:'r1',text:'fixture reference'}]}} }));
    await page.getByText('fixture reference').waitFor();
    await page.evaluate(() => (window as any).fixture.render({ context: {threadId:'thread-b'} }));
    await page.evaluate(() => (window as any).fixture.render({ context: {threadId:'thread-a'} }));
    await page.getByText('fixture reference').waitFor();
    assert.equal(await page.getByText('fixture reference').count(), 1);
    await page.getByRole('button', { name: '移除引用' }).click();
    await page.getByLabel('发送方式').selectOption('mod');
    await editor.press('Enter');
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 1);
    await editor.press('Control+Enter');
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 2);
    await page.evaluate(() => (window as any).fixture.rejectSubmit());
    await page.getByRole('alert').filter({ hasText: 'fixture submit failure' }).waitFor();
    assert.match(await editor.inputValue(), /newer edit/);

    await page.evaluate(() => (window as any).fixture.render({busy:true,prefill:null}));
    await editor.fill('queued one');
    await page.getByRole('button', { name: '排队' }).click();
    await page.getByText('queued one', { exact: true }).waitFor();
    await editor.fill('queued two');
    await page.getByRole('button', { name: '排队' }).click();
    await page.getByText('queued two', { exact: true }).waitFor();
    await page.getByRole('button', { name: '上移待发送消息' }).nth(1).click();
    await page.waitForFunction(() => (window as any).fixture.state.queues['local:thread-a'][0].input[0].text === 'queued two');
    await page.getByRole('button', { name: '编辑待发送消息' }).first().click();
    await page.getByRole('textbox', { name: '编辑待发送消息' }).fill('changed queue');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('changed queue', { exact: true }).waitFor();
    await page.getByRole('button', { name: '删除待发送消息' }).last().click();
    await page.getByText('queued one', { exact: true }).waitFor({ state: 'detached' });
    await page.evaluate(() => { (window as any).fixture.state.failAdd = true; });
    await editor.fill('retain on failure');
    await page.getByRole('button', { name: '排队' }).click();
    await page.getByRole('alert').filter({ hasText: 'fixture uncertain response' }).waitFor();
    assert.equal(await editor.inputValue(), 'retain on failure');
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'thread/queue/add').length), 3);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.queues['local:thread-a'].some((item: any) => item.input[0].text === 'retain on failure')), true);
    await page.evaluate(() => { (window as any).fixture.state.interruptFail = true; });
    await page.getByRole('button', { name: '停止' }).click();
    await page.getByRole('alert').filter({ hasText: 'fixture stop failure' }).waitFor();
    await page.evaluate(() => { (window as any).fixture.state.lock = false; (window as any).fixture.render({busy:false}); });
    await page.getByRole('button', { name: '立即发送待发送消息' }).first().click();
    await page.getByRole('alert').filter({ hasText: '另一页面' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'thread/queue/start').length), 0);
    await page.evaluate(() => { (window as any).fixture.state.lock = true; });
    await page.getByRole('button', { name: '立即发送待发送消息' }).first().click();
    await page.getByText('changed queue', { exact: true }).waitFor({ state: 'detached' });
    const release = await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.endpoint === 'queued-follow-up-send-lock-release').at(-1));
    assert.equal(release.params.sent, true);
    await page.evaluate(() => { (window as any).fixture.state.failStart = true; });
    await page.getByRole('button', { name: '立即发送待发送消息' }).first().click();
    await page.getByRole('alert').filter({ hasText: '发送结果未知' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.endpoint === 'queued-follow-up-send-lock-release').length), 1);

    await page.locator('input[type=file]').setInputFiles([{ name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture file') }]);
    await page.getByText('fixture.txt').waitFor();
    await page.getByText('fixture.txt').click();
    await page.getByText('fixture file preview').waitFor();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/x10AAAAASUVORK5CYII=', 'base64');
    await page.locator('input[type=file]').setInputFiles([{ name: 'fixture.png', mimeType: 'image/png', buffer: png }]);
    await page.getByRole('img', { name: 'fixture.png' }).waitFor();
    await page.evaluate(() => { (window as any).fixture.state.failAdd = false; (window as any).fixture.render({busy:true}); });
    await page.getByRole('button', { name: '排队' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'thread/queue/add').length === 4);
    const localInput = await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'thread/queue/add').at(-1).params.input);
    assert.ok(localInput.some((item: any) => item.type === 'localImage' && item.path === '/fixture/fixture.png'));
    assert.ok(localInput.some((item: any) => item.type === 'text' && item.text.includes('/fixture/fixture.txt')));
    await page.evaluate(() => (window as any).fixture.render({context:{hostId:'ssh-fixture',threadId:'remote-thread'}}));
    await page.locator('input[type=file]').setInputFiles([{ name: 'remote.txt', mimeType: 'text/plain', buffer: Buffer.from('remote fixture') }]);
    await page.getByText('remote.txt').waitFor();
    await page.locator('input[type=file]').setInputFiles([{ name: 'remote.png', mimeType: 'image/png', buffer: png }]);
    await page.getByRole('img', { name: 'remote.png' }).waitFor();
    const remote = await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.host === 'ssh-fixture' && call.method?.startsWith('fs/')));
    assert.deepEqual(remote.map((call: any) => call.method), ['fs/createDirectory', 'fs/writeFile']);
    assert.match(remote[1].params.path, /^\/fixture\/codex\/attachments\/[0-9a-f-]+\/remote\.txt$/);
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => (window as any).fixture.render({context:{hostId:'ssh-fixture',threadId:'remote-thread'},busy:true}));
    await page.getByText('remote.txt').waitFor();
    await page.getByRole('img', { name: 'remote.png' }).waitFor();
    await editor.fill('remote input');
    await page.getByRole('button', { name: '排队' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.calls.some((call: any) => call.method === 'thread/queue/add'));
    const remoteInput = await page.evaluate(() => (window as any).fixture.state.calls.find((call: any) => call.method === 'thread/queue/add').params.input);
    assert.ok(remoteInput.some((item: any) => item.type === 'image' && item.url.startsWith('data:image/png;base64,')));
    assert.ok(!JSON.stringify(remoteInput).includes('/fixture/fixture.png'));
    assert.deepEqual(failures, []);
  } finally { await context.close(); await browser.close(); }
});
