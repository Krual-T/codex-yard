import type { ThreadSettingsResponse, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import { sandboxPolicyThreadStart } from '../../../lib/permissions.ts';
import type { ComposerDraft, MessageEditOrigin, SubmissionCollaborationMode, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { draftToInput, isStructuredAppInput, prepareDraftInput } from '../composer/standalone-draft.ts';
import type { SendInjectedInput, SendIntent } from './send-recovery.ts';
import { sendNativeInjection } from './send-injection-client.ts';
import type { NativeSubmissionInjection } from './send-injection-client.ts';

/** Capture the original app payload once; retries retain the stored call ID. */
export function captureDraftInjection(draft: ComposerDraft, hostId: string, documentPlainTextMode?: boolean): SendInjectedInput | undefined {
  if (!draft.input?.some(isStructuredAppInput)) return;
  const callId = crypto.randomUUID();
  const prepared = prepareDraftInput(draft, hostId, { plainTextMode: documentPlainTextMode, callId });
  return prepared.responseItems.length ? { callId, ...prepared } : undefined;
}

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
  /** The original submission's document mode, including retries and queued input. */
  documentPlainTextMode?: boolean;
  collaborationMode?: SubmissionCollaborationMode | null;
  /** Actual thread/start settings retained by an older, not-yet-resolved intent. */
  createdOptions?: Pick<SubmitOptions, 'model' | 'effort'>;
  injection?: SendIntent['injection'];
  /** Captured before the caller's first await; the store owns the original intent. */
  nativeInjection?: NativeSubmissionInjection;
  /** Recheck this original owner/connection and the actual idle session. */
  assertInjectionAuthority?(threadId: string): void;
  /** A durable submission intent; hooks complete before issuing each write. */
  send?: {
    clientUserMessageId: string;
    creating(): Promise<unknown>;
    created(thread: ThreadSummary, settings: ThreadSettingsResponse): Promise<unknown>;
    sending(): Promise<unknown>;
    confirmed(turnId: string): Promise<unknown>;
    queued?(queuedSubmissionId: string): Promise<unknown>;
    resolvedCollaboration?(mode: SubmissionCollaborationMode | null): Promise<unknown>;
    injecting?(): Promise<unknown>;
    injected?(): Promise<unknown>;
    injectionFailed?(error: unknown): Promise<unknown>;
  };
}

function permissions(options: SubmitOptions, cwd: string, starting: boolean): Record<string, unknown> {
  if (options.permissionProfileId) return { permissions: options.permissionProfileId };
  const clearedProfile = Object.hasOwn(options, 'permissionProfileId') ? { permissions: null } : {};
  if (options.sandboxPolicy) return starting
    ? { ...clearedProfile, ...sandboxPolicyThreadStart(options.sandboxPolicy) }
    : { ...clearedProfile, sandboxPolicy: structuredClone(options.sandboxPolicy) };
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
  if (context.nativeInjection) {
    const { store, intent, authority } = context.nativeInjection;
    const originalAssertion = authority.assertBeforeSend;
    context = { ...context, injection: structuredClone(context.injection),
      nativeInjection: { store, intent: structuredClone(intent), authority: {
        daemonConnectionGeneration: authority.daemonConnectionGeneration, assertBeforeSend: originalAssertion } },
      initialOptions: structuredClone(context.initialOptions), overrides: structuredClone(context.overrides),
      additionalContext: structuredClone(context.additionalContext), collaborationMode: structuredClone(context.collaborationMode),
      createdOptions: structuredClone(context.createdOptions), send: context.send && { ...context.send } };
    draft = structuredClone(draft); options = structuredClone(options); action = structuredClone(action);
  }
  if (context.readOnly) throw new Error('归档会话为只读，请先恢复会话。');
  if (draft.hints?.length) throw new Error('此输入包含尚未转换的编辑提示，内容已保留，未发送。');
  // Restored controls are a projection. Sending without an edit must leave the
  // backend's full sandbox, profile and collaboration instructions untouched.
  const changes: SubmitOptions = context.injection && context.nativeInjection ? context.nativeInjection.intent.overrides
    : context.overrides ?? (context.threadId && context.initialOptions
    ? Object.fromEntries(Object.entries(options).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(context.initialOptions![key as keyof SubmitOptions]))) : options);
  const prepared = draft.input?.some(isStructuredAppInput)
    ? prepareDraftInput(draft, context.hostId, { plainTextMode: context.documentPlainTextMode, callId: context.injection?.callId })
    : { input: draftToInput(draft, context.hostId, { plainTextMode: context.documentPlainTextMode }), responseItems: [] };
  const { input } = prepared, injection = context.injection, send = context.send;
  if (injection || prepared.responseItems.length) {
    if (!injection || action.type !== 'send' || origin || !send || !context.nativeInjection
      || context.nativeInjection.intent.clientUserMessageId !== send.clientUserMessageId
      || context.nativeInjection.intent.owner.hostId !== context.hostId
      || JSON.stringify(context.nativeInjection.intent.injection) !== JSON.stringify(injection)) {
      throw new Error('此 app 上下文须由原发送记录在会话空闲时注入，原内容已保留。');
    }
    const original = context.nativeInjection.intent;
    if (original.cwd !== context.cwd || original.threadId !== context.threadId
      || original.documentPlainTextMode !== context.documentPlainTextMode
      || JSON.stringify(original.draft) !== JSON.stringify(draft)
      || JSON.stringify(original.additionalContext ?? {}) !== JSON.stringify(context.additionalContext ?? {})
      || !injection.native && (JSON.stringify(original.options) !== JSON.stringify(options)
        || JSON.stringify(original.overrides) !== JSON.stringify(context.overrides ?? {}))) {
      throw new Error('原输入版本或提交选项已改变，原内容已保留。');
    }
    if (!['prepared', 'confirmed'].includes(injection.phase)
      || JSON.stringify(input) !== JSON.stringify(injection.input) || JSON.stringify(prepared.responseItems) !== JSON.stringify(injection.responseItems)) {
      throw new Error('原 app 注入上下文或阶段已改变，未重复发送。');
    }
  }
  const clientUserMessageId = send?.clientUserMessageId ?? crypto.randomUUID();
  if (!input.length) throw new Error('请输入消息。');
  if (action.type === 'queue') {
    if (!context.threadId || origin) throw new Error('只有已有会话的新消息可以排队。');
    if (draft.references?.some(reference => reference.context !== undefined || reference.original !== undefined)) throw new Error('队列协议无法保存此上下文，草稿已保留。');
    await context.send?.sending();
    const result = await client.rpc<{ queuedSubmission: { id: string; clientUserMessageId: string } }>('thread/queue/add', { threadId: context.threadId, input, clientUserMessageId }, context.hostId);
    if (context.send) {
      if (typeof result?.queuedSubmission?.id !== 'string' || !result.queuedSubmission.id
        || result.queuedSubmission.clientUserMessageId !== clientUserMessageId || !context.send.queued) {
        throw Object.assign(new Error('队列回执身份无法确认，原稿已保留，请检查结果。'), { uncertain: true });
      }
      await context.send.queued(result.queuedSubmission.id);
    }
    return { threadId: context.threadId };
  }
  const additionalContext = { ...context.additionalContext, ...Object.fromEntries((draft.references ?? []).flatMap(reference => reference.original !== undefined || reference.context !== undefined
    ? [[reference.id, { kind: 'untrusted', value: JSON.stringify(reference.original !== undefined ? reference.original : reference.context) }]] : [])) };
  if (action.type === 'steer') {
    if (!context.threadId || !context.activeTurnId || action.turnId !== context.activeTurnId || origin) throw new Error('当前任务已改变，请核对会话后再发送。');
    await context.send?.sending();
    const result = await client.rpc<{ turnId: string }>('turn/steer', { threadId: context.threadId, expectedTurnId: action.turnId, input, clientUserMessageId,
      ...(Object.keys(additionalContext).length ? { additionalContext } : {}) }, context.hostId);
    if (context.send) {
      if (result?.turnId !== action.turnId) throw Object.assign(new Error('当前任务回复身份无法确认，原稿已保留，请检查结果。'), { uncertain: true });
      await context.send.confirmed(result.turnId);
    }
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
    const threadPermissions = permissions(options, context.cwd, true);
    await context.send?.creating();
    const result = await client.rpc<{ thread: ThreadSummary } & ThreadSettingsResponse>('thread/start',
      { cwd: context.cwd, ...sharedOptions(options), ...threadPermissions }, context.hostId);
    id = result.thread.id; settings = result;
    await context.send?.created(result.thread, result);
    // thread/start owns the initial subscription. Its empty history may not yet
    // be readable; install the route/listener from this authoritative response.
    await selectCreatedThread(result.thread, result);
  }
  const savedTurnParams = injection?.native?.turnParams;
  let collaborationMode = savedTurnParams ? context.nativeInjection?.intent.collaborationMode : context.collaborationMode;
  if (collaborationMode === undefined && !savedTurnParams) {
    collaborationMode = null;
    if (changes.mode) {
      let model = options.model ?? settings.model ?? context.createdOptions?.model;
      if (!model) {
        const response = await client.rpc<{ config: { model?: string } }>('config/read', { cwd: context.cwd, includeLayers: false }, context.hostId);
        model = response.config.model;
        if (!model) throw new Error('无法确定此模式使用的模型，草稿已保留。');
      }
      collaborationMode = { mode: changes.mode, settings: { model,
        reasoning_effort: Object.hasOwn(options, 'effort') ? options.effort ?? null
          : settings.reasoningEffort ?? context.createdOptions?.effort ?? null, developer_instructions: null } };
    }
  }
  // Persist the resolved values (including omission) before the first write.
  if (!savedTurnParams) await context.send?.resolvedCollaboration?.(collaborationMode ?? null);
  const turnParams = savedTurnParams ?? { threadId: id, input, clientUserMessageId,
    ...sharedOptions(changes), ...permissions(changes, context.cwd, false),
    ...(changes.effort !== undefined ? { effort: changes.effort } : {}),
    ...(collaborationMode ? { collaborationMode } : {}),
    ...(origin ? { turnTrigger: 'edit_user_message' } : {}),
    ...(Object.keys(additionalContext).length ? { additionalContext } : {}) };
  if (injection) {
    const result = await sendNativeInjection(client, context.nativeInjection!, id, turnParams);
    return { threadId: id, turn: result.turn };
  }
  // The edit controller durably records each phase; the host verifies full history.
  if (!origin) await context.send?.sending();
  const result = origin ? await edit!(origin, (context.thread?.turns ?? []).map(turn => turn.id), turnParams)
    : await client.rpc<{ turn: TurnSummary }>('turn/start', turnParams, context.hostId);
  if (!origin && result.turn) await context.send?.confirmed(result.turn.id);
  return { threadId: id, turn: result.turn };
}
