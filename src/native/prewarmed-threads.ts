import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

interface Prewarm {
  thread: ObjectValue;
  visible: boolean;
  timer: ReturnType<typeof setTimeout>;
}
interface Options {
  publish(hostId: string, thread: ObjectValue): void;
  expire(hostId: string, threadId: string): Promise<void>;
  onError(error: unknown): void;
  ttlMs?: number;
}
interface PendingStarts {
  count: number;
  notifications: { thread: unknown; deliver(): void }[];
}

/** The pinned desktop host keeps prewarms private until turn/start. Track only
 * IDs returned through that channel; ordinary empty threads remain ordinary. */
export class PrewarmedThreads {
  private readonly threads = new Map<string, Prewarm>();
  private readonly pending = new Map<string, PendingStarts>();
  private readonly options: Options;
  constructor(options: Options) { this.options = options; }

  private key(hostId: string, threadId: string) { return hostId + '\0' + threadId; }

  async start<T>(hostId: string, create: () => Promise<T>): Promise<T> {
    const pending = this.pending.get(hostId) ?? { count: 0, notifications: [] };
    this.pending.set(hostId, pending); pending.count++;
    try {
      const result = await create();
      if (this.pending.get(hostId) === pending) this.track(hostId, record(result).thread);
      return result;
    } finally {
      pending.count--;
      if (pending.count === 0 && this.pending.get(hostId) === pending) {
        this.pending.delete(hostId);
        for (const { thread, deliver } of pending.notifications) if (!this.suppressStarted(hostId, thread)) deliver();
      }
    }
  }

  started(hostId: string, thread: unknown, deliver: () => void) {
    if (this.suppressStarted(hostId, thread)) return;
    const pending = this.pending.get(hostId);
    // CLI lifecycle notifications can precede the response that identifies the
    // prewarm, including on the host's other daemon connections.
    if (pending) pending.notifications.push({ thread, deliver });
    else deliver();
  }

  track(hostId: string, value: unknown) {
    const thread = record(value);
    if (typeof thread.id !== 'string') return;
    const threadId = thread.id, key = this.key(hostId, threadId);
    this.forget(hostId, threadId);
    const entry: Prewarm = { thread, visible: false, timer: setTimeout(() => {
      void (async () => {
        try { if (!entry.visible) await this.options.expire(hostId, threadId); }
        catch (error) { this.options.onError(error); }
        finally { if (this.threads.get(key) === entry) this.threads.delete(key); }
      })();
    }, this.options.ttlMs ?? 600_000) };
    entry.timer.unref();
    this.threads.set(key, entry);
  }

  isHidden(hostId: string, threadId: string) {
    return this.threads.get(this.key(hostId, threadId))?.visible === false;
  }

  suppressStarted(hostId: string, value: unknown) {
    const thread = record(value);
    const entry = typeof thread.id === 'string' ? this.threads.get(this.key(hostId, thread.id)) : undefined;
    if (!entry) return false;
    entry.thread = thread;
    return true;
  }

  filterList<T>(hostId: string, value: T): T {
    const response = record(value);
    if (!Array.isArray(response.data)) return value;
    return { ...response, data: response.data.filter(thread => {
      const id = record(thread).id;
      return typeof id !== 'string' || !this.isHidden(hostId, id);
    }) } as T;
  }

  publish(hostId: string, threadId: string) {
    const entry = this.threads.get(this.key(hostId, threadId));
    if (!entry || entry.visible) return;
    entry.visible = true;
    this.options.publish(hostId, entry.thread);
    // Keep the ID until expiry so another page's late original notification
    // cannot publish it twice. Expiry never deletes a published conversation.
  }

  forget(hostId: string, threadId: string) {
    const key = this.key(hostId, threadId), entry = this.threads.get(key);
    if (entry) clearTimeout(entry.timer);
    this.threads.delete(key);
  }

  close() {
    for (const entry of this.threads.values()) clearTimeout(entry.timer);
    this.threads.clear();
    this.pending.clear();
  }
}
