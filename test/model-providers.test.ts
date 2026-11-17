import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import type { WebSocket } from 'ws';
import { CodexConnection } from '../lib/codex.ts';
import { ModelProviders } from '../src/native/model-providers.ts';
import { ProviderRouting } from '../src/native/provider-routing.ts';
import { modelIdentity } from '../src/native/model-selection.ts';
import { adaptModelProviders } from '../src/native/model-provider-renderer.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex, fixtureThread } from './fake-codex.ts';

test('configured catalogs isolate duplicate names, persist host-specific enablement, and withhold secrets', async t => {
  const root = await mkdtemp('/tmp/yard-providers-'), fake = await createFakeCodex(root);
  const connection = new CodexConnection(fake.socketPath);
  t.after(async () => { connection.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  await connection.connect();
  const config = { model: 'shared-model', model_provider: 'alpha', model_providers: {
    alpha: { name: 'Alpha', experimental_bearer_token: 'alpha-secret' },
    beta: { name: 'Beta', base_url: 'https://beta.invalid/v1', experimental_bearer_token: 'beta-secret' },
    deepseek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com', env_key: 'PRIVATE_KEY' },
  } };
  fake.handlers.set('config/read', () => ({ config }));
  fake.handlers.set('model/list', () => ({ data: [{ id: 'shared-model', model: 'shared-model', displayName: 'Same name',
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] }));
  const globals = {}; let saves = 0;
  const options = { globals, persist: async () => { saves++; }, fetch: (async (input, init) => {
    assert.equal(String(input), 'https://beta.invalid/v1/models');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer beta-secret');
    return Response.json({ data: [{ id: 'shared-model' }] });
  }) as typeof fetch };
  const providers = new ModelProviders(options);
  const page = await providers.models('local', connection, {}), models = page.data as Record<string, unknown>[];
  assert.deepEqual(models.map(model => model.model), [modelIdentity('alpha', 'shared-model'), modelIdentity('beta', 'shared-model'),
    modelIdentity('deepseek', 'deepseek-flash'), modelIdentity('deepseek', 'deepseek-v4-pro')]);
  assert.deepEqual(models[2].supportedReasoningEfforts && (models[2].supportedReasoningEfforts as Record<string, unknown>[]).map(level => level.reasoningEffort), ['low', 'high', 'max']);
  assert.deepEqual(models[2].inputModalities, ['text', 'image']);
  assert.deepEqual(models[3].inputModalities, ['text']);
  await providers.update('local', connection, 'beta', false);
  assert.equal(saves, 1);
  assert.equal(((await providers.models('local', connection, {})).data as unknown[]).length, 3);
  await assert.rejects(providers.selection('local', connection, modelIdentity('beta', 'shared-model')), /已禁用/);
  const restarted = new ModelProviders(options);
  assert.equal((await restarted.snapshot('local', connection)).providers.find(provider => provider.id === 'beta')?.enabled, false);
  assert.equal((await restarted.snapshot('remote', connection)).providers.find(provider => provider.id === 'beta')?.enabled, true);
  const publicData = [await providers.snapshot('local', connection), providers.publicConfig('local', { config }), page];
  assert.doesNotMatch(JSON.stringify(publicData), /alpha-secret|beta-secret|PRIVATE_KEY|experimental_bearer_token|env_key|base_url/);
  await providers.update('local', connection, 'beta', true);
  assert.equal(((await providers.models('local', connection, {})).data as unknown[]).length, 4);
});

test('provider routing unloads all owned subscribers, preserves settings, and refuses active or externally held threads', async t => {
  const root = await mkdtemp('/tmp/yard-provider-routing-'), fake = await createFakeCodex(root);
  const first = new CodexConnection(fake.socketPath), second = new CodexConnection(fake.socketPath), external = new CodexConnection(fake.socketPath);
  t.after(async () => { first.close(); second.close(); external.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  await Promise.all([first.connect(), second.connect(), external.connect()]);
  const config = { model: 'same', model_provider: 'alpha', model_providers: { alpha: { name: 'Alpha' }, beta: { name: 'Beta' } } };
  fake.handlers.set('config/read', () => ({ config }));
  const subscriptions = new Map<WebSocket, Set<string>>();
  const thread = fixtureThread('switch-thread', root, { modelProvider: 'alpha', model: 'same', path: root + '/rollout.jsonl' }); fake.threads.set(thread.id, thread);
  const settings = () => ({ thread: structuredClone(thread), model: thread.model, modelProvider: thread.modelProvider,
    reasoningEffort: 'high', approvalPolicy: 'on-request', approvalsReviewer: 'user', serviceTier: null,
    sandbox: { type: 'workspaceWrite', writableRoots: [root], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
  fake.handlers.set('thread/resume', (params, { socket }) => {
    const loaded = [...subscriptions.values()].some(ids => ids.has(thread.id));
    if (!loaded && typeof params.modelProvider === 'string') { thread.modelProvider = params.modelProvider; thread.model = String(params.model); }
    const ids = subscriptions.get(socket) ?? new Set(); ids.add(thread.id); subscriptions.set(socket, ids);
    return settings();
  });
  fake.handlers.set('thread/unsubscribe', (_, { socket }) => ({ status: subscriptions.get(socket)?.delete(thread.id) ? 'unsubscribed' : 'notSubscribed' }));
  fake.handlers.set('thread/loaded/list', () => ({ data: [...subscriptions.values()].some(ids => ids.has(thread.id)) ? [thread.id] : [] }));
  fake.handlers.set('thread/read', () => ({ thread: structuredClone(thread) }));
  fake.handlers.set('fs/getMetadata', () => ({ isDirectory: false }));
  fake.handlers.set('thread/settings/update', () => ({}));
  fake.handlers.set('config/batchWrite', () => ({ status: 'ok' }));
  fake.handlers.set('turn/start', () => ({ turn: { id: 'only-turn', status: 'inProgress', items: [] } }));
  const providers = new ModelProviders({ globals: {}, persist: async () => {} });
  providers.publicConfig('local', { config });
  const routing = new ProviderRouting({ providers, connections: () => [first, second],
    sessionConfig: async () => ({ 'features.code_mode': false }) });
  await first.request('thread/resume', { threadId: thread.id }); await second.request('thread/resume', { threadId: thread.id });
  await routing.request('local', first, 'thread/settings/update', { threadId: thread.id, model: modelIdentity('beta', 'same'), effort: 'high' }, { mutating: true });
  assert.equal(thread.modelProvider, 'beta');
  assert.equal([...subscriptions.values()].filter(ids => ids.has(thread.id)).length, 2);
  const switched = fake.calls('thread/resume').find(message => message.params.modelProvider === 'beta')!.params;
  assert.equal(switched.approvalPolicy, 'on-request'); assert.equal(switched.sandbox, 'workspace-write');
  assert.deepEqual(record(switched.config).sandbox_workspace_write, { writable_roots: [root], network_access: true, exclude_tmpdir_env_var: true, exclude_slash_tmp: true });
  assert.equal(fake.calls('thread/settings/update').at(-1)!.params.model, 'same');
  const before = fake.calls('thread/unsubscribe').length;
  thread.status = { type: 'active', activeFlags: [] };
  await assert.rejects(routing.request('local', first, 'turn/start', { threadId: thread.id, model: modelIdentity('alpha', 'same') }, { mutating: true }), /等待当前任务/);
  assert.equal(fake.calls('thread/unsubscribe').length, before); assert.equal(fake.calls('turn/start').length, 0);
  thread.status = { type: 'idle' };
  await external.request('thread/resume', { threadId: thread.id });
  await assert.rejects(routing.request('local', first, 'turn/start', { threadId: thread.id, model: modelIdentity('alpha', 'same') }, { mutating: true }), /其他客户端/);
  assert.equal(thread.modelProvider, 'beta'); assert.equal(fake.calls('turn/start').length, 0);
  assert.equal([...subscriptions.values()].filter(ids => ids.has(thread.id)).length, 3);
  await external.request('thread/unsubscribe', { threadId: thread.id });
  await routing.request('local', first, 'turn/start', { threadId: thread.id, model: modelIdentity('alpha', 'same'),
    collaborationMode: { mode: 'default', settings: { model: modelIdentity('alpha', 'same') } } }, { mutating: true });
  assert.equal(thread.modelProvider, 'alpha'); assert.equal(fake.calls('turn/start').length, 1);
  assert.doesNotMatch(JSON.stringify(fake.calls('turn/start')), /yard-model:/);
  await routing.request('local', first, 'config/batchWrite', { edits: [
    { keyPath: 'profiles.work.model', value: modelIdentity('beta', 'same'), mergeStrategy: 'upsert' },
    { keyPath: 'profiles.work.model_reasoning_effort', value: 'high', mergeStrategy: 'upsert' },
  ], reloadUserConfig: true }, { mutating: true });
  const edits = fake.calls('config/batchWrite').at(-1)!.params.edits;
  assert.deepEqual(edits, [{ keyPath: 'profiles.work.model', value: 'same', mergeStrategy: 'upsert' },
    { keyPath: 'profiles.work.model_reasoning_effort', value: 'high', mergeStrategy: 'upsert' },
    { keyPath: 'profiles.work.model_provider', value: 'beta', mergeStrategy: 'upsert' }]);
  first.server!.userAgent = 'codex-tui/0.166.0 (Linux)';
  const unsubscribeCount = fake.calls('thread/unsubscribe').length;
  await assert.rejects(routing.request('local', first, 'thread/settings/update', { threadId: thread.id, model: modelIdentity('beta', 'same') }, { mutating: true }), /CLI 版本要求/);
  assert.equal(fake.calls('thread/unsubscribe').length, unsubscribeCount);
  first.server!.userAgent = 'codex-tui/0.164.0 (Linux)'; thread.path = null;
  await assert.rejects(routing.request('local', first, 'thread/settings/update', { threadId: thread.id, model: modelIdentity('beta', 'same') }, { mutating: true }), /尚未保存/);
  assert.equal(fake.calls('thread/unsubscribe').length, unsubscribeCount);
});

test('the original configured catalog stays with its provider after a default change and host restart', async t => {
  const root = await mkdtemp('/tmp/yard-catalog-owner-'), fake = await createFakeCodex(root), connection = new CodexConnection(fake.socketPath);
  t.after(async () => { connection.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  await connection.connect();
  const config = { model: 'same', model_provider: 'alpha', model_catalog_json: '/catalog/original.json', model_providers: {
    alpha: { name: 'Alpha' }, DeepSeek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com' },
  } };
  fake.handlers.set('config/read', () => ({ config }));
  fake.handlers.set('fs/readFile', params => {
    assert.equal(params.path, '/catalog/original.json');
    return { dataBase64: Buffer.from(JSON.stringify({ models: [{ slug: 'same', display_name: 'Original model',
      model_messages: { instructions_template: 'private model instructions' }, supported_reasoning_levels: [{ effort: 'high' }] }] })).toString('base64') };
  });
  const globals = {}, options = { globals, persist: async () => {} }, first = new ModelProviders(options);
  assert.equal(await first.catalogPath('local', connection, 'alpha'), '/catalog/original.json');
  config.model_provider = 'DeepSeek'; config.model = 'deepseek-flash';
  const restarted = new ModelProviders(options);
  assert.equal(await restarted.catalogPath('local', connection, 'alpha'), '/catalog/original.json');
  assert.equal(await restarted.catalogPath('local', connection, 'DeepSeek'), undefined);
  const models = (await restarted.models('local', connection, {})).data as Record<string, unknown>[];
  assert.deepEqual(models.map(model => model.model), [modelIdentity('alpha', 'same'), modelIdentity('DeepSeek', 'deepseek-flash'), modelIdentity('DeepSeek', 'deepseek-v4-pro')]);
  assert.doesNotMatch(JSON.stringify(models), /private model instructions|instructions_template/);
});

test('provider hooks compile against the pinned renderer and reject incompatible boundaries', async () => {
  for (const asset of ['app-primary-f5ea123a0407.js', 'app-initial-a68277f60b93.js', 'general-settings-8997e171b11a.js']) {
    const path = '/assets/' + asset;
    const source = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview' + path, import.meta.url));
    const adapted = adaptModelProviders(path, source);
    assert.notEqual(adapted.toString(), source.toString());
    await transform(adapted.toString(), { loader: 'js' });
    assert.throws(() => adaptModelProviders(path, Buffer.from('export const incompatible = true')), /固定界面版本/);
  }
});
