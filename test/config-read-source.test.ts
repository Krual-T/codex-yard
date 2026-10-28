import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import { CodexConnection } from '../lib/codex.ts';
import type { ConfigReadSource, ConfigurationWriteSubmitResponse } from '../lib/config-write-protocol.ts';
import { createConfigWriteHost } from '../src/native/config-write-host.ts';
import { createConfigWriteTargets } from '../src/native/config-write-targets.ts';
import { createConfigWrites } from '../src/native/config-writes.ts';
import type { ConfigWriteConnection } from '../src/native/config-writes.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';

const run = promisify(execFile);
const hostId = 'ssh-fixture';
const context = { session: 'fixture' };
const params = () => ({ filePath: null, expectedVersion: 'same-version', reloadUserConfig: true,
  edits: [{ keyPath: 'fixture.enabled', value: false, mergeStrategy: 'upsert' }] });
const submit = (operationId: string, source: ConfigReadSource) => ({ hostId, action: 'submit' as const,
  operationId, method: 'config/batchWrite' as const, params: params(), source });

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-config-read-source-');
  const sshHost = { hostId, displayName: 'fixture', sshAlias: null, sshHost: 'fixture.invalid', sshPort: 22, identity: null };
  const peers: Awaited<ReturnType<typeof createFakeCodex>>[] = [], connections: CodexConnection[] = [];
  const snapshots = new Map<unknown, { connection: CodexConnection; source: ConfigReadSource }>();
  async function connect(name: string) {
    const homeDirectory = join(root, name), codexHome = join(homeDirectory, '.codex');
    await mkdir(codexHome, { recursive: true });
    const peer = await createFakeCodex(homeDirectory); peers.push(peer);
    peer.handlers.set('initialize', () => ({ userAgent: 'read-source-fixture', codexHome }));
    peer.handlers.set('config/read', () => ({ config: {}, layers: [
      { name: { type: 'user', file: join(codexHome, 'config.toml'), profile: null }, version: 'same-version' },
    ] }));
    peer.handlers.set('config/batchWrite', () => ({ status: 'ok' }));
    peer.handlers.set('skills/list', () => ({ data: [{ name: 'fixture:skill' }] }));
    peer.handlers.set('skills/config/write', () => ({ effectiveEnabled: false }));
    const connection = new CodexConnection(peer.socketPath, { timeout: 250 });
    connections.push(connection); await connection.connect();
    const source = { hostId, generation: `generation-${name}`, homeDirectory, codexHome };
    snapshots.set(connection.socket, { connection, source });
    return { peer, connection, source };
  }
  const first = await connect('home-a'), second = await connect('home-b');
  const state: Record<string, unknown> = {};
  let durable: Record<string, unknown> = {}, selected = first, authorized = true;
  const resolveTarget = createConfigWriteTargets({ getConnectionSnapshot: input => {
    const snapshot = snapshots.get(input.socket);
    return snapshot?.connection === input.connection && snapshot.source.hostId === input.hostId
      ? { paths: { homeDirectory: snapshot.source.homeDirectory, codexHome: snapshot.source.codexHome }, sshHost } : undefined;
  }, remoteCommand: async (_host, command, maxBytes, signal) => {
    const { stdout } = await run('/bin/sh', ['-c', command], { encoding: 'buffer', maxBuffer: maxBytes, signal });
    return stdout;
  } });
  const writes = createConfigWrites({ state, persist: async () => { durable = structuredClone(state); },
    mutations: createStateMutations(), resolveTarget, findFileBlocker: () => false });
  const calls: { hostId: string; source: ConfigReadSource }[] = [];
  const host = createConfigWriteHost<typeof context>({ writes,
    validateHost(id, value) { if (!authorized || id !== hostId || value !== context) throw new Error('fixture unavailable'); },
    async connect(id, value, source) {
      assert.equal(value, context); calls.push({ hostId: id, source: structuredClone(source) });
      const { connection } = selected, socket = connection.socket, snapshot = snapshots.get(socket);
      if (!connection.connected || !snapshot || snapshot.connection !== connection
        || JSON.stringify(snapshot.source) !== JSON.stringify(source)) throw new Error('PRIVATE_SOURCE_MISMATCH');
      return { connection, socket };
    },
  });
  t.after(async () => {
    for (const connection of connections) connection.close();
    for (const peer of peers) await peer.close();
    await rm(root, { recursive: true, force: true });
  });
  return { first, second, host, writes, state, calls, durable: () => durable,
    select(value: typeof first) { selected = value; }, setAuthorized(value: boolean) { authorized = value; } };
}

test('a configuration read source binds both methods to the original connection and home', async t => {
  const h = await fixture(t);
  const [aRead, bRead] = await Promise.all([
    h.first.connection.requestWithCursor('config/read', { includeLayers: true }),
    h.second.connection.requestWithCursor('config/read', { includeLayers: true }),
  ]);
  const versions = [aRead, bRead].map(value => (value.result as { layers: { version: string }[] }).layers[0]!.version);
  assert.deepEqual(versions, ['same-version', 'same-version']);
  assert.notEqual(h.first.source.homeDirectory, h.second.source.homeDirectory);
  assert.notEqual(h.first.source.codexHome, h.second.source.codexHome);
  const original = submit('wrong-source', h.first.source), originalParams = structuredClone(original.params);
  h.select(h.second);
  const mismatch = await h.host.handle(original, context) as ConfigurationWriteSubmitResponse;
  assert.equal(mismatch.outcome, 'not-started');
  if (mismatch.outcome !== 'not-started') return;
  assert.equal(mismatch.error.uncertain, false); assert.match(mismatch.error.message, /Reload/);
  assert.deepEqual(mismatch.operation?.terminal, { kind: 'not-sent' });
  assert.doesNotMatch(JSON.stringify(mismatch), /PRIVATE_SOURCE_MISMATCH/);
  assert.equal(h.first.peer.calls('config/batchWrite').length, 0);
  assert.equal(h.second.peer.calls('config/batchWrite').length, 0);
  const [aSkills, bSkills] = await Promise.all([
    h.first.connection.requestWithCursor('skills/list'), h.second.connection.requestWithCursor('skills/list'),
  ]);
  assert.deepEqual(aSkills.result, bSkills.result);
  const wrongSkill = { hostId, action: 'submit', operationId: 'wrong-skill-source', method: 'skills/config/write',
    params: { name: 'fixture:skill', enabled: false }, source: h.first.source };
  const rejectedSkill = await h.host.handle(wrongSkill, context) as ConfigurationWriteSubmitResponse;
  assert.equal(rejectedSkill.outcome, 'not-started');
  assert.equal(h.second.peer.calls('skills/config/write').length, 0);

  h.select(h.first);
  const exact = await h.host.handle(submit('source-a', h.first.source), context) as ConfigurationWriteSubmitResponse;
  assert.equal(exact.outcome, 'success');
  assert.deepEqual(h.first.peer.calls('config/batchWrite')[0]!.params, originalParams);
  assert.equal(h.second.peer.calls('config/batchWrite').length, 0);
  h.select(h.second);
  const skill = { hostId, action: 'submit', operationId: 'source-b', method: 'skills/config/write',
    params: { name: 'fixture:skill', enabled: false }, source: h.second.source };
  const exactSkill = await h.host.handle(skill, context) as ConfigurationWriteSubmitResponse;
  assert.equal(exactSkill.outcome, 'success');
  assert.deepEqual(h.second.peer.calls('skills/config/write')[0]!.params, skill.params);
  assert.deepEqual(h.calls.map(value => value.source), [h.first.source, h.first.source, h.first.source, h.second.source]);
  assert.doesNotMatch(JSON.stringify(h.durable()), /same-version|generation-home|fixture:skill|fixture\.enabled/);
});

test('invalid source and lost host are known unsent; status and retry need no source', async t => {
  const h = await fixture(t), base = submit('missing-source', h.first.source);
  const attempts = [
    { ...base, source: undefined },
    { ...base, operationId: 'wrong-host', source: { ...h.first.source, hostId: 'another-host' } },
    { ...base, operationId: 'empty-generation', source: { ...h.first.source, generation: '' } },
    { ...base, operationId: 'wrong-generation', source: { ...h.first.source, generation: 'later-socket' } },
    { ...base, operationId: 'wrong-home', source: { ...h.first.source, homeDirectory: h.second.source.homeDirectory } },
    { ...base, operationId: 'wrong-codex-home', source: { ...h.first.source, codexHome: h.second.source.codexHome } },
  ];
  for (const request of attempts) {
    const response = await h.host.handle(request, context) as ConfigurationWriteSubmitResponse;
    assert.equal(response.outcome, 'not-started');
    if (response.outcome !== 'not-started') continue;
    assert.equal(response.error.uncertain, false); assert.match(response.error.message, /Reload/);
    assert.deepEqual(response.operation?.terminal, { kind: 'not-sent' });
  }
  assert.equal(h.calls.length, 3);
  assert.equal(h.first.peer.calls('config/batchWrite').length, 0);
  h.first.connection.close();
  const disconnected = await h.host.handle(submit('disconnected-source', h.first.source), context) as ConfigurationWriteSubmitResponse;
  assert.equal(disconnected.outcome, 'not-started');
  if (disconnected.outcome === 'not-started') assert.deepEqual(disconnected.operation?.terminal, { kind: 'not-sent' });
  h.setAuthorized(false);
  const unavailable = await h.host.handle(submit('host-removed', h.first.source), context) as ConfigurationWriteSubmitResponse;
  assert.equal(unavailable.outcome, 'not-started');
  if (unavailable.outcome === 'not-started') assert.deepEqual(unavailable.operation?.terminal, { kind: 'not-sent' });
  const status = await h.host.handle({ hostId, action: 'status', operationId: 'disconnected-source' }, context);
  const retry = await h.host.handle({ hostId, action: 'retry-persistence', operationId: 'disconnected-source' }, context);
  assert.ok(!('outcome' in status)); assert.deepEqual(status.operation?.terminal, { kind: 'not-sent' });
  assert.ok(!('outcome' in retry)); assert.deepEqual(retry.operation?.terminal, { kind: 'not-sent' });
});

test('reusing an original ID without a source never turns a pending or unknown write into not-sent', async t => {
  const h = await fixture(t), request = submit('original', h.first.source);
  h.first.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const writing = h.host.handle(request, context);
  await h.first.peer.waitForCall('config/batchWrite');
  const duplicate = await h.host.handle({ ...request, source: undefined }, context) as ConfigurationWriteSubmitResponse;
  assert.equal(duplicate.outcome, 'existing'); assert.equal(duplicate.operation?.state, 'pending');
  h.first.peer.disconnect();
  const unknown = await writing as ConfigurationWriteSubmitResponse;
  assert.equal(unknown.outcome, 'unknown'); assert.equal(unknown.operation?.state, 'unknown');
  const again = await h.host.handle({ ...request, source: undefined }, context) as ConfigurationWriteSubmitResponse;
  assert.equal(again.outcome, 'existing'); assert.equal(again.operation?.state, 'unknown');
  const blocked = await h.host.handle({ ...request, operationId: 'another', source: undefined }, context) as ConfigurationWriteSubmitResponse;
  assert.equal(blocked.outcome, 'blocked'); assert.equal(blocked.operation?.operationId, 'original');
  h.setAuthorized(false);
  await assert.rejects(h.host.handle({ ...request, source: undefined }, context), /unavailable or unauthorized/);
  const status = await h.host.handle({ hostId, action: 'status', operationId: 'original' }, context);
  const retry = await h.host.handle({ hostId, action: 'retry-persistence', operationId: 'original' }, context);
  assert.ok(!('outcome' in status)); assert.equal(status.operation?.state, 'unknown');
  assert.ok(!('outcome' in retry)); assert.equal(retry.operation?.state, 'unknown');
  assert.equal(h.calls.length, 1); assert.equal(h.first.peer.calls('config/batchWrite').length, 1);
  assert.equal(h.second.peer.calls('config/batchWrite').length, 0);
});

test('source and CLI parameters are captured before asynchronous host validation', async t => {
  const h = await fixture(t), request = submit('captured-source', { ...h.first.source });
  const expectedSource = structuredClone(request.source), expectedParams = structuredClone(request.params);
  let enter!: () => void, release!: () => void, received: ConfigReadSource | undefined;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const host = createConfigWriteHost<typeof context>({ writes: h.writes,
    async validateHost() { enter(); await hold; },
    async connect(id, value, source) {
      assert.equal(id, hostId); assert.equal(value, context); received = source;
      return { connection: h.first.connection, socket: h.first.connection.socket };
    },
  });
  const writing = host.handle(request, context);
  await entered;
  request.source.generation = 'mutated-generation';
  request.source.homeDirectory = h.second.source.homeDirectory;
  request.params.expectedVersion = 'mutated-version';
  release();
  const result = await writing as ConfigurationWriteSubmitResponse;
  assert.equal(result.outcome, 'success');
  assert.deepEqual(received, expectedSource);
  assert.deepEqual(h.first.peer.calls('config/batchWrite')[0]!.params, expectedParams);
});

test('a socket replaced after source validation is not sent on the replacement', async () => {
  let socket: object = {}, calls = 0, resolved = 0;
  const originalSocket = socket;
  const connection: ConfigWriteConnection = { connected: true, get socket() { return socket; },
    async requestWithCursor() { calls++; return { result: { status: 'ok' }, eventCursor: 1 }; } };
  const writes = createConfigWrites({ state: {}, persist: async () => {}, mutations: createStateMutations(), findFileBlocker: () => false,
    resolveTarget: async () => { resolved++; return { hostKey: 'fixture', target: '/fixture/config.toml', binding: '/fixture/config.toml' }; } });
  const host = createConfigWriteHost<typeof context>({ writes, validateHost() {}, async connect() {
    socket = {}; return { connection, socket: originalSocket };
  } });
  const source = { hostId, generation: 'original', homeDirectory: '/fixture', codexHome: '/fixture/.codex' };
  const result = await host.handle(submit('socket-replaced', source), context) as ConfigurationWriteSubmitResponse;
  assert.equal(result.outcome, 'not-started');
  if (result.outcome === 'not-started') assert.deepEqual(result.operation?.terminal, { kind: 'not-sent' });
  assert.equal(resolved, 0); assert.equal(calls, 0);
});
