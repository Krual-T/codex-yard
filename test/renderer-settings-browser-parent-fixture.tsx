import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { I18nProvider } from '../src/renderer/i18n/index.tsx';
import { SettingsBrowserIntegrations } from '../src/renderer/settings/SettingsBrowserIntegrations.tsx';
import type { OriginalIntegrationGates } from '../src/renderer/settings/SettingsBrowserIntegrations.tsx';
import { Preferences } from '../src/renderer/settings/preferences.ts';
import { readSettingsRoute } from '../src/renderer/settings/routing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import '../src/renderer/settings/standalone-settings.css';

const realClient = new BrowserWorkbenchClient();
const preferences = new Preferences(realClient);
let owner = 1, refresh: () => void = () => {}, pendingNavigation: (() => void) | null = null;
let pauseNavigation = false, navigationBlocked = false, rawOverride: boolean | null = null;
let rawSource: 'unmodified' | 'unverified' = 'unverified', locale = 'en-US';
let gateValues: Omit<OriginalIntegrationGates, 'authorityKey'> | undefined;
let tryScope: { hostId: string; cwd: string; name: string } | null = null;

const controlledClient: WorkbenchClient = {
  rpc: async (method, params, hostId, options) => {
    const value: unknown = await realClient.rpc(method, params, hostId, options);
    if (method === 'experimentalFeature/list' && rawOverride !== null && value && typeof value === 'object' && 'data' in value && Array.isArray(value.data)) {
      return { ...value, data: value.data.map((item: { name?: string }) => item.name === 'in_app_browser' ? { ...item, enabled: rawOverride } : item) } as never;
    }
    return value as never;
  },
  host: (endpoint, params, options) => realClient.host(endpoint, params, options),
  subscribe: listener => realClient.subscribe(listener),
  reply: (ref, response) => realClient.reply(ref, response),
};

function captureAuthority(hostId: string) {
  const capturedOwner = owner, daemon = realClient.captureDaemonConnection(hostId);
  return { key: `${capturedOwner}:${daemon.generation}`, assertCurrent: () => {
    if (owner !== capturedOwner) throw new Error('Fixture authority changed');
    daemon.assertOriginal();
  } };
}

function Fixture() {
  const [, setRevision] = useState(0);
  refresh = () => setRevision(value => value + 1);
  const snapshot = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  useEffect(() => preferences.start(), []);
  useEffect(() => realClient.subscribe(event => {
    if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed' && event.isSnapshot !== true ||
      event.type === 'mcp-notification' && (event.method === 'account/updated' || event.method === 'account/login/completed')) {
      owner++; refresh();
    }
  }), []);
  const route = readSettingsRoute({ pathname: location.pathname, search: location.search, hash: location.hash, state: history.state }, 'local');
  let originalGates: OriginalIntegrationGates | undefined;
  try { if (gateValues) originalGates = { authorityKey: captureAuthority(route.hostId).key, ...gateValues }; } catch { /* Host is unavailable. */ }
  return <I18nProvider locale={locale}><div className="yard-settings"><main className="yard-settings-main"><div className="yard-settings-content">
    <SettingsBrowserIntegrations client={rawOverride === null ? realClient : controlledClient} route={route} cwd="/fixture/project"
      preferences={preferences} snapshot={snapshot} platform="linux" captureAuthority={captureAuthority} rawFeatureSource={rawSource}
      originalGates={originalGates} onTryPlugin={async (entry, scope) => {
        scope.assertCurrent(); tryScope = { hostId: scope.hostId, cwd: scope.cwd, name: entry.plugin.name };
      }} navigate={async (path, options, assertBeforeCommit) => {
        if (pauseNavigation) { pauseNavigation = false; await new Promise<void>(resolve => { pendingNavigation = resolve; }); }
        assertBeforeCommit();
        if (navigationBlocked) return false;
        assertBeforeCommit();
        owner++;
        if (options.replace) history.replaceState(options.state, '', path); else history.pushState(options.state, '', path);
        refresh(); return true;
      }} />
  </div></main></div></I18nProvider>;
}

declare global { interface Window { browserParentHarness: {
  show(path: string, state?: unknown): void;
  renew(): void;
  revoke(): void;
  source(value: 'unmodified' | 'unverified', override?: boolean | null): void;
  gates(value?: Omit<OriginalIntegrationGates, 'authorityKey'>): void;
  locale(value: string): void;
  pauseNavigation(): void;
  releaseNavigation(): void;
  blockNavigation(value: boolean): void;
  tried(): { hostId: string; cwd: string; name: string } | null;
  suspend(): void;
  resume(): Promise<void>;
  close(): void;
} } }

window.browserParentHarness = {
  show: (path, state = null) => { owner++; history.pushState(state, '', path); refresh(); },
  renew: () => { owner++; refresh(); },
  revoke: () => { owner++; },
  source: (value, override = null) => { owner++; rawSource = value; rawOverride = override; refresh(); },
  gates: value => { owner++; gateValues = value; refresh(); },
  locale: value => { locale = value; refresh(); },
  pauseNavigation: () => { pauseNavigation = true; },
  releaseNavigation: () => { const release = pendingNavigation; pendingNavigation = null; release?.(); },
  blockNavigation: value => { navigationBlocked = value; },
  tried: () => tryScope,
  suspend: () => realClient.suspend(), resume: () => realClient.resume(), close: () => realClient.close(),
};

void realClient.connect().then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
});
