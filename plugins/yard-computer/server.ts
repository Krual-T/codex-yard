import { pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { X11Desktop } from './desktop.ts';
import { WindowsDesktop } from './windows.ts';

export const computerTool = {
  name: 'computer',
  description: 'Observe and operate the explicitly configured Yard Linux X11 desktop. Start with screenshot. Every successful action returns a fresh PNG with display and pixel dimensions. Coordinates are absolute screen pixels. Unicode type updates X11 PRIMARY with the text and uses middle-click paste: click the editable target and keep the pointer over it; to replace selected text, delete the selection first with Backspace. PRIMARY keeps the new text until another selection replaces it. The main CLIPBOARD is never written. Split text into calls of at most 1000 characters. A failed action may already have executed; inspect a new screenshot before continuing. No Codex App is required.',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['type'],
    properties: {
      type: { type: 'string', enum: ['screenshot', 'click', 'move', 'drag', 'type', 'keypress', 'scroll', 'wait'] },
      x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 },
      fromX: { type: 'integer', minimum: 0 }, fromY: { type: 'integer', minimum: 0 },
      toX: { type: 'integer', minimum: 0 }, toY: { type: 'integer', minimum: 0 },
      button: { type: 'string', enum: ['left', 'middle', 'right'] },
      clicks: { type: 'integer', minimum: 1, maximum: 20, description: 'Click: 1–3 (default 1). Scroll: 1–20 (required).' },
      text: { type: 'string', minLength: 1, maxLength: 1000, description: 'Unicode uses PRIMARY middle-click paste at the pointer. Click the editable target first; delete an existing selection before replacing it.' },
      keys: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      milliseconds: { type: 'integer', minimum: 0, maximum: 2000 },
    },
  },
} as const;

export type ComputerContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ComputerExecutor { platform?: string; execute(action: unknown, signal?: AbortSignal): Promise<ComputerContent[]> }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Newline JSON-RPC, over stdio only. The daemon owns session approvals and the
 * process lifecycle; the desktop driver owns cross-process input serialization. */
export async function serveComputer(input: Readable, output: Writable, desktop: ComputerExecutor, signal?: AbortSignal): Promise<void> {
  const tool = desktop.platform === 'windows' ? { ...computerTool,
    description: 'Observe and operate the explicitly configured Windows primary monitor. Start with screenshot; use its physical pixels with origin at top left. Every success returns a fresh PNG. Unicode typing uses SendInput and preserves the clipboard. The signed-in desktop must be unlocked; elevated targets, UAC and service sessions are not supported. Failed input may already have changed the desktop and is never retried. No Codex App is required.',
    inputSchema: { ...computerTool.inputSchema, properties: { ...computerTool.inputSchema.properties,
      text: { type: 'string', minLength: 1, maxLength: 1000, description: 'Unicode text entered into the focused control using SendInput, without touching the clipboard.' } } } } : computerTool;
  let buffer = '', initialized = false;
  input.setEncoding('utf8');
  const pending = new Map<string | number, AbortController>();
  const active = new Set<Promise<void>>();
  const cancel = () => { for (const controller of pending.values()) controller.abort(); input.destroy(); };
  output.once('error', cancel); output.once('close', cancel);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  function reply(id: string | number | null, payload: Record<string, unknown>) {
    output.write(JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n');
  }
  function receive(value: unknown) {
    if (!object(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') {
      reply(null, { error: { code: -32600, message: 'Invalid JSON-RPC request.' } }); return;
    }
    const params = object(value.params) ? value.params : {};
    if (value.id === undefined) {
      if (value.method === 'notifications/cancelled' && (typeof params.requestId === 'string' || typeof params.requestId === 'number')) {
        pending.get(params.requestId)?.abort();
      }
      return;
    }
    if (typeof value.id !== 'string' && typeof value.id !== 'number') {
      reply(null, { error: { code: -32600, message: 'Invalid request id.' } }); return;
    }
    const id = value.id;
    if (value.method === 'initialize') {
      initialized = true;
      reply(id, { result: { protocolVersion: params.protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-03-26',
        capabilities: { tools: {} }, serverInfo: { name: 'yard-computer', version: '0.2.0' },
        instructions: 'Use computer screenshot before acting. This tool controls the explicitly configured execution-host desktop. Follow the user authorization and normal session approvals.' } });
      return;
    }
    if (!initialized) { reply(id, { error: { code: -32002, message: 'Initialize the MCP session first.' } }); return; }
    if (value.method === 'ping') { reply(id, { result: {} }); return; }
    if (value.method === 'tools/list') { reply(id, { result: { tools: [tool] } }); return; }
    if (value.method !== 'tools/call') { reply(id, { error: { code: -32601, message: 'Unknown MCP method.' } }); return; }
    if (params.name !== 'computer') { reply(id, { error: { code: -32602, message: 'Unknown tool.' } }); return; }
    if (pending.has(id) || pending.size >= 16) {
      reply(id, { error: { code: -32000, message: 'Duplicate or too many pending computer requests.' } }); return;
    }
    const controller = new AbortController(); pending.set(id, controller);
    const operation = Promise.resolve().then(() => desktop.execute(params.arguments, controller.signal)).then(content => {
      if (!controller.signal.aborted) reply(id, { result: { content } });
    }, cause => {
      if (!controller.signal.aborted) reply(id, { result: { isError: true,
        content: [{ type: 'text', text: cause instanceof Error ? cause.message : String(cause) }] } });
    }).finally(() => { pending.delete(id); active.delete(operation); });
    active.add(operation);
  }
  try {
    for await (const chunk of input) {
      buffer += String(chunk);
      if (Buffer.byteLength(buffer) > 128 * 1024) throw new Error('MCP request exceeds 128 KiB.');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let value: unknown;
        try { value = JSON.parse(line); }
        catch { reply(null, { error: { code: -32700, message: 'Invalid JSON.' } }); continue; }
        receive(value); // Keep reading cancellation while the driver serializes input.
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    output.off('error', cancel); output.off('close', cancel);
    for (const controller of pending.values()) controller.abort();
    await Promise.allSettled(active);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const driver = process.argv.find(arg => arg.startsWith('--driver='))?.slice('--driver='.length) || process.env.YARD_COMPUTER_DRIVER || 'x11';
  if (!['windows', 'x11'].includes(driver)) throw new Error('Choose --driver=windows or --driver=x11.');
  const desktop = driver === 'windows' ? new WindowsDesktop() : new X11Desktop({ display: process.env.YARD_COMPUTER_DISPLAY,
    xauthority: process.env.YARD_COMPUTER_XAUTHORITY, importCommand: process.env.YARD_COMPUTER_IMPORT,
    xdotoolCommand: process.env.YARD_COMPUTER_XDOTOOL, xclipCommand: process.env.YARD_COMPUTER_XCLIP });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  serveComputer(process.stdin, process.stdout, desktop, shutdown.signal).catch(cause => {
    if (!shutdown.signal.aborted) { console.error(cause instanceof Error ? cause.message : cause); process.exitCode = 1; }
  }).finally(() => { process.off('SIGTERM', stop); process.off('SIGINT', stop); });
}
