import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { PluginSummary } from '../src/renderer/pages/plugins/catalog.ts';
import { WorkbenchError } from '../src/renderer/app/client.ts';
import { reconcilePluginConfig, writePluginConfig } from '../src/renderer/app/ProductPluginConfig.ts';
import type { ProductConfigurationWrites } from '../src/renderer/app/ProductPluginConfig.ts';

const plugin: PluginSummary = { id: 'demo', name: 'demo', installed: true, enabled: true, installPolicy: 'AVAILABLE', source: { type: 'local' } };
const target = { hostId: 'local', cwd: '/workspace', plugin, enabled: false };

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
  item.setSnapshot({ records: [{ operationId: 'original-op', hostId: 'local', phase: 'unknown', origin: { section: 'plugins-settings' } },
    { operationId: 'other-op', hostId: 'other', phase: 'unknown', origin: { section: 'plugins-settings' } }], loading: false, error: null, inFlight: [] });
  await reconcilePluginConfig(item.operations, item.client, 'local', '/workspace', item.current);
  assert.deepEqual(item.calls.map(call => call.method), ['check', 'plugin/installed', 'finish']);
  assert.deepEqual(item.calls.filter(call => call.method === 'check' || call.method === 'finish').map(call => call.value), ['original-op', 'original-op']);
  const stale = fixture();
  stale.setSnapshot({ records: [{ operationId: 'old', hostId: 'local', phase: 'unknown', origin: { section: 'plugins-settings' } }], loading: false, error: null, inFlight: [] });
  const originalCheck = stale.operations.check;
  stale.operations.check = async id => { await originalCheck(id); stale.setCurrent(false); };
  await assert.rejects(reconcilePluginConfig(stale.operations, stale.client, 'local', '/workspace', stale.current), { name: 'AbortError' });
  assert.equal(stale.calls.some(call => call.method === 'finish'), false);
});
