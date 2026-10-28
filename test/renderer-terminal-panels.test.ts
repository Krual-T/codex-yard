import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { nativeFixture } from './native-fixture.ts';

test('terminal panels use the page-owned host session and never replay input after disconnect', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-terminal-panel-');
  await writeFile(join(root, 'notes.txt'), 'visible file');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  t.after(async () => {
    await context?.close();
    await browser?.close();
    await app?.close();
    await fake.close();
    await rm(root, { recursive: true, force: true });
  });
  const fileRpc = fileDaemonFixture();
  for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, record(params)));
  let shellHandle = '';
  fake.handlers.set('process/spawn', (params, peer) => {
    const handle = String(params.processHandle);
    if (!params.tty) {
      for (const processHandle of [handle, shellHandle]) peer.send({ method: 'process/exited', params: { processHandle, exitCode: 0 } });
      return {};
    }
    shellHandle = handle;
    peer.send({ method: 'process/outputDelta', params: { processHandle: handle, stream: 'stdout',
      deltaBase64: Buffer.from(`\x1e${handle}\x1f/bin/bash\x1f1234\x1f\u001b[31mREADY\u001b[0m\r\n`).toString('base64') } });
    return {};
  });
  fake.handlers.set('process/writeStdin', (params, peer) => {
    peer.send({ method: 'process/outputDelta', params: { ...params, stream: 'stdout' } });
    return {};
  });
  fake.handlers.set('process/resizePty', () => ({}));
  fake.handlers.set('process/kill', (params, peer) => {
    peer.send({ method: 'process/exited', params: { processHandle: params.processHandle, exitCode: 137 } });
    return {};
  });
  const { renderer, adapterPath } = await nativeFixture(root);
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
      import { TerminalPanel } from './src/renderer/terminal/TerminalPanel.tsx';
      const state = { calls: [], events: [], failClose: false, delayClose: false, releaseClose: null }, listeners = new Set(), pending = new Map();
      let socket, opened, seq = 0;
      function connect() {
        const next = new WebSocket(location.origin.replace('http', 'ws') + '/native-host');
        socket = next;
        opened = new Promise((resolve, reject) => { next.onopen = resolve; next.onerror = reject; });
        next.onmessage = ({data}) => {
          const message = JSON.parse(data);
          if (message.type === 'fetch-response' && pending.has(message.requestId)) {
            const item = pending.get(message.requestId); pending.delete(message.requestId);
            if (message.responseType === 'success') item.resolve(message.body); else item.reject(new Error(message.error));
          } else { state.events.push(message); for (const listener of listeners) listener(message); }
        };
        next.onclose = () => {
          for (const item of pending.values()) item.reject(new Error('disconnected'));
          pending.clear();
          for (const listener of listeners) listener({type:'connection-state',state:'disconnected'});
        };
        return opened;
      }
      void connect();
      const client = {
        async host(endpoint, params = {}) {
          state.calls.push({endpoint, params: structuredClone(params)}); await opened;
          if (endpoint === 'terminal' && params.operation === 'close' && state.failClose) throw new Error('fixture close failure');
          if (endpoint === 'terminal' && params.operation === 'close' && state.delayClose) await new Promise(resolve => { state.releaseClose = resolve; });
          const id = 'host-' + ++seq;
          return new Promise((resolve, reject) => { pending.set(id, {resolve,reject});
            socket.send(JSON.stringify({type:'fetch',requestId:id,url:'vscode://codex/' + endpoint,body:JSON.stringify(params)})); });
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async rpc() { throw new Error('unexpected RPC'); }, async reply() { throw new Error('unexpected reply'); },
      };
      const root = createRoot(document.getElementById('root'));
      let props = {client,scopeId:'thread-a',hostId:'local',cwd:${JSON.stringify(root)},appearance:{theme:'dark',codeFontSize:13,codeLineHeight:20},
        request:{id:'one',scopeId:'thread-a',hostId:'local',cwd:${JSON.stringify(root)},kind:'terminal'},onRequestConsumed:()=>{},onClose:()=>{}};
      window.fixture = { state, disconnect() { socket.close(); }, reconnect: connect,
        render(changes) { const next = {...props,...changes};
          if (changes.request) next.request = {scopeId:next.scopeId,hostId:next.hostId,cwd:next.cwd,...changes.request};
          props = next; root.render(React.createElement(WorkspacePanels,props)); },
        async existing(id) { await client.host('terminal',{operation:'create',args:[{sessionId:id,hostId:'local',cwd:${JSON.stringify(root)}}]}); },
        attach(id) { root.render(React.createElement(TerminalPanel,{client,hostId:'local',cwd:${JSON.stringify(root)},sessionId:id})); },
        unmount() { root.unmount(); },
      };
      window.fixture.render({});
    ` },
    bundle: true, write: false, format: 'iife', outdir: 'fixture-output', loader: { '.css': 'css' },
  });
  await writeFile(join(renderer, 'fixture.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text);
  await writeFile(join(renderer, 'fixture.css'), `html,body,#root{height:100%;margin:0}\n${bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text}`);
  await writeFile(join(renderer, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data'), workspace: root,
    renderer, adapterPath, port: 0 });
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  context = await browser.newContext({ viewport: { width: 1000, height: 650 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // The production root serves the owned App; this test serves its own HTML.
  await page.goto(app.url + '/index.html');
  await page.getByRole('tab', { name: 'Terminal' }).waitFor();
  await page.locator('.xterm-rows').getByText('READY').waitFor();
  const screenshotDir = process.env.AGENTS_PANEL_SCREENSHOTS;
  if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'terminal.png') }); }
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 1);
  assert.ok(await page.locator('.xterm-rows span').evaluateAll(spans => spans.some(span => span.textContent?.includes('READY') && getComputedStyle(span).color !== 'rgb(229, 232, 232)')));
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('abc');
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('abc'));
  const inputs = () => fake.calls('process/writeStdin').map(call => Buffer.from(String(call.params.deltaBase64), 'base64').toString()).join('');
  assert.equal(inputs(), 'abc');
  await page.evaluate(() => (window as any).fixture.render({appearance:{theme:'light',codeFontSize:18,codeLineHeight:27},request:null}));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.yard-terminal-screen')!).backgroundColor === 'rgb(255, 255, 255)');
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 1);
  await page.evaluate(() => (window as any).fixture.render({scopeId:'draft-b',request:null}));
  assert.equal(await page.getByRole('tab', { name: 'Terminal' }).count(), 0);
  await page.evaluate(() => (window as any).fixture.render({scopeId:'thread-a',request:null}));
  await page.locator('.xterm-rows').getByText('READY').waitFor();
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 1);
  await page.evaluate(() => (window as any).fixture.render({request:{id:'file',kind:'file',path:'notes.txt'}}));
  await page.getByRole('textbox', { name: `File: ${join(root, 'notes.txt')}` }).waitFor();
  await page.getByRole('tab', { name: 'Terminal' }).click();
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 1);
  assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.params.operation === 'close').length), 0);
  const previousSize = fake.calls('process/resizePty').length;
  await page.setViewportSize({ width: 720, height: 460 });
  await page.waitForFunction(previous => (window as any).fixture.state.calls.filter((call: any) => call.params.operation === 'resize').length > previous, previousSize);
  assert.ok(fake.calls('process/resizePty').length > previousSize);
  await page.evaluate(() => (window as any).fixture.disconnect());
  await page.getByRole('status').filter({ hasText: 'Connection lost' }).waitFor();
  await page.keyboard.type('discard');
  await page.evaluate(() => (window as any).fixture.reconnect());
  await page.getByRole('button', { name: 'New terminal' }).click();
  await page.locator('.xterm-rows').getByText('READY').waitFor();
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 2);
  assert.equal(inputs(), 'abc');
  await page.evaluate(() => { (window as any).fixture.state.delayClose = true; });
  await page.getByRole('button', { name: 'Close terminal' }).click();
  await page.waitForFunction(() => Boolean((window as any).fixture.state.releaseClose));
  await page.evaluate(() => (window as any).fixture.render({scopeId:'draft-b',request:{id:'new-in-b',kind:'terminal'}}));
  assert.equal(await page.getByRole('tab', { name: 'Terminal' }).count(), 0);
  await page.evaluate(() => { (window as any).fixture.state.delayClose = false; (window as any).fixture.state.releaseClose(); });
  await page.getByRole('tab', { name: 'Terminal' }).waitFor();
  await page.locator('.xterm-rows').getByText('READY').waitFor();
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 3);
  await page.evaluate(() => (window as any).fixture.render({scopeId:'thread-a',request:null}));
  assert.equal(await page.getByRole('tab', { name: 'Terminal' }).count(), 0);
  await page.evaluate(() => (window as any).fixture.render({scopeId:'draft-b',request:null}));
  await page.getByRole('tab', { name: 'Terminal' }).waitFor();
  await page.evaluate(() => { (window as any).fixture.state.failClose = true; });
  await page.getByRole('button', { name: 'Close terminal' }).click();
  await page.getByRole('status').filter({ hasText: 'Terminal close failed' }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Terminal' }).count(), 1);
  await page.evaluate(() => { (window as any).fixture.state.failClose = false; });
  await page.getByRole('button', { name: 'Close terminal' }).click();
  await page.waitForFunction(() => (window as any).fixture.state.calls.some((call: any) => call.params.operation === 'close'));

  await page.evaluate(() => (window as any).fixture.existing('existing-session'));
  const countBeforeAttach = fake.calls('process/spawn').filter(call => call.params.tty).length;
  await page.evaluate(() => (window as any).fixture.attach('existing-session'));
  await page.locator('.xterm-rows').getByText('READY').waitFor();
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, countBeforeAttach);
  assert.ok(await page.evaluate(() => (window as any).fixture.state.calls.some((call: any) => call.params.operation === 'attachExisting')));
  await page.evaluate(() => (window as any).fixture.unmount());
  assert.deepEqual(errors, []);
});
