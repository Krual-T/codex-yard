import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { preparePrivateSocket } from '../lib/private-socket.ts';

test('a private socket recovers after a crash and preserves live listeners and ordinary files', { skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'yard-socket-'));
  const path = join(directory, 'host.sock');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "import { createServer } from 'node:net'; import { chmodSync } from 'node:fs'; createServer(s=>s.destroy()).listen(process.argv[1],()=>{chmodSync(process.argv[1],0o600);process.stdout.write('ready');});", path]);
  t.after(() => { if (child.exitCode == null) child.kill('SIGKILL'); });
  await once(child.stdout!, 'data');
  await assert.rejects(preparePrivateSocket(path, 'Test'), /运行中的实例/);
  const exited = once(child, 'exit');
  child.kill('SIGKILL'); await exited;
  assert.ok((await stat(path)).isSocket());
  await preparePrivateSocket(path, 'Test');
  const listener = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => listener.listen(path, resolve));
  await chmod(path, 0o600);
  await new Promise<void>(resolve => listener.close(() => resolve()));
  await writeFile(path, 'retain this file', { mode: 0o600 });
  await assert.rejects(preparePrivateSocket(path, 'Test'), /其他内容占用/);
  assert.ok((await stat(path)).isFile());
});
