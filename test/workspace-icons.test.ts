import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPinnedWorkspaceIcons } from '../scripts/build-workspace-icons.ts';
import { workspaceIconNames } from '../src/native/renderer-assets.ts';

test('all declared workspace icons survive resource aliases in the pinned catalog', async () => {
  const icons = await readPinnedWorkspaceIcons();
  for (const key of Object.keys(workspaceIconNames)) assert.ok(icons[key]?.shapes.length, 'Missing icon: ' + key);
  assert.deepEqual(icons.pencil, icons['project:edit']);
  assert.equal(icons.questionChevron?.viewBox, '0 0 20 21');
});
