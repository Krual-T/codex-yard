import { createConnection } from 'node:net';
import type { Socket } from 'node:net';

type RpcId = string | number;
type RecordValue = Record<string, unknown>;
type Pending = { socket: Socket; resolve: (result: unknown) => void; reject: (cause: unknown) => void; cleanup: () => void };
type Descriptor = { namespace: string; name: string; description: string; inputSchema: RecordValue };

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_CALLS = 128;
const versions = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isId(value: unknown): value is RpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}
class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}
function cancelled() { return new RpcError(-32000, 'Tool request cancelled.'); }

class HostPipe {
  private path: string;
  private socket: Socket | undefined;
  private connecting: Promise<Socket> | undefined;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private closed = false;

  constructor(path: string) { this.path = path; }

  private connect(): Promise<Socket> {
    if (this.closed) return Promise.reject(new RpcError(-32000, 'Tool host is closed.'));
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    const socket = createConnection({ path: this.path });
    const header = Buffer.alloc(4);
    let headerBytes = 0;
    let payload: Buffer | null = null;
    let payloadBytes = 0;
    socket.on('data', (chunk: Buffer) => {
      let offset = 0;
      while (offset < chunk.length && !socket.destroyed) {
        if (payload === null) {
          const count = Math.min(4 - headerBytes, chunk.length - offset);
          chunk.copy(header, headerBytes, offset, offset + count);
          headerBytes += count;
          offset += count;
          if (headerBytes < 4) continue;
          const length = header.readUInt32LE(0);
          headerBytes = 0;
          if (length > MAX_FRAME_BYTES) { socket.destroy(); break; }
          payload = Buffer.allocUnsafe(length);
          payloadBytes = 0;
        }
        const count = Math.min(payload.length - payloadBytes, chunk.length - offset);
        chunk.copy(payload, payloadBytes, offset, offset + count);
        payloadBytes += count;
        offset += count;
        if (payloadBytes === payload.length) {
          const complete = payload;
          payload = null;
          try {
            const message: unknown = JSON.parse(complete.toString('utf8'));
            if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.id !== 'number') {
              throw new Error('Invalid tool host response');
            }
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            this.pending.delete(message.id);
            pending.cleanup();
            if (isRecord(message.error) && typeof message.error.code === 'number' && typeof message.error.message === 'string') {
              pending.reject(new RpcError(message.error.code, message.error.message));
            } else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
            else pending.reject(new RpcError(-32000, 'Invalid tool host response.'));
          } catch { socket.destroy(); }
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined;
      for (const [id, pending] of this.pending) {
        if (pending.socket !== socket) continue;
        this.pending.delete(id);
        pending.cleanup();
        pending.reject(new RpcError(-32000, 'Tool host connection closed.'));
      }
    });
    this.connecting = new Promise<Socket>((resolve, reject) => {
      const connected = () => {
        socket.off('error', failed);
        if (this.closed) { socket.destroy(); reject(new RpcError(-32000, 'Tool host is closed.')); return; }
        this.socket = socket;
        resolve(socket);
      };
      const failed = () => { socket.off('connect', connected); reject(new RpcError(-32000, 'Cannot connect to tool host.')); };
      socket.once('connect', connected);
      socket.once('error', failed);
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private send(socket: Socket, message: unknown): void {
    const body = Buffer.from(JSON.stringify(message));
    if (body.length > MAX_FRAME_BYTES || socket.writableLength + body.length + 4 > MAX_FRAME_BYTES + 4) {
      throw new RpcError(-32000, 'Tool host frame exceeds the limit.');
    }
    const frame = Buffer.allocUnsafe(body.length + 4);
    frame.writeUInt32LE(body.length, 0);
    body.copy(frame, 4);
    socket.write(frame);
  }

  async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw cancelled();
    const socket = await this.connect();
    if (signal.aborted) throw cancelled();
    if (socket.destroyed) throw new RpcError(-32000, 'Tool host connection closed.');
    if (this.pending.size >= MAX_PENDING_CALLS) throw new RpcError(-32000, 'Too many pending tool requests.');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!this.pending.delete(id)) return;
        try { if (!socket.destroyed) this.send(socket, { jsonrpc: '2.0', id, method: 'tools/cancel' }); }
        catch { socket.destroy(); }
        reject(cancelled());
      };
      const cleanup = () => signal.removeEventListener('abort', abort);
      this.pending.set(id, { socket, resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      try { this.send(socket, { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }); }
      catch (cause) { this.pending.delete(id); cleanup(); reject(cause); }
    });
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
  }
}

function metadataValue(values: unknown[], name: string, required: true): string;
function metadataValue(values: unknown[], name: string, required: false): string | null;
function metadataValue(values: unknown[], name: string, required: boolean): string | null {
  const supplied = values.filter(value => value !== undefined);
  if (!supplied.length && !required) return null;
  if (!supplied.length || supplied.some(value => typeof value !== 'string' || !value.trim()) ||
      supplied.some(value => value !== supplied[0])) {
    throw new RpcError(-32602, `Missing or conflicting ${name} metadata.`);
  }
  return supplied[0] as string;
}
function attribution(meta: unknown): { threadId: string; turnId: string | null; callId: string | null } {
  if (!isRecord(meta)) throw new RpcError(-32602, 'Missing thread metadata.');
  let turn = meta['x-codex-turn-metadata'];
  if (typeof turn === 'string') {
    try { turn = JSON.parse(turn) as unknown; }
    catch { throw new RpcError(-32602, 'Invalid turn metadata.'); }
  }
  if (turn !== undefined && !isRecord(turn)) throw new RpcError(-32602, 'Invalid turn metadata.');
  const nested = isRecord(turn) ? turn : {};
  return {
    threadId: metadataValue([meta.threadId, nested.thread_id], 'thread', true),
    turnId: metadataValue([meta.turnId, nested.turn_id], 'turn', false),
    callId: metadataValue([meta.callId, meta['openai/toolCallId']], 'call', false),
  };
}
async function catalog(pipe: HostPipe, signal: AbortSignal): Promise<Descriptor[]> {
  const result = await pipe.request('tools/list', undefined, signal);
  if (!isRecord(result) || !Array.isArray(result.tools)) throw new RpcError(-32000, 'Invalid tool catalog.');
  const names = new Set<string>();
  return result.tools.map((tool: unknown) => {
    if (!isRecord(tool) || typeof tool.namespace !== 'string' || !tool.namespace ||
        typeof tool.name !== 'string' || !tool.name || typeof tool.description !== 'string' ||
        !isRecord(tool.inputSchema) || names.has(tool.name)) throw new RpcError(-32000, 'Invalid or ambiguous tool catalog.');
    names.add(tool.name);
    return { namespace: tool.namespace, name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
  });
}
function toolResult(value: unknown): { content: { type: 'text'; text: string }[]; isError: boolean } {
  if (!isRecord(value) || typeof value.success !== 'boolean' || !Array.isArray(value.contentItems)) {
    throw new RpcError(-32000, 'Invalid tool host result.');
  }
  const content = value.contentItems.map((item: unknown) => {
    if (!isRecord(item) || item.type !== 'inputText' || typeof item.text !== 'string') {
      throw new RpcError(-32000, 'Unsupported tool host content.');
    }
    return { type: 'text' as const, text: item.text };
  });
  return { content, isError: !value.success };
}

function serve(path: string): void {
  const pipe = new HostPipe(path);
  const pending = new Map<RpcId, AbortController>();
  let initialized = false;
  let ready = false;
  let stopped = false;
  const input = Buffer.allocUnsafe(MAX_FRAME_BYTES);
  let bytes = 0;

  function stop() {
    if (stopped) return;
    stopped = true;
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    pipe.close();
  }
  function send(message: unknown) {
    if (stopped) return;
    let line: string;
    try { line = JSON.stringify(message) + '\n'; }
    catch { stop(); return; }
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES || process.stdout.writableLength + Buffer.byteLength(line) > MAX_FRAME_BYTES) {
      stop(); process.stdin.destroy(); return;
    }
    process.stdout.write(line);
  }
  function error(id: RpcId | null, code: number, message: string) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
  async function handle(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (!initialized || !ready) throw new RpcError(-32002, 'MCP initialization is incomplete.');
    if (method === 'ping') return {};
    if (method === 'tools/list') {
      const tools = await catalog(pipe, signal);
      return { tools: tools.map(({ namespace: _namespace, ...tool }) => tool) };
    }
    if (method !== 'tools/call') throw new RpcError(-32601, 'Method not found.');
    if (!isRecord(params) || typeof params.name !== 'string' || !params.name ||
        (params.arguments !== undefined && !isRecord(params.arguments))) throw new RpcError(-32602, 'Invalid tool call.');
    const caller = attribution(params._meta);
    const tools = await catalog(pipe, signal);
    const tool = tools.find(item => item.name === params.name);
    if (!tool) throw new RpcError(-32602, 'Unknown tool.');
    const result = await pipe.request('tools/call', { callerSource: 'codex', hostId: 'local', ...caller,
      namespace: tool.namespace, tool: tool.name, arguments: params.arguments ?? {} }, signal);
    return toolResult(result);
  }
  function receive(line: Buffer) {
    let message: unknown;
    try { message = JSON.parse(line.toString('utf8')); }
    catch { error(null, -32700, 'Parse error.'); return; }
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
        (Object.hasOwn(message, 'id') && !isId(message.id))) {
      error(null, -32600, 'Invalid request.'); return;
    }
    if (!Object.hasOwn(message, 'id')) {
      if (message.method === 'notifications/initialized' && initialized) ready = true;
      if (message.method === 'notifications/cancelled' && isRecord(message.params) && isId(message.params.requestId)) {
        const controller = pending.get(message.params.requestId);
        if (controller) { pending.delete(message.params.requestId); controller.abort(); }
      }
      return;
    }
    const id = message.id as RpcId;
    if (message.method === 'initialize') {
      if (initialized || !isRecord(message.params) || typeof message.params.protocolVersion !== 'string' ||
          !isRecord(message.params.capabilities) || !isRecord(message.params.clientInfo)) {
        error(id, -32602, 'Invalid initialization.'); return;
      }
      initialized = true;
      const protocolVersion = versions.has(message.params.protocolVersion) ? message.params.protocolVersion : '2025-06-18';
      send({ jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'codex-yard-tools', version: '1.0.0' } } });
      return;
    }
    if (pending.has(id) || pending.size >= MAX_PENDING_CALLS) { error(id, -32000, 'Duplicate or too many requests.'); return; }
    const controller = new AbortController();
    pending.set(id, controller);
    void handle(message.method, message.params, controller.signal).then(result => {
      if (pending.get(id) === controller && !controller.signal.aborted) send({ jsonrpc: '2.0', id, result });
    }, (cause: unknown) => {
      if (pending.get(id) === controller && !controller.signal.aborted) {
        error(id, cause instanceof RpcError ? cause.code : -32000, cause instanceof Error ? cause.message : 'Tool request failed.');
      }
    }).finally(() => { if (pending.get(id) === controller) pending.delete(id); });
  }
  process.stdin.on('data', (chunk: Buffer) => {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      const length = end - start;
      if (bytes + length > MAX_FRAME_BYTES) { error(null, -32600, 'MCP frame exceeds the limit.'); stop(); process.stdin.destroy(); return; }
      chunk.copy(input, bytes, start, end);
      bytes += length;
      if (newline < 0) return;
      if (bytes) receive(input.subarray(0, bytes));
      bytes = 0;
      start = newline + 1;
    }
  });
  process.stdin.on('end', stop);
  process.stdin.on('error', stop);
  process.stdout.on('error', () => { stop(); process.stdin.destroy(); });
}

const socketPath = process.env.CODEX_APP_TOOLS_PIPE_PATH;
if (!socketPath || process.env.CODEX_APP_TOOLS_CALLER_HOST_ID !== 'local') {
  process.stderr.write('A local Codex App Tools pipe and host ID are required.\n');
  process.exitCode = 1;
} else serve(socketPath);
