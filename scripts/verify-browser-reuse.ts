import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

// Hold /tmp/agents-workbench-heavy.lock for this runner's entire lifecycle.
const root = await mkdtemp(join(tmpdir(), 'aw-chrome-'));
const evidence = process.env.AGENTS_BROWSER_EVIDENCE
  ? resolve(process.env.AGENTS_BROWSER_EVIDENCE) : await mkdtemp('/tmp/yard-chrome-evidence-');
await mkdir(evidence, { recursive: true });
const cleanup: (() => Promise<unknown>)[] = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), renderer: 'owned', personalProfile: false, daemonUsed: false };
const errors: string[] = [];
let nativePage: Page | undefined;
let targetPage: Page | undefined;
let clientBPage: Page | undefined;
async function capture(name: string, page = nativePage) {
  if (!page || page.isClosed()) return;
  await page.bringToFront();
  const credentials = page.getByLabel('这台电脑的配对命令');
  let snapshot = await page.locator('body').ariaSnapshot({ timeout: 5000 });
  if (await credentials.count()) {
    const token = (await credentials.inputValue()).match(/--pair '([^']+)'/)?.[1];
    if (token) snapshot = snapshot.replaceAll(token, '(redacted)');
  }
  await writeFile(join(evidence, name + '.txt'), snapshot);
  await page.screenshot({ path: join(evidence, name + '.png'), timeout: 10000, mask: [credentials] });
}
try {
  await import('./build-native.ts');
  const fixture = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Set-Cookie', 'aw_chrome=owned; HttpOnly; SameSite=Strict; Path=/');
    response.end(`<!doctype html><html lang="zh-CN"><title>Chrome 隔离验收</title><style>body{font:20px system-ui;padding:40px;background:#eef5f7}input,button{font:inherit;padding:10px}input{width:300px}</style><h1>Chrome 原版面板验收</h1><p>已有会话：${request.headers.cookie?.includes('aw_chrome=owned') ? '已保留' : '首次建立'}</p><label>测试输入<input aria-label="测试输入"></label><button onclick="document.querySelector('output').textContent='收到：'+document.querySelector('input').value">确认输入</button><p><output>等待输入</output></p></html>`);
  });
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => fixture.close(() => resolve())));
  const fixtureUrl = `http://127.0.0.1:${(fixture.address() as import('node:net').AddressInfo).port}`;
  const fixtureHeaders = await fetch(fixtureUrl + '/headers');
  assert.equal(fixtureHeaders.headers.get('x-frame-options'), 'DENY');
  assert.match(fixtureHeaders.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  const profile = join(root, 'chrome');
  console.log('Starting isolated installed Chromium');
  const chrome = spawn(process.env.AGENTS_TEST_CHROMIUM ?? process.env.AGENTS_TEST_CHROME ?? '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-background-networking', '--disable-dev-shm-usage', '--window-size=1200,900', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    // Match Playwright's default: Chromium 149's old screenshot surface stalls
    // on background tabs. This affects only our temporary test profile.
    '--enable-features=CDPScreenshotNewSurface',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, fixtureUrl + '/before',
  ], { stdio: 'ignore' });
  const exited = once(chrome, 'exit');
  cleanup.push(async () => {
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill(); const timer = setTimeout(() => chrome.kill('SIGKILL'), 5000);
      await exited; clearTimeout(timer);
    }
  });
  let debugPort = '';
  for (let i = 0; i < 300; i++) {
    if (chrome.exitCode !== null) throw new Error('Isolated Chrome exited');
    try { debugPort = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]!; break; } catch {}
    await delay(100);
  }
  assert.ok(debugPort);
  const endpoint = 'http://127.0.0.1:' + debugPort;
  let allowDebug = false, refusedConnections = 0;
  const debugGate = createServer(async (_request, response) => {
    if (!allowDebug) { refusedConnections++; response.writeHead(403); response.end('Debug connection not allowed yet'); return; }
    try {
      const version = await fetch(endpoint + '/json/version');
      response.setHeader('Content-Type', 'application/json');
      response.end(await version.text());
    } catch (error) { response.writeHead(502); response.end(String(error)); }
  });
  await new Promise<void>(resolve => debugGate.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => debugGate.close(() => resolve())));
  const gatedEndpoint = `http://127.0.0.1:${(debugGate.address() as import('node:net').AddressInfo).port}`;
  report.browser = (await (await fetch(endpoint + '/json/version')).json()).Browser;
  const ui = await chromium.connectOverCDP(endpoint);
  cleanup.push(() => ui.close());
  const context = ui.contexts()[0]!;
  const target = context.pages()[0];
  assert.ok(target, 'Chrome must expose its startup tab');
  if (!target.url().startsWith(fixtureUrl)) await target.goto(fixtureUrl + '/before');
  targetPage = target;
  const second = await context.newPage();
  await second.goto(fixtureUrl + '/second');
  const fake = await createFakeCodex(root);
  cleanup.push(() => fake.close());
  const id = '00000000-0000-4000-8000-000000000144';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('experimentalFeature/list', () => ({ data: [{ name: 'in_app_browser', stage: 'stable', displayName: null,
    description: null, announcement: null, enabled: false, defaultEnabled: false }], nextCursor: null }));
  fake.handlers.set('thread/resume', (params: Record<string, unknown>) => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.threads.set(id, fixtureThread(id, root, { name: 'Chrome 原版面板验收', turns: [fixtureTurn('browser-turn', [agentItem('browser-message', `[打开浏览器验收页](${fixtureUrl}/external)`)])] }));
  const dataDir = join(root, 'data');
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex-home'), dataDir, workspace: root,
    httpFetch: async () => new Response('Isolated browser fixture: external telemetry disabled', { status: 503 }),
    hostCatalog: { hosts: [], projects: [], assignments: {} }, chromeConnection: { browserUrl: gatedEndpoint } });
  const closeApp = () => app.close();
  cleanup.push(closeApp);
  nativePage = await context.newPage();
  const chromeRequests = new Set<string>();
  const transport: unknown[] = [];
  const httpErrors: unknown[] = [];
  report.chromeTransport = transport;
  report.httpErrors = httpErrors;
  nativePage.on('response', response => {
    if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
  });
  nativePage.on('websocket', socket => {
    socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'fetch' && message.url?.endsWith('/chrome-browser')) {
        chromeRequests.add(message.requestId);
        const { clientKey: _credential, ...request } = JSON.parse(message.body);
        transport.push({ sentAt: new Date().toISOString(), request });
      }
    });
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'browser-sidebar-state') transport.push({ snapshotAt: new Date().toISOString(), message });
      if (message.type === 'fetch-response' && chromeRequests.has(message.requestId)) {
        transport.push({ receivedAt: new Date().toISOString(), error: message.error, state: message.body && {
          ...message.body, frame: message.body.frame && { ...message.body.frame, image: '(omitted)' },
        } });
      }
    });
  });
  nativePage.on('pageerror', error => errors.push(String(error)));
  nativePage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await nativePage.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await nativePage.goto(app.url + '/local/' + id);
  await nativePage.locator('[data-owned-renderer="true"]').waitFor();
  await nativePage.getByRole('link', { name: '打开浏览器验收页' }).waitFor({ timeout: 60000 });
  await nativePage.evaluate(() => {
    const trace: unknown[] = [];
    Object.assign(window, { browserKeyTrace: trace });
    window.addEventListener('keydown', event => {
      trace.push({ key: event.key, target: (event.target as Element).outerHTML?.slice(0, 180), active: document.activeElement?.tagName });
      queueMicrotask(() => trace.push({ after: event.key, active: document.activeElement?.tagName }));
    }, true);
  });
  await capture('workbench-before');
  console.log('Opening the owned browser panel');
  await nativePage.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
  const address = nativePage.getByLabel('网页地址', { exact: true });
  await nativePage.getByLabel('已有 Chrome 标签').waitFor({ timeout: 30000 });
  assert.equal(await nativePage.getByLabel('浏览器所在电脑').inputValue(), 'client');
  await nativePage.getByLabel('浏览器所在电脑').selectOption('server');
  const coachmark = nativePage.getByRole('tooltip').filter({ hasText: '试用注释模式' });
  if (await coachmark.count()) await coachmark.getByRole('button', { name: '关闭', exact: true }).click();
  const select = nativePage.getByLabel('已有 Chrome 标签');
  await nativePage.getByRole('status').filter({ hasText: /403|Forbidden/ }).waitFor({ timeout: 30000 });
  assert.ok(refusedConnections > 0);
  await capture('workbench-refused');
  allowDebug = true;
  await nativePage.getByRole('region', { name: 'Chrome 网页画面', exact: true }).getByRole('button', { name: '刷新', exact: true }).click();
  const option = select.locator('option').filter({ hasText: fixtureUrl + '/before' });
  await option.waitFor({ state: 'attached', timeout: 30000 });
  const pageId = await option.getAttribute('value'); assert.ok(pageId);
  await select.selectOption(pageId);
  await nativePage.waitForFunction(id => {
    const control = document.querySelector<HTMLSelectElement>('select[aria-label="已有 Chrome 标签"]');
    return control?.value === id && !control.disabled;
  }, pageId);
  const image = nativePage.getByRole('img', { name: 'Chrome 标签的最新画面' });
  await image.waitFor({ timeout: 30000 });
  await image.evaluate(async element => (element as HTMLImageElement).decode());
  report.reconnectAfterRefusal = { refusedConnections, visibleFailure: true, manualRefreshRecovered: true };
  await address.fill(fixtureUrl + '/before');
  await Promise.all([target.waitForEvent('domcontentloaded'), address.press('Enter')]);
  await nativePage.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  assert.match(await target.locator('body').innerText(), /已有会话：已保留/);
  console.log('Checking screenshot coordinates and Chinese input');
  async function clickTarget(label: string, role: 'textbox' | 'button') {
    const box = await target.getByRole(role, { name: label }).boundingBox();
    const viewport = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(box);
    const rect = await image.boundingBox(); assert.ok(rect);
    const before = await image.getAttribute('src');
    await image.click({ position: { x: (box.x + box.width / 2) / viewport.width * rect.width, y: (box.y + box.height / 2) / viewport.height * rect.height } });
    await nativePage!.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
    return before;
  }
  await clickTarget('测试输入', 'textbox');
  // No typing delay: every key must survive screenshots and MCP round trips.
  await image.pressSequentially('Fast123');
  await target.waitForFunction(() => document.querySelector('input')?.value === 'Fast123', undefined, { timeout: 10000, polling: 100 });
  assert.doesNotMatch(await nativePage.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), /Fast123|ast123/);
  report.keyTrace = await nativePage.evaluate(() => (window as Window & { browserKeyTrace?: unknown[] }).browserKeyTrace);
  await nativePage.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  await nativePage.getByLabel('向网页输入').fill('原版 Chrome 面板中文输入');
  await nativePage.getByRole('button', { name: '输入', exact: true }).click();
  await target.waitForFunction(() => document.querySelector('input')?.value === 'Fast123原版 Chrome 面板中文输入', undefined, { polling: 100 });
  await nativePage.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  const before = await clickTarget('确认输入', 'button');
  await target.waitForFunction(() => document.querySelector('output')?.textContent === '收到：Fast123原版 Chrome 面板中文输入', undefined, { polling: 100 });
  assert.equal(await target.locator('output').innerText(), '收到：Fast123原版 Chrome 面板中文输入');
  assert.notEqual(await image.getAttribute('src'), before);
  await capture('workbench-input');
  report.panel = { ownedPanel: true, existingPageId: pageId, screenshotDisplayed: true, coordinateClick: true, fastKeyboardNoDelay: 'Fast123', chineseInput: true, screenshotChanged: true, targetFrameDenyHeaders: true };
  console.log('Checking the owned address bar, navigation and existing tab switching');
  await address.fill(fixtureUrl + '/after');
  await address.press('Enter');
  await target.waitForFunction(url => location.href === url, fixtureUrl + '/after', { polling: 100 });
  const navigation = nativePage.getByRole('region', { name: '浏览器', exact: true });
  await navigation.getByRole('button', { name: '后退', exact: true }).click();
  // History restoration can use BFCache without another load event.
  await target.waitForFunction(url => location.href === url, fixtureUrl + '/before', { polling: 100 });
  await navigation.getByRole('button', { name: '前进', exact: true }).click();
  await target.waitForFunction(url => location.href === url, fixtureUrl + '/after', { polling: 100 });
  await Promise.all([
    target.waitForEvent('domcontentloaded'),
    navigation.getByRole('button', { name: '重新加载', exact: true }).click(),
  ]);
  await nativePage.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  await nativePage.waitForFunction(url => document.querySelector<HTMLInputElement>('input[aria-label="网页地址"]')?.value?.endsWith(url) === true,
    fixtureUrl.replace('http://', '') + '/after');
  assert.equal((await address.inputValue()).replace(/^http:\/\//, ''), fixtureUrl.replace('http://', '') + '/after');
  const secondId = await select.locator('option').filter({ hasText: fixtureUrl + '/second' }).getAttribute('value');
  assert.ok(secondId);
  await select.selectOption(secondId);
  await nativePage.waitForFunction(url => document.querySelector<HTMLInputElement>('input[aria-label="网页地址"]')?.value?.endsWith(url) === true, fixtureUrl.replace('http://', '') + '/second');
  await select.selectOption(pageId);
  await nativePage.waitForFunction(url => document.querySelector<HTMLInputElement>('input[aria-label="网页地址"]')?.value?.endsWith(url) === true, fixtureUrl.replace('http://', '') + '/after');
  report.navigation = { address: true, back: true, forward: true, reload: true, existingSession: true, switchExistingTabs: true };
  await capture('workbench-panel');

  console.log('Installing the downloadable companion and pairing two separate Chrome instances');
  const installRoot = join(root, 'client-install');
  await mkdir(installRoot);
  const packagePath = join(installRoot, 'chrome-client.tgz');
  const downloaded = await fetch(app.url + '/chrome-client.tgz');
  assert.equal(downloaded.status, 200);
  await writeFile(packagePath, Buffer.from(await downloaded.arrayBuffer()));
  await promisify(execFile)('npm', ['install', '--prefix', installRoot, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packagePath], { timeout: 60_000 });
  // Invoke the installed bin symlink, matching npx's command resolution.
  const clientBin = join(installRoot, 'node_modules', '.bin', 'codex-yard-chrome');
  const help = await promisify(execFile)(process.execPath, [clientBin, '--help']);
  assert.match(help.stdout, /--connect/);
  async function pairClient(page: Page, browserUrl: string, label: string) {
    const coachmark = page.getByRole('tooltip').filter({ hasText: '试用注释模式' });
    if (await coachmark.count()) await coachmark.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '连接这台电脑', exact: true }).click();
    const command = await page.getByLabel('这台电脑的配对命令').inputValue();
    const token = command.match(/--pair '([a-zA-Z0-9_-]{32})'/)?.[1]; assert.ok(token);
    // Do not persist pairing commands/credentials in evidence or logs.
    const child = spawn(process.execPath, [clientBin, '--connect', app.url, '--pair', token, '--name', label, '--browser-url', browserUrl], { stdio: 'ignore' });
    const done = once(child, 'exit');
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(); const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
        await done; clearTimeout(timer);
      }
    };
    cleanup.push(stop);
    await page.getByRole('status', { name: '', exact: true }).filter({ hasText: /^已配对$/ }).waitFor({ timeout: 30000 });
    assert.equal(await page.getByLabel('这台电脑的配对命令').count(), 0);
    return stop;
  }
  await nativePage.getByLabel('浏览器所在电脑').selectOption('client');
  const stopA = await pairClient(nativePage, endpoint, '验收电脑 A');
  const clientAOption = select.locator('option').filter({ hasText: fixtureUrl + '/after' });
  await clientAOption.waitFor({ state: 'attached', timeout: 30000 });
  const clientAId = await clientAOption.getAttribute('value'); assert.ok(clientAId);
  await select.selectOption(clientAId);
  await nativePage.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  await capture('workbench-client-a');

  const secondProfile = join(root, 'chrome-b');
  const chromeB = spawn(process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-background-networking', '--disable-dev-shm-usage', '--window-size=1200,900', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-features=CDPScreenshotNewSurface', '--remote-debugging-port=0', '--user-data-dir=' + secondProfile, fixtureUrl + '/computer-b',
  ], { stdio: 'ignore' });
  const exitedB = once(chromeB, 'exit');
  cleanup.push(async () => {
    if (chromeB.exitCode === null && chromeB.signalCode === null) {
      chromeB.kill(); const timer = setTimeout(() => chromeB.kill('SIGKILL'), 5000); await exitedB; clearTimeout(timer);
    }
  });
  let portB = '';
  for (let i = 0; i < 100; i++) {
    try { portB = (await readFile(join(secondProfile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]!; break; } catch {}
    await delay(100);
  }
  assert.ok(portB);
  const endpointB = 'http://127.0.0.1:' + portB;
  const browserB = await chromium.connectOverCDP(endpointB); cleanup.push(() => browserB.close());
  const targetB = browserB.contexts()[0]!.pages().find(page => page.url().startsWith(fixtureUrl))!;
  assert.ok(targetB);
  const accessB = await ui.newContext(); cleanup.push(() => accessB.close());
  const nativeB = await accessB.newPage();
  clientBPage = nativeB;
  await nativeB.bringToFront();
  await nativeB.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await nativeB.goto(app.url + '/local/' + id);
  await nativeB.locator('[data-owned-renderer="true"]').waitFor();
  await nativeB.getByRole('link', { name: '打开浏览器验收页' }).waitFor({ timeout: 60000 });
  await nativeB.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
  await nativeB.getByLabel('浏览器所在电脑').waitFor({ timeout: 30000 });
  assert.equal(await nativeB.getByLabel('浏览器所在电脑').inputValue(), 'client');
  const stopB = await pairClient(nativeB, endpointB, '验收电脑 B');
  const selectB = nativeB.getByLabel('已有 Chrome 标签');
  const clientBOption = selectB.locator('option').filter({ hasText: fixtureUrl + '/computer-b' });
  await clientBOption.waitFor({ state: 'attached', timeout: 30000 });
  assert.match(await selectB.innerText(), /computer-b/);
  assert.doesNotMatch(await selectB.innerText(), /\/after|\/second/);
  assert.doesNotMatch(await select.innerText(), /computer-b/);
  const clientBId = await clientBOption.getAttribute('value'); assert.ok(clientBId);
  await selectB.selectOption(clientBId);
  const imageB = nativeB.getByRole('img', { name: 'Chrome 标签的最新画面' });
  await imageB.evaluate(async element => (element as HTMLImageElement).decode());
  const inputB = await targetB.getByRole('textbox', { name: '测试输入' }).boundingBox(); assert.ok(inputB);
  const viewportB = await targetB.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const rectB = await imageB.boundingBox(); assert.ok(rectB);
  await imageB.click({ position: { x: (inputB.x + inputB.width / 2) / viewportB.width * rectB.width, y: (inputB.y + inputB.height / 2) / viewportB.height * rectB.height } });
  await nativeB.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  await nativeB.getByLabel('向网页输入').fill('只发给电脑 B');
  await nativeB.getByRole('button', { name: '输入', exact: true }).click();
  await targetB.waitForFunction(() => document.querySelector('input')?.value === '只发给电脑 B', undefined, { polling: 100 });
  assert.notEqual(await target.getByRole('textbox', { name: '测试输入' }).inputValue(), '只发给电脑 B');
  await nativeB.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  await nativeB.screenshot({ path: join(evidence, 'workbench-client-b.png') });
  await nativeB.bringToFront();
  await nativeB.reload({ waitUntil: 'commit' });
  await nativeB.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
  await nativeB.getByRole('status').filter({ hasText: /^已配对$/ }).waitFor({ timeout: 60000 });
  const restoredId = await selectB.locator('option').filter({ hasText: fixtureUrl + '/computer-b' }).getAttribute('value');
  assert.ok(restoredId);
  await selectB.selectOption(restoredId);
  await nativeB.getByRole('status').filter({ hasText: '点击画面后可键入' }).waitFor({ timeout: 30000 });
  await stopB();
  await nativeB.getByRole('status').filter({ hasText: /^未连接$/ }).waitFor({ timeout: 10000 });
  await nativeB.getByRole('img', { name: 'Chrome 标签的最新画面' }).waitFor({ state: 'detached', timeout: 10000 });
  assert.equal(await nativeB.getByLabel('浏览器所在电脑').inputValue(), 'client');
  assert.equal(targetB.isClosed(), false);
  await capture('workbench-client-a-after-b-disconnect');
  report.clientConnections = { downloadablePackageInstalled: true, installedBinWorks: true, twoRealChromeInstances: true,
    isolatedTabsAndInput: true, pairingSurvivesPageReload: true, panelReopened: true, disconnectClearsFrame: true, noServerFallback: true, realTabsPreserved: true };
  await nativeB.close();
  await navigation.getByRole('button', { name: '关闭', exact: true }).click();
  await image.waitFor({ state: 'hidden' });
  assert.equal(target.isClosed(), false);
  assert.equal(second.isClosed(), false);
  report.panelDetachKeepsChromeTabs = true;
  await stopA();
  await nativePage.close();
  await app.close(); cleanup.splice(cleanup.indexOf(closeApp), 1);
  assert.equal((await fetch(endpoint + '/json/version')).status, 200);
  assert.equal(target.isClosed(), false);
  const requests = transport.map(value => (value as { request?: { operation?: string; command?: { type?: string } } }).request).filter(Boolean);
  for (const operation of ['state', 'select', 'click', 'text', 'command', 'release']) {
    assert.ok(requests.some(request => request?.operation === operation), 'Missing actual chrome-browser operation: ' + operation);
  }
  for (const command of ['navigate', 'go-back', 'go-forward', 'reload']) {
    assert.ok(requests.some(request => request?.command?.type === command), 'Missing actual Chrome navigation: ' + command);
  }
  assert.deepEqual(errors, []);
  report.attachedChromeSurvivesDisconnect = true;
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = (error as Error).stack;
  report.targetState = await targetPage?.evaluate(() => ({ value: document.querySelector('input')?.value, active: document.activeElement?.tagName }));
  report.keyTrace = await nativePage?.evaluate(() => (window as Window & { browserKeyTrace?: unknown[] }).browserKeyTrace);
  await capture('failure').catch(() => {});
  if (clientBPage) await capture('failure-client-b', clientBPage).catch(() => {});
  throw error;
} finally {
  for (const close of cleanup.reverse()) { try { await close(); } catch (error) { report.cleanupError = String(error); report.passed = false; } }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(error => { report.cleanupError = String(error); report.passed = false; });
  report.finishedAt = new Date().toISOString(); report.uiErrors = errors;
  await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  console.log('Evidence: ' + evidence);
  if (report.cleanupError) throw new Error('Cleanup failed: ' + report.cleanupError);
}
