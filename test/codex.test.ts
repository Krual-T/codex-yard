import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { Duplex, Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CodexConnection, RpcError } from '../lib/codex.ts';
import type { RpcMessage } from '../lib/codex.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';

async function fixture(t: TestContext, duplex = false) {
  const root = await mkdtemp('/tmp/aw-codex-ts-');
  const peer = await createFakeCodex(root, { perMessageDeflate: true });
  const connection = new CodexConnection(peer.socketPath, duplex ? {
    createConnection() {
      // SSH supplies an ordinary Duplex, not a net.Socket. Exercise the same
      // transport contract without connecting to or changing a remote host.
      const socket = createConnection(peer.socketPath);
      const stream = Duplex.fromWeb({ readable: Readable.toWeb(socket), writable: Writable.toWeb(socket) });
      stream.once('close', () => socket.destroy());
      return stream;
    },
  } : {});
  t.after(async () => { connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  await Promise.all([connection.connect(), connection.connect()]);
  return { peer, connection };
}

for (const duplex of [false, true]) {
  test(`RPC over ${duplex ? 'SSH-compatible Duplex' : 'Unix socket'} preserves initialization, events, cursors and replies`, async t => {
    const { peer, connection } = await fixture(t, duplex);
    assert.equal(peer.calls('initialize').length, 1);
    assert.equal(peer.calls('model/list').length, 0);
    assert.equal(connection.socket?.extensions, '', 'compression must remain disabled even when the server supports it');
    const events: RpcMessage[] = [];
    connection.on('message', message => events.push(message));
    peer.handlers.set('fixture/cursor', (_params, { message, send }) => {
      send({ method: 'fixture/before', params: { n: 1 } });
      send({ id: message.id, result: { entries: ['typed'] } });
      send({ method: 'fixture/after', params: { n: 2 } });
      return NO_REPLY;
    });
    const reply = await connection.requestWithCursor<{ entries: string[] }>('fixture/cursor', {});
    assert.deepEqual(reply, { result: { entries: ['typed'] }, eventCursor: 1 });
    if (events.length < 2) await once(connection, 'message');
    assert.deepEqual(events.map(({ method, seq }) => ({ method, seq })), [
      { method: 'fixture/before', seq: 1 }, { method: 'fixture/after', seq: 2 },
    ]);
    const incoming = once(connection, 'message');
    peer.send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture' } });
    await incoming;
    await connection.respond('approval', { decision: 'decline' });
    assert.deepEqual((await peer.waitFor(message => message.id === 'approval')).result, { decision: 'decline' });
    assert.equal(peer.calls('initialize').length, 1);
    assert.equal(connection.pending.size, 0);
  });
}

test('RPC errors preserve daemon code and data; read/write timeouts have distinct uncertainty and never retry', async t => {
  const { peer, connection } = await fixture(t);
  peer.handlers.set('fixture/error', () => { throw Object.assign(new Error('denied'), { code: -32042, data: { retry: false } }); });
  await assert.rejects(connection.request('fixture/error', {}, { mutating: true }), cause => {
    assert.ok(cause instanceof RpcError);
    assert.equal(cause.code, -32042); assert.equal(cause.status, 502);
    assert.equal(cause.message, 'denied'); assert.equal(cause.uncertain, false);
    assert.deepEqual(cause.data, { retry: false });
    return true;
  });
  peer.handlers.set('fixture/timeout', () => NO_REPLY);
  for (const mutating of [false, true]) {
    await assert.rejects(connection.request('fixture/timeout', {}, { mutating, timeoutMs: 30 }), cause => {
      assert.ok(cause instanceof RpcError);
      assert.equal(cause.code, 'TIMEOUT'); assert.equal(cause.status, 504);
      assert.equal(cause.uncertain, mutating);
      return true;
    });
  }
  assert.equal(peer.calls('fixture/timeout').length, 2);
  assert.equal(connection.pending.size, 0);
});

test('only the original live connection delivers a bounded late terminal after the waiting timeout', async t => {
  const { peer, connection } = await fixture(t);
  peer.handlers.set('fixture/late', () => NO_REPLY);
  const received: unknown[] = [];
  for (const terminal of [{ result: { written: true } }, { error: { code: -32001, message: 'denied' } }]) {
    let arrived!: () => void;
    const observed = new Promise<void>(resolve => { arrived = resolve; });
    const call = connection.request('fixture/late', {}, { mutating: true, timeoutMs: 20,
      onLateTerminal: value => { received.push(value); arrived(); } });
    const request = await peer.waitForCall('fixture/late', received.length + 1);
    await assert.rejects(call, { code: 'TIMEOUT', uncertain: true });
    assert.equal(connection.pending.size, 1);
    connection.receive(Buffer.from(JSON.stringify({ id: request!.id, error: { message: 'malformed' } })));
    assert.equal(connection.pending.size, 1);
    peer.send({ id: request!.id, ...terminal });
    await observed;
    assert.equal(connection.pending.size, 0);
  }
  assert.deepEqual(received, [{ outcome: 'success', result: { written: true } },
    { outcome: 'error', error: { code: -32001, message: 'denied', data: undefined } }]);

  const stale = connection.request('fixture/late', {}, { mutating: true, timeoutMs: 20,
    onLateTerminal: () => { throw new Error('disconnected observer must not run'); } });
  const request = await peer.waitForCall('fixture/late', 3);
  await assert.rejects(stale, { code: 'TIMEOUT' });
  peer.disconnect();
  await once(connection, 'status');
  assert.equal(connection.pending.size, 0);
  await connection.connect();
  connection.receive(Buffer.from(JSON.stringify({ id: request!.id, result: {} })));
  assert.equal(connection.pending.size, 0);
});

test('late observers are capped and observer failures cannot reject the transport', async t => {
  const { peer, connection } = await fixture(t);
  peer.handlers.set('fixture/capped', () => NO_REPLY);
  const calls = Array.from({ length: 16 }, () => connection.request('fixture/capped', {}, {
    mutating: true, timeoutMs: 40, onLateTerminal: async () => { throw new Error('observer failed'); },
  }));
  const settled = Promise.allSettled(calls);
  await assert.rejects(connection.request('fixture/capped', {}, { mutating: true, onLateTerminal: () => {} }), { code: 'OBSERVER_LIMIT', uncertain: false });
  await settled;
  assert.equal(connection.pending.size, 16);
  const first = await peer.waitForCall('fixture/capped');
  peer.send({ id: first!.id, result: {} });
  await new Promise(resolve => setImmediate(resolve));
  peer.disconnect();
  await once(connection, 'status');
  assert.equal(connection.pending.size, 0);
});

test('disconnect rejects every pending RPC, preserves write uncertainty, and never reconnects implicitly', async t => {
  const { peer, connection } = await fixture(t);
  peer.handlers.set('fixture/pending', () => NO_REPLY);
  const read = connection.request('fixture/pending', {});
  const write = connection.request('fixture/pending', {}, { mutating: true });
  const settled = Promise.allSettled([read, write]);
  await peer.waitForCall('fixture/pending', 2);
  peer.disconnect();
  const outcomes = await settled;
  for (const [index, result] of outcomes.entries()) {
    assert.equal(result.status, 'rejected');
    if (result.status !== 'rejected') continue;
    assert.ok(result.reason instanceof RpcError);
    assert.equal(result.reason.uncertain, index === 1);
  }
  assert.equal(connection.pending.size, 0);
  assert.equal(connection.connected, false);
  await assert.rejects(connection.request('fixture/after', {}), { status: 503, uncertain: false });
  assert.equal(peer.calls('initialize').length, 1);
});

test('malformed frames are ignored and closing one client leaves the daemon peer available', async t => {
  const { peer, connection } = await fixture(t);
  for (const frame of ['{', 'null', '[]', '1', '{"method":42}']) connection.receive(Buffer.from(frame));
  assert.equal(connection.eventCursor, 0);
  connection.close();
  await assert.rejects(connection.connect(), /已关闭/);
  const another = new CodexConnection(peer.socketPath);
  try { await another.connect(); assert.equal(another.connected, true); }
  finally { another.close(); }
  assert.equal(peer.calls('initialize').length, 2);
});

test('permission pagination rejects malformed profiles and stalled cursors without returning a partial catalog', async t => {
  const { peer, connection } = await fixture(t);
  peer.handlers.set('permissionProfile/list', params => params.cursor
    ? { data: [{ id: ':workspace', allowed: true }], nextCursor: null }
    : { data: [{ id: ':read-only', allowed: true }], nextCursor: 'second' });
  const choices = await connection.permissionCatalog('/tmp');
  assert.equal(choices.find(choice => choice.id === 'ask')?.allowed, true);
  assert.deepEqual(peer.calls('permissionProfile/list').map(call => call.params.cursor), [undefined, 'second']);
  for (const data of [[null], [{ id: ':workspace', allowed: 'yes' }]]) {
    peer.handlers.set('permissionProfile/list', () => ({ data, nextCursor: null }));
    await assert.rejects(connection.permissionCatalog('/tmp'), /权限配置读取失败/);
  }
  peer.handlers.set('permissionProfile/list', () => ({ data: [], nextCursor: 'stalled' }));
  await assert.rejects(connection.permissionCatalog('/tmp'), /游标没有前进/);
});
