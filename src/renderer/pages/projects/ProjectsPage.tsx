import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Folder, MessageSquarePlus, MoreHorizontal, Pin, Plus, RefreshCw, Search, X } from 'lucide-react';
import { chatKey, projectChatPage, projectKey, projectPage } from './catalog.ts';
import type { ProjectChat, ProjectEntry, ProjectPage, ProjectScope } from './catalog.ts';
import './projects.css';

interface PageRequest extends ProjectScope { query: string; cursor: string | null; signal: AbortSignal }
interface ProjectRequest extends ProjectScope { project: ProjectEntry }

export interface ProjectsPageProps extends ProjectScope {
  sessionKey?: string | number;
  hasUnresolvedChanges: boolean;
  onLoadProjects?: (request: PageRequest) => Promise<ProjectPage<ProjectEntry>>;
  onLoadProjectChats?: (request: PageRequest & { project: ProjectEntry }) => Promise<ProjectPage<ProjectChat>>;
  onOpenProject?: (request: ProjectRequest) => void | Promise<void>;
  onOpenChat?: (request: ProjectRequest & { chat: ProjectChat }) => void | Promise<void>;
  onCreateProject?: (scope: ProjectScope) => Promise<boolean>;
  onEditProject?: (request: ProjectRequest) => Promise<boolean>;
  onSetPinned?: (request: ProjectRequest & { pinned: boolean }) => Promise<void>;
  onRemoveProject?: (request: ProjectRequest) => Promise<void>;
  onArchiveProjectChats?: (request: ProjectRequest) => Promise<void>;
  onCreateChat?: (request: ProjectRequest) => void | Promise<void>;
  onReconcileProjectChanges?: (scope: ProjectScope) => Promise<void>;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ProjectsPage(props: ProjectsPageProps) {
  return <ProjectsScope key={JSON.stringify([props.hostId, props.accountKey, props.sessionKey])} {...props} />;
}

function ProjectsScope(props: ProjectsPageProps) {
  const { hostId, accountKey, hasUnresolvedChanges, onLoadProjects, onCreateProject, onReconcileProjectChanges } = props;
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [sort, setSort] = useState<'name' | 'updated'>('updated');
  const [ascending, setAscending] = useState(false);
  const alive = useRef(false), inFlight = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const locked = uncertain || hasUnresolvedChanges;
  const refresh = () => { if (!locked) setError(null); setRevision(value => value + 1); };
  const reconcile = async () => {
    if (!onReconcileProjectChanges || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      await onReconcileProjectChanges({ hostId, accountKey });
      if (alive.current) { setUncertain(false); setError(null); setRevision(value => value + 1); }
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const execute = async (operation: () => Promise<boolean | void>, changesData: boolean) => {
    if (inFlight.current || locked) return false;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const changed = await operation();
      if (!alive.current) return false;
      if (changesData && changed !== false) refresh();
      return true;
    } catch (cause) {
      if (alive.current) { setError(message(cause)); if (changesData) setUncertain(true); }
      return false;
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const changeSort = (next: 'name' | 'updated') => {
    if (next === sort) setAscending(value => !value);
    else { setSort(next); setAscending(next === 'name'); }
  };
  return <main className="yard-projects">
    <div className="yard-projects-content"><header className="yard-projects-header">
      <div className="yard-projects-title"><h1>Projects</h1><div className="yard-projects-actions">
        <button type="button" className="yard-projects-icon" title="Refresh projects" aria-label="Refresh projects" disabled={busy || !onLoadProjects} onClick={refresh}><RefreshCw size={16} /></button>
        <button type="button" className="yard-projects-create" disabled={busy || locked || !onCreateProject} onClick={() => { if (onCreateProject) void execute(() => onCreateProject({ hostId, accountKey }), true); }}><Plus size={16} /> Create</button>
      </div></div>
      <label className="yard-projects-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search projects" placeholder="Search projects" value={search} onChange={event => setSearch(event.target.value)} /></label>
    </header>
    {(error || locked) && <div role="alert" className="yard-projects-error">{error ? `Could not complete project action: ${error}` : 'A project change needs verification.'}{locked && <> Check the result before making another change.
      <button type="button" disabled={busy || !onReconcileProjectChanges} onClick={() => void reconcile()}>Check changes</button></>}</div>}
    {!onLoadProjects ? <p className="yard-projects-state">Projects are unavailable on this host.</p> :
      <ProjectResults key={JSON.stringify([search.trim().slice(0, 200), revision])} {...props} query={search.trim().slice(0, 200)} busy={busy || locked} execute={execute} refresh={refresh}
        sort={sort} ascending={ascending} changeSort={changeSort} />}
    </div>
  </main>;
}

interface ProjectResultsProps extends ProjectsPageProps {
  query: string;
  busy: boolean;
  execute(operation: () => Promise<boolean | void>, changesData: boolean): Promise<boolean>;
  refresh(): void;
  sort: 'name' | 'updated';
  ascending: boolean;
  changeSort(next: 'name' | 'updated'): void;
}

function ProjectResults(props: ProjectResultsProps) {
  const { hostId, accountKey, onLoadProjects, query, refresh, sort, ascending, changeSort } = props;
  const [items, setItems] = useState<ProjectEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ProjectPage<ProjectEntry>['warnings']>([]);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0), inFlight = useRef(false), seen = useRef(new Set<string>()), controller = useRef<AbortController | null>(null), lastAttempt = useRef<string | null>(null);
  const load = async (next: string | null) => {
    if (!onLoadProjects || inFlight.current) return;
    const id = ++sequence.current, current = new AbortController(); controller.current = current; lastAttempt.current = next;
    inFlight.current = true; setLoading(true); setError(null);
    try {
      const page = projectPage(await onLoadProjects({ hostId, accountKey, query, cursor: next, signal: current.signal }));
      if (id !== sequence.current) return;
      if (page.nextCursor !== null && (page.nextCursor === next || seen.current.has(page.nextCursor))) throw new Error('Project pagination did not advance');
      if (next !== null) seen.current.add(next);
      setItems(previous => [...new Map([...(next === null ? [] : previous), ...page.items].map(item => [projectKey(item), item])).values()]);
      setWarnings(previous => next === null ? page.warnings : [...previous, ...page.warnings]);
      setCursor(page.nextCursor); setLoaded(true);
    } catch (cause) { if (id === sequence.current && !current.signal.aborted) setError(message(cause)); }
    finally { if (id === sequence.current) { inFlight.current = false; setLoading(false); } }
  };
  useEffect(() => { void load(null); return () => { sequence.current++; controller.current?.abort(); inFlight.current = false; }; }, []);
  const sorted = [...items].sort((a, b) => {
    const comparison = sort === 'name' ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : (a.updatedAt ?? -Infinity) - (b.updatedAt ?? -Infinity);
    return (ascending ? comparison : -comparison) || a.name.localeCompare(b.name) || projectKey(a).localeCompare(projectKey(b));
  });
  return <section aria-label="Projects list">
    <div className="yard-projects-columns"><button type="button" onClick={() => changeSort('name')}>Name {sort === 'name' && (ascending ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</button>
      <button type="button" onClick={() => changeSort('updated')}>Updated {sort === 'updated' && (ascending ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</button></div>
    {loading && <p role="status" className="yard-projects-state">{loaded ? 'Loading more projects...' : 'Loading projects...'}</p>}
    {error && <div role="alert" className="yard-projects-error">Unable to load projects: {error}<button type="button" disabled={loading} onClick={() => void load(lastAttempt.current)}>Retry</button></div>}
    {warnings.map((warning, index) => <p role="alert" className="yard-projects-error" key={`${warning.source}:${index}`}>{warning.source}: {warning.message} <button type="button" disabled={loading} onClick={refresh}>Retry</button></p>)}
    {loaded && !items.length && !error && !warnings.length && !cursor && <p className="yard-projects-state">{query ? 'No projects found' : 'No projects'}</p>}
    <div>{sorted.map(project => <ProjectRow key={projectKey(project)} {...props} project={project} />)}</div>
    {loaded && cursor && !error && <button type="button" className="yard-projects-more" disabled={loading} onClick={() => void load(cursor)}>Show more</button>}
  </section>;
}

interface ProjectRowProps extends ProjectResultsProps { project: ProjectEntry }
function ProjectRow(props: ProjectRowProps) {
  const { hostId, accountKey, project, query, busy, execute, onOpenProject, onCreateChat, onEditProject, onSetPinned, onRemoveProject, onArchiveProjectChats } = props;
  const [expanded, setExpanded] = useState(!!query);
  const [confirm, setConfirm] = useState<'remove' | 'archive' | null>(null);
  const scope = { hostId, accountKey, project };
  const menu = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  return <div className="yard-project-row"><div className="yard-project-line">
    <button type="button" className="yard-projects-icon" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
    <Folder size={17} aria-hidden="true" className="yard-project-folder" />
    <button type="button" className="yard-project-name" disabled={!onOpenProject || busy} onClick={() => { if (onOpenProject) void execute(async () => onOpenProject(scope), false); }}><strong>{project.name || 'Untitled project'}</strong>{project.location && <span>{project.location}</span>}</button>
    <span className="yard-project-updated">{project.updatedAt === null ? '-' : new Date(project.updatedAt).toLocaleDateString()}</span>
    <button type="button" className="yard-projects-icon" title={project.pinned ? 'Unpin project' : 'Pin project'} aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`} disabled={!onSetPinned || project.pinned === null || busy}
      onClick={() => { if (onSetPinned && project.pinned !== null) void execute(() => onSetPinned({ ...scope, pinned: !project.pinned }), true); }}><Pin size={16} fill={project.pinned ? 'currentColor' : 'none'} /></button>
    <button type="button" className="yard-projects-icon" title="Start new chat in project" aria-label={`Start new chat in ${project.name}`} disabled={!onCreateChat || !project.canCreateChat || busy}
      onClick={() => { if (onCreateChat) void execute(async () => onCreateChat(scope), false); }}><MessageSquarePlus size={16} /></button>
    <details className="yard-project-menu" ref={menu} onKeyDown={event => { if (event.key === 'Escape') { closeMenu(); menu.current?.querySelector('summary')?.focus(); } }}>
      <summary aria-label={`Actions for ${project.name}`} title="Project actions"><MoreHorizontal size={18} /></summary>
      <div><button type="button" disabled={!onEditProject || !project.canEdit || busy} onClick={() => { closeMenu(); if (onEditProject) void execute(() => onEditProject(scope), true); }}>Edit project</button>
        <button type="button" disabled={!onArchiveProjectChats || !project.canArchive || busy} onClick={() => { closeMenu(); setConfirm('archive'); }}>Archive chats</button>
        <button type="button" disabled={!onRemoveProject || !project.canRemove || busy} onClick={() => { closeMenu(); setConfirm('remove'); }}>{project.kind === 'cloud' ? 'Delete project' : 'Remove project'}</button></div>
    </details>
  </div>
    {expanded && <ProjectChats {...props} />}
    {confirm && <ProjectConfirm project={project} action={confirm} busy={busy} onClose={() => { setConfirm(null); menu.current?.querySelector('summary')?.focus(); }} onConfirm={async () => {
      const operation = confirm === 'remove' ? onRemoveProject : onArchiveProjectChats;
      if (operation) { await execute(() => operation(scope), true); setConfirm(null); menu.current?.querySelector('summary')?.focus(); }
    }} />}
  </div>;
}

function ProjectChats({ hostId, accountKey, project, query, onLoadProjectChats, onOpenChat, busy, execute }: ProjectRowProps) {
  const [items, setItems] = useState<ProjectChat[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ProjectPage<ProjectChat>['warnings']>([]);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const sequence = useRef(0), inFlight = useRef(false), seen = useRef(new Set<string>()), controller = useRef<AbortController | null>(null), lastAttempt = useRef<string | null>(null);
  const load = async (next: string | null) => {
    if (!onLoadProjectChats || inFlight.current) return;
    const id = ++sequence.current, current = new AbortController(); controller.current = current; lastAttempt.current = next;
    inFlight.current = true; setLoading(true); setError(null);
    try {
      const page = projectChatPage(await onLoadProjectChats({ hostId, accountKey, project, query, cursor: next, signal: current.signal }));
      if (id !== sequence.current) return;
      if (page.nextCursor !== null && (page.nextCursor === next || seen.current.has(page.nextCursor))) throw new Error('Chat pagination did not advance');
      if (next !== null) seen.current.add(next);
      setItems(previous => [...new Map([...(next === null ? [] : previous), ...page.items].map(item => [chatKey(item), item])).values()]);
      setWarnings(previous => next === null ? page.warnings : [...previous, ...page.warnings]); setCursor(page.nextCursor); setLoaded(true);
    } catch (cause) { if (id === sequence.current && !current.signal.aborted) setError(message(cause)); }
    finally { if (id === sequence.current) { inFlight.current = false; setLoading(false); } }
  };
  useEffect(() => { void load(null); return () => { sequence.current++; controller.current?.abort(); inFlight.current = false; }; }, []);
  return <section className="yard-project-chats" aria-label={`Chats in ${project.name}`}>
    {!onLoadProjectChats && <p className="yard-projects-state">Project chats are unavailable.</p>}
    {loading && <p role="status" className="yard-projects-state">Loading chats...</p>}
    {error && <p role="alert" className="yard-projects-error">Could not load chats: {error} <button type="button" disabled={loading} onClick={() => void load(lastAttempt.current)}>Retry</button></p>}
    {warnings.map((warning, index) => <p role="alert" className="yard-projects-error" key={`${warning.source}:${index}`}>{warning.source}: {warning.message} <button type="button" disabled={loading} onClick={() => { seen.current.clear(); void load(null); }}>Retry</button></p>)}
    {loaded && !items.length && !error && !warnings.length && !cursor && <p className="yard-projects-state">No chats</p>}
    {items.map(chat => <button type="button" className="yard-project-chat" key={chatKey(chat)} disabled={!onOpenChat || busy} onClick={() => { if (onOpenChat) void execute(async () => onOpenChat({ hostId, accountKey, project, chat }), false); }}>
      <span>{chat.title || 'New chat'}</span><span>{chat.updatedAt === null ? '' : new Date(chat.updatedAt).toLocaleDateString()}</span></button>)}
    {loaded && cursor && !error && <button type="button" className="yard-projects-more" disabled={loading} onClick={() => void load(cursor)}>Show more chats</button>}
  </section>;
}

function ProjectConfirm({ project, action, busy, onClose, onConfirm }: { project: ProjectEntry; action: 'remove' | 'archive'; busy: boolean; onClose(): void; onConfirm(): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  return <dialog className="yard-project-dialog" ref={dialog} aria-labelledby="yard-project-confirm-title" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="yard-project-dialog-header"><h2 id="yard-project-confirm-title">{action === 'remove' ? project.kind === 'cloud' ? 'Delete project?' : 'Remove project?' : 'Archive project chats?'}</h2>
      <button type="button" className="yard-projects-icon" aria-label="Close" title="Close" disabled={busy} onClick={() => dialog.current?.close()}><X size={18} /></button></div>
    <p>{action === 'archive' ? `Archive chats in ${project.name}?` : project.kind === 'cloud' ? `Permanently delete the ChatGPT project ${project.name}?` : `Remove ${project.name} from the app? Files and chats will remain.`}</p>
    <div className="yard-project-dialog-actions"><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
      <button type="button" disabled={busy} onClick={() => void onConfirm()}>{busy ? 'Saving...' : action === 'remove' ? project.kind === 'cloud' ? 'Delete' : 'Remove' : 'Archive'}</button></div>
  </dialog>;
}
