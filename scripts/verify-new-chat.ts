// Run under /tmp/agents-workbench-heavy.lock after building; all state is disposable.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem, NO_REPLY } from '../test/fake-codex.ts';

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
fake.threads.set(id, fixtureThread(id, root, { name: 'Previous chat', turns: [fixtureTurn('previous-turn', [
  { ...agentItem('previous-answer', 'Previous conversation response'), phase: 'final_answer' },
])] }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('thread/turns/list', params => ({
  data: [...fake.threads.get(String(params.threadId))!.turns].reverse().map(turn => ({ ...turn,
    items: params.itemsView === 'notLoaded' ? [] : turn.items, itemsView: params.itemsView ?? 'full',
  })), nextCursor: null, backwardsCursor: null,
}));
let releaseStart: () => void = () => {};
const startGate = new Promise<void>(resolve => { releaseStart = resolve; });
fake.handlers.set('thread/start', async (params, { message, send }) => {
  const fixturePrewarm = params.serviceName === 'yard-prewarm-fixture';
  if (!fixturePrewarm) await startGate;
  const result = record(fake.defaultResult('thread/start', params));
  if (fixturePrewarm) record(result.thread).name = 'Private prewarm';
  send({ id: message.id, result });
  send({ method: 'thread/started', params: { thread: result.thread } });
  return NO_REPLY;
});
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: process.env.AGENTS_TEST_CODEX_SOCKET ?? fake.socketPath,
  codexHome: process.env.AGENTS_TEST_CODEX_HOME ?? join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: '26.1013.40934', realDaemonUsed: !!process.env.AGENTS_TEST_CODEX_SOCKET };
const background = process.env.AGENTS_NEW_CHAT_KEY === 'Control+Enter';
let page: Page | undefined;
let fixtureBridge: WebSocket | undefined;
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
  if (!process.env.AGENTS_TEST_CODEX_SOCKET) {
    // Create through the host's actual prewarm channel. A nonempty title
    // verifies that lifecycle identity, rather than content, keeps it private.
    const projectId = [...fake.projects.keys()][0] ?? null;
    fixtureBridge = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
    await once(fixtureBridge, 'open');
    const privateThread = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Prewarm fixture timed out')), 5000);
      fixtureBridge!.on('message', bytes => {
        const value = JSON.parse(String(bytes));
        if (value.message?.id !== 'fixture-prewarm') return;
        clearTimeout(timer);
        if (value.message.error) reject(new Error(value.message.error.message));
        else resolve(value.message.result.thread);
      });
    });
    fixtureBridge.send(JSON.stringify({ type: 'thread-prewarm-start', request: { id: 'fixture-prewarm', method: 'thread/start',
      params: { cwd: root, projectId, serviceName: 'yard-prewarm-fixture' } } }));
    const prewarm = await privateThread;
    fake.broadcast({ method: 'thread/started', params: { thread: prewarm } });
    const named = fixtureThread('00000000-0000-4000-8000-000000000003', root, { projectId, name: 'Explicitly named chat' });
    fake.threads.set(named.id, named);
    fake.broadcast({ method: 'thread/started', params: { thread: named } });
    const rows = page.locator('[data-app-action-sidebar-thread-row]');
    await rows.getByText(named.name!, { exact: true }).first().waitFor({ timeout: 5000 });
    assert.equal(await rows.getByText('Private prewarm', { exact: true }).count(), 0);
    assert.equal(await rows.getByText(/^(New chat|新聊天)$/, { exact: true }).count(), 0,
      'an empty prewarm must stay out of the sidebar');
    checks.push('Host-tracked prewarms stay private regardless of title; ordinary named chats remain visible');
  }
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
  const rows = page.getByRole('list', { name: /New chat project/ }).locator('[data-app-action-sidebar-thread-row]');
  await rows.getByText('First message should appear immediately', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await rows.getByText('First message should appear immediately', { exact: true }).count(), 1);
  assert.equal(await rows.getByText(/^(New chat|新聊天)$/, { exact: true }).count(), 0,
    'sending must leave one real conversation and no blank sidebar row');
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
  fixtureBridge?.terminate();
  if (!report.ok) report.rpcMethods = fake.messages.map(message => message.method);
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
