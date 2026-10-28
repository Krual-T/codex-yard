import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeThreadProjectCatalog } from '../src/native/thread-project-catalog.ts';
import { createThreadProjectInventory } from '../src/native/thread-project-inventory.ts';
import { readThreadProjectState } from '../src/native/thread-projects.ts';

test('catalog restart imports preserve host clears, unknown envelopes and conflicting legacy assignments', () => {
  const local = { projectKind: 'local', projectId: 'one' }, incoming = { projectKind: 'local', projectId: 'two' };
  const original = { $codexYardThreadProjects: 1, legacy: { t: local }, hosts: { local: { t: null } }, future: { keep: true } };
  const merged = mergeThreadProjectCatalog(original, { t: incoming, fresh: local });
  const reloaded = mergeThreadProjectCatalog(JSON.parse(JSON.stringify(merged)), { t: incoming, fresh: local });
  assert.deepEqual(merged, reloaded);
  assert.deepEqual(reloaded, { ...original, legacy: { t: { $codexYardAssignmentConflict: 1, values: [local, incoming] }, fresh: local } });
  assert.equal(mergeThreadProjectCatalog(null, {}), null);
  assert.deepEqual(mergeThreadProjectCatalog(['opaque'], { t: incoming }), { $codexYardUnreadableAssignments: 1, existing: ['opaque'], incoming: { t: incoming } });
});

test('legacy resolver requires every current and archived page across hosts and never assigns collisions to local', async () => {
  let failRemote = false;
  const calls: { host: string; archived: unknown; cursor: unknown }[] = [];
  const inventory = createThreadProjectInventory(['local', 'ssh-one'], async host => ({ async request(_method, params) {
    calls.push({ host, archived: params.archived, cursor: params.cursor });
    if (host === 'ssh-one' && failRemote) throw new Error('offline');
    const data = params.archived ? [{ id: 'archived-' + host }] : params.cursor ? [{ id: 'second-' + host }] : [{ id: 'shared' }, { id: 'only-' + host }];
    return { data, nextCursor: !params.archived && !params.cursor ? 'next' : null };
  } }));
  assert.equal(inventory.compatibility.resolveLegacyThreadHosts('only-local'), undefined);
  assert.equal((await inventory.refresh()).complete, true); assert.equal(calls.length, 6);
  assert.deepEqual(inventory.compatibility.resolveLegacyThreadHosts('archived-ssh-one'), ['ssh-one']);
  assert.deepEqual(inventory.compatibility.resolveLegacyThreadHosts('shared'), ['local', 'ssh-one']);
  assert.deepEqual(inventory.compatibility.resolveLegacyThreadHosts('absent'), []);
  const globals = { 'thread-project-assignments': { shared: { projectKind: 'local', projectId: 'p' }, 'only-local': { projectKind: 'local', projectId: 'p' } } };
  const snapshot = readThreadProjectState(globals, inventory.compatibility);
  assert.deepEqual(snapshot.memberships.map(value => [value.hostId, value.threadId]), [['local', 'only-local']]);
  assert.ok(snapshot.unresolved.assignments.shared);
  failRemote = true; assert.equal((await inventory.refresh()).complete, false);
  assert.equal(inventory.compatibility.resolveLegacyThreadHosts('only-local'), undefined);
  assert.equal(readThreadProjectState(globals, inventory.compatibility).memberships.length, 0);
});
