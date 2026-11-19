import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { supportsAttachedThreads } from '../lib/codex-protocol.ts';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { BrowserSidechatThreads } from '../src/native/browser-sidechat-threads.ts';
import { adaptSidechatThreads } from '../src/native/sidechat-thread-renderer.ts';
import { mergeSidechats } from '../src/native/sidechat-thread-view.ts';
import type { ObjectValue } from '../src/native/protocol.ts';

const child = (id: string, attachedToThreadId = 'parent'): ThreadSummary => ({ id, attachedToThreadId,
  name: id, cwd: '/fixture', status: { type: 'idle' }, turns: [] });
function setup() {
  const store = new BrowserSidechatThreads();
  for (const hostId of ['local', 'ssh']) store.observe({ type: 'codex-app-server-initialized', hostId, appServerVersion: '0.169.1' });
  return store;
}
function started(store: BrowserSidechatThreads, thread: ThreadSummary, hostId = 'local') {
  store.observe({ type: 'mcp-notification', hostId, method: 'thread/started', params: { thread } });
}

test('attachment capability follows the connected version, including the 0.169.1 patch boundary', () => {
  for (const version of [undefined, null, '', 'unknown', '0.164.0', '0.169.0-alpha.11.1']) assert.equal(supportsAttachedThreads(version), false);
  for (const version of ['0.169.1', 'Codex Desktop/0.170.0 (Linux)', '1.0.0']) assert.equal(supportsAttachedThreads(version), true);
});

test('branches are lazy, paginated, deduplicated and scoped to a host', async () => {
  const store = setup(), calls: ObjectValue[] = [];
  const list = async (params: ObjectValue) => {
    calls.push(params);
    return { data: params.cursor ? [child('two'), child('three')] : [child('one'), child('two')], nextCursor: params.cursor ? null : 'next' };
  };
  assert.equal(calls.length, 0);
  const first = store.load('local', 'parent', list);
  assert.equal(store.load('local', 'parent', list), first);
  await first;
  assert.deepEqual(calls[0], { attachedToThreadId: 'parent', limit: 50, sortKey: 'created_at', sortDirection: 'asc' });
  await store.load('local', 'parent', list, true);
  assert.equal(calls[1]!.cursor, 'next');
  assert.deepEqual(store.snapshot('local', 'parent').children.map(child => child.id), ['one', 'two', 'three']);
  assert.deepEqual(store.snapshot('ssh', 'parent').children, []);
  started(store, child('remote'), 'ssh');
  assert.equal(store.snapshot('ssh', 'remote').parentId, 'parent');
  assert.equal(store.isAttached('local', 'remote'), false);
});

test('a list reply preserves creation, rename and archive notifications received while it was pending', async () => {
  const store = setup();
  started(store, child('archived')); started(store, child('renamed'));
  let resolve!: (value: unknown) => void;
  const operation = store.load('local', 'parent', () => new Promise(accept => { resolve = accept; }));
  await Promise.resolve();
  started(store, child('created'));
  store.observe({ type: 'mcp-notification', method: 'thread/name/updated', params: { threadId: 'renamed', threadName: 'New title' } });
  store.observe({ type: 'mcp-notification', method: 'thread/archived', params: { threadId: 'archived' } });
  resolve({ data: [child('archived'), child('renamed')], nextCursor: null });
  await operation;
  assert.deepEqual(store.snapshot('local', 'parent').children.map(child => [child.id, child.name]), [['renamed', 'New title'], ['created', 'created']]);
});

test('failed reads can retry, and an invalidated in-flight page cannot overwrite the refreshed branch', async () => {
  const store = setup();
  await store.load('local', 'parent', () => { throw new Error('Disconnected'); });
  assert.equal(store.snapshot('local', 'parent').error, 'Disconnected');
  let resolve!: (value: unknown) => void;
  const stale = store.load('local', 'parent', () => new Promise(accept => { resolve = accept; }));
  await Promise.resolve();
  store.refresh('local');
  await store.load('local', 'parent', async () => ({ data: [child('current')], nextCursor: null }));
  resolve({ data: [child('stale')], nextCursor: null }); await stale;
  assert.equal(store.snapshot('local', 'parent').error, null);
  assert.deepEqual(store.snapshot('local', 'parent').children.map(child => child.id), ['current']);
});

test('the native list combines saved and open sidechats once, preserves titles and excludes archived attachments', () => {
  const store = setup();
  started(store, child('saved')); started(store, child('archived'));
  const live = ['saved', 'archived', 'temporary', 'legacy'].map(id => ({ conversationId: id, tabId: 'sidechat:' + id,
    title: 'Open ' + id, isResponseInProgress: id === 'saved' }));
  const rows = mergeSidechats(store, 'local', [child('saved'), { ...child('preview'), name: null, preview: 'Explain cache ownership' },
    { ...child('empty'), name: null }, { ...child('legacy'), name: 'Side chat 2', preview: 'Legacy first message' },
    { ...child('legacy-closed'), name: '侧边对话', preview: 'Closed conversation topic' }], live, true, index => 'Side chat ' + index);
  assert.deepEqual(rows.map(row => [row.conversationId, row.title, row.isResponseInProgress]), [
    ['saved', 'saved', true], ['preview', 'Explain cache ownership', false], ['empty', 'Side chat 3', false],
    ['legacy', 'Open legacy', false], ['legacy-closed', 'Closed conversation topic', false], ['temporary', 'Open temporary', false],
  ]);
  assert.equal(rows[0]!.tabId, 'sidechat:saved');
});

test('the pinned sidechat adapters parse and fail closed on a different snapshot', async () => {
  for (const path of ['/assets/app-initial-a68277f60b93.js', '/assets/local-conversation-thread-a5549d2fbc3c.js']) {
    const source = await readFile(join(rendererRoot, path.slice(1)));
    await transform(adaptSidechatThreads(path, source).toString(), { loader: 'js' });
    assert.throws(() => adaptSidechatThreads(path, Buffer.from('changed renderer')), /固定界面版本不匹配/);
    assert.equal(adaptSidechatThreads('/unrelated.js', source), source);
  }
});
