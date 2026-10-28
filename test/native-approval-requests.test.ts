import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalRequestRegistry } from '../src/native/approval-requests.ts';
import type { ApprovalRequestClaim, ApprovalRequestRef, ApprovalSource } from '../src/native/approval-requests.ts';

interface Page { name: string }
interface Socket { name: string }
type Source = ApprovalSource<Page, Socket>;

function setup() {
  const registry = new ApprovalRequestRegistry<Page, Socket>();
  const source: Source = { page: { name: 'page-a' }, hostId: 'local', socket: { name: 'socket-a' } };
  return { registry, source };
}
function register(registry: ApprovalRequestRegistry<Page, Socket>, source: Source, id: string | number, threadId: string | null): ApprovalRequestRef {
  const result = registry.register(source, { id, threadId });
  assert.equal(result.status, 'registered');
  if (result.status !== 'registered') throw new Error('request registration failed');
  return result.ref;
}
function claim(registry: ApprovalRequestRegistry<Page, Socket>, source: Source, ref: ApprovalRequestRef): ApprovalRequestClaim {
  const result = registry.claim(source, ref);
  assert.equal(result.status, 'claimed');
  if (result.status !== 'claimed') throw new Error('request claim failed');
  return result.claim;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a request is synchronously claimed and written once on its original socket', async () => {
  const { registry, source } = setup();
  const ref = register(registry, source, 7, 'thread-a');
  const held = claim(registry, source, ref);
  assert.deepEqual(registry.claim(source, ref), { status: 'unavailable', reason: 'already-claimed' });
  const write = deferred(), writes: unknown[] = [];
  const result = registry.dispatch(held, (socket, id) => {
    writes.push({ socket, id });
    return write.promise;
  });
  assert.deepEqual(writes, [{ socket: source.socket, id: 7 }]);
  assert.equal(registry.release(held), false);
  assert.deepEqual(registry.claim(source, ref), { status: 'unavailable', reason: 'already-dispatched' });
  write.resolve();
  assert.deepEqual(await result, { status: 'sent' });
  assert.deepEqual(await registry.dispatch(held, () => { throw new Error('duplicate write'); }),
    { status: 'not-dispatched', reason: 'invalid-claim' });
  assert.deepEqual(registry.resolve(source, { requestId: 7, threadId: 'thread-a' }), { status: 'resolved', ref });
  assert.deepEqual(registry.claim(source, ref), { status: 'unavailable', reason: 'missing' });
});

test('release is limited to a definitely undispatched claim; failed writes remain unknown', async () => {
  const { registry, source } = setup();
  const ref = register(registry, source, 'one', 'thread-a');
  const beforeSend = claim(registry, source, ref);
  assert.equal(registry.release(beforeSend), true);
  assert.equal(registry.release(beforeSend), false);
  const attempted = claim(registry, source, ref);
  let writes = 0;
  const error = new Error('socket write failed');
  assert.deepEqual(await registry.dispatch(attempted, () => { writes++; throw error; }), { status: 'unknown', error });
  assert.equal(writes, 1);
  assert.equal(registry.release(attempted), false);
  assert.deepEqual(registry.claim(source, ref), { status: 'unavailable', reason: 'already-dispatched' });
});

test('a late resolved notification cannot delete a new generation with the same socket, id, and thread', async () => {
  const { registry, source } = setup();
  const first = register(registry, source, 1, 'thread-a');
  assert.deepEqual(registry.resolve(source, { requestId: 1, threadId: 'thread-a' }), { status: 'resolved', ref: first });
  const next = register(registry, source, 1, 'thread-a');
  assert.notEqual(first.generation, next.generation);
  assert.deepEqual(registry.resolve(source, { requestId: 1, threadId: 'thread-a' }), { status: 'ambiguous' });
  assert.deepEqual(registry.claim(source, first), { status: 'unavailable', reason: 'missing' });
  const nextClaim = claim(registry, source, next);
  assert.deepEqual(await registry.dispatch(nextClaim, () => {}), { status: 'sent' });
  assert.deepEqual(registry.resolve(source, { requestId: 1, threadId: 'thread-a' }), { status: 'ambiguous' });
  assert.deepEqual(registry.claim(source, next), { status: 'unavailable', reason: 'already-dispatched' });
});

test('a different uniquely observed thread identifies its own request without deleting the new one', () => {
  const { registry, source } = setup();
  const first = register(registry, source, 'id', 'thread-a');
  assert.deepEqual(registry.resolve(source, { requestId: 'id', threadId: 'thread-a' }), { status: 'resolved', ref: first });
  const next = register(registry, source, 'id', 'thread-b');
  assert.deepEqual(registry.resolve(source, { requestId: 'id', threadId: 'thread-a' }), { status: 'unmatched' });
  assert.deepEqual(registry.resolve(source, { requestId: 'id', threadId: 'thread-b' }), { status: 'resolved', ref: next });
});

test('overlapping reused ids cannot be dispatched until the other request is independently resolved', async () => {
  const { registry, source } = setup();
  const first = register(registry, source, 1, 'thread-a');
  const firstClaim = claim(registry, source, first);
  const next = register(registry, source, 1, 'thread-b');
  let writes = 0;
  assert.deepEqual(await registry.dispatch(firstClaim, () => { writes++; }),
    { status: 'not-dispatched', reason: 'ambiguous-id' });
  assert.deepEqual(registry.claim(source, next), { status: 'unavailable', reason: 'ambiguous-id' });
  assert.equal(writes, 0);
  assert.deepEqual(registry.resolve(source, { requestId: 1, threadId: 'thread-a' }), { status: 'resolved', ref: first });
  assert.deepEqual(await registry.dispatch(claim(registry, source, next), () => { writes++; }), { status: 'sent' });
  assert.equal(writes, 1);
});

test('an unresolved global request can be answered, but a thread notification cannot invent its origin', async () => {
  const { registry, source } = setup();
  const global = register(registry, source, 8, null);
  assert.deepEqual(registry.resolve(source, { requestId: 8, threadId: 'thread-a' }), { status: 'ambiguous' });
  assert.deepEqual(await registry.dispatch(claim(registry, source, global), () => {}), { status: 'sent' });
  const threaded = register(registry, source, 8, 'thread-a');
  assert.deepEqual(registry.resolve(source, { requestId: 8, threadId: 'thread-a' }), { status: 'ambiguous' });
  assert.deepEqual(registry.claim(source, threaded), { status: 'unavailable', reason: 'ambiguous-id' });
});

test('socket loss during a write stays unknown; late completion cannot affect the new socket', async () => {
  const { registry, source } = setup();
  const old = register(registry, source, 2, 'thread-a');
  const write = deferred();
  const attempt = registry.dispatch(claim(registry, source, old), () => write.promise);
  assert.equal(registry.disconnect(source), true);
  const newSource = { ...source, socket: { name: 'socket-b' } };
  const next = register(registry, newSource, 2, 'thread-a');
  assert.deepEqual(registry.resolve(source, { requestId: 2, threadId: 'thread-a' }), { status: 'unmatched' });
  assert.equal(registry.disconnect(source), false);
  write.resolve();
  assert.deepEqual(await attempt, { status: 'unknown' });
  assert.deepEqual(await registry.dispatch(claim(registry, newSource, next), () => {}), { status: 'sent' });
  assert.deepEqual(registry.register(source, { id: 3, threadId: 'thread-a' }), { status: 'rejected', reason: 'closed-socket' });
});

test('a late send acknowledgement after resolution cannot affect a reused id', async () => {
  const { registry, source } = setup();
  const first = register(registry, source, 2, 'thread-a');
  const write = deferred();
  const attempt = registry.dispatch(claim(registry, source, first), () => write.promise);
  assert.deepEqual(registry.resolve(source, { requestId: 2, threadId: 'thread-a' }), { status: 'resolved', ref: first });
  const next = register(registry, source, 2, 'thread-a');
  write.reject(new Error('late send failure'));
  assert.equal((await attempt).status, 'unknown');
  assert.deepEqual(registry.resolve(source, { requestId: 2, threadId: 'thread-a' }), { status: 'ambiguous' });
  assert.deepEqual(await registry.dispatch(claim(registry, source, next), () => {}), { status: 'sent' });
});

test('closing an unseen socket and one page cannot close another page or permit stale registration', () => {
  const { registry, source } = setup();
  const other = { page: { name: 'page-b' }, hostId: 'local', socket: { name: 'socket-b' } };
  const ref = register(registry, other, 1, 'thread-a');
  assert.equal(registry.disconnect(source), true);
  assert.deepEqual(registry.register(source, { id: 1, threadId: 'thread-a' }), { status: 'rejected', reason: 'closed-socket' });
  assert.deepEqual(registry.register({ ...source, page: other.page }, { id: 1, threadId: 'thread-a' }),
    { status: 'rejected', reason: 'source-mismatch' });
  registry.closePage(source.page);
  assert.equal(registry.claim(other, ref).status, 'claimed');
});

test('page, host, socket, id type, and generation remain separate identities', () => {
  const { registry, source } = setup();
  const numeric = register(registry, source, 1, 'thread-a');
  const textual = register(registry, source, '1', 'thread-a');
  const otherPage = { ...source, page: { name: 'page-b' } };
  const otherHost = { ...source, hostId: 'remote' };
  const otherSocket = { ...source, socket: { name: 'socket-b' } };
  assert.deepEqual(registry.register(otherPage, { id: 1, threadId: 'thread-a' }), { status: 'rejected', reason: 'source-mismatch' });
  assert.deepEqual(registry.register(otherHost, { id: 1, threadId: 'thread-a' }), { status: 'rejected', reason: 'source-mismatch' });
  assert.deepEqual(registry.claim(otherSocket, numeric), { status: 'unavailable', reason: 'wrong-source' });
  assert.deepEqual(registry.resolve(otherPage, { requestId: 1, threadId: 'thread-a' }), { status: 'unmatched' });
  assert.deepEqual(registry.resolve(source, { requestId: 1, threadId: 'thread-a' }), { status: 'resolved', ref: numeric });
  assert.equal(registry.claim(source, textual).status, 'claimed');
  registry.closePage(source.page);
  assert.deepEqual(registry.register(source, { id: 1, threadId: 'thread-a' }), { status: 'rejected', reason: 'closed-page' });
  assert.deepEqual(registry.register(otherSocket, { id: 2, threadId: 'thread-a' }), { status: 'rejected', reason: 'closed-page' });
});

test('a resolved or closed claim never writes even if the caller still holds its token', async () => {
  const { registry, source } = setup();
  const first = register(registry, source, 1, 'thread-a');
  const oldClaim = claim(registry, source, first);
  assert.deepEqual(registry.resolve(source, { requestId: 1, threadId: 'thread-a' }), { status: 'resolved', ref: first });
  const next = register(registry, source, 1, 'thread-a');
  assert.equal(registry.release(oldClaim), false);
  let writes = 0;
  assert.deepEqual(await registry.dispatch(oldClaim, () => { writes++; }), { status: 'not-dispatched', reason: 'invalid-claim' });
  const resolvedRef = register(registry, source, 2, 'thread-b');
  const resolvedClaim = claim(registry, source, resolvedRef);
  assert.deepEqual(registry.resolve(source, { requestId: 2, threadId: 'thread-b' }), { status: 'resolved', ref: resolvedRef });
  assert.deepEqual(await registry.dispatch(resolvedClaim, () => { writes++; }), { status: 'not-dispatched', reason: 'resolved' });
  const nextClaim = claim(registry, source, next);
  registry.closePage(source.page);
  assert.deepEqual(await registry.dispatch(nextClaim, () => { writes++; }), { status: 'not-dispatched', reason: 'closed-source' });
  assert.equal(writes, 0);
});
