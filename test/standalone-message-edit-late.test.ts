import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editMessage } from '../src/native/message-edit.ts';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage } from '../src/renderer/app/message-edit-recovery.ts';
import type { MessageEditRecovery } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const origin = { hostId: 'synthetic-host', threadId: 'thread', turnId: 'source', itemId: 'user' };
const recovery: MessageEditRecovery = {
  origin, draft: { text: 'edited', input: [{ type: 'text', text: 'edited' }], images: [], files: [] },
  editor: { sessionId: 'editor', revision: 2, baseDraft: { text: 'original', images: [], files: [] },
    edits: [], addedText: 'edited', sourceSignature: 'source', snapshot: { id: 'user', type: 'userMessage' }, turnIndex: 1, itemIndex: 0 },
};

function fixture(phase: 'revert' | 'start') {
  let history = [
    { id: 'before', status: 'completed', items: [] as Record<string, unknown>[] },
    { id: 'source', status: 'completed', items: [{ id: 'user', type: 'userMessage' }] as Record<string, unknown>[] },
  ];
  let saved: unknown, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let late: Promise<void> = Promise.resolve();
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const connection = {
    async request(method: string, params: Record<string, unknown>) {
      calls.push({ method, params: structuredClone(params) });
      if (method === 'thread/turns/list') return { data: structuredClone(history), nextCursor: null };
      if (method === 'thread/read') return { thread: { status: { type: 'idle' } } };
      if (method === 'thread/items/list') return { data: history.find(turn => turn.id === params.turnId)?.items.map(item => ({ item })) ?? [], nextCursor: null };
      if (method === 'thread/revert') {
        const apply = () => { history = history.slice(0, 1); };
        if (phase === 'revert') { late = gate.then(apply); throw Object.assign(new Error('timeout before revert completed'), { uncertain: true }); }
        apply(); return {};
      }
      if (method === 'turn/start') {
        const apply = () => { history.push({ id: 'started', status: 'completed', items: [{ id: 'new-user', type: 'userMessage', clientId: params.clientUserMessageId }] }); };
        if (phase === 'start') { late = gate.then(apply); throw Object.assign(new Error('timeout before start completed'), { uncertain: true }); }
        apply(); return { turn: history.at(-1) };
      }
      throw new Error(`Unexpected ${method}`);
    },
  };
  const storage: EditRecoveryStorage = { read: () => structuredClone(saved), update: async change => {
    saved = structuredClone(change(structuredClone(saved))); return saved;
  }, changed() {} };
  const requests: Record<string, unknown>[] = [];
  const client: WorkbenchClient = { rpc: async () => { throw new Error('unexpected RPC'); }, subscribe: () => () => {}, reply: async () => {},
    host: async <T>(endpoint: string, value: Record<string, unknown> = {}) => {
      assert.equal(endpoint, 'message-edit'); requests.push(structuredClone(value));
      return await editMessage(connection, origin.hostId, origin.threadId, value) as T;
    } };
  return { calls, requests, store: new MessageEditRecoveryStore(client, storage), release: async () => { release(); await late; }, history: () => structuredClone(history) };
}

for (const phase of ['revert', 'start'] as const) test(`a late ${phase} remains unknown after a check and is never replayed`, async () => {
  const h = fixture(phase), version = { sessionId: 'editor', revision: 2 };
  await h.store.save(recovery, origin, version);
  await assert.rejects(h.store.submit(origin, ['before', 'source'], { input: recovery.draft.input }), /timeout/);
  const original = h.requests[0]!;
  await assert.rejects(h.store.submit(origin, [], { input: [{ type: 'text', text: 'changed' }] }), /尚未确认/);
  const uncertainPhase = phase === 'revert' ? 'revertUnknown' : 'startUnknown';
  assert.equal(h.requests[1]!.unknownPhase, uncertainPhase);
  assert.equal(h.requests[1]!.clientUserMessageId, original.clientUserMessageId);
  assert.deepEqual(h.requests[1]!.turnParams, original.turnParams);
  assert.equal((await h.store.read(origin.hostId, origin.threadId))?.submission?.stage, uncertainPhase);
  await h.release();
  if (phase === 'revert') {
    assert.deepEqual(h.history().map(turn => turn.id), ['before']);
    await assert.rejects(h.store.submit(origin, [], {}), /尚未确认/);
    assert.equal((await h.store.read(origin.hostId, origin.threadId))?.submission?.stage, 'revertUnknown');
    assert.equal(h.calls.filter(call => call.method === 'turn/start').length, 0);
  } else {
    assert.equal((await h.store.submit(origin, [], {})).turn?.id, 'started');
    assert.equal(h.calls.filter(call => call.method === 'turn/start').length, 1);
  }
  assert.equal(h.calls.filter(call => call.method === 'thread/revert').length, 1);
  assert.deepEqual(h.requests.map(request => request.operation), ['submit', 'check', 'check']);
});

test('a check without its unknown phase never infers that a write is retryable', async () => {
  const connection = { async request(method: string) {
    if (method === 'thread/turns/list') return { data: [{ id: 'source', status: 'completed' }], nextCursor: null };
    if (method === 'thread/read') return { thread: { status: { type: 'idle' } } };
    if (method === 'thread/items/list') return { data: [{ item: { id: 'user', type: 'userMessage', clientId: 'someone-else' } }], nextCursor: null };
    throw new Error('No writes are expected');
  } };
  const request = { origin, expectedTurnIds: ['source'], clientUserMessageId: 'ours', turnParams: { input: [{ type: 'text', text: 'edited' }] }, operation: 'check' };
  assert.equal((await editMessage(connection, origin.hostId, origin.threadId, request)).stage, 'conflict');
  assert.equal((await editMessage(connection, origin.hostId, origin.threadId, { ...request, unknownPhase: 'startUnknown' })).stage, 'startUnknown');
  await assert.rejects(editMessage(connection, origin.hostId, origin.threadId, { ...request, unknownPhase: 'invalid' }), /身份无效/);
  await assert.rejects(editMessage(connection, origin.hostId, origin.threadId, { ...request, unknownPhase: ['startUnknown'] }), /身份无效/);
});
