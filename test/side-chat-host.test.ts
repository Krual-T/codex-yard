import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSideChatHost } from '../src/native/side-chat.ts';
import type { SideChatDependencies, SideChatOperation, SideChatParent, SideChatScope, SideChatStore } from '../src/native/side-chat.ts';
import type { LateRpcTerminal } from '../lib/codex-protocol.ts';

type Value = Record<string, unknown>;
type Call = { hostId: string; method: string; params: Value; mutating: boolean; generation: string;
  late?: (terminal: LateRpcTerminal) => void | Promise<void> };

class Store implements SideChatStore {
  values = new Map<string, SideChatOperation>();
  chain: Promise<unknown> = Promise.resolve();
  fail?: (next: SideChatOperation, previous: SideChatOperation | undefined) => boolean;
  async create(value: SideChatOperation) {
    if (this.values.has(value.operationId)) throw new Error('duplicate');
    if (this.fail?.(value, undefined)) throw new Error('storage failed');
    this.values.set(value.operationId, structuredClone(value));
  }
  async read(id: string) { await this.chain.catch(() => {}); return structuredClone(this.values.get(id) ?? null); }
  async update(id: string, fn: (value: SideChatOperation) => SideChatOperation) {
    const work = this.chain.catch(() => {}).then(() => {
      const current = this.values.get(id);
      if (!current) throw new Error('missing');
      const next = fn(structuredClone(current));
      if (this.fail?.(next, current)) throw new Error('storage failed');
      this.values.set(id, structuredClone(next)); return structuredClone(next);
    });
    this.chain = work;
    return work;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

async function eventually(check: () => Promise<boolean>) {
  for (let index = 0; index < 200; index++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('late completion did not arrive');
}

function fixture() {
  const store = new Store(), calls: Call[] = [], closing: SideChatScope[] = [], cleaned: SideChatScope[] = [], errors: unknown[] = [];
  let config: unknown = { config: { developer_instructions: 'CONFIG BASELINE', api_key: 'must-not-leave-config-response' } };
  let parent: SideChatParent = { hostId: 'local', threadId: 'parent', connectionGeneration: 'generation-1',
    cwd: '/workspace', workspaceRoots: ['/workspace', '/extra'], archived: false, model: 'fixture-model',
    modelProvider: 'fixture-provider', effort: 'high', serviceTier: null,
    submitOptions: { model: 'fixture-model', effort: 'high', approvalPolicy: 'on-request', approvalsReviewer: 'user',
      custom: { keep: true } }, project: { id: 'project' },
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    forkConfig: { 'mcp_servers.codex_app': { command: '/owned/adapter' } } };
  let handler: ((call: Call) => Promise<unknown>) | undefined;
  let failPrepare = false, failCleanup = false;
  const deps: SideChatDependencies = {
    store,
    async resolveParent() { return structuredClone(parent); },
    async request(hostId, method, params, mutating, late, generation) {
      const call: Call = { hostId, method, params: structuredClone(params), mutating, late, generation }; calls.push(call);
      if (method === 'config/read') return structuredClone(config);
      if (handler) return handler(call);
      return defaultResult(call);
    },
    classifyFailure(_method, error) {
      return typeof error === 'object' && error !== null && 'delivery' in error
        ? (error as { delivery: 'not-sent' | 'rejected' | 'unknown' }).delivery : 'unknown';
    },
    async prepareClose(value) { closing.push(value); if (failPrepare) throw new Error('pending send'); },
    async cleanup(value) { cleaned.push(value); if (failCleanup) throw new Error('cache failed'); },
    onRecoveryError(_id, error) { errors.push(error); },
  };
  function defaultResult(call: Call): unknown {
    if (call.method === 'thread/fork') return { thread: { id: 'child', ephemeral: true, forkedFromId: call.params.threadId },
      cwd: call.params.cwd, runtimeWorkspaceRoots: call.params.runtimeWorkspaceRoots, model: call.params.model,
      modelProvider: call.params.modelProvider, reasoningEffort: parent.effort, serviceTier: call.params.serviceTier,
      ...(call.params.approvalPolicy ? { approvalPolicy: call.params.approvalPolicy } : {}),
      ...(call.params.approvalsReviewer ? { approvalsReviewer: call.params.approvalsReviewer } : {}),
      ...(call.params.permissions ? { activePermissionProfile: { id: call.params.permissions } } : {}),
      sandbox: parent.sandboxPolicy,
      untouched: { keep: true } };
    if (call.method === 'thread/inject_items') return {};
    if (call.method === 'thread/unsubscribe') return { status: 'unsubscribed', extra: true };
    throw new Error('unexpected method');
  }
  return { store, calls, closing, cleaned, errors, deps, host: createSideChatHost(deps), defaultResult,
    setParent(value: Partial<SideChatParent>) { parent = { ...parent, ...value }; },
    setConfig(value: unknown) { config = value; },
    handle(fn: (call: Call) => Promise<unknown>) { handler = fn; },
    failPrepare(value: boolean) { failPrepare = value; }, failCleanup(value: boolean) { failCleanup = value; } };
}

test('freezes trusted parent and config before the real fork and boundary receipt, then closes the same scope', async () => {
  const f = fixture();
  f.handle(async call => {
    const operation = [...f.store.values.values()][0];
    if (call.method === 'thread/fork') assert.equal(operation.fork.status, 'inflight');
    if (call.method === 'thread/inject_items') {
      assert.equal(operation.fork.status, 'received'); assert.equal(operation.childId, 'child');
    }
    return f.defaultResult(call);
  });
  const prepared = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.match(prepared.operationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(f.calls.map(call => call.method), ['config/read']);
  assert.equal(prepared.configuredInstructions, 'CONFIG BASELINE');
  assert.equal(prepared.instructionSource, 'host-config');
  assert.doesNotMatch(JSON.stringify(prepared), /must-not-leave-config-response/);
  f.setParent({ cwd: '/changed', workspaceRoots: ['/changed'], model: 'changed' });
  const ready = await f.host.start(prepared.operationId);
  assert.equal(ready.fork.status, 'received'); assert.equal(ready.inject.status, 'received');
  assert.equal(ready.forkParams.cwd, '/workspace');
  assert.deepEqual(ready.forkParams.runtimeWorkspaceRoots, ['/workspace', '/extra']);
  assert.equal(ready.forkParams.model, 'fixture-model');
  assert.equal(ready.forkParams.ephemeral, true); assert.equal(ready.forkParams.excludeTurns, true);
  assert.equal(Object.hasOwn(ready.forkParams, 'deferGoalContinuation'), false);
  assert.match(String(ready.forkParams.developerInstructions), /CONFIG BASELINE/);
  assert.match(JSON.stringify(ready.boundaryItems), /Side conversation boundary/);
  assert.deepEqual(ready.parent.submitOptions, { model: 'fixture-model', effort: 'high', approvalPolicy: 'on-request',
    approvalsReviewer: 'user', custom: { keep: true } });
  const closed = await f.host.close(ready.operationId);
  assert.equal(closed.close.status, 'closed');
  assert.deepEqual(closed.close.receipt, { status: 'unsubscribed', extra: true });
  assert.deepEqual(f.closing, [{ operationId: ready.operationId, hostId: 'local', parentThreadId: 'parent', childThreadId: 'child' }]);
  assert.deepEqual(f.cleaned, f.closing);
  assert.ok(f.calls.every(call => call.hostId === 'local' && call.generation === 'generation-1'));
  assert.deepEqual(f.calls.map(call => call.method), ['config/read', 'thread/fork', 'thread/inject_items', 'thread/unsubscribe']);
});

test('checks host, archival state, absolute roots and actual instruction source without persisting invalid inputs', async () => {
  const f = fixture();
  f.setParent({ hostId: 'other' });
  await assert.rejects(() => f.host.prepare({ hostId: 'local', threadId: 'parent' }), /父会话/);
  f.setParent({ hostId: 'local', archived: true });
  await assert.rejects(() => f.host.prepare({ hostId: 'local', threadId: 'parent' }), /父会话/);
  f.setParent({ archived: false, workspaceRoots: ['relative'] });
  await assert.rejects(() => f.host.prepare({ hostId: 'local', threadId: 'parent' }), /父会话/);
  f.setParent({ workspaceRoots: ['/workspace'], developerOverride: { value: 'THREAD BASELINE', source: 'verified-start' } });
  f.setConfig({ config: {} });
  await assert.rejects(() => f.host.prepare({ hostId: 'local', threadId: 'parent' }), /指令配置/);
  assert.equal(f.store.values.size, 0);
  f.setConfig({ config: { developer_instructions: null } });
  const prepared = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.equal(prepared.instructionSource, 'thread-override');
  assert.equal(prepared.configuredInstructions, null);
  assert.match(String(prepared.forkParams.developerInstructions), /^THREAD BASELINE/);
});

test('freezes parent approval and permission options in fork and verifies their actual receipt', async () => {
  for (const options of [
    { approvalPolicy: 'never', approvalsReviewer: 'user', permissionProfileId: ':read-only', sandboxMode: 'read-only' },
    { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'workspace-write' },
  ]) {
    const f = fixture(); f.setParent({ submitOptions: options,
      sandboxPolicy: options.sandboxMode === 'workspace-write'
        ? { type: 'workspaceWrite', writableRoots: ['/workspace'], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
        : { type: 'readOnly', networkAccess: false } });
    const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
    const ready = await f.host.start(op.operationId);
    assert.equal(ready.fork.status, 'received');
    assert.equal(ready.forkParams.approvalPolicy, options.approvalPolicy);
    if ('permissionProfileId' in options) {
      assert.equal(ready.forkParams.permissions, options.permissionProfileId);
      assert.equal(Object.hasOwn(ready.forkParams, 'sandbox'), false);
    } else assert.equal(ready.forkParams.sandbox, options.sandboxMode);
  }
  const f = fixture(); f.setParent({ submitOptions: { approvalPolicy: 'never', approvalsReviewer: 'user', sandboxMode: 'read-only' } });
  f.handle(async call => call.method === 'thread/fork'
    ? { ...f.defaultResult(call) as Value, approvalPolicy: 'on-request' } : f.defaultResult(call));
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  const result = await f.host.start(op.operationId);
  assert.equal(result.childId, 'child'); assert.equal(result.fork.status, 'invalid');
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
  assert.equal((await f.host.close(op.operationId)).close.status, 'closed');
  const mismatch = fixture(); mismatch.handle(async call => call.method === 'thread/fork'
    ? { ...mismatch.defaultResult(call) as Value, sandbox: { type: 'readOnly', networkAccess: true } } : mismatch.defaultResult(call));
  const mismatchOp = await mismatch.host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.equal((await mismatch.host.start(mismatchOp.operationId)).fork.status, 'invalid');
  assert.equal(mismatch.calls.filter(call => call.method === 'thread/inject_items').length, 0);
  const normalized = fixture();
  normalized.handle(async call => call.method === 'thread/fork'
    ? { ...normalized.defaultResult(call) as Value, serviceTier: 'default' } : normalized.defaultResult(call));
  const normalOp = await normalized.host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.equal((await normalized.host.start(normalOp.operationId)).fork.status, 'received');
  const unsupported = fixture(); unsupported.setParent({ submitOptions: { approvalPolicy: 'never', approvalsReviewer: 'user',
    sandboxMode: 'external-sandbox' } });
  await assert.rejects(() => unsupported.host.prepare({ hostId: 'local', threadId: 'parent' }), /无法由 fork 请求准确表达/);
  assert.equal(unsupported.store.values.size, 0);
  const missingApproval = fixture(); missingApproval.setParent({ submitOptions: { sandboxMode: 'read-only' } });
  await assert.rejects(() => missingApproval.host.prepare({ hostId: 'local', threadId: 'parent' }), /父会话/);
  assert.equal(missingApproval.calls.length, 0);
});

test('serial claims prevent duplicate fork and close a late child on its original host without injecting', async () => {
  const f = fixture(), gate = deferred<unknown>(), started = deferred<void>();
  f.setParent({ hostId: 'ssh', threadId: 'remote-parent', connectionGeneration: 'ssh-1' });
  f.handle(async call => {
    if (call.method === 'thread/fork') { started.resolve(); return gate.promise; }
    return f.defaultResult(call);
  });
  const op = await f.host.prepare({ hostId: 'ssh', threadId: 'remote-parent' });
  const first = f.host.start(op.operationId); await started.promise;
  await Promise.all([f.host.start(op.operationId), f.host.close(op.operationId)]);
  const forkCall = f.calls.find(call => call.method === 'thread/fork')!;
  gate.resolve(f.defaultResult(forkCall));
  const closed = await first;
  assert.equal(closed.close.status, 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  assert.equal(f.closing[0].hostId, 'ssh'); assert.equal(f.closing[0].parentThreadId, 'remote-parent');
  assert.equal(f.calls.at(-1)?.generation, 'ssh-1');
});

test('a changed connection generation is fenced before dispatch and keeps an existing child', async () => {
  const f = fixture(); const request = f.deps.request; let generation = 'generation-1';
  f.deps.request = async (hostId, method, params, mutating, late, expected) => {
    if (expected !== generation) throw Object.assign(new Error('original connection ended'), { delivery: 'not-sent' });
    return request(hostId, method, params, mutating, late, expected);
  };
  const host = createSideChatHost(f.deps);
  const op = await host.prepare({ hostId: 'local', threadId: 'parent' }); await host.start(op.operationId);
  generation = 'generation-2';
  const pending = await host.close(op.operationId);
  assert.equal(pending.close.status, 'not-sent'); assert.equal(pending.childId, 'child');
  await host.retry(op.operationId);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
  assert.equal(f.cleaned.length, 0);
  assert.equal((await host.read(op.operationId)).parent.connectionGeneration, 'generation-1');
});

test('unknown fork is never replayed; a late result settles the original operation and injects once', async () => {
  const f = fixture(); let late: Call['late'];
  f.handle(async call => {
    if (call.method === 'thread/fork') { late = call.late; throw Object.assign(new Error('timeout'), { delivery: 'unknown' }); }
    return f.defaultResult(call);
  });
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  const unknown = await f.host.start(op.operationId);
  assert.equal(unknown.fork.status, 'unknown');
  await f.host.retry(op.operationId); await f.host.retry(op.operationId);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  const original = f.calls.find(call => call.method === 'thread/fork')!;
  await late!({ outcome: 'success', result: f.defaultResult(original) });
  await eventually(async () => (await f.host.read(op.operationId)).inject.status === 'received');
  const saved = await createSideChatHost(f.deps).read(op.operationId);
  assert.equal(saved.childId, 'child'); assert.equal(saved.fork.status, 'received');
  assert.equal(saved.fork.error, undefined);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
});

test('RPC error details remain attached to their original operation, including late terminal errors', async () => {
  const first = fixture();
  first.handle(async call => {
    if (call.method === 'thread/fork') throw Object.assign(new Error('fork rejected'),
      { delivery: 'rejected', code: -32600, data: { reason: 'fixture', extra: 17 } });
    return first.defaultResult(call);
  });
  const firstOp = await first.host.prepare({ hostId: 'local', threadId: 'parent' });
  const rejected = await first.host.start(firstOp.operationId);
  assert.equal(rejected.fork.status, 'rejected');
  assert.deepEqual(rejected.fork.terminalError, { message: 'fork rejected', code: -32600, data: { reason: 'fixture', extra: 17 } });
  await first.host.retry(firstOp.operationId);
  assert.equal(first.calls.filter(call => call.method === 'thread/fork').length, 1);

  const second = fixture(); let late: Call['late'];
  second.handle(async call => {
    if (call.method === 'thread/inject_items') { late = call.late; throw Object.assign(new Error('timeout'), { delivery: 'unknown' }); }
    return second.defaultResult(call);
  });
  const secondOp = await second.host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.equal((await second.host.start(secondOp.operationId)).inject.status, 'unknown');
  await late!({ outcome: 'error', error: { message: 'injection failed', code: -32001, data: { fixture: true } } });
  await eventually(async () => (await second.host.read(secondOp.operationId)).inject.status === 'rejected');
  const saved = await second.host.read(secondOp.operationId);
  assert.equal(saved.childId, 'child');
  assert.deepEqual(saved.inject.terminalError, { message: 'injection failed', code: -32001, data: { fixture: true } });
  await second.host.retry(secondOp.operationId);
  assert.equal(second.calls.filter(call => call.method === 'thread/inject_items').length, 1);
});

test('unknown inject keeps child, rejects retry, and permits explicit close without reviving it after a late receipt', async () => {
  const f = fixture(); let late: Call['late'];
  f.handle(async call => {
    if (call.method === 'thread/inject_items') { late = call.late; throw Object.assign(new Error('lost'), { delivery: 'unknown' }); }
    return f.defaultResult(call);
  });
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  const result = await f.host.start(op.operationId);
  assert.equal(result.childId, 'child'); assert.equal(result.inject.status, 'unknown');
  await f.host.retry(op.operationId);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
  const closed = await f.host.close(op.operationId); assert.equal(closed.close.status, 'closed');
  await late!({ outcome: 'success', result: {} });
  await eventually(async () => (await f.host.read(op.operationId)).inject.status === 'received');
  assert.equal((await f.host.read(op.operationId)).close.status, 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
});

test('persist failures retain the received child and inject receipt in memory for explicit persistence retry', async () => {
  const f = fixture();
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  let failFork = true, failInject = false;
  f.store.fail = next => {
    if (failFork && next.fork.status === 'received') return true;
    if (failInject && next.inject.status === 'received') return true;
    return false;
  };
  await assert.rejects(() => f.host.start(op.operationId), /storage failed/);
  assert.equal((await f.host.read(op.operationId)).fork.status, 'inflight');
  failFork = false; failInject = true;
  await assert.rejects(() => f.host.retryPersistence(op.operationId), /storage failed/);
  assert.equal((await f.host.read(op.operationId)).childId, 'child');
  failInject = false;
  const done = await f.host.retryPersistence(op.operationId);
  assert.equal(done.inject.status, 'received');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 1);
});

test('close barriers and cleanup failures preserve the child; retry never repeats confirmed unsubscribe', async () => {
  const f = fixture();
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' }); await f.host.start(op.operationId);
  f.failPrepare(true);
  assert.equal((await f.host.close(op.operationId)).close.status, 'prepare-failed');
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
  f.failPrepare(false); f.failCleanup(true);
  const pending = await f.host.close(op.operationId);
  assert.equal(pending.childId, 'child'); assert.equal(pending.close.status, 'cleanup-pending');
  f.failCleanup(false);
  assert.equal((await f.host.close(op.operationId)).close.status, 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  assert.equal(f.cleaned.length, 2);
});

test('only proven not-sent requests can be explicitly retried; unknown unsubscribe awaits its original late result', async () => {
  const f = fixture(); let forkCount = 0, late: Call['late'];
  f.handle(async call => {
    if (call.method === 'thread/fork' && ++forkCount === 1) throw Object.assign(new Error('offline'), { delivery: 'not-sent' });
    if (call.method === 'thread/unsubscribe') { late = call.late; throw Object.assign(new Error('timeout'), { delivery: 'unknown' }); }
    return f.defaultResult(call);
  });
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.equal((await f.host.start(op.operationId)).fork.status, 'not-sent');
  assert.equal((await f.host.retry(op.operationId)).inject.status, 'received');
  assert.equal((await f.host.close(op.operationId)).close.status, 'unknown');
  await f.host.close(op.operationId); await f.host.retry(op.operationId);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  await late!({ outcome: 'success', result: { status: 'notSubscribed' } });
  await eventually(async () => (await f.host.read(op.operationId)).close.status === 'closed');
  assert.equal(f.cleaned.length, 1);
});

test('unverifiable fork receipt is retained and cannot ready or close a foreign child', async () => {
  const f = fixture();
  f.handle(async call => call.method === 'thread/fork' ? { ...f.defaultResult(call) as Value,
    thread: { id: 'foreign-child', ephemeral: true, forkedFromId: 'other-parent' } } : f.defaultResult(call));
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  const result = await f.host.start(op.operationId);
  assert.equal(result.childId, 'foreign-child'); assert.equal(result.fork.status, 'invalid');
  assert.equal((await f.host.close(op.operationId)).close.status, 'prepare-failed');
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items' || call.method === 'thread/unsubscribe').length, 0);
});

test('restart recovery preserves uncertain operations without dispatch and permits idempotent cleanup retry', async () => {
  const f = fixture(), gate = deferred<unknown>(), started = deferred<void>();
  f.handle(async call => { if (call.method === 'thread/fork') { started.resolve(); return gate.promise; } return f.defaultResult(call); });
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  const inflight = f.host.start(op.operationId); await started.promise;
  const recovered = await createSideChatHost(f.deps).recoverAfterRestart(op.operationId);
  assert.equal(recovered.fork.status, 'unknown');
  await f.host.retry(op.operationId);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  gate.resolve(f.defaultResult(f.calls.find(call => call.method === 'thread/fork')!));
  await inflight;
});

test('a close requested after an unknown fork follows the original late child and never injects', async () => {
  const f = fixture(); let late: Call['late'];
  f.handle(async call => {
    if (call.method === 'thread/fork') { late = call.late; throw Object.assign(new Error('timeout'), { delivery: 'unknown' }); }
    return f.defaultResult(call);
  });
  const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' }); await f.host.start(op.operationId);
  assert.equal((await f.host.close(op.operationId)).fork.status, 'unknown');
  await late!({ outcome: 'success', result: f.defaultResult(f.calls.find(call => call.method === 'thread/fork')!) });
  await eventually(async () => (await f.host.read(op.operationId)).close.status === 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/inject_items').length, 0);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
});

test('a canceled prepared operation cannot later create a child', async () => {
  const f = fixture(); const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.equal((await f.host.close(op.operationId)).close.status, 'closed');
  await f.host.start(op.operationId); await f.host.retry(op.operationId);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
});

test('concurrent close calls do not run cleanup twice while its first execution is active', async () => {
  const f = fixture(), cleanupStarted = deferred<void>(), cleanupGate = deferred<void>();
  f.deps.cleanup = async value => { f.cleaned.push(value); cleanupStarted.resolve(); await cleanupGate.promise; };
  const host = createSideChatHost(f.deps);
  const op = await host.prepare({ hostId: 'local', threadId: 'parent' }); await host.start(op.operationId);
  const closing = host.close(op.operationId); await cleanupStarted.promise;
  assert.equal((await host.close(op.operationId)).close.status, 'cleaning');
  assert.equal(f.cleaned.length, 1);
  cleanupGate.resolve(); assert.equal((await closing).close.status, 'closed');
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
});

test('damaged frozen requests and receipt state cannot be dispatched or silently overwritten', async () => {
  const f = fixture(); const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  const stored = f.store.values.get(op.operationId)!;
  stored.forkParams.path = '/other-thread';
  await assert.rejects(() => f.host.start(op.operationId), /冻结请求/);
  assert.equal(f.calls.filter(call => call.method === 'thread/fork').length, 0);
  assert.equal(f.store.values.get(op.operationId)?.forkParams.path, '/other-thread');
  delete stored.forkParams.path;
  stored.fork.status = 'received'; stored.childId = 'foreign';
  await assert.rejects(() => f.host.retry(op.operationId), /子会话回执/);
  assert.equal(f.store.values.get(op.operationId)?.childId, 'foreign');
});

test('a completed close barrier survives a storage failure without repeating preparation or dispatch', async () => {
  const f = fixture(); const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  await f.host.start(op.operationId);
  let fail = true;
  f.store.fail = next => fail && next.close.status === 'inflight';
  await assert.rejects(() => f.host.close(op.operationId), /storage failed/);
  assert.equal((await f.host.read(op.operationId)).close.status, 'preparing');
  assert.equal(f.closing.length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
  fail = false;
  assert.equal((await f.host.retryPersistence(op.operationId)).close.status, 'closed');
  assert.equal(f.closing.length, 1);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
});

test('cleanup outcomes survive storage failure and confirmed unsubscribe is not repeated', async () => {
  for (const cleanupFails of [false, true]) {
    const f = fixture(); const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
    await f.host.start(op.operationId);
    f.failCleanup(cleanupFails);
    let fail = true;
    f.store.fail = (next, previous) => fail && previous?.close.status === 'cleaning'
      && ['closed', 'cleanup-pending'].includes(next.close.status);
    await assert.rejects(() => f.host.close(op.operationId), /storage failed/);
    assert.equal((await f.host.read(op.operationId)).close.status, 'cleaning');
    assert.equal(f.cleaned.length, 1);
    fail = false;
    const saved = await f.host.retryPersistence(op.operationId);
    assert.equal(saved.close.status, cleanupFails ? 'cleanup-pending' : 'closed');
    assert.equal(f.cleaned.length, 1);
    if (cleanupFails) {
      assert.match(saved.close.error!, /cache failed/);
      f.failCleanup(false);
      assert.equal((await f.host.close(op.operationId)).close.status, 'closed');
      assert.equal(f.cleaned.length, 2);
    }
    assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  }
});

test('a modified persisted fork receipt cannot authorize an inject or be overwritten', async () => {
  const f = fixture(); const op = await f.host.prepare({ hostId: 'local', threadId: 'parent' });
  await f.host.start(op.operationId);
  const stored = f.store.values.get(op.operationId)!;
  (stored.fork.receipt as Value).runtimeWorkspaceRoots = ['/different'];
  await assert.rejects(() => f.host.close(op.operationId), /子会话回执/);
  assert.deepEqual((f.store.values.get(op.operationId)!.fork.receipt as Value).runtimeWorkspaceRoots, ['/different']);
  assert.equal(f.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
});
