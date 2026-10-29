import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Preferences } from '../settings/preferences.ts';
import type { PreferenceValues } from '../settings/preferences.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';

export type BrowserLinkTarget = PreferenceValues['open-link-in-target-preference'];

/** The web default also depends on the original host gate and legacy rollout. */
export function effectiveWebLinkTarget(options: {
  forceExternal: boolean | null;
  configured: BrowserLinkTarget | null;
  legacyDefault: BrowserLinkTarget | null;
}): BrowserLinkTarget | null {
  if (options.forceExternal === null) return null;
  return options.forceExternal ? 'external-browser' : options.configured ?? options.legacyDefault ?? 'external-browser';
}

const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
function localHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return localHosts.has(host) || host.endsWith('.localhost');
}

export interface BrowserLinkPreferences {
  /** Supply the effective web value after the host/rollout gate, not the raw default. */
  webTarget: BrowserLinkTarget | null;
  localTarget: BrowserLinkTarget | null;
  browserPaneEnabled: boolean | null;
  openTarget?: BrowserLinkTarget;
  useExternalBrowser?: boolean;
}
export type BrowserLinkDecision =
  | { kind: 'open'; url: string; local: boolean; target: BrowserLinkTarget }
  | { kind: 'invalid-url' }
  | { kind: 'unavailable'; reason: 'preference' | 'browser-capability' };

/** Decide only; navigation and its authority checks remain with the caller. */
export function resolveBrowserLinkTarget(value: string, options: BrowserLinkPreferences): BrowserLinkDecision {
  let url: URL;
  try { url = new URL(value); } catch { return { kind: 'invalid-url' }; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return { kind: 'invalid-url' };
  const local = localHostname(url.hostname);
  const result = (target: BrowserLinkTarget): BrowserLinkDecision => ({ kind: 'open', url: url.href, local, target });
  if (options.useExternalBrowser || options.openTarget === 'external-browser' || options.browserPaneEnabled === false) {
    return result('external-browser');
  }
  const target = options.openTarget ?? (local ? options.localTarget : options.webTarget);
  if (target === null) return { kind: 'unavailable', reason: 'preference' };
  if (target === 'external-browser') return result(target);
  if (options.browserPaneEnabled === null) return { kind: 'unavailable', reason: 'browser-capability' };
  return result('in-app-browser');
}

/** Original non-editing browser address projection; the underlying URL is untouched. */
export function formatBrowserAddress(value: string, showFull: boolean): string {
  if (showFull) return value;
  const text = value.trim();
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return text;
    if (localHostname(url.hostname)) {
      const display = url.href.replace(/^https?:\/\//i, '');
      return url.pathname === '/' && !url.search && !url.hash ? display.slice(0, -1) : display;
    }
    return url.protocol === 'https:' ? url.host.replace(/^www\./i, '') : `http://${url.host}`;
  } catch { return text; }
}

/** A read-only projection of the same setting authority used by Settings. */
export function useBrowserShowFullUrl(client: WorkbenchClient): boolean {
  const preferences = useMemo(() => new Preferences(client), [client]);
  const entry = useSyncExternalStore(preferences.subscribe,
    () => preferences.getSnapshot()['browser-show-full-url'],
    () => preferences.getSnapshot()['browser-show-full-url']);
  useEffect(() => {
    const reload = () => { void preferences.reload('browser-show-full-url'); };
    const unsubscribe = client.subscribe(event => {
      if (event.type !== 'settings-changed') return;
      const keys = Array.isArray(event.keys) ? event.keys : typeof event.key === 'string' ? [event.key] : [];
      if (!keys.length || keys.includes('browser-show-full-url')) reload();
    });
    reload();
    return unsubscribe;
  }, [client, preferences]);
  // If the saved value cannot be read, keep the complete address visible.
  return !entry.available || !!entry.error || entry.saved;
}
