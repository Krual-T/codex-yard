import assert from 'node:assert/strict';
import test from 'node:test';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import type { SendInjectedInput, SendRecoverySnapshot } from '../src/renderer/app/send-recovery.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const owner = { hostId: 'fixture', threadId: 'thread', draftId: 'draft' };
const input: SendInjectedInput = { callId: 'original-call', input: [{ type: 'text', text: 'original ordered input', text_elements: [] }],
  responseItems: [{ type: 'function_call', name: 'untrusted_input', call_id: 'original-call', arguments: '{}' },
    { type: 'function_call_output', call_id: 'original-call', output: 'original app context' }] };
function fixture() {
  let state: unknown, rejectWrite = false, checks = 0;
  const storage = { read: async () => structuredClone(state), update: async (change: (value: unknown) => unknown) => {
    if (rejectWrite) { rejectWrite = false; throw Object.assign(new Error('fixture atom transaction aborted'), { uncertain: false }); }
    state = structuredClone(change(structuredClone(state))); return state;
  } };
  const client: WorkbenchClient = { rpc: async () => { throw new Error('Recovery cannot replay RPC'); },
    host: async <T>() => { checks++; return { turnId: null } as T; }, subscribe: () => () => {}, reply: async () => {} };
  const store = new SendRecoveryStore(client, storage);
  return { store, storage, checks: () => checks, rejectNextWrite: () => { rejectWrite = true; },
    prepare: (context = input) => store.prepare({ owner, revision: 'original' }, '/fixture',
      { text: 'original ordered input', images: [], files: [] }, {}, {}, undefined, undefined, { type: 'send' }, context),
    request: async (id: string) => (await store.read()).requests[id],
    reload: () => new SendRecoveryStore(client, storage),
    raw: () => state as SendRecoverySnapshot };
}

test('injection input is immutable and an unknown injection cannot be canceled, retried or turned into a send check', async () => {
  const h = fixture(), original = structuredClone(input), captured = structuredClone(input);
  const intent = await h.prepare(captured);
  captured.input[0]!.text = 'changed'; captured.responseItems[1]!.output = 'changed';
  assert.deepEqual((await h.request(intent.id)).injection, { ...original, phase: 'prepared' });
  await assert.rejects(h.store.sending(intent.id, intent.attemptId), /上下文尚未确认/);
  await h.store.injecting(intent.id, intent.attemptId);
  await h.store.injectionFailed(intent.id, new Error('lost original injection reply'), intent.attemptId);
  await h.store.failed(intent.id, Object.assign(new Error('later local error'), { uncertain: false }), intent.attemptId);
  const restored = h.reload();
  await assert.rejects(restored.attempt(intent.id), /尚未核对/);
  await assert.rejects(restored.cancel(intent.id), /尚未核对/);
  assert.equal((await restored.check(intent.id)).stage, 'unknown');
  assert.equal(h.checks(), 0, 'A turn-history miss cannot prove that context injection was not committed');
  assert.deepEqual((await restored.read()).requests[intent.id]!.injection, { ...original, phase: 'unknown' });
});

test('an explicit transport before-send failure restores injection preflight, while a generic local error does not', async () => {
  for (const known of [true, false]) {
    const h = fixture(), intent = await h.prepare();
    await h.store.injecting(intent.id, intent.attemptId);
    const error = Object.assign(new Error('fixture failure'), { uncertain: false, ...(known ? { sendPhase: 'before-send' } : {}) });
    await h.store.injectionFailed(intent.id, error, intent.attemptId);
    await h.store.failed(intent.id, error, intent.attemptId);
    assert.equal((await h.request(intent.id)).injection?.phase, known ? 'prepared' : 'unknown');
    if (known) {
      const retry = await h.store.attempt(intent.id);
      assert.notEqual(retry.attemptId, intent.attemptId);
      assert.deepEqual(retry.injection?.responseItems, input.responseItems);
      await h.store.cancel(intent.id);
      assert.equal((await h.store.read()).requests[intent.id], undefined);
    } else await assert.rejects(h.store.cancel(intent.id), /尚未核对/);
  }
});

test('a captured injection success can retry only local persistence and then continue without a second injection', async () => {
  const h = fixture(), intent = await h.prepare();
  await h.store.injecting(intent.id, intent.attemptId);
  h.rejectNextWrite();
  await assert.rejects(h.store.injected(intent.id, intent.attemptId), /transaction aborted/);
  assert.equal(h.store.hasConfirmedInjectionReceipt((await h.request(intent.id))), true);
  assert.equal(h.reload().hasConfirmedInjectionReceipt((await h.request(intent.id))), false);
  await h.store.failed(intent.id, Object.assign(new Error('receipt save failed'), { uncertain: false }), intent.attemptId);
  assert.equal((await h.request(intent.id)).stage, 'unknown');
  const confirmed = await h.store.check(intent.id);
  assert.equal(confirmed.injection?.phase, 'confirmed');
  assert.equal(h.store.hasConfirmedInjectionReceipt(confirmed), false);
  assert.equal(confirmed.stage, 'failed');
  assert.equal(h.checks(), 0);
  await assert.rejects(h.store.cancel(intent.id), /上下文注入结果尚未核对/);
  const retry = await h.store.attempt(intent.id);
  await assert.rejects(h.store.injecting(retry.id, retry.attemptId), /未重复注入/);
  await h.store.sending(retry.id, retry.attemptId);
  await h.store.confirmed(retry.id, 'actual-turn', retry.attemptId);
  assert.equal((await h.request(intent.id)).stage, 'confirmed');
});

test('late errors and receipts cannot change a newer attempt or permit queued injection', async () => {
  const h = fixture(), intent = await h.prepare();
  await h.store.injecting(intent.id, intent.attemptId);
  await h.store.injectionFailed(intent.id, Object.assign(new Error('invalid RPC'), { uncertain: false, code: -32602 }), intent.attemptId);
  await h.store.failed(intent.id, Object.assign(new Error('invalid RPC'), { uncertain: false }), intent.attemptId);
  const retry = await h.store.attempt(intent.id);
  await assert.rejects(h.store.injected(intent.id, intent.attemptId), /另一页面处理/);
  await h.store.injectionFailed(intent.id, new Error('late old error'), intent.attemptId);
  assert.equal((await h.request(intent.id)).attemptId, retry.attemptId);
  assert.equal((await h.request(intent.id)).injection?.phase, 'prepared');
  await assert.rejects(h.store.prepare({ owner: { ...owner, draftId: 'queued' }, revision: 'queued' }, '/fixture',
    { text: 'queue', images: [], files: [] }, {}, {}, undefined, undefined, { type: 'queue' }, input), /不能排队/);
  assert.equal(Object.keys(h.raw().requests).length, 1);
});
