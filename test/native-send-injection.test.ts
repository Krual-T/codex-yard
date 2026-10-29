import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type WebSocket from 'ws';
import { CodexConnection } from '../lib/codex.ts';
import { createConversationWrites } from '../src/native/conversation-writes.ts';
import { createNativeState } from '../src/native/native-state.ts';
import type { NativeStateCheckpoint } from '../src/native/native-state.ts';
import { createSendInjection } from '../src/native/send-injection.ts';
import type { SendInjectionInput, SendInjectionOriginal, SendInjectionReference } from '../src/native/send-injection.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, NO_REPLY } from './fake-codex.ts';

type Value = Record<string, unknown>;
function replace(target: Value, next: Value) {
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of Object.entries(next)) Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
async function eventually<T>(read: () => Promise<T>, check: (value: T) => boolean): Promise<T> {
  for (let count = 0; count < 200; count++) {
    const value = await read();
    if (check(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('fixture state did not settle');
}

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/aw-injection-'), file = join(root, 'native-state.json');
  const initial = { settings: { theme: 'fixture' }, globals: { project: 'fixture' }, future: { retained: true } };
  await writeFile(file, JSON.stringify(initial));
  const state: Value = {};
  let checkpoint: ((step: NativeStateCheckpoint) => void | Promise<void>) | undefined;
  const native = createNativeState({ dataDir: root, publish: next => replace(state, next), checkpoint: step => checkpoint?.(step) });
  replace(state, await native.load());
  const mutations = createStateMutations(native.beforeAction), peer = await createFakeCodex(root);
  const thread = fixtureThread('thread-a', root);
  peer.threads.set(thread.id, thread); peer.loaded.add(thread.id);
  peer.handlers.set('thread/inject_items', () => ({}));
  peer.handlers.set('turn/start', () => ({ turn: fixtureTurn('accepted-turn', [], 'inProgress') }));
  const connections: CodexConnection[] = [];
  async function connect(timeout = 100) {
    const connection = new CodexConnection(peer.socketPath, { timeout });
    connections.push(connection); await connection.connect(); return connection;
  }
  const first = await connect(), second = await connect();
  type Grant = { connection: CodexConnection; socket: WebSocket; generation: string; revision: string; draftId: string };
  const grants = new Map<string, Grant>();
  function grant(page: string, connection: CodexConnection, generation: string, draftId: string, revision = 'revision-a'): SendInjectionOriginal {
    assert.ok(connection.socket);
    const captured: Grant = { connection, socket: connection.socket, generation, draftId, revision };
    grants.set(page, captured);
    return { connection, socket: captured.socket, generation, source: { paths: { homeDirectory: root, codexHome: join(root, 'codex') }, sshTarget: null }, assertOriginal(reference) {
      if (grants.get(page) !== captured || reference.hostId !== 'host-a' || reference.threadId !== 'thread-a'
        || reference.owner.draftId !== captured.draftId || reference.revision !== captured.revision
        || reference.connectionGeneration !== captured.generation) throw new Error('original fixture authority changed');
    } };
  }
  const original = grant('page-a', first, 'generation-a', 'draft-a');
  grant('page-b', second, 'generation-b', 'draft-b');
  const deps = { mutations, assertStateAvailable: native.assertAvailable, readSection: () => state.sendInjections,
    persistSection: (value: unknown) => native.persist({ ...state, sendInjections: value }) };
  const service = createSendInjection(deps), write = createConversationWrites();
  const reference = (suffix = '1'): SendInjectionReference => ({ hostId: 'host-a', threadId: 'thread-a', intentId: `intent-${suffix}`,
    injectionAttemptId: `inject-${suffix}`, callId: `call-${suffix}`, clientUserMessageId: `cid-${suffix}`,
    owner: { hostId: 'host-a', threadId: 'thread-a', draftId: 'draft-a' }, revision: 'revision-a', connectionGeneration: 'generation-a' });
  const input = (reference = fixtureReference()): SendInjectionInput => ({ reference,
    items: [{ type: 'function_call', call_id: reference.callId, name: 'untrusted_input', arguments: '{}' },
      { type: 'function_call_output', call_id: reference.callId, output: [{ type: 'input_text', text: 'fixture context' }] }],
    turnParams: { threadId: reference.threadId, clientUserMessageId: reference.clientUserMessageId,
      input: [{ type: 'text', text: 'fixture message', text_elements: [] }] } });
  function fixtureReference() { return reference(); }
  const inject = (value: SendInjectionInput, origin = original, target = service) => write(value.reference.hostId, value.reference.threadId,
    () => target.inject(value, origin));
  const start = (value: SendInjectionReference, attempt = 'turn-attempt-1', origin = original, target = service) =>
    write(value.hostId, value.threadId, () => target.startTurn({ reference: value, turnAttemptId: attempt }, origin));
  const otherTurn = () => write('host-a', 'thread-a', async () => {
    await service.assertCanWrite('host-a', 'thread-a');
    return second.request('turn/start', { threadId: 'thread-a', input: [], clientUserMessageId: 'other-cid' }, { mutating: true });
  });
  const disk = async () => JSON.parse(await readFile(file, 'utf8')) as Value;
  t.after(async () => { for (const connection of connections) connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  return { root, file, initial, state, native, mutations, peer, first, second, connect, grant, original, service, deps, write,
    reference, input, inject, start, otherTurn, disk, checkpoint(value?: typeof checkpoint) { checkpoint = value; } };
}

async function stopOwnerDuringPreparation(f: Awaited<ReturnType<typeof fixture>>, step: 'injection' | 'turn') {
  const script = `
import { CodexConnection } from './lib/codex.ts';
import { createConversationWrites } from './src/native/conversation-writes.ts';
import { createNativeState } from './src/native/native-state.ts';
import { createStateMutations } from './src/native/state-mutations.ts';
import { createSendInjection } from './src/native/send-injection.ts';
const [root, socketPath, payload, step] = process.argv.slice(1);
const { input, source } = JSON.parse(payload);
const state = {};
const replace = next => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, next); };
let fileSyncs = 0;
const native = createNativeState({ dataDir: root, publish: replace, checkpoint(name) {
  if (name === 'file-sync' && ++fileSyncs === (step === 'injection' ? 2 : 5)) process.exit(73);
} });
replace(await native.load());
const mutations = createStateMutations(native.beforeAction);
const service = createSendInjection({ mutations, assertStateAvailable: native.assertAvailable, readSection: () => state.sendInjections,
  persistSection: section => native.persist({ ...state, sendInjections: section }) });
const connection = new CodexConnection(socketPath, { timeout: 1000 });
await connection.connect();
const original = { connection, socket: connection.socket, generation: input.reference.connectionGeneration, source, assertOriginal() {} };
const write = createConversationWrites(), ref = input.reference;
await write(ref.hostId, ref.threadId, () => service.inject(input, original));
if (step === 'turn') await write(ref.hostId, ref.threadId, () => service.startTurn({ reference: ref, turnAttemptId: 'turn-attempt-1' }, original));
process.exit(1);
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, f.root, f.peer.socketPath,
    JSON.stringify({ input: f.input(), source: f.original.source }), step], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += String(data); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null, stderr);
    assert.equal(code, 73, stderr);
  } finally { clearTimeout(timer); }
  return child;
}

test('two real consumers cannot interpose a turn between injection and its original turn', async t => {
  const f = await fixture(t), value = f.input(), ref = value.reference;
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('thread/inject_items', (_params, context) => {
    pending = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const sending = f.inject(value);
  await f.peer.waitForCall('thread/inject_items');
  const other = f.otherTurn();
  assert.ok(pending); pending.send({ id: pending.id, result: {} });
  const injected = await sending;
  assert.equal(injected.injection.phase, 'injected');
  await assert.rejects(other, /尚未结算/);
  assert.equal(f.peer.calls('turn/start').length, 0);
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  const accepted = await f.start(ref);
  assert.equal(accepted.turn.phase, 'accepted');
  assert.equal(accepted.turn.terminal?.kind, 'accepted');
  assert.deepEqual(f.peer.calls('turn/start')[0].params, value.turnParams);
  assert.equal(f.peer.calls('thread/read').length, 2);
  await f.otherTurn();
  assert.equal(f.peer.calls('turn/start').length, 2);
  const disk = await f.disk();
  assert.deepEqual(disk.settings, f.initial.settings); assert.deepEqual(disk.globals, f.initial.globals); assert.deepEqual(disk.future, f.initial.future);
});

test('a new daemon socket cannot continue a confirmed original injection', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  const replacement = await f.connect();
  const replacementOrigin = f.grant('page-a', replacement, 'generation-b', 'draft-a');
  await assert.rejects(f.start(value.reference, 'turn-attempt-1', replacementOrigin), /连接|改变|来源/);
  await assert.rejects(f.start(value.reference), /authority changed/);
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 0);
});

test('an explicitly resumed original turn can use a new connection with a verified persistent source', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  f.peer.handlers.set('turn/start', () => { throw Object.assign(new Error('fixture rejection'), { code: -32602 }); });
  assert.equal((await f.start(value.reference)).turn.phase, 'rejected');
  f.first.close();
  const replacement = await f.connect(), socket = replacement.socket;
  assert.ok(socket);
  const resume = await replacement.request('thread/resume', { threadId: value.reference.threadId });
  assert.equal(resume.thread.id, value.reference.threadId);
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-b', source: f.original.source,
    assertOriginal(reference) {
      assert.deepEqual(reference, value.reference);
      if (replacement.socket !== socket) throw new Error('fixture socket changed');
    },
    assertResumedSource(reference, source) {
      assert.deepEqual(source, f.original.source);
      if (resume.thread.id !== reference.threadId || replacement.socket !== socket) throw new Error('fixture resumed source unavailable');
    } };
  f.peer.handlers.set('turn/start', () => ({ turn: fixtureTurn('resumed-turn', [], 'inProgress') }));
  const result = await f.start(value.reference, 'turn-attempt-2', origin);
  assert.equal(result.turn.phase, 'accepted');
  assert.equal(result.turn.connectionGeneration, 'generation-b');
  assert.deepEqual(f.peer.calls('turn/start')[1].params, value.turnParams);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('a new peer can resume a confirmed durable injection after reloading the native-state file', async t => {
  const f = await fixture(t), value = f.input();
  const injected = await f.inject(value);
  assert.equal(injected.injection.persistentThread, true);
  const saved = (await f.disk()).sendInjections as { operations: { source: unknown }[] };
  assert.deepEqual(saved.operations[0].source, f.original.source);
  f.first.close();
  const newRoot = await mkdtemp('/tmp/aw-injection-peer-'), newPeer = await createFakeCodex(newRoot);
  const replacement = new CodexConnection(newPeer.socketPath, { timeout: 100 });
  t.after(async () => { replacement.close(); await newPeer.close(); await rm(newRoot, { recursive: true, force: true }); });
  newPeer.threads.set(value.reference.threadId, fixtureThread(value.reference.threadId, f.root));
  await replacement.connect();
  const socket = replacement.socket;
  assert.ok(socket);
  const resume = await replacement.request('thread/resume', { threadId: value.reference.threadId });
  newPeer.handlers.set('turn/start', () => ({ turn: fixtureTurn('new-daemon-turn', [], 'inProgress') }));
  const reloaded: Value = {}, native = createNativeState({ dataDir: f.root, publish: next => replace(reloaded, next) });
  replace(reloaded, await native.load());
  const mutations = createStateMutations(native.beforeAction);
  const rebuilt = createSendInjection({ mutations, assertStateAvailable: native.assertAvailable, readSection: () => reloaded.sendInjections,
    persistSection: section => native.persist({ ...reloaded, sendInjections: section }),
    assertPreviousOwnerStopped() { assert.equal(f.first.closed, true); assert.equal(f.first.pending.size, 0); } });
  assert.deepEqual(await rebuilt.recoverInterruptedPreparations(), []);
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-new-daemon', source: f.original.source,
    assertOriginal(reference) { assert.deepEqual(reference, value.reference); assert.equal(replacement.socket, socket); },
    assertResumedSource(reference, source) {
      assert.deepEqual(source, f.original.source); assert.equal(resume.thread.id, reference.threadId); assert.equal(Reflect.get(resume.thread, 'ephemeral'), false);
    } };
  const result = await f.start(value.reference, 'new-daemon-attempt', origin, rebuilt);
  assert.equal(result.turn.phase, 'accepted');
  assert.equal(result.turn.connectionGeneration, 'generation-new-daemon');
  assert.deepEqual(newPeer.calls('turn/start')[0].params, value.turnParams);
  assert.equal(newPeer.calls('thread/inject_items').length, 0);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('a changed codex home cannot resume the original injection even with a callback', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  const replacement = await f.connect(), socket = replacement.socket;
  assert.ok(socket);
  const resume = await replacement.request('thread/resume', { threadId: value.reference.threadId });
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-b',
    source: { ...f.original.source, paths: { ...f.original.source.paths, codexHome: join(f.root, 'other-codex') } },
    assertOriginal(reference) { assert.deepEqual(reference, value.reference); },
    assertResumedSource(reference) { assert.equal(resume.thread.id, reference.threadId); } };
  await assert.rejects(f.start(value.reference, 'turn-attempt-1', origin), /状态目录已改变/);
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal(f.peer.calls('turn/start').length, 0);
});

for (const step of ['injection', 'turn'] as const) {
  test(`a stopped original process recovers only its persisted ${step} preparation`, async t => {
    const f = await fixture(t), value = f.input(), child = await stopOwnerDuringPreparation(f, step);
    const reloaded: Value = {}, native = createNativeState({ dataDir: f.root, publish: next => replace(reloaded, next) });
    replace(reloaded, await native.load());
    const old = (reloaded.sendInjections as { operations: { injection: { phase: string }; turn: { phase: string } }[] }).operations[0];
    assert.equal(step === 'injection' ? old.injection.phase : old.turn.phase, 'preparing');
    assert.equal(f.peer.calls('thread/inject_items').length, step === 'injection' ? 0 : 1);
    assert.equal(f.peer.calls('turn/start').length, 0);
    const mutations = createStateMutations(native.beforeAction);
    const service = createSendInjection({ mutations, assertStateAvailable: native.assertAvailable, readSection: () => reloaded.sendInjections,
      persistSection: section => native.persist({ ...reloaded, sendInjections: section }),
      assertPreviousOwnerStopped() { assert.equal(child.exitCode, 73); assert.equal(child.signalCode, null); } });
    const recovered = await service.recoverInterruptedPreparations();
    assert.equal(recovered.length, 1);
    const state = step === 'injection' ? recovered[0].injection : recovered[0].turn;
    assert.deepEqual(state.terminal, { kind: 'not-sent', reason: 'previous-owner-stopped' });
    await assert.rejects(service.recoverInterruptedPreparations(), /只能在/);
    if (step === 'injection') {
      await f.write('host-a', 'thread-a', async () => {
        await service.assertCanWrite('host-a', 'thread-a');
        return f.second.request('turn/start', { threadId: 'thread-a', input: [], clientUserMessageId: 'other-cid' }, { mutating: true });
      });
      assert.equal(f.peer.calls('thread/inject_items').length, 0);
    } else {
      await assert.rejects(service.assertCanWrite('host-a', 'thread-a'), /尚未结算/);
      const socket = f.second.socket;
      assert.ok(socket);
      const resume = await f.second.request('thread/resume', { threadId: value.reference.threadId });
      const origin: SendInjectionOriginal = { connection: f.second, socket, generation: 'generation-b', source: f.original.source,
        assertOriginal(reference) { assert.deepEqual(reference, value.reference); },
        assertResumedSource(reference, source) { assert.deepEqual(source, f.original.source); assert.equal(resume.thread.id, reference.threadId); } };
      assert.equal((await f.start(value.reference, 'turn-attempt-2', origin, service)).turn.phase, 'accepted');
      assert.equal(f.peer.calls('thread/inject_items').length, 1);
      assert.equal(f.peer.calls('turn/start').length, 1);
    }
  });
}

test('startup recovery requires prior-owner proof and is unavailable after normal use', async t => {
  const f = await fixture(t), service = createSendInjection(f.deps);
  await assert.rejects(service.recoverInterruptedPreparations(), /尚不能确认/);
  assert.equal(await service.status(f.reference()), null);
  await assert.rejects(service.recoverInterruptedPreparations(), /只能在/);
});

test('startup recovery rechecks a preparation after directory sync fails following rename', async t => {
  const f = await fixture(t), value = f.input(), child = await stopOwnerDuringPreparation(f, 'injection');
  const reloaded: Value = {};
  let fail = true;
  const native = createNativeState({ dataDir: f.root, publish: next => replace(reloaded, next), checkpoint(step) {
    if (step === 'directory-sync' && fail) { fail = false; throw new Error('fixture directory sync failure'); }
  } });
  replace(reloaded, await native.load());
  const mutations = createStateMutations(native.beforeAction);
  let proofs = 0;
  const service = createSendInjection({ mutations, assertStateAvailable: native.assertAvailable, readSection: () => reloaded.sendInjections,
    persistSection: section => native.persist({ ...reloaded, sendInjections: section }),
    assertPreviousOwnerStopped() { proofs++; assert.equal(child.exitCode, 73); assert.equal(child.signalCode, null); } });
  await assert.rejects(service.recoverInterruptedPreparations(), /native-state/);
  assert.deepEqual(await service.recoverInterruptedPreparations(), []);
  assert.equal(proofs, 2);
  assert.deepEqual((await service.status(value.reference))?.injection.terminal,
    { kind: 'not-sent', reason: 'previous-owner-stopped' });
  await f.write('host-a', 'thread-a', async () => {
    await service.assertCanWrite('host-a', 'thread-a');
    return f.second.request('turn/start', { threadId: 'thread-a', input: [], clientUserMessageId: 'other-cid' }, { mutating: true });
  });
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  assert.equal(f.peer.calls('turn/start').length, 1);
});

test('a confirmed injection in an ephemeral thread cannot resume on a new connection', async t => {
  const f = await fixture(t), value = f.input();
  f.peer.threads.set(value.reference.threadId, fixtureThread(value.reference.threadId, f.root, { ephemeral: true }));
  const injected = await f.inject(value);
  assert.equal(injected.injection.persistentThread, false);
  const replacement = await f.connect(), socket = replacement.socket;
  assert.ok(socket);
  const resume = await replacement.request('thread/resume', { threadId: value.reference.threadId });
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-b', source: f.original.source,
    assertOriginal(reference) { assert.deepEqual(reference, value.reference); },
    assertResumedSource(reference) { assert.equal(resume.thread.id, reference.threadId); } };
  await assert.rejects(f.start(value.reference, 'turn-attempt-1', origin), /持久会话/);
  assert.equal(f.peer.calls('turn/start').length, 0);
  await assert.rejects(f.otherTurn(), /尚未结算/);
});

test('a resumed thread must still be persistent in the final original-connection idle read', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.persistentThread, true);
  const replacement = await f.connect(), socket = replacement.socket;
  assert.ok(socket);
  const resume = await replacement.request('thread/resume', { threadId: value.reference.threadId });
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-b', source: f.original.source,
    assertOriginal(reference) { assert.deepEqual(reference, value.reference); },
    assertResumedSource(reference) { assert.equal(resume.thread.id, reference.threadId); } };
  f.peer.handlers.set('thread/read', () => ({ thread: fixtureThread(value.reference.threadId, f.root, { ephemeral: true }) }));
  const result = await f.start(value.reference, 'turn-attempt-1', origin);
  assert.deepEqual(result.turn.terminal, { kind: 'not-sent', reason: 'idle-unconfirmed' });
  assert.equal(f.peer.calls('turn/start').length, 0);
  await assert.rejects(f.otherTurn(), /尚未结算/);
});

test('a legacy operation without source evidence remains same-connection only', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  const legacy = structuredClone(f.state), section = legacy.sendInjections as { operations: { source?: unknown; injection: { persistentThread?: boolean } }[] };
  delete section.operations[0].source;
  delete section.operations[0].injection.persistentThread;
  await f.mutations.run(() => f.native.persist(legacy));
  const replacement = await f.connect(), socket = replacement.socket;
  assert.ok(socket);
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-b', source: f.original.source,
    assertOriginal(reference) { assert.deepEqual(reference, value.reference); }, assertResumedSource() {} };
  await assert.rejects(f.start(value.reference, 'turn-attempt-1', origin), /持久会话/);
  assert.equal((await f.start(value.reference)).turn.phase, 'accepted');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 1);
});

test('a new connection cannot retry an original turn with an unknown outcome even after resume', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  f.peer.handlers.set('turn/start', () => NO_REPLY);
  assert.equal((await f.start(value.reference)).turn.phase, 'unknown');
  f.first.close();
  const replacement = await f.connect(), socket = replacement.socket;
  assert.ok(socket);
  const resume = await replacement.request('thread/resume', { threadId: value.reference.threadId });
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-b', source: f.original.source,
    assertOriginal(reference) { assert.deepEqual(reference, value.reference); },
    assertResumedSource(reference, source) { assert.deepEqual(source, f.original.source); assert.equal(resume.thread.id, reference.threadId); } };
  await assert.rejects(f.start(value.reference, 'turn-attempt-2', origin), /尚未确认/);
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 1);
});

test('a resumed connection loses its write authority if its source is revoked while idle is pending', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  f.first.close();
  const replacement = await f.connect(), socket = replacement.socket;
  assert.ok(socket);
  const resume = await replacement.request('thread/resume', { threadId: value.reference.threadId });
  let authorizedSource: typeof f.peer | null = f.peer;
  const origin: SendInjectionOriginal = { connection: replacement, socket, generation: 'generation-b', source: f.original.source,
    assertOriginal(reference) { assert.deepEqual(reference, value.reference); },
    assertResumedSource(reference, source) {
      if (authorizedSource !== f.peer || resume.thread.id !== reference.threadId || source.paths.codexHome !== f.original.source.paths.codexHome) {
        throw new Error('fixture source changed');
      }
    } };
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('thread/read', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  const starting = f.start(value.reference, 'turn-attempt-1', origin);
  await f.peer.waitForCall('thread/read', 2);
  authorizedSource = null;
  assert.ok(pending); pending.send({ id: pending.id, result: { thread: fixtureThread('thread-a', f.root) } });
  const stopped = await starting;
  assert.deepEqual(stopped.turn.terminal, { kind: 'not-sent', reason: 'original-changed' });
  assert.equal(stopped.turn.connectionGeneration, 'generation-b');
  assert.equal(f.peer.calls('turn/start').length, 0);
  await assert.rejects(f.otherTurn(), /尚未结算/);
});

test('injection protocol rejection releases only that original fence', async t => {
  const f = await fixture(t), first = f.input();
  f.peer.handlers.set('thread/inject_items', () => { throw Object.assign(new Error('fixture rejection'), { code: -32602 }); });
  const rejected = await f.inject(first);
  assert.deepEqual(rejected.injection.terminal, { kind: 'rejected', code: -32602 });
  await f.otherTurn();
  f.peer.handlers.set('thread/inject_items', () => ({}));
  const next = f.input(f.reference('2'));
  assert.equal((await f.inject(next)).injection.phase, 'injected');
  assert.equal(f.peer.calls('thread/inject_items').length, 2);
  assert.equal((await f.service.status(first.reference))?.injection.phase, 'rejected');
});

test('an original late injection success is retained without replay and remains fenced', async t => {
  const f = await fixture(t), value = f.input();
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('thread/inject_items', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  const unknown = await f.inject(value);
  assert.equal(unknown.injection.phase, 'unknown'); assert.ok(pending);
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal((await f.inject(value)).injection.phase, 'unknown');
  pending.send({ id: pending.id, result: {} });
  const observed = await eventually(() => f.service.status(value.reference), item => item?.injection.phase === 'injected');
  assert.equal(observed?.injection.phase, 'injected');
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal((await f.start(value.reference)).turn.phase, 'accepted');
});

test('a late committed success clears the earlier failed unknown observation for the same attempt', async t => {
  const f = await fixture(t), value = f.input();
  let pending: { id: string | number; send(value: unknown): void } | undefined, failures = 0;
  f.checkpoint(step => { if (step === 'file-sync' && failures > 0) { failures--; throw new Error('fixture unknown sync failure'); } });
  f.peer.handlers.set('thread/inject_items', (_params, context) => {
    pending = { id: context.message.id!, send: context.send }; failures = 1; return NO_REPLY;
  });
  const timedOut = await f.inject(value);
  assert.equal(timedOut.pendingPersistence?.terminal, null);
  assert.ok(pending); pending.send({ id: pending.id, result: {} });
  const settled = await eventually(() => f.service.status(value.reference), result => result?.injection.phase === 'injected');
  assert.equal(settled?.pendingPersistence, null);
  assert.equal((await f.start(value.reference)).turn.phase, 'accepted');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 1);
});

test('a captured terminal remains fenced and visible if the original durable record is missing', async t => {
  const f = await fixture(t), value = f.input();
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('thread/inject_items', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  const sending = f.inject(value);
  await f.peer.waitForCall('thread/inject_items');
  await f.mutations.run(() => f.native.persist({ ...f.state, sendInjections: { version: 1, operations: [] } }));
  assert.ok(pending); pending.send({ id: pending.id, result: {} });
  assert.equal((await sending).pendingPersistence?.terminal?.kind, 'injected');
  assert.equal((await f.service.status(value.reference))?.pendingPersistence?.terminal?.kind, 'injected');
  await assert.rejects(f.service.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId }), /记录不存在/);
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal((await f.inject(value)).pendingPersistence?.terminal?.kind, 'injected');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 0);
});

test('a late original protocol rejection releases the fence without guessing from history', async t => {
  const f = await fixture(t), value = f.input();
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('thread/inject_items', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  assert.equal((await f.inject(value)).injection.phase, 'unknown');
  assert.ok(pending); pending.send({ id: pending.id, error: { code: -32602, message: 'fixture rejection' } });
  const result = await eventually(() => f.service.status(value.reference), item => item?.injection.phase === 'rejected');
  assert.deepEqual(result?.injection.terminal, { kind: 'rejected', code: -32602 });
  await f.otherTurn();
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('two consecutive terminal persistence failures retain the same captured receipt for retry', async t => {
  const f = await fixture(t), value = f.input();
  let failures = 0;
  f.checkpoint(step => { if (step === 'file-sync' && failures > 0) { failures--; throw new Error('fixture sync failure'); } });
  f.peer.handlers.set('thread/inject_items', () => { failures = 2; return {}; });
  const initial = await f.inject(value);
  assert.equal(initial.pendingPersistence?.terminal?.kind, 'injected');
  assert.equal((await f.service.status(value.reference))?.injection.phase, 'sending');
  await assert.rejects(f.service.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId }));
  assert.equal((await f.service.status(value.reference))?.pendingPersistence?.terminal?.kind, 'injected');
  const recovered = await f.service.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId });
  assert.equal(recovered?.injection.phase, 'injected'); assert.equal(recovered?.pendingPersistence, null);
  const rebuilt = createSendInjection(f.deps);
  assert.equal((await rebuilt.status(value.reference))?.injection.phase, 'injected');
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal((await f.start(value.reference, 'turn-attempt-1', f.original, rebuilt)).turn.phase, 'accepted');
});

test('a restarted module keeps a lost original result unknown and does not dispatch again', async t => {
  const f = await fixture(t), value = f.input();
  f.peer.handlers.set('thread/inject_items', () => NO_REPLY);
  assert.equal((await f.inject(value)).injection.phase, 'unknown');
  f.first.close();
  const reloaded: Value = {};
  const native = createNativeState({ dataDir: f.root, publish: next => replace(reloaded, next) });
  replace(reloaded, await native.load());
  const mutations = createStateMutations(native.beforeAction);
  const rebuilt = createSendInjection({ mutations, assertStateAvailable: native.assertAvailable, readSection: () => reloaded.sendInjections,
    persistSection: section => native.persist({ ...reloaded, sendInjections: section }),
    assertPreviousOwnerStopped() { assert.equal(f.first.closed, true); assert.equal(f.first.pending.size, 0); } });
  assert.deepEqual(await rebuilt.recoverInterruptedPreparations(), []);
  assert.equal((await rebuilt.status(value.reference))?.injection.phase, 'unknown');
  assert.equal((await rebuilt.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId }))?.injection.phase, 'unknown');
  await assert.rejects(rebuilt.assertCanWrite('host-a', 'thread-a'), /尚未结算/);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 0);
});

test('an explicitly rejected turn continues under a new attempt without reinjecting', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  f.peer.handlers.set('turn/start', () => { throw Object.assign(new Error('fixture rejection'), { code: -32602 }); });
  const rejected = await f.start(value.reference);
  assert.equal(rejected.turn.phase, 'rejected');
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal((await f.start(value.reference)).turn.phase, 'rejected');
  assert.equal(f.peer.calls('turn/start').length, 1);
  f.peer.handlers.set('turn/start', () => ({ turn: fixtureTurn('new-turn', [], 'inProgress') }));
  const accepted = await f.start(value.reference, 'turn-attempt-2');
  assert.equal(accepted.turn.phase, 'accepted');
  assert.deepEqual(accepted.turn.attempts, ['turn-attempt-1', 'turn-attempt-2']);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 2);
});

test('an old socket response cannot settle a newer original turn attempt', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  let old: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('turn/start', (_params, context) => { old = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  assert.equal((await f.start(value.reference)).turn.phase, 'unknown');
  assert.ok(old); old.send({ id: old.id, error: { code: -32602, message: 'old rejection' } });
  await eventually(() => f.service.status(value.reference), item => item?.turn.phase === 'rejected');
  let next: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('turn/start', (_params, context) => { next = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  const starting = f.start(value.reference, 'turn-attempt-2');
  await f.peer.waitForCall('turn/start', 2);
  old.send({ id: old.id, result: { turn: fixtureTurn('old-turn', [], 'inProgress') } });
  const during = await f.service.status(value.reference);
  assert.equal(during?.turn.attemptId, 'turn-attempt-2'); assert.equal(during?.turn.phase, 'sending');
  assert.ok(next); next.send({ id: next.id, result: { turn: fixtureTurn('actual-turn', [], 'inProgress') } });
  const accepted = await starting;
  assert.equal(accepted.turn.phase, 'accepted');
  assert.equal((accepted.turn.terminal as { kind: 'accepted'; result: { turn: { id: string } } }).result.turn.id, 'actual-turn');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('idle is read from the original connection without holding native-state while awaiting', async t => {
  const f = await fixture(t), value = f.input();
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('thread/read', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  const starting = f.inject(value);
  await f.peer.waitForCall('thread/read');
  await f.mutations.run(() => f.native.persist({ ...f.state, settings: { theme: 'updated' } }));
  assert.equal((await f.disk()).settings && ((await f.disk()).settings as Value).theme, 'updated');
  assert.ok(pending); pending.send({ id: pending.id, result: { thread: fixtureThread('thread-a', f.root) } });
  assert.equal((await starting).injection.phase, 'injected');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('revoking the original page during idle read prevents the actual injection', async t => {
  const f = await fixture(t), value = f.input();
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('thread/read', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  const starting = f.inject(value);
  await f.peer.waitForCall('thread/read');
  f.grant('page-a', f.second, 'generation-b', 'draft-a');
  assert.ok(pending); pending.send({ id: pending.id, result: { thread: fixtureThread('thread-a', f.root) } });
  assert.deepEqual((await starting).injection.terminal, { kind: 'not-sent', reason: 'original-changed' });
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  await f.otherTurn();
});

test('mutating the supplied connection object cannot move an in-flight attempt to another socket', async t => {
  const f = await fixture(t), value = f.input();
  let pending: { id: string | number; send(value: unknown): void; socket: WebSocket } | undefined;
  f.peer.handlers.set('thread/read', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  f.peer.handlers.set('thread/inject_items', (_params, context) => { assert.equal(context.socket, pending?.socket); return {}; });
  const starting = f.inject(value);
  await f.peer.waitForCall('thread/read');
  assert.ok(f.second.socket); f.original.connection = f.second; f.original.socket = f.second.socket; f.original.generation = 'generation-b';
  assert.ok(pending); pending.send({ id: pending.id, result: { thread: fixtureThread('thread-a', f.root) } });
  assert.equal((await starting).injection.phase, 'injected');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('busy or malformed idle response prevents injection and preserves exact not-sent receipt', async t => {
  const f = await fixture(t), value = f.input();
  f.peer.handlers.set('thread/read', () => ({ thread: fixtureThread('thread-a', f.root, { status: { type: 'active', activeFlags: [] } }) }));
  const result = await f.inject(value);
  assert.deepEqual(result.injection.terminal, { kind: 'not-sent', reason: 'idle-unconfirmed' });
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  await f.otherTurn();
});

test('reservation failures never send and the captured not-sent receipt can be persisted', async t => {
  const f = await fixture(t), value = f.input();
  let fail = true;
  f.checkpoint(step => { if (step === 'file-sync' && fail) { fail = false; throw new Error('fixture reservation failure'); } });
  const result = await f.inject(value);
  assert.deepEqual(result.pendingPersistence?.terminal, { kind: 'not-sent', reason: 'storage-failed' });
  assert.deepEqual((await f.inject(value)).pendingPersistence?.terminal, result.pendingPersistence?.terminal);
  await assert.rejects(f.inject(f.input(f.reference('2'))), /请先补存/);
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  const saved = await f.service.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId });
  assert.equal(saved?.injection.phase, 'not-sent'); assert.equal(saved?.pendingPersistence, null);
  await f.otherTurn();
});

test('a failed turn reservation cannot dispatch its old or a new attempt before receipt persistence', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  let fail = true;
  f.checkpoint(step => { if (step === 'file-sync' && fail) { fail = false; throw new Error('fixture turn reservation failure'); } });
  const failed = await f.start(value.reference);
  assert.deepEqual(failed.pendingPersistence?.terminal, { kind: 'not-sent', reason: 'storage-failed' });
  assert.deepEqual((await f.start(value.reference)).pendingPersistence?.terminal, failed.pendingPersistence?.terminal);
  await assert.rejects(f.start(value.reference, 'turn-attempt-2'), /请先补存/);
  assert.equal(f.peer.calls('turn/start').length, 0);
  assert.equal((await f.service.retryPersistence(value.reference, { step: 'turn', attemptId: 'turn-attempt-1' }))?.turn.phase, 'not-sent');
  assert.equal((await f.start(value.reference)).turn.phase, 'not-sent');
  assert.equal((await f.start(value.reference, 'turn-attempt-2')).turn.phase, 'accepted');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 1);
});

test('a reservation rename followed by failed directory sync is recovered as not sent', async t => {
  const f = await fixture(t), value = f.input();
  let fail = true;
  f.checkpoint(step => { if (step === 'directory-sync' && fail) { fail = false; throw new Error('fixture directory sync failure'); } });
  const failed = await f.inject(value);
  assert.deepEqual(failed.pendingPersistence?.terminal, { kind: 'not-sent', reason: 'storage-failed' });
  assert.equal((await f.inject(value)).injection.phase, 'preparing');
  assert.equal(f.peer.calls('thread/read').length, 0);
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  assert.equal((await f.service.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId }))?.injection.phase, 'not-sent');
  await f.otherTurn();
});

test('a sending-stage rename failure is settled as not sent without an idle or write request', async t => {
  const f = await fixture(t), value = f.input();
  let directories = 0;
  f.checkpoint(step => { if (step === 'directory-sync' && ++directories === 2) throw new Error('fixture second directory sync failure'); });
  const failed = await f.inject(value);
  assert.deepEqual(failed.injection.terminal, { kind: 'not-sent', reason: 'storage-failed' });
  assert.equal(f.peer.calls('thread/read').length, 0);
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  const rebuilt = createSendInjection(f.deps);
  assert.equal((await rebuilt.status(value.reference))?.injection.phase, 'not-sent');
  await f.otherTurn();
});

test('the durable sending stage precedes the last idle read, with no file commit before dispatch', async t => {
  const f = await fixture(t), value = f.input(), order: string[] = [];
  f.checkpoint(step => { if (step === 'file-sync') order.push('file-sync'); });
  f.peer.handlers.set('thread/read', () => { order.push('thread/read'); return { thread: fixtureThread('thread-a', f.root) }; });
  f.peer.handlers.set('thread/inject_items', () => { order.push('thread/inject_items'); return {}; });
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  assert.deepEqual(order.slice(0, 4), ['file-sync', 'file-sync', 'thread/read', 'thread/inject_items']);
});

test('an unclassified daemon error stays unknown and cannot authorize a second writer', async t => {
  const f = await fixture(t), value = f.input();
  f.peer.handlers.set('thread/inject_items', () => { throw Object.assign(new Error('fixture application error'), { code: -32000 }); });
  assert.equal((await f.inject(value)).injection.phase, 'unknown');
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal((await f.inject(value)).injection.phase, 'unknown');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('a malformed daemon error does not count as an explicit rejection', async t => {
  const f = await fixture(t), value = f.input();
  f.peer.handlers.set('thread/inject_items', (_params, context) => {
    context.send({ id: context.message.id, error: { code: -32602 } }); return NO_REPLY;
  });
  assert.equal((await f.inject(value)).injection.phase, 'unknown');
  await assert.rejects(f.otherTurn(), /尚未结算/);
});

test('a retained original receipt can be persisted after the original socket has closed', async t => {
  const f = await fixture(t), value = f.input();
  let failures = 0;
  f.checkpoint(step => { if (step === 'file-sync' && failures > 0) { failures--; throw new Error('fixture sync failure'); } });
  f.peer.handlers.set('thread/inject_items', () => { failures = 1; return {}; });
  assert.equal((await f.inject(value)).pendingPersistence?.terminal?.kind, 'injected');
  f.first.close();
  const result = await f.service.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId });
  assert.equal(result?.injection.phase, 'injected');
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('a stale retry cannot persist a newer turn attempt receipt', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  f.peer.handlers.set('turn/start', () => { throw Object.assign(new Error('fixture rejection'), { code: -32602 }); });
  assert.equal((await f.start(value.reference)).turn.phase, 'rejected');
  let failures = 0;
  f.checkpoint(step => { if (step === 'file-sync' && failures > 0) { failures--; throw new Error('fixture sync failure'); } });
  f.peer.handlers.set('turn/start', () => { failures = 1; return { turn: fixtureTurn('accepted-second', [], 'inProgress') }; });
  const second = await f.start(value.reference, 'turn-attempt-2');
  assert.equal(second.pendingPersistence?.attemptId, 'turn-attempt-2');
  const stale = await f.service.retryPersistence(value.reference, { step: 'turn', attemptId: 'turn-attempt-1' });
  assert.equal(stale?.pendingPersistence?.attemptId, 'turn-attempt-2');
  assert.equal(stale?.turn.phase, 'sending');
  const saved = await f.service.retryPersistence(value.reference, { step: 'turn', attemptId: 'turn-attempt-2' });
  assert.equal(saved?.turn.phase, 'accepted');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 2);
});

test('late receipt and failed persistence notify the original identity without exposing payload', async t => {
  const f = await fixture(t), value = f.input();
  const notifications: { reference: SendInjectionReference; step: string; attemptId: string }[] = [];
  const service = createSendInjection({ ...f.deps, onChange(reference, receipt) {
    notifications.push({ reference, ...receipt });
    throw new Error('fixture notification failure');
  } });
  let pending: { id: string | number; send(value: unknown): void } | undefined, failures = 0;
  f.checkpoint(step => { if (step === 'file-sync' && failures > 0) { failures--; throw new Error('fixture sync failure'); } });
  f.peer.handlers.set('thread/inject_items', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  assert.equal((await f.inject(value, f.original, service)).injection.phase, 'unknown');
  failures = 1;
  assert.ok(pending); pending.send({ id: pending.id, result: {} });
  const received = await eventually(() => service.status(value.reference), result => result?.pendingPersistence?.terminal?.kind === 'injected');
  assert.equal(received?.injection.phase, 'unknown');
  assert.deepEqual(notifications.at(-1), { reference: value.reference, step: 'injection', attemptId: value.reference.injectionAttemptId });
  assert.equal((await service.retryPersistence(value.reference, { step: 'injection', attemptId: value.reference.injectionAttemptId }))?.injection.phase, 'injected');
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('the original late turn acceptance releases its fence without another turn', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  let pending: { id: string | number; send(value: unknown): void } | undefined;
  f.peer.handlers.set('turn/start', (_params, context) => { pending = { id: context.message.id!, send: context.send }; return NO_REPLY; });
  assert.equal((await f.start(value.reference)).turn.phase, 'unknown');
  await assert.rejects(f.otherTurn(), /尚未结算/);
  assert.ok(pending); pending.send({ id: pending.id, result: { turn: fixtureTurn('late-turn', [], 'inProgress') } });
  const accepted = await eventually(() => f.service.status(value.reference), item => item?.turn.phase === 'accepted');
  assert.equal(accepted?.turn.terminal?.kind, 'accepted');
  f.peer.handlers.set('turn/start', () => ({ turn: fixtureTurn('other-turn', [], 'inProgress') }));
  await f.otherTurn();
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('turn/start').length, 2);
});

test('complete references and frozen dispatch content are required for lookup or duplicate submission', async t => {
  const f = await fixture(t), value = f.input();
  assert.equal((await f.inject(value)).injection.phase, 'injected');
  await assert.rejects(f.service.status({ ...value.reference, callId: 'different-call' }), /身份不匹配/);
  await assert.rejects(f.service.assertCanWrite('host-a', 'thread-a'), /尚未结算/);
  const changed = f.input(value.reference); changed.turnParams.input = [{ type: 'text', text: 'different' }];
  await assert.rejects(f.inject(changed), /内容已改变/);
  assert.equal(f.peer.calls('thread/inject_items').length, 1);
});

test('only the actual untrusted-input envelope and a nonempty turn may be registered', async t => {
  const f = await fixture(t), badName = f.input(), badOutput = f.input(), emptyTurn = f.input();
  badName.items[0].name = 'different_function';
  badOutput.items[1].output = [{ type: 'function_call', text: 'not context' }];
  emptyTurn.turnParams.input = [];
  await assert.rejects(f.inject(badName), /身份或内容无效/);
  await assert.rejects(f.inject(badOutput), /身份或内容无效/);
  await assert.rejects(f.inject(emptyTurn), /身份或内容无效/);
  assert.equal(f.peer.calls('thread/read').length, 0);
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
});

test('unrecognized durable injection records fail closed without changing the root', async t => {
  const f = await fixture(t), original = { version: 99, operations: [], future: 'preserve' };
  await f.mutations.run(() => f.native.persist({ ...f.state, sendInjections: original }));
  await assert.rejects(f.service.assertCanWrite('host-a', 'thread-a'), /无法安全读取/);
  await assert.rejects(f.inject(f.input()), /无法安全读取/);
  assert.deepEqual((await f.disk()).sendInjections, original);
  assert.equal(f.peer.calls('thread/inject_items').length, 0);
  assert.equal(f.peer.calls('turn/start').length, 0);
});
