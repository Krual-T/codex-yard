import type { ThreadSummary } from '../../lib/codex-protocol.ts';
import { supportsAttachedThreads } from '../../lib/codex-protocol.ts';
import { record } from './protocol.ts';
import type { HostMessage, ObjectValue } from './protocol.ts';

export interface SidechatBranch {
  children: readonly ThreadSummary[];
  parentId: string | null;
  loaded: boolean;
  loading: boolean;
  nextCursor: string | null;
  error: string | null;
}
interface Entry {
  value: SidechatBranch;
  listeners: Set<() => void>;
  pending?: Promise<void>;
  updates?: Map<string, ThreadSummary | null>;
  generation: number;
}
export type ListSidechats = (params: ObjectValue) => Promise<unknown>;
const key = (hostId: string, id: string) => JSON.stringify([hostId, id]);

/** A page-local projection. app-server owns attachment and conversation history.
 * Children are read only while their conversation's Summary is visible. */
export class BrowserSidechatThreads {
  private readonly entries = new Map<string, Entry>();
  private readonly parents = new Map<string, string>();
  private readonly supported = new Set<string>();

  supportsHost = (hostId: string) => this.supported.has(hostId);
  isAttached = (hostId: string, id: string) => this.parents.has(key(hostId, id));
  snapshot = (hostId: string, id: string) => this.entry(hostId, id).value;
  subscribe(hostId: string, id: string, listener: () => void) {
    const entry = this.entry(hostId, id);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }
  refresh(hostId?: string) {
    for (const [entryKey, entry] of this.entries) {
      if (hostId && JSON.parse(entryKey)[0] !== hostId) continue;
      entry.generation++;
      entry.pending = undefined;
      entry.updates = undefined;
      this.update(entry, { loaded: false, loading: false, nextCursor: null, error: null });
    }
  }

  load(hostId: string, id: string, list: ListSidechats, more = false): Promise<void> {
    const entry = this.entry(hostId, id);
    if (entry.pending) return entry.pending;
    if (!this.supportsHost(hostId) || more && !entry.value.nextCursor) return Promise.resolve();
    const generation = ++entry.generation;
    const updates = new Map<string, ThreadSummary | null>();
    entry.updates = updates;
    this.update(entry, { loading: true, error: null });
    const operation = Promise.resolve().then(async () => {
      try {
        const result = record(await list({ attachedToThreadId: id, limit: 50, sortKey: 'created_at', sortDirection: 'asc',
          ...(more ? { cursor: entry.value.nextCursor } : {}) }));
        if (entry.generation !== generation) return;
        const rows = new Map((more ? entry.value.children : []).map(child => [child.id, child]));
        for (const value of Array.isArray(result.data) ? result.data : []) {
          const child = record(value) as unknown as ThreadSummary;
          if (child.attachedToThreadId !== id || typeof child.id !== 'string' || child.ephemeral) continue;
          this.parents.set(key(hostId, child.id), id);
          rows.set(child.id, child);
        }
        // A start, rename or archive can arrive while the list is in flight.
        for (const [id, child] of updates) if (child) rows.set(id, child); else rows.delete(id);
        this.update(entry, { children: [...rows.values()], loaded: true,
          nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null });
      } catch (error) {
        if (entry.generation === generation) this.update(entry, { error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (entry.generation === generation) {
          entry.pending = undefined; entry.updates = undefined;
          this.update(entry, { loading: false });
        }
      }
    });
    entry.pending = operation;
    return operation;
  }

  observe(message: HostMessage, request?: HostMessage) {
    const hostId = message.hostId ?? 'local';
    if (message.type === 'codex-app-server-initialized') {
      if (supportsAttachedThreads(String(message.appServerVersion))) this.supported.add(hostId);
      else this.supported.delete(hostId);
      this.refresh(hostId);
    }
    if (message.type === 'mcp-response' && request?.request && !record(message.message).error) {
      const { method, params } = request.request, result = record(record(message.message).result);
      if (['thread/fork', 'thread/read', 'thread/resume', 'thread/unarchive'].includes(method)) {
        this.receive(hostId, result.thread);
      }
      if (method === 'thread/name/set' && typeof params?.threadId === 'string') this.rename(hostId, params.threadId, String(params.name ?? ''));
      if (method === 'thread/archive' || method === 'thread/delete') this.remove(hostId, String(params?.threadId));
    }
    if (message.type !== 'mcp-notification') return;
    const params = record(message.params);
    if (message.method === 'thread/started') this.receive(hostId, params.thread);
    if (message.method === 'thread/name/updated') this.rename(hostId, String(params.threadId), String(params.threadName ?? params.name ?? ''));
    if (message.method === 'thread/archived' || message.method === 'thread/deleted') this.remove(hostId, String(params.threadId));
    if (message.method === 'thread/status/changed' || message.method === 'thread/readState/changed') {
      const parent = this.parents.get(key(hostId, String(params.threadId)));
      const child = parent && this.entry(hostId, parent).value.children.find(child => child.id === params.threadId);
      if (child) this.receive(hostId, message.method === 'thread/status/changed' ? { ...child, status: params.status } : child);
    }
  }

  private entry(hostId: string, id: string) {
    const entryKey = key(hostId, id);
    let entry = this.entries.get(entryKey);
    if (!entry) {
      entry = { value: { children: [], parentId: this.parents.get(entryKey) ?? null, loaded: false, loading: false, nextCursor: null, error: null },
        listeners: new Set(), generation: 0 };
      this.entries.set(entryKey, entry);
    }
    return entry;
  }
  private update(entry: Entry, value: Partial<SidechatBranch>) {
    entry.value = { ...entry.value, ...value };
    for (const listener of entry.listeners) listener();
  }
  private receive(hostId: string, value: unknown) {
    const child = record(value) as unknown as ThreadSummary;
    if (typeof child.id !== 'string' || typeof child.attachedToThreadId !== 'string' || child.ephemeral) return;
    this.parents.set(key(hostId, child.id), child.attachedToThreadId);
    const ownEntry = this.entry(hostId, child.id);
    if (ownEntry.value.parentId !== child.attachedToThreadId) this.update(ownEntry, { parentId: child.attachedToThreadId });
    const entry = this.entry(hostId, child.attachedToThreadId);
    entry.updates?.set(child.id, child);
    const children = entry.value.children.some(row => row.id === child.id)
      ? entry.value.children.map(row => row.id === child.id ? child : row) : [...entry.value.children, child];
    this.update(entry, { children });
  }
  private rename(hostId: string, id: string, name: string) {
    const parent = this.parents.get(key(hostId, id));
    const child = parent && this.entry(hostId, parent).value.children.find(child => child.id === id);
    if (child) this.receive(hostId, { ...child, name });
  }
  private remove(hostId: string, id: string) {
    const parent = this.parents.get(key(hostId, id));
    if (!parent) {
      for (const [entryKey, entry] of this.entries) if (JSON.parse(entryKey)[0] === hostId) entry.updates?.set(id, null);
      return;
    }
    const entry = this.entry(hostId, parent);
    entry.updates?.set(id, null);
    this.update(entry, { children: entry.value.children.filter(child => child.id !== id) });
  }
}
