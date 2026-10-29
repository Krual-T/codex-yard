import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { LateRpcTerminal, RpcResult, SandboxPolicy, ThreadSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import type { SubmitOptions } from '../renderer/workbench-contract.ts';
import type { SideChatForkChild, SideChatHostAction, SideChatHostView } from '../renderer/side-chat/types.ts';
import { createSideChatHost } from './side-chat.ts';
import type { SideChatDependencies, SideChatOperation, SideChatParent, SideChatScope, SideChatStore } from './side-chat.ts';

type Value = Record<string, unknown>;
type Delivery = 'not-sent' | 'rejected' | 'unknown';
type RequestMethod = 'thread/fork' | 'thread/inject_items' | 'thread/unsubscribe';

export interface SideChatEndpointScope {
  hostId: string;
  parentThreadId: string;
  operationId: string;
  connectionGeneration: string;
  childThreadId: string | null;
}

export interface SideChatEndpointInput { hostId: string; parentThreadId: string; operationId: string }
export interface SideChatEndpointActionInput extends SideChatEndpointInput { token: string; forkDispatchId?: string }
export interface SideChatEndpointReply { view: SideChatHostView; token: string | null }
export type SideChatEndpointAccess = { kind: 'read' }
  | { kind: 'dispatch'; action: SideChatHostAction; closeRequested: boolean };

/** The prepare index and each operation live in the same durable host store. */
export interface SideChatEndpointStore extends SideChatStore {
  readPrepared(prepareId: string): Promise<SideChatOperation | null>;
  /** Atomically create or return the original operation associated with this globally unique ID. */
  createPrepared(prepareId: string, operation: SideChatOperation): Promise<SideChatOperation>;
}

export interface SideChatEndpointDependencies {
  store: SideChatEndpointStore;
  /** Stable identity of this host-process incarnation, issued by the host lifecycle authority. */
  ownerId: string;
  resolveParent(hostId: string, parentThreadId: string): Promise<SideChatParent>;
  /** Authorize the selected host and parent for preparation; no page-supplied settings are accepted. */
  withParent<T>(hostId: string, parentThreadId: string, run: () => Promise<T>): Promise<T>;
  /** Dispatch guards the original connection, draft association and applicable close barrier through the claim. */
  withScope<T>(scope: SideChatEndpointScope, access: SideChatEndpointAccess, run: () => Promise<T>): Promise<T>;
  /** Atomically recheck the original socket and scope at each actual send, including late continuations. */
  request(scope: SideChatEndpointScope | Omit<SideChatEndpointScope, 'operationId' | 'childThreadId'>,
    method: string, params: Value, mutating: boolean,
    late: ((terminal: LateRpcTerminal) => void | Promise<void>) | undefined): Promise<unknown>;
  /** Dispatch on the guarded original socket, preserving the cursor captured by requestWithCursor. */
  requestFork(scope: SideChatEndpointScope, attemptId: string, params: Value,
    late: (terminal: LateRpcTerminal) => void | Promise<void>): Promise<RpcResult<unknown>>;
  classifyFailure(method: RequestMethod, error: unknown): Delivery;
  prepareClose(scope: SideChatEndpointScope & { childThreadId: string }): Promise<void>;
  cleanup(scope: SideChatEndpointScope & { childThreadId: string }): Promise<void>;
  /** True only when the old adapter and all its connection observers are known to have ended. */
  ownerStopped(ownerId: string): boolean;
  notify(hint: { hostId: string; operationId: string }): void | Promise<void>;
}

interface ActiveCall { action: SideChatHostAction; ownerId: string; callId: string }
interface EndpointFence {
  version: 1;
  ownerId: string;
  origin: { hostId: string; parentThreadId: string; operationId: string; connectionGeneration: string };
  token: string;
  recovering: boolean;
  active: ActiveCall | null;
}
type FencedOperation = SideChatOperation & { endpointFence?: unknown };
const actions: readonly SideChatHostAction[] = ['start', 'retry', 'close', 'retryPersistence'];
const isObject = (value: unknown): value is Value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const receiptString = (value: unknown): value is string => nonempty(value) && value.trim().length > 0 && !value.includes('\0');
const absolute = (value: unknown): value is string => receiptString(value) && (posix.isAbsolute(value) || win32.isAbsolute(value));

export class SideChatEndpointError extends Error {
  readonly uncertain?: false;
  constructor(message: string, notDispatched = false) {
    super(message);
    this.name = 'SideChatEndpointError';
    if (notDispatched) this.uncertain = false;
  }
}

class BeforeDispatchError extends Error {}

function fenceOf(operation: SideChatOperation): EndpointFence | null {
  const value = (operation as FencedOperation).endpointFence;
  if (!isObject(value) || value.version !== 1 || !nonempty(value.token) || !nonempty(value.ownerId)
    || typeof value.recovering !== 'boolean' || !isObject(value.origin)
    || value.origin.hostId !== operation.parent.hostId || value.origin.parentThreadId !== operation.parent.threadId
    || value.origin.operationId !== operation.operationId || value.origin.connectionGeneration !== operation.parent.connectionGeneration) return null;
  const origin = { hostId: operation.parent.hostId, parentThreadId: operation.parent.threadId,
    operationId: operation.operationId, connectionGeneration: operation.parent.connectionGeneration };
  if (value.active === null) return { version: 1, ownerId: value.ownerId, origin, token: value.token, recovering: value.recovering, active: null };
  if (!isObject(value.active) || !actions.includes(value.active.action as SideChatHostAction)
    || value.active.ownerId !== value.ownerId || !nonempty(value.active.callId)) return null;
  return { version: 1, ownerId: value.ownerId, origin, token: value.token, recovering: value.recovering, active: {
    action: value.active.action as SideChatHostAction, ownerId: value.active.ownerId, callId: value.active.callId,
  } };
}

function setFence(operation: SideChatOperation, fence: EndpointFence): SideChatOperation {
  return { ...operation, endpointFence: fence } as FencedOperation;
}

function checkInput(input: SideChatEndpointInput): void {
  if (!input || !nonempty(input.hostId) || !nonempty(input.parentThreadId) || !nonempty(input.operationId)) {
    throw new Error('invalid scope');
  }
}

function scopeOf(operation: SideChatOperation, input: SideChatEndpointInput): SideChatEndpointScope {
  checkInput(input);
  if (operation.operationId !== input.operationId || operation.parent.hostId !== input.hostId
    || operation.parent.threadId !== input.parentThreadId) throw new Error('scope mismatch');
  return { hostId: input.hostId, parentThreadId: input.parentThreadId, operationId: input.operationId,
    connectionGeneration: operation.parent.connectionGeneration, childThreadId: operation.childId ?? null };
}

function sameScope(operation: SideChatOperation, scope: SideChatEndpointScope): void {
  const current = scopeOf(operation, scope);
  if (current.connectionGeneration !== scope.connectionGeneration || current.childThreadId !== scope.childThreadId) {
    throw new Error('scope changed');
  }
}

function optionProjection(value: Value): SubmitOptions | null {
  if (!receiptString(value.model) || !receiptString(value.modelProvider)
    || !Object.hasOwn(value, 'reasoningEffort') || !(value.reasoningEffort === null || receiptString(value.reasoningEffort))
    || !Object.hasOwn(value, 'serviceTier') || !(value.serviceTier === null || receiptString(value.serviceTier))) return null;
  const options: SubmitOptions = { model: value.model, effort: value.reasoningEffort as string | null,
    serviceTier: value.serviceTier as string | null };
  if (value.approvalPolicy === 'untrusted' || value.approvalPolicy === 'on-request' || value.approvalPolicy === 'never') {
    options.approvalPolicy = value.approvalPolicy;
  } else if (isObject(value.approvalPolicy) && isObject(value.approvalPolicy.granular)) {
    const g = value.approvalPolicy.granular;
    if (typeof g.sandbox_approval === 'boolean' && typeof g.rules === 'boolean' && typeof g.skill_approval === 'boolean'
      && typeof g.mcp_elicitations === 'boolean' && typeof g.request_permissions === 'boolean') {
      options.approvalPolicy = { granular: { sandbox_approval: g.sandbox_approval, rules: g.rules,
        skill_approval: g.skill_approval, mcp_elicitations: g.mcp_elicitations, request_permissions: g.request_permissions } };
    }
  }
  if (!options.approvalPolicy) return null;
  if (value.approvalsReviewer === 'user' || value.approvalsReviewer === 'auto_review' || value.approvalsReviewer === 'guardian_subagent') {
    options.approvalsReviewer = value.approvalsReviewer;
  }
  if (!options.approvalsReviewer || !isObject(value.sandbox) || !Object.hasOwn(value, 'activePermissionProfile')) return null;
  const sandboxModes = { readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' } as const;
  const sandboxMode = sandboxModes[value.sandbox.type as keyof typeof sandboxModes];
  if (sandboxMode) options.sandboxMode = sandboxMode;
  const profile = value.activePermissionProfile;
  if (!(profile === null || isObject(profile) && receiptString(profile.id))) return null;
  if (profile) options.permissionProfileId = profile.id as string;
  if (!profile && !sandboxMode) return null;
  const mode = isObject(value.collaborationMode) ? value.collaborationMode.mode : value.collaborationMode;
  if (mode != null && mode !== 'default' && mode !== 'plan') return null;
  if (mode === 'default' || mode === 'plan') options.mode = mode;
  return options;
}

function sandboxProjection(value: unknown): SandboxPolicy | null {
  if (!isObject(value)) return null;
  if (value.type === 'dangerFullAccess') return { type: 'dangerFullAccess' };
  if (value.type === 'readOnly' && typeof value.networkAccess === 'boolean') {
    return { type: 'readOnly', networkAccess: value.networkAccess };
  }
  if (value.type === 'externalSandbox' && (value.networkAccess === 'restricted' || value.networkAccess === 'enabled')) {
    return { type: 'externalSandbox', networkAccess: value.networkAccess };
  }
  if (value.type === 'workspaceWrite' && Array.isArray(value.writableRoots) && value.writableRoots.every(absolute)
    && typeof value.networkAccess === 'boolean' && typeof value.excludeTmpdirEnvVar === 'boolean'
    && typeof value.excludeSlashTmp === 'boolean') {
    return { type: 'workspaceWrite', writableRoots: [...value.writableRoots] as string[], networkAccess: value.networkAccess,
      excludeTmpdirEnvVar: value.excludeTmpdirEnvVar, excludeSlashTmp: value.excludeSlashTmp };
  }
  return null;
}

function childProjection(operation: SideChatOperation): SideChatForkChild | null {
  const receipt = operation.fork.receipt;
  if (operation.fork.status !== 'received' || !isObject(receipt) || !isObject(receipt.thread)) return null;
  const thread = receipt.thread;
  if (thread.id !== operation.childId || thread.cwd !== operation.parent.cwd
    || thread.ephemeral !== true || thread.forkedFromId !== operation.parent.threadId
    || !(typeof thread.name === 'string' || thread.name === null)
    || !Array.isArray(thread.turns) || !isObject(thread.status)) return null;
  if (thread.turns.some(turn => !isObject(turn) || !receiptString(turn.id)
    || !['completed', 'interrupted', 'failed', 'inProgress'].includes(String(turn.status))
    || !Array.isArray(turn.items) || turn.items.some(item => !isObject(item) || !receiptString(item.id) || !receiptString(item.type))
    || turn.error != null && (!isObject(turn.error) || typeof turn.error.message !== 'string'
      || turn.error.additionalDetails != null && typeof turn.error.additionalDetails !== 'string')
    || turn.itemsView !== undefined && !['full', 'summary', 'notLoaded'].includes(String(turn.itemsView)))) return null;
  const status = thread.status;
  let projectedStatus: ThreadSummary['status'];
  if (status.type === 'idle' || status.type === 'notLoaded' || status.type === 'systemError') {
    projectedStatus = { type: status.type };
  } else if (status.type === 'active' && Array.isArray(status.activeFlags) && status.activeFlags.every(flag => typeof flag === 'string')) {
    projectedStatus = { type: 'active', activeFlags: [...status.activeFlags] as string[] };
  } else return null;
  const options = optionProjection(receipt), sandbox = sandboxProjection(receipt.sandbox);
  const profile = receipt.activePermissionProfile;
  if (!options || !sandbox || !Array.isArray(receipt.runtimeWorkspaceRoots)
    || receipt.runtimeWorkspaceRoots.some(root => !receiptString(root))
    || isObject(profile) && Object.hasOwn(profile, 'extends') && !(profile.extends === null || receiptString(profile.extends))) return null;
  return {
    thread: { id: thread.id as string, name: thread.name, cwd: thread.cwd, turns: structuredClone(thread.turns) as TurnSummary[],
      status: projectedStatus, ephemeral: true, forkedFromId: thread.forkedFromId },
    options, modelProvider: receipt.modelProvider as string, sandbox,
    activePermissionProfile: profile === null ? null : { id: (profile as Value).id as string,
      ...(Object.hasOwn(profile as Value, 'extends') ? { extends: (profile as Value).extends as string | null } : {}) },
    runtimeWorkspaceRoots: [...receipt.runtimeWorkspaceRoots] as string[],
  };
}

function requestError(status: string, phase: string, present: boolean): string | null {
  if (!present && !['not-sent', 'rejected', 'unknown', 'invalid'].includes(status)) return null;
  if (status === 'not-sent') return `${phase}未发送，可显式重试。`;
  if (status === 'rejected') return `${phase}被宿主拒绝，原记录已保留。`;
  if (status === 'unknown') return `${phase}结果未确认，原记录已保留。`;
  if (status === 'invalid') return `${phase}回执无法验证，原记录已保留。`;
  return `${phase}未完成，原记录已保留。`;
}

function project(operation: SideChatOperation, recoveryError: string | null,
  settledCalls?: Partial<Record<SideChatHostAction, boolean>>): SideChatHostView {
  const child = childProjection(operation);
  return {
    operationId: operation.operationId,
    parent: { hostId: operation.parent.hostId, threadId: operation.parent.threadId, cwd: operation.parent.cwd },
    childId: operation.childId ?? null,
    child,
    fork: { status: operation.fork.status, error: operation.fork.status === 'received' && !child
      ? '子会话初始信息无法安全读取，原回执已保留。'
      : operation.fork.status === 'received' && !operation.fork.receiptOrigin
        ? '原 fork 回执缺少连接游标，无法确认实时投影。'
      : requestError(operation.fork.status, '创建侧聊', !!operation.fork.error),
      ...(operation.fork.receiptOrigin ? { receipt: structuredClone(operation.fork.receiptOrigin) } : {}) },
    inject: { status: operation.inject.status, error: requestError(operation.inject.status, '写入侧聊边界', !!operation.inject.error) },
    close: { requested: operation.close.requested, status: operation.close.status,
      error: requestError(operation.close.status, '关闭侧聊', !!operation.close.error) },
    recoveryError,
    ...(settledCalls ? { settledCalls } : {}),
  };
}

/** A process-owned adapter; the original E service and its pending receipts survive page disconnects. */
export function createSideChatEndpointHost(deps: SideChatEndpointDependencies) {
  if (!nonempty(deps.ownerId)) throw new Error('A side-chat host owner identity is required.');
  const ownerId = deps.ownerId;
  const services = new Map<string, ReturnType<typeof createSideChatHost>>();
  const recoveries = new Map<string, Promise<void>>();
  const completed = new Set<string>();
  const recovery = new Map<string, object>();

  function notify(operation: SideChatOperation): void {
    try { void Promise.resolve(deps.notify({ hostId: operation.parent.hostId, operationId: operation.operationId })).catch(() => {}); }
    catch { /* A failed hint cannot change a persisted operation. */ }
  }

  function service(initialId?: string, prepareId?: string) {
    let operationId = initialId;
    let preparingParent: SideChatParent | undefined;
    let prepared: SideChatOperation | undefined;
    const store: SideChatStore = {
      async create(operation) {
        if (!prepareId) throw new Error('missing prepare identity');
        const saved = await deps.store.createPrepared(prepareId, setFence(operation,
          { version: 1, ownerId, origin: { hostId: operation.parent.hostId, parentThreadId: operation.parent.threadId,
            operationId: operation.operationId, connectionGeneration: operation.parent.connectionGeneration },
          token: randomUUID(), recovering: false, active: null }));
        if (saved.parent.hostId !== operation.parent.hostId || saved.parent.threadId !== operation.parent.threadId) {
          throw new Error('prepare identity belongs to another scope');
        }
        operationId = saved.operationId;
        prepared = saved;
        notify(saved);
      },
      read: id => deps.store.read(id),
      async update(id, update) {
        const result = await deps.store.update(id, operation => {
          const fence = fenceOf(operation);
          if (!fence || fence.ownerId !== ownerId) throw new Error('original operation owner changed');
          return update(operation);
        });
        notify(result);
        return result;
      },
    };
    const scopeForChild = async (child: SideChatScope): Promise<SideChatEndpointScope & { childThreadId: string }> => {
      if (operationId !== child.operationId) throw new Error('operation mismatch');
      const operation = await deps.store.read(child.operationId);
      if (!operation) throw new Error('missing operation');
      const scope = scopeOf(operation, child);
      const fence = fenceOf(operation);
      if (scope.childThreadId !== child.childThreadId || !fence || fence.ownerId !== ownerId || fence.recovering) {
        throw new Error('child or original host mismatch');
      }
      return { ...scope, childThreadId: child.childThreadId };
    };
    const binding: SideChatDependencies = {
      store,
      async resolveParent(hostId, parentThreadId) {
        preparingParent = structuredClone(await deps.resolveParent(hostId, parentThreadId));
        return preparingParent;
      },
      async request(hostId, method, params, mutating, late, generation) {
        if (method === 'config/read') {
          if (!preparingParent || preparingParent.hostId !== hostId || preparingParent.connectionGeneration !== generation) {
            throw new Error('parent connection mismatch');
          }
          return deps.request({ hostId, parentThreadId: preparingParent.threadId, connectionGeneration: generation },
            method, params, mutating, late);
        }
        if (!operationId) throw new BeforeDispatchError('missing operation');
        const operation = await deps.store.read(operationId);
        if (!operation || operation.parent.hostId !== hostId || operation.parent.connectionGeneration !== generation) {
          throw new BeforeDispatchError('operation connection mismatch');
        }
        const scope = scopeOf(operation, { hostId, parentThreadId: operation.parent.threadId, operationId });
        const fence = fenceOf(operation);
        if (!fence || fence.ownerId !== ownerId || fence.recovering) throw new BeforeDispatchError('operation owner mismatch');
        if (method === 'thread/fork' && params.threadId !== scope.parentThreadId
          || (method === 'thread/inject_items' || method === 'thread/unsubscribe') && params.threadId !== scope.childThreadId) {
          throw new BeforeDispatchError('request child mismatch');
        }
        return deps.request(scope, method, params, mutating, late);
      },
      async requestFork(origin, params, late) {
        if (!operationId || origin.operationId !== operationId) throw new BeforeDispatchError('missing operation');
        const operation = await deps.store.read(operationId);
        if (!operation || operation.parent.hostId !== origin.hostId || operation.parent.threadId !== origin.parentThreadId
          || operation.parent.connectionGeneration !== origin.connectionGeneration || operation.fork.status !== 'inflight'
          || operation.fork.attemptId !== origin.attemptId) throw new BeforeDispatchError('fork origin mismatch');
        const scope = scopeOf(operation, origin);
        const fence = fenceOf(operation);
        if (!fence || fence.ownerId !== ownerId || fence.recovering || params.threadId !== scope.parentThreadId) {
          throw new BeforeDispatchError('fork owner mismatch');
        }
        return deps.requestFork(scope, origin.attemptId, params, late);
      },
      classifyFailure: (method, error) => error instanceof BeforeDispatchError ? 'not-sent' : deps.classifyFailure(method, error),
      prepareClose: async scope => deps.prepareClose(await scopeForChild(scope)),
      cleanup: async scope => deps.cleanup(await scopeForChild(scope)),
      onRecoveryError(id) {
        if (id !== operationId) return;
        recovery.set(id, {});
        void deps.store.read(id).then(op => { if (op) notify(op); }).catch(() => {});
      },
    };
    return { host: createSideChatHost(binding), prepared: () => prepared };
  }

  function hostFor(operationId: string): ReturnType<typeof createSideChatHost> {
    let host = services.get(operationId);
    if (!host) { host = service(operationId).host; services.set(operationId, host); }
    return host;
  }

  async function original(input: SideChatEndpointInput): Promise<SideChatOperation> {
    checkInput(input);
    const saved = await deps.store.read(input.operationId);
    if (!saved) throw new Error('missing operation');
    scopeOf(saved, input);
    const operation = await hostFor(input.operationId).read(input.operationId);
    scopeOf(operation, input);
    return operation;
  }

  function reply(operation: SideChatOperation, settled?: Partial<Record<SideChatHostAction, boolean>>): SideChatEndpointReply {
    const fence = fenceOf(operation);
    const recoveryError = !fence ? '原侧聊调用围栏不可确认，原记录已保留。'
      : fence.ownerId !== ownerId ? '原宿主仍负责此侧聊，尚无法确认其调用已终结。'
        : fence.recovering ? '原宿主的侧聊记录正在恢复。'
          : recovery.has(operation.operationId) ? '侧聊回执尚未保存，请检查并重试保存。' : null;
    return { view: project(operation, recoveryError, settled),
      token: fence && fence.ownerId === ownerId && !fence.recovering ? fence.token : null };
  }

  function recoverStoppedOwner(scope: SideChatEndpointScope): Promise<void> {
    const existing = recoveries.get(scope.operationId);
    if (existing) return existing;
    const work = (async () => {
      await hostFor(scope.operationId).recoverAfterRestart(scope.operationId);
      await deps.withScope(scope, { kind: 'read' }, async () => {
        await deps.store.update(scope.operationId, operation => {
          sameScope(operation, scope);
          const fence = fenceOf(operation);
          if (!fence || fence.ownerId !== ownerId || !fence.recovering || fence.active) throw new Error('recovery owner changed');
          return setFence(operation, { ...fence, recovering: false });
        });
      });
    })();
    recoveries.set(scope.operationId, work);
    void work.finally(() => { if (recoveries.get(scope.operationId) === work) recoveries.delete(scope.operationId); }).catch(() => {});
    return work;
  }

  async function prepare(input: { hostId: string; parentThreadId: string; prepareId: string }): Promise<SideChatEndpointReply> {
    try {
      if (!input || !nonempty(input.hostId) || !nonempty(input.parentThreadId) || !nonempty(input.prepareId)) throw new Error('invalid prepare');
      return await deps.withParent(input.hostId, input.parentThreadId, async () => {
        let saved = await deps.store.readPrepared(input.prepareId);
        if (!saved) {
          const candidate = service(undefined, input.prepareId);
          await candidate.host.prepare({ hostId: input.hostId, threadId: input.parentThreadId });
          saved = candidate.prepared() ?? null;
          if (!saved) throw new Error('prepare was not stored');
          if (!services.has(saved.operationId)) services.set(saved.operationId, candidate.host);
        }
        const operation = await original({ hostId: input.hostId, parentThreadId: input.parentThreadId, operationId: saved.operationId });
        return reply(operation);
      });
    } catch { throw new SideChatEndpointError('无法准备侧聊，请检查原主机和父会话。'); }
  }

  async function read(input: SideChatEndpointInput): Promise<SideChatEndpointReply> {
    try {
      const before = await original(input);
      const scope = scopeOf(before, input);
      let settled: Partial<Record<SideChatHostAction, boolean>> | undefined;
      let completedId: string | undefined;
      let recover = false;
      await deps.withScope(scope, { kind: 'read' }, async () => {
        await deps.store.update(input.operationId, operation => {
          sameScope(operation, scope);
          const fence = fenceOf(operation);
          if (!fence) return operation;
          if (fence.ownerId !== ownerId) {
            if (!deps.ownerStopped(fence.ownerId)) return operation;
            recover = true;
            return setFence(operation, { ...fence, ownerId, token: randomUUID(), recovering: true, active: null });
          }
          if (fence.recovering) { recover = true; return operation; }
          let active = fence.active;
          if (active && completed.has(active.callId)) {
            completedId = active.callId;
            active = null;
          }
          settled = Object.fromEntries(actions.filter(action => active?.action !== action).map(action => [action, true]));
          return setFence(operation, { ...fence, token: randomUUID(), active });
        });
      });
      if (completedId) completed.delete(completedId);
      if (recover) { await recoverStoppedOwner(scope); return read(input); }
      const after = await original(input);
      return reply(after, settled);
    } catch { throw new SideChatEndpointError('无法读取原侧聊记录，请检查原主机和会话。'); }
  }

  async function dispatch(action: SideChatHostAction, input: SideChatEndpointActionInput): Promise<SideChatEndpointReply> {
    const callId = randomUUID();
    const forkDispatchId = input?.forkDispatchId;
    let invoked = false;
    let claimed = false;
    let scope: SideChatEndpointScope | undefined;
    try {
      if (!input || !nonempty(input.token) || forkDispatchId !== undefined && !receiptString(forkDispatchId)) throw new Error('invalid action');
      const before = await original(input);
      scope = scopeOf(before, input);
      await deps.withScope(scope, { kind: 'dispatch', action, closeRequested: before.close.requested }, async () => {
        await deps.store.update(input.operationId, operation => {
          sameScope(operation, scope!);
          if (operation.close.requested !== before.close.requested) throw new Error('close intent changed');
          const fence = fenceOf(operation);
          if (!fence || fence.ownerId !== ownerId || fence.recovering || fence.token !== input.token || fence.active) {
            throw new Error('stale or active call');
          }
          const forkWillDispatch = !operation.close.requested && (action === 'start' && operation.fork.status === 'waiting'
            || action === 'retry' && (operation.fork.status === 'waiting' || operation.fork.status === 'not-sent'));
          if (forkWillDispatch && !forkDispatchId || forkDispatchId && operation.fork.attemptId === forkDispatchId) {
            throw new Error('invalid fork dispatch identity');
          }
          claimed = true;
          return setFence(operation, { ...fence, token: randomUUID(), active: { action, ownerId, callId } });
        });
      });
      invoked = true;
      const marker = recovery.get(input.operationId);
      const host = hostFor(input.operationId);
      if (action === 'start' || action === 'retry') await host[action](input.operationId, forkDispatchId);
      else await host[action](input.operationId);
      if (action === 'retryPersistence' && marker && recovery.get(input.operationId) === marker) recovery.delete(input.operationId);
      completed.add(callId);
      await deps.store.update(input.operationId, operation => {
        const fence = fenceOf(operation);
        if (!fence || fence.active?.ownerId !== ownerId || fence.active.callId !== callId) throw new Error('call fence changed');
        return setFence(operation, { ...fence, active: null });
      });
      completed.delete(callId);
      const after = await original(input);
      notify(after);
      return reply(after);
    } catch {
      if (claimed) {
        completed.add(callId);
        try {
          const after = await deps.store.update(input.operationId, operation => {
            const fence = fenceOf(operation);
            if (!fence || fence.active?.ownerId !== ownerId || fence.active.callId !== callId) return operation;
            return setFence(operation, { ...fence, active: null });
          });
          completed.delete(callId);
          notify(after);
        } catch { /* A subsequent scoped read can persist this exact terminal proof. */ }
      }
      throw new SideChatEndpointError(invoked ? '侧聊操作未完成或结果未确认，原记录已保留。'
        : '侧聊操作未派发，请重新读取原记录。', !invoked);
    }
  }

  return { prepare, read,
    start: (input: SideChatEndpointActionInput) => dispatch('start', input),
    retry: (input: SideChatEndpointActionInput) => dispatch('retry', input),
    close: (input: SideChatEndpointActionInput) => dispatch('close', input),
    retryPersistence: (input: SideChatEndpointActionInput) => dispatch('retryPersistence', input) };
}
