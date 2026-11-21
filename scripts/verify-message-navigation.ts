// Disposable protocol/UI regression; serialize with /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const reference = process.argv.includes('--reference');
const output = resolve(process.env.AGENTS_NAVIGATION_EVIDENCE ?? '.local/message-navigation/' + (reference ? 'original' : 'react'));
await mkdir(output, { recursive: true });
const root = await mkdtemp('/tmp/yard-navigation-');
const fake = await createFakeCodex(root);
const threadId = '00000000-0000-4000-8000-000000000309';
const user = (id: string, text: string) => ({ id, type: 'userMessage', content: [{ type: 'text', text, text_elements: [] }] });
const turns = Array.from({ length: 132 }, (_, index) => fixtureTurn('turn-' + index, [
  user('prompt-' + index, 'Question ' + index), agentItem('reply-' + index,
    'Answer ' + index + '\n\n' + Array.from({ length: 7 }, (_, row) => `Paragraph ${row}: readable conversation content for checking navigation and scroll position.`).join('\n\n')),
]));
turns[15]!.items.push(user('steer-15', 'Steered question 15'), agentItem('steer-answer-15', 'Steered answer 15'));
fake.threads.set(threadId, fixtureThread(threadId, root, { name: 'Navigation fixture', path: join(root, threadId + '.jsonl'), turns }));
const otherId = '00000000-0000-4000-8000-000000000310';
fake.threads.set(otherId, fixtureThread(otherId, root, { name: 'Short navigation fixture', turns: Array.from({ length: 3 }, (_, i) =>
  fixtureTurn('other-' + i, [user('other-prompt-' + i, 'Other question ' + i), agentItem('other-reply-' + i, 'Other reply ' + i)])) }));
let failTarget = false, delayedTarget = false;
fake.handlers.set('thread/turns/list', async params => {
  const descending = (fake.threads.get(String(params.threadId))?.turns ?? []).slice().reverse();
  const start = params.cursor == null ? 0 : descending.findIndex(turn => 'at:' + turn.id === params.cursor);
  assert.ok(start >= 0);
  if (params.itemsView === 'summary' && Number(params.limit) > 2 && Number(params.limit) < 100) {
    if (failTarget) throw new Error('Fixture target temporarily unavailable');
    if (delayedTarget) await new Promise(resolve => setTimeout(resolve, 500));
  }
  const end = start + Number(params.limit);
  return { data: descending.slice(start, end).map(turn => ({ ...turn, itemsView: String(params.itemsView),
    items: params.itemsView === 'notLoaded' ? [] : turn.items })), backwardsCursor: 'at:' + descending[start]!.id,
    nextCursor: descending[end] ? 'at:' + descending[end]!.id : null };
});
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux fixture)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), sourceWorkspace: !reference, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: reference ? 2200 : 1600, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(8000);
const errors: string[] = [], checks: string[] = [], layouts: unknown[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.error(message.text().slice(0, 500)); });
const markers = () => reference ? page.locator('[data-thread-user-message-navigation-item-id]') : page.getByRole('navigation', { name: 'Message navigation', exact: true }).getByRole('button');
async function layout(name: string) {
  await page.waitForTimeout(200);
  const geometry = await page.locator('[data-thread-user-message-navigation-content]:visible').first().evaluate(async body => {
    let node: HTMLElement | null = body.parentElement;
    while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) node = node.parentElement;
    if (!node) throw new Error('Missing conversation scroll container');
    const scroll = node.getBoundingClientRect(), content = body.getBoundingClientRect();
    const original = await import('/web-renderer-v41/assets/' + 'floating-navigation-rail-25670fbf45eb.js');
    return { gap: (content.left - scroll.left) / (scroll.width / node.offsetWidth || 1), width: scroll.width,
      originalVisible: original.i(node, body) as boolean };
  });
  const visible = await markers().count() > 0 && await markers().first().isVisible();
  layouts.push({ name, ...geometry, visible });
  assert.equal(visible, geometry.gap >= 48, name + ': visibility follows the actual 48 CSS px gutter');
  assert.equal(visible, geometry.originalVisible, name + ': visibility matches the pinned original function');
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
}
async function marker(index: number) {
  return page.getByRole('button', { name: `Go to message ${index}`, exact: true });
}
async function visiblePrompt(text: string) {
  await page.getByRole('region', { name: 'Conversation', exact: true }).getByText(text, { exact: true }).waitFor();
  await page.waitForFunction(text => {
    const anchor = Array.from(document.querySelectorAll<HTMLElement>('[data-message-navigation-id]')).find(node => node.textContent?.includes(text));
    const root = document.querySelector('.yard-source-transcript');
    if (!anchor || !root) return false;
    const a = anchor.getBoundingClientRect(), r = root.getBoundingClientRect();
    return a.bottom > r.top && a.top < r.bottom;
  }, text);
}
try {
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first().waitFor({ timeout: 30000 });
  await markers().first().waitFor({ timeout: 30000 });
  await layout('wide');
  if (!reference) {
    await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'New tab', exact: true }).last().click();
    await page.getByRole('tab', { name: 'New tab', selected: true, exact: true }).waitFor();
    await layout('right-pane');
    const splitter = page.getByRole('separator', { name: 'Resize workspace panes', exact: true });
    await splitter.press('End'); await layout('right-pane-wide');
    await splitter.press('Home'); await layout('right-pane-small');
    const box = await splitter.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x - 240, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
    await layout('right-pane-dragged');
    await page.getByRole('button', { name: 'Close New tab tab', exact: true }).click();
  }
  for (const width of [1200, 1000, 800, 1600]) {
    await page.setViewportSize({ width, height: 1000 }); await layout('width-' + width);
  }
  await page.locator('html').evaluate(node => { node.style.zoom = '1.25'; }); await layout('zoom-125');
  await page.locator('html').evaluate(node => { node.style.zoom = ''; }); await layout('zoom-reset');
  checks.push(reference ? 'Pinned original viewport and CSS zoom visibility' :
    '48px gutter, right pane open/close, dragging, viewport and CSS zoom match the original function');
  if (!reference) {
    assert.equal(await markers().count(), 132);
    const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first();
    await editor.fill('Navigation must preserve this unsent draft.');
    const previews = () => fake.messages.filter(message => message.method === 'thread/turns/list' && message.params.itemsView === 'summary' && message.params.limit === 1);
    await (await marker(16)).hover();
    await page.getByRole('tooltip').getByText('Question 15', { exact: true }).waitFor();
    assert.equal(previews().length, 1);
    await page.mouse.move(0, 0); await (await marker(16)).hover(); await page.waitForTimeout(350);
    assert.equal(previews().length, 1);
    assert.equal(await markers().count(), 133);
    checks.push('Delayed on-demand preview is deduplicated and cached; hydrated steering prompt has its own key');
    await (await marker(16)).click(); await visiblePrompt('Question 15');
    assert.equal(await page.locator('[data-message-navigation-turn]').count(), 9);
    await page.getByRole('button', { name: 'Go to message 17', exact: true }).click(); await visiblePrompt('Steered question 15');
    await page.getByRole('button', { name: 'Load later messages', exact: true }).click();
    assert.equal(await page.locator('[data-message-navigation-turn]').count(), 11);
    assert.equal(await editor.innerText(), 'Navigation must preserve this unsent draft.');
    await (await marker(17)).click(); await visiblePrompt('Steered question 15');
    await editor.focus(); await editor.press('Alt+ArrowUp'); await visiblePrompt('Question 15');
    assert.equal(await editor.evaluate(node => node.contains(document.activeElement)), true);
    const from = await (await marker(16)).boundingBox(), to = await (await marker(18)).boundingBox();
    assert.ok(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 }); await page.mouse.up();
    await visiblePrompt('Question 16');
    checks.push('Distant seek restores a nine-turn window; steering, later pagination and Alt+Up preserve composer draft/focus');
    await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click();
    await visiblePrompt('Question 131');
    failTarget = true;
    await (await marker(41)).click(); await page.getByRole('alert').getByText(/Could not open/).waitFor();
    failTarget = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await visiblePrompt('Question 39');
    await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click();
    delayedTarget = true;
    await (await marker(61)).click();
    await (await marker(133)).click(); await visiblePrompt('Question 131');
    await page.waitForTimeout(700); await visiblePrompt('Question 131');
    checks.push('Target failure retries, and a superseded distant request cannot replace the latest selection');
    await page.locator('html').evaluate(node => { node.dataset.theme = 'dark'; });
    await layout('dark');
    delayedTarget = false;
    await (await marker(131)).click(); await visiblePrompt('Question 129');
    turns.push(fixtureTurn('live-132', [user('live-prompt', 'Question 132'), agentItem('live-reply', 'A new response arrived while reading history.')]));
    fake.broadcast({ method: 'turn/completed', params: { threadId, turn: turns.at(-1) } });
    await page.waitForFunction(() => document.querySelectorAll('.yard-source-message-navigation button').length === 134);
    await visiblePrompt('Question 129');
    await page.getByRole('button', { name: 'Load later messages', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Conversation', exact: true }).getByText('Question 132', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click(); await visiblePrompt('Question 132');
    delayedTarget = true;
    await (await marker(61)).click();
    await page.getByRole('complementary', { name: 'Sidebar', exact: true }).getByRole('button', { name: 'Short navigation fixture', exact: true }).click();
    await visiblePrompt('Other question 2'); await page.waitForTimeout(700);
    await visiblePrompt('Other question 2'); assert.equal(await markers().count(), 0);
    checks.push('Loaded-message drag, incoming completion while reading history, thread-switch cancellation and fewer-than-four hiding');
    const calls = fake.messages.filter(message => message.method === 'thread/turns/list').map(message => message.params);
    assert.ok(!calls.some(call => call.itemsView === 'full'), 'Navigation never loads full tool output');
    await writeFile(join(output, 'requests.json'), JSON.stringify(calls, null, 2));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, reference, checks, layouts }));
} finally {
  await page.screenshot({ path: join(output, 'final.png'), animations: 'disabled' }).catch(() => {});
  await writeFile(join(output, 'final.aria.txt'), await page.locator('body').ariaSnapshot().catch(() => ''));
  await writeFile(join(output, 'final.layout.json'), JSON.stringify(await page.locator('[data-thread-user-message-navigation-content]').evaluateAll(nodes => nodes.map(body => {
    const content = body.getBoundingClientRect(), root = body.parentElement!, scroll = root.getBoundingClientRect();
    return { content: content.toJSON(), scroll: scroll.toJSON(), width: root.offsetWidth, parent: root.parentElement?.className };
  })), null, 2));
  await writeFile(join(output, 'all-requests.json'), JSON.stringify(fake.messages.map(message => ({ method: message.method, params: message.params })), null, 2));
  await writeFile(join(output, 'report.json'), JSON.stringify({ reference, checks, layouts, errors }, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
