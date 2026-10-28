import type { ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import type { WorkbenchEvent } from '../workbench-contract.ts';
import { applyThreadEvent, isItemDelta, mergeTurn } from './thread-state.ts';

interface Page<T> { data: T[]; nextCursor?: string | null }
export interface ThreadSnapshot {
  thread: ThreadSummary;
}
/** Read the current paginated protocol; a repeated cursor is a visible backend error. */
export async function loadThread(client: WorkbenchClient, hostId: string, threadId: string): Promise<ThreadSnapshot> {
  const initial = await client.rpc<{ thread: ThreadSummary }>('thread/read', { threadId, includeTurns: false }, hostId);
  let cursor: string | null = null;
  const seen = new Set<string>(), turns: TurnSummary[] = [];
  do {
    const page: Page<TurnSummary> = await client.rpc<Page<TurnSummary>>('thread/turns/list',
      { threadId, cursor, limit: 100, sortDirection: 'asc', itemsView: 'full' }, hostId);
    for (const turn of page.data) {
      const value = turn as TurnSummary & { itemsView?: string };
      if (value.itemsView !== 'full') {
        const items = [], itemCursors = new Set<string>(); let itemCursor: string | null = null;
        do {
          const itemPage: Page<{ item: NonNullable<TurnSummary['items']>[number] }> = await client.rpc('thread/items/list',
            { threadId, turnId: turn.id, cursor: itemCursor, limit: 100, sortDirection: 'asc' }, hostId);
          items.push(...itemPage.data.map(entry => entry.item)); itemCursor = itemPage.nextCursor ?? null;
          if (itemCursor && itemCursors.has(itemCursor)) throw new Error('会话内容分页游标重复，请重试。');
          if (itemCursor) itemCursors.add(itemCursor);
        } while (itemCursor);
        turns.push({ ...turn, items, itemsView: 'full' });
      } else turns.push(turn);
    }
    cursor = page.nextCursor ?? null;
    if (cursor && seen.has(cursor)) throw new Error('会话历史分页游标重复，请重试。');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { thread: { ...initial.thread, turns } };
}

export function eventItemKey(event: WorkbenchEvent): string | null {
  const params = event.params as { turnId?: string; itemId?: string; item?: { id?: string } } | undefined;
  const itemId = params?.itemId ?? params?.item?.id;
  return params?.turnId && itemId ? JSON.stringify([params.turnId, itemId]) : null;
}

/** Stored history omits running output. Preserve observed live items until a full completed page exists. */
export function reconcileThreadSnapshot(snapshot: ThreadSnapshot, previous: ThreadSummary | null,
  events: WorkbenchEvent[], observedItems: ReadonlySet<string>): ThreadSummary {
  const revertedAt = events.map(event => event.method).lastIndexOf('thread/reverted');
  if (revertedAt >= 0) {
    // A pre-revert read cannot describe the post-revert history. The caller
    // schedules a new read; only notifications following the boundary survive.
    return events.slice(revertedAt + 1).reduce(applyThreadEvent,
      { ...snapshot.thread, turns: [], status: { type: 'idle' } } as ThreadSummary);
  }
  let staleRunning = false;
  const turns = (snapshot.thread.turns ?? []).map(turn => {
    const old = previous?.turns?.find(value => value.id === turn.id);
    if (old && old.status !== 'inProgress' && turn.status === 'inProgress') {
      staleRunning = true;
      return mergeTurn(turn, { ...old, itemsView: 'summary' });
    }
    if (turn.status !== 'inProgress') return mergeTurn(old, turn);
    const live = (old?.items ?? []).filter(item => observedItems.has(JSON.stringify([turn.id, item.id]))
      || item.partialStart === true || item.streamComplete === true);
    const items = (turn.items ?? []).filter(item => !live.some(value => value.id === item.id)
      && !observedItems.has(JSON.stringify([turn.id, item.id])));
    return { ...turn, items: [...items, ...live] };
  });
  const newlyObserved = new Set(events.flatMap(event => {
    const params = event.params as { turnId?: string; turn?: { id?: string } } | undefined;
    const id = params?.turnId ?? params?.turn?.id;
    return typeof id === 'string' ? [id] : [];
  }));
  for (const old of previous?.turns ?? []) if (!turns.some(turn => turn.id === old.id) && newlyObserved.has(old.id)) turns.push(old);
  let thread: ThreadSummary = { ...snapshot.thread, turns,
    ...(staleRunning && previous ? { status: previous.status } : {}) };
  for (const event of events) {
    const params = event.params as { turnId?: string; itemId?: string; turn?: { id?: string } } | undefined;
    const target = thread.turns?.find(turn => turn.id === (params?.turnId ?? params?.turn?.id));
    if (event.method === 'thread/status/changed') continue;
    if (target && target.status !== 'inProgress' && (event.method === 'turn/started' || event.method === 'item/started' || isItemDelta(event))) continue;
    if (isItemDelta(event) && !observedItems.has(eventItemKey(event) ?? '')
      && target?.items?.some(item => item.id === params?.itemId && item.partialStart !== true)) continue;
    thread = applyThreadEvent(thread, event);
  }
  return thread;
}
