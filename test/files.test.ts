import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, truncate } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { test } from 'node:test';
import { contentKind, createFiles } from '../src/native/files.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { BrowserFiles } from '../src/native/browser-files.ts';
import type { HostMessage } from '../src/native/protocol.ts';

test('visualizations read bounded UTF-8 HTML from the specified local or SSH host', async t => {
  const root = await mkdtemp('/tmp/aw-viz-read-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const hostId = 'remote-ssh-test', calls: string[] = [], run = promisify(execFile);
  const files = createFiles({ dataDir: root, workspace: root,
    hosts: new Map([[hostId, { hostId, displayName: 'test', sshAlias: 'test', sshHost: 'test', sshPort: null, identity: null }]]),
    request: async (id, method, params) => { calls.push(id); return fileDaemonFixture()(method, params); },
    remoteCommand: async (_host, command, maxBytes) => (await run('/bin/sh', ['-c', command], { encoding: 'buffer', maxBuffer: maxBytes + 1 })).stdout });
  t.after(() => files.close());
  const path = join(root, '交互.html'), contents = '<button>增加</button><script>window.count=1</script>';
  await writeFile(path, contents);
  for (const id of ['local', hostId]) {
    assert.deepEqual(await files.fetch('visualization-read', { hostId: id, path, threadId: 'test' }), { path, contents });
    assert.equal(calls.at(-1), id);
  }
  await assert.rejects(files.fetch('visualization-read', { path, threadId: 'test', hostId: 'unknown' }), /未登记/);
  await assert.rejects(files.fetch('visualization-read', { path: join(root, 'missing.html'), threadId: 'test' }), /ENOENT/);
  await writeFile(path, Buffer.from([0xff]));
  await assert.rejects(files.fetch('visualization-read', { path, threadId: 'test' }), /encoded data/);
  await truncate(path, 5_000_001);
  await assert.rejects(files.fetch('visualization-read', { path, threadId: 'test' }), /大小限制/);
});

test('text classification accepts Chinese samples split at a UTF-8 boundary but rejects invalid complete bytes', () => {
  const text = Buffer.from('中文\n');
  assert.equal(contentKind(text), 'text');
  assert.equal(contentKind(text.subarray(0, 2), true), 'text');
  assert.equal(contentKind(text.subarray(0, 2)), 'binary');
  assert.equal(contentKind(Buffer.from([0, 1, 255])), 'binary');
  assert.equal(contentKind(Buffer.alloc(0)), 'text');
});

test('file metadata identifies image and PDF previews from bytes, including an SVG without an extension', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=', 'base64');
  assert.equal(contentKind(png), 'image');
  assert.equal(contentKind(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image');
  assert.equal(contentKind(Buffer.from('%PDF-1.7\n')), 'pdf');
});

test('SSH attachment transfer only creates fresh directories and writes each new attachment once', async t => {
  const root = await mkdtemp('/tmp/aw-files-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const hostId = 'remote-ssh-discovered:test', codexHome = join(root, 'codex');
  const run = promisify(execFile);
  const files = createFiles({ dataDir: root, workspace: root, hosts: new Map([[hostId, { hostId, displayName: 'test', sshAlias: 'test', sshHost: 'test', sshPort: null, identity: null }]]),
    request: async (_host, method, params) => fileDaemonFixture()(method, params),
    remoteCommand: async (_host, command, maxBytes) => (await run('/bin/sh', ['-c', command], { encoding: 'buffer', maxBuffer: maxBytes + 1 })).stdout });
  t.after(() => files.close());
  const request = async (method: string, params: Record<string, unknown>) => {
    assert.ok(['fs/createDirectory', 'fs/writeFile'].includes(method));
    return fileDaemonFixture()(method, params);
  };
  const directory = join(codexHome, 'attachments', '12345678-1234-4234-8234-123456789abc');
  const call = (method: string, params: Record<string, unknown>, id = hostId) => files.attachmentRequest(method, params, id, codexHome, request);
  await assert.rejects(call('fs/createDirectory', { path: join(root, 'project') }));
  await assert.rejects(call('fs/createDirectory', { path: directory }, 'local'));
  await call('fs/createDirectory', { path: directory });
  await assert.rejects(call('fs/createDirectory', { path: directory }));
  const target = join(directory, '中文.bin'), dataBase64 = Buffer.from([0, 255, 123]).toString('base64');
  await call('fs/writeFile', { path: target, dataBase64 });
  await assert.rejects(call('fs/writeFile', { path: target, dataBase64: '' }));
  await assert.rejects(call('fs/writeFile', { path: join(root, 'project'), dataBase64 }));
  await assert.rejects(call('fs/remove', { path: target }));
  assert.deepEqual(await readFile(target), Buffer.from([0, 255, 123]));
  const existing = join(codexHome, 'attachments', '12345678-1234-4234-8234-123456789abd');
  await mkdir(existing); await writeFile(join(existing, 'keep'), 'existing');
  await assert.rejects(call('fs/createDirectory', { path: existing }));
  assert.equal(await readFile(join(existing, 'keep'), 'utf8'), 'existing');
});

test('bounded reads reject oversized and growing files without invoking unbounded fs/readFile', async t => {
  const root = await mkdtemp('/tmp/aw-files-limits-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'large'); await writeFile(target, ''); await truncate(target, 64 * 1024 * 1024 + 1);
  const methods: string[] = [];
  const files = createFiles({ dataDir: root, workspace: root, hosts: new Map(), request: async (_host, method, params) => {
    methods.push(method); return fileDaemonFixture()(method, params);
  } });
  t.after(() => files.close());
  for (const call of [() => files.rpc('fs/readFile', { path: target }, 'local'),
    () => files.fetch('read-file', { path: target }), () => files.fetch('workspace-files', { path: target, operation: 'read' })]) {
    await assert.rejects(call, /大小限制/);
  }
  assert.deepEqual(await files.fetch('read-file-binary', { path: target }), { contentsBase64: null });
  assert.ok(!methods.includes('fs/readFile'));
  const hostId = 'remote-ssh-test', commands: string[] = [];
  const growing = createFiles({ dataDir: root, workspace: root,
    hosts: new Map([[hostId, { hostId, displayName: 'test', sshAlias: 'test', sshHost: 'test', sshPort: null, identity: null }]]),
    request: async (_host, method) => { assert.equal(method, 'fs/getMetadata'); return { isFile: true, isDirectory: false, isSymlink: false, createdAtMs: 0, modifiedAtMs: 1 }; },
    remoteCommand: async (_host, command, maxBytes) => {
      commands.push(command);
      if (command.startsWith('stat ')) return Buffer.from('2');
      assert.ok(command.includes('head -c 3 ')); assert.equal(maxBytes, 3); return Buffer.from('abc');
    },
  });
  t.after(() => growing.close());
  await assert.rejects(growing.rpc('fs/readFile', { path: '/growing' }, hostId), /读取期间变大/);
  assert.equal(commands.length, 2);
});

test('daemon, permission and timeout errors never fall through to SSH or become absent paths', async t => {
  const hostId = 'remote-ssh-test';
  let error: Error = new Error('proxy unavailable');
  let fallback = 0;
  const files = createFiles({ dataDir: '/unused', workspace: '/unused',
    hosts: new Map([[hostId, { hostId, displayName: 'test', sshAlias: 'test', sshHost: 'test', sshPort: null, identity: null }]]),
    request: async () => { throw error; },
    remoteCommand: async () => { fallback++; throw new Error('Unexpected SSH fallback'); },
  });
  t.after(() => files.close());
  await assert.rejects(files.rpc('fs/getMetadata', { path: '/remote' }, hostId), /proxy unavailable/);
  for (const code of [-32603, 'TIMEOUT']) {
    error = Object.assign(new Error('Permission denied (os error 13)'), { code });
    await assert.rejects(files.rpc('fs/getMetadata', { path: '/remote' }, hostId), /Permission denied/);
    await assert.rejects(files.fetch('paths-exist', { paths: ['/remote'], hostId }), /Permission denied/);
  }
  assert.equal(fallback, 0);
  await assert.rejects(files.rpc('fs/getMetadata', { path: '/remote' }, 'remote-unknown'), /未登记/);
  await assert.rejects(files.rpc('fs/getMetadata', { path: 'relative' }, hostId), /绝对路径/);
});

test('browser downloads and save-file report server failures without claiming success', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '文件超出大小限制' }, { status: 400 }));
  const files = new BrowserFiles(async () => ({ kind: 'file' }));
  const path = { hostId: 'remote-test', path: '/test' };
  await assert.rejects(files.downloadCopy(path), /文件超出大小限制/);
  await assert.rejects(files.saveCopy(path), /文件超出大小限制/);
  assert.deepEqual(await files.open(path), { success: false });
  const response = await new Promise<HostMessage>(resolve => {
    assert.equal(files.intercept({ type: 'fetch', requestId: 'save', url: 'vscode://codex/save-file',
      body: JSON.stringify({ sourcePath: path.path, hostId: path.hostId }) }, resolve), true);
  });
  assert.equal(response.responseType, 'error');
  assert.match(String(response.error), /文件超出大小限制/);
});

test('browser binary previews distinguish size limits from filesystem errors', async t => {
  const files = new BrowserFiles(async () => { throw new Error('Binary data must use HTTP'); });
  let status = 413;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Permission denied' }, { status }));
  const intercept = () => new Promise<HostMessage>(publish => {
    assert.equal(files.intercept({ type: 'fetch', requestId: 'binary', url: 'vscode://codex/read-file-binary',
      body: JSON.stringify({ hostId: 'remote-test', path: '/test.docx', maxBytes: 40 * 1024 * 1024 }) }, publish), true);
  });
  const limited = await intercept();
  assert.equal(limited.responseType, 'success');
  assert.deepEqual(limited.body, { contentsBase64: null });
  status = 400;
  const denied = await intercept();
  assert.equal(denied.responseType, 'error');
  assert.match(String(denied.error), /Permission denied/);
});

test('browser file staging preserves equal filenames, exact bytes and empty files without reuploading staged objects', async t => {
  const files = new BrowserFiles(async () => { throw new Error('Staging uses HTTP'); });
  const written = new Map<string, Buffer>();
  let roots = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://fixture');
    if (url.pathname === '/api/files/uploads') return Response.json({ uploadId: String(++roots) });
    const fsPath = '/uploads/' + url.searchParams.get('uploadId') + '/' + url.searchParams.get('name');
    written.set(fsPath, Buffer.from(await (init?.body as File).arrayBuffer()));
    return Response.json({ fsPath });
  });
  const selected = [new File([new Uint8Array([0, 255, 17])], '同名.bin'), new File(['中文'], '同名.bin'), new File([], '空文件.txt')];
  assert.ok(selected.every(file => files.getPathForFile(file) === null));
  await files.stageFiles(selected);
  assert.equal(new Set(selected.map(file => files.getPathForFile(file))).size, 3);
  for (const file of selected) assert.deepEqual(written.get(files.getPathForFile(file)!), Buffer.from(await file.arrayBuffer()));
  await files.stageFiles(selected);
  assert.equal(roots, 3);
  assert.equal(files.getPathForFile(new File(['different'], '同名.bin')), null);
});

test('failed browser staging leaves no usable path and allows retry', async t => {
  const files = new BrowserFiles(async () => ({})), file = new File(['retry'], 'retry.txt');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Upload unavailable' }, { status: 503 }));
  await assert.rejects(files.stageFiles([file]), /Upload unavailable/);
  assert.equal(files.getPathForFile(file), null);
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => String(input).endsWith('/uploads')
    ? Response.json({ uploadId: 'retry' }) : Response.json({ fsPath: '/uploads/retry/retry.txt' }));
  await files.stageFiles([file]);
  assert.equal(files.getPathForFile(file), '/uploads/retry/retry.txt');
});
