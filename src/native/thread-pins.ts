import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

/** UI and native conversation tools share the same durable Yard pin list. */
export function createThreadPins(globals: ObjectValue, persist: () => Promise<void>, broadcast: (message: unknown) => void) {
  const key = 'pinned-thread-ids';
  function ids() {
    const value = globals[key];
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
  }
  async function save(threadIds: string[]) {
    const before = globals[key];
    globals[key] = threadIds;
    try { await persist(); }
    catch (error) {
      if (globals[key] === threadIds) {
        if (before === undefined) delete globals[key]; else globals[key] = before;
      }
      throw error;
    }
    broadcast({ type: 'pinned-threads-updated' });
    return { success: true };
  }
  return {
    list() { return { threadIds: ids() }; },
    async set(value: unknown) {
      const { threadId, pinned, beforeThreadId } = record(value);
      if (typeof threadId !== 'string' || !threadId || typeof pinned !== 'boolean' ||
          beforeThreadId != null && (typeof beforeThreadId !== 'string' || !beforeThreadId)) throw new Error('无效的对话固定参数');
      const current = ids();
      if (pinned && beforeThreadId === threadId && current.includes(threadId)) return { success: true };
      const next = current.filter(id => id !== threadId);
      if (pinned) {
        const at = typeof beforeThreadId === 'string' ? next.indexOf(beforeThreadId) : beforeThreadId === null ? next.length : 0;
        next.splice(at < 0 ? next.length : at, 0, threadId);
      }
      return save(next);
    },
    async setOrder(value: unknown) {
      const { threadIds, movedThreadId } = record(value);
      if (!Array.isArray(threadIds) || threadIds.some(id => typeof id !== 'string' || !id) || new Set(threadIds).size !== threadIds.length) {
        throw new Error('无效的固定对话顺序');
      }
      const current = ids();
      if (movedThreadId != null && !current.includes(String(movedThreadId))) return { success: false };
      return save([...threadIds.filter((id): id is string => current.includes(id)), ...current.filter(id => !threadIds.includes(id))]);
    },
  };
}
