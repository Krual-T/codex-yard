import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import type { WorkbenchEvent } from '../workbench-contract.ts';
import type { FirstRunVariant } from '../pages/auth/first-run.ts';
import { ProductPages } from './ProductPages.tsx';
import type { ProductPagesClient, ProductPagesProps } from './ProductPages.tsx';
import type { ProductAccess, ProductRouteOwner } from './ProductRoutePage.tsx';
import { readProductBridge } from './ProductPagesBridge.ts';
import { readProductRoute } from './product-routes.ts';
import { trackProductChange, useProductChanges } from './ProductPageChanges.ts';
import { emptyConfigSubscribe, getEmptyConfigSnapshot, pluginConfigRecords, reconcilePluginConfig, writePluginConfig } from './ProductPluginConfig.ts';
import type { ProductConfigurationWrites } from './ProductPluginConfig.ts';

type Authority = Pick<ProductRouteOwner, 'hostId' | 'authorityKey' | 'locationKey'>;
type Account = { authenticated: boolean; method: 'chatgpt' | 'apiKey' | 'copilot' | 'other' };

export interface ProductWorkspaceProps {
  client: ProductPagesClient;
  location: ProductPagesProps['location'];
  hostId: string;
  cwd: string;
  authorityKey: string | number;
  locationKey: string | number;
  /** Consult live App authority and route access synchronously, including during an awaited guard. */
  isCurrent(authority: Authority): boolean;
  navigate: ProductPagesProps['navigate'];
  renderUnresolved: ProductPagesProps['renderUnresolved'];
  firstRunVariant: FirstRunVariant;
  onAuthenticated: ProductPagesProps['onAuthenticated'];
  onFirstRunContinue: ProductPagesProps['firstRun']['onContinue'];
  workspace: ProductPagesProps['workspace'];
  projects: Omit<ProductPagesProps['projects'], 'cloudAccess'>;
  plan: ProductPagesProps['plan'];
  onOpenFile?: ProductPagesProps['onOpenFile'];
  onOpenImage?: ProductPagesProps['onOpenImage'];
  onTrySkill?: ProductPagesProps['skills']['onTry'];
  onTryPlugin?: ProductPagesProps['plugins']['onTry'];
  /** The existing settings operation controller, shared with configuration recovery. */
  configurationWrites?: ProductConfigurationWrites;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseAccount(value: unknown): Account {
  if (!record(value) || typeof value.requiresOpenaiAuth !== 'boolean' || !Object.hasOwn(value, 'account')) throw new Error('Invalid account response');
  if (value.account === null) return { authenticated: !value.requiresOpenaiAuth, method: 'other' };
  if (!record(value.account) || typeof value.account.type !== 'string') throw new Error('Invalid account response');
  if (value.account.type === 'chatgpt' || value.account.type === 'chatgptAuthTokens') return { authenticated: true, method: 'chatgpt' };
  if (value.account.type === 'apiKey') return { authenticated: true, method: 'apiKey' };
  if (value.account.type === 'copilot') return { authenticated: true, method: 'copilot' };
  throw new Error('The account type could not be verified.');
}

function accountEvent(event: WorkbenchEvent, hostId: string): 'refresh' | 'disconnected' | null {
  if (event.type === 'connection-state') return event.state === 'connected' ? 'refresh' : 'disconnected';
  if (event.hostId !== hostId) return null;
  if (event.type === 'codex-app-server-connection-changed' && event.isSnapshot !== true) return event.state === 'connected' ? 'refresh' : 'disconnected';
  if (event.type === 'mcp-notification' && (event.method === 'account/updated' || event.method === 'account/login/completed')) return 'refresh';
  return null;
}

async function featureEnabled(client: ProductPagesClient, current: () => boolean, hostId: string, name: string): Promise<boolean> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  let enabled: boolean | undefined;
  do {
    if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
    const page: unknown = await client.rpc('experimentalFeature/list', { cursor, limit: 100 }, hostId);
    if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
    if (!record(page) || !Array.isArray(page.data) || page.nextCursor != null && (typeof page.nextCursor !== 'string' || !page.nextCursor)) throw new Error('Invalid experimental features response.');
    for (const item of page.data) {
      if (!record(item) || typeof item.name !== 'string' || typeof item.enabled !== 'boolean') throw new Error('Invalid experimental feature.');
      if (item.name === name) {
        if (enabled !== undefined) throw new Error('Duplicate experimental feature.');
        enabled = item.enabled;
      }
    }
    cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('Experimental feature pagination did not advance.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  // The original capability treats an absent feature as enabled after a successful list.
  return enabled !== false;
}

async function routeAccess(props: ProductWorkspaceProps, account: Account, current: () => boolean): Promise<ProductAccess> {
  const route = readProductRoute(props.location);
  if (!account.authenticated) return { state: 'allow' };
  const accountGated = ['skills', 'plugins', 'projects', 'legacy-project', 'agents', 'agent-detail', 'agent-create', 'agent-edit', 'automations'].includes(route.kind);
  if (accountGated && account.method === 'chatgpt') {
    // The public account projection does not establish the original account and workspace access inputs.
    await readProductBridge({ kind: 'account-access' }, current);
  }
  if (route.kind === 'agent-detail') return { state: 'legacy' };
  if (route.kind === 'agents' || route.kind === 'agent-create' || route.kind === 'agent-edit') return { state: 'redirect', path: '/' };
  if (route.kind === 'legacy-project') throw new Error('Project access could not be determined on this host.');
  if (route.kind === 'automations') {
    const enabled = props.hostId === 'local' && await featureEnabled(props.client, current, 'local', 'in_app_local_automation');
    return { state: 'allow', scheduledTasks: enabled ? 'allowed' : 'denied', cloudScheduledTasks: 'denied' };
  }
  return { state: 'allow' };
}

export function ProductWorkspace(props: ProductWorkspaceProps) {
  const key = JSON.stringify([props.hostId, props.authorityKey, props.locationKey]);
  return <ProductWorkspaceScope key={key} {...props} />;
}

function ProductWorkspaceScope(props: ProductWorkspaceProps) {
  const { t } = useI18n();
  const latest = useRef(props); latest.current = props;
  const sequence = useRef(0), alive = useRef(false);
  const skillChanges = useProductChanges('skills', props.hostId);
  const pluginChanges = useProductChanges('plugins', props.hostId);
  const config = props.configurationWrites;
  const configSnapshot = useSyncExternalStore(config?.subscribe ?? emptyConfigSubscribe,
    config?.getSnapshot ?? getEmptyConfigSnapshot, getEmptyConfigSnapshot);
  useEffect(() => { if (config) void config.refresh(); }, [config]);
  const pluginConfigBusy = !!config && (configSnapshot.loading || !!configSnapshot.error || configSnapshot.inFlight.length > 0
    || pluginConfigRecords(configSnapshot, props.hostId).length > 0);
  const [account, setAccount] = useState<{ state: 'loading' } | { state: 'error'; message: string } |
    { state: 'ready'; value: Account; access: ProductAccess; sequence: number }>({ state: 'loading' });
  const authority: Authority = { hostId: props.hostId, authorityKey: props.authorityKey, locationKey: props.locationKey };
  const parentCurrent = () => {
    const next = latest.current;
    try { return next.hostId === authority.hostId && next.authorityKey === authority.authorityKey && next.locationKey === authority.locationKey && next.isCurrent(authority) === true; }
    catch { return false; }
  };
  const load = async () => {
    const attempt = ++sequence.current;
    const current = () => alive.current && attempt === sequence.current && parentCurrent();
    if (!current()) return;
    setAccount({ state: 'loading' });
    try {
      const value = parseAccount(await props.client.rpc('account/read', { refreshToken: false }, authority.hostId));
      if (!current()) return;
      let access: ProductAccess;
      try { access = await routeAccess(props, value, current); }
      catch (error) {
        if (!current()) return;
        access = { state: 'error', message: error instanceof Error ? error.message : 'Access could not be checked.', retry: load };
      }
      if (current()) setAccount({ state: 'ready', value, access, sequence: attempt });
    } catch (error) {
      if (current()) setAccount({ state: 'error', message: error instanceof Error ? error.message : 'The account could not be read.' });
    }
  };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = props.client.subscribe(event => {
      const action = accountEvent(event, authority.hostId);
      if (!action) return;
      ++sequence.current;
      if (action === 'disconnected') {
        if (alive.current && parentCurrent()) setAccount({ state: 'error', message: 'The selected host connection was lost.' });
      } else void load();
    });
    void load();
    return () => { alive.current = false; ++sequence.current; unsubscribe(); };
  }, [props.client, authority.hostId, authority.authorityKey, authority.locationKey]);

  const retry = () => { void load(); };
  if (account.state === 'loading') return <p role="status">{translateKnown(t, 'Checking account...')}</p>;
  if (account.state === 'error') return <div role="alert">{translateKnown(t, account.message)} <button type="button" onClick={retry}>{t('Retry')}</button></div>;
  const { value, access, sequence: accepted } = account;
  const ownerCurrent = (owner: ProductRouteOwner) => alive.current && accepted === sequence.current && parentCurrent() &&
    owner.hostId === authority.hostId && owner.authorityKey === authority.authorityKey && owner.locationKey === authority.locationKey &&
    owner.accountKey === null && owner.userKey === null;
  const track = (kind: 'skills' | 'plugins') => async (owner: ProductRouteOwner, change: { hostId: string; kind?: string; sourceType?: string }, operation: () => Promise<void>) => {
    if (!ownerCurrent(owner) || change.hostId !== owner.hostId) throw new DOMException('The selected page changed.', 'AbortError');
    if (kind === 'plugins' && change.kind === 'setEnabled' && change.sourceType !== 'remote') { await operation(); return; }
    await trackProductChange(kind, owner.hostId, operation);
  };
  const managePlugins = async (owner: ProductRouteOwner) => {
    const current = () => ownerCurrent(owner);
    if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
    const enabled = await featureEnabled(props.client, current, owner.hostId, 'plugins');
    if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
    const target = new URL(enabled ? '/settings/plugins-settings' : '/skills', 'http://yard.invalid');
    if (enabled) { target.search = props.location.search; target.hash = props.location.hash; }
    const original = new URLSearchParams(props.location.search);
    if (owner.hostId !== 'local' || original.has('host') || original.has('hostId')) {
      target.searchParams.delete('host'); target.searchParams.set('hostId', owner.hostId);
    }
    if (!await props.navigate(target.pathname + target.search + target.hash, enabled ? { state: props.location.state } : undefined, owner)) {
      throw new Error('Navigation was not completed.');
    }
  };
  return <ProductPages client={props.client} location={props.location} hostId={authority.hostId} cwd={props.cwd}
    accountKey={null} userKey={null} authorityKey={authority.authorityKey} locationKey={authority.locationKey}
    auth={value.authenticated ? { state: 'ready' } : { state: 'required', onAuthenticated: () => {} }} access={access}
    isCurrent={ownerCurrent} navigate={props.navigate} renderUnresolved={props.renderUnresolved}
    firstRun={{ authMethod: value.method, variant: props.firstRunVariant, onContinue: props.onFirstRunContinue }} onAuthenticated={props.onAuthenticated}
    workspace={props.workspace} projects={{ ...props.projects, cloudAccess: value.method === 'chatgpt' ? 'unknown' : 'denied' }}
    agents={{ identity: null, enabled: false, canBuild: false, canShare: false }} plan={props.plan}
    skills={{ hasUnresolvedChanges: skillChanges, onTrackChange: track('skills'), onTry: props.onTrySkill }}
    plugins={{ hasUnresolvedChanges: pluginChanges || pluginConfigBusy, accountKind: 'unknown', workspaceDirectory: 'unknown', onTrackChange: track('plugins'), onTry: props.onTryPlugin, onManage: managePlugins,
      onSetLocalEnabled: (owner, target, client) => writePluginConfig(config, client, target, () => ownerCurrent(owner)),
      onReconcileChanges: config ? async (owner, scope, client) => {
        if (pluginChanges) throw new Error('The original plugin operation cannot be verified on this host.');
        await reconcilePluginConfig(config, client, scope.hostId, scope.cwd, () => ownerCurrent(owner));
      } : undefined }}
    onOpenFile={props.onOpenFile} onOpenImage={props.onOpenImage} />;
}
