import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';

test('Mini confirms the host state before toggling and discards old connection results', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { BrowserWorkbenchClient } from './src/renderer/app/client.ts';
    import { StandaloneMini } from './src/renderer/mini/index.tsx';
    const client = new BrowserWorkbenchClient(), root = createRoot(document.getElementById('root'));
    let bridge = 'connecting', held = false, rejectHeld, oldSocket;
    const events = [];
    const send = async message => {
      await client.connect();
      client.socket.send(JSON.stringify(message));
      if (held && message.type === 'avatar-overlay-open-state-request') {
        held = false;
        await new Promise((resolve, reject) => { rejectHeld = reject; });
      }
    };
    function render() { root.render(React.createElement(StandaloneMini, {
      client, send, activities: [], bridgeState: bridge,
      hostConnections: { local: { state: 'connected', fresh: true, revision: 'fixture' } },
      pendingRequests: [], onOpenThread() {}, onOpenRequest() {}, onExpand() {},
      onRespond: async () => {}, onInputDraftChange() {}, onBeforeQuickChatClose: async () => true,
    })); }
    client.subscribe(event => {
      events.push(event);
      if (event.type === 'connection-state') { bridge = event.state; render(); }
    });
    window.miniConfirmationHarness = {
      events, holdReadSend() { held = true; }, rejectOldSend() { rejectHeld?.(Error('old send failed')); },
      suspend() { oldSocket = client.socket; client.suspend(); },
      resume() { return client.resume(); },
      oldState(isOpen) { oldSocket?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
        type: 'workbench-pet-state', state: { isOpen, visibility: 'always-visible', position: null },
      }) })); },
      close() { client.close(); root.unmount(); },
    };
    render(); void client.connect();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const server = createServer((_request, response) => response.end('<div id="root"></div>'));
  const webSockets = new WebSocketServer({ server });
  const messages: any[] = [], reads: WebSocket[] = [];
  let socket: WebSocket | undefined, isOpen = false, holdReads = false, writes = 0;
  const emit = (target: WebSocket, value: unknown) => target.send(JSON.stringify(value));
  const publish = (target: WebSocket, value = isOpen) => {
    emit(target, { type: 'avatar-overlay-open-state-changed', isOpen: value });
    emit(target, { type: 'workbench-pet-state', state: { isOpen: value, visibility: 'always-visible', position: null } });
  };
  webSockets.on('connection', connection => {
    socket = connection;
    connection.on('message', bytes => {
      const message = JSON.parse(String(bytes));
      messages.push(message);
      if (message.type === 'avatar-overlay-open-state-request') {
        reads.push(connection);
        if (!holdReads) publish(connection);
      } else if (message.type === 'avatar-overlay-open') {
        if (message.isOpen === isOpen) { isOpen = !isOpen; writes++; }
        publish(connection);
      } else if (message.type === 'avatar-overlay-close' || message.type === 'avatar-overlay-hide') {
        isOpen = false; writes++; publish(connection);
      } else if (message.type === 'fetch') {
        const endpoint = String(message.url).split('/').at(-1);
        const body = endpoint === 'get-settings' ? { values: {} } : { avatars: [] };
        emit(connection, { type: 'fetch-response', requestId: message.requestId, responseType: 'success', body });
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => webSockets.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve())); });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const wait = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the controlled Mini host');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const shortcut = () => page.keyboard.press('Meta+Alt+p');
  const toggles = () => messages.filter(message => message.type === 'avatar-overlay-open');
  await wait(() => reads.length > 0);
  await page.waitForFunction(() => (window as any).miniConfirmationHarness.events.some((event: any) => event.type === 'workbench-pet-state'));

  isOpen = true;
  await shortcut();
  await wait(() => toggles().length === 1);
  assert.deepEqual(toggles()[0], { type: 'avatar-overlay-open', isOpen: false });
  assert.equal(writes, 0, 'a stale observed value only returns current state');
  await page.getByRole('button', { name: 'Mini menu' }).waitFor();
  await shortcut();
  await wait(() => writes === 1);
  assert.equal(messages.filter(message => message.type === 'avatar-overlay-close').length, 1);
  await page.getByRole('button', { name: 'Mini menu' }).waitFor({ state: 'hidden' });
  await shortcut();
  await wait(() => writes === 2);
  await page.getByRole('button', { name: 'Mini menu' }).waitFor();

  holdReads = true;
  const priorReads = reads.length, priorToggles = toggles().length;
  emit(socket!, { type: 'workbench-pet-error', error: 'fixture uncertain', stateUnconfirmed: true });
  await page.getByRole('alert').filter({ hasText: 'fixture uncertain' }).waitFor();
  await wait(() => reads.length > priorReads);
  await shortcut();
  await wait(() => reads.length > priorReads + 1);
  assert.equal(toggles().length, priorToggles);
  assert.equal(await page.getByRole('button', { name: 'Mini menu' }).isVisible(), true,
    'the last panel stays inspectable while its state is marked unconfirmed');
  await page.getByRole('alert').filter({ hasText: 'Mini state is unconfirmed' }).waitFor();
  emit(socket!, { type: 'workbench-pet-error', error: 'fixture read failed', stateUnconfirmed: true });
  await page.getByRole('alert').filter({ hasText: 'fixture read failed' }).waitFor();
  const failedReads = reads.length;
  const observedBeforeLate = await page.evaluate(() => (window as any).miniConfirmationHarness.events.length);
  publish(socket!, false);
  await page.waitForFunction((before: number) => (window as any).miniConfirmationHarness.events.length >= before + 2, observedBeforeLate);
  await shortcut();
  await wait(() => reads.length > failedReads);
  assert.equal(toggles().length, priorToggles, 'a late state from the failed read did not grant permission');
  publish(socket!);
  await page.getByRole('alert').filter({ hasText: 'fixture read failed' }).waitFor({ state: 'hidden' });
  assert.equal(writes, 2, 'state recovery never replays the earlier action');

  await page.evaluate(() => (window as any).miniConfirmationHarness.holdReadSend());
  holdReads = false;
  emit(socket!, { type: 'workbench-pet-error', error: 'refresh state', stateUnconfirmed: true });
  await page.waitForFunction(() => (window as any).miniConfirmationHarness.events.some((event: any) => event.type === 'workbench-pet-error' && event.error === 'refresh state'));
  await page.getByRole('alert').filter({ hasText: 'refresh state' }).waitFor({ state: 'hidden' });
  await page.evaluate(() => (window as any).miniConfirmationHarness.rejectOldSend());
  await shortcut();
  await wait(() => writes === 3);
  assert.equal(messages.filter(message => message.type === 'avatar-overlay-close').length, 2,
    'a late failure from an earlier read cannot revoke the newer confirmation');

  await page.getByRole('button', { name: 'Mini menu' }).waitFor({ state: 'hidden' });
  holdReads = true;
  const beforeSimpleRead = reads.length;
  emit(socket!, { type: 'workbench-pet-error', error: 'check open only', stateUnconfirmed: true });
  await wait(() => reads.length > beforeSimpleRead);
  const beforeSimpleEvent = await page.evaluate(() => (window as any).miniConfirmationHarness.events.length);
  emit(socket!, { type: 'avatar-overlay-open-state-changed', isOpen: false });
  await page.waitForFunction((before: number) => (window as any).miniConfirmationHarness.events.length > before, beforeSimpleEvent);
  await shortcut();
  await wait(() => writes === 4);
  assert.deepEqual(toggles().at(-1), { type: 'avatar-overlay-open', isOpen: false },
    'the existing boolean state event can confirm the observed value');
  await page.getByRole('button', { name: 'Mini menu' }).waitFor();

  const beforeBooleanClose = reads.length;
  emit(socket!, { type: 'workbench-pet-error', error: 'check closed state', stateUnconfirmed: true });
  await wait(() => reads.length > beforeBooleanClose);
  isOpen = false;
  emit(socket!, { type: 'avatar-overlay-open-state-changed', isOpen: false });
  await page.getByRole('button', { name: 'Mini menu' }).waitFor({ state: 'hidden' });
  assert.equal(writes, 4, 'a boolean state event updates the stale panel without issuing a write');
  isOpen = true;
  publish(socket!);
  await page.getByRole('button', { name: 'Mini menu' }).waitFor();

  await page.evaluate(() => (window as any).miniConfirmationHarness.suspend());
  await page.getByRole('alert').filter({ hasText: 'connection is unavailable' }).waitFor();
  await page.evaluate(() => (window as any).miniConfirmationHarness.resume());
  await page.evaluate(() => (window as any).miniConfirmationHarness.oldState(false));
  const reconnectReads = reads.length, reconnectToggles = toggles().length;
  await shortcut();
  await wait(() => reads.length > reconnectReads);
  assert.equal(toggles().length, reconnectToggles, 'an old socket cannot confirm the reconnected page');
  publish(socket!);
  await page.getByRole('alert').filter({ hasText: 'connection is unavailable' }).waitFor({ state: 'hidden' });
  assert.equal(writes, 4);

  const confirmedReads = reads.length, confirmedToggles = toggles().length;
  await page.evaluate(() => (window as any).miniConfirmationHarness.holdReadSend());
  emit(socket!, { type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected' });
  await wait(() => reads.length > confirmedReads);
  await page.evaluate(() => (window as any).miniConfirmationHarness.rejectOldSend());
  await page.getByRole('alert').filter({ hasText: 'Mini state could not be confirmed' }).waitFor();
  const failedRefreshReads = reads.length;
  await shortcut();
  await wait(() => reads.length > failedRefreshReads);
  assert.equal(toggles().length, confirmedToggles, 'a failed refresh revokes the previously confirmed value');
  publish(socket!);
  await page.getByRole('alert').filter({ hasText: 'Mini state could not be confirmed' }).waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await page.evaluate(() => (window as any).miniConfirmationHarness.close());
  await context.close();
});
