import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import type { CodexConnection } from '../../lib/codex.ts';
import { record } from './protocol.ts';

export interface SideChatReceiptSource {
  page: WebSocket;
  hostId: string;
  connection: CodexConnection;
  socket: WebSocket;
  connectionGeneration: string;
  isCurrent(): boolean;
}

export interface SideChatParentReceipt {
  hostId: string;
  threadId: string;
  connectionGeneration: string;
  revision: string;
  response: unknown;
  eventCursor: number;
}

type ReceiptMethod = 'thread/start' | 'thread/fork' | 'thread/resume';
export interface SideChatReceiptAttempt {
  source: SideChatReceiptSource;
  method: ReceiptMethod;
  expectedThreadId: string | null;
  sequence: number;
  stale: boolean;
  active: boolean;
  invalidatedThreads: Set<string>;
}
interface StoredReceipt {
  source: SideChatReceiptSource;
  receipt: SideChatParentReceipt;
  sequence: number;
  stale: boolean;
}

/** Original per-page socket facts; these do not authorize a side-chat operation. */
export class SideChatParentReceipts {
  private sequence = 0;
  private readonly pages = new Map<WebSocket, Map<string, StoredReceipt>>();
  private readonly attempts = new Set<SideChatReceiptAttempt>();

  private key(hostId: string, threadId: string): string { return JSON.stringify([hostId, threadId]); }

  begin(source: SideChatReceiptSource, method: ReceiptMethod, expectedThreadId: string | null): SideChatReceiptAttempt {
    if (!source.isCurrent()) throw new Error('原会话连接已改变。');
    if (method === 'thread/resume' && expectedThreadId) {
      this.revokePageThread(source.page, source.hostId, expectedThreadId);
      for (const prior of this.attempts) {
        if (prior.source.page === source.page && prior.source.hostId === source.hostId && prior.expectedThreadId === expectedThreadId) prior.stale = true;
      }
    }
    const attempt = { source, method, expectedThreadId, sequence: ++this.sequence, stale: false, active: true,
      invalidatedThreads: new Set<string>() };
    this.attempts.add(attempt);
    return attempt;
  }

  cancel(attempt: SideChatReceiptAttempt): void { attempt.active = false; this.attempts.delete(attempt); }

  receive(attempt: SideChatReceiptAttempt, response: unknown, eventCursor: number): void {
    if (!attempt.active) return;
    this.cancel(attempt);
    const { source } = attempt, threadId = record(record(response).thread).id;
    if (!source.isCurrent() || typeof threadId !== 'string' || !threadId
      || attempt.method === 'thread/resume' && threadId !== attempt.expectedThreadId
      || !Number.isSafeInteger(eventCursor) || eventCursor < 0) return;
    let entries = this.pages.get(source.page);
    if (!entries) { entries = new Map(); this.pages.set(source.page, entries); }
    const key = this.key(source.hostId, threadId), previous = entries.get(key);
    if (previous && previous.sequence > attempt.sequence) return;
    entries.set(key, { source, sequence: attempt.sequence, stale: attempt.stale || attempt.invalidatedThreads.has(threadId), receipt: {
      hostId: source.hostId, threadId, connectionGeneration: source.connectionGeneration,
      revision: randomUUID(), response: structuredClone(response), eventCursor,
    } });
  }

  current(page: WebSocket, hostId: string, threadId: string): SideChatParentReceipt | null {
    const stored = this.pages.get(page)?.get(this.key(hostId, threadId));
    if (!stored || stored.stale || !stored.source.isCurrent()) return null;
    return structuredClone(stored.receipt);
  }

  assertCurrent(page: WebSocket, hostId: string, threadId: string, revision: string): SideChatParentReceipt {
    const receipt = this.current(page, hostId, threadId);
    if (!receipt || receipt.revision !== revision) throw new Error('原会话连接或设置已改变，请重新核对。');
    return receipt;
  }

  invalidate(hostId: string, threadId: string): void {
    const key = this.key(hostId, threadId);
    for (const entries of this.pages.values()) {
      const stored = entries.get(key);
      if (stored) stored.stale = true;
    }
    for (const attempt of this.attempts) {
      if (attempt.source.hostId !== hostId) continue;
      if (attempt.expectedThreadId === null) attempt.invalidatedThreads.add(threadId);
      else if (attempt.expectedThreadId === threadId) attempt.stale = true;
    }
  }

  invalidateHost(hostId: string): void {
    for (const entries of this.pages.values()) {
      for (const stored of entries.values()) if (stored.source.hostId === hostId) stored.stale = true;
    }
    for (const attempt of this.attempts) if (attempt.source.hostId === hostId) attempt.stale = true;
  }

  revokePageThread(page: WebSocket, hostId: string, threadId: string): void {
    this.pages.get(page)?.delete(this.key(hostId, threadId));
    for (const attempt of this.attempts) {
      if (attempt.source.page !== page || attempt.source.hostId !== hostId) continue;
      if (attempt.expectedThreadId === null) attempt.invalidatedThreads.add(threadId);
      else if (attempt.expectedThreadId === threadId) attempt.stale = true;
    }
  }

  forgetSocket(page: WebSocket, socket: WebSocket): void {
    const entries = this.pages.get(page);
    if (entries) {
      for (const [key, stored] of entries) if (stored.source.socket === socket) entries.delete(key);
      if (!entries.size) this.pages.delete(page);
    }
    for (const attempt of this.attempts) if (attempt.source.page === page && attempt.source.socket === socket) this.cancel(attempt);
  }

  forgetPage(page: WebSocket): void {
    this.pages.delete(page);
    for (const attempt of this.attempts) if (attempt.source.page === page) this.cancel(attempt);
  }
}
