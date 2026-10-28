import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChromePanelHost } from '../src/browser-reuse/panel-host.ts';
import { BrowserChrome } from '../src/browser-reuse/browser-bridge.ts';
import type { ToolResult } from '../src/browser-reuse/chrome-mcp.ts';
import type { ChromeElementContext, ChromePanelState } from '../src/browser-reuse/protocol.ts';

const target = { conversationId: 'thread-a', browserTabId: 'browser-a' };
const element: ChromeElementContext = { kind: 'element', pageUrl: 'https://fixture.test/', framePath: [],
  title: 'Selected button', immediateText: 'Selected button', role: 'button', name: 'Selected button', selector: '#chosen', elementPath: '#chosen', nearbyText: 'Selected button',
  rect: { x: 1, y: 2, width: 30, height: 40 }, elementMetadata: { tag: 'button', colors: 'color: red' } };

test('element context uses the selected DevTools UID on the bound page, with no fallback or page mutation', async () => {
  let selected = true, pageExists = true;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const tools = { async close() {}, async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    calls.push({ name, args });
    if (name === 'list_pages') return { content: [], structuredContent: { pages: pageExists ? [
      { id: 1, url: element.pageUrl, selected: false }, { id: 2, url: 'https://other.test/', selected: true },
    ] : [{ id: 2, url: 'https://other.test/', selected: true }] } };
    if (name === 'take_snapshot') return { content: [{ type: 'text', text: 'uid=3_1 button "Selected button"' + (selected ? ' [selected in the DevTools Elements panel]' : '') }] };
    if (name === 'take_screenshot') return { content: [{ type: 'image', mimeType: 'image/jpeg', data: 'fixture' }] };
    return { content: [{ type: 'text', text: '```json\n' + JSON.stringify(args.args ? element : { url: element.pageUrl, title: 'Fixture', width: 800, height: 600 }) + '\n```' }] };
  } };
  const host = new ChromePanelHost({ browserUrl: 'http://127.0.0.1:9222' }, () => {}, 'http://workbench', async () => tools);
  try {
    await host.request({ ...target, operation: 'select', pageId: 1 });
    calls.length = 0;
    assert.deepEqual((await host.request({ ...target, operation: 'element-context', pageId: 1 })).elementContext, element);
    assert.deepEqual(calls.map(call => call.name), ['list_pages', 'take_snapshot', 'evaluate_script']);
    assert.deepEqual(calls[1]!.args, { pageId: 1, verbose: true });
    assert.equal(calls[2]!.args.pageId, 1);
    assert.deepEqual(calls[2]!.args.args, ['3_1']);
    selected = false;
    calls.length = 0;
    await assert.rejects(host.request({ ...target, operation: 'element-context', pageId: 1 }), /Ctrl\+Shift\+C/);
    assert.equal(calls.some(call => call.name === 'evaluate_script'), false, 'No selected UID means no guessed DOM query');
    await host.request({ ...target, operation: 'select', pageId: 2 });
    calls.length = 0;
    await assert.rejects(host.request({ ...target, operation: 'element-context', pageId: 1 }), /标签已切换/);
    assert.deepEqual(calls.map(call => call.name), ['list_pages']);
    await host.request({ ...target, operation: 'select', pageId: 1 });
    pageExists = false;
    await assert.rejects(host.request({ ...target, operation: 'element-context', pageId: 1 }), /原标签已关闭/);
  } finally { await host.close(); }
});

test('legacy comment writes are rejected and late selections cannot attach after connection changes', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const legacyRaw = '{"thread-a":[{"unknown":"keep"}]}';
  const storage = new Map<string, string>([['workbench.browser-comments.v1', legacyRaw]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
  } });
  try {
    const events: Record<string, unknown>[] = [];
    const state: ChromePanelState = { location: 'Chrome', configured: true, pages: [], pageId: 1 };
    let pending: ((value: ChromePanelState) => void) | undefined;
    let wait = false;
    const bridge = new BrowserChrome(async (_endpoint, body) => {
      if ((body as { operation: string }).operation === 'element-context') {
        if (wait) return await new Promise<ChromePanelState>(resolve => { pending = resolve; });
        return { ...state, elementContext: element };
      }
      return state;
    }, message => events.push(message));
    bridge.setCommentConverter(comment => ({ ...comment, origin: 'browser' }));
    await bridge.request({ ...target, operation: 'state' });
    await assert.rejects(bridge.quoteSelectedElement(target, 1), /旧浏览器批注入口已停用/);
    assert.throws(() => bridge.getCommentDrafts(), /旧浏览器批注入口已停用/);
    assert.equal(bridge.getState(target)?.elementContext, undefined, 'Selection data is not cached in Chrome frames');
    assert.throws(() => bridge.intercept({ type: 'shared-object-set', key: 'diff_comments', value: {} }), /旧浏览器批注入口已停用/);
    assert.throws(() => bridge.intercept({ type: 'shared-object-subscribe', key: 'diff_comments' }), /旧浏览器批注入口已停用/);
    assert.equal(storage.get('workbench.browser-comments.v1'), legacyRaw);
    wait = true;
    const quote = bridge.quoteSelectedElement(target, 1);
    await Promise.resolve();
    await bridge.selectConnection(target, 'server');
    pending!({ ...state, elementContext: element });
    await assert.rejects(quote, /浏览器面板已切换/);
    assert.equal(storage.get('workbench.browser-comments.v1'), legacyRaw);
    assert.equal(events.filter(event => event.type === 'shared-object-updated').length, 0);
    bridge.setCommentRouteResolver(route => route === '/' ? 'new-conversation' : 'thread-a');
    bridge.intercept({ type: 'browser-sidebar-owner-sync', ...target, ownerRoutePath: '/' });
    wait = false;
    await assert.rejects(bridge.quoteSelectedElement(target, 1), /旧浏览器批注入口已停用/);
    wait = true;
    const moved = bridge.quoteSelectedElement(target, 1);
    await Promise.resolve();
    bridge.intercept({ type: 'browser-sidebar-owner-sync', ...target, ownerRoutePath: '/local/thread-a' });
    pending!({ ...state, elementContext: element });
    await assert.rejects(moved, /浏览器面板已切换/);
    assert.equal(storage.get('workbench.browser-comments.v1'), legacyRaw);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
