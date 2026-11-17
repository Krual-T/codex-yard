// Use the shared heavy-browser lock; all conversation and account data is synthetic.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, commandItem, createFakeCodex, fixtureThread, fixtureTurn, itemEntry } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-history-');
const baseline = process.argv.includes('--baseline');
const output = resolve(process.env.AGENTS_HISTORY_EVIDENCE ?? '.local/conversation-history', baseline ? 'before' : 'after');
await mkdir(output, { recursive: true });
await mkdir(join(root, 'data'));
await writeFile(join(root, 'data/projects.json'), JSON.stringify([{ name: 'History fixture', path: root }]));
const fake = await createFakeCodex(root);
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
for (const [index, id] of ids.entries()) {
  fake.threads.set(id, fixtureThread(id, root, { name: index ? 'Switch history fixture' : 'Large history fixture',
    preview: 'History fixture question', updatedAt: 1_700_000_001 - index,
    path: join(root, id + '.jsonl'), turns: Array.from({ length: 12 }, (_, i) => fixtureTurn(`${index}-turn-${i}`, [
      { id: `${index}-user-${i}`, type: 'userMessage', content: [{ type: 'text', text: `Question ${index}/${i}`, text_elements: [] }] },
      { ...agentItem(`${index}-commentary-${i}`, `Investigating fixture ${index}/${i}`), phase: 'commentary' },
      ...Array.from({ length: index === 1 && i === 11 ? 105 : 12 }, (_, j) => commandItem(`${index}-command-${i}-${j}`,
        'Synthetic activity output\n'.repeat(index === 1 && i === 11 ? 1 : 4096), root)),
      { ...agentItem(`${index}-answer-${i}`, `History response ${index}/${i}` + (i === 11
        ? '\n\n' + Array.from({ length: 40 }, (_, line) => `History paragraph ${index}/${line}.`).join('\n\n') + `\n\nLatest content ${index}` : '')), phase: 'final_answer' },
    ])).map(turn => ({ ...turn, startedAt: 1_700_000_000, completedAt: 1_700_000_060, durationMs: 60000 })) }));
}
const activeId = '00000000-0000-4000-8000-000000000003';
const activeTurn = fixtureTurn('active-turn', [
  { id: 'active-user', type: 'userMessage', content: [{ type: 'text', text: 'Continue the active task', text_elements: [] }] },
  { ...agentItem('active-first-update', 'Earlier update before reentry'), phase: 'commentary' },
  ...Array.from({ length: 105 }, (_, i) => commandItem('active-command-' + i, 'Active tool output ' + i, root)),
  { ...agentItem('active-latest-update', 'Completed update before reentry\n\n'
    + Array.from({ length: 35 }, (_, line) => 'Active progress paragraph ' + line).join('\n\n')), phase: 'commentary' },
  { ...commandItem('active-running-command', '', root), status: 'inProgress', exitCode: null },
], 'inProgress');
fake.threads.set(activeId, fixtureThread(activeId, root, { name: 'Active history fixture', status: { type: 'active', activeFlags: [] },
  turns: [fixtureTurn('active-previous', [{ ...agentItem('previous-answer', 'Previous completed answer'), phase: 'final_answer' }]), activeTurn] }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
const gates = new Map<string, () => void>();
const released = new Set<string>();
for (const method of ['model/list', 'mcpServerStatus/list', 'thread/resume']) {
  const gate = new Promise<void>(resolve => gates.set(method, () => { released.add(method); resolve(); }));
  fake.handlers.set(method, async params => {
    await gate;
    const result = fake.defaultResult(method, params);
    return method === 'thread/resume' ? { ...result as object, turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' } : result;
  });
}
fake.handlers.set('thread/turns/list', params => {
  const turns = [...fake.threads.get(String(params.threadId))!.turns];
  if (params.sortDirection !== 'asc') turns.reverse();
  const offset = Number(params.cursor ?? 0), limit = Number(params.limit ?? 5);
  return { data: turns.slice(offset, offset + limit).map(turn => ({ ...turn,
    items: params.itemsView === 'notLoaded' ? [] : params.itemsView === 'summary'
      ? turn.items.filter(item => item.type === 'userMessage' || item.type === 'agentMessage' && item.phase !== 'commentary') : turn.items,
    itemsView: params.itemsView ?? 'full',
  })), nextCursor: offset + limit < turns.length ? String(offset + limit) : null, backwardsCursor: null };
});
let failNextActivityRead = false;
let holdActiveRead = false;
let releaseActiveRead: (() => void) | undefined;
fake.handlers.set('thread/items/list', async params => {
  if (failNextActivityRead) { failNextActivityRead = false; throw new Error('Synthetic activity read failure'); }
  const turns = fake.threads.get(String(params.threadId))!.turns;
  const turn = turns.find(turn => turn.id === params.turnId)!;
  const items = [...turn.items];
  if (params.sortDirection !== 'asc') items.reverse();
  const offset = Number(params.cursor ?? 0), limit = Number(params.limit ?? 100);
  const response = { data: items.slice(offset, offset + limit).map(item => itemEntry(turn.id, item)),
    nextCursor: offset + limit < items.length ? String(offset + limit) : null };
  if (holdActiveRead && params.threadId === activeId && params.sortDirection === 'desc') {
    holdActiveRead = false;
    await new Promise<void>(resolve => { releaseActiveRead = resolve; });
  }
  return response;
});
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [], checks: string[] = [], wire: Record<string, unknown>[] = [];
const pending = new Map<string, { at: number; method: string }>();
const start = performance.now();
const report: Record<string, unknown> = { baseline, renderer: '26.1013.40934', backend: 'synthetic 0.164.0', checks, errors, wire };
page.on('pageerror', error => errors.push(error.message));
page.on('websocket', socket => {
  socket.on('framesent', frame => {
    const value = JSON.parse(String(frame.payload));
    if (value.request) {
      pending.set(String(value.request.id), { at: performance.now(), method: value.request.method });
      wire.push({ at: Math.round(performance.now() - start), method: value.request.method, params: value.request.params });
    }
  });
  socket.on('framereceived', frame => {
    const value = JSON.parse(String(frame.payload));
    if (value.type !== 'mcp-response') return;
    const request = pending.get(String(value.message.id));
    if (request) wire.push({ method: request.method, responseAt: Math.round(performance.now() - start),
      ms: Math.round(performance.now() - request.at), bytes: Buffer.byteLength(String(frame.payload)), error: value.message.error });
  });
});
try {
  if (baseline) await page.route('**/assets/app-initial-a68277f60b93.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const bridge = 'return window.workbenchReadConversationPage(this.client.sendRequest.bind(this.client),e,t)';
    assert.equal(source.split(bridge).length, 2, 'baseline must replace exactly one history reader');
    const body = source.replace(bridge,
      'return {response:await this.client.sendRequest(`thread/turns/list`,{threadId:e,cursor:t.cursor??null,sortDirection:t.sortDirection??`desc`,limit:3,itemsView:`full`},t.requestOptions)}');
    await route.fulfill({ response, body });
  });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + ids[0]), { waitUntil: 'commit' });
  // Model catalog, MCP status and runtime restore remain deliberately pending.
  // First persisted messages must be readable before those services return.
  await fake.waitFor(message => message.method === 'thread/read', 30000);
  const first = page.getByText('History response 0/11', { exact: true });
  let visibleWhileBlocked = false;
  try { await first.waitFor({ timeout: baseline ? 4000 : 12000 }); visibleWhileBlocked = true; } catch { /* reported below */ }
  report.visibleWhileBlocked = visibleWhileBlocked;
  report.beforeReleaseMs = Math.round(performance.now() - start);
  report.blockedHistoryCalls = fake.calls('thread/items/list').length;
  if (!baseline) {
    assert.equal(visibleWhileBlocked, true, 'messages must display before model/MCP/resume finish');
    assert.equal(released.size, 0);
    assert.equal(fake.calls('thread/items/list').length, 0, 'collapsed summaries must not read tool details');
    checks.push('Latest messages display while model, MCP and runtime resume requests remain pending');
  }
  for (const release of gates.values()) release();
  await first.waitFor({ timeout: 30000 });
  report.firstHistoryMs = Math.round(performance.now() - start);
  await page.waitForTimeout(1500);
  report.initialHistoryCalls = fake.messages.filter(message => message.method?.startsWith('thread/') && /\/(turns|items)\/list$/.test(message.method)).length;
  report.initialToolReads = fake.calls('thread/items/list').length;
  report.initialHistoryBytes = wire.filter(message => /thread\/(turns|items)\/list/.test(String(message.method)))
    .reduce((bytes, message) => bytes + Number(message.bytes ?? 0), 0);
  report.initialTurnPages = fake.calls('thread/turns/list').map(message => message.params);
  const firstWorked = page.getByRole('button', { name: /Worked for/ }).last();
  await firstWorked.waitFor();
  await writeFile(join(output, 'worked-control.html'), await firstWorked.evaluate(element => element.outerHTML));
  await page.screenshot({ path: join(output, 'initial.png') });
  if (!baseline) {
    const scrollDistance = () => page.locator('[data-thread-find-target="conversation"]').evaluate(element => {
      for (let node: HTMLElement | null = element as HTMLElement; node; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 24)
          return node.scrollHeight - node.clientHeight - node.scrollTop;
      }
      return 0;
    });
    await page.waitForFunction(() => document.body.innerText.includes('Latest content 0'));
    assert.ok(await scrollDistance() <= 24, 'cold entry must show the bottom of a long latest answer');
    assert.equal(fake.calls('thread/items/list').length, 0, 'resuming must not drain older tool output');
    assert.ok(fake.calls('thread/turns/list').length <= 2, 'first page should be reused across resume');
    assert.equal(fake.calls('thread/turns/list').find(message => message.params.itemsView !== 'notLoaded')?.params.limit, 2);
    checks.push('Resume reuses the initial bounded page without draining older turns or activity');
    await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Switch history fixture' }).first().click();
    const switched = performance.now();
    await page.getByText('History response 1/11', { exact: true }).waitFor({ timeout: 10000 });
    report.switchMs = Math.round(performance.now() - switched);
    checks.push('Same-page sidebar switching renders the selected conversation');
    await page.screenshot({ path: join(output, 'switched.png') });
    const worked = page.getByRole('button', { name: /Worked for/ }).last();
    await worked.waitFor({ timeout: 10000 });
    const beforeExpansion = fake.calls('thread/items/list').length;
    await worked.hover(); await page.waitForTimeout(250);
    assert.equal(fake.calls('thread/items/list').length, beforeExpansion, 'hovering a collapsed Work control must not read activity');
    assert.equal(await page.getByRole('button', { name: '查看完整过程', exact: true }).count(), 0);
    failNextActivityRead = true;
    const collapsedControl = await worked.evaluate(element => element.outerHTML);
    await worked.click();
    await page.waitForFunction(() => document.body.innerText.includes('History response 1/11'));
    // Wait for the native error path to restore the same disclosure, then retry.
    await page.waitForTimeout(200);
    await page.waitForFunction(html => [...document.querySelectorAll('button')]
      .filter(button => button.textContent?.includes('Worked for')).at(-1)?.outerHTML === html, collapsedControl);
    assert.equal(fake.calls('thread/items/list').length, beforeExpansion + 1);
    assert.ok(await page.getByText('History response 1/11', { exact: true }).isVisible());
    await worked.click();
    await page.getByText('Investigating fixture 1/11', { exact: true }).waitFor({ timeout: 10000 });
    assert.ok(fake.calls('thread/items/list').length > 0);
    assert.ok(fake.calls('thread/items/list').every(message => message.params.threadId === ids[1] && message.params.turnId === '1-turn-11'));
    checks.push('Original Worked disclosure loads only the expanded turn; final answer stays visible');
    checks.push('A failed activity read keeps the answer visible and retries through the same control');
    await page.screenshot({ path: join(output, 'expanded.png') });
    await page.getByRole('button', { name: 'Ran commands', exact: true }).last().click();
    await page.getByText('fixture-command', { exact: false }).first().waitFor({ timeout: 10000 });
    assert.ok(await page.getByText('History response 1/11', { exact: true }).isVisible());
    assert.ok(fake.calls('thread/items/list').some(message => message.params.cursor != null), 'activity over 100 items must finish paging');
    const detailReads = fake.calls('thread/items/list').length;
    await page.getByRole('button', { name: /Worked for/ }).last().click();
    await page.getByRole('button', { name: /Worked for/ }).last().click();
    await page.getByText('Investigating fixture 1/11', { exact: true }).waitFor();
    assert.equal(fake.calls('thread/items/list').length, detailReads, 'repeated expansion must reuse loaded activity');
    checks.push('Expansion pages a turn with over 100 items and reuses its cache on subsequent toggles');
    checks.push('The unchanged native activity control opens complete tool history without extra controls');
    await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Large history fixture' }).first().click();
    await page.getByText('History response 0/11', { exact: true }).waitFor();
    await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Switch history fixture' }).first().click();
    await page.getByText('History response 1/11', { exact: true }).waitFor();
    assert.equal(fake.calls('thread/items/list').length, detailReads, 'same-page switching must retain hydrated activity');
    checks.push('Switching away and back retains the activity cache');
    await page.mouse.move(800, 300);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -20000);
      await page.waitForTimeout(400);
    }
    await page.getByText('History response 1/0', { exact: true }).waitFor({ timeout: 10000 });
    assert.ok(fake.calls('thread/turns/list').some(message => message.params.cursor != null));
    checks.push('Scrolling upward retrieves older messages through their original cursors');
    await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Large history fixture' }).first().click();
    await page.getByText('Latest content 0', { exact: true }).waitFor();
    await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Switch history fixture' }).first().click();
    await page.getByText('Latest content 1', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.ok(await scrollDistance() <= 24, 'reentering after reading old messages must show latest content');
    checks.push('Cold entry and same-page reentry show the latest content, including long answers');
    const beforeActive = fake.calls('thread/items/list').length;
    holdActiveRead = true;
    await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Active history fixture' }).first().click();
    await fake.waitFor(message => message.method === 'thread/items/list' && message.params.threadId === activeId, 10000);
    const liveText = 'Streamed update during history read';
    const liveItem = { ...agentItem('active-live', liveText), phase: 'commentary' as const };
    activeTurn.items.push(liveItem);
    fake.broadcast({ method: 'item/started', params: { threadId: activeId, turnId: activeTurn.id, item: { ...liveItem, text: '' } } });
    fake.broadcast({ method: 'item/agentMessage/delta', params: { threadId: activeId, turnId: activeTurn.id,
      itemId: liveItem.id, delta: liveText } });
    fake.broadcast({ method: 'item/completed', params: { threadId: activeId, turnId: activeTurn.id, item: liveItem } });
    await page.getByText(liveText, { exact: true }).waitFor({ timeout: 10000 });
    releaseActiveRead?.();
    await page.getByText('Completed update before reentry', { exact: true }).waitFor({ timeout: 10000 });
    const activeReads = fake.calls('thread/items/list').slice(beforeActive);
    assert.ok(activeReads.length > 0 && activeReads.length <= 2, 'active entry must read a bounded recent page');
    assert.ok(activeReads.every(call => call.params.threadId === activeId && call.params.turnId === activeTurn.id));
    assert.equal(await page.getByText(liveText, { exact: true }).count(), 1, 'history must preserve and deduplicate concurrent live output');
    checks.push('Entering an active turn recovers completed commentary omitted by the summary with a bounded recent read');
    checks.push('Live messages received during the history read survive its response without duplicates');
    const activeWork = page.getByRole('button', { name: /^Work/ }).last();
    await activeWork.click();
    const collapsedActiveControl = await activeWork.evaluate(element => element.outerHTML);
    const beforeFullActive = fake.calls('thread/items/list').length;
    failNextActivityRead = true;
    await activeWork.click();
    await page.waitForFunction(html => [...document.querySelectorAll('button')]
      .filter(button => button.textContent?.startsWith('Work')).at(-1)?.outerHTML === html, collapsedActiveControl);
    await activeWork.click();
    await page.getByText('Earlier update before reentry', { exact: true }).waitFor({ timeout: 10000 });
    assert.ok(fake.calls('thread/items/list').length > beforeFullActive + 1);
    checks.push('An active Work disclosure expands the remaining history and retries a failed read');
    const afterFullActive = fake.calls('thread/items/list').length;
    await activeWork.click(); await activeWork.click();
    await page.getByText('Earlier update before reentry', { exact: true }).waitFor();
    assert.equal(fake.calls('thread/items/list').length, afterFullActive, 'active Work toggles must reuse loaded items');
    await page.mouse.move(800, 300);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(200);
    const readingDistance = await scrollDistance();
    assert.ok(readingDistance > 200, 'the active fixture must allow reading above the bottom');
    const nextText = 'Next streamed progress update';
    const nextUpdate = { ...agentItem('active-next', nextText), phase: 'commentary' as const };
    activeTurn.items.push(nextUpdate);
    fake.broadcast({ method: 'item/started', params: { threadId: activeId, turnId: activeTurn.id, item: { ...nextUpdate, text: '' } } });
    fake.broadcast({ method: 'item/agentMessage/delta', params: { threadId: activeId, turnId: activeTurn.id, itemId: nextUpdate.id, delta: nextText } });
    fake.broadcast({ method: 'item/completed', params: { threadId: activeId, turnId: activeTurn.id, item: nextUpdate } });
    await page.waitForTimeout(300);
    assert.ok(await scrollDistance() > 200, 'streaming must not pull a reader back to the bottom');
    checks.push('New streamed progress preserves the viewport after the user scrolls up');
    activeTurn.status = 'completed';
    activeTurn.items = activeTurn.items.map(item => item.id === 'active-running-command'
      ? { ...item, status: 'completed', exitCode: 0 } : item);
    const finalText = 'Active task final answer';
    const final = { ...agentItem('active-final', finalText), phase: 'final_answer' as const };
    activeTurn.items.push(final);
    fake.broadcast({ method: 'item/started', params: { threadId: activeId, turnId: activeTurn.id, item: { ...final, text: '' } } });
    fake.broadcast({ method: 'item/agentMessage/delta', params: { threadId: activeId, turnId: activeTurn.id, itemId: final.id, delta: finalText } });
    fake.broadcast({ method: 'item/completed', params: { threadId: activeId, turnId: activeTurn.id, item: final } });
    fake.broadcast({ method: 'turn/completed', params: { threadId: activeId, turn: activeTurn } });
    await page.getByText(finalText, { exact: true }).waitFor();
    checks.push('The hydrated running turn continues to its final streamed reply');
    await writeFile(join(output, 'conversation.txt'), await page.locator('body').ariaSnapshot());
  }
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await page.screenshot({ path: join(output, 'failure.png') });
  await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  releaseActiveRead?.();
  for (const release of gates.values()) release();
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ ...report, wire: undefined }));
}
