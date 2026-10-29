import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createAppTools, defaultAppToolsAdapter } from '../lib/app-tools.ts';

const ownedAdapterPath = defaultAppToolsAdapter;
const fixtureAdapterPath = fileURLToPath(import.meta.url);

const tools = [{ namespace: 'codex_app', name: 'fixture_echo', description: 'Return a disposable test value.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }];
const output = text => ({ success: true, contentItems: [{ type: 'inputText', text }] });
const call = (id, callId = String(id), text = 'fixture') => ({ jsonrpc: '2.0', id, method: 'tools/call', params: {
  callerSource: 'codex', hostId: 'local', threadId: 'disposable-thread', turnId: 'disposable-turn',
  callId, namespace: 'codex_app', tool: 'fixture_echo', arguments: { text },
} });

function messageLog() {
  const messages = [];
  const events = new EventEmitter();
  return {
    messages,
    push(message) { messages.push(message); events.emit('message'); },
    waitFor(predicate) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const check = () => { const value = messages.find(predicate); if (value) { cleanup(); resolve(value); } };
        const cleanup = () => { clearTimeout(timer); events.off('message', check); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for app tools response')); }, 3_000);
        events.on('message', check);
      });
    },
  };
}

function frame(message) {
  const payload = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

async function fixture(t, callTool = params => output(params.arguments.text), adapterPath = fixtureAdapterPath) {
  const app = await createAppTools({ tools, callTool, adapterPath });
  t.after(() => app.close());
  return app;
}

async function pipe(t, app) {
  const socket = createConnection({ path: app.socketPath });
  socket.on('error', () => {});
  const closed = new Promise(resolve => socket.once('close', resolve));
  const log = messageLog();
  let buffer = Buffer.alloc(0);
  socket.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const length = buffer.readUInt32LE(0);
      log.push(JSON.parse(buffer.subarray(4, length + 4).toString('utf8')));
      buffer = buffer.subarray(length + 4);
    }
  });
  await once(socket, 'connect');
  t.after(() => socket.destroy());
  return { ...log, socket, closed, send(message) { socket.write(frame(message)); },
    reply(id) { return log.waitFor(message => message.id === id); } };
}

async function adapter(t, app) {
  const config = app.config['mcp_servers.codex_app'];
  // Run the owned adapter with only the two host variables supplied by this module.
  const child = spawn(config.command, config.args, { cwd: config.cwd, env: config.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdin.on('error', () => {});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8_000); });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 1_000);
    try { await exited; } finally { clearTimeout(timer); }
  });
  const log = messageLog();
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim()) log.push(JSON.parse(line));
    }
  });
  let nextId = 0;
  return {
    ...log,
    exited,
    get stderr() { return stderr; },
    async request(method, params) {
      const id = ++nextId;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return log.waitFor(message => message.id === id);
    },
    notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }) + '\n'); },
    send(message) { child.stdin.write(JSON.stringify(message) + '\n'); },
    sendRaw(data) { child.stdin.write(data); },
  };
}

test('the owned MCP adapter initializes, lists host tools, and preserves call metadata and results', async t => {
  const calls = [];
  const app = await fixture(t, params => {
    calls.push(params);
    if (params.arguments.text === 'throw') throw new Error('Fixture tool refused');
    return { ...output(params.arguments.text), success: params.arguments.text !== 'failure' };
  }, ownedAdapterPath);
  const config = app.config['mcp_servers.codex_app'];
  assert.equal(config.command, process.execPath);
  assert.deepEqual(config.args, [app.adapterPath]);
  assert.equal(config.cwd, dirname(app.adapterPath));
  assert.deepEqual(config.env, { CODEX_APP_TOOLS_PIPE_PATH: app.socketPath, CODEX_APP_TOOLS_CALLER_HOST_ID: 'local' });
  assert.equal(config.enabled, true);
  assert.equal(config.required, true);
  assert.equal(config.default_tools_approval_mode, 'approve');
  assert.equal((await stat(dirname(app.socketPath))).mode & 0o777, 0o700);
  assert.equal((await stat(app.socketPath)).mode & 0o777, 0o600);
  const mcp = await adapter(t, app);
  const initialized = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'disposable-app-tools-test', version: '1' } });
  assert.equal(initialized.result.serverInfo.name, 'codex-yard-tools');
  assert.deepEqual(initialized.result.capabilities.tools, {});
  mcp.notify('notifications/initialized');
  const listed = await mcp.request('tools/list', {});
  const { namespace: _, ...listedTool } = tools[0];
  assert.deepEqual(listed.result.tools, [listedTool]);
  const metadata = { 'x-codex-turn-metadata': JSON.stringify({ thread_id: 'disposable-thread', turn_id: 'disposable-turn' }),
    'openai/toolCallId': 'disposable-call' };
  for (const text of ['中文 ✓', 'failure', 'throw']) {
    const result = await mcp.request('tools/call', { name: 'fixture_echo', arguments: { text }, _meta: metadata });
    if (text === 'throw') {
      assert.equal(result.error.code, -32000);
      assert.match(result.error.message, /Fixture tool refused$/);
    } else assert.deepEqual(result.result, { content: [{ type: 'text', text }], isError: text === 'failure' });
  }
  assert.deepEqual(calls[0], { arguments: { text: '中文 ✓' }, callerSource: 'codex', callId: 'disposable-call',
    hostId: 'local', namespace: 'codex_app', threadId: 'disposable-thread', tool: 'fixture_echo', turnId: 'disposable-turn' });
  const missingMetadata = await mcp.request('tools/call', { name: 'fixture_echo', arguments: { text: 'unattributed' } });
  assert.equal(missingMetadata.error.code, -32602);
  assert.match(missingMetadata.error.message, /thread metadata/);
  assert.equal(calls.length, 3, 'unattributed calls never reach the host handler');
  assert.equal(mcp.stderr, '');
});

test('MCP attribution preserves CLI metadata, represents missing IDs, and rejects conflicts', async t => {
  const calls = [];
  const app = await fixture(t, params => { calls.push(params); return output('ok'); }, ownedAdapterPath);
  const mcp = await adapter(t, app);
  assert.ok((await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })).result);
  mcp.notify('notifications/initialized');
  const args = { name: 'fixture_echo', arguments: { text: 'probe' } };
  const turn = { thread_id: 'child-thread', turn_id: 'active-turn', session_id: 'different-root-session' };
  assert.ok((await mcp.request('tools/call', { ...args, _meta: { threadId: 'child-thread',
    'x-codex-turn-metadata': turn, callId: 'model-call' } })).result);
  assert.deepEqual(calls[0], { callerSource: 'codex', hostId: 'local', threadId: 'child-thread', turnId: 'active-turn',
    callId: 'model-call', namespace: 'codex_app', tool: 'fixture_echo', arguments: { text: 'probe' } });
  assert.ok((await mcp.request('tools/call', { ...args, _meta: { 'x-codex-turn-metadata': JSON.stringify(turn),
    'openai/toolCallId': 'legacy-call' } })).result);
  assert.equal(calls[1].callId, 'legacy-call');
  assert.ok((await mcp.request('tools/call', { ...args, _meta: { threadId: 'direct-thread' } })).result);
  assert.equal(calls[2].threadId, 'direct-thread');
  assert.equal(calls[2].turnId, null);
  assert.equal(calls[2].callId, null);
  const invalid = [
    undefined,
    { turnId: 'active-turn', callId: 'model-call', 'x-codex-turn-metadata': { session_id: 'root' } },
    { threadId: 'other-thread', 'x-codex-turn-metadata': turn, callId: 'model-call' },
    { turnId: 'other-turn', 'x-codex-turn-metadata': turn, callId: 'model-call' },
    { 'x-codex-turn-metadata': turn, callId: 'one', 'openai/toolCallId': 'two' },
    { 'x-codex-turn-metadata': '{', callId: 'model-call' },
    { 'x-codex-turn-metadata': turn, callId: ' ' },
  ];
  for (const metadata of invalid) {
    const response = await mcp.request('tools/call', { ...args, _meta: metadata });
    assert.equal(response.error.code, -32602);
  }
  assert.equal(calls.length, 3, 'calls without a thread or with conflicting metadata do not reach the host');
});

test('MCP cancellation reaches the host and ignores a late result after request ID reuse', async t => {
  const started = new EventEmitter();
  const tasks = new Map();
  const app = await fixture(t, (params, { signal }) => new Promise(resolve => {
    tasks.set(params.callId, { resolve, signal });
    started.emit('call');
  }), ownedAdapterPath);
  const mcp = await adapter(t, app);
  assert.ok((await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })).result);
  mcp.notify('notifications/initialized');
  const request = callId => ({ jsonrpc: '2.0', id: 900, method: 'tools/call', params: { name: 'fixture_echo',
    arguments: { text: 'probe' }, _meta: { threadId: 'thread', turnId: 'turn', callId } } });
  let next = once(started, 'call');
  mcp.send(request('old'));
  await next;
  const aborted = once(tasks.get('old').signal, 'abort');
  mcp.notify('notifications/cancelled', { requestId: 900, reason: 'fixture' });
  await aborted;
  next = once(started, 'call');
  mcp.send(request('new'));
  await next;
  tasks.get('old').resolve(output('old'));
  assert.ok((await mcp.request('ping', {})).result);
  assert.equal(mcp.messages.some(message => message.id === 900), false);
  tasks.get('new').resolve(output('new'));
  assert.deepEqual((await mcp.waitFor(message => message.id === 900)).result, { content: [{ type: 'text', text: 'new' }], isError: false });
  assert.equal(mcp.messages.filter(message => message.id === 900).length, 1);
});

test('MCP returns JSON-RPC errors for malformed and unsupported requests', async t => {
  const app = await fixture(t, undefined, ownedAdapterPath);
  const mcp = await adapter(t, app);
  mcp.sendRaw('{\n');
  assert.equal((await mcp.waitFor(message => message.id === null)).error.code, -32700);
  assert.equal((await mcp.request('tools/list', {})).error.code, -32002);
  const initialized = await mcp.request('initialize', { protocolVersion: 'unknown', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  mcp.notify('notifications/initialized');
  assert.deepEqual((await mcp.request('ping', {})).result, {});
  assert.equal((await mcp.request('missing/method', {})).error.code, -32601);
  assert.equal((await mcp.request('tools/call', { name: 'fixture_echo', arguments: [] })).error.code, -32602);
  assert.equal((await mcp.request('tools/call', { name: 'unknown', _meta: { threadId: 'thread', turnId: 'turn', callId: 'call' } })).error.code, -32602);
});

test('MCP stdio accepts fragmented UTF-8 and closes on an oversized frame', async t => {
  const app = await fixture(t, undefined, ownedAdapterPath);
  const mcp = await adapter(t, app);
  assert.ok((await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })).result);
  mcp.notify('notifications/initialized');
  const request = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'split-mcp', method: 'tools/call', params: {
    name: 'fixture_echo', arguments: { text: '中文' }, _meta: { threadId: 'thread', turnId: 'turn', callId: 'call' },
  } }) + '\n');
  const split = request.indexOf(Buffer.from('中文')) + 2;
  mcp.sendRaw(request.subarray(0, split));
  mcp.sendRaw(request.subarray(split));
  assert.deepEqual((await mcp.waitFor(message => message.id === 'split-mcp')).result.content, [{ type: 'text', text: '中文' }]);
  mcp.sendRaw(Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
  assert.equal((await mcp.waitFor(message => message.id === null)).error.code, -32600);
  await mcp.exited;
});

test('the owned adapter routes the real host catalog with caller-scoped title writes', async t => {
  const { appToolCatalog, createHostToolHandler } = await import('../lib/host-tools.ts');
  const reads = [];
  const writes = [];
  const callTool = createHostToolHandler({
    connection: { async request(method, params, options) { writes.push({ method, params, options }); return {}; } },
    knownThread: async threadId => { reads.push(threadId); },
    listProjects: async () => ({ projects: ['fixture'] }),
    listThreads: async () => ({}),
    readThread: async () => ({}),
  });
  const app = await createAppTools({ tools: appToolCatalog, callTool, adapterPath: ownedAdapterPath });
  t.after(() => app.close());
  const mcp = await adapter(t, app);
  assert.ok((await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })).result);
  mcp.notify('notifications/initialized');
  assert.deepEqual((await mcp.request('tools/list', {})).result.tools.map(tool => tool.name), appToolCatalog.map(tool => tool.name));
  const meta = { threadId: 'caller-thread', turnId: 'caller-turn', callId: 'caller-call' };
  const renamed = await mcp.request('tools/call', { name: 'set_thread_title', arguments: { title: 'Fixture title' }, _meta: meta });
  assert.equal(renamed.result.isError, false);
  assert.deepEqual(JSON.parse(renamed.result.content[0].text), { threadId: 'caller-thread', title: 'Fixture title' });
  assert.deepEqual(writes, [{ method: 'thread/name/set', params: { threadId: 'caller-thread', name: 'Fixture title' }, options: { mutating: true } }]);
  const rejected = await mcp.request('tools/call', { name: 'set_thread_title',
    arguments: { title: 'Other title', threadId: 'other-thread' }, _meta: { threadId: 'caller-thread' } });
  assert.equal(rejected.result.isError, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(reads, ['caller-thread', 'caller-thread']);
});

test('native pipe requests survive split headers, split UTF-8 payloads, and combined frames', async t => {
  const app = await fixture(t);
  const client = await pipe(t, app);
  const request = frame(call('split', 'split-call', '中文'));
  client.socket.write(request.subarray(0, 1));
  client.socket.write(request.subarray(1, 3));
  client.socket.write(request.subarray(3, request.length - 1));
  client.socket.write(request.subarray(request.length - 1));
  assert.deepEqual((await client.reply('split')).result, output('中文'));
  client.socket.write(Buffer.concat([frame({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), frame(call(3, 'combined', 'second'))]));
  assert.deepEqual((await client.reply(2)).result, { tools });
  assert.deepEqual((await client.reply(3)).result, output('second'));
});

test('cancellation aborts the handler and a late result cannot answer a reused request ID', async t => {
  const started = new EventEmitter();
  const tasks = new Map();
  const app = await fixture(t, (params, { signal }) => new Promise(resolve => {
    tasks.set(params.callId, { resolve, signal });
    started.emit('call');
  }));
  const client = await pipe(t, app);
  const oldStarted = once(started, 'call');
  client.send(call(7, 'old'));
  await oldStarted;
  const aborted = once(tasks.get('old').signal, 'abort');
  client.send({ jsonrpc: '2.0', id: 7, method: 'tools/cancel' });
  await aborted;
  const newStarted = once(started, 'call');
  client.send(call(7, 'new'));
  await newStarted;
  tasks.get('old').resolve(output('old answer'));
  client.send({ jsonrpc: '2.0', id: 'barrier', method: 'tools/list' });
  await client.reply('barrier');
  assert.equal(client.messages.some(message => message.id === 7), false);
  tasks.get('new').resolve(output('new answer'));
  assert.deepEqual((await client.reply(7)).result, output('new answer'));
  assert.equal(client.messages.filter(message => message.id === 7).length, 1);
});

test('disconnect and close abort only their active handlers and remove the private socket directory', async t => {
  const started = new EventEmitter();
  const tasks = new Map();
  const app = await fixture(t, (params, { signal }) => new Promise(resolve => {
    tasks.set(params.callId, { resolve, signal });
    started.emit('call');
  }));
  const first = await pipe(t, app);
  const oldStarted = once(started, 'call');
  first.send(call(1, 'disconnected'));
  await oldStarted;
  const disconnected = once(tasks.get('disconnected').signal, 'abort');
  first.socket.destroy();
  await disconnected;
  const second = await pipe(t, app);
  const newStarted = once(started, 'call');
  second.send(call(1, 'current'));
  await newStarted;
  tasks.get('disconnected').resolve(output('old connection'));
  second.send({ jsonrpc: '2.0', id: 'barrier', method: 'tools/list' });
  await second.reply('barrier');
  assert.equal(second.messages.some(message => message.id === 1), false);
  assert.equal(tasks.get('current').signal.aborted, false);
  const closed = once(tasks.get('current').signal, 'abort');
  const closing = app.close();
  await closed;
  tasks.get('current').resolve(output('stopped'));
  await closing;
  await second.closed;
  await assert.rejects(stat(app.socketPath), { code: 'ENOENT' });
  await assert.rejects(stat(dirname(app.socketPath)), { code: 'ENOENT' });
  await app.close();
});

test('malformed requests return protocol errors and oversized frames close only their connection', async t => {
  const app = await fixture(t);
  const client = await pipe(t, app);
  client.socket.write(frame(Buffer.from('{')));
  assert.equal((await client.reply(null)).error.code, -32700);
  client.send({ jsonrpc: '2.0', id: 1, method: 'unknown/method' });
  assert.equal((await client.reply(1)).error.code, -32601);
  client.send({ ...call(2), params: { ...call(2).params, tool: 'unlisted' } });
  assert.equal((await client.reply(2)).error.code, -32602);
  for (const [index, patch] of [
    { callerSource: 'external' }, { hostId: 'remote' }, { threadId: '' },
    { turnId: ' ' }, { callId: undefined }, { namespace: 'other' },
  ].entries()) {
    const id = 10 + index;
    client.send({ ...call(id), params: { ...call(id).params, ...patch } });
    assert.equal((await client.reply(id)).error.code, -32602);
  }
  const oversizedHeader = Buffer.alloc(4);
  oversizedHeader.writeUInt32LE(8 * 1024 * 1024 + 1);
  client.socket.write(oversizedHeader); // Do not send or allocate the advertised oversized body.
  await client.closed;
  const healthy = await pipe(t, app);
  healthy.send({ jsonrpc: '2.0', id: 'healthy', method: 'tools/list' });
  assert.deepEqual((await healthy.reply('healthy')).result, { tools });
});

test('oversized handler output closes the affected pipe and leaves the host available', async t => {
  const app = await fixture(t, () => output('x'.repeat(8 * 1024 * 1024)));
  const client = await pipe(t, app);
  client.send(call('large-result'));
  await client.closed;
  const healthy = await pipe(t, app);
  healthy.send({ jsonrpc: '2.0', id: 'healthy', method: 'tools/list' });
  assert.deepEqual((await healthy.reply('healthy')).result, { tools });
});

test('an unavailable adapter fails explicitly before starting a host', async () => {
  const adapterPath = '/nonexistent-codex-yard-adapter.mjs';
  await assert.rejects(createAppTools({ tools, callTool: () => output('unused'), adapterPath }), cause => {
    assert.ok(cause.message.includes(adapterPath));
    assert.match(cause.message, /适配器/);
    return true;
  });
});

test('the owned adapter reconnects to a stable pipe after host replacement without losing caller files', async t => {
  const directory = await mkdtemp('/tmp/aw-restart-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const socketPath = join(directory, 'tools.sock');
  const callerFile = join(directory, 'keep.txt');
  await writeFile(callerFile, 'Caller-owned data.');
  const started = new EventEmitter();
  let activeSignal;
  const first = await createAppTools({ tools, callTool: (params, { signal }) => {
    if (params.arguments.text !== 'wait') return output('before restart');
    activeSignal = signal;
    started.emit('call');
    return new Promise(resolve => signal.addEventListener('abort', () => resolve(output('stopped')), { once: true }));
  }, socketPath, adapterPath: ownedAdapterPath });
  t.after(() => first.close());
  const mcp = await adapter(t, first);
  const initialized = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'disposable-reconnect-test', version: '1' } });
  assert.ok(initialized.result);
  mcp.notify('notifications/initialized');
  const args = { name: 'fixture_echo', arguments: { text: 'unused' }, _meta: { threadId: 'disposable-thread', turnId: 'disposable-turn', callId: 'disposable-call' } };
  assert.deepEqual((await mcp.request('tools/call', args)).result.content, [{ type: 'text', text: 'before restart' }]);
  await assert.rejects(createAppTools({ tools, callTool: () => output('do not take over'), socketPath, adapterPath: ownedAdapterPath }), /运行中的实例/);
  const waiting = once(started, 'call');
  mcp.send({ jsonrpc: '2.0', id: 900, method: 'tools/call', params: { ...args, arguments: { text: 'wait' } } });
  await waiting;
  const aborted = once(activeSignal, 'abort');
  await first.close();
  await aborted;
  assert.equal((await mcp.waitFor(message => message.id === 900)).error.code, -32000);
  assert.ok((await mcp.request('tools/list', {})).error, 'a missing host reports a real connection failure');
  const second = await createAppTools({ tools, callTool: () => output('after restart'), socketPath, adapterPath: first.adapterPath });
  t.after(() => second.close());
  assert.equal(second.socketPath, first.socketPath);
  assert.deepEqual((await mcp.request('tools/call', args)).result.content, [{ type: 'text', text: 'after restart' }]);
  await second.close();
  assert.ok((await stat(callerFile)).isFile());
  assert.ok((await stat(directory)).isDirectory());
  await assert.rejects(stat(socketPath), { code: 'ENOENT' });
});

test('stable pipe remains exclusive until handlers and beforeRelease both settle', async t => {
  const directory = await mkdtemp('/tmp/aw-drain-');
  const socketPath = join(directory, 'tools.sock');
  const started = new EventEmitter(), releaseStarted = new EventEmitter();
  let activeSignal, resolveHandler, releaseOwner;
  const ownerGate = new Promise(resolve => { releaseOwner = resolve; });
  const first = await createAppTools({ tools, socketPath, adapterPath: fixtureAdapterPath,
    callTool: (_params, { signal }) => new Promise(resolve => {
      activeSignal = signal; resolveHandler = resolve; started.emit('call');
    }),
    beforeRelease: async () => { releaseStarted.emit('release'); await ownerGate; },
  });
  t.after(async () => {
    resolveHandler?.(output('cleanup')); releaseOwner();
    await first.close();
    await rm(directory, { recursive: true, force: true });
  });
  const client = await pipe(t, first);
  const entered = once(started, 'call');
  client.send(call(1, 'blocked'));
  await entered;
  const aborted = once(activeSignal, 'abort');
  let reentrant;
  activeSignal.addEventListener('abort', () => { reentrant = first.close(); }, { once: true });
  const closing = first.close();
  assert.equal(activeSignal.aborted, true);
  assert.equal(reentrant, closing);
  assert.equal(first.close(), closing);
  let done = false;
  void closing.then(() => { done = true; });
  await aborted; await client.closed; await setImmediate();
  assert.equal(done, false);
  await assert.rejects(createAppTools({ tools, callTool: () => output('too early'), socketPath, adapterPath: fixtureAdapterPath }), /运行中的实例/);
  const releasing = once(releaseStarted, 'release');
  resolveHandler(output('late result'));
  await releasing; await setImmediate();
  assert.equal(done, false);
  assert.equal(first.close(), closing);
  await assert.rejects(createAppTools({ tools, callTool: () => output('still too early'), socketPath, adapterPath: fixtureAdapterPath }), /运行中的实例/);
  releaseOwner(); await closing;
  assert.equal(first.close(), closing);
  const second = await createAppTools({ tools, callTool: () => output('new owner'), socketPath, adapterPath: fixtureAdapterPath });
  t.after(() => second.close());
  const replacement = await pipe(t, second);
  replacement.send(call(2, 'new-owner'));
  assert.deepEqual((await replacement.reply(2)).result, output('new owner'));
  await second.close();
});

test('close prevents a queued frame from entering a new handler', async t => {
  const calls = [];
  const started = new EventEmitter();
  let closing;
  const app = await fixture(t, params => {
    calls.push(params.callId);
    if (params.callId === 'first') { closing = app.close(); started.emit('close'); }
    return output(params.callId);
  });
  const client = await pipe(t, app);
  const entered = once(started, 'close');
  client.socket.write(Buffer.concat([frame(call(1, 'first')), frame(call(2, 'second'))]));
  await entered;
  await closing;
  await client.closed;
  assert.deepEqual(calls, ['first']);
});

test('close also drains handlers already cancelled or disconnected', async t => {
  const directory = await mkdtemp('/tmp/aw-drain-old-');
  const socketPath = join(directory, 'tools.sock');
  const started = new EventEmitter(), tasks = new Map();
  const first = await createAppTools({ tools, socketPath, adapterPath: fixtureAdapterPath,
    callTool: (params, { signal }) => new Promise(resolve => { tasks.set(params.callId, { signal, resolve }); started.emit('call'); }),
  });
  t.after(async () => {
    for (const task of tasks.values()) task.resolve(output('cleanup'));
    await first.close();
    await rm(directory, { recursive: true, force: true });
  });
  const cancelled = await pipe(t, first);
  let entered = once(started, 'call');
  cancelled.send(call(1, 'cancelled')); await entered;
  const aborted = once(tasks.get('cancelled').signal, 'abort');
  cancelled.send({ jsonrpc: '2.0', id: 1, method: 'tools/cancel' }); await aborted;
  const disconnected = await pipe(t, first);
  entered = once(started, 'call');
  disconnected.send(call(2, 'disconnected')); await entered;
  const disconnectedAbort = once(tasks.get('disconnected').signal, 'abort');
  disconnected.socket.destroy(); await disconnectedAbort;
  const closing = first.close();
  let done = false;
  void closing.then(() => { done = true; });
  await setImmediate();
  await assert.rejects(createAppTools({ tools, callTool: () => output('too early'), socketPath, adapterPath: fixtureAdapterPath }), /运行中的实例/);
  tasks.get('cancelled').resolve(output('cancelled result'));
  await setImmediate();
  assert.equal(done, false);
  await assert.rejects(createAppTools({ tools, callTool: () => output('one still running'), socketPath, adapterPath: fixtureAdapterPath }), /运行中的实例/);
  tasks.get('disconnected').resolve(output('disconnected result'));
  await closing;
  const second = await createAppTools({ tools, callTool: () => output('new owner'), socketPath, adapterPath: fixtureAdapterPath });
  t.after(() => second.close());
  await second.close();
});

test('failed owner cleanup keeps the pipe occupied until an explicit close retry succeeds', async t => {
  const directory = await mkdtemp('/tmp/aw-drain-fail-');
  const socketPath = join(directory, 'tools.sock');
  let attempts = 0;
  const first = await createAppTools({ tools, callTool: () => output('unused'), socketPath, adapterPath: fixtureAdapterPath,
    beforeRelease: async () => { if (++attempts === 1) throw new Error('owner cleanup failed'); },
  });
  t.after(async () => { await first.close(); await rm(directory, { recursive: true, force: true }); });
  const closing = first.close();
  assert.equal(first.close(), closing);
  await assert.rejects(closing, /owner cleanup failed/);
  assert.equal(attempts, 1);
  await assert.rejects(createAppTools({ tools, callTool: () => output('too early'), socketPath, adapterPath: fixtureAdapterPath }), /运行中的实例/);
  await first.close();
  assert.equal(attempts, 2);
  const second = await createAppTools({ tools, callTool: () => output('new owner'), socketPath, adapterPath: fixtureAdapterPath });
  t.after(() => second.close());
  await second.close();
});

test('fixed pipe startup rejects long paths and occupied files without replacing them', async t => {
  const directory = await mkdtemp('/tmp/aw-path-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(createAppTools({ tools, callTool: () => output('unused'), adapterPath: fixtureAdapterPath,
    socketPath: join(directory, 'x'.repeat(108)) }), /107 字节/);
  const socketPath = join(directory, 'occupied.sock');
  await writeFile(socketPath, 'An ordinary caller-owned file.', { mode: 0o600 });
  await assert.rejects(createAppTools({ tools, callTool: () => output('unused'), socketPath, adapterPath: fixtureAdapterPath }), /其他内容占用/);
  assert.ok((await stat(socketPath)).isFile());
});
