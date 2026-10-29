import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { I18nProvider } from '../src/renderer/i18n/index.tsx';
import { BrowserSection } from '../src/renderer/settings/BrowserSection.tsx';
import type { BrowserPreferenceKey, BrowserPreferenceSnapshot, BrowserPreferenceValues } from '../src/renderer/settings/BrowserSection.tsx';
import { ComputerUseSection } from '../src/renderer/settings/ComputerUseSection.tsx';
import type { IntegrationAvailability } from '../src/renderer/settings/integration-settings.tsx';
import type { PreferenceEntry } from '../src/renderer/settings/preferences.ts';
import { readSettingsRoute } from '../src/renderer/settings/routing.ts';
import '../src/renderer/settings/standalone-settings.css';

const entry = <T,>(value: T): PreferenceEntry<T> => ({ value, saved: value, observation: { exists: false }, editBase: null,
  baseValue: value, editRevision: 0, conflict: false, available: true, loading: false, saving: false, error: null });
const initial = (): BrowserPreferenceSnapshot => ({
  'open-link-in-target-preference': entry('external-browser'),
  'open-local-url-in-target-preference': entry('in-app-browser'),
  'browser-show-full-url': entry(false),
  'browser-annotation-screenshots-mode': entry('always'),
});
const client = new BrowserWorkbenchClient();
let authority = 0;
let show: (path: string, state?: unknown) => void;
let setGate: (gate: IntegrationAvailability) => void;
let setRawFeature: (value: boolean | null) => void;
let refreshes = 0;
let failNextNavigation = false;
const savedKeys = new Set<BrowserPreferenceKey>();

function Fixture() {
  const [locationKey, setLocationKey] = useState(0), [gate, changeGate] = useState<IntegrationAvailability>('restricted');
  const [rawFeature, changeRawFeature] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState(initial);
  const currentSnapshot = useRef(snapshot); currentSnapshot.current = snapshot;
  const owner = authority;
  const isCurrent = () => authority === owner;
  show = (path, state = null) => { ++authority; history.pushState(state, '', path); setLocationKey(value => value + 1); };
  setGate = gate => changeGate(gate);
  setRawFeature = value => changeRawFeature(value);
  const publish = (next: BrowserPreferenceSnapshot) => { currentSnapshot.current = next; setSnapshot(next); };
  const preferences = {
    snapshot,
    edit<K extends BrowserPreferenceKey>(key: K, value: BrowserPreferenceValues[K]) {
      const original = currentSnapshot.current[key];
      publish({ ...currentSnapshot.current, [key]: { ...original, value, editBase: original.observation, editRevision: original.editRevision + 1 } });
    },
    async reload(key: BrowserPreferenceKey) {
      const observation = await client.host<{ exists: boolean; value?: unknown }>('get-setting', { key });
      const prior = currentSnapshot.current[key];
      publish({ ...currentSnapshot.current, [key]: { ...prior, observation } });
    },
    async saveOne(key: BrowserPreferenceKey, assertBeforeSend: () => void) {
      const original = currentSnapshot.current[key];
      await client.host('set-setting', { key, value: original.value, expected: original.editBase }, { assertBeforeSend });
      const observation = await client.host<{ exists: boolean; value?: unknown }>('get-setting', { key });
      const prior = currentSnapshot.current[key];
      publish({ ...currentSnapshot.current, [key]: { ...prior, saved: original.value, observation, editBase: null } });
      savedKeys.add(key);
      return true;
    },
  };
  const route = readSettingsRoute({ pathname: location.pathname, search: location.search, hash: location.hash, state: history.state }, 'local');
  const props = { client, route, cwd: '/fixture/project', authorityKey: String(locationKey), isCurrent,
    navigate: (path: string, options: { replace: boolean; state: unknown }) => {
      if (!isCurrent()) return;
      if (failNextNavigation) { failNextNavigation = false; throw new Error('Synthetic navigation failure'); }
      ++authority;
      if (options.replace) history.replaceState(options.state, '', path); else history.pushState(options.state, '', path);
      setLocationKey(value => value + 1);
    },
    refreshAvailability: async () => { refreshes++; },
  };
  return <I18nProvider locale="en-US"><div className="yard-settings"><main className="yard-settings-main"><div className="yard-settings-content">
    {route.pathname.startsWith('/settings/computer-use') ?
      <ComputerUseSection {...props} platform="linux" computerUseAvailability="restricted" externalBrowserAvailability={gate} /> :
      <BrowserSection {...props} preferences={preferences} rawInAppBrowserFeature={rawFeature} pluginAvailability={gate} extensionsAvailability="restricted" />}
  </div></main></div></I18nProvider>;
}

declare global { interface Window { integrationSettingsHarness: {
  show(path: string, state?: unknown): void; gate(value: IntegrationAvailability): void; rawFeature(value: boolean | null): void; revoke(): void;
  refreshes(): number; saved(key: BrowserPreferenceKey): boolean; failNextNavigation(): void;
  suspend(): void; resume(): Promise<void>; close(): void;
} } }
window.integrationSettingsHarness = { show: (path, state) => show(path, state), gate: value => setGate(value), rawFeature: value => setRawFeature(value),
  revoke: () => { authority++; }, refreshes: () => refreshes, saved: key => savedKeys.has(key),
  failNextNavigation: () => { failNextNavigation = true; }, suspend: () => client.suspend(), resume: () => client.resume(), close: () => client.close() };
void client.connect().then(() => createRoot(document.getElementById('root')!).render(<Fixture />));
