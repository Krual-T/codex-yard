import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { SideChatBrowserAuthority, SideChatBrowserCheck } from '../src/native/side-chat-native-parent.ts';
import { SideChatParentReceipts } from '../src/native/side-chat-parent-receipts.ts';
import type { SideChatReceiptSource } from '../src/native/side-chat-parent-receipts.ts';
import { SideChatController } from '../src/renderer/side-chat/controller.ts';
import type { SideChatHostPort, SideChatHostView } from '../src/renderer/side-chat/types.ts';
import type { createSshProxyStream } from '../src/native/ssh.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;

class ShortTimeoutReceipts extends SideChatParentReceipts {
  override begin(source: SideChatReceiptSource, method: Parameters<SideChatParentReceipts['begin']>[1], threadId: string | null) {
    Object.defineProperty(source.connection, 'timeout', { value: 60, configurable: true });
    return super.begin(source, method, threadId);
  }
}

async function page(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/native-host', { origin: url });
  const messages: Message[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  async function until(predicate: (message: Message) => boolean, from = 0) {
    const signal = AbortSignal.timeout(5000);
    while (!messages.slice(from).some(predicate)) await once(socket, 'received', { signal });
    return messages.slice(from).find(predicate)!;
  }
  let nextId = 0;
  async function rpc(method: string, params: Record<string, unknown>, hostId = 'local') {
    const requestId = ++nextId;
    socket.send(JSON.stringify({ type: 'mcp-request', hostId, request: { id: requestId, method, params } }));
    return until(item => item.type === 'mcp-response' && item.message.id === requestId && !item.late);
  }
  async function host(endpoint: string, params: Record<string, unknown>) {
    const requestId = 'host-' + ++nextId;
    socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) }));
    return until(item => item.type === 'fetch-response' && item.requestId === requestId);
  }
  return { socket, messages, until, rpc, host };
}

async function fixture(t: import('node:test').TestContext, enabled = true, timeout = false) {
  const root = await mkdtemp('/tmp/aw-sc-host-');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  const dataDir = join(root, 'data');
  await mkdir(dataDir);
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {}, settings: {}, otherOwner: { preserved: true } }));
  let permitted = true, frozen = false, failDirectorySync = false, failFileSync = false, asynchronousGuard = false;
  let failFinalization = 0;
  let closeGate: Promise<void> | undefined;
  let commitGate: { entered(): void; wait: Promise<void> } | undefined;
  let blockedPhase: SideChatBrowserCheck['phase'] | null = null;
  const checks: SideChatBrowserCheck[] = [], closeCalls: string[] = [];
  const authority: SideChatBrowserAuthority = {
    assertCurrent(scope) {
      checks.push(scope);
      if (!permitted || scope.phase === blockedPhase || scope.draftId !== 'draft-a' || scope.phase === 'unsubscribe' && !frozen) {
        throw new Error('fixture owner revoked');
      }
      if (asynchronousGuard) return Promise.resolve();
    },
    async prepareChild(scope) { if (!permitted || scope.draftId !== 'draft-a') throw new Error('fixture child blocked'); },
    async prepareClose(scope) { if (!permitted || scope.draftId !== 'draft-a') throw new Error('fixture close blocked');
      closeCalls.push('freeze'); await closeGate; frozen = true; },
    async cleanup() { if (!permitted || !frozen) throw new Error('fixture cleanup blocked'); closeCalls.push('cleanup'); frozen = false; },
    ownerStopped: () => false,
  };
  const remote = { hostId: 'remote-ssh-fixture', displayName: 'Fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null };
  const sshStream = ((_host, paths) => { paths?.({ homeDirectory: '/fixture-home', codexHome: '/fixture-home/.codex' });
    return createConnection(fake.socketPath); }) as typeof createSshProxyStream;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir,
    workspace: root, renderer, adapterPath, hostCatalog: { hosts: [remote], projects: [], assignments: {} }, sshStream,
    ...(enabled ? { sideChatBrowserAuthority: authority } : {}), ...(timeout ? { sideChatParentReceipts: new ShortTimeoutReceipts() } : {}),
    async nativeStateCheckpoint(step) {
      if (step === 'directory-sync' && failDirectorySync) { failDirectorySync = false; throw new Error('fixture confirmation failure'); }
      if (step === 'file-sync' && failFileSync) { failFileSync = false; throw new Error('fixture receipt persistence failure'); }
      if (step === 'file-sync' && failFinalization) {
        const root = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8'));
        if (Object.values(root.sideChats?.operations ?? {}).some((value: any) => value.inject?.status === 'received'
          && value.endpointFence?.active?.action === 'start')) {
          failFinalization--; throw new Error('fixture active call finalization failure');
        }
      }
      if (step === 'directory-sync' && commitGate) { const gate = commitGate; commitGate = undefined; gate.entered(); return gate.wait; }
    } });
  const pages: WebSocket[] = [];
  t.after(async () => { for (const socket of pages) socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  async function connect() { const result = await page(app.url); pages.push(result.socket); return result; }
  const thread = fixtureThread('parent-a', root);
  fake.threads.set(thread.id, thread); fake.loaded.add(thread.id);
  const response = (child = false) => ({ thread: child ? { ...thread, id: 'child-a', ephemeral: true, forkedFromId: 'parent-a', turns: [] } : thread,
    cwd: root, runtimeWorkspaceRoots: [root], model: 'peer-model', modelProvider: 'peer', reasoningEffort: null, serviceTier: null,
    approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null });
  fake.handlers.set('thread/start', () => response());
  fake.handlers.set('config/read', () => ({ config: { developer_instructions: null } }));
  fake.handlers.set('thread/inject_items', () => ({}));
  return { root, dataDir, fake, connect, response, checks, closeCalls,
    permit(value: boolean) { permitted = value; }, block(phase: SideChatBrowserCheck['phase'] | null) { blockedPhase = phase; },
    failNextCommit() { failDirectorySync = true; }, failNextFileCommit() { failFileSync = true; },
    failFinalization(count: number) { failFinalization = count; },
    gateNextCommit(value: { entered(): void; wait: Promise<void> }) { commitGate = value; },
    setCloseGate(value: Promise<void> | undefined) { closeGate = value; }, asynchronous(value: boolean) { asynchronousGuard = value; } };
}

const identity = { hostId: 'local', parentThreadId: 'parent-a' };
const prepared = { ...identity, action: 'prepare', prepareId: 'prepare-a', draftId: 'draft-a' };
const action = (view: Message, name: string, extra: Record<string, unknown> = {}) => ({ ...identity, action: name,
  operationId: view.view.operationId, token: view.token, ...extra });
async function eventually(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('expected asynchronous side-chat result');
}

test('real host prepares and restores the same native-state operation but requires browser authority to dispatch', async t => {
  const f = await fixture(t, false), a = await f.connect();
  assert.ok((await a.rpc('thread/start', { cwd: f.root })).message.result);
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'success');
  assert.equal(first.body.view.fork.status, 'waiting');
  assert.equal(typeof first.body.connectionGeneration, 'string');
  const lookup = await a.host('side-chat', { ...identity, action: 'readPrepared', prepareId: prepared.prepareId });
  assert.equal(lookup.body.view.operationId, first.body.view.operationId);
  assert.equal(lookup.body.connectionGeneration, first.body.connectionGeneration);
  assert.equal(Object.hasOwn(lookup.body, 'token'), false);
  assert.equal((await a.host('side-chat', { ...identity, action: 'readPrepared', prepareId: 'missing' })).body, null);
  const duplicate = await a.host('side-chat', prepared);
  assert.equal(duplicate.body.view.operationId, first.body.view.operationId);
  const state = JSON.parse(await readFile(join(f.dataDir, 'native-state.json'), 'utf8'));
  assert.deepEqual(state.otherOwner, { preserved: true });
  assert.equal(state.sideChats.prepared['prepare-a'], first.body.view.operationId);
  assert.equal(Object.keys(state.sideChats.operations).length, 1);
  assert.equal((await a.host('pet-overlay', { message: { type: 'avatar-overlay-open', isOpen: false } })).responseType, 'success');
  assert.ok(JSON.parse(await readFile(join(f.dataDir, 'native-state.json'), 'utf8')).sideChats.operations[first.body.view.operationId]);
  const denied = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'dispatch-a' }));
  assert.equal(denied.responseType, 'error'); assert.equal(denied.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
  const read = await a.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  assert.equal(read.body.view.fork.status, 'waiting');
});

test('the real endpoint does not transfer an operation between two host connections', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const local = await a.host('side-chat', prepared);
  await a.rpc('thread/start', { cwd: f.root }, 'remote-ssh-fixture');
  const remote = await a.host('side-chat', { ...prepared, hostId: 'remote-ssh-fixture', prepareId: 'prepare-remote' });
  assert.equal(local.responseType, 'success'); assert.equal(remote.responseType, 'success');
  assert.notEqual(local.body.view.operationId, remote.body.view.operationId);
  const wrongHost = await a.host('side-chat', { ...action(local.body, 'start', { forkDispatchId: 'wrong-host' }),
    hostId: 'remote-ssh-fixture' });
  assert.equal(wrongHost.responseType, 'error'); assert.equal(wrongHost.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('an unconfirmed native-state prepare is reconciled under the original prepare identity', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  f.failNextCommit();
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'error'); assert.equal(first.uncertain, true);
  const retried = await a.host('side-chat', prepared);
  assert.equal(retried.responseType, 'success');
  const state = JSON.parse(await readFile(join(f.dataDir, 'native-state.json'), 'utf8'));
  assert.equal(state.sideChats.prepared['prepare-a'], retried.body.view.operationId);
  assert.equal(Object.keys(state.sideChats.operations).length, 1);
  assert.deepEqual(state.otherOwner, { preserved: true });
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('a lost prepare cannot gain new project authority but its original operation remains readable', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  f.failNextCommit();
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'error'); assert.equal(first.uncertain, true);
  assert.equal((await a.host('project-add', { hostId: 'local', path: f.root, name: 'Fixture' })).responseType, 'success');
  assert.equal((await a.host('thread-projects', { operation: 'setMembership', value: { hostId: 'local', threadId: 'parent-a',
    assignment: { projectKind: 'local', projectId: f.root }, projectless: false } })).responseType, 'success');
  const repeated = await a.host('side-chat', prepared);
  assert.equal(repeated.responseType, 'error'); assert.equal(repeated.uncertain, true);
  const state = JSON.parse(await readFile(join(f.dataDir, 'native-state.json'), 'utf8'));
  const b = await f.connect();
  const lookup = await b.host('side-chat', { ...identity, action: 'readPrepared', prepareId: 'prepare-a' });
  assert.equal(lookup.responseType, 'success');
  const operationId = lookup.body.view.operationId;
  assert.equal(state.sideChats.prepared['prepare-a'], operationId);
  assert.equal((await b.host('side-chat', { hostId: 'local', parentThreadId: 'wrong', action: 'readPrepared', prepareId: 'prepare-a' })).responseType, 'error');
  assert.equal(Object.keys(state.sideChats.operations).length, 1);
  const original = await a.host('side-chat', { ...identity, action: 'read', operationId });
  assert.equal(original.responseType, 'success');
  assert.equal(original.body.view.fork.status, 'waiting');
  const denied = await a.host('side-chat', action(original.body, 'start', { forkDispatchId: 'after-project-change' }));
  assert.equal(denied.responseType, 'error'); assert.equal(denied.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('a slow original directory request does not block other native-state operations', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/list', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const pending = a.host('side-chat', prepared);
  await f.fake.waitForCall('thread/list');
  assert.ok(delayed);
  const setting = await b.host('get-setting', { key: 'pet-visibility' });
  assert.equal(setting.responseType, 'success');
  const absent = await b.host('side-chat', { ...identity, action: 'readPrepared', prepareId: prepared.prepareId });
  assert.equal(absent.responseType, 'success'); assert.equal(absent.body, null);
  delayed.send({ id: delayed.id, result: { data: [{ id: 'parent-a' }], nextCursor: null } });
  const completed = await pending;
  assert.equal(completed.responseType, 'success');
  const found = await b.host('side-chat', { ...identity, action: 'readPrepared', prepareId: prepared.prepareId });
  assert.equal(found.body.view.operationId, completed.body.view.operationId);
});

test('a committed prepare whose daemon settings authority changes is uncertain and recoverable by its prepare identity', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  await b.rpc('model/list', {});
  let entered!: () => void, release!: () => void;
  const inCommit = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  f.gateNextCommit({ entered, wait: gate });
  const preparing = a.host('side-chat', prepared);
  await inCommit;
  // A Yard write now waits for the same native-state fence, so it cannot be
  // awaited while that fence is deliberately held here. An external daemon
  // update can still revoke the original receipt during its disk commit.
  const from = a.messages.length;
  f.fake.broadcast({ method: 'thread/settings/updated', params: { threadId: 'parent-a', approvalPolicy: 'never' } });
  await a.until(item => item.type === 'mcp-notification' && item.method === 'thread/settings/updated', from);
  release();
  const result = await preparing;
  assert.equal(result.responseType, 'error'); assert.equal(result.uncertain, true);
  const found = await b.host('side-chat', { ...identity, action: 'readPrepared', prepareId: prepared.prepareId });
  assert.equal(found.responseType, 'success'); assert.ok(found.body.view.operationId);
  assert.equal(Object.hasOwn(found.body, 'token'), false);
  const state = JSON.parse(await readFile(join(f.dataDir, 'native-state.json'), 'utf8'));
  assert.equal(state.sideChats.prepared[prepared.prepareId], found.body.view.operationId);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('a delayed directory response is rejected after the original parent settings change', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  await b.rpc('model/list', {});
  f.fake.handlers.set('thread/settings/update', () => ({}));
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/list', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const preparing = a.host('side-chat', prepared);
  await f.fake.waitForCall('thread/list');
  assert.ok((await b.rpc('thread/settings/update', { threadId: 'parent-a', approvalPolicy: 'never' })).message.result);
  assert.ok(delayed); delayed.send({ id: delayed.id, result: { data: [{ id: 'parent-a' }], nextCursor: null } });
  const result = await preparing;
  assert.equal(result.responseType, 'error'); assert.equal(result.uncertain, true);
  assert.equal((await b.host('side-chat', { ...identity, action: 'readPrepared', prepareId: prepared.prepareId })).body, null);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('real endpoint checks page, draft and fork identity at dispatch and closes with one unsubscribe', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'success');
  const otherRead = await b.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  assert.equal(otherRead.body.token, null);
  const otherStart = await b.host('side-chat', action({ ...otherRead.body, token: first.body.token }, 'start', { forkDispatchId: 'dispatch-b' }));
  assert.equal(otherStart.responseType, 'error'); assert.equal(otherStart.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
  const fresh = await a.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
  f.fake.handlers.set('thread/fork', (_params, context) => {
    context.send({ method: 'fixture/before-fork', params: {} });
    context.send({ id: context.message.id, result: f.response(true) });
    context.send({ method: 'fixture/after-fork', params: {} });
    return NO_REPLY;
  });
  const from = a.messages.length;
  const started = await a.host('side-chat', action(fresh.body, 'start', { forkDispatchId: 'dispatch-a' }));
  assert.equal(started.responseType, 'success');
  assert.equal(started.body.view.fork.status, 'received');
  assert.equal(started.body.view.inject.status, 'received');
  assert.equal(started.body.view.fork.receipt.attemptId, 'dispatch-a');
  const later = await a.until(item => item.type === 'mcp-notification' && item.method === 'fixture/after-fork', from);
  assert.equal(started.body.view.fork.receipt.eventCursor, later.seq - 1);
  assert.ok(f.checks.some(check => check.phase === 'fork' && check.attemptId === 'dispatch-a'));
  assert.ok(f.checks.some(check => check.phase === 'inject' && check.draftId === 'draft-a'));
  const sharedUnsubscribe = await a.rpc('thread/unsubscribe', { threadId: 'child-a' });
  assert.ok(sharedUnsubscribe.message.error);
  assert.equal(f.fake.calls('thread/unsubscribe').length, 0);
  f.block('unsubscribe');
  const blockedClose = await a.host('side-chat', action(started.body, 'close'));
  assert.equal(blockedClose.body.view.close.status, 'not-sent');
  assert.equal(f.fake.calls('thread/unsubscribe').length, 0);
  f.block(null);
  const closed = await a.host('side-chat', action(blockedClose.body, 'retry'));
  assert.equal(closed.responseType, 'success'); assert.equal(closed.body.view.close.status, 'closed');
  assert.deepEqual(f.closeCalls, ['freeze', 'freeze', 'cleanup']);
  assert.equal(f.fake.calls('thread/unsubscribe').length, 1);
  assert.equal(f.fake.calls('turn/start').length, 0);
});

test('observations and reconciliation during an active call cannot invalidate its claim', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/fork', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const starting = a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'captured-fork' }));
  await f.fake.waitForCall('thread/fork');
  assert.ok(delayed);
  const other = await b.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  assert.equal(other.responseType, 'success');
  assert.equal(other.body.token, null); assert.equal(other.body.view.settledCalls, undefined);
  const otherReconcile = await b.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
  assert.equal(otherReconcile.body.token, null); assert.equal(otherReconcile.body.view.settledCalls, undefined);
  const activeReconcile = await a.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
  assert.equal(activeReconcile.body.token, null); assert.equal(activeReconcile.body.view.settledCalls, undefined);
  delayed.send({ id: delayed.id, result: f.response(true) });
  const received = await starting;
  assert.equal(received.body.view.fork.status, 'received');
  assert.equal(received.body.view.inject.status, 'received');
  assert.equal(f.fake.calls('thread/fork').length, 1);
  assert.equal(f.fake.calls('thread/inject_items').length, 1);
});

test('idle reconciliation fences a captured but not yet claimed token', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  const oldAction = action(first.body, 'start', { forkDispatchId: 'old-unclaimed' });
  const observed = await b.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  assert.equal(observed.body.token, null); assert.equal(observed.body.view.settledCalls, undefined);
  const reconciled = await a.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
  assert.equal(reconciled.responseType, 'success'); assert.ok(reconciled.body.token);
  assert.notEqual(reconciled.body.token, first.body.token);
  assert.equal(reconciled.body.view.settledCalls.start, true);
  assert.equal(reconciled.body.view.settledCalls.retryPersistence, undefined);
  const old = await a.host('side-chat', oldAction);
  assert.equal(old.responseType, 'error'); assert.equal(old.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
  f.fake.handlers.set('thread/fork', () => f.response(true));
  const started = await a.host('side-chat', action(reconciled.body, 'start', { forkDispatchId: 'new-explicit' }));
  assert.equal(started.body.view.inject.status, 'received');
  assert.equal(f.fake.calls('thread/fork').length, 1);
});

test('only the original page can persist a completed call fence after finalization failures', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  f.fake.handlers.set('thread/fork', () => f.response(true));
  f.failFinalization(2);
  const result = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'completed-original' }));
  assert.equal(result.responseType, 'error'); assert.equal(result.uncertain, true);
  const input = { ...identity, action: 'read', operationId: first.body.view.operationId };
  const observation = await a.host('side-chat', input);
  assert.equal(observation.body.token, null); assert.equal(observation.body.view.settledCalls, undefined);
  assert.equal(observation.body.view.inject.status, 'received');
  const other = await b.host('side-chat', { ...input, purpose: 'reconcile' });
  assert.equal(other.body.token, null); assert.equal(other.body.view.settledCalls, undefined);
  f.failNextFileCommit();
  const failed = await a.host('side-chat', { ...input, purpose: 'reconcile' });
  assert.equal(failed.responseType, 'error'); assert.equal(failed.uncertain, true);
  const afterFailure = await a.host('side-chat', input);
  assert.equal(afterFailure.body.token, null); assert.equal(afterFailure.body.view.settledCalls, undefined);
  const reconciled = await a.host('side-chat', { ...input, purpose: 'reconcile' });
  assert.equal(reconciled.responseType, 'success'); assert.ok(reconciled.body.token);
  assert.equal(reconciled.body.view.settledCalls.start, true);
  assert.equal(reconciled.body.view.inject.status, 'received');
  assert.equal(f.fake.calls('thread/fork').length, 1); assert.equal(f.fake.calls('thread/inject_items').length, 1);
});

test('an unconfirmed reconciliation never returns a proof before native-state recovery', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  const input = { ...identity, action: 'read', operationId: first.body.view.operationId };
  f.failNextCommit();
  const failed = await a.host('side-chat', { ...input, purpose: 'reconcile' });
  assert.equal(failed.responseType, 'error'); assert.equal(failed.uncertain, true);
  const observed = await a.host('side-chat', input);
  assert.equal(observed.body.token, null); assert.equal(observed.body.view.settledCalls, undefined);
  const reconciled = await a.host('side-chat', { ...input, purpose: 'reconcile' });
  assert.equal(reconciled.responseType, 'success'); assert.ok(reconciled.body.token);
  assert.equal(reconciled.body.view.settledCalls.start, true);
  const stale = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'failed-fence-old' }));
  assert.equal(stale.responseType, 'error'); assert.equal(stale.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('two real controllers observe updates without invalidating the original fork or close', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/fork', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  let token = '', generation = '', pendingReads = 0, startFromA = 0, startFromB = 0, hints = 0;
  let startResponseId = '', closeResponseId = '', observations = 0;
  let observer: SideChatController | undefined;
  async function call(name: string, operationId: string, extra: Record<string, unknown> = {}): Promise<SideChatHostView> {
    const reply = await a.host('side-chat', { ...identity, action: name, operationId, token, ...extra });
    if (reply.responseType !== 'success') throw Object.assign(new Error(reply.error), { uncertain: reply.uncertain });
    if (name === 'start') startResponseId = reply.requestId;
    if (name === 'close') closeResponseId = reply.requestId;
    if (reply.body.token) token = reply.body.token;
    return reply.body.view;
  }
  const port: SideChatHostPort = {
    async prepare() {
      const reply = await a.host('side-chat', prepared);
      assert.equal(reply.responseType, 'success'); token = reply.body.token; generation = reply.body.connectionGeneration;
      return reply.body.view;
    },
    async start(id) { startFromA = a.messages.length; startFromB = b.messages.length;
      assert.ok(generation); return call('start', id, { forkDispatchId: 'controller-fork' }); },
    async read(id) { pendingReads++; try { return await call('read', id); } finally { pendingReads--; } },
    async retry(id) { return call('retry', id); },
    async close(id) { return call('close', id); },
    async retryPersistence(id) { return call('retryPersistence', id, { connectionGeneration: generation }); },
    subscribe(listener) {
      const receive = (bytes: WebSocket.RawData) => {
        const message = JSON.parse(String(bytes));
        if (message.type === 'side-chat-updated') { hints++; listener(message); }
      };
      a.socket.on('message', receive); return () => a.socket.off('message', receive);
    },
  };
  const observerPort: SideChatHostPort = {
    async prepare() { throw new Error('unexpected observer prepare'); },
    async start() { throw new Error('unexpected observer start'); },
    async retry() { throw new Error('unexpected observer retry'); },
    async close() { throw new Error('unexpected observer close'); },
    async retryPersistence() { throw new Error('unexpected observer recovery'); },
    async read(operationId) {
      const reply = await b.host('side-chat', { ...identity, action: 'read', purpose: 'observe', operationId });
      assert.equal(reply.responseType, 'success'); assert.equal(reply.body.token, null);
      assert.equal(reply.body.view.settledCalls, undefined); observations++;
      return reply.body.view;
    },
    subscribe(listener) {
      const receive = (bytes: WebSocket.RawData) => {
        const message = JSON.parse(String(bytes));
        if (message.type === 'side-chat-updated') listener(message);
      };
      b.socket.on('message', receive); return () => b.socket.off('message', receive);
    },
  };
  const controller = new SideChatController({ ...identity, draftId: 'draft-a', port,
    async onPrepared(scope) {
      const observed = await observerPort.read(scope.operationId);
      observer = new SideChatController({ ...identity, draftId: 'draft-a', port: observerPort,
        onPrepared: async () => {}, canDispatch: () => false, restored: observed });
      await observer.read();
    },
    canDispatch: () => true });
  t.after(() => { controller.dispose(); observer?.dispose(); });
  const starting = controller.start();
  await f.fake.waitForCall('thread/fork');
  await b.until(item => item.type === 'side-chat-updated', startFromB);
  await eventually(() => observations > 2);
  assert.equal(a.messages.slice(startFromA).filter(item => item.type === 'side-chat-updated').length, 0);
  assert.ok(delayed); delayed.send({ id: delayed.id, result: f.response(true) });
  await starting;
  await eventually(() => controller.getSnapshot().phase === 'ready' && hints > 0 && pendingReads === 0);
  assert.ok(a.messages.findIndex((item, index) => item.type === 'side-chat-updated' && index >= startFromA)
    > a.messages.findIndex(item => item.type === 'fetch-response' && item.requestId === startResponseId));
  assert.equal(f.fake.calls('thread/inject_items').length, 1);

  let releaseClose!: () => void;
  f.setCloseGate(new Promise<void>(resolve => { releaseClose = resolve; }));
  t.after(() => releaseClose());
  const closeFromA = a.messages.length, closeFromB = b.messages.length;
  const closing = controller.close();
  await eventually(() => f.closeCalls.includes('freeze'));
  await b.until(item => item.type === 'side-chat-updated', closeFromB);
  assert.equal(a.messages.slice(closeFromA).filter(item => item.type === 'side-chat-updated').length, 0);
  releaseClose(); await closing;
  await eventually(() => controller.getSnapshot().phase === 'closed');
  await a.until(item => item.type === 'side-chat-updated', closeFromA);
  assert.ok(a.messages.findIndex((item, index) => item.type === 'side-chat-updated' && index >= closeFromA)
    > a.messages.findIndex(item => item.type === 'fetch-response' && item.requestId === closeResponseId));
  assert.equal(f.fake.calls('thread/unsubscribe').length, 1);
  assert.equal(f.fake.calls('thread/fork').length, 1);
  assert.equal(f.fake.calls('turn/start').length, 0);
});

test('unrelated project changes do not revoke dispatch and an existing child can close after parent settings change', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  assert.equal((await a.host('project-add', { hostId: 'local', path: f.root, name: 'Unrelated' })).responseType, 'success');
  assert.equal((await a.host('thread-projects', { operation: 'setMembership', value: { hostId: 'local', threadId: 'other-thread',
    assignment: { projectKind: 'local', projectId: f.root }, projectless: false } })).responseType, 'success');
  f.fake.handlers.set('thread/fork', () => f.response(true));
  const started = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'unrelated-project' }));
  assert.equal(started.responseType, 'success'); assert.equal(started.body.view.inject.status, 'received');
  assert.equal((await a.host('thread-projects', { operation: 'setMembership', value: { hostId: 'local', threadId: 'parent-a',
    assignment: { projectKind: 'local', projectId: f.root }, projectless: false } })).responseType, 'success');
  f.fake.handlers.set('thread/settings/update', () => ({}));
  assert.ok((await a.rpc('thread/settings/update', { threadId: 'parent-a', approvalPolicy: 'never' })).message.result);
  const reconciled = await a.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
  assert.ok(reconciled.body.token);
  const denied = await a.host('side-chat', action(reconciled.body, 'retry'));
  assert.equal(denied.responseType, 'error'); assert.equal(denied.uncertain, false);
  const closed = await a.host('side-chat', action(reconciled.body, 'close'));
  assert.equal(closed.responseType, 'success'); assert.equal(closed.body.view.close.status, 'closed');
  assert.deepEqual(f.closeCalls, ['freeze', 'cleanup']);
  assert.equal(f.fake.calls('thread/unsubscribe').length, 1);
  assert.equal(f.fake.calls('thread/fork').length, 1);
});

test('renaming the assigned project without changing its roots does not revoke its binding', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  assert.equal((await a.host('project-add', { hostId: 'local', path: f.root, name: 'Original' })).responseType, 'success');
  assert.equal((await a.host('thread-projects', { operation: 'setMembership', value: { hostId: 'local', threadId: 'parent-a',
    assignment: { projectKind: 'local', projectId: f.root }, projectless: false } })).responseType, 'success');
  const first = await a.host('side-chat', prepared);
  assert.equal((await a.host('project-add', { hostId: 'local', path: f.root, name: 'Renamed' })).responseType, 'success');
  f.fake.handlers.set('thread/fork', () => f.response(true));
  const started = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'renamed-project' }));
  assert.equal(started.responseType, 'success'); assert.equal(started.body.view.inject.status, 'received');
  assert.equal(f.fake.calls('thread/fork').length, 1);
});

test('another page can persist the captured late fork terminal without acquiring dispatch rights', async t => {
  const f = await fixture(t, true, true), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/fork', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const timedOut = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'late-terminal' }));
  assert.equal(timedOut.body.view.fork.status, 'unknown');
  const recovery = { ...identity, action: 'retryPersistence', operationId: first.body.view.operationId,
    connectionGeneration: first.body.connectionGeneration };
  const stillUnknown = await b.host('side-chat', recovery);
  assert.equal(stillUnknown.body.view.fork.status, 'unknown');
  assert.equal(f.fake.calls('thread/fork').length, 1);
  assert.ok(delayed); const from = b.messages.length;
  f.failNextFileCommit(); delayed.send({ id: delayed.id, result: f.response(true) });
  await b.until(item => item.type === 'side-chat-updated', from);
  const pageClosed = once(a.socket, 'close'); a.socket.terminate(); await pageClosed;
  const found = await b.host('side-chat', { ...identity, action: 'readPrepared', prepareId: prepared.prepareId });
  assert.equal(found.body.view.operationId, first.body.view.operationId);
  assert.equal(found.body.connectionGeneration, first.body.connectionGeneration);
  const otherReconcile = await b.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
  assert.equal(otherReconcile.body.token, null); assert.equal(otherReconcile.body.view.settledCalls, undefined);
  const original = await b.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  assert.equal(original.body.view.fork.status, 'unknown'); assert.ok(original.body.view.recoveryError);
  const wrong = await b.host('side-chat', { ...recovery, connectionGeneration: 'different-connection' });
  assert.equal(wrong.responseType, 'error');
  const saved = await b.host('side-chat', recovery);
  assert.equal(saved.responseType, 'success'); assert.equal(saved.body.token, null);
  assert.equal(saved.body.view.fork.status, 'received'); assert.equal(saved.body.view.inject.status, 'waiting');
  assert.equal(saved.body.view.fork.receipt.attemptId, 'late-terminal');
  assert.equal(saved.body.view.recoveryError, null);
  const repeatedSave = await b.host('side-chat', recovery);
  assert.equal(repeatedSave.responseType, 'success'); assert.equal(repeatedSave.body.view.fork.status, 'received');
  assert.equal(f.fake.calls('thread/fork').length, 1); assert.equal(f.fake.calls('thread/inject_items').length, 0);
  assert.equal(f.fake.calls('thread/unsubscribe').length, 0);
  const read = await b.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  const denied = await b.host('side-chat', action(read.body, 'retry'));
  assert.equal(denied.responseType, 'error'); assert.equal(denied.uncertain, false);
  assert.equal(f.fake.calls('thread/inject_items').length, 0);
});

test('saving a captured close barrier cannot dispatch unsubscribe on a replacement page', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  f.fake.handlers.set('thread/fork', () => f.response(true));
  const started = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'close-barrier' }));
  assert.equal(started.body.view.inject.status, 'received');
  let release!: () => void;
  f.setCloseGate(new Promise<void>(resolve => { release = resolve; }));
  t.after(() => release());
  const closing = a.host('side-chat', action(started.body, 'close'));
  await eventually(() => f.closeCalls.includes('freeze'));
  f.failNextFileCommit(); release();
  const failed = await closing;
  assert.equal(failed.responseType, 'error'); assert.equal(failed.uncertain, true);
  const pageClosed = once(a.socket, 'close'); a.socket.terminate(); await pageClosed;
  const saved = await b.host('side-chat', { ...identity, action: 'retryPersistence', operationId: first.body.view.operationId,
    connectionGeneration: first.body.connectionGeneration });
  assert.equal(saved.responseType, 'success'); assert.equal(saved.body.view.close.requested, true);
  assert.equal(saved.body.view.close.status, 'not-sent'); assert.equal(saved.body.token, null);
  assert.equal(f.fake.calls('thread/unsubscribe').length, 0);
});

test('dispatch rechecks the parent project and the original socket after preparation', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  let peer: WebSocket | undefined;
  f.fake.handlers.set('thread/start', (_params, context) => { peer = context.socket; return f.response(); });
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'success');
  assert.equal((await a.host('project-add', { hostId: 'local', path: f.root, name: 'Fixture' })).responseType, 'success');
  assert.equal((await a.host('thread-projects', { operation: 'setMembership', value: { hostId: 'local', threadId: 'parent-a',
    assignment: { projectKind: 'local', projectId: f.root }, projectless: false } })).responseType, 'success');
  assert.equal((await a.host('thread-projects', { operation: 'setMembership', value: { hostId: 'local', threadId: 'parent-a',
    assignment: null, projectless: false } })).responseType, 'success');
  const changed = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'project-changed' }));
  assert.equal(changed.responseType, 'error'); assert.equal(changed.uncertain, false);
  const reprepare = await a.host('side-chat', prepared);
  assert.equal(reprepare.responseType, 'error'); assert.equal(reprepare.uncertain, true);
  assert.equal(f.fake.calls('thread/fork').length, 0);
  assert.equal((await a.host('thread-projects', { operation: 'setMembership', value: { hostId: 'local', threadId: 'parent-a',
    assignment: { projectKind: 'local', projectId: f.root }, projectless: false } })).responseType, 'success');
  const fresh = await a.host('side-chat', { ...prepared, prepareId: 'prepare-after-project' });
  assert.equal(fresh.responseType, 'success');
  const state = JSON.parse(await readFile(join(f.dataDir, 'native-state.json'), 'utf8'));
  assert.equal(state.sideChats.operations[fresh.body.view.operationId].parent.project.assignment.projectId, f.root);
  assert.ok(peer);
  const from = a.messages.length;
  peer.terminate();
  await a.until(item => item.type === 'codex-app-server-connection-changed' && item.state === 'disconnected', from);
  const disconnected = await a.host('side-chat', action(fresh.body, 'start', { forkDispatchId: 'socket-changed' }));
  assert.equal(disconnected.responseType, 'error'); assert.equal(disconnected.uncertain, false);
  const otherRead = await b.host('side-chat', { ...identity, action: 'read', operationId: fresh.body.view.operationId });
  const otherStart = await b.host('side-chat', action(otherRead.body, 'start', { forkDispatchId: 'other-page' }));
  assert.equal(otherStart.responseType, 'error'); assert.equal(otherStart.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('revocation at the actual fork boundary records not-sent and requires an explicit new attempt', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  f.block('fork');
  const blocked = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'blocked-at-send' }));
  assert.equal(blocked.responseType, 'success'); assert.equal(blocked.body.view.fork.status, 'not-sent');
  assert.equal(f.fake.calls('thread/fork').length, 0);
  f.block(null);
  f.fake.handlers.set('thread/fork', () => f.response(true));
  const retried = await a.host('side-chat', action(blocked.body, 'retry', { forkDispatchId: 'explicit-retry' }));
  assert.equal(retried.body.view.fork.status, 'received');
  assert.equal(retried.body.view.fork.receipt.attemptId, 'explicit-retry');
  assert.equal(f.fake.calls('thread/fork').length, 1);
});

test('an asynchronous browser authority cannot grant a synchronous send', async t => {
  const f = await fixture(t), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  f.asynchronous(true);
  const denied = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'async-guard' }));
  assert.equal(denied.responseType, 'error'); assert.equal(denied.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('a revoked dispatch is not sent and a late fork preserves its original receipt without replay', async t => {
  const f = await fixture(t, true, true), a = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'success');
  f.permit(false);
  const denied = await a.host('side-chat', action(first.body, 'start', { forkDispatchId: 'dispatch-denied' }));
  assert.equal(denied.responseType, 'error'); assert.equal(denied.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
  f.permit(true);
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/fork', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const fresh = await a.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
  const waiting = await a.host('side-chat', action(fresh.body, 'start', { forkDispatchId: 'dispatch-original' }));
  assert.equal(waiting.responseType, 'success'); assert.equal(waiting.body.view.fork.status, 'unknown');
  assert.ok(delayed);
  f.permit(false);
  const from = a.messages.length;
  delayed.send({ id: delayed.id, result: f.response(true) });
  delayed.send({ method: 'fixture/after-late-fork', params: {} });
  const later = await a.until(item => item.type === 'mcp-notification' && item.method === 'fixture/after-late-fork', from);
  let read: Message | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    read = await a.host('side-chat', { ...identity, action: 'read', purpose: 'reconcile', operationId: first.body.view.operationId });
    if (read.body?.view.inject.status === 'not-sent') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(read?.body.view.fork.status, 'received');
  assert.equal(read?.body.view.fork.receipt.attemptId, 'dispatch-original');
  assert.equal(read?.body.view.fork.receipt.eventCursor, later.seq - 1);
  assert.equal(read?.body.view.inject.status, 'not-sent');
  assert.equal(f.fake.calls('thread/fork').length, 1);
  assert.equal(f.fake.calls('thread/inject_items').length, 0);
  f.permit(true);
  const retried = await a.host('side-chat', action(read!.body, 'retry'));
  assert.equal(retried.body.view.inject.status, 'received');
  assert.equal(f.fake.calls('thread/fork').length, 1);
  assert.equal(f.fake.calls('thread/inject_items').length, 1);
});
