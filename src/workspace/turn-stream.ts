import type { ThreadItemSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';
import { applyTurnItemEvent, isActivity } from './turn-item-events.ts';
import { isSourceItem, type SourceItemsByTurn } from './conversation-sources-model.ts';
import { placeRequestActivity } from './turn-request-activity.ts';
import { mcpAppUri } from './mcp-app-model.ts';
import { conversationScope, pendingMessages } from './pending-messages.ts';

export type WorkspaceTurn = TurnSummary & { diff?: string; retryMessage?: string };
const empty: readonly WorkspaceTurn[] = [];
function items(previous: readonly ThreadItemSummary[], incoming: readonly ThreadItemSummary[]) {
  const positions = new Map(incoming.map((item, index) => [item.id, index]));
  const merged: ThreadItemSummary[] = [];
  let cursor = 0;
  for (const item of previous) {
    const at = positions.get(item.id);
    if (at === undefined) merged.push(item);
    else if (at >= cursor) {
      // A summary contains the user messages but omits the activity between
      // them. Shared IDs anchor the intervening streamed items in place.
      merged.push(...incoming.slice(cursor, at + 1));
      cursor = at + 1;
    }
  }
  merged.push(...incoming.slice(cursor));
  return merged;
}

function retainedActivity(saved: TurnSummary, observed: readonly ThreadItemSummary[], inspectedTurnId?: string) {
  const anchors = new Set(saved.items.map(item => item.id));
  // A running app frame keeps its activity anchors until a full saved read.
  // Otherwise a summary would move it past the final answer and remount it.
  return saved.itemsView !== 'full' && (saved.status === 'interrupted' || saved.id === inspectedTurnId || observed.some(mcpAppUri))
    ? observed.filter(item => isActivity(item) || anchors.has(item.id)) : [];
}

/** Terminal history owns the prompt and final reply. Keep visible activity
 * while a stopped or inspected turn loads its full saved activity. */
export function mergeLiveTurns(history: readonly TurnSummary[] = empty, live: readonly WorkspaceTurn[],
  inspectedTurnId?: string): readonly WorkspaceTurn[] {
  if (!live.length) return history;
  const merged = new Map<string, WorkspaceTurn>(history.map(turn => [turn.id, turn]));
  for (const turn of live) {
    const saved = merged.get(turn.id);
    if (saved && saved.status !== 'inProgress') {
      const activity = retainedActivity(saved, turn.items, inspectedTurnId);
      if (activity.length || turn.diff !== undefined || turn.retryMessage !== undefined) {
        merged.set(turn.id, { ...saved,
          items: activity.length ? items(activity, saved.items) : saved.items,
          ...(turn.diff !== undefined ? { diff: turn.diff } : {}),
          ...(turn.retryMessage !== undefined ? { retryMessage: turn.retryMessage } : {}) });
      }
      continue;
    }
    merged.set(turn.id, saved ? { ...turn, items: items(saved.items, turn.items) } : turn);
  }
  return [...merged.values()];
}

export class TurnStream {
  readonly threadId: string;
  readonly hostId: string;
  private readonly turns = new Map<string, WorkspaceTurn & { historyOwned?: true }>();
  private inspectedTurnId?: string;
  private readonly finishedItems = new Map<string, Set<string>>();
  private activeHistoryAnchor?: { turnId: string; itemId?: string };
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly WorkspaceTurn[] = empty;
  private sourceItems: SourceItemsByTurn = new Map();
  private sourceSnapshot = this.sourceItems;
  private historyRevision = 0;
  private readonly activityReads = new Map<string, Promise<ThreadItemSummary[]>>();
  private frame: number | undefined;
  private listening = false;
  constructor(threadId: string, hostId = 'local') { this.threadId = threadId; this.hostId = hostId; }

  readonly read = () => this.snapshot;
  readonly readSources = () => this.sourceSnapshot;
  readonly readInspectedTurn = () => this.inspectedTurnId;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  connect() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('message', this.receive);
    if (this.turns.size || this.sourceSnapshot !== this.sourceItems) this.schedule();
  }

  disconnect() {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('message', this.receive);
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  inspectTool(turnId: string) {
    if (this.inspectedTurnId === turnId) return;
    if (this.inspectedTurnId !== undefined && this.turns.get(this.inspectedTurnId)?.status === 'completed') {
      this.dropHistoryActivity(this.inspectedTurnId);
    }
    this.inspectedTurnId = turnId;
    this.schedule();
  }

  private receive = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message.hostId !== this.hostId) return;
    if (message.type === 'mcp-request') {
      const request = record(message.request), { threadId, turnId } = record(request.params), { id } = request;
      if ((request.method === 'mcpServer/elicitation/request' || request.method === 'item/tool/requestUserInput') &&
          threadId === this.threadId && typeof turnId === 'string' &&
          (typeof id === 'string' || typeof id === 'number')) {
        const anchor = this.turns.get(turnId)?.items.at(-1)?.id ??
          (this.activeHistoryAnchor?.turnId === turnId ? this.activeHistoryAnchor.itemId : undefined);
        placeRequestActivity({ hostId: this.hostId, threadId, turnId, id }, anchor ?? null);
      }
      return;
    }
    if (message.type !== 'mcp-notification' || typeof message.method !== 'string') return;
    const params = record(message.params);
    if (params.threadId !== this.threadId) return;
    if (message.method === 'thread/reverted') {
      this.turns.clear();
      this.inspectedTurnId = undefined;
      this.finishedItems.clear();
      this.activeHistoryAnchor = undefined;
      this.sourceItems = new Map();
      this.historyRevision++;
      this.schedule();
      return;
    }
    if (message.method === 'turn/started' || message.method === 'turn/completed') {
      const turn = record(params.turn);
      if (typeof turn.id !== 'string') return;
      if (turn.status !== 'inProgress' && turn.status !== 'completed' && turn.status !== 'failed' && turn.status !== 'interrupted') return;
      this.patchTurn({ id: turn.id, status: turn.status,
        items: Array.isArray(turn.items) ? turn.items as ThreadItemSummary[] : [],
        ...(typeof turn.startedAt === 'number' ? { startedAt: turn.startedAt }
          : message.method === 'turn/started' ? { startedAt: this.turns.get(turn.id)?.startedAt ?? Date.now() / 1000 } : {}),
        ...(typeof turn.completedAt === 'number' ? { completedAt: turn.completedAt } : {}),
        ...(typeof turn.durationMs === 'number' ? { durationMs: turn.durationMs } : {}),
        ...(typeof turn.itemsView === 'string' ? { itemsView: turn.itemsView } : {}),
        ...(turn.error ? { error: turn.error as TurnSummary['error'] } : {}) });
      return;
    }
    if (typeof params.turnId !== 'string') return;
    const current = this.turns.get(params.turnId);
    if (message.method === 'turn/diff/updated' && typeof params.diff === 'string') {
      this.patchTurn({ id: params.turnId, status: current?.status ?? 'inProgress', items: [], diff: params.diff });
      return;
    }
    if (current && current.status !== 'inProgress') return;
    if (message.method === 'error' && params.willRetry === true) {
      const { message } = record(params.error);
      if (typeof message === 'string' && message) {
        this.patchTurn({ id: params.turnId, status: 'inProgress', items: [], retryMessage: message.replace(/^Reconnecting(?:\.{3}|…)/, 'Reconnecting') });
      }
      return;
    }
    if (!message.method.startsWith('item/')) return;
    const lifecycle = message.method === 'item/started' || message.method === 'item/completed';
    const itemId = lifecycle ? record(params.item).id : params.itemId;
    if (typeof itemId !== 'string') return;
    const finished = this.finishedItems.get(params.turnId);
    if (finished?.has(itemId) && message.method !== 'item/completed') return;
    const item = applyTurnItemEvent(message.method, params, current?.items.find(item => item.id === itemId));
    if (!item) return;
    if (message.method === 'item/completed') {
      const set = finished ?? new Set<string>();
      set.add(item.id);
      if (!finished) this.finishedItems.set(params.turnId, set);
    }
    this.patchTurn({ id: params.turnId, status: 'inProgress', items: [item] });
  };

  acknowledge(turn: TurnSummary) {
    const existing = this.turns.get(turn.id);
    if (existing) {
      // The RPC reply can arrive later than notifications, including the last
      // delta or the terminal status. Use it only to fill missing items.
      const combined = items(turn.items, existing.items);
      this.turns.set(turn.id, { ...existing, items: combined });
      this.rememberSources(turn.id, combined);
      this.schedule();
    } else this.patchTurn(turn);
  }

  persisted(turns: readonly TurnSummary[]) {
    let changed = false;
    const latest = turns.at(-1);
    this.activeHistoryAnchor = latest?.status === 'inProgress' ? { turnId: latest.id, itemId: latest.items.at(-1)?.id } : undefined;
    for (const turn of turns) if (turn.status !== 'inProgress') {
      const live = this.turns.get(turn.id);
      const activity = live ? retainedActivity(turn, live.items, this.inspectedTurnId) : [];
      if (live && (activity.length || live.diff !== undefined || live.retryMessage !== undefined)) {
        if (!live.historyOwned || live.items.length !== activity.length || live.status !== turn.status) {
          this.turns.set(turn.id, {
            id: turn.id, status: turn.status, items: activity, diff: live.diff, retryMessage: live.retryMessage, historyOwned: true,
          });
          changed = true;
        }
      } else changed = this.turns.delete(turn.id) || changed;
      this.finishedItems.delete(turn.id);
    }
    if (changed) this.schedule();
  }

  recover(turns: readonly TurnSummary[]) {
    this.persisted(turns);
    for (const turn of turns) {
      if (turn.status !== 'inProgress') continue;
      const previous = this.turns.get(turn.id);
      const known = new Map(previous?.items.map(item => [item.id, item]));
      const restored = turn.items.map(saved => {
        const observed = known.get(saved.id);
        if (!observed) return saved;
        if (this.finishedItems.get(turn.id)?.has(saved.id)) return observed;
        const next = { ...saved };
        // A read can finish after another delta. Preserve a longer streamed
        // prefix, while a complete snapshot repairs any gap from a disconnect.
        for (const key of ['text', 'aggregatedOutput', 'activityOutput']) {
          const text = observed[key], base = saved[key];
          if (typeof text === 'string' && typeof base === 'string' && text.startsWith(base)) next[key] = text;
        }
        const observedSummary = observed.summary;
        const savedSummary = saved.summary;
        if (Array.isArray(savedSummary) && Array.isArray(observedSummary)) next.summary = Array.from({
          length: Math.max(savedSummary.length, observedSummary.length),
        }, (_, index) => {
          const base = savedSummary[index];
          const text = observedSummary[index];
          return base === undefined || typeof text === 'string' && typeof base === 'string' && text.startsWith(base) ? text : base;
        });
        return next;
      });
      const savedIds = new Set(restored.map(item => item.id));
      this.patchTurn({ ...turn, items: [...restored, ...(previous?.items.filter(item => !savedIds.has(item.id)) ?? [])],
        startedAt: typeof turn.startedAt === 'number' ? turn.startedAt : previous?.startedAt }, true);
    }
  }

  private patchTurn(turn: WorkspaceTurn, replaceItems = false) {
    const previous = this.turns.get(turn.id);
    if (previous && previous.status !== 'inProgress' && turn.status === 'inProgress') return;
    this.turns.set(turn.id, previous ? { ...previous, ...turn, items: replaceItems ? turn.items : items(previous.items, turn.items) } : turn);
    this.rememberSources(turn.id, turn.items, turn.itemsView === 'full' && turn.status !== 'inProgress');
    this.schedule();
  }

  async readActivity(turnId: string, load: (threadId: string, turnId: string, hostId: string) => Promise<ThreadItemSummary[]>) {
    const pending = this.activityReads.get(turnId);
    if (pending) return pending;
    const revision = this.historyRevision;
    const read = load(this.threadId, turnId, this.hostId).then(activity => {
      if (revision !== this.historyRevision) throw new Error('The conversation changed while loading activity.');
      if (this.dropHistoryActivity(turnId)) this.schedule();
      this.rememberSources(turnId, activity, true);
      return activity;
    }).finally(() => { this.activityReads.delete(turnId); });
    this.activityReads.set(turnId, read);
    return read;
  }

  private dropHistoryActivity(turnId: string) {
    const settled = this.turns.get(turnId);
    if (!settled?.historyOwned || !settled.items.length) return false;
    if (settled.diff !== undefined || settled.retryMessage !== undefined) this.turns.set(turnId, { ...settled, items: [] });
    else this.turns.delete(turnId);
    return true;
  }

  private rememberSources(turnId: string, incoming: readonly ThreadItemSummary[], full = false) {
    const found = incoming.filter(isSourceItem);
    const previous = this.sourceItems.get(turnId) ?? [];
    if (!found.length && (!full || !previous.length)) return;
    const next = full ? found : items(previous, found);
    if (previous.length === next.length && previous.every((item, index) => item === next[index])) return;
    const sourceItems = new Map(this.sourceItems);
    if (next.length) sourceItems.set(turnId, next);
    else sourceItems.delete(turnId);
    this.sourceItems = sourceItems;
    this.schedule();
  }

  private schedule() {
    if (!this.listening || this.frame !== undefined) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.snapshot = [...this.turns.values()];
      this.sourceSnapshot = this.sourceItems;
      pendingMessages.confirm(conversationScope(this.threadId, this.hostId), this.snapshot);
      for (const listener of this.listeners) listener();
    });
  }
}
