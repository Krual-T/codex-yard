import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CodexConnection, RpcError } from '../lib/codex.ts';
import { createSideChatEndpointHost } from '../src/native/side-chat-host.ts';
import type { SideChatEndpointDependencies, SideChatEndpointReply, SideChatEndpointStore } from '../src/native/side-chat-host.ts';
import type { SideChatOperation, SideChatParent } from '../src/native/side-chat.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';
import type WebSocket from 'ws';

type Value = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);

function sendFrames(socket: WebSocket, values: unknown[]) {
  const frames = values.map(value => {
    const payload = Buffer.from(JSON.stringify(value));
    assert.ok(payload.length < 65_536);
    const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.alloc(4);
    if (payload.length >= 126) { header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    return Buffer.concat([header, payload]);
  });
  (socket as unknown as { _socket: { write(bytes: Buffer): void } })._socket.write(Buffer.concat(frames));
}

class Store implements SideChatEndpointStore {
  records = new Map<string, SideChatOperation>();
  prepared = new Map<string, string>();
  chain: Promise<unknown> = Promise.resolve();
  fail?: (next: SideChatOperation, previous: SideChatOperation) => boolean;
  async create(operation: SideChatOperation) { this.records.set(operation.operationId, clone(operation)); }
  async read(id: string) { await this.chain.catch(() => {}); return clone(this.records.get(id) ?? null); }
  async update(id: string, change: (current: SideChatOperation) => SideChatOperation) {
    const work = this.chain.catch(() => {}).then(() => {
      const current = this.records.get(id);
      if (!current) throw new Error('missing');
      const next = change(clone(current));
      if (this.fail?.(next, current)) throw new Error('synthetic persistence failure');
      this.records.set(id, clone(next));
      return clone(next);
    });
    this.chain = work;
    return work;
  }
  async readPrepared(id: string) { const operationId = this.prepared.get(id); return operationId ? this.read(operationId) : null; }
  async createPrepared(id: string, operation: SideChatOperation) {
    const existing = await this.readPrepared(id);
    if (existing) return existing;
    await this.create(operation); this.prepared.set(id, operation.operationId); return clone(operation);
  }
}

async function until(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 250; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 4));
  }
  throw new Error('synthetic receipt did not settle');
}

async function fixture(t: TestContext, changeParent: Partial<SideChatParent> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hf-'));
  const peer = await createFakeCodex(root);
  const connection = new CodexConnection(peer.socketPath);
  t.after(async () => { connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  await connection.connect();
  const socket = connection.socket;
  const parent: SideChatParent = {
    hostId: 'fixture-host', threadId: 'fixture-parent', connectionGeneration: 'fixture-generation',
    cwd: '/fixture/workspace', workspaceRoots: ['/fixture/workspace', '/fixture/extra'], archived: false,
    model: 'fixture-model', modelProvider: 'fixture-provider', effort: null, serviceTier: null,
    submitOptions: { model: 'fixture-model', effort: null, serviceTier: null, mode: 'plan',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only' },
    sandboxPolicy: { type: 'readOnly', networkAccess: false }, project: null, ...changeParent,
  };
  let generation = parent.connectionGeneration, timeoutMs = 2_000;
  const origins: { operationId: string; attemptId: string; connectionGeneration: string }[] = [];
  const store = new Store();
  const assertSocket = (scope: { hostId: string; parentThreadId: string; connectionGeneration: string }) => {
    if (scope.hostId !== parent.hostId || scope.parentThreadId !== parent.threadId || scope.connectionGeneration !== generation
      || connection.socket !== socket || !connection.connected) throw Object.assign(new Error('original socket unavailable'), { delivery: 'not-sent' });
  };
  const deps: SideChatEndpointDependencies = {
    store, ownerId: 'fixture-owner', async resolveParent() { return clone(parent); },
    async withParent(hostId, threadId, run) {
      assertSocket({ hostId, parentThreadId: threadId, connectionGeneration: parent.connectionGeneration });
      return run();
    },
    async withScope(scope, access, run) { if (access.kind === 'dispatch') assertSocket(scope); return run(); },
    canReconcile(scope) { try { assertSocket(scope); return true; } catch { return false; } },
    request(scope, method, params, mutating, onLateTerminal) {
      assertSocket(scope);
      return connection.request(method, params, { mutating, onLateTerminal, retainLateUntilDisconnect: true });
    },
    requestFork(scope, attemptId, params, onLateTerminal) {
      assertSocket(scope);
      origins.push({ operationId: scope.operationId, attemptId, connectionGeneration: scope.connectionGeneration });
      return connection.requestWithCursor('thread/fork', params, { mutating: true, timeoutMs, onLateTerminal, retainLateUntilDisconnect: true });
    },
    classifyFailure(_method, error) {
      if (typeof error === 'object' && error && 'delivery' in error && error.delivery === 'not-sent') return 'not-sent';
      return error instanceof RpcError && !error.uncertain ? 'rejected' : 'unknown';
    },
    async prepareClose() {}, async cleanup() {}, ownerStopped: () => false, notify: () => {},
  };
  peer.handlers.set('config/read', () => ({ config: { developer_instructions: null, secret: 'PRIVATE_CONFIG' } }));
  peer.handlers.set('thread/inject_items', () => ({}));
  peer.handlers.set('thread/unsubscribe', () => ({ status: 'unsubscribed' }));
  const host = createSideChatEndpointHost(deps);
  const scope = { hostId: parent.hostId, parentThreadId: parent.threadId };
  let nextPrepare = 0, nextForkDispatch = 0;
  const prepare = () => host.prepare({ ...scope, prepareId: 'prepare-' + ++nextPrepare });
  const input = (reply: SideChatEndpointReply) => ({ ...scope, operationId: reply.view.operationId, purpose: 'reconcile' as const });
  const action = (reply: SideChatEndpointReply) => ({ ...input(reply), token: reply.token!, forkDispatchId: 'dispatch-' + ++nextForkDispatch });
  function receipt() {
    return {
      thread: { id: 'fixture-child', name: null, cwd: parent.cwd, ephemeral: true, forkedFromId: parent.threadId,
        status: { type: 'idle' }, turns: [], secret: 'PRIVATE_THREAD' },
      cwd: parent.cwd, runtimeWorkspaceRoots: clone(parent.workspaceRoots), model: parent.model, modelProvider: parent.modelProvider,
      reasoningEffort: parent.effort, serviceTier: parent.serviceTier, approvalPolicy: parent.submitOptions.approvalPolicy,
      approvalsReviewer: parent.submitOptions.approvalsReviewer, sandbox: clone(parent.sandboxPolicy),
      activePermissionProfile: { id: ':read-only', extends: null }, secret: 'PRIVATE_RECEIPT',
    };
  }
  return { peer, connection, parent, store, deps, host, origins, prepare, input, action, receipt,
    setGeneration(value: string) { generation = value; }, setTimeout(value: number) { timeoutMs = value; } };
}

test('real connection records the fork response cursor before subsequent notifications, with its actual child and settings', async t => {
  const f = await fixture(t);
  const receipt = f.receipt();
  receipt.thread.turns = [{ id: 'initial-turn', status: 'completed', itemsView: 'full', error: null,
    items: [{ id: 'initial-item', type: 'agentMessage', text: 'fixture initial message' }] }] as never[];
  f.peer.handlers.set('thread/fork', (_params, { message, socket }) => {
    sendFrames(socket, [{ method: 'fixture/before', params: {} }, { id: message.id, result: receipt },
      { method: 'fixture/after', params: { threadId: 'fixture-child' } }]);
    return NO_REPLY;
  });
  const prepared = await f.prepare();
  const dispatch = f.action(prepared);
  const ready = await f.host.start(dispatch);
  await until(() => f.connection.eventCursor === 2);
  assert.deepEqual(ready.view.fork.receipt, { connectionGeneration: f.parent.connectionGeneration,
    attemptId: f.origins[0]!.attemptId, eventCursor: 1 });
  assert.equal(f.origins[0]!.attemptId, dispatch.forkDispatchId);
  assert.equal(f.origins[0]!.operationId, prepared.view.operationId);
  assert.deepEqual((await f.store.read(prepared.view.operationId))?.fork.receiptOrigin, ready.view.fork.receipt);
  assert.equal(ready.view.fork.status, 'received'); assert.equal(ready.view.inject.status, 'received');
  assert.deepEqual(ready.view.child, {
    thread: { id: 'fixture-child', name: null, cwd: '/fixture/workspace', ephemeral: true, forkedFromId: 'fixture-parent',
      status: { type: 'idle' }, turns: receipt.thread.turns },
    options: { model: 'fixture-model', effort: null, serviceTier: null, approvalPolicy: 'on-request',
      approvalsReviewer: 'user', sandboxMode: 'read-only', permissionProfileId: ':read-only' },
    modelProvider: 'fixture-provider', sandbox: { type: 'readOnly', networkAccess: false },
    activePermissionProfile: { id: ':read-only', extends: null }, runtimeWorkspaceRoots: ['/fixture/workspace', '/fixture/extra'],
  });
  assert.doesNotMatch(JSON.stringify(ready.view), /PRIVATE|forkParams|developerInstructions/);
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('thread/resume').length, 0); assert.equal(f.peer.calls('turn/start').length, 0);
});

test('a late original fork retains its response-time cursor through persistence failure without resending', async t => {
  const f = await fixture(t); f.setTimeout(20);
  let originalSocket: WebSocket | undefined;
  f.peer.handlers.set('thread/fork', (_params, { socket }) => { originalSocket = socket; return NO_REPLY; });
  const prepared = await f.prepare();
  let current = await f.host.start(f.action(prepared));
  assert.equal(current.view.fork.status, 'unknown');
  current = await f.host.retry(f.action(current));
  assert.equal(current.view.fork.status, 'unknown');
  const call = await f.peer.waitForCall('thread/fork');
  assert.ok(call);
  f.store.fail = (next, previous) => next.fork.status === 'received' && previous.fork.status === 'unknown';
  assert.ok(originalSocket);
  sendFrames(originalSocket, [{ method: 'fixture/before', params: {} }, { id: call.id, result: f.receipt() },
    { method: 'fixture/after', params: {} }]);
  await until(async () => (await f.host.read(f.input(prepared))).view.recoveryError !== null);
  assert.equal(f.connection.eventCursor, 2);
  current = await f.host.read(f.input(prepared));
  assert.equal(current.view.fork.status, 'unknown');
  f.store.fail = undefined;
  current = await f.host.retryPersistence(f.action(current));
  assert.equal(current.view.fork.status, 'received'); assert.equal(current.view.inject.status, 'received');
  assert.deepEqual(current.view.fork.receipt, { connectionGeneration: f.parent.connectionGeneration,
    attemptId: f.origins[0]!.attemptId, eventCursor: 1 });
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('thread/unsubscribe').length, 0);
});

test('the pre-captured dispatch identity becomes only its actual attempt and cannot relabel an old receipt', async t => {
  const f = await fixture(t);
  f.peer.handlers.set('thread/fork', () => f.receipt());
  const prepared = await f.prepare();
  await assert.rejects(f.host.start({ ...f.input(prepared), token: prepared.token! }),
    error => error instanceof Error && 'uncertain' in error && error.uncertain === false);
  assert.equal(f.peer.calls('thread/fork').length, 0);
  const requestFork = f.deps.requestFork;
  let first = true;
  f.deps.requestFork = (...args) => {
    if (first) { first = false; throw Object.assign(new Error('not sent'), { delivery: 'not-sent' }); }
    return requestFork(...args);
  };
  const firstDispatch = f.action(prepared);
  const unsent = await f.host.start(firstDispatch);
  assert.equal(unsent.view.fork.status, 'not-sent');
  const secondDispatch = f.action(unsent);
  await assert.rejects(f.host.retry({ ...secondDispatch, forkDispatchId: firstDispatch.forkDispatchId }),
    error => error instanceof Error && 'uncertain' in error && error.uncertain === false);
  const ready = await f.host.retry(secondDispatch);
  assert.equal(ready.view.fork.receipt?.attemptId, secondDispatch.forkDispatchId);
  assert.equal(f.origins[0]?.attemptId, secondDispatch.forkDispatchId);
  const current = await f.host.read(f.input(ready));
  await assert.rejects(f.host.start({ ...f.action(current), forkDispatchId: secondDispatch.forkDispatchId }),
    error => error instanceof Error && 'uncertain' in error && error.uncertain === false);
  const unrelated = f.action(current);
  const existing = await f.host.start(unrelated);
  assert.notEqual(existing.view.fork.receipt?.attemptId, unrelated.forkDispatchId);
  assert.equal(existing.view.fork.receipt?.attemptId, secondDispatch.forkDispatchId);
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('a late old attempt cannot overwrite a newer attempt or dispatch its boundary', async t => {
  const f = await fixture(t); f.setTimeout(20);
  f.peer.handlers.set('thread/fork', () => NO_REPLY);
  const prepared = await f.prepare();
  const unknown = await f.host.start(f.action(prepared));
  assert.equal(unknown.view.fork.status, 'unknown');
  const call = await f.peer.waitForCall('thread/fork');
  assert.ok(call);
  await f.store.update(prepared.view.operationId, op => ({ ...op, fork: { status: 'inflight', attemptId: 'new-attempt' } }));
  f.peer.send({ id: call.id, result: f.receipt() });
  await until(() => f.connection.pending.size === 0);
  await new Promise(resolve => setImmediate(resolve));
  const saved = await f.store.read(prepared.view.operationId);
  assert.equal(saved?.fork.attemptId, 'new-attempt'); assert.equal(saved?.fork.status, 'inflight');
  assert.equal(saved?.fork.receiptOrigin, undefined); assert.equal(saved?.childId, undefined);
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 0);
});

test('a stale attempt cannot advance a newer received fork or its pending close', async t => {
  for (const closing of [false, true]) {
    const f = await fixture(t); f.setTimeout(20);
    f.peer.handlers.set('thread/fork', () => NO_REPLY);
    const prepared = await f.prepare();
    await f.host.start(f.action(prepared));
    const call = await f.peer.waitForCall('thread/fork');
    assert.ok(call);
    await f.store.update(prepared.view.operationId, op => ({ ...op, childId: 'fixture-child',
      fork: { status: 'received', attemptId: 'new-attempt', receipt: f.receipt(),
        receiptOrigin: { connectionGeneration: f.parent.connectionGeneration, attemptId: 'new-attempt', eventCursor: 11 } },
      close: { ...op.close, requested: closing } }));
    f.peer.send({ id: call.id, result: f.receipt() });
    await until(() => f.connection.pending.size === 0);
    await new Promise(resolve => setImmediate(resolve));
    const saved = await f.store.read(prepared.view.operationId);
    assert.equal(saved?.fork.attemptId, 'new-attempt'); assert.equal(saved?.fork.receiptOrigin?.eventCursor, 11);
    assert.equal(saved?.inject.status, 'waiting'); assert.equal(saved?.close.status, 'idle');
    assert.equal(f.peer.calls('thread/inject_items').length, 0); assert.equal(f.peer.calls('thread/unsubscribe').length, 0);
  }
});

test('a replaced generation keeps an original late receipt but cannot send the boundary on the replacement', async t => {
  const f = await fixture(t); f.setTimeout(20);
  f.peer.handlers.set('thread/fork', () => NO_REPLY);
  const prepared = await f.prepare();
  const unknown = await f.host.start(f.action(prepared));
  assert.equal(unknown.view.fork.status, 'unknown');
  const call = await f.peer.waitForCall('thread/fork');
  assert.ok(call);
  f.setGeneration('replacement-generation');
  f.peer.send({ id: call.id, result: f.receipt() });
  await until(async () => (await f.store.read(prepared.view.operationId))?.inject.status === 'not-sent');
  const saved = await f.store.read(prepared.view.operationId);
  assert.equal(saved?.fork.receiptOrigin?.connectionGeneration, 'fixture-generation');
  assert.equal(saved?.fork.receiptOrigin?.attemptId, f.origins[0]!.attemptId);
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 0);
});

test('untrusted cursor values cannot authorize a newly received fork and an old record remains readable without one', async t => {
  const f = await fixture(t);
  f.peer.handlers.set('thread/fork', () => f.receipt());
  const requestFork = f.deps.requestFork;
  f.deps.requestFork = async (...args) => ({ ...(await requestFork(...args)), eventCursor: -1 });
  const prepared = await f.prepare();
  const invalid = await f.host.start(f.action(prepared));
  assert.equal(invalid.view.fork.status, 'invalid'); assert.equal(invalid.view.childId, 'fixture-child');
  assert.equal(invalid.view.fork.receipt, undefined); assert.equal(invalid.view.child, null);
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  f.deps.requestFork = requestFork;
  const oldPrepared = await f.prepare();
  const ready = await f.host.start(f.action(oldPrepared));
  assert.equal(ready.view.fork.status, 'received');
  await f.store.update(oldPrepared.view.operationId, op => {
    const fork = { ...op.fork }; delete fork.receiptOrigin; return { ...op, fork };
  });
  const old = await f.host.read(f.input(oldPrepared));
  assert.equal(old.view.fork.receipt, undefined); assert.ok(old.view.child);
  assert.match(old.view.fork.error ?? '', /缺少连接游标/);
  assert.equal(f.peer.calls('thread/fork').length, 2);
});

test('a late result without its original transport cursor retains its child but does not inject or replay', async t => {
  const f = await fixture(t); f.setTimeout(20);
  f.peer.handlers.set('thread/fork', () => NO_REPLY);
  const requestFork = f.deps.requestFork;
  f.deps.requestFork = (scope, attemptId, params, late) => requestFork(scope, attemptId, params, terminal =>
    late(terminal.outcome === 'success' ? { outcome: 'success', result: terminal.result } : terminal));
  const prepared = await f.prepare();
  const unknown = await f.host.start(f.action(prepared));
  assert.equal(unknown.view.fork.status, 'unknown');
  const call = await f.peer.waitForCall('thread/fork');
  assert.ok(call);
  f.peer.send({ id: call.id, result: f.receipt() });
  await until(async () => (await f.store.read(prepared.view.operationId))?.fork.status === 'invalid');
  const invalid = await f.host.read(f.input(prepared));
  assert.equal(invalid.view.childId, 'fixture-child'); assert.equal(invalid.view.child, null);
  assert.equal(invalid.view.fork.receipt, undefined); assert.ok(invalid.view.fork.error);
  await f.host.retry(f.action(invalid));
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 0);
});

test('missing or invalid child settings and malformed turns never become parent defaults', async t => {
  const changes: { field: string; apply: (value: Value) => void }[] = [
    { field: 'model', apply: value => { value.model = ''; } },
    { field: 'provider', apply: value => { delete value.modelProvider; } },
    { field: 'effort', apply: value => { value.reasoningEffort = ''; } },
    { field: 'tier', apply: value => { value.serviceTier = ''; } },
    { field: 'approval', apply: value => { delete value.approvalPolicy; } },
    { field: 'reviewer', apply: value => { delete value.approvalsReviewer; } },
    { field: 'sandbox', apply: value => { value.sandbox = { type: 'readOnly' }; } },
    { field: 'profile missing', apply: value => { delete value.activePermissionProfile; } },
    { field: 'profile empty', apply: value => { value.activePermissionProfile = { id: '' }; } },
    { field: 'profile blank', apply: value => { value.activePermissionProfile = { id: '  ' }; } },
    { field: 'profile extends invalid', apply: value => { value.activePermissionProfile = { id: ':read-only', extends: 3 }; } },
    { field: 'mode unknown', apply: value => { value.collaborationMode = 'future-mode'; } },
    { field: 'turn invalid', apply: value => { (value.thread as Value).turns = [{ id: 'turn', status: 'completed', items: [{}] }]; } },
    { field: 'turn error invalid', apply: value => { (value.thread as Value).turns = [{ id: 'turn', status: 'failed', items: [], error: 'bad' }]; } },
  ];
  for (const change of changes) {
    const f = await fixture(t);
    const result = f.receipt() as Value;
    change.apply(result);
    f.peer.handlers.set('thread/fork', () => result);
    const prepared = await f.prepare();
    const settled = await f.host.start(f.action(prepared));
    assert.equal(settled.view.child, null, change.field);
    assert.notEqual(settled.view.fork.error, null, change.field);
    assert.equal(settled.view.childId, 'fixture-child', change.field);
    assert.doesNotMatch(JSON.stringify(settled.view), /PRIVATE/, change.field);
  }
});

test('nonempty future effort and tier, empty roots and null profile are projected exactly from the fork', async t => {
  const f = await fixture(t, { effort: 'future-effort', serviceTier: 'future-tier', workspaceRoots: [],
    submitOptions: { model: 'fixture-model', effort: 'future-effort', serviceTier: 'future-tier', mode: 'plan',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only' } });
  const result = { ...f.receipt(), activePermissionProfile: null, collaborationMode: 'default' };
  f.peer.handlers.set('thread/fork', () => result);
  const ready = await f.host.start(f.action(await f.prepare()));
  assert.equal(ready.view.child?.options.effort, 'future-effort');
  assert.equal(ready.view.child?.options.serviceTier, 'future-tier');
  assert.equal(ready.view.child?.options.mode, 'default');
  assert.equal(ready.view.child?.activePermissionProfile, null);
  assert.deepEqual(ready.view.child?.runtimeWorkspaceRoots, []);
  assert.equal(ready.view.child?.options.permissionProfileId, undefined);
});

test('the complete workspace sandbox and granular approval come from the fork receipt', async t => {
  const policy = { granular: { sandbox_approval: true, rules: false, skill_approval: true,
    request_permissions: false, mcp_elicitations: true } };
  const sandbox = { type: 'workspaceWrite', writableRoots: ['/fixture/workspace', '/fixture/extra'],
    networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: false };
  const f = await fixture(t, { effort: 'high', serviceTier: 'standard', sandboxPolicy: sandbox,
    submitOptions: { model: 'fixture-model', effort: 'high', serviceTier: 'standard',
      approvalPolicy: policy, approvalsReviewer: 'auto_review', sandboxMode: 'workspace-write' } });
  const result = { ...f.receipt(), activePermissionProfile: null };
  f.peer.handlers.set('thread/fork', () => result);
  const ready = await f.host.start(f.action(await f.prepare()));
  assert.deepEqual(ready.view.child?.sandbox, sandbox);
  assert.deepEqual(ready.view.child?.options, { model: 'fixture-model', effort: 'high', serviceTier: 'standard',
    approvalPolicy: policy, approvalsReviewer: 'auto_review', sandboxMode: 'workspace-write' });
  assert.equal(ready.view.child?.activePermissionProfile, null);
});

test('an external sandbox with a verified profile is retained without inventing a sandbox mode', async t => {
  const sandbox = { type: 'externalSandbox', networkAccess: 'restricted' };
  const f = await fixture(t, { sandboxPolicy: sandbox, submitOptions: { approvalPolicy: 'never', approvalsReviewer: 'user',
    permissionProfileId: 'fixture-profile' } });
  const result = { ...f.receipt(), activePermissionProfile: { id: 'fixture-profile', extends: ':read-only' } };
  f.peer.handlers.set('thread/fork', () => result);
  const ready = await f.host.start(f.action(await f.prepare()));
  assert.deepEqual(ready.view.child?.sandbox, sandbox);
  assert.deepEqual(ready.view.child?.activePermissionProfile, { id: 'fixture-profile', extends: ':read-only' });
  assert.equal(ready.view.child?.options.permissionProfileId, 'fixture-profile');
  assert.equal(ready.view.child?.options.sandboxMode, undefined);
});

test('changed generation or a closed original socket blocks fork before the actual connection send', async t => {
  const f = await fixture(t); f.peer.handlers.set('thread/fork', () => f.receipt());
  const prepared = await f.prepare();
  f.setGeneration('another-generation');
  await assert.rejects(f.host.start(f.action(prepared)), error => error instanceof Error && 'uncertain' in error && error.uncertain === false);
  assert.equal(f.origins.length, 0); assert.equal(f.peer.calls('thread/fork').length, 0);
  f.setGeneration(f.parent.connectionGeneration);
  f.connection.close();
  await assert.rejects(f.host.start(f.action(prepared)), error => error instanceof Error && 'uncertain' in error && error.uncertain === false);
  assert.equal(f.origins.length, 0); assert.equal(f.peer.calls('thread/fork').length, 0);
});

test('a saved cursor cannot be rebound to a different attempt or connection generation', async t => {
  const f = await fixture(t); f.peer.handlers.set('thread/fork', () => f.receipt());
  const ready = await f.host.start(f.action(await f.prepare()));
  const id = ready.view.operationId;
  const saved = (await f.store.read(id))!;
  for (const field of ['attemptId', 'connectionGeneration'] as const) {
    await f.store.update(id, op => ({ ...op, fork: { ...op.fork, receiptOrigin: { ...op.fork.receiptOrigin!, [field]: 'wrong' } } }));
    await assert.rejects(f.host.read(f.input(ready)), /无法读取原侧聊记录/);
    await f.store.update(id, () => clone(saved));
  }
  assert.equal((await f.host.read(f.input(ready))).view.childId, 'fixture-child');
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 1);
});
