// Run under /tmp/agents-workbench-heavy.lock after building. No real conversations are used.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-ui-bugs-');
const output = resolve(process.env.AGENTS_BUG_EVIDENCE ?? '.local/sidebar-copy-models');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(output, { recursive: true });
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Active project', path: root }]));
const fake = await createFakeCodex(root);
const id = '00000000-0000-4000-8000-000000000001';
const code = 'const greeting = "你好";\n\tconsole.log(greeting);';
const message = 'Copy fixture:\n\n```ts\n' + code + '\n```';
fake.threads.set(id, fixtureThread(id, root, { name: 'Code example', model: 'gpt-6-sol',
  status: { type: 'active', activeFlags: [] }, turns: [fixtureTurn('turn-copy', [agentItem('code-copy', message)], 'inProgress')] }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
const config = record(fake.defaultResult('config/read', {}).config);
let selectedModel = 'gpt-6-sol';
fake.handlers.set('config/read', () => ({ config: { ...config, model: selectedModel, model_provider: 'openai' }, origins: {}, layers: null }));
fake.handlers.set('model/list', () => ({ data: [
  ['gpt-6-sol', 'GPT-6 Sol'], ['gpt-6.1-sol', 'GPT-6.1 Sol'], ['gpt-6.1-terra', 'GPT-6.1 Terra'], ['hidden-fixture', 'Hidden fixture'],
].map(([model, displayName], index) => ({ id: model, model, displayName, description: 'Model visibility fixture', isDefault: index === 0,
  hidden: index === 3, defaultReasoningEffort: 'high', inputModalities: ['text'],
  supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }, { reasoningEffort: 'high', description: 'High' }] })), nextCursor: null }));
fake.handlers.set('config/batchWrite', params => {
  for (const edit of params.edits as { keyPath: string; value: string }[]) if (edit.keyPath === 'model') selectedModel = edit.value;
  return { status: 'ok', version: 'fixture', filePath: join(root, 'codex/config.toml'), overriddenMetadata: null };
});
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: '26.1013.40934', realDaemonUsed: false };
let page: Page | undefined;
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 1280 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // A saved pre-fix bundle can reproduce the missing clipboard service.
    if (process.env.AGENTS_TEST_BASELINE_HOST) {
      const body = await readFile(process.env.AGENTS_TEST_BASELINE_HOST, 'utf8');
      await page.route('**/native-host.js', route => route.fulfill({ contentType: 'text/javascript', body }));
    }
    await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
    const copy = page.getByRole('button', { name: /^(Copy code|复制代码)$/ });
    await copy.waitFor({ timeout: 60000 });
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    await copy.tap();
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), code, { timeout: 5000 });
    checks.push(`${viewport.width}px: code copy preserves Unicode, tabs and newlines`);

    const folder = page.locator('[data-app-action-sidebar-project-row]').filter({ hasText: 'Active project' });
    if (await folder.getAttribute('aria-expanded') === 'true') await folder.tap();
    const indicator = folder.locator('.grid > div.col-start-1.row-start-1');
    await indicator.waitFor();
    const newChat = page.getByRole('button', { name: /^(Start new chat in Active project|在 Active project 中开始新聊天)$/ });
    const indicatorBox = await indicator.boundingBox(), actionBox = await newChat.boundingBox();
    assert.ok(indicatorBox && actionBox);
    assert.ok(indicatorBox.x + indicatorBox.width <= actionBox.x, 'The running indicator and new-chat button must not overlap');
    assert.equal(await indicator.evaluate(e => getComputedStyle(e).visibility), 'visible');
    await folder.screenshot({ path: join(output, `${viewport.width}-active-project.png`) });
    checks.push(`${viewport.width}px: active collapsed project shows its indicator beside new-chat`);
    await newChat.tap();
    await page.getByRole('textbox').last().waitFor();
    checks.push(`${viewport.width}px: the new-chat button still opens the composer`);
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
  const copy = page.getByRole('button', { name: /^(Copy code|复制代码)$/ });
  await copy.waitFor({ timeout: 60000 });
  // Keep the actual read API to verify the OS clipboard while exercising the
  // HTTP/unsupported-API path through the real renderer button and RPC service.
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('legacy-copy-sentinel');
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: undefined });
  });
  await copy.click();
  await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), code, { timeout: 5000 });
  checks.push('Desktop: legacy copy writes the actual clipboard when the async write API is unavailable');
  await page.evaluate(() => { document.execCommand = () => false; });
  await copy.click();
  await page.getByText(/Couldn.t copy to clipboard|无法复制到剪贴板|未能复制到剪贴板/).first().waitFor({ timeout: 10000 });
  checks.push('Desktop: failed clipboard writes surface an error');
  await context.close();

  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(app.url, { waitUntil: 'commit' });
  await page.getByRole('button', { name: /6 Sol/ }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /6 Sol/ }).click();
  await page.getByRole('menuitem', { name: /^(选择模型|Select model)$/ }).click();
  await page.getByRole('menuitemradio', { name: /^(?:GPT-)?6\.1 Sol$/ }).waitFor();
  await page.getByRole('menuitemradio', { name: /^(?:GPT-)?6\.1 Terra$/ }).waitFor();
  assert.equal(await page.getByRole('menuitemradio', { name: 'Hidden fixture', exact: true }).count(), 0);
  await page.getByRole('menu').last().screenshot({ path: join(output, 'models.png') });
  await page.getByRole('menuitemradio', { name: /^(?:GPT-)?6\.1 Sol$/ }).click();
  await fake.waitFor(message => message.method === 'config/batchWrite' && selectedModel === 'gpt-6.1-sol');
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('button', { name: /6\.1 Sol/ }).waitFor({ timeout: 60000 });
  checks.push('Both 6.1 models are selectable, hidden models stay hidden, and the selection survives reload');
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('turn/start').length, 0);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
