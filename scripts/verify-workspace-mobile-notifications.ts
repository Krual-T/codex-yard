// Disposable source-workspace regression. Hold /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-mobile-notification-');
const output = resolve(process.env.AGENTS_MOBILE_NOTIFICATION_EVIDENCE ?? '.local/workspace-mobile-notifications');
const dataDir = join(root, 'data');
await mkdir(dataDir); await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Tablet fixture', path: root }]));
const fake = await createFakeCodex(root);
const id = (index: number) => '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
for (let index = 1; index <= 55; index++) {
  fake.threads.set(id(index), fixtureThread(id(index), root, { name: 'Chat ' + index,
    updatedAt: 1000 - index, recencyAt: 1000 - index,
    status: index === 2 ? { type: 'active', activeFlags: [] } : { type: 'idle' },
    turns: [fixtureTurn('turn-' + index, [agentItem('answer-' + index, 'Saved answer ' + index)], index === 2 ? 'inProgress' : 'completed')] }));
}
fake.readStates.set(id(52), { revision: 'older-unread', firstUnread: { type: 'turn', turnId: 'turn-52' } });
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), sourceWorkspace: true, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors: string[] = [], checks: string[] = [];
let page: Page | undefined;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16; Xiaomi Pad 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36' });
  await context.addInitScript(() => {
    const viewport = window.visualViewport!;
    let height: number | undefined, top = 0;
    for (const key of ['height', 'offsetTop'] as const) {
      const get = Object.getOwnPropertyDescriptor(VisualViewport.prototype, key)!.get!;
      Object.defineProperty(viewport, key, { configurable: true, get: () => height === undefined ? get.call(viewport) : key === 'height' ? height : top });
    }
    Object.assign(window, { setFixtureViewport(nextHeight: number, nextTop: number) {
      height = nextHeight; top = nextTop; viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
    } });
  });
  page = await context.newPage(); page.setDefaultTimeout(12_000);
  page.on('pageerror', error => errors.push(error.message));
  let release!: () => void;
  const blockedEntry = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/workbench-entry.js', async route => { await blockedEntry; await route.continue(); });
  await page.goto(app.url, { waitUntil: 'commit' });
  await page.waitForFunction(() => !!(window as Window & { electronBridge?: unknown }).electronBridge);
  const deliver = (page: Page, threadId: string) => page.evaluate(async threadId => {
    const channel = new MessageChannel();
    const acknowledged = new Promise(resolve => { channel.port1.onmessage = event => resolve(event.data); });
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { origin: location.origin,
      data: { type: 'yard-notification-navigate', url: '/?initialRoute=' + encodeURIComponent('/local/' + threadId) }, ports: [channel.port2] }));
    const ack = await acknowledged; channel.port1.close(); return ack;
  }, threadId);
  assert.equal(await deliver(page, id(1)), true);
  release();
  await page.getByText('Saved answer 1', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('initialRoute'), '/local/' + id(1));
  checks.push('A notification received before React starts is delivered when its router becomes ready');
  const editor = page.locator('[data-codex-composer="true"]');
  assert.equal(await editor.getAttribute('enterkeyhint'), 'send');
  await editor.fill('Keep this draft.');
  const documentId = await page.evaluate(() => { const id = crypto.randomUUID(); Object.assign(window, { fixtureDocumentId: id }); return id; });
  await deliver(page, id(3)); await page.getByText('Saved answer 3', { exact: true }).waitFor();
  await deliver(page, id(1)); await page.getByText('Saved answer 1', { exact: true }).waitFor();
  assert.equal(await editor.innerText(), 'Keep this draft.');
  assert.equal(await page.evaluate(() => (window as Window & { fixtureDocumentId?: string }).fixtureDocumentId), documentId);
  checks.push('A notification switches the existing page to its conversation and preserves the previous draft');
  await page.evaluate(() => (window as unknown as { setFixtureViewport(height: number, top: number): void }).setFixtureViewport(480, 0));
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-app-shell-frame]')!.getBoundingClientRect().bottom - 480) < 1);
  const footer = page.locator('.yard-source-composer-footer');
  assert.ok((await footer.boundingBox())!.y + (await footer.boundingBox())!.height <= 481);
  await page.screenshot({ path: join(output, 'keyboard-visible.png') });
  await page.evaluate(() => (window as unknown as { setFixtureViewport(height: number, top: number): void }).setFixtureViewport(450, 30));
  await page.waitForFunction(() => Math.abs(document.getElementById('root')!.getBoundingClientRect().top - 30) < 1);
  checks.push('The complete composer and toolbar fit above a resized and panned visual viewport');
  const device = await context.newCDPSession(page);
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 32 } });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const safeLayout = await page.evaluate(() => ({
    root: document.getElementById('root')!.getBoundingClientRect().bottom,
    frame: document.querySelector('[data-app-shell-frame]')!.getBoundingClientRect().bottom,
    toolbar: document.querySelector('.yard-source-composer-footer')!.getBoundingClientRect().bottom,
  }));
  assert.ok(safeLayout.root <= 449 && safeLayout.frame <= 449 && safeLayout.toolbar <= 449,
    'Viewport height must reserve the 32px system safe area: ' + JSON.stringify(safeLayout));
  await page.screenshot({ path: join(output, 'keyboard-safe-area.png') });
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 0 } });
  await device.detach();
  checks.push('Android system safe-area insets keep the composer and toolbar clear of the bottom overlay');
  await editor.fill('第一行'); await editor.press('Shift+Enter'); await editor.pressSequentially('第二行');
  assert.equal((await editor.innerText()).replace(/\n+/g, '\n'), '第一行\n第二行');
  assert.equal(fake.calls('turn/start').length, 0);
  await editor.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中文' }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 229, isComposing: true }));
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
  });
  assert.equal(fake.calls('turn/start').length, 0);
  await editor.fill('Android IME sends once'); await editor.press('Enter');
  await fake.waitForCall('turn/start');
  assert.equal(fake.calls('turn/start').length, 1);
  assert.equal((fake.calls('turn/start')[0]!.params.input as { text?: string }[])[0]?.text, 'Android IME sends once');
  checks.push('Android DOM-based Enter sends once; Shift+Enter inserts a newline and composing Enter does not send');
  await page.evaluate(() => (window as unknown as { setFixtureViewport(height: number, top: number): void }).setFixtureViewport(800, 0));
  const active = page.locator('[data-app-action-sidebar-thread-title="Chat 2"]').first();
  await active.click(); await page.getByText('Saved answer 2', { exact: true }).waitFor();
  await active.getByRole('status', { name: 'Working' }).waitFor();
  await page.evaluate(({ threadId }) => window.postMessage({ type: 'mcp-request', hostId: 'local', request: {
    id: 'restored-input', method: 'item/tool/requestUserInput', params: { threadId, turnId: 'turn-2', questions: [
      { id: 'choice', header: 'Choice', question: 'Continue?', options: [{ label: 'Continue', description: 'Continue fixture' }] },
    ] },
  } }, location.origin), { threadId: id(2) });
  await active.locator('[data-needs-input]').waitFor();
  await active.getByRole('status', { name: 'Working' }).waitFor();
  checks.push('Opening an active conversation and restoring its input request keeps the running circle and input hint');
  const recent = page.locator('[data-app-action-sidebar-section-heading="Recents"]');
  await recent.scrollIntoViewIfNeeded();
  for (let index = 0; index < 4; index++) {
    if (await recent.locator('[data-app-action-sidebar-thread-title="Chat 52"]').count()) break;
    const count = await recent.locator('[data-app-action-sidebar-thread-row]').count();
    await recent.locator('[data-source-recent-more]').evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForFunction(count => document.querySelectorAll(
      '[data-app-action-sidebar-section-heading="Recents"] [data-app-action-sidebar-thread-row]').length > count, count);
  }
  await page.waitForFunction(() => [...document.querySelectorAll('[data-app-action-sidebar-section-heading="Recents"] [data-app-action-sidebar-thread-row]')]
    [0]?.getAttribute('data-app-action-sidebar-thread-title') === 'Chat 52');
  checks.push('An unread thread from the second backend page sorts ahead of already loaded active and read threads');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, errors, renderer: 'react-ts', physicalKeyboard: false }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  await writeFile(join(output, 'failure.txt'), await page?.locator('body').ariaSnapshot().catch(() => '') ?? '');
  await writeFile(join(output, 'failure.json'), JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); }
