// Run under /tmp/agents-workbench-heavy.lock. All processes and data are disposable.
// --ssh exercises a synthetic SSH host and reports real SSH as an uncovered gap.
// --project selects fixture-local or, with --ssh, fixture-ssh; no user catalog is read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page, WebSocketRoute } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import type { TerminalEvent } from '../src/native/terminal-protocol.ts';
import { createFakeCodex } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';

const root = await mkdtemp('/tmp/yard-terminal-ui-');
const fixtureEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: join(root, 'home'),
  CODEX_HOME: join(root, 'codex'), XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
  XDG_DATA_HOME: join(root, 'xdg-data'), TMPDIR: join(root, 'tmp') };
await Promise.all([fixtureEnv.HOME, fixtureEnv.CODEX_HOME, fixtureEnv.XDG_CONFIG_HOME, fixtureEnv.XDG_CACHE_HOME,
  fixtureEnv.XDG_DATA_HOME, fixtureEnv.TMPDIR].map(path => mkdir(path, { recursive: true })));
const output = process.env.AGENTS_TERMINAL_EVIDENCE_DIR
  ? resolve(process.env.AGENTS_TERMINAL_EVIDENCE_DIR) : await mkdtemp('/tmp/yard-terminal-evidence-');
await mkdir(output, { recursive: true });
const remoteRoot = join(root, 'remote-project');
await mkdir(remoteRoot);
const localFake = await createFakeCodex(root);
const remoteFake = await createFakeCodex(remoteRoot);
const remoteHost = 'remote-ssh-discovered:terminal-fixture';
const projectFilter = process.argv.find(value => value.startsWith('--project='))?.slice('--project='.length);
const targets = [
  { hostId: 'local', projectId: 'fixture-local', label: 'Local terminal fixture', cwd: root, fake: localFake },
  ...(process.argv.includes('--ssh') ? [{ hostId: remoteHost, projectId: 'fixture-ssh', label: 'SSH terminal fixture', cwd: remoteRoot, fake: remoteFake }] : []),
].filter(target => !projectFilter || projectFilter === target.projectId);
const processes = new Map<string, { child: ChildProcessWithoutNullStreams; owner: string; pid?: number }>();
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
let checks: string[] = [], gaps: string[] = [], errors: string[] = [];
let requests: { operation: string; args: unknown[] }[] = [];
let events: { at: number; event: TerminalEvent }[] = [];
let connections: { hostId: string; state: string }[] = [];
let sockets: { page: WebSocketRoute; server: WebSocketRoute; connected: boolean }[] = [];
const results: { hostId: string; projectId: string; cwd: string; checks: string[]; gaps: string[]; errors: string[];
  requests: typeof requests; events: typeof events; connections: typeof connections }[] = [];
const report: Record<string, unknown> = { renderer: 'owned', peer: 'synthetic local/SSH host RPC with real disposable local PTYs',
  realDaemonUsed: false, realSshUsed: false, results };

async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error('Terminal UI timed out: ' + label); await delay(50); }
}
async function running(pid: number) {
  try { const status = await readFile(`/proc/${pid}/stat`, 'utf8'); return status.slice(status.lastIndexOf(')') + 2)[0] !== 'Z'; }
  catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
}
const text = () => events.map(({ event }) => event.type === 'data' ? event.data : '').join('');
const waitText = (value: string) => until(() => text().includes(value + '\r\n'), value);
const stopped = (pid: number) => until(async () => !await running(pid), 'process exits: ' + pid);
const processAction = (owner: string, handle: string, value: Record<string, unknown>) => {
  const process = processes.get(handle);
  if (!process || process.owner !== owner || process.child.exitCode !== null) throw new Error('No active fixture process for host: ' + handle);
  process.child.stdin.write(JSON.stringify(value) + '\n');
};
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png'), timeout: 10000 });
}
try {
  assert.ok(targets.length, 'No matching disposable fixture project; use fixture-local or --ssh --project=fixture-ssh');
  for (const target of [
    { hostId: 'local', cwd: root, fake: localFake },
    { hostId: remoteHost, cwd: remoteRoot, fake: remoteFake },
  ]) {
    const fileRpc = fileDaemonFixture(path => {
      if (path !== target.cwd && !path.startsWith(target.cwd + '/')) throw new Error('File request outside disposable fixture');
      return path;
    });
    for (const method of fileMethods) target.fake.handlers.set(method, params => fileRpc(method, params));
    target.fake.handlers.set('process/spawn', (params, peer) => {
      const handle = String(params.processHandle);
      const command = params.command as string[];
      if (params.tty === true) {
        assert.match(handle, /^workbench-terminal-[0-9a-f-]+$/);
        assert.equal(params.cwd, target.cwd);
        assert.deepEqual(command, ['/bin/sh', '-c', `printf '\\036%s\\037%s\\037%s\\037' '${handle}' "\${SHELL:-/bin/sh}" "$$"; exec "\${SHELL:-/bin/sh}" -i`]);
        assert.ok(!processes.has(handle));
        const child = spawn('python3', ['-u', resolve(import.meta.dirname, 'verify-terminal-pty.py'), JSON.stringify({ cwd: target.cwd, command,
          size: params.size, env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', SHELL: '/bin/bash', HISTFILE: '/dev/null', PS1: 'yard-fixture> ' } })],
        { env: fixtureEnv });
        const state: { child: ChildProcessWithoutNullStreams; owner: string; pid?: number } = { child, owner: target.hostId };
        processes.set(handle, state);
        const notify = (value: unknown) => { if (peer.socket.readyState === 1) peer.send(value); };
        createInterface({ input: child.stdout }).on('line', line => {
          const message = JSON.parse(line) as { type: string; pid?: number; base64?: string; code?: number };
          if (message.type === 'pid') state.pid = message.pid;
          if (message.type === 'data') notify({ method: 'process/outputDelta', params: { processHandle: handle, stream: 'stdout', deltaBase64: message.base64 } });
          if (message.type === 'exit') notify({ method: 'process/exited', params: { processHandle: handle, exitCode: message.code } });
        });
        child.stderr.on('data', data => errors.push('PTY fixture: ' + String(data)));
        peer.socket.once('close', () => { if (child.exitCode === null) child.kill('SIGTERM'); });
        return {};
      }
      assert.equal(params.cwd, '/');
      assert.equal(command.length, 4);
      assert.deepEqual(command.slice(0, 3), ['/bin/kill', '-HUP', '--']);
      const pid = Number(command[3]);
      assert.ok([...processes.values()].some(process => process.owner === target.hostId && process.pid === pid && process.child.exitCode === null));
      process.kill(pid, 'SIGHUP');
      queueMicrotask(() => { if (peer.socket.readyState === 1) peer.send({ method: 'process/exited', params: { processHandle: handle, exitCode: 0 } }); });
      return {};
    });
    target.fake.handlers.set('process/writeStdin', params => { processAction(target.hostId, String(params.processHandle), { type: 'write', base64: params.deltaBase64 }); return {}; });
    target.fake.handlers.set('process/resizePty', params => {
      const size = params.size as { rows: number; cols: number };
      processAction(target.hostId, String(params.processHandle), { type: 'resize', rows: size.rows, cols: size.cols }); return {};
    });
    target.fake.handlers.set('process/kill', params => { processAction(target.hostId, String(params.processHandle), { type: 'kill' }); return {}; });
  }
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/projects.json'), JSON.stringify([{ path: root, name: 'Local terminal fixture' }]));
  await writeFile(join(root, 'data/native-state.json'), JSON.stringify({ globals: {
    'remote-connection-auto-connect-by-host-id': { [remoteHost]: true },
  } }));
  app = await createNativeWorkbench({ port: 0, workspace: root, dataDir: join(root, 'data'), codexHome: join(root, 'codex'),
    socketPath: localFake.socketPath,
    hostCatalog: { hosts: [{ hostId: remoteHost, displayName: 'Disposable SSH fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }],
      projects: [{ hostId: remoteHost, id: 'fixture-ssh', label: 'SSH terminal fixture', remotePath: remoteRoot }], assignments: {} },
    sshStream: (host, onPaths) => {
      assert.equal(host.hostId, remoteHost);
      onPaths?.({ homeDirectory: remoteRoot, codexHome: join(remoteRoot, 'codex') });
      return createConnection(remoteFake.socketPath);
    },
    remoteFileCommand: async (_host, command) => {
      if (command === `stat -L --printf='%s' -- '${remoteRoot}'`) return Buffer.from('0');
      if (command === `realpath -ze -- '${remoteRoot}'`) return Buffer.from(remoteRoot + '\0');
      throw new Error('External SSH file commands are disabled in the disposable fixture');
    },
    httpFetch: async () => new Response('External requests disabled for terminal fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    headless: true, env: fixtureEnv, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'] });
  for (const target of targets) {
    checks = []; gaps = []; errors = []; requests = []; events = []; connections = []; sockets = [];
    results.push({ hostId: target.hostId, projectId: target.projectId, cwd: target.cwd, checks, gaps, errors, requests, events, connections });
    if (target.hostId !== 'local') gaps.push('Real SSH transport and remote project verification remain uncovered; this host is synthetic');
    const otherFake = target.fake === localFake ? remoteFake : localFake;
    const otherSpawnCount = otherFake.calls('process/spawn').filter(call => call.params.tty === true).length;
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/native-host', route => {
      const socket = { page: route, server: route.connectToServer(), connected: false };
      sockets.push(socket);
      route.onMessage(raw => {
        const message = JSON.parse(String(raw));
        if (message.type === 'fetch' && message.url?.endsWith('/terminal')) requests.push(JSON.parse(message.body));
        socket.server.send(raw);
      });
      socket.server.onMessage(raw => {
        const message = JSON.parse(String(raw));
        if (message.type === 'terminal-event') events.push({ at: Date.now(), event: message.event });
        if (message.type === 'codex-app-server-connection-changed') {
          connections.push({ hostId: String(message.hostId), state: String(message.state) });
          if (message.hostId === 'local' && message.state === 'connected') socket.connected = true;
        }
        route.send(raw);
      });
    });
    await page.goto(app.url + '/?hostId=' + encodeURIComponent(target.hostId), { waitUntil: 'commit' });
    await page.locator('[data-owned-renderer="true"]').waitFor();
    const projectAction = page.getByRole('button', { name: `New chat in ${target.label}`, exact: true });
    await projectAction.click({ timeout: 60000 });
    await page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true }).waitFor();
    const terminal = page.locator('.yard-terminal-screen .xterm-helper-textarea');
    async function waitForNewTerminal(previousCount: number) {
      await until(() => requests.filter(request => request.operation === 'create').length > previousCount, 'new terminal request');
      const create = requests.filter(request => request.operation === 'create').at(-1)!;
      const sessionId = (create.args[0] as { sessionId: string }).sessionId;
      await until(() => events.some(({ event }) => event.type === 'attached' && event.sessionId === sessionId), 'new terminal attached');
    }
    async function open() {
      const before = requests.filter(request => request.operation === 'create').length;
      await page!.getByRole('button', { name: 'Open terminal', exact: true }).click();
      await terminal.waitFor({ state: 'attached' });
      await waitForNewTerminal(before);
    }
    async function command(value: string) {
      await until(async () => {
        await page!.locator('.yard-terminal-screen .xterm-screen').click();
        await delay(100);
        return terminal.evaluate(element => document.activeElement === element);
      }, 'terminal keyboard focus');
      const before = requests.filter(request => request.operation === 'write').length;
      await page!.keyboard.insertText(value);
      await page!.keyboard.press('Enter');
      await until(() => requests.filter(request => request.operation === 'write').length > before, 'terminal write');
    }
    async function pid(label: string) {
      await command(`printf '${label}=%s\\n' "$$"`);
      await until(() => new RegExp(label + '=\\d+').test(text()), label);
      return Number(new RegExp(label + '=(\\d+)').exec(text())![1]);
    }
    async function child(label: string) {
      await command(`sleep 60 & printf '${label}=%s\\n' "$!"`);
      await until(() => new RegExp(label + '=\\d+').test(text()), label);
      return Number(new RegExp(label + '=(\\d+)').exec(text())![1]);
    }
    async function checkTarget(label: string) {
      await command(`printf '${label}_HOST=%s\\n${label}_CWD=%s\\n' "$(hostname)" "$(pwd -P)"`);
      await waitText(label + '_HOST=' + hostname());
      await waitText(label + '_CWD=' + await realpath(target.cwd));
    }
    await open();
    const create = requests.find(request => request.operation === 'create')!;
    assert.equal((create.args[0] as { hostId: string }).hostId, target.hostId);
    assert.equal((create.args[0] as { cwd: string }).cwd, target.cwd);
    assert.ok(target.fake.calls('process/spawn').some(call => call.params.tty === true && call.params.cwd === target.cwd));
    assert.equal(otherFake.calls('process/spawn').filter(call => call.params.tty === true).length, otherSpawnCount);
    await checkTarget('TW');
    const initialPid = await pid('TW_PID');
    checks.push('Selected project opens a real local PTY in its cwd through the correct synthetic host peer');
    await command(`printf 'TW_LINE_A\\nTW_LINE_B\\n'; for i in 1 2 3; do printf 'TW_TICK_%s\\n' "$i"; sleep .4; done`);
    await waitText('TW_TICK_1'); await waitText('TW_TICK_3');
    assert.ok(text().includes('TW_LINE_A\r\nTW_LINE_B\r\n'));
    const first = events.find(({ event }) => event.type === 'data' && event.data.includes('TW_TICK_1\r\n'))!;
    const last = events.find(({ event }) => event.type === 'data' && event.data.includes('TW_TICK_3\r\n'))!;
    assert.ok(last.at - first.at >= 400, 'PTY output must stream over time');
    await command(`printf 'TW_RUNNING\\n'; sleep 60`);
    await waitText('TW_RUNNING');
    await page.keyboard.press('Control+c');
    await command(`printf 'TW_INTERRUPTED\\n'`); await waitText('TW_INTERRUPTED');
    const previous = requests.filter(request => request.operation === 'resize').at(-1);
    await page.setViewportSize({ width: 1100, height: 800 });
    await until(() => requests.filter(request => request.operation === 'resize').at(-1) !== previous, 'resize request');
    const size = requests.filter(request => request.operation === 'resize').at(-1)!;
    await command(`printf 'TW_SIZE=%s\\n' "$(stty size)"`);
    await waitText(`TW_SIZE=${size.args[2]} ${size.args[1]}`);
    checks.push('Real PTY multiline and streaming output, Ctrl+C and kernel dimensions');
    const hideTabs = page.getByRole('button', { name: /^(隐藏标签页|Hide tabs)$/ });
    if (await hideTabs.count()) {
      await hideTabs.click();
      await page.getByRole('button', { name: /^(显示标签页|Show tabs)$/ }).click();
      assert.equal(await pid('TW_HIDE_REVEAL'), initialPid);
      assert.equal(requests.filter(request => request.operation === 'create').length, 1);
      checks.push('Hiding and revealing tabs preserves the same shell');
    } else gaps.push('Original hide/reveal tabs controls are unavailable');
    await page.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
    await page.getByRole('button', { name: 'Workspace files', exact: true }).click();
    assert.equal(await pid('TW_SAME'), initialPid);
    assert.equal(requests.filter(request => request.operation === 'create').length, 1);
    checks.push('Switching away and back preserves the same shell');
    const backgroundPid = await child('TW_CHILD');
    await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
    await stopped(initialPid); await stopped(backgroundPid);
    await open();
    const reopenedPid = await pid('TW_REOPEN');
    assert.notEqual(reopenedPid, initialPid);
    await checkTarget('TW_REOPEN');
    checks.push('Closing reaps the shell and child; reopening starts a new shell');
    await command('exit'); await stopped(reopenedPid);
    const beforeNew = requests.filter(request => request.operation === 'create').length;
    await page.getByRole('button', { name: 'New terminal', exact: true }).click();
    await waitForNewTerminal(beforeNew);
    const beforeReload = await pid('TW_BEFORE_RELOAD');
    const reloadChild = await child('TW_RELOAD_CHILD');
    await command(`printf 'TW_ONCE\\n'`); await waitText('TW_ONCE');
    await page.reload({ waitUntil: 'commit' });
    await projectAction.click({ timeout: 60000 });
    await stopped(beforeReload); await stopped(reloadChild);
    await open();
    const afterReload = await pid('TW_AFTER_RELOAD');
    assert.notEqual(afterReload, beforeReload);
    assert.equal(text().split('TW_ONCE\r\n').length - 1, 1);
    await checkTarget('TW_RELOAD');
    checks.push('Exit and reload clean up processes; input is not replayed');
    const disconnectChild = await child('TW_DISCONNECT_CHILD');
    const createCount = requests.filter(request => request.operation === 'create').length;
    const writeCount = requests.filter(request => request.operation === 'write').length;
    const socketCount = sockets.length, socket = sockets.at(-1)!;
    await Promise.all([socket.page.close({ code: 1012, reason: 'isolated terminal reconnect' }), socket.server.close()]);
    await stopped(afterReload); await stopped(disconnectChild);
    await until(() => sockets.length > socketCount && sockets.at(-1)!.connected, 'host reconnect');
    assert.equal(requests.filter(request => request.operation === 'create').length, createCount);
    assert.equal(requests.filter(request => request.operation === 'write').length, writeCount, 'Reconnect must not replay terminal input');
    await page.keyboard.press('Control+Backquote');
    await delay(1000);
    if (requests.filter(request => request.operation === 'create').length === createCount) {
      gaps.push('Ctrl+Backquote did not explicitly open a replacement terminal after reconnect');
      await page.getByRole('button', { name: 'New terminal', exact: true }).click();
    }
    await waitForNewTerminal(createCount);
    const reconnectedPid = await pid('TW_AFTER_RECONNECT');
    assert.notEqual(reconnectedPid, afterReload);
    await checkTarget('TW_RECONNECT');
    await page.keyboard.press('Control+Backquote');
    assert.equal(await pid('TW_SHORTCUT_SAME'), reconnectedPid);
    assert.equal(requests.filter(request => request.operation === 'create').length, createCount + 1);
    assert.equal(text().split('TW_ONCE\r\n').length - 1, 1, 'Earlier terminal input must not be replayed after reconnect');
    assert.equal(otherFake.calls('process/spawn').filter(call => call.params.tty === true).length, otherSpawnCount);
    checks.push('Disconnect reaps processes; reconnect does not replay input or automatically create a shell');
    await capture(target.projectId + '-terminal');
    assert.deepEqual(errors, []);
    await page.close();
    page = undefined;
  }
  assert.deepEqual(results.flatMap(result => result.gaps.map(gap => result.projectId + ': ' + gap)), [],
    'Original terminal behavior and requested SSH coverage must be available for each selected project');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  await browser?.close(); await app?.close(); await localFake.close(); await remoteFake.close();
  for (const process of processes.values()) if (process.child.exitCode === null) process.child.kill('SIGTERM');
  await Promise.all([...processes.values()].map(async ({ child }) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }));
  await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log('Terminal UI evidence:', output);
}
