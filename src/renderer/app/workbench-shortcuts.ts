export type NumberShortcutTarget = 'sidebar' | 'tabs';
export type NumberShortcutModifier = 'meta' | 'control' | 'alt';
export type NumberShortcutSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type WorkbenchShortcutAction =
  | { type: 'select-number'; target: NumberShortcutTarget; slot: NumberShortcutSlot }
  | { type: 'toggle-terminal' };

export interface WorkbenchShortcutMatch {
  action: WorkbenchShortcutAction;
  consumeIfHandled: true;
}

export interface WorkbenchShortcutContext {
  platform: string;
  primaryNumberTarget: NumberShortcutTarget | null;
  scopeBlocked: boolean;
  keyboardLayout?: Pick<ReadonlyMap<string, string>, 'get'> | null;
}

export type WorkbenchShortcutEvent = Pick<KeyboardEvent,
  'type' | 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' |
  'repeat' | 'isComposing' | 'keyCode' | 'defaultPrevented' | 'target' |
  'composedPath' | 'getModifierState'>;

const altNonDigitCodes = new Set([
  'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote',
  'Comma', 'Period', 'Slash', 'Space', 'NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDecimal', 'NumpadDivide',
]);

export function numberShortcutModifier(platform: string, primaryTarget: NumberShortcutTarget,
  target: NumberShortcutTarget): NumberShortcutModifier {
  const isMac = platform === 'macOS';
  return target === primaryTarget ? isMac ? 'meta' : 'control' : isMac ? 'control' : 'alt';
}

export function formatNumberShortcut(platform: string, primaryTarget: NumberShortcutTarget,
  target: NumberShortcutTarget, slot: NumberShortcutSlot): string {
  const modifier = numberShortcutModifier(platform, primaryTarget, target);
  if (platform === 'macOS') return `${modifier === 'meta' ? '\u2318' : '\u2303'}${slot}`;
  return `${modifier === 'control' ? 'Ctrl' : 'Alt'}+${slot}`;
}

export function formatTerminalShortcut(platform: string): string {
  return platform === 'macOS' ? '\u2303`' : 'Ctrl+`';
}

function isShortcutCapture(event: WorkbenchShortcutEvent): boolean {
  const path = [...event.composedPath(), ...(event.target ? [event.target] : [])];
  return path.some(item => {
    const element = item as EventTarget & { closest?: (selector: string) => Element | null };
    return typeof element.closest === 'function' && element.closest('[data-codex-shortcut-capture]') != null;
  });
}

export function resolveWorkbenchShortcut(event: WorkbenchShortcutEvent,
  context: WorkbenchShortcutContext): WorkbenchShortcutMatch | null {
  if (event.type !== 'keydown' || event.defaultPrevented || event.repeat || event.isComposing ||
      event.keyCode === 229 || event.getModifierState('AltGraph') || event.shiftKey ||
      context.scopeBlocked || isShortcutCapture(event)) return null;

  const modifier = event.ctrlKey && !event.metaKey && !event.altKey ? 'control'
    : event.metaKey && !event.ctrlKey && !event.altKey ? 'meta'
      : event.altKey && !event.ctrlKey && !event.metaKey ? 'alt' : null;
  if (!modifier) return null;

  if (modifier === 'control' && event.key === '`') {
    return { action: { type: 'toggle-terminal' }, consumeIfHandled: true };
  }

  const primary = context.primaryNumberTarget;
  if (primary !== 'tabs' && primary !== 'sidebar') return null;
  let digit = event.key;
  if (modifier === 'alt') {
    const mapped = context.keyboardLayout?.get(event.code);
    if (mapped != null) digit = mapped;
    else if (/^Digit[0-9]$/.test(event.code)) digit = event.code.slice(5);
    else if (/^Key[A-Z]$/.test(event.code) || altNonDigitCodes.has(event.code)) return null;
  }
  if (!/^[1-9]$/.test(digit)) return null;
  const alternate = primary === 'tabs' ? 'sidebar' : 'tabs';
  let target: NumberShortcutTarget;
  if (numberShortcutModifier(context.platform, primary, primary) === modifier) target = primary;
  else if (numberShortcutModifier(context.platform, primary, alternate) === modifier) target = alternate;
  else return null;
  return { action: { type: 'select-number', target, slot: Number(digit) as NumberShortcutSlot }, consumeIfHandled: true };
}
