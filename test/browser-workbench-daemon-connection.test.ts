import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { BrowserWorkbenchClient, WorkbenchError } from '../src/renderer/app/client.ts';

interface SentMessage {
  type: string;
  hostId?: string;
  requestId?: string;
  body?: string;
  daemonConnectionGeneration?: string;
  request?: { id: string; method: string; params: Record<string, unknown> };
}

function fixture(t: TestContext) {
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent: SentMessage[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onSend?: (message: SentMessage) => void;
    constructor(_url: string) { sockets.push(this); }
    open() { this.readyState = Socket.OPEN; this.onopen?.(); }
    send(value: string) { const message = JSON.parse(value) as SentMessage; this.sent.push(message); this.onSend?.(message); }
    message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    host(hostId: string, state: string, generation?: string) {
      this.message({ type: 'codex-app-server-connection-changed', transport: 'websocket', hostId, state,
        ...(generation === undefined ? {} : { daemonConnectionGeneration: generation }) });
    }
    close() { if (this.readyState !== 3) { this.readyState = 3; this.onclose?.(); } }
    error() { this.onerror?.(); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: Socket });
  const client = new BrowserWorkbenchClient('ws://fixture.invalid/native-host');
  t.after(() => {
    client.close();
    if (previous) Object.defineProperty(globalThis, 'WebSocket', previous);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
  });
  return { client, sockets };
}

const beforeSend = (error: unknown) => error instanceof WorkbenchError && !error.uncertain && error.sendPhase === 'before-send';

test('host events update the original binding before subscribers, with host isolation and no token ABA', async t => {
  const { client, sockets } = fixture(t);
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
  assert.equal(sockets.length, 0, 'capture never opens a connection');
  const opening = client.connect();
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
  const socket = sockets[0]!; socket.open(); await opening;
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend, 'an open browser bridge is not a host token');

  let old: ReturnType<typeof client.captureDaemonConnection> | undefined;
  let observed = 0;
  client.subscribe(event => {
    if (event.type !== 'codex-app-server-connection-changed' || event.hostId !== 'local') return;
    observed++;
    if (event.state === 'connected' && typeof event.daemonConnectionGeneration === 'string' && event.daemonConnectionGeneration) {
      assert.equal(client.captureDaemonConnection('local').generation, event.daemonConnectionGeneration);
      if (old && event.daemonConnectionGeneration !== old.generation) assert.throws(old.assertOriginal, beforeSend);
    } else {
      assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
      if (old) assert.throws(old.assertOriginal, beforeSend);
    }
  });
  socket.host('local', 'connected', 'same');
  old = client.captureDaemonConnection('local');
  socket.host('remote', 'connected', 'remote-one');
  const remote = client.captureDaemonConnection('remote');
  socket.host('local', 'connected', 'same');
  old.assertOriginal();
  socket.host('local', 'connected', 'next');
  remote.assertOriginal();
  socket.host('local', 'connected', 'same');
  assert.throws(old.assertOriginal, beforeSend, 'a token changed away and back must not revive its first capture');
  old = client.captureDaemonConnection('local');
  socket.host('local', 'disconnected');
  socket.host('local', 'connected', 'same');
  assert.throws(old.assertOriginal, beforeSend, 'an offline interval revokes the earlier capture even if the token repeats');
  old = client.captureDaemonConnection('local');
  socket.host('local', 'connected');
  socket.host('local', 'connected', 'same');
  assert.throws(old.assertOriginal, beforeSend, 'a missing token revokes the earlier capture');
  old = client.captureDaemonConnection('local');
  socket.host('local', 'connected', '');
  remote.assertOriginal();
  assert.equal(observed, 9);
});

test('closing, replacement, errors, suspend and stop revoke the original browser socket', async t => {
  const { client, sockets } = fixture(t);
  const opening = client.connect(); const first = sockets[0]!; first.open(); await opening;
  first.host('local', 'connected', 'token');
  const original = client.captureDaemonConnection('local');
  let sawDisconnected = false, hostEvents = 0;
  client.subscribe(event => {
    if (event.type === 'codex-app-server-connection-changed') hostEvents++;
    if (event.type === 'connection-state' && event.state === 'disconnected') {
      sawDisconnected = true;
      assert.throws(original.assertOriginal, beforeSend);
      assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
    }
  });
  first.close();
  assert.equal(sawDisconnected, true);
  const reconnecting = client.connect(); const second = sockets[1]!; second.open(); await reconnecting;
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
  second.host('local', 'connected', 'token');
  const reconnected = client.captureDaemonConnection('local');
  assert.throws(original.assertOriginal, beforeSend);
  first.host('local', 'connected', 'stale');
  first.error();
  reconnected.assertOriginal();
  second.error();
  assert.throws(reconnected.assertOriginal, beforeSend);
  const eventsBeforeLate = hostEvents;
  second.host('local', 'connected', 'token');
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend, 'a late host event cannot authorize a failed browser socket');
  assert.equal(hostEvents, eventsBeforeLate, 'a failed bridge cannot publish an obsolete connected event');
  assert.throws(reconnected.assertOriginal, beforeSend);
  second.close();
  const afterFailure = client.connect(); const third = sockets[2]!; third.open(); await afterFailure;
  third.host('local', 'connected', 'token');
  const afterError = client.captureDaemonConnection('local');
  client.suspend();
  assert.throws(afterError.assertOriginal, beforeSend);
  const resuming = client.resume(); const fourth = sockets[3]!; fourth.open(); await resuming;
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
  fourth.host('local', 'connected', 'token');
  const resumed = client.captureDaemonConnection('local');
  fourth.readyState = 3;
  const replacing = client.connect(); const fifth = sockets[4]!; fifth.open(); await replacing;
  assert.throws(resumed.assertOriginal, beforeSend);
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
  fourth.host('local', 'connected', 'stale');
  fifth.host('local', 'connected', 'token');
  const replacement = client.captureDaemonConnection('local');
  client.close();
  assert.throws(replacement.assertOriginal, beforeSend);
  assert.throws(() => client.captureDaemonConnection('local'), beforeSend);
  await assert.rejects(client.connect());
});

test('RPC transmits only the explicit original token and checks its authority at the original socket send', async t => {
  const { client, sockets } = fixture(t);
  const opening = client.connect(); const socket = sockets[0]!; socket.open(); await opening;
  const ordinary = client.rpc('thread/read', { threadId: 'fixture' }, 'local');
  await Promise.resolve();
  const read = socket.sent.at(-1)!;
  assert.equal(read.request?.method, 'thread/read');
  assert.equal(Object.hasOwn(read, 'daemonConnectionGeneration'), false);
  socket.message({ type: 'mcp-response', message: { id: read.request!.id, result: 'read' } });
  assert.equal(await ordinary, 'read');

  const explicit = client.rpc('thread/read', {}, 'remote', { daemonConnectionGeneration: 'explicit-original' });
  await Promise.resolve();
  const forwarded = socket.sent.at(-1)!;
  assert.equal(forwarded.daemonConnectionGeneration, 'explicit-original', 'no current projection is substituted or required');
  assert.equal(forwarded.hostId, 'remote');
  socket.message({ type: 'mcp-response', message: { id: forwarded.request!.id, result: 'forwarded' } });
  assert.equal(await explicit, 'forwarded');

  socket.host('local', 'connected', 'first');
  const first = client.captureDaemonConnection('local');
  const order: string[] = [];
  socket.onSend = message => { if (message.request?.method === 'turn/start') order.push('send'); };
  const stale = client.rpc('turn/start', { threadId: 'fixture' }, 'local', {
    daemonConnectionGeneration: first.generation,
    assertBeforeSend: () => { order.push('check'); first.assertOriginal(); },
  });
  assert.deepEqual(order, ['check']);
  socket.host('local', 'connected', 'second');
  await assert.rejects(stale, beforeSend);
  assert.deepEqual(order, ['check', 'check']);
  assert.equal(socket.sent.some(message => message.request?.method === 'turn/start'), false);

  const current = client.captureDaemonConnection('local');
  order.length = 0;
  const sent = client.rpc('turn/start', { threadId: 'fixture' }, 'local', {
    daemonConnectionGeneration: current.generation,
    assertBeforeSend: () => { order.push('check'); current.assertOriginal(); },
  });
  await Promise.resolve();
  assert.deepEqual(order, ['check', 'check', 'send']);
  const request = socket.sent.at(-1)!;
  assert.equal(request.daemonConnectionGeneration, 'second');
  assert.equal(request.request?.method, 'turn/start');
  socket.message({ type: 'mcp-response', message: { id: request.request!.id, result: 'started' } });
  assert.equal(await sent, 'started');

  const editing = client.host('message-edit', { hostId: 'local', threadId: 'fixture', daemonConnectionGeneration: current.generation },
    { assertBeforeSend: current.assertOriginal });
  await Promise.resolve();
  const edit = socket.sent.at(-1)!;
  assert.equal(edit.type, 'fetch');
  assert.equal(Object.hasOwn(edit, 'daemonConnectionGeneration'), false);
  assert.equal(JSON.parse(edit.body!).daemonConnectionGeneration, 'second', 'message-edit keeps its original token in the host body');
  socket.message({ type: 'fetch-response', requestId: edit.requestId, responseType: 'success', body: 'prepared' });
  assert.equal(await editing, 'prepared');

  const lost = client.rpc('turn/start', {}, 'local', { daemonConnectionGeneration: current.generation, assertBeforeSend: current.assertOriginal });
  const rejected = assert.rejects(lost, beforeSend);
  socket.close();
  const reconnecting = client.connect(); const replacement = sockets[1]!; replacement.open(); await reconnecting;
  replacement.host('local', 'connected', 'second');
  await rejected;
  assert.equal(replacement.sent.some(message => message.request?.method === 'turn/start'), false);
});
