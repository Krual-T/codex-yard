import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadResponse, ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, SubmitAction, SubmitOptions, WorkbenchEvent } from '../workbench-contract.ts';
import { StandaloneComposer, bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerSubmissionDescription } from '../composer/StandaloneComposer.tsx';
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
import { projectsForHost } from './projects.ts';
import type { Project, ProjectState } from './projects.ts';
import { StandaloneSidebar } from '../sidebar/StandaloneSidebar.tsx';
import { useThreadList } from '../sidebar/use-thread-list.ts';
import { WorkspacePanels } from '../panels/WorkspacePanels.tsx';
import type { WorkspacePanelAppearance, WorkspacePanelRequest } from '../panels/WorkspacePanels.tsx';
import { resolveFilePath } from '../files/file-service.ts';
import { createRouteNavigation } from './route-navigation.ts';
import { SendRecoveryStore, sendsAtom, sendThreadKey } from './send-recovery.ts';
import type { SendIntent, SendRecoverySnapshot } from './send-recovery.ts';
import { SendRecoveryNotice } from './SendRecoveryNotice.tsx';
import { StandaloneBrowser } from '../browser/index.tsx';
import { browserOwnerKey } from '../browser/comments.ts';
import { acknowledgeSubmittedBrowserReferences, browserDraftOwner, removeBrowserDraftReference } from './browser-draft.ts';
import { StandaloneVisualization, readVisualizationModelContext } from '../visualizations/index.tsx';
import { homeDraftIdentity, selectHomeDraftIdentity } from './home-draft-identity.ts';
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
function newDraftLocation(hostId: string, draftId: string): { cwd?: string; projectId?: string } {
  try { return record(JSON.parse(sessionStorage.getItem('yard-new-draft-location:' + JSON.stringify([hostId, draftId])) ?? '{}')); }
  catch { return {}; }
}
function rememberNewDraftLocation(hostId: string, draftId: string, cwd: string, projectId?: string) {
  sessionStorage.setItem('yard-new-draft-location:' + JSON.stringify([hostId, draftId]), JSON.stringify({ cwd, projectId }));
}

export function App({ client }: { client: BrowserWorkbenchClient }) {
  const [current, setCurrent] = useState(route);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [thread, setThread] = useState<ThreadSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyComplete, setHistoryComplete] = useState(false);
  const [streamGap, setStreamGap] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [hosts, setHosts] = useState<Host[]>([{ hostId: 'local', displayName: 'Local' }]);
  const [cwd, setCwd] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [sidebar, setSidebar] = useState(() => saved('yard-sidebar-open', true));
  const [tabs, setTabs] = useState<{ id: string; hostId: string; title: string; readOnly?: boolean }[]>(() => saved('yard-workspace-tabs', []));
  const list = useThreadList(client, { hostId: current.hostId, archived, search, refreshKey: refresh });
  const threads = list.rows;
  const listRef = useRef(list); listRef.current = list;
  const [prefills, setPrefills] = useState<Record<string, { id: string; draft: ComposerDraft }[]>>({});
  const [requests, setRequests] = useState<ServerRequest[]>([]);
  const [menu, setMenu] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [initialOptions, setInitialOptions] = useState<SubmitOptions | null>(null);
  const [editRecovery, setEditRecovery] = useState<MessageEditRecovery | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelKind, setPanelKind] = useState<'workspace' | 'browser' | 'visualization'>('workspace');
  const [browserMounted, setBrowserMounted] = useState(false);
  const [browserNavigation, setBrowserNavigation] = useState<{ id: string; url: string } | null>(null);
  const [visualization, setVisualization] = useState<{ hostId: string; threadId: string; path: string } | null>(null);
  const [previewAppearance, setPreviewAppearance] = useState<{ theme: 'dark' | 'light'; variables: Record<string, string>; locale: string }>({ theme: 'dark', variables: {}, locale: 'en' });
  const [panelRequest, setPanelRequest] = useState<WorkspacePanelRequest | null>(null);
  const [panelAppearance, setPanelAppearance] = useState<WorkspacePanelAppearance>({ theme: 'dark', codeFontSize: 12, codeLineHeight: 18 });
  const panelsDirty = useRef(false);
  const editStore = useMemo(() => new MessageEditRecoveryStore(client), [client]);
  const sendStore = useMemo(() => new SendRecoveryStore(client), [client]);
  const [sendState, setSendState] = useState<SendRecoverySnapshot | null>(null);
  const composerController = useRef<ComposerDraftController | null>(null);
  const receiveComposerController = useCallback((controller: ComposerDraftController | null) => { composerController.current = controller; }, []);
  const sendReadGeneration = useRef(0);
  const reloadSends = useCallback(async () => {
    const generation = ++sendReadGeneration.current;
    const state = await sendStore.read();
    for (const receipt of Object.values(state.creations)) await bindComposerDraftToThread(receipt.owner, receipt.thread.id);
    if (generation === sendReadGeneration.current) {
      // At startup no composer is mounted; after navigation its old home owner
      // has been flushed. Rotate only the home pointer, never the retained draft.
      if (routeRef.current.threadId || !composerController.current) {
        const hostId = routeRef.current.hostId, before = homeDraftIdentity(hostId), next = homeDraftIdentity(hostId, state.bindings);
        if (next !== before) {
          const location = newDraftLocation(hostId, before);
          if (location.cwd) rememberNewDraftLocation(hostId, next, location.cwd, location.projectId);
          setHomeGeneration(value => value + 1);
        }
      }
      setSendState(state);
    }
    return state;
  }, [sendStore]);
  const [homeGeneration, setHomeGeneration] = useState(0);
  const newDraftId = useMemo(() => homeDraftIdentity(current.hostId), [current.hostId, homeGeneration]);
  const inFlight = useRef(false);
  const subscription = useRef(Promise.resolve());
  const selectionReady = useRef<{ key: string; resolve(): void; reject(error: Error): void } | null>(null);
  const createdThreads = useRef(new Map<string, { thread: ThreadSummary; settings: ThreadSettingsResponse }>());
  const settingsGuard = useRef<{ requestLeave(): Promise<boolean> } | null>(null);
  const navigation = useRef<ReturnType<typeof createRouteNavigation> | null>(null);
  const navigationGeneration = useRef(0);
  const threadRef = useRef(thread); threadRef.current = thread;
  const routeRef = useRef(current); routeRef.current = current;
  const backFromSettings = useRef('/');
  const projectGeneration = useRef(0);
  const reloadProjects = useCallback(async () => {
    const generation = ++projectGeneration.current;
    const state = await client.host<ProjectState>('thread-project-state');
    if (generation === projectGeneration.current) setProjectState(state);
  }, [client]);

  const navigate = useCallback((path: string, options?: { replace?: boolean; delta?: number; state?: unknown }) => {
    navigationGeneration.current++;
    return navigation.current?.navigate(path, options) ?? Promise.resolve(false);
  }, []);
  const registerNavigationGuard = useCallback((guard: { requestLeave(): Promise<boolean> } | null) => { settingsGuard.current = guard; }, []);
  const openThread = (id: string, hostId = current.hostId, readOnly = false) => {
    const search = new URLSearchParams(); if (hostId !== 'local') search.set('hostId', hostId); if (readOnly) search.set('archived', '1');
    return navigate(`/local/${encodeURIComponent(id)}${search.size ? '?' + search : ''}`);
  };
  const refreshList = useCallback(() => listRef.current.refresh(), []);
  const reloadPreferences = useCallback(async () => {
    const [{ values }, reduced] = await Promise.all([
      client.host<{ values: Record<string, unknown> }>('get-settings'),
      client.host<{ value?: string }>('get-global-state', { key: 'reduced-motion-preference' }),
    ]);
    const dark = values.appearanceTheme === 'dark' || values.appearanceTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = applyAppearance(values, dark);
    const codeFontSize = typeof values.codeFontSize === 'number' && Number.isFinite(values.codeFontSize) ? values.codeFontSize : 12;
    setPanelAppearance({ theme: resolved.mode, codeFontSize, codeLineHeight: codeFontSize * 1.5,
      codeFontFamily: resolved.theme.fonts.code ? JSON.stringify(resolved.theme.fonts.code) : undefined });
    const style = document.documentElement.style;
    setPreviewAppearance({ theme: resolved.mode, locale: document.documentElement.lang,
      variables: { ...Object.fromEntries(Array.from(style).filter(name => name.startsWith('--')).map(name => [name, style.getPropertyValue(name)])),
        '--viz-bg': resolved.theme.surface, '--viz-text': resolved.theme.ink, '--viz-accent': resolved.theme.accent,
        '--viz-panel': style.getPropertyValue('--yard-panel'), '--viz-border': style.getPropertyValue('--yard-border'), '--viz-muted': style.getPropertyValue('--yard-muted') } });
    document.documentElement.dataset.reducedMotion = String(reduced.value === 'on' || reduced.value !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.dataset.pointerCursors = String(values.usePointerCursors === true);
  }, [client]);

  useEffect(() => {
    const controller = createRouteNavigation(() => { navigationGeneration.current++; setLeaving(false); setCurrent(route()); setError(''); setMenu(false); }, async () => {
      setLeaving(true);
      let accepted = false;
      try {
        const composer = composerController.current, snapshot = composer?.snapshot();
        if (snapshot && !await composer!.flush(snapshot.owner)) return false;
        if (settingsGuard.current && !await settingsGuard.current.requestLeave()) return false;
        accepted = !panelsDirty.current || window.confirm('Keep unsaved file changes and switch pages?');
        return accepted;
      } catch (cause) { setError(String(cause)); return false; }
      finally { if (!accepted) setLeaving(false); }
    });
    navigation.current = controller;
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'connection-state') { setStatus(String(event.state)); if (event.state !== 'connected') setRequests([]); }
      if (event.type === 'page-resumed') {
        setRefresh(value => value + 1);
        void reloadProjects().catch(cause => setError(String(cause)));
        void reloadPreferences().catch(cause => setError(String(cause)));
      }
      if (event.type === 'codex-app-server-connection-changed' && event.hostId === routeRef.current.hostId) {
        setStatus(String(event.state)); if (event.state === 'connected') setRefresh(value => value + 1);
      }
      if (event.type === 'codex-app-server-connection-changed' && event.state !== 'connected') setRequests(previous => previous.filter(request => request.hostId !== event.hostId));
      if (event.type === 'shared-object-updated' && event.key === 'remote_ssh_connections' && Array.isArray(event.value)) {
        setHosts([{ hostId: 'local', displayName: 'Local' }, ...event.value as Host[]]);
        void reloadProjects().catch(cause => setError(String(cause)));
      }
      if (event.type === 'protocol-error') setError(String(event.error));
      if (event.type === 'mcp-notification' && ['thread/archived', 'thread/unarchived'].includes(String(event.method))) {
        navigationGeneration.current++;
        const id = record(event.params).threadId;
        const readOnly = event.method === 'thread/archived';
        setTabs(previous => previous.map(tab => tab.hostId === event.hostId && tab.id === id ? { ...tab, readOnly } : tab));
        setCurrent(previous => previous.hostId === event.hostId && previous.threadId === id ? { ...previous, readOnly } : previous);
        void refreshList();
      }
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
    return () => { unsubscribe(); controller.dispose(); if (navigation.current === controller) navigation.current = null; media.removeEventListener('change', preferences); reduced.removeEventListener('change', preferences); };
  }, [client, reloadPreferences, reloadProjects]);
  useEffect(() => {
    let active = true;
    const read = () => { void reloadSends().catch(cause => { if (active) setError(String(cause)); }); };
    read();
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(sendsAtom))) read();
    });
    return () => { active = false; sendReadGeneration.current++; unsubscribe(); };
  }, [client, reloadSends]);
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
  useEffect(() => {
    if (current.threadId) return;
    const location = newDraftLocation(current.hostId, newDraftId);
    setCwd(typeof location.cwd === 'string' ? location.cwd : workspace);
    setSelectedProject(projectState && location.projectId
      ? projectsForHost(projectState, current.hostId).find(project => project.id === location.projectId) ?? null : null);
  }, [current.threadId, current.hostId, newDraftId, projectState, workspace]);
  useEffect(() => { localStorage.setItem('yard-workspace-tabs', JSON.stringify(tabs)); }, [tabs]);
  useEffect(() => {
    const selectionKey = JSON.stringify([current.hostId, current.threadId]);
    if (selectionReady.current && selectionReady.current.key !== selectionKey) {
      selectionReady.current.reject(new Error('会话已切换，草稿已保留，未发送。')); selectionReady.current = null;
    }
    if (!current.threadId) { setThread(null); setInitialOptions(null); setLoading(false); setStreamGap(false); setHistoryComplete(false); return; }
    if (!sendState) { setLoading(true); return; }
    let active = true, reading = false, needsRead = false, hydrated = false, subscribed = false, historyGeneration = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observedItems = new Set<string>();
    const buffered: WorkbenchEvent[] = [];
    setLoading(true); setThread(null); setInitialOptions(null); setStreamGap(false); setHistoryComplete(false);
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
        createdThreads.current.delete(selectionKey); setHistoryComplete(true);
        setStreamGap(snapshot.thread.turns.some(turn => turn.status === 'inProgress'
          && ![...owned].some(key => key.startsWith(JSON.stringify([turn.id]).slice(0, -1) + ','))));
        setCwd(snapshot.thread.cwd ?? workspace); setLoading(false);
        if (selectionReady.current?.key === selectionKey) { selectionReady.current.resolve(); selectionReady.current = null; }
        setTabs(previous => previous.some(item => item.id === snapshot.thread.id && item.hostId === current.hostId)
          ? previous.map(item => item.id === snapshot.thread.id && item.hostId === current.hostId ? { ...item, title: title(snapshot.thread), readOnly: current.readOnly } : item)
          : [...previous, { id: snapshot.thread.id, hostId: current.hostId, title: title(snapshot.thread), readOnly: current.readOnly }]);
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
      if (event.method === 'thread/reverted') { historyGeneration++; buffered.length = 0; observedItems.clear(); setThread(null); setHistoryComplete(false); hydrated = false; scheduleRead(); return; }
      if (event.method === 'turn/started' || event.method === 'turn/completed') setHistoryComplete(false);
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
      const created = createdThreads.current.get(selectionKey);
      if (created) {
        hydrated = true; subscribed = true;
        setThread(created.thread); setInitialOptions(sessionOptions(created.settings));
        setCwd(created.thread.cwd); setLoading(false);
        setTabs(previous => previous.some(tab => tab.hostId === current.hostId && tab.id === created.thread.id)
          ? previous : [...previous, { id: created.thread.id, hostId: current.hostId, title: title(created.thread), readOnly: false }]);
        if (selectionReady.current?.key === selectionKey) { selectionReady.current.resolve(); selectionReady.current = null; }
        return;
      }
      try {
        const resumed = await client.rpc<ThreadResponse>('thread/resume', { threadId: current.threadId!, excludeTurns: true }, current.hostId);
        if (active) setInitialOptions(sessionOptions(resumed));
        subscribed = true;
      } catch (cause) {
        // A persisted actual creation receipt identifies this one incomplete
        // first-turn phase. Other history errors remain errors, never empty data.
        const known = (await sendStore.read()).creations[selectionKey];
        if (!known || !(cause instanceof Error) || !cause.message.includes('list_turns is not supported yet')) throw cause;
        const metadata = await client.rpc<ThreadResponse>('thread/read', { threadId: current.threadId!, includeTurns: false }, current.hostId);
        if (!active) return;
        hydrated = true; setThread(metadata.thread); setCwd(metadata.thread.cwd);
        setInitialOptions(known.settings); setLoading(false); setHistoryComplete(false);
        setError('新会话尚未形成首轮历史。草稿已保留，未自动发送。');
      }
    });
    subscription.current = ready.catch(() => {});
    void ready.then(() => { if (!hydrated) return read(); }).catch(cause => { if (active) {
      setLoading(false); setError((cause as Error).message);
      if (selectionReady.current?.key === selectionKey) { selectionReady.current.reject(cause as Error); selectionReady.current = null; }
    } });
    return () => {
      active = false; clearTimeout(timer); unsubscribe();
      subscription.current = subscription.current.catch(() => {}).then(async () => {
        if (subscribed && client.connected) await client.rpc('thread/unsubscribe', { threadId: current.threadId! }, current.hostId);
      }).catch(() => {});
    };
  }, [client, current.hostId, current.threadId, current.readOnly, refresh, sendState !== null, sendStore]);

  const finishSend = async (intent: SendIntent) => {
    await acknowledgeSubmittedBrowserReferences(intent, composerController.current, (await sendStore.read()).bindings);
    await clearComposerDraftRevision(intent.owner, intent.revision);
    await sendStore.dismiss(intent.id, intent);
    await reloadSends();
  };
  const submit = async (draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, origin?: MessageEditOrigin,
    description?: ComposerSubmissionDescription, retry?: SendIntent) => {
    if (inFlight.current) throw new Error('正在提交，请稍候。');
    if (loading) throw new Error('会话仍在加载，请稍候。');
    inFlight.current = true; setSubmitting(true); setError('');
    let intent = retry;
    let expectedNavigation = navigationGeneration.current;
    const hostId = current.hostId;
    const activeCwd = retry?.cwd ?? (thread?.cwd || cwd || workspace);
    const requireCurrent = (threadId: string | null) => {
      if (navigationGeneration.current !== expectedNavigation || routeRef.current.hostId !== hostId || routeRef.current.threadId !== threadId) {
        throw Object.assign(new Error('会话已切换，原输入未发送并已保留。'), { uncertain: false });
      }
    };
    try {
      const additionalContext = retry?.additionalContext ?? (!origin && current.threadId && action.type !== 'queue'
        ? Object.fromEntries((await readVisualizationModelContext(client, hostId, current.threadId)).map(value =>
          ['visualization:' + JSON.stringify([value.path, value.field]), { kind: 'untrusted' as const, value: JSON.stringify(value) }])) : undefined);
      requireCurrent(current.threadId);
      if (action.type === 'send' && !origin) {
        if (!description || description.owner.hostId !== hostId || (retry ? retry.threadId : description.owner.threadId) !== current.threadId) {
          throw new Error('提交草稿身份已改变，未发送。');
        }
        if (!retry) {
          const stored = await readComposerDraft(description.owner, description.revision);
          if (!stored || JSON.stringify(stored.draft) !== JSON.stringify(draft)) throw new Error('原提交版本未能核对，未发送。');
          requireCurrent(current.threadId);
          intent = await sendStore.prepare(description, activeCwd, draft, options, description.overrides,
            selectedProject?.hostId === hostId ? selectedProject.id : undefined, additionalContext);
        } else {
          const latest = (await sendStore.read()).requests[retry.id];
          if (!latest || !['prepared', 'ready', 'failed'].includes(latest.stage)) throw new Error('原发送结果尚未核对，未重复发送。');
        }
        await reloadSends();
      }
      const assignCreatedProject = async (threadId: string) => {
        if (!intent?.projectId) return;
        const state = await client.host<ProjectState>('thread-project-state');
        if (!projectsForHost(state, hostId).some(project => project.id === intent!.projectId)) throw new Error('原选择的项目已改变，输入已保留，请核对项目。');
        await client.host('thread-projects', { operation: 'setMembership', value: { hostId, threadId, projectless: false,
          assignment: hostId === 'local' ? { projectKind: 'local', projectId: intent.projectId }
            : { projectKind: 'remote', projectId: intent.projectId, hostId } } });
        await reloadProjects();
      };
      if (retry?.created && retry.threadId) await assignCreatedProject(retry.threadId);
      const result = await submitDraft(client, { hostId, threadId: current.threadId, cwd: activeCwd, initialOptions: initialOptions ?? undefined,
        overrides: description?.overrides, additionalContext: intent?.additionalContext ?? additionalContext,
        ...(intent ? { send: { clientUserMessageId: intent.clientUserMessageId,
          creating: async () => { requireCurrent(null); await sendStore.creating(intent!.id); },
          created: async (created: ThreadSummary, settings: ThreadSettingsResponse) => {
            await sendStore.created(intent!.id, created.id, { thread: created, settings: sessionOptions(settings) });
            const controller = composerController.current, snapshot = controller?.snapshot();
            if (snapshot?.owner.hostId === intent!.owner.hostId && snapshot.owner.draftId === intent!.owner.draftId && snapshot.owner.threadId === null) {
              if (!await controller!.flush(snapshot.owner)) throw new Error('原草稿已改变，已保留创建回执，未发送输入。');
            }
            await bindComposerDraftToThread(intent!.owner, created.id);
            await reloadSends();
          },
          sending: async () => {
            const target = (await sendStore.read()).requests[intent!.id]?.threadId ?? null;
            requireCurrent(target); await sendStore.sending(intent!.id);
          },
          confirmed: async (turnId: string) => { await sendStore.confirmed(intent!.id, turnId); },
        } } : {}),
        activeTurnId: thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null, readOnly: current.readOnly, thread },
      draft, options, action, async (created, settings) => {
        createdThreads.current.set(JSON.stringify([hostId, created.id]), { thread: created, settings });
        await assignCreatedProject(created.id);
        requireCurrent(null);
        await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('会话加载超时，输入未发送，草稿已保留。')), 60_000);
        selectionReady.current = { key: JSON.stringify([hostId, created.id]), resolve: () => { clearTimeout(timeout); resolve(); },
          reject: error => { clearTimeout(timeout); reject(error); } };
        void openThread(created.id, hostId, false).then(accepted => {
          if (!accepted && selectionReady.current?.key === JSON.stringify([hostId, created.id])) {
            selectionReady.current.reject(new Error('会话切换已取消，输入未发送，草稿已保留。')); selectionReady.current = null;
          }
        });
        });
        expectedNavigation = navigationGeneration.current;
        await reloadSends();
      }, origin, (target, expected, params) => editStore.submit(target, expected, params));
      if (result.turn) setThread(previous => previous?.id === result.threadId && routeRef.current.hostId === hostId
        ? applyThreadEvent(previous, { type: 'mcp-notification', method: 'turn/started', params: { threadId: result.threadId, turn: result.turn } }) : previous);
      void refreshList().catch(cause => setError(String(cause)));
      if (intent) await finishSend((await sendStore.read()).requests[intent.id]!);
    } catch (cause) {
      if (intent) {
        await sendStore.failed(intent.id, cause).catch(storageError => setError(String(storageError)));
        await reloadSends().catch(storageError => setError(String(storageError)));
      }
      if (!origin) setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally { inFlight.current = false; setSubmitting(false); }
  };
  const interrupt = async () => {
    const active = threadRef.current?.turns?.find(turn => turn.status === 'inProgress');
    if (!current.threadId || !active) return;
    await client.rpc('turn/interrupt', { threadId: current.threadId, turnId: active.id }, current.hostId);
  };
  const action = async (name: string, lastTurnId?: string) => {
    setMenu(false); if (!current.threadId) return;
    try {
      if (name === 'rename') {
        const value = prompt('Conversation name', thread?.name ?? ''); if (value == null) return;
        await client.rpc('thread/name/set', { threadId: current.threadId, name: value }, current.hostId);
      } else if (name === 'fork') {
        const value = await client.rpc<{ thread: ThreadSummary }>('thread/fork', { threadId: current.threadId, ...(lastTurnId ? { lastTurnId } : {}) }, current.hostId); openThread(value.thread.id, current.hostId, false);
      } else if (name === 'archive') {
        await client.rpc('thread/archive', { threadId: current.threadId }, current.hostId); navigate('/');
      } else if (name === 'copy') await navigator.clipboard.writeText(location.href);
      await refreshList(); setRefresh(value => value + 1);
    } catch (cause) { setError((cause as Error).message); }
  };
  const respond = async (request: typeof requests[number], result: unknown) => {
    await client.reply(request.ref, { result }); setRequests(previous => previous.filter(item => item !== request));
  };
  const newChat = async (nextCwd = cwd, project?: Project) => {
    if (!await navigate('/' + (current.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(current.hostId)))) return;
    const id = crypto.randomUUID();
    try {
      selectHomeDraftIdentity(current.hostId, id);
      rememberNewDraftLocation(current.hostId, id, nextCwd, project?.id);
    } catch (cause) { setError('新草稿的目标位置未能保存：' + String(cause)); }
    setHomeGeneration(value => value + 1); setCwd(nextCwd);
    setSelectedProject(project ?? null);
  };
  const settings = current.section !== null;
  const busy = submitting || isThreadBusy(thread);
  const panelScope = JSON.stringify([current.hostId, current.threadId ?? newDraftId]);
  const panelCwd = thread?.cwd || cwd || workspace;
  const composerOwner = { hostId: current.hostId, threadId: current.threadId,
    draftId: current.threadId ? sendState?.bindings[sendThreadKey(current.hostId, current.threadId)] ?? current.threadId : newDraftId };
  const browserOwner = browserDraftOwner(composerOwner, sendState?.bindings ?? {});
  const activeBrowserOwner = useRef(browserOwner); activeBrowserOwner.current = browserOwner;
  const showBrowser = (source?: { hostId: string; threadId: string; url?: string }) => {
    if (source && (source.hostId !== current.hostId || source.threadId !== current.threadId)) {
      setError('浏览器链接所属会话已改变，请返回原会话。'); return;
    }
    setBrowserMounted(true); setPanelKind('browser'); setPanelOpen(true);
    if (source?.url) setBrowserNavigation({ id: crypto.randomUUID(), url: source.url });
  };
  const showVisualization = (source: { hostId: string; threadId: string; path: string }) => {
    if (source.hostId !== current.hostId || source.threadId !== current.threadId) { setError('可视化所属会话已改变，请返回原会话。'); return; }
    setVisualization(source); setPanelKind('visualization'); setPanelOpen(true);
  };
  const showPanel = (request?: { kind: 'terminal' } | { kind: 'file'; path: string; line?: number; column?: number } | { kind: 'diff'; path?: string; diff?: string }) => {
    setPanelMounted(true); setPanelKind('workspace'); setPanelOpen(true);
    if (request) setPanelRequest({ ...request, id: crypto.randomUUID(), scopeId: panelScope, hostId: current.hostId, cwd: panelCwd });
  };
  const openFile = (path: string, line?: number, column?: number, fileCwd = panelCwd) =>
    showPanel({ kind: 'file', path: resolveFilePath(fileCwd, path), line, column });
  const addReference = (draft: ComposerDraft) => {
    if (current.readOnly) { setError('归档会话为只读，请先恢复会话。'); return; }
    setPrefills(previous => ({ ...previous, [panelScope]: [...previous[panelScope] ?? [], { id: crypto.randomUUID(), draft }] })); setPanelOpen(false);
  };
  const turnDiff = [...thread?.turns ?? []].reverse().map(turn => record(turn).diff).find(value => typeof value === 'string') as string | undefined;
  const prefill = prefills[panelScope]?.[0] ?? null;
  const addProject = () => {
    const path = prompt('Project directory'); if (!path) return;
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    const hostId = current.hostId, locationAtStart = current.pathname + current.search + current.hash;
    void client.host<{ project: Record<string, unknown> }>('project-add', { hostId, path, name }).then(async ({ project }) => {
      await reloadProjects();
      if (routeRef.current.pathname + routeRef.current.search + routeRef.current.hash === locationAtStart && routeRef.current.hostId === hostId) {
        await newChat(path, { id: String(project.id), hostId, name, rootPaths: [path] });
      }
    }).catch(cause => setError(String(cause)));
  };
  const openTab = async (tab: typeof tabs[number]) => {
    const generation = navigationGeneration.current;
    try {
      let readOnly = tab.readOnly;
      if (readOnly === undefined) {
        // Older saved tabs have no archive fact. Read the selected host's whole
        // archived inventory instead of borrowing the current sidebar filter.
        let cursor: string | null = null;
        const seen = new Set<string>();
        do {
          const page: { data: { id: string }[]; nextCursor?: string | null } = await client.rpc('thread/list',
            { archived: true, limit: 100, cursor, sortKey: 'updated_at' }, tab.hostId);
          if (navigationGeneration.current !== generation) return;
          if (page.data.some(row => row.id === tab.id)) { readOnly = true; break; }
          cursor = page.nextCursor ?? null;
          if (cursor && seen.has(cursor)) throw new Error('归档列表分页游标重复，未猜测会话状态。');
          if (cursor) seen.add(cursor);
        } while (cursor);
        readOnly ??= false;
        setTabs(previous => previous.map(value => value.id === tab.id && value.hostId === tab.hostId ? { ...value, readOnly } : value));
      }
      if (navigationGeneration.current === generation) await openThread(tab.id, tab.hostId, readOnly);
    } catch (cause) { setError(String(cause)); }
  };

  return <div className="yard-app" data-sidebar-open={sidebar} data-owned-renderer="true">
    {sidebar && <StandaloneSidebar hostId={current.hostId} currentThread={current.threadId ? { hostId: current.hostId, threadId: current.threadId } : null}
      projectState={projectState} fallbackWorkspace={workspace} rows={list.rows} nextCursor={list.nextCursor} loading={list.loading} error={list.error}
      search={search} archived={archived} onSearchChange={setSearch} onArchivedChange={setArchived} onClose={() => setSidebar(false)}
      onOpenThread={row => { void openThread(row.id, row.hostId, row.archived); }}
      onNewChat={project => { void newChat(project?.rootPaths[0] ?? cwd, project?.id === workspace ? undefined : project ?? undefined); }}
      onAddProject={addProject} onOpenSettings={() => { backFromSettings.current = location.pathname + location.search; void navigate('/settings/general'); }}
      onRefresh={() => { void list.refresh(); }} onLoadMore={() => { void list.loadMore(); }} onRetryProjectLookup={() => { void reloadProjects().catch(cause => setError(String(cause))); }} />}
    <main className="yard-main">
      <header className="yard-toolbar"><button aria-label="Toggle sidebar" onClick={() => setSidebar(value => !value)}>◧</button>
        <div className="yard-tab-strip" role="tablist" aria-label="Workspace tabs">{tabs.map(tab => <div className="yard-tab" key={tab.hostId + ':' + tab.id}><button role="tab" aria-selected={tab.id === current.threadId && tab.hostId === current.hostId} onClick={() => { void openTab(tab); }}>{tab.title}</button><button aria-label={'Close ' + tab.title} onClick={() => setTabs(previous => previous.filter(item => item !== tab))}>×</button></div>)}</div>
        <select aria-label="Execution host" value={current.hostId} onChange={event => navigate('/?hostId=' + encodeURIComponent(event.target.value))}>{hosts.map(host => <option key={host.hostId} value={host.hostId}>{host.displayName}</option>)}</select>
        <span className="yard-connection" title={status} data-state={status}>●</span>
        <button aria-label="Workspace files" aria-pressed={panelOpen && panelKind === 'workspace'} onClick={() => showPanel()}>Files</button>
        <button aria-label="Open terminal" onClick={() => showPanel({ kind: 'terminal' })}>Terminal</button>
        <button aria-label="Open Chrome panel" disabled={!sendState} aria-pressed={panelOpen && panelKind === 'browser'} onClick={() => showBrowser()}>Chrome</button>
        {visualization?.hostId === current.hostId && visualization.threadId === current.threadId && <button aria-label="Open visualization" onClick={() => showVisualization(visualization)}>Preview</button>}
        {turnDiff !== undefined && <button aria-label="Open turn changes" onClick={() => showPanel({ kind: 'diff', diff: turnDiff })}>Changes</button>}
      </header>
      {error && <div role="alert" className="yard-error">{error}<button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {Object.values(sendState?.requests ?? {}).map(intent => <SendRecoveryNotice key={intent.id} intent={intent}
        canRetry={!submitting && !loading && !busy && !current.readOnly && current.hostId === intent.owner.hostId && current.threadId === intent.threadId
          && (intent.threadId !== null || newDraftId === intent.owner.draftId)}
        onOpen={async () => {
          if (intent.threadId) { await openThread(intent.threadId, intent.owner.hostId, false); return; }
          if (await navigate('/' + (intent.owner.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(intent.owner.hostId)))) {
            selectHomeDraftIdentity(intent.owner.hostId, intent.owner.draftId);
            rememberNewDraftLocation(intent.owner.hostId, intent.owner.draftId, intent.cwd, intent.projectId);
            setHomeGeneration(value => value + 1); setCwd(intent.cwd);
            setSelectedProject(projectState ? projectsForHost(projectState, intent.owner.hostId).find(project => project.id === intent.projectId) ?? null : null);
          }
        }} onCheck={async () => { await sendStore.check(intent.id); await reloadSends(); }}
        onRetry={() => submit(intent.draft, intent.options, { type: 'send' }, undefined,
          { owner: intent.owner, revision: intent.revision, overrides: intent.overrides }, intent)}
        onFinish={() => finishSend(intent)} onCancel={async () => { await sendStore.cancel(intent.id); await reloadSends(); }} />)}
      <div className="yard-workspace" data-panel-open={panelOpen && !settings}>
      <div className="yard-chat-pane">
      {settings ? <StandaloneSettings client={client} hostId={current.hostId} location={{ pathname: current.pathname, search: current.search, hash: current.hash, state: current.state }} onNavigate={navigate} registerNavigationGuard={registerNavigationGuard} onClose={() => navigate(backFromSettings.current)} /> : <>
        {current.threadId && <header className="yard-conversation-header"><strong>{thread?.name || threads.find(item => item.id === current.threadId)?.name || 'Conversation'}</strong><span>{thread?.cwd}</span><button aria-label="Conversation menu" onClick={() => setMenu(value => !value)}>•••</button>{menu && <div className="yard-menu" role="menu">{['rename', 'fork', 'copy', 'archive'].map(name => <button role="menuitem" key={name} onClick={() => { void action(name); }}>{name === 'copy' ? 'Copy conversation link' : name[0]!.toUpperCase() + name.slice(1)}</button>)}</div>}</header>}
        <section className={'yard-conversation ' + (!current.threadId ? 'yard-home' : '')}>
          {streamGap && <p role="status" className="yard-stream-gap">任务正在运行。此页面未收到完整的活动内容；完成后将重新读取完整记录。</p>}
          {loading ? <div role="status" className="yard-loading">Loading conversation…</div> : current.threadId ? <StandaloneMessages client={client} hostId={current.hostId} thread={thread} editRecovery={editRecovery} editHistory={{ order: 'ascending', tailComplete: historyComplete }}
            onEditDraftChange={(value, origin, version) => editStore.save(value, origin, version)}
            onOpenFile={openFile} onOpenFileAt={location => {
              if (location.hostId !== current.hostId) { setError('文件所属主机已改变，请返回原会话打开。'); return; }
              openFile(location.path, location.line, location.column, location.cwd ?? panelCwd);
            }} onOpenVisualization={showVisualization} onOpenBrowser={showBrowser}
            onEdit={current.readOnly ? undefined : (draft, origin) => submit(draft, initialOptions ?? {}, { type: 'send' }, origin)} onFork={turnId => action('fork', turnId)} /> : <div className="yard-home-heading"><img src="/brand/icon.svg" alt="" /><h1>What would you like to work on?</h1><p>{cwd || workspace}</p></div>}
        </section>
        <div className="yard-composer-container" inert={leaving}>{current.readOnly ? <p role="status">此会话已归档。<button onClick={() => { void client.rpc('thread/unarchive', { threadId: current.threadId }, current.hostId).then(() => openThread(current.threadId!, current.hostId, false)).catch(cause => setError(String(cause))); }}>Restore conversation</button></p> : !sendState || current.threadId && (loading || !initialOptions) ? <p role="status">Loading session settings…</p> : <StandaloneComposer key={current.hostId + ':' + (current.threadId ?? newDraftId)} client={client} context={{ ...composerOwner, cwd: thread?.cwd ?? cwd }}
          onRemoveReference={(owner, reference) => removeBrowserDraftReference(browserDraftOwner(owner, sendState.bindings), reference)}
          onDraftController={receiveComposerController} initialOptions={initialOptions ?? undefined} hosts={hosts} onTargetChange={async target => {
          if (await navigate('/' + (target.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(target.hostId)))) {
            rememberNewDraftLocation(target.hostId, homeDraftIdentity(target.hostId), target.cwd); setCwd(target.cwd); setSelectedProject(null);
          }
        }} onPrefillConsumed={id => setPrefills(previous => ({ ...previous, [panelScope]: (previous[panelScope] ?? []).filter(item => item.id !== id) }))} activeTurnId={thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null} busy={busy}
          onSubmit={(draft, options, action, description) => submit(draft, options, action, undefined, description)} onInterrupt={interrupt} prefill={prefill} onStartQueued={async queuedSubmissionId => {
          if (!current.threadId || current.readOnly || inFlight.current || isThreadBusy(threadRef.current)) throw new Error('当前会话暂时无法启动队列。');
          inFlight.current = true; setSubmitting(true);
          try { await subscription.current; await client.rpc('thread/queue/start', { threadId: current.threadId, queuedSubmissionId }, current.hostId); }
          finally { inFlight.current = false; setSubmitting(false); }
        }} />}</div>
      </>}
      </div>
      <aside className="yard-workspace-panel" hidden={!panelOpen || settings} aria-label="Workspace panel">
        <div hidden={panelKind !== 'workspace'} style={{ height: '100%' }}>{panelMounted && <WorkspacePanels client={client} scopeId={panelScope} hostId={current.hostId} threadId={current.threadId ?? undefined} cwd={panelCwd}
          appearance={panelAppearance} request={panelRequest} onRequestConsumed={id => setPanelRequest(previous => previous?.id === id ? null : previous)}
          onClose={() => setPanelOpen(false)} onReference={addReference} onDirtyChange={dirty => { panelsDirty.current = dirty; }} />}</div>
        {browserMounted && <StandaloneBrowser client={client} {...browserOwner} browserTabId="primary"
          draft={composerController.current?.snapshot()?.draft ?? { text: '', images: [], files: [] }}
          visible={panelOpen && !settings && panelKind === 'browser'} allowNavigation
          navigationRequest={browserNavigation} onNavigationConsumed={id => setBrowserNavigation(previous => previous?.id === id ? null : previous)}
          onDraftChange={async (owner, update) => {
            const controller = composerController.current, snapshot = controller?.snapshot();
            if (!controller || !snapshot || current.readOnly || leaving || browserOwnerKey(owner) !== browserOwnerKey(activeBrowserOwner.current)) throw new Error('草稿已切换，浏览器批注已保留。');
            if (!await controller.update(snapshot.owner, update)) throw new Error('草稿已切换，浏览器批注已保留。');
          }} onClose={() => setPanelOpen(false)} />}
        {panelOpen && !settings && panelKind === 'visualization' && visualization?.hostId === current.hostId && visualization.threadId === current.threadId
          && <StandaloneVisualization client={client} {...visualization} theme={previewAppearance.theme} themeVariables={previewAppearance.variables}
            locale={previewAppearance.locale} onPrefill={addReference} onClose={() => setPanelOpen(false)} />}
      </aside>
      </div>
    </main>
    {requests[0] && <ApprovalDialog key={requests[0].ref.generation + ':' + requests[0].id} request={requests[0]} onRespond={result => respond(requests[0]!, result)} onUnsupported={async () => {
      const request = requests[0]!; await client.reply(request.ref, { error: { code: -32601, message: '当前 Web 宿主不支持此请求。' } }); setRequests(previous => previous.filter(item => item !== request));
    }} />}
  </div>;
}
