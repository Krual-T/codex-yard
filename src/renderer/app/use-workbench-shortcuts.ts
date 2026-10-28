import { useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { formatNumberShortcut, numberShortcutModifier, resolveWorkbenchShortcut } from './workbench-shortcuts.ts';
import type { NumberShortcutSlot, NumberShortcutTarget } from './workbench-shortcuts.ts';

interface ShortcutActions {
  blocked(): boolean;
  selectTab(slot: NumberShortcutSlot): boolean;
  toggleTerminal(): boolean;
}
const preferenceKey = 'primary-number-shortcut-target';
function sidebarButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-sidebar-thread]')]
    .filter(button => !button.disabled && button.getClientRects().length > 0 && !button.closest('[inert]'));
}

/** Read the existing preference; keyboard state is only a projection of the mounted shell. */
export function useWorkbenchShortcuts(client: WorkbenchClient, actions: ShortcutActions) {
  const current = useRef(actions); current.current = actions;
  const [platform, setPlatform] = useState('unknown');
  const [target, setTarget] = useState<NumberShortcutTarget | null>(null);
  const [hints, setHints] = useState<NumberShortcutTarget | null>(null);
  const [sidebarHintKeys, setSidebarHintKeys] = useState<string[]>([]);
  useEffect(() => {
    let active = true, generation = 0;
    const read = async () => {
      const request = ++generation;
      setTarget(null); setHints(null);
      try {
        const result = await client.host<{ exists: boolean; value?: unknown }>('get-persisted-atom', { key: preferenceKey });
        if (!active || request !== generation) return;
        setTarget(result.exists === false ? 'tabs' : result.exists === true && (result.value === 'tabs' || result.value === 'sidebar') ? result.value : null);
      } catch { if (active && request === generation) setTarget(null); }
    };
    void read();
    void client.host<{ platform: string }>('os-info').then(value => { if (active) setPlatform(value.platform); }).catch(() => {});
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'connection-state' && event.state === 'connected' ||
          (event.type === 'persisted-atom-updated' || event.type === 'persisted-atoms-changed') &&
          (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(preferenceKey))) void read();
    });
    return () => { active = false; generation++; unsubscribe(); };
  }, [client]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held: 'control' | 'meta' | 'alt' | null = null;
    let layout: ReadonlyMap<string, string> | null = null, active = true;
    const keyboard = (navigator as Navigator & { keyboard?: EventTarget & { getLayoutMap?(): Promise<ReadonlyMap<string, string>> } }).keyboard;
    const readLayout = () => { void keyboard?.getLayoutMap?.().then(value => { if (active) layout = value; }).catch(() => {}); };
    readLayout(); keyboard?.addEventListener('layoutchange', readLayout);
    const clear = () => { clearTimeout(timer); timer = undefined; held = null; setHints(null); setSidebarHintKeys([]); };
    const blocked = () => current.current.blocked() || [...document.querySelectorAll('[role="dialog"], [role="menu"]')]
      .some(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'));
    const down = (event: KeyboardEvent) => {
      if (blocked()) { clear(); return; }
      const modifier = !event.shiftKey && !event.getModifierState('AltGraph')
        ? event.ctrlKey && !event.metaKey && !event.altKey ? 'control'
          : event.metaKey && !event.ctrlKey && !event.altKey ? 'meta'
            : event.altKey && !event.ctrlKey && !event.metaKey ? 'alt' : null : null;
      if (target && modifier && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented) {
        const hintTarget = numberShortcutModifier(platform, target, 'tabs') === modifier ? 'tabs'
          : numberShortcutModifier(platform, target, 'sidebar') === modifier ? 'sidebar' : null;
        if (hintTarget && held !== modifier) {
          clear(); held = modifier;
          timer = setTimeout(() => {
            if (blocked()) return clear();
            setSidebarHintKeys(sidebarButtons().slice(0, 9).map(button => button.dataset.sidebarThread!));
            setHints(hintTarget);
          }, 500);
        }
      } else clear();
      const match = resolveWorkbenchShortcut(event, { platform, primaryNumberTarget: target, scopeBlocked: false, keyboardLayout: layout });
      if (!match) return;
      let handled = false;
      if (match.action.type === 'toggle-terminal') handled = current.current.toggleTerminal();
      else if (match.action.target === 'tabs') handled = current.current.selectTab(match.action.slot);
      else {
        const button = sidebarButtons()[match.action.slot - 1];
        if (button) { button.click(); handled = true; }
      }
      if (handled) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (held === 'control' && !event.ctrlKey || held === 'meta' && !event.metaKey || held === 'alt' && !event.altKey) clear();
    };
    // xterm consumes ordinary keydown events. This shell command owns its exact chord.
    const terminalCapture = (event: KeyboardEvent) => {
      if (blocked()) return;
      const match = resolveWorkbenchShortcut(event, { platform, primaryNumberTarget: target, scopeBlocked: false });
      if (match?.action.type === 'toggle-terminal' && current.current.toggleTerminal()) {
        event.preventDefault(); event.stopPropagation(); clear();
      }
    };
    const visibility = () => { if (document.visibilityState !== 'visible') clear(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
    window.addEventListener('keydown', terminalCapture, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false; clearTimeout(timer); keyboard?.removeEventListener('layoutchange', readLayout);
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
      window.removeEventListener('keydown', terminalCapture, true);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [platform, target]);
  return { hints, sidebarHintKeys, label: (kind: NumberShortcutTarget, slot: NumberShortcutSlot) => target ? formatNumberShortcut(platform, target, kind, slot) : '' };
}
