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

test('two editors of the same preference cannot silently overwrite a committed change', async () => {
  const original = { fonts: { ui: 'Arial', code: 'monospace' }, unknown: { keep: true } };
  const settings: Record<string, unknown> = { theme: structuredClone(original) };
  const persisted: unknown[] = [], events: unknown[] = [];
  const write = createPreferenceWrites(settings, {}, async () => { persisted.push(structuredClone(settings)); },
    event => events.push(event), () => {});
  const first = { ...original, fonts: { ...original.fonts, ui: 'Georgia' } };
  const second = { ...original, fonts: { ...original.fonts, code: 'Courier New' } };
  const a = write('setting', 'theme', first, { exists: true, value: original });
  const b = assert.rejects(write('setting', 'theme', second, { exists: true, value: original }), /changed/);
  await Promise.all([a, b]);
  assert.deepEqual(settings.theme, first);
  assert.equal(events.length, 1); assert.deepEqual(persisted, [{ theme: first }]);
  // A user-reviewed merge may save against the newly observed value.
  const merged = { ...first, fonts: { ...first.fonts, code: 'Courier New' } };
  await write('setting', 'theme', merged, { exists: true, value: first });
  assert.deepEqual(settings.theme, merged);
});

test('preference compare preserves absence, handles reset and rejects malformed observations', async () => {
  const settings: Record<string, unknown> = {}, globals: Record<string, unknown> = {};
  const write = createPreferenceWrites(settings, globals, async () => {}, () => {}, () => {});
  await write('global', 'motion', false, { exists: false });
  await assert.rejects(write('global', 'motion', true, { exists: false }), /changed/);
  await assert.rejects(write('global', 'motion', true, { exists: true, value: null }), /changed/);
  await assert.rejects(write('global', 'motion', true, { exists: 'false' }), /Invalid/);
  await write('global', 'motion', undefined, { exists: true, value: false });
  assert.equal(Object.hasOwn(globals, 'motion'), false);
  await write('setting', 'theme', { a: 1, b: 2 }, { exists: false });
  await write('setting', 'theme', null, { exists: true, value: { b: 2, a: 1 } });
  assert.equal(settings.theme, null);
});
