import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { NodeRuntime } from './runtime.ts';

const tools = [{ name: 'evaluate', description: 'Execute JavaScript in a persistent standalone Node.js kernel with top-level await. Import with await yardNode.import("node:fs/promises") or a package name; use process.chdir for a task directory. console.log and the last expression return text. yardNode.emitImage({bytes,mimeType}) returns a PNG/JPEG image. Variables persist until reset, timeout, cancellation or session unload. File/network side effects remain after reset; never blindly repeat cancelled code. This is ordinary Node under the MCP session policy, not a sandbox. App RPC/BrowserLib are not included.',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  inputSchema: { type: 'object', required: ['code'], additionalProperties: false, properties: {
    code: { type: 'string', minLength: 1, maxLength: 65536 }, timeout_ms: { type: 'integer', minimum: 1, maximum: 60000, default: 30000 },
  } } },
{ name: 'reset', description: 'Discard the JavaScript kernel and its variables. File/network side effects and separately spawned processes remain.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} } }];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function serveNode(input: Readable, output: Writable, runtime = new NodeRuntime(), signal?: AbortSignal) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Map<string | number, AbortController>();
  const active = new Set<Promise<unknown>>();
  let initialized = false;
  const stop = () => { for (const abort of pending.values()) abort.abort(); runtime.close(); lines.close(); input.destroy(); };
  signal?.addEventListener('abort', stop, { once: true });
  output.once('error', stop); output.once('close', stop);
  const reply = (id: unknown, payload: object) => output.write(JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n');
  try {
    if (signal?.aborted) return;
    for await (const line of lines) {
      let message: unknown;
      try { if (Buffer.byteLength(line) > 1024 * 1024) throw new Error(); message = JSON.parse(line); }
      catch { reply(null, { error: { code: -32700, message: 'Invalid JSON request.' } }); continue; }
      if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') { reply(null, { error: { code: -32600, message: 'Invalid request.' } }); continue; }
      const params = object(message.params) ? message.params : {};
      if (message.id === undefined) {
        if (message.method === 'notifications/cancelled' && (typeof params.requestId === 'number' || typeof params.requestId === 'string')) pending.get(params.requestId)?.abort();
        continue;
      }
      const id = message.id;
      if (typeof id !== 'string' && typeof id !== 'number') { reply(null, { error: { code: -32600, message: 'Invalid request id.' } }); continue; }
      if (message.method === 'initialize') {
        initialized = true; reply(id, { result: { protocolVersion: params.protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'yard-node', version: '0.1.0' } } }); continue;
      }
      if (!initialized) { reply(id, { error: { code: -32002, message: 'Initialize first.' } }); continue; }
      if (message.method === 'ping') { reply(id, { result: {} }); continue; }
      if (message.method === 'tools/list') { reply(id, { result: { tools } }); continue; }
      if (message.method !== 'tools/call') { reply(id, { error: { code: -32601, message: 'Unknown method.' } }); continue; }
      if (!['evaluate', 'reset'].includes(String(params.name))) { reply(id, { error: { code: -32602, message: 'Unknown tool.' } }); continue; }
      if (pending.has(id) || pending.size >= 16) { reply(id, { error: { code: -32000, message: 'Duplicate or too many pending requests.' } }); continue; }
      const abort = new AbortController(); pending.set(id, abort);
      const operation = (async () => {
        try {
          const args = object(params.arguments) ? params.arguments : {};
          if (params.name === 'reset') { runtime.reset(); reply(id, { result: { content: [{ type: 'text', text: 'JavaScript kernel reset.' }] } }); }
          else reply(id, { result: { content: await runtime.evaluate(args.code as string, args.timeout_ms as number | undefined, abort.signal) } });
        } catch (error) { reply(id, { result: { isError: true, content: [{ type: 'text', text: String(error) }] } }); }
        finally { pending.delete(id); }
      })();
      active.add(operation); void operation.finally(() => active.delete(operation));
    }
  } finally {
    stop(); await Promise.allSettled(active); await runtime.close();
    signal?.removeEventListener('abort', stop); output.off('error', stop); output.off('close', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort()); process.once('SIGTERM', () => abort.abort());
  await serveNode(process.stdin, process.stdout, new NodeRuntime(), abort.signal);
}
