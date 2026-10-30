// Run under /tmp/agents-workbench-heavy.lock. The daemon and chats are disposable fixtures.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';
import { isolatePublicVerifier, publicVerifierConfigurationFetch } from './public-verifier-environment.ts';

const root = await mkdtemp(join(tmpdir(), 'aw-tabs-'));
const output = process.env.AGENTS_TABS_EVIDENCE
  ? resolve(process.env.AGENTS_TABS_EVIDENCE) : await mkdtemp(join(tmpdir(), 'yard-tabs-evidence-'));
await isolatePublicVerifier(root);
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [];
const checks: string[] = [], gaps: string[] = [];
const report: Record<string, unknown> = { renderer: 'owned', realDaemonUsed: false, checks, gaps, errors };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
try {
  const threadId = '00000000-0000-4000-8000-000000000175';
  const secondId = '00000000-0000-4000-8000-000000000174';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.threads.set(threadId, fixtureThread(threadId, root, { name: '工作区标签栏验收',
    turns: [fixtureTurn('tabs-turn', [agentItem('tabs-answer', '标签栏验收内容')])] }));
  fake.threads.set(secondId, fixtureThread(secondId, root, { name: '另一个标签',
    turns: [fixtureTurn('tabs-second-turn', [agentItem('tabs-second-answer', '第二个对话')])] }));
  await writeFile(join(root, 'tabs-fixture.txt'), 'Isolated tab file\n');
  const fileRpc = fileDaemonFixture();
  for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, params));
  const dataDir = join(root, 'data');
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: publicVerifierConfigurationFetch });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.goto(app.url + '/local/' + threadId, { waitUntil: 'commit' });
  await page.locator('[data-owned-renderer="true"]').waitFor();
  await page.getByText('标签栏验收内容', { exact: true }).waitFor({ timeout: 60000 });
  await capture('01-chat');
  const chatTab = page.getByRole('tab', { name: /工作区标签栏验收/ });
  await page.locator('.yard-owned-sidebar-project').getByRole('button', { name: '另一个标签', exact: true }).click();
  await page.getByRole('tab', { name: '另一个标签', exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
  await chatTab.click();
  await chatTab.and(page.locator('[aria-selected="true"]')).waitFor();
  assert.equal(await chatTab.getAttribute('aria-selected'), 'true');
  checks.push('The current chat is the selected owned workspace tab');
  const editor = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作)$/ });
  await editor.fill('标签切换后保留的草稿');
  const sidePanelMenu = page.locator('summary[aria-label="Open side panel"]');
  await sidePanelMenu.click();
  await page.getByRole('menuitem', { name: 'Workspace files', exact: true }).click();
  await sidePanelMenu.click();
  await capture('02-new-tab');
  await page.getByRole('button', { name: 'tabs-fixture.txt', exact: true }).click();
  await page.getByRole('tab', { name: 'tabs-fixture.txt', exact: true }).waitFor();
  await capture('03-files');
  checks.push('The owned workspace panel opens a real fixture file tab');
  await page.locator('.yard-owned-sidebar-project').getByRole('button', { name: '另一个标签', exact: true }).click();
  const secondTab = page.getByRole('tab', { name: '另一个标签', exact: true });
  await secondTab.and(page.locator('[aria-selected="true"]')).waitFor();
  await page.getByText('第二个对话', { exact: true }).waitFor({ timeout: 60000 });
  await page.locator('.yard-conversation:not([inert])').waitFor();
  report.shortcutContext = await page.evaluate(() => ({
    activeElement: document.activeElement?.outerHTML,
    blockingOverlays: [...document.querySelectorAll('[role="dialog"], [role="menu"]')]
      .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'))
      .map(element => ({ html: element.outerHTML, detailsOpen: element.closest('details')?.open ?? null,
        visibility: getComputedStyle(element).visibility, bounds: element.getBoundingClientRect().toJSON() })),
  }));
  await page.keyboard.press('Control+1');
  try {
    await chatTab.and(page.locator('[aria-selected="true"]')).waitFor({ timeout: 2000 });
    checks.push('Ctrl+1 selects the first workspace tab');
  } catch { gaps.push('Ctrl+1 did not select the first workspace tab'); }
  await page.keyboard.down('Control');
  try {
    await page.getByText('Ctrl+1', { exact: true }).waitFor({ timeout: 2000 });
    await capture('03-shortcuts');
    checks.push('Holding Ctrl shows the workspace tab shortcut hints');
  } catch { gaps.push('Holding Ctrl did not show the original tab shortcut hints'); }
  finally { await page.keyboard.up('Control'); }
  await chatTab.click();
  await chatTab.and(page.locator('[aria-selected="true"]')).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
    .some(input => ['和 Codex 一起工作', '与 Codex 协作'].includes(input.getAttribute('aria-label') ?? '') && input.value.includes('标签切换后保留的草稿')));
  assert.ok((await editor.inputValue()).includes('标签切换后保留的草稿'));
  checks.push('Returning to the chat keeps its unsent draft');
  await page.reload({ waitUntil: 'commit' });
  await page.getByText('标签栏验收内容', { exact: true }).waitFor({ timeout: 60000 });
  await chatTab.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
    .some(input => ['和 Codex 一起工作', '与 Codex 协作'].includes(input.getAttribute('aria-label') ?? '') && input.value.includes('标签切换后保留的草稿')));
  await capture('04-refresh');
  checks.push('Refresh keeps the chat tab, route and draft');
  await page.setViewportSize({ width: 402, height: 874 });
  await capture('05-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('The 402px layout has no horizontal overflow');
  assert.equal(fake.calls('turn/start').length, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(gaps, [], 'Original workspace tab shortcuts must be available');
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
