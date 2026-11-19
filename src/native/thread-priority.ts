import type { ThreadReadState } from '../../lib/codex-protocol.ts';

export interface PriorityThread {
  id: string;
  status?: { type: string };
  recencyAt?: number | null;
  updatedAt?: number;
  createdAt?: number;
}

export function threadPriority(thread: PriorityThread | undefined, receipt?: ThreadReadState) {
  if (thread?.status?.type === 'active') return 1;
  return receipt?.firstUnread != null ? 0 : 2;
}

export function threadRecency(thread: PriorityThread) {
  return thread.recencyAt ?? thread.updatedAt ?? thread.createdAt ?? 0;
}

export function comparePriorityThreads(a: PriorityThread, b: PriorityThread, receipts: Record<string, ThreadReadState>) {
  return threadPriority(a, receipts[a.id]) - threadPriority(b, receipts[b.id]) ||
    threadRecency(b) - threadRecency(a);
}
