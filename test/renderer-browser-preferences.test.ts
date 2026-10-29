import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveWebLinkTarget, formatBrowserAddress, resolveBrowserLinkTarget } from '../src/renderer/browser/preferences.ts';
import { preferenceDefinitions } from '../src/renderer/settings/preferences.ts';

test('effective targets honor original web and local defaults, capability and explicit override', () => {
  assert.equal(effectiveWebLinkTarget({ forceExternal: false, configured: null, legacyDefault: null }), 'external-browser');
  assert.equal(preferenceDefinitions['open-link-in-target-preference'].defaultValue, 'in-app-browser');
  assert.equal(preferenceDefinitions['open-local-url-in-target-preference'].defaultValue, 'in-app-browser');
  assert.equal(effectiveWebLinkTarget({ forceExternal: true, configured: 'in-app-browser', legacyDefault: null }), 'external-browser');
  assert.equal(effectiveWebLinkTarget({ forceExternal: false, configured: null, legacyDefault: 'in-app-browser' }), 'in-app-browser');
  assert.equal(effectiveWebLinkTarget({ forceExternal: null, configured: 'in-app-browser', legacyDefault: null }), null);
  const settings = { webTarget: 'external-browser', localTarget: 'in-app-browser', browserPaneEnabled: true } as const;
  for (const url of ['http://localhost:9876/p?q=1#f', 'https://api.localhost/p', 'http://127.0.0.1/',
    'http://0.0.0.0:90/', 'http://[::1]:90/']) {
    const decision = resolveBrowserLinkTarget(url, settings);
    assert.equal(decision.kind, 'open');
    if (decision.kind === 'open') { assert.equal(decision.local, true); assert.equal(decision.target, 'in-app-browser'); }
  }
  for (const url of ['https://example.invalid/p?q=1#f', 'http://127.0.0.2/', 'http://192.168.0.1/']) {
    const decision = resolveBrowserLinkTarget(url, settings);
    assert.equal(decision.kind, 'open');
    if (decision.kind === 'open') { assert.equal(decision.local, false); assert.equal(decision.target, 'external-browser'); }
  }
  assert.deepEqual(resolveBrowserLinkTarget('https://example.invalid/path?q=1#frag', { ...settings, openTarget: 'in-app-browser' }),
    { kind: 'open', url: 'https://example.invalid/path?q=1#frag', local: false, target: 'in-app-browser' });
  assert.deepEqual(resolveBrowserLinkTarget('https://example.invalid', { ...settings, browserPaneEnabled: false, openTarget: 'in-app-browser' }),
    { kind: 'open', url: 'https://example.invalid/', local: false, target: 'external-browser' });
  assert.deepEqual(resolveBrowserLinkTarget('http://localhost', { ...settings, useExternalBrowser: true }),
    { kind: 'open', url: 'http://localhost/', local: true, target: 'external-browser' });
  assert.deepEqual(resolveBrowserLinkTarget('http://localhost/', { ...settings, browserPaneEnabled: null }),
    { kind: 'unavailable', reason: 'browser-capability' });
  assert.deepEqual(resolveBrowserLinkTarget('https://example.invalid', { ...settings, webTarget: null }),
    { kind: 'unavailable', reason: 'preference' });
  for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'https://user:secret@example.invalid/', 'not-a-url']) {
    assert.deepEqual(resolveBrowserLinkTarget(value, settings), { kind: 'invalid-url' });
  }
});

test('unfocused addresses use the original remote and local projection', () => {
  assert.equal(formatBrowserAddress('https://www.example.invalid/path?q=1#f', false), 'example.invalid');
  assert.equal(formatBrowserAddress('http://www.example.invalid/path?q=1#f', false), 'http://www.example.invalid');
  assert.equal(formatBrowserAddress('http://localhost:5000/path?q=1#f', false), 'localhost:5000/path?q=1#f');
  assert.equal(formatBrowserAddress('https://localhost/', false), 'localhost');
  assert.equal(formatBrowserAddress('https://www.example.invalid/path?q=1#f', true), 'https://www.example.invalid/path?q=1#f');
});
