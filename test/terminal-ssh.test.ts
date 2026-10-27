import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { codexProxyEnvironment } from '../src/native/ssh.ts';

test('SSH proxy reuses one existing Node/Codex installation; PATH wins and multiple fallbacks fail explicitly', async t => {
  const root = await mkdtemp('/tmp/aw-terminal-ssh-');
  t.after(() => rm(root, { recursive: true, force: true }));
  // Substitute only the bootstrap's home reference; never change the user's HOME.
  const command = codexProxyEnvironment.replaceAll('$HOME', '${terminalTestRoot}') + '\ncommand -v codex';
  const env = { PATH: join(root, 'empty'), CODEX_INSTALL_DIR: join(root, 'explicit'), terminalTestRoot: root };
  const run = () => promisify(execFile)('/bin/sh', ['-c', command], { env });
  await assert.rejects(run(), /未找到已有 Codex CLI/);
  async function installation(name: string) {
    const bin = join(root, '.nodejs', name, 'bin');
    await mkdir(bin, { recursive: true });
    for (const executable of ['node', 'codex']) await writeFile(join(bin, executable), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    return bin;
  }
  const first = await installation('node-existing');
  assert.equal((await run()).stdout.trim(), join(first, 'codex'));
  await installation('node-second');
  await assert.rejects(run(), /多个.*Codex 安装/);
  await mkdir(env.CODEX_INSTALL_DIR);
  await writeFile(join(env.CODEX_INSTALL_DIR, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  assert.equal((await run()).stdout.trim(), join(env.CODEX_INSTALL_DIR, 'codex'));
});
