import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { visualizationSandboxPolicy } from '../src/native/visualizations.ts';
import type { VisualizationInteraction } from '../src/renderer/visualizations/index.tsx';

declare global { interface Window { carouselHarness: {
  drafts: { text: string; references?: { context?: unknown }[] }[];
  interactions: VisualizationInteraction[];
  navigation: ('previous' | 'next')[];
  mount(html: string, hostId?: string): void;
  clear(): void;
  unmount(): void;
} } }

const html = `<!doctype html><html><body>
<div class="viz-carousel" aria-label="Designs" data-previous-label="Earlier" data-next-label="Later">
  <section data-variant="Compact" aria-label="Compact design"><h2 id="compact" tabindex="0">Compact design</h2><input aria-label="Local input"></section>
  <section data-variant="Detailed" aria-label="Detailed design" hidden><div id="detail" aria-label="Detail chart">Detail chart</div></section>
  <section data-variant="Summary" hidden><p>Summary design</p></section>
</div>
<p id="plain">Plain content</p><button id="prevent">Handled key</button>
<script>
window.chartState = { amount: 1 };
window.keys = [];
document.querySelector('input').addEventListener('keydown', event => window.keys.push({key:event.key, composing:event.isComposing}));
document.getElementById('prevent').addEventListener('keydown', event => { if (event.key === 'ArrowRight') event.preventDefault(); });
new Tweak({container:document.getElementById('detail')}).addSlider(window.chartState, 'amount', {min:0,max:5,label:'Amount'});
</script></body></html>`;

test('carousel and bounded preview interaction run in the isolated React visualization', { skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000 }, async () => {
  const [app, sandbox] = await Promise.all([
    build({ entryPoints: ['test/visualizations-carousel-fixture.tsx'], bundle: true, write: false, format: 'iife' }),
    build({ entryPoints: ['src/native/visualization-sandbox.ts'], bundle: true, write: false, format: 'iife' }),
  ]);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(app.outputFiles[0]!.text); }
    else if (url.searchParams.get('app') === 'skybridge') {
      response.setHeader('Content-Security-Policy', visualizationSandboxPolicy);
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><script>${sandbox.outputFiles[0]!.text.replaceAll('</script', '<\\/script')}</script>`);
    } else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const profile = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'carousel-viz-profile-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: '/usr/bin/google-chrome', headless: true,
      args: ['--no-sandbox', '--disable-background-networking'], viewport: { width: 1100, height: 850 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(documentHtml => window.carouselHarness.mount(documentHtml), html);
    const view = page.frameLocator('iframe[title="Visualization content"]');
    await view.getByLabel('Local input').waitFor();
    const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
    if (!frame) throw new Error('Missing frame');
    assert.equal(await frame.locator('.viz-carousel').getAttribute('data-active-variant'), 'Compact');
    assert.equal(await frame.locator('[data-variant="Detailed"]').isHidden(), true);
    await view.getByLabel('Local input').fill('Keep local state');
    await view.getByRole('button', { name: 'Later' }).click();
    assert.equal(await frame.locator('.viz-carousel').getAttribute('data-active-variant'), 'Detailed');
    assert.equal(await view.locator('.viz-carousel-count').textContent(), '2 / 3');
    await view.getByRole('button', { name: 'Earlier' }).click();
    assert.equal(await view.getByLabel('Local input').inputValue(), 'Keep local state');
    await view.locator('.viz-carousel-picker summary').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await frame.locator('.viz-carousel').getAttribute('data-active-variant'), 'Summary');
    await view.getByRole('button', { name: 'Later' }).click();
    assert.equal(await frame.locator('.viz-carousel').getAttribute('data-active-variant'), 'Compact');
    assert.equal(await page.evaluate(() => window.carouselHarness.drafts.length), 0);
    assert.equal(await page.evaluate(() => localStorage.length), 0);

    await page.getByRole('button', { name: 'Annotate' }).click();
    await view.getByRole('button', { name: 'Later' }).click();
    assert.equal(await page.getByRole('status').filter({ hasText: 'Select an element' }).count(), 1);
    await view.locator('#detail').click();
    await page.getByRole('slider', { name: 'Amount' }).fill('3');
    await page.getByLabel('Annotation feedback').fill('Change the detail');
    await page.getByRole('button', { name: 'Add to draft' }).click();
    await page.waitForFunction(() => window.carouselHarness.drafts.length === 1);
    assert.match(JSON.stringify(await page.evaluate(() => window.carouselHarness.drafts[0])), /"variant":"Detailed"/);
    assert.equal(await frame.evaluate(() => (window as unknown as { chartState: { amount: number } }).chartState.amount), 1);

    await view.locator('#plain').hover();
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => document.querySelector('[aria-label="Visualization"]')?.getAttribute('data-visualization-hover') === 'false');
    await page.evaluate(() => window.carouselHarness.clear());
    await view.locator('#plain').hover();
    await page.waitForFunction(() => window.carouselHarness.interactions.some(event => event.type === 'hover' && event.isHovering));
    await view.locator('#plain').click();
    await page.waitForFunction(() => window.carouselHarness.interactions.some(event => event.type === 'click' && !event.isInteractive));
    await view.getByRole('button', { name: 'Earlier' }).click();
    await page.waitForFunction(() => window.carouselHarness.interactions.some(event => event.type === 'click' && event.isInteractive));
    await view.locator('#compact').focus();
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.carouselHarness.interactions.some(event => event.type === 'input' && event.method === 'keyboard-navigation'));
    await page.keyboard.type('x');
    await page.waitForFunction(() => window.carouselHarness.interactions.some(event => event.type === 'input' && event.method === 'keyboard'));
    assert.doesNotMatch(JSON.stringify(await page.evaluate(() => window.carouselHarness.interactions)), /Keep local state|"x"/);

    await page.getByRole('button', { name: 'Expand' }).click();
    await page.evaluate(() => window.carouselHarness.clear());
    await view.getByLabel('Local input').focus();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
    await page.keyboard.press('Escape');
    const keys = await frame.evaluate(() => (window as unknown as { keys: { key: string; composing: boolean }[] }).keys);
    assert.ok(keys.some(event => event.key === 'Escape' && event.composing), 'Escape was delivered during a real IME composition');
    assert.equal(await page.getByRole('button', { name: 'Exit expanded view' }).count(), 1);
    assert.equal(await page.evaluate(() => window.carouselHarness.interactions.some(event => event.type === 'input' && event.method === 'keyboard')), false);
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await cdp.detach();
    await frame.evaluate(() => document.getElementById('compact')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.carouselHarness.navigation), []);
    await view.locator('#compact').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.carouselHarness.navigation.length === 1);
    assert.deepEqual(await page.evaluate(() => window.carouselHarness.navigation), ['next']);
    await view.getByLabel('Local input').focus();
    await page.keyboard.press('ArrowLeft');
    await view.locator('#prevent').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.carouselHarness.navigation), ['next']);
    await view.locator('#compact').focus();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Expand' }).waitFor();

    await page.getByRole('button', { name: 'Annotate' }).click();
    await view.locator('#compact').focus();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Annotate' }).waitFor();
    assert.equal(await page.getByRole('status').filter({ hasText: 'Select an element' }).count(), 0);
    if (process.env.YARD_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.YARD_TEST_ARTIFACTS, 'standalone-e-carousel-desktop.png') });
    await page.setViewportSize({ width: 390, height: 800 });
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.YARD_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.YARD_TEST_ARTIFACTS, 'standalone-e-carousel-mobile.png') });
    const interactions = await page.evaluate(() => window.carouselHarness.interactions.length);
    await page.evaluate(() => window.carouselHarness.unmount());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.carouselHarness.interactions.length), interactions);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
