import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import type { Duplex } from 'node:stream';
import WebSocket from 'ws';
import { permissionCatalog } from './permissions.ts';
import type { PermissionCatalogOptions } from './permissions.ts';
import { errorMessage, isRecord } from './codex-protocol.ts';
import type { InitializeResponse, ModelSummary, PermissionProfile, RequestOptions, RpcId, RpcMessage, RpcResponses,
  RpcResult, SessionConfig, SessionSettings, ThreadSettingsResponse, LateRpcTerminal } from './codex-protocol.ts';
export type { RequestOptions, RpcMessage, RpcResponses, RpcResult } from './codex-protocol.ts';

// config/read contains credentials and provider/MCP environment. Only these
// session settings may leave the connection layer.
export function sessionSettings(config: SessionConfig, models: readonly ModelSummary[] = []): SessionSettings {
  return {
    model: config.model || models.find(model => model.isDefault)?.id || null,
    modelProvider: config.model_provider || null,
    reasoningEffort: config.model_reasoning_effort ?? null,
    approvalPolicy: config.approval_policy ?? null,
    sandboxMode: config.sandbox_mode ?? null,
    serviceTier: config.service_tier ?? null,
    ...(config.approvals_reviewer ? { approvalsReviewer: config.approvals_reviewer } : {}),
    ...(config.default_permissions ? { permissionProfileId: config.default_permissions } : {}),
  };
}

export function threadSettings(result: ThreadSettingsResponse): Partial<SessionSettings> {
  const sandboxTypes = { dangerFullAccess: 'danger-full-access', workspaceWrite: 'workspace-write',
    readOnly: 'read-only', externalSandbox: 'external-sandbox' } as const;
  const settings: Partial<SessionSettings> = {};
  function copy<K extends keyof ThreadSettingsResponse & keyof SessionSettings>(key: K) {
    if (Object.hasOwn(result, key)) Object.assign(settings, { [key]: result[key] });
  }
  for (const key of ['model', 'modelProvider', 'reasoningEffort', 'approvalPolicy', 'serviceTier', 'approvalsReviewer'] as const) {
    copy(key);
  }
  const mode = typeof result.collaborationMode === 'string' ? result.collaborationMode : result.collaborationMode?.mode;
  if (mode === 'plan' || mode === 'default') settings.collaborationMode = mode;
  if (result.sandbox?.type) settings.sandboxMode = sandboxTypes[result.sandbox.type] || result.sandbox.type;
  if (Object.hasOwn(result, 'activePermissionProfile')) settings.permissionProfileId = result.activePermissionProfile?.id ?? null;
  return settings;
}

interface RpcErrorOptions { code?: string | number; data?: unknown; status?: number; uncertain?: boolean }
export class RpcError extends Error {
  readonly code: string | number | undefined;
  readonly data: unknown;
  readonly status: number;
  readonly uncertain: boolean;
  constructor(message: string, { code, data, status = 502, uncertain = false }: RpcErrorOptions = {}) {
    super(message);
    this.code = code;
    this.data = data;
    this.status = status;
    this.uncertain = uncertain;
  }
}

/** One independent client of an existing daemon; never owns its lifecycle. */
interface ConnectionOptions { timeout?: number; cwd?: string; createConnection?: () => Duplex; connectTimeout?: number }
interface PendingRequest {
  resolve: (reply: RpcResult<unknown>) => void;
  reject: (error: RpcError) => void;
  timer: ReturnType<typeof setTimeout>;
  mutating: boolean;
  timedOut?: boolean;
  onLateTerminal?: RequestOptions['onLateTerminal'];
}
const maxLateObservers = 16;
const lateObserverLifetimeMs = 5 * 60_000;
export class CodexConnection extends EventEmitter<{ message: [RpcMessage, WebSocket?]; status: [] }> {
  readonly socketPath: string;
  readonly timeout: number;
  readonly cwd: string | undefined;
  readonly connectStream: (() => Duplex) | undefined;
  readonly connectTimeout: number;
  readonly pending = new Map<RpcId, PendingRequest>();
  nextId = 0;
  eventCursor = 0;
  connected = false;
  closed = false;
  server: InitializeResponse | null = null;
  models: ModelSummary[] = [];
  lastError: string | null = null;
  socket: WebSocket | undefined;
  connecting: Promise<void> | null = null;

  constructor(socketPath: string, { timeout = 30_000, cwd, createConnection: connectStream, connectTimeout = 8_000 }: ConnectionOptions = {}) {
    super();
    this.socketPath = socketPath;
    this.timeout = timeout;
    this.cwd = cwd;
    this.connectStream = connectStream;
    this.connectTimeout = connectTimeout;
  }

  async connect() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    if (this.closed) throw new RpcError('工作台连接已关闭。');
    this.connecting = this.open();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  async open() {
    const socket = new WebSocket('ws://localhost/rpc', {
      createConnection: this.connectStream || (() => createConnection({ path: this.socketPath })), handshakeTimeout: this.connectTimeout,
      // The 0.147.0 SSH proxy can stall initialize when compression is negotiated.
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on('message', data => this.receive(data, socket));
    socket.on('error', error => { if (socket === this.socket) this.lastError = error.message; });
    socket.on('close', () => {
      if (socket !== this.socket) return;
      this.connected = false;
      this.rejectPending('与现有 Codex 的连接已断开。');
      if (!this.closed) this.emit('status');
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
        socket.once('close', () => reject(new Error('连接在初始化前关闭。')));
      });
      const initialized = await this.request('initialize', {
        clientInfo: { name: 'agents_workbench', title: 'AGENTS Workbench', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      this.server = initialized;
      socket.send(JSON.stringify({ method: 'initialized', params: {} }));
      // The native renderer owns model, account and config queries. Connecting
      // must not wait for a second set of those queries before forwarding RPCs.
      this.connected = true;
      this.lastError = null;
      this.emit('status');
    } catch (error) {
      this.lastError = `连接已有 Codex 失败：${errorMessage(error)}`;
      socket.terminate();
      this.rejectPending(this.lastError);
      throw new RpcError(this.lastError);
    }
  }

  async session(cwd?: string) {
    const { config } = await this.request('config/read', { includeLayers: false, ...(cwd ? { cwd } : {}) });
    return sessionSettings(config, this.models);
  }

  async permissionCatalog(cwd: string, options: PermissionCatalogOptions = {}) {
    const [{ config }, { requirements }] = await Promise.all([
      this.request('config/read', { includeLayers: false, cwd }), this.request('configRequirements/read', {}),
    ]);
    const profiles: PermissionProfile[] = [], cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: RpcResponses['permissionProfile/list'] = await this.request('permissionProfile/list', { cwd, limit: 100, ...(cursor ? { cursor } : {}) });
      if (!isRecord(page) || !Array.isArray(page.data) || page.data.some(profile => !isRecord(profile) || typeof profile.id !== 'string' || typeof profile.allowed !== 'boolean') ||
          (page.nextCursor != null && typeof page.nextCursor !== 'string')) {
        throw new RpcError('权限配置读取失败，请重试。');
      }
      profiles.push(...page.data); cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new RpcError('权限配置游标没有前进，请重试。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return permissionCatalog({ config, requirements, profiles, cwd, ...options });
  }

  receive(data: WebSocket.RawData, sourceSocket = this.socket) {
    if (sourceSocket && sourceSocket !== this.socket) return;
    let message: unknown;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (!isRecord(message)) return;
    if (!message.method && (typeof message.id === 'string' || typeof message.id === 'number')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (pending.timedOut) {
        const hasResult = Object.hasOwn(message, 'result');
        const validError = isRecord(message.error) && typeof message.error.message === 'string'
          && (typeof message.error.code === 'string' || typeof message.error.code === 'number');
        if (hasResult === validError || Object.hasOwn(message, 'error') && !validError) return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (pending.timedOut) {
        const error = isRecord(message.error) ? message.error : {};
        const terminal: LateRpcTerminal = message.error
          ? { outcome: 'error', error: { message: typeof error.message === 'string' ? error.message : 'Codex 返回了无效错误。',
            ...(typeof error.code === 'number' || typeof error.code === 'string' ? { code: error.code } : {}), data: error.data } }
          : { outcome: 'success', result: message.result };
        try { void Promise.resolve(pending.onLateTerminal?.(terminal)).catch(() => {}); } catch { /* The caller retains its unknown state. */ }
        return;
      }
      if (message.error) {
        const error = isRecord(message.error) ? message.error : {};
        pending.reject(new RpcError(typeof error.message === 'string' ? error.message : 'Codex 返回了无效错误。', {
          code: typeof error.code === 'number' || typeof error.code === 'string' ? error.code : undefined, data: error.data,
        }));
      } else {
        // Capture at dispatch time, before another message in the same WS buffer.
        pending.resolve({ result: message.result, eventCursor: this.eventCursor });
      }
      return;
    }
    if (typeof message.method === 'string') {
      this.eventCursor += 1;
      this.emit('message', { ...message, method: message.method, params: message.params,
        id: typeof message.id === 'string' || typeof message.id === 'number' ? message.id : undefined, seq: this.eventCursor }, sourceSocket);
    }
  }

  // The daemon owns result schemas. The only unchecked boundary is this RPC
  // dispatch; dynamic callers get unknown unless they supply their own contract.
  request<M extends keyof RpcResponses>(method: M, params?: unknown, options?: RequestOptions): Promise<RpcResponses[M]>;
  request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T>;
  request(method: string, params?: unknown, options?: RequestOptions): Promise<unknown> {
    return this.requestWithCursor(method, params, options).then(reply => reply.result);
  }

  requestWithCursor<M extends keyof RpcResponses>(method: M, params?: unknown, options?: RequestOptions): Promise<RpcResult<RpcResponses[M]>>;
  requestWithCursor<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<RpcResult<T>>;
  requestWithCursor(method: string, params?: unknown, { mutating = false, timeoutMs = this.timeout, onLateTerminal, retainLateUntilDisconnect }: RequestOptions = {}): Promise<RpcResult<unknown>> {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RpcError('尚未连接现有 Codex。', { status: 503 }));
    }
    if (onLateTerminal && [...this.pending.values()].filter(item => item.onLateTerminal).length >= maxLateObservers) {
      return Promise.reject(new RpcError('待核对的请求过多，未发送新请求。', { code: 'OBSERVER_LIMIT', status: 503 }));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending?.onLateTerminal) {
          pending.timedOut = true;
          if (!retainLateUntilDisconnect) {
            pending.timer = setTimeout(() => { this.pending.delete(id); }, lateObserverLifetimeMs);
            pending.timer.unref();
          }
        } else this.pending.delete(id);
        reject(new RpcError(mutating ? '请求结果待确认，请重新读取会话后核对，避免重复发送。' : 'Codex 响应超时，请重试读取。', {
          code: 'TIMEOUT', status: 504, uncertain: mutating,
        }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, mutating, onLateTerminal });
      try {
        socket.send(JSON.stringify({ id, method, params }), error => {
          if (!error || !this.pending.has(id)) return;
          const pending = this.pending.get(id)!;
          this.pending.delete(id);
          clearTimeout(pending.timer);
          reject(new RpcError(error.message, { uncertain: mutating }));
        });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new RpcError(errorMessage(error), { uncertain: mutating }));
      }
    });
  }

  respond(id: RpcId, result: unknown): Promise<void> {
    const socket = this.socket;
    if (!this.connected || !socket) throw new RpcError('连接已断开，请重新读取会话。', { status: 503 });
    return new Promise<void>((resolve, reject) => {
      socket.send(JSON.stringify({ id, result }), error => error
        ? reject(new RpcError('回答发送结果待确认，请核对请求状态。', { uncertain: true }))
        : resolve());
    });
  }

  rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new RpcError(message, { uncertain: pending.mutating }));
    }
    this.pending.clear();
  }

  close() {
    this.closed = true;
    this.connected = false;
    this.rejectPending('工作台已关闭连接；Codex 进程继续运行。');
    this.socket?.terminate();
  }
}
