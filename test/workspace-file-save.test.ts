import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
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
  for (const path of [outside, join(h.cwd, 'escape'), join(h.cwd, 'missing')]) {
    await assert.rejects(h.save(before, 'unsafe', { path }));
  }
  assert.match((await h.save(before, 'unsafe', { path: join(h.cwd, 'alias') }) as { error: string }).error, /符号链接/);
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
  assert.deepEqual(await h.save('first version', 'second version', { operationId: 'second' }), blocked('pending', h.cwd, h.path));
  assert.deepEqual(await h.save('first version', 'second version', { operationId: 'second-explicit' }), { outcome: 'saved' });
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

test('a durable failed write guards a later save against an alias changing to identical contents', async t => {
  let writes = 0;
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') { writes++; throw Object.assign(new Error('fixture write denied'), { uncertain: false }); }
    return request(...args);
  });
  const a = join(h.cwd, 'failed-a'), b = join(h.cwd, 'failed-b'), link = join(h.cwd, 'failed-link');
  await mkdir(a); await mkdir(b);
  await writeFile(join(a, 'file.txt'), 'same'); await writeFile(join(b, 'file.txt'), 'same'); await symlink(a, link);
  const target = join(link, 'file.txt');
  const params = { hostId: 'local', cwd: h.cwd, path: target, expectedContents: 'same', contents: 'new text' };
  assert.deepEqual(await h.files.fetch('workspace-file-save', { ...params, operationId: 'failed-write' }),
    { outcome: 'failed', operationId: 'failed-write', error: 'fixture write denied' });
  await assert.rejects(h.files.fetch('workspace-file-save', { ...params, operationId: 'failed-write', hostId: 'ssh-fixture' }), /标识已用于其他文件/);
  assert.deepEqual(await h.files.fetch('workspace-file-save', { ...params, operationId: 'failed-write' }),
    { outcome: 'failed', operationId: 'failed-write', error: 'fixture write denied' });
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...params, operationId: 'failed-write' }), statusResult('failed'));
  await unlink(link); await symlink(b, link);
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...params, operationId: 'failed-write' }), statusResult('failed', 'different'));
  assert.deepEqual(await h.files.fetch('workspace-file-save', { ...params, operationId: 'guard-conflict', guardOperationId: 'failed-write' }), { outcome: 'conflict' });
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...params, operationId: 'guard-conflict' }), statusResult('conflict'));
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...params, operationId: 'guard-conflict', hostId: 'ssh-fixture' }), statusResult('missing', 'unknown'));
  assert.equal(await readFile(join(a, 'file.txt'), 'utf8'), 'same');
  assert.equal(await readFile(join(b, 'file.txt'), 'utf8'), 'same');
  assert.equal(writes, 1);
  const restarted = createFiles({ dataDir: h.root, workspace: h.cwd, hosts: new Map(), request: async (...args) => fileDaemonFixture()(args[1], args[2]) });
  t.after(() => restarted.close());
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', { ...params, operationId: 'guard-conflict' }), statusResult('conflict'));
  await unlink(link); await symlink(a, link);
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', { ...params, operationId: 'guard-conflict' }), statusResult('conflict', 'different'));
});

test('a lost blocked response is recoverable by the submitted id with the original host and query', async t => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') { entered(); await gate; }
    return request(...args);
  });
  const direct = join(h.cwd, 'original'), link = join(h.cwd, 'original-link');
  const alternate = join(h.cwd, 'alternate'), aliasRoot = join(h.cwd, 'alias-root');
  await mkdir(direct); await mkdir(alternate);
  await writeFile(join(direct, 'file.txt'), 'old'); await writeFile(join(alternate, 'file.txt'), 'old');
  await symlink(direct, link); await symlink(direct, aliasRoot);
  const originalPath = join(link, 'file.txt'), aliasPath = join(aliasRoot, 'file.txt');
  const original = h.files.fetch('workspace-file-save', { hostId: 'local', cwd: h.cwd, path: originalPath,
    operationId: 'original-save', expectedContents: 'old', contents: 'new' });
  await writing;
  const blockedParams = { hostId: 'local', cwd: aliasRoot, path: aliasPath, operationId: 'submitted-save', expectedContents: 'old', contents: 'other' };
  try {
    assert.deepEqual(await h.files.fetch('workspace-file-save', blockedParams), blocked('original-save', h.cwd, originalPath));
    assert.deepEqual(await h.files.fetch('workspace-file-save-status', blockedParams), blocked('original-save', h.cwd, originalPath));
    assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...blockedParams, hostId: 'ssh-fixture' }), statusResult('missing', 'unknown'));
    assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...blockedParams, operationId: 'never-received' }), statusResult('missing', 'unknown'));
  } finally { release(); await original.catch(() => {}); }
  assert.deepEqual(await original, { outcome: 'saved' });
  const restarted = createFiles({ dataDir: h.root, workspace: h.cwd, hosts: new Map(), request: async (...args) => fileDaemonFixture()(args[1], args[2]) });
  t.after(() => restarted.close());
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', blockedParams), blocked('original-save', h.cwd, originalPath));
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', { ...blockedParams, operationId: 'original-save',
    queryCwd: h.cwd, queryPath: originalPath }), statusResult('saved'));
  assert.deepEqual(await restarted.fetch('workspace-file-save', blockedParams), blocked('original-save', h.cwd, originalPath));
  assert.equal(await readFile(aliasPath, 'utf8'), 'new');
  await unlink(aliasRoot); await symlink(alternate, aliasRoot);
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', blockedParams), blocked('original-save', h.cwd, originalPath));
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', { ...blockedParams, operationId: 'original-save',
    queryCwd: h.cwd, queryPath: originalPath }), statusResult('saved', 'different'));
  assert.equal(await readFile(aliasPath, 'utf8'), 'old');
  await unlink(aliasRoot);
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', blockedParams), blocked('original-save', h.cwd, originalPath));
  assert.deepEqual(await restarted.fetch('workspace-file-save-status', { ...blockedParams, operationId: 'original-save',
    queryCwd: h.cwd, queryPath: originalPath }), statusResult('saved', 'unknown'));
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

test('legacy receipts can only be recovered on the same host and canonical target', async t => {
  const h = await fixture(t);
  await writeFile(join(h.root, 'workspace-file-saves.json'), JSON.stringify([{ id: 'legacy', hostId: 'local', target: h.path, state: 'unknown', futureField: { keep: true } }]));
  assert.deepEqual(await h.save(await readFile(h.path, 'utf8'), 'not written'), blocked('legacy', h.cwd, h.path));
  const query = { cwd: h.cwd, path: h.path, operationId: 'legacy', queryCwd: h.cwd, queryPath: h.path };
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, hostId: 'local' }), statusResult('unknown'));
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { ...query, hostId: 'ssh-fixture' }), statusResult('missing', 'unknown'));
  const journal = JSON.parse(await readFile(join(h.root, 'workspace-file-saves.json'), 'utf8'));
  assert.deepEqual(journal.find((item: { id: string }) => item.id === 'legacy').futureField, { keep: true });
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 0);
});

test('legacy failed receipts with unrelated extra error data remain readable without a write', async t => {
  const h = await fixture(t);
  const legacy = { id: 'legacy-failed', hostId: 'local', target: h.path, state: 'failed', error: { original: true } };
  await writeFile(join(h.root, 'workspace-file-saves.json'), JSON.stringify([legacy]));
  assert.deepEqual(await h.save(await readFile(h.path, 'utf8'), 'not written', { operationId: 'legacy-failed' }),
    { outcome: 'failed', operationId: 'legacy-failed', error: '文件保存失败。' });
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'workspace-file-saves.json'), 'utf8')), [legacy]);
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 0);
});

test('an unreadable save journal fails closed before issuing a daemon write', async t => {
  const h = await fixture(t), before = await readFile(h.path, 'utf8');
  await writeFile(join(h.root, 'workspace-file-saves.json'), '{invalid');
  await assert.rejects(h.save(before, 'must not write', { operationId: 'corrupt' }));
  assert.equal(await readFile(h.path, 'utf8'), before);
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 0);
});

test('a blocked association is not acknowledged if its journal update fails', async t => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') { entered(); await gate; }
    return request(...args);
  });
  const before = await readFile(h.path, 'utf8'), original = h.save(before, 'original', { operationId: 'pending-io' });
  await writing;
  const journal = join(h.root, 'workspace-file-saves.json'), backup = join(h.root, 'journal-backup');
  await rename(journal, backup); await mkdir(journal);
  try {
    await assert.rejects(h.save(before, 'blocked', { operationId: 'blocked-io' }), { uncertain: true });
  } finally {
    await rmdir(journal); await rename(backup, journal); release(); await original.catch(() => {});
  }
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { hostId: 'local', cwd: h.cwd, path: h.path,
    operationId: 'blocked-io' }), statusResult('missing', 'unknown'));
  assert.equal(await readFile(h.path, 'utf8'), 'original');
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

test('a definite write failure is not acknowledged as failed if its journal update fails', async t => {
  let root = '';
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') {
      const journal = join(root, 'workspace-file-saves.json');
      await rename(journal, join(root, 'journal-backup')); await mkdir(journal);
      throw Object.assign(new Error('fixture write denied'), { uncertain: false });
    }
    return request(...args);
  });
  root = h.root;
  const before = await readFile(h.path, 'utf8');
  try { await assert.rejects(h.save(before, 'not written', { operationId: 'failed-io' }), { uncertain: true }); }
  finally { await rmdir(join(root, 'workspace-file-saves.json')); await rename(join(root, 'journal-backup'), join(root, 'workspace-file-saves.json')); }
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { hostId: 'local', cwd: h.cwd, path: h.path,
    operationId: 'failed-io' }), statusResult('unknown'));
  assert.equal(await readFile(h.path, 'utf8'), before);
});

test('a detected conflict is not downgraded to failed when its journal update fails', async t => {
  let root = '', target = '', interrupted = false;
  const h = await fixture(t, request => async (...args) => {
    const result = await request(...args);
    if (args[1] === 'fs/getMetadata' && args[2].path === target && !interrupted) {
      interrupted = true;
      const journal = join(root, 'workspace-file-saves.json');
      await rename(journal, join(root, 'journal-backup')); await mkdir(journal);
    }
    return result;
  });
  root = h.root; target = h.path;
  try { await assert.rejects(h.save('stale baseline', 'not written', { operationId: 'conflict-io' }), { uncertain: true }); }
  finally { await rmdir(join(root, 'workspace-file-saves.json')); await rename(join(root, 'journal-backup'), join(root, 'workspace-file-saves.json')); }
  assert.deepEqual(await h.files.fetch('workspace-file-save-status', { hostId: 'local', cwd: h.cwd, path: h.path,
    operationId: 'conflict-io' }), statusResult('unknown'));
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
