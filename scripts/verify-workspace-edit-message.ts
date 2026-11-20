// Run under /tmp/agents-workbench-heavy.lock. Uses disposable threads and no account.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const source = process.argv.includes('--source');
const narrow = process.argv.includes('--narrow-dark');
const english = process.argv.includes('--english');
const rejectStart = process.argv.includes('--replacement-rejected');
const race = process.argv.includes('--another-client');
assert.ok(!(rejectStart || race) || source, 'The edit failure scenarios require --source.');
const output = resolve(process.env.AGENTS_EDIT_MESSAGE_EVIDENCE ?? '.local/workspace-edit-message');
const root = await mkdtemp('/tmp/yard-edit-message-');
await mkdir(output, { recursive: true });
await mkdir(join(root, 'data'));
await writeFile(join(root, 'data/projects.json'), JSON.stringify([{ name: 'Revision fixture', path: root }]));
if (english) await writeFile(join(root, 'data/native-state.json'), JSON.stringify({ settings: { localeOverride: 'en-US' } }));
const fake = await createFakeCodex(root);
const threadId = '00000000-0000-4000-8000-000000000001';
const inputs = [
  ['retained', 'Keep this earlier question.', 'Keep this earlier answer.'],
  ['edit-here', 'Please compare these two drafts.', 'Original comparison.'],
  ['newer', 'Now revise the first draft.', 'Original revision.'],
] as const;
const thread = fixtureThread(threadId, root, { name: 'Edit message fixture', path: join(root, 'session.jsonl'),
  turns: inputs.map(([id, request, reply]) => fixtureTurn(id, [
    { id: id + '-user', type: 'userMessage', content: [{ type: 'text', text: request, text_elements: [] }] },
    agentItem(id + '-reply', reply),
  ])),
});
fake.threads.set(threadId, thread);
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
    items: params.itemsView === 'notLoaded' ? [] : turn.items,
  })), nextCursor: offset + limit < turns.length ? String(offset + limit) : null, backwardsCursor: null };
});
if (rejectStart) fake.handlers.set('turn/start', () => { throw new Error('Fixture denies the replacement turn'); });
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'), sourceWorkspace: source,
  hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ locale: 'en-US', ...(narrow ?
  { viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true } : { viewport: { width: 1440, height: 900 } }) });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const mutations = () => fake.messages.filter(call => call.id != null &&
  ['thread/revert', 'thread/rollback', 'turn/start'].includes(call.method ?? ''));
const replacement = 'Compare their conclusions instead.';
const unsent = 'A separate unsent draft.';

async function snapshot(name: string) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
  await writeFile(join(output, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
}

async function measureEdit() {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const editor = '[role="textbox"][aria-label="Edit message"]';
    const selectors = [editor + ' p', editor, 'form:has(' + editor + ')', '[data-user-message-bubble] p', 'form button[type=submit]'];
    const metrics = await page.evaluate(selectors => selectors.map(selector => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) return null;
      const css = getComputedStyle(node), rect = node.getBoundingClientRect();
      return { size: css.fontSize, family: css.fontFamily, weight: css.fontWeight, lineHeight: css.lineHeight,
        width: rect.width, height: rect.height, radius: css.borderRadius, spacing: css.padding,
        lang: node.closest('[lang]')?.getAttribute('lang'), browserLang: navigator.language };
    }), selectors);
    const samples = [];
    for (const [index, selector] of selectors.entries()) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      samples.push({ selector, ...metrics[index], loadedFonts: nodeId ?
        (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map(font => font.familyName) : [] });
    }
    await writeFile(join(output, 'edit-style.json'), JSON.stringify(samples, null, 2) + '\n');
  } finally { await cdp.detach(); }
}

try {
  const route = '/local/' + threadId;
  await page.goto(app.url + (source ? route : '/?initialRoute=' + encodeURIComponent(route)), { waitUntil: 'commit' });
  const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first();
  const target = page.getByText(inputs[2][1], { exact: true });
  await target.waitFor({ timeout: 25_000 });
  if (!source) await fake.waitForCall('thread/resume');
  await page.waitForFunction(expected => document.documentElement.lang === expected, english ? 'en-US' : 'zh-CN');
  await editor.fill(unsent);
  const open = async () => {
    if (!narrow) await target.hover();
    const edit = target.locator('xpath=ancestor::*[.//button[@aria-label="Edit message"]][1]')
      .getByRole('button', { name: 'Edit message', exact: true }).first();
    await edit.waitFor({ timeout: 6_000 });
    await snapshot('hover');
    if (narrow) await edit.tap();
    else await edit.click();
    const inline = page.getByRole('textbox', { name: 'Edit message', exact: true });
    await inline.waitFor({ timeout: 5_000 });
    assert.equal(await inline.textContent(), inputs[2][1]);
    return inline;
  };
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const submit = conversation.getByRole('button', { name: 'Send', exact: true }).and(page.locator('button[type=submit]'));
  const inline = await open();
  await snapshot('edit');
  await measureEdit();
  assert.ok(await submit.isEnabled(), 'The latest prompt can be sent again unchanged.');
  assert.equal(mutations().length, 0, 'Opening the edit must not mutate history.');
  await inline.fill('An abandoned edit.');
  await conversation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await target.waitFor({ timeout: 5_000 });
  if (source) assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit message');
  assert.equal(await editor.textContent(), unsent);
  assert.equal(mutations().length, 0);
  const changed = await open();
  await changed.click();
  await changed.press('Control+a');
  await page.keyboard.insertText(replacement);
  assert.equal(await changed.textContent(), replacement);
  await snapshot('before-send');
  if (race) thread.turns.push(fixtureTurn('new-on-other-client',
    [{ id: 'external-user', type: 'userMessage', content: [{ type: 'text', text: 'Sent by another client.' }] }]));
  await submit.click();
  if (race) {
    await page.getByRole('alert').getByText(/latest message changed/i).waitFor();
    assert.deepEqual(mutations(), []);
    assert.equal(thread.turns.length, 4);
    assert.equal(await changed.textContent(), replacement);
  } else {
    const sent = await fake.waitForCall('turn/start');
    assert.ok(sent);
    assert.deepEqual(mutations().map(call => call.method), ['thread/revert', 'turn/start']);
    assert.deepEqual(mutations()[0].params, { threadId, beforeTurnId: 'newer' });
    assert.equal(sent.params.threadId, threadId);
    assert.equal(sent.params.turnTrigger, 'edit_user_message');
    if (source) assert.ok(JSON.stringify(sent.params.input).includes(replacement));
    if (rejectStart) {
      await page.getByRole('alert').getByText(/The previous turn was removed.*Fixture denies/).waitFor();
      await page.getByRole('button', { name: 'Copy edit', exact: true }).waitFor();
      assert.equal(await conversation.getByRole('textbox', { name: 'Edit message', exact: true }).count(), 0);
      assert.deepEqual(thread.turns.map(turn => turn.id), ['retained', 'edit-here']);
    } else if (source) {
      await page.getByText(replacement, { exact: true }).waitFor();
      await page.getByText(inputs[2][2], { exact: true }).waitFor({ state: 'hidden' });
      await page.getByText(inputs[1][2], { exact: true }).waitFor();
      assert.deepEqual(thread.turns.map(turn => turn.id), ['retained', 'edit-here', 'fixture-turn-1']);
    }
  }
  assert.equal(await editor.textContent(), unsent);
  if (narrow) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await snapshot('after-send');
  assert.deepEqual(errors, []);
} catch (error) {
  await snapshot('error');
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify({ renderer: source ? 'React/TypeScript' : '26.1013.40934',
    thread: thread.turns.map(turn => turn.id), mutations: mutations().map(call => call.params),
    historyRequests: fake.calls('thread/turns/list').map(call => call.params), errors }, null, 2) + '\n');
  await browser.close();
  await app.close();
  await fake.close();
  await rm(root, { recursive: true, force: true });
}
