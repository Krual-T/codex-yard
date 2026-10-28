import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CodexConnection, RpcError } from '../lib/codex.ts';
import { createConfigWrites } from '../src/native/config-writes.ts';
import type { ConfigWriteConnection, ConfigWriteMethod, ConfigWriteStatus } from '../src/native/config-writes.ts';
import { createPreferenceWrites } from '../src/native/preference-writes.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { userConfigTarget } from '../src/renderer/settings/config-target.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-config-fence-');
  const home = join(root, 'codex'), config = join(home, 'config.toml'), other = join(home, 'other.toml');
  const alias = join(home, 'config-alias.toml'), statePath = join(root, 'native-state.json');
  await mkdir(home);
  await writeFile(config, 'model = "fixture"\n');
  await writeFile(other, 'model = "other"\n');
  await symlink(config, alias);
  const peer = await createFakeCodex(root), connections: CodexConnection[] = [];
  peer.handlers.set('config/read', () => ({ config: {}, layers: [
    { name: { type: 'user', file: config, profile: null }, version: 'fixture-v1' },
  ] }));
  const state: Record<string, unknown> = { settings: {}, globals: {} };
  const mutations = createStateMutations();
  let failures = 0;
  const persist = async () => {
    if (failures > 0) { failures--; throw new Error('fixture persistence failed'); }
    const temporary = statePath + '.tmp';
    await writeFile(temporary, JSON.stringify(state));
    await rename(temporary, statePath);
  };
  const resolveTarget = async ({ hostId, method, params, connection }: {
    hostId: string; method: ConfigWriteMethod; params: Record<string, unknown>; connection: ConfigWriteConnection;
  }) => {
    const hostKey = hostId === 'remote' ? 'fixture-machine-b' : 'fixture-machine-a';
    if (method !== 'config/batchWrite') {
      // Only this disposable fixture supplies a verified target for these methods.
      return { hostKey, target: await realpath(config), binding: config };
    }
    if (params.filePath === null) {
      const read = await connection.requestWithCursor('config/read', { includeLayers: true });
      const layers = (read.result as { layers: unknown }).layers;
      const selected = userConfigTarget(layers, home);
      if (!selected.target) throw new Error('Fixture base user layer is unavailable');
      return { hostKey, target: await realpath(selected.target.file), binding: selected.target.file };
    }
    if (typeof params.filePath !== 'string') throw new Error('Fixture target is unavailable');
    return { hostKey, target: await realpath(params.filePath), binding: params.filePath };
  };
  const options = { state, persist, mutations, resolveTarget, findFileBlocker: () => false };
  const writes = createConfigWrites(options);
  async function connect() {
    const connection = new CodexConnection(peer.socketPath, { timeout: 120 });
    connections.push(connection); await connection.connect(); return connection;
  }
  t.after(async () => {
    for (const connection of connections) connection.close();
    await peer.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, home, config, other, alias, statePath, state, mutations, persist, resolveTarget, options, writes, peer, connect,
    failNextPersist() { failures++; } };
}

const params = () => ({ edits: [{ keyPath: 'hooks.state.fixture.enabled', value: false, mergeStrategy: 'upsert' }],
  filePath: null, expectedVersion: 'fixture-v1', reloadUserConfig: true });

async function waitForStatus(writes: ReturnType<typeof createConfigWrites>, operationId: string,
  predicate: (value: ConfigWriteStatus) => boolean): Promise<ConfigWriteStatus> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const value = await writes.status(operationId);
    if (value && predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the original configuration write status');
}

test('two pages cannot retry the original unknown write; only its late terminal releases the shared target', async t => {
  const h = await fixture(t), firstPage = await h.connect(), secondPage = await h.connect();
  const replies: ((result: unknown) => void)[] = [];
  h.peer.handlers.set('config/batchWrite', (_value, context) => {
    replies.push(result => context.send({ id: context.message.id, result }));
    return NO_REPLY;
  });
  const original = params();
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: original, connection: firstPage });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  await h.peer.waitForCall('config/batchWrite');
  assert.deepEqual(h.peer.calls('config/batchWrite')[0]!.params, original);
  assert.equal((await h.writes.status(first.operation.operationId))?.state, 'pending');
  const blocked = await h.writes.submit({ operationId: randomUUID(), hostId: 'alias', method: 'skills/config/write',
    params: { name: 'fixture:skill', enabled: false }, connection: secondPage });
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.operation.operationId, first.operation.operationId);
  assert.equal(blocked.operation.hostId, 'local');
  assert.equal(blocked.operation.target, await realpath(h.config));
  assert.equal(h.peer.calls('skills/config/write').length, 0);
  const completion = await first.completion;
  assert.equal(completion.outcome, 'unknown');
  assert.equal((await h.writes.status(first.operation.operationId))?.state, 'unknown');
  await secondPage.request('config/read', { includeLayers: true });
  assert.equal((await h.writes.status(first.operation.operationId))?.state, 'unknown');
  assert.equal((await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection: secondPage })).outcome, 'blocked');
  replies[0]!({ status: 'okOverridden', version: 'fixture-v2' });
  const terminal = await waitForStatus(h.writes, first.operation.operationId, value => value.state === 'succeeded');
  assert.deepEqual(terminal.terminal, { kind: 'okOverridden' });
  h.peer.handlers.set('config/batchWrite', () => ({ status: 'ok', version: 'fixture-v3' }));
  const next = await h.writes.submit({ operationId: randomUUID(), hostId: 'alias', method: 'config/batchWrite', params: params(), connection: secondPage });
  assert.equal(next.outcome, 'started'); if (next.outcome !== 'started') return;
  const nextResult = await next.completion;
  assert.equal(nextResult.outcome, 'success');
  if (nextResult.outcome === 'success') assert.deepEqual(nextResult.response, { result: { status: 'ok', version: 'fixture-v3' }, eventCursor: 0 });
  assert.equal(h.peer.calls('config/batchWrite').length, 2);
});

test('verified aliases conflict while independent targets and verified hosts can write concurrently', async t => {
  const h = await fixture(t), connection = await h.connect();
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  const alias = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite',
    params: { ...params(), filePath: h.alias }, connection });
  assert.equal(alias.outcome, 'blocked');
  assert.equal(alias.operation.operationId, first.operation.operationId);
  const other = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite',
    params: { ...params(), filePath: h.other }, connection });
  const remote = await h.writes.submit({ operationId: randomUUID(), hostId: 'remote', method: 'config/batchWrite', params: params(), connection });
  assert.equal(other.outcome, 'started'); assert.equal(remote.outcome, 'started');
  if (other.outcome !== 'started' || remote.outcome !== 'started') return;
  await h.peer.waitForCall('config/batchWrite', 3);
  assert.deepEqual(h.peer.calls('config/batchWrite').map(call => call.params.filePath), [null, h.other, null]);
  assert.equal((await h.writes.status(other.operation.operationId))?.target, await realpath(h.other));
  assert.equal((await h.writes.status(remote.operation.operationId))?.hostKey, 'fixture-machine-b');
  await Promise.all([first.completion, other.completion, remote.completion]);
});

test('a late original rejection settles its operation and preserves the RPC error on immediate rejection', async t => {
  const h = await fixture(t), connection = await h.connect();
  let rejectLate: (() => void) | undefined;
  h.peer.handlers.set('config/batchWrite', (_value, context) => {
    rejectLate = () => context.send({ id: context.message.id, error: { code: -32042, message: 'late fixture rejection' } });
    return NO_REPLY;
  });
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  assert.equal((await first.completion).outcome, 'unknown');
  assert.ok(rejectLate); rejectLate();
  const late = await waitForStatus(h.writes, first.operation.operationId, value => value.state === 'failed');
  assert.deepEqual(late.terminal, { kind: 'rejected', code: -32042 });
  h.peer.handlers.set('config/batchWrite', () => { throw Object.assign(new Error('version conflict'), { code: -32009, data: { kind: 'versionConflict' } }); });
  const second = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(second.outcome, 'started'); if (second.outcome !== 'started') return;
  const result = await second.completion;
  assert.equal(result.outcome, 'error');
  if (result.outcome !== 'error') return;
  assert.ok(result.error instanceof RpcError);
  assert.equal(result.error.code, -32009);
  assert.deepEqual(result.error.data, { kind: 'versionConflict' });
  assert.equal(result.operation.state, 'failed');
  assert.deepEqual(result.operation.terminal, { kind: 'rejected', code: -32009 });
});

test('failure to persist the preparation never sends and keeps an in-process fence until saved', async t => {
  const h = await fixture(t), connection = await h.connect();
  h.failNextPersist();
  const failed = await h.writes.submit({ operationId: 'preparation-save-failed', hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(failed.outcome, 'not-started');
  assert.equal(failed.operation.storageError, true);
  assert.deepEqual(failed.operation.observedTerminal, { kind: 'not-sent' });
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
  await assert.rejects(readFile(h.statePath), { code: 'ENOENT' });
  assert.equal((await h.writes.submit({ operationId: 'another', hostId: 'local', method: 'config/batchWrite', params: params(), connection })).outcome, 'blocked');
  assert.deepEqual((await h.writes.retryTerminalSave('preparation-save-failed')).terminal, { kind: 'not-sent' });
  h.peer.handlers.set('config/batchWrite', () => ({ status: 'ok' }));
  const next = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(next.outcome, 'started'); if (next.outcome === 'started') assert.equal((await next.completion).outcome, 'success');
});

test('a terminal persistence failure reports the real response and keeps the target fenced until the original terminal is saved', async t => {
  const h = await fixture(t), connection = await h.connect();
  let finish: (() => void) | undefined;
  h.peer.handlers.set('config/batchWrite', (_value, context) => {
    finish = () => context.send({ id: context.message.id, result: { status: 'okOverridden', version: 'fixture-v2' } });
    return NO_REPLY;
  });
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  await h.peer.waitForCall('config/batchWrite');
  h.failNextPersist(); assert.ok(finish); finish();
  const result = await first.completion;
  assert.equal(result.outcome, 'success');
  if (result.outcome !== 'success') return;
  assert.deepEqual(result.response.result, { status: 'okOverridden', version: 'fixture-v2' });
  assert.ok(result.persistenceError);
  assert.equal(result.operation.state, 'unknown');
  assert.deepEqual(result.operation.observedTerminal, { kind: 'okOverridden' });
  const durable = JSON.parse(await readFile(h.statePath, 'utf8')) as { configWriteOperations: { state: string }[] };
  assert.equal(durable.configWriteOperations[0]!.state, 'pending');
  assert.equal((await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection })).outcome, 'blocked');
  const saved = await h.writes.retryTerminalSave(first.operation.operationId);
  assert.equal(saved.state, 'succeeded');
  assert.deepEqual(saved.terminal, { kind: 'okOverridden' });
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
  assert.equal((await h.writes.status(first.operation.operationId))?.storageError, undefined);
});

test('a failed late terminal save stays fenced and may only retry the observed terminal locally', async t => {
  const h = await fixture(t), connection = await h.connect();
  let finish: (() => void) | undefined;
  h.peer.handlers.set('config/batchWrite', (_value, context) => {
    finish = () => context.send({ id: context.message.id, error: { code: -32013, message: 'late conflict' } });
    return NO_REPLY;
  });
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  assert.equal((await first.completion).outcome, 'unknown');
  h.failNextPersist(); assert.ok(finish); finish();
  const failed = await waitForStatus(h.writes, first.operation.operationId, value => value.storageError === true);
  assert.equal(failed.state, 'unknown'); assert.deepEqual(failed.observedTerminal, { kind: 'rejected', code: -32013 });
  assert.equal((await h.writes.submit({ operationId: randomUUID(), hostId: 'alias', method: 'config/batchWrite', params: params(), connection })).outcome, 'blocked');
  assert.equal((await h.writes.retryTerminalSave(first.operation.operationId)).state, 'failed');
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('disconnect and restart retain unknown even when a new connection reuses the RPC id', async t => {
  const h = await fixture(t), old = await h.connect();
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection: old });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  const request = await h.peer.waitForCall('config/batchWrite');
  assert.ok(request);
  h.peer.disconnect(); await once(old, 'status');
  assert.equal((await first.completion).outcome, 'unknown');
  const restored = JSON.parse(await readFile(h.statePath, 'utf8')) as Record<string, unknown>;
  const restarted = createConfigWrites({ ...h.options, state: restored, mutations: createStateMutations() });
  assert.equal((await restarted.status(first.operation.operationId))?.state, 'unknown');
  await assert.rejects(restarted.retryTerminalSave(first.operation.operationId), /original observation is unavailable/i);
  const fresh = await h.connect();
  fresh.receive(Buffer.from(JSON.stringify({ id: request.id, result: { status: 'ok' } })));
  assert.equal((await restarted.status(first.operation.operationId))?.state, 'unknown');
  const blocked = await restarted.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection: fresh });
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.operation.operationId, first.operation.operationId);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('pending after restart is unknown, malformed records fail closed, and config writes share the native-state transaction', async t => {
  const h = await fixture(t), connection = await h.connect();
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  const saved = JSON.parse(await readFile(h.statePath, 'utf8')) as Record<string, unknown>;
  const restarted = createConfigWrites({ ...h.options, state: saved, mutations: createStateMutations() });
  assert.equal((await restarted.status(first.operation.operationId))?.state, 'unknown');
  assert.equal((await restarted.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection })).outcome, 'blocked');
  const preferences = createPreferenceWrites(h.state.settings as Record<string, unknown>, h.state.globals as Record<string, unknown>,
    h.persist, () => {}, () => {}, h.mutations);
  await preferences('setting', 'fixture-theme', 'dark');
  const persisted = JSON.parse(await readFile(h.statePath, 'utf8')) as { settings: Record<string, unknown>; configWriteOperations: unknown[] };
  assert.equal(persisted.settings['fixture-theme'], 'dark');
  assert.equal(persisted.configWriteOperations.length, 1);
  await first.completion;
  h.state.configWriteOperations = [{ operationId: 'malformed' }];
  await assert.rejects(h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection }), /records cannot be read/);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('unverified targets, unclassified errors and unverifiable terminal frames cannot release a fence', async t => {
  const h = await fixture(t), connection = await h.connect();
  const missing = createConfigWrites({ ...h.options, resolveTarget: async () => { throw new Error('target unverified'); } });
  const missingTarget = await missing.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  assert.equal(missingTarget.outcome, 'not-started');
  assert.deepEqual(missingTarget.operation.terminal, { kind: 'not-sent' });
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
  const unclassified: ConfigWriteConnection = { connected: true, socket: {}, requestWithCursor: async () => { throw Object.assign(new Error('unknown transport failure'), { uncertain: false }); } };
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'skills/config/write', params: { name: 'fixture', enabled: false }, connection: unclassified });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  assert.equal((await first.completion).outcome, 'unknown');
  assert.equal((await h.writes.status(first.operation.operationId))?.state, 'unknown');
  const malformed: ConfigWriteConnection = { connected: true, socket: {}, requestWithCursor: async () => ({ result: undefined, eventCursor: 0 }) };
  const isolated = createConfigWrites({ ...h.options, state: {}, persist: async () => {}, mutations: createStateMutations() });
  const second = await isolated.submit({ operationId: randomUUID(), hostId: 'local', method: 'skills/config/write', params: { name: 'fixture', enabled: false }, connection: malformed });
  assert.equal(second.outcome, 'started'); if (second.outcome !== 'started') return;
  assert.equal((await second.completion).outcome, 'unknown');
  assert.equal((await isolated.status(second.operation.operationId))?.state, 'unknown');
});

test('the original parameters and expected version are frozen before asynchronous target verification', async t => {
  const h = await fixture(t), connection = await h.connect();
  let continueResolve!: () => void;
  const gate = new Promise<void>(resolve => { continueResolve = resolve; });
  const guarded = createConfigWrites({ ...h.options, resolveTarget: async input => { await gate; return h.resolveTarget(input); } });
  h.peer.handlers.set('config/batchWrite', () => ({ status: 'ok' }));
  const original = params(), snapshot = structuredClone(original);
  const starting = guarded.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: original, connection });
  original.expectedVersion = 'changed'; original.edits[0]!.value = true;
  continueResolve();
  const result = await starting;
  assert.equal(result.outcome, 'started'); if (result.outcome !== 'started') return;
  assert.equal((await result.completion).outcome, 'success');
  assert.deepEqual(h.peer.calls('config/batchWrite')[0]!.params, snapshot);
});

test('a proven unsent request can finish, while a malformed daemon error stays unknown', async t => {
  const h = await fixture(t);
  const unsent: ConfigWriteConnection = { connected: true, socket: {}, requestWithCursor: async () => { throw new RpcError('observer capacity', { code: 'OBSERVER_LIMIT', status: 503 }); } };
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'skills/config/write', params: { name: 'fixture', enabled: false }, connection: unsent });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  const rejected = await first.completion;
  assert.equal(rejected.outcome, 'error'); assert.equal(rejected.operation.state, 'failed');
  assert.deepEqual(rejected.operation.terminal, { kind: 'not-sent', code: 'OBSERVER_LIMIT' });
  const malformed: ConfigWriteConnection = { connected: true, socket: {}, requestWithCursor: async () => { throw new RpcError('Codex 返回了无效错误。', { code: -32001 }); } };
  const second = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'skills/config/write', params: { name: 'fixture', enabled: false }, connection: malformed });
  assert.equal(second.outcome, 'started'); if (second.outcome !== 'started') return;
  assert.equal((await second.completion).outcome, 'unknown');
  assert.equal((await h.writes.status(second.operation.operationId))?.state, 'unknown');
});

test('a mutable path alias remains fenced after retargeting, including other targets on that host', async t => {
  const h = await fixture(t), connection = await h.connect();
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const original = { ...params(), filePath: h.alias };
  const first = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: original, connection });
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  await h.peer.waitForCall('config/batchWrite');
  assert.deepEqual(h.peer.calls('config/batchWrite')[0]!.params, original);
  assert.equal(first.operation.target, await realpath(h.config));
  assert.equal(first.operation.binding, h.alias);
  const different = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite',
    params: { ...params(), filePath: h.other }, connection });
  assert.equal(different.outcome, 'blocked');
  await unlink(h.alias); await symlink(h.other, h.alias);
  const retargeted = await h.writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite',
    params: { ...params(), filePath: h.alias }, connection });
  assert.equal(retargeted.outcome, 'blocked');
  assert.equal(retargeted.operation.operationId, first.operation.operationId);
  assert.equal(retargeted.operation.target, await realpath(h.config));
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
  await first.completion;
});

test('the originating connection must remain unchanged during target verification and durable reservation', async t => {
  const h = await fixture(t), connection = await h.connect();
  let resumeResolution!: () => void, resolutionStarted!: () => void;
  const resolution = new Promise<void>(resolve => { resumeResolution = resolve; });
  const verifyingTarget = new Promise<void>(resolve => { resolutionStarted = resolve; });
  const delayed = createConfigWrites({ ...h.options, resolveTarget: async input => { resolutionStarted(); await resolution; return h.resolveTarget(input); } });
  const verifying = delayed.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  await verifyingTarget;
  const disconnected = once(connection, 'status'); h.peer.disconnect(); await disconnected;
  await connection.connect(); resumeResolution();
  const stopped = await verifying;
  assert.equal(stopped.outcome, 'not-started');
  assert.deepEqual(stopped.operation.terminal, { kind: 'not-sent' });
  assert.equal(h.peer.calls('config/batchWrite').length, 0);

  let resumePersist!: () => void, persistStarted!: () => void, firstPersist = true;
  const persistenceGate = new Promise<void>(resolve => { resumePersist = resolve; });
  const waiting = new Promise<void>(resolve => { persistStarted = resolve; });
  const reservation = createConfigWrites({ ...h.options, persist: async () => {
    if (firstPersist) { firstPersist = false; persistStarted(); await persistenceGate; }
    await h.persist();
  } });
  const starting = reservation.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: params(), connection });
  await waiting;
  const disconnectedAgain = once(connection, 'status'); h.peer.disconnect(); await disconnectedAgain;
  await connection.connect(); resumePersist();
  const started = await starting;
  assert.equal(started.outcome, 'not-started');
  assert.deepEqual(started.operation.terminal, { kind: 'not-sent' });
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
});

test('a lost first receipt is recovered by the page operation ID even after a terminal and restart', async t => {
  const h = await fixture(t), connection = await h.connect();
  h.peer.handlers.set('config/batchWrite', () => ({ status: 'okOverridden', version: 'private-response-version',
    overriddenMetadata: { message: 'private-response-message' } }));
  const original = { ...params(), edits: [{ keyPath: 'model', value: 'private-request-value', mergeStrategy: 'upsert' }] };
  const input = { operationId: 'page-original-id', hostId: 'local', method: 'config/batchWrite' as const, params: original, connection };
  const first = await h.writes.submit(input);
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  assert.equal((await first.completion).outcome, 'success');
  const disk = await readFile(h.statePath, 'utf8');
  assert.doesNotMatch(disk, /private-request-value|private-response-version|private-response-message/);
  const restored = JSON.parse(disk) as Record<string, unknown>;
  const restarted = createConfigWrites({ ...h.options, state: restored, mutations: createStateMutations() });
  connection.close();
  const recovered = await restarted.submit({ ...input, params: { changed: 'newer-draft' } });
  assert.equal(recovered.outcome, 'existing');
  assert.equal(recovered.operation.operationId, input.operationId);
  assert.equal(recovered.operation.method, input.method);
  assert.deepEqual(recovered.operation.terminal, { kind: 'okOverridden' });
  await assert.rejects(restarted.submit({ ...input, hostId: 'another-host' }), /another host or method/);
  await assert.rejects(restarted.submit({ ...input, method: 'skills/config/write' }), /another host or method/);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
  assert.equal(h.peer.calls('skills/config/write').length, 0);
});

test('concurrent preparation for one ID resolves and dispatches once, and rejects identity mismatches', async t => {
  const h = await fixture(t), connection = await h.connect();
  let release!: () => void, startedResolve!: () => void, resolutions = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const resolving = new Promise<void>(resolve => { startedResolve = resolve; });
  const writes = createConfigWrites({ ...h.options, resolveTarget: async input => {
    resolutions++; startedResolve(); await gate; return h.resolveTarget(input);
  } });
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const input = { operationId: 'same-page-operation', hostId: 'local', method: 'config/batchWrite' as const, params: params(), connection };
  const firstPromise = writes.submit(input);
  await resolving;
  assert.equal((await writes.status(input.operationId))?.state, 'preparing');
  const duplicatePromise = writes.submit({ ...input, params: { changed: true } });
  await assert.rejects(writes.submit({ ...input, hostId: 'remote' }), /another host or method/);
  await assert.rejects(writes.submit({ ...input, method: 'skills/config/write' }), /another host or method/);
  release();
  const first = await firstPromise, duplicate = await duplicatePromise;
  assert.equal(first.outcome, 'started'); assert.equal(duplicate.outcome, 'existing');
  if (first.outcome !== 'started') return;
  assert.equal(duplicate.operation.operationId, input.operationId);
  await h.peer.waitForCall('config/batchWrite');
  assert.equal(resolutions, 1);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
  assert.deepEqual(h.peer.calls('config/batchWrite')[0]!.params, input.params);
  assert.equal((await writes.submit(input)).outcome, 'existing');
  assert.equal((await first.completion).outcome, 'unknown');
  assert.equal((await writes.submit(input)).operation.state, 'unknown');
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('unknown-save failure is visible to another caller and local retry never sends a write', async t => {
  const h = await fixture(t), connection = await h.connect();
  let late!: () => void;
  h.peer.handlers.set('config/batchWrite', (_value, context) => {
    late = () => context.send({ id: context.message.id, result: { status: 'ok' } });
    return NO_REPLY;
  });
  const input = { operationId: 'unknown-save', hostId: 'local', method: 'config/batchWrite' as const, params: params(), connection };
  const first = await h.writes.submit(input);
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  await h.peer.waitForCall('config/batchWrite');
  h.failNextPersist();
  const completion = await first.completion;
  assert.equal(completion.outcome, 'unknown');
  assert.ok(completion.persistenceError);
  assert.equal((await h.writes.status(input.operationId))?.storageError, true);
  const duplicate = await h.writes.submit(input);
  assert.equal(duplicate.outcome, 'existing'); assert.equal(duplicate.operation.storageError, true);
  const durable = JSON.parse(await readFile(h.statePath, 'utf8')) as Record<string, unknown>;
  const restarted = createConfigWrites({ ...h.options, state: durable, mutations: createStateMutations() });
  assert.equal((await restarted.status(input.operationId))?.state, 'unknown');
  assert.equal((await restarted.status(input.operationId))?.storageError, undefined);
  await assert.rejects(restarted.retryTerminalSave(input.operationId), /original observation is unavailable/);
  h.failNextPersist();
  await assert.rejects(h.writes.retryTerminalSave(input.operationId), /fixture persistence failed/);
  assert.equal((await h.writes.status(input.operationId))?.storageError, true);
  assert.equal((await h.writes.retryTerminalSave(input.operationId)).state, 'unknown');
  assert.equal((await h.writes.status(input.operationId))?.storageError, undefined);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
  late();
  const terminal = await waitForStatus(h.writes, input.operationId, value => value.state === 'succeeded');
  assert.deepEqual(terminal.terminal, { kind: 'ok' });
});

test('late Skills results and explicit rejection retain only the original public outcome', async t => {
  const h = await fixture(t), connection = await h.connect();
  let late!: () => void;
  h.peer.handlers.set('skills/config/write', (_value, context) => {
    late = () => context.send({ id: context.message.id, result: { effectiveEnabled: false, secret: 'late-private-result' } });
    return NO_REPLY;
  });
  const input = { operationId: 'skill-original', hostId: 'local', method: 'skills/config/write' as const,
    params: { name: 'private-skill-selector', enabled: false }, connection };
  const first = await h.writes.submit(input);
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  assert.equal((await first.completion).outcome, 'unknown');
  late();
  const terminal = await waitForStatus(h.writes, input.operationId, value => value.state === 'succeeded');
  assert.deepEqual(terminal.terminal, { kind: 'effectiveEnabled', value: false });
  const recovered = createConfigWrites({ ...h.options, state: JSON.parse(await readFile(h.statePath, 'utf8')), mutations: createStateMutations() });
  assert.deepEqual((await recovered.status(input.operationId))?.terminal, terminal.terminal);
  h.peer.handlers.set('skills/config/write', () => { throw Object.assign(new Error('private-error-message'),
    { code: 'private-string-code', data: { secret: 'private-error-data' } }); });
  const rejected = await h.writes.submit({ ...input, operationId: 'skill-rejected' });
  assert.equal(rejected.outcome, 'started'); if (rejected.outcome !== 'started') return;
  const result = await rejected.completion;
  assert.equal(result.outcome, 'error'); assert.deepEqual(result.operation.terminal, { kind: 'rejected' });
  if (result.outcome === 'error') {
    assert.ok(result.error instanceof RpcError);
    assert.equal(result.error.message, 'private-error-message');
  }
  const disk = await readFile(h.statePath, 'utf8');
  assert.doesNotMatch(disk, /private-skill-selector|late-private-result|private-error-message|private-string-code|private-error-data/);
});

test('a non-normalized binding stays an alias when its symlink is later retargeted', async t => {
  const h = await fixture(t), connection = await h.connect();
  const originalDir = join(h.home, 'subdir'), laterDir = join(h.root, 'later'), laterSubdir = join(laterDir, 'subdir');
  await mkdir(originalDir); await mkdir(laterDir); await mkdir(laterSubdir);
  const laterConfig = join(laterDir, 'config.toml'), linkPath = join(h.home, 'mutable');
  await writeFile(laterConfig, 'fixture = true\n'); await symlink(originalDir, linkPath);
  const binding = linkPath + '/../config.toml';
  assert.equal(await realpath(binding), h.config);
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const input = { operationId: 'dotdot-alias', hostId: 'local', method: 'config/batchWrite' as const,
    params: { ...params(), filePath: binding }, connection };
  const first = await h.writes.submit(input);
  assert.equal(first.outcome, 'started'); if (first.outcome !== 'started') return;
  assert.equal(first.operation.binding, binding); assert.equal(first.operation.target, h.config);
  await h.peer.waitForCall('config/batchWrite');
  assert.deepEqual(h.peer.calls('config/batchWrite')[0]!.params, input.params);
  await unlink(linkPath); await symlink(laterSubdir, linkPath);
  assert.equal(await realpath(binding), laterConfig);
  const blocked = await h.writes.submit({ ...input, operationId: 'later-write', params: { ...params(), filePath: laterConfig } });
  assert.equal(blocked.outcome, 'blocked'); assert.equal(blocked.operation.operationId, input.operationId);
  assert.equal((await first.completion).outcome, 'unknown');
  const recovered = createConfigWrites({ ...h.options, state: JSON.parse(await readFile(h.statePath, 'utf8')), mutations: createStateMutations() });
  assert.equal((await recovered.status(input.operationId))?.binding, binding);
  assert.equal((await recovered.submit({ ...input, operationId: 'after-restart', params: { ...params(), filePath: laterConfig } })).outcome, 'blocked');
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('unsupported value writes and legacy records cannot masquerade as a new method', async t => {
  const h = await fixture(t), connection = await h.connect();
  const input = { operationId: 'legacy', hostId: 'local', method: 'config/batchWrite' as const, params: params(), connection };
  await assert.rejects(h.writes.submit({ ...input, method: 'config/value/write' as never }), /Invalid configuration write request/);
  const state: Record<string, unknown> = { configWriteOperations: [{ operationId: 'legacy', hostId: 'local',
    hostKey: 'fixture-machine-a', target: h.config, binding: h.config, state: 'succeeded' }] };
  const recovered = createConfigWrites({ ...h.options, state, mutations: createStateMutations() });
  const status = await recovered.status('legacy');
  assert.equal(status?.state, 'succeeded'); assert.equal(status?.terminal, undefined); assert.equal(status?.method, undefined);
  await assert.rejects(recovered.submit(input), /original method is unavailable/);
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
});
