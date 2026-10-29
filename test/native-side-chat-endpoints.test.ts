import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSideChatEndpointHost } from '../src/native/side-chat-host.ts';
import type { SideChatEndpointAccess, SideChatEndpointDependencies, SideChatEndpointReply, SideChatEndpointScope, SideChatEndpointStore } from '../src/native/side-chat-host.ts';
import type { SideChatOperation, SideChatParent } from '../src/native/side-chat.ts';
import type { LateRpcTerminal } from '../lib/codex-protocol.ts';
import { SideChatController } from '../src/renderer/side-chat/controller.ts';
import type { SideChatHostPort } from '../src/renderer/side-chat/types.ts';

type Value = Record<string, unknown>;
type Call = { scope: SideChatEndpointScope | Omit<SideChatEndpointScope, 'operationId' | 'childThreadId'>;
  method: string; params: Value; late?: (terminal: LateRpcTerminal) => void | Promise<void> };

class Store implements SideChatEndpointStore {
  readonly operations = new Map<string, SideChatOperation>();
  readonly prepared = new Map<string, string>();
  chain: Promise<unknown> = Promise.resolve();
  fail?: (next: SideChatOperation, previous: SideChatOperation) => boolean;

  async create(operation: SideChatOperation): Promise<void> {
    if (this.operations.has(operation.operationId)) throw new Error('duplicate');
    this.operations.set(operation.operationId, structuredClone(operation));
  }
  async read(operationId: string): Promise<SideChatOperation | null> {
    await this.chain.catch(() => {});
    return structuredClone(this.operations.get(operationId) ?? null);
  }
  async update(operationId: string, update: (value: SideChatOperation) => SideChatOperation): Promise<SideChatOperation> {
    const work = this.chain.catch(() => {}).then(() => {
      const previous = this.operations.get(operationId);
      if (!previous) throw new Error('missing PRIVATE_STORE_ERROR');
      const next = update(structuredClone(previous));
      if (this.fail?.(next, previous)) throw new Error('PRIVATE_STORE_ERROR');
      this.operations.set(operationId, structuredClone(next));
      return structuredClone(next);
    });
    this.chain = work;
    return work;
  }
  async readPrepared(id: string): Promise<SideChatOperation | null> {
    await this.chain.catch(() => {});
    const operationId = this.prepared.get(id);
    return operationId ? structuredClone(this.operations.get(operationId) ?? null) : null;
  }
  async createPrepared(id: string, operation: SideChatOperation): Promise<SideChatOperation> {
    const work = this.chain.catch(() => {}).then(() => {
      const existing = this.prepared.get(id);
      if (existing) return structuredClone(this.operations.get(existing)!);
      this.operations.set(operation.operationId, structuredClone(operation));
      this.prepared.set(id, operation.operationId);
      return structuredClone(operation);
    });
    this.chain = work;
    return work;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for synthetic peer');
}

function fixture() {
  const store = new Store();
  const calls: Call[] = [];
  const barriers: SideChatEndpointScope[] = [];
  const cleanups: SideChatEndpointScope[] = [];
  const notifications: { hostId: string; operationId: string }[] = [];
  const accessLog: SideChatEndpointAccess[] = [];
  const parent: SideChatParent = {
    hostId: 'host-a', threadId: 'parent-a', connectionGeneration: 'socket-1', cwd: '/workspace/a',
    workspaceRoots: ['/workspace/a', '/workspace/shared'], archived: false, model: 'model-a', modelProvider: 'provider-a',
    effort: null, serviceTier: null, sandboxPolicy: { type: 'readOnly', networkAccess: false }, project: { secret: 'PRIVATE_PROJECT' },
    submitOptions: { model: 'model-a', effort: null, approvalPolicy: 'on-request', approvalsReviewer: 'user',
      mode: 'plan', serviceTier: null, custom: 'PRIVATE_OPTION' },
    forkConfig: { model_reasoning_effort: null, secret: 'PRIVATE_CONFIG' },
  };
  let generation = 'socket-1', available = true, linked = true, stopped = false, closeBlocked = false;
  let handler: ((call: Call) => Promise<unknown>) | undefined;
  const deps: SideChatEndpointDependencies = {
    store,
    ownerId: 'original-host-process',
    async resolveParent(hostId, threadId) {
      if (hostId !== parent.hostId || threadId !== parent.threadId) throw new Error('PRIVATE_PARENT');
      return structuredClone(parent);
    },
    async withParent(hostId, threadId, run) {
      if (!available || hostId !== parent.hostId || threadId !== parent.threadId) throw new Error('PRIVATE_AUTH');
      return run();
    },
    async withScope(scope, access, run) {
      accessLog.push(access);
      if (scope.hostId !== parent.hostId || scope.parentThreadId !== parent.threadId) throw new Error('PRIVATE_SCOPE');
      if (access.kind === 'dispatch' && (!available || !linked || scope.connectionGeneration !== generation
        || closeBlocked && (access.action === 'close' || access.closeRequested))) throw new Error('PRIVATE_FENCE');
      return run();
    },
    canReconcile(scope) { return available && scope.connectionGeneration === generation; },
    assertDispatch(scope, action, phase) {
      if (!available || !linked || scope.connectionGeneration !== generation
        || closeBlocked && (action === 'close' || phase === 'close-intent')) throw new Error('PRIVATE_FENCE');
    },
    async request(scope, method, params, _mutating, late) {
      if (!available || scope.hostId !== parent.hostId || scope.parentThreadId !== parent.threadId
        || scope.connectionGeneration !== generation) throw Object.assign(new Error('PRIVATE_SOCKET'), { delivery: 'not-sent' });
      const call: Call = { scope: structuredClone(scope), method, params: structuredClone(params), late };
      calls.push(call);
      if (method === 'config/read') return { config: { developer_instructions: 'PRIVATE_DEVELOPER', api_key: 'PRIVATE_KEY' } };
      return handler ? handler(call) : result(call);
    },
    async requestFork(scope, _attemptId, params, late) {
      return { result: await deps.request(scope, 'thread/fork', params, true, late), eventCursor: 7 };
    },
    classifyFailure(_method, error) {
      return typeof error === 'object' && error !== null && 'delivery' in error
        ? (error as { delivery: 'not-sent' | 'rejected' | 'unknown' }).delivery : 'unknown';
    },
    async prepareClose(scope) {
      if (!available || scope.connectionGeneration !== generation) throw new Error('PRIVATE_CLOSE');
      barriers.push(structuredClone(scope));
    },
    async cleanup(scope) { cleanups.push(structuredClone(scope)); },
    ownerStopped: () => stopped,
    notify: hint => { notifications.push(structuredClone(hint)); },
  };
  function result(call: Call): unknown {
    if (call.method === 'thread/fork') return {
      thread: { id: 'child-a', name: null, cwd: parent.cwd, turns: [], status: { type: 'idle' },
        ephemeral: true, forkedFromId: parent.threadId, secret: 'PRIVATE_THREAD' },
      cwd: parent.cwd, runtimeWorkspaceRoots: parent.workspaceRoots, model: parent.model, modelProvider: parent.modelProvider,
      reasoningEffort: parent.effort, serviceTier: 'default', approvalPolicy: 'on-request', approvalsReviewer: 'user',
      sandbox: parent.sandboxPolicy, activePermissionProfile: null, secret: 'PRIVATE_RECEIPT',
    };
    if (call.method === 'thread/inject_items') return {};
    if (call.method === 'thread/unsubscribe') return { status: 'unsubscribed', secret: 'PRIVATE_RECEIPT' };
    throw new Error('unexpected request');
  }
  return { store, deps, calls, barriers, cleanups, notifications, accessLog, result,
    host: createSideChatEndpointHost(deps),
    handle(fn: (call: Call) => Promise<unknown>) { handler = fn; },
    setGeneration(value: string) { generation = value; },
    setAvailable(value: boolean) { available = value; },
    setLinked(value: boolean) { linked = value; },
    setCloseBlocked(value: boolean) { closeBlocked = value; },
    setParentOptions(value: Value) { parent.submitOptions = value; },
    setStopped(value: boolean) { stopped = value; } };
}

const parent = { hostId: 'host-a', parentThreadId: 'parent-a' };
const input = (reply: SideChatEndpointReply) => ({ ...parent, operationId: reply.view.operationId, purpose: 'reconcile' as const });
let nextForkDispatch = 0;
function action(reply: SideChatEndpointReply) {
  assert.ok(reply.token);
  return { ...input(reply), token: reply.token, forkDispatchId: 'fixture-dispatch-' + ++nextForkDispatch };
}
function unsent(error: unknown): boolean {
  return error instanceof Error && 'uncertain' in error && error.uncertain === false && !error.message.includes('PRIVATE');
}

test('prepare deduplicates and the real E lifecycle projects only safe original scope fields', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'prepare-1' });
  const duplicate = await f.host.prepare({ ...parent, prepareId: 'prepare-1' });
  assert.equal(duplicate.view.operationId, prepared.view.operationId);
  assert.equal(f.store.operations.size, 1);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
  assert.equal(prepared.view.fork.status, 'waiting');
  const ready = await f.host.start(action(prepared));
  assert.equal(ready.view.fork.status, 'received');
  assert.equal(ready.view.inject.status, 'received');
  assert.deepEqual(ready.view.child, { thread: { id: 'child-a', name: null, cwd: '/workspace/a', turns: [], status: { type: 'idle' },
    ephemeral: true, forkedFromId: 'parent-a' },
  options: { model: 'model-a', effort: null, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only', serviceTier: 'default' },
  modelProvider: 'provider-a', sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null,
  runtimeWorkspaceRoots: ['/workspace/a', '/workspace/shared'] });
  assert.deepEqual(ready.view.fork.receipt, { connectionGeneration: 'socket-1',
    attemptId: (await f.store.read(prepared.view.operationId))!.fork.attemptId, eventCursor: 7 });
  const fork = f.calls.find(call => call.method === 'thread/fork')!;
  assert.equal(fork.params.ephemeral, true);
  assert.equal(Object.hasOwn(fork.params, 'deferGoalContinuation'), false);
  assert.equal(Object.hasOwn(fork.params.config as object, 'model_reasoning_effort'), false);
  assert.match(String(fork.params.developerInstructions), /PRIVATE_DEVELOPER/);
  assert.equal('token' in fork.scope, false);
  assert.doesNotMatch(JSON.stringify(ready.view), /PRIVATE|developerInstructions|endpointFence|forkParams/);
  const closed = await f.host.close(action(ready));
  assert.equal(closed.view.close.status, 'closed');
  assert.equal(f.barriers.length, 1); assert.equal(f.cleanups.length, 1);
  assert.equal(f.barriers[0].operationId, prepared.view.operationId);
  assert.equal(f.barriers[0].childThreadId, 'child-a');
  assert.deepEqual(f.calls.map(call => call.method), ['config/read', 'thread/fork', 'thread/inject_items', 'thread/unsubscribe']);
  assert.ok(f.notifications.every(hint => hint.hostId === 'host-a' && hint.operationId === prepared.view.operationId));
});

test('concurrent prepare calls with one durable identity create only one operation', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.host.prepare({ ...parent, prepareId: 'same-prepare' }),
    f.host.prepare({ ...parent, prepareId: 'same-prepare' }),
  ]);
  assert.equal(results[0].view.operationId, results[1].view.operationId);
  assert.equal(f.store.operations.size, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
  const ready = await f.host.start(action(results[0]));
  assert.equal(ready.view.inject.status, 'received');
  await assert.rejects(f.host.start(action(results[1])), unsent);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
});

test('a fence copied from another operation with the same parent is not accepted', async () => {
  const f = fixture();
  const first = await f.host.prepare({ ...parent, prepareId: 'copy-1' });
  const second = await f.host.prepare({ ...parent, prepareId: 'copy-2' });
  const source = await f.store.read(first.view.operationId) as SideChatOperation & { endpointFence: unknown };
  await f.store.update(second.view.operationId, operation => ({ ...operation, endpointFence: source.endpointFence }));
  const view = await f.host.read(input(second));
  assert.equal(view.token, null);
  assert.equal(view.view.settledCalls, undefined);
  await assert.rejects(f.host.start({ ...input(second), token: first.token! }), unsent);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
});

test('cross-page old tokens and late requests cannot pass the atomic read fence', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'race' });
  const beforeRead = action(prepared);
  const latest = await f.host.read(input(prepared));
  assert.equal(latest.view.settledCalls?.start, true);
  await assert.rejects(f.host.start(beforeRead), unsent);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
  const pending = deferred<unknown>();
  f.handle(async call => call.method === 'thread/fork' ? pending.promise : f.result(call));
  const running = f.host.start(action(latest));
  await eventually(() => f.calls.some(call => call.method === 'thread/fork'));
  const mid = await f.host.read(input(prepared));
  assert.equal(mid.view.settledCalls?.start, undefined);
  assert.equal(mid.view.settledCalls, undefined); assert.equal(mid.token, null);
  await assert.rejects(f.host.close({ ...input(mid), token: latest.token! }), unsent);
  await assert.rejects(f.host.start(action(latest)), unsent);
  pending.resolve(f.result(f.calls.find(call => call.method === 'thread/fork')!));
  const finished = await running;
  assert.equal(finished.view.inject.status, 'received');
  const after = await f.host.read(input(prepared));
  assert.equal(after.view.settledCalls?.start, true);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
});

test('host, parent, operation, draft linkage and original generation are checked before dispatch', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'scope' });
  await assert.rejects(f.host.read({ ...input(prepared), hostId: 'host-b' }));
  await assert.rejects(f.host.start({ ...action(prepared), parentThreadId: 'parent-b' }), unsent);
  await assert.rejects(f.host.prepare({ hostId: 'host-a', parentThreadId: 'parent-b', prepareId: 'scope' }));
  f.setLinked(false);
  await assert.rejects(f.host.start(action(prepared)), unsent);
  f.setLinked(true); f.setAvailable(false);
  const readable = await f.host.read(input(prepared));
  assert.equal(readable.token, null);
  await assert.rejects(f.host.start(action(prepared)), unsent);
  f.setAvailable(true); f.setGeneration('socket-2');
  await assert.rejects(f.host.start(action(prepared)), unsent);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
  assert.equal((await f.host.read(input(prepared))).view.fork.status, 'waiting');
});

test('a revoked browser grant between scope authorization and claim cannot write the claim or close intent', async () => {
  const f = fixture(), prepared = await f.host.prepare({ ...parent, prepareId: 'revoke-before-claim' });
  const original = f.deps.withScope;
  f.deps.withScope = (scope, access, run) => original(scope, access, async () => {
    if (access.kind === 'dispatch') f.setCloseBlocked(true);
    return run();
  });
  await assert.rejects(f.host.close(action(prepared)), unsent);
  const operation = await f.store.read(prepared.view.operationId);
  assert.equal(operation!.close.requested, false);
  assert.equal((operation as unknown as { endpointFence: { active: unknown } }).endpointFence.active, null);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
});

test('a revoked browser grant after claim cannot publish close.requested, including a childless close', async () => {
  const f = fixture(), prepared = await f.host.prepare({ ...parent, prepareId: 'revoke-before-close-intent' });
  const before = await f.store.read(prepared.view.operationId);
  const original = f.deps.assertDispatch;
  f.deps.assertDispatch = (scope, action, phase) => {
    original(scope, action, phase);
    if (phase === 'claim') queueMicrotask(() => f.setCloseBlocked(true));
  };
  await assert.rejects(f.host.close(action(prepared)));
  const operation = await f.store.read(prepared.view.operationId);
  assert.equal(operation!.close.requested, false);
  assert.deepEqual(operation!.close, before!.close);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
});

test('generation changes after the claim are fenced again at the actual send', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'generation' });
  const underlying = f.deps.withScope;
  f.deps.withScope = async (scope, mode, run) => underlying(scope, mode, async () => {
    const result = await run();
    if (mode.kind === 'dispatch') f.setGeneration('socket-2');
    return result;
  });
  const result = await f.host.start(action(prepared));
  assert.equal(result.view.fork.status, 'not-sent');
  assert.doesNotMatch(JSON.stringify(result.view), /PRIVATE_SOCKET/);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
  const after = await f.host.read(input(prepared));
  assert.equal(after.token, null);
  await assert.rejects(f.host.retry(action(prepared)), unsent);
  assert.equal((await f.host.read(input(prepared))).view.childId, null);
});

test('the scoped claim exposes close intent so the host can enforce the original draft barrier', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'close-authority' });
  const ready = await f.host.start(action(prepared));
  f.setCloseBlocked(true);
  await assert.rejects(f.host.close(action(ready)), unsent);
  assert.deepEqual(f.accessLog.at(-1), { kind: 'dispatch', action: 'close', closeRequested: false });
  assert.equal((await f.host.read(input(prepared))).view.close.requested, false);
  assert.equal(f.barriers.length, 0);
  f.setCloseBlocked(false);
  f.handle(async call => {
    if (call.method === 'thread/unsubscribe') throw Object.assign(new Error('timeout'), { delivery: 'unknown' });
    return f.result(call);
  });
  let current = await f.host.read(input(prepared));
  current = await f.host.close(action(current));
  assert.equal(current.view.close.status, 'unknown');
  f.setCloseBlocked(true);
  current = await f.host.read(input(prepared));
  await assert.rejects(f.host.retryPersistence(action(current)), unsent);
  assert.deepEqual(f.accessLog.at(-1), { kind: 'dispatch', action: 'retryPersistence', closeRequested: true });
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
});

test('a close intent changed by another page invalidates the earlier authorization', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'close-intent-race' });
  const underlying = f.deps.withScope;
  let changed = false;
  f.deps.withScope = async (scope, access, run) => underlying(scope, access, async () => {
    if (access.kind === 'dispatch' && !changed) {
      changed = true;
      await f.store.update(scope.operationId, operation => ({ ...operation, close: { ...operation.close, requested: true } }));
    }
    return run();
  });
  await assert.rejects(f.host.start(action(prepared)), unsent);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
  const current = await f.host.read(input(prepared));
  assert.equal(current.view.close.requested, true);
});

test('a late original fork cannot inject on a replacement connection', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'late-socket' });
  f.handle(async call => {
    if (call.method === 'thread/fork') throw Object.assign(new Error('timeout'), { delivery: 'unknown' });
    return f.result(call);
  });
  const unknown = await f.host.start(action(prepared));
  assert.equal(unknown.view.fork.status, 'unknown');
  f.setGeneration('socket-2');
  const fork = f.calls.find(call => call.method === 'thread/fork')!;
  await fork.late!({ outcome: 'success', result: f.result(fork), eventCursor: 7 });
  await eventually(async () => {
    try { return (await f.host.read(input(prepared))).view.inject.status === 'not-sent'; } catch { return false; }
  });
  const view = await f.host.read(input(prepared));
  assert.equal(view.view.childId, 'child-a');
  assert.equal(view.view.inject.status, 'not-sent');
  assert.equal(view.token, null);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
  await assert.rejects(f.host.retry({ ...input(view), token: unknown.token! }), unsent);
});

test('a changed stored generation invalidates the frozen origin before a late continuation', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'tampered-origin' });
  f.handle(async call => {
    if (call.method === 'thread/fork') throw Object.assign(new Error('timeout'), { delivery: 'unknown' });
    return f.result(call);
  });
  await f.host.start(action(prepared));
  await f.store.update(prepared.view.operationId, operation => ({ ...operation,
    parent: { ...operation.parent, connectionGeneration: 'socket-2' } }));
  f.setGeneration('socket-2');
  const fork = f.calls.find(call => call.method === 'thread/fork')!;
  const notifications = f.notifications.length;
  await fork.late!({ outcome: 'success', result: f.result(fork), eventCursor: 7 });
  await eventually(() => f.notifications.length > notifications);
  const view = await f.host.read(input(prepared));
  assert.equal(view.token, null);
  assert.equal(view.view.settledCalls, undefined);
  assert.match(view.view.recoveryError ?? '', /围栏不可确认/);
  assert.equal(view.view.fork.status, 'unknown');
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
  await assert.rejects(f.host.retry({ ...input(prepared), token: prepared.token! }), unsent);
});

test('the accepted H controller resolves a lost response through the actual scoped endpoint fence', async () => {
  const f = fixture();
  let token: string | null = null;
  let operationId = '';
  let linked = false;
  const scoped = () => ({ ...parent, operationId, purpose: 'reconcile' as const });
  const accept = (reply: SideChatEndpointReply) => { token = reply.token; return reply.view; };
  const dispatch = async (actionName: 'start' | 'retry' | 'close' | 'retryPersistence') => {
    assert.ok(token);
    const result = await f.host[actionName]({ ...scoped(), token, forkDispatchId: 'controller-dispatch-' + ++nextForkDispatch });
    if (actionName === 'start') throw new Error('synthetic response lost');
    return accept(result);
  };
  const port: SideChatHostPort = {
    async prepare(hostId, parentThreadId) {
      const result = await f.host.prepare({ hostId, parentThreadId, prepareId: 'controller' });
      operationId = result.view.operationId;
      return accept(result);
    },
    start: () => dispatch('start'), retry: () => dispatch('retry'), close: () => dispatch('close'),
    retryPersistence: () => dispatch('retryPersistence'),
    async read() { return accept(await f.host.read(scoped())); },
    subscribe: () => () => {},
  };
  const controller = new SideChatController({ ...parent, draftId: 'draft-a', port,
    async onPrepared(scope) { assert.equal(scope.operationId, operationId); linked = true; },
    canDispatch: () => linked });
  await controller.start();
  assert.match(controller.getSnapshot().error ?? '', /未确认/);
  assert.equal(controller.getSnapshot().view?.fork.status, 'waiting');
  await controller.read();
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(controller.getSnapshot().phase, 'ready');
  assert.equal(controller.getSnapshot().view?.childId, 'child-a');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
  controller.dispose();
});

test('an unrepresentable approval option never silently becomes a default child permission', async () => {
  const f = fixture();
  f.setParentOptions({ model: 'model-a', approvalPolicy: 'on-failure', approvalsReviewer: 'user' });
  f.handle(async call => {
    const result = f.result(call);
    if (call.method === 'thread/fork') return { ...(result as Value), approvalPolicy: 'on-failure' };
    return result;
  });
  const prepared = await f.host.prepare({ ...parent, prepareId: 'unrepresentable' });
  const ready = await f.host.start(action(prepared));
  assert.equal(ready.view.fork.status, 'received');
  assert.equal(ready.view.childId, 'child-a');
  assert.equal(ready.view.child, null);
  assert.match(ready.view.fork.error ?? '', /无法安全读取/);
  const closed = await f.host.close(action(ready));
  assert.equal(closed.view.close.status, 'closed');
});

test('unknown original fork is never replayed and a late persistence failure recovers the original child', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'late' });
  f.handle(async call => {
    if (call.method === 'thread/fork') throw Object.assign(new Error('PRIVATE_TIMEOUT'), { delivery: 'unknown' });
    return f.result(call);
  });
  const unknown = await f.host.start(action(prepared));
  assert.equal(unknown.view.fork.status, 'unknown');
  assert.doesNotMatch(JSON.stringify(unknown.view), /PRIVATE_TIMEOUT/);
  let current = await f.host.read(input(prepared));
  current = await f.host.retry(action(current));
  assert.equal(current.view.fork.status, 'unknown');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  const fork = f.calls.find(call => call.method === 'thread/fork')!;
  let failReceipt = true;
  f.store.fail = (next, previous) => failReceipt && next.fork.status === 'received' && previous.fork.status === 'unknown';
  await fork.late!({ outcome: 'success', result: f.result(fork), eventCursor: 7 });
  await eventually(async () => (await f.host.read(input(prepared))).view.recoveryError !== null);
  for (let i = 0; i < 2; i++) {
    current = await f.host.read(input(prepared));
    assert.equal(current.view.fork.status, 'unknown');
    await assert.rejects(f.host.retryPersistence(action(current)), error => error instanceof Error && !error.message.includes('PRIVATE'));
    current = await f.host.read(input(prepared));
    assert.equal(current.view.settledCalls?.retryPersistence, undefined);
    assert.notEqual(current.view.recoveryError, null);
  }
  failReceipt = false;
  current = await f.host.retryPersistence(action(current));
  assert.equal(current.view.childId, 'child-a');
  assert.equal(current.view.inject.status, 'received');
  assert.equal(current.view.recoveryError, null);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
});

test('a terminated close whose fence could not persist is proved by scoped read, without repeating unsubscribe', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'close-persist' });
  const ready = await f.host.start(action(prepared));
  let failures = 2;
  f.store.fail = (next, previous) => {
    const oldFence = (previous as SideChatOperation & { endpointFence?: { active?: { action?: string } | null } }).endpointFence;
    const nextFence = (next as SideChatOperation & { endpointFence?: { active?: unknown } }).endpointFence;
    if (failures && oldFence?.active?.action === 'close' && nextFence?.active === null && next.close.status === 'closed') {
      failures--; return true;
    }
    return false;
  };
  await assert.rejects(f.host.close(action(ready)), error => error instanceof Error && !('uncertain' in error && error.uncertain === false));
  assert.equal(failures, 0);
  const recovered = await f.host.read(input(prepared));
  assert.equal(recovered.view.close.status, 'closed');
  assert.equal(recovered.view.settledCalls?.close, true);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  assert.equal(f.cleanups.length, 1);
});

test('a close whose initial persistence failed can be explicitly continued after a settled read', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'close-first-write' });
  const ready = await f.host.start(action(prepared));
  let fail = true;
  f.store.fail = (next, previous) => fail && next.close.requested && !previous.close.requested;
  await assert.rejects(f.host.close(action(ready)));
  let recovered = await f.host.read(input(prepared));
  assert.equal(recovered.view.close.requested, false);
  assert.equal(recovered.view.settledCalls?.close, true);
  assert.equal(f.barriers.length, 0);
  fail = false;
  recovered = await f.host.close(action(recovered));
  assert.equal(recovered.view.close.status, 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
});

test('another adapter cannot infer an old active call ended without owner termination proof', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'owner' });
  const pending = deferred<unknown>();
  f.handle(async call => call.method === 'thread/fork' ? pending.promise : f.result(call));
  const running = f.host.start(action(prepared));
  await eventually(() => f.calls.some(call => call.method === 'thread/fork'));
  let failures = 2;
  f.store.fail = (next, previous) => {
    const oldFence = (previous as SideChatOperation & { endpointFence?: { active?: { action?: string } | null } }).endpointFence;
    const nextFence = (next as SideChatOperation & { endpointFence?: { active?: unknown } }).endpointFence;
    if (failures && oldFence?.active?.action === 'start' && nextFence?.active === null && next.inject.status === 'received') {
      failures--; return true;
    }
    return false;
  };
  const other = createSideChatEndpointHost({ ...f.deps, ownerId: 'replacement-host-process' });
  let read = await other.read(input(prepared));
  assert.equal(read.view.settledCalls?.start, undefined);
  assert.equal(read.token, null);
  assert.match(read.view.recoveryError ?? '', /原宿主/);
  await assert.rejects(other.retry({ ...input(read), token: 'stale' }), unsent);
  pending.resolve(f.result(f.calls.find(call => call.method === 'thread/fork')!));
  await assert.rejects(running);
  read = await other.read(input(prepared));
  assert.equal(read.view.settledCalls?.start, undefined);
  assert.equal(read.token, null);
  await assert.rejects(other.retry({ ...input(read), token: 'stale' }), unsent);
  f.setStopped(true);
  read = await other.read(input(prepared));
  assert.equal(read.view.settledCalls?.start, true);
  assert.equal(read.view.inject.status, 'received');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
});

test('after proven owner exit, lost in-memory receipts become unknown rather than being replayed', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'lost-on-exit' });
  let fail = true;
  f.store.fail = (next, previous) => fail && next.fork.status === 'received' && previous.fork.status === 'inflight';
  await assert.rejects(f.host.start(action(prepared)));
  assert.equal((await f.store.read(prepared.view.operationId))?.fork.status, 'inflight');
  fail = false;
  const replacement = createSideChatEndpointHost({ ...f.deps, ownerId: 'replacement-process' });
  const held = await replacement.read(input(prepared));
  assert.equal(held.view.fork.status, 'inflight');
  assert.equal(held.view.settledCalls, undefined);
  assert.equal(held.token, null);
  f.setStopped(true);
  const recovered = await Promise.all([replacement.read(input(prepared)), replacement.read(input(prepared))]);
  assert.ok(recovered.every(result => result.view.fork.status === 'unknown'));
  const latest = await replacement.read(input(prepared));
  assert.equal(latest.view.settledCalls?.start, true);
  assert.equal(latest.view.fork.status, 'unknown');
  const retry = await replacement.retry(action(latest));
  assert.equal(retry.view.fork.status, 'unknown');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
});

test('an old observer cannot write a late terminal after the operation changes owners', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'old-observer' });
  f.handle(async call => {
    if (call.method === 'thread/fork') throw Object.assign(new Error('timeout'), { delivery: 'unknown' });
    return f.result(call);
  });
  await f.host.start(action(prepared));
  const fork = f.calls.find(call => call.method === 'thread/fork')!;
  f.setStopped(true);
  const replacement = createSideChatEndpointHost({ ...f.deps, ownerId: 'replacement-process' });
  const recovered = await replacement.read(input(prepared));
  assert.equal(recovered.view.fork.status, 'unknown');
  const notifications = f.notifications.length;
  await fork.late!({ outcome: 'success', result: f.result(fork), eventCursor: 7 });
  await eventually(() => f.notifications.length > notifications);
  const after = await replacement.read(input(prepared));
  assert.equal(after.view.fork.status, 'unknown');
  assert.equal(after.view.childId, null);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
});

test('owner handover remains fenced when restart recovery cannot be persisted', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'handover-write-failure' });
  let failReceipt = true;
  f.store.fail = (next, previous) => failReceipt && next.fork.status === 'received' && previous.fork.status === 'inflight';
  await assert.rejects(f.host.start(action(prepared)));
  failReceipt = false;
  f.setStopped(true);
  let failRecovery = true;
  f.store.fail = (next, previous) => failRecovery && next.fork.status === 'unknown' && previous.fork.status === 'inflight';
  const replacement = createSideChatEndpointHost({ ...f.deps, ownerId: 'replacement-process' });
  await assert.rejects(replacement.read(input(prepared)), error => error instanceof Error && !error.message.includes('PRIVATE'));
  await assert.rejects(replacement.start(action(prepared)), unsent);
  assert.equal((await f.store.read(prepared.view.operationId))?.fork.status, 'inflight');
  failRecovery = false;
  const recovered = await replacement.read(input(prepared));
  assert.equal(recovered.view.fork.status, 'unknown');
  assert.equal(recovered.view.settledCalls?.start, true);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
});

test('unfenced historical operations remain readable but cannot receive a dispatch or a false proof', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ ...parent, prepareId: 'old' });
  await f.store.update(prepared.view.operationId, operation => {
    const next = { ...operation } as SideChatOperation & { endpointFence?: unknown };
    delete next.endpointFence;
    return next;
  });
  const old = await f.host.read(input(prepared));
  assert.equal(old.token, null);
  assert.equal(old.view.settledCalls, undefined);
  await assert.rejects(f.host.start(action(prepared)), unsent);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
});
