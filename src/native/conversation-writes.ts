/** Serializes Yard's destructive history and submission requests across pages. */
export function createConversationWrites() {
  const pending = new Map<string, Promise<void>>();
  return function write<T>(hostId: string, threadId: string, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([hostId, threadId]);
    const result = (pending.get(key) ?? Promise.resolve()).then(operation);
    const settled = result.then(() => {}, () => {});
    pending.set(key, settled);
    void settled.then(() => { if (pending.get(key) === settled) pending.delete(key); });
    return result;
  };
}
