import { useCallback, useEffect, useState } from 'react';
import { request } from './host.ts';
import { failureText, fetchHost, PageDialog, PageError, PageSection, SettingRow, Toggle, usePageData, type WorkspacePageProps } from './page-controls.tsx';
import type { PluginNetwork } from '../native/plugins.ts';

interface Plugin { id: string; name: string; installed: boolean; enabled: boolean; version?: string | null; localVersion?: string | null; interface?: { displayName?: string; shortDescription?: string }; disabledReason?: string | null }
interface Marketplace { name: string; path: string | null; plugins: Plugin[] }
interface Catalog { marketplaces: Marketplace[]; marketplaceLoadErrors?: { message: string; marketplaceName?: string }[] }
interface Skill { name: string; description: string; path: string; enabled: boolean }
interface SkillList { data: { skills: Skill[]; errors?: { message: string }[] }[] }
interface McpServer { name: string; tools: Record<string, unknown>; authStatus: string; error?: string; connectionStatus?: string }

function PluginNetworkSettings({ changed }: { changed(): void }) {
  const read = useCallback(() => fetchHost<PluginNetwork>('plugin-network'), []);
  const data = usePageData(read);
  return <PageSection title="Cloud plugin access">
    <p>Off by default. Installed plugins and local marketplaces work without cloud access.</p>
    <PageError error={data.error} retry={data.refresh} />
    {data.value && <PluginNetworkEditor key={JSON.stringify(data.value)} value={data.value} saved={() => { data.refresh(); changed(); }} />}
  </PageSection>;
}
function PluginNetworkEditor({ value, saved }: { value: PluginNetwork; saved(): void }) {
  const [proxy, setProxy] = useState(value.proxyUrl), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(cloudEnabled: boolean) {
    if (busy) return; setBusy(true); setError('');
    try { await fetchHost('plugin-network', { operation: 'save', cloudEnabled, proxyUrl: proxy }); saved(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <>
    <SettingRow label="Allow cloud plugin access" description="Allow installed-plugin and directory queries to contact the cloud."
      control={<Toggle checked={value.cloudEnabled} disabled={busy} ariaLabel="Allow cloud plugin access" onChange={enabled => void save(enabled)} />} />
    <form onSubmit={event => { event.preventDefault(); void save(value.cloudEnabled); }}>
      <SettingRow label="Plugin HTTP proxy" description="Optional address or port on the Yard server, for example 7897. Applies to local-host cloud inventory and directory queries."
        control={<div className="yard-page-inline"><input aria-label="Plugin HTTP proxy" value={proxy} onChange={event => setProxy(event.currentTarget.value)}
          placeholder="http://127.0.0.1:7897" disabled={busy} /><button type="submit" disabled={busy}>Save proxy</button></div>} />
    </form>
    <PageError error={error} />
  </>;
}

export function PluginInventory({ hostId, cwd, computerOnly = false }: { hostId: string; cwd?: string; computerOnly?: boolean }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const read = useCallback(async (): Promise<Catalog & { nextCursor: string | null }> => {
    if (query) {
      const result = await request<{ data: { plugin: Plugin; marketplaceName: string; marketplacePath: string | null }[]; nextCursor: string | null }>('plugin/search', {
        searchTerm: query, cwds: cwd ? [cwd] : [], limit: 50, cursor,
      }, { hostId });
      const markets = new Map<string, Marketplace>();
      for (const item of result.data) {
        const market = markets.get(item.marketplaceName) ?? { name: item.marketplaceName, path: item.marketplacePath, plugins: [] };
        market.plugins.push(item.plugin); markets.set(market.name, market);
      }
      return { marketplaces: [...markets.values()], nextCursor: result.nextCursor };
    }
    const [catalog, installed] = await Promise.all([
      request<Catalog>('plugin/list', { cwds: cwd ? [cwd] : [], marketplaceKinds: ['local'] }, { hostId }),
      request<Catalog>('plugin/installed', { cwds: cwd ? [cwd] : [] }, { hostId }),
    ]);
    for (const market of installed.marketplaces) {
      const existing = catalog.marketplaces.find(item => item.name === market.name);
      if (existing) existing.plugins = [...new Map([...existing.plugins, ...market.plugins].map(plugin => [plugin.id, plugin])).values()];
      else catalog.marketplaces.push(market);
    }
    return { ...catalog, nextCursor: null };
  }, [hostId, cwd, query, cursor]);
  const data = usePageData(read);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<{ plugin: Plugin; market: Marketplace }>();
  const [source, setSource] = useState<string>();
  const [removing, setRemoving] = useState<Marketplace>();
  async function act(method: string, params: Record<string, unknown>, close = false) {
    if (busy) return; setBusy(true); setError('');
    try { await request(method, params, { hostId }); if (close) { setSource(undefined); setSelected(undefined); setRemoving(undefined); } data.refresh(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <section aria-label="Plugins" className="yard-page-section">
    {!computerOnly && <PluginNetworkSettings changed={data.refresh} />}
    <div className="yard-page-section-heading"><h2>{computerOnly ? 'Computer use' : 'Plugins'}</h2>
      <button type="button" onClick={data.refresh} disabled={busy}>Refresh</button>
      {!computerOnly && <button type="button" onClick={() => setSource('')}>Add marketplace</button>}</div>
    {!computerOnly && <form className="yard-page-inline" role="search" onSubmit={event => { event.preventDefault(); setCursor(null); setQuery(search.trim()); }}>
      <input aria-label="Search plugin directory" type="search" value={search} onChange={event => setSearch(event.currentTarget.value)} placeholder="Search plugins" />
      <button type="submit">Search directory</button>{query && <button type="button" onClick={() => { setSearch(''); setQuery(''); setCursor(null); }}>Show installed & local plugins</button>}
    </form>}
    <PageError error={error || data.error} retry={data.refresh} />
    {!data.value && !data.error && <p role="status">Loading plugins…</p>}
    {data.value?.marketplaceLoadErrors?.map((error, index) => <p key={index} role="alert">{error.marketplaceName}: {error.message}</p>)}
    {data.value?.marketplaces.length === 0 && <p>{query ? 'No matching plugins.' : 'No plugin marketplaces. Add a marketplace directory or Git URL to browse its plugins.'}</p>}
    {data.value?.marketplaces.map(market => <div key={market.name} className="yard-plugin-market">
      {!computerOnly && <div className="yard-page-section-heading"><h3>{market.name}</h3>
        {market.path && <><button type="button" disabled={busy} onClick={() => void act('marketplace/upgrade', { marketplaceName: market.name })}>Update</button>
        <button type="button" disabled={busy} onClick={() => setRemoving(market)}>Remove marketplace</button></>}</div>}
      {market.plugins.filter(plugin => !computerOnly || /computer|desktop/i.test(plugin.id + plugin.name)).map(plugin => <SettingRow key={plugin.id}
        label={<button type="button" className="yard-page-text-button" onClick={() => setSelected({ plugin, market })}>{plugin.interface?.displayName ?? plugin.name}</button>}
        description={plugin.interface?.shortDescription ?? plugin.disabledReason ?? plugin.id}
        control={plugin.installed ? <div className="yard-page-inline"><span>{plugin.enabled ? 'Enabled' : 'Disabled'}</span>
          <Toggle checked={plugin.enabled} disabled={busy} ariaLabel={'Enable ' + plugin.name} onChange={enabled => void act('config/batchWrite', {
            edits: [{ keyPath: 'plugins.' + JSON.stringify(plugin.id) + '.enabled', value: enabled, mergeStrategy: 'upsert' }],
            filePath: null, expectedVersion: null, reloadUserConfig: true,
          })} /></div> : <button type="button" disabled={busy} onClick={() => void act('plugin/install', {
            ...(market.path ? { marketplacePath: market.path } : { remoteMarketplaceName: market.name }), pluginName: plugin.name, installAttemptId: crypto.randomUUID(),
          })}>Install {plugin.name}</button>} />)}
    </div>)}
    {data.value?.nextCursor && <button type="button" onClick={() => setCursor(data.value!.nextCursor)}>Next search results</button>}
    {cursor && <button type="button" onClick={() => setCursor(null)}>First search results</button>}
    {selected && <PluginDetails key={selected.plugin.id} {...selected} hostId={hostId} busy={busy} error={error}
      close={() => { setSelected(undefined); setError(''); }} uninstall={() => void act('plugin/uninstall', { pluginId: selected.plugin.id }, true)} />}
    {source !== undefined && <PageDialog title="Add marketplace" close={() => setSource(undefined)}><form onSubmit={event => {
      event.preventDefault(); void act('marketplace/add', { source: source.trim() }, true);
    }}><label>Directory or Git URL<input required value={source} onChange={event => setSource(event.currentTarget.value)} /></label>
      <PageError error={error} /><footer><button type="button" onClick={() => setSource(undefined)}>Cancel</button>
        <button type="submit" disabled={busy || !source.trim()}>Add</button></footer></form></PageDialog>}
    {removing && <PageDialog title="Remove marketplace?" close={() => setRemoving(undefined)}><p>Remove {removing.name} from the marketplace catalog?</p><PageError error={error} />
      <footer><button type="button" onClick={() => setRemoving(undefined)}>Cancel</button><button type="button" disabled={busy}
        onClick={() => void act('marketplace/remove', { marketplaceName: removing.name }, true)}>Remove</button></footer></PageDialog>}
  </section>;
}

function PluginDetails({ plugin, market, hostId, busy, error, close, uninstall }: {
  plugin: Plugin; market: Marketplace; hostId: string; busy: boolean; error: string; close(): void; uninstall(): void;
}) {
  const read = useCallback(() => request<{ plugin: { summary?: Plugin; description?: string; mcpServers?: string[]; skills?: unknown[] } }>('plugin/read', {
    ...(market.path ? { marketplacePath: market.path } : { remoteMarketplaceName: market.name }), pluginName: plugin.name,
  }, { hostId }), [market.path, market.name, plugin.name, hostId]);
  const data = usePageData(read);
  const [confirm, setConfirm] = useState(false);
  return <PageDialog title={plugin.interface?.displayName ?? plugin.name} close={close}>
    <p>{data.value?.plugin.description ?? plugin.interface?.shortDescription ?? plugin.id}</p>
    {(data.value?.plugin.summary?.localVersion ?? plugin.localVersion ?? plugin.version) && <p>{data.value?.plugin.summary?.localVersion ?? plugin.localVersion ?? plugin.version}</p>}
    {data.value?.plugin.mcpServers?.length ? <p>MCP servers: {data.value.plugin.mcpServers.join(', ')}</p> : null}
    <PageError error={error || data.error} retry={data.refresh} />
    {plugin.installed && <footer>{confirm ? <><span>Uninstall {plugin.name}?</span><button type="button" disabled={busy} onClick={uninstall}>Confirm uninstall</button></> :
      <button type="button" disabled={busy} onClick={() => setConfirm(true)}>Uninstall</button>}</footer>}
  </PageDialog>;
}

export function SkillsSettings({ hostId, cwd }: { hostId: string; cwd?: string }) {
  const read = useCallback(() => request<SkillList>('skills/list', { cwds: cwd ? [cwd] : [], forceReload: true }, { hostId }), [hostId, cwd]);
  const data = usePageData(read);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<Skill>();
  const skills = [...new Map(data.value?.data.flatMap(entry => entry.skills).map(skill => [skill.path, skill]) ?? []).values()];
  async function toggle(skill: Skill, enabled: boolean) {
    if (busy) return; setBusy(true); setError('');
    try { await request('skills/config/write', { path: skill.path, enabled }, { hostId }); data.refresh(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageSection title="Skills"><button type="button" onClick={data.refresh} disabled={busy}>Reload skills</button>
    <PageError error={error || data.error} retry={data.refresh} />
    {!data.value && !data.error && <p role="status">Loading skills…</p>}
    {data.value && !skills.length && <p>No skills found for this project.</p>}
    {data.value?.data.flatMap(entry => entry.errors ?? []).map((error, index) => <p role="alert" key={index}>{error.message}</p>)}
    {skills.map(skill => <SettingRow key={skill.path} label={<button type="button" className="yard-page-text-button" onClick={() => setSelected(skill)}>{skill.name}</button>}
      description={skill.description} control={<Toggle checked={skill.enabled} disabled={busy} ariaLabel={'Enable ' + skill.name}
        onChange={enabled => void toggle(skill, enabled)} />} />)}
    {selected && <TextFileDialog title={selected.name} path={selected.path} hostId={hostId} close={() => setSelected(undefined)} />}
  </PageSection>;
}

export function TextFileDialog({ title, path, hostId, close, editable = false }: { title: string; path: string; hostId: string; close(): void; editable?: boolean }) {
  const read = useCallback(async () => {
    const result = await request<{ dataBase64: string }>('fs/readFile', { path }, { hostId });
    return new TextDecoder().decode(Uint8Array.from(atob(result.dataBase64), char => char.charCodeAt(0)));
  }, [path, hostId]);
  const data = usePageData(read);
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    if (busy || draft === undefined) return; setBusy(true); setError('');
    try { await request('fs/writeFile', { path, dataBase64: btoa(Array.from(new TextEncoder().encode(draft), byte => String.fromCharCode(byte)).join('')) }, { hostId }); close(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageDialog title={title} close={close}><p className="yard-page-path">{path}</p><PageError error={error || data.error} retry={data.refresh} />
    {data.value !== undefined && <textarea aria-label={title + ' contents'} className="yard-page-file" readOnly={!editable} disabled={busy}
      value={draft ?? data.value} onChange={event => setDraft(event.currentTarget.value)} />}
    <footer><button type="button" onClick={close}>Close</button>{editable && <button type="button" disabled={busy || draft === undefined} onClick={() => void save()}>Save file</button>}</footer>
  </PageDialog>;
}

export function McpSettings({ hostId }: { hostId: string }) {
  const read = useCallback(async () => {
    const servers: McpServer[] = []; let cursor: string | null = null; const seen = new Set<string>();
    do {
      const page: { data: McpServer[]; nextCursor: string | null } = await request('mcpServerStatus/list', { cursor, limit: 100 }, { hostId });
      servers.push(...page.data); cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Repeated MCP server cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return servers;
  }, [hostId]);
  const data = usePageData(read);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function reload() {
    if (busy) return; setBusy(true); setError('');
    try { await request('config/mcpServer/reload', {}, { hostId }); data.refresh(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageSection title="MCP servers"><button type="button" disabled={busy} onClick={() => void reload()}>Reload MCP servers</button>
    <PageError error={error || data.error} retry={data.refresh} />
    {!data.value && !data.error && <p role="status">Loading MCP servers…</p>}
    {data.value?.length === 0 && <p>No MCP servers configured. Add servers in Configuration or install a plugin.</p>}
    {data.value?.map(server => <SettingRow key={server.name} label={server.name} description={server.error ?? server.authStatus}
      control={<span>{Object.keys(server.tools).length} tools</span>} />)}
  </PageSection>;
}

export function HooksSettings({ hostId, cwd }: { hostId: string; cwd?: string }) {
  type Hook = { key: string; eventName: string; sourcePath: string; enabled: boolean; trustStatus: string; command?: string; server?: string; tool?: string };
  const read = useCallback(() => request<{ data: { cwd: string; hooks: Hook[]; warnings: string[]; errors: { message: string }[] }[] }>('hooks/list', { cwds: cwd ? [cwd] : [] }, { hostId }), [hostId, cwd]);
  const data = usePageData(read);
  const [file, setFile] = useState<string>();
  return <PageSection title="Hooks"><button type="button" onClick={data.refresh}>Reload hooks</button><PageError error={data.error} retry={data.refresh} />
    {!data.value && !data.error && <p role="status">Loading hooks…</p>}
    {data.value && !data.value.data.some(entry => entry.hooks.length) && <p>No hooks configured for this project.</p>}
    {data.value?.data.map(entry => <div key={entry.cwd}>
      {[...entry.warnings, ...entry.errors.map(error => error.message)].map((warning, i) => <p role="alert" key={i}>{warning}</p>)}
      {entry.hooks.map(hook => <SettingRow key={hook.key} label={hook.eventName} description={hook.command ?? [hook.server, hook.tool].filter(Boolean).join(' / ')}
        control={<div className="yard-page-inline"><span>{hook.enabled ? hook.trustStatus : 'Disabled'}</span>
          <button type="button" onClick={() => setFile(hook.sourcePath)}>Review source</button></div>} />)}
    </div>)}
    {file && <TextFileDialog title="Hook source" path={file} hostId={hostId} close={() => setFile(undefined)} />}
  </PageSection>;
}

export default function PluginsPage({ route, hosts }: WorkspacePageProps) {
  const [hostId, setHostId] = useState('local');
  const [tab, setTab] = useState(route.startsWith('/skills') ? 'skills' : 'plugins');
  useEffect(() => { setTab(route.startsWith('/skills') ? 'skills' : 'plugins'); }, [route]);
  return <article className="yard-workspace-page" aria-label="Plugins and skills"><header><h1>Plugins & skills</h1>
    <label>Host<select value={hostId} onChange={event => setHostId(event.currentTarget.value)}>{hosts.map(host => <option key={host.hostId} value={host.hostId}>{host.label}</option>)}</select></label></header>
    <nav className="yard-page-tabs" aria-label="Plugin categories">{['plugins', 'skills', 'mcp'].map(item => <button type="button" key={item}
      aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{item === 'mcp' ? 'MCP servers' : item[0]!.toUpperCase() + item.slice(1)}</button>)}</nav>
    {tab === 'skills' ? <SkillsSettings key={hostId} hostId={hostId} /> : tab === 'mcp' ? <McpSettings key={hostId} hostId={hostId} /> : <PluginInventory key={hostId} hostId={hostId} />}
  </article>;
}
