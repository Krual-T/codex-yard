import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createFiles } from '../src/native/files.ts';
import type { FileRequest } from '../src/native/files.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';

const run = promisify(execFile);
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

test('same-file saves serialize, and the second stale baseline conflicts rather than overwriting the first', async t => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(t, request => async (...args) => {
    if (args[1] === 'fs/writeFile') { entered(); await waiting; }
    return request(...args);
  });
  const before = await readFile(h.path, 'utf8'), first = h.save(before, 'first accepted');
  await writing;
  const second = h.save(before, 'stale second', { path: join(h.cwd, 'sub', '..', 'file.txt') });
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ outcome: 'saved' }, { outcome: 'conflict' }]);
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
  await assert.rejects(h.save(before, 'applied once'), error => (error as { uncertain?: boolean }).uncertain === true);
  assert.equal(await readFile(h.path, 'utf8'), 'applied once');
  assert.deepEqual(await h.save(before, 'do not replay'), { outcome: 'conflict' });
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});

test('readback disagreement reports an unknown save and preserves the actual current file', async t => {
  const h = await fixture(t, request => async (...args) => {
    const result = await request(...args);
    if (args[1] === 'fs/writeFile') await writeFile(String(args[2].path), 'changed externally');
    return result;
  });
  const before = await readFile(h.path, 'utf8');
  await assert.rejects(h.save(before, 'attempt'), error => (error as { uncertain?: boolean }).uncertain === true);
  assert.equal(await readFile(h.path, 'utf8'), 'changed externally');
  assert.equal(h.calls.filter(call => call.method === 'fs/writeFile').length, 1);
});
