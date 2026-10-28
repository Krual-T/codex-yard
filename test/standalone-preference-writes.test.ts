import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceWrites } from '../src/native/preference-writes.ts';

test('a failed preference save rolls back before later writes persist and never broadcasts failure', async () => {
  const settings: Record<string, unknown> = { theme: 'light', unrelated: { keep: true } }, globals: Record<string, unknown> = {};
  const persisted: unknown[] = [], events: unknown[] = [], changed: string[] = [];
  let rejectFirst: (error: Error) => void = () => {};
  let first = true;
  const write = createPreferenceWrites(settings, globals, async () => {
    if (first) { first = false; await new Promise((_resolve, reject) => { rejectFirst = reject; }); }
    persisted.push(structuredClone({ settings, globals }));
  }, event => events.push(event), key => changed.push(key));
  const failing = assert.rejects(write('setting', 'theme', 'dark'), /disk full/);
  const later = write('global', 'motion', 'off');
  await new Promise(resolve => setImmediate(resolve));
  rejectFirst(new Error('disk full'));
  await failing; await later;
  assert.equal(settings.theme, 'light');
  assert.deepEqual(persisted, [{ settings: { theme: 'light', unrelated: { keep: true } }, globals: { motion: 'off' } }]);
  assert.deepEqual(events, [{ type: 'global-state-updated', keys: ['motion'] }]);
  assert.deepEqual(changed, []);
});
