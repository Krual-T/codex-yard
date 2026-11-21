// Keep the original Sky RPC implementation; attach held input to the Codex turn.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRecord } from './codex-protocol.ts';
const object = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const upstream = await import(pathToFileURL(join(process.env.YARD_NODE_REPL_ROOT!, 'lib/node_modules/@oai/sky/dist/project/cua/sky_js/src/service.js')).href) as { handleRpc(input: unknown): Promise<unknown> };
interface Turn { session_id?: string; turn_id?: string }
interface Runtime { requestMeta?: Record<string, unknown>; addTurnEndedHandler(options: { timeoutMs: number; run(event: Turn): Promise<void> }): unknown }
const runtime = (globalThis as typeof globalThis & { nodeRepl: Runtime }).nodeRepl;
const held = new Map<string, { turn: Turn; release: Record<string, unknown>; ready?: Promise<unknown> }>();
function currentTurn(): Turn {
  let value = runtime.requestMeta?.['x-codex-turn-metadata'];
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  const turn = object(value);
  return { session_id: String(turn.thread_source === 'subagent' ? turn.thread_id : turn.session_id ?? ''), turn_id: String(turn.turn_id ?? '') };
}
runtime.addTurnEndedHandler({ timeoutMs: 4000, async run(event) {
  for (const [id, input] of held) {
    if (input.turn.session_id && (input.turn.session_id !== event.session_id || input.turn.turn_id !== event.turn_id)) continue;
    try { await input.ready; await upstream.handleRpc(input.release); held.delete(id); }
    catch (error) { console.error('Sky input release failed:', error); }
  }
} });
export async function handleRpc(value: unknown) {
  const request = object(value), args = Array.isArray(request.args) ? request.args : [], input = object(args[0]);
  const keyId = `key:${String(object(input.window).id ?? 'desktop')}:${String(input.key)}`;
  const dragId = `drag:${String(request.handle_id)}`;
  if (request.type === 'execute' && request.method === 'key_down') held.set(keyId, { turn: currentTurn(), release: { type: 'execute', method: 'key_up', args } });
  if (request.type === 'drag_start') held.set(dragId, { turn: currentTurn(), release: { type: 'drag_end', handle_id: request.handle_id } });
  const operation = upstream.handleRpc(value);
  const pending = request.type === 'drag_start' ? held.get(dragId) : request.method === 'key_down' ? held.get(keyId) : undefined;
  if (pending) pending.ready = operation;
  const result = await operation;
  if (request.type === 'execute' && request.method === 'key_up') held.delete(keyId);
  if (request.type === 'drag_end') held.delete(dragId);
  return result;
}
