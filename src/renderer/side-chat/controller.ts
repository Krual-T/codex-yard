import type { ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import { sessionOptions } from '../app/session-options.ts';
import type { SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { sideChatBoundaryItems, sideChatDeveloperInstructions } from './instructions.ts';
import type { DurableSideChatReceipt, SideChatOperation, SideChatOperationKind, SideChatOperationResult, SideChatOperations, SideChatParent, SideChatPhase, SideChatSnapshot } from './types.ts';

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function operationResult(value: unknown): SideChatOperationResult {
  const result = object(value);
  if (result.outcome === 'success' && Object.hasOwn(result, 'result')) return { outcome: 'success', result: result.result };
  if ((result.outcome === 'not-applied' || result.outcome === 'unknown') && typeof result.message === 'string')
    return { outcome: result.outcome, message: result.message };
  return { outcome: 'unknown', message: '宿主回执格式无效，请核对原请求。' };
}

export function createSideChatDraftId(): string { return 'side-chat:' + crypto.randomUUID(); }

function mergeSettings(current: SubmitOptions, settings: ThreadSettingsResponse): SubmitOptions {
  const next = { ...current, ...sessionOptions(settings) };
  if (settings.activePermissionProfile === null) delete next.permissionProfileId;
  return next;
}

export function sideChatForkParams(parent: SideChatParent): Record<string, unknown> {
  if (!parent.developerInstructions) throw new Error('父会话的开发者指令来源不可用。');
  const options = parent.options;
  const config = structuredClone(parent.forkConfig);
  if (options.effort !== undefined) config.model_reasoning_effort = options.effort;
  const disabled = object(config['apps.connector_openai_pages.tools']);
  config['apps.connector_openai_pages.tools'] = { ...disabled,
    ...Object.fromEntries(['create_presentation', 'create_spreadsheet', 'create_canvas', 'execute_artifact_code', 'inspect_artifact']
      .map(name => ['chatgpt_space.' + name, { enabled: false }])) };
  return {
    threadId: parent.threadId, cwd: parent.cwd, runtimeWorkspaceRoots: [...parent.workspaceRoots],
    threadSource: 'user', ephemeral: true, excludeTurns: true, deferGoalContinuation: true,
    developerInstructions: sideChatDeveloperInstructions(parent.developerInstructions.text), config,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.approvalPolicy !== undefined ? { approvalPolicy: options.approvalPolicy } : {}),
    ...(options.approvalsReviewer !== undefined ? { approvalsReviewer: options.approvalsReviewer } : {}),
    ...(options.permissionProfileId ? { permissions: options.permissionProfileId }
      : options.sandboxMode ? { sandbox: options.sandboxMode } : {}),
    ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
  };
}

function receivedThread(result: unknown, parent: SideChatParent): ThreadSummary | null {
  const thread = object(object(result).thread);
  if (typeof thread.id !== 'string' || !thread.id || thread.id === parent.threadId) return null;
  return { ...thread, id: thread.id, name: typeof thread.name === 'string' ? thread.name : null,
    cwd: typeof thread.cwd === 'string' && thread.cwd ? thread.cwd : parent.cwd,
    turns: Array.isArray(thread.turns) ? thread.turns as ThreadSummary['turns'] : [],
    status: thread.status && typeof thread.status === 'object' ? thread.status as ThreadSummary['status'] : { type: 'notLoaded' } };
}

/** One controller belongs to one parent and must survive hidden/unmounted panels. */
export class SideChatController {
  private value: SideChatSnapshot;
  private listeners = new Set<() => void>();
  private checking = false;
  private watchedClient: WorkbenchClient | undefined;
  private unwatch: (() => void) | undefined;
  private readonly operations: SideChatOperations;
  constructor(parent: SideChatParent, draftId: string, operations: SideChatOperations, restored?: SideChatSnapshot) {
    this.operations = operations;
    if (!draftId || !parent.hostId || !parent.threadId || !parent.cwd) throw new Error('侧聊缺少父会话或草稿身份。');
    if (restored && (restored.draftId !== draftId || restored.parent.hostId !== parent.hostId
      || restored.parent.threadId !== parent.threadId)) throw new Error('侧聊恢复身份不匹配。');
    this.value = restored ? structuredClone(restored) : { parent: structuredClone(parent), draftId, kind: 'temporary', phase: 'idle', childOptions: structuredClone(parent.options),
      thread: null, boundaryConfirmed: false, subscriptionLost: false, operation: null, sequence: 0, closeRequested: false, activeTurnId: null, hasActivity: false, error: null };
    if (restored?.thread) this.value.subscriptionLost = true;
    if (restored && ['creating', 'boundary', 'discarding'].includes(restored.phase)) {
      this.value.phase = restored.phase === 'creating' ? 'create-unknown' : restored.phase === 'boundary' ? 'boundary-unknown' : 'discard-unknown';
      this.value.error = '页面恢复时操作结果未知，请核对原请求。';
    }
    if (restored?.phase === 'interrupting') { this.value.phase = 'discard-failed'; this.value.error = '关闭中断，请重试关闭。'; }
    if (restored?.phase === 'cleaning') { this.value.phase = 'cleanup-failed'; this.value.error = '本地清理中断，请重试清理。'; }
    if (restored?.phase === 'preparing-close') { this.value.phase = 'close-failed'; this.value.error = '关闭准备中断，请核对后重试。'; }
  }
  /** Attach only a real, fully prepared durable receipt supplied by its owner. */
  static attachDurable(parent: SideChatParent, draftId: string, operations: SideChatOperations, receipt: DurableSideChatReceipt): SideChatController {
    if (parent.archived || receipt.hostId !== parent.hostId || receipt.parentThreadId !== parent.threadId
      || !receipt.boundaryReady || !receipt.thread.id || receipt.thread.id === parent.threadId) throw new Error('持久侧聊回执或父会话身份无效。');
    const controller = new SideChatController(parent, draftId, operations);
    controller.value = { ...controller.value, kind: 'durable', phase: 'ready', thread: structuredClone(receipt.thread),
      childOptions: structuredClone(receipt.childOptions), boundaryConfirmed: true, hasActivity: receipt.hasActivity };
    return controller;
  }
  getSnapshot = (): SideChatSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get canReconcile(): boolean { return !!this.operations.reconcile; }
  /** Keep the connection observer alive while the panel is hidden. */
  watchConnection(client: WorkbenchClient): void {
    if (this.value.phase === 'closed' || this.watchedClient === client) return;
    if (this.watchedClient) this.markSubscriptionLost();
    this.unwatch?.();
    this.watchedClient = client;
    this.unwatch = client.subscribe(event => {
      if (event.type === 'page-resumed' || event.type === 'connection-state' && event.state === 'disconnected'
        || event.type === 'codex-app-server-connection-changed' && event.hostId === this.value.parent.hostId && event.state === 'disconnected')
        this.markSubscriptionLost();
    });
  }
  markSubscriptionLost(): void { if (!this.value.subscriptionLost) this.set({ subscriptionLost: true }); }
  markSubscriptionRestored(): void { if (this.value.subscriptionLost) this.set({ subscriptionLost: false }); }
  updateSettings(settings: ThreadSettingsResponse): void {
    this.set({ childOptions: mergeSettings(this.value.childOptions, settings) });
  }
  private set(patch: Partial<SideChatSnapshot>) {
    this.value = { ...this.value, ...patch };
    if (this.value.phase === 'closed') { this.unwatch?.(); this.unwatch = undefined; this.watchedClient = undefined; }
    for (const listener of this.listeners) listener();
  }
  private scope() {
    return { hostId: this.value.parent.hostId, parentThreadId: this.value.parent.threadId, childThreadId: this.value.thread!.id };
  }
  private operation(kind: SideChatOperationKind, method: SideChatOperation['method'], params: Record<string, unknown>): SideChatOperation {
    const sequence = this.value.sequence + 1;
    return { id: `${this.value.draftId}:${sequence}`, kind, method, hostId: this.value.parent.hostId,
      parentThreadId: this.value.parent.threadId, childThreadId: this.value.thread?.id ?? null, params };
  }
  private async dispatch(operation: SideChatOperation, phase: SideChatPhase) {
    this.set({ operation, phase, sequence: this.value.sequence + 1, error: null });
    let result: SideChatOperationResult;
    try { result = await this.operations.execute(structuredClone(operation)); }
    catch (error) { result = { outcome: 'unknown', message: errorText(error) }; }
    await this.acceptResult(operation.id, result);
  }
  async start(): Promise<void> {
    if (!['idle', 'create-failed'].includes(this.value.phase) || this.value.closeRequested) return;
    const parent = this.value.parent, capability = parent.capabilities;
    if (parent.archived) { this.set({ phase: 'create-failed', error: '已归档的会话不能创建侧聊。' }); return; }
    if (!parent.developerInstructions || !parent.developerInstructions.source) {
      this.set({ phase: 'create-failed', error: '无法取得父会话的开发者指令，请检查宿主能力。' }); return;
    }
    if (!capability.ephemeralFork || !capability.boundaryInjection || !capability.preventGoalContinuation || !capability.discard) {
      this.set({ phase: 'create-failed', error: '此主机尚未确认临时 fork、边界注入、安全暂停目标或关闭能力。' }); return;
    }
    const operation = this.operation('fork', 'thread/fork', sideChatForkParams(parent));
    await this.dispatch(operation, 'creating');
  }
  private async boundary() {
    if (!this.value.thread) return;
    const operation = this.operation('boundary', 'thread/inject_items', { threadId: this.value.thread.id, items: sideChatBoundaryItems() });
    await this.dispatch(operation, 'boundary');
  }
  private async discard() {
    if (!this.value.thread) return;
    if (this.value.activeTurnId) {
      const scope = { hostId: this.value.parent.hostId, threadId: this.value.thread.id, turnId: this.value.activeTurnId };
      this.set({ phase: 'interrupting', error: null, activeTurnId: null });
      try { await this.operations.interrupt(scope); } catch { /* Original close still attempts discard. */ }
    }
    const method = this.value.parent.capabilities.discard === 'stop' ? 'thread/stop' : 'thread/unsubscribe';
    const operation = this.operation('discard', method, { threadId: this.value.thread.id });
    await this.dispatch(operation, 'discarding');
  }
  private async prepareClose() {
    if (!this.value.thread) return;
    this.set({ phase: 'preparing-close', error: null });
    try { await this.operations.prepareClose(this.scope()); }
    catch (error) { this.set({ phase: 'close-failed', error: errorText(error) }); return; }
    if (this.value.kind === 'durable') this.set({ phase: 'closed', operation: null, error: null });
    else await this.discard();
  }
  private async cleanup() {
    this.set({ phase: 'cleaning', operation: null, error: null });
    try { await this.operations.cleanup(this.scope()); this.set({ phase: 'closed', error: null }); }
    catch (error) { this.set({ phase: 'cleanup-failed', error: errorText(error) }); }
  }
  /** Manager may deliver a late or independently reconciled receipt for the same operation. */
  async acceptResult(id: string, result: SideChatOperationResult): Promise<void> {
    const operation = this.value.operation;
    if (!operation || operation.id !== id || !['creating', 'create-unknown', 'boundary', 'boundary-unknown', 'discarding', 'discard-unknown'].includes(this.value.phase)) return;
    result = operationResult(result);
    if (result.outcome === 'success' && operation.kind === 'boundary'
      && (!result.result || typeof result.result !== 'object' || Array.isArray(result.result)))
      result = { outcome: 'unknown', message: '隔离边界回执无效，请核对原请求。' };
    if (result.outcome === 'success' && operation.method === 'thread/unsubscribe'
      && !['unsubscribed', 'notLoaded', 'notSubscribed'].includes(String(object(result.result).status)))
      result = { outcome: 'unknown', message: '关闭回执缺少有效的订阅状态，请核对原请求。' };
    const kind = operation.kind;
    if (result.outcome !== 'success') {
      const phase = (kind === 'fork' ? 'create-' : kind === 'boundary' ? 'boundary-' : 'discard-')
        + (result.outcome === 'unknown' ? 'unknown' : 'failed');
      this.set({ phase: phase as SideChatPhase, error: result.message });
      if (result.outcome === 'not-applied' && this.value.closeRequested) {
        if (kind === 'fork') this.set({ phase: 'closed', operation: null });
        else if (kind === 'boundary') await this.prepareClose();
      }
      return;
    }
    if (kind === 'fork') {
      const thread = receivedThread(result.result, this.value.parent);
      if (!thread) { this.set({ phase: 'create-unknown', error: '创建回执缺少有效的侧聊身份，请核对原请求。' }); return; }
      this.set({ thread, operation: null, phase: 'forked', error: null,
        childOptions: mergeSettings(this.value.childOptions, object(result.result) as ThreadSettingsResponse) });
      if (this.value.closeRequested) await this.prepareClose(); else await this.boundary();
    } else if (kind === 'boundary') {
      this.set({ operation: null, phase: 'ready', boundaryConfirmed: true, error: null });
      if (this.value.closeRequested) await this.prepareClose();
    } else await this.cleanup();
  }
  async reconcile(): Promise<void> {
    const operation = this.value.operation;
    if (this.checking || !operation || !this.operations.reconcile || !this.value.phase.endsWith('-unknown')) return;
    this.checking = true;
    try { await this.acceptResult(operation.id, await this.operations.reconcile(structuredClone(operation))); }
    catch (error) { if (this.value.operation?.id === operation.id) this.set({ error: errorText(error) }); }
    finally { this.checking = false; }
  }
  async retry(): Promise<void> {
    if (this.value.phase === 'create-failed') return this.start();
    if (this.value.phase === 'forked') return this.value.closeRequested ? this.prepareClose() : this.boundary();
    if (this.value.phase === 'boundary-failed') return this.boundary();
    if (this.value.phase === 'close-failed') return this.prepareClose();
    if (this.value.phase === 'discard-failed') return this.discard();
    if (this.value.phase === 'cleanup-failed') return this.cleanup();
  }
  markActivity(): void { if (!this.value.hasActivity) this.set({ hasActivity: true }); }
  reopen(): void {
    if (!['close-failed', 'discard-failed'].includes(this.value.phase)) return;
    this.set({ phase: this.value.boundaryConfirmed ? 'ready' : 'forked', closeRequested: false, activeTurnId: null, operation: null, error: null });
  }
  async close(activeTurnId: string | null = null): Promise<void> {
    if (this.value.phase === 'closed') return;
    if (this.value.closeRequested && !['close-failed', 'discard-failed', 'cleanup-failed'].includes(this.value.phase)) return;
    this.set({ closeRequested: true, activeTurnId });
    if (['idle', 'create-failed'].includes(this.value.phase)) this.set({ phase: 'closed', operation: null });
    else if (['ready', 'forked', 'boundary-failed', 'close-failed'].includes(this.value.phase)) await this.prepareClose();
    else if (this.value.phase === 'discard-failed') await this.discard();
    else if (this.value.phase === 'cleanup-failed') await this.cleanup();
  }
}
