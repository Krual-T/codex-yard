import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareStartupThreads, reconcileSidebarThread, sidebarActivity, startupProjectSelection, startupSidebar, visibleSidebarThreads } from '../src/native/startup-sidebar.ts';
import type { StartupThread } from '../src/native/startup-sidebar.ts';
import type { ThreadResponse } from '../lib/codex-protocol.ts';

test('startup metadata respects explicit memberships, project roots and bounded titles without exposing history', () => {
  const globals = {
    'local-projects': { parent: { name: 'Parent', rootPaths: ['/workspace'] }, child: { name: 'Child', rootPaths: ['/workspace/child'] } },
    'thread-project-assignments': { assigned: { projectKind: 'local', projectId: 'parent' }, projectless: { projectKind: 'local', projectId: 'parent' } },
    'projectless-thread-ids': ['projectless'], 'pinned-thread-ids': ['assigned'],
  };
  const common = { cwd: '/workspace/child', turns: [{ private: 'tool-output' }], path: '/private/rollout.jsonl' };
  const result = startupSidebar([
    { ...common, id: 'assigned', name: '  Named thread  ' },
    { ...common, id: 'projectless', preview: 'Preview title\nBody' },
    { ...common, id: 'nested', name: 'x'.repeat(1000) },
    { ...common, id: 'ambient', threadSource: 'ambient_suggestions' },
    { ...common, id: 'temporary', ephemeral: true },
  ], globals);
  assert.deepEqual(result.projects, [{ id: 'parent', label: 'Parent' }, { id: 'child', label: 'Child' }]);
  assert.deepEqual(result.pinnedIds, ['assigned']);
  assert.equal(result.selectedProjectId, null);
  assert.deepEqual(result.threads, [
    { id: 'assigned', title: 'Named thread', projectId: 'parent' },
    { id: 'projectless', title: 'Preview title', projectId: null },
    { id: 'nested', title: 'x'.repeat(240), projectId: 'child' },
  ]);
  assert.equal(startupSidebar(Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), {}).threads.length, 50);
});

test('startup home uses the selected local project and preserves an explicit projectless or remote selection', () => {
  const globals = { 'local-projects': { a: { name: 'First' }, b: { name: 'Selected' } } };
  const selected = (value: object) => startupSidebar([], { ...globals, 'selected-project': value }).selectedProjectId;
  assert.equal(selected({ type: 'local', projectId: 'b' }), 'b');
  assert.equal(selected({ type: 'local', projectId: 'removed' }), null);
  assert.equal(selected({ type: 'projectless' }), null);
  assert.equal(selected({ type: 'remote', projectId: 'b' }), null);
});

test('source startup distinguishes no project from an unavailable saved destination', () => {
  assert.equal(startupProjectSelection(null), null);
  assert.deepEqual(startupProjectSelection({ type: 'local', projectId: 'project-1', root: '/private' }),
    { type: 'local', projectId: 'project-1' });
  assert.deepEqual(startupProjectSelection({ type: 'local', projectId: '' }), { type: 'unavailable' });
  assert.deepEqual(startupProjectSelection({ type: 'remote', projectId: 'project-1', hostId: 'remote' }), { type: 'unavailable' });
});

test('loaded pages retain backend unread, activity and recency so older priority rows sort ahead of the first page', () => {
  const head = startupSidebar([{ id: 'latest', updatedAt: 500 }, { id: 'running', status: { type: 'active' }, updatedAt: 400 }], {});
  const older = startupSidebar([{ id: 'unread', updatedAt: 100 }, { id: 'older', updatedAt: 50 }], {}, {
    unread: { revision: 'r1', firstUnread: { type: 'turn', turnId: 'done' } },
  });
  assert.deepEqual([...head.threads, ...older.threads].sort(compareStartupThreads).map(thread => thread.id),
    ['unread', 'running', 'latest', 'older']);
  const manual = startupSidebar([], { 'local-projects': { project: { name: 'Project' } },
    'sidebar-project-thread-orders': { project: { threadIds: ['older', 'latest'] } } });
  assert.deepEqual(manual.projects[0]?.threadOrder, ['older', 'latest']);
});

const rows = (length: number): StartupThread[] => Array.from({ length }, (_, i) => ({ id: String(i), title: String(i), projectId: 'project' }));

test('project previews keep their history quota at the 4/5/6 boundary and deduplicate IDs', () => {
  for (const length of [4, 5, 6]) {
    const threads = rows(length);
    const view = visibleSidebarThreads(threads, 5);
    assert.deepEqual(view.rows, threads.slice(0, 5));
    assert.equal(view.hidden, Math.max(0, length - 5));
    assert.deepEqual(visibleSidebarThreads(threads, 15).rows, threads);
  }
  const threads = rows(6);
  const view = visibleSidebarThreads([threads[0], ...threads, threads[5]], 5);
  assert.deepEqual(view.rows.map(row => row.id), ['0', '1', '2', '3', '4']);
  assert.equal(view.hidden, 1);
});

test('manual order keeps all loaded working, unread, pending and current chats beyond the preview', () => {
  const threads = rows(30);
  for (let i = 6; i < 13; i++) threads[i].active = true;
  threads[16].unread = true;
  threads[18].attention = 'approval';
  threads[19].attention = 'input';
  const pending = new Set(['21']);
  const expected = [...threads.slice(0, 5), ...threads.slice(6, 13), threads[16], threads[18], threads[19], threads[21], threads[25]];
  const view = visibleSidebarThreads(threads, 5, '25', pending);
  assert.deepEqual(view.rows, expected);
  assert.equal(view.hidden, threads.length - expected.length);
  assert.deepEqual(threads.map(row => row.id), rows(30).map(row => row.id), 'selection does not reorder the stored history');
  assert.equal(visibleSidebarThreads(threads, 15, '25', pending).rows.length, 20, 'expansion adds history without charging important rows twice');
  const recents = visibleSidebarThreads(threads, 20, '25', pending);
  assert.deepEqual(recents.rows.map(row => row.id), [...rows(20).map(row => row.id), '21', '25']);
  assert.equal(recents.hidden, 8);
});

test('collapsed activity counts each thread once and preserves pending work independently of unread', () => {
  const threads = rows(4);
  threads[0].active = true; threads[0].attention = 'input'; threads[0].unread = true;
  threads[1].unread = true;
  const pending = new Set(['0', '2']);
  assert.equal(sidebarActivity([...threads, threads[0]], pending), '1 working · 2 need attention · 1 unread');
  assert.equal(sidebarActivity([]), '');
});

test('startup projects restore backend approval and input flags without storing a second request state', () => {
  const result = startupSidebar([
    { id: 'approval', status: { type: 'active', activeFlags: ['waitingOnApproval'] } },
    { id: 'input', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } },
    { id: 'done', status: { type: 'idle', activeFlags: ['waitingOnApproval'] } },
  ], {});
  assert.deepEqual(result.threads.map(({ id, active, attention }) => ({ id, active, attention })), [
    { id: 'approval', active: true, attention: 'approval' },
    { id: 'input', active: true, attention: 'input' },
    { id: 'done', active: undefined, attention: undefined },
  ]);
});

test('one metadata response replaces activity and read state together while preserving list membership', () => {
  const running: StartupThread = { ...rows(1)[0], active: true, attention: 'approval' };
  const response = (firstUnread: null | { type: 'turn'; turnId: string }): ThreadResponse => ({
    thread: { id: running.id, status: { type: 'idle' }, updatedAt: 42 },
    readState: { revision: 'new', firstUnread },
  } as ThreadResponse);
  const unread = reconcileSidebarThread(running, response({ type: 'turn', turnId: 'answer' }));
  assert.equal(unread.active, undefined);
  assert.equal(unread.attention, undefined);
  assert.equal(unread.unread, true);
  assert.equal(unread.projectId, running.projectId);
  assert.equal(visibleSidebarThreads([...rows(5).map(row => ({ ...row, id: 'prefix-' + row.id })), unread], 5).hidden, 0);
  const read = reconcileSidebarThread(unread, response(null));
  assert.equal(read.unread, undefined);
  assert.equal(visibleSidebarThreads([...rows(5).map(row => ({ ...row, id: 'prefix-' + row.id })), read], 5, read.id).hidden, 0);
});
