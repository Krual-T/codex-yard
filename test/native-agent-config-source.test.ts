import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

const remoteId = 'ssh-fixture';
const managed = (type: string) => ({ name: { type, file: '/private/managed', token: 'ORIGIN_SECRET' }, version: 'managed-version' });
function rawConfig(home: string) {
  return {
    config: { model: 'fixture', profile: 'project-profile', approval_policy: 'never', sandbox_mode: 'workspace-write',
      web_search: 'live', model_verbosity: 'high', model_reasoning_summary: 'detailed',
      sandbox_workspace_write: { writable_roots: ['/fixture/extra', '/fixture/second'], network_access: true,
        exclude_tmpdir_env_var: true, exclude_slash_tmp: false },
      model_providers: { demo: { api_key: 'PROVIDER_SECRET' } }, mcp_servers: { demo: { env: { TOKEN: 'ENV_SECRET' } } } },
    origins: { approval_policy: managed('mdm'), sandbox_workspace_write: managed('sessionFlags'),
      web_search: { name: { type: 'user', file: join(home, 'config.toml'), profile: null }, version: 'v1' },
      model_providers: managed('mdm') },
    layers: [{ name: { type: 'user', file: join(home, 'config.toml'), profile: null }, version: 'v1',
      config: { approval_policy: 'on-request', sandbox_mode: 'workspace-write', web_search: 'cached', model_verbosity: 'low',
        model_reasoning_summary: 'concise', sandbox_workspace_write: { network_access: false }, token: 'LAYER_SECRET' } },
    { name: { type: 'project', file: '/private/project' }, version: 'project-v1', config: { token: 'PROJECT_SECRET' } }],
  };
}

async function fixture(t: TestContext, versions = { local: '0.141.0', remote: '0.164.0' }) {
  const root = await mkdtemp(join(tmpdir(), 'fg-'));
  const localRoot = join(root, 'l'), remoteRoot = join(root, 'r');
  const localHome = join(localRoot, 'codex'), remoteHome = join(remoteRoot, 'codex');
  await mkdir(localHome, { recursive: true }); await mkdir(remoteHome, { recursive: true });
  await writeFile(join(localHome, 'config.toml'), 'model = "fixture"\n');
  await writeFile(join(remoteHome, 'config.toml'), 'model = "fixture"\n');
  const local = await createFakeCodex(localRoot), remote = await createFakeCodex(remoteRoot);
  local.handlers.set('initialize', () => ({ userAgent: `codex/${versions.local}`, codexHome: localHome }));
  remote.handlers.set('initialize', () => ({ userAgent: `codex/${versions.remote}`, codexHome: remoteHome }));
  local.handlers.set('config/read', () => rawConfig(localHome));
  remote.handlers.set('config/read', () => rawConfig(remoteHome));
  local.handlers.set('config/batchWrite', () => ({ status: 'ok', version: 'v2' }));
  const assets = await nativeFixture(root);
  const app = await createNativeWorkbench({ ...assets, socketPath: local.socketPath, codexHome: localHome,
    dataDir: join(root, 'data'), workspace: root, port: 0,
    hostCatalog: { hosts: [{ hostId: remoteId, displayName: 'Fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }],
      projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: remoteRoot, codexHome: remoteHome }); return createConnection(remote.socketPath); },
  });
  const socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
  const messages: Record<string, any>[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  t.after(async () => { socket.terminate(); await app.close(); await local.close(); await remote.close(); await rm(root, { recursive: true, force: true }); });
  let nextId = 0;
  async function until(predicate: (message: Record<string, any>) => boolean) {
    const timeout = AbortSignal.timeout(5000);
    while (!messages.some(predicate)) await once(socket, 'received', { signal: timeout });
    return messages.find(predicate)!;
  }
  async function rpc(method: string, params: Record<string, unknown> = {}, hostId = 'local') {
    const id = ++nextId;
    socket.send(JSON.stringify({ type: 'mcp-request', hostId, request: { id, method, params } }));
    return (await until(message => message.type === 'mcp-response' && message.hostId === hostId && message.message.id === id)).message;
  }
  async function write(operationId: string, source: unknown) {
    const requestId = 'write-' + ++nextId;
    socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/configuration-write', body: JSON.stringify({
      hostId: 'local', action: 'submit', operationId, method: 'config/batchWrite', source,
      params: { edits: [{ keyPath: 'web_search', value: 'cached', mergeStrategy: 'upsert' }],
        filePath: null, expectedVersion: 'v1', reloadUserConfig: true },
    }) }));
    const response = await until(message => message.type === 'fetch-response' && message.requestId === requestId);
    assert.equal(response.responseType, 'success', JSON.stringify(response));
    return response.body;
  }
  return { root, local, remote, localHome, remoteHome, app, rpc, write };
}

test('actual host projects each original connection and preserves the four workspace fields', async t => {
  const h = await fixture(t);
  const local = await h.rpc('config/read', { includeLayers: true });
  const remote = await h.rpc('config/read', { includeLayers: true }, remoteId);
  for (const [reply, home, hostId, supportsIndexed] of [[local, h.localHome, 'local', false], [remote, h.remoteHome, remoteId, true]] as const) {
    assert.equal(reply.error, undefined, JSON.stringify(reply));
    const { config, yardAgentConfiguration, yardConfigSource, layers, origins } = reply.result;
    assert.equal(yardConfigSource.hostId, hostId); assert.equal(yardConfigSource.codexHome, home);
    assert.equal(yardAgentConfiguration.supportsIndexedWebSearch, supportsIndexed);
    assert.deepEqual(yardAgentConfiguration.base, { approval_policy: 'on-request', sandbox_mode: 'workspace-write',
      web_search: 'cached', model_verbosity: 'low', model_reasoning_summary: 'concise',
      sandbox_workspace_write: { network_access: false } });
    assert.deepEqual(yardAgentConfiguration.lockedKeys, ['approval_policy', 'sandbox_workspace_write.network_access']);
    assert.deepEqual(config.sandbox_workspace_write, { writable_roots: ['/fixture/extra', '/fixture/second'], network_access: true,
      exclude_tmpdir_env_var: true, exclude_slash_tmp: false });
    assert.equal(config.approval_policy, 'never'); assert.equal(config.web_search, 'live');
    assert.equal(config.model_verbosity, 'high'); assert.equal(config.model_reasoning_summary, 'detailed');
    assert.deepEqual(layers, [{ name: { type: 'user', file: join(home, 'config.toml'), profile: null }, version: 'v1' }]);
    assert.deepEqual(origins, {});
    assert.doesNotMatch(JSON.stringify(reply), /SECRET|\/private\/managed|\/private\/project|model_providers|mcp_servers/);
  }
  assert.notEqual(local.result.yardConfigSource.generation, remote.result.yardConfigSource.generation);
  assert.equal(h.local.calls('config/read').length, 1); assert.equal(h.remote.calls('config/read').length, 1);
});

test('missing layers or unknown version never invent a base', async t => {
  const h = await fixture(t, { local: 'not-a-version', remote: '0.164.0' });
  const unknown = await h.rpc('config/read', { includeLayers: true });
  assert.equal(unknown.result.yardAgentConfiguration.base, null);
  assert.equal(unknown.result.yardAgentConfiguration.supportsIndexedWebSearch, false);
  assert.equal(unknown.result.config.web_search, 'live');
  h.remote.handlers.set('config/read', () => ({ ...rawConfig(h.remoteHome), layers: null }));
  const missing = await h.rpc('config/read', { includeLayers: false }, remoteId);
  assert.equal(missing.result.yardAgentConfiguration.base, null);
  assert.equal(missing.result.yardAgentConfiguration.supportsIndexedWebSearch, true);
  assert.deepEqual(missing.result.config.sandbox_workspace_write, { writable_roots: ['/fixture/extra', '/fixture/second'],
    network_access: true, exclude_tmpdir_env_var: true, exclude_slash_tmp: false });
});

test('a daemon home that differs from the selected host is not a verified base', async t => {
  for (const daemonHome of ['/different/codex', undefined]) await t.test(String(daemonHome), async t => {
    const h = await fixture(t);
    h.remote.handlers.set('initialize', () => ({ userAgent: 'codex/0.164.0', codexHome: daemonHome }));
    const changed = await h.rpc('config/read', { includeLayers: true }, remoteId);
    assert.equal(changed.result.yardAgentConfiguration.base, null);
    assert.equal(changed.result.yardConfigSource.codexHome, h.remoteHome);
  });
});

test('invalid workspace structures are rejected without filtering or exposing their contents', async t => {
  const h = await fixture(t);
  for (const sandbox of [
    { writable_roots: ['/fixture/kept', 42] }, { writable_roots: 'not-an-array' },
    { network_access: 'INVALID_SECRET' }, { exclude_tmpdir_env_var: 1 },
    { exclude_slash_tmp: null }, { writable_roots: [], extra_policy: 'EXTRA_SECRET' }, ['INVALID_SECRET'],
  ]) {
    h.local.handlers.set('config/read', () => ({ ...rawConfig(h.localHome),
      config: { ...rawConfig(h.localHome).config, sandbox_workspace_write: sandbox } }));
    const result = await h.rpc('config/read', { includeLayers: true });
    assert.match(result.error?.message ?? '', /sandbox configuration cannot be safely represented/);
    assert.equal(result.result, undefined);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|fixture\/kept/);
  }
});

test('malformed agent values do not survive the effective replacement', async t => {
  const h = await fixture(t);
  h.local.handlers.set('config/read', () => ({ ...rawConfig(h.localHome), config: { ...rawConfig(h.localHome).config,
    model_verbosity: 'UNKNOWN_SECRET' } }));
  const result = await h.rpc('config/read', { includeLayers: true });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.result.yardAgentConfiguration.base, null);
  assert.equal(Object.hasOwn(result.result.config, 'model_verbosity'), false);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  for (const patch of [
    { approval_policy: { granular: { rules: true, api_key: 'POLICY_SECRET' } } },
    { sandbox_mode: 'MODE_SECRET' },
  ]) {
    h.local.handlers.set('config/read', () => ({ ...rawConfig(h.localHome), config: { ...rawConfig(h.localHome).config, ...patch } }));
    const rejected = await h.rpc('config/read', { includeLayers: true });
    assert.match(rejected.error?.message ?? '', /approval or sandbox configuration cannot be safely represented/);
    assert.equal(rejected.result, undefined); assert.doesNotMatch(JSON.stringify(rejected), /SECRET/);
  }
});

test('a changed daemon version or home during a held read is rejected', async t => {
  const h = await fixture(t);
  const original = h.app.control.server;
  assert.ok(original);
  for (const changed of [{ userAgent: 'codex/0.164.0' }, { codexHome: '/changed/codex' }]) {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.local.handlers.set('config/read', async () => { enter(); await gate; return rawConfig(h.localHome); });
    const pending = h.rpc('config/read', { includeLayers: true });
    await entered;
    h.app.control.server = { ...original, ...changed };
    release();
    const reply = await pending;
    assert.match(reply.error?.message ?? '', /source changed while reading/);
    assert.equal(reply.result, undefined);
    h.app.control.server = original;
  }
});

test('a disconnected original read cannot authorize a write after reconnection', async t => {
  const h = await fixture(t, { local: '0.164.0', remote: '0.164.0' });
  const before = await h.rpc('config/read', { includeLayers: true });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let hold = true;
  h.local.handlers.set('config/read', async () => { if (hold) { hold = false; enter(); await gate; } return rawConfig(h.localHome); });
  const pending = h.rpc('config/read', { includeLayers: true });
  await entered;
  h.local.disconnectAll();
  const failed = await pending; release();
  assert.ok(failed.error, JSON.stringify(failed)); assert.equal(failed.result, undefined);
  const after = await h.rpc('config/read', { includeLayers: true });
  assert.equal(after.error, undefined, JSON.stringify(after));
  assert.notEqual(after.result.yardConfigSource.generation, before.result.yardConfigSource.generation);
  const stale = await h.write('stale-source', before.result.yardConfigSource);
  assert.equal(stale.outcome, 'not-started'); assert.equal(stale.operation.terminal.kind, 'not-sent');
  assert.equal(h.local.calls('config/batchWrite').length, 0);
  const direct = await h.rpc('config/batchWrite', {});
  assert.match(direct.error?.message ?? '', /original operation ID/);
  assert.equal(h.local.calls('config/batchWrite').length, 0);
  const saved = await h.write('current-source', after.result.yardConfigSource);
  assert.equal(saved.outcome, 'success', JSON.stringify(saved));
  assert.equal(h.local.calls('config/batchWrite').length, 1);
});
