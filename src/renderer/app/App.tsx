import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, ServerRequestRef, SubmitAction, SubmitOptions, WorkbenchEvent } from '../workbench-contract.ts';
import { StandaloneComposer, bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftLease, ComposerDraftSnapshot, ComposerSubmissionDescription } from '../composer/StandaloneComposer.tsx';
import { StandaloneMessages } from '../messages/StandaloneMessages.tsx';
import type { MessageEditNavigationController, MessageEditNavigationLease } from '../messages/use-message-editing.ts';
import { StandaloneGoal } from '../composer/StandaloneGoal.tsx';
import { StandaloneSettings } from '../settings/StandaloneSettings.tsx';
import type { SettingsInstructionEditorProps } from '../settings/PersonalizationSection.tsx';
import { CodeEditor } from '../files/CodeEditor.tsx';
import { BrowserWorkbenchClient } from './client.ts';
import { isThreadBusy } from './thread-state.ts';
import { ConversationSessions, useConversationSession } from './conversation-sessions.ts';
import { ApprovalDialog } from './ApprovalDialog.tsx';
import { ApprovalRequestsController } from './approval-requests.ts';
import { submitDraft } from './submission.ts';
import { applyAppearance } from './appearance.ts';
import { sessionOptions } from './session-options.ts';
import { MessageEditRecoveryStore, messageEditChanged, messageEditRebaseMarker, messageEditsAtom } from './message-edit-recovery.ts';
import type { StoredMessageEdit } from './message-edit-recovery.ts';
import { projectForThread, projectsForHost } from './projects.ts';
import type { Project, ProjectState } from './projects.ts';
import { StandaloneSidebar } from '../sidebar/StandaloneSidebar.tsx';
import { useThreadList } from '../sidebar/use-thread-list.ts';
import { WorkspacePanels } from '../panels/WorkspacePanels.tsx';
import type { WorkspacePanelAppearance, WorkspacePanelRequest, WorkspacePanelsHandle } from '../panels/WorkspacePanels.tsx';
import { resolveFilePath } from '../files/file-service.ts';
import { createRouteNavigation } from './route-navigation.ts';
import { captureSettingsOrigin, emptySettingsContext, readSettingsOrigin, readSettingsOriginURL, resolveSettingsOrigin, settingsOriginParameter, settingsOriginURL } from './settings-origin.ts';
import type { SettingsContext, SettingsOrigin } from './settings-origin.ts';
import { SendRecoveryStore, sendsAtom, sendThreadKey } from './send-recovery.ts';
import type { SendIntent, SendRecoverySnapshot } from './send-recovery.ts';
import { SendRecoveryNotice } from './SendRecoveryNotice.tsx';
import { StandaloneBrowser } from '../browser/index.tsx';
import { browserOwnerKey } from '../browser/comments.ts';
import { acknowledgeSubmittedBrowserReferences, browserDraftOwner, removeBrowserDraftReference, syncBrowserDraftDeletions, watchBrowserDraftDeletions } from './browser-draft.ts';
import { BrowserDraftRecoveryNotice } from './BrowserDraftRecoveryNotice.tsx';
import type { BrowserOwner } from '../browser/comments.ts';
import { StandaloneVisualization, readVisualizationModelContext } from '../visualizations/index.tsx';
import { homeDraftIdentity, selectHomeDraftIdentity } from './home-draft-identity.ts';
import { I18nProvider, resolveLocale } from '../i18n/index.tsx';
import { themeFontFamily } from './theme-fonts.ts';
import { readSettingsRoute } from '../settings/routing.ts';
import { readThreadArchived } from './thread-archive.ts';
import { useWorkbenchShortcuts } from './use-workbench-shortcuts.ts';
import type { NumberShortcutSlot } from './workbench-shortcuts.ts';
import './app.css';

type ThreadRow = ThreadSummary & { preview?: string; updatedAt?: number; createdAt?: number };
interface Host { hostId: string; displayName: string }
interface Route { pathname: string; search: string; hash: string; state: unknown; threadId: string | null; hostId: string; section: string | null; readOnly: boolean }
function route(): Route {
  const url = new URL(location.href), parts = url.pathname.split('/').filter(Boolean);
  return { pathname: url.pathname, search: url.search, hash: url.hash, state: history.state && Object.hasOwn(history.state, '__yardState') ? history.state.__yardState : history.state,
    threadId: ['local', 'thread'].includes(parts[0] ?? '') ? decodeURIComponent(parts[1] ?? '') || null : null,
    hostId: parts[0] === 'settings' ? readSettingsRoute({ pathname: url.pathname, search: url.search, hash: url.hash, state: null }, 'local').hostId
      : url.searchParams.get('hostId') ?? url.searchParams.get('host') ?? 'local', section: parts[0] === 'settings' ? parts[1] ?? 'general' : null,
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

const InstructionEditorTheme = createContext<'light' | 'dark'>('dark');
function SettingsInstructionEditor(props: SettingsInstructionEditorProps) {
  const theme = useContext(InstructionEditorTheme);
  return <CodeEditor {...props} theme={theme} visible />;
}

export function App({ client }: { client: BrowserWorkbenchClient }) {
  const [current, setCurrent] = useState(route);
  const [bridgeStatus, setBridgeStatus] = useState('connecting');
  const [hostStatuses, setHostStatuses] = useState<Record<string, string>>({});
  const status = bridgeStatus === 'connected' ? hostStatuses[current.hostId] ?? 'connecting' : bridgeStatus;
  const connectionReadGeneration = useRef(0);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const settingsOrigin = useMemo(() => new URLSearchParams(current.search).has(settingsOriginParameter)
    ? readSettingsOriginURL(current.search) : readSettingsOrigin(current.state), [current.search, current.state]);
  const [settingsSourceEpoch, setSettingsSourceEpoch] = useState(0);
  const settingsSourceKey = current.section ? JSON.stringify([current.hostId, settingsOrigin, settingsSourceEpoch]) : null;
  const [settingsSource, setSettingsSource] = useState<{
    key: string | null; state: 'loading' | 'error' | 'ready'; error?: string; context: SettingsContext;
  }>({ key: null, state: 'ready', context: emptySettingsContext });
  const [settingsSourceRetry, setSettingsSourceRetry] = useState(0);
  const settingsContext = settingsSource.key === settingsSourceKey ? settingsSource.context : emptySettingsContext;
  const [hosts, setHosts] = useState<Host[]>([{ hostId: 'local', displayName: 'Local' }]);
  const [cwd, setCwd] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [sidebar, setSidebar] = useState(() => saved('yard-sidebar-open', true));
  const [tabs, setTabs] = useState<{ id: string; hostId: string; title: string; readOnly?: boolean }[]>(() => saved('yard-workspace-tabs', []));
  const list = useThreadList(client, { hostId: current.hostId, archived, search, refreshKey: refresh });
  const threads = list.rows;
  const listRef = useRef(list); listRef.current = list;
  const approvals = useMemo(() => new ApprovalRequestsController(client), [client]);
  const requests = useSyncExternalStore(approvals.subscribe, approvals.getSnapshot);
  useEffect(() => () => approvals.dispose(), [approvals]);
  const [selectedRequest, setSelectedRequest] = useState<ServerRequestRef | null>(null);
  const [requestViewHidden, setRequestViewHidden] = useState(false);
  const newestRequestKey = requests.filter(entry => entry.current && entry.outcome === 'ready')
    .map(entry => JSON.stringify(entry.request.ref)).at(-1);
  useEffect(() => {
    if (newestRequestKey) { setSelectedRequest(JSON.parse(newestRequestKey) as ServerRequestRef); setRequestViewHidden(false); }
  }, [newestRequestKey]);
  const selectedRequestEntry = requests.find(entry => selectedRequest && entry.request.ref.hostId === selectedRequest.hostId
    && entry.request.ref.id === selectedRequest.id && entry.request.ref.generation === selectedRequest.generation)
    ?? requests.find(entry => entry.current) ?? requests[0];
  const approvalDialog = selectedRequestEntry && !requestViewHidden ? approvals.dialog(selectedRequestEntry.request.ref) : null;
  const [menu, setMenu] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [navigationCommit, setNavigationCommit] = useState(0);
  const [navigationFactsEpoch, setNavigationFactsEpoch] = useState(0);
  const [editState, setEditState] = useState<StoredMessageEdit | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelKind, setPanelKind] = useState<'workspace' | 'browser' | 'visualization'>('workspace');
  const [browserMounted, setBrowserMounted] = useState(false);
  const [browserNavigation, setBrowserNavigation] = useState<{ id: string; url: string } | null>(null);
  const [visualization, setVisualization] = useState<{ hostId: string; threadId: string; path: string } | null>(null);
  const [previewAppearance, setPreviewAppearance] = useState<{ theme: 'dark' | 'light'; variables: Record<string, string>; locale: string }>({ theme: 'dark', variables: {}, locale: 'en' });
  const [panelRequest, setPanelRequest] = useState<WorkspacePanelRequest | null>(null);
  const workspacePanels = useRef<WorkspacePanelsHandle | null>(null);
  const [panelAppearance, setPanelAppearance] = useState<WorkspacePanelAppearance>({ theme: 'dark', codeFontSize: 12, codeLineHeight: 18 });
  const panelsDirty = useRef(false);
  const panelRecoveryBarrier = useRef<(() => Promise<void>) | null>(null);
  const receivePanelRecoveryBarrier = useCallback((barrier: (() => Promise<void>) | null) => { panelRecoveryBarrier.current = barrier; }, []);
  const messageEditController = useRef<MessageEditNavigationController | null>(null);
  const receiveMessageEditController = useCallback((controller: MessageEditNavigationController | null) => { messageEditController.current = controller; }, []);
  const navigationLease = useRef<MessageEditNavigationLease | null>(null);
  const composerNavigationLease = useRef<ComposerDraftLease | null>(null);
  const targetChange = useRef<{ controller: ComposerDraftController; owner: ComposerDraftSnapshot['owner']; lease: ComposerDraftLease;
    target: { hostId: string; cwd: string }; committed(): void } | null>(null);
  const navigationLocked = useRef(false);
  useLayoutEffect(() => {
    const pending = targetChange.current;
    if (pending && (current.hostId !== pending.target.hostId || current.threadId !== null || current.section
      || cwd !== pending.target.cwd || composerController.current?.snapshot()?.owner.hostId !== pending.target.hostId)) return;
    // Keep the original editor frozen until the new route actually commits.
    navigationLease.current?.release(); navigationLease.current = null;
    composerNavigationLease.current?.release(); composerNavigationLease.current = null; navigationLocked.current = false;
    if (pending) { targetChange.current = null; setLeaving(false); pending.committed(); }
  }, [navigationCommit, current.hostId, current.threadId, current.section, cwd]);
  const editStore = useMemo(() => new MessageEditRecoveryStore(client, undefined, { hostChecksRebasedSourceBeforeRevert: true }), [client]);
  const editAccess = useMemo(() => editStore.createAccess(), [editStore]);
  const sendStore = useMemo(() => new SendRecoveryStore(client), [client]);
  const [sendState, setSendState] = useState<SendRecoverySnapshot | null>(null);
  const sessions = useMemo(() => new ConversationSessions(client, async identity =>
    (await sendStore.read()).creations[sendThreadKey(identity.hostId, identity.threadId)]), [client, sendStore]);
  const conversation = useConversationSession(sessions, current.threadId ? { hostId: current.hostId, threadId: current.threadId } : null,
    current.readOnly, sendState !== null, refresh);
  const { thread, loading, historyComplete, streamGap, options: initialOptions } = conversation;
  useEffect(() => () => sessions.dispose(), [sessions]);
  const composerController = useRef<ComposerDraftController | null>(null);
  const [composerSnapshot, setComposerSnapshot] = useState<ComposerDraftSnapshot | null>(null);
  const [browserSyncError, setBrowserSyncError] = useState('');
  const [browserSyncRetry, setBrowserSyncRetry] = useState(0);
  const browserRecoveryBarrier = useRef<(() => Promise<void>) | null>(null);
  const receiveBrowserRecoveryBarrier = useCallback((barrier: (() => Promise<void>) | null) => { browserRecoveryBarrier.current = barrier; }, []);
  const browserProjections = useRef<Record<string, { before: ComposerDraftSnapshot; after: ComposerDraftSnapshot }>>({});
  const [browserProjectionState, setBrowserProjectionState] = useState(browserProjections.current);
  const retainBrowserProjection = useCallback((before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => {
    const key = JSON.stringify([after.owner, after.revision]);
    browserProjections.current = { ...browserProjections.current, [key]: structuredClone({ before, after }) };
    setBrowserProjectionState(browserProjections.current);
  }, []);
  const releaseBrowserProjection = useCallback((snapshot: ComposerDraftSnapshot) => {
    const key = JSON.stringify([snapshot.owner, snapshot.revision]);
    if (JSON.stringify(browserProjections.current[key]?.after) !== JSON.stringify(snapshot)) return;
    const next = { ...browserProjections.current }; delete next[key];
    browserProjections.current = next; setBrowserProjectionState(next);
  }, []);
  const receiveComposerSnapshot = useCallback((value: ComposerDraftSnapshot) => setComposerSnapshot(value), []);
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
  const selectionReady = useRef<{ key: string; resolve(): void; reject(error: Error): void } | null>(null);
  const settingsGuard = useRef<{ requestLeave(): Promise<boolean> } | null>(null);
  const navigation = useRef<ReturnType<typeof createRouteNavigation> | null>(null);
  const navigationGeneration = useRef(0);
  const threadRef = useRef(thread); threadRef.current = thread;
  const projectStateRef = useRef(projectState); projectStateRef.current = projectState;
  const selectedProjectRef = useRef(selectedProject); selectedProjectRef.current = selectedProject;
  const routeRef = useRef(current); routeRef.current = current;
  const projectGeneration = useRef(0);
  const preferenceGeneration = useRef(0);
  const reloadProjects = useCallback(async () => {
    const generation = ++projectGeneration.current;
    const state = await client.host<ProjectState>('thread-project-state');
    if (generation === projectGeneration.current) setProjectState(state);
  }, [client]);

  const navigate = useCallback((path: string, options?: { replace?: boolean; delta?: number; state?: unknown }) => {
    navigationGeneration.current++;
    const previous = routeRef.current;
    if (!options?.delta && new URL(path, location.href).pathname.split('/')[1] === 'settings') {
      const origin = previous.section ? readSettingsOriginURL(previous.search) ?? readSettingsOrigin(previous.state)
        : captureSettingsOrigin(previous, selectedProjectRef.current);
      if (!new URL(path, location.href).searchParams.has(settingsOriginParameter)) path = settingsOriginURL(path, origin);
    }
    return navigation.current?.navigate(path, options) ?? Promise.resolve(false);
  }, []);
  const registerNavigationGuard = useCallback((guard: { requestLeave(): Promise<boolean> } | null) => { settingsGuard.current = guard; }, []);
  const openThread = (id: string, hostId = current.hostId, readOnly = false) => {
    const search = new URLSearchParams(); if (hostId !== 'local') search.set('hostId', hostId); if (readOnly) search.set('archived', '1');
    return navigate(`/local/${encodeURIComponent(id)}${search.size ? '?' + search : ''}`);
  };
  const refreshList = useCallback(() => listRef.current.refresh(), []);
  const reloadPreferences = useCallback(async () => {
    const generation = ++preferenceGeneration.current;
    const [{ values }, reduced, locales] = await Promise.all([
      client.host<{ values: Record<string, unknown> }>('get-settings'),
      client.host<{ value?: string }>('get-global-state', { key: 'reduced-motion-preference' }).catch(() => null),
      client.host<{ ideLocale?: string; systemLocale?: string }>('locale-info').catch(() => ({ ideLocale: undefined, systemLocale: undefined })),
    ]);
    if (generation !== preferenceGeneration.current) return;
    const dark = values.appearanceTheme === 'dark' || values.appearanceTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = applyAppearance(values, dark);
    document.documentElement.lang = resolveLocale(values.localeOverride,
      [locales.ideLocale, locales.systemLocale, ...navigator.languages, navigator.language].filter((value): value is string => !!value));
    const codeFontSize = typeof values.codeFontSize === 'number' && Number.isFinite(values.codeFontSize) ? values.codeFontSize : 12;
    setPanelAppearance({ theme: resolved.mode, codeFontSize, codeLineHeight: codeFontSize * 1.5,
      codeThemeId: typeof values[resolved.mode === 'dark' ? 'appearanceDarkCodeThemeId' : 'appearanceLightCodeThemeId'] === 'string'
        ? values[resolved.mode === 'dark' ? 'appearanceDarkCodeThemeId' : 'appearanceLightCodeThemeId'] as string : 'codex',
      diffMarkerStyle: values.appearanceDiffMarkerStyle === 'symbols' ? 'symbols' : 'color',
      codeFontFamily: themeFontFamily(resolved.theme.fonts, 'code', 'ui-monospace, monospace') });
    const style = document.documentElement.style;
    setPreviewAppearance({ theme: resolved.mode, locale: document.documentElement.lang,
      variables: { ...Object.fromEntries(Array.from(style).filter(name => name.startsWith('--')).map(name => [name, style.getPropertyValue(name)])),
        '--viz-bg': resolved.theme.surface, '--viz-text': resolved.theme.ink, '--viz-accent': resolved.theme.accent,
        '--viz-panel': style.getPropertyValue('--yard-panel'), '--viz-border': style.getPropertyValue('--yard-border'), '--viz-muted': style.getPropertyValue('--yard-muted') } });
    if (reduced) document.documentElement.dataset.reducedMotion = String(reduced.value === 'on' || reduced.value !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.dataset.pointerCursors = String(values.usePointerCursors === true);
  }, [client]);

  useEffect(() => {
    const controller = createRouteNavigation(() => {
      const next = route();
      navigationLease.current?.handoff(); navigationLease.current = null;
      if (next.section && !routeRef.current.section) setSettingsSourceEpoch(value => value + 1);
      navigationGeneration.current++; setLeaving(Boolean(targetChange.current)); setCurrent(next); setNavigationCommit(value => value + 1); setError(''); setMenu(false);
    }, async () => {
      navigationLocked.current = true;
      let accepted = false;
      try {
        navigationLease.current = messageEditController.current?.freeze() ?? null;
        const composer = composerController.current, snapshot = composer?.snapshot();
        const borrowed = targetChange.current?.controller === composer ? targetChange.current.lease : undefined;
        composerNavigationLease.current = snapshot ? composer!.freeze(snapshot.owner, borrowed) : null;
        if (composer && (!snapshot || !composerNavigationLease.current)) return false;
        // Apply native inert before the first await so input cannot change while
        // the message, composer and file transactions are being drained.
        flushSync(() => setLeaving(true));
        await navigationLease.current?.flush();
        if (composerNavigationLease.current && !await composerNavigationLease.current.flush()) return false;
        if (settingsGuard.current && !await settingsGuard.current.requestLeave()) return false;
        if (panelsDirty.current && !window.confirm('Keep unsaved file changes and switch pages?')) return false;
        await panelRecoveryBarrier.current?.();
        await browserRecoveryBarrier.current?.();
        if (Object.keys(browserProjections.current).length) throw new Error('浏览器引用有已保存但尚未接收的版本，请先核对、复制或明确放弃。');
        await navigationLease.current?.flush();
        if (composerNavigationLease.current && !await composerNavigationLease.current.flush()) return false;
        accepted = true;
        return true;
      } catch (cause) { accepted = false; setError(String(cause)); return false; }
      finally { if (!accepted) {
        navigationLease.current?.release(); navigationLease.current = null;
        composerNavigationLease.current?.release(); composerNavigationLease.current = null; navigationLocked.current = false; setLeaving(false);
      } }
    }, () => setNavigationFactsEpoch(value => value + 1));
    navigation.current = controller;
    setNavigationFactsEpoch(value => value + 1);
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'connection-state') {
        connectionReadGeneration.current++;
        setBridgeStatus(String(event.state)); setSettingsSourceEpoch(value => value + 1);
      }
      if (event.type === 'page-resumed') {
        setSettingsSourceEpoch(value => value + 1);
        setRefresh(value => value + 1);
        void reloadProjects().catch(cause => setError(String(cause)));
        void reloadPreferences().catch(cause => setError(String(cause)));
      }
      if (event.type === 'codex-app-server-connection-changed' && typeof event.hostId === 'string') {
        connectionReadGeneration.current++;
        const hostId = event.hostId, state = String(event.state);
        setHostStatuses(previous => previous[hostId] === state ? previous : { ...previous, [hostId]: state });
        if (hostId === routeRef.current.hostId) {
          setSettingsSourceEpoch(value => value + 1);
          if (event.state === 'connected') setRefresh(value => value + 1);
        }
      }
      if (event.type === 'shared-object-updated' && event.key === 'remote_ssh_connections' && Array.isArray(event.value)) {
        setHosts([{ hostId: 'local', displayName: 'Local' }, ...event.value as Host[]]);
        void reloadProjects().catch(cause => setError(String(cause)));
      }
      if (event.type === 'protocol-error') setError(String(event.error));
      if (event.type === 'mcp-notification' && event.method === 'thread/name/updated') {
        const params = record(event.params);
        if (typeof params.threadName === 'string') setTabs(previous => previous.map(tab =>
          tab.hostId === event.hostId && tab.id === params.threadId ? { ...tab, title: params.threadName as string } : tab));
        void refreshList();
      }
      if (event.type === 'mcp-notification' && ['thread/archived', 'thread/unarchived'].includes(String(event.method))) {
        navigationGeneration.current++;
        const id = record(event.params).threadId;
        const readOnly = event.method === 'thread/archived';
        setTabs(previous => previous.map(tab => tab.hostId === event.hostId && tab.id === id ? { ...tab, readOnly } : tab));
        setCurrent(previous => previous.hostId === event.hostId && previous.threadId === id ? { ...previous, readOnly } : previous);
        void refreshList();
      }
      if (event.type === 'settings-changed' || event.type === 'global-state-updated') void reloadPreferences().catch(cause => setError(String(cause)));
      if (event.type === 'thread-project-memberships-updated' || event.type === 'global-state-updated'
        && (!Array.isArray(event.keys) || !event.keys.length || event.keys.some(key => ['local-projects', 'remote-projects', 'thread-project-assignments', 'projectless-thread-ids'].includes(String(key))))) {
        setSettingsSourceEpoch(value => value + 1);
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
    window.addEventListener('languagechange', preferences);
    return () => { unsubscribe(); controller.dispose(); navigationLease.current?.release(); composerNavigationLease.current?.release(); if (navigation.current === controller) navigation.current = null; media.removeEventListener('change', preferences); reduced.removeEventListener('change', preferences); window.removeEventListener('languagechange', preferences); };
  }, [client, reloadPreferences, reloadProjects]);
  useEffect(() => {
    if (bridgeStatus !== 'connected') return;
    const hostId = current.hostId, generation = ++connectionReadGeneration.current;
    let active = true;
    void client.host<{ state: string }>('app-server-connection-state', { hostId }).then(value => {
      if (active && generation === connectionReadGeneration.current) {
        setHostStatuses(previous => ({ ...previous, [hostId]: value.state }));
      }
    }).catch(cause => { if (active && generation === connectionReadGeneration.current) setError(String(cause)); });
    return () => { active = false; };
  }, [client, current.hostId, bridgeStatus]);
  useLayoutEffect(() => {
    if (!current.section || !settingsOrigin || new URLSearchParams(current.search).has(settingsOriginParameter)) return;
    const path = settingsOriginURL(current.pathname + current.search + current.hash, settingsOrigin);
    if (navigation.current?.replaceCurrentURL(path)) setCurrent(previous => ({ ...previous, search: new URL(path, location.href).search }));
  }, [current.section, current.pathname, current.search, current.hash, settingsOrigin, navigationCommit, navigationFactsEpoch]);
  useLayoutEffect(() => {
    const readOnly = conversation.archived;
    if (!current.threadId || readOnly === null) return;
    const url = new URL(current.pathname + current.search + current.hash, location.href);
    if (readOnly) url.searchParams.set('archived', '1'); else url.searchParams.delete('archived');
    if (current.readOnly === readOnly && current.search === url.search) return;
    if (navigation.current?.replaceCurrentURL(url.pathname + url.search + url.hash)) {
      navigationGeneration.current++;
      setCurrent(previous => ({ ...previous, readOnly, search: url.search }));
    } else if (current.readOnly !== readOnly) setCurrent(previous => ({ ...previous, readOnly }));
    setTabs(previous => previous.map(tab => tab.hostId === current.hostId && tab.id === current.threadId ? { ...tab, readOnly } : tab));
  }, [current.hostId, current.threadId, current.pathname, current.search, current.hash, current.readOnly, conversation.archived, navigationCommit, navigationFactsEpoch]);
  useEffect(() => {
    if (!settingsSourceKey) return;
    let active = true;
    const [hostId, origin] = JSON.parse(settingsSourceKey) as [string, SettingsOrigin | null];
    setSettingsSource({ key: settingsSourceKey, state: 'loading', context: emptySettingsContext });
    void (async () => {
      const needsCatalog = origin && origin.source.kind !== 'none' && origin.hostId === hostId;
      if (new URLSearchParams(routeRef.current.search).has(settingsOriginParameter) && !origin) throw new Error('The settings source link is invalid. Its scope has not been guessed.');
      const catalog = needsCatalog ? await client.host<ProjectState>('thread-project-state') : null;
      const context = await resolveSettingsOrigin(origin, hostId, catalog,
        (hostId, threadId) => client.rpc('thread/read', { threadId, includeTurns: false }, hostId));
      if (active) setSettingsSource({ key: settingsSourceKey, state: 'ready', context });
    })().catch(cause => {
      if (active) setSettingsSource({ key: settingsSourceKey, state: 'error', error: String(cause), context: emptySettingsContext });
    });
    return () => { active = false; };
  }, [client, settingsSourceKey, settingsSourceRetry]);
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
        if (active && revision === generation) setEditState(value);
      }).catch(cause => { if (active && revision === generation) { setEditState(null); setError((cause as Error).message); } });
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
    if (conversation.error) {
      setError(conversation.error);
      if (selectionReady.current?.key === selectionKey) {
        selectionReady.current.reject(new Error(conversation.error)); selectionReady.current = null;
      }
      return;
    }
    if (!thread || loading || thread.id !== current.threadId) return;
    setCwd(thread.cwd ?? workspace);
    setTabs(previous => previous.some(item => item.id === thread.id && item.hostId === current.hostId)
      ? previous.map(item => item.id === thread.id && item.hostId === current.hostId ? { ...item, title: title(thread), readOnly: current.readOnly } : item)
      : [...previous, { id: thread.id, hostId: current.hostId, title: title(thread), readOnly: current.readOnly }]);
    if (selectionReady.current?.key === selectionKey) { selectionReady.current.resolve(); selectionReady.current = null; }
  }, [current.hostId, current.threadId, current.readOnly, thread?.id, thread?.cwd, thread?.name, loading, conversation.error, workspace]);

  const finishSend = async (intent: SendIntent) => {
    try {
      await acknowledgeSubmittedBrowserReferences(intent, composerController.current, (await sendStore.read()).bindings);
      const controller = composerController.current, snapshot = controller?.snapshot();
      const sameDraft = snapshot?.owner.hostId === intent.owner.hostId && snapshot.owner.draftId === intent.owner.draftId;
      const confirmed = (atoms: Readonly<Record<string, unknown>>) => {
        const recovery = record(atoms[sendsAtom]), stored = record(recovery.requests)[intent.id];
        return JSON.stringify(stored) === JSON.stringify(intent) && intent.stage === 'confirmed';
      };
      if (controller && snapshot && sameDraft) await controller.clearSubmittedVersion(intent.revision, atoms => {
        const active = controller.snapshot()?.owner, bindings = record(record(atoms[sendsAtom]).bindings);
        return composerController.current === controller && confirmed(atoms) && JSON.stringify(active) === JSON.stringify(snapshot.owner)
          && (active?.threadId === intent.owner.threadId || intent.owner.threadId === null && active?.threadId === intent.threadId
            && !!intent.threadId && bindings[sendThreadKey(intent.owner.hostId, intent.threadId)] === intent.owner.draftId);
      });
      else await clearComposerDraftRevision(intent.owner, intent.revision, atoms => {
        const active = composerController.current?.snapshot()?.owner;
        return confirmed(atoms) && !(active?.hostId === intent.owner.hostId && active.draftId === intent.owner.draftId);
      });
      await sendStore.dismiss(intent.id, intent);
    } catch (cause) {
      throw new Error('消息已发送，原稿清理待处理：' + (cause instanceof Error ? cause.message : String(cause)));
    } finally { await reloadSends(); }
  };
  const submit = async (draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, origin?: MessageEditOrigin,
    description?: ComposerSubmissionDescription, retry?: SendIntent,
    visualizationSubmission?: { hostId: string; threadId: string; path: string; signal: AbortSignal }) => {
    if (inFlight.current) throw new Error('正在提交，请稍候。');
    if (loading) throw new Error('会话仍在加载，请稍候。');
    origin = origin && structuredClone(origin);
    const assertEditAuthority = origin && editAccess.capture(origin);
    const editConnectionRevision = origin && sessions.view(origin).connectionRevision;
    inFlight.current = true; setSubmitting(true); setError('');
    // A displayed recovery snapshot grants no authority over another page's
    // attempt. Only prepare/attempt may return a token owned by this invocation.
    let intent: SendIntent | undefined;
    let expectedNavigation = navigationGeneration.current;
    const hostId = current.hostId;
    const allowFirstTurn = !origin && action.type === 'send';
    const activeCwd = retry?.cwd ?? (thread?.cwd || cwd || workspace);
    const requireCurrent = (threadId: string | null) => {
      if (origin && sessions.view(origin).connectionRevision !== editConnectionRevision) {
        throw Object.assign(new Error('消息编辑的原连接已改变，编辑稿已保留，未发送。'), { uncertain: false });
      }
      if (visualizationSubmission && (visualizationSubmission.signal.aborted
        || visualizationSubmission.hostId !== hostId || visualizationSubmission.threadId !== threadId
        || !visualizationSubmission.path)) {
        throw Object.assign(new Error('可视化来源已改变，未发送新的输入。'), { uncertain: false });
      }
      if (navigationGeneration.current !== expectedNavigation || routeRef.current.hostId !== hostId || routeRef.current.threadId !== threadId || routeRef.current.readOnly) {
        throw Object.assign(new Error('会话已切换，原输入未发送并已保留。'), { uncertain: false });
      }
      const view = threadId ? sessions.view({ hostId, threadId }).snapshot() : null;
      if (view && !(view.canSubmit || allowFirstTurn && view.canStartFirstTurn)) {
        throw Object.assign(new Error('当前连接尚未确认可写会话，输入已保留。'), { uncertain: false });
      }
    };
    try {
      if (current.threadId) await sessions.ready({ hostId, threadId: current.threadId }, allowFirstTurn);
      requireCurrent(current.threadId);
      const additionalContext = retry ? retry.additionalContext : (!origin && current.threadId && action.type !== 'queue'
        ? Object.fromEntries((await readVisualizationModelContext(client, hostId, current.threadId)).map(value =>
          ['visualization:' + JSON.stringify([value.path, value.field]), { kind: 'untrusted' as const, value: JSON.stringify(value) }])) : undefined);
      requireCurrent(current.threadId);
      if (!origin) {
        if (!description || description.owner.hostId !== hostId || (retry ? retry.threadId : description.owner.threadId) !== current.threadId) {
          throw new Error('提交草稿身份已改变，未发送。');
        }
        if (!retry) {
          // The confirmed widget action supplies an immutable submission. Its
          // intent uses this owner without replacing the editable composer.
          if (!visualizationSubmission) {
            const stored = await readComposerDraft(description.owner, description.revision);
            if (!stored || JSON.stringify(stored.draft) !== JSON.stringify(draft)) throw new Error('原提交版本未能核对，未发送。');
          }
          requireCurrent(current.threadId);
          intent = await sendStore.prepare(description, activeCwd, draft, options, description.overrides,
            selectedProject?.hostId === hostId ? selectedProject.id : undefined, additionalContext, action);
        } else {
          intent = await sendStore.attempt(retry.id);
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
      const active = current.threadId ? sessions.view({ hostId, threadId: current.threadId }).snapshot() : conversation;
      const result = await submitDraft(client, { hostId, threadId: current.threadId, cwd: activeCwd, initialOptions: active.options ?? undefined,
        documentPlainTextMode: intent ? intent.documentPlainTextMode : description?.documentPlainTextMode,
        overrides: description?.overrides, additionalContext: intent ? intent.additionalContext : additionalContext,
        collaborationMode: intent?.collaborationMode, createdOptions: intent?.created?.settings,
        ...(intent ? { send: { clientUserMessageId: intent.clientUserMessageId,
          creating: async () => { requireCurrent(null); await sendStore.creating(intent!.id, intent!.attemptId); },
          created: async (created: ThreadSummary, settings: ThreadSettingsResponse) => {
            await sendStore.created(intent!.id, created.id, { thread: created, settings: sessionOptions(settings) }, intent!.attemptId);
            const controller = composerController.current, snapshot = controller?.snapshot();
            if (snapshot?.owner.hostId === intent!.owner.hostId && snapshot.owner.draftId === intent!.owner.draftId && snapshot.owner.threadId === null) {
              if (!await controller!.flush(snapshot.owner)) throw new Error('原草稿已改变，已保留创建回执，未发送输入。');
            }
            await bindComposerDraftToThread(intent!.owner, created.id);
            await reloadSends();
          },
          sending: async () => {
            const target = (await sendStore.read()).requests[intent!.id]?.threadId ?? null;
            requireCurrent(target); await sendStore.sending(intent!.id, intent!.attemptId);
          },
          confirmed: async (turnId: string) => { await sendStore.confirmed(intent!.id, turnId, intent!.attemptId); },
          queued: async (queuedSubmissionId: string) => { await sendStore.queued(intent!.id, queuedSubmissionId, intent!.attemptId); },
          resolvedCollaboration: async mode => { await sendStore.resolvedCollaboration(intent!.id, mode, intent!.attemptId); },
        } } : {}),
        activeTurnId: active.thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null, readOnly: routeRef.current.readOnly, thread: active.thread },
      draft, options, action, async created => {
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
      }, origin, (target, expected, params) => editStore.submit(target, expected, params, () => {
        assertEditAuthority?.();
        if (!origin || target.hostId !== origin.hostId || target.threadId !== origin.threadId
          || target.turnId !== origin.turnId || target.itemId !== origin.itemId) {
          throw Object.assign(new Error('消息编辑来源已改变，编辑稿已保留，未发送。'), { uncertain: false });
        }
        requireCurrent(origin.threadId);
      }));
      if (result.turn) sessions.started({ hostId, threadId: result.threadId }, result.turn);
      void refreshList().catch(cause => setError(String(cause)));
      if (intent) await finishSend((await sendStore.read()).requests[intent.id]!);
    } catch (cause) {
      if (intent) {
        await sendStore.failed(intent.id, cause, intent.attemptId).catch(storageError => setError(String(storageError)));
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
  const canRetryAction = (intent: SendIntent) => {
    const action = intent.action;
    return action?.type === 'queue' || (action?.type === 'steer'
      ? thread?.turns.some(turn => turn.id === action.turnId && turn.status === 'inProgress') === true : !busy);
  };
  const panelScope = JSON.stringify([current.hostId, current.threadId ?? newDraftId]);
  const panelCwd = thread?.cwd || cwd || workspace;
  const composerOwner = { hostId: current.hostId, threadId: current.threadId,
    draftId: current.threadId ? sendState?.bindings[sendThreadKey(current.hostId, current.threadId)] ?? current.threadId : newDraftId };
  const composerIsCurrent = composerSnapshot?.owner.hostId === composerOwner.hostId
    && composerSnapshot.owner.threadId === composerOwner.threadId && composerSnapshot.owner.draftId === composerOwner.draftId;
  const browserOwner = browserDraftOwner(composerOwner, sendState?.bindings ?? {});
  const activeBrowserOwner = useRef(browserOwner); activeBrowserOwner.current = browserOwner;
  const sendBindings = useRef(sendState?.bindings ?? {}); sendBindings.current = sendState?.bindings ?? {};
  const beginBrowserDraftOperation = useCallback((owner: BrowserOwner) => {
    const controller = composerController.current, snapshot = controller?.snapshot();
    if (!controller || !snapshot || routeRef.current.readOnly || navigationLocked.current
      || browserOwnerKey(owner) !== browserOwnerKey(activeBrowserOwner.current)
      || browserOwnerKey(browserDraftOwner(snapshot.owner, sendBindings.current)) !== browserOwnerKey(owner)) return null;
    return controller.beginExternalOperation(snapshot.owner);
  }, []);
  const acceptBrowserCommittedVersion = useCallback(async (before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => {
    const controller = composerController.current;
    if (!controller || routeRef.current.readOnly || navigationLocked.current
      || browserOwnerKey(browserDraftOwner(after.owner, sendBindings.current)) !== browserOwnerKey(activeBrowserOwner.current)) return false;
    const accepted = await controller.acceptCommittedVersion(before, after);
    if (accepted) releaseBrowserProjection(after);
    return accepted;
  }, [releaseBrowserProjection]);
  useEffect(() => {
    if (!composerSnapshot || browserOwnerKey(browserDraftOwner(composerSnapshot.owner, sendBindings.current)) !== browserOwnerKey(browserOwner)) return;
    setBrowserSyncError('');
    return watchBrowserDraftDeletions(browserOwner, () => {
      const snapshot = composerController.current?.snapshot();
      return snapshot && browserOwnerKey(browserDraftOwner(snapshot.owner, sendBindings.current)) === browserOwnerKey(browserOwner) ? snapshot : null;
    }, async () => {
      const operation = beginBrowserDraftOperation(browserOwner);
      if (!operation) return false;
      await syncBrowserDraftDeletions(browserOwner, operation, retainBrowserProjection, releaseBrowserProjection);
      return true;
    }, cause => setBrowserSyncError(String(cause)));
  }, [browserOwner.hostId, browserOwner.threadId, browserOwner.draftId, composerSnapshot?.revision, browserSyncRetry, beginBrowserDraftOperation, retainBrowserProjection, releaseBrowserProjection]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (Object.keys(browserProjections.current).length) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
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
  const showPanel = (request?: { kind: 'terminal'; reuse?: boolean } | { kind: 'file'; path: string; line?: number; column?: number } | { kind: 'diff'; path?: string; diff?: string }) => {
    if (request?.kind === 'terminal' && status !== 'connected') {
      setError('终端当前不可用：主机连接已断开或尚未就绪，请先重新连接。');
      return;
    }
    setPanelMounted(true); setPanelKind('workspace'); setPanelOpen(true);
    if (request) setPanelRequest({ ...request, id: crypto.randomUUID(), scopeId: panelScope, hostId: current.hostId, cwd: panelCwd });
  };
  const openFile = (path: string, line?: number, column?: number, fileCwd = panelCwd) =>
    showPanel({ kind: 'file', path: resolveFilePath(fileCwd, path), line, column });
  const addReference = async (draft: ComposerDraft) => {
    const controller = composerController.current, snapshot = controller?.snapshot();
    if (!controller || !snapshot || navigationLocked.current || routeRef.current.readOnly
      || snapshot.owner.hostId !== routeRef.current.hostId || snapshot.owner.threadId !== routeRef.current.threadId)
      throw new Error('原输入区尚未就绪，引用未加入，请保留来源后重试。');
    const operation = controller.beginExternalOperation(snapshot.owner);
    if (!operation) throw new Error('原输入区正在处理其他输入，引用未加入，请重试。');
    let accepted = false;
    try {
      accepted = await operation.applyPrefill({ id: crypto.randomUUID(), draft: structuredClone(draft) });
      if (!accepted) throw new Error('引用尚未保存，来源内容已保留。');
      if (controller === composerController.current) setPanelOpen(false);
    } finally { operation.finish(accepted); }
  };
  const turnDiff = [...thread?.turns ?? []].reverse().map(turn => record(turn).diff).find(value => typeof value === 'string') as string | undefined;
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
      const readOnly = await readThreadArchived(client, { hostId: tab.hostId, threadId: tab.id });
      if (navigationGeneration.current !== generation) return;
      setTabs(previous => previous.map(value => value.id === tab.id && value.hostId === tab.hostId ? { ...value, readOnly } : value));
      if (navigationGeneration.current === generation) await openThread(tab.id, tab.hostId, readOnly);
    } catch (cause) { setError(String(cause)); }
  };

  const shortcuts = useWorkbenchShortcuts(client, {
    blocked: () => navigationLocked.current || leaving || menu || Boolean(approvalDialog),
    selectTab: slot => {
      const ordered = document.documentElement.dir === 'rtl' ? [...tabs].reverse() : tabs;
      const tab = ordered[slot - 1];
      if (!tab) return false;
      void openTab(tab); return true;
    },
    toggleTerminal: () => {
      if (current.section || !panelCwd) return false;
      if (status !== 'connected') { showPanel({ kind: 'terminal', reuse: true }); return true; }
      if (panelOpen && panelKind === 'workspace' && workspacePanels.current?.isActiveTerminal()) setPanelOpen(false);
      else showPanel({ kind: 'terminal', reuse: true });
      return true;
    },
  });
  const shortcutSidebarHints = new Map(shortcuts.hints === 'sidebar' ? shortcuts.sidebarHintKeys.map((key, index) =>
    [key, shortcuts.label('sidebar', index + 1 as NumberShortcutSlot)] as const) : []);
  return <I18nProvider locale={previewAppearance.locale}><div className="yard-app" data-sidebar-open={sidebar} data-owned-renderer="true">
    {sidebar && <StandaloneSidebar hostId={current.hostId} currentThread={current.threadId ? { hostId: current.hostId, threadId: current.threadId } : null}
      projectState={projectState} fallbackWorkspace={workspace} rows={list.rows} nextCursor={list.nextCursor} loading={list.loading} error={list.error}
      search={search} archived={archived} shortcutHints={shortcutSidebarHints} onSearchChange={setSearch} onArchivedChange={setArchived} onClose={() => setSidebar(false)}
      onOpenThread={row => { void openThread(row.id, row.hostId, row.archived); }}
      onNewChat={(project, fallback) => { void newChat(project?.rootPaths[0] ?? cwd, fallback ? undefined : project ?? undefined); }}
      onAddProject={addProject} onOpenSettings={() => { void navigate('/settings/general' + (current.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(current.hostId))); }}
      onRefresh={() => { void list.refresh(); }} onLoadMore={() => { void list.loadMore(); }} onRetryProjectLookup={() => { void reloadProjects().catch(cause => setError(String(cause))); }} />}
    <main className="yard-main">
      <header className="yard-toolbar"><button aria-label="Toggle sidebar" onClick={() => setSidebar(value => !value)}>◧</button>
        <div className="yard-tab-strip" role="tablist" aria-label="Workspace tabs">{tabs.map((tab, index) => {
          const slot = document.documentElement.dir === 'rtl' ? tabs.length - index : index + 1;
          return <div className="yard-tab" key={tab.hostId + ':' + tab.id}><button role="tab" aria-selected={tab.id === current.threadId && tab.hostId === current.hostId} onClick={() => { void openTab(tab); }}>{tab.title}{shortcuts.hints === 'tabs' && slot <= 9 && <kbd>{shortcuts.label('tabs', slot as NumberShortcutSlot)}</kbd>}</button><button aria-label={'Close ' + tab.title} onClick={() => setTabs(previous => previous.filter(item => item !== tab))}>×</button></div>;
        })}</div>
        <select aria-label="Execution host" value={current.hostId} onChange={event => navigate('/?hostId=' + encodeURIComponent(event.target.value))}>{hosts.map(host => <option key={host.hostId} value={host.hostId}>{host.displayName}</option>)}</select>
        <span className="yard-connection" title={'Browser: ' + bridgeStatus + '; Host: ' + (hostStatuses[current.hostId] ?? 'connecting')} data-state={status}>●</span>
        {requests.length > 0 && <label>Requests <select aria-label="Inspect approval request" value={selectedRequestEntry ? JSON.stringify(selectedRequestEntry.request.ref) : ''}
          onChange={event => { setSelectedRequest(JSON.parse(event.target.value) as ServerRequestRef); setRequestViewHidden(false); }}>
          {requests.map(entry => <option key={JSON.stringify(entry.request.ref)} value={JSON.stringify(entry.request.ref)}>
            {entry.request.hostId}: {entry.request.method} · {entry.outcome}
          </option>)}
        </select><button type="button" onClick={() => setRequestViewHidden(false)}>Open request</button></label>}
        {bridgeStatus === 'connected' && hostStatuses[current.hostId] === 'disconnected' && <button onClick={() => {
          const hostId = current.hostId;
          void client.rpc('thread/list', { limit: 1 }, hostId).catch(cause => setError(String(cause)));
        }}>Reconnect host</button>}
        <button aria-label="Workspace files" aria-pressed={panelOpen && panelKind === 'workspace'} onClick={() => showPanel()}>Files</button>
        <button aria-label="Open terminal" onClick={() => showPanel({ kind: 'terminal' })}>Terminal</button>
        <button aria-label="Open Chrome panel" disabled={!sendState} aria-pressed={panelOpen && panelKind === 'browser'} onClick={() => showBrowser()}>Chrome</button>
        {visualization?.hostId === current.hostId && visualization.threadId === current.threadId && <button aria-label="Open visualization" onClick={() => showVisualization(visualization)}>Preview</button>}
        {turnDiff !== undefined && <button aria-label="Open turn changes" onClick={() => showPanel({ kind: 'diff', diff: turnDiff })}>Changes</button>}
      </header>
      {error && <div role="alert" className="yard-error">{error}<button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {browserSyncError && <div role="alert" className="yard-error">{browserSyncError}<button onClick={() => setBrowserSyncRetry(value => value + 1)}>Retry browser reference sync</button></div>}
      {Object.entries(browserProjectionState).map(([key, receipt]) => <BrowserDraftRecoveryNotice key={key} before={receipt.before} snapshot={receipt.after}
        onAccept={() => acceptBrowserCommittedVersion(receipt.before, receipt.after)} onDiscard={() => releaseBrowserProjection(receipt.after)} />)}
      {Object.values(sendState?.requests ?? {}).map(intent => <SendRecoveryNotice key={intent.id} intent={intent}
        canRetry={!submitting && !loading && canRetryAction(intent) && !current.readOnly && current.hostId === intent.owner.hostId && current.threadId === intent.threadId
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
        onRetry={() => submit(intent.draft, intent.options, intent.action ?? { type: 'send' }, undefined,
          { owner: intent.owner, revision: intent.revision, overrides: intent.overrides }, intent)}
        onFinish={() => finishSend(intent)} onCancel={async () => { await sendStore.cancel(intent.id); await reloadSends(); }} />)}
      <div className="yard-workspace" data-panel-open={panelOpen && !settings}>
      <div className="yard-chat-pane">
      {settings ? <InstructionEditorTheme.Provider value={panelAppearance.theme}><StandaloneSettings client={client} hostId={current.hostId}
        projectRoots={settingsContext.projectRoots} sessionCwd={settingsContext.sessionCwd} InstructionEditor={SettingsInstructionEditor}
        scopeStatus={{ state: settingsSource.key === settingsSourceKey ? settingsSource.state : 'loading',
          error: settingsSource.key === settingsSourceKey ? settingsSource.error : undefined, retry: () => setSettingsSourceRetry(value => value + 1) }}
        location={{ pathname: current.pathname, search: current.search, hash: current.hash, state: current.state }} onNavigate={navigate}
        registerNavigationGuard={registerNavigationGuard} onClose={() => navigate(settingsOrigin?.returnTo ?? '/')} /></InstructionEditorTheme.Provider> : <>
        {current.threadId && <header className="yard-conversation-header"><strong>{thread?.name || threads.find(item => item.id === current.threadId)?.name || 'Conversation'}</strong><span>{thread?.cwd}</span><button aria-label="Conversation menu" onClick={() => setMenu(value => !value)}>•••</button>{menu && <div className="yard-menu" role="menu">{['rename', 'fork', 'copy', 'archive'].map(name => <button role="menuitem" key={name} onClick={() => { void action(name); }}>{name === 'copy' ? 'Copy conversation link' : name[0]!.toUpperCase() + name.slice(1)}</button>)}</div>}</header>}
        <section className={'yard-conversation ' + (!current.threadId ? 'yard-home' : '')} inert={leaving}>
          {streamGap && <p role="status" className="yard-stream-gap">此页面未收到连续的活动内容，正在核对会话记录。{isThreadBusy(thread) && '任务正在运行；完成后将重新读取完整记录。'}</p>}
          {loading ? <div role="status" className="yard-loading">Loading conversation…</div> : current.threadId ? <StandaloneMessages client={client} hostId={current.hostId} thread={thread} editRecovery={editState?.recovery ?? null} editAccess={editAccess} editHistory={{ order: 'ascending', tailComplete: historyComplete }}
            editRebase={messageEditRebaseMarker(editState)} onPrepareEditRebase={(origin, version) => editStore.prepareRebase(origin, version)}
            onCommitEditRebase={async candidate => {
              const recovered = await editStore.commitRebase(candidate);
              void sessions.refresh(recovered.origin).catch(cause => setError(String(cause)));
              return recovered;
            }}
            onEditNavigationController={receiveMessageEditController}
            onEditDraftChange={(value, origin, version) => editStore.save(value, origin, version)}
            onOpenFile={openFile} onOpenFileAt={location => {
              if (location.hostId !== current.hostId) { setError('文件所属主机已改变，请返回原会话打开。'); return; }
              openFile(location.path, location.line, location.column, location.cwd ?? panelCwd);
            }} onOpenVisualization={showVisualization} onOpenBrowser={showBrowser}
            onEdit={current.readOnly ? undefined : (draft, origin) => submit(draft, initialOptions ?? {}, { type: 'send' }, origin)} onFork={turnId => action('fork', turnId)} /> : <div className="yard-home-heading"><img src="/brand/icon.svg" alt="" /><h1>What would you like to work on?</h1><p>{cwd || workspace}</p></div>}
        </section>
        <div className="yard-composer-container" inert={leaving}>
          {current.threadId && !loading && <StandaloneGoal client={client} hostId={current.hostId} threadId={current.threadId} readOnly={current.readOnly} />}
          {current.readOnly && <p role="status">此会话已归档，原输入已保留。<button onClick={() => { void client.rpc('thread/unarchive', { threadId: current.threadId }, current.hostId).then(() => openThread(current.threadId!, current.hostId, false)).catch(cause => setError(String(cause))); }}>Restore conversation</button></p>}
          <div inert={current.readOnly}>
          {!sendState || current.threadId && (loading || !initialOptions) && !(composerIsCurrent || current.readOnly && thread) ? current.readOnly ? null : <p role="status">Loading session settings…</p> : <StandaloneComposer key={current.hostId + ':' + (current.threadId ?? newDraftId)} client={client} context={{ ...composerOwner, cwd: thread?.cwd ?? cwd }}
          onRemoveReference={(owner, reference, operation) => removeBrowserDraftReference(browserDraftOwner(owner, sendBindings.current), reference,
            operation, retainBrowserProjection, releaseBrowserProjection)}
          onDraftController={receiveComposerController} onDraftChange={receiveComposerSnapshot} initialOptions={initialOptions ?? undefined} hosts={hosts} onTargetChange={async (target, lease) => {
          const controller = composerController.current, snapshot = controller?.snapshot();
          if (!controller || !snapshot || targetChange.current) throw new Error('原输入区不能切换目标。');
          let committed!: () => void;
          const completion = new Promise<void>(resolve => { committed = resolve; });
          const pending = { controller, owner: snapshot.owner, lease, target, committed };
          targetChange.current = pending;
          try {
            if (!await navigate('/' + (target.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(target.hostId)))) throw new Error('目标切换未完成，原草稿已保留。');
            rememberNewDraftLocation(target.hostId, homeDraftIdentity(target.hostId), target.cwd); setCwd(target.cwd); setSelectedProject(null);
            await completion;
          } finally { if (targetChange.current === pending) { targetChange.current = null; setLeaving(false); } }
        }} activeTurnId={thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null} busy={busy}
          onSubmit={(draft, options, action, description) => submit(draft, options, action, undefined, description)} onInterrupt={interrupt} onStartQueued={async queuedSubmissionId => {
          if (!current.threadId || current.readOnly || inFlight.current || isThreadBusy(threadRef.current)) throw new Error('当前会话暂时无法启动队列。');
          const identity = { hostId: current.hostId, threadId: current.threadId }, generation = navigationGeneration.current;
          inFlight.current = true; setSubmitting(true);
          try {
            await sessions.ready(identity);
            const view = sessions.view(identity).snapshot(), route = routeRef.current;
            if (generation !== navigationGeneration.current || route.hostId !== identity.hostId || route.threadId !== identity.threadId
              || route.readOnly || !view.canSubmit || isThreadBusy(view.thread)) throw new Error('会话目标或状态已改变，队列未启动。');
            await client.rpc('thread/queue/start', { threadId: identity.threadId, queuedSubmissionId }, identity.hostId);
          }
          finally { inFlight.current = false; setSubmitting(false); }
        }} />}</div></div>
      </>}
      </div>
      <aside className="yard-workspace-panel" hidden={!panelOpen || settings} aria-label="Workspace panel" inert={leaving}>
        <div hidden={panelKind !== 'workspace'} style={{ height: '100%' }}>{panelMounted && <WorkspacePanels ref={workspacePanels} client={client} scopeId={panelScope} hostId={current.hostId} threadId={current.threadId ?? undefined} cwd={panelCwd}
          appearance={panelAppearance} request={panelRequest} onRequestConsumed={id => setPanelRequest(previous => previous?.id === id ? null : previous)}
          onRecoveryBarrier={receivePanelRecoveryBarrier}
          onClose={() => setPanelOpen(false)} onReference={addReference} onDirtyChange={dirty => { panelsDirty.current = dirty; }} />}</div>
        {browserMounted && <StandaloneBrowser client={client} {...browserOwner} browserTabId="primary"
          draft={composerSnapshot && browserOwnerKey(browserDraftOwner(composerSnapshot.owner, sendState?.bindings ?? {})) === browserOwnerKey(browserOwner)
            ? composerSnapshot.draft : { text: '', images: [], files: [] }}
          visible={panelOpen && !settings && panelKind === 'browser'} allowNavigation
          navigationRequest={browserNavigation} onNavigationConsumed={id => setBrowserNavigation(previous => previous?.id === id ? null : previous)}
          beginDraftOperation={beginBrowserDraftOperation} onDraftVersionCommitted={acceptBrowserCommittedVersion}
          onRecoveryBarrier={receiveBrowserRecoveryBarrier} onClose={() => setPanelOpen(false)} />}
        {panelOpen && !settings && panelKind === 'visualization' && visualization?.hostId === current.hostId && visualization.threadId === current.threadId
          && <StandaloneVisualization client={client} {...visualization} theme={previewAppearance.theme} themeVariables={previewAppearance.variables}
            locale={previewAppearance.locale} onPrefill={addReference} onFollowUp={async (request, signal) => {
              if (leaving || navigationLocked.current || signal.aborted || current.readOnly || !composerIsCurrent
                || request.hostId !== current.hostId || request.threadId !== current.threadId) {
                throw new Error('可视化所属会话尚未就绪，输入未发送。');
              }
              const activeTurn = threadRef.current?.turns.find(turn => turn.status === 'inProgress');
              await submit(structuredClone(request.draft), initialOptions ?? {}, activeTurn ? { type: 'steer', turnId: activeTurn.id } : { type: 'send' },
                undefined, { owner: { ...composerOwner }, revision: crypto.randomUUID(), overrides: {} }, undefined,
                { hostId: request.hostId, threadId: request.threadId, path: request.path, signal });
            }} onClose={() => setPanelOpen(false)} />}
      </aside>
      </div>
    </main>
    {approvalDialog && <ApprovalDialog key={JSON.stringify(approvalDialog.request.ref)} {...approvalDialog}
      onCloseView={() => setRequestViewHidden(true)}
      onInputEscape={async origin => { await client.host('approval-request-interrupt', { ref: origin.ref, hostId: origin.hostId,
        threadId: origin.threadId, turnId: origin.turnId }); }} />}
  </div></I18nProvider>;
}
