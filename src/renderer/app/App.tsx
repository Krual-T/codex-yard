import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { Folder, Globe, ListTodo, MoreHorizontal, PanelLeftOpen, PanelRight, Terminal } from 'lucide-react';
import type { ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDocument, ComposerDraft, MessageEditOrigin, ServerRequestRef, SubmitAction, SubmitOptions, WorkbenchEvent } from '../workbench-contract.ts';
import { StandaloneComposer, bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftLease, ComposerDraftOwner, ComposerDraftSnapshot, ComposerPromptAppendPort, ComposerSubmissionDescription } from '../composer/StandaloneComposer.tsx';
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
import { captureDraftInjection, submitDraft } from './submission.ts';
import { applyAppearance } from './appearance.ts';
import { sessionOptions } from './session-options.ts';
import { MessageEditRecoveryStore, messageEditChanged, messageEditRebaseMarker, messageEditsAtom } from './message-edit-recovery.ts';
import type { StoredMessageEdit } from './message-edit-recovery.ts';
import { projectForThread, projectsForHost } from './projects.ts';
import type { Project, ProjectState } from './projects.ts';
import { StandaloneSidebar } from '../sidebar/StandaloneSidebar.tsx';
import { useThreadList } from '../sidebar/use-thread-list.ts';
import { useSidebarBehavior } from './use-sidebar-behavior.ts';
import { createSidebarActionService } from './sidebar-action-service.ts';
import { ThreadSummaryPanel } from './ThreadSummaryPanel.tsx';
import type { ThreadSummaryCreateKind } from './ThreadSummaryPanel.tsx';
import { createSummaryOutputPrefill } from './summary-output-prefill.ts';
import { HomeSubagentsBanner } from './HomeSubagentsBanner.tsx';
import { projectCreatedChats } from './thread-summary-created-chats.ts';
import { sameSummarySideChat, useSummarySideChats } from './use-summary-side-chats.ts';
import { commitSidebarProjectMembership, createSidebarProjectInventory } from './sidebar-project-inventory.ts';
import { WorkspacePanels } from '../panels/WorkspacePanels.tsx';
import type { WorkspacePanelAppearance, WorkspacePanelRequest, WorkspacePanelsHandle } from '../panels/WorkspacePanels.tsx';
import { resolveFilePath } from '../files/file-service.ts';
import { createRouteNavigation } from './route-navigation.ts';
import { captureSettingsOrigin, emptySettingsContext, readSettingsOrigin, readSettingsOriginURL, resolveSettingsOrigin, settingsOriginParameter, settingsOriginURL } from './settings-origin.ts';
import type { SettingsContext, SettingsOrigin } from './settings-origin.ts';
import { SendRecoveryStore, sendsAtom, sendThreadKey } from './send-recovery.ts';
import type { SendIntent, SendRecoverySnapshot } from './send-recovery.ts';
import { SendRecoveryNotice } from './SendRecoveryNotice.tsx';
import { FullAccessNotice } from './FullAccessNotice.tsx';
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
import { useShellPreferences } from './use-shell-preferences.ts';
import { SideChatRoot } from '../side-chat/SideChatRoot.tsx';
import type { SideChatRootChild, SideChatRootController, SideChatRootParentGrant } from '../side-chat/SideChatRoot.tsx';
import type { SideChatWorkspaceNavigationLease } from './SideChatWorkspace.tsx';
import type { SideChatBrowserIdentity, SideChatSendLease } from '../side-chat/browser-authority.ts';
import type { SideChatWorkspaceIdentity } from './side-chat-workspace-runtime.ts';
import { fullAccessVisible } from '../settings/preferences.ts';
import { ProductWorkspace } from './ProductWorkspace.tsx';
import { readProductRoute } from './product-routes.ts';
import type { ProductRouteOwner } from './ProductRoutePage.tsx';
import { settingsConfigOperations } from '../settings/config-operations.ts';
import { configReadSource, sameConfigSource } from '../settings/config-source.ts';
import { userConfigTarget } from '../settings/config-target.ts';
import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';
import { saveComposerDraftConflict } from '../composer/composer-draft-store.ts';
import { normalizeDraft } from '../composer/standalone-draft.ts';
import type { NumberShortcutSlot } from './workbench-shortcuts.ts';
import './app.css';

type ThreadRow = ThreadSummary & { preview?: string; updatedAt?: number; createdAt?: number };
interface Host { hostId: string; displayName: string }
interface Route { pathname: string; search: string; hash: string; state: unknown; threadId: string | null; hostId: string; section: string | null; readOnly: boolean }
type SideChatPanelSource = Pick<SideChatRootChild, 'identity' | 'owner'>;
const sameComposerOwner = (left: ComposerDraftOwner, right: ComposerDraftOwner) => left.hostId === right.hostId
  && left.threadId === right.threadId && left.draftId === right.draftId;
const composerOwnerKey = (owner: ComposerDraftOwner) => JSON.stringify([owner.hostId, owner.threadId, owner.draftId]);
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
  const shellPreferences = useShellPreferences(client);
  const [current, setCurrent] = useState(route);
  const [bridgeStatus, setBridgeStatus] = useState('connecting');
  const [hostStatuses, setHostStatuses] = useState<Record<string, string>>({});
  const [sidebarAccount, setSidebarAccount] = useState<{ hostId: string; label: string } | null>(null);
  const status = bridgeStatus === 'connected' ? hostStatuses[current.hostId] ?? 'connecting' : bridgeStatus;
  const connectionReadGeneration = useRef(0);
  const transportIdentity = useRef({ bridge: 'connecting', bridgeRevision: 0, hosts: {} as Record<string, { state: string; revision: number }> });
  const mainGrantRevision = useRef(0);
  const mainSubmissionAuthorities = useRef(new WeakMap<() => void, {
    daemon: ReturnType<BrowserWorkbenchClient['captureDaemonConnection']>;
    owner: ComposerDraftOwner;
    acceptCreated(threadId: string, navigation: number): void;
  }>());
  const [error, setError] = useState('');
  const conversationError = useRef('');
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
  const settingsContextIdentity = useRef({ key: settingsSourceKey, context: settingsContext });
  settingsContextIdentity.current = { key: settingsSourceKey, context: settingsContext };
  const [hosts, setHosts] = useState<Host[]>([{ hostId: 'local', displayName: 'Local' }]);
  const [hostCatalogReady, setHostCatalogReady] = useState(false);
  const hostCatalogConfirmed = useRef(false);
  const hostCatalogRead = useRef(0);
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
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalMounted, setGoalMounted] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [fullAccessDismissed, setFullAccessDismissed] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [navigationCommit, setNavigationCommit] = useState(0);
  const [navigationFactsEpoch, setNavigationFactsEpoch] = useState(0);
  const [editState, setEditState] = useState<StoredMessageEdit | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelKind, setPanelKind] = useState<'workspace' | 'browser' | 'visualization' | 'side-chat'>('workspace');
  const sideChats = useRef<SideChatRootController | null>(null);
  const sideChatNavigation = useRef<SideChatWorkspaceNavigationLease | null>(null);
  const sideChatFlushed = useRef(false);
  const sideChatActive = useRef<SideChatRootChild | null>(null);
  const [sideChatChild, setSideChatChild] = useState<SideChatRootChild | null>(null);
  const [sideChatSource, setSideChatSource] = useState<SideChatPanelSource | null>(null);
  const sideChatSourceRef = useRef(sideChatSource); sideChatSourceRef.current = sideChatSource;
  const [sideChatOpened, setSideChatOpened] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [, setSideChatProjectionRevision] = useState(0);
  const frozenChildOwners = useRef(new Map<string, object>());
  const receiveSideChatController = useCallback((controller: SideChatRootController | null) => { sideChats.current = controller; setSideChatProjectionRevision(value => value + 1); }, []);
  const receiveSideChatChild = useCallback((child: SideChatRootChild | null) => { sideChatActive.current = child; setSideChatChild(child); setSideChatProjectionRevision(value => value + 1); }, []);
  const releaseSideChatNavigation = () => {
    const lease = sideChatNavigation.current;
    if (!lease) return;
    // An uncertain revoke retains only its own child leases. A later explicit
    // navigation retries that same revoke; it never acquires a replacement.
    try { lease.release(); sideChatNavigation.current = null; sideChatFlushed.current = false; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
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
  const releaseEditAcquisitionFreeze = useRef<(() => void) | null>(null);
  const composerNavigationLease = useRef<ComposerDraftLease | null>(null);
  const targetChange = useRef<{ controller: ComposerDraftController; owner: ComposerDraftSnapshot['owner']; lease: ComposerDraftLease;
    target: { hostId: string; cwd: string }; committed(): void } | null>(null);
  const navigationLocked = useRef(false);
  const committedNavigation = useRef<{ id: number; target: Route } | null>(null);
  useLayoutEffect(() => {
    const commit = committedNavigation.current;
    if (!commit || commit.id !== navigationCommit || current.hostId !== commit.target.hostId
      || current.threadId !== commit.target.threadId || current.section !== commit.target.section) return;
    const pending = targetChange.current;
    if (pending && (current.hostId !== pending.target.hostId || current.threadId !== null || current.section
      || cwd !== pending.target.cwd || composerController.current?.snapshot()?.owner.hostId !== pending.target.hostId)) return;
    // Keep the original editor frozen until the new route actually commits.
    const editLease = navigationLease.current;
    try {
      if (sideChatNavigation.current) {
        sideChatNavigation.current.handoff();
        sideChatNavigation.current.release(); sideChatNavigation.current = null; sideChatFlushed.current = false;
        setSideChatOpened(false); setSideChatSource(null);
        if (sideChatOpened || sideChatSource) setPanelOpen(false);
      }
      if (editLease) {
        if (!current.section && current.hostId === editLease.origin.hostId && current.threadId === editLease.origin.threadId) editLease.release();
        else editLease.handoff();
      }
    } catch (cause) {
      editLease?.release();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      navigationLease.current = null;
      releaseEditAcquisitionFreeze.current?.(); releaseEditAcquisitionFreeze.current = null;
      composerNavigationLease.current?.release(); composerNavigationLease.current = null; navigationLocked.current = false;
      committedNavigation.current = null;
      setLeaving(false);
      if (pending) { targetChange.current = null; pending.committed(); }
    }
  }, [navigationCommit, current.hostId, current.threadId, current.section, current.readOnly, cwd]);
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
  useEffect(() => {
    const hostId = current.hostId;
    let alive = true, sequence = 0;
    const reset = () => { sequence++; setSidebarAccount(null); };
    const read = async () => {
      const request = ++sequence;
      try {
        const daemon = client.captureDaemonConnection(hostId);
        const result = await client.rpc('account/read', { refreshToken: false }, hostId,
          { daemonConnectionGeneration: daemon.generation, assertBeforeSend: daemon.assertOriginal });
        daemon.assertOriginal();
        const account = record(record(result).account), email = account.email;
        let label = typeof email === 'string' ? email.trim() : '';
        if (!label && account.type === 'apiKey') {
          if (!alive || request !== sequence) return;
          const read = await client.rpc('config/read', { includeLayers: false }, hostId, { assertBeforeSend: daemon.assertOriginal });
          daemon.assertOriginal();
          const provider = record(record(read).config).model_provider;
          label = typeof provider === 'string' && provider.trim() && provider !== 'openai' ? provider.trim() : 'OpenAI';
        }
        if (alive && request === sequence) setSidebarAccount({ hostId, label });
      } catch { if (alive && request === sequence) setSidebarAccount(null); }
    };
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed' && event.hostId === hostId) {
        if (event.state === 'connected') void read(); else reset();
      } else if (event.type === 'mcp-notification' && event.hostId === hostId && event.method === 'account/updated') void read();
    });
    reset(); void read();
    return () => { alive = false; sequence++; unsubscribe(); };
  }, [client, current.hostId]);
  const composerController = useRef<ComposerDraftController | null>(null);
  const mainPromptAppendPort = useRef<ComposerPromptAppendPort | null>(null);
  const receivePromptAppendPort = useCallback((port: ComposerPromptAppendPort | null) => { mainPromptAppendPort.current = port; }, []);
  const [composerSnapshot, setComposerSnapshot] = useState<ComposerDraftSnapshot | null>(null);
  const [effectiveComposerOptions, setEffectiveComposerOptions] = useState<{ owner: ComposerDraftOwner; options: SubmitOptions } | null>(null);
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
  const receiveEffectiveOptions = useCallback((owner: ComposerDraftOwner, options: SubmitOptions) => {
    const current = composerController.current?.snapshot()?.owner;
    if (!current || current.hostId !== owner.hostId || current.threadId !== owner.threadId || current.draftId !== owner.draftId) return;
    setEffectiveComposerOptions({ owner: structuredClone(owner), options: structuredClone(options) });
  }, []);
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
  const mainIdleWaiters = useRef(new Set<() => void>());
  const finishMainDispatch = () => {
    inFlight.current = false; setSubmitting(false);
    for (const done of mainIdleWaiters.current) done();
    mainIdleWaiters.current.clear();
  };
  const selectionReady = useRef<{ key: string; resolve(): void; reject(error: Error): void } | null>(null);
  const settingsGuard = useRef<{ requestLeave(): Promise<boolean> } | null>(null);
  const navigation = useRef<ReturnType<typeof createRouteNavigation> | null>(null);
  const navigationGeneration = useRef(0);
  // Archive notifications update the current thread's read-only facts, but do
  // not change the document in which a sidebar action was requested.
  const sidebarNavigationRevision = useRef(0);
  const threadRef = useRef(thread); threadRef.current = thread;
  const projectStateRef = useRef(projectState); projectStateRef.current = projectState;
  const selectedProjectRef = useRef(selectedProject); selectedProjectRef.current = selectedProject;
  const routeRef = useRef(current); routeRef.current = current;
  const projectGeneration = useRef(0);
  const projectResponseGeneration = useRef(0);
  const preferenceGeneration = useRef(0);
  const reloadProjects = useCallback(async () => {
    const generation = ++projectGeneration.current;
    const response = ++projectResponseGeneration.current;
    const state = await client.host<ProjectState>('thread-project-state');
    if (generation === projectGeneration.current && response === projectResponseGeneration.current) setProjectState(state);
  }, [client]);

  const navigate = useCallback((path: string, options?: { replace?: boolean; delta?: number; state?: unknown }, assertBeforeCommit?: () => void) => {
    navigationGeneration.current++;
    sidebarNavigationRevision.current++;
    const previous = routeRef.current;
    if (!options?.delta && new URL(path, location.href).pathname.split('/')[1] === 'settings') {
      const origin = previous.section ? readSettingsOriginURL(previous.search) ?? readSettingsOrigin(previous.state)
        : captureSettingsOrigin(previous, selectedProjectRef.current);
      if (!new URL(path, location.href).searchParams.has(settingsOriginParameter)) path = settingsOriginURL(path, origin);
    }
    return navigation.current?.navigate(path, options, assertBeforeCommit) ?? Promise.resolve(false);
  }, []);
  const registerNavigationGuard = useCallback((guard: { requestLeave(): Promise<boolean> } | null) => { settingsGuard.current = guard; }, []);
  const openThread = (id: string, hostId = current.hostId, readOnly = false) => {
    const search = new URLSearchParams(); if (hostId !== 'local') search.set('hostId', hostId); if (readOnly) search.set('archived', '1');
    return navigate(`/local/${encodeURIComponent(id)}${search.size ? '?' + search : ''}`);
  };
  const refreshList = useCallback(() => listRef.current.refresh(), []);
  const reloadHosts = useCallback(async () => {
    const generation = ++hostCatalogRead.current;
    hostCatalogConfirmed.current = false; setHostCatalogReady(false);
    const result = await client.host<{ remoteConnections: unknown }>('refresh-remote-connections');
    if (generation !== hostCatalogRead.current) return;
    if (!Array.isArray(result.remoteConnections) || result.remoteConnections.some(value =>
      typeof record(value).hostId !== 'string' || typeof record(value).displayName !== 'string')) {
      throw new Error('执行主机列表尚未核实，请重新连接后重试。');
    }
    setHosts([{ hostId: 'local', displayName: 'Local' }, ...result.remoteConnections as Host[]]);
    hostCatalogConfirmed.current = true; setHostCatalogReady(true);
  }, [client]);
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
      if (next.section && !routeRef.current.section) setSettingsSourceEpoch(value => value + 1);
      const id = ++navigationGeneration.current;
      sidebarNavigationRevision.current++;
      committedNavigation.current = { id, target: next };
      setLeaving(true); setCurrent(next); setNavigationCommit(id); setError(''); setMenu(false);
    }, async () => {
      navigationLocked.current = true;
      let accepted = false;
      try {
        const originalRoute = routeRef.current;
        releaseEditAcquisitionFreeze.current = !originalRoute.section && originalRoute.threadId
          ? editAccess.freezeAcquisition({ hostId: originalRoute.hostId, threadId: originalRoute.threadId }) : null;
        navigationLease.current = messageEditController.current?.freeze() ?? null;
        const composer = composerController.current, snapshot = composer?.snapshot();
        const borrowed = targetChange.current?.controller === composer ? targetChange.current.lease : undefined;
        composerNavigationLease.current = snapshot ? composer!.freeze(snapshot.owner, borrowed) : null;
        if (composer && (!snapshot || !composerNavigationLease.current)) return false;
        if (!sideChatNavigation.current && sideChats.current) {
          sideChatNavigation.current = sideChats.current.freeze(); sideChatFlushed.current = false;
          if (!sideChatNavigation.current) return false;
        }
        // Apply native inert before the first await so input cannot change while
        // the message, composer and file transactions are being drained.
        flushSync(() => setLeaving(true));
        await navigationLease.current?.flush();
        if (composerNavigationLease.current && !await composerNavigationLease.current.flush()) return false;
        if (sideChatNavigation.current && !sideChatFlushed.current) {
          if (!await sideChatNavigation.current.flush()) return false;
          sideChatFlushed.current = true;
        }
        if (settingsGuard.current && !await settingsGuard.current.requestLeave()) return false;
        if (panelsDirty.current && !window.confirm('Keep unsaved file changes and switch pages?')) return false;
        await panelRecoveryBarrier.current?.();
        await browserRecoveryBarrier.current?.();
        if (Object.keys(browserProjections.current).length) throw new Error('浏览器引用有已保存但尚未接收的版本，请先核对、复制或明确放弃。');
        await navigationLease.current?.flush();
        if (composerNavigationLease.current && !await composerNavigationLease.current.flush()) return false;
        await sideChatNavigation.current?.revoke();
        accepted = true;
        return true;
      } catch (cause) { accepted = false; setError(String(cause)); return false; }
      finally { if (!accepted) {
        releaseSideChatNavigation();
        navigationLease.current?.release(); navigationLease.current = null;
        releaseEditAcquisitionFreeze.current?.(); releaseEditAcquisitionFreeze.current = null;
        composerNavigationLease.current?.release(); composerNavigationLease.current = null; navigationLocked.current = false; setLeaving(false);
      } }
    }, (committed, cause) => {
      if (!committed) {
        releaseSideChatNavigation();
        committedNavigation.current = null;
        navigationLease.current?.release(); navigationLease.current = null;
        releaseEditAcquisitionFreeze.current?.(); releaseEditAcquisitionFreeze.current = null;
        composerNavigationLease.current?.release(); composerNavigationLease.current = null;
        navigationLocked.current = false; setLeaving(false);
        if (cause) setError(cause instanceof Error ? cause.message : String(cause));
      }
      setNavigationFactsEpoch(value => value + 1);
    }, cause => setError(cause instanceof Error ? cause.message : String(cause)));
    navigation.current = controller;
    setNavigationFactsEpoch(value => value + 1);
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'connection-state') {
        transportIdentity.current.bridge = String(event.state); transportIdentity.current.bridgeRevision++;
        connectionReadGeneration.current++;
        setBridgeStatus(String(event.state)); setSettingsSourceEpoch(value => value + 1);
        hostCatalogRead.current++; hostCatalogConfirmed.current = false; setHostCatalogReady(false);
        if (event.state === 'connected') void reloadHosts().catch(cause => setError(String(cause)));
      }
      if (event.type === 'page-resumed') {
        setSettingsSourceEpoch(value => value + 1);
        setRefresh(value => value + 1);
        void reloadHosts().catch(cause => setError(String(cause)));
        void reloadProjects().catch(cause => setError(String(cause)));
        void reloadPreferences().catch(cause => setError(String(cause)));
      }
      if (event.type === 'codex-app-server-connection-changed' && typeof event.hostId === 'string') {
        connectionReadGeneration.current++;
        const hostId = event.hostId, state = String(event.state);
        transportIdentity.current.hosts[hostId] = { state, revision: (transportIdentity.current.hosts[hostId]?.revision ?? 0) + 1 };
        setHostStatuses(previous => previous[hostId] === state ? previous : { ...previous, [hostId]: state });
        if (hostId === routeRef.current.hostId) {
          setSettingsSourceEpoch(value => value + 1);
          if (event.state === 'connected') setRefresh(value => value + 1);
        }
      }
      if (event.type === 'shared-object-updated' && event.key === 'remote_ssh_connections') {
        hostCatalogRead.current++;
        if (Array.isArray(event.value)) {
          setHosts([{ hostId: 'local', displayName: 'Local' }, ...event.value as Host[]]);
          hostCatalogConfirmed.current = true; setHostCatalogReady(true);
          void reloadProjects().catch(cause => setError(String(cause)));
        } else {
          hostCatalogConfirmed.current = false; setHostCatalogReady(false);
          void reloadHosts().catch(cause => setError(String(cause)));
        }
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
    return () => { hostCatalogRead.current++; hostCatalogConfirmed.current = false; unsubscribe(); controller.dispose(); navigationLease.current?.release(); releaseEditAcquisitionFreeze.current?.(); releaseEditAcquisitionFreeze.current = null; composerNavigationLease.current?.release(); if (navigation.current === controller) navigation.current = null; media.removeEventListener('change', preferences); reduced.removeEventListener('change', preferences); window.removeEventListener('languagechange', preferences); };
  }, [client, editAccess, reloadPreferences, reloadProjects, reloadHosts]);
  useEffect(() => {
    if (bridgeStatus !== 'connected') return;
    const hostId = current.hostId, generation = ++connectionReadGeneration.current;
    let active = true;
    void client.host<{ state: string }>('app-server-connection-state', { hostId }).then(value => {
      if (active && generation === connectionReadGeneration.current) {
        const previous = transportIdentity.current.hosts[hostId];
        transportIdentity.current.hosts[hostId] = { state: value.state, revision: previous?.revision ?? 0 };
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
      if (event.type === 'send-injection-updated') void sendStore.checkNativeHint(event).then(read).catch(cause => {
        if (active) setError(String(cause));
      });
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
      conversationError.current = conversation.error;
      setError(conversation.error);
      if (selectionReady.current?.key === selectionKey) {
        selectionReady.current.reject(new Error(conversation.error)); selectionReady.current = null;
      }
      return;
    }
    if (conversationError.current) {
      const previous = conversationError.current; conversationError.current = '';
      setError(value => value === previous ? '' : value);
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
    visualizationSubmission?: { hostId: string; threadId: string; path: string; signal: AbortSignal }, prepareEdit?: () => Promise<void>,
    earlyAuthority?: () => void) => {
    if (inFlight.current) throw new Error('正在提交，请稍候。');
    if (loading) throw new Error('会话仍在加载，请稍候。');
    if (!origin) {
      if (!description || !earlyAuthority && !retry && !visualizationSubmission) throw new Error('原提交权限尚未捕获，未发送。');
      if (!earlyAuthority) {
        let owner = description.owner;
        if (retry?.owner.threadId === null && retry.threadId && retry.threadId === current.threadId && retry.created?.thread.id === current.threadId) {
          const actual = composerController.current?.snapshot()?.owner;
          if (!actual || actual.hostId !== retry.owner.hostId || actual.threadId !== retry.threadId || actual.draftId !== retry.owner.draftId
            || sendBindings.current[sendThreadKey(actual.hostId, retry.threadId)] !== actual.draftId) throw new Error('原新会话的草稿绑定无法核对，未发送。');
          owner = actual;
        }
        earlyAuthority = captureMainSubmissionAuthority(owner);
      }
      earlyAuthority();
    }
    origin = origin && structuredClone(origin);
    const daemon = origin ? client.captureDaemonConnection(origin.hostId)
      : earlyAuthority && mainSubmissionAuthorities.current.get(earlyAuthority)?.daemon;
    if (!daemon) throw new Error('原 daemon 连接尚未捕获，原稿已保留，未发送。');
    daemon.assertOriginal();
    const assertEditAuthority = origin && editAccess.capture(origin);
    const editConnectionRevision = origin && sessions.view(origin).connectionRevision;
    inFlight.current = true; setSubmitting(true); setError('');
    // A displayed recovery snapshot grants no authority over another page's
    // attempt. Only prepare/attempt may return a token owned by this invocation.
    let intent: SendIntent | undefined;
    let expectedNavigation = navigationGeneration.current;
    const hostId = current.hostId;
    const originalBridge = transportIdentity.current.bridgeRevision, originalHost = transportIdentity.current.hosts[hostId]?.revision;
    const originalGrant = mainGrantRevision.current;
    const allowFirstTurn = !origin && action.type === 'send';
    const activeCwd = retry?.cwd ?? (thread?.cwd || cwd || workspace);
    const requireCurrent = (threadId: string | null) => {
      daemon.assertOriginal();
      earlyAuthority?.();
      const connection = transportIdentity.current;
      if (connection.bridge !== 'connected' || connection.bridgeRevision !== originalBridge
        || connection.hosts[hostId]?.state !== 'connected' || connection.hosts[hostId]?.revision !== originalHost
        || mainGrantRevision.current !== originalGrant) throw Object.assign(new Error('原连接或输入使用权已改变，原稿已保留，未发送。'), { uncertain: false });
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
      const draftInjection = retry?.injection ?? (!origin ? captureDraftInjection(draft, hostId, description?.documentPlainTextMode) : undefined);
      if (origin) { await prepareEdit?.(); assertEditAuthority?.(); requireCurrent(origin.threadId); }
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
            selectedProject?.hostId === hostId ? selectedProject.id : undefined, additionalContext, action, draftInjection);
        } else {
          intent = await sendStore.attempt(retry.id);
        }
        await reloadSends();
      }
      const assignCreatedProject = async (threadId: string) => {
        if (!intent?.projectId) return;
        const state = await client.host<ProjectState>('thread-project-state');
        if (!projectsForHost(state, hostId).some(project => project.id === intent!.projectId)) throw new Error('原选择的项目已改变，输入已保留，请核对项目。');
        requireCurrent(current.threadId);
        await client.host('thread-projects', { operation: 'setMembership', value: { hostId, threadId, projectless: false,
          assignment: hostId === 'local' ? { projectKind: 'local', projectId: intent.projectId }
            : { projectKind: 'remote', projectId: intent.projectId, hostId } } }, { assertBeforeSend: () => requireCurrent(current.threadId) });
        await reloadProjects();
      };
      if (retry?.created && retry.threadId) await assignCreatedProject(retry.threadId);
      const active = current.threadId ? sessions.view({ hostId, threadId: current.threadId }).snapshot() : conversation;
      const sendClient = { rpc: <T,>(method: string, params: Record<string, unknown> = {}, targetHost = hostId, dispatchOptions?: Parameters<BrowserWorkbenchClient['rpc']>[3]) => {
        if (!['thread/start', 'thread/inject_items', 'turn/start', 'turn/steer', 'thread/queue/add', 'thread/queue/start'].includes(method)) return client.rpc<T>(method, params, targetHost, dispatchOptions);
        return client.rpc<T>(method, params, targetHost, { ...dispatchOptions, daemonConnectionGeneration: daemon.generation, assertBeforeSend: () => {
          if (targetHost !== hostId) throw new Error('发送主机已改变，未发送。');
          const target = method === 'thread/start' ? null : typeof params.threadId === 'string' ? params.threadId : current.threadId;
          requireCurrent(target);
          if (target && (method === 'thread/inject_items' || method === 'turn/start' && action.type === 'send')
            && isThreadBusy(sessions.view({ hostId, threadId: target }).snapshot().thread)) throw new Error('当前任务已开始，原输入已保留，未发送。');
          dispatchOptions?.assertBeforeSend?.();
        } }); }, host: client.host.bind(client), subscribe: client.subscribe.bind(client), reply: client.reply.bind(client) };
      const result = await submitDraft(sendClient, { hostId, threadId: current.threadId, cwd: activeCwd, initialOptions: active.options ?? undefined,
        documentPlainTextMode: intent ? intent.documentPlainTextMode : description?.documentPlainTextMode,
        overrides: origin ? {} : description?.overrides, additionalContext: intent ? intent.additionalContext : additionalContext,
        collaborationMode: intent?.collaborationMode, createdOptions: intent?.created?.settings,
        injection: intent?.injection,
        ...(intent?.injection ? { nativeInjection: { store: sendStore, intent, authority: {
          daemonConnectionGeneration: daemon.generation, assertBeforeSend: (target: string) => {
            requireCurrent(target);
            if (isThreadBusy(sessions.view({ hostId, threadId: target }).snapshot().thread)) {
              throw Object.assign(new Error('当前任务仍在运行，原 app 上下文未发送。'), { uncertain: false, sendPhase: 'before-send' });
            }
          },
        } } } : {}),
        assertInjectionAuthority: target => {
          requireCurrent(target);
          if (isThreadBusy(sessions.view({ hostId, threadId: target }).snapshot().thread)) throw Object.assign(new Error('当前任务仍在运行，原 app 上下文未发送。'), { uncertain: false });
        },
        ...(intent ? { send: { clientUserMessageId: intent.clientUserMessageId,
          injecting: async () => { await sendStore.injecting(intent!.id, intent!.attemptId); },
          injected: async () => { await sendStore.injected(intent!.id, intent!.attemptId); },
          injectionFailed: async cause => { await sendStore.injectionFailed(intent!.id, cause, intent!.attemptId); },
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
        const requestedNavigation = navigationGeneration.current + 1;
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
        if (navigationGeneration.current !== requestedNavigation + 1) throw new Error('新会话移交期间导航已改变，原稿和创建回执已保留。');
        if (earlyAuthority) mainSubmissionAuthorities.current.get(earlyAuthority)?.acceptCreated(created.id, navigationGeneration.current);
        expectedNavigation = navigationGeneration.current;
        await reloadSends();
      }, origin, (target, expected, params) => editStore.submit(target, expected, params, () => {
        assertEditAuthority?.();
        if (!origin || target.hostId !== origin.hostId || target.threadId !== origin.threadId
          || target.turnId !== origin.turnId || target.itemId !== origin.itemId) {
          throw Object.assign(new Error('消息编辑来源已改变，编辑稿已保留，未发送。'), { uncertain: false });
        }
        requireCurrent(origin.threadId);
      }, daemon.generation));
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
    } finally { finishMainDispatch(); }
  };
  const interrupt = async () => {
    const active = threadRef.current?.turns?.find(turn => turn.status === 'inProgress');
    if (!current.threadId || !active) return;
    const owner = composerController.current?.snapshot()?.owner;
    if (!owner) throw new Error('原输入目标尚未确认，未停止任务。');
    const assertAuthority = captureMainSubmissionAuthority(owner);
    await client.rpc('turn/interrupt', { threadId: current.threadId, turnId: active.id }, current.hostId, {
      daemonConnectionGeneration: mainSubmissionAuthorities.current.get(assertAuthority)!.daemon.generation, assertBeforeSend: () => {
      assertAuthority();
      if (!threadRef.current?.turns.some(turn => turn.id === active.id && turn.status === 'inProgress')) throw new Error('原任务已改变，未停止其他任务。');
    } });
  };
  const action = async (name: string, lastTurnId?: string) => {
    setMenu(false); if (!current.threadId) return;
    const hostId = current.hostId, threadId = current.threadId;
    try {
      if (name === 'copy') { await navigator.clipboard.writeText(location.href); return; }
      const authority = captureSidebarAuthority(hostId), assertBeforeSend = authority.assertBeforeSend;
      const dispatch = <T,>(method: string, params: Record<string, unknown>) => client.rpc<T>(method, params, hostId,
        { daemonConnectionGeneration: authority.daemonConnectionGeneration, assertBeforeSend });
      if (name === 'rename') {
        const value = prompt('Conversation name', thread?.name ?? ''); if (value == null) return;
        await dispatch('thread/name/set', { threadId, name: value });
      } else if (name === 'fork') {
        const value = await dispatch<{ thread: ThreadSummary }>('thread/fork', { threadId, ...(lastTurnId ? { lastTurnId } : {}) });
        assertBeforeSend(); await openThread(value.thread.id, hostId, false);
      } else if (name === 'archive' || name === 'restore') {
        await dispatch(name === 'archive' ? 'thread/archive' : 'thread/unarchive', { threadId });
        assertBeforeSend();
        if (name === 'archive') await navigate('/' + (hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(hostId)));
        else await openThread(threadId, hostId, false);
      }
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
  const captureSettingsBrowserAuthority = (hostId: string) => {
    const original = routeRef.current, sourceKey = settingsContextIdentity.current.key;
    const bridge = transportIdentity.current.bridgeRevision, host = transportIdentity.current.hosts[hostId]?.revision ?? 0;
    const daemon = client.captureDaemonConnection(hostId);
    const assertCurrent = () => {
      daemon.assertOriginal();
      if (!original.section || original.hostId !== hostId || routeRef.current !== original
        || settingsContextIdentity.current.key !== sourceKey || transportIdentity.current.bridge !== 'connected'
        || transportIdentity.current.bridgeRevision !== bridge || (transportIdentity.current.hosts[hostId]?.revision ?? 0) !== host) {
        throw new Error('The original settings page, source or host changed.');
      }
    };
    assertCurrent();
    // The existing navigation barrier owns the pending transition. Its final
    // guard still checks this committed page before the destination is applied.
    return { key: JSON.stringify([navigationCommit, original.pathname, original.search, original.hash, hostId, sourceKey, bridge, host, daemon.generation]), assertCurrent };
  };
  const productRoute = readProductRoute(current);
  const productPage = !settings && productRoute.kind !== 'other';
  const configurationWrites = useMemo(() => settingsConfigOperations(client), [client]);
  const productIdentity = useRef({ authorityKey: '', locationKey: '' });
  const productAuthorityKey = () => JSON.stringify([transportIdentity.current.bridgeRevision, transportIdentity.current.hosts[current.hostId]?.revision ?? 0]);
  const productLocationKey = JSON.stringify([current.pathname, current.search, current.hash, navigationCommit]);
  const productAuthority = { hostId: current.hostId, authorityKey: productAuthorityKey(), locationKey: productLocationKey };
  productIdentity.current = productAuthority;
  const originalProductOwner = (owner: Pick<ProductRouteOwner, 'hostId' | 'authorityKey' | 'locationKey'>) => owner.hostId === routeRef.current.hostId
    && owner.authorityKey === productAuthorityKey() && owner.authorityKey === productIdentity.current.authorityKey
    && owner.locationKey === productIdentity.current.locationKey && transportIdentity.current.bridge === 'connected'
    && transportIdentity.current.hosts[owner.hostId]?.state === 'connected';
  const productCurrent = (owner: Pick<ProductRouteOwner, 'hostId' | 'authorityKey' | 'locationKey'>) => !navigationLocked.current && originalProductOwner(owner);
  const navigateProduct = (path: string, options: Parameters<typeof navigate>[1], owner: ProductRouteOwner) => {
    if (!productCurrent(owner)) return Promise.resolve(false);
    const originalNavigation = navigationGeneration.current, daemon = client.captureDaemonConnection(owner.hostId);
    return navigate(path, options, () => {
      daemon.assertOriginal();
      if (!originalProductOwner(owner) || navigationGeneration.current !== originalNavigation + 1) {
        throw new Error('The original product page changed before navigation completed.');
      }
    });
  };
  const productPath = (path: string, hostId: string) => path + (hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(hostId));
  const productCheck = (owner: ProductRouteOwner) => {
    if (!productCurrent(owner)) throw new Error('The original product page changed.');
  };
  const createProductProject = async (owner: ProductRouteOwner) => {
    productCheck(owner);
    const path = prompt('Project directory'); if (!path) return false;
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    await client.host('project-add', { hostId: owner.hostId, path, name }, { assertBeforeSend: () => productCheck(owner) });
    await reloadProjects(); productCheck(owner); return true;
  };
  const tryProductDraft = async (owner: ProductRouteOwner, targetCwd: string, draft: ComposerDraft) => {
    productCheck(owner);
    const draftId = crypto.randomUUID();
    await saveComposerDraftConflict({ hostId: owner.hostId, threadId: null, draftId }, { revision: crypto.randomUUID(), draft: normalizeDraft(draft), prefills: [] });
    productCheck(owner);
    if (!await navigateProduct(productPath('/', owner.hostId), undefined, owner)) throw new Error('Navigation was not completed.');
    selectHomeDraftIdentity(owner.hostId, draftId);
    const project = projectStateRef.current ? projectsForHost(projectStateRef.current, owner.hostId).find(value => value.rootPaths.includes(targetCwd)) : null;
    rememberNewDraftLocation(owner.hostId, draftId, targetCwd, project?.id);
    setHomeGeneration(value => value + 1); setCwd(targetCwd); setSelectedProject(project ?? null);
  };
  const busy = submitting || isThreadBusy(thread);
  const canRetryAction = (intent: SendIntent) => {
    const action = intent.action;
    return action?.type === 'queue' || (action?.type === 'steer'
      ? thread?.turns.some(turn => turn.id === action.turnId && turn.status === 'inProgress') === true : !busy);
  };
  const composerOwner = { hostId: current.hostId, threadId: current.threadId,
    draftId: current.threadId ? sendState?.bindings[sendThreadKey(current.hostId, current.threadId)] ?? current.threadId : newDraftId };
  const panelHostId = sideChatSource?.owner.hostId ?? current.hostId;
  const panelThreadId = sideChatSource?.owner.threadId ?? current.threadId;
  const panelScope = JSON.stringify([panelHostId, sideChatSource?.owner.draftId ?? current.threadId ?? newDraftId]);
  const panelCwd = sideChatSource?.identity.cwd ?? thread?.cwd ?? (cwd || workspace);
  const composerIsCurrent = composerSnapshot?.owner.hostId === composerOwner.hostId
    && composerSnapshot.owner.threadId === composerOwner.threadId && composerSnapshot.owner.draftId === composerOwner.draftId;
  const browserOwner = browserDraftOwner(sideChatSource?.owner ?? composerOwner, sendState?.bindings ?? {});
  const activeBrowserOwner = useRef(browserOwner); activeBrowserOwner.current = browserOwner;
  const sendBindings = useRef(sendState?.bindings ?? {}); sendBindings.current = sendState?.bindings ?? {};
  const panelComposer = useCallback((): ComposerDraftController | null => {
    const source = sideChatSourceRef.current;
    if (!source) return composerController.current;
    const child = sideChatActive.current;
    return child && child.identity.prepareId === source.identity.prepareId && sameComposerOwner(child.owner, source.owner)
      ? child.draft : null;
  }, []);
  const panelComposerSnapshot = sideChatSource
    ? sideChatChild && sideChatChild.identity.prepareId === sideChatSource.identity.prepareId
      && sameComposerOwner(sideChatChild.owner, sideChatSource.owner) ? sideChatChild.snapshot : null
    : composerSnapshot;
  const captureSideChatParent = useCallback((): SideChatRootParentGrant => {
    const original = routeRef.current, source = threadRef.current;
    if (navigationLocked.current || original.section || !original.threadId || !source || source.id !== original.threadId || !source.cwd) {
      throw new Error('原父会话尚未就绪，侧聊未打开。');
    }
    const hostId = original.hostId, threadId = original.threadId, cwd = source.cwd;
    const daemon = client.captureDaemonConnection(hostId), connection = transportIdentity.current;
    const bridgeRevision = connection.bridgeRevision, hostRevision = connection.hosts[hostId]?.revision;
    const assertCurrent = () => {
      daemon.assertOriginal();
      const route = routeRef.current, thread = threadRef.current, now = transportIdentity.current;
      if (route.section || route.hostId !== hostId || route.threadId !== threadId || thread?.id !== threadId || thread.cwd !== cwd
        || now.bridge !== 'connected' || now.bridgeRevision !== bridgeRevision || now.hosts[hostId]?.state !== 'connected'
        || now.hosts[hostId]?.revision !== hostRevision) throw new Error('原父会话或连接已改变，侧聊操作未派发。');
    };
    assertCurrent();
    return { parent: { hostId, threadId, cwd, archived: original.readOnly || sessions.view({ hostId, threadId }).snapshot().archived === true }, assertCurrent };
  }, [client, sessions]);
  const freezeSideChatOwner = useCallback((owner: ComposerDraftOwner, identity: SideChatWorkspaceIdentity,
    draft: ComposerDraftController | null, assertOriginal: () => void): SideChatSendLease => {
    assertOriginal();
    if (owner.hostId !== identity.hostId || owner.draftId !== identity.draftId) throw new Error('原侧聊草稿身份不匹配。');
    const key = composerOwnerKey(owner), token = {};
    if (frozenChildOwners.current.has(key)) throw new Error('原侧聊输入仍有未完成的移交。');
    frozenChildOwners.current.set(key, token);
    const main = composerController.current, snapshot = main?.snapshot();
    let mainLease: ComposerDraftLease | null = null;
    try {
      // The Workspace already froze its own controller. Only acquire a second
      // lease if Main actually holds another projection of this exact owner.
      if (main && main !== draft && snapshot && sameComposerOwner(snapshot.owner, owner)) {
        mainLease = main.freeze(owner);
        if (!mainLease) throw new Error('原输入区的同一草稿尚不能移交。');
      }
    } catch (cause) { frozenChildOwners.current.delete(key); throw cause; }
    const assertCurrent = () => {
      assertOriginal();
      if (frozenChildOwners.current.get(key) !== token) throw new Error('原侧聊输入移交租约已改变。');
      if (mainLease && (composerController.current !== main || !main?.snapshot() || !sameComposerOwner(main.snapshot()!.owner, owner))) {
        throw new Error('原输入区的同一草稿投影已改变。');
      }
    };
    return {
      assertCurrent,
      async drain() {
        assertCurrent();
        if (mainLease && inFlight.current) await new Promise<void>(done => mainIdleWaiters.current.add(done));
        if (mainLease && !await mainLease.flush()) throw new Error('原输入区尚未保存，侧聊移交未完成。');
        const source = sideChatSourceRef.current;
        if (source && sameComposerOwner(source.owner, owner)) {
          if (panelsDirty.current && !window.confirm('Keep unsaved file changes and close the side chat?')) throw new Error('文件编辑已保留，侧聊未关闭。');
          await panelRecoveryBarrier.current?.(); await browserRecoveryBarrier.current?.();
        }
        if (Object.values(browserProjections.current).some(value => sameComposerOwner(value.after.owner, owner))) {
          throw new Error('原侧聊浏览器引用尚未接收，已保存版本保留。');
        }
        assertCurrent();
      },
      release() {
        if (frozenChildOwners.current.get(key) !== token) return;
        mainLease?.release(); frozenChildOwners.current.delete(key);
      },
    };
  }, []);
  const cleanupSideChat = useCallback(async (identity: SideChatBrowserIdentity) => {
    const source = sideChatSourceRef.current;
    if (source && source.identity.hostId === identity.hostId && source.identity.draftId === identity.draftId
      && source.identity.prepareId === identity.prepareId && source.owner.threadId === identity.childThreadId) {
      await panelRecoveryBarrier.current?.(); await browserRecoveryBarrier.current?.();
      setPanelOpen(false); setSideChatSource(null);
    }
  }, []);
  const captureMainSubmissionAuthority = useCallback((owner: ComposerDraftOwner) => {
    const original = structuredClone(owner), connection = transportIdentity.current;
    const daemon = client.captureDaemonConnection(owner.hostId);
    const bridgeRevision = connection.bridgeRevision, hostRevision = connection.hosts[owner.hostId]?.revision;
    const grant = mainGrantRevision.current;
    let expected = original, generation = navigationGeneration.current, controller = composerController.current;
    const checkConnection = () => {
      daemon.assertOriginal();
      const connection = transportIdentity.current;
      if (connection.bridge !== 'connected' || connection.bridgeRevision !== bridgeRevision
        || connection.hosts[original.hostId]?.state !== 'connected' || connection.hosts[original.hostId]?.revision !== hostRevision
        || mainGrantRevision.current !== grant || frozenChildOwners.current.has(composerOwnerKey(expected))) throw Object.assign(new Error('原页面连接或输入使用权已改变，未发送。'), { uncertain: false });
    };
    const assert = () => {
      checkConnection();
      const route = routeRef.current, actual = composerController.current?.snapshot()?.owner;
      if (navigationLocked.current || generation !== navigationGeneration.current || route.section || route.readOnly
        || route.hostId !== expected.hostId || route.threadId !== expected.threadId || !controller || composerController.current !== controller
        || !actual || actual.hostId !== expected.hostId || actual.threadId !== expected.threadId || actual.draftId !== expected.draftId) {
        throw Object.assign(new Error('原输入目标或使用权已改变，原稿已保留，未发送。'), { uncertain: false });
      }
    };
    assert();
    mainSubmissionAuthorities.current.set(assert, { daemon, owner: original, acceptCreated(threadId, navigation) {
      checkConnection();
      const actual = composerController.current?.snapshot()?.owner, route = routeRef.current;
      if (original.threadId !== null || !threadId || route.hostId !== original.hostId || route.threadId !== threadId
        || sendBindings.current[sendThreadKey(original.hostId, threadId)] !== original.draftId
        || !actual || actual.hostId !== original.hostId || actual.threadId !== threadId || actual.draftId !== original.draftId) {
        throw Object.assign(new Error('原草稿的新会话移交无法核对，未发送。'), { uncertain: false });
      }
      expected = { ...original, threadId }; generation = navigation; controller = composerController.current;
      assert();
    } });
    return assert;
  }, []);
  const beginBrowserDraftOperation = useCallback((owner: BrowserOwner) => {
    const controller = panelComposer(), snapshot = controller?.snapshot();
    if (!controller || !snapshot || routeRef.current.readOnly || navigationLocked.current
      || frozenChildOwners.current.has(composerOwnerKey(snapshot.owner))
      || browserOwnerKey(owner) !== browserOwnerKey(activeBrowserOwner.current)
      || browserOwnerKey(browserDraftOwner(snapshot.owner, sendBindings.current)) !== browserOwnerKey(owner)) return null;
    return controller.beginExternalOperation(snapshot.owner);
  }, [panelComposer]);
  const acceptBrowserCommittedVersion = useCallback(async (before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => {
    const controller = panelComposer();
    if (!controller || routeRef.current.readOnly || navigationLocked.current
      || browserOwnerKey(browserDraftOwner(after.owner, sendBindings.current)) !== browserOwnerKey(activeBrowserOwner.current)) return false;
    const accepted = await controller.acceptCommittedVersion(before, after);
    if (accepted) releaseBrowserProjection(after);
    return accepted;
  }, [panelComposer, releaseBrowserProjection]);
  useEffect(() => {
    if (!panelComposerSnapshot || browserOwnerKey(browserDraftOwner(panelComposerSnapshot.owner, sendBindings.current)) !== browserOwnerKey(browserOwner)) return;
    setBrowserSyncError('');
    return watchBrowserDraftDeletions(browserOwner, () => {
      const snapshot = panelComposer()?.snapshot();
      return snapshot && browserOwnerKey(browserDraftOwner(snapshot.owner, sendBindings.current)) === browserOwnerKey(browserOwner) ? snapshot : null;
    }, async () => {
      const operation = beginBrowserDraftOperation(browserOwner);
      if (!operation) return false;
      await syncBrowserDraftDeletions(browserOwner, operation, retainBrowserProjection, releaseBrowserProjection);
      return true;
    }, cause => setBrowserSyncError(String(cause)));
  }, [browserOwner.hostId, browserOwner.threadId, browserOwner.draftId, panelComposerSnapshot?.revision, browserSyncRetry, panelComposer, beginBrowserDraftOperation, retainBrowserProjection, releaseBrowserProjection]);
  useEffect(() => {
    let keyboardClose = false;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === 'w' && (event.ctrlKey && !event.metaKey || event.metaKey && !event.ctrlKey)) {
        keyboardClose = true;
        setTimeout(() => { keyboardClose = false; }, 0);
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const mode = shellPreferences.values['confirm-before-close'];
      if (Object.keys(browserProjections.current).length || mode === 'always' || mode === 'keyboardOnly' && keyboardClose) {
        event.preventDefault();
      }
    };
    // Browsers own their close accelerators; use the gesture only when they
    // actually deliver it to this page. Never replace Ctrl+W with a fake close.
    window.addEventListener('keydown', keydown);
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('beforeunload', beforeUnload); };
  }, [shellPreferences.values['confirm-before-close']]);
  const checkPanelChild = (child: SideChatPanelSource) => {
    const active = sideChatActive.current;
    if (navigationLocked.current || !active || active.identity.prepareId !== child.identity.prepareId
      || !sameComposerOwner(active.owner, child.owner) || frozenChildOwners.current.has(composerOwnerKey(child.owner))) {
      throw new Error('原侧聊面板目标已改变，请返回原侧聊。');
    }
  };
  const showBrowser = (source?: { hostId: string; threadId: string; url?: string }, child: SideChatPanelSource | null = null) => {
    if (child) checkPanelChild(child);
    if (source && (source.hostId !== (child?.owner.hostId ?? current.hostId) || source.threadId !== (child?.owner.threadId ?? current.threadId))) {
      setError('浏览器链接所属会话已改变，请返回原会话。'); return;
    }
    setSideChatSource(child);
    setBrowserMounted(true); setPanelKind('browser'); setPanelOpen(true);
    if (source?.url) setBrowserNavigation({ id: crypto.randomUUID(), url: source.url });
  };
  const showVisualization = (source: { hostId: string; threadId: string; path: string }, child: SideChatPanelSource | null = null) => {
    if (child) checkPanelChild(child);
    if (source.hostId !== (child?.owner.hostId ?? current.hostId) || source.threadId !== (child?.owner.threadId ?? current.threadId)) { setError('可视化所属会话已改变，请返回原会话。'); return; }
    setSideChatSource(child);
    setVisualization(source); setPanelKind('visualization'); setPanelOpen(true);
  };
  const showPanel = (request?: { kind: 'terminal'; reuse?: boolean } | { kind: 'file'; path: string; line?: number; column?: number } | { kind: 'diff'; path?: string; diff?: string }, child: SideChatPanelSource | null = null) => {
    if (child) checkPanelChild(child);
    const hostId = child?.owner.hostId ?? current.hostId, threadId = child?.owner.threadId ?? current.threadId;
    const scopeId = JSON.stringify([hostId, child?.owner.draftId ?? threadId ?? newDraftId]);
    const targetCwd = child?.identity.cwd ?? thread?.cwd ?? (cwd || workspace);
    const connection = transportIdentity.current;
    if (request?.kind === 'terminal' && (connection.bridge !== 'connected' || connection.hosts[hostId]?.state !== 'connected')) {
      setError('终端当前不可用：主机连接已断开或尚未就绪，请先重新连接。');
      return;
    }
    setSideChatSource(child);
    setPanelMounted(true); setPanelKind('workspace'); setPanelOpen(true);
    if (request) setPanelRequest({ ...request, id: crypto.randomUUID(), scopeId, hostId, cwd: targetCwd });
  };
  const openFile = (path: string, line?: number, column?: number, fileCwd = thread?.cwd || cwd || workspace) =>
    showPanel({ kind: 'file', path: resolveFilePath(fileCwd, path), line, column });
  const openSettingsConfig = (hostId: string, file: string, input: ConfigReadSource) => {
    void (async () => {
      const original = routeRef.current, generation = navigationGeneration.current;
      const source = { ...input }, daemon = client.captureDaemonConnection(hostId);
      const assertOriginal = () => {
        daemon.assertOriginal();
        if (routeRef.current !== original || navigationGeneration.current !== generation
          || !original.section || original.hostId !== hostId || source.hostId !== hostId)
          throw new Error('The original configuration source changed. Reload the settings before opening the file.');
      };
      assertOriginal();
      const read = await client.rpc<{ yardConfigSource?: unknown; layers?: unknown }>('config/read', { includeLayers: true }, hostId,
        { assertBeforeSend: assertOriginal });
      assertOriginal();
      // Configuration reads use their own owned socket. Its source is compared
      // with the original settings read, rather than the Main daemon generation.
      const target = userConfigTarget(read.layers, source.codexHome).target;
      if (!sameConfigSource(source, configReadSource(read.yardConfigSource, hostId)) || target?.file !== file)
        throw new Error('The configuration file source changed. Reload the settings before opening it.');
      // Match the existing Web openIn behavior: download the actual bytes and
      // keep Settings visible, rather than introducing file-panel navigation.
      const opened = await client.files.open({ hostId, path: file, cwd: source.codexHome });
      assertOriginal();
      if (!opened.success) throw new Error('Could not open the configuration file.');
    })().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const addReference = async (draft: ComposerDraft) => {
    const controller = panelComposer(), snapshot = controller?.snapshot(), source = sideChatSourceRef.current;
    if (!controller || !snapshot || navigationLocked.current || routeRef.current.readOnly
      || frozenChildOwners.current.has(composerOwnerKey(snapshot.owner))
      || (source ? !sameComposerOwner(snapshot.owner, source.owner)
        : snapshot.owner.hostId !== routeRef.current.hostId || snapshot.owner.threadId !== routeRef.current.threadId))
      throw new Error('原输入区尚未就绪，引用未加入，请保留来源后重试。');
    const operation = controller.beginExternalOperation(snapshot.owner);
    if (!operation) throw new Error('原输入区正在处理其他输入，引用未加入，请重试。');
    let accepted = false;
    try {
      accepted = await operation.applyPrefill({ id: crypto.randomUUID(), draft: structuredClone(draft) });
      if (!accepted) throw new Error('引用尚未保存，来源内容已保留。');
      if (controller === panelComposer()) { if (source) setPanelKind('side-chat'); else setPanelOpen(false); }
    } finally { operation.finish(accepted); }
  };
  const openSideChat = async () => {
    try {
      const controller = sideChats.current;
      if (!controller) throw new Error('原侧聊工作区尚未就绪。');
      await controller.open();
      if (controller !== sideChats.current || navigationLocked.current) throw new Error('原侧聊工作区已改变。');
      setSideChatOpened(true); setPanelKind('side-chat'); setPanelOpen(true); setMenu(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
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
    openSettings: () => {
      if (current.section) return false;
      void navigate('/settings/general' + (current.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(current.hostId)));
      return true;
    },
    findConversation: () => {
      if (!current.threadId || current.section) return false;
      setMessageSearchOpen(true); return true;
    },
  });
  const shortcutSidebarHints = new Map(shortcuts.hints === 'sidebar' ? shortcuts.sidebarHintKeys.map((key, index) =>
    [key, shortcuts.label('sidebar', index + 1 as NumberShortcutSlot)] as const) : []);
  const sidebarInventoryKey = JSON.stringify([current.hostId, navigationGeneration.current, connectionReadGeneration.current,
    projectGeneration.current, refresh, list.rows.map(row => row.id)]);
  const sidebarInventoryScope = useRef({ key: sidebarInventoryKey, hostId: current.hostId, threadIds: list.rows.map(row => row.id) });
  sidebarInventoryScope.current = { key: sidebarInventoryKey, hostId: current.hostId, threadIds: list.rows.map(row => row.id) };
  const resolveSidebarThreadHosts = useMemo(() => createSidebarProjectInventory(client, () => sidebarInventoryScope.current,
    state => { projectResponseGeneration.current++; projectStateRef.current = state; setProjectState(state); }), [client]);
  const captureSidebarAuthority = (hostId: string) => {
    const original = routeRef.current, revision = sidebarNavigationRevision.current;
    const daemon = client.captureDaemonConnection(hostId);
    const pageKey = (value: Route) => {
      const search = new URLSearchParams(value.search); search.delete('archived');
      return JSON.stringify([value.hostId, value.threadId, value.section, value.pathname, search.toString(), value.hash]);
    };
    const key = pageKey(original);
    return { daemonConnectionGeneration: daemon.generation, assertBeforeSend: () => {
      daemon.assertOriginal();
      if (navigationLocked.current || sidebarNavigationRevision.current !== revision || pageKey(routeRef.current) !== key || original.hostId !== hostId)
        throw new Error('The original sidebar page or host changed.');
    } };
  };
  const sidebarActions = useMemo(() => createSidebarActionService({
    client,
    requestName: row => window.prompt('Conversation name', row.name ?? row.preview ?? ''),
    confirm: request => window.confirm(request.type === 'delete-thread'
      ? 'Permanently delete this conversation? This cannot be undone.'
      : request.type === 'archive-project' ? `Archive all ${request.rows.length} conversations in ${request.project.name}?`
      : `Remove ${request.project.name} from the sidebar? Your files and conversations will be kept.`),
    assertProjectCurrent: project => {
      const state = projectStateRef.current;
      const actual = state && projectsForHost(state, project.hostId).find(value => value.id === project.id);
      if (!actual || actual.name !== project.name || JSON.stringify(actual.rootPaths) !== JSON.stringify(project.rootPaths))
        throw new Error('The original project changed.');
    },
    onCommitted: async (result, authority) => {
      authority.assertBeforeSend();
      if (result.type === 'remove-project') setSelectedProject(previous => previous?.hostId === result.project.hostId && previous.id === result.project.id ? null : previous);
      await Promise.all([reloadProjects(), refreshList()]);
      authority.assertBeforeSend();
      const route = routeRef.current;
      if (result.type === 'fork') {
        const search = result.row.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: result.row.hostId });
        if (!await navigate('/local/' + encodeURIComponent(result.thread.id) + search)) throw new Error('The fork was created; navigation was not completed.');
      } else if ((result.type === 'archive' || result.type === 'delete') && route.hostId === result.row.hostId && route.threadId === result.row.id
        || result.type === 'archive-chats' && route.hostId === result.project.hostId && route.threadId !== null && result.threadIds.includes(route.threadId)) {
        if (!await navigate('/' + (route.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: route.hostId }))))
          throw new Error('The action was saved; navigation was not completed.');
      } else if (result.type === 'restore' && route.hostId === result.row.hostId && route.threadId === result.row.id) {
        const search = route.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: route.hostId });
        if (!await navigate('/local/' + encodeURIComponent(result.row.id) + search)) throw new Error('The conversation was restored; navigation was not completed.');
      }
      setRefresh(value => value + 1);
    },
  }), [client, navigate, reloadProjects, refreshList]);
  const sidebarBehavior = useSidebarBehavior({
    client, hostId: current.hostId, rows: list.rows, projectState,
    threadHostResolutionEpoch: sidebarInventoryKey, resolveThreadHosts: resolveSidebarThreadHosts,
    captureAuthority: captureSidebarAuthority,
    availableThreadActions: sidebarActions.availableThreadActions, onThreadAction: sidebarActions.onThreadAction,
    availableProjectActions: sidebarActions.availableProjectActions, onProjectAction: sidebarActions.onProjectAction,
    readStateWriteAvailable: true,
    commitProjectMembership: (request, authority) => commitSidebarProjectMembership(client, request, authority),
    requestProjectName: async project => window.prompt('Project name', project.name),
    onProjectsChanged: () => { void reloadProjects().catch(cause => setError(String(cause))); },
  });
  const { error: sidebarError, ...sidebarBehaviorProps } = sidebarBehavior;
  useEffect(() => { if (sidebarError) setError(sidebarError); }, [sidebarError]);
  const activeProject = current.threadId && thread && projectState
    ? projectForThread(projectState, projectsForHost(projectState, current.hostId), current.hostId, thread) : selectedProject;
  const summaryGeneration = navigationGeneration.current;
  const summaryConnectionGeneration = connectionReadGeneration.current;
  const summarySourceKey = JSON.stringify([current.hostId, current.threadId, summaryGeneration, summaryConnectionGeneration]);
  const assertSummaryCurrent = () => {
    const route = routeRef.current;
    if (navigationLocked.current || navigationGeneration.current !== summaryGeneration || connectionReadGeneration.current !== summaryConnectionGeneration || route.section
      || route.hostId !== current.hostId || route.threadId !== current.threadId)
      throw new Error('The original summary conversation changed.');
  };
  const captureMainPrompt = () => {
    const controller = composerController.current, snapshot = controller?.snapshot(), route = routeRef.current;
    if (!controller || !snapshot || route.section || route.readOnly || navigationLocked.current
      || snapshot.owner.hostId !== route.hostId || snapshot.owner.threadId !== route.threadId)
      throw new Error('The original Main composer is not ready.');
    const owner = structuredClone(snapshot.owner), navigation = navigationGeneration.current;
    const connection = client.captureDaemonConnection(owner.hostId);
    const assertOriginal = () => {
      connection.assertOriginal();
      const actual = controller.snapshot(), location = routeRef.current;
      if (navigationLocked.current || navigationGeneration.current !== navigation || location.section || location.readOnly
        || location.hostId !== owner.hostId || location.threadId !== owner.threadId
        || composerController.current !== controller || !actual || !sameComposerOwner(actual.owner, owner))
        throw new Error('The original Main composer changed.');
    };
    assertOriginal();
    return assertOriginal;
  };
  const appendMainPrompt = async (document: ComposerDocument, prefillId: string, assertOriginal: () => void) => {
    assertOriginal();
    const controller = composerController.current, snapshot = controller?.snapshot(), port = mainPromptAppendPort.current;
    if (!controller || !snapshot || !port) throw new Error('The original Main prompt editor is not ready.');
    const mainGuard = captureMainPrompt();
    const verify = () => {
      assertOriginal(); mainGuard();
      if (mainPromptAppendPort.current !== port) throw new Error('The original Main prompt editor changed.');
    };
    const operation = port.begin(snapshot.owner, verify);
    if (!operation) throw new Error('The original Main composer is handling another edit.');
    try {
      const receipt = await operation.append(document, prefillId);
      if (receipt.status !== 'accepted') throw new Error('The prompt was saved, but the original editor could not accept it. Review the saved draft before continuing.');
    } finally { operation.cancel(); }
  };
  const createSummaryOutput = async (kind: ThreadSummaryCreateKind) => {
    assertSummaryCurrent();
    const assertMain = captureMainPrompt();
    const prefill = createSummaryOutputPrefill({ kind, context: { hostId: current.hostId, cwd: thread?.cwd ?? cwd } });
    await appendMainPrompt(prefill.document, crypto.randomUUID(), () => { assertSummaryCurrent(); assertMain(); });
  };
  const summarySideChats = useSummarySideChats({ controller: sideChats, hostId: current.hostId, threadId: current.threadId,
    enabled: summaryOpen && !loading && !!thread && !current.section, sourceKey: summarySourceKey,
    fallbackTitle: previewAppearance.locale.startsWith('zh') ? '侧聊' : 'Side chat', assertCurrent: assertSummaryCurrent });
  const showSummarySideChat = async (identity: Parameters<SideChatRootController['restore']>[0], recover: boolean) => {
    assertSummaryCurrent();
    if (identity.hostId !== current.hostId || identity.parentThreadId !== current.threadId) throw new Error('The side chat belongs to another conversation.');
    const controller = sideChats.current;
    if (!controller) throw new Error('Side chats are not ready.');
    if (recover) {
      const associations = await controller.listRecoverable(); assertSummaryCurrent();
      if (!associations.some(value => sameSummarySideChat(value, identity))) throw new Error('The saved side chat changed.');
      await controller.restore(identity);
    } else {
      if (!controller.listMounted().some(value => sameSummarySideChat(value.identity, identity))) throw new Error('The original side chat is no longer mounted.');
      await controller.show(identity.draftId);
    }
    assertSummaryCurrent();
    if (sideChats.current !== controller || !controller.listMounted().some(value => value.active && sameSummarySideChat(value.identity, identity)))
      throw new Error('The selected side chat changed.');
    setSideChatOpened(true); setPanelKind('side-chat'); setPanelOpen(true);
  };
  const switchHomeTarget = async (target: { hostId: string; cwd: string }, lease: ComposerDraftLease, project: Project | null) => {
    const controller = composerController.current, snapshot = controller?.snapshot(), originalRoute = routeRef.current;
    if (!controller || !snapshot || originalRoute.threadId || originalRoute.section || targetChange.current
      || snapshot.owner.threadId !== null || snapshot.owner.hostId !== originalRoute.hostId) throw new Error('原首页输入区不能切换目标。');
    if (!hostCatalogConfirmed.current || !hosts.some(host => host.hostId === target.hostId)) throw new Error('执行主机列表尚未核实，请重新连接后重试。');
    const assertProject = () => {
      if (!project) return;
      const state = projectStateRef.current;
      const actual = state && projectsForHost(state, target.hostId).find(value => value.id === project.id);
      if (!actual || actual.hostId !== target.hostId || actual.name !== project.name || !actual.rootPaths.includes(target.cwd)) {
        throw new Error('原项目或工作目录已改变，请重新选择。');
      }
    };
    assertProject();
    let committed!: () => void;
    const completion = new Promise<void>(resolve => { committed = resolve; });
    const pending = { controller, owner: snapshot.owner, lease, target, committed };
    targetChange.current = pending;
    try {
      const path = '/' + (target.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(target.hostId));
      if (!await navigate(path, undefined, () => {
        const owner = controller.snapshot()?.owner;
        if (targetChange.current !== pending || composerController.current !== controller || !owner
          || JSON.stringify(owner) !== JSON.stringify(snapshot.owner) || routeRef.current !== originalRoute
          || !hostCatalogConfirmed.current) throw new Error('原输入区或主机已改变，目标未切换。');
        assertProject();
      })) throw new Error('目标切换未完成，原草稿已保留。');
      rememberNewDraftLocation(target.hostId, homeDraftIdentity(target.hostId), target.cwd, project?.id);
      setCwd(target.cwd); setSelectedProject(project); await completion;
    } finally { if (targetChange.current === pending) { targetChange.current = null; setLeaving(false); } }
  };
  const chinese = previewAppearance.locale.startsWith('zh');
  return <I18nProvider locale={previewAppearance.locale}><div className="yard-app" data-sidebar-open={sidebar && !settings} data-settings={settings} data-owned-renderer="true">
    {sidebar && !settings && <StandaloneSidebar {...sidebarBehaviorProps} hostId={current.hostId} currentThread={current.threadId ? { hostId: current.hostId, threadId: current.threadId } : null}
      projectState={projectState} fallbackWorkspace={workspace} rows={list.rows} nextCursor={list.nextCursor} loading={list.loading} error={list.error}
      search={search} archived={archived} shortcutHints={shortcutSidebarHints} onSearchChange={setSearch} onArchivedChange={setArchived} onClose={() => setSidebar(false)}
      onOpenThread={row => { void openThread(row.id, row.hostId, row.archived); }}
      onNewChat={(project, fallback) => { void newChat(project?.rootPaths[0] ?? cwd, fallback ? undefined : project ?? undefined); }}
      onAddProject={addProject} onOpenSettings={() => { void navigate('/settings/general' + (current.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(current.hostId))); }}
      activeProjectId={current.threadId ? null : activeProject?.id ?? null}
      accountLabel={sidebarAccount?.hostId === current.hostId ? sidebarAccount.label : ''}
      onNavigateHistory={direction => { void navigate('/', { delta: direction }); }}
      canNavigateBack={Number(history.state?.__yardIndex ?? 0) > 0}
      onOpenPlugins={() => { void navigate('/plugins' + (current.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(current.hostId))); }}
      onOpenScheduled={() => { void navigate('/scheduled' + (current.hostId === 'local' ? '' : '?hostId=' + encodeURIComponent(current.hostId))); }}
      onRefresh={() => { void list.refresh(); }} onLoadMore={() => { void list.loadMore(); }} onRetryProjectLookup={() => { void reloadProjects().catch(cause => setError(String(cause))); }} />}
    <main className="yard-main">
      {!settings && <header className="yard-toolbar">
        {!sidebar && <button className="yard-icon-button" aria-label="Toggle sidebar" onClick={() => setSidebar(true)}><PanelLeftOpen aria-hidden="true" /></button>}
        {current.threadId && <div className="yard-thread-title"><Folder aria-hidden="true" /><strong>{thread?.name || threads.find(item => item.id === current.threadId)?.name || 'Conversation'}</strong></div>}
        <div className="yard-toolbar-spacer" />
        {current.threadId && <div className="yard-conversation-actions"><button className="yard-icon-button" aria-label="Conversation menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><MoreHorizontal aria-hidden="true" /></button>
          {menu && <div className="yard-menu" role="menu">{['rename', 'fork', 'copy', current.readOnly ? 'restore' : 'archive'].map(name => <button role="menuitem" key={name} onClick={() => { void action(name); }}>{name === 'copy' ? 'Copy conversation link' : name[0]!.toUpperCase() + name.slice(1)}</button>)}
          <button role="menuitem" onClick={() => { setMenu(false); setMessageSearchOpen(true); }}>Search messages</button>
          {!current.readOnly && <button role="menuitem" disabled={loading || leaving || !sendState} onClick={openSideChat}>{chinese ? '新建侧聊' : 'New side chat'}</button>}
          <button role="menuitem" onClick={() => { setMenu(false); setGoalMounted(true); setGoalOpen(value => !value); }}>Goal</button></div>}
        </div>}
        {current.threadId && <button className="yard-icon-button" aria-label="Toggle summary" title="Toggle summary" aria-pressed={summaryOpen}
          onClick={() => setSummaryOpen(value => !value)}><ListTodo aria-hidden="true" /></button>}
        {requests.length > 0 && <details className="yard-toolbar-menu"><summary aria-label="Inspect approval request"><ListTodo aria-hidden="true" /></summary><div className="yard-menu">
          {requests.map(entry => <button key={JSON.stringify(entry.request.ref)} onClick={() => { setSelectedRequest(entry.request.ref); setRequestViewHidden(false); }}>
            {entry.request.hostId}: {entry.request.method} · {entry.outcome}</button>)}
        </div></details>}
        {shellPreferences.values['app-shell-bottom-panel-launcher-visible'] && <button className="yard-icon-button" aria-label="Toggle bottom panel" onClick={() => {
          if (panelOpen && panelKind === 'workspace') setPanelOpen(false); else showPanel({ kind: 'terminal', reuse: true });
        }}><Terminal aria-hidden="true" /></button>}
        <details className="yard-toolbar-menu"><summary aria-label="Open side panel"><PanelRight aria-hidden="true" /></summary><div className="yard-menu" role="menu">
          <button role="menuitem" aria-label="Workspace files" onClick={() => showPanel()}>Files</button>
          <button role="menuitem" aria-label="Open Chrome panel" disabled={!sendState} onClick={() => showBrowser()}><Globe aria-hidden="true" />Chrome</button>
          {sideChatOpened && <button role="menuitem" onClick={() => { setPanelKind('side-chat'); setPanelOpen(true); }}>{chinese ? '侧聊' : 'Side chat'}</button>}
          {visualization?.hostId === current.hostId && visualization.threadId === current.threadId && <button role="menuitem" aria-label="Open visualization" onClick={() => showVisualization(visualization)}>Preview</button>}
          {turnDiff !== undefined && <button role="menuitem" aria-label="Open turn changes" onClick={() => showPanel({ kind: 'diff', diff: turnDiff })}>Changes</button>}
          <label>Execution host<select aria-label="Execution host" value={current.hostId} disabled={!hostCatalogReady} onChange={event => { void navigate('/?hostId=' + encodeURIComponent(event.target.value)); }}>{hosts.map(host => <option key={host.hostId} value={host.hostId}>{host.displayName}</option>)}</select></label>
          {!hostCatalogReady && <button type="button" onClick={() => { void reloadHosts().catch(cause => setError(String(cause))); }}>Retry hosts</button>}
        </div></details>
      </header>}
      {summaryOpen && current.threadId && thread && !settings && !productPage && <div className="yard-summary-overlay" inert={leaving}>
        <ThreadSummaryPanel client={client} hostId={current.hostId} threadId={current.threadId} snapshot={conversation}
          sideChats={summarySideChats.entries} sideChatsLoading={summarySideChats.loading} sideChatsError={summarySideChats.error}
          onRetrySideChats={summarySideChats.retry} onShowSideChat={identity => showSummarySideChat(identity, false)}
          onRestoreSideChat={identity => showSummarySideChat(identity, true)}
          onOpenCreatedChat={async chat => {
            assertSummaryCurrent();
            const daemon = client.captureDaemonConnection(current.hostId);
            const checkReceipt = () => {
              daemon.assertOriginal();
              const source = sessions.view({ hostId: current.hostId, threadId: current.threadId! }).snapshot().thread;
              if (!chat.source || chat.source.hostId !== current.hostId || chat.source.threadId !== current.threadId
                || !projectCreatedChats(source, current.hostId, '').some(value => value.hostId === chat.hostId && value.threadId === chat.threadId
                  && value.source?.turnId === chat.source!.turnId && value.source.itemId === chat.source!.itemId))
                throw new Error('The original created conversation receipt changed.');
            };
            checkReceipt();
            const query = new URLSearchParams(); if (chat.hostId !== 'local') query.set('hostId', chat.hostId);
            await navigate(`/local/${encodeURIComponent(chat.threadId)}${query.size ? '?' + query : ''}`, undefined, () => {
              checkReceipt();
              if (navigationGeneration.current !== summaryGeneration + 1 || routeRef.current.section
                || routeRef.current.hostId !== current.hostId || routeRef.current.threadId !== current.threadId)
                throw new Error('The original summary conversation changed.');
            });
          }}
          projectless={!activeProject} outputs={{ entries: [], loading: false, showWhenEmpty: true,
            canCreate: !current.readOnly && composerIsCurrent && !!mainPromptAppendPort.current }}
          onCreateOutput={createSummaryOutput}
          onOpenPlan={async plan => { assertSummaryCurrent();
            if (plan.hostId !== current.hostId || plan.threadId !== current.threadId) throw new Error('The plan belongs to another conversation.');
            await navigate('/plan-summary' + (plan.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: plan.hostId })),
              { state: { hostId: plan.hostId, conversationId: plan.threadId, planContent: plan.text, cwd: plan.cwd } }, () => {
                if (navigationGeneration.current !== summaryGeneration + 1 || routeRef.current.section
                  || routeRef.current.hostId !== plan.hostId || routeRef.current.threadId !== plan.threadId)
                  throw new Error('The original plan conversation changed.');
              });
          }}
          onOpenFile={value => { assertSummaryCurrent(); if (value.hostId !== current.hostId) throw new Error('The file host changed.'); openFile(value.path, undefined, undefined, value.cwd); }}
          onOpenOutput={output => { assertSummaryCurrent(); if (output.kind === 'file') openFile(output.path, undefined, undefined, thread.cwd);
            else showBrowser({ hostId: current.hostId, threadId: current.threadId!, url: output.url }); }}
          onOpenWebSearch={source => { assertSummaryCurrent();
            if (!source.urls[0]) throw new Error('This search has no result URL to open.');
            showBrowser({ hostId: current.hostId, threadId: current.threadId!, url: source.urls[0] }); }} />
      </div>}
      {!settings && tabs.length > 1 && <div className="yard-tab-strip" role="tablist" aria-label="Workspace tabs">{tabs.map((tab, index) => {
          const slot = document.documentElement.dir === 'rtl' ? tabs.length - index : index + 1;
          return <div className="yard-tab" key={tab.hostId + ':' + tab.id}><button role="tab" aria-selected={tab.id === current.threadId && tab.hostId === current.hostId} onClick={() => { void openTab(tab); }}>{tab.title}{shortcuts.hints === 'tabs' && slot <= 9 && <kbd>{shortcuts.label('tabs', slot as NumberShortcutSlot)}</kbd>}</button><button aria-label={'Close ' + tab.title} onClick={() => setTabs(previous => previous.filter(item => item !== tab))}>×</button></div>;
        })}</div>}
        {!settings && bridgeStatus === 'connected' && hostStatuses[current.hostId] === 'disconnected' && <div className="yard-error" role="status"><span>Host disconnected</span><button onClick={() => {
          const hostId = current.hostId;
          void client.rpc('thread/list', { limit: 1 }, hostId).catch(cause => setError(String(cause)));
        }}>Reconnect host</button></div>}
      {error && <div role="alert" className="yard-error">{error}<button onClick={() => { setError(''); navigation.current?.replaceCurrentURL(location.href); setRefresh(value => value + 1); setNavigationFactsEpoch(value => value + 1); }}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {shellPreferences.error && <div role="alert" className="yard-error">{shellPreferences.error}<button onClick={() => { void shellPreferences.reload(); }}>Retry</button></div>}
      {browserSyncError && <div role="alert" className="yard-error">{browserSyncError}<button onClick={() => setBrowserSyncRetry(value => value + 1)}>Retry browser reference sync</button></div>}
      <div inert={leaving}>
      {Object.entries(browserProjectionState).map(([key, receipt]) => <BrowserDraftRecoveryNotice key={key} before={receipt.before} snapshot={receipt.after}
        onAccept={() => acceptBrowserCommittedVersion(receipt.before, receipt.after)} onDiscard={() => releaseBrowserProjection(receipt.after)} />)}
      {Object.values(sendState?.requests ?? {}).map(intent => <SendRecoveryNotice key={intent.id} intent={intent}
        canCheckInjectionReceipt={sendStore.hasConfirmedInjectionReceipt(intent)}
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
        onRetryInjectionPersistence={async () => { await sendStore.retryNativePersistence(intent.id); await reloadSends(); }}
        onFinish={() => finishSend(intent)} onCancel={async () => { await sendStore.cancel(intent.id); await reloadSends(); }} />)}
      </div>
      <div className="yard-workspace" data-panel-open={panelOpen && !settings}>
      <div className="yard-chat-pane" inert={leaving}>
      {settings ? <InstructionEditorTheme.Provider value={panelAppearance.theme}><StandaloneSettings client={client} hostId={current.hostId}
        onOpenConfig={openSettingsConfig}
        browserIntegrations={{ captureAuthority: captureSettingsBrowserAuthority, navigate: (path, options, assertBeforeCommit) =>
          navigate(path, options, assertBeforeCommit), rawFeatureSource: 'unmodified' }}
        onOpenArchivedThread={async (hostId, threadId) => {
          const original = routeRef.current;
          if (!original.section || original.hostId !== hostId) throw new Error('原归档列表已改变，请重新打开。');
          const search = new URLSearchParams({ archived: '1' });
          if (hostId !== 'local') search.set('hostId', hostId);
          if (!await navigate('/local/' + encodeURIComponent(threadId) + '?' + search, undefined, () => {
            if (routeRef.current !== original) throw new Error('原归档列表已改变，未切换会话。');
          })) throw new Error('归档会话未打开，原页面已保留。');
          if (routeRef.current.hostId === hostId && routeRef.current.threadId === threadId) setArchived(true);
        }}
        projectRoots={settingsContext.projectRoots} sessionCwd={settingsContext.sessionCwd} InstructionEditor={SettingsInstructionEditor}
        scopeStatus={{ state: settingsSource.key === settingsSourceKey ? settingsSource.state : 'loading',
          error: settingsSource.key === settingsSourceKey ? settingsSource.error : undefined, retry: () => setSettingsSourceRetry(value => value + 1) }}
        location={{ pathname: current.pathname, search: current.search, hash: current.hash, state: current.state }} onNavigate={navigate}
        registerNavigationGuard={registerNavigationGuard} onClose={() => navigate(settingsOrigin?.returnTo ?? '/')} /></InstructionEditorTheme.Provider> : productPage ? <ProductWorkspace
        client={client} location={current} {...productAuthority} cwd={cwd || workspace} isCurrent={productCurrent}
        configurationWrites={configurationWrites} navigate={navigateProduct}
        renderUnresolved={(value, reason) => <section className="yard-product-unresolved" role="alert"><p>{value.kind === 'invalid' ? value.message : `This page cannot be opened on the current host (${reason}).`}</p><button onClick={() => { void navigate(productPath('/', current.hostId)); }}>Back</button></section>}
        onAuthenticated={async owner => { if (!await navigateProduct(productPath('/first-run', owner.hostId), undefined, owner)) throw new Error('Navigation was not completed.'); }}
        onFirstRunContinue={async owner => { if (!await navigateProduct(productPath('/select-workspace', owner.hostId), undefined, owner)) throw new Error('Navigation was not completed.'); }}
        workspace={{
          onCreateProject: createProductProject,
          onCommitSelection: async (owner, roots) => {
            productCheck(owner);
            const state = await client.host<ProjectState>('thread-project-state'); productCheck(owner);
            const existing = projectsForHost(state, owner.hostId);
            for (const path of roots) {
              if (existing.some(project => project.rootPaths.includes(path))) continue;
              productCheck(owner);
              await client.host('project-add', { hostId: owner.hostId, path, name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }, { assertBeforeSend: () => productCheck(owner) });
            }
            await reloadProjects(); productCheck(owner); return true;
          },
          onComplete: async owner => { if (!await navigateProduct(productPath('/', owner.hostId), undefined, owner)) throw new Error('Navigation was not completed.'); },
        }}
        projects={{ hasUnresolvedChanges: !!projectState && (!projectState.inventory.complete || Object.keys(projectState.unresolved.assignments).length > 0 || projectState.unresolved.projectless.length > 0 || projectState.unresolved.qualified.length > 0),
          onCreateProject: createProductProject,
          onComposeProject: async (owner, project) => {
            productCheck(owner);
            if (project.hostId !== owner.hostId || !project.rootPaths[0]) throw new Error('The selected project has changed.');
            if (!await navigateProduct(productPath('/', owner.hostId), undefined, owner)) throw new Error('Navigation was not completed.');
            const draftId = crypto.randomUUID(); selectHomeDraftIdentity(owner.hostId, draftId);
            rememberNewDraftLocation(owner.hostId, draftId, project.rootPaths[0], project.id);
            setHomeGeneration(value => value + 1); setCwd(project.rootPaths[0]); setSelectedProject(project);
          },
          onOpenThread: async (owner, target) => {
            productCheck(owner);
            if (target.hostId !== owner.hostId) throw new Error('The selected host changed.');
            if (!await navigateProduct(productPath('/local/' + encodeURIComponent(target.threadId), target.hostId), undefined, owner)) throw new Error('Navigation was not completed.');
          },
        }}
        plan={{ cwd: typeof record(current.state).cwd === 'string' ? record(current.state).cwd as string : null }}
        onOpenFile={(owner, target) => { productCheck(owner); if (target.hostId !== owner.hostId) throw new Error('The selected host changed.'); openFile(target.path, undefined, undefined, target.cwd); }}
        onTrySkill={(owner, target) => tryProductDraft(owner, target.cwd, { text: '', images: [], files: [], skills: [target.skill] })}
        onTryPlugin={(owner, target) => tryProductDraft(owner, target.cwd, { text: '$' + target.plugin.name + ' ', images: [], files: [] })}
      /> : <>
        <section className={'yard-conversation ' + (!current.threadId ? 'yard-home' : '')} inert={leaving}>
          {streamGap && <p role="status" className="yard-stream-gap">此页面未收到连续的活动内容，正在核对会话记录。{isThreadBusy(thread) && '任务正在运行；完成后将重新读取完整记录。'}</p>}
          {loading ? <div role="status" className="yard-loading">Loading conversation…</div> : current.threadId ? <StandaloneMessages client={client} hostId={current.hostId} threadId={current.threadId} thread={thread} editRecovery={editState?.recovery ?? null} editAccess={editAccess} editHistory={{ order: 'ascending', tailComplete: historyComplete }}
            searchOpen={messageSearchOpen} onSearchOpenChange={setMessageSearchOpen}
            editRebase={messageEditRebaseMarker(editState)} onPrepareEditRebase={(origin, version) => editStore.prepareRebase(origin, version)}
            onCommitEditRebase={async candidate => {
              const recovered = await editStore.commitRebase(candidate);
              void sessions.refresh(recovered.origin).catch(cause => setError(String(cause)));
              return recovered;
            }}
            onEditNavigationController={receiveMessageEditController}
            onEditDraftChange={(value, origin, version, authority) => editStore.save(value, origin, version, authority)}
            onOpenFile={openFile} onOpenFileAt={location => {
              if (location.hostId !== current.hostId) { setError('文件所属主机已改变，请返回原会话打开。'); return; }
              openFile(location.path, location.line, location.column, location.cwd ?? panelCwd);
            }} onOpenVisualization={showVisualization} onOpenBrowser={showBrowser}
            onEdit={current.readOnly ? undefined : (draft, origin, prepare?: () => Promise<void>) => submit(draft, {}, { type: 'send' }, origin, undefined, undefined, undefined, prepare)} onFork={turnId => action('fork', turnId)} /> : <div className="yard-home-heading"><img src="/brand/icon.svg" alt="" /><h1>{activeProject
              ? <>{chinese ? '我们应该在' : 'What should we work on in'}{' '}<button aria-haspopup="menu" aria-expanded={projectPickerOpen} onClick={() => setProjectPickerOpen(value => !value)}>{activeProject.name}</button>{chinese ? '中做些什么？' : '?'}</>
              : chinese ? '我们来做些什么？' : 'What should we work on?'}</h1>
              {projectPickerOpen && <div className="yard-menu yard-home-project-menu" role="menu">
                {(projectState ? projectsForHost(projectState, current.hostId) : []).map(project => <button key={project.id} role="menuitem" onClick={() => { setProjectPickerOpen(false); void newChat(project.rootPaths[0], project); }}><Folder aria-hidden="true" />{project.name}</button>)}
                <button role="menuitem" onClick={() => { setProjectPickerOpen(false); addProject(); }}>{chinese ? '添加项目' : 'Add project'}</button>
              </div>}</div>}
        </section>
        <div className="yard-composer-container" inert={leaving}>
          {!current.threadId && !loading && composerIsCurrent && <HomeSubagentsBanner key={composerOwnerKey(composerOwner)}
            client={client} hostId={current.hostId} cwd={cwd} captureMain={captureMainPrompt} onError={setError}
            onTryNow={(text, prefillId, assertOriginal) => appendMainPrompt({ type: 'doc', content: [
              { type: 'paragraph', content: [{ type: 'text', text }] },
            ] }, prefillId, assertOriginal)} />}
          {current.threadId && !loading && goalMounted && <div hidden={!goalOpen}><StandaloneGoal client={client} hostId={current.hostId} threadId={current.threadId} readOnly={current.readOnly} /></div>}
          {current.threadId && <FullAccessNotice client={client} options={effectiveComposerOptions?.owner.hostId === composerOwner.hostId
            && effectiveComposerOptions.owner.threadId === composerOwner.threadId && effectiveComposerOptions.owner.draftId === composerOwner.draftId
            ? effectiveComposerOptions.options : initialOptions} sessionDismissed={fullAccessDismissed} onDismissSession={() => setFullAccessDismissed(true)} />}
          {current.readOnly && <p role="status">此会话已归档，原输入已保留。<button onClick={() => { void client.rpc('thread/unarchive', { threadId: current.threadId }, current.hostId).then(() => openThread(current.threadId!, current.hostId, false)).catch(cause => setError(String(cause))); }}>Restore conversation</button></p>}
          <div inert={current.readOnly}>
          {!sendState || current.threadId && (loading || !initialOptions) && !(composerIsCurrent || current.readOnly && thread) ? current.readOnly ? null : <p role="status">Loading session settings…</p> : <StandaloneComposer key={current.hostId + ':' + (current.threadId ?? newDraftId)} client={client} context={{ ...composerOwner, cwd: thread?.cwd ?? cwd }}
          readOnly={current.readOnly}
          onRemoveReference={(owner, reference, operation) => removeBrowserDraftReference(browserDraftOwner(owner, sendBindings.current), reference,
            operation, retainBrowserProjection, releaseBrowserProjection)}
          onDraftController={receiveComposerController} onDraftChange={receiveComposerSnapshot} onPromptAppendPort={receivePromptAppendPort}
          initialOptions={initialOptions ?? undefined} hosts={hosts}
          onEffectiveOptionsChange={receiveEffectiveOptions}
          fullAccessVisible={fullAccessVisible(shellPreferences.values['composer-permission-mode-visibility'])}
          onOpenGoal={current.threadId && !current.readOnly ? () => { setGoalMounted(true); setGoalOpen(true); } : undefined}
          projectDisplay={activeProject && activeProject.hostId === current.hostId && activeProject.rootPaths.includes(thread?.cwd ?? cwd) ? { hostId: current.hostId, cwd: thread?.cwd ?? cwd, name: activeProject.name } : null}
          projectChoices={!current.threadId && projectState && hostCatalogReady ? hosts.flatMap(host => projectsForHost(projectState, host.hostId)
            .flatMap(project => project.rootPaths.map(cwd => ({ projectId: project.id, hostId: project.hostId, cwd, name: project.name })))) : undefined}
          selectedProjectId={activeProject?.id ?? null}
          onProjectChange={current.threadId ? undefined : async (choice, lease) => {
            const state = projectStateRef.current;
            const project = choice && state ? projectsForHost(state, choice.hostId).find(project => project.id === choice.projectId
              && project.name === choice.name && project.rootPaths.includes(choice.cwd)) : null;
            if (choice && !project) throw new Error('原项目已改变，请重新选择。');
            await switchHomeTarget(choice ?? { hostId: current.hostId, cwd }, lease, project ?? null);
          }}
          onTargetChange={current.threadId ? undefined : (target, lease) => switchHomeTarget(target, lease, null)}
          activeTurnId={thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null} busy={busy}
          captureSubmissionAuthority={captureMainSubmissionAuthority}
          dispatchQueueMutation={(method, params, hostId, originalAuthority, assertBeforeSend) => {
            const original = mainSubmissionAuthorities.current.get(originalAuthority);
            if (!original || original.owner.hostId !== hostId || original.owner.threadId !== params.threadId) {
              throw Object.assign(new Error('原队列目标权限尚未捕获，未派发。'), { uncertain: false, sendPhase: 'before-send' });
            }
            assertBeforeSend();
            return client.rpc(method, params, hostId, { assertBeforeSend, daemonConnectionGeneration: original.daemon.generation });
          }}
          removeQueuedOriginal={(entry, originalAuthority, assertBeforeSend) => {
            const original = mainSubmissionAuthorities.current.get(originalAuthority);
            if (!original?.owner.threadId) throw Object.assign(new Error('原队列输入身份尚未确认，未删除。'), { uncertain: false, sendPhase: 'before-send' });
            return client.host<'deleted' | 'changed'>('queue-edit', { hostId: original.owner.hostId, threadId: original.owner.threadId,
              entry, daemonConnectionGeneration: original.daemon.generation }, { assertBeforeSend: () => {
              assertBeforeSend(); original.daemon.assertOriginal();
            } });
          }}
          onSubmit={(draft, options, action, description, authority) => submit(draft, options, action, undefined, description, undefined, undefined, undefined, authority)} onInterrupt={interrupt} onStartQueued={async (queuedSubmissionId, authority, originalAuthority) => {
          if (!authority || !originalAuthority) throw Object.assign(new Error('原队列权限尚未捕获，未启动。'), { uncertain: false, sendPhase: 'before-send' });
          authority();
          const grant = mainSubmissionAuthorities.current.get(originalAuthority), daemon = grant?.daemon;
          if (!daemon || grant.owner.hostId !== current.hostId || grant.owner.threadId !== current.threadId) throw Object.assign(new Error('原队列的 daemon 连接未捕获，未启动。'), { uncertain: false, sendPhase: 'before-send' });
          if (!current.threadId || current.readOnly || inFlight.current || isThreadBusy(threadRef.current)) throw new Error('当前会话暂时无法启动队列。');
          const identity = { hostId: current.hostId, threadId: current.threadId }, generation = navigationGeneration.current;
          inFlight.current = true; setSubmitting(true);
          try {
            await sessions.ready(identity);
            const assertBeforeSend = () => {
              authority();
              const view = sessions.view(identity).snapshot(), route = routeRef.current;
              if (generation !== navigationGeneration.current || route.hostId !== identity.hostId || route.threadId !== identity.threadId
                || route.readOnly || !view.canSubmit || isThreadBusy(view.thread)) throw Object.assign(new Error('会话目标或状态已改变，队列未启动。'), { uncertain: false });
            };
            await client.rpc('thread/queue/start', { threadId: identity.threadId, queuedSubmissionId }, identity.hostId,
              { assertBeforeSend, daemonConnectionGeneration: daemon.generation });
          }
          finally { finishMainDispatch(); }
        }} />}</div></div>
      </>}
      </div>
      <aside className="yard-workspace-panel" hidden={!panelOpen || settings} aria-label="Workspace panel" inert={leaving}>
        <div className="yard-side-chat-workspace" hidden={panelKind !== 'side-chat'}><SideChatRoot client={client} sessions={sessions} sends={sendStore} edits={editStore} approvals={approvals}
          visible={panelOpen && !settings && panelKind === 'side-chat'} captureParent={captureSideChatParent}
          onController={receiveSideChatController} onActiveChild={receiveSideChatChild}
          freezeChildOwner={freezeSideChatOwner} cancelSend={(intent, guard) => sendStore.cancelOriginal(intent, guard)}
          cleanupChild={cleanupSideChat}
          onClosed={identity => { if (sideChatActive.current?.identity.prepareId === identity.prepareId) setPanelOpen(false); }}
          onExitObservation={() => setPanelOpen(false)}
          onRemoveReference={(_child, owner, reference, operation) => removeBrowserDraftReference(browserDraftOwner(owner, sendBindings.current), reference,
            operation, retainBrowserProjection, releaseBrowserProjection)}
          onOpenFile={value => {
            const child = sideChatActive.current;
            if (!child || child.owner.hostId !== value.hostId || child.owner.threadId !== value.threadId) throw new Error('原侧聊文件来源已改变。');
            showPanel({ kind: 'file', path: resolveFilePath(value.cwd ?? child.identity.cwd, value.path), line: value.line, column: value.column }, child);
          }}
          onOpenBrowser={value => {
            const child = sideChatActive.current;
            if (!child || child.owner.hostId !== value.hostId || child.owner.threadId !== value.threadId) throw new Error('原侧聊浏览器来源已改变。');
            showBrowser(value, child);
          }}
          onOpenVisualization={value => {
            const child = sideChatActive.current;
            if (!child || child.owner.hostId !== value.hostId || child.owner.threadId !== value.threadId) throw new Error('原侧聊可视化来源已改变。');
            showVisualization(value, child);
          }} /></div>
        <div hidden={panelKind !== 'workspace'} style={{ height: '100%' }}>{panelMounted && <WorkspacePanels ref={workspacePanels} client={client} scopeId={panelScope} hostId={panelHostId} threadId={panelThreadId ?? undefined} cwd={panelCwd}
          appearance={panelAppearance} request={panelRequest} onRequestConsumed={id => setPanelRequest(previous => previous?.id === id ? null : previous)}
          onNewTerminal={() => { try { showPanel({ kind: 'terminal' }, sideChatSource); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}
          onRecoveryBarrier={receivePanelRecoveryBarrier}
          onClose={() => setPanelOpen(false)} onReference={addReference} onDirtyChange={dirty => { panelsDirty.current = dirty; }} />}</div>
        {browserMounted && <StandaloneBrowser client={client} {...browserOwner} browserTabId="primary"
          draft={panelComposerSnapshot && browserOwnerKey(browserDraftOwner(panelComposerSnapshot.owner, sendState?.bindings ?? {})) === browserOwnerKey(browserOwner)
            ? panelComposerSnapshot.draft : { text: '', images: [], files: [] }}
          visible={panelOpen && !settings && panelKind === 'browser'} allowNavigation
          navigationRequest={browserNavigation} onNavigationConsumed={id => setBrowserNavigation(previous => previous?.id === id ? null : previous)}
          beginDraftOperation={beginBrowserDraftOperation} onDraftVersionCommitted={acceptBrowserCommittedVersion}
          onRecoveryBarrier={receiveBrowserRecoveryBarrier} onClose={() => setPanelOpen(false)} />}
        {panelOpen && !settings && panelKind === 'visualization' && visualization?.hostId === panelHostId && visualization.threadId === panelThreadId
          && <StandaloneVisualization client={client} {...visualization} theme={previewAppearance.theme} themeVariables={previewAppearance.variables}
            locale={previewAppearance.locale} onPrefill={addReference} onFollowUp={async (request, signal) => {
              const child = sideChatSourceRef.current;
              if (child) {
                checkPanelChild(child);
                if (signal.aborted || request.hostId !== child.owner.hostId || request.threadId !== child.owner.threadId || !sideChats.current) {
                  throw new Error('可视化所属侧聊已改变，输入未发送。');
                }
                await sideChats.current.submitVisualization(structuredClone(request), signal);
                return;
              }
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
