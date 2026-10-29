import { isDeepStrictEqual } from 'node:util';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toString } from 'mdast-util-to-string';
import { directive } from 'micromark-extension-directive';
import { gfm } from 'micromark-extension-gfm';
import { parse as parseHtml } from 'node-html-parser';
import { isRecord } from './codex-protocol.ts';
import type { ThreadItemSummary, ThreadSummary, TurnSummary } from './codex-protocol.ts';
import { boundedJson, versionAtLeast } from './native-tool-kernel.ts';
import type { NativeHosts, NativeManager, WaitTarget, formatAssistantMessage } from './native-tool-kernel.ts';

const readOptions = { timeoutMs: 15_000 };
const maxText = 2_000;
const maxHistoryBytes = 16 * 1024 * 1024;
type ExtraThread = ThreadSummary & { preview?: string; createdAt?: number; updatedAt?: number; historyMode?: string };
type ExtraTurn = TurnSummary & { startedAt?: number | null; completedAt?: number | null; durationMs?: number | null; itemsView?: string };
type Status = ThreadSummary['status'];
type LatestMessage = { id: string; turnId: string; phase: unknown; text: string; truncated?: boolean; originalChars?: number };
type ToolMarker = { id: string; turnId: string; type: string; name: unknown; status: unknown };
interface Projection {
  thread: { id: string; hostId: string; status: Status };
  latestTurn: { id: string; status: TurnSummary['status']; error: { message: string } | null; startedAt?: number | null; completedAt?: number | null; durationMs?: number | null } | null;
  latestAssistantMessage: LatestMessage | null;
  latestToolMarker: ToolMarker | null;
}
interface PollState { manager: NativeManager; generation: string; revision: number; fingerprint: string; ordinal: number; projection: Projection }
interface Poll extends Projection { schemaVersion: 1; cursor: string; revision: number; changed: boolean; cursorReset?: boolean; latestAssistantMessageId: string | null; latestToolMarkerId: string | null }
type Wake = { reason: 'turnCompleted'; turnId: string } | { reason: 'inactiveStatus' | 'actionableStatus' };
interface WaitResult { timedOut: boolean; wake: Wake | null; poll: Poll }

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted)).catch(() => {});
  });
}
function truncated(text: string, limit: number) {
  return text.length <= limit ? { text, truncated: false } : { text: text.slice(0, limit), truncated: true, originalChars: text.length };
}
function delegation(text: string) {
  const value = text.trim();
  if (!value.startsWith('<codex_delegation>') || !value.endsWith('</codex_delegation>')) return undefined;
  const extract = (name: string) => new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, 'i').exec(value)?.[1]?.trim()
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const sourceThreadId = extract('source_thread_id'), input = extract('input');
  return sourceThreadId == null || input == null ? undefined : { sourceThreadId, input };
}
function historyInput(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case 'text': return { type: value.type, text: value.text, codexDelegation: typeof value.text === 'string' ? delegation(value.text) : undefined };
    case 'image': return { type: value.type, url: typeof value.url === 'string' && !/^data:/i.test(value.url) ? value.url : undefined, fileId: value.fileId };
    case 'localImage': case 'localAudio': return { type: value.type, path: value.path };
    case 'audio': return { type: value.type, url: value.url };
    case 'skill': case 'mention': return { type: value.type, name: value.name, path: value.path };
    default: return undefined;
  }
}
function historyItem(item: ThreadItemSummary, includeOutputs: boolean, limit: number): unknown {
  const base = { type: item.type, id: item.id };
  const fields = (...names: string[]) => Object.fromEntries(names.map(name => [name, item[name]]));
  switch (item.type) {
    case 'userMessage': return { ...base, content: Array.isArray(item.content) ? item.content.map(historyInput) : [] };
    case 'agentMessage': return { ...base, ...fields('text', 'phase') };
    case 'plan': return { ...base, ...fields('text') };
    case 'reasoning': return { ...base, ...fields('summary'), ...(includeOutputs ? { content: Array.isArray(item.content) ? item.content.map(value => truncated(String(value), limit)) : [] } : {}) };
    case 'commandExecution': return { ...base, ...fields('command', 'cwd', 'status', 'exitCode', 'durationMs'), ...(includeOutputs && item.aggregatedOutput != null ? { output: truncated(String(item.aggregatedOutput), limit) } : {}) };
    case 'fileChange': return { ...base, ...fields('status'), changes: Array.isArray(item.changes) ? item.changes.map(change => isRecord(change) ? { path: change.path, kind: change.kind, ...(includeOutputs ? { diff: truncated(String(change.diff ?? ''), limit) } : {}) } : undefined) : [] };
    case 'mcpToolCall': return { ...base, ...fields('server', 'tool', 'arguments', 'status', 'durationMs') };
    case 'functionCallOutput': return { ...base, ...fields('name', 'namespace'), ...(includeOutputs ? { output: truncated(typeof item.output === 'string' ? item.output : JSON.stringify(item.output), limit) } : {}) };
    case 'dynamicToolCall': return { ...base, ...fields('tool', 'arguments', 'status', 'success', 'durationMs') };
    case 'collabAgentToolCall': return { ...base, ...fields('tool', 'status', 'senderThreadId', 'receiverThreadIds', 'prompt', 'model', 'reasoningEffort') };
    case 'subAgentActivity': return { ...base, ...fields('kind', 'agentThreadId', 'agentPath') };
    case 'webSearch': return { ...base, ...fields('query', 'action') };
    case 'imageView': return { ...base, ...fields('path') };
    case 'sleep': return { ...base, ...fields('durationMs') };
    case 'imageGeneration': return { ...base, ...fields('status', 'revisedPrompt'), savedPath: item.savedPath ?? null };
    case 'enteredReviewMode': case 'exitedReviewMode': return { ...base, ...fields('review') };
    case 'hookPrompt': return { ...base, fragmentCount: Array.isArray(item.fragments) ? item.fragments.length : 0 };
    case 'contextCompaction': return base;
    default: return undefined;
  }
}
export async function readHistory(options: {
  getAppServerVersion(): string | null; cursor?: string; hostId: string; isCloudHost: boolean;
  includeOutputs: boolean; manager: NativeManager; maxOutputCharsPerItem: number; signal?: AbortSignal;
  thread: ThreadSummary; threadId: string; turnLimit: number;
}): Promise<unknown> {
  const { manager, signal, threadId, turnLimit, cursor } = options;
  signal?.throwIfAborted();
  let thread = options.thread as ExtraThread, turns: TurnSummary[], nextCursor: string | null, hasMore: boolean;
  const version = options.getAppServerVersion();
  if (thread.historyMode === 'paginated' || options.isCloudHost || (version !== '0.0.0' && versionAtLeast(version, 0, 145, 0, 15))) {
    const anchorCursor = !options.isCloudHost && thread.historyMode !== 'paginated';
    const result = await abortable(manager.listThreadTurns(threadId, { cursor: anchorCursor && cursor != null ? JSON.stringify({ turnId: cursor, includeAnchor: false }) : cursor,
      itemsView: 'full', itemLimit: null, itemSnapshot: 'latest', maxBytes: maxHistoryBytes, limit: turnLimit, requestOptions: readOptions }), signal);
    turns = result.response.data;
    hasMore = result.response.nextCursor != null;
    nextCursor = anchorCursor && hasMore ? turns.at(-1)?.id ?? null : result.response.nextCursor;
  } else {
    thread = (await abortable(manager.readThread(threadId, { includeTurns: true, requestOptions: readOptions }), signal)).thread as ExtraThread;
    boundedJson(thread, maxHistoryBytes, 'Thread history exceeds the read size limit. Update Codex to use paginated history reads.');
    const end = cursor == null ? thread.turns.length : thread.turns.findIndex(turn => turn.id === cursor);
    if (end < 0) throw new Error(`Unknown cursor for thread ${threadId}: ${cursor}`);
    const older = thread.turns.slice(0, end);
    turns = older.slice(-turnLimit).reverse();
    hasMore = older.length > turns.length;
    nextCursor = hasMore ? turns.at(-1)?.id ?? null : null;
  }
  signal?.throwIfAborted();
  const status = thread.status.type === 'active' ? { type: 'active', activeFlags: thread.status.activeFlags } : { type: thread.status.type };
  return { schemaVersion: 1, thread: { id: thread.id, kind: 'codex', hostId: options.hostId, title: thread.name,
    preview: thread.preview, status, cwd: thread.cwd, createdAt: thread.createdAt, updatedAt: thread.updatedAt },
    page: { order: 'newest_first', limit: turnLimit, nextCursor, hasMore }, turns: turns.map(value => {
      const turn = value as ExtraTurn;
      return { id: turn.id, status: turn.status, error: turn.error == null ? null : { message: turn.error.message, additionalDetails: turn.error.additionalDetails },
        startedAt: turn.startedAt, completedAt: turn.completedAt, durationMs: turn.durationMs,
        items: turn.items.map(item => historyItem(item, options.includeOutputs, options.maxOutputCharsPerItem)) };
    }) };
}

function plainMarkdown(value: string): string {
  let fence: { marker: string; length: number } | null = null;
  const markdown = value.replace(/\uE200[^\uE201]*\uE201/g, '').split('\n').map(line => {
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const wasFenced = fence !== null;
    if (opening) {
      const marker = opening[1]![0]!;
      if (!fence && !(marker === '`' && opening[2]!.includes('`'))) fence = { marker, length: opening[1]!.length };
      else if (fence && marker === fence.marker && opening[1]!.length >= fence.length && !opening[2]!.trim()) fence = null;
    }
    return wasFenced || fence ? line : line.replace(/(^|[^:])::([A-Za-z][A-Za-z0-9_-]*)(?=[[{])/g, '$1:$2');
  }).join('\n').trim();
  if (!markdown) return '';
  const blocks = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow', 'tableCell', 'containerDirective']);
  function text(node: unknown): string {
    if (!isRecord(node) || typeof node.type !== 'string') return '';
    if (node.type === 'html' && typeof node.value === 'string') {
      const html = parseHtml(node.value);
      for (const element of html.querySelectorAll('script,style')) element.remove();
      return html.structuredText;
    }
    if (Array.isArray(node.children)) {
      const pieces: string[] = [];
      let hidden: 'script' | 'style' | null = null;
      for (const child of node.children) {
        if (isRecord(child) && child.type === 'html' && typeof child.value === 'string') {
          if (hidden) { if (new RegExp(`<\\s*/\\s*${hidden}\\s*>`, 'i').test(child.value)) hidden = null; continue; }
          const start = /<\s*(script|style)\b[^>]*>/i.exec(child.value);
          if (start && !start[0].endsWith('/>') && !new RegExp(`<\\s*/\\s*${start[1]}\\s*>`, 'i').test(child.value)) {
            hidden = start[1]!.toLowerCase() as 'script' | 'style';
            continue;
          }
        } else if (hidden) continue;
        pieces.push(text(child));
      }
      return pieces.join(blocks.has(node.type) ? ' ' : '');
    }
    return toString(node as Parameters<typeof toString>[0]);
  }
  return text(fromMarkdown(markdown, { extensions: [gfm(), directive()], mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown()] })).replace(/\s+/g, ' ').trim();
}
function latestMessage(turn: ExtraTurn | null, formatter: typeof formatAssistantMessage): LatestMessage | null {
  if (!turn) return null;
  let lastActivity = -1;
  for (let i = turn.items.length - 1; i >= 0; i--) {
    if (!['userMessage', 'hookPrompt', 'steeringUserMessage', 'steered'].includes(turn.items[i]!.type)) { lastActivity = i; break; }
  }
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const item = turn.items[i]!;
    if (item.type !== 'agentMessage' || typeof item.text !== 'string') continue;
    const active = turn.status === 'inProgress' && i === lastActivity;
    const formatted = formatter(item.text, active);
    if ((formatted.removed && !formatted.content) || (active && formatted.content.trimStart().startsWith('{'))) continue;
    const heartbeat = /<heartbeat>[\s\S]*?<\/heartbeat>/gi;
    const lastHeartbeat = [...formatted.content.matchAll(heartbeat)].at(-1)?.[0];
    let visible = formatted.content;
    if (lastHeartbeat && /<decision>\s*(?:NOTIFY|DONT_NOTIFY)\s*<\/decision>/i.test(lastHeartbeat)) {
      visible = formatted.content.replace(/```(?:xml)?\s*<heartbeat>[\s\S]*?<\/heartbeat>\s*```/gi, '').replace(heartbeat, '').trim();
      if (!visible) visible = /<message>\s*([\s\S]*?)\s*<\/message>/i.exec(lastHeartbeat)?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim() ?? '';
    }
    const text = plainMarkdown(visible);
    if (text) return { id: item.id, turnId: turn.id, phase: item.phase, text: text.slice(0, maxText), ...(text.length > maxText ? { truncated: true, originalChars: text.length } : {}) };
  }
  return null;
}
function latestMarker(turn: ExtraTurn | null): ToolMarker | null {
  if (!turn) return null;
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const item = turn.items[i]!;
    if (['commandExecution', 'fileChange', 'imageGeneration'].includes(item.type)) return { id: item.id, turnId: turn.id, type: item.type, name: item.type, status: item.status };
    if (['collabAgentToolCall', 'dynamicToolCall', 'mcpToolCall'].includes(item.type)) return { id: item.id, turnId: turn.id, type: item.type, name: item.tool, status: item.status };
    if (['sleep', 'webSearch'].includes(item.type)) return { id: item.id, turnId: turn.id, type: item.type, name: item.type, status: null };
  }
  return null;
}
function cursorRevision(cursor: string | undefined, generation: string): number | null {
  if (!cursor?.startsWith(`${generation}:`)) return null;
  const value = cursor.slice(generation.length + 1);
  if (!/^\d+$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}
function toPoll(state: PollState, cursor?: string): Poll {
  const previous = cursorRevision(cursor, state.generation);
  const reset = cursor != null && (previous == null || previous > state.revision);
  const changed = reset || previous !== state.revision;
  return { schemaVersion: 1, cursor: `${state.generation}:${state.revision}`, revision: state.revision, changed,
    ...(reset ? { cursorReset: true } : {}), ...state.projection,
    latestAssistantMessageId: state.projection.latestAssistantMessage?.id ?? null,
    latestAssistantMessage: changed ? state.projection.latestAssistantMessage : null,
    latestToolMarkerId: state.projection.latestToolMarker?.id ?? null,
    latestToolMarker: changed ? state.projection.latestToolMarker : null };
}
function wakeFor(poll: Poll): Wake | null {
  const status = poll.thread.status;
  if (status.type === 'systemError' || status.type === 'notLoaded') return { reason: 'inactiveStatus' };
  if (status.type === 'active' && status.activeFlags.length && poll.changed) return { reason: 'actionableStatus' };
  if (status.type !== 'idle') return null;
  if (!poll.latestTurn) return { reason: 'inactiveStatus' };
  if (poll.latestTurn.status !== 'inProgress' && poll.changed) return { reason: 'turnCompleted', turnId: poll.latestTurn.id };
  return null;
}
function isNewer(left: Projection['latestTurn'], right: Projection['latestTurn']): boolean {
  if (!left || !right || left.id === right.id) return false;
  if (left.startedAt != null && right.startedAt != null && left.startedAt !== right.startedAt) return left.startedAt > right.startedAt;
  const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid7.test(left.id) && uuid7.test(right.id) && left.id.toLowerCase() > right.id.toLowerCase();
}
class DeletedThreadError extends Error { constructor() { super('Task was deleted while waiting'); } }
function notFound(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const value = cause as Error & { code?: unknown; jsonRpcCode?: unknown };
  return value.code === 'thread_not_found' || value.jsonRpcCode === 'thread_not_found' || /^(?:thread not (?:found|loaded)|unknown thread):|^no rollout found for thread id |^invalid thread id:/i.test(value.message);
}

export class ThreadWaiter {
  private states = new Map<string, PollState>();
  private ordinal = 0;
  private hosts: NativeHosts;
  private formatter: typeof formatAssistantMessage;
  constructor(hosts: NativeHosts, formatter: typeof formatAssistantMessage) { this.hosts = hosts; this.formatter = formatter; }

  private async fromCurrent<T>(manager: NativeManager, threadId: string, signal: AbortSignal, read: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const local = new AbortController();
    const host = manager.getHostId();
    const unhost = this.hosts.subscribe(host, () => { if (!this.hosts.getManagers().includes(manager)) local.abort(new Error('Task host changed during passive read')); });
    const undelete = manager.addThreadDeletedListener(id => {
      if (id === threadId) { this.states.delete(JSON.stringify([host, threadId])); local.abort(new DeletedThreadError()); }
    }, error => local.abort(error));
    try {
      if (!this.hosts.getManagers().includes(manager)) throw new Error('Task host changed during passive read');
      return await abortable(read(), AbortSignal.any([signal, local.signal]));
    } finally { undelete(); unhost(); }
  }
  async resolveThreadHost(options: { preferredHostId?: string; threadId: string; signal: AbortSignal; requestOptions?: { timeoutMs?: number } }): Promise<{ hostId: string; manager: NativeManager }> {
    const { signal, threadId, preferredHostId } = options;
    signal.throwIfAborted();
    const managers = this.hosts.getManagers(preferredHostId);
    const preferred = managers.find(manager => manager.getHostId() === preferredHostId);
    const failed: string[] = preferredHostId && !preferred ? [preferredHostId] : [];
    if (preferred) {
      try {
        await this.fromCurrent(preferred, threadId, signal, () => preferred.readThread(threadId, { includeTurns: false, requestOptions: options.requestOptions }));
        return { hostId: preferred.getHostId(), manager: preferred };
      } catch (cause) { signal.throwIfAborted(); if (cause instanceof DeletedThreadError) throw cause; if (!notFound(cause)) failed.push(preferred.getHostId()); }
    }
    const other = await Promise.all(managers.filter(manager => manager !== preferred).map(async manager => {
      try {
        await this.fromCurrent(manager, threadId, signal, () => manager.readThread(threadId, { includeTurns: false, requestOptions: options.requestOptions }));
        return { hostId: manager.getHostId(), manager };
      } catch (cause) { if (!notFound(cause)) failed.push(manager.getHostId()); return null; }
    }));
    signal.throwIfAborted();
    const found = other.filter((value): value is { hostId: string; manager: NativeManager } => value !== null);
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw new Error(`Ambiguous Codex thread id ${threadId}; matching hosts: ${found.map(value => value.hostId).join(', ')}`);
    if (failed.length) throw new Error(`Could not determine whether Codex thread ${threadId} exists. Unavailable or failed hosts: ${failed.join(', ')}`);
    const searched = [...(preferredHostId ? [preferredHostId] : []), ...other.map((_, i) => managers.filter(manager => manager !== preferred)[i]!.getHostId())];
    throw new Error(`No Codex thread found for threadId: ${threadId}${searched.length ? `. Hosts without a readable match: ${searched.join(', ')}` : ''}`);
  }
  private async pollResolved(manager: NativeManager, threadId: string, cursor: string | undefined, signal: AbortSignal, completed?: ExtraTurn): Promise<Poll> {
    const ordinal = ++this.ordinal, hostId = manager.getHostId(), key = JSON.stringify([hostId, threadId]);
    const [read, page] = await this.fromCurrent(manager, threadId, signal, () => Promise.all([
      manager.readThread(threadId, { includeTurns: false, requestOptions: readOptions }),
      manager.listThreadTurns(threadId, { itemsView: 'full', itemSnapshot: 'latest', limit: 1, requestOptions: readOptions }),
    ]));
    signal.throwIfAborted();
    if (!this.hosts.getManagers().includes(manager)) throw new Error('Task host changed during passive read');
    let turn = page.response.data[0] as ExtraTurn | undefined;
    if (completed && (!turn || (turn.id === completed.id && turn.status === 'inProgress') || isNewer(completed as Projection['latestTurn'], turn as Projection['latestTurn']))) {
      turn = completed.id === turn?.id && turn.itemsView === 'full' && completed.itemsView !== 'full' ? { ...completed, items: turn.items, itemsView: 'full' } : completed;
    }
    let prior = this.states.get(key);
    if (prior?.manager !== manager) prior = undefined;
    if (prior && prior.ordinal > ordinal) return toPoll(prior, cursor);
    const latestTurn = turn ? { id: turn.id, status: turn.status, error: turn.error ? { message: turn.error.message.slice(0, maxText) } : null,
      startedAt: turn.startedAt, completedAt: turn.completedAt, durationMs: turn.durationMs } : null;
    let projection: Projection = { thread: { id: read.thread.id, hostId, status: read.thread.status }, latestTurn,
      latestAssistantMessage: latestMessage(turn ?? null, this.formatter), latestToolMarker: latestMarker(turn ?? null) };
    if (completed && completed.itemsView !== 'full' && prior?.projection.latestTurn?.id === completed.id) {
      projection.latestAssistantMessage ??= prior.projection.latestAssistantMessage;
      projection.latestToolMarker ??= prior.projection.latestToolMarker;
    }
    if (prior?.projection.latestTurn && (!latestTurn || isNewer(prior.projection.latestTurn, latestTurn) ||
      (prior.projection.latestTurn.id === latestTurn.id && prior.projection.latestTurn.status !== 'inProgress' && latestTurn.status === 'inProgress'))) {
      projection = { ...prior.projection, thread: projection.thread };
    } else if (latestTurn?.status === 'inProgress' && prior?.projection.latestAssistantMessage && projection.latestAssistantMessage &&
      prior.projection.latestAssistantMessage.id === projection.latestAssistantMessage.id && prior.projection.latestAssistantMessage.text.length > projection.latestAssistantMessage.text.length) {
      projection.latestAssistantMessage = prior.projection.latestAssistantMessage;
    }
    const fingerprint = JSON.stringify({ status: projection.thread.status, turnId: projection.latestTurn?.id ?? null, turnStatus: projection.latestTurn?.status ?? null,
      turnError: projection.latestTurn?.error?.message ?? null, assistant: projection.latestAssistantMessage, tool: projection.latestToolMarker });
    const state: PollState = { manager, generation: prior?.generation ?? crypto.randomUUID(), revision: prior ? prior.revision + (prior.fingerprint === fingerprint ? 0 : 1) : 1, fingerprint, ordinal, projection };
    this.states.delete(key); this.states.set(key, state);
    if (this.states.size > 256) this.states.delete(this.states.keys().next().value!);
    return toPoll(state, cursor);
  }
  private async resolve(target: WaitTarget, signal: AbortSignal) {
    const preferred = this.hosts.getManagers().find(manager => manager.getHostId() === target.hostId);
    return preferred ? { hostId: preferred.getHostId(), manager: preferred } : this.resolveThreadHost({ preferredHostId: target.hostId, threadId: target.threadId, signal, requestOptions: readOptions });
  }
  private async waitOne(target: WaitTarget, timeoutMs: number, signal: AbortSignal): Promise<WaitResult> {
    const deadline = Date.now() + timeoutMs;
    let resolved = await this.resolve(target, signal);
    let manager = resolved.manager;
    const local = new AbortController();
    const combined = AbortSignal.any([signal, local.signal]);
    let completed: ExtraTurn | undefined, observedStatus: Status | undefined, eventWake: Wake | null = null;
    let notify!: () => void;
    let event = new Promise<void>(resolve => { notify = resolve; });
    let unhost = () => {}, unmessage = () => {}, undelete = () => {};
    const cleanup = () => { unhost(); unmessage(); undelete(); };
    const bind = () => {
      cleanup();
      unhost = this.hosts.subscribe(manager.getHostId(), () => {
        if (!this.hosts.getManagers().includes(manager)) notify();
      });
      undelete = manager.addThreadDeletedListener(id => {
        if (id === target.threadId) { this.states.delete(JSON.stringify([manager.getHostId(), id])); local.abort(new DeletedThreadError()); notify(); }
      }, error => { local.abort(error); notify(); });
      unmessage = manager.addNotificationCallback(['turn/completed', 'thread/status/changed'], message => {
        if (!isRecord(message.params) || message.params.threadId !== target.threadId) return;
        if (message.method === 'turn/completed' && isRecord(message.params.turn) && typeof message.params.turn.id === 'string') {
          completed = message.params.turn as unknown as ExtraTurn;
          eventWake = { reason: 'turnCompleted', turnId: completed.id }; notify();
        } else if (message.method === 'thread/status/changed' && isRecord(message.params.status)) {
          const status = message.params.status as Status;
          const oldStatus = observedStatus ?? this.states.get(JSON.stringify([manager.getHostId(), target.threadId]))?.projection.thread.status;
          observedStatus = status;
          if (status.type === 'active' && status.activeFlags.length && !isDeepStrictEqual(status, oldStatus)) { eventWake = { reason: 'actionableStatus' }; notify(); }
          else if (status.type === 'notLoaded' || status.type === 'systemError') { eventWake = { reason: 'inactiveStatus' }; notify(); }
          else if (status.type === 'idle') notify();
        }
      }, error => { local.abort(error); notify(); });
    };
    bind();
    try {
      let poll: Poll;
      try { poll = await this.pollResolved(manager, target.threadId, target.afterCursor, combined); }
      catch (cause) {
        combined.throwIfAborted();
        resolved = await this.resolveThreadHost({ preferredHostId: target.hostId, threadId: target.threadId, signal: combined, requestOptions: readOptions });
        manager = resolved.manager; bind();
        try { poll = await this.pollResolved(manager, target.threadId, target.afterCursor, combined); }
        catch { throw cause; }
      }
      if (eventWake) {
        try { poll = await this.pollResolved(manager, target.threadId, target.afterCursor, combined, completed); }
        catch (cause) { combined.throwIfAborted(); if (!this.states.get(JSON.stringify([manager.getHostId(), target.threadId]))) throw cause; }
      }
      let wake = eventWake ?? wakeFor(poll);
      if (wake) return { timedOut: false, wake, poll };
      if (!poll.changed && poll.thread.status.type === 'idle' && poll.latestTurn && poll.latestTurn.status !== 'inProgress') return { timedOut: false, wake: null, poll };
      while (Date.now() < deadline) {
        const delay = Math.min(5_000, Math.max(0, deadline - Date.now()));
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await abortable(Promise.race([event, new Promise<void>(resolve => { timer = setTimeout(resolve, delay); })]), combined); }
        finally { if (timer) clearTimeout(timer); }
        combined.throwIfAborted();
        if (!this.hosts.getManagers().includes(manager)) {
          const replacement = this.hosts.getManagers().find(value => value.getHostId() === manager.getHostId());
          if (!replacement) throw new Error('Task host changed during passive read');
          manager = replacement; completed = undefined; observedStatus = undefined; eventWake = null; bind();
        }
        event = new Promise<void>(resolve => { notify = resolve; });
        try { poll = await this.pollResolved(manager, target.threadId, target.afterCursor, combined, completed); }
        catch (cause) {
          combined.throwIfAborted();
          if (!eventWake) continue;
          const cached = this.states.get(JSON.stringify([manager.getHostId(), target.threadId]));
          if (!cached || cached.manager !== manager) throw cause;
          poll = toPoll(cached, target.afterCursor);
        }
        wake = eventWake ?? wakeFor(poll);
        if (wake) return { timedOut: false, wake, poll };
      }
      const state = this.states.get(JSON.stringify([manager.getHostId(), target.threadId]));
      return { timedOut: true, wake: null, poll: state ? { ...poll, latestAssistantMessage: state.projection.latestAssistantMessage, latestToolMarker: state.projection.latestToolMarker } : poll };
    } finally { cleanup(); }
  }
  async waitForThreads({ targets, timeoutMs, signal }: { targets: WaitTarget[]; timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
    signal?.throwIfAborted();
    if (!targets.length) return { timedOut: true, wake: null, polls: [] };
    const local = new AbortController(), combined = signal ? AbortSignal.any([signal, local.signal]) : local.signal;
    const results: ({ result: WaitResult } | { error: string } | undefined)[] = Array(targets.length);
    let remaining = targets.length, finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    targets.forEach((target, i) => {
      this.waitOne(target, timeoutMs, combined).then(result => {
        results[i] = { result }; remaining--; if (result.wake || !remaining) finish();
      }, cause => { results[i] = { error: (cause instanceof Error ? cause.message : String(cause)).slice(0, maxText) }; remaining--; if (!remaining) finish(); });
    });
    try {
      await abortable(done, signal);
      await Promise.resolve();
      signal?.throwIfAborted();
      const first = results.find(value => value && 'result' in value && value.result.wake);
      const polls = results.flatMap(value => value && 'result' in value ? [value.result.poll] : []);
      const errors = results.flatMap((value, i) => value && 'error' in value ? [{ threadId: targets[i]!.threadId, hostId: targets[i]!.hostId, message: value.error }] : []);
      if (first && 'result' in first && first.result.wake) return { timedOut: false, wake: { ...first.result.wake, threadId: first.result.poll.thread.id, hostId: first.result.poll.thread.hostId }, polls, ...(errors.length ? { errors } : {}) };
      return { timedOut: results.some(value => value && 'result' in value && value.result.timedOut), wake: null, polls, ...(errors.length ? { errors } : {}) };
    } finally { local.abort(); }
  }
}
