import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CodexConnection } from '../lib/codex.ts';
import { createConversationWrites } from '../src/native/conversation-writes.ts';
import { createSendInjection } from '../src/native/send-injection.ts';
import type { SendInjectionOriginal, SendInjectionReference, SendInjectionStatus } from '../src/native/send-injection.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import type { SendIntent } from '../src/renderer/app/send-recovery.ts';
import { sessionOptions } from '../src/renderer/app/session-options.ts';
import { captureDraftInjection, submitDraft } from '../src/renderer/app/submission.ts';
import type { SubmissionContext } from '../src/renderer/app/submission.ts';
import type { ComposerDraft, WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, NO_REPLY } from './fake-codex.ts';

const text = 'Respond to the user input in the context of our conversation.';
const draft: ComposerDraft = { text, images: [], files: [], input: [{ type: 'text', text, text_elements: [{
  byteRange: { start: 0, end: new TextEncoder().encode(text).length },
  placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1,
    message: { source: 'visualization', sourceId: 'fixture-widget', text: 'fixture follow-up', structuredContent: { value: 7 } } }),
}] }] };
const thread: ThreadSummary = { id: 'thread', name: null, cwd: '/fixture', status: { type: 'idle' }, turns: [] };
const owner = { hostId: 'fixture', threadId: thread.id, draftId: 'original-draft' };

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'yard-inject-'));
  const peer = await createFakeCodex(root);
  peer.threads.set(thread.id, fixtureThread(thread.id, root)); peer.loaded.add(thread.id);
  peer.handlers.set('thread/inject_items', () => ({}));
  peer.handlers.set('turn/start', () => ({ turn: fixtureTurn('accepted-turn', [], 'inProgress') }));
  const connections: CodexConnection[] = [];
  async function connect() {
    const connection = new CodexConnection(peer.socketPath, { timeout: 80 });
    connections.push(connection); await connection.connect(); return connection;
  }
  let connection = await connect(), generation = 'generation-a', authorized = true, resumed = false;
  const source = { paths: { homeDirectory: root, codexHome: join(root, 'codex') }, sshTarget: null };
  let nativeSection: unknown, state: unknown, failInjectionCommit = false, failTurnReservation = false, failBrowserCommit = false, drop: string | undefined;
  let afterInject: (() => void) | undefined, beforeHost: (() => void) | undefined;
  let statusGate: { wait: Promise<void>; release(): void } | undefined;
  let startGate: { wait: Promise<void>; entered(): void } | undefined;
  const actions: { action: string; params: Record<string, unknown> }[] = [];
  const events: WorkbenchEvent[] = [], listeners = new Set<(event: WorkbenchEvent) => void>();
  const storage = { read: async () => structuredClone(state), update: async (change: (value: unknown) => unknown) => {
    const next = change(structuredClone(state));
    if (failBrowserCommit) { failBrowserCommit = false; throw new Error('synthetic browser transaction aborted'); }
    state = structuredClone(next); return state;
  } };
  const service = createSendInjection({ mutations: createStateMutations(), assertStateAvailable() {}, readSection: () => nativeSection,
    async persistSection(value) {
      const section = value as { operations: { injection: { phase: string }; turn: { phase: string } }[] };
      if (failInjectionCommit && section.operations.some(operation => operation.injection.phase === 'injected')) {
        failInjectionCommit = false; throw new Error('synthetic native receipt persistence failure');
      }
      if (failTurnReservation && section.operations.some(operation => operation.turn.phase === 'preparing')) {
        failTurnReservation = false; throw new Error('synthetic native turn reservation failure');
      }
      nativeSection = structuredClone(value);
    },
    onChange(reference, receipt) {
      const event: WorkbenchEvent = { type: 'send-injection-updated', reference, receipt };
      events.push(event); for (const listener of listeners) listener(event);
    } });
  const write = createConversationWrites();
  const assertAuthority = () => { if (!authorized) throw new Error('original authority changed'); };
  const client: WorkbenchClient = {
    async rpc(method) { throw new Error('Unexpected renderer RPC: ' + method); },
    async host<T>(endpoint: string, params: Record<string, unknown> = {}, options?: { assertBeforeSend?: () => void }) {
      assert.equal(endpoint, 'send-injection');
      const action = String(params.action), reference = params.reference as SendInjectionReference;
      if (action === 'inject' || action === 'start') {
        beforeHost?.();
        try { options?.assertBeforeSend?.(); }
        catch (cause) { throw Object.assign(new Error(String(cause)), { sendPhase: 'before-send', uncertain: false }); }
        actions.push({ action, params: structuredClone(params) });
        if (action === 'start' && startGate) { const gate = startGate; startGate = undefined; gate.entered(); await gate.wait; }
        const original: SendInjectionOriginal = { connection, socket: connection.socket!, generation: String(params.daemonConnectionGeneration), source,
          assertOriginal() { assertAuthority(); if (generation !== params.daemonConnectionGeneration) throw new Error('connection changed'); },
          assertResumedSource(ref, actualSource) {
            if (!resumed || ref.threadId !== thread.id || JSON.stringify(actualSource) !== JSON.stringify(source)) throw new Error('unverified resumed source');
          } };
        const result = await write(reference.hostId, reference.threadId, () => action === 'inject'
          ? service.inject({ reference, items: params.items as Record<string, unknown>[], turnParams: params.turnParams as Record<string, unknown> }, original)
          : service.startTurn({ reference, turnAttemptId: String(params.turnAttemptId) }, original));
        if (action === 'inject') afterInject?.();
        if (drop === action) { drop = undefined; throw new Error('synthetic lost host response'); }
        return structuredClone(result) as T;
      }
      actions.push({ action, params: structuredClone(params) });
      const result = action === 'status' ? await service.status(reference)
        : action === 'retryPersistence' ? await service.retryPersistence(reference, params.receipt as { step: 'injection' | 'turn'; attemptId: string })
          : (() => { throw new Error('Unexpected host action'); })();
      if (action === 'status' && statusGate) { const gate = statusGate; statusGate = undefined; await gate.wait; }
      return structuredClone(result) as T;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, async reply() { throw new Error('unexpected approval'); },
  };
  let store = new SendRecoveryStore(client, storage);
  let intent: SendIntent = await store.prepare({ owner, revision: 'original-revision' }, '/fixture', draft, { model: 'original-model' },
    { model: 'original-model' }, undefined, undefined, { type: 'send' }, captureDraftInjection(draft, owner.hostId));
  const context = (): SubmissionContext => ({ hostId: owner.hostId, threadId: owner.threadId, cwd: '/fixture',
    readOnly: false, activeTurnId: null, thread, overrides: intent.overrides, injection: structuredClone(intent.injection),
    nativeInjection: { store, intent: structuredClone(intent), authority: { daemonConnectionGeneration: generation, assertBeforeSend: assertAuthority } },
    send: { clientUserMessageId: intent.clientUserMessageId, creating: async () => {}, created: async () => {},
      sending: () => store.sending(intent.id, intent.attemptId), confirmed: id => store.confirmed(intent.id, id, intent.attemptId),
      resolvedCollaboration: mode => store.resolvedCollaboration(intent.id, mode, intent.attemptId) } });
  const submit = async (overrides: Partial<SubmissionContext> = {}, value = draft) => {
    try { return await submitDraft(client, { ...context(), ...overrides }, value, intent.options, { type: 'send' }, async () => {}); }
    catch (error) { await store.failed(intent.id, error, intent.attemptId); throw error; }
  };
  t.after(async () => { for (const item of connections) item.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  return { peer, service, client, actions, events, submit, context, current: async () => (await store.read()).requests[intent.id]!,
    get store() { return store; }, get intent() { return intent; }, retry: async () => { intent = await store.attempt(intent.id); },
    reload: () => { store = new SendRecoveryStore(client, storage); }, failCommit: () => { failInjectionCommit = true; },
    failTurnReservation: () => { failTurnReservation = true; },
    failBrowserCommit: () => { failBrowserCommit = true; },
    loseAuthority: () => { authorized = false; }, restoreAuthority: () => { authorized = true; },
    disconnect: () => { authorized = false; connection.close(); },
    afterInject: (callback?: () => void) => { afterInject = callback; }, beforeHost: (callback?: () => void) => { beforeHost = callback; },
    drop: (action: string) => { drop = action; },
    gateStatus() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); statusGate = { wait, release }; return release; },
    gateStart() { let release!: () => void, entered!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
      const reached = new Promise<void>(resolve => { entered = resolve; }); startGate = { wait, entered }; return { reached, release }; },
    async reconnect() { connection.close(); connection = await connect(); generation = 'generation-b';
      const result = await connection.request('thread/resume', { threadId: thread.id }); resumed = result.thread.id === thread.id; authorized = true; },
  };
}

test('submission uses the native fence with immutable ordered input and no direct renderer RPC', async t => {
  const h = await fixture(t), original = structuredClone(h.intent);
  const result = await h.submit();
  assert.equal(result.turn?.id, 'accepted-turn');
  assert.deepEqual(h.actions.map(value => value.action), ['inject', 'start']);
  assert.deepEqual(h.peer.calls('thread/inject_items')[0]!.params.items, original.injection!.responseItems);
  assert.deepEqual(h.peer.calls('turn/start')[0]!.params.input, original.injection!.input);
  assert.equal(h.peer.calls('turn/start')[0]!.params.clientUserMessageId, original.clientUserMessageId);
  assert.equal((await h.current()).stage, 'confirmed');
  assert.equal((await h.current()).injection?.native?.status?.turn.phase, 'accepted');
});

test('authority, input and explicit options remain captured across asynchronous preflight', async t => {
  const h = await fixture(t), context = h.context(), value = structuredClone(draft), options = structuredClone(h.intent.options);
  const original = structuredClone(h.intent), hooks = context.send!;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const resolveMode = hooks.resolvedCollaboration!;
  hooks.resolvedCollaboration = async mode => { await resolveMode(mode); entered(); await wait; };
  const sending = submitDraft(h.client, context, value, options, { type: 'send' }, async () => {});
  await reached;
  context.nativeInjection!.authority.daemonConnectionGeneration = 'changed-generation';
  context.nativeInjection!.authority.assertBeforeSend = () => { throw new Error('replacement assertion'); };
  context.nativeInjection!.intent.injection!.responseItems[1]!.output = 'changed';
  context.injection!.responseItems[1]!.output = 'changed';
  context.overrides!.model = 'changed-model'; options.model = 'changed-model'; value.text = 'changed draft';
  release(); await sending;
  const sent = h.peer.calls('turn/start')[0]!.params;
  assert.equal(sent.model, 'original-model');
  assert.deepEqual(sent.input, original.injection!.input);
  assert.deepEqual(h.peer.calls('thread/inject_items')[0]!.params.items, original.injection!.responseItems);
  assert.equal((await h.current()).injection!.native!.reference.connectionGeneration, 'generation-a');
});

test('a newly created thread keeps the original null-thread owner and submitted revision', async t => {
  const h = await fixture(t), homeOwner = { ...owner, threadId: null, draftId: 'home-draft' };
  const intent = await h.store.prepare({ owner: homeOwner, revision: 'home-revision' }, '/fixture', draft, {}, {},
    undefined, undefined, { type: 'send' }, captureDraftInjection(draft, homeOwner.hostId));
  let selected = false;
  const client: WorkbenchClient = { ...h.client, async rpc<T>(method: string) {
    if (method !== 'thread/start') throw new Error('Unexpected direct RPC: ' + method);
    return { thread } as T;
  } };
  const result = await submitDraft(client, { hostId: homeOwner.hostId, threadId: null, cwd: '/fixture',
    readOnly: false, activeTurnId: null, thread: null, injection: intent.injection,
    nativeInjection: { store: h.store, intent, authority: { daemonConnectionGeneration: 'generation-a', assertBeforeSend() {} } },
    send: { clientUserMessageId: intent.clientUserMessageId,
      creating: () => h.store.creating(intent.id, intent.attemptId),
      created: (created, settings) => h.store.created(intent.id, created.id, { thread: created, settings: sessionOptions(settings) }, intent.attemptId),
      sending: () => h.store.sending(intent.id, intent.attemptId), confirmed: id => h.store.confirmed(intent.id, id, intent.attemptId),
      resolvedCollaboration: mode => h.store.resolvedCollaboration(intent.id, mode, intent.attemptId) } }, draft, {}, { type: 'send' },
  async () => { selected = true; });
  assert.equal(selected, true); assert.equal(result.turn?.id, 'accepted-turn');
  const recovered = (await h.store.read()).requests[intent.id]!;
  assert.deepEqual(recovered.injection!.native!.reference.owner, homeOwner);
  assert.equal(recovered.injection!.native!.reference.revision, 'home-revision');
  assert.equal(recovered.injection!.native!.reference.threadId, thread.id);
  assert.equal(recovered.stage, 'confirmed');
});

test('lost authority before host dispatch is explicitly retryable and never injects', async t => {
  const h = await fixture(t);
  h.beforeHost(h.loseAuthority);
  await assert.rejects(h.submit(), /authority changed/);
  assert.equal(h.peer.calls('thread/inject_items').length, 0);
  assert.equal((await h.current()).injection?.native?.beforeSend, true);
  assert.equal((await h.current()).stage, 'failed');
  h.beforeHost(); h.restoreAuthority(); await h.retry(); await h.submit();
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
});

test('confirmed injection survives socket replacement and resumes its original turn only on an explicit attempt', async t => {
  const h = await fixture(t);
  h.afterInject(h.disconnect);
  await assert.rejects(h.submit(), /authority changed/);
  const old = await h.current(), reference = structuredClone(old.injection!.native!.reference), params = structuredClone(old.injection!.native!.turnParams);
  assert.equal(old.injection?.phase, 'confirmed');
  assert.equal(h.peer.calls('turn/start').length, 0);
  await h.reconnect(); h.afterInject(); h.reload(); await h.retry();
  await h.submit({ overrides: { model: 'changed-model', effort: 'high' } });
  const done = await h.current();
  assert.deepEqual(done.injection!.native!.reference, reference);
  assert.deepEqual(h.peer.calls('turn/start')[0]!.params, params);
  assert.equal(done.injection!.native!.status!.turn.connectionGeneration, 'generation-b');
  assert.equal(h.peer.calls('thread/resume').length, 1);
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
});

test('a definite injection rejection permits only a new explicit injection attempt with the original payload', async t => {
  const h = await fixture(t);
  h.peer.handlers.set('thread/inject_items', () => { throw Object.assign(new Error('synthetic invalid request'), { code: -32602 }); });
  await assert.rejects(h.submit(), /尚未允许/);
  const rejected = await h.current(), native = rejected.injection!.native!;
  assert.equal(rejected.injection?.phase, 'prepared');
  assert.equal(native.status?.injection.phase, 'rejected');
  h.peer.handlers.set('thread/inject_items', () => ({}));
  await h.retry(); await h.submit({ overrides: { model: 'other-model' } });
  const accepted = await h.current(), next = accepted.injection!.native!;
  assert.notEqual(next.reference.injectionAttemptId, native.reference.injectionAttemptId);
  assert.equal(next.reference.callId, native.reference.callId);
  assert.deepEqual(next.turnParams, native.turnParams);
  assert.equal(h.peer.calls('thread/inject_items').length, 2);
});

test('an unknown original response is reconciled by exact native status after reload, never history or replay', async t => {
  const h = await fixture(t);
  h.drop('inject');
  await assert.rejects(h.submit(), /lost host response/);
  assert.equal((await h.current()).stage, 'unknown');
  await assert.rejects(h.store.attempt(h.intent.id), /尚未核对/);
  await assert.rejects(h.store.cancel(h.intent.id), /尚未核对/);
  h.reload(); const checked = await h.store.check(h.intent.id);
  assert.equal(checked.injection?.phase, 'confirmed');
  assert.equal(checked.stage, 'failed');
  await h.retry(); await h.submit();
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
  assert.equal(h.peer.calls('turn/start').length, 1);
  assert.ok(h.actions.some(value => value.action === 'status'));
});

test('a failed native receipt commit remains blocked until exact persistence succeeds', async t => {
  const h = await fixture(t);
  h.failCommit();
  await assert.rejects(h.submit(), /尚未允许/);
  let pending = await h.current();
  assert.equal(pending.stage, 'unknown');
  assert.equal(pending.injection?.native?.status?.pendingPersistence?.step, 'injection');
  await assert.rejects(h.store.attempt(h.intent.id), /尚未核对/);
  await h.store.retryNativePersistence(h.intent.id);
  pending = await h.current();
  assert.equal(pending.injection?.phase, 'confirmed');
  await h.retry(); await h.submit();
  assert.deepEqual(h.actions.map(value => value.action), ['inject', 'retryPersistence', 'start']);
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
});

test('a browser transaction abort after native acceptance is recovered from native without replay', async t => {
  const h = await fixture(t);
  h.afterInject(h.failBrowserCommit);
  await assert.rejects(h.submit(), /browser transaction aborted/);
  assert.equal((await h.current()).stage, 'unknown');
  h.afterInject(); h.reload();
  assert.equal((await h.store.check(h.intent.id)).injection?.phase, 'confirmed');
  await h.retry(); await h.submit();
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
  assert.equal(h.peer.calls('turn/start').length, 1);
});

test('turn reservation failure is recoverable when native status still shows waiting or an older rejected attempt', async t => {
  for (const previous of [false, true]) {
    const h = await fixture(t);
    if (previous) {
      h.peer.handlers.set('turn/start', () => { throw Object.assign(new Error('synthetic invalid turn'), { code: -32602 }); });
      await assert.rejects(h.submit(), /尚未确认/);
      assert.equal((await h.current()).injection?.native?.status?.turn.phase, 'rejected');
      await h.retry(); h.peer.handlers.set('turn/start', () => ({ turn: fixtureTurn('accepted-turn', [], 'inProgress') }));
    }
    h.failTurnReservation();
    await assert.rejects(h.submit(), /尚未确认/);
    h.reload();
    const checked = await h.store.check(h.intent.id), status = checked.injection!.native!.status!;
    assert.equal(status.pendingPersistence?.step, 'turn');
    assert.equal(status.turn.phase, previous ? 'rejected' : 'waiting');
    assert.equal(checked.stage, 'unknown');
    await assert.rejects(h.store.attempt(h.intent.id), /尚未核对/);
    const saved = await h.store.retryNativePersistence(h.intent.id);
    assert.equal(saved.injection?.native?.status?.turn.phase, 'not-sent');
    await h.retry(); await h.submit();
    assert.equal(h.peer.calls('thread/inject_items').length, 1);
    assert.equal(h.peer.calls('turn/start').length, previous ? 2 : 1);
  }
});

test('a lost accepted turn is recovered only from its exact native attempt, without a new turn', async t => {
  const h = await fixture(t); h.drop('start');
  await assert.rejects(h.submit(), /lost host response/);
  const pending = await h.current(), native = pending.injection!.native!;
  assert.equal(pending.stage, 'unknown');
  assert.equal(pending.injection?.phase, 'confirmed');
  await assert.rejects(h.store.attempt(pending.id), /尚未核对/);
  await assert.rejects(h.store.cancel(pending.id), /尚未核对/);
  const wrongAttempt = structuredClone((await h.service.status(native.reference))!);
  wrongAttempt.turn.attemptId = 'other-attempt'; wrongAttempt.turn.attempts = ['other-attempt'];
  await h.store.applyNativeStatus(pending.id, native, wrongAttempt);
  assert.equal((await h.current()).stage, 'unknown');
  const wrongGeneration = structuredClone((await h.service.status(native.reference))!);
  wrongGeneration.turn.connectionGeneration = 'different-generation';
  await h.store.applyNativeStatus(pending.id, native, wrongGeneration);
  assert.equal((await h.current()).stage, 'unknown');
  h.reload(); const recovered = await h.store.check(pending.id);
  assert.equal(recovered.stage, 'confirmed');
  assert.equal(recovered.turnId, 'accepted-turn');
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
  assert.equal(h.peer.calls('turn/start').length, 1);
});

test('host waiting cannot release a locally reserved turn while its original request is in flight', async t => {
  const h = await fixture(t), gate = h.gateStart(), sending = h.submit();
  await gate.reached;
  const checked = await h.store.check(h.intent.id);
  assert.equal(checked.stage, 'unknown');
  assert.equal(checked.injection?.phase, 'confirmed');
  await assert.rejects(h.store.attempt(h.intent.id), /尚未核对/);
  gate.release(); await sending;
  assert.equal((await h.current()).stage, 'confirmed');
  assert.equal(h.peer.calls('turn/start').length, 1);
});

test('before-send turn failure retains confirmed injection and needs a fresh explicit turn attempt', async t => {
  const h = await fixture(t);
  h.afterInject(() => h.beforeHost(h.loseAuthority));
  await assert.rejects(h.submit(), /authority changed/);
  const before = await h.current();
  assert.equal(before.injection?.phase, 'confirmed');
  assert.equal(before.stage, 'failed');
  await assert.rejects(h.store.cancel(before.id), /尚未核对/);
  h.beforeHost(); h.afterInject(); h.restoreAuthority(); await h.retry(); await h.submit();
  assert.notEqual((await h.current()).attemptId, before.attemptId);
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
  assert.equal(h.peer.calls('turn/start').length, 1);
});

test('late exact terminal wins over an older in-flight status query and mismatched hints are ignored', async t => {
  const h = await fixture(t);
  let reply!: () => void;
  h.peer.handlers.set('thread/inject_items', (_params, context) => {
    reply = () => context.send({ id: context.message.id!, result: {} }); return NO_REPLY;
  });
  await assert.rejects(h.submit(), /尚未允许/);
  const before = await h.current(), native = before.injection!.native!;
  assert.equal(before.stage, 'unknown');
  const release = h.gateStatus(), stale = h.store.check(h.intent.id);
  while (!h.actions.some(value => value.action === 'status')) await new Promise(resolve => setImmediate(resolve));
  const changed = new Promise<void>(resolve => { const unsubscribe = h.client.subscribe(event => {
    if (event.type === 'send-injection-updated') { unsubscribe(); resolve(); }
  }); });
  reply(); await changed;
  assert.equal(await h.store.checkNativeHint({ type: 'send-injection-updated', reference: { ...native.reference, revision: 'wrong' },
    receipt: { step: 'injection', attemptId: native.reference.injectionAttemptId } }), null);
  const event = h.events.at(-1)!;
  await h.store.checkNativeHint(event);
  release(); await stale;
  assert.equal((await h.current()).injection?.phase, 'confirmed');
  assert.equal((await h.current()).stage, 'failed');
  await h.retry(); await h.submit();
  assert.equal(h.peer.calls('thread/inject_items').length, 1);
});

test('changed payload or draft, changed first-send options, missing native parent and fabricated status fail closed', async t => {
  for (const kind of ['payload', 'parent', 'busy', 'draft', 'options'] as const) {
    const h = await fixture(t);
    const overrides: Partial<SubmissionContext> = kind === 'payload' ? { injection: { ...h.intent.injection!, callId: 'different' } }
      : kind === 'parent' ? { nativeInjection: undefined } : kind === 'busy' ? { activeTurnId: 'active' }
        : kind === 'options' ? { overrides: { model: 'changed-before-first-send' } } : {};
    await assert.rejects(h.submit(overrides, kind === 'draft' ? { ...draft, skills: [] } : draft));
    assert.equal(h.peer.calls('thread/inject_items').length, 0);
  }
  const h = await fixture(t); h.drop('inject'); await assert.rejects(h.submit());
  const current = await h.current(), native = current.injection!.native!, status = await h.service.status(native.reference);
  assert.ok(status);
  const wrong: SendInjectionStatus = structuredClone(status); wrong.reference.revision = 'different';
  assert.throws(() => h.store.applyNativeStatus(current.id, native, wrong), /身份或内容无效/);
  assert.equal((await h.current()).stage, 'unknown');
});
