import { randomUUID } from 'node:crypto';
import type { LateRpcTerminal, ThreadSummary } from '../../lib/codex-protocol.ts';
import type { SubmitOptions } from '../renderer/workbench-contract.ts';
import type { SideChatHostAction, SideChatHostView } from '../renderer/side-chat/types.ts';
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
export interface SideChatEndpointActionInput extends SideChatEndpointInput { token: string }
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

function optionProjection(parent: SideChatParent): SubmitOptions | null {
  const value = parent.submitOptions;
  const options: SubmitOptions = { model: parent.model, effort: parent.effort, serviceTier: parent.serviceTier };
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
  if (value.sandboxMode === 'read-only' || value.sandboxMode === 'workspace-write' || value.sandboxMode === 'danger-full-access') {
    options.sandboxMode = value.sandboxMode;
  }
  if (value.approvalsReviewer === 'user' || value.approvalsReviewer === 'auto_review' || value.approvalsReviewer === 'guardian_subagent') {
    options.approvalsReviewer = value.approvalsReviewer;
  }
  if (!options.approvalsReviewer || value.sandboxMode != null && !options.sandboxMode) return null;
  if (value.permissionProfileId != null && !nonempty(value.permissionProfileId)) return null;
  if (typeof value.permissionProfileId === 'string') options.permissionProfileId = value.permissionProfileId;
  if (value.mode != null && value.mode !== 'default' && value.mode !== 'plan') return null;
  if (value.mode === 'default' || value.mode === 'plan') options.mode = value.mode;
  return options;
}

function childThread(operation: SideChatOperation): ThreadSummary | null {
  const receipt = operation.fork.receipt;
  if (operation.fork.status !== 'received' || !isObject(receipt) || !isObject(receipt.thread)) return null;
  const thread = receipt.thread;
  if (thread.id !== operation.childId || thread.cwd !== operation.parent.cwd
    || !(typeof thread.name === 'string' || thread.name === null)
    || !Array.isArray(thread.turns) || thread.turns.length !== 0 || !isObject(thread.status)) return null;
  const status = thread.status;
  if (status.type === 'idle' || status.type === 'notLoaded' || status.type === 'systemError') {
    return { id: thread.id as string, name: thread.name, cwd: thread.cwd, turns: [], status: { type: status.type } };
  }
  if (status.type === 'active' && Array.isArray(status.activeFlags) && status.activeFlags.every(flag => typeof flag === 'string')) {
    return { id: thread.id as string, name: thread.name, cwd: thread.cwd, turns: [],
      status: { type: 'active', activeFlags: [...status.activeFlags] as string[] } };
  }
  return null;
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
  const thread = childThread(operation);
  const options = optionProjection(operation.parent);
  return {
    operationId: operation.operationId,
    parent: { hostId: operation.parent.hostId, threadId: operation.parent.threadId, cwd: operation.parent.cwd },
    childId: operation.childId ?? null,
    child: thread && options ? { thread, options } : null,
    fork: { status: operation.fork.status, error: operation.fork.status === 'received' && (!thread || !options)
      ? '子会话初始信息无法安全读取，原回执已保留。'
      : requestError(operation.fork.status, '创建侧聊', !!operation.fork.error) },
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
    let invoked = false;
    let claimed = false;
    let scope: SideChatEndpointScope | undefined;
    try {
      if (!input || !nonempty(input.token)) throw new Error('missing token');
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
          claimed = true;
          return setFence(operation, { ...fence, token: randomUUID(), active: { action, ownerId, callId } });
        });
      });
      invoked = true;
      const marker = recovery.get(input.operationId);
      await hostFor(input.operationId)[action](input.operationId);
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
