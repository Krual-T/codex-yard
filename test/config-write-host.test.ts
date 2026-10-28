import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CodexConnection, RpcError } from '../lib/codex.ts';
import type { ConfigurationWriteRequest, ConfigurationWriteSubmitResponse, ConfigWriteStatus } from '../lib/config-write-protocol.ts';
import { createConfigWriteHost } from '../src/native/config-write-host.ts';
import { createConfigWriteTargets } from '../src/native/config-write-targets.ts';
import { createConfigWrites } from '../src/native/config-writes.ts';
import type { ConfigWriteConnection } from '../src/native/config-writes.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';

type Context = { allowed: boolean };
const context: Context = { allowed: true };
const batchParams = () => ({ filePath: null, expectedVersion: 'fixture-v1', reloadUserConfig: true,
  edits: [{ keyPath: 'hooks.state.fixture.enabled', value: false, mergeStrategy: 'upsert' }] });
const batch = (operationId: string, hostId = 'local') => ({ hostId, action: 'submit' as const, operationId,
  method: 'config/batchWrite' as const, params: batchParams() });
const skill = (operationId: string, hostId = 'local') => ({ hostId, action: 'submit' as const, operationId,
  method: 'skills/config/write' as const, params: { name: 'fixture:skill', enabled: false } });

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-config-host-'), home = join(root, 'codex'), statePath = join(root, 'state.json');
  await mkdir(home);
  const config = join(home, 'config.toml'), peer = await createFakeCodex(root), connections: CodexConnection[] = [];
  peer.handlers.set('initialize', () => ({ userAgent: 'configuration-host-fixture', codexHome: home }));
  peer.handlers.set('config/read', () => ({ config: {}, layers: [
    { name: { type: 'user', file: config, profile: null }, version: 'fixture-v1' },
  ] }));
  const state: Record<string, unknown> = {};
  let failures = 0;
  const persist = async () => {
    if (failures) { failures--; throw new Error('PRIVATE_PERSISTENCE_DETAIL'); }
    await writeFile(statePath + '.tmp', JSON.stringify(state));
    await rename(statePath + '.tmp', statePath);
  };
  const resolveTarget = createConfigWriteTargets({ getConnectionSnapshot: () => ({ paths: { homeDirectory: root, codexHome: home } }) });
  const options = { state, persist, mutations: createStateMutations(), resolveTarget, findFileBlocker: () => false, issueRecoveryReceipts: true };
  const writes = createConfigWrites(options), connectCalls: string[] = [];
  async function openConnection() {
    const connection = new CodexConnection(peer.socketPath, { timeout: 180 });
    connections.push(connection); await connection.connect(); return connection;
  }
  let connectHook: (hostId: string) => Promise<ConfigWriteConnection> = async hostId => {
    if (hostId !== 'local') throw new Error('PRIVATE_OFFLINE_DETAIL');
    return openConnection();
  };
  const host = createConfigWriteHost<Context>({ writes,
    validateHost(hostId, value) {
      if (!value.allowed || hostId !== 'local' && hostId !== 'ssh-fixture') throw new Error('PRIVATE_AUTH_DETAIL');
    },
    async connect(hostId) { connectCalls.push(hostId); return connectHook(hostId); },
  });
  async function submit(request: Extract<ConfigurationWriteRequest, { action: 'submit' }>) {
    const result = await host.handle(request, context);
    assert.ok('outcome' in result);
    return result;
  }
  async function status(operationId: string, hostId = 'local') {
    const result = await host.handle({ hostId, action: 'status', operationId }, context);
    assert.ok(!('outcome' in result));
    return result.operation;
  }
  async function retry(operationId: string, hostId = 'local') {
    const result = await host.handle({ hostId, action: 'retry-persistence', operationId }, context);
    assert.ok(!('outcome' in result));
    return result;
  }
  t.after(async () => {
    for (const connection of connections) connection.close();
    await peer.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, home, statePath, state, options, writes, host, peer, connectCalls, openConnection, submit, status, retry,
    failNextPersist() { failures++; }, setConnectHook(value: typeof connectHook) { connectHook = value; } };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function waitForStatus(read: () => Promise<ConfigWriteStatus | null>, predicate: (value: ConfigWriteStatus) => boolean) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value && predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the original configuration operation');
}

test('host validates requests and observes missing operations without connecting or authorizing a retry', async t => {
  const h = await fixture(t);
  assert.equal(await h.status('missing'), null);
  assert.deepEqual(await h.retry('missing'), { operation: null });
  await assert.rejects(h.host.handle(batch('id'), { allowed: false }), /unavailable or unauthorized/);
  await assert.rejects(h.host.handle(batch('id', 'unregistered'), context), /unavailable or unauthorized/);
  await assert.rejects(h.host.handle({ ...batch('id'), method: 'config/value/write' }, context), /Invalid configuration/);
  await assert.rejects(h.host.handle({ ...batch('id'), params: { ...batchParams(), operationId: 'id' } }, context), /Invalid configuration/);
  assert.deepEqual(h.connectCalls, []);
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
});

test('batch completion preserves original params and result, and a lost response recovers the same operation without connecting', async t => {
  const h = await fixture(t), request = batch('batch-original'), snapshot = structuredClone(request.params);
  const result = { status: 'okOverridden', version: 'fixture-v2', overriddenMetadata: { source: 'fixture' } };
  h.peer.handlers.set('config/batchWrite', () => result);
  const first = await h.submit(request);
  assert.equal(first.outcome, 'success');
  if (first.outcome !== 'success') return;
  assert.deepEqual(first.result, result);
  assert.deepEqual(first.operation.terminal, { kind: 'okOverridden' });
  assert.deepEqual(h.peer.calls('config/batchWrite')[0]!.params, snapshot);
  assert.deepEqual(h.peer.calls('config/read')[0]!.params, { includeLayers: true });
  assert.equal(Object.hasOwn(h.peer.calls('config/batchWrite')[0]!.params, 'operationId'), false);
  assert.doesNotMatch(await readFile(h.statePath, 'utf8'), /hooks\.state|overriddenMetadata/);

  const restored = JSON.parse(await readFile(h.statePath, 'utf8')) as Record<string, unknown>;
  const writes = createConfigWrites({ ...h.options, state: restored, mutations: createStateMutations() });
  const restarted = createConfigWriteHost<Context>({ writes, validateHost() {}, connect: async () => { throw new Error('must not connect'); } });
  const recovered = await restarted.handle(request, context);
  assert.ok('outcome' in recovered);
  assert.equal(recovered.outcome, 'existing');
  assert.deepEqual(recovered.operation?.terminal, { kind: 'okOverridden' });
  await assert.rejects(restarted.handle(skill('batch-original'), context), /identity or records/);
  await assert.rejects(restarted.handle(batch('batch-original', 'ssh-fixture'), context), /identity or records/);
  assert.deepEqual(h.connectCalls, ['local']);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('concurrent same-ID preparation shares the original and rejects host or method changes', async t => {
  const h = await fixture(t), entered = gate(), connectionGate = gate(), request = batch('same-id');
  const original = structuredClone(request.params);
  h.setConnectHook(async () => { entered.release(); await connectionGate.promise; return h.openConnection(); });
  h.peer.handlers.set('config/batchWrite', () => ({ status: 'ok' }));
  const first = h.submit(request);
  await entered.promise;
  const duplicate = h.submit({ ...batch('same-id'), params: { ...batchParams(), expectedVersion: 'later-edit' } });
  await assert.rejects(h.submit(skill('same-id')), /another host or method/);
  await assert.rejects(h.submit(batch('same-id', 'ssh-fixture')), /another host or method/);
  assert.equal((await h.status('same-id'))?.state, 'preparing');
  request.params.expectedVersion = 'mutated-after-dispatch';
  connectionGate.release();
  const [originalResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.equal(originalResult.outcome, 'success');
  assert.equal(duplicateResult.outcome, 'existing');
  assert.deepEqual(h.peer.calls('config/batchWrite')[0]!.params, original);
  assert.deepEqual(h.connectCalls, ['local']);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('pending and unknown global operations block another host before it can connect', async t => {
  const h = await fixture(t);
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const first = h.submit(batch('original'));
  await h.peer.waitForCall('config/batchWrite');
  const pendingBlock = await h.submit(skill('other-pending', 'ssh-fixture'));
  assert.equal(pendingBlock.outcome, 'blocked');
  assert.equal(pendingBlock.operation?.operationId, 'original');
  const unknown = await first;
  assert.equal(unknown.outcome, 'unknown');
  assert.equal(unknown.operation?.state, 'unknown');
  const unknownBlock = await h.submit(skill('other-unknown', 'ssh-fixture'));
  assert.equal(unknownBlock.outcome, 'blocked');
  assert.equal(unknownBlock.operation?.operationId, 'original');
  const existing = await h.submit(batch('original'));
  assert.equal(existing.outcome, 'existing');
  await assert.rejects(h.status('original', 'ssh-fixture'), /another host/);
  assert.deepEqual(h.connectCalls, ['local']);
  assert.equal(h.peer.calls('skills/config/write').length, 0);
});

test('legacy pending records recover as unknown and block even an offline host', async t => {
  const h = await fixture(t);
  h.state.configWriteOperations = [{ operationId: 'legacy', hostId: 'local', hostKey: 'legacy-host',
    target: '/legacy/config.toml', binding: '/legacy/config.toml', state: 'pending' }];
  assert.equal((await h.status('legacy'))?.state, 'unknown');
  await assert.rejects(h.submit(batch('legacy')), /identity or records/);
  const blocked = await h.submit(skill('new', 'ssh-fixture'));
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.operation?.operationId, 'legacy');
  assert.deepEqual(h.connectCalls, []);
});

test('a failed connection records not-sent even when another operation starts during preparation', async t => {
  const h = await fixture(t), entered = gate(), connectionGate = gate();
  h.setConnectHook(async hostId => {
    if (hostId === 'ssh-fixture') { entered.release(); await connectionGate.promise; throw new Error('PRIVATE_OFFLINE_DETAIL'); }
    return h.openConnection();
  });
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const offline = h.submit(skill('offline', 'ssh-fixture'));
  await entered.promise;
  const first = h.submit(batch('new-blocker'));
  await h.peer.waitForCall('config/batchWrite');
  connectionGate.release();
  const unsent = await offline;
  assert.equal(unsent.outcome, 'not-started');
  assert.equal(unsent.operation?.operationId, 'offline');
  assert.deepEqual(unsent.operation?.terminal, { kind: 'not-sent' });
  assert.equal((await first).outcome, 'unknown');
  assert.deepEqual(h.connectCalls, ['ssh-fixture', 'local']);
});

test('disconnect keeps the first request unknown and duplicate submits never reconnect or resend', async t => {
  const h = await fixture(t);
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const first = h.submit(batch('disconnected'));
  await h.peer.waitForCall('config/batchWrite');
  h.peer.disconnect();
  const result = await first;
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.operation?.state, 'unknown');
  assert.equal((await h.submit(batch('disconnected'))).outcome, 'existing');
  assert.deepEqual(h.connectCalls, ['local']);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('received success survives a failed local save and retry only persists the observed terminal', async t => {
  const h = await fixture(t);
  let finish: (() => void) | undefined;
  h.peer.handlers.set('config/batchWrite', (_params, call) => {
    finish = () => call.send({ id: call.message.id, result: { status: 'okOverridden', version: 'fixture-v2' } });
    return NO_REPLY;
  });
  const first = h.submit(batch('save-failed'));
  await h.peer.waitForCall('config/batchWrite');
  h.failNextPersist(); assert.ok(finish); finish();
  const result = await first;
  assert.equal(result.outcome, 'success');
  if (result.outcome !== 'success') return;
  assert.deepEqual(result.result, { status: 'okOverridden', version: 'fixture-v2' });
  assert.equal(result.operation.storageError, true);
  assert.deepEqual(result.operation.observedTerminal, { kind: 'okOverridden' });
  assert.equal((await h.submit(skill('blocked', 'ssh-fixture'))).outcome, 'blocked');
  h.failNextPersist();
  const failedRetry = await h.retry('save-failed');
  assert.equal(failedRetry.operation?.storageError, true);
  assert.ok('error' in failedRetry && failedRetry.error);
  assert.equal(failedRetry.error.uncertain, false);
  assert.doesNotMatch(JSON.stringify(failedRetry), /PRIVATE_PERSISTENCE_DETAIL/);
  const recovered = await h.retry('save-failed');
  assert.deepEqual(recovered.operation?.terminal, { kind: 'okOverridden' });
  assert.equal(recovered.operation?.storageError, undefined);
  assert.deepEqual(h.connectCalls, ['local']);
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('unknown persistence failures are visible and a late original Skills result is saved without a second write', async t => {
  const h = await fixture(t);
  let finish: (() => void) | undefined;
  h.peer.handlers.set('skills/config/write', (_params, call) => {
    finish = () => call.send({ id: call.message.id, result: { effectiveEnabled: false } });
    return NO_REPLY;
  });
  const first = h.submit(skill('late-skill'));
  await h.peer.waitForCall('skills/config/write');
  h.failNextPersist();
  const unknown = await first;
  assert.equal(unknown.outcome, 'unknown');
  assert.equal(unknown.operation?.storageError, true);
  h.failNextPersist();
  const failedRetry = await h.retry('late-skill');
  assert.ok('error' in failedRetry && failedRetry.error);
  assert.equal(failedRetry.error.uncertain, true);
  assert.equal((await h.retry('late-skill')).operation?.state, 'unknown');
  h.failNextPersist();
  assert.ok(finish); finish();
  const late = await waitForStatus(() => h.status('late-skill'), value => value.storageError === true);
  assert.equal(late.state, 'unknown');
  assert.deepEqual(late.observedTerminal, { kind: 'effectiveEnabled', value: false });
  assert.equal((await h.submit(batch('blocked-late'))).outcome, 'blocked');
  assert.deepEqual((await h.retry('late-skill')).operation?.terminal, { kind: 'effectiveEnabled', value: false });
  assert.equal((await h.submit(skill('late-skill'))).outcome, 'existing');
  assert.deepEqual(h.connectCalls, ['local']);
  assert.equal(h.peer.calls('skills/config/write').length, 1);
});

test('explicit rejection exposes its numeric code without private error details', async t => {
  const h = await fixture(t);
  h.peer.handlers.set('config/batchWrite', () => { throw Object.assign(new Error('PRIVATE_RPC_MESSAGE'),
    { code: -32009, data: { credential: 'PRIVATE_RPC_DATA' } }); });
  const result = await h.submit(batch('rejected'));
  assert.equal(result.outcome, 'error');
  if (result.outcome !== 'error') return;
  assert.equal(result.error.uncertain, false);
  assert.equal(result.error.code, -32009);
  assert.deepEqual(result.operation.terminal, { kind: 'rejected', code: -32009 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RPC/);
  assert.doesNotMatch(await readFile(h.statePath, 'utf8'), /PRIVATE_RPC/);
});

test('a proven pre-dispatch failure is not-started and preserves an existing not-sent record', async () => {
  const state: Record<string, unknown> = {}, writes = createConfigWrites({ state, mutations: createStateMutations(), findFileBlocker: () => false,
    persist: async () => {}, resolveTarget: async () => ({ hostKey: 'fixture', target: '/fixture/config.toml', binding: '/fixture/config.toml', scope: 'global' }) });
  const connection: ConfigWriteConnection = { connected: true, socket: {},
    async requestWithCursor() { throw new RpcError('PRIVATE_NOT_SENT', { status: 503, code: 'OBSERVER_LIMIT' }); } };
  let connects = 0;
  const host = createConfigWriteHost<Context>({ writes, validateHost() {}, connect: async () => { connects++; return connection; } });
  const response = await host.handle(batch('not-sent'), context) as ConfigurationWriteSubmitResponse;
  assert.equal(response.outcome, 'not-started');
  if (response.outcome !== 'not-started') return;
  assert.equal(response.error.uncertain, false);
  assert.equal(response.error.code, 'OBSERVER_LIMIT');
  assert.deepEqual(response.operation?.terminal, { kind: 'not-sent', code: 'OBSERVER_LIMIT' });
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_NOT_SENT/);
  const duplicate = await host.handle(batch('not-sent'), context) as ConfigurationWriteSubmitResponse;
  assert.equal(duplicate.outcome, 'existing');
  assert.equal(connects, 1);
});

test('failed target verification or initial connection persists the original not-sent record', async t => {
  const h = await fixture(t), invalid = batch('bad-target');
  const result = await h.submit({ ...invalid, params: { ...invalid.params, filePath: '/not-the-base.toml' } });
  assert.equal(result.outcome, 'not-started');
  assert.deepEqual(result.operation?.terminal, { kind: 'not-sent' });
  assert.deepEqual((await h.status('bad-target'))?.terminal, { kind: 'not-sent' });
  const offline = await h.submit(skill('offline', 'ssh-fixture'));
  assert.equal(offline.outcome, 'not-started');
  assert.deepEqual(offline.operation?.terminal, { kind: 'not-sent' });
  assert.doesNotMatch(JSON.stringify(offline), /PRIVATE_OFFLINE_DETAIL/);
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
  assert.equal(h.peer.calls('skills/config/write').length, 0);
});

test('failure to persist the pending reservation never dispatches the original write', async t => {
  const h = await fixture(t);
  let saves = 0;
  const writes = createConfigWrites({ ...h.options, persist: async () => {
    if (++saves === 2) throw new Error('PRIVATE_PENDING_SAVE_DETAIL');
    await h.options.persist();
  } });
  const host = createConfigWriteHost<Context>({ writes, validateHost() {}, connect: h.openConnection });
  const result = await host.handle(batch('pending-save-failed'), context);
  assert.ok('outcome' in result);
  assert.equal(result.outcome, 'not-started');
  assert.deepEqual(result.operation?.terminal, { kind: 'not-sent' });
  assert.equal(saves, 3);
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PENDING_SAVE_DETAIL/);
  const durable = JSON.parse(await readFile(h.statePath, 'utf8')) as Record<string, unknown>;
  const restarted = createConfigWrites({ ...h.options, state: durable, mutations: createStateMutations() });
  assert.deepEqual((await restarted.status('pending-save-failed'))?.terminal, { kind: 'not-sent' });
});

test('preparing is durable before connect and an interrupted preparation can only be settled locally', async t => {
  const h = await fixture(t), entered = gate(), hold = gate();
  h.setConnectHook(async () => { entered.release(); await hold.promise; throw new Error('fixture closed'); });
  const original = h.submit(batch('before-connect'));
  await entered.promise;
  assert.equal((await h.status('before-connect'))?.state, 'preparing');
  const durable = JSON.parse(await readFile(h.statePath, 'utf8')) as Record<string, unknown>;
  const writes = createConfigWrites({ ...h.options, state: durable, mutations: createStateMutations(), persist: async () => {} });
  const restarted = createConfigWriteHost<Context>({ writes, validateHost() { throw new Error('removed host'); },
    connect: async () => { throw new Error('must not connect'); } });
  const status = await restarted.handle({ hostId: 'local', action: 'status', operationId: 'before-connect' }, context);
  assert.ok(!('outcome' in status));
  assert.equal(status.operation?.state, 'preparing');
  assert.equal(status.operation?.interrupted, true);
  const blocked = await writes.begin({ operationId: 'other', hostId: 'local', method: 'config/batchWrite' });
  assert.equal(blocked.outcome, 'blocked');
  const retried = await restarted.handle({ hostId: 'local', action: 'retry-persistence', operationId: 'before-connect' }, context);
  assert.ok(!('outcome' in retried));
  assert.deepEqual(retried.operation?.terminal, { kind: 'not-sent' });
  assert.equal(retried.operation?.state, 'failed');
  hold.release();
  assert.equal((await original).outcome, 'not-started');
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
});

test('a signed observed terminal survives restart without trusting a forged browser receipt', async t => {
  const h = await fixture(t);
  let finish: (() => void) | undefined;
  h.peer.handlers.set('config/batchWrite', (_params, call) => {
    finish = () => call.send({ id: call.message.id, result: { status: 'okOverridden', version: 'private-fixture-version' } });
    return NO_REPLY;
  });
  const promise = h.submit(batch('receipt-id'));
  await h.peer.waitForCall('config/batchWrite');
  h.failNextPersist(); assert.ok(finish); finish();
  const result = await promise;
  assert.equal(result.outcome, 'success');
  if (result.outcome !== 'success') return;
  const receipt = result.operation.recoveryReceipt;
  assert.ok(receipt);
  const disk = JSON.parse(await readFile(h.statePath, 'utf8')) as { configWriteOperations: { receiptKey: string }[] };
  const secret = disk.configWriteOperations[0]!.receiptKey;
  assert.ok(secret);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  let durable: Record<string, unknown> = structuredClone(disk);
  const state = structuredClone(durable);
  const writes = createConfigWrites({ ...h.options, state, mutations: createStateMutations(), persist: async () => { durable = structuredClone(state); } });
  const host = createConfigWriteHost<Context>({ writes, validateHost() { throw new Error('host removed'); },
    connect: async () => { throw new Error('must not connect'); } });
  const query = (hostId = 'local') => host.handle({ hostId, action: 'status', operationId: 'receipt-id' }, context);
  const retry = (value: unknown) => host.handle({ hostId: 'local', action: 'retry-persistence', operationId: 'receipt-id', receipt: value }, context);
  const before = await query(); assert.ok(!('outcome' in before)); assert.equal(before.operation?.state, 'unknown');
  const noReceipt = await host.handle({ hostId: 'local', action: 'retry-persistence', operationId: 'receipt-id' }, context);
  assert.ok(!('outcome' in noReceipt)); assert.equal(noReceipt.operation?.state, 'unknown');
  const forged = await retry({ ...receipt, terminal: { kind: 'ok' } });
  assert.ok(!('outcome' in forged)); assert.ok('error' in forged && forged.error);
  assert.equal(forged.operation?.state, 'unknown');
  const wrongMethod = await retry({ ...receipt, method: 'skills/config/write' });
  assert.ok(!('outcome' in wrongMethod)); assert.ok('error' in wrongMethod && wrongMethod.error);
  const wrongId = await retry({ ...receipt, operationId: 'another-operation' });
  assert.ok(!('outcome' in wrongId)); assert.ok('error' in wrongId && wrongId.error);
  const wrongHost = await retry({ ...receipt, hostId: 'ssh-fixture' });
  assert.ok(!('outcome' in wrongHost)); assert.ok('error' in wrongHost && wrongHost.error);
  const wrongSignature = await retry({ ...receipt, signature: 'A'.repeat(43) });
  assert.ok(!('outcome' in wrongSignature)); assert.ok('error' in wrongSignature && wrongSignature.error);
  assert.equal((await query()).operation?.state, 'unknown');
  await assert.rejects(query('ssh-fixture'), /another host/);
  const restored = await retry(receipt);
  assert.ok(!('outcome' in restored)); assert.deepEqual(restored.operation?.terminal, { kind: 'okOverridden' });
  assert.equal(restored.operation?.state, 'succeeded');
  const again = createConfigWrites({ ...h.options, state: durable, mutations: createStateMutations(), persist: async () => {} });
  assert.deepEqual((await again.status('receipt-id'))?.terminal, { kind: 'okOverridden' });
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
  assert.deepEqual(h.connectCalls, ['local']);
});

test('receipt issuance stays disabled until native state is isolated from browser file access', async t => {
  const h = await fixture(t);
  const writes = createConfigWrites({ ...h.options, issueRecoveryReceipts: false });
  const host = createConfigWriteHost<Context>({ writes, validateHost() {}, connect: h.openConnection });
  let finish: (() => void) | undefined;
  h.peer.handlers.set('config/batchWrite', (_params, call) => {
    finish = () => call.send({ id: call.message.id, result: { status: 'ok' } });
    return NO_REPLY;
  });
  const promise = host.handle(batch('unprotected-state'), context);
  await h.peer.waitForCall('config/batchWrite');
  h.failNextPersist(); assert.ok(finish); finish();
  const result = await promise;
  assert.ok('outcome' in result); assert.equal(result.outcome, 'success');
  assert.equal(result.operation?.storageError, true);
  assert.equal(result.operation?.recoveryReceipt, undefined);
  const disk = JSON.parse(await readFile(h.statePath, 'utf8')) as { configWriteOperations: Record<string, unknown>[] };
  assert.equal(disk.configWriteOperations[0]?.receiptKey, undefined);
  const restarted = createConfigWrites({ ...h.options, state: disk, mutations: createStateMutations(), persist: async () => {} });
  await assert.rejects(restarted.retryTerminalSave('unprotected-state', { operationId: 'unprotected-state', hostId: 'local',
    method: 'config/batchWrite', terminal: { kind: 'ok' }, signature: 'A'.repeat(43) }), /cannot be verified/);
  assert.equal((await restarted.status('unprotected-state'))?.state, 'unknown');
  assert.equal(h.peer.calls('config/batchWrite').length, 1);
});

test('known immediate and late rejection categories are safe and unknown details are never persisted', async t => {
  const h = await fixture(t);
  for (const category of ['configVersionConflict', 'configValidationError', 'configLayerReadonly'] as const) {
    h.peer.handlers.set('config/batchWrite', () => { throw Object.assign(new Error('PRIVATE_MESSAGE'),
      { code: -32600, data: { config_write_error_code: category, secret: 'PRIVATE_DATA' } }); });
    const result = await h.submit(batch(category));
    assert.equal(result.outcome, 'error');
    if (result.outcome !== 'error') return;
    assert.equal(result.error.category, category);
    assert.equal(result.error.code, -32600);
    assert.deepEqual(result.operation.terminal, { kind: 'rejected', code: -32600, category });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  }
  let finish: (() => void) | undefined;
  h.peer.handlers.set('config/batchWrite', (_params, call) => {
    finish = () => call.send({ id: call.message.id, error: { code: -32600, message: 'PRIVATE_LATE',
      data: { config_write_error_code: 'configVersionConflict', secret: 'PRIVATE_LATE_DATA' } } });
    return NO_REPLY;
  });
  const unknown = await h.submit(batch('late-rejection'));
  assert.equal(unknown.outcome, 'unknown');
  assert.ok(finish); finish();
  const late = await waitForStatus(() => h.status('late-rejection'), value => value.state === 'failed');
  assert.deepEqual(late.terminal, { kind: 'rejected', code: -32600, category: 'configVersionConflict' });
  h.peer.handlers.set('config/batchWrite', () => { throw Object.assign(new Error('PRIVATE_MESSAGE'),
    { code: -32600, data: { config_write_error_code: 'PRIVATE_UNKNOWN_CATEGORY' } }); });
  const unknownCategory = await h.submit(batch('unknown-category'));
  assert.equal(unknownCategory.outcome, 'error');
  if (unknownCategory.outcome === 'error') assert.equal(unknownCategory.error.category, undefined);
  assert.doesNotMatch(await readFile(h.statePath, 'utf8'), /PRIVATE_/);
});

test('the shared mutation interval coordinates file reservations with configuration preparation and dispatch', async t => {
  const h = await fixture(t), mutations = createStateMutations();
  let fileActive = false;
  const writes = createConfigWrites({ ...h.options, mutations, findFileBlocker: target => {
    assert.equal(target.binding, join(h.home, 'config.toml')); return fileActive;
  } });
  const entered = gate(), hold = gate();
  const host = createConfigWriteHost<Context>({ writes, validateHost() {}, connect: async () => {
    entered.release(); await hold.promise; return h.openConnection();
  } });
  const reserveFile = () => mutations.run(() => {
    if (writes.activeForFile()) return false;
    fileActive = true; return true;
  });
  assert.equal(await reserveFile(), true);
  const first = host.handle(batch('config-vs-file'), context);
  await entered.promise;
  assert.equal(await reserveFile(), false);
  hold.release();
  const blocked = await first;
  assert.ok('outcome' in blocked);
  assert.equal(blocked.outcome, 'not-started');
  assert.deepEqual(blocked.operation?.terminal, { kind: 'not-sent' });
  assert.equal(h.peer.calls('config/batchWrite').length, 0);
  await mutations.run(() => { fileActive = false; });
  h.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const second = host.handle(batch('config-first'), context);
  await h.peer.waitForCall('config/batchWrite');
  assert.equal(await reserveFile(), false);
  const unknown = await second;
  assert.ok('outcome' in unknown); assert.equal(unknown.outcome, 'unknown');
  assert.equal(await reserveFile(), false);
});

test('configuration requests request original-socket late observation and ignore a later socket generation', async () => {
  const state: Record<string, unknown> = {};
  const writes = createConfigWrites({ state, persist: async () => {}, mutations: createStateMutations(), findFileBlocker: () => false,
    resolveTarget: async () => ({ hostKey: 'fixture', target: '/fixture/config.toml', binding: '/fixture/config.toml', scope: 'global' }) });
  let socket: object = {}, callback: NonNullable<Parameters<ConfigWriteConnection['requestWithCursor']>[2]>['onLateTerminal'];
  const connection: ConfigWriteConnection = { connected: true, get socket() { return socket; }, async requestWithCursor(_method, _params, options) {
    assert.equal(options?.retainLateUntilDisconnect, true);
    callback = options?.onLateTerminal;
    throw new RpcError('fixture timeout', { uncertain: true });
  } };
  const host = createConfigWriteHost<Context>({ writes, validateHost() {}, connect: async () => connection });
  const first = await host.handle(batch('old-socket'), context);
  assert.ok('outcome' in first); assert.equal(first.outcome, 'unknown');
  socket = {};
  assert.ok(callback);
  await callback({ outcome: 'success', result: { status: 'ok' } });
  assert.equal((await writes.status('old-socket'))?.state, 'unknown');
});
