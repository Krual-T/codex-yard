import { Archive, ArrowLeft, ArrowRight, AtSign, CalendarClock, ChevronDown, PanelLeft, Pin, PinOff, SquarePen, SquareTerminal } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { parseWorkspaceThreadRoute, sourceWorkspaceRoute, usesPinnedToolRenderer, workspaceThreadRoute } from '../native/history-startup.ts';
import type { StartupHost, StartupProject, StartupProjectSelection, StartupSidebar, StartupThread } from '../native/startup-sidebar.ts';
import { activeTurnBeforeArchive, archiveThread, browserAtoms, forkConversation, initialHistory, interruptTurn, olderSidebar, onSidebarChanged, onThreadName, projectSections, remoteHosts, renameThread, selectLocalProject, sendExistingThread, sendNewThread, setThreadPinned, sidebar, sidechats, updateSidebarProject, WorkspaceRequestError, type SidebarChange } from './host.ts';
import { Composer, type ComposerHandle } from './composer.tsx';
import { AsyncQuestionsProvider } from './async-questions.tsx';
import { HomePendingMessages, Transcript, useConversation } from './conversation.tsx';
import type { ConversationView } from './conversation.tsx';
import { ConversationPanels } from './conversation-panels.tsx';
import { McpAppTabs } from './mcp-app.tsx';
import { TurnStream } from './turn-stream.ts';
import { useSubagentDirectory } from './turn-agents.tsx';
import { ArchiveConfirmation, HeaderChatActions, SidebarThreadMenu, type ThreadAction } from './sidebar-thread-menu.tsx';
import { ThreadNameEditor, ThreadTitle } from './thread-title.tsx';
import { copyChat } from './thread-copy.ts';
import { isInputRequest, useTurnRequests } from './turn-requests.tsx';
import { TerminalPanel, type WorkspaceTerminalSession } from './terminal-panel.tsx';
import { HomeTerminal } from './home-terminal.tsx';
import { SidebarProfile, workspacePlugins } from './sidebar-profile.tsx';
import { SidebarProduct } from './sidebar-product.tsx';
import { SidebarProjectRow } from './sidebar-project.tsx';
import { WorkspaceSearch, type WorkspaceCommand } from './workspace-search.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { WorkspaceOutputLinks } from './message-markdown.tsx';
import { SidebarSplitter } from './sidebar-splitter.tsx';
import './workspace.css';
import './activity-style.css';

function currentRoute() {
  return sourceWorkspaceRoute(location);
}

const browserNavigation = (window as Window & { navigation?: EventTarget & {
  readonly canGoBack: boolean; readonly canGoForward: boolean;
} }).navigation;
function subscribeNavigation(listener: () => void) {
  browserNavigation?.addEventListener('currententrychange', listener);
  return () => browserNavigation?.removeEventListener('currententrychange', listener);
}
const canGoBack = () => browserNavigation?.canGoBack ?? true;
const canGoForward = () => browserNavigation?.canGoForward ?? true;

const initialRoute = currentRoute();
const recent = sidebar();
function openRoute(route: string): ConversationView | undefined {
  if (usesPinnedToolRenderer(route)) return;
  const thread = parseWorkspaceThreadRoute(route);
  if (!thread) return;
  const { threadId, hostId } = thread;
  const pending = initialHistory(threadId, hostId);
  void pending.catch(() => {});
  return { stream: new TurnStream(threadId, hostId), pending };
}
const initialView = openRoute(initialRoute);
const projectPreviewRows = 5;
const recentPageRows = 20;
recent.catch(() => {});

function recentThread(snapshot: StartupSidebar | undefined, thread: StartupThread): StartupSidebar {
  const { projects = [], pinnedIds = [], threads = [], selectedProjectId = null, locale = 'zh-CN' } = snapshot ?? {};
  return { ...snapshot, projects, pinnedIds, selectedProjectId, locale, threads: mergeRows([thread], threads) };
}

function mergeRows(leading: StartupThread[], trailing: StartupThread[]) {
  const ids = new Set(leading.map(thread => thread.id));
  return [...leading, ...trailing.filter(thread => !ids.has(thread.id))];
}

type RemoteSidebar = { data?: StartupSidebar; pending?: boolean; error?: string };
type ArchiveTarget = { id: string; hostId: string; title: string };
type ThreadTarget = ArchiveTarget & { pinned: boolean; key: string };

function Sidebar({ data, remotes, active, selectedProjectId, select, newChat, updateProject, connect, rename, pin, archive, projectArchived, loadOlder, commands }: {
  data: StartupSidebar | undefined;
  remotes: Array<StartupHost & RemoteSidebar>;
  active?: string;
  selectedProjectId?: string;
  select(route: string): void;
  newChat(projectId?: string): void;
  updateProject(hostId: string, projectId: string, action: Parameters<typeof updateSidebarProject>[2]): Promise<void>;
  connect(hostId: string): void;
  rename(id: string, name: string, hostId: string): Promise<void>;
  pin(id: string, pinned: boolean, hostId: string): Promise<void>;
  archive(target: ArchiveTarget, trigger: HTMLElement): Promise<void>;
  projectArchived(hostId: string, ids: string[], failed: number): void;
  loadOlder(hostId: string, cursor: string): Promise<void>;
  commands(): WorkspaceCommand[];
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [customSections, setCustomSections] = useState(projectSections.snapshot);
  const [projectLimits, setProjectLimits] = useState<Map<string, number>>(() => new Map());
  const [recentLimits, setRecentLimits] = useState(() => new Map<string, number>());
  const [pageErrors, setPageErrors] = useState(() => new Map<string, string>());
  const loadingPages = useRef(new Set<string>());
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<ThreadTarget & { x: number; y: number; trigger: HTMLElement }>();
  const [editing, setEditing] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const turnRequests = useTurnRequests();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || (!event.ctrlKey && !event.metaKey) ||
          event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('dialog:modal')) return;
      event.preventDefault();
      setSearchOpen(true);
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  async function act(action: ThreadAction, target: ThreadTarget, trigger: HTMLElement) {
    if (pending) return;
    const { id, hostId, key, pinned } = target;
    setMenu(undefined);
    setActionError(undefined);
    if (action === 'rename') { setEditing(key); return; }
    trigger.focus({ preventScroll: true });
    setPending(key);
    try {
      if (action === 'pin') await pin(id, !pinned, hostId);
      else await archive(target, trigger);
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(undefined); }
  }
  async function showMore(hostId: string, limit: number, available: number, cursor?: string | null) {
    const grow = () => setRecentLimits(previous => (previous.get(hostId) ?? recentPageRows) === limit
      ? new Map(previous).set(hostId, limit + recentPageRows) : previous);
    if (available > limit) { grow(); return; }
    if (cursor == null || loadingPages.current.has(hostId)) return;
    loadingPages.current.add(hostId);
    try {
      await loadOlder(hostId, cursor);
      setPageErrors(previous => {
        if (!previous.has(hostId)) return previous;
        const next = new Map(previous);
        next.delete(hostId);
        return next;
      });
      grow();
    } catch (error) {
      setPageErrors(previous => new Map(previous).set(hostId, error instanceof Error ? error.message : String(error)));
    } finally { loadingPages.current.delete(hostId); }
  }
  function revealNearEnd(scroll: HTMLElement) {
    const { top, bottom } = scroll.getBoundingClientRect();
    for (const sentinel of scroll.querySelectorAll<HTMLButtonElement>('[data-source-recent-more]')) {
      const { top: next } = sentinel.getBoundingClientRect();
      if (next >= top && next <= bottom + 64 && !sentinel.dataset.retry) sentinel.click();
    }
  }
  function toggleGroup(key: string) {
    setClosed(previous => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  function row(thread: StartupThread, hostId: string, section: 'pinned' | 'project' | 'recent', selectedSection: string) {
    const route = workspaceThreadRoute(hostId, thread.id);
    const selected = route === active && section === selectedSection;
    const key = section + ':' + route;
    const target = { id: thread.id, hostId, pinned: section === 'pinned', key, title: thread.title };
    const needsApproval = turnRequests.some(request => !isInputRequest(request) && request.hostId === hostId && request.threadId === thread.id);
    const needsInput = !needsApproval && turnRequests.some(request => isInputRequest(request) && request.hostId === hostId && request.threadId === thread.id);
    const isRunning = thread.active;
    return <div key={thread.id} className="yard-source-thread-group" data-in-project={section === 'project' || undefined}>
      {editing === key ? <ThreadNameEditor name={thread.title} rename={name => rename(thread.id, name, hostId)}
        finish={() => setEditing(undefined)} /> : <>
      <button type="button" className="yard-source-thread sidebar-item hover:bg-primary-ghost-hover"
      data-app-action-sidebar-thread-row="" data-app-action-sidebar-thread-host-id={hostId}
      data-app-action-sidebar-thread-id={hostId + ':' + thread.id}
      data-app-action-sidebar-thread-selected={selected}
      data-app-action-sidebar-thread-title={thread.title} aria-label={thread.title}
      aria-current={selected ? 'page' : undefined} onClick={() => { closeMenu(); select(route); }}
      onContextMenu={event => {
        event.preventDefault();
        if (!pending) setMenu({ ...target, x: event.clientX, y: event.clientY, trigger: event.currentTarget });
      }}
      onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const trigger = event.currentTarget;
        const { x, bottom } = trigger.getBoundingClientRect();
        if (!pending) setMenu({ ...target, x, y: bottom, trigger });
      }}>
        <span dir="auto">{thread.title}</span>
        {needsApproval && <span className="yard-source-approval-badge">Awaiting approval</span>}
        {needsInput && section !== 'project' && <span className="yard-source-approval-badge" data-needs-input="">Needs input</span>}
        {isRunning && !needsInput && <span className="yard-source-pinned-spinner text-text/70" role="status" aria-label="Working">
          <WorkspaceIcon name="runningSpinner" className="motion-safe:animate-spin" />
        </span>}
      </button>
      <div className="yard-source-thread-quick" data-menu-open={menu?.key === key || undefined}>
        <button type="button" title={target.pinned ? 'Unpin chat' : 'Pin chat'} aria-label={target.pinned ? 'Unpin chat' : 'Pin chat'}
          disabled={!!pending} onClick={event => void act('pin', target, event.currentTarget)}>
          {target.pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}
        </button>
        <button type="button" title="Archive chat" aria-label="Archive chat" disabled={!!pending}
          onClick={event => void act('archive', target, event.currentTarget)}><Archive size={13} aria-hidden="true" /></button>
      </div>
      </>}
    </div>;
  }
  function sections(data: StartupSidebar, hostId: string) {
    const matching = data.threads;
    const pinnedIds = new Set(data.pinnedIds);
    const pinned = data.pinnedIds.flatMap(id => matching.find(thread => thread.id === id) ?? []);
    const unpinned = matching.filter(thread => !pinnedIds.has(thread.id));
    const selected = matching.find(thread => workspaceThreadRoute(hostId, thread.id) === active);
    const projectKey = (id: string) => workspaceThreadRoute(hostId, id);
    const projectThreads = new Map<string, StartupThread[]>();
    for (const thread of unpinned) {
      if (!thread.projectId) continue;
      const items = projectThreads.get(thread.projectId);
      if (items) items.push(thread);
      else projectThreads.set(thread.projectId, [thread]);
    }
    const projectRow = selected?.projectId && projectThreads.get(selected.projectId)?.indexOf(selected);
    const projects = [...data.projects].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    const custom = customSections.flatMap(section => {
      const members = section.projectIds.flatMap(id => projects.find(project => project.id === id) ?? []);
      return members.length ? [{ ...section, members }] : [];
    });
    const placed = new Map(custom.flatMap(section => section.members.map(project => [project.id, section.id])));
    const recents = placed.size ? unpinned.filter(thread => !thread.projectId || !placed.has(thread.projectId)) : unpinned;
    const recentLimit = recentLimits.get(hostId) ?? recentPageRows;
    const pageError = pageErrors.get(hostId);
    const recentsGroup = 'recents:' + hostId;
    const projectsGroup = 'projects:' + hostId;
    const showingRecents = !closed.has(recentsGroup);
    const showingProjects = !closed.has(projectsGroup);
    const sectionGroup = (id: string) => 'custom:' + hostId + ':' + id;
    const selectedGroup = selected?.projectId ? placed.get(selected.projectId) : undefined;
    const selectedSection = selected && pinnedIds.has(selected.id) ? 'pinned'
      : (selectedGroup ? !closed.has(sectionGroup(selectedGroup)) : showingProjects) && selected?.projectId &&
        typeof projectRow === 'number' && projectRow >= 0 && !closed.has(projectKey(selected.projectId)) &&
        projectRow < (projectLimits.get(projectKey(selected.projectId)) ?? projectPreviewRows) &&
        data.projects.some(project => project.id === selected.projectId) ? 'project' : 'recent';
    function projectNode(project: StartupProject) {
      const key = projectKey(project.id);
      const threads = projectThreads.get(project.id) ?? [];
      const limit = projectLimits.get(key) ?? projectPreviewRows;
      return <div key={project.id}>
        <SidebarProjectRow project={project} hostId={hostId} expanded={!closed.has(key)}
          selected={hostId === 'local' && selectedProjectId === project.id} toggle={() => toggleGroup(key)}
          start={hostId === 'local' ? () => newChat(project.id) : undefined} update={action => updateProject(hostId, project.id, action)}
          sections={customSections} setSections={setCustomSections} onArchived={(ids, failed) => projectArchived(hostId, ids, failed)} />
        {!closed.has(key) && <>
          {threads.slice(0, limit).map(thread => row(thread, hostId, 'project', selectedSection))}
          {threads.length > limit && <button type="button" className="yard-source-project-more"
            onClick={() => setProjectLimits(previous => new Map(previous).set(key, (previous.get(key) ?? projectPreviewRows) + 10))}>
            Show more
          </button>}
        </>}
      </div>;
    }
    return <>
      {pinned.length ? <section><h2>Pinned</h2>{pinned.map(thread => row(thread, hostId, 'pinned', selectedSection))}</section> : null}
      {custom.map(section => {
        const id = sectionGroup(section.id), open = !closed.has(id);
        return <section key={id} data-app-action-sidebar-section-heading={section.name}><h2>
          <button type="button" className="yard-source-projects-toggle" aria-expanded={open} aria-controls={id}
            onClick={() => toggleGroup(id)}>{section.name}<ChevronDown aria-hidden="true" size={13} /></button>
        </h2><div id={id} hidden={!open}>{open && section.members.map(projectNode)}</div></section>;
      })}
      <section data-app-action-sidebar-section-heading="Projects"><h2>
        {projects.length > placed.size ? <button type="button" className="yard-source-projects-toggle" aria-expanded={showingProjects} aria-controls={projectsGroup}
          onClick={() => toggleGroup(projectsGroup)}>Projects<ChevronDown aria-hidden="true" size={13} /></button> : 'Projects'}</h2>
        {projects.length === placed.size ? <p className="yard-source-sidebar-empty">No projects</p>
          : <div hidden={!showingProjects} id={projectsGroup}>{showingProjects && projects.filter(project => !placed.has(project.id)).map(projectNode)}</div>}
      </section>
      <section data-app-action-sidebar-section-heading="Recents">
        <h2><button type="button" aria-expanded={showingRecents} aria-controls={recentsGroup} onClick={() => toggleGroup(recentsGroup)}>
          Recents
        </button></h2>
        <div id={recentsGroup} hidden={!showingRecents}>
        {showingRecents && <>
        {recents.slice(0, recentLimit).map(thread => row(thread, hostId, 'recent', selectedSection))}
        {!recents.length && data.nextCursor == null && <p className="yard-source-sidebar-empty">No chats</p>}
        {(recents.length > recentLimit || data.nextCursor != null) && <button type="button" data-source-recent-more=""
          data-retry={pageError ? 'true' : undefined}
          className={pageError || !recents.length ? 'yard-source-project-more' : 'yard-source-recent-more'}
          onClick={() => void showMore(hostId, recentLimit, recents.length, data.nextCursor)}>
          {pageError ? 'Retry loading more chats' : 'Load more chats'}
        </button>}
        {pageError && <p role="status" className="yard-source-sidebar-error">{pageError}</p>}
        </>}
        </div>
      </section>
    </>;
  }
  return <div id="app-shell-sidebar" className="select-none relative box-border flex h-full w-full isolate flex-col">
    <div className="yard-source-brand">
      <SidebarProduct returnRoute={active} />
      <button type="button" className="yard-source-search" title="Search" aria-label="Search" aria-haspopup="dialog"
        aria-expanded={searchOpen} aria-keyshortcuts="Control+K Meta+K" onClick={() => setSearchOpen(true)}><WorkspaceIcon name="search" /></button>
    </div>
    <button type="button" className="yard-source-action sidebar-item hover:bg-primary-ghost-hover" onClick={() => newChat()}>
      <WorkspaceIcon name="edit" />New chat
    </button>
    <nav className="yard-source-nav" data-app-action-sidebar-scroll=""
      onScroll={event => revealNearEnd(event.currentTarget)}
      onWheel={event => { if (event.deltaY > 0) revealNearEnd(event.currentTarget); }}>
      <a href={workspacePlugins} className="yard-source-action sidebar-item hover:bg-primary-ghost-hover">
        <AtSign size={16} aria-hidden="true" />Plugins
      </a>
      {data && sections(data, 'local')}
      {remotes.map(remote => <div key={remote.hostId} className="yard-source-remote" data-source-sidebar-host={remote.hostId}>
        <h2>{remote.displayName}</h2>
        {remote.data && sections(remote.data, remote.hostId)}
        {(!remote.data || remote.error) && <button type="button" className="yard-source-action sidebar-item hover:bg-primary-ghost-hover"
          disabled={remote.pending} onClick={() => connect(remote.hostId)}>
          {remote.pending ? 'Connecting…' : remote.error ? 'Try again' : 'Connect'}
        </button>}
        {remote.error && <p className="yard-source-sidebar-error" role="alert">{remote.error}</p>}
      </div>)}
    </nav>
    <SidebarProfile returnRoute={active} />
    {menu && <SidebarThreadMenu key={menu.key} x={menu.x} y={menu.y} trigger={menu.trigger} pinned={menu.pinned}
      choose={action => void act(action, menu, menu.trigger)} close={closeMenu} />}
    {searchOpen && <WorkspaceSearch sources={[{ hostId: 'local', data }, ...remotes.flatMap(remote =>
      remote.data ? [{ hostId: remote.hostId, data: remote.data, label: remote.displayName }] : [])]}
      commands={commands()} select={select} close={() => setSearchOpen(false)} />}
    {actionError && <p className="yard-source-sidebar-error" role="alert">{actionError}</p>}
  </div>;
}

function App() {
  const [view, setView] = useState(initialView);
  const stream = view?.stream;
  const id = stream?.threadId;
  const hostId = stream?.hostId ?? 'local';
  const route = id ? workspaceThreadRoute(hostId, id) : undefined;
  const backEnabled = useSyncExternalStore(subscribeNavigation, canGoBack);
  const forwardEnabled = useSyncExternalStore(subscribeNavigation, canGoForward);
  const [data, setData] = useState<StartupSidebar>();
  const [hosts, setHosts] = useState<StartupHost[]>([]);
  const [snapshots, setSnapshots] = useState(() => new Map<string, RemoteSidebar>());
  const [names, setNames] = useState(() => new Map<string, string>());
  const [fault, setFault] = useState<string>();
  const projectMenu = useId();
  const [projectOverride, setProject] = useState<StartupProjectSelection | null>();
  const projectSelection = projectOverride === undefined ? data?.selectedProject : projectOverride;
  const project = projectSelection?.type === 'local' ? data?.projects.find(row => row.id === projectSelection.projectId) : undefined;
  const projectId = project?.id;
  const homeDestinationKnown = !!data && (projectSelection === null || !!project);
  const terminalKey = route ?? 'home:' + (projectId ?? '');
  const [terminalSessions, setTerminalSessions] = useState(() => new Map<string, WorkspaceTerminalSession>());
  const generation = useRef(0);
  const workspace = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const titleControl = useRef<{ edit(): void }>(null);
  const panels = useRef<import('./conversation-panels.tsx').ConversationPanelsHandle>(null);
  const mcpAppTabs = useMemo<NonNullable<React.ContextType<typeof McpAppTabs>>>(() => ({
    open: app => panels.current?.openMcpApp(app),
    close: id => panels.current?.closeMcpApp(id),
  }), []);
  const openChanges = useCallback((turnId: string) => panels.current?.openChanges(turnId), []);
  const branching = useRef(false);
  const archiving = useRef(false);
  const [confirmation, setConfirmation] = useState<{ target: ArchiveTarget; turnId: string; trigger: HTMLElement }>();
  const unlistedThreads = useRef(new Map<string, StartupThread>());
  const sidebarRevisions = useRef(new Map<string, number>());
  const sidebarCursors = useRef(new Map<string, Set<string>>());
  const sidebarSizes = useRef(new Map<string, number>());
  const loadedSidebarHosts = useRef(new Set(['local']));
  useEffect(() => {
    if (data) sidebarSizes.current.set('local', data.threads.length);
    for (const [hostId, snapshot] of snapshots) if (snapshot.data) sidebarSizes.current.set(hostId, snapshot.data.threads.length);
  }, [data, snapshots]);
  const [sidebarOpen, setSidebarOpen] = useState(() => !matchMedia('(max-width: 767px)').matches);
  const toggleSidebar = () => setSidebarOpen(value => !value);
  useEffect(() => {
    recent.then(data => {
      for (const thread of unlistedThreads.current.values()) data = recentThread(data, thread);
      setData(previous => previous ?? data);
    }, error => setFault(String(error)));
  }, []);
  const rememberName = useCallback((id: string, name: string, hostId: string) => {
    const key = workspaceThreadRoute(hostId, id);
    setNames(previous => previous.get(key) === name ? previous : new Map(previous).set(key, name));
  }, []);
  useEffect(() => onThreadName(rememberName), [rememberName]);
  useEffect(() => {
    const update = () => {
      if (usesPinnedToolRenderer(currentRoute())) { location.replace(location.href); return; }
      generation.current++; setFault(undefined); setView(openRoute(currentRoute()));
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const refreshSidebar = useCallback(async (hostId: string) => {
    const revisions = sidebarRevisions.current;
    const revision = (revisions.get(hostId) ?? 0) + 1;
    revisions.set(hostId, revision);
    sidebarCursors.current.delete(hostId);
    if (hostId !== 'local') setSnapshots(previous => previous.get(hostId)?.data ? previous
      : new Map(previous).set(hostId, { pending: true }));
    try {
      let next = await sidebar(hostId);
      if (revisions.get(hostId) !== revision) return;
      // Re-read the already visible pages so external archives disappear and
      // recency changes keep backend ordering. Appending the old head keeps ghosts.
      const visibleCount = sidebarSizes.current.get(hostId) ?? 0;
      const cursors = new Set<string>();
      while (next.threads.length < visibleCount && next.nextCursor) {
        const cursor = next.nextCursor;
        if (cursors.has(cursor)) { next = { ...next, nextCursor: null }; break; }
        cursors.add(cursor);
        const page = await olderSidebar(hostId, cursor);
        if (revisions.get(hostId) !== revision) return;
        next = { ...next, threads: mergeRows(next.threads, page.threads), nextCursor: page.nextCursor };
      }
      sidebarCursors.current.set(hostId, cursors);
      loadedSidebarHosts.current.add(hostId);
      setNames(previous => {
        const names = new Map(previous);
        for (const thread of next.threads) {
          const key = workspaceThreadRoute(hostId, thread.id);
          if (names.get(key) === thread.title) names.delete(key);
        }
        return names.size === previous.size ? previous : names;
      });
      if (hostId !== 'local') {
        setSnapshots(previous => new Map(previous).set(hostId, { data: next }));
        return;
      }
      // Retain confirmed thread identities until the DB-only lister sees them.
      for (const thread of next.threads) unlistedThreads.current.delete(thread.id);
      for (const thread of unlistedThreads.current.values()) next = recentThread(next, thread);
      setData(next);
    } catch (error) {
      if (revisions.get(hostId) !== revision) return;
      if (hostId !== 'local') setSnapshots(previous => new Map(previous).set(hostId, { data: previous.get(hostId)?.data,
        error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }, []);
  useEffect(() => {
    let disposed = false, timer: number | undefined;
    const pending = new Set<string>(), reading = new Set<string>();
    const schedule = () => {
      if (!disposed && timer === undefined && !document.hidden) timer = window.setTimeout(flush, 100);
    };
    function flush() {
      timer = undefined;
      if (disposed || document.hidden) return;
      for (const hostId of pending) {
        if (reading.has(hostId)) continue;
        pending.delete(hostId); reading.add(hostId);
        void refreshSidebar(hostId).catch(console.error).finally(() => {
          reading.delete(hostId);
          if (pending.has(hostId)) schedule();
        });
      }
    }
    const refresh = ({ hostId, threadId, removed, active }: SidebarChange = {}) => {
      if (disposed) return;
      if (hostId && !loadedSidebarHosts.current.has(hostId)) return;
      if (hostId && threadId && (removed || active !== undefined)) {
        sidebarRevisions.current.set(hostId, (sidebarRevisions.current.get(hostId) ?? 0) + 1);
        const update = (previous?: StartupSidebar) => previous && {
          ...previous, threads: removed ? previous.threads.filter(thread => thread.id !== threadId)
            : previous.threads.map(thread => thread.id === threadId ? { ...thread, active: active ? true as const : undefined } : thread),
        };
        if (hostId === 'local') { if (removed) unlistedThreads.current.delete(threadId); setData(update); }
        else setSnapshots(previous => {
          const snapshot = previous.get(hostId);
          return new Map(previous).set(hostId, { ...snapshot, data: update(snapshot?.data) });
        });
      }
      for (const id of hostId ? [hostId] : loadedSidebarHosts.current) pending.add(id);
      schedule();
    };
    const foreground = () => { if (!document.hidden) refresh(); };
    const unsubscribe = onSidebarChanged(refresh);
    window.addEventListener('focus', foreground); window.addEventListener('pageshow', foreground);
    window.addEventListener('online', foreground); document.addEventListener('visibilitychange', foreground);
    const reconcile = window.setInterval(foreground, 15_000);
    return () => {
      disposed = true; if (timer !== undefined) clearTimeout(timer); clearInterval(reconcile); unsubscribe();
      window.removeEventListener('focus', foreground); window.removeEventListener('pageshow', foreground);
      window.removeEventListener('online', foreground); document.removeEventListener('visibilitychange', foreground);
    };
  }, [refreshSidebar]);
  const loadOlder = useCallback(async (hostId: string, cursor: string) => {
    const revision = sidebarRevisions.current.get(hostId);
    const page = await olderSidebar(hostId, cursor);
    if (sidebarRevisions.current.get(hostId) !== revision) return;
    const cursors = sidebarCursors.current.get(hostId) ?? new Set<string>();
    cursors.add(cursor);
    sidebarCursors.current.set(hostId, cursors);
    const nextCursor = page.nextCursor != null && !cursors.has(page.nextCursor) ? page.nextCursor : null;
    const append = (previous?: StartupSidebar) => previous?.nextCursor === cursor
      ? { ...previous, threads: mergeRows(previous.threads, page.threads), nextCursor } : previous;
    if (hostId === 'local') setData(append);
    else setSnapshots(previous => {
      const snapshot = previous.get(hostId);
      return new Map(previous).set(hostId, { ...snapshot, data: append(snapshot?.data) });
    });
  }, []);
  const connect = useCallback((hostId: string) => { void refreshSidebar(hostId).catch(console.error); }, [refreshSidebar]);
  useEffect(() => {
    let mounted = true;
    void remoteHosts().then(profiles => {
      if (!mounted) return;
      setHosts(profiles);
      for (const host of profiles) if (host.autoConnect || host.hostId === initialView?.stream.hostId) connect(host.hostId);
    }, console.error);
    return () => { mounted = false; };
  }, [connect]);
  const refreshRecent = useCallback((id: string, hostId: string) => {
    if (hostId === 'local' && unlistedThreads.current.has(id)) void refreshSidebar(hostId).catch(console.error);
  }, [refreshSidebar]);
  const { page, more, fault: historyFault } = useConversation(view, refreshRecent);
  const imageHistory = useRef(page?.turns);
  imageHistory.current = page?.turns;
  const subagents = useSubagentDirectory(page?.thread ? id : undefined, hostId);
  const terminalCwd = page?.thread?.cwd;
  const terminalAvailable = id ? !!terminalCwd : homeDestinationKnown;
  const toggleTerminal = useCallback(() => {
    if (!terminalAvailable) return;
    const sessionId = crypto.randomUUID();
    setTerminalSessions(previous => {
      const next = new Map(previous);
      if (!next.delete(terminalKey)) next.set(terminalKey, { sessionId, hostId, cwd: terminalCwd,
        conversationId: id, projectId: id ? undefined : projectId });
      return next;
    });
  }, [terminalAvailable, terminalKey, terminalCwd, hostId, id, projectId]);
  useEffect(() => {
    const shortcut = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'toggle-terminal') toggleTerminal();
    };
    window.addEventListener('message', shortcut);
    return () => window.removeEventListener('message', shortcut);
  }, [toggleTerminal]);
  const navigate = useCallback((to: string, prepared?: ConversationView) => {
    const url = new URL('/', location.href);
    if (to !== '/') url.searchParams.set('initialRoute', to);
    if (usesPinnedToolRenderer(to)) {
      url.searchParams.set('workspaceReturn', currentRoute());
      location.assign(url);
      return;
    }
    generation.current++;
    window.history.pushState(null, '', url);
    setFault(undefined); setView(prepared ?? openRoute(to));
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'navigate-to-route' ||
          typeof event.data.path !== 'string') return;
      if (event.data.path === '/' || usesPinnedToolRenderer(event.data.path) || parseWorkspaceThreadRoute(event.data.path)) navigate(event.data.path);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [navigate]);
  const branch = useCallback(async (turnId?: string) => {
    if (!stream || branching.current) return;
    const selected = generation.current;
    branching.current = true;
    setFault(undefined);
    try {
      const thread = await forkConversation(stream.threadId, turnId, stream.hostId);
      if (stream.hostId === 'local') {
        const item: StartupThread = { id: thread.id, projectId: thread.projectId ?? null,
          title: (thread.name?.trim() || thread.preview?.trim().split('\n')[0] || 'New chat').slice(0, 240) };
        unlistedThreads.current.set(thread.id, item);
        setData(data => recentThread(data, item));
      }
      void refreshSidebar(stream.hostId).catch(console.error);
      if (selected === generation.current) navigate(workspaceThreadRoute(stream.hostId, thread.id));
    } catch (error) {
      if (selected === generation.current) setFault(error instanceof WorkspaceRequestError && error.uncertain
        ? 'The host did not confirm the branch. Check the sidebar before trying again.'
        : error instanceof Error ? error.message : String(error));
    } finally { branching.current = false; }
  }, [stream, navigate, refreshSidebar]);
  const saveProject = useCallback((value?: string) => {
    setProject(value ? { type: 'local', projectId: value } : null);
    const selected = generation.current;
    void selectLocalProject(value).catch(error => {
      if (selected === generation.current) setFault(error instanceof Error ? error.message : String(error));
    });
  }, []);
  function chooseProject(value?: string) {
    if (homeDestinationKnown && value === projectId) return;
    generation.current++;
    setFault(undefined);
    saveProject(value);
  }
  async function rename(id: string, name: string, hostId: string) {
    await renameThread(id, name, hostId);
    rememberName(id, name, hostId);
  }
  async function pin(id: string, pinned: boolean, hostId: string) {
    await setThreadPinned(id, pinned, hostId);
    await refreshSidebar(hostId);
  }
  async function archive(id: string, hostId: string) {
    await archiveThread(id, hostId);
    archiveRows(hostId, [id], 0);
  }
  function archiveRows(hostId: string, ids: string[], failed: number) {
    if (failed) setFault(`${failed} ${failed === 1 ? 'chat was' : 'chats were'} not archived. Reopen the project menu to review the remaining chats.`);
    if (!ids.length) return;
    const archived = new Set(ids);
    const removeThread = (previous?: StartupSidebar) => previous && { ...previous, threads: previous.threads.filter(thread => !archived.has(thread.id)),
      pinnedIds: previous.pinnedIds.filter(value => !archived.has(value)) };
    if (hostId === 'local') {
      for (const id of ids) unlistedThreads.current.delete(id);
      setData(removeThread);
    } else setSnapshots(previous => {
      const snapshot = previous.get(hostId);
      return new Map(previous).set(hostId, { ...snapshot, data: removeThread(snapshot?.data) });
    });
    const selected = parseWorkspaceThreadRoute(currentRoute());
    if (selected?.hostId === hostId && archived.has(selected.threadId)) navigate('/');
    void refreshSidebar(hostId).catch(console.error);
  }
  function reportFault(error: unknown) { setFault(error instanceof Error ? error.message : String(error)); }
  async function requestArchive(target: ArchiveTarget, trigger: HTMLElement, approvedTurn?: string) {
    if (archiving.current) return;
    archiving.current = true;
    setConfirmation(undefined);
    try {
      const turnId = await activeTurnBeforeArchive(target.id, target.hostId);
      if (turnId && turnId !== approvedTurn) {
        setConfirmation({ target, turnId, trigger });
        return;
      }
      if (turnId) await interruptTurn(target.id, turnId, target.hostId);
      await archive(target.id, target.hostId);
    } finally { archiving.current = false; }
  }
  const threadSidebar = hostId === 'local' ? data : snapshots.get(hostId)?.data;
  const selectedThread = threadSidebar?.threads.find(thread => thread.id === id);
  const title = route ? names.get(route) ?? page?.thread?.name ?? selectedThread?.title : undefined;
  const threadProject = threadSidebar?.projects.find(project => project.id === (page?.thread?.projectId ?? selectedThread?.projectId));
  const localThreadProjectId = id && hostId === 'local' ? threadProject?.id : undefined;
  useEffect(() => {
    if (data && localThreadProjectId && localThreadProjectId !== projectId) saveProject(localThreadProjectId);
  }, [data, localThreadProjectId, projectId, saveProject]);
  function displayNames(data: StartupSidebar | undefined, hostId: string) {
    if (!data || !names.size) return data;
    return { ...data, threads: data.threads.map(thread => {
      const name = names.get(workspaceThreadRoute(hostId, thread.id));
      return name ? { ...thread, title: name } : thread;
    }) };
  }
  const remotes = hosts.map(host => {
    const snapshot = snapshots.get(host.hostId);
    return { ...host, ...snapshot, data: displayNames(snapshot?.data, host.hostId) };
  });
  function commands(): WorkspaceCommand[] {
    return [
      { key: 'new', label: 'New chat', group: 'Quick actions', icon: <SquarePen size={14} />, run: () => navigate('/') },
      { key: 'standalone', label: 'New standalone chat', group: 'Chat', icon: <SquarePen size={14} />,
        run: () => { chooseProject(undefined); navigate('/'); } },
      { key: 'focus', label: 'Focus main chat', group: 'Navigation', run: () => composer.current?.focus() },
      ...(backEnabled ? [{ key: 'back', label: 'Back', group: 'Navigation', icon: <ArrowLeft size={14} />, run: () => window.history.back() }] : []),
      ...(forwardEnabled ? [{ key: 'forward', label: 'Forward', group: 'Navigation', icon: <ArrowRight size={14} />, run: () => window.history.forward() }] : []),
      { key: 'sidebar', label: 'Toggle sidebar', group: 'Panels', icon: <PanelLeft size={14} />, run: toggleSidebar },
      ...(terminalAvailable ? [{ key: 'terminal', label: 'Open terminal', group: 'Panels', icon: <SquareTerminal size={14} />, run: toggleTerminal }] : []),
      { key: 'scheduled', label: 'Go to scheduled tasks', group: 'Navigation', icon: <CalendarClock size={14} />, run: () => {
        const query = new URLSearchParams({ initialRoute: '/automations' });
        if (route) query.set('workspaceReturn', route);
        location.assign('/?' + query);
      } },
      { key: 'plugins', label: 'Go to skills', group: 'Skills', icon: <AtSign size={14} />, run: () => location.assign(workspacePlugins) },
    ];
  }
  return <div className="yard-source-frame relative flex flex-col _Layout_etoz9_2" data-app-shell-frame="true"
    data-app-shell-sidebar-open={sidebarOpen} data-app-shell-responsive-sidebar="true">
    <header className="yard-source-titlebar" data-app-shell-titlebar="true" data-source-chat={id ? '' : undefined}>
      <button type="button" title="Back" aria-label="Back" disabled={!backEnabled}
        onClick={() => window.history.back()}><WorkspaceIcon name="back" /></button>
      <button type="button" title="Forward" aria-label="Forward" disabled={!forwardEnabled}
        onClick={() => window.history.forward()}><WorkspaceIcon name="back" className="rotate-180" /></button>
      <button type="button" title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        data-app-shell-sidebar-trigger="true" aria-controls="app-shell-sidebar" aria-expanded={sidebarOpen}
        onClick={toggleSidebar}><WorkspaceIcon name={sidebarOpen ? 'sidebar' : 'sidebarClosed'} /></button>
      {id && title && <ThreadTitle key={route} ref={titleControl} name={title} project={threadProject?.label}
        rename={name => rename(id, name, hostId)} />}
    </header>
    <div className="yard-source-body" data-app-shell-workspace-row="true">
      <aside hidden={!sidebarOpen} className="yard-source-sidebar" aria-label="Sidebar">
        <Sidebar data={displayNames(data, 'local')} remotes={remotes} active={route} selectedProjectId={id ? undefined : projectId}
          newChat={nextProject => {
            navigate('/');
            if (nextProject !== undefined) chooseProject(nextProject);
            if (matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
            requestAnimationFrame(() => composer.current?.focus());
          }} rename={rename} updateProject={async (owner, projectId, action) => {
            await updateSidebarProject(owner, projectId, action);
            setProject(current => action.operation === 'remove' && owner === 'local' && current?.type === 'local' && current.projectId === projectId ? null : current);
            await refreshSidebar(owner);
          }}
          pin={pin} archive={requestArchive} projectArchived={archiveRows} connect={connect} select={navigate} loadOlder={loadOlder} commands={commands} />
        <SidebarSplitter />
      </aside>
      <div className="yard-source-workspace" ref={workspace}>
      <McpAppTabs value={id ? mcpAppTabs : null}>
      {id && title && <HeaderChatActions key={'header:' + route} pinned={threadSidebar?.pinnedIds.includes(id) ?? false}
        pending={!!confirmation} rename={() => titleControl.current?.edit()}
        pin={() => void pin(id, !threadSidebar?.pinnedIds.includes(id), hostId).catch(reportFault)} fork={() => void branch()}
        copy={action => void copyChat(action, id, hostId, title, page?.thread?.cwd).catch(reportFault)} hasDirectory={!!page?.thread?.cwd}
        archive={trigger => void requestArchive({ id, hostId, title }, trigger).catch(reportFault)}
        sidechat={sidechats.supportsHost(hostId) ? () => panels.current?.createSidechat() : undefined} />}
      <button type="button" className="yard-source-terminal-toggle" title="Toggle terminal" aria-label="Toggle terminal"
        aria-pressed={terminalSessions.has(terminalKey)} disabled={!terminalAvailable} onClick={toggleTerminal}>
        <WorkspaceIcon name="dock" />
      </button>
      <main className="yard-source-main" data-app-shell-main-content-layout="default">
        <AsyncQuestionsProvider key={route ?? '/'} stream={stream} history={page?.turns}>
        {(fault || historyFault) && <p role="alert">{fault ?? historyFault}</p>}
        {!id && data && !homeDestinationKnown && <p role="status">Choose a project for this chat.</p>}
        {stream ? <WorkspaceOutputLinks value={
          { cwd: page?.thread?.cwd ?? '', open: file => panels.current?.openOutput(file), openPage: url => panels.current?.openPage(url),
            openImages: (images, selectedId) => panels.current?.openImages(images, selectedId, { composer: () => composer.current, stream,
              turns: page?.turns, readHistory: () => imageHistory.current, title }) }}>
          <Transcript key={route} page={page} stream={stream} more={more} branch={branch} openChanges={hostId === 'local' ? openChanges : undefined}
            subagents={subagents} openSubagent={(childId, name) => panels.current?.openSubagent(childId, name)}
            stop={turnId => composer.current?.stop(turnId) ?? Promise.resolve()}
            runMessageEdit={run => composer.current?.runMessageEdit(run) ?? Promise.reject(new Error('The editor is not ready.'))} />
        </WorkspaceOutputLinks> : <HomePendingMessages><div className="yard-source-welcome">
          <div className="relative size-14" data-testid="home-icon" aria-hidden="true" />
          <div className="heading-xl text-center text-default">{project ? <>
            <span className="inline-block max-w-full">What should we work on in <button type="button" popoverTarget={projectMenu}
              aria-haspopup="dialog" className="yard-source-home-project inline-block max-w-full cursor-interaction align-baseline break-words whitespace-normal underline decoration-text-tertiary decoration-dotted decoration-[1px] underline-offset-4 hover:text-secondary">{project.label}?</button></span>
          </> : 'What should we build?'}</div>
        </div></HomePendingMessages>}
        <div className="yard-source-composer">
          <Composer ref={composer} key={route ?? '/'} scope={id ? hostId === 'local' ? id : hostId + ':' + id : 'new-conversation'} label={id ? 'Work with Codex' : 'Do anything'}
            openGoal={(threadId, hostId) => panels.current?.openGoal(threadId, hostId)}
            stream={stream} historyTurns={page?.turns} projectId={id ? undefined : projectId} destinationKnown={!!id || homeDestinationKnown}
            openChanges={id && hostId === 'local' ? openChanges : undefined}
            openQueuedSidechat={id && sidechats.supportsHost(hostId) ? async item => {
              await panels.current?.openQueuedSidechat(item);
            } : undefined}
            projects={id ? undefined : { menuId: projectMenu, options: data?.projects ?? [], selected: project, select: chooseProject }}
            onSend={stream ? page ? async (text, _permission, attachments, clientUserMessageId, options) => {
              const sendingGeneration = generation.current;
              const stillSelected = () => generation.current === sendingGeneration;
              const { turn } = await sendExistingThread(stream.threadId, text, stillSelected, attachments, stream.hostId, clientUserMessageId, options);
              if (stillSelected()) stream.acknowledge(turn);
            } : undefined : homeDestinationKnown ? async (text, permissionChoice, attachments, clientUserMessageId) => {
              const sendingGeneration = generation.current;
              const stillComposing = () => generation.current === sendingGeneration && currentRoute() === '/';
              let prepared: TurnStream | undefined;
              try {
                const { thread, turn } = await sendNewThread(projectId, text, stillComposing, id => {
                  prepared = new TurnStream(id);
                  prepared.connect();
                }, permissionChoice, attachments, clientUserMessageId);
                prepared!.acknowledge(turn);
                const item: StartupThread = { id: thread.id, projectId: thread.projectId ?? projectId ?? null,
                  title: thread.name?.trim() || text.trim().split('\n')[0]!.slice(0, 240) || attachments[0]?.name || thread.preview?.trim() || 'New chat' };
                unlistedThreads.current.set(thread.id, item);
                setData(data => recentThread(data, item));
                return () => {
                  if (!stillComposing()) { prepared!.disconnect(); return; }
                  navigate(workspaceThreadRoute('local', thread.id), { stream: prepared!, seed: { thread, turns: [], nextCursor: null } });
                };
              } catch (error) {
                prepared?.disconnect();
                throw error;
              }
            } : undefined} />
        </div>
        </AsyncQuestionsProvider>
        {[...terminalSessions].map(([key, session]) => <TerminalPanel key={session.sessionId} session={session} visible={key === terminalKey}
          close={() => setTerminalSessions(previous => { const next = new Map(previous); next.delete(key); return next; })} />)}
      </main>
      <HomeTerminal scope={id ? undefined : terminalKey} projectId={projectId} ready={homeDestinationKnown} />
      {id && <ConversationPanels key={route} ref={panels} parentId={id} hostId={hostId} workspace={workspace} cwd={page?.thread?.cwd} turns={page?.turns} stream={stream}
        subagents={subagents}
        attachSource={() => composer.current?.openAttachmentPicker()}
        insertPlugin={plugin => composer.current?.insertPlugin(plugin)}
        openBottomTerminal={() => { if (!terminalSessions.has(terminalKey)) toggleTerminal(); }}
        createOutput={type => composer.current?.appendOutput(type)} />}
      </McpAppTabs>
      </div>
    </div>
    {confirmation && <ArchiveConfirmation title={confirmation.target.title}
      cancel={() => { setConfirmation(undefined); confirmation.trigger.focus({ preventScroll: true }); }}
      accept={() => void requestArchive(confirmation.target, confirmation.trigger, confirmation.turnId).catch(reportFault)} />}
  </div>;
}

const theme = matchMedia('(prefers-color-scheme: dark)');
function syncTheme() {
  document.documentElement.dataset.theme = theme.matches ? 'dark' : 'light';
  // Match the pinned theme provider's default accent; the shared stylesheet's
  // dark fallback (#99ceff) is lighter than the provider's actual #83c3ff.
  document.documentElement.style.setProperty('--app-color-text-accent', theme.matches ? 'rgb(131 195 255)' : 'rgb(51 156 255)');
}
const html = document.documentElement;
const stored = browserAtoms();
const width = stored['sidebar-width'];
if (typeof width === 'number' && Number.isFinite(width)) html.style.setProperty('--yard-source-sidebar-width', Math.max(240, Math.min(520, width)) + 'px');
Object.assign(html.dataset, { codexWindowType: 'electron', windowType: 'electron', codexOs: 'linux', codexWindowChrome: 'application-menu' });
html.style.setProperty('--font-ui-size', '14px');
html.style.setProperty('--text-base', '14px');
html.style.setProperty('--text-sm', '13px');
syncTheme();
theme.addEventListener('change', syncTheme);
createRoot(document.getElementById('root')!).render(<App />);
