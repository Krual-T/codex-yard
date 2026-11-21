// Run under /tmp/agents-workbench-heavy.lock. Synthetic chats and isolated state.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { StartupSidebar } from '../src/native/startup-sidebar.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-visibility-'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_SIDEBAR_VISIBILITY_EVIDENCE ?? '.local/sidebar-visibility');
await Promise.all([mkdir(dataDir), mkdir(output, { recursive: true })]);
const fake = await createFakeCodex(root);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
const ids = Array.from({ length: 65 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
const projectId = 'visibility-project';
fake.projects.set(projectId, { id: projectId, name: 'Visibility project', roots: [{ path: root }],
  metadata: { 'yard.projectThreadOrder': JSON.stringify({ threadIds: ids }) }, position: 0, createdAt: 1, updatedAt: 1 });
for (const [i, id] of ids.entries()) {
  const active = i >= 6 && i <= 12 || i === 18 || i === 19 || i === 60;
  fake.threads.set(id, fixtureThread(id, root, { name: `Visibility chat ${i}`, projectId,
    updatedAt: 1_700_001_000 - i,
    status: active ? { type: 'active', activeFlags: i === 18 ? ['waitingOnApproval'] : i === 19 ? ['waitingOnUserInput'] : [] } : { type: 'idle' },
    turns: [fixtureTurn('turn-' + i, [agentItem('answer-' + i, 'Synthetic answer ' + i)], active ? 'inProgress' : 'completed')] }));
}
fake.threads.get(ids[16])!.turns = Array.from({ length: 6 }, (_, i) => fixtureTurn(`turn-16-${i}`,
  [agentItem(`answer-16-${i}`, `Paginated answer ${i}`)]));
fake.readStates.set(ids[16], { revision: 'unread-16', firstUnread: { type: 'turn', turnId: 'turn-16-0' } });
fake.handlers.set('thread/turns/list', params => {
  if (params.threadId !== ids[16]) return fake.defaultResult('thread/turns/list', params);
  const turns = [...fake.threads.get(ids[16])!.turns];
  if (params.sortDirection !== 'asc') turns.reverse();
  const offset = Number(params.cursor ?? 0), end = offset + Number(params.limit ?? 2);
  return { data: turns.slice(offset, end).map(turn => ({ ...turn,
    items: params.itemsView === 'notLoaded' ? [] : turn.items, itemsView: params.itemsView ?? 'full' })),
    nextCursor: end < turns.length ? String(end) : null, backwardsCursor: null };
});
// Hidden startup rows must not use activity to enter the ordinary sidebar.
fake.threads.get(ids[45])!.ephemeral = true;
fake.threads.get(ids[46])!.threadSource = 'ambient_suggestions';
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, codexHome: join(root, 'codex'),
  socketPath: fake.socketPath, sourceWorkspace: true, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline visibility fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling'] });
const checks: string[] = [], errors: string[] = [], pages: Page[] = [];
const selector = (id: string) => `[data-in-project] [data-app-action-sidebar-thread-id="local:${id}"]`;
const projectRows = (page: Page) => page.locator('[data-in-project] [data-app-action-sidebar-thread-row]');
const notify = (method: string, id: string) => fake.broadcast({ method, params: { threadId: id,
  ...(method === 'thread/status/changed' ? { status: fake.threads.get(id)!.status } : {}),
  ...(method === 'thread/readState/changed' ? { readState: fake.readStates.get(id) } : {}),
} });
async function state(page: Page, id: string, kind: 'working' | 'unread' | 'absent') {
  await page.waitForFunction(({ selector, kind }) => {
    const row = document.querySelector(selector);
    return kind === 'absent' ? !row : !!row?.querySelector(kind === 'working' ? '[aria-label="Working"]' : '[aria-label="Unread"]');
  }, { selector: selector(id), kind });
}
interface HeldSidebar {
  hold: boolean; waiting?: () => void; misses: number; observer: MutationObserver;
}
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: i ? 800 : 1440, height: 900 } });
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.url + (i ? '/' : '/local/' + ids[25]), { waitUntil: 'commit' });
    await page.locator('.yard-source-frame').waitFor();
    await state(page, ids[6], 'working');
    assert.deepEqual((await projectRows(page).evaluateAll(rows => rows.slice(0, 5).map(row => row.getAttribute('data-app-action-sidebar-thread-title')))),
      ['Visibility chat 0', 'Visibility chat 1', 'Visibility chat 2', 'Visibility chat 3', 'Visibility chat 4']);
    for (const index of [6, 7, 8, 9, 10, 11, 12, 16, 18, 19]) assert.equal(await page.locator(selector(ids[index])).count(), 1);
    assert.equal(await page.locator(selector(ids[18])).getByText('Awaiting approval').count(), 1);
    assert.equal(await page.locator(selector(ids[19])).getByText('Needs input').count(), 1);
    assert.equal(await page.locator(selector(ids[45])).count(), 0);
    assert.equal(await page.locator(selector(ids[46])).count(), 0);
  }
  const [page, other] = pages;
  assert.equal(await page.locator(selector(ids[25])).getAttribute('aria-current'), 'page', 'read current chat stays in the project');
  checks.push('Two pages retain more than five active/unread/waiting chats after manual ordering; current read chat remains selected.');
  const project = page.getByRole('button', { name: 'Visibility project', exact: true });
  await project.click();
  assert.match(await project.getAttribute('aria-description') ?? '', /9 working.*2 need attention.*1 unread/);
  assert.equal(await projectRows(page).count(), 0);
  await page.screenshot({ path: join(output, 'collapsed-project.png') });
  await project.focus(); await page.keyboard.press('Enter');
  await page.locator(selector(ids[25])).waitFor();
  const parent = page.getByRole('button', { name: 'Projects', exact: true });
  await parent.click();
  assert.match(await parent.getAttribute('aria-description') ?? '', /9 working/);
  await parent.click();
  checks.push('Project and parent collapse respect the user action and expose activity counts; keyboard reopening retains selection.');

  fake.broadcast({ id: 'visibility-input', method: 'item/tool/requestUserInput', params: {
    threadId: ids[21], turnId: 'turn-21', isBlocking: false,
    questions: [{ id: 'choice', question: 'Synthetic question', isOther: true, options: [] }],
  } });
  for (const page of pages) await page.locator(selector(ids[21])).getByText('Needs input').waitFor();
  fake.broadcast({ method: 'serverRequest/resolved', params: { threadId: ids[21], requestId: 'visibility-input' } });
  await Promise.all(pages.map(page => state(page, ids[21], 'absent')));
  checks.push('A live nonblocking input request beyond the preview remains visible until its backend resolution.');

  // Hold an already captured list response, then deliver newer backend events.
  await page.evaluate(selector => {
    const target = window as unknown as { workbenchStartupSidebar: { load(...args: unknown[]): Promise<StartupSidebar> }; heldSidebar: HeldSidebar };
    const bridge = target.workbenchStartupSidebar, load = bridge.load.bind(bridge);
    const probe: HeldSidebar = { hold: true, misses: 0, observer: new MutationObserver(() => {
      const row = document.querySelector(selector);
      if (!row || !row.querySelector('[aria-label="Working"], [aria-label="Unread"]')) probe.misses++;
    }) };
    probe.observer.observe(document.querySelector('.yard-source-nav')!, { childList: true, subtree: true, attributes: true });
    bridge.load = async (...args) => {
      if (!probe.hold) return load(...args);
      probe.hold = false;
      const snapshot = structuredClone(await load(...args));
      await new Promise<void>(resolve => { probe.waiting = resolve; });
      return snapshot;
    };
    target.heldSidebar = probe;
    window.dispatchEvent(new Event('focus'));
  }, selector(ids[6]));
  await page.waitForFunction(() => !!(window as unknown as { heldSidebar: HeldSidebar }).heldSidebar.waiting);
  fake.threads.get(ids[6])!.status = { type: 'idle' };
  fake.readStates.set(ids[6], { revision: 'completed-6', firstUnread: { type: 'turn', turnId: 'turn-6' } });
  notify('thread/status/changed', ids[6]);
  notify('thread/readState/changed', ids[6]);
  await state(other, ids[6], 'unread');
  await state(page, ids[6], 'working');
  await page.evaluate(() => (window as unknown as { heldSidebar: HeldSidebar }).heldSidebar.waiting!());
  await state(page, ids[6], 'unread');
  assert.equal(await page.evaluate(() => (window as unknown as { heldSidebar: HeldSidebar }).heldSidebar.misses), 0);
  await page.evaluate(() => (window as unknown as { heldSidebar: HeldSidebar }).heldSidebar.observer.disconnect());
  checks.push('Delayed older lists cannot overwrite newer completion/read receipts; the completing row has no missing-state frame.');

  // A failed confirming read retains the last good row, then retries normally.
  fake.handlers.set('thread/read', params => {
    if (params.threadId === ids[7]) throw new Error('Synthetic temporary metadata failure');
    return fake.defaultResult('thread/read', params);
  });
  fake.threads.get(ids[7])!.status = { type: 'idle' };
  fake.readStates.set(ids[7], { revision: 'completed-7', firstUnread: { type: 'turn', turnId: 'turn-7' } });
  notify('turn/completed', ids[7]);
  await page.getByText('Some chat statuses could not be refreshed. Retrying…', { exact: true }).waitFor();
  await state(page, ids[7], 'working');
  fake.handlers.delete('thread/read');
  notify('thread/readState/changed', ids[7]);
  await Promise.all(pages.map(page => state(page, ids[7], 'unread')));
  await page.getByText('Some chat statuses could not be refreshed. Retrying…', { exact: true }).waitFor({ state: 'detached' });
  checks.push('A metadata failure preserves the row and reports pending sync; later confirmation updates both pages.');

  // Completion in the opposite notification order, with an older metadata read.
  let releaseMetadata: (() => void) | undefined;
  let metadataStarted!: () => void;
  const started = new Promise<void>(resolve => { metadataStarted = resolve; });
  fake.handlers.set('thread/read', async params => {
    const response = structuredClone(fake.defaultResult('thread/read', params));
    if (params.threadId === ids[8] && !releaseMetadata) await new Promise<void>(resolve => {
      releaseMetadata = resolve; metadataStarted();
    });
    return response;
  });
  fake.readStates.set(ids[8], { revision: 'completed-8', firstUnread: { type: 'turn', turnId: 'turn-8' } });
  notify('thread/readState/changed', ids[8]);
  await started;
  fake.threads.get(ids[8])!.status = { type: 'idle' };
  notify('thread/status/changed', ids[8]);
  releaseMetadata!();
  await Promise.all(pages.map(page => state(page, ids[8], 'unread')));
  fake.handlers.delete('thread/read');
  checks.push('Receipt-first completion and delayed metadata converge to the latest backend state.');

  await page.evaluate(id => window.postMessage({ type: 'mcp-notification', hostId: 'remote-unloaded',
    method: 'thread/archived', params: { threadId: id } }, location.origin), ids[6]);
  await state(page, ids[6], 'unread');
  fake.defaultResult('thread/archive', { threadId: ids[25] });
  await state(page, ids[25], 'absent');
  await other.reload({ waitUntil: 'commit' });
  await state(other, ids[6], 'unread');
  assert.equal(await other.locator(`[data-app-action-sidebar-thread-id="local:${ids[25]}"]`).count(), 0);
  checks.push('Host-scoped notifications leave local rows alone; archiving the open chat and reloading cannot restore it.');

  // Existing expansion and backend cursor paging still reveal older important rows.
  for (let i = 0; i < 5 && !await page.locator(selector(ids[60])).count(); i++) {
    const before = await page.locator('[data-app-action-sidebar-thread-row]').count();
    await page.locator('[data-source-recent-more]').evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForFunction(before => document.querySelectorAll('[data-app-action-sidebar-thread-row]').length > before, before);
  }
  await state(page, ids[60], 'working');
  await other.evaluate(() => {
    const target = window as unknown as { visibilityReconnects: number };
    target.visibilityReconnects = 0;
    window.addEventListener('message', event => {
      if (event.data?.type === 'codex-app-server-connection-changed' && event.data.hostId === 'local' && event.data.state === 'connected') {
        target.visibilityReconnects++;
      }
    });
  });
  fake.disconnect();
  // The last fixture socket belongs to the second page, which was reloaded.
  // Opening a chat reattaches that page's ordinary app-server connection.
  await other.getByRole('button', { name: 'Visibility chat 9', exact: true }).first().click();
  await other.waitForFunction(() => (window as unknown as { visibilityReconnects: number }).visibilityReconnects > 0);
  await state(page, ids[60], 'working');
  await state(page, ids[6], 'unread');
  checks.push('Opening a chat reconnects its backend and preserves loaded active and unread rows.');
  const expanded = page.getByRole('button', { name: /^Show more/ });
  await expanded.click();
  assert.equal(await page.locator(selector(ids[5])).count(), 1);
  await page.setViewportSize({ width: 402, height: 850 });
  await page.locator('[data-app-shell-sidebar-trigger]').first().click();
  await page.locator('[data-app-shell-sidebar-trigger]').first().click();
  await page.screenshot({ path: join(output, 'narrow.png') });
  assert.equal(await page.locator(selector(ids[60])).count(), 1);
  checks.push('Backend cursor paging, history expansion and narrow sidebar toggles keep loaded active rows available.');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.bringToFront();
  await page.locator(selector(ids[16])).click();
  await page.getByText('Paginated answer 5', { exact: true }).waitFor();
  await page.waitForFunction(id => {
    const rows = [...document.querySelectorAll(`[data-app-action-sidebar-thread-id="local:${id}"]`)];
    return rows.length > 0 && rows.every(row => !row.querySelector('[aria-label="Unread"]'));
  }, ids[16], { timeout: 4000 });
  assert.equal(fake.readStates.get(ids[16])!.firstUnread, null);
  await other.waitForFunction(id => [...document.querySelectorAll(`[data-app-action-sidebar-thread-id="local:${id}"]`)]
    .every(row => !row.querySelector('[aria-label="Unread"]')), ids[16]);
  checks.push('Opening a completed conversation clears its blue unread badge even when the first unread turn precedes the latest history page.');

  await page.locator(selector(ids[0])).click();
  let rejectRead = true, readAttempts = 0;
  fake.handlers.set('thread/readState/update', params => {
    if (params.threadId === ids[16]) {
      readAttempts++;
      if (rejectRead) throw new Error('Temporary read receipt failure');
    }
    return fake.defaultResult('thread/readState/update', params);
  });
  fake.readStates.set(ids[16], { revision: 'retry-16', firstUnread: { type: 'turn', turnId: 'turn-16-0' } });
  notify('thread/readState/changed', ids[16]);
  await state(page, ids[16], 'unread');
  await page.locator(selector(ids[16])).click();
  await fake.waitFor(message => message.method === 'thread/readState/update' && message.params.expectedRevision === 'retry-16');
  await state(other, ids[16], 'unread');
  assert.ok(fake.readStates.get(ids[16])!.firstUnread);
  rejectRead = false;
  await other.bringToFront(); await page.bringToFront();
  await page.waitForFunction(id => [...document.querySelectorAll(`[data-app-action-sidebar-thread-id="local:${id}"]`)]
    .every(row => !row.querySelector('[aria-label="Unread"]')), ids[16]);
  assert.equal(fake.readStates.get(ids[16])!.firstUnread, null);
  assert.ok(readAttempts >= 2);
  checks.push('A failed read confirmation retains the blue badge and retries the same revision on returning to the page.');

  await page.keyboard.press('Control+,');
  await page.getByRole('article', { name: 'Settings', exact: true }).waitFor();
  fake.readStates.set(ids[16], { revision: 'hidden-16', firstUnread: { type: 'turn', turnId: 'hidden-turn' } });
  fake.threads.get(ids[16])!.turns.push(fixtureTurn('hidden-turn', [agentItem('hidden-answer', 'Answer arriving behind settings')]));
  notify('thread/readState/changed', ids[16]);
  notify('turn/completed', ids[16]);
  await page.getByText('Answer arriving behind settings', { exact: true }).waitFor({ state: 'attached' });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.ok(fake.readStates.get(ids[16])!.firstUnread);
  await state(page, ids[16], 'unread');
  await page.locator(selector(ids[16])).click();
  await page.getByText('Answer arriving behind settings', { exact: true }).waitFor();
  await page.waitForFunction(id => [...document.querySelectorAll(`[data-app-action-sidebar-thread-id="local:${id}"]`)]
    .every(row => !row.querySelector('[aria-label="Unread"]')), ids[16]);
  assert.equal(fake.readStates.get(ids[16])!.firstUnread, null);
  checks.push('A conversation retained behind Settings stays unread until its latest content is visible again.');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ renderer: 'react-ts', peer: 'disposable protocol fixture', checks, errors }, null, 2));
} catch (error) {
  for (const [i, page] of pages.entries()) {
    await page.screenshot({ path: join(output, `failure-${i}.png`) }).catch(() => {});
    await writeFile(join(output, `failure-${i}.txt`), await page.locator('body').ariaSnapshot()).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
