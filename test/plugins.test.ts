import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp('/tmp/yard-plugins-');
  const local = await createFakeCodex(root);
  t.after(async () => { await local.close(); await rm(root, { recursive: true, force: true }); });
  const remoteRoot = await mkdtemp('/tmp/yard-plugins-remote-');
  const remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  const { renderer, adapterPath } = await nativeFixture(root);
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
  return { local, remote, hostId, rpc, until, messages };
}

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
