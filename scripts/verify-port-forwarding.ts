// Disposable OpenSSH server, CLI backend and browser. No personal keys or
// accounts are used; even session commands on the SSH fixture are disabled.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { PortForwarding } from '../src/native/port-forwarding.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { SshHost } from '../src/native/ssh.ts';

const execute = promisify(execFile), root = await mkdtemp('/tmp/yard-forward-cli-');
const output = resolve(process.env.AGENTS_PORT_FORWARDING_EVIDENCE ?? '.local/port-forwarding');
const originalPath = process.env.PATH;
const checks: string[] = [], errors: string[] = [], children: ChildProcess[] = [];
const report: Record<string, unknown> = { checks, errors };
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, browser: Browser | undefined, page: Page | undefined;
let manager: PortForwarding | undefined, sshLog = '', cliLog = '', providerRequests = 0;
await mkdir(output, { recursive: true });
async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return (server.address() as import('node:net').AddressInfo).port;
}
async function stop(server: Server) { await new Promise<void>(resolve => server.close(() => resolve())); }
async function unusedPort() { const server = createServer(), port = await listen(server); await stop(server); return port; }
async function waitFor(read: () => Promise<boolean>, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await read()) return; await delay(100); }
  throw new Error('Fixture timed out');
}
const source = httpServer((_request, response) => { response.end('YARD_SSH_FORWARD_OK'); });
const provider = httpServer((_request, response) => { providerRequests++; response.writeHead(503); response.end('No model calls expected'); });
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  const servicePort = await listen(source), providerPort = await listen(provider), sshPort = await unusedPort();
  const localPort = await unusedPort(), hostKey = join(root, 'host-key'), clientKey = join(root, 'client-key');
  await execute('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey]);
  await execute('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', clientKey]);
  await writeFile(join(root, 'authorized_keys'), await readFile(clientKey + '.pub'), { mode: 0o600 });
  await writeFile(join(root, 'known_hosts'), `[127.0.0.1]:${sshPort} ${await readFile(hostKey + '.pub', 'utf8')}`, { mode: 0o600 });
  await writeFile(join(root, 'sshd.conf'), `Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${hostKey}\nPidFile ${root}/sshd.pid\nAuthorizedKeysFile ${root}/authorized_keys\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes no\nAllowTcpForwarding yes\nGatewayPorts no\nPermitTTY no\nForceCommand /bin/false\n`, { mode: 0o600 });
  const sshd = spawn(process.env.AGENTS_TEST_SSHD ?? '/usr/sbin/sshd', ['-D', '-e', '-f', join(root, 'sshd.conf')], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(sshd); sshd.stdout.on('data', chunk => { sshLog += chunk; }); sshd.stderr.on('data', chunk => { sshLog += chunk; });
  await waitFor(async () => { if (sshd.exitCode !== null) throw new Error(sshLog); return sshLog.includes('Server listening'); });
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin', 'ssh'), `#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(join(root, 'known_hosts'))} -o IdentitiesOnly=yes "$@"\n`, { mode: 0o700 });
  process.env.PATH = join(root, 'bin') + ':' + originalPath;
  const host = (hostId: string, displayName: string): SshHost => ({ hostId, displayName, sshAlias: null,
    sshHost: `${userInfo().username}@127.0.0.1`, sshPort, identity: clientKey });
  const hosts = [host('remote-ssh-source-fixture', '开发机（SSH 测试）'), host('remote-ssh-receiver-fixture', 'Pad6（SSH 测试）'),
    host('remote-ssh-laptop-fixture', '电脑（SSH 测试）')];
  manager = new PortForwarding({ hosts: new Map(hosts.map(host => [host.hostId, host])), save: async () => {} });
  const rule = { id: 'ssh-fixture', name: 'SSH fixture', sourceHostId: hosts[0].hostId, targetHostId: hosts[1].hostId,
    serviceHost: '127.0.0.1', servicePort, localPort };
  await manager.request({ operation: 'save', rule });
  await manager.request({ operation: 'start', id: rule.id });
  assert.equal(await fetch(`http://127.0.0.1:${localPort}`).then(response => response.text()), 'YARD_SSH_FORWARD_OK');
  checks.push('Real OpenSSH source channel and receiver reverse listener carry HTTP through Yard');
  assert.doesNotMatch(JSON.stringify(manager.snapshot()), /client-key|authorized_keys/);
  await manager.request({ operation: 'stop', id: rule.id });
  const occupied = createServer(); await listen(occupied, localPort);
  try { await assert.rejects(manager.request({ operation: 'start', id: rule.id }), /forwarding failed|转发|SSH/i); }
  finally { await stop(occupied); }
  checks.push('Occupied remote listener reports SSH failure and stop releases the receiver port');
  await manager.close(); manager = undefined;

  const codexHome = join(root, 'codex'), dataDir = join(root, 'data');
  await mkdir(codexHome); await mkdir(dataDir);
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Forwarding fixture', path: root }]));
  await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Port forwarding fixture"\nbase_url = "http://127.0.0.1:${providerPort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\ncode_mode = false\n`, { mode: 0o600 });
  const socketPath = join(root, 'backend.sock');
  const cli = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
    env: { PATH: originalPath, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(cli); cli.stdout.on('data', chunk => { cliLog += chunk; }); cli.stderr.on('data', chunk => { cliLog += chunk; });
  await waitFor(async () => { if (cli.exitCode !== null) throw new Error(cliLog); try { await access(socketPath); return true; } catch { return false; } });
  const appOptions = { port: 0, dataDir, workspace: root, socketPath, codexHome,
    hostCatalog: { hosts, projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) };
  app = await createNativeWorkbench(appOptions); report.cli = app.control.server?.userAgent;
  browser = process.env.AGENTS_TEST_BROWSER_WS ? await chromium.connect(process.env.AGENTS_TEST_BROWSER_WS)
    : await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  async function newPage(owner = context) {
    const result = await owner.newPage(); result.on('pageerror', error => errors.push(error.message));
    await result.addLocatorHandler(result.getByRole('button', { name: 'Continue with current model', exact: true }), async button => { await button.click(); });
    return result;
  }
  page = await newPage();
  async function openManager() {
    const trigger = page!.locator('#app-shell-sidebar button[aria-haspopup="menu"]').filter({ has: page!.locator('svg[viewBox="0 0 53.225983 18"]') });
    await trigger.click({ timeout: 45000 });
    const item = page!.getByRole('menuitem', { name: /端口转发管理/ });
    await item.waitFor();
    assert.equal(await page!.getByRole('menuitem', { name: /ChatGPT Work/ }).count(), 0);
    await page!.getByRole('menuitem', { name: /^Codex/ }).waitFor();
    await item.click();
    await page!.getByRole('dialog', { name: '端口转发管理' }).waitFor();
    await page!.getByLabel('本设备', { exact: true }).locator(`option[value="${hosts[1].hostId}"]`).waitFor({ state: 'attached' });
  }
  let capturedDeviceSettings = false;
  async function selectDevice(id: string) {
    const settings = page!.locator('.yard-forward-settings');
    const isAssociated = await settings.count() > 0;
    if (isAssociated) await settings.locator('summary').click();
    if (isAssociated && !capturedDeviceSettings) {
      await page!.screenshot({ path: join(output, 'device-settings.png') });
      const panel = await settings.locator('.yard-forward-popover').boundingBox(), dialog = await page!.getByRole('dialog').boundingBox();
      assert.ok(panel && dialog && panel.y + panel.height <= dialog.y + dialog.height, 'device settings remain inside the dialog when there are no rules');
      capturedDeviceSettings = true;
    }
    await page!.getByLabel('本设备', { exact: true }).selectOption(id);
    if (id) await settings.locator('summary').evaluate(element => element.parentElement!.removeAttribute('open'));
  }
  async function openActions() { await page!.getByLabel('更多操作', { exact: true }).click(); }
  await page.goto(app.url, { waitUntil: 'commit' });
  await openManager();
  assert.equal(await page.getByLabel('本设备', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('[data-forward-id]').count(), 0);
  assert.equal(await page.getByLabel('按接收设备筛选').count(), 0);
  assert.equal(await page.getByRole('button', { name: '新增服务', exact: true }).count(), 0);
  await page.screenshot({ path: join(output, 'setup.png') });
  await selectDevice(hosts[1].hostId);
  await page.getByRole('button', { name: '新增服务', exact: true }).click();
  assert.equal(await page.getByLabel('接收设备', { exact: true }).count(), 0);
  await page.getByText('转发到本机 · ' + hosts[1].displayName, { exact: true }).waitFor();
  await page.getByLabel('转发名称').fill('开发服务');
  await page.getByLabel('来源设备', { exact: true }).selectOption(hosts[0].hostId);
  await page.getByLabel('服务端口', { exact: true }).fill(String(servicePort));
  await page.getByLabel('本地端口', { exact: true }).fill(String(localPort));
  await page.getByRole('button', { name: '保存服务', exact: true }).click();
  await page.getByRole('button', { name: '转发到本机', exact: true }).click();
  await page.getByText('转发中', { exact: true }).waitFor({ timeout: 15000 });
  const padPage = page;
  const bounds = await page.getByRole('dialog').boundingBox();
  assert.ok(bounds && Math.abs(bounds.x - (1440 - bounds.width) / 2) < 2, 'management dialog is centered');
  await page.screenshot({ path: join(output, 'desktop-current.png') });
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: '打开网页', exact: true }).click();
  const popup = await popupPromise; await popup.waitForLoadState();
  assert.equal(await popup.locator('body').innerText(), 'YARD_SSH_FORWARD_OK'); await popup.close();
  checks.push('First association fixes the receiver; adding and opening a service need no target selector');

  const laptopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await newPage(laptopContext); const laptopPage = page;
  await page.goto(app.url, { waitUntil: 'commit' }); await openManager();
  assert.equal(await page.locator('[data-forward-id]').count(), 0, 'an unassociated browser must not show other clients');
  await selectDevice(hosts[2].hostId);
  await page.getByText('开发服务', { exact: true }).waitFor();
  await page.getByText('未转发到本机', { exact: true }).waitFor();
  assert.equal(await page.getByText('转发中', { exact: true }).count(), 0, 'Pad activity must not become laptop activity');
  assert.equal(await page.getByRole('button', { name: '打开网页', exact: true }).isDisabled(), true);
  assert.equal(await fetch(`http://127.0.0.1:${localPort}`).then(response => response.text()), 'YARD_SSH_FORWARD_OK');
  // Both test receivers share one loopback sshd. Release that physical port
  // before creating the laptop's instance, then give it a distinct local port.
  await padPage.getByRole('button', { name: '停止', exact: true }).click();
  await padPage.getByText('已停止', { exact: true }).waitFor();
  await page.getByRole('button', { name: '转发到本机', exact: true }).click();
  await page.getByText('转发中', { exact: true }).waitFor({ timeout: 15000 });
  const snapshot = () => page!.evaluate(async () => {
    const host = window as unknown as { workbenchPortForwarding(params: unknown): Promise<{ rules: { id: string; targetHostId: string; status: string }[] }> };
    return host.workbenchPortForwarding({ operation: 'list' });
  });
  let state = await snapshot();
  assert.equal(state.rules.length, 2);
  assert.equal(state.rules.find(rule => rule.targetHostId === hosts[1].hostId)?.status, 'stopped');
  assert.equal(state.rules.find(rule => rule.targetHostId === hosts[2].hostId)?.status, 'running');
  assert.equal(await page.locator('[data-forward-id]').count(), 1, 'one source service is one row across receiver instances');
  await page.screenshot({ path: join(output, 'desktop.png') });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止', { exact: true }).waitFor();
  await openActions(); await page.getByRole('button', { name: '编辑', exact: true }).click();
  const laptopPort = await unusedPort();
  await page.getByLabel('本地端口').fill(String(laptopPort));
  await page.getByRole('button', { name: '保存服务', exact: true }).click();
  await page.getByRole('button', { name: '转发到本机', exact: true }).click();
  await page.getByText('转发中', { exact: true }).waitFor({ timeout: 15000 });
  await padPage.getByRole('button', { name: '转发到本机', exact: true }).click();
  await padPage.getByText('转发中', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await fetch(`http://127.0.0.1:${laptopPort}`).then(response => response.text()), 'YARD_SSH_FORWARD_OK');
  await padPage.close();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止', { exact: true }).waitFor();
  assert.equal(await fetch(`http://127.0.0.1:${localPort}`).then(response => response.text()), 'YARD_SSH_FORWARD_OK');
  state = await snapshot();
  assert.equal(state.rules.find(rule => rule.targetHostId === hosts[1].hostId)?.status, 'running');
  assert.equal(state.rules.find(rule => rule.targetHostId === hosts[2].hostId)?.status, 'stopped');
  checks.push('Separate browsers reuse one service, create independent receivers and stop only their own listener; closing a page preserves forwarding');

  await openActions(); await page.screenshot({ path: join(output, 'desktop-more.png') });
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: join(output, 'desktop-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await selectDevice('');
  assert.equal(await page.locator('[data-forward-id]').count(), 0, 'clearing association must return to setup');
  await selectDevice(hosts[2].hostId);
  await page.getByText('已停止', { exact: true }).waitFor();
  await openActions(); await page.getByRole('button', { name: '编辑', exact: true }).click();
  for (const [name, width, height] of [['mobile', 390, 844], ['tablet', 800, 1280]] as const) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth), false);
    await page.screenshot({ path: join(output, `${name}-edit.png`) });
  }
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.screenshot({ path: join(output, 'tablet.png') });
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  const restartPort = Number(new URL(app.url).port);
  await page.close(); await app.close(); app = await createNativeWorkbench({ ...appOptions, port: restartPort });
  page = await newPage(laptopContext);
  await page.goto(app.url, { waitUntil: 'commit' }); await openManager();
  await page.getByText('已停止', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-forward-id]').count(), 1);
  await openActions(); await page.getByRole('button', { name: '删除本机转发', exact: true }).click();
  await page.getByText('未转发到本机', { exact: true }).waitFor();
  state = await snapshot(); assert.equal(state.rules.length, 1); assert.equal(state.rules[0].targetHostId, hosts[1].hostId);
  checks.push('Deleting a local instance preserves the service and other receivers; association and instances persist across restart');
  await page.close(); page = await newPage();
  await page.goto(app.url, { waitUntil: 'commit' }); await openManager();
  await page.getByText('已停止', { exact: true }).waitFor();
  await openActions(); await page.getByRole('button', { name: '删除本机转发', exact: true }).click();
  await page.getByText('还没有可转发的服务', { exact: true }).waitFor();
  await page.locator('.yard-forward-settings > summary').click();
  await page.getByRole('button', { name: '管理 SSH 设备', exact: true }).click();
  await page.getByRole('heading', { name: 'Connections', exact: true }).waitFor();
  report.settingsUrl = page.url();
  checks.push('Tablet layout, stop/edit/delete, keyboard close, restart persistence and existing SSH settings entry work');
  assert.deepEqual(errors, []); assert.equal(providerRequests, 0);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot().catch(() => 'Page unavailable'));
  }
} finally {
  await browser?.close(); await manager?.close(); await app?.close();
  for (const child of children.reverse()) { child.kill('SIGTERM'); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); }
  await stop(source); await stop(provider);
  process.env.PATH = originalPath;
  report.providerRequests = providerRequests;
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'sshd.log'), sshLog); await writeFile(join(output, 'backend.log'), cliLog);
  await rm(root, { recursive: true, force: true }); console.log(JSON.stringify(report));
}
