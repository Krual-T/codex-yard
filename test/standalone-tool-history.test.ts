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
  let nextCall = 0;
  function call(id: number, args: Record<string, unknown>) {
    send({ jsonrpc: '2.0', id, method: 'tools/call', params: { callerSource: 'codex', hostId: 'local', threadId: 'caller',
      turnId: null, callId: 'fixture-call-' + ++nextCall, namespace: 'codex_app', tool: 'read_thread', arguments: { threadId: 'history', ...args } } });
    return reply(id);
  }
  function contents(message: Record<string, unknown>) {
    const result = record(message.result); assert.equal(result.success, true, JSON.stringify(message));
    const items = result.contentItems as { text: string }[]; return record(JSON.parse(items[0]!.text));
  }
  return { fake, socket, messages, send, reply, call, contents };
}

test('actual tool pipe reads complete newest-first history pages and projects outputs only when requested', async t => {
  const h = await fixture(t), history = h.fake.threads.get('history')!;
  const first = h.contents(await h.call(1, {}));
  assert.equal(first.schemaVersion, 1);
  assert.equal(record(first.thread).id, 'history');
  assert.equal(record(first.thread).hostId, 'local');
  assert.equal(record(first.thread).cwd, history.cwd);
  assert.equal(Object.hasOwn(record(first.thread), 'turns'), false);
  assert.deepEqual(first.page, { order: 'newest_first', limit: 1, nextCursor: '1', hasMore: true });
  assert.deepEqual((first.turns as { id: string }[]).map(turn => turn.id), ['turn-11']);

  const recent = h.contents(await h.call(2, { turnLimit: 10 }));
  const turns = recent.turns as Record<string, unknown>[];
  assert.deepEqual(turns.map(turn => turn.id), Array.from({ length: 10 }, (_, index) => 'turn-' + (11 - index)));
  assert.deepEqual(recent.page, { order: 'newest_first', limit: 10, nextCursor: '10', hasMore: true });
  const older = h.contents(await h.call(3, { cursor: record(recent.page).nextCursor, turnLimit: 10 }));
  const olderTurns = older.turns as Record<string, unknown>[];
  assert.deepEqual(olderTurns.map(turn => turn.id), ['turn-1', 'turn-0']);
  assert.deepEqual(older.page, { order: 'newest_first', limit: 10, nextCursor: null, hasMore: false });
  for (const turn of [...turns, ...olderTurns]) {
    const items = turn.items as Record<string, unknown>[];
    assert.equal(items.length, 65);
    assert.deepEqual(items.map(item => item.id), Array.from({ length: 65 }, (_, index) => 'item-' + index));
    assert.ok(items.every(item => item.type === 'commandExecution' && item.cwd === history.cwd
      && !Object.hasOwn(item, 'output') && !Object.hasOwn(item, 'aggregatedOutput')));
  }

  const truncated = h.contents(await h.call(4, { includeOutputs: true, maxOutputCharsPerItem: 4 }));
  const outputs = record((truncated.turns as unknown[])[0]).items as Record<string, unknown>[];
  assert.equal(outputs.length, 65);
  for (let index = 0; index < outputs.length; index++) {
    assert.equal(outputs[index]!.id, 'item-' + index);
    assert.deepEqual(outputs[index]!.output, { text: 'priv', truncated: true, originalChars: ('private-output-' + index).length });
    assert.equal(Object.hasOwn(outputs[index]!, 'aggregatedOutput'), false);
  }
  const untruncated = h.contents(await h.call(5, { includeOutputs: true, maxOutputCharsPerItem: 2000 }));
  const full = record((untruncated.turns as unknown[])[0]).items as Record<string, unknown>[];
  assert.deepEqual(full.map(item => item.output), Array.from({ length: 65 }, (_, index) => ({
    text: 'private-output-' + index, truncated: false,
  })));
  const bad = record((await h.call(6, { cursor: '' })).result);
  assert.equal(bad.success, false); assert.match(JSON.stringify(bad), /invalid arguments.*cursor/i);

  const reads = h.fake.calls('thread/turns/list');
  assert.equal(reads.length, 5);
  assert.deepEqual(reads.map(call => [call.params.cursor ?? null, call.params.limit]),
    [[null, 1], [null, 10], ['10', 10], [null, 1], [null, 1]]);
  assert.ok(reads.every(call => call.params.threadId === 'history' && call.params.itemsView === 'full'
    && call.params.itemLimit === null && call.params.itemSnapshot === 'latest' && call.params.maxBytes === 16 * 1024 * 1024));
  assert.equal(h.fake.calls('thread/items/list').length, 0);
  assert.equal(h.fake.calls('thread/resume').length, 0); assert.equal(h.fake.calls('turn/start').length, 0);
});

test('actual tool pipe bounds history responses by UTF-8 bytes', async t => {
  const h = await fixture(t), cwd = h.fake.threads.get('history')!.cwd;
  const text = '界'.repeat(20_000);
  const items = Array.from({ length: 18 }, (_, index) => commandItem('wide-' + index, text, cwd));
  const large = fixtureThread('large', cwd, { turns: [fixtureTurn('wide-turn', items)] });
  h.fake.threads.set('large', large);
  const rejected = record((await h.call(10, { threadId: 'large', includeOutputs: true, maxOutputCharsPerItem: 20_000 })).result);
  assert.equal(rejected.success, false); assert.match(JSON.stringify(rejected), /response exceeds the size limit/i);
  large.turns[0]!.items.pop();
  const accepted = h.contents(await h.call(11, { threadId: 'large', includeOutputs: true, maxOutputCharsPerItem: 20_000 }));
  const size = Buffer.byteLength(JSON.stringify(accepted), 'utf8');
  assert.ok(size > 1_000_000 && size <= 1_048_576, `unexpected response size: ${size}`);
  const returned = record((accepted.turns as unknown[])[0]).items as Record<string, unknown>[];
  assert.equal(returned.length, 17);
  assert.ok(returned.every(item => record(item.output).text === text && record(item.output).truncated === false));
  assert.equal(Buffer.byteLength(text, 'utf8'), 60_000);
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
