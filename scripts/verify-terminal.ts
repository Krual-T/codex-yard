import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page, WebSocketRoute } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { loadHostCatalog } from '../src/native/hosts.ts';
import { sshArguments } from '../src/native/ssh.ts';
import type { TerminalEvent } from '../src/native/terminal-protocol.ts';

// Run the complete service/browser lifecycle under /tmp/agents-workbench-heavy.lock.
// All keyboard input and output use the original renderer and real PTYs.
// Open from project home: no Agent turns or test conversations are created.
// After build: AGENTS_TEST_CHROMIUM=/path/to/chrome
// AGENTS_TEST_CONFIGURATION_SNAPSHOT=/path/to/configuration-snapshot
// flock /tmp/agents-workbench-heavy.lock npm run test:terminal:ui -- --ssh
// Omit --ssh for local only. The snapshot is an optional read-only bootstrap.
// --project=<registered project id> selects one project for a targeted rerun.
const project = resolve(import.meta.dirname, '..');
const workspace = resolve(project, '../..');
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const catalog = await loadHostCatalog(codexHome);
const projectFilter = process.argv.find(value => value.startsWith('--project='))?.slice('--project='.length);
const targets = [{ hostId: 'local', cwd: workspace, projectId: workspace },
  ...(process.argv.includes('--ssh') ? catalog.projects.map(item => ({ hostId: item.hostId, cwd: item.remotePath, projectId: item.id })) : [])]
  .filter(target => !projectFilter || target.projectId === projectFilter);
assert.ok(targets.length, 'No matching registered terminal project');
const output = process.env.AGENTS_TERMINAL_EVIDENCE_DIR || join(project, '.local', 'terminal-evidence', String(Date.now()));
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp('/tmp/aw-tui-');
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ path: workspace, name: 'Terminal UI fixture' }]));
const fixtures: { hostId: string; cwd: string; expectedHost: string; expectedCwd: string; projectId: string }[] = [];
const results: unknown[] = [];
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;

async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= deadline) throw Error('Terminal UI timed out: ' + label); await delay(50); }
}
async function openTerminal(page: Page, dismissedIntro: () => number) {
  // The original + button opens a browser on left click and a tab menu on right click.
  for (;;) {
    const before = dismissedIntro();
    await page.getByRole('button', { name: '新建标签页', exact: true }).first().click({ button: 'right' });
    try { await page.getByRole('menuitem', { name: /^终端/ }).click({ timeout: 3000 }); break; }
    catch (error) {
      // Dismissing the asynchronously shown official model intro also removes
      // this context menu. Reopen only that menu, before any terminal exists.
      if (dismissedIntro() === before || await page.locator('[data-codex-terminal]').count()) throw error;
    }
  }
  await page.locator('[data-codex-terminal] .xterm-helper-textarea').waitFor({ state: 'attached', timeout: 30000 });
}
async function running(fixture: typeof fixtures[number], pid: number) {
  const host = catalog.hosts.find(host => host.hostId === fixture.hostId);
  if (host) {
    const result = await promisify(execFile)('ssh', [...sshArguments(host), `ps -p ${pid} -o stat= || true`], { encoding: 'utf8', timeout: 15000 });
    return /^(?!Z)\S/m.test(result.stdout.trim());
  }
  try { const status = await readFile(`/proc/${pid}/stat`, 'utf8'); return status.slice(status.lastIndexOf(')') + 2)[0] !== 'Z'; }
  catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
}

try {
  for (const target of targets) {
    const host = catalog.hosts.find(host => host.hostId === target.hostId);
    const quotedCwd = "'" + target.cwd.replaceAll("'", "'\\''") + "'";
    const [expectedHost, expectedCwd] = host
      ? (await promisify(execFile)('ssh', [...sshArguments(host), `hostname; cd -- ${quotedCwd} && pwd -P`], { encoding: 'utf8', timeout: 15000 })).stdout.trim().split('\n')
      : [hostname(), await realpath(target.cwd)];
    assert.ok(expectedHost && expectedCwd, 'The selected host must resolve its project directory');
    fixtures.push({ ...target, expectedHost, expectedCwd });
  }
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {
    'remote-connection-auto-connect-by-host-id': Object.fromEntries(fixtures.filter(fixture => fixture.hostId !== 'local').map(fixture => [fixture.hostId, true])) } }));
  app = await createNativeWorkbench({ dataDir, port: 0, workspace });
  browser = await chromium.launch({ headless: true, ...(process.env.AGENTS_TEST_CHROMIUM ? { executablePath: process.env.AGENTS_TEST_CHROMIUM } : {}) });
  for (const [index, fixture] of fixtures.entries()) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const events: { at: number; event: TerminalEvent }[] = [], requests: { operation: string; args: unknown[] }[] = [], errors: string[] = [];
    const sockets: { page: WebSocketRoute; server: WebSocketRoute; connected: boolean }[] = [];
    const checks: string[] = [], inputEvents: unknown[] = [];
    const result = { ...fixture, checks, requests, events, errors, inputEvents };
    results.push(result);
    let introDismissals = 0;
    const currentModel = page.getByRole('button', { name: '继续使用当前模型', exact: true });
    await page.addLocatorHandler(currentModel, async () => { await currentModel.click(); introDismissals++; });
    const open = () => openTerminal(page, () => introDismissals);
    await page.exposeFunction('terminalProbeEvent', (event: unknown) => { inputEvents.push(event); });
    await page.addInitScript(() => {
      for (const type of ['focusin', 'focusout', 'keydown', 'input']) document.addEventListener(type, event => {
        if (!(event.target instanceof Element) || !event.target.matches('.xterm-helper-textarea')) return;
        const probe = window as unknown as { terminalProbeEvent(value: unknown): void };
        probe.terminalProbeEvent({ type, trusted: event.isTrusted, key: event instanceof KeyboardEvent ? event.key : null,
          focused: document.activeElement === event.target });
      }, true);
    });
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
        if (message.type === 'codex-app-server-connection-changed' && message.hostId === 'local' && message.state === 'connected') socket.connected = true;
        route.send(raw);
      });
    });
    const terminal = page.locator('[data-codex-terminal] .xterm-helper-textarea');
    const text = () => events.map(({ event }) => event.type === 'data' ? event.data : '').join('');
    const waitText = (value: string) => until(() => text().includes(value + '\r\n'), value);
    async function command(value: string) {
      // Project initialization can restore composer focus after the terminal's
      // early attached event. Use its visible surface and settle focus before
      // sending any input; never retry a partially submitted command.
      await until(async () => {
        await page.locator('[data-codex-terminal] .xterm-screen').click();
        await delay(100);
        return terminal.evaluate(element => document.activeElement === element);
      }, 'terminal keyboard focus');
      const writes = requests.filter(request => request.operation === 'write').length;
      await page.keyboard.insertText(value);
      await page.keyboard.press('Enter');
      await until(() => requests.filter(request => request.operation === 'write').length > writes, 'keyboard input forwarded to terminal.write');
    }
    async function checkTarget(label: string) {
      await command(`printf '${label}_HOST=%s\\n${label}_CWD=%s\\n' "$(hostname)" "$(pwd -P)"`);
      await waitText(label + '_HOST=' + fixture.expectedHost);
      await waitText(label + '_CWD=' + fixture.expectedCwd);
    }
    async function pid(label: string) {
      await command(`printf '${label}=%s\\n' "$$"`);
      await until(() => new RegExp(label + '=\\d+').test(text()), label);
      return Number(new RegExp(label + '=(\\d+)').exec(text())![1]);
    }
    async function background(label: string) {
      await command(`sleep 60 & printf '${label}=%s\\n' "$!"`);
      await until(() => new RegExp(label + '=\\d+').test(text()), label);
      return Number(new RegExp(label + '=(\\d+)').exec(text())![1]);
    }
    async function stopped(processId: number) { await until(async () => !await running(fixture, processId), 'process must exit: ' + processId); }
    async function ready() {
      const label = fixture.hostId === 'local' ? 'Terminal UI fixture' : catalog.projects.find(project => project.id === fixture.projectId)!.label;
      // The project's new-chat action is revealed only while its row is hovered.
      await page.getByText(label, { exact: true }).first().hover();
      await page.getByRole('button', { name: `在 ${label} 中开始新聊天`, exact: true }).click({ timeout: 30000 });
      await page.locator('[contenteditable="true"]').first().waitFor();
    }
    try {
      await page.goto(app.url + '/?initialRoute=/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await ready();
      await open();
      await until(() => events.some(({ event }) => event.type === 'attached'), 'initial attach');
      await checkTarget('TW');
      const originalPid = await pid('TW_PID');
      checks.push('original tab menu, host, cwd and real shell PID');
      console.log('Terminal UI opened:', fixture.hostId, fixture.cwd);
      await command(`printf 'TW_LINE_A\\nTW_LINE_B\\n'; for i in 1 2 3; do printf 'TW_TICK_%s\\n' "$i"; sleep .4; done`);
      await waitText('TW_TICK_1');
      await page.screenshot({ path: join(output, `${index}-stream-first.png`) });
      await waitText('TW_TICK_3');
      assert.ok(text().includes('TW_LINE_A\r\nTW_LINE_B\r\n'));
      const first = events.find(({ event }) => event.type === 'data' && event.data.includes('TW_TICK_1\r\n'))!;
      const last = events.find(({ event }) => event.type === 'data' && event.data.includes('TW_TICK_3\r\n'))!;
      assert.ok(last.at - first.at >= 400, 'stream output must arrive over time');
      await command(`printf 'TW_RUNNING\\n'; sleep 60`);
      await waitText('TW_RUNNING');
      await page.keyboard.press('Control+c');
      await command(`printf 'TW_INTERRUPTED\\n'`);
      await waitText('TW_INTERRUPTED');
      const previous = requests.filter(request => request.operation === 'resize').at(-1);
      await page.setViewportSize({ width: 1100, height: 800 });
      await until(() => requests.filter(request => request.operation === 'resize').at(-1) !== previous, 'resize request');
      const size = requests.filter(request => request.operation === 'resize').at(-1)!;
      await command(`printf 'TW_SIZE=%s\\n' "$(stty size)"`);
      await waitText(`TW_SIZE=${size.args[2]} ${size.args[1]}`);
      checks.push('multiline input/output, continuous output over time, Ctrl+C and actual PTY dimensions');
      await page.getByRole('button', { name: '隐藏标签页', exact: true }).click();
      await page.getByRole('button', { name: '显示标签页', exact: true }).click();
      assert.equal(await pid('TW_SAME'), originalPid);
      assert.equal(requests.filter(request => request.operation === 'create').length, 1);
      checks.push('hide/reveal preserves one shell');
      await page.screenshot({ path: join(output, `${index}-terminal.png`) });
      const child = await background('TW_CHILD');
      await page.locator('[data-app-shell-tab-close-button]').last().click();
      await stopped(originalPid);
      await stopped(child);
      await open();
      const reopenedPid = await pid('TW_REOPEN');
      assert.notEqual(reopenedPid, originalPid);
      await checkTarget('TW_REOPEN');
      checks.push('tab close reaps shell and child; reopening creates a new shell');
      await command('exit');
      await stopped(reopenedPid);
      await terminal.waitFor({ state: 'detached' });
      await open();
      const beforeRefreshPid = await pid('TW_BEFORE_REFRESH');
      const refreshChild = await background('TW_REFRESH_CHILD');
      await command(`printf 'TW_ONCE\\n'`);
      await waitText('TW_ONCE');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      await stopped(beforeRefreshPid);
      await stopped(refreshChild);
      if (await terminal.count() === 0) await open();
      const afterRefreshPid = await pid('TW_AFTER_REFRESH');
      assert.notEqual(afterRefreshPid, beforeRefreshPid);
      await checkTarget('TW_REFRESH');
      assert.equal(text().split('TW_ONCE\r\n').length - 1, 1);
      checks.push('shell exit, refresh reaps shell and child, no input replay');
      const createCount = requests.filter(request => request.operation === 'create').length;
      const disconnectChild = await background('TW_DISCONNECT_CHILD');
      const socketCount = sockets.length, socket = sockets.at(-1)!;
      await Promise.all([socket.page.close({ code: 1012, reason: 'isolated terminal reconnect test' }), socket.server.close()]);
      await stopped(afterRefreshPid);
      await stopped(disconnectChild);
      await until(() => sockets.length > socketCount && sockets.at(-1)!.connected, 'host reconnect');
      assert.equal(requests.filter(request => request.operation === 'create').length, createCount);
      await page.keyboard.press('Control+Backquote');
      await terminal.waitFor({ state: 'attached' });
      const shortcutPid = await pid('TW_AFTER_RECONNECT');
      assert.notEqual(shortcutPid, afterRefreshPid);
      await checkTarget('TW_RECONNECT');
      await page.keyboard.press('Control+Backquote');
      assert.equal(await pid('TW_SHORTCUT_SAME'), shortcutPid);
      assert.equal(requests.filter(request => request.operation === 'create').length, createCount + 1);
      checks.push('browser connection loss reaps shell and child; reconnect waits for an explicit new terminal');
      checks.push('Ctrl+Backquote uses the original bottom panel and repeated opens reuse one shell');
      await page.screenshot({ path: join(output, `${index}-reconnected.png`) });
      assert.deepEqual(errors, []);
      console.log('Terminal UI verified:', fixture.hostId, fixture.cwd);
    } catch (error) {
      errors.push(String(error));
      await page.screenshot({ path: join(output, `${index}-failure.png`) }).catch(() => {});
      console.error('Terminal UI failure:', (await page.locator('body').innerText()).slice(-1500));
      console.error('Buttons:', (await page.getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).slice(-15));
      throw error;
    } finally {
      await context.close();
      await writeFile(join(output, 'verified.json'), JSON.stringify({ dataDir, results }, null, 2));
    }
  }
  console.log(JSON.stringify({ verified: fixtures.length, output, dataDir }));
} finally {
  await browser?.close();
  await app?.close();
  await rm(dataDir, { recursive: true, force: true });
}
