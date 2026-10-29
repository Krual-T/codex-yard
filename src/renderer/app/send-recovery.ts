import type { ComposerDraft, SubmissionCollaborationMode, SubmitAction, SubmitOptions, WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { SendInjectionReference, SendInjectionStatus } from '../../native/send-injection.ts';
import { readBrowserAtom, updateBrowserAtoms } from '../storage/ui-atoms.ts';
import { assertBrowserDraftReferencesNotDeleted, browserCommentsAtomKey, ensureBrowserCommentStore } from '../browser/comments.ts';
import { sameComposerDraftValue } from '../composer/composer-draft-store.ts';
import { browserDraftOwner } from './browser-draft.ts';

export const sendsAtom = 'codex-yard.send-recovery.v1';
export interface SendOwner { hostId: string; threadId: string | null; draftId: string }
export interface SendVersion { owner: SendOwner; revision: string; documentPlainTextMode?: boolean }
export type SendStage = 'prepared' | 'creating' | 'ready' | 'sending' | 'unknown' | 'failed' | 'confirmed';
export interface SendInjectedInput {
  callId: string;
  input: Record<string, unknown>[];
  responseItems: Record<string, unknown>[];
}
export interface NativeInjectionRecord {
  reference: SendInjectionReference;
  turnParams: Record<string, unknown>;
  turnAttemptId?: string;
  turnGeneration?: string;
  /** A locally proven failure before the host request was sent. */
  beforeSend?: boolean;
  status?: SendInjectionStatus;
}
export interface SendIntent extends SendVersion {
  id: string;
  /** Preflight ownership changes on every explicit attempt, before any write. */
  attemptId?: string;
  clientUserMessageId: string;
  /** Older stored records represent ordinary sends. */
  action?: SubmitAction;
  threadId: string | null;
  cwd: string;
  projectId?: string;
  additionalContext?: Record<string, { kind: 'untrusted'; value: string }>;
  /** The captured Codex app context is injected once before this intent's turn. */
  injection?: SendInjectedInput & { phase: 'prepared' | 'sending' | 'confirmed' | 'unknown'; native?: NativeInjectionRecord };
  /** undefined is a legacy/unresolved request; null records an omitted override. */
  collaborationMode?: SubmissionCollaborationMode | null;
  /** Immutable submitted version, not another editable draft. */
  draft: ComposerDraft;
  options: SubmitOptions;
  overrides: Partial<SubmitOptions>;
  stage: SendStage;
  error?: string;
  turnId?: string;
  /** Only an actual thread/start response grants this empty-history phase. */
  created?: { thread: ThreadSummary; settings: SubmitOptions };
}
interface CreationReceipt { owner: SendOwner; thread: ThreadSummary; settings: SubmitOptions; projectId?: string | null }
export interface SendRecoverySnapshot { requests: Record<string, SendIntent>; bindings: Record<string, string>; creations: Record<string, CreationReceipt> }
interface Storage { read(): Promise<unknown>; update(change: (value: unknown, atoms?: Record<string, unknown>) => unknown): Promise<unknown> }
const browserStorage: Storage = { read: () => readBrowserAtom(sendsAtom), update: change => updateBrowserAtoms(atoms => {
  const value = change(atoms[sendsAtom], atoms);
  return { value, updates: { [sendsAtom]: value } };
}) };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stages: SendStage[] = ['prepared', 'creating', 'ready', 'sending', 'unknown', 'failed', 'confirmed'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= 4096 && !value.includes('\0');
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
function sameReference(a: SendInjectionReference, b: SendInjectionReference): boolean {
  return a.hostId === b.hostId && a.threadId === b.threadId && a.intentId === b.intentId
    && a.injectionAttemptId === b.injectionAttemptId && a.callId === b.callId
    && a.clientUserMessageId === b.clientUserMessageId && a.revision === b.revision
    && a.connectionGeneration === b.connectionGeneration && a.owner.hostId === b.owner.hostId
    && a.owner.threadId === b.owner.threadId && a.owner.draftId === b.owner.draftId;
}
function validReference(value: unknown): value is SendInjectionReference {
  return object(value) && Object.keys(value).length === 9 && object(value.owner) && Object.keys(value.owner).length === 3
    && nonempty(value.hostId) && nonempty(value.threadId)
    && nonempty(value.intentId) && nonempty(value.injectionAttemptId) && nonempty(value.callId)
    && nonempty(value.clientUserMessageId) && nonempty(value.revision) && nonempty(value.connectionGeneration)
    && value.owner.hostId === value.hostId && nonempty(value.owner.draftId)
    && (value.owner.threadId === null || value.owner.threadId === value.threadId);
}
function validNativeStatus(value: unknown, reference: SendInjectionReference): value is SendInjectionStatus {
  if (!object(value) || !only(value, ['reference', 'injection', 'turn', 'pendingPersistence'])
    || !validReference(value.reference) || !sameReference(value.reference, reference)
    || !object(value.injection) || !object(value.turn) || !Array.isArray(value.turn.attempts)
    || !only(value.injection, ['phase', 'persistentThread', 'terminal'])
    || !only(value.turn, ['phase', 'attemptId', 'attempts', 'connectionGeneration', 'terminal'])
    || !value.turn.attempts.every(nonempty) || new Set(value.turn.attempts).size !== value.turn.attempts.length
    || !['preparing', 'sending', 'unknown', 'injected', 'rejected', 'not-sent'].includes(String(value.injection.phase))
    || !['waiting', 'preparing', 'sending', 'unknown', 'accepted', 'rejected', 'not-sent'].includes(String(value.turn.phase))) return false;
  const terminalValid = (state: Record<string, unknown>) => {
    const phase = String(state.phase), terminal = state.terminal;
    if (['waiting', 'preparing', 'sending', 'unknown'].includes(phase)) return terminal === undefined;
    if (!object(terminal) || terminal.kind !== phase) return false;
    if (phase === 'injected') return only(terminal, ['kind']);
    if (phase === 'accepted') return only(terminal, ['kind', 'result']) && object(terminal.result) && object(terminal.result.turn) && nonempty(terminal.result.turn.id);
    if (phase === 'rejected') return only(terminal, ['kind', 'code'])
      && (nonempty(terminal.code) || typeof terminal.code === 'number' && Number.isSafeInteger(terminal.code));
    return only(terminal, ['kind', 'reason'])
      && ['original-changed', 'idle-unconfirmed', 'storage-failed', 'transport-unavailable', 'previous-owner-stopped'].includes(String(terminal.reason));
  };
  if (!terminalValid(value.injection) || !terminalValid(value.turn)
    || value.injection.phase !== 'injected' && value.turn.phase !== 'waiting'
    || (value.turn.phase === 'waiting' ? value.turn.attemptId !== undefined || value.turn.connectionGeneration !== undefined || value.turn.attempts.length !== 0
      : !nonempty(value.turn.attemptId) || value.turn.attempts.at(-1) !== value.turn.attemptId)
    || value.turn.connectionGeneration !== undefined && !nonempty(value.turn.connectionGeneration)
    || value.injection.persistentThread !== undefined && (value.injection.phase !== 'injected' || typeof value.injection.persistentThread !== 'boolean')) return false;
  if (value.pendingPersistence !== null) {
    if (!object(value.pendingPersistence) || !only(value.pendingPersistence, ['step', 'attemptId', 'terminal'])
      || !['injection', 'turn'].includes(String(value.pendingPersistence.step))
      || !nonempty(value.pendingPersistence.attemptId)
      || value.pendingPersistence.step === 'injection' && value.pendingPersistence.attemptId !== reference.injectionAttemptId
      || value.pendingPersistence.terminal !== null && !object(value.pendingPersistence.terminal)) return false;
  }
  return true;
}
function submittedIdentity(intent: SendIntent) {
  return { id: intent.id, attemptId: intent.attemptId, clientUserMessageId: intent.clientUserMessageId,
    owner: intent.owner, revision: intent.revision, documentPlainTextMode: intent.documentPlainTextMode,
    cwd: intent.cwd, projectId: intent.projectId, draft: intent.draft, options: intent.options,
    overrides: intent.overrides, action: intent.action, additionalContext: intent.additionalContext,
    injection: intent.injection && { callId: intent.injection.callId, input: intent.injection.input,
      responseItems: intent.injection.responseItems } };
}
export const sendOwnerKey = (owner: Pick<SendOwner, 'hostId' | 'draftId'>) => JSON.stringify([owner.hostId, owner.draftId]);
export const sendThreadKey = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);

function snapshot(value: unknown): SendRecoverySnapshot {
  if (value === undefined) return { requests: {}, bindings: {}, creations: {} };
  if (!object(value) || !object(value.requests) || !object(value.bindings)) throw new Error('发送恢复记录无法识别，原值已保留。');
  for (const [id, request] of Object.entries(value.requests)) {
    if (!object(request) || request.id !== id || typeof request.clientUserMessageId !== 'string' || !request.clientUserMessageId
      || !object(request.owner) || typeof request.owner.hostId !== 'string' || typeof request.owner.draftId !== 'string'
      || !(request.owner.threadId === null || typeof request.owner.threadId === 'string')
      || !(request.threadId === null || typeof request.threadId === 'string') || typeof request.revision !== 'string'
      || typeof request.cwd !== 'string' || !object(request.draft) || typeof request.draft.text !== 'string'
      || !Array.isArray(request.draft.images) || !Array.isArray(request.draft.files) || !object(request.options)
      || !object(request.overrides) || request.projectId !== undefined && typeof request.projectId !== 'string'
      || request.attemptId !== undefined && (typeof request.attemptId !== 'string' || !request.attemptId)
      || request.documentPlainTextMode !== undefined && typeof request.documentPlainTextMode !== 'boolean'
      || !stages.includes(request.stage as SendStage)) throw new Error('发送恢复内容无法安全读取，原值已保留。');
    if (request.additionalContext !== undefined && (!object(request.additionalContext)
      || Object.values(request.additionalContext).some(entry => !object(entry) || entry.kind !== 'untrusted' || typeof entry.value !== 'string'))) {
      throw new Error('发送上下文无法安全读取，原值已保留。');
    }
    if (request.injection !== undefined && (!object(request.injection) || typeof request.injection.callId !== 'string' || !request.injection.callId
      || !Array.isArray(request.injection.input) || !request.injection.input.length || !request.injection.input.every(object)
      || !Array.isArray(request.injection.responseItems) || !request.injection.responseItems.length || !request.injection.responseItems.every(object)
      || !['prepared', 'sending', 'confirmed', 'unknown'].includes(String(request.injection.phase))
      || object(request.action) && request.action.type !== 'send')) throw new Error('原注入上下文无法安全读取，原值已保留。');
    if (object(request.injection) && request.injection.native !== undefined) {
      const native = request.injection.native;
      if (!object(native) || !validReference(native.reference) || !object(native.turnParams)
        || native.reference.intentId !== id || native.reference.hostId !== request.owner.hostId
        || native.reference.threadId !== request.threadId || native.reference.revision !== request.revision
        || native.reference.clientUserMessageId !== request.clientUserMessageId || native.reference.callId !== request.injection.callId
        || native.reference.owner.hostId !== request.owner.hostId || native.reference.owner.threadId !== request.owner.threadId
        || native.reference.owner.draftId !== request.owner.draftId || native.turnParams.threadId !== request.threadId
        || native.turnParams.clientUserMessageId !== request.clientUserMessageId || !same(native.turnParams.input, request.injection.input)
        || native.turnAttemptId !== undefined && (!nonempty(native.turnAttemptId) || !nonempty(native.turnGeneration))
        || native.turnAttemptId === undefined && native.turnGeneration !== undefined
        || native.beforeSend !== undefined && typeof native.beforeSend !== 'boolean'
        || native.status !== undefined && !validNativeStatus(native.status, native.reference)) {
        throw new Error('原宿主注入记录无法安全读取，原值已保留。');
      }
    }
    if (request.action !== undefined && (!object(request.action) || !['send', 'queue', 'steer'].includes(String(request.action.type))
      || request.action.type === 'steer' && (typeof request.action.turnId !== 'string' || !request.action.turnId))) {
      throw new Error('提交动作无法安全读取，原值已保留。');
    }
    if (request.collaborationMode !== undefined && request.collaborationMode !== null
      && (!object(request.collaborationMode) || !['plan', 'default'].includes(String(request.collaborationMode.mode))
        || !object(request.collaborationMode.settings) || typeof request.collaborationMode.settings.model !== 'string' || !request.collaborationMode.settings.model
        || !(request.collaborationMode.settings.reasoning_effort === null || typeof request.collaborationMode.settings.reasoning_effort === 'string')
        || request.collaborationMode.settings.developer_instructions !== null)) throw new Error('模式请求无法安全读取，原值已保留。');
    if (request.created !== undefined && (!object(request.created) || !object(request.created.thread)
      || request.created.thread.id !== request.threadId || !object(request.created.settings))) throw new Error('新会话创建回执无效，原值已保留。');
  }
  if (Object.values(value.bindings).some(id => typeof id !== 'string')) throw new Error('发送草稿身份记录无效，原值已保留。');
  const creations = value.creations ?? {};
  if (!object(creations) || Object.entries(creations).some(([key, receipt]) => !object(receipt) || !object(receipt.owner)
    || typeof receipt.owner.hostId !== 'string' || typeof receipt.owner.draftId !== 'string' || receipt.owner.threadId !== null
    || !object(receipt.thread) || typeof receipt.thread.id !== 'string' || key !== sendThreadKey(receipt.owner.hostId, receipt.thread.id)
    || !object(receipt.settings) || Object.hasOwn(receipt, 'projectId') && receipt.projectId !== null
      && (typeof receipt.projectId !== 'string' || !receipt.projectId))) throw new Error('新会话阶段记录无效，原值已保留。');
  return structuredClone({ ...value, creations }) as unknown as SendRecoverySnapshot;
}

/** Keeps one request identity across route changes, reload and uncertain replies. */
export class SendRecoveryStore {
  private readonly client: WorkbenchClient;
  private readonly storage: Storage;
  /** Only an already received injection success awaiting its local atom commit. */
  private readonly confirmedInjections = new Set<string>();
  constructor(client: WorkbenchClient, storage: Storage = browserStorage) {
    this.client = client;
    this.storage = storage;
  }
  async read() { return snapshot(await this.storage.read()); }
  hasConfirmedInjectionReceipt(intent: SendIntent): boolean {
    return !!intent.attemptId && !!intent.injection && ['sending', 'unknown'].includes(intent.injection.phase)
      && this.confirmedInjections.has(JSON.stringify([intent.id, intent.attemptId]));
  }
  private async change(update: (value: SendRecoverySnapshot, atoms?: Record<string, unknown>) => void): Promise<SendRecoverySnapshot> {
    let result!: SendRecoverySnapshot;
    await this.storage.update((value, atoms) => { result = snapshot(value); update(result, atoms); return result; });
    return result;
  }
  async prepare(version: SendVersion, cwd: string, draft: ComposerDraft, options: SubmitOptions, overrides: Partial<SubmitOptions>, projectId?: string,
    additionalContext?: SendIntent['additionalContext'], action: SubmitAction = { type: 'send' }, injectedInput?: SendInjectedInput) {
    if (injectedInput && action.type !== 'send') throw new Error('此 app 上下文须在会话空闲时发送，不能排队或追加当前任务。');
    const intent: SendIntent & { attemptId: string } = { ...structuredClone(version), id: crypto.randomUUID(), attemptId: crypto.randomUUID(), clientUserMessageId: crypto.randomUUID(),
      threadId: version.owner.threadId, cwd, draft: structuredClone(draft), options: structuredClone(options), action: structuredClone(action),
      overrides: structuredClone(overrides), stage: 'prepared', ...(projectId ? { projectId } : {}),
      additionalContext: structuredClone(additionalContext ?? {}),
      ...(injectedInput ? { injection: { ...structuredClone(injectedInput), phase: 'prepared' as const } } : {}) };
    const hasBrowserReferences = (draft.references ?? []).some(reference => reference.kind === 'browser');
    if (hasBrowserReferences) await ensureBrowserCommentStore();
    await this.change((state, atoms) => {
      if (hasBrowserReferences) {
        if (!atoms) throw new Error('无法在发送事务中核对浏览器引用，原草稿已保留。');
        assertBrowserDraftReferencesNotDeleted(atoms[browserCommentsAtomKey], browserDraftOwner(version.owner, state.bindings), draft);
      }
      if (Object.values(state.requests).some(value => sendOwnerKey(value.owner) === sendOwnerKey(version.owner))) {
        throw new Error('此草稿还有待核对的发送结果，请先处理恢复记录。');
      }
      state.requests[intent.id] = intent;
    });
    return intent;
  }
  private async update(id: string, change: (intent: SendIntent, state: SendRecoverySnapshot) => void) {
    const state = await this.change(value => {
      const intent = value.requests[id];
      if (!intent) throw new Error('发送恢复记录已在另一页面处理，请刷新核对。');
      change(intent, value);
    });
    return state.requests[id]!;
  }
  /** An old preflight may finish later, but cannot retain authority to write. */
  attempt(id: string) { return this.update(id, intent => {
    if (!['prepared', 'ready', 'failed'].includes(intent.stage) || intent.injection && ['sending', 'unknown'].includes(intent.injection.phase)
      || intent.injection?.native?.status?.pendingPersistence) {
      throw new Error('原发送结果尚未核对，未重复发送。');
    }
    intent.attemptId = crypto.randomUUID();
  }); }
  private assertAttempt(intent: SendIntent, attemptId: string | undefined) {
    if (!attemptId || intent.attemptId !== attemptId) throw new Error('原发送尝试已被另一页面处理，未重复写入。');
  }
  creating(id: string, attemptId: string | undefined) { return this.update(id, intent => {
    this.assertAttempt(intent, attemptId);
    if (!['prepared', 'failed'].includes(intent.stage) || intent.threadId) throw new Error('会话创建阶段已改变，未重复创建。');
    intent.stage = 'creating';
  }); }
  created(id: string, threadId: string, created: SendIntent['created'] | undefined, attemptId: string | undefined) { return this.update(id, (intent, state) => {
    this.assertAttempt(intent, attemptId);
    if (intent.stage !== 'creating' || !threadId || intent.threadId) throw new Error('会话创建身份已改变，请核对原请求。');
    const key = sendThreadKey(intent.owner.hostId, threadId), previous = state.bindings[key];
    if (previous !== undefined && previous !== intent.owner.draftId) throw new Error('新会话已关联另一草稿，原记录已保留。');
    state.bindings[key] = intent.owner.draftId;
    intent.threadId = threadId; intent.stage = 'ready';
    if (created) {
      intent.created = structuredClone(created);
      state.creations[key] = structuredClone({ ...created, owner: intent.owner, projectId: intent.projectId ?? null });
    }
  }); }
  sending(id: string, attemptId: string | undefined) { return this.update(id, intent => {
    this.assertAttempt(intent, attemptId);
    if (intent.injection?.native) throw new Error('原上下文发送必须经宿主围栏处理。');
    if (intent.injection && intent.injection.phase !== 'confirmed') throw new Error('原 app 上下文尚未确认，未发送消息。');
    if (!intent.threadId || !['prepared', 'ready', 'failed'].includes(intent.stage)) throw new Error('发送阶段尚未核对，未重复发送。');
    intent.stage = 'sending'; delete intent.error;
  }); }
  injecting(id: string, attemptId: string | undefined) { return this.update(id, intent => {
    this.assertAttempt(intent, attemptId);
    if (intent.injection?.native) throw new Error('原上下文注入必须经宿主围栏处理。');
    if (!intent.threadId || !intent.injection || intent.injection.phase !== 'prepared'
      || !['prepared', 'ready', 'failed'].includes(intent.stage)) throw new Error('原上下文注入阶段尚未核对，未重复注入。');
    intent.injection.phase = 'sending'; delete intent.error;
  }); }
  async injected(id: string, attemptId: string | undefined) {
    if (!attemptId) throw new Error('原上下文注入回执缺少发送尝试身份。');
    const receipt = JSON.stringify([id, attemptId]);
    this.confirmedInjections.add(receipt);
    const result = await this.update(id, intent => {
      this.assertAttempt(intent, attemptId);
      if (intent.injection?.native) {
        this.confirmedInjections.delete(receipt);
        throw new Error('原上下文注入必须核对宿主状态。');
      }
      if (!intent.injection || !['sending', 'unknown', 'confirmed'].includes(intent.injection.phase)) throw new Error('原上下文注入回执无法关联，原记录已保留。');
      intent.injection.phase = 'confirmed';
      if (intent.stage === 'unknown') {
        intent.stage = 'failed'; intent.error = '原 app 上下文已确认，消息尚未发送；可继续原发送，无需再次注入。';
      }
    });
    this.confirmedInjections.delete(receipt);
    return result;
  }
  injectionFailed(id: string, error: unknown, attemptId: string | undefined) { return this.update(id, intent => {
    if (intent.injection?.native) return;
    if (!attemptId || intent.attemptId !== attemptId || !intent.injection || intent.injection.phase !== 'sending') return;
    // Called only around the actual RPC: an explicit protocol rejection or a
    // synchronous transport before-send error cannot have committed injection.
    const rejected = object(error) && (error.sendPhase === 'before-send'
      || error.uncertain === false && [-32600, -32601, -32602].includes(Number(error.code)));
    intent.injection.phase = rejected ? 'prepared' : 'unknown';
    if (rejected && intent.stage === 'unknown') intent.stage = 'failed';
    intent.error = error instanceof Error ? error.message : String(error);
  }); }
  resolvedCollaboration(id: string, mode: SubmissionCollaborationMode | null, attemptId: string | undefined) {
    return this.update(id, intent => {
      this.assertAttempt(intent, attemptId);
      if (!['prepared', 'ready', 'failed'].includes(intent.stage)) throw new Error('发送阶段已改变，模式请求未重写。');
      if (intent.collaborationMode !== undefined && JSON.stringify(intent.collaborationMode) !== JSON.stringify(mode)) {
        throw new Error('原提交模式已确定，未替换原请求。');
      }
      intent.collaborationMode = structuredClone(mode);
    });
  }
  /** Reserve the exact payload in the existing recovery atom before any host write. */
  reserveNativeInjection(expected: SendIntent, threadId: string, turnParams: Record<string, unknown>, generation: string) {
    return this.update(expected.id, (intent, state) => {
      this.assertAttempt(intent, expected.attemptId);
      if (!same(submittedIdentity(intent), submittedIdentity(expected)) || !nonempty(generation)
        || intent.threadId !== threadId || !intent.injection || intent.injection.phase !== 'prepared'
        || intent.owner.threadId === null && state.bindings[sendThreadKey(intent.owner.hostId, threadId)] !== intent.owner.draftId
        || !['prepared', 'ready', 'failed'].includes(intent.stage)) throw new Error('原注入版本或目标已改变，未发送。');
      const previous = intent.injection.native;
      if (previous && !previous.beforeSend && (previous.status?.pendingPersistence
        || !previous.status || !['rejected', 'not-sent'].includes(previous.status.injection.phase))) {
        throw new Error('原注入结果尚未确认，未重复注入。');
      }
      const originalParams = previous?.turnParams ?? turnParams;
      if (originalParams.threadId !== threadId || originalParams.clientUserMessageId !== intent.clientUserMessageId
        || !same(originalParams.input, intent.injection.input)) throw new Error('原消息参数无法核对，未发送。');
      const reference: SendInjectionReference = { hostId: intent.owner.hostId, threadId, intentId: intent.id,
        injectionAttemptId: crypto.randomUUID(), callId: intent.injection.callId, clientUserMessageId: intent.clientUserMessageId,
        owner: structuredClone(intent.owner), revision: intent.revision, connectionGeneration: generation };
      intent.injection.native = { reference, turnParams: structuredClone(originalParams) };
      intent.injection.phase = 'sending'; intent.stage = 'sending'; delete intent.error;
    });
  }
  /** A retry gets a fresh turn attempt, but retains the original injected payload. */
  reserveNativeTurn(expected: SendIntent, generation: string) {
    return this.update(expected.id, intent => {
      this.assertAttempt(intent, expected.attemptId);
      const native = intent.injection?.native, status = native?.status;
      if (!same(submittedIdentity(intent), submittedIdentity(expected)) || !native || !status
        || intent.injection?.phase !== 'confirmed' || status.injection.phase !== 'injected' || status.pendingPersistence
        || !['waiting', 'not-sent', 'rejected'].includes(status.turn.phase)
        || !intent.attemptId || !nonempty(generation) || status.turn.attempts.includes(intent.attemptId)
        || !['prepared', 'ready', 'failed'].includes(intent.stage)) throw new Error('原上下文或消息状态尚未确认，未发送。');
      native.turnAttemptId = intent.attemptId; native.turnGeneration = generation; delete native.beforeSend;
      intent.stage = 'sending'; delete intent.error;
    });
  }
  /** A host result may only change the exact browser record that requested it. */
  applyNativeStatus(id: string, expected: NativeInjectionRecord, result: unknown) {
    if (result !== null && !validNativeStatus(result, expected.reference)) throw new Error('原宿主状态身份或内容无效，原请求已保留。');
    return this.update(id, (intent, state) => {
      const native = intent.injection?.native;
      if (!native || !same(native, expected)) return;
      if (result === null) {
        if (native.beforeSend) return;
        intent.injection!.phase = native.status?.injection.phase === 'injected' ? 'confirmed' : 'unknown';
        intent.stage = 'unknown'; intent.error = '原宿主尚无可核对状态，结果仍未知；不会重复发送。';
        return;
      }
      const pendingTurn = result.pendingPersistence?.step === 'turn' && result.pendingPersistence.attemptId === native.turnAttemptId;
      if (result.pendingPersistence?.step === 'turn' && !pendingTurn) return;
      const priorTurn = pendingTurn && ['waiting', 'not-sent', 'rejected'].includes(result.turn.phase)
        && !result.turn.attempts.includes(native.turnAttemptId!);
      if (result.turn.phase !== 'waiting' && !priorTurn && (result.turn.attemptId !== native.turnAttemptId
        || (result.turn.connectionGeneration ?? result.reference.connectionGeneration) !== native.turnGeneration)) return;
      // Waiting can race a browser request that has been reserved locally but
      // has not reached the host. Only a proven before-send failure releases it.
      const waitingInFlight = result.turn.phase === 'waiting' && !!native.turnAttemptId && !native.beforeSend;
      native.status = structuredClone(result);
      if (result.turn.phase !== 'waiting' || !native.turnAttemptId) delete native.beforeSend;
      const pending = !!result.pendingPersistence;
      if (result.injection.phase === 'injected' && !(pending && result.pendingPersistence?.step === 'injection')) {
        intent.injection!.phase = 'confirmed';
      } else if (!pending && ['rejected', 'not-sent'].includes(result.injection.phase)) {
        intent.injection!.phase = 'prepared';
      } else intent.injection!.phase = 'unknown';
      if (!pending && result.turn.phase === 'accepted' && result.turn.terminal?.kind === 'accepted') {
        const turn = result.turn.terminal.result.turn;
        if (!object(turn) || !nonempty(turn.id)) throw new Error('原发送回执无效，原稿已保留。');
        intent.stage = 'confirmed'; intent.turnId = turn.id; delete intent.error;
        delete state.creations[sendThreadKey(intent.owner.hostId, result.reference.threadId)];
      } else if (!pending && !waitingInFlight && (['rejected', 'not-sent'].includes(result.injection.phase)
        || result.injection.phase === 'injected' && ['waiting', 'rejected', 'not-sent'].includes(result.turn.phase))) {
        intent.stage = 'failed'; intent.error = result.injection.phase === 'injected'
          ? '原上下文已确认；可显式继续原消息。' : '原上下文未注入；可显式重试原发送。';
      } else {
        intent.stage = 'unknown'; intent.error = pending ? '原宿主回执尚未持久保存，请先补存。' : '原发送结果尚未确认，不会重复发送。';
      }
    });
  }
  nativeHostFailure(id: string, expected: NativeInjectionRecord, step: 'injection' | 'turn', error: unknown) {
    return this.update(id, intent => {
      const native = intent.injection?.native;
      if (!native || !same(native, expected)) return;
      const beforeSend = object(error) && error.sendPhase === 'before-send';
      if (beforeSend) {
        native.beforeSend = true; intent.stage = 'failed';
        intent.injection!.phase = step === 'injection' ? 'prepared' : 'confirmed';
      } else {
        intent.injection!.phase = step === 'injection' ? 'unknown' : 'confirmed'; intent.stage = 'unknown';
      }
      intent.error = error instanceof Error ? error.message : String(error);
    });
  }
  private async queryNative(id: string, native: NativeInjectionRecord) {
    const result = await this.client.host<unknown>('send-injection', { action: 'status', hostId: native.reference.hostId, reference: native.reference });
    return this.applyNativeStatus(id, native, result);
  }
  async retryNativePersistence(id: string) {
    const intent = (await this.read()).requests[id], native = intent?.injection?.native, receipt = native?.status?.pendingPersistence;
    if (!native || !receipt) throw new Error('没有可补存的原宿主回执，请先核对状态。');
    const result = await this.client.host<unknown>('send-injection', { action: 'retryPersistence', hostId: native.reference.hostId,
      reference: native.reference, receipt: { step: receipt.step, attemptId: receipt.attemptId } });
    return this.applyNativeStatus(id, native, result);
  }
  /** Notifications are hints only; matching references are checked with the host. */
  async checkNativeHint(event: WorkbenchEvent): Promise<SendIntent | null> {
    if (event.type !== 'send-injection-updated' || !validReference(event.reference) || !object(event.receipt)
      || !['injection', 'turn'].includes(String(event.receipt.step)) || !nonempty(event.receipt.attemptId)) return null;
    const intent = (await this.read()).requests[event.reference.intentId], native = intent?.injection?.native;
    if (!native || !sameReference(native.reference, event.reference)
      || (event.receipt.step === 'injection' ? event.receipt.attemptId !== native.reference.injectionAttemptId
        : event.receipt.attemptId !== native.turnAttemptId)) return null;
    return this.queryNative(intent.id, native);
  }
  failed(id: string, error: unknown, attemptId: string | undefined) { return this.update(id, intent => {
    // A prior page's error cannot downgrade the new attempt or a known success.
    if (!attemptId || intent.attemptId !== attemptId || intent.stage === 'confirmed') return;
    const uncertain = intent.injection?.native && (intent.stage === 'unknown' || !!intent.injection.native.status?.pendingPersistence)
      || intent.injection && ['sending', 'unknown'].includes(intent.injection.phase)
      || ['creating', 'sending', 'unknown'].includes(intent.stage) && (!object(error) || error.uncertain !== false);
    intent.stage = uncertain ? 'unknown' : 'failed';
    intent.error = error instanceof Error ? error.message : String(error);
  }); }
  confirmed(id: string, turnId: string, attemptId: string | undefined) { return this.update(id, (intent, state) => {
    this.assertAttempt(intent, attemptId);
    if (intent.injection?.native) throw new Error('原上下文发送必须核对宿主状态。');
    if (intent.stage === 'confirmed') return;
    if (!['sending', 'unknown'].includes(intent.stage)) throw new Error('原请求尚未发出，未清理提交版本。');
    if (!intent.threadId || !turnId) throw new Error('缺少已发送消息身份，草稿已保留。');
    intent.stage = 'confirmed'; intent.turnId = turnId; delete intent.error;
    delete state.creations[sendThreadKey(intent.owner.hostId, intent.threadId)];
  }); }
  queued(id: string, queuedSubmissionId: string, attemptId: string | undefined) { return this.update(id, intent => {
    this.assertAttempt(intent, attemptId);
    if (intent.stage === 'confirmed') return;
    if (intent.action?.type !== 'queue' || !intent.threadId || typeof queuedSubmissionId !== 'string' || !queuedSubmissionId || !['sending', 'unknown'].includes(intent.stage)) {
      throw new Error('队列提交身份无法确认，原稿已保留。');
    }
    intent.stage = 'confirmed'; delete intent.error;
  }); }
  async check(id: string) {
    const intent = (await this.read()).requests[id];
    if (!intent) throw new Error('发送恢复记录已处理。');
    if (intent.injection?.native) return this.queryNative(id, intent.injection.native);
    if (intent.attemptId && this.confirmedInjections.has(JSON.stringify([id, intent.attemptId]))) return this.injected(id, intent.attemptId);
    if (intent.injection && ['sending', 'unknown'].includes(intent.injection.phase)) return this.update(id, current => {
      if (current.attemptId !== intent.attemptId || current.injection?.phase !== intent.injection!.phase) return;
      current.injection.phase = 'unknown'; current.stage = 'unknown';
      current.error = '原 app 上下文注入结果仍未知，原内容已保留；不会重新注入或发送消息。';
    });
    if (!['creating', 'sending', 'unknown'].includes(intent.stage)) return intent;
    if (!intent.threadId) throw new Error('创建会话的结果尚未确认。请核对会话列表；不会重新创建或发送。');
    const result = await this.client.host<{ turnId: string | null; queuedSubmissionId?: string | null }>('message-send-status', {
      hostId: intent.owner.hostId, threadId: intent.threadId, clientUserMessageId: intent.clientUserMessageId,
      action: intent.action?.type ?? 'send',
    });
    if (!object(result) || !(result.turnId === null || typeof result.turnId === 'string' && !!result.turnId)
      || result.queuedSubmissionId !== undefined && result.queuedSubmissionId !== null
        && (typeof result.queuedSubmissionId !== 'string' || !result.queuedSubmissionId)) {
      throw new Error('提交核对回执无效，原请求状态已保留。');
    }
    if (intent.action?.type === 'steer' && result.turnId !== null && result.turnId !== intent.action.turnId) {
      throw new Error('原请求出现在不同任务，结果尚不能确认，原稿已保留。');
    }
    return this.update(id, (current, state) => {
      if (current.attemptId !== intent.attemptId || current.stage !== intent.stage) return;
      if (result.turnId) {
        current.stage = 'confirmed'; current.turnId = result.turnId; delete current.error;
        delete state.creations[sendThreadKey(current.owner.hostId, current.threadId!)];
      } else if (intent.action?.type === 'queue' && result.queuedSubmissionId) {
        current.stage = 'confirmed'; delete current.error;
      } else {
        current.stage = 'unknown'; current.error = '完整历史尚未找到原请求；结果仍未知，原稿已保留，不会重发。';
      }
    });
  }
  /** Caller has cleared exactly this submitted revision, or explicitly retained it. */
  async dismiss(id: string, expected: SendVersion) {
    await this.change(state => {
      const intent = state.requests[id];
      if (!intent) return;
      if (intent.stage !== 'confirmed' || sendOwnerKey(intent.owner) !== sendOwnerKey(expected.owner)
        || intent.revision !== expected.revision) throw new Error('发送结果或版本尚未确认，原记录已保留。');
      delete state.requests[id];
    });
  }
  private cancelInState(state: SendRecoverySnapshot, intent: SendIntent) {
    if (!['prepared', 'ready', 'failed'].includes(intent.stage) || intent.injection && intent.injection.phase !== 'prepared'
      || intent.injection?.native?.status?.pendingPersistence) {
      throw new Error('发送或上下文注入结果尚未核对，恢复记录已保留。');
    }
    if (intent.threadId) {
      const key = sendThreadKey(intent.owner.hostId, intent.threadId), receipt = state.creations[key];
      if (receipt) {
        if (sendOwnerKey(receipt.owner) !== sendOwnerKey(intent.owner) || state.bindings[key] !== intent.owner.draftId
          || receipt.thread.id !== intent.threadId || intent.created && (JSON.stringify(intent.created.thread) !== JSON.stringify(receipt.thread)
            || JSON.stringify(intent.created.settings) !== JSON.stringify(receipt.settings))
          || Object.hasOwn(receipt, 'projectId') && receipt.projectId !== (intent.projectId ?? null)) {
          throw new Error('新会话原项目或创建回执已改变，恢复记录已保留。');
        }
        // Older receipts need the still-matching intent's original project
        // before cancellation removes its only durable source.
        if (!Object.hasOwn(receipt, 'projectId')) receipt.projectId = intent.projectId ?? null;
      } else if (intent.created) throw new Error('新会话创建回执无法核对，恢复记录已保留。');
    }
    delete state.requests[intent.id];
  }
  /** Explicitly cancel only a request whose write has not started or was rejected. */
  async cancel(id: string) {
    await this.change(state => {
      const intent = state.requests[id];
      if (intent) this.cancelInState(state, intent);
    });
  }
  /** Cancel only the complete original snapshot under its synchronous owner guard. */
  async cancelOriginal(expected: SendIntent, assertCurrent: () => void): Promise<void> {
    const captured = structuredClone(expected);
    if (!captured || !nonempty(captured.id) || typeof assertCurrent !== 'function') throw new Error('原发送身份或权限无效，未取消。');
    await this.change(state => {
      const current = state.requests[captured.id];
      if (!current) throw new Error('原发送记录已不存在，请重新读取核对。');
      if (!sameComposerDraftValue(current, captured)) throw new Error('原发送记录已改变，请重新读取核对。');
      const asserted: unknown = assertCurrent();
      if (asserted !== undefined) {
        if (asserted && (typeof asserted === 'object' || typeof asserted === 'function')
          && 'then' in asserted && typeof asserted.then === 'function') void Promise.resolve(asserted).catch(() => {});
        throw new Error('原取消权限必须同步核对，未取消。');
      }
      if ([...this.confirmedInjections].some(receipt => (JSON.parse(receipt) as unknown[])[0] === current.id)) {
        throw new Error('原注入成功回执尚未保存，恢复记录已保留。');
      }
      const native = current.injection?.native;
      if (native && !(native.turnAttemptId === undefined && (native.beforeSend === true && !native.status
        || native.status && !native.status.pendingPersistence && ['rejected', 'not-sent'].includes(native.status.injection.phase)))) {
        throw new Error('原宿主注入结果尚未核对，恢复记录已保留。');
      }
      this.cancelInState(state, current);
    });
  }
}
