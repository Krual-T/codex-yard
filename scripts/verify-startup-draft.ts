import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { rendererAssets } from '../src/native/renderer-assets.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { webRendererPrefix } from '../src/native/visualizations.ts';
import { createFakeCodex, fixtureThread } from '../test/fake-codex.ts';

const folder = await mkdtemp('/tmp/yard-startup-draft-');
const output = resolve(process.env.AGENTS_STARTUP_DRAFT_EVIDENCE ?? '.local/startup-draft');
const dataDir = join(folder, 'data');
await mkdir(dataDir);
await mkdir(output, { recursive: true });
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
const fake = await createFakeCodex(folder);
const id = '00000000-0000-4000-8000-000000000001';
fake.threads.set(id, fixtureThread(id, folder, { name: 'Startup draft fixture' }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: folder, socketPath: fake.socketPath,
  codexHome: join(folder, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results: unknown[] = [];
try {
  const resource = await fetch(app.url + rendererAssets.application);
  assert.equal(resource.status, 200);
  assert.match(resource.headers.get('cache-control') ?? '', /\bimmutable\b/);
  assert.equal(resource.headers.get('content-encoding'), 'gzip');
  assert.ok((await resource.text()).includes('yardStagedStartup as Ag,'));
  const original = await fetch(app.url + rendererAssets.application.slice(webRendererPrefix.length));
  assert.equal(original.status, 200);
  assert.ok((await original.text()).includes('CRu as Ag,'));
  for (const mode of (process.env.AGENTS_STARTUP_DRAFT_CASES ?? 'cold,ime,saved,collision,navigate,mobile,send').split(',')) {
    const context = await browser.newContext(mode === 'mobile'
      ? { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } }
      : { viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const consoleErrors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    try {
      await page.addInitScript(() => {
        const timings = { earlyInput: 0, earlyPaint: 0 };
        Object.assign(window, { yardDraftTimings: timings });
        window.addEventListener('input', event => {
          if (timings.earlyInput || !(event.target instanceof HTMLTextAreaElement) || event.target.id !== 'pending-yard-home-input') return;
          timings.earlyInput = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => { timings.earlyPaint = performance.now(); }));
        }, true);
      });
      const saved = 'Existing original home draft';
      if (mode === 'saved') {
        await page.addInitScript(draft => {
          localStorage.setItem('native-atoms', JSON.stringify({ 'composer-prompt-drafts-v1': { 'new-conversation': draft } }));
        }, saved);
      }
      if (['ime', 'collision', 'navigate', 'mobile', 'send'].includes(mode)) {
        await page.route('**/app-primary-f5ea123a0407.js', async route => { await barrier; await route.continue(); });
      }
      await page.goto(app.url, { waitUntil: 'commit' });
      const started = Date.now();
      await page.locator('[data-yard-startup-thread-row]').first().waitFor({ timeout: 10000, state: mode === 'mobile' ? 'attached' : 'visible' });
      const pending = page.locator('#pending-yard-home-input');
      const editor = page.locator('#root [data-codex-composer="true"]').last();
      if (mode === 'saved') {
        assert.equal(await pending.count(), 0);
        await editor.waitFor({ timeout: 30000 });
        assert.equal(await editor.textContent(), saved);
      } else {
        const inputAt = Number(process.env.AGENTS_STARTUP_DRAFT_INPUT_AT ?? 350);
        const box = await pending.boundingBox();
        assert.ok(box);
        if (mode === 'cold') await delay(Math.max(0, started + inputAt - Date.now()));
        if (mode === 'mobile') await pending.tap();
        else await page.mouse.click(box.x + 15, box.y + 15);
        let value = 'Yard 启动输入';
        await page.keyboard.insertText(value);
        assert.equal(await pending.inputValue(), value);
        if (mode === 'ime') {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
          await page.waitForFunction(() => document.getElementById('pending-yard-home-input')?.dataset.composition === 'active');
          release();
          await page.locator('#root [data-app-shell-frame]').waitFor({ state: 'attached', timeout: 30000 });
          assert.equal(await pending.isVisible(), true);
          assert.equal(await pending.getAttribute('data-yard-adopted'), null);
          await page.keyboard.insertText('中文');
          value += '中文';
          await cdp.detach();
        } else if (mode === 'collision') {
          await page.evaluate(draft => {
            localStorage.setItem('native-atoms', JSON.stringify({ 'composer-prompt-drafts-v1': { 'new-conversation': draft } }));
          }, saved);
        } else if (mode === 'navigate') {
          await page.locator('[data-yard-startup-thread-row]').first().click();
          assert.equal(await pending.isVisible(), false);
        } else {
          await pending.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 4));
          if (mode === 'send') {
            await pending.evaluate(element => {
              const root = document.getElementById('root')!;
              const observer = new MutationObserver(() => {
                if (!root.querySelector('[data-codex-composer="true"]')) return;
                observer.disconnect();
                (element as HTMLTextAreaElement).setSelectionRange(5, 7, 'backward');
              });
              observer.observe(root, { childList: true, subtree: true });
            });
          }
        }
        const submissions = fake.calls('turn/start').length;
        release();
        await editor.waitFor({ timeout: 30000 });
        await page.waitForFunction(() => performance.getEntriesByName('workbench-workspace-visible').length > 0);
        if (mode === 'navigate' || mode === 'collision') {
          const recovery = page.locator('#yard-startup-draft-recovery textarea');
          assert.equal(await recovery.inputValue(), value);
          if (mode === 'collision') assert.equal(await editor.textContent(), saved);
          else assert.equal((await editor.textContent())?.includes(value), false);
        } else {
          assert.equal(await editor.textContent(), value);
          if (mode !== 'ime') {
            assert.equal(await editor.evaluate(element => element === document.activeElement), true);
            assert.equal(await page.evaluate(() => getSelection()?.toString()), mode === 'send' ? value.slice(5, 7) : value.slice(2, 4));
          }
          assert.equal(await pending.count(), 0);
          assert.equal(await page.locator('#yard-startup-draft-recovery').count(), 0);
          if (mode === 'send') {
            assert.equal(fake.calls('turn/start').length, submissions);
            await editor.press('End');
            await editor.press('Enter');
            const submit = await fake.waitFor(message =>
              message.method === 'turn/start' && JSON.stringify(message.params.input).includes(value));
            assert.notEqual(submit.params.threadId, id);
            await page.getByRole('region', { name: /^(Conversation|对话)$/ })
              .getByText(value, { exact: true }).waitFor({ timeout: 5000 });
            assert.equal(fake.calls('turn/start').length, submissions + 1);
          }
        }
      }
      const timings = await page.evaluate(() => ({
        ...Reflect.get(window, 'yardDraftTimings'),
        marks: performance.getEntriesByType('mark').map(entry => [entry.name, entry.startTime]),
      }));
      assert.deepEqual(errors, []);
      results.push({ mode, ...timings });
      console.log(JSON.stringify({ mode, ...timings }));
      await page.screenshot({ path: join(output, mode + '.png') });
    } catch (error) {
      await writeFile(join(output, 'failure.json'), JSON.stringify({ mode, errors, consoleErrors, error: String(error),
        snapshot: await page.locator('body').ariaSnapshot().catch(() => '') }, null, 2));
      throw error;
    } finally {
      release();
      await context.close();
    }
  }
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(results, null, 2));
  await browser.close();
  await app.close();
  await fake.close();
  await rm(folder, { recursive: true, force: true });
}
