import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AppWindow, Chrome, Ellipsis } from 'lucide-react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { listPlugins } from '../pages/plugins/catalog.ts';
import type { PluginEntry } from '../pages/plugins/catalog.ts';
import { pluginConfigRecords, reconcilePluginConfig, writePluginConfig } from '../app/ProductPluginConfig.ts';
import { useProductChanges } from '../app/ProductPageChanges.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { settingsConfigOperations } from './config-operations.ts';
import { Row } from './PreferenceControls.tsx';
import type { SettingsRoute } from './routing.ts';
import { pluginDetailPath } from './plugins.ts';
import './integration-settings.css';

export type IntegrationAvailability = 'available' | 'restricted' | 'unknown' | 'unsupported';
export interface IntegrationSettingsProps {
  client: WorkbenchClient;
  route: SettingsRoute;
  cwd: string;
  /** Changes for every host, connection, account, capability or route authority. */
  authorityKey: string;
  isCurrent(): boolean;
  navigate(path: string, options: { replace: boolean; state: unknown }): void | Promise<void>;
  refreshAvailability(): Promise<void>;
}

export function current(props: IntegrationSettingsProps): boolean {
  try { return props.isCurrent() === true; } catch { return false; }
}
export function assertCurrent(props: IntegrationSettingsProps): void {
  if (!current(props)) throw new DOMException('The selected settings page changed.', 'AbortError');
}
export function integrationPath(path: string, route: SettingsRoute): string {
  const params = new URLSearchParams(route.search);
  params.delete('initialRoute'); params.delete('host');
  if (route.hostId === route.baseHost) params.delete('hostId'); else params.set('hostId', route.hostId);
  const search = params.toString();
  return path + (search ? `?${search}` : '') + route.hash;
}
export function effectivePath(route: SettingsRoute): string {
  const initial = new URLSearchParams(route.search).get('initialRoute');
  return route.pathname === '/settings/general' && initial?.startsWith('/settings/') ? initial : route.pathname;
}
interface NavigationFailure { target: string; replace: boolean; message: string }
export function useIntegrationNavigation(props: IntegrationSettingsProps) {
  const [failure, setFailure] = useState<NavigationFailure | null>(null);
  const latest = useRef(props); latest.current = props;
  const mounted = useRef(true);
  const sequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const open = (target: string, replace = false) => {
    const source = latest.current;
    if (!current(source)) return;
    const version = ++sequence.current;
    setFailure(null);
    const failed = (cause: unknown) => {
      if (mounted.current && sequence.current === version && current(source)) setFailure({ target, replace, message: cause instanceof Error ? cause.message : String(cause) });
    };
    try { void Promise.resolve(source.navigate(target, { replace, state: source.route.state })).catch(failed); }
    catch (cause) { failed(cause); }
  };
  return {
    open,
    navigate: (path: string, replace = false) => open(integrationPath(path, latest.current.route), replace),
    failure,
    retry: () => { if (failure) open(failure.target, failure.replace); },
  };
}

export function NavigationFailureNotice({ failure, retry }: { failure: NavigationFailure | null; retry(): void }) {
  const { t } = useI18n();
  return failure && <p className="yard-setting-error" role="alert">{translateKnown(t, 'Could not open settings:')} {failure.message}{' '}
    <button type="button" className="yard-link" onClick={retry}>{t('Retry')}</button></p>;
}

interface FeatureState { loading: boolean; error: string | null; enabled: boolean | null }
export function useInAppBrowserFeature(props: IntegrationSettingsProps, rawFeature: boolean | null) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<FeatureState>({ loading: true, error: null, enabled: null });
  const sequence = useRef(0);
  useEffect(() => {
    let alive = true;
    const version = ++sequence.current;
    const valid = () => alive && sequence.current === version && current(props);
    if (rawFeature !== null) {
      setState({ loading: false, error: null, enabled: rawFeature });
      return () => { alive = false; };
    }
    setState({ loading: true, error: null, enabled: null });
    void (async () => {
      const seen = new Set<string>(); let cursor: string | null = null, enabled: boolean | undefined;
      do {
        if (!valid()) return;
        const page: unknown = await props.client.rpc('experimentalFeature/list', { cursor, limit: 100 }, props.route.hostId,
          { assertBeforeSend: () => { if (!valid()) throw new DOMException('The selected settings page changed.', 'AbortError'); } });
        if (!valid()) return;
        if (!page || typeof page !== 'object' || !('data' in page) || !Array.isArray(page.data)) throw new Error('Invalid experimental features response.');
        const response = page as { data: unknown[]; nextCursor?: unknown };
        if (response.nextCursor != null && (typeof response.nextCursor !== 'string' || !response.nextCursor)) throw new Error('Invalid experimental features cursor.');
        for (const item of response.data) {
          if (!item || typeof item !== 'object' || !('name' in item) || !('enabled' in item) || typeof item.name !== 'string' || typeof item.enabled !== 'boolean') throw new Error('Invalid experimental feature.');
          if (item.name === 'in_app_browser') { if (enabled !== undefined) throw new Error('Duplicate browser feature.'); enabled = item.enabled; }
        }
        cursor = typeof response.nextCursor === 'string' ? response.nextCursor : null;
        if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('Experimental feature pagination did not advance.');
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (valid()) setState(enabled === undefined ?
        { loading: false, error: 'In-app browser availability cannot be verified for this connection.', enabled: null } :
        { loading: false, error: null, enabled });
    })().catch(error => { if (valid()) setState({ loading: false, error: error instanceof Error ? error.message : String(error), enabled: null }); });
    return () => { alive = false; };
  }, [props.client, props.route.hostId, props.authorityKey, rawFeature, revision]);
  useEffect(() => props.client.subscribe(event => {
    if (event.type !== 'connection-state' && !(event.type === 'codex-app-server-connection-changed' && event.hostId === props.route.hostId && event.isSnapshot !== true)) return;
    ++sequence.current;
    if (event.state === 'connected') setRevision(value => value + 1);
    else setState({ loading: false, error: 'The connection was lost. Reconnect and try again.', enabled: null });
  }), [props.client, props.route.hostId, props.authorityKey]);
  return { ...state, retry: () => setRevision(value => value + 1) };
}

export function IntegrationControlRow({ label, children, restricted = false }: { label: string; children: ReactNode; restricted?: boolean }) {
  return <div className={`yard-integration-control-row${restricted ? ' yard-integration-restricted' : ''}`}><span className="yard-integration-icon" aria-hidden="true">
    {label === 'Google Chrome' ? <Chrome size={24} /> : <AppWindow size={24} />}</span>{children}</div>;
}

export function AvailabilityRow({ props, availability, label }: { props: IntegrationSettingsProps; availability: IntegrationAvailability; label: string }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const description = availability === 'restricted' ? 'Disabled by your organization or unavailable in your region' :
    availability === 'unsupported' ? 'This action is unavailable on this web host.' : 'Availability could not be determined for this connection.';
  return <IntegrationControlRow label={label} restricted={availability === 'restricted'}><Row label={label} description={description} error={error}>
    {availability === 'unknown' && <button type="button" onClick={() => { if (current(props)) { setError(null); void props.refreshAvailability().catch(cause => {
      if (current(props)) setError(cause instanceof Error ? cause.message : String(cause));
    }); } }}>{t('Retry')}</button>}
    <input type="checkbox" role="switch" aria-label={translateKnown(t, label)} checked={false} disabled readOnly />
  </Row></IntegrationControlRow>;
}

export function BundledPluginControl({ props, name, label, description, onTry }: {
  props: IntegrationSettingsProps; name: 'browser' | 'computer-use'; label: string; description: string;
  onTry?: (entry: PluginEntry) => Promise<void>;
}) {
  const { t } = useI18n();
  const operations = useMemo(() => settingsConfigOperations(props.client), [props.client]);
  const navigation = useIntegrationNavigation(props);
  const snapshot = useSyncExternalStore(operations.subscribe, operations.getSnapshot, operations.getSnapshot);
  const changePending = useProductChanges('plugins', props.route.hostId);
  const [revision, setRevision] = useState(0), [entry, setEntry] = useState<PluginEntry | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const latest = useRef(props); latest.current = props;
  useEffect(() => { void operations.refresh(); }, [operations]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setEntry(null); setError(null);
    void listPlugins(props.client, props.route.hostId, props.cwd, revision > 0, { assertBeforeSend: () => {
      if (!alive) throw new DOMException('The selected settings page changed.', 'AbortError');
      assertCurrent(props);
    } }).then(result => {
      if (!alive || !current(latest.current)) return;
      const matches = result.entries.filter(item => item.marketplaceName === 'openai-bundled' && item.plugin.name === name ||
        name === 'browser' && (item.plugin.id === 'plugin_connector_1p_51c1ba70f47481919149861084681943' || item.plugin.name === 'plugin_connector_1p_51c1ba70f47481919149861084681943'));
      if (matches.length > 1) throw new Error('The bundled plugin could not be identified uniquely.');
      if (result.warnings.length) throw new Error(result.warnings.join('; '));
      setEntry(matches[0] ?? null);
    }).catch(cause => { if (alive && current(latest.current)) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (alive && current(latest.current)) setLoading(false); });
    return () => { alive = false; };
  }, [props.client, props.route.hostId, props.cwd, props.authorityKey, name, revision]);
  const records = entry ? pluginConfigRecords(snapshot, props.route.hostId, props.cwd, entry.plugin.id) : [];
  const locked = busy || changePending || snapshot.loading || !!snapshot.error || snapshot.inFlight.length > 0 || records.length > 0;
  const update = async (enabled: boolean) => {
    if (!entry || locked || busyRef.current || !current(props)) return;
    busyRef.current = true;
    setBusy(true); setError(null);
    try {
      await writePluginConfig(operations, props.client, { hostId: props.route.hostId, cwd: props.cwd, plugin: entry.plugin, enabled }, () => current(props));
      if (current(props)) setRevision(value => value + 1);
    } catch (cause) { if (current(props)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyRef.current = false; if (current(props)) setBusy(false); }
  };
  const recover = async (operationId: string) => {
    if (busyRef.current || snapshot.loading || snapshot.error || snapshot.inFlight.length || !records.some(record => record.operationId === operationId) || !current(props)) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      await reconcilePluginConfig(operations, props.client, props.route.hostId, props.cwd, () => current(props), operationId);
      if (current(props)) setRevision(value => value + 1);
    } catch (cause) { if (current(props)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyRef.current = false; if (current(props)) setBusy(false); }
  };
  const openDetails = () => {
    if (!entry || !current(props)) return;
    const source = entry.marketplacePath ? { pluginName: entry.plugin.name, marketplacePath: entry.marketplacePath, remoteMarketplaceName: null } :
      { pluginName: entry.plugin.name, marketplacePath: null, remoteMarketplaceName: entry.marketplaceName };
    const path = pluginDetailPath(props.route, { summary: entry.plugin, marketplace: entry.marketplaceName, marketplaceLabel: entry.marketplaceName, source });
    navigation.open(path + props.route.hash);
  };
  const denied = entry?.plugin.availability === 'DISABLED_BY_ADMIN' || entry?.plugin.disabledReason === 'disabled_by_admin';
  const issue = error || snapshot.error || (changePending ? 'A previous plugin change still needs confirmation.' :
    records.length ? 'Check the original plugin configuration operation before making another change.' : null);
  return <IntegrationControlRow label={label}><div className="yard-setting-row">
    <div className="yard-setting-copy">{entry ? <button type="button" className="yard-integration-plugin-label" onClick={openDetails}>
      <span className="yard-setting-label">{translateKnown(t, label)}</span><span className="yard-setting-description">{translateKnown(t, description)}</span>
    </button> : <><div className="yard-setting-label">{translateKnown(t, label)}</div><div className="yard-setting-description">{translateKnown(t, loading ? 'Loading...' : 'In-app plugin unavailable')}</div></>}
      {issue && <div className="yard-setting-error" role="alert">{translateKnown(t, issue)} {error && !locked && <button type="button" className="yard-link" onClick={() => setRevision(value => value + 1)}>{t('Retry')}</button>}
        {snapshot.error && <button type="button" className="yard-link" disabled={busy || snapshot.loading}
          onClick={() => { if (current(props)) void operations.refresh(); }}>{t('Retry')}</button>}
        {records.map(record => <span key={record.operationId}> <code>{record.operationId}</code>{' '}
          <button type="button" className="yard-link" disabled={busy || snapshot.loading || !!snapshot.error || snapshot.inFlight.length > 0}
            onClick={() => { void recover(record.operationId); }}>{translateKnown(t, 'Check original operation')}</button></span>)}</div>}
      <NavigationFailureNotice failure={navigation.failure} retry={navigation.retry} />
    </div>
    <div className="yard-setting-control">{entry?.plugin.installed ? <>
      <details className="yard-integration-more" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary aria-label={translateKnown(t, 'More actions')} title={translateKnown(t, 'More actions')}><Ellipsis size={18} aria-hidden="true" /></summary>
        <div role="menu" className="yard-integration-select-menu">
          <button type="button" role="menuitem" disabled={!onTry || locked} title={!onTry ? translateKnown(t, 'Starting a chat with this plugin is unavailable.') : undefined}
            onClick={event => { event.currentTarget.closest('details')!.open = false; if (!onTry || !current(props)) return;
              void onTry(entry).catch(cause => { if (current(props)) setError(cause instanceof Error ? cause.message : String(cause)); }); }}>{translateKnown(t, 'Try now')}</button>
          <button type="button" role="menuitem" disabled title={translateKnown(t, 'Plugin installation and removal are unavailable on this web host.')}>{translateKnown(t, 'Delete')}</button>
        </div>
      </details>
      <input type="checkbox" role="switch" aria-label={translateKnown(t, label)} checked={entry.plugin.enabled} disabled={locked || !!denied || loading}
        onChange={event => { void update(event.target.checked); }} />
    </> : entry && <button type="button" disabled title={translateKnown(t, 'Plugin installation and removal are unavailable on this web host.')}>
      {translateKnown(t, 'Install')}</button>}</div>
  </div></IntegrationControlRow>;
}
