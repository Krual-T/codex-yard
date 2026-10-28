import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import { CodexConnection } from '../lib/codex.ts';
import { createConfigWriteTargets } from '../src/native/config-write-targets.ts';
import { createConfigWrites } from '../src/native/config-writes.ts';
import type { ConfigWriteConnection } from '../src/native/config-writes.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import type { HostPaths, SshHost } from '../src/native/ssh.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';

const run = promisify(execFile);
const batch = () => ({ filePath: null, expectedVersion: 'fixture-version', reloadUserConfig: true,
  edits: [{ keyPath: 'approval_policy', value: 'never', mergeStrategy: 'upsert' }] });

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-config-target-');
  const home = join(root, "codex space 'quoted'"), secondHome = join(root, 'second-home');
  await Promise.all([mkdir(home), mkdir(secondHome)]);
  const config = join(home, 'config.toml'), secondConfig = join(secondHome, 'config.toml');
  const paths = new Map<ConfigWriteConnection, HostPaths>();
  const host: SshHost = { hostId: 'remote-ssh-fixture', displayName: 'loopback fixture', sshAlias: null,
    sshHost: 'fixture.invalid', sshPort: 22, identity: null };
  const hosts = new Map([[host.hostId, host]]), peers: Awaited<ReturnType<typeof createFakeCodex>>[] = [];
  const connections: CodexConnection[] = [];
  let commands = 0;
  const resolveTarget = createConfigWriteTargets({ getConnectionSnapshot: ({ hostId, connection }) => {
    const selectedPaths = paths.get(connection);
    return selectedPaths ? { paths: selectedPaths, ...(hosts.has(hostId) ? { sshHost: hosts.get(hostId) } : {}) } : undefined;
  },
    remoteCommand: async (selected, command, maxBytes, signal) => {
      assert.deepEqual(selected, host); commands++;
      const { stdout } = await run('/bin/sh', ['-c', command], { encoding: 'buffer', maxBuffer: maxBytes, signal });
      return stdout;
    },
  });
  async function connect(codexHome = home) {
    const peerRoot = join(root, `peer-${peers.length}`); await mkdir(peerRoot);
    const peer = await createFakeCodex(peerRoot); peers.push(peer);
    peer.handlers.set('initialize', () => ({ userAgent: 'config-target-fixture', codexHome }));
    peer.handlers.set('config/read', () => ({ config: {}, layers: [
      { name: { type: 'user', file: join(codexHome, 'config.toml'), profile: null }, version: 'fixture-version' },
      { name: { type: 'system', file: '/etc/codex/config.toml' }, version: 'system-version' },
    ] }));
    const connection = new CodexConnection(peer.socketPath, { timeout: 400 });
    connections.push(connection); await connection.connect();
    paths.set(connection, { homeDirectory: root, codexHome });
    return { peer, connection };
  }
  t.after(async () => {
    for (const connection of connections) connection.close();
    for (const peer of peers) await peer.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, home, secondHome, config, secondConfig, paths, host, hosts, resolveTarget, connect, get commands() { return commands; } };
}

test('the real connection selects the verified base layer and resolves a missing creatable config without writing it', async t => {
  const h = await fixture(t), { connection, peer } = await h.connect();
  const original = batch(), snapshot = structuredClone(original);
  const target = await h.resolveTarget({ hostId: 'local', method: 'config/batchWrite', params: original, connection });
  assert.deepEqual(target, { hostKey: 'global-config-writes', target: h.config, binding: h.config, scope: 'global' });
  assert.deepEqual(original, snapshot);
  assert.deepEqual(peer.calls('config/read')[0]!.params, { includeLayers: true });
  await assert.rejects(readFile(h.config), { code: 'ENOENT' });
  const explicit = await h.resolveTarget({ hostId: 'local', method: 'config/batchWrite', params: { ...original, filePath: h.config }, connection });
  assert.equal(explicit.target, h.config);
  const remote = await h.resolveTarget({ hostId: h.host.hostId, method: 'skills/config/write', params: { name: 'fixture:skill', enabled: false }, connection });
  assert.deepEqual(remote, target);
  assert.equal(h.commands, 1);
  await assert.rejects(readFile(h.config), { code: 'ENOENT' });
});

test('local and registered SSH resolve symlinks, hardlinks and retargeted paths while retaining the original binding', async t => {
  const h = await fixture(t), { connection } = await h.connect(), second = await h.connect(h.secondHome);
  const firstTarget = join(h.root, 'first.toml'), laterTarget = join(h.root, 'later.toml');
  await writeFile(firstTarget, 'fixture = true\n'); await writeFile(laterTarget, 'fixture = false\n');
  await symlink(firstTarget, h.config); await link(firstTarget, h.secondConfig);
  const local = await h.resolveTarget({ hostId: 'local', method: 'config/batchWrite', params: batch(), connection });
  const remote = await h.resolveTarget({ hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection });
  const hard = await h.resolveTarget({ hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection: second.connection });
  assert.equal(local.target, await realpath(firstTarget)); assert.equal(local.binding, h.config);
  assert.deepEqual(remote, local); assert.equal(hard.target, h.secondConfig);
  assert.equal(hard.scope, 'global');
  await unlink(h.config); await symlink(laterTarget, h.config);
  const moved = await h.resolveTarget({ hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection });
  assert.equal(moved.target, await realpath(laterTarget)); assert.equal(moved.binding, local.binding);
});

test('same registered host keeps paths bound to each original connection and socket', async t => {
  const h = await fixture(t), first = await h.connect(), second = await h.connect(h.secondHome);
  const secondTarget = await h.resolveTarget({ hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection: second.connection });
  const firstTarget = await h.resolveTarget({ hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection: first.connection });
  assert.equal(firstTarget.binding, h.config);
  assert.equal(secondTarget.binding, h.secondConfig);
  assert.equal(firstTarget.scope, 'global'); assert.equal(secondTarget.scope, 'global');
});

test('a socket generation change while obtaining the connection snapshot rejects before config/read', async t => {
  const h = await fixture(t);
  let socket: object = {}, release!: () => void, entered!: () => void, reads = 0;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const connection: ConfigWriteConnection = { connected: true, get socket() { return socket; }, server: { codexHome: h.home },
    async requestWithCursor() { reads++; return { result: {}, eventCursor: 0 }; } };
  const resolver = createConfigWriteTargets({ async getConnectionSnapshot(input) {
    assert.equal(input.socket, socket); entered(); await wait;
    return { paths: { homeDirectory: h.root, codexHome: h.home } };
  } });
  const resolving = resolver({ hostId: 'local', method: 'config/batchWrite', params: batch(), connection });
  await started; socket = {}; release();
  await assert.rejects(resolving, /connection changed/);
  assert.equal(reads, 0);
});

test('one service fences actual local and SSH requests across methods, hardlinks, retargeting and restart', async t => {
  const h = await fixture(t), first = await h.connect(), second = await h.connect(h.secondHome);
  const later = join(h.root, 'later.toml'), actual = join(h.root, 'actual.toml');
  await writeFile(actual, 'fixture = true\n'); await writeFile(later, 'fixture = false\n');
  await symlink(actual, h.config); await link(actual, h.secondConfig);
  const state: Record<string, unknown> = {}, stateFile = join(h.root, 'native-state.json');
  const persist = async () => { await writeFile(stateFile + '.tmp', JSON.stringify(state)); await rename(stateFile + '.tmp', stateFile); };
  const options = { state, persist, mutations: createStateMutations(), resolveTarget: h.resolveTarget, findFileBlocker: () => false };
  const writes = createConfigWrites(options), original = batch(), snapshot = structuredClone(original);
  first.peer.handlers.set('config/batchWrite', () => NO_REPLY);
  const submitted = await writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: original, connection: first.connection });
  assert.equal(submitted.outcome, 'started'); if (submitted.outcome !== 'started') return;
  await first.peer.waitForCall('config/batchWrite');
  assert.deepEqual(first.peer.calls('config/batchWrite')[0]!.params, snapshot);
  const skillParams = { path: join(h.root, 'skill', 'SKILL.md'), enabled: false };
  const blocked = await writes.submit({ operationId: randomUUID(), hostId: h.host.hostId, method: 'skills/config/write', params: skillParams, connection: second.connection });
  assert.equal(blocked.outcome, 'blocked'); assert.equal(blocked.operation.operationId, submitted.operation.operationId);
  assert.equal(blocked.operation.binding, h.config); assert.equal(second.peer.calls('skills/config/write').length, 0);
  await unlink(h.config); await symlink(later, h.config);
  const afterMove = await writes.submit({ operationId: randomUUID(), hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection: first.connection });
  assert.equal(afterMove.outcome, 'blocked'); assert.equal(afterMove.operation.operationId, submitted.operation.operationId);
  await unlink(h.config);
  await rename(h.home, h.home + '-unavailable');
  const unavailable = await writes.submit({ operationId: randomUUID(), hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection: first.connection });
  assert.equal(unavailable.outcome, 'blocked'); assert.equal(unavailable.operation.operationId, submitted.operation.operationId);
  const disconnected = await h.connect(h.secondHome); disconnected.connection.close();
  const offline = await writes.submit({ operationId: randomUUID(), hostId: h.host.hostId, method: 'skills/config/write', params: skillParams, connection: disconnected.connection });
  assert.equal(offline.outcome, 'blocked'); assert.equal(offline.operation.operationId, submitted.operation.operationId);
  assert.equal((await submitted.completion).outcome, 'unknown');
  const restored = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
  const recovered = createConfigWrites({ ...options, state: restored, mutations: createStateMutations() });
  assert.equal((await recovered.status(submitted.operation.operationId))?.state, 'unknown');
  const blockedAfterRestart = await recovered.submit({ operationId: randomUUID(), hostId: h.host.hostId, method: 'skills/config/write', params: skillParams, connection: second.connection });
  assert.equal(blockedAfterRestart.outcome, 'blocked'); assert.equal(blockedAfterRestart.operation.operationId, submitted.operation.operationId);
  assert.equal(second.peer.calls('skills/config/write').length, 0);
});

test('legacy unfinished records remain readable and block a newly resolved global target', async t => {
  const h = await fixture(t), { connection } = await h.connect();
  const state: Record<string, unknown> = { configWriteOperations: [{ operationId: 'previous-operation', hostId: 'old-host',
    hostKey: 'old-host-key', target: '/different/config.toml', binding: '/different/config.toml', state: 'pending' }] };
  const writes = createConfigWrites({ state, persist: async () => {}, mutations: createStateMutations(), resolveTarget: h.resolveTarget, findFileBlocker: () => false });
  assert.equal((await writes.status('previous-operation'))?.state, 'unknown');
  connection.close();
  const result = await writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: batch(), connection });
  assert.equal(result.outcome, 'blocked'); assert.equal(result.operation.operationId, 'previous-operation');
});

test('only the original late terminal releases a global record for the next method', async t => {
  const h = await fixture(t), first = await h.connect(), second = await h.connect(h.secondHome);
  const state: Record<string, unknown> = {};
  const writes = createConfigWrites({ state, persist: async () => {}, mutations: createStateMutations(), resolveTarget: h.resolveTarget, findFileBlocker: () => false });
  let reply: (() => void) | undefined;
  first.peer.handlers.set('config/batchWrite', (_params, context) => {
    reply = () => context.send({ id: context.message.id, result: { status: 'ok' } }); return NO_REPLY;
  });
  const started = await writes.submit({ operationId: randomUUID(), hostId: 'local', method: 'config/batchWrite', params: batch(), connection: first.connection });
  assert.equal(started.outcome, 'started'); if (started.outcome !== 'started') return;
  assert.equal((await started.completion).outcome, 'unknown');
  const input = { operationId: randomUUID(), hostId: h.host.hostId, method: 'skills/config/write' as const, params: { name: 'fixture:skill', enabled: false }, connection: second.connection };
  assert.equal((await writes.submit(input)).outcome, 'blocked');
  assert.ok(reply); reply();
  const deadline = Date.now() + 3000;
  while ((await writes.status(started.operation.operationId))?.state !== 'succeeded') {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the original terminal');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  second.peer.handlers.set('skills/config/write', () => ({ effectiveEnabled: false }));
  const next = await writes.submit(input);
  assert.equal(next.outcome, 'started'); if (next.outcome === 'started') assert.equal((await next.completion).outcome, 'success');
  assert.equal(second.peer.calls('skills/config/write').length, 1);
});

test('unregistered hosts, different homes, ambiguous layers, unverified methods and targets fail before any write', async t => {
  const h = await fixture(t), { peer, connection } = await h.connect();
  const submit = (params: Record<string, unknown> = batch()) => h.resolveTarget({ hostId: 'local', method: 'config/batchWrite', params, connection });
  await assert.rejects(h.resolveTarget({ hostId: 'remote-ssh-unknown', method: 'config/batchWrite', params: batch(), connection }), /not registered/);
  h.paths.set(connection, { homeDirectory: h.root, codexHome: h.secondHome });
  await assert.rejects(submit(), /does not match/);
  h.paths.set(connection, { homeDirectory: h.root, codexHome: h.home });
  await assert.rejects(submit({ ...batch(), filePath: h.secondConfig }), /not the verified/);
  await assert.rejects(h.resolveTarget({ hostId: 'local', method: 'config/value/write' as never, params: {}, connection }), /not verified/);
  await assert.rejects(h.resolveTarget({ hostId: 'local', method: 'skills/config/write', params: { enabled: false }, connection }), /selector/);
  await assert.rejects(h.resolveTarget({ hostId: 'local', method: 'skills/config/write', params: { name: 'a', path: '/b', enabled: false }, connection }), /selector/);
  peer.handlers.set('config/read', () => ({ layers: [
    { name: { type: 'user', file: h.config, profile: null }, version: 'v1' },
    { name: { type: 'user', file: h.secondConfig, profile: null }, version: 'v2' },
  ] }));
  await assert.rejects(submit(), /ambiguous/);
  peer.handlers.set('config/read', () => ({ layers: [{ name: { type: 'user', file: h.config, profile: 'other' }, version: 'v1' }] }));
  await assert.rejects(submit(), /ambiguous/);
  peer.handlers.set('config/read', () => ({ layers: [{ name: { type: 'user', file: h.config, profile: null }, version: '' }] }));
  await assert.rejects(submit(), /ambiguous/);
  assert.equal(peer.calls('config/batchWrite').length, 0); assert.equal(peer.calls('skills/config/write').length, 0);
});

test('dangling links, non-files, missing parents and malformed SSH output are rejected', async t => {
  const h = await fixture(t), { connection } = await h.connect();
  await symlink(join(h.root, 'missing-target'), h.config);
  await assert.rejects(h.resolveTarget({ hostId: 'local', method: 'config/batchWrite', params: batch(), connection }));
  await assert.rejects(h.resolveTarget({ hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection }));
  await unlink(h.config); await mkdir(h.config);
  await assert.rejects(h.resolveTarget({ hostId: 'local', method: 'config/batchWrite', params: batch(), connection }), /not a regular file/);
  const invalid = createConfigWriteTargets({ getConnectionSnapshot: ({ hostId, connection }) => {
    const paths = h.paths.get(connection); return paths ? { paths, sshHost: h.hosts.get(hostId) } : undefined;
  }, remoteCommand: async () => Buffer.from('file\0/truncated') });
  await assert.rejects(invalid({ hostId: h.host.hostId, method: 'config/batchWrite', params: batch(), connection }), /invalid/);
  const missingHome = join(h.root, 'missing-home');
  const missing = await h.connect(missingHome);
  await assert.rejects(h.resolveTarget({ hostId: 'local', method: 'config/batchWrite', params: batch(), connection: missing.connection }));
});

test('literal backslash-zero is a valid Linux path while an actual NUL is rejected', async t => {
  const h = await fixture(t), unusualHome = join(h.root, 'literal\\0path');
  await mkdir(unusualHome);
  const unusual = await h.connect(unusualHome);
  const input = { hostId: 'local', method: 'config/batchWrite' as const, params: batch(), connection: unusual.connection };
  const local = await h.resolveTarget(input);
  assert.equal(local.binding, join(unusualHome, 'config.toml'));
  const ssh = await h.resolveTarget({ ...input, hostId: h.host.hostId });
  assert.equal(ssh.binding, local.binding); assert.equal(ssh.target, local.target);
  const writes = createConfigWrites({ state: {}, persist: async () => {}, mutations: createStateMutations(), resolveTarget: h.resolveTarget, findFileBlocker: () => false });
  unusual.peer.handlers.set('config/batchWrite', () => ({ status: 'ok' }));
  const started = await writes.submit({ ...input, operationId: 'literal-backslash' });
  assert.equal(started.outcome, 'started');
  if (started.outcome === 'started') assert.equal((await started.completion).outcome, 'success');
  h.paths.set(unusual.connection, { homeDirectory: h.root, codexHome: unusualHome + '\0invalid' });
  await assert.rejects(h.resolveTarget(input), /unavailable or ambiguous/);
  await assert.rejects(writes.status('invalid\0operation'), /Invalid configuration write operation/);
});
