// Run under /tmp/agents-workbench-heavy.lock. The daemon and chats are disposable fixtures.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/aw-tabs-');
const output = resolve(process.env.AGENTS_TABS_EVIDENCE ?? '.local/workspace-tabs-verification');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [];
const checks: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, checks, errors };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
try {
  const threadId = '00000000-0000-4000-8000-000000000175';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.threads.set(threadId, fixtureThread(threadId, root, { name: '工作区标签栏验收',
    turns: [fixtureTurn('tabs-turn', [agentItem('tabs-answer', '标签栏验收内容')])] }));
  const dataDir = join(root, 'data');
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for tabs fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: '继续使用当前模型', exact: true }), async button => { await button.click(); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText('标签栏验收内容', { exact: true }).waitFor({ timeout: 60000 });
  await capture('01-chat');
  const chatTab = page.getByRole('tab', { name: /工作区标签栏验收/ });
  await chatTab.waitFor();
  assert.equal(await chatTab.getAttribute('aria-selected'), 'true');
  checks.push('The current chat is the selected official workspace tab');
  const editor = page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true });
  await editor.fill('标签切换后保留的草稿');
  await page.getByRole('button', { name: '打开侧边面板标签页', exact: true }).click();
  await capture('02-new-tab');
  await page.getByRole('menuitem', { name: /^文件/ }).click();
  await page.getByRole('tab', { name: /文件/ }).waitFor();
  await capture('03-files');
  checks.push('The official + menu opens the existing Files tab');
  await page.keyboard.press('Control+1');
  await chatTab.and(page.locator('[aria-selected="true"]')).waitFor({ timeout: 3000 });
  checks.push('Ctrl+1 selects the chat through the official command handler');
  await page.keyboard.down('Control');
  await page.getByText('Ctrl+1', { exact: true }).waitFor({ timeout: 3000 });
  await capture('03-shortcuts');
  await page.keyboard.up('Control');
  checks.push('Holding Ctrl shows the official tab shortcut hints');
  await chatTab.click();
  assert.equal(await chatTab.getAttribute('aria-selected'), 'true');
  assert.ok((await editor.innerText()).includes('标签切换后保留的草稿'));
  checks.push('Returning to the chat keeps its unsent draft');
  await page.reload({ waitUntil: 'commit' });
  await page.getByText('标签栏验收内容', { exact: true }).waitFor({ timeout: 60000 });
  await chatTab.waitFor();
  assert.ok((await editor.innerText()).includes('标签切换后保留的草稿'));
  await capture('04-refresh');
  checks.push('Refresh keeps the official chat tab, route and draft');
  await page.setViewportSize({ width: 402, height: 874 });
  await capture('05-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('The 402px layout has no horizontal overflow');
  assert.equal(fake.calls('turn/start').length, 0);
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await app?.close();
  await fake.close();
  await rm(root, { recursive: true, force: true });
  console.log('Workspace tabs evidence:', output);
}
