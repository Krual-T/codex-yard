interface SendLock { conversationId: string; messageId: string; lockId: string }

// Matches the desktop host's queue protocol: one send per conversation for
// two minutes, and a ten-minute receipt for messages already accepted.
export function createQueuedSendLocks(now = Date.now) {
  const active = new Map<string, { lockId: string; expiresAt: number }>();
  const sent = new Map<string, number>();
  const messageKey = (request: SendLock) => JSON.stringify([request.conversationId, request.messageId]);
  function prune(time: number) {
    for (const [key, lock] of active) if (lock.expiresAt <= time) active.delete(key);
    for (const [key, expiresAt] of sent) if (expiresAt <= time) sent.delete(key);
  }
  return {
    acquire(request: SendLock) {
      const time = now();
      prune(time);
      if (sent.has(messageKey(request)) || active.has(request.conversationId)) return false;
      active.set(request.conversationId, { lockId: request.lockId, expiresAt: time + 120_000 });
      return true;
    },
    release(request: SendLock & { sent: boolean }) {
      const time = now();
      prune(time);
      if (active.get(request.conversationId)?.lockId === request.lockId) active.delete(request.conversationId);
      if (request.sent) sent.set(messageKey(request), time + 600_000);
    },
  };
}
