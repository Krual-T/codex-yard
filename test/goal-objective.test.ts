import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { createFiles } from '../src/native/files.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';

test('long Goal objectives use fresh bounded attachments on the selected local or SSH host', async t => {
  const root = await mkdtemp('/tmp/yard-goal-files-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const localHome = join(root, 'local'), remoteHome = join(root, 'remote'), hostId = 'fixture-ssh';
  await mkdir(localHome); await mkdir(remoteHome);
  const daemon = fileDaemonFixture(), run = promisify(execFile), calls: string[] = [];
  const files = createFiles({ dataDir: root, workspace: root,
    hosts: new Map([[hostId, { hostId, displayName: 'Goal fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }]]),
    request: async (id, method, params) => { calls.push(id); return daemon(method, params); },
    remoteCommand: async (_host, command, maxBytes, _signal, input) => {
      assert.equal(input, undefined);
      return (await run('/bin/sh', ['-c', command], { encoding: 'buffer', maxBuffer: maxBytes + 1 })).stdout;
    } });
  t.after(() => files.close());
  for (const [id, home] of [['local', localHome], [hostId, remoteHome]]) {
    // The original threshold counts Unicode code points, not UTF-16 units.
    const short = '🚀'.repeat(4000);
    assert.deepEqual(await files.goalObjective({ operation: 'create', objective: short }, id!, home!), { objective: short });
    assert.deepEqual(await readdir(home!), []);
    const objective = '目标\n'.repeat(2001);
    const result = await files.goalObjective({ operation: 'create', objective }, id!, home!);
    const target = result.objective.slice('Read the Codex goal objective file at '.length, -' before continuing.'.length);
    assert.match(target, /\/attachments\/[a-f0-9-]{36}\/goal-objective\.md$/);
    assert.equal(await readFile(target, 'utf8'), objective);
    assert.deepEqual(await files.goalObjective({ operation: 'read', objective: result.objective }, id!, home!), { objective });
    const another = await files.goalObjective({ operation: 'create', objective: objective + 'second' }, id!, home!);
    assert.notEqual(another.objective, result.objective);
    assert.equal(await readFile(target, 'utf8'), objective);
    if (id === 'local') assert.equal((await stat(target)).mode & 0o777, 0o600);
  }
  assert.ok(calls.includes(hostId));
  await assert.rejects(files.goalObjective({ operation: 'create', objective: 'x'.repeat(10 * 1024 * 1024 + 1) }, 'local', localHome), /10 MiB/);
  await assert.rejects(files.goalObjective({ operation: 'create', objective: 'x'.repeat(4001) }, 'unknown-host', localHome), /未登记/);
});

test('Goal reads reject symlink escapes and leave non-Goal reference strings literal', async t => {
  const root = await mkdtemp('/tmp/yard-goal-path-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'codex'), attachments = join(home, 'attachments'), uuid = '00000000-0000-4000-8000-000000000001';
  await mkdir(join(attachments, uuid), { recursive: true });
  const outside = join(root, 'outside.md'); await writeFile(outside, 'private fixture');
  const files = createFiles({ dataDir: root, workspace: root, hosts: new Map(), request: (_id, method, params) => fileDaemonFixture()(method, params) });
  t.after(() => files.close());
  const reference = (target: string) => `Read the Codex goal objective file at ${target} before continuing.`;
  for (const target of [outside, join(attachments, uuid, 'other.md'), join(attachments, uuid, '..', uuid, 'goal-objective.md')]) {
    // join normalizes traversal, so retain an explicitly noncanonical string.
    const value = reference(target.endsWith('goal-objective.md') ? attachments + '/' + uuid + '/../' + uuid + '/goal-objective.md' : target);
    assert.deepEqual(await files.goalObjective({ operation: 'read', objective: value }, 'local', home), { objective: value });
  }
  const target = join(attachments, uuid, 'goal-objective.md'); await symlink(outside, target);
  await assert.rejects(files.goalObjective({ operation: 'read', objective: reference(target) }, 'local', home), /路径无效/);
  await rm(attachments, { recursive: true }); await symlink(root, attachments);
  await assert.rejects(files.goalObjective({ operation: 'create', objective: 'x'.repeat(4001) }, 'local', home), /目录无效/);
  assert.equal(await readFile(outside, 'utf8'), 'private fixture');
});
