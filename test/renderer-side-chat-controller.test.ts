import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LateRpcTerminal, ThreadSummary } from '../lib/codex-protocol.ts';
import { createSideChatHost } from '../src/native/side-chat.ts';
import type { SideChatDependencies, SideChatOperation, SideChatParent, SideChatStore } from '../src/native/side-chat.ts';
import type { SubmitOptions } from '../src/renderer/workbench-contract.ts';
import { SideChatController } from '../src/renderer/side-chat/controller.ts';
import type { SideChatHostPort, SideChatHostView } from '../src/renderer/side-chat/types.ts';

type Call = { hostId: string; method: string; params: Record<string, unknown>; generation: string;
  late?: (terminal: LateRpcTerminal) => void | Promise<void> };
class Store implements SideChatStore {
  records = new Map<string, SideChatOperation>();
  chain: Promise<unknown> = Promise.resolve();
  fail?: (next: SideChatOperation, previous: SideChatOperation) => boolean;
  async create(op: SideChatOperation) { if (this.records.has(op.operationId)) throw Error('duplicate'); this.records.set(op.operationId, structuredClone(op)); }
  async read(id: string) { await this.chain.catch(() => {}); return structuredClone(this.records.get(id) ?? null); }
  async update(id: string, update: (op: SideChatOperation) => SideChatOperation) {
    const next = this.chain.catch(() => {}).then(() => {
      const old = this.records.get(id); if (!old) throw Error('missing');
      const value = update(structuredClone(old));
      if (this.fail?.(value, old)) throw Error('synthetic host persistence failure');
      this.records.set(id, structuredClone(value)); return structuredClone(value);
    });
    this.chain = next; return next;
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function eventually(check: () => boolean | Promise<boolean>) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('expected asynchronous result');
}
function fixture(hostId = 'host-a', parentThreadId = 'parent-a') {
  const store = new Store(), calls: Call[] = [], scopes: unknown[] = [], linked: unknown[] = [];
  const hints = new Set<(hint: { hostId: string; operationId: string }) => void>();
  let handler: ((call: Call) => Promise<unknown>) | null = null, failLink = false, failClose = false, failCleanup = false;
  let parent: SideChatParent = { hostId, threadId: parentThreadId, connectionGeneration: 'original-connection', cwd: '/workspace/a',
    workspaceRoots: ['/workspace/a', '/workspace/b'], archived: false, model: 'model-a', modelProvider: 'provider-a',
    effort: null, serviceTier: null, sandboxPolicy: { type: 'readOnly', networkAccess: false }, project: { id: 'project-a' },
    submitOptions: { model: 'model-a', effort: null, mode: 'plan', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only' },
    forkConfig: { secret: 'host-only-config' } };
  function result(call: Call): unknown {
    if (call.method === 'thread/fork') return { thread: { id: 'child-' + call.hostId, ephemeral: true, forkedFromId: call.params.threadId,
      cwd: call.params.cwd, name: null, turns: [], status: { type: 'idle' } }, cwd: call.params.cwd,
      runtimeWorkspaceRoots: call.params.runtimeWorkspaceRoots, model: call.params.model, modelProvider: call.params.modelProvider,
      reasoningEffort: null, serviceTier: 'default', sandbox: { type: 'readOnly', networkAccess: false },
      approvalPolicy: call.params.approvalPolicy, approvalsReviewer: call.params.approvalsReviewer };
    if (call.method === 'thread/inject_items') return {};
    if (call.method === 'thread/unsubscribe') return { status: 'unsubscribed' };
    throw Error('unexpected RPC');
  }
  const deps: SideChatDependencies = {
    store, async resolveParent() { return structuredClone(parent); },
    async request(host, method, params, _mutating, late, generation) {
      const call = { hostId: host, method, params: structuredClone(params), generation, late }; calls.push(call);
      if (method === 'config/read') return { config: { developer_instructions: 'PRIVATE CONFIG TEXT' } };
      return handler ? handler(call) : result(call);
    },
    classifyFailure(_method, error) { return (error as { delivery?: 'unknown' | 'not-sent' | 'rejected' }).delivery ?? 'unknown'; },
    async prepareClose(scope) { scopes.push({ prepare: scope }); if (failClose) throw Error('pending send'); },
    async cleanup(scope) { scopes.push({ cleanup: scope }); if (failCleanup) throw Error('cleanup failed'); },
    onRecoveryError(_id, error) { throw error; },
  };
  const host = createSideChatHost(deps);
  const project = (op: SideChatOperation): SideChatHostView => {
    const receipt = op.fork.receipt as { thread?: ThreadSummary } | undefined;
    return { operationId: op.operationId, parent: { hostId: op.parent.hostId, threadId: op.parent.threadId, cwd: op.parent.cwd,
      workspaceRoots: [...op.parent.workspaceRoots], project: structuredClone(op.parent.project), archived: op.parent.archived,
      options: structuredClone(op.parent.submitOptions) as SubmitOptions }, childId: op.childId ?? null,
      child: op.fork.status === 'received' && receipt?.thread ? { thread: structuredClone(receipt.thread),
        options: { ...op.parent.submitOptions, effort: null, serviceTier: 'default' } as SubmitOptions } : null,
      fork: { status: op.fork.status, error: op.fork.error ?? null }, inject: { status: op.inject.status, error: op.inject.error ?? null },
      close: { requested: op.close.requested, status: op.close.status, error: op.close.error ?? null }, instructionSource: op.instructionSource };
  };
  const portCalls: string[] = [];
  const port: SideChatHostPort = {
    async prepare(hostId, parentThreadId) { portCalls.push('prepare'); return project(await host.prepare({ hostId, threadId: parentThreadId })); },
    async start(id) { portCalls.push('start'); return project(await host.start(id)); },
    async read(id) { portCalls.push('read'); return project(await host.read(id)); },
    async retry(id) { portCalls.push('retry'); return project(await host.retry(id)); },
    async close(id) { portCalls.push('close'); return project(await host.close(id)); },
    async retryPersistence(id) { portCalls.push('retryPersistence'); return project(await host.retryPersistence(id)); },
    subscribe(listener) { hints.add(listener); return () => hints.delete(listener); },
  };
  const controller = new SideChatController({ hostId, parentThreadId, draftId: 'draft-' + hostId, port,
    canDispatch: () => true,
    async onPrepared(scope) { linked.push(scope); if (failLink) throw Error('link store unavailable'); } });
  return { controller, host, store, calls, scopes, linked, port, portCalls, result, project,
    setParent(value: Partial<SideChatParent>) { parent = { ...parent, ...value }; },
    handle(fn: (call: Call) => Promise<unknown>) { handler = fn; },
    failLink(value: boolean) { failLink = value; }, failClose(value: boolean) { failClose = value; },
    failCleanup(value: boolean) { failCleanup = value; },
    hint(host: string, id: string) { for (const fn of hints) fn({ hostId: host, operationId: id }); } };
}

test('real E host drives one linked operation using the captured parent and a sanitized view', async () => {
  const f = fixture(); await f.controller.start();
  const state = f.controller.getSnapshot(), op = await f.host.read(state.view!.operationId);
  assert.equal(state.phase, 'ready'); assert.equal(state.view?.childId, 'child-host-a');
  assert.deepEqual(f.portCalls, ['prepare', 'start']);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read', 'thread/fork', 'thread/inject_items']);
  assert.deepEqual(f.linked, [{ hostId: 'host-a', parentThreadId: 'parent-a', operationId: op.operationId, draftId: 'draft-host-a' }]);
  const fork = f.calls[1]!;
  assert.equal(fork.hostId, 'host-a'); assert.equal(fork.generation, 'original-connection');
  assert.deepEqual(fork.params.runtimeWorkspaceRoots, ['/workspace/a', '/workspace/b']);
  assert.equal(fork.params.ephemeral, true); assert.equal('deferGoalContinuation' in fork.params, false);
  assert.equal('model_reasoning_effort' in (fork.params.config as object), false);
  assert.equal(state.view!.child!.options.effort, null); assert.equal(state.view!.child!.options.mode, 'plan');
  assert.match(String(fork.params.developerInstructions), /PRIVATE CONFIG TEXT/);
  assert.equal((f.calls[2]!.params.items as unknown[]).length, 2);
  assert.doesNotMatch(JSON.stringify(state.view), /PRIVATE CONFIG TEXT|host-only-config|forkParams|attemptId|boundaryItems/);
  f.setParent({ cwd: '/changed', threadId: 'another-parent' });
  await f.controller.close(); assert.equal(f.controller.getSnapshot().phase, 'closed');
  assert.equal(f.calls[3]!.params.threadId, 'child-host-a');
  assert.deepEqual(f.scopes, [{ prepare: { operationId: op.operationId, hostId: 'host-a', parentThreadId: 'parent-a', childThreadId: 'child-host-a' } },
    { cleanup: { operationId: op.operationId, hostId: 'host-a', parentThreadId: 'parent-a', childThreadId: 'child-host-a' } }]);
});

test('link persistence failure preserves the record and prevents fork until explicit retry', async () => {
  const f = fixture(); f.failLink(true); await f.controller.start();
  const id = f.controller.getSnapshot().view!.operationId;
  assert.equal(f.controller.getSnapshot().phase, 'link-failed');
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
  f.failLink(false); await f.controller.retry();
  assert.equal(f.controller.getSnapshot().phase, 'ready');
  assert.equal(f.controller.getSnapshot().view!.operationId, id);
  assert.deepEqual(f.portCalls, ['prepare', 'retry']);
});

test('unknown fork is never replayed, and a late child closes on its original host', async () => {
  const a = fixture(), b = fixture('host-b', 'parent-b');
  a.handle(async call => { if (call.method === 'thread/fork') throw Object.assign(Error('connection lost'), { delivery: 'unknown' }); return a.result(call); });
  await a.controller.start(); const id = a.controller.getSnapshot().view!.operationId;
  assert.equal(a.controller.getSnapshot().phase, 'fork-unknown');
  await a.controller.retry(); await a.controller.start(); await a.controller.read();
  assert.equal(a.calls.filter(call => call.method === 'thread/fork').length, 1);
  await a.controller.close(); await b.controller.start();
  const fork = a.calls.find(call => call.method === 'thread/fork')!;
  await fork.late!({ outcome: 'success', result: a.result(fork) });
  await eventually(async () => (await a.host.read(id)).close.status === 'closed');
  a.hint('host-b', id); assert.equal(b.controller.getSnapshot().view?.childId, 'child-host-b');
  a.hint('host-a', id); await eventually(() => a.controller.getSnapshot().phase === 'closed');
  assert.equal(a.controller.getSnapshot().view!.childId, 'child-host-a');
  assert.deepEqual(a.calls.map(call => call.method), ['config/read', 'thread/fork', 'thread/unsubscribe']);
  assert.equal(a.calls[2]!.hostId, 'host-a'); assert.equal(a.calls[2]!.generation, 'original-connection');
});

test('unknown boundary preserves child and accepts only the original late receipt', async () => {
  const f = fixture(); f.handle(async call => {
    if (call.method === 'thread/inject_items') throw Object.assign(Error('boundary unknown'), { delivery: 'unknown' }); return f.result(call);
  });
  await f.controller.start(); const state = f.controller.getSnapshot(), id = state.view!.operationId;
  assert.equal(state.phase, 'inject-unknown'); assert.equal(state.view!.childId, 'child-host-a');
  await f.controller.retry(); await f.controller.read();
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
  await f.calls.find(call => call.method === 'thread/inject_items')!.late!({ outcome: 'success', result: {} });
  await eventually(async () => (await f.host.read(id)).inject.status === 'received');
  f.hint('host-a', id); await eventually(() => f.controller.getSnapshot().phase === 'ready');
  assert.equal(f.controller.getSnapshot().view!.childId, 'child-host-a');
});

test('close and cleanup failures retain child; retries use the original host record', async () => {
  const f = fixture(); await f.controller.start(); f.failClose(true); await f.controller.close();
  assert.equal(f.controller.getSnapshot().phase, 'close-failed');
  assert.equal(f.controller.getSnapshot().view!.childId, 'child-host-a');
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
  f.failClose(false); f.failCleanup(true); await f.controller.retry();
  assert.equal(f.controller.getSnapshot().phase, 'close-failed');
  assert.equal(f.controller.getSnapshot().view!.close.status, 'cleanup-pending');
  f.failCleanup(false); await f.controller.retry();
  assert.equal(f.controller.getSnapshot().phase, 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
});

test('lost close response is not replayed on an idle read', async () => {
  const f = fixture(); await f.controller.start();
  const failed = { ...f.port, async close(_id: string): Promise<SideChatHostView> { throw Error('wire lost'); } };
  const restored = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft-host-a', port: failed,
    onPrepared: async () => {}, canDispatch: () => true, restored: f.controller.getSnapshot().view! });
  await restored.close(); await restored.read(); await restored.retry(); await restored.close();
  assert.equal(f.portCalls.filter(call => call === 'close').length, 0);
  assert.equal(restored.getSnapshot().pendingClose, true);
  assert.equal(restored.getSnapshot().phase, 'close-unknown');
  assert.equal(restored.getSnapshot().view!.close.requested, false);
});

test('lost start response cannot be cleared or replayed by reading the original waiting record', async () => {
  const f = fixture(); let startCalls = 0;
  const port = { ...f.port, async start(_id: string): Promise<SideChatHostView> { startCalls++; throw Error('wire lost'); } };
  const c = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft', port, onPrepared: async () => {}, canDispatch: () => true });
  await c.start(); const id = c.getSnapshot().view!.operationId;
  await c.read(); assert.match(c.getSnapshot().error!, /结果未确认/); assert.equal(c.canRetry, false);
  await c.retry(); await c.start(); assert.equal(startCalls, 1); assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
  await f.host.start(id); f.hint('host-a', id);
  await eventually(() => c.getSnapshot().phase === 'ready'); assert.equal(c.getSnapshot().error, null);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
});

test('a restored waiting record obeys the owner dispatch guard across reads', async () => {
  const f = fixture(), initial = await f.port.prepare('host-a', 'parent-a'); let permitted = false;
  const c = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'restored-draft', port: f.port,
    onPrepared: async () => { throw Error('restored record already linked'); }, canDispatch: () => permitted, restored: initial });
  await c.read(); await c.retry(); assert.equal(c.canRetry, false);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
  permitted = true; await c.read(); assert.equal(c.canRetry, true);
  await c.retry(); assert.equal(c.getSnapshot().phase, 'ready');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
});

test('a restored unknown close never dispatches the close endpoint again', async () => {
  const f = fixture(); await f.controller.start(); const view = structuredClone(f.controller.getSnapshot().view!);
  view.close = { requested: true, status: 'unknown', error: 'lost close receipt' };
  const c = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft', port: f.port,
    onPrepared: async () => {}, canDispatch: () => true, restored: view });
  await c.close(); await c.retry();
  assert.equal(c.getSnapshot().phase, 'close-unknown');
  assert.equal(f.portCalls.filter(call => call === 'close' || call === 'retry').length, 0);
});

test('host terminal persistence failure is recovered without a second fork', async () => {
  const f = fixture(); let failures = 0;
  f.store.fail = (next, old) => old.fork.status === 'inflight' && next.fork.status === 'received' && failures++ === 0;
  await f.controller.start();
  assert.match(f.controller.getSnapshot().error!, /persistence failure/);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  await f.controller.retryPersistence();
  assert.equal(f.controller.getSnapshot().phase, 'ready');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
});

test('invalid fork receipt retains its child identity without injecting or inventing success', async () => {
  const f = fixture(); f.handle(async call => {
    if (call.method !== 'thread/fork') return f.result(call);
    const result = f.result(call) as { thread: { ephemeral: boolean } }; result.thread.ephemeral = false; return result;
  });
  await f.controller.start();
  assert.equal(f.controller.getSnapshot().phase, 'fork-failed');
  assert.equal(f.controller.getSnapshot().view!.childId, 'child-host-a');
  assert.equal(f.controller.getSnapshot().view!.child, null);
  await f.controller.retry(); await f.controller.close();
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
  assert.equal(f.controller.getSnapshot().view!.childId, 'child-host-a');
  assert.equal(f.controller.getSnapshot().phase, 'close-failed');
});

test('close during draft linking never starts a fork and links the original operation only once', async () => {
  const f = fixture(), link = deferred<void>(); let links = 0;
  const c = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft-a', port: f.port,
    onPrepared: async () => { links++; await link.promise; }, canDispatch: () => true });
  const start = c.start(); await eventually(() => links === 1);
  const close = c.close(); link.resolve(); await Promise.all([start, close]);
  assert.equal(links, 1); assert.equal(c.getSnapshot().phase, 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
  assert.equal(f.portCalls.filter(call => call === 'close').length, 1);
});

test('out-of-order reads, foreign hints and changed parent never replace the original identity', async () => {
  const f = fixture(); await f.controller.start(); const original = f.controller.getSnapshot().view!, id = original.operationId;
  const first = deferred<SideChatHostView>(), second = deferred<SideChatHostView>(); let reads = 0;
  const port = { ...f.port, read: async () => ++reads === 1 ? first.promise : second.promise };
  const c = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft', port, onPrepared: async () => {}, canDispatch: () => true, restored: original });
  f.hint('host-b', id); f.hint('host-a', 'other'); assert.equal(reads, 0);
  f.hint('host-a', id); f.hint('host-a', id); assert.equal(reads, 2);
  const latest = structuredClone(original); latest.close = { requested: true, status: 'closed', error: null };
  second.resolve(latest); await eventually(() => c.getSnapshot().phase === 'closed');
  first.resolve(original); await Promise.resolve(); assert.equal(c.getSnapshot().phase, 'closed');
  const bad = structuredClone(latest); bad.parent.cwd = '/different';
  const badPort = { ...f.port, read: async () => bad };
  const d = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft', port: badPort,
    onPrepared: async () => {}, canDispatch: () => true, restored: original });
  await d.read(); assert.match(d.getSnapshot().error!, /身份不匹配/); assert.equal(d.getSnapshot().view!.parent.cwd, '/workspace/a');
  const missingChild = structuredClone(original); missingChild.child = null;
  const missingPort = { ...f.port, read: async () => missingChild };
  const e = new SideChatController({ hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft', port: missingPort,
    onPrepared: async () => {}, canDispatch: () => true, restored: original });
  await e.read(); assert.match(e.getSnapshot().error!, /身份不匹配/); assert.equal(e.getSnapshot().view!.child!.thread.id, 'child-host-a');
  assert.throws(() => new SideChatController({ hostId: 'other', parentThreadId: 'parent-a', draftId: 'draft', port: f.port,
    onPrepared: async () => {}, canDispatch: () => true, restored: original }), /身份不匹配/);
});
