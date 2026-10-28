import assert from 'node:assert/strict';
import test from 'node:test';
import { SendRecoveryStore, sendThreadKey } from '../src/renderer/app/send-recovery.ts';
import { findSentMessage } from '../src/native/message-edit.ts';
import { findSubmission } from '../src/native/message-submission-status.ts';
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

test('queue and steer retain immutable actions and identities after uncertain replies and reload', async () => {
  for (const action of [{ type: 'queue' as const }, { type: 'steer' as const, turnId: 'original-active-turn' }]) {
    const h = fixture(), submittedAction = structuredClone(action);
    const intent = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {}, undefined, undefined, action);
    if (action.type === 'steer') action.turnId = 'different-turn';
    await h.store.sending(intent.id, intent.attemptId);
    await h.store.failed(intent.id, Object.assign(new Error('lost acknowledgement'), { uncertain: true }), intent.attemptId);
    const restored = new SendRecoveryStore(h.client, h.storage);
    assert.deepEqual((await restored.read()).requests[intent.id].action, submittedAction);
    assert.equal((await restored.read()).requests[intent.id].clientUserMessageId, intent.clientUserMessageId);
    await assert.rejects(restored.attempt(intent.id), /尚未核对/);
    await assert.rejects(restored.cancel(intent.id), /尚未核对/);
    assert.equal((await restored.check(intent.id)).stage, 'unknown');
    assert.equal(h.calls[0].params?.action, submittedAction.type);
    h.found(submittedAction.type === 'steer' ? submittedAction.turnId : 'consumed-turn');
    assert.equal((await restored.check(intent.id)).stage, 'confirmed');
    assert.equal((await restored.read()).requests[intent.id].clientUserMessageId, intent.clientUserMessageId);
    assert.ok(h.calls.every(call => call.endpoint === 'message-send-status'));
  }
});

test('queue checks find exact identities across pages or consumed history, never infer rejection from absence', async () => {
  const calls: string[] = [];
  const connection = { async request(method: string, params: Record<string, unknown>) {
    calls.push(method);
    if (method === 'thread/queue/list') return params.cursor
      ? { data: [{ id: 'wanted-queue-id', clientUserMessageId: 'queued-exact' }], nextCursor: null }
      : { data: [{ id: 'other-id', clientUserMessageId: 'other-client' }], nextCursor: 'next' };
    if (method === 'thread/turns/list') return { data: [{ id: 'consumed-turn' }], nextCursor: null };
    return { data: [{ item: { id: 'user', type: 'userMessage', clientId: 'consumed-exact' } }], nextCursor: null };
  } };
  assert.deepEqual(await findSubmission(connection, 'thread', 'queued-exact', 'queue'), { turnId: null, queuedSubmissionId: 'wanted-queue-id' });
  assert.deepEqual(calls, ['thread/queue/list', 'thread/queue/list']);
  assert.deepEqual(await findSubmission(connection, 'thread', 'consumed-exact', 'queue'), { turnId: 'consumed-turn' });
  assert.deepEqual(await findSubmission(connection, 'thread', 'absent', 'queue'), { turnId: null });
  assert.deepEqual(await findSubmission(connection, 'thread', 'consumed-exact', 'steer'), { turnId: 'consumed-turn' });
  assert.ok(calls.every(method => ['thread/queue/list', 'thread/turns/list', 'thread/items/list'].includes(method)));
  await assert.rejects(findSubmission({ request: async () => ({ data: [], nextCursor: 'same' }) }, 'thread', 'absent', 'queue'), /未前进/);
  await assert.rejects(findSubmission({ request: async () => ({ data: [{ id: '', clientUserMessageId: 'exact' }], nextCursor: null }) }, 'thread', 'exact', 'queue'), /无法核对/);
});

test('a positive queue receipt confirms only its original attempt and invalid status responses preserve uncertainty', async () => {
  const h = fixture(), intent = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {}, undefined, undefined, { type: 'queue' });
  await h.store.sending(intent.id, intent.attemptId);
  await h.store.failed(intent.id, new Error('unknown'), intent.attemptId);
  h.client.host = async <T>() => ({ turnId: null, queuedSubmissionId: 9 }) as T;
  await assert.rejects(h.store.check(intent.id), /回执无效/);
  assert.equal((await h.store.read()).requests[intent.id].stage, 'unknown');
  h.client.host = async <T>() => ({ turnId: null, queuedSubmissionId: 'actual-queued-id' }) as T;
  assert.equal((await h.store.check(intent.id)).queuedSubmissionId, 'actual-queued-id');
  assert.equal((await h.store.read()).requests[intent.id].stage, 'confirmed');
  assert.deepEqual((await h.store.read()).requests[intent.id].draft, draft);
});

test('queue and steer durably mark their request before writing and only confirm matching acknowledgements', async () => {
  for (const action of [{ type: 'queue' as const }, { type: 'steer' as const, turnId: 'active-turn' }]) {
    const h = fixture(), intent = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {}, undefined, undefined, action);
    let issued = 0;
    h.client.rpc = async <T>(method: string, params: Record<string, unknown> = {}) => {
      issued++;
      assert.equal((await h.store.read()).requests[intent.id].stage, 'sending');
      assert.equal(params.clientUserMessageId, intent.clientUserMessageId);
      assert.equal(method, action.type === 'queue' ? 'thread/queue/add' : 'turn/steer');
      return (action.type === 'queue' ? { queuedSubmission: { id: 'queue-receipt', clientUserMessageId: intent.clientUserMessageId } }
        : { turnId: 'active-turn' }) as T;
    };
    await submitDraft(h.client, { hostId: version.owner.hostId, threadId: 'existing', cwd: '/fixture', readOnly: false,
      activeTurnId: action.type === 'steer' ? action.turnId : null, thread: null,
      send: { clientUserMessageId: intent.clientUserMessageId, creating: async () => {}, created: async () => {},
        sending: () => h.store.sending(intent.id, intent.attemptId), confirmed: id => h.store.confirmed(intent.id, id, intent.attemptId),
        queued: id => h.store.queued(intent.id, id, intent.attemptId) } }, draft, {}, action, async () => {});
    assert.equal(issued, 1); assert.equal((await h.store.read()).requests[intent.id].stage, 'confirmed');
  }
});

test('a new send keeps its original request/version and thread binding across failure, reload and exact-client check', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, { mode: 'plan' }, {});
  await h.store.creating(intent.id, intent.attemptId); await h.store.created(intent.id, 'created-thread', undefined, intent.attemptId); await h.store.sending(intent.id, intent.attemptId);
  await h.store.failed(intent.id, Object.assign(new Error('lost receipt'), { uncertain: true }), intent.attemptId);
  const reloaded = new SendRecoveryStore(h.client, h.storage);
  let state = await reloaded.read();
  assert.equal(state.bindings[sendThreadKey('ssh-fixture', 'created-thread')], 'new-draft');
  assert.deepEqual(state.requests[intent.id].draft, draft); assert.equal(state.requests[intent.id].revision, 'A');
  await assert.rejects(reloaded.prepare({ ...version, revision: 'newer B' }, '/fixture', { ...draft, text: 'newer B' }, {}, {}), /待核对/);
  assert.equal((await reloaded.check(intent.id)).stage, 'unknown');
  await assert.rejects(reloaded.sending(intent.id, intent.attemptId), /未重复发送/);
  h.found('accepted-turn'); assert.equal((await reloaded.check(intent.id)).stage, 'confirmed');
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => call.endpoint === 'message-send-status'
    && call.params?.clientUserMessageId === intent.clientUserMessageId && call.params?.threadId === 'created-thread'));
  await reloaded.check(intent.id); assert.equal(h.calls.length, 2);
  await reloaded.failed(intent.id, new Error('late check failure'), intent.attemptId);
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
  await h.store.creating(intent.id, intent.attemptId); await h.store.failed(intent.id, new Error('unknown create'), intent.attemptId);
  await assert.rejects(h.store.check(intent.id), /不会重新创建/);
  await assert.rejects(h.store.creating(intent.id, intent.attemptId), /未重复创建/);
  await h.store.prepare({ ...version, owner: { ...version.owner, draftId: 'other-draft' } }, '/fixture', draft, {}, {});
  assert.equal(Object.keys((await h.store.read()).requests).length, 2); assert.deepEqual(h.calls, []);
});

test('a submitted widget context stays immutable when the live widget changes and its send receipt is lost', async () => {
  const h = fixture(), context = { widget: { kind: 'untrusted' as const, value: JSON.stringify({ modelContent: { choice: 7 } }) } };
  const intent = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {}, undefined, context);
  context.widget.value = JSON.stringify({ modelContent: { choice: 9 } });
  await h.store.sending(intent.id, intent.attemptId); await h.store.failed(intent.id, new Error('lost receipt'), intent.attemptId);
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
  await h.store.sending(intent.id, intent.attemptId); await h.store.confirmed(intent.id, 'turn', intent.attemptId); await h.store.dismiss(intent.id, version);
  await assert.rejects(h.store.confirmed(intent.id, 'late', intent.attemptId), /另一页面处理/);
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
    send: { clientUserMessageId: intent.clientUserMessageId, creating: () => h.store.creating(intent.id, intent.attemptId), created: thread => h.store.created(intent.id, thread.id, undefined, intent.attemptId),
      sending: () => h.store.sending(intent.id, intent.attemptId), confirmed: id => h.store.confirmed(intent.id, id, intent.attemptId) } }, draft, {}, { type: 'send' }, async () => { order.push('selected'); });
  assert.deepEqual(order, ['thread/start', 'selected', 'turn/start']);
  assert.equal((await h.store.read()).requests[intent.id].stage, 'confirmed');
});

test('an actual empty-thread receipt survives reload and only an explicitly rejected send can be retried or cancelled', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, {}, {}, 'selected-project');
  await h.store.creating(intent.id, intent.attemptId);
  const receipt = { thread: { id: 'empty', name: null, cwd: '/fixture', status: { type: 'idle' as const }, turns: [] }, settings: { model: 'actual-created-model' } };
  await h.store.created(intent.id, 'empty', receipt, intent.attemptId);
  const loaded = new SendRecoveryStore(h.client, h.storage);
  assert.deepEqual((await loaded.read()).requests[intent.id].created, receipt);
  assert.equal((await loaded.read()).requests[intent.id].projectId, 'selected-project');
  await loaded.sending(intent.id, intent.attemptId);
  await assert.rejects(loaded.cancel(intent.id), /尚未核对/);
  await loaded.failed(intent.id, Object.assign(new Error('explicit rejection'), { uncertain: false }), intent.attemptId);
  assert.equal((await loaded.read()).requests[intent.id].stage, 'failed');
  const retried = await loaded.attempt(intent.id);
  await loaded.sending(intent.id, retried.attemptId);
  await loaded.failed(intent.id, Object.assign(new Error('lost response'), { uncertain: true }), retried.attemptId);
  await assert.rejects(loaded.cancel(intent.id), /尚未核对/);
  await assert.rejects(loaded.sending(intent.id, retried.attemptId), /未重复发送/);
  h.found('exact-turn'); await loaded.check(intent.id);
  assert.equal((await loaded.read()).requests[intent.id].stage, 'confirmed');
  assert.deepEqual((await loaded.read()).creations, {});
  assert.deepEqual(h.calls.map(call => call.endpoint), ['message-send-status']);
});

test('cancelling a rejected first send preserves its authoritative empty-thread phase and draft identity', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, {}, {});
  await h.store.creating(intent.id, intent.attemptId);
  const thread = { id: 'cancelled-empty', name: null, cwd: '/fixture', status: { type: 'idle' as const }, turns: [] };
  await h.store.created(intent.id, thread.id, { thread, settings: { model: 'created-model' } }, intent.attemptId);
  await h.store.cancel(intent.id);
  const state = await new SendRecoveryStore(h.client, h.storage).read(), key = sendThreadKey(version.owner.hostId, thread.id);
  assert.deepEqual(state.requests, {});
  assert.equal(state.bindings[key], version.owner.draftId);
  assert.deepEqual(state.creations[key], { owner: version.owner, thread, settings: { model: 'created-model' } });
  assert.deepEqual(h.calls, []);
});

test('an old page preflight failure cannot downgrade a new page attempt or regain authority to send', async () => {
  const h = fixture(), first = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {});
  const secondPage = new SendRecoveryStore(h.client, h.storage), next = await secondPage.attempt(first.id);
  await secondPage.sending(next.id, next.attemptId);
  await h.store.failed(first.id, Object.assign(new Error('old page left'), { uncertain: false }), first.attemptId);
  const state = (await secondPage.read()).requests[first.id];
  assert.equal(state.stage, 'sending'); assert.equal(state.attemptId, next.attemptId);
  await assert.rejects(h.store.sending(first.id, first.attemptId), /另一页面/);
  await assert.rejects(h.store.attempt(first.id), /未重复发送/);
  await secondPage.confirmed(next.id, 'actual-turn', next.attemptId);
  await h.store.failed(first.id, new Error('late original error'), first.attemptId);
  assert.equal((await h.store.read()).requests[first.id].stage, 'confirmed');
});

test('checking a definitely unsent phase does not issue a query or remove retry and cancel', async () => {
  const h = fixture(), intent = await h.store.prepare(version, '/fixture', draft, {}, {});
  assert.equal((await h.store.check(intent.id)).stage, 'prepared');
  await h.store.creating(intent.id, intent.attemptId);
  await h.store.created(intent.id, 'created', undefined, intent.attemptId);
  assert.equal((await h.store.check(intent.id)).stage, 'ready');
  await h.store.failed(intent.id, Object.assign(new Error('preflight rejected'), { uncertain: false }), intent.attemptId);
  assert.equal((await h.store.check(intent.id)).stage, 'failed');
  assert.deepEqual(h.calls, []);
  await h.store.cancel(intent.id); assert.deepEqual((await h.store.read()).requests, {});
});

test('a pending history check cannot overwrite a newer attempt after the original request was definitively rejected', async () => {
  const h = fixture(), intent = await h.store.prepare({ ...version, owner: { ...version.owner, threadId: 'existing' } }, '/fixture', draft, {}, {});
  await h.store.sending(intent.id, intent.attemptId);
  let entered!: () => void, resolve!: (result: { turnId: string | null }) => void;
  const started = new Promise<void>(done => { entered = done; });
  const result = new Promise<{ turnId: string | null }>(done => { resolve = done; });
  const checkingPage = new SendRecoveryStore({ ...h.client, async host<T>() { entered(); return await result as T; } }, h.storage);
  const checking = checkingPage.check(intent.id); await started;
  await h.store.failed(intent.id, Object.assign(new Error('actual rejection'), { uncertain: false }), intent.attemptId);
  const retry = await h.store.attempt(intent.id); await h.store.sending(intent.id, retry.attemptId);
  resolve({ turnId: null }); await checking;
  const current = (await h.store.read()).requests[intent.id];
  assert.equal(current.stage, 'sending'); assert.equal(current.attemptId, retry.attemptId);
});
