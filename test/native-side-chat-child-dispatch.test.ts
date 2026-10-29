import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;
type Deferred = { id: string | number; send(value: unknown): void; socket: WebSocket };

async function page(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/native-host', { origin: url });
  const messages: Message[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  async function until(predicate: (message: Message) => boolean, from = 0) {
    const signal = AbortSignal.timeout(6000);
    while (!messages.slice(from).some(predicate)) await once(socket, 'received', { signal });
    return messages.slice(from).find(predicate)!;
  }
  let sequence = 0;
  function rpc(method: string, params: Message, extra: Message = {}) {
    const id = ++sequence;
    socket.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', ...extra, request: { id, method, params } }));
    return until(message => message.type === 'mcp-response' && message.message.id === id && !message.late);
  }
  function host(endpoint: string, params: Message) {
    const requestId = `host-${++sequence}`;
    socket.send(JSON.stringify({ type: 'fetch', requestId, url: `vscode://codex/${endpoint}`, body: JSON.stringify(params) }));
    return until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  return { socket, messages, until, rpc, host };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'sc-'));
  const fake = await createFakeCodex(root), assets = await nativeFixture(root);
  await mkdir(join(root, 'codex'));
  let commitGate: { entered(): void; wait: Promise<void> } | undefined;
  const app = await createNativeWorkbench({ ...assets, port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, async nativeStateCheckpoint(step) {
      if (step === 'file-sync' && commitGate) { const gate = commitGate; commitGate = undefined; gate.entered(); await gate.wait; }
    } });
  const pages: WebSocket[] = [];
  t.after(async () => {
    for (const socket of pages) socket.terminate();
    fake.disconnectAll(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  });
  const connect = async () => { const client = await page(app.url); pages.push(client.socket); return client; };
  const parent = fixtureThread('parent-a', root, { model: 'peer-model', modelProvider: 'peer' });
  const child = fixtureThread('child-a', root, { model: 'peer-model', modelProvider: 'peer', ephemeral: true, forkedFromId: 'parent-a' });
  fake.threads.set(parent.id, parent); fake.loaded.add(parent.id);
  const response = (isChild: boolean) => ({ thread: isChild ? child : parent, cwd: root, runtimeWorkspaceRoots: [root],
    model: 'peer-model', modelProvider: 'peer', reasoningEffort: null, serviceTier: null,
    approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null });
  fake.handlers.set('thread/start', () => response(false));
  fake.handlers.set('thread/fork', () => { fake.threads.set(child.id, child); fake.loaded.add(child.id); return response(true); });
  fake.handlers.set('config/read', () => ({ config: { developer_instructions: null } }));
  fake.handlers.set('thread/inject_items', () => ({}));
  const a = await connect();
  assert.ok((await a.rpc('thread/start', { cwd: root })).message.result);
  const base = { hostId: 'local', parentThreadId: parent.id }, prepared = await a.host('side-chat', {
    ...base, action: 'prepare', prepareId: 'prepare-a', draftId: 'draft-a' });
  assert.equal(prepared.responseType, 'success', JSON.stringify(prepared));
  const identity = { ...base, draftId: 'draft-a', prepareId: 'prepare-a', operationId: prepared.body.view.operationId,
    parentCwd: root, connectionGeneration: prepared.body.connectionGeneration, childThreadId: null as string | null };
  async function challenge(client: typeof a, registrationId: string, command: string, current = identity, forkDispatchId?: string) {
    const result = await client.host('side-chat-browser-authority', { action: 'challenge', registrationId, command,
      identity: current, ...(forkDispatchId ? { forkDispatchId } : {}) });
    assert.equal(result.responseType, 'success', JSON.stringify(result));
    const confirmed = await client.host('side-chat-browser-authority', { action: 'confirm', registrationId, challengeId: result.body.challengeId });
    assert.equal(confirmed.responseType, 'success', JSON.stringify(confirmed));
    return result.body as { registrationId: string; challengeId: string };
  }
  async function respond(client: typeof a, request: Message) {
    const reply = await client.host('side-chat-browser-authority', { action: 'respond', requestId: request.requestId,
      challengeId: request.challengeId, outcome: 'ready' });
    assert.equal(reply.responseType, 'success', JSON.stringify(reply));
  }
  const grant = await challenge(a, 'registration-a', 'start', identity, 'fork-a');
  const from = a.messages.length;
  const starting = a.host('side-chat', { ...base, action: 'start', operationId: identity.operationId,
    token: prepared.body.token, forkDispatchId: 'fork-a' });
  const childRequest = await a.until(message => message.type === 'side-chat-browser-authority' && message.kind === 'child', from);
  await respond(a, childRequest);
  const started = await starting;
  assert.equal(started.responseType, 'success', JSON.stringify(started));
  assert.equal(started.body.view.fork.status, 'received'); assert.equal(started.body.view.inject.status, 'received');
  identity.childThreadId = child.id;
  const proof = { identity: structuredClone(identity), challengeId: grant.challengeId };
  const daemonConnectionGeneration = identity.connectionGeneration;
  async function revoke(registrationId = grant.registrationId) {
    const reply = await a.host('side-chat-browser-authority', { action: 'revoke', operationId: identity.operationId, registrationId });
    assert.equal(reply.responseType, 'success', JSON.stringify(reply));
  }
  return { root, fake, app, a, connect, parent, child, identity, proof, daemonConnectionGeneration,
    started: started.body, challenge, respond, revoke,
    gateNextCommit(gate: { entered(): void; wait: Promise<void> }) { commitGate = gate; } };
}

test('real host accepts the confirmed child and refuses missing, foreign, stale or changed identities', async t => {
  const f = await fixture(t), b = await f.connect();
  const saved = JSON.parse(await readFile(join(f.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(saved.sideChats.operations[f.identity.operationId].endpointFence.active, null);
  f.fake.handlers.set('thread/name/set', () => ({}));
  const send = (client: typeof f.a, threadId: string, sideChat?: unknown) => client.rpc('thread/name/set', { threadId, name: 'fixture' },
    sideChat === undefined ? {} : { sideChat });
  assert.ok((await send(f.a, f.child.id, f.proof)).message.result);
  const bad = [undefined, { ...f.proof, challengeId: 'different' },
    { ...f.proof, identity: { ...f.identity, parentCwd: '/different' } },
    { ...f.proof, identity: { ...f.identity, draftId: 'different' } },
    { ...f.proof, identity: { ...f.identity, connectionGeneration: 'different' } },
    { ...f.proof, identity: { ...f.identity, childThreadId: 'other-child' } }];
  for (const proof of bad) {
    const reply = await send(f.a, f.child.id, proof);
    assert.equal(reply.message.error?.data?.uncertain, false, JSON.stringify(reply));
  }
  assert.ok((await send(b, f.child.id, f.proof)).message.error);
  assert.ok((await send(f.a, 'other-child', f.proof)).message.error);
  assert.ok((await send(f.a, f.parent.id)).message.result);
  assert.equal(f.fake.calls('thread/name/set').length, 2);
});

test('a queued old child write stays rejected after revoke and same-identity reauthorization', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('turn/start', (_params, context) => {
    if (!pending) { pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY; }
    return { turn: fixtureTurn('new-turn', [], 'inProgress') };
  });
  const send = (id: string, proof = f.proof) => f.a.rpc('turn/start', { threadId: f.child.id, input: [], clientUserMessageId: id },
    { sideChat: proof, daemonConnectionGeneration: f.daemonConnectionGeneration });
  const first = send('first'); await f.fake.waitForCall('turn/start');
  const old = send('old-queued');
  await f.revoke();
  const nextGrant = await f.challenge(f.a, 'registration-b', 'retry', f.identity);
  assert.equal(f.fake.calls('turn/start').length, 1);
  assert.ok(pending); pending.send({ id: pending.id, result: { turn: fixtureTurn('first-turn', [], 'inProgress') } });
  assert.ok((await first).message.result);
  const rejected = await old;
  assert.equal(rejected.message.error?.data?.uncertain, false, JSON.stringify(rejected));
  assert.equal(f.fake.calls('turn/start').length, 1);
  assert.ok((await send('fresh', { identity: structuredClone(f.identity), challengeId: nextGrant.challengeId })).message.result);
  assert.equal(f.fake.calls('turn/start').length, 2);
});

test('a new daemon socket cannot authorize a queued request or revive its original grant', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('turn/start', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const send = (id: string, generation = f.daemonConnectionGeneration) => f.a.rpc('turn/start',
    { threadId: f.child.id, input: [], clientUserMessageId: id }, { sideChat: f.proof, daemonConnectionGeneration: generation });
  const first = send('first'); await f.fake.waitForCall('turn/start');
  const queued = send('queued'); await f.a.host('locale-info', {});
  assert.ok(pending); pending.socket.terminate();
  assert.equal((await first).message.error?.data?.uncertain, true);
  assert.equal((await queued).message.error?.data?.uncertain, false);
  const from = f.a.messages.length;
  assert.ok((await f.a.rpc('thread/read', { threadId: f.child.id })).message.result);
  const connected = await f.a.until(message => message.type === 'codex-app-server-connection-changed'
    && message.hostId === 'local' && message.state === 'connected', from);
  assert.notEqual(connected.daemonConnectionGeneration, f.daemonConnectionGeneration);
  assert.equal((await send('new-socket', connected.daemonConnectionGeneration)).message.error?.data?.uncertain, false);
  assert.equal(f.fake.calls('turn/start').length, 1);
});

test('a queued child write cannot pass an actual close intent while the preceding write is still in flight', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('turn/start', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const send = (id: string) => f.a.rpc('turn/start', { threadId: f.child.id, input: [], clientUserMessageId: id },
    { sideChat: f.proof, daemonConnectionGeneration: f.daemonConnectionGeneration });
  const first = send('first'); await f.fake.waitForCall('turn/start');
  const old = send('after-close');
  await f.revoke();
  await f.challenge(f.a, 'registration-close', 'close', f.identity);
  let from = f.a.messages.length;
  const closing = f.a.host('side-chat', { hostId: 'local', parentThreadId: 'parent-a', action: 'close',
    operationId: f.identity.operationId, token: f.started.token });
  const barrier = await f.a.until(message => message.type === 'side-chat-browser-authority' && message.kind === 'close', from);
  await f.respond(f.a, barrier);
  assert.equal(f.fake.calls('turn/start').length, 1);
  assert.ok(pending); pending.send({ id: pending.id, result: { turn: fixtureTurn('first-turn', [], 'inProgress') } });
  assert.ok((await first).message.result);
  const rejected = await old;
  assert.equal(rejected.message.error?.data?.uncertain, false, JSON.stringify(rejected));
  from = f.a.messages.indexOf(barrier) + 1;
  const cleanup = await f.a.until(message => message.type === 'side-chat-browser-authority' && message.kind === 'cleanup', from);
  await f.respond(f.a, cleanup);
  const closed = await closing;
  assert.equal(closed.responseType, 'success', JSON.stringify(closed)); assert.equal(closed.body.view.close.status, 'closed');
  assert.equal(f.fake.calls('turn/start').length, 1); assert.equal(f.fake.calls('thread/unsubscribe').length, 1);
});

test('a confirmed grant for one real child cannot write a different real child', async t => {
  const f = await fixture(t);
  const child = fixtureThread('child-b', f.root, { model: 'peer-model', modelProvider: 'peer', ephemeral: true, forkedFromId: 'parent-a' });
  f.fake.handlers.set('thread/fork', () => {
    f.fake.threads.set(child.id, child); f.fake.loaded.add(child.id);
    return { thread: child, cwd: f.root, runtimeWorkspaceRoots: [f.root], model: 'peer-model', modelProvider: 'peer',
      reasoningEffort: null, serviceTier: null, approvalPolicy: 'on-request', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null };
  });
  const base = { hostId: 'local', parentThreadId: 'parent-a' };
  const prepared = await f.a.host('side-chat', { ...base, action: 'prepare', prepareId: 'prepare-b', draftId: 'draft-b' });
  assert.equal(prepared.responseType, 'success', JSON.stringify(prepared));
  const identity = { ...base, draftId: 'draft-b', prepareId: 'prepare-b', operationId: prepared.body.view.operationId,
    parentCwd: f.root, connectionGeneration: prepared.body.connectionGeneration, childThreadId: null as string | null };
  const grant = await f.challenge(f.a, 'registration-b', 'start', identity, 'fork-b');
  const from = f.a.messages.length;
  const starting = f.a.host('side-chat', { ...base, action: 'start', operationId: identity.operationId,
    token: prepared.body.token, forkDispatchId: 'fork-b' });
  const request = await f.a.until(message => message.type === 'side-chat-browser-authority' && message.kind === 'child', from);
  await f.respond(f.a, request);
  assert.equal((await starting).body.view.inject.status, 'received');
  identity.childThreadId = child.id;
  f.fake.handlers.set('thread/name/set', () => ({}));
  const wrong = await f.a.rpc('thread/name/set', { threadId: child.id, name: 'wrong' }, { sideChat: f.proof });
  assert.ok(wrong.message.error); assert.equal(f.fake.calls('thread/name/set').length, 0);
  const right = await f.a.rpc('thread/name/set', { threadId: child.id, name: 'right' },
    { sideChat: { identity, challengeId: grant.challengeId } });
  assert.ok(right.message.result); assert.equal(f.fake.calls('thread/name/set').length, 1);
});

test('queue edit rechecks the original child after its actual list response', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  const entry = { id: 'queued-a', clientUserMessageId: 'queued-client', input: [{ type: 'text', text: 'fixture' }] };
  f.fake.handlers.set('thread/queue/list', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const editing = f.a.host('queue-edit', { hostId: 'local', threadId: f.child.id, entry,
    daemonConnectionGeneration: f.daemonConnectionGeneration, sideChat: f.proof });
  await f.fake.waitForCall('thread/queue/list'); await f.revoke();
  assert.ok(pending); pending.send({ id: pending.id, result: { data: [entry], nextCursor: null } });
  const result = await editing;
  assert.equal(result.responseType, 'error'); assert.equal(result.uncertain, false);
  assert.equal(f.fake.calls('thread/queue/delete').length, 0);
});

test('an issued queue deletion remains uncertain after the daemon socket closes', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  const entry = { id: 'queued-a', clientUserMessageId: 'queued-client', input: [{ type: 'text', text: 'fixture' }] };
  f.fake.handlers.set('thread/queue/list', () => ({ data: [entry], nextCursor: null }));
  f.fake.handlers.set('thread/queue/delete', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const editing = f.a.host('queue-edit', { hostId: 'local', threadId: f.child.id, entry,
    daemonConnectionGeneration: f.daemonConnectionGeneration, sideChat: f.proof });
  await f.fake.waitForCall('thread/queue/delete');
  assert.ok(pending); pending.socket.terminate();
  const result = await editing;
  assert.equal(result.responseType, 'error'); assert.equal(result.uncertain, true);
  assert.equal(f.fake.calls('thread/queue/delete').length, 1);
});

function editInput(f: Awaited<ReturnType<typeof fixture>>) {
  f.child.turns = [fixtureTurn('source', [{ id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'original' }] }])];
  return { hostId: 'local', threadId: f.child.id, daemonConnectionGeneration: f.daemonConnectionGeneration, sideChat: f.proof,
    operation: 'submit', origin: { hostId: 'local', threadId: f.child.id, turnId: 'source', itemId: 'user' },
    expectedTurnIds: ['source'], clientUserMessageId: 'edited-client', turnParams: { input: [{ type: 'text', text: 'edited' }] } };
}

test('revocation after the original revert preserves the reverted stage and never starts the next turn', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('thread/revert', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const editing = f.a.host('message-edit', editInput(f));
  await f.fake.waitForCall('thread/revert'); await f.revoke();
  assert.ok(pending); f.child.turns = []; pending.send({ id: pending.id, result: { thread: f.child } });
  const reply = await editing;
  assert.equal(reply.responseType, 'success', JSON.stringify(reply)); assert.equal(reply.body.stage, 'reverted');
  assert.equal(f.fake.calls('thread/revert').length, 1); assert.equal(f.fake.calls('turn/start').length, 0);
});

test('revocation queued in native state before the next edit dispatch preserves the reverted stage', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('thread/revert', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const editing = f.a.host('message-edit', editInput(f));
  await f.fake.waitForCall('thread/revert');
  let entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  f.gateNextCommit({ entered, wait });
  const setting = f.a.host('set-setting', { key: 'fixture-checkpoint', value: true });
  try {
    await blocked;
    const revoking = f.revoke();
    await f.a.host('locale-info', {});
    assert.ok(pending); f.child.turns = [];
    const from = f.a.messages.length;
    pending.send({ id: pending.id, result: { thread: f.child } });
    pending.send({ method: 'fixture/after-revert', params: {} });
    await f.a.until(message => message.type === 'mcp-notification' && message.method === 'fixture/after-revert', from);
    assert.equal(f.fake.calls('turn/start').length, 0);
    release();
    assert.equal((await setting).responseType, 'success'); await revoking;
    const reply = await editing;
    assert.equal(reply.responseType, 'success', JSON.stringify(reply)); assert.equal(reply.body.stage, 'reverted');
    assert.equal(f.fake.calls('thread/revert').length, 1); assert.equal(f.fake.calls('turn/start').length, 0);
  } finally { release(); }
});

test('an already issued message revert remains unknown on daemon disconnect', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('thread/revert', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const editing = f.a.host('message-edit', editInput(f));
  await f.fake.waitForCall('thread/revert');
  assert.ok(pending); pending.socket.terminate();
  const reply = await editing;
  assert.equal(reply.responseType, 'success', JSON.stringify(reply)); assert.equal(reply.body.stage, 'revertUnknown');
  assert.equal(f.fake.calls('thread/revert').length, 1); assert.equal(f.fake.calls('turn/start').length, 0);
});

function injectionInput(f: Awaited<ReturnType<typeof fixture>>) {
  const reference = { hostId: 'local', threadId: f.child.id, intentId: 'intent-a', injectionAttemptId: 'inject-a', callId: 'call-a',
    clientUserMessageId: 'client-a', owner: { hostId: 'local', threadId: f.child.id, draftId: f.identity.draftId },
    revision: 'revision-a', connectionGeneration: f.daemonConnectionGeneration };
  return { hostId: 'local', action: 'inject', daemonConnectionGeneration: f.daemonConnectionGeneration, sideChat: f.proof, reference,
    items: [{ type: 'function_call', call_id: reference.callId, name: 'untrusted_input', arguments: '{}' },
      { type: 'function_call_output', call_id: reference.callId, output: [{ type: 'input_text', text: 'fixture' }] }],
    turnParams: { threadId: f.child.id, clientUserMessageId: reference.clientUserMessageId, input: [{ type: 'text', text: 'fixture' }] } };
}

test('omitting child proof cannot bypass the queue, message edit or injection host endpoints', async t => {
  const f = await fixture(t);
  const entry = { id: 'queued-a', clientUserMessageId: 'queued-client', input: [{ type: 'text', text: 'fixture' }] };
  const queue = await f.a.host('queue-edit', { hostId: 'local', threadId: f.child.id, entry,
    daemonConnectionGeneration: f.daemonConnectionGeneration });
  assert.equal(queue.responseType, 'error'); assert.equal(queue.uncertain, false);
  const { sideChat: _editProof, ...edit } = editInput(f);
  const edited = await f.a.host('message-edit', edit);
  assert.equal(edited.responseType, 'success'); assert.equal(edited.body.stage, 'prepared');
  const { sideChat: _injectionProof, ...injection } = injectionInput(f);
  const injected = await f.a.host('send-injection', injection);
  assert.equal(injected.responseType, 'error'); assert.equal(injected.uncertain, false);
  assert.equal(f.fake.calls('thread/queue/list').length, 0);
  assert.equal(f.fake.calls('thread/revert').length, 0);
  assert.equal(f.fake.calls('thread/inject_items').length, 1);
  assert.equal(f.fake.calls('turn/start').length, 0);
});

test('a revoked child injection after idle read is durably not-sent without daemon injection', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('thread/read', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const injecting = f.a.host('send-injection', injectionInput(f));
  await f.fake.waitForCall('thread/read'); await f.revoke();
  assert.ok(pending); pending.send({ id: pending.id, result: { thread: f.child } });
  const reply = await injecting;
  assert.equal(reply.responseType, 'success', JSON.stringify(reply));
  assert.equal(reply.body.injection.phase, 'not-sent'); assert.equal(reply.body.injection.terminal.reason, 'original-changed');
  assert.equal(f.fake.calls('thread/inject_items').length, 1);
});

test('an issued child injection remains unknown after daemon disconnect', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('thread/inject_items', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const injecting = f.a.host('send-injection', injectionInput(f));
  await f.fake.waitForCall('thread/inject_items', 2);
  assert.ok(pending); pending.socket.terminate();
  const reply = await injecting;
  assert.equal(reply.responseType, 'success', JSON.stringify(reply)); assert.equal(reply.body.injection.phase, 'unknown');
  assert.equal(f.fake.calls('thread/inject_items').length, 2); assert.equal(f.fake.calls('turn/start').length, 0);
});

test('a child injection already issued before revoke accepts its original successful receipt', async t => {
  const f = await fixture(t);
  let pending: Deferred | undefined;
  f.fake.handlers.set('thread/inject_items', (_params, context) => {
    pending = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const input = injectionInput(f), injecting = f.a.host('send-injection', input);
  await f.fake.waitForCall('thread/inject_items', 2); await f.revoke();
  assert.ok(pending); pending.send({ id: pending.id, result: {} });
  const reply = await injecting;
  assert.equal(reply.responseType, 'success', JSON.stringify(reply)); assert.equal(reply.body.injection.phase, 'injected');
  const status = await f.a.host('send-injection', { hostId: 'local', action: 'status', reference: input.reference });
  assert.equal(status.responseType, 'success'); assert.equal(status.body.injection.phase, 'injected');
  assert.equal(f.fake.calls('thread/inject_items').length, 2); assert.equal(f.fake.calls('turn/start').length, 0);
});
