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
  let permitted = true, frozen = false, failDirectorySync = false, asynchronousGuard = false;
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
    async prepareClose(scope) { if (!permitted || scope.draftId !== 'draft-a') throw new Error('fixture close blocked'); frozen = true; closeCalls.push('freeze'); },
    async cleanup() { if (!permitted || !frozen) throw new Error('fixture cleanup blocked'); closeCalls.push('cleanup'); frozen = false; },
    ownerStopped: () => false,
  };
  const remote = { hostId: 'remote-ssh-fixture', displayName: 'Fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null };
  const sshStream = ((_host, paths) => { paths?.({ homeDirectory: '/fixture-home', codexHome: '/fixture-home/.codex' });
    return createConnection(fake.socketPath); }) as typeof createSshProxyStream;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir,
    workspace: root, renderer, adapterPath, hostCatalog: { hosts: [remote], projects: [], assignments: {} }, sshStream,
    ...(enabled ? { sideChatBrowserAuthority: authority } : {}), ...(timeout ? { sideChatParentReceipts: new ShortTimeoutReceipts() } : {}),
    nativeStateCheckpoint(step) { if (step === 'directory-sync' && failDirectorySync) { failDirectorySync = false; throw new Error('fixture confirmation failure'); } } });
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
    failNextCommit() { failDirectorySync = true; }, asynchronous(value: boolean) { asynchronousGuard = value; } };
}

const identity = { hostId: 'local', parentThreadId: 'parent-a' };
const prepared = { ...identity, action: 'prepare', prepareId: 'prepare-a', draftId: 'draft-a' };
const action = (view: Message, name: string, extra: Record<string, unknown> = {}) => ({ ...identity, action: name,
  operationId: view.view.operationId, token: view.token, ...extra });

test('real host prepares and restores the same native-state operation but requires browser authority to dispatch', async t => {
  const f = await fixture(t, false), a = await f.connect();
  assert.ok((await a.rpc('thread/start', { cwd: f.root })).message.result);
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'success');
  assert.equal(first.body.view.fork.status, 'waiting');
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
  const repeated = await a.host('side-chat', prepared);
  assert.equal(repeated.responseType, 'error'); assert.equal(repeated.uncertain, false);
  const state = JSON.parse(await readFile(join(f.dataDir, 'native-state.json'), 'utf8'));
  const operationId = state.sideChats.prepared['prepare-a'];
  assert.equal(Object.keys(state.sideChats.operations).length, 1);
  const original = await a.host('side-chat', { ...identity, action: 'read', operationId });
  assert.equal(original.responseType, 'success');
  assert.equal(original.body.view.fork.status, 'waiting');
  const denied = await a.host('side-chat', action(original.body, 'start', { forkDispatchId: 'after-project-change' }));
  assert.equal(denied.responseType, 'error'); assert.equal(denied.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
});

test('real endpoint checks page, draft and fork identity at dispatch and closes with one unsubscribe', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  await a.rpc('thread/start', { cwd: f.root });
  const first = await a.host('side-chat', prepared);
  assert.equal(first.responseType, 'success');
  const otherRead = await b.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  const otherStart = await b.host('side-chat', action(otherRead.body, 'start', { forkDispatchId: 'dispatch-b' }));
  assert.equal(otherStart.responseType, 'error'); assert.equal(otherStart.uncertain, false);
  assert.equal(f.fake.calls('thread/fork').length, 0);
  const fresh = await a.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
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

test('a concurrent page read rotates the token and prevents the old call from injecting', async t => {
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
  delayed.send({ id: delayed.id, result: f.response(true) });
  const received = await starting;
  assert.equal(received.body.view.fork.status, 'received');
  assert.equal(received.body.view.inject.status, 'not-sent');
  assert.equal(f.fake.calls('thread/inject_items').length, 0);
  const fresh = await a.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
  const retried = await a.host('side-chat', action(fresh.body, 'retry'));
  assert.equal(retried.body.view.inject.status, 'received');
  assert.equal(f.fake.calls('thread/fork').length, 1);
  assert.equal(f.fake.calls('thread/inject_items').length, 1);
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
  assert.equal(reprepare.responseType, 'error'); assert.equal(reprepare.uncertain, false);
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
  const fresh = await a.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
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
    read = await a.host('side-chat', { ...identity, action: 'read', operationId: first.body.view.operationId });
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
