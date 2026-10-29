import { SideChatBrowserAuthorityBridge, readSideChatDraftAssociation } from '../side-chat/browser-authority.ts';
import type { SideChatBrowserIdentity, SideChatChildDispatchAuthority, SideChatDraftIdentity, SideChatSendLease } from '../side-chat/browser-authority.ts';
import { SideChatController } from '../side-chat/controller.ts';
import type { SideChatHostAction, SideChatHostPort, SideChatHostView, SideChatReadPurpose, SideChatScope } from '../side-chat/types.ts';
import type { ComposerDraftController, ComposerDraftOwner } from '../composer/StandaloneComposer.tsx';
import type { WorkbenchClient } from '../workbench-contract.ts';
import type { ConversationSessions } from './conversation-sessions.ts';
import type { SendRecoveryStore } from './send-recovery.ts';

export interface SideChatWorkspaceIdentity extends SideChatDraftIdentity { cwd: string; mode: 'new' | 'restore' }
export interface SideChatWorkspaceRuntimeOptions {
  client: WorkbenchClient;
  identity: SideChatWorkspaceIdentity;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  /** Synchronous guard captured for the original page, parent, socket and owner. */
  assertCurrent(): void;
  freezeSending(owner: ComposerDraftOwner): SideChatSendLease;
  draftController(): ComposerDraftController | null;
  cleanupChild(identity: SideChatBrowserIdentity): Promise<void>;
}
type Reply = { view: SideChatHostView; token?: string | null; connectionGeneration?: string };
type Call = { action: 'start' | 'retry' | 'close'; operationId: string; settled: boolean };
const notSent = (text: string) => Object.assign(new Error(text), { uncertain: false as const });
const definitelyNotSent = (error: unknown) => !!error && typeof error === 'object' && 'uncertain' in error && error.uncertain === false;
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** One original page and one durable draft; never transfers a restored operation's write grant. */
export class SideChatWorkspaceRuntime {
  readonly bridge: SideChatBrowserAuthorityBridge;
  controller: SideChatController | null = null;
  private readonly options: SideChatWorkspaceRuntimeOptions;
  private generation: string | null = null;
  private token: string | null = null;
  private tokenVersion = 0;
  private prepareUnknown = false;
  private preparePending = false;
  private dispatching = 0;
  private hostFreeze: 'close' | 'navigation' | null = null;
  private newInitializationStarted = false;
  private original = true;
  private invalidated = false;
  private bridgeConnected = false;
  private hostConnected = false;
  private projectionRevision = 0;
  private readonly projectionListeners = new Set<() => void>();
  private lastCall: Call | null = null;
  private readonly unsubscribe: () => void;

  constructor(options: SideChatWorkspaceRuntimeOptions) {
    this.options = { ...options, identity: structuredClone(options.identity) };
    const { client, identity, sessions, sends } = this.options;
    this.original = identity.mode === 'new';
    this.bridgeConnected = 'connected' in client && client.connected === true;
    this.bridge = new SideChatBrowserAuthorityBridge({ client, identity, cwd: identity.cwd, sessions, sendStore: sends,
      assertCurrent: options.assertCurrent, freezeSending: options.freezeSending, draftController: options.draftController,
      cleanupChild: options.cleanupChild, onChildInstalled: () => {
        this.projectionRevision++; for (const listener of this.projectionListeners) listener();
      } });
    this.unsubscribe = client.subscribe(event => {
      if (event.type === 'connection-state') {
        if (event.state === 'connected') this.bridgeConnected = true;
        else if (this.bridgeConnected) this.invalidate();
      } else if (event.type === 'codex-app-server-connection-changed' && event.hostId === identity.hostId) {
        if (event.state === 'connected') this.hostConnected = true;
        else if (this.hostConnected) this.invalidate();
      }
    });
  }
  private invalidate(): void {
    this.invalidated = true; this.original = false; this.token = null; this.tokenVersion++; this.bridge.invalidate();
    this.projectionRevision++; for (const listener of this.projectionListeners) listener();
  }
  readonly subscribeProjection = (listener: () => void): (() => void) => {
    this.projectionListeners.add(listener); return () => { this.projectionListeners.delete(listener); };
  };
  readonly projectionSnapshot = (): number => this.projectionRevision;
  private checked(reply: Reply, operationId?: string): Reply {
    const { identity } = this.options, view = reply?.view;
    if (!view || !nonempty(view.operationId) || operationId && view.operationId !== operationId
      || view.parent?.hostId !== identity.hostId || view.parent.threadId !== identity.parentThreadId || view.parent.cwd !== identity.cwd
      || !(reply.token == null || nonempty(reply.token))) throw new Error('侧聊宿主回执与原父会话不一致。');
    return reply;
  }
  private base() {
    const identity = this.options.identity;
    return { hostId: identity.hostId, parentThreadId: identity.parentThreadId };
  }
  private storeToken(reply: Reply, expected: number): void {
    if (this.original && nonempty(reply.token) && this.tokenVersion === expected) {
      this.options.assertCurrent(); this.token = reply.token; this.tokenVersion++;
    }
  }
  private canDispatch = (_scope: SideChatScope, action: 'advance' | 'close' | 'persistence'): boolean => {
    if (action === 'persistence') return !!this.generation;
    if (this.hostFreeze === 'navigation' || this.hostFreeze === 'close' && action === 'advance'
      && !this.controller?.getSnapshot().view?.close.requested) return false;
    if (!this.original || !this.token) return false;
    try { this.options.assertCurrent(); return true; } catch { return false; }
  };
  private readonly port: SideChatHostPort = {
    prepare: async () => {
      const { identity, client } = this.options;
      if (this.hostFreeze) throw notSent('原侧聊正在冻结，准备操作未派发。');
      if (this.prepareUnknown) {
        const recovered = await client.host<Reply | null>('side-chat', { action: 'readPrepared', ...this.base(), prepareId: identity.prepareId });
        if (!recovered) throw new Error('原准备结果尚未确认；不会再次创建侧聊。');
        const reply = this.checked(recovered);
        if (!nonempty(reply.connectionGeneration)) throw new Error('原连接代次无法确认。');
        this.generation = reply.connectionGeneration; this.original = false; this.token = null;
        return reply.view;
      }
      this.options.assertCurrent();
      this.preparePending = true;
      try {
        const version = this.tokenVersion;
        const reply = this.checked(await client.host<Reply>('side-chat', { action: 'prepare', ...this.base(),
          draftId: identity.draftId, prepareId: identity.prepareId }, { assertBeforeSend: () => {
            this.options.assertCurrent(); if (this.hostFreeze) throw notSent('原侧聊正在冻结，准备操作未派发。');
          } }));
        if (!nonempty(reply.connectionGeneration) || !nonempty(reply.token)) throw new Error('原准备回执缺少连接代次或 token。');
        this.generation = reply.connectionGeneration; this.storeToken(reply, version);
        return reply.view;
      } catch (error) {
        if (!definitelyNotSent(error)) this.prepareUnknown = true;
        throw error;
      } finally { this.preparePending = false; }
    },
    read: async (operationId, purpose = 'observe') => {
      const version = this.tokenVersion;
      const prior = this.lastCall;
      const reply = this.checked(await this.options.client.host<Reply>('side-chat', { action: 'read', ...this.base(), operationId, purpose }), operationId);
      if (purpose === 'reconcile') {
        if (prior && this.lastCall === prior && reply.view.settledCalls?.[prior.action] === true) prior.settled = true;
        if (reply.token) this.storeToken(reply, version);
      }
      return reply.view;
    },
    start: operationId => this.dispatch('start', operationId),
    retry: operationId => this.dispatch('retry', operationId),
    close: operationId => this.dispatch('close', operationId),
    retryPersistence: async operationId => {
      const generation = this.generation;
      if (!generation) throw notSent('原侧聊连接代次尚未确认。');
      const reply = this.checked(await this.options.client.host<Reply>('side-chat', { action: 'retryPersistence', ...this.base(),
        operationId, connectionGeneration: generation }), operationId);
      return reply.view;
    },
    subscribe: listener => this.options.client.subscribe(event => {
      if (event.type === 'side-chat-updated' && nonempty(event.hostId) && nonempty(event.operationId)) {
        listener({ hostId: event.hostId, operationId: event.operationId });
      }
    }),
  };

  private async releasePrevious(view: SideChatHostView): Promise<void> {
    if (!this.bridge.hasRegistration) return;
    const call = this.lastCall;
    if (!call || !call.settled || call.operationId !== view.operationId) throw notSent('原侧聊调用尚未核对，不能继续派发。');
    const assertSettled = () => {
      this.options.assertCurrent();
      if (this.lastCall !== call || !call.settled || this.controller?.getSnapshot().view?.operationId !== call.operationId) {
        throw notSent('原侧聊调用证明已改变。');
      }
    };
    if (this.bridge.hasPendingChildCapture && view.childId) await this.bridge.recoverChild(view, assertSettled);
    assertSettled(); await this.bridge.revoke(); assertSettled();
  }
  private async dispatch(action: Call['action'], operationId: string): Promise<SideChatHostView> {
    // This token belongs to this particular click, before any authority or IDB wait.
    const token = this.token, version = this.tokenVersion, view = this.controller?.getSnapshot().view;
    if (!this.original || !token || !view || view.operationId !== operationId) throw notSent('原侧聊派发权限不可用。');
    const assertToken = () => {
      this.options.assertCurrent();
      if (this.hostFreeze === 'navigation' || this.hostFreeze === 'close' && action !== 'close'
        && !(action === 'retry' && view.close.requested)) throw notSent('原侧聊正在冻结，操作未派发。');
      if (!this.original || this.tokenVersion !== version || this.token !== token) throw notSent('原侧聊 token 已改变。');
    };
    assertToken();
    this.dispatching++;
    try {
    await this.releasePrevious(view);
    assertToken();
    const forkNeeded = action !== 'close' && !view.close.requested && (view.fork.status === 'waiting' || view.fork.status === 'not-sent');
    const forkDispatchId = forkNeeded ? crypto.randomUUID() : undefined;
    let forkUnsent = true;
    try {
      await this.bridge.authorize(action, forkDispatchId ? { forkDispatchId, isForkUnsent: () => forkUnsent } : undefined);
      assertToken(); this.bridge.assertAuthorized(action);
    } catch (error) {
      if (this.bridge.hasRegistration) {
        try { await this.bridge.revoke(); } catch { throw new Error('原侧聊确认撤销结果未知，原记录已保留。'); }
      }
      throw notSent(error instanceof Error ? error.message : String(error));
    }
    const call: Call = { action, operationId, settled: false }; this.lastCall = call;
    try {
      forkUnsent = false;
      const reply = this.checked(await this.options.client.host<Reply>('side-chat', { action, ...this.base(), operationId, token,
        ...(forkDispatchId ? { forkDispatchId } : {}) }, { assertBeforeSend: () => { assertToken(); this.bridge.assertAuthorized(action); } }), operationId);
      call.settled = true;
      this.storeToken(reply, version);
      if (this.bridge.hasPendingChildCapture && (reply.view.childId || ['unknown', 'inflight'].includes(reply.view.fork.status))) return reply.view;
      if (action !== 'close' && reply.view.childId && reply.view.fork.status === 'received'
        && reply.view.inject.status === 'received' && !reply.view.close.requested && reply.view.close.status === 'idle') {
        this.bridge.captureChildDispatch(reply.view.childId).assertCurrent();
        return reply.view;
      }
      if (reply.view.close.status === 'closed' && !reply.view.childId) {
        await this.bridge.completeEmptyClose(() => {
          if (this.lastCall !== call || !call.settled || reply.view.close.status !== 'closed' || reply.view.childId
            || !['waiting', 'not-sent'].includes(reply.view.fork.status)) throw new Error('原无子侧聊关闭尚未确认。');
        });
      } else await this.bridge.revoke();
      return reply.view;
    } catch (error) {
      if (call.settled) throw new Error('原操作已返回，但浏览器确认尚未撤销；原记录已保留。', { cause: error });
      if (definitelyNotSent(error)) {
        call.settled = true;
        try { await this.bridge.revoke(); } catch { throw new Error('原操作未派发，但浏览器确认撤销结果未知。', { cause: error }); }
      }
      throw error;
    }
    } finally { this.dispatching--; }
  }

  async initialize(): Promise<SideChatController> {
    if (this.controller) return this.controller;
    const { identity, client, sessions } = this.options;
    let saved = await readSideChatDraftAssociation(identity), restored: SideChatHostView | undefined;
    if (identity.mode === 'new') {
      if (saved && !this.newInitializationStarted) throw new Error('此草稿已有原侧聊关联，请按原身份恢复。');
      this.newInitializationStarted = true;
      await this.bridge.initialize();
    } else {
      if (!saved) throw new Error('原侧聊草稿关联不存在，未创建新侧聊。');
      const found = await client.host<Reply | null>('side-chat', { action: 'readPrepared', ...this.base(), prepareId: identity.prepareId });
      if (!found) throw new Error('原侧聊准备结果尚未确认；不会再次创建。');
      const reply = this.checked(found, saved.operationId ?? undefined);
      if (!nonempty(reply.connectionGeneration) || saved.connectionGeneration && saved.connectionGeneration !== reply.connectionGeneration
        || saved.parentCwd && saved.parentCwd !== reply.view.parent.cwd || saved.childThreadId && saved.childThreadId !== reply.view.childId) {
        throw new Error('原侧聊准备关联与宿主记录不一致。');
      }
      this.generation = reply.connectionGeneration;
      if (!saved.operationId) {
        await this.bridge.linkPrepared({ ...this.base(), operationId: reply.view.operationId, draftId: identity.draftId }, this.generation, identity.cwd);
        saved = await readSideChatDraftAssociation(identity);
      }
      if (!saved) throw new Error('原侧聊草稿关联尚未确认。');
      await this.bridge.restoreLinked(saved);
      restored = reply.view;
      if (restored.child && restored.fork.receipt && saved?.childThreadId === restored.childId) {
        sessions.registerUnavailableEphemeral({ ...this.base(), parentCwd: identity.cwd, operationId: restored.operationId,
          connectionGeneration: restored.fork.receipt.connectionGeneration, forkDispatchId: restored.fork.receipt.attemptId }, restored.child);
      }
    }
    const controller = new SideChatController({ ...this.base(), draftId: identity.draftId, port: this.port, canDispatch: this.canDispatch,
      onPrepared: async scope => {
        if (!this.generation) throw new Error('原侧聊连接代次尚未确认。');
        await this.bridge.linkPrepared(scope, this.generation, identity.cwd);
        this.prepareUnknown = false;
      }, ...(restored ? { restored } : {}) });
    this.controller = controller;
    return controller;
  }
  /** Only a locally proven, never-dispatched or terminal empty prepare may be abandoned. */
  assertUnpreparedClose(): void {
    this.options.assertCurrent();
    if (this.preparePending || this.prepareUnknown || this.controller?.getSnapshot().phase === 'preparing'
      || this.controller?.getSnapshot().view) {
      throw new Error('原侧聊准备结果尚未确认，草稿已保留。');
    }
  }
  get needsPrepareReconciliation(): boolean { return this.prepareUnknown && !this.controller?.getSnapshot().view; }
  /** A restored or recovered page may exit locally, but does not close the host operation. */
  canExitObservation(scope: SideChatScope & { childThreadId: string | null }): boolean {
    const { identity } = this.options, view = this.controller?.getSnapshot().view;
    return !this.original && !this.invalidated && !this.preparePending && !this.prepareUnknown && !this.dispatching
      && !this.lastCall && !this.bridge.hasRegistration && !!view && !view.close.requested && view.close.status !== 'closed'
      && scope.hostId === identity.hostId && scope.parentThreadId === identity.parentThreadId && scope.draftId === identity.draftId
      && scope.operationId === view.operationId && scope.childThreadId === view.childId
      && this.bridge.hasLinkedOperation(view.operationId);
  }
  assertScope(): void { this.options.assertCurrent(); }
  /** A write stays tied to this page, child, original connection and confirmed challenge. */
  captureChildDispatch(childThreadId: string): SideChatChildDispatchAuthority {
    const snapshot = this.controller?.getSnapshot(), view = snapshot?.view;
    const verify = () => {
      this.options.assertCurrent();
      const current = this.controller?.getSnapshot();
      if (!this.original || this.invalidated || this.hostFreeze || this.dispatching || !view || !current?.view
        || current.view.operationId !== view.operationId || current.view.childId !== childThreadId
        || current.phase !== 'ready' || current.pendingClose || current.view.close.requested
        || !this.lastCall?.settled || this.lastCall.operationId !== view.operationId) {
        throw notSent('原侧聊子会话写入权限尚未确认。');
      }
    };
    verify();
    const authority = this.bridge.captureChildDispatch(childThreadId);
    return { proof: authority.proof, assertCurrent: () => { verify(); authority.assertCurrent(); } };
  }
  get needsChildAuthorization(): boolean {
    const current = this.controller?.getSnapshot();
    return this.original && !this.invalidated && !this.hostFreeze && !this.dispatching && !!this.token
      && current?.phase === 'ready' && !current.pendingClose && !!current.view?.childId && !current.view.close.requested
      && !!this.lastCall?.settled && !this.bridge.hasRegistration && this.bridge.hasLiveChild(current.view.childId);
  }
  /** Reconfirm the same live original child after an acknowledged revocation, without a host operation. */
  async authorizeChild(): Promise<void> {
    if (!this.needsChildAuthorization) return;
    const view = this.controller!.getSnapshot().view!, token = this.token, version = this.tokenVersion, call = this.lastCall;
    const check = () => {
      this.options.assertCurrent();
      const current = this.controller?.getSnapshot();
      if (!this.original || this.invalidated || this.hostFreeze || this.token !== token || this.tokenVersion !== version
        || this.lastCall !== call || !call?.settled || current?.phase !== 'ready' || current.pendingClose
        || current.view?.operationId !== view.operationId || current.view.childId !== view.childId || current.view.close.requested) {
        throw notSent('原侧聊在重新确认期间已改变。');
      }
    };
    check(); this.dispatching++;
    try {
      await this.bridge.authorize('retry'); check(); this.bridge.captureChildDispatch(view.childId!).assertCurrent();
    } catch (error) {
      if (this.bridge.hasRegistration) {
        try { await this.bridge.revoke(); } catch { throw new Error('侧聊重新确认的撤销结果未知，原稿已保留。'); }
      }
      throw error;
    } finally {
      this.dispatching--;
      this.projectionRevision++; for (const listener of this.projectionListeners) listener();
    }
  }
  /** Freeze host actions synchronously before a close or route change can wait. */
  freezeHostOperations(kind: 'close' | 'navigation'): () => void {
    this.options.assertCurrent();
    if (this.hostFreeze) throw notSent('原侧聊操作已经冻结。');
    this.hostFreeze = kind;
    return () => { if (this.hostFreeze === kind) this.hostFreeze = null; };
  }
  assertHandoffReady(): void {
    this.options.assertCurrent();
    if (this.invalidated) throw notSent('原页面连接已失效，撤权尚未确认；草稿保持挂载。');
    if (this.preparePending || this.prepareUnknown || this.dispatching) throw notSent('原侧聊操作尚未确定终结，不能移交。');
    const view = this.controller?.getSnapshot().view;
    if (view && !this.bridge.hasLinkedOperation(view.operationId)) throw notSent('原侧聊与草稿尚未确认关联，不能移交。');
  }
  /** Parent must freeze and drain, then revoke before an actual handoff or unmount. */
  async revokeForHandoff(): Promise<void> {
    if (this.invalidated) throw new Error('原页面连接已失效，撤权尚未确认；草稿保持挂载。');
    const view = this.controller?.getSnapshot().view;
    if (this.bridge.hasRegistration) {
      if (!view || !this.lastCall?.settled) throw new Error('原侧聊调用尚未核对，不能移交。');
      await this.releasePrevious(view);
    }
  }
  async finishClosed(): Promise<void> {
    const view = this.controller?.getSnapshot().view;
    if (!view) {
      this.assertUnpreparedClose();
      this.bridge.releaseUndispatchedClose(() => this.assertUnpreparedClose());
      return;
    }
    const assertClosed = () => {
      this.options.assertCurrent();
      const latest = this.controller?.getSnapshot().view;
      if (!latest || latest.operationId !== view.operationId || latest.close.status !== 'closed'
        || this.lastCall && !this.lastCall.settled) throw new Error('原侧聊关闭尚未确定终结。');
    };
    assertClosed(); await this.revokeForHandoff(); assertClosed();
    if (this.bridge.hasCloseLease) await this.bridge.cancelClose(assertClosed);
  }
  dispose(): void { this.bridge.dispose(); this.controller?.dispose(); this.unsubscribe(); this.projectionListeners.clear(); }
}
