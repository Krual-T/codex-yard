import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Plus, Puzzle, RefreshCw, Search, X } from 'lucide-react';
import type { WorkbenchClient } from '../../workbench-contract.ts';
import { addMarketplace, installPlugin, listInstalledPlugins, listPlugins, pluginPage, pluginPublicSections, pluginRef, readPlugin, searchPlugins, setLocalPluginEnabled, uninstallPlugin } from './catalog.ts';
import type { PluginApp, PluginCatalog, PluginChange, PluginChangeScope, PluginDetail, PluginEntry, PluginPage, PluginPublicSection, PluginRef, PluginSkill, PluginSummary } from './catalog.ts';
import { definitelyNotChanged } from '../../app/ProductPageChanges.ts';
import './plugins.css';

export interface PluginsPageProps {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  accountKey?: string | null;
  hasUnresolvedChanges: boolean;
  onTrackPluginChange?: (change: PluginChange, operation: () => Promise<void>) => Promise<void>;
  onReconcilePluginChanges?: (scope: PluginChangeScope) => Promise<void>;
  initialPlugin?: PluginRef | null;
  initialDirectory?: 'public' | 'personal' | 'workspace';
  initialCategory?: { slug: string; title: string } | null;
  initialSearch?: string;
  workspaceTabVisible?: boolean;
  workspaceSearchError?: string;
  showPersonalShared?: boolean;
  personalUnavailableReason?: string;
  onBrowseSkills?: () => void;
  onManagePlugins?: () => void | Promise<void>;
  onCreatePlugin?: () => void | Promise<void>;
  onConnectApp?: (value: { hostId: string; app: PluginApp }) => void | Promise<void>;
  onOpenSkill?: (value: { hostId: string; cwd: string; skill: PluginSkill }) => void | Promise<void>;
  onTryPlugin?: (value: { hostId: string; cwd: string; plugin: PluginSummary }) => void | Promise<void>;
  onSetLocalPluginEnabled?: (value: { hostId: string; cwd: string; plugin: PluginSummary; enabled: boolean }) => Promise<void>;
  onSetRemotePluginEnabled?: (value: { hostId: string; plugin: PluginSummary; enabled: boolean }) => Promise<void>;
  onLoadPersonalPlugins?: (value: { hostId: string; cwd: string; accountKey: string; section: 'created' | 'shared'; cursor: string | null }) => Promise<PluginPage>;
  onLoadWorkspacePlugins?: (value: { hostId: string; cwd: string; accountKey: string; cursor: string | null }) => Promise<PluginPage>;
  onLoadPublicSections?: (value: { hostId: string; cwd: string; accountKey: string | null }) => Promise<PluginPublicSection[]>;
  onLoadPublicCategory?: (value: { hostId: string; cwd: string; accountKey: string | null; categorySlug: string; searchTerm: string; cursor: string | null }) => Promise<PluginPage>;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const displayName = (plugin: PluginSummary) => plugin.interface?.displayName || plugin.name;

export function PluginsPage(props: PluginsPageProps) {
  return <PluginsScope key={JSON.stringify([props.hostId, props.cwd, props.accountKey, props.initialPlugin, props.initialDirectory, props.initialCategory, props.initialSearch])} {...props} />;
}

function PluginsScope({ client, hostId, cwd, accountKey, initialPlugin, initialDirectory, initialCategory, initialSearch, workspaceTabVisible, workspaceSearchError, showPersonalShared = true, personalUnavailableReason, hasUnresolvedChanges, onTrackPluginChange, onReconcilePluginChanges, onBrowseSkills, onManagePlugins, onCreatePlugin, onConnectApp, onOpenSkill, onTryPlugin, onSetLocalPluginEnabled, onSetRemotePluginEnabled, onLoadPersonalPlugins, onLoadWorkspacePlugins, onLoadPublicSections, onLoadPublicCategory }: PluginsPageProps) {
  const [directory, setDirectory] = useState<'public' | 'personal' | 'workspace'>(initialDirectory ?? 'public');
  const personal = directory === 'personal', workspace = directory === 'workspace';
  const [category, setCategory] = useState<{ slug: string; title: string } | null>(initialCategory ?? null);
  const [query, setQuery] = useState(initialSearch ?? '');
  const [searchTerm, setSearchTerm] = useState((initialSearch ?? '').trim());
  const [installed, setInstalled] = useState<PluginCatalog | null>(null);
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [errors, setErrors] = useState<{ installed?: string; catalog?: string }>({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<PluginRef | null>(initialPlugin ?? null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageBusy, setManageBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [appsNeedingAuth, setAppsNeedingAuth] = useState<PluginApp[]>([]);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const managing = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!query.trim()) { setSearchTerm(''); return; }
    const timer = setTimeout(() => setSearchTerm(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let current = true;
    setLoading(true); setErrors({});
    void Promise.allSettled([listInstalledPlugins(client, hostId, cwd), listPlugins(client, hostId, cwd, revision > 0)]).then(([inventory, available]) => {
      if (!current) return;
      const nextErrors: { installed?: string; catalog?: string } = {};
      if (inventory.status === 'fulfilled') setInstalled(inventory.value); else nextErrors.installed = message(inventory.reason);
      if (available.status === 'fulfilled') setCatalog(available.value); else nextErrors.catalog = message(available.reason);
      setErrors(nextErrors);
      if (!nextErrors.installed && !nextErrors.catalog) setRefreshRequired(false);
      setLoading(false);
    });
    return () => { current = false; };
  }, [client, hostId, cwd, revision]);
  const scope: PluginChangeScope = { hostId, cwd, accountKey: accountKey ?? null };
  const locked = uncertain || hasUnresolvedChanges;
  const refresh = () => { setNotice(null); setRefreshRequired(true); setRevision(value => value + 1); };
  const reconcile = async () => {
    if (!onReconcilePluginChanges || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      await onReconcilePluginChanges(scope);
      if (alive.current) { setUncertain(false); setActionError(null); refresh(); }
    } catch (cause) { if (alive.current) setActionError(`Could not check plugin changes: ${message(cause)}`); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const mutate = async (change: PluginChange, operation: () => Promise<void>, success: string) => {
    if (!onTrackPluginChange || inFlight.current || loading || locked || refreshRequired || errors.installed || errors.catalog) return false;
    inFlight.current = true; setBusy(true); setActionError(null); setNotice(null);
    const execution: { promise: Promise<void> | null; closed: boolean; repeated: boolean } = { promise: null, closed: false, repeated: false };
    try {
      try {
        await onTrackPluginChange(change, () => {
          if (execution.promise || execution.closed || !alive.current) {
            execution.repeated = true;
            return Promise.reject(new Error('Plugin change can no longer start'));
          }
          execution.promise = Promise.resolve().then(() => {
            if (!alive.current) throw new Error('Plugin host changed before the operation started');
            return operation();
          });
          void execution.promise.catch(() => {});
          return execution.promise;
        });
      } finally { execution.closed = true; }
      if (!execution.promise || execution.repeated) throw new Error('Plugin change was not executed exactly once');
      await execution.promise;
      if (alive.current) { setNotice(success); setRefreshRequired(true); setRevision(value => value + 1); }
      return true;
    } catch (cause) {
      if (alive.current) {
        const known = definitelyNotChanged(cause);
        setUncertain(!known);
        setActionError(known ? `Could not change the plugin: ${message(cause)}` : `Could not confirm the change: ${message(cause)}. Check the result before trying again.`);
      }
      return false;
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const invoke = async (operation: () => void | Promise<void>) => {
    setActionError(null);
    try { await operation(); } catch (cause) { if (alive.current) setActionError(message(cause)); }
  };
  const manage = async () => {
    if (!onManagePlugins || managing.current) return;
    managing.current = true; setManageBusy(true); setManageError(null);
    try { await onManagePlugins(); }
    catch (cause) { if (alive.current) setManageError(`Could not open plugin management: ${message(cause)}`); }
    finally { managing.current = false; if (alive.current) setManageBusy(false); }
  };
  const install = (ref: PluginRef) => mutate({ ...scope, kind: 'install', ref }, async () => { const apps = await installPlugin(client, hostId, ref); if (alive.current) setAppsNeedingAuth(apps); }, 'Plugin installation completed. Refreshing inventory...');
  const uninstall = (plugin: PluginSummary) => mutate({ ...scope, kind: 'uninstall', pluginId: plugin.id }, () => uninstallPlugin(client, hostId, plugin.id), 'Plugin uninstalled. Refreshing inventory...');
  const setEnabled = (plugin: PluginSummary, enabled: boolean) => mutate({ ...scope, kind: 'setEnabled', pluginId: plugin.id, sourceType: plugin.source.type, enabled }, async () => {
    if (plugin.source.type === 'remote') {
      if (!onSetRemotePluginEnabled) throw new Error('Workspace plugin enablement is unavailable');
      await onSetRemotePluginEnabled({ hostId, plugin, enabled });
    } else if (onSetLocalPluginEnabled) await onSetLocalPluginEnabled({ hostId, cwd, plugin, enabled });
    else await setLocalPluginEnabled(client, hostId, plugin, enabled);
  }, 'Plugin setting saved. Refreshing inventory...');
  const matches = (entry: PluginEntry) => `${displayName(entry.plugin)} ${entry.plugin.name} ${entry.plugin.interface?.shortDescription ?? ''} ${entry.marketplaceName}`.toLowerCase().includes(query.trim().toLowerCase());
  const installedEntries = installed?.entries.filter(entry => entry.plugin.installed && matches(entry)) ?? [];
  const entries = catalog?.entries.filter(matches) ?? [];
  const disabled = loading || busy || locked || refreshRequired || !onTrackPluginChange || !!errors.installed || !!errors.catalog;
  const loadError = [errors.installed && `Failed to load installed plugins: ${errors.installed}`, errors.catalog && `Failed to load plugin catalog: ${errors.catalog}`].filter(Boolean).join(' ');
  const selectCatalog = (value: typeof directory) => { setDirectory(value); setCategory(null); };
  const categorySearch = query.trim() ? searchTerm : '';

  return <main className="yard-plugins"><div className="yard-plugins-content">
    <header className="yard-plugins-header"><div><h1>Plugins</h1><p>Connect plugins to let Codex work across your tools</p></div>
      <div className="yard-plugins-toolbar"><button className="yard-plugins-icon" type="button" aria-label="Refresh plugins" title="Refresh plugins" disabled={loading || busy} onClick={refresh}><RefreshCw size={17} /></button>
        <button type="button" disabled={!onManagePlugins || manageBusy} onClick={() => void manage()}>Manage</button><button type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add</button></div>
    </header>
    <nav className="yard-plugins-tabs" aria-label="Capabilities"><button type="button" aria-current="page">Plugins</button><button type="button" disabled={!onBrowseSkills} onClick={onBrowseSkills}>Skills</button></nav>
    <label className="yard-plugins-search"><Search size={17} aria-hidden="true" /><span className="yard-plugins-sr">Search plugins</span><input ref={searchInput} type="search" placeholder="Search plugins" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {loading && <p role="status" className="yard-plugins-muted">Loading plugins...</p>}
    {errors.installed && <div className="yard-plugins-error" role="alert">Failed to load installed plugins: {errors.installed} <button type="button" disabled={loading || busy} onClick={refresh}>Retry</button></div>}
    {errors.catalog && <div className="yard-plugins-error" role="alert">Failed to load plugin catalog: {errors.catalog} <button type="button" disabled={loading || busy} onClick={refresh}>Retry</button></div>}
    {manageError && <div className="yard-plugins-error" role="alert">{manageError} <button type="button" disabled={manageBusy} onClick={() => void manage()}>Retry</button></div>}
    {!onTrackPluginChange && <p className="yard-plugins-muted">Plugin changes are unavailable on this host.</p>}
    {(actionError || locked) && <div className="yard-plugins-error" role="alert">{actionError || 'A plugin change needs verification.'} {locked && <button type="button" disabled={busy || !onReconcilePluginChanges} onClick={() => void reconcile()}>Check changes</button>}</div>}
    {notice && <p className="yard-plugins-muted" role="status">{notice}</p>}
    {[...(installed?.warnings ?? []), ...(catalog?.warnings ?? [])].map((warning, index) => <p className="yard-plugins-muted" key={`${warning}:${index}`}>{warning}</p>)}
    {appsNeedingAuth.length > 0 && <section className="yard-plugins-apps" aria-label="Apps needing connection"><h2>Connect apps</h2>
      {appsNeedingAuth.map(app => <div key={app.id}><span>{app.name}</span><button type="button" disabled={!onConnectApp} onClick={() => onConnectApp && void invoke(() => onConnectApp({ hostId, app }))}>Connect</button></div>)}</section>}
    {installedEntries.length > 0 && <section><h2>Installed</h2><PluginList entries={installedEntries} onSelect={entry => setSelected(pluginRef(entry))} /></section>}
    <section><div className="yard-plugins-section-header"><h2>{category ? <><button type="button" className="yard-plugins-icon" aria-label={`Back to ${directory} plugins`} title={`Back to ${directory} plugins`} autoFocus onClick={() => { setCategory(null); searchInput.current?.focus(); }}><ArrowLeft size={17} /></button>{category.title}</> : 'Discover'}</h2><div className="yard-plugins-segment" role="group" aria-label="Plugin catalog">
      <button type="button" aria-pressed={directory === 'public'} onClick={() => selectCatalog('public')}>Public</button>
      {(workspaceTabVisible || workspace) && <button type="button" aria-pressed={workspace} onClick={() => selectCatalog('workspace')}>Workspace</button>}
      <button type="button" aria-pressed={personal} onClick={() => selectCatalog('personal')}>Personal</button></div></div>
      {!personal && category ? onLoadPublicCategory ? !query.trim() || searchTerm === query.trim() ? <PagedPluginList key={JSON.stringify(['category', hostId, cwd, category.slug, categorySearch, revision])}
        loadPage={cursor => onLoadPublicCategory({ hostId, cwd, accountKey: accountKey ?? null, categorySlug: category.slug, searchTerm: categorySearch, cursor })}
        emptyText={categorySearch ? 'No plugins match your search.' : 'No plugins in this category.'} onSelect={entry => setSelected(pluginRef(entry))} />
        : <p role="status" className="yard-plugins-muted">Searching plugins...</p>
        : <p role="alert" className="yard-plugins-error">This public category is unavailable on this host.</p>
        : query.trim() ? workspace && workspaceSearchError ? <p role="alert" className="yard-plugins-error">{workspaceSearchError}</p> : searchTerm === query.trim() ? <PagedPluginList key={JSON.stringify(['search', hostId, cwd, directory, searchTerm, revision])}
        loadPage={cursor => searchPlugins(client, hostId, cwd, searchTerm, workspace ? 'workspace' : personal ? 'personal' : 'global', cursor)}
        emptyText="No plugins match your search." onSelect={entry => setSelected(pluginRef(entry))} /> : <p role="status" className="yard-plugins-muted">Searching plugins...</p>
        : personal ? onLoadPersonalPlugins && accountKey ? <>
          {(!category || category.slug === 'plugins-created-by-you') && <PagedPluginList key={JSON.stringify(['created', hostId, cwd, revision])} title="Created by you" emptyText="No plugins created yet."
            loadPage={cursor => onLoadPersonalPlugins({ hostId, cwd, accountKey, section: 'created', cursor })} onSelect={entry => setSelected(pluginRef(entry))} />
          }
          {showPersonalShared && (!category || category.slug === 'plugins-shared-with-you') && <PagedPluginList key={JSON.stringify(['shared', hostId, cwd, revision])} title="Shared with you" emptyText="No plugins shared with you."
            loadPage={cursor => onLoadPersonalPlugins({ hostId, cwd, accountKey, section: 'shared', cursor })} onSelect={entry => setSelected(pluginRef(entry))} />}
          {!showPersonalShared && category?.slug === 'plugins-shared-with-you' && <p role="alert" className="yard-plugins-error">Shared plugins require a workspace account.</p>}
          {category && !['plugins-created-by-you', 'plugins-shared-with-you'].includes(category.slug) && <p role="alert" className="yard-plugins-error">This personal category is unavailable on this host.</p>}
        </> : <p role="alert" className="yard-plugins-error">{personalUnavailableReason || 'Personal plugin directory is unavailable on this host.'}</p>
        : workspace ? onLoadWorkspacePlugins && accountKey ? <PagedPluginList key={JSON.stringify(['workspace', hostId, cwd, revision])} title="Workspace" emptyText="No workspace plugins found."
          loadPage={cursor => onLoadWorkspacePlugins({ hostId, cwd, accountKey, cursor })} onSelect={entry => setSelected(pluginRef(entry))} />
          : <p role="alert" className="yard-plugins-error">{workspaceSearchError || 'Workspace plugin directory is unavailable on this host.'}</p>
        : <><PublicPluginDirectory hostId={hostId} cwd={cwd} accountKey={accountKey ?? null} revision={revision}
          loadSections={onLoadPublicSections} canOpenCategory={!!onLoadPublicCategory} onOpenCategory={setCategory} onSelect={entry => setSelected(pluginRef(entry))} />
          {entries.length > 0 && <section><h3>Available marketplaces</h3><PluginList entries={entries} onSelect={entry => setSelected(pluginRef(entry))} /></section>}</>}
    </section>
    {selected && <PluginDetailDialog key={JSON.stringify(selected)} client={client} hostId={hostId} cwd={cwd} refValue={selected} revision={revision}
      disabled={disabled} refreshing={loading || busy} actionError={actionError || (locked ? 'A plugin change needs verification.' : null) || loadError || null} needsCheck={locked} canCheck={!!onReconcilePluginChanges} onCheckChanges={reconcile} onRefresh={refresh} onClose={() => setSelected(null)} onInstall={install} onUninstall={uninstall} onEnabled={setEnabled}
      onConnectApp={onConnectApp} onOpenSkill={onOpenSkill} onTryPlugin={onTryPlugin} canEnableRemote={!!onSetRemotePluginEnabled} />}
    {adding && <AddMarketplaceDialog busy={disabled} refreshing={loading || busy} actionError={actionError || (locked ? 'A plugin change needs verification.' : null) || loadError || null} needsCheck={locked} canCheck={!!onReconcilePluginChanges} onCheckChanges={reconcile} onClose={() => setAdding(false)} onRefresh={refresh}
      onAdd={async (source, refName) => { if (await mutate({ ...scope, kind: 'addMarketplace', source, refName: refName || null }, () => addMarketplace(client, hostId, source, refName), 'Marketplace added. Refreshing plugins...')) setAdding(false); }}
      onCreatePlugin={onCreatePlugin ? () => invoke(onCreatePlugin) : undefined} />}
  </div></main>;
}

function PublicPluginDirectory({ hostId, cwd, accountKey, revision, loadSections, canOpenCategory, onOpenCategory, onSelect }: {
  hostId: string; cwd: string; accountKey: string | null; revision: number;
  loadSections?: PluginsPageProps['onLoadPublicSections']; canOpenCategory: boolean;
  onOpenCategory(category: { slug: string; title: string }): void; onSelect(entry: PluginEntry): void;
}) {
  const [sections, setSections] = useState<PluginPublicSection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const loader = useRef(loadSections);
  loader.current = loadSections;
  const available = !!loadSections;
  useEffect(() => {
    let current = true;
    if (!available) { setSections(null); setLoading(false); return () => { current = false; }; }
    setLoading(true); setError(null);
    void Promise.resolve().then(() => loader.current!({ hostId, cwd, accountKey })).then(pluginPublicSections)
      .then(value => { if (current) setSections(value); })
      .catch(cause => { if (current) setError(message(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [available, hostId, cwd, accountKey, revision, retry]);
  if (!available) return <p role="alert" className="yard-plugins-error">Public plugin categories are unavailable on this host.</p>;
  return <>
    {loading && <p role="status" className="yard-plugins-muted">Loading public categories...</p>}
    {error && <div role="alert" className="yard-plugins-error">Could not load public categories: {error} <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {!loading && !error && sections?.length === 0 && <p className="yard-plugins-muted">No public categories available.</p>}
    {!loading && !error && sections?.map(section => <section key={section.id}><h3 className="yard-plugins-category-heading">
      {section.categorySlug && canOpenCategory ? <button type="button" onClick={() => onOpenCategory({ slug: section.categorySlug!, title: section.title })}>{section.title}<ChevronRight size={16} /></button> : section.title}
    </h3><PluginList entries={section.entries} onSelect={onSelect} /></section>)}
  </>;
}

function PluginList({ entries, onSelect }: { entries: PluginEntry[]; onSelect(entry: PluginEntry): void }) {
  return <ul className="yard-plugin-list">{entries.map(entry => <li key={`${entry.marketplaceName}:${entry.marketplacePath}:${entry.plugin.id}`}>
    <button type="button" className="yard-plugin-row" onClick={() => onSelect(entry)}><span className="yard-plugin-icon"><Puzzle size={19} aria-hidden="true" /></span>
      <span className="yard-plugin-copy"><strong>{displayName(entry.plugin)}</strong><span>{entry.plugin.interface?.shortDescription || entry.marketplaceName}</span></span>
      <span className="yard-plugin-state">{entry.plugin.installed ? entry.plugin.enabled ? 'Installed' : 'Disabled' : ''}</span></button>
  </li>)}</ul>;
}

function PagedPluginList({ loadPage, title, emptyText, onSelect }: { loadPage(cursor: string | null): Promise<PluginPage>; title?: string; emptyText: string; onSelect(entry: PluginEntry): void }) {
  const [entries, setEntries] = useState<PluginEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  const load = async (next: string | null) => {
    if (busy.current) return;
    const id = ++sequence.current;
    busy.current = true; setLoading(true); setError(null);
    try {
      const page = pluginPage(await loadPage(next));
      if (id !== sequence.current) return;
      if (next !== null && page.nextCursor === next) throw new Error('Plugin pagination did not advance');
      setEntries(previous => {
        const merged = next === null ? [] : previous;
        return [...new Map([...merged, ...page.entries].map(entry => [JSON.stringify([entry.marketplaceName, entry.marketplacePath, entry.plugin.id]), entry])).values()];
      });
      setCursor(page.nextCursor); setLoaded(true);
    } catch (cause) { if (id === sequence.current) setError(message(cause)); }
    finally { if (id === sequence.current) { busy.current = false; setLoading(false); } }
  };
  useEffect(() => { void load(null); return () => { sequence.current++; busy.current = false; }; }, []);
  return <section className="yard-plugins-paged">{title && <h3>{title}</h3>}
    {loading && <p role="status" className="yard-plugins-muted">Loading plugins...</p>}
    {error && <div role="alert" className="yard-plugins-error">Could not load plugins: {error} <button type="button" disabled={loading} onClick={() => void load(loaded ? cursor : null)}>Retry</button></div>}
    {loaded && entries.length === 0 && !error && !cursor && <p className="yard-plugins-muted">{emptyText}</p>}
    <PluginList entries={entries} onSelect={onSelect} />
    {loaded && cursor && !error && <button type="button" className="yard-plugins-more" disabled={loading} onClick={() => void load(cursor)}>Load more</button>}
  </section>;
}

interface DetailProps {
  client: WorkbenchClient; hostId: string; cwd: string; refValue: PluginRef; revision: number; disabled: boolean; refreshing: boolean; actionError: string | null;
  needsCheck: boolean; canCheck: boolean; onCheckChanges(): Promise<void>;
  onRefresh(): void; onClose(): void; onInstall(ref: PluginRef): Promise<boolean>; onUninstall(plugin: PluginSummary): Promise<boolean>;
  onEnabled(plugin: PluginSummary, enabled: boolean): Promise<boolean>; canEnableRemote: boolean;
  onConnectApp?: PluginsPageProps['onConnectApp']; onOpenSkill?: PluginsPageProps['onOpenSkill']; onTryPlugin?: PluginsPageProps['onTryPlugin'];
}

function PluginDetailDialog({ client, hostId, cwd, refValue, revision, disabled, refreshing, actionError, needsCheck, canCheck, onCheckChanges, onRefresh, onClose, onInstall, onUninstall, onEnabled, canEnableRemote, onConnectApp, onOpenSkill, onTryPlugin }: DetailProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { alive.current = true; const element = dialog.current; element?.showModal(); return () => { alive.current = false; if (element?.open) element.close(); }; }, []);
  useEffect(() => {
    let current = true; setLoading(true); setError(null);
    void readPlugin(client, hostId, refValue).then(value => { if (current) setDetail(value); })
      .catch(cause => { if (current) setError(`Could not load plugin: ${message(cause)}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, hostId, refValue, revision, retry]);
  const invoke = async (operation: () => void | Promise<void>) => {
    setCallbackError(null);
    try { await operation(); } catch (cause) { if (alive.current) setCallbackError(message(cause)); }
  };
  const plugin = detail?.summary;
  return <dialog className="yard-plugin-dialog" ref={dialog} aria-labelledby="yard-plugin-detail-title" onClose={onClose}>
    <header><div><h2 id="yard-plugin-detail-title">{plugin ? displayName(plugin) : refValue.pluginName}</h2><p>{detail?.marketplaceName}</p></div>
      <button className="yard-plugins-icon" type="button" aria-label="Close plugin details" title="Close" autoFocus onClick={() => dialog.current?.close()}><X size={18} /></button></header>
    {loading && <p role="status" className="yard-plugins-muted">Loading plugin...</p>}
    {error && <div role="alert" className="yard-plugins-error">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {actionError && <div role="alert" className="yard-plugins-error">{actionError} {needsCheck
      ? <button type="button" disabled={refreshing || !canCheck} onClick={() => void onCheckChanges()}>Check changes</button>
      : <button type="button" disabled={refreshing} onClick={onRefresh}>Refresh plugins</button>}</div>}
    {callbackError && <p role="alert">{callbackError}</p>}
    {detail && plugin && <>
      <p>{detail.description || plugin.interface?.longDescription || plugin.interface?.shortDescription}</p>
      {plugin.availability === 'DISABLED_BY_ADMIN' && <p className="yard-plugins-muted">Unavailable: {plugin.disabledReason || 'disabled by administrator'}</p>}
      <div className="yard-plugin-actions">
        {!plugin.installed && <button type="button" disabled={disabled || loading || plugin.installPolicy === 'NOT_AVAILABLE' || plugin.availability === 'DISABLED_BY_ADMIN'} onClick={() => void onInstall(refValue)}>Install</button>}
        {plugin.installed && <><label><input type="checkbox" checked={plugin.enabled} disabled={disabled || loading || plugin.source.type === 'remote' && !canEnableRemote} onChange={event => void onEnabled(plugin, event.target.checked)} /> Enabled</label>
          <button type="button" disabled={disabled || loading || !onTryPlugin || !plugin.enabled} onClick={() => onTryPlugin && void invoke(() => onTryPlugin({ hostId, cwd, plugin }))}>Try in chat</button>
          <button type="button" disabled={disabled || loading || plugin.installPolicy === 'INSTALLED_BY_DEFAULT'} onClick={() => setConfirm(true)}>Uninstall</button></>}
      </div>
      {confirm && <div className="yard-plugin-confirm" role="group" aria-label="Confirm uninstall"><span>Uninstall {displayName(plugin)}?</span>
        <button type="button" disabled={disabled} onClick={() => setConfirm(false)}>Cancel</button><button type="button" disabled={disabled} onClick={() => void onUninstall(plugin).then(success => { if (success && alive.current) setConfirm(false); })}>Confirm uninstall</button></div>}
      {detail.apps.length > 0 && <section><h3>Apps</h3>{detail.apps.map(app => <div className="yard-plugin-detail-row" key={app.id}><span>{app.name}</span><button type="button" disabled={!onConnectApp} onClick={() => onConnectApp && void invoke(() => onConnectApp({ hostId, app }))}>Connect</button></div>)}</section>}
      {detail.skills.length > 0 && <section><h3>Skills</h3>{detail.skills.map(skill => <div className="yard-plugin-detail-row" key={`${skill.name}:${skill.path}`}><span><strong>{skill.name}</strong><br />{skill.description}</span><button type="button" disabled={!onOpenSkill || !skill.path} onClick={() => onOpenSkill && void invoke(() => onOpenSkill({ hostId, cwd, skill }))}>Open</button></div>)}</section>}
      {detail.mcpServers.length > 0 && <section><h3>MCP servers</h3><ul>{detail.mcpServers.map(name => <li key={name}><code>{name}</code></li>)}</ul></section>}
      {detail.hooks.length > 0 && <section><h3>Hooks</h3><ul>{detail.hooks.map(hook => <li key={hook.key}><code>{hook.eventName}</code></li>)}</ul></section>}
      {detail.scheduledTasks && detail.scheduledTasks.length > 0 && <section><h3>Scheduled tasks</h3><ul>{detail.scheduledTasks.map(task => <li key={task.key}>{task.name}</li>)}</ul></section>}
    </>}
  </dialog>;
}

function AddMarketplaceDialog({ busy, refreshing, actionError, needsCheck, canCheck, onCheckChanges, onClose, onRefresh, onAdd, onCreatePlugin }: {
  busy: boolean; refreshing: boolean; actionError: string | null; onClose(): void; onRefresh(): void;
  needsCheck: boolean; canCheck: boolean; onCheckChanges(): Promise<void>;
  onAdd(source: string, refName: string): Promise<void>; onCreatePlugin?: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState('');
  const [refName, setRefName] = useState('');
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  return <dialog className="yard-plugin-dialog yard-plugin-add" ref={dialog} aria-labelledby="yard-plugin-add-title" onClose={onClose}>
    <header><h2 id="yard-plugin-add-title">Add plugins</h2><button className="yard-plugins-icon" type="button" aria-label="Close" title="Close" onClick={() => dialog.current?.close()}><X size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); if (source.trim()) void onAdd(source.trim(), refName.trim()); }}>
      <label>Marketplace source<input autoFocus value={source} onChange={event => setSource(event.target.value)} required /></label>
      <label>Git ref (optional)<input value={refName} onChange={event => setRefName(event.target.value)} /></label>
      <div className="yard-plugin-actions"><button type="submit" disabled={busy || !source.trim()}>Add marketplace</button>
        {onCreatePlugin && <button type="button" disabled={busy} onClick={() => void onCreatePlugin()}>Create plugin</button>}</div>
    </form>
    {actionError && <div className="yard-plugins-error" role="alert">{actionError} {needsCheck
      ? <button type="button" disabled={refreshing || !canCheck} onClick={() => void onCheckChanges()}>Check changes</button>
      : <button type="button" disabled={refreshing} onClick={onRefresh}>Refresh plugins</button>}</div>}
  </dialog>;
}
