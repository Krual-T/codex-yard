import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatNumberShortcut, formatTerminalShortcut, numberShortcutModifier, resolveWorkbenchShortcut,
} from '../src/renderer/app/workbench-shortcuts.ts';
import type { NumberShortcutTarget, WorkbenchShortcutContext, WorkbenchShortcutEvent } from '../src/renderer/app/workbench-shortcuts.ts';

function event(changes: Partial<WorkbenchShortcutEvent> = {}): WorkbenchShortcutEvent {
  return {
    type: 'keydown', key: '1', code: 'Digit1', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, keyCode: 0, defaultPrevented: false, target: null,
    composedPath: () => [], getModifierState: () => false, ...changes,
  };
}

function context(platform: string, primaryNumberTarget: NumberShortcutTarget | null = 'tabs', scopeBlocked = false): WorkbenchShortcutContext {
  return { platform, primaryNumberTarget, scopeBlocked };
}

test('number target follows the preference and both platform modifier groups for every slot', () => {
  for (const platform of ['macOS', 'linux', 'windows']) {
    for (const primary of ['tabs', 'sidebar'] as const) {
      const alternate = primary === 'tabs' ? 'sidebar' : 'tabs';
      const primaryKey = platform === 'macOS' ? { metaKey: true } : { ctrlKey: true };
      const alternateKey = platform === 'macOS' ? { ctrlKey: true } : { altKey: true };
      for (let slot = 1; slot <= 9; slot++) {
        const number = { key: String(slot), code: `Digit${slot}` };
        assert.deepEqual(resolveWorkbenchShortcut(event({ ...number, ...primaryKey }), context(platform, primary)),
          { action: { type: 'select-number', target: primary, slot }, consumeIfHandled: true });
        assert.deepEqual(resolveWorkbenchShortcut(event({ ...number, ...alternateKey }), context(platform, primary)),
          { action: { type: 'select-number', target: alternate, slot }, consumeIfHandled: true });
      }
    }
  }
});

test('hints name the modifier actually assigned to each target and terminal', () => {
  assert.equal(numberShortcutModifier('macOS', 'tabs', 'tabs'), 'meta');
  assert.equal(numberShortcutModifier('macOS', 'tabs', 'sidebar'), 'control');
  assert.equal(numberShortcutModifier('linux', 'sidebar', 'tabs'), 'alt');
  assert.equal(formatNumberShortcut('macOS', 'tabs', 'tabs', 1), '\u23181');
  assert.equal(formatNumberShortcut('macOS', 'tabs', 'sidebar', 9), '\u23039');
  assert.equal(formatNumberShortcut('linux', 'tabs', 'tabs', 2), 'Ctrl+2');
  assert.equal(formatNumberShortcut('linux', 'tabs', 'sidebar', 3), 'Alt+3');
  assert.equal(formatTerminalShortcut('macOS'), '\u2303`');
  assert.equal(formatTerminalShortcut('linux'), 'Ctrl+`');
});

test('terminal is Control plus the literal backquote on all platforms, independent of preference', () => {
  for (const platform of ['macOS', 'linux', 'windows']) {
    assert.deepEqual(resolveWorkbenchShortcut(event({ ctrlKey: true, key: '`', code: 'Backquote' }), context(platform, null)),
      { action: { type: 'toggle-terminal' }, consumeIfHandled: true });
    assert.equal(resolveWorkbenchShortcut(event({ metaKey: true, key: '`', code: 'Backquote' }), context(platform)), null);
    assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true, key: 'Dead', code: 'Backquote' }), context(platform)), null);
  }
});

test('ignores unrelated keys, modifier combinations, repeated keys and unresolved preference', () => {
  for (const changes of [
    {}, { ctrlKey: true, key: '0', code: 'Digit0' }, { ctrlKey: true, key: 'a', code: 'KeyA' },
    { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, metaKey: true },
    { metaKey: true }, { altKey: true, shiftKey: true }, { ctrlKey: true, repeat: true },
    { ctrlKey: true, type: 'keyup' }, { ctrlKey: true, key: '`', repeat: true },
    { ctrlKey: true, getModifierState: (key: string) => key === 'AltGraph' },
  ]) assert.equal(resolveWorkbenchShortcut(event(changes), context('linux')), null, JSON.stringify(changes));
  assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true }), context('linux', null)), null);
  assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true }), context('linux', 'bogus' as NumberShortcutTarget)), null);
});

test('preserves composition, already-handled events, and caller-owned capture scopes', () => {
  for (const changes of [
    { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
  ]) assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true, ...changes }), context('linux')), null);
  assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true }), context('linux', 'tabs', true)), null);

  const captured = { closest: (selector: string) => selector === '[data-codex-shortcut-capture]' ? {} : null } as unknown as EventTarget;
  assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true, composedPath: () => [captured] }), context('linux')), null);
  assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true, target: captured }), context('linux')), null);
});

test('modified commands remain candidates in editable and terminal surfaces unless the caller blocks them', () => {
  for (const tag of ['input', 'textarea', 'select', 'contenteditable', 'terminal', 'dialog', 'menu']) {
    const target = { closest: () => null, tag } as unknown as EventTarget;
    assert.deepEqual(resolveWorkbenchShortcut(event({ ctrlKey: true, target }), context('linux')),
      { action: { type: 'select-number', target: 'tabs', slot: 1 }, consumeIfHandled: true });
    assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true, target }), context('linux', 'tabs', true)), null);
  }
});

test('Alt-digit uses the physical digit for layouts where Alt changes the key', () => {
  assert.deepEqual(resolveWorkbenchShortcut(event({ altKey: true, key: '\u00a1', code: 'Digit1' }), context('linux')),
    { action: { type: 'select-number', target: 'sidebar', slot: 1 }, consumeIfHandled: true });
  assert.deepEqual(resolveWorkbenchShortcut(event({ altKey: true, key: '2', code: 'Numpad2' }), context('linux')),
    { action: { type: 'select-number', target: 'sidebar', slot: 2 }, consumeIfHandled: true });
  assert.equal(resolveWorkbenchShortcut(event({ altKey: true, key: '1', code: 'Digit0' }), context('linux')), null);
  assert.equal(resolveWorkbenchShortcut(event({ altKey: true, key: '1', code: 'KeyA' }), context('linux')), null);
  assert.equal(resolveWorkbenchShortcut(event({ altKey: true, key: '1', code: 'Backquote' }), context('linux')), null);
  assert.equal(resolveWorkbenchShortcut(event({ ctrlKey: true, key: '\u00a1', code: 'Digit1' }), context('linux')), null);
});

test('an available keyboard layout map takes precedence over physical-code fallback for Alt', () => {
  const keyboardLayout = new Map([['Digit1', '&'], ['KeyA', '1']]);
  const options = { ...context('linux'), keyboardLayout };
  assert.equal(resolveWorkbenchShortcut(event({ altKey: true, key: '1', code: 'Digit1' }), options), null);
  assert.deepEqual(resolveWorkbenchShortcut(event({ altKey: true, key: '\u00e6', code: 'KeyA' }), options),
    { action: { type: 'select-number', target: 'sidebar', slot: 1 }, consumeIfHandled: true });
  assert.deepEqual(resolveWorkbenchShortcut(event({ altKey: true, key: '\u00a1', code: 'Digit2' }), options),
    { action: { type: 'select-number', target: 'sidebar', slot: 2 }, consumeIfHandled: true });
});

test('a caller consumes a real cancelable event only after finding a usable action', () => {
  const target = new EventTarget();
  let canHandle = false, received = 0;
  target.addEventListener('keydown', incoming => {
    const match = resolveWorkbenchShortcut(incoming as KeyboardEvent, context('linux'));
    if (!match || !canHandle) return;
    if (match.consumeIfHandled) incoming.preventDefault();
    received++;
  });
  function keydown() {
    const value = new Event('keydown', { cancelable: true });
    const fields = event({ ctrlKey: true });
    for (const name of ['key', 'code', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing', 'keyCode', 'getModifierState'] as const) {
      Object.defineProperty(value, name, { value: fields[name] });
    }
    return value;
  }
  const unavailable = keydown();
  assert.equal(target.dispatchEvent(unavailable), true);
  assert.equal(unavailable.defaultPrevented, false);
  assert.equal(received, 0);
  canHandle = true;
  const available = keydown();
  assert.equal(target.dispatchEvent(available), false);
  assert.equal(available.defaultPrevented, true);
  assert.equal(received, 1);
});
