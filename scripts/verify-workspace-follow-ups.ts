// Disposable App Server fixture; run under /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Locator } from 'playwright-core';
import type { ThreadItemSummary } from '../lib/codex-protocol.ts';
import { questionReplies } from '../src/native/async-questions.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, commandItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const source = process.argv.includes('--source');
const output = resolve(process.env.AGENTS_FOLLOW_UP_EVIDENCE ?? '.local/workspace-follow-ups');
const root = await mkdtemp('/tmp/yard-follow-ups-');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Follow-up fixture', path: root }]));
const fake = await createFakeCodex(root);
const threadId = '00000000-0000-4000-8000-000000000197';
const thread = fixtureThread(threadId, root, { name: 'A selected chat with a long title to verify the tab bar and its controls',
  path: join(root, threadId + '.jsonl'), turns: [fixtureTurn('seed', [
    { ...agentItem('seed-answer', 'Saved fixture.'), phase: 'final_answer' },
  ])] });
fake.threads.set(threadId, thread);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params),
  turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('thread/turns/list', params => ({ data: [...thread.turns].reverse().map(turn => ({ ...turn,
  itemsView: params.itemsView ?? 'full', items: params.itemsView === 'notLoaded' ? [] : params.itemsView === 'summary'
    ? turn.items.filter(item => item.type === 'userMessage' || item.type === 'agentMessage' && item.phase !== 'commentary') : turn.items,
})), nextCursor: null, backwardsCursor: null }));
fake.handlers.set('turn/start', params => {
  const result = fake.defaultResult('turn/start', params);
  const turn = thread.turns.at(-1)!;
  turn.startedAt = Math.floor(Date.now() / 1000) - 60;
  return result;
});
let rejectReply = false;
fake.handlers.set('turn/steer', params => {
  if (rejectReply) { rejectReply = false; throw new Error('Fixture reply rejected'); }
  const turn = thread.turns.at(-1)!;
  const item = { id: 'steer-' + fake.calls('turn/steer').length, type: 'userMessage',
    clientId: params.clientUserMessageId, content: params.input };
  turn.items.push(item);
  fake.broadcast({ method: 'item/completed', params: { threadId, turnId: turn.id, item } });
  return { turnId: turn.id };
});
fake.handlers.set('thread/fork', params => {
  const result = fake.defaultResult('thread/fork', params) as { thread: typeof thread };
  const child = fake.threads.get(result.thread.id)!;
  child.attachedToThreadId = threadId;
  child.name = 'A very long side chat title for checking the intrinsic width of a selected tab '.repeat(5);
  return { ...result, thread: { ...child, turns: [] } };
});
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), sourceWorkspace: source, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(8_000);
const errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let passed = false;
async function snapshot(name: string) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(output, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
  if (name === 'question') await writeFile(join(output, name + '.html'), (await page.locator('[data-codex-composer-root]')
    .evaluateAll(elements => elements.map(element => element.outerHTML))).join('\n'));
  if (name === 'question') await writeFile(join(output, name + '.layout.json'), JSON.stringify(await page.locator(
    '[data-composer-body],[data-composer-input],[data-rich-text-layout],.ProseMirror,.ProseMirror p').evaluateAll(elements => elements.map(node => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      return { class: node.className, height: box.height, minHeight: style.minHeight, padding: style.padding, lineHeight: style.lineHeight,
        display: style.display, editorMinHeight: style.getPropertyValue('--composer-editor-min-height') };
    })), null, 2));
}
async function order(rows: Locator[]) {
  const top = await Promise.all(rows.map(row => row.evaluate(node => node.getBoundingClientRect().top)));
  assert.ok(top.every((value, index) => !index || value > top[index - 1]!), 'Transcript order: ' + top.join(', '));
}
try {
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  const transcript = page.getByRole('region', { name: 'Conversation', exact: true });
  await transcript.getByText('Saved fixture.', { exact: true }).waitFor({ timeout: 25_000 });
  const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first();
  await editor.fill('Start the fixture.'); await editor.press('Enter');
  await fake.waitForCall('turn/start');
  const turn = thread.turns.at(-1)!;
  const finish = (item: ThreadItemSummary) => {
    turn.items.push(item);
    fake.broadcast({ method: 'item/started', params: { threadId, turnId: turn.id, item } });
    fake.broadcast({ method: 'item/completed', params: { threadId, turnId: turn.id, item } });
  };
  finish({ ...agentItem('progress-before', 'Progress before the follow-up.'), phase: 'commentary' });
  finish({ ...commandItem('command-before', 'before', root), command: 'printf before' });
  await transcript.getByText('Progress before the follow-up.', { exact: true }).waitFor();
  if (source) {
    await editor.fill('Keep this message queued.'); await editor.press('Control+Enter');
    await fake.waitForCall('thread/queue/add');
    const queue = page.getByRole('region', { name: 'Queued messages' });
    await queue.getByText('Keep this message queued.', { exact: true }).waitFor();
    assert.equal(await transcript.getByText('Keep this message queued.', { exact: true }).count(), 0);
    await queue.getByRole('button', { name: 'Queued message actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Turn on queueing', exact: true }).click();
    await editor.fill('Follow-up at this point.');
    await page.getByRole('button', { name: 'Queue', exact: true }).waitFor();
    await editor.press('Control+Enter');
  } else {
    await editor.fill('Follow-up at this point.'); await editor.press('Enter');
  }
  await fake.waitForCall('turn/steer');
  finish({ ...agentItem('progress-after', 'Progress after the follow-up.'), phase: 'commentary' });
  if (source) {
    await transcript.getByText('Follow-up at this point.', { exact: true }).waitFor();
    await order(['Progress before the follow-up.', 'Follow-up at this point.', 'Progress after the follow-up.']
      .map(text => transcript.getByText(text, { exact: true })));
    assert.equal(await transcript.locator('.yard-source-turn-activity-toggle').count(), 1);
    await page.reload({ waitUntil: 'commit' });
    await transcript.getByText('Progress after the follow-up.', { exact: true }).waitFor();
    await order(['Progress before the follow-up.', 'Follow-up at this point.', 'Progress after the follow-up.']
      .map(text => transcript.getByText(text, { exact: true })));
    checks.push('Ctrl+Enter reverses both queue modes', 'Queued messages stay outside the transcript',
      'Follow-ups stay between their surrounding activity, including after reload', 'One Work disclosure per turn');
  }
  const question = { ...agentItem('async-question', 'May the isolated fixture continue?'), phase: 'final_answer', delivery: 'async',
    questions: [{ title: 'May the isolated fixture continue?', options: ['Continue', 'Wait'] },
      { title: 'Any constraints?', options: [] }] };
  finish(question);
  const panel = page.locator('[data-codex-composer-request-navigation]');
  await panel.waitFor();
  await snapshot('question-choices');
  await panel.getByRole('radio', { name: 'Continue', exact: true }).click();
  await panel.getByText('Any constraints?', { exact: true }).waitFor();
  const reply = panel.getByRole('textbox');
  await reply.fill('Keep the existing session running.');
  await snapshot('question');
  if (source) {
    const box = await page.locator('[data-async-question-open] [data-composer-body]').boundingBox();
    assert.ok(box && box.height <= 44, 'The canonical composer stays compact while the question panel is open.');
  }
  const beforeReply = fake.calls('turn/steer').length;
  if (source) {
    rejectReply = true;
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: 'Fixture reply rejected' }).waitFor();
    assert.equal(await reply.inputValue(), 'Keep the existing session running.');
    checks.push('Failed question replies retain the form and draft');
  }
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await fake.waitForCall('turn/steer', beforeReply + (source ? 2 : 1));
  await panel.waitFor({ state: 'detached' });
  const item = turn.items.at(-1)!;
  assert.deepEqual(questionReplies(item).map(reply => [reply.question, reply.answer]),
    [['May the isolated fixture continue?', 'Continue'], ['Any constraints?', 'Keep the existing session running.']]);
  assert.equal(turn.status, 'inProgress');
  checks.push('Original question envelope, multi-question choices and custom replies', 'Answering does not stop the turn');
  await snapshot('answered');
  if (source) {
    finish({ ...question, id: 'async-manual', questions: [{ title: 'Reopen this question?', options: ['Yes', 'Later'] }] });
    await panel.getByText('Reopen this question?', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    await transcript.getByRole('button', { name: 'Answer question', exact: true }).last().click();
    await panel.getByText('Reopen this question?', { exact: true }).waitFor();
    await panel.getByRole('radio', { name: 'Yes', exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    assert.equal(questionReplies(turn.items.at(-1)!)[0]?.answer, 'Yes');
    await transcript.getByRole('button', { name: 'Edit response', exact: true }).last().click();
    await panel.getByRole('textbox').fill('Please wait.');
    await panel.getByRole('button', { name: 'Send update', exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    assert.equal(questionReplies(turn.items.at(-1)!)[0]?.answer, 'Please wait.');
    finish({ ...question, id: 'async-skip', questions: [{ title: 'Keep earlier answers?', options: ['Keep', 'Discard'] },
      { title: 'Optional details?', options: [] }] });
    await panel.getByRole('radio', { name: 'Keep', exact: true }).click();
    await panel.getByText('Optional details?', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Skip', exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    assert.deepEqual(questionReplies(turn.items.at(-1)!).map(reply => [reply.question, reply.answer]), [['Keep earlier answers?', 'Keep']]);
    checks.push('Dismissed questions can reopen, submitted answers can update, skipping keeps earlier answers');
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New side chat', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: 'Chat tabs', exact: true });
    const selected = tabs.getByRole('tab', { selected: true });
    await selected.filter({ hasText: 'A very long side chat title' }).waitFor();
    const box = await selected.boundingBox();
    const next = await page.getByRole('button', { name: 'New tab', exact: true }).boundingBox();
    assert.ok(box && next);
    await snapshot('long-tab');
    await writeFile(join(output, 'tabs.json'), JSON.stringify({ box, next, gap: next.x - box.x - box.width }, null, 2));
    assert.ok(next.x - box.x - box.width <= 8, 'New tab must follow the visible tab without an intrinsic-width gap.');
    checks.push('Long tab title keeps the new-tab control adjacent');
  }
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  await snapshot('failure');
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed, source, checks, errors }, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
