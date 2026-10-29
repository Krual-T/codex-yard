import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { SideChatParentReceipts } from '../src/native/side-chat-parent-receipts.ts';
import type { SideChatReceiptAttempt, SideChatReceiptSource } from '../src/native/side-chat-parent-receipts.ts';
import { resolveSideChatParent } from '../src/native/side-chat-parent.ts';
import type { createSshProxyStream } from '../src/native/ssh.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;

class TrackedReceipts extends SideChatParentReceipts {
  sources: SideChatReceiptSource[] = [];
  captured: { attempt: SideChatReceiptAttempt; cursor: number }[] = [];
  shortTimeout = false;
  override begin(source: SideChatReceiptSource, method: Parameters<SideChatParentReceipts['begin']>[1], expectedThreadId: string | null) {
    this.sources.push(source);
    if (this.shortTimeout) Object.defineProperty(source.connection, 'timeout', { value: 40, configurable: true });
    return super.begin(source, method, expectedThreadId);
  }
  override receive(attempt: SideChatReceiptAttempt, response: unknown, cursor: number) {
    this.captured.push({ attempt, cursor });
    super.receive(attempt, response, cursor);
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
  let sequence = 0;
  async function rpc(method: string, params: Record<string, unknown>, hostId = 'local', observeSubscriptionTerminal = false) {
    const id = ++sequence;
    socket.send(JSON.stringify({ type: 'mcp-request', hostId, request: { id, method, params }, observeSubscriptionTerminal }));
    return until(item => item.type === 'mcp-response' && item.hostId === hostId && item.message.id === id && !item.late);
  }
  return { socket, messages, until, rpc };
}

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp('/tmp/aw-parent-');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  const receipts = new TrackedReceipts();
  const remote = { hostId: 'remote-ssh-fixture', displayName: 'Fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null };
  const sshStream = ((_host, paths) => { paths?.({ homeDirectory: '/fixture-home', codexHome: '/fixture-home/.codex' });
    return createConnection(fake.socketPath); }) as typeof createSshProxyStream;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, renderer, adapterPath, sshStream,
    hostCatalog: { hosts: [remote], projects: [], assignments: {} }, sideChatParentReceipts: receipts });
  const pages: WebSocket[] = [];
  t.after(async () => { for (const socket of pages) socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  async function connect() { const result = await page(app.url); pages.push(result.socket); return result; }
  const thread = fixtureThread('parent-a', root);
  fake.threads.set(thread.id, thread); fake.loaded.add(thread.id);
  function response(id: string) {
    return { thread: { ...thread, id }, cwd: root, runtimeWorkspaceRoots: [root], model: 'peer-model', modelProvider: 'peer',
      reasoningEffort: null, serviceTier: null, approvalPolicy: 'on-request', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null, privatePeerField: 'original' };
  }
  return { root, fake, receipts, connect, response };
}

test('real host RPCs retain original receipts by page, host and socket and revoke stale settings', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  f.fake.handlers.set('thread/start', (_params, context) => {
    context.send({ method: 'fixture/pre-receipt', params: {} }); return f.response('parent-a');
  });
  f.fake.handlers.set('thread/fork', () => f.response('child-a'));
  f.fake.handlers.set('thread/resume', () => f.response('parent-a'));
  const first = await a.rpc('thread/start', { cwd: f.root, response: { model: 'renderer-forgery' } });
  const sourceA = f.receipts.sources.at(-1)!;
  const parentA = f.receipts.current(sourceA.page, 'local', 'parent-a');
  assert.ok(parentA); assert.deepEqual(parentA.response, f.response('parent-a'));
  assert.equal(parentA.eventCursor, first.eventCursor);
  assert.notEqual((parentA.response as Message).model, 'renderer-forgery');
  const resolved = await resolveSideChatParent(parentA, {
    runScoped: async run => run(),
    capture: () => ({ ...f.receipts.assertCurrent(sourceA.page, 'local', 'parent-a', parentA.revision), project: null }),
    assertCurrent: revision => { f.receipts.assertCurrent(sourceA.page, 'local', 'parent-a', revision); },
    request: (method, params) => sourceA.connection.request(method, params),
  });
  assert.equal(resolved.model, 'peer-model'); assert.equal(resolved.archived, false);
  const fork = await a.rpc('thread/fork', { threadId: 'parent-a' });
  assert.equal(f.receipts.current(sourceA.page, 'local', 'child-a')?.eventCursor, fork.eventCursor);
  await b.rpc('thread/resume', { threadId: 'parent-a' });
  const sourceB = f.receipts.sources.at(-1)!;
  assert.notEqual(sourceB.page, sourceA.page);
  assert.ok(f.receipts.current(sourceB.page, 'local', 'parent-a'));
  await a.rpc('thread/start', { cwd: f.root }, 'remote-ssh-fixture');
  const remote = f.receipts.sources.at(-1)!;
  assert.ok(f.receipts.current(remote.page, 'remote-ssh-fixture', 'parent-a'));

  f.fake.handlers.set('thread/settings/update', () => ({}));
  await b.rpc('thread/settings/update', { threadId: 'parent-a', approvalPolicy: 'never' });
  assert.equal(f.receipts.current(sourceA.page, 'local', 'parent-a'), null);
  assert.equal(f.receipts.current(sourceB.page, 'local', 'parent-a'), null);
  assert.ok(f.receipts.current(remote.page, 'remote-ssh-fixture', 'parent-a'));
  await a.rpc('thread/resume', { threadId: 'parent-a' });
  const fresh = f.receipts.current(sourceA.page, 'local', 'parent-a');
  assert.ok(fresh); assert.notEqual(fresh.revision, parentA.revision);
  assert.throws(() => f.receipts.assertCurrent(sourceA.page, 'local', 'parent-a', parentA.revision));

  const before = a.messages.length;
  f.fake.broadcast({ method: 'thread/settings/updated', params: { threadId: 'parent-a', threadSettings: { approvalPolicy: 'never' } } });
  await a.until(item => item.type === 'mcp-notification' && item.method === 'thread/settings/updated', before);
  assert.equal(f.receipts.current(sourceA.page, 'local', 'parent-a'), null);
  assert.equal(f.fake.calls('turn/start').length, 0);
});

test('an unscoped settings notification invalidates only the emitting host', async t => {
  const f = await fixture(t), a = await f.connect();
  f.fake.handlers.set('thread/start', () => f.response('parent-a'));
  f.fake.handlers.set('thread/fork', () => f.response('child-a'));
  await a.rpc('thread/start', { cwd: f.root });
  const local = f.receipts.sources.at(-1)!;
  await a.rpc('thread/fork', { threadId: 'parent-a' });
  await a.rpc('thread/start', { cwd: f.root }, 'remote-ssh-fixture');
  const remote = f.receipts.sources.at(-1)!;
  f.fake.handlers.set('model/list', (_params, context) => {
    context.send({ method: 'thread/settings/updated', params: {} });
    return { data: [], nextCursor: null };
  });
  await a.rpc('model/list', {});
  assert.equal(f.receipts.current(local.page, 'local', 'parent-a'), null);
  assert.equal(f.receipts.current(local.page, 'local', 'child-a'), null);
  assert.ok(f.receipts.current(remote.page, 'remote-ssh-fixture', 'parent-a'));
});

test('late replies capture the original cursor and cannot grant rights to a replacement socket or page', async t => {
  const f = await fixture(t), a = await f.connect();
  f.receipts.shortTimeout = true;
  let delayed: { id: string | number; send(value: unknown): void; socket: WebSocket } | undefined;
  f.fake.handlers.set('thread/resume', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send, socket: context.socket }; return NO_REPLY;
  });
  const initial = await a.rpc('thread/resume', { threadId: 'parent-a' }, 'local', true);
  assert.equal(initial.message.error.data.uncertain, true);
  const original = f.receipts.sources.at(-1)!;
  assert.ok(delayed);
  const from = a.messages.length;
  delayed.send({ id: delayed.id, result: f.response('parent-a') });
  delayed.send({ method: 'fixture/post-receipt', params: {} });
  const notification = await a.until(item => item.type === 'mcp-notification' && item.method === 'fixture/post-receipt', from);
  const stored = f.receipts.current(original.page, 'local', 'parent-a');
  assert.ok(stored); assert.equal(stored.eventCursor, notification.seq - 1);
  assert.equal(f.receipts.captured.at(-1)?.cursor, stored.eventCursor);
  assert.deepEqual(stored.response, f.response('parent-a'));
  delayed.socket.terminate();
  await a.until(item => item.type === 'codex-app-server-connection-changed' && item.hostId === 'local' && item.state === 'disconnected', from);
  assert.equal(f.receipts.current(original.page, 'local', 'parent-a'), null);
  f.fake.handlers.set('thread/resume', () => f.response('parent-a'));
  await a.rpc('thread/resume', { threadId: 'parent-a' });
  const replacement = f.receipts.sources.at(-1)!;
  assert.notEqual(replacement.socket, original.socket);
  assert.notEqual(replacement.connectionGeneration, original.connectionGeneration);
  assert.throws(() => f.receipts.assertCurrent(original.page, 'local', 'parent-a', stored.revision));
  const reloaded = f.receipts.current(replacement.page, 'local', 'parent-a');
  assert.ok(reloaded);
  const pageClosed = once(replacement.page, 'close');
  a.socket.terminate(); await pageClosed;
  assert.equal(f.receipts.current(replacement.page, 'local', 'parent-a'), null);
  assert.equal(f.fake.calls('turn/start').length, 0);
});

test('a late original response cannot revive a snapshot after an intervening settings write', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  f.receipts.shortTimeout = true;
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/resume', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const timeout = await a.rpc('thread/resume', { threadId: 'parent-a' });
  assert.equal(timeout.message.error.data.uncertain, true);
  const source = f.receipts.sources.at(-1)!;
  f.fake.handlers.set('thread/settings/update', () => ({}));
  assert.ok((await b.rpc('thread/settings/update', { threadId: 'parent-a', approvalPolicy: 'never' })).message.result);
  assert.ok(delayed);
  delayed.send({ id: delayed.id, result: f.response('parent-a') });
  delayed.send({ method: 'fixture/after-late', params: {} });
  await a.until(item => item.type === 'mcp-notification' && item.method === 'fixture/after-late');
  assert.equal(f.receipts.current(source.page, 'local', 'parent-a'), null);
  assert.equal(f.receipts.captured.at(-1)?.attempt.stale, true);
  assert.equal(f.fake.calls('thread/resume').length, 1);
});

test('pending start checks invalidation against its returned thread instead of unrelated threads', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  const pending: { id: string | number; send(value: unknown): void }[] = [];
  f.fake.handlers.set('thread/start', (_params, context) => {
    pending.push({ id: context.message.id!, send: context.send }); return NO_REPLY;
  });
  f.fake.handlers.set('thread/settings/update', () => ({}));
  const first = a.rpc('thread/start', { cwd: f.root });
  await f.fake.waitForCall('thread/start');
  assert.ok((await b.rpc('thread/settings/update', { threadId: 'other-thread' })).message.result);
  pending[0]!.send({ id: pending[0]!.id, result: f.response('parent-a') });
  assert.ok((await first).message.result);
  const source = f.receipts.sources.at(-1)!;
  assert.ok(f.receipts.current(source.page, 'local', 'parent-a'));

  const second = a.rpc('thread/start', { cwd: f.root });
  await f.fake.waitForCall('thread/start', 2);
  assert.ok((await b.rpc('thread/settings/update', { threadId: 'parent-a' })).message.result);
  pending[1]!.send({ id: pending[1]!.id, result: f.response('parent-a') });
  assert.ok((await second).message.result);
  assert.equal(f.receipts.current(source.page, 'local', 'parent-a'), null);
});

test('pending fork checks invalidations against the returned child identity', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  const pending: { id: string | number; send(value: unknown): void }[] = [];
  f.fake.handlers.set('thread/fork', (_params, context) => {
    pending.push({ id: context.message.id!, send: context.send }); return NO_REPLY;
  });
  f.fake.handlers.set('thread/settings/update', () => ({}));
  const first = a.rpc('thread/fork', { threadId: 'parent-a' });
  await f.fake.waitForCall('thread/fork');
  assert.ok((await b.rpc('thread/settings/update', { threadId: 'other-thread' })).message.result);
  pending[0]!.send({ id: pending[0]!.id, result: f.response('child-a') });
  assert.ok((await first).message.result);
  const source = f.receipts.sources.at(-1)!;
  assert.ok(f.receipts.current(source.page, 'local', 'child-a'));

  const second = a.rpc('thread/fork', { threadId: 'parent-a' });
  await f.fake.waitForCall('thread/fork', 2);
  assert.ok((await b.rpc('thread/settings/update', { threadId: 'child-a' })).message.result);
  pending[1]!.send({ id: pending[1]!.id, result: f.response('child-a') });
  assert.ok((await second).message.result);
  assert.equal(f.receipts.current(source.page, 'local', 'child-a'), null);
});

test('an unsubscribe revokes only pending receipts from the same page and returned thread', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  const pending: { id: string | number; send(value: unknown): void }[] = [];
  f.fake.handlers.set('thread/start', (_params, context) => {
    pending.push({ id: context.message.id!, send: context.send }); return NO_REPLY;
  });
  const first = a.rpc('thread/start', { cwd: f.root });
  await f.fake.waitForCall('thread/start');
  assert.ok((await b.rpc('thread/unsubscribe', { threadId: 'parent-a' })).message.result);
  pending[0]!.send({ id: pending[0]!.id, result: f.response('parent-a') });
  assert.ok((await first).message.result);
  const source = f.receipts.sources.at(-1)!;
  assert.ok(f.receipts.current(source.page, 'local', 'parent-a'));

  const second = a.rpc('thread/start', { cwd: f.root });
  await f.fake.waitForCall('thread/start', 2);
  assert.ok((await a.rpc('thread/unsubscribe', { threadId: 'parent-a' })).message.result);
  pending[1]!.send({ id: pending[1]!.id, result: f.response('parent-a') });
  assert.ok((await second).message.result);
  assert.equal(f.receipts.current(source.page, 'local', 'parent-a'), null);
});

test('a host-wide settings invalidation revokes a pending start regardless of its returned identity', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  let delayed: { id: string | number; send(value: unknown): void } | undefined;
  f.fake.handlers.set('thread/start', (_params, context) => {
    delayed = { id: context.message.id!, send: context.send }; return NO_REPLY;
  });
  const pending = a.rpc('thread/start', { cwd: f.root });
  await f.fake.waitForCall('thread/start');
  f.fake.handlers.set('model/list', (_params, context) => {
    context.send({ method: 'thread/settings/updated', params: {} });
    return { data: [], nextCursor: null };
  });
  assert.ok((await b.rpc('model/list', {})).message.result);
  assert.ok(delayed); delayed.send({ id: delayed.id, result: f.response('parent-a') });
  assert.ok((await pending).message.result);
  const source = f.receipts.sources.at(-1)!;
  assert.equal(f.receipts.current(source.page, 'local', 'parent-a'), null);
});

test('an older late resume reply cannot replace a newer original response on the same page', async t => {
  const f = await fixture(t), a = await f.connect();
  f.receipts.shortTimeout = true;
  const pending: { id: string | number; send(value: unknown): void }[] = [];
  f.fake.handlers.set('thread/resume', (_params, context) => {
    pending.push({ id: context.message.id!, send: context.send }); return NO_REPLY;
  });
  const older = a.rpc('thread/resume', { threadId: 'parent-a' });
  await f.fake.waitForCall('thread/resume', 1);
  // Same-thread writes are serialized. A timed-out original request can still
  // complete after the next explicit resume through its retained late callback.
  assert.ok((await older).message.error);
  const newer = a.rpc('thread/resume', { threadId: 'parent-a' });
  await f.fake.waitForCall('thread/resume', 2);
  pending[1]!.send({ id: pending[1]!.id, result: { ...f.response('parent-a'), model: 'newer-model' } });
  assert.ok((await newer).message.result);
  pending[0]!.send({ id: pending[0]!.id, result: { ...f.response('parent-a'), model: 'older-model' } });
  pending[0]!.send({ method: 'fixture/after-older-resume', params: {} });
  await a.until(item => item.type === 'mcp-notification' && item.method === 'fixture/after-older-resume');
  const source = f.receipts.sources.at(-1)!;
  const current = f.receipts.current(source.page, 'local', 'parent-a');
  assert.ok(current); assert.equal((current.response as Message).model, 'newer-model');
});
