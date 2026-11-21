import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

async function fixture(t: import('node:test').TestContext, cloudEnabled = true) {
  const root = await mkdtemp('/tmp/yard-plugins-');
  const local = await createFakeCodex(root);
  t.after(async () => { await local.close(); await rm(root, { recursive: true, force: true }); });
  const remoteRoot = await mkdtemp('/tmp/yard-plugins-remote-');
  const remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  const { renderer, adapterPath } = await nativeFixture(root);
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/native-state.json'), JSON.stringify({ globals: { 'yard-plugin-network': { cloudEnabled, proxyUrl: '' } } }));
  const hostId = 'remote-ssh:plugin-fixture';
  const app = await createNativeWorkbench({ socketPath: local.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data'),
    workspace: root, renderer, adapterPath, port: 0,
    hostCatalog: { hosts: [{ hostId, displayName: 'Plugin fixture', sshHost: 'plugin-fixture', sshAlias: 'plugin-fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => createConnection(remote.socketPath) });
  const socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
  const messages: any[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  t.after(async () => { socket.terminate(); await app.close(); });
  async function until(predicate: (value: any) => boolean) {
    const signal = AbortSignal.timeout(8000);
    while (!messages.some(predicate)) await once(socket, 'received', { signal });
    return messages.find(predicate);
  }
  let id = 0;
  async function rpc(method: string, params: unknown = {}, selectedHost = 'local') {
    const requestId = ++id;
    socket.send(JSON.stringify({ type: 'mcp-request', hostId: selectedHost, request: { id: requestId, method, params } }));
    return (await until(value => value.type === 'mcp-response' && value.hostId === selectedHost && value.message.id === requestId)).message;
  }
  async function network(body: Record<string, unknown> = {}) {
    const requestId = String(++id);
    socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/plugin-network', body: JSON.stringify(body) }));
    return until(value => value.type === 'fetch-response' && value.requestId === requestId);
  }
  return { local, remote, hostId, rpc, until, messages, network, root };
}

test('cloud inventory is off by default and cold resume/start never wait for plugin cloud RPCs', { timeout: 5000 }, async t => {
  const h = await fixture(t, false);
  h.local.handlers.set('plugin/installed', () => NO_REPLY);
  h.local.handlers.set('plugin/list', () => NO_REPLY);
  const cache = join(h.root, 'codex/plugins/cache/codex-yard/browser/1.0.0/.codex-plugin');
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'plugin.json'), JSON.stringify({ name: 'browser', interface: { displayName: 'Browser' } }));
  h.local.handlers.set('config/read', () => ({ config: { plugins: { 'browser@codex-yard': { enabled: true } } } }));
  const threadId = '00000000-0000-4000-8000-000000000011';
  h.local.threads.set(threadId, fixtureThread(threadId, h.root));
  const resumed = await h.rpc('thread/resume', { threadId, excludeTurns: true });
  assert.ifError(resumed.error);
  assert.equal(resumed.result.thread.id, threadId);
  const started = await h.rpc('thread/start', { cwd: h.root });
  assert.ok(started.result.thread.id);
  const params = h.local.messages.find(message => message.method === 'thread/resume')!.params;
  assert.equal((params.config as Record<string, unknown>)['plugins."browser@codex-yard".enabled'], true);
  assert.match(JSON.stringify(params.config), /browser-service/);
  const inventory = (await h.rpc('plugin/installed')).result;
  assert.equal(inventory.marketplaces[0].plugins[0].id, 'browser@codex-yard');
  assert.equal(h.local.messages.some(message => message.method === 'plugin/installed' || message.method === 'plugin/list'), false);
  assert.deepEqual((await h.network()).body, { cloudEnabled: false, proxyUrl: '' });
  const denied = await h.rpc('plugin/reconcile');
  assert.match(denied.error.message, /Cloud plugin access is off/);
  const saved = await h.network({ operation: 'save', cloudEnabled: true, proxyUrl: '7897' });
  assert.deepEqual(saved.body, { cloudEnabled: true, proxyUrl: 'http://127.0.0.1:7897' });
  const state = JSON.parse(await readFile(join(h.root, 'data/native-state.json'), 'utf8'));
  assert.deepEqual(state.globals['yard-plugin-network'], saved.body);
  await h.network({ operation: 'save', cloudEnabled: true, proxyUrl: '' });
  h.local.handlers.set('plugin/installed', () => ({ marketplaces: [{ name: 'cloud', plugins: [] }] }));
  assert.equal((await h.rpc('plugin/installed')).result.marketplaces[0].name, 'cloud');
  await h.network({ operation: 'save', cloudEnabled: false, proxyUrl: '' });
  assert.equal((await h.rpc('plugin/installed')).result.marketplaces[0].name, 'codex-yard');
});

test('plugin management routes to the selected backend and preserves native results, errors and progress', async t => {
  const h = await fixture(t);
  const operations: [string, Record<string, unknown>][] = [
    ['marketplace/add', { source: '/fixture/catalog' }],
    ['marketplace/upgrade', { marketplaceName: 'fixture' }],
    ['plugin/search', { searchTerm: 'desktop', cursor: 'page-2', limit: 8 }],
    ['plugin/skill/read', { remoteMarketplaceName: 'fixture', remotePluginId: 'plugin-1', skillName: 'operate' }],
    ['plugin/install', { marketplacePath: '/fixture/catalog/marketplace.json', pluginName: 'desktop', installAttemptId: 'install-1' }],
    ['plugin/reconcile', { reason: 'installed by Yard' }],
    ['plugin/share/save', { pluginPath: '/fixture/desktop', discoverability: 'LISTED' }],
    ['plugin/share/list', {}],
    ['plugin/share/updateTargets', { remotePluginId: 'plugin-1', shareTargets: [] }],
    ['plugin/share/checkout', { remotePluginId: 'plugin-1' }],
    ['plugin/share/delete', { remotePluginId: 'plugin-1' }],
    ['plugin/uninstall', { pluginId: 'desktop@fixture' }],
    ['marketplace/remove', { marketplaceName: 'fixture' }],
  ];
  for (const [method, params] of operations) {
    h.remote.handlers.set(method, (value, context) => {
      assert.deepEqual(value, params);
      if (method === 'plugin/install') context.send({ method: 'plugin/install/progress', params: { installAttemptId: 'install-1', stage: 'complete' } });
      return { operation: method, nextCursor: 'native-cursor', payload: ['untouched'] };
    });
    assert.deepEqual((await h.rpc(method, params, h.hostId)).result,
      { operation: method, nextCursor: 'native-cursor', payload: ['untouched'] });
  }
  await h.until(value => value.type === 'mcp-notification' && value.hostId === h.hostId && value.method === 'plugin/install/progress');
  assert.equal(h.local.messages.filter(message => operations.some(([method]) => message.method === method)).length, 0);
  h.remote.handlers.set('plugin/install', () => { throw Object.assign(new Error('Native install denied'), { code: -32602, data: { reason: 'policy' } }); });
  const denied = await h.rpc('plugin/install', { pluginName: 'denied' }, h.hostId);
  assert.equal(denied.error.code, -32602);
  assert.equal(denied.error.message, 'Native install denied');
  assert.deepEqual(denied.error.data, { reason: 'policy' });
  h.local.handlers.set('plugin/search', () => ({ data: [{ name: 'local plugin' }], nextCursor: null }));
  assert.deepEqual((await h.rpc('plugin/search', { searchTerm: 'local' })).result.data, [{ name: 'local plugin' }]);
});

test('MCP OAuth, resources, widget calls and subscriptions retain their host and wire content', async t => {
  const h = await fixture(t);
  h.remote.handlers.set('mcpServer/oauth/login', (params, context) => {
    assert.deepEqual(params, { name: 'service', threadId: 'thread-1', timeoutSecs: 180 });
    context.send({ method: 'mcpServer/oauthLogin/completed', params: { name: 'service', success: true, loginId: 'login-1' } });
    return { authorizationUrl: 'https://auth.example/authorize?state=fixture', loginId: 'login-1' };
  });
  assert.equal((await h.rpc('mcpServer/oauth/login', { name: 'service', threadId: 'thread-1', timeoutSecs: 180 }, h.hostId)).result.loginId, 'login-1');
  await h.until(value => value.type === 'mcp-notification' && value.hostId === h.hostId && value.method === 'mcpServer/oauthLogin/completed');
  const resource = { contents: [{ uri: 'ui://fixture/view', mimeType: 'text/html', text: '<main>Fixture</main>' }] };
  h.remote.handlers.set('mcpServer/resource/read', () => resource);
  assert.deepEqual((await h.rpc('mcpServer/resource/read', { threadId: 'thread-1', server: 'service', uri: 'ui://fixture/view' }, h.hostId)).result, resource);
  const toolResult = { content: [{ type: 'image', data: 'fixture-base64', mimeType: 'image/png' }], structuredContent: { applied: true }, _meta: { widget: 'fixture' } };
  h.remote.handlers.set('mcpServer/tool/call', (params) => {
    assert.deepEqual(params, { threadId: 'thread-1', server: 'service', tool: 'update', arguments: { value: 3 }, _meta: { source: 'widget' } });
    return toolResult;
  });
  assert.deepEqual((await h.rpc('mcpServer/tool/call', { threadId: 'thread-1', server: 'service', tool: 'update', arguments: { value: 3 }, _meta: { source: 'widget' } }, h.hostId)).result, toolResult);
  h.remote.handlers.set('mcpServer/event/stream/start', (params, context) => {
    context.send({ method: 'mcpServer/event/stream/notification', params: { subscriptionId: params.subscriptionId, value: { progress: 4 } } });
    return { subscriptionId: params.subscriptionId };
  });
  h.remote.handlers.set('mcpServer/event/stream/stop', params => ({ stopped: params.subscriptionId }));
  assert.equal((await h.rpc('mcpServer/event/stream/start', { threadId: 'thread-1', server: 'service', subscriptionId: 'sub-1', name: 'updates', arguments: {} }, h.hostId)).result.subscriptionId, 'sub-1');
  await h.until(value => value.type === 'mcp-notification' && value.hostId === h.hostId && value.method === 'mcpServer/event/stream/notification');
  assert.deepEqual((await h.rpc('mcpServer/event/stream/stop', { subscriptionId: 'sub-1' }, h.hostId)).result, { stopped: 'sub-1' });
});

test('a lost plugin write reply is uncertain and the bridge never repeats installation', async t => {
  const h = await fixture(t);
  h.remote.handlers.set('plugin/install', (_params, context) => { setTimeout(() => context.socket.close(), 10); return NO_REPLY; });
  const reply = await h.rpc('plugin/install', { marketplacePath: '/fixture/catalog.json', pluginName: 'fixture' }, h.hostId);
  assert.equal(reply.error.data.uncertain, true);
  h.remote.handlers.set('plugin/installed', () => ({ marketplaces: [] }));
  assert.deepEqual((await h.rpc('plugin/installed', {}, h.hostId)).result, { marketplaces: [] });
  assert.equal(h.remote.messages.filter(message => message.method === 'plugin/install').length, 1);
});
