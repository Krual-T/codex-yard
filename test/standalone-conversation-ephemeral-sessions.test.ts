import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { ConversationSessions, type EphemeralForkReceipt, type EphemeralForkScope } from '../src/renderer/app/conversation-sessions.ts';

const parent: EphemeralForkScope = { hostId: 'host-a', parentThreadId: 'parent-a', parentCwd: '/fixture/a',
  operationId: 'operation-a', connectionGeneration: 'socket-a1', forkDispatchId: 'dispatch-a1' };
const authority = (current: () => boolean = () => true) => ({ isCurrent: current, isForkUnsent: () => true });
const child = (scope = parent) => ({ hostId: scope.hostId, threadId: 'child' });
function receipt(scope = parent, eventCursor = 10): EphemeralForkReceipt {
  const thread: ThreadSummary & { ephemeral: true; forkedFromId: string; sourceMarker: string } = {
    id: 'child', name: null, cwd: scope.parentCwd, turns: [], status: { type: 'idle' },
    ephemeral: true, forkedFromId: scope.parentThreadId, sourceMarker: 'actual-fork-receipt',
  };
  return { scope: { ...scope }, eventCursor, child: { thread, options: { model: 'fork-model', effort: null,
    approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'workspace-write', serviceTier: null, mode: 'plan' } } };
}
function fixture(rpc?: (method: string) => Promise<unknown>) {
  const listeners = new Set<(event: WorkbenchEvent) => void>(), calls: string[] = [];
  let connected = true;
  const client: WorkbenchClient & { readonly connected: boolean } = {
    get connected() { return connected; },
    async rpc<T>(method: string): Promise<T> { calls.push(method); if (rpc) return await rpc(method) as T; throw new Error('Unexpected RPC: ' + method); },
    async host() { throw new Error('Unexpected host request'); }, async reply() { throw new Error('Unexpected approval'); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const sessions = new ConversationSessions(client, async () => { throw new Error('Unexpected persistent creation lookup'); });
  const emit = (event: WorkbenchEvent) => { for (const listener of listeners) listener(event); };
  const connect = (hostId = parent.hostId) => { emit({ type: 'connection-state', state: 'connected' });
    emit({ type: 'codex-app-server-connection-changed', hostId, state: 'connected' }); };
  const notify = (hostId: string, threadId: string, seq: number | undefined, method: string, params: Record<string, unknown> = {}) => {
    emit({ type: 'mcp-notification', hostId, method, params: { threadId, ...params }, ...(seq === undefined ? {} : { seq }) });
  };
  return { client, calls, sessions, emit, connect, notify, setConnected(value: boolean) { connected = value; } };
}

test('original fork, buffered events and hidden owners share one live projection without pretending complete history', async () => {
  const f = fixture(); f.connect();
  const token = f.sessions.captureEphemeralFork(parent, authority()), original = receipt();
  f.notify(parent.hostId, 'other', 11, 'turn/started', { turn: { id: 'other-turn', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 14, 'item/agentMessage/delta', { turnId: 'turn-1', itemId: 'answer', delta: 'lo' });
  f.notify(parent.hostId, 'child', 12, 'turn/started', { turn: { id: 'turn-1', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 13, 'item/started', { turnId: 'turn-1', item: { id: 'answer', type: 'agentMessage', text: 'Hel' } });
  f.notify(parent.hostId, 'child', 15, 'thread/settings/updated', { threadSettings: { model: 'updated-model', effort: 'high' } });
  assert.equal(f.sessions.installEphemeralFork(token, original), true);
  original.child.thread.name = 'mutated'; original.child.options.model = 'mutated';
  const release = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  let state = f.sessions.view(child()).snapshot();
  assert.equal(state.thread?.name, null);
  assert.equal((state.thread as ThreadSummary & { sourceMarker: string }).sourceMarker, 'actual-fork-receipt');
  assert.equal(state.thread?.turns[0]?.items[0]?.text, 'Hello');
  assert.deepEqual(state.options, { model: 'updated-model', effort: 'high', approvalPolicy: 'on-request',
    approvalsReviewer: 'user', sandboxMode: 'workspace-write', serviceTier: null, mode: 'plan' });
  assert.equal(state.loading, false); assert.equal(state.liveReady, true); assert.equal(state.historyComplete, false);
  assert.equal(state.canSubmit, true); assert.equal(state.streamGap, false);
  f.sessions.started(child(), { id: 'turn-1', status: 'inProgress', items: [{ id: 'answer', type: 'agentMessage', text: 'Hel' }] });
  assert.equal(f.sessions.view(child()).snapshot().thread?.turns[0]?.items[0]?.text, 'Hello', 'A late start receipt cannot truncate observed deltas');
  release(); await setImmediate();
  f.notify(parent.hostId, 'child', 16, 'turn/completed', { turn: { id: 'turn-1', status: 'completed', itemsView: 'summary',
    items: [{ id: 'answer', type: 'agentMessage', text: 'Hel' }] } });
  f.notify(parent.hostId, 'child', 17, 'turn/started', { turn: { id: 'turn-2', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 18, 'item/started', { turnId: 'turn-2', item: { id: 'new', type: 'agentMessage', text: '' } });
  f.notify(parent.hostId, 'child', 19, 'item/agentMessage/delta', { turnId: 'turn-2', itemId: 'new', delta: 'hidden' });
  f.notify(parent.hostId, 'child', 20, 'thread/settings/updated', { threadSettings: { mode: 'ignored', effort: null } });
  state = f.sessions.view(child()).snapshot();
  assert.equal(state.thread?.turns[0]?.items[0]?.text, 'Hello');
  assert.equal(state.thread?.turns[1]?.items[0]?.text, 'hidden');
  assert.equal(state.options?.effort, null); assert.equal(state.options?.approvalPolicy, 'on-request');
  assert.equal(state.liveReady, true); assert.equal(state.canSubmit, false); assert.equal(state.streamGap, false);
  const again = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  assert.equal(f.sessions.view(child()).snapshot().canSubmit, true);
  assert.deepEqual(f.calls, [], 'Fork projections must not resume, paginate, check archives or unsubscribe');
  again(); f.sessions.dispose();
});

test('original host, operation, parent, child and receipt generation are required; old captures cannot win', () => {
  const f = fixture();
  assert.throws(() => f.sessions.captureEphemeralFork(parent, authority()), /原连接/);
  f.connect();
  assert.throws(() => f.sessions.captureEphemeralFork(parent, { isCurrent: () => true, isForkUnsent: () => false }), /原连接/);
  const old = f.sessions.captureEphemeralFork(parent, authority());
  const current = f.sessions.captureEphemeralFork(parent, authority());
  assert.equal(f.sessions.installEphemeralFork(old, receipt()), false);
  const wrong = receipt(); wrong.scope.connectionGeneration = 'socket-a2';
  assert.equal(f.sessions.installEphemeralFork(current, wrong), false);
  assert.equal(f.sessions.installEphemeralFork(current, receipt()), false, 'A consumed capture cannot be retried with different contents');
  for (const invalid of ['parent', 'child', 'host', 'cwd', 'dispatch', 'cursor', 'options'] as const) {
    const token = f.sessions.captureEphemeralFork(parent, authority()), value = receipt();
    if (invalid === 'parent') value.child.thread.forkedFromId = 'other';
    if (invalid === 'child') value.child.thread.id = parent.parentThreadId;
    if (invalid === 'host') value.scope.hostId = 'host-b';
    if (invalid === 'cwd') value.child.thread.cwd = '/other';
    if (invalid === 'dispatch') value.scope.forkDispatchId = 'different-dispatch';
    if (invalid === 'cursor') value.eventCursor = Number.NaN;
    if (invalid === 'options') delete value.child.options.approvalsReviewer;
    assert.equal(f.sessions.installEphemeralFork(token, value), false, invalid);
  }
  const cancelled = f.sessions.captureEphemeralFork(parent, authority()); f.sessions.cancelEphemeralFork(cancelled);
  assert.equal(f.sessions.installEphemeralFork(cancelled, receipt()), false);
  assert.equal(f.sessions.view(child()).snapshot().thread, null);
  assert.deepEqual(f.calls, []); f.sessions.dispose();
});

test('unrepresentable settings revoke writable options without falling back to configured defaults', async () => {
  const f = fixture(); f.connect();
  const token = f.sessions.captureEphemeralFork(parent, authority());
  assert.equal(f.sessions.installEphemeralFork(token, receipt()), true);
  const release = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  f.notify(parent.hostId, 'child', 11, 'thread/settings/updated', { threadSettings: { sandboxPolicy: { type: 'externalSandbox', networkAccess: 'enabled' } } });
  let state = f.sessions.view(child()).snapshot();
  assert.equal(state.options?.sandboxMode, undefined); assert.equal(state.canSubmit, false);
  assert.equal(state.liveReady, true); assert.match(state.error!, /设置无法完整确认/);
  await assert.rejects(f.sessions.ready(child()), /设置无法完整确认/);
  f.notify(parent.hostId, 'child', 12, 'thread/settings/updated', { threadSettings: { sandboxPolicy: { type: 'readOnly', networkAccess: false } } });
  state = f.sessions.view(child()).snapshot();
  assert.equal(state.options?.sandboxMode, 'read-only'); assert.equal(state.options?.model, 'fork-model');
  assert.equal(state.canSubmit, true); assert.equal(state.error, null);
  f.notify(parent.hostId, 'child', 13, 'thread/settings/updated', { threadSettings: { collaborationMode: 'future-mode' } });
  f.notify(parent.hostId, 'child', 14, 'thread/settings/updated', { threadSettings: { effort: 'high' } });
  assert.equal(f.sessions.view(child()).snapshot().canSubmit, false, 'An unrelated update cannot prove the unsupported mode changed');
  f.notify(parent.hostId, 'child', 15, 'thread/settings/updated', { threadSettings: { collaborationMode: 'plan' } });
  assert.equal(f.sessions.view(child()).snapshot().canSubmit, true);
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('the same child id on two hosts keeps independent events, options and ownership', async () => {
  const f = fixture(), other = { ...parent, hostId: 'host-b', parentThreadId: 'parent-b', parentCwd: '/fixture/b',
    operationId: 'operation-b', connectionGeneration: 'socket-b1' };
  f.connect(parent.hostId); f.connect(other.hostId);
  const a = f.sessions.captureEphemeralFork(parent, authority()), b = f.sessions.captureEphemeralFork(other, authority());
  const second = receipt(other); second.child.options.model = 'host-b-model';
  assert.equal(f.sessions.installEphemeralFork(a, receipt()), true);
  assert.equal(f.sessions.installEphemeralFork(b, second), true);
  const releaseA = f.sessions.acquire(child(), false), releaseB = f.sessions.acquire(child(other), false);
  await f.sessions.ready(child()); await f.sessions.ready(child(other));
  f.notify('host-a', 'child', 11, 'turn/started', { turn: { id: 'a-turn', status: 'inProgress', items: [] } });
  f.notify('host-b', 'child', 11, 'turn/started', { turn: { id: 'b-turn', status: 'inProgress', items: [] } });
  f.notify('host-a', 'child', 12, 'thread/settings/updated', { threadSettings: { model: 'host-a-update' } });
  assert.deepEqual(f.sessions.view(child()).snapshot().thread?.turns.map(turn => turn.id), ['a-turn']);
  assert.deepEqual(f.sessions.view(child(other)).snapshot().thread?.turns.map(turn => turn.id), ['b-turn']);
  assert.equal(f.sessions.view(child()).snapshot().options?.model, 'host-a-update');
  assert.equal(f.sessions.view(child(other)).snapshot().options?.model, 'host-b-model');
  f.emit({ type: 'codex-app-server-connection-changed', hostId: 'host-a', state: 'disconnected' });
  assert.equal(f.sessions.view(child()).snapshot().canSubmit, false);
  assert.equal(f.sessions.view(child(other)).snapshot().canSubmit, true);
  releaseA(); releaseB(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('disconnect rejects late fork receipts and never reacquires a lost ephemeral subscription', async () => {
  const f = fixture(); f.connect(); let current = true;
  const delayed = f.sessions.captureEphemeralFork(parent, authority(() => current));
  f.emit({ type: 'codex-app-server-connection-changed', hostId: parent.hostId, state: 'disconnected' });
  current = false; f.connect();
  assert.equal(f.sessions.installEphemeralFork(delayed, receipt()), false);
  const newer = { ...parent, connectionGeneration: 'socket-a2', forkDispatchId: 'dispatch-a2' }, capture = f.sessions.captureEphemeralFork(newer, authority());
  assert.equal(f.sessions.installEphemeralFork(capture, receipt(newer)), true);
  const release = f.sessions.acquire(child(newer), false); await f.sessions.ready(child(newer));
  f.notify(parent.hostId, 'child', 11, 'turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 12, 'item/started', { turnId: 'turn', item: { id: 'answer', type: 'agentMessage', text: 'seen' } });
  f.setConnected(false); f.emit({ type: 'connection-state', state: 'disconnected' });
  let state = f.sessions.view(child(newer)).snapshot();
  assert.equal(state.thread?.turns[0]?.items[0]?.text, 'seen');
  assert.equal(state.canSubmit, false); assert.equal(state.liveReady, false); assert.equal(state.streamGap, true);
  assert.match(state.error!, /未重新订阅或发送/);
  f.setConnected(true); f.connect();
  f.notify(parent.hostId, 'child', 13, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'answer', delta: 'wrong socket' });
  f.sessions.started(child(newer), { id: 'late-start', status: 'inProgress', items: [] });
  await f.sessions.refresh(child(newer)); await assert.rejects(f.sessions.ready(child(newer)), /原连接/);
  state = f.sessions.view(child(newer)).snapshot();
  assert.equal(state.thread?.turns[0]?.items[0]?.text, 'seen');
  assert.equal(state.canSubmit, false); assert.equal(state.historyComplete, false); assert.equal(state.loading, false);
  assert.equal(f.sessions.invalidateEphemeral(parent, 'child'), false, 'An old operation cannot close the newer projection');
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('a new page can register the verified old fork only as unavailable without reading or resuming it', async () => {
  const f = fixture(); f.connect();
  const fork = receipt(), liveCapture = f.sessions.captureEphemeralFork(parent, authority());
  assert.equal(f.sessions.registerUnavailableEphemeral(parent, fork.child), false, 'A pending original fork is not replaced by a read-only projection');
  f.sessions.cancelEphemeralFork(liveCapture);
  assert.equal(f.sessions.registerUnavailableEphemeral(parent, { thread: fork.child.thread, options: null }), true);
  const release = f.sessions.acquire(child(), false);
  await assert.rejects(f.sessions.ready(child()), /原连接/);
  f.notify(parent.hostId, 'child', 11, 'turn/started', { turn: { id: 'wrong-socket', status: 'inProgress', items: [] } });
  await f.sessions.refresh(child());
  const state = f.sessions.view(child()).snapshot();
  assert.equal(state.thread?.id, 'child'); assert.deepEqual(state.thread?.turns, []);
  assert.equal(state.options, null); assert.equal(state.historyComplete, false); assert.equal(state.streamGap, true);
  assert.equal(state.loading, false); assert.equal(state.canSubmit, false); assert.equal(state.liveReady, false);
  assert.equal(f.sessions.registerUnavailableEphemeral(parent, fork.child), false);
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('a stale read-only restoration cannot displace a newer pending fork for the same operation', async () => {
  const f = fixture(); f.connect();
  const newer = { ...parent, connectionGeneration: 'socket-a2', forkDispatchId: 'dispatch-a2' };
  const capture = f.sessions.captureEphemeralFork(newer, authority());
  assert.equal(f.sessions.registerUnavailableEphemeral(parent, receipt().child), false);
  assert.equal(f.sessions.view(child()).snapshot().thread, null);
  assert.equal(f.sessions.installEphemeralFork(capture, receipt(newer)), true);
  const release = f.sessions.acquire(child(newer), false); await f.sessions.ready(child(newer));
  assert.equal(f.sessions.view(child(newer)).snapshot().canSubmit, true);
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('logical and transport reordering never append to a completed item; unknown prefixes remain explicit', async () => {
  const f = fixture(); f.connect();
  const token = f.sessions.captureEphemeralFork(parent, authority());
  assert.equal(f.sessions.installEphemeralFork(token, receipt()), true);
  const release = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  f.notify(parent.hostId, 'child', 11, 'turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 12, 'item/started', { turnId: 'turn', item: { id: 'answer', type: 'agentMessage', text: '', extra: 'preserved' } });
  f.notify(parent.hostId, 'child', 13, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'answer', delta: 'hello' });
  f.notify(parent.hostId, 'child', 14, 'item/completed', { turnId: 'turn', item: { id: 'answer', type: 'agentMessage', text: 'hello world' } });
  f.notify(parent.hostId, 'child', 15, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'answer', delta: 'late' });
  f.notify(parent.hostId, 'child', 16, 'turn/completed', { turn: { id: 'turn', status: 'completed', itemsView: 'summary', items: [] } });
  f.notify(parent.hostId, 'child', 17, 'turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  assert.equal(f.sessions.view(child()).snapshot().thread?.turns[0]?.items[0]?.text, 'hello world');
  assert.equal(f.sessions.view(child()).snapshot().thread?.turns[0]?.items[0]?.extra, 'preserved');
  assert.equal(f.sessions.view(child()).snapshot().thread?.turns[0]?.status, 'completed');
  assert.equal(f.sessions.view(child()).snapshot().streamGap, false);
  f.notify(parent.hostId, 'child', 13, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'answer', delta: 'conflicting replay' });
  assert.equal(f.sessions.view(child()).snapshot().thread?.turns[0]?.items[0]?.text, 'hello world');
  assert.equal(f.sessions.view(child()).snapshot().streamGap, true);
  f.notify(parent.hostId, 'child', 18, 'turn/started', { turn: { id: 'next', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 20, 'item/agentMessage/delta', { turnId: 'next', itemId: 'partial', delta: 'tail' });
  f.notify(parent.hostId, 'child', 21, 'item/started', { turnId: 'next', item: { id: 'partial', type: 'agentMessage', text: '' } });
  f.notify(parent.hostId, 'child', 19, 'item/agentMessage/delta', { turnId: 'next', itemId: 'partial', delta: 'late prefix' });
  const state = f.sessions.view(child()).snapshot();
  assert.equal(state.thread?.turns[1]?.items[0]?.text, 'tail');
  assert.equal(state.thread?.turns[1]?.items[0]?.partialStart, true);
  assert.equal(state.streamGap, true); assert.equal(state.historyComplete, false);
  f.notify(parent.hostId, 'child', 22, 'item/completed', { turnId: 'next', item: { id: 'partial', type: 'agentMessage', text: 'prefix tail' } });
  assert.equal(f.sessions.view(child()).snapshot().thread?.turns[1]?.items[0]?.text, 'prefix tail');
  assert.equal(f.sessions.view(child()).snapshot().streamGap, true, 'A complete item does not prove all missing events arrived');
  release(); f.sessions.dispose();
});

test('a conflicting full completion preserves already observed items and marks the gap', async () => {
  const f = fixture(); f.connect();
  const token = f.sessions.captureEphemeralFork(parent, authority());
  assert.equal(f.sessions.installEphemeralFork(token, receipt()), true);
  const release = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  f.notify(parent.hostId, 'child', 11, 'turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 12, 'item/started', { turnId: 'turn', item: { id: 'one', type: 'agentMessage', text: '' } });
  f.notify(parent.hostId, 'child', 13, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'one', delta: 'observed text' });
  f.notify(parent.hostId, 'child', 14, 'item/started', { turnId: 'turn', item: { id: 'two', type: 'agentMessage', text: 'also seen' } });
  f.notify(parent.hostId, 'child', 15, 'turn/completed', { turn: { id: 'turn', status: 'completed', itemsView: 'full',
    items: [{ id: 'one', type: 'agentMessage', text: 'contradictory' }, { id: 'three', type: 'agentMessage', text: 'new' }] } });
  const state = f.sessions.view(child()).snapshot();
  assert.deepEqual(state.thread?.turns[0]?.items.map(item => [item.id, item.text]), [
    ['one', 'observed text'], ['two', 'also seen'], ['three', 'new'],
  ]);
  assert.equal(state.thread?.turns[0]?.status, 'completed'); assert.equal(state.streamGap, true);
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('missing sequence, overflow and connection authority loss are visible instead of reconstructing history', async () => {
  const f = fixture(); f.connect(); let current = true;
  const token = f.sessions.captureEphemeralFork(parent, authority(() => current));
  for (let index = 1; index <= 2049; index++) f.notify(parent.hostId, 'unrelated', index, 'thread/status/changed', { status: { type: 'idle' } });
  f.notify(parent.hostId, 'child', undefined, 'turn/started', { turn: { id: 'unknown', status: 'inProgress', items: [] } });
  assert.equal(f.sessions.installEphemeralFork(token, receipt(parent, 2049)), true);
  const release = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  assert.equal(f.sessions.view(child()).snapshot().streamGap, true);
  assert.equal(f.sessions.view(child()).snapshot().thread?.turns.length, 0);
  current = false;
  await assert.rejects(f.sessions.ready(child()), /原连接/);
  assert.equal(f.sessions.view(child()).snapshot().liveReady, false);
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('an oversized pre-receipt event makes the captured stream gap explicit', async () => {
  const f = fixture(); f.connect();
  const token = f.sessions.captureEphemeralFork(parent, authority());
  f.notify(parent.hostId, 'child', 11, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'item', delta: 'x'.repeat(1_100_000) });
  assert.equal(f.sessions.installEphemeralFork(token, receipt()), true);
  const release = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  assert.equal(f.sessions.view(child()).snapshot().streamGap, true);
  assert.equal(f.sessions.view(child()).snapshot().historyComplete, false);
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('turn output seen before a conflicting idle fork receipt is retained with an explicit gap', async () => {
  const f = fixture(); f.connect();
  const token = f.sessions.captureEphemeralFork(parent, authority());
  f.notify(parent.hostId, 'child', 11, 'turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  f.notify(parent.hostId, 'child', 12, 'item/started', { turnId: 'turn', item: { id: 'answer', type: 'agentMessage', text: '' } });
  f.notify(parent.hostId, 'child', 13, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'answer', delta: 'seen' });
  assert.equal(f.sessions.installEphemeralFork(token, receipt(parent, 13)), true);
  const release = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  const state = f.sessions.view(child()).snapshot();
  assert.equal(state.thread?.turns[0]?.items[0]?.text, 'seen');
  assert.equal(state.streamGap, true); assert.equal(state.historyComplete, false);
  release(); f.sessions.dispose(); assert.deepEqual(f.calls, []);
});

test('late persistent archive lookup and last-owner cleanup cannot replace or unsubscribe an installed child', async () => {
  let finish!: (value: unknown) => void;
  const held = new Promise(resolve => { finish = resolve; });
  const f = fixture(method => method === 'thread/list' ? held : Promise.reject(new Error('Unexpected RPC: ' + method)));
  f.connect();
  const release = f.sessions.acquire(child(), false); await setImmediate();
  assert.deepEqual(f.calls, ['thread/list']);
  release();
  const token = f.sessions.captureEphemeralFork(parent, authority());
  assert.equal(f.sessions.installEphemeralFork(token, receipt()), true);
  const owner = f.sessions.acquire(child(), false); await f.sessions.ready(child());
  assert.equal(f.sessions.view(child()).snapshot().options?.model, 'fork-model');
  assert.equal(f.sessions.view(child()).snapshot().canSubmit, true);
  assert.deepEqual(f.calls, ['thread/list']);
  finish({ data: [], nextCursor: null }); await setImmediate(); await setImmediate();
  assert.equal(f.sessions.view(child()).snapshot().options?.model, 'fork-model');
  assert.deepEqual(f.calls, ['thread/list']);
  assert.equal(f.sessions.invalidateEphemeral(parent, 'child'), true);
  await assert.rejects(f.sessions.ready(child()), /原连接/);
  owner(); f.sessions.dispose(); assert.deepEqual(f.calls, ['thread/list']);
});
