import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createPreferenceWrites } from '../src/native/preference-writes.ts';
import { createThreadProjects } from '../src/native/thread-projects.ts';
import { createPetOverlay } from '../src/native/pet-overlay.ts';

test('a failed project mutation is rolled back before a concurrent preference snapshot is captured', async () => {
  const globals: Record<string, unknown> = {}, settings: Record<string, unknown> = {};
  const mutations = createStateMutations(), writes: unknown[] = [], events: unknown[] = [];
  let rejectFirst: (error: Error) => void = () => {};
  let first = true;
  const persist = async () => {
    // Capture exactly as server.ts does, before its file queue.
    const snapshot = JSON.parse(JSON.stringify({ globals, settings }));
    if (first) { first = false; await new Promise((_resolve, reject) => { rejectFirst = reject; }); }
    writes.push(snapshot);
  };
  const projects = createThreadProjects(globals, persist, value => events.push(value), undefined, {}, mutations);
  const preferences = createPreferenceWrites(settings, globals, persist, value => events.push(value), () => {}, mutations);
  const failed = assert.rejects(projects('setMembership', { hostId: 'local', threadId: 'fixture',
    assignment: { projectKind: 'local', projectId: 'fixture-project' }, projectless: false }), /disk full/);
  const saved = preferences('setting', 'theme', 'dark');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(settings, {});
  rejectFirst(new Error('disk full'));
  await failed; await saved; await mutations.flush();
  assert.deepEqual(globals, {});
  assert.deepEqual(writes, [{ globals: {}, settings: { theme: 'dark' } }]);
  assert.deepEqual(events, [{ type: 'settings-changed', keys: ['theme'] }]);
});

test('failed preferences and queued pet toggles share the same commit interval', async () => {
  const globals: Record<string, unknown> = {}, settings: Record<string, unknown> = { theme: 'light' };
  const mutations = createStateMutations(), snapshots: unknown[] = [];
  let rejectFirst: (error: Error) => void = () => {}, first = true;
  const persist = async () => {
    const snapshot = structuredClone({ globals, settings });
    if (first) { first = false; await new Promise((_resolve, reject) => { rejectFirst = reject; }); }
    snapshots.push(snapshot);
  };
  const preferences = createPreferenceWrites(settings, globals, persist, () => {}, () => {}, mutations);
  const pet = createPetOverlay(globals, settings, persist, () => {}, mutations);
  const failed = assert.rejects(preferences('setting', 'theme', 'dark'), /disk full/);
  const opened = pet.handle({ type: 'avatar-overlay-open', isOpen: false }, () => {});
  await new Promise(resolve => setImmediate(resolve)); rejectFirst(new Error('disk full'));
  await failed; await opened;
  await pet.handle({ type: 'avatar-overlay-open', isOpen: true }, () => {});
  assert.deepEqual(snapshots, [
    { globals: { 'electron-avatar-overlay-open': true }, settings: { theme: 'light' } },
    { globals: { 'electron-avatar-overlay-open': false }, settings: { theme: 'light' } },
  ]);
  assert.equal(pet.snapshot().isOpen, false);
});
