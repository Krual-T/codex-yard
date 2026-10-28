import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { errorMessage, isRecord } from './codex-protocol.ts';
import type { RpcId } from './codex-protocol.ts';
import { bundledAppToolsAdapter } from './app-resources.ts';

export const defaultAppToolsAdapter = bundledAppToolsAdapter;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_CALLS = 128;

export interface ToolArgumentSchema {
  type: 'string' | 'integer' | 'boolean' | 'array'; description?: string; default?: boolean;
  minLength?: number; maxLength?: number; minimum?: number; maximum?: number; enum?: readonly string[];
  items?: ToolArgumentSchema; minItems?: number; maxItems?: number;
}
export interface AppToolDescriptor {
  namespace: string; name: string; description: string;
  inputSchema: { type: 'object'; properties: Record<string, ToolArgumentSchema>;
    required?: readonly string[]; additionalProperties: false };
}
export interface AppToolCall {
  callerSource: 'codex' | 'chatgpt'; hostId?: 'local' | null;
  threadId: string; turnId: string; callId: string; namespace: string; tool: string; arguments: unknown;
}
export type AppToolHandler = (params: AppToolCall, context: { signal: AbortSignal }) => unknown | Promise<unknown>;
export interface AppToolsOptions {
  tools: readonly AppToolDescriptor[]; callTool: AppToolHandler; adapterPath?: string; socketPath?: string;
}
type ToolReply = { result: unknown } | { error: { code: number; message: string } };

function isCall(value: unknown): value is AppToolCall {
  return isRecord(value) && (value.callerSource === 'codex' || value.callerSource === 'chatgpt') &&
    (value.hostId == null || value.hostId === 'local') &&
    ['threadId', 'turnId', 'callId', 'namespace', 'tool'].every(key => typeof value[key] === 'string' && value[key].trim()) &&
    Object.hasOwn(value, 'arguments');
}
function missingFile(cause: unknown): null {
  if (!isRecord(cause) || cause.code !== 'ENOENT') throw cause;
  return null;
}

/** Hosts the native pipe consumed by the installed official Codex App Tools MCP adapter. */
export async function createAppTools({ tools, callTool, adapterPath = process.env.AGENTS_APP_TOOLS_ADAPTER || defaultAppToolsAdapter, socketPath: requestedSocketPath }: AppToolsOptions) {
  adapterPath = resolve(adapterPath);
  try {
    await access(adapterPath, constants.R_OK);
    if (!(await stat(adapterPath)).isFile()) throw new Error('不是文件');
  } catch (cause) {
    throw new Error(`无法读取官方 Codex App Tools 适配器：${adapterPath}。`, { cause });
  }
  if (!Array.isArray(tools) || typeof callTool !== 'function') throw new TypeError('需要工具目录和 callTool 处理函数。');

  const temporary = requestedSocketPath == null;
  const directory = requestedSocketPath == null ? await mkdtemp('/tmp/aw-') : dirname(resolve(requestedSocketPath));
  const socketPath = requestedSocketPath == null ? join(directory, 'tools.sock') : resolve(requestedSocketPath);
  if (Buffer.byteLength(socketPath) > 107) throw new Error(`App Tools Unix socket 路径超过 107 字节，请缩短数据目录：${socketPath}`);
  if (!temporary) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const parent = await lstat(directory);
    if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077)) {
      throw new Error(`App Tools socket 需要当前用户拥有的私有目录（0700）：${directory}`);
    }
    const existing = await lstat(socketPath).catch(missingFile);
    if (existing) {
      if (!existing.isSocket() || existing.uid !== process.getuid?.() || (existing.mode & 0o077)) {
        throw new Error(`App Tools socket 路径已被其他内容占用：${socketPath}`);
      }
      const active = await new Promise<boolean>((resolve, reject) => {
        const probe = createConnection({ path: socketPath });
        const finish = (value: boolean) => { probe.destroy(); resolve(value); };
        probe.setTimeout(300, () => finish(true));
        probe.once('connect', () => finish(true));
        probe.once('error', cause => {
          probe.destroy();
          if (isRecord(cause) && (cause.code === 'ECONNREFUSED' || cause.code === 'ENOENT')) resolve(false);
          else reject(cause);
        });
      });
      if (active) throw new Error(`App Tools socket 已由运行中的实例使用：${socketPath}`);
      const current = await lstat(socketPath).catch(missingFile);
      if (current && (current.ino !== existing.ino || current.dev !== existing.dev)) throw new Error('App Tools socket 在启动时发生变化，请重试。');
      if (current) await rm(socketPath);
    }
  }
  const clients = new Set<Socket>();
  let closing: Promise<void> | undefined;
  const server = createServer(socket => {
    if (closing) { socket.destroy(); return; }
    const pending = new Map<RpcId, AbortController>();
    const header = Buffer.alloc(4);
    let headerBytes = 0;
    let payload: Buffer | null = null;
    let payloadBytes = 0;
    let disconnected = false;
    const stop = () => {
      if (disconnected) return;
      disconnected = true;
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      payload = null;
      clients.delete(socket);
    };
    clients.add(socket);
    socket.once('close', stop);
    socket.on('error', () => { stop(); socket.destroy(); });

    function respond(id: RpcId | null, value: ToolReply) {
      if (disconnected || socket.destroyed) return;
      let body;
      try { body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, ...value })); }
      catch { body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: '无法编码工具结果。' } })); }
      if (body.length > MAX_FRAME_BYTES || socket.writableLength + body.length + 4 > MAX_FRAME_BYTES + 4) {
        stop(); socket.destroy(); return;
      }
      const frame = Buffer.allocUnsafe(body.length + 4);
      frame.writeUInt32LE(body.length, 0);
      body.copy(frame, 4);
      socket.write(frame);
    }

    function receive(body: Buffer) {
      let message: unknown;
      try { message = JSON.parse(body.toString('utf8')); }
      catch { respond(null, { error: { code: -32700, message: 'JSON 格式无效。' } }); return; }
      if (!isRecord(message) || message.jsonrpc !== '2.0' ||
          !(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isFinite(message.id))) || typeof message.method !== 'string') {
        respond(null, { error: { code: -32600, message: '工具请求格式无效。' } }); return;
      }
      const id = message.id;
      if (message.method === 'tools/cancel') {
        const controller = pending.get(id);
        pending.delete(id);
        controller?.abort();
        return;
      }
      if (message.method === 'tools/list') { respond(id, { result: { tools } }); return; }
      if (message.method !== 'tools/call') {
        respond(id, { error: { code: -32601, message: '不支持的工具宿主方法。' } }); return;
      }
      const params = message.params;
      if (!isCall(params) || !tools.some(tool => tool.namespace === params.namespace && tool.name === params.tool)) {
        respond(id, { error: { code: -32602, message: '工具或调用上下文无效。' } }); return;
      }
      if (pending.has(id) || pending.size >= MAX_PENDING_CALLS) {
        respond(id, { error: { code: -32000, message: '工具请求重复或在途调用过多。' } }); return;
      }
      const controller = new AbortController();
      pending.set(id, controller);
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return callTool(params, { signal: controller.signal });
      }).then(result => {
        if (pending.get(id) === controller && !controller.signal.aborted) respond(id, { result });
      }, (cause: unknown) => {
        if (pending.get(id) === controller && !controller.signal.aborted) respond(id, { error: {
          code: isRecord(cause) && typeof cause.code === 'number' ? cause.code : -32000,
          message: errorMessage(cause) || '工具调用失败。',
        } });
      }).finally(() => { if (pending.get(id) === controller) pending.delete(id); })
        .catch(() => { stop(); socket.destroy(); });
    }

    // Keep one bounded frame, even when a client fragments headers or combines many frames.
    socket.on('data', (chunk: Buffer) => {
      let offset = 0;
      while (offset < chunk.length && !disconnected) {
        if (payload === null) {
          const count = Math.min(4 - headerBytes, chunk.length - offset);
          chunk.copy(header, headerBytes, offset, offset + count);
          headerBytes += count;
          offset += count;
          if (headerBytes !== 4) continue;
          const length = header.readUInt32LE(0);
          headerBytes = 0;
          if (length > MAX_FRAME_BYTES) { stop(); socket.destroy(); return; }
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
          receive(complete);
        }
      }
    });
  });
  // Listening errors reject startup; later server errors close its current clients safely.
  server.on('error', () => { for (const socket of clients) socket.destroy(); });
  try {
    if (temporary) await chmod(directory, 0o700);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolve(); });
    });
    await chmod(socketPath, 0o600);
  } catch (cause) {
    for (const socket of clients) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (temporary) await rm(directory, { recursive: true, force: true });
    throw cause;
  }

  return {
    socketPath, adapterPath,
    config: { 'mcp_servers.codex_app': {
      command: process.execPath, args: [adapterPath], cwd: dirname(adapterPath),
      env: { CODEX_APP_TOOLS_PIPE_PATH: socketPath, CODEX_APP_TOOLS_CALLER_HOST_ID: 'local' },
      enabled: true, required: true, default_tools_approval_mode: 'approve',
    } },
    close() {
      closing ??= (async () => {
        for (const socket of clients) socket.destroy();
        await new Promise(resolve => server.close(resolve));
        if (temporary) await rm(directory, { recursive: true, force: true });
      })();
      return closing;
    },
  };
}
