// Hold /tmp/agents-workbench-heavy.lock. All chats, data and browser state are disposable.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

interface ViewportMetrics { height: number; offsetTop: number; scale: number }
type TestWindow = Window & { setTestViewport?: (metrics: ViewportMetrics) => void };
const root = await mkdtemp('/tmp/yard-mobile-input-');
const output = resolve(process.env.AGENTS_MOBILE_EVIDENCE ?? '.local/mobile-input');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(output, { recursive: true });
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Mobile fixture', path: root }]));
const fake = await createFakeCodex(root);
const id = process.env.AGENTS_TEST_THREAD_ID ?? '00000000-0000-4000-8000-000000000001';
const userText = '安卓 Chrome 与 iPhone Safari 的测试消息';
const longText = '长消息换行 ' + 'https://example.test/'.repeat(30);
const threadName = 'Mobile chat · 手机输入与顶部工具栏长标题布局验证';
const initialThread = fixtureThread(id, root, { name: threadName, turns: [fixtureTurn('fixture-turn', [
  { id: 'fixture-user', type: 'userMessage', clientId: null, content: [{ type: 'text', text: userText, text_elements: [] }] },
  agentItem('fixture-answer', 'Mobile fixture response'),
]), fixtureTurn('long-turn', [
  { id: 'long-user', type: 'userMessage', clientId: null, content: [{ type: 'text', text: longText, text_elements: [] }] },
  agentItem('long-answer', 'Long message response'),
])] });
fake.threads.set(id, structuredClone(initialThread));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/turns/list', params => ({
  data: [...fake.threads.get(String(params.threadId))!.turns].reverse().map(turn => ({ ...turn,
    items: params.itemsView === 'notLoaded' ? [] : turn.items, itemsView: params.itemsView ?? 'full',
  })), nextCursor: null, backwardsCursor: null,
}));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('turn/start', params => {
  const result = fake.defaultResult('turn/start', params);
  const thread = fake.threads.get(String(params.threadId))!;
  const turn = thread.turns.at(-1)!;
  setTimeout(() => {
    fake.broadcast({ method: 'turn/started', params: { threadId: thread.id, turn } });
    const item = agentItem('mobile-reply-' + turn.id, 'Mobile send response');
    turn.items.push(item);
    fake.broadcast({ method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item } });
    turn.status = 'completed'; thread.status = { type: 'idle' };
    fake.broadcast({ method: 'turn/completed', params: { threadId: thread.id, turn } });
  }, 10);
  return result;
});
async function createApp(name: string) {
  const caseData = join(root, name);
  await cp(dataDir, caseData, { recursive: true });
  return createNativeWorkbench({ port: 0, dataDir: caseData, workspace: root,
    socketPath: process.env.AGENTS_TEST_CODEX_SOCKET ?? fake.socketPath,
    codexHome: process.env.AGENTS_TEST_CODEX_HOME ?? join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
}
let app: Awaited<ReturnType<typeof createApp>> | undefined;
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: '26.1013.40934', realDaemonUsed: !!process.env.AGENTS_TEST_CODEX_SOCKET,
  viewport: 'Synthetic VisualViewport resize/scroll; no physical software keyboard or Safari engine' };

async function dismissOnboarding(page: Page) {
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
}
async function ready(page: Page, dismissNotice = true) {
  await page.locator('[data-codex-composer="true"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const notice = page.getByRole('button', { name: /^(不再显示|Don’t show again|Don't show again)$/ });
  if (dismissNotice && await notice.isVisible()) await notice.click();
}
async function resize(page: Page, metrics: ViewportMetrics) {
  await page.evaluate(metrics => (window as TestWindow).setTestViewport!(metrics), metrics);
  await page.waitForFunction(({ height, offsetTop, scale }) => {
    const box = document.getElementById('root')!.getBoundingClientRect();
    return scale === 1 ? Math.abs(box.height - height) < 1 && Math.abs(box.top - offsetTop) < 1
      : !document.documentElement.hasAttribute('data-workbench-mobile-viewport');
  }, metrics);
}
async function visibleComposer(page: Page, metrics: ViewportMetrics) {
  const editor = await page.locator('[data-codex-composer="true"]').boundingBox();
  const send = await page.getByRole('button', { name: /^(发送|Send)$/ }).boundingBox();
  for (const [label, box] of [['editor', editor], ['send', send]] as const) {
    assert.ok(box, label + ' must have a visible box');
    assert.ok(box.y >= metrics.offsetTop - 1 && box.y + box.height <= metrics.offsetTop + metrics.height + 1,
      label + ' must stay above the keyboard: ' + JSON.stringify({ box, metrics }));
  }
}
async function readableInput(page: Page) {
  const sizes = await page.locator('[data-codex-composer="true"]').evaluate(element => {
    const zoom = Number(getComputedStyle(element.closest('[data-app-shell-frame]')!).zoom);
    return [element, ...element.querySelectorAll('p, span')].map(node => parseFloat(getComputedStyle(node).fontSize) * zoom);
  });
  assert.ok(sizes.length && sizes.every(size => size >= 15.99), 'Focused editor text must be at least 16 rendered pixels: ' + sizes);
}
async function windowZoom(page: Page, value: number) {
  await page.evaluate(async value => {
    const host = window as unknown as { electronBridge: { sendMessageFromView(message: unknown): Promise<void> } };
    await host.electronBridge.sendMessageFromView({ type: 'persisted-atom-update', key: 'electron:window-zoom', value });
  }, value);
  await page.waitForFunction(value => Number(getComputedStyle(document.documentElement)
    .getPropertyValue('--codex-window-zoom') || 1) === value, value);
}
async function phoneHeader(page: Page) {
  const layout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-app-shell-titlebar]')!;
    const buttons = [...header.querySelectorAll<HTMLElement>('button')]
      .filter(element => !element.closest('[aria-hidden="true"], [inert]') && element.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
      // Tabs keep overflowed controls mounted in their horizontal scroller.
      // Inspect the controls that are actually painted and receive a tap.
      .filter(element => {
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === element;
      })
      .map(element => ({ label: element.getAttribute('aria-label'), ...element.getBoundingClientRect().toJSON() }));
    const trigger = buttons.find(button => button.label === '显示侧边栏');
    const slots = [...document.querySelectorAll<HTMLElement>('[data-app-shell-titlebar] > [data-app-shell-header-slot], [data-app-shell-main-toolbar-trailing-slot]')]
      .filter(element => element.checkVisibility({ visibilityProperty: true })).map(element => getComputedStyle(element).backgroundColor);
    return { buttons, trigger, slots, width: innerWidth, header: header.getBoundingClientRect().toJSON(),
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
  if (layout.width < 768) assert.ok(layout.trigger && layout.trigger.x < 24, 'The sidebar trigger must use the phone’s left edge');
  assert.ok(layout.buttons.every(button => button.x >= -1 && button.right <= layout.width + 1 && button.y >= layout.header.y - 1
    && button.bottom <= layout.header.bottom + 1), 'Header controls must fit: ' + JSON.stringify(layout));
  if (layout.width < 768) assert.ok(layout.slots.every(color => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'),
    'Narrow header slots must cover scrolled text');
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'The phone page must not scroll horizontally');
}

try {
  // iPhone 15: 393×852; iPhone 17: 402×874 CSS pixels at DPR 3, in both orientations.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 1280 }, { width: 390, height: 844 },
    { width: 393, height: 852 }, { width: 402, height: 874 }, { width: 360, height: 800 },
    { width: 844, height: 390 }, { width: 852, height: 393 }, { width: 874, height: 402 }]) {
    if (!process.env.AGENTS_TEST_CODEX_SOCKET) fake.threads.set(id, structuredClone(initialThread));
    app = await createApp('case-' + viewport.width);
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true,
      deviceScaleFactor: viewport.width < 500 || viewport.height < 500 ? 3 : 1 });
    await context.addInitScript(() => {
      const viewport = window.visualViewport!;
      let metrics: ViewportMetrics | null = null;
      for (const key of ['height', 'offsetTop', 'scale'] as const) {
        const get = Object.getOwnPropertyDescriptor(VisualViewport.prototype, key)!.get!;
        Object.defineProperty(viewport, key, { configurable: true, get: () => metrics?.[key] ?? get.call(viewport) });
      }
      (window as TestWindow).setTestViewport = next => {
        metrics = next;
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
      };
    });
    const page = await context.newPage();
    await dismissOnboarding(page);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.url, { waitUntil: 'commit' });
    await ready(page);
    let editor = page.locator('[data-codex-composer="true"]');
    assert.equal(await editor.evaluate(element => element === document.activeElement), false, 'Home must not focus the composer');
    const row = page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Mobile chat' }).first();
    if (await row.evaluate(element => !element.closest('[inert]'))) await row.tap();
    else await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
    await page.getByText('Mobile fixture response', { exact: true }).waitFor({ timeout: 20000 });
    await ready(page);
    editor = page.locator('[data-codex-composer="true"]');
    assert.equal(await editor.evaluate(element => element === document.activeElement), false, 'Entering a conversation must not focus the composer');
    checks.push(`${viewport.width}×${viewport.height}: home and conversation entry keep the keyboard closed`);
    await readableInput(page);
    if (viewport.width < 768 || viewport.height < 500) {
      await phoneHeader(page);
      const hideTabs = page.getByRole('button', { name: '隐藏标签页', exact: true });
      if (!await hideTabs.isVisible()) {
        await page.getByRole('button', { name: '退出完整视图', exact: true }).tap();
        await phoneHeader(page);
      }
      await hideTabs.tap();
      await phoneHeader(page);
      await page.screenshot({ path: join(output, `${viewport.width}-header.png`) });
      checks.push(`${viewport.width}×${viewport.height}: long-title header and controls fit with tabs shown and hidden`);
    }

    const bubble = page.locator('.bg-user-message').first();
    const bubbleStyle = await bubble.evaluate(element => {
      const style = getComputedStyle(element);
      return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), radius: parseFloat(style.borderTopLeftRadius), maxWidth: style.maxWidth };
    });
    assert.deepEqual(bubbleStyle, { left: 16, right: 16, radius: 22, maxWidth: '70%' });
    assert.equal(await page.locator('.bg-user-message').filter({ hasText: '长消息换行' }).first().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Long messages must wrap inside the bubble');
    assert.ok(await page.locator('head link[rel="stylesheet"][href*="user-message-"]').count() >= 1);
    checks.push(`${viewport.width}×${viewport.height}: message padding, radius, width and long-text wrapping are correct`);

    await editor.tap();
    assert.equal(await editor.evaluate(element => element === document.activeElement), true, 'A direct tap must focus the editor');
    const draft = '输入第一行，确认能看见\n第二行保留中文与 Safari';
    await editor.fill(draft);
    await readableInput(page);
    const draftHtml = await editor.innerHTML();
    const keyboard = { height: Math.max(240, Math.round(viewport.height * .55)), offsetTop: 0, scale: 1 };
    await resize(page, keyboard);
    await visibleComposer(page, keyboard);
    if (viewport.width === 393 || viewport.width === 402) {
      for (const zoom of [0.8, 1.25, 1]) {
        await windowZoom(page, zoom);
        await readableInput(page);
        await visibleComposer(page, keyboard);
      }
      checks.push(`${viewport.width}×${viewport.height}: editor text stays at least 16 rendered pixels at 80%, 125% and 100% app zoom`);
    }
    await resize(page, { ...keyboard, offsetTop: 48 });
    await visibleComposer(page, { ...keyboard, offsetTop: 48 });
    assert.equal(await editor.innerHTML(), draftHtml);
    await page.screenshot({ path: join(output, `${viewport.width}-keyboard.png`) });
    await resize(page, { height: viewport.height, offsetTop: 0, scale: 1 });
    await visibleComposer(page, { height: viewport.height, offsetTop: 0, scale: 1 });
    assert.equal(await editor.innerHTML(), draftHtml);
    await resize(page, { ...keyboard, scale: 2 });
    await resize(page, { height: viewport.height, offsetTop: 0, scale: 1 });
    checks.push(`${viewport.width}×${viewport.height}: tap-to-type, keyboard resize/scroll, close and pinch zoom preserve the draft and visible controls`);
    await page.getByRole('button', { name: /^(发送|Send)$/ }).tap();
    if (!process.env.AGENTS_TEST_CODEX_SOCKET) await fake.waitFor(message => message.method === 'turn/start' && JSON.stringify(message.params.input).includes('输入第一行'), 10000);
    await page.getByRole('region', { name: /^(Conversation|对话)$/ }).getByText('输入第一行，确认能看见', { exact: false }).last().waitFor();
    await page.getByRole('button', { name: /^(发送|Send)$/ }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-codex-composer="true"]')?.textContent?.trim() === '');
    checks.push(`${viewport.width}×${viewport.height}: the draft sends through the existing conversation flow`);
    const newChat = page.getByRole('button', { name: '在 Mobile fixture 中开始新聊天', exact: true });
    if (await newChat.count() && await newChat.evaluate(element => !element.closest('[inert]'))) {
      await newChat.tap();
      await ready(page);
      assert.equal(await page.locator('[data-codex-composer="true"]').evaluate(element => element === document.activeElement), false);
      checks.push(`${viewport.width}×${viewport.height}: starting another chat releases composer focus`);
    }
    await context.close();
    await app.close(); app = undefined;
  }
  if (!process.env.AGENTS_TEST_CODEX_SOCKET) {
    app = await createApp('startup-phone');
    const startup = await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
    const page = await startup.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await dismissOnboarding(page);
    await page.addInitScript(() => localStorage.setItem('native-atoms', JSON.stringify({ 'electron:window-zoom': 0.8 })));
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/assets/app-shared-*.js', async route => { await pending; await route.continue(); });
    try {
      await page.goto(app.url, { waitUntil: 'commit' });
      const early = page.locator('#pending-yard-home-input');
      await early.waitFor();
      const pixels = await early.evaluate(element => parseFloat(getComputedStyle(element).fontSize)
        * Number(getComputedStyle(document.getElementById('yard-startup')!).zoom));
      assert.ok(pixels >= 15.99, 'Startup input must also avoid Safari focus zoom: ' + pixels);
      await early.tap();
      await early.fill('手机启动阶段输入草稿');
      await page.screenshot({ path: join(output, 'startup-phone.png') });
    } finally { release(); }
    await ready(page);
    await page.waitForFunction(() => !document.getElementById('yard-startup'));
    await readableInput(page);
    assert.equal((await page.locator('[data-codex-composer="true"]').innerText()).trim(), '手机启动阶段输入草稿');
    checks.push('402×874: startup editor at 80% zoom keeps 16 rendered pixels and transfers its draft to the full composer');
    await startup.close();
    await app.close(); app = undefined;
  }
  if (!process.env.AGENTS_TEST_CODEX_SOCKET) fake.threads.set(id, structuredClone(initialThread));
  app = await createApp('desktop');
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await dismissOnboarding(desktop);
  desktop.on('pageerror', error => errors.push(error.message));
  await desktop.goto(app.url, { waitUntil: 'commit' });
  await ready(desktop);
  await desktop.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Mobile chat' }).first().click();
  await desktop.getByText('Mobile fixture response', { exact: true }).waitFor({ timeout: 20000 });
  // Dismissing the access warning intentionally moves focus away from the
  // editor. Check the renderer's navigation focus before that user action.
  await ready(desktop, false);
  await desktop.waitForFunction(() => document.querySelector('[data-codex-composer="true"]') === document.activeElement);
  assert.equal(await desktop.locator('[data-codex-composer="true"]').evaluate(element => element === document.activeElement), true);
  assert.equal(await desktop.evaluate(() => document.documentElement.hasAttribute('data-workbench-mobile-viewport')), false);
  checks.push('Desktop retains its original autofocus and page layout');
  await desktop.close();
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (cause) {
  report.ok = false; report.failure = String(cause);
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    report.layout = await page.locator('[data-codex-composer="true"]').first().evaluate(element => {
      const ancestors = [];
      for (let node: HTMLElement | null = element as HTMLElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display !== 'contents') ancestors.push({ tag: node.tagName, id: node.id, classes: node.className.slice(0, 180),
          height: node.getBoundingClientRect().height, cssHeight: style.height, minHeight: style.minHeight, position: style.position });
      }
      return ancestors;
    }).catch(() => []);
    await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
    await writeFile(join(output, `failure-${index}.txt`), await page.locator('body').ariaSnapshot()).catch(() => {});
  }
  throw cause;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
