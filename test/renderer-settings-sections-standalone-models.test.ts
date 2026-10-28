import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { ModelSettings, resolveConfiguredModel } from '../src/renderer/settings/model-settings.ts';
import { fixtureConfigurationHost, fixtureOperations } from './renderer-settings-sections-config-fixture.ts';

class FakeClient implements WorkbenchClient {
  operations = fixtureOperations(this);
  config: { model: string | null; model_reasoning_effort: string | null; profile: string | null } = { model: 'alpha', model_reasoning_effort: 'high', profile: null };
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  home = '/fixture/codex';
  version = 'version-one';
  layers: unknown = null;
  reject = false;
  conflictOnWrite = false;
  overridden = false;
  beforeWrite?: () => Promise<void>;
  defaults = ['alpha'];
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method: endpoint, params });
    if (endpoint === 'codex-home') return { codexHome: this.home } as T;
    if (endpoint === 'configuration-write' && params) return await fixtureConfigurationHost(this, params) as T;
    throw new Error('unsupported host endpoint');
  }
  currentLayer() {
    return { name: { type: 'user', file: `${this.home}/config.toml`, profile: null }, version: this.version };
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    if (method === 'config/read') return { config: { ...this.config }, layers: this.layers ?? [this.currentLayer()] } as T;
    if (method === 'model/list') return { data: params?.cursor ? [{ id: 'b-id', model: 'beta', displayName: 'Beta', isDefault: this.defaults.includes('beta'),
      defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] :
      [{ id: 'a-id', model: 'alpha', displayName: 'Alpha', isDefault: this.defaults.includes('alpha'), supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }],
    nextCursor: params?.cursor ? null : 'page2' } as T;
    if (method === 'config/batchWrite') {
      await this.beforeWrite?.();
      if (this.reject) throw new Error('offline');
      if (this.conflictOnWrite) this.version = 'concurrent-version';
      if (params?.expectedVersion !== this.version) throw new Error('Configuration was modified since last read');
      if (params?.filePath !== null) throw new Error('Wrong target file');
      for (const edit of params?.edits as { keyPath: string; value: string }[]) {
        if (edit.keyPath === 'model') this.config.model = edit.value;
        if (edit.keyPath === 'model_reasoning_effort') this.config.model_reasoning_effort = edit.value;
      }
      this.version = 'version-two';
      return { status: this.overridden ? 'okOverridden' : 'ok', version: this.version, overriddenMetadata: { message: 'Managed override' } } as T;
    }
    throw new Error('unsupported');
  }
}

test('nullable configured model uses the unique default for effort without writing a model', async () => {
  const client = new FakeClient(); client.config.model = null; client.config.model_reasoning_effort = null;
  const settings = new ModelSettings(client, 'local', client.operations); await settings.load();
  assert.equal(resolveConfiguredModel(settings.getSnapshot().models, null)?.model, 'alpha');
  settings.setEffort('high');
  assert.equal(settings.getSnapshot().savedModel, null);
  assert.equal(settings.getSnapshot().model, null);
  assert.equal(await settings.save(), true);
  assert.deepEqual(client.calls.find(call => call.method === 'config/batchWrite')?.params?.edits,
    [{ keyPath: 'model_reasoning_effort', value: 'high', mergeStrategy: 'upsert' }]);
  assert.equal(client.config.model, null);
});

test('missing or ambiguous defaults cannot validate a reasoning effort', async () => {
  for (const defaults of [[], ['alpha', 'beta']]) {
    const client = new FakeClient(); client.config.model = null; client.config.model_reasoning_effort = null; client.defaults = defaults;
    const settings = new ModelSettings(client, 'local', client.operations); await settings.load();
    assert.equal(resolveConfiguredModel(settings.getSnapshot().models, null), null);
    settings.setEffort('high');
    assert.match(settings.getSnapshot().error ?? '', /unavailable or ambiguous/);
    assert.equal(settings.getSnapshot().effort, null);
    assert.equal(await settings.save(), false);
    assert.equal(client.calls.some(call => call.method === 'config/batchWrite'), false);
  }
});

test('model settings paginate and write the selected host default user file with its version', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'ssh:fixture', client.operations);
  await settings.load();
  assert.deepEqual(settings.getSnapshot().models.map(item => item.model), ['alpha', 'beta']);
  assert.deepEqual(client.calls.find(call => call.method === 'codex-home')?.params, { hostId: 'ssh:fixture' });
  assert.deepEqual(client.calls.find(call => call.method === 'config/read')?.params, { includeLayers: true });
  settings.setModel('beta');
  assert.equal(settings.getSnapshot().effort, 'high');
  settings.setEffort('low');
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write, { method: 'config/batchWrite', hostId: 'ssh:fixture', params: { edits: [
    { keyPath: 'model', value: 'beta', mergeStrategy: 'upsert' },
    { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' },
  ], filePath: null, expectedVersion: 'version-one', reloadUserConfig: true } });
  assert.equal(settings.dirty, false);
});

test('a legacy profile value does not redirect base user model writes', async () => {
  const client = new FakeClient(); client.config.profile = 'work.name';
  const settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); settings.setModel('beta');
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.equal(write?.params?.filePath, null);
  assert.equal(write?.params?.expectedVersion, 'version-one');
  assert.deepEqual((write?.params?.edits as { keyPath: string }[]).map(edit => edit.keyPath), ['model']);
});

test('a synthetic named user layer cannot be treated as the base file', async () => {
  const client = new FakeClient(); client.config.profile = 'work.name';
  client.layers = [{ name: { type: 'user', file: '/fixture/codex/config.toml', profile: 'work.name' }, version: 'v' }];
  const settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); settings.setModel('beta');
  assert.match(settings.getSnapshot().writeError ?? '', /Cannot save/);
  assert.equal(await settings.save(), false);
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 0);
});

test('missing, mismatched or ambiguous metadata blocks a write and preserves the edit', async () => {
  for (const layers of [[], [{ name: { type: 'user', file: '/other/config.toml', profile: null }, version: 'v' }],
    [{ name: { type: 'user', file: '/fixture/codex/config.toml', profile: null }, version: '' }],
    [{ name: { type: 'user', file: '/fixture/codex/config.toml', profile: null }, version: 'v' },
      { name: { type: 'user', file: '/fixture/codex/config.toml' }, version: 'unknown' }],
    [{ name: { type: 'user', file: '/fixture/codex/config.toml', profile: null }, version: 'v' },
      { name: { type: 'user', file: '/fixture/codex/work.config.toml', profile: 'work' }, version: 'p' }]]) {
    const client = new FakeClient(); client.layers = layers;
    const settings = new ModelSettings(client, 'local', client.operations);
    await settings.load(); settings.setModel('beta');
    assert.match(settings.getSnapshot().writeError ?? '', /Cannot save/);
    assert.equal(await settings.save(), false);
    assert.equal(settings.getSnapshot().model, 'beta');
    assert.equal(settings.dirty, true);
    assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 0);
  }
});

test('failed writes and changed configuration preserve the draft without automatic replay', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); settings.setModel('beta'); client.reject = true;
  assert.equal(await settings.save(), false);
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.match(settings.getSnapshot().error ?? '', /offline/);
  client.reject = false; client.config.model = 'external'; client.version = 'external-version';
  assert.equal(await settings.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
  assert.equal(settings.getSnapshot().savedModel, 'alpha');
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.match(settings.getSnapshot().error ?? '', /changed elsewhere/);
  await settings.load();
  assert.equal(settings.getSnapshot().savedModel, 'external');
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.deepEqual(settings.getSnapshot().conflicts, ['model']);
  assert.equal(await settings.save(), false);
  await settings.load();
  assert.deepEqual(settings.getSnapshot().conflicts, ['model']);
  settings.resolveConflict('model', 'draft');
  assert.equal(await settings.save(), false);
  assert.match(settings.getSnapshot().error ?? '', /earlier configuration save/);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('a newer model edit survives reload without changing an unknown original submission', async () => {
  const client = new FakeClient(), first = new ModelSettings(client, 'local', client.operations);
  await first.load(); first.setModel('beta'); client.reject = true;
  assert.equal(await first.save(), false);
  first.setEffort('low'); await first.retryDraftPersistence();
  const original = await client.operations.find('local', 'models');
  assert.deepEqual(original?.params.edits, [{ keyPath: 'model', value: 'beta', mergeStrategy: 'upsert' }]);
  const second = new ModelSettings(client, 'local', client.operations); await second.load();
  assert.equal(second.getSnapshot().model, 'beta');
  assert.equal(second.getSnapshot().effort, 'low');
  assert.equal(await second.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('a late original model result cannot replace edits in a newer controller', async () => {
  const client = new FakeClient(), first = new ModelSettings(client, 'local', client.operations);
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeWrite = async () => { entered(); await gate; };
  await first.load(); first.setModel('beta');
  const saving = first.save(); await waiting; first.dispose();
  const second = new ModelSettings(client, 'local', client.operations); await second.load();
  second.setEffort('low'); await second.retryDraftPersistence();
  release(); assert.equal(await saving, false);
  assert.equal(second.getSnapshot().model, 'beta'); assert.equal(second.getSnapshot().effort, 'low');
  const record = await client.operations.find('local', 'models');
  assert.equal(record?.phase, 'finished');
  assert.deepEqual(record?.params.edits, [{ keyPath: 'model', value: 'beta', mergeStrategy: 'upsert' }]);
  assert.ok(record?.workingDrafts?.length);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('model reload adopts an unedited nullable effort and sends only the edited model', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); settings.setModel('beta');
  client.config.model_reasoning_effort = null; client.version = 'external-version';
  assert.equal(await settings.save(), false);
  await settings.load();
  assert.equal(settings.getSnapshot().effort, null);
  assert.deepEqual(settings.getSnapshot().conflicts, []);
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write?.params?.edits, [{ keyPath: 'model', value: 'beta', mergeStrategy: 'upsert' }]);
  assert.equal(write?.params?.expectedVersion, 'external-version');
  assert.equal(client.config.model_reasoning_effort, null);
});

test('model conflict can use the current value without silently writing the old draft', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); settings.setModel('beta');
  client.config.model = 'external'; client.version = 'external-version';
  await settings.load();
  assert.deepEqual(settings.getSnapshot().conflicts, ['model']);
  settings.resolveConflict('model', 'current');
  assert.equal(settings.dirty, false);
  assert.equal(settings.getSnapshot().model, 'external');
  assert.equal(await settings.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 0);
});

test('an effort draft must be supported by the model selected after a concurrent change', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local', client.operations);
  client.config.model_reasoning_effort = null;
  await settings.load(); settings.setEffort('high');
  client.config.model = 'beta'; client.version = 'external-version';
  await settings.load();
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.equal(settings.getSnapshot().effort, 'high');
  assert.equal(await settings.save(), false);
  assert.match(settings.getSnapshot().error ?? '', /does not support/);
  settings.setEffort('low');
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write?.params?.edits, [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }]);
});

test('a version conflict after the preflight preserves input and is not retried', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); settings.setModel('beta'); client.conflictOnWrite = true;
  assert.equal(await settings.save(), false);
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.equal(settings.dirty, true);
  assert.match(settings.getSnapshot().error ?? '', /modified since last read/);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('profile changes cannot redirect a pending edit to another file', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); settings.setModel('beta'); client.config.profile = 'different';
  assert.equal(await settings.save(), false);
  assert.match(settings.getSnapshot().error ?? '', /active profile changed/);
  await settings.load();
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.equal(settings.getSnapshot().profile, null);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 0);
});

test('managed override remains visible after effective values are verified', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local', client.operations);
  await settings.load(); client.overridden = true; settings.setModel('beta');
  assert.equal(await settings.save(), true);
  assert.equal(settings.getSnapshot().warning, 'Managed override');
});
