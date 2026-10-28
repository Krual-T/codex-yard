import assert from 'node:assert/strict';
import test from 'node:test';
import { SendRecoveryStore, sendThreadKey } from '../src/renderer/app/send-recovery.ts';
import { findSentMessage } from '../src/native/message-edit.ts';
import { submitDraft } from '../src/renderer/app/submission.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const version = { owner: { hostId: 'ssh-fixture', threadId: null, draftId: 'new-draft' }, revision: 'A' };
const draft = { text: 'submitted A', images: [], files: [] };
function fixture() {
  let value: unknown, turnId: string | null = null;
  const calls: { endpoint: string; params?: Record<string, unknown> }[] = [];
  const client: WorkbenchClient = { rpc: async () => { throw new Error('Recovery must never send or replay'); },
    async host<T>(endpoint: string, params?: Record<string, unknown>) { calls.push({ endpoint, params }); return { turnId } as T; },
    subscribe: () => () => {}, reply: async () => {} };
  const storage = { async read() { return structuredClone(value); }, async update(change: (previous: unknown) => unknown) { value = change(structuredClone(value)); return structuredClone(value); } };
  return { storage, client, calls, store: new SendRecoveryStore(client, storage), found: (id: string | null) => { turnId = id; }, seed: (next: unknown) => { value = next; } };
}

test('a new send keeps its original request/version and thread binding across failure, reload and exact-client check', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, { mode: 'plan' }, {});
  await h.store.creating(intent.id); await h.store.created(intent.id, 'created-thread'); await h.store.sending(intent.id);
  await h.store.failed(intent.id, Object.assign(new Error('lost receipt'), { uncertain: true }));
  const reloaded = new SendRecoveryStore(h.client, h.storage);
  let state = await reloaded.read();
  assert.equal(state.bindings[sendThreadKey('ssh-fixture', 'created-thread')], 'new-draft');
  assert.deepEqual(state.requests[intent.id].draft, draft); assert.equal(state.requests[intent.id].revision, 'A');
  await assert.rejects(reloaded.prepare({ ...version, revision: 'newer B' }, '/fixture', { ...draft, text: 'newer B' }, {}, {}), /待核对/);
  assert.equal((await reloaded.check(intent.id)).stage, 'unknown');
  await assert.rejects(reloaded.sending(intent.id), /未重复发送/);
  h.found('accepted-turn'); assert.equal((await reloaded.check(intent.id)).stage, 'confirmed');
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => call.endpoint === 'message-send-status'
    && call.params?.clientUserMessageId === intent.clientUserMessageId && call.params?.threadId === 'created-thread'));
  await reloaded.check(intent.id); assert.equal(h.calls.length, 2);
  await reloaded.failed(intent.id, new Error('late check failure'));
  await assert.rejects(reloaded.dismiss(intent.id, { ...version, revision: 'newer B' }), /版本尚未确认/);
  await reloaded.dismiss(intent.id, version);
  state = await reloaded.read(); assert.deepEqual(state.requests, {});
  assert.equal(state.bindings[sendThreadKey('ssh-fixture', 'created-thread')], 'new-draft');
});

test('preparation serializes one owner, preserves different drafts and refuses unknown creation replay', async () => {
  const h = fixture();
  const results = await Promise.allSettled([h.store.prepare(version, '/fixture', draft, {}, {}), h.store.prepare(version, '/fixture', draft, {}, {})]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  const intent = Object.values((await h.store.read()).requests)[0];
  await h.store.creating(intent.id); await h.store.failed(intent.id, new Error('unknown create'));
  await assert.rejects(h.store.check(intent.id), /不会重新创建/);
  await assert.rejects(h.store.creating(intent.id), /未重复创建/);
  await h.store.prepare({ ...version, owner: { ...version.owner, draftId: 'other-draft' } }, '/fixture', draft, {}, {});
  assert.equal(Object.keys((await h.store.read()).requests).length, 2); assert.deepEqual(h.calls, []);
});

test('a submitted widget context stays immutable when the live widget changes and its send receipt is lost', async () => {
  const h = fixture(), context = { widget: { kind: 'untrusted' as const, value: JSON.stringify({ modelContent: { choice: 7 } }) } };
  const intent = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {}, undefined, context);
  context.widget.value = JSON.stringify({ modelContent: { choice: 9 } });
  await h.store.sending(intent.id); await h.store.failed(intent.id, new Error('lost receipt'));
  const restored = (await new SendRecoveryStore(h.client, h.storage).read()).requests[intent.id];
  assert.equal(restored.clientUserMessageId, intent.clientUserMessageId);
  assert.deepEqual(JSON.parse(restored.additionalContext!.widget.value), { modelContent: { choice: 7 } });
  assert.equal(restored.stage, 'unknown');
  assert.deepEqual(h.calls, []);
});

test('unrecognized recovery data is retained and a late check cannot recreate a dismissed record', async () => {
  const h = fixture(); h.seed({ requests: null, bindings: {}, future: true });
  await assert.rejects(h.store.prepare(version, '/fixture', draft, {}, {}), /原值已保留/);
  assert.deepEqual(await h.storage.read(), { requests: null, bindings: {}, future: true });
  h.seed({ requests: {}, bindings: {}, future: { keep: true } });
  const intent = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {});
  await h.store.confirmed(intent.id, 'turn'); await h.store.dismiss(intent.id, version);
  await assert.rejects(h.store.confirmed(intent.id, 'late'), /另一页面处理/);
  assert.deepEqual((await h.storage.read() as any).future, { keep: true });
});

test('send checks use every history/item page, exact clientId and only read RPCs', async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const connection = { async request(method: string, params: Record<string, unknown>) {
    calls.push({ method, params });
    if (method === 'thread/turns/list') return params.cursor ? { data: [{ id: 'second' }], nextCursor: null } : { data: [{ id: 'first' }], nextCursor: 'turn-page' };
    if (params.turnId === 'first') return { data: [{ item: { id: 'unrelated', type: 'userMessage', clientId: 'different' } }], nextCursor: null };
    return params.cursor ? { data: [{ item: { id: 'wanted', type: 'userMessage', clientId: 'exact' } }], nextCursor: null }
      : { data: [{ item: { id: 'agent', type: 'agentMessage', clientId: 'exact' } }], nextCursor: 'item-page' };
  } };
  assert.deepEqual(await findSentMessage(connection, 'thread', 'exact'), { turnId: 'second' });
  assert.equal(calls.length, 5); assert.ok(calls.every(call => ['thread/turns/list', 'thread/items/list'].includes(call.method)));
  assert.deepEqual(await findSentMessage(connection, 'thread', 'absent'), { turnId: null });
  await assert.rejects(findSentMessage({ request: async () => ({ data: [], nextCursor: 7 }) }, 'thread', 'exact'), /游标无效/);
});

test('durable send phase hooks precede their writes and use the persisted client identity', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, {}, {}), order: string[] = [];
  const client: WorkbenchClient = { ...h.client, async rpc<T>(method: string, params: Record<string, unknown> = {}) {
    order.push(method);
    const state = (await h.store.read()).requests[intent.id];
    assert.equal(state.stage, method === 'thread/start' ? 'creating' : 'sending');
    if (method === 'turn/start') assert.equal(params.clientUserMessageId, intent.clientUserMessageId);
    return (method === 'thread/start' ? { thread: { id: 'created' } } : { turn: { id: 'started' } }) as T;
  } };
  await submitDraft(client, { hostId: 'ssh-fixture', threadId: null, cwd: '/fixture', activeTurnId: null, readOnly: false, thread: null,
    send: { clientUserMessageId: intent.clientUserMessageId, creating: () => h.store.creating(intent.id), created: thread => h.store.created(intent.id, thread.id),
      sending: () => h.store.sending(intent.id), confirmed: id => h.store.confirmed(intent.id, id) } }, draft, {}, { type: 'send' }, async () => { order.push('selected'); });
  assert.deepEqual(order, ['thread/start', 'selected', 'turn/start']);
  assert.equal((await h.store.read()).requests[intent.id].stage, 'confirmed');
});

test('an actual empty-thread receipt survives reload and only an explicitly rejected send can be retried or cancelled', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, {}, {}, 'selected-project');
  await h.store.creating(intent.id);
  const receipt = { thread: { id: 'empty', name: null, cwd: '/fixture', status: { type: 'idle' as const }, turns: [] }, settings: { model: 'actual-created-model' } };
  await h.store.created(intent.id, 'empty', receipt);
  const loaded = new SendRecoveryStore(h.client, h.storage);
  assert.deepEqual((await loaded.read()).requests[intent.id].created, receipt);
  assert.equal((await loaded.read()).requests[intent.id].projectId, 'selected-project');
  await loaded.sending(intent.id);
  await assert.rejects(loaded.cancel(intent.id), /尚未核对/);
  await loaded.failed(intent.id, Object.assign(new Error('explicit rejection'), { uncertain: false }));
  assert.equal((await loaded.read()).requests[intent.id].stage, 'failed');
  await loaded.sending(intent.id);
  await loaded.failed(intent.id, Object.assign(new Error('lost response'), { uncertain: true }));
  await assert.rejects(loaded.cancel(intent.id), /尚未核对/);
  await assert.rejects(loaded.sending(intent.id), /未重复发送/);
  h.found('exact-turn'); await loaded.check(intent.id);
  assert.equal((await loaded.read()).requests[intent.id].stage, 'confirmed');
  assert.deepEqual((await loaded.read()).creations, {});
  assert.deepEqual(h.calls.map(call => call.endpoint), ['message-send-status']);
});

test('cancelling a rejected first send preserves its authoritative empty-thread phase and draft identity', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, {}, {});
  await h.store.creating(intent.id);
  const thread = { id: 'cancelled-empty', name: null, cwd: '/fixture', status: { type: 'idle' as const }, turns: [] };
  await h.store.created(intent.id, thread.id, { thread, settings: { model: 'created-model' } });
  await h.store.cancel(intent.id);
  const state = await new SendRecoveryStore(h.client, h.storage).read(), key = sendThreadKey(version.owner.hostId, thread.id);
  assert.deepEqual(state.requests, {});
  assert.equal(state.bindings[key], version.owner.draftId);
  assert.deepEqual(state.creations[key], { owner: version.owner, thread, settings: { model: 'created-model' } });
  assert.deepEqual(h.calls, []);
});
