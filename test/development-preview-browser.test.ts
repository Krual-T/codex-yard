import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { BrowserChrome } from '../src/browser-reuse/browser-bridge.ts';

const target = { conversationId: 'thread', browserTabId: 'tab' };
test('preview URLs preserve their source across reload and ignore obsolete asynchronous navigation', async () => {
  const replies: ((value: { url: string }) => void)[] = [];
  const requested: unknown[] = [];
  const bridge = new BrowserChrome(async (endpoint, body) => {
    assert.equal(endpoint, 'development-preview'); requested.push(body);
    return new Promise(resolve => replies.push(resolve));
  }, () => {});
  bridge.enableEmbeddedPages();
  bridge.setConversationHost(target.conversationId, 'local');
  const source = 'http://127.0.0.1:3000/path?q=1#section';
  assert.equal(bridge.embeddedPage(target, source).loading, true);
  replies[0]!({ url: 'https://preview.example.ts.net:40000/path?q=1#section' }); await setImmediate();
  assert.equal(bridge.embeddedPage(target).url, source);
  assert.equal(bridge.embeddedPage(target).src, 'https://preview.example.ts.net:40000/path?q=1#section');
  bridge.retryEmbeddedPage(target);
  assert.equal((requested[1] as { url: string }).url, source);
  bridge.intercept({ type: 'browser-sidebar-command', ...target, command: { type: 'navigate', url: 'https://external.test/' } });
  replies[1]!({ url: 'https://preview.example.ts.net:40001/path' }); await setImmediate();
  assert.equal(bridge.embeddedPage(target).url, 'https://external.test/');
  assert.equal(bridge.embeddedPage(target).src, undefined);
});

test('preview failure offers a fresh retry and disposed pages discard pending results', async () => {
  let attempts = 0;
  const bridge = new BrowserChrome(async () => {
    if (++attempts === 1) throw new Error('Tailscale unavailable');
    return { url: 'https://preview.example.ts.net:40000/' };
  }, () => {});
  bridge.enableEmbeddedPages(); bridge.setConversationHost(target.conversationId, 'local'); bridge.embeddedPage(target, 'http://localhost:3000/'); await setImmediate();
  assert.equal(bridge.embeddedPage(target).error, 'Tailscale unavailable');
  bridge.retryEmbeddedPage(target); bridge.releaseView(target); await setImmediate();
  assert.equal(bridge.embeddedPage(target).url, 'about:blank');
  assert.equal(bridge.embeddedPage(target).src, undefined);
});

test('preview resolution uses the existing browser owner host and leaves external sites direct', async () => {
  let host: unknown, calls = 0;
  const bridge = new BrowserChrome(async (_endpoint, body) => { calls++; host = (body as { hostId: string }).hostId; return { url: 'http://localhost:3000/' }; }, () => {});
  bridge.enableEmbeddedPages();
  bridge.intercept({ type: 'browser-sidebar-owner-sync', conversationId: target.conversationId, ownerRoutePath: '/remote-ssh-server/thread' });
  bridge.embeddedPage(target, 'http://localhost:3000/'); await setImmediate();
  assert.equal(host, 'remote-ssh-server'); assert.equal(calls, 1);
  bridge.intercept({ type: 'browser-sidebar-command', ...target, command: { type: 'navigate', url: 'https://external.test/' } });
  assert.equal(bridge.embeddedPage(target).loading, false); assert.equal(calls, 1);
});

test('a missing owner never forwards to local and an owner change invalidates the old result', async () => {
  const requests: { hostId: string; resolve(value: { url: string }): void }[] = [];
  const bridge = new BrowserChrome(async (_endpoint, body) => new Promise(resolve => requests.push({ hostId: (body as { hostId: string }).hostId, resolve })), () => {});
  bridge.enableEmbeddedPages(); bridge.embeddedPage(target, 'http://127.0.0.1:3000/');
  assert.equal(requests.length, 0); assert.equal(bridge.embeddedPage(target).loading, true);
  bridge.setConversationHost(target.conversationId, 'local');
  bridge.setConversationHost(target.conversationId, 'remote-ssh-second');
  assert.deepEqual(requests.map(request => request.hostId), ['local', 'remote-ssh-second']);
  requests[0]!.resolve({ url: 'https://old.example/' }); await setImmediate();
  assert.equal(bridge.embeddedPage(target).src, undefined);
  requests[1]!.resolve({ url: 'https://new.example/' }); await setImmediate();
  assert.equal(bridge.embeddedPage(target).src, 'https://new.example/');
});
