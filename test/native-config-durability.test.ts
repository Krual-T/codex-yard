import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CodexConnection } from '../lib/codex.ts';
import type { ConfigWriteReceipt } from '../lib/config-write-protocol.ts';
import { createConfigWriteHost } from '../src/native/config-write-host.ts';
import { createConfigWrites } from '../src/native/config-writes.ts';
import { createNativeState, NativeStateCommitError } from '../src/native/native-state.ts';
import type { NativeStateCheckpoint, NativeStateRoot } from '../src/native/native-state.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';

type Value = Record<string, unknown>;
const object = (value: unknown): Value => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Value;
};
function replace(target: Value, next: Value) {
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of Object.entries(next)) {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  }
}
function gate() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
function uncertain(error: unknown) { return error instanceof NativeStateCommitError && error.uncertain; }
function checkReceipt(receipt: ConfigWriteReceipt | undefined, value: Value) {
  assert.ok(receipt);
  const key = createPublicKey({ key: Buffer.from(String(value.receiptPublicKey), 'base64url'), format: 'der', type: 'spki' });
  const payload = Buffer.from(JSON.stringify(['config-write-receipt-v2-ed25519', receipt.operationId, receipt.hostId, receipt.method, receipt.terminal]));
  assert.equal(verify(null, payload, key, Buffer.from(receipt.signature, 'base64url')), true);
}

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-config-durability-');
  const path = join(root, 'native-state.json');
  const initial = { globals: { locale: 'en' }, settings: { theme: 'light' },
    sideChats: { operations: [{ operationId: 'side-original', fork: { status: 'unknown' } }], prepared: { 'prepare-original': 'side-original' } },
    future: { nested: ['preserved', { value: true }] } };
  await writeFile(path, JSON.stringify(initial), { mode: 0o600 });
  const state: Value = {};
  let checkpoint: ((step: NativeStateCheckpoint) => void | Promise<void>) | undefined;
  const owner = createNativeState({ dataDir: root, publish: next => replace(state, next), checkpoint: step => checkpoint?.(step) });
  replace(state, await owner.load());
  const mutations = createStateMutations(owner.beforeAction);
  const peer = await createFakeCodex(root);
  peer.handlers.set('config/read', () => ({ layers: [] }));
  const connection = new CodexConnection(peer.socketPath, { timeout: 200 });
  await connection.connect();
  let resolutions = 0;
  let resolveHook: (() => Promise<void>) | undefined;
  const writes = createConfigWrites({ state, mutations, persist: () => owner.persist(state), assertStateAvailable: owner.assertAvailable,
    async resolveTarget({ connection: original }) {
      resolutions++;
      await resolveHook?.();
      await original.requestWithCursor('config/read', { includeLayers: true });
      return { hostKey: 'fixture-host', target: '/fixture/config.toml', binding: '/fixture/config.toml', scope: 'global' };
    },
    findFileBlocker: () => false,
  });
  t.after(async () => { connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  const disk = async () => JSON.parse(await readFile(path, 'utf8')) as NativeStateRoot;
  async function failOtherSection() {
    await assert.rejects(mutations.run(async () => {
      const previous = state.settings;
      state.settings = { theme: 'dark' };
      try { await owner.persist(state); }
      catch (error) { state.settings = previous; throw error; }
    }), uncertain);
  }
  return { initial, state, owner, mutations, peer, connection, writes, disk, failOtherSection,
    checkpoint(value?: typeof checkpoint) { checkpoint = value; }, onResolve(value?: typeof resolveHook) { resolveHook = value; },
    resolutions: () => resolutions };
}

const identity = (operationId: string) => ({ operationId, hostId: 'fixture-local', method: 'config/batchWrite' as const });
const params = () => ({ edits: [], filePath: null, expectedVersion: 'fixture', reloadUserConfig: true });
function configRecord(root: NativeStateRoot, operationId: string): Value {
  assert.ok(Array.isArray(root.configWriteOperations));
  const value: unknown = root.configWriteOperations.find(item => object(item).operationId === operationId);
  return object(value);
}
function assertOtherSections(root: NativeStateRoot, initial: NativeStateRoot) {
  assert.deepEqual(root.globals, initial.globals);
  assert.deepEqual(root.sideChats, initial.sideChats);
  assert.deepEqual(root.future, initial.future);
}

test('uncertain first preparation returns its direct not-sent receipt while state stays isolated', async t => {
  const f = await fixture(t);
  let lose = true, recovering = true;
  f.checkpoint(step => {
    if (step === 'rename' && lose) { lose = false; throw new Error('lost rename confirmation'); }
    if (step === 'recovery-file-sync' && recovering) throw new Error('recovery unavailable');
  });
  const failed = await f.writes.begin(identity('first-uncertain'));
  assert.equal(failed.outcome, 'not-started');
  assert.equal(failed.operation.storageError, true);
  assert.deepEqual(failed.operation.observedTerminal, { kind: 'not-sent' });
  checkReceipt(failed.operation.recoveryReceipt, configRecord(await f.disk(), 'first-uncertain'));
  assert.equal(f.state.configWriteOperations, undefined);
  assert.throws(f.owner.assertAvailable, uncertain);
  assert.throws(() => f.writes.activeForFile(), uncertain);
  await assert.rejects(f.writes.status('first-uncertain'), uncertain);
  await assert.rejects(f.writes.begin(identity('second')), uncertain);
  let ran = false;
  await assert.rejects(f.mutations.run(() => { ran = true; }), uncertain);
  assert.equal(ran, false);
  assert.equal(f.peer.calls('config/read').length, 0);
  assert.equal(f.peer.calls('config/batchWrite').length, 0);
  recovering = false;
  const status = await f.writes.status('first-uncertain');
  assert.equal(status?.state, 'preparing');
  assert.equal(status?.storageError, true);
  assert.deepEqual(status?.observedTerminal, { kind: 'not-sent' });
  assert.equal((await f.writes.begin(identity('second'))).outcome, 'blocked');
  assert.deepEqual((await f.writes.retryTerminalSave('first-uncertain')).terminal, { kind: 'not-sent' });
  const saved = await f.disk();
  assert.deepEqual(configRecord(saved, 'first-uncertain').terminal, { kind: 'not-sent' });
  assertOtherSections(saved, f.initial);
});

test('pre-rename preparation failure retains its unsent identity without publishing a fabricated record', async t => {
  const f = await fixture(t);
  let fail = true;
  f.checkpoint(step => { if (step === 'file-sync' && fail) { fail = false; throw new Error('file sync failed'); } });
  const failed = await f.writes.begin(identity('first-before-rename'));
  assert.equal(failed.outcome, 'not-started');
  assert.deepEqual(failed.operation.observedTerminal, { kind: 'not-sent' });
  assert.ok(failed.operation.recoveryReceipt);
  assert.equal(f.state.configWriteOperations, undefined);
  assert.equal((await f.disk()).configWriteOperations, undefined);
  assert.equal((await f.writes.status('first-before-rename'))?.storageError, true);
  assert.equal((await f.writes.begin(identity('other'))).outcome, 'blocked');
  const finished = await f.writes.retryTerminalSave('first-before-rename');
  assert.deepEqual(finished.terminal, { kind: 'not-sent' });
  const saved = await f.disk();
  checkReceipt(failed.operation.recoveryReceipt, configRecord(saved, 'first-before-rename'));
  assertOtherSections(saved, f.initial);
  assert.equal(f.peer.calls('config/batchWrite').length, 0);
});

test('the host returns the original not-sent receipt after uncertain first preparation without connecting', async t => {
  const f = await fixture(t);
  let connects = 0, lose = true, recovering = true;
  const host = createConfigWriteHost({ writes: f.writes, validateHost() {}, async connect() {
    connects++; return { connection: f.connection, socket: f.connection.socket };
  } });
  f.checkpoint(step => {
    if (step === 'rename' && lose) { lose = false; throw new Error('first preparation confirmation lost'); }
    if (step === 'recovery-file-sync' && recovering) throw new Error('recovery unavailable');
  });
  const result = await host.handle({ ...identity('host-first'), action: 'submit', params: params(), source: {
    hostId: 'fixture-local', generation: 'socket-one', homeDirectory: '/fixture', codexHome: '/fixture/codex',
  } }, {});
  assert.ok('outcome' in result);
  assert.equal(result.outcome, 'not-started');
  if (result.outcome !== 'not-started') return;
  assert.equal(result.error.uncertain, false);
  assert.equal(result.operation?.storageError, true);
  assert.deepEqual(result.operation?.observedTerminal, { kind: 'not-sent' });
  checkReceipt(result.operation?.recoveryReceipt, configRecord(await f.disk(), 'host-first'));
  assert.equal(connects, 0);
  await assert.rejects(host.handle({ hostId: 'fixture-local', action: 'status', operationId: 'host-first' }, {}), /Cannot read/);
  recovering = false;
  const saved = await host.handle({ hostId: 'fixture-local', action: 'retry-persistence', operationId: 'host-first',
    receipt: result.operation?.recoveryReceipt }, {});
  assert.ok(!('outcome' in saved));
  assert.deepEqual(saved.operation?.terminal, { kind: 'not-sent' });
  assert.equal(connects, 0);
  assert.equal(f.peer.calls('config/batchWrite').length, 0);
  assertOtherSections(await f.disk(), f.initial);
});

test('an uncertain pending reservation never sends and preserves the original not-sent receipt through failed recovery', async t => {
  const f = await fixture(t);
  const prepared = await f.writes.begin(identity('pending-uncertain'));
  assert.equal(prepared.outcome, 'prepared');
  if (prepared.outcome !== 'prepared') return;
  let lose = true, recovering = true;
  f.checkpoint(step => {
    if (step === 'rename' && lose) { lose = false; throw new Error('lost rename confirmation'); }
    if (step === 'recovery-directory-sync' && recovering) throw new Error('recovery unavailable');
  });
  const stopped = await prepared.start(params(), f.connection);
  assert.equal(stopped.outcome, 'not-started');
  assert.equal(stopped.operation.state, 'unknown');
  assert.deepEqual(stopped.operation.observedTerminal, { kind: 'not-sent' });
  assert.equal(stopped.operation.storageError, true);
  checkReceipt(stopped.operation.recoveryReceipt, configRecord(await f.disk(), 'pending-uncertain'));
  assert.equal(configRecord(await f.disk(), 'pending-uncertain').state, 'pending');
  await assert.rejects(f.writes.status('pending-uncertain'), uncertain);
  assert.equal(f.peer.calls('config/read').length, 1);
  assert.equal(f.peer.calls('config/batchWrite').length, 0);
  recovering = false;
  const status = await f.writes.status('pending-uncertain');
  assert.equal(status?.state, 'unknown');
  assert.deepEqual(status?.observedTerminal, { kind: 'not-sent' });
  assert.deepEqual((await f.writes.retryTerminalSave('pending-uncertain')).terminal, { kind: 'not-sent' });
  const saved = await f.disk();
  assertOtherSections(saved, f.initial);
  assert.equal(configRecord(saved, 'pending-uncertain').state, 'failed');
  assert.equal(f.peer.calls('config/batchWrite').length, 0);
});

test('a direct success survives terminal rename uncertainty and retry accepts the already saved matching terminal', async t => {
  const f = await fixture(t);
  let reply!: () => void;
  f.peer.handlers.set('config/batchWrite', (_params, call) => {
    reply = () => call.send({ id: call.message.id, result: { status: 'okOverridden', version: 'fixture-version' } });
    return NO_REPLY;
  });
  const prepared = await f.writes.begin(identity('direct-success'));
  assert.equal(prepared.outcome, 'prepared'); if (prepared.outcome !== 'prepared') return;
  const started = await prepared.start(params(), f.connection);
  assert.equal(started.outcome, 'started'); if (started.outcome !== 'started') return;
  await f.peer.waitForCall('config/batchWrite');
  let lose = true, recovering = true, writes = 0;
  f.checkpoint(step => {
    if (step === 'file-sync') writes++;
    if (step === 'rename' && lose) { lose = false; throw new Error('lost rename confirmation'); }
    if (step === 'recovery-file-sync' && recovering) throw new Error('recovery unavailable');
  });
  reply();
  const complete = await started.completion;
  assert.equal(complete.outcome, 'success');
  if (complete.outcome !== 'success') return;
  assert.deepEqual(complete.response.result, { status: 'okOverridden', version: 'fixture-version' });
  assert.equal(complete.operation.state, 'unknown');
  assert.deepEqual(complete.operation.observedTerminal, { kind: 'okOverridden' });
  assert.equal(complete.operation.storageError, true);
  checkReceipt(complete.operation.recoveryReceipt, configRecord(await f.disk(), 'direct-success'));
  await assert.rejects(f.writes.status('direct-success'), uncertain);
  recovering = false;
  const status = await f.writes.status('direct-success');
  assert.equal(status?.state, 'succeeded');
  assert.equal(status?.storageError, true);
  const before = writes;
  const recovered = await f.writes.retryTerminalSave('direct-success');
  assert.deepEqual(recovered.terminal, { kind: 'okOverridden' });
  assert.equal(recovered.storageError, undefined);
  assert.equal(writes, before);
  assert.equal(f.peer.calls('config/batchWrite').length, 1);
  assertOtherSections(await f.disk(), f.initial);
});

test('a real original socket late terminal is retained when the reconciliation barrier fails', async t => {
  const f = await fixture(t);
  let reply!: () => void;
  f.peer.handlers.set('config/batchWrite', (_params, call) => {
    reply = () => call.send({ id: call.message.id, result: { status: 'ok' } }); return NO_REPLY;
  });
  const prepared = await f.writes.begin(identity('late-original'));
  assert.equal(prepared.outcome, 'prepared'); if (prepared.outcome !== 'prepared') return;
  const started = await prepared.start(params(), f.connection);
  assert.equal(started.outcome, 'started'); if (started.outcome !== 'started') return;
  assert.equal((await started.completion).outcome, 'unknown');
  assert.equal((await f.writes.status('late-original'))?.state, 'unknown');
  let lose = true, recoveries = 0, recovering = true;
  f.checkpoint(step => {
    if (step === 'rename' && lose) { lose = false; throw new Error('lost other section confirmation'); }
    if (step === 'recovery-file-sync' && recovering) { recoveries++; throw new Error('recovery unavailable'); }
  });
  await f.failOtherSection();
  reply();
  const deadline = Date.now() + 3000;
  while (!recoveries && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(recoveries > 0);
  await assert.rejects(f.writes.status('late-original'), uncertain);
  assert.throws(() => f.writes.activeForFile(), uncertain);
  recovering = false;
  const observed = await f.writes.status('late-original');
  assert.equal(observed?.state, 'unknown');
  assert.equal(observed?.storageError, true);
  assert.deepEqual(observed?.observedTerminal, { kind: 'ok' });
  checkReceipt(observed?.recoveryReceipt, configRecord(await f.disk(), 'late-original'));
  assert.equal((await f.writes.begin(identity('blocked'))).outcome, 'blocked');
  const finished = await f.writes.retryTerminalSave('late-original');
  assert.deepEqual(finished.terminal, { kind: 'ok' });
  const saved = await f.disk();
  assert.deepEqual(saved.settings, { theme: 'dark' });
  assertOtherSections(saved, f.initial);
  assert.equal(f.peer.calls('config/batchWrite').length, 1);
});

test('the configuration host returns the direct original success and signed receipt while another section is quarantined', async t => {
  const f = await fixture(t);
  let reply!: () => void;
  f.peer.handlers.set('config/batchWrite', (_params, call) => {
    reply = () => call.send({ id: call.message.id, result: { status: 'ok', version: 'direct-version' } });
    return NO_REPLY;
  });
  const host = createConfigWriteHost({ writes: f.writes, validateHost() {},
    async connect() { return { connection: f.connection, socket: f.connection.socket }; } });
  const request = { ...identity('host-direct'), action: 'submit' as const, params: params(), source: {
    hostId: 'fixture-local', generation: 'socket-one', homeDirectory: '/fixture', codexHome: '/fixture/codex',
  } };
  const pending = host.handle(request, {});
  await f.peer.waitForCall('config/batchWrite');
  let lose = true, recovering = true;
  f.checkpoint(step => {
    if (step === 'rename' && lose) { lose = false; throw new Error('other section confirmation lost'); }
    if (step === 'recovery-file-sync' && recovering) throw new Error('recovery unavailable');
  });
  await f.failOtherSection();
  reply();
  const result = await pending;
  assert.ok('outcome' in result);
  assert.equal(result.outcome, 'success');
  if (result.outcome !== 'success') return;
  assert.deepEqual(result.result, { status: 'ok', version: 'direct-version' });
  assert.equal(result.operation.storageError, true);
  assert.deepEqual(result.operation.observedTerminal, { kind: 'ok' });
  checkReceipt(result.operation.recoveryReceipt, configRecord(await f.disk(), 'host-direct'));
  await assert.rejects(host.handle({ hostId: 'fixture-local', action: 'status', operationId: 'host-direct' }, {}), /Cannot read/);
  recovering = false;
  const restored = await host.handle({ hostId: 'fixture-local', action: 'retry-persistence', operationId: 'host-direct',
    receipt: result.operation.recoveryReceipt }, {});
  assert.ok(!('outcome' in restored));
  assert.deepEqual(restored.operation?.terminal, { kind: 'ok' });
  assert.equal(restored.operation?.storageError, undefined);
  const saved = await f.disk();
  assert.deepEqual(saved.settings, { theme: 'dark' });
  assertOtherSections(saved, f.initial);
  assert.equal(f.peer.calls('config/batchWrite').length, 1);
});

test('a changed original key cannot receive or unlock a retained terminal, and restoring the original key keeps the evidence', async t => {
  const f = await fixture(t);
  let reply!: () => void;
  f.peer.handlers.set('config/batchWrite', (_params, call) => {
    reply = () => call.send({ id: call.message.id, result: { status: 'ok' } }); return NO_REPLY;
  });
  const prepared = await f.writes.begin(identity('changed-key'));
  assert.equal(prepared.outcome, 'prepared'); if (prepared.outcome !== 'prepared') return;
  const started = await prepared.start(params(), f.connection);
  assert.equal(started.outcome, 'started'); if (started.outcome !== 'started') return;
  await f.peer.waitForCall('config/batchWrite');
  const originalKey = configRecord(await f.disk(), 'changed-key').receiptPublicKey;
  const foreignKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const changeKey = (key: unknown) => f.mutations.run(async () => {
    const value = configRecord(f.state, 'changed-key');
    value.receiptPublicKey = key;
    await f.owner.persist(f.state);
  });
  await changeKey(foreignKey);
  reply();
  const complete = await started.completion;
  assert.equal(complete.outcome, 'success');
  assert.equal(complete.operation.storageError, true);
  assert.equal(complete.operation.observedTerminal, undefined);
  assert.equal(complete.operation.recoveryReceipt, undefined);
  await assert.rejects(f.writes.retryTerminalSave('changed-key'), /no longer matches/);
  assert.equal((await f.writes.status('changed-key'))?.state, 'unknown');
  await changeKey(originalKey);
  const observed = await f.writes.status('changed-key');
  assert.deepEqual(observed?.observedTerminal, { kind: 'ok' });
  checkReceipt(observed?.recoveryReceipt, configRecord(await f.disk(), 'changed-key'));
  assert.deepEqual((await f.writes.retryTerminalSave('changed-key')).terminal, { kind: 'ok' });
  assert.equal(f.peer.calls('config/batchWrite').length, 1);
});

test('target resolution holds the shared state interval so quarantine cannot begin before its config read', async t => {
  const f = await fixture(t);
  const prepared = await f.writes.begin(identity('resolving'));
  assert.equal(prepared.outcome, 'prepared'); if (prepared.outcome !== 'prepared') return;
  const entered = gate(), release = gate();
  f.onResolve(async () => { entered.release(); await release.promise; });
  let lose = true, recovering = true;
  f.checkpoint(step => {
    if (step === 'rename' && lose) { lose = false; throw new Error('other section confirmation lost'); }
    if (step === 'recovery-file-sync' && recovering) throw new Error('recovery unavailable');
  });
  const starting = prepared.start(params(), f.connection);
  await entered.promise;
  let otherStarted = false;
  const other = f.mutations.run(async () => {
    otherStarted = true;
    const previous = f.state.settings;
    f.state.settings = { theme: 'dark' };
    try { await f.owner.persist(f.state); }
    catch (error) { f.state.settings = previous; throw error; }
  });
  const rejected = assert.rejects(other, uncertain);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(otherStarted, false);
  assert.equal(f.peer.calls('config/read').length, 0);
  release.release();
  await rejected;
  const result = await starting;
  assert.equal(result.outcome, 'not-started');
  assert.deepEqual(result.operation.observedTerminal, { kind: 'not-sent' });
  assert.equal(f.peer.calls('config/read').length, 1);
  assert.equal(f.peer.calls('config/batchWrite').length, 0);
  recovering = false;
  assert.deepEqual((await f.writes.retryTerminalSave('resolving')).terminal, { kind: 'not-sent' });
  assertOtherSections(await f.disk(), f.initial);
});

test('state isolation prevents target resolution and dispatch after an earlier writer fails before its rollback', async t => {
  const f = await fixture(t);
  const prepared = await f.writes.begin(identity('queued-start'));
  assert.equal(prepared.outcome, 'prepared'); if (prepared.outcome !== 'prepared') return;
  const entered = gate(), release = gate();
  let lose = true, recovering = true;
  f.checkpoint(async step => {
    if (step === 'rename' && lose) { lose = false; entered.release(); await release.promise; throw new Error('lost confirmation'); }
    if (step === 'recovery-file-sync' && recovering) throw new Error('recovery unavailable');
  });
  const other = f.failOtherSection();
  await entered.promise;
  const starting = prepared.start(params(), f.connection);
  assert.equal(f.resolutions(), 0);
  release.release(); await other;
  const result = await starting;
  assert.equal(result.outcome, 'not-started');
  assert.deepEqual(result.operation.observedTerminal, { kind: 'not-sent' });
  assert.equal(result.operation.storageError, true);
  assert.equal(f.resolutions(), 0);
  assert.equal(f.peer.calls('config/read').length, 0);
  assert.equal(f.peer.calls('config/batchWrite').length, 0);
  recovering = false;
  assert.deepEqual((await f.writes.retryTerminalSave('queued-start')).terminal, { kind: 'not-sent' });
  const saved = await f.disk();
  assert.deepEqual(saved.settings, { theme: 'dark' });
  assertOtherSections(saved, f.initial);
});

test('a definite file-save failure cannot classify an already sent unknown RPC as not-sent', async t => {
  const f = await fixture(t);
  f.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const prepared = await f.writes.begin(identity('unknown-before-rename'));
  assert.equal(prepared.outcome, 'prepared'); if (prepared.outcome !== 'prepared') return;
  const started = await prepared.start(params(), f.connection);
  assert.equal(started.outcome, 'started'); if (started.outcome !== 'started') return;
  let fail = true;
  f.checkpoint(step => { if (step === 'file-sync' && fail) { fail = false; throw new Error('file sync failed'); } });
  const completion = await started.completion;
  assert.equal(completion.outcome, 'unknown');
  assert.ok(completion.persistenceError instanceof NativeStateCommitError);
  assert.equal(completion.persistenceError.uncertain, false);
  assert.equal(completion.operation.storageError, true);
  assert.equal(completion.operation.observedTerminal, undefined);
  assert.equal(completion.operation.recoveryReceipt, undefined);
  assert.equal((await f.writes.retryTerminalSave('unknown-before-rename')).state, 'unknown');
  assert.equal((await f.writes.begin(identity('blocked'))).outcome, 'blocked');
  assert.equal(f.peer.calls('config/batchWrite').length, 1);
});

test('a malformed transport return after invocation is unknown rather than falsely not-sent', async t => {
  const f = await fixture(t);
  let calls = 0;
  const connection = { connected: true, socket: {}, requestWithCursor: () => { calls++; return undefined as never; } };
  const writes = createConfigWrites({ state: f.state, mutations: f.mutations, persist: () => f.owner.persist(f.state),
    assertStateAvailable: f.owner.assertAvailable, findFileBlocker: () => false,
    resolveTarget: async () => ({ hostKey: 'fixture-host', target: '/fixture/config.toml', binding: '/fixture/config.toml' }),
  });
  const prepared = await writes.begin(identity('malformed-return'));
  assert.equal(prepared.outcome, 'prepared'); if (prepared.outcome !== 'prepared') return;
  const started = await prepared.start(params(), connection);
  assert.equal(started.outcome, 'started'); if (started.outcome !== 'started') return;
  const result = await started.completion;
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.operation.state, 'unknown');
  assert.equal(result.operation.terminal, undefined);
  assert.equal(calls, 1);
  const another = await writes.begin(identity('another'));
  assert.equal(another.outcome, 'prepared'); if (another.outcome !== 'prepared') return;
  assert.equal((await another.start(params(), connection)).outcome, 'blocked');
  assert.equal(calls, 1);
});
