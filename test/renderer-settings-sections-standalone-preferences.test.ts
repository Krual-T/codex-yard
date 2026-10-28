import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { Preferences, defaultThemes, exportTheme, importTheme, mergeImportedTheme } from '../src/renderer/settings/preferences.ts';
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
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ endpoint, params });
    if (endpoint === this.fail) throw new Error('offline');
    const key = String(params?.key);
    if (endpoint === 'get-settings') return { values: { ...this.settings } } as T;
    const target = endpoint.endsWith('setting') ? this.settings : endpoint.endsWith('global-state') ? this.globals : this.atoms;
    if (endpoint.startsWith('get-')) {
      const value = structuredClone(target[key]), exists = Object.hasOwn(target, key);
      await this.pauseRead?.(key);
      return { value, exists } as T;
    }
    if (endpoint.startsWith('set-')) {
      await this.pauseWrite?.();
      assertPreferenceExpectation(target[key], Object.hasOwn(target, key), params?.expected);
      if (params?.value === undefined) delete target[key];
      else target[key] = structuredClone(params.value);
      return { success: true } as T;
    }
    throw new Error(`Unknown ${endpoint}`);
  }
}

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
