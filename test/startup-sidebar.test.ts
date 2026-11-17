import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startupSidebar } from '../src/native/startup-sidebar.ts';

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
  assert.deepEqual(result.threads, [
    { id: 'assigned', title: 'Named thread', projectId: 'parent' },
    { id: 'projectless', title: 'Preview title', projectId: null },
    { id: 'nested', title: 'x'.repeat(240), projectId: 'child' },
  ]);
  assert.equal(startupSidebar(Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), {}).threads.length, 50);
});
