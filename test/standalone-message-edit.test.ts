import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, NO_REPLY } from './fake-codex.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-edit-'), fake = await createFakeCodex(root);
  const thread = fixtureThread('thread', root, { turns: [fixtureTurn('before'), fixtureTurn('source', [
    { id: 'user', type: 'userMessage', clientId: null, content: [{ type: 'text', text: 'original' }] },
    { id: 'assistant', type: 'agentMessage', text: 'answer' },
  ])] });
  fake.threads.set('thread', thread);
  const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'home'), dataDir: join(root, 'data'), workspace: root, port: 0 });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  async function connect() {
    const socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url }); sockets.push(socket);
    const messages: Record<string, unknown>[] = [];
    socket.on('message', value => { messages.push(JSON.parse(String(value))); socket.emit('received'); });
    await once(socket, 'open');
    async function request(message: Record<string, unknown>, predicate: (value: Record<string, unknown>) => boolean) {
      socket.send(JSON.stringify(message));
      const signal = AbortSignal.timeout(3000);
      while (!messages.some(predicate)) await once(socket, 'received', { signal });
      return messages.find(predicate)!;
    }
    let next = 0;
    return {
      async edit(operation: string, extra: Record<string, unknown> = {}) {
        const requestId = String(++next);
        return request({ type: 'fetch', requestId, url: 'vscode://codex/message-edit', body: JSON.stringify({
          hostId: 'local', threadId: 'thread', operation, origin: { hostId: 'local', threadId: 'thread', turnId: 'source', itemId: 'user' },
          clientUserMessageId: 'edited-client-id', expectedTurnIds: ['before', 'source'], turnParams: { input: [{ type: 'text', text: 'edited' }] }, ...extra,
        }) }, value => value.type === 'fetch-response' && value.requestId === requestId);
      },
      async start() {
        const id = 'start-' + ++next;
        return request({ type: 'mcp-request', hostId: 'local', request: { id, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'other page' }] } } },
          value => value.type === 'mcp-response' && record(value.message).id === id);
      },
    };
  }
  return { fake, thread, connect };
}

test('reverted edit retries start alone and a protocol clientId reconciles an already started edit', async t => {
  const h = await fixture(t), page = await h.connect();
  h.fake.handlers.set('turn/start', () => { throw new Error('explicit start refusal'); });
  const first = record((await page.edit('submit')).body);
  assert.equal(first.stage, 'reverted'); assert.match(String(first.error), /explicit start refusal/);
  assert.deepEqual(h.thread.turns.map(turn => turn.id), ['before']);
  h.fake.handlers.delete('turn/start');
  assert.equal(record((await page.edit('retry-start')).body).stage, 'started');
  assert.equal(h.fake.calls('thread/revert').length, 1);
  assert.equal(record((await page.edit('check')).body).stage, 'started');
  assert.equal(h.fake.calls('turn/start').length, 2);
});

test('an unknown start is read back without replay and a changed history blocks a retry', async t => {
  const h = await fixture(t), page = await h.connect();
  h.fake.handlers.set('turn/start', params => {
    h.fake.defaultResult('turn/start', record(params)); h.fake.disconnect(); return NO_REPLY;
  });
  assert.equal(record((await page.edit('submit')).body).stage, 'startUnknown');
  h.fake.handlers.delete('turn/start');
  assert.equal(record((await page.edit('check')).body).stage, 'started');
  assert.equal(h.fake.calls('turn/start').length, 1);
  h.thread.status = { type: 'idle' }; h.thread.turns.at(-1)!.status = 'completed';
  assert.equal(record((await page.edit('retry-start')).body).stage, 'conflict');
  assert.equal(h.fake.calls('thread/revert').length, 1); assert.equal(h.fake.calls('turn/start').length, 1);
});

test('a different page cannot interleave ordinary turn/start inside edit revert/start', async t => {
  const h = await fixture(t), editor = await h.connect(), other = await h.connect();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.fake.handlers.set('thread/revert', async params => { await gate; return h.fake.defaultResult('thread/revert', record(params)); });
  h.fake.handlers.set('turn/start', params => {
    if (h.thread.status.type === 'active') throw new Error('a turn is already active');
    return h.fake.defaultResult('turn/start', record(params));
  });
  const editing = editor.edit('submit'); await h.fake.waitForCall('thread/revert');
  const concurrent = other.start(); await pause(25);
  assert.equal(h.fake.calls('turn/start').length, 0);
  release(); assert.equal(record((await editing).body).stage, 'started');
  assert.match(String(record(record((await concurrent).message).error).message), /already active/);
  assert.deepEqual(h.fake.calls('turn/start').map(call => record((call.params.input as unknown[])[0]).text), ['edited', 'other page']);
});

test('edit origin and latest-user preconditions are checked before destructive writes', async t => {
  const h = await fixture(t), page = await h.connect();
  const mismatch = await page.edit('submit', { origin: { hostId: 'ssh-other', threadId: 'thread', turnId: 'source', itemId: 'user' } });
  assert.equal(mismatch.responseType, 'error'); assert.equal(h.fake.calls('thread/revert').length, 0);
  h.thread.turns.push(fixtureTurn('later', [{ id: 'later-user', type: 'userMessage', content: [{ type: 'text', text: 'later' }] }]));
  assert.equal((await page.edit('submit', { expectedTurnIds: ['before', 'source', 'later'] })).responseType, 'error');
  assert.equal(h.fake.calls('thread/revert').length, 0);
});
