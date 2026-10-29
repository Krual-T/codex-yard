import type { SideChatControllerOptions, SideChatHostAction, SideChatHostPort, SideChatHostView, SideChatPhase, SideChatReadPurpose, SideChatScope, SideChatSnapshot } from './types.ts';

const requestStatuses = new Set(['waiting', 'inflight', 'not-sent', 'rejected', 'unknown', 'received', 'invalid']);
const closeStatuses = new Set(['idle', 'preparing', 'prepare-failed', 'inflight', 'not-sent', 'rejected', 'unknown', 'cleanup-pending', 'cleaning', 'closed']);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const notDispatched = (error: unknown): boolean => !!error && typeof error === 'object'
  && 'uncertain' in error && error.uncertain === false;

function phase(view: SideChatHostView | null, command: string | null, linkFailed: boolean, pendingClose: boolean, closeDispatched: boolean): SideChatPhase {
  if (!view) return command === 'prepare' ? 'preparing' : 'idle';
  if (linkFailed) return 'link-failed';
  if (view.close.status === 'closed') return 'closed';
  if (view.close.requested || pendingClose) {
    if (closeDispatched && !view.close.requested) return 'close-unknown';
    if (view.close.status === 'unknown') return 'close-unknown';
    if (['prepare-failed', 'not-sent', 'rejected'].includes(view.close.status)
      || view.close.status === 'cleanup-pending' && view.close.error) return 'close-failed';
    return 'closing';
  }
  if (command === 'start' && view.fork.status === 'waiting') return 'starting';
  if (view.fork.status === 'waiting') return 'waiting';
  if (view.fork.status === 'inflight') return 'forking';
  if (view.fork.status === 'unknown') return 'fork-unknown';
  if (view.fork.status !== 'received') return 'fork-failed';
  if (view.inject.status === 'waiting' || view.inject.status === 'inflight') return 'injecting';
  if (view.inject.status === 'unknown') return 'inject-unknown';
  if (view.inject.status !== 'received') return 'inject-failed';
  return view.child ? 'ready' : 'inject-failed';
}

function validate(view: SideChatHostView, hostId: string, parentThreadId: string, previous: SideChatHostView | null): SideChatHostView {
  if (!view || typeof view.operationId !== 'string' || !view.operationId || !view.parent || view.parent.hostId !== hostId || view.parent.threadId !== parentThreadId
    || typeof view.parent.cwd !== 'string' || !view.parent.cwd
    || !requestStatuses.has(view.fork?.status) || !requestStatuses.has(view.inject?.status) || !closeStatuses.has(view.close?.status)
    || [view.fork.error, view.inject.error, view.close.error, view.recoveryError].some(error => error !== null && typeof error !== 'string')
    || typeof view.close.requested !== 'boolean'
    || !(view.childId === null || typeof view.childId === 'string' && !!view.childId && view.childId !== parentThreadId)
    || view.child != null && (!view.childId || view.child.thread?.id !== view.childId || !view.child.options || view.fork.status !== 'received')
    || view.inject.status === 'received' && view.fork.status !== 'received'
    || previous && (previous.operationId !== view.operationId || previous.parent.hostId !== view.parent.hostId
      || previous.parent.threadId !== view.parent.threadId || previous.parent.cwd !== view.parent.cwd
      || previous.childId != null && previous.childId !== view.childId
      || previous.child != null && view.child == null || previous.fork.status === 'received' && view.fork.status !== 'received'
      || previous.inject.status === 'received' && view.inject.status !== 'received'
      || previous.close.requested && !view.close.requested || previous.close.status === 'closed' && view.close.status !== 'closed')) {
    throw new Error('侧聊宿主记录与原会话身份不匹配，已保留原记录。');
  }
  return structuredClone(view);
}

/** One controller is owned by one parent and outlives its panel's visibility. */
export class SideChatController {
  private value: SideChatSnapshot;
  private readonly port: SideChatHostPort;
  private readonly onPrepared: SideChatControllerOptions['onPrepared'];
  private readonly canDispatch: SideChatControllerOptions['canDispatch'];
  private linked: boolean;
  private linkFailed = false;
  private command: string | null = null;
  private closeInFlight = false;
  private closeDispatched = false;
  private linking: Promise<boolean> | null = null;
  private uncertain = new Map<SideChatHostAction, { error: string }>();
  private persistenceInFlight = false;
  private requestVersion = 0;
  private reconciling = false;
  private reconciliation: Promise<void> | null = null;
  private observationPending = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  private unwatch: () => void;

  constructor({ hostId, parentThreadId, draftId, port, onPrepared, canDispatch, restored }: SideChatControllerOptions) {
    if (!hostId || !parentThreadId || !draftId) throw new Error('侧聊缺少父会话或草稿身份。');
    this.port = port;
    this.onPrepared = onPrepared;
    this.canDispatch = canDispatch;
    const view = restored ? validate(restored, hostId, parentThreadId, null) : null;
    this.linked = !!view;
    this.value = { hostId, parentThreadId, draftId, view, phase: phase(view, null, false, false, false),
      error: null, pendingClose: false, hasActivity: false };
    this.unwatch = port.subscribe(hint => {
      if (hint.hostId === this.value.hostId && hint.operationId === this.value.view?.operationId) void this.observe();
    });
  }
  getSnapshot = (): SideChatSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get canRetry(): boolean {
    const view = this.value.view;
    if (this.linkFailed) return true;
    if (!view || this.uncertain.size || this.command || this.closeInFlight || this.persistenceInFlight) return false;
    if (this.value.pendingClose && !view.close.requested) return !this.closeDispatched && this.permitted(view, 'close');
    if (!this.permitted(view, 'advance')) return false;
    return view.close.requested ? ['prepare-failed', 'not-sent', 'cleanup-pending'].includes(view.close.status)
      : view.fork.status === 'waiting' || view.fork.status === 'not-sent'
        || view.fork.status === 'received' && ['waiting', 'not-sent'].includes(view.inject.status);
  }
  get canRetryPersistence(): boolean {
    const view = this.value.view;
    return !!view && this.linked && !this.persistenceInFlight && !this.uncertain.has('retryPersistence')
      && this.permitted(view, 'persistence');
  }
  dispose(): void { this.disposed = true; this.unwatch(); this.listeners.clear(); }
  private set(patch: Partial<SideChatSnapshot>): void {
    if (this.disposed) return;
    const next = { ...this.value, ...patch };
    next.phase = phase(next.view, this.command, this.linkFailed, next.pendingClose, this.closeDispatched);
    this.value = next;
    for (const listener of this.listeners) listener();
  }
  private scope(view: SideChatHostView): SideChatScope {
    return { hostId: this.value.hostId, parentThreadId: this.value.parentThreadId, operationId: view.operationId, draftId: this.value.draftId };
  }
  private permitted(view: SideChatHostView, action: 'advance' | 'close' | 'persistence'): boolean {
    try { return this.canDispatch(this.scope(view), action) === true; } catch { return false; }
  }
  private uncertainError(): string | null { return [...this.uncertain.values()].at(-1)?.error ?? null; }
  private accept(view: SideChatHostView, version: number, readUncertain?: Map<SideChatHostAction, { error: string }>, observe = false): void {
    if (this.disposed || version !== this.requestVersion) return;
    const next = validate(view, this.value.hostId, this.value.parentThreadId, this.value.view);
    if (observe) delete next.settledCalls;
    for (const [action, pending] of readUncertain ?? []) {
      if (this.uncertain.get(action) !== pending || next.settledCalls?.[action] !== true) continue;
      this.uncertain.delete(action);
      if (action === 'close' && !next.close.requested) this.closeDispatched = false;
    }
    this.set({ view: next, error: this.uncertainError() });
  }
  private async call(method: 'start' | 'read' | 'retry' | 'close' | 'retryPersistence', purpose?: SideChatReadPurpose): Promise<void> {
    const view = this.value.view;
    if (!view || this.disposed) return;
    const version = ++this.requestVersion;
    const readUncertain = method === 'read' && purpose === 'reconcile' ? new Map(this.uncertain) : undefined;
    try {
      const result = method === 'read' ? await this.port.read(view.operationId, purpose ?? 'observe') : await this.port[method](view.operationId);
      this.accept(result, version, readUncertain, method === 'read' && purpose !== 'reconcile');
      if (method !== 'read' && version !== this.requestVersion && !this.disposed) void this.observe();
    } catch (error) {
      if (!this.disposed) {
        const unsent = method !== 'read' && notDispatched(error);
        const text = (unsent ? '宿主调用尚未派发，可以显式继续：' : '宿主操作结果未确认，原记录已保留：') + message(error);
        if (unsent && method === 'close' && !this.value.view?.close.requested) this.closeDispatched = false;
        if (!unsent && method !== 'read') this.uncertain.set(method, { error: text });
        if (version === this.requestVersion || this.uncertain.size) this.set({ error: this.uncertainError() ?? text });
      }
      if (method !== 'read' && version !== this.requestVersion && !this.disposed) void this.observe();
    }
  }
  private async observe(): Promise<void> {
    if (this.reconciling) { this.observationPending = true; return; }
    await this.call('read', 'observe');
  }
  /** User-requested reconciliation; notifications and stale replies only observe. */
  read(): Promise<void> {
    if (this.reconciling) return this.reconciliation ?? Promise.resolve();
    this.reconciling = true;
    const pending = this.call('read', 'reconcile');
    this.reconciliation = pending.finally(() => {
      this.reconciling = false; this.reconciliation = null;
      if (this.observationPending && !this.disposed) {
        this.observationPending = false; void this.observe();
      }
    });
    return this.reconciliation;
  }
  private link(): Promise<boolean> {
    const view = this.value.view;
    if (!view || this.linked) return Promise.resolve(!!view);
    if (this.linking) return this.linking;
    this.linking = Promise.resolve().then(async () => {
      try {
        await this.onPrepared(this.scope(view));
        if (this.disposed) return false;
        this.linked = true; this.linkFailed = false; this.set({ error: null });
        return true;
      } catch (error) {
        this.linkFailed = true; this.set({ error: '无法保存侧聊与草稿的关联，尚未创建侧聊：' + message(error) });
        return false;
      } finally { this.linking = null; }
    });
    return this.linking;
  }
  async start(): Promise<void> {
    if (this.disposed || this.command || this.value.pendingClose || this.value.view) return;
    this.command = 'prepare'; this.set({ error: null });
    try {
      const version = ++this.requestVersion;
      const view = await this.port.prepare(this.value.hostId, this.value.parentThreadId);
      this.accept(view, version);
      if (!this.value.view || !await this.link()) return;
      if (this.value.pendingClose) { await this.dispatchClose(); return; }
      if (!this.permitted(this.value.view, 'advance')) {
        this.set({ error: '上一次宿主调用尚未确认，侧聊记录已保留。' }); return;
      }
      this.command = 'start'; this.set({});
      await this.call('start');
    } catch (error) { this.set({ error: '无法准备侧聊：' + message(error) }); }
    finally { this.command = null; this.set({}); }
  }
  /** Explicitly advance only states permitted by E's retry implementation. */
  async retry(): Promise<void> {
    if (this.disposed || this.command || this.closeInFlight || this.uncertain.size || this.persistenceInFlight) return;
    if (!this.value.view) return this.start();
    if (!this.linked && !await this.link()) return;
    const view = this.value.view;
    if (this.value.pendingClose && !view.close.requested) {
      if (!this.closeDispatched) await this.dispatchClose();
      return;
    }
    if (!this.permitted(view, 'advance')) { this.set({ error: '上一次宿主调用尚未确认，侧聊记录已保留。' }); return; }
    const allowed = view.close.requested
      ? ['prepare-failed', 'not-sent', 'cleanup-pending'].includes(view.close.status)
      : view.fork.status === 'waiting' || view.fork.status === 'not-sent'
        || view.fork.status === 'received' && ['waiting', 'not-sent'].includes(view.inject.status);
    if (!allowed) return;
    this.command = 'retry'; this.set({ error: null });
    try { await this.call('retry'); } finally { this.command = null; this.set({}); }
  }
  async retryPersistence(): Promise<void> {
    if (this.disposed || !this.canRetryPersistence) return;
    this.persistenceInFlight = true; this.set({});
    try { await this.call('retryPersistence'); } finally { this.persistenceInFlight = false; this.set({}); }
  }
  markActivity(): void { if (!this.value.hasActivity) this.set({ hasActivity: true }); }
  private async dispatchClose(): Promise<void> {
    if (this.closeInFlight || this.closeDispatched || !this.value.view || this.value.view.close.requested || !this.linked) return;
    if (!this.permitted(this.value.view, 'close')) {
      this.set({ error: '上一次关闭调用尚未确认，侧聊记录已保留。' }); return;
    }
    this.closeInFlight = true;
    this.closeDispatched = true;
    try { await this.call('close'); } finally { this.closeInFlight = false; this.set({}); }
  }
  /** Call only after the actual mounted draft and the shared send ledger pass the close barrier. */
  async close(): Promise<void> {
    if (this.disposed || this.value.phase === 'closed') return;
    this.set({ pendingClose: true, error: null });
    if (!this.value.view) {
      if (this.command === 'prepare') return;
      this.set({ pendingClose: false });
      return;
    }
    if (!this.linked && !await this.link()) return;
    await this.dispatchClose();
  }
}
