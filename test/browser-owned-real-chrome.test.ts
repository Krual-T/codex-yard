import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { ClientChromeBroker } from '../src/browser-reuse/client-broker.ts';
import { ChromePanelRouter } from '../src/browser-reuse/panel-router.ts';
import type { ConnectionRequest } from '../src/browser-reuse/client-protocol.ts';
import type { ChromeRequest } from '../src/browser-reuse/protocol.ts';

test('owned React Chrome controls an isolated real Chrome through the official MCP',
  { skip: !existsSync('/usr/bin/google-chrome'), timeout: 120_000 }, async () => {
  const app = await build({ entryPoints: ['test/browser-owned-fixture.tsx'], bundle: true, write: false, format: 'iife' });
  const root = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'owned-real-chrome-'));
  const profile = join(root, 'target-profile');
  const broker = new ClientChromeBroker({ configured: true, label: 'Isolated Chrome' }, 30_000);
  const targetServer = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Isolated target</title><style>body{font:24px system-ui;padding:40px}input{font:inherit;padding:12px}</style><h1>Isolated target</h1><input aria-label="Target input">');
  });
  targetServer.listen(0, '127.0.0.1'); await once(targetServer, 'listening');
  const targetAddress = targetServer.address();
  if (!targetAddress || typeof targetAddress === 'string') throw new Error('Missing target address');
  const targetUrl = `http://127.0.0.1:${targetAddress.port}/fixture`;
  let router: ChromePanelRouter | undefined, origin = '';
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(app.outputFiles[0]!.text); return; }
      if (request.url === '/host' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const { endpoint, params } = JSON.parse(Buffer.concat(chunks).toString()) as { endpoint: string; params: Record<string, unknown> };
        const value = endpoint === 'chrome-connections' ? broker.connections(params as unknown as ConnectionRequest)
          : endpoint === 'chrome-browser' ? await router!.request(params as unknown as ChromeRequest) : (() => { throw new Error('Unexpected endpoint'); })();
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ value })); return;
      }
      response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: (error as Error).message })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-sync', '--disable-extensions', '--disable-background-networking', '--disable-dev-shm-usage',
    '--window-size=900,700', '--enable-features=CDPScreenshotNewSurface', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, targetUrl], { stdio: 'ignore' });
  let ui: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let targetBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    let port = '';
    for (let i = 0; i < 200 && !port; i++) {
      if (chrome.exitCode !== null) throw new Error('Isolated target Chrome exited');
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]!; } catch { await delay(100); }
    }
    assert.match(port, /^\d+$/);
    const endpoint = `http://127.0.0.1:${port}`;
    router = new ChromePanelRouter({ browserUrl: endpoint }, broker, () => {}, origin);
    targetBrowser = await chromium.connectOverCDP(endpoint);
    let target = targetBrowser.contexts()[0]!.pages().find(page => page.url() === targetUrl);
    for (let i = 0; i < 100 && !target; i++) {
      await delay(100);
      target = targetBrowser.contexts()[0]!.pages().find(page => page.url() === targetUrl);
    }
    assert.ok(target);
    ui = await chromium.launchPersistentContext(join(root, 'ui-profile'), { executablePath: '/usr/bin/google-chrome', headless: true,
      args: ['--no-sandbox', '--disable-background-networking'], viewport: { width: 1100, height: 850 } });
    const page = await ui.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(origin);
    await page.evaluate(() => window.browserHarness.mount({ hostId: 'local', threadId: 'synthetic', draftId: 'real-chrome', browserTabId: 'fixture' }));
    await page.waitForFunction(() => { const option = document.querySelector('select[aria-label="浏览器所在电脑"] option[value="server"]') as HTMLOptionElement | null;
      return option !== null && !option.disabled; });
    await page.getByLabel('浏览器所在电脑').selectOption('server');
    const select = page.getByLabel('已有 Chrome 标签');
    const option = select.locator('option').filter({ hasText: '/fixture' });
    await option.waitFor({ state: 'attached', timeout: 60_000 });
    const pageId = await option.getAttribute('value'); assert.ok(pageId);
    await select.selectOption(pageId);
    const image = page.getByAltText('Chrome 标签的最新画面');
    await image.waitFor({ timeout: 60_000 });
    await image.evaluate(async element => (element as HTMLImageElement).decode());
    const input = await target.getByLabel('Target input').boundingBox();
    const frame = await image.boundingBox();
    const viewport = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(input && frame);
    await image.click({ position: { x: (input.x + input.width / 2) / viewport.width * frame.width,
      y: (input.y + input.height / 2) / viewport.height * frame.height } });
    await page.getByLabel('向网页输入').fill('真实 Chrome 中文');
    await page.getByRole('button', { name: '输入', exact: true }).click();
    await target.getByLabel('Target input').waitFor();
    await target.waitForFunction(() => (document.querySelector('input') as HTMLInputElement).value === '真实 Chrome 中文');
    assert.equal(await target.getByLabel('Target input').inputValue(), '真实 Chrome 中文');
    await page.evaluate(() => window.browserHarness.unmount());
  } finally {
    await ui?.close();
    await router?.close(); broker.close();
    await targetBrowser?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill();
      const stop = setTimeout(() => chrome.kill('SIGKILL'), 5000);
      await once(chrome, 'exit'); clearTimeout(stop);
    }
    server.closeAllConnections(); server.close(); targetServer.closeAllConnections(); targetServer.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
