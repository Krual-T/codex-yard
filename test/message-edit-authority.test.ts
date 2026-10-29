import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage, StoredMessageEdit } from '../src/renderer/app/message-edit-recovery.ts';
import type { MessageEditRecovery } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const origin = { hostId: 'fixture-host', threadId: 'thread', turnId: 'turn', itemId: 'message' };
const version = { sessionId: 'session', revision: 0 };
const recovery: MessageEditRecovery = {
  origin, draft: { text: 'draft', input: [{ type: 'text', text: 'draft' }], images: [], files: [] },
  editor: { ...version, baseDraft: { text: 'original', images: [], files: [] }, edits: [], addedText: 'draft',
    sourceSignature: 'source', snapshot: { id: 'message', type: 'userMessage' }, turnIndex: 0, itemIndex: 0 },
};
const request = { origin, expectedTurnIds: ['turn'], clientUserMessageId: 'previous-client',
  turnParams: { input: [{ type: 'text', text: 'previous' }] }, operation: 'submit' as const };

function fixture(previous?: StoredMessageEdit['submission'], prepareHost?: () => Promise<void>) {
  let saved: unknown = { [JSON.stringify([origin.hostId, origin.threadId])]: { recovery, ...(previous ? { submission: previous } : {}) } };
  let gate: Promise<void> | undefined, release: (() => void) | undefined, entered: (() => void) | undefined;
  let failNext = false, calls = 0;
  const storage: EditRecoveryStorage = {
    read: () => structuredClone(saved),
    update: async change => {
      if (failNext) { failNext = false; throw new Error('fixture IDB failure'); }
      saved = structuredClone(change(structuredClone(saved)));
      if (gate) { const waiting = gate; gate = undefined; entered?.(); await waiting; }
      return saved;
    },
    changed() {},
  };
  const client: WorkbenchClient = {
    rpc: async () => { throw new Error('unexpected RPC'); }, subscribe: () => () => {}, reply: async () => {},
    host: async (_endpoint, _params, options) => {
      await prepareHost?.();
      try { options?.assertBeforeSend?.(); }
      catch (reason) { throw Object.assign(reason instanceof Error ? reason : new Error(String(reason)), { uncertain: false, sendPhase: 'before-send' }); }
      calls++; throw new Error('connection lost after dispatch');
    },
  };
  const store = new MessageEditRecoveryStore(client, storage), access = store.createAccess();
  return {
    store, access, calls: () => calls,
    holdNext() {
      gate = new Promise<void>(resolve => { release = resolve; });
      return new Promise<void>(resolve => { entered = resolve; });
    },
    release: () => { release?.(); },
    failNext: () => { failNext = true; },
    replaceOperation(operationId: string) {
      const records = saved as Record<string, StoredMessageEdit>;
      const current = records[JSON.stringify([origin.hostId, origin.threadId])]!;
      current.submission = { ...current.submission!, operationId };
    },
  };
}

test('authority revoked inside transport preparation restores the exact unsent phase', async () => {
  let prepared!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { prepared = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const previous = { request, stage: 'prepared' as const, operationId: 'previous-operation', editorVersion: version };
  const h = fixture(previous, async () => { prepared(); await waiting; });
  assert.equal(h.access.acquire(origin), true);
  const pending = h.store.submit(origin, ['turn'], {}, h.access.capture(origin));
  await entered;
  h.access.release(origin);
  assert.equal(h.access.acquire(origin), true);
  release();
  await assert.rejects(pending, /使用权已改变/);
  assert.equal(h.calls(), 0);
  assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.submission, previous);
});

for (const stage of [undefined, 'prepared', 'reverted', 'revertUnknown', 'startUnknown', 'conflict'] as const) {
  test(`dispatch refusal restores the exact previous ${stage ?? 'absent'} phase`, async () => {
    const previous = stage ? { request, stage, operationId: 'previous-operation', editorVersion: version } : undefined;
    const h = fixture(previous);
    assert.equal(h.access.acquire(origin), true);
    const guard = h.access.capture(origin), entered = h.holdNext();
    const pending = h.store.submit(origin, ['turn'], { input: recovery.draft.input }, guard);
    await entered;
    const pendingRecord = await h.store.read(origin.hostId, origin.threadId);
    assert.notEqual(pendingRecord?.submission?.operationId, previous?.operationId);
    h.access.release(origin);
    assert.equal(h.access.acquire(origin), true);
    h.release();
    await assert.rejects(pending, /使用权已改变/);
    assert.equal(h.calls(), 0);
    assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.submission, previous);
  });
}

test('failed rollback retains the pending operation and sends nothing', async () => {
  const h = fixture(), entered = h.holdNext();
  const pending = h.store.submit(origin, ['turn'], {}, () => { throw new Error('changed target'); });
  await entered;
  const operationId = (await h.store.read(origin.hostId, origin.threadId))?.submission?.operationId;
  h.failNext(); h.release();
  await assert.rejects(pending, /恢复阶段未能写回/);
  assert.equal(h.calls(), 0);
  const saved = await h.store.read(origin.hostId, origin.threadId);
  assert.equal(saved?.submission?.operationId, operationId);
  assert.equal(saved?.submission?.stage, 'revertUnknown');
});

test('rollback never replaces a different operation written during preparation', async () => {
  const h = fixture(), entered = h.holdNext();
  const pending = h.store.submit(origin, ['turn'], {}, () => { throw new Error('changed target'); });
  await entered;
  h.replaceOperation('different-operation');
  h.release();
  await assert.rejects(pending, /恢复阶段未能写回/);
  assert.equal(h.calls(), 0);
  assert.equal((await h.store.read(origin.hostId, origin.threadId))?.submission?.operationId, 'different-operation');
});

test('a connection loss after actual dispatch remains unknown', async () => {
  const h = fixture();
  assert.equal(h.access.acquire(origin), true);
  await assert.rejects(h.store.submit(origin, ['turn'], {}, h.access.capture(origin)), /connection lost after dispatch/);
  assert.equal(h.calls(), 1);
  assert.equal((await h.store.read(origin.hostId, origin.threadId))?.submission?.stage, 'revertUnknown');
});

test('an accidentally asynchronous dispatch assertion never permits a host request', async () => {
  const h = fixture();
  await assert.rejects(h.store.submit(origin, ['turn'], {}, async () => { throw new Error('late guard failure'); }), /必须同步完成/);
  assert.equal(h.calls(), 0);
  assert.equal((await h.store.read(origin.hostId, origin.threadId))?.submission, undefined);
});

test('authority is scoped to both host and thread and invalidates a previous capture', () => {
  const h = fixture(), other = h.store.createAccess();
  assert.equal(h.access.acquire(origin), true);
  const captured = h.access.capture(origin);
  assert.equal(other.acquire(origin), false);
  assert.equal(other.acquire({ hostId: 'other-host', threadId: origin.threadId }), true);
  assert.equal(other.acquire({ hostId: origin.hostId, threadId: 'other-thread' }), true);
  h.access.release(origin);
  assert.equal(other.acquire(origin), true);
  assert.throws(captured, /使用权已改变/);
});

test('a stale acquisition can neither accept its read nor release a later grant to the same view', async () => {
  const h = fixture();
  assert.equal(h.access.acquire(origin), true);
  const captured = h.access.capture(origin), oldRead = await h.access.read(origin);
  assert.equal(h.access.acquire(origin), true);
  assert.throws(() => oldRead.accept(), /使用权已改变/);
  h.access.release(origin, captured);
  assert.equal(h.access.owns(origin), true);
  h.access.capture(origin)();
});
