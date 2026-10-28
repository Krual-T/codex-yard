import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { readVisualizationModelContext, readVisualizationState, visualizationAtomKey, visualizationPathKey, writeVisualizationState } from '../src/renderer/visualizations/state.ts';

function fixture() {
  const atoms: Record<string, unknown> = {};
  let fail = false;
  const client: WorkbenchClient = {
    async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
      await Promise.resolve();
      const key = String(params?.key);
      if (endpoint === 'get-persisted-atom') return { value: structuredClone(atoms[key]) } as T;
      if (endpoint === 'set-persisted-atom') {
        if (fail) throw new Error('disk full');
        const prior = atoms[key];
        if (prior !== undefined && (!prior || typeof prior !== 'object' || Array.isArray(prior))) throw new Error('Invalid atom');
        const map = { ...prior as Record<string, unknown> };
        const update = params?.recordUpdate as { entries: Record<string, { value: unknown; expectedValue?: unknown; createOnly?: boolean }> };
        for (const [path, operation] of Object.entries(update.entries)) {
          if (operation.createOnly && Object.hasOwn(map, path)) continue;
          if (operation.expectedValue !== undefined && JSON.stringify(map[path]) !== JSON.stringify(operation.expectedValue)) continue;
          map[path] = operation.value;
        }
        atoms[key] = structuredClone(map);
        return { success: true } as T;
      }
      throw new Error('Unexpected endpoint');
    },
    async rpc<T>(): Promise<T> { throw new Error('Unexpected RPC'); },
    subscribe() { return () => {}; },
  };
  return { client, atoms, setFailure(value: boolean) { fail = value; } };
}
const local = { hostId: 'local', threadId: 'same', path: '/work/chart.html' };
const remote = { hostId: 'remote', threadId: 'same', path: '/work/chart.html' };

test('legacy widget state remains authoritative and host, thread and path stay independent', async () => {
  const { client, atoms } = fixture();
  const key = visualizationAtomKey('visualization-state-v3', local);
  atoms[key] = { '/work/chart.html': { ...local, state: { modelContent: { selected: 1 }, privateContent: { secret: false }, extension: 'keep' }, extra: 'keep' },
    unknown: { future: 1 } };
  assert.deepEqual(await readVisualizationState(client, local), { modelContent: { selected: 1 }, privateContent: { secret: false }, extension: 'keep' });
  await Promise.all([
    writeVisualizationState(client, local, { modelContent: { selected: 2 }, extension: 'new' }),
    writeVisualizationState(client, { ...local, path: '/work/other.html' }, { privateContent: 'other' }),
    writeVisualizationState(client, remote, { privateContent: 'remote' }),
  ]);
  assert.deepEqual(await readVisualizationState(client, local), { modelContent: { selected: 2 }, privateContent: null, extension: 'new' });
  assert.deepEqual(await readVisualizationState(client, remote), { modelContent: null, privateContent: 'remote' });
  assert.deepEqual(await readVisualizationState(client, { ...local, path: '/work/other.html' }), { modelContent: null, privateContent: 'other' });
  const saved = atoms[key] as Record<string, Record<string, unknown>>;
  assert.equal(saved['/work/chart.html'].extra, 'keep');
  assert.deepEqual(saved.unknown, { future: 1 });
  assert.equal(await readVisualizationState(client, { ...local, threadId: 'other' }), null);
});

test('path aliases use the existing path slot without creating a second copy', async () => {
  const { client, atoms } = fixture();
  assert.equal(visualizationPathKey('C:\\Charts\\One.html'), 'win32:/mnt/c/charts/one.html');
  assert.equal(visualizationPathKey('\\\\wsl$\\Ubuntu\\mnt\\c\\Charts\\One.html'), 'win32:/mnt/c/charts/one.html');
  assert.equal(visualizationPathKey('\\\\server\\share\\Chart.html'), 'win32://server/share/chart.html');
  const identity = { ...local, path: 'C:\\Charts\\One.html' };
  const key = visualizationAtomKey('visualization-state-v3', identity);
  atoms[key] = { 'old-path-key': { ...identity, state: { modelContent: 'old' } } };
  assert.equal((await readVisualizationState(client, identity))?.modelContent, 'old');
  await writeVisualizationState(client, identity, { modelContent: 'new' });
  assert.deepEqual(Object.keys(atoms[key] as object), ['old-path-key']);
});

test('malformed, conflicting and unrecognized old records are retained, not overwritten', async () => {
  const { client, atoms } = fixture();
  const key = visualizationAtomKey('visualization-state-v3', local);
  for (const old of [null, [], { '/work/chart.html': { future: 'unknown' } },
    { '/work/chart.html': { ...remote, state: {} } },
    { '/work/chart.html': { ...local, state: 'unknown' } },
    { '/work/chart.html': { ...local, state: {} }, another: { ...local, state: {} } }]) {
    atoms[key] = structuredClone(old);
    await assert.rejects(writeVisualizationState(client, local, { privateContent: 'new' }));
    assert.deepEqual(atoms[key], old);
  }
});

test('failed saves and invalid widget states leave previous values intact', async () => {
  const f = fixture();
  await writeVisualizationState(f.client, local, { modelContent: { value: 1 } });
  const snapshot = structuredClone(f.atoms);
  f.setFailure(true);
  await assert.rejects(writeVisualizationState(f.client, local, { modelContent: { value: 2 } }), /disk full/);
  assert.deepEqual(f.atoms, snapshot);
  f.setFailure(false);
  await assert.rejects(writeVisualizationState(f.client, local, { imageIds: ['unsupported'] }));
  await assert.rejects(writeVisualizationState(f.client, local, { modelContent: 'x'.repeat(17_000) }));
  assert.deepEqual(f.atoms, snapshot);
  await writeVisualizationState(f.client, local, { modelContent: { changes: [1] } }, 'visualization-interaction-state-v1');
  const interaction = f.atoms[visualizationAtomKey('visualization-interaction-state-v1', local)] as Record<string, { state: unknown }>;
  assert.deepEqual(interaction['/work/chart.html'].state, { modelContent: { changes: [1] } });
});

test('model context exposes only valid, host-scoped model content and never private state', async () => {
  const { client, atoms } = fixture();
  await writeVisualizationState(client, local, { modelContent: { selection: 'local' }, privateContent: { secret: 'private' } });
  await writeVisualizationState(client, remote, { modelContent: { selection: 'remote' }, privateContent: 'private' });
  await writeVisualizationState(client, local, { modelContent: { edits: [2] } }, 'visualization-interaction-state-v1');
  const key = visualizationAtomKey('visualization-state-v3', local);
  (atoms[key] as Record<string, unknown>).invalid = { ...remote, state: { modelContent: 'wrong host' } };
  const result = await readVisualizationModelContext(client, local.hostId, local.threadId);
  assert.deepEqual(result, [
    { path: local.path, field: 'state', modelContent: { selection: 'local' } },
    { path: local.path, field: 'interaction', modelContent: { edits: [2] } },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|remote/);
});

test('atomic record updates preserve a concurrent path and reject conflicting or malformed replacements', async () => {
  const f = fixture();
  const key = visualizationAtomKey('visualization-state-v3', local);
  const other = { ...local, path: '/work/other.html' };
  let race: (() => void) | undefined;
  const client: WorkbenchClient = { ...f.client, async host<T>(endpoint: string, params?: Record<string, unknown>) {
    if (endpoint === 'set-persisted-atom') { const run = race; race = undefined; run?.(); }
    return f.client.host<T>(endpoint, params);
  } };
  race = () => { f.atoms[key] = { [other.path]: { ...other, state: { modelContent: 'concurrent' } } }; };
  await writeVisualizationState(client, local, { modelContent: 'ours' });
  assert.equal((await readVisualizationState(client, other))?.modelContent, 'concurrent');
  race = () => { (f.atoms[key] as Record<string, unknown>)[local.path] = { ...local, state: { modelContent: 'theirs' } }; };
  await assert.rejects(writeVisualizationState(client, local, { modelContent: 'new' }), /concurrently/);
  assert.equal((await readVisualizationState(client, local))?.modelContent, 'theirs');
  race = () => { f.atoms[key] = 'unrecognized'; };
  await assert.rejects(writeVisualizationState(client, local, { modelContent: 'new' }), /Invalid atom/);
  assert.equal(f.atoms[key], 'unrecognized');
});
