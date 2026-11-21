import { useSyncExternalStore } from 'react';
import { requestWorkspaceFetch } from '../native/browser-workspace-rpc.ts';
import { sendHostMessage } from './host.ts';

let values: Record<string, unknown> = {};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function preference<T>(key: string, fallback: T): T { return values[key] == null ? fallback : values[key] as T; }
export function usePreference<T>(key: string, fallback: T): T {
  return useSyncExternalStore(subscribe, () => preference(key, fallback));
}
function changed(next: Record<string, unknown>) {
  values = next;
  applyAppearance();
  for (const listener of listeners) listener();
}
export async function writePreference(key: string, value: unknown) {
  await requestWorkspaceFetch(sendHostMessage, 'set-setting', { key, value });
  changed({ ...values, [key]: value });
}
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
function applyAppearance() {
  const theme = preference<string>('appearanceTheme', 'system');
  const dark = theme === 'dark' || theme !== 'light' && systemTheme.matches;
  const html = document.documentElement;
  html.dataset.theme = dark ? 'dark' : 'light';
  const motion = preference<string>('reduced-motion-preference', 'system');
  html.dataset.reducedMotion = String(motion === 'on' || motion === 'system' && systemMotion.matches);
  html.style.setProperty('--app-color-text-accent', dark ? 'rgb(131 195 255)' : 'rgb(51 156 255)');
  const size = Math.min(24, Math.max(11, Number(preference('sansFontSize', 14)) || 14));
  const codeSize = Math.min(24, Math.max(10, Number(preference('codeFontSize', 12)) || 12));
  html.style.setProperty('--font-ui-size', size + 'px');
  html.style.setProperty('--text-base', size + 'px');
  html.style.setProperty('--text-sm', size - 1 + 'px');
  html.style.setProperty('--yard-code-size', codeSize + 'px');
}
export function startWorkspacePreferences() {
  applyAppearance();
  systemTheme.addEventListener('change', applyAppearance);
  systemMotion.addEventListener('change', applyAppearance);
  const load = () => { void requestWorkspaceFetch<{ values: Record<string, unknown> }>(sendHostMessage, 'get-settings', {})
    .then(result => changed(result.values)).catch(console.error); };
  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.type === 'settings-updated') load();
  });
  load();
}
