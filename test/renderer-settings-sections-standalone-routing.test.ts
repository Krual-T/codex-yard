import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostPath, readSettingsRoute, sectionPath } from '../src/renderer/settings/routing.ts';

test('the original Configuration deep link returns to General without retaining its initial route', () => {
  const route = readSettingsRoute({ pathname: '/settings/general', search: '?hostId=ssh%3Aone&initialRoute=%2Fsettings%2Fagent&keep=1', hash: '', state: null }, 'local');
  assert.equal(route.section, 'configuration');
  assert.equal(sectionPath('general-settings', route), '/settings/general?hostId=ssh%3Aone&keep=1');
  assert.equal(sectionPath('appearance', route), '/settings/appearance?hostId=ssh%3Aone&keep=1');
  const configuration = new URL(sectionPath('configuration', route), 'https://yard.test');
  assert.equal(configuration.pathname, '/settings/general');
  assert.equal(configuration.searchParams.get('initialRoute'), '/settings/agent');
  assert.equal(configuration.searchParams.get('hostId'), 'ssh:one');
  assert.equal(readSettingsRoute({ pathname: '/settings/general', search: '?initialRoute=https%3A%2F%2Fother.test%2Fsettings%2Fagent', hash: '', state: null }, 'local').section, 'general-settings');
});

test('settings routes retain nested paths, host query and general aliases', () => {
  const nested = readSettingsRoute({ pathname: '/settings/browser-use/downloads', search: '?host=ssh%3Aone&tab=history&x=1', hash: '#details', state: { marker: 1 } }, 'local');
  assert.equal(nested.section, 'browser-use');
  assert.equal(nested.hostId, 'ssh:one');
  assert.equal(nested.path, '/settings/browser-use/downloads?host=ssh%3Aone&tab=history&x=1#details');
  assert.deepEqual(nested.state, { marker: 1 });
  assert.equal(sectionPath('appearance', nested), '/settings/appearance?host=ssh%3Aone&x=1');
  assert.equal(hostPath('local', nested), '/settings/browser-use/downloads?tab=history&x=1#details');
  assert.equal(hostPath('ssh:two', nested), '/settings/browser-use/downloads?tab=history&x=1&hostId=ssh%3Atwo#details');
  assert.equal(readSettingsRoute({ pathname: '/settings/general', search: '', hash: '', state: null }, 'local').section, 'general-settings');
  const remoteDefault = readSettingsRoute({ pathname: '/settings/appearance', search: '', hash: '', state: null }, 'ssh:default');
  assert.equal(hostPath('local', remoteDefault), '/settings/appearance?hostId=local');
});

test('settings root redirects with its query and malformed paths stay visible', () => {
  const root = readSettingsRoute({ pathname: '/settings/', search: '?hostId=remote', hash: '#font', state: { from: 'fixture' } }, 'local');
  assert.equal(root.redirect, '/settings/general?hostId=remote#font');
  assert.equal(readSettingsRoute({ pathname: '/settings/%broken', search: '', hash: '', state: null }, 'local').section, '%broken');
});
