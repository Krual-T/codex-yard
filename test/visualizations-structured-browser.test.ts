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

interface Harness {
  drafts: { text: string; images: unknown[]; files: unknown[]; references?: { id: string; text: string; kind: string;
    context: { title?: string; context?: unknown }; original: { originalUserInput: string; referenceContext: { title?: string; context?: unknown } } }[] }[];
  requests: string[];
  configure(html: string, atoms: Record<string, unknown>): void;
  atoms(): Record<string, unknown>;
  mount(hostId?: string, threadId?: string, path?: string): void;
  theme(): void;
  unmount(): void;
  fail(value: boolean): void;
  delay(value: boolean): void;
  release(): void;
  replaceAtom(key: string, value: unknown): void;
}
declare global { interface Window { structuredHarness: Harness } }

const chart = `<!doctype html><html><body>
<div class="viz-carousel" data-active-variant="base" aria-label="Scenario"><div id="chart" aria-label="Sales chart">Chart</div></div>
<button id="follow">Follow up</button><button id="save">Save widget state</button><button id="dispose">Dispose controls</button>
<button id="second">Second panel</button><button id="dispose-second">Dispose second panel</button>
<script>
window.initial = { state: window.openai.widgetState, locale: window.openai.locale,
  variable: window.openai.visualizationStyleVariables['--viz-accent'], computed: getComputedStyle(document.documentElement).getPropertyValue('--viz-accent').trim() };
window.values = { amount: 2, color: '#112233', enabled: true, mode: 'a' };
window.renders = 0;
window.panel = new Tweak({container: document.getElementById('chart'), onChange: () => window.renders++})
  .addSlider(window.values, 'amount', {min: 0, max: 10, step: 1, label: 'Amount', reference: 'amount-ref'})
  .addColorPicker(window.values, 'color', {label: 'Color'})
  .addToggle(window.values, 'enabled', {label: 'Enabled'})
  .addSelect(window.values, 'mode', {label: 'Mode', options: [{label: 'Alpha', value: 'a'}, {label: 'Beta', value: 'b'}]});
document.getElementById('follow').onclick = () => openai.sendFollowUpMessage({prompt:'Explain this', title:'Chart details', context:{series:['a','b'], count:2}}).catch(() => {});
document.getElementById('save').onclick = () => openai.setWidgetState({modelContent:{selected:2}, privateContent:{filter:'current'}}).then(() => window.saved = true).catch(e => window.saveError = e.message);
document.getElementById('dispose').onclick = () => window.panel.dispose();
document.getElementById('second').onclick = () => { window.secondary = { enabled: true }; window.secondPanel = new Tweak({container: document.getElementById('chart')}).addToggle(window.secondary, 'enabled', {label:'Secondary'}); };
document.getElementById('dispose-second').onclick = () => window.secondPanel.dispose();
</script></body></html>`;

test('structured React visualization persists and previews controls in an isolated frame', { skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000 }, async () => {
  const [app, sandbox] = await Promise.all([
    build({ entryPoints: ['test/visualizations-structured-fixture.ts'], bundle: true, write: false, format: 'iife' }),
    build({ entryPoints: ['src/native/visualization-sandbox.ts'], bundle: true, write: false, format: 'iife' }),
  ]);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(app.outputFiles[0].text); }
    else if (url.searchParams.get('app') === 'skybridge') {
      response.setHeader('Content-Security-Policy', visualizationSandboxPolicy);
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><body><script>${sandbox.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
    } else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><div id="root"></div><textarea id="draft"></textarea><script src="/bundle.js"></script>'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const profile = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'structured-viz-profile-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], viewport: { width: 1100, height: 850 } });
    const page = await context.newPage();
    page.on('crash', () => console.error('Fixture page crashed'));
    page.on('pageerror', error => console.error('Fixture page error:', error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const atomKey = 'visualization-state-v3:["local","thread"]';
    await page.evaluate(({ chart, atomKey }) => {
      window.structuredHarness.configure(chart, { unrelated: { keep: true }, [atomKey]: { '/chart.html': { hostId: 'local', threadId: 'thread', path: '/chart.html', state: { modelContent: { selected: 1 }, privateContent: 'old', extension: 5 } }, mystery: { unknown: true } } });
      window.structuredHarness.mount();
    }, { chart, atomKey });
    const locator = page.frameLocator('iframe[title="Visualization content"]');
    await locator.locator('#chart').waitFor();
    const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
    if (!frame) throw new Error('Missing frame');
    assert.deepEqual(await frame.evaluate(() => (window as unknown as { initial: unknown }).initial), { state: { modelContent: { selected: 1 }, privateContent: 'old', extension: 5 }, locale: 'en-GB', variable: '#112233', computed: '#112233' });
    const security = await frame.evaluate(async () => {
      const api = (window as unknown as { openai: { callTool(name: string, args: unknown): Promise<unknown> } }).openai;
      let generic = false, invalid = false, parent = false;
      try { await api.callTool('host.rpc', {}); } catch { generic = true; }
      try { await api.callTool('__codex_visualization_annotations__', { type: 'register', registrationId: 'bad', targets: [] }); } catch { invalid = true; }
      try { void window.parent.document.body; } catch { parent = true; }
      return { generic, invalid, parent };
    });
    assert.deepEqual(security, { generic: true, invalid: true, parent: true });
    await locator.locator('#follow').click();
    await page.getByRole('dialog', { name: 'Send follow-up?' }).getByRole('button', { name: 'Add to draft instead' }).click();
    await page.waitForFunction(() => window.structuredHarness.drafts.length === 1);
    const followUp = await page.evaluate(() => window.structuredHarness.drafts[0]);
    assert.equal(followUp.text, 'Explain this');
    assert.deepEqual(followUp.images, []);
    assert.deepEqual(followUp.files, []);
    assert.equal(followUp.references?.length, 1);
    const followReference = followUp.references![0];
    assert.match(followReference.id, /^[\da-f-]{36}$/i);
    assert.equal(followReference.text, 'Visualization: Chart details');
    assert.equal(followReference.kind, 'visualization');
    const followContext = { type: 'visualization', hostId: 'local', threadId: 'thread', path: '/chart.html', title: 'Chart details', context: { series: ['a', 'b'], count: 2 } };
    assert.deepEqual(followReference.context, followContext);
    assert.deepEqual(followReference.original, { originalUserInput: 'Explain this', referenceContext: followContext });
    assert.equal('originalUserInput' in followUp, false);
    assert.equal('referenceContext' in followUp, false);
    await page.evaluate(() => window.structuredHarness.theme());
    await frame.waitForFunction(() => document.documentElement.lang === 'fr-FR' && getComputedStyle(document.documentElement).getPropertyValue('--viz-accent').trim() === '#aabbcc' &&
      (window as unknown as { openai: { visualizationStyleVariables: Record<string, string>; locale: string } }).openai.visualizationStyleVariables['--viz-accent'] === '#aabbcc' &&
      (window as unknown as { openai: { locale: string } }).openai.locale === 'fr-FR');
    await page.getByRole('button', { name: 'Annotate' }).click();
    await locator.locator('#chart').click();
    await page.getByRole('slider', { name: 'Amount' }).waitFor();
    await page.getByRole('slider', { name: 'Amount' }).fill('7');
    await page.getByRole('textbox', { name: 'Color', exact: true }).fill('#334455');
    await page.getByRole('checkbox', { name: 'Enabled' }).uncheck();
    await page.getByRole('combobox', { name: 'Mode' }).selectOption('b');
    await frame.waitForFunction(() => (window as unknown as { values: { mode: string } }).values.mode === 'b');
    assert.deepEqual(await frame.evaluate(() => (window as unknown as { values: unknown }).values), { amount: 7, color: '#334455', enabled: false, mode: 'b' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await frame.waitForFunction(() => (window as unknown as { values: { amount: number } }).values.amount === 2);
    assert.deepEqual(await frame.evaluate(() => (window as unknown as { values: unknown }).values), { amount: 2, color: '#112233', enabled: true, mode: 'a' });
    await page.getByRole('button', { name: 'Annotate' }).click();
    await locator.locator('#chart').click();
    await page.getByRole('slider', { name: 'Amount' }).fill('3');
    await frame.waitForFunction(() => (window as unknown as { values: { amount: number } }).values.amount === 3);
    await locator.locator('#second').click();
    await frame.waitForFunction(() => (window as unknown as { values: { amount: number } }).values.amount === 2);
    await page.getByRole('button', { name: 'Annotate' }).click();
    await locator.locator('#chart').click();
    await page.getByRole('checkbox', { name: 'Secondary' }).waitFor();
    await locator.locator('#dispose-second').click();
    await page.getByRole('checkbox', { name: 'Secondary' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Annotate' }).click();
    await locator.locator('#chart').click();
    await page.getByRole('slider', { name: 'Amount' }).fill('8');
    await page.getByLabel('Annotation feedback').fill('Make the chart larger');
    await page.getByRole('button', { name: 'Add to draft' }).click();
    await page.waitForFunction(() => window.structuredHarness.drafts.length === 2);
    const draft = await page.evaluate(() => window.structuredHarness.drafts[1]);
    assert.equal(draft.text, 'Make the chart larger');
    const reference = draft.references?.[0];
    assert.equal(reference?.original.originalUserInput, draft.text);
    assert.equal(reference?.context.title, 'Visualization changes');
    assert.deepEqual(reference?.original.referenceContext, reference?.context);
    assert.match(JSON.stringify(reference?.context.context), /amount-ref/);
    assert.match(JSON.stringify(reference?.context.context), /"variant":"base"/);
    await frame.waitForFunction(() => (window as unknown as { values: { amount: number } }).values.amount === 2);
    const persistedInteraction = await page.evaluate(() => window.structuredHarness.atoms()['visualization-interaction-state-v1:["local","thread"]']);
    assert.match(JSON.stringify(persistedInteraction), /amount-ref/);
    await locator.locator('#save').click();
    await frame.waitForFunction(() => (window as unknown as { saved?: boolean }).saved === true);
    await page.evaluate(() => window.structuredHarness.unmount());
    await page.evaluate(() => window.structuredHarness.mount());
    await locator.locator('#chart').waitFor();
    const reloaded = await (await page.locator('iframe').elementHandle())?.contentFrame();
    if (!reloaded) throw new Error('Missing reloaded frame');
    assert.deepEqual(await reloaded.evaluate(() => (window as unknown as { initial: { state: unknown } }).initial.state), { modelContent: { selected: 2 }, privateContent: { filter: 'current' } });
    await page.evaluate(key => {
      const atom = window.structuredHarness.atoms()[key] as Record<string, unknown>;
      window.structuredHarness.replaceAtom(key, { ...atom, '/chart.html': { hostId: 'local', threadId: 'thread', path: '/chart.html', state: { modelContent: { selected: 3 }, privateContent: null } } });
    }, atomKey);
    await reloaded.waitForFunction(() => (window as unknown as { openai: { widgetState: { modelContent: { selected: number } } } }).openai.widgetState.modelContent.selected === 3);
    const atoms = await page.evaluate(() => window.structuredHarness.atoms());
    assert.deepEqual(atoms.unrelated, { keep: true });
    assert.deepEqual((atoms[atomKey] as Record<string, unknown>).mystery, { unknown: true });
    await page.evaluate(() => window.structuredHarness.fail(true));
    await locator.locator('#save').click();
    await reloaded.waitForFunction(() => typeof (window as unknown as { saveError?: string }).saveError === 'string');
    assert.deepEqual(await page.evaluate(() => window.structuredHarness.atoms()), atoms);
    assert.deepEqual(await reloaded.evaluate(() => (window as unknown as { openai: { widgetState: unknown } }).openai.widgetState), { modelContent: { selected: 3 }, privateContent: null });
    const previousSource = await page.locator('iframe').getAttribute('src');
    const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame.url().includes('yard_viz_init=') && frame.url() !== previousSource, timeout: 7_000 });
    await page.evaluate(() => { window.structuredHarness.fail(false); window.structuredHarness.mount('remote'); });
    await page.waitForFunction(old => {
      const src = document.querySelector('iframe')?.src;
      return !!src && src.includes('yard_viz_init=') && src !== old;
    }, previousSource);
    const remote = await navigated;
    await remote.locator('#chart').waitFor();
    assert.equal(await remote.evaluate(() => (window as unknown as { initial: { state: unknown } }).initial.state), null);
    await page.getByRole('button', { name: 'Annotate' }).click();
    await locator.locator('#chart').click();
    await page.getByRole('slider', { name: 'Amount' }).fill('9');
    await page.evaluate(() => window.structuredHarness.fail(true));
    await page.getByRole('button', { name: 'Add to draft' }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture storage failed' }).waitFor();
    assert.equal(await page.evaluate(() => window.structuredHarness.drafts.length), 2);
    assert.equal(await remote.evaluate(() => (window as unknown as { values: { amount: number } }).values.amount), 9);
    await page.evaluate(() => { window.structuredHarness.fail(false); window.structuredHarness.delay(true); });
    await page.getByRole('button', { name: 'Add to draft' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Add to draft' && button.disabled));
    await page.evaluate(() => { window.structuredHarness.unmount(); window.structuredHarness.delay(false); window.structuredHarness.release(); });
    await page.waitForFunction(() => !!window.structuredHarness.atoms()['visualization-interaction-state-v1:["remote","thread"]']);
    assert.equal(await page.evaluate(() => window.structuredHarness.drafts.length), 2);
    await page.evaluate(() => window.structuredHarness.mount('remote'));
    await locator.locator('#chart').waitFor();
    await locator.locator('#dispose').click();
    await page.getByRole('button', { name: 'Annotate' }).click();
    await locator.locator('#chart').click();
    assert.equal(await page.getByRole('slider', { name: 'Amount' }).count(), 0);
    await page.evaluate(() => window.structuredHarness.unmount());
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
