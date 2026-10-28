// The real pinned page with disposable protocol data; run under the UI lock.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-migration-ui-');
const output = resolve(process.env.AGENTS_MIGRATION_EVIDENCE ?? '.local/renderer-migration');
await mkdir(output, { recursive: true });
const dataDir = join(root, 'data');
await mkdir(dataDir);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Migration project', path: root }]));
const fake = await createFakeCodex(root);
const id = '00000000-0000-4000-8000-000000000631';
const tail = 'MIGRATION_LAST_LINE';
const text = Array.from({ length: 110 }, (_, index) => `Fixture paragraph ${index}: ${'visible sample '.repeat(9)}.`).join('\n\n') + '\n\n' + tail;
const code = 'const greeting = "你好";\n\tconsole.log(greeting);';
fake.threads.set(id, fixtureThread(id, root, { name: 'Migration conversation', updatedAt: Math.floor(Date.now() / 1000) - 300,
  turns: [fixtureTurn('migration-turn', [
    { id: 'migration-input', type: 'userMessage', content: [{ type: 'text', text, text_elements: [] }] },
    agentItem('migration-answer', 'Fixture answer:\n\n```ts\n' + code + '\n```'),
  ])] }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (fixture)' }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, checks, errors };
let page: Page | undefined;

async function mountedComponents(page: Page) {
  return page.locator('[data-markdown-copy="exclude"][aria-expanded]').first().evaluate(element => {
    type Fiber = { type?: { name?: string; displayName?: string }; return?: Fiber; child?: Fiber; sibling?: Fiber };
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    if (!key) throw new Error('The real renderer React fiber was not found');
    let root = Reflect.get(element, key) as Fiber;
    while (root.return) root = root.return;
    const queue = [root], names = new Set<string>();
    for (let visited = 0; queue.length && visited < 50_000; visited++) {
      const fiber = queue.pop()!;
      const name = fiber.type?.displayName ?? fiber.type?.name;
      if (name && /^(CollapsibleUserMessageContent|RelativeTime|CompactRelativeTime)$/.test(name)) names.add(name);
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return [...names].sort();
  });
}

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 800, height: 1280 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width === 800,
      permissions: ['clipboard-read', 'clipboard-write'] });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const modules: string[] = [];
    page.on('response', response => { if (response.url().endsWith('/renderer-components.js') && response.ok()) modules.push(response.url()); });
    await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
    const toggle = page.locator('[data-markdown-copy="exclude"][aria-expanded]').first();
    await toggle.waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector('[data-markdown-copy="exclude"][aria-expanded]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.getByText(tail, { exact: true }).count(), 0);
    // The pinned layout hides inline timestamps in several sidebar variants.
    // Its existing row hover card is also an official YEc consumer.
    await page.locator('[data-app-action-sidebar-thread-row]').first().hover();
    let components = await mountedComponents(page);
    const timestampDeadline = Date.now() + 10_000;
    while (!components.includes('RelativeTime') && Date.now() < timestampDeadline) {
      await page.waitForTimeout(50);
      components = await mountedComponents(page);
    }
    assert.ok(components.includes('CollapsibleUserMessageContent'), 'The authored message component must be mounted in the existing page');
    assert.ok(components.includes('RelativeTime'), 'The authored timestamp component must be mounted in the existing sidebar hover card');
    assert.equal(modules.length, 1, 'Both seams import one authored ESM module');
    checks.push(`${viewport.width}px: original page mounts ${components.join(', ')} from one authored module`);
    await page.screenshot({ path: join(output, `${viewport.width}-collapsed.png`) });
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await toggle.click();
    await page.getByText(tail, { exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-markdown-copy="exclude"][aria-expanded]')?.getAttribute('aria-expanded') === 'false');
    checks.push(`${viewport.width}px: the official disclosure expands and collapses the complete user message`);

    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.getByText(tail, { exact: true }).waitFor();
    assert.equal(await toggle.count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByText(tail, { exact: true }).count(), 0);
    checks.push(`${viewport.width}px: original print state shows full text and restores the collapsed state afterward`);

    const copy = page.getByRole('button', { name: /^(Copy code|复制代码)$/ }).first();
    await copy.click();
    await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected), code);
    checks.push(`${viewport.width}px: existing code copy keeps Unicode, tabs and newlines`);
    await page.reload({ waitUntil: 'commit' });
    await toggle.waitFor({ timeout: 60_000 });
    assert.ok((await mountedComponents(page)).includes('CollapsibleUserMessageContent'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    checks.push(`${viewport.width}px: reload keeps the original route and has no horizontal overflow`);
    await page.screenshot({ path: join(output, `${viewport.width}-reloaded.png`) });
    await context.close();
  }
  assert.equal(fake.calls('turn/start').length, 0, 'This fixture must never send model requests');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot()).catch(() => {});
  }
  throw error;
} finally {
  await browser.close(); await app.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, output }));
}
