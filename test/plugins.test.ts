import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';
import { record } from '../src/native/protocol.ts';

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
  assert.equal(record(record(record(params.config).plugins)['browser@codex-yard']).enabled, true);
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

async function browserSkill(h: Awaited<ReturnType<typeof fixture>>) {
  const source = join(h.root, 'plugins/browser'), cache = join(h.root, 'codex/plugins/cache/codex-yard/browser/1.0.0');
  const relativePath = 'skills/control-in-app-browser/SKILL.md';
  for (const root of [source, cache]) {
    await mkdir(join(root, '.codex-plugin'), { recursive: true });
    await writeFile(join(root, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'browser', version: '1.0.0' }));
    await mkdir(join(root, 'skills/control-in-app-browser/agents'), { recursive: true });
    await writeFile(join(root, relativePath), 'Original Skill text');
    await writeFile(join(root, 'skills/control-in-app-browser/agents/openai.yaml'), 'interface:\n  display_name: Browser\n');
  }
  await mkdir(join(h.root, '.agents/plugins'), { recursive: true });
  const marketplacePath = join(h.root, '.agents/plugins/marketplace.json');
  await writeFile(marketplacePath, JSON.stringify({ plugins: [{ name: 'browser', source: { source: 'local', path: 'plugins/browser' } }] }));
  const config = {
    plugins: { 'browser@codex-yard': { enabled: false }, 'browser@openai-bundled': { enabled: true }, 'yard-node@codex-yard': { enabled: true } },
    marketplaces: { 'codex-yard': { source_type: 'local', source: h.root } },
  };
  for (const [market, name] of [['openai-bundled', 'browser'], ['codex-yard', 'yard-node']]) {
    const path = join(h.root, 'codex/plugins/cache', market!, name!, '1.0.0/.codex-plugin');
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'plugin.json'), JSON.stringify({ name, version: '1.0.0' }));
  }
  const skill = { name: 'browser:control-in-app-browser', description: 'Original description', shortDescription: null,
    path: join(source, relativePath), enabled: true, interface: { displayName: 'Browser', iconSmall: join(source, 'assets/icon.png') } };
  h.local.handlers.set('config/read', () => ({ config }));
  h.local.handlers.set('plugin/read', params => {
    assert.deepEqual(params, { marketplacePath, pluginName: 'browser' });
    return { plugin: { summary: { source: { type: 'local', path: source } }, skills: [skill] } };
  });
  return { source, cache, path: join(cache, relativePath), skill, config, marketplacePath };
}

test('local Skills project original session plugin metadata onto the installed cache and honor Skill switches per cwd', async t => {
  const h = await fixture(t, false), plugin = await browserSkill(h);
  const userSkill = { name: 'personal', path: '/user/SKILL.md', scope: 'user', enabled: true, custom: 'native' };
  const nativeError = { path: '/broken/SKILL.md', message: 'Native parser error' };
  const reply = { data: [h.root, join(h.root, 'disabled')].map(cwd => ({ cwd, skills: [userSkill,
    { name: 'browser:old', pluginId: 'browser@openai-bundled' }, { name: 'yard-node:js', pluginId: 'yard-node@codex-yard' }], errors: [nativeError], original: true })), nativeField: 3 };
  const alias = join(h.root, 'browser-skill-link');
  await symlink(plugin.path, alias);
  h.local.handlers.set('skills/list', params => { assert.equal(params.forceReload, true); return reply; });
  h.local.handlers.set('config/read', params => {
    assert.equal(params.includeLayers, true);
    return { config: { ...plugin.config, skills: { config: [{ path: plugin.path, enabled: true }] } }, layers: [
      { name: { type: 'sessionFlags' }, config: { skills: { config: [
        { path: params.cwd === h.root ? alias : '/another/SKILL.md', enabled: true },
        { path: plugin.path, name: plugin.skill.name, enabled: true }, // Native ignores two selectors.
      ] } } },
      { name: { type: 'project' }, config: { skills: { config: [{ path: plugin.path, enabled: true }] } } },
      { name: { type: 'user' }, disabledReason: 'Disabled fixture layer', config: { skills: { config: [{ path: plugin.path, enabled: true }] } } },
      { name: { type: 'user' }, config: { skills: { config: [{ name: '  ' + plugin.skill.name + '  ', enabled: false }] } } },
    ] };
  });
  const result = (await h.rpc('skills/list', { cwds: reply.data.map(entry => entry.cwd), forceReload: true })).result;
  assert.equal(result.nativeField, 3);
  for (const entry of result.data) {
    assert.deepEqual(entry.errors, [nativeError]);
    assert.equal(entry.original, true);
    assert.deepEqual(entry.skills, [userSkill, { ...plugin.skill, path: plugin.path, enabled: entry.cwd === h.root,
      scope: 'user', pluginId: 'browser@codex-yard', interface: { ...plugin.skill.interface, iconSmall: join(plugin.cache, 'assets/icon.png') } }]);
  }
  assert.equal(h.local.messages.some(message => message.method === 'config/batchWrite' || message.method === 'skills/config/write'), false);
  const native = { ...result.data[0].skills[1], dependencies: { tools: [{ type: 'mcp', value: 'browser' }] }, enabled: false };
  h.local.handlers.set('skills/list', () => ({ data: [{ cwd: h.root, skills: [native], errors: [] }] }));
  assert.deepEqual((await h.rpc('skills/list')).result.data[0].skills, [native]);
});

test('Skill projection reports source/cache drift and missing local registration without parsing or loading stale Skills', async t => {
  const h = await fixture(t, false), plugin = await browserSkill(h);
  h.local.handlers.set('skills/list', () => ({ data: [{ cwd: h.root, skills: [], errors: [] }] }));
  const check = async (pattern: RegExp) => {
    const entry = (await h.rpc('skills/list')).result.data[0];
    assert.deepEqual(entry.skills, []);
    assert.match(entry.errors[0].message, pattern);
    assert.match(entry.errors[0].message, /Reinstall/);
  };
  await writeFile(plugin.path, 'Stale installed Skill');
  await check(/Skill contents differ/);
  await writeFile(plugin.path, 'Original Skill text');
  const metadata = join(plugin.cache, 'skills/control-in-app-browser/agents/openai.yaml');
  await rm(metadata);
  await check(/Skill metadata differ/);
  await writeFile(metadata, 'interface:\n  display_name: Browser\n');
  await writeFile(join(plugin.source, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'browser', version: '2.0.0' }));
  await check(/versions differ/);
  await writeFile(join(plugin.source, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'browser', version: '1.0.0' }));
  plugin.skill.path = join(h.root, 'outside/SKILL.md');
  await check(/outside its plugin source/);
  h.local.handlers.set('config/read', () => ({ config: { plugins: plugin.config.plugins } }));
  await check(/no registered local marketplace/);
  h.local.handlers.set('config/read', () => ({ config: { ...plugin.config, features: { plugins: false } } }));
  const disabled = (await h.rpc('skills/list')).result.data[0];
  assert.deepEqual(disabled, { cwd: h.root, skills: [], errors: [] });
});

test('remote Skills remain native and never use the local session projection', async t => {
  const h = await fixture(t, false);
  const params = { cwds: ['/remote/workspace'], forceReload: true };
  const reply = { data: [{ cwd: '/remote/workspace', skills: [{ name: 'remote:skill', enabled: false }], errors: [{ path: '/remote', message: 'native' }] }] };
  h.remote.handlers.set('skills/list', value => { assert.deepEqual(value, params); return reply; });
  const localRequests = h.local.messages.length;
  assert.deepEqual((await h.rpc('skills/list', params, h.hostId)).result, reply);
  assert.equal(h.local.messages.length, localRequests);
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
