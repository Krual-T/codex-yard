import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { ModelSettings } from '../src/renderer/settings/model-settings.ts';

class FakeClient implements WorkbenchClient {
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  config: { model: string; model_reasoning_effort: string; profile: string | null } = { model: 'alpha', model_reasoning_effort: 'high', profile: 'work' };
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  reject = false;
  overridden = false;
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  host<T>(): Promise<T> { throw new Error('host not used'); }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    if (method === 'config/read') return { config: { ...this.config } } as T;
    if (method === 'model/list') return { data: params?.cursor ? [{ id: 'b-id', model: 'beta', displayName: 'Beta', isDefault: false,
      defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] :
      [{ id: 'a-id', model: 'alpha', displayName: 'Alpha', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }],
    nextCursor: params?.cursor ? null : 'page2' } as T;
    if (method === 'config/batchWrite') {
      if (this.reject) throw new Error('offline');
      for (const edit of params?.edits as { keyPath: string; value: string }[]) {
        if (edit.keyPath === 'model' || edit.keyPath.endsWith('.model')) this.config.model = edit.value;
        if (edit.keyPath === 'model_reasoning_effort' || edit.keyPath.endsWith('.model_reasoning_effort')) this.config.model_reasoning_effort = edit.value;
      }
      return { status: this.overridden ? 'okOverridden' : 'ok', overriddenMetadata: { message: 'Managed override' } } as T;
    }
    throw new Error('unsupported');
  }
}

test('model settings paginate and write the selected host and active profile', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'ssh:fixture');
  await settings.load();
  assert.deepEqual(settings.getSnapshot().models.map(item => item.model), ['alpha', 'beta']);
  settings.setModel('beta');
  assert.equal(settings.getSnapshot().effort, 'low');
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write, { method: 'config/batchWrite', hostId: 'ssh:fixture', params: { edits: [
    { keyPath: 'profiles.work.model', value: 'beta', mergeStrategy: 'upsert' },
    { keyPath: 'profiles.work.model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' },
  ], filePath: null, expectedVersion: null, reloadUserConfig: true } });
  assert.equal(settings.dirty, false);
});

test('without an active profile the write targets root configuration keys', async () => {
  const client = new FakeClient(); client.config.profile = null;
  const settings = new ModelSettings(client, 'local');
  await settings.load();
  settings.setModel('beta');
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual((write?.params?.edits as { keyPath: string }[]).map(edit => edit.keyPath), ['model', 'model_reasoning_effort']);
});

test('failed write and externally changed config retain the draft without replay', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local');
  await settings.load();
  settings.setModel('beta');
  client.reject = true;
  assert.equal(await settings.save(), false);
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.equal(settings.dirty, true);
  assert.match(settings.getSnapshot().error ?? '', /offline/);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
  client.reject = false;
  client.config.model = 'external';
  assert.equal(await settings.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
  assert.equal(settings.getSnapshot().savedModel, 'external');
  assert.equal(settings.getSnapshot().model, 'beta');
  assert.match(settings.getSnapshot().error ?? '', /changed elsewhere/);
});

test('profile change and unsafe profile names do not write into another profile', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local');
  await settings.load();
  settings.setModel('beta');
  client.config.profile = 'different';
  assert.equal(await settings.save(), false);
  assert.match(settings.getSnapshot().error ?? '', /active profile changed/);
  settings.discard();
  client.config.profile = 'unsafe.name';
  await settings.load();
  settings.setModel('beta');
  assert.equal(await settings.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 0);
});

test('managed override remains visible after effective values are verified', async () => {
  const client = new FakeClient(), settings = new ModelSettings(client, 'local');
  await settings.load();
  client.overridden = true;
  settings.setModel('beta');
  assert.equal(await settings.save(), true);
  assert.equal(settings.getSnapshot().warning, 'Managed override');
});
