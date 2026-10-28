import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadResponse, ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, SubmitAction, SubmitOptions, WorkbenchEvent } from '../workbench-contract.ts';
import { StandaloneComposer } from '../composer/StandaloneComposer.tsx';
import { StandaloneMessages } from '../messages/StandaloneMessages.tsx';
import type { MessageEditRecovery } from '../messages/use-message-editing.ts';
import { StandaloneSettings } from '../settings/StandaloneSettings.tsx';
import { BrowserWorkbenchClient, isServerRequestEvent } from './client.ts';
import { applyThreadEvent, isItemDelta, isThreadBusy } from './thread-state.ts';
import { eventItemKey, loadThread, reconcileThreadSnapshot } from './load-thread.ts';
import { ApprovalDialog } from './ApprovalDialog.tsx';
import type { ServerRequest } from './ApprovalDialog.tsx';
import { submitDraft } from './submission.ts';
import { applyAppearance } from './appearance.ts';
import { sessionOptions } from './session-options.ts';
import { MessageEditRecoveryStore, messageEditChanged, messageEditsAtom } from './message-edit-recovery.ts';
import { projectsForHost, projectForThread } from './projects.ts';
import type { ProjectState } from './projects.ts';
import './app.css';

type ThreadRow = ThreadSummary & { preview?: string; updatedAt?: number; createdAt?: number };
interface Host { hostId: string; displayName: string }
interface Route { pathname: string; search: string; hash: string; state: unknown; threadId: string | null; hostId: string; section: string | null; readOnly: boolean }
function route(): Route {
  const url = new URL(location.href), parts = url.pathname.split('/').filter(Boolean);
  return { pathname: url.pathname, search: url.search, hash: url.hash, state: history.state && Object.hasOwn(history.state, '__yardState') ? history.state.__yardState : history.state,
    threadId: ['local', 'thread'].includes(parts[0] ?? '') ? decodeURIComponent(parts[1] ?? '') || null : null,
    hostId: url.searchParams.get('hostId') ?? url.searchParams.get('host') ?? 'local', section: parts[0] === 'settings' ? parts[1] ?? 'general' : null,
    readOnly: url.searchParams.get('archived') === '1' };
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function title(thread: ThreadRow) { return thread.name || thread.preview || 'New conversation'; }
function saved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T ?? fallback; } catch { return fallback; }
}

export function App({ client }: { client: BrowserWorkbenchClient }) {
  const [current, setCurrent] = useState(route);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamGap, setStreamGap] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [hosts, setHosts] = useState<Host[]>([{ hostId: 'local', displayName: 'Local' }]);
  const [cwd, setCwd] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [sidebar, setSidebar] = useState(() => saved('yard-sidebar-open', true));
  const [tabs, setTabs] = useState<{ id: string; hostId: string; title: string }[]>(() => saved('yard-workspace-tabs', []));
  const [prefill, setPrefill] = useState<{ id: string; draft: ComposerDraft } | null>(null);
  const [requests, setRequests] = useState<ServerRequest[]>([]);
  const [menu, setMenu] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialOptions, setInitialOptions] = useState<SubmitOptions | null>(null);
  const [editRecovery, setEditRecovery] = useState<MessageEditRecovery | null>(null);
  const editStore = useMemo(() => new MessageEditRecoveryStore(client), [client]);
  const [newDraftId, setNewDraftId] = useState(() => {
    try {
      const stored = sessionStorage.getItem('yard-current-new-draft');
      const id = stored || 'new-conversation'; sessionStorage.setItem('yard-current-new-draft', id); return id;
    } catch { return 'new-conversation'; }
  });
  const inFlight = useRef(false);
  const subscription = useRef(Promise.resolve());
  const selectionReady = useRef<{ key: string; resolve(): void; reject(error: Error): void } | null>(null);
  const settingsGuard = useRef<{ requestLeave(): Promise<boolean> } | null>(null);
  const historyIndex = useRef(Number(history.state?.__yardIndex ?? 0));
  const restoringHistory = useRef(false);
  const threadRef = useRef(thread); threadRef.current = thread;
  const routeRef = useRef(current); routeRef.current = current;
  const backFromSettings = useRef('/');
  const projectGeneration = useRef(0);
  const projects = projectState ? projectsForHost(projectState, current.hostId) : [];
  const visibleProjects = projects.length ? projects : current.hostId === 'local' && workspace
    ? [{ id: workspace, name: workspace.split('/').at(-1) || 'Workspace', rootPaths: [workspace], hostId: 'local' }] : [];
  const reloadProjects = useCallback(async () => {
    const generation = ++projectGeneration.current;
    const state = await client.host<ProjectState>('thread-project-state');
    if (generation === projectGeneration.current) setProjectState(state);
  }, [client]);

  const navigate = useCallback((path: string, options?: { replace?: boolean; delta?: number; state?: unknown }) => {
    void (async () => {
      if (settingsGuard.current && !await settingsGuard.current.requestLeave()) return;
      if (options?.delta) { history.go(options.delta); return; }
      if (!options?.replace) historyIndex.current++;
      const state = { __yardIndex: historyIndex.current, __yardState: options?.state ?? null };
      if (options?.replace) history.replaceState(state, '', path); else history.pushState(state, '', path);
      setCurrent(route()); setError(''); setMenu(false);
    })();
  }, []);
  const registerNavigationGuard = useCallback((guard: { requestLeave(): Promise<boolean> } | null) => { settingsGuard.current = guard; }, []);
  const openThread = (id: string, hostId = current.hostId, readOnly = archived) => {
    const search = new URLSearchParams(); if (hostId !== 'local') search.set('hostId', hostId); if (readOnly) search.set('archived', '1');
    navigate(`/local/${encodeURIComponent(id)}${search.size ? '?' + search : ''}`);
  };
  const refreshList = useCallback(async (cursor: string | null = null) => {
    const value = await client.rpc<{ data: ThreadRow[]; nextCursor?: string | null }>('thread/list',
      { limit: 100, cursor, sortKey: 'updated_at', archived }, current.hostId);
    if (routeRef.current.hostId !== current.hostId) return;
    setThreads(previous => cursor ? [...previous, ...value.data.filter(item => !previous.some(old => old.id === item.id))] : value.data);
    setNextCursor(value.nextCursor ?? null);
  }, [client, current.hostId, archived]);
  const reloadPreferences = useCallback(async () => {
    const [{ values }, reduced] = await Promise.all([
      client.host<{ values: Record<string, unknown> }>('get-settings'),
      client.host<{ value?: string }>('get-global-state', { key: 'reduced-motion-preference' }),
    ]);
    const dark = values.appearanceTheme === 'dark' || values.appearanceTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches;
    applyAppearance(values, dark);
    document.documentElement.dataset.reducedMotion = String(reduced.value === 'on' || reduced.value !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.dataset.pointerCursors = String(values.usePointerCursors === true);
  }, [client]);

  useEffect(() => {
    history.replaceState({ __yardIndex: historyIndex.current, __yardState: current.state }, '', location.href);
    const pop = () => {
      if (restoringHistory.current) { restoringHistory.current = false; return; }
      const nextIndex = Number(history.state?.__yardIndex ?? 0), previousIndex = historyIndex.current;
      void (async () => {
        if (settingsGuard.current && !await settingsGuard.current.requestLeave()) {
          if (nextIndex !== previousIndex) { restoringHistory.current = true; history.go(previousIndex - nextIndex); }
          else history.replaceState({ __yardIndex: previousIndex, __yardState: routeRef.current.state }, '', routeRef.current.pathname + routeRef.current.search + routeRef.current.hash);
          return;
        }
        historyIndex.current = nextIndex; setCurrent(route());
      })();
    }; window.addEventListener('popstate', pop);
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'connection-state') { setStatus(String(event.state)); if (event.state !== 'connected') setRequests([]); }
      if (event.type === 'codex-app-server-connection-changed' && event.hostId === routeRef.current.hostId) {
        setStatus(String(event.state)); if (event.state === 'connected') setRefresh(value => value + 1);
      }
      if (event.type === 'codex-app-server-connection-changed' && event.state !== 'connected') setRequests(previous => previous.filter(request => request.hostId !== event.hostId));
      if (event.type === 'shared-object-updated' && event.key === 'remote_ssh_connections' && Array.isArray(event.value)) {
        setHosts([{ hostId: 'local', displayName: 'Local' }, ...event.value as Host[]]);
        void reloadProjects().catch(cause => setError(String(cause)));
      }
      if (event.type === 'protocol-error') setError(String(event.error));
      if (isServerRequestEvent(event)) {
        const request = event.request;
        setRequests(previous => [...previous.filter(item => item.id !== request.id || item.hostId !== event.hostId),
          { ...request, hostId: event.hostId, params: request.params ?? {}, ref: event.requestRef }]);
      }
      if (event.type === 'mcp-notification' && event.method === 'serverRequest/resolved') {
        const params = record(event.params);
        setRequests(previous => previous.filter(request => request.hostId !== event.hostId || request.id !== params.requestId));
      }
      if (event.type === 'settings-changed' || event.type === 'global-state-updated') void reloadPreferences().catch(cause => setError(String(cause)));
      if (event.type === 'thread-project-memberships-updated' || event.type === 'global-state-updated'
        && Array.isArray(event.keys) && event.keys.some(key => ['local-projects', 'remote-projects', 'thread-project-assignments', 'projectless-thread-ids'].includes(String(key)))) {
        void reloadProjects().catch(cause => setError(String(cause)));
      }
    });
    void client.connect().catch(cause => setError((cause as Error).message));
    void fetch('/api/status').then(response => response.json()).then((value: { workspace: string }) => {
      setWorkspace(value.workspace); setCwd(previous => previous || value.workspace);
    }).catch(cause => setError(String(cause)));
    void reloadProjects().catch(cause => setError(String(cause)));
    void reloadPreferences().catch(cause => setError(String(cause)));
    const media = matchMedia('(prefers-color-scheme: dark)'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const preferences = () => { void reloadPreferences().catch(cause => setError(String(cause))); };
    media.addEventListener('change', preferences); reduced.addEventListener('change', preferences);
    return () => { unsubscribe(); window.removeEventListener('popstate', pop); media.removeEventListener('change', preferences); reduced.removeEventListener('change', preferences); };
  }, [client, reloadPreferences, reloadProjects]);
  useEffect(() => { void refreshList().catch(cause => setError((cause as Error).message)); }, [refreshList, refresh]);
  useEffect(() => {
    let generation = 0, active = true;
    const read = () => {
      const revision = ++generation;
      void (current.threadId ? editStore.read(current.hostId, current.threadId) : Promise.resolve(null)).then(value => {
        if (active && revision === generation) setEditRecovery(value?.recovery ?? null);
      }).catch(cause => { if (active && revision === generation) { setEditRecovery(null); setError((cause as Error).message); } });
    };
    read();
    window.addEventListener(messageEditChanged, read);
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(messageEditsAtom))) read();
    });
    return () => { active = false; window.removeEventListener(messageEditChanged, read); unsubscribe(); };
  }, [client, editStore, current.hostId, current.threadId]);
  useEffect(() => {
    localStorage.setItem('yard-sidebar-open', JSON.stringify(sidebar));
  }, [sidebar]);
  useEffect(() => { localStorage.setItem('yard-workspace-tabs', JSON.stringify(tabs)); }, [tabs]);
  useEffect(() => {
    const selectionKey = JSON.stringify([current.hostId, current.threadId]);
    if (selectionReady.current && selectionReady.current.key !== selectionKey) {
      selectionReady.current.reject(new Error('会话已切换，草稿已保留，未发送。')); selectionReady.current = null;
    }
    if (!current.threadId) { setThread(null); setInitialOptions(null); setLoading(false); setStreamGap(false); return; }
    let active = true, reading = false, needsRead = false, hydrated = false, subscribed = false, historyGeneration = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observedItems = new Set<string>();
    const buffered: WorkbenchEvent[] = [];
    setLoading(true); setThread(null); setInitialOptions(null); setStreamGap(false);
    const scheduleRead = () => { needsRead = true; if (!reading && !timer) timer = setTimeout(() => { timer = undefined; void read(); }, 150); };
    const read = async () => {
      if (!active || reading) return;
      const generation = historyGeneration;
      reading = true; needsRead = false;
      try {
        const snapshot = await loadThread(client, current.hostId, current.threadId!);
        if (!active || generation !== historyGeneration) return;
        const events = buffered.splice(0), owned = new Set(observedItems);
        setThread(previous => generation === historyGeneration ? reconcileThreadSnapshot(snapshot, previous, events, owned) : previous);
        hydrated = true;
        setStreamGap(snapshot.thread.turns.some(turn => turn.status === 'inProgress'
          && ![...owned].some(key => key.startsWith(JSON.stringify([turn.id]).slice(0, -1) + ','))));
        setCwd(snapshot.thread.cwd ?? workspace); setLoading(false);
        if (selectionReady.current?.key === selectionKey) { selectionReady.current.resolve(); selectionReady.current = null; }
        setTabs(previous => previous.some(item => item.id === snapshot.thread.id && item.hostId === current.hostId)
          ? previous.map(item => item.id === snapshot.thread.id && item.hostId === current.hostId ? { ...item, title: title(snapshot.thread) } : item)
          : [...previous, { id: snapshot.thread.id, hostId: current.hostId, title: title(snapshot.thread) }]);
      } catch (cause) { if (active && generation === historyGeneration) {
        setLoading(false); setError((cause as Error).message);
        if (selectionReady.current?.key === selectionKey) { selectionReady.current.reject(cause as Error); selectionReady.current = null; }
      } }
      finally { reading = false; if (active && needsRead) scheduleRead(); }
    };
    const unsubscribe = client.subscribe(event => {
      if (event.hostId !== current.hostId || event.type !== 'mcp-notification') return;
      if ((event.params as { threadId?: string } | undefined)?.threadId !== current.threadId) return;
      if (event.method === 'thread/settings/updated') {
        const settings = record(event.params).threadSettings as ThreadSettingsResponse & { effort?: string | null; sandboxPolicy?: ThreadSettingsResponse['sandbox'] };
        setInitialOptions(sessionOptions({ ...settings, reasoningEffort: settings.effort, sandbox: settings.sandboxPolicy }));
      }
      const key = eventItemKey(event);
      if (event.method === 'item/started' && key) { observedItems.add(key); setStreamGap(false); }
      if (event.method === 'thread/reverted') { historyGeneration++; buffered.length = 0; observedItems.clear(); setThread(null); hydrated = false; scheduleRead(); return; }
      if (isItemDelta(event) && !observedItems.has(key ?? '')) setStreamGap(true);
      if (reading || !hydrated) buffered.push(event);
      else setThread(previous => previous ? applyThreadEvent(previous, event) : previous);
      if (event.method === 'turn/completed') scheduleRead();
      if (['thread/name/updated', 'thread/archived', 'thread/unarchived'].includes(String(event.method))) {
        void refreshList().catch(cause => setError(String(cause)));
      }
    });
    const ready = subscription.current.catch(() => {}).then(async () => {
      if (!active || current.readOnly) return;
      const resumed = await client.rpc<ThreadResponse>('thread/resume', { threadId: current.threadId!, excludeTurns: true }, current.hostId);
      if (active) setInitialOptions(sessionOptions(resumed));
      subscribed = true;
    });
    subscription.current = ready.catch(() => {});
    void ready.then(read).catch(cause => { if (active) {
      setLoading(false); setError((cause as Error).message);
      if (selectionReady.current?.key === selectionKey) { selectionReady.current.reject(cause as Error); selectionReady.current = null; }
    } });
    return () => {
      active = false; clearTimeout(timer); unsubscribe();
      subscription.current = subscription.current.catch(() => {}).then(async () => {
        if (subscribed && client.connected) await client.rpc('thread/unsubscribe', { threadId: current.threadId! }, current.hostId);
      }).catch(() => {});
    };
  }, [client, current.hostId, current.threadId, current.readOnly, refresh]);

  const submit = async (draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, origin?: MessageEditOrigin) => {
    if (inFlight.current) throw new Error('正在提交，请稍候。');
    if (loading) throw new Error('会话仍在加载，请稍候。');
    inFlight.current = true; setSubmitting(true); setError('');
    try {
      const hostId = current.hostId;
      const result = await submitDraft(client, { hostId, threadId: current.threadId, cwd: thread?.cwd || cwd || workspace,
        activeTurnId: thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null, readOnly: current.readOnly, thread },
      draft, options, action, created => new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('会话加载超时，输入未发送，草稿已保留。')), 60_000);
        selectionReady.current = { key: JSON.stringify([hostId, created.id]), resolve: () => { clearTimeout(timeout); resolve(); },
          reject: error => { clearTimeout(timeout); reject(error); } };
        openThread(created.id, hostId, false);
      }), origin, (target, expected, params) => editStore.submit(target, expected, params));
      if (result.turn) setThread(previous => previous?.id === result.threadId && routeRef.current.hostId === hostId
        ? applyThreadEvent(previous, { type: 'mcp-notification', method: 'turn/started', params: { threadId: result.threadId, turn: result.turn } }) : previous);
      void refreshList().catch(cause => setError(String(cause)));
    } finally { inFlight.current = false; setSubmitting(false); }
  };
  const interrupt = async () => {
    const active = threadRef.current?.turns?.find(turn => turn.status === 'inProgress');
    if (!current.threadId || !active) return;
    await client.rpc('turn/interrupt', { threadId: current.threadId, turnId: active.id }, current.hostId);
  };
  const action = async (name: string) => {
    setMenu(false); if (!current.threadId) return;
    try {
      if (name === 'rename') {
        const value = prompt('Conversation name', thread?.name ?? ''); if (value == null) return;
        await client.rpc('thread/name/set', { threadId: current.threadId, name: value }, current.hostId);
      } else if (name === 'fork') {
        const value = await client.rpc<{ thread: ThreadSummary }>('thread/fork', { threadId: current.threadId }, current.hostId); openThread(value.thread.id);
      } else if (name === 'archive') {
        await client.rpc('thread/archive', { threadId: current.threadId }, current.hostId); navigate('/');
      } else if (name === 'copy') await navigator.clipboard.writeText(location.href);
      await refreshList(); setRefresh(value => value + 1);
    } catch (cause) { setError((cause as Error).message); }
  };
  const respond = async (request: typeof requests[number], result: unknown) => {
    await client.reply(request.ref, { result }); setRequests(previous => previous.filter(item => item !== request));
  };
  const filtered = threads.filter(item => `${title(item)} ${item.cwd ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const newChat = (nextCwd = cwd) => {
    const id = crypto.randomUUID();
    try { sessionStorage.setItem('yard-current-new-draft', id); } catch { /* Composer reports persistence errors. */ }
    setNewDraftId(id); setCwd(nextCwd); navigate('/' + (current.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(current.hostId)));
  };
  const settings = current.section !== null;
  const busy = submitting || isThreadBusy(thread);

  return <div className="yard-app" data-sidebar-open={sidebar} data-owned-renderer="true">
    {sidebar && <aside id="app-shell-sidebar" className="yard-sidebar" aria-label="Sidebar">
      <div className="yard-sidebar-brand"><img src="/brand/icon.svg" alt="" />Codex Yard<button aria-label="Close sidebar" onClick={() => setSidebar(false)}>◧</button></div>
      <button className="yard-new-chat" onClick={() => newChat()}>＋ New chat</button>
      <input type="search" aria-label="Search conversations" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="yard-project-header">Projects<button aria-label="Add project" onClick={() => {
        const path = prompt('Project directory'); if (!path) return;
        const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
        const local = current.hostId === 'local';
        const key = local ? 'local-projects' : 'remote-projects';
        const locationAtStart = current.pathname + current.search + current.hash;
        void client.host<{ value?: unknown }>('get-global-state', { key }).then(async ({ value }) => {
          if (local && value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))
            || !local && value !== undefined && !Array.isArray(value)) throw new Error('项目目录格式无效，原值已保留。');
          const next = local ? { ...record(value), [path]: { ...record(record(value)[path]), id: path, name, rootPaths: [path] } }
            : [...(value as unknown[] ?? []), { id: crypto.randomUUID(), hostId: current.hostId, label: name, remotePath: path }];
          await client.host('set-global-state', { key, value: next }); await reloadProjects();
          if (routeRef.current.pathname + routeRef.current.search + routeRef.current.hash === locationAtStart) newChat(path);
        }).catch(cause => setError(String(cause)));
      }}>＋</button></div>
      <div className="yard-sidebar-scroll">
        {visibleProjects.map(project => <details key={project.id} open>
          <summary><button onClick={() => newChat(project.rootPaths[0] ?? cwd)}>▱ {project.name}</button><button aria-label={'New chat in ' + project.name} onClick={() => newChat(project.rootPaths[0] ?? cwd)}>＋</button></summary>
          {filtered.filter(item => projectForThread(projectState, visibleProjects, current.hostId, item)?.id === project.id).map(item => <button className="yard-thread-row" aria-current={current.threadId === item.id ? 'page' : undefined} key={item.id} onClick={() => openThread(item.id)} title={title(item)}>{item.status?.type === 'active' ? '◌ ' : ''}{title(item)}</button>)}
        </details>)}
        <div className="yard-project-header">Recents</div>
        {projectState && (!projectState.inventory.complete || Object.keys(projectState.unresolved.assignments).length > 0 || projectState.unresolved.qualified.length > 0) && <p className="yard-muted" role="status">部分旧项目归属尚无法确定，原记录已保留。<button onClick={() => { void reloadProjects().catch(cause => setError(String(cause))); }}>Retry project lookup</button></p>}
        {filtered.filter(item => !projectForThread(projectState, visibleProjects, current.hostId, item)).map(item => <button className="yard-thread-row" aria-current={current.threadId === item.id ? 'page' : undefined} key={item.id} onClick={() => openThread(item.id)}>{title(item)}</button>)}
        {nextCursor && <button onClick={() => { void refreshList(nextCursor).catch(cause => setError(String(cause))); }}>Load more</button>}
        {!filtered.length && <p className="yard-muted">{search ? 'No matching conversations' : 'No conversations yet'}</p>}
      </div>
      <footer><button onClick={() => setArchived(value => !value)}>{archived ? 'Show recent chats' : 'Archived chats'}</button><button onClick={() => { backFromSettings.current = location.pathname + location.search; navigate('/settings/general'); }}>⚙ Settings</button></footer>
    </aside>}
    <main className="yard-main">
      <header className="yard-toolbar"><button aria-label="Toggle sidebar" onClick={() => setSidebar(value => !value)}>◧</button>
        <div className="yard-tab-strip" role="tablist" aria-label="Workspace tabs">{tabs.map(tab => <div className="yard-tab" key={tab.hostId + ':' + tab.id}><button role="tab" aria-selected={tab.id === current.threadId && tab.hostId === current.hostId} onClick={() => openThread(tab.id, tab.hostId)}>{tab.title}</button><button aria-label={'Close ' + tab.title} onClick={() => setTabs(previous => previous.filter(item => item !== tab))}>×</button></div>)}</div>
        <select aria-label="Execution host" value={current.hostId} onChange={event => navigate('/?hostId=' + encodeURIComponent(event.target.value))}>{hosts.map(host => <option key={host.hostId} value={host.hostId}>{host.displayName}</option>)}</select>
        <span className="yard-connection" title={status} data-state={status}>●</span>
      </header>
      {error && <div role="alert" className="yard-error">{error}<button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {settings ? <StandaloneSettings client={client} hostId={current.hostId} location={{ pathname: current.pathname, search: current.search, hash: current.hash, state: current.state }} onNavigate={navigate} registerNavigationGuard={registerNavigationGuard} onClose={() => navigate(backFromSettings.current)} /> : <>
        {current.threadId && <header className="yard-conversation-header"><strong>{thread?.name || threads.find(item => item.id === current.threadId)?.name || 'Conversation'}</strong><span>{thread?.cwd}</span><button aria-label="Conversation menu" onClick={() => setMenu(value => !value)}>•••</button>{menu && <div className="yard-menu" role="menu">{['rename', 'fork', 'copy', 'archive'].map(name => <button role="menuitem" key={name} onClick={() => { void action(name); }}>{name === 'copy' ? 'Copy conversation link' : name[0]!.toUpperCase() + name.slice(1)}</button>)}</div>}</header>}
        <section className={'yard-conversation ' + (!current.threadId ? 'yard-home' : '')}>
          {streamGap && <p role="status" className="yard-stream-gap">任务正在运行。此页面未收到完整的活动内容；完成后将重新读取完整记录。</p>}
          {loading ? <div role="status" className="yard-loading">Loading conversation…</div> : current.threadId ? <StandaloneMessages client={client} hostId={current.hostId} thread={thread} editRecovery={editRecovery}
            onEditDraftChange={(value, origin, version) => editStore.save(value, origin, version)}
            onEdit={current.readOnly ? undefined : (draft, origin) => submit(draft, initialOptions ?? {}, { type: 'send' }, origin)} onFork={() => { void action('fork'); }} /> : <div className="yard-home-heading"><img src="/brand/icon.svg" alt="" /><h1>What would you like to work on?</h1><p>{cwd || workspace}</p></div>}
        </section>
        <div className="yard-composer-container">{current.readOnly ? <p role="status">此会话已归档。<button onClick={() => { void client.rpc('thread/unarchive', { threadId: current.threadId }, current.hostId).then(() => openThread(current.threadId!, current.hostId, false)).catch(cause => setError(String(cause))); }}>Restore conversation</button></p> : current.threadId && (loading || !initialOptions) ? <p role="status">Loading session settings…</p> : <StandaloneComposer key={current.hostId + ':' + (current.threadId ?? newDraftId)} client={client} context={{ hostId: current.hostId, threadId: current.threadId, cwd: thread?.cwd ?? cwd, draftId: current.threadId ?? newDraftId }} initialOptions={initialOptions ?? undefined} hosts={hosts} onTargetChange={target => {
          setCwd(target.cwd); navigate('/' + (target.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(target.hostId)));
        }} onPrefillConsumed={id => setPrefill(previous => previous?.id === id ? null : previous)} activeTurnId={thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null} busy={busy} onSubmit={submit} onInterrupt={interrupt} prefill={prefill} onStartQueued={async queuedSubmissionId => {
          if (!current.threadId || current.readOnly || inFlight.current || isThreadBusy(threadRef.current)) throw new Error('当前会话暂时无法启动队列。');
          inFlight.current = true; setSubmitting(true);
          try { await subscription.current; await client.rpc('thread/queue/start', { threadId: current.threadId, queuedSubmissionId }, current.hostId); }
          finally { inFlight.current = false; setSubmitting(false); }
        }} />}</div>
      </>}
    </main>
    {requests[0] && <ApprovalDialog key={requests[0].ref.generation + ':' + requests[0].id} request={requests[0]} onRespond={result => respond(requests[0]!, result)} onUnsupported={async () => {
      const request = requests[0]!; await client.reply(request.ref, { error: { code: -32601, message: '当前 Web 宿主不支持此请求。' } }); setRequests(previous => previous.filter(item => item !== request));
    }} />}
  </div>;
}
