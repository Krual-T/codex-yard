import type { SideChatControllerOptions, SideChatHostPort, SideChatHostView, SideChatPhase, SideChatScope, SideChatSnapshot } from './types.ts';

const requestStatuses = new Set(['waiting', 'inflight', 'not-sent', 'rejected', 'unknown', 'received', 'invalid']);
const closeStatuses = new Set(['idle', 'preparing', 'prepare-failed', 'inflight', 'not-sent', 'rejected', 'unknown', 'cleanup-pending', 'cleaning', 'closed']);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
  return value;
}
type DispatchMethod = 'start' | 'retry' | 'close' | 'retryPersistence';
function evidence(view: SideChatHostView, method: DispatchMethod): string {
  return method === 'close' ? JSON.stringify([view.close.requested, view.close.status])
    : JSON.stringify([view.fork.status, view.inject.status, view.childId, view.close.requested, view.close.status]);
}
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
    || previous && (previous.operationId !== view.operationId || JSON.stringify(stable(previous.parent)) !== JSON.stringify(stable(view.parent))
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
  private uncertain: { method: DispatchMethod; evidence: string; error: string } | null = null;
  private persistenceInFlight = false;
  private requestVersion = 0;
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
      if (hint.hostId === this.value.hostId && hint.operationId === this.value.view?.operationId) void this.read();
    });
  }
  getSnapshot = (): SideChatSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get canRetry(): boolean {
    const view = this.value.view;
    if (this.linkFailed) return true;
    if (!view || this.uncertain || this.command || this.closeInFlight) return false;
    if (this.value.pendingClose && !view.close.requested) return !this.closeDispatched && this.permitted(view, 'close');
    if (!this.permitted(view, 'advance')) return false;
    return view.close.requested ? ['prepare-failed', 'not-sent', 'cleanup-pending'].includes(view.close.status)
      : view.fork.status === 'waiting' || view.fork.status === 'not-sent'
        || view.fork.status === 'received' && ['waiting', 'not-sent'].includes(view.inject.status);
  }
  get canRetryPersistence(): boolean {
    const view = this.value.view;
    return !!view && this.linked && !this.persistenceInFlight && this.uncertain?.method !== 'retryPersistence'
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
  private accept(view: SideChatHostView, version: number): void {
    if (this.disposed || version !== this.requestVersion) return;
    const next = validate(view, this.value.hostId, this.value.parentThreadId, this.value.view);
    if (this.uncertain && evidence(next, this.uncertain.method) !== this.uncertain.evidence) this.uncertain = null;
    this.set({ view: next, error: this.uncertain?.error ?? null });
  }
  private async call(method: 'start' | 'read' | 'retry' | 'close' | 'retryPersistence'): Promise<void> {
    const view = this.value.view;
    if (!view || this.disposed) return;
    const version = ++this.requestVersion;
    const baseline = method === 'read' ? null : evidence(view, method);
    try {
      const result = await this.port[method](view.operationId);
      this.accept(result, version);
      if (method !== 'read' && version !== this.requestVersion && !this.disposed) void this.read();
    } catch (error) {
      if (!this.disposed) {
        const unsent = method !== 'read' && notDispatched(error);
        const text = (unsent ? '宿主调用尚未派发，可以显式继续：' : '宿主操作结果未确认，原记录已保留：') + message(error);
        if (unsent && method === 'close' && !this.value.view?.close.requested) this.closeDispatched = false;
        if (!unsent && baseline !== null && method !== 'read' && this.value.view
          && evidence(this.value.view, method) === baseline) this.uncertain = { method, evidence: baseline, error: text };
        if (version === this.requestVersion || this.uncertain) this.set({ error: this.uncertain?.error ?? text });
      }
      if (method !== 'read' && version !== this.requestVersion && !this.disposed) void this.read();
    }
  }
  async read(): Promise<void> { await this.call('read'); }
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
    if (this.disposed || this.command || this.closeInFlight || this.uncertain) return;
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
