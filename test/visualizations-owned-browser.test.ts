import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { visualizationSandboxPolicy } from '../src/native/visualizations.ts';

interface Harness {
  html: Record<string, string>;
  reads: Record<string, unknown>[];
  rpc: string[];
  drafts: { text: string; images: unknown[]; files: unknown[] }[];
  draftHosts: string[];
  sent: { hostId: string; threadId: string; path: string; draft: { text: string; images: unknown[]; files: unknown[]; references?: unknown[] } }[];
  signals: AbortSignal[];
  states: unknown[];
  closes: number;
  suspensions: number;
  sendWaiting: boolean;
  releaseSend(): void;
  mount(options?: { path?: string; hostId?: string; threadId?: string; theme?: 'light' | 'dark'; saveState?: boolean; send?: boolean; delaySend?: boolean; failSend?: boolean }): void;
  unmount(): void;
  theme(theme: 'light' | 'dark'): void;
  allowMissing(): void;
  finishSlow(): void;
  suspendHostChange(): void;
  cancelHostChange(): void;
}
declare global { interface Window { visualizationHarness: Harness } }

const chromePath = '/usr/bin/google-chrome';
const chart = `<!doctype html><html><head><style>
body { margin: 0; padding: 18px; font-family: sans-serif; color: #1c252a; background: #fff; } #viz-text { height: 210px; background: #d4f0e4; }
:root { --primary: #123456; }
</style></head><body>
<div id="viz-text">Synthetic quarterly chart</div>
<button id="follow">Ask about chart</button><button id="state">Change state</button>
<button id="mode">Expand from visualization</button><button id="link">Request link</button>
<a id="generated" download="report.txt" href="data:text/plain,chart%20export">Export chart</a>
<script>
window.initialBackground = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
window.followResults = [];
document.getElementById('follow').onclick = () => window.openai.sendFollowUpMessage({prompt:'Explain the synthetic chart',title:'Explain',context:{amount:2}}).then(() => window.followResults.push('sent'), error => window.followResults.push(error.message));
document.getElementById('state').onclick = () => window.openai.setWidgetState({count:2});
document.getElementById('mode').onclick = () => window.openai.requestDisplayMode({mode:'fullscreen'});
document.getElementById('link').onclick = () => window.openai.openExternal({href:'https://example.com/reference'});
</script></body></html>`;

test('owned React visualization uses a scoped opaque frame and cleans up its port', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const [app, sandbox] = await Promise.all([
    build({ entryPoints: ['test/visualizations-owned-fixture.ts'], bundle: true, write: false, format: 'iife' }),
    build({ entryPoints: ['src/native/visualization-sandbox.ts'], bundle: true, write: false, format: 'iife' }),
  ]);
  let blockedRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(app.outputFiles[0].text);
    } else if (url.pathname === '/' && url.searchParams.get('app') === 'skybridge') {
      response.setHeader('Content-Security-Policy', visualizationSandboxPolicy);
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Type', 'text/html');
      setTimeout(() => response.end(`<!doctype html><html><body><script>${sandbox.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`), 200);
    } else if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body><div id="root"></div><label>Visible draft<textarea id="composer"></textarea></label><script src="/bundle.js"></script></body></html>');
    } else {
      blockedRequests++;
      response.end('not available');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const artifactRoot = process.env.YARD_TEST_ARTIFACTS ?? tmpdir();
  const profile = await mkdtemp(join(artifactRoot, 'owned-viz-profile-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: true,
      acceptDownloads: true, downloadsPath: profile, args: ['--no-sandbox'], viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.addStyleTag({ content: readFileSync('src/renderer/app/app.css', 'utf8') });
    await page.evaluate(value => {
      const harness = window.visualizationHarness;
      harness.html['/chart.html'] = value;
      harness.html['/slow.html'] = '<html><body>Obsolete content</body></html>';
      harness.html['/runtime.html'] = '<html><body><p>Runtime fixture</p><script>setTimeout(() => { throw Error("synthetic runtime failure") }, 30)</script></body></html>';
      harness.mount({ saveState: true });
    }, chart);
    await page.waitForFunction(() => document.querySelector('iframe')?.src.includes('yard_viz_init='));
    const rejectedForgedInit = await page.evaluate(async () => {
      const frame = document.querySelector('iframe')!;
      const id = new URL(frame.src).searchParams.get('yard_viz_init');
      const probe = new MessageChannel();
      let delivered = false;
      probe.port2.onmessage = () => { delivered = true; };
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'null', data: { type: 'yard-visualization:init', initId: id }, ports: [probe.port1] }));
      const wrongId = new MessageChannel();
      wrongId.port2.onmessage = () => { delivered = true; };
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'yard-visualization:init', initId: 'wrong' }, ports: [wrongId.port1] }));
      await new Promise(resolve => setTimeout(resolve, 60));
      probe.port1.close(); probe.port2.close(); wrongId.port1.close(); wrongId.port2.close();
      return !delivered;
    });
    assert.equal(rejectedForgedInit, true);
    const frameLocator = page.frameLocator('iframe[title="Visualization content"]');
    await frameLocator.locator('#viz-text').waitFor();
    await page.getByRole('button', { name: 'Annotate' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !(document.querySelector('button') as HTMLButtonElement).disabled);
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
    let frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
    if (!frame) throw new Error('Visualization frame is missing');
    assert.equal(await frame.evaluate(() => (window as unknown as { initialBackground: string }).initialBackground), '#ffffff');
    assert.equal(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()), '#123456');
    const isolation = await frame.evaluate(async () => {
      let parentBlocked = false, fetchBlocked = false, arbitraryBlocked = false;
      try { void window.parent.document.body; } catch { parentBlocked = true; }
      try { await fetch('/blocked'); } catch { fetchBlocked = true; }
      try { await (window as unknown as { openai: { callTool(name: string, value: object): Promise<unknown> } }).openai.callTool('host.run', {}); }
      catch { arbitraryBlocked = true; }
      return { parentBlocked, fetchBlocked, arbitraryBlocked, referrer: document.referrer };
    });
    assert.deepEqual(isolation, { parentBlocked: true, fetchBlocked: true, arbitraryBlocked: true, referrer: '' });
    assert.equal(blockedRequests, 0);
    await frame.evaluate(() => { (document.getElementById('viz-text') as HTMLElement).style.height = '600px'; });
    await page.waitForFunction(() => (document.querySelector('iframe')?.getBoundingClientRect().height ?? 0) >= 600);
    await frame.evaluate(() => { (document.getElementById('viz-text') as HTMLElement).style.height = '100px'; });
    await page.waitForFunction(() => (document.querySelector('iframe')?.getBoundingClientRect().height ?? 10_000) < 350);
    const rejectedDuplicate = await page.evaluate(async () => {
      const frame = document.querySelector('iframe')!;
      const probe = new MessageChannel();
      let delivered = false;
      probe.port2.onmessage = () => { delivered = true; };
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null',
        data: { type: 'yard-visualization:init', initId: new URL(frame.src).searchParams.get('yard_viz_init') }, ports: [probe.port1] }));
      await new Promise(resolve => setTimeout(resolve, 60));
      probe.port1.close(); probe.port2.close();
      return !delivered;
    });
    assert.equal(rejectedDuplicate, true);
    assert.deepEqual(await page.evaluate(() => window.visualizationHarness.reads), [
      { endpoint: 'visualization-read', hostId: 'ssh-host', threadId: 'thread-a', path: '/chart.html' },
    ]);
    await page.locator('#composer').fill('Existing unsent draft');
    await frameLocator.locator('#follow').click();
    const dialog = page.getByRole('dialog', { name: 'Send follow-up?' });
    await dialog.waitFor();
    await page.setViewportSize({ width: 320, height: 650 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1200, height: 900 });
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft');
    assert.equal(await page.evaluate(() => window.visualizationHarness.sent.length), 0);
    const duplicate = await frame.evaluate(async () => {
      try { await (window as unknown as { openai: { sendFollowUpMessage(request: object): Promise<void> } }).openai.sendFollowUpMessage({ prompt: 'Duplicate' }); return ''; }
      catch (error) { return (error as Error).message; }
    });
    assert.match(duplicate, /already awaiting confirmation/);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await frame.waitForFunction(() => (window as unknown as { followResults: string[] }).followResults.length === 1);
    assert.match(await frame.evaluate(() => (window as unknown as { followResults: string[] }).followResults[0]), /not confirmed/);
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft');
    await frameLocator.locator('#follow').click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft');
    await frameLocator.locator('#follow').click();
    await dialog.getByLabel('Prompt').fill('Explain the edited chart');
    await dialog.getByText('Widget state', { exact: true }).click();
    await dialog.getByLabel('Widget state JSON').fill('{');
    assert.equal(await dialog.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    await dialog.getByLabel('Widget state JSON').fill('{"amount":3}');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.visualizationHarness.sent.length === 1);
    await frame.waitForFunction(() => (window as unknown as { followResults: string[] }).followResults.length === 3);
    assert.equal(await frame.evaluate(() => (window as unknown as { followResults: string[] }).followResults[2]), 'sent');
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft');
    const sent = await page.evaluate(() => window.visualizationHarness.sent[0]);
    assert.deepEqual({ hostId: sent.hostId, threadId: sent.threadId, path: sent.path }, { hostId: 'ssh-host', threadId: 'thread-a', path: '/chart.html' });
    const draft = sent.draft as { text: string; images: unknown[]; files: unknown[]; references: { id: string; text: string; kind: string; context: unknown; original: unknown }[] };
    assert.deepEqual({ text: draft.text, images: draft.images, files: draft.files }, {
      text: 'Explain the edited chart\n\nCurrent widget context (JSON):\n{\n  "amount": 3\n}', images: [], files: [],
    });
    assert.equal(draft.references.length, 1);
    assert.match(draft.references[0].id, /^[\da-f-]{36}$/i);
    const referenceContext = { type: 'visualization', hostId: 'ssh-host', threadId: 'thread-a', path: '/chart.html', title: 'Explain', context: { amount: 3 } };
    assert.deepEqual({ ...draft.references[0], id: 'reference' }, { id: 'reference', text: 'Visualization: Explain', kind: 'visualization', context: referenceContext,
      original: { originalUserInput: 'Explain the edited chart', referenceContext } });
    await page.evaluate(() => window.visualizationHarness.suspendHostChange());
    await page.waitForFunction(() => window.visualizationHarness.suspensions > 0);
    await frameLocator.locator('#follow').click();
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.visualizationHarness.sent.length === 2);
    assert.deepEqual(await page.evaluate(() => window.visualizationHarness.sent.map(item => item.hostId)), ['ssh-host', 'ssh-host']);
    await page.evaluate(() => window.visualizationHarness.cancelHostChange());
    await frameLocator.locator('#follow').click();
    await dialog.waitFor();
    await page.evaluate(() => window.visualizationHarness.mount({ hostId: 'replacement-host', threadId: 'replacement-thread' }));
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.visualizationHarness.sent.length), 2);
    assert.equal(await page.evaluate(() => window.visualizationHarness.signals.every(signal => signal.aborted)), true);
    await frameLocator.locator('#viz-text').waitFor();
    await frameLocator.locator('#follow').click();
    await dialog.waitFor();
    await page.evaluate(() => window.visualizationHarness.unmount());
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.evaluate(() => window.visualizationHarness.sent.length), 2);
    await page.evaluate(() => window.visualizationHarness.mount({ hostId: 'slow-host', threadId: 'slow-thread', delaySend: true }));
    await page.waitForFunction(() => window.visualizationHarness.reads.some(read => read.endpoint === 'visualization-read'
      && read.hostId === 'slow-host' && read.threadId === 'slow-thread'));
    await frameLocator.locator('#viz-text').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Expand' && !button.disabled));
    await frameLocator.locator('#follow').click();
    try { await dialog.waitFor({ timeout: 5_000 }); }
    catch (error) {
      const currentFrame = await (await page.locator('iframe').elementHandle())?.contentFrame();
      const outcomes = await currentFrame?.evaluate(() => (window as unknown as { followResults: string[] }).followResults).catch(String);
      throw new Error(`Slow-host follow-up dialog did not appear: ${String(error)}; widget outcomes: ${JSON.stringify(outcomes)}; alerts: ${JSON.stringify(await page.getByRole('alert').allTextContents())}`);
    }
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.visualizationHarness.sendWaiting);
    await page.evaluate(() => window.visualizationHarness.mount({ hostId: 'new-host', threadId: 'new-thread' }));
    await page.evaluate(() => window.visualizationHarness.releaseSend());
    await page.waitForFunction(() => !window.visualizationHarness.sendWaiting);
    assert.equal(await page.evaluate(() => window.visualizationHarness.sent.length), 2);
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft');
    await page.evaluate(() => window.visualizationHarness.mount({ failSend: true }));
    await frameLocator.locator('#viz-text').waitFor();
    await frameLocator.locator('#follow').click();
    try { await dialog.waitFor({ timeout: 5_000 }); }
    catch (error) {
      const currentFrame = await (await page.locator('iframe').elementHandle())?.contentFrame();
      const outcomes = await currentFrame?.evaluate(() => (window as unknown as { followResults: string[] }).followResults).catch(String);
      throw new Error(`Follow-up dialog did not appear: ${String(error)}; widget outcomes: ${JSON.stringify(outcomes)}; alerts: ${JSON.stringify(await page.getByRole('alert').allTextContents())}`);
    }
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic send failure' }).waitFor();
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft');
    assert.equal(await page.evaluate(() => window.visualizationHarness.sent.length), 2);
    await page.evaluate(() => window.visualizationHarness.mount({ saveState: true, send: false }));
    await frameLocator.locator('#viz-text').waitFor();
    frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
    if (!frame) throw new Error('Replacement visualization frame is missing');
    const previousResults = await frame.evaluate(() => (window as unknown as { followResults: string[] }).followResults.length);
    await frameLocator.locator('#follow').click();
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft');
    await dialog.getByRole('button', { name: 'Add to draft instead' }).click();
    await page.waitForFunction(() => window.visualizationHarness.drafts.length === 1);
    await frame.waitForFunction(previous => (window as unknown as { followResults: string[] }).followResults.length > previous, previousResults);
    assert.match(await frame.evaluate(() => (window as unknown as { followResults: string[] }).followResults.at(-1) ?? ''), /not sent; adding it to the draft was requested/);
    assert.equal(await page.locator('#composer').inputValue(), 'Existing unsent draft\nExplain the synthetic chart');
    await frameLocator.locator('#viz-text').waitFor();
    await frameLocator.locator('#state').click();
    await page.waitForFunction(() => window.visualizationHarness.states.length === 1);
    assert.deepEqual(await page.evaluate(() => window.visualizationHarness.states), [{ count: 2 }]);
    await page.evaluate(() => window.visualizationHarness.theme('dark'));
    await frame.waitForFunction(() => document.documentElement.style.colorScheme === 'dark');
    assert.equal(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim()), '#20272a');
    await frameLocator.locator('#mode').click();
    await page.getByRole('button', { name: 'Exit expanded view' }).waitFor();
    await page.getByRole('button', { name: 'Exit expanded view' }).click();
    await page.getByRole('button', { name: 'Annotate' }).click();
    await frameLocator.locator('#viz-text').click();
    await page.getByLabel('Annotation feedback').fill('Show the previous quarter');
    await page.getByRole('button', { name: 'Add to draft' }).click();
    assert.match(await page.locator('#composer').inputValue(), /Visualization: \/chart\.html\nSelection: Synthetic quarterly chart\nFeedback: Show the previous quarter/);
    const sourceDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download HTML' }).click();
    const source = await sourceDownload;
    assert.equal(source.suggestedFilename(), 'chart.html');
    const sourceStream = await source.createReadStream();
    let sourceText = '';
    for await (const chunk of sourceStream) sourceText += chunk.toString();
    assert.equal(sourceText, chart);
    await frameLocator.locator('#generated').click();
    await page.getByRole('button', { name: 'Download file' }).waitFor();
    const generatedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download file' }).click();
    const generated = await generatedDownload;
    assert.equal(generated.suggestedFilename(), 'report.txt');
    const generatedStream = await generated.createReadStream();
    let generatedText = '';
    for await (const chunk of generatedStream) generatedText += chunk.toString();
    assert.equal(generatedText, 'chart export');
    await frameLocator.locator('#link').click();
    assert.equal(await page.getByRole('link', { name: 'Open link' }).getAttribute('href'), 'https://example.com/reference');
    await page.getByRole('button', { name: 'Dismiss link' }).click();
    assert.deepEqual(await page.evaluate(() => window.visualizationHarness.rpc), []);

    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.YARD_VIZ_SCREENSHOTS) await page.screenshot({ path: join(process.env.YARD_VIZ_SCREENSHOTS, 'owned-visualization-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1200, height: 900 });
    if (process.env.YARD_VIZ_SCREENSHOTS) await page.screenshot({ path: join(process.env.YARD_VIZ_SCREENSHOTS, 'owned-visualization-desktop.png'), fullPage: true });

    await frame.evaluate(() => { location.href = 'about:blank'; });
    await page.getByRole('alert').filter({ hasText: 'Visualization frame navigated away' }).waitFor();
    await page.getByRole('button', { name: 'Retry' }).click();
    await frameLocator.locator('#viz-text').waitFor();
    await page.evaluate(() => {
      (window as unknown as { oldVisualizationFrame: Window | null }).oldVisualizationFrame = document.querySelector('iframe')!.contentWindow;
      window.visualizationHarness.unmount();
    });
    assert.equal(await page.locator('iframe').count(), 0);
    await page.evaluate(() => window.visualizationHarness.mount({ hostId: 'replacement-host', threadId: 'replacement-thread' }));
    await page.waitForFunction(() => document.querySelector('iframe')?.src.includes('yard_viz_init='));
    const rejectedOldFrame = await page.evaluate(async () => {
      const frame = document.querySelector('iframe')!;
      const oldFrame = (window as unknown as { oldVisualizationFrame: Window | null }).oldVisualizationFrame;
      const probe = new MessageChannel();
      let delivered = false;
      probe.port2.onmessage = () => { delivered = true; };
      window.dispatchEvent(new MessageEvent('message', { source: oldFrame, origin: 'null',
        data: { type: 'yard-visualization:init', initId: new URL(frame.src).searchParams.get('yard_viz_init') }, ports: [probe.port1] }));
      await new Promise(resolve => setTimeout(resolve, 60));
      probe.port1.close(); probe.port2.close();
      return !delivered;
    });
    assert.equal(rejectedOldFrame, true);
    await frameLocator.locator('#viz-text').waitFor();
    await page.evaluate(() => window.visualizationHarness.mount({ path: '/missing.html' }));
    await page.getByRole('alert').filter({ hasText: 'Fixture read failed' }).waitFor();
    await page.evaluate(() => window.visualizationHarness.allowMissing());
    await page.getByRole('button', { name: 'Retry' }).click();
    await frameLocator.locator('#viz-text').waitFor();
    await page.evaluate(() => window.visualizationHarness.mount({ path: '/slow.html', hostId: 'host-a' }));
    await page.evaluate(() => window.visualizationHarness.mount({ path: '/chart.html', hostId: 'host-b', threadId: 'thread-b' }));
    await frameLocator.locator('#viz-text').waitFor();
    await page.evaluate(() => window.visualizationHarness.finishSlow());
    assert.equal(await frameLocator.locator('#viz-text').textContent(), 'Synthetic quarterly chart');
    assert.ok((await page.evaluate(() => window.visualizationHarness.reads)).some(read => read.hostId === 'host-b' && read.threadId === 'thread-b'));
    await page.evaluate(() => window.visualizationHarness.mount({ path: '/runtime.html' }));
    await page.getByRole('alert').filter({ hasText: 'synthetic runtime failure' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    assert.equal(await page.evaluate(() => window.visualizationHarness.closes), 1);
    assert.equal(await page.locator('iframe').count(), 0);
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
