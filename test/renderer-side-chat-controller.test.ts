import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { SideChatController } from '../src/renderer/side-chat/controller.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import type { SideChatOperation, SideChatOperationResult, SideChatOperations, SideChatParent } from '../src/renderer/side-chat/types.ts';

function parent(hostId = 'host-a', threadId = 'parent-a'): SideChatParent {
  return { hostId, threadId, cwd: '/synthetic/project', archived: false, workspaceRoots: ['/synthetic/project', '/synthetic/other'],
    projectId: 'project-a', options: { model: 'model-a', effort: 'high', mode: 'plan', approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write', permissionProfileId: 'profile-a', serviceTier: 'fast' },
    developerInstructions: { text: 'PARENT INSTRUCTIONS', source: 'parent snapshot' }, forkConfig: { feature: true },
    capabilities: { ephemeralFork: true, boundaryInjection: true, preventGoalContinuation: true, discard: 'unsubscribe' } };
}
function child(id: string): { thread: ThreadSummary } { return { thread: { id, name: null, cwd: '/synthetic/project', turns: [], status: { type: 'idle' } } }; }
const success = (result: unknown = {}): SideChatOperationResult => ({ outcome: 'success', result });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('fork uses the captured parent and injects a boundary before becoming ready', async () => {
  const source = parent(), calls: SideChatOperation[] = [], cleanups: unknown[] = [];
  const operations: SideChatOperations = { async execute(operation) {
    calls.push(operation); return success(operation.kind === 'fork' ? child('child-a') : {});
  }, async prepareClose() {}, async interrupt() {}, async cleanup(scope) { cleanups.push(scope); } };
  const controller = new SideChatController(source, 'side-draft-a', operations);
  source.hostId = 'host-b'; source.threadId = 'parent-b'; source.cwd = '/different';
  source.workspaceRoots[0] = '/different'; source.options.model = 'changed';
  await controller.start();
  assert.equal(controller.getSnapshot().phase, 'ready');
  assert.equal(controller.getSnapshot().thread?.id, 'child-a');
  assert.deepEqual(calls.map(call => [call.kind, call.hostId, call.parentThreadId, call.childThreadId]), [
    ['fork', 'host-a', 'parent-a', null], ['boundary', 'host-a', 'parent-a', 'child-a'],
  ]);
  const fork = calls[0]!.params;
  assert.equal(fork.threadId, 'parent-a'); assert.equal(fork.cwd, '/synthetic/project');
  assert.deepEqual(fork.runtimeWorkspaceRoots, ['/synthetic/project', '/synthetic/other']);
  assert.equal(fork.model, 'model-a'); assert.equal(fork.ephemeral, true); assert.equal(fork.deferGoalContinuation, true);
  assert.equal(fork.permissions, 'profile-a'); assert.equal('sandbox' in fork, false);
  assert.match(String(fork.developerInstructions), /PARENT INSTRUCTIONS/);
  assert.match(String(fork.developerInstructions), /sub-agents/i);
  assert.match(String(fork.developerInstructions), /Scheduled updates cannot run/);
  assert.match(JSON.stringify(calls[1]!.params.items), /preceding history belongs to the parent/);
  assert.equal(cleanups.length, 0);
});

test('archived or unverified hosts fail before any mutation', async () => {
  let requests = 0;
  const operations: SideChatOperations = { async execute() { requests++; return success(); }, async prepareClose() {}, async interrupt() {}, async cleanup() {} };
  for (const change of [
    (value: SideChatParent) => { value.archived = true; },
    (value: SideChatParent) => { value.developerInstructions = null; },
    (value: SideChatParent) => { value.capabilities.preventGoalContinuation = false; },
    (value: SideChatParent) => { value.capabilities.discard = null; },
  ]) {
    const source = parent(); change(source);
    const controller = new SideChatController(source, 'draft', operations);
    await controller.start(); assert.equal(controller.getSnapshot().phase, 'create-failed');
  }
  assert.equal(requests, 0);
});

test('closing a pending creation cleans a late child on its original host and retains failures', async () => {
  const pending = deferred<SideChatOperationResult>(), calls: SideChatOperation[] = [], cleanups: unknown[] = [];
  let discardAttempts = 0;
  const operations: SideChatOperations = { async execute(operation) {
    calls.push(operation);
    if (operation.kind === 'fork') return pending.promise;
    if (operation.kind === 'discard' && ++discardAttempts === 1) return { outcome: 'not-applied', message: 'close rejected' };
    return success({ status: 'unsubscribed' });
  }, async prepareClose() {}, async interrupt() {}, async cleanup(scope) { cleanups.push(scope); } };
  const first = new SideChatController(parent(), 'draft-a', operations);
  const start = first.start();
  await first.close();
  const second = new SideChatController(parent('host-b', 'parent-b'), 'draft-b', {
    async execute(operation) { return success(operation.kind === 'fork' ? child('child-b') : {}); }, async prepareClose() {}, async interrupt() {}, async cleanup() {},
  });
  await second.start();
  pending.resolve(success(child('child-a'))); await start;
  assert.equal(second.getSnapshot().thread?.id, 'child-b');
  assert.equal(first.getSnapshot().phase, 'discard-failed');
  assert.equal(first.getSnapshot().thread?.id, 'child-a');
  assert.deepEqual(calls.map(call => call.kind), ['fork', 'discard']);
  assert.equal(calls[1]!.hostId, 'host-a');
  assert.deepEqual(calls[1]!.params, { threadId: 'child-a' });
  await first.retry();
  assert.equal(first.getSnapshot().phase, 'closed');
  assert.deepEqual(cleanups, [{ hostId: 'host-a', parentThreadId: 'parent-a', childThreadId: 'child-a' }]);
});

test('unknown fork is not replayed and a late original receipt is cleaned after close', async () => {
  const calls: SideChatOperation[] = [];
  const controller = new SideChatController(parent(), 'draft', { async execute(operation) {
    calls.push(operation); return operation.kind === 'fork' ? { outcome: 'unknown', message: 'lost response' } : success({ status: 'unsubscribed' });
  }, async prepareClose() {}, async interrupt() {}, async cleanup() {} });
  await controller.start();
  const id = controller.getSnapshot().operation!.id;
  assert.equal(controller.getSnapshot().phase, 'create-unknown');
  await controller.retry(); await controller.start(); await controller.close();
  assert.equal(calls.length, 1); assert.equal(controller.getSnapshot().closeRequested, true);
  await controller.acceptResult(id, success(child('late-child')));
  assert.equal(controller.getSnapshot().phase, 'closed');
  assert.deepEqual(calls.map(call => call.kind), ['fork', 'discard']);
  assert.equal(calls[1]!.params.threadId, 'late-child');
});

test('boundary and discard unknown results retain the child and require the original receipt', async () => {
  const calls: SideChatOperation[] = [];
  let cleanupAttempts = 0;
  const operations: SideChatOperations = { async execute(operation) {
    calls.push(operation);
    if (operation.kind === 'fork') return success(child('side'));
    return { outcome: 'unknown', message: operation.kind + ' unknown' };
  }, async prepareClose() {}, async interrupt() {}, async cleanup() { if (++cleanupAttempts === 1) throw Error('cache not cleared'); } };
  const controller = new SideChatController(parent(), 'draft', operations);
  await controller.start();
  assert.equal(controller.getSnapshot().phase, 'boundary-unknown');
  const boundaryId = controller.getSnapshot().operation!.id;
  await controller.retry(); assert.equal(calls.length, 2);
  await controller.acceptResult(boundaryId, success());
  assert.equal(controller.getSnapshot().phase, 'ready');
  await controller.close();
  assert.equal(controller.getSnapshot().phase, 'discard-unknown');
  const discardId = controller.getSnapshot().operation!.id;
  await controller.retry(); await controller.close(); assert.equal(calls.length, 3);
  await controller.acceptResult(discardId, success({ status: 'unsubscribed' }));
  assert.equal(controller.getSnapshot().phase, 'cleanup-failed');
  assert.equal(controller.getSnapshot().thread?.id, 'side');
  await controller.retry();
  assert.equal(controller.getSnapshot().phase, 'closed');
  assert.equal(calls.length, 3);
});

test('pending boundary close waits for its original receipt and then discards the same child', async () => {
  const calls: SideChatOperation[] = [];
  const controller = new SideChatController(parent(), 'draft', { async execute(operation) {
    calls.push(operation);
    if (operation.kind === 'fork') return success(child('side'));
    return operation.kind === 'boundary' ? { outcome: 'unknown', message: 'boundary receipt lost' } : success({ status: 'unsubscribed' });
  }, async prepareClose() {}, async interrupt() {}, async cleanup() {} });
  await controller.start();
  const boundaryId = controller.getSnapshot().operation!.id;
  await controller.close(); await controller.retry();
  assert.equal(controller.getSnapshot().phase, 'boundary-unknown');
  assert.deepEqual(calls.map(call => call.kind), ['fork', 'boundary']);
  await controller.acceptResult(boundaryId, success());
  assert.equal(controller.getSnapshot().phase, 'closed');
  assert.deepEqual(calls.map(call => call.kind), ['fork', 'boundary', 'discard']);
  assert.equal(calls[2]!.childThreadId, 'side');
});

test('restoring a pending request never sends it again, and rejects another owner', async () => {
  const pending = deferred<SideChatOperationResult>(), calls: SideChatOperation[] = [];
  const operations: SideChatOperations = { async execute(operation) { calls.push(operation); return pending.promise; }, async prepareClose() {}, async interrupt() {}, async cleanup() {} };
  const source = parent(), first = new SideChatController(source, 'draft', operations);
  const task = first.start();
  const snapshot = structuredClone(first.getSnapshot());
  const restored = new SideChatController(source, 'draft', operations, snapshot);
  assert.equal(restored.getSnapshot().phase, 'create-unknown');
  await restored.retry(); await restored.start(); assert.equal(calls.length, 1);
  assert.throws(() => new SideChatController(parent('other'), 'draft', operations, snapshot), /身份不匹配/);
  pending.resolve({ outcome: 'not-applied', message: 'no dispatch' }); await task;
  await restored.acceptResult(snapshot.operation!.id, { outcome: 'not-applied', message: 'no dispatch' });
  assert.equal(restored.getSnapshot().phase, 'create-failed');
});

test('close preparation failures reopen the same child and durable close never discards it', async () => {
  let preparation = 0, discards = 0, cleanup = 0;
  const operations: SideChatOperations = { async execute(operation) {
    if (operation.kind === 'discard') discards++;
    return success(operation.kind === 'fork' ? child('side') : operation.kind === 'discard' ? { status: 'unsubscribed' } : {});
  }, async prepareClose() { if (++preparation === 1) throw Error('voice stop failed'); }, async interrupt() {}, async cleanup() { cleanup++; } };
  const controller = new SideChatController(parent(), 'temporary', operations);
  await controller.start(); await controller.close();
  assert.equal(controller.getSnapshot().phase, 'close-failed');
  assert.equal(controller.getSnapshot().thread?.id, 'side'); assert.equal(discards, 0);
  controller.reopen(); assert.equal(controller.getSnapshot().phase, 'ready');
  await controller.close(); assert.equal(controller.getSnapshot().phase, 'closed');
  assert.equal(discards, 1); assert.equal(cleanup, 1);
  const source = parent(), durable = SideChatController.attachDurable(source, 'durable', operations, {
    hostId: source.hostId, parentThreadId: source.threadId, thread: child('durable-child').thread,
    childOptions: source.options, boundaryReady: true, hasActivity: true,
  });
  await durable.close();
  assert.equal(durable.getSnapshot().phase, 'closed');
  assert.equal(discards, 1); assert.equal(cleanup, 1);
  assert.throws(() => SideChatController.attachDurable(source, 'bad', operations, {
    hostId: 'other', parentThreadId: source.threadId, thread: child('wrong').thread,
    childOptions: source.options, boundaryReady: true, hasActivity: false,
  }), /身份无效/);
});

test('malformed discard receipt cannot clear a child or enable an automatic replay', async () => {
  let cleanup = 0, discards = 0;
  const controller = new SideChatController(parent(), 'draft', { async execute(operation) {
    if (operation.kind === 'discard') discards++;
    return success(operation.kind === 'fork' ? child('side') : {});
  }, async prepareClose() {}, async interrupt() {}, async cleanup() { cleanup++; } });
  await controller.start(); await controller.close();
  const operation = controller.getSnapshot().operation!;
  assert.equal(controller.getSnapshot().phase, 'discard-unknown');
  assert.equal(controller.getSnapshot().thread?.id, 'side'); assert.equal(cleanup, 0);
  await controller.retry(); assert.equal(discards, 1);
  await controller.acceptResult(operation.id, success({ status: 'unsubscribed' }));
  assert.equal(controller.getSnapshot().phase, 'closed'); assert.equal(cleanup, 1);
});

test('durable host ephemeral close uses stop and interrupts only its own active turn', async () => {
  const source = parent('remote', 'parent'), calls: SideChatOperation[] = [], interrupts: unknown[] = [];
  source.capabilities.discard = 'stop';
  const controller = new SideChatController(source, 'draft', { async execute(operation) {
    calls.push(operation); return success(operation.kind === 'fork' ? child('side') : {});
  }, async prepareClose() {}, async interrupt(scope) { interrupts.push(scope); throw Error('interrupt failed'); }, async cleanup() {} });
  await controller.start(); await controller.close('active-turn');
  assert.equal(controller.getSnapshot().phase, 'closed');
  assert.deepEqual(interrupts, [{ hostId: 'remote', threadId: 'side', turnId: 'active-turn' }]);
  assert.equal(calls.at(-1)?.method, 'thread/stop');
});

test('connection tracking survives a hidden panel and isolates host changes', async () => {
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const client: WorkbenchClient = { async rpc() { throw Error('unexpected'); }, async host() { throw Error('unexpected'); },
    async reply() { throw Error('unexpected'); }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  const operations: SideChatOperations = { async execute(operation) {
    return success(operation.kind === 'fork' ? child('side') : operation.kind === 'discard' ? { status: 'unsubscribed' } : {});
  }, async prepareClose() {}, async interrupt() {}, async cleanup() {} };
  const source = parent(), controller = new SideChatController(source, 'draft', operations);
  controller.watchConnection(client); controller.watchConnection(client);
  assert.equal(listeners.size, 1);
  await controller.start();
  for (const listener of listeners) listener({ type: 'codex-app-server-connection-changed', hostId: 'host-b', state: 'disconnected' });
  assert.equal(controller.getSnapshot().subscriptionLost, false);
  for (const listener of listeners) listener({ type: 'codex-app-server-connection-changed', hostId: 'host-a', state: 'disconnected' });
  assert.equal(controller.getSnapshot().subscriptionLost, true);
  controller.markSubscriptionRestored();
  const restored = new SideChatController(source, 'draft', operations, controller.getSnapshot());
  assert.equal(restored.getSnapshot().subscriptionLost, true);
  await controller.close();
  assert.equal(listeners.size, 0);
});
