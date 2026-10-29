import { BrowserFiles } from '../../native/browser-files.ts';
import { readMethods } from '../../native/protocol.ts';
import type { HostMessage } from '../../native/protocol.ts';
import type { LateRpcTerminal, RequestOptions } from '../../../lib/codex-protocol.ts';
import type { ServerRequestEvent, ServerRequestRef, WorkbenchClient, WorkbenchDispatchOptions, WorkbenchEvent } from '../workbench-contract.ts';
import { browserAtom } from './browser-atoms.ts';
import { subscribeBrowserAtoms } from '../storage/ui-atoms.ts';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const rpcId = (value: unknown) => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
export function isServerRequestEvent(value: WorkbenchEvent): value is ServerRequestEvent {
  return value.type === 'mcp-request' && typeof value.hostId === 'string' && !!value.hostId && record(value.request)
    && rpcId(value.request.id) && typeof value.request.method === 'string' && !!value.request.method
    && (value.request.params === undefined || record(value.request.params)) && record(value.requestRef)
    && value.requestRef.hostId === value.hostId && value.requestRef.id === value.request.id
    && typeof value.requestRef.generation === 'string' && !!value.requestRef.generation;
}

export class WorkbenchError extends Error {
  readonly uncertain: boolean;
  readonly code?: number;
  readonly sendPhase?: 'before-send';
  constructor(message: string, uncertain = false, code?: number, sendPhase?: 'before-send') {
    super(message); this.uncertain = uncertain; this.code = code; this.sendPhase = sendPhase;
  }
}
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  mutating: boolean;
  rejected?: boolean;
  onLateTerminal?: RequestOptions['onLateTerminal'];
  onResult?: (value: unknown) => void;
}
interface DaemonConnection { generation: string }
const readHostEndpoints = new Set(['get-settings', 'get-setting', 'get-global-state', 'os-info', 'locale-info', 'codex-home',
  'home-directory', 'workspace-root-options', 'workspace-directory-entries', 'remote-workspace-directory-entries', 'read-file', 'read-file-metadata', 'read-file-binary',
  'git-diff', 'app-server-connection-state', 'codex-command-keymap-state', 'custom-avatars', 'chrome-status', 'thread-project-state', 'message-send-status', 'workspace-file-save-status']);
export function hostRequestMutates(endpoint: string, params: Record<string, unknown>): boolean {
  if (endpoint === 'send-injection') return params.action !== 'status';
  if (endpoint === 'configuration-write') return params.action !== 'status';
  if (endpoint === 'message-edit') return params.operation !== 'check';
  if (endpoint === 'workspace-files') return !['read', 'getMetadata'].includes(String(params.operation));
  return !readHostEndpoints.has(endpoint);
}

/** One browser client of Yard's existing host protocol. Writes are never replayed. */
export class BrowserWorkbenchClient implements WorkbenchClient {
  private socket: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private suspended = false;
  private cancelOpening: ((error: Error) => void) | undefined;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  private daemonConnections = new Map<string, DaemonConnection>();
  private readonly unsubscribeAtoms: () => void;
  readonly files: BrowserFiles;
  private readonly url: string;
  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
  constructor(url = location.origin.replace(/^http/, 'ws') + '/native-host') {
    this.url = url;
    this.files = new BrowserFiles((endpoint, params) => this.rawHost(endpoint, params));
    this.unsubscribeAtoms = subscribeBrowserAtoms(keys => this.publish({ type: 'persisted-atom-updated', keys }));
  }
  subscribe(listener: (event: WorkbenchEvent) => void) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  captureDaemonConnection(hostId: string): { generation: string; assertOriginal(): void } {
    const socket = this.socket, connection = this.daemonConnections.get(hostId);
    const unavailable = () => new WorkbenchError('原页面的主机连接已失效，请重新核对。', false, undefined, 'before-send');
    if (!socket || socket.readyState !== WebSocket.OPEN || this.stopped || this.suspended || !connection) throw unavailable();
    return {
      generation: connection.generation,
      assertOriginal: () => {
        if (this.socket !== socket || socket.readyState !== WebSocket.OPEN || this.stopped || this.suspended
          || this.daemonConnections.get(hostId) !== connection) throw unavailable();
      },
    };
  }
  private updateDaemonConnection(event: WorkbenchEvent) {
    if (event.type !== 'codex-app-server-connection-changed' || typeof event.hostId !== 'string' || !event.hostId) return;
    const generation = event.daemonConnectionGeneration;
    if (event.state !== 'connected' || typeof generation !== 'string' || !generation) {
      this.daemonConnections.delete(event.hostId);
    } else if (this.daemonConnections.get(event.hostId)?.generation !== generation) {
      this.daemonConnections.set(event.hostId, { generation });
    }
  }
  private publish(event: WorkbenchEvent) { for (const listener of this.listeners) listener(event); }
  connect(): Promise<void> {
    if (this.stopped) return Promise.reject(new WorkbenchError('连接已关闭。'));
    if (this.suspended) return Promise.reject(new WorkbenchError('页面连接已挂起。'));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.opening) return this.opening;
    this.daemonConnections.clear();
    this.publish({ type: 'connection-state', state: 'connecting' });
    this.opening = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url); this.socket = socket;
      this.cancelOpening = reject;
      let opened = false, failed = false;
      socket.onopen = () => {
        if (this.socket !== socket || this.stopped || this.suspended) { socket.close(); reject(new WorkbenchError('页面连接已挂起。')); return; }
        if (failed) { socket.close(); reject(new WorkbenchError('无法连接 Yard 宿主。')); return; }
        opened = true; this.opening = null; this.cancelOpening = undefined;
        socket.send(JSON.stringify({ type: 'ready' }));
        this.publish({ type: 'connection-state', state: 'connected' }); resolve();
      };
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        let parsed: unknown;
        try { parsed = JSON.parse(String(event.data)); } catch { return; }
        if (!record(parsed) || typeof parsed.type !== 'string') return;
        const message = parsed as WorkbenchEvent;
        if (message.type === 'codex-app-server-connection-changed' && (failed || socket.readyState !== WebSocket.OPEN)) return;
        this.updateDaemonConnection(message);
        if (message.type === 'mcp-request' && !isServerRequestEvent(message)) {
          this.publish({ type: 'protocol-error', error: '宿主请求缺少有效身份，请刷新核对。' }); return;
        }
        if (message.type === 'mcp-response') {
          if (!record(message.message) || !rpcId(message.message.id)) return;
          const reply = message.message as { id: string; result?: unknown; error?: { message: string; code?: number; data?: { uncertain?: boolean; sendPhase?: unknown } } };
          this.settle(String(reply.id), reply.result, reply.error && new WorkbenchError(reply.error.message, reply.error.data?.uncertain === true, reply.error.code,
            reply.error.data?.uncertain === false && reply.error.data.sendPhase === 'before-send' ? 'before-send' : undefined), message.late === true);
        } else if (message.type === 'fetch-response') {
          this.settle(String(message.requestId), message.body, message.responseType === 'error' ? new WorkbenchError(String(message.error), message.uncertain === true,
            undefined, message.uncertain === false && message.sendPhase === 'before-send' ? 'before-send' : undefined) : undefined);
        } else if (message.type === 'server-request-response') {
          this.settle(String(message.requestId), undefined, message.error ? new WorkbenchError(String(message.error), message.uncertain === true) : undefined);
        }
        this.publish(message);
      };
      socket.onerror = () => {
        if (this.socket !== socket) return;
        failed = true;
        this.daemonConnections.clear();
        if (!opened) reject(new WorkbenchError('无法连接 Yard 宿主。'));
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.opening = null; this.socket = null; this.cancelOpening = undefined;
        this.daemonConnections.clear();
        if (!opened) reject(new WorkbenchError('Yard 宿主连接已断开。'));
        this.failPending('连接已断开');
        this.publish({ type: 'connection-state', state: 'disconnected' });
        if (!this.stopped && !this.suspended) this.reconnect = setTimeout(() => { void this.connect().catch(() => {}); }, 2000);
      };
    });
    return this.opening;
  }
  private settle(id: string, value: unknown, error?: Error, terminal = false) {
    const pending = this.pending.get(id); if (!pending) return;
    if (pending.rejected && error instanceof WorkbenchError && error.uncertain && !terminal) return;
    clearTimeout(pending.timer); this.pending.delete(id);
    if (pending.rejected) {
      const receipt: LateRpcTerminal = error ? { outcome: 'error', error: { message: error.message } } : { outcome: 'success', result: value };
      try { void Promise.resolve(pending.onLateTerminal?.(receipt)).catch(() => {}); } catch { /* Unknown remains fenced by its consumer. */ }
      return;
    }
    if (error instanceof WorkbenchError && error.uncertain && pending.onLateTerminal && !terminal) {
      pending.rejected = true;
      // Expiration removes only the observer. It is never a terminal receipt.
      pending.timer = setTimeout(() => { this.pending.delete(id); }, 310_000);
      this.pending.set(id, pending); pending.reject(error); return;
    }
    if (!error) pending.onResult?.(value);
    if (error) pending.reject(error); else pending.resolve(value);
  }
  private failPending(reason: string) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer); this.pending.delete(id);
      if (!pending.rejected) pending.reject(new WorkbenchError(pending.mutating ? reason + '，操作结果未知。请核对会话。' : reason + '，请重试。', pending.mutating));
    }
  }
  private async request<T>(message: HostMessage, id: string, mutating: boolean, requireOpen = false,
    observation?: { onLateTerminal?: RequestOptions['onLateTerminal']; onResult?: (value: unknown) => void }, assertBeforeSend?: () => void): Promise<T> {
    let payload: string, socket: WebSocket;
    const originalSocket = this.socket;
    try {
      payload = JSON.stringify(message);
      if (assertBeforeSend) {
        assertBeforeSend();
        if (originalSocket?.readyState !== WebSocket.OPEN) throw new WorkbenchError('原页面连接已断开，未发送。');
      }
      if (!requireOpen) await this.connect();
      if (this.socket?.readyState !== WebSocket.OPEN) throw new WorkbenchError('页面连接已断开。');
      assertBeforeSend?.();
      if (assertBeforeSend && this.socket !== originalSocket) throw new WorkbenchError('原页面连接已改变，未发送。');
      socket = this.socket;
    } catch (failure) {
      throw new WorkbenchError(failure instanceof Error ? failure.message : String(failure), false,
        failure instanceof WorkbenchError ? failure.code : undefined, 'before-send');
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, undefined,
        new WorkbenchError(mutating ? '等待超时，操作结果未知。请核对会话后再试。' : '请求超时，请重试。', mutating)), 60_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer, mutating, ...observation });
      try { socket.send(payload); }
      catch { this.settle(id, undefined, new WorkbenchError('请求发送失败。', mutating)); }
    });
  }
  rpc<T = unknown>(method: string, params: Record<string, unknown> = {}, hostId = 'local', options?: WorkbenchDispatchOptions) {
    if (options?.onLateTerminal && !['thread/resume', 'thread/unsubscribe'].includes(method)) return Promise.reject<T>(new Error('Late observation is limited to thread subscription requests.'));
    const id = crypto.randomUUID();
    return this.request<T>({ type: 'mcp-request', hostId, observeSubscriptionTerminal: Boolean(options?.onLateTerminal),
      ...(options?.daemonConnectionGeneration !== undefined ? { daemonConnectionGeneration: options.daemonConnectionGeneration } : {}),
      request: { id, method, params } }, id, !readMethods.has(method), false,
      { onLateTerminal: options?.onLateTerminal, onResult: method === 'thread/start' ? result => {
        // Emit while the original bridge's reply is being settled, before any
        // caller awaits persistence or navigation and the connection can change.
        if (record(result) && record(result.thread) && typeof result.thread.id === 'string') this.publish({ type: 'thread-created', hostId, result });
      } : undefined }, options?.assertBeforeSend);
  }
  host<T = unknown>(endpoint: string, params: Record<string, unknown> = {}, options?: Pick<WorkbenchDispatchOptions, 'assertBeforeSend'>): Promise<T> {
    if (endpoint === 'get-persisted-atom' || endpoint === 'set-persisted-atom') {
      return browserAtom(endpoint, params, options?.assertBeforeSend) as Promise<T>;
    }
    if (['pick-file', 'pick-files', 'save-file'].includes(endpoint)) {
      return new Promise<T>((resolve, reject) => {
        this.files.intercept({ type: 'fetch', requestId: crypto.randomUUID(), url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) }, message => {
          if (message.responseType === 'error') reject(new WorkbenchError(String(message.error)));
          else resolve(message.body as T);
        });
      });
    }
    return this.rawHost<T>(endpoint, params, options?.assertBeforeSend);
  }
  private rawHost<T = unknown>(endpoint: string, params: Record<string, unknown> = {}, assertBeforeSend?: () => void) {
    const requestId = crypto.randomUUID();
    const mutating = hostRequestMutates(endpoint, params);
    return this.request<T>({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) }, requestId, mutating, false, undefined, assertBeforeSend);
  }
  async reply(ref: ServerRequestRef, response: { result: unknown } | { error: { code: number; message: string } }) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new WorkbenchError('审批连接已断开，请核对请求状态。', false, undefined, 'before-send');
    const requestId = crypto.randomUUID();
    await this.request({ type: 'mcp-response', requestId, hostId: ref.hostId, generation: ref.generation, response: { id: ref.id, ...response } }, requestId, true, true);
  }
  suspend() {
    this.suspended = true; clearTimeout(this.reconnect);
    this.cancelOpening?.(new WorkbenchError('页面连接已挂起。')); this.cancelOpening = undefined; this.opening = null;
    const socket = this.socket; this.socket = null;
    this.daemonConnections.clear();
    socket?.close();
    this.failPending('页面连接已关闭');
    this.publish({ type: 'connection-state', state: 'disconnected' });
  }
  async resume() {
    if (this.stopped) throw new WorkbenchError('连接已关闭。');
    this.suspended = false;
    await this.connect();
    this.publish({ type: 'page-resumed' });
  }
  close() {
    if (this.stopped) return;
    this.stopped = true; this.suspend();
    this.unsubscribeAtoms();
    this.listeners.clear();
  }
}
