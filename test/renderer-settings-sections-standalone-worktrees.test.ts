import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { readRemoteWorktreePreferences, RemoteWorktreeSettings } from '../src/renderer/settings/worktrees.ts';

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
  desktop: Record<string, unknown> = {};
  version = 'v1';
  layers: unknown = null;
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  conflict = false;
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  subscribe() { return () => {}; }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method: endpoint, params });
    if (endpoint !== 'codex-home') throw new Error('Unexpected host access');
    return { codexHome: '/fixture/remote' } as T;
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    if (method === 'config/read') return { config: { desktop: { ...this.desktop }, profile: null }, layers: this.layers ?? [
      { name: { type: 'user', file: '/fixture/remote/config.toml', profile: null }, version: this.version },
    ] } as T;
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

test('remote worktree edits write only the selected host desktop keys with a verified version', async () => {
  const client = new RemoteClient(), settings = new RemoteWorktreeSettings(client, 'ssh:fixture');
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
  assert.deepEqual(client.calls.find(call => call.method === 'codex-home')?.params, { hostId: 'ssh:fixture' });
  assert.equal(settings.dirty, false);
});

test('remote worktree failures, conflicts and missing versions preserve the draft', async () => {
  const client = new RemoteClient(), settings = new RemoteWorktreeSettings(client, 'ssh:fixture');
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
