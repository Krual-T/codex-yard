import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig } from '../src/native/protocol.ts';

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
