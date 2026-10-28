import { useEffect, useId, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, CircleAlert, Clock3, LoaderCircle, MessageSquarePlus,
  PanelLeftClose, Plus, Settings } from 'lucide-react';
import { projectForThread, projectsForHost } from '../app/projects.ts';
import type { Project, ProjectState } from '../app/projects.ts';
import type { ThreadListError, ThreadListRow } from './use-thread-list.ts';
import './standalone-sidebar.css';

export interface StandaloneSidebarProps {
  hostId: string;
  currentThread: { hostId: string; threadId: string } | null;
  projectState: ProjectState | null;
  fallbackWorkspace?: string;
  rows: readonly ThreadListRow[];
  nextCursor: string | null;
  loading: boolean;
  error: ThreadListError | null;
  search: string;
  archived: boolean;
  onSearchChange(value: string): void;
  onArchivedChange(value: boolean): void;
  onOpenThread(row: ThreadListRow): void;
  onNewChat(project: Project | null, fallback?: boolean): void;
  onAddProject(): void;
  onOpenSettings(): void;
  onClose(): void;
  onRefresh(): void;
  onLoadMore(): void;
  onRetryProjectLookup?(): void;
}

function threadTitle(row: ThreadListRow): string {
  return row.name || row.preview || 'New conversation';
}

function useExpansion(query: string): [boolean, () => void] {
  const [expanded, setExpanded] = useState(true);
  const [searchExpanded, setSearchExpanded] = useState(true);
  useEffect(() => { setSearchExpanded(true); }, [query]);
  return query ? [searchExpanded, () => setSearchExpanded(value => !value)] : [expanded, () => setExpanded(value => !value)];
}

function ThreadRow({ row, currentThread, onOpenThread }: {
  row: ThreadListRow;
  currentThread: StandaloneSidebarProps['currentThread'];
  onOpenThread: StandaloneSidebarProps['onOpenThread'];
}) {
  const status = row.status;
  const label = status?.type === 'active'
    ? status.activeFlags?.includes('waitingOnApproval') ? 'Waiting for approval'
      : status.activeFlags?.includes('waitingOnUserInput') ? 'Waiting for input' : 'In progress'
    : status?.type === 'systemError' ? 'System error' : null;
  return <button type="button" className="yard-owned-sidebar-thread" title={threadTitle(row)}
    aria-current={currentThread?.hostId === row.hostId && currentThread.threadId === row.id ? 'page' : undefined}
    onClick={() => onOpenThread(row)}>
    <span className="yard-owned-sidebar-thread-title">{threadTitle(row)}</span>
    {label && <span className="yard-owned-sidebar-thread-status" role="img" aria-label={label} title={label}>
      {status?.type === 'systemError' ? <CircleAlert /> : label === 'In progress' ? <LoaderCircle /> : <Clock3 />}
    </span>}
  </button>;
}

function ProjectGroup({ project, fallback, rows, query, currentThread, onOpenThread, onNewChat }: {
  project: Project;
  fallback: boolean;
  rows: readonly ThreadListRow[];
  query: string;
  currentThread: StandaloneSidebarProps['currentThread'];
  onOpenThread: StandaloneSidebarProps['onOpenThread'];
  onNewChat: StandaloneSidebarProps['onNewChat'];
}) {
  const [expanded, toggle] = useExpansion(query);
  const id = useId();
  return <section className="yard-owned-sidebar-project">
    <div className="yard-owned-sidebar-project-heading">
      <button type="button" className="yard-owned-sidebar-project-toggle" aria-expanded={expanded} aria-controls={id}
        onClick={toggle} title={project.name}>
        {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span>{project.name}</span>
      </button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={'New chat in ' + project.name}
        title={'New chat in ' + project.name} onClick={() => onNewChat(project, fallback)}><Plus aria-hidden="true" /></button>
    </div>
    <div id={id} hidden={!expanded}>
      {rows.map(row => <ThreadRow key={row.id} row={row} currentThread={currentThread} onOpenThread={onOpenThread} />)}
    </div>
  </section>;
}

/** Navigation and collapse state only; project and thread state belong to the caller. */
export function StandaloneSidebar({ hostId, currentThread, projectState, fallbackWorkspace, rows, nextCursor, loading, error,
  search, archived, onSearchChange, onArchivedChange, onOpenThread, onNewChat, onAddProject, onOpenSettings, onClose,
  onRefresh, onLoadMore, onRetryProjectLookup }: StandaloneSidebarProps) {
  const query = search.trim().toLowerCase();
  const [projectsExpanded, toggleProjects] = useExpansion(query);
  const projectsId = useId();
  const { projects, grouped, recent, fallback } = useMemo(() => {
    const assigned = projectState ? projectsForHost(projectState, hostId) : [];
    const projects: Project[] = assigned.length ? assigned : hostId === 'local' && fallbackWorkspace
      ? [{ id: fallbackWorkspace, name: fallbackWorkspace.split(/[\\/]/).filter(Boolean).at(-1) || 'Workspace',
        rootPaths: [fallbackWorkspace], hostId }] : [];
    const grouped = new Map(projects.map(project => [project.id, [] as ThreadListRow[]]));
    const recent: ThreadListRow[] = [];
    for (const row of rows) {
      if (row.hostId !== hostId) continue;
      const project = projectForThread(projectState, projects, hostId, row);
      const group = project && grouped.get(project.id);
      if (group) group.push(row); else recent.push(row);
    }
    return { projects, grouped, recent, fallback: assigned.length === 0 };
  }, [projectState, hostId, fallbackWorkspace, rows]);
  const unresolved = projectState && (!projectState.inventory.complete || Object.keys(projectState.unresolved.assignments).length > 0
    || projectState.unresolved.projectless.length > 0 || projectState.unresolved.qualified.length > 0);
  const count = grouped.size ? [...grouped.values()].reduce((total, group) => total + group.length, recent.length) : recent.length;

  return <aside id="app-shell-sidebar" className="yard-owned-sidebar" aria-label="Sidebar">
    <div className="yard-owned-sidebar-brand"><img src="/brand/icon.svg" alt="" /><span>Codex Yard</span>
      <button type="button" className="yard-owned-sidebar-icon" aria-label="Close sidebar" title="Close sidebar" onClick={onClose}>
        <PanelLeftClose aria-hidden="true" />
      </button>
    </div>
    <button type="button" className="yard-owned-sidebar-command" onClick={() => onNewChat(null)}>
      <MessageSquarePlus aria-hidden="true" />New chat
    </button>
    <input type="search" aria-label="Search conversations" placeholder="Search" value={search}
      onChange={event => onSearchChange(event.currentTarget.value)} />
    <div className="yard-owned-sidebar-heading">
      <button type="button" className="yard-owned-sidebar-section-toggle" aria-expanded={projectsExpanded} aria-controls={projectsId}
        onClick={toggleProjects}>
        {projectsExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}Projects
      </button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label="Add project" title="Add project" onClick={onAddProject}>
        <Plus aria-hidden="true" />
      </button>
    </div>
    <div className="yard-owned-sidebar-scroll">
      <div id={projectsId} hidden={!projectsExpanded}>
        {projects.map(project => <ProjectGroup key={JSON.stringify([project.hostId, project.id])} project={project} fallback={fallback} query={query}
          rows={grouped.get(project.id) ?? []} currentThread={currentThread} onOpenThread={onOpenThread} onNewChat={onNewChat} />)}
      </div>
      <div className="yard-owned-sidebar-heading yard-owned-sidebar-recents">{archived ? 'Archived' : 'Recents'}</div>
      {unresolved && <p className="yard-owned-sidebar-message" role="status">部分旧项目归属尚无法确定，原记录已保留。
        {onRetryProjectLookup && <button type="button" onClick={onRetryProjectLookup}>Retry project lookup</button>}
      </p>}
      {recent.map(row => <ThreadRow key={row.id} row={row} currentThread={currentThread} onOpenThread={onOpenThread} />)}
      {loading && <p className="yard-owned-sidebar-message" role="status">{search.trim() ? 'Searching conversations...' : 'Loading conversations...'}</p>}
      {error && <div className="yard-owned-sidebar-error" role="alert"><span>{error.message}</span>
        <button type="button" onClick={error.retry === 'loadMore' ? onLoadMore : onRefresh}>Retry</button>
      </div>}
      {!search.trim() && nextCursor && !error && <button type="button" className="yard-owned-sidebar-command" disabled={loading}
        onClick={onLoadMore}>Load more</button>}
      {!loading && !error && !nextCursor && !count && <p className="yard-owned-sidebar-message">
        {search.trim() ? 'No matching conversations' : 'No conversations yet'}
      </p>}
    </div>
    <footer className="yard-owned-sidebar-footer">
      <button type="button" className="yard-owned-sidebar-command" onClick={() => onArchivedChange(!archived)}>
        {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
        {archived ? 'Show recent chats' : 'Archived chats'}
      </button>
      <button type="button" className="yard-owned-sidebar-command" onClick={onOpenSettings}><Settings aria-hidden="true" />Settings</button>
    </footer>
  </aside>;
}
