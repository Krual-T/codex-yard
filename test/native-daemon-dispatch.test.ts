import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;
function gate() {
  let release!: () => void;
  return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-daemon-');
  const peer = await createFakeCodex(root), resources = await nativeFixture(root);
  const app = await createNativeWorkbench({ port: 0, socketPath: peer.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, ...resources, hostCatalog: { hosts: [], projects: [], assignments: {} } });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await app.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  const thread = fixtureThread('thread', root, { turns: [fixtureTurn('source', [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'original' }] },
  ])] });
  peer.threads.set(thread.id, thread); peer.loaded.add(thread.id);
  async function page() {
    const socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url }); sockets.push(socket);
    const messages: Message[] = [];
    socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
    await once(socket, 'open');
    async function until(predicate: (message: Message) => boolean, from = 0) {
      const signal = AbortSignal.timeout(5000);
      while (!messages.slice(from).some(predicate)) await once(socket, 'received', { signal });
      return messages.slice(from).find(predicate)!;
    }
    let nextId = 0;
    const rpc = async (method: string, params: Message, generation?: unknown) => {
      const id = ++nextId;
      socket.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params },
        ...(generation === undefined ? {} : { daemonConnectionGeneration: generation }) }));
      return (await until(message => message.type === 'mcp-response' && message.message.id === id)).message;
    };
    const host = async (endpoint: string, body: Message) => {
      const requestId = 'host-' + ++nextId;
      socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) }));
      return until(message => message.type === 'fetch-response' && message.requestId === requestId);
    };
    socket.send(JSON.stringify({ type: 'ready' }));
    const connected = await until(message => message.type === 'codex-app-server-connection-changed' && message.state === 'connected');
    assert.equal(typeof connected.daemonConnectionGeneration, 'string');
    return { socket, messages, until, rpc, host, generation: connected.daemonConnectionGeneration as string };
  }
  return { root, peer, thread, page };
}
const edit = (generation: string) => ({ hostId: 'local', threadId: 'thread', daemonConnectionGeneration: generation,
  origin: { hostId: 'local', threadId: 'thread', turnId: 'source', itemId: 'user' }, expectedTurnIds: ['source'],
  clientUserMessageId: 'original-edit', operation: 'submit', turnParams: { input: [{ type: 'text', text: 'edited' }] } });

test('native dispatch binds tokens to each actual page daemon and preserves known-unsent errors', async t => {
  const f = await fixture(t), a = await f.page(), b = await f.page();
  assert.notEqual(a.generation, b.generation);
  const denied = await b.rpc('turn/start', { threadId: 'thread', input: [] }, a.generation);
  assert.equal(denied.error.data.sendPhase, 'before-send'); assert.equal(denied.error.data.uncertain, false);
  assert.equal(f.peer.calls('turn/start').length, 0);
  const unbound = await b.host('message-edit', { ...edit(b.generation), daemonConnectionGeneration: undefined });
  assert.equal(unbound.body.stage, 'prepared'); assert.equal(f.peer.calls('thread/revert').length, 0);
  const accepted = await b.host('message-edit', edit(b.generation));
  assert.equal(accepted.body.stage, 'started');
  assert.equal(f.peer.calls('thread/revert').length, 1); assert.equal(f.peer.calls('turn/start').length, 1);
});

test('a queued edit never borrows the replacement daemon socket', async t => {
  const f = await fixture(t), a = await f.page(), b = await f.page();
  let originalSocket!: WebSocket;
  f.peer.handlers.set('thread/read', (params, context) => {
    originalSocket = context.socket;
    return f.peer.defaultResult('thread/read', params);
  });
  await b.rpc('thread/read', { threadId: 'thread', includeTurns: false });
  const blocker = gate(), entered = gate();
  f.peer.handlers.set('turn/start', async () => { entered.release(); await blocker.wait; return { turn: fixtureTurn('blocker') }; });
  const pending = a.rpc('turn/start', { threadId: 'thread', input: [] }, a.generation);
  await entered.wait;
  const queued = b.host('message-edit', edit(b.generation));
  await b.host('locale-info', {}); // The same page has entered its queued host operation.
  const from = b.messages.length;
  originalSocket.terminate();
  await b.until(message => message.type === 'codex-app-server-connection-changed' && message.state === 'disconnected', from);
  await b.rpc('thread/read', { threadId: 'thread', includeTurns: false });
  const reconnected = await b.until(message => message.type === 'codex-app-server-connection-changed' && message.state === 'connected', from);
  assert.notEqual(reconnected.daemonConnectionGeneration, b.generation);
  blocker.release(); await pending;
  const result = await queued;
  assert.equal(result.body.stage, 'prepared'); assert.equal(f.peer.calls('thread/revert').length, 0);
  assert.equal(f.peer.calls('turn/start').length, 1);
  const stale = await b.rpc('turn/start', { threadId: 'thread', input: [] }, b.generation);
  assert.equal(stale.error.data.sendPhase, 'before-send'); assert.equal(f.peer.calls('turn/start').length, 1);
});

test('a bound ordinary send queued before reconnect is rejected at actual dispatch', async t => {
  const f = await fixture(t), a = await f.page(), b = await f.page();
  let originalSocket!: WebSocket;
  f.peer.handlers.set('thread/read', (params, context) => { originalSocket = context.socket; return f.peer.defaultResult('thread/read', params); });
  await b.rpc('thread/read', { threadId: 'thread', includeTurns: false });
  const blocker = gate(), entered = gate();
  f.peer.handlers.set('turn/start', async () => { entered.release(); await blocker.wait; return { turn: fixtureTurn('first') }; });
  const first = a.rpc('turn/start', { threadId: 'thread', input: [] }, a.generation); await entered.wait;
  const queued = b.rpc('turn/start', { threadId: 'thread', input: [] }, b.generation);
  await b.host('locale-info', {});
  const from = b.messages.length; originalSocket.terminate();
  await b.until(message => message.type === 'codex-app-server-connection-changed' && message.state === 'disconnected', from);
  await b.rpc('thread/read', { threadId: 'thread', includeTurns: false });
  blocker.release(); await first;
  const result = await queued;
  assert.equal(result.error.data.sendPhase, 'before-send'); assert.equal(result.error.data.uncertain, false);
  assert.equal(f.peer.calls('turn/start').length, 1);
});
