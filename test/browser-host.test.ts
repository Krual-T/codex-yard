import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

function browserStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key), key: (index: number) => [...values.keys()][index] ?? null, get length() { return values.size; } };
}

test('equal RPC ids on separate hosts retain separate pending results after the browser connection is lost', async () => {
  const received: any[] = [], sockets: BrowserSocket[] = [];
  class BrowserSocket extends EventTarget {
    static OPEN = 1;
    sent: any[] = [];
    constructor() { super(); sockets.push(this); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    message(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  }
  const window: any = Object.assign(new EventTarget(), { postMessage: (message: unknown) => received.push(message) });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true, querySelector: () => null });
  runInNewContext(await readFile(new URL('../.local/native-host.js', import.meta.url), 'utf8'), {
    window, document, localStorage: browserStorage(), WebSocket: BrowserSocket, URLSearchParams, location: { origin: 'http://workbench.test', href: 'http://workbench.test/' },
    setTimeout() {}, matchMedia: () => ({ matches: false }), performance: { timeOrigin: 0 },
  });
  const socket = sockets[0]!;
  socket.dispatchEvent(new Event('open'));
  const remote = 'remote-ssh-discovered:work';
  await Promise.all(['local', remote].map(hostId => window.electronBridge.sendMessageFromView({
    type: 'mcp-request', hostId, request: { id: 1, method: 'turn/start', params: { threadId: 'shared-id' } },
  })));
  socket.message({ type: 'mcp-response', hostId: 'local', message: { id: 1, result: {} } });
  socket.message({ type: 'codex-app-server-connection-changed', hostId: remote, state: 'connected', transport: 'websocket' });
  socket.dispatchEvent(new Event('close'));
  const failures = received.filter(message => message.type === 'mcp-response' && message.message.error);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].hostId, remote);
  assert.equal(failures[0].message.id, 1);
  assert.equal(failures[0].message.error.data.uncertain, true);
  assert.equal(socket.sent.length, 2);
  assert.ok(received.some(message => message.type === 'codex-app-server-connection-changed' && message.hostId === remote && message.state === 'disconnected'));
  await window.electronBridge.sendMessageFromView({ type: 'electron-window-focus-request' });
  assert.equal(received.at(-1).type, 'electron-window-focus-changed');
  assert.equal(received.at(-1).isFocused, true);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(received.at(-1).isFocused, false);
  assert.equal(socket.sent.length, 2, 'focus stays on the visiting browser even when the socket is lost');
});

test('renderer browser links open on the visiting client before a socket or server round trip', async () => {
  const calls: unknown[][] = [], sent: unknown[] = [], received: any[] = [];
  class BrowserSocket extends EventTarget { send(value: unknown) { sent.push(value); } }
  const window: any = { open: (...args: unknown[]) => calls.push(args), postMessage: (message: unknown) => received.push(message), addEventListener() {} };
  runInNewContext(await readFile(new URL('../.local/native-host.js', import.meta.url), 'utf8'), {
    window, document: Object.assign(new EventTarget(), { querySelector: () => null }), localStorage: browserStorage(), WebSocket: BrowserSocket, URL, URLSearchParams, location: { origin: 'http://workbench.test', href: 'http://workbench.test/' },
    setTimeout() {}, matchMedia: () => ({ matches: false }), performance: { timeOrigin: 0 },
  });
  // Leave the socket unopened: a real click must preserve user activation.
  await window.electronBridge.sendMessageFromView({ type: 'open-in-browser', hostId: 'remote-ssh:test', url: 'https://example.com/path?q=1' });
  await window.electronBridge.sendMessageFromView({ type: 'open-url', url: 'http://localhost:3000/' });
  await window.electronBridge.sendMessageFromView({ type: 'open-in-browser', hostId: 'local', url: 'http://127.0.0.1:8784/gallery.html?q=1#cluster-8' });
  await window.electronBridge.sendMessageFromView({ type: 'open-url', hostId: 'remote-ssh:test', url: 'http://localhost:3000/remote.html' });
  assert.deepEqual(calls, [
    ['https://example.com/path?q=1', '_blank', 'noopener,noreferrer'],
    ['http://localhost:3000/', '_blank', 'noopener,noreferrer'],
    ['http://workbench.test/api/local-html-preview?url=http%3A%2F%2F127.0.0.1%3A8784%2Fgallery.html%3Fq%3D1#cluster-8', '_blank', 'noopener,noreferrer'],
    ['http://localhost:3000/remote.html', '_blank', 'noopener,noreferrer'],
  ]);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:secret@example.com']) {
    await assert.rejects(window.electronBridge.sendMessageFromView({ type: 'open-in-browser', url }));
  }
  assert.equal(calls.length, 4);
  for (const url of ['https://example.com/page', 'http://127.0.0.1:8784/gallery.html?q=1#anchor']) {
    await window.electronBridge.sendMessageFromView({ type: 'open-in-browser', conversationId: 'test-thread', hostId: 'local', url });
  }
  assert.deepEqual(received.map(message => [message.type, message.conversationId, message.url, message.presentationIntent]), [
    ['toggle-browser-panel', 'test-thread', 'https://example.com/page', 'split'],
    ['toggle-browser-panel', 'test-thread', 'http://workbench.test/api/local-html-preview?url=http%3A%2F%2F127.0.0.1%3A8784%2Fgallery.html%3Fq%3D1#anchor', 'split'],
  ]);
  assert.equal(calls.length, 4, 'ordinary conversation links use the panel without opening another browser tab');
  for (const options of [{ openTarget: 'external-browser' }, { useExternalBrowser: true },
    { disposition: 'new-background-tab', clickModifiers: { ctrlKey: true } }]) {
    await window.electronBridge.sendMessageFromView({ type: 'open-in-browser', conversationId: 'test-thread', url: 'https://example.com/external', ...options });
  }
  assert.equal(calls.length, 7, 'explicit external and modified clicks retain an external browser destination');
  assert.equal(received.length, 2);
  assert.equal(sent.length, 0);
});

test('edits received before React starts invalidate the corresponding sidebar bootstrap values', async () => {
  let socket: BrowserSocket;
  class BrowserSocket extends EventTarget { constructor() { super(); socket = this; } send() {} }
  const window: any = { addEventListener() {}, postMessage() {} };
  runInNewContext(await readFile(new URL('../.local/native-host.js', import.meta.url), 'utf8'), {
    window, document: Object.assign(new EventTarget(), { querySelector: () => null }), localStorage: browserStorage(), WebSocket: BrowserSocket, URLSearchParams,
    location: { origin: 'http://workbench.test', pathname: '/', href: 'http://workbench.test/' },
    setTimeout() {}, matchMedia: () => ({ matches: false }), performance: { timeOrigin: 0, mark() {} },
  });
  const receive = (value: unknown) => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  receive({ type: 'yard-sidebar-bootstrap', value: { globalStateEntries: [
    { key: 'local-projects', value: {} }, { key: 'pinned-thread-ids', value: ['old'] }, { key: 'selected-project', value: 'old' },
  ] } });
  assert.equal(window.electronBridge.getInitialSidebarBootstrap().globalStateEntries.length, 3);
  receive({ type: 'global-state-updated', keys: ['selected-project'] });
  receive({ type: 'pinned-threads-updated' });
  assert.deepEqual(Array.from(window.electronBridge.getInitialSidebarBootstrap().globalStateEntries, (entry: any) => entry.key), ['local-projects']);
});
