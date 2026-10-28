import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { LateRpcTerminal } from '../lib/codex-protocol.ts';
import { createNativeState, NativeStateCommitError } from '../src/native/native-state.ts';
import type { NativeStateCheckpoint, NativeStateRoot } from '../src/native/native-state.ts';
import { createPreferenceWrites } from '../src/native/preference-writes.ts';
import { createSideChatEndpointHost } from '../src/native/side-chat-host.ts';
import type { SideChatEndpointDependencies } from '../src/native/side-chat-host.ts';
import { createSideChatStore } from '../src/native/side-chat-store.ts';
import type { SideChatOperation } from '../src/native/side-chat.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';

type Value = Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): Value => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Value;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function replace(target: Value, next: Value): void {
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of Object.entries(next)) {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  }
}

function operation(): SideChatOperation {
  return { version: 1, operationId: 'operation-1', parent: {
    hostId: 'host-a', threadId: 'parent-a', connectionGeneration: 'connection-a', cwd: '/workspace/a',
    workspaceRoots: ['/workspace/a'], archived: false, model: 'model-a', modelProvider: 'provider-a',
    effort: null, serviceTier: null, project: null, sandboxPolicy: { type: 'readOnly' },
    submitOptions: { approvalPolicy: 'on-request', approvalsReviewer: 'user' },
  }, instructionSource: 'host-config', configuredInstructions: null, forkParams: {}, boundaryItems: [],
  fork: { status: 'waiting' }, inject: { status: 'waiting' }, close: { status: 'idle', requested: false } };
}

async function fixture(initial: NativeStateRoot = {
  globals: { keep: 'global' }, settings: { theme: 'light' }, configOperations: [{ id: 'config-1', state: 'unknown' }],
  future: { nested: [1, { keep: true }] },
}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'yard-native-state-'));
  const path = join(dataDir, 'native-state.json');
  await writeFile(path, JSON.stringify(initial), { mode: 0o600 });
  const state: Value = {}, globals: Value = {}, settings: Value = {};
  let checkpoint: ((step: NativeStateCheckpoint) => void | Promise<void>) | undefined;
  let afterPublish: (() => void | Promise<void>) | undefined;
  let validateHook: ((root: NativeStateRoot) => void | Promise<void>) | undefined;
  let publishes = 0;
  const owner = createNativeState({
    dataDir,
    async validate(root) { await validateHook?.(root); },
    async publish(root) {
      publishes++;
      replace(globals, object(root.globals));
      replace(settings, object(root.settings));
      replace(state, { ...root, globals, settings });
      await afterPublish?.();
    },
    async checkpoint(step) { await checkpoint?.(step); },
  });
  const loaded = await owner.load();
  replace(globals, object(loaded.globals));
  replace(settings, object(loaded.settings));
  replace(state, { ...loaded, globals, settings });
  const mutations = createStateMutations(owner.beforeAction);
  const preference = createPreferenceWrites(settings, globals, () => owner.persist(state), () => {}, () => {}, mutations);
  const sideChats = createSideChatStore({ mutations, read: () => state.sideChats,
    persist: section => owner.persist({ ...state, sideChats: section }) });
  return { dataDir, path, state, globals, settings, owner, mutations, preference, sideChats,
    disk: async () => JSON.parse(await readFile(path, 'utf8')) as NativeStateRoot,
    checkpoint(value?: (step: NativeStateCheckpoint) => void | Promise<void>) { checkpoint = value; },
    afterPublish(value?: () => void | Promise<void>) { afterPublish = value; },
    validate(value?: (root: NativeStateRoot) => void | Promise<void>) { validateHook = value; },
    publishes: () => publishes,
    dispose: () => rm(dataDir, { recursive: true, force: true }) };
}

function failure(uncertain: boolean) {
  return (error: unknown) => error instanceof NativeStateCommitError && error.uncertain === uncertain;
}

test('startup handles missing and malformed files without replacing existing bytes', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'yard-native-state-startup-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const path = join(dataDir, 'native-state.json');
  const missing = createNativeState({ dataDir, publish: () => {} });
  assert.deepEqual(await missing.load(), {});
  await assert.rejects(readFile(path), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  await assert.rejects(missing.load(), /只能在启动时载入一次/);
  for (const contents of ['{ broken', 'null', '[1,2]', '0']) {
    await writeFile(path, contents);
    const owner = createNativeState({ dataDir, publish: () => {} });
    await assert.rejects(owner.load());
    assert.equal(await readFile(path, 'utf8'), contents);
  }
  const contents = '{"settings":{"theme":"light"},"future":{"keep":true,"negativeZero":-0}}';
  await writeFile(path, contents);
  let failStartupSync: NativeStateCheckpoint | null = 'startup-file-sync';
  const restarting = createNativeState({ dataDir, publish: () => {}, checkpoint(step) {
    if (step === failStartupSync) throw new Error('startup sync failed');
  } });
  await assert.rejects(restarting.load(), /startup sync failed/);
  assert.throws(restarting.assertAvailable, /尚未载入/);
  assert.equal(await readFile(path, 'utf8'), contents);
  failStartupSync = 'startup-directory-sync';
  await assert.rejects(restarting.load(), /startup sync failed/);
  assert.throws(restarting.assertAvailable, /尚未载入/);
  failStartupSync = null;
  const restored = await restarting.load();
  assert.deepEqual(restored, JSON.parse(contents));
  assert.equal(Object.is(object(restored.future).negativeZero, -0), true);
});

test('pre-rename file fsync failure rolls back the caller and leaves the old disk snapshot', async t => {
  const f = await fixture(); t.after(f.dispose);
  const previous = await f.disk();
  f.checkpoint(step => { if (step === 'file-sync') throw new Error('file sync failed'); });
  await assert.rejects(f.preference('setting', 'theme', 'dark'), failure(false));
  assert.equal(f.settings.theme, 'light');
  assert.deepEqual(await f.disk(), previous);
  assert.equal(f.publishes(), 0);
  f.owner.assertAvailable();
  f.checkpoint();
  await f.preference('global', 'after-failure', true);
  assert.equal(object((await f.disk()).globals)['after-failure'], true);
  assert.equal(object((await f.disk()).settings).theme, 'light');
});

test('directory sync uncertainty waits for the failed caller rollback before restoring any references', async t => {
  const f = await fixture(); t.after(f.dispose);
  const reached = deferred(), release = deferred();
  f.checkpoint(step => { if (step === 'directory-sync') throw new Error('directory sync failed'); });
  let rolledBack = false, nextRan = false;
  const failed = f.mutations.run(async () => {
    f.settings.theme = 'dark';
    try { await f.owner.persist(f.state); }
    catch (error) {
      reached.resolve();
      await release.promise;
      f.settings.theme = 'light';
      rolledBack = true;
      throw error;
    }
  });
  const rejected = assert.rejects(failed, failure(true));
  await reached.promise;
  assert.equal(object((await f.disk()).settings).theme, 'dark');
  assert.throws(f.owner.assertAvailable, failure(true));
  f.checkpoint();
  const originalGlobals = f.globals, originalSettings = f.settings, originalRoot = f.state;
  const next = f.mutations.run(async () => {
    nextRan = true;
    assert.equal(rolledBack, true);
    assert.equal(f.state, originalRoot);
    assert.equal(f.state.globals, originalGlobals);
    assert.equal(f.state.settings, originalSettings);
    assert.equal(f.settings.theme, 'dark');
    f.globals.next = 'saved';
    await f.owner.persist(f.state);
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nextRan, false);
  assert.equal(f.publishes(), 0);
  release.resolve();
  await rejected; await next;
  const saved = await f.disk();
  assert.equal(object(saved.settings).theme, 'dark');
  assert.equal(object(saved.globals).next, 'saved');
  assert.deepEqual(saved.future, { nested: [1, { keep: true }] });
  assert.deepEqual(saved.configOperations, [{ id: 'config-1', state: 'unknown' }]);
});

test('lost rename confirmation preserves the side-chat prepare through another section write', async t => {
  const f = await fixture(); t.after(f.dispose);
  f.checkpoint(step => { if (step === 'rename') throw new Error('rename confirmation lost'); });
  await assert.rejects(f.sideChats.createPrepared('prepare-1', operation()), failure(true));
  assert.equal(f.state.sideChats, undefined);
  const onDisk = object((await f.disk()).sideChats);
  assert.equal(object(onDisk.prepared)['prepare-1'], 'operation-1');
  assert.throws(f.owner.assertAvailable, failure(true));
  f.checkpoint();
  await f.preference('setting', 'theme', 'dark');
  assert.equal((await f.sideChats.readPrepared('prepare-1'))?.operationId, 'operation-1');
  const result = await f.disk();
  assert.equal(object(result.settings).theme, 'dark');
  assert.equal(object(object(result.sideChats).prepared)['prepare-1'], 'operation-1');
  assert.deepEqual(result.configOperations, [{ id: 'config-1', state: 'unknown' }]);
  assert.deepEqual(result.future, { nested: [1, { keep: true }] });
});

test('file reconciliation does not replay a late fork or send its boundary until explicit receipt recovery', async t => {
  const f = await fixture(); t.after(f.dispose);
  const parent = operation().parent, calls: string[] = [];
  let lateFork: ((terminal: LateRpcTerminal) => void | Promise<void>) | undefined;
  const forkReceipt = { thread: { id: 'child-a', name: null, cwd: parent.cwd, turns: [], status: { type: 'idle' },
    ephemeral: true, forkedFromId: parent.threadId }, cwd: parent.cwd, runtimeWorkspaceRoots: parent.workspaceRoots,
  model: parent.model, modelProvider: parent.modelProvider, reasoningEffort: null, serviceTier: 'default',
  approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: parent.sandboxPolicy };
  const dependencies: SideChatEndpointDependencies = {
    store: f.sideChats, ownerId: 'host-process',
    async resolveParent(hostId, threadId) {
      assert.equal(hostId, parent.hostId); assert.equal(threadId, parent.threadId); return clone(parent);
    },
    async withParent(hostId, threadId, run) {
      assert.equal(hostId, parent.hostId); assert.equal(threadId, parent.threadId); return run();
    },
    async withScope(scope, _access, run) {
      assert.equal(scope.hostId, parent.hostId); assert.equal(scope.parentThreadId, parent.threadId);
      assert.equal(scope.connectionGeneration, parent.connectionGeneration); return run();
    },
    async request(scope, method, _params, _mutating, late) {
      assert.equal(scope.connectionGeneration, parent.connectionGeneration);
      calls.push(method);
      if (method === 'config/read') return { config: { developer_instructions: null } };
      if (method === 'thread/fork') { lateFork = late; throw new Error('synthetic timeout'); }
      if (method === 'thread/inject_items') return {};
      throw new Error('unexpected request');
    },
    classifyFailure: () => 'unknown', prepareClose: async () => {}, cleanup: async () => {},
    ownerStopped: () => false, notify: () => {},
  };
  const host = createSideChatEndpointHost(dependencies);
  const scope = { hostId: parent.hostId, parentThreadId: parent.threadId };
  const prepared = await host.prepare({ ...scope, prepareId: 'prepare-late' });
  assert.ok(prepared.token);
  const unknown = await host.start({ ...scope, operationId: prepared.view.operationId, token: prepared.token });
  assert.equal(unknown.view.fork.status, 'unknown');
  let loseConfirmation = true;
  f.checkpoint(step => {
    if (step === 'rename' && loseConfirmation) { loseConfirmation = false; throw new Error('confirmation lost'); }
  });
  assert.ok(lateFork);
  await lateFork({ outcome: 'success', result: forkReceipt });
  let view = await host.read({ ...scope, operationId: prepared.view.operationId });
  for (let attempt = 0; attempt < 100 && !view.view.recoveryError; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    view = await host.read({ ...scope, operationId: prepared.view.operationId });
  }
  assert.equal(loseConfirmation, false);
  assert.notEqual(view.view.recoveryError, null);
  assert.equal(view.view.childId, 'child-a');
  assert.equal(view.view.inject.status, 'waiting');
  assert.deepEqual(calls, ['config/read', 'thread/fork']);
  assert.ok(view.token);
  const recovered = await host.retryPersistence({ ...scope, operationId: prepared.view.operationId, token: view.token });
  assert.equal(recovered.view.inject.status, 'received');
  assert.equal(recovered.view.recoveryError, null);
  assert.deepEqual(calls, ['config/read', 'thread/fork', 'thread/inject_items']);
  const disk = await f.disk();
  assert.equal(object(object(disk.sideChats).prepared)['prepare-late'], prepared.view.operationId);
});

test('failed recovery file or directory fsync rejects every queued read and write until recovered', async t => {
  const f = await fixture(); t.after(f.dispose);
  f.checkpoint(step => { if (step === 'rename') throw new Error('confirmation lost'); });
  await assert.rejects(f.sideChats.createPrepared('prepare-1', operation()), failure(true));
  let calls = 0;
  f.checkpoint(step => { if (step === 'recovery-file-sync') throw new Error('file sync unavailable'); });
  await assert.rejects(f.mutations.run(() => { calls++; }), failure(true));
  await assert.rejects(f.preference('global', 'uncommitted', true), failure(true));
  assert.throws(f.owner.assertAvailable, failure(true));
  assert.equal(calls, 0);
  f.checkpoint(step => { if (step === 'recovery-directory-sync') throw new Error('directory sync unavailable'); });
  await assert.rejects(f.sideChats.readPrepared('prepare-1'), failure(true));
  assert.equal(f.state.sideChats, undefined);
  assert.equal(f.globals.uncommitted, undefined);
  f.checkpoint();
  await f.mutations.run(() => { calls++; });
  assert.equal(calls, 1);
  assert.equal((await f.sideChats.readPrepared('prepare-1'))?.operationId, 'operation-1');
  assert.equal(f.globals.uncommitted, undefined);
});

test('missing, damaged or rejected recovery file remains isolated and is never replaced with an empty root', async t => {
  const f = await fixture(); t.after(f.dispose);
  f.checkpoint(step => { if (step === 'rename') throw new Error('confirmation lost'); });
  await assert.rejects(f.sideChats.createPrepared('prepare-1', operation()), failure(true));
  f.checkpoint();
  const original = await readFile(f.path, 'utf8');
  await rm(f.path);
  await assert.rejects(f.mutations.run(() => { throw new Error('must not run'); }), failure(true));
  await writeFile(f.path, '{ broken');
  await assert.rejects(f.mutations.run(() => { throw new Error('must not run'); }), failure(true));
  assert.equal(await readFile(f.path, 'utf8'), '{ broken');
  await writeFile(f.path, original);
  f.validate(() => { throw new Error('section rejected'); });
  await assert.rejects(f.mutations.run(() => { throw new Error('must not run'); }), failure(true));
  assert.throws(f.owner.assertAvailable, failure(true));
  f.validate();
  const restored = await f.sideChats.readPrepared('prepare-1');
  assert.equal(restored?.operationId, 'operation-1');
  assert.deepEqual((await f.disk()).future, { nested: [1, { keep: true }] });
});

test('publication failure after durable rename is uncertain and recovery follows the caller rollback', async t => {
  const f = await fixture(); t.after(f.dispose);
  f.afterPublish(() => { throw new Error('publish failed'); });
  await assert.rejects(f.preference('setting', 'theme', 'dark'), failure(true));
  assert.equal(f.settings.theme, 'light');
  assert.equal(object((await f.disk()).settings).theme, 'dark');
  assert.throws(f.owner.assertAvailable, failure(true));
  await assert.rejects(f.mutations.run(() => { throw new Error('must not run'); }), failure(true));
  assert.throws(f.owner.assertAvailable, failure(true));
  f.afterPublish();
  const observed = await f.mutations.run(() => f.settings.theme);
  assert.equal(observed, 'dark');
  assert.equal(f.state.settings, f.settings);
});

test('normal concurrent transactions serialize and preserve unrelated JSON sections', async t => {
  const f = await fixture(); t.after(f.dispose);
  const entered = deferred(), release = deferred();
  let first = true;
  f.checkpoint(async step => {
    if (step === 'file-sync' && first) { first = false; entered.resolve(); await release.promise; }
  });
  const one = f.preference('setting', 'theme', 'dark');
  await entered.promise;
  const two = f.sideChats.createPrepared('prepare-1', operation());
  const three = f.preference('global', 'new-key', { value: 1 });
  release.resolve();
  await Promise.all([one, two, three]);
  const disk = await f.disk();
  assert.equal(object(disk.settings).theme, 'dark');
  assert.deepEqual(object(disk.globals)['new-key'], { value: 1 });
  assert.equal(object(object(disk.sideChats).prepared)['prepare-1'], 'operation-1');
  assert.deepEqual(disk.configOperations, [{ id: 'config-1', state: 'unknown' }]);
  assert.deepEqual(disk.future, { nested: [1, { keep: true }] });
});

test('publishing an unknown prototype-named field preserves it without changing object prototypes', async t => {
  const initial = JSON.parse('{"globals":{},"settings":{},"__proto__":{"preserved":true}}') as NativeStateRoot;
  const f = await fixture(initial); t.after(f.dispose);
  await f.preference('setting', 'theme', 'dark');
  const disk = await f.disk();
  assert.equal(Object.hasOwn(disk, '__proto__'), true);
  assert.deepEqual(disk.__proto__, { preserved: true });
  assert.equal(Object.hasOwn(f.state, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(f.state), Object.prototype);
});

test('an unknown negative zero survives a complete snapshot and publication', async t => {
  const f = await fixture(); t.after(f.dispose);
  await f.mutations.run(async () => {
    f.state.future = { ...object(f.state.future), negativeZero: -0 };
    await f.owner.persist(f.state);
  });
  assert.equal(Object.is(object(f.state.future).negativeZero, -0), true);
  assert.equal(Object.is(object((await f.disk()).future).negativeZero, -0), true);
  assert.match(await readFile(f.path, 'utf8'), /"negativeZero": -0/);
});

test('snapshot is captured before asynchronous filesystem work and rejects lossy values', async t => {
  const f = await fixture(); t.after(f.dispose);
  const entered = deferred(), release = deferred();
  f.checkpoint(async step => { if (step === 'file-sync') { entered.resolve(); await release.promise; } });
  const proposed = clone(f.state);
  const written = f.mutations.run(() => f.owner.persist(proposed));
  await entered.promise;
  assert.throws(f.owner.assertAvailable, /提交正在进行/);
  object(proposed.future).changed = true;
  release.resolve();
  await written;
  assert.equal(object((await f.disk()).future).changed, undefined);
  f.checkpoint();
  const before = await f.disk(), invalid = { ...f.state, future: { lost: Number.NaN } };
  await assert.rejects(f.mutations.run(() => f.owner.persist(invalid)), failure(false));
  assert.deepEqual(await f.disk(), before);
  f.owner.assertAvailable();
});

test('optional transaction hook fails before the action and flush remains a drain', async () => {
  let hookCalls = 0, actionCalls = 0, fail = true;
  const mutations = createStateMutations(async () => {
    hookCalls++;
    if (fail) throw new Error('barrier unavailable');
  });
  await assert.rejects(mutations.run(() => { actionCalls++; }), /barrier unavailable/);
  await mutations.flush();
  assert.equal(hookCalls, 1);
  assert.equal(actionCalls, 0);
  fail = false;
  assert.equal(await mutations.run(() => { actionCalls++; return 'ok'; }), 'ok');
  assert.equal(hookCalls, 2);
  assert.equal(actionCalls, 1);
});
