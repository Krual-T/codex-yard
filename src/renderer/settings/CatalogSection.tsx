import { useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { readCatalog } from './catalog.ts';
import type { CatalogKind, CatalogPage } from './catalog.ts';

const titles: Record<CatalogKind, string> = { 'skills-settings': 'Skills', 'hooks-settings': 'Hooks', 'mcp-settings': 'MCP servers', 'plugins-settings': 'Plugins' };
const management: Record<CatalogKind, string> = {
  'skills-settings': 'Installing or changing skills is not available in this web host.',
  'hooks-settings': 'Editing or enabling hooks is not available in this web host.',
  'mcp-settings': 'Adding, editing, or authenticating servers is not available in this web host.',
  'plugins-settings': 'Installing, updating, or changing plugins is not available in this web host.',
};
export function CatalogSection({ client, hostId, kind }: { client: WorkbenchClient; hostId: string; kind: CatalogKind }) {
  const [cwd, setCwd] = useState('');
  const [scope, setScope] = useState('');
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const load = async (cursor: string | null, selectedCwd: string) => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const next = await readCatalog(client, hostId, kind, selectedCwd, cursor);
      if (generation.current !== current) return;
      setPage(previous => cursor && previous ? { items: [...previous.items, ...next.items], warnings: [...previous.warnings, ...next.warnings], nextCursor: next.nextCursor } : next);
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation.current === current) setLoading(false); }
  };
  useEffect(() => { void load(null, ''); return () => { generation.current++; }; }, [client, hostId, kind]);
  return <>
    <div className="yard-section-heading"><h2>{titles[kind]}</h2><button type="button" disabled={loading} onClick={() => { void load(null, scope); }}>Refresh</button></div>
    {kind !== 'mcp-settings' && <form className="yard-filter" onSubmit={event => { event.preventDefault(); setScope(cwd.trim()); void load(null, cwd.trim()); }}>
      <label>Working directory <input value={cwd} onChange={event => setCwd(event.target.value)} placeholder="Host default" /></label>
      <button type="submit" disabled={loading}>Show</button>
    </form>}
    {error && <p className="yard-setting-error" role="alert">Could not load {titles[kind].toLowerCase()}: {error}</p>}
    {page?.warnings.map((warning, index) => <p className="yard-setting-error" key={`${warning}:${index}`}>{warning}</p>)}
    {loading && <p role="status">Loading...</p>}
    {page && page.items.length === 0 && !loading && <p className="yard-muted">No {titles[kind].toLowerCase()} found.</p>}
    {page && <div className="yard-setting-group">{page.items.map(item => <div className="yard-setting-row" key={item.id}>
      <div className="yard-setting-copy"><div className="yard-setting-label">{item.name}</div><div className="yard-setting-description">{item.detail}</div></div>
      <span className="yard-muted">{item.status}</span>
    </div>)}</div>}
    {page?.nextCursor && <button type="button" disabled={loading} onClick={() => { void load(page.nextCursor, scope); }}>Load more</button>}
    <p className="yard-muted">{management[kind]}</p>
  </>;
}
