import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryStartup, initialWorkspaceRoute, isWorkspacePageRoute, parseWorkspaceThreadRoute, usesPinnedToolRenderer } from '../src/native/history-startup.ts';
import type { HostMessage } from '../src/native/protocol.ts';
import { readWorkspaceHistory } from '../src/native/browser-workspace-rpc.ts';

const list = (cursor: string | null): HostMessage => ({ type: 'mcp-request', hostId: 'local', request: {
  id: 'pagination', method: 'thread/list', params: { cursor, limit: 50 },
} });

test('history captures its read revision before fetching content; older pages keep cursor-only reads', async context => {
  const browser = new EventTarget(), sent: HostMessage[] = [];
  for (const [key, value] of Object.entries({ window: browser, location: { origin: 'http://workspace.test' } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    context.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  const send = async (message: HostMessage) => { sent.push(message); };
  function reply(message: HostMessage, result: unknown) {
    const event = new MessageEvent('message', { origin: 'http://workspace.test', data: {
      type: 'mcp-response', hostId: 'remote', message: { id: message.request!.id, result },
    } });
    Object.defineProperty(event, 'source', { value: browser });
    browser.dispatchEvent(event);
  }
  const reading = readWorkspaceHistory(send, 'chat', null, 'remote');
  assert.deepEqual(sent.map(message => message.request!.method), ['thread/read']);
  const readState = { revision: 'before-content', firstUnread: { type: 'turn', turnId: 'earlier-page' } };
  reply(sent[0]!, { thread: { id: 'chat' }, readState });
  await Promise.resolve();
  assert.equal(sent[1]!.request!.method, 'thread/turns/list');
  assert.deepEqual(sent[1]!.request!.params, { threadId: 'chat', cursor: null, limit: 2, sortDirection: 'desc', itemsView: 'summary' });
  reply(sent[1]!, { data: [{ id: 'latest' }, { id: 'previous' }], nextCursor: 'older' });
  const page = await reading;
  assert.equal(page.readState, readState);
  assert.deepEqual(page.turns.map(turn => turn.id), ['previous', 'latest']);
  const older = readWorkspaceHistory(send, 'chat', 'older', 'remote');
  assert.equal(sent.length, 3);
  assert.equal(sent[2]!.request!.method, 'thread/turns/list');
  assert.equal(sent[2]!.request!.params!.cursor, 'older');
  reply(sent[2]!, { data: [], nextCursor: null });
  assert.equal((await older).readState, undefined);
});

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

test('settings, scheduling and plugin routes use the source workspace without becoming conversation routes', () => {
  for (const route of ['/settings', '/settings/general-settings', '/settings/appearance?tab=theme',
    '/plugins', '/plugins/example', '/skills', '/automations', '/automations?filter=active']) {
    assert.ok(!usesPinnedToolRenderer(route), route);
    assert.ok(isWorkspacePageRoute(route), route);
    assert.equal(parseWorkspaceThreadRoute(route), undefined, route);
  }
  for (const route of ['/', '/local/conversation', '/remote-ssh-fixture/plugins', '/settings-preview', '/automations-preview', '//plugins/other']) {
    assert.ok(!usesPinnedToolRenderer(route), route);
  }
  assert.ok(usesPinnedToolRenderer('/avatar-overlay?initialRoute=%2Favatar-overlay'));
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
