import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChromePanelHost, parsePages } from '../src/browser-reuse/panel-host.ts';
import { BrowserChrome } from '../src/browser-reuse/browser-bridge.ts';
import type { ToolResult } from '../src/browser-reuse/chrome-mcp.ts';

const target = { conversationId: 'thread', browserTabId: 'panel' };
const config = { browserUrl: 'http://127.0.0.1:9222' };
function fixture() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let pages = [{ id: 1, url: 'https://example.test/', title: 'Title (with parentheses)', selected: true },
    { id: 2, url: 'https://second.test/', title: 'Second', selected: false }];
  let failures = 0, closed = 0;
  const tools = {
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      calls.push({ name, args });
      if (failures > 0) { failures--; throw new Error('not allowed yet'); }
      if (name === 'take_screenshot') return { content: [{ type: 'image', mimeType: 'image/jpeg', data: 'fixture' }] };
      if (name === 'list_pages') return { content: [], structuredContent: { pages } };
      const text = name === 'evaluate_script'
        ? '```json\n{"url":"https://example.test/","title":"Fixture","width":800,"height":600}\n```' : '';
      return { content: [{ type: 'text', text }] };
    },
    async close() { closed++; },
  };
  return { tools, calls, fail() { failures++; }, removeTarget() { pages = [{ ...pages[1]!, selected: true }]; }, get closed() { return closed; } };
}

test('unconfigured panel never starts MCP; structured pages preserve URL boundaries', async () => {
  assert.deepEqual(parsePages({ content: [{ type: 'text', text: '1: Title (with parentheses) (https://example.test/) [selected]' }],
    structuredContent: { pages: [{ id: 1, url: 'https://example.test/', title: 'Title (with parentheses)', selected: true }] } }),
  [{ id: 1, url: 'https://example.test/', selected: true }]);
  const host = new ChromePanelHost(undefined, () => {}, 'http://workbench', async () => { throw new Error('must not connect'); });
  assert.equal((await host.request({ ...target, operation: 'state' })).configured, false);
  await host.close();
});

test('failed initialize and refused Chrome attachment can each be retried by a later refresh', async () => {
  const f = fixture(); let connects = 0;
  const host = new ChromePanelHost(config, () => {}, 'http://workbench', async () => {
    connects++;
    if (connects === 1) throw new Error('initialize failed');
    return f.tools;
  });
  await assert.rejects(host.request({ ...target, operation: 'state' }), /initialize failed/);
  f.fail();
  await assert.rejects(host.request({ ...target, operation: 'state' }), /not allowed yet/);
  assert.equal(f.closed, 1, 'Refused attachment process is closed');
  assert.equal((await host.request({ ...target, operation: 'state' })).pageId, 1);
  assert.equal(connects, 3);
  await host.close();
});

test('concurrent typing is ordered; a failed input is never replayed; coordinates use CSS viewport', async () => {
  const f = fixture(); const states: unknown[] = [];
  const host = new ChromePanelHost(config, message => states.push(message), 'http://workbench', async () => f.tools);
  await host.request({ ...target, operation: 'state' });
  await Promise.all([...Array.from('Fast123'), '中文'].map(text => host.request({ ...target, operation: 'text', pageId: 1, text })));
  assert.deepEqual(f.calls.filter(c => c.name === 'type_text').map(c => c.args.text), [...Array.from('Fast123'), '中文']);
  await host.request({ ...target, operation: 'click', pageId: 1, x: 0.5, y: 0.25 });
  assert.deepEqual(f.calls.find(c => c.name === 'click_at')?.args, { pageId: 1, x: 400, y: 150 });
  const original = f.tools.callTool;
  let attempted = 0;
  f.tools.callTool = async (name, args) => { if (name === 'type_text') { attempted++; throw new Error('uncertain input'); } return original(name, args); };
  await assert.rejects(host.request({ ...target, operation: 'text', pageId: 1, text: 'once' }), /uncertain input/);
  f.tools.callTool = original;
  await host.request({ ...target, operation: 'capture' });
  assert.equal(attempted, 1);
  assert.ok(states.length > 0);
  await host.close();
});

test('closed or switched tabs reject stale inputs; detaching preserves actual Chrome tabs', async () => {
  const f = fixture();
  const host = new ChromePanelHost(config, () => {}, 'http://workbench', async () => f.tools);
  await host.request({ ...target, operation: 'state' });
  await host.request({ ...target, operation: 'select', pageId: 2 });
  await assert.rejects(host.request({ ...target, operation: 'text', pageId: 1, text: 'wrong tab' }), /标签已切换/);
  await host.request({ ...target, operation: 'select', pageId: 1 });
  f.removeTarget();
  await assert.rejects(host.request({ ...target, operation: 'text', pageId: 1, text: 'closed tab' }), /原标签已关闭/);
  await host.request({ ...target, operation: 'command', command: { type: 'close-tab' } });
  assert.equal(f.calls.some(c => c.name === 'type_text' || c.name === 'close_page'), false);
  await host.close();
});

test('a failed first navigation mounts a retry surface with the original panel identity', async () => {
  const published: Record<string, unknown>[] = [];
  let requests = 0;
  const bridge = new BrowserChrome(async () => { requests++; throw new Error('Chrome debug permission required'); }, message => published.push(message));
  bridge.intercept({ type: 'browser-sidebar-command', ...target, command: { type: 'set-design-modifier-pressed', pressed: false } });
  assert.equal(requests, 0, 'Design modifier notifications do not start MCP or type into Chrome');
  bridge.intercept({ type: 'browser-sidebar-command', ...target, command: { type: 'navigate', url: 'https://example.test/' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1, 'No automatic replay after an uncertain navigation');
  assert.equal(published[0]?.type, 'browser-sidebar-state');
  assert.equal(published[0]?.conversationId, target.conversationId);
  assert.equal(published[0]?.browserTabId, target.browserTabId);
  let error = '';
  const unsubscribe = bridge.subscribe(target, state => { error = state.error ?? ''; });
  assert.match(error, /debug permission required/, 'A newly mounted surface receives the existing failure');
  await assert.rejects(bridge.request({ ...target, operation: 'state' }), /debug permission required/);
  assert.equal(requests, 2, 'A deliberate refresh reaches the host again');
  unsubscribe();
});
