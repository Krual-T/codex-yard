import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSettingsOrigin, readSettingsOrigin, readSettingsOriginURL, resolveSettingsOrigin, settingsOriginURL } from '../src/renderer/app/settings-origin.ts';
import { hostPath, readSettingsRoute, sectionPath } from '../src/renderer/settings/routing.ts';
import type { SettingsOrigin } from '../src/renderer/app/settings-origin.ts';
import type { ProjectState } from '../src/renderer/app/projects.ts';

const state = (): ProjectState => ({
  memberships: [], outputDirectories: [], workspaceRoots: [],
  unresolved: { assignments: {}, projectless: [], outputDirectories: {}, workspaceRoots: {}, unreadable: {}, qualified: [] },
  inventory: { complete: true, errors: {} },
  catalog: { local: { local: { id: 'local', name: 'Local', rootPaths: ['/same'] } },
    remote: [{ id: 'remote', hostId: 'remote-ssh-one', remotePath: '/same', label: 'Remote' }] },
});
const origin: SettingsOrigin = { hostId: 'remote-ssh-one', returnTo: '/local/same?hostId=remote-ssh-one#message', source: { kind: 'thread', threadId: 'same' } };

test('settings history preserves exact source and return route before a conversation has loaded', async () => {
  const captured = captureSettingsOrigin({ hostId: origin.hostId, threadId: 'same', pathname: '/local/same', search: '?hostId=remote-ssh-one', hash: '#message' }, null);
  const first = { search: 'hooks', __yardSettingsOrigin: captured };
  const reloaded = JSON.parse(JSON.stringify(first));
  assert.deepEqual(readSettingsOrigin(reloaded), origin);
  assert.equal((reloaded as { search: string }).search, 'hooks');
  assert.deepEqual(readSettingsOriginURL(new URL(settingsOriginURL('/settings/general', readSettingsOrigin(reloaded)), 'https://yard.invalid').search), origin);
  const projects = state();
  projects.memberships.push({ hostId: origin.hostId, threadId: 'same', assignment: { projectKind: 'remote', projectId: 'remote', hostId: origin.hostId }, projectless: false });
  const calls: unknown[] = [];
  const resolved = await resolveSettingsOrigin(readSettingsOrigin(reloaded), origin.hostId, projects, async (hostId, threadId) => {
    calls.push([hostId, threadId]); return { thread: { id: threadId, cwd: '/actual-session' } };
  });
  assert.deepEqual(calls, [[origin.hostId, 'same']]);
  assert.deepEqual(resolved, { projectRoots: { hostId: origin.hostId, paths: ['/same'] }, sessionCwd: { hostId: origin.hostId, path: '/actual-session' } });
});

test('settings sources do not borrow same-ID hosts or infer project membership from cwd', async () => {
  let calls = 0;
  const read = async () => { calls++; return { thread: { id: 'same', cwd: '/same' } }; };
  assert.deepEqual(await resolveSettingsOrigin(origin, 'local', state(), read), { projectRoots: null, sessionCwd: null });
  assert.equal(calls, 0);
  const resolved = await resolveSettingsOrigin(origin, origin.hostId, state(), read);
  assert.deepEqual(resolved, { projectRoots: null, sessionCwd: { hostId: origin.hostId, path: '/same' } });
  const unresolved = state(); unresolved.unresolved.assignments.same = { projectKind: 'remote', projectId: 'remote' };
  await assert.rejects(resolveSettingsOrigin(origin, origin.hostId, unresolved, read), /unresolved/);
  await assert.rejects(resolveSettingsOrigin(origin, origin.hostId, null, read), /not loaded/);
});

test('copied settings URLs preserve identities and return routes through section and host navigation', async () => {
  const url = new URL(settingsOriginURL('/settings/hooks?tab=all', origin), 'https://yard.invalid');
  assert.deepEqual(readSettingsOriginURL(url.search), origin);
  const route = readSettingsRoute({ pathname: url.pathname, search: url.search, hash: '', state: null }, 'local');
  const section = new URL(sectionPath('skills-settings', route), url);
  assert.deepEqual(readSettingsOriginURL(section.search), origin);
  const foreign = new URL(hostPath('other-host', route), url);
  const fromURL = readSettingsOriginURL(foreign.search);
  assert.deepEqual(fromURL, origin);
  assert.deepEqual(await resolveSettingsOrigin(fromURL, 'other-host', null, async () => { throw new Error('Wrong host source must not read'); }),
    { projectRoots: null, sessionCwd: null });
  assert.equal(fromURL?.returnTo, '/local/same?hostId=remote-ssh-one#message');
  assert.equal(readSettingsOriginURL('?yardSettingsOrigin=invalid'), null);
  assert.throws(() => settingsOriginURL('/settings/general', { ...origin, returnTo: '/\\external.example' }), /invalid/);
  assert.throws(() => settingsOriginURL('//external.example/settings', origin), /origin/);
});

test('home settings use the selected project identity and resolve its current roots after reload', async () => {
  const captured = captureSettingsOrigin({ hostId: 'local', threadId: null, pathname: '/', search: '', hash: '' },
    { id: 'local', hostId: 'local', name: 'Local', rootPaths: ['/old'] });
  const projects = state();
  assert.deepEqual(await resolveSettingsOrigin(captured, 'local', projects, async () => { throw new Error('not a thread'); }),
    { projectRoots: { hostId: 'local', paths: ['/same'] }, sessionCwd: null });
  projects.catalog.local = {};
  await assert.rejects(resolveSettingsOrigin(captured, 'local', projects, async () => null), /unavailable/);
  assert.equal(readSettingsOrigin({}), null);
  assert.equal(readSettingsOrigin({ __yardSettingsOrigin: { ...origin, returnTo: '//external.example' } }), null);
  assert.deepEqual(await resolveSettingsOrigin(null, 'local', null, async () => null), { projectRoots: null, sessionCwd: null });
});
