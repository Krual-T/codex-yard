import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import WebSocket from 'ws';
import { RpcError } from '../../lib/codex.ts';
import type { CodexConnection } from '../../lib/codex.ts';
import type { LateRpcTerminal } from '../../lib/codex-protocol.ts';
import { record } from './protocol.ts';
import { createSideChatEndpointHost } from './side-chat-host.ts';
import type { SideChatEndpointScope } from './side-chat-host.ts';
import { resolveSideChatParent } from './side-chat-parent.ts';
import { createSideChatStore } from './side-chat-store.ts';
import { readThreadProjectState } from './thread-projects.ts';
import type { ThreadProjectCompatibility } from './thread-projects.ts';
import type { SideChatParentReceipts } from './side-chat-parent-receipts.ts';
import type { StateMutations } from './state-mutations.ts';
import type { SideChatHostAction } from '../renderer/side-chat/types.ts';
import type { SideChatHostView } from '../renderer/side-chat/types.ts';
import type { SideChatBrowserOrigin } from './side-chat-browser-authority.ts';

type Value = Record<string, unknown>;
export interface SideChatBrowserScope extends SideChatEndpointScope {
  page: WebSocket;
  draftId: string;
  action: SideChatHostAction;
}
export interface SideChatBrowserCheck extends SideChatBrowserScope {
  phase: 'claim' | 'fork' | 'inject' | 'unsubscribe';
  attemptId?: string;
}

/** The real browser owner supplies this after its own IDB and close barriers. */
export interface SideChatBrowserAuthority {
  assertCurrent(scope: SideChatBrowserCheck): void;
  prepareChild(scope: SideChatBrowserScope & { childThreadId: string }, view: SideChatHostView): Promise<void>;
  prepareClose(scope: SideChatBrowserScope & { childThreadId: string }): Promise<void>;
  cleanup(scope: SideChatBrowserScope & { childThreadId: string }): Promise<void>;
  ownerStopped(ownerId: string): boolean;
}

interface Options {
  mutations: StateMutations;
  assertStateAvailable(): void;
  readSection(): unknown;
  persistSection(section: unknown): Promise<void>;
  globals: Value;
  compatibility(): ThreadProjectCompatibility;
  receipts: SideChatParentReceipts;
  connections(page: WebSocket): Map<string, CodexConnection> | undefined;
  generation(socket: WebSocket): string;
  validateHost(hostId: string): void;
  forkConfig(hostId: string): Value | undefined;
  authority?: SideChatBrowserAuthority;
  notify(hint: { hostId: string; operationId: string }, except: ReadonlySet<WebSocket>): void;
  notifyPage(page: WebSocket, hint: { hostId: string; operationId: string }): void;
}
interface Binding {
  page: WebSocket;
  hostId: string;
  parentThreadId: string;
  draftId: string;
  connection: CodexConnection;
  socket: WebSocket;
  connectionGeneration: string;
  revision: string;
  project: unknown;
  projectSource: unknown;
  projectStale: boolean;
  forkConfig: Value | undefined;
}
interface Claim { operationId: string; action: SideChatHostAction; value?: { callId: string; token: string; page: WebSocket } }
interface Context { page: WebSocket; binding?: Binding; guard?: Binding; guardConnectionOnly?: boolean;
  claim?: Claim; claimed?: Claim['value'] }
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= 512 && !value.includes('\0');

class BeforeSend extends Error {
  readonly uncertain = false;
  constructor(message: string) { super(message); }
}

/** The only operation state is the existing sideChats section in native-state. */
export function createNativeSideChatParent(options: Options) {
  const ownerId = randomUUID();
  const context = new AsyncLocalStorage<Context>();
  const bindings = new Map<string, Binding>();
  const prepareBindings = new Map<string, Binding>();
  const claims = new Map<string, NonNullable<Claim['value']>>();
  const activeHints = new Map<string, Map<WebSocket, { hostId: string; calls: number; dirty: boolean }>>();

  function beginHints(page: WebSocket, hostId: string, operationId: string): () => void {
    let pages = activeHints.get(operationId);
    if (!pages) activeHints.set(operationId, pages = new Map());
    let entry = pages.get(page);
    if (!entry) pages.set(page, entry = { hostId, calls: 0, dirty: false });
    entry.calls++;
    return () => { entry.calls--; };
  }

  function notify(hint: { hostId: string; operationId: string }): void {
    const pages = activeHints.get(hint.operationId);
    if (pages) for (const entry of pages.values()) entry.dirty = true;
    options.notify(hint, new Set(pages?.keys()));
  }

  function flushNotifications(page: WebSocket): void {
    for (const [operationId, pages] of activeHints) {
      const entry = pages.get(page);
      if (!entry || entry.calls) continue;
      pages.delete(page);
      if (!pages.size) activeHints.delete(operationId);
      if (entry.dirty && page.readyState === WebSocket.OPEN) options.notifyPage(page, { hostId: entry.hostId, operationId });
    }
  }

  function projectState(hostId: string, threadId: string): { project: unknown; source: unknown } {
    const snapshot = readThreadProjectState(options.globals, options.compatibility());
    const unresolved = snapshot.unresolved;
    if (Object.keys(unresolved.unreadable).length || Object.hasOwn(unresolved.assignments, threadId)
      || unresolved.projectless.includes(threadId) || Object.hasOwn(unresolved.outputDirectories, threadId)
      || Object.hasOwn(unresolved.workspaceRoots, threadId)
      || unresolved.qualified.some(item => item.hostId === hostId && (!item.threadId || item.threadId === threadId))) {
      throw new Error('原会话的项目归属尚未核实。');
    }
    const membership = snapshot.memberships.find(item => item.hostId === hostId && item.threadId === threadId);
    if (membership?.assignment && membership.projectless) throw new Error('原会话的项目归属存在冲突。');
    const assignment = membership?.assignment;
    let project: unknown = null, directory: unknown = null;
    if (assignment) {
      const candidates = assignment.projectKind === 'local'
        ? Object.values(record(options.globals['local-projects']))
        : Array.isArray(options.globals['remote-projects']) ? options.globals['remote-projects'] : [];
      const matches = candidates.filter(value => {
        const candidate = record(value);
        return candidate.id === assignment.projectId && (assignment.projectKind === 'local'
          ? hostId === 'local' : candidate.hostId === hostId);
      });
      if (matches.length !== 1) throw new Error('原会话的项目目录尚未核实。');
      project = { assignment, catalog: matches[0] };
      const catalog = record(matches[0]);
      directory = assignment.projectKind === 'local'
        ? { id: catalog.id, rootPaths: catalog.rootPaths }
        : { id: catalog.id, hostId: catalog.hostId, remotePath: catalog.remotePath };
    }
    const same = (item: { hostId: string; threadId: string }) => item.hostId === hostId && item.threadId === threadId;
    return structuredClone({ project, source: { assignment: assignment ?? null, directory, projectless: membership?.projectless ?? false,
      outputDirectory: snapshot.outputDirectories.find(same)?.value ?? null,
      workspaceRoot: snapshot.workspaceRoots.find(same)?.value ?? null } });
  }

  function assertConnection(binding: Binding): void {
    options.validateHost(binding.hostId);
    const connection = options.connections(binding.page)?.get(binding.hostId);
    if (binding.page.readyState !== WebSocket.OPEN || connection !== binding.connection || !connection.connected
      || connection.socket !== binding.socket || binding.socket.readyState !== WebSocket.OPEN
      || options.generation(binding.socket) !== binding.connectionGeneration) throw new BeforeSend('原会话连接已改变。');
  }

  function assertBinding(binding: Binding): void {
    assertConnection(binding);
    options.receipts.assertCurrent(binding.page, binding.hostId, binding.parentThreadId, binding.revision);
    if (binding.projectStale || !isDeepStrictEqual(projectState(binding.hostId, binding.parentThreadId).source, binding.projectSource)
      || !isDeepStrictEqual(options.forkConfig(binding.hostId), binding.forkConfig)) {
      binding.projectStale = true;
      throw new BeforeSend('原会话的项目或宿主设置已改变。');
    }
  }

  function projectsChanged(): void {
    for (const binding of new Set([...bindings.values(), ...prepareBindings.values()])) {
      if (binding.projectStale) continue;
      try {
        if (!isDeepStrictEqual(projectState(binding.hostId, binding.parentThreadId).source, binding.projectSource)) binding.projectStale = true;
      } catch { binding.projectStale = true; }
    }
  }

  const store = createSideChatStore({ mutations: options.mutations,
    read() {
      options.assertStateAvailable();
      const current = context.getStore(), guard = current?.guard;
      if (guard) (current?.guardConnectionOnly ? assertConnection : assertBinding)(guard);
      const section = options.readSection(), claim = current?.claim;
      if (claim) {
        const operation = record(record(record(section).operations)[claim.operationId]);
        const fence = record(operation.endpointFence), active = record(fence.active);
        if (fence.ownerId === ownerId && fence.recovering === false && active.ownerId === ownerId
          && active.action === claim.action && id(active.callId) && id(fence.token)) {
          claim.value = { callId: active.callId, token: fence.token, page: current.page };
        }
      }
      return section;
    },
    persist: options.persistSection,
  });

  function bindingFor(scope: SideChatEndpointScope): Binding {
    const binding = bindings.get(scope.operationId);
    if (!binding || binding.hostId !== scope.hostId || binding.parentThreadId !== scope.parentThreadId
      || binding.connectionGeneration !== scope.connectionGeneration) throw new BeforeSend('原侧聊所属页面或连接已失效。');
    return binding;
  }

  function browserScope(binding: Binding, scope: SideChatEndpointScope, action: SideChatHostAction): SideChatBrowserScope {
    return { ...scope, page: binding.page, draftId: binding.draftId, action };
  }
  function checkBrowser(binding: Binding, scope: SideChatEndpointScope, action: SideChatHostAction,
    phase: SideChatBrowserCheck['phase'], attemptId?: string): void {
    if (!options.authority) throw new BeforeSend('侧聊草稿的持久关联尚未确认。');
    try {
      const result = options.authority.assertCurrent({ ...browserScope(binding, scope, action), phase, ...(attemptId ? { attemptId } : {}) });
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => {});
        throw new Error('The browser authority must be synchronous.');
      }
    }
    catch { throw new BeforeSend('侧聊草稿或页面权限已改变，原记录已保留。'); }
  }

  function operation(scope: SideChatEndpointScope): Value {
    const item = record(record(record(options.readSection()).operations)[scope.operationId]);
    const parent = record(item.parent), fence = record(item.endpointFence), active = record(fence.active);
    const claim = claims.get(scope.operationId);
    if (item.operationId !== scope.operationId || parent.hostId !== scope.hostId || parent.threadId !== scope.parentThreadId
      || parent.connectionGeneration !== scope.connectionGeneration || (item.childId ?? null) !== scope.childThreadId
      || fence.ownerId !== ownerId || fence.recovering !== false || active.ownerId !== ownerId
      || !id(active.callId) || !['start', 'retry', 'close', 'retryPersistence'].includes(String(active.action))
      || !claim || claim.page !== bindingFor(scope).page || claim.callId !== active.callId || claim.token !== fence.token) {
      throw new BeforeSend('原侧聊操作或调用权限已改变。');
    }
    return item;
  }

  async function send(scope: SideChatEndpointScope, method: 'thread/fork' | 'thread/inject_items' | 'thread/unsubscribe',
    params: Value, late: ((terminal: LateRpcTerminal) => void | Promise<void>) | undefined, forkAttempt?: string) {
    let dispatched: { reply: ReturnType<CodexConnection['requestWithCursor']> };
    try {
      let childAttempt: { action: SideChatHostAction; attemptId: string; callId: string; token: string; receipt: unknown } | undefined;
      if (method === 'thread/inject_items') {
        if (!scope.childThreadId || !options.authority) throw new BeforeSend('原侧聊子会话尚未确认。');
        // Observation supplies the existing sanitized projection without rotating the active token.
        const observed = await endpoint.read({ ...scope, purpose: 'observe' });
        childAttempt = await options.mutations.run(() => {
          options.assertStateAvailable();
          const binding = bindingFor(scope); assertBinding(binding);
          const op = operation(scope), fork = record(op.fork), origin = record(fork.receiptOrigin), inject = record(op.inject);
          const fence = record(op.endpointFence), active = record(fence.active);
          const receipt = observed.view.fork.receipt;
          if (observed.token !== null || observed.view.operationId !== scope.operationId
            || observed.view.childId !== scope.childThreadId || observed.view.child?.thread.id !== scope.childThreadId
            || fork.status !== 'received' || inject.status !== 'inflight' || !id(inject.attemptId)
            || !id(active.callId) || !id(fence.token)
            || !receipt || receipt.connectionGeneration !== scope.connectionGeneration
            || !isDeepStrictEqual(receipt, origin)) throw new BeforeSend('原侧聊子会话回执已改变。');
          return { action: active.action as SideChatHostAction, attemptId: inject.attemptId, callId: active.callId,
            token: fence.token, receipt: structuredClone(origin) };
        });
        const binding = bindingFor(scope);
        await options.authority.prepareChild({ ...browserScope(binding, scope, childAttempt.action), childThreadId: scope.childThreadId }, observed.view);
      }
      dispatched = await options.mutations.run(() => {
        const binding = bindingFor(scope);
        if (method === 'thread/unsubscribe') assertConnection(binding); else assertBinding(binding);
        const op = operation(scope), active = record(record(op.endpointFence).active);
        const action = active.action as SideChatHostAction;
        const phase = method === 'thread/fork' ? 'fork' : method === 'thread/inject_items' ? 'inject' : 'unsubscribe';
        const step = record(method === 'thread/fork' ? op.fork : method === 'thread/inject_items' ? op.inject : op.close);
        if (!id(step.attemptId) || step.status !== 'inflight'
          || method === 'thread/fork' && (forkAttempt !== step.attemptId || !['start', 'retry'].includes(action)
            || !isDeepStrictEqual(params, op.forkParams))
          || method === 'thread/inject_items' && (!childAttempt || childAttempt.action !== action || childAttempt.attemptId !== step.attemptId
            || childAttempt.callId !== active.callId || childAttempt.token !== record(op.endpointFence).token
            || !isDeepStrictEqual(childAttempt.receipt, record(op.fork).receiptOrigin)
            || !['start', 'retry', 'retryPersistence'].includes(action)
            || record(op.close).requested !== false || params.threadId !== scope.childThreadId
            || !isDeepStrictEqual(params.items, op.boundaryItems))
          || method === 'thread/unsubscribe' && (!['close', 'retry', 'retryPersistence'].includes(action)
            || record(op.close).requested !== true || params.threadId !== scope.childThreadId)) {
          throw new BeforeSend('原侧聊请求或调用身份已改变。');
        }
        checkBrowser(binding, scope, action, phase, step.attemptId);
        // Send while this interval is held; do not hold it while waiting for the reply.
        return { reply: binding.connection.requestWithCursor(method, params, { mutating: true,
          ...(late ? { onLateTerminal: late, retainLateUntilDisconnect: true } : {}) }) };
      });
    } catch { throw new BeforeSend('原侧聊请求未派发，请重新核对原会话。'); }
    return dispatched.reply;
  }

  const endpoint = createSideChatEndpointHost({
    store, ownerId,
    async withParent(hostId, parentThreadId, run) {
      const current = context.getStore(), binding = current?.binding;
      if (!current || !binding || binding.hostId !== hostId || binding.parentThreadId !== parentThreadId) throw new BeforeSend('原父会话不可用。');
      return context.run({ ...current, guard: binding }, run);
    },
    async resolveParent(hostId, threadId) {
      const binding = context.getStore()?.binding;
      if (!binding || binding.hostId !== hostId || binding.parentThreadId !== threadId) throw new BeforeSend('原父会话不可用。');
      return resolveSideChatParent({ hostId, threadId, connectionGeneration: binding.connectionGeneration }, {
        runScoped: run => options.mutations.run(run),
        capture() {
          assertBinding(binding);
          return { ...options.receipts.assertCurrent(binding.page, hostId, threadId, binding.revision),
            project: structuredClone(binding.project), ...(binding.forkConfig ? { forkConfig: structuredClone(binding.forkConfig) } : {}) };
        },
        assertCurrent(revision) { if (revision !== binding.revision) throw new BeforeSend('原父会话已改变。'); assertBinding(binding); },
        request: (method, params) => binding.connection.request(method, params),
      });
    },
    async withScope(scope, access, run) {
      if (access.kind === 'read') return run();
      const current = context.getStore(), binding = bindingFor(scope);
      if (!current || current.page !== binding.page) throw new BeforeSend('侧聊属于另一页面。');
      const closing = access.action === 'close' || access.action === 'retry' && access.closeRequested;
      await options.mutations.run(() => { (closing ? assertConnection : assertBinding)(binding); checkBrowser(binding, scope, access.action, 'claim'); });
      const claim: Claim = { operationId: scope.operationId, action: access.action };
      const result = await context.run({ ...current, guard: binding, guardConnectionOnly: closing, claim }, run);
      if (!claim.value) throw new BeforeSend('侧聊调用权限尚未确认。');
      claims.set(scope.operationId, claim.value);
      current.claimed = claim.value;
      return result;
    },
    assertDispatch(scope, action, phase) {
      const current = context.getStore(), binding = bindingFor(scope);
      if (!current || current.page !== binding.page) throw new BeforeSend('侧聊属于另一页面。');
      const stored = record(record(record(options.readSection()).operations)[scope.operationId]);
      const closing = action === 'close' || action === 'retry' && record(stored.close).requested === true;
      (closing ? assertConnection : assertBinding)(binding);
      if (phase === 'close-intent') {
        const claimed = current.claimed;
        if (action !== 'close' || !claimed || claims.get(scope.operationId) !== claimed) throw new BeforeSend('原关闭调用权限已改变。');
        operation(scope);
      }
      checkBrowser(binding, scope, action, 'claim');
    },
    canReconcile(scope) {
      try {
        const current = context.getStore(), binding = bindingFor(scope);
        if (!current || current.page !== binding.page) return false;
        assertConnection(binding);
        return true;
      } catch { return false; }
    },
    async request(scope, method, params, mutating, late) {
      if (method === 'config/read' && !('operationId' in scope) && !mutating) {
        const binding = context.getStore()?.binding;
        if (!binding || binding.hostId !== scope.hostId || binding.parentThreadId !== scope.parentThreadId
          || binding.connectionGeneration !== scope.connectionGeneration) throw new BeforeSend('原父会话不可用。');
        const pending = await options.mutations.run(() => {
          assertBinding(binding);
          return { reply: binding.connection.request(method, params) };
        });
        const result = await pending.reply;
        await options.mutations.run(() => assertBinding(binding));
        return result;
      }
      if (!('operationId' in scope) || !mutating || (method !== 'thread/inject_items' && method !== 'thread/unsubscribe')) {
        throw new BeforeSend('无效的侧聊请求。');
      }
      return (await send(scope, method, params, late)).result;
    },
    requestFork: (scope, attemptId, params, late) => send(scope, 'thread/fork', params, late, attemptId),
    classifyFailure(_method, error) {
      if (error instanceof BeforeSend || error instanceof RpcError && error.code === 'OBSERVER_LIMIT') return 'not-sent';
      if (error instanceof RpcError && !error.uncertain && error.code !== undefined && error.code !== 'TIMEOUT') return 'rejected';
      return 'unknown';
    },
    async prepareClose(scope) {
      const binding = bindingFor(scope);
      const action = await options.mutations.run(() => {
        assertConnection(binding);
        return record(record(operation(scope).endpointFence).active).action as SideChatHostAction;
      });
      if (!options.authority) throw new BeforeSend('侧聊草稿尚未冻结。');
      await options.authority.prepareClose({ ...browserScope(binding, scope, action), childThreadId: scope.childThreadId });
    },
    async cleanup(scope) {
      const binding = bindingFor(scope);
      if (!options.authority) throw new BeforeSend('侧聊本地清理尚未确认。');
      const action = await options.mutations.run(() => {
        assertConnection(binding);
        return record(record(operation(scope).endpointFence).active).action as SideChatHostAction;
      });
      await options.authority.cleanup({ ...browserScope(binding, scope, action), childThreadId: scope.childThreadId });
    },
    ownerStopped: oldOwner => options.authority?.ownerStopped(oldOwner) === true,
    notify,
  });

  async function handle(page: WebSocket, params: Value): Promise<unknown> {
    const { hostId, parentThreadId, action } = params;
    if (!id(hostId) || !id(parentThreadId) || !id(action)) throw new BeforeSend('侧聊身份无效。');
    if (action === 'readPrepared') {
      if (!id(params.prepareId)) throw new BeforeSend('侧聊准备身份无效。');
      return endpoint.readPrepared({ hostId, parentThreadId, prepareId: params.prepareId });
    }
    if (action === 'prepare') {
      options.validateHost(hostId);
      if (!id(params.prepareId) || !id(params.draftId)) throw new BeforeSend('侧聊草稿或准备身份无效。');
      try {
        const binding = await options.mutations.run(() => {
          const previous = prepareBindings.get(params.prepareId as string);
          if (previous) {
            if (previous.page !== page || previous.hostId !== hostId || previous.parentThreadId !== parentThreadId
              || previous.draftId !== params.draftId) throw new BeforeSend('原侧聊准备身份已属于另一页面。');
            assertBinding(previous);
            return previous;
          }
          const receipt = options.receipts.current(page, hostId, parentThreadId);
          const connection = options.connections(page)?.get(hostId), socket = connection?.socket;
          if (!receipt || !connection || !socket || options.generation(socket) !== receipt.connectionGeneration) {
            throw new BeforeSend('原父会话尚未确认。');
          }
          const project = projectState(hostId, parentThreadId);
          const result: Binding = { page, hostId, parentThreadId, draftId: params.draftId as string, connection, socket,
            connectionGeneration: receipt.connectionGeneration, revision: receipt.revision,
            project: project.project, projectSource: project.source, projectStale: false,
            forkConfig: structuredClone(options.forkConfig(hostId)) };
          assertBinding(result);
          prepareBindings.set(params.prepareId as string, result);
          return result;
        });
        return await context.run({ page, binding }, async () => {
          const result = await endpoint.prepare({ hostId, parentThreadId, prepareId: params.prepareId as string });
          const saved = await store.read(result.view.operationId);
          return options.mutations.run(() => {
            assertBinding(binding);
            const previous = bindings.get(result.view.operationId);
            if (!saved || saved.parent.connectionGeneration !== binding.connectionGeneration
              || !isDeepStrictEqual(saved.parent.project, binding.project)
              || !isDeepStrictEqual(saved.parent.forkConfig, binding.forkConfig)
              || record(record(saved).endpointFence).ownerId !== ownerId || previous &&
              (previous.page !== page || previous.revision !== binding.revision || previous.draftId !== binding.draftId
                || previous.projectStale)) {
              throw new BeforeSend('原侧聊准备身份已属于另一页面。');
            }
            bindings.set(result.view.operationId, binding);
            return { ...result, connectionGeneration: binding.connectionGeneration };
          });
        });
      } catch (error) {
        throw Object.assign(new Error('侧聊准备结果尚未确认，请核对原准备身份。', { cause: error }), { uncertain: true });
      }
    }
    if (!id(params.operationId)) throw new BeforeSend('侧聊操作身份无效。');
    const input = { hostId, parentThreadId, operationId: params.operationId };
    const call: Context = { page };
    return context.run(call, async () => {
      if (action === 'read') {
        if (params.purpose !== undefined && params.purpose !== 'observe' && params.purpose !== 'reconcile') {
          throw new BeforeSend('侧聊读取用途无效。');
        }
        return endpoint.read({ ...input, ...(params.purpose ? { purpose: params.purpose } : {}) });
      }
      if (!['start', 'retry', 'close', 'retryPersistence'].includes(action)
        || action === 'retryPersistence' && !id(params.connectionGeneration)
        || action !== 'retryPersistence' && !id(params.token)
        || params.forkDispatchId !== undefined && !id(params.forkDispatchId)) throw new BeforeSend('侧聊操作无效。');
      const endHints = beginHints(page, hostId, input.operationId);
      try {
        if (action === 'retryPersistence') {
          return await endpoint.saveCaptured({ ...input, connectionGeneration: params.connectionGeneration as string });
        }
        options.validateHost(hostId);
        return await endpoint[action as SideChatHostAction]({ ...input, token: params.token as string,
          ...(typeof params.forkDispatchId === 'string' ? { forkDispatchId: params.forkDispatchId } : {}) });
      } finally {
        if (call.claimed && claims.get(input.operationId) === call.claimed) claims.delete(input.operationId);
        endHints();
      }
    });
  }

  function forgetPage(page: WebSocket): void {
    for (const [operationId, binding] of bindings) if (binding.page === page) bindings.delete(operationId);
    for (const [prepareId, binding] of prepareBindings) if (binding.page === page) prepareBindings.delete(prepareId);
    for (const [operationId, claim] of claims) if (claim.page === page) claims.delete(operationId);
    for (const [operationId, pages] of activeHints) {
      pages.delete(page);
      if (!pages.size) activeHints.delete(operationId);
    }
  }

  /** Synchronous provider callback; the actual send also rechecks this scope under StateMutations. */
  function assertBrowserOrigin(origin: SideChatBrowserOrigin): void {
    options.assertStateAvailable();
    const identity = origin.identity, binding = bindings.get(identity.operationId);
    const prepared = prepareBindings.get(identity.prepareId), section = record(options.readSection());
    const op = record(record(section.operations)[identity.operationId]), parent = record(op.parent);
    if (!binding || binding !== prepared || binding.page !== origin.page || binding.hostId !== identity.hostId
      || binding.parentThreadId !== identity.parentThreadId || binding.draftId !== identity.draftId
      || binding.connectionGeneration !== identity.connectionGeneration || parent.cwd !== identity.parentCwd
      || section.version !== 1 || record(section.prepared)[identity.prepareId] !== identity.operationId
      || op.operationId !== identity.operationId || parent.hostId !== identity.hostId
      || parent.threadId !== identity.parentThreadId || parent.connectionGeneration !== identity.connectionGeneration
      || (op.childId ?? null) !== identity.childThreadId) throw new BeforeSend('原侧聊浏览器身份已改变。');
    const closing = origin.action === 'close' || origin.action === 'retry' && record(op.close).requested === true;
    (closing ? assertConnection : assertBinding)(binding);
    if (origin.phase === 'challenge' || origin.phase === 'confirm' || origin.phase === 'claim') return;
    const scope: SideChatEndpointScope = { hostId: identity.hostId, parentThreadId: identity.parentThreadId,
      operationId: identity.operationId, connectionGeneration: identity.connectionGeneration, childThreadId: identity.childThreadId };
    const current = operation(scope), active = record(record(current.endpointFence).active);
    if (active.action !== origin.action) throw new BeforeSend('原侧聊调用已改变。');
    if (origin.phase === 'child') {
      const fork = record(current.fork), receipt = record(fork.receiptOrigin);
      if (fork.status !== 'received' || !id(receipt.attemptId) || origin.attemptId && receipt.attemptId !== origin.attemptId
        || receipt.connectionGeneration !== identity.connectionGeneration) throw new BeforeSend('原侧聊子会话回执已改变。');
    }
  }

  async function ownsChild(hostId: string, threadId: string): Promise<boolean> {
    return options.mutations.run(() => {
      options.assertStateAvailable();
      const section = options.readSection();
      if (section === undefined) return false;
      const value = record(section);
      if (value.version !== 1 || !value.operations || typeof value.operations !== 'object' || Array.isArray(value.operations)) {
        throw new BeforeSend('侧聊记录尚未核实，无法退订会话。');
      }
      return Object.values(value.operations).some(raw => {
        const operation = record(raw), parent = record(operation.parent);
        if (!id(parent.hostId) || operation.childId !== undefined && !id(operation.childId)) {
          throw new BeforeSend('侧聊记录尚未核实，无法退订会话。');
        }
        return parent.hostId === hostId && operation.childId === threadId;
      });
    });
  }
  return { handle, forgetPage, ownsChild, projectsChanged, flushNotifications, assertBrowserOrigin };
}
