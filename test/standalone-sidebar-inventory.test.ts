import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeThreadProjectMembershipSources } from '../src/native/thread-project-condition.ts';
import { readThreadProjectState } from '../src/native/thread-projects.ts';
import { createSidebarProjectInventory } from '../src/renderer/app/sidebar-project-inventory.ts';
import type { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';

function fixture() {
  const globals = { 'local-projects': {}, 'remote-projects': [] };
  const snapshot = { ...readThreadProjectState(globals, {}), catalog: { local: {}, remote: [] },
    inventory: { complete: true, errors: {} }, resolvedThreadHosts: { a: ['local'], b: ['local'] },
    membershipSources: observeThreadProjectMembershipSources(globals, [{ hostId: 'local', threadId: 'a' }, { hostId: 'local', threadId: 'b' }]) };
  let scope = { key: 'original', hostId: 'local', threadIds: ['a', 'b'] };
  let daemon = 'original';
  const calls: { params: Record<string, unknown>; resolve(value: typeof snapshot): void }[] = [];
  const received: unknown[] = [];
  const client: Pick<BrowserWorkbenchClient, 'host' | 'captureDaemonConnection'> = {
    captureDaemonConnection() {
      const captured = daemon;
      return { generation: captured, assertOriginal() { assert.equal(daemon, captured, 'original daemon changed'); } };
    },
    host<T>(_endpoint: string, params: Record<string, unknown> = {}, options?: { assertBeforeSend?: () => void }) {
      options?.assertBeforeSend?.();
      return new Promise<T>(resolve => { calls.push({ params, resolve: value => resolve(value as T) }); });
    },
  };
  return { calls, received, snapshot,
    resolve: createSidebarProjectInventory(client, () => scope, value => received.push(value)),
    changeScope() { scope = { ...scope, key: 'next' }; }, changeDaemon() { daemon = 'next'; } };
}

test('sidebar rows share one native requested-ID inventory and retain its original epoch proof', async () => {
  const f = fixture(), first = f.resolve('a'), second = f.resolve('b');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0]!.params.resolveThreadIds, ['a', 'b']);
  assert.equal(f.calls[0]!.params.daemonConnectionGeneration, 'original');
  f.calls[0]!.resolve(f.snapshot);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.complete, true); assert.deepEqual(a.hosts, ['local']); assert.deepEqual(b.hosts, ['local']);
  assert.equal(f.received.length, 1);
  f.changeScope();
  assert.throws(a.assertCurrent, /original sidebar inventory changed/);
});

test('late old-list or daemon results cannot publish or erase the next requested-ID inventory', async () => {
  const f = fixture(), old = f.resolve('a');
  const rejected = assert.rejects(old, /original sidebar inventory changed/);
  f.changeScope();
  const next = f.resolve('b');
  assert.equal(f.calls.length, 2);
  f.calls[0]!.resolve(f.snapshot); await rejected;
  assert.equal(f.received.length, 0);
  f.calls[1]!.resolve(f.snapshot);
  const proof = await next;
  assert.equal(f.received.length, 1);
  await f.resolve('a');
  assert.equal(f.calls.length, 2, 'the old rejection must not evict the next shared inventory');
  f.changeDaemon();
  assert.throws(proof.assertCurrent, /original daemon changed/);
});
