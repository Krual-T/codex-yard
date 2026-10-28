import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp('/tmp/yard-config-host-'), codexHome = join(root, 'codex'), dataDir = join(root, 'data');
  await mkdir(codexHome); await mkdir(dataDir);
  const file = join(codexHome, 'config.toml');
  await writeFile(file, 'model = "fixture"\n');
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: { retained: 'global' }, settings: {}, future: { retained: true } }));
  const fake = await createFakeCodex(root), assets = await nativeFixture(root);
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
    return {
      async host(value: Record<string, unknown>) {
        const requestId = String(++id);
        socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/configuration-write', body: JSON.stringify({ hostId: 'local', ...value }) }));
        const response = await until(value => value.type === 'fetch-response' && value.requestId === requestId);
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
  return { fake, file, dataDir, connect, async restart() {
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
