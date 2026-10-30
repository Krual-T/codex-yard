// Hold /tmp/agents-workbench-heavy.lock for this runner's whole lifecycle.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';
import { isolatePublicVerifier, openChromePanel, publicVerifierConfigurationFetch } from './public-verifier-environment.ts';

// The test drives Chrome's actual DevTools picker through its shipped action.
// Product code continues to use only official MCP, with no CDP picker.
interface DevToolsPage {
  waitForFunction(expression: string): Promise<unknown>;
  evaluate<T>(action: () => T | Promise<T>): Promise<T>;
}
interface PickerBrowser {
  pages(): Promise<{ url(): string; openDevTools(): Promise<DevToolsPage> }[]>;
  disconnect(): Promise<void>;
}
const root = await mkdtemp(join(tmpdir(), 'aw-element-context-'));
const output = process.env.AGENTS_ELEMENT_EVIDENCE
  ? resolve(process.env.AGENTS_ELEMENT_EVIDENCE) : await mkdtemp(join(tmpdir(), 'yard-element-evidence-'));
await isolatePublicVerifier(root, process.env.AGENTS_PUBLIC_VERIFIER_NPM_CACHE_SEED);
const entry = new URL('./third_party/index.js', pathToFileURL(createRequire(import.meta.url).resolve('chrome-devtools-mcp')));
const { puppeteer } = await import(entry.href) as { puppeteer: { connect(options: { browserURL: string; defaultViewport: null }): Promise<PickerBrowser> } };
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: BrowserContext | undefined, page: Page | undefined, picker: PickerBrowser | undefined;
let stopClient = async () => {};
const errors: string[] = [];
const checks: string[] = [];
const report: Record<string, unknown> = { renderer: 'owned', personalProfile: false, realDaemonUsed: false, errors, checks };
const fixture = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('X-Frame-Options', 'DENY');
  response.end('<!doctype html><html lang="zh-CN"><title>元素引用验收</title><style>body{font:20px system-ui;padding:50px;background:#eef5f7}button{padding:20px;color:rgb(20,60,90);border-radius:12px}</style><h1>原生 DevTools 元素选择</h1><button id="selected">需要修改的按钮</button><p id="other">其他标签的内容</p><input type="password" value="private-form-value"></html>');
});
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  const pairCommand = page.getByLabel('这台电脑的配对命令');
  let snapshot = await page.locator('body').ariaSnapshot();
  if (await pairCommand.count()) {
    const token = (await pairCommand.inputValue()).match(/--pair '([^']+)'/)?.[1];
    if (token) snapshot = snapshot.replaceAll(token, '(redacted)');
  }
  await writeFile(join(output, name + '.txt'), snapshot);
  await page.screenshot({ path: join(output, name + '.png'), timeout: 10000, mask: [pairCommand] });
}
async function savedComments() {
  assert.ok(page);
  return page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('atoms', 'readonly'), request = tx.objectStore('atoms').get('native-atoms');
      request.onsuccess = () => resolve(request.result?.atoms?.['codex-yard.browser-comments.v1']);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    };
  }));
}
try {
  await import('./build-native.ts');
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = 'http://127.0.0.1:' + (fixture.address() as import('node:net').AddressInfo).port;
  const portLease = createServer();
  await new Promise<void>(resolve => portLease.listen(0, '127.0.0.1', resolve));
  const debugPort = (portLease.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(resolve => portLease.close(() => resolve()));
  const browserURL = 'http://127.0.0.1:' + debugPort;
  browser = await chromium.launchPersistentContext(join(root, 'chrome'), {
    executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    headless: true, viewport: { width: 1440, height: 1000 }, args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--remote-debugging-port=' + debugPort,
      '--enable-features=CDPScreenshotNewSurface', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    ],
  });
  const target = await browser.newPage(); await target.goto(fixtureUrl);
  const second = await browser.newPage(); await second.goto(fixtureUrl + '/second');
  const id = '00000000-0000-4000-8000-000000000166';
  const sibling = '00000000-0000-4000-8000-000000000167';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('experimentalFeature/list', () => ({ data: [{ name: 'in_app_browser', stage: 'stable', displayName: null,
    description: null, announcement: null, enabled: false, defaultEnabled: false }], nextCursor: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  for (const threadId of [id, sibling]) fake.threads.set(threadId, fixtureThread(threadId, root, { name: threadId === id ? '元素引用验收' : '另一个对话',
    turns: [fixtureTurn('context-turn', [agentItem('context-message', '隔离验收已准备')])] }));
  const dataDir = join(root, 'data');
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} }, chromeConnection: { browserUrl: browserURL },
    httpFetch: publicVerifierConfigurationFetch });
  page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.goto(app.url + '/local/' + id, { waitUntil: 'commit' });
  await page.locator('[data-owned-renderer="true"]').waitFor();
  await page.getByText('隔离验收已准备', { exact: true }).waitFor({ timeout: 60000 });
  await openChromePanel(page);
  await page.getByLabel('浏览器所在电脑').selectOption('server');
  const tab = page.getByLabel('已有 Chrome 标签');
  const option = tab.locator('option').filter({ hasText: new RegExp(fixtureUrl.replaceAll('.', '\\.') + '/?$') });
  await option.waitFor({ state: 'attached' });
  await tab.selectOption((await option.getAttribute('value'))!);
  const quote = page.getByRole('button', { name: '引用所选元素', exact: true });
  await quote.waitFor({ state: 'visible' });
  await page.getByAltText('Chrome 标签的最新画面').waitFor();
  const editor = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作|Work with Codex|随心输入|Ask anything)$/ });
  await editor.fill('保留这段草稿，请调整元素');
  await quote.click();
  await page.getByRole('status').filter({ hasText: /请先.*Ctrl\+Shift\+C/ }).waitFor();
  assert.equal(await editor.inputValue(), '保留这段草稿，请调整元素');
  assert.equal(fake.calls('turn/start').length, 0);
  checks.push('Quoting without a DevTools selection reports an error and preserves the draft');
  await capture('no-selection');
  console.log('Selecting with the real Chrome DevTools picker');
  picker = await puppeteer.connect({ browserURL, defaultViewport: null });
  const actual = (await picker.pages()).find(candidate => candidate.url() === target.url()); assert.ok(actual);
  const devtools = await actual.openDevTools();
  await devtools.waitForFunction('!!document.querySelector(".root-view")');
  await devtools.evaluate(async () => {
    const modulePath = '/bundled/ui/legacy/legacy.js';
    const UI = await import(modulePath) as { ActionRegistry: { ActionRegistry: { instance(): { getAction(id: string): { execute(): Promise<boolean> } } } } };
    await UI.ActionRegistry.ActionRegistry.instance().getAction('elements.toggle-element-search').execute();
  });
  // Chrome applies the native inspect-mode overlay asynchronously.
  await target.waitForTimeout(250);
  await target.locator('#selected').click();
  await devtools.waitForFunction(`(async () => {
    const UI = await import('/bundled/ui/legacy/legacy.js');
    const SDK = await import('/bundled/core/sdk/sdk.js');
    const node = UI.Context.Context.instance().flavor(SDK.DOMModel.DOMNode);
    return node?.getAttribute('id') === 'selected';
  })()`);
  await page.bringToFront();
  await quote.click();
  await page.getByRole('status').filter({ hasText: '已添加到输入框：需要修改的按钮' }).waitFor({ timeout: 30000 });
  assert.equal(await editor.inputValue(), '保留这段草稿，请调整元素');
  await page.locator('.standalone-composer__reference').filter({ hasText: '需要修改的按钮' }).waitFor();
  report.commentDrafts = await savedComments();
  assert.match(JSON.stringify(report.commentDrafts), /需要修改的按钮/);
  assert.doesNotMatch(JSON.stringify(report.commentDrafts), /private-form-value/);
  checks.push('Actual DevTools selection becomes a persisted composer reference without private form contents');
  await capture('attached');
  await page.reload({ waitUntil: 'commit' });
  await editor.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
    .some(input => ['和 Codex 一起工作', '与 Codex 协作', 'Work with Codex'].includes(input.getAttribute('aria-label') ?? '') && input.value === '保留这段草稿，请调整元素'));
  await page.locator('.standalone-composer__reference').filter({ hasText: '需要修改的按钮' }).waitFor();
  await capture('after-refresh');
  await openChromePanel(page);
  const references = page.getByRole('region', { name: '浏览器引用', exact: true });
  const annotationEditor = references.getByRole('textbox', { name: '浏览器引用批注' });
  await annotationEditor.waitFor();
  await capture('annotation-editor');
  await annotationEditor.fill('把按钮改成蓝色，保留圆角');
  await references.getByRole('button', { name: '保存批注', exact: true }).click();
  const annotationDeadline = Date.now() + 10000;
  while (!JSON.stringify(await savedComments()).includes('把按钮改成蓝色')) {
    assert.ok(Date.now() < annotationDeadline, 'Annotation was not committed');
    await delay(50);
  }
  assert.match(JSON.stringify(await savedComments()), /把按钮改成蓝色/);
  checks.push('Reload restores the draft and reference; the owned panel persists annotation edits');

  console.log('Checking selected elements through the paired access-computer relay');
  await page.getByLabel('浏览器所在电脑').selectOption('client');
  const coachmark = page.getByRole('tooltip').filter({ hasText: '试用注释模式' });
  if (await coachmark.count()) await coachmark.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '连接这台电脑', exact: true }).click();
  const pairCommand = await page.getByLabel('这台电脑的配对命令').inputValue();
  const token = pairCommand.match(/--pair '([a-zA-Z0-9_-]{32})'/)?.[1]; assert.ok(token);
  const packagePath = join(root, 'chrome-client.tgz'), installRoot = join(root, 'client');
  const downloaded = await fetch(app.url + '/chrome-client.tgz');
  assert.equal(downloaded.status, 200);
  await writeFile(packagePath, Buffer.from(await downloaded.arrayBuffer()));
  try {
    await promisify(execFile)('npm', ['install', '--prefix', installRoot, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packagePath], { timeout: 60000 });
  } catch (cause) {
    throw new Error('Offline companion installation failed. Set AGENTS_PUBLIC_VERIFIER_NPM_CACHE_SEED to a disposable seeded npm cache.', { cause });
  }
  const installed = JSON.parse(await readFile(join(installRoot, 'node_modules/codex-yard-chrome-client/package.json'), 'utf8'));
  report.companionVersion = installed.version;
  const client = spawn(process.execPath, [join(installRoot, 'node_modules/.bin/codex-yard-chrome'), '--connect', app.url,
    '--pair', token, '--name', '元素引用客户端', '--browser-url', browserURL], { stdio: 'ignore' });
  const exited = once(client, 'exit');
  stopClient = async () => {
    if (client.exitCode === null && client.signalCode === null) {
      client.kill('SIGTERM');
      const timer = setTimeout(() => { if (client.exitCode === null && client.signalCode === null) client.kill('SIGKILL'); }, 6000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  };
  await page.getByRole('status').filter({ hasText: /^已配对$/ }).waitFor();
  await option.waitFor({ state: 'attached' });
  await tab.selectOption((await option.getAttribute('value'))!);
  await quote.click();
  await page.getByRole('status').filter({ hasText: '已添加到输入框：需要修改的按钮' }).waitFor();
  await references.getByRole('textbox', { name: '浏览器引用批注' }).nth(1).waitFor();
  await references.getByRole('button', { name: '删除引用', exact: true }).nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="浏览器引用"] textarea').length === 1);
  checks.push('Installed companion pairs and quotes the selected element; a second reference can be deleted');
  await capture('paired-client-edited');

  await page.locator('.yard-owned-sidebar-project').getByRole('button', { name: '另一个对话', exact: true }).click();
  await editor.waitFor();
  assert.equal(await page.locator('.standalone-composer__reference').count(), 0);
  await editor.fill('另一个对话的草稿');
  await page.locator('.yard-owned-sidebar-project').getByRole('button', { name: '元素引用验收', exact: true }).click();
  await page.locator('.standalone-composer__reference').filter({ hasText: '需要修改的按钮' }).waitFor();
  assert.equal(await editor.inputValue(), '保留这段草稿，请调整元素');
  await page.getByRole('button', { name: /^(发送|Send)$/ }).click();
  await fake.waitForCall('turn/start');
  await page.locator('.standalone-composer__reference').filter({ hasText: '需要修改的按钮' }).waitFor({ state: 'detached' });
  report.requests = fake.messages.filter(message => message.method === 'turn/start');
  assert.equal(fake.calls('turn/start').length, 1);
  const request = JSON.stringify(fake.calls('turn/start')[0]);
  for (const expected of [id, '保留这段草稿，请调整元素', '把按钮改成蓝色', '#selected', '需要修改的按钮', 'border-radius', fixtureUrl]) assert.ok(request.includes(expected), 'Missing model context: ' + expected);
  assert.doesNotMatch(request, /private-form-value/);
  await page.locator('.yard-owned-sidebar-project').getByRole('button', { name: '另一个对话', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
    .some(input => ['和 Codex 一起工作', '与 Codex 协作', 'Work with Codex'].includes(input.getAttribute('aria-label') ?? '') && input.value === '另一个对话的草稿'));
  checks.push('Drafts and references are isolated by conversation; explicit send carries the selected context without private form values');
  await capture('after-send');

  console.log('Checking reference handoff from a new draft into a new conversation');
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
  await editor.fill('新对话也引用这个按钮');
  await openChromePanel(page);
  await page.getByLabel('浏览器所在电脑').selectOption('server');
  await option.waitFor({ state: 'attached' });
  await tab.selectOption((await option.getAttribute('value'))!);
  await quote.click();
  await page.locator('.standalone-composer__reference').filter({ hasText: '需要修改的按钮' }).waitFor();
  assert.equal(await editor.inputValue(), '新对话也引用这个按钮');
  await capture('new-draft');
  await page.getByRole('button', { name: /^(发送|Send)$/ }).click();
  const newTurn = await fake.waitForCall('turn/start', 2);
  assert.ok(newTurn);
  for (const expected of ['新对话也引用这个按钮', '#selected', 'border-radius']) assert.ok(JSON.stringify(newTurn).includes(expected), 'Missing new-draft context: ' + expected);
  assert.notEqual(newTurn.params?.threadId, id, 'The new draft must send to its own conversation');
  assert.equal(fake.calls('turn/start').length, 2, 'Only explicit sends start model turns');
  checks.push('A new conversation carries its own selected-element reference and starts exactly one explicit synthetic turn');
  report.requests = fake.messages.filter(message => message.method === 'turn/start');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await stopClient(); await picker?.disconnect(); await app?.close(); await browser?.close(); await fake.close();
  await new Promise<void>(resolve => fixture.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  console.log('Element context evidence:', output);
}
