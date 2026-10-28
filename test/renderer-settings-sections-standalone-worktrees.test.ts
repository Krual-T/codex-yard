import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { readRemoteWorktreePreferences, RemoteWorktreeSettings } from '../src/renderer/settings/worktrees.ts';
import { fixtureConfigurationHost, fixtureDraft, fixtureOperations, fixtureSource } from './renderer-settings-sections-config-fixture.ts';

test('remote worktrees use the selected host and accept an absent desktop table as defaults', async () => {
  let response: unknown = { config: { desktop: { 'git-worktree-root': '/remote/worktrees', 'worktree-auto-cleanup-enabled': false, 'worktree-keep-count': 7 } } };
  const calls: unknown[][] = [];
  const client: WorkbenchClient = {
    rpc: async <T>(method: string, params?: Record<string, unknown>, hostId?: string) => { calls.push([method, params, hostId]); return response as T; },
    host: async () => { throw new Error('Unexpected local storage access'); },
    subscribe: () => () => {},
    reply: async () => { throw new Error('Unexpected approval'); },
  };
  assert.deepEqual(await readRemoteWorktreePreferences(client, 'ssh:fixture'), { root: '/remote/worktrees', autoCleanup: false, keepCount: 7 });
  assert.deepEqual(calls[0], ['config/read', { includeLayers: false }, 'ssh:fixture']);
  response = { config: {} };
  assert.deepEqual(await readRemoteWorktreePreferences(client, 'ssh:fixture'), { root: '', autoCleanup: true, keepCount: 15 });
  response = {};
  await assert.rejects(readRemoteWorktreePreferences(client, 'ssh:fixture'), /invalid configuration/);
  response = { config: { desktop: { 'worktree-keep-count': 0 } } };
  await assert.rejects(readRemoteWorktreePreferences(client, 'ssh:fixture'), /invalid value/);
  response = { config: { desktop: {} } };
  assert.deepEqual(await readRemoteWorktreePreferences(client, 'ssh:fixture'), { root: '', autoCleanup: true, keepCount: 15 });
});

class RemoteClient implements WorkbenchClient {
  operations = fixtureOperations(this);
  desktop: Record<string, unknown> = {};
  version = 'v1';
  generation = 'generation-a'; sourceAvailable = true;
  layers: unknown = null;
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  conflict = false;
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  subscribe() { return () => {}; }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method: endpoint, params });
    if (endpoint === 'configuration-write' && params) return await fixtureConfigurationHost(this, params) as T;
    if (endpoint !== 'codex-home') throw new Error('Unexpected host access');
    return { codexHome: '/fixture/remote' } as T;
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    if (method === 'config/read') return { config: { desktop: { ...this.desktop }, profile: null }, layers: this.layers ?? [
      { name: { type: 'user', file: '/fixture/remote/config.toml', profile: null }, version: this.version },
    ], ...(this.sourceAvailable ? { yardConfigSource: fixtureSource(hostId, '/fixture/remote', this.generation) } : {}) } as T;
    if (method === 'config/batchWrite') {
      if (this.conflict) this.version = 'external';
      if (params?.expectedVersion !== this.version) throw new Error('Configuration was modified since last read');
      assert.equal(params.filePath, null);
      for (const edit of params.edits as { keyPath: string; value: unknown }[]) this.desktop[edit.keyPath.slice('desktop.'.length)] = edit.value;
      this.version = 'v2';
      return { status: 'ok', version: 'intermediate-version' } as T;
    }
    throw new Error('Unexpected RPC');
  }
}

test('worktree source changes and absent sources require review without losing the draft', async () => {
  for (const absent of [false, true]) {
    const client = new RemoteClient(); client.sourceAvailable = !absent;
    const settings = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
    await settings.load(); settings.edit({ root: '/remote/draft' });
    client.sourceAvailable = true; client.generation = 'generation-b';
    assert.equal(await settings.save(), false); assert.equal(settings.getSnapshot().draft?.root, '/remote/draft');
    assert.equal(client.calls.some(call => call.method === 'configuration-write'), false);
    await settings.load(true); assert.equal(await settings.save(), true);
    assert.deepEqual(client.calls.find(call => call.method === 'configuration-write')?.params?.source,
      fixtureSource('ssh:fixture', '/fixture/remote', 'generation-b'));
  }
});

test('remote worktree edits write only the selected host desktop keys with a verified version', async () => {
  const client = new RemoteClient(), settings = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
  await settings.load();
  settings.edit({ root: ' /remote/worktrees ', autoCleanup: false, keepCount: '4' });
  assert.equal(await settings.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write, { method: 'config/batchWrite', hostId: 'ssh:fixture', params: {
    edits: [
      { keyPath: 'desktop.git-worktree-root', value: '/remote/worktrees', mergeStrategy: 'replace' },
      { keyPath: 'desktop.worktree-auto-cleanup-enabled', value: false, mergeStrategy: 'replace' },
      { keyPath: 'desktop.worktree-keep-count', value: 4, mergeStrategy: 'replace' },
    ], filePath: null, expectedVersion: 'v1', reloadUserConfig: true,
  } });
  assert.equal(client.calls.some(call => call.method === 'codex-home'), false);
  assert.equal(settings.dirty, false);
});

test('remote worktree failures, conflicts and missing versions preserve the draft', async () => {
  const client = new RemoteClient(), settings = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
  await settings.load(); settings.edit({ root: 'relative' });
  assert.equal(await settings.save(), false);
  assert.match(settings.getSnapshot().error ?? '', /absolute path/);
  settings.edit({ root: '/remote/worktrees' }); client.conflict = true;
  assert.equal(await settings.save(), false);
  assert.match(settings.getSnapshot().error ?? '', /modified since last read/);
  assert.equal(settings.getSnapshot().draft?.root, '/remote/worktrees');
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
  client.conflict = false; client.layers = [];
  await settings.load();
  assert.equal(settings.getSnapshot().draft?.root, '/remote/worktrees');
  assert.match(settings.getSnapshot().writeError ?? '', /Cannot save/);
  assert.equal(await settings.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('remote worktree reload adopts unedited fields and requires review for an edited conflict', async () => {
  const client = new RemoteClient(), settings = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
  await settings.load(); settings.edit({ root: '/remote/first' });
  client.desktop['worktree-keep-count'] = 3; client.version = 'v2';
  await settings.load();
  assert.equal(settings.getSnapshot().draft?.keepCount, '3');
  assert.equal(await settings.save(), true);
  const edits = client.calls.find(call => call.method === 'config/batchWrite')?.params?.edits;
  assert.deepEqual(edits, [{ keyPath: 'desktop.git-worktree-root', value: '/remote/first', mergeStrategy: 'replace' }]);
  settings.edit({ root: '/remote/mine' });
  client.desktop['git-worktree-root'] = '/remote/theirs'; client.version = 'v3';
  await settings.load();
  assert.deepEqual(settings.getSnapshot().conflicts, ['root']);
  assert.equal(await settings.save(), false);
  settings.resolveConflict('root', 'draft');
  assert.equal(await settings.save(), true);
  assert.equal(client.desktop['git-worktree-root'], '/remote/mine');
});

test('remote worktree recovery retains newer fields without replaying the original request', async () => {
  const client = new RemoteClient(), first = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
  await first.load(); first.edit({ root: '/remote/first' }); client.conflict = true;
  assert.equal(await first.save(), false);
  first.edit({ keepCount: '4' }); await first.retryDraftPersistence();
  const record = await client.operations.find('ssh:fixture', 'worktrees');
  assert.deepEqual(record?.params.edits, [{ keyPath: 'desktop.git-worktree-root', value: '/remote/first', mergeStrategy: 'replace' }]);
  const second = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations); await second.load();
  await second.restoreDraft(await fixtureDraft(client.operations, first.editorId));
  assert.equal(second.getSnapshot().draft?.root, '/remote/first');
  assert.equal(second.getSnapshot().draft?.keepCount, '4');
  client.conflict = false; assert.equal(await second.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('remote worktree conflict baseline survives restore until an explicit choice', async () => {
  const client = new RemoteClient(), first = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
  await first.load(); first.edit({ root: '/remote/mine' }); client.desktop['git-worktree-root'] = '/remote/theirs'; client.version = 'v2';
  await first.load(); await first.retryDraftPersistence();
  const saved = await fixtureDraft(client.operations, first.editorId) as { conflicts: string[]; conflictBaselines: { root: string } };
  assert.deepEqual(saved.conflicts, ['root']); assert.equal(saved.conflictBaselines.root, '');
  const restored = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations); await restored.load(); await restored.restoreDraft(saved);
  assert.deepEqual(restored.getSnapshot().conflicts, ['root']); assert.equal(await restored.save(), false);
  restored.resolveConflict('root', 'draft'); assert.equal(await restored.save(), true);
});

test('remote worktree null-target recovery requires review and normalized no-op retires only its own edit', async () => {
  const client = new RemoteClient(); client.layers = [];
  const first = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations); await first.load(); first.edit({ keepCount: '015' }); await first.retryDraftPersistence();
  const saved = await fixtureDraft(client.operations, first.editorId) as { target: unknown }; assert.equal(saved.target, null);
  client.layers = null;
  const restored = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations); await restored.load(); await restored.restoreDraft(saved);
  assert.equal(restored.getSnapshot().draft?.keepCount, '015'); assert.equal(await restored.save(), false);
  await restored.load(true); assert.equal(await restored.save(), true); await client.operations.refresh();
  assert.equal(client.operations.getSnapshot().drafts.some(item => item.editorId === restored.editorId), false);
  assert.equal(client.operations.getSnapshot().drafts.some(item => item.editorId === first.editorId), true);
  assert.equal(client.calls.some(call => call.method === 'configuration-write'), false);
});

test('remote worktree reload removes its draft when the authoritative value converges', async () => {
  const client = new RemoteClient(), first = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
  await first.load(); first.edit({ root: '/remote/mine' }); await first.retryDraftPersistence();
  client.desktop['git-worktree-root'] = '/remote/mine'; client.version = 'v2'; await first.load(); await first.retryDraftPersistence();
  await client.operations.refresh(); assert.equal(client.operations.getSnapshot().drafts.some(item => item.editorId === first.editorId), false);
});

test('a worktree override persists the affected conflict and adopts untouched fields', async () => {
  const client = new RemoteClient(), settings = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations);
  const rpc = client.rpc.bind(client);
  client.rpc = async <T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> => {
    const response = await rpc<T>(method, params, hostId);
    if (method === 'config/batchWrite') {
      client.desktop['git-worktree-root'] = '/remote/overridden'; client.desktop['worktree-keep-count'] = 3;
      return { status: 'okOverridden' } as T;
    }
    return response;
  };
  await settings.load(); settings.edit({ root: '/remote/mine' }); assert.equal(await settings.save(), false);
  assert.deepEqual(settings.getSnapshot().conflicts, ['root']); assert.equal(settings.getSnapshot().draft?.keepCount, '3');
  await settings.retryDraftPersistence();
  const draft = await fixtureDraft(client.operations, settings.editorId) as { conflicts: string[]; conflictBaselines: { root: string } };
  assert.deepEqual(draft.conflicts, ['root']); assert.equal(draft.conflictBaselines.root, '');
  const restored = new RemoteWorktreeSettings(client, 'ssh:fixture', client.operations); await restored.load(); await restored.restoreDraft(draft);
  assert.deepEqual(restored.getSnapshot().conflicts, ['root']); assert.equal(await restored.save(), false);
});
