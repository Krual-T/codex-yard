// Run under /tmp/agents-workbench-heavy.lock. The daemon and chats are disposable fixtures.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
interface MenuSample { state: string | null; at: number; opacity: number }
interface MotionWindow extends Window { menuFrames: MenuSample[]; stopMenuFrames(): void }
async function applicationMotion(value: 'on' | 'system') {
  await page!.evaluate(async value => {
    const host = window as unknown as { electronBridge: { sendMessageFromView(message: unknown): Promise<void> } };
    const requestId = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const response = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'fetch-response' || event.data.requestId !== requestId) return;
        window.removeEventListener('message', response);
        if (event.data.responseType === 'error') reject(new Error(String(event.data.error)));
        else resolve();
      };
      window.addEventListener('message', response);
      void host.electronBridge.sendMessageFromView({ type: 'fetch', requestId,
        url: 'vscode://codex/set-setting', body: JSON.stringify({ key: 'reduced-motion-preference', value }) }).catch(reject);
    });
  }, value);
  await page!.reload({ waitUntil: 'commit' });
  await page!.getByText('标签栏验收内容', { exact: true }).waitFor({ timeout: 60000 });
  await page!.waitForFunction(reduced => document.documentElement.dataset.reducedMotion === String(reduced), value === 'on');
}
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  const threadId = '00000000-0000-4000-8000-000000000175';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.threads.set(threadId, fixtureThread(threadId, root, { name: '工作区标签栏验收',
    turns: [fixtureTurn('tabs-turn', [{ ...agentItem('tabs-answer', '标签栏验收内容'), phase: 'final_answer' }])] }));
  // Summary pages retain chat text in CLI 0.164; the shared fixture's empty
  // summary only suits tests which explicitly load their own item pages.
  fake.handlers.set('thread/turns/list', params => {
    const turns = [...fake.threads.get(String(params.threadId))!.turns];
    if (params.sortDirection !== 'asc') turns.reverse();
    const offset = Number(params.cursor ?? 0), limit = Number(params.limit ?? 5);
    return { data: turns.slice(offset, offset + limit).map(turn => ({ ...turn,
      items: params.itemsView === 'notLoaded' ? [] : turn.items, itemsView: params.itemsView ?? 'full',
    })), nextCursor: offset + limit < turns.length ? String(offset + limit) : null, backwardsCursor: null };
  });
  const dataDir = join(root, 'data');
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for tabs fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: '继续使用当前模型', exact: true }), async button => { await button.click(); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText('标签栏验收内容', { exact: true }).waitFor({ timeout: 60000 });
  // Exercise Presence's real enter/exit lifecycle, including focus restoration
  // and reopening while an exit is still in progress.
  await page.evaluate(() => {
    const host = window as unknown as MotionWindow;
    host.menuFrames = [];
    let frame = 0;
    const sample = () => {
      const menu = document.querySelector('[data-radix-menu-content]');
      if (menu) host.menuFrames.push({ state: menu.getAttribute('data-state'), at: performance.now(), opacity: Number(getComputedStyle(menu).opacity) });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    host.stopMenuFrames = () => cancelAnimationFrame(frame);
  });
  const appMenu = page.locator('#app-shell-sidebar button[aria-haspopup="menu"]')
    .filter({ has: page.locator('svg[viewBox="0 0 53.225983 18"]') });
  const menu = page.locator('[data-radix-menu-content]').first();
  await appMenu.click();
  await menu.waitFor();
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-radix-menu-content]');
    return menu && !menu.getAnimations().some(animation => animation.playState === 'running');
  });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await appMenu.evaluate(element => element === document.activeElement), true);
  const menuFrames = await page.evaluate(() => (window as unknown as MotionWindow).menuFrames);
  report.menuFrames = menuFrames;
  for (const state of ['open', 'closed']) {
    assert.ok(menuFrames.some(frame => frame.state === state && frame.opacity > 0 && frame.opacity < 1), state + ' must render intermediate opacity');
  }
  await appMenu.click();
  await menu.waitFor();
  // Trigger another open before the short exit completes. Only one menu may
  // remain, and Escape must still return keyboard focus to its trigger.
  const menuTriggerBounds = (await appMenu.boundingBox())!;
  await page.keyboard.press('Escape');
  await page.mouse.click(menuTriggerBounds.x + menuTriggerBounds.width / 2, menuTriggerBounds.y + menuTriggerBounds.height / 2);
  await menu.and(page.locator('[data-state="open"]')).waitFor();
  assert.equal(await page.locator('[data-radix-menu-content]').count(), 1);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  for (const reduced of ['system', 'application']) {
    if (reduced === 'system') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await applicationMotion('on');
    await appMenu.click();
    await menu.waitFor();
    const reducedState = await menu.evaluate(element => ({
      duration: Number.parseFloat(getComputedStyle(element).animationDuration),
      media: matchMedia('(prefers-reduced-motion: reduce)').matches,
      application: document.documentElement.getAttribute('data-reduced-motion'),
      durationToken: getComputedStyle(element).getPropertyValue('--yard-motion-normal'),
    }));
    report['reducedMotion:' + reduced] = reducedState;
    assert.equal(reducedState.duration, 0, reduced + ': ' + JSON.stringify(reducedState));
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    if (reduced === 'system') {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'false');
    } else await applicationMotion('system');
  }
  await page.evaluate(() => (window as unknown as Partial<MotionWindow>).stopMenuFrames?.());
  checks.push('Menus render intermediate enter/exit frames, restore focus, reopen during exit and respect system/application reduced motion');
  await capture('01-chat');
  assert.equal(await page.locator('[data-app-navigation-rail]').count(), 0);
  assert.ok(await page.locator('#app-shell-sidebar').isVisible());
  checks.push('Single-sidebar navigation keeps the conversation list without a separate icon rail');
  const chatTab = page.getByRole('tab', { name: /工作区标签栏验收/ });
  await chatTab.waitFor();
  assert.equal(await chatTab.getAttribute('aria-selected'), 'true');
  checks.push('The current chat is the selected official workspace tab');
  const editor = page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true });
  await editor.fill('标签切换后保留的草稿');
  await page.getByRole('button', { name: '新标签页', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).waitFor();
  const firstCard = page.locator('.yard-new-tab-card').first();
  const cardBounds = (await firstCard.boundingBox())!;
  await page.mouse.move(cardBounds.x + cardBounds.width / 2, cardBounds.y + cardBounds.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => {
    const card = document.querySelector('.yard-new-tab-card')!;
    return new DOMMatrixReadOnly(getComputedStyle(card).transform).m42 > 0;
  });
  // Release away from the card, leaving its navigation action unselected.
  await page.mouse.move(0, 0); await page.mouse.up();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.yard-new-tab-card')!).transform === 'none');
  checks.push('New-tab cards visibly respond to press and release without triggering a cancelled click');
  await capture('02-new-tab');
  assert.equal(await page.locator('.yard-new-tab-card').getByText('更改', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '退出完整视图', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).waitFor();
  for (const viewport of [{ width: 800, height: 1100 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await capture('02-side-panel-new-tab-' + viewport.width);
    for (const label of ['终端', '侧边聊天', '文件']) {
      assert.ok(await page.locator('.yard-new-tab-card').getByText(label, { exact: true }).isVisible());
    }
    assert.equal(await page.locator('.yard-new-tab-card').getByText('更改', { exact: true }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).waitFor();
  checks.push('The right-panel New tab keeps its search and cards in tablet portrait, landscape and after refresh');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '进入完整视图', exact: true }).click();
  await page.locator('.yard-new-tab-card').filter({ hasText: /^文件$/ }).click();
  await page.getByRole('tab', { name: /文件/ }).waitFor();
  await capture('03-files');
  checks.push('The + button opens New tab and its Files card opens the existing Files tab without a Changes card');
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
