import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openClientBrowser } from '../src/native/client-browser.ts';
import { BrowserWorkbenchClient, WorkbenchError } from '../src/renderer/app/client.ts';
import type { WorkbenchEvent } from '../src/renderer/workbench-contract.ts';

interface SentMessage {
  type: string;
  hostId?: string;
  request?: { id: string; method: string; params: Record<string, unknown> };
}

test('the owned client isolates host requests and never replays them after disconnect', async t => {
  const sockets: FakeSocket[] = [], events: WorkbenchEvent[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent: SentMessage[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) { sockets.push(this); }
    open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
    send(value: string) { this.sent.push(JSON.parse(value) as SentMessage); }
    message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeSocket });
  const client = new BrowserWorkbenchClient('ws://fixture.invalid/native-host');
  client.subscribe(event => events.push(event));
  t.after(() => {
    client.close();
    if (originalSocket) Object.defineProperty(globalThis, 'WebSocket', originalSocket);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
  });

  const opening = client.connect();
  const first = sockets[0]!;
  first.open();
  await opening;
  const local = client.rpc('turn/start', { threadId: 'same-thread' }, 'local');
  const remote = client.rpc('turn/start', { threadId: 'same-thread' }, 'remote-ssh:fixture');
  const read = client.rpc('thread/read', { threadId: 'same-thread' }, 'remote-ssh:fixture');
  const failedWrite = remote.catch(error => error);
  const failedRead = read.catch(error => error);
  await Promise.resolve();
  const requests = first.sent.filter(message => message.type === 'mcp-request');
  assert.deepEqual(requests.map(message => [message.hostId, message.request?.method]), [
    ['local', 'turn/start'], ['remote-ssh:fixture', 'turn/start'], ['remote-ssh:fixture', 'thread/read'],
  ]);
  assert.equal(new Set(requests.map(message => message.request?.id)).size, 3);
  first.message({ type: 'mcp-response', hostId: 'local', message: { id: requests[0]!.request!.id, result: { host: 'local' } } });
  assert.deepEqual(await local, { host: 'local' });
  first.close();
  const writeError = await failedWrite, readError = await failedRead;
  assert.ok(writeError instanceof WorkbenchError && writeError.uncertain);
  assert.ok(readError instanceof WorkbenchError && !readError.uncertain);
  assert.ok(events.some(event => event.type === 'connection-state' && event.state === 'disconnected'));

  const reconnecting = client.connect();
  const second = sockets[1]!;
  second.open();
  await reconnecting;
  assert.deepEqual(second.sent, [{ type: 'ready' }]);
  const retriedRead = client.rpc('thread/read', { threadId: 'same-thread' }, 'remote-ssh:fixture');
  await Promise.resolve();
  const retried = second.sent[1]!;
  assert.equal(retried.request?.method, 'thread/read');
  second.message({ type: 'mcp-response', hostId: 'remote-ssh:fixture', message: { id: retried.request!.id, result: { host: 'remote' } } });
  assert.deepEqual(await retriedRead, { host: 'remote' });
  assert.equal(second.sent.filter(message => message.request?.method === 'turn/start').length, 0);
});

test('the retained client browser helper opens safe links synchronously on the visiting client', t => {
  const calls: unknown[][] = [];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: (...args: unknown[]) => calls.push(args) } });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  assert.equal(openClientBrowser({ type: 'open-in-browser', url: 'https://example.com/path?q=1' }), true);
  assert.equal(openClientBrowser({ type: 'open-url', url: 'http://localhost:3000/' }), true);
  assert.deepEqual(calls, [
    ['https://example.com/path?q=1', '_blank', 'noopener,noreferrer'],
    ['http://localhost:3000/', '_blank', 'noopener,noreferrer'],
  ]);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:secret@example.com', 'not a url']) {
    assert.throws(() => openClientBrowser({ type: 'open-in-browser', url }));
  }
  assert.equal(openClientBrowser({ type: 'unrelated' }), false);
  assert.equal(calls.length, 2);
});
