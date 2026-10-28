import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CodexConnection } from '../lib/codex.ts';
import type { AppToolCall } from '../lib/app-tools.ts';
import { createSessionToolHandler, sessionToolCatalog } from '../lib/session-tools.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem, commandItem, NO_REPLY } from './fake-codex.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp('/tmp/yard-session-tools-');
  const fake = await createFakeCodex(root);
  const caller = fixtureThread('caller', root);
  const target = fixtureThread('target', root, { model: 'keep-target-model' });
  fake.threads.set(caller.id, caller);
  fake.threads.set(target.id, target);
  const connection = new CodexConnection(fake.socketPath, { timeout: 1000 });
  await connection.connect();
  const handler = createSessionToolHandler(connection);
  t.after(async () => { connection.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  async function call(tool: string, args: unknown, signal?: AbortSignal) {
    const params: AppToolCall = { callerSource: 'codex', hostId: 'local', namespace: 'codex_app',
      threadId: caller.id, turnId: 'caller-turn', callId: 'call-' + tool, tool, arguments: args };
    const result = await handler(params, { signal });
    return { success: result.success, value: JSON.parse(result.contentItems[0].text) };
  }
  return { root, fake, caller, target, call, connection };
}

test('shared creation inherits the directory and daemon defaults; partial failure preserves the created identity', async t => {
  const h = await fixture(t);
  const created = await h.call('create_thread', { title: '🛠️ Synthetic task', message: 'Synthetic work' });
  assert.equal(created.success, true);
  assert.equal(created.value.created, true);
  const start = h.fake.calls('thread/start')[0].params;
  assert.deepEqual(start, { cwd: h.root, historyMode: 'paginated' });
  assert.equal(h.fake.threads.get(created.value.threadId)?.name, '🛠️ Synthetic task');
  assert.equal(h.fake.calls('turn/start').length, 1);
  assert.equal(h.fake.calls('turn/start')[0].params.threadId, created.value.threadId);
  assert.equal(h.fake.calls('thread/resume').length, 0, 'a new thread receives its first turn directly before any resume');

  h.fake.handlers.set('thread/name/set', () => { throw new Error('Name write refused'); });
  const partial = await h.call('create_thread', { title: '🛠️ Another task', cwd: '/explicit', model: 'explicit', effort: 'high', message: 'Never sent' });
  assert.equal(partial.success, false);
  assert.equal(partial.value.created, true);
  assert.ok(h.fake.threads.has(partial.value.threadId));
  assert.match(partial.value.error, /Name write refused/);
  assert.equal(h.fake.calls('turn/start').length, 1);
  assert.deepEqual(h.fake.calls('thread/start')[1].params, { cwd: '/explicit', model: 'explicit', historyMode: 'paginated', config: { model_reasoning_effort: 'high' } });
});

test('simultaneous sends preserve target settings and each submit once to the actual active turn', async t => {
  const h = await fixture(t);
  const active = fixtureTurn('existing-active', [], 'inProgress');
  h.target.turns = [active];
  h.target.status = { type: 'active', activeFlags: [] };
  h.fake.handlers.set('turn/start', params => {
    assert.equal(params.threadId, h.target.id);
    active.items.push({ id: String(active.items.length), type: 'userMessage', content: params.input });
    return { turn: active };
  });
  const results = await Promise.all(['from App', 'from Yard'].map(message => h.call('send_message_to_thread', { threadId: h.target.id, message })));
  assert.deepEqual(results.map(result => result.value.turnId), ['existing-active', 'existing-active']);
  assert.equal(active.items.length, 2);
  for (const call of h.fake.calls('thread/resume')) assert.deepEqual(call.params, { threadId: h.target.id, excludeTurns: true });
  for (const call of h.fake.calls('turn/start')) {
    assert.equal(call.params.config, undefined);
    assert.equal(call.params.model, undefined);
    assert.equal(call.params.approvalPolicy, undefined);
  }
  assert.equal(h.target.model, 'keep-target-model');
  assert.equal(h.fake.calls('turn/start').length, 2);
  assert.equal(h.fake.calls('turn/steer').length, 0);
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
});

test('an acknowledged-lost submission reports uncertainty and never reconnects or resends', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('turn/start', (params, { socket }) => {
    h.fake.defaultResult('turn/start', params);
    socket.terminate();
    return NO_REPLY;
  });
  const result = await h.call('send_message_to_thread', { threadId: h.target.id, message: 'Only once' });
  assert.equal(result.success, false);
  assert.equal(result.value.uncertain, true);
  assert.equal(h.fake.calls('turn/start').length, 1);
  assert.equal(h.target.turns.length, 1);
  assert.equal(h.fake.calls('initialize').length, 1);
});

test('history uses read-only pagination, omits output by default and marks bounded text', async t => {
  const h = await fixture(t);
  h.target.turns = [fixtureTurn('history', [agentItem('answer', 'x'.repeat(30)), commandItem('command', 'private output', h.root)])];
  const result = await h.call('read_thread', { threadId: h.target.id, limit: 1, maxOutputCharsPerItem: 5 });
  assert.equal(result.success, true);
  assert.equal(result.value.data.length, 1);
  assert.equal(result.value.data[0].item.output, undefined);
  assert.equal(result.value.nextCursor, '1');
  const next = await h.call('read_thread', { threadId: h.target.id, cursor: result.value.nextCursor, maxOutputCharsPerItem: 5 });
  assert.equal(next.value.data[0].item.text, 'xxxxx');
  assert.equal(next.value.data[0].item.truncated, true);
  const output = await h.call('read_thread', { threadId: h.target.id, includeOutputs: true, maxOutputCharsPerItem: 5 });
  assert.equal(output.value.data[0].item.output, 'priva');
  for (const method of ['thread/resume', 'turn/start', 'thread/start']) assert.equal(h.fake.calls(method).length, 0);
});

test('waiting returns any ready target, keeps unloaded/error states distinct and never interrupts', async t => {
  const h = await fixture(t);
  h.target.status = { type: 'active', activeFlags: [] };
  const timeout = await h.call('wait_threads', { threadIds: [h.target.id], timeoutMs: 0 });
  assert.equal(timeout.value.timedOut, true);
  h.caller.status = { type: 'notLoaded' };
  const ready = await h.call('wait_threads', { threadIds: [h.caller.id, h.target.id, 'missing'], timeoutMs: 1000 });
  assert.equal(ready.value.timedOut, false);
  assert.deepEqual(ready.value.threads.map((item: { status: { type: string } }) => item.status.type), ['notLoaded', 'active', 'error']);
  const controller = new AbortController();
  const waiting = h.call('wait_threads', { threadIds: [h.target.id], timeoutMs: 1000 }, controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(h.fake.calls('thread/resume').length, 0);
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
});

test('large history output stays within one bounded MCP response and retains its continuation cursor', async t => {
  const h = await fixture(t);
  h.target.turns = [fixtureTurn('large-history', Array.from({ length: 101 }, (_, index) =>
    commandItem('command-' + index, 'x'.repeat(20_000), h.root)))];
  const result = await h.call('read_thread', { threadId: h.target.id, limit: 100, includeOutputs: true, maxOutputCharsPerItem: 20_000 });
  assert.equal(result.value.data.length, 100);
  assert.ok(JSON.stringify(result.value).length < 250_000);
  assert.ok(result.value.data.every((entry: { item: { truncated?: boolean } }) => entry.item.truncated));
  assert.equal(result.value.nextCursor, '100');
});

test('a missing daemon status response uses the wait budget and reports timeout without interruption', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('thread/read', params => params.threadId === h.target.id ? NO_REPLY : h.fake.defaultResult('thread/read', params));
  const started = Date.now();
  const result = await h.call('wait_threads', { threadIds: [h.target.id], timeoutMs: 20 });
  assert.equal(result.value.timedOut, true);
  assert.equal(result.value.threads[0].status.code, 'TIMEOUT');
  assert.ok(Date.now() - started < 500, 'the wait does not use the longer transport timeout');
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
});

test('shared tools reject wrong identities, malformed arguments and subagent targets before mutation', async t => {
  const h = await fixture(t);
  for (const [name, args] of [
    ['set_thread_title', { title: 'Denied', threadId: h.target.id }],
    ['create_thread', { title: 'invalid\ntitle', message: 'Work' }],
    ['create_thread', { title: 'Valid', message: 'Work', cwd: 'relative' }],
    ['create_thread', { title: 'Missing first message' }],
    ['send_message_to_thread', { threadId: h.caller.id, message: 'self' }],
    ['wait_threads', { threadIds: 'not an array' }],
    ['wait_threads', { threadIds: [] }],
    ['list_threads', { limit: 101 }],
    ['not_implemented', {}],
  ] as const) assert.equal((await h.call(name, args)).success, false);
  h.fake.threads.set('subagent', fixtureThread('subagent', h.root, { source: { subAgent: { thread_spawn: { parent_thread_id: h.caller.id } } } }));
  assert.equal((await h.call('send_message_to_thread', { threadId: 'subagent', message: 'denied' })).success, false);
  for (const method of ['thread/start', 'thread/name/set', 'thread/resume', 'turn/start']) assert.equal(h.fake.calls(method).length, 0);
});

test('the standalone stdio MCP routes actual metadata and survives a separate Yard connection closing', async t => {
  const h = await fixture(t);
  const yard = new CodexConnection(h.fake.socketPath);
  await yard.connect();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/conversation-mcp.ts', import.meta.url))], {
    env: { ...process.env, AGENTS_CODEX_SOCKET: h.fake.socketPath }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += String(bytes); });
  t.after(async () => {
    yard.close(); child.stdin.end();
    const timer = setTimeout(() => child.kill(), 1000);
    try { await exited; } finally { clearTimeout(timer); }
  });
  const responses = new Map<number, Record<string, any>>();
  const events = createInterface({ input: child.stdout });
  events.on('line', line => { const reply = JSON.parse(line); responses.set(reply.id, reply); events.emit('response'); });
  let id = 0;
  async function rpc(method: string, params: unknown) {
    const next = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
    while (!responses.has(next)) await once(events, 'response', { signal: AbortSignal.timeout(5000) });
    return responses.get(next)!;
  }
  assert.ok((await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } })).result);
  const listed = await rpc('tools/list', {});
  assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name), sessionToolCatalog.map(tool => tool.name));
  yard.close();
  const _meta = { 'x-codex-turn-metadata': JSON.stringify({ thread_id: h.caller.id, turn_id: 'synthetic-turn' }), 'openai/toolCallId': 'synthetic-call' };
  const result = await rpc('tools/call', { name: 'set_thread_title', arguments: { title: '🩺 Metadata routed' }, _meta });
  assert.equal(result.result.isError, false);
  assert.equal(h.caller.name, '🩺 Metadata routed');
  const unauthenticated = await rpc('tools/call', { name: 'set_thread_title', arguments: { title: 'Rejected' } });
  assert.ok(unauthenticated.error);
  assert.equal(h.fake.calls('thread/name/set').length, 1);
  assert.equal(stderr, '');
});
