import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig } from '../src/native/protocol.ts';
import { loadComposerPermissions } from '../src/renderer/composer/composer-permissions.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

test('configuration metadata retains the user write precondition without layer values or provider credentials', () => {
  const name = { type: 'user', file: '/fixture/config.toml', profile: 'work' };
  const result = publicConfig({ config: { model: 'fixture', profile: 'work',
    desktop: { 'git-worktree-root': '/fixture/trees', 'worktree-keep-count': 12, token: 'desktop-secret' },
    model_providers: { fixture: { api_key: 'provider-secret' } } },
    layers: [{ name, version: 'version-1', config: { env: { TOKEN: 'layer-secret' } } },
      { name: { type: 'system', file: '/etc/config.toml' }, version: 'version-2', config: 'system-secret' }],
    origins: { model: { name, version: 'version-1', config: 'origin-secret' }, model_providers: 'provider-secret' },
  });
  assert.deepEqual(result.layers, [{ name, version: 'version-1' }]);
  assert.deepEqual(result.origins, { model: { name, version: 'version-1' } });
  assert.deepEqual(result.config.desktop, { 'git-worktree-root': '/fixture/trees', 'worktree-keep-count': 12 });
  assert.doesNotMatch(JSON.stringify(result), /secret|\/etc\/config/);
});

test('workspace configuration defaults only absent fields and reaches the composer permission catalog', async () => {
  const roots = ['/fixture/first', '/fixture/first', '/fixture/second'];
  for (const [raw, expected] of [
    [{}, null],
    [{ sandbox_workspace_write: null }, null],
    [{ sandbox_workspace_write: {} }, { writable_roots: [], network_access: false, exclude_tmpdir_env_var: false, exclude_slash_tmp: false }],
    [{ sandbox_workspace_write: { writable_roots: roots, network_access: true, exclude_slash_tmp: true } },
      { writable_roots: roots, network_access: true, exclude_tmpdir_env_var: false, exclude_slash_tmp: true }],
  ] as const) {
    const response = publicConfig({ config: { sandbox_mode: 'workspace-write', approval_policy: 'on-request', ...raw,
      model_providers: { private: { api_key: 'not-for-renderer' } } } });
    assert.deepEqual(response.config.sandbox_workspace_write, expected);
    assert.doesNotMatch(JSON.stringify(response), /not-for-renderer/);
    const client = { async rpc(method: string) {
      if (method === 'config/read') return response;
      if (method === 'configRequirements/read') return { requirements: null };
      if (method === 'permissionProfile/list') return { data: [], nextCursor: null };
      throw new Error('unexpected RPC');
    } } as unknown as WorkbenchClient;
    const choices = await loadComposerPermissions(client, 'local', '/fixture', undefined, {}, false);
    assert.ok(choices.length > 0);
    if (expected?.network_access) assert.deepEqual(choices.find(choice => choice.id === 'config')?.patch.sandboxPolicy, {
      type: 'workspaceWrite', writableRoots: roots, networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: true,
    });
  }
  const source = { writable_roots: roots, network_access: false };
  const copied = publicConfig({ config: { sandbox_mode: 'workspace-write', sandbox_workspace_write: source } });
  roots.push('/fixture/later');
  assert.deepEqual((copied.config.sandbox_workspace_write as { writable_roots: string[] }).writable_roots,
    ['/fixture/first', '/fixture/first', '/fixture/second']);
  assert.equal(Object.hasOwn(publicConfig({ config: { sandbox_mode: 'read-only' } }).config, 'sandbox_workspace_write'), false);
});

test('workspace projection refuses invalid or unknown fields instead of inventing defaults', () => {
  for (const workspace of [undefined, [], 'invalid', { writable_roots: ['/ok', null] }, { network_access: null },
    { exclude_tmpdir_env_var: 'false' }, { exclude_slash_tmp: 0 }, { writable_roots: [], unknown: 'secret' }]) {
    assert.throws(() => publicConfig({ config: { sandbox_mode: 'workspace-write', sandbox_workspace_write: workspace } }),
      /workspace sandbox configuration cannot be safely represented/);
  }
});
