// Run after build, under /tmp/agents-workbench-heavy.lock. Disposable backend only.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-message-submission-');
const output = resolve(process.env.AGENTS_SEND_EVIDENCE ?? '.local/message-submission');
const dataDir = join(root, 'data');
await Promise.all([mkdir(dataDir), mkdir(output, { recursive: true })]);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Message fixture', path: root }]));
const fake = await createFakeCodex(root);
const checks: string[] = [], timings: Record<string, number> = {}, errors: string[] = [];
const report: Record<string, unknown> = { checks, timings, errors, renderer: '26.1013.40934' };
const releases: (() => void)[] = [];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  return { promise, release };
}
const readyId = '00000000-0000-4000-8000-000000000001';
const resumeId = '00000000-0000-4000-8000-000000000002';
const cancelId = '00000000-0000-4000-8000-000000000003';
const failureId = '00000000-0000-4000-8000-000000000004';
const configId = '00000000-0000-4000-8000-000000000005';
const queueId = '00000000-0000-4000-8000-000000000006';
const orderId = '00000000-0000-4000-8000-000000000007';
const threadIds = [readyId, resumeId, cancelId, failureId, configId, queueId, orderId];
const configGate = gate();
let preparationGate = gate();
const queueGate = gate();
let holdPreparation = true;
let holdConfig = false;
const resumeGates = new Map([[resumeId, gate()], [cancelId, gate()]]);
const turnGates = new Map([[readyId, gate()], [resumeId, gate()], [failureId, gate()], [configId, gate()]]);
let rejectNextTurn = true;
for (const [index, id] of threadIds.entries()) {
  fake.threads.set(id, fixtureThread(id, root, { name: 'Message fixture ' + index, turns: [fixtureTurn('previous-' + index, [
    { id: 'previous-user-' + index, type: 'userMessage', content: [{ type: 'text', text: 'Previous question ' + index, text_elements: [] }] },
    { ...agentItem('previous-answer-' + index, 'Previous reply ' + index), phase: 'final_answer' },
  ])] }));
}
fake.threads.get(queueId)!.turns.push(fixtureTurn('active-queue-turn', [
  { id: 'active-queue-user', type: 'userMessage', content: [{ type: 'text', text: 'CURRENT_ACTIVE_PROMPT', text_elements: [] }] },
  { ...agentItem('active-queue-commentary', 'Working on current prompt'), phase: 'commentary' },
], 'inProgress'));
fake.threads.get(queueId)!.status = { type: 'active', activeFlags: [] };
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('config/read', async params => {
  if (holdConfig) await configGate.promise;
  return fake.defaultResult('config/read', params);
});
fake.handlers.set('thread/turns/list', params => ({
  data: [...fake.threads.get(String(params.threadId))!.turns].reverse().map(turn => ({ ...turn,
    items: params.itemsView === 'notLoaded' ? [] : params.itemsView === 'summary'
      ? turn.items.filter(item => item.type === 'userMessage' || item.type === 'agentMessage' && item.phase !== 'commentary') : turn.items,
    itemsView: params.itemsView ?? 'full',
  })), nextCursor: null, backwardsCursor: null,
}));
fake.handlers.set('thread/resume', async params => {
  await resumeGates.get(String(params.threadId))?.promise;
  return { ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' };
});
fake.handlers.set('turn/start', async params => {
  const id = String(params.threadId);
  await turnGates.get(id)?.promise;
  if (id === failureId && rejectNextTurn) {
    rejectNextTurn = false;
    throw Object.assign(new Error('Fixture rejected this message; retry is safe'), { code: -32600 });
  }
  return fake.defaultResult('turn/start', params);
});
fake.handlers.set('thread/queue/add', async params => {
  await queueGate.promise;
  return fake.defaultResult('thread/queue/add', params);
});

let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
const bubble = (text: string) => page!.getByRole('region', { name: /^(Conversation|对话)$/ }).locator('.bg-user-message').filter({ hasText: text });
async function open(id: string) {
  await page!.goto(app!.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
  await page!.getByText('Previous reply ' + threadIds.indexOf(id), { exact: true }).waitFor({ timeout: 30000 });
}
async function send(text: string, method: 'enter' | 'click' = 'enter') {
  const editor = page!.getByRole('textbox').last();
  await editor.fill(text);
  await page!.evaluate(({ text, method }) => {
    const target = window as unknown as { yardSendProbe: { pressed: number; appeared: number; maxCount: number; thinkingAt: number; orderFailures: string[] }; yardSendObserver?: MutationObserver };
    target.yardSendObserver?.disconnect();
    target.yardSendProbe = { pressed: 0, appeared: 0, maxCount: 0, thinkingAt: 0, orderFailures: [] };
    document.addEventListener(method === 'enter' ? 'keydown' : 'click', () => {
      target.yardSendProbe.pressed = Date.now();
    }, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      const messages = [...document.querySelectorAll('.bg-user-message')].filter(node => node.textContent?.trim() === text && node.getClientRects().length);
      const count = messages.length;
      target.yardSendProbe.maxCount = Math.max(target.yardSendProbe.maxCount, count);
      if (target.yardSendProbe.pressed && !target.yardSendProbe.appeared && count) {
        target.yardSendProbe.appeared = Date.now();
      }
      if (!target.yardSendProbe.pressed) return;
      const thinking = [...document.querySelectorAll('[data-thread-find-target="conversation"] *')].filter(node =>
        /^(Thinking|思考中|正在思考)(?:\.{3}|…)?$/.test(node.textContent?.trim() ?? '') && node.getClientRects().length && node.children.length === 0);
      if (thinking.length && !target.yardSendProbe.thinkingAt) target.yardSendProbe.thinkingAt = Date.now();
      for (const node of thinking) {
        if (!messages[0] || !(messages[0].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          target.yardSendProbe.orderFailures.push('Thinking appeared before the submitted user message');
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    target.yardSendObserver = observer;
  }, { text, method });
  if (method === 'click') await page!.getByRole('button', { name: /^(发送|Send)$/ }).click();
  else await editor.press('Enter');
  await bubble(text).waitFor({ timeout: 800 });
  const probe = await page!.evaluate(() => (window as unknown as { yardSendProbe: { pressed: number; appeared: number } }).yardSendProbe);
  timings[text] = probe.appeared - probe.pressed;
  assert.ok(timings[text] > 0 && timings[text] < 500, 'bubble must paint before backend preparation');
  assert.equal(await bubble(text).count(), 1);
  await page!.screenshot({ path: join(output, text + '-immediate.png') });
  assert.equal((await editor.innerText()).trim(), '', 'the submitted text must leave the composer when its bubble appears');
}
async function assertMessageOrder(text: string) {
  const probe = await page!.evaluate(() => (window as unknown as { yardSendProbe: { pressed: number; appeared: number; thinkingAt: number; orderFailures: string[] } }).yardSendProbe);
  report[text + '_order'] = probe;
  assert.deepEqual(probe.orderFailures, [], 'user text must precede Thinking throughout preparation and handoff');
}
async function waitTurn(id: string, text: string) {
  return fake.waitFor(message => message.method === 'turn/start' && message.params.threadId === id && JSON.stringify(message.params.input).includes(text), 15000);
}
async function finish(id: string, text: string) {
  const thread = fake.threads.get(id)!;
  // The response is processed before these authoritative streamed items.
  await page!.getByRole('textbox').last().filter({ hasText: text }).waitFor({ state: 'hidden', timeout: 10000 });
  await page!.waitForFunction(() => document.querySelector('[data-yard-preparing-message]') == null, undefined, { timeout: 10000 });
  const turn = thread.turns.at(-1)!;
  assert.equal(turn.status, 'inProgress');
  const answerText = 'Completed ' + text;
  const answer = { ...agentItem('answer-' + turn.id, answerText), phase: 'final_answer' as const };
  fake.broadcast({ method: 'turn/started', params: { threadId: id, turn } });
  for (const item of [...turn.items, answer]) {
    fake.broadcast({ method: 'item/started', params: { threadId: id, turnId: turn.id, item } });
    fake.broadcast({ method: 'item/completed', params: { threadId: id, turnId: turn.id, item } });
  }
  turn.items.push(answer); turn.status = 'completed'; thread.status = { type: 'idle' };
  fake.broadcast({ method: 'turn/completed', params: { threadId: id, turn } });
  await page!.getByText(answerText, { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await bubble(text).count(), 1, 'server confirmation must replace the preparation bubble');
  const maxCount = await page!.evaluate(() => (window as unknown as { yardSendProbe: { maxCount: number } }).yardSendProbe.maxCount);
  assert.equal(maxCount, 1, 'handoff must never render two copies of a message');
}
try {
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
    codexHome: join(root, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.exposeFunction('yardHoldPreparation', async () => { if (holdPreparation) await preparationGate.promise; });
  await page.route('**/app-primary-f5ea123a0407.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const marker = 'let Xe=fe.u({[Symbol.dispose]()';
    assert.equal(body.split(marker).length, 2, 'the preparation gate must match the pinned UI');
    await route.fulfill({ response, body: body.replace(marker, 'await window.yardHoldPreparation();' + marker)
      .replace('defaultFollowUpSubmitAction:e.getDefaultFollowUpSubmitAction()',
        'defaultFollowUpSubmitAction:window.yardQueueFixture?"queue":e.getDefaultFollowUpSubmitAction()') });
  });
  page.on('pageerror', error => errors.push(error.message));
  const consoleErrors: string[] = [];
  report.consoleErrors = consoleErrors;
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });

  await open(readyId);
  await send('IMMEDIATE_READY', 'click');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(output, 'preparation-held.png') });
  await assertMessageOrder('IMMEDIATE_READY');
  holdPreparation = false; preparationGate.release();
  await waitTurn(readyId, 'IMMEDIATE_READY');
  const nextDraft = '下一条草稿 **保留格式**';
  await page.getByRole('textbox').last().fill(nextDraft);
  await page.screenshot({ path: join(output, 'ready-admission-held.png') });
  await assertMessageOrder('IMMEDIATE_READY');
  assert.equal(await bubble('IMMEDIATE_READY').count(), 1);
  turnGates.get(readyId)!.release();
  await finish(readyId, 'IMMEDIATE_READY');
  assert.equal((await page.getByRole('textbox').last().innerText()).trim(), nextDraft,
    'admission and confirmation must preserve the next draft');
  await page.getByRole('textbox').last().fill('');
  await page.reload({ waitUntil: 'commit' });
  await bubble('IMMEDIATE_READY').waitFor({ timeout: 30000 });
  assert.equal(await bubble('IMMEDIATE_READY').count(), 1);
  checks.push('Ready thread clears the composer with the immediate bubble; admission and streaming preserve the next draft and one user bubble');

  await open(resumeId);
  await fake.waitFor(message => message.method === 'thread/resume' && message.params.threadId === resumeId, 10000);
  await send('IMMEDIATE_RESUME');
  await page.waitForTimeout(1500);
  assert.equal(await bubble('IMMEDIATE_RESUME').count(), 1);
  assert.equal(fake.calls('turn/start').filter(message => message.params.threadId === resumeId).length, 0);
  await page.screenshot({ path: join(output, 'resume-held.png') });
  await assertMessageOrder('IMMEDIATE_RESUME');
  resumeGates.get(resumeId)!.release();
  await waitTurn(resumeId, 'IMMEDIATE_RESUME');
  assert.equal(await bubble('IMMEDIATE_RESUME').count(), 1);
  turnGates.get(resumeId)!.release();
  await finish(resumeId, 'IMMEDIATE_RESUME');
  checks.push('A held resume keeps the pending bubble visible while model and permission preparation still wait');

  await open(configId);
  const configReads = fake.calls('config/read').length;
  holdConfig = true;
  await send('IMMEDIATE_CONFIG', 'click');
  await fake.waitFor(() => fake.calls('config/read').length > configReads, 15000);
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('textbox', { name: /^(Sending message|正在发送消息)$/ }).count(), 0,
    'the native pending-message mirror must not replace the cleared editor');
  assert.equal((await page.getByRole('textbox').last().innerText()).trim(), '',
    'the composer must stay empty while configuration holds admission');
  assert.equal(await bubble('IMMEDIATE_CONFIG').count(), 1);
  assert.equal(fake.calls('turn/start').filter(message => message.params.threadId === configId).length, 0);
  await assertMessageOrder('IMMEDIATE_CONFIG');
  holdConfig = false; configGate.release();
  await waitTurn(configId, 'IMMEDIATE_CONFIG');
  turnGates.get(configId)!.release();
  await finish(configId, 'IMMEDIATE_CONFIG');
  checks.push('Configuration preparation keeps one bubble until the native submission resumes');

  await open(cancelId);
  await send('CANCEL_ON_SWITCH');
  await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Message fixture 0' }).first().click();
  await page.getByText('Completed IMMEDIATE_READY', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await bubble('CANCEL_ON_SWITCH').count(), 0);
  resumeGates.get(cancelId)!.release();
  await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'Message fixture 2' }).first().click();
  await page.getByText('Previous reply 2', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole('textbox').last().getByText('CANCEL_ON_SWITCH', { exact: true }).waitFor();
  assert.equal(fake.calls('turn/start').filter(message => message.params.threadId === cancelId).length, 0);
  assert.equal(await page.locator('[data-yard-preparing-message]').count(), 0);
  checks.push('Switching threads cancels deferred submission, clears its placeholder and retains the original draft');

  await open(failureId);
  await send('RETRY_AFTER_REJECTION');
  await waitTurn(failureId, 'RETRY_AFTER_REJECTION');
  turnGates.get(failureId)!.release();
  await page.locator('[data-yard-preparing-message]').waitFor({ state: 'hidden', timeout: 10000 });
  await page.getByText('Fixture rejected this message; retry is safe', { exact: false }).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(output, 'rejected.png') });
  await writeFile(join(output, 'rejected.txt'), await page.locator('body').ariaSnapshot());
  const editor = page.getByRole('textbox').last();
  if ((await editor.innerText()).includes('RETRY_AFTER_REJECTION')) await editor.press('Enter');
  else {
    await page.getByRole('group').filter({ hasText: 'RETRY_AFTER_REJECTION' }).last().waitFor();
    await page.getByRole('button', { name: /^(重试|Retry)$/ }).click();
  }
  await fake.waitFor(() => fake.calls('turn/start').filter(message => message.params.threadId === failureId).length === 2, 15000);
  await finish(failureId, 'RETRY_AFTER_REJECTION');
  checks.push('A definitive rejection removes the preparing bubble, retains the native recovery message and allows one explicit retry');

  await open(orderId);
  holdPreparation = true; preparationGate = gate();
  await send('ORDERED_PREPARATION');
  // Backend activity can arrive before the submitting client's admission reply
  // and user-message item. Keep the original text ahead of this empty turn.
  fake.broadcast({ method: 'turn/started', params: { threadId: orderId,
    turn: fixtureTurn('early-order-turn', [], 'inProgress') } });
  await page.getByText(/^(Thinking|正在思考|思考中)$/).last().waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(output, 'early-thinking.png') });
  await assertMessageOrder('ORDERED_PREPARATION');
  const orderProbe = await page.evaluate(() => (window as unknown as { yardSendProbe: { thinkingAt: number } }).yardSendProbe);
  assert.ok(orderProbe.thinkingAt > 0, 'the order check must observe a real native Thinking indicator');
  await open(queueId);
  await page.getByText('Working on current prompt', { exact: true }).waitFor();
  holdPreparation = false; preparationGate.release();
  assert.equal(fake.calls('turn/start').filter(message => message.params.threadId === orderId).length, 0);
  checks.push('User text stays above an early native Thinking turn; leaving during preparation cancels the local submission');
  await page.evaluate(() => {
    const target = window as unknown as { yardQueueBubbleCount: number };
    target.yardQueueBubbleCount = 0;
    new MutationObserver(() => {
      target.yardQueueBubbleCount = Math.max(target.yardQueueBubbleCount,
        [...document.querySelectorAll('.bg-user-message')].filter(node => node.textContent?.trim() === 'WAIT_IN_QUEUE').length);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const queueEditor = page.getByRole('textbox').last();
  await page.evaluate(() => { (window as unknown as { yardQueueFixture: boolean }).yardQueueFixture = true; });
  await queueEditor.fill('WAIT_IN_QUEUE');
  await queueEditor.press('Enter');
  await fake.waitFor(message => message.method === 'thread/queue/add' && message.params.threadId === queueId, 15000);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(output, 'queue-admission-held.png') });
  assert.equal(await bubble('WAIT_IN_QUEUE').count(), 0, 'queued messages must not appear in the conversation before admission');
  queueGate.release();
  await page.getByRole('group').filter({ hasText: 'WAIT_IN_QUEUE' }).waitFor();
  assert.equal((await queueEditor.innerText()).trim(), '', 'queue admission must release the submitted draft');
  assert.equal(await page.locator('[data-yard-preparing-message]').count(), 0);
  assert.equal(await page.evaluate(() => (window as unknown as { yardQueueBubbleCount: number }).yardQueueBubbleCount), 0,
    'queue submission must never flash a sending bubble');
  assert.equal(fake.calls('turn/start').filter(message => message.params.threadId === queueId).length, 0);
  checks.push('An active-turn follow-up remains in the queue and never flashes a sending bubble while admission waits');
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('thread/queue/add').filter(message => message.params.threadId !== queueId).length, 0,
    'ordinary sends must preserve immediate-send semantics');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  for (const release of releases) release();
  report.turnRequests = fake.calls('turn/start').map(message => ({ threadId: message.params.threadId, input: message.params.input }));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
