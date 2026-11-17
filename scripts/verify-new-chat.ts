// Run under /tmp/agents-workbench-heavy.lock after building; all state is disposable.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-new-chat-');
const output = resolve(process.env.AGENTS_NEW_CHAT_EVIDENCE ?? '.local/new-chat');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(output, { recursive: true });
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'New chat project', path: root }]));
const fake = await createFakeCodex(root);
const id = process.env.AGENTS_TEST_THREAD_ID ?? '00000000-0000-4000-8000-000000000001';
fake.threads.set(id, fixtureThread(id, root, { name: 'Previous chat', turns: [fixtureTurn('previous-turn', [agentItem('previous-answer', 'Previous conversation response')])] }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
let releaseStart: () => void = () => {};
const startGate = new Promise<void>(resolve => { releaseStart = resolve; });
fake.handlers.set('thread/start', async params => { await startGate; return fake.defaultResult('thread/start', params); });
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: process.env.AGENTS_TEST_CODEX_SOCKET ?? fake.socketPath,
  codexHome: process.env.AGENTS_TEST_CODEX_HOME ?? join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: '26.1013.40934', realDaemonUsed: !!process.env.AGENTS_TEST_CODEX_SOCKET };
const background = process.env.AGENTS_NEW_CHAT_KEY === 'Control+Enter';
let page: Page | undefined;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
  let submittedThread: string | undefined;
  page.on('websocket', socket => socket.on('framesent', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.request?.method === 'turn/start') submittedThread = message.request.params.threadId;
  }));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
  await page.getByText('Previous conversation response', { exact: true }).waitFor({ timeout: 60000 });
  if (process.env.AGENTS_NEW_CHAT_ENTRY === 'global') {
    await page.getByRole('button', { name: /^(New chat|新聊天)$/ }).first().click();
  } else {
    await page.locator('[data-app-action-sidebar-project-row]').filter({ hasText: 'New chat project' }).hover();
    await page.getByRole('button', { name: /^(Start new chat in New chat project|在 New chat project 中开始新聊天)$/ }).click();
  }
  const editor = page.getByRole('textbox').last();
  await editor.fill('First message should appear immediately');
  await editor.press(background ? 'Control+Enter' : 'Enter');
  if (!process.env.AGENTS_TEST_CODEX_SOCKET) await fake.waitFor(message => message.method === 'thread/start');
  if (!background) await page.getByRole('region', { name: /^(Conversation|对话)$/ }).getByText('First message should appear immediately', { exact: true }).waitFor({ timeout: 1500 });
  report.optimisticRoute = page.url();
  releaseStart();
  if (background) {
    await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'First message should appear immediately' }).first().waitFor({ timeout: 10000 });
    await editor.getByText('First message should appear immediately', { exact: true }).waitFor({ state: 'hidden', timeout: 10000 });
    assert.ok(!new URL(page.url()).searchParams.get('initialRoute'));
    assert.equal(await page.getByRole('region', { name: /^(Conversation|对话)$/ }).count(), 0);
  } else {
    await page.waitForURL(url => submittedThread != null && url.searchParams.get('initialRoute') === '/local/' + submittedThread, { timeout: 10000 });
    await page.getByRole('region', { name: /^(Conversation|对话)$/ }).getByText('First message should appear immediately', { exact: true }).waitFor({ timeout: 5000 });
  }
  assert.notEqual(submittedThread, id);
  report.threadId = submittedThread;
  assert.equal((await editor.innerText()).trim(), '');
  assert.equal(fake.calls('thread/queue/add').length, 0);
  await page.screenshot({ path: join(output, 'sent.png') });
  checks.push(background ? 'Ctrl+Enter sends a new task in the background while keeping the new-chat composer open'
    : 'Sending the first message selects the new conversation and displays its user message before a model response');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    report.url = page.url();
    await page.screenshot({ path: join(output, 'failure.png') });
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  releaseStart();
  if (!report.ok) report.rpcMethods = fake.messages.map(message => message.method);
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
