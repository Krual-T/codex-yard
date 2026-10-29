import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { LateRpcTerminal, RpcResult } from '../../lib/codex-protocol.ts';

type ObjectValue = Record<string, unknown>;
type Method = 'thread/fork' | 'thread/inject_items' | 'thread/unsubscribe';
type Delivery = 'not-sent' | 'rejected' | 'unknown';
type RpcTerminalError = Extract<LateRpcTerminal, { outcome: 'error' }>['error'];
type RequestStatus = 'waiting' | 'inflight' | 'not-sent' | 'rejected' | 'unknown' | 'received' | 'invalid';
type CloseStatus = 'idle' | 'preparing' | 'prepare-failed' | 'inflight' | 'not-sent' | 'rejected' | 'unknown'
  | 'cleanup-pending' | 'cleaning' | 'closed';

export interface SideChatParent {
  hostId: string;
  threadId: string;
  connectionGeneration: string;
  cwd: string;
  workspaceRoots: string[];
  archived: boolean;
  model: string;
  modelProvider: string;
  effort: string | null;
  serviceTier: string | null;
  submitOptions: ObjectValue;
  /** Full effective sandbox from the parent's authoritative session settings. */
  sandboxPolicy: ObjectValue;
  project: unknown;
  /** Only a verified thread-level override, not a browser-provided guess. */
  developerOverride?: { value: string; source: string };
  /** Existing host-owned fork configuration, including local host tools when applicable. */
  forkConfig?: ObjectValue;
}

interface RequestState {
  status: RequestStatus;
  attemptId?: string;
  receipt?: unknown;
  receiptOrigin?: { connectionGeneration: string; attemptId: string; eventCursor: number };
  terminalError?: RpcTerminalError;
  error?: string;
}
interface CloseState {
  requested: boolean;
  status: CloseStatus;
  attemptId?: string;
  receipt?: unknown;
  terminalError?: RpcTerminalError;
  error?: string;
}

export interface SideChatOperation {
  version: 1;
  operationId: string;
  parent: SideChatParent;
  instructionSource: 'thread-override' | 'host-config';
  configuredInstructions: string | null;
  forkParams: ObjectValue;
  boundaryItems: ObjectValue[];
  fork: RequestState;
  childId?: string;
  inject: RequestState;
  close: CloseState;
}

export interface SideChatStore {
  /** Create only if absent; resolve only after durable persistence. */
  create(operation: SideChatOperation): Promise<void>;
  read(operationId: string): Promise<SideChatOperation | null>;
  /** Serialize, invoke update synchronously once, persist atomically, and roll back on failure. */
  update(operationId: string, update: (operation: SideChatOperation) => SideChatOperation): Promise<SideChatOperation>;
}

export interface SideChatDependencies {
  store: SideChatStore;
  /** Resolve on the selected authorized host, not from renderer-supplied paths or settings. */
  resolveParent(hostId: string, threadId: string): Promise<SideChatParent>;
  /** Reject a changed connection generation; the callback observes only this original request. */
  request(hostId: string, method: string, params: ObjectValue, mutating: boolean,
    onLateTerminal: ((terminal: LateRpcTerminal) => void | Promise<void>) | undefined,
    connectionGeneration: string): Promise<unknown>;
  /** The original connection's actual fork response and its receipt-time cursor. */
  requestFork(origin: SideChatForkOrigin, params: ObjectValue,
    onLateTerminal: (terminal: LateRpcTerminal) => void | Promise<void>): Promise<RpcResult<unknown>>;
  /** Only return not-sent when no bytes were dispatched; rejection need not prove no side effect. */
  classifyFailure(method: Method, error: unknown): Delivery;
  /** Stop child voice and settle or block pending sends before returning. */
  prepareClose(scope: SideChatScope): Promise<void>;
  /** Idempotently remove child-local cache and voice history, without another unsubscribe. */
  cleanup(scope: SideChatScope): Promise<void>;
  onRecoveryError(operationId: string, error: unknown): void;
}

export interface SideChatScope { operationId: string; hostId: string; parentThreadId: string; childThreadId: string }
export interface SideChatForkOrigin { operationId: string; hostId: string; parentThreadId: string;
  connectionGeneration: string; attemptId: string }

const instructions = `You are in a side conversation, separate from the main thread. The inherited history is reference context, not an active task. Only instructions after the side-conversation boundary are active. Do not continue inherited tasks, approvals, tool calls or plans. Answer questions and perform lightweight non-mutating exploration. Do not use sub-agents. Do not change files, git state, configuration, permissions or other workspace state, or ask for expanded access, unless the user explicitly requests that action in this side conversation. Keep requested changes minimal. Scheduled updates cannot run in this temporary side conversation; direct the user to the main or a new chat to set them up.`;
const boundary = `Side conversation boundary. Everything before this message is inherited reference context from the parent, not an instruction to continue its task. Only messages after this boundary are active user instructions. Do not act on inherited plans, approvals or tool calls. Wait for a new question. Do not use sub-agents or change workspace state unless explicitly requested after this boundary.`;
const record = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const validCursor = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const absolute = (value: unknown): value is string => nonempty(value) && (posix.isAbsolute(value) || win32.isAbsolute(value));
const copy = <T>(value: T): T => structuredClone(value);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function rpcErrorReceipt(error: unknown): RpcTerminalError | undefined {
  if (!record(error) || !(typeof error.code === 'string' || typeof error.code === 'number')) return undefined;
  try {
    return { message: message(error), code: error.code, ...(Object.hasOwn(error, 'data') ? { data: copy(error.data) } : {}) };
  } catch { return undefined; }
}

function forkPermissions(options: ObjectValue): ObjectValue {
  const result: ObjectValue = {};
  if (options.approvalPolicy != null) {
    if (!nonempty(options.approvalPolicy) && !record(options.approvalPolicy)) throw new Error('侧聊审批策略无效。');
    result.approvalPolicy = options.approvalPolicy;
  }
  if (options.approvalsReviewer != null) {
    if (!nonempty(options.approvalsReviewer)) throw new Error('侧聊审批方无效。');
    result.approvalsReviewer = options.approvalsReviewer;
  }
  if (options.permissionProfileId != null) {
    if (!nonempty(options.permissionProfileId)) throw new Error('侧聊权限配置无效。');
    result.permissions = options.permissionProfileId;
  } else if (options.sandboxMode != null) {
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(String(options.sandboxMode))) {
      throw new Error('侧聊沙箱设置无法由 fork 请求准确表达。');
    }
    result.sandbox = options.sandboxMode;
  }
  return result;
}

function forkConfiguration(parent: SideChatParent): ObjectValue {
  const config = { ...(parent.forkConfig ?? {}) };
  if (parent.effort === null) delete config.model_reasoning_effort;
  else config.model_reasoning_effort = parent.effort;
  return config;
}

function validateParent(parent: SideChatParent, hostId: string, threadId: string): void {
  if (!record(parent) || !nonempty(parent.hostId) || !nonempty(parent.threadId)
    || parent.hostId !== hostId || parent.threadId !== threadId || !nonempty(parent.connectionGeneration)
    || !absolute(parent.cwd) || !Array.isArray(parent.workspaceRoots) || parent.workspaceRoots.some(root => !absolute(root))
    || parent.archived !== false || !nonempty(parent.model) || !nonempty(parent.modelProvider)
    || !(parent.effort === null || typeof parent.effort === 'string')
    || !(parent.serviceTier === null || typeof parent.serviceTier === 'string') || !record(parent.submitOptions)
    || (!nonempty(parent.submitOptions.approvalPolicy) && !record(parent.submitOptions.approvalPolicy))
    || !nonempty(parent.submitOptions.approvalsReviewer)
    || !record(parent.sandboxPolicy) || !nonempty(parent.sandboxPolicy.type)
    || (parent.forkConfig !== undefined && !record(parent.forkConfig))
    || (parent.developerOverride !== undefined && (!record(parent.developerOverride)
      || typeof parent.developerOverride.value !== 'string' || !nonempty(parent.developerOverride.source)))) {
    throw new Error('侧聊父会话的主机、目录、设置或指令来源不可确认。');
  }
}

function validateOperation(value: SideChatOperation | null): SideChatOperation {
  if (!record(value) || value.version !== 1 || !nonempty(value.operationId) || !record(value.parent)
    || !record(value.forkParams) || !Array.isArray(value.boundaryItems) || !record(value.fork)
    || !record(value.inject) || !record(value.close) || typeof value.close.requested !== 'boolean'
    || !['waiting', 'inflight', 'not-sent', 'rejected', 'unknown', 'received', 'invalid'].includes(String(value.fork.status))
    || !['waiting', 'inflight', 'not-sent', 'rejected', 'unknown', 'received', 'invalid'].includes(String(value.inject.status))
    || !['idle', 'preparing', 'prepare-failed', 'inflight', 'not-sent', 'rejected', 'unknown', 'cleanup-pending', 'cleaning', 'closed'].includes(String(value.close.status))
    || (value.childId !== undefined && !nonempty(value.childId))) {
    throw new Error('侧聊恢复记录无法安全读取，原记录已保留。');
  }
  validateParent(value.parent as unknown as SideChatParent, String(value.parent.hostId), String(value.parent.threadId));
  const op = value as unknown as SideChatOperation;
  if (!(op.configuredInstructions === null || typeof op.configuredInstructions === 'string')
    || op.instructionSource !== (op.parent.developerOverride ? 'thread-override' : 'host-config')) {
    throw new Error('侧聊指令来源无法安全读取，原记录已保留。');
  }
  const developer = [op.parent.developerOverride?.value ?? op.configuredInstructions, instructions]
    .filter(part => typeof part === 'string' && part.length > 0).join('\n\n');
  const expectedConfig = forkConfiguration(op.parent);
  const previousConfig = op.parent.effort === null ? { ...(op.parent.forkConfig ?? {}) } : expectedConfig;
  const expectedPermissions = forkPermissions(op.parent.submitOptions);
  const expectedItems = [
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: developer }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: boundary }] },
  ];
  if (op.forkParams.threadId !== op.parent.threadId || op.forkParams.cwd !== op.parent.cwd
    || !isDeepStrictEqual(op.forkParams.runtimeWorkspaceRoots, op.parent.workspaceRoots)
    || op.forkParams.model !== op.parent.model || op.forkParams.modelProvider !== op.parent.modelProvider
    || op.forkParams.serviceTier !== op.parent.serviceTier || op.forkParams.ephemeral !== true
    || op.forkParams.excludeTurns !== true || op.forkParams.threadSource !== 'user'
    || op.forkParams.developerInstructions !== developer
    || (!isDeepStrictEqual(op.forkParams.config, expectedConfig) && !isDeepStrictEqual(op.forkParams.config, previousConfig))
    || ['approvalPolicy', 'approvalsReviewer', 'permissions', 'sandbox'].some(key =>
      !isDeepStrictEqual(op.forkParams[key], expectedPermissions[key]))
    || !isDeepStrictEqual(op.boundaryItems, expectedItems)
    || Object.keys(op.forkParams).some(key => !['threadId', 'cwd', 'runtimeWorkspaceRoots', 'model', 'modelProvider',
      'serviceTier', 'ephemeral', 'excludeTurns', 'threadSource', 'developerInstructions', 'config', 'approvalPolicy',
      'approvalsReviewer', 'permissions', 'sandbox'].includes(key))) {
    throw new Error('侧聊冻结请求与原父会话不一致，原记录已保留。');
  }
  if (op.fork.status === 'received' && (!op.childId || !validForkReceipt(op, op.fork.receipt))) {
    throw new Error('侧聊子会话回执无法安全读取，原记录已保留。');
  }
  if (op.fork.receiptOrigin !== undefined && (!record(op.fork.receiptOrigin)
    || op.fork.receiptOrigin.connectionGeneration !== op.parent.connectionGeneration
    || op.fork.receiptOrigin.attemptId !== op.fork.attemptId || !validCursor(op.fork.receiptOrigin.eventCursor)
    || !['received', 'invalid'].includes(op.fork.status))) {
    throw new Error('侧聊原连接回执游标无法安全读取，原记录已保留。');
  }
  if ((op.inject.status === 'received' && !record(op.inject.receipt))
    || ([op.fork, op.inject].some(state => state.status !== 'waiting' && !nonempty(state.attemptId)))
    || (['inflight', 'unknown', 'not-sent', 'rejected'].includes(op.close.status) && !nonempty(op.close.attemptId))
    || (op.childId && ['cleanup-pending', 'cleaning', 'closed'].includes(op.close.status)
      && (!record(op.close.receipt) || !['unsubscribed', 'notSubscribed', 'notLoaded'].includes(String(op.close.receipt.status))))) {
    throw new Error('侧聊恢复回执无法安全读取，原记录已保留。');
  }
  return value as unknown as SideChatOperation;
}

function scope(operation: SideChatOperation): SideChatScope {
  if (!nonempty(operation.childId)) throw new Error('侧聊尚无已确认的子会话。');
  return { operationId: operation.operationId, hostId: operation.parent.hostId,
    parentThreadId: operation.parent.threadId, childThreadId: operation.childId };
}

function ownsChild(operation: SideChatOperation): boolean {
  const receipt = operation.fork.receipt;
  const thread = record(receipt) && record(receipt.thread) ? receipt.thread : null;
  return !!thread && thread.id === operation.childId && thread.ephemeral === true
    && thread.forkedFromId === operation.parent.threadId;
}

function validForkReceipt(operation: SideChatOperation, receipt: unknown): boolean {
  const fork = operation.forkParams;
  const sandboxType: Record<string, string> = { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite',
    'danger-full-access': 'dangerFullAccess' };
  return ownsChild(operation) && record(receipt) && receipt.cwd === operation.parent.cwd
    && receipt.model === operation.parent.model && receipt.modelProvider === operation.parent.modelProvider
    && receipt.reasoningEffort === operation.parent.effort
    && (receipt.serviceTier === operation.parent.serviceTier || operation.parent.serviceTier === null && receipt.serviceTier === 'default')
    && isDeepStrictEqual(receipt.sandbox, operation.parent.sandboxPolicy)
    && Array.isArray(receipt.runtimeWorkspaceRoots)
    && isDeepStrictEqual(receipt.runtimeWorkspaceRoots, operation.parent.workspaceRoots)
    && (fork.approvalPolicy === undefined || isDeepStrictEqual(receipt.approvalPolicy, fork.approvalPolicy))
    && (fork.approvalsReviewer === undefined || receipt.approvalsReviewer === fork.approvalsReviewer)
    && (fork.permissions === undefined || record(receipt.activePermissionProfile) && receipt.activePermissionProfile.id === fork.permissions)
    && (fork.sandbox === undefined || record(receipt.sandbox) && receipt.sandbox.type === sandboxType[String(fork.sandbox)]);
}

type PendingTerminal = { operationId: string; step: 'fork' | 'inject' | 'close'; attemptId: string;
  origin: { hostId: string; parentThreadId: string; connectionGeneration: string };
  terminal: LateRpcTerminal | { outcome: 'failure'; delivery: Delivery; error: string; terminalError?: RpcTerminalError } };
type PendingLocal = { operationId: string; step: 'prepare' | 'cleanup'; attemptId: string;
  nextAttemptId?: string; error?: string };

/** A side-chat operation journal; storage and the existing host connection are supplied by the caller. */
export function createSideChatHost(deps: SideChatDependencies) {
  const pending = new Map<string, PendingTerminal>();
  const pendingLocal = new Map<string, PendingLocal>();
  const read = async (id: string) => validateOperation(await deps.store.read(id));
  const update = (id: string, fn: (operation: SideChatOperation) => SideChatOperation) =>
    deps.store.update(id, current => fn(validateOperation(current)));
  const key = (event: PendingTerminal) => JSON.stringify([event.operationId, event.step, event.attemptId]);
  const localKey = (event: PendingLocal) => JSON.stringify([event.operationId, event.step, event.attemptId]);

  async function applyTerminal(event: PendingTerminal, advance = true): Promise<SideChatOperation> {
    let accepted = false, sameAttempt = false;
    const op = await update(event.operationId, current => {
      const state = event.step === 'close' ? current.close : current[event.step];
      if (current.parent.hostId !== event.origin.hostId || current.parent.threadId !== event.origin.parentThreadId
        || current.parent.connectionGeneration !== event.origin.connectionGeneration || state.attemptId !== event.attemptId) return current;
      sameAttempt = true;
      if (!['inflight', 'unknown'].includes(state.status)) return current;
      accepted = true;
      const terminal = event.terminal;
      if (terminal.outcome !== 'success') {
        const status: Delivery = terminal.outcome === 'failure' ? terminal.delivery : 'rejected';
        const error = terminal.outcome === 'failure' ? terminal.error : terminal.error.message;
        const terminalError = terminal.outcome === 'error' ? copy(terminal.error) : terminal.terminalError;
        if (event.step === 'close') return { ...current, close: { ...current.close, status, error,
          ...(terminalError ? { terminalError } : {}) } };
        return { ...current, [event.step]: { ...state, status, error, ...(terminalError ? { terminalError } : {}) } };
      }
      const receipt = copy(terminal.result);
      if (event.step === 'fork') {
        const thread = record(receipt) && record(receipt.thread) ? receipt.thread : null;
        const childId = thread && nonempty(thread.id) && thread.id !== current.parent.threadId ? thread.id : undefined;
        const origin = validCursor(terminal.eventCursor) ? { connectionGeneration: event.origin.connectionGeneration,
          attemptId: event.attemptId, eventCursor: terminal.eventCursor } : undefined;
        const valid = !!origin && !!childId && validForkReceipt({ ...current, childId, fork: { ...current.fork, receipt } }, receipt);
        return { ...current, ...(childId ? { childId } : {}), fork: { ...current.fork, receipt,
          ...(origin ? { receiptOrigin: origin } : {}),
          status: valid ? 'received' : 'invalid', terminalError: undefined,
          error: valid ? undefined : 'fork 回执或原连接游标无法验证，原回执已保留。' } };
      }
      if (event.step === 'inject') return { ...current, inject: { ...current.inject, receipt,
        status: record(receipt) ? 'received' : 'invalid', terminalError: undefined,
        error: record(receipt) ? undefined : '边界注入回执无效。' } };
      const valid = record(receipt) && ['unsubscribed', 'notSubscribed', 'notLoaded'].includes(String(receipt.status));
      return { ...current, close: { ...current.close, receipt, status: valid ? 'cleanup-pending' : 'unknown',
        terminalError: undefined, error: valid ? undefined : 'unsubscribe 回执无效。' } };
    });
    pending.delete(key(event));
    if (!advance) return op;
    if (!accepted) {
      if (!sameAttempt) return op;
      if (op.close.requested) return driveClose(op.operationId, false);
      if (op.fork.status === 'received' && op.inject.status === 'waiting') return dispatchInject(op.operationId, false);
      return op;
    }
    if (op.close.requested) return driveClose(op.operationId, false);
    if (event.step === 'fork' && op.fork.status === 'received') return dispatchInject(op.operationId, false);
    return op;
  }

  async function settle(event: PendingTerminal, advance = true): Promise<SideChatOperation> {
    try { return await applyTerminal(event, advance); }
    catch (error) { pending.set(key(event), event); throw error; }
  }

  async function settleLocal(event: PendingLocal, advance = true): Promise<SideChatOperation> {
    let claimed = false;
    let op: SideChatOperation;
    try {
      op = await update(event.operationId, current => {
        const expected = event.step === 'prepare' ? 'preparing' : 'cleaning';
        if (current.close.status !== expected || current.close.attemptId !== event.attemptId) return current;
        claimed = true;
        if (event.step === 'prepare') {
          return event.error === undefined
            ? { ...current, close: { ...current.close, status: advance ? 'inflight' : 'not-sent',
              attemptId: event.nextAttemptId, error: undefined } }
            : { ...current, close: { ...current.close, status: 'prepare-failed', error: event.error } };
        }
        return { ...current, close: { ...current.close, status: event.error === undefined ? 'closed' : 'cleanup-pending',
          error: event.error } };
      });
    } catch (error) {
      pendingLocal.set(localKey(event), event);
      throw error;
    }
    pendingLocal.delete(localKey(event));
    return advance && claimed && event.step === 'prepare' && event.error === undefined && event.nextAttemptId
      ? send(op, 'close', event.nextAttemptId) : op;
  }

  async function send(op: SideChatOperation, step: 'fork' | 'inject' | 'close', attemptId: string): Promise<SideChatOperation> {
    const method: Method = step === 'fork' ? 'thread/fork' : step === 'inject' ? 'thread/inject_items' : 'thread/unsubscribe';
    const params = step === 'fork' ? op.forkParams : step === 'inject'
      ? { threadId: op.childId, items: op.boundaryItems } : { threadId: op.childId };
    const origin = { hostId: op.parent.hostId, parentThreadId: op.parent.threadId, connectionGeneration: op.parent.connectionGeneration };
    const late = (terminal: LateRpcTerminal) => {
      let captured: LateRpcTerminal;
      try { captured = copy(terminal); } catch (error) { deps.onRecoveryError(op.operationId, error); return; }
      void settle({ operationId: op.operationId, step, attemptId, origin, terminal: captured })
        .catch(error => deps.onRecoveryError(op.operationId, error));
    };
    let terminal: PendingTerminal['terminal'];
    try {
      if (step === 'fork') {
        const reply = await deps.requestFork({ operationId: op.operationId, hostId: op.parent.hostId,
          parentThreadId: op.parent.threadId, connectionGeneration: op.parent.connectionGeneration, attemptId }, copy(params), late);
        terminal = { outcome: 'success', result: copy(reply.result), eventCursor: reply.eventCursor };
      } else {
        const result = await deps.request(op.parent.hostId, method, copy(params), true, late, op.parent.connectionGeneration);
        terminal = { outcome: 'success', result };
      }
    } catch (error) {
      let delivery: Delivery = 'unknown';
      try { delivery = deps.classifyFailure(method, error); } catch { /* Preserve uncertainty. */ }
      terminal = { outcome: 'failure', delivery, error: message(error),
        ...(delivery === 'rejected' ? { terminalError: rpcErrorReceipt(error) } : {}) };
    }
    return settle({ operationId: op.operationId, step, attemptId, origin, terminal });
  }

  async function dispatchFork(id: string, retry: boolean, dispatchId?: string): Promise<SideChatOperation> {
    const attemptId = dispatchId ?? randomUUID(); let claimed = false;
    const op = await update(id, current => {
      if (current.close.requested || !(current.fork.status === 'waiting' || (retry && current.fork.status === 'not-sent'))) return current;
      if (!isDeepStrictEqual(current.forkParams.config, forkConfiguration(current.parent))) {
        throw new Error('侧聊原冻结请求包含不兼容的 effort 配置，未派发；请关闭并新建。');
      }
      claimed = true;
      return { ...current, fork: { status: 'inflight', attemptId } };
    });
    return claimed ? send(op, 'fork', attemptId) : op;
  }

  async function dispatchInject(id: string, retry: boolean): Promise<SideChatOperation> {
    const attemptId = randomUUID(); let claimed = false;
    const op = await update(id, current => {
      if (current.close.requested || current.fork.status !== 'received' || !current.childId
        || !(current.inject.status === 'waiting' || (retry && current.inject.status === 'not-sent'))) return current;
      claimed = true;
      return { ...current, inject: { status: 'inflight', attemptId } };
    });
    return claimed ? send(op, 'inject', attemptId) : op;
  }

  async function cleanup(id: string): Promise<SideChatOperation> {
    const attemptId = randomUUID(); let claimed = false;
    const op = await update(id, current => {
      if (current.close.status !== 'cleanup-pending') return current;
      claimed = true;
      return { ...current, close: { ...current.close, status: 'cleaning', attemptId, error: undefined } };
    });
    if (!claimed) return op;
    let error: string | undefined;
    try { await deps.cleanup(scope(op)); } catch (failure) { error = message(failure); }
    return settleLocal({ operationId: id, step: 'cleanup', attemptId, error });
  }

  async function driveClose(id: string, retry: boolean): Promise<SideChatOperation> {
    let op = await read(id);
    if (!op.close.requested || op.close.status === 'closed') return op;
    if (op.close.status === 'cleanup-pending') return cleanup(id);
    if (!op.childId) {
      if (op.fork.status === 'waiting' || op.fork.status === 'not-sent') {
        return update(id, current => !current.childId && ['waiting', 'not-sent'].includes(current.fork.status)
          ? { ...current, close: { ...current.close, status: 'closed' } } : current);
      }
      return op;
    }
    if (!ownsChild(op)) {
      return update(id, current => ({ ...current, close: { ...current.close, status: 'prepare-failed',
        error: '无法确认子会话的临时属性和父会话归属，保留回执等待核对。' } }));
    }
    if (op.inject.status === 'inflight') return op;
    const prepareId = randomUUID(); let claimed = false;
    op = await update(id, current => {
      if (!current.childId || current.inject.status === 'inflight'
        || !(current.close.status === 'idle' || (retry && ['prepare-failed', 'not-sent'].includes(current.close.status)))) return current;
      claimed = true;
      return { ...current, close: { ...current.close, status: 'preparing', attemptId: prepareId, error: undefined } };
    });
    if (!claimed) return op;
    let error: string | undefined;
    try { await deps.prepareClose(scope(op)); } catch (failure) { error = message(failure); }
    return settleLocal({ operationId: id, step: 'prepare', attemptId: prepareId, nextAttemptId: randomUUID(), error });
  }

  async function prepare(input: { hostId: string; threadId: string }): Promise<SideChatOperation> {
    if (!nonempty(input.hostId) || !nonempty(input.threadId)) throw new Error('侧聊父会话身份无效。');
    const parent = copy(await deps.resolveParent(input.hostId, input.threadId));
    validateParent(parent, input.hostId, input.threadId);
    const config = await deps.request(parent.hostId, 'config/read', { cwd: parent.cwd, includeLayers: false }, false,
      undefined, parent.connectionGeneration);
    if (!record(config) || !record(config.config) || !Object.hasOwn(config.config, 'developer_instructions')
      || !(config.config.developer_instructions === null || typeof config.config.developer_instructions === 'string')) {
      throw new Error('无法读取所选主机的 developer 指令配置。');
    }
    const configuredInstructions = config.config.developer_instructions as string | null;
    const effective = parent.developerOverride?.value ?? configuredInstructions;
    const developer = [effective, instructions].filter(part => typeof part === 'string' && part.length > 0).join('\n\n');
    const forkParams: ObjectValue = { threadId: parent.threadId, cwd: parent.cwd, runtimeWorkspaceRoots: parent.workspaceRoots,
      model: parent.model, modelProvider: parent.modelProvider, serviceTier: parent.serviceTier, ephemeral: true,
      excludeTurns: true, threadSource: 'user', developerInstructions: developer,
      config: forkConfiguration(parent),
      ...forkPermissions(parent.submitOptions) };
    const boundaryItems = [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: developer }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: boundary }] },
    ];
    const operation: SideChatOperation = { version: 1, operationId: randomUUID(), parent, configuredInstructions,
      instructionSource: parent.developerOverride ? 'thread-override' : 'host-config', forkParams, boundaryItems,
      fork: { status: 'waiting' }, inject: { status: 'waiting' }, close: { requested: false, status: 'idle' } };
    await deps.store.create(copy(operation));
    return operation;
  }

  async function retry(id: string, forkDispatchId?: string): Promise<SideChatOperation> {
    const op = await read(id);
    if (op.close.requested) return driveClose(id, true);
    if (op.fork.status === 'waiting') return dispatchFork(id, false, forkDispatchId);
    if (op.fork.status === 'not-sent') return dispatchFork(id, true, forkDispatchId);
    if (op.fork.status === 'received' && op.inject.status === 'waiting') return dispatchInject(id, false);
    if (op.inject.status === 'not-sent') return dispatchInject(id, true);
    return op;
  }

  async function close(id: string): Promise<SideChatOperation> {
    await update(id, current => ({ ...current, close: { ...current.close, requested: true } }));
    return driveClose(id, true);
  }

  async function retryPersistence(id: string): Promise<SideChatOperation> {
    for (const event of [...pending.values()].filter(item => item.operationId === id)) await settle(event);
    for (const event of [...pendingLocal.values()].filter(item => item.operationId === id)) await settleLocal(event);
    return read(id);
  }

  async function saveCaptured(id: string): Promise<SideChatOperation> {
    for (const event of [...pending.values()].filter(item => item.operationId === id)) await settle(event, false);
    for (const event of [...pendingLocal.values()].filter(item => item.operationId === id)) await settleLocal(event, false);
    return read(id);
  }

  /** Only after the previous host process and its connection observers are known to have ended. */
  async function recoverAfterRestart(id: string): Promise<SideChatOperation> {
    return update(id, current => ({ ...current,
      fork: current.fork.status === 'inflight' ? { ...current.fork, status: 'unknown' } : current.fork,
      inject: current.inject.status === 'inflight' ? { ...current.inject, status: 'unknown' } : current.inject,
      close: current.close.status === 'inflight' ? { ...current.close, status: 'unknown' }
        : current.close.status === 'preparing' ? { ...current.close, status: 'prepare-failed', error: '关闭准备中断，请重试。' }
          : current.close.status === 'cleaning' ? { ...current.close, status: 'cleanup-pending', error: '缓存清理中断，请重试。' } : current.close,
    }));
  }

  return { prepare, start: (id: string, forkDispatchId?: string) => dispatchFork(id, false, forkDispatchId),
    read, retry, close, retryPersistence, saveCaptured, recoverAfterRestart };
}
