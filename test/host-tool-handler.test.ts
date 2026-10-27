import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHostToolHandler } from '../lib/host-tools.ts';
import type { AppToolCall } from '../lib/app-tools.ts';
import { RpcError } from '../lib/codex.ts';

function fixture() {
  const reads: unknown[] = [], writes: unknown[] = [];
  const handler = createHostToolHandler({
    connection: { async request(method, params, options) { writes.push({ method, params, options }); return {}; } },
    knownThread: async id => { reads.push({ known: id }); },
    listProjects: async () => ({ projects: [] }),
    listThreads: async args => { reads.push(args); return { data: [] }; },
    readThread: async args => { reads.push(args); return { thread: { id: args.threadId } }; },
  });
  function call(tool: string, args: unknown): AppToolCall {
    return { callerSource: 'codex', hostId: 'local', threadId: 'caller', turnId: 'turn', callId: 'call',
      namespace: 'codex_app', tool, arguments: args };
  }
  return { handler, call, reads, writes };
}

test('host tools reject unadvertised tools, extra keys and invalid arguments before reading or writing', async () => {
  const h = fixture();
  for (const [tool, args] of [
    ['not_advertised', {}], ['list_projects', { secret: true }], ['list_threads', { limit: 1.5 }],
    ['list_threads', { limit: 101 }], ['list_threads', { cursor: null }], ['read_thread', {}],
    ['read_thread', { threadId: 'x', hostId: 'remote' }], ['read_thread', { threadId: 'x', includeOutputs: 'true' }],
    ['read_thread', { threadId: 'x', maxOutputCharsPerItem: -1 }], ['set_thread_title', []],
  ] satisfies [string, unknown][]) {
    assert.equal((await h.handler(h.call(tool, args))).success, false);
  }
  assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []);
});

test('title writes use caller attribution and retain mutating semantics; history reads preserve validated pagination', async () => {
  const h = fixture();
  assert.equal((await h.handler(h.call('set_thread_title', { title: 'Other', threadId: 'another' }))).success, false);
  assert.deepEqual(h.writes, []);
  const title = await h.handler(h.call('set_thread_title', { title: '  🛠️ Literal $(title)  ' }));
  assert.equal(title.success, true);
  assert.deepEqual(h.writes, [{ method: 'thread/name/set', params: { threadId: 'caller', name: '🛠️ Literal $(title)' }, options: { mutating: true } }]);
  const args = { threadId: 'another', hostId: 'local', cursor: 'opaque', turnLimit: 2, includeOutputs: false, maxOutputCharsPerItem: 100 };
  assert.equal((await h.handler(h.call('read_thread', args))).success, true);
  assert.deepEqual(h.reads.at(-1), args);
});

test('host tool cancellation propagates and uncertain writes remain failures', async () => {
  const h = fixture(), controller = new AbortController();
  controller.abort();
  await assert.rejects(h.handler(h.call('list_projects', {}), { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(h.reads, []);
  const uncertain = createHostToolHandler({
    connection: { async request() { throw new RpcError('write disconnected', { uncertain: true }); } },
    knownThread: async () => {}, listProjects: async () => [], listThreads: async () => [], readThread: async () => ({}),
  });
  const result = await uncertain(h.call('set_thread_title', { title: 'Pending' }));
  assert.equal(result.success, false);
  assert.deepEqual(JSON.parse(result.contentItems[0].text), { error: 'write disconnected', uncertain: true });
});
