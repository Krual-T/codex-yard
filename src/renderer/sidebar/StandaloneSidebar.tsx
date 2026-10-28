import { useEffect, useId, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, CircleAlert, Clock3, LoaderCircle, MessageSquarePlus,
  PanelLeftClose, Plus, Settings } from 'lucide-react';
import { projectForThread, projectsForHost } from '../app/projects.ts';
import type { Project, ProjectState } from '../app/projects.ts';
import { useI18n } from '../i18n/index.tsx';
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
  const { t, formatDate } = useI18n();
  const status = row.status;
  const statusKey = status?.type === 'active'
    ? status.activeFlags?.includes('waitingOnApproval') ? 'Waiting for approval'
      : status.activeFlags?.includes('waitingOnUserInput') ? 'Waiting for input' : 'In progress'
    : status?.type === 'systemError' ? 'System error' : null;
  const label = statusKey ? t(statusKey) : null;
  const title = row.name || row.preview || t('New conversation');
  const updated = typeof row.updatedAt === 'number' ? new Date(row.updatedAt * 1000) : null;
  const tooltip = updated && Number.isFinite(updated.getTime())
    ? `${title}\n${formatDate(updated, { dateStyle: 'medium', timeStyle: 'short' })}` : title;
  return <button type="button" className="yard-owned-sidebar-thread" title={tooltip}
    aria-current={currentThread?.hostId === row.hostId && currentThread.threadId === row.id ? 'page' : undefined}
    onClick={() => onOpenThread(row)}>
    <span className="yard-owned-sidebar-thread-title">{title}</span>
    {label && <span className="yard-owned-sidebar-thread-status" role="img" aria-label={label} title={label}>
      {status?.type === 'systemError' ? <CircleAlert /> : statusKey === 'In progress' ? <LoaderCircle /> : <Clock3 />}
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
  const { t } = useI18n();
  const [expanded, toggle] = useExpansion(query);
  const id = useId();
  const newChatLabel = `${t('New chat in')} ${project.name}`;
  return <section className="yard-owned-sidebar-project">
    <div className="yard-owned-sidebar-project-heading">
      <button type="button" className="yard-owned-sidebar-project-toggle" aria-expanded={expanded} aria-controls={id}
        onClick={toggle} title={project.name}>
        {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span>{project.name}</span>
      </button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={newChatLabel}
        title={newChatLabel} onClick={() => onNewChat(project, fallback)}><Plus aria-hidden="true" /></button>
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
  const { t } = useI18n();
  const query = search.trim().toLowerCase();
  const [projectsExpanded, toggleProjects] = useExpansion(query);
  const projectsId = useId();
  const { projects, grouped, recent, fallback } = useMemo(() => {
    const assigned = projectState ? projectsForHost(projectState, hostId) : [];
    const projects: Project[] = assigned.length ? assigned : hostId === 'local' && fallbackWorkspace
      ? [{ id: fallbackWorkspace, name: fallbackWorkspace.split(/[\\/]/).filter(Boolean).at(-1) || t('Workspace'),
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
  }, [projectState, hostId, fallbackWorkspace, rows, t]);
  const unresolved = projectState && (!projectState.inventory.complete || Object.keys(projectState.unresolved.assignments).length > 0
    || projectState.unresolved.projectless.length > 0 || projectState.unresolved.qualified.length > 0);
  const count = grouped.size ? [...grouped.values()].reduce((total, group) => total + group.length, recent.length) : recent.length;

  return <aside id="app-shell-sidebar" className="yard-owned-sidebar" aria-label={t('Sidebar')}>
    <div className="yard-owned-sidebar-brand"><img src="/brand/icon.svg" alt="" /><span>Codex Yard</span>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Close sidebar')} title={t('Close sidebar')} onClick={onClose}>
        <PanelLeftClose aria-hidden="true" />
      </button>
    </div>
    <button type="button" className="yard-owned-sidebar-command" onClick={() => onNewChat(null)}>
      <MessageSquarePlus aria-hidden="true" />{t('New chat')}
    </button>
    <input type="search" aria-label={t('Search conversations')} placeholder={t('Search')} value={search}
      onChange={event => onSearchChange(event.currentTarget.value)} />
    <div className="yard-owned-sidebar-heading">
      <button type="button" className="yard-owned-sidebar-section-toggle" aria-expanded={projectsExpanded} aria-controls={projectsId}
        onClick={toggleProjects}>
        {projectsExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}{t('Projects')}
      </button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Add project')} title={t('Add project')} onClick={onAddProject}>
        <Plus aria-hidden="true" />
      </button>
    </div>
    <div className="yard-owned-sidebar-scroll">
      <div id={projectsId} hidden={!projectsExpanded}>
        {projects.map(project => <ProjectGroup key={JSON.stringify([project.hostId, project.id])} project={project} fallback={fallback} query={query}
          rows={grouped.get(project.id) ?? []} currentThread={currentThread} onOpenThread={onOpenThread} onNewChat={onNewChat} />)}
      </div>
      <div className="yard-owned-sidebar-heading yard-owned-sidebar-recents">{t(archived ? 'Archived' : 'Recents')}</div>
      {unresolved && <p className="yard-owned-sidebar-message" role="status">{t('Some legacy project associations are unresolved. Original records are retained.')}
        {onRetryProjectLookup && <button type="button" onClick={onRetryProjectLookup}>{t('Retry project lookup')}</button>}
      </p>}
      {recent.map(row => <ThreadRow key={row.id} row={row} currentThread={currentThread} onOpenThread={onOpenThread} />)}
      {loading && <p className="yard-owned-sidebar-message" role="status">{t(search.trim() ? 'Searching conversations...' : 'Loading conversations...')}</p>}
      {error && <div className="yard-owned-sidebar-error" role="alert"><span>{error.message}</span>
        <button type="button" onClick={error.retry === 'loadMore' ? onLoadMore : onRefresh}>{t('Retry')}</button>
      </div>}
      {!search.trim() && nextCursor && !error && <button type="button" className="yard-owned-sidebar-command" disabled={loading}
        onClick={onLoadMore}>{t('Load more')}</button>}
      {!loading && !error && !nextCursor && !count && <p className="yard-owned-sidebar-message">
        {t(search.trim() ? 'No matching conversations' : 'No conversations yet')}
      </p>}
    </div>
    <footer className="yard-owned-sidebar-footer">
      <button type="button" className="yard-owned-sidebar-command" onClick={() => onArchivedChange(!archived)}>
        {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
        {t(archived ? 'Show recent chats' : 'Archived chats')}
      </button>
      <button type="button" className="yard-owned-sidebar-command" onClick={onOpenSettings}><Settings aria-hidden="true" />{t('Settings')}</button>
    </footer>
  </aside>;
}
