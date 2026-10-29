import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SideChatController } from '../src/renderer/side-chat/controller.ts';
import type { SideChatHostPort, SideChatHostView, SideChatReadPurpose } from '../src/renderer/side-chat/types.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function eventually(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('expected asynchronous controller action');
}

function view(): SideChatHostView {
  return { operationId: 'operation', parent: { hostId: 'host', threadId: 'parent', cwd: '/workspace' },
    childId: null, child: null, fork: { status: 'waiting', error: null }, inject: { status: 'waiting', error: null },
    close: { requested: false, status: 'idle', error: null }, recoveryError: null };
}

function peer() {
  let token = 1, active = false, dispatches = 0, readBlocked = false;
  const calls: { page: string; purpose: SideChatReadPurpose | undefined }[] = [];
  const hints = new Set<(hint: { hostId: string; operationId: string }) => void>();
  const beforeClaim = deferred<void>(), continueClaim = deferred<void>(), afterClaim = deferred<void>(), finish = deferred<void>();
  const makePort = (page: string): SideChatHostPort => ({
    async prepare() { return view(); },
    async start() {
      const capturedToken = token;
      beforeClaim.resolve(); await continueClaim.promise;
      if (capturedToken !== token) throw Object.assign(Error('original claim fenced'), { uncertain: false });
      active = true; dispatches++; afterClaim.resolve(); await finish.promise; active = false;
      return view();
    },
    async read(_id, purpose) {
      calls.push({ page, purpose });
      const result = view();
      if (purpose === 'reconcile' && page === 'original' && !active && !readBlocked) {
        token++;
        result.settledCalls = { start: true };
      }
      return result;
    },
    async retry() { return view(); }, async close() { return view(); }, async retryPersistence() { return view(); },
    subscribe(listener) { hints.add(listener); return () => hints.delete(listener); },
  });
  const controller = (page: string, restored = false) => new SideChatController({ hostId: 'host', parentThreadId: 'parent',
    draftId: 'draft', port: makePort(page), onPrepared: async () => {}, canDispatch: () => page === 'original',
    ...(restored ? { restored: view() } : {}) });
  return { controller, beforeClaim, continueClaim, afterClaim, finish, calls,
    hint() { for (const fn of hints) fn({ hostId: 'host', operationId: 'operation' }); },
    get token() { return token; }, get dispatches() { return dispatches; },
    blockRead(value: boolean) { readBlocked = value; } };
}

test('both pages observe without rotating the pending original claim before or after dispatch', async () => {
  const p = peer(), a = p.controller('original'), b = p.controller('observer', true);
  const start = a.start(); await p.beforeClaim.promise;
  p.hint(); await eventually(() => p.calls.length === 2);
  assert.deepEqual(p.calls, [{ page: 'original', purpose: 'observe' }, { page: 'observer', purpose: 'observe' }]);
  assert.equal(p.token, 1);
  p.continueClaim.resolve(); await p.afterClaim.promise;
  p.hint(); await eventually(() => p.calls.length >= 4);
  await a.read();
  assert.equal(p.calls.at(-1)?.purpose, 'reconcile');
  assert.equal(p.token, 1); assert.equal(p.dispatches, 1);
  p.finish.resolve(); await start;
  assert.equal(p.dispatches, 1);
  a.dispose(); b.dispose();
});

test('explicit original reconciliation fences an unclaimed old request; another page cannot', async () => {
  const p = peer(), a = p.controller('original'), b = p.controller('observer', true);
  const start = a.start(); await p.beforeClaim.promise;
  await b.read(); assert.equal(p.token, 1);
  await a.read(); assert.equal(p.token, 2);
  p.continueClaim.resolve(); await start;
  assert.equal(p.dispatches, 0);
  assert.equal(a.getSnapshot().view?.fork.status, 'waiting');
  assert.equal(a.canRetry, true);
  a.dispose(); b.dispose();
});

test('automatic observation cannot use settled proof to clear a genuinely unknown call', async () => {
  const listeners = new Set<(hint: { hostId: string; operationId: string }) => void>();
  const purposes: (SideChatReadPurpose | undefined)[] = [];
  let settled = false, starts = 0;
  const port: SideChatHostPort = {
    async prepare() { return view(); }, async start() { starts++; throw Error('response lost'); },
    async read(_id, purpose) { purposes.push(purpose); return { ...view(), settledCalls: { start: purpose === 'observe' || settled } }; },
    async retry() { return view(); }, async close() { return view(); }, async retryPersistence() { return view(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const c = new SideChatController({ hostId: 'host', parentThreadId: 'parent', draftId: 'draft', port,
    onPrepared: async () => {}, canDispatch: () => true });
  await c.start();
  for (const notify of listeners) notify({ hostId: 'host', operationId: 'operation' });
  await eventually(() => purposes.length === 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.getSnapshot().view?.settledCalls, undefined);
  assert.match(c.getSnapshot().error!, /结果未确认/); assert.equal(c.canRetry, false);
  await c.read(); assert.match(c.getSnapshot().error!, /结果未确认/);
  settled = true; await c.read();
  assert.equal(c.getSnapshot().error, null); assert.equal(c.canRetry, true); assert.equal(starts, 1);
  c.dispose();
});

test('in-flight observation is stale and hints are coalesced until explicit reconciliation completes', async () => {
  const oldObservation = deferred<SideChatHostView>(), reconciliation = deferred<SideChatHostView>();
  const purposes: (SideChatReadPurpose | undefined)[] = [];
  let notify!: (hint: { hostId: string; operationId: string }) => void;
  const port: SideChatHostPort = {
    async prepare() { return view(); }, async start() { return view(); },
    async read(_id, purpose) {
      purposes.push(purpose);
      if (purposes.length === 1) return oldObservation.promise;
      if (purposes.length === 2) return reconciliation.promise;
      return { ...view(), fork: { status: 'not-sent', error: null } };
    },
    async retry() { return view(); }, async close() { return view(); }, async retryPersistence() { return view(); },
    subscribe(listener) { notify = listener; return () => {}; },
  };
  const c = new SideChatController({ hostId: 'host', parentThreadId: 'parent', draftId: 'draft', port,
    onPrepared: async () => {}, canDispatch: () => true, restored: view() });
  const hint = { hostId: 'host', operationId: 'operation' };
  notify(hint); const checking = c.read(); notify(hint); notify(hint);
  assert.deepEqual(purposes, ['observe', 'reconcile']);
  oldObservation.resolve({ ...view(), fork: { status: 'rejected', error: 'stale' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.getSnapshot().view?.fork.status, 'waiting');
  reconciliation.resolve({ ...view(), fork: { status: 'not-sent', error: null } });
  await checking; await eventually(() => purposes.length === 3);
  assert.deepEqual(purposes, ['observe', 'reconcile', 'observe']);
  assert.equal(c.getSnapshot().view?.fork.status, 'not-sent');
  c.dispose();
});
