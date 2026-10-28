import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostPath, readSettingsRoute, sectionPath } from '../src/renderer/settings/routing.ts';

test('settings routes retain nested paths, host query and general aliases', () => {
  const nested = readSettingsRoute({ pathname: '/settings/browser-use/downloads', search: '?host=ssh%3Aone&tab=history&x=1' }, undefined, 'local');
  assert.equal(nested.section, 'browser-use');
  assert.equal(nested.hostId, 'ssh:one');
  assert.equal(nested.path, '/settings/browser-use/downloads?host=ssh%3Aone&tab=history&x=1');
  assert.equal(sectionPath('appearance', nested), '/settings/appearance?host=ssh%3Aone&x=1');
  assert.equal(hostPath('local', nested), '/settings/browser-use/downloads?tab=history&x=1');
  assert.equal(hostPath('ssh:two', nested), '/settings/browser-use/downloads?tab=history&x=1&hostId=ssh%3Atwo');
  assert.equal(readSettingsRoute({ pathname: '/settings/general', search: '' }, undefined, 'local').section, 'general-settings');
  assert.equal(readSettingsRoute(undefined, '/settings/appearance', 'local').section, 'appearance');
});

test('settings root redirects with its query and malformed paths stay visible', () => {
  const root = readSettingsRoute({ pathname: '/settings/', search: '?hostId=remote' }, undefined, 'local');
  assert.equal(root.redirect, '/settings/general?hostId=remote');
  assert.equal(readSettingsRoute({ pathname: '/settings/%broken', search: '' }, undefined, 'local').section, '%broken');
});
