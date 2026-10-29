import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, Plus, Search } from 'lucide-react';
import { workspaceAgentPage } from './catalog.ts';
import type { AgentView, LoadWorkspaceAgents, WorkspaceAgent, WorkspaceAgentDetail, WorkspaceAgentPage, WorkspaceIdentity } from './catalog.ts';
import { AgentDiscoveryDialog } from './AgentDiscoveryDialog.tsx';
import './agents.css';

export interface WorkspaceAgentsPageProps {
  hostId: string;
  identity: WorkspaceIdentity | null;
  sessionKey?: string | number;
  enabled: boolean;
  workspaceName?: string | null;
  canBuild: boolean;
  onLoadAgents?: (request: LoadWorkspaceAgents) => Promise<WorkspaceAgentPage>;
  onOpenAgent?: (value: { hostId: string; identity: WorkspaceIdentity; agent: WorkspaceAgent; view: AgentView }) => void | Promise<void>;
  onLoadAgentDetail?: (value: { hostId: string; identity: WorkspaceIdentity; agentId: string; signal: AbortSignal }) => Promise<WorkspaceAgentDetail>;
  onSetAgentPinned?: (value: { hostId: string; identity: WorkspaceIdentity; agent: WorkspaceAgent; pinned: true }) => Promise<void>;
  renderAgentAppsSetup?: (value: { hostId: string; identity: WorkspaceIdentity; agentId: string; onBack(): void }) => ReactNode;
  onEditAgent?: (value: { hostId: string; identity: WorkspaceIdentity; agent: WorkspaceAgent }) => void | Promise<void>;
  onCreateAgent?: (value: { hostId: string; identity: WorkspaceIdentity }) => void | Promise<void>;
  renderAgentIcon?: (agent: WorkspaceAgent) => ReactNode;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function WorkspaceAgentsPage(props: WorkspaceAgentsPageProps) {
  const key = JSON.stringify([props.hostId, props.identity?.accountId, props.identity?.userId, props.sessionKey, props.enabled]);
  return <AgentsScope key={key} {...props} />;
}

function AgentsScope({ hostId, identity, enabled, workspaceName, canBuild, onLoadAgents, onOpenAgent, onLoadAgentDetail, onSetAgentPinned, renderAgentAppsSetup, onEditAgent, onCreateAgent, renderAgentIcon }: WorkspaceAgentsPageProps) {
  const [view, setView] = useState<AgentView>('recent');
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<WorkspaceAgent | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const query = search.trim().slice(0, 200);
  const activeView = query ? 'directory' : view;
  const usableIdentity = identity && identity.accountId && identity.userId ? identity : null;
  const invoke = async (action: () => void | Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError(null);
    try { await action(); }
    catch (cause) { if (alive.current) setActionError(message(cause)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const open = (agent: WorkspaceAgent) => {
    if (!usableIdentity) return;
    if (activeView === 'directory' && onLoadAgentDetail) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSelected(agent);
    } else if (activeView === 'owned' && !agent.published) {
      if (onEditAgent) void invoke(() => onEditAgent({ hostId, identity: usableIdentity, agent }));
    } else if (onOpenAgent) void invoke(() => onOpenAgent({ hostId, identity: usableIdentity, agent, view: activeView }));
  };
  return <main className="yard-agents">
    <header className="yard-agents-header">
      <div className="yard-agents-title"><h1>Workspace Agents</h1>
        <button type="button" className="yard-agents-create" disabled={!enabled || !usableIdentity || !canBuild || !onCreateAgent || busy}
          title={!canBuild ? 'You do not have permission to build agents' : undefined}
          onClick={() => { if (usableIdentity && onCreateAgent) void invoke(() => onCreateAgent({ hostId, identity: usableIdentity })); }}>
          <Plus size={16} aria-hidden="true" /> Create agent
        </button></div>
      <label className="yard-agents-search"><Search size={17} aria-hidden="true" />
        <input type="search" aria-label="Search agents" placeholder="Search agents" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <nav className="yard-agents-tabs" aria-label="Agent views">
        {(['recent', 'owned', 'directory'] as const).map(item => <button type="button" key={item} aria-current={view === item ? 'page' : undefined}
          onClick={() => setView(item)}>{item === 'recent' ? 'Recently used' : item === 'owned' ? 'Built by me' : workspaceName?.trim() ? `${workspaceName.trim()} directory` : 'Team directory'}</button>)}
      </nav>
    </header>
    {actionError && <p role="alert" className="yard-agents-error">Could not complete agent action: {actionError}</p>}
    {!enabled || !usableIdentity ? <p className="yard-agents-state">Workspace agents are unavailable for this account.</p> : !onLoadAgents ?
      <p className="yard-agents-state">The workspace agent directory is unavailable on this host.</p> :
      <AgentResults key={JSON.stringify([activeView, query])} hostId={hostId} identity={usableIdentity} view={activeView} query={query} workspaceName={workspaceName}
        loadPage={onLoadAgents} onOpen={open} onEdit={onEditAgent ? agent => void invoke(() => onEditAgent({ hostId, identity: usableIdentity, agent })) : undefined}
        canOpen={agent => !busy && (activeView === 'directory' && onLoadAgentDetail ? true : activeView === 'owned' && !agent.published ? !!onEditAgent : !!onOpenAgent)} busy={busy} renderIcon={renderAgentIcon} />}
    {selected && usableIdentity && onLoadAgentDetail && <AgentDiscoveryDialog hostId={hostId} identity={usableIdentity} agent={selected}
      onLoad={onLoadAgentDetail} onOpen={onOpenAgent} onSetPinned={onSetAgentPinned} renderAppsSetup={renderAgentAppsSetup} renderIcon={renderAgentIcon}
      onClose={() => { if (alive.current) { setSelected(null); previousFocus.current?.focus(); } }} />}
  </main>;
}

interface AgentResultsProps {
  hostId: string;
  identity: WorkspaceIdentity;
  view: AgentView;
  query: string;
  workspaceName?: string | null;
  loadPage: NonNullable<WorkspaceAgentsPageProps['onLoadAgents']>;
  onOpen(agent: WorkspaceAgent): void;
  onEdit?: (agent: WorkspaceAgent) => void;
  canOpen(agent: WorkspaceAgent): boolean;
  busy: boolean;
  renderIcon?: (agent: WorkspaceAgent) => ReactNode;
}

function AgentResults({ hostId, identity, view, query, workspaceName, loadPage, onOpen, onEdit, canOpen, busy, renderIcon }: AgentResultsProps) {
  const [items, setItems] = useState<WorkspaceAgent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const seenCursors = useRef(new Set<string>());
  const load = async (next: string | null) => {
    if (inFlight.current) return;
    const id = ++sequence.current;
    const current = new AbortController(); controller.current = current;
    inFlight.current = true; setLoading(true); setError(null);
    try {
      const page = workspaceAgentPage(await loadPage({ hostId, identity, view, query, cursor: next, limit: 50, signal: current.signal }));
      if (id !== sequence.current) return;
      if (page.nextCursor !== null && (page.nextCursor === next || seenCursors.current.has(page.nextCursor))) throw new Error('Agent pagination did not advance');
      if (next !== null) seenCursors.current.add(next);
      setItems(previous => [...new Map([...(next === null ? [] : previous), ...page.items].map(item => [item.id, item])).values()]);
      setCursor(page.nextCursor); setLoaded(true);
    } catch (cause) { if (id === sequence.current && !current.signal.aborted) setError(message(cause)); }
    finally { if (id === sequence.current) { inFlight.current = false; setLoading(false); } }
  };
  useEffect(() => { void load(null); return () => { sequence.current++; controller.current?.abort(); inFlight.current = false; }; }, []);
  const empty = query ? `No agents found for "${query}"` : view === 'recent' ? 'No recently used agents' : view === 'owned' ? 'You have not built any agents yet' : 'No agents in team directory';
  return <section className="yard-agents-results" aria-label={query ? 'Search results' : 'Agents'}>
    {loading && <p role="status" className="yard-agents-state">{loaded ? 'Loading more agents...' : 'Loading agents...'}</p>}
    {error && <div role="alert" className="yard-agents-error">{query ? 'Could not search agents' : 'Could not load agents'}: {error}
      <button type="button" disabled={loading} onClick={() => void load(loaded ? cursor : null)}>Retry</button></div>}
    {loaded && items.length === 0 && !error && !cursor && <p className="yard-agents-state">{empty}</p>}
    <div className={view === 'directory' ? 'yard-agents-grid' : 'yard-agents-list'}>
      {items.map(agent => <article className="yard-agent" key={agent.id}>
        <button type="button" className="yard-agent-main" disabled={!canOpen(agent)} onClick={() => onOpen(agent)}>
          <span className="yard-agent-icon" aria-hidden="true">{renderIcon ? renderIcon(agent) : <Bot size={22} />}</span>
          <span className="yard-agent-text"><strong>{agent.name.trim() || 'Unnamed agent'}</strong><span>{agentSubtitle(agent, view, workspaceName)}</span></span>
        </button>
        {view === 'owned' && <button type="button" className="yard-agent-edit" disabled={!onEdit || busy} onClick={() => onEdit?.(agent)}>Edit</button>}
      </article>)}
    </div>
    {loaded && cursor && !error && <button type="button" className="yard-agents-more" disabled={loading} onClick={() => void load(cursor)}>Load more</button>}
  </section>;
}

function agentSubtitle(agent: WorkspaceAgent, view: AgentView, workspaceName?: string | null) {
  if (view === 'directory') return `${agent.tagline.trim() || agent.description.trim() || 'No description'} · ${agent.creatorName?.trim() || 'Unknown author'}`;
  if (view === 'recent') {
    if (agent.attentionStatus === 'blocked' || agent.recentRunStatus === 'blocked') return 'Needs your attention';
    const used = agent.lastUsedAt ?? agent.recentRunUpdatedAt;
    return used ? `Used ${formatDate(used)}` : agent.creatorName?.trim() ? `By ${agent.creatorName.trim()}` : 'Recently used';
  }
  const when = agent.updatedAt ? ` · ${formatDate(agent.updatedAt)}` : '';
  if (!agent.published) return `Draft${when}`;
  const visibility = agent.storeVisible ? `Published to ${workspaceName?.trim() || 'your workspace'} directory` : agent.isPublic ? 'Shared with your workspace' : 'Private to you';
  return `${visibility}${when}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString();
}
