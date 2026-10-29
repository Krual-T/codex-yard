import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { PluginSummary } from '../src/renderer/pages/plugins/catalog.ts';
import { WorkbenchError } from '../src/renderer/app/client.ts';
import { reconcilePluginConfig, writePluginConfig } from '../src/renderer/app/ProductPluginConfig.ts';
import type { ProductConfigurationWrites } from '../src/renderer/app/ProductPluginConfig.ts';
import { SettingsConfigOperations } from '../src/renderer/settings/config-operations.ts';
import type { SettingsWriteStorage, WriteStatus } from '../src/renderer/settings/config-operations.ts';

const plugin: PluginSummary = { id: 'demo', name: 'demo', installed: true, enabled: true, installPolicy: 'AVAILABLE', source: { type: 'local' } };
const target = { hostId: 'local', cwd: '/workspace', plugin, enabled: false };
const source = { hostId: 'local', generation: 'generation-1', homeDirectory: '/home', codexHome: '/codex' };
const originalOrigin = { section: 'plugins-settings' as const, scope: ['/workspace'], draft: { pluginId: 'demo', enabled: false }, source };

function fixture() {
  let current = true, enabled = false;
  let snapshot: ReturnType<ProductConfigurationWrites['getSnapshot']> = { records: [], loading: false, error: null, inFlight: [] };
  const calls: { method: string; value?: unknown }[] = [];
  const client = { async rpc(method: string) {
    calls.push({ method });
    if (method === 'config/read') return { layers: [{ name: { type: 'user', file: '/codex/config.toml' }, version: 'v1' }],
      yardConfigSource: { hostId: 'local', generation: 'generation-1', homeDirectory: '/home', codexHome: '/codex' } };
    if (method === 'plugin/installed') return { marketplaces: [{ name: 'Local', path: '/market', plugins: [{ ...plugin, enabled }] }] };
    throw new Error(`Unexpected RPC ${method}`);
  } } as unknown as WorkbenchClient;
  const operations: ProductConfigurationWrites = {
    subscribe: () => () => {}, getSnapshot: () => snapshot, refresh: async () => {},
    async submit(hostId, method, params, origin, canDispatch) {
      calls.push({ method: 'submit', value: { hostId, method, params, origin, dispatchAllowed: canDispatch() } });
      return { operationId: 'original-op', result: { status: 'ok' } };
    },
    async check(id) {
      calls.push({ method: 'check', value: id });
      snapshot = { ...snapshot, records: snapshot.records.map(record => record.operationId === id ?
        { ...record, phase: 'finished', operation: { state: 'succeeded' } } : record) };
    },
    async finish(id) { calls.push({ method: 'finish', value: id }); },
    async finishSuccessfulGroup(ids) { calls.push({ method: 'finish-success', value: ids }); },
  };
  return { client, operations, calls, current: () => current, setCurrent: (value: boolean) => { current = value; },
    setEnabled: (value: boolean) => { enabled = value; }, setSnapshot: (value: typeof snapshot) => { snapshot = value; } };
}

test('plugin settings require the shared controller and keep the original source and owner', async () => {
  const item = fixture();
  await assert.rejects(writePluginConfig(undefined, item.client, target, item.current), (error: unknown) => error instanceof WorkbenchError && !error.uncertain);
  assert.equal(item.calls.length, 0);
  item.setCurrent(false);
  await assert.rejects(writePluginConfig(item.operations, item.client, target, item.current), { name: 'AbortError' });
  assert.equal(item.calls.some(call => call.method === 'submit'), false);
  item.setCurrent(true);
  await writePluginConfig(item.operations, item.client, target, item.current);
  const submission = item.calls.find(call => call.method === 'submit')?.value as {
    hostId: string; dispatchAllowed: boolean; origin: unknown; params: unknown;
  };
  assert.equal(submission.hostId, 'local'); assert.equal(submission.dispatchAllowed, true);
  assert.deepEqual(submission.origin, { section: 'plugins-settings', scope: ['/workspace'],
    draft: { pluginId: 'demo', enabled: false }, source: { hostId: 'local', generation: 'generation-1', homeDirectory: '/home', codexHome: '/codex' } });
  assert.deepEqual(submission.params, { edits: [{ keyPath: 'plugins.demo.enabled', value: false, mergeStrategy: 'upsert' }],
    filePath: '/codex/config.toml', expectedVersion: 'v1', reloadUserConfig: true });
  assert.deepEqual(item.calls.filter(call => call.method === 'finish-success').map(call => call.value), [['original-op']]);
});

test('plugin settings keep the original receipt on mismatched or unknown outcomes', async () => {
  const mismatch = fixture(); mismatch.setEnabled(true);
  await assert.rejects(writePluginConfig(mismatch.operations, mismatch.client, target, mismatch.current), (error: unknown) => error instanceof WorkbenchError && error.uncertain);
  assert.equal(mismatch.calls.filter(call => call.method === 'submit').length, 1);
  assert.equal(mismatch.calls.some(call => call.method === 'finish-success'), false);
  const rejected = fixture();
  rejected.operations.submit = async () => { throw Object.assign(new Error('not sent'), { uncertain: false }); };
  await assert.rejects(writePluginConfig(rejected.operations, rejected.client, target, rejected.current), (error: unknown) => error instanceof WorkbenchError && !error.uncertain);
  const unknown = fixture();
  unknown.operations.submit = async () => { throw Object.assign(new Error('unknown'), { uncertain: true }); };
  await assert.rejects(writePluginConfig(unknown.operations, unknown.client, target, unknown.current), (error: unknown) => error instanceof WorkbenchError && error.uncertain);
  assert.equal(unknown.calls.some(call => call.method === 'finish-success'), false);
  const readFailure = fixture();
  const originalRpc = readFailure.client.rpc;
  readFailure.client.rpc = async <T>(method: string, params?: Record<string, unknown>, hostId?: string,
    options?: Parameters<WorkbenchClient['rpc']>[3]): Promise<T> => {
    if (method === 'plugin/installed') throw new WorkbenchError('inventory unavailable', false);
    return originalRpc<T>(method, params, hostId, options);
  };
  await assert.rejects(writePluginConfig(readFailure.operations, readFailure.client, target, readFailure.current),
    (error: unknown) => error instanceof WorkbenchError && error.uncertain);
  assert.equal(readFailure.calls.filter(call => call.method === 'submit').length, 1);
  assert.equal(readFailure.calls.some(call => call.method === 'finish-success'), false);
});

test('plugin recovery checks the original operation and rereads the inventory before closing', async () => {
  const item = fixture();
  item.setSnapshot({ records: [{ operationId: 'original-op', hostId: 'local', phase: 'unknown', origin: originalOrigin },
    { operationId: 'other-op', hostId: 'other', phase: 'unknown', origin: originalOrigin }], loading: false, error: null, inFlight: [] });
  await reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', item.current);
  assert.deepEqual(item.calls.map(call => call.method), ['check', 'plugin/installed', 'finish-success']);
  assert.deepEqual(item.calls.filter(call => call.method === 'check' || call.method === 'finish-success').map(call => call.value), ['original-op', ['original-op']]);
  const stale = fixture();
  stale.setSnapshot({ records: [{ operationId: 'old', hostId: 'local', phase: 'unknown', origin: originalOrigin }], loading: false, error: null, inFlight: [] });
  const originalCheck = stale.operations.check;
  stale.operations.check = async id => { await originalCheck(id); stale.setCurrent(false); };
  await assert.rejects(reconcilePluginConfig(stale.operations, stale.client, 'local', '/workspace', stale.current), { name: 'AbortError' });
  assert.equal(stale.calls.some(call => call.method === 'finish-success'), false);
});

class MemoryStorage implements SettingsWriteStorage {
  value: unknown;
  async read() { return structuredClone(this.value); }
  async update(change: (value: unknown) => unknown) {
    this.value = structuredClone(change(structuredClone(this.value)));
    return structuredClone(this.value);
  }
  subscribe() { return () => {}; }
}

function recoveryFixture() {
  const storage = new MemoryStorage(), calls: { method: string; id?: string }[] = [], receipts = new Map<string, WriteStatus>();
  let sequence = 0, behavior: 'success' | 'rejected' | 'lost' = 'success';
  const client = { async host(endpoint: string, params: Record<string, unknown>) {
    assert.equal(endpoint, 'configuration-write');
    const id = String(params.operationId); calls.push({ method: String(params.action), id });
    if (params.action === 'status') return { operation: receipts.get(id) ?? null };
    assert.equal(params.action, 'submit');
    const operation: WriteStatus = behavior === 'rejected'
      ? { operationId: id, hostId: 'local', method: 'config/batchWrite', state: 'failed', terminal: { kind: 'rejected', code: -32000 } }
      : behavior === 'lost' ? { operationId: id, hostId: 'local', method: 'config/batchWrite', state: 'pending' }
        : { operationId: id, hostId: 'local', method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'ok' } };
    receipts.set(id, operation);
    if (behavior === 'lost') throw new Error('Original reply lost');
    return behavior === 'rejected' ? { outcome: 'error', operation, error: { message: 'Rejected', uncertain: false } }
      : { outcome: 'success', operation, result: { status: 'ok' } };
  }, async rpc(_method: string, _params: unknown, _hostId: string, options?: Parameters<WorkbenchClient['rpc']>[3]) {
    options?.assertBeforeSend?.();
    assert.equal(_method, 'plugin/installed'); calls.push({ method: _method });
    return { marketplaces: [{ name: 'Local', plugins: [{ ...plugin, enabled: false }] }] };
  } } as unknown as WorkbenchClient;
  const operations = new SettingsConfigOperations(client, storage, () => `original-${++sequence}`);
  const submit = (cwd: string, canDispatch = () => true) => operations.submit('local', 'config/batchWrite', {
    edits: [{ keyPath: 'plugins.demo.enabled', value: false, mergeStrategy: 'upsert' }],
  }, { ...originalOrigin, scope: [cwd] }, canDispatch);
  return { storage, operations, client, calls, receipts, submit, behavior(value: typeof behavior) { behavior = value; } };
}

test('checking a not-sent plugin edit preserves both original scope drafts with the real controller', async () => {
  const item = recoveryFixture();
  await assert.rejects(item.submit('/workspace', () => false), /before it was sent/);
  await assert.rejects(item.submit('/other-workspace', () => false), /before it was sent/);
  const before = structuredClone(item.storage.value);
  await assert.rejects(reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', () => true, 'original-1'), /preserved edit/);
  assert.deepEqual(item.storage.value, before);
  assert.deepEqual(item.operations.getSnapshot().records.map(record => [record.operationId, record.origin.scope, record.origin.draft]), [
    ['original-1', ['/workspace'], originalOrigin.draft], ['original-2', ['/other-workspace'], originalOrigin.draft],
  ]);
  await assert.rejects(reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', () => true, 'original-2'), /this scope/);
  assert.deepEqual(item.storage.value, before);
  assert.deepEqual(item.calls, []);
});

test('a rejected plugin receipt keeps its original edit and another scope without another write', async () => {
  const item = recoveryFixture(); item.behavior('rejected');
  await assert.rejects(item.submit('/workspace'), /configuration write was rejected/);
  await assert.rejects(item.submit('/other-workspace', () => false), /before it was sent/);
  const before = structuredClone(item.storage.value);
  await assert.rejects(reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', () => true, 'original-1'), /preserved edit/);
  assert.deepEqual(item.storage.value, before);
  assert.deepEqual(item.calls, [{ method: 'submit', id: 'original-1' }]);
});

test('unknown and late successful plugin receipts close only the original confirmed operation', async () => {
  const item = recoveryFixture();
  await assert.rejects(item.submit('/other-workspace', () => false), /before it was sent/);
  item.behavior('lost'); await assert.rejects(item.submit('/workspace'), /could not be confirmed/);
  const foreign = structuredClone(item.operations.getSnapshot().records[0]);
  await assert.rejects(reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', () => true, 'original-2'), /needs confirmation/);
  assert.equal(item.operations.getSnapshot().records.length, 2);
  item.receipts.set('original-2', { operationId: 'original-2', hostId: 'local', method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'ok' } });
  await reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', () => true, 'original-2');
  assert.deepEqual(item.operations.getSnapshot().records, [foreign]);
  assert.equal(item.calls.filter(call => call.method === 'submit').length, 1);
  assert.equal(item.calls.filter(call => call.method === 'status').length, 2);
  assert.equal(item.calls.filter(call => call.method === 'plugin/installed').length, 1);
});

test('a current inventory cannot close an original plugin edit with a different desired value', async () => {
  const item = fixture(); item.setEnabled(true);
  item.setSnapshot({ records: [{ operationId: 'original-op', hostId: 'local', phase: 'finished',
    origin: originalOrigin, operation: { state: 'succeeded' } }], loading: false, error: null, inFlight: [] });
  await assert.rejects(reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', item.current, 'original-op'), /differs/);
  assert.equal(item.calls.some(call => call.method === 'finish-success' || call.method === 'finish'), false);
});
