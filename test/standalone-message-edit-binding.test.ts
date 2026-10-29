import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import WebSocket from 'ws';
import { CodexConnection } from '../lib/codex.ts';
import { createConversationWrites } from '../src/native/conversation-writes.ts';
import { editMessage, editMessageBeforeWriteFailure } from '../src/native/message-edit.ts';
import type { MessageEditConnectionBinding } from '../src/native/message-edit.ts';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage } from '../src/renderer/app/message-edit-recovery.ts';
import type { MessageEditRecovery } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { createFakeCodex, fixtureThread, fixtureTurn } from './fake-codex.ts';

const origin = { hostId: 'fixture-host', threadId: 'thread', turnId: 'source', itemId: 'user' };
const request = { origin, expectedTurnIds: ['before', 'source'], clientUserMessageId: 'original-client',
  turnParams: { input: [{ type: 'text', text: 'edited' }] }, operation: 'submit' as const };
const recovery: MessageEditRecovery = { origin, draft: { text: 'edited', input: request.turnParams.input, images: [], files: [] },
  editor: { sessionId: 'editor', revision: 1, baseDraft: { text: 'original', images: [], files: [] }, edits: [], addedText: 'edited',
    sourceSignature: 'original', snapshot: { id: 'user', type: 'userMessage' }, turnIndex: 1, itemIndex: 0 } };
const version = { sessionId: 'editor', revision: 1 };

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'edit-')), peer = await createFakeCodex(root);
  const thread = fixtureThread(origin.threadId, root, { turns: [fixtureTurn('before'), fixtureTurn('source', [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'original' }] },
  ])] });
  peer.threads.set(origin.threadId, thread);
  const connection = new CodexConnection(peer.socketPath, { timeout: 2000 });
  await connection.connect();
  t.after(async () => { connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  const socket = connection.socket;
  const binding: MessageEditConnectionBinding = { assertOriginal() {
    if (!socket || connection.socket !== socket || !connection.connected || socket.readyState !== WebSocket.OPEN) throw new Error('original socket changed');
  } };
  return { peer, thread, connection, socket, binding };
}

function connectedStore(h: Awaited<ReturnType<typeof fixture>>) {
  let saved: unknown;
  const calls: Record<string, unknown>[] = [];
  const storage: EditRecoveryStorage = { read: () => structuredClone(saved), update: async change => {
    saved = structuredClone(change(structuredClone(saved))); return saved;
  }, changed() {} };
  const client: WorkbenchClient = { rpc: async () => { throw new Error('unexpected RPC'); }, subscribe: () => () => {}, reply: async () => {},
    host: async <T>(_endpoint: string, value: Record<string, unknown> = {}, options?: { assertBeforeSend?: () => void }) => {
      options?.assertBeforeSend?.(); calls.push(structuredClone(value));
      return await editMessage(h.connection, origin.hostId, origin.threadId, value, h.binding) as T;
    } };
  return { store: new MessageEditRecoveryStore(client, storage), calls };
}

test('a queued edit cannot dispatch on a replacement daemon socket', async t => {
  const h = await fixture(t), write = createConversationWrites();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const blocker = write(origin.hostId, origin.threadId, async () => { entered(); await gate; });
  const edit = write(origin.hostId, origin.threadId, () => editMessage(h.connection, origin.hostId, origin.threadId, request, h.binding));
  await waiting;
  const disconnected = new Promise<void>(resolve => { h.connection.once('status', () => resolve()); });
  h.peer.disconnect(); await disconnected; await h.connection.connect();
  assert.notEqual(h.connection.socket, h.socket);
  release(); await blocker;
  const result = await edit;
  assert.equal(result.stage, 'prepared'); assert.match(result.error!, /original socket changed/);
  assert.equal(h.peer.calls('thread/turns/list').length, 0);
  assert.equal(h.peer.calls('thread/revert').length, 0); assert.equal(h.peer.calls('turn/start').length, 0);
});

for (const after of ['thread/turns/list', 'thread/revert'] as const) test(`a daemon reconnect after ${after} cannot dispatch the next phase`, async t => {
  const h = await fixture(t);
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const connection = { async request(method: string, params: Record<string, unknown>, options?: { mutating: boolean }) {
    const result = await h.connection.request(method, params, options);
    if (method === after) { reached(); await gate; }
    return result;
  } };
  const editing = editMessage(connection, origin.hostId, origin.threadId, request, h.binding);
  await entered;
  const disconnected = new Promise<void>(resolve => { h.connection.once('status', () => resolve()); });
  h.peer.disconnect(); await disconnected; await h.connection.connect();
  assert.notEqual(h.connection.socket, h.socket);
  release();
  const result = await editing;
  assert.equal(result.stage, after === 'thread/revert' ? 'reverted' : 'prepared');
  assert.match(result.error!, /original socket changed/);
  assert.equal(h.peer.calls('thread/revert').length, after === 'thread/revert' ? 1 : 0);
  assert.equal(h.peer.calls('turn/start').length, 0);
});

const methods = ['thread/turns/list', 'thread/read', 'thread/items/list', 'thread/revert', 'turn/start'] as const;
for (let stop = 1; stop <= methods.length; stop++) test(`original authority is rechecked before ${methods[stop - 1]}`, async t => {
  const h = await fixture(t);
  let checks = 0;
  const binding: MessageEditConnectionBinding = { assertOriginal() {
    h.binding.assertOriginal();
    if (++checks === stop) throw new Error('page or original socket authority expired');
  } };
  const result = await editMessage(h.connection, origin.hostId, origin.threadId, request, binding);
  assert.equal(result.stage, stop === methods.length ? 'reverted' : 'prepared');
  assert.match(result.error!, /authority expired/);
  for (const [index, method] of methods.entries()) assert.equal(h.peer.calls(method).length, index < stop - 1 ? 1 : 0, method);
});

test('original authority is checked again before the next history page', async t => {
  const h = await fixture(t);
  h.thread.turns = [...Array.from({ length: 100 }, (_, index) => fixtureTurn(`prefix-${index}`)), h.thread.turns[1]!];
  let checks = 0;
  const binding: MessageEditConnectionBinding = { assertOriginal() {
    h.binding.assertOriginal(); if (++checks === 2) throw new Error('original history connection expired');
  } };
  const result = await editMessage(h.connection, origin.hostId, origin.threadId,
    { ...request, expectedTurnIds: h.thread.turns.map(turn => turn.id) }, binding);
  assert.equal(result.stage, 'prepared'); assert.match(result.error!, /connection expired/);
  assert.equal(h.peer.calls('thread/turns/list').length, 1);
  assert.equal(h.peer.calls('thread/revert').length, 0);
});

test('original authority is checked again before the next message item page', async t => {
  const h = await fixture(t);
  h.thread.turns[1]!.items.push(...Array.from({ length: 100 }, (_, index) => ({ id: `agent-${index}`, type: 'agentMessage', text: 'fixture' })));
  let checks = 0;
  const binding: MessageEditConnectionBinding = { assertOriginal() {
    h.binding.assertOriginal(); if (++checks === 4) throw new Error('original item connection expired');
  } };
  const result = await editMessage(h.connection, origin.hostId, origin.threadId, request, binding);
  assert.equal(result.stage, 'prepared'); assert.match(result.error!, /connection expired/);
  assert.equal(h.peer.calls('thread/items/list').length, 1);
  assert.equal(h.peer.calls('thread/revert').length, 0);
});

for (const method of ['thread/turns/list', 'thread/read', 'thread/items/list'] as const) {
  test(`a definite ${method} read failure preserves the original prepared stage`, async t => {
    const h = await fixture(t);
    h.peer.handlers.set(method, () => { throw new Error('synthetic read rejection'); });
    const result = await editMessage(h.connection, origin.hostId, origin.threadId, request, h.binding);
    assert.equal(result.stage, 'prepared'); assert.match(result.error!, /synthetic read rejection/);
    assert.equal(h.peer.calls('thread/revert').length, 0); assert.equal(h.peer.calls('turn/start').length, 0);
  });
}

test('retry-start read failure and history conflict retain reverted without another write', async t => {
  const h = await fixture(t), retry = { ...request, operation: 'retry-start' };
  h.thread.turns = h.thread.turns.slice(0, 1);
  h.peer.handlers.set('thread/read', () => { throw new Error('synthetic metadata failure'); });
  const rejected = await editMessage(h.connection, origin.hostId, origin.threadId, retry, h.binding);
  assert.equal(rejected.stage, 'reverted'); assert.match(rejected.error!, /synthetic metadata failure/);
  h.peer.handlers.delete('thread/read'); h.thread.turns.push(fixtureTurn('other'));
  const changed = await editMessage(h.connection, origin.hostId, origin.threadId, retry, h.binding);
  assert.equal(changed.stage, 'reverted'); assert.match(changed.error!, /记录已改变/);
  assert.equal(h.peer.calls('thread/revert').length, 0); assert.equal(h.peer.calls('turn/start').length, 0);
});

for (const method of ['thread/revert', 'turn/start'] as const) test(`a daemon protocol rejection of ${method} has a known stage`, async t => {
  const h = await fixture(t);
  h.peer.handlers.set(method, () => { throw Object.assign(new Error('daemon rejected'), { code: -32600 }); });
  const result = await editMessage(h.connection, origin.hostId, origin.threadId, request, h.binding);
  assert.equal(result.stage, method === 'thread/revert' ? 'prepared' : 'reverted');
  assert.match(result.error!, /daemon rejected/);
  assert.equal(h.peer.calls('thread/revert').length, 1);
  assert.equal(h.peer.calls('turn/start').length, method === 'turn/start' ? 1 : 0);
});

for (const method of ['thread/revert', 'turn/start'] as const) test(`a bare uncertain:false after ${method} was issued cannot authorize a replay`, async t => {
  const h = await fixture(t);
  let issued: Promise<unknown> | undefined;
  const proxy = { request(name: string, params: Record<string, unknown>, options?: { mutating: boolean }) {
    const result = h.connection.request(name, params, options);
    if (name === method) { issued = result; void result.catch(() => {}); throw Object.assign(new Error('reply was lost'), { uncertain: false }); }
    return result;
  } };
  const result = await editMessage(proxy, origin.hostId, origin.threadId, request, h.binding);
  assert.equal(result.stage, method === 'thread/revert' ? 'revertUnknown' : 'startUnknown');
  assert.ok(issued); await issued;
  assert.equal(h.peer.calls('thread/revert').length, 1);
  assert.equal(h.peer.calls('turn/start').length, method === 'turn/start' ? 1 : 0);
});

test('check and prequeue failure cannot downgrade a previous unknown', async t => {
  const h = await fixture(t);
  for (const unknownPhase of ['revertUnknown', 'startUnknown'] as const) {
    const check = { ...request, operation: 'check', unknownPhase };
    assert.equal(editMessageBeforeWriteFailure(origin.hostId, origin.threadId, check, new Error('not dispatched')).stage, unknownPhase);
    h.peer.handlers.set('thread/turns/list', () => { throw new Error('read failed'); });
    assert.equal((await editMessage(h.connection, origin.hostId, origin.threadId, check, h.binding)).stage, unknownPhase);
    h.peer.handlers.delete('thread/turns/list');
    assert.equal((await editMessage(h.connection, origin.hostId, origin.threadId, check, h.binding)).stage, unknownPhase);
  }
  assert.equal(h.peer.calls('thread/revert').length, 0); assert.equal(h.peer.calls('turn/start').length, 0);
});

test('missing or asynchronous binding and prequeue failure fail closed by actual operation', async t => {
  const h = await fixture(t);
  assert.equal((await editMessage(h.connection, origin.hostId, origin.threadId, request)).stage, 'prepared');
  assert.equal((await editMessage(h.connection, origin.hostId, origin.threadId, { ...request, operation: 'retry-start' })).stage, 'reverted');
  assert.match((await editMessage(h.connection, origin.hostId, origin.threadId, request, { assertOriginal: async () => {} })).error!, /必须同步/);
  assert.equal(editMessageBeforeWriteFailure(origin.hostId, origin.threadId, request, new Error('binding missing')).stage, 'prepared');
  assert.equal(editMessageBeforeWriteFailure(origin.hostId, origin.threadId, { ...request, operation: 'retry-start' }, new Error('binding missing')).stage, 'reverted');
  assert.throws(() => editMessageBeforeWriteFailure('wrong-host', origin.threadId, request, new Error('failure')), /身份无效/);
  assert.equal(h.peer.calls('thread/turns/list').length, 0);
  assert.equal(h.peer.calls('thread/revert').length, 0); assert.equal(h.peer.calls('turn/start').length, 0);
});

test('a real host history failure settles prepared in the recovery store and permits cancel', async t => {
  const h = await fixture(t), { store, calls } = connectedStore(h);
  await store.save(recovery, origin, version);
  h.peer.handlers.set('thread/turns/list', () => { throw new Error('history unavailable'); });
  await assert.rejects(store.submit(origin, request.expectedTurnIds, request.turnParams), /history unavailable/);
  const saved = await store.read(origin.hostId, origin.threadId);
  assert.equal(saved?.submission?.stage, 'prepared'); assert.equal(saved?.recovery.draft.text, 'edited');
  assert.equal(calls.length, 1); assert.equal(h.peer.calls('thread/revert').length, 0);
  await store.save(null, origin, version); assert.equal(await store.read(origin.hostId, origin.threadId), null);
});

test('a real host failed retry read remains reverted and a later explicit retry only starts once', async t => {
  const h = await fixture(t), { store, calls } = connectedStore(h);
  await store.save(recovery, origin, version);
  h.peer.handlers.set('turn/start', () => { throw new Error('start rejected'); });
  await assert.rejects(store.submit(origin, request.expectedTurnIds, request.turnParams), /start rejected/);
  assert.equal((await store.read(origin.hostId, origin.threadId))?.submission?.stage, 'reverted');
  h.peer.handlers.delete('turn/start');
  h.peer.handlers.set('thread/read', () => { throw new Error('history unavailable'); });
  await assert.rejects(store.submit(origin, [], request.turnParams), /history unavailable/);
  assert.equal((await store.read(origin.hostId, origin.threadId))?.submission?.stage, 'reverted');
  h.peer.handlers.delete('thread/read');
  assert.ok((await store.submit(origin, [], request.turnParams)).turn);
  assert.deepEqual(calls.map(call => call.operation), ['submit', 'retry-start', 'retry-start']);
  assert.equal(calls[0]!.clientUserMessageId, calls[1]!.clientUserMessageId);
  assert.equal(calls[1]!.clientUserMessageId, calls[2]!.clientUserMessageId);
  assert.equal(h.peer.calls('thread/revert').length, 1); assert.equal(h.peer.calls('turn/start').length, 2);
});
