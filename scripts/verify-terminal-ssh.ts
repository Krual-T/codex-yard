import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmod, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { SshHost } from '../src/native/ssh.ts';

const run = promisify(execFile);
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** An isolated managed CLI reached through an actual loopback sshd and the production SSH proxy. */
export class TerminalSshFixture {
  readonly root: string;
  readonly workspace: string;
  readonly binary: string;
  readonly home: string;
  readonly codexHome: string;
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  host?: SshHost;
  daemon?: { pid: number; socketPath: string; cliVersion?: string; appServerVersion?: string };
  version?: string;
  private sshd?: ChildProcess;
  private sshdExited?: Promise<void>;
  private sshdError = '';
  private daemonAttempted = false;

  constructor(root: string, workspace: string, binary: string) {
    this.root = root;
    this.workspace = workspace;
    this.binary = binary;
    this.home = join(root, 'home');
    this.codexHome = join(root, 'codex');
    this.bin = join(root, 'bin');
    this.env = { PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, LANG: 'C.UTF-8',
      HOME: this.home, CODEX_HOME: this.codexHome, TMPDIR: join(root, 'tmp'), SHELL: '/bin/bash',
      XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'xdg-data'),
      ENV: '/dev/null', BASH_ENV: '/dev/null' };
  }

  async start() {
    await mkdir(this.bin, { recursive: true, mode: 0o700 });
    const binary = await realpath(this.binary);
    this.version = (await run(binary, ['--version'], { env: this.env, timeout: 10_000 })).stdout.trim();
    await symlink(binary, join(this.bin, 'codex'));
    await symlink(process.execPath, join(this.bin, 'node'));
    await writeFile(join(this.codexHome, 'config.toml'), 'model_provider="yard_fixture"\nmodel="fixture-model"\napproval_policy="never"\n[analytics]\nenabled=false\n[model_providers.yard_fixture]\nname="Local disabled fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n', { mode: 0o600 });
    this.daemonAttempted = true;
    const started = await run(binary, ['app-server', 'daemon', 'start'], { cwd: this.workspace, env: this.env, timeout: 20_000 });
    const daemon = JSON.parse(started.stdout) as { pid: number; socketPath: string; cliVersion?: string; appServerVersion?: string };
    assert.ok(Number.isInteger(daemon.pid) && daemon.pid > 1 && daemon.socketPath.startsWith(this.codexHome + '/'), 'CLI daemon must belong to the disposable CODEX_HOME');
    this.daemon = daemon;

    for (const name of ['host-key', 'client-key']) await run('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(this.root, name)], { env: this.env });
    await writeFile(join(this.root, 'authorized_keys'), await readFile(join(this.root, 'client-key.pub')), { mode: 0o600 });
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const address = reservation.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    await writeFile(join(this.root, 'known_hosts'), `[127.0.0.1]:${port} ${await readFile(join(this.root, 'host-key.pub'), 'utf8')}`, { mode: 0o600 });
    const config = join(this.root, 'ssh_config');
    await writeFile(config, `Host *\n  IdentitiesOnly yes\n  IdentityAgent none\n  StrictHostKeyChecking yes\n  UserKnownHostsFile ${this.root}/known_hosts\n  GlobalKnownHostsFile /dev/null\n  LogLevel ERROR\n`, { mode: 0o600 });
    await writeFile(join(this.bin, 'ssh'), `#!/bin/sh\nexec /usr/bin/ssh -F ${quote(config)} "$@"\n`, { mode: 0o700 });
    await chmod(join(this.bin, 'ssh'), 0o700);
    const username = userInfo().username;
    const options = ['-D', '-e', '-f', '/dev/null', '-h', join(this.root, 'host-key'), '-p', String(port),
      '-o', 'ListenAddress=127.0.0.1', '-o', `PidFile=${this.root}/sshd.pid`, '-o', `AuthorizedKeysFile=${this.root}/authorized_keys`,
      '-o', 'StrictModes=no', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'UsePAM=no',
      '-o', 'PermitUserRC=no', '-o', 'PermitUserEnvironment=no', '-o', 'X11Forwarding=no', '-o', 'AllowTcpForwarding=no',
      '-o', 'PrintLastLog=no', '-o', 'PrintMotd=no', '-o', 'UseDNS=no', '-o', 'LogLevel=ERROR',
      '-o', `SetEnv=HOME=${this.home} CODEX_HOME=${this.codexHome} CODEX_INSTALL_DIR=${this.bin} TMPDIR=${this.root}/tmp SHELL=/bin/bash ENV=/dev/null BASH_ENV=/dev/null`,
      '-o', `AllowUsers=${username}`];
    const sshd = this.sshd = spawn('/usr/sbin/sshd', options, { env: this.env, stdio: ['ignore', 'ignore', 'pipe'] });
    this.sshdExited = new Promise(resolve => {
      sshd.once('exit', () => resolve());
      sshd.once('error', error => { this.sshdError = String(error); resolve(); });
    });
    sshd.stderr?.on('data', data => { this.sshdError = (this.sshdError + String(data)).slice(-3000); });
    const deadline = Date.now() + 5000;
    while (true) {
      if (this.sshdError || sshd.exitCode !== null || sshd.signalCode !== null) throw new Error('Disposable sshd exited: ' + this.sshdError);
      const connected = await new Promise<boolean>(resolve => {
        const socket = connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
      });
      if (connected) break;
      if (Date.now() >= deadline) throw new Error('Disposable sshd unavailable: ' + this.sshdError);
      await delay(50);
    }
    this.host = { hostId: 'remote-ssh-discovered:terminal-fixture', displayName: 'Disposable SSH fixture', sshAlias: null,
      sshHost: `${username}@127.0.0.1`, sshPort: port, identity: join(this.root, 'client-key') };
    const checked = await run(join(this.bin, 'ssh'), ['-T', '-o', 'BatchMode=yes', '-i', this.host.identity!, '-p', String(port), '--', this.host.sshHost,
      'printf "%s\\n" "$HOME" "$CODEX_HOME"'], { env: this.env, timeout: 8000 });
    assert.deepEqual(checked.stdout.trim().split('\n'), [this.home, this.codexHome], 'SSH must use the fixture homes');
    return this.host;
  }

  async close() {
    const errors: string[] = [];
    if (this.daemonAttempted) {
      try { await run(this.binary, ['app-server', 'daemon', 'stop'], { cwd: this.workspace, env: this.env, timeout: 2500 }); }
      catch (error) { errors.push('daemon stop: ' + String(error)); }
      try {
        assert.ok(this.daemon, 'Missing owned daemon identity; retain fixture');
        const alive = async () => {
          try {
            const stat = await readFile(`/proc/${this.daemon!.pid}/stat`, 'utf8');
            if (stat.slice(stat.lastIndexOf(')') + 2)[0] === 'Z') return false;
            const env = (await readFile(`/proc/${this.daemon!.pid}/environ`, 'utf8')).split('\0');
            assert.ok(env.includes('HOME=' + this.home) && env.includes('CODEX_HOME=' + this.codexHome), 'Daemon PID no longer belongs to fixture');
            return true;
          } catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
        };
        if (await alive()) { process.kill(this.daemon.pid, 'SIGTERM'); await delay(300); }
        if (await alive()) { process.kill(this.daemon.pid, 'SIGKILL'); await delay(300); }
        assert.equal(await alive(), false, 'Disposable daemon did not exit');
        // Some CLI versions leave a detached updater. Match the fixture release path and both homes.
        let candidates = '';
        try { candidates = (await run('pgrep', ['-f', this.codexHome + '/packages/app-server-daemon/releases/'], { env: this.env })).stdout; }
        catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
        for (const candidate of candidates.trim().split(/\s+/).filter(Boolean)) {
          try {
            const command = await readFile(`/proc/${candidate}/cmdline`, 'utf8');
            if (!command.startsWith(this.codexHome + '/packages/app-server-daemon/releases/') || !command.includes('\0app-server\0daemon\0pid-update-loop')) continue;
            const env = (await readFile(`/proc/${candidate}/environ`, 'utf8')).split('\0');
            assert.ok(env.includes('HOME=' + this.home) && env.includes('CODEX_HOME=' + this.codexHome), 'Updater PID no longer belongs to fixture');
            process.kill(Number(candidate), 'SIGTERM');
            for (let attempt = 0; attempt < 20; attempt++) {
              try { if ((await readFile(`/proc/${candidate}/stat`, 'utf8')).split(' ')[2] === 'Z') break; }
              catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) break; throw error; }
              await delay(100);
              if (attempt === 19) throw new Error('Disposable updater did not exit');
            }
          } catch (error) { if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        }
      } catch (error) { errors.push('daemon cleanup: ' + String(error)); }
    }
    if (this.sshd?.pid && this.sshd.exitCode === null && this.sshd.signalCode === null) {
      this.sshd.kill('SIGTERM');
      await Promise.race([this.sshdExited, delay(2000)]);
      if (this.sshd.exitCode === null && this.sshd.signalCode === null) { this.sshd.kill('SIGKILL'); await this.sshdExited; }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }
}
