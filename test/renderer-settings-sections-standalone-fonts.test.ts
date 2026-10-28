import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editFontList, groupLocalFonts, selectFontFamily, selectFontStyle } from '../src/renderer/settings/theme-fonts.ts';
import type { ChromeTheme } from '../src/renderer/settings/preferences.ts';

const bold = { family: 'Inter', fullName: 'Inter Bold', postscriptName: 'Inter-Bold' };
const fonts: ChromeTheme['fonts'] = { ui: '"Inter", sans-serif', uiFace: bold, code: 'monospace', unknown: { preserved: true } };

test('editing a CSS fallback list preserves its saved style and unrelated data', () => {
  const changed = editFontList(fonts, 'ui', '"Inter", "Noto Sans", sans-serif');
  assert.equal(changed.ui, '"Inter", "Noto Sans", sans-serif');
  assert.deepEqual(changed.uiFace, bold);
  assert.deepEqual(changed.unknown, { preserved: true });
  assert.deepEqual(fonts.uiFace, bold);
  const reset = editFontList(changed, 'ui', '');
  assert.equal(reset.ui, null);
  assert.deepEqual(reset.uiFace, bold);
  assert.equal(selectFontStyle(reset, 'ui', null).uiFace, undefined);
  assert.equal(reset.code, 'monospace');
});

test('explicit family and style choices only change the selected font role', () => {
  const family = selectFontFamily(fonts, 'ui', 'Space Font', value => value.replaceAll(' ', '\\ '));
  assert.equal(family.ui, '"Space\\ Font"');
  assert.equal(family.uiFace, undefined);
  assert.equal(family.code, 'monospace');
  const selected = selectFontStyle(family, 'ui', { family: 'Space Font', fullName: 'Space Bold', postscriptName: 'Space-Bold' });
  assert.equal(selected.ui, '"Space\\ Font"');
  assert.deepEqual(selected.uiFace, { family: 'Space Font', fullName: 'Space Bold', postscriptName: 'Space-Bold' });
  assert.equal(selectFontStyle(selected, 'ui', null).uiFace, undefined);
  assert.deepEqual(fonts.uiFace, bold);
});

test('local font results group valid faces, deduplicate identifiers and prefer a regular default', () => {
  const list = groupLocalFonts([
    { ...bold, style: 'Bold' }, { ...bold, style: 'Duplicate' },
    { family: 'Inter', fullName: 'Inter Regular', postscriptName: 'Inter-Regular', style: 'Regular' },
    { family: 'Mono', fullName: 'Mono Italic', postscriptName: 'Mono-Italic', style: 'Italic' },
    { family: '', fullName: 'Invalid', postscriptName: 'Invalid', style: '' },
    { family: 'Invalid', fullName: null, postscriptName: 'Invalid', style: '' },
  ]);
  assert.deepEqual(list.map(group => group.family), ['Inter', 'Mono']);
  assert.deepEqual(list[0].faces.map(face => face.postscriptName), ['Inter-Regular', 'Inter-Bold']);
  assert.throws(() => groupLocalFonts({}), /Invalid local font response/);
});
