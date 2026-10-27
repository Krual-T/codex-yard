// The renderer is real; projects, conversations and daemon are disposable fixtures.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page, Locator } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-tablet-');
const output = resolve(process.env.AGENTS_TABLET_EVIDENCE ?? '.local/tablet-sidebar-verification');
const fake = await createFakeCodex(root);
const dataDir = join(root, 'data');
const checks: string[] = [], errors: string[] = [];
await mkdir(dataDir);
await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Tablet Project', path: root }]));
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
for (let index = 0; index < 65; index++) {
  const id = '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
  fake.threads.set(id, fixtureThread(id, root, { name: 'Tablet chat ' + String(index).padStart(2, '0'), updatedAt: 1700000000 + index }));
}
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  ...(process.env.AGENTS_TEST_RENDERER ? { renderer: process.env.AGENTS_TEST_RENDERER } : {}),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Fixture telemetry disabled', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report: Record<string, unknown> = { checks, errors, realDaemonUsed: false, renderer: '26.1013.40934' };

async function settleScroll(page: Page, scroller: Locator, top = 0) {
  await scroller.evaluate((element, position) => { element.scrollTop = position; }, top);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function swipe(page: Page, x: number, y: number, distance: number) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance * step / 10 }] });
      // Pace real input events; this is gesture duration, not a readiness delay.
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

async function visibleThroughAncestors(button: Locator) {
  return button.evaluate(element => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;
    }
    return element.getBoundingClientRect().width > 0;
  });
}

try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 1280 }]) {
    const page = await browser.newPage({ viewport, hasTouch: true, isMobile: true });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.url, { waitUntil: 'commit' });
    const first = page.locator('[data-app-action-sidebar-thread-row]').first();
    await first.waitFor({ timeout: 60000 });
    const scroller = page.locator('#app-shell-sidebar .sidebar-navigation .overflow-y-auto').first();
    const newChat = page.getByRole('button', { name: '在 Tablet Project 中开始新聊天', exact: true });
    assert.ok(await visibleThroughAncestors(newChat), 'project new-chat action must be visible without hover');
    await page.screenshot({ path: join(output, `${viewport.width}-project-action.png`) });
    // Expand the project so portrait also has enough content to scroll.
    await page.getByRole('button', { name: '展开显示', exact: true }).first().tap();
    const box = await first.boundingBox();
    assert.ok(box);
    await swipe(page, box.x + 80, box.y + 15, -150);
    await page.waitForFunction(() => (document.querySelector('#app-shell-sidebar .sidebar-navigation .overflow-y-auto')?.scrollTop ?? 0) > 30);
    const projectScroll = await scroller.evaluate(element => element.scrollTop);
    checks.push(`${viewport.width}px: a swipe on a project conversation scrolls (${projectScroll}px)`);
    const scrollBox = await scroller.boundingBox();
    assert.ok(scrollBox);
    await swipe(page, scrollBox.x + 80, scrollBox.y + 80, 150);
    await page.waitForFunction(before => (document.querySelector('#app-shell-sidebar .sidebar-navigation .overflow-y-auto')?.scrollTop ?? 0) < before, projectScroll);
    checks.push(`${viewport.width}px: the reverse swipe scrolls upward`);
    const recent = page.locator('#app-shell-sidebar section').filter({ has: page.getByRole('button', { name: '最近', exact: true }) })
      .locator('[data-app-action-sidebar-thread-row]').nth(12);
    await recent.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const recentBox = await recent.boundingBox();
    assert.ok(recentBox);
    const beforeRecent = await scroller.evaluate(element => element.scrollTop);
    assert.ok(beforeRecent > 30);
    await swipe(page, recentBox.x + 80, recentBox.y + 15, 150);
    await page.waitForFunction(before => (document.querySelector('#app-shell-sidebar .sidebar-navigation .overflow-y-auto')?.scrollTop ?? 0) < before, beforeRecent);
    checks.push(`${viewport.width}px: a swipe on a recent conversation also scrolls`);
    await settleScroll(page, scroller);
    const previousResumes = fake.calls('thread/resume').length;
    await first.tap();
    await fake.waitFor(message => message.method === 'thread/resume' && fake.calls('thread/resume').length > previousResumes, 10000);
    assert.ok(fake.calls('thread/resume').length > previousResumes, 'touch taps must still open a conversation');
    checks.push(`${viewport.width}px: tapping a conversation still opens it`);
    await newChat.tap();
    await page.getByRole('textbox', { name: '随心输入', exact: true }).waitFor();
    await page.screenshot({ path: join(output, `${viewport.width}-new-chat.png`) });
    const editor = page.getByRole('textbox', { name: '随心输入', exact: true });
    const prompt = `Tablet project test ${viewport.width}`;
    await editor.fill(prompt);
    await page.getByRole('button', { name: '发送', exact: true }).tap();
    await fake.waitFor(message => message.method === 'turn/start' && JSON.stringify(message.params.input).includes(prompt), 10000);
    const call = fake.calls('thread/start').at(-1);
    assert.equal(call?.params.cwd, root, 'the native project action preserves the selected project');
    checks.push(`${viewport.width}px: tap the visible project action and send a chat in that project`);
    await page.close();
  }
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(app.url, { waitUntil: 'commit' });
  const row = desktop.locator('[data-app-action-sidebar-thread-row]').first();
  await row.waitFor({ timeout: 60000 });
  const scroller = desktop.locator('#app-shell-sidebar .sidebar-navigation .overflow-y-auto').first();
  await desktop.getByRole('button', { name: '展开显示', exact: true }).first().click();
  await row.hover();
  await desktop.mouse.wheel(0, 220);
  await desktop.waitForFunction(() => (document.querySelector('#app-shell-sidebar .sidebar-navigation .overflow-y-auto')?.scrollTop ?? 0) > 30);
  checks.push('Desktop mouse wheel still scrolls the sidebar');
  await settleScroll(desktop, scroller);
  await row.click();
  assert.ok(fake.calls('thread/resume').length > 0);
  checks.push('Desktop conversation selection still reaches the daemon');
  await desktop.close();
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (cause) {
  report.ok = false;
  report.failure = String(cause);
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
    await writeFile(join(output, `failure-${index}.txt`), await page.locator('body').ariaSnapshot()).catch(() => {});
  }
  throw cause;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
