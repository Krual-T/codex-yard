import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadHostCatalog, publicHost } from '../src/native/hosts.ts';

test('desktop SSH profiles and project memberships are read without changing native state or exposing identity files', async t => {
  const root = await mkdtemp('/tmp/aw-hosts-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const hostId = 'remote-ssh-discovered:work';
  const state = JSON.stringify({
    'codex-managed-remote-connections': [{ hostId, alias: 'work', hostname: null, displayName: 'Work', identity: '/private/id' },
      { hostId: 'remote-ssh-discovered:invalid', alias: '-F /other/config' }],
    'remote-projects': [{ id: 'project', hostId, remotePath: '/srv/project', label: 'Project' }, { id: 'stale', hostId: 'unknown', remotePath: '/stale' }],
    'thread-project-assignments': { remote: { projectKind: 'remote', hostId, projectId: 'project' }, local: { projectKind: 'local', projectId: '/local' } },
    secret: 'not-for-the-web',
  });
  const path = join(root, '.codex-global-state.json');
  await writeFile(path, state);
  const catalog = await loadHostCatalog(root);
  assert.equal(catalog.hosts.length, 1);
  assert.equal(catalog.projects.length, 1);
  assert.deepEqual(Object.keys(catalog.assignments), ['remote']);
  assert.doesNotMatch(JSON.stringify(catalog.hosts.map(publicHost)), /\/private\/id|not-for-the-web/);
  assert.equal(await readFile(path, 'utf8'), state);
});
