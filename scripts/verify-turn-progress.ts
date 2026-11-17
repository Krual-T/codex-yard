// Run under /tmp/agents-workbench-heavy.lock. No personal sessions or accounts.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-turn-progress-');
const output = resolve('.local/turn-progress');
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
  setImmediate(() => fake.broadcast({ method: 'turn/completed', params: { threadId: ids[0], turn: fake.threads.get(ids[0])!.turns[1] } }));
  return result;
});
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', backend: 'synthetic 0.164.0', errors, checks };
page.on('pageerror', error => errors.push(error.message));
try {
  await page.clock.install();
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + ids[0]), { waitUntil: 'commit' });
  await page.getByText(request, { exact: true }).waitFor({ timeout: 30000 });
  await fake.waitForCall('thread/resume');
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

  await page.setViewportSize({ width: 390, height: 844 });
  await notice.scrollIntoViewIfNeeded();
  const box = await notice.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 391, 'notice must fit the phone viewport');
  await page.screenshot({ path: join(output, 'phone.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText('Progress switch fixture', { exact: true }).first().click();
  await page.getByText('Switch fixture question', { exact: true }).waitFor();
  await page.clock.fastForward(135_000);
  assert.equal(await notice.count(), 0, 'old turn timers must not appear in a different thread');
  await page.getByText('Progress waiting fixture', { exact: true }).first().click();
  await page.getByText(request, { exact: true }).waitFor();
  await page.clock.fastForward(135_000);
  await notice.getByRole('button', { name: '停止等待' }).click();
  await fake.waitForCall('turn/interrupt');
  await notice.waitFor({ state: 'hidden' });
  assert.equal(fake.calls('turn/interrupt').length, 1);
  assert.equal(fake.calls('turn/start').length, 0);
  checks.push('Phone layout, same-page switching and the native interrupt action work without duplicate execution');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await page.screenshot({ path: join(output, 'failure.png') });
  await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
