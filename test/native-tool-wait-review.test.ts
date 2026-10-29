import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { RpcMessage, ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';
import { formatAssistantMessage, ThreadWaiter } from '../lib/native-tool-kernel.ts';
import type { NativeHosts, NativeManager } from '../lib/native-tool-kernel.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function thread(status: ThreadSummary['status'] = { type: 'active', activeFlags: [] }): ThreadSummary {
  return { id: 'shared', name: null, cwd: '/fixture', status, turns: [] };
}
function turn(id: string, status: TurnSummary['status'], text?: string, startedAt = 1): TurnSummary & { itemsView: string; startedAt: number } {
  return { id, status, startedAt, itemsView: 'full', error: null,
    items: text ? [{ id: `${id}-message`, type: 'agentMessage', text, phase: status === 'inProgress' ? 'commentary' : 'final_answer' }] : [] };
}

class FixtureManager implements NativeManager {
  readonly hostId: string;
  readonly messages = new Set<(message: RpcMessage) => void>();
  readonly deleted = new Set<(id: string) => void>();
  readonly errors = new Set<(error: Error) => void>();
  currentThread = thread();
  currentTurns: TurnSummary[] = [turn('turn-1', 'inProgress')];
  read: () => Promise<{ thread: ThreadSummary }> = async () => ({ thread: this.currentThread });
  list: () => Promise<{ response: { data: TurnSummary[]; nextCursor: string | null } }> = async () => ({ response: { data: this.currentTurns, nextCursor: null } });
  constructor(hostId: string) { this.hostId = hostId; }
  getHostId() { return this.hostId; }
  readThread() { return this.read(); }
  listThreadTurns() { return this.list(); }
  addNotificationCallback(_methods: string[], listener: (value: RpcMessage) => void, onError?: (error: Error) => void) {
    this.messages.add(listener); if (onError) this.errors.add(onError);
    return () => { this.messages.delete(listener); if (onError) this.errors.delete(onError); };
  }
  addThreadDeletedListener(listener: (id: string) => void, onError?: (error: Error) => void) {
    this.deleted.add(listener); if (onError) this.errors.add(onError);
    return () => { this.deleted.delete(listener); if (onError) this.errors.delete(onError); };
  }
  emit(method: string, params: unknown) {
    for (const listener of this.messages) listener({ method, params, seq: 1 });
  }
}

function harness(managers: FixtureManager[]) {
  let current: FixtureManager[] = managers;
  const subscriptions = new Map<string, Set<() => void>>();
  const hosts: NativeHosts = {
    getManagers: () => current,
    subscribe(hostId, listener) {
      const listeners = subscriptions.get(hostId) ?? new Set();
      listeners.add(listener); subscriptions.set(hostId, listeners);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    waiter: new ThreadWaiter(hosts, formatAssistantMessage),
    replace(next: FixtureManager[], hostId: string) {
      current = next;
      for (const listener of subscriptions.get(hostId) ?? []) listener();
    },
    assertClean() {
      for (const manager of managers.concat(current)) {
        assert.equal(manager.messages.size, 0, `${manager.hostId}: message listeners`);
        assert.equal(manager.deleted.size, 0, `${manager.hostId}: deletion listeners`);
        assert.equal(manager.errors.size, 0, `${manager.hostId}: error listeners`);
      }
      assert.ok([...subscriptions.values()].every(listeners => listeners.size === 0));
    },
  };
}

type WaitResult = { timedOut: boolean; wake: { reason: string; threadId: string; hostId: string; turnId?: string } | null;
  polls: { thread: { id: string; hostId: string; status: ThreadSummary['status'] }; cursor: string; revision: number;
    changed: boolean; cursorReset?: boolean; latestTurn: { id: string; status: string } | null;
    latestAssistantMessage: { text: string } | null }[]; errors?: { message: string }[] };
async function wait(waiter: ThreadWaiter, target: { hostId: string; afterCursor?: string }, timeoutMs = 0): Promise<WaitResult> {
  return await waiter.waitForThreads({ targets: [{ threadId: 'shared', ...target }], timeoutMs }) as WaitResult;
}
function complete(manager: FixtureManager, value: unknown) {
  manager.emit('turn/completed', { threadId: 'shared', turn: value });
}
function status(manager: FixtureManager, value: ThreadSummary['status']) {
  manager.emit('thread/status/changed', { threadId: 'shared', status: value });
}

test('fallback to another host discards old host completion before projecting the shared thread id', async () => {
  const a = new FixtureManager('host-a'), b = new FixtureManager('host-b');
  b.currentThread = thread({ type: 'idle' }); b.currentTurns = [];
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  let reads = 0;
  a.read = () => ++reads === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('thread not found: shared'));
  const h = harness([a, b]);
  const pending = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  complete(a, turn('a-only', 'completed', 'Private to A'));
  release.reject(new Error('read failed on A'));
  const result = await pending;
  assert.equal(result.wake?.hostId, 'host-b');
  assert.equal(result.wake?.reason, 'inactiveStatus');
  assert.equal(result.polls[0]?.thread.hostId, 'host-b');
  assert.equal(result.polls[0]?.latestTurn, null);
  assert.equal(result.polls[0]?.latestAssistantMessage, null);
  h.assertClean();
});

test('replacing a manager on the same host discards its old event and resets the cursor', async () => {
  const old = new FixtureManager('host-a'), replacement = new FixtureManager('host-a');
  const h = harness([old]);
  const first = await wait(h.waiter, { hostId: 'host-a' });
  replacement.currentThread = thread({ type: 'idle' }); replacement.currentTurns = [];
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  old.read = () => (started.resolve(), release.promise);
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  const lateListener = [...old.messages][0]!;
  const lateErrors = [...old.errors].slice(0, 2);
  const lateDeletions = [...old.deleted];
  complete(old, turn('old-generation', 'completed', 'Old generation'));
  h.replace([replacement], 'host-a');
  lateListener({ method: 'turn/completed', params: { threadId: 'shared', turn: turn('late-old', 'completed', 'Late old event') }, seq: 2 });
  for (const fail of lateErrors) fail(new Error('late old disconnect'));
  release.reject(new Error('old connection closed'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'inactiveStatus');
  assert.equal(result.polls[0]?.thread.hostId, 'host-a');
  assert.equal(result.polls[0]?.cursorReset, true);
  assert.equal(result.polls[0]?.latestTurn, null);
  assert.equal(result.polls[0]?.latestAssistantMessage, null);
  for (const deleted of lateDeletions) deleted('shared');
  const afterLateDeletion = await wait(h.waiter, { hostId: 'host-a', afterCursor: result.polls[0]!.cursor });
  assert.equal(afterLateDeletion.polls[0]?.cursorReset, undefined);
  assert.equal(afterLateDeletion.polls[0]?.changed, false);
  h.assertClean();
});

test('a manager replaced while waiting cannot carry its queued completion into the new generation', async () => {
  const old = new FixtureManager('host-a'), replacement = new FixtureManager('host-a');
  const h = harness([old]);
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>();
  old.list = async () => { started.resolve(); return { response: { data: old.currentTurns, nextCursor: null } }; };
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor }, 5_000);
  await started.promise;
  await setImmediate();
  replacement.currentThread = thread({ type: 'idle' }); replacement.currentTurns = [];
  complete(old, turn('old-generation', 'completed', 'Old event'));
  h.replace([replacement], 'host-a');
  const result = await pending;
  assert.equal(result.wake?.reason, 'inactiveStatus');
  assert.equal(result.polls[0]?.cursorReset, true);
  assert.equal(result.polls[0]?.latestTurn, null);
  assert.equal(result.polls[0]?.latestAssistantMessage, null);
  h.assertClean();
});

test('callbacks queued after cleanup cannot remove the current projection', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  manager.read = () => (started.resolve(), release.promise);
  const pending = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  const lateDeletions = [...manager.deleted];
  release.resolve({ thread: manager.currentThread });
  const first = await pending;
  for (const deleted of lateDeletions) deleted('shared');
  manager.read = async () => ({ thread: manager.currentThread });
  const afterLateDeletion = await wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  assert.equal(afterLateDeletion.polls[0]?.cursorReset, undefined);
  assert.equal(afterLateDeletion.polls[0]?.changed, false);
  h.assertClean();
});

test('manager replacement during fallback reread drops the original event', async () => {
  const old = new FixtureManager('host-a'), replacement = new FixtureManager('host-a');
  const h = harness([old]);
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const firstStarted = deferred<void>(), firstRead = deferred<{ thread: ThreadSummary }>();
  const rereadStarted = deferred<void>(), reread = deferred<{ thread: ThreadSummary }>();
  let reads = 0;
  old.read = () => {
    if (++reads === 1) { firstStarted.resolve(); return firstRead.promise; }
    if (reads === 2) return Promise.resolve({ thread: old.currentThread });
    rereadStarted.resolve(); return reread.promise;
  };
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await firstStarted.promise;
  complete(old, turn('old-generation', 'completed', 'Old final'));
  firstRead.reject(new Error('initial read unavailable'));
  await rereadStarted.promise;
  replacement.currentThread = thread({ type: 'idle' }); replacement.currentTurns = [];
  h.replace([replacement], 'host-a');
  reread.reject(new Error('old connection closed'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'inactiveStatus');
  assert.equal(result.polls[0]?.cursorReset, true);
  assert.equal(result.polls[0]?.latestTurn, null);
  assert.equal(result.polls[0]?.latestAssistantMessage, null);
  h.assertClean();
});

for (const timing of ['initial-refresh', 'waiting-refresh'] as const) {
  test(`manager replacement during ${timing} drops the old completion and reads the replacement`, async () => {
    const old = new FixtureManager('host-a'), replacement = new FixtureManager('host-a');
    const h = harness([old]);
    const first = await wait(h.waiter, { hostId: 'host-a' });
    const firstStarted = deferred<void>(), releaseFirst = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
    const refreshStarted = deferred<void>(), releaseRefresh = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
    let lists = 0;
    old.list = () => {
      if (++lists === 1) {
        firstStarted.resolve();
        return timing === 'initial-refresh' ? releaseFirst.promise : Promise.resolve({ response: { data: old.currentTurns, nextCursor: null } });
      }
      refreshStarted.resolve(); return releaseRefresh.promise;
    };
    const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor }, 5_000);
    await firstStarted.promise;
    if (timing === 'waiting-refresh') await setImmediate();
    complete(old, turn('old-generation', 'completed', 'Old final'));
    if (timing === 'initial-refresh') releaseFirst.resolve({ response: { data: old.currentTurns, nextCursor: null } });
    await refreshStarted.promise;
    replacement.currentThread = thread({ type: 'idle' }); replacement.currentTurns = [];
    h.replace([replacement], 'host-a');
    releaseRefresh.resolve({ response: { data: old.currentTurns, nextCursor: null } });
    const result = await pending;
    assert.equal(result.wake?.reason, 'inactiveStatus');
    assert.equal(result.polls[0]?.cursorReset, true);
    assert.equal(result.polls[0]?.latestTurn, null);
    assert.equal(result.polls[0]?.latestAssistantMessage, null);
    h.assertClean();
  });
}

test('completion during initial read commits final text and revision when the same manager cannot reread', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>(), release = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('history temporarily unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  complete(manager, turn('turn-1', 'completed', 'Final **answer**'));
  release.reject(new Error('history temporarily unavailable'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'turnCompleted');
  assert.equal(result.wake?.turnId, 'turn-1');
  assert.equal(result.polls[0]?.latestTurn?.status, 'completed');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'Final answer');
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision + 1);
  h.assertClean();
});

test('complete event and observed status build the first projection even when initial and fallback reads fail', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  let reads = 0;
  manager.read = () => ++reads === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('read unavailable'));
  manager.list = async () => { await release.promise; throw new Error('history unavailable'); };
  const pending = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  complete(manager, turn('turn-1', 'completed', 'Observed final'));
  status(manager, { type: 'idle' });
  release.reject(new Error('read unavailable'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'turnCompleted');
  assert.equal(result.polls[0]?.thread.hostId, 'host-a');
  assert.equal(result.polls[0]?.thread.status.type, 'idle');
  assert.equal(result.polls[0]?.latestTurn?.status, 'completed');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'Observed final');
  assert.equal(result.polls[0]?.revision, 1);
  h.assertClean();
});

test('first completion uses a successful thread read when history rereads fail', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>(), release = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('history unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  complete(manager, turn('turn-1', 'completed', 'Final without cached snapshot'));
  release.reject(new Error('history unavailable'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'turnCompleted');
  assert.equal(result.polls[0]?.latestTurn?.status, 'completed');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'Final without cached snapshot');
  assert.equal(result.polls[0]?.revision, 1);
  h.assertClean();
});

test('first approval uses a successful turn read when thread reads fail', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  let reads = 0;
  manager.read = () => ++reads === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('thread read unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  await setImmediate();
  status(manager, { type: 'active', activeFlags: ['waitingOnApproval'] });
  release.reject(new Error('thread read unavailable'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'actionableStatus');
  assert.deepEqual(result.polls[0]?.thread.status, { type: 'active', activeFlags: ['waitingOnApproval'] });
  assert.equal(result.polls[0]?.latestTurn?.id, 'turn-1');
  assert.equal(result.polls[0]?.latestTurn?.status, 'inProgress');
  assert.equal(result.polls[0]?.revision, 1);
  h.assertClean();
});

test('approval includes a newer turn from the successful half of a failed reread', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  manager.currentThread = thread({ type: 'idle' }); manager.currentTurns = [];
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  let reads = 0;
  manager.read = () => ++reads === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('thread read unavailable'));
  manager.currentTurns = [turn('new-turn', 'inProgress', 'New progress', 2)];
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  await setImmediate();
  status(manager, { type: 'active', activeFlags: ['waitingOnApproval'] });
  release.reject(new Error('thread read unavailable'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'actionableStatus');
  assert.equal(result.polls[0]?.latestTurn?.id, 'new-turn');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'New progress');
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision + 1);
  h.assertClean();
});

test('an older partial read cannot replace a newer committed turn during approval projection', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  let reads = 0, lists = 0;
  manager.read = () => ++reads === 1 ? (started.resolve(), release.promise) : Promise.resolve({ thread: manager.currentThread });
  manager.list = async () => ({ response: { data: [++lists === 1
    ? turn('old-turn', 'inProgress', 'Old progress', 1) : turn('new-turn', 'inProgress', 'New progress', 2)], nextCursor: null } });
  const older = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  const newer = await wait(h.waiter, { hostId: 'host-a' });
  assert.equal(newer.polls[0]?.latestTurn?.id, 'new-turn');
  status(manager, { type: 'active', activeFlags: ['waitingOnApproval'] });
  manager.read = async () => { throw new Error('thread read unavailable'); };
  release.reject(new Error('old thread read failed'));
  const result = await older;
  assert.equal(result.wake?.reason, 'actionableStatus');
  assert.equal(result.polls[0]?.latestTurn?.id, 'new-turn');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'New progress');
  h.assertClean();
});

test('actionable status after the first snapshot updates the stored projection when reread fails', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>();
  manager.list = async () => { started.resolve(); return { response: { data: manager.currentTurns, nextCursor: null } }; };
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor }, 5_000);
  await started.promise;
  await setImmediate();
  manager.list = async () => { throw new Error('history temporarily unavailable'); };
  status(manager, { type: 'active', activeFlags: ['waitingOnApproval'] });
  const result = await pending;
  assert.equal(result.wake?.reason, 'actionableStatus');
  assert.deepEqual(result.polls[0]?.thread.status, { type: 'active', activeFlags: ['waitingOnApproval'] });
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision + 1);
  h.assertClean();
});

test('completion after the first snapshot updates final text and revision when reread fails', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>();
  manager.list = async () => { started.resolve(); return { response: { data: manager.currentTurns, nextCursor: null } }; };
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor }, 5_000);
  await started.promise;
  await setImmediate();
  manager.list = async () => { throw new Error('history unavailable'); };
  complete(manager, turn('turn-1', 'completed', 'Final after snapshot'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'turnCompleted');
  assert.equal(result.polls[0]?.latestTurn?.status, 'completed');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'Final after snapshot');
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision + 1);
  h.assertClean();
});

test('partial completion merges only a cached matching turn and preserves its known text', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  manager.currentTurns = [turn('turn-1', 'inProgress', 'Known progress')];
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>(), release = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('history unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  complete(manager, { id: 'turn-1', status: 'completed', itemsView: 'notLoaded', error: null });
  release.reject(new Error('history unavailable'));
  const result = await pending;
  assert.equal(result.wake?.turnId, 'turn-1');
  assert.equal(result.polls[0]?.latestTurn?.status, 'completed');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'Known progress');
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision + 1);
  h.assertClean();
});

test('insufficient event data returns an error instead of a successful stale projection', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  let reads = 0;
  manager.read = () => ++reads === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('read unavailable'));
  manager.list = async () => { await release.promise; throw new Error('history unavailable'); };
  const pending = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  complete(manager, { id: 'turn-1', status: 'completed', itemsView: 'notLoaded' });
  status(manager, { type: 'idle' });
  release.reject(new Error('read unavailable'));
  const result = await pending;
  assert.equal(result.wake, null);
  assert.equal(result.polls.length, 0);
  assert.match(result.errors?.[0]?.message ?? '', /unavailable|insufficient/i);
  h.assertClean();
});

test('approval without a turn snapshot returns an error when both reads fail', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>(), release = deferred<{ thread: ThreadSummary }>();
  let reads = 0;
  manager.read = () => ++reads === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('read unavailable'));
  manager.list = async () => { await release.promise; throw new Error('history unavailable'); };
  const pending = wait(h.waiter, { hostId: 'host-a' });
  await started.promise;
  status(manager, { type: 'active', activeFlags: ['waitingOnApproval'] });
  release.reject(new Error('read unavailable'));
  const result = await pending;
  assert.equal(result.wake, null);
  assert.equal(result.polls.length, 0);
  assert.match(result.errors?.[0]?.message ?? '', /turn snapshot is unavailable/i);
  h.assertClean();
});

test('cancelling a passive wait detaches its manager and host listeners', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const started = deferred<void>();
  manager.list = async () => { started.resolve(); return { response: { data: manager.currentTurns, nextCursor: null } }; };
  const controller = new AbortController();
  const pending = h.waiter.waitForThreads({ targets: [{ threadId: 'shared', hostId: 'host-a' }], timeoutMs: 5_000, signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started.promise;
  await setImmediate();
  controller.abort();
  await rejected;
  await setImmediate();
  h.assertClean();
});

test('a current deletion terminates the wait and clears that thread projection', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>();
  manager.list = async () => { started.resolve(); return { response: { data: manager.currentTurns, nextCursor: null } }; };
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor }, 5_000);
  await started.promise;
  await setImmediate();
  for (const deleted of manager.deleted) deleted('shared');
  const result = await pending;
  assert.equal(result.wake, null);
  assert.match(result.errors?.[0]?.message ?? '', /deleted/);
  const afterDeletion = await wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  assert.equal(afterDeletion.polls[0]?.cursorReset, true);
  h.assertClean();
});

test('older completion cannot replace a confirmed newer turn when reread fails', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  manager.currentTurns = [turn('new-turn', 'inProgress', 'New progress', 2)];
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>(), release = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('history unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  complete(manager, turn('old-turn', 'completed', 'Old result', 1));
  release.reject(new Error('history unavailable'));
  const result = await pending;
  assert.equal(result.wake, null);
  assert.equal(result.polls[0]?.latestTurn?.id, 'new-turn');
  assert.equal(result.polls[0]?.latestTurn?.status, 'inProgress');
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision);
  h.assertClean();
});

test('a repeated older terminal event cannot replace an already confirmed final for the same turn', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  manager.currentThread = thread({ type: 'idle' });
  manager.currentTurns = [turn('turn-1', 'completed', 'Confirmed final')];
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>(), release = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('history unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  complete(manager, turn('turn-1', 'completed', 'Older final'));
  release.reject(new Error('history unavailable'));
  const result = await pending;
  assert.equal(result.wake, null);
  assert.equal(result.polls[0]?.changed, false);
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision);
  manager.list = async () => ({ response: { data: manager.currentTurns, nextCursor: null } });
  const visible = await wait(h.waiter, { hostId: 'host-a' });
  assert.equal(visible.polls[0]?.latestAssistantMessage?.text, 'Confirmed final');
  h.assertClean();
});

test('a full terminal event fills a missing final for the same previously completed turn', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  manager.currentThread = thread({ type: 'idle' });
  manager.currentTurns = [turn('turn-1', 'completed')];
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>(), release = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('history unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  complete(manager, turn('turn-1', 'completed', 'New final'));
  release.reject(new Error('history unavailable'));
  const result = await pending;
  assert.equal(result.wake?.reason, 'turnCompleted');
  assert.equal(result.polls[0]?.latestAssistantMessage?.text, 'New final');
  assert.equal(result.polls[0]?.revision, first.polls[0]!.revision + 1);
  h.assertClean();
});

test('a full terminal event replaces unphased progress retained from a partial terminal event', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  const running = turn('turn-1', 'inProgress', 'Unphased progress');
  running.items[0]!.phase = null;
  manager.currentTurns = [running];
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const partialStarted = deferred<void>(), partialRelease = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (partialStarted.resolve(), partialRelease.promise) : Promise.reject(new Error('history unavailable'));
  const partialPending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await partialStarted.promise;
  complete(manager, { id: 'turn-1', status: 'completed', itemsView: 'notLoaded', error: null });
  partialRelease.reject(new Error('history unavailable'));
  const partial = await partialPending;
  assert.equal(partial.polls[0]?.latestAssistantMessage?.text, 'Unphased progress');

  const fullStarted = deferred<void>(), fullRelease = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  lists = 0;
  manager.list = () => ++lists === 1 ? (fullStarted.resolve(), fullRelease.promise) : Promise.reject(new Error('history unavailable'));
  const fullPending = wait(h.waiter, { hostId: 'host-a', afterCursor: partial.polls[0]!.cursor });
  await fullStarted.promise;
  complete(manager, turn('turn-1', 'completed', 'Actual final'));
  fullRelease.reject(new Error('history unavailable'));
  const full = await fullPending;
  assert.equal(full.wake?.reason, 'turnCompleted');
  assert.equal(full.polls[0]?.latestAssistantMessage?.text, 'Actual final');
  assert.equal(full.polls[0]?.revision, partial.polls[0]!.revision + 1);
  h.assertClean();
});

test('an event for another turn with unknown order reports an error', async () => {
  const manager = new FixtureManager('host-a'), h = harness([manager]);
  manager.currentTurns = [turn('known-turn', 'inProgress', 'Current progress')];
  const first = await wait(h.waiter, { hostId: 'host-a' });
  const started = deferred<void>(), release = deferred<{ response: { data: TurnSummary[]; nextCursor: string | null } }>();
  let lists = 0;
  manager.list = () => ++lists === 1 ? (started.resolve(), release.promise) : Promise.reject(new Error('history unavailable'));
  const pending = wait(h.waiter, { hostId: 'host-a', afterCursor: first.polls[0]!.cursor });
  await started.promise;
  complete(manager, turn('unknown-turn', 'completed', 'Unknown order'));
  release.reject(new Error('history unavailable'));
  const result = await pending;
  assert.equal(result.wake, null);
  assert.equal(result.polls.length, 0);
  assert.match(result.errors?.[0]?.message ?? '', /turn order is unknown/);
  h.assertClean();
});
