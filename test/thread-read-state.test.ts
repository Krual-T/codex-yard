import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BrowserThreadReadState } from '../src/native/browser-thread-read-state.ts';
import { startupSidebar } from '../src/native/startup-sidebar.ts';
import { adaptThreadReadState } from '../src/native/thread-read-state-renderer.ts';
import type { ThreadReadState } from '../lib/codex-protocol.ts';
import type { HostMessage } from '../src/native/protocol.ts';

const read: ThreadReadState = { firstUnread: null, revision: 'read-1' };
const unread: ThreadReadState = { firstUnread: { type: 'turn', turnId: 'turn-1' }, revision: 'unread-1' };
const notify = (threadId: string, state: ThreadReadState, hostId = 'local'): HostMessage => ({
  type: 'mcp-notification', hostId, method: 'thread/readState/changed', params: { threadId, readState: state },
});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('initial sidebar ranks only the latest fifty metadata rows, retaining time order within each priority', () => {
  const threads = Array.from({ length: 51 }, (_, i) => ({ id: 'thread-' + i, updatedAt: 100 - i, status: { type: i === 4 ? 'active' : 'idle' } }));
  const value = startupSidebar(threads, {}, { 'thread-2': unread, 'thread-3': unread, 'thread-4': unread, 'thread-50': unread });
  assert.deepEqual(value.threads.slice(0, 6).map(row => row.id), ['thread-2', 'thread-3', 'thread-4', 'thread-0', 'thread-1', 'thread-5']);
  assert.equal(value.threads.length, 50);
  assert.ok(!value.threads.some(row => row.id === 'thread-50'));
});

test('backend receipts drive snapshots, per-host updates and SSH priorities without local persistence', () => {
  const store = new BrowserThreadReadState(async () => assert.fail('observations must not write'));
  const changes: unknown[] = [], snapshots: unknown[] = [];
  store.forHost('ssh-fixture', assert.fail).subscribe(change => changes.push(change));
  store.subscribe(value => snapshots.push(value));
  store.receive('ssh-fixture', { data: [{ id: 'remote', status: { type: 'idle' } }, { id: 'running', status: { type: 'active' } }],
    readStates: { remote: unread, running: read } });
  assert.deepEqual(store.snapshot(), { 'ssh-fixture': ['remote'] });
  assert.equal(store.priority('codex:thread:local:remote'), 0);
  assert.equal(store.priority('local:remote'), 0);
  assert.equal(store.priority('codex:thread:local:running'), 1);
  assert.equal(snapshots.length, 1, 'one batch publishes one snapshot');
  assert.deepEqual(changes[0], { unreadThreadIds: new Set(['remote']) });
  store.observe(notify('remote', { ...read, revision: 'read-2' }, 'ssh-fixture'));
  assert.equal(store.forHost('ssh-fixture', assert.fail).has('remote'), false);
  assert.deepEqual(changes.at(-1), { threadId: 'remote', hasUnreadTurn: false });
});

test('read acknowledgements use the observed revision, and derived unread turn marks do not write', async () => {
  const requests: unknown[] = [];
  const store = new BrowserThreadReadState(async (hostId, params) => { requests.push({ hostId, ...params }); return { readState: read }; });
  store.receive('local', { readStates: { first: unread } });
  const host = store.forHost('local', assert.fail);
  host.set('first', true, 'turn');
  host.set('first', false, 'turn');
  await tick();
  assert.deepEqual(requests, [{ hostId: 'local', threadId: 'first', unread: false, expectedRevision: 'unread-1' }]);
  assert.equal(host.has('first'), false);
});

test('a stale list response cannot overwrite a newer receipt or runtime status notification', () => {
  const store = new BrowserThreadReadState(async () => ({}));
  const request: HostMessage = { type: 'mcp-request', hostId: 'local', request: { id: 1, method: 'thread/list', params: {} } };
  store.begin(request);
  store.observe(notify('first', unread));
  const beforeActive = store.snapshot();
  store.observe({ type: 'mcp-notification', hostId: 'local', method: 'thread/status/changed',
    params: { threadId: 'first', status: { type: 'active' } } });
  assert.notEqual(store.snapshot(), beforeActive, 'runtime status invalidates sidebar subscribers with the same unread receipt');
  store.observe({ type: 'mcp-response', hostId: 'local', message: { id: 1, result: {
    data: [{ id: 'first', status: { type: 'idle' } }], readStates: { first: read },
  } } }, request);
  assert.equal(store.forHost('local', assert.fail).has('first'), true);
  assert.equal(store.priority('codex:thread:local:first'), 1);
});

test('conflicts refresh confirmed state and require a new action instead of retrying the write', async () => {
  const requests: unknown[] = [], errors: Error[] = [];
  const store = new BrowserThreadReadState(async (_hostId, params) => {
    requests.push(params);
    if ('unread' in params) throw new Error('revision conflict');
    return { thread: { id: 'first' }, readState: { ...unread, revision: 'newer-unread' } };
  });
  store.receive('local', { readStates: { first: unread } });
  store.forHost('local', error => errors.push(error)).set('first', false);
  await tick();
  assert.equal(errors[0]?.message, 'revision conflict');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], { threadId: 'first' });
  assert.equal(store.forHost('local', assert.fail).has('first'), true);
});

test('fixed UI adapters remove durable browser read markers and keep manual ordering intact', async () => {
  const path = '/assets/app-initial-a68277f60b93.js';
  const source = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview' + path, import.meta.url));
  const adapted = adaptThreadReadState(path, source).toString();
  assert.ok(adapted.includes('window.workbenchThreadReadState.forHost'));
  assert.ok(!adapted.includes('read(){return this.#e==null?wh(eE,{}):this.#n}'));
  assert.ok(adapted.includes('r===`manual`?zfa(t,n).map(e=>e.key)'));
  assert.throws(() => adaptThreadReadState(path, Buffer.from('upstream changed')), /固定界面版本不匹配/);
});
