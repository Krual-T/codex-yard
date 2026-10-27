import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('equal RPC ids on separate hosts retain separate pending results after the browser connection is lost', async () => {
  const received: any[] = [], sockets: BrowserSocket[] = [];
  class BrowserSocket extends EventTarget {
    static OPEN = 1;
    sent: any[] = [];
    constructor() { super(); sockets.push(this); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    message(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  }
  const window: any = { postMessage: (message: unknown) => received.push(message), addEventListener() {} };
  runInNewContext(await readFile(new URL('../.local/native-host.js', import.meta.url), 'utf8'), {
    window, WebSocket: BrowserSocket, location: { origin: 'http://workbench.test', href: 'http://workbench.test/' },
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
});

test('renderer browser links open on the visiting client before a socket or server round trip', async () => {
  const calls: unknown[][] = [], sent: unknown[] = [];
  class BrowserSocket extends EventTarget { send(value: unknown) { sent.push(value); } }
  const window: any = { open: (...args: unknown[]) => calls.push(args), addEventListener() {} };
  runInNewContext(await readFile(new URL('../.local/native-host.js', import.meta.url), 'utf8'), {
    window, WebSocket: BrowserSocket, URL, location: { origin: 'http://workbench.test', href: 'http://workbench.test/' },
    setTimeout() {}, matchMedia: () => ({ matches: false }), performance: { timeOrigin: 0 },
  });
  // Leave the socket unopened: a real click must preserve user activation.
  await window.electronBridge.sendMessageFromView({ type: 'open-in-browser', hostId: 'remote-ssh:test', url: 'https://example.com/path?q=1' });
  await window.electronBridge.sendMessageFromView({ type: 'open-url', url: 'http://localhost:3000/' });
  assert.deepEqual(calls, [
    ['https://example.com/path?q=1', '_blank', 'noopener,noreferrer'],
    ['http://localhost:3000/', '_blank', 'noopener,noreferrer'],
  ]);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:secret@example.com']) {
    await assert.rejects(window.electronBridge.sendMessageFromView({ type: 'open-in-browser', url }));
  }
  assert.equal(calls.length, 2);
  assert.equal(sent.length, 0);
});
