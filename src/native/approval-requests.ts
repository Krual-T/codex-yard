import { randomUUID } from 'node:crypto';

export type ApprovalRequestId = string | number;

export interface ApprovalRequestRef {
  readonly hostId: string;
  readonly id: ApprovalRequestId;
  readonly generation: string;
}

export interface ApprovalSource<Page extends object, Socket extends object> {
  readonly page: Page;
  readonly hostId: string;
  readonly socket: Socket;
}

const claimBrand: unique symbol = Symbol('approval-request-claim');
export interface ApprovalRequestClaim { readonly [claimBrand]: true }

export type ApprovalRegisterResult =
  | { status: 'registered'; ref: ApprovalRequestRef }
  | { status: 'rejected'; reason: 'invalid-request' | 'closed-page' | 'closed-socket' | 'source-mismatch' };

export type ApprovalClaimResult =
  | { status: 'claimed'; claim: ApprovalRequestClaim }
  | { status: 'unavailable'; reason: 'wrong-source' | 'missing' | 'ambiguous-id' | 'already-claimed' | 'already-dispatched' };

export type ApprovalDispatchResult =
  | { status: 'sent' }
  | { status: 'unknown'; error?: unknown }
  | { status: 'not-dispatched'; reason: 'invalid-claim' | 'closed-source' | 'resolved' | 'ambiguous-id' };

export type ApprovalResolveResult =
  | { status: 'resolved'; ref: ApprovalRequestRef }
  | { status: 'ambiguous' }
  | { status: 'unmatched' };

type Phase = 'ready' | 'claimed' | 'sending' | 'sent' | 'unknown' | 'resolved';
interface Entry {
  ref: ApprovalRequestRef;
  threadId: string | null;
  phase: Phase;
}
interface Slot {
  // Counts survive resolution, so a duplicate old notification cannot resolve a reused id.
  history: Map<string | null, number>;
  pending: Map<string, Entry>;
}
interface SocketState<Page extends object, Socket extends object> {
  page: Page;
  hostId: string;
  socket: Socket;
  closed: boolean;
  slots: Map<ApprovalRequestId, Slot>;
}
interface ClaimState<Page extends object, Socket extends object> {
  source: SocketState<Page, Socket>;
  slot: Slot;
  entry: Entry;
}

function validId(id: ApprovalRequestId): boolean {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

/** Tracks only requests received on their original page, host, and daemon socket. */
export class ApprovalRequestRegistry<Page extends object, Socket extends object> {
  private readonly prefix = randomUUID();
  private nextGeneration = 0;
  private readonly sockets = new WeakMap<Socket, SocketState<Page, Socket>>();
  private readonly pages = new Map<Page, Set<SocketState<Page, Socket>>>();
  private readonly closedPages = new WeakSet<Page>();
  private readonly claims = new WeakMap<ApprovalRequestClaim, ClaimState<Page, Socket>>();

  register(source: ApprovalSource<Page, Socket>, request: { id: ApprovalRequestId; threadId: string | null }): ApprovalRegisterResult {
    if (!source.hostId || !validId(request.id)
      || (request.threadId !== null && (typeof request.threadId !== 'string' || !request.threadId))) {
      return { status: 'rejected', reason: 'invalid-request' };
    }
    if (this.closedPages.has(source.page)) return { status: 'rejected', reason: 'closed-page' };
    let state = this.sockets.get(source.socket);
    if (state && (state.page !== source.page || state.hostId !== source.hostId)) {
      return { status: 'rejected', reason: 'source-mismatch' };
    }
    if (state?.closed) return { status: 'rejected', reason: 'closed-socket' };
    if (!state) {
      state = { ...source, closed: false, slots: new Map() };
      this.sockets.set(source.socket, state);
      const pageSockets = this.pages.get(source.page) ?? new Set();
      pageSockets.add(state);
      this.pages.set(source.page, pageSockets);
    }
    let slot = state.slots.get(request.id);
    if (!slot) {
      slot = { history: new Map(), pending: new Map() };
      state.slots.set(request.id, slot);
    }
    const ref = Object.freeze({ hostId: source.hostId, id: request.id, generation: `${this.prefix}:${++this.nextGeneration}` });
    slot.history.set(request.threadId, (slot.history.get(request.threadId) ?? 0) + 1);
    slot.pending.set(ref.generation, { ref, threadId: request.threadId, phase: 'ready' });
    return { status: 'registered', ref };
  }

  claim(source: ApprovalSource<Page, Socket>, ref: ApprovalRequestRef): ApprovalClaimResult {
    const state = this.source(source);
    if (!state || ref.hostId !== source.hostId) return { status: 'unavailable', reason: 'wrong-source' };
    const slot = state.slots.get(ref.id);
    const entry = slot?.pending.get(ref.generation);
    if (!slot || !entry) return { status: 'unavailable', reason: 'missing' };
    // A JSON-RPC response has no generation or thread, so it cannot target overlapping ids.
    if (slot.pending.size !== 1) return { status: 'unavailable', reason: 'ambiguous-id' };
    if (entry.phase === 'claimed') return { status: 'unavailable', reason: 'already-claimed' };
    if (entry.phase !== 'ready') return { status: 'unavailable', reason: 'already-dispatched' };
    entry.phase = 'claimed';
    const claim: ApprovalRequestClaim = Object.freeze({ [claimBrand]: true as const });
    this.claims.set(claim, { source: state, slot, entry });
    return { status: 'claimed', claim };
  }

  release(claim: ApprovalRequestClaim): boolean {
    const held = this.claims.get(claim);
    if (!held) return false;
    this.claims.delete(claim);
    if (held.source.closed || held.entry.phase !== 'claimed'
      || held.slot.pending.get(held.entry.ref.generation) !== held.entry) return false;
    held.entry.phase = 'ready';
    return true;
  }

  async dispatch(claim: ApprovalRequestClaim, write: (socket: Socket, id: ApprovalRequestId) => void | Promise<void>): Promise<ApprovalDispatchResult> {
    const held = this.claims.get(claim);
    if (!held) return { status: 'not-dispatched', reason: 'invalid-claim' };
    this.claims.delete(claim);
    if (held.source.closed) return { status: 'not-dispatched', reason: 'closed-source' };
    if (held.entry.phase !== 'claimed' || held.slot.pending.get(held.entry.ref.generation) !== held.entry) {
      return { status: 'not-dispatched', reason: 'resolved' };
    }
    if (held.slot.pending.size !== 1) {
      held.entry.phase = 'ready';
      return { status: 'not-dispatched', reason: 'ambiguous-id' };
    }
    // No event can interleave between marking the request and invoking the socket writer.
    held.entry.phase = 'sending';
    try {
      await write(held.source.socket, held.entry.ref.id);
      if (held.source.closed) return { status: 'unknown' };
      if (held.slot.pending.get(held.entry.ref.generation) === held.entry) held.entry.phase = 'sent';
      return { status: 'sent' };
    } catch (error) {
      if (held.slot.pending.get(held.entry.ref.generation) === held.entry) held.entry.phase = 'unknown';
      return { status: 'unknown', error };
    }
  }

  resolve(source: ApprovalSource<Page, Socket>, notification: { requestId: ApprovalRequestId; threadId: string | null }): ApprovalResolveResult {
    const state = this.source(source);
    const slot = state?.slots.get(notification.requestId);
    if (!slot) return { status: 'unmatched' };
    if (notification.threadId === null || typeof notification.threadId !== 'string' || !notification.threadId
      || slot.history.has(null) || (slot.history.get(notification.threadId) ?? 0) > 1) {
      return { status: 'ambiguous' };
    }
    if (!slot.history.has(notification.threadId)) return { status: 'unmatched' };
    const entry = [...slot.pending.values()].find(item => item.threadId === notification.threadId);
    if (!entry) return { status: 'unmatched' };
    slot.pending.delete(entry.ref.generation);
    entry.phase = 'resolved';
    return { status: 'resolved', ref: entry.ref };
  }

  disconnect(source: ApprovalSource<Page, Socket>): boolean {
    let state = this.sockets.get(source.socket);
    if (!state && source.hostId) {
      // Record closes that arrive before the first request on this socket.
      state = { ...source, closed: true, slots: new Map() };
      this.sockets.set(source.socket, state);
      return true;
    }
    state = this.source(source);
    if (!state) return false;
    state.closed = true;
    state.slots.clear();
    const pageSockets = this.pages.get(source.page);
    pageSockets?.delete(state);
    if (pageSockets?.size === 0) this.pages.delete(source.page);
    return true;
  }

  closePage(page: Page): void {
    this.closedPages.add(page);
    for (const state of this.pages.get(page) ?? []) {
      state.closed = true;
      state.slots.clear();
    }
    this.pages.delete(page);
  }

  private source(source: ApprovalSource<Page, Socket>): SocketState<Page, Socket> | undefined {
    const state = this.sockets.get(source.socket);
    return state && !state.closed && state.page === source.page && state.hostId === source.hostId ? state : undefined;
  }
}
