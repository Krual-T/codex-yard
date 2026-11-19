import type { ThreadReadState } from '../../lib/codex-protocol.ts';
import { record } from './protocol.ts';
import type { HostMessage, ObjectValue } from './protocol.ts';
import { threadPriority } from './thread-priority.ts';
import type { PriorityThread } from './thread-priority.ts';

type Change = { threadId: string; hasUnreadTurn: boolean } | { unreadThreadIds: Set<string> };
interface Row { state?: ThreadReadState; thread?: PriorityThread; generation: number; threadGeneration: number }
type Request = (hostId: string, params: ObjectValue) => Promise<unknown>;

/** A view cache of app-server receipts. No localStorage or secondary durable
 * read markers: the backend owns turn activity, read marks and revisions. */
export class BrowserThreadReadState {
  private readonly hosts = new Map<string, Map<string, Row>>();
  private readonly ready = new Set<string>();
  private readonly announced = new Set<string>();
  private readonly listeners = new Map<string, Set<(change: Change) => void>>();
  private readonly snapshots = new Set<(value: Record<string, string[]>) => void>();
  private readonly started = new WeakMap<object, number>();
  private generation = 0;
  private value: Record<string, string[]> = {};
  readonly request: Request;

  constructor(request: Request) { this.request = request; }
  snapshot = () => this.value;
  subscribe = (listener: (value: Record<string, string[]>) => void) => {
    this.snapshots.add(listener); return () => { this.snapshots.delete(listener); };
  };
  begin(message: HostMessage) { this.started.set(message, this.generation); }

  observe(message: HostMessage, request?: HostMessage) {
    const hostId = String(message.hostId ?? 'local');
    if (message.type === 'mcp-response' && request?.request &&
        ['thread/list', 'thread/read', 'thread/resume', 'thread/start', 'thread/fork', 'thread/unarchive'].includes(request.request.method) &&
        !record(message.message).error) {
      this.receive(hostId, record(record(message.message).result), this.started.get(request) ?? this.generation);
    }
    if (message.type !== 'mcp-notification') return;
    const params = record(message.params);
    if (message.method === 'thread/readState/changed' && typeof params.threadId === 'string') {
      if (this.receipt(hostId, params.threadId, params.readState, ++this.generation)) this.publish(hostId, [params.threadId]);
    } else if (message.method === 'thread/status/changed' && typeof params.threadId === 'string') {
      const row = this.row(hostId, params.threadId);
      row.thread = { ...row.thread, id: params.threadId, status: record(params.status) as { type: string } };
      row.threadGeneration = ++this.generation;
      this.publish(hostId, []);
    } else if (message.method === 'thread/deleted' && typeof params.threadId === 'string') {
      this.hosts.get(hostId)?.delete(params.threadId); this.publish(hostId, [params.threadId]);
    }
  }

  receive(hostId: string, result: ObjectValue, generation = this.generation) {
    const wasReady = this.ready.has(hostId);
    const threads = Array.isArray(result.data) ? result.data : result.thread ? [result.thread] : [];
    for (const value of threads) {
      const thread = record(value);
      if (typeof thread.id === 'string') {
        const row = this.row(hostId, thread.id);
        if (row.threadGeneration <= generation) row.thread = thread as unknown as PriorityThread;
      }
    }
    const changed: string[] = [];
    if (result.readStates != null) {
      this.ready.add(hostId);
      for (const [id, state] of Object.entries(record(result.readStates))) if (this.receipt(hostId, id, state, generation)) changed.push(id);
    }
    const thread = record(result.thread);
    if (typeof thread.id === 'string' && result.readState != null && this.receipt(hostId, thread.id, result.readState, generation)) changed.push(thread.id);
    if (changed.length || (!wasReady && this.ready.has(hostId))) this.publish(hostId, changed);
  }

  priority = (key: string | undefined) => {
    // Sidebar queries use local:<UUID>; section items add codex:thread:.
    // SSH threads share that key format and have a separate execution host.
    const localKey = key?.replace(/^codex:thread:/, '');
    if (!localKey?.startsWith('local:')) return 2;
    for (const rows of this.hosts.values()) {
      const row = rows.get(localKey.slice('local:'.length));
      if (row) return threadPriority(row.thread, row.state);
    }
    return 2;
  };

  forHost(hostId: string, onError: (error: Error) => void) {
    return {
      isReady: () => this.ready.has(hostId),
      has: (id: string) => {
        const state = this.hosts.get(hostId)?.get(id)?.state;
        return state ? state.firstUnread != null : undefined;
      },
      // app-server records new activity. The renderer also clears a turn's
      // unread mark when it is viewed; those read acknowledgements must persist.
      set: (id: string, unread: boolean, origin?: string) => {
        if (origin === 'turn' && unread) return;
        void this.write(hostId, id, unread).catch(onError);
      },
      subscribe: (listener: (change: Change) => void) => {
        let listeners = this.listeners.get(hostId);
        if (!listeners) { listeners = new Set(); this.listeners.set(hostId, listeners); }
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
  }

  private row(hostId: string, id: string) {
    let rows = this.hosts.get(hostId);
    if (!rows) { rows = new Map(); this.hosts.set(hostId, rows); }
    let row = rows.get(id);
    if (!row) { row = { generation: -1, threadGeneration: -1 }; rows.set(id, row); }
    return row;
  }
  private receipt(hostId: string, id: string, value: unknown, generation: number) {
    const state = record(value);
    if (typeof state.revision !== 'string' || !('firstUnread' in state)) return false;
    const row = this.row(hostId, id);
    if (row.generation > generation) return false;
    const changed = row.state?.revision !== state.revision;
    row.state = state as unknown as ThreadReadState; row.generation = generation;
    this.ready.add(hostId);
    return changed;
  }
  private publish(hostId: string, ids: string[]) {
    const unread = [...this.hosts.get(hostId) ?? []].flatMap(([id, row]) => row.state?.firstUnread != null ? [id] : []);
    this.value = { ...this.value, [hostId]: unread };
    for (const listener of this.snapshots) listener(this.value);
    if (this.ready.has(hostId) && !this.announced.has(hostId)) {
      this.announced.add(hostId);
      for (const listener of this.listeners.get(hostId) ?? []) listener({ unreadThreadIds: new Set(unread) });
    }
    for (const id of ids) {
      const state = this.hosts.get(hostId)?.get(id)?.state;
      for (const listener of this.listeners.get(hostId) ?? []) listener({ threadId: id, hasUnreadTurn: state?.firstUnread != null });
    }
  }
  private async write(hostId: string, threadId: string, unread: boolean) {
    const state = this.hosts.get(hostId)?.get(threadId)?.state;
    if (!state) throw new Error('该后端尚未提供会话未读状态，请刷新后重试');
    if ((state.firstUnread != null) === unread) { this.publish(hostId, [threadId]); return; }
    const generation = this.generation;
    try {
      const result = record(await this.request(hostId, { threadId, unread, expectedRevision: state.revision }));
      if (this.receipt(hostId, threadId, result.readState, generation)) this.publish(hostId, [threadId]);
    } catch (error) {
      // Refresh confirmed state after a conflict or lost reply; never replay
      // a mark using a revision the caller has not seen.
      const refreshGeneration = this.generation;
      try { this.receive(hostId, record(await this.request(hostId, { threadId })), refreshGeneration); } catch {}
      this.publish(hostId, [threadId]);
      throw error;
    }
  }
}
