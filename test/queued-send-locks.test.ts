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

test('equal thread and message IDs on separate hosts retain independent leases and receipts', () => {
  const locks = createQueuedSendLocks();
  const local = { hostId: 'local', conversationId: 'same', messageId: 'same', lockId: 'one' };
  const remote = { ...local, hostId: 'ssh:fixture', lockId: 'two' };
  assert.equal(locks.acquire(local), true);
  assert.equal(locks.acquire(remote), true);
  locks.release({ ...local, sent: true });
  assert.equal(locks.acquire({ ...local, lockId: 'retry' }), false);
  locks.release({ ...remote, sent: false });
  assert.equal(locks.acquire({ ...remote, lockId: 'retry' }), true);
});
