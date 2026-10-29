// Run under /tmp/agents-workbench-heavy.lock. All processes and data are disposable.
// --ssh uses a disposable loopback sshd and the actual CLI proxy, not a synthetic SSH peer.
// --project selects fixture-local or, with --ssh, fixture-ssh; no user catalog is read.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { Browser, Page, WebSocketRoute } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import type { RequestOptions, RpcResult } from '../lib/codex.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { createSshProxyStream } from '../src/native/ssh.ts';
import type { TerminalEvent } from '../src/native/terminal-protocol.ts';
import { createFakeCodex } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';
import { TerminalSshFixture } from './verify-terminal-ssh.ts';

const inheritedEnv = { ...process.env };
const requestedSsh = process.argv.includes('--ssh');
const requestedBinary = process.env.AGENTS_TERMINAL_CODEX_BIN;
const chromePath = process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome';
const requestedOutput = process.env.AGENTS_TERMINAL_EVIDENCE_DIR;
const temporaryParent = resolve(tmpdir());
const root = await mkdtemp(join(temporaryParent, 'yard-terminal-ui-'));
const fixtureEnv = { PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, LANG: 'C.UTF-8', HOME: join(root, 'home'),
  CODEX_HOME: join(root, 'codex'), XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
  XDG_DATA_HOME: join(root, 'xdg-data'), XDG_RUNTIME_DIR: join(root, 'runtime'), TMPDIR: join(root, 'tmp'),
  npm_config_cache: join(root, 'npm-cache'), npm_config_userconfig: join(root, 'user.npmrc'),
  npm_config_globalconfig: join(root, 'global.npmrc') };
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, fixtureEnv);
await Promise.all([fixtureEnv.HOME, fixtureEnv.CODEX_HOME, fixtureEnv.XDG_CONFIG_HOME, fixtureEnv.XDG_CACHE_HOME,
  fixtureEnv.XDG_DATA_HOME, fixtureEnv.XDG_RUNTIME_DIR, fixtureEnv.TMPDIR, fixtureEnv.npm_config_cache]
  .map(path => mkdir(path, { recursive: true, mode: 0o700 })));
const output = requestedOutput ? resolve(requestedOutput) : await mkdtemp(join(temporaryParent, 'yard-terminal-evidence-'));
assert.ok(output !== root && !output.startsWith(root + '/'), 'Evidence must be outside the disposable fixture');
await mkdir(output, { recursive: true });
const remoteRoot = join(root, 'remote-project');
await mkdir(remoteRoot);
const localFake = await createFakeCodex(root);
const remoteHost = 'remote-ssh-discovered:terminal-fixture';
const projectFilter = process.argv.find(value => value.startsWith('--project='))?.slice('--project='.length);
const targets = [
  { hostId: 'local', projectId: 'fixture-local', label: 'Local terminal fixture', cwd: root },
  ...(requestedSsh ? [{ hostId: remoteHost, projectId: 'fixture-ssh', label: 'SSH terminal fixture', cwd: remoteRoot }] : []),
].filter(target => !projectFilter || projectFilter === target.projectId);
let sshFixture: TerminalSshFixture | undefined;
let sshConnections = 0, sshPathsVerified = false;
const sshStreams = new Set<Duplex>();
const processes = new Map<string, { child: ChildProcessWithoutNullStreams; owner: string; pid?: number }>();
const ownedPids = new Set<number>();
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
let checks: string[] = [], gaps: string[] = [], errors: string[] = [];
let requests: { operation: string; args: unknown[] }[] = [];
let events: { at: number; event: TerminalEvent }[] = [];
let connections: { hostId: string; state: string }[] = [];
let sockets: { page: WebSocketRoute; server: WebSocketRoute; connected: boolean }[] = [];
type InnerRpc = { connection: number; kind: 'request' | 'event'; method: string; handle?: string;
  cwd?: string; tty?: boolean; command?: string[]; size?: unknown; bytes?: number; interrupt?: boolean;
  outcome?: 'pending' | 'success' | 'error'; exitCode?: unknown };
let innerRpc: InnerRpc[] = [];
const connectionIds = new WeakMap<CodexConnection, number>();
let nextConnectionId = 0;
function connectionId(connection: CodexConnection) {
  let id = connectionIds.get(connection);
  if (!id) { id = ++nextConnectionId; connectionIds.set(connection, id); }
  return id;
}
const originalRequest = CodexConnection.prototype.requestWithCursor;
const originalReceive = CodexConnection.prototype.receive;
CodexConnection.prototype.requestWithCursor = function (this: CodexConnection, method: string, params?: unknown, options?: RequestOptions): Promise<RpcResult<unknown>> {
  const pending = originalRequest.call(this, method, params, options);
  if (this.connectStream && method.startsWith('process/')) {
    const value = params && typeof params === 'object' ? params as Record<string, unknown> : {};
    const bytes = typeof value.deltaBase64 === 'string' ? Buffer.from(value.deltaBase64, 'base64') : undefined;
    const entry: InnerRpc = { connection: connectionId(this), kind: 'request', method, outcome: 'pending',
      ...(typeof value.processHandle === 'string' ? { handle: value.processHandle } : {}),
      ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
      ...(typeof value.tty === 'boolean' ? { tty: value.tty } : {}),
      ...(Array.isArray(value.command) && value.command.every(item => typeof item === 'string') ? { command: value.command as string[] } : {}),
      ...(value.size ? { size: value.size } : {}),
      ...(bytes ? { bytes: bytes.length, interrupt: bytes.includes(3) } : {}) };
    innerRpc.push(entry);
    void pending.then(() => { entry.outcome = 'success'; }, () => { entry.outcome = 'error'; });
  }
  return pending;
} as typeof originalRequest;
CodexConnection.prototype.receive = function (this: CodexConnection, data, sourceSocket) {
  if (this.connectStream && (!sourceSocket || sourceSocket === this.socket)) {
    try {
      const value = JSON.parse(String(data)) as { id?: unknown; method?: unknown; params?: { processHandle?: unknown; exitCode?: unknown } };
      if (value.id == null && (value.method === 'process/outputDelta' || value.method === 'process/exited') && typeof value.params?.processHandle === 'string') {
        innerRpc.push({ connection: connectionId(this), kind: 'event', method: value.method, handle: value.params.processHandle,
          ...(value.method === 'process/exited' ? { exitCode: value.params.exitCode } : {}) });
      }
    } catch { /* Observation must not affect the production connection. */ }
  }
  return originalReceive.call(this, data, sourceSocket);
};
type ShortcutObservation = { at: number; hostId: string | null; connection: string | null; state: string | null;
  focus: { tag: string; label: string | null; className: string } | null; defaultPrevented?: boolean };
const results: { hostId: string; projectId: string; cwd: string; checks: string[]; gaps: string[]; errors: string[];
  requests: typeof requests; events: typeof events; connections: typeof connections; innerRpc: InnerRpc[]; firstShortcut?: ShortcutObservation | null;
  unavailableShortcut?: ShortcutObservation | null }[] = [];
const report: Record<string, unknown> = { renderer: 'owned', localPeer: 'synthetic local RPC with a real disposable local PTY',
  requestedSsh, realDaemonUsed: false, realSshUsed: false, physicalRemoteMachine: false, realInference: false, results };

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
  assert.ok(!requestedSsh || targets.some(target => target.hostId === remoteHost), '--ssh requires the fixture-ssh project');
  for (const target of [{ hostId: 'local', cwd: root, fake: localFake }]) {
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
  if (requestedSsh) {
    let binary = requestedBinary;
    if (!binary) {
      try { binary = (await promisify(execFile)('which', ['codex'], { env: { PATH: inheritedEnv.PATH ?? '' } })).stdout.trim(); }
      catch (error) { throw new Error('--ssh requires an actual Codex CLI; set AGENTS_TERMINAL_CODEX_BIN: ' + String(error)); }
    }
    assert.ok(binary, '--ssh requires an actual Codex CLI; set AGENTS_TERMINAL_CODEX_BIN to its executable');
    sshFixture = new TerminalSshFixture(root, remoteRoot, binary);
    try { await sshFixture.start(); }
    catch (error) { throw new Error('Actual --ssh CLI/sshd setup failed: ' + String(error)); }
    report.cliVersion = sshFixture.version;
    report.daemon = sshFixture.daemon;
    report.sshIdentity = sshFixture.identity;
    report.daemonNetworkNamespace = sshFixture.daemonNetworkNamespace;
    process.env.PATH = `${sshFixture.bin}:${fixtureEnv.PATH}`;
  }
  app = await createNativeWorkbench({ port: 0, workspace: root, dataDir: join(root, 'data'), codexHome: join(root, 'codex'),
    socketPath: localFake.socketPath,
    hostCatalog: { hosts: sshFixture?.host ? [sshFixture.host] : [],
      projects: sshFixture?.host ? [{ hostId: remoteHost, id: 'fixture-ssh', label: 'SSH terminal fixture', remotePath: remoteRoot }] : [], assignments: {} },
    sshStream: (host, onPaths) => {
      assert.equal(host.hostId, remoteHost);
      assert.ok(sshFixture);
      sshConnections++;
      const stream = createSshProxyStream(host, paths => {
        assert.deepEqual(paths, { homeDirectory: sshFixture!.home, codexHome: sshFixture!.codexHome });
        sshPathsVerified = true;
        onPaths?.(paths);
      });
      sshStreams.add(stream);
      stream.once('close', () => sshStreams.delete(stream));
      return stream;
    },
    httpFetch: async () => new Response('External requests disabled for terminal fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: chromePath,
    headless: true, env: fixtureEnv, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  for (const target of targets) {
    checks = []; gaps = []; errors = []; requests = []; events = []; connections = []; sockets = []; innerRpc = [];
    results.push({ hostId: target.hostId, projectId: target.projectId, cwd: target.cwd, checks, gaps, errors, requests, events, connections, innerRpc });
    const localSpawnCount = localFake.calls('process/spawn').filter(call => call.params.tty === true).length;
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => {
      window.addEventListener('keydown', event => {
        if (!event.ctrlKey || event.code !== 'Backquote') return;
        const host = document.querySelector<HTMLSelectElement>('select[aria-label="Execution host"]');
        const connection = document.querySelector('.yard-connection');
        const focus = document.activeElement;
        const observation: ShortcutObservation = {
          at: Date.now(), hostId: host?.value ?? null, connection: connection?.getAttribute('title') ?? null,
          state: connection?.getAttribute('data-state') ?? null,
          focus: focus ? { tag: focus.tagName, label: focus.getAttribute('aria-label'), className: String(focus.className) } : null,
        };
        (window as Window & { yardTerminalShortcut?: ShortcutObservation }).yardTerminalShortcut = observation;
        setTimeout(() => { observation.defaultPrevented = event.defaultPrevented; }, 0);
      }, true);
    });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
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
          // The page WebSocket reconnects through local first; the selected SSH
          // connection is opened by the next explicit host operation.
          if (message.hostId === 'local' && message.state === 'connected') socket.connected = true;
        }
        route.send(raw);
      });
    });
    await page.goto(app.url + '/?hostId=' + encodeURIComponent(target.hostId), { waitUntil: 'commit' });
    await page.locator('[data-owned-renderer="true"]').waitFor();
    const projectAction = page.getByRole('button', { name: `New chat in ${target.label}`, exact: true });
    await projectAction.click({ timeout: 60000 });
    await page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作|Work with Codex)$/ }).waitFor();
    await page.locator('.yard-connection[data-state="connected"]').waitFor({ timeout: 30000 });
    const terminal = page.locator('.yard-terminal-container:visible .xterm-helper-textarea');
    async function waitForNewTerminal(previousCount: number) {
      await until(() => requests.filter(request => request.operation === 'create').length > previousCount, 'new terminal request');
      const create = requests.filter(request => request.operation === 'create').at(-1)!;
      const sessionId = (create.args[0] as { sessionId: string }).sessionId;
      await until(() => events.some(({ event }) => event.type === 'attached' && event.sessionId === sessionId), 'new terminal attached');
    }
    async function checkShortcutFocus(action: string) {
      try {
        await until(async () => await terminal.count() === 1 && await terminal.evaluate(element => document.activeElement === element),
          'terminal focus after shortcut', 1000);
      } catch { gaps.push(`Ctrl+Backquote did not focus the terminal after ${action}`); }
    }
    async function open() {
      const before = requests.filter(request => request.operation === 'create').length;
      await page!.getByRole('button', { name: 'Open terminal', exact: true }).click();
      await terminal.waitFor({ state: 'attached' });
      await waitForNewTerminal(before);
    }
    async function command(value: string) {
      await until(async () => {
        await page!.locator('.yard-terminal-container:visible .xterm-screen').click();
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
      const value = Number(new RegExp(label + '=(\\d+)').exec(text())![1]);
      assert.ok(Number.isSafeInteger(value) && value > 1); ownedPids.add(value); return value;
    }
    async function child(label: string) {
      await command(`sleep 60 & printf '${label}=%s\\n' "$!"`);
      await until(() => new RegExp(label + '=\\d+').test(text()), label);
      const value = Number(new RegExp(label + '=(\\d+)').exec(text())![1]);
      assert.ok(Number.isSafeInteger(value) && value > 1); ownedPids.add(value); return value;
    }
    async function checkTarget(label: string) {
      await command(`printf '${label}_HOST=%s\\n${label}_CWD=%s\\n' "$(hostname)" "$(pwd -P)"`);
      await waitText(label + '_HOST=' + hostname());
      await waitText(label + '_CWD=' + await realpath(target.cwd));
    }
    assert.equal(requests.filter(request => request.operation === 'create').length, 0, 'No terminal may start before an explicit action');
    await page.keyboard.press('Control+Backquote');
    results.at(-1)!.firstShortcut = await page.evaluate(() =>
      (window as Window & { yardTerminalShortcut?: ShortcutObservation }).yardTerminalShortcut ?? null);
    await delay(1000);
    if (!requests.some(request => request.operation === 'create')) {
      gaps.push('Ctrl+Backquote did not explicitly open the first terminal');
      await open();
    } else {
      await waitForNewTerminal(0);
      await checkShortcutFocus('opening it');
    }
    const create = requests.find(request => request.operation === 'create')!;
    assert.equal((create.args[0] as { hostId: string }).hostId, target.hostId);
    assert.equal((create.args[0] as { cwd: string }).cwd, target.cwd);
    if (target.hostId === 'local') {
      assert.ok(localFake.calls('process/spawn').some(call => call.params.tty === true && call.params.cwd === target.cwd));
    } else {
      assert.ok(sshConnections > 0 && sshPathsVerified, 'Actual SSH proxy must report the disposable remote homes');
      assert.equal(localFake.calls('process/spawn').filter(call => call.params.tty === true).length, localSpawnCount);
      await until(() => innerRpc.some(call => call.method === 'process/spawn' && call.tty === true && call.cwd === target.cwd && call.outcome === 'success'),
        'actual SSH PTY spawn RPC');
      const spawn = innerRpc.find(call => call.method === 'process/spawn' && call.tty === true && call.cwd === target.cwd && call.outcome === 'success')!;
      assert.match(spawn.handle ?? '', /^workbench-terminal-[0-9a-f-]+$/);
      assert.deepEqual(spawn.command?.slice(0, 2), ['/bin/sh', '-c']);
      await until(() => innerRpc.some(call => call.kind === 'event' && call.method === 'process/outputDelta'
        && call.connection === spawn.connection && call.handle === spawn.handle), 'actual SSH PTY output notification');
      report.realDaemonUsed = true; report.realSshUsed = true;
    }
    await checkTarget('TW');
    const initialPid = await pid('TW_PID');
    checks.push(target.hostId === 'local' ? 'Selected project opens a real local PTY in its cwd through the synthetic local peer'
      : 'Selected project opens a real PTY in its cwd through actual loopback SSH, production proxy and isolated CLI daemon');
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
    if (target.hostId !== 'local') {
      const spawn = innerRpc.find(call => call.method === 'process/spawn' && call.tty === true && call.cwd === target.cwd && call.outcome === 'success')!;
      await until(() => innerRpc.some(call => call.method === 'process/writeStdin' && call.connection === spawn.connection
        && call.handle === spawn.handle && call.outcome === 'success' && call.interrupt), 'actual SSH Ctrl+C RPC');
      await until(() => innerRpc.some(call => call.method === 'process/resizePty' && call.connection === spawn.connection
        && call.handle === spawn.handle && call.outcome === 'success'
        && JSON.stringify(call.size) === JSON.stringify({ rows: size.args[2], cols: size.args[1] })), 'actual SSH resize RPC');
      checks.push('Actual SSH CLI acknowledged PTY spawn, input including Ctrl+C, resize and output notifications on the same handle');
    }
    checks.push('Real PTY multiline and streaming output, Ctrl+C and kernel dimensions');
    await page.getByRole('button', { name: /^(隐藏面板|Hide panel)$/ }).click();
    await page.getByRole('button', { name: 'Workspace files', exact: true }).click();
    assert.equal(await pid('TW_HIDE_REVEAL'), initialPid);
    assert.equal(requests.filter(request => request.operation === 'create').length, 1);
    checks.push('Hiding and revealing the panel preserves the same shell');
    await page.setViewportSize({ width: 390, height: 780 });
    const hideAtMobile = page.getByRole('button', { name: /^(隐藏面板|Hide panel)$/ });
    const hideBox = await hideAtMobile.boundingBox();
    assert.ok(hideBox && hideBox.x >= 0 && hideBox.x + hideBox.width <= 390, 'The hide control must remain reachable on a narrow screen');
    await hideAtMobile.click();
    const closeSidebar = page.getByRole('button', { name: 'Close sidebar', exact: true });
    if (await closeSidebar.isVisible()) await closeSidebar.click();
    await page.getByRole('button', { name: 'Workspace files', exact: true }).click();
    assert.equal(await pid('TW_MOBILE_REVEAL'), initialPid);
    assert.equal(requests.filter(request => request.operation === 'create').length, 1);
    checks.push('Narrow-screen hide and reveal controls preserve the same shell');
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
    await waitForNewTerminal(1);
    const secondPid = await pid('TW_SECOND');
    assert.notEqual(secondPid, initialPid);
    const terminalTabs = page.locator('.yard-panel-tab').filter({ has: page.getByRole('tab', { name: 'Terminal' }) });
    await command('exit');
    await stopped(secondPid);
    await page.getByRole('button', { name: 'New terminal', exact: true }).waitFor();
    await page.keyboard.press('Control+Backquote');
    try {
      await until(async () => await terminalTabs.first().getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected') === 'true',
        'shortcut selects an existing live terminal', 1000);
      await checkShortcutFocus('selecting an existing shell');
      checks.push('Shortcut selects a live shell instead of restarting the stopped tab');
    } catch {
      gaps.push('Ctrl+Backquote did not select the existing live shell when another tab had exited');
      await terminalTabs.first().getByRole('tab', { name: 'Terminal' }).click();
    }
    assert.equal(await pid('TW_FIRST_AGAIN'), initialPid);
    await terminalTabs.last().getByRole('button', { name: 'Close terminal' }).click();
    await until(async () => await page!.getByRole('tab', { name: 'Terminal' }).count() === 1, 'second terminal tab closes');
    assert.equal(requests.filter(request => request.operation === 'create').length, 2);
    checks.push('Explicit new terminal opens another shell; switching tabs preserves the first');
    await page.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
    await page.getByRole('button', { name: 'Workspace files', exact: true }).click();
    assert.equal(await pid('TW_SAME'), initialPid);
    assert.equal(requests.filter(request => request.operation === 'create').length, 2);
    checks.push('Switching away and back preserves the same shell');
    const backgroundPid = await child('TW_CHILD');
    await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
    await stopped(initialPid); await stopped(backgroundPid);
    if (target.hostId !== 'local') {
      const spawn = innerRpc.find(call => call.method === 'process/spawn' && call.tty === true && call.cwd === target.cwd && call.outcome === 'success')!;
      await until(() => innerRpc.some(call => call.kind === 'event' && call.method === 'process/exited'
        && call.connection === spawn.connection && call.handle === spawn.handle), 'actual SSH shell exit notification');
      await until(() => innerRpc.some(call => call.method === 'process/spawn' && call.connection === spawn.connection && call.outcome === 'success'
        && JSON.stringify(call.command) === JSON.stringify(['/bin/kill', '-HUP', '--', String(initialPid)])), 'actual SSH shell hangup RPC');
      checks.push('Actual SSH CLI acknowledged the shell hangup and reported the original PTY exit');
    }
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
    if (!await projectAction.isVisible()) await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await projectAction.click({ timeout: 60000 });
    await stopped(beforeReload); await stopped(reloadChild);
    await until(async () => await page!.getByRole('combobox', { name: 'Execution host' }).inputValue() === target.hostId
      && await page!.locator('.yard-connection').getAttribute('data-state') === 'connected'
      && (await page!.locator('.yard-connection').getAttribute('title'))?.includes('Host: connected') === true,
    'selected host ready after reload');
    await open();
    const afterReload = await pid('TW_AFTER_RELOAD');
    assert.notEqual(afterReload, beforeReload);
    assert.equal(text().split('TW_ONCE\r\n').length - 1, 1);
    await checkTarget('TW_RELOAD');
    checks.push('Exit and reload clean up processes; input is not replayed');
    const disconnectChild = await child('TW_DISCONNECT_CHILD');
    const createCount = requests.filter(request => request.operation === 'create').length;
    const writeCount = requests.filter(request => request.operation === 'write').length;
    const innerWriteCount = innerRpc.filter(call => call.method === 'process/writeStdin').length;
    const remoteConnectedCount = connections.filter(connection => connection.hostId === target.hostId && connection.state === 'connected').length;
    const socketCount = sockets.length, socket = sockets.at(-1)!;
    await Promise.all([socket.page.close({ code: 1012, reason: 'isolated terminal reconnect' }), socket.server.close()]);
    await stopped(afterReload); await stopped(disconnectChild);
    await until(() => sockets.length > socketCount && sockets.at(-1)!.connected, 'host reconnect');
    assert.equal(requests.filter(request => request.operation === 'create').length, createCount);
    assert.equal(requests.filter(request => request.operation === 'write').length, writeCount, 'Reconnect must not replay terminal input');
    if (target.hostId !== 'local') assert.equal(innerRpc.filter(call => call.method === 'process/writeStdin').length, innerWriteCount,
      'Reconnect must not replay input to the actual SSH CLI');
    await page.keyboard.press('Control+Backquote');
    await delay(1000);
    const reopenedByShortcut = requests.filter(request => request.operation === 'create').length > createCount;
    if (!reopenedByShortcut) {
      gaps.push('Ctrl+Backquote did not explicitly open a replacement terminal after reconnect');
      await page.getByRole('button', { name: 'New terminal', exact: true }).click();
    }
    await waitForNewTerminal(createCount);
    if (reopenedByShortcut) await checkShortcutFocus('reopening it after reconnect');
    if (target.hostId !== 'local') assert.ok(connections.filter(connection => connection.hostId === target.hostId && connection.state === 'connected').length > remoteConnectedCount,
      'The explicit replacement must reconnect the selected SSH host');
    const reconnectedPid = await pid('TW_AFTER_RECONNECT');
    assert.notEqual(reconnectedPid, afterReload);
    await checkTarget('TW_RECONNECT');
    await page.getByRole('button', { name: /^(隐藏面板|Hide panel)$/ }).click();
    await page.keyboard.press('Control+Backquote');
    try {
      await page.locator('.yard-terminal-container:visible .xterm-screen').waitFor({ state: 'visible', timeout: 1000 });
      await checkShortcutFocus('revealing an existing shell');
    }
    catch {
      gaps.push('Ctrl+Backquote did not reveal the existing terminal');
      await page.getByRole('button', { name: 'Workspace files', exact: true }).click();
    }
    assert.equal(await pid('TW_SHORTCUT_SAME'), reconnectedPid);
    assert.equal(requests.filter(request => request.operation === 'create').length, createCount + 1);
    assert.equal(text().split('TW_ONCE\r\n').length - 1, 1, 'Earlier terminal input must not be replayed after reconnect');
    if (target.hostId !== 'local') assert.equal(localFake.calls('process/spawn').filter(call => call.params.tty === true).length, localSpawnCount);
    checks.push('Disconnect reaps processes; reconnect does not replay input or automatically create a shell');
    const beforeUnavailable = requests.filter(request => request.operation === 'create').length;
    if (target.hostId === 'local') localFake.disconnectAll();
    else for (const stream of sshStreams) stream.destroy();
    try {
      await until(async () => (await page!.locator('.yard-connection').getAttribute('title'))?.includes('Host: disconnected') === true,
        'selected host disconnected while the browser is connected', 5000);
      const reconnect = page.getByRole('button', { name: 'Reconnect host', exact: true });
      if (!await reconnect.isVisible()) gaps.push('Disconnected host does not offer an explicit Reconnect host action');
      await page.keyboard.press('Control+Backquote');
      await delay(100);
      const unavailableShortcut = await page.evaluate(() =>
        (window as Window & { yardTerminalShortcut?: ShortcutObservation }).yardTerminalShortcut ?? null);
      results.at(-1)!.unavailableShortcut = unavailableShortcut;
      if (!unavailableShortcut?.defaultPrevented) gaps.push('Ctrl+Backquote was not consumed while the host was unavailable');
      const feedback = async () => (await page!.locator('[role="alert"]:visible, [role="status"]:visible').allTextContents())
        .some(text => /terminal|host|终端|主机/i.test(text) && /unavailable|connect|disconnect|不可用|连接|断开/i.test(text));
      if (!await feedback()) gaps.push('Unavailable terminal shortcut did not show a clear connection message');
      const toolbar = page.getByRole('button', { name: 'Open terminal', exact: true });
      if (await toolbar.isEnabled()) {
        await toolbar.click();
        if (!await feedback()) gaps.push('Unavailable terminal button did not clearly reject the action');
      }
      if (requests.filter(request => request.operation === 'create').length !== beforeUnavailable) {
        gaps.push('An unavailable terminal action issued a create request');
      }
      await capture(target.projectId + '-host-unavailable');
      if (await reconnect.isVisible()) {
        const beforeReconnect = requests.filter(request => request.operation === 'create').length;
        await reconnect.click();
        await page.locator('.yard-connection[data-state="connected"]').waitFor({ timeout: 30000 });
        assert.equal(requests.filter(request => request.operation === 'create').length, beforeReconnect,
          'Reconnecting must not automatically create a terminal');
        checks.push('Explicit host reconnect does not automatically create a shell');
      } else gaps.push('Explicit host reconnect could not be verified after the unavailable actions');
    } catch (error) {
      gaps.push('Disconnected host shortcut/reconnect verification: ' + String(error));
      await capture(target.projectId + '-host-unavailable-failure').catch(() => {});
    }
    await capture(target.projectId + '-terminal');
    assert.deepEqual(errors, []);
    await page.close();
    page = undefined;
  }
  assert.deepEqual(results.flatMap(result => result.gaps.map(gap => result.projectId + ': ' + gap)), [],
    'Original terminal behavior and requested SSH coverage must be available for each selected project');
  assert.ok(!requestedSsh || (report.realSshUsed === true && report.realDaemonUsed === true), '--ssh requires an actual SSH CLI session');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  CodexConnection.prototype.requestWithCursor = originalRequest;
  CodexConnection.prototype.receive = originalReceive;
  const cleanupErrors: string[] = [];
  try { await browser?.close(); } catch (error) { cleanupErrors.push('browser: ' + String(error)); }
  try { await app?.close(); } catch (error) { cleanupErrors.push('app: ' + String(error)); }
  try { await localFake.close(); } catch (error) { cleanupErrors.push('local fixture: ' + String(error)); }
  for (const process of processes.values()) if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill('SIGTERM');
  await Promise.all([...processes.values()].map(async ({ child }) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise<void>(resolve => child.once('exit', () => resolve())); }
  }));
  try { await sshFixture?.close(); } catch (error) { cleanupErrors.push('SSH fixture: ' + String(error)); }
  if (sshFixture) report.sshCleanup = sshFixture.cleanup;
  for (const pid of ownedPids) {
    try {
      if (!await running(pid)) continue;
      const env = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0');
      assert.ok(env.includes('HOME=' + fixtureEnv.HOME) && env.includes('CODEX_HOME=' + fixtureEnv.CODEX_HOME), 'Process no longer belongs to the disposable fixture');
      process.kill(pid, 'SIGTERM');
      await stopped(pid);
    } catch (error) { cleanupErrors.push(`fixture process ${pid}: ${String(error)}`); }
  }
  report.sshConnections = sshConnections;
  if (cleanupErrors.length) {
    report.ok = false; report.cleanupErrors = cleanupErrors; report.retainedFixture = root; process.exitCode = 1;
  } else {
    assert.ok(root.startsWith(join(temporaryParent, 'yard-terminal-ui-')));
    try { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); report.fixtureRemoved = true; }
    catch (error) { report.ok = false; report.cleanupErrors = [String(error)]; report.retainedFixture = root; process.exitCode = 1; }
  }
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, inheritedEnv);
  console.log('Terminal UI evidence:', output);
}
