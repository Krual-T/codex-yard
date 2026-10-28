import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { LateRpcTerminal } from '../lib/codex-protocol.ts';
import { createPreferenceWrites } from '../src/native/preference-writes.ts';
import { createSideChatEndpointHost } from '../src/native/side-chat-host.ts';
import type { SideChatEndpointDependencies } from '../src/native/side-chat-host.ts';
import { createSideChatStore } from '../src/native/side-chat-store.ts';
import type { SideChatOperation, SideChatParent } from '../src/native/side-chat.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';

type Value = Record<string, unknown>;
type Fault = 'before-rename' | 'after-rename' | null;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fileState(initial: Value = { globals: { keep: 'global' }, settings: { theme: 'light' }, future: { keep: true } }) {
  const directory = await mkdtemp(join(tmpdir(), 'yard-side-chat-store-'));
  const path = join(directory, 'native-state.json');
  const temp = join(directory, 'native-state.json.tmp');
  const mutations = createStateMutations();
  let state = clone(initial), quarantined = false, fault: Fault = null, writes = 0;
  let beforeWrite: ((next: Value) => Promise<void>) | undefined;
  await writeFile(path, JSON.stringify(state), { mode: 0o600 });

  // Test adapter uses the same write/rename sequence as the private server committer.
  async function write(next: Value): Promise<void> {
    if (quarantined) throw new Error('native state quarantined');
    const serialized = JSON.stringify(next, null, 2) + '\n';
    writes++;
    await beforeWrite?.(next);
    await writeFile(temp, serialized, { mode: 0o600 });
    if (fault === 'before-rename') { fault = null; throw new Error('before rename'); }
    await rename(temp, path);
    if (fault === 'after-rename') { fault = null; quarantined = true; throw new Error('after rename'); }
  }
  const store = () => createSideChatStore({
    mutations,
    read() {
      if (quarantined) throw new Error('native state quarantined');
      return state.sideChats;
    },
    async persist(section) {
      await write({ ...state, sideChats: section });
      state.sideChats = clone(section);
    },
  });
  return {
    path, mutations, store,
    state: () => state,
    disk: async () => JSON.parse(await readFile(path, 'utf8')) as Value,
    persistWhole: async () => write(state),
    fault: (value: Fault) => { fault = value; },
    beforeWrite: (value?: (next: Value) => Promise<void>) => { beforeWrite = value; },
    writes: () => writes,
    async recover() {
      await mutations.run(async () => {
        const restored = JSON.parse(await readFile(path, 'utf8')) as Value;
        state = restored;
        quarantined = false;
      });
    },
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}

function parent(overrides: Partial<SideChatParent> = {}): SideChatParent {
  return { hostId: 'host-a', threadId: 'parent-a', connectionGeneration: 'connection-a', cwd: '/workspace/a',
    workspaceRoots: ['/workspace/a'], archived: false, model: 'model-a', modelProvider: 'provider-a',
    effort: null, serviceTier: null, project: null, sandboxPolicy: { type: 'readOnly', networkAccess: false },
    submitOptions: { approvalPolicy: 'on-request', approvalsReviewer: 'user', mode: 'default' }, ...overrides };
}

function op(operationId: string, parentOverrides: Partial<SideChatParent> = {}): SideChatOperation {
  return { version: 1, operationId, parent: parent(parentOverrides), instructionSource: 'host-config',
    configuredInstructions: null, forkParams: { config: {} }, boundaryItems: [],
    fork: { status: 'waiting' }, inject: { status: 'waiting' }, close: { requested: false, status: 'idle' } };
}

test('concurrent prepare uses one atomic record and index across instances; input and output are detached', async t => {
  const f = await fileState(); t.after(f.dispose);
  const a = f.store(), b = f.store(), entered = deferred(), release = deferred();
  f.beforeWrite(async () => { entered.resolve(); await release.promise; });
  const firstInput = op('one');
  const first = a.createPrepared('__proto__', firstInput);
  await entered.promise;
  const second = b.createPrepared('__proto__', op('two'));
  const foreign = assert.rejects(b.createPrepared('__proto__', op('three', { hostId: 'host-b' })));
  firstInput.parent.cwd = '/changed-after-call';
  release.resolve();
  const [one, two] = await Promise.all([first, second]);
  await foreign;
  f.beforeWrite();
  assert.equal(one.operationId, 'one');
  assert.deepEqual(two, one);
  assert.equal(one.parent.cwd, '/workspace/a');
  assert.equal(f.writes(), 1);
  one.parent.cwd = '/changed-result';
  assert.equal((await b.readPrepared('__proto__'))?.parent.cwd, '/workspace/a');
  const disk = await f.disk();
  const section = disk.sideChats as { operations: Value; prepared: Value };
  assert.deepEqual(Object.keys(section.operations), ['one']);
  assert.equal(section.prepared.__proto__, 'one');
  assert.equal(Object.getPrototypeOf(section.prepared), Object.prototype);
  await assert.rejects(b.createPrepared('__proto__', op('three', { hostId: 'host-b' })));
  await assert.rejects(b.createPrepared('__proto__', op('three', { threadId: 'parent-b' })));
  await assert.rejects(b.createPrepared('__proto__', op('three', { connectionGeneration: 'connection-b' })));
  assert.equal(f.writes(), 1);
});

test('plain create has no prepare mapping and reserved object keys remain ordinary operation IDs', async t => {
  const f = await fileState(); t.after(f.dispose);
  const store = f.store();
  await store.create(op('__proto__'));
  assert.equal((await store.read('__proto__'))?.operationId, '__proto__');
  assert.equal(await store.readPrepared('__proto__'), null);
  await assert.rejects(store.create(op('__proto__')));
  const section = (await f.disk()).sideChats as { operations: Value; prepared: Value };
  assert.equal(Object.hasOwn(section.operations, '__proto__'), true);
  assert.equal(Object.hasOwn(section.prepared, '__proto__'), false);
});

test('file reload and new store reconstruct the same operation and preserve unknown extensions and fence', async t => {
  const original = op('one') as SideChatOperation & Value;
  original.futureOperation = { nested: ['preserved'] };
  original.fork = { status: 'not-sent', attemptId: 'old-attempt', error: 'old-error',
    futureFork: { keep: 1 } } as SideChatOperation['fork'];
  original.endpointFence = { version: 1, ownerId: 'owner', token: 'old', recovering: false,
    origin: { hostId: 'host-a', parentThreadId: 'parent-a', operationId: 'one', connectionGeneration: 'connection-a', future: 'origin' },
    active: { action: 'start', ownerId: 'owner', callId: 'call', future: 'active' }, futureFence: { keep: true } };
  const initial = { globals: { existing: 1 }, settings: {}, future: { keep: true }, sideChats: {
    version: 1, operations: { one: original }, prepared: { first: 'one' }, futureSection: { keep: ['section'] },
  } };
  const f = await fileState(initial); t.after(f.dispose);
  const store = f.store();
  await store.update('one', current => {
    const fence = (current as SideChatOperation & Value).endpointFence as Value;
    return { ...current, fork: { status: 'inflight', attemptId: 'attempt' }, endpointFence: {
      version: 1, ownerId: fence.ownerId, token: 'new', recovering: false,
      origin: { hostId: 'host-a', parentThreadId: 'parent-a', operationId: 'one', connectionGeneration: 'connection-a' },
      active: { action: 'start', ownerId: 'owner', callId: 'call' },
    } } as SideChatOperation;
  });
  await f.recover();
  const again = f.store(), persisted = await again.readPrepared('first') as SideChatOperation & Value;
  assert.deepEqual(persisted.futureOperation, { nested: ['preserved'] });
  assert.deepEqual((persisted.fork as unknown as Value).futureFork, { keep: 1 });
  assert.equal(persisted.fork.attemptId, 'attempt');
  assert.equal(persisted.fork.error, undefined);
  const fence = persisted.endpointFence as Value;
  assert.deepEqual(fence.futureFence, { keep: true });
  assert.equal((fence.origin as Value).future, 'origin');
  assert.equal((fence.active as Value).future, 'active');
  assert.equal(fence.token, 'new');
  const disk = await f.disk();
  assert.deepEqual((disk.sideChats as Value).futureSection, { keep: ['section'] });
  assert.deepEqual(disk.future, { keep: true });
});

test('a new state owner reconstructs and updates the original record from the file', async t => {
  const f = await fileState(); t.after(f.dispose);
  await f.store().createPrepared('prep', op('one'));
  const reconstructed = await f.disk();
  const mutations = createStateMutations();
  const temporary = f.path + '.restart-tmp';
  const restarted = createSideChatStore({
    mutations,
    read: () => reconstructed.sideChats,
    async persist(section) {
      const snapshot = JSON.stringify({ ...reconstructed, sideChats: section }) + '\n';
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, f.path);
      reconstructed.sideChats = clone(section);
    },
  });
  assert.equal((await restarted.readPrepared('prep'))?.operationId, 'one');
  await restarted.update('one', current => ({ ...current, close: { ...current.close, requested: true } }));
  const disk = await f.disk();
  const saved = ((disk.sideChats as Value).operations as Record<string, SideChatOperation>).one;
  assert.equal(saved.close.requested, true);
  assert.deepEqual(disk.future, { keep: true });
});

test('pre-rename failure keeps the old file and record; retry runs each callback once', async t => {
  const f = await fileState(); t.after(f.dispose);
  const store = f.store();
  await store.createPrepared('prep', op('one'));
  const before = await f.disk();
  let calls = 0;
  const update = (current: SideChatOperation): SideChatOperation => {
    calls++;
    current.fork = { status: 'inflight', attemptId: 'attempt' };
    return current;
  };
  f.fault('before-rename');
  await assert.rejects(store.update('one', update), /before rename/);
  assert.equal(calls, 1);
  assert.deepEqual(await f.disk(), before);
  assert.equal((await store.read('one'))?.fork.status, 'waiting');
  let rejectedCalls = 0;
  await assert.rejects(store.update('one', current => {
    rejectedCalls++;
    current.fork = { status: 'rejected', attemptId: 'not-saved' };
    throw new Error('callback rejected');
  }), /callback rejected/);
  assert.equal(rejectedCalls, 1);
  assert.equal((await store.read('one'))?.fork.status, 'waiting');
  const saved = await store.update('one', update);
  assert.equal(calls, 2);
  assert.equal(saved.fork.status, 'inflight');
  assert.equal((await f.store().read('one'))?.fork.status, 'inflight');
  await assert.rejects(store.update('one', current => ({ ...current, parent: { ...current.parent, cwd: '/other' } })));
  await assert.rejects(store.update('one', current => ({ ...current, operationId: 'other' })));
  await assert.rejects(store.update('one', current => ({ ...current, forkParams: { altered: true } })));
  await assert.rejects(store.create(op('one')));
  await assert.rejects(store.update('missing', current => current));
  assert.equal((await store.read('one'))?.parent.cwd, '/workspace/a');
});

test('failed initial prepare leaves neither half of its index, and a later explicit attempt can commit', async t => {
  const f = await fileState(); t.after(f.dispose);
  const a = f.store(), b = f.store(), before = await f.disk();
  f.fault('before-rename');
  await assert.rejects(a.createPrepared('prep', op('one')), /before rename/);
  assert.deepEqual(await f.disk(), before);
  assert.equal(await a.readPrepared('prep'), null);
  assert.equal(await b.read('one'), null);
  assert.equal((await b.createPrepared('prep', op('two'))).operationId, 'two');
  const saved = (await f.disk()).sideChats as { operations: Value; prepared: Value };
  assert.deepEqual(Object.keys(saved.operations), ['two']);
  assert.equal(saved.prepared.prep, 'two');
});

test('ambiguous post-rename failure quarantines the shared authority until disk reconciliation', async t => {
  const f = await fileState(); t.after(f.dispose);
  const a = f.store(), b = f.store();
  f.fault('after-rename');
  await assert.rejects(a.createPrepared('prep', op('one')), /after rename/);
  assert.equal(((await f.disk()).sideChats as { prepared: Value }).prepared.prep, 'one');
  await assert.rejects(b.readPrepared('prep'), /quarantined/);
  await assert.rejects(b.createPrepared('prep', op('two')), /quarantined/);
  await assert.rejects(f.mutations.run(() => f.persistWhole()), /quarantined/);
  await f.recover();
  const restored = await b.createPrepared('prep', op('two'));
  assert.equal(restored.operationId, 'one');
  assert.equal(Object.keys(((await f.disk()).sideChats as { operations: Value }).operations).length, 1);
});

test('unrecognized or inconsistent sections and non-JSON values fail closed without rewriting', async t => {
  for (const section of [null, {}, { version: 2, operations: {}, prepared: {} },
    { version: 1, operations: {}, prepared: { missing: 'gone' } },
    { version: 1, operations: { one: { version: 2, operationId: 'one' } }, prepared: {} }]) {
    const f = await fileState({ globals: {}, settings: {}, sideChats: section });
    t.after(f.dispose);
    const before = await f.disk(), store = f.store();
    await assert.rejects(store.read('one'));
    await assert.rejects(store.createPrepared('prep', op('one')));
    assert.equal(f.writes(), 0);
    assert.deepEqual(await f.disk(), before);
  }
  const f = await fileState(); t.after(f.dispose);
  const invalid = op('one') as SideChatOperation & Value;
  invalid.future = { cannotPersist: Number.NaN };
  await assert.rejects(f.store().create(invalid));
  assert.equal(f.writes(), 0);
});

test('side chat and existing preferences serialize through the same native-state transaction', async t => {
  const f = await fileState(); t.after(f.dispose);
  const store = f.store(), entered = deferred(), release = deferred();
  let held = true;
  f.beforeWrite(async () => { if (held) { held = false; entered.resolve(); await release.promise; } });
  const globals = f.state().globals as Value, settings = f.state().settings as Value;
  const preference = createPreferenceWrites(settings, globals, f.persistWhole, () => {}, () => {}, f.mutations);
  const created = store.createPrepared('prep', op('one'));
  await entered.promise;
  const changed = preference('setting', 'theme', 'dark');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.theme, 'light');
  release.resolve();
  await Promise.all([created, changed]);
  const disk = await f.disk();
  assert.equal((disk.settings as Value).theme, 'dark');
  assert.deepEqual(disk.globals, { keep: 'global' });
  assert.deepEqual(disk.future, { keep: true });
  assert.equal(((disk.sideChats as Value).prepared as Value).prep, 'one');
});

test('a failed side-chat transaction cannot leak into a concurrent preference commit', async t => {
  const f = await fileState(); t.after(f.dispose);
  const store = f.store();
  await store.createPrepared('prep', op('one'));
  const entered = deferred(), release = deferred();
  let held = true;
  f.beforeWrite(async () => { if (held) { held = false; entered.resolve(); await release.promise; } });
  f.fault('before-rename');
  const failed = assert.rejects(store.update('one', current => ({ ...current,
    fork: { status: 'inflight', attemptId: 'not-committed' } })), /before rename/);
  await entered.promise;
  const globals = f.state().globals as Value, settings = f.state().settings as Value;
  const preference = createPreferenceWrites(settings, globals, f.persistWhole, () => {}, () => {}, f.mutations);
  const changed = preference('setting', 'theme', 'dark');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.theme, 'light');
  release.resolve();
  await Promise.all([failed, changed]);
  const disk = await f.disk();
  const saved = ((disk.sideChats as Value).operations as Record<string, SideChatOperation>).one;
  assert.equal(saved.fork.status, 'waiting');
  assert.equal((disk.settings as Value).theme, 'dark');
  assert.deepEqual(disk.future, { keep: true });
});

test('real endpoint and E lifecycle recover a late receipt through the file-backed store and synthetic peer', async t => {
  const f = await fileState(); t.after(f.dispose);
  const store = f.store(), original = parent(), calls: string[] = [];
  let timeoutFork = false, lateFork: ((terminal: LateRpcTerminal) => void | Promise<void>) | undefined;
  const forkReceipt = { thread: { id: 'child-a', name: null, cwd: original.cwd,
    turns: [], status: { type: 'idle' }, ephemeral: true, forkedFromId: original.threadId }, cwd: original.cwd,
  runtimeWorkspaceRoots: original.workspaceRoots, model: original.model, modelProvider: original.modelProvider,
  reasoningEffort: null, serviceTier: 'default', approvalPolicy: 'on-request', approvalsReviewer: 'user',
  sandbox: original.sandboxPolicy };
  const deps: SideChatEndpointDependencies = {
    store, ownerId: 'process-a',
    async resolveParent(hostId, threadId) {
      assert.equal(hostId, original.hostId); assert.equal(threadId, original.threadId); return clone(original);
    },
    async withParent(hostId, threadId, run) {
      assert.equal(hostId, original.hostId); assert.equal(threadId, original.threadId); return run();
    },
    async withScope(scope, _access, run) {
      assert.equal(scope.hostId, original.hostId); assert.equal(scope.parentThreadId, original.threadId);
      assert.equal(scope.connectionGeneration, original.connectionGeneration); return run();
    },
    async request(scope, method, _params, _mutating, late) {
      assert.equal(scope.connectionGeneration, original.connectionGeneration);
      calls.push(method);
      if (method === 'config/read') return { config: { developer_instructions: null } };
      if (method === 'thread/fork' && timeoutFork) { timeoutFork = false; lateFork = late; throw new Error('timeout'); }
      if (method === 'thread/fork') return forkReceipt;
      if (method === 'thread/inject_items') return {};
      if (method === 'thread/unsubscribe') return { status: 'unsubscribed' };
      throw new Error('unexpected request');
    },
    classifyFailure: () => 'unknown', prepareClose: async () => {}, cleanup: async () => {},
    ownerStopped: () => false, notify: () => {},
  };
  const host = createSideChatEndpointHost(deps);
  const scope = { hostId: original.hostId, parentThreadId: original.threadId };
  const prepared = await host.prepare({ ...scope, prepareId: 'stable-prepare' });
  assert.ok(prepared.token);
  const ready = await host.start({ ...scope, operationId: prepared.view.operationId, token: prepared.token });
  assert.equal(ready.view.fork.status, 'received');
  assert.equal(ready.view.inject.status, 'received');
  const fromFile = await f.disk();
  assert.equal(((fromFile.sideChats as Value).prepared as Value)['stable-prepare'], prepared.view.operationId);
  await f.recover();
  const restored = await f.store().readPrepared('stable-prepare');
  assert.equal(restored?.childId, 'child-a');
  assert.ok((restored as SideChatOperation & Value).endpointFence);
  assert.deepEqual(calls, ['config/read', 'thread/fork', 'thread/inject_items']);

  const pending = await host.prepare({ ...scope, prepareId: 'late-prepare' });
  assert.ok(pending.token);
  timeoutFork = true;
  const unknown = await host.start({ ...scope, operationId: pending.view.operationId, token: pending.token });
  assert.equal(unknown.view.fork.status, 'unknown');
  assert.ok(unknown.token);
  const noReplay = await host.retry({ ...scope, operationId: pending.view.operationId, token: unknown.token });
  assert.equal(noReplay.view.fork.status, 'unknown');
  assert.equal(calls.filter(method => method === 'thread/fork').length, 2);

  let failReceipt = true;
  f.beforeWrite(async next => {
    const section = next.sideChats as { operations: Record<string, SideChatOperation> } | undefined;
    if (failReceipt && section?.operations[pending.view.operationId]?.fork.status === 'received') f.fault('before-rename');
  });
  assert.ok(lateFork);
  await lateFork({ outcome: 'success', result: forkReceipt });
  let observed = await host.read({ ...scope, operationId: pending.view.operationId });
  for (let attempt = 0; attempt < 100 && !observed.view.recoveryError; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    observed = await host.read({ ...scope, operationId: pending.view.operationId });
  }
  assert.notEqual(observed.view.recoveryError, null);
  assert.equal(observed.view.fork.status, 'unknown');
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(observed.token);
    await assert.rejects(host.retryPersistence({ ...scope, operationId: pending.view.operationId, token: observed.token }));
    observed = await host.read({ ...scope, operationId: pending.view.operationId });
    assert.equal(observed.view.settledCalls?.retryPersistence, true);
    assert.equal(observed.view.fork.status, 'unknown');
  }
  failReceipt = false;
  assert.ok(observed.token);
  const recovered = await host.retryPersistence({ ...scope, operationId: pending.view.operationId, token: observed.token });
  assert.equal(recovered.view.childId, 'child-a');
  assert.equal(recovered.view.inject.status, 'received');
  assert.equal(recovered.view.recoveryError, null);
  assert.equal(calls.filter(method => method === 'thread/fork').length, 2);
  assert.equal(calls.filter(method => method === 'thread/inject_items').length, 2);
  await f.recover();
  assert.equal((await f.store().readPrepared('late-prepare'))?.childId, 'child-a');
});
