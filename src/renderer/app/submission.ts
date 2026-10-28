import type { ThreadSettingsResponse, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { draftToInput } from '../composer/standalone-draft.ts';

export interface SubmissionContext {
  hostId: string;
  threadId: string | null;
  cwd: string;
  readOnly: boolean;
  activeTurnId: string | null;
  thread: ThreadSummary | null;
  /** Display values restored from the authoritative session, not user edits. */
  initialOptions?: SubmitOptions;
  /** Explicit composer edits, when supplied by its versioned submit callback. */
  overrides?: Partial<SubmitOptions>;
  /** Immutable model-visible widget state captured for this submission. */
  additionalContext?: Record<string, { kind: 'untrusted'; value: string }>;
  /** A durable ordinary-send intent; hooks complete before issuing each write. */
  send?: {
    clientUserMessageId: string;
    creating(): Promise<unknown>;
    created(thread: ThreadSummary, settings: ThreadSettingsResponse): Promise<unknown>;
    sending(): Promise<unknown>;
    confirmed(turnId: string): Promise<unknown>;
  };
}

function permissions(options: SubmitOptions, cwd: string, starting: boolean): Record<string, unknown> {
  if (options.permissionProfileId) return { permissions: options.permissionProfileId };
  const clearedProfile = Object.hasOwn(options, 'permissionProfileId') ? { permissions: null } : {};
  if (!options.sandboxMode) return clearedProfile;
  if (starting) return { ...clearedProfile, sandbox: options.sandboxMode };
  return { ...clearedProfile, sandboxPolicy: options.sandboxMode === 'danger-full-access' ? { type: 'dangerFullAccess' }
    : options.sandboxMode === 'read-only' ? { type: 'readOnly', networkAccess: false }
      : { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
}
function sharedOptions(options: SubmitOptions) {
  return { ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
    ...(options.approvalPolicy !== undefined ? { approvalPolicy: options.approvalPolicy } : {}),
    ...(options.approvalsReviewer !== undefined ? { approvalsReviewer: options.approvalsReviewer } : {}) };
}

/** App is the only owner of send, steer and authoritative queue submission. */
export async function submitDraft(client: WorkbenchClient, context: SubmissionContext, draft: ComposerDraft,
  options: SubmitOptions, action: SubmitAction, selectCreatedThread: (thread: ThreadSummary, settings: ThreadSettingsResponse) => Promise<void>, origin?: MessageEditOrigin,
  edit?: (origin: MessageEditOrigin, expectedTurnIds: string[], turnParams: Record<string, unknown>) => Promise<{ turn?: TurnSummary }>) {
  if (context.readOnly) throw new Error('归档会话为只读，请先恢复会话。');
  if (draft.hints?.length) throw new Error('此输入包含尚未转换的编辑提示，内容已保留，未发送。');
  // Restored controls are a projection. Sending without an edit must leave the
  // backend's full sandbox, profile and collaboration instructions untouched.
  const changes: SubmitOptions = context.overrides ?? (context.threadId && context.initialOptions
    ? Object.fromEntries(Object.entries(options).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(context.initialOptions![key as keyof SubmitOptions]))) : options);
  const input = draftToInput(draft, context.hostId), clientUserMessageId = context.send?.clientUserMessageId ?? crypto.randomUUID();
  if (!input.length) throw new Error('请输入消息。');
  if (action.type === 'queue') {
    if (!context.threadId || origin) throw new Error('只有已有会话的新消息可以排队。');
    if (draft.references?.some(reference => reference.context !== undefined || reference.original !== undefined)) throw new Error('队列协议无法保存此上下文，草稿已保留。');
    await client.rpc('thread/queue/add', { threadId: context.threadId, input, clientUserMessageId }, context.hostId);
    return { threadId: context.threadId };
  }
  const additionalContext = { ...context.additionalContext, ...Object.fromEntries((draft.references ?? []).flatMap(reference => reference.original !== undefined || reference.context !== undefined
    ? [[reference.id, { kind: 'untrusted', value: JSON.stringify(reference.original !== undefined ? reference.original : reference.context) }]] : [])) };
  if (action.type === 'steer') {
    if (!context.threadId || !context.activeTurnId || action.turnId !== context.activeTurnId || origin) throw new Error('当前任务已改变，请核对会话后再发送。');
    await client.rpc('turn/steer', { threadId: context.threadId, expectedTurnId: action.turnId, input, clientUserMessageId,
      ...(Object.keys(additionalContext).length ? { additionalContext } : {}) }, context.hostId);
    return { threadId: context.threadId };
  }
  // Recovery may need a read-only check of a request that already started.
  // Its controller/host validates the phase before permitting any mutation.
  if (context.activeTurnId && !origin) throw new Error('当前任务仍在运行，请选择排队或发送到当前任务。');
  if (origin) {
    if (!context.threadId || origin.hostId !== context.hostId || origin.threadId !== context.threadId) throw new Error('编辑会话已改变，内容已保留。');
    if (!edit) throw new Error('编辑恢复尚未接入，未修改会话。');
  }
  let id = context.threadId;
  let settings: ThreadSettingsResponse = {};
  if (!id) {
    await context.send?.creating();
    const result = await client.rpc<{ thread: ThreadSummary } & ThreadSettingsResponse>('thread/start',
      { cwd: context.cwd, ...sharedOptions(options), ...permissions(options, context.cwd, true) }, context.hostId);
    id = result.thread.id; settings = result;
    await context.send?.created(result.thread, result);
    // thread/start owns the initial subscription. Its empty history may not yet
    // be readable; install the route/listener from this authoritative response.
    await selectCreatedThread(result.thread, result);
  }
  let model = options.model ?? settings.model;
  if (changes.mode && !model) {
    const response = await client.rpc<{ config: { model?: string } }>('config/read', { cwd: context.cwd, includeLayers: false }, context.hostId);
    model = response.config.model;
    if (!model) throw new Error('无法确定此模式使用的模型，草稿已保留。');
  }
  const turnParams = { threadId: id, input, clientUserMessageId,
    ...sharedOptions(changes), ...permissions(changes, context.cwd, false),
    ...(changes.effort !== undefined ? { effort: changes.effort } : {}),
    ...(changes.mode ? { collaborationMode: { mode: changes.mode, settings: { model,
      reasoning_effort: options.effort ?? settings.reasoningEffort ?? null, developer_instructions: null } } } : {}),
    ...(origin ? { turnTrigger: 'edit_user_message' } : {}),
    ...(Object.keys(additionalContext).length ? { additionalContext } : {}) };
  // The edit controller durably records each phase; the host verifies full history.
  if (!origin) await context.send?.sending();
  const result = origin ? await edit!(origin, (context.thread?.turns ?? []).map(turn => turn.id), turnParams)
    : await client.rpc<{ turn: TurnSummary }>('turn/start', turnParams, context.hostId);
  if (!origin && result.turn) await context.send?.confirmed(result.turn.id);
  return { threadId: id, turn: result.turn };
}
