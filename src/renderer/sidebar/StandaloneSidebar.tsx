import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Archive, ArchiveRestore, ArrowDownUp, ArrowLeft, ArrowRight, BookOpen, ChevronDown, CircleAlert, Clock3, Copy,
  Eye, Folder, FolderOpen, FolderX, GitFork, Keyboard, LifeBuoy, List, LoaderCircle, MoreHorizontal, PanelLeft,
  PanelLeftClose, Pencil, Pin, Plug, Plus, Search, Settings, SquarePen, Trash2, X } from 'lucide-react';
import { projectForThread, projectsForHost } from '../app/projects.ts';
import type { Project, ProjectState } from '../app/projects.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import type { ThreadListError, ThreadListRow } from './use-thread-list.ts';
import { SidebarMenu } from './SidebarMenu.tsx';
import type { SidebarMenuEntry } from './SidebarMenu.tsx';
import './standalone-sidebar.css';

type SidebarMenuItem = Extract<SidebarMenuEntry, { kind: 'item' }>;
export type SidebarThreadAction = 'rename' | 'archive' | 'restore' | 'pin' | 'unpin' | 'move' | 'fork' | 'copy'
  | 'copy-markdown' | 'copy-working-directory' | 'mark-unread' | 'mark-read' | 'delete';
export type SidebarProjectAction = 'pin' | 'unpin' | 'edit' | 'open-in-file-manager' | 'archive-chats' | 'remove';
export type SidebarOptionChange = { type: 'organization'; value: 'by-project' | 'one-list' }
  | { type: 'sort'; value: 'last-updated' | 'manual' } | { type: 'show-projects'; value: boolean };
export interface SidebarOptions {
  organization: 'by-project' | 'one-list';
  sort: 'last-updated' | 'manual';
  projectSort?: 'last-updated' | 'manual';
  showProjects: boolean;
}

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
  onOpenScheduled?(): void;
  onOpenExplore?(): void;
  accountLabel?: string;
  onOpenProductModeMenu?(anchor: HTMLButtonElement): void;
  onSwitchProductMode?(mode: 'chatgpt'): void | Promise<void>;
  activeProjectId?: string | null;
  onProjectOptions?(project: Project, anchor: HTMLButtonElement): void;
  onProjectAction?(project: Project, action: SidebarProjectAction): void | Promise<void>;
  availableProjectActions?(project: Project): readonly SidebarProjectAction[];
  isProjectPinned?(project: Project): boolean;
  onThreadAction?(row: ThreadListRow, action: SidebarThreadAction): void | Promise<void>;
  onMoveThreadToProject?(row: ThreadListRow, project: Project | null): void | Promise<void>;
  availableThreadActions?(row: ThreadListRow): readonly SidebarThreadAction[];
  isThreadPinned?(row: ThreadListRow): boolean;
  isThreadUnread?(row: ThreadListRow): boolean;
  sidebarOptions?: SidebarOptions;
  onSidebarOptionChange?(change: SidebarOptionChange): void | Promise<void>;
  orderThreads?(rows: readonly ThreadListRow[], project: Project | null): readonly ThreadListRow[];
  orderProjects?(projects: readonly Project[]): readonly Project[];
  onHelpAction?(action: 'changelog' | 'shortcuts' | 'guide'): void | Promise<void>;
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

function ThreadRow({ row, currentThread, onOpenThread, shortcutHints, availableThreadActions, onThreadAction, isThreadPinned,
  onMoveThreadToProject, isThreadUnread, projects, projectState, busyThreadActions, dispatchThreadAction }: {
  row: ThreadListRow;
  currentThread: StandaloneSidebarProps['currentThread'];
  onOpenThread: StandaloneSidebarProps['onOpenThread'];
  shortcutHints?: StandaloneSidebarProps['shortcutHints'];
  availableThreadActions?: StandaloneSidebarProps['availableThreadActions'];
  onThreadAction?: StandaloneSidebarProps['onThreadAction'];
  onMoveThreadToProject?: StandaloneSidebarProps['onMoveThreadToProject'];
  isThreadPinned?: StandaloneSidebarProps['isThreadPinned'];
  isThreadUnread?: StandaloneSidebarProps['isThreadUnread'];
  projects: readonly Project[];
  projectState: ProjectState | null;
  busyThreadActions: ReadonlySet<string>;
  dispatchThreadAction: ThreadActionDispatch;
}) {
  const { t, formatDate } = useI18n();
  const [actionError, setActionError] = useState('');
  const statusKey = threadStatus(row);
  const title = row.name || row.preview || t('New conversation');
  const updated = typeof row.updatedAt === 'number' ? new Date(row.updatedAt * 1000) : null;
  const tooltip = updated && Number.isFinite(updated.getTime())
    ? `${title}\n${formatDate(updated, { dateStyle: 'medium', timeStyle: 'short' })}` : title;
  const shortcutKey = JSON.stringify([row.hostId, row.id]);
  const actionBusy = busyThreadActions.has(shortcutKey);
  const actions = availableThreadActions?.(row) ?? [];
  const pin = isThreadPinned?.(row) ? 'unpin' : 'pin';
  const archive = row.archived ? 'restore' : 'archive';
  const unread = isThreadUnread?.(row) ? 'mark-read' : 'mark-unread';
  const project = projectForThread(projectState, [...projects], row.hostId, row);
  const unresolved = !projectState || !projectState.inventory.complete
    || Object.hasOwn(projectState.unresolved.assignments, row.id) || projectState.unresolved.projectless.includes(row.id)
    || projectState.unresolved.qualified.some(value => value.hostId === row.hostId && value.threadId === row.id)
    || Object.keys(projectState.unresolved.unreadable).length > 0;
  const reason = (action: SidebarThreadAction): string | undefined => {
    if (action === 'move' && !onMoveThreadToProject) return 'Moving a conversation is not connected.';
    if (action !== 'move' && !onThreadAction) return 'This action is not connected.';
    if ((action === 'pin' || action === 'unpin') && !isThreadPinned) return 'Pin status is unavailable.';
    if ((action === 'mark-read' || action === 'mark-unread') && !isThreadUnread) return 'Read status is unavailable.';
    if (action === 'move' && unresolved) return 'Project membership is not confirmed.';
    return actions.includes(action) ? undefined : 'This action is unavailable for this conversation.';
  };
  const execute = (action: SidebarThreadAction, target?: { project: Project | null }) => {
    if (reason(action)) throw new Error(reason(action));
    return dispatchThreadAction(row, action, target);
  };
  const item = (id: string, label: string, action: SidebarThreadAction, icon?: ReactNode,
    shortcut?: string, target?: { project: Project | null }): SidebarMenuItem => ({
    kind: 'item', id, label, icon, shortcut,
    disabledReason: actionBusy ? 'Another conversation action is in progress.' : reason(action),
    onSelect: () => execute(action, target),
  });
  const projectItems: SidebarMenuEntry[] = projects.filter(candidate => candidate.hostId === row.hostId && candidate.id !== project?.id)
    .map(candidate => item('project:' + candidate.id, candidate.name, 'move', <Folder aria-hidden="true" />, undefined, { project: candidate }));
  if (project) projectItems.push(item('remove-project', `Remove from ${project.name}`, 'move', <FolderX aria-hidden="true" />, undefined, { project: null }));
  if (!projectItems.length) projectItems.push({ kind: 'item', id: 'no-project', label: 'No available projects',
    disabledReason: unresolved ? 'Project membership is not confirmed.' : 'No other projects are available.' });
  const menuItems: SidebarMenuEntry[] = [
    item('rename', t('Rename'), 'rename', <Pencil aria-hidden="true" />, 'Ctrl+Alt+R'),
    item('pin', pin === 'pin' ? 'Pin' : 'Unpin', pin, <Pin aria-hidden="true" />, 'Ctrl+Alt+P'),
    item('unread', unread === 'mark-unread' ? 'Mark as unread' : 'Mark as read', unread, <Eye aria-hidden="true" />, 'Ctrl+Shift+U'),
    { kind: 'item', id: 'project', label: 'Project', icon: <FolderOpen aria-hidden="true" />, children: projectItems },
    { kind: 'separator' },
    { kind: 'item', id: 'fork', label: t('Fork'), icon: <GitFork aria-hidden="true" />, children: [
      item('fork-chat', 'Fork chat', 'fork', <GitFork aria-hidden="true" />),
    ] },
    { kind: 'separator' },
    { kind: 'item', id: 'copy', label: t('Copy'), icon: <Copy aria-hidden="true" />, children: [
      item('copy-link', 'Copy deeplink', 'copy', <Copy aria-hidden="true" />, 'Ctrl+Alt+L'),
      item('copy-markdown', 'Copy as Markdown', 'copy-markdown', <Copy aria-hidden="true" />),
      item('copy-cwd', 'Copy working directory', 'copy-working-directory', <Copy aria-hidden="true" />, 'Ctrl+Shift+C'),
    ] },
    { kind: 'separator' },
    item('archive', row.archived ? t('Restore conversation') : t('Archive'), archive,
      row.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />, 'Ctrl+Shift+A'),
    { ...item('delete', 'Permanently delete', 'delete', <Trash2 aria-hidden="true" />), danger: true },
  ];
  const quick = (action: SidebarThreadAction) => {
    setActionError('');
    try {
      void Promise.resolve(execute(action)).catch(cause => setActionError(cause instanceof Error ? cause.message : String(cause)));
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const rowElement = useRef<HTMLDivElement>(null);
  return <><div ref={rowElement} className="yard-owned-sidebar-thread yard-owned-sidebar-thread-line" onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || !event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const action = event.altKey && !event.shiftKey && key === 'r' ? 'rename'
      : event.altKey && !event.shiftKey && key === 'p' ? pin
        : event.altKey && !event.shiftKey && key === 'l' ? 'copy'
        : event.shiftKey && !event.altKey && key === 'u' ? unread
          : event.shiftKey && !event.altKey && key === 'a' ? archive
            : event.shiftKey && !event.altKey && key === 'c' ? 'copy-working-directory' : null;
    if (action && !reason(action) && !actionBusy) { event.preventDefault(); quick(action); }
  }}>
  <button type="button" className="yard-owned-sidebar-thread-button" title={tooltip} data-sidebar-thread={shortcutKey}
    aria-current={currentThread?.hostId === row.hostId && currentThread.threadId === row.id ? 'page' : undefined}
    onClick={() => onOpenThread(row)}>
    <span className="yard-owned-sidebar-thread-title">{title}</span>
    {shortcutHints?.get(shortcutKey) && <kbd>{shortcutHints.get(shortcutKey)}</kbd>}
    {statusKey && <StatusIndicator status={statusKey} />}
  </button>
  {!reason(pin) && <button type="button" className="yard-owned-sidebar-row-action" aria-label={(pin === 'pin' ? 'Pin ' : 'Unpin ') + title}
    title={pin === 'pin' ? 'Pin' : 'Unpin'} disabled={actionBusy} onClick={() => quick(pin)}><Pin aria-hidden="true" /></button>}
  {!reason(archive) && <button type="button" className="yard-owned-sidebar-row-action" aria-label={(row.archived ? t('Restore conversation') : t('Archive')) + ' ' + title}
    title={row.archived ? t('Restore conversation') : t('Archive')} disabled={actionBusy} onClick={() => quick(archive)}>
    {row.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}</button>}
  <SidebarMenu className="yard-owned-sidebar-row-action" label={`${t('Conversation menu')}: ${title}`} contextTarget={rowElement}
    width={204} items={menuItems}>
    <MoreHorizontal aria-hidden="true" />
  </SidebarMenu>
  </div>{actionError && <p className="yard-sidebar-action-error" role="alert">{actionError}</p>}</>;
}

function ProjectGroup({ project, fallback, rows, query, currentThread, onOpenThread, onNewChat, shortcutHints, projects, projectState,
  activeProjectId, onProjectOptions, onProjectAction, availableProjectActions, isProjectPinned, availableThreadActions,
  onThreadAction, onMoveThreadToProject, isThreadPinned, isThreadUnread, busyThreadActions, dispatchThreadAction }: {
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
  onProjectAction?: StandaloneSidebarProps['onProjectAction'];
  availableProjectActions?: StandaloneSidebarProps['availableProjectActions'];
  isProjectPinned?: StandaloneSidebarProps['isProjectPinned'];
  availableThreadActions?: StandaloneSidebarProps['availableThreadActions'];
  onThreadAction?: StandaloneSidebarProps['onThreadAction'];
  onMoveThreadToProject?: StandaloneSidebarProps['onMoveThreadToProject'];
  isThreadPinned?: StandaloneSidebarProps['isThreadPinned'];
  isThreadUnread?: StandaloneSidebarProps['isThreadUnread'];
  projects: readonly Project[];
  projectState: ProjectState | null;
  busyThreadActions: ReadonlySet<string>;
  dispatchThreadAction: ThreadActionDispatch;
}) {
  const { t } = useI18n();
  const [expanded, toggle] = useExpansion(query);
  const projectHeading = useRef<HTMLDivElement>(null);
  const id = useId();
  const newChatLabel = `${t('New chat in')} ${project.name}`;
  const statuses = expanded ? [] : rows.map(threadStatus);
  const projectStatus = (['Waiting for approval', 'Waiting for input', 'System error', 'In progress'] as const)
    .find(status => statuses.includes(status));
  const projectActions = availableProjectActions?.(project) ?? [];
  const pinAction = isProjectPinned?.(project) ? 'unpin' : 'pin';
  const projectItem = (action: SidebarProjectAction, label: string, icon: ReactNode): SidebarMenuEntry => ({
    kind: 'item', id: action, label, icon,
    disabledReason: fallback ? 'This workspace is not a saved project.'
      : !onProjectAction ? 'This action is not connected.'
        : (action === 'pin' || action === 'unpin') && !isProjectPinned ? 'Pin status is unavailable.'
          : projectActions.includes(action) ? undefined : 'This action is unavailable for this project.',
    onSelect: () => onProjectAction?.(project, action),
  });
  const menuItems: SidebarMenuEntry[] = [
    projectItem(pinAction, pinAction === 'pin' ? 'Pin' : 'Unpin', <Pin aria-hidden="true" />),
    projectItem('edit', t('Edit'), <Settings aria-hidden="true" />),
    { kind: 'separator' },
    projectItem('open-in-file-manager', 'Open in File Manager', <FolderOpen aria-hidden="true" />),
    { kind: 'separator' },
    projectItem('archive-chats', 'Archive chats', <Archive aria-hidden="true" />),
    { kind: 'separator' },
    projectItem('remove', 'Remove project', <X aria-hidden="true" />),
  ];
  return <section className="yard-owned-sidebar-project">
    <div ref={projectHeading} className="yard-owned-sidebar-project-heading" data-active={activeProjectId === project.id}>
      <button type="button" className="yard-owned-sidebar-project-toggle" aria-expanded={expanded} aria-controls={id}
        onClick={toggle} title={project.name}>
        <Folder aria-hidden="true" />
        <span>{project.name}</span>
      </button>
      {projectStatus && <StatusIndicator status={projectStatus} />}
      {onProjectOptions && !onProjectAction && !fallback
        ? <button type="button" className="yard-owned-sidebar-icon yard-owned-sidebar-project-action"
          aria-label={`${t('Projects')}: ${project.name}`} title={project.name} onClick={event => onProjectOptions(project, event.currentTarget)}><MoreHorizontal aria-hidden="true" /></button>
        : <SidebarMenu className="yard-owned-sidebar-icon yard-owned-sidebar-project-action"
          label={`Project actions for ${project.name}`} contextTarget={projectHeading} width={174} items={menuItems}><MoreHorizontal aria-hidden="true" /></SidebarMenu>}
      <button type="button" className="yard-owned-sidebar-icon" aria-label={newChatLabel}
        title={newChatLabel} onClick={() => onNewChat(project, fallback)}><SquarePen aria-hidden="true" /></button>
    </div>
    <div id={id} hidden={!expanded}>
      {rows.map(row => <ThreadRow key={JSON.stringify([row.hostId, row.id])} row={row} currentThread={currentThread} onOpenThread={onOpenThread} shortcutHints={shortcutHints}
        availableThreadActions={availableThreadActions} onThreadAction={onThreadAction} onMoveThreadToProject={onMoveThreadToProject}
        isThreadPinned={isThreadPinned} isThreadUnread={isThreadUnread} projects={projects} projectState={projectState}
        busyThreadActions={busyThreadActions} dispatchThreadAction={dispatchThreadAction} />)}
    </div>
  </section>;
}

type ThreadActionDispatch = (row: ThreadListRow, action: SidebarThreadAction, target?: { project: Project | null }) => Promise<void>;

/** Navigation and collapse state only; project and thread state belong to the caller. */
export function StandaloneSidebar({ hostId, currentThread, projectState, fallbackWorkspace, rows, nextCursor, loading, error,
  search, archived, onSearchChange, onArchivedChange, onOpenThread, onNewChat, onAddProject, onOpenSettings, onClose,
  onRefresh, onLoadMore, onRetryProjectLookup, shortcutHints, onNavigateHistory, canNavigateBack, canNavigateForward,
  onOpenPlugins, onOpenScheduled, onOpenExplore, accountLabel, onOpenProductModeMenu, onSwitchProductMode, activeProjectId, onProjectOptions,
  onProjectAction, availableProjectActions, isProjectPinned, availableThreadActions, onThreadAction, onMoveThreadToProject, isThreadPinned,
  isThreadUnread, sidebarOptions, onSidebarOptionChange, orderThreads, orderProjects, onHelpAction }: StandaloneSidebarProps) {
  const { t } = useI18n();
  const query = search.trim().toLowerCase();
  const [projectsExpanded, toggleProjects] = useExpansion(query);
  const [recentsExpanded, toggleRecents] = useExpansion(query);
  const [searchOpen, setSearchOpen] = useState(!!search);
  const pendingThreads = useRef(new Set<string>());
  const [busyThreadActions, setBusyThreadActions] = useState<ReadonlySet<string>>(new Set());
  const dispatchThreadAction: ThreadActionDispatch = (row, action, target) => {
    const key = JSON.stringify([row.hostId, row.id]);
    if (pendingThreads.current.has(key)) throw new Error('Another conversation action is in progress.');
    let run: () => void | Promise<void>;
    if (action === 'move') {
      const handler = onMoveThreadToProject;
      if (!handler || !target || (target.project && target.project.hostId !== row.hostId)) {
        throw new Error('The target project is not available for this host.');
      }
      run = () => handler(row, target.project);
    } else {
      const handler = onThreadAction;
      if (!handler) throw new Error('This action is not connected.');
      run = () => handler(row, action);
    }
    pendingThreads.current.add(key); setBusyThreadActions(new Set(pendingThreads.current));
    const finish = () => { pendingThreads.current.delete(key); setBusyThreadActions(new Set(pendingThreads.current)); };
    try {
      return Promise.resolve(run()).finally(finish);
    } catch (cause) { finish(); throw cause; }
  };
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (search) setSearchOpen(true); }, [search]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const projectsId = useId(), recentsId = useId();
  const options: SidebarOptions = sidebarOptions ?? { organization: 'by-project', sort: 'last-updated', showProjects: true };
  const { projects, grouped, recent, fallback } = useMemo(() => {
    const assigned = projectState ? projectsForHost(projectState, hostId) : [];
    const rawProjects: Project[] = assigned.length ? assigned : hostId === 'local' && fallbackWorkspace
      ? [{ id: fallbackWorkspace, name: fallbackWorkspace.split(/[\\/]/).filter(Boolean).at(-1) || t('Workspace'),
        rootPaths: [fallbackWorkspace], hostId }] : [];
    const projects = [...(orderProjects?.(rawProjects) ?? rawProjects)];
    const grouped = new Map(projects.map(project => [project.id, [] as ThreadListRow[]]));
    const recent: ThreadListRow[] = [];
    for (const row of rows) {
      if (row.hostId !== hostId) continue;
      const project = projectForThread(projectState, projects, hostId, row);
      const group = project && grouped.get(project.id);
      if (group) group.push(row);
      recent.push(row);
    }
    for (const project of projects) {
      const group = grouped.get(project.id)!;
      grouped.set(project.id, [...(orderThreads?.(group, project) ?? group)]);
    }
    return { projects, grouped, recent: [...(orderThreads?.(recent, null) ?? recent)], fallback: assigned.length === 0 };
  }, [projectState, hostId, fallbackWorkspace, rows, t, orderThreads, orderProjects]);
  const unresolved = projectState && (!projectState.inventory.complete || Object.keys(projectState.unresolved.assignments).length > 0
    || projectState.unresolved.projectless.length > 0 || projectState.unresolved.qualified.length > 0);
  const visibleRecent = options.showProjects ? recent : recent.filter(row => !projectForThread(projectState, projects, hostId, row));
  const count = visibleRecent.length;
  const optionReason = !sidebarOptions ? 'Sidebar preferences have not been loaded.'
    : !onSidebarOptionChange ? 'Sidebar preferences are not connected.' : undefined;
  const optionItem = (id: string, label: string, change: SidebarOptionChange, checked: boolean, icon?: ReactNode): SidebarMenuEntry => ({
    kind: 'item', id, label, icon, role: 'menuitemradio', checked, disabledReason: optionReason,
    onSelect: () => onSidebarOptionChange?.(change),
  });
  const groupItems = (includeShow: boolean): SidebarMenuEntry[] => [
    { kind: 'item', id: 'organization', label: 'Organize sidebar', icon: <PanelLeft aria-hidden="true" />, children: [
      optionItem('by-project', 'By project', { type: 'organization', value: 'by-project' }, options.organization === 'by-project', <Folder aria-hidden="true" />),
      optionItem('one-list', 'In one list', { type: 'organization', value: 'one-list' }, options.organization === 'one-list', <List aria-hidden="true" />),
    ] },
    { kind: 'item', id: 'sort', label: 'Sort chats by', icon: <ArrowDownUp aria-hidden="true" />, children: [
      optionItem('updated', 'Last updated', { type: 'sort', value: 'last-updated' },
        (includeShow ? options.sort : options.projectSort ?? options.sort) === 'last-updated'),
      optionItem('manual', 'Manual order', { type: 'sort', value: 'manual' },
        (includeShow ? options.sort : options.projectSort ?? options.sort) === 'manual'),
    ] },
    ...(includeShow ? [
      { kind: 'separator' } as const,
      { kind: 'heading', label: 'Show' } as const,
      { kind: 'item', id: 'show-projects', label: t('Projects'), role: 'menuitemcheckbox', checked: options.showProjects,
        disabledReason: optionReason, onSelect: () => onSidebarOptionChange?.({ type: 'show-projects', value: !options.showProjects }) } as const,
    ] : []),
  ];
  const helpItem = (id: 'changelog' | 'shortcuts' | 'guide', label: string, icon?: ReactNode): SidebarMenuEntry => ({
    kind: 'item', id, label, icon, disabledReason: onHelpAction ? undefined : 'This help action is not connected.',
    onSelect: () => onHelpAction?.(id),
  });

  return <aside id="app-shell-sidebar" className="yard-owned-sidebar" aria-label={t('Sidebar')} onKeyDownCapture={event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ','
      && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); onOpenSettings(); }
  }}>
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
      {onOpenProductModeMenu && !onSwitchProductMode
        ? <button type="button" className="yard-owned-sidebar-brand-button" aria-label="Switch mode, current mode: Codex"
          onClick={event => onOpenProductModeMenu(event.currentTarget)}>
          <img src="/brand/icon.svg" alt="" /><strong>Codex Yard</strong><ChevronDown aria-hidden="true" />
        </button>
        : <SidebarMenu className="yard-owned-sidebar-brand-button" label="Switch mode, current mode: Codex" width={242} items={[
          { kind: 'item', id: 'chatgpt', label: 'ChatGPT', description: 'Create, learn, and explore',
            disabledReason: onSwitchProductMode ? undefined : 'ChatGPT is not connected.',
            onSelect: () => onSwitchProductMode?.('chatgpt') },
          { kind: 'item', id: 'codex', label: 'Codex', description: 'Build, debug, and ship',
            role: 'menuitemradio', checked: true, onSelect: () => {} },
        ]}><img src="/brand/icon.svg" alt="" /><strong>Codex Yard</strong><ChevronDown aria-hidden="true" /></SidebarMenu>}
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
    <button type="button" className="yard-owned-sidebar-command" disabled={!onOpenScheduled} onClick={onOpenScheduled}>
      <Clock3 aria-hidden="true" />{translateKnown(t, 'Scheduled')}
    </button>
    <button type="button" className="yard-owned-sidebar-command" disabled={!onOpenPlugins} onClick={onOpenPlugins}>
      <Plug aria-hidden="true" />{t('Plugins')}
    </button>
    {options.organization === 'one-list' && <button type="button" className="yard-owned-sidebar-command"
      disabled={!onOpenExplore} title={onOpenExplore ? 'Explore' : 'Explore is not connected.'} onClick={onOpenExplore}>
      <MoreHorizontal aria-hidden="true" />Explore
    </button>}
    <div className="yard-owned-sidebar-scroll">
    {options.organization === 'by-project' && <><div className="yard-owned-sidebar-heading yard-owned-sidebar-projects-heading">
      <button type="button" className="yard-owned-sidebar-section-toggle" aria-expanded={projectsExpanded} aria-controls={projectsId}
        onClick={toggleProjects}>{t('Projects')}<ChevronDown aria-hidden="true" /></button>
      <SidebarMenu className="yard-owned-sidebar-icon yard-owned-sidebar-heading-options" label="Project sidebar options"
        width={220} items={groupItems(false)}><MoreHorizontal aria-hidden="true" /></SidebarMenu>
      <button type="button" className="yard-owned-sidebar-icon" aria-label={t('Add project')} title={t('Add project')} onClick={onAddProject}>
        <Plus aria-hidden="true" />
      </button>
    </div>
      <div id={projectsId} hidden={!projectsExpanded}>
        {projects.map(project => <ProjectGroup key={JSON.stringify([project.hostId, project.id])} project={project} fallback={fallback} query={query}
          rows={grouped.get(project.id) ?? []} currentThread={currentThread} onOpenThread={onOpenThread} onNewChat={onNewChat} shortcutHints={shortcutHints}
          projects={projects} projectState={projectState} activeProjectId={activeProjectId} onProjectOptions={onProjectOptions}
          onProjectAction={onProjectAction} availableProjectActions={availableProjectActions} isProjectPinned={isProjectPinned}
          availableThreadActions={availableThreadActions} onThreadAction={onThreadAction} onMoveThreadToProject={onMoveThreadToProject}
          isThreadPinned={isThreadPinned} isThreadUnread={isThreadUnread} busyThreadActions={busyThreadActions} dispatchThreadAction={dispatchThreadAction} />)}
      </div></>}
      <div className="yard-owned-sidebar-heading yard-owned-sidebar-recents">
        <button type="button" className="yard-owned-sidebar-section-toggle" aria-expanded={recentsExpanded} aria-controls={recentsId}
          onClick={toggleRecents}>{t(archived ? 'Archived' : 'Recents')}<ChevronDown aria-hidden="true" /></button>
        <SidebarMenu className="yard-owned-sidebar-icon yard-owned-sidebar-heading-options" label="Chat sidebar options"
          width={220} items={groupItems(true)}><MoreHorizontal aria-hidden="true" /></SidebarMenu>
        <button type="button" className="yard-owned-sidebar-icon" aria-label={t('New chat')} title={t('New chat')}
          onClick={() => onNewChat(null)}><SquarePen aria-hidden="true" /></button>
      </div>
      {archived && <button type="button" className="yard-owned-sidebar-command" onClick={() => onArchivedChange(false)}>{t('Show recent chats')}</button>}
      <div id={recentsId} hidden={!recentsExpanded}>
      {unresolved && <p className="yard-owned-sidebar-message" role="status">{t('Some legacy project associations are unresolved. Original records are retained.')}
        {onRetryProjectLookup && <button type="button" onClick={onRetryProjectLookup}>{t('Retry project lookup')}</button>}
      </p>}
      {visibleRecent.map(row => <ThreadRow key={JSON.stringify([row.hostId, row.id])} row={row}
        currentThread={options.organization === 'by-project' && projectForThread(projectState, projects, hostId, row) ? null : currentThread}
        onOpenThread={onOpenThread} shortcutHints={shortcutHints}
        availableThreadActions={availableThreadActions} onThreadAction={onThreadAction} onMoveThreadToProject={onMoveThreadToProject}
        isThreadPinned={isThreadPinned} isThreadUnread={isThreadUnread} projects={projects} projectState={projectState}
        busyThreadActions={busyThreadActions} dispatchThreadAction={dispatchThreadAction} />)}
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
    </div>
    <footer className="yard-owned-sidebar-footer">
      <SidebarMenu className="yard-owned-sidebar-account" label="Open profile menu" placement="above" matchTriggerWidth items={[
        { kind: 'item', id: 'account', label: accountLabel || t('Account'), disabledReason: 'Account details are informational.' },
        { kind: 'separator' },
        { kind: 'item', id: 'settings', label: t('Settings'), icon: <Settings aria-hidden="true" />, shortcut: 'Ctrl+,', onSelect: onOpenSettings },
        { kind: 'separator' },
        { kind: 'item', id: 'help', label: 'Help', icon: <LifeBuoy aria-hidden="true" />, children: [
          { kind: 'heading', label: "What's new" },
          helpItem('changelog', 'Full changelog'), { kind: 'separator' },
          helpItem('shortcuts', t('Keyboard shortcuts'), <Keyboard aria-hidden="true" />),
          helpItem('guide', 'User guide', <BookOpen aria-hidden="true" />),
        ] },
      ]}><Settings aria-hidden="true" /><span>{accountLabel || t('Account')}</span></SidebarMenu>
    </footer>
  </aside>;
}
