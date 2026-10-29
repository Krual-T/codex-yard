import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/renderer/i18n/index.tsx';
import { ProductRoutePage } from '../src/renderer/app/ProductRoutePage.tsx';
import type { ProductAccess, ProductAuth, ProductPagePorts } from '../src/renderer/app/ProductRoutePage.tsx';
import type { ProductLocation } from '../src/renderer/app/product-routes.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { AutomationChange, AutomationDraftIdentity, AutomationEditorDraft, AutomationEntry, AutomationItem, AutomationRouteCompletion } from '../src/renderer/pages/automations/model.ts';
import { draftIdentity, newDraft, sameDraftIdentity } from '../src/renderer/pages/automations/model.ts';

type Call = { method: string; hostId?: string; data?: unknown };
declare global {
  interface Window {
    productRouteHarness: {
      calls: Call[];
      show(url: string, host: string, state?: unknown): void;
      showFromUrl(url: string, state?: unknown): void;
      currentHost(): string;
      currentLocation(): ProductLocation;
      resolveOld(): void;
      setGeneration(value: number): void;
      setAuth(value: 'required' | 'ready'): void;
      setAccess(value: 'allow' | 'scheduled' | 'shared' | 'denied' | 'legacy' | 'app'): void;
      setNavigationAllowed(value: boolean): void;
      setAutomationMode(value: 'reject' | 'pages' | 'complete' | 'timed' | 'heartbeat' | 'direct' | 'create-failing' | 'empty-complete'): void;
      setShareAllowed(value: boolean): void;
      setBridgeFallback(value: boolean): void;
      setRunAccountId(value: string | null | undefined): void;
      setRunAccess(value: boolean | undefined): void;
      setRouteProof(value: 'none' | 'team' | 'draft' | 'draft-mismatch' | 'template'): void;
      setLegacyProject(value: 'loading' | 'enabled' | 'disabled' | 'mapped' | 'wrong-user'): void;
      setLocale(value: string): void;
      hold(value: 'prepare' | 'track' | 'response' | 'selection' | 'navigation' | 'reconcile' | 'finalize'): void;
      release(): void;
      revokeWithoutRender(): void;
      replaceDraft(): void;
      editorSnapshot(): AutomationEditorDraft | null;
      reload(): void;
      setRunType(value: string): void;
      enableWrites(): void;
      setDraftProof(field: 'hostId' | 'accountKey' | 'sessionKey' | 'draftRevision' | 'taskId' | 'taskRevision' | 'sourceKey' | 'source' | 'teamId' | null): void;
      resolveDetail(): void;
      seedRecovery(kind: 'create' | 'update' | 'delete', variant: 'valid' | 'not-sent' | 'server-id' | 'wrong-host' | 'wrong-account' | 'wrong-installation' | 'wrong-user' | 'wrong-id' | 'wrong-identity'): void;
      setSnapshotlessSave(value: boolean, automationId?: string, idMatchesRequestId?: boolean): void;
    };
  }
}

const calls: Call[] = [];
let location: ProductLocation = { pathname: '/projects', search: '', hash: '', state: null };
let hostId = 'old', auth: ProductAuth = { state: 'ready' }, access: ProductAccess = { state: 'allow', scheduledTasks: 'allowed' };
let generation = 1, locationKey = 1;
let oldResolve: (() => void) | null = null, newProjectFails = true, agentFails = true, navigationAllowed = true;
const detailResolvers: (() => void)[] = [];
let projectDetailFails = true, sharedFails = true, shareFails = true, runFails = true, taskDetailFails = true;
let automationMode: 'reject' | 'pages' | 'complete' | 'timed' | 'heartbeat' | 'direct' | 'create-failing' | 'empty-complete' = 'reject', shareAllowed = true;
let bridgeFallback = false;
let runAccountId: string | null | undefined = 'account', runAccess: boolean | undefined = true;
let routeProof: 'none' | 'team' | 'draft' | 'draft-mismatch' | 'template' = 'none';
let editor: AutomationEditorDraft | null = null;
let legacyProject: 'loading' | 'enabled' | 'disabled' | 'mapped' | 'wrong-user' = 'disabled', locale = 'en-US', live = true, runType = 'codex', writesEnabled = false;
let holding: 'prepare' | 'track' | 'response' | 'selection' | 'navigation' | 'reconcile' | 'finalize' | null = null, releaseBarrier: (() => void) | null = null;
let pendingNavigation: AutomationRouteCompletion | null = null;
let recovery: { change: AutomationChange; identity: AutomationDraftIdentity | null; automationId: string; user: string; state: 'confirmed' | 'not-sent' } | null = null;
let recoverySettled = false;
let snapshotlessSave = false, snapshotlessId: string | undefined, idMatchesRequestId = true;
let draftProof: 'hostId' | 'accountKey' | 'sessionKey' | 'draftRevision' | 'taskId' | 'taskRevision' | 'sourceKey' | 'source' | 'teamId' | null = null;
async function barrier(stage: typeof holding) {
  if (holding !== stage) return;
  calls.push({ method: 'held-' + stage });
  await new Promise<void>(resolve => { releaseBarrier = resolve; });
  calls.push({ method: 'released-' + stage });
  holding = null;
}
const automationEntry = (id: string, source: 'local' | 'cloud'): AutomationEntry => ({
  sourceKey: source, location: source, timing: 'known', edit: { allowed: true }, delete: { allowed: true }, run: { allowed: true },
  allowedStatuses: ['PAUSED'], allowUnvalidatedPaused: true,
  item: { id, revision: 'revision-1', kind: 'cron', name: `${source} ${id}`, prompt: 'Fixture prompt', status: 'PAUSED', rrule: 'FREQ=DAILY',
    model: null, reasoningEffort: null, notificationPolicy: null, createdAt: 0, updatedAt: 0, nextRunAt: null, nextRunNominalAt: null, lastRunAt: null,
    target: { type: 'projectless' }, cwds: [], executionEnvironment: 'local', localEnvironmentConfigPath: null, pluginTemplateId: null, autoArchive: false },
});
const client = {
  async rpc(method: string, params: unknown, host?: string) {
    calls.push({ method, hostId: host, data: params });
    if (method === 'skills/list') return { data: [{ cwd: '/work', skills: [{ name: 'Synthetic skill', description: 'fixture', path: '/work/SKILL.md', scope: 'user', enabled: true }], errors: [] }] };
    if (method === 'plugin/installed') throw new Error('fixture installed failure');
    if (method === 'plugin/list') return { marketplaces: [] };
    if (method === 'account/read') return { requiresOpenaiAuth: true, account: null };
    if (method === 'configRequirements/read') return { requirements: { allowedLoginMethods: ['chatgpt'] } };
    throw new Error(`Unexpected RPC: ${method}`);
  },
  async host(endpoint: string, params: { hostId?: string }) { calls.push({ method: endpoint, hostId: params.hostId, data: params }); throw new Error(`fixture host rejection: ${endpoint}`); },
  subscribe() { return () => {}; },
  async reply() { throw new Error('Unexpected reply'); },
} as unknown as WorkbenchClient;
const root = createRoot(document.getElementById('root')!);

function render() {
  const scope = { hostId, identity: { accountId: 'account', userId: 'user' }, sessionKey: `session-${hostId}-${generation}` };
  const pages: ProductPagePorts = {
    skills: { hasUnresolvedChanges: false },
    plugins: { hasUnresolvedChanges: false, accountKey: 'account', onLoadPersonalPlugins: async value => {
      calls.push({ method: 'personal-plugins', hostId: value.hostId, data: value.section });
      throw new Error('fixture HTTP allowlist rejection');
    } },
    projects: { accountKey: 'account', sessionKey: scope.sessionKey, hasUnresolvedChanges: false,
      onLoadProjects: async value => {
        calls.push({ method: 'projects', hostId: value.hostId, data: { query: value.query, sessionKey: scope.sessionKey } });
        if (value.hostId === 'old' || value.hostId === 'same' && scope.sessionKey === 'session-same-1') await new Promise<void>(resolve => { oldResolve = resolve; });
        if (value.hostId === 'new' && newProjectFails) { newProjectFails = false; throw new Error('fixture projects failure'); }
        const name = value.hostId === 'old' ? 'Stale project' : value.hostId === 'same' ? scope.sessionKey === 'session-same-1' ? 'Stale generation project' : 'Current generation project' : 'Current project';
        return { items: [{ id: value.hostId, kind: 'local', hostId: value.hostId, name, location: '/work', updatedAt: null,
          pinned: false, canEdit: false, canRemove: false, canArchive: false, canCreateChat: false }], nextCursor: null, warnings: [] };
      } },
    projectHome: { localProject: legacyProject === 'mapped' || legacyProject === 'wrong-user' ? { hostId, accountKey: 'account', userKey: legacyProject === 'mapped' ? 'user' : 'someone-else', routeProjectId: 'g-p-123', projectId: 'local-project' } : undefined,
      onLoadProject: bridgeFallback ? undefined : async value => {
      calls.push({ method: 'project-detail', hostId: value.hostId, data: { projectId: value.projectId, sessionKey: scope.sessionKey } });
      if (value.projectId === 'slow') await new Promise<void>(resolve => { detailResolvers.push(resolve); });
      if (value.projectId === '') throw new Error('fixture empty project ID');
      if (value.projectId === 'alpha' && projectDetailFails) { projectDetailFails = false; throw new Error('fixture project detail rejection'); }
      return { requestedProjectId: value.projectId, project: { id: value.projectId === 'alias' ? 'canonical' : value.projectId, hostId: value.hostId, kind: 'cloud', name: `Project ${value.projectId}`, location: null, updatedAt: null,
        pinned: null, canEdit: false, canRemove: false, canArchive: false, canCreateChat: true } };
    }, renderComposer: value => <div><h2>Project composer: {value.project?.name ?? value.projectId}</h2><output data-testid="project-composer">{JSON.stringify({ hostId: value.hostId, projectId: value.projectId, location: value.location })}</output><output data-testid="local-project">{value.localProjectId ?? ''}</output><output data-testid="canonical-project">{value.project?.id ?? ''}</output></div> },
    agents: { identity: scope.identity, sessionKey: scope.sessionKey, enabled: true, canBuild: true,
      onLoadAgents: async value => { calls.push({ method: 'agents', hostId: value.hostId, data: value.view }); throw new Error('fixture HTTP allowlist rejection'); } },
    agentDetail: { scope, canBuild: false, canShare: false, hasUnresolvedChanges: false, isCurrent: value => value.hostId === hostId,
      onLoadDetail: async value => {
        calls.push({ method: 'agent-detail', hostId: value.hostId, data: value.agentId });
        if (agentFails) { agentFails = false; throw new Error('fixture detail failure'); }
        return { agentId: value.agentId, capability: 'hermes_read', creatorName: null, isPrivateToCreator: false, isPinned: null,
          published: { name: 'Synthetic agent', description: '', tagline: '', icon: null, starterPrompts: [], connectors: [], persistentFolder: null } };
      },
      onLoadActivity: async () => ({ items: [], scheduled: [], nextCursor: null, warnings: [] }) },
    agentCreate: { scope, canBuild: false, hasUnresolvedChanges: false, isCurrent: value => value.hostId === hostId },
    agentEditor: { scope, canBuild: false, hasUnresolvedChanges: false, isCurrent: value => value.hostId === hostId, draft: null, models: { state: 'loading' },
      onBack: value => { calls.push({ method: 'editor-back', hostId: value.hostId, data: { agentId: value.agentId, dirty: value.dirty } }); } },
    automations: { accountKey: 'account', installationKey: null, sessionKey: scope.sessionKey, hasUnresolvedChanges: !!recovery && !recoverySettled, editor,
      isCurrent: value => value.hostId === hostId && value.accountKey === 'account' && value.sessionKey === `session-${hostId}-${generation}`,
      create: { sourceKey: routeProof === 'team' ? 'team-source' : 'local', location: routeProof === 'team' ? 'team' : 'local', teamId: routeProof === 'team' ? 'team-a' : null, capability: automationMode === 'reject' ? { allowed: false, reason: 'fixture creation denied' } : { allowed: true }, allowedStatuses: ['PAUSED'], allowUnvalidatedPaused: true, idMatchesRequestId },
      routeCreateTeam: routeProof === 'team' ? { teamId: 'team-a', sourceKey: 'team-source' } : undefined,
      routeDraft: (routeProof === 'draft' || routeProof === 'draft-mismatch') && editor ? { id: 'oauth-draft', state: 'ready', identity: draftProof ? { ...draftIdentity(editor), [draftProof]: draftProof === 'source' ? 'cloud' : 'other-value' } : draftIdentity(editor) } : undefined,
      routeTemplate: routeProof === 'template' ? { state: 'ready' } : undefined,
      projects: { state: 'loading' }, threads: { state: 'loading' }, models: { state: 'loading' },
      onLoad: async value => {
        if (automationMode === 'reject' || automationMode === 'create-failing') return client.host('list-automations', { hostId: value.hostId });
        calls.push({ method: 'automation-list', hostId: value.hostId });
        if (automationMode === 'empty-complete') return { items: [], sources: [], complete: true, nextCursor: null };
        if (automationMode === 'complete') return { items: [automationEntry('first', 'local')], sources: [], complete: true, nextCursor: null };
        if (automationMode === 'timed') { const entry = automationEntry('timed', 'local'); return { items: [{ ...entry, timing: 'known', item: { ...entry.item, nextRunAt: 1_800_000_000_000 } }], sources: [], complete: true, nextCursor: null }; }
        if (automationMode === 'heartbeat') { const entry = automationEntry('heartbeat', 'local'); return { items: [{ ...entry, item: { ...entry.item, kind: 'heartbeat', targetThreadId: 'heartbeat-thread' } as AutomationItem }], sources: [], complete: true, nextCursor: null }; }
        return { items: [automationEntry('first', 'local')], sources: [], complete: false, nextCursor: 'page-2' };
      },
      onLoadMore: async value => { calls.push({ method: 'automation-more', hostId: value.hostId, data: value.cursor });
        return { items: [automationEntry('target', 'local')], sources: [], complete: true, nextCursor: null }; },
      onLoadDetail: automationMode === 'direct' ? async value => {
        calls.push({ method: 'automation-detail', hostId: value.hostId, data: { automationId: value.automationId, source: value.source, teamId: value.teamId, sessionKey: value.sessionKey } });
        if (value.automationId === 'slow') await new Promise<void>(resolve => { detailResolvers.push(resolve); });
        if (value.automationId === 'missing-404' || value.automationId === 'missing-410') throw Object.assign(new Error('fixture upstream missing'), { code: 'UPSTREAM_ERROR', status: value.automationId === 'missing-404' ? 404 : 410 });
        if (value.automationId === 'denied-403') throw Object.assign(new Error('fixture upstream denied'), { code: 'UPSTREAM_ERROR', status: 403 });
        if (value.automationId.startsWith('cloud-confirmation-')) {
          const id = value.automationId.slice('cloud-confirmation-'.length), entry = automationEntry(value.automationId, 'cloud');
          const triggers: Record<string, unknown[]> = {
            gmail: [{ connector_type: 'gmail', webhook_name: 'message', params: {} }],
            slack: [{ connector_type: 'slack', webhook_name: 'message', params: {}, presentation: { condition_rows: [{ id: 'channels', value: '#team' }, { id: 'event', value: 'New Message' }] } }],
            slackspecial: [{ connector_type: 'slack', webhook_name: 'message', params: {}, presentation: { condition_rows: [{ id: 'channels', value: '#team' }, { id: 'event', value: 'Mentions $& {channels}' }] } }],
            slackparams: [{ connector_type: 'slack', webhook_name: 'message', params: { channel_names: ['team', 'alerts'], channel_ids: ['one', 'two'], include_thread_replies: false } }],
            github: [{ connector_type: 'github', webhook_name: 'pull_request', params: { repository: 'org/repo', only_on_merge: true, author_login: 'pat' } }],
            githubpresentation: [{ connector_type: 'github', webhook_name: 'pull_request', params: {}, presentation: { condition_rows: [{ id: 'repository', value: 'org/repo' }] } }],
            fallback: [{ connector_type: 'other', webhook_name: 'other', params: {} }],
          };
          return { ...entry, item: { ...entry.item, rrule: id === 'time' || id === 'watchtime' ? 'FREQ=DAILY' : 'X-UNSCHEDULED:1', nextRunAt: 1_800_000_000_000 },
            cloudLanding: { timing_mode: id === 'time' ? 'scheduled' : 'condition_watch', default_timezone: 'America/New_York', webhook_triggers: id === 'null' ? null : triggers[id] ?? [] } };
        }
        if (taskDetailFails) { taskDetailFails = false; throw new Error('fixture task detail rejection'); }
        const entry = automationEntry(value.automationId, value.source);
        return value.teamId === null ? entry : { ...entry, location: 'team', teamId: value.automationId === 'mismatch' ? 'other-team' : value.teamId };
      } : undefined,
      onEditorChange: (_scope, expected, value) => { calls.push({ method: 'editor-change', data: { expected, value } }); if (expected ? !editor || !sameDraftIdentity(expected, draftIdentity(editor)) : !!editor) return false; editor = value; render(); return true; },
      onPrepareEditor: async ({ identity, operationId }) => { calls.push({ method: 'prepare', hostId, data: operationId }); await barrier('prepare'); if (!editor || !sameDraftIdentity(identity, draftIdentity(editor))) return 'changed'; editor = { ...editor, pendingOperationId: operationId }; render(); return 'prepared'; },
      isCurrentEditor: (identity, operationId) => !!editor && sameDraftIdentity(identity, draftIdentity(editor)) && editor.pendingOperationId === operationId,
      onFinalizeChange: async ({ scope, identity, change, outcome, completion }) => { calls.push({ method: 'finalize', hostId: change.hostId, data: { operationId: change.operationId, state: outcome.state, scope, completion, identity, change, outcome } }); await barrier('finalize'); if (!live || scope.sessionKey !== `session-${hostId}-${generation}` || identity && (!editor || !sameDraftIdentity(identity, draftIdentity(editor)) || editor.pendingOperationId !== change.operationId)) return 'changed'; if (identity && editor) editor = outcome.state === 'confirmed' ? null : { ...editor, pendingOperationId: null }; if (outcome.state === 'confirmed') pendingNavigation = completion; recoverySettled = true; render(); return 'applied'; },
      pendingNavigation,
      isCurrentCompletion: (value, currentScope) => live && currentScope.hostId === hostId && currentScope.accountKey === 'account' && currentScope.installationKey === null && currentScope.sessionKey === `session-${hostId}-${generation}` && value.hostId === hostId && value.accountKey === 'account' &&
        (value.sessionKey === `session-${hostId}-${generation}` || !!recovery && recovery.user === 'user' && recovery.change.operationId === value.operationId && recovery.change.sessionKey === value.sessionKey) &&
        value.origin.pathname === location.pathname && value.origin.search === location.search && value.origin.hash === location.hash && JSON.stringify(value.origin.state) === JSON.stringify(location.state),
      onAcknowledgeNavigation: async (_scope, operationId) => { calls.push({ method: 'ack-navigation', data: operationId }); if (pendingNavigation?.operationId === operationId) pendingNavigation = null; },
      onCreate: async value => { calls.push({ method: 'create-task', hostId: value.hostId, data: value }); await barrier('response'); return snapshotlessSave ? { automationId: snapshotlessId ?? value.requestId } : { item: { ...automationEntry(value.requestId, 'local').item, ...value.draft, id: value.requestId, revision: 'created-revision' } as AutomationItem }; },
      onUpdate: writesEnabled ? async value => { calls.push({ method: 'update-task', hostId: value.hostId, data: value }); return snapshotlessSave ? { automationId: value.id } : { item: { ...automationEntry(value.id, 'local').item, ...value.draft, id: value.id, revision: 'updated-revision' } as AutomationItem }; } : undefined,
      onDelete: writesEnabled ? async value => { calls.push({ method: 'delete-task', hostId: value.hostId, data: value }); return { success: true, status: 'deleted' }; } : undefined,
      onTrackChange: async (change, operation) => { calls.push({ method: 'track-' + change.kind, hostId: change.hostId, data: change.operationId }); await barrier('track'); return operation(); },
      onReconcileChanges: recovery ? async value => {
        calls.push({ method: 'reconcile', hostId: value.hostId, data: value });
        await barrier('reconcile');
        if (!recovery || recovery.user !== 'user') throw new Error('The original owner could not be verified.');
        return { pending: false, resolved: [{ operationId: recovery.change.operationId, state: recovery.state, change: recovery.change, identity: recovery.identity, ...(recovery.state === 'confirmed' ? { automationId: recovery.automationId } : {}) }] };
      } : undefined,
      onResolveRunSelection: async value => { calls.push({ method: 'resolve-run', hostId: value.hostId }); await barrier('selection'); return { collaborationMode: null, permissions: null }; },
      onRunNow: async value => { calls.push({ method: 'run-now', hostId: value.hostId }); return { operationId: value.operationId, automationId: value.automationId, threadId: 'thread', state: 'started', turnId: 'turn', createdAt: 1, updatedAt: 2 }; },
      renderLandingComposer: value => <output data-testid="task-composer">{JSON.stringify({ hostId: value.hostId, automationId: value.entry.item.id, revision: value.entry.item.revision, confirmation: value.confirmation, navigationSource: value.navigationSource })}</output>,
      onOpenThread: async value => { calls.push({ method: 'open-task-thread', hostId: value.hostId, data: value }); } },
    automationLinks: { shareDialogEnabled: true, canShare: shareAllowed ? { allowed: true } : { allowed: false, reason: 'fixture share denied' }, currentAccountId: runAccountId,
      runAccess: runAccess === undefined ? undefined : runAccess ? { allowed: true } : { allowed: false, reason: 'fixture run access denied' },
      onLoadSharedTask: bridgeFallback ? undefined : async value => {
        calls.push({ method: 'shared-task', hostId: value.hostId, data: value.postId });
        if (value.postId === 'slow') await new Promise<void>(resolve => { detailResolvers.push(resolve); });
        if (sharedFails) { sharedFails = false; throw new Error('fixture shared task rejection'); }
        return { postId: value.postId, isOwner: value.postId === 'owner', sourceAutomationId: value.postId === 'owner' ? 'owned-task' : null, name: 'Shared fixture', prompt: 'Shared prompt', schedule: 'Daily' };
      },
      onLoadShare: bridgeFallback ? undefined : async value => { calls.push({ method: 'share', hostId: value.hostId, data: value.automationId });
        if (shareFails) { shareFails = false; throw new Error('fixture share rejection'); }
        return { automationId: value.automationId, permalink: null }; },
      onOpenRun: async value => { calls.push({ method: 'open-run-thread', hostId: value.hostId, data: value }); },
      onLoadRun: bridgeFallback ? undefined : async value => { calls.push({ method: 'run-detail', hostId: value.hostId, data: { automationId: value.automationId, runId: value.runId } });
        if (runFails) { runFails = false; throw new Error('fixture run rejection'); }
        return { automationId: value.automationId, run: { id: value.runId ?? 'latest-run-id', chatRef: value.automationId === 'without-chat' ? null : { type: runType, id: 'run-thread' }, description: 'Synthetic run' } }; } },
    login: { onAuthenticated: () => { calls.push({ method: 'authenticated', hostId }); } },
    firstRun: { authMethod: 'apiKey', variant: 'apiKey', onContinue: () => { calls.push({ method: 'continue', hostId }); } },
    selectWorkspace: { onComplete: value => { calls.push({ method: 'workspace-complete', hostId: value }); } },
  };
  root.render(<I18nProvider locale={locale}><ProductRoutePage client={client} location={location} locationKey={locationKey} hostId={hostId} accountKey="account" userKey="user" cwd="/work" authorityKey={scope.sessionKey} auth={auth} access={access} pages={pages}
    isCurrent={owner => live && owner.hostId === hostId && owner.accountKey === 'account' && owner.userKey === 'user' && owner.authorityKey === `session-${hostId}-${generation}` && owner.locationKey === locationKey}
    navigate={async (path, options, owner) => {
      calls.push({ method: 'navigate', hostId, data: { path, options } });
      await barrier('navigation');
      if (!navigationAllowed || !live || owner.hostId !== hostId || owner.accountKey !== 'account' || owner.userKey !== 'user' || owner.authorityKey !== `session-${hostId}-${generation}` || owner.locationKey !== locationKey) return false;
      if (options?.delta) return true;
      const url = new URL(path, 'https://yard.invalid');
      location = { pathname: url.pathname, search: url.search, hash: url.hash, state: options?.state ?? null };
      hostId = url.searchParams.get('hostId') ?? url.searchParams.get('host') ?? 'local';
      locationKey++;
      render(); return true;
    }}
    renderUnresolved={(route, reason) => <output data-testid="unresolved">{JSON.stringify({ reason, route })}</output>} /></I18nProvider>);
}

window.productRouteHarness = {
  calls,
  show(url, host, state = null) { const parsed = new URL(url, 'https://yard.invalid'); hostId = host; location = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash, state }; locationKey++; render(); },
  showFromUrl(url, state = null) { const parsed = new URL(url, 'https://yard.invalid'); hostId = parsed.searchParams.get('hostId') ?? parsed.searchParams.get('host') ?? 'local'; location = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash, state }; locationKey++; render(); },
  currentHost() { return hostId; },
  currentLocation() { return location; },
  resolveOld() { oldResolve?.(); },
  setGeneration(value) { generation = value; render(); },
  setAuth(value) { auth = value === 'ready' ? { state: 'ready' } : { state: 'required', onAuthenticated() { calls.push({ method: 'authenticated', hostId }); } }; render(); },
  setAccess(value) { access = value === 'legacy' ? { state: 'legacy' } : value === 'app' ? { state: 'app' } : { state: 'allow', scheduledTasks: 'allowed', scheduledRedirect: value === 'scheduled', managePlugins: 'skills', legacyProject: legacyProject === 'loading' ? { state: 'loading' } : { state: 'ready', featureEnabled: legacyProject === 'enabled' }, cloudScheduledTasks: value === 'shared' ? 'allowed' : value === 'denied' ? 'denied' : undefined }; render(); },
  setNavigationAllowed(value) { navigationAllowed = value; },
  setAutomationMode(value) { automationMode = value; editor = null; render(); },
  setShareAllowed(value) { shareAllowed = value; render(); },
  setBridgeFallback(value) { bridgeFallback = value; render(); },
  setRunAccountId(value) { runAccountId = value; render(); },
  setRunAccess(value) { runAccess = value; render(); },
  setRouteProof(value) {
    routeProof = value;
    editor = value === 'draft' || value === 'draft-mismatch' || value === 'template' ? { scope: { hostId, accountKey: 'account', installationKey: null, sessionKey: `session-${hostId}-${generation}` }, draftId: value === 'draft' ? 'oauth-draft' : value === 'draft-mismatch' ? 'older-draft' : 'template-draft', draftRevision: 'draft-revision', mode: 'create', sourceKey: 'local', source: 'local', teamId: null, id: null, revision: null, createRequestId: 'restored', pendingOperationId: null,
      draft: { ...newDraft(), name: value === 'draft' ? 'Restored draft' : value === 'draft-mismatch' ? 'Earlier draft' : 'Restored template', prompt: 'Preserved prompt' } } : null;
    render();
  },
  setLegacyProject(value) { legacyProject = value; if (access.state === 'allow') access = { ...access, legacyProject: value === 'loading' ? { state: 'loading' } : { state: 'ready', featureEnabled: value === 'enabled' } }; render(); },
  setLocale(value) { locale = value; render(); },
  hold(value) { holding = value; },
  release() { releaseBarrier?.(); releaseBarrier = null; },
  revokeWithoutRender() { live = false; },
  replaceDraft() { if (editor) { editor = { ...editor, draftId: 'newer-draft', draftRevision: 'newer-revision', pendingOperationId: null, draft: { ...editor.draft, prompt: 'Newer draft' } }; render(); } },
  editorSnapshot() { return editor; },
  reload() { locationKey++; render(); },
  setRunType(value) { runType = value; },
  enableWrites() { writesEnabled = true; render(); },
  setDraftProof(field) { draftProof = field; render(); },
  resolveDetail() { detailResolvers.shift()?.(); },
  seedRecovery(kind, variant) {
    recoverySettled = false;
    const originalScope = { hostId, accountKey: 'account', installationKey: null, sessionKey: `session-${hostId}-${generation}` };
    const operationId = '11111111-1111-4111-8111-111111111111', draft = { ...newDraft(), prompt: 'Original preserved draft' };
    const origin = structuredClone(location), route = { origin, source: 'local' as const, teamId: null };
    editor = kind === 'delete' ? null : { scope: originalScope, draftId: 'original-draft', draftRevision: 'original-revision', mode: kind === 'create' ? 'create' : 'edit',
      sourceKey: 'local', source: 'local', teamId: null, id: kind === 'create' ? null : 'first', revision: kind === 'create' ? null : 'revision-1',
      createRequestId: 'original-editor', pendingOperationId: operationId, draft };
    const change: AutomationChange = kind === 'create' ? { ...originalScope, route, kind, operationId, sourceKey: 'local', draft } :
      kind === 'update' ? { ...originalScope, route, kind, operationId, sourceKey: 'local', id: 'first', revision: 'revision-1', draft } :
        { ...originalScope, route, kind, operationId, sourceKey: 'local', id: 'first', revision: 'revision-1' };
    const changed = variant === 'wrong-host' ? { ...change, hostId: 'other' } : variant === 'wrong-account' ? { ...change, accountKey: 'other' } :
      variant === 'wrong-installation' ? { ...change, installationKey: 'other' } : change;
    const identity = editor ? draftIdentity(editor) : variant === 'wrong-identity' ? { ...originalScope, draftId: 'unrelated', draftRevision: 'unrelated-revision',
      mode: 'edit' as const, sourceKey: 'local', source: 'local' as const, teamId: null, taskId: 'first', taskRevision: 'revision-1' } : null;
    recovery = { change: changed, identity: variant === 'wrong-identity' && identity ? { ...identity, sessionKey: 'other' } : identity, state: variant === 'not-sent' ? 'not-sent' : 'confirmed',
      automationId: variant === 'wrong-id' ? 'another-task' : variant === 'server-id' ? 'original-server-id' : kind === 'create' ? operationId : 'first', user: variant === 'wrong-user' ? 'other-user' : 'user' };
    generation++; render();
  },
  setSnapshotlessSave(value, automationId, matchesRequestId = true) { snapshotlessSave = value; snapshotlessId = automationId; idMatchesRequestId = matchesRequestId; render(); },
};
render();
