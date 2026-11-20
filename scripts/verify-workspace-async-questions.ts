// Disposable protocol/UI fixture. Run under /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { ThreadItemSummary } from '../lib/codex-protocol.ts';
import { questionReplies } from '../src/native/async-questions.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const output = resolve(process.env.AGENTS_ASYNC_QUESTIONS_EVIDENCE ?? '.local/workspace-async-questions');
const root = await mkdtemp('/tmp/yard-async-questions-');
const dataDir = join(root, 'data');
await mkdir(dataDir); await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Question fixture', path: root }]));
const fake = await createFakeCodex(root);
const threadId = '00000000-0000-4000-8000-000000000298';
const thread = fixtureThread(threadId, root, { name: 'Isolated async questions', path: join(root, threadId + '.jsonl'),
  turns: [fixtureTurn('seed', [agentItem('seed-answer', 'Question fixture ready.')])] });
fake.threads.set(threadId, thread);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params),
  turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('thread/turns/list', params => ({ data: [...thread.turns].reverse().map(turn => ({ ...turn,
  itemsView: params.itemsView ?? 'full', items: params.itemsView === 'notLoaded' ? [] : turn.items,
})), nextCursor: null, backwardsCursor: null }));
let release!: () => void, steerGate: Promise<void> | undefined, rejectReply = false;
fake.handlers.set('turn/steer', async params => {
  const wait = steerGate; steerGate = undefined; await wait;
  if (rejectReply) { rejectReply = false; throw new Error('Fixture question reply rejected'); }
  const turn = thread.turns.at(-1)!;
  assert.equal(params.expectedTurnId, turn.id);
  const item = { id: 'question-reply-' + fake.calls('turn/steer').length, type: 'userMessage',
    clientId: params.clientUserMessageId, content: params.input };
  turn.items.push(item);
  fake.broadcast({ method: 'item/completed', params: { threadId, turnId: turn.id, item } });
  return { turnId: turn.id };
});
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), sourceWorkspace: true, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(8_000);
const errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const panel = page.locator('[data-source-async-question]');
const reply = panel.getByRole('textbox');
const transcript = page.getByRole('region', { name: 'Conversation', exact: true });
let passed = false;
function finish(item: ThreadItemSummary) {
  const turn = thread.turns.at(-1)!;
  turn.items.push(item);
  fake.broadcast({ method: 'item/started', params: { threadId, turnId: turn.id, item } });
  fake.broadcast({ method: 'item/completed', params: { threadId, turnId: turn.id, item } });
}
function finishTurn() {
  const turn = thread.turns.at(-1)!;
  turn.status = 'completed'; thread.status = { type: 'idle' };
  fake.broadcast({ method: 'turn/completed', params: { threadId, turn } });
}
function question(id: string, questions: { title: string; options?: string[] }[]) {
  finish({ ...agentItem(id, questions.map(question => question.title).join('\n\n')), phase: 'final_answer', delivery: 'async', questions });
}
async function snapshot(name: string) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(output, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
}
try {
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await transcript.getByText('Question fixture ready.', { exact: true }).waitFor({ timeout: 25_000 });
  const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first();
  await editor.fill('Start isolated question checks.'); await editor.press('Enter'); await fake.waitForCall('turn/start');
  const longTitle = 'Which option should the isolated fixture use? '.repeat(5).trim();
  question('multi-question', [{ title: longTitle, options: ['是', '保持'] }, { title: 'Any constraints?' }]);
  await panel.getByText(longTitle, { exact: true }).waitFor();
  await reply.fill('是是'); await reply.press('Home'); await reply.press('Delete');
  assert.equal(await reply.inputValue(), '是', 'A deletion that leaves an exact option must preserve the custom text.');
  assert.equal(await panel.getByRole('radio', { checked: true }).count(), 0);
  await reply.fill('甲乙丙'); await reply.press('Home'); await reply.press('ArrowRight'); await reply.press('Backspace');
  assert.equal(await reply.inputValue(), '乙丙');
  await reply.fill('甲乙丙'); await reply.press('Home'); await reply.press('Delete');
  assert.equal(await reply.inputValue(), '乙丙');
  await reply.fill('甲乙丙'); await reply.evaluate(input => (input as HTMLTextAreaElement).setSelectionRange(0, 1)); await reply.press('Backspace');
  assert.equal(await reply.inputValue(), '乙丙');
  await reply.fill('甲乙丙'); await reply.evaluate(input => (input as HTMLTextAreaElement).setSelectionRange(0, 1)); await reply.press('Delete');
  assert.equal(await reply.inputValue(), '乙丙');
  await reply.fill('是');
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await panel.getByText('Any constraints?', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Previous question', exact: true }).click();
  assert.equal(await reply.inputValue(), '是', 'Navigating back must retain a custom answer matching an option.');
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await reply.fill('中文输入');
  await reply.dispatchEvent('compositionstart', { data: '' });
  await reply.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
  assert.equal(fake.calls('turn/steer').length, 0, 'IME confirmation must not send the form.');
  await reply.dispatchEvent('compositionend', { data: '中文输入' });
  await snapshot('custom-ime');
  rejectReply = true; steerGate = new Promise<void>(resolve => { release = resolve; });
  await panel.getByRole('button', { name: 'Send', exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
  });
  await fake.waitForCall('turn/steer');
  assert.equal(fake.calls('turn/steer').length, 1, 'Two asynchronous clicks must submit once.');
  assert.equal(await panel.getAttribute('aria-busy'), 'true');
  assert.equal(await panel.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  assert.equal(await panel.getByRole('button', { name: 'Dismiss', exact: true }).isDisabled(), true);
  assert.equal(await reply.isDisabled(), true);
  release();
  await panel.getByRole('alert').filter({ hasText: 'Fixture question reply rejected' }).waitFor();
  assert.equal(await reply.inputValue(), '中文输入');
  assert.equal(await panel.getByRole('button', { name: 'Send', exact: true }).isEnabled(), true);
  assert.equal(await reply.isEnabled(), true);
  await reply.press('Enter'); await fake.waitForCall('turn/steer', 2); await panel.waitFor({ state: 'detached' });
  assert.deepEqual(questionReplies(thread.turns.at(-1)!.items.at(-1)!), [
    { questionItemId: '["request_user_input_async","multi-question",0]', question: longTitle, answer: '是' },
    { questionItemId: '["request_user_input_async","multi-question",1]', question: 'Any constraints?', answer: '中文输入' },
  ]);
  checks.push('Backspace, Delete and selection deletion preserve Chinese custom text, including exact option matches',
    'Multi-question navigation retains drafts and uses the original composite IDs and reply envelope',
    'IME Enter does not submit, asynchronous clicks send once, failed answers retain both drafts and retry');
  const receipt = transcript.locator('[data-source-async-question-replies]').first();
  await receipt.waitFor();
  const layout = await receipt.evaluate(node => {
    const pair = node.firstElementChild!, title = pair.firstElementChild!;
    const bubble = node.closest('[data-user-message-bubble]')!;
    return { pairs: node.children.length, groupGap: getComputedStyle(node).gap, pairGap: getComputedStyle(pair).gap,
      opacity: getComputedStyle(title).opacity, whiteSpace: getComputedStyle(title).whiteSpace,
      overflow: getComputedStyle(title).textOverflow, radius: getComputedStyle(bubble).borderRadius,
      titleClipped: title.scrollWidth > title.clientWidth, bubbleWidth: bubble.getBoundingClientRect().width,
      containerWidth: bubble.parentElement!.getBoundingClientRect().width };
  });
  assert.equal(layout.pairs, 2); assert.equal(layout.groupGap, '12px'); assert.equal(layout.pairGap, '4px');
  assert.equal(layout.opacity, '0.7'); assert.equal(layout.whiteSpace, 'nowrap'); assert.equal(layout.overflow, 'ellipsis');
  assert.ok(layout.titleClipped); assert.notEqual(layout.radius, '0px');
  assert.ok(layout.bubbleWidth <= layout.containerWidth * .71);
  assert.equal(await transcript.getByText(/send_user_message_question_reply/).count(), 0);
  await writeFile(join(output, 'reply-layout.json'), JSON.stringify(layout, null, 2));
  await snapshot('answered-quote');
  checks.push('Original muted single-line question and answer pairs share one ordinary user bubble');
  question('finishing-question', [{ title: 'Can this click survive the turn ending?', options: ['Continue', 'Wait'] }]);
  await panel.getByText('Can this click survive the turn ending?', { exact: true }).waitFor();
  await panel.getByRole('radio', { name: 'Continue', exact: true }).click();
  finishTurn();
  await fake.waitForCall('turn/start', 2); await panel.waitFor({ state: 'detached' });
  assert.equal(fake.calls('turn/start')[1]!.params.turnTrigger, 'send_user_message_async_question');
  assert.equal(questionReplies(thread.turns.at(-1)!.items[0]!)[0]?.answer, 'Continue');
  question('reopen-question', [{ title: 'Answer after this turn finishes?', options: ['Yes', 'Later'] }]);
  await panel.getByText('Answer after this turn finishes?', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Dismiss', exact: true }).click(); finishTurn();
  await panel.waitFor({ state: 'detached' });
  await page.reload({ waitUntil: 'commit' });
  await transcript.getByText('Answer after this turn finishes?', { exact: true }).waitFor();
  await transcript.getByRole('button', { name: 'Answer question', exact: true }).last().click();
  await panel.getByRole('radio', { name: 'Yes', exact: true }).click();
  await fake.waitForCall('turn/start', 3); await panel.waitFor({ state: 'detached' });
  assert.equal(fake.calls('turn/start')[2]!.params.turnTrigger, 'send_user_message_async_question');
  assert.equal(questionReplies(thread.turns.at(-1)!.items[0]!)[0]?.questionItemId,
    '["request_user_input_async","reopen-question",0]');
  const firstReply = transcript.locator('.yard-source-user-turn').filter({ has: page.locator('[data-source-async-question-replies]') }).first();
  await firstReply.getByRole('button', { name: 'Edit response', exact: true }).click();
  assert.equal(await reply.inputValue(), '', 'A persisted exact option answer reopens as an option.');
  await reply.fill('Revised answer'); await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await reply.fill('Keep both responses.');
  await panel.getByRole('button', { name: 'Send update', exact: true }).click();
  await fake.waitForCall('turn/steer', 3); await panel.waitFor({ state: 'detached' });
  assert.deepEqual(questionReplies(thread.turns.at(-1)!.items.at(-1)!).map(reply => reply.answer), ['Revised answer', 'Keep both responses.']);
  checks.push('A choice survives turn completion during its 180 ms feedback delay',
    'Completed questions reopen after reload and start a turn with the original trigger',
    'Earlier multi-question responses reopen during a newer turn, retain IDs and steer that active turn');
  await snapshot('reopened-history');
  assert.deepEqual(errors, []); passed = true;
} catch (error) {
  await snapshot('failure'); throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed, checks, errors }, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
