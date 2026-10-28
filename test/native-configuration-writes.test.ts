import assert from 'node:assert/strict';
import { once } from 'node:events';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';
import { fileMethods } from '../src/native/files.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';

async function fixture(t: import('node:test').TestContext, initialState: Record<string, unknown> = {}) {
  const root = await mkdtemp('/tmp/yard-config-host-'), codexHome = join(root, 'codex'), dataDir = join(root, 'data');
  await mkdir(codexHome); await mkdir(dataDir);
  const file = join(codexHome, 'config.toml');
  await writeFile(file, 'model = "fixture"\n');
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: { retained: 'global' }, settings: {}, future: { retained: true }, ...initialState }));
  const fake = await createFakeCodex(root), assets = await nativeFixture(root);
  const fileRpc = fileDaemonFixture();
  for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, params as Record<string, unknown>));
  fake.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome }));
  fake.handlers.set('config/read', () => ({ config: {}, origins: {}, layers: [{ name: { type: 'user', file, profile: null }, version: 'v1' }] }));
  const options = { ...assets, socketPath: fake.socketPath, codexHome, dataDir, workspace: root, hostCatalog: { hosts: [], projects: [], assignments: {} }, port: 0 };
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench(options);
  async function connect() {
    const socket = new WebSocket(app!.url.replace('http', 'ws') + '/native-host', { origin: app!.url });
    sockets.push(socket);
    const messages: any[] = [];
    socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
    await once(socket, 'open');
    let id = 0;
    async function until(predicate: (value: any) => boolean) {
      while (!messages.some(predicate)) await once(socket, 'received', { signal: AbortSignal.timeout(5000) });
      return messages.find(predicate);
    }
    async function fetchHost(endpoint: string, value: Record<string, unknown>) {
        const requestId = String(++id);
        socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify({ hostId: 'local', ...value }) }));
        return until(value => value.type === 'fetch-response' && value.requestId === requestId);
    }
    return {
      socket, fetchHost,
      async host(value: Record<string, unknown>) {
        if (value.action === 'submit' && !Object.hasOwn(value, 'source')) {
          const requestId = ++id;
          socket.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id: requestId, method: 'config/read', params: {} } }));
          const read = (await until(value => value.type === 'mcp-response' && value.message.id === requestId)).message;
          assert.ok(read.result?.yardConfigSource);
          value = { ...value, source: read.result.yardConfigSource };
        }
        const response = await fetchHost('configuration-write', value);
        assert.equal(response.responseType, 'success', JSON.stringify(response));
        return response.body;
      },
      async rpc(method: string) {
        const requestId = ++id;
        socket.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id: requestId, method, params: {} } }));
        return (await until(value => value.type === 'mcp-response' && value.message.id === requestId)).message;
      },
    };
  }
  return { fake, file, dataDir, root, fileRpc, connect, async restart() {
    for (const socket of sockets) socket.terminate();
    await app!.close(); app = await createNativeWorkbench(options);
  } };
}

test('actual configuration host requires operation IDs, preserves terminal outcomes and reloads the same native-state', async t => {
  const h = await fixture(t), client = await h.connect();
  const params = { edits: [{ keyPath: 'model', value: 'fixture-new', mergeStrategy: 'replace' }], filePath: null, expectedVersion: 'v1', reloadUserConfig: true };
  h.fake.handlers.set('config/batchWrite', () => ({ status: 'okOverridden' }));
  h.fake.handlers.set('skills/config/write', () => ({ effectiveEnabled: false }));
  for (const method of ['config/batchWrite', 'skills/config/write']) {
    assert.match((await client.rpc(method)).error.message, /operation ID/);
    assert.equal(h.fake.messages.filter(message => message.method === method).length, 0);
  }
  const saved = await client.host({ action: 'submit', operationId: 'model-original', method: 'config/batchWrite', params });
  assert.equal(saved.outcome, 'success'); assert.deepEqual(saved.result, { status: 'okOverridden' });
  assert.equal(saved.operation.terminal.kind, 'okOverridden');
  assert.deepEqual(h.fake.messages.find(message => message.method === 'config/batchWrite')!.params, params);
  const skill = await client.host({ action: 'submit', operationId: 'skill-original', method: 'skills/config/write', params: { name: 'fixture', enabled: false } });
  assert.equal(skill.outcome, 'success'); assert.deepEqual(skill.result, { effectiveEnabled: false });
  assert.deepEqual(skill.operation.terminal, { kind: 'effectiveEnabled', value: false });
  const persisted = JSON.parse(await readFile(join(h.dataDir, 'native-state.json'), 'utf8'));
  assert.deepEqual(persisted.future, { retained: true }); assert.equal(persisted.globals.retained, 'global');
  assert.equal(persisted.configWriteOperations.length, 2);
  await h.restart();
  const next = await h.connect(), before = h.fake.messages.length;
  const status = await next.host({ action: 'status', operationId: 'model-original' });
  assert.equal(status.operation.state, 'succeeded'); assert.equal(status.operation.terminal.kind, 'okOverridden');
  assert.equal(h.fake.messages.length, before, 'a status read does not establish a backend connection');
  assert.equal((await next.host({ action: 'submit', operationId: 'model-original', method: 'config/batchWrite', params })).outcome, 'existing');
  assert.equal(h.fake.messages.filter(message => message.method === 'config/batchWrite').length, 1);
});

test('configuration reads and writes bind the same owned socket and reject changed home or generation before dispatch', async t => {
  const h = await fixture(t), client = await h.connect();
  let originalReadSocket: WebSocket | undefined, writeSocket: WebSocket | undefined;
  h.fake.handlers.set('config/read', (_params, { socket }) => {
    originalReadSocket = socket;
    return { config: {}, layers: [{ name: { type: 'user', file: h.file, profile: null }, version: 'v1' }] };
  });
  h.fake.handlers.set('config/batchWrite', (params, { socket }) => {
    writeSocket = socket;
    assert.equal(params.source, undefined, 'the Yard source envelope is not a CLI config key');
    return { status: 'ok' };
  });
  const source = (await client.rpc('config/read')).result.yardConfigSource;
  assert.equal(source.hostId, 'local'); assert.equal(source.codexHome, join(h.root, 'codex'));
  const original = originalReadSocket;
  const params = { edits: [{ keyPath: 'model', value: 'same-version', mergeStrategy: 'replace' }], filePath: null, expectedVersion: 'v1', reloadUserConfig: true };
  for (const [id, invalid] of [
    ['home', { ...source, codexHome: join(h.root, 'another-home') }],
    ['generation', { ...source, generation: 'another-socket' }], ['missing', undefined],
  ] as const) {
    const result = await client.host({ action: 'submit', operationId: id, method: 'config/batchWrite', params, source: invalid });
    assert.equal(result.outcome, 'not-started'); assert.equal(result.error.uncertain, false);
  }
  assert.equal(h.fake.calls('config/batchWrite').length, 0);
  assert.equal((await client.host({ action: 'submit', operationId: 'same-source', method: 'config/batchWrite', params, source })).outcome, 'success');
  assert.equal(writeSocket, original);
  const closed = once(original!, 'close'); original!.terminate(); await closed;
  let reread = await client.rpc('config/read');
  if (reread.error) {
    // Closing the peer is observable before the host has consumed its close
    // event. An explicit read may fail; it must not turn into a queued write.
    assert.match(reread.error.message, /断开|connection|connect|socket|closed/i);
    assert.equal(h.fake.calls('config/batchWrite').length, 1);
    reread = await client.rpc('config/read');
  }
  assert.equal(reread.error, undefined);
  const next = reread.result.yardConfigSource;
  assert.notEqual(next.generation, source.generation);
  const stale = await client.host({ action: 'submit', operationId: 'old-after-reconnect', method: 'config/batchWrite', params, source });
  assert.equal(stale.outcome, 'not-started'); assert.equal(h.fake.calls('config/batchWrite').length, 1);
});

test('closing the submitting page retains the host-owned original configuration connection and terminal', async t => {
  const h = await fixture(t), client = await h.connect();
  let original: WebSocket | undefined;
  h.fake.handlers.set('config/batchWrite', (_params, { socket }) => { original = socket; return NO_REPLY; });
  const params = { edits: [{ keyPath: 'model', value: 'fixture-new', mergeStrategy: 'replace' }], filePath: null, expectedVersion: 'v1', reloadUserConfig: true };
  const source = (await client.rpc('config/read')).result.yardConfigSource;
  client.socket.send(JSON.stringify({ type: 'fetch', requestId: 'closing', url: 'vscode://codex/configuration-write',
    body: JSON.stringify({ hostId: 'local', action: 'submit', operationId: 'closing-original', method: 'config/batchWrite', params, source }) }));
  const call = await h.fake.waitForCall('config/batchWrite');
  assert.ok(call);
  const closed = once(client.socket, 'close'); client.socket.close(); await closed;
  assert.equal(original!.readyState, WebSocket.OPEN, 'the page does not own this write connection');
  original!.send(JSON.stringify({ id: call.id, result: { status: 'ok' } }));
  const another = await h.connect();
  assert.equal((await another.host({ action: 'status', operationId: 'closing-original' })).operation.state, 'succeeded');
  await h.restart();
  assert.equal((await (await h.connect()).host({ action: 'status', operationId: 'closing-original' })).operation.terminal.kind, 'ok');
  assert.equal(h.fake.calls('config/batchWrite').length, 1);
});

test('configuration and file saves reserve their shared fence before either backend write', async t => {
  const h = await fixture(t), client = await h.connect();
  const params = { edits: [{ keyPath: 'model', value: 'fixture-new', mergeStrategy: 'replace' }], filePath: null, expectedVersion: 'v1', reloadUserConfig: true };
  let original: WebSocket | undefined;
  h.fake.handlers.set('config/batchWrite', (_params, { socket }) => { original = socket; return NO_REPLY; });
  const configuration = client.host({ action: 'submit', operationId: 'config-first', method: 'config/batchWrite', params });
  const configCall = await h.fake.waitForCall('config/batchWrite');
  assert.ok(configCall);
  const expectedContents = await readFile(h.file, 'utf8');
  const blockedFile = await client.fetchHost('workspace-file-save', { cwd: h.root, path: h.file,
    operationId: 'file-blocked-by-config', expectedContents, contents: 'model = "from-file"\n' });
  assert.equal(blockedFile.responseType, 'error');
  assert.match(JSON.stringify(blockedFile), /配置写入/);
  assert.equal(h.fake.calls('fs/writeFile').length, 0);
  assert.equal(await readFile(h.file, 'utf8'), expectedContents);
  original!.send(JSON.stringify({ id: configCall.id, result: { status: 'ok' } }));
  assert.equal((await configuration).outcome, 'success');

  let release!: () => void;
  h.fake.handlers.set('fs/writeFile', value => new Promise(resolve => {
    release = () => { void h.fileRpc('fs/writeFile', value as Record<string, unknown>).then(resolve); };
  }));
  const saving = client.fetchHost('workspace-file-save', { cwd: h.root, path: h.file, operationId: 'file-first',
    expectedContents, contents: 'model = "from-file"\n' });
  await h.fake.waitForCall('fs/writeFile');
  const blockedConfig = await client.host({ action: 'submit', operationId: 'config-blocked-by-file', method: 'config/batchWrite', params });
  assert.equal(blockedConfig.outcome, 'not-started');
  assert.equal(blockedConfig.operation.terminal.kind, 'not-sent');
  assert.equal(h.fake.calls('config/batchWrite').length, 1);
  release();
  assert.equal((await saving).body.outcome, 'saved');
  h.fake.handlers.set('config/batchWrite', () => ({ status: 'ok' }));
  assert.equal((await client.host({ action: 'submit', operationId: 'explicit-after-file', method: 'config/batchWrite', params })).outcome, 'success');
  assert.equal(h.fake.calls('config/batchWrite').length, 2);
});

test('removed hosts can read and retire interrupted original preparation without a backend connection', async t => {
  const hostId = 'removed-host', operationId = 'interrupted-before-connect';
  const h = await fixture(t, { configWriteOperations: [{ operationId, hostId, method: 'config/batchWrite', state: 'preparing' }] });
  const client = await h.connect(), before = h.fake.messages.length;
  const status = await client.host({ hostId, action: 'status', operationId });
  assert.equal(status.operation.state, 'preparing'); assert.equal(status.operation.interrupted, true);
  const retired = await client.host({ hostId, action: 'retry-persistence', operationId });
  assert.equal(retired.operation.state, 'failed'); assert.equal(retired.operation.terminal.kind, 'not-sent');
  assert.equal(h.fake.messages.length, before);
});

test('file saves cannot overwrite native recovery state through its path, symlink or hard link', async t => {
  const h = await fixture(t), client = await h.connect();
  const statePath = join(h.dataDir, 'native-state.json'), alias = join(h.root, 'state-alias.json'), hardLink = join(h.root, 'state-hard-link.json');
  await symlink(statePath, alias);
  await link(statePath, hardLink);
  const original = await readFile(statePath, 'utf8');
  for (const path of [statePath, alias, hardLink]) {
    const response = await client.fetchHost('workspace-file-save', { cwd: h.root, path, operationId: 'internal-' + (path === alias ? 'alias' : 'direct'),
      expectedContents: original, contents: '{}' });
    assert.equal(response.responseType, 'error'); assert.match(JSON.stringify(response), /内部恢复记录/);
  }
  assert.equal(h.fake.calls('fs/writeFile').length, 0);
  assert.equal(await readFile(statePath, 'utf8'), original);
  assert.equal((await client.fetchHost('read-file', { path: statePath })).responseType, 'success', 'public recovery metadata remains readable');
});

test('a disconnected original configuration write remains fenced across browser and native-host restarts', async t => {
  const h = await fixture(t), client = await h.connect();
  h.fake.handlers.set('config/batchWrite', (_params, { socket }) => { socket.close(); return NO_REPLY; });
  const params = { edits: [{ keyPath: 'model', value: 'fixture-new', mergeStrategy: 'replace' }], filePath: null, expectedVersion: 'v1', reloadUserConfig: true };
  const unknown = await client.host({ action: 'submit', operationId: 'original-unknown', method: 'config/batchWrite', params });
  assert.equal(unknown.outcome, 'unknown'); assert.equal(unknown.operation.state, 'unknown');
  const another = await h.connect();
  assert.equal((await another.host({ action: 'submit', operationId: 'new-conflict', method: 'config/batchWrite', params })).outcome, 'blocked');
  await h.restart();
  const restored = await h.connect(), before = h.fake.messages.length;
  assert.equal((await restored.host({ action: 'status', operationId: 'original-unknown' })).operation.state, 'unknown');
  assert.equal((await restored.host({ action: 'retry-persistence', operationId: 'original-unknown' })).operation.state, 'unknown');
  assert.equal(h.fake.messages.length, before);
  assert.equal((await restored.host({ action: 'submit', operationId: 'new-after-restart', method: 'config/batchWrite', params })).outcome, 'blocked');
  assert.equal(h.fake.messages.filter(message => message.method === 'config/batchWrite').length, 1);
});
