import type { ThreadItemSummary, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchEvent } from '../workbench-contract.ts';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function upsert<T extends { id: string }>(list: readonly T[], value: T): T[] {
  return list.some(item => item.id === value.id) ? list.map(item => item.id === value.id ? value : item) : [...list, value];
}
export function isItemDelta(event: WorkbenchEvent) { return event.type === 'mcp-notification' && /^item\/.*(?:\/delta|Delta)$/.test(String(event.method)); }
export function mergeTurn(previous: TurnSummary | undefined, value: TurnSummary): TurnSummary {
  const incoming = value.items ?? [];
  // CLI turn/completed can contain only an itemsView:summary projection.
  // Only an explicitly full history page may remove omitted items.
  const items = value.itemsView === 'full' && value.status !== 'inProgress' ? incoming
    : incoming.reduce((items, item) => upsert(items, item), previous?.items ?? []);
  return { ...previous, ...value, items };
}

/** Apply only notifications for this thread; snapshots remain the CLI's authority. */
export function applyThreadEvent(thread: ThreadSummary, event: WorkbenchEvent): ThreadSummary {
  if (event.type !== 'mcp-notification') return thread;
  const params = object(event.params);
  if (params.threadId !== thread.id) return thread;
  const method = String(event.method);
  if (method === 'thread/name/updated') return { ...thread, name: String(params.threadName ?? params.name ?? '') };
  if (method === 'thread/status/changed') return { ...thread, status: params.status as ThreadSummary['status'] };
  if (method === 'thread/reverted') return { ...thread, turns: [], status: { type: 'idle' } };
  const turn = object(params.turn);
  if ((method === 'turn/started' || method === 'turn/completed') && typeof turn.id === 'string') {
    const previous = thread.turns?.find(item => item.id === turn.id);
    if (method === 'turn/started' && previous && previous.status !== 'inProgress') return thread;
    const next = mergeTurn(previous, turn as unknown as TurnSummary);
    const turns = upsert(thread.turns ?? [], next);
    return { ...thread, turns, ...(method === 'turn/completed' && !turns.some(item => item.status === 'inProgress') ? { status: { type: 'idle' as const } } : {}) };
  }
  const turnId = typeof params.turnId === 'string' ? params.turnId : null;
  if (!turnId) return thread;
  const turns = [...thread.turns ?? []];
  let target = turns.find(item => item.id === turnId) ?? { id: turnId, items: [], status: 'inProgress' as const };
  if (target.status !== 'inProgress' && (isItemDelta(event) || method === 'item/started')) return thread;
  if (method === 'item/started' || method === 'item/completed') {
    const item = object(params.item);
    if (typeof item.id !== 'string' || typeof item.type !== 'string') return thread;
    target = { ...target, items: upsert(target.items ?? [], { ...item,
      ...(method === 'item/completed' ? { streamComplete: true } : {}) } as ThreadItemSummary) };
  } else if (isItemDelta(event)) {
    if (typeof params.itemId !== 'string' || typeof params.delta !== 'string') return thread;
    const type = method.split('/')[1]!;
    const previous = target.items?.find(item => item.id === params.itemId) ?? { id: params.itemId, type, partialStart: true };
    const key = type === 'commandExecution' || type === 'fileChange' ? 'aggregatedOutput' : type === 'reasoning' ? method.includes('summary') ? 'summary' : 'content' : 'text';
    let value: string | string[];
    if (key === 'summary' || key === 'content') {
      const parts = Array.isArray(previous[key]) ? [...previous[key] as string[]] : [];
      const index = Number(params.summaryIndex ?? params.contentIndex ?? 0);
      parts[index] = String(parts[index] ?? '') + params.delta; value = parts;
    } else value = String(previous[key] ?? '') + params.delta;
    target = { ...target, items: upsert(target.items ?? [], { ...previous, [key]: value }) };
  } else if (method === 'turn/plan/updated') {
    target = { ...target, plan: params.plan, explanation: params.explanation } as TurnSummary;
  } else if (method === 'turn/diff/updated') {
    target = { ...target, diff: params.diff } as TurnSummary;
  } else return thread;
  return { ...thread, turns: upsert(turns, target) };
}

export function isThreadBusy(thread: ThreadSummary | null) {
  return thread?.status?.type === 'active' || thread?.turns?.some(turn => turn.status === 'inProgress') === true;
}
