// Run under /tmp/agents-workbench-heavy.lock. All pages and backend data are fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import type { Page as RpcPage, TurnSummary } from '../lib/codex-protocol.ts';

const root = await mkdtemp('/tmp/yard-embedded-');
const output = resolve(process.env.AGENTS_EMBEDDED_EVIDENCE ?? '.local/embedded-browser');
await mkdir(output, { recursive: true });
const fake = process.env.AGENTS_EMBEDDED_TEST_SOCKET ? undefined : await createFakeCodex(root);
let threadId = process.env.AGENTS_EMBEDDED_TEST_THREAD ?? '00000000-0000-4000-8000-000000000184';
const createCliThread = !fake && process.env.AGENTS_EMBEDDED_CREATE_THREAD === '1';
const hasFixtureLink = !!fake || createCliThread;
if (fake) {
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux fixture)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('experimentalFeature/list', () => ({ data: [{ name: 'in_app_browser', stage: 'stable', displayName: null,
    description: null, announcement: null, enabled: false, defaultEnabled: false }], nextCursor: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.handlers.set('thread/turns/list', params => ({
    ...fake.defaultResult('thread/turns/list', params),
    data: [...(fake.threads.get(String(params.threadId))?.turns ?? [])].reverse().map(turn => ({ ...turn,
      items: params.itemsView === 'notLoaded' ? [] : turn.items,
      itemsView: params.itemsView ?? 'full',
    })),
  }));
}
const website = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/blocked') {
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    response.end('<h1>此页面禁止嵌入</h1>'); return;
  }
  const result = request.url?.startsWith('/result');
  response.setHeader('Set-Cookie', 'yard_fixture=present; HttpOnly; SameSite=Lax; Path=/');
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>客户端网页验收</title><style>body{font:18px system-ui;margin:0;padding:24px;background:#f8faf9;color:#183c31}input,button{font:inherit;max-width:100%;box-sizing:border-box;padding:10px}input{width:100%}button{margin:12px 0}a{color:#276c55}.space{height:1500px}</style><h1>${result ? '表单已提交' : '客户端直接渲染'}</h1><p>本地会话：${request.headers.cookie?.includes('yard_fixture=present') ? '已保留' : '首次建立'}</p><form action="/result"><label>页面输入<input name="text" aria-label="页面输入"></label><button type="button" onclick="document.querySelector('output').textContent=document.querySelector('input').value">确认输入</button><button>提交表单</button></form><output>等待输入</output><p><a href="/linked">页内链接</a></p><button onclick="try{top.location.href='/escape'}catch{}">替换主页面</button><div class="space"></div><p>滚动到底部</p></html>`);
});
await new Promise<void>(done => website.listen(0, '127.0.0.1', done));
const site = 'http://127.0.0.1:' + (website.address() as import('node:net').AddressInfo).port;
if (fake) fake.threads.set(threadId, fixtureThread(threadId, root, { name: '内嵌网页验收', turns: [fixtureTurn('embedded-turn', [
  { ...agentItem('embedded-answer', `内嵌网页验收内容\n\n[右栏链接](${site}/one)\n\n[HTML预览链接](${site}/standalone.html)`), phase: 'final_answer' },
])] }));
const dataDir = join(root, 'data');
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
const app = await createNativeWorkbench({ port: 0, workspace: root, dataDir,
  socketPath: process.env.AGENTS_EMBEDDED_TEST_SOCKET ?? fake!.socketPath,
  codexHome: process.env.AGENTS_EMBEDDED_TEST_CODEX_HOME ?? join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
if (createCliThread) {
  const result = await app.control.request('thread/start', { cwd: root });
  threadId = result.thread.id;
  await app.control.request('thread/name/set', { threadId, name: '内嵌网页验收' });
  await app.control.request('turn/start', { threadId, input: [{ type: 'text', text: 'Embedded link fixture: ' + site + '/one' }] }, { mutating: true });
  const deadline = Date.now() + 30000;
  while (true) {
    const turns = await app.control.request<RpcPage<TurnSummary>>('thread/turns/list', { threadId, itemsView: 'full' });
    if (turns.data.some(turn => turn.status === 'completed')) break;
    if (Date.now() > deadline) throw new Error('Isolated CLI did not finish its fixture reply');
    await delay(100);
  }
}
const previewData = join(root, 'preview-data');
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(previewData, 'configuration-snapshot'), { recursive: true });
const preview = await createNativeWorkbench({ port: 0, workspace: root, dataDir: previewData, embeddingOrigins: [app.url],
  socketPath: process.env.AGENTS_EMBEDDED_TEST_SOCKET ?? fake!.socketPath,
  codexHome: process.env.AGENTS_EMBEDDED_TEST_CODEX_HOME ?? join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
const seed = await context.newPage();
await seed.goto(site + '/seed'); await seed.close();
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors: string[] = [], checks: string[] = [], commands: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', cli: app.control.server?.userAgent, realDaemonUsed: !fake, errors, checks };
const consoleMessages: string[] = [];
page.on('console', message => { if (message.type() === 'error') consoleMessages.push(message.text()); });
await page.addInitScript(() => {
  const trace: unknown[] = [];
  Object.assign(window, { embeddedTrace: trace });
  window.addEventListener('message', event => { if (String(event.data?.type).startsWith('browser-sidebar') || event.data?.type === 'toggle-browser-panel') trace.push(event.data); });
});
page.on('pageerror', error => errors.push(error.message));
page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
  const value = JSON.parse(String(payload));
  if (value.type === 'fetch' && value.url?.endsWith('/chrome-browser')) commands.push(JSON.parse(value.body).operation);
}));
const frame = () => page.frameLocator('iframe[title="网页内容"]:visible');
async function capture(name: string) {
  console.log('Capturing ' + name);
  await page.screenshot({ path: join(output, name + '.png'), timeout: 10000 });
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
}
async function navigate(url: string) {
  const address = page.getByRole('textbox', { name: /^(搜索或输入网址|Search or enter URL)$/ });
  await address.fill(url); await address.press('Enter');
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  await page.addLocatorHandler(page.getByRole('button', { name: '继续使用当前模型', exact: true }), async button => { await button.click(); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText('内嵌网页验收内容', { exact: true }).waitFor({ timeout: 60000 });
  const editor = page.getByRole('textbox', { name: /^(和 Codex 一起工作|Work with Codex)$/ });
  await editor.fill('网页切换后保留的草稿');
  if (hasFixtureLink) {
    await page.getByRole('link', { name: '右栏链接', exact: true }).click();
    await frame().getByRole('heading', { name: '客户端直接渲染' }).waitFor();
    const chat = await editor.boundingBox(), web = await page.locator('iframe[title="网页内容"]:visible').boundingBox();
    assert.ok(chat && web && web.x >= chat.x + chat.width, 'A blue link must reveal the right panel alongside the chat even from full view');
    checks.push('A link from the initial full chat view reveals the website to the right of the still-visible composer');
  }
  const full = page.getByRole('button', { name: /^(退出完整视图|Exit full view)$/ });
  if (await full.count()) await full.click();
  await page.getByRole('button', { name: /^(隐藏侧边栏|Hide sidebar)$/ }).click();
  const newTab = page.getByRole('button', { name: /^(新(?:建)?标签页|New tab)$/ }).first();
  if (!await page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).count()) await newTab.click();
  const navigation = page.getByRole('group', { name: /^(导航|Navigation)$/ });
  const address = page.getByRole('textbox', { name: /^(搜索或输入网址|Search or enter URL)$/ });
  assert.equal(await address.count(), 0);
  assert.equal(await navigation.count(), 0);
  await capture('00-new-tab');
  if (hasFixtureLink) await page.getByRole('link', { name: '右栏链接', exact: true }).click();
  else {
    await page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).fill(site + '/one');
    await page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).press('Enter');
  }
  await frame().getByRole('heading', { name: '客户端直接渲染' }).waitFor();
  assert.ok(await frame().getByText('本地会话：已保留', { exact: true }).isVisible());
  assert.equal(context.pages().length, 1);
  assert.equal(await page.getByLabel('浏览器所在电脑').count(), 0);
  assert.equal(await page.getByRole('button', { name: '连接 Chrome', exact: true }).count(), 0);
  assert.equal(await page.locator('summary').filter({ hasText: '页面帮助' }).count(), 0);
  assert.ok(await address.isVisible());
  assert.equal(await page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).count(), 0);
  const pageBounds = await page.getByRole('region', { name: '浏览器页面', exact: true }).boundingBox();
  const frameBounds = await page.locator('iframe[title="网页内容"]:visible').boundingBox();
  assert.equal(frameBounds?.y, pageBounds?.y, 'The web page must fill the panel without an extra mode toolbar');
  checks.push('New tab has one central search; opening a page shows its address bar without a Chrome or help toolbar');
  checks.push('A real client-rendered page stays inside Yard with the fixture session and no pairing or external tab');
  if (hasFixtureLink) {
    const popupPromise = context.waitForEvent('page');
    await page.getByRole('link', { name: '右栏链接', exact: true }).click({ modifiers: ['Control'] });
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded'); await popup.close();
    assert.equal(context.pages().length, 1);
    checks.push('An actual blue conversation link opens in the right panel; Control-click still opens an external browser tab');
  }
  await frame().getByRole('textbox', { name: '页面输入' }).fill('中文原生输入 123');
  await frame().getByRole('button', { name: '确认输入', exact: true }).tap();
  assert.equal(await frame().locator('output').innerText(), '中文原生输入 123');
  await frame().getByRole('button', { name: '替换主页面', exact: true }).tap();
  assert.ok(page.url().startsWith(app.url));
  await capture('01-client-page');
  const body = frame().locator('body');
  await body.hover(); await page.mouse.wheel(0, 500);
  await body.evaluate(element => new Promise<void>(done => {
    const timer = setTimeout(done, 3000);
    const check = () => {
      if (element.ownerDocument.defaultView!.scrollY > 100) { clearTimeout(timer); done(); }
      else requestAnimationFrame(check);
    }; check();
  }));
  assert.ok(await body.evaluate(element => element.ownerDocument.defaultView!.scrollY > 100), 'The embedded page must scroll');
  checks.push('Chinese input, touch buttons and native document scrolling work while top navigation remains inside the frame');
  await navigate(site + '/two');
  await frame().getByRole('heading', { name: '客户端直接渲染' }).waitFor();
  await navigation.getByRole('button', { name: /^(返回|Back)$/ }).click();
  await page.locator('iframe[title="网页内容"]:visible').evaluate((element, url) => { if ((element as HTMLIFrameElement).src !== url) throw new Error('Back did not restore the first submitted URL'); }, site + '/one');
  await navigation.getByRole('button', { name: /^(前进|Forward)$/ }).click();
  await frame().getByRole('textbox', { name: '页面输入' }).fill('刷新前');
  await navigation.getByRole('button', { name: /^(重新加载页面|Reload page)$/ }).click();
  await frame().getByRole('textbox', { name: '页面输入' }).waitFor();
  assert.equal(await frame().getByRole('textbox', { name: '页面输入' }).inputValue(), '');
  await frame().getByRole('textbox', { name: '页面输入' }).fill('表单中文');
  await frame().getByRole('button', { name: '提交表单', exact: true }).tap();
  await frame().getByRole('heading', { name: '表单已提交' }).waitFor();
  assert.ok(page.url().startsWith(app.url));
  checks.push('The original address controls navigate submitted URLs and reload the frame; forms navigate within the right panel');
  const firstPageTab = await page.getByRole('tab', { name: '127.0.0.1', exact: true }).getAttribute('id');
  assert.ok(firstPageTab);
  await newTab.click();
  assert.equal(await address.count(), 0);
  assert.equal(await navigation.count(), 0);
  const search = page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true });
  await search.waitFor({ timeout: 60000 });
  assert.equal(await address.count(), 0);
  assert.equal(await navigation.count(), 0);
  checks.push('A second New tab hides the unused address controls');
  await search.fill(site + '/separate'); await search.press('Enter');
  await frame().getByRole('heading', { name: '客户端直接渲染' }).waitFor();
  await page.locator('[id="' + firstPageTab + '"]').click();
  await frame().getByRole('heading', { name: '表单已提交' }).waitFor();
  assert.ok(await address.isVisible());
  checks.push('A second New tab opens separately and switching back preserves the first document');
  for (const viewport of [{ width: 800, height: 1100 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.locator('iframe[title="网页内容"]:visible').isVisible());
    assert.ok(await address.isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture('02-tablet-' + viewport.width);
  }
  await page.reload({ waitUntil: 'commit' });
  await frame().getByRole('heading', { name: '客户端直接渲染' }).waitFor({ timeout: 60000 });
  const hideSidebar = page.getByRole('button', { name: /^(隐藏侧边栏|Hide sidebar)$/ });
  if (await hideSidebar.count()) await hideSidebar.click();
  assert.ok((await editor.innerText()).includes('网页切换后保留的草稿'));
  assert.deepEqual(commands, []);
  checks.push('Portrait, landscape and refresh retain the submitted page and chat draft without Chrome host requests');
  const denied = page.waitForEvent('console', message => /frame-ancestors|X-Frame-Options/.test(message.text()));
  await navigate(site + '/blocked'); await denied;
  assert.equal(await frame().getByRole('heading', { name: '此页面禁止嵌入' }).count(), 0);
  assert.deepEqual(commands, [], 'A refused embed must not connect or proxy automatically');
  await capture('03-embed-denied');
  assert.equal(await page.getByRole('button', { name: '连接 Chrome', exact: true }).count(), 0);
  checks.push('A site denying embedding stays blocked without connecting to Chrome');
  await navigate('about:blank');
  await search.waitFor();
  for (const viewport of [{ width: 800, height: 1100 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await search.isVisible());
    assert.equal(await address.count(), 0);
    assert.equal(await navigation.count(), 0);
    const searchPageBounds = await page.locator('[data-new-tab-scroll-root]:visible').boundingBox();
    const tabBounds = await page.getByRole('tabpanel').filter({ has: search }).boundingBox();
    assert.equal(searchPageBounds?.y, tabBounds?.y, 'A blank browser tab must not reserve an empty navigation row');
    await capture('04-browser-new-tab-' + viewport.width);
  }
  await search.fill(site + '/reopened'); await search.press('Enter');
  await frame().getByRole('heading', { name: '客户端直接渲染' }).waitFor();
  assert.ok(await address.isVisible());
  checks.push('An existing browser tab returning to New tab hides the navigation row in both tablet sizes; reopening a URL restores it');
  const htmlLink = page.getByRole('link', { name: 'HTML预览链接', exact: true });
  if (hasFixtureLink && await htmlLink.count()) {
    await htmlLink.click();
    await frame().getByRole('heading', { name: '客户端直接渲染' }).waitFor();
    const htmlUrl = new URL((await page.locator('iframe[title="网页内容"]:visible').getAttribute('src'))!);
    assert.equal(htmlUrl.origin, app.url); assert.equal(htmlUrl.pathname, '/api/local-html-preview');
    assert.equal(await frame().locator('body').evaluate(() => { try { void parent.document.body; return true; } catch { return false; } }), false);
    await frame().getByRole('textbox', { name: '页面输入' }).fill('HTML 预览保留交互');
    await frame().getByRole('button', { name: '确认输入', exact: true }).click();
    assert.equal(await frame().locator('output').innerText(), 'HTML 预览保留交互');
    checks.push('A local HTML link still uses the Yard-host transport and sandbox, with working scripts and no access to the parent document');
  }
  await page.addLocatorHandler(frame().getByRole('button', { name: '继续使用当前模型', exact: true }), async button => { await button.click(); });
  await navigate(preview.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId));
  await frame().getByText('内嵌网页验收内容', { exact: true }).waitFor({ timeout: 60000 });
  await frame().getByRole('textbox', { name: /^(和 Codex 一起工作|Work with Codex)$/ }).fill('独立预览可输入', { timeout: 60000 });
  assert.equal(context.pages().length, 1);
  await capture('05-yard-preview-in-panel');
  checks.push('A separate Yard instance on another port renders its conversation and composer inside the allowed parent panel');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  report.trace = await Promise.race([
    page.evaluate(() => (window as Window & { embeddedTrace?: unknown[] }).embeddedTrace),
    new Promise(resolve => setTimeout(() => resolve('Page trace timed out'), 2000)),
  ]).catch(() => undefined);
  report.pages = context.pages().map(page => page.url());
  report.console = consoleMessages;
  await capture('failure').catch(() => {}); throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await preview.close(); await app.close(); await fake?.close();
  await new Promise<void>(done => website.close(() => done()));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
