import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { readRemoteWorktreePreferences } from '../src/renderer/settings/worktrees.ts';

test('remote worktrees use the selected host and reject filtered or invalid desktop config', async () => {
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
  await assert.rejects(readRemoteWorktreePreferences(client, 'ssh:fixture'), /does not expose/);
  response = { config: { desktop: { 'worktree-keep-count': 0 } } };
  await assert.rejects(readRemoteWorktreePreferences(client, 'ssh:fixture'), /invalid value/);
  response = { config: { desktop: {} } };
  assert.deepEqual(await readRemoteWorktreePreferences(client, 'ssh:fixture'), { root: '', autoCleanup: true, keepCount: 15 });
});
