import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverSshAliases, loadHostCatalog, publicHost } from '../src/native/hosts.ts';

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

test('SSH discovery follows quoted Include files, ignores comments and host patterns, and terminates include cycles', async t => {
  const root = await mkdtemp('/tmp/yard-ssh-config-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'conf.d'));
  await writeFile(join(root, 'config'), 'Host work laptop *.example !excluded # comment is not an alias\nInclude "conf.d/*.conf" missing\n');
  await writeFile(join(root, 'conf.d/hosts.conf'), 'Host "quoted" work\nInclude config\n');
  assert.deepEqual(await discoverSshAliases(join(root, 'config')), ['laptop', 'quoted', 'work']);
  assert.deepEqual(await discoverSshAliases(join(root, 'absent')), []);
});
