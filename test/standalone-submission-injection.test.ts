import assert from 'node:assert/strict';
import test from 'node:test';
import { captureDraftInjection, submitDraft } from '../src/renderer/app/submission.ts';
import type { SubmissionContext } from '../src/renderer/app/submission.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import type { SendIntent } from '../src/renderer/app/send-recovery.ts';
import type { ComposerDraft, WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { ThreadSummary } from '../lib/codex-protocol.ts';

const text = 'Respond to the user input in the context of our conversation.';
const draft: ComposerDraft = { text, images: [], files: [], input: [{ type: 'text', text, text_elements: [{
  byteRange: { start: 0, end: new TextEncoder().encode(text).length },
  placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1,
    message: { source: 'visualization', sourceId: 'original-widget', text: 'original follow-up', structuredContent: { value: 7 } } }),
}] }] };
const thread: ThreadSummary = { id: 'thread', name: null, cwd: '/fixture', status: { type: 'idle' }, turns: [] };
const owner = { hostId: 'fixture', threadId: thread.id, draftId: 'original-draft' };

async function fixture() {
  let state: unknown, authority = true, afterInjection: (() => void) | undefined, afterMarking: (() => void) | undefined;
  let injectionError: unknown, injectionResult: unknown = {}, rejectReceipt = false;
  const calls: { method: string; params: Record<string, unknown>; host: string | undefined }[] = [];
  const storage = { read: async () => structuredClone(state), update: async (change: (value: unknown) => unknown) => {
    if (rejectReceipt) { rejectReceipt = false; throw new Error('fixture receipt transaction aborted'); }
    state = structuredClone(change(structuredClone(state))); return state;
  } };
  const client: WorkbenchClient = {
    rpc: async <T>(method: string, params: Record<string, unknown> = {}, host?: string) => {
      calls.push({ method, params: structuredClone(params), host });
      if (method === 'thread/inject_items') {
        if (injectionError) throw injectionError;
        afterInjection?.();
        return injectionResult as T;
      }
      if (method === 'turn/start') return { turn: { id: 'actual-turn', items: [], status: 'inProgress' } } as T;
      throw new Error('Unexpected RPC: ' + method);
    }, host: async () => { throw new Error('No history query can prove injection absent'); },
    subscribe: () => () => {}, reply: async () => {},
  };
  const store = new SendRecoveryStore(client, storage);
  let intent: SendIntent = await store.prepare({ owner, revision: 'original-revision' }, '/fixture', draft, {}, {}, undefined, undefined,
    { type: 'send' }, captureDraftInjection(draft, owner.hostId));
  const context = (): SubmissionContext => ({ hostId: owner.hostId, threadId: owner.threadId, cwd: '/fixture',
    readOnly: false, activeTurnId: null, thread, injection: structuredClone(intent.injection),
    assertInjectionAuthority: target => {
      assert.equal(target, owner.threadId);
      if (!authority) throw Object.assign(new Error('original owner or idle authority changed'), { uncertain: false });
    },
    send: { clientUserMessageId: intent.clientUserMessageId,
      creating: async () => { throw new Error('Existing thread cannot be recreated'); }, created: async () => {},
      sending: () => store.sending(intent.id, intent.attemptId), confirmed: id => store.confirmed(intent.id, id, intent.attemptId),
      resolvedCollaboration: mode => store.resolvedCollaboration(intent.id, mode, intent.attemptId),
      injecting: async () => { await store.injecting(intent.id, intent.attemptId); afterMarking?.(); },
      injected: () => store.injected(intent.id, intent.attemptId),
      injectionFailed: error => store.injectionFailed(intent.id, error, intent.attemptId),
    } });
  const submit = async (overrides: Partial<SubmissionContext> = {}, value = draft) => {
    try { return await submitDraft(client, { ...context(), ...overrides }, value, {}, { type: 'send' }, async () => {}); }
    catch (error) { await store.failed(intent.id, error, intent.attemptId); throw error; }
  };
  return { calls, store, context, submit, get intent() { return intent; }, current: async () => (await store.read()).requests[intent.id]!,
    retry: async () => { intent = await store.attempt(intent.id); }, loseAuthority: () => { authority = false; },
    restoreAuthority: () => { authority = true; },
    afterInjection: (callback: () => void) => { afterInjection = callback; },
    afterMarking: (callback: () => void) => { afterMarking = callback; },
    failInjection: (error: unknown) => { injectionError = error; },
    reply: (value: unknown) => { injectionResult = value; }, rejectReceipt: () => { rejectReceipt = true; } };
}

test('actual submission injects the captured pair before the turn and preserves its original input and IDs', async () => {
  const h = await fixture(), original = structuredClone(h.intent);
  await h.submit();
  assert.deepEqual(h.calls.map(value => value.method), ['thread/inject_items', 'turn/start']);
  assert.ok(h.calls.every(value => value.host === owner.hostId && value.params.threadId === owner.threadId));
  assert.deepEqual(h.calls[0]!.params.items, original.injection!.responseItems);
  assert.deepEqual(h.calls[1]!.params.input, original.injection!.input);
  assert.equal(h.calls[1]!.params.clientUserMessageId, original.clientUserMessageId);
  assert.equal((await h.current()).stage, 'confirmed');
  assert.equal((await h.current()).injection?.phase, 'confirmed');
});

test('loss of original authority after the durable preflight emits no RPC and allows only explicit retry', async () => {
  const h = await fixture();
  h.afterMarking(h.loseAuthority);
  await assert.rejects(h.submit(), /尚未派发/);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.current()).injection?.phase, 'prepared');
  assert.equal((await h.current()).stage, 'failed');
  h.afterMarking(() => {}); h.restoreAuthority();
  await h.retry(); await h.submit();
  assert.equal(h.calls.filter(value => value.method === 'thread/inject_items').length, 1);
});

test('a received injection followed by authority loss resumes only its original turn on explicit retry', async () => {
  const h = await fixture(), callId = h.intent.injection!.callId;
  h.afterInjection(h.loseAuthority);
  await assert.rejects(h.submit(), /authority changed/);
  assert.deepEqual(h.calls.map(value => value.method), ['thread/inject_items']);
  assert.equal((await h.current()).injection?.phase, 'confirmed');
  assert.equal((await h.current()).stage, 'failed');
  h.restoreAuthority(); await h.retry(); await h.submit();
  assert.equal(h.intent.injection!.callId, callId);
  assert.deepEqual(h.calls.map(value => value.method), ['thread/inject_items', 'turn/start']);
});

test('lost and malformed injection responses retain unknown without a turn, replay or history inference', async () => {
  for (const invalidReply of [false, true]) {
    const h = await fixture();
    if (invalidReply) h.reply({ unexpected: true });
    else h.failInjection(new Error('lost injection response'));
    await assert.rejects(h.submit());
    assert.equal((await h.current()).stage, 'unknown');
    assert.equal((await h.current()).injection?.phase, 'unknown');
    await h.store.check(h.intent.id);
    await assert.rejects(h.retry(), /尚未核对/);
    assert.deepEqual(h.calls.map(value => value.method), ['thread/inject_items']);
  }
});

test('received success with a local receipt failure retries only its atom commit before the original turn', async () => {
  const h = await fixture();
  h.afterInjection(h.rejectReceipt);
  await assert.rejects(h.submit(), /transaction aborted/);
  assert.equal((await h.current()).stage, 'unknown');
  await h.store.check(h.intent.id);
  assert.equal((await h.current()).injection?.phase, 'confirmed');
  await h.retry(); await h.submit();
  assert.deepEqual(h.calls.map(value => value.method), ['thread/inject_items', 'turn/start']);
});

test('changing captured context, losing durable hooks, or using a busy session never injects', async () => {
  for (const kind of ['payload', 'hooks', 'busy'] as const) {
    const h = await fixture();
    const overrides: Partial<SubmissionContext> = kind === 'payload'
      ? { injection: { ...h.intent.injection!, callId: 'different-call' } }
      : kind === 'hooks' ? { send: undefined } : { activeTurnId: 'in-progress' };
    await assert.rejects(h.submit(overrides));
    assert.deepEqual(h.calls, []);
  }
});
