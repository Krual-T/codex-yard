import { useEffect, useRef, useState } from 'react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import type { PluginEntry } from '../pages/plugins/catalog.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { BrowserSection } from './BrowserSection.tsx';
import type { BrowserPreferenceKey, BrowserPreferencePort, BrowserPreferenceValues } from './BrowserSection.tsx';
import { ComputerUseSection } from './ComputerUseSection.tsx';
import { effectivePath } from './integration-settings.tsx';
import type { IntegrationAvailability } from './integration-settings.tsx';
import type { Preferences, PreferenceSnapshot } from './preferences.ts';
import type { SettingsRoute } from './routing.ts';

export interface OriginalIntegrationGates {
  authorityKey: string;
  browserAgentRollout?: boolean | null;
  externalBrowserRollout?: boolean | null;
  computerUseRollout?: boolean | null;
  extensionsRollout?: boolean | null;
  runCodexInWsl?: boolean | null;
  windowsComputerUseAllowed?: boolean | null;
}

export interface SettingsBrowserIntegrationsProps {
  client: WorkbenchClient;
  route: SettingsRoute;
  cwd: string;
  preferences: Preferences;
  snapshot: PreferenceSnapshot;
  platform: 'macOS' | 'windows' | 'linux' | 'unknown';
  captureAuthority(hostId: string): { key: string; assertCurrent(): void };
  navigate(path: string, options: { replace: boolean; state: unknown }, assertBeforeCommit: () => void): Promise<boolean>;
  /** Use `unmodified` only after the host stops rewriting experimentalFeature/list. */
  rawFeatureSource: 'unmodified' | 'unverified';
  originalGates?: OriginalIntegrationGates;
  onTryPlugin?: (entry: PluginEntry, scope: { hostId: string; cwd: string; authorityKey: string; assertCurrent(): void }) => Promise<void>;
}

type Account = 'chatgpt' | 'other';
type FeatureMap = Map<string, boolean>;
interface Scope {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  location: string;
  state: unknown;
  platform: SettingsBrowserIntegrationsProps['platform'];
  rawFeatureSource: SettingsBrowserIntegrationsProps['rawFeatureSource'];
  gatesKey: string;
  epoch: number;
  serial: number;
  lease: { key: string; assertCurrent(): void } | null;
  captureError: string | null;
  revoked: boolean;
}
type ReadState = { scope: Scope | null; status: 'loading' | 'error'; message?: string } |
  { scope: Scope; status: 'ready'; account: Account; policy: boolean; features: FeatureMap };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const aborted = () => new DOMException('The selected settings page changed.', 'AbortError');

function parseAccount(value: unknown): Account {
  if (!object(value) || typeof value.requiresOpenaiAuth !== 'boolean' || !Object.hasOwn(value, 'account')) throw new Error('Invalid account response.');
  if (value.account === null) return 'other';
  if (!object(value.account) || typeof value.account.type !== 'string') throw new Error('Invalid account response.');
  if (value.account.type === 'chatgpt' || value.account.type === 'chatgptAuthTokens') return 'chatgpt';
  if (value.account.type === 'apiKey' || value.account.type === 'copilot') return 'other';
  throw new Error('The account type could not be verified.');
}

function parsePolicy(value: unknown): boolean {
  if (!object(value) || !Object.hasOwn(value, 'requirements') || value.requirements != null && !object(value.requirements)) {
    throw new Error('Invalid configuration requirements response.');
  }
  const allow = object(value.requirements) ? value.requirements.allowBrowserAndComputerUse : undefined;
  if (allow != null && typeof allow !== 'boolean') throw new Error('Invalid browser and computer use policy.');
  return allow !== false;
}

async function readFeatures(client: WorkbenchClient, hostId: string, assertCurrent: () => void): Promise<FeatureMap> {
  const features: FeatureMap = new Map(), seen = new Set<string>();
  let cursor: string | null = null;
  do {
    assertCurrent();
    const result: unknown = await client.rpc('experimentalFeature/list', { cursor, limit: 100 }, hostId, { assertBeforeSend: assertCurrent });
    assertCurrent();
    if (!object(result) || !Array.isArray(result.data) || result.nextCursor != null && (typeof result.nextCursor !== 'string' || !result.nextCursor)) {
      throw new Error('Invalid experimental features response.');
    }
    for (const item of result.data) {
      if (!object(item) || typeof item.name !== 'string' || typeof item.enabled !== 'boolean') throw new Error('Invalid experimental feature.');
      if (features.has(item.name)) throw new Error('Duplicate experimental feature.');
      features.set(item.name, item.enabled);
    }
    cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null;
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('Experimental feature pagination did not advance.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return features;
}

function availability(values: readonly (boolean | null)[]): IntegrationAvailability {
  if (values.includes(false)) return 'restricted';
  return values.every(value => value === true) ? 'available' : 'unknown';
}

function selectedEvent(event: WorkbenchEvent, hostId: string, awaitingLease: boolean): 'connected' | 'disconnected' | 'refresh' | null {
  if (event.type === 'connection-state') return event.state === 'connected' ? 'connected' : 'disconnected';
  if (event.hostId !== hostId) return null;
  if (event.type === 'codex-app-server-connection-changed') {
    if (event.isSnapshot === true) return awaitingLease && event.state === 'connected' ? 'connected' : null;
    return event.state === 'connected' ? 'connected' : 'disconnected';
  }
  if (event.type === 'mcp-notification' && (event.method === 'account/updated' || event.method === 'account/login/completed')) return 'refresh';
  return null;
}

export function SettingsBrowserIntegrations(props: SettingsBrowserIntegrationsProps) {
  const { t } = useI18n();
  const [epoch, setEpoch] = useState(0), [connected, setConnected] = useState(true);
  const [read, setRead] = useState<ReadState>({ scope: null, status: 'loading' });
  const serial = useRef(0), active = useRef<Scope | null>(null), mounted = useRef(true), latest = useRef(props);
  latest.current = props;

  let lease: Scope['lease'] = null, captureError: string | null = null;
  try { lease = props.captureAuthority(props.route.hostId); }
  catch (error) { captureError = message(error); }
  const gates = props.originalGates;
  const gatesKey = JSON.stringify([gates?.authorityKey, gates?.browserAgentRollout, gates?.externalBrowserRollout,
    gates?.computerUseRollout, gates?.extensionsRollout, gates?.runCodexInWsl, gates?.windowsComputerUseAllowed]);
  const previous = active.current;
  if (!previous || previous.client !== props.client || previous.hostId !== props.route.hostId || previous.cwd !== props.cwd ||
    previous.location !== props.route.path || previous.state !== props.route.state || previous.platform !== props.platform ||
    previous.rawFeatureSource !== props.rawFeatureSource || previous.gatesKey !== gatesKey || previous.epoch !== epoch ||
    previous.lease?.key !== lease?.key || previous.captureError !== captureError) {
    if (previous) previous.revoked = true;
    active.current = { client: props.client, hostId: props.route.hostId, cwd: props.cwd, location: props.route.path,
      state: props.route.state, platform: props.platform, rawFeatureSource: props.rawFeatureSource, gatesKey, epoch,
      serial: ++serial.current, lease, captureError, revoked: false };
  }
  const scope = active.current!;
  const assertCurrent = () => {
    if (!mounted.current || active.current !== scope || scope.revoked || !scope.lease) throw aborted();
    scope.lease.assertCurrent();
  };
  const isCurrent = () => { try { assertCurrent(); return true; } catch { return false; } };

  useEffect(() => {
    mounted.current = true;
    if (scope.revoked) { setEpoch(value => value + 1); return; }
    const unsubscribe = scope.client.subscribe(event => {
      const change = selectedEvent(event, scope.hostId, !scope.lease);
      if (!change) return;
      scope.revoked = true;
      if (change !== 'refresh') setConnected(change === 'connected');
      setEpoch(value => value + 1);
    });
    if (!connected) setRead({ scope, status: 'error', message: 'The connection was lost. Reconnect and try again.' });
    else if (!scope.lease) {
      setRead({ scope, status: 'error', message: scope.captureError ?? 'The selected host connection is unavailable.' });
      try {
        latest.current.captureAuthority(scope.hostId).assertCurrent();
        scope.revoked = true; setEpoch(value => value + 1);
      } catch { /* Wait for a connection event or an explicit retry. */ }
    }
    else {
      setRead({ scope, status: 'loading' });
      const request = (method: string, params: Record<string, unknown>) => {
        assertCurrent();
        return scope.client.rpc(method, params, scope.hostId, { assertBeforeSend: assertCurrent });
      };
      try {
        const account = request('account/read', { refreshToken: false });
        const policy = request('configRequirements/read', {});
        const features = readFeatures(scope.client, scope.hostId, assertCurrent);
        void Promise.all([account, policy, features]).then(([accountValue, policyValue, featureValues]) => {
          assertCurrent();
          setRead({ scope, status: 'ready', account: parseAccount(accountValue), policy: parsePolicy(policyValue), features: featureValues });
        }).catch(error => { if (isCurrent()) setRead({ scope, status: 'error', message: message(error) }); });
      } catch (error) { if (isCurrent()) setRead({ scope, status: 'error', message: message(error) }); }
    }
    return () => { scope.revoked = true; unsubscribe(); };
  }, [scope, connected]);
  useEffect(() => () => { mounted.current = false; if (active.current) active.current.revoked = true; }, []);

  const retry = async () => {
    assertCurrent();
    scope.revoked = true;
    setEpoch(value => value + 1);
  };
  const currentRead = read.scope === scope ? read : { scope, status: 'loading' as const };
  if (currentRead.status !== 'ready') return currentRead.status === 'error' ?
    <p role="alert">{translateKnown(t, 'Could not load browser settings:')} {translateKnown(t, currentRead.message ?? '')}{' '}
      <button type="button" onClick={() => { if (connected) { scope.revoked = true; setEpoch(value => value + 1); } }}>{t('Retry')}</button></p> :
    <p role="status">{translateKnown(t, 'Loading browser settings...')}</p>;

  const values = currentRead.features;
  const rawInAppBrowserFeature = values.has('in_app_browser') ? scope.rawFeatureSource === 'unmodified' ? values.get('in_app_browser')! : null : true;
  const original = gates?.authorityKey === scope.lease?.key ? gates : undefined;
  const notWsl = original?.runCodexInWsl == null ? null : !original.runCodexInWsl;
  const browserAvailability = availability([currentRead.policy, values.get('browser_use') ?? true, rawInAppBrowserFeature,
    original?.browserAgentRollout ?? null, notWsl]);
  const externalBrowserAvailability = availability([currentRead.policy, values.get('browser_use_external') ?? true,
    original?.externalBrowserRollout ?? null, notWsl]);
  const platform = scope.platform === 'unknown' ? null : scope.platform === 'macOS' || scope.platform === 'windows';
  const windowsAllowed = scope.platform !== 'windows' || currentRead.account !== 'chatgpt' ? true : original?.windowsComputerUseAllowed ?? null;
  const computerAvailability = availability([currentRead.policy, values.get('computer_use') ?? true,
    original?.computerUseRollout ?? null, platform, windowsAllowed]);
  const extensionsAvailability = availability([rawInAppBrowserFeature, original?.extensionsRollout ?? null]);
  const common = { client: scope.client, route: props.route, cwd: scope.cwd, authorityKey: `${scope.lease!.key}:${scope.serial}`,
    isCurrent, refreshAvailability: retry,
    navigate: async (path: string, options: { replace: boolean; state: unknown }) => {
      assertCurrent();
      if (!await latest.current.navigate(path, options, assertCurrent)) throw new Error('Navigation was not completed.');
    },
    onTryPlugin: props.onTryPlugin ? async (entry: PluginEntry) => {
      assertCurrent();
      const onTry = latest.current.onTryPlugin;
      if (!onTry) throw new Error('Starting a chat with this plugin is unavailable.');
      await onTry(entry, { hostId: scope.hostId, cwd: scope.cwd, authorityKey: scope.lease!.key, assertCurrent });
    } : undefined,
  };
  if (effectivePath(props.route).startsWith('/settings/computer-use')) return <ComputerUseSection {...common} platform={scope.platform}
    computerUseAvailability={computerAvailability} externalBrowserAvailability={externalBrowserAvailability} />;
  const preferences: BrowserPreferencePort = { snapshot: props.snapshot, edit: (key, value) => {
    assertCurrent(); props.preferences.edit(key as BrowserPreferenceKey, value as BrowserPreferenceValues[BrowserPreferenceKey]);
  },
    reload: async key => { assertCurrent(); await props.preferences.reload(key); },
    saveOne: (key, guard) => { assertCurrent(); return props.preferences.saveOne(key, () => { assertCurrent(); guard(); }); } };
  return <BrowserSection {...common} preferences={preferences} rawInAppBrowserFeature={rawInAppBrowserFeature}
    pluginAvailability={browserAvailability} extensionsAvailability={extensionsAvailability} />;
}
