import type { ReadThreadArgs } from '../../lib/host-tools.ts';
import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

interface HistoryConnection { request(method: string, params: ObjectValue): Promise<unknown> }
type Cursor = { v: 1; threadId: string; cursor: string } & ({ kind: 'turns' } | { kind: 'items'; turnId: string });
const outputFields = new Set(['aggregatedOutput', 'output', 'result', 'contentItems', 'structuredContent']);
function encode(value: Cursor): string { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function decode(value: string | undefined, threadId: string): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 16_384 || !/^[\w-]+$/.test(value)) throw new Error();
    const parsed = record(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (parsed.v !== 1 || parsed.threadId !== threadId || typeof parsed.cursor !== 'string' || !parsed.cursor
      || !['turns', 'items'].includes(String(parsed.kind)) || parsed.kind === 'items' && typeof parsed.turnId !== 'string') throw new Error();
    return parsed as unknown as Cursor;
  } catch { throw new Error('历史游标无效或不属于此会话，请从最新记录重新读取。'); }
}

function projectItem(value: unknown, args: ReadThreadArgs) {
  const item = { ...record(value) }, truncated: string[] = [];
  let remaining = args.maxOutputCharsPerItem ?? 4_000;
  const bounded = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      const text = value.slice(0, remaining); remaining -= text.length;
      if (text.length !== value.length) truncated.push(path);
      return text;
    }
    if (Array.isArray(value)) return value.map((entry, index) => bounded(entry, path + '.' + index));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, bounded(entry, path + '.' + key)]));
    return value;
  };
  for (const field of outputFields) if (Object.hasOwn(item, field)) {
    if (!args.includeOutputs) delete item[field]; else item[field] = bounded(item[field], field);
  }
  if (truncated.length) item.outputTruncatedFields = truncated;
  return item;
}

/** Stored history only. Cancellation stops waiting/issuing reads, never resumes a session. */
export async function readToolHistory(connection: HistoryConnection, args: ReadThreadArgs, { signal }: { signal?: AbortSignal } = {}) {
  const cursor = decode(args.cursor, args.threadId);
  async function request(method: string, params: ObjectValue): Promise<ObjectValue> {
    signal?.throwIfAborted();
    const response = connection.request(method, params);
    if (!signal) return record(await response);
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal!.reason ?? new DOMException('Cancelled', 'AbortError'));
      signal!.addEventListener('abort', abort, { once: true });
      if (signal!.aborted) abort();
    });
    try { return record(await Promise.race([response, cancelled])); }
    finally { signal.removeEventListener('abort', abort); }
  }
  const metadata = await request('thread/read', { threadId: args.threadId, includeTurns: false });
  async function itemsPage(turnId: string, itemCursor: string | null) {
    const page = await request('thread/items/list', { threadId: args.threadId, turnId, cursor: itemCursor, limit: 60, sortDirection: 'desc' });
    if (!Array.isArray(page.data)) throw new Error('会话内容响应无效');
    return { items: page.data.map(entry => projectItem(record(entry).item, args)).reverse(),
      nextCursor: typeof page.nextCursor === 'string' && page.nextCursor ? encode({ v: 1, threadId: args.threadId, kind: 'items', turnId, cursor: page.nextCursor }) : null };
  }
  if (cursor?.kind === 'items') {
    const page = await itemsPage(cursor.turnId, cursor.cursor);
    return { ...metadata, thread: { ...record(metadata.thread), turns: [] }, itemPage: { turnId: cursor.turnId, ...page }, nextCursor: page.nextCursor };
  }
  const page = await request('thread/turns/list', { threadId: args.threadId,
    cursor: cursor?.cursor ?? null, limit: args.turnLimit ?? 10, sortDirection: 'desc', itemsView: 'summary' });
  if (!Array.isArray(page.data)) throw new Error('会话历史响应无效');
  const turns = [];
  for (const entry of page.data) {
    const turn = record(entry);
    if (typeof turn.id !== 'string') throw new Error('会话轮次响应无效');
    const items = await itemsPage(turn.id, null);
    turns.push({ ...turn, items: items.items, itemsView: items.nextCursor ? 'summary' : 'full', itemsNextCursor: items.nextCursor });
  }
  return { ...metadata, thread: { ...record(metadata.thread), turns: turns.reverse() },
    nextCursor: typeof page.nextCursor === 'string' && page.nextCursor ? encode({ v: 1, threadId: args.threadId, kind: 'turns', cursor: page.nextCursor }) : null };
}
