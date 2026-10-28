import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createThreadProjects, readThreadProjectState, threadProjectIdentityKey } from '../src/native/thread-projects.ts';
import type { IdentifiedMembership, ThreadProjectCompatibility } from '../src/native/thread-projects.ts';
import type { ObjectValue } from '../src/native/protocol.ts';

const remote = 'remote-ssh-fixture';
const otherRemote = 'remote-ssh-other';
const localProject = { projectKind: 'local', projectId: '/work' } as const;
const remoteProject = { projectKind: 'remote', projectId: 'remote-work', hostId: remote } as const;
const projects = [{ id: 'remote-work', hostId: remote }, { id: 'other-work', hostId: otherRemote }];
const validHost = (hostId: string) => { if (!['local', remote, otherRemote, '__proto__'].includes(hostId)) throw new Error('unknown host'); };

function harness(globals: ObjectValue = {}, compatibility: ThreadProjectCompatibility = {}) {
  const events: ObjectValue[] = [];
  const saved: ObjectValue[] = [];
  let failure = false;
  const request = createThreadProjects(globals, async () => {
    if (failure) throw new Error('disk full');
    saved.push(structuredClone(globals));
  }, event => events.push(event as ObjectValue), validHost, compatibility);
  return { globals, events, saved, request, fail: (value: boolean) => { failure = value; },
    state: () => readThreadProjectState(globals, compatibility) };
}
function member(memberships: IdentifiedMembership[], hostId: string, threadId: string) {
  return memberships.find(item => item.hostId === hostId && item.threadId === threadId);
}
function hint(hints: { hostId: string; threadId: string; value: string }[], hostId: string, threadId: string) {
  return hints.find(item => item.hostId === hostId && item.threadId === threadId)?.value;
}

test('same thread ID has separate memberships, move, undo, hints, tombstones and host reset', async () => {
  const h = harness({ 'remote-projects': projects });
  const id = 'same-thread';
  await Promise.all([
    h.request('setMembership', { hostId: 'local', threadId: id, assignment: localProject, projectless: false }),
    h.request('setMembership', { hostId: remote, threadId: id, assignment: remoteProject, projectless: false }),
  ]);
  let state = h.state();
  assert.deepEqual(member(state.memberships, 'local', id)?.assignment, localProject);
  assert.deepEqual(member(state.memberships, remote, id)?.assignment, remoteProject);
  const membershipEvents = h.events.filter(event => event.type === 'thread-project-memberships-updated');
  const payload = membershipEvents[1].memberships as ObjectValue;
  assert.deepEqual(payload[threadProjectIdentityKey({ hostId: remote, threadId: id })],
    { hostId: remote, threadId: id, assignment: remoteProject, projectless: false });

  const undo = await h.request('moveLocalProjectThreadsToProjectless', '/work');
  assert.deepEqual(undo, [{ hostId: 'local', threadId: id, assignment: localProject, projectless: false }]);
  state = h.state();
  assert.deepEqual(member(state.memberships, 'local', id), { hostId: 'local', threadId: id, assignment: null, projectless: true });
  assert.deepEqual(member(state.memberships, remote, id)?.assignment, remoteProject);
  await h.request('restoreMemberships', undo);
  assert.deepEqual(member(h.state().memberships, 'local', id)?.assignment, localProject);

  await h.request('updateProjectlessThread', { hostId: 'local', threadId: id, projectless: true, outputDirectory: '/local/out', workspaceRoot: '/local/root' });
  await h.request('updateProjectlessThread', { hostId: remote, threadId: id, projectless: true, outputDirectory: '/remote/out', workspaceRoot: '/remote/root' });
  await h.request('updateProjectlessThread', { hostId: 'local', threadId: id, projectless: false, outputDirectory: null });
  await h.request('updateProjectlessThread', { hostId: remote, threadId: id, projectless: true, outputDirectory: '/remote/updated' });
  await h.request('updateProjectlessThread', { hostId: 'local', threadId: id, projectless: true, outputDirectory: '/stale' });
  state = h.state();
  assert.equal(hint(state.outputDirectories, 'local', id), undefined);
  assert.equal(hint(state.workspaceRoots, 'local', id), undefined);
  assert.equal(hint(state.outputDirectories, remote, id), '/remote/updated');
  assert.equal(hint(state.workspaceRoots, remote, id), '/remote/root');
  assert.equal(member(state.memberships, remote, id)?.projectless, true);
  await h.request('setProjectless', { hostId: 'local', threadId: id, projectless: true });
  await h.request('updateProjectlessThread', { hostId: 'local', threadId: id, outputDirectory: '/local/new' });
  assert.equal(hint(h.state().outputDirectories, 'local', id), '/local/new');

  await h.request('reset', { hostId: 'local' });
  state = h.state();
  assert.equal(member(state.memberships, 'local', id), undefined);
  assert.deepEqual(member(state.memberships, remote, id), { hostId: remote, threadId: id, assignment: remoteProject, projectless: true });
  const reloaded = readThreadProjectState(JSON.parse(JSON.stringify(h.globals)));
  assert.deepEqual(member(reloaded.memberships, remote, id), member(state.memberships, remote, id));
  assert.equal(hint(reloaded.outputDirectories, remote, id), '/remote/updated');
  await h.request('reset', { hostId: remote });
  assert.equal(member(h.state().memberships, remote, id), undefined);
});

test('legacy assignment targets need independently verified thread hosts; unknown data stays preserved', async () => {
  const unknownAssignment = { projectKind: 'remote', projectId: 'missing' };
  const legacyAssignments = {
    local: localProject,
    remote: remoteProject,
    inferred: { projectKind: 'remote', projectId: 'remote-work' },
    ambiguous: { projectKind: 'remote', projectId: 'duplicate' },
    unknown: unknownAssignment,
  };
  const h = harness({
    'remote-projects': [...projects, { id: 'duplicate', hostId: remote }, { id: 'duplicate', hostId: otherRemote }],
    'thread-project-assignments': structuredClone(legacyAssignments),
    'projectless-thread-ids': ['local', 'remote', 'unknown'],
    'thread-projectless-output-directories': { local: '/old/out', remote: '/old/remote' },
    'thread-workspace-root-hints': { remote: '/old/root' },
  });
  let state = h.state();
  assert.deepEqual(state.memberships, []);
  assert.deepEqual(state.unresolved.assignments, legacyAssignments);
  assert.deepEqual(state.unresolved.projectless, ['local', 'remote', 'unknown']);
  assert.deepEqual(state.unresolved.outputDirectories, { local: '/old/out', remote: '/old/remote' });
  assert.deepEqual(state.unresolved.workspaceRoots, { remote: '/old/root' });

  const verified = harness({ 'remote-projects': h.globals['remote-projects'], 'thread-project-assignments': legacyAssignments }, {
    resolveLegacyThreadHosts: threadId => ({ local: ['local'], remote: [remote], inferred: [remote],
      ambiguous: [remote], unknown: [remote] } as Record<string, string[]>)[threadId],
  }).state();
  assert.deepEqual(member(verified.memberships, 'local', 'local')?.assignment, localProject);
  assert.deepEqual(member(verified.memberships, remote, 'remote')?.assignment, remoteProject);
  assert.deepEqual(member(verified.memberships, remote, 'inferred')?.assignment, remoteProject);
  assert.deepEqual(verified.unresolved.assignments, { ambiguous: legacyAssignments.ambiguous, unknown: unknownAssignment });

  await h.request('setAssignment', { hostId: 'local', threadId: 'unknown', assignment: localProject });
  await h.request('setProjectless', { hostId: remote, threadId: 'remote', projectless: true });
  state = h.state();
  assert.deepEqual(state.unresolved.assignments.unknown, unknownAssignment);
  assert.deepEqual(state.unresolved.projectless, ['local', 'remote', 'unknown']);
  assert.deepEqual(member(state.memberships, 'local', 'unknown')?.assignment, localProject);
  assert.equal(member(state.memberships, remote, 'remote')?.projectless, true);
  await h.request('reset');
  state = h.state();
  assert.deepEqual(state.unresolved.assignments, legacyAssignments);
  assert.deepEqual(state.unresolved.projectless, ['local', 'remote', 'unknown']);
  assert.deepEqual(state.unresolved.outputDirectories, { local: '/old/out', remote: '/old/remote' });
});

test('complete host resolution migrates only matching legacy fields and preserves collisions', async () => {
  const hosts: Record<string, string[] | undefined> = { local: ['local'], remote: [remote], collision: ['local', remote], orphan: [] };
  const compatibility = { resolveLegacyThreadHosts: (threadId: string) => hosts[threadId] };
  const h = harness({
    'remote-projects': projects,
    'thread-project-assignments': { local: localProject, remote: remoteProject, collision: localProject },
    'projectless-thread-ids': ['local', 'remote', 'collision', 'orphan'],
    'thread-projectless-output-directories': { local: '/local', remote: '/remote', collision: '/collision' },
    'thread-workspace-root-hints': { remote: '/remote/root', collision: '/collision/root' },
  }, compatibility);
  let state = h.state();
  assert.equal(member(state.memberships, 'local', 'local')?.projectless, true);
  assert.equal(member(state.memberships, remote, 'remote')?.projectless, true);
  assert.deepEqual(state.unresolved.assignments, { collision: localProject });
  assert.deepEqual(state.unresolved.projectless, ['collision', 'orphan']);
  assert.equal(hint(state.outputDirectories, remote, 'remote'), '/remote');
  await h.request('updateProjectlessThread', { hostId: remote, threadId: 'remote', projectless: false, outputDirectory: null });
  state = h.state();
  assert.equal(hint(state.outputDirectories, remote, 'remote'), undefined);
  assert.equal(hint(state.workspaceRoots, remote, 'remote'), undefined);
  assert.equal(hint(state.outputDirectories, 'local', 'local'), '/local');
  assert.deepEqual(state.unresolved.outputDirectories, { collision: '/collision' });
  await h.request('reset', { hostId: 'local' });
  state = h.state();
  assert.equal(member(state.memberships, 'local', 'local'), undefined);
  assert.deepEqual(state.unresolved.assignments, { collision: localProject });
  assert.deepEqual(state.unresolved.projectless, ['collision', 'orphan']);
});

test('contradictory qualified evidence prevents an incomplete resolver from assigning legacy data', async () => {
  const compatibility = { resolveLegacyThreadHosts: () => ['local'] };
  const h = harness({ 'projectless-thread-ids': ['same'], 'thread-projectless-output-directories': { same: '/old' } }, compatibility);
  assert.equal(member(h.state().memberships, 'local', 'same')?.projectless, true);
  await h.request('setProjectless', { hostId: remote, threadId: 'same', projectless: true });
  const state = h.state();
  assert.deepEqual(state.unresolved.projectless, ['same']);
  assert.deepEqual(state.unresolved.outputDirectories, { same: '/old' });
  assert.equal(member(state.memberships, 'local', 'same'), undefined);
  assert.equal(member(state.memberships, remote, 'same')?.projectless, true);
  const event = h.events.find(item => item.type === 'thread-project-memberships-updated')!;
  const memberships = event.memberships as ObjectValue;
  assert.deepEqual(memberships[threadProjectIdentityKey({ hostId: 'local', threadId: 'same' })],
    { hostId: 'local', threadId: 'same', assignment: null, projectless: false });
  assert.deepEqual(memberships[threadProjectIdentityKey({ hostId: remote, threadId: 'same' })],
    { hostId: remote, threadId: 'same', assignment: null, projectless: true });
  await h.request('reset', { hostId: remote });
  assert.equal(member(h.state().memberships, 'local', 'same'), undefined);
  assert.deepEqual(h.state().unresolved.projectless, ['same']);
});

test('explicit clears remain authoritative when legacy resolves and after storage reload', async () => {
  let resolved = false;
  const compatibility = { resolveLegacyThreadHosts: (id: string) => resolved && id === 'fixture' ? ['local'] : undefined };
  const h = harness({
    'thread-project-assignments': { fixture: localProject, other: localProject },
    'projectless-thread-ids': ['fixture', 'other'],
    'thread-projectless-output-directories': { fixture: '/old-output', other: '/other-output' },
    'thread-workspace-root-hints': { fixture: '/old-workspace', other: '/other-workspace' },
  }, compatibility);
  await h.request('setMembership', { hostId: 'local', threadId: 'fixture', assignment: null, projectless: false });
  await h.request('updateProjectlessThread', { hostId: 'local', threadId: 'fixture', outputDirectory: null, workspaceRoot: null });
  assert.equal(member(h.state().memberships, 'local', 'fixture'), undefined);
  assert.deepEqual(h.state().unresolved.assignments, { fixture: localProject, other: localProject });
  resolved = true;
  for (const state of [h.state(), readThreadProjectState(JSON.parse(JSON.stringify(h.globals)), compatibility)]) {
    assert.equal(member(state.memberships, 'local', 'fixture'), undefined);
    assert.equal(hint(state.outputDirectories, 'local', 'fixture'), undefined);
    assert.equal(hint(state.workspaceRoots, 'local', 'fixture'), undefined);
    assert.deepEqual(state.unresolved.assignments, { other: localProject });
    assert.deepEqual(state.unresolved.projectless, ['other']);
    assert.deepEqual(state.unresolved.outputDirectories, { other: '/other-output' });
    assert.deepEqual(state.unresolved.workspaceRoots, { other: '/other-workspace' });
  }
  for (const key of ['thread-project-assignments', 'projectless-thread-ids', 'thread-projectless-output-directories', 'thread-workspace-root-hints']) {
    const legacy = (h.globals[key] as ObjectValue).legacy;
    assert.ok(Array.isArray(legacy) ? legacy.includes('fixture') && legacy.includes('other') : Object.hasOwn(legacy as object, 'fixture') && Object.hasOwn(legacy as object, 'other'));
  }
});

test('clear markers retain host identity and can be replaced by later explicit updates', async () => {
  const h = harness({ 'remote-projects': projects });
  await h.request('setMembership', { hostId: remote, threadId: 'chat', assignment: null, projectless: false });
  await h.request('setProjectless', { threadId: 'chat', projectless: true });
  assert.equal(member(h.state().memberships, remote, 'chat')?.projectless, true);
  assert.equal(member(h.state().memberships, 'local', 'chat'), undefined);
  await h.request('setAssignment', { hostId: remote, threadId: 'chat', assignment: remoteProject });
  assert.deepEqual(member(h.state().memberships, remote, 'chat')?.assignment, remoteProject);
});

test('unreadable qualified entries suppress legacy views and cannot be overwritten', async () => {
  const h = harness({
    'projectless-thread-ids': { $codexYardThreadProjects: 1, legacy: ['chat'], hosts: { local: { chat: 'invalid' } } },
    'thread-projectless-output-directories': { $codexYardThreadProjects: 1, legacy: { chat: '/old' }, hosts: { local: { chat: 42 } } },
  }, { resolveLegacyThreadHosts: () => ['local'] });
  const state = h.state();
  assert.equal(member(state.memberships, 'local', 'chat')?.projectless, false);
  assert.equal(hint(state.outputDirectories, 'local', 'chat'), undefined);
  assert.equal(state.unresolved.qualified.length, 2);
  const before = structuredClone(h.globals);
  await assert.rejects(h.request('setProjectless', { hostId: 'local', threadId: 'chat', projectless: false }), /无法解析/);
  await assert.rejects(h.request('updateProjectlessThread', { hostId: 'local', threadId: 'chat', outputDirectory: null }), /无法解析/);
  assert.deepEqual(h.globals, before);
});

test('hostless calls infer only defensible identities and cross-host projects are rejected', async () => {
  const h = harness({ 'remote-projects': projects, 'projectless-thread-ids': ['unknown'],
    'thread-project-assignments': { 'old-remote': remoteProject } });
  await h.request('setAssignment', { threadId: 'remote-a', assignment: remoteProject });
  await h.request('setProjectless', { threadId: 'remote-a', projectless: true });
  await h.request('setAssignment', { threadId: 'remote-b', assignment: { projectKind: 'remote', projectId: 'remote-work' } });
  await h.request('setAssignment', { threadId: 'new-local', assignment: localProject });
  assert.equal(member(h.state().memberships, remote, 'remote-a')?.projectless, true);
  assert.deepEqual(member(h.state().memberships, remote, 'remote-b')?.assignment, remoteProject);
  assert.deepEqual(member(h.state().memberships, 'local', 'new-local')?.assignment, localProject);
  await assert.rejects(h.request('setProjectless', { threadId: 'unknown', projectless: false }), /主机不明确/);
  await assert.rejects(h.request('setAssignment', { threadId: 'old-remote', assignment: localProject }), /主机不明确/);
  await assert.rejects(h.request('setAssignment', { threadId: 'old-remote', assignment: remoteProject }), /主机不明确/);
  await assert.rejects(h.request('setAssignment', { threadId: 'remote-a', assignment: localProject }), /主机不明确/);
  await assert.rejects(h.request('setAssignment', { hostId: 'local', threadId: 'x', assignment: remoteProject }), /主机不一致/);
  await assert.rejects(h.request('setAssignment', { hostId: remote, threadId: 'x', assignment: localProject }), /主机不一致/);
  await assert.rejects(h.request('setAssignment', { hostId: otherRemote, threadId: 'x', assignment: { projectKind: 'remote', projectId: 'remote-work' } }), /主机不一致/);
  await assert.rejects(h.request('setAssignment', { threadId: 'x', assignment: { projectKind: 'remote', projectId: 'missing' } }), /明确的执行主机/);
  await h.request('setProjectless', { hostId: 'local', threadId: 'remote-a', projectless: true });
  await assert.rejects(h.request('setProjectless', { threadId: 'remote-a', projectless: false }), /主机不明确/);
  await assert.rejects(h.request('moveLocalProjectThreadsToProjectless', { hostId: remote, projectId: '/work' }), /本机项目/);
});

test('ambiguous legacy membership is not treated as unassigned and invalid batches are atomic', async () => {
  const h = harness({
    'thread-project-assignments': { collision: { projectKind: 'remote', projectId: 'unresolved' } },
    'projectless-thread-ids': ['unresolved-projectless'],
  });
  await h.request('assignIfUnassigned', [
    { hostId: 'local', threadId: 'collision', assignment: localProject, projectless: false },
    { hostId: 'local', threadId: 'unresolved-projectless', assignment: localProject, projectless: false },
    { hostId: 'local', threadId: 'fresh', assignment: localProject, projectless: false },
  ]);
  assert.equal(member(h.state().memberships, 'local', 'collision'), undefined);
  assert.equal(member(h.state().memberships, 'local', 'unresolved-projectless'), undefined);
  assert.deepEqual(member(h.state().memberships, 'local', 'fresh')?.assignment, localProject);
  const before = structuredClone(h.globals), eventCount = h.events.length;
  await assert.rejects(h.request('restoreMemberships', [
    { hostId: 'local', threadId: 'fresh', assignment: null, projectless: true },
    { hostId: remote, threadId: 'bad', assignment: localProject, projectless: false },
  ]), /主机不一致/);
  assert.deepEqual(h.globals, before);
  assert.equal(h.events.length, eventCount);
});

test('failed persistence rolls back legacy migration, hints, events and removal tombstones', async () => {
  const compatibility = { resolveLegacyThreadHosts: () => [remote] };
  const h = harness({
    'projectless-thread-ids': ['chat'],
    'thread-projectless-output-directories': { chat: '/old/out' },
    'thread-workspace-root-hints': { chat: '/old/root' },
  }, compatibility);
  const before = structuredClone(h.globals);
  h.fail(true);
  await assert.rejects(h.request('updateProjectlessThread', { hostId: remote, threadId: 'chat', projectless: false, outputDirectory: null }), /disk full/);
  assert.deepEqual(h.globals, before);
  assert.deepEqual(h.events, []);
  h.fail(false);
  await h.request('updateProjectlessThread', { hostId: remote, threadId: 'chat', projectless: true, outputDirectory: '/new/out' });
  assert.equal(hint(h.state().outputDirectories, remote, 'chat'), '/new/out');
  await h.request('updateProjectlessThread', { hostId: remote, threadId: 'chat', projectless: false, outputDirectory: null });
  assert.equal(hint(h.state().workspaceRoots, remote, 'chat'), undefined);
  assert.deepEqual(h.state().unresolved.projectless, []);
});

test('concurrent writes serialize across hosts and continue after a persistence failure', async () => {
  const globals: ObjectValue = { 'remote-projects': projects }, events: ObjectValue[] = [];
  let inFlight = 0, maximum = 0, attempts = 0;
  const request = createThreadProjects(globals, async () => {
    inFlight++; maximum = Math.max(maximum, inFlight); const attempt = ++attempts;
    await delay(3);
    inFlight--;
    if (attempt === 1) throw new Error('first write failed');
  }, event => events.push(event as ObjectValue), validHost);
  const results = await Promise.allSettled([
    request('setAssignment', { hostId: 'local', threadId: 'same', assignment: localProject }),
    request('setAssignment', { hostId: remote, threadId: 'same', assignment: remoteProject }),
    request('setAssignment', { hostId: 'local', threadId: 'same', assignment: localProject }),
    request('setProjectless', { hostId: remote, threadId: 'same', projectless: true }),
  ]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal(maximum, 1);
  const state = readThreadProjectState(globals);
  assert.deepEqual(member(state.memberships, 'local', 'same')?.assignment, localProject);
  assert.deepEqual(member(state.memberships, remote, 'same'), { hostId: remote, threadId: 'same', assignment: remoteProject, projectless: true });
  assert.equal(events.filter(event => event.type === 'thread-project-memberships-updated').length, 3);
});

test('host and thread keys are data, including prototype names and delimiter-like strings', async () => {
  const h = harness();
  const identity = { hostId: '__proto__', threadId: '__proto__' };
  await h.request('setProjectless', { ...identity, projectless: true });
  assert.equal(member(h.state().memberships, identity.hostId, identity.threadId)?.projectless, true);
  await h.request('setMembership', { hostId: '__proto__', threadId: 'toString', assignment: null, projectless: false });
  await h.request('setProjectless', { threadId: 'toString', projectless: true });
  assert.equal(member(h.state().memberships, '__proto__', 'toString')?.projectless, true);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'projectless'), false);
  assert.notEqual(threadProjectIdentityKey({ hostId: 'a:b', threadId: 'c' }), threadProjectIdentityKey({ hostId: 'a', threadId: 'b:c' }));
});
