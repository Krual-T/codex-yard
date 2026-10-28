import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { ConversationSessions } from '../src/renderer/app/conversation-sessions.ts';

const scope = { hostId: 'local', threadId: 'same' };
function fixture() {
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const calls: { method: string; hostId: string }[] = [];
  const thread = (id: string): ThreadSummary => ({ id, name: 'Session', cwd: '/fixture', turns: [], status: { type: 'idle' } });
  let resumeFailure: Error | undefined;
  let heldResume: Promise<void> | undefined;
  let heldHistory: Promise<void> | undefined;
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params: Record<string, unknown> = {}, hostId = 'local'): Promise<T> {
      calls.push({ method, hostId });
      if (method === 'thread/resume') {
        await heldResume;
        if (resumeFailure) throw resumeFailure;
        return { thread: thread(String(params.threadId)), model: hostId + '-model' } as T;
      }
      if (method === 'thread/read') return { thread: thread(String(params.threadId)) } as T;
      if (method === 'thread/turns/list') { await heldHistory; return { data: [], nextCursor: null } as T; }
      if (method === 'thread/unsubscribe') return {} as T;
      throw new Error('Unexpected RPC: ' + method);
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async host() { throw new Error('Unexpected host request'); }, async reply() { throw new Error('Unexpected approval'); },
  };
  return { client, calls, thread, emit: (event: WorkbenchEvent) => { for (const listener of listeners) listener(event); },
    rejectResume(error: Error | undefined) { resumeFailure = error; }, holdResume(promise: Promise<void>) { heldResume = promise; },
    holdHistory(promise: Promise<void>) { heldHistory = promise; } };
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
  sessions.created(scope, h.thread(scope.threadId), { model: 'receipt-model' });
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
  assert.equal(h.calls.some(call => call.method === 'thread/turns/list'), false);
  const unknown = { ...scope, threadId: 'unknown' }, releaseUnknown = sessions.acquire(unknown, false);
  await assert.rejects(sessions.ready(unknown), /list_turns is not supported/);
  assert.equal(sessions.view(unknown).snapshot().thread, null);
  release(); releaseUnknown(); await setImmediate(); sessions.dispose();
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
  primary(); await sessions.ready(scope);
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
