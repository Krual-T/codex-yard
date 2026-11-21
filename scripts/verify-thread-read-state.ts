// Isolated real CLI, scripted loopback provider and two independent browsers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { BrowserContext, Locator, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import type { Page as RpcPage, RpcMessage, ThreadReadState, ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';
import { createCliResponsesFixture } from './cli-responses-fixture.ts';

const source = process.argv.includes('--source');
const root = await mkdtemp('/tmp/yard-read-state-');
const codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_READ_STATE_EVIDENCE ?? '.local/thread-read-state');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Read state fixture', path: root }]));
let releaseActive!: () => void;
const activeGate = new Promise<void>(resolve => { releaseActive = resolve; });
const { server: provider, port } = await createCliResponsesFixture(body => body.includes('WAIT_FOR_READ_STATE_TEST')
  ? { text: 'Active final answer', wait: activeGate } : { text: 'Read state fixture answer' });
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.fixture]
name = "Read state fixture"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
[features]
code_mode = false
`, { mode: 0o600 });
const socketPath = join(root, 'backend.sock');
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: source ? 'react-ts' : '26.1013.40934', provider: 'loopback scripted Responses' };
try {
  for (let i = 0; ; i++) {
    try { await access(socketPath); break; } catch {
      if (i >= 100 || child.exitCode !== null) throw new Error(log || 'CLI did not start');
      await delay(100);
    }
  }
  app = await createNativeWorkbench({ port: 0, dataDir, codexHome, workspace: root, socketPath, sourceWorkspace: source,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  const ids: string[] = [], names = ['Older unread', 'Active task', 'Latest read'];
  for (let i = 0; i < names.length; i++) {
    const started: { thread: ThreadSummary } = await app.control.request<{ thread: ThreadSummary }>('thread/start', { cwd: root, historyMode: 'paginated' }, { mutating: true });
    const thread: ThreadSummary = started.thread;
    ids.push(thread.id);
    await app.control.request('thread/name/set', { threadId: thread.id, name: names[i] }, { mutating: true });
    for (let turn = 0; turn < (source && i === 0 ? 4 : 1); turn++) {
      const completed = i === 1 ? Promise.resolve() : new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CLI turn timed out')), 15000);
        const listener = (message: RpcMessage) => {
          if (message.method === 'turn/completed' && record(message.params).threadId === thread.id) {
            clearTimeout(timer); app!.control.off('message', listener); resolve();
          }
        };
        app!.control.on('message', listener);
      });
      await app.control.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: i === 1 ? 'WAIT_FOR_READ_STATE_TEST' : 'Read state fixture', text_elements: [] }] }, { mutating: true });
      await completed;
      if (turn === 0 && i !== 1) {
        const stateResponse: { readState?: ThreadReadState | null } = await app.control.request<{ readState?: ThreadReadState | null }>('thread/read', { threadId: thread.id, includeTurns: false });
        const readState: ThreadReadState | null | undefined = stateResponse.readState;
        assert.ok(readState);
        await app.control.request('thread/readState/update', { threadId: thread.id, expectedRevision: readState.revision,
          operation: { type: i === 0 && !source ? 'unread' : 'read' } }, { mutating: true });
      }
    }
    await delay(1100);
  }
  if (source) {
    const { readState } = await app.control.request<{ readState: ThreadReadState }>('thread/read', { threadId: ids[0], includeTurns: false });
    const latest = await app.control.request<RpcPage<TurnSummary>>('thread/turns/list', {
      threadId: ids[0], limit: 2, sortDirection: 'desc', itemsView: 'summary',
    });
    assert.equal(latest.data.length, 2);
    assert.ok(latest.nextCursor);
    assert.equal(readState.firstUnread?.type, 'turn');
    if (readState.firstUnread?.type !== 'turn') throw new Error('Expected a turn read receipt');
    const firstUnreadTurn = readState.firstUnread.turnId;
    assert.ok(!latest.data.some(turn => turn.id === firstUnreadTurn));
    report.paginatedUnread = { firstUnreadTurn, latestTurnIds: latest.data.map(turn => turn.id) };
  }
  const probes: Record<string, unknown> = {};
  for (const method of ['project/list', 'threadSection/list', 'thread/queue/list', 'thread/attachment/list']) {
    const result: Record<string, unknown> = await app.control.request<Record<string, unknown>>(method,
      { limit: 50, ...(method.startsWith('thread/') ? { threadId: ids[1] } : {}) });
    assert.ok(Array.isArray(result.data));
    probes[method] = { fields: Object.keys(result), count: result.data.length };
  }
  report.backendStateInterfaces = probes;
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling'] });
  const pages: Page[] = [];
  for (let i = 0; i < 2; i++) {
    const context: BrowserContext = await browser.newContext({ viewport: { width: i ? 800 : 1440, height: 900 } });
    await context.addInitScript(({ id }) => {
      if (window !== window.top) return;
      if (!localStorage.getItem('read-state-test-seeded')) {
        localStorage.setItem('native-atoms', JSON.stringify({ 'unread-thread-ids-by-host-v1': { local: [id] } }));
        localStorage.setItem('codex:persisted-atom:unread-thread-ids-by-host-v1', JSON.stringify({ local: [id] }));
        localStorage.setItem('read-state-test-seeded', 'true');
      }
    }, { id: ids[2] });
    const page: Page = await context.newPage();
    await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
    page.on('pageerror', error => errors.push(error.message));
    pages.push(page);
    await page.goto(app.url, { waitUntil: 'commit' });
    if (!source) {
      await page.waitForFunction(() => document.querySelectorAll('#yard-startup [data-yard-startup-thread-row]').length === 3);
      report['initialOrder' + i] = await page.locator('#yard-startup [data-yard-startup-thread-row]').allTextContents();
      assert.deepEqual(report['initialOrder' + i], names);
    }
    await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 30000 });
    const rows: Locator = page.locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]');
    await rows.filter({ hasText: names[0] }).first().waitFor();
    const order: string[] = await rows.allTextContents();
    const labels = order.filter(text => names.some(name => text.includes(name))).map(text => names.find(name => text.includes(name)));
    report['fullOrder' + i] = labels;
    assert.deepEqual(labels, [...names, ...names], 'project and recent sections both use priority order');
    assert.equal(await page.evaluate(() => 'unread-thread-ids-by-host-v1' in JSON.parse(localStorage.getItem('native-atoms') || '{}')), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('codex:persisted-atom:unread-thread-ids-by-host-v1')), null);
  }
  checks.push('Initial and full sidebars show unread, active, then latest read; stale browser markers are removed in desktop and tablet contexts');
  if (source) {
    await pages[0].bringToFront();
    const active = pages[0].locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]').filter({ hasText: names[1] }).first();
    await active.click();
    await pages[0].getByRole('button', { name: 'Stop generating', exact: true }).waitFor();
    await active.getByRole('status', { name: 'Working' }).waitFor();
    await pages[0].reload();
    await pages[0].getByRole('button', { name: 'Stop generating', exact: true }).waitFor();
    await active.getByRole('status', { name: 'Working' }).waitFor();
    checks.push('Opening and reloading an active backend conversation preserves its running circle');
  }
  await pages[0].bringToFront();
  await pages[0].locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]').filter({ hasText: names[0] }).first().click();
  await pages[0].getByText('Read state fixture answer', { exact: true }).first().waitFor({ timeout: 15000 });
  report.focus = await pages[0].evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }));
  await waitReceipt(ids[0], false);
  await waitBrowserReceipt(pages[1], ids[0], false);
  await waitFirstRow(pages[1], names[1]);
  checks.push('Opening a conversation marks it read in app-server and synchronizes the second browser' +
    (source ? ', even when its first unread turn is outside the latest history page' : ''));
  await pages[0].goto(app.url);
  await pages[0].waitForFunction(() => !document.getElementById('yard-startup'));
  const row = pages[1].locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]').filter({ hasText: names[0] }).first();
  await pages[1].bringToFront();
  if (source) {
    const { readState } = await app.control.request<{ readState: ThreadReadState }>('thread/read', { threadId: ids[0], includeTurns: false });
    await app.control.request('thread/readState/update', { threadId: ids[0], expectedRevision: readState.revision,
      operation: { type: 'unread' } }, { mutating: true });
  } else {
    await row.click({ button: 'right' });
    await pages[1].getByRole('menuitem', { name: /Mark.*unread|标记.*未读/i }).click();
  }
  await waitReceipt(ids[0], true);
  await waitBrowserReceipt(pages[0], ids[0], true);
  await Promise.all(pages.map(page => waitFirstRow(page, names[0])));
  await pages[0].reload();
  await waitBrowserReceipt(pages[0], ids[0], true);
  checks.push((source ? 'An external unread mark' : 'Native Mark unread') + ' persists in app-server, synchronizes another browser and survives reloading');
  const externalState: { readState: ThreadReadState } = await app.control.request<{ readState: ThreadReadState }>('thread/read', { threadId: ids[0], includeTurns: false });
  await app.control.request('thread/readState/update', { threadId: ids[0], expectedRevision: externalState.readState.revision, operation: { type: 'read' } }, { mutating: true });
  await Promise.all(pages.map(page => waitBrowserReceipt(page, ids[0], false)));
  await Promise.all(pages.map(page => waitFirstRow(page, names[1])));
  checks.push('A separate backend client marks the thread read; both browsers update and reorder without reloading');
  releaseActive();
  await waitBrowserReceipt(pages[0], ids[1], true);
  if (!source) await pages[0].waitForFunction(id => (window as unknown as { workbenchThreadReadState: { priority(key: string): number } })
    .workbenchThreadReadState.priority('local:' + id) === 0, ids[1]);
  await Promise.all(pages.map(page => waitFirstRow(page, names[1])));
  checks.push('A background turn completion updates the shared backend receipt');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  report.noDesktopInstallation = await access('/usr/lib/chatgpt/resources/app.asar').then(() => false, () => true);
  for (const [i, page] of pages.entries()) {
    await page.mouse.move(750, 100);
    await page.screenshot({ path: join(output, i ? 'tablet.png' : 'desktop.png') });
  }
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  async function waitReceipt(threadId: string, unread: boolean) {
    for (let i = 0; i < 60; i++) {
      const { readState } = await app!.control.request('thread/read', { threadId, includeTurns: false });
      if (readState && (readState.firstUnread != null) === unread) return;
      await delay(100);
    }
    throw new Error('Backend read receipt did not update');
  }
  async function waitBrowserReceipt(page: Page, threadId: string, unread: boolean) {
    if (source) {
      await page.waitForFunction(({ threadId, unread }) => {
        const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')].filter(row =>
          row.getAttribute('data-app-action-sidebar-thread-id') === 'local:' + threadId);
        return rows.length > 0 && rows.every(row => !!row.querySelector('[aria-label="Unread"]') === unread);
      }, { threadId, unread }, { timeout: 15000 });
      return;
    }
    await page.waitForFunction(({ threadId, unread }) => {
      const store = (window as Window & { workbenchThreadReadState?: { snapshot(): Record<string, string[]> } }).workbenchThreadReadState;
      const ids = store?.snapshot().local;
      return ids != null && ids.includes(threadId) === unread;
    }, { threadId, unread }, { timeout: 15000 });
  }
  async function waitFirstRow(page: Page, name: string) {
    await page.waitForFunction(name => {
      const rows = document.querySelectorAll('#app-shell-sidebar [data-app-action-sidebar-thread-row]');
      return rows.length === 6 && [rows[0], rows[3]].every(row => row.textContent?.includes(name));
    }, name);
  }
} catch (error) {
  for (const [i, page] of (browser?.contexts().flatMap(context => context.pages()) ?? []).entries()) {
    await page.screenshot({ path: join(output, 'failure-' + i + '.png') }).catch(() => {});
    await writeFile(join(output, 'failure-' + i + '.txt'), await page.locator('body').ariaSnapshot().catch(() => ''));
  }
  await writeFile(join(output, 'failure.json'), JSON.stringify({ ...report, error: String(error) }, null, 2));
  await writeFile(join(output, 'cli.log'), log);
  throw error;
} finally {
  releaseActive(); await browser?.close(); await app?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
