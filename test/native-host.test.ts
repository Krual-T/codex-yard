import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record, updatedAtom } from '../src/native/protocol.ts';
import { createThreadProjects } from '../src/native/thread-projects.ts';
import { PINNED_SECTION_ID, sidebarMetadata } from '../src/native/backend-sidebar-state.ts';
import { BrowserHttpFetch } from '../src/native/browser-http-fetch.ts';
import { rendererAssets } from '../src/native/renderer-assets.ts';
import { brandAssets } from '../src/native/visual-feedback.ts';
import type { HostCatalog } from '../src/native/hosts.ts';
import type { createSshProxyStream } from '../src/native/ssh.ts';
import type { RemoteFileCommand } from '../src/native/files.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, NO_REPLY } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { fileMethods } from '../src/native/files.ts';
import { nativeFixture } from './native-fixture.ts';

async function fixture(t: import('node:test').TestContext, httpFetch?: typeof fetch, snapshot?: { data: string; metadata: unknown },
  remote: { hostCatalog?: HostCatalog; sshStream?: typeof createSshProxyStream; remoteFileCommand?: RemoteFileCommand; embeddingOrigins?: string[] } = {}) {
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
  const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data'), workspace: root,
    renderer, adapterPath, port: 0, publicOrigin: 'https://workbench.example.ts.net:8765', httpFetch, ...remote });
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
    async function rpc(id: number, method: string, params: Record<string, unknown> | null = {}, hostId = 'local') {
      const start = messages.length;
      send({ type: 'mcp-request', hostId, request: { id, method, params } });
      return (await until(message => messages.indexOf(message) >= start && message.type === 'mcp-response' && message.hostId === hostId && message.message.id === id)).message;
    }
    return { socket, send, until, rpc, messages };
  }
  return { root, fake, app, connect };
}

test('preview embedding permits only explicit parent origins and keeps APIs restricted to this instance', async t => {
  const parent = 'https://trusted.example.ts.net:8765';
  const h = await fixture(t, undefined, undefined, { embeddingOrigins: [parent, 'http://127.0.0.1:8765'] });
  const page = await fetch(h.app.url + '/');
  assert.equal(page.headers.get('content-security-policy')!.split('frame-ancestors ')[1], "'self' " + parent + ' http://127.0.0.1:8765');
  const headers = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', referer: parent + '/?initialRoute=test' };
  // Native HTTP preserves the browser's navigation metadata; fetch replaces its mode.
  const navigation = (path: string, requestHeaders = headers) => new Promise<number | undefined>((resolve, reject) => {
    get(h.app.url + path, { headers: requestHeaders }, response => {
      response.on('error', reject); response.on('end', () => resolve(response.statusCode)); response.resume();
    }).on('error', reject);
  });
  assert.equal(await navigation('/'), 200);
  assert.equal(await navigation('/', { ...headers, referer: 'https://untrusted.example/' }), 403);
  assert.equal(await navigation('/', { ...headers, referer: '' }), 403);
  assert.equal(await navigation('/api/status'), 403);
  assert.equal((await fetch(h.app.url + '/api/status', { headers: { origin: parent } })).status, 403);
  const sandbox = await fetch(h.app.url + '/?app=skybridge');
  assert.match(sandbox.headers.get('content-security-policy')!, new RegExp(parent.replaceAll('.', '\\.')));
  const isolated = await fixture(t);
  assert.equal((await fetch(isolated.app.url + '/')).headers.get('content-security-policy')!.split('frame-ancestors ')[1], "'self'");
});

test('preview embedding rejects wildcards, URL paths, credentials and directive injection', async () => {
  for (const origin of ['*', 'https://*.example.com', 'https://example.com/path', 'https://user:password@example.com',
    "https://example.com; frame-ancestors *", 'data:text/html,test']) {
    await assert.rejects(createNativeWorkbench({ workspace: '/tmp', embeddingOrigins: [origin] }), /AGENTS_EMBEDDING_ORIGINS/);
  }
});

test('sidebar bootstrap seeds current project and pin queries before the renderer starts', async t => {
  const h = await fixture(t);
  const first = await h.connect();
  const snapshot = (await first.until(message => message.type === 'yard-sidebar-bootstrap')).value;
  assert.deepEqual(snapshot.catalogEntries, []);
  assert.deepEqual(snapshot.workspaceRootOptions, { roots: [], canonicalPathByRoot: {} });
  assert.equal(snapshot.projectlessWorkspaceRoot.workspaceRoot, join(h.root, 'data/workspaces'));
  assert.ok(snapshot.globalStateEntries.some((entry: { key: string }) => entry.key === 'pinned-thread-ids'));
  h.fake.threads.set('fresh-pin', fixtureThread('fresh-pin', h.root));
  first.send({ type: 'fetch', requestId: 'pin', url: 'vscode://codex/set-thread-pinned',
    body: JSON.stringify({ threadId: 'fresh-pin', pinned: true }) });
  assert.equal((await first.until(message => message.requestId === 'pin')).responseType, 'success');
  const second = await h.connect();
  const current = (await second.until(message => message.type === 'yard-sidebar-bootstrap')).value;
  assert.deepEqual(current.globalStateEntries.find((entry: { key: string }) => entry.key === 'pinned-thread-ids').value, ['fresh-pin']);
  assert.equal(record(h.fake.threads.get('fresh-pin')!.section).id, PINNED_SECTION_ID);
  assert.equal(current.globalStateEntries.some((entry: { key: string }) => entry.key === 'prompt-history'), false);
});

test('startup sidebar reads current bounded metadata before renderer ready through the existing daemon', async t => {
  const h = await fixture(t);
  h.fake.threads.set('first', fixtureThread('first', h.root, { name: 'First title',
    turns: [fixtureTurn('past', [{ id: 'answer', type: 'agentMessage', text: 'not in sidebar' }])] }));
  const client = await h.connect();
  const read = async (requestId: string) => {
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/startup-sidebar', body: '{}' });
    return (await client.until(message => message.requestId === requestId)).body;
  };
  const first = await read('startup-1');
  assert.deepEqual(first.threads, [{ id: 'first', title: 'First title', projectId: null, recencyAt: 1700000000 }]);
  assert.equal(first.locale, 'zh-CN');
  const request = h.fake.calls('thread/list').at(-1)!;
  assert.equal(request.params.limit, 50);
  assert.equal(request.params.useStateDbOnly, true);
  assert.equal(request.params.archived, false);
  h.fake.threads.get('first')!.name = 'Renamed';
  assert.equal((await read('startup-2')).threads[0].title, 'Renamed');
  client.send({ type: 'fetch', requestId: 'startup-language', url: 'vscode://codex/set-setting', body: JSON.stringify({ key: 'localeOverride', value: 'en-US' }) });
  await client.until(message => message.requestId === 'startup-language');
  assert.equal((await read('startup-3')).locale, 'en-US');
});

async function publicPreview(url: string) {
  // fetch normalizes Host to its URL; the reverse proxy preserves the public
  // host, so exercise that request shape with the native HTTP client.
  return new Promise<{ status: number | undefined; policy: string }>((resolve, reject) => {
    get(url, { headers: { Host: 'workbench.example.ts.net:8765' } }, response => {
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, policy: String(response.headers['content-security-policy']) }));
      response.resume();
    }).once('error', reject);
  });
}

test('local HTML links are read on the Yard host with bounded bytes and an isolated document', async t => {
  const h = await fixture(t);
  const markup = '<h1>LOCAL_HTML_OK</h1><script>window.ok=true</script>' + ' '.repeat(6 * 1024 * 1024);
  const requests: string[] = [];
  const upstream = createServer((request, response) => {
    requests.push(request.url!);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    if (request.url === '/redirect.html') { response.writeHead(302, { Location: '/gallery.html?q=1' }); response.end(); }
    else if (request.url === '/data.html') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}'); }
    else if (request.url === '/large.html') { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': 64 * 1024 * 1024 + 1 }); response.flushHeaders(); }
    else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(markup); }
  });
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => { upstream.closeAllConnections(); upstream.close(() => done()); }));
  const port = (upstream.address() as import('node:net').AddressInfo).port;
  const preview = (url: string, extra: Record<string, string> = {}) => h.app.url + '/api/local-html-preview?' + new URLSearchParams({ url, ...extra });
  const address = `http://localhost:${port}`;
  const result = await fetch(preview(address + '/gallery.html?q=1'), { headers: { Cookie: 'secret=value', Authorization: 'Bearer secret' } });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), markup);
  assert.match(result.headers.get('content-security-policy')!, /sandbox allow-scripts;/);
  assert.doesNotMatch(result.headers.get('content-security-policy')!, /allow-same-origin/);
  assert.match(result.headers.get('content-security-policy')!, /connect-src data: blob:/);
  assert.equal(result.headers.get('content-security-policy')!.split('frame-ancestors ')[1], "'self'");
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await fetch(preview(address + '/gallery.html'), { method: 'POST' })).status, 405);
  for (const url of ['http://example.com/gallery.html', 'http://127.0.0.2/gallery.html', 'file:///tmp/gallery.html',
    'http://user:password@localhost/gallery.html', address + '/api']) {
    assert.equal((await fetch(preview(url))).status, 400);
  }
  assert.equal((await fetch(preview(address + '/gallery.html', { hostId: 'remote-ssh:test' }))).status, 400);
  assert.equal((await fetch(preview(address + '/redirect.html'))).status, 502);
  assert.equal((await fetch(preview(address + '/data.html'))).status, 502);
  assert.equal((await fetch(preview(address + '/large.html'))).status, 413);
  assert.deepEqual(requests, ['/gallery.html?q=1', '/redirect.html', '/data.html', '/large.html']);
  const securePreview = await publicPreview(preview(address + '/gallery.html'));
  assert.equal(securePreview.status, 200);
  assert.equal(securePreview.policy.split('frame-ancestors ')[1], 'https://workbench.example.ts.net:8765');
  assert.equal((await fetch(preview(address + '/gallery.html'), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('SSH settings save new hosts, publish them to other pages, route connections immediately and retain the catalog after restart', async t => {
  const seen: string[] = [];
  let socketPath = '';
  const sshStream: typeof createSshProxyStream = host => { seen.push(host.sshHost); return createConnection(socketPath); };
  const h = await fixture(t, undefined, undefined, { sshStream });
  socketPath = h.fake.socketPath;
  const first = await h.connect(), second = await h.connect();
  let sequence = 0;
  async function host(endpoint: string, body: unknown = {}) {
    const requestId = 'ssh-save-' + ++sequence;
    first.send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) });
    return first.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  const profile = { hostId: 'remote-ssh-codex-managed:fixture', displayName: 'Fixture host', alias: null,
    hostname: 'user@fixture.example', sshPort: 2222, identity: '/server-only/key' };
  const saved = await host('save-codex-managed-remote-ssh-connections', { remoteConnections: [profile] });
  assert.equal(saved.responseType, 'success');
  assert.equal(saved.body.remoteConnections[0].hostId, profile.hostId);
  assert.equal(saved.body.remoteConnections[0].identity, null);
  await second.until(message => message.type === 'shared-object-updated' && message.key === 'remote_ssh_connections' && message.value.length === 1);
  assert.equal((await host('set-remote-connection-auto-connect', { hostId: profile.hostId, autoConnect: true })).body.state, 'connected');
  assert.deepEqual(seen, ['user@fixture.example']);
  assert.equal((await host('save-codex-managed-remote-ssh-connections', { remoteConnections: saved.body.remoteConnections })).responseType, 'success');
  assert.equal(JSON.parse(await readFile(join(h.root, 'data/native-state.json'), 'utf8')).globals['codex-managed-remote-connections'][0].identity, '/server-only/key');
  for (const bad of [{ ...profile, hostname: '-Fbad' }, { ...profile, sshPort: 0 }]) {
    assert.equal((await host('save-codex-managed-remote-ssh-connections', { remoteConnections: [bad] })).responseType, 'error');
  }
  assert.equal((await host('refresh-remote-connections')).body.remoteConnections.length, 1);
  assert.deepEqual((await first.rpc(90, 'thread/list', {}, profile.hostId)).result.data, []);
  await assert.rejects(readFile(join(h.root, 'codex/.codex-global-state.json')), { code: 'ENOENT' });
  await host('save-codex-managed-remote-ssh-connections', { remoteConnections: [{ ...profile, hostname: 'other.fixture' }] });
  await first.rpc(91, 'thread/list', {}, profile.hostId);
  assert.deepEqual(seen, ['user@fixture.example', 'other.fixture']);
  await host('save-codex-managed-remote-ssh-connections', { remoteConnections: [] });
  assert.equal((await host('refresh-remote-connections')).body.remoteConnections.length, 0);
  assert.ok((await first.rpc(92, 'thread/list', {}, profile.hostId)).error);
  await host('save-codex-managed-remote-ssh-connections', { remoteConnections: [profile] });
  await h.app.close();
  const restarted = await createNativeWorkbench({ socketPath, codexHome: join(h.root, 'codex'), dataDir: join(h.root, 'data'),
    workspace: h.root, renderer: join(h.root, 'renderer'), adapterPath: join(h.root, 'renderer/renderer.json'), port: 0, sshStream,
    hostCatalog: { hosts: [], projects: [], assignments: {} } });
  try {
    const status = await (await fetch(restarted.url + '/api/status')).json();
    assert.ok(status.hosts.some((host: { hostId: string }) => host.hostId === profile.hostId));
  } finally { await restarted.close(); }
});

test('sidebar pins persist in the backend, notify other pages, preserve concurrent additions during reorder and reject invalid orders', async t => {
  const h = await fixture(t), first = await h.connect(), second = await h.connect();
  for (const id of ['a', 'b', 'new']) h.fake.threads.set(id, fixtureThread(id, h.root));
  let sequence = 0;
  async function host(endpoint: string, body: unknown = {}) {
    const requestId = 'pin-' + ++sequence;
    first.send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) });
    return first.until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  assert.deepEqual((await host('list-pinned-threads')).body.threadIds, []);
  assert.equal((await host('set-thread-pinned', { threadId: 'a', pinned: true })).responseType, 'success');
  await second.until(message => message.type === 'pinned-threads-updated');
  await host('set-thread-pinned', { threadId: 'b', pinned: true, beforeThreadId: null });
  await host('set-thread-pinned', { threadId: 'new', pinned: true });
  await host('set-pinned-threads-order', { threadIds: ['b', 'a'], movedThreadId: 'b' });
  assert.deepEqual((await host('list-pinned-threads')).body.threadIds, ['b', 'a', 'new']);
  assert.equal((await host('set-pinned-threads-order', { threadIds: ['a', 'a'] })).responseType, 'error');
  assert.equal((await host('set-thread-pinned', { threadId: '', pinned: true })).responseType, 'error');
  await host('set-thread-pinned', { threadId: 'a', pinned: false });
  assert.deepEqual(h.fake.sectionMembers.get(PINNED_SECTION_ID), ['b', 'new']);
  assert.deepEqual((await host('list-pinned-threads')).body.threadIds, ['b', 'new']);
  assert.equal(JSON.parse(await readFile(join(h.root, 'data/native-state.json'), 'utf8')).globals['pinned-thread-ids'], undefined);
});

test('explicit creation gives two same-name sections distinct native identities and deleting one preserves the other', async t => {
  const h = await fixture(t), client = await h.connect();
  let sequence = 0;
  async function sections(params: Record<string, unknown>) {
    const requestId = 'section-create-' + ++sequence;
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/pinned-thread-sections', body: JSON.stringify(params) });
    const response = await client.until(message => message.type === 'fetch-response' && message.requestId === requestId);
    assert.equal(response.responseType, 'success', JSON.stringify(response));
    return response.body;
  }
  const first = await sections({ operation: 'create', logicalSectionId: 'ui-first', name: 'Same name' });
  const second = await sections({ operation: 'create', logicalSectionId: 'ui-second', name: 'Same name' });
  assert.equal(typeof first.id, 'string'); assert.equal(typeof second.id, 'string');
  assert.notEqual(first.id, second.id);
  assert.deepEqual([...h.fake.sections.values()].filter(section => section.name === 'Same name').map(section => section.id), [first.id, second.id]);
  assert.equal(h.fake.calls('threadSection/create').length, 2);
  assert.deepEqual((await sections({ operation: 'list' })).sections.map((section: { id: string }) => section.id), [first.id, second.id]);
  assert.deepEqual(await sections({ operation: 'delete', sectionId: first.id }), { success: true });
  assert.equal(h.fake.sections.has(first.id), false);
  assert.deepEqual(h.fake.sections.get(second.id), second);
  assert.deepEqual((await sections({ operation: 'list' })).sections, [{ ...second, threadIds: [], hostId: 'local' }]);
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
  // The binary preview transport must cross the former 10 MiB limit without
  // putting base64 into a WebSocket frame; text/RPC limits remain bounded.
  const contentQuery = new URLSearchParams({ path: large, maxBytes: String(40 * 1024 * 1024) });
  const content = await fetch(h.app.url + '/api/files/content?' + contentQuery);
  assert.equal(content.status, 200);
  assert.equal((await content.arrayBuffer()).byteLength, 10 * 1024 * 1024 + 1);
  assert.equal(content.headers.get('cache-control'), 'no-store');
  assert.match(content.headers.get('content-disposition')!, /^attachment;/);
  contentQuery.set('maxBytes', String(10 * 1024 * 1024));
  assert.equal((await fetch(h.app.url + '/api/files/content?' + contentQuery)).status, 413);
  contentQuery.set('maxBytes', '-1');
  assert.equal((await fetch(h.app.url + '/api/files/content?' + contentQuery)).status, 400);
  const invalidContent: Record<string, string>[] = [{ path: empty }, { path: join(root, 'missing') }, { path: text, hostId: 'unknown' }];
  for (const params of invalidContent) {
    assert.equal((await fetch(h.app.url + '/api/files/content?' + new URLSearchParams(params))).status, 400);
  }
  const html = join(root, '中文.html'), markup = '<h1>HTML_RENDERED</h1><script>window.ok=true</script>';
  await writeFile(html, markup);
  const preview = await fetch(h.app.url + '/api/files/html-preview?' + new URLSearchParams({ path: html }));
  assert.equal(await preview.text(), markup);
  assert.equal(preview.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(preview.headers.get('content-security-policy')!, /sandbox allow-scripts;/);
  assert.doesNotMatch(preview.headers.get('content-security-policy')!, /allow-same-origin/);
  assert.match(preview.headers.get('content-security-policy')!, /connect-src data: blob:/);
  assert.equal(preview.headers.get('content-security-policy')!.split('frame-ancestors ')[1], "'self'");
  for (const route of ['/?app=skybridge', '/api/files/html-preview?' + new URLSearchParams({ path: html })]) {
    const sandbox = await publicPreview(h.app.url + route);
    assert.equal(sandbox.status, 200);
    assert.equal(sandbox.policy.split('frame-ancestors ')[1], 'https://workbench.example.ts.net:8765');
  }
  assert.equal((await fetch(h.app.url + '/api/files/html-preview?' + new URLSearchParams({ path: text }))).status, 400);
  await truncate(html, 5_000_001);
  assert.equal((await fetch(h.app.url + '/api/files/html-preview?' + new URLSearchParams({ path: html }))).status, 200);
  await truncate(html, 64 * 1024 * 1024 + 1);
  assert.equal((await fetch(h.app.url + '/api/files/html-preview?' + new URLSearchParams({ path: html }))).status, 413);
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
  const tooLarge = await fetch(h.app.url + '/api/files/upload?' + new URLSearchParams({ uploadId: upload.uploadId, name: 'too-large' }), { method: 'POST', headers, body: Buffer.alloc(64 * 1024 * 1024 + 1) });
  assert.equal(tooLarge.status, 400);
  assert.match((await tooLarge.json()).error, /64 MiB/);
  assert.deepEqual(Buffer.from(await readFile(selected.fsPath)), data);
  assert.equal(h.fake.calls('fs/writeFile').length, 0, 'staged bytes stay outside daemon JSON frames');
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
  const content = await fetch(h.app.url + '/api/files/content?' + new URLSearchParams({ hostId, path: join(root, '中文.txt') }));
  assert.equal(await content.text(), 'REMOTE_中文');
  await writeFile(join(root, 'preview.html'), '<h1>LOCAL</h1>');
  await writeFile(join(remoteRoot, 'preview.html'), '<h1>REMOTE_HTML</h1>');
  const html = await fetch(h.app.url + '/api/files/html-preview?' + new URLSearchParams({ hostId, path: join(root, 'preview.html') }));
  assert.equal(await html.text(), '<h1>REMOTE_HTML</h1>');
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
  a.send({ type: 'avatar-overlay-open' });
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

test('the local bootstrap serves the exact downloaded evaluations with their capture profile and no upstream call', async t => {
  let requests = 0;
  const data = JSON.stringify({ has_updates: true, feature_gates: { gate: { value: true } }, dynamic_configs: {}, layer_configs: {} });
  const user = { appVersion: '26.1013.40934', custom: { auth_status: 'logged_out' }, customIDs: { stableID: 'captured-browser' } };
  const capturedAt = '2026-10-26T08:22:03.255Z';
  const h = await fixture(t, async () => { requests++; throw Error('Upstream should not be called'); },
    { data, metadata: { rendererVersion: user.appVersion, capturedAt, client: { user } } });
  const response = await fetch(h.app.url + '/api/configuration/bootstrap');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-cache');
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.deepEqual(await response.json(), { rendererVersion: user.appVersion, capturedAt, user, data });
  const tag = response.headers.get('etag')!;
  assert.ok(tag);
  const cached = await fetch(h.app.url + '/api/configuration/bootstrap', { headers: { 'If-None-Match': tag } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  assert.equal(cached.headers.get('etag'), tag);
  assert.equal(cached.headers.get('vary'), 'Accept-Encoding');
  assert.equal((await fetch(h.app.url + '/api/configuration/bootstrap', { headers: { 'If-None-Match': 'W/"previous-capture"' } })).status, 200);
  assert.equal(requests, 0);
  const status = await (await fetch(h.app.url + '/api/status')).json();
  assert.deepEqual(status.configurationSnapshot, { capturedAt, bytes: Buffer.byteLength(data) });
});

test('an installation without a local snapshot leaves normal configuration initialization available', async t => {
  const h = await fixture(t);
  assert.equal((await fetch(h.app.url + '/api/configuration/bootstrap')).status, 404);
  assert.equal((await (await fetch(h.app.url + '/api/status')).json()).configurationSnapshot, null);
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
  const response = await a.rpc(1, 'thread/start', { cwd: h.root });
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  const { result: { thread } } = response;
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
  for (const id of ['parent', 'ordinary', 'saved']) h.fake.threads.set(id, fixtureThread(id, h.root));
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

test('persistent sidechat requests fail before mutation on an old backend and forward the native contract on 0.169.1', async t => {
  const h = await fixture(t);
  h.fake.threads.set('parent', fixtureThread('parent', h.root));
  const old = await h.connect();
  const params = { threadId: 'parent', attachToSource: true, ephemeral: false, excludeTurns: true };
  assert.match((await old.rpc(1, 'thread/fork', params)).error.message, /0\.169\.1/);
  assert.equal(h.fake.calls('thread/fork').length, 0);
  h.fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
  h.fake.handlers.set('thread/fork', input => ({ thread: fixtureThread('attached', h.root, {
    attachedToThreadId: input.threadId, forkedFromId: input.threadId as string, ephemeral: false,
  }) }));
  const upgraded = await h.connect();
  const result = (await upgraded.rpc(1, 'thread/fork', params)).result;
  assert.equal(result.thread.attachedToThreadId, 'parent');
  assert.equal(result.thread.ephemeral, false);
  const request = h.fake.calls('thread/fork')[0]!.params;
  for (const [field, value] of Object.entries(params)) assert.equal(request[field], value);
  assert.ok(request.config, 'The existing standalone tool configuration stays on the fork');
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
  const remoteStartProject = await projectRequest(client, 'remote-start-project', 'getThreadStartProjectId',
    { projectKind: 'remote', projectId: 'remote-project', hostId });
  assert.equal(remoteStartProject.responseType, 'success');
  const [local, ssh] = await Promise.all([
    client.rpc(1, 'thread/start', { cwd: h.root }), client.rpc(1, 'thread/start', { cwd: '/remote/project', projectId: remoteStartProject.body }, hostId),
  ]);
  assert.equal(local.result.thread.cwd, h.root);
  assert.equal(ssh.result.thread.cwd, '/remote/project');
  assert.equal(remote.calls('thread/start').length, 1);
  assert.equal(remote.calls('thread/start')[0].params.config, undefined);
  const initialized = await client.until(message => message.type === 'codex-app-server-initialized' && message.hostId === hostId);
  assert.equal(initialized.transport, 'websocket');
  remote.send({ id: 'ssh-approval', method: 'item/commandExecution/requestApproval', params: { threadId: ssh.result.thread.id } });
  assert.equal((await client.until(message => message.request?.id === 'ssh-approval')).hostId, hostId);
  client.send({ type: 'mcp-response', hostId, response: { id: 'ssh-approval', result: { decision: 'decline' } } });
  await remote.waitFor(message => message.id === 'ssh-approval' && message.result);
  assert.equal(h.fake.messages.some(message => message.id === 'ssh-approval'), false);
  remote.send({ method: 'item/agentMessage/delta', params: { threadId: ssh.result.thread.id, delta: 'remote' } });
  assert.equal((await client.until(message => message.params?.delta === 'remote')).hostId, hostId);
  const assignment = { projectKind: 'remote', projectId: 'remote-project' };
  const saved = await projectRequest(client, 'remote-assignment', 'setAssignment', { threadId: ssh.result.thread.id, hostId, assignment });
  assert.equal(saved.responseType, 'success');
  const persisted = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'));
  const nativeRemoteProject = [...remote.projects.values()].find(project => record(project.metadata)[sidebarMetadata.legacyIds] === JSON.stringify(['remote-project']))!;
  assert.equal(remote.threads.get(ssh.result.thread.id)!.projectId, nativeRemoteProject.id);
  assert.equal(h.fake.threads.get(local.result.thread.id)!.projectId, null);
  assert.equal(persisted.globals['thread-project-assignments'], undefined);
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

test('a disconnected SSH host cannot block local sidebar refresh, order or sections and is not reconnected by those reads', async t => {
  const root = await mkdtemp('/tmp/aw-sidebar-disconnect-'), remote = await createFakeCodex(root);
  t.after(async () => { await remote.close(); await rm(root, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:sidebar', streams: ReturnType<typeof createConnection>[] = [];
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Remote sidebar', sshAlias: 'sidebar', sshHost: 'sidebar', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => { const stream = createConnection(remote.socketPath); streams.push(stream); return stream; },
  });
  const client = await h.connect();
  let sequence = 0;
  async function host(endpoint: string, body: Record<string, unknown> = {}) {
    const requestId = 'sidebar-disconnect-' + ++sequence;
    client.send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) });
    const response = await client.until(message => message.type === 'fetch-response' && message.requestId === requestId);
    assert.equal(response.responseType, 'success', JSON.stringify(response));
    return response.body;
  }
  const localProject = (await client.rpc(1, 'project/create', { name: 'Local project', roots: [{ path: h.root }] })).result.project;
  const remoteProject = (await client.rpc(2, 'project/create', { name: 'Remote project', roots: [{ path: '/remote' }] }, hostId)).result.project;
  const localSection = (await client.rpc(3, 'threadSection/create', { name: 'Local section', appearance: null })).result.section;
  const remoteSection = (await client.rpc(4, 'threadSection/create', { name: 'Remote section', appearance: null }, hostId)).result.section;
  for (const [backend, cwd, prefix, section] of [[h.fake, h.root, 'local', localSection], [remote, '/remote', 'remote', remoteSection]] as const) {
    backend.threads.set(prefix + '-member', fixtureThread(prefix + '-member', cwd));
    backend.threads.set(prefix + '-pin', fixtureThread(prefix + '-pin', cwd));
    const executionHost = prefix === 'local' ? 'local' : hostId;
    await client.rpc(5, 'thread/section/move', { threadId: prefix + '-member', sectionId: section.id }, executionHost);
    await client.rpc(6, 'thread/section/move', { threadId: prefix + '-pin', sectionId: PINNED_SECTION_ID }, executionHost);
  }
  assert.deepEqual((await host('sidebar-orders')).projects, [
    { id: localProject.id, hostId: 'local' }, { id: remoteProject.id, hostId },
  ]);
  assert.deepEqual((await host('pinned-thread-sections', { operation: 'list' })).hostIds, ['local', hostId]);
  assert.equal(streams.length, 1);
  const disconnectStart = client.messages.length;
  for (const stream of streams) stream.destroy();
  await client.until(message => client.messages.indexOf(message) >= disconnectStart &&
    message.type === 'codex-app-server-connection-changed' && message.hostId === hostId && message.state === 'disconnected');
  const attempts = streams.length, remoteRequests = remote.messages.length;
  h.fake.sections.get(localSection.id)!.name = 'Local section after disconnect';
  assert.deepEqual(await host('sidebar-refresh'), { success: true, failedHostIds: [] });
  const order = await host('sidebar-orders');
  assert.deepEqual(order.projects, [{ id: localProject.id, hostId: 'local' }]);
  assert.deepEqual(order.pins, [{ id: 'local-pin', hostId: 'local' }]);
  const sections = await host('pinned-thread-sections', { operation: 'list' });
  assert.deepEqual(sections.hostIds, ['local']);
  assert.deepEqual(sections.sections, [{ ...localSection, name: 'Local section after disconnect', threadIds: ['local-member'], hostId: 'local' }]);
  assert.equal(streams.length, attempts, 'default sidebar reads must not reconnect a disconnected SSH transport');
  assert.equal(remote.messages.length, remoteRequests, 'local sidebar reads must not send RPCs to the disconnected host');
});

test('an old SSH backend retains ordinary RPCs and legacy membership and pins, then migrates after a newer initialize on reconnect', async t => {
  const root = await mkdtemp('/tmp/aw-sidebar-old-backend-'), remote = await createFakeCodex(root);
  t.after(async () => { await remote.close(); await rm(root, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:old', streams: ReturnType<typeof createConnection>[] = [];
  let version = '0.147.0';
  remote.handlers.set('initialize', () => ({ userAgent: 'disposable-codex-fixture/' + version }));
  const newerMethods = ['project/list', 'project/read', 'project/create', 'project/update', 'project/move', 'project/delete',
    'threadSection/list', 'threadSection/create', 'threadSection/update', 'threadSection/delete', 'thread/metadata/update', 'thread/section/move'];
  for (const method of newerMethods) remote.handlers.set(method, () => { throw new Error('Old backend does not support ' + method); });
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Old SSH', sshAlias: 'old', sshHost: 'old', sshPort: null, identity: null }],
      projects: [{ hostId, id: 'old-project', remotePath: '/old', label: 'Old project' }], assignments: {} },
    sshStream: () => { const stream = createConnection(remote.socketPath); streams.push(stream); return stream; },
  });
  remote.threads.set('old-chat', fixtureThread('old-chat', '/old'));
  const client = await h.connect();
  assert.equal((await client.rpc(1, 'thread/list', {}, hostId)).result.data[0].id, 'old-chat');
  const initialized = await client.until(message => message.type === 'codex-app-server-initialized' && message.hostId === hostId);
  assert.equal(initialized.appServerVersion, '0.147.0'); assert.equal(initialized.yardSidebarStateAvailable, false);
  const assignment = { projectKind: 'remote', projectId: 'old-project', hostId };
  assert.equal((await projectRequest(client, 'old-start-id', 'getThreadStartProjectId', assignment)).body, null);
  assert.equal((await projectRequest(client, 'old-membership', 'setMembership', { threadId: 'old-chat', hostId, assignment, projectless: false })).responseType, 'success');
  client.send({ type: 'fetch', requestId: 'old-pin', url: 'vscode://codex/set-thread-pinned', body: JSON.stringify({ threadId: 'old-chat', hostId, pinned: true }) });
  assert.equal((await client.until(message => message.requestId === 'old-pin')).responseType, 'success');
  const persisted = JSON.parse(await readFile(join(h.root, 'data/native-state.json'), 'utf8')).globals;
  assert.deepEqual(persisted['thread-project-assignments'], { 'old-chat': assignment });
  assert.deepEqual(persisted['pinned-thread-ids'], ['old-chat']);
  assert.equal(persisted['remote-projects'][0].id, 'old-project');
  assert.equal(remote.messages.some(message => newerMethods.includes(String(message.method))), false);
  assert.deepEqual((await client.rpc(2, 'thread/list')).result.data, []);
  const reconnectStart = client.messages.length;
  for (const stream of streams) stream.destroy();
  await client.until(message => client.messages.indexOf(message) >= reconnectStart &&
    message.type === 'codex-app-server-connection-changed' && message.hostId === hostId && message.state === 'disconnected');
  version = '0.164.0'; for (const method of newerMethods) remote.handlers.delete(method);
  const upgraded = await client.rpc(3, 'thread/list', {}, hostId);
  assert.equal(upgraded.error, undefined);
  const project = [...remote.projects.values()][0]!;
  assert.equal(upgraded.result.data[0].projectId, project.id);
  assert.deepEqual(remote.sectionMembers.get(PINNED_SECTION_ID), ['old-chat']);
  assert.equal((await client.until(message => client.messages.indexOf(message) >= reconnectStart &&
    message.type === 'codex-app-server-initialized' && message.hostId === hostId)).yardSidebarStateAvailable, true);
  const migrated = JSON.parse(await readFile(join(h.root, 'data/native-state.json'), 'utf8')).globals;
  for (const key of ['remote-projects', 'thread-project-assignments', 'pinned-thread-ids']) assert.equal(migrated[key], undefined, key);
});

test('native create_thread resolves a cold remote legacy project before start and preserves old backend creation', async t => {
  for (const version of ['0.164.0', '0.147.0']) await t.test(version, async t => {
    const root = await mkdtemp('/tmp/aw-cold-remote-create-'), remote = await createFakeCodex(root);
    t.after(async () => { await remote.close(); await rm(root, { recursive: true, force: true }); });
    const hostId = 'remote-ssh-discovered:cold';
    let connections = 0;
    remote.handlers.set('initialize', () => ({ userAgent: 'disposable-codex-fixture/' + version }));
    const h = await fixture(t, undefined, undefined, {
      hostCatalog: { hosts: [{ hostId, displayName: 'Cold SSH', sshAlias: 'cold', sshHost: 'cold', sshPort: null, identity: null }],
        projects: [{ hostId, id: 'legacy-project', remotePath: '/remote/project', label: 'Remote project' }], assignments: {} },
      sshStream: () => { connections++; return createConnection(remote.socketPath); },
    });
    h.fake.threads.set('caller', fixtureThread('caller', h.root, { turns: [fixtureTurn('calling-turn')] }));
    assert.equal(connections, 0);
    const socket = createConnection(join(h.root, 'data/app-tools.sock'));
    t.after(() => socket.destroy());
    let buffer = Buffer.alloc(0);
    const messages: Record<string, any>[] = [];
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const size = buffer.readUInt32LE(0);
        messages.push(JSON.parse(buffer.subarray(4, 4 + size).toString('utf8')));
        buffer = buffer.subarray(4 + size); socket.emit('reply');
      }
    });
    await once(socket, 'connect');
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      callerSource: 'codex', hostId: 'local', threadId: 'caller', turnId: 'calling-turn', callId: 'cold-create',
      namespace: 'codex_app', tool: 'create_thread', arguments: { prompt: 'Work in the remote project',
        target: { type: 'project', projectId: 'legacy-project', environment: { type: 'local' } } },
    } }));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body]));
    const signal = AbortSignal.timeout(5000);
    while (!messages.length) await once(socket, 'reply', { signal });
    const reply = messages[0]!;
    assert.equal(reply.error, undefined, JSON.stringify(reply));
    assert.equal(reply.result.success, true, JSON.stringify(reply));
    const created = JSON.parse(reply.result.contentItems[0].text);
    assert.equal(created.hostId, hostId); assert.equal(connections, 1);
    const starts = remote.calls('thread/start'); assert.equal(starts.length, 1);
    const saved = JSON.parse(await readFile(join(h.root, 'data/native-state.json'), 'utf8')).globals;
    if (version === '0.164.0') {
      const project = [...remote.projects.values()][0]!;
      assert.notEqual(project.id, 'legacy-project'); assert.equal(starts[0]!.params.projectId, project.id);
      assert.equal(remote.threads.get(created.threadId)!.projectId, project.id);
      assert.equal(saved['thread-project-assignments'], undefined);
      assert.equal(remote.calls('thread/metadata/update').length, 0, 'canonical projectId belongs in thread/start before a rollout exists');
    } else {
      assert.equal(Object.hasOwn(starts[0]!.params, 'projectId'), false);
      assert.deepEqual(saved['thread-project-assignments'][created.threadId], { projectKind: 'remote', projectId: 'legacy-project', hostId });
      assert.equal(remote.messages.some(message => String(message.method).startsWith('project/') || String(message.method).startsWith('threadSection/') ||
        message.method === 'thread/metadata/update' || message.method === 'thread/section/move'), false);
    }
  });
});

test('a project chat saves backend membership before its first turn and notifies other pages', async t => {
  const h = await fixture(t), client = await h.connect(), other = await h.connect();
  const project = (await client.rpc(90, 'project/create', { name: 'Fixture project', roots: [{ path: h.root }],
    metadata: { [sidebarMetadata.legacyIds]: JSON.stringify([h.root]) }, idempotencyKey: 'membership-project' })).result.project;
  const assignment = { projectKind: 'local', projectId: h.root };
  const startProject = await projectRequest(client, 'start-project', 'getThreadStartProjectId', assignment);
  assert.equal(startProject.body, project.id);
  const { result: { thread } } = await client.rpc(1, 'thread/start', { cwd: h.root, projectId: startProject.body });
  const canonicalAssignment = { projectKind: 'local', projectId: project.id };
  const saved = await projectRequest(client, 'assign', 'setAssignment', { threadId: thread.id, hostId: 'local', assignment });
  assert.equal(saved.responseType, 'success');
  const event = await other.until(message => message.type === 'thread-project-memberships-updated');
  assert.deepEqual(event.memberships[thread.id], { assignment: canonicalAssignment, projectless: false });
  const persisted = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(h.fake.threads.get(thread.id)!.projectId, project.id);
  assert.equal(h.fake.calls('thread/metadata/update').length, 0, 'thread/start already owns first-turn membership');
  assert.equal(persisted.globals['thread-project-assignments'], undefined);
  assert.ok((await client.rpc(2, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'first project message' }] })).result);
  assert.equal(h.fake.calls('turn/start').length, 1);
  const beforeMove = await projectRequest(client, 'move-projectless', 'moveLocalProjectThreadsToProjectless', h.root);
  assert.deepEqual(beforeMove.body, [{ threadId: thread.id, assignment: canonicalAssignment, projectless: false }]);
  assert.equal(h.fake.threads.get(thread.id)!.projectId, null);
});

test('concurrent membership writes retain both chats and invalid restore batches leave state untouched', async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  const project = (await a.rpc(90, 'project/create', { name: 'Fixture project', roots: [{ path: h.root }],
    metadata: { [sidebarMetadata.legacyIds]: JSON.stringify([h.root]) }, idempotencyKey: 'concurrent-project' })).result.project;
  for (const id of ['chat-a', 'chat-b']) h.fake.threads.set(id, fixtureThread(id, h.root));
  const assignment = { projectKind: 'local', projectId: h.root };
  const writes = await Promise.all([
    projectRequest(a, 'a', 'setAssignment', { threadId: 'chat-a', assignment }),
    projectRequest(b, 'b', 'setMembership', { threadId: 'chat-b', assignment: null, projectless: true }),
  ]);
  assert.ok(writes.every(reply => reply.responseType === 'success'));
  const before = await readFile(join(h.root, 'data', 'native-state.json'), 'utf8');
  const state = JSON.parse(before).globals;
  assert.equal(h.fake.threads.get('chat-a')!.projectId, project.id);
  assert.equal(h.fake.threads.get('chat-b')!.projectId, null);
  assert.equal(state['thread-project-assignments'], undefined);
  assert.deepEqual(state['projectless-thread-ids'], ['chat-b']);
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
  assert.deepEqual(state['projectless-thread-ids'], ['projectless']);
  assert.equal(state['thread-workspace-root-hints'].projectless, '/workspace');
  await projectRequest(client, 'remove', 'updateProjectlessThread', { threadId: 'projectless', projectless: false, outputDirectory: null });
  await projectRequest(client, 'stale', 'updateProjectlessThread', value);
  state = JSON.parse(await readFile(join(h.root, 'data', 'native-state.json'), 'utf8')).globals;
  assert.deepEqual(state['projectless-thread-ids'], []);
  assert.equal(state['thread-projectless-output-directories'], undefined);
  assert.equal(state['thread-workspace-root-hints'], undefined);
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
  assert.deepEqual(globals, { 'thread-project-assignments': { chat: value.assignment } });
  assert.ok(events.length);
});

test('native bridge serves unchanged assets and native routes with an injected TypeScript host', async t => {
  const h = await fixture(t);
  const page = await fetch(h.app.url + '/local/test-thread');
  const html = await page.text();
  assert.match(html, /src="\/native-host.js"/);
  assert.match(html, /src="\/workbench-entry.js"/);
  assert.doesNotMatch(html, /index-acf264e41d60/);
  for (const path of [rendererAssets.application, rendererAssets.primary, rendererAssets.locale]) {
    assert.ok(html.includes(`rel="modulepreload" crossorigin href="${path}"`));
  }
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
  for (const path of ['/', '/workbench-entry.js', '/native-host.js', '/api/status']) {
    assert.equal((await fetch(h.app.url + path)).headers.get('cache-control'), 'no-store');
  }
  for (const name of ['workbench-entry.js', 'native-host.js']) {
    const original = await readFile(new URL('../.local/' + name, import.meta.url), 'utf8');
    const compressed = await fetch(h.app.url + '/' + name, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(compressed.headers.get('content-encoding'), 'gzip');
    assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
    assert.equal(await compressed.text(), original);
    const identity = await fetch(h.app.url + '/' + name, { headers: { 'Accept-Encoding': 'gzip;q=0, identity' } });
    assert.equal(identity.headers.get('content-encoding'), null);
    assert.equal(await identity.text(), original);
    assert.equal(await (await fetch(h.app.url + '/' + name, { method: 'HEAD' })).text(), '');
  }
});

test('startup assets negotiate Brotli while preserving gzip and identity', async t => {
  const h = await fixture(t);
  await mkdir(join(h.root, 'renderer', 'assets'));
  const source = 'export const fixture = ' + JSON.stringify('startup translations '.repeat(400)) + ';';
  await writeFile(join(h.root, 'renderer', 'assets', new URL(rendererAssets.locale, h.app.url).pathname.split('/').at(-1)!), source);
  for (const [accept, expected] of [
    ['gzip, br', 'br'],
    ['gzip;q=0.3, BR;q=0.7', 'br'],
    ['gzip;q=0.8, br;q=0.3', 'gzip'],
    ['gzip, br;q=0', 'gzip'],
    ['gzip;q=0, br;q=0, identity', null],
  ] as const) {
    const response = await fetch(h.app.url + rendererAssets.locale, { headers: { 'Accept-Encoding': accept } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), expected);
    assert.equal(response.headers.get('vary'), 'Accept-Encoding');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(await response.text(), source);
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
    assert.match(html, /content="manifest-src &#39;self&#39;; default-src &#39;none&#39;;"/);
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
    assert.match(response.body, /native-host\.js/);
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
  assert.equal(config.result.config.model, 'yard-model:fixture/fixture-model');
  assert.equal(config.result.config.profile, 'work');
  assert.deepEqual(config.result.config.features, { remote_connections: true });
  assert.doesNotMatch(JSON.stringify(config), /provider-secret|mcp-secret|profile-secret|secret-layer/);
  assert.equal((await client.rpc(2, 'getAuthStatus')).result.authToken, null);
  const unknown = await client.rpc(3, 'account/logout');
  assert.match(unknown.error.message, /尚未接入/);
  assert.equal(h.fake.calls('account/logout').length, 0);
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
  client.send({ type: 'thread-prewarm-start', hostId: 'local', request: { id: 'prewarm-omitted', method: 'thread/start' } });
  const parameterless = (await client.until(message => message.type === 'mcp-response' && message.message.id === 'prewarm-omitted')).message;
  assert.ok(parameterless.result.thread.id);
  assert.ok(record(record(record(h.fake.calls('thread/start')[1]!.params.config)['mcp_servers.codex_app']).env).CODEX_APP_TOOLS_PIPE_PATH);
  h.fake.send({ method: 'item/agentMessage/delta', params: { threadId: started.result.thread.id, delta: 'streamed' } });
  assert.equal((await client.until(message => message.method === 'item/agentMessage/delta')).params.delta, 'streamed');
  h.fake.send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: started.result.thread.id } });
  await client.until(message => message.type === 'mcp-request' && message.request.id === 'approval');
  client.send({ type: 'mcp-response', hostId: 'local', response: { id: 'approval', result: { decision: 'decline' } } });
  assert.deepEqual((await h.fake.waitFor((message: Record<string, unknown>) => message.id === 'approval' && message.result)).result, { decision: 'decline' });
});

for (const replyFirst of [true, false]) test(`prewarms stay private across pages with ${replyFirst ? 'reply' : 'notification'} first, then publish the same ID once`, async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  await b.rpc(1, 'config/read');
  h.fake.handlers.set('thread/start', (params, { message, send }) => {
    const result = record(h.fake.defaultResult('thread/start', params));
    // CLI can announce the ID before replying, even on another connection.
    if (!replyFirst) h.fake.broadcast({ method: 'thread/started', params: { thread: result.thread } });
    send({ id: message.id, result });
    if (replyFirst) send({ method: 'thread/started', params: { thread: result.thread } });
    return NO_REPLY;
  });
  a.send({ type: 'thread-prewarm-start', request: { id: 'private', method: 'thread/start', params: { cwd: h.root } } });
  const { thread } = (await a.until(value => value.message?.id === 'private')).message.result;
  h.fake.broadcast({ method: 'thread/started', params: { thread } });
  for (const client of [a, b]) {
    assert.equal((await client.rpc(2, 'thread/list')).result.data.length, 0);
    assert.equal(client.messages.filter(value => value.method === 'thread/started').length, 0);
  }
  a.send({ type: 'fetch', requestId: 'private-startup', url: 'vscode://codex/startup-sidebar', body: '{}' });
  const startup = await a.until(value => value.requestId === 'private-startup');
  assert.deepEqual(startup.body.threads, []);
  const { result: { turn } } = await b.rpc(3, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'First' }] });
  h.fake.broadcast({ method: 'turn/started', params: { threadId: thread.id, turn } });
  h.fake.broadcast({ method: 'thread/started', params: { thread } });
  for (const client of [a, b]) {
    assert.equal((await client.rpc(4, 'thread/list')).result.data[0].id, thread.id);
    const starts = client.messages.filter(value => value.method === 'thread/started');
    assert.equal(starts.length, 1); assert.equal(starts[0]!.params.thread.id, thread.id);
  }
  assert.match((await a.rpc(5, 'thread/delete', { threadId: thread.id })).error.message, /未使用/);
  // A normal empty thread and an intentional name must not inherit prewarm policy.
  const ordinary = fixtureThread('ordinary-empty', h.root), named = fixtureThread('named', h.root, { name: 'New chat' });
  for (const value of [ordinary, named]) { h.fake.threads.set(value.id, value); h.fake.broadcast({ method: 'thread/started', params: { thread: value } }); }
  const listed = (await a.rpc(6, 'thread/list')).result.data;
  assert.ok(listed.some((value: { id: string }) => value.id === ordinary.id));
  assert.ok(listed.some((value: { name: string }) => value.name === 'New chat'));
  a.send({ type: 'thread-prewarm-start', request: { id: 'invalid-prewarm', method: 'turn/start', params: {} } });
  assert.match((await a.until(value => value.message?.id === 'invalid-prewarm')).message.error.message, /只接受 thread\/start/);
});

test('official model config batches preserve profile targets, backend errors and the selected host', async t => {
  const remoteRoot = await mkdtemp('/tmp/aw-model-remote-'), remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:model-fixture';
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Model fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => createConnection(remote.socketPath),
  });
  const client = await h.connect();
  const params = {
    edits: [{ keyPath: 'profiles.work.model', value: 'fixture-model', mergeStrategy: 'upsert' },
      { keyPath: 'profiles.work.model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }],
    filePath: null, expectedVersion: null, reloadUserConfig: true,
  };
  const localResult = { status: 'ok', version: 'local-version', filePath: '/fixture/local/config.toml', overriddenMetadata: null };
  const remoteResult = { status: 'okOverridden', version: 'remote-version', filePath: '/fixture/remote/config.toml',
    overriddenMetadata: { message: 'Managed model override', overridingLayer: { name: { type: 'mdm', domain: 'fixture', key: 'model' }, version: 'managed' } } };
  h.fake.handlers.set('config/batchWrite', received => { assert.deepEqual(received, params); return localResult; });
  remote.handlers.set('config/batchWrite', received => { assert.deepEqual(received, params); return remoteResult; });
  assert.deepEqual((await client.rpc(1, 'config/batchWrite', params, hostId)).result, remoteResult);
  assert.equal(h.fake.calls('config/batchWrite').length, 0);
  assert.deepEqual((await client.rpc(2, 'config/batchWrite', params)).result, localResult);
  assert.equal(remote.calls('config/batchWrite').length, 1);
  remote.handlers.set('config/batchWrite', () => { throw Object.assign(new Error('Fixture version conflict'), { code: -32600, data: { kind: 'versionConflict' } }); });
  const rejected = await client.rpc(3, 'config/batchWrite', { ...params, expectedVersion: 'stale' }, hostId);
  assert.equal(rejected.error.code, -32600);
  assert.equal(rejected.error.message, 'Fixture version conflict');
  assert.deepEqual(rejected.error.data, { kind: 'versionConflict' });
  assert.equal(h.fake.calls('config/batchWrite').length, 1);
});

test('manual compaction preserves the selected host, progress events and backend errors', async t => {
  const remoteRoot = await mkdtemp('/tmp/aw-compact-remote-'), remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:compact-fixture';
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Compact fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => createConnection(remote.socketPath),
  });
  const client = await h.connect(), params = { threadId: 'same-thread-id' };
  let sendRemoteProgress: ((value: unknown) => void) | undefined;
  for (const backend of [h.fake, remote]) backend.handlers.set('thread/compact/start', (received, context) => {
    if (backend === remote) sendRemoteProgress = context.send;
    assert.deepEqual(received, params); return {};
  });
  assert.deepEqual((await client.rpc(1, 'thread/compact/start', params, hostId)).result, {});
  assert.equal(remote.calls('thread/compact/start').length, 1);
  assert.equal(h.fake.calls('thread/compact/start').length, 0);
  const progress = { ...params, turnId: 'compact-turn', item: { type: 'contextCompaction', id: 'compact-item' } };
  for (const method of ['item/started', 'item/completed']) {
    sendRemoteProgress!({ method, params: progress });
    const event = await client.until(message => message.type === 'mcp-notification' && message.method === method);
    assert.equal(event.hostId, hostId);
    assert.deepEqual(event.params, progress);
  }
  assert.deepEqual((await client.rpc(2, 'thread/compact/start', params)).result, {});
  assert.equal(h.fake.calls('thread/compact/start').length, 1);
  assert.equal(remote.calls('thread/compact/start').length, 1);
  remote.handlers.set('thread/compact/start', () => {
    throw Object.assign(new Error('Fixture compaction rejected'), { code: -32600, data: { kind: 'threadBusy' } });
  });
  const rejected = await client.rpc(3, 'thread/compact/start', params, hostId);
  assert.deepEqual(rejected.error, { code: -32600, message: 'Fixture compaction rejected', data: { kind: 'threadBusy' } });
  assert.equal(h.fake.calls('thread/compact/start').length, 1);
});

test('search, account and app reads preserve native cursors, match locations and host selection', async t => {
  const remoteRoot = await mkdtemp('/tmp/aw-search-remote-'), remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:search-fixture';
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Search fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => createConnection(remote.socketPath),
  });
  const client = await h.connect();
  const scenarios = [
    ['thread/search', { searchTerm: '中文', cursor: 'page-2', archived: true, limit: 5 }, { data: [{ thread: { id: 'remote-match' } }], nextCursor: 'page-3' }],
    ['thread/searchOccurrences', { threadId: 'same-id', searchTerm: '中文', limit: 5 }, { data: [{ itemId: 'remote-item', start: 4, end: 6 }], nextCursor: 'next-match' }],
    ['thread/timeline/list', { threadId: 'same-id', cursor: 'older', limit: 10 }, { data: [{ type: 'contextCompaction', id: 'remote-compaction' }], nextCursor: null }],
    ['account/rateLimits/read', {}, { rateLimits: { primary: { usedPercent: 42 } }, rateLimitsByLimitId: {} }],
    ['app/read', { appIds: ['fixture-app'], includeTools: true }, { apps: [{ id: 'fixture-app', tools: [{ name: 'fixture-tool' }] }] }],
    ['app/installed', { forceRefresh: true }, { apps: [{ id: 'fixture-app', callable: true }] }],
    ['fuzzyFileSearch', { query: '中文', roots: ['/remote/workspace'], cancellationToken: 'fixture' }, { files: [{ path: '/remote/workspace/中文.ts' }] }],
  ] as const;
  let id = 0;
  for (const [method, params, result] of scenarios) {
    remote.handlers.set(method, received => { assert.deepEqual(received, params); return result; });
    assert.deepEqual((await client.rpc(++id, method, params, hostId)).result, result);
    assert.equal(remote.calls(method).length, 1);
    assert.equal(h.fake.calls(method).length, 0);
  }
});

test('file search sessions forward native query updates and completion notifications', async t => {
  const h = await fixture(t), client = await h.connect(), sessionId = 'search-session';
  for (const [id, method, params] of [
    [1, 'fuzzyFileSearch/sessionStart', { sessionId, roots: [h.root] }],
    [2, 'fuzzyFileSearch/sessionUpdate', { sessionId, query: '中文' }],
    [3, 'fuzzyFileSearch/sessionStop', { sessionId }],
  ] as const) {
    h.fake.handlers.set(method, received => { assert.deepEqual(received, params); return {}; });
    assert.deepEqual((await client.rpc(id, method, params)).result, {});
    assert.equal(h.fake.calls(method).length, 1);
    if (id !== 2) continue;
    for (const event of [
      { method: 'fuzzyFileSearch/sessionUpdated', params: { sessionId, query: '中文', files: [{ path: h.root + '/中文.ts' }] } },
      { method: 'fuzzyFileSearch/sessionCompleted', params: { sessionId } },
    ]) {
      h.fake.send(event);
      const notification = await client.until(message => message.type === 'mcp-notification' && message.method === event.method);
      assert.equal(notification.hostId, 'local');
      assert.deepEqual(notification.params, event.params);
    }
  }
});

test('session and settings controls retain native payloads, null params, host isolation and errors', async t => {
  const remoteRoot = await mkdtemp('/tmp/aw-settings-remote-'), remote = await createFakeCodex(remoteRoot);
  t.after(async () => { await remote.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  const hostId = 'remote-ssh-discovered:settings-fixture';
  const h = await fixture(t, undefined, undefined, {
    hostCatalog: { hosts: [{ hostId, displayName: 'Settings fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => createConnection(remote.socketPath),
  });
  const reloadMessages: Record<string, unknown>[] = [];
  remote.handlers.set('initialize', (params, { socket }) => {
    socket.on('message', bytes => {
      const message = record(JSON.parse(String(bytes)));
      if (message.method === 'config/mcpServer/reload') reloadMessages.push(message);
    });
    return remote.defaultResult('initialize', params);
  });
  const client = await h.connect();
  const scenarios = [
    ['config/value/write', { keyPath: 'mcp_servers.fixture.enabled', value: false, mergeStrategy: 'upsert', expectedVersion: 'fixture-version', filePath: '/remote/config.toml' }],
    ['config/mcpServer/reload', null],
    ['skills/config/write', { path: '/remote/skills/fixture/SKILL.md', enabled: false }],
    ['thread/backgroundTerminals/clean', { threadId: 'same-id' }],
    ['thread/memoryMode/set', { threadId: 'same-id', mode: 'disabled' }],
    ['thread/metadata/update', { threadId: 'same-id', gitInfo: { branch: 'fixture' } }],
    ['turn/settings/update', { threadId: 'same-id', turnId: 'same-turn', approvalsReviewer: 'user' }],
  ] as const;
  let id = 0;
  for (const [method, params] of scenarios) {
    remote.handlers.set(method, received => {
      if (params !== null) assert.deepEqual(received, params);
      return { native: method };
    });
    assert.deepEqual((await client.rpc(++id, method, params, hostId)).result, { native: method });
    assert.equal(remote.calls(method).length, 1);
    assert.equal(h.fake.calls(method).length, 0);
  }
  assert.equal(reloadMessages[0]?.params, null);
  // JSON omits undefined params, as the pinned renderer does for this method.
  remote.handlers.set('config/mcpServer/reload', () => ({}));
  client.send({ type: 'mcp-request', hostId, request: { id: 'reload-omitted', method: 'config/mcpServer/reload' } });
  assert.deepEqual((await client.until(message => message.type === 'mcp-response' && message.message.id === 'reload-omitted')).message.result, {});
  assert.equal(Object.hasOwn(reloadMessages[1]!, 'params'), false);
  remote.handlers.set('config/value/write', () => {
    throw Object.assign(new Error('Fixture version conflict'), { code: -32600, data: { kind: 'versionConflict' } });
  });
  assert.deepEqual((await client.rpc(++id, 'config/value/write', scenarios[0][1], hostId)).error,
    { code: -32600, message: 'Fixture version conflict', data: { kind: 'versionConflict' } });
  assert.equal(h.fake.calls('config/value/write').length, 0);
});

test('lost session and settings write replies report uncertainty without replaying', async t => {
  for (const [method, params] of [
    ['turn/start', { threadId: 'test', input: [] }],
    ['config/batchWrite', { edits: [{ keyPath: 'model', value: 'fixture-model', mergeStrategy: 'upsert' }], filePath: null, expectedVersion: null, reloadUserConfig: true }],
    ['thread/compact/start', { threadId: 'test' }],
    ['config/value/write', { keyPath: 'mcp_servers.fixture.enabled', value: false, mergeStrategy: 'upsert' }],
    ['config/mcpServer/reload', null],
    ['skills/config/write', { path: '/fixture/SKILL.md', enabled: false }],
    ['thread/backgroundTerminals/clean', { threadId: 'test' }],
    ['thread/memoryMode/set', { threadId: 'test', mode: 'disabled' }],
    ['thread/metadata/update', { threadId: 'test', gitInfo: { branch: 'fixture' } }],
    ['turn/settings/update', { threadId: 'test', turnId: 'turn', approvalsReviewer: 'user' }],
    ['fuzzyFileSearch/sessionStart', { sessionId: 'search', roots: ['/fixture'] }],
    ['fuzzyFileSearch/sessionUpdate', { sessionId: 'search', query: 'test' }],
    ['fuzzyFileSearch/sessionStop', { sessionId: 'search' }],
  ] as const) await t.test(method, async t => {
    const h = await fixture(t), client = await h.connect();
    h.fake.handlers.set(method, (_params, { socket }) => { socket.terminate(); });
    const reply = await client.rpc(1, method, params);
    assert.equal(reply.error.data.uncertain, true);
    assert.equal(h.fake.calls(method).length, 1);
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
  const prewarm = async (id: string) => {
    client.send({ type: 'thread-prewarm-start', request: { id, method: 'thread/start', params: { cwd: h.root } } });
    return (await client.until(value => value.message?.id === id)).message.result.thread;
  };
  const thread = await prewarm('populated');
  const stored = h.fake.threads.get(thread.id)!;
  stored.turns.push({ id: 'populated', items: [], status: 'completed' });
  assert.match((await client.rpc(3, 'thread/delete', { threadId: thread.id })).error.message, /已有内容/);
  const running = await prewarm('running');
  h.fake.threads.get(running.id)!.status = { type: 'active' };
  assert.match((await client.rpc(4, 'thread/delete', { threadId: running.id })).error.message, /保留当前数据/);
  assert.equal(h.fake.calls('thread/delete').length, 0);
  for (const historyMode of ['paginated', 'legacy']) {
    const unused = await prewarm(historyMode);
    h.fake.threads.get(unused.id)!.historyMode = historyMode;
    assert.deepEqual((await client.rpc(5, 'thread/delete', { threadId: unused.id })).result, {});
  }
  assert.equal(h.fake.calls('thread/delete').length, 2);
  assert.ok(h.fake.threads.has('existing'));
  assert.ok(h.fake.threads.has(thread.id)); assert.ok(h.fake.threads.has(running.id));
});

test('prewarm cleanup accepts the exact unmaterialized-history response and preserves other failures', async t => {
  const h = await fixture(t), client = await h.connect();
  h.fake.handlers.set('thread/delete', params => { h.fake.threads.delete(String(params.threadId)); return {}; });
  for (const failure of ['unmaterialized', 'wrong-thread', 'wrong-code', 'unavailable']) {
    client.send({ type: 'thread-prewarm-start', request: { id: failure, method: 'thread/start', params: { cwd: h.root } } });
    const { thread } = (await client.until(value => value.message?.id === failure)).message.result;
    h.fake.handlers.set('thread/turns/list', (_params, { message, send }) => {
      send({ id: message.id, error: { code: failure === 'wrong-code' ? -32000 : -32600,
        message: failure === 'unavailable' ? 'History temporarily unavailable' :
          `thread ${failure === 'wrong-thread' ? 'another-thread' : thread.id} is not materialized yet; thread/turns/list is unavailable before first user message` } });
      return NO_REPLY;
    });
    const reply = await client.rpc(1, 'thread/delete', { threadId: thread.id });
    if (failure === 'unmaterialized') { assert.deepEqual(reply.result, {}); assert.ok(!h.fake.threads.has(thread.id)); }
    else { assert.ok(reply.error); assert.ok(h.fake.threads.has(thread.id)); }
  }
  assert.equal(h.fake.calls('thread/delete').length, 1);
});

test('a first send while prewarm cleanup reads history prevents deletion', async t => {
  const h = await fixture(t), a = await h.connect(), b = await h.connect();
  await b.rpc(1, 'config/read');
  a.send({ type: 'thread-prewarm-start', request: { id: 'cleanup-race', method: 'thread/start', params: { cwd: h.root } } });
  const { thread } = (await a.until(value => value.message?.id === 'cleanup-race')).message.result;
  let releaseHistory: () => void = () => {};
  const history = new Promise<void>(resolve => { releaseHistory = resolve; });
  h.fake.handlers.set('thread/turns/list', async () => { await history; return { data: [], nextCursor: null }; });
  const deletion = a.rpc(2, 'thread/delete', { threadId: thread.id });
  await h.fake.waitForCall('thread/turns/list');
  await b.rpc(2, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Keep this task' }] });
  releaseHistory();
  assert.match((await deletion).error.message, /未使用/);
  assert.equal(h.fake.calls('thread/delete').length, 0);
  assert.ok(h.fake.threads.has(thread.id));
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

test('new, forked and cold-resumed Yard threads read the target cwd policy; loaded threads keep their kernel', async t => {
  const h = await fixture(t), client = await h.connect();
  const first = join(h.root, 'first'), second = join(h.root, 'second');
  h.fake.handlers.set('config/read', params => ({ config: { features: { plugins: false }, mcp_servers: { node_repl: {
    command: '/App/old-node', url: 'http://obsolete.invalid', enabled: params.cwd !== first, required: true,
    tool_timeout_sec: params.cwd === first ? 80 : 160, tools: { js: { approval_mode: 'prompt' } },
  } } } }));
  const a = await client.rpc(101, 'thread/start', { cwd: first });
  assert.equal(a.error, undefined, JSON.stringify(a.error));
  const policy = record(h.fake.calls('thread/start').at(-1)!.params.config)['mcp_servers.node_repl'] as Record<string, unknown>;
  assert.equal(record(policy.env).CODEX_HOME, join(h.root, 'codex'), 'auxiliary tools share Yard\'s selected backend home');
  assert.equal(policy.enabled, false); assert.equal(policy.required, true); assert.equal(policy.url, undefined);
  assert.equal(policy.tool_timeout_sec, 80); assert.deepEqual(policy.tools, { js: { approval_mode: 'prompt' } });
  await client.rpc(102, 'thread/start', { cwd: second, config: { 'mcp_servers.node_repl.tool_timeout_sec': 240 } });
  const other = record(record(h.fake.calls('thread/start').at(-1)!.params.config)['mcp_servers.node_repl']);
  assert.equal(other.enabled, true); assert.equal(other.tool_timeout_sec, 240);
  await client.rpc(103, 'thread/fork', { threadId: a.result.thread.id });
  assert.equal(h.fake.calls('config/read').at(-1)!.params.cwd, first);
  h.fake.loaded.delete(a.result.thread.id);
  const resumed = await client.rpc(104, 'thread/resume', { threadId: a.result.thread.id });
  assert.equal(resumed.error, undefined, JSON.stringify(resumed.error));
  assert.equal(h.fake.calls('config/read').at(-1)!.params.cwd, first);
  const reads = h.fake.calls('config/read').length;
  await client.rpc(105, 'thread/resume', { threadId: a.result.thread.id });
  assert.equal(h.fake.calls('config/read').length, reads);
  assert.equal(h.fake.calls('thread/resume').at(-1)!.params.config, undefined);
  assert.equal(h.fake.calls('mcpServer/tool/call').length, 0, 'Resuming must not execute a probe that changes kernel authority or bindings');
  assert.equal(h.fake.calls('config/batchWrite').length, 0);
  h.fake.handlers.set('config/read', () => { throw new Error('Policy read failed'); });
  const starts = h.fake.calls('thread/start').length;
  const failed = await client.rpc(106, 'thread/start', { cwd: first });
  assert.match(failed.error.message, /Policy read failed/); assert.equal(h.fake.calls('thread/start').length, starts);
});
