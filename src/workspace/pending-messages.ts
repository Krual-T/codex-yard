import { useCallback, useSyncExternalStore } from 'react';
import type { ThreadItemSummary, TurnSummary } from '../../lib/codex-protocol.ts';

export type PendingMessage = {
  id: string; input: readonly unknown[]; turnId?: string; after?: string; startedAt: number;
};
const empty: readonly PendingMessage[] = [];
export const conversationScope = (threadId: string, hostId: string) => hostId === 'local' ? threadId : hostId + ':' + threadId;

/** The composer and transcript share a client message ID with the daemon.
 * Only a canonical receipt with that ID replaces a preparing message. */
export class PendingMessages {
  private readonly messages = new Map<string, readonly PendingMessage[]>();
  private readonly listeners = new Map<string, Set<() => void>>();
  read(scope: string) { return this.messages.get(scope) ?? empty; }
  subscribe(scope: string, listener: () => void) {
    let listeners = this.listeners.get(scope);
    if (!listeners) this.listeners.set(scope, listeners = new Set());
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(scope); };
  }
  private write(scope: string, messages: readonly PendingMessage[]) {
    if (messages.length) this.messages.set(scope, messages); else this.messages.delete(scope);
    for (const listener of this.listeners.get(scope) ?? []) listener();
  }
  add(scope: string, message: PendingMessage) { this.write(scope, [...this.read(scope), message]); }
  remove(scope: string, id: string) {
    const before = this.read(scope), after = before.filter(message => message.id !== id);
    if (before.length !== after.length) this.write(scope, after);
  }
  confirm(scope: string, turns: readonly TurnSummary[]) {
    const ids = new Set(turns.flatMap(turn => turn.items.flatMap(item =>
      item.type === 'userMessage' && typeof item.clientId === 'string' ? [item.clientId] : [])));
    const before = this.read(scope), after = before.filter(message => !ids.has(message.id));
    if (before.length !== after.length) this.write(scope, after);
  }
}
export const pendingMessages = new PendingMessages();
export function usePendingMessages(scope: string) {
  const subscribe = useCallback((listener: () => void) => pendingMessages.subscribe(scope, listener), [scope]);
  const read = useCallback(() => pendingMessages.read(scope), [scope]);
  return useSyncExternalStore(subscribe, read);
}

export function withPendingMessages<T extends TurnSummary>(turns: readonly T[], pending: readonly PendingMessage[]): readonly (T | TurnSummary)[] {
  if (!pending.length) return turns;
  const confirmed = new Set(turns.flatMap(turn => turn.items.flatMap(item =>
    item.type === 'userMessage' && typeof item.clientId === 'string' ? [item.clientId] : [])));
  const result: (T | TurnSummary)[] = [...turns];
  for (const message of pending) {
    if (confirmed.has(message.id)) continue;
    const item: ThreadItemSummary = { id: 'preparing:' + message.id, type: 'userMessage', clientId: message.id,
      content: message.input, preparing: true };
    const index = message.turnId === undefined ? -1 : result.findIndex(turn => turn.id === message.turnId);
    const turn = result[index];
    if (turn) {
      const items = [...turn.items];
      const anchor = message.after === undefined ? items.length - 1 : items.findIndex(item => item.id === message.after);
      items.splice(anchor < 0 ? items.length : anchor + 1, 0, item);
      result[index] = { ...turn, items };
    } else result.push({ id: 'preparing:' + message.id, status: 'inProgress', itemsView: 'full',
      items: [item], startedAt: message.startedAt });
  }
  return result;
}
