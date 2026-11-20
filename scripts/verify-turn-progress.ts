// Run under /tmp/agents-workbench-heavy.lock. No personal sessions or accounts.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-turn-progress-');
const source = process.argv.includes('--source');
const states = process.argv.includes('--states');
const narrow = process.argv.includes('--narrow-dark');
const preview = process.argv.includes('--preview');
assert.ok(!preview || source && states, 'Use --preview with --source --states.');
const output = resolve(process.env.AGENTS_TURN_PROGRESS_EVIDENCE ?? '.local/turn-progress');
await mkdir(output, { recursive: true });
await mkdir(join(root, 'data'));
await writeFile(join(root, 'data/projects.json'), JSON.stringify([{ name: 'Progress fixture', path: root }]));
const fake = await createFakeCodex(root);
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const request = 'Convert /tmp/review.md to Word, retaining its source image paths.';
for (const [index, id] of ids.entries()) {
  fake.threads.set(id, fixtureThread(id, root, { name: index ? 'Progress switch fixture' : 'Progress waiting fixture',
    status: index ? { type: 'idle' } : { type: 'active', activeFlags: [] }, path: join(root, id + '.jsonl'),
    updatedAt: 1_700_000_002 - index,
    turns: [fixtureTurn('completed', [agentItem('answer', 'Saved /tmp/review.md and /tmp/source.png.')]),
      fixtureTurn('waiting', [{ id: 'user', type: 'userMessage', content: [{ type: 'text', text: index ? 'Switch fixture question' : request, text_elements: [] }] }], index ? 'completed' : 'inProgress')],
  }));
}
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params) as object,
  turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('thread/turns/list', params => {
  const turns = [...fake.threads.get(String(params.threadId))!.turns];
  if (params.sortDirection !== 'asc') turns.reverse();
  const offset = Number(params.cursor ?? 0), limit = Number(params.limit ?? 5);
  return { data: turns.slice(offset, offset + limit).map(turn => ({ ...turn, itemsView: params.itemsView ?? 'full',
    items: params.itemsView === 'notLoaded' ? [] : params.itemsView === 'summary'
      ? turn.items.filter(item => item.type === 'userMessage' || item.type === 'agentMessage' && item.phase !== 'commentary') : turn.items,
  })), nextCursor: offset + limit < turns.length ? String(offset + limit) : null, backwardsCursor: null };
});
fake.handlers.set('turn/interrupt', params => {
  const result = fake.defaultResult('turn/interrupt', params);
  const thread = fake.threads.get(String(params.threadId))!;
  const turn = thread.turns.find(turn => turn.id === params.turnId)!;
  setImmediate(() => {
    fake.broadcast({ method: 'turn/completed', params: { threadId: thread.id, turn } });
    fake.broadcast({ method: 'thread/status/changed', params: { threadId: thread.id, status: thread.status } });
  });
  return result;
});
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  sourceWorkspace: source,
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(narrow ? { viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true } :
  { viewport: { width: 1440, height: 900 } });
const errors: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { renderer: source ? 'React/TypeScript' : '26.1013.40934', backend: 'synthetic 0.164.0', errors, checks };
page.on('pageerror', error => errors.push(error.message));

async function snapshot(page: Page, name: string) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
  await writeFile(join(output, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
}

async function verifyStates() {
  const thread = fake.threads.get(ids[0])!;
  const selected = thread.turns.at(-1)!;
  const terminalText = 'Fixture provider could not complete the request';
  const error = { message: terminalText, codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } }, additionalDetails: null };
  const notify = (method: string, params: object, turnId = selected.id) =>
    fake.broadcast({ method, params: { threadId: thread.id, turnId, ...params } });
  const notice = page.getByRole('region', { name: '任务等待状态' });
  const editor = page.locator('[data-codex-composer="true"][contenteditable="true"]:visible').first();
  const unsent = 'Keep this draft while the current response fails.';
  notify('error', { willRetry: true, error: { ...error, message: 'Reconnecting... 1/5' } });
  try { await notice.getByRole('status').filter({ hasText: '正在重试' }).waitFor({ timeout: 5_000 }); }
  finally { await snapshot(page, 'retried-by-backend'); }
  await page.getByText(/Reconnecting.*\/5/).last().waitFor({ timeout: 6_000 });
  assert.equal(fake.calls('turn/start').length, 0, 'The backend owns retry while the turn is active.');
  const recovery = { ...agentItem('recovering', ''), text: 'Fixture progress after upstream retry', phase: 'commentary' };
  selected.items.push(recovery);
  notify('item/started', { item: { ...recovery, text: '' } });
  notify('item/agentMessage/delta', { itemId: recovery.id, delta: recovery.text });
  notify('item/completed', { item: recovery });
  await notice.waitFor({ state: 'hidden', timeout: 5_000 });
  await page.getByText(recovery.text, { exact: true }).last().waitFor({ timeout: 5_000 });
  checks.push('Backend retry clears when same-turn progress arrives; no task replay');

  await editor.fill(unsent);
  selected.status = 'failed';
  selected.error = error;
  selected.durationMs = 42_000;
  thread.status = { type: 'idle' };
  notify('error', { willRetry: false, error });
  notify('turn/completed', { turn: selected });
  notify('thread/status/changed', { status: thread.status });
  try {
    await page.getByText(terminalText, { exact: true }).last().waitFor({ timeout: 6_000 });
    await page.getByText(recovery.text, { exact: true }).last().waitFor({ timeout: 6_000 });
    if (source) await page.getByRole('alert').filter({ hasText: terminalText }).waitFor();
    await notice.waitFor({ state: 'hidden', timeout: 6_000 });
    assert.equal(await editor.textContent(), unsent);
    assert.equal(fake.calls('turn/start').length, 0);
  }
  finally { await snapshot(page, 'failed'); }
  checks.push('Final failure displays the daemon error and preceding progress without losing an unsent draft');

  const request = 'Stop the fixture after some visible output.';
  await editor.fill(request);
  await page.getByRole('button', { name: /^Send(?: message)?$/, exact: true }).click();
  const start = await fake.waitForCall('turn/start');
  assert.equal(start?.params.threadId, thread.id);
  await page.getByText(request, { exact: true }).first().waitFor({ timeout: 6_000 });
  const current = thread.turns.at(-1)!;
  assert.notEqual(current.id, selected.id);
  current.durationMs = 12_000;
  const partial = { ...agentItem('partial-before-stop', ''), text: 'Visible partial response before stop.', phase: 'final_answer' };
  current.items.push(partial);
  notify('item/started', { item: { ...partial, text: '' } }, current.id);
  notify('item/agentMessage/delta', { itemId: partial.id, delta: partial.text }, current.id);
  await page.getByText(partial.text, { exact: true }).waitFor();
  const stop = page.getByRole('button', { name: /^Stop(?: generating)?$/, exact: true }).last();
  await stop.click();
  const interrupted = await fake.waitForCall('turn/interrupt');
  assert.equal(interrupted?.params.turnId, current.id);
  await stop.waitFor({ state: 'hidden', timeout: 6_000 });
  await page.getByText(/^You stopped after /).last().waitFor({ timeout: 6_000 });
  await page.getByText(partial.text, { exact: true }).waitFor({ timeout: 6_000 });
  await page.getByRole('button', { name: 'Copy', exact: true }).last().waitFor();
  await page.getByRole('button', { name: 'More actions', exact: true }).last().waitFor();
  assert.ok(await editor.isEditable());
  await snapshot(page, 'interrupted');
  assert.equal(fake.calls('turn/interrupt').length, 1);
  assert.equal(fake.calls('turn/start').length, 1);
  checks.push('Explicit stop keeps the interrupted reply, elapsed time, message actions, and editor');
  await page.reload({ waitUntil: 'commit' });
  await page.getByText(partial.text, { exact: true }).last().waitFor({ timeout: 25_000 });
  if (source) {
    await page.getByText(terminalText, { exact: true }).last().waitFor({ timeout: 6_000 });
    await page.getByText(recovery.text, { exact: true }).last().waitFor({ timeout: 6_000 });
    checks.push('Final failure and tool progress remain readable after reload');
  }
  assert.equal(fake.calls('turn/start').length, 1);
  await snapshot(page, 'terminal-history');
  checks.push('The interrupted reply remains readable after reload');
  if (narrow) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

try {
  await page.clock.install();
  await page.goto(app.url + (source ? '/local/' + ids[0] : '/?initialRoute=' + encodeURIComponent('/local/' + ids[0])), { waitUntil: 'commit' });
  await page.getByText(request, { exact: true }).waitFor({ timeout: 30000 });
  if (!source) await fake.waitForCall('thread/resume');
  if (states) {
    await verifyStates();
    assert.deepEqual(errors, []);
    report.ok = true;
  } else {
  await verifyWaiting();
  assert.deepEqual(errors, []);
  report.ok = true;
  }
  if (preview) {
    await browser.close();
    console.log('PREVIEW_URL=' + app.url + '/local/' + ids[0]);
    const lifetime = new AbortController();
    const stop = () => lifetime.abort();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    await delay(45 * 60_000, undefined, { signal: lifetime.signal }).catch(() => {});
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (!page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}

async function verifyWaiting() {
  await page.waitForTimeout(500);
  const notice = page.getByRole('region', { name: '任务等待状态' });
  assert.equal(await notice.count(), 0);
  const initialReads = fake.calls('thread/turns/list').length;
  report.initialReads = fake.calls('thread/turns/list').map(call => call.params);
  await page.clock.fastForward(135_000);
  await notice.getByRole('status').filter({ hasText: '未收到新进展' }).waitFor();
  assert.equal(fake.calls('thread/turns/list').length, initialReads, 'silent timer must not poll turn history');
  checks.push('Two minutes without progress show a notice, without polling history or restarting a turn');
  await page.screenshot({ path: join(output, 'waiting.png') });

  fake.broadcast({ method: 'error', params: { threadId: ids[0], turnId: 'waiting', willRetry: true,
    error: { message: 'Synthetic upstream timeout', additionalDetails: null, codexErrorInfo: 'httpConnectionFailed' } } });
  await notice.getByRole('status').filter({ hasText: '正在重试' }).waitFor();
  const item = { ...agentItem('live', 'Resumed fixture output'), phase: 'commentary' };
  fake.threads.get(ids[0])!.turns[1].items.push(item);
  fake.broadcast({ method: 'item/started', params: { threadId: ids[0], turnId: 'waiting', item: { ...item, text: '' } } });
  fake.broadcast({ method: 'item/agentMessage/delta', params: { threadId: ids[0], turnId: 'waiting', itemId: 'live', delta: 'Resumed fixture output' } });
  await notice.waitFor({ state: 'hidden' });
  checks.push('Native retry errors display immediately; actual output clears the notice');
  await page.clock.fastForward(135_000);
  await notice.waitFor();
  await notice.getByRole('button', { name: '复制续接提示' }).click();
  const draft = notice.getByRole('textbox', { name: '续接提示', exact: true });
  await draft.waitFor();
  assert.match(await draft.inputValue(), /Saved \/tmp\/review.md and \/tmp\/source.png/);
  assert.match(await draft.inputValue(), /Convert \/tmp\/review.md to Word/);
  assert.doesNotMatch(await draft.inputValue(), /base64|Resumed fixture output/);
  assert.ok(fake.calls('thread/turns/list').some(call => call.params.limit === 5 && call.params.itemsView === 'summary'));
  assert.equal(fake.calls('turn/start').length, 0);
  checks.push('Continuation is an editable-by-copy draft of recent results and the request; recovery never resubmits a task');

  // A separate phone context tests the initial responsive layout without
  // the desktop renderer's sidebar resize transition.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await phone.clock.install();
    await phone.goto(page.url(), { waitUntil: 'commit' });
    await phone.getByText(request, { exact: true }).waitFor({ timeout: 30_000 });
    await phone.clock.fastForward(135_000);
    const phoneNotice = phone.getByRole('region', { name: '任务等待状态' });
    await phoneNotice.scrollIntoViewIfNeeded({ timeout: 6_000 });
    const box = await phoneNotice.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 391, 'notice must fit the phone viewport');
    await phone.screenshot({ path: join(output, 'phone.png') });
  } finally { await phone.close(); }
  await page.getByText('Progress switch fixture', { exact: true }).first().click();
  await page.getByText('Switch fixture question', { exact: true }).waitFor();
  await page.clock.fastForward(135_000);
  assert.equal(await notice.count(), 0, 'old turn timers must not appear in a different thread');
  await page.getByText('Progress waiting fixture', { exact: true }).first().click();
  await page.getByText(request, { exact: true }).waitFor();
  await page.clock.fastForward(135_000);
  const stop = notice.getByRole('button', { name: '停止等待' });
  await stop.click();
  const interrupted = await fake.waitForCall('turn/interrupt');
  assert.equal(interrupted?.params.threadId, ids[0]);
  assert.equal(interrupted?.params.turnId, 'waiting');
  await notice.waitFor({ state: 'hidden' });
  assert.equal(fake.calls('turn/interrupt').length, 1);
  assert.equal(fake.calls('turn/start').length, 0);
  checks.push('Phone layout, same-page switching and the native interrupt action work without duplicate execution');
}
