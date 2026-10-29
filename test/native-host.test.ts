import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record, updatedAtom } from '../src/native/protocol.ts';
import { createThreadProjects, readThreadProjectState, threadProjectIdentityKey } from '../src/native/thread-projects.ts';
import { BrowserHttpFetch } from '../src/native/browser-http-fetch.ts';
import { brandAssets } from '../src/native/visual-feedback.ts';
import type { HostCatalog } from '../src/native/hosts.ts';
import type { createSshProxyStream } from '../src/native/ssh.ts';
import type { RemoteFileCommand } from '../src/native/files.ts';
import type { NativeStateCheckpoint } from '../src/native/native-state.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { fileMethods } from '../src/native/files.ts';
import { nativeFixture } from './native-fixture.ts';

async function fixture(t: import('node:test').TestContext, httpFetch?: typeof fetch, snapshot?: { data: string; metadata: unknown },
  remote: { hostCatalog?: HostCatalog; sshStream?: typeof createSshProxyStream; remoteFileCommand?: RemoteFileCommand;
    nativeStateCheckpoint?: (step: NativeStateCheckpoint) => void | Promise<void>;
    beforeStart?(fake: Awaited<ReturnType<typeof createFakeCodex>>, root: string): Promise<void> } = {}) {
  const root = await mkdtemp('/tmp/aw-native-test-');
  const fake = await createFakeCodex(root);
  const fileRpc = fileDaemonFixture();
  for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, record(params)));
  const { renderer, adapterPath } = await nativeFixture(root);
  await writeFile(join(renderer, 'original.js'), 'const original = true;');
  if (snapshot) {
    const directory = join(root, 'data', 'configuration-snapshot');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'initialize.json'), snapshot.data);
    await writeFile(join(directory, 'metadata.json'), JSON.stringify(snapshot.metadata));
  }
  const { beforeStart, ...hostOptions } = remote;
  await beforeStart?.(fake, root);
  const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data'), workspace: root,
    renderer, adapterPath, port: 0, publicOrigin: 'https://workbench.example.ts.net:8765', httpFetch, ...hostOptions });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  async function connect() {
    const socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
    sockets.push(socket);
    const messages: Record<string, any>[] = [];
    socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
    await once(socket, 'open');
    async function until(predicate: (message: Record<string, any>) => boolean) {
      const timeout = AbortSignal.timeout(5000);
      while (!messages.some(predicate)) await once(socket, 'received', { signal: timeout });
      return messages.find(predicate)!;
    }
    function send(message: unknown) { socket.send(JSON.stringify(message)); }
    async function rpc(id: number, method: string, params = {}, hostId = 'local') {
      send({ type: 'mcp-request', hostId, request: { id, method, params } });
      return (await until(message => message.type === 'mcp-response' && message.hostId === hostId && message.message.id === id)).message;
    }
    let hostSequence = 0;
    async function host(params: Record<string, unknown>) {
      if (params.action === 'submit' && !Object.hasOwn(params, 'source')) {
        const read = await rpc(-100000 - ++hostSequence, 'config/read', {}, String(params.hostId ?? 'local'));
        assert.ok(read.result?.yardConfigSource);
        params = { ...params, source: read.result.yardConfigSource };
      }
      const requestId = 'configuration-' + ++hostSequence;
      send({ type: 'fetch', requestId, url: 'vscode://codex/configuration-write', body: JSON.stringify(params) });
      const response = await until(message => message.type === 'fetch-response' && message.requestId === requestId);
      assert.equal(response.responseType, 'success', JSON.stringify(response));
      return response.body;
    }
    return { socket, send, until, rpc, host, messages };
  }
  return { root, fake, app, connect };
}

async function callNativeTool(root: string, tool: string, args: Record<string, unknown>, callId: string) {
  const socket = createConnection(join(root, 'data', 'app-tools.sock'));
  let buffer = Buffer.alloc(0);
  const response = new Promise<Record<string, any>>((resolve, reject) => {
    socket.on('error', reject);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
      if (buffer.length < 4 || buffer.length < 4 + buffer.readUInt32LE(0)) return;
      try { resolve(JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString())); }
      catch (error) { reject(error); }
    });
  });
  try {
    await once(socket, 'connect');
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: callId, method: 'tools/call', params: {
      callerSource: 'codex', hostId: 'local', threadId: 'injection-parent', turnId: 'tool-turn', callId,
      namespace: 'codex_app', tool, arguments: args,
    } }));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body]));
    return await response;
  } finally { socket.destroy(); }
}

for (const reconnect of [false, true]) test(`native injection fences all Yard consumers and resumes its immutable original turn (reconnect=${reconnect})`, async t => {
  const h = await fixture(t);
  h.fake.handlers.set('thread/inject_items', () => ({}));
  h.fake.threads.set('injection-parent', fixtureThread('injection-parent', h.root));
  let page = await h.connect();
  assert((await page.rpc(700, 'thread/resume', { threadId: 'injection-parent' })).result);
  let generation = (await page.until(message => message.type === 'codex-app-server-connection-changed' && message.state === 'connected')).daemonConnectionGeneration;
  const reference = { hostId: 'local', threadId: 'injection-parent', intentId: 'original-intent', injectionAttemptId: 'original-injection',
    callId: 'original-call', clientUserMessageId: 'original-user-message', owner: { hostId: 'local', threadId: 'injection-parent', draftId: 'original-draft' },
    revision: 'original-revision', connectionGeneration: generation };
  const items = [{ type: 'function_call', call_id: reference.callId, name: 'untrusted_input', arguments: '{}' },
    { type: 'function_call_output', call_id: reference.callId, output: [{ type: 'input_text', text: 'ORIGINAL_CONTEXT' }] }];
  const turnParams = { threadId: reference.threadId, input: [{ type: 'text', text: 'ORIGINAL_TURN', text_elements: [] }],
    clientUserMessageId: reference.clientUserMessageId };
  let hostId = 0;
  async function host(params: Record<string, unknown>) {
    const requestId = 'injection-host-' + ++hostId;
    page.send({ type: 'fetch', requestId, url: 'vscode://codex/send-injection', body: JSON.stringify({ hostId: 'local', reference, ...params }) });
    return page.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  const injected = await host({ action: 'inject', items, turnParams, daemonConnectionGeneration: generation });
  assert.equal(injected.responseType, 'success', JSON.stringify(injected));
  assert.equal(injected.body.injection.phase, 'injected');
  const other = await h.connect();
  for (const [id, method, params] of [
    [710, 'turn/start', { threadId: reference.threadId, input: [{ type: 'text', text: 'OTHER_PAGE' }] }],
    [711, 'thread/queue/add', { threadId: reference.threadId, input: [{ type: 'text', text: 'OTHER_QUEUE' }] }],
    [712, 'thread/queue/start', { threadId: reference.threadId }],
  ] as const) assert((await other.rpc(id, method, params)).error, method);
  const blockedTool = await callNativeTool(h.root, 'set_thread_title', { title: 'Blocked tool title' }, 'blocked-title');
  assert.equal(blockedTool.result.success, false, JSON.stringify(blockedTool));
  assert.equal(h.fake.calls('thread/name/set').length, 0, 'The actual tool pipe shares the injection write fence.');
  assert.equal(h.fake.calls('turn/start').length, 0);
  if (reconnect) {
    page.socket.terminate();
    page = await h.connect();
    assert((await page.rpc(720, 'thread/resume', { threadId: reference.threadId })).result);
    generation = (await page.until(message => message.type === 'codex-app-server-connection-changed' && message.state === 'connected')).daemonConnectionGeneration;
    assert.notEqual(generation, reference.connectionGeneration);
  }
  const started = await host({ action: 'start', turnAttemptId: 'original-turn-attempt', daemonConnectionGeneration: generation });
  assert.equal(started.responseType, 'success', JSON.stringify(started));
  assert.equal(started.body.turn.phase, 'accepted');
  const allowedTool = await callNativeTool(h.root, 'set_thread_title', { title: 'Accepted tool title' }, 'accepted-title');
  assert.equal(allowedTool.result.success, true, JSON.stringify(allowedTool));
  assert.equal(h.fake.threads.get(reference.threadId)?.name, 'Accepted tool title');
  const pinned = await callNativeTool(h.root, 'set_thread_pinned', { threadId: reference.threadId, pinned: true }, 'pin-original');
  assert.equal(pinned.result.success, true, JSON.stringify(pinned));
  assert.deepEqual(h.fake.calls('turn/start')[0]!.params, turnParams);
  assert.equal(h.fake.calls('thread/inject_items').length, 1);
  const persisted = JSON.parse(await readFile(join(h.root, 'data/native-state.json'), 'utf8'));
  assert.deepEqual(persisted.sendInjections.operations[0].reference, reference);
  assert.deepEqual(persisted.sendInjections.operations[0].items, items);
  assert.deepEqual(persisted.sendInjections.operations[0].turnParams, turnParams);
  assert.deepEqual(persisted.globals['pinned-thread-ids'], [reference.threadId], 'The tool state transaction preserves the injection section.');
  const observed = await host({ action: 'status' });
  assert.equal(observed.body.turn.phase, 'accepted');
});

test('native state recovery precedes settings, project, Mini and configuration consumers', async t => {
  let loseCommit = false, recoveryBlocked = true;
  const initial = JSON.parse('{"globals":{"keep":"global"},"settings":{"selected-avatar-id":"old"},"sideChats":{"version":1,"operations":{},"prepared":{}},"future":{"nested":[1,{"keep":true}]},"__proto__":{"keep":"ordinary-key"}}');
  const h = await fixture(t, undefined, undefined, { hostCatalog: { hosts: [], projects: [], assignments: {} },
    async beforeStart(_fake, root) {
      await mkdir(join(root, 'data'));
      await writeFile(join(root, 'data', 'native-state.json'), JSON.stringify(initial));
    },
    nativeStateCheckpoint(step) {
      if (step === 'directory-sync' && loseCommit) { loseCommit = false; throw new Error('Lost directory sync confirmation'); }
      if (step === 'recovery-file-sync' && recoveryBlocked) throw new Error('Original file recovery is unavailable');
    },
  });
  const client = await h.connect();
  loseCommit = true;
  let sequence = 0;
  async function host(endpoint: string, params: Record<string, unknown> = {}) {
    const requestId = 'native-owner-' + ++sequence;
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) });
    return client.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  const failed = await host('set-setting', { key: 'selected-avatar-id', value: 'new' });
  assert.equal(failed.responseType, 'error'); assert.equal(failed.uncertain, true);
  assert.ok(client.messages.some(message => message.type === 'settings-changed' && !Object.hasOwn(message, 'keys')));
  assert.equal(client.messages.filter(message => message.type === 'workbench-pet-state').length, 0);
  const committed = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(committed.settings['selected-avatar-id'], 'new');
  for (const endpoint of ['get-settings', 'get-setting', 'get-global-state', 'codex-command-keymap-state', 'thread-project-state']) {
    assert.equal((await host(endpoint, { key: 'keep' })).responseType, 'error', endpoint);
  }
  const configReads = h.fake.calls('config/read').length;
  assert.equal((await host('configuration-write', { action: 'status', operationId: 'never-sent', hostId: 'local' })).responseType, 'error');
  assert.equal(h.fake.calls('config/read').length, configReads);
  assert.equal((await host('set-global-state', { key: 'must-not-write', value: true })).responseType, 'error');
  client.send({ type: 'avatar-overlay-open-state-request' });
  await client.until(message => message.type === 'workbench-pet-error');
  assert.equal(client.messages.filter(message => message.type === 'workbench-pet-state').length, 0);
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8')), committed);
  recoveryBlocked = false;
  const settings = await host('get-settings');
  assert.equal(settings.responseType, 'success'); assert.equal(settings.body.values['selected-avatar-id'], 'new');
  assert.equal((await host('set-global-state', { key: 'after-recovery', value: 'saved' })).responseType, 'success');
  const recovered = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(recovered.settings['selected-avatar-id'], 'new');
  assert.equal(recovered.globals['after-recovery'], 'saved'); assert.equal(recovered.globals.keep, 'global');
  for (const key of ['sideChats', 'future', '__proto__']) assert.deepEqual(recovered[key], initial[key]);
  assert.equal(Object.hasOwn(recovered, '__proto__'), true);
  client.send({ type: 'avatar-overlay-open-state-request' });
  await client.until(message => message.type === 'workbench-pet-state');
  assert.equal(h.fake.calls('config/batchWrite').length, 0);
});

test('the renderer file endpoints browse and read real bytes, preserve empty directories and reject traversal', async t => {
  const h = await fixture(t), client = await h.connect();
  const root = join(h.root, '项目'), empty = join(root, '空目录'), text = join(root, '中文.txt'), binary = join(root, 'binary');
  await mkdir(empty, { recursive: true });
  await writeFile(text, '中文\nFILE_LOCAL\n');
  const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  await writeFile(binary, data);
  await writeFile(join(root, '.hidden'), 'hidden');
  await symlink(h.root, join(root, 'outside'), 'dir');
  let sequence = 0;
  async function host(endpoint: string, params: Record<string, unknown>) {
    const requestId = 'files-' + ++sequence;
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) });
    return client.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  const listed = await host('workspace-directory-entries', { workspaceRoot: root });
  assert.equal(listed.responseType, 'success');
  assert.equal(listed.body.parentPath, null);
  assert.equal(listed.body.entries[0].name, '空目录');
  assert.deepEqual(listed.body.entries.map((entry: any) => entry.path).sort(), ['binary', '中文.txt', '空目录'].sort());
  assert.deepEqual((await host('workspace-directory-entries', { workspaceRoot: root, directoryPath: '空目录' })).body,
    { workspaceRoot: root, directoryPath: '空目录', parentPath: '', entries: [] });
  for (const directoryPath of ['..', 'outside']) assert.equal((await host('workspace-directory-entries', { workspaceRoot: root, directoryPath })).responseType, 'error');
  assert.equal((await host('read-file', { path: text })).body.contents, '中文\nFILE_LOCAL\n');
  assert.equal((await host('read-file-metadata', { path: text, contentSampleByteLimit: 4096 })).body.contentKind, 'text');
  assert.equal((await host('read-file-metadata', { path: binary, contentSampleByteLimit: 4096 })).body.contentKind, 'image');
  assert.deepEqual((await host('workspace-files', { operation: 'read', path: text, representation: 'auto' })).body, { text: '中文\nFILE_LOCAL\n' });
  assert.equal((await host('workspace-files', { operation: 'read', path: binary, representation: 'auto' })).body.blob, data.toString('base64'));
  const image = (await host('read-file-binary', { path: binary })).body;
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(image.contentsBase64, 'base64'), data);
  assert.equal((await host('read-file-binary', { path: binary, maxBytes: data.length - 1 })).body.contentsBase64, null);
  assert.equal((await host('read-file-binary', { path: binary, maxBytes: -1 })).responseType, 'error');
  assert.equal((await host('read-file', { path: join(root, 'missing') })).responseType, 'error');
  assert.equal((await host('read-file', { path: empty })).responseType, 'error');
  const large = join(root, 'large'); await writeFile(large, ''); await truncate(large, 10 * 1024 * 1024 + 1);
  assert.equal((await host('read-file', { path: large })).responseType, 'error');
  assert.equal((await host('read-file-binary', { path: large })).body.contentsBase64, null);
  const query = new URLSearchParams({ path: binary, name: '中文产物.png' });
  const download = await fetch(h.app.url + '/api/files/download?' + query);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition')!, /attachment; filename\*=UTF-8''/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), data);
  const head = await fetch(h.app.url + '/api/files/download?' + query, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(data.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  await truncate(large, 64 * 1024 * 1024 + 1);
  assert.equal((await fetch(h.app.url + '/api/files/download?' + new URLSearchParams({ path: large }))).status, 400);
  assert.equal((await fetch(h.app.url + '/api/files/download?' + new URLSearchParams({ path: text, hostId: 'remote-ssh-unknown' }))).status, 400);
  assert.equal((await host('write-file', { path: text, content: 'overwrite' })).responseType, 'error');
  assert.equal(await readFile(text, 'utf8'), '中文\nFILE_LOCAL\n');
  assert.ok(h.fake.calls('fs/readDirectory').length > 0);
  assert.ok(h.fake.calls('fs/getMetadata').length > 0);
  assert.equal(h.fake.calls('fs/readFile').length, 0, 'mutable paths must never use the unbounded daemon read');
  assert.deepEqual((await client.rpc(801, 'fs/readFile', { path: text })).result, { dataBase64: Buffer.from('中文\nFILE_LOCAL\n').toString('base64') });
  assert.ok((await client.rpc(802, 'fs/readFile', { path: large })).error);
  assert.ok((await client.rpc(803, 'fs/readDirectory', { path: root })).result.entries.some((entry: { fileName: string }) => entry.fileName === '中文.txt'));
  assert.equal((await client.rpc(804, 'fs/getMetadata', { path: text })).result.isFile, true);
  assert.equal((await host('ensure-directory', { path: join(root, 'new-directory') })).body.success, true);
  assert.deepEqual(h.fake.calls('fs/createDirectory').at(-1)?.params, { path: join(root, 'new-directory'), recursive: true });
  assert.equal((await host('read-file-metadata', { path: join(root, 'missing') })).responseType, 'error');
  client.send({ type: 'worker-request', workerId: 'git', request: { id: 'deleted-file-comparison', method: 'stable-metadata',
    params: { cwd: root, hostConfig: { id: 'local', kind: 'local' }, operationSource: 'review_model' } } });
  const comparison = await client.until(message => message.type === 'worker-response' && message.response?.id === 'deleted-file-comparison');
  assert.equal(comparison.workerId, 'git');
  assert.equal(comparison.response.method, 'stable-metadata');
  assert.equal(comparison.response.result.type, 'error');
  assert.match(comparison.response.result.error.message, /尚未接入/);
});

test('unsupported worker requests settle with their worker id, request id and method', async t => {
  const h = await fixture(t), client = await h.connect();
  for (const [workerId, method] of [['git', 'availability'], ['unimplemented-worker', 'lookup']]) {
    client.send({ type: 'worker-request', workerId, request: { id: 'same-worker-request-id', method, params: {} } });
    const reply = await client.until(message => message.type === 'worker-response' && message.workerId === workerId && message.response?.id === 'same-worker-request-id');
    assert.equal(reply.response.method, method);
    assert.equal(reply.response.result.type, 'error');
    assert.match(reply.response.result.error.message, /Web 宿主尚未接入/);
  }
});

test('browser uploads require an origin, preserve selected bytes and cannot overwrite or escape their own directory', async t => {
  const h = await fixture(t);
  assert.equal((await fetch(h.app.url + '/api/files/uploads', { method: 'POST' })).status, 403);
  const headers = { Origin: h.app.url };
  const upload = await (await fetch(h.app.url + '/api/files/uploads', { method: 'POST', headers })).json();
  const data = Buffer.from([0, 255, 31, 240, 10]);
  const query = new URLSearchParams({ uploadId: upload.uploadId, name: '所选目录/中文附件.bin' });
  const result = await fetch(h.app.url + '/api/files/upload?' + query, { method: 'POST', headers, body: data });
  assert.equal(result.status, 200);
  const selected = await result.json();
  assert.deepEqual(Buffer.from(await readFile(selected.fsPath)), data);
  assert.equal(selected.path, selected.fsPath);
  assert.equal(selected.label, '中文附件.bin');
  assert.equal((await fetch(h.app.url + '/api/files/upload?' + query, { method: 'POST', headers, body: 'overwrite' })).status, 400);
  assert.equal((await fetch(h.app.url + '/api/files/upload?' + new URLSearchParams({ uploadId: upload.uploadId, name: '../escape' }), { method: 'POST', headers, body: data })).status, 400);
  const tooLarge = await fetch(h.app.url + '/api/files/upload?' + new URLSearchParams({ uploadId: upload.uploadId, name: 'too-large' }), { method: 'POST', headers, body: Buffer.alloc(10 * 1024 * 1024 + 1) });
  assert.equal(tooLarge.status, 400);
  assert.match((await tooLarge.json()).error, /10 MiB/);
  assert.deepEqual(Buffer.from(await readFile(selected.fsPath)), data);
  assert.ok(h.fake.calls('fs/writeFile').some((call: any) => call.params.path === selected.fsPath));
});

test('SSH file routing reads the selected host even when an identical local path exists', async t => {
  const hostId = 'remote-ssh-discovered:test';
  let root = '', remoteRoot = '';
  const calls: string[] = [];
  const run = promisify(execFile);
  const remoteDaemonRoot = await mkdtemp('/tmp/aw-file-remote-');
  const remoteDaemon = await createFakeCodex(remoteDaemonRoot);
  t.after(async () => { await remoteDaemon.close(); await rm(remoteDaemonRoot, { recursive: true, force: true }); });
  const fileRpc = fileDaemonFixture(path => path.replaceAll(root, remoteRoot));
  for (const method of fileMethods) remoteDaemon.handlers.set(method, params => fileRpc(method, record(params)));
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Remote', sshAlias: 'work', sshHost: 'work', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: remoteRoot, codexHome: remoteRoot + '/.codex' }); return createConnection({ path: remoteDaemon.socketPath }); },
    remoteFileCommand: async (host, command, maxBytes, signal) => {
      assert.equal(host.hostId, hostId); calls.push(command);
      const { stdout } = await run('/bin/sh', ['-c', 'LC_ALL=C; export LC_ALL; ' + command.replaceAll(root, remoteRoot)], { encoding: 'buffer', maxBuffer: maxBytes + 1, signal });
      return stdout;
    },
  });
  root = join(h.root, 'local'); remoteRoot = join(h.root, 'remote');
  await mkdir(root); await mkdir(remoteRoot); await mkdir(join(remoteRoot, '空目录'));
  await writeFile(join(root, '中文.txt'), 'LOCAL');
  await writeFile(join(remoteRoot, '中文.txt'), 'REMOTE_中文');
  const client = await h.connect();
  let sequence = 0;
  async function host(endpoint: string, params: Record<string, unknown>) {
    const requestId = 'remote-files-' + ++sequence;
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify({ hostId, ...params }) });
    return client.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  assert.equal((await host('read-file', { path: join(root, '中文.txt') })).body.contents, 'REMOTE_中文');
  const result = await host('workspace-directory-entries', { workspaceRoot: root });
  assert.equal(result.body.entries[0].name, '空目录');
  assert.deepEqual((await host('workspace-directory-entries', { workspaceRoot: root, directoryPath: '空目录' })).body.entries, []);
  const download = await fetch(h.app.url + '/api/files/download?' + new URLSearchParams({ hostId, path: join(root, '中文.txt') }));
  assert.equal(await download.text(), 'REMOTE_中文');
  assert.equal((await host('read-file', { path: '中文.txt' })).responseType, 'error');
  assert.equal((await host('read-file', { path: join(root, 'missing') })).responseType, 'error');
  assert.ok(calls.some(command => command.includes('timeout 10 head ')));
  assert.equal(h.fake.calls('fs/getMetadata').length, 0);
  assert.ok(remoteDaemon.calls('fs/readDirectory').length > 0);
  assert.equal((await client.rpc(805, 'fs/getMetadata', { path: join(root, '中文.txt') }, hostId)).result.isFile, true);
  assert.deepEqual((await client.rpc(806, 'fs/readFile', { path: join(root, '中文.txt') }, hostId)).result,
    { dataBase64: Buffer.from('REMOTE_中文').toString('base64') });
  const attachment = join(remoteRoot, '.codex', 'attachments', '12345678-1234-4234-8234-123456789abc');
  assert.deepEqual((await client.rpc(807, 'fs/createDirectory', { path: attachment, recursive: true }, hostId)).result, {});
  assert.deepEqual(remoteDaemon.calls('fs/createDirectory').at(-1)?.params, { path: attachment, recursive: false });
  assert.deepEqual((await client.rpc(808, 'fs/writeFile', { path: attachment + '/picked.txt', dataBase64: Buffer.from('picked').toString('base64') }, hostId)).result, {});
  assert.ok((await client.rpc(809, 'fs/writeFile', { path: attachment + '/picked.txt', dataBase64: '' }, hostId)).error);
  assert.equal(await readFile(attachment + '/picked.txt', 'utf8'), 'picked');
  assert.ok((await client.rpc(810, 'fs/createDirectory', { path: attachment }, hostId)).error);
  assert.ok((await client.rpc(811, 'fs/writeFile', { path: join(root, '中文.txt'), dataBase64: '' }, hostId)).error);
  assert.equal(h.fake.calls('fs/writeFile').length, 0);
  assert.equal(await readFile(join(root, '中文.txt'), 'utf8'), 'LOCAL');
});

test('native Mini messages reach both Web pages and persist the original pet settings', async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  a.send({ type: 'avatar-overlay-open-state-request' });
  assert.equal((await a.until(message => message.type === 'avatar-overlay-open-state-changed')).isOpen, false);
  a.send({ type: 'avatar-overlay-open', isOpen: false });
  await Promise.all([a, b].map(client => client.until(message => message.type === 'workbench-pet-state' && message.state.isOpen === true)));
  a.send({ type: 'fetch', requestId: 'pet-choice', url: 'vscode://codex/set-setting', body: JSON.stringify({ key: 'selected-avatar-id', value: 'hoots' }) });
  await Promise.all([a, b].map(client => client.until(message => message.type === 'workbench-mini-setting' && message.key === 'selected-avatar-id' && message.value === 'hoots')));
  assert.equal((await a.until(message => message.requestId === 'pet-choice')).responseType, 'success');
  a.send({ type: 'fetch', requestId: 'pet-assets', url: 'vscode://codex/custom-avatars', body: '{}' });
  assert.deepEqual((await a.until(message => message.requestId === 'pet-assets')).body.avatars, []);
  a.messages.length = b.messages.length = 0;
  b.send({ type: 'avatar-overlay-close' });
  await Promise.all([a, b].map(client => client.until(message => message.type === 'workbench-pet-state' && message.state.isOpen === false)));
  const saved = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(saved.globals['electron-avatar-overlay-open'], false);
  assert.equal(saved.settings['selected-avatar-id'], 'hoots');
  const status = await (await fetch(h.app.url + '/api/status')).json();
  assert.equal(status.unsupported.some((method: string) => /avatar|pet/.test(method)), false);
});

test('owned startup ignores retired configuration captures and preserves their original data', async t => {
  let requests = 0;
  const data = 'retired and malformed JSON', metadata = { rendererVersion: 'old-reference', custom: { retain: true } };
  const h = await fixture(t, async () => { requests++; throw Error('Upstream should not be called'); },
    { data, metadata });
  const response = await fetch(h.app.url + '/api/configuration/bootstrap');
  assert.equal(response.status, 404);
  assert.equal(requests, 0);
  const status = await (await fetch(h.app.url + '/api/status')).json();
  assert.equal(Object.hasOwn(status, 'configurationSnapshot'), false);
  assert.equal(await readFile(join(h.root, 'data/configuration-snapshot/initialize.json'), 'utf8'), data);
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'data/configuration-snapshot/metadata.json'), 'utf8')), metadata);
  const page = await h.connect();
  assert.equal((await page.rpc(1, 'thread/list')).result.data.length, 0);
});

test('owned startup without a configuration capture uses the normal CLI connection', async t => {
  const h = await fixture(t);
  assert.equal((await fetch(h.app.url + '/api/configuration/bootstrap')).status, 404);
  assert.equal(Object.hasOwn(await (await fetch(h.app.url + '/api/status')).json(), 'configurationSnapshot'), false);
  const page = await h.connect();
  assert.equal((await page.rpc(1, 'thread/list')).result.data.length, 0);
});

async function projectRequest(client: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['connect']>>, id: string, operation: string, value?: unknown) {
  client.send({ type: 'fetch', requestId: id, url: 'vscode://codex/thread-projects', body: JSON.stringify({ operation, value }) });
  return client.until(message => message.type === 'fetch-response' && message.requestId === id);
}

test('terminal handles use the page daemon connection and are killed before that connection closes', async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  let owner: WebSocket | undefined;
  let processHandle = '';
  h.fake.handlers.set('model/list', (_params, context) => {
    owner = context.socket; return { data: [], nextCursor: null };
  });
  await a.rpc(991, 'model/list');
  h.fake.handlers.set('process/spawn', (params, context) => {
    assert.equal(context.socket, owner, 'terminal must share the page/host connection used for MCP');
    if (!params.tty) {
      assert.equal(params.cwd, '/');
      assert.deepEqual(params.command, ['/bin/kill', '-HUP', '--', '1234']);
      for (const handle of [params.processHandle, processHandle]) context.send({ method: 'process/exited', params: {
        processHandle: handle, exitCode: handle === processHandle ? 1 : 0, stdout: '', stderr: '', stdoutCapReached: false, stderrCapReached: false,
      } });
      return {};
    }
    assert.equal(params.cwd, h.root);
    assert.equal(typeof params.processHandle, 'string');
    processHandle = String(params.processHandle);
    context.send({ method: 'process/outputDelta', params: { processHandle, stream: 'stdout', capReached: false,
      deltaBase64: Buffer.from('\x1e' + processHandle + '\x1f/bin/bash\x1f1234\x1f').toString('base64') } });
    return {};
  });
  h.fake.handlers.set('process/writeStdin', (params, context) => {
    assert.equal(context.socket, owner);
    assert.equal(params.processHandle, processHandle);
    context.send({ method: 'process/outputDelta', params: { ...params, stream: 'stdout', capReached: false } });
    return {};
  });
  h.fake.handlers.set('process/kill', (params, context) => {
    assert.equal(context.socket, owner);
    assert.equal(context.socket.readyState, WebSocket.OPEN);
    assert.equal(params.processHandle, processHandle);
    context.send({ method: 'process/exited', params: { processHandle, exitCode: 137, stdout: '', stderr: '', stdoutCapReached: false, stderrCapReached: false } });
    return {};
  });
  async function terminal(client: typeof a, requestId: string, operation: string, args: unknown[]) {
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/terminal', body: JSON.stringify({ operation, args }) });
    return client.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  assert.equal((await terminal(a, 'terminal-open', 'create', [{ sessionId: 'owned-shell', cwd: h.root }])).responseType, 'success');
  assert.equal((await a.until(message => message.event?.type === 'attached')).event.cwd, h.root);
  await terminal(a, 'terminal-input', 'write', ['owned-shell', 'official stdin 中文\x03']);
  await a.until(message => message.event?.type === 'data' && message.event.data === 'official stdin 中文\x03');
  const wrongPage = await terminal(b, 'terminal-wrong-page', 'write', ['owned-shell', 'exit\r']);
  assert.equal(wrongPage.responseType, 'error');
  assert.match(wrongPage.error, /已关闭/);
  const ownerClosed = once(owner!, 'close');
  a.socket.close();
  await ownerClosed;
  assert.equal(h.fake.calls('process/spawn').length, 2);
  assert.equal(h.fake.calls('process/kill').length, 0, 'HUP and confirmed shell exit complete before disconnect');
  assert.equal(h.fake.calls('initialize').length, 2, 'control plus one page/host connection');
});

test('protocol readiness and unrelated reads do not wait for the model catalog', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('model/list', () => NO_REPLY);
  const client = await h.connect();
  client.send({ type: 'ready' });
  await client.until(message => message.type === 'codex-app-server-initialized');
  assert.equal(h.fake.calls('model/list').length, 0);
  client.send({ type: 'mcp-request', hostId: 'local', request: { id: 50, method: 'model/list', params: {} } });
  const result = await client.rpc(51, 'config/read', { includeLayers: false });
  assert.ok(result.result.config);
  assert.equal(h.fake.calls('model/list').length, 1);
  assert.equal(client.messages.some(message => message.message?.id === 50), false);
});

for (const [userAgent, version] of [
  ['codex-tui/0.163.0 (Linux)', '0.163.0'],
  ['agents_workbench/0.164.0 (Linux)', '0.164.0'],
]) test(`ready replays the initialized ${version} version when startup RPCs connected before the renderer subscribed`, async t => {
  const h = await fixture(t);
  h.fake.handlers.set('initialize', () => ({ userAgent }));
  const client = await h.connect();
  await client.rpc(1, 'config/read');
  client.messages.length = 0;
  client.send({ type: 'ready' });
  const snapshot = await client.until(message => message.type === 'codex-app-server-initialized' && message.isSnapshot);
  assert.equal(snapshot.appServerVersion, version);
  assert.equal(snapshot.installedCodexVersion, version);
  assert.equal(snapshot.transport, 'websocket');
  assert.equal(h.fake.calls('initialize').length, 2); // Control client and this page.
});

test('two pages share a daemon thread, keep its configuration, observe events and unsubscribe independently', async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  const { result: { thread } } = await a.rpc(1, 'thread/start', { cwd: h.root });
  const resumed = await b.rpc(1, 'thread/resume', { threadId: thread.id, excludeTurns: true });
  assert.equal(resumed.result.thread.id, thread.id);
  assert.equal(h.fake.calls('thread/start').length, 1);
  assert.equal(h.fake.calls('thread/resume')[0].params.config, undefined);
  const { result: { turn } } = await b.rpc(2, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'shared' }] });
  h.fake.broadcast({ method: 'turn/started', params: { threadId: thread.id, turn } });
  assert.equal((await a.until(message => message.method === 'turn/started')).params.turn.id, turn.id);
  assert.equal((await b.until(message => message.method === 'turn/started')).params.turn.id, turn.id);
  await a.rpc(2, 'thread/unsubscribe', { threadId: thread.id });
  a.socket.close();
  assert.ok((await b.rpc(3, 'turn/interrupt', { threadId: thread.id, turnId: turn.id })).result);
  assert.equal(h.fake.threads.size, 1);
  assert.equal(h.fake.loaded.has(thread.id), true);
  assert.equal(h.fake.calls('turn/start').length, 1);
});

test('a resumed desktop title tool reaches the existing handler without replacing the loaded thread', async t => {
  const h = await fixture(t), client = await h.connect();
  const thread = fixtureThread('desktop-thread', h.root, { name: 'Old title' });
  h.fake.threads.set(thread.id, thread);
  h.fake.loaded.add(thread.id);
  await client.rpc(1, 'thread/resume', { threadId: thread.id, excludeTurns: true });
  assert.equal(h.fake.calls('thread/resume')[0].params.config, undefined);
  h.fake.send({ id: 'legacy-title', method: 'item/tool/call', params: {
    threadId: thread.id, turnId: 'existing-turn', callId: 'title-call',
    namespace: 'codex_app', tool: 'set_thread_title', arguments: { title: 'Updated title' },
  } });
  const reply = await h.fake.waitFor(message => message.id === 'legacy-title' && message.result);
  assert.deepEqual(reply.result, { success: true, contentItems: [{ type: 'inputText',
    text: JSON.stringify({ threadId: thread.id, title: 'Updated title' }) }] });
  assert.equal(h.fake.threads.get(thread.id)!.name, 'Updated title');
  assert.equal(h.fake.calls('thread/name/set').length, 1);
  assert.equal(client.messages.some(message => message.request?.id === 'legacy-title'), false);
  for (const method of ['thread/start', 'thread/fork', 'turn/start', 'config/batchWrite']) assert.equal(h.fake.calls(method).length, 0);
});

test('legacy title calls keep current-thread authorization and preserve write failures', async t => {
  const h = await fixture(t), client = await h.connect();
  const thread = fixtureThread('desktop-thread', h.root, { name: 'Original title' });
  h.fake.threads.set(thread.id, thread);
  await client.rpc(1, 'thread/resume', { threadId: thread.id, excludeTurns: true });
  for (const [id, args] of [['wrong-target', { threadId: 'another-thread', title: 'Denied' }],
    ['write-error', { title: 'Rejected' }]] as const) {
    h.fake.handlers.set('thread/name/set', () => { throw new Error('Title write rejected'); });
    h.fake.send({ id, method: 'item/tool/call', params: { threadId: thread.id, turnId: 'existing-turn', callId: id,
      namespace: 'codex_app', tool: 'set_thread_title', arguments: args } });
    const reply = record((await h.fake.waitFor(message => message.id === id && message.result)).result);
    assert.equal(reply.success, false);
    const contents = reply.contentItems as { text: string }[];
    const failure = JSON.parse(contents[0]!.text);
    assert.match(failure.error, id === 'wrong-target' ? /只能修改当前对话/ : /Title write rejected/);
    assert.equal(failure.uncertain, false);
  }
  assert.equal(h.fake.calls('thread/name/set').length, 1);
  assert.equal(h.fake.threads.get(thread.id)!.name, 'Original title');

  h.fake.send({ id: 'other-tool', method: 'item/tool/call', params: { threadId: thread.id,
    namespace: 'another-plugin', tool: 'set_thread_title', arguments: { title: 'Unrelated' } } });
  assert.equal((await client.until(message => message.request?.id === 'other-tool')).hostId, 'local');
  assert.equal(h.fake.calls('thread/name/set').length, 1);
});

test('multiple pages and replayed legacy title requests share one write', async t => {
  const h = await fixture(t), first = await h.connect(), second = await h.connect();
  const thread = fixtureThread('desktop-thread', h.root);
  h.fake.threads.set(thread.id, thread);
  await first.rpc(1, 'thread/resume', { threadId: thread.id });
  await second.rpc(1, 'thread/resume', { threadId: thread.id });
  const request = { id: 'shared-title', method: 'item/tool/call', params: {
    threadId: thread.id, turnId: 'existing-turn', callId: 'title-call',
    namespace: 'codex_app', tool: 'set_thread_title', arguments: { title: 'Shared title' },
  } };
  h.fake.broadcast(request);
  await h.fake.waitFor(() => h.fake.messages.filter(message => message.id === request.id && message.result).length === 2);
  assert.equal(h.fake.calls('thread/name/set').length, 1);
  // Replayed delivery returns the original result even after a later title edit.
  h.fake.threads.get(thread.id)!.name = 'Later title';
  h.fake.send({ ...request, id: 'replayed-title' });
  const replay = await h.fake.waitFor(message => message.id === 'replayed-title' && message.result);
  assert.equal(record(replay.result).success, true);
  assert.equal(h.fake.threads.get(thread.id)!.name, 'Later title');
  assert.equal(h.fake.calls('thread/name/set').length, 1);
  assert.equal(first.messages.concat(second.messages).some(message => message.request?.method === 'item/tool/call'), false);
});

test('native side-chat forks retain the official temporary contract and accept their context boundary', async t => {
  const h = await fixture(t), client = await h.connect();
  h.fake.handlers.set('thread/fork', params => ({ thread: fixtureThread('side-chat', h.root, { ephemeral: params.ephemeral === true }) }));
  h.fake.handlers.set('thread/inject_items', () => ({}));
  const instructions = 'You are in a side conversation, not the main thread.\nParent messages are reference context.';
  const fork = await client.rpc(1, 'thread/fork', { threadId: 'parent', ephemeral: true, excludeTurns: true, developerInstructions: instructions });
  assert.equal(fork.result.thread.ephemeral, true);
  assert.equal(h.fake.calls('thread/fork')[0].params.ephemeral, true);
  assert.equal(h.fake.calls('thread/fork')[0].params.excludeTurns, true);
  assert.equal(h.fake.calls('thread/fork')[0].params.developerInstructions, instructions);
  assert.ok(h.fake.calls('thread/fork')[0].params.config, 'Local forks still receive this host’s tool socket configuration');
  const items = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Side conversation starts here.' }] }];
  assert.ok((await client.rpc(2, 'thread/inject_items', { threadId: 'side-chat', items })).result);
  assert.deepEqual(h.fake.calls('thread/inject_items')[0].params, { threadId: 'side-chat', items });
  await client.rpc(3, 'thread/fork', { threadId: 'ordinary', ephemeral: true, excludeTurns: true });
  assert.equal(h.fake.calls('thread/fork')[1].params.ephemeral, true);
  await client.rpc(4, 'thread/fork', { threadId: 'ordinary', developerInstructions: instructions });
  assert.equal(h.fake.calls('thread/fork')[2].params.ephemeral, undefined);
  await client.rpc(5, 'thread/fork', { threadId: 'saved', ephemeral: false, excludeTurns: true, developerInstructions: instructions });
  assert.equal(h.fake.calls('thread/fork')[3].params.ephemeral, false, 'Existing persistent fork requests remain persistent');
  await client.rpc(6, 'thread/unsubscribe', { threadId: 'side-chat' });
  assert.deepEqual(h.fake.calls('thread/unsubscribe')[0].params, { threadId: 'side-chat' });
  assert.equal(h.fake.calls('thread/delete').length, 0);
  assert.equal(h.fake.calls('thread/archive').length, 0);
  assert.equal(h.fake.calls('turn/start').length, 0);
});

test('SSH RPC, events and approvals retain their host and never receive a local tool socket', async t => {
  const root = await mkdtemp('/tmp/aw-remote-test-'), remote = await createFakeCodex(root);
  remote.handlers.set('fs/createDirectory', () => ({}));
  t.after(async () => { await remote.close(); await rm(root, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:fixture';
  const catalog: HostCatalog = { hosts: [{ hostId, displayName: 'Remote fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: '/private/key' }],
    projects: [{ hostId, id: 'remote-project', remotePath: '/remote/project', label: 'Remote project' }], assignments: {} };
  const h = await fixture(t, undefined, undefined, { hostCatalog: catalog, sshStream: (_host, onPaths) => {
    onPaths!({ homeDirectory: '/remote/home', codexHome: '/remote/home/.codex' });
    return createConnection(remote.socketPath);
  } });
  const client = await h.connect();
  client.send({ type: 'ready' });
  const profiles = await client.until(message => message.type === 'shared-object-updated' && message.key === 'remote_ssh_connections');
  assert.equal(profiles.value[0].identity, null);
  client.send({ type: 'fetch', requestId: 'remote-directory', url: 'vscode://codex/ensure-directory',
    body: JSON.stringify({ hostId, path: '/remote/home/.codex/visualizations/test' }) });
  const directory = await client.until(message => message.type === 'fetch-response' && message.requestId === 'remote-directory');
  assert.equal(directory.responseType, 'success');
  assert.deepEqual(remote.calls('fs/createDirectory')[0].params, { path: '/remote/home/.codex/visualizations/test', recursive: true });
  assert.equal(h.fake.calls('fs/createDirectory').length, 0);
  const [local, ssh] = await Promise.all([
    client.rpc(1, 'thread/start', { cwd: h.root }), client.rpc(1, 'thread/start', { cwd: '/remote/project' }, hostId),
  ]);
  assert.equal(local.result.thread.cwd, h.root);
  assert.equal(ssh.result.thread.cwd, '/remote/project');
  assert.equal(remote.calls('thread/start').length, 1);
  assert.equal(remote.calls('thread/start')[0].params.config, undefined);
  const initialized = await client.until(message => message.type === 'codex-app-server-initialized' && message.hostId === hostId);
  assert.equal(initialized.transport, 'websocket');
  remote.send({ id: 'ssh-approval', method: 'item/commandExecution/requestApproval', params: { threadId: ssh.result.thread.id } });
  const approval = await client.until(message => message.request?.id === 'ssh-approval');
  assert.equal(approval.hostId, hostId);
  client.send({ type: 'mcp-response', hostId, generation: approval.requestRef.generation, response: { id: 'ssh-approval', result: { decision: 'decline' } } });
  await remote.waitFor(message => message.id === 'ssh-approval' && message.result);
  assert.equal(h.fake.messages.some(message => message.id === 'ssh-approval'), false);
  remote.send({ method: 'item/agentMessage/delta', params: { threadId: ssh.result.thread.id, delta: 'remote' } });
  assert.equal((await client.until(message => message.params?.delta === 'remote')).hostId, hostId);
  const assignment = { projectKind: 'remote', projectId: 'remote-project' };
  const saved = await projectRequest(client, 'remote-assignment', 'setAssignment', { threadId: ssh.result.thread.id, hostId, assignment });
  assert.equal(saved.responseType, 'success');
  const persisted = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(persisted.globals['thread-project-assignments'].hosts[hostId][ssh.result.thread.id].hostId, hostId);
  const unknown = await client.rpc(2, 'thread/start', { cwd: '/wrong' }, 'remote-ssh-discovered:unknown');
  assert.match(unknown.error.message, /未登记/);
  assert.equal(remote.calls('thread/start').length, 1);
  const resumed = await client.rpc(3, 'thread/resume', { threadId: ssh.result.thread.id }, hostId);
  assert.equal(resumed.result.thread.id, ssh.result.thread.id);
  assert.equal(remote.calls('thread/resume')[0].params.config, undefined);
  await client.rpc(4, 'thread/unsubscribe', { threadId: ssh.result.thread.id }, hostId);
  assert.equal(remote.calls('thread/unsubscribe').length, 1);
  const other = await h.connect();
  await other.rpc(1, 'thread/resume', { threadId: ssh.result.thread.id }, hostId);
  async function toggle(requestId: string, autoConnect: boolean) {
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/set-remote-connection-auto-connect', body: JSON.stringify({ hostId, autoConnect }) });
    return await client.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  const connected = await toggle('remote-connect', true);
  assert.equal(connected.body.state, 'connected');
  assert.equal(connected.body.remoteConnections[0].autoConnect, true);
  assert.equal((await toggle('remote-disconnect', false)).body.state, 'disconnected');
  assert.equal((await other.rpc(2, 'thread/loaded/list', {}, hostId)).result.data.includes(ssh.result.thread.id), true);
  assert.equal(JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8')).globals['remote-connection-auto-connect-by-host-id'][hostId], false);
  assert.equal((await toggle('remote-reconnect', true)).body.state, 'connected');
  assert.equal(remote.calls('thread/start').length, 1);
});

test('a project chat saves membership before its first turn, persists it and notifies other pages', async t => {
  const h = await fixture(t), client = await h.connect(), other = await h.connect();
  const { result: { thread } } = await client.rpc(1, 'thread/start', { cwd: h.root });
  const assignment = { projectKind: 'local', projectId: h.root };
  const saved = await projectRequest(client, 'assign', 'setAssignment', { threadId: thread.id, hostId: 'local', assignment });
  assert.equal(saved.responseType, 'success');
  const event = await other.until(message => message.type === 'thread-project-memberships-updated');
  assert.deepEqual(event.memberships[threadProjectIdentityKey({ hostId: 'local', threadId: thread.id })],
    { hostId: 'local', threadId: thread.id, assignment, projectless: false });
  const persisted = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'));
  assert.deepEqual(persisted.globals['thread-project-assignments'].hosts.local[thread.id], assignment);
  assert.ok((await client.rpc(2, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'first project message' }] })).result);
  assert.equal(h.fake.calls('turn/start').length, 1);
  const reloaded = createThreadProjects(persisted.globals, async () => {}, () => {});
  const beforeMove = await reloaded('moveLocalProjectThreadsToProjectless', h.root);
  assert.deepEqual(beforeMove, [{ hostId: 'local', threadId: thread.id, assignment, projectless: false }]);
});

test('concurrent membership writes retain both chats and invalid restore batches leave state untouched', async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  const assignment = { projectKind: 'local', projectId: h.root };
  const writes = await Promise.all([
    projectRequest(a, 'a', 'setAssignment', { threadId: 'chat-a', assignment }),
    projectRequest(b, 'b', 'setMembership', { threadId: 'chat-b', assignment: null, projectless: true }),
  ]);
  assert.ok(writes.every(reply => reply.responseType === 'success'));
  const before = await readFile(join(h.root, 'data', 'native-state.json'), 'utf8');
  const state = JSON.parse(before).globals;
  assert.deepEqual(readThreadProjectState(state).memberships.sort((a, b) => a.threadId.localeCompare(b.threadId)), [
    { hostId: 'local', threadId: 'chat-a', assignment, projectless: false },
    { hostId: 'local', threadId: 'chat-b', assignment: null, projectless: true },
  ]);
  const invalid = await projectRequest(a, 'invalid', 'restoreMemberships', [
    { threadId: 'chat-a', assignment: null, projectless: true },
    { threadId: 'chat-b', assignment: { projectKind: 'invalid' }, projectless: false },
  ]);
  assert.equal(invalid.responseType, 'error');
  assert.equal(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'), before);
  const remote = await projectRequest(a, 'remote', 'setAssignment', { threadId: 'chat-a', hostId: 'another-host', assignment: null });
  assert.equal(remote.responseType, 'error');
});

test('projectless hints persist and stale hint writes cannot resurrect removed metadata', async t => {
  const h = await fixture(t), client = await h.connect();
  const value = { threadId: 'projectless', projectless: true, outputDirectory: '/outputs', workspaceRoot: '/workspace' };
  assert.equal((await projectRequest(client, 'create', 'updateProjectlessThread', value)).responseType, 'success');
  let state = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8')).globals;
  assert.deepEqual(readThreadProjectState(state).memberships, [{ hostId: 'local', threadId: 'projectless', assignment: null, projectless: true }]);
  assert.deepEqual(readThreadProjectState(state).workspaceRoots, [{ hostId: 'local', threadId: 'projectless', value: '/workspace' }]);
  await projectRequest(client, 'remove', 'updateProjectlessThread', { threadId: 'projectless', projectless: false, outputDirectory: null });
  await projectRequest(client, 'stale', 'updateProjectlessThread', value);
  state = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8')).globals;
  assert.deepEqual(readThreadProjectState(state).memberships, []);
  assert.deepEqual(readThreadProjectState(state).outputDirectories, []);
  assert.deepEqual(readThreadProjectState(state).workspaceRoots, []);
  assert.equal(state['projectless-thread-ids'].hosts.local.projectless, false);
  assert.equal(state['thread-projectless-output-directories'].hosts.local.projectless, null);
});

test('a failed membership save rejects, restores memory and allows a later save', async () => {
  const globals = {}, events: unknown[] = [];
  let fail = true;
  const request = createThreadProjects(globals, async () => { if (fail) throw new Error('disk full'); }, event => events.push(event));
  const value = { threadId: 'chat', assignment: { projectKind: 'local', projectId: '/project' } };
  await assert.rejects(request('setAssignment', value), /disk full/);
  assert.deepEqual(globals, {});
  assert.deepEqual(events, []);
  fail = false;
  await request('setAssignment', value);
  assert.deepEqual(readThreadProjectState(globals).memberships, [{ hostId: 'local', threadId: 'chat', assignment: value.assignment, projectless: false }]);
  assert.ok(events.length);
});

test('native bridge serves authored assets and routes without snapshot preloads or private host bootstrap', async t => {
  const h = await fixture(t);
  await writeFile(join(h.root, 'renderer', 'workbench-entry.js'), 'export const owned = true;');
  const page = await fetch(h.app.url + '/local/test-thread');
  const html = await page.text();
  assert.doesNotMatch(html, /native-host.js|web-renderer-v2|modulepreload/);
  assert.match(html, /src="\/workbench-entry.js"/);
  assert.doesNotMatch(html, /index-acf264e41d60/);
  assert.equal((await fetch(h.app.url + '/workbench-entry.js')).status, 200);
  assert.equal(await (await fetch(h.app.url + '/original.js')).text(), 'const original = true;');
  assert.equal((await fetch(h.app.url + '/original.js')).headers.get('content-type'), 'text/javascript');
});

test('hashed renderer assets are compressed and reusable while the HTML and owned entry stay fresh', async t => {
  const h = await fixture(t);
  await mkdir(join(h.root, 'renderer', 'assets'));
  const source = '// ' + 'large renderer module '.repeat(400);
  await writeFile(join(h.root, 'renderer', 'assets', 'module-0123456789ab.js'), source);
  const asset = await fetch(h.app.url + '/assets/module-0123456789ab.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(asset.headers.get('content-encoding'), 'gzip');
  assert.equal(asset.headers.get('vary'), 'Accept-Encoding');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await asset.text(), source);
  const raw = await fetch(h.app.url + '/assets/module-0123456789ab.js', { headers: { 'Accept-Encoding': 'gzip;q=0, identity' } });
  assert.equal(raw.headers.get('content-encoding'), null);
  assert.equal(await raw.text(), source);
  for (const path of ['/', '/workbench-entry.js', '/api/status']) {
    assert.equal((await fetch(h.app.url + path)).headers.get('cache-control'), 'no-store');
  }
});

test('web branding resolves from both native routes and the default favicon request', async t => {
  const h = await fixture(t);
  for (const path of ['/', '/local/test-thread']) {
    const html = await (await fetch(h.app.url + path)).text();
    assert.match(html, /<title>Codex Yard<\/title>/);
    assert.ok(html.includes(`rel="icon" type="image/png" sizes="192x192" href="${brandAssets.icon192}"`));
    assert.ok(html.includes(`rel="icon" type="image/svg+xml" sizes="any" href="${brandAssets.icon}"`));
    assert.ok(html.includes(`rel="apple-touch-icon" sizes="180x180" href="${brandAssets.apple}"`));
    assert.match(html, /rel="manifest" href="\/site.webmanifest"/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'self'/);
    assert.match(html, /object-src 'none'/);
  }
  const response = await fetch(h.app.url + '/site.webmanifest');
  assert.equal(response.headers.get('content-type'), 'application/manifest+json');
  const manifest = await response.json();
  assert.equal(manifest.name, 'Codex Yard');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  for (const entry of manifest.icons) {
    const image = await fetch(h.app.url + entry.src);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), entry.type);
    const bytes = Buffer.from(await image.arrayBuffer());
    if (entry.type === 'image/png') {
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, entry.sizes);
    } else assert.match(bytes.toString(), /<title>Codex Yard<\/title>/);
  }
  const favicon = await fetch(h.app.url + '/favicon.ico');
  assert.equal(favicon.url, h.app.url + brandAssets.icon192);
  assert.equal(favicon.headers.get('content-type'), 'image/png');
  const apple = Buffer.from(await (await fetch(h.app.url + brandAssets.apple)).arrayBuffer());
  assert.equal(apple.readUInt32BE(16), 180);
  assert.equal(apple.readUInt32BE(20), 180);
  assert.equal((await fetch(h.app.url + brandAssets.icon, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(h.app.url + brandAssets.icon, { method: 'HEAD' })).headers.get('content-type'), 'image/svg+xml');
  assert.equal((await fetch(h.app.url + '/brand/missing.svg')).status, 404);
  assert.equal((await fetch(h.app.url + '/brand/%2e%2e%2f%2e%2e%2fpackage.json')).status, 404);
  assert.equal((await fetch(h.app.url + '/site.webmanifest', { method: 'HEAD' })).status, 200);
});

test('configuration transport preserves Statsig bytes and HTTP errors without forwarding credentials', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  const h = await fixture(t, async (input, init) => {
    calls.push({ url: String(input), init: init! });
    return new Response('{"message":"upstream error"}', { status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '3', 'Set-Cookie': 'private=value', 'Content-Encoding': 'gzip' } });
  });
  const result = await fetch(h.app.url + '/api/http-fetch', { method: 'POST', headers: { Origin: h.app.url },
    body: JSON.stringify({ url: 'https://ab.chatgpt.com/v1/initialize?k=public-key&se=1', method: 'POST', body: [0, 128, 255],
      headers: { 'statsig-api-key': 'public-key', 'Content-Type': 'application/json', Authorization: 'private', Cookie: 'private', 'X-OpenAI-Attach-Auth': '1' } }) });
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '3');
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(result.headers.get('content-encoding'), null);
  assert.equal(result.headers.get('x-workbench-fetch-error'), null);
  assert.deepEqual(await result.json(), { message: 'upstream error' });
  assert.match(calls[0]!.url, /\?k=public-key&se=1$/);
  assert.deepEqual([...calls[0]!.init.body as Uint8Array], [0, 128, 255]);
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('statsig-api-key'), 'public-key');
  assert.equal(headers.get('authorization'), null);
  assert.equal(headers.get('cookie'), null);
  assert.equal(headers.get('x-openai-attach-auth'), null);
  assert.equal(calls[0]!.init.redirect, 'error');
});

test('configuration transport rejects other origins, methods and destinations before any network request', async t => {
  let count = 0;
  const h = await fixture(t, async () => { count++; return new Response('{}'); });
  for (const headers of [{}, { Origin: 'https://untrusted.example' }] as Record<string, string>[]) {
    assert.equal((await fetch(h.app.url + '/api/http-fetch', { method: 'POST', headers, body: '{}' })).status, 403);
  }
  for (const url of ['http://127.0.0.1/private', 'https://ab.chatgpt.com.evil.example/v1/initialize',
    'https://ab.chatgpt.com/other', 'https://user:pass@ab.chatgpt.com/v1/initialize']) {
    const result = await fetch(h.app.url + '/api/http-fetch', { method: 'POST', headers: { Origin: h.app.url }, body: JSON.stringify({ url, method: 'POST' }) });
    assert.equal(result.headers.get('x-workbench-fetch-error'), '1');
  }
  const getResult = await fetch(h.app.url + '/api/http-fetch', { headers: { Origin: h.app.url } });
  assert.equal(getResult.status, 403);
  assert.equal(count, 0);
});

test('configuration network errors remain distinct from upstream HTTP responses', async t => {
  const h = await fixture(t, async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); });
  const result = await fetch(h.app.url + '/api/http-fetch', { method: 'POST', headers: { Origin: h.app.url },
    body: JSON.stringify({ url: 'https://ab.chatgpt.com/v1/initialize', method: 'POST', body: 'encoded-request' }) });
  assert.equal(result.status, 502);
  assert.equal(result.headers.get('x-workbench-fetch-error'), '1');
  assert.deepEqual(await result.json(), { error: 'fetch failed (ECONNRESET)', status: 502, responseStatus: null, errorKind: 'network' });
});

test('the browser RPC preserves null-body responses even when fetch instrumentation supplies an empty stream', async t => {
  for (const status of [204, 205, 304]) {
    let cancelled = false;
    const instrumented = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    Object.defineProperty(instrumented, 'status', { value: status });
    const mock = t.mock.method(globalThis, 'fetch', async () => instrumented);
    const result = await new BrowserHttpFetch().fetch('cached', { url: 'https://ab.chatgpt.com/v1/initialize', method: 'POST' });
    assert.ok('response' in result);
    assert.equal(result.response.status, status);
    assert.equal(result.response.body, null);
    assert.equal(await result.response.text(), '');
    assert.equal(cancelled, true);
    mock.mock.restore();
  }
});

test('closing a streaming configuration consumer cancels its upstream request', async t => {
  let upstreamSignal: AbortSignal | undefined;
  let cancelled!: () => void;
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const h = await fixture(t, async (_input, init) => {
    upstreamSignal = init!.signal!;
    upstreamSignal.addEventListener('abort', cancelled, { once: true });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('first chunk')); } }));
  });
  const controller = new AbortController();
  const result = await fetch(h.app.url + '/api/http-fetch', { method: 'POST', headers: { Origin: h.app.url }, signal: controller.signal,
    body: JSON.stringify({ url: 'https://ab.chatgpt.com/v1/initialize', method: 'POST' }) });
  assert.ok((await result.body!.getReader().read()).value?.length);
  controller.abort();
  await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('upstream was not cancelled')), 2000); timer.unref(); })]);
  assert.equal(upstreamSignal!.aborted, true);
});

test('native bridge restricts Host and Origin including the HTTPS port before opening a Codex client', async t => {
  const h = await fixture(t);
  const baseline = h.fake.calls('initialize').length;
  const hostileHost = await new Promise<number | undefined>((resolve, reject) => {
    get(h.app.url + '/', { headers: { Host: 'attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostileHost, 403);
  assert.equal((await fetch(h.app.url + '/', { headers: { Origin: 'https://workbench.example.ts.net' } })).status, 403);
  const rejected = new WebSocket(h.app.url.replace('http', 'ws') + '/native-host', { origin: 'https://attacker.invalid' });
  rejected.on('error', () => {});
  await new Promise<void>(resolve => rejected.once('close', () => resolve()));
  assert.equal(h.fake.calls('initialize').length, baseline);
});

test('external main-document links load while cross-site API, iframe, script and bridge requests remain blocked', async t => {
  const h = await fixture(t);
  const headers = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  // Fetch sets its own sec-fetch-mode; use HTTP to reproduce a browser navigation.
  const navigation = (path: string, requestHeaders = headers) => new Promise<{ status: number | undefined; type: string | undefined; body: string }>((resolve, reject) => {
    get(h.app.url + path, { headers: requestHeaders }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body: Buffer.concat(chunks).toString() }));
      response.on('error', reject);
    }).on('error', reject);
  });
  for (const path of ['/', '/?initialRoute=%2Flocal%2Fexample', '/local/example']) {
    const response = await navigation(path);
    assert.equal(response.status, 200, path);
    assert.match(response.type!, /text\/html/);
    assert.match(response.body, /workbench-entry\.js/);
  }
  for (const path of ['/api/status', '/%61pi/status', '/api/configuration/bootstrap', '/original.js']) {
    assert.equal((await navigation(path)).status, 403, path);
  }
  for (const destination of ['iframe', 'script', 'empty']) {
    assert.equal((await navigation('/', { ...headers, 'Sec-Fetch-Dest': destination })).status, 403);
  }
  assert.equal((await navigation('/', { ...headers, 'Sec-Fetch-Mode': 'cors' })).status, 403);
  assert.equal((await fetch(h.app.url + '/', { method: 'POST', headers })).status, 403);
  assert.equal((await fetch(h.app.url + '/', { headers: { ...headers, Origin: 'https://attacker.invalid' } })).status, 403);
  const baseline = h.fake.calls('initialize').length;
  const rejected = new WebSocket(h.app.url.replace('http', 'ws') + '/native-host', { origin: h.app.url, headers });
  rejected.on('error', () => {});
  await new Promise<void>(resolve => rejected.once('close', () => resolve()));
  assert.equal(h.fake.calls('initialize').length, baseline);
});

test('native config and authentication replies never include provider secrets or tokens', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('config/read', () => ({ config: { model: 'fixture-model', model_provider: 'fixture', profile: 'work',
    profiles: { work: { env: { TOKEN: 'profile-secret' } } },
    model_providers: { fixture: { api_key: 'provider-secret' } }, mcp_servers: { demo: { env: { TOKEN: 'mcp-secret' } } } }, layers: ['secret-layer'] }));
  h.fake.handlers.set('getAuthStatus', () => ({ authToken: 'token-secret', authMethod: 'apikey' }));
  const client = await h.connect();
  const config = await client.rpc(1, 'config/read');
  assert.equal(config.result.config.model, 'fixture-model');
  assert.equal(config.result.config.profile, 'work');
  assert.doesNotMatch(JSON.stringify(config), /provider-secret|mcp-secret|profile-secret|secret-layer/);
  assert.equal((await client.rpc(2, 'getAuthStatus')).result.authToken, null);
  const unknown = await client.rpc(3, 'config/value/write', { keyPath: 'model', value: 'changed' });
  assert.match(unknown.error.message, /尚未接入/);
  assert.equal(h.fake.calls('config/value/write').length, 0);
});

test('native prewarming, notifications and approval answers use the real RPC bridge once', async t => {
  const h = await fixture(t), client = await h.connect();
  client.send({ type: 'thread-prewarm-start', hostId: 'local', request: { id: 'prewarm', method: 'thread/start', params: { cwd: h.root } } });
  const started = (await client.until(message => message.type === 'mcp-response' && message.message.id === 'prewarm')).message;
  assert.ok(started.result.thread.id);
  assert.equal(h.fake.calls('thread/start').length, 1);
  const params = h.fake.calls('thread/start')[0].params;
  assert.ok(record(record(record(params.config)['mcp_servers.codex_app']).env).CODEX_APP_TOOLS_PIPE_PATH);
  assert.doesNotMatch(JSON.stringify(started), /CODEX_APP_TOOLS_PIPE_PATH/);
  h.fake.send({ method: 'item/agentMessage/delta', params: { threadId: started.result.thread.id, delta: 'streamed' } });
  assert.equal((await client.until(message => message.method === 'item/agentMessage/delta')).params.delta, 'streamed');
  h.fake.send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: started.result.thread.id } });
  const approval = await client.until(message => message.type === 'mcp-request' && message.request.id === 'approval');
  client.send({ type: 'mcp-response', hostId: 'local', generation: approval.requestRef.generation, response: { id: 'approval', result: { decision: 'decline' } } });
  assert.deepEqual((await h.fake.waitFor((message: Record<string, unknown>) => message.id === 'approval' && message.result)).result, { decision: 'decline' });
});

test('native approval resolution carries only the proven original request generation', async t => {
  const h = await fixture(t), client = await h.connect();
  await client.rpc(1, 'model/list');
  h.fake.send({ id: 'reused', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-a' } });
  const first = await client.until(message => message.type === 'mcp-request' && message.request.id === 'reused');
  h.fake.send({ method: 'serverRequest/resolved', params: { requestId: 'reused', threadId: 'thread-a', marker: 'first' } });
  const resolved = await client.until(message => message.method === 'serverRequest/resolved' && message.params.marker === 'first');
  assert.deepEqual(resolved.requestRef, first.requestRef);
  h.fake.send({ id: 'reused', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-a' } });
  const second = await client.until(message => message.type === 'mcp-request' && message.request.id === 'reused'
    && message.requestRef.generation !== first.requestRef.generation);
  h.fake.send({ method: 'serverRequest/resolved', params: { requestId: 'reused', threadId: 'thread-a', marker: 'late-duplicate' } });
  const duplicate = await client.until(message => message.method === 'serverRequest/resolved' && message.params.marker === 'late-duplicate');
  assert.equal(duplicate.requestRef, undefined);
  client.send({ type: 'mcp-response', hostId: 'local', generation: second.requestRef.generation,
    requestId: 'second-answer', response: { id: 'reused', result: { decision: 'decline' } } });
  assert.equal((await client.until(message => message.type === 'server-request-response' && message.requestId === 'second-answer')).success, true);
  assert.equal(h.fake.messages.filter(message => message.id === 'reused' && message.result).length, 1);
});

test('input dismissal interrupts only the original request turn and shares its one-shot reservation', async t => {
  const h = await fixture(t), client = await h.connect();
  h.fake.handlers.set('turn/interrupt', () => ({}));
  await client.rpc(1, 'model/list');
  h.fake.send({ id: 'input-request', method: 'item/tool/requestUserInput', params: { threadId: 'original-thread', turnId: 'original-turn', questions: [] } });
  const request = await client.until(message => message.request?.id === 'input-request');
  async function interrupt(id: string, threadId: string, turnId: string) {
    client.send({ type: 'fetch', requestId: id, url: 'vscode://codex/approval-request-interrupt',
      body: JSON.stringify({ hostId: 'local', ref: request.requestRef, threadId, turnId }) });
    return client.until(message => message.type === 'fetch-response' && message.requestId === id);
  }
  assert.equal((await interrupt('wrong-turn', 'original-thread', 'other-turn')).responseType, 'error');
  assert.equal((await interrupt('wrong-thread', 'other-thread', 'original-turn')).responseType, 'error');
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
  assert.equal((await interrupt('original', 'original-thread', 'original-turn')).responseType, 'success');
  assert.deepEqual(h.fake.calls('turn/interrupt').map(message => message.params), [{ threadId: 'original-thread', turnId: 'original-turn' }]);
  assert.equal((await interrupt('again', 'original-thread', 'original-turn')).responseType, 'error');
  client.send({ type: 'mcp-response', hostId: 'local', generation: request.requestRef.generation,
    requestId: 'duplicate-answer', response: { id: 'input-request', result: { answers: {} } } });
  const duplicate = await client.until(message => message.type === 'server-request-response' && message.requestId === 'duplicate-answer');
  assert.equal(duplicate.success, undefined);
  assert.equal(duplicate.uncertain, false);
  assert.equal(h.fake.calls('turn/interrupt').length, 1);
  assert.equal(h.fake.messages.some(message => message.id === 'input-request' && message.result), false);
});

async function configureModelFixture(fake: Awaited<ReturnType<typeof createFakeCodex>>, root: string) {
  const codexHome = join(root, 'codex'), file = join(codexHome, 'config.toml');
  await mkdir(codexHome, { recursive: true }); await writeFile(file, 'model = "fixture-model"\n');
  fake.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome }));
  fake.handlers.set('config/read', () => ({ config: {}, origins: {}, layers: [{ name: { type: 'user', file, profile: null }, version: 'v1' }] }));
}

test('Hooks and bracketed settings reads use one owned source across page closure', async t => {
  const h = await fixture(t, undefined, undefined, { beforeStart: async (fake, root) => {
    await configureModelFixture(fake, root);
    fake.handlers.set('hooks/list', () => ({ data: [] }));
    fake.handlers.set('skills/list', () => ({ data: [] }));
  } });
  const first = await h.connect();
  const before = await first.rpc(1, 'config/read');
  const hooks = await first.rpc(2, 'hooks/list', {});
  const skills = await first.rpc(3, 'skills/list', {});
  const after = await first.rpc(4, 'config/read');
  assert.ok(before.result?.yardConfigSource?.generation);
  for (const response of [hooks, skills, after]) {
    assert.equal(response.error, undefined, JSON.stringify(response));
    assert.deepEqual(response.result?.yardConfigSource, before.result.yardConfigSource);
  }
  first.socket.close(); await once(first.socket, 'close');
  const second = await h.connect();
  const reopened = await second.rpc(5, 'hooks/list', {});
  assert.deepEqual(reopened.result?.yardConfigSource, before.result.yardConfigSource);
  assert.equal(h.fake.calls('hooks/list').length, 2);
});

test('configuration operations preserve verified base targets, backend errors and the selected host', async t => {
  const remoteRoot = await mkdtemp('/tmp/aw-model-remote-'), remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  await configureModelFixture(remote, remoteRoot);
  const hostId = 'remote-ssh-discovered:model-fixture';
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Model fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: remoteRoot, codexHome: join(remoteRoot, 'codex') }); return createConnection(remote.socketPath); },
    remoteFileCommand: async () => Buffer.from('file\0' + join(remoteRoot, 'codex/config.toml') + '\0'),
    beforeStart: configureModelFixture,
  });
  const client = await h.connect();
  const params = {
    edits: [{ keyPath: 'model', value: 'fixture-model', mergeStrategy: 'upsert' },
      { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }],
    filePath: null, expectedVersion: 'v1', reloadUserConfig: true,
  };
  const localResult = { status: 'ok', version: 'local-version', filePath: '/fixture/local/config.toml', overriddenMetadata: null };
  const remoteResult = { status: 'okOverridden', version: 'remote-version', filePath: '/fixture/remote/config.toml',
    overriddenMetadata: { message: 'Managed model override', overridingLayer: { name: { type: 'mdm', domain: 'fixture', key: 'model' }, version: 'managed' } } };
  h.fake.handlers.set('config/batchWrite', received => { assert.deepEqual(received, params); return localResult; });
  remote.handlers.set('config/batchWrite', received => { assert.deepEqual(received, params); return remoteResult; });
  const write = (operationId: string, selectedHost: string, value = params) => client.host({
    hostId: selectedHost, action: 'submit', operationId, method: 'config/batchWrite', params: value,
  });
  assert.deepEqual((await write('remote-model', hostId)).result, remoteResult);
  assert.equal(h.fake.calls('config/batchWrite').length, 0);
  assert.deepEqual((await write('local-model', 'local')).result, localResult);
  assert.equal(remote.calls('config/batchWrite').length, 1);
  remote.handlers.set('config/batchWrite', () => { throw Object.assign(new Error('Fixture version conflict'), { code: -32600, data: { config_write_error_code: 'configVersionConflict' } }); });
  const rejected = await write('remote-rejection', hostId, { ...params, expectedVersion: 'stale' });
  assert.equal(rejected.outcome, 'error');
  assert.equal(rejected.error.code, -32600);
  assert.equal(rejected.error.uncertain, false);
  assert.equal(rejected.operation.terminal.kind, 'rejected');
  assert.equal(rejected.operation.terminal.code, -32600);
  assert.equal(h.fake.calls('config/batchWrite').length, 1);
});

test('lost turn and model config write replies report uncertainty without replaying', async t => {
  for (const [method, params] of [
    ['turn/start', { threadId: 'test', input: [] }],
    ['config/batchWrite', { edits: [{ keyPath: 'model', value: 'fixture-model', mergeStrategy: 'upsert' }], filePath: null, expectedVersion: null, reloadUserConfig: true }],
  ] as const) await t.test(method, async t => {
    const h = await fixture(t, undefined, undefined, { beforeStart: configureModelFixture }), client = await h.connect();
    h.fake.handlers.set(method, (_params, { socket }) => { socket.terminate(); });
    const reply = method === 'config/batchWrite'
      ? await client.host({ hostId: 'local', action: 'submit', operationId: 'lost-model', method, params })
      : await client.rpc(1, method, params);
    assert.equal(method === 'config/batchWrite' ? reply.error.uncertain : reply.error.data.uncertain, true);
    assert.equal(h.fake.calls(method).length, 1);
    if (method === 'config/batchWrite') {
      const original = await client.host({ hostId: 'local', action: 'status', operationId: 'lost-model' });
      assert.equal(original.operation.state, 'unknown');
      assert.equal(h.fake.calls(method).length, 1);
    }
  });
});

test('official queue RPCs edit, delete and start only the selected host submission', async t => {
  const remoteRoot = await mkdtemp('/tmp/aw-queue-remote-'), remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:queue-fixture';
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Queue fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => createConnection(remote.socketPath),
  });
  const client = await h.connect(), threadId = 'same-thread-id';
  h.fake.threads.set(threadId, fixtureThread(threadId, h.root));
  remote.threads.set(threadId, fixtureThread(threadId, remoteRoot));
  const input = [{ type: 'text', text: '排队中文消息', text_elements: [] }];
  let sequence = 0;
  const rpc = (method: string, params: Record<string, unknown> = {}, host = 'local') => client.rpc(++sequence, method, { threadId, ...params }, host);
  const local = (await rpc('thread/queue/add', { input, clientUserMessageId: 'local-message' })).result.queuedSubmission;
  const queued = (await rpc('thread/queue/add', { input, clientUserMessageId: 'remote-message' }, hostId)).result.queuedSubmission;
  assert.equal(local.id, queued.id, 'identical IDs on different hosts must remain isolated');
  const changed = [{ type: 'text', text: '修改后的消息', text_elements: [] }];
  const update = await rpc('thread/queue/update', { queuedSubmissionId: queued.id, input: changed }, hostId);
  assert.deepEqual(update.result.queuedSubmission.input, changed);
  assert.deepEqual(h.fake.queues.get(threadId)?.[0]?.input, input);
  assert.deepEqual((await rpc('thread/queue/list', {}, hostId)).result.data[0].input, changed);
  // Native Edit removes the queued submission before restoring its composer.
  assert.deepEqual((await rpc('thread/queue/delete', { queuedSubmissionId: queued.id }, hostId)).result, { deleted: true });
  assert.deepEqual((await rpc('thread/queue/delete', { queuedSubmissionId: queued.id }, hostId)).result, { deleted: false });
  assert.equal(h.fake.queues.get(threadId)?.length, 1);
  assert.equal(remote.queues.get(threadId)?.length, 0);
  assert.ok((await rpc('thread/queue/update', { queuedSubmissionId: queued.id, input: changed }, hostId)).error);
  assert.ok((await rpc('thread/queue/start', { queuedSubmissionId: queued.id }, hostId)).error);
  assert.ok((await rpc('thread/queue/remove', { queuedSubmissionId: local.id })).error, 'the invented remove method stays unsupported');
  assert.equal(h.fake.queues.get(threadId)?.length, 1);
  await rpc('thread/resume');
  const started = await rpc('thread/queue/start', { queuedSubmissionId: local.id });
  assert.ok(started.result.turn.id);
  assert.equal(h.fake.queues.get(threadId)?.length, 0);
  assert.equal(h.fake.calls('turn/start').length, 0, 'queue execution belongs to the daemon');
  const notification = await client.until(message => message.method === 'thread/queue/changed' && message.hostId === hostId);
  assert.equal(notification.params.threadId, threadId);
});

test('queue writes with a lost reply report uncertainty without replaying', async t => {
  for (const method of ['thread/queue/delete', 'thread/queue/update', 'thread/queue/start']) await t.test(method, async t => {
    const h = await fixture(t), client = await h.connect();
    h.fake.handlers.set(method, (_params, { socket }) => { socket.terminate(); });
    const reply = await client.rpc(1, method, { threadId: 'fixture', queuedSubmissionId: 'queued', input: [] });
    assert.equal(reply.error.data.uncertain, true);
    assert.equal(h.fake.calls(method).length, 1);
  });
});

test('prewarm cleanup preserves existing, populated and running conversations', async t => {
  const h = await fixture(t), client = await h.connect();
  h.fake.threads.set('existing', fixtureThread('existing', h.root));
  h.fake.handlers.set('thread/read', params => ({ thread: h.fake.threads.get(String(params.threadId)) }));
  h.fake.handlers.set('thread/delete', params => {
    h.fake.threads.delete(String(params.threadId));
    return {};
  });
  assert.match((await client.rpc(1, 'thread/delete', { threadId: 'existing' })).error.message, /空预热对话/);
  const { result: { thread } } = await client.rpc(2, 'thread/start', { cwd: h.root });
  const stored = h.fake.threads.get(thread.id)!;
  stored.turns.push({ id: 'populated', items: [], status: 'completed' });
  assert.match((await client.rpc(3, 'thread/delete', { threadId: thread.id })).error.message, /已有内容/);
  stored.turns.length = 0;
  stored.status = { type: 'active' };
  assert.match((await client.rpc(4, 'thread/delete', { threadId: thread.id })).error.message, /保留当前数据/);
  assert.equal(h.fake.calls('thread/delete').length, 0);
  stored.status = { type: 'idle' };
  assert.deepEqual((await client.rpc(5, 'thread/delete', { threadId: thread.id })).result, {});
  assert.equal(h.fake.calls('thread/delete').length, 1);
  assert.ok(h.fake.threads.has('existing'));
});

test('persisted Chinese drafts retain native values and reject stale writes', () => {
  const draft = { prompt: { document: { text: '中文草稿。' }, plainTextMode: false }, updatedAt: 20 };
  const saved = updatedAtom({}, { recordUpdate: { entries: { 'local:thread': { value: draft } } } });
  assert.deepEqual(saved, { 'local:thread': draft });
  assert.deepEqual(updatedAtom(saved, { recordUpdate: {
    timestampField: 'updatedAt', entries: { 'local:thread': { value: { updatedAt: 10, prompt: null } } },
  } }), saved);
  assert.deepEqual(updatedAtom(saved, { recordUpdate: { entries: {
    'local:thread': { expectedValue: { prompt: null }, delete: true },
  } } }), saved);
});

test('pages share queue send leases and do not resend an accepted message', async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  async function lock(client: typeof a, id: string, operation: string, body: object) {
    client.send({ type: 'fetch', requestId: id, url: 'vscode://codex/queued-follow-up-send-lock-' + operation, body: JSON.stringify(body) });
    return (await client.until(message => message.type === 'fetch-response' && message.requestId === id)).body;
  }
  const message = { conversationId: 'remote-thread', messageId: 'queued-message' };
  const [first, second] = await Promise.all([
    lock(a, 'a-acquire', 'acquire', { ...message, lockId: 'a' }),
    lock(b, 'b-acquire', 'acquire', { ...message, lockId: 'b' }),
  ]);
  assert.equal(Number(first.acquired) + Number(second.acquired), 1);
  const owner = first.acquired ? a : b, lockId = first.acquired ? 'a' : 'b';
  await lock(owner, 'accepted', 'release', { ...message, lockId, sent: true });
  assert.equal((await lock(b, 'retry', 'acquire', { ...message, lockId: 'retry' })).acquired, false);
  assert.equal((await lock(b, 'next', 'acquire', { ...message, messageId: 'next-message', lockId: 'next' })).acquired, true);
});

test('projectless chats receive separate existing output directories and settings writes persist', async t => {
  const h = await fixture(t), client = await h.connect();
  async function host(id: string, endpoint: string, body = {}) {
    client.send({ type: 'fetch', requestId: id, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) });
    return await client.until(message => message.type === 'fetch-response' && message.requestId === id);
  }
  const a = (await host('a', 'projectless-thread-cwd')).body;
  const b = (await host('b', 'projectless-thread-cwd')).body;
  assert.notEqual(a.cwd, b.cwd);
  assert.equal(a.cwd, a.outputDirectory);
  await host('write', 'set-global-state', { key: 'queued-follow-ups', value: { test: [] } });
  assert.deepEqual((await host('read', 'get-global-state', { key: 'queued-follow-ups' })).body.value, { test: [] });
});
