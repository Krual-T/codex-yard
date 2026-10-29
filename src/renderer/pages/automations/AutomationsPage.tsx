import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { translateKnown, useI18n } from '../../i18n/index.tsx';
import type { AutomationChange, AutomationDraft, AutomationDraftIdentity, AutomationEditorDraft, AutomationEntry, AutomationItem, AutomationList, AutomationReceipt, AutomationReconciliation, AutomationRouteCompletion, AutomationRun, AutomationScope, Capability, Choices, HeartbeatSelection, ModelOption, ProjectOption, ScheduleCodec, ThreadOption } from './model.ts';
import { draftFromItem, draftIdentity, entryKey, errorMessage, newDraft, sameDraftIdentity } from './model.ts';
import { AutomationEditor } from './AutomationEditor.tsx';
import './automations.css';

export interface AutomationsPageProps extends AutomationScope {
  route?: { automationId: string | null; automationSource: string | null; automationMode: string | null; automationTeamId: string | null;
    automationDraftId: string | null; automationEditing: boolean; templateCandidate: boolean; landing: boolean; navigationError: string;
    origin: AutomationRouteCompletion['origin']; onBack(): void; onCancelEditor(): void; onUnavailable(): void; onSelect(entry: AutomationEntry): void;
    onCreate(): void; onConfirmed(completion: AutomationRouteCompletion): Promise<boolean> };
  routeCreateTeam?: { teamId: string; sourceKey: string };
  routeDraft?: { id: string; state: 'loading' } | { id: string; state: 'ready'; identity: AutomationDraftIdentity } | { id: string; state: 'error'; message: string; retry(): void | Promise<void> };
  routeTemplate?: { state: 'loading' | 'ready' | 'ignored' } | { state: 'error'; message: string; retry(): void | Promise<void> };
  hasUnresolvedChanges: boolean;
  editor: AutomationEditorDraft | null;
  /** Synchronous compare-and-set of the controlled draft; each change receives a new revision. */
  onEditorChange?: (scope: AutomationScope, expected: AutomationDraftIdentity | null, editor: AutomationEditorDraft | null) => boolean;
  /** Atomically persist the exact editor and operation before acknowledging preparation. */
  onPrepareEditor?: (request: { scope: AutomationScope; identity: AutomationDraftIdentity; editor: AutomationEditorDraft; operationId: string; change: AutomationChange }) => Promise<'prepared' | 'changed'>;
  isCurrent(scope: AutomationScope): boolean;
  isCurrentEditor?: (identity: AutomationDraftIdentity, operationId: string) => boolean;
  /** Atomically settle the original operation, conditionally clear its draft and persist any navigation. */
  onFinalizeChange?: (request: { scope: AutomationScope; change: AutomationChange; identity: AutomationDraftIdentity | null; outcome: Exclude<AutomationReceipt, { state: 'unknown' }> | { state: 'not-sent' }; completion: AutomationRouteCompletion | null }) => Promise<'applied' | 'changed'>;
  pendingNavigation?: AutomationRouteCompletion | null;
  /** Live controller check of the exact owner and original location, including navigation state. */
  isCurrentCompletion?: (completion: AutomationRouteCompletion, scope: AutomationScope) => boolean;
  onAcknowledgeNavigation?: (scope: AutomationScope, operationId: string) => void | Promise<void>;
  renderLandingComposer?: (request: AutomationScope & { entry: AutomationEntry; confirmation: string; navigationSource: 'scheduled_page' }) => ReactNode;
  create: { sourceKey: string; location: 'local' | 'cloud' | 'team'; teamId?: string | null; capability: Capability; allowedStatuses: ('ACTIVE' | 'PAUSED')[]; allowUnvalidatedPaused: boolean; idMatchesRequestId: boolean };
  projects: Choices<ProjectOption>;
  threads: Choices<ThreadOption>;
  models: Choices<ModelOption>;
  scheduleCodec?: ScheduleCodec;
  refreshKey?: string | number;
  onLoad?: (request: AutomationScope & { signal: AbortSignal }) => Promise<AutomationList>;
  onLoadDetail?: (request: AutomationScope & { automationId: string; source: 'local' | 'cloud'; teamId: string | null; signal: AbortSignal }) => Promise<AutomationEntry>;
  onLoadMore?: (request: AutomationScope & { cursor: string; signal: AbortSignal }) => Promise<AutomationList>;
  onRetryChoices?: (request: AutomationScope & { kind: 'projects' | 'threads' | 'models' }) => Promise<void> | void;
  onCreate?: (request: AutomationScope & { requestId: string; sourceKey: string; draft: AutomationDraft }) => Promise<{ item: AutomationItem; automationId?: string } | { automationId: string; item?: AutomationItem }>;
  onUpdate?: (request: AutomationScope & { operationId: string; sourceKey: string; id: string; revision: string; draft: AutomationDraft }) => Promise<{ item: AutomationItem; automationId?: string } | { automationId: string; item?: AutomationItem }>;
  onDelete?: (request: AutomationScope & { operationId: string; sourceKey: string; id: string; revision: string }) => Promise<{ success: boolean; status: string; item?: AutomationItem }>;
  onResolveRunSelection?: (request: AutomationScope & { entry: AutomationEntry }) => Promise<HeartbeatSelection>;
  onRunNow?: (request: AutomationScope & { operationId: string; automationId: string; revision: string; sourceKey: string; selection: HeartbeatSelection }) => Promise<AutomationRun>;
  onTrackChange?: (change: AutomationChange, operation: () => Promise<AutomationReceipt>) => Promise<AutomationReceipt>;
  onReconcileChanges?: (scope: AutomationScope) => Promise<AutomationReconciliation>;
  onOpenThread?: (request: AutomationScope & { threadId: string; replace?: true; state?: { sidebarArea: 'scheduled'; sidebarAutomationId: string; sidebarAutomationSource: 'local' } }) => void | Promise<void>;
}

const unavailable = (capability: Capability) => capability.allowed ? null : capability.reason;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function eventConfirmation(triggers: unknown[], locale: string, text: (value: string) => string): string {
  const trigger = triggers.length === 1 ? object(triggers[0]) : {};
  const params = object(trigger.params), presentation = object(trigger.presentation);
  const rows = Array.isArray(presentation.condition_rows) ? presentation.condition_rows.map(object) : [];
  const row = (id: string) => { const value = rows.find(item => item.id === id)?.value; return typeof value === 'string' ? value.trim() : ''; };
  const format = (value: string, fields: Record<string, string>) => text(value).replace(/\{([^{}]+)\}/g, (match, key: string) => fields[key] ?? match);
  if (trigger.webhook_name === 'message' && trigger.connector_type === 'gmail') return text('Your task is ready. I’ll run it when new email matching your filters arrives in Gmail.');
  if (trigger.webhook_name === 'message' && trigger.connector_type === 'slack') {
    const channels = row('channels'), event = row('event');
    if (channels && event) return format('Your task is ready. I’ll run it for {event} in {channels} on Slack.', { channels, event: event.toLocaleLowerCase(locale) });
    const names = params.channel_names, ids = params.channel_ids, replies = params.include_thread_replies;
    if (Array.isArray(names) && names.length && names.every(value => typeof value === 'string' && value.trim()) &&
      Array.isArray(ids) && ids.length === names.length && ids.every(value => typeof value === 'string') && (replies === undefined || typeof replies === 'boolean')) {
      const formatted = new Intl.ListFormat(locale, { type: 'conjunction' }).format(names.map(value => { const name = value.trim(); return name.startsWith('#') ? name : `#${name}`; }));
      return format(replies === false ? 'Your task is ready. I’ll run it when new messages matching your filters arrive in {channels} on Slack.' :
        'Your task is ready. I’ll run it when new messages or thread replies matching your filters arrive in {channels} on Slack.', { channels: formatted });
    }
  }
  if (trigger.webhook_name === 'pull_request' && trigger.connector_type === 'github') {
    const presented = row('repository');
    if (presented && !Object.keys(params).length) return format('Your task is ready. I’ll monitor {repository} on GitHub and run it when a pull request event matches your trigger settings.', { repository: presented });
    const repository = params.repository, merged = params.only_on_merge, author = params.author_login;
    if (typeof repository === 'string' && repository.trim() && (merged === undefined || typeof merged === 'boolean')) {
      const authorName = typeof author === 'string' ? author.trim() : '';
      const message = merged ? authorName ? 'Your task is ready. I’ll run it when pull requests by {author} matching your filters are merged in {repository} on GitHub.' :
        'Your task is ready. I’ll run it when pull requests matching your filters are merged in {repository} on GitHub.' :
        authorName ? 'Your task is ready. I’ll run it when pull request events for pull requests by {author} in {repository} on GitHub match your filters.' :
          'Your task is ready. I’ll run it when pull request events in {repository} on GitHub match your filters.';
      return format(message, { repository: repository.trim(), author: authorName });
    }
  }
  return text('Your task is ready. I’ll run it when its trigger fires.');
}

const isItem = (item: AutomationItem | undefined): item is AutomationItem => {
  if (!item || typeof item.id !== 'string' || !item.id || typeof item.revision !== 'string' || !item.revision ||
    typeof item.name !== 'string' || typeof item.prompt !== 'string' || typeof item.rrule !== 'string' ||
    !['ACTIVE', 'PAUSED', 'DELETED'].includes(item.status) || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt) ||
    ![item.nextRunAt, item.nextRunNominalAt, item.lastRunAt].every(time => time === null || typeof time === 'number' && Number.isFinite(time)) ||
    !(item.model === null || typeof item.model === 'string') ||
    !(item.reasoningEffort === null || ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(item.reasoningEffort)) ||
    !(item.notificationPolicy === null || item.notificationPolicy === 'failed_runs_only')) return false;
  if (item.kind === 'heartbeat') return typeof item.targetThreadId === 'string' && !!item.targetThreadId;
  if (item.kind !== 'cron' || !Array.isArray(item.cwds) || !item.cwds.every(cwd => typeof cwd === 'string') ||
    !['local', 'worktree'].includes(item.executionEnvironment) || typeof item.autoArchive !== 'boolean' ||
    !(item.localEnvironmentConfigPath === null || typeof item.localEnvironmentConfigPath === 'string') ||
    !(item.pluginTemplateId === null || typeof item.pluginTemplateId === 'string')) return false;
  return item.target === null || typeof item.target === 'object' &&
    (item.target.type === 'projectless' || item.target.type === 'project' && typeof item.target.projectId === 'string' && !!item.target.projectId);
};
const isCapability = (value: Capability) => value && (value.allowed === true || value.allowed === false && typeof value.reason === 'string');

function confirmedTaskId(change: Exclude<AutomationChange, { kind: 'run' }>, receipt: Extract<AutomationReceipt, { state: 'confirmed' }>, idMatchesRequestId: boolean): string {
  if (receipt.automationId !== undefined && (typeof receipt.automationId !== 'string' || !receipt.automationId)) throw new Error('The saved task identity could not be verified.');
  if (receipt.item !== undefined && !isItem(receipt.item)) throw new Error('The saved task could not be verified.');
  const id = receipt.automationId ?? receipt.item?.id ?? (change.kind === 'delete' ? change.id : null);
  if (!id || receipt.item && receipt.item.id !== id || change.kind !== 'create' && id !== change.id ||
    change.kind === 'create' && idMatchesRequestId && id !== change.operationId) throw new Error('The saved task identity could not be verified.');
  return id;
}

function checkedList(value: AutomationList): AutomationList {
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.sources) || typeof value.complete !== 'boolean' ||
    !(value.nextCursor === undefined || value.nextCursor === null || typeof value.nextCursor === 'string' && !!value.nextCursor) ||
    value.complete && !!value.nextCursor) throw new Error('Invalid scheduled task list.');
  const seen = new Set<string>();
  for (const entry of value.items) {
    const item = entry?.item;
    if (!entry || !isItem(item) || typeof entry.sourceKey !== 'string' || !entry.sourceKey ||
      !['local', 'cloud', 'team'].includes(entry.location) || !(entry.teamId === undefined || entry.teamId === null || typeof entry.teamId === 'string') || !['known', 'unknown'].includes(entry.timing) ||
      entry.cloudLanding !== undefined && (!entry.cloudLanding || entry.location === 'local' || typeof entry.cloudLanding.timing_mode !== 'string' || !(entry.cloudLanding.default_timezone === null || typeof entry.cloudLanding.default_timezone === 'string') || !(entry.cloudLanding.webhook_triggers === null || Array.isArray(entry.cloudLanding.webhook_triggers))) ||
      !isCapability(entry.edit) || !isCapability(entry.delete) || !isCapability(entry.run) || !Array.isArray(entry.allowedStatuses) ||
      entry.allowedStatuses.some(status => status !== 'ACTIVE' && status !== 'PAUSED') || typeof entry.allowUnvalidatedPaused !== 'boolean') throw new Error('Invalid scheduled task entry.');
    const key = entryKey(entry);
    if (seen.has(key)) throw new Error('Duplicate scheduled task identity.');
    seen.add(key);
  }
  for (const source of value.sources) if (!source || typeof source.key !== 'string' || typeof source.label !== 'string' || !['ready', 'partial', 'unavailable', 'error'].includes(source.state) ||
    (source.message !== undefined && typeof source.message !== 'string') || (source.diagnostics !== undefined && (!Array.isArray(source.diagnostics) || source.diagnostics.some(item => !item || typeof item.id !== 'string' || typeof item.message !== 'string')))) throw new Error('Invalid scheduled task source.');
  return value;
}

export function AutomationsPage(props: AutomationsPageProps) {
  return <AutomationsScope key={JSON.stringify([props.hostId, props.accountKey, props.installationKey, props.sessionKey])} {...props} />;
}

function AutomationsScope(props: AutomationsPageProps) {
  const { t, locale, formatDate } = useI18n();
  const text = (value: string) => translateKnown(t, value);
  const { hostId, accountKey, installationKey, sessionKey, editor, onEditorChange, hasUnresolvedChanges } = props;
  const scope: AutomationScope = { hostId, accountKey, installationKey, sessionKey };
  const [list, setList] = useState<AutomationList | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => editor?.id ? JSON.stringify([editor.sourceKey, editor.id]) : null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [routeDetail, setRouteDetail] = useState<AutomationEntry | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNotFound, setDetailNotFound] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null | undefined>(undefined);
  const discardIdentity = useRef<AutomationDraftIdentity | null>(null);
  const matchesCompletion = (value: AutomationRouteCompletion | null | undefined) => {
    try { return !!value && !!props.route && value.hostId === hostId && value.accountKey === accountKey && value.installationKey === installationKey &&
      value.origin.pathname === props.route.origin.pathname && value.origin.search === props.route.origin.search && value.origin.hash === props.route.origin.hash && props.isCurrentCompletion?.(value, scope) === true; }
    catch { return false; }
  };
  const [pendingNavigation, setPendingNavigation] = useState<AutomationRouteCompletion | null>(() => matchesCompletion(props.pendingNavigation) ? props.pendingNavigation! : null);
  const alive = useRef(false), inFlight = useRef(false), loadRef = useRef(props.onLoad), detailLoadRef = useRef(props.onLoadDetail), moreController = useRef<AbortController | null>(null);
  const moreBusy = useRef(false), seenCursors = useRef(new Set<string>()), pendingChanges = useRef(new Map<string, AutomationChange>());
  const navigationInFlight = useRef(false), recoveryStarted = useRef<string | null>(null);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; moreController.current?.abort(); }; }, []);
  useLayoutEffect(() => { loadRef.current = props.onLoad; }, [props.onLoad]);
  useLayoutEffect(() => { detailLoadRef.current = props.onLoadDetail; }, [props.onLoadDetail]);
  const current = () => { try { return alive.current && props.isCurrent(scope) === true; } catch { return false; } };
  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort(); moreController.current = null; moreBusy.current = false; seenCursors.current.clear();
    setLoadingMore(false); setMoreError(null);
    setLoading(true); setLoadError(null);
    if (props.route?.landing && props.route.automationId === null && props.route.automationMode !== 'create' && !props.route.templateCandidate) {
      setLoading(false); return () => controller.abort();
    }
    const load = loadRef.current;
    if (!load) { setLoading(false); setLoadError('Scheduled task sources are unavailable.'); return () => controller.abort(); }
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('The selected host changed.', 'AbortError');
      return load({ hostId, accountKey, installationKey, sessionKey, signal: controller.signal });
    }).then(checkedList).then(result => {
      if (!controller.signal.aborted) { setList(result); setRefreshRequired(false); }
    }).catch(cause => { if (!controller.signal.aborted) setLoadError(`Could not load scheduled tasks: ${errorMessage(cause)}`); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [hostId, accountKey, installationKey, sessionKey, revision, props.refreshKey, !!props.onLoad, props.route?.landing, props.route?.automationId, props.route?.automationMode, props.route?.templateCandidate]);

  useEffect(() => {
    const controller = new AbortController();
    const automationId = props.route?.automationId;
    const load = detailLoadRef.current;
    setRouteDetail(null); setDetailError(null); setDetailLoading(false); setDetailNotFound(false);
    if (automationId === null || automationId === undefined || !load || props.route?.automationMode === 'create') return () => controller.abort();
    const source = props.route?.automationSource === 'cloud' ? 'cloud' : 'local';
    const teamId = props.route?.automationTeamId ?? null;
    setDetailLoading(true);
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('The selected host changed.', 'AbortError');
      return load({ ...scope, automationId, source, teamId, signal: controller.signal });
    }).then(value => {
      const entry = checkedList({ items: [value], sources: [], complete: true }).items[0]!;
      if (entry.item.id !== automationId || (entry.location === 'local' ? 'local' : 'cloud') !== source) throw new Error('The task does not match this route.');
      if (teamId !== null && (entry.location !== 'team' || entry.teamId !== teamId)) throw new Error('The task does not match this team.');
      if (!controller.signal.aborted) setRouteDetail(entry);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (source === 'cloud' && cause && typeof cause === 'object' && 'code' in cause && cause.code === 'UPSTREAM_ERROR' && 'status' in cause && (cause.status === 404 || cause.status === 410)) setDetailNotFound(true);
      else setDetailError(`Could not load this task: ${errorMessage(cause)}`);
    })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [hostId, accountKey, installationKey, sessionKey, props.route?.automationId, props.route?.automationSource, props.route?.automationMode, props.route?.automationTeamId, !!props.onLoadDetail, revision, detailRevision]);

  const selected = list?.items.find(entry => entryKey(entry) === selectedKey) ?? null;
  const routeMatches = props.route?.automationId !== null && props.route?.automationId !== undefined
    ? list?.items.filter(entry => entry.item.id === props.route!.automationId && (entry.location === 'local' ? 'local' : 'cloud') === (props.route!.automationSource === 'cloud' ? 'cloud' : 'local') &&
      (props.route!.automationTeamId === null || entry.location === 'team' && entry.teamId === props.route!.automationTeamId)) ?? [] : [];
  const hasRouteSelection = props.route?.automationId !== null && props.route?.automationId !== undefined;
  const activeSelection = hasRouteSelection ? routeDetail ?? (!props.onLoadDetail && routeMatches.length === 1 ? routeMatches[0]! : null) : selected;
  const missingLandingTask = !!props.route?.landing && hasRouteSelection && !detailLoading && !detailError &&
    (detailNotFound || props.route.automationSource !== 'cloud' && !props.onLoadDetail && !loading && !loadError && !!list?.complete && routeMatches.length === 0);
  useEffect(() => { if (missingLandingTask && current()) props.route?.onUnavailable(); }, [missingLandingTask]);
  const editorEntry = editor?.mode === 'edit' ? (routeDetail?.sourceKey === editor.sourceKey && routeDetail.item.id === editor.id ? routeDetail : null) ??
    list?.items.find(entry => entry.sourceKey === editor.sourceKey && entry.item.id === editor.id) ?? null : null;
  const routeDraftId = props.route?.automationDraftId ?? null;
  const editorScopeMatches = !editor || editor.scope.hostId === hostId && editor.scope.accountKey === accountKey && editor.scope.installationKey === installationKey && editor.scope.sessionKey === sessionKey;
  const draftBlocked = routeDraftId !== null && (props.routeDraft?.id !== routeDraftId || props.routeDraft.state !== 'ready' || !editor ||
    editor.draftId !== routeDraftId || !sameDraftIdentity(props.routeDraft.identity, draftIdentity(editor)));
  const editorRouteMismatch = !!editor && (!editorScopeMatches || !!props.route && (
    props.route.automationMode === 'create' && editor.mode !== 'create' ||
    props.route.automationEditing && editor.mode !== 'edit' ||
    props.route.automationMode === 'create' && (editor.sourceKey !== props.create.sourceKey || editor.source !== (props.create.location === 'local' ? 'local' : 'cloud') || editor.teamId !== (props.create.location === 'team' ? props.create.teamId ?? null : null)) ||
    props.route.automationId !== null && (editor.mode !== 'edit' || editor.id !== props.route.automationId ||
      editor.source !== (props.route.automationSource === 'cloud' ? 'cloud' : 'local') || editor.teamId !== props.route.automationTeamId)));
  const routeTeamId = props.route?.automationMode === 'create' ? props.route.automationTeamId : null;
  const teamBlocked = routeTeamId !== null && (props.routeCreateTeam?.teamId !== routeTeamId || props.routeCreateTeam.sourceKey !== props.create.sourceKey);
  const templateBlocked = !!props.route?.templateCandidate && props.routeTemplate?.state !== 'ignored' && (props.routeTemplate?.state !== 'ready' || editor?.mode !== 'create');
  const routeEditorBlocked = draftBlocked || teamBlocked || templateBlocked || editorRouteMismatch;
  const needsCheck = uncertain || hasUnresolvedChanges || !!editor?.pendingOperationId;
  const persistenceUnavailable = !props.onPrepareEditor || !props.isCurrentEditor || !props.onFinalizeChange || !!props.route && (!props.isCurrentCompletion || !props.onAcknowledgeNavigation);
  const unavailableActions = busy || needsCheck || !!pendingNavigation || loading || loadingMore || refreshRequired || !!loadError || !props.onTrackChange || routeEditorBlocked;
  const refresh = () => { moreController.current?.abort(); moreController.current = null; moreBusy.current = false; setLoadingMore(false); setMoreError(null); setRefreshRequired(true); setRevision(value => value + 1); };
  const completionFor = (change: AutomationChange, receipt: Extract<AutomationReceipt, { state: 'confirmed' }>): AutomationRouteCompletion | null => {
    if (!change.route || change.kind === 'run') return null;
    const automationId = confirmedTaskId(change, receipt, false);
    return { hostId: change.hostId, accountKey: change.accountKey, installationKey: change.installationKey, sessionKey: change.sessionKey,
      operationId: change.operationId, kind: change.kind === 'delete' ? 'delete' : 'save', automationId,
      source: change.route.source, teamId: change.route.teamId, origin: structuredClone(change.route.origin) };
  };
  const routeFor = (source: 'local' | 'cloud', teamId: string | null) => props.route ? { origin: structuredClone(props.route.origin), source, teamId } : null;
  const deliverNavigation = async (completion: AutomationRouteCompletion) => {
    if (!props.route || !current() || !matchesCompletion(completion) || navigationInFlight.current) return;
    if (!props.onAcknowledgeNavigation) { setActionError(text('The confirmed navigation cannot be acknowledged.')); return; }
    navigationInFlight.current = true;
    recoveryStarted.current = completion.operationId;
    setPendingNavigation(completion);
    try {
      if (!await props.route.onConfirmed(completion)) throw new Error('Navigation was not completed.');
      await props.onAcknowledgeNavigation(scope, completion.operationId);
      if (alive.current) setPendingNavigation(null);
    } catch (cause) { if (current()) setActionError(errorMessage(cause)); }
    finally { navigationInFlight.current = false; }
  };
  useEffect(() => {
    const value = props.pendingNavigation, origin = props.route?.origin;
    if (!value || !origin || !matchesCompletion(value) || recoveryStarted.current === value.operationId) return;
    recoveryStarted.current = value.operationId;
    void deliverNavigation(value);
  }, [props.pendingNavigation, props.route?.origin.pathname, props.route?.origin.search, props.route?.origin.hash]);
  const loadMore = async () => {
    const cursor = list?.nextCursor;
    if (!cursor || !list || !props.onLoadMore || moreBusy.current || loading || busy) return;
    const controller = new AbortController(); moreController.current = controller; moreBusy.current = true; setLoadingMore(true); setMoreError(null);
    try {
      const next = checkedList(await props.onLoadMore({ ...scope, cursor, signal: controller.signal }));
      if (controller.signal.aborted || !alive.current) return;
      if (next.nextCursor && (next.nextCursor === cursor || seenCursors.current.has(next.nextCursor))) throw new Error('Scheduled task pagination did not advance.');
      const items = new Map(list.items.map(entry => [entryKey(entry), entry]));
      for (const entry of next.items) {
        const previous = items.get(entryKey(entry));
        if (previous && previous.item.revision !== entry.item.revision) throw new Error('A scheduled task changed between pages. Refresh the list.');
        items.set(entryKey(entry), entry);
      }
      const sources = new Map(list.sources.map(source => [source.key, source]));
      for (const source of next.sources) sources.set(source.key, source);
      seenCursors.current.add(cursor);
      setList({ items: [...items.values()], sources: [...sources.values()], complete: next.complete, nextCursor: next.nextCursor ?? null });
    } catch (cause) { if (!controller.signal.aborted && alive.current) setMoreError(`Could not load more scheduled tasks: ${errorMessage(cause)}`); }
    finally { if (moreController.current === controller) { moreController.current = null; moreBusy.current = false; if (alive.current) setLoadingMore(false); } }
  };
  const setEditor = (next: AutomationEditorDraft | null): boolean => {
    if (!onEditorChange || !current()) return false;
    const expected = editor ? draftIdentity(editor) : null;
    const revised = next ? { ...next, scope: { ...scope }, draftRevision: crypto.randomUUID() } : null;
    try {
      if (!onEditorChange(scope, expected, revised)) throw new Error('The draft changed before it could be preserved.');
      return true;
    }
    catch (cause) { setActionError(`${text('Could not preserve the draft:')} ${errorMessage(cause)}`); return false; }
  };
  const requestDiscard = (selection: string | null | undefined) => {
    if (!editor || routeEditorBlocked) return;
    discardIdentity.current = draftIdentity(editor);
    setPendingSelection(selection); setConfirm('discard');
  };
  const discardCurrentEditor = () => {
    const expected = discardIdentity.current;
    if (!editor || !expected || routeEditorBlocked || !sameDraftIdentity(expected, draftIdentity(editor))) {
      discardIdentity.current = null; setConfirm(null); setPendingSelection(undefined);
      if (routeEditorBlocked && props.route) props.route.onCancelEditor();
      else setActionError(text('The draft changed. Review it before discarding.'));
      return false;
    }
    if (!setEditor(null)) return false;
    discardIdentity.current = null;
    return true;
  };
  const choose = (key: string | null) => {
    if (editor && (busy || needsCheck)) return;
    if (editor && !routeEditorBlocked) { requestDiscard(key); return; }
    if (key && props.route) {
      const entry = list?.items.find(item => entryKey(item) === key);
      if (entry?.location === 'team' && !entry.teamId) setActionError(text('The selected task has no verified team identity.'));
      else if (entry) props.route.onSelect(entry);
    } else if (props.route?.automationId !== null && props.route?.automationId !== undefined) props.route.onBack();
    else setSelectedKey(key);
  };
  const openCreate = (fromRoute = false) => {
    if (!onEditorChange || busy || needsCheck || routeEditorBlocked || !props.create.capability.allowed || (!fromRoute && (unavailableActions || !props.onCreate))) return false;
    setSelectedKey(null); setActionError(null); setNotice(null);
    return setEditor({ scope, draftId: crypto.randomUUID(), draftRevision: crypto.randomUUID(), mode: 'create', sourceKey: props.create.sourceKey, source: props.create.location === 'local' ? 'local' : 'cloud', teamId: props.create.location === 'team' ? props.create.teamId ?? null : null, id: null, revision: null, createRequestId: crypto.randomUUID(), pendingOperationId: null, draft: newDraft() });
  };
  const openEdit = (entry: AutomationEntry, fromRoute = false) => {
    if (!onEditorChange || busy || needsCheck || routeEditorBlocked || !entry.edit.allowed || (!fromRoute && (unavailableActions || !props.onUpdate))) return false;
    setActionError(null); setNotice(null);
    return setEditor({ scope, draftId: crypto.randomUUID(), draftRevision: crypto.randomUUID(), mode: 'edit', sourceKey: entry.sourceKey, source: entry.location === 'local' ? 'local' : 'cloud', teamId: entry.location === 'team' ? entry.teamId ?? null : null, id: entry.item.id, revision: entry.item.revision, createRequestId: crypto.randomUUID(), pendingOperationId: null, draft: draftFromItem(entry.item) });
  };
  const routeEditorOpened = useRef(false);
  useEffect(() => {
    if (routeEditorOpened.current || editor || busy || needsCheck || pendingNavigation || matchesCompletion(props.pendingNavigation) || routeEditorBlocked || !onEditorChange) return;
    if (props.route?.automationMode === 'create' && props.create.capability.allowed) {
      routeEditorOpened.current = openCreate(true);
    } else if (props.route?.automationEditing && (list?.complete || routeDetail) && activeSelection?.edit.allowed) {
      routeEditorOpened.current = openEdit(activeSelection, true);
    }
  }, [props.route?.automationMode, props.route?.automationEditing, routeEditorBlocked, activeSelection, routeDetail, list?.complete, editor, busy, needsCheck, onEditorChange, props.create.capability.allowed]);
  const reconcile = async () => {
    if (!props.onReconcileChanges || inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError(null);
    try {
      const result = await props.onReconcileChanges(scope);
      if (!current()) return;
      if (!result || typeof result.pending !== 'boolean' || !Array.isArray(result.resolved)) throw new Error('Invalid reconciliation result.');
      if (result.resolved.some(value => !value || typeof value.operationId !== 'string' || !value.operationId || !['confirmed', 'rejected', 'not-sent'].includes(value.state)) ||
        new Set(result.resolved.map(value => value.operationId)).size !== result.resolved.length) throw new Error('Invalid reconciliation result.');
      const remaining = new Map(pendingChanges.current);
      for (const resolved of result.resolved) {
        const change = remaining.get(resolved.operationId) ?? resolved.change;
        if (change && (change.operationId !== resolved.operationId || change.hostId !== hostId || change.accountKey !== accountKey || change.installationKey !== installationKey)) throw new Error('The operation does not match this account.');
        if (change?.kind === 'run' && resolved.state === 'confirmed' &&
          (!resolved.run || resolved.run.operationId !== change.operationId || resolved.run.automationId !== change.id ||
            change.targetThreadId !== null && resolved.run.threadId !== change.targetThreadId || resolved.run.state !== 'started' || !resolved.run.turnId)) {
          throw new Error('The run could not be verified.');
        }
        if (change && change.kind !== 'run') {
          if (!props.onFinalizeChange) throw new Error('The original operation cannot be settled.');
          if (change.kind === 'delete' && resolved.identity != null) throw new Error('The original operation does not have a draft.');
          const identity = change.kind === 'delete' ? null : resolved.identity ?? (editor?.pendingOperationId === change.operationId ? draftIdentity(editor) : null);
          if (change.kind !== 'delete' && (!identity || identity.hostId !== change.hostId || identity.accountKey !== change.accountKey || identity.installationKey !== change.installationKey || identity.sessionKey !== change.sessionKey ||
            identity.mode !== (change.kind === 'create' ? 'create' : 'edit') || identity.sourceKey !== change.sourceKey || change.route && (identity.source !== change.route.source || identity.teamId !== change.route.teamId) ||
            identity.taskId !== (change.kind === 'update' ? change.id : null) || identity.taskRevision !== (change.kind === 'update' ? change.revision : null))) throw new Error('The original draft is not available for confirmation.');
          let outcome: Exclude<AutomationReceipt, { state: 'unknown' }> | { state: 'not-sent' } = resolved.state === 'confirmed'
            ? { state: 'confirmed', automationId: resolved.automationId, item: resolved.item, run: resolved.run } : resolved.state === 'not-sent'
              ? { state: 'not-sent' } : { state: 'rejected', message: 'The change was rejected.' };
          if (outcome.state === 'confirmed') outcome = { ...outcome, automationId: confirmedTaskId(change, outcome, false) };
          const completion = outcome.state === 'confirmed' ? completionFor(change, outcome) : null;
          if (!current()) return;
          const settled = await props.onFinalizeChange({ scope, change, identity, outcome, completion });
          if (!current()) return;
          if (settled !== 'applied') { remaining.set(change.operationId, change); continue; }
          if (completion) await deliverNavigation(completion);
        } else if (!change && editor?.pendingOperationId === resolved.operationId) throw new Error('The original operation is not available for confirmation.');
        remaining.delete(resolved.operationId);
      }
      pendingChanges.current = remaining;
      if (!result.pending && !remaining.size && (!editor?.pendingOperationId || result.resolved.some(value => value.operationId === editor.pendingOperationId))) { setUncertain(false); setActionError(null); refresh(); }
      else { setUncertain(true); setActionError(text('The change is still awaiting confirmation.')); }
    } catch (cause) { if (alive.current) { setUncertain(true); setActionError(`${text('Could not check changes:')} ${errorMessage(cause)}`); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };

  const execute = async (change: AutomationChange, operation: () => Promise<AutomationReceipt>, editorIdentity?: AutomationDraftIdentity): Promise<AutomationReceipt | { state: 'not-sent'; message: string }> => {
    const mayDispatch = () => { try { return current() && (!editorIdentity || props.isCurrentEditor?.(editorIdentity, change.operationId) === true); } catch { return false; } };
    if (!props.onTrackChange || inFlight.current || unavailableActions || !mayDispatch()) return { state: 'not-sent', message: 'This operation is unavailable.' };
    inFlight.current = true; setBusy(true); setActionError(null); setNotice(null);
    let invoked = false, completed = false, repeated = false, closed = false, result: AutomationReceipt | undefined;
    try {
      const receipt = await props.onTrackChange(change, async () => {
        if (invoked || closed || !mayDispatch()) { repeated = true; throw new Error('The operation can no longer start.'); }
        invoked = true;
        try {
          if (!mayDispatch()) { invoked = false; throw new Error('The selected host changed.'); }
          result = await operation(); return result;
        } finally { completed = true; }
      });
      closed = true;
      if (!invoked || !completed || repeated || !receipt || !['confirmed', 'rejected', 'unknown'].includes(receipt.state) ||
        (receipt.state !== 'confirmed' && typeof receipt.message !== 'string') ||
        (receipt.state === 'confirmed' && result?.state !== 'confirmed') || (result?.state === 'confirmed' && receipt.state !== 'confirmed') ||
        (result?.state === 'unknown' && receipt.state === 'rejected') ||
        (receipt.state === 'confirmed' && result?.state === 'confirmed' &&
          (receipt.automationId !== result.automationId || receipt.item?.id !== result.item?.id || receipt.item?.revision !== result.item?.revision || receipt.run?.operationId !== result.run?.operationId || receipt.run?.turnId !== result.run?.turnId))) {
        throw new Error('The operation receipt could not be verified.');
      }
      if (alive.current) {
        if (receipt.state === 'unknown') { pendingChanges.current.set(change.operationId, change); setUncertain(true); setActionError(receipt.message); }
        else if (receipt.state === 'rejected') setActionError(receipt.message);
      }
      return receipt;
    } catch (cause) {
      closed = true;
      if (!invoked) return { state: 'not-sent', message: `${text('The operation was not sent:')} ${errorMessage(cause)}` };
      const message = `${text('The result could not be confirmed:')} ${errorMessage(cause)}`;
      if (alive.current) { pendingChanges.current.set(change.operationId, change); setUncertain(true); setActionError(message); }
      return { state: 'unknown', message };
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };

  const save = async () => {
    if (!editor || unavailableActions || !onEditorChange || !props.onPrepareEditor || !props.isCurrentEditor || !props.onFinalizeChange || props.route && (!props.isCurrentCompletion || !props.onAcknowledgeNavigation) || !current()) return;
    const operationId = crypto.randomUUID();
    if (editor.mode === 'edit' && (!editorEntry || editor.revision !== editorEntry.item.revision || !editorEntry.edit.allowed || !props.onUpdate || !editor.id || !editor.revision)) return;
    if (editor.mode === 'create' && (!props.create.capability.allowed || !props.onCreate)) return;
    const identity = draftIdentity(editor);
    const snapshot = structuredClone(editor);
    const change: AutomationChange = editor.mode === 'create'
      ? { ...scope, route: routeFor(editor.source, editor.teamId), kind: 'create', operationId, sourceKey: editor.sourceKey, draft: snapshot.draft }
      : { ...scope, route: routeFor(editor.source, editor.teamId), kind: 'update', operationId, sourceKey: editor.sourceKey, id: editor.id!, revision: editor.revision!, draft: snapshot.draft };
    inFlight.current = true; setBusy(true); setActionError(null);
    let prepared: 'prepared' | 'changed';
    try { prepared = await props.onPrepareEditor({ scope, identity, editor: snapshot, operationId, change }); }
    catch (cause) {
      let settlementFailed = false;
      try { await props.onFinalizeChange({ scope, change, identity, outcome: { state: 'not-sent' }, completion: null }); } catch { settlementFailed = true; }
      if (current()) { if (settlementFailed) { pendingChanges.current.set(change.operationId, change); setUncertain(true); } setActionError(`${text('Could not preserve the draft:')} ${errorMessage(cause)}`); }
      return;
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
    if (prepared !== 'prepared') { if (current()) setActionError(text('The draft changed before it could be saved.')); return; }
    const receipt = await execute(change, async () => {
      const response = change.kind === 'create'
        ? await props.onCreate!({ ...scope, requestId: operationId, sourceKey: change.sourceKey, draft: change.draft })
        : await props.onUpdate!({ ...scope, operationId, sourceKey: change.sourceKey, id: change.id, revision: change.revision, draft: change.draft });
      const confirmed: Extract<AutomationReceipt, { state: 'confirmed' }> = { state: 'confirmed', automationId: response?.automationId, item: response?.item };
      try {
        const automationId = confirmedTaskId(change, confirmed, change.sourceKey === props.create.sourceKey && props.create.idMatchesRequestId);
        if (confirmed.item && (confirmed.item.kind !== change.draft.kind || confirmed.item.status !== change.draft.status)) throw new Error('The saved task could not be verified.');
        return { ...confirmed, automationId };
      } catch { return { state: 'unknown', message: 'The saved task could not be confirmed.' }; }
    }, identity);
    if (receipt.state === 'unknown') return;
    try {
      const completion = receipt.state === 'confirmed' ? completionFor(change, receipt) : null;
      const settled = await props.onFinalizeChange({ scope, change, identity, outcome: receipt, completion });
      if (!current() || settled !== 'applied') return;
      if (receipt.state === 'confirmed') {
        setSelectedKey(JSON.stringify([editor.sourceKey, confirmedTaskId(change, receipt, change.sourceKey === props.create.sourceKey && props.create.idMatchesRequestId)])); setNotice(text('Scheduled task saved.')); refresh();
        if (completion) await deliverNavigation(completion);
      } else { setActionError(receipt.message); if (editor.mode === 'edit') refresh(); }
    } catch (cause) { if (current()) { pendingChanges.current.set(change.operationId, change); setUncertain(true); setActionError(`${text('Could not preserve the result:')} ${errorMessage(cause)}`); } }
  };

  const remove = async (entry: AutomationEntry) => {
    if (!props.onDelete || !props.onFinalizeChange || props.route && (!props.isCurrentCompletion || !props.onAcknowledgeNavigation) || !entry.delete.allowed || unavailableActions || !current()) return;
    setConfirm(null);
    const change: AutomationChange = { ...scope, route: routeFor(entry.location === 'local' ? 'local' : 'cloud', entry.location === 'team' ? entry.teamId ?? null : null), kind: 'delete', operationId: crypto.randomUUID(), sourceKey: entry.sourceKey, id: entry.item.id, revision: entry.item.revision };
    const receipt = await execute(change, async () => {
      const response = await props.onDelete!({ ...scope, operationId: change.operationId, sourceKey: entry.sourceKey, id: entry.item.id, revision: entry.item.revision });
      if (response?.success === false && response.status === 'not_found') return { state: 'rejected', message: 'This scheduled task no longer exists.' };
      return response?.success === true && response.status === 'deleted' && (!response.item || response.item.id === entry.item.id && response.item.status === 'DELETED')
        ? { state: 'confirmed', automationId: entry.item.id, item: response.item } : { state: 'unknown', message: 'The deletion could not be confirmed.' };
    });
    if (receipt.state === 'unknown') return;
    try {
      const completion = receipt.state === 'confirmed' ? completionFor(change, receipt) : null;
      const settled = await props.onFinalizeChange({ scope, change, identity: null, outcome: receipt, completion });
      if (!current() || settled !== 'applied') return;
      if (receipt.state === 'confirmed') { setSelectedKey(null); setNotice(text('Scheduled task deleted.')); refresh(); if (completion) await deliverNavigation(completion); }
      else { setActionError(receipt.message); if (receipt.state === 'rejected') refresh(); }
    } catch (cause) { if (current()) { pendingChanges.current.set(change.operationId, change); setUncertain(true); setActionError(`${text('Could not preserve the result:')} ${errorMessage(cause)}`); } }
  };

  const run = async (entry: AutomationEntry) => {
    if (!props.onResolveRunSelection || !props.onRunNow || !entry.run.allowed || unavailableActions || inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError(null); setNotice(null);
    let selection: HeartbeatSelection;
    try {
      selection = structuredClone(await props.onResolveRunSelection({ ...scope, entry }));
    } catch (cause) {
      if (alive.current) setActionError(`${text('Could not prepare the run:')} ${errorMessage(cause)}`);
      return;
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
    if (!current()) return;
    const change: AutomationChange = { ...scope, route: routeFor(entry.location === 'local' ? 'local' : 'cloud', entry.location === 'team' ? entry.teamId ?? null : null), kind: 'run', operationId: crypto.randomUUID(), sourceKey: entry.sourceKey, id: entry.item.id, revision: entry.item.revision, targetThreadId: entry.item.kind === 'heartbeat' ? entry.item.targetThreadId : null, selection };
    const receipt = await execute(change, async () => {
      const result = await props.onRunNow!({ ...scope, sourceKey: entry.sourceKey, operationId: change.operationId, automationId: entry.item.id, revision: entry.item.revision, selection: change.selection });
      if (!result || result.operationId !== change.operationId || result.automationId !== entry.item.id ||
        entry.item.kind === 'heartbeat' && result.threadId !== entry.item.targetThreadId) return { state: 'unknown', message: 'The run could not be confirmed.' };
      if (result.state === 'started' && result.turnId) return { state: 'confirmed', run: result };
      if (result.state === 'rejected' || result.state === 'not-dispatched') return { state: 'rejected', message: 'The run did not start.' };
      return { state: 'unknown', message: 'The run may have started. Check its result before trying again.' };
    });
    if (alive.current && receipt.state === 'confirmed') setNotice(text('Run started.'));
  };

  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const filtered = list?.items.filter(entry => {
    const item = entry.item;
    const projectId = item.kind === 'cron' && item.target?.type === 'project' ? item.target.projectId : null;
    const projectName = projectId && props.projects.state === 'ready' ? props.projects.items.find(project => project.id === projectId)?.label ?? projectId : '';
    return item.status !== 'DELETED' && (status === 'ALL' || item.status === status) && normalize([item.name, item.prompt, item.rrule, projectName].join(' ')).includes(normalize(query));
  }) ?? [];
  const staleDraft = editor?.mode === 'edit' && (!editorEntry || editor.revision !== editorEntry.item.revision);
  const editorStatuses = editor?.mode === 'create' ? props.create.allowedStatuses : editorEntry?.allowedStatuses ?? [];
  const allowUnvalidatedPaused = editor?.mode === 'create' ? props.create.allowUnvalidatedPaused : editorEntry?.allowUnvalidatedPaused ?? false;
  const landingHeartbeat = !!props.route?.landing && activeSelection?.location === 'local' && activeSelection.item.kind === 'heartbeat' ? activeSelection : null;
  const heartbeatStarted = useRef<string | null>(null);
  const openLandingHeartbeat = () => {
    if (!landingHeartbeat || landingHeartbeat.item.kind !== 'heartbeat' || !props.onOpenThread || !current()) return;
    const { id, targetThreadId } = landingHeartbeat.item;
    void Promise.resolve().then(() => {
      if (!current()) throw new Error('The selected page changed.');
      return props.onOpenThread!({ ...scope, threadId: targetThreadId, replace: true,
        state: { sidebarArea: 'scheduled', sidebarAutomationId: id, sidebarAutomationSource: 'local' } });
    }).catch(cause => { if (current()) setActionError(errorMessage(cause)); });
  };
  useEffect(() => {
    const id = landingHeartbeat?.item.id;
    if (id && heartbeatStarted.current !== id && current()) { heartbeatStarted.current = id; openLandingHeartbeat(); }
  }, [landingHeartbeat?.item.id, landingHeartbeat?.item.revision]);

  if (props.route?.landing) {
    const creating = props.route.automationMode === 'create' || props.route.templateCandidate && props.routeTemplate?.state !== 'ignored';
    const cloud = activeSelection?.cloudLanding;
    const eventTriggered = cloud?.timing_mode === 'condition_watch' && activeSelection?.item.rrule.includes('X-UNSCHEDULED:1');
    const nextRun = activeSelection?.timing === 'known' && (activeSelection.location === 'local' || cloud) ? activeSelection.item.nextRunAt : null;
    let confirmation = text('Your task is saved. You can review its schedule and settings in task details.');
    if (eventTriggered && cloud) confirmation = eventConfirmation(cloud.webhook_triggers ?? [], locale, text);
    else if (nextRun !== null && nextRun !== undefined && !Number.isNaN(new Date(nextRun).getTime())) {
      try { confirmation = text('Your task is scheduled. Its next run is {time}.').replace('{time}', formatDate(nextRun, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: cloud?.default_timezone ?? undefined })); }
      catch { /* Invalid upstream time zones cannot be represented as a verified next run. */ }
    }
    return <main className="yard-automations"><div className="yard-automations-content">
      {!hasRouteSelection ? <section className="yard-automation-landing"><h1>{text('Schedule a task')}</h1>
        <p>{text('ChatGPT can take care of ongoing tasks so you don’t have to.')}</p>
        <button className="yard-automation-primary" type="button" disabled={!!pendingNavigation} onClick={() => { if (current()) props.route?.onCreate(); }}>{text('New task')}</button></section> :
        <section className="yard-automation-landing">
          <button type="button" onClick={props.route.onBack}>{t('Back')}</button>
          {(loading || detailLoading) && !activeSelection && <p role="status">{text('Loading scheduled task details...')}</p>}
          {(detailError || loadError && !activeSelection) && <div role="alert">{detailError || loadError} <button type="button" onClick={() => { if (detailError) setDetailRevision(value => value + 1); else refresh(); }}>{detailError ? text('Retry task') : t('Retry')}</button></div>}
          {!activeSelection && !loading && !detailLoading && !detailError && !loadError && !missingLandingTask && <p>{text('This task is not in the available results.')}</p>}
          {!activeSelection && list?.nextCursor && <button type="button" disabled={loadingMore || !props.onLoadMore} onClick={() => void loadMore()}>{text('Show more')}</button>}
          {moreError && <div role="alert">{moreError} <button type="button" disabled={loadingMore || !props.onLoadMore} onClick={() => void loadMore()}>{text('Retry more tasks')}</button></div>}
          {missingLandingTask && props.route.navigationError && <button type="button" onClick={props.route.onUnavailable}>{text('Retry opening scheduled tasks')}</button>}
          {landingHeartbeat ? <>{actionError && <p role="alert">{actionError}</p>}{!props.onOpenThread && <p role="alert">{text('Task chat is unavailable for this session.')}</p>}<button type="button" disabled={!props.onOpenThread} onClick={openLandingHeartbeat}>{text('Open chat')}</button></> :
            activeSelection && <><h1>{activeSelection.item.name}</h1><p>{activeSelection.item.prompt}</p>
              <p>{confirmation}</p>
              {props.renderLandingComposer ? props.renderLandingComposer({ ...scope, entry: activeSelection, confirmation, navigationSource: 'scheduled_page' }) : <p>{text('Task chat is unavailable for this session.')}</p>}</>}
        </section>}
      {(actionError || needsCheck) && <div role="alert">{actionError || text('A scheduled task change needs verification.')} {needsCheck && <button type="button" disabled={busy || !props.onReconcileChanges} onClick={() => void reconcile()}>{text('Check changes')}</button>}</div>}
      {pendingNavigation && <button type="button" onClick={() => void deliverNavigation(pendingNavigation)}>{text('Retry opening task')}</button>}
      {creating && <LandingEditorDialog onClose={() => { if (editor && !routeEditorBlocked) requestDiscard(null); else props.route?.onCancelEditor(); }}>
        <h2 id="yard-automation-landing-editor-title">{text('New scheduled task')}</h2>
        {editor && persistenceUnavailable && <p role="status">{text('Saving is unavailable right now. Try again when it is restored.')}</p>}
        {draftBlocked || editorRouteMismatch ? props.routeDraft?.state === 'loading' ? <p role="status">{text('Loading scheduled task draft...')}</p> :
          <div role="alert">{props.routeDraft?.state === 'error' ? props.routeDraft.message : text('The selected scheduled task draft has not been restored.')}
            {props.routeDraft?.state === 'error' && <button type="button" onClick={() => { const retry = props.routeDraft; if (retry?.state === 'error') void Promise.resolve().then(retry.retry).catch(cause => { if (current()) setActionError(errorMessage(cause)); }); }}>{text('Retry draft')}</button>}</div> :
          teamBlocked ? <p role="alert">{text('The selected team for this scheduled task has not been resolved.')}</p> :
          templateBlocked ? props.routeTemplate?.state === 'loading' ? <p role="status">{text('Loading scheduled task template...')}</p> :
            <div role="alert">{props.routeTemplate?.state === 'error' ? props.routeTemplate.message : text('The scheduled task template has not been restored.')}
              {props.routeTemplate?.state === 'error' && <button type="button" onClick={() => { const retry = props.routeTemplate; if (retry?.state === 'error') void Promise.resolve().then(retry.retry).catch(cause => { if (current()) setActionError(errorMessage(cause)); }); }}>{text('Retry template')}</button>}</div> :
          !editor ? <p role="status">{text('The scheduled task editor is unavailable for this session.')}</p> :
          <AutomationEditor key={editor.createRequestId} editor={editor} onChange={setEditor} onSave={() => void save()} onCancel={() => requestDiscard(null)}
            onRetryChoices={props.onRetryChoices ? kind => props.onRetryChoices!({ ...scope, kind }) : undefined}
            busy={busy || needsCheck} saving={busy} saveDisabled={unavailableActions || !props.onPrepareEditor || !props.isCurrentEditor || !props.onFinalizeChange || !props.isCurrentCompletion || !props.onAcknowledgeNavigation || !props.onCreate}
            allowedStatuses={editorStatuses} allowUnvalidatedPaused={allowUnvalidatedPaused} codec={props.scheduleCodec} projects={props.projects} threads={props.threads} models={props.models} />}
        {(loadError || detailError) && <div role="alert">{loadError || detailError} <button type="button" onClick={refresh}>{t('Retry')}</button></div>}
      </LandingEditorDialog>}
      {confirm && <ConfirmDialog kind={confirm} name={activeSelection?.item.name || 'this scheduled task'} busy={busy || needsCheck} onClose={() => { discardIdentity.current = null; setConfirm(null); }} onConfirm={() => {
        if (confirm === 'discard' && discardCurrentEditor()) { setConfirm(null); props.route?.onCancelEditor(); }
      }} />}
    </div></main>;
  }
  return <main className="yard-automations"><div className="yard-automations-content">
    <header className="yard-automations-header"><h1>Scheduled</h1><div>
      <button className="yard-automation-icon" type="button" title="Refresh scheduled tasks" aria-label="Refresh scheduled tasks" disabled={loading || busy || !props.onLoad} onClick={refresh}><RefreshCw size={17} /></button>
      <button className="yard-automation-primary" type="button" disabled={unavailableActions || !!editor || !props.create.capability.allowed || !props.onCreate || !onEditorChange} onClick={() => { if (current()) { if (props.route) props.route.onCreate(); else openCreate(); } }}><Plus size={16} /> Create</button>
    </div></header>
    {!props.create.capability.allowed && <p className="yard-automation-muted">{props.create.capability.reason}</p>}
    {props.route?.automationMode === 'create' && !editor && !loading && !loadError && (!props.create.capability.allowed || !props.onCreate || !onEditorChange || !props.onTrackChange) && <p role="alert">{text('The scheduled task editor is unavailable for this session.')}</p>}
    {props.route?.automationEditing && activeSelection && !editor && !loading && (!activeSelection.edit.allowed || !props.onUpdate || !onEditorChange || !props.onTrackChange) && <p role="alert">{unavailable(activeSelection.edit) || text('Editing this scheduled task is unavailable for this session.')}</p>}
    {teamBlocked && <p role="alert">{text('The selected team for this scheduled task has not been resolved.')}</p>}
    {templateBlocked && (props.routeTemplate?.state === 'loading' ? <p role="status">{text('Loading scheduled task template...')}</p> :
      <div role="alert">{props.routeTemplate?.state === 'error' ? props.routeTemplate.message : text('The scheduled task template has not been restored.')}
        {props.routeTemplate?.state === 'error' && <button type="button" onClick={() => {
          const retry = props.routeTemplate; if (retry?.state === 'error') void Promise.resolve().then(retry.retry).catch(cause => { if (alive.current) setActionError(errorMessage(cause)); });
        }}>{text('Retry template')}</button>}</div>)}
    {(draftBlocked || editorRouteMismatch) && (props.routeDraft?.id === routeDraftId && props.routeDraft.state === 'loading' ? <p role="status">{text('Loading scheduled task draft...')}</p> :
      <div role="alert">{props.routeDraft?.id === routeDraftId && props.routeDraft.state === 'error' ? props.routeDraft.message : text('The selected scheduled task draft has not been restored.')}
        {props.routeDraft?.id === routeDraftId && props.routeDraft.state === 'error' && <button type="button" onClick={() => {
          const retry = props.routeDraft; if (retry?.state === 'error') void Promise.resolve().then(retry.retry).catch(cause => { if (alive.current) setActionError(errorMessage(cause)); });
        }}>{text('Retry draft')}</button>}</div>)}
    {(!props.onTrackChange || !onEditorChange) && <p className="yard-automation-muted">{text('Scheduled task changes are unavailable for this session.')}</p>}
    {!!editor && persistenceUnavailable && <p role="status" className="yard-automation-muted">{text('Saving is unavailable right now. Try again when it is restored.')}</p>}
    <div className="yard-automations-toolbar"><label className="yard-automation-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search scheduled tasks" placeholder="Search by name" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="yard-automation-filter"><span className="yard-automation-sr">Scheduled task status</span><select aria-label="Scheduled task status" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="ALL">All</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option></select></label></div>
    {(actionError || needsCheck) && <div role="alert" className="yard-automation-alert"><span>{actionError || text('A scheduled task change needs verification.')}</span>{needsCheck && <button type="button" disabled={busy || !props.onReconcileChanges} onClick={() => void reconcile()}>{text('Check changes')}</button>}</div>}
    {pendingNavigation && <button type="button" onClick={() => void deliverNavigation(pendingNavigation)}>{text('Retry opening task')}</button>}
    {notice && <p role="status" className="yard-automation-muted">{notice}</p>}
    {loadError && <div role="alert" className="yard-automation-alert"><span>{loadError}</span><button type="button" disabled={loading || busy || !props.onLoad} onClick={refresh}>Retry</button></div>}
    {detailError && <div role="alert" className="yard-automation-alert"><span>{detailError}</span><button type="button" disabled={detailLoading} onClick={() => setDetailRevision(value => value + 1)}>{text('Retry task')}</button></div>}
    {missingLandingTask && props.route?.navigationError && <button type="button" onClick={props.route.onUnavailable}>{text('Retry opening scheduled tasks')}</button>}
    {list && !list.complete && <p className="yard-automation-muted">The scheduled task list is incomplete.</p>}
    {list?.sources.map(source => source.state !== 'ready' || source.diagnostics?.length ? <div key={source.key} className="yard-automation-alert" role="status"><span>{source.label}: {source.message || (source.state === 'partial' ? 'Partial results' : source.state === 'unavailable' ? 'Unavailable' : source.state === 'error' ? 'Could not load' : 'Some tasks could not be read')}{source.diagnostics?.map(diagnostic => <span className="yard-automation-diagnostic" key={`${diagnostic.id}:${diagnostic.message}`}>{diagnostic.id}: {diagnostic.message}</span>)}</span><button type="button" disabled={loading || busy} onClick={refresh}>Retry</button></div> : null)}
    <div className="yard-automations-layout"><section aria-label="Scheduled tasks" className="yard-automation-list">
      {loading && <p role="status" className="yard-automation-muted">Loading scheduled tasks...</p>}
      {!loading && list && !filtered.length && !loadError && <p className="yard-automation-muted">{query || status !== 'ALL' ? !list.complete ? 'No matches in the available tasks.' : 'No matching scheduled tasks.' : list.complete ? 'No scheduled tasks yet.' : 'No tasks in the available sources.'}</p>}
      {filtered.map(entry => <button className="yard-automation-row" type="button" key={entryKey(entry)} disabled={!!editor && (busy || needsCheck)} aria-current={activeSelection && entryKey(activeSelection) === entryKey(entry) ? 'true' : undefined} onClick={() => choose(entryKey(entry))}>
        <Clock3 size={18} aria-hidden="true" /><span><strong>{entry.item.name || 'Untitled scheduled task'}</strong><small>{entry.location === 'local' ? 'On this device' : entry.location === 'team' ? 'Team' : 'Cloud'} · {entry.item.status === 'ACTIVE' ? 'Active' : 'Paused'}</small></span></button>)}
      {moreError && <div role="alert" className="yard-automation-alert"><span>{moreError}</span><button type="button" disabled={loadingMore || !props.onLoadMore} onClick={() => void loadMore()}>Retry more tasks</button></div>}
      {list?.nextCursor && !moreError && <div className="yard-automation-more"><button type="button" disabled={loadingMore || loading || busy || !props.onLoadMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading more...' : 'Show more'}</button>{!props.onLoadMore && <p className="yard-automation-muted">More tasks are available, but paging is unavailable.</p>}</div>}
    </section><section className="yard-automation-detail" aria-label="Scheduled task details">
      {editor && !routeEditorBlocked ? <><div className="yard-automation-detail-header"><h2>{editor.mode === 'create' ? 'New scheduled task' : 'Edit scheduled task'}</h2></div>
        {staleDraft && <div role="alert" className="yard-automation-alert"><span>This task changed or is unavailable. Your draft is preserved; applying it to the latest version will replace that version's fields.</span>{editorEntry && <button type="button" disabled={unavailableActions || !editorEntry.edit.allowed} onClick={() => setEditor({ ...editor, revision: editorEntry.item.revision })}>Apply draft to latest version</button>}</div>}
        <AutomationEditor key={editor.createRequestId} editor={editor} onChange={setEditor} onSave={() => void save()} onCancel={() => requestDiscard(null)}
          onRetryChoices={props.onRetryChoices ? kind => props.onRetryChoices!({ ...scope, kind }) : undefined}
          busy={busy || needsCheck} saving={busy} saveDisabled={unavailableActions || !!staleDraft || !props.onPrepareEditor || !props.isCurrentEditor || !props.onFinalizeChange || !!props.route && (!props.isCurrentCompletion || !props.onAcknowledgeNavigation) || (editor.mode === 'create' ? !props.onCreate : !props.onUpdate)} allowedStatuses={editorStatuses} allowUnvalidatedPaused={allowUnvalidatedPaused} codec={props.scheduleCodec} projects={props.projects} threads={props.threads} models={props.models} />
      </> : activeSelection ? <AutomationDetail entry={activeSelection} busy={unavailableActions || !!props.route && !list?.complete && !routeDetail} canEdit={!!onEditorChange && !!props.onUpdate} canDelete={!!props.onDelete && !!props.onFinalizeChange && (!props.route || !!props.isCurrentCompletion && !!props.onAcknowledgeNavigation)} canRun={!!props.onRunNow && !!props.onResolveRunSelection} onEdit={() => openEdit(activeSelection)} onDelete={() => setConfirm('delete')} onRun={() => void run(activeSelection)} onBack={() => props.route?.automationId !== null && props.route?.automationId !== undefined ? props.route.onBack() : choose(null)} onOpenThread={props.onOpenThread ? () => {
        if (activeSelection.item.kind === 'heartbeat') { const threadId = activeSelection.item.targetThreadId; void Promise.resolve().then(() => { if (!current()) throw new Error('The selected host changed.'); return props.onOpenThread!({ ...scope, threadId }); }).catch(cause => { if (current()) setActionError(`${text('Could not open chat:')} ${errorMessage(cause)}`); }); }
      } : undefined} />
        : <>{props.route && (props.route.automationId !== null || props.route.automationMode === 'create') && <button className="yard-automation-icon" type="button" aria-label="Back to scheduled tasks" title="Back" onClick={props.route.onBack}><ArrowLeft size={17} /></button>}
          <p className="yard-automation-muted">{loading || detailLoading ? 'Loading scheduled task details...' : detailNotFound ? 'Scheduled task unavailable.' : loadError || detailError ? 'Scheduled task details could not be loaded.' : routeMatches.length > 1 ? 'This task has more than one matching source.' : props.route?.automationId !== null && props.route?.automationId !== undefined ? list?.complete ? 'Scheduled task unavailable.' : 'This task is not in the available results.' : selectedKey ? 'Scheduled task unavailable.' : 'Select a scheduled task to view.'}</p></>}
    </section></div>
    {confirm && <ConfirmDialog kind={confirm} name={activeSelection?.item.name || 'this scheduled task'} busy={busy || needsCheck} onClose={() => { discardIdentity.current = null; setConfirm(null); setPendingSelection(undefined); }} onConfirm={() => {
      if (confirm === 'delete' && activeSelection) void remove(activeSelection);
      else if (confirm === 'discard' && discardCurrentEditor()) {
        if (pendingSelection !== undefined) {
          const entry = pendingSelection ? list?.items.find(item => entryKey(item) === pendingSelection) : undefined;
          if (entry?.location === 'team' && !entry.teamId && props.route) setActionError(text('The selected task has no verified team identity.'));
          else if (entry && props.route) props.route.onSelect(entry);
          else if (pendingSelection === null && props.route && (props.route.automationId !== null || props.route.automationMode === 'create' || props.route.automationEditing || props.route.templateCandidate)) props.route.onCancelEditor();
          else setSelectedKey(pendingSelection);
        } else if (props.route?.automationMode === 'create' || props.route?.automationEditing || props.route?.templateCandidate) props.route.onCancelEditor();
        setPendingSelection(undefined); setConfirm(null);
      }
    }} />}
  </div></main>;
}

function LandingEditorDialog({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  return <dialog className="yard-automation-dialog" ref={dialog} aria-labelledby="yard-automation-landing-editor-title" onCancel={event => { event.preventDefault(); onClose(); }}><button className="yard-automation-icon" type="button" aria-label={t('Close')} title={t('Close')} onClick={onClose}><X size={17} /></button>{children}</dialog>;
}

function AutomationDetail({ entry, busy, canEdit, canDelete, canRun, onEdit, onDelete, onRun, onBack, onOpenThread }: { entry: AutomationEntry; busy: boolean; canEdit: boolean; canDelete: boolean; canRun: boolean; onEdit(): void; onDelete(): void; onRun(): void; onBack(): void; onOpenThread?: () => void }) {
  const { item } = entry;
  const target = item.kind === 'heartbeat' ? item.targetThreadId : item.target?.type === 'project' ? item.target.projectId : item.target?.type === 'projectless' ? 'No project' : 'Unknown';
  const when = (time: number | null) => entry.timing === 'unknown' ? 'Unknown' : time === null ? 'None' : new Date(time).toLocaleString();
  return <><div className="yard-automation-detail-header"><button className="yard-automation-icon" type="button" aria-label="Back to scheduled tasks" title="Back" onClick={onBack}><ArrowLeft size={17} /></button><h2>{item.name || 'Untitled scheduled task'}</h2></div>
    <p className="yard-automation-prompt-view">{item.prompt}</p><dl className="yard-automation-facts">
      <div><dt>Status</dt><dd>{item.status === 'ACTIVE' ? 'Active' : item.status === 'PAUSED' ? 'Paused' : 'Deleted'}</dd></div>
      <div><dt>Schedule</dt><dd className="yard-automation-rule-view">{item.rrule}</dd></div><div><dt>Runs in</dt><dd>{item.kind === 'heartbeat' ? 'Existing chat' : 'New task'}: {target}</dd></div>
      <div><dt>Model</dt><dd>{item.model || 'Default'}</dd></div><div><dt>Reasoning</dt><dd>{item.reasoningEffort || 'Default'}</dd></div><div><dt>Notifications</dt><dd>{item.notificationPolicy === 'failed_runs_only' ? 'Failed runs only' : item.kind === 'cron' ? 'All runs' : 'Important updates'}</dd></div>
      <div><dt>Next run</dt><dd>{when(item.nextRunAt)}</dd></div><div><dt>Last run</dt><dd>{when(item.lastRunAt)}</dd></div>
    </dl><div className="yard-automation-detail-actions"><button type="button" disabled={busy || !canEdit || !entry.edit.allowed} title={unavailable(entry.edit) ?? undefined} onClick={onEdit}>Edit</button>
      <button type="button" disabled={busy || !canRun || !entry.run.allowed} title={unavailable(entry.run) ?? undefined} onClick={onRun}>Run now</button>
      {item.kind === 'heartbeat' && <button type="button" disabled={!onOpenThread} onClick={onOpenThread}>Open chat</button>}
      <button type="button" disabled={busy || !canDelete || !entry.delete.allowed} title={unavailable(entry.delete) ?? undefined} onClick={onDelete}>Delete</button></div>
    {[unavailable(entry.edit), unavailable(entry.run), unavailable(entry.delete)].filter((reason, index, all) => reason && all.indexOf(reason) === index).map(reason => <p className="yard-automation-muted" key={reason}>{reason}</p>)}
    {(!canEdit || !canDelete || !canRun) && <p className="yard-automation-muted">Some task actions are unavailable for this session.</p>}
  </>;
}

function ConfirmDialog({ kind, name, busy, onClose, onConfirm }: { kind: 'delete' | 'discard'; name: string; busy: boolean; onClose(): void; onConfirm(): void }) {
  const { t } = useI18n();
  const text = (value: string) => translateKnown(t, value);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  return <dialog className="yard-automation-dialog" ref={dialog} aria-labelledby="yard-automation-confirm-title" onClose={onClose}>
    <header><h2 id="yard-automation-confirm-title">{text(kind === 'delete' ? 'Delete scheduled task?' : 'Discard changes?')}</h2><button className="yard-automation-icon" type="button" aria-label={text('Close confirmation')} title={t('Close')} onClick={() => dialog.current?.close()}><X size={17} /></button></header>
    <p>{kind === 'delete' ? `${text('Delete')} ${name}?` : text('Your unsaved changes will be lost.')}</p><div className="yard-automation-dialog-actions"><button type="button" onClick={() => dialog.current?.close()}>{t('Cancel')}</button><button type="button" disabled={busy} onClick={onConfirm}>{kind === 'delete' ? text('Delete') : t('Discard')}</button></div>
  </dialog>;
}
