import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { readConversationPage } from '../src/native/conversation-history.ts';
import { adaptConversationHistory } from '../src/native/conversation-history-renderer.ts';
import { HistoryStartup } from '../src/native/history-startup.ts';

test('history reads two summaries and passes native item hydration markers and the older cursor', async () => {
  const requests: unknown[] = [];
  const page = { data: [{ id: 'latest', items: [{ id: 'user' }, { id: 'answer' }], itemsView: 'summary' }], nextCursor: 'older-turns' };
  const result = await readConversationPage(async (...args) => {
    requests.push(args);
    return page;
  }, 'chat', { requestOptions: { priority: 'critical' } });
  assert.deepEqual(requests, [['thread/turns/list', {
    threadId: 'chat', cursor: null, limit: 2, sortDirection: 'desc', itemsView: 'summary',
  }, { priority: 'critical' }]]);
  assert.equal(result.response.nextCursor, 'older-turns');
  assert.equal(result.response, page);
  assert.deepEqual(result.itemsPaginationByTurnId.latest, {
    olderCursor: null, isLoadingOlder: false, hasLoadedOldest: false, summaryItemIds: ['user', 'answer'],
  });
  const older = await readConversationPage(async (_method, params) => {
    assert.equal(params.cursor, 'older-turns'); assert.equal(params.limit, 5); assert.equal(params.sortDirection, 'asc');
    return { data: [{ ...page.data[0], itemsView: 'full' }], nextCursor: null };
  }, 'chat', { cursor: 'older-turns', limit: 5, sortDirection: 'asc' });
  assert.equal(older.itemsPaginationByTurnId.latest.hasLoadedOldest, true);
  assert.equal('summaryItemIds' in older.itemsPaginationByTurnId.latest, false);
});

test('history adaptation compiles with the pinned renderer and fails on an incompatible snapshot', async () => {
  for (const name of ['app-initial-a68277f60b93.js', 'local-conversation-thread-a5549d2fbc3c.js', 'local-conversation-turn-981410324fed.js']) {
    const path = '/assets/' + name;
    const source = await readFile(join(rendererRoot, 'assets', name));
    await transform(adaptConversationHistory(path, source).toString(), { loader: 'js' });
    assert.throws(() => adaptConversationHistory(path, Buffer.from('changed snapshot')), /固定界面版本不匹配/);
  }
});

test('startup defers background sidebar reads while active history and writes proceed', async () => {
  const startup = new HistoryStartup('/remote-ssh%3Atest/chat');
  const request = (method: string, hostId = 'remote-ssh:test', params = {}) => ({ type: 'mcp-request', hostId, request: { id: 1, method, params } });
  assert.equal(startup.wait(request('thread/turns/list')), undefined);
  assert.equal(startup.wait(request('thread/resume', 'other')), undefined);
  assert.equal(startup.wait(request('turn/start', 'other')), undefined);
  assert.equal(startup.wait(request('thread/list', 'remote-ssh:test', { limit: 50 })), undefined);
  const waiting = startup.wait(request('thread/list', 'other', { limit: 50 }));
  assert.ok(waiting instanceof Promise);
  assert.equal(startup.wait(request('thread/list', 'remote-ssh:test', { cursor: 'older' })), waiting);
  startup.release(); await waiting;
  assert.equal(startup.wait(request('thread/list', 'other')), undefined);
});

test('a failed history read cannot indefinitely hold the sidebar', async () => {
  const startup = new HistoryStartup('/local/chat', 10);
  await startup.wait({ type: 'mcp-request', hostId: 'ssh', request: { id: 1, method: 'thread/list' } });
  assert.equal(startup.wait({ type: 'mcp-request', hostId: 'ssh', request: { id: 2, method: 'thread/list' } }), undefined);
});
