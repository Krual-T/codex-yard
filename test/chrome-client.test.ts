import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { BrowserChrome } from '../src/browser-reuse/browser-bridge.ts';
import { clientEndpoint } from '../src/browser-reuse/client.ts';
import type { ChromeConnections, ClientChromeMessage } from '../src/browser-reuse/client-protocol.ts';
import type { ChromePanelState, ChromeRequest } from '../src/browser-reuse/protocol.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

const target = { conversationId: 'same-thread', browserTabId: 'same-panel' };
const keyA = 'a'.repeat(32), keyB = 'b'.repeat(32);
interface Reply { type: string; requestId?: string; responseType?: string; body?: unknown; error?: string }

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp('/tmp/aw-client-test-');
  const fake = await createFakeCodex(root);
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    ...await nativeFixture(root), dataDir: join(root, 'data'), workspace: root, hostCatalog: { hosts: [], projects: [], assignments: {} } });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  async function page() {
    const socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
    sockets.push(socket);
    const replies: Reply[] = [];
    socket.on('message', data => { replies.push(JSON.parse(String(data))); socket.emit('reply'); });
    await once(socket, 'open');
    let sequence = 0;
    async function host<T>(endpoint: string, body: unknown): Promise<T> {
      const requestId = String(++sequence);
      socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) }));
      const signal = AbortSignal.timeout(5000);
      let reply: Reply | undefined;
      while (!(reply = replies.find(item => item.type === 'fetch-response' && item.requestId === requestId))) await once(socket, 'reply', { signal });
      if (reply.responseType === 'error') throw new Error(reply.error);
      return reply.body as T;
    }
    return { socket, host, connections: (clientKey: string, operation = 'state') => host<ChromeConnections>('chrome-connections', { clientKey, operation }),
      browser: (clientKey: string, operation: ChromeRequest['operation'], value: Partial<ChromeRequest> = {}) =>
        host<ChromePanelState>('chrome-browser', { ...target, clientKey, connection: 'client', operation, ...value }) };
  }
  async function device(token: string, label: string, origin = app.url) {
    const socket = new WebSocket(clientEndpoint(app.url), { origin, headers: { Authorization: 'Bearer ' + token, 'X-Workbench-Device': label } });
    sockets.push(socket);
    const requests: Extract<ClientChromeMessage, { type: 'request' }>[] = [];
    const released: string[] = [];
    let ignore = false;
    socket.on('message', data => {
      const message = JSON.parse(String(data)) as ClientChromeMessage;
      if (message.type === 'release') released.push(message.session);
      if (message.type !== 'request') return;
      requests.push(message); socket.emit('request');
      if (!ignore) socket.send(JSON.stringify({ type: 'result', id: message.id, state: {
        location: label, configured: true, pages: [{ id: 1, url: `https://${label}.test/`, selected: true }], pageId: 1,
      } }));
    });
    await once(socket, 'open');
    return { socket, requests, released, ignore() { ignore = true; } };
  }
  return { app, page, device };
}

test('two access computers keep browser sessions private, retain pairing across page refresh and never fall back to the service Chrome', async t => {
  const f = await fixture(t), a = await f.page(), b = await f.page();
  const missing = await a.browser(keyA, 'state');
  assert.equal(missing.configured, false);
  await assert.rejects(a.browser(keyA, 'text', { pageId: 1, text: 'unpaired' }), /尚未连接/);
  const pairA = (await a.connections(keyA, 'pair')).pairing!;
  const pairB = (await b.connections(keyB, 'pair')).pairing!;
  assert.notEqual(pairA.token, pairB.token);
  const deviceA = await f.device(pairA.token, 'computer-a'), deviceB = await f.device(pairB.token, 'computer-b');
  assert.equal((await a.browser(keyA, 'state')).location, 'computer-a');
  assert.equal((await b.browser(keyB, 'state')).location, 'computer-b');
  await Promise.all([a.browser(keyA, 'text', { pageId: 1, text: '只给 A' }), b.browser(keyB, 'text', { pageId: 1, text: '只给 B' })]);
  assert.deepEqual(deviceA.requests.filter(item => item.request.operation === 'text').map(item => item.request.text), ['只给 A']);
  assert.deepEqual(deviceB.requests.filter(item => item.request.operation === 'text').map(item => item.request.text), ['只给 B']);
  await assert.rejects(a.browser(keyB, 'state'), /访问设备已变化/);
  const refreshed = await f.page();
  a.socket.close(); await once(a.socket, 'close');
  assert.equal((await refreshed.connections(keyA)).client.connected, true);
  assert.equal((await refreshed.browser(keyA, 'state')).location, 'computer-a');
  assert.notEqual(deviceA.requests[0]!.session, deviceA.requests.at(-1)!.session);
  assert.equal(deviceA.released.length, 1, 'Old page releases only its MCP session');
  const download = await fetch(f.app.url + '/chrome-client.tgz');
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/gzip');
});

test('pairing requires exact origin and a one-use token; disconnect rejects pending input without replay', async t => {
  const f = await fixture(t), page = await f.page();
  const pair = (await page.connections(keyA, 'pair')).pairing!;
  await assert.rejects(f.device(pair.token, 'wrong-origin', 'https://other.test/'));
  const device = await f.device(pair.token, 'computer-a');
  await assert.rejects(f.device(pair.token, 'replayed'), /403/);
  await page.browser(keyA, 'state');
  device.ignore();
  const input = page.browser(keyA, 'text', { pageId: 1, text: '仅尝试一次' });
  const rejected = assert.rejects(input, /连接已断开/);
  while (!device.requests.some(item => item.request.operation === 'text')) await once(device.socket, 'request', { signal: AbortSignal.timeout(5000) });
  const disconnected = await page.connections(keyA, 'disconnect');
  assert.equal(disconnected.client.connected, false);
  await rejected;
  assert.equal((await page.browser(keyA, 'state')).configured, false);
  await assert.rejects(page.browser(keyA, 'text', { pageId: 1, text: '再次输入' }), /尚未连接/);
  assert.equal(device.requests.filter(item => item.request.operation === 'text').length, 1);
  const reconnect = await f.device((await page.connections(keyA, 'pair')).pairing!.token, 'computer-new');
  await assert.rejects(page.browser(keyA, 'text', { pageId: 1, text: '旧画面' }), /连接已更换/);
  assert.equal((await page.browser(keyA, 'state')).location, 'computer-new');
  assert.equal(reconnect.requests.length, 1, 'Only the explicit read refresh reaches the newly paired browser');
});

test('changing computer clears old frames and ignores late results; companion endpoints require HTTPS or local loopback', async () => {
  let resolveOld!: (state: ChromePanelState) => void;
  const bridge = new BrowserChrome(async (endpoint, body) => {
    assert.equal(endpoint, 'chrome-browser');
    const request = body as ChromeRequest;
    assert.match(request.clientKey!, /^[a-zA-Z0-9_-]{32,80}$/);
    if (request.operation === 'release') return { location: '', configured: true, pages: [] };
    if (request.connection === 'client') return new Promise<ChromePanelState>(resolve => { resolveOld = resolve; });
    return { location: 'server', configured: true, pages: [] };
  }, () => {});
  const observed: ChromePanelState[] = [];
  bridge.subscribe(target, state => observed.push(state));
  const old = bridge.request({ ...target, operation: 'state' });
  await bridge.selectConnection(target, 'server');
  resolveOld({ location: 'old-client', configured: true, pages: [] }); await old;
  assert.equal(bridge.getState(target)?.location, 'server');
  assert.equal(observed.some(state => state.location === 'old-client'), false);
  assert.equal(clientEndpoint('https://workbench.test:8765'), 'wss://workbench.test:8765/chrome-client');
  for (const origin of ['http://192.168.1.1:8765', 'https://user:password@workbench.test', 'https://workbench.test/path']) assert.throws(() => clientEndpoint(origin));
});
