import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import WebSocket, { WebSocketServer } from 'ws';
import { ClientChromeBroker } from '../src/browser-reuse/client-broker.ts';
import { ChromePanelHost } from '../src/browser-reuse/panel-host.ts';
import { ChromePanelRouter } from '../src/browser-reuse/panel-router.ts';
import type { ClientChromeMessage, ConnectionRequest } from '../src/browser-reuse/client-protocol.ts';
import type { ChromeRequest } from '../src/browser-reuse/protocol.ts';
import type { ToolResult } from '../src/browser-reuse/chrome-mcp.ts';

interface Reference { id: string; text: string; kind: string; context: Record<string, unknown>; original: Record<string, unknown> }
interface Harness {
  mount(identity: { hostId: string; threadId: string | null; draftId: string; browserTabId: string }): void;
  unmount(): void;
  visible(value: boolean): void;
  identity(): { hostId: string; threadId: string | null; draftId: string; browserTabId: string } | null;
  draft(): { text: string; references: Reference[] };
  setText(value: string): void;
  adopt(key: string): Promise<void>;
  acknowledge(references: Reference[]): Promise<void>;
  references(): Reference[];
}
declare global { interface Window { browserHarness: Harness } }

test('owned React Chrome uses the broker and preserves qualified references across pages',
  { skip: !existsSync('/usr/bin/google-chrome'), timeout: 120_000 }, async () => {
  const app = await build({ entryPoints: ['test/browser-owned-fixture.tsx'], bundle: true, write: false, format: 'iife' });
  const broker = new ClientChromeBroker({ configured: false, label: 'Fixture server' }, 15_000);
  const sockets = new WebSocketServer({ noServer: true });
  const routers = new Map<string, ChromePanelRouter>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const pages = [{ id: 1, url: 'https://fixture.invalid/one', selected: true }, { id: 2, url: 'https://fixture.invalid/two', selected: false }];
  let jpeg = '', delaySelection = false, selectedPending = false, releaseSelection: (() => void) | undefined;
  let failText = false;
  const selected = { kind: 'element', frameUrl: 'https://fixture.invalid/frame', framePath: ['frame-1'], title: 'Selected button',
    immediateText: 'Submit', role: 'button', name: 'Send', selector: '#send', elementPath: 'main > #send', nearbyText: 'Form',
    rect: { x: 2, y: 3, width: 60, height: 30 }, elementMetadata: { tag: 'button', colors: 'red', extra: 'kept' } };
  const tools = { async close() {}, async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    calls.push({ name, args });
    if (name === 'list_pages') return { content: [], structuredContent: { pages } };
    if (name === 'take_snapshot') return { content: [{ type: 'text', text: 'uid=3_1 button "Selected button" [selected in the DevTools Elements panel]' }] };
    if (name === 'take_screenshot') return { content: [{ type: 'image', mimeType: 'image/jpeg', data: jpeg }] };
    if (name === 'evaluate_script' && args.args) {
      if (delaySelection) { selectedPending = true; await new Promise<void>(resolve => { releaseSelection = resolve; }); selectedPending = false; }
      return { content: [{ type: 'text', text: '```json\n' + JSON.stringify(selected) + '\n```' }] };
    }
    if (name === 'evaluate_script') {
      const page = pages.find(item => item.id === args.pageId)!;
      return { content: [{ type: 'text', text: JSON.stringify({ url: page.url, title: 'Fixture', width: 800, height: 600, canGoBack: true, canGoForward: false }) }] };
    }
    if (name === 'type_text' && failText) throw new Error('synthetic input failed');
    if (name === 'navigate_page' && args.type === 'url') pages.find(item => item.id === args.pageId)!.url = String(args.url);
    return { content: [] };
  } };
  let origin = '';
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(app.outputFiles[0]!.text); return; }
      if (request.url === '/host' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const { endpoint, params } = JSON.parse(Buffer.concat(chunks).toString()) as { endpoint: string; params: Record<string, unknown> };
        const session = String(request.headers['x-fixture-session']);
        let router = routers.get(session);
        if (!router) { router = new ChromePanelRouter(undefined, broker, () => {}, origin); routers.set(session, router); }
        const value = endpoint === 'chrome-connections' ? broker.connections(params as unknown as ConnectionRequest)
          : endpoint === 'chrome-browser' ? await router.request(params as unknown as ChromeRequest) : (() => { throw new Error('Unexpected endpoint'); })();
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ value })); return;
      }
      response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: (error as Error).message })); }
  });
  server.on('upgrade', (request, socket, head) => {
    const key = broker.authorize(request);
    if (!key) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, connection => broker.attach(key, connection, 'Synthetic Chrome'));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  const host = new ChromePanelHost({ browserUrl: 'http://127.0.0.1:9222' }, () => {}, origin, async () => tools);
  const profile = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'owned-browser-profile-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let companion: WebSocket | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: '/usr/bin/google-chrome', headless: true,
      args: ['--no-sandbox'], viewport: { width: 1100, height: 850 } });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(origin);
    jpeg = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      const draw = canvas.getContext('2d')!; draw.fillStyle = '#488'; draw.fillRect(0, 0, 800, 600); return canvas.toDataURL('image/jpeg').split(',')[1]!; });
    const identity = { hostId: 'local', threadId: 'fixture', draftId: 'draft-a', browserTabId: 'tab-a' };
    const legacy = { type: 'comment', origin: 'browser', content: [{ content_type: 'text', text: 'User edited legacy', extra: 1 }],
      position: { side: 'right', path: 'browser:Old', line: 1 }, localBrowserContext: { pageUrl: 'https://old.invalid/', framePath: ['old-frame'],
        targetDescription: 'Old', targetRole: 'link', targetSelector: '#old', elementMetadata: { extra: 5 }, unknownContext: { keep: true } },
      localBrowserCommentMetadata: { commentId: 'legacy-id', kind: 'element', hasAnnotationFeatures: true, extra: 6 }, unknown: { keep: 7 } };
    await page.evaluate(({ identity, legacy }) => {
      localStorage.setItem('workbench.chrome-client.v1', 'saved_client_identity_12345678901234567890');
      localStorage.setItem('workbench.browser-comments.v1', JSON.stringify({ fixture: [legacy, { unknown: 'preserve' }],
        'another-ambiguous-thread': [{ value: 1 }], 'new-conversation': [{ home: true }], 'panel-new-conversation': [{ panel: true }] }));
      window.browserHarness.mount(identity);
    }, { identity, legacy });
    await page.getByRole('button', { name: '连接这台电脑' }).click();
    const command = await page.getByLabel('这台电脑的配对命令').inputValue();
    const token = command.match(/--pair '([^']+)'/)?.[1];
    assert.ok(token);
    companion = new WebSocket(`ws://127.0.0.1:${address.port}/chrome-client`, { headers: { Authorization: `Bearer ${token}` } });
    companion.on('message', data => {
      const message = JSON.parse(String(data)) as ClientChromeMessage | { type: 'paired' };
      if (message.type !== 'request') return;
      void host.request(message.request).then(state => companion!.send(JSON.stringify({ type: 'result', id: message.id, state })),
        error => companion!.send(JSON.stringify({ type: 'result', id: message.id, error: (error as Error).message })));
    });
    await once(companion, 'open');
    await page.getByText('已配对', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('workbench.chrome-client.v1')), 'saved_client_identity_12345678901234567890');
    assert.equal(await page.getByLabel('浏览器引用批注').count(), 0, 'Ambiguous bare owner is not inferred');
    await page.getByLabel('已有 Chrome 标签').selectOption('1');
    const image = page.getByAltText('Chrome 标签的最新画面');
    await image.waitFor();
    await image.click({ position: { x: 100, y: 100 } });
    await image.press('ArrowLeft');
    await page.getByLabel('向网页输入').fill('中文输入');
    await page.getByLabel('向网页输入').dispatchEvent('compositionstart');
    await page.getByLabel('向网页输入').press('Enter');
    assert.equal(calls.some(call => call.name === 'type_text'), false, 'Composition Enter does not send');
    await page.getByLabel('向网页输入').dispatchEvent('compositionend');
    await page.getByRole('button', { name: '输入', exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector('[aria-label="向网页输入"]') as HTMLInputElement).value);
    assert.ok(calls.some(call => call.name === 'click_at' && call.args.pageId === 1));
    assert.ok(calls.some(call => call.name === 'press_key' && call.args.key === 'ArrowLeft'));
    assert.ok(calls.some(call => call.name === 'type_text' && call.args.text === '中文输入'));
    failText = true;
    await page.getByLabel('向网页输入').fill('保留失败输入');
    await page.getByRole('button', { name: '输入', exact: true }).click();
    await page.getByText('synthetic input failed').waitFor();
    assert.equal(await page.getByLabel('向网页输入').inputValue(), '保留失败输入');
    failText = false;
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.getByLabel('已有 Chrome 标签').selectOption('2');
    await page.waitForFunction(() => (document.querySelector('[aria-label="已有 Chrome 标签"]') as HTMLSelectElement)?.value === '2');
    await page.getByLabel('网页地址').fill('https://fixture.invalid/navigated');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'https://fixture.invalid/navigated');
    assert.ok(calls.some(call => call.name === 'navigate_page' && call.args.url === 'https://fixture.invalid/navigated'));

    await page.evaluate(value => window.browserHarness.mount(value), { ...identity, hostId: 'ssh-fixture' });
    await page.waitForFunction(() => window.browserHarness.identity()?.hostId === 'ssh-fixture' && window.browserHarness.references().length === 0);
    assert.ok(await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('workbench.browser-comments.v1')!), 'fixture')));
    await page.evaluate(value => window.browserHarness.mount(value), identity);
    await page.waitForFunction(() => window.browserHarness.identity()?.hostId === 'local');
    await page.evaluate(() => window.browserHarness.adopt('fixture'));
    await page.getByLabel('浏览器引用批注').waitFor();
    assert.equal(await page.getByLabel('浏览器引用批注').inputValue(), 'User edited legacy');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('workbench.browser-comments.v1')!).fixture), undefined);
    await page.getByLabel('浏览器引用批注').fill('Updated legacy comment');
    await page.getByRole('button', { name: '保存批注' }).click();
    await page.waitForFunction(() => window.browserHarness.references()[0]?.text.includes('Updated legacy comment'));
    const migrated = await page.evaluate(() => window.browserHarness.references()[0]);
    assert.deepEqual(migrated?.original.unknown, { keep: 7 });
    assert.deepEqual((migrated?.original.localBrowserContext as Record<string, unknown>).unknownContext, { keep: true });
    assert.equal(((migrated?.original.content as Record<string, unknown>[])[0]).extra, 1);
    await page.evaluate(() => {
      const prototype = Storage.prototype as Storage & { originalSet?: typeof Storage.prototype.setItem };
      prototype.originalSet = prototype.setItem;
      prototype.setItem = function () { throw new Error('synthetic storage failure'); };
    });
    await page.getByLabel('浏览器引用批注').fill('Unsaved edit');
    await page.getByRole('button', { name: '保存批注' }).click();
    await page.getByText('synthetic storage failure').waitFor();
    assert.equal(await page.getByLabel('浏览器引用批注').inputValue(), 'Unsaved edit');
    assert.match((await page.evaluate(() => window.browserHarness.references()[0]))!.text, /Updated legacy comment/);
    await page.evaluate(() => {
      const prototype = Storage.prototype as Storage & { originalSet?: typeof Storage.prototype.setItem };
      prototype.setItem = prototype.originalSet!; delete prototype.originalSet;
    });
    await page.getByRole('button', { name: '保存批注' }).click();
    await page.waitForFunction(() => window.browserHarness.references()[0]?.text.includes('Unsaved edit'));
    await page.getByRole('button', { name: '引用所选元素' }).click();
    await page.waitForFunction(() => window.browserHarness.references().length === 2);
    await page.evaluate(() => window.browserHarness.setText('Explain this page'));
    await page.waitForFunction(() => window.browserHarness.draft().references?.length === 2);
    const beforeEdit = await page.evaluate(() => window.browserHarness.references());
    const newReference = beforeEdit.find(reference => (reference.original.localBrowserCommentMetadata as Record<string, unknown>).commentId !== 'legacy-id')!;
    assert.match(newReference.text, /#send/);
    assert.match(newReference.text, /frame-1/);
    assert.match(newReference.text, /"colors":"red"/);
    assert.deepEqual((newReference.original.localBrowserContext as Record<string, unknown>).targetRect, selected.rect);
    const draft = await page.evaluate(() => window.browserHarness.draft());
    if (process.env.YARD_TEST_ARTIFACTS) {
      await writeFile(join(process.env.YARD_TEST_ARTIFACTS, 'standalone-e-browser-synthetic-draft.json'), JSON.stringify(draft));
      await page.screenshot({ path: join(process.env.YARD_TEST_ARTIFACTS, 'standalone-e-owned-chrome-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(process.env.YARD_TEST_ARTIFACTS, 'standalone-e-owned-chrome-mobile.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile controls fit the viewport');
      await page.setViewportSize({ width: 1100, height: 850 });
    }

    const second = await context.newPage();
    await second.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await second.goto(origin);
    await second.evaluate(identity => window.browserHarness.mount(identity), identity);
    await second.waitForFunction(() => window.browserHarness.references().length === 2);
    const firstEditors = page.getByLabel('浏览器引用批注');
    const secondEditors = second.getByLabel('浏览器引用批注');
    await firstEditors.nth(0).fill('First page edit');
    await secondEditors.nth(1).fill('Second page edit');
    await Promise.all([page.getByRole('button', { name: '保存批注' }).nth(0).click(), second.getByRole('button', { name: '保存批注' }).nth(1).click()]);
    await page.waitForFunction(() => { const refs = window.browserHarness.references(); return refs[0]?.text.includes('First page edit') && refs[1]?.text.includes('Second page edit'); });
    await second.waitForFunction(() => { const refs = window.browserHarness.references(); return refs[0]?.text.includes('First page edit') && refs[1]?.text.includes('Second page edit'); });
    await page.evaluate(references => window.browserHarness.acknowledge(references), beforeEdit);
    assert.equal((await page.evaluate(() => window.browserHarness.references())).length, 2, 'New edits survive acknowledgement of older submitted versions');
    await second.reload();
    await second.evaluate(identity => window.browserHarness.mount(identity), identity);
    await second.waitForFunction(() => window.browserHarness.references().length === 2);
    await second.waitForFunction(() => window.browserHarness.draft().references?.length === 2);
    assert.equal(await second.getByLabel('浏览器引用批注').nth(0).inputValue(), 'First page edit');
    await second.getByRole('button', { name: '删除引用' }).nth(1).click();
    await page.waitForFunction(() => window.browserHarness.references().length === 1);
    try {
      await page.waitForFunction(() => JSON.stringify(window.browserHarness.draft().references) === JSON.stringify(window.browserHarness.references()), undefined, { timeout: 5000 });
    } catch (error) {
      console.error('Synthetic draft synchronization:', JSON.stringify(await page.evaluate(() => ({ draft: window.browserHarness.draft().references, stored: window.browserHarness.references() }))));
      throw error;
    }
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('workbench.browser-comments.v1')!));
    assert.deepEqual(stored['another-ambiguous-thread'], [{ value: 1 }]);
    assert.deepEqual(stored['new-conversation'], [{ home: true }]);
    assert.deepEqual(stored['panel-new-conversation'], [{ panel: true }]);
    assert.ok(Object.values(stored).some(value => Array.isArray(value) && value.some(item => item?.unknown === 'preserve')));

    delaySelection = true;
    await page.getByRole('button', { name: '引用所选元素' }).click();
    for (let i = 0; i < 100 && !selectedPending; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(selectedPending, true);
    const remote = { ...identity, hostId: 'ssh-fixture', draftId: 'draft-b' };
    await page.evaluate(value => window.browserHarness.mount(value), remote);
    releaseSelection!(); delaySelection = false;
    await page.waitForFunction(() => window.browserHarness.identity()?.hostId === 'ssh-fixture' && window.browserHarness.references().length === 0);
    await page.evaluate(value => window.browserHarness.mount(value), identity);
    await page.waitForFunction(() => window.browserHarness.identity()?.hostId === 'local' && window.browserHarness.references().length === 1);
    assert.equal((await page.evaluate(() => window.browserHarness.references())).length, 1, 'Late selection did not modify the previous owner');
    await second.evaluate(() => {
      const scope = window as unknown as { lockReady: boolean; unlock: () => void };
      const held = new Promise<void>(resolve => { scope.unlock = resolve; });
      void navigator.locks.request('codex-yard:browser-comments:v1', async () => { scope.lockReady = true; await held; });
    });
    await second.waitForFunction(() => (window as unknown as { lockReady: boolean }).lockReady);
    await page.waitForFunction(() => !(document.querySelector('button[title^="在真实 Chrome 标签"]') as HTMLButtonElement)?.disabled);
    const priorSelections = calls.filter(call => call.name === 'take_snapshot').length;
    await page.getByRole('button', { name: '引用所选元素' }).click();
    for (let i = 0; i < 100 && calls.filter(call => call.name === 'take_snapshot').length === priorSelections; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(calls.filter(call => call.name === 'take_snapshot').length > priorSelections);
    await page.evaluate(value => window.browserHarness.mount(value), remote);
    await page.waitForFunction(() => window.browserHarness.identity()?.hostId === 'ssh-fixture');
    await second.evaluate(() => (window as unknown as { unlock(): void }).unlock());
    await page.evaluate(value => window.browserHarness.mount(value), identity);
    await page.waitForFunction(() => window.browserHarness.identity()?.hostId === 'local' && window.browserHarness.references().length === 1);
    assert.equal((await page.evaluate(() => window.browserHarness.references())).length, 1, 'A quote waiting for the storage lock cannot outlive its owner');
    await page.waitForFunction(() => JSON.stringify(window.browserHarness.draft().references) === JSON.stringify(window.browserHarness.references()), undefined, { timeout: 5000 });
    await page.evaluate(async () => window.browserHarness.acknowledge(window.browserHarness.references()));
    await page.waitForFunction(() => window.browserHarness.references().length === 0 && window.browserHarness.draft().references?.length === 0);
    const afterAcknowledgement = await page.evaluate(() => JSON.parse(localStorage.getItem('workbench.browser-comments.v1')!));
    assert.ok(Object.values(afterAcknowledgement).some(value => Array.isArray(value) && value.some(item => item?.unknown === 'preserve')));

    const home = { hostId: 'local', threadId: null, draftId: 'home-draft', browserTabId: 'tab-a' };
    const panel = { ...home, draftId: 'panel-draft' };
    await page.evaluate(value => window.browserHarness.mount(value), home);
    await page.waitForFunction(() => window.browserHarness.identity()?.draftId === 'home-draft');
    await page.getByRole('button', { name: '引用所选元素' }).waitFor();
    await page.waitForFunction(() => !(document.querySelector('button[title^="在真实 Chrome 标签"]') as HTMLButtonElement)?.disabled);
    await page.getByRole('button', { name: '引用所选元素' }).click();
    await page.waitForFunction(() => window.browserHarness.references().length === 1);
    await page.evaluate(value => window.browserHarness.mount(value), panel);
    await page.waitForFunction(() => window.browserHarness.identity()?.draftId === 'panel-draft' && window.browserHarness.references().length === 0);
    await page.waitForFunction(() => !(document.querySelector('button[title^="在真实 Chrome 标签"]') as HTMLButtonElement)?.disabled);
    await page.getByRole('button', { name: '引用所选元素' }).click();
    await page.waitForFunction(() => window.browserHarness.references().length === 1);
    const panelId = (await page.evaluate(() => window.browserHarness.references()))[0]!.id;
    await page.evaluate(value => window.browserHarness.mount(value), home);
    await page.waitForFunction(() => window.browserHarness.identity()?.draftId === 'home-draft' && window.browserHarness.references().length === 1);
    assert.notEqual((await page.evaluate(() => window.browserHarness.references()))[0]!.id, panelId);
    await page.evaluate(() => window.browserHarness.unmount());
    await second.close();
  } finally {
    releaseSelection?.();
    companion?.terminate();
    await context?.close();
    await Promise.all([...routers.values()].map(router => router.close()));
    await host.close(); broker.close(); sockets.close(); server.closeAllConnections(); server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
