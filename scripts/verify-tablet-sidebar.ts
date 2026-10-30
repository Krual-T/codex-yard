// The renderer is real; projects, conversations and daemon are disposable fixtures.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page, Locator } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread } from '../test/fake-codex.ts';
import { isolatePublicVerifier, publicVerifierConfigurationFetch } from './public-verifier-environment.ts';

const root = await mkdtemp(join(tmpdir(), 'yard-tablet-'));
const output = process.env.AGENTS_TABLET_EVIDENCE
  ? resolve(process.env.AGENTS_TABLET_EVIDENCE) : await mkdtemp(join(tmpdir(), 'yard-tablet-evidence-'));
await isolatePublicVerifier(root);
const fake = await createFakeCodex(root);
const dataDir = join(root, 'data');
const projectPath = join(root, 'project');
const checks: string[] = [], errors: string[] = [];
await mkdir(dataDir);
await mkdir(projectPath);
await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Tablet Project', path: projectPath }]));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
for (let index = 0; index < 65; index++) {
  const id = '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
  fake.threads.set(id, fixtureThread(id, index % 2 ? root : projectPath, { name: 'Tablet chat ' + String(index).padStart(2, '0'), updatedAt: 1700000000 + index }));
}
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: publicVerifierConfigurationFetch });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
const report: Record<string, unknown> = { checks, errors, realDaemonUsed: false, renderer: 'owned' };

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
    const page = await browser.newPage({ viewport, hasTouch: true, isMobile: true, locale: 'zh-CN' });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(app.url, { waitUntil: 'commit' });
    await page.locator('[data-owned-renderer="true"]').waitFor();
    const first = page.locator('.yard-owned-sidebar-project .yard-owned-sidebar-thread').first();
    await first.waitFor({ timeout: 60000 });
    const scroller = page.locator('.yard-owned-sidebar-scroll');
    const newChat = page.getByRole('button', { name: /^(New chat in Tablet Project|在此项目新建对话： Tablet Project)$/ });
    assert.ok(await visibleThroughAncestors(newChat), 'project new-chat action must be visible without hover');
    await page.screenshot({ path: join(output, `${viewport.width}-project-action.png`) });
    const project = page.getByRole('button', { name: 'Tablet Project', exact: true });
    await project.tap(); assert.equal(await project.getAttribute('aria-expanded'), 'false');
    await project.tap(); assert.equal(await project.getAttribute('aria-expanded'), 'true');
    const box = await first.boundingBox();
    assert.ok(box);
    await swipe(page, box.x + 80, box.y + 15, -150);
    await page.waitForFunction(() => (document.querySelector('.yard-owned-sidebar-scroll')?.scrollTop ?? 0) > 30);
    const projectScroll = await scroller.evaluate(element => element.scrollTop);
    checks.push(`${viewport.width}px: a swipe on a project conversation scrolls (${projectScroll}px)`);
    const scrollBox = await scroller.boundingBox();
    assert.ok(scrollBox);
    await swipe(page, scrollBox.x + 80, scrollBox.y + 80, 150);
    await page.waitForFunction(before => (document.querySelector('.yard-owned-sidebar-scroll')?.scrollTop ?? 0) < before, projectScroll);
    checks.push(`${viewport.width}px: the reverse swipe scrolls upward`);
    const recent = page.locator('.yard-owned-sidebar-recents + div > .yard-owned-sidebar-thread').first();
    await recent.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const recentBox = await recent.boundingBox();
    assert.ok(recentBox);
    const beforeRecent = await scroller.evaluate(element => element.scrollTop);
    assert.ok(beforeRecent > 30);
    await swipe(page, recentBox.x + 80, recentBox.y + 15, 150);
    await page.waitForFunction(before => (document.querySelector('.yard-owned-sidebar-scroll')?.scrollTop ?? 0) < before, beforeRecent);
    checks.push(`${viewport.width}px: a swipe on a recent conversation also scrolls`);
    await settleScroll(page, scroller);
    const previousResumes = fake.calls('thread/resume').length;
    await first.tap();
    await fake.waitFor(message => message.method === 'thread/resume' && fake.calls('thread/resume').length > previousResumes, 10000);
    assert.ok(fake.calls('thread/resume').length > previousResumes, 'touch taps must still open a conversation');
    checks.push(`${viewport.width}px: tapping a conversation still opens it`);
    await newChat.tap();
    await page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作)$/ }).waitFor();
    await page.screenshot({ path: join(output, `${viewport.width}-new-chat.png`) });
    const editor = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作)$/ });
    const prompt = `Tablet project test ${viewport.width}`;
    await editor.fill(prompt);
    await page.getByRole('button', { name: /^(Send|发送)$/ }).tap();
    await fake.waitFor(message => message.method === 'turn/start' && JSON.stringify(message.params.input).includes(prompt), 10000);
    const call = fake.calls('thread/start').at(-1);
    assert.equal(call?.params.cwd, projectPath, 'the project action preserves the selected project');
    checks.push(`${viewport.width}px: tap the visible project action and send a chat in that project`);
    await page.close();
  }
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on('pageerror', error => errors.push(error.message));
  desktop.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await desktop.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await desktop.goto(app.url, { waitUntil: 'commit' });
  const row = desktop.locator('.yard-owned-sidebar-project .yard-owned-sidebar-thread').first();
  await row.waitFor({ timeout: 60000 });
  const projectRows = desktop.locator('.yard-owned-sidebar-project .yard-owned-sidebar-thread');
  await desktop.waitForFunction(() => document.querySelectorAll('.yard-owned-sidebar-project .yard-owned-sidebar-thread').length > 12);
  const scroller = desktop.locator('.yard-owned-sidebar-scroll');
  await row.hover();
  await desktop.mouse.wheel(0, 220);
  await desktop.waitForFunction(() => (document.querySelector('.yard-owned-sidebar-scroll')?.scrollTop ?? 0) > 30);
  checks.push('Desktop mouse wheel still scrolls the sidebar');
  await settleScroll(desktop, scroller);
  await row.click();
  assert.ok(fake.calls('thread/resume').length > 0);
  checks.push('Desktop conversation selection still reaches the daemon');
  const extraRow = projectRows.nth(12);
  const extraTitle = (await extraRow.innerText()).trim();
  const extraThread = [...fake.threads.values()].find(thread => thread.name === extraTitle);
  assert.ok(extraThread, 'The additional project row must map to its real fixture thread');
  await extraRow.click();
  await fake.waitFor(message => message.method === 'thread/resume' && message.params.threadId === extraThread.id);
  checks.push('Additional project conversations remain accessible beyond the original collapsed limit');
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
