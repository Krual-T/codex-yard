import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueuedSendLocks } from '../src/native/queued-send-locks.ts';

test('send leases serialize a conversation, preserve late acceptance and expire abandoned sends', () => {
  let time = 0;
  const locks = createQueuedSendLocks(() => time);
  const a = { conversationId: 'thread', messageId: 'a', lockId: 'page-a' };
  const b = { conversationId: 'thread', messageId: 'b', lockId: 'page-b' };
  assert.equal(locks.acquire(a), true);
  assert.equal(locks.acquire(b), false);
  assert.equal(locks.acquire({ ...b, conversationId: 'other-thread' }), true);
  locks.release({ ...a, lockId: 'stale-page', sent: false });
  assert.equal(locks.acquire(b), false);
  time = 120_000;
  assert.equal(locks.acquire(b), true);
  locks.release({ ...a, sent: true }); // Late acknowledgement must not release b's lease.
  assert.equal(locks.acquire({ ...a, lockId: 'retry' }), false);
  locks.release({ ...b, sent: false });
  assert.equal(locks.acquire({ ...a, lockId: 'retry' }), false);
  time += 600_000;
  assert.equal(locks.acquire({ ...a, lockId: 'retry' }), true);
});
