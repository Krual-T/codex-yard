import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import type { MessageEditChildDispatch } from '../src/renderer/app/message-edit-recovery.ts';
import type { MessageEditRecovery } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const origin = { hostId: 'synthetic-host', threadId: 'child', turnId: 'source', itemId: 'user' };
const recovery: MessageEditRecovery = {
  origin, draft: { text: 'edited', images: [], files: [], input: [{ type: 'text', text: 'edited' }] },
  editor: { sessionId: 'editor', revision: 2, baseDraft: { text: 'original', images: [], files: [] },
    edits: [], addedText: 'edited', sourceSignature: 'source', snapshot: { id: 'user', type: 'userMessage' }, turnIndex: 0, itemIndex: 0 },
};
const params = { input: recovery.draft.input };
function proof(challengeId = 'original-challenge'): MessageEditChildDispatch['proof'] {
  return { challengeId, identity: { hostId: origin.hostId, parentThreadId: 'parent', childThreadId: origin.threadId,
    draftId: 'draft', prepareId: 'prepare', operationId: 'operation', parentCwd: '/fixture', connectionGeneration: 'original-daemon' } };
}
async function fixture() {
  let saved: unknown, waitRead: Promise<void> | undefined, release!: () => void;
  let response = 'reverted';
  const calls: Record<string, unknown>[] = [];
  const client: WorkbenchClient = {
    async rpc() { throw new Error('unexpected RPC'); }, subscribe: () => () => {}, async reply() {},
    async host<T>(endpoint: string, value: Record<string, unknown> = {}, options?: { assertBeforeSend?: () => void }) {
      assert.equal(endpoint, 'message-edit'); options?.assertBeforeSend?.(); calls.push(structuredClone(value));
      if (response === 'lost') throw Object.assign(new Error('lost host reply'), { uncertain: true });
      return { stage: response, ...(response === 'started' ? { turn: { id: 'accepted', status: 'inProgress', items: [] } }
        : { error: 'start explicitly rejected' }) } as T;
    },
  };
  const store = new MessageEditRecoveryStore(client, {
    async read() { if (waitRead) { const gate = waitRead; waitRead = undefined; await gate; } return structuredClone(saved); },
    async update(change) { saved = structuredClone(change(structuredClone(saved))); return saved; }, changed() {},
  });
  await store.save(recovery, origin, { sessionId: 'editor', revision: 2 });
  return { store, calls, response(value: string) { response = value; }, pauseRead() {
    waitRead = new Promise<void>(resolve => { release = resolve; }); return () => release();
  } };
}

test('message editing captures the original child proof before reading and carries the new explicit retry proof', async () => {
  const h = await fixture(), captured = proof(), original = structuredClone(captured), release = h.pauseRead();
  const first = h.store.submit(origin, ['source'], params, () => {}, 'original-daemon', { proof: captured, assertCurrent() {} });
  (captured as { challengeId: string }).challengeId = 'replacement-challenge';
  (captured.identity as { hostId: string }).hostId = 'replacement-host';
  release(); await assert.rejects(first, /start explicitly rejected/);
  assert.deepEqual(h.calls[0]!.sideChat, original);
  assert.equal(h.calls[0]!.operation, 'submit');
  h.response('started');
  const retryProof = proof('explicit-retry-challenge');
  assert.equal((await h.store.submit(origin, [], params, () => {}, 'original-daemon', { proof: retryProof, assertCurrent() {} })).turn?.id, 'accepted');
  assert.equal(h.calls[1]!.operation, 'retry-start'); assert.deepEqual(h.calls[1]!.sideChat, retryProof);
  assert.equal(h.calls[1]!.clientUserMessageId, h.calls[0]!.clientUserMessageId);
});

test('revocation during the original recovery read rejects before host dispatch and restores the unsent editor', async () => {
  const h = await fixture(), release = h.pauseRead(); let current = true;
  const submitting = h.store.submit(origin, ['source'], params, () => {}, 'original-daemon', {
    proof: proof(), assertCurrent() { if (!current) throw new Error('original child revoked'); },
  });
  current = false; release(); await assert.rejects(submitting, /original child revoked/);
  assert.equal(h.calls.length, 0);
  const retained = await h.store.read(origin.hostId, origin.threadId);
  assert.deepEqual(retained?.recovery, recovery); assert.equal(retained?.submission, undefined);
});

test('read-only reconciliation of an issued edit does not acquire a new child proof', async () => {
  const h = await fixture(); h.response('lost');
  await assert.rejects(h.store.submit(origin, ['source'], params, () => {}, 'original-daemon', { proof: proof(), assertCurrent() {} }), /lost host reply/);
  h.response('started');
  assert.equal((await h.store.submit(origin, [], {}, () => {}, 'original-daemon', {
    proof: proof('revoked-challenge'), assertCurrent() { throw new Error('must not reacquire child permission for check'); },
  })).turn?.id, 'accepted');
  assert.equal(h.calls[1]!.operation, 'check'); assert.equal(Object.hasOwn(h.calls[1]!, 'sideChat'), false);
  assert.equal(h.calls[1]!.clientUserMessageId, h.calls[0]!.clientUserMessageId);
});
