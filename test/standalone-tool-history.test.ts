import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, commandItem } from './fake-codex.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-history-');
  const fake = await createFakeCodex(root);
  fake.threads.set('caller', fixtureThread('caller', root));
  fake.threads.set('history', fixtureThread('history', root, { turns: Array.from({ length: 12 }, (_, turn) => fixtureTurn('turn-' + turn,
    Array.from({ length: 65 }, (_, item) => commandItem('item-' + item, 'private-output-' + item, root)))) }));
  const dataDir = join(root, 'data');
  const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'home'), dataDir, workspace: root, port: 0 });
  const socket = createConnection(join(dataDir, 'app-tools.sock'));
  let buffer = Buffer.alloc(0);
  const messages: Record<string, unknown>[] = [];
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const size = buffer.readUInt32LE(0);
      messages.push(JSON.parse(buffer.subarray(4, size + 4).toString()));
      buffer = buffer.subarray(size + 4); socket.emit('received');
    }
  });
  socket.on('error', () => {});
  await once(socket, 'connect');
  t.after(async () => { socket.destroy(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  function send(message: unknown) {
    const payload = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
    socket.write(Buffer.concat([header, payload]));
  }
  async function reply(id: number) {
    const signal = AbortSignal.timeout(3000);
    while (!messages.some(message => message.id === id)) await once(socket, 'received', { signal });
    return messages.find(message => message.id === id)!;
  }
  function call(id: number, args: Record<string, unknown>) {
    send({ jsonrpc: '2.0', id, method: 'tools/call', params: { callerSource: 'codex', hostId: 'local', threadId: 'caller',
      turnId: null, callId: null, namespace: 'codex_app', tool: 'read_thread', arguments: { threadId: 'history', ...args } } });
    return reply(id);
  }
  function contents(message: Record<string, unknown>) {
    const result = record(message.result); assert.equal(result.success, true, JSON.stringify(message));
    const items = result.contentItems as { text: string }[]; return record(JSON.parse(items[0]!.text));
  }
  return { fake, socket, messages, send, reply, call, contents };
}

test('actual tool pipe reads both history cursors, filters outputs and enforces one output budget per item', async t => {
  const h = await fixture(t), first = h.contents(await h.call(1, {}));
  const turns = record(first.thread).turns as Record<string, unknown>[];
  assert.equal(turns.length, 10); assert.equal(turns[0]!.id, 'turn-2'); assert.equal(turns.at(-1)!.id, 'turn-11');
  const last = turns.at(-1)!, items = last.items as Record<string, unknown>[];
  assert.equal(items.length, 60); assert.equal(items[0]!.id, 'item-5'); assert.equal(items.at(-1)!.id, 'item-64');
  assert.ok(items.every(item => !Object.hasOwn(item, 'aggregatedOutput')));
  assert.equal(last.itemsView, 'summary'); assert.equal(typeof last.itemsNextCursor, 'string');
  const itemPage = h.contents(await h.call(2, { cursor: last.itemsNextCursor, includeOutputs: true, maxOutputCharsPerItem: 4 }));
  const page = record(itemPage.itemPage), older = page.items as Record<string, unknown>[];
  assert.equal(page.turnId, 'turn-11'); assert.equal(older.length, 5); assert.equal(older[0]!.id, 'item-0');
  assert.equal(older[0]!.aggregatedOutput, 'priv'); assert.deepEqual(older[0]!.outputTruncatedFields, ['aggregatedOutput']);
  assert.equal(page.nextCursor, null);
  const before = h.contents(await h.call(3, { cursor: first.nextCursor }));
  assert.deepEqual((record(before.thread).turns as { id: string }[]).map(turn => turn.id), ['turn-0', 'turn-1']);
  assert.equal(before.nextCursor, null);
  const bad = record((await h.call(4, { threadId: 'caller', cursor: last.itemsNextCursor })).result);
  assert.equal(bad.success, false); assert.match(JSON.stringify(bad), /游标/);
  assert.equal(h.fake.calls('thread/resume').length, 0); assert.equal(h.fake.calls('turn/start').length, 0);
});

test('actual tool cancellation stops history pagination after an outstanding daemon read', async t => {
  const h = await fixture(t);
  let finish: (value: unknown) => void = () => {};
  h.fake.handlers.set('thread/turns/list', () => new Promise(resolve => { finish = resolve; }));
  const pending = h.call(20, {});
  // Do not wait for a cancelled response: tools/cancel intentionally has none.
  void pending.catch(() => {});
  await h.fake.waitForCall('thread/turns/list');
  h.send({ jsonrpc: '2.0', id: 20, method: 'tools/cancel' });
  h.send({ jsonrpc: '2.0', id: 21, method: 'tools/list' }); await h.reply(21);
  finish({ data: [{ id: 'turn-11', items: [], itemsView: 'notLoaded', status: 'completed' }], nextCursor: 'older' });
  await pause(30);
  assert.equal(h.fake.calls('thread/items/list').length, 0);
  assert.equal(h.messages.some(message => message.id === 20), false);
});
