// Disposable summary fixture. Run under /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { ThreadItemSummary } from '../lib/codex-protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { composerInput } from '../src/workspace/composer-input.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const reference = process.argv.includes('--reference');
const output = resolve(process.env.AGENTS_SUMMARY_EVIDENCE ?? '.local/workspace-summary-' + (reference ? 'original' : 'react'));
await mkdir(output, { recursive: true });
const root = await mkdtemp('/tmp/yard-summary-');
const fake = await createFakeCodex(root);
const threadId = '00000000-0000-4000-8000-000000000216';
const turnId = 'summary-turn';
const attachment = (index: number): ThreadItemSummary => ({ id: 'attachment-' + index, type: 'userMessage',
  content: [...composerInput('Inspect source ' + index + '.', [{ name: 'sample-' + index + '.md', path: join(root, 'sample-' + index + '.md'), image: false }])] });
for (let index = 1; index <= 40; index++) await writeFile(join(root, 'sample-' + index + '.md'), 'Synthetic source ' + index + '.');
const turn = fixtureTurn(turnId, [attachment(1), attachment(2), agentItem('summary-answer', 'Inspecting the summary fixture.')], 'inProgress');
const thread = fixtureThread(threadId, root, { name: 'Summary fixture', status: { type: 'active' },
  path: join(root, threadId + '.jsonl'), turns: [turn] });
fake.threads.set(threadId, thread);
function sidechat(index: number) {
  const child = fixtureThread('00000000-0000-4000-8000-' + String(300 + index).padStart(12, '0'), root, {
    name: 'Attached chat ' + index, attachedToThreadId: threadId,
    turns: [fixtureTurn('child-turn-' + index, [agentItem('child-answer-' + index, 'Child answer ' + index + '.')])],
  });
  fake.threads.set(child.id, child);
  return child;
}
for (let index = 1; index <= 4; index++) sidechat(index);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'), sourceWorkspace: !reference,
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(8_000);
const errors: string[] = [], checks: string[] = [];
const layouts: Record<string, unknown> = {};
page.on('pageerror', error => errors.push(error.message));
const sources = page.getByRole('button', { name: 'Sources', exact: true });
const files = page.getByRole('list', { name: 'Sources', exact: true });
let passed = false;
async function snapshot(name: string) {
  layouts[name] = await sources.evaluate(node => {
    const header = node.closest('header')!, section = header.parentElement!;
    const text = node.querySelector('span')!, icon = node.querySelector('svg')!;
    const box = (element: Element) => {
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      return { x: r.x, y: r.y, width: r.width, height: r.height, padding: s.padding,
        lineHeight: s.lineHeight, gap: s.gap, transform: s.transform, opacity: s.opacity };
    };
    return { header: box(header), toggle: box(node), text: box(text), icon: box(icon), svg: icon.outerHTML,
      section: section.outerHTML };
  });
  await sources.locator('..').screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
}
function add(index: number) {
  const item = attachment(index);
  turn.items.push(item);
  fake.broadcast({ method: 'item/completed', params: { threadId, turnId, item } });
}
async function assertExpanded(value: boolean) {
  await page.waitForFunction(({ expected }) => document.querySelector('button[aria-label="Sources"]')?.getAttribute('aria-expanded') === String(expected), { expected: value });
}
async function assertScroll(sectionKey = 'sources') {
  const viewport = page.viewportSize()!;
  const content = page.locator('[data-summary-section="' + sectionKey + '"] > .yard-summary-section-content');
  const dimensions = await content.evaluate(node => {
    const r = node.getBoundingClientRect();
    node.scrollTop = node.scrollHeight;
    return { height: r.height, client: node.clientHeight, scroll: node.scrollHeight,
      scrollTop: node.scrollTop, overflow: getComputedStyle(node).overflowY };
  });
  assert.ok(dimensions.height <= viewport.height / 2 + 1, 'Expanded contents occupy at most half the viewport.');
  assert.ok(dimensions.scroll > dimensions.client && dimensions.scrollTop > 0 && dimensions.overflow === 'auto', 'Long contents scroll inside their section.');
  await sources.evaluate(node => {
    const summary = node.closest('aside')!;
    const bounds = summary.getBoundingClientRect();
    if (bounds.bottom > innerHeight + 1) throw new Error('Summary extends beyond the viewport.');
  });
  return dimensions;
}
try {
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText('Inspecting the summary fixture.', { exact: true }).waitFor({ timeout: 30_000 });
  const summaryToggle = page.getByRole('button', { name: /^(?:Toggle )?Summary$/i });
  if (!await sources.isVisible()) await summaryToggle.click();
  await sources.waitFor();
  if (!reference) {
    const chats = page.getByRole('button', { name: 'Side chats', exact: true });
    await chats.waitFor();
    assert.equal(await chats.getAttribute('aria-expanded'), 'false', 'Four saved side chats are collapsed after async loading.');
    await chats.click();
    const children = page.locator('[data-summary-section="side-chats"] > .yard-summary-section-content');
    await children.getByRole('button', { name: 'Attached chat 4', exact: true }).waitFor();
    const added = sidechat(5);
    fake.broadcast({ method: 'thread/started', params: { thread: added } });
    await children.getByRole('button', { name: 'Attached chat 5', exact: true }).waitFor();
    added.name = 'Renamed side chat'; added.status = { type: 'active' };
    fake.broadcast({ method: 'thread/name/updated', params: { threadId: added.id, threadName: added.name } });
    fake.broadcast({ method: 'thread/status/changed', params: { threadId: added.id, status: added.status } });
    await children.getByRole('button', { name: /Renamed side chat/ }).getByLabel('In progress').waitFor();
    assert.equal(await chats.getAttribute('aria-expanded'), 'true', 'Manual expansion survives child creation, rename and running status.');
    const geometry = await chats.evaluate(node => {
      const text = node.querySelector('.yard-summary-section-title')!.getBoundingClientRect();
      const arrow = node.querySelector('svg')!.getBoundingClientRect();
      return { gap: arrow.left - text.right, textWidth: text.width, toggleWidth: node.getBoundingClientRect().width };
    });
    assert.equal(geometry.gap, 6, 'Side chat row styles cannot stretch the title away from its arrow.');
    layouts.sidechatHeading = geometry;
    await chats.press('Space');
    fake.broadcast({ method: 'thread/started', params: { thread: sidechat(6) } });
    await page.waitForFunction(() => document.querySelector('[data-summary-section="side-chats"] .yard-summary-section-count')?.textContent === '6');
    assert.equal(await chats.getAttribute('aria-expanded'), 'false', 'Explicit collapse survives another attached chat.');
    await chats.press('Enter');
    for (let index = 7; index <= 24; index++) fake.broadcast({ method: 'thread/started', params: { thread: sidechat(index) } });
    await children.getByRole('button', { name: 'Attached chat 24', exact: true }).waitFor();
    layouts.sidechatScroll = await assertScroll('side-chats');
    await chats.press('Space');
    checks.push('Real Side chats integration: >3 initial collapse; explicit expand/collapse survives add/rename/status notifications; original 6px title/arrow gap; half-viewport internal scroll');
  }
  assert.equal(await sources.getAttribute('aria-expanded'), 'true');
  await files.getByRole('button', { name: 'sample-2.md', exact: true }).waitFor();
  await sources.hover();
  await snapshot('sources-two-hover');
  await sources.press('Space');
  await snapshot('sources-two-collapsed');
  await sources.press('Enter');
  checks.push('Two-item default expansion; keyboard Space collapses and Enter expands; pinned header SVG recorded');
  if (!reference) {
    // Reset the manual choice before testing the asynchronous default.
    await page.reload({ waitUntil: 'commit' });
    await page.getByText('Inspecting the summary fixture.', { exact: true }).waitFor();
    if (!await sources.isVisible()) await summaryToggle.click();
    await assertExpanded(true);
    add(3); await files.getByRole('button', { name: 'sample-3.md', exact: true }).waitFor();
    await assertExpanded(true);
    add(4); await assertExpanded(false);
    assert.equal(await files.isVisible(), false);
    await snapshot('sources-four-auto-collapsed');
    await sources.click(); await assertExpanded(true);
    for (let index = 5; index <= 32; index++) add(index);
    await files.getByRole('button', { name: 'sample-32.md', exact: true }).waitFor();
    await assertExpanded(true);
    layouts.desktopScroll = await assertScroll();
    checks.push('Async 2→3 remains expanded; 3→4 auto-collapses; explicit expansion survives 28 further source notifications; half-viewport internal scroll');
    await sources.press('Space'); await assertExpanded(false);
    add(33);
    await page.waitForFunction(() => document.querySelector('[data-summary-section="sources"] .yard-summary-section-count')?.textContent === '33');
    await assertExpanded(false);
    await sources.press('Enter'); await assertExpanded(true);
    const addSource = page.getByRole('button', { name: 'Attach files or connect apps', exact: true });
    await addSource.click();
    await page.getByRole('menuitem', { name: 'Attach files or folders', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    checks.push('Explicit collapse survives streamed refresh; Sources add menu remains keyboard reachable');
    await page.setViewportSize({ width: 390, height: 520 });
    const sidebar = page.getByRole('button', { name: 'Hide sidebar', exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    if (!await sources.isVisible()) await summaryToggle.click();
    if (await sources.getAttribute('aria-expanded') === 'false') await sources.click();
    layouts.smallScroll = await assertScroll();
    await snapshot('sources-small-expanded');
    await page.setViewportSize({ width: 1440, height: 900 });
    const contents = page.locator('[data-summary-section="sources"] > .yard-summary-section-content');
    await contents.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.getByRole('button', { name: 'View all', exact: true }).click();
    await page.getByRole('tab', { name: 'Sources', exact: true, selected: true }).waitFor();
    await page.locator('.yard-source-sources-panel').getByRole('button', { name: 'sample-1.md', exact: true }).waitFor();
    checks.push('390×520 viewport remains bounded; View all still opens the complete Sources tab');
  }
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'failure.aria.txt'), await page.locator('body').ariaSnapshot()).catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ renderer: reference ? '26.1013.40934' : 'React/TypeScript',
    backend: 'synthetic 0.169.1 protocol peer; no real Codex session', passed, checks, errors, layouts }, null, 2) + '\n');
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed, checks, output }, null, 2));
