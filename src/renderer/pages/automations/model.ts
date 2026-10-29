import type { ApprovalPolicy, ApprovalsReviewer, SandboxPolicy } from '../../../../lib/codex-protocol.ts';

export interface AutomationScope {
  hostId: string;
  accountKey: string | null;
  installationKey: string | null;
  sessionKey: string | number;
}

export type AutomationStatus = 'ACTIVE' | 'PAUSED' | 'DELETED';
export type AutomationEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type AutomationTarget = { type: 'project'; projectId: string } | { type: 'projectless' } | null;

export interface AutomationCommon {
  id: string;
  name: string;
  prompt: string;
  status: AutomationStatus;
  rrule: string;
  model: string | null;
  reasoningEffort: AutomationEffort | null;
  notificationPolicy: 'failed_runs_only' | null;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  nextRunNominalAt: number | null;
  lastRunAt: number | null;
  revision: string;
}

export type AutomationItem = AutomationCommon & (
  | { kind: 'heartbeat'; targetThreadId: string }
  | { kind: 'cron'; target: AutomationTarget; cwds: string[]; executionEnvironment: 'local' | 'worktree'; localEnvironmentConfigPath: string | null; pluginTemplateId: string | null; autoArchive: boolean }
);

export type AutomationDraft = Pick<AutomationCommon, 'name' | 'prompt' | 'rrule' | 'model' | 'reasoningEffort' | 'notificationPolicy'> &
  { status: 'ACTIVE' | 'PAUSED' } & (
    | { kind: 'heartbeat'; targetThreadId: string }
    | { kind: 'cron'; target: AutomationTarget; cwds: string[]; executionEnvironment: 'local' | 'worktree'; localEnvironmentConfigPath: string | null; pluginTemplateId: string | null; autoArchive: boolean }
  );

export type Capability = { allowed: true } | { allowed: false; reason: string };
export interface AutomationEntry {
  item: AutomationItem;
  sourceKey: string;
  location: 'local' | 'cloud' | 'team';
  teamId?: string | null;
  timing: 'known' | 'unknown';
  /** Fields projected from the same authorized cloud task response. */
  cloudLanding?: { timing_mode: string; default_timezone: string | null; webhook_triggers: unknown[] | null };
  edit: Capability;
  delete: Capability;
  run: Capability;
  allowedStatuses: ('ACTIVE' | 'PAUSED')[];
  allowUnvalidatedPaused: boolean;
}
export interface AutomationSource {
  key: string;
  label: string;
  state: 'ready' | 'partial' | 'unavailable' | 'error';
  message?: string;
  diagnostics?: { id: string; message: string }[];
}
export interface AutomationList {
  items: AutomationEntry[];
  sources: AutomationSource[];
  complete: boolean;
  nextCursor?: string | null;
}
export interface ProjectOption { id: string; label: string; cwds: string[] }
export interface ThreadOption { id: string; label: string }
export interface ModelOption { id: string; label: string; efforts: AutomationEffort[] }
export type Choices<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; items: T[] };

export interface ScheduleFields {
  mode: 'interval' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  interval: number;
  intervalUnit: 'minutes' | 'hours';
  time: string;
  weekday: 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
  monthDay: number;
}
/** Backed by an RFC 5545 library supplied by the host integration. */
export interface ScheduleCodec {
  parse(rrule: string): ScheduleFields | null;
  format(fields: ScheduleFields): string;
  validate(rrule: string): void;
}

export interface AutomationEditorDraft {
  scope: AutomationScope;
  draftId: string;
  draftRevision: string;
  mode: 'create' | 'edit';
  sourceKey: string;
  source: 'local' | 'cloud';
  teamId: string | null;
  id: string | null;
  revision: string | null;
  createRequestId: string;
  pendingOperationId: string | null;
  draft: AutomationDraft;
  rememberedCron?: Extract<AutomationDraft, { kind: 'cron' }>;
  rememberedHeartbeat?: Extract<AutomationDraft, { kind: 'heartbeat' }>;
}

export interface AutomationDraftIdentity extends AutomationScope {
  draftId: string;
  draftRevision: string;
  mode: 'create' | 'edit';
  sourceKey: string;
  source: 'local' | 'cloud';
  teamId: string | null;
  taskId: string | null;
  taskRevision: string | null;
}

export interface AutomationRouteCompletion extends AutomationScope {
  operationId: string;
  kind: 'save' | 'delete';
  automationId: string;
  source: 'local' | 'cloud';
  teamId: string | null;
  origin: { pathname: string; search: string; hash: string; state: unknown };
}

export function draftIdentity(editor: AutomationEditorDraft): AutomationDraftIdentity {
  return { ...editor.scope, draftId: editor.draftId, draftRevision: editor.draftRevision, mode: editor.mode,
    sourceKey: editor.sourceKey, source: editor.source, teamId: editor.teamId, taskId: editor.id, taskRevision: editor.revision };
}

export function sameDraftIdentity(a: AutomationDraftIdentity, b: AutomationDraftIdentity): boolean {
  return a.hostId === b.hostId && a.accountKey === b.accountKey && a.installationKey === b.installationKey && a.sessionKey === b.sessionKey &&
    a.draftId === b.draftId && a.draftRevision === b.draftRevision && a.mode === b.mode && a.sourceKey === b.sourceKey && a.source === b.source && a.teamId === b.teamId &&
    a.taskId === b.taskId && a.taskRevision === b.taskRevision;
}

export type AutomationChange = AutomationScope & { route: { origin: AutomationRouteCompletion['origin']; source: 'local' | 'cloud'; teamId: string | null } | null } & (
  | { kind: 'create'; operationId: string; sourceKey: string; draft: AutomationDraft }
  | { kind: 'update'; operationId: string; sourceKey: string; id: string; revision: string; draft: AutomationDraft }
  | { kind: 'delete'; operationId: string; sourceKey: string; id: string; revision: string }
  | { kind: 'run'; operationId: string; sourceKey: string; id: string; revision: string; targetThreadId: string | null; selection: HeartbeatSelection }
);
export interface HeartbeatSelection {
  collaborationMode: { mode: 'default' | 'plan'; settings: { model: string; reasoning_effort: AutomationEffort | null; developer_instructions: string | null } } | null;
  permissions: { approvalPolicy: ApprovalPolicy; approvalsReviewer: ApprovalsReviewer | null; sandboxPolicy: SandboxPolicy } | null;
}
export interface AutomationRun {
  operationId: string;
  automationId: string;
  threadId: string;
  state: 'preparing' | 'dispatching' | 'unknown' | 'started' | 'rejected' | 'not-dispatched';
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
}
export type AutomationReceipt =
  | { state: 'confirmed'; automationId?: string; item?: AutomationItem; run?: AutomationRun }
  | { state: 'rejected'; message: string }
  | { state: 'unknown'; message: string };
export interface AutomationReconciliation {
  pending: boolean;
  resolved: { operationId: string; state: 'confirmed' | 'rejected' | 'not-sent'; automationId?: string; item?: AutomationItem; run?: AutomationRun; change?: AutomationChange; identity?: AutomationDraftIdentity | null }[];
}

export function draftFromItem(item: AutomationItem): AutomationDraft {
  const common = { name: item.name, prompt: item.prompt, status: item.status === 'ACTIVE' ? 'ACTIVE' as const : 'PAUSED' as const,
    rrule: item.rrule, model: item.model, reasoningEffort: item.reasoningEffort, notificationPolicy: item.notificationPolicy };
  return item.kind === 'heartbeat' ? { ...common, kind: 'heartbeat', targetThreadId: item.targetThreadId } : {
    ...common, kind: 'cron', target: item.target, cwds: [...item.cwds], executionEnvironment: item.executionEnvironment,
    localEnvironmentConfigPath: item.localEnvironmentConfigPath, pluginTemplateId: item.pluginTemplateId, autoArchive: item.autoArchive,
  };
}

export function newDraft(): AutomationDraft {
  return { kind: 'cron', name: '', prompt: '', status: 'PAUSED', rrule: 'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0',
    model: null, reasoningEffort: null, notificationPolicy: null, target: { type: 'projectless' }, cwds: [],
    executionEnvironment: 'worktree', localEnvironmentConfigPath: null, pluginTemplateId: null, autoArchive: false };
}

export function entryKey(entry: AutomationEntry): string { return JSON.stringify([entry.sourceKey, entry.item.id]); }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
