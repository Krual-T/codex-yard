import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexConnection } from '../lib/codex.ts';
import { TerminalHost } from '../src/native/terminal.ts';
import type { TerminalEvent } from '../src/native/terminal-protocol.ts';
import { loadHostCatalog } from '../src/native/hosts.ts';
import { createSshProxyStream, sshArguments } from '../src/native/ssh.ts';

// No Agent turns or persistent threads. Only our own short-lived shell handles.
// flock /tmp/agents-workbench-heavy.lock node scripts/verify-terminal-process.ts --ssh
// --host=<hostId> limits a rerun. A failing host is recorded and fails the run.
const project = resolve(import.meta.dirname, '..');
const workspace = resolve(project, '../..');
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const catalog = await loadHostCatalog(codexHome);
const filter = process.argv.find(value => value.startsWith('--host='))?.slice(7);
const targets = [{ hostId: 'local', cwd: workspace }, ...(process.argv.includes('--ssh') ? catalog.hosts.map(host => ({
  hostId: host.hostId, cwd: catalog.projects.find(project => project.hostId === host.hostId)!.remotePath,
})) : [])].filter(target => !filter || target.hostId === filter);
assert.ok(targets.length, 'No matching host');
const output = process.env.AGENTS_TERMINAL_EVIDENCE_DIR || join(project, '.local', 'terminal-process-evidence', String(Date.now()));
await mkdir(output, { recursive: true });
const results: unknown[] = [];
let failed = false;

async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error('Timed out: ' + label); await delay(25); }
}

for (const target of targets) {
  const host = catalog.hosts.find(host => host.hostId === target.hostId);
  const connection = new CodexConnection(host ? '' : join(codexHome, 'app-server-control', 'app-server-control.sock'), host
    ? { createConnection: () => createSshProxyStream(host), connectTimeout: 20000 } : { cwd: workspace });
  const events: TerminalEvent[] = [], checks: string[] = [], methods: string[] = [];
  connection.on('message', message => { if (typeof message.method === 'string' && message.method.startsWith('process/')) methods.push(message.method); });
  const terminal = new TerminalHost({ workspace, connectionFor: async hostId => {
    assert.equal(hostId, target.hostId); await connection.connect(); return connection;
  }, send: event => events.push(event) });
  const result = { ...target, userAgent: '', passed: false, checks, methods, events, error: '',
    abruptDisconnect: { shellStopped: false, backgroundChildSurvived: false, finiteChildFinished: false } };
  const request = { sessionId: 'verification', conversationId: 'verification-only', ...target };
  const text = () => events.filter(event => event.type === 'data').map(event => event.data).join('');
  const write = (command: string) => terminal.request('write', [request.sessionId, command + '\r']);
  async function line(value: string) { await until(() => text().includes(value + '\r\n'), value); }
  async function shellPid(label: string) {
    await write(`printf '${label}=%s\\n' "$$"`);
    await until(() => new RegExp(label + '=\\d+').test(text()), label);
    return Number(new RegExp(label + '=(\\d+)').exec(text())![1]);
  }
  async function alive(pid: number) {
    if (host) {
      const result = await promisify(execFile)('ssh', [...sshArguments(host), `ps -p ${pid} -o stat= || true`], { timeout: 15000, encoding: 'utf8' });
      return /^(?!Z)\S/m.test(result.stdout.trim());
    }
    try { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z'; }
    catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
  }
  try {
    await connection.connect();
    result.userAgent = connection.server?.userAgent ?? '';
    const expectedHost = host
      ? (await promisify(execFile)('ssh', [...sshArguments(host), 'hostname'], { encoding: 'utf8', timeout: 15000 })).stdout.trim()
      : hostname();
    await terminal.request('create', [request]);
    await write(`printf 'TP_HOST=%s\\nTP_CWD=%s\\n' "$(hostname)" "$PWD"`);
    await line('TP_HOST=' + expectedHost); await line('TP_CWD=' + target.cwd);
    const original = await shellPid('TP_PID');
    checks.push('official spawn, selected host/cwd and shell PID');
    await terminal.request('create', [request]);
    assert.equal(await terminal.request('attachExisting', [request]), true);
    assert.equal(await shellPid('TP_SAME'), original);
    await terminal.request('resize', [request.sessionId, 93, 31]);
    await terminal.request('resize', [request.sessionId, 93, 31, true]);
    await write(`printf 'TP_SIZE=%s\\n' "$(stty size)"`); await line('TP_SIZE=31 93');
    await write(`printf 'TP_UNICODE=中文🙂\\nTP_MULTILINE\\n'; for i in 1 2 3; do printf 'TP_TICK_%s\\n' "$i"; sleep .1; done`);
    await line('TP_UNICODE=中文🙂'); await line('TP_MULTILINE'); await line('TP_TICK_3');
    await write(`printf 'TP_RUNNING\\n'; sleep 60`); await line('TP_RUNNING');
    await terminal.request('write', [request.sessionId, '\x03']);
    await write(`printf 'TP_INTERRUPTED\\n'`); await line('TP_INTERRUPTED');
    assert.equal(await shellPid('TP_AFTER_INTERRUPT'), original);
    checks.push('reattach, UTF-8, multiline/streamed output, resize and Ctrl+C');
    await write(`sleep 60 & printf 'TP_CHILD=%s\\n' "$!"`);
    await until(() => /TP_CHILD=\d+/.test(text()), 'background PID');
    const child = Number(/TP_CHILD=(\d+)/.exec(text())![1]);
    await terminal.request('close', [request.sessionId]);
    await until(async () => !await alive(original) && !await alive(child), 'close reaps shell and child');
    checks.push('official spawn sends targeted SIGHUP; exit notification, shell and child stopped');
    await terminal.request('create', [request]);
    await write('exit 7');
    await until(() => events.some(event => event.type === 'exit' && event.code === 7), 'exit code 7');
    checks.push('natural exit code mapping');
    await terminal.request('create', [request]);
    const disconnected = await shellPid('TP_DISCONNECT');
    // Observe the daemon's separate abrupt-loss boundary with a bounded job.
    // Normal-close child cleanup above remains a strict pass/fail requirement.
    await write(`sleep 5 & printf 'TP_DISCONNECT_CHILD=%s\\n' "$!"`);
    await until(() => /TP_DISCONNECT_CHILD=\d+/.test(text()), 'disconnect child PID');
    const disconnectChild = Number(/TP_DISCONNECT_CHILD=(\d+)/.exec(text())![1]);
    connection.socket!.terminate();
    await until(() => events.some(event => event.type === 'exit' && event.error?.includes('主机连接已断开')), 'transport loss');
    await until(async () => !await alive(disconnected), 'daemon cleanup after disconnect');
    result.abruptDisconnect.shellStopped = true;
    result.abruptDisconnect.backgroundChildSurvived = await alive(disconnectChild);
    await assert.rejects(terminal.request('write', [request.sessionId, 'must-not-replay\r']), /已关闭/);
    await terminal.request('create', [request]);
    assert.notEqual(await shellPid('TP_RECONNECTED'), disconnected);
    checks.push('abrupt daemon transport disconnect, no input replay, explicit reconnect');
    await until(async () => !await alive(disconnectChild), 'finite disconnect probe finishes');
    result.abruptDisconnect.finiteChildFinished = true;
    result.passed = true;
    console.log(JSON.stringify({ hostId: target.hostId, userAgent: result.userAgent, checks }));
  } catch (error) {
    result.error = String(error); failed = true;
    console.error(JSON.stringify({ hostId: target.hostId, userAgent: result.userAgent, error: result.error }));
  } finally {
    await terminal.dispose();
    connection.close();
    results.push(result);
    await writeFile(join(output, 'verified.json'), JSON.stringify({ at: new Date().toISOString(), passed: !failed, results }, null, 2));
  }
}
console.log(JSON.stringify({ output, passed: !failed }));
if (failed) process.exitCode = 1;
