import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { ModelSettings } from '../src/renderer/settings/model-settings.ts';

class FakeClient implements WorkbenchClient {
  config: { model: string; model_reasoning_effort: string; profile: string | null } = { model: 'alpha', model_reasoning_effort: 'high', profile: null };
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  home = '/fixture/codex';
  version = 'version-one';
  layers: unknown = null;
  reject = false;
  conflictOnWrite = false;
  overridden = false;
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method: endpoint, params });
    if (endpoint === 'codex-home') return { codexHome: this.home } as T;
    throw new Error('unsupported host endpoint');
  }
  currentLayer() {
    const profile = this.config.profile;
    return { name: { type: 'user', file: `${this.home}/${profile ? `${profile}.config.toml` : 'config.toml'}`, profile }, version: this.version };
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    if (method === 'config/read') return { config: { ...this.config }, layers: this.layers ?? [this.currentLayer()] } as T;
    if (method === 'model/list') return { data: params?.cursor ? [{ id: 'b-id', model: 'beta', displayName: 'Beta', isDefault: false,
      defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] :
      [{ id: 'a-id', model: 'alpha', displayName: 'Alpha', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }],
    nextCursor: params?.cursor ? null : 'page2' } as T;
    if (method === 'config/batchWrite') {
      if (this.reject) throw new Error('offline');
      if (this.conflictOnWrite) this.version = 'concurrent-version';
      if (params?.expectedVersion !== this.version) throw new Error('Configuration was modified since last read');
      const expectedFile = this.config.profile ? this.currentLayer().name.file : null;
      if (params?.filePath !== expectedFile) throw new Error('Wrong target file');
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

test('model settings paginate and write the selected host default user file with its version', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'ssh:fixture');
  await settings.load();
  assert.deepEqual(settings.getSnapshot().models.map(item => item.model), ['alpha', 'beta']);
  assert.deepEqual(client.calls.find(call => call.method === 'codex-home')?.params, { hostId: 'ssh:fixture' });
  assert.deepEqual(client.calls.find(call => call.method === 'config/read')?.params, { includeLayers: true });
  settings.setModel('beta');
  assert.equal(settings.getSnapshot().effort, 'low');
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write, { method: 'config/batchWrite', hostId: 'ssh:fixture', params: { edits: [
    { keyPath: 'model', value: 'beta', mergeStrategy: 'upsert' },
    { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' },
  ], filePath: null, expectedVersion: 'version-one', reloadUserConfig: true } });
  assert.equal(settings.dirty, false);
});

test('a matching named profile file is targeted without splitting a dotted name', async () => {
  const client = new FakeClient(); client.config.profile = 'work.name';
  const settings = new ModelSettings(client, 'local');
  await settings.load(); settings.setModel('beta');
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.equal(write?.params?.filePath, '/fixture/codex/work.name.config.toml');
  assert.equal(write?.params?.expectedVersion, 'version-one');
  assert.deepEqual((write?.params?.edits as { keyPath: string }[]).map(edit => edit.keyPath), ['model', 'model_reasoning_effort']);
});

test('a profile without its own unambiguous user file cannot overwrite the base file', async () => {
  const client = new FakeClient(); client.config.profile = 'work.name';
  client.layers = [{ name: { type: 'user', file: '/fixture/codex/config.toml', profile: 'work.name' }, version: 'v' }];
  const settings = new ModelSettings(client, 'local');
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
      { name: { type: 'user', file: '/fixture/codex/work.config.toml', profile: 'work' }, version: 'p' }]]) {
    const client = new FakeClient(); client.layers = layers;
    const settings = new ModelSettings(client, 'local');
    await settings.load(); settings.setModel('beta');
    assert.match(settings.getSnapshot().writeError ?? '', /Cannot save/);
    assert.equal(await settings.save(), false);
    assert.equal(settings.getSnapshot().model, 'beta');
    assert.equal(settings.dirty, true);
    assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 0);
  }
});

test('failed writes and changed configuration preserve the draft without automatic replay', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local');
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
  assert.equal(await settings.save(), true);
});

test('a version conflict after the preflight preserves input and is not retried', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local');
  await settings.load(); settings.setModel('beta'); client.conflictOnWrite = true;
  assert.equal(await settings.save(), false);
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.equal(settings.dirty, true);
  assert.match(settings.getSnapshot().error ?? '', /modified since last read/);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('profile changes cannot redirect a pending edit to another file', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local');
  await settings.load(); settings.setModel('beta'); client.config.profile = 'different';
  assert.equal(await settings.save(), false);
  assert.match(settings.getSnapshot().error ?? '', /active profile changed/);
  await settings.load();
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.equal(settings.getSnapshot().profile, null);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 0);
});

test('managed override remains visible after effective values are verified', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local');
  await settings.load(); client.overridden = true; settings.setModel('beta');
  assert.equal(await settings.save(), true);
  assert.equal(settings.getSnapshot().warning, 'Managed override');
});
