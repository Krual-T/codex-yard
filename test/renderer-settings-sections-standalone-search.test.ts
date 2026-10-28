import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingSearchId, settingsSearchItems } from '../src/renderer/settings/search.ts';

test('settings search uses distinct stable identifiers independent of display labels', () => {
  for (const [section, items] of Object.entries(settingsSearchItems)) {
    assert.equal(new Set(items.map(item => item.id)).size, items.length, section);
    for (const item of items) assert.equal(settingSearchId(item.label), item.id);
  }
  assert.equal(settingSearchId('Codex instructions'), 'instructions');
  assert.equal(settingSearchId('Reasoning effort'), 'effort');
});
