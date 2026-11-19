import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryStartup, initialWorkspaceRoute } from '../src/native/history-startup.ts';
import type { HostMessage } from '../src/native/protocol.ts';

const list = (cursor: string | null): HostMessage => ({ type: 'mcp-request', hostId: 'local', request: {
  id: 'pagination', method: 'thread/list', params: { cursor, limit: 50 },
} });

test('home page keeps its first interactive frames free before resuming older pages', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const startup = new HistoryStartup(null, 15000, true);
  assert.equal(startup.wait(list(null)), undefined);
  assert.equal(startup.wait({ ...list('next'), request: { id: 'write', method: 'turn/start', params: {} } }), undefined);
  let resumed = false;
  const waiting = startup.wait(list('next'))!.then(() => { resumed = true; });
  await Promise.resolve();
  assert.equal(resumed, false);
  startup.workspaceReady();
  context.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(resumed, false);
  context.mock.timers.tick(500);
  await waiting;
  assert.equal(resumed, true);
  assert.equal(startup.wait(list('later')), undefined);
});

test('composer input keeps the delay while sidebar navigation releases older pages', async () => {
  const startup = new HistoryStartup(null, 15000, true);
  let released = false;
  const waiting = startup.wait(list('next'))!.then(() => { released = true; });
  startup.workspaceReady();
  startup.interact();
  await Promise.resolve();
  assert.equal(released, false);
  startup.interact(true);
  await waiting;
  assert.equal(startup.wait(list('later')), undefined);
});

test('workspace paint does not release a directly opened history conversation', async () => {
  const startup = new HistoryStartup('/local/conversation', 1000, true);
  let resumed = false;
  const waiting = startup.wait(list('next'))!.then(() => { resumed = true; });
  startup.workspaceReady();
  await Promise.resolve();
  assert.equal(resumed, false);
  startup.interact();
  await waiting;
  assert.equal(resumed, true);
});

test('initial route honors metadata, notification query and direct paths', () => {
  assert.equal(initialWorkspaceRoute('/local/meta', '?initialRoute=%2Flocal%2Fquery', '/local/path'), '/local/meta');
  assert.equal(initialWorkspaceRoute(null, '?initialRoute=%2Flocal%2Fquery', '/'), '/local/query');
  assert.equal(initialWorkspaceRoute(null, '', '/local/path'), '/local/path');
  assert.equal(initialWorkspaceRoute(null, '', '/settings'), '/settings');
  assert.equal(new HistoryStartup(initialWorkspaceRoute(null, '', '/settings'), 1000, true).wait(list('next')), undefined);
});

test('workspace fallback releases background pages and mini windows keep the original path', async () => {
  const startup = new HistoryStartup('/', 5, true);
  await startup.wait(list('next'));
  assert.equal(startup.wait(list('later')), undefined);
  assert.equal(new HistoryStartup(null).wait(list('next')), undefined);
});
