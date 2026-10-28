import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { LateRpcTerminal, RequestOptions, ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { ConversationSessions } from '../src/renderer/app/conversation-sessions.ts';

const scope = { hostId: 'local', threadId: 'same' };
function fixture() {
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const calls: { method: string; hostId: string }[] = [];
  const thread = (id: string): ThreadSummary => ({ id, name: 'Session', cwd: '/fixture', turns: [], status: { type: 'idle' } });
  let resumeFailure: Error | undefined;
  let unsubscribeFailure: Error | undefined;
  let heldResume: Promise<void> | undefined;
  let heldHistory: Promise<void> | undefined;
  let history: TurnSummary[] = [];
  let metadata: ThreadSummary | undefined;
  let archived = false;
  const subscriptionObservers: { method: string; receive: NonNullable<RequestOptions['onLateTerminal']> }[] = [];
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params: Record<string, unknown> = {}, hostId = 'local', options?: Pick<RequestOptions, 'onLateTerminal'>): Promise<T> {
      calls.push({ method, hostId });
      if (options?.onLateTerminal) subscriptionObservers.push({ method, receive: options.onLateTerminal });
      if (method === 'thread/resume') {
        await heldResume;
        if (resumeFailure) throw resumeFailure;
        return { thread: thread(String(params.threadId)), model: hostId + '-model' } as T;
      }
      if (method === 'thread/read') return { thread: metadata ?? thread(String(params.threadId)) } as T;
      if (method === 'thread/list') return { data: archived ? [thread('same')] : [], nextCursor: null } as T;
      if (method === 'thread/turns/list') { await heldHistory; return { data: history.map(turn => ({ ...turn, itemsView: 'full' })), nextCursor: null } as T; }
      if (method === 'thread/unsubscribe') { if (unsubscribeFailure) throw unsubscribeFailure; return {} as T; }
      throw new Error('Unexpected RPC: ' + method);
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async host() { throw new Error('Unexpected host request'); }, async reply() { throw new Error('Unexpected approval'); },
  };
  return { client, calls, thread, emit: (event: WorkbenchEvent) => { for (const listener of listeners) listener(event); },
    rejectResume(error: Error | undefined) { resumeFailure = error; }, holdResume(promise: Promise<void>) { heldResume = promise; },
    rejectUnsubscribe(error: Error | undefined) { unsubscribeFailure = error; },
    holdHistory(promise: Promise<void> | undefined) { heldHistory = promise; },
    history(turns: TurnSummary[]) { history = turns; },
    metadata(value: ThreadSummary) { metadata = value; },
    archived(value: boolean) { archived = value; },
    late(index: number, receipt: LateRpcTerminal) { return subscriptionObservers[index]!.receive(receipt); } };
}

test('two panels share one conversation subscription and only the last owner unsubscribes', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const primary = sessions.acquire(scope, false), mini = sessions.acquire(scope, false);
  await sessions.ready(scope);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(sessions.view(scope).snapshot().options?.model, 'local-model');
  primary(); await setImmediate();
  assert.equal(h.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
  mini(); await setImmediate();
  assert.equal(h.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  sessions.dispose();
});

test('same thread IDs on different hosts have independent stream projections and subscriptions', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const remote = { ...scope, hostId: 'ssh-fixture' };
  const first = sessions.acquire(scope, false), second = sessions.acquire(remote, false);
  await Promise.all([sessions.ready(scope), sessions.ready(remote)]);
  h.emit({ type: 'mcp-notification', hostId: remote.hostId, method: 'item/started',
    params: { threadId: scope.threadId, turnId: 'turn', item: { id: 'message', type: 'agentMessage', text: '' } } });
  h.emit({ type: 'mcp-notification', hostId: remote.hostId, method: 'item/agentMessage/delta',
    params: { threadId: scope.threadId, turnId: 'turn', itemId: 'message', delta: 'Remote only' } });
  assert.equal(sessions.view(scope).snapshot().thread?.turns.length, 0);
  assert.equal(sessions.view(remote).snapshot().thread?.turns[0]?.items[0]?.text, 'Remote only');
  h.emit({ type: 'codex-app-server-connection-changed', hostId: 'local', state: 'disconnected' });
  assert.equal(sessions.view(remote).snapshot().streamGap, false);
  assert.equal(sessions.view(scope).snapshot().streamGap, true);
  first(); second(); await setImmediate(); sessions.dispose();
});

test('an actual creation receipt permits the first send without reading unsupported empty history', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  h.emit({ type: 'thread-created', hostId: scope.hostId, result: { thread: h.thread(scope.threadId), model: 'receipt-model' } });
  const release = sessions.acquire(scope, false); await sessions.ready(scope);
  assert.equal(h.calls.length, 0);
  assert.equal(sessions.view(scope).snapshot().options?.model, 'receipt-model');
  h.emit({ type: 'connection-state', state: 'disconnected' });
  h.emit({ type: 'connection-state', state: 'connected' });
  await sessions.ready(scope);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 1, 'A new bridge must restore the actual daemon subscription');
  release(); await setImmediate(); sessions.dispose();
});

test('only a persisted creation receipt permits the specific empty-history metadata phase', async () => {
  const h = fixture(); h.rejectResume(new Error('list_turns is not supported yet'));
  const sessions = new ConversationSessions(h.client, async identity => identity.threadId === 'same'
    ? { thread: h.thread('same'), settings: { model: 'original-empty-model' } } : undefined);
  const release = sessions.acquire(scope, false);
  await assert.rejects(sessions.ready(scope), /尚未形成首轮历史/);
  assert.equal(sessions.view(scope).snapshot().thread?.id, 'same');
  assert.equal(sessions.view(scope).snapshot().options?.model, 'original-empty-model');
  assert.equal(sessions.view(scope).snapshot().canSubmit, false);
  assert.equal(sessions.view(scope).snapshot().canStartFirstTurn, true);
  await sessions.ready(scope, true);
  assert.equal(h.calls.some(call => call.method === 'turn/start'), false, 'Readiness never replays an input');
  assert.equal(h.calls.some(call => call.method === 'thread/turns/list'), false);
  const unknown = { ...scope, threadId: 'unknown' }, releaseUnknown = sessions.acquire(unknown, false);
  await assert.rejects(sessions.ready(unknown), /list_turns is not supported/);
  assert.equal(sessions.view(unknown).snapshot().thread, null);
  release(); releaseUnknown(); await setImmediate(); sessions.dispose();
});

test('explicit first-turn permission is revoked by disconnect, archive and an accepted turn without claiming subscription', async () => {
  const h = fixture(); h.rejectResume(new Error('no rollout found for thread same'));
  const sessions = new ConversationSessions(h.client, async () => ({ thread: h.thread('same'), settings: { model: 'original' } }));
  const release = sessions.acquire(scope, false); await sessions.ready(scope, true);
  h.emit({ type: 'connection-state', state: 'disconnected' });
  assert.equal(sessions.view(scope).snapshot().canStartFirstTurn, false);
  await assert.rejects(sessions.ready(scope, true), /连接已断开/);
  h.emit({ type: 'connection-state', state: 'connected' }); await sessions.ready(scope, true);
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'thread/archived', params: { threadId: scope.threadId } });
  assert.equal(sessions.view(scope).snapshot().canStartFirstTurn, false);
  await assert.rejects(sessions.ready(scope, true));
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'thread/unarchived', params: { threadId: scope.threadId } });
  await sessions.ready(scope, true);
  sessions.started(scope, { id: 'accepted', status: 'inProgress', items: [] });
  assert.equal(sessions.view(scope).snapshot().canStartFirstTurn, false);
  assert.equal(sessions.view(scope).snapshot().canSubmit, false);
  assert.equal(sessions.view(scope).snapshot().streamGap, true);
  await assert.rejects(sessions.ready(scope, true), /no rollout/);
  h.rejectResume(undefined); await sessions.ready(scope);
  assert.equal(sessions.view(scope).snapshot().canSubmit, true);
  release(); await setImmediate(); sessions.dispose();
});

test('empty first-turn fallback requires the original matching creation, inactive metadata and a definite resume failure', async () => {
  for (const kind of ['wrong-creation', 'active', 'wrong-metadata', 'unknown-resume'] as const) {
    const h = fixture(); h.rejectResume(Object.assign(new Error('no rollout found for thread same'), { uncertain: kind === 'unknown-resume' }));
    if (kind === 'active') h.metadata({ ...h.thread('same'), status: { type: 'active', activeFlags: [] } });
    if (kind === 'wrong-metadata') h.metadata(h.thread('other'));
    const sessions = new ConversationSessions(h.client, async () => ({ thread: h.thread(kind === 'wrong-creation' ? 'other' : 'same'), settings: {} }));
    const release = sessions.acquire(scope, false);
    await assert.rejects(sessions.ready(scope, true));
    assert.equal(sessions.view(scope).snapshot().canStartFirstTurn, false, kind);
    assert.equal(h.calls.some(call => call.method === 'turn/start'), false);
    release(); await setImmediate(); sessions.dispose();
  }
});

test('leaving during a resume drains the original subscription without publishing the late snapshot', async () => {
  const h = fixture(); let resume!: () => void;
  h.holdResume(new Promise<void>(resolve => { resume = resolve; }));
  const sessions = new ConversationSessions(h.client, async () => undefined), release = sessions.acquire(scope, false);
  await setImmediate(); release(); resume(); await setImmediate();
  assert.equal(sessions.view(scope).snapshot().thread, null);
  assert.equal(h.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  sessions.dispose();
});

test('an archived reader remains available when the last writable panel releases its subscription', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const primary = sessions.acquire(scope, false), archived = sessions.acquire(scope, true);
  await sessions.ready(scope);
  primary(); await sessions.refresh(scope);
  await assert.rejects(sessions.ready(scope), /writable subscription/);
  assert.equal(h.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  assert.equal(sessions.view(scope).snapshot().thread?.id, scope.threadId);
  await sessions.refresh(scope);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 1, 'Read-only refresh must not resume the archived conversation');
  archived(); await setImmediate();
  assert.equal(h.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  sessions.dispose();
});

test('a resume from a disconnected bridge cannot satisfy the new connection subscription', async () => {
  const h = fixture(); let resume!: () => void;
  h.holdResume(new Promise<void>(resolve => { resume = resolve; }));
  const sessions = new ConversationSessions(h.client, async () => undefined), release = sessions.acquire(scope, false);
  await setImmediate();
  h.emit({ type: 'connection-state', state: 'disconnected' });
  h.emit({ type: 'connection-state', state: 'connected' });
  resume(); await sessions.ready(scope);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 2);
  assert.equal(sessions.view(scope).snapshot().thread?.id, scope.threadId);
  assert.equal(sessions.view(scope).snapshot().error, null);
  release(); await setImmediate(); sessions.dispose();
});

test('background reconciliation keeps the editor mounted while marking history incomplete', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const release = sessions.acquire(scope, false); await sessions.ready(scope);
  let finish!: () => void;
  h.holdHistory(new Promise<void>(resolve => { finish = resolve; }));
  const refreshing = sessions.refresh(scope); await setImmediate();
  assert.equal(sessions.view(scope).snapshot().loading, false);
  assert.equal(sessions.view(scope).snapshot().historyComplete, false);
  finish(); await refreshing;
  assert.equal(sessions.view(scope).snapshot().historyComplete, true);
  release(); await setImmediate(); sessions.dispose();
});

test('cached options cannot authorize a write while the new subscription is pending or archived', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const first = sessions.acquire(scope, false); await sessions.ready(scope); first(); await setImmediate();
  let finish!: () => void;
  h.holdResume(new Promise<void>(resolve => { finish = resolve; }));
  const second = sessions.acquire(scope, false); await setImmediate();
  assert.equal(sessions.view(scope).snapshot().options?.model, 'local-model');
  assert.equal(sessions.view(scope).snapshot().canSubmit, false);
  const waiting = sessions.ready(scope);
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'thread/archived', params: { threadId: scope.threadId } });
  finish(); await assert.rejects(waiting, /writable subscription/);
  assert.equal(sessions.view(scope).snapshot().canSubmit, false);
  second(); await setImmediate(); sessions.dispose();
});

test('uncertain unsubscribe stays fenced until the original connection returns its own terminal receipt', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const first = sessions.acquire(scope, false); await sessions.ready(scope);
  h.rejectUnsubscribe(Object.assign(new Error('unsubscribe timed out'), { uncertain: true }));
  first(); await setImmediate();
  const second = sessions.acquire(scope, false);
  await assert.rejects(sessions.ready(scope), /原订阅操作的结果尚未确认/);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(sessions.view(scope).snapshot().canSubmit, false);
  h.rejectUnsubscribe(undefined);
  await h.late(1, { outcome: 'success', result: {} }); await sessions.ready(scope);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 2);
  assert.equal(sessions.view(scope).snapshot().canSubmit, true);
  second(); await setImmediate(); sessions.dispose();
});

test('an uncertain resume is not replayed and a disconnected original observer cannot bless the new bridge', async () => {
  const h = fixture(); h.rejectResume(Object.assign(new Error('resume timed out'), { uncertain: true }));
  const sessions = new ConversationSessions(h.client, async () => undefined), release = sessions.acquire(scope, false);
  await assert.rejects(sessions.ready(scope), /原订阅操作的结果尚未确认/);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 1);
  h.emit({ type: 'connection-state', state: 'disconnected' });
  await h.late(0, { outcome: 'success', result: { thread: h.thread(scope.threadId), model: 'old-socket' } });
  assert.equal(sessions.view(scope).snapshot().canSubmit, false);
  h.rejectResume(undefined); h.emit({ type: 'connection-state', state: 'connected' }); await sessions.ready(scope);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 2);
  assert.equal(sessions.view(scope).snapshot().options?.model, 'local-model');
  release(); await setImmediate(); sessions.dispose();
});

test('a creation with no visible owner loses its subscription proof on connection replacement', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  h.emit({ type: 'thread-created', hostId: scope.hostId, result: { thread: h.thread(scope.threadId), model: 'old-created' } });
  h.emit({ type: 'connection-state', state: 'disconnected' }); h.emit({ type: 'connection-state', state: 'connected' });
  const release = sessions.acquire(scope, false); await sessions.ready(scope);
  assert.equal(h.calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(sessions.view(scope).snapshot().options?.model, 'local-model');
  release(); await setImmediate(); sessions.dispose();
});

test('leaving during active output keeps a continuity warning until complete history is reconciled', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const first = sessions.acquire(scope, false); await sessions.ready(scope);
  const notify = (method: string, params: Record<string, unknown>) => h.emit({ type: 'mcp-notification', hostId: scope.hostId, method,
    params: { threadId: scope.threadId, turnId: 'turn', ...params } });
  notify('turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  notify('item/started', { item: { id: 'message', type: 'agentMessage', text: '' } });
  notify('item/agentMessage/delta', { itemId: 'message', delta: 'A' });
  assert.equal(sessions.view(scope).snapshot().streamGap, false);
  first(); await setImmediate();
  h.history([{ id: 'turn', status: 'inProgress', items: [{ id: 'message', type: 'agentMessage', text: 'AB' }] }]);
  const second = sessions.acquire(scope, false); await sessions.ready(scope);
  notify('item/started', { item: { id: 'later', type: 'agentMessage', text: '' } });
  assert.equal(sessions.view(scope).snapshot().streamGap, true, 'A later start must not erase the missed interval');
  h.history([{ id: 'turn', status: 'completed', items: [{ id: 'message', type: 'agentMessage', text: 'ABC' }] }]);
  notify('turn/completed', { turn: { id: 'turn', status: 'completed', items: [] } });
  await sessions.refresh(scope);
  assert.equal(sessions.view(scope).snapshot().streamGap, false);
  assert.equal(sessions.view(scope).snapshot().thread?.turns[0]?.items[0]?.text, 'ABC');
  second(); await setImmediate(); sessions.dispose();
});

test('a stale history failure after leave and return triggers a new read without poisoning the new view', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const first = sessions.acquire(scope, false); await sessions.ready(scope);
  let fail!: (error: Error) => void;
  h.holdHistory(new Promise<void>((_resolve, reject) => { fail = reject; }));
  const stale = sessions.refresh(scope); await setImmediate(); first();
  const second = sessions.acquire(scope, false); h.holdHistory(undefined); fail(new Error('old view failed'));
  await assert.rejects(stale, /old view failed/); await sessions.ready(scope);
  const value = sessions.view(scope).snapshot();
  assert.equal(value.historyComplete, true); assert.equal(value.error, null);
  assert.equal(h.calls.filter(call => call.method === 'thread/turns/list').length, 3);
  second(); await setImmediate(); sessions.dispose();
});

test('rollback preserves the mounted conversation identity while history is revalidated', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const release = sessions.acquire(scope, false); await sessions.ready(scope);
  const before = sessions.view(scope).snapshot().thread;
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'thread/reverted', params: { threadId: scope.threadId } });
  assert.equal(sessions.view(scope).snapshot().thread, before);
  assert.equal(sessions.view(scope).snapshot().loading, false);
  assert.equal(sessions.view(scope).snapshot().historyComplete, false);
  await sessions.refresh(scope); release(); await setImmediate(); sessions.dispose();
});

test('a read-only owner cannot preserve observation proof across loss of the last writable owner', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  const primary = sessions.acquire(scope, false), readOnly = sessions.acquire(scope, true);
  await sessions.ready(scope);
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'turn/started', params: { threadId: scope.threadId,
    turn: { id: 'turn', status: 'inProgress', items: [] } } });
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'item/started', params: { threadId: scope.threadId, turnId: 'turn',
    item: { id: 'message', type: 'agentMessage', text: 'A' } } });
  primary();
  assert.equal(sessions.view(scope).snapshot().streamGap, true);
  await sessions.refresh(scope);
  h.history([{ id: 'turn', status: 'inProgress', items: [{ id: 'message', type: 'agentMessage', text: 'AB' }] }]);
  const returning = sessions.acquire(scope, false); await sessions.ready(scope);
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'item/agentMessage/delta', params: { threadId: scope.threadId,
    turnId: 'turn', itemId: 'message', delta: 'C' } });
  assert.equal(sessions.view(scope).snapshot().streamGap, true);
  assert.equal(sessions.view(scope).snapshot().thread?.turns[0]?.items[0]?.text, 'ABC');
  returning(); readOnly(); await setImmediate(); sessions.dispose();
});

test('notifications received between thread creation and the first owner require a fresh history projection', async () => {
  const h = fixture(), sessions = new ConversationSessions(h.client, async () => undefined);
  h.emit({ type: 'thread-created', hostId: scope.hostId, result: { thread: h.thread(scope.threadId), model: 'created' } });
  h.emit({ type: 'mcp-notification', hostId: scope.hostId, method: 'turn/started', params: { threadId: scope.threadId,
    turn: { id: 'other-page', status: 'inProgress', items: [] } } });
  h.history([{ id: 'other-page', status: 'inProgress', items: [{ id: 'reply', type: 'agentMessage', text: 'Existing stream' }] }]);
  const release = sessions.acquire(scope, false); await sessions.ready(scope);
  assert.equal(sessions.view(scope).snapshot().thread?.turns[0]?.items[0]?.text, 'Existing stream');
  assert.equal(sessions.view(scope).snapshot().streamGap, true);
  assert.equal(h.calls.filter(call => call.method === 'thread/turns/list').length, 1);
  release(); await setImmediate(); sessions.dispose();
});

test('cold entry and reconnect verify the real archive directory before granting a writable subscription', async () => {
  const h = fixture(); h.archived(true);
  const sessions = new ConversationSessions(h.client, async () => undefined), release = sessions.acquire(scope, false);
  await assert.rejects(sessions.ready(scope), /writable subscription/);
  assert.equal(sessions.view(scope).snapshot().archived, true);
  assert.equal(h.calls.some(call => call.method === 'thread/resume'), false);
  assert.equal(sessions.view(scope).snapshot().thread?.id, scope.threadId);
  h.archived(false);
  h.emit({ type: 'connection-state', state: 'disconnected' });
  assert.equal(sessions.view(scope).snapshot().archived, null);
  h.emit({ type: 'connection-state', state: 'connected' }); await sessions.ready(scope);
  assert.equal(sessions.view(scope).snapshot().archived, false);
  assert.equal(sessions.view(scope).snapshot().canSubmit, true);
  release(); await setImmediate(); sessions.dispose();
});
