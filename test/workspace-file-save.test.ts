import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createFiles } from '../src/native/files.ts';
import type { FileRequest } from '../src/native/files.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { CodexConnection } from '../lib/codex.ts';
import { createFakeCodex } from './fake-codex.ts';

const run = promisify(execFile);
const blocked = (operationId: string, cwd: string, path: string) => ({ outcome: 'blocked', operationId, query: { cwd, path } });
const statusResult = (outcome: string, targetMatch: 'same' | 'different' | 'unknown' = 'same') => ({ outcome, targetMatch });
async function fixture(t: TestContext, wrap?: (request: FileRequest) => FileRequest) {
  const root = await mkdtemp('/tmp/yard-file-save-'), cwd = join(root, 'workspace'), path = join(cwd, 'file.txt');
  await mkdir(cwd); await writeFile(path, '\ufefffirst\r\nsecond\nthird\rfourth');
  const calls: { hostId: string; method: string; mutating?: boolean }[] = [];
  const daemon = fileDaemonFixture();
  const request: FileRequest = async (hostId, method, params, mutating) => {
    calls.push({ hostId, method, mutating }); return daemon(method, params);
  };
  const files = createFiles({ dataDir: root, workspace: cwd,
    hosts: new Map([['ssh-fixture', { hostId: 'ssh-fixture', displayName: 'Fixture', sshHost: 'fixture', sshAlias: 'fixture', sshPort: null, identity: null }]]),
    request: wrap ? wrap(request) : request,
    remoteCommand: async (_host, command, maxBytes) => (await run('/bin/sh', ['-c', command], { encoding: 'buffer', maxBuffer: maxBytes + 1 })).stdout });
  t.after(async () => { files.close(); await rm(root, { recursive: true, force: true }); });
  const save = (expectedContents: string, contents: string, extra = {}) => files.fetch('workspace-file-save', { hostId: 'local', cwd, path, expectedContents, contents, ...extra });
  return { root, cwd, path, files, calls, save };
}

test('workspace saves compare full original bytes and retain BOM and mixed line endings on each selected host', async t => {
  const h = await fixture(t);
  for (const hostId of ['local', 'ssh-fixture']) {
    const before = await readFile(h.path, 'utf8'), next = before + '\r\n' + hostId;
    assert.deepEqual(await h.save(before, next, { hostId }), { outcome: 'saved' });
    assert.equal(await readFile(h.path, 'utf8'), next);
    assert.deepEqual(await h.save(before, 'stale', { hostId }), { outcome: 'conflict' });
  }
  const writes = h.calls.filter(call => call.method === 'fs/writeFile');
  assert.deepEqual(writes.map(call => [call.hostId, call.mutating]), [['local', true], ['ssh-fixture', true]]);
});

test('a same-file save is blocked while the original write is pending and a stale retry conflicts', async t => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') { entered(); await waiting; }
    return request(...args);
  });
  const before = await readFile(h.path, 'utf8'), first = h.save(before, 'first accepted', { operationId: 'first' });
  await writing;
  const second = h.save(before, 'stale second', { path: join(h.cwd, 'sub', '..', 'file.txt') });
  assert.deepEqual(await second, blocked('first', h.cwd, h.path));
  release();
  assert.deepEqual(await first, { outcome: 'saved' });
  assert.deepEqual(await h.save(before, 'stale retry'), { outcome: 'conflict' });
  assert.equal(await readFile(h.path, 'utf8'), 'first accepted');
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

test('save rejects outside paths, symlinks, new files, binary text, oversized payloads and unknown hosts without writes', async t => {
  const h = await fixture(t), before = await readFile(h.path, 'utf8');
  const outside = join(h.root, 'outside'); await writeFile(outside, 'keep');
  await symlink(outside, join(h.cwd, 'escape'));
  await symlink(h.path, join(h.cwd, 'alias'));
  for (const path of [outside, join(h.cwd, 'escape'), join(h.cwd, 'alias'), join(h.cwd, 'missing')]) {
    await assert.rejects(h.save(before, 'unsafe', { path }));
  }
  await assert.rejects(h.save(before, 'unsafe', { hostId: 'unknown' }), /未登记/);
  await assert.rejects(h.save(before, 'x'.repeat(10 * 1024 * 1024 + 1)), /10 MiB/);
  await assert.rejects(h.save(before, '\0binary'), /UTF-8/);
  await assert.rejects(h.save(before, '\ud800'), /UTF-8/);
  assert.equal(await readFile(h.path, 'utf8'), before);
  assert.equal(await readFile(outside, 'utf8'), 'keep');
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 0);
  await assert.rejects(h.files.rpc('fs/writeFile', { path: h.path, dataBase64: '' }, 'local'), /附件/);
});

test('a lost write receipt preserves its unknown outcome and is never replayed automatically', async t => {
  const h = await fixture(t, request => async (...args) => {
    const result = await request(...args);
    if (args[1] === 'fs/writeFile') throw Object.assign(new Error('synthetic lost receipt'), { uncertain: true });
    return result;
  });
  const before = await readFile(h.path, 'utf8');
  await assert.rejects(h.save(before, 'applied once', { operationId: 'lost' }), error => (error as { uncertain?: boolean }).uncertain === true);
  assert.equal(await readFile(h.path, 'utf8'), 'applied once');
  assert.deepEqual(await h.save(before, 'do not replay'), blocked('lost', h.cwd, h.path));
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { hostId: 'local', cwd: h.cwd, path: h.path, operationId: 'lost' }), statusResult('unknown'));
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

for (const failure of ['timeout', 'unclassified failure'] as const) test(`a daemon write that outlives ${failure} blocks new writes after an old read and service restart`, async t => {
  let release!: () => void, late!: Promise<unknown>;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') {
      late = gate.then(() => request(...args));
      throw failure === 'timeout' ? Object.assign(new Error('synthetic daemon timeout'), { uncertain: true }) : new Error('synthetic unclassified daemon failure');
    }
    return request(...args);
  });
  const before = await readFile(h.path, 'utf8');
  await assert.rejects(h.save(before, 'late original', { operationId: 'original' }), { uncertain: true });
  assert.equal(await readFile(h.path, 'utf8'), before);
  assert.deepEqual(await h.save(before, 'new version', { operationId: 'newer' }), blocked('original', h.cwd, h.path));
  const restarted = createFiles({ dataDir: h.root, workspace: h.cwd, hosts: new Map(), request: async (...args) => fileDaemonFixture()(args[1], args[2]) });
  t.after(() => restarted.close());
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', { hostId: 'local', cwd: h.cwd, path: h.path, operationId: 'original' }), statusResult('unknown'));
  assert.deepEqual(await restarted.fetch('workspace-file-save', { hostId: 'local', cwd: h.cwd, path: h.path,
    operationId: 'after-restart', expectedContents: before, contents: 'newer after restart' }), blocked('original', h.cwd, h.path));
  release(); await late;
  assert.equal(await readFile(h.path, 'utf8'), 'late original');
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', { hostId: 'local', cwd: h.cwd, path: h.path, operationId: 'original' }), statusResult('unknown'));
  assert.deepEqual(await restarted.fetch('workspace-file-save', { hostId: 'local', cwd: h.cwd, path: h.path,
    operationId: 'still-blocked', expectedContents: 'late original', contents: 'do not overwrite' }), blocked('original', h.cwd, h.path));
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

test('a pending write becomes checkable only after its original daemon receipt and readback', async t => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') { entered(); await gate; }
    return request(...args);
  });
  const before = await readFile(h.path, 'utf8');
  const first = h.save(before, 'first version', { operationId: 'pending' });
  await writing;
  const query = { hostId: 'local', cwd: h.cwd, path: h.path, operationId: 'pending' };
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', query), statusResult('pending'));
  assert.equal(await readFile(h.path, 'utf8'), before);
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, hostId: 'ssh-fixture' }), statusResult('missing', 'unknown'));
  const second = h.save('first version', 'second version', { operationId: 'second' });
  assert.deepEqual(await second, blocked('pending', h.cwd, h.path));
  release();
  assert.deepEqual(await first, { outcome: 'saved' });
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', query), statusResult('saved'));
  assert.deepEqual(await h.save('first version', 'duplicate', { operationId: 'pending' }), blocked('pending', h.cwd, h.path));
  assert.deepEqual(await h.save('first version', 'second version', { operationId: 'second' }), { outcome: 'saved' });
  assert.equal(await readFile(h.path, 'utf8'), 'second version');
});

test('a pending save does not block an independent file on the same host', async t => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile' && String(args[2].path).endsWith('/file.txt')) { entered(); await gate; }
    return request(...args);
  });
  const secondPath = join(h.cwd, 'other.txt'); await writeFile(secondPath, 'other');
  const before = await readFile(h.path, 'utf8'), first = h.save(before, 'pending', { operationId: 'first' });
  await writing;
  assert.deepEqual(await h.save('other', 'independent', { path: secondPath, operationId: 'other' }), { outcome: 'saved' });
  assert.equal(await readFile(secondPath, 'utf8'), 'independent');
  release();
  assert.deepEqual(await first, { outcome: 'saved' });
});

test('blocked aliases retain the original query and a confirmed target guard rejects a later link change', async t => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') { entered(); await gate; }
    return request(...args);
  });
  t.after(() => release());
  const a = join(h.cwd, 'a'), b = join(h.cwd, 'b'), link = join(h.cwd, 'link');
  await mkdir(a); await mkdir(b);
  await writeFile(join(a, 'file.txt'), 'same'); await writeFile(join(b, 'file.txt'), 'same');
  await symlink(a, link);
  const originalPath = join(link, 'file.txt'), aliasPath = join(a, 'file.txt');
  const original = h.files.fetch('workspace-file-save', { hostId: 'local', cwd: h.cwd, path: originalPath,
    operationId: 'alias-original', expectedContents: 'same', contents: 'same' });
  await writing;
  assert.deepEqual(await h.files.fetch('workspace-file-save', { hostId: 'local', cwd: a, path: aliasPath,
    operationId: 'alias-blocked', expectedContents: 'same', contents: 'newer' }), blocked('alias-original', h.cwd, originalPath));
  const query = { hostId: 'local', cwd: a, path: aliasPath, operationId: 'alias-original', queryCwd: h.cwd, queryPath: originalPath };
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', query), statusResult('pending'));
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, hostId: 'ssh-fixture' }), statusResult('missing', 'unknown'));
  await assert.rejects(h.files.fetch('workspace-file-save-status', { ...query, queryPath: undefined }));
  release();
  assert.deepEqual(await original, { outcome: 'saved' });
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', query), statusResult('saved'));
  await unlink(link); await symlink(b, link);
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, cwd: h.cwd, path: originalPath }), statusResult('saved', 'different'));
  assert.deepEqual(await h.files.fetch('workspace-file-save', { hostId: 'local', cwd: h.cwd, path: originalPath,
    operationId: 'changed-target', guardOperationId: 'alias-original', expectedContents: 'same', contents: 'must not write' }), { outcome: 'conflict' });
  assert.equal(await readFile(join(b, 'file.txt'), 'utf8'), 'same');
  await unlink(link);
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, cwd: h.cwd, path: originalPath }), statusResult('saved', 'unknown'));
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

test('legacy receipts can only be recovered on the same host and canonical target', async t => {
  const h = await fixture(t);
  await writeFile(join(h.root, 'workspace-file-saves.json'), JSON.stringify([{ id: 'legacy', hostId: 'local', target: h.path, state: 'unknown' }]));
  assert.deepEqual(await h.save(await readFile(h.path, 'utf8'), 'not written'), blocked('legacy', h.cwd, h.path));
  const query = { cwd: h.cwd, path: h.path, operationId: 'legacy', queryCwd: h.cwd, queryPath: h.path };
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, hostId: 'local' }), statusResult('unknown'));
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, hostId: 'ssh-fixture' }), statusResult('missing', 'unknown'));
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 0);
});

test('an unreadable save journal fails closed before issuing a daemon write', async t => {
  const h = await fixture(t), before = await readFile(h.path, 'utf8');
  await writeFile(join(h.root, 'workspace-file-saves.json'), '{invalid');
  await assert.rejects(h.save(before, 'must not write', { operationId: 'corrupt' }));
  assert.equal(await readFile(h.path, 'utf8'), before);
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 0);
});

test('readback disagreement reports an unknown save and preserves the actual current file', async t => {
  const h = await fixture(t, request => async (...args) => {
    const result = await request(...args);
    if (args[1] === 'fs/writeFile') await writeFile(String(args[2].path), 'changed externally');
    return result;
  });
  const before = await readFile(h.path, 'utf8');
  await assert.rejects(h.save(before, 'attempt', { operationId: 'readback' }), error => (error as { uncertain?: boolean }).uncertain === true);
  assert.equal(await readFile(h.path, 'utf8'), 'changed externally');
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { hostId: 'local', cwd: h.cwd, path: h.path, operationId: 'readback' }), statusResult('conflict'));
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

for (const { lateError, switchLink } of [
  { lateError: false, switchLink: true }, { lateError: true, switchLink: true }, { lateError: false, switchLink: false },
]) test(`the original RPC ${lateError ? 'error' : 'success'} settles its own timed-out write ${switchLink ? 'after a directory link changes' : 'before a later save'}`, async t => {
  const root = await mkdtemp('/tmp/yard-file-late-rpc-'), cwd = join(root, 'workspace');
  const a = join(cwd, 'a'), b = join(cwd, 'b'), link = join(cwd, 'link');
  await mkdir(a, { recursive: true }); await mkdir(b);
  await writeFile(join(a, 'file.txt'), 'old a'); await writeFile(join(b, 'file.txt'), 'old b');
  await symlink(a, link);
  const peer = await createFakeCodex(root), connection = new CodexConnection(peer.socketPath);
  const daemon = fileDaemonFixture();
  peer.handlers.set('fs/getMetadata', params => daemon('fs/getMetadata', params));
  let release!: () => void, entered!: () => void, settled!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const late = new Promise<void>(resolve => { settled = resolve; });
  peer.handlers.set('fs/writeFile', async params => {
    if (params.path === join(a, 'file.txt')) {
      entered(); await gate;
      if (lateError) throw Object.assign(new Error('write rejected'), { code: -32001 });
    }
    return daemon('fs/writeFile', params);
  });
  await connection.connect();
  const files = createFiles({ dataDir: root, workspace: cwd, hosts: new Map(),
    request: async (_host, method, params, mutating, onLateTerminal) => connection.request(method, params, {
      mutating, timeoutMs: method === 'fs/writeFile' ? 70 : 5000,
      ...(onLateTerminal ? { onLateTerminal: async value => { try { await onLateTerminal(value); } finally { settled(); } } } : {}),
    }),
  });
  t.after(async () => { release(); files.close(); connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  const path = join(link, 'file.txt');
  const first = files.fetch('workspace-file-save', { hostId: 'local', cwd, path, operationId: 'original', expectedContents: 'old a', contents: 'new a' });
  const rejected = assert.rejects(first, { uncertain: true });
  await writing; await rejected;
  assert.equal(await readFile(join(a, 'file.txt'), 'utf8'), 'old a');
  assert.deepEqual(await files.fetch('workspace-file-save', { hostId: 'local', cwd, path, operationId: 'blocked', expectedContents: 'old a', contents: 'must wait' }),
    blocked('original', cwd, path));
  const status = { hostId: 'local', cwd, path, operationId: 'original' };
  if (switchLink) {
    await unlink(link); await symlink(b, link);
    assert.deepEqual(await files.fetch('workspace-file-save-status', status), statusResult('unknown', 'different'));
    assert.deepEqual(await files.fetch('workspace-file-save', { hostId: 'local', cwd, path, operationId: 'other', expectedContents: 'old b', contents: 'new b' }), { outcome: 'saved' });
  }
  release(); await late;
  assert.equal(await readFile(join(a, 'file.txt'), 'utf8'), lateError ? 'old a' : 'new a');
  assert.equal(await readFile(join(b, 'file.txt'), 'utf8'), switchLink ? 'new b' : 'old b');
  assert.deepEqual(await files.fetch('workspace-file-save-status', status), statusResult(lateError ? 'failed' : switchLink ? 'conflict' : 'saved', switchLink ? 'different' : 'same'));
  if (!switchLink) {
    assert.deepEqual(await files.fetch('workspace-file-save', { hostId: 'local', cwd, path, operationId: 'after-terminal', expectedContents: 'new a', contents: 'newer a' }), { outcome: 'saved' });
    assert.equal(await readFile(join(a, 'file.txt'), 'utf8'), 'newer a');
  }
  assert.deepEqual(peer.calls('fs/writeFile').map(call => call.params.path), [join(a, 'file.txt'), join(switchLink ? b : a, 'file.txt')]);
});
