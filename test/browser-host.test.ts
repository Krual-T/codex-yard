import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openClientBrowser } from '../src/native/client-browser.ts';
import { BrowserWorkbenchClient, WorkbenchError } from '../src/renderer/app/client.ts';
import type { WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import type { LateRpcTerminal } from '../lib/codex-protocol.ts';

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

test('only failures before the original socket send carry not-sent evidence', async t => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent: Record<string, any>[] = [];
    failSend = false;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(value: string) { this.sent.push(JSON.parse(value)); if (this.failSend) throw new Error('send failed'); }
    message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  const client = new BrowserWorkbenchClient('ws://fixture.invalid/native-host');
  t.after(() => { client.close(); if (original) Object.defineProperty(globalThis, 'WebSocket', original); else Reflect.deleteProperty(globalThis, 'WebSocket'); });
  const unavailable = client.host('configuration-write', { action: 'submit' }).catch(error => error);
  sockets[0]!.close();
  const before = await unavailable;
  assert.ok(before instanceof WorkbenchError && !before.uncertain && before.sendPhase === 'before-send');
  assert.equal(sockets[0]!.sent.length, 0);
  const connected = client.connect(), socket = sockets[1]!; socket.open(); await connected;
  const rejected = client.host('configuration-write', { action: 'submit' }).catch(error => error);
  await Promise.resolve();
  const id = socket.sent.at(-1)!.requestId;
  socket.message({ type: 'fetch-response', requestId: id, responseType: 'error', error: 'host rejected', uncertain: false, sendPhase: 'before-send' });
  const after = await rejected;
  assert.ok(after instanceof WorkbenchError && !after.uncertain && after.sendPhase === undefined);
  const circular: Record<string, unknown> = {}; circular.self = circular;
  const count = socket.sent.length;
  const serialization = await client.rpc('turn/start', circular).catch(error => error);
  assert.ok(serialization instanceof WorkbenchError && serialization.sendPhase === 'before-send');
  assert.equal(socket.sent.length, count);
  socket.failSend = true;
  const attempted = await client.host('configuration-write', { action: 'submit' }).catch(error => error);
  assert.ok(attempted instanceof WorkbenchError && attempted.uncertain && attempted.sendPhase === undefined);
  socket.failSend = false;
  const lost = client.host('configuration-write', { action: 'submit' }).catch(error => error);
  await Promise.resolve(); socket.close();
  const unknown = await lost;
  assert.ok(unknown instanceof WorkbenchError && unknown.uncertain && unknown.sendPhase === undefined);
  client.close();
  const stopped = await client.host('configuration-write', { action: 'submit' }).catch(error => error);
  assert.ok(stopped instanceof WorkbenchError && stopped.sendPhase === 'before-send');
  assert.equal(sockets.length, 2);
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

test('subscription timeouts observe only the original terminal reply and creation is published before caller continuation', async t => {
  const sockets: FakeSocket[] = [], terminals: LateRpcTerminal[] = [], order: string[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent: (SentMessage & { observeSubscriptionTerminal?: boolean })[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(_url: string) { sockets.push(this); }
    open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  const client = new BrowserWorkbenchClient('ws://fixture.invalid/native-host');
  t.after(() => {
    client.close();
    if (previous) Object.defineProperty(globalThis, 'WebSocket', previous);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
  });
  client.subscribe(event => { if (event.type === 'thread-created') order.push('creation-receipt'); });
  const opening = client.connect(); sockets[0]!.open(); await opening;
  const socket = sockets[0]!;
  const resumed = client.rpc('thread/resume', { threadId: 'same' }, 'local', { onLateTerminal: receipt => { terminals.push(receipt); } });
  const rejected = assert.rejects(resumed, error => error instanceof WorkbenchError && error.uncertain);
  await Promise.resolve(); const request = socket.sent.at(-1)!;
  assert.equal(request.observeSubscriptionTerminal, true);
  socket.message({ type: 'mcp-response', message: { id: request.request!.id, error: { message: 'Original request timed out', data: { uncertain: true } } } });
  await rejected; assert.equal(terminals.length, 0);
  socket.message({ type: 'mcp-response', late: true, message: { id: request.request!.id, result: { subscribed: true } } });
  socket.message({ type: 'mcp-response', late: true, message: { id: request.request!.id, result: { duplicate: true } } });
  assert.deepEqual(terminals, [{ outcome: 'success', result: { subscribed: true } }]);
  assert.equal(socket.sent.filter(value => value.request?.method === 'thread/resume').length, 1);

  const created = client.rpc('thread/start', {}).then(() => { order.push('caller-continuation'); });
  await Promise.resolve(); const start = socket.sent.at(-1)!;
  socket.message({ type: 'mcp-response', message: { id: start.request!.id, result: { thread: { id: 'new' } } } });
  assert.deepEqual(order, ['creation-receipt']); await created;
  assert.deepEqual(order, ['creation-receipt', 'caller-continuation']);

  const unsubscribed = client.rpc('thread/unsubscribe', { threadId: 'same' }, 'local', { onLateTerminal: receipt => { terminals.push(receipt); } });
  const failed = assert.rejects(unsubscribed, error => error instanceof WorkbenchError && error.uncertain);
  await Promise.resolve(); const old = socket.sent.at(-1)!; socket.close(); await failed;
  socket.message({ type: 'mcp-response', late: true, message: { id: old.request!.id, result: {} } });
  assert.equal(terminals.length, 1, 'A disconnected observer cannot settle the new connection');
});
