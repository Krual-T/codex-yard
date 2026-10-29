import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { Preferences, defaultThemes, exportTheme, fullAccessVisible, importTheme, mergeImportedTheme, preferenceKeys, setFullAccessVisible } from '../src/renderer/settings/preferences.ts';
import { assertPreferenceExpectation } from '../src/native/protocol.ts';
import { createPreferenceWrites } from '../src/native/preference-writes.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';

class FakeClient implements WorkbenchClient {
  settings: Record<string, unknown> = { composerPlainTextMode: false, appearanceTheme: 'dark', unknownSetting: { keep: true } };
  globals: Record<string, unknown> = { 'reduced-motion-preference': 'off' };
  atoms: Record<string, unknown> = { 'show-context-window-usage': true, unrelated: { keep: true } };
  calls: { endpoint: string; params?: Record<string, unknown> }[] = [];
  listeners = new Set<(event: WorkbenchEvent) => void>();
  fail = '';
  pauseWrite: (() => Promise<void>) | null = null;
  pauseRead: ((key: string) => Promise<void>) | null = null;
  rpc<T>(): Promise<T> { throw new Error('RPC is not used for UI preferences'); }
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  subscribe(listener: (event: WorkbenchEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async host<T>(endpoint: string, params?: Record<string, unknown>, options?: { assertBeforeSend?: () => void }): Promise<T> {
    this.calls.push({ endpoint, params });
    if (endpoint === this.fail) throw new Error('offline');
    const key = String(params?.key);
    if (endpoint === 'get-settings') return { values: { ...this.settings } } as T;
    const target = endpoint.endsWith('setting') ? this.settings : endpoint.endsWith('global-state') ? this.globals : this.atoms;
    if (endpoint.startsWith('get-')) {
      const value = structuredClone(target[key]), exists = Object.hasOwn(target, key);
      await this.pauseRead?.(key);
      options?.assertBeforeSend?.();
      return { value, exists } as T;
    }
    if (endpoint.startsWith('set-')) {
      await this.pauseWrite?.();
      options?.assertBeforeSend?.();
      assertPreferenceExpectation(target[key], Object.hasOwn(target, key), params?.expected);
      if (params?.value === undefined) delete target[key];
      else target[key] = structuredClone(params.value);
      return { success: true } as T;
    }
    throw new Error(`Unknown ${endpoint}`);
  }
}

test('Browser preferences retain raw defaults and use conditional writes to the original setting source', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  await prefs.load();
  const values = {
    'open-link-in-target-preference': 'external-browser',
    'open-local-url-in-target-preference': 'external-browser',
    'browser-show-full-url': true,
    'browser-annotation-screenshots-mode': 'necessary',
  } as const;
  const snapshot = prefs.getSnapshot();
  assert.equal(snapshot['open-link-in-target-preference'].value, 'in-app-browser');
  assert.equal(snapshot['open-local-url-in-target-preference'].value, 'in-app-browser');
  assert.equal(snapshot['browser-show-full-url'].value, false);
  assert.equal(snapshot['browser-annotation-screenshots-mode'].value, 'always');
  for (const key of Object.keys(values) as (keyof typeof values)[]) {
    assert.deepEqual(snapshot[key].observation, { exists: false });
    prefs.edit(key, values[key]);
    assert.equal(await prefs.saveOne(key), true);
    assert.equal(client.settings[key], values[key]);
    const write = client.calls.filter(call => call.endpoint.startsWith('set-')).at(-1);
    assert.equal(write?.endpoint, 'set-setting');
    assert.deepEqual(write?.params?.expected, { exists: false });
  }
  assert.deepEqual(client.settings.unknownSetting, { keep: true });
  client.settings['browser-show-full-url'] = 'false';
  await prefs.reload('browser-show-full-url');
  assert.equal(prefs.getSnapshot()['browser-show-full-url'].available, false);
  prefs.edit('browser-show-full-url', false);
  assert.equal(await prefs.saveOne('browser-show-full-url'), false);
  assert.equal(client.settings['browser-show-full-url'], 'false');
});

test('Browser saves recheck the captured authority after dispatch waits and preserve a rejected edit for explicit retry', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  await prefs.load();
  let release: () => void = () => {};
  client.pauseWrite = () => new Promise<void>(resolve => { release = resolve; });
  let current = true, checks = 0;
  const assertBeforeSend = () => {
    checks++;
    if (!current) throw new DOMException('The selected settings page changed.', 'AbortError');
  };
  prefs.edit('browser-show-full-url', true);
  const saving = prefs.saveOne('browser-show-full-url', assertBeforeSend);
  assert.equal(checks, 0);
  current = false;
  release();
  assert.equal(await saving, false);
  assert.equal(checks, 2);
  assert.equal(Object.hasOwn(client.settings, 'browser-show-full-url'), false);
  const rejected = prefs.getSnapshot()['browser-show-full-url'];
  assert.equal(rejected.value, true);
  assert.equal(rejected.saved, false);
  assert.equal(rejected.saving, false);
  assert.match(rejected.error ?? '', /selected settings page changed/);
  assert.equal(prefs.dirty, true);
  assert.equal(client.calls.filter(call => call.endpoint === 'set-setting').length, 1);
  assert.equal(client.calls.filter(call => call.endpoint === 'get-setting').length, 0);
  current = true;
  client.pauseWrite = null;
  assert.equal(await prefs.saveOne('browser-show-full-url', assertBeforeSend), true);
  assert.equal(checks, 4);
  assert.equal(client.settings['browser-show-full-url'], true);
  assert.equal(prefs.dirty, false);
});

test('failed-write recovery checks the original authority again after a read dispatch wait', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  await prefs.load();
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  client.pauseRead = async () => {
    entered();
    await new Promise<void>(resolve => { release = resolve; });
  };
  let current = true, checks = 0;
  const assertBeforeSend = () => {
    checks++;
    if (!current) throw new DOMException('The selected settings page changed.', 'AbortError');
  };
  client.fail = 'set-setting';
  prefs.edit('browser-show-full-url', true);
  const saving = prefs.saveOne('browser-show-full-url', assertBeforeSend);
  await reading;
  current = false;
  release();
  assert.equal(await saving, false);
  assert.equal(checks, 2);
  assert.equal(prefs.getSnapshot()['browser-show-full-url'].value, true);
  assert.equal(prefs.getSnapshot()['browser-show-full-url'].saved, false);
  assert.equal(prefs.dirty, true);
  assert.equal(client.calls.filter(call => call.endpoint === 'set-setting').length, 1);
});

test('a failed acknowledged read retains refresh notifications and the newer edit until reconnect or explicit reload', async t => {
  for (const recovery of ['reconnect', 'reload'] as const) await t.test(recovery, async () => {
    const client = new FakeClient(), prefs = new Preferences(client);
    const stop = prefs.start();
    try {
      await prefs.load();
      let release: () => void = () => {};
      let entered: () => void = () => {};
      const reading = new Promise<void>(resolve => { entered = resolve; });
      client.pauseRead = async key => {
        if (key !== 'appearanceTheme') return;
        entered();
        await new Promise<void>(resolve => { release = resolve; });
        throw new Error('read connection closed');
      };
      prefs.edit('appearanceTheme', 'light');
      const saving = prefs.saveOne('appearanceTheme');
      await reading;
      prefs.edit('appearanceTheme', 'system');
      client.settings.appearanceTheme = 'dark';
      for (const listener of client.listeners) listener({ type: 'settings-changed', keys: ['appearanceTheme'] });
      release();
      assert.equal(await saving, false);
      assert.equal(prefs.getSnapshot().appearanceTheme.value, 'system');
      assert.match(prefs.getSnapshot().appearanceTheme.error ?? '', /read connection closed/);
      client.pauseRead = null;
      if (recovery === 'reload') await prefs.reload('appearanceTheme');
      else {
        for (const listener of client.listeners) listener({ type: 'connection-state', state: 'connected' });
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const restored = prefs.getSnapshot().appearanceTheme;
      assert.equal(restored.value, 'system');
      assert.equal(restored.saved, 'dark');
      assert.deepEqual(restored.observation, { exists: true, value: 'dark' });
      assert.deepEqual(restored.editBase, { exists: true, value: 'light' });
      assert.equal(restored.conflict, true);
      assert.equal(client.calls.filter(call => call.endpoint === 'set-setting').length, 1);
      const reads = client.calls.filter(call => call.endpoint === 'get-setting').length;
      for (const listener of client.listeners) listener({ type: 'connection-state', state: 'connected' });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(client.calls.filter(call => call.endpoint === 'get-setting').length, reads);
    } finally { stop(); }
  });
});

test('acknowledged confirmation reads recheck the original page after dispatch waits and retain the saved receipt', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  await prefs.load();
  let release: () => void = () => {}, entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  client.pauseRead = async key => {
    if (key !== 'browser-show-full-url') return;
    entered();
    await new Promise<void>(resolve => { release = resolve; });
  };
  let current = true;
  const assertBeforeSend = () => { if (!current) throw new Error('The original settings page changed.'); };
  prefs.edit('browser-show-full-url', true);
  const saving = prefs.saveOne('browser-show-full-url', assertBeforeSend);
  await reading;
  current = false;
  release();
  assert.equal(await saving, false);
  const retained = prefs.getSnapshot()['browser-show-full-url'];
  assert.equal(client.settings['browser-show-full-url'], true);
  assert.equal(retained.saved, true);
  assert.equal(retained.value, true);
  assert.deepEqual(retained.editBase, { exists: true, value: true });
  assert.match(retained.error ?? '', /original settings page changed/);
  client.pauseRead = null;
  await prefs.reload('browser-show-full-url');
  assert.equal(prefs.dirty, false);
  assert.equal(client.calls.filter(call => call.endpoint === 'set-setting').length, 1);
});

test('queued notifications survive failed or malformed follow-up reads until a successful reconnect read', async t => {
  for (const failure of ['offline', 'malformed'] as const) await t.test(failure, async () => {
    const client = new FakeClient(), prefs = new Preferences(client);
    const stop = prefs.start();
    try {
      await prefs.load();
      const host = client.host.bind(client);
      let reads = 0;
      client.host = async <T>(endpoint: string, params?: Record<string, unknown>, options?: { assertBeforeSend?: () => void }): Promise<T> => {
        if (endpoint === 'get-setting' && params?.key === 'appearanceTheme' && ++reads === 2) {
          client.calls.push({ endpoint, params });
          options?.assertBeforeSend?.();
          if (failure === 'offline') throw new Error('notification read disconnected');
          return { value: 'dark' } as T;
        }
        return host<T>(endpoint, params, options);
      };
      let release: () => void = () => {}, entered: () => void = () => {};
      const reading = new Promise<void>(resolve => { entered = resolve; });
      client.pauseRead = async key => {
        if (key !== 'appearanceTheme') return;
        client.pauseRead = null;
        entered();
        await new Promise<void>(resolve => { release = resolve; });
      };
      prefs.edit('appearanceTheme', 'light');
      const saving = prefs.saveOne('appearanceTheme');
      await reading;
      prefs.edit('appearanceTheme', 'system');
      client.settings.appearanceTheme = 'dark';
      for (const listener of client.listeners) listener({ type: 'settings-changed', keys: ['appearanceTheme'] });
      release();
      assert.equal(await saving, true);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(reads, 2);
      assert.match(prefs.getSnapshot().appearanceTheme.error ?? '', failure === 'offline' ? /notification read disconnected/ : /whether the value exists/);
      for (const listener of client.listeners) listener({ type: 'connection-state', state: 'connected' });
      await new Promise<void>(resolve => setImmediate(resolve));
      const restored = prefs.getSnapshot().appearanceTheme;
      assert.equal(reads, 3);
      assert.equal(restored.saved, 'dark');
      assert.equal(restored.value, 'system');
      assert.deepEqual(restored.editBase, { exists: true, value: 'light' });
      assert.equal(restored.conflict, true);
      assert.equal(client.calls.filter(call => call.endpoint === 'set-setting').length, 1);
      for (const listener of client.listeners) listener({ type: 'connection-state', state: 'connected' });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(reads, 3);
    } finally { stop(); }
  });
});

test('the shared preference key list includes every General atom and global preference once', () => {
  for (const key of ['composer-permission-mode-visibility', 'app-shell-bottom-panel-launcher-visible', 'confirm-before-close',
    'notifications-turn-mode', 'notifications-permissions-enabled', 'notifications-questions-enabled', 'notifications-dot-enabled'] as const) {
    assert.equal(preferenceKeys.filter(candidate => candidate === key).length, 1);
  }
});

test('General uses the original atom and global keys, defaults, and conditional writes', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  client.atoms['composer-permission-mode-visibility'] = { 'full-access': true, legacy: { other: 7 } };
  client.atoms['confirm-before-close'] = 'always';
  client.globals['notifications-permissions-enabled'] = false;
  await prefs.load();
  let snapshot = prefs.getSnapshot();
  assert.equal(fullAccessVisible(snapshot['composer-permission-mode-visibility'].value), true);
  assert.equal(snapshot['app-shell-bottom-panel-launcher-visible'].value, true);
  assert.equal(snapshot['confirm-before-close'].value, 'always');
  assert.equal(snapshot['notifications-turn-mode'].value, 'unfocused');
  assert.equal(snapshot['notifications-permissions-enabled'].value, false);
  prefs.edit('composerPlainTextMode', true);
  prefs.edit('composer-permission-mode-visibility', setFullAccessVisible(snapshot['composer-permission-mode-visibility'].value, false));
  assert.equal(await prefs.saveOne('composer-permission-mode-visibility'), true);
  assert.deepEqual(client.atoms['composer-permission-mode-visibility'], { 'full-access': false, legacy: { other: 7 } });
  assert.deepEqual(client.calls.find(call => call.endpoint === 'set-persisted-atom' && call.params?.key === 'composer-permission-mode-visibility')?.params?.expected,
    { exists: true, value: { 'full-access': true, legacy: { other: 7 } } });
  assert.equal(client.settings.composerPlainTextMode, false);
  assert.equal(prefs.getSnapshot().composerPlainTextMode.value, true);
  prefs.edit('app-shell-bottom-panel-launcher-visible', false);
  assert.equal(await prefs.saveOne('app-shell-bottom-panel-launcher-visible'), true);
  assert.deepEqual(client.calls.find(call => call.endpoint === 'set-persisted-atom' && call.params?.key === 'app-shell-bottom-panel-launcher-visible')?.params?.expected, { exists: false });
  prefs.edit('confirm-before-close', 'never');
  assert.equal(await prefs.saveOne('confirm-before-close'), true);
  assert.equal(client.atoms['confirm-before-close'], 'never');
  assert.equal(client.settings['confirm-before-close'], undefined);
  prefs.edit('notifications-turn-mode', 'always');
  assert.equal(await prefs.saveOne('notifications-turn-mode'), true);
  assert.equal(client.globals['notifications-turn-mode'], 'always');
  assert.deepEqual(client.calls.find(call => call.endpoint === 'set-global-state' && call.params?.key === 'notifications-turn-mode')?.params?.expected, { exists: false });
  prefs.edit('notifications-permissions-enabled', true);
  assert.equal(await prefs.saveOne('notifications-permissions-enabled'), true);
  assert.deepEqual(client.calls.find(call => call.endpoint === 'set-global-state' && call.params?.key === 'notifications-permissions-enabled')?.params?.expected,
    { exists: true, value: false });
  snapshot = prefs.getSnapshot();
  assert.equal(snapshot['notifications-questions-enabled'].value, true);
  assert.equal(snapshot['notifications-dot-enabled'].value, true);
});

test('General conflict reapplication retains the newer authority and unrelated object fields', async () => {
  const client = new FakeClient(), first = new Preferences(client), second = new Preferences(client);
  client.atoms['composer-permission-mode-visibility'] = { 'full-access': true, preserved: 1 };
  const stopFirst = first.start(), stopSecond = second.start();
  await Promise.all([first.load(), second.load()]);
  first.edit('composer-permission-mode-visibility', { 'full-access': false, preserved: 1 });
  second.edit('composer-permission-mode-visibility', { 'full-access': true, preserved: 2, newer: { data: 'keep' } });
  assert.equal(await second.saveOne('composer-permission-mode-visibility'), true);
  for (const listener of client.listeners) listener({ type: 'persisted-atoms-changed', keys: ['composer-permission-mode-visibility'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.getSnapshot()['composer-permission-mode-visibility'].conflict, true);
  assert.equal(await first.saveOne('composer-permission-mode-visibility'), false);
  first.resolveConflict('composer-permission-mode-visibility', 'draft');
  assert.deepEqual(first.getSnapshot()['composer-permission-mode-visibility'].value,
    { 'full-access': false, preserved: 2, newer: { data: 'keep' } });
  assert.equal(await first.saveOne('composer-permission-mode-visibility'), true);
  assert.deepEqual(client.atoms['composer-permission-mode-visibility'], { 'full-access': false, preserved: 2, newer: { data: 'keep' } });
  const write = client.calls.filter(call => call.endpoint === 'set-persisted-atom' && call.params?.key === 'composer-permission-mode-visibility').at(-1);
  assert.deepEqual(write?.params?.expected, { exists: true, value: { 'full-access': true, preserved: 2, newer: { data: 'keep' } } });
  stopFirst(); stopSecond();
});

test('General rebases a boolean draft onto a newer legacy object without losing fields', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  client.atoms['composer-permission-mode-visibility'] = true;
  const stop = prefs.start();
  await prefs.load();
  prefs.edit('composer-permission-mode-visibility', false);
  client.atoms['composer-permission-mode-visibility'] = { 'full-access': null, future: { retained: true } };
  for (const listener of client.listeners) listener({ type: 'persisted-atoms-changed' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prefs.getSnapshot()['composer-permission-mode-visibility'].conflict, true);
  assert.equal(fullAccessVisible(prefs.getSnapshot()['composer-permission-mode-visibility'].saved), true);
  prefs.resolveConflict('composer-permission-mode-visibility', 'draft');
  assert.deepEqual(prefs.getSnapshot()['composer-permission-mode-visibility'].value,
    { 'full-access': false, future: { retained: true } });
  assert.equal(await prefs.saveOne('composer-permission-mode-visibility'), true);
  assert.deepEqual(client.atoms['composer-permission-mode-visibility'], { 'full-access': false, future: { retained: true } });
  stop();
});

test('General preserves failed or newer drafts and rejects malformed legacy values', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  client.atoms['composer-permission-mode-visibility'] = { 'full-access': 'invalid', other: 1 };
  await prefs.load();
  assert.equal(prefs.getSnapshot()['composer-permission-mode-visibility'].available, false);
  prefs.edit('composer-permission-mode-visibility', false);
  assert.deepEqual(client.atoms['composer-permission-mode-visibility'], { 'full-access': 'invalid', other: 1 });
  prefs.edit('app-shell-bottom-panel-launcher-visible', false);
  client.fail = 'set-persisted-atom';
  assert.equal(await prefs.saveOne('app-shell-bottom-panel-launcher-visible'), false);
  assert.equal(prefs.getSnapshot()['app-shell-bottom-panel-launcher-visible'].value, false);
  assert.match(prefs.getSnapshot()['app-shell-bottom-panel-launcher-visible'].error ?? '', /offline/);
  client.fail = '';
  let release: () => void = () => {};
  client.pauseWrite = () => new Promise<void>(resolve => { release = resolve; });
  const saving = prefs.saveOne('app-shell-bottom-panel-launcher-visible');
  prefs.edit('app-shell-bottom-panel-launcher-visible', true);
  release();
  assert.equal(await saving, true);
  assert.equal(prefs.getSnapshot()['app-shell-bottom-panel-launcher-visible'].saved, false);
  assert.equal(prefs.getSnapshot()['app-shell-bottom-panel-launcher-visible'].value, true);
  assert.equal(prefs.dirty, true);
  client.pauseWrite = null;
  assert.equal(await prefs.saveOne('app-shell-bottom-panel-launcher-visible'), true);
  assert.equal(client.atoms['app-shell-bottom-panel-launcher-visible'], true);
});

test('preferences read existing sources and write each key to its owning store', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  await prefs.load();
  assert.equal(prefs.getSnapshot().appearanceTheme.value, 'dark');
  assert.equal(prefs.getSnapshot()['show-context-window-usage'].value, true);
  assert.equal(prefs.getSnapshot()['reduced-motion-preference'].value, 'off');
  prefs.edit('composerPlainTextMode', true);
  prefs.edit('reduced-motion-preference', 'on');
  prefs.edit('show-context-window-usage', false);
  assert.equal(await prefs.save(), true);
  assert.equal(prefs.dirty, false);
  assert.equal(client.settings.composerPlainTextMode, true);
  assert.equal(client.globals['reduced-motion-preference'], 'on');
  assert.equal(client.atoms['show-context-window-usage'], false);
  assert.deepEqual(client.atoms.unrelated, { keep: true });
  assert.deepEqual(client.settings.unknownSetting, { keep: true });
  assert.ok(client.calls.some(call => call.endpoint === 'set-setting' && call.params?.key === 'composerPlainTextMode'));
  assert.ok(client.calls.some(call => call.endpoint === 'set-global-state' && call.params?.key === 'reduced-motion-preference'));
  assert.ok(client.calls.some(call => call.endpoint === 'set-persisted-atom' && call.params?.key === 'show-context-window-usage'));
});

test('host and cross-tab notifications refresh the correct store while keeping drafts', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  const stop = prefs.start();
  await prefs.load();
  prefs.edit('appearanceTheme', 'light');
  client.settings.appearanceTheme = 'system';
  client.atoms['show-context-window-usage'] = false;
  client.globals['reduced-motion-preference'] = 'on';
  for (const event of [{ type: 'settings-changed', keys: ['appearanceTheme'] },
    { type: 'persisted-atom-updated', keys: ['show-context-window-usage'] }, { type: 'global-state-updated', keys: ['reduced-motion-preference'] }]) {
    for (const listener of client.listeners) listener(event);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prefs.getSnapshot().appearanceTheme.saved, 'system');
  assert.equal(prefs.getSnapshot().appearanceTheme.value, 'light');
  assert.deepEqual(prefs.getSnapshot().appearanceTheme.editBase, { exists: true, value: 'dark' });
  assert.equal(prefs.getSnapshot().appearanceTheme.conflict, true);
  assert.equal(await prefs.save(), false);
  assert.equal(prefs.getSnapshot()['show-context-window-usage'].value, false);
  assert.equal(prefs.getSnapshot()['reduced-motion-preference'].value, 'on');
  stop();
});

test('atom change notifications refresh specified keys and surface malformed storage', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  const stop = prefs.start();
  await prefs.load();
  client.calls.length = 0;
  client.atoms['show-educational-tips'] = false;
  for (const listener of client.listeners) listener({ type: 'persisted-atom-updated', keys: ['show-educational-tips'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prefs.getSnapshot()['show-educational-tips'].value, false);
  assert.deepEqual(client.calls.map(call => call.params?.key), ['show-educational-tips']);
  client.fail = 'get-persisted-atom';
  for (const listener of client.listeners) listener({ type: 'persisted-atom-updated', keys: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(prefs.getSnapshot()['show-educational-tips'].error ?? '', /offline/);
  stop();
});

test('plural atom change notifications and the original microphone setting use their owning stores', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  client.settings.microphoneInputDeviceId = 'fixture-microphone';
  const stop = prefs.start();
  await prefs.load();
  assert.equal(prefs.getSnapshot().microphoneInputDeviceId.value, 'fixture-microphone');
  prefs.edit('microphoneInputDeviceId', null);
  assert.equal(await prefs.saveOne('microphoneInputDeviceId'), true);
  assert.equal(client.settings.microphoneInputDeviceId, null);
  client.atoms['show-context-window-usage'] = false;
  for (const listener of client.listeners) listener({ type: 'persisted-atoms-changed' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prefs.getSnapshot()['show-context-window-usage'].value, false);
  stop();
});

test('an update during save is reread after the acknowledgement', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  const stop = prefs.start();
  await prefs.load();
  let release: () => void = () => {};
  let captured: () => void = () => {};
  const waiting = new Promise<void>(resolve => { captured = resolve; });
  client.pauseRead = async key => {
    if (key !== 'appearanceTheme') return;
    client.pauseRead = null;
    captured();
    await new Promise<void>(resolve => { release = resolve; });
  };
  prefs.edit('appearanceTheme', 'light');
  const saving = prefs.save();
  await waiting;
  client.settings.appearanceTheme = 'system';
  for (const listener of client.listeners) listener({ type: 'settings-changed', keys: ['appearanceTheme'] });
  release();
  assert.equal(await saving, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prefs.getSnapshot().appearanceTheme.saved, 'system');
  assert.equal(prefs.getSnapshot().appearanceTheme.value, 'system');
  assert.equal(prefs.dirty, false);
  stop();
});

test('saving a Git preference uses global state and leaves other drafts untouched on failure', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  await prefs.load();
  prefs.edit('git-branch-prefix', 'feature/');
  prefs.edit('git-commit-instructions', 'Keep the subject short');
  client.fail = 'set-global-state';
  assert.equal(await prefs.saveOne('git-branch-prefix'), false);
  assert.equal(prefs.getSnapshot()['git-branch-prefix'].value, 'feature/');
  assert.match(prefs.getSnapshot()['git-branch-prefix'].error ?? '', /offline/);
  client.fail = '';
  assert.equal(await prefs.saveOne('git-branch-prefix'), true);
  assert.equal(client.globals['git-branch-prefix'], 'feature/');
  assert.equal(client.globals['git-commit-instructions'], undefined);
  assert.equal(prefs.getSnapshot()['git-commit-instructions'].value, 'Keep the subject short');
  assert.equal(prefs.dirty, true);
});

test('local worktree roots are validated and normalized before a global-state write', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  prefs.setPlatform('linux');
  await prefs.load();
  prefs.edit('git-worktree-root', 'relative/path');
  assert.equal(await prefs.saveOne('git-worktree-root'), false);
  assert.match(prefs.getSnapshot()['git-worktree-root'].error ?? '', /absolute path/);
  assert.equal(client.calls.some(call => call.endpoint === 'set-global-state'), false);
  prefs.edit('git-worktree-root', ' /tmp/worktrees ');
  assert.equal(await prefs.saveOne('git-worktree-root'), true);
  assert.equal(client.globals['git-worktree-root'], '/tmp/worktrees');
  assert.equal(prefs.getSnapshot()['git-worktree-root'].value, '/tmp/worktrees');
  prefs.setPlatform('windows');
  prefs.edit('git-worktree-root', 'C:\\worktrees');
  assert.equal(await prefs.saveOne('git-worktree-root'), true);
  assert.equal(client.globals['git-worktree-root'], 'C:\\worktrees');
});

test('keyboard targets use the existing atom and application setting separately', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  client.atoms['primary-number-shortcut-target'] = 'sidebar';
  client.settings['external-browser-link-shortcut'] = 'alt';
  await prefs.load();
  assert.equal(prefs.getSnapshot()['primary-number-shortcut-target'].value, 'sidebar');
  assert.equal(prefs.getSnapshot()['external-browser-link-shortcut'].value, 'alt');
  prefs.edit('primary-number-shortcut-target', 'tabs');
  prefs.edit('external-browser-link-shortcut', 'primary-shift');
  assert.equal(await prefs.save(), true);
  assert.equal(client.atoms['primary-number-shortcut-target'], 'tabs');
  assert.equal(client.settings['external-browser-link-shortcut'], 'primary-shift');
  assert.deepEqual(client.atoms.unrelated, { keep: true });
  assert.ok(client.calls.some(call => call.endpoint === 'set-persisted-atom' && call.params?.key === 'primary-number-shortcut-target'));
  assert.ok(client.calls.some(call => call.endpoint === 'set-setting' && call.params?.key === 'external-browser-link-shortcut'));
});

test('failed or unverifiable writes retain edits and never replay automatically', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  await prefs.load();
  prefs.edit('composerPlainTextMode', true);
  client.fail = 'set-setting';
  assert.equal(await prefs.save(), false);
  assert.equal(prefs.getSnapshot().composerPlainTextMode.value, true);
  assert.equal(prefs.getSnapshot().composerPlainTextMode.saved, false);
  assert.match(prefs.getSnapshot().composerPlainTextMode.error ?? '', /offline/);
  assert.equal(prefs.dirty, true);
  assert.equal(client.calls.filter(call => call.endpoint === 'set-setting').length, 1);
  client.fail = 'get-setting';
  assert.equal(await prefs.save(), false);
  assert.equal(prefs.dirty, true);
  assert.equal(prefs.getSnapshot().composerPlainTextMode.value, true);
  client.fail = '';
  await prefs.reload('composerPlainTextMode');
  assert.equal(prefs.getSnapshot().composerPlainTextMode.saved, true);
  assert.equal(prefs.dirty, false);
});

test('a newer edit survives an earlier save and invalid stored values cannot be overwritten', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  client.settings.sansFontSize = 900;
  await prefs.load();
  assert.equal(prefs.getSnapshot().sansFontSize.available, false);
  prefs.edit('sansFontSize', 14);
  assert.equal(client.settings.sansFontSize, 900);
  let release: () => void = () => {};
  client.pauseWrite = () => new Promise<void>(resolve => { release = resolve; });
  prefs.edit('appearanceTheme', 'light');
  const save = prefs.save();
  prefs.edit('appearanceTheme', 'system');
  release();
  assert.equal(await save, true);
  assert.equal(prefs.getSnapshot().appearanceTheme.saved, 'light');
  assert.equal(prefs.getSnapshot().appearanceTheme.value, 'system');
  assert.equal(prefs.dirty, true);
  client.pauseWrite = null;
  assert.equal(await prefs.save(), true);
  assert.deepEqual(client.calls.filter(call => call.endpoint === 'set-setting').at(-1)?.params?.expected, { exists: true, value: 'light' });
  assert.equal(client.settings.appearanceTheme, 'system');
});

test('two editors use raw existence and keep drafts when conditional writes conflict', async () => {
  const client = new FakeClient(), first = new Preferences(client), second = new Preferences(client);
  await Promise.all([first.load(), second.load()]);
  first.edit('appearanceTheme', 'light'); second.edit('appearanceTheme', 'system');
  first.edit('git-branch-prefix', 'first/'); second.edit('git-branch-prefix', 'second/');
  first.edit('primary-number-shortcut-target', 'sidebar'); second.edit('primary-number-shortcut-target', 'sidebar');
  assert.equal(await first.save(), true);
  for (const key of ['appearanceTheme', 'git-branch-prefix', 'primary-number-shortcut-target'] as const) {
    assert.equal(await second.saveOne(key), false);
    assert.equal(second.getSnapshot()[key].conflict, true);
  }
  assert.deepEqual(second.getSnapshot().appearanceTheme.editBase, { exists: true, value: 'dark' });
  assert.deepEqual(second.getSnapshot()['git-branch-prefix'].editBase, { exists: false });
  assert.deepEqual(second.getSnapshot()['primary-number-shortcut-target'].editBase, { exists: false });
  assert.equal(second.getSnapshot()['git-branch-prefix'].value, 'second/');
  assert.equal(second.getSnapshot()['git-branch-prefix'].saved, 'first/');
  second.resolveConflict('appearanceTheme', 'current');
  second.resolveConflict('git-branch-prefix', 'draft');
  second.resolveConflict('primary-number-shortcut-target', 'current');
  assert.equal(await second.save(), true);
  assert.equal(client.settings.appearanceTheme, 'light');
  assert.equal(client.globals['git-branch-prefix'], 'second/');
  assert.deepEqual(client.calls.filter(call => call.endpoint === 'set-global-state').at(-1)?.params?.expected,
    { exists: true, value: 'first/' });
});

test('two editors serialize conditional setting and global writes through the actual host mutation interval', async () => {
  const client = new FakeClient(), mutations = createStateMutations();
  let release: () => void = () => {}, started: () => void = () => {};
  const entered = new Promise<void>(resolve => { started = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  let firstPersist = true;
  const write = createPreferenceWrites(client.settings, client.globals, async () => {
    if (firstPersist) { firstPersist = false; started(); await hold; }
  }, () => {}, () => {}, mutations);
  const host = client.host.bind(client);
  client.host = async <T>(endpoint: string, params?: Record<string, unknown>): Promise<T> => {
    if (endpoint === 'set-setting' || endpoint === 'set-global-state') {
      client.calls.push({ endpoint, params });
      return write(endpoint === 'set-setting' ? 'setting' : 'global', String(params?.key), params?.value, params?.expected) as Promise<T>;
    }
    if (endpoint === 'get-settings' || endpoint === 'get-setting' || endpoint === 'get-global-state') {
      return mutations.run(() => host<T>(endpoint, params));
    }
    return host<T>(endpoint, params);
  };
  const first = new Preferences(client), second = new Preferences(client);
  await Promise.all([first.load(), second.load()]);
  first.edit('appearanceTheme', 'light'); second.edit('appearanceTheme', 'system');
  const winning = first.saveOne('appearanceTheme'); await entered;
  const competing = second.saveOne('appearanceTheme'); release();
  assert.deepEqual(await Promise.all([winning, competing]), [true, false]);
  assert.equal(client.settings.appearanceTheme, 'light');
  assert.equal(second.getSnapshot().appearanceTheme.value, 'system');
  assert.equal(second.getSnapshot().appearanceTheme.conflict, true);
  first.edit('git-branch-prefix', 'first/'); second.edit('git-branch-prefix', 'second/');
  assert.deepEqual(await Promise.all([first.saveOne('git-branch-prefix'), second.saveOne('git-branch-prefix')]), [true, false]);
  assert.equal(client.globals['git-branch-prefix'], 'first/');
  assert.equal(second.getSnapshot()['git-branch-prefix'].value, 'second/');
  assert.deepEqual(second.getSnapshot()['git-branch-prefix'].editBase, { exists: false });
});

test('reapplying a theme keeps external untouched and unknown fields', async () => {
  const client = new FakeClient();
  client.settings.appearanceLightChromeTheme = { ...structuredClone(defaultThemes.light),
    extension: { old: true }, fonts: { ...defaultThemes.light.fonts, future: 'original' },
    ...JSON.parse('{"__proto__":{"keep":"original"}}') };
  const first = new Preferences(client), second = new Preferences(client);
  await Promise.all([first.load(), second.load()]);
  const original = first.getSnapshot().appearanceLightChromeTheme.value!;
  first.edit('appearanceLightChromeTheme', { ...original, surface: '#eeeeee', extension: { old: true, added: 1 },
    ...JSON.parse('{"__proto__":{"keep":"changed"}}'),
    fonts: { ...original.fonts, future: 'new', another: 'kept' } });
  second.edit('appearanceLightChromeTheme', { ...second.getSnapshot().appearanceLightChromeTheme.value!, accent: '#123456' });
  assert.equal(await first.save(), true);
  await second.reload('appearanceLightChromeTheme');
  assert.equal(second.getSnapshot().appearanceLightChromeTheme.conflict, true);
  second.resolveConflict('appearanceLightChromeTheme', 'draft');
  assert.equal(await second.save(), true);
  const result = client.settings.appearanceLightChromeTheme as typeof original;
  assert.equal(result.accent, '#123456'); assert.equal(result.surface, '#eeeeee');
  assert.deepEqual(result.extension, { old: true, added: 1 });
  assert.equal(result.fonts.future, 'new'); assert.equal(result.fonts.another, 'kept');
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__')?.value, { keep: 'changed' });
});

test('a missing or null theme rebases edits against the displayed default while retaining the raw baseline', async () => {
  for (const storedNull of [false, true]) {
    const client = new FakeClient();
    if (storedNull) client.settings.appearanceLightChromeTheme = null;
    const first = new Preferences(client), second = new Preferences(client);
    await Promise.all([first.load(), second.load()]);
    first.edit('appearanceLightChromeTheme', { ...structuredClone(defaultThemes.light), surface: '#eeeeee' });
    second.edit('appearanceLightChromeTheme', { ...structuredClone(defaultThemes.light), accent: '#123456' });
    assert.deepEqual(second.getSnapshot().appearanceLightChromeTheme.editBase, storedNull ? { exists: true, value: null } : { exists: false });
    assert.equal(await first.save(), true);
    await second.reload('appearanceLightChromeTheme');
    assert.equal(second.getSnapshot().appearanceLightChromeTheme.conflict, true);
    second.resolveConflict('appearanceLightChromeTheme', 'draft');
    assert.equal(await second.save(), true);
    const result = client.settings.appearanceLightChromeTheme as typeof defaultThemes.light;
    assert.equal(result.accent, '#123456'); assert.equal(result.surface, '#eeeeee');
  }
});

test('a missing existence response cannot be used as a write baseline', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  const original = client.host.bind(client);
  client.host = async <T>(endpoint: string, params?: Record<string, unknown>): Promise<T> =>
    endpoint === 'get-persisted-atom' ? { value: true } as T : original<T>(endpoint, params);
  await prefs.load();
  assert.equal(prefs.getSnapshot()['show-context-window-usage'].available, false);
  assert.match(prefs.getSnapshot()['show-context-window-usage'].error ?? '', /whether the value exists/);
  prefs.edit('show-context-window-usage', false);
  assert.equal(await prefs.saveOne('show-context-window-usage'), false);
});

test('missing atom service is visible and cannot fall back to another store', async () => {
  const client = new FakeClient(), prefs = new Preferences(client);
  client.fail = 'get-persisted-atom';
  await prefs.load();
  assert.equal(prefs.getSnapshot()['show-context-window-usage'].available, false);
  assert.match(prefs.getSnapshot()['show-context-window-usage'].error ?? '', /offline/);
  prefs.edit('show-context-window-usage', false);
  prefs.discard();
  assert.match(prefs.getSnapshot()['show-context-window-usage'].error ?? '', /offline/);
  await prefs.save();
  assert.equal(client.calls.some(call => call.endpoint.startsWith('set-')), false);
});

test('theme sharing accepts original format, validates variants and preserves unknown fields', () => {
  const theme = { ...defaultThemes.dark, extension: { preserve: true } };
  const encoded = exportTheme('dark', theme, 'codex');
  assert.deepEqual(importTheme(encoded, 'dark'), { theme, codeThemeId: 'codex' });
  assert.deepEqual(importTheme('codex-theme-v1:' + encodeURIComponent(encoded.slice(15)), 'dark'), { theme, codeThemeId: 'codex' });
  assert.throws(() => importTheme(encoded, 'light'), /Invalid light/);
  assert.throws(() => importTheme(exportTheme('dark', theme, 'proof'), 'dark'), /unsupported/);
  assert.throws(() => importTheme('codex-theme-v1:{"variant":"dark"}', 'dark'), /Invalid dark/);
  const merged = mergeImportedTheme({ ...theme, extension: { preserve: true }, fonts: { ...theme.fonts, future: 'keep' } },
    { ...structuredClone(defaultThemes.dark), accent: '#123456' });
  assert.equal(merged.accent, '#123456');
  assert.deepEqual(merged.extension, { preserve: true });
  assert.equal(merged.fonts.future, 'keep');
  const face = { family: 'Old', fullName: 'Old Bold', postscriptName: 'Old-Bold' };
  const updatedFont = mergeImportedTheme({ ...theme, fonts: { ...theme.fonts, ui: 'Old', uiFace: face } },
    { ...theme, fonts: { ...theme.fonts, ui: 'New' } });
  assert.equal(updatedFont.fonts.ui, 'New');
  assert.equal(updatedFont.fonts.uiFace, undefined);
});
