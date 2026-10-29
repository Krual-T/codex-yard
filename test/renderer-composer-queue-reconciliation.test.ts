import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('unknown queue start survives reload and resolves only with matching history and queue absence', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneQueue } from './src/renderer/composer/standalone-queue.tsx';
    const state={queue:[{id:'queued',clientUserMessageId:'client-message',input:[{type:'text',text:'fixture',text_elements:[]}]}],history:[],calls:[],starts:0};
    const client={
      async rpc(method,params,hostId){
        state.calls.push({method,params,hostId});
        if(method==='thread/queue/list')return {data:structuredClone(state.queue),nextCursor:null};
        if(method==='thread/items/list')return {data:state.history.map(item=>({item})),nextCursor:null};
        throw Error('unexpected RPC');
      },
      async host(endpoint,params){state.calls.push({endpoint,params});if(endpoint==='queued-follow-up-send-lock-acquire')return {acquired:true};return {};},
      subscribe(){return ()=>{};}
    };
    window.fixture=state;
    createRoot(document.getElementById('root')).render(React.createElement(StandaloneQueue,{client,hostId:'ssh-fixture',threadId:'thread',busy:false,refreshVersion:0,
      captureAuthority(){return () => {};},
      async onStartQueued(){state.starts++;state.queue=[];throw Error('connection lost');}}));
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: '立即发送待发送消息' }).click();
    await page.getByRole('status').filter({ hasText: '发送结果未知' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.starts), 1);
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const send = page.getByRole('button', { name: '立即发送待发送消息' });
    await send.waitFor();
    assert.equal(await send.isDisabled(), true);
    await page.evaluate(() => { (window as any).fixture.history = [{ type: 'userMessage', clientId: 'client-message' }]; });
    await page.getByRole('button', { name: '重新核对' }).click();
    await page.getByRole('status').filter({ hasText: '发送结果未知' }).waitFor();
    assert.equal(await send.isDisabled(), true);
    await page.evaluate(() => { (window as any).fixture.queue = []; });
    await page.getByRole('button', { name: '重新核对' }).click();
    await page.getByRole('status').filter({ hasText: '发送结果未知' }).waitFor({ state: 'detached' });
    const calls = await page.evaluate(() => (window as any).fixture.calls);
    assert.equal(await page.evaluate(() => (window as any).fixture.starts), 0);
    const release = calls.find((call: any) => call.endpoint === 'queued-follow-up-send-lock-release');
    assert.equal(release.params.hostId, 'ssh-fixture');
    assert.equal(release.params.sent, true);
  } finally { await context.close(); await browser.close(); }
});
