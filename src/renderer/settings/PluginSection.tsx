import { useEffect, useMemo, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { pluginDetailPath, pluginsPath, readPlugin, readPlugins, resolvePluginSource } from './plugins.ts';
import type { PluginDetail, PluginEntry, PluginListing } from './plugins.ts';
import { pluginRoute } from './routing.ts';
import type { SettingsRoute } from './routing.ts';
import { scopeKey, validScopePath } from './scope.ts';
import type { SettingsScope } from './scope.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const displayName = (entry: PluginEntry) => entry.summary.interface?.displayName || entry.summary.name;
const status = (entry: PluginEntry) => !entry.summary.installed ? 'Not installed' : entry.summary.enabled ? 'Enabled' : 'Disabled';

export function PluginSection({ client, hostId, route, navigate, projectScope }: {
  client: WorkbenchClient; hostId: string; route: SettingsRoute; navigate: (path: string) => void; projectScope: SettingsScope;
}) {
  const { t } = useI18n();
  const [cwd, setCwd] = useState('');
  const [override, setOverride] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const scope = useMemo(() => override ? [override] : projectScope.paths, [override, scopeKey(projectScope)]);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [listing, setListing] = useState<PluginListing | null>(null);
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const directory = new URLSearchParams(route.search).get('directory') === '1';
  const nested = !/^\/settings\/plugins-settings\/?$/.test(route.pathname);
  const detailRoute = pluginRoute(route.pathname);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setListing(null); setDetail(null);
    void (async () => {
      if (!nested) {
        const result = await readPlugins(client, hostId, scope, directory);
        if (active) setListing(result);
      } else {
        if (!detailRoute) throw new Error('The plugin address is invalid');
        const source = await resolvePluginSource(client, route, scope);
        if (!active) return;
        const result = await readPlugin(client, detailRoute.hostId, source);
        if (result.summary.id !== detailRoute.pluginId) throw new Error('The marketplace returned a different plugin');
        if (active) setDetail(result);
      }
    })().catch(cause => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, hostId, scope, directory, nested, route.pathname, route.search, revision]);

  const refresh = () => setRevision(value => value + 1);
  const visible = listing?.entries.filter(entry => [displayName(entry), entry.summary.name, entry.summary.interface?.shortDescription, entry.marketplaceLabel]
    .some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) ?? [];
  return <>
    <div className="yard-section-heading"><h2>{nested ? detail?.summary.interface?.displayName || detail?.summary.name || t('Plugin details') : t('Plugins')}</h2>
      <button type="button" disabled={loading} onClick={refresh}>{t('Refresh')}</button></div>
    {nested ? <button type="button" onClick={() => navigate(pluginsPath(route, directory))}>{t('Back to plugins')}</button> : <>
      <div className="yard-segmented" role="group" aria-label={t('Plugins')}>
        <button type="button" aria-pressed={!directory} onClick={() => navigate(pluginsPath(route, false))}>{t('Installed')}</button>
        <button type="button" aria-pressed={directory} onClick={() => navigate(pluginsPath(route, true))}>{t('Browse directory')}</button>
      </div>
      <form className="yard-filter" onSubmit={event => { event.preventDefault();
        if (cwd && !validScopePath(cwd)) { setScopeError('Enter an absolute working directory.'); return; }
        setScopeError(null);
        const next = cwd || null;
        if (override === next) refresh(); else setOverride(next);
      }}>
        <label>{t('Working directory')} <input value={cwd} onChange={event => setCwd(event.target.value)} placeholder={t('Selected project or session')} /></label>
        <button type="submit" disabled={loading}>{t('Show')}</button>
      </form>
      <p className="yard-muted">{scope.length ? `${t('Scope:')} ${scope.join(', ')}` : t('Select a project or session with a working directory.')}</p>
      {scopeError && <p className="yard-setting-error" role="alert">{translateKnown(t, scopeError)}</p>}
      <label className="yard-plugin-search">{t('Search plugins')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </>}
    {error && <p className="yard-setting-error" role="alert">Could not load {nested ? 'plugin details' : 'plugins'}: {error} <button type="button" className="yard-link" onClick={refresh}>Retry</button></p>}
    {listing?.warnings.map((warning, index) => <p className="yard-setting-error" key={`${warning}:${index}`}>{warning}</p>)}
    {loading && <p role="status">Loading {nested ? 'plugin details' : 'plugins'}...</p>}
    {!nested && listing && !visible.length && <p className="yard-muted">{t(query ? 'No matching plugins.' : directory ? 'No plugins found.' : 'No installed plugins.')}</p>}
    {!nested && listing && <div className="yard-setting-group">{visible.map((entry, index) => <div className="yard-setting-row" key={`${entry.marketplace}:${entry.summary.id}:${index}`}>
      <div className="yard-setting-copy"><div className="yard-setting-label">{displayName(entry)}</div>
        <div className="yard-setting-description">{[entry.summary.interface?.shortDescription, entry.marketplaceLabel].filter(Boolean).join(' | ')}</div>
        {!entry.source && <div className="yard-setting-error">The marketplace did not provide a plugin source.</div>}</div>
      <div className="yard-setting-control"><span className="yard-muted">{translateKnown(t, status(entry))}</span>
        <button type="button" disabled={!entry.source} aria-label={`${t('View')} ${displayName(entry)}`} onClick={() => navigate(pluginDetailPath(route, entry))}>{t('Details')}</button></div>
    </div>)}</div>}
    {detail && <>
      <p>{detail.description || detail.summary.interface?.longDescription || detail.summary.interface?.shortDescription}</p>
      <p className="yard-muted">{[detail.marketplaceName, detail.summary.interface?.developerName, detail.summary.localVersion || detail.summary.version].filter(Boolean).join(' | ')}</p>
      <p>{!detail.summary.installed ? 'Not installed' : detail.summary.enabled ? 'Enabled' : 'Disabled'}
        {detail.summary.availability === 'DISABLED_BY_ADMIN' ? ' | Disabled by your administrator' : ''}</p>
      {detail.summary.disabledReason && detail.summary.disabledReason !== 'disabled_by_admin' && <p className="yard-muted">Availability: {detail.summary.disabledReason}</p>}
      {detail.skills.length > 0 && <><h3>Skills</h3><div className="yard-setting-group">{detail.skills.map((skill, index) => <div className="yard-setting-row" key={`${skill.name}:${index}`}>
        <div className="yard-setting-copy"><div className="yard-setting-label">{skill.name}</div><div className="yard-setting-description">{skill.description}</div></div>
        <span className="yard-muted">{skill.enabled ? 'Enabled' : 'Disabled'}</span></div>)}</div></>}
      {detail.hooks.length > 0 && <><h3>Hooks</h3><ul>{detail.hooks.map(hook => <li key={hook.key}>{hook.eventName}</li>)}</ul></>}
      {detail.apps.length > 0 && <><h3>Apps</h3><ul>{detail.apps.map(app => <li key={app.id}>{app.name}{app.description ? `: ${app.description}` : ''}</li>)}</ul></>}
      {detail.appTemplates.length > 0 && <><h3>Available apps</h3><ul>{detail.appTemplates.map(app => <li key={app.templateId}>{app.name}{app.description ? `: ${app.description}` : ''}</li>)}</ul></>}
      {detail.mcpServers.length > 0 && <><h3>MCP servers</h3><ul>{detail.mcpServers.map((server, index) => <li key={`${server}:${index}`}>{server}</li>)}</ul></>}
      {!!detail.scheduledTasks?.length && <><h3>Scheduled tasks</h3><ul>{detail.scheduledTasks.map(task => <li key={task.key}>{task.name}</li>)}</ul></>}
    </>}
    <p className="yard-muted">Installing, updating, or changing plugins is not available for this connection.</p>
  </>;
}
