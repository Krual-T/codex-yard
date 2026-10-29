import assert from 'node:assert/strict';
import test from 'node:test';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import { sendNativeInjection } from '../src/renderer/app/send-injection-client.ts';
import type { SendInjectionAuthority } from '../src/renderer/app/send-injection-client.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

function fixture() {
  let value: unknown, gate: Promise<void> | null = null, release: (() => void) | undefined, waiting = false;
  const calls: Record<string, any>[] = [];
  const storage = { async read() { return structuredClone(value); }, async update(change: (previous: unknown) => unknown) {
    if (gate) { waiting = true; await gate; waiting = false; }
    value = structuredClone(change(structuredClone(value))); return value;
  } };
  const client: WorkbenchClient = { async rpc() { throw new Error('Unexpected RPC'); },
    async host<T>(endpoint: string, body?: Record<string, unknown>, options?: { assertBeforeSend?: () => void }) {
      if (endpoint !== 'send-injection' || !body) throw new Error('Unexpected endpoint');
      options?.assertBeforeSend?.(); calls.push(structuredClone(body));
      const injection = { phase: 'injected', persistentThread: false, terminal: { kind: 'injected' } };
      return (body.action === 'inject' ? { reference: body.reference, injection, turn: { phase: 'waiting', attempts: [] }, pendingPersistence: null }
        : { reference: body.reference, injection, turn: { phase: 'accepted', attemptId: body.turnAttemptId,
          attempts: [body.turnAttemptId], connectionGeneration: body.daemonConnectionGeneration,
          terminal: { kind: 'accepted', result: { turn: { id: 'synthetic-turn', items: [], status: 'inProgress' } } } }, pendingPersistence: null }) as T;
    }, subscribe: () => () => {}, reply: async () => {} };
  const store = new SendRecoveryStore(client, storage);
  const owner = { hostId: 'local', threadId: 'child', draftId: 'draft' };
  return { client, store, calls, waiting: () => waiting,
    hold() { gate = new Promise<void>(resolve => { release = resolve; }); },
    release() { release?.(); release = undefined; gate = null; },
    async prepare() { return store.prepare({ owner, revision: 'revision' }, '/fixture', { text: 'context', images: [], files: [] },
      {}, {}, undefined, undefined, { type: 'send' }, { callId: 'call', input: [{ type: 'text', text: 'input' }],
        responseItems: [{ type: 'function_call_output', call_id: 'call', output: 'context' }] }); } };
}

const identity = { hostId: 'local', parentThreadId: 'parent', draftId: 'draft', prepareId: 'prepare', operationId: 'operation',
  parentCwd: '/fixture', connectionGeneration: 'generation', childThreadId: 'child' };

test('native injection captures one immutable child proof before storage awaits', async () => {
  const h = fixture(), intent = await h.prepare(), proof = { identity: { ...identity }, challengeId: 'original-challenge' };
  const original = structuredClone(proof);
  const authority: SendInjectionAuthority = { daemonConnectionGeneration: 'generation', sideChat: proof, assertBeforeSend() {} };
  h.hold();
  const send = sendNativeInjection(h.client, { store: h.store, intent, authority }, 'child',
    { threadId: 'child', clientUserMessageId: intent.clientUserMessageId, input: intent.injection!.input });
  while (!h.waiting()) await new Promise(resolve => setImmediate(resolve));
  proof.identity.operationId = 'different-operation'; proof.challengeId = 'replacement-challenge';
  h.release();
  assert.equal((await send).turn.id, 'synthetic-turn');
  assert.deepEqual(h.calls.map(call => call.action), ['inject', 'start']);
  assert.deepEqual(h.calls.map(call => call.sideChat), [original, original]);
});

test('main injection remains unchanged when no side-chat proof is captured', async () => {
  const h = fixture(), intent = await h.prepare();
  await sendNativeInjection(h.client, { store: h.store, intent, authority: { daemonConnectionGeneration: 'generation', assertBeforeSend() {} } },
    'child', { threadId: 'child', clientUserMessageId: intent.clientUserMessageId, input: intent.injection!.input });
  assert.deepEqual(h.calls.map(call => call.action), ['inject', 'start']);
  assert.ok(h.calls.every(call => !Object.hasOwn(call, 'sideChat')));
});

test('revoked authority during the original storage wait does not dispatch injection', async () => {
  const h = fixture(), intent = await h.prepare(); let current = true;
  const authority: SendInjectionAuthority = { daemonConnectionGeneration: 'generation', sideChat: { identity, challengeId: 'challenge' },
    assertBeforeSend() { if (!current) throw new Error('original grant revoked'); } };
  h.hold();
  const send = sendNativeInjection(h.client, { store: h.store, intent, authority }, 'child',
    { threadId: 'child', clientUserMessageId: intent.clientUserMessageId, input: intent.injection!.input });
  while (!h.waiting()) await new Promise(resolve => setImmediate(resolve));
  current = false; h.release();
  await assert.rejects(send, /original grant revoked/);
  assert.equal(h.calls.length, 0);
  const saved = (await h.store.read()).requests[intent.id]!;
  assert.equal(saved.stage, 'failed'); assert.equal(saved.injection?.phase, 'prepared');
  assert.equal(saved.injection?.native?.beforeSend, true);
});
