import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, ChevronDown, CircleAlert, Clock3, Folder,
  LoaderCircle, MoreHorizontal, PanelLeftClose, Pin, Plug, Plus, Search, Settings, SquarePen, X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { projectForThread, projectsForHost } from '../app/projects.ts';
import type { Project, ProjectState } from '../app/projects.ts';
import { useI18n } from '../i18n/index.tsx';
import type { ThreadListError, ThreadListRow } from './use-thread-list.ts';
import './standalone-sidebar.css';

export type SidebarThreadAction = 'rename' | 'archive' | 'restore' | 'pin' | 'unpin' | 'move' | 'fork' | 'copy';

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
  shortcutHints?: ReadonlyMap<string, string>;
  onNavigateHistory?(direction: -1 | 1): void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onOpenPlugins?(): void;
  accountLabel?: string;
  onOpenProductModeMenu?(anchor: HTMLButtonElement): void;
  activeProjectId?: string | null;
  onProjectOptions?(project: Project, anchor: HTMLButtonElement): void;
  onThreadAction?(row: ThreadListRow, action: SidebarThreadAction): void;
  availableThreadActions?(row: ThreadListRow): readonly SidebarThreadAction[];
  isThreadPinned?(row: ThreadListRow): boolean;
}

interface MenuItem { label: string; icon?: ReactNode; run(): void }

function SidebarMenu({ label, items, children, className = '', contextTarget }: {
  label: string; items: readonly MenuItem[]; children: ReactNode; className?: string;
  contextTarget?: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const target = contextTarget?.current;
    if (!target) return;
    const show = (event: MouseEvent) => {
      event.preventDefault();
      const height = items.length * 34 + 12;
      setPosition({ left: Math.max(8, Math.min(event.clientX, innerWidth - 224)),
        top: Math.max(8, Math.min(event.clientY, innerHeight - height - 8)) });
      setOpen(true);
    };
    target.addEventListener('contextmenu', show);
    return () => target.removeEventListener('contextmenu', show);
  }, [contextTarget, items.length]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const pointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault(); setOpen(false); trigger.current?.focus();
      }
    };
    const close = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height = items.length * 34 + 12;
    setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - 224)),
      top: Math.max(8, Math.min(rect.bottom + 4, innerHeight - height - 8)) });
    setOpen(true);
  };
  return <>
    <button ref={trigger} type="button" className={className} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>{children}</button>
    {open && createPortal(<div ref={menu} id={id} className="yard-owned-sidebar-menu" role="menu" style={position}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
        if (!buttons.length) return;
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current + buttons.length - 1) % buttons.length;
        buttons[next]?.focus();
      }}>
      {items.map((item, index) => <button key={index} type="button" role="menuitem" onClick={() => { setOpen(false); item.run(); }}>
        {item.icon}{item.label}
      </button>)}
    </div>, document.body)}
  </>;
}

function useExpansion(query: string): [boolean, () => void] {
  const [expanded, setExpanded] = useState(true);
  const [searchExpanded, setSearchExpanded] = useState(true);
  useEffect(() => { setSearchExpanded(true); }, [query]);
  return query ? [searchExpanded, () => setSearchExpanded(value => !value)] : [expanded, () => setExpanded(value => !value)];
}

type StatusKey = 'Waiting for approval' | 'Waiting for input' | 'In progress' | 'System error';
function threadStatus(row: ThreadListRow): StatusKey | null {
  const status = row.status;
  return status?.type === 'active'
    ? status.activeFlags?.includes('waitingOnApproval') ? 'Waiting for approval'
      : status.activeFlags?.includes('waitingOnUserInput') ? 'Waiting for input' : 'In progress'
    : status?.type === 'systemError' ? 'System error' : null;
}
function StatusIndicator({ status }: { status: StatusKey }) {
  const { t } = useI18n();
  const label = t(status);
  return <span className="yard-owned-sidebar-thread-status" role="img" aria-label={label} title={label}>
    {status === 'System error' ? <CircleAlert aria-hidden="true" /> : status === 'In progress' ? <LoaderCircle aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
  </span>;
}

function ThreadRow({ row, currentThread, onOpenThread, shortcutHints, availableThreadActions, onThreadAction, isThreadPinned }: {
  row: ThreadListRow;
  currentThread: StandaloneSidebarProps['currentThread'];
  onOpenThread: StandaloneSidebarProps['onOpenThread'];
  shortcutHints?: StandaloneSidebarProps['shortcutHints'];
  availableThreadActions?: StandaloneSidebarProps['availableThreadActions'];
  onThreadAction?: StandaloneSidebarProps['onThreadAction'];
  isThreadPinned?: StandaloneSidebarProps['isThreadPinned'];
}) {
  const { t, formatDate } = useI18n();
  const statusKey = threadStatus(row);
  const title = row.name || row.preview || t('New conversation');
  const updated = typeof row.updatedAt === 'number' ? new Date(row.updatedAt * 1000) : null;
  const tooltip = updated && Number.isFinite(updated.getTime())
    ? `${title}\n${formatDate(updated, { dateStyle: 'medium', timeStyle: 'short' })}` : title;
  const shortcutKey = JSON.stringify([row.hostId, row.id]);
  const actions = onThreadAction ? (availableThreadActions?.(row) ?? [])
    .filter(action => isThreadPinned || (action !== 'pin' && action !== 'unpin')) : [];
  const labels: Record<SidebarThreadAction, string> = { rename: t('Rename'), archive: t('Archive'), restore: t('Restore conversation'),
    pin: 'Pin', unpin: 'Unpin', move: 'Move to project', fork: t('Fork'), copy: t('Copy conversation link') };
  const pin = isThreadPinned?.(row) ? 'unpin' : 'pin';
  const archive = row.archived ? 'restore' : 'archive';
  const rowElement = useRef<HTMLDivElement>(null);
  return <div ref={rowElement} className="yard-owned-sidebar-thread yard-owned-sidebar-thread-line">
  <button type="button" className="yard-owned-sidebar-thread-button" title={tooltip} data-sidebar-thread={shortcutKey}
    aria-current={currentThread?.hostId === row.hostId && currentThread.threadId === row.id ? 'page' : undefined}
    onClick={() => onOpenThread(row)}>
    <span className="yard-owned-sidebar-thread-title">{title}</span>
    {shortcutHints?.get(shortcutKey) && <kbd>{shortcutHints.get(shortcutKey)}</kbd>}
    {statusKey && <StatusIndicator status={statusKey} />}
  </button>
  {actions.includes(pin) && <button type="button" className="yard-owned-sidebar-row-action" aria-label={labels[pin] + ' ' + title}
    title={labels[pin]} onClick={() => onThreadAction?.(row, pin)}><Pin aria-hidden="true" /></button>}
  {actions.includes(archive) && <button type="button" className="yard-owned-sidebar-row-action" aria-label={labels[archive] + ' ' + title}
    title={labels[archive]} onClick={() => onThreadAction?.(row, archive)}>
    {row.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}</button>}
  {actions.length > 0 && <SidebarMenu className="yard-owned-sidebar-row-action" label={`${t('Conversation menu')}: ${title}`} contextTarget={rowElement}
    items={actions.map(action => ({ label: labels[action], run: () => onThreadAction?.(row, action) }))}>
    <MoreHorizontal aria-hidden="true" />
  </SidebarMenu>}
  </div>;
}

function ProjectGroup({ project, fallback, rows, query, currentThread, onOpenThread, onNewChat, shortcutHints,
  activeProjectId, onProjectOptions, availableThreadActions, onThreadAction, isThreadPinned }: {
  project: Project;
  fallback: boolean;
  rows: readonly ThreadListRow[];
  query: string;
  currentThread: StandaloneSidebarProps['currentThread'];
  onOpenThread: StandaloneSidebarProps['onOpenThread'];
  onNewChat: StandaloneSidebarProps['onNewChat'];
  shortcutHints?: StandaloneSidebarProps['shortcutHints'];
  activeProjectId?: StandaloneSidebarProps['activeProjectId'];
  onProjectOptions?: StandaloneSidebarProps['onProjectOptions'];
  availableThreadActions?: StandaloneSidebarProps['availableThreadActions'];
  onThreadAction?: StandaloneSidebarProps['onThreadAction'];
  isThreadPinned?: StandaloneSidebarProps['isThreadPinned'];
}) {
  const { t } = useI18n();
  const [expanded, toggle] = useExpansion(query);
  const id = useId();
  const newChatLabel = `${t('New chat in')} ${project.name}`;
  const statuses = expanded ? [] : rows.map(threadStatus);
  const projectStatus = (['Waiting for approval', 'Waiting for input', 'System error', 'In progress'] as const)
    .find(status => statuses.includes(status));
  return <section className="yard-owned-sidebar-project">
    <div className="yard-owned-sidebar-project-heading" data-active={activeProjectId === project.id}>
      <button type="button" className="yard-owned-sidebar-project-toggle" aria-expanded={expanded} aria-controls={id}
        onClick={toggle} title={project.name}>
        <Folder aria-hidden="true" />
        <span>{project.name}</span>
      </button>
      {projectStatus && <StatusIndicator status={projectStatus} />}
      {onProjectOptions && !fallback && <button type="button" className="yard-owned-sidebar-icon yard-owned-sidebar-project-action"
        aria-label={`${t('Projects')}: ${project.name}`} title={project.name} onClick={event => onProjectOptions(project, event.currentTarget)}><MoreHorizontal aria-hidden="true" /></button>}
      <button type="button" className="yard-owned-sidebar-icon" aria-label={newChatLabel}
        title={newChatLabel} onClick={() => onNewChat(project, fallback)}><SquarePen aria-hidden="true" /></button>
    </div>
    <div id={id} hidden={!expanded}>
      {rows.map(row => <ThreadRow key={row.id} row={row} currentThread={currentThread} onOpenThread={onOpenThread} shortcutHints={shortcutHints}
        availableThreadActions={availableThreadActions} onThreadAction={onThreadAction} isThreadPinned={isThreadPinned} />)}
    </div>
  </section>;
}

/** Navigation and collapse state only; project and thread state belong to the caller. */
export function StandaloneSidebar({ hostId, currentThread, projectState, fallbackWorkspace, rows, nextCursor, loading, error,
  search, archived, onSearchChange, onArchivedChange, onOpenThread, onNewChat, onAddProject, onOpenSettings, onClose,
  onRefresh, onLoadMore, onRetryProjectLookup, shortcutHints, onNavigateHistory, canNavigateBack, canNavigateForward,
  onOpenPlugins, accountLabel, onOpenProductModeMenu, activeProjectId, onProjectOptions, availableThreadActions,
  onThreadAction, isThreadPinned }: StandaloneSidebarProps) {
  const { t } = useI18n();
  const query = search.trim().toLowerCase();
  const [projectsExpanded, toggleProjects] = useExpansion(query);
  const [searchOpen, setSearchOpen] = useState(!!search);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (search) setSearchOpen(true); }, [search]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
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
      if (group) group.push(row);
      recent.push(row);
    }
    return { projects, grouped, recent, fallback: assigned.length === 0 };
  }, [projectState, hostId, fallbackWorkspace, rows, t]);
  const unresolved = projectState && (!projectState.inventory.complete || Object.keys(projectState.unresolved.assignments).length > 0
    || projectState.unresolved.projectless.length > 0 || projectState.unresolved.qualified.length > 0);
  const count = recent.length;

  return <aside id="app-shell-sidebar" className="yard-owned-sidebar" aria-label={t('Sidebar')}>
    <div className="yard-owned-sidebar-navigation">
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Back')} title={t('Back')}
        disabled={!onNavigateHistory || canNavigateBack === false} onClick={() => onNavigateHistory?.(-1)}><ArrowLeft aria-hidden="true" /></button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label="Forward" title="Forward"
        disabled={!onNavigateHistory || canNavigateForward === false} onClick={() => onNavigateHistory?.(1)}><ArrowRight aria-hidden="true" /></button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Close sidebar')} title={t('Close sidebar')} onClick={onClose}>
        <PanelLeftClose aria-hidden="true" />
      </button>
    </div>
    <div className="yard-owned-sidebar-brand">
      <button type="button" className="yard-owned-sidebar-brand-button" aria-label="Switch mode, current mode: Codex"
        disabled={!onOpenProductModeMenu} onClick={event => onOpenProductModeMenu?.(event.currentTarget)}>
        <img src="/brand/icon.svg" alt="" /><strong>Codex Yard</strong><ChevronDown aria-hidden="true" />
      </button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Search conversations')} title={t('Search conversations')}
        aria-expanded={searchOpen} onClick={() => { if (searchOpen) onSearchChange(''); setSearchOpen(value => !value); }}><Search aria-hidden="true" /></button>
    </div>
    {searchOpen && <div className="yard-owned-sidebar-search">
      <input ref={searchInput} type="search" aria-label={t('Search conversations')} placeholder={t('Search')} value={search}
        onChange={event => onSearchChange(event.currentTarget.value)} onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onSearchChange(''); setSearchOpen(false); }
        }} />
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Close')} title={t('Close')}
        onClick={() => { onSearchChange(''); setSearchOpen(false); }}><X aria-hidden="true" /></button>
    </div>}
    <button type="button" className="yard-owned-sidebar-command" onClick={() => onNewChat(null)}>
      <SquarePen aria-hidden="true" />{t('New chat')}
    </button>
    <button type="button" className="yard-owned-sidebar-command" disabled={!onOpenPlugins} onClick={onOpenPlugins}>
      <Plug aria-hidden="true" />{t('Plugins')}
    </button>
    <div className="yard-owned-sidebar-scroll">
    <div className="yard-owned-sidebar-heading yard-owned-sidebar-projects-heading">
      <button type="button" className="yard-owned-sidebar-section-toggle" aria-expanded={projectsExpanded} aria-controls={projectsId}
        onClick={toggleProjects}>{t('Projects')}<ChevronDown aria-hidden="true" /></button>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Add project')} title={t('Add project')} onClick={onAddProject}>
        <Plus aria-hidden="true" />
      </button>
    </div>
      <div id={projectsId} hidden={!projectsExpanded}>
        {projects.map(project => <ProjectGroup key={JSON.stringify([project.hostId, project.id])} project={project} fallback={fallback} query={query}
          rows={grouped.get(project.id) ?? []} currentThread={currentThread} onOpenThread={onOpenThread} onNewChat={onNewChat} shortcutHints={shortcutHints}
          activeProjectId={activeProjectId} onProjectOptions={onProjectOptions} availableThreadActions={availableThreadActions}
          onThreadAction={onThreadAction} isThreadPinned={isThreadPinned} />)}
      </div>
      <div className="yard-owned-sidebar-heading yard-owned-sidebar-recents">{t(archived ? 'Archived' : 'Recents')}</div>
      {unresolved && <p className="yard-owned-sidebar-message" role="status">{t('Some legacy project associations are unresolved. Original records are retained.')}
        {onRetryProjectLookup && <button type="button" onClick={onRetryProjectLookup}>{t('Retry project lookup')}</button>}
      </p>}
      {recent.map(row => <ThreadRow key={row.id} row={row} currentThread={currentThread} onOpenThread={onOpenThread} shortcutHints={shortcutHints}
        availableThreadActions={availableThreadActions} onThreadAction={onThreadAction} isThreadPinned={isThreadPinned} />)}
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
      <SidebarMenu className="yard-owned-sidebar-account" label={t('Account')} items={[
        { label: t('Settings'), icon: <Settings aria-hidden="true" />, run: onOpenSettings },
        { label: t(archived ? 'Show recent chats' : 'Archived chats'), icon: archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />,
          run: () => onArchivedChange(!archived) },
      ]}><Settings aria-hidden="true" /><span>{accountLabel || t('Account')}</span></SidebarMenu>
    </footer>
  </aside>;
}
