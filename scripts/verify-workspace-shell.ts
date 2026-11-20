// Isolated shell regression. Run under /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const reference = process.argv.includes('--reference');
const output = resolve(process.env.AGENTS_SHELL_EVIDENCE ?? '.local/workspace-shell-' + (reference ? 'original' : 'react'));
await mkdir(output, { recursive: true });
const root = await mkdtemp('/tmp/yard-shell-');
const fake = await createFakeCodex(root);
const threadId = '00000000-0000-4000-8000-000000000207';
const route = '/local/' + threadId;
const answer = 'Saved shell fixture.';
fake.threads.set(threadId, fixtureThread(threadId, root, {
  name: 'A long conversation title for checking tool tabs and pane boundaries',
  path: join(root, threadId + '.jsonl'), turns: [fixtureTurn('shell-turn', [
    agentItem('shell-answer', answer + '\n\n' + Array.from({ length: 35 }, (_, i) => `Paragraph ${i + 1}: transcript content remains centered while its viewport fills the entire conversation pane.`).join('\n\n')),
  ])],
}));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/rateLimits/read', () => ({ rateLimits: {
  primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null },
  secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: null },
} }));
fake.handlers.set('thread/goal/get', () => ({ goal: {
  threadId, objective: 'Finish the shell fixture', status: 'active', tokenBudget: 100_000,
  tokensUsed: 12_500, timeUsedSeconds: 70,
  createdAt: Math.floor(Date.now() / 1_000), updatedAt: Math.floor(Date.now() / 1_000),
} }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'), sourceWorkspace: !reference,
  hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(8_000);
const errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let passed = false;
async function snapshot(name: string) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(output, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
  const visibleAnswer = page.getByText(answer, { exact: true });
  await writeFile(join(output, name + '.layout.json'), JSON.stringify(await visibleAnswer.count() ? await visibleAnswer.evaluate(node => {
    const rows = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      rows.push({ tag: element.tagName, class: element.className, role: element.getAttribute('role'),
        x: rect.x, right: rect.right, width: rect.width, scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight, overflow: style.overflow, padding: style.padding });
    }
    return rows;
  }) : [], null, 2));
}
async function workspace() {
  await page.getByText(answer, { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first().waitFor();
}
async function viewportAtBoundary() {
  const main = await page.locator('.yard-source-main').boundingBox();
  const paneOpen = await page.locator('.yard-source-sidechat:not([hidden])').count();
  const boundary = paneOpen ? main : await page.locator('.yard-source-workspace').boundingBox();
  const viewport = await page.getByRole('region', { name: 'Conversation', exact: true }).boundingBox();
  assert.ok(main && boundary && viewport);
  assert.ok(Math.abs(main.x - viewport.x) <= 1 && Math.abs(boundary.x + boundary.width - viewport.x - viewport.width) <= 1,
    'The transcript scroll viewport must meet both conversation pane boundaries.');
}
try {
  await page.addInitScript(() => {
    try { localStorage.setItem('native-atoms', JSON.stringify({ 'show-context-window-usage': true, ...JSON.parse(localStorage.getItem('native-atoms') || '{}') })); } catch {}
  });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent(route), { waitUntil: 'commit' });
  await workspace();
  await snapshot('conversation');
  const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first();
  if (!reference) {
    await viewportAtBoundary();
    await editor.fill('The draft survives resizing and settings.');
    await editor.evaluate(node => { (window as unknown as { shellEditor: Element }).shellEditor = node; });
    const splitter = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
    const initial = Number(await splitter.getAttribute('aria-valuenow'));
    await splitter.press('ArrowRight');
    assert.equal(Number(await splitter.getAttribute('aria-valuenow')), initial + 10);
    const box = await splitter.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
    assert.equal(Number(await splitter.getAttribute('aria-valuenow')), initial + 70);
    await splitter.press('Home'); assert.equal(await splitter.getAttribute('aria-valuenow'), '240');
    await splitter.press('End'); assert.equal(await splitter.getAttribute('aria-valuenow'), '520');
    assert.equal(await editor.evaluate(node => node === (window as unknown as { shellEditor: Element }).shellEditor), true);
    assert.equal(await editor.innerText(), 'The draft survives resizing and settings.');
    await page.reload({ waitUntil: 'commit' }); await workspace();
    assert.equal(await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).getAttribute('aria-valuenow'), '520');
    await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).dblclick();
    assert.equal(await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).getAttribute('aria-valuenow'), '340');
    checks.push('Sidebar pointer/keyboard resize, bounds, reset and persisted width; editor identity and draft retained');
    await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
    const goalEditor = page.getByRole('textbox', { name: 'Goal', exact: true });
    await goalEditor.waitFor();
    assert.equal(await goalEditor.innerText(), 'Finish the shell fixture');
    await goalEditor.fill('An unsaved goal draft');
    await page.getByRole('button', { name: 'Close Goal tab', exact: true }).click();
    await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
    await goalEditor.waitFor(); assert.equal(await goalEditor.innerText(), 'An unsaved goal draft');
    await page.getByRole('button', { name: 'Close Goal tab', exact: true }).click();
    fake.broadcast({ method: 'thread/tokenUsage/updated', params: { threadId, tokenUsage: {
      total: { totalTokens: 900_000 }, last: { totalTokens: 20_000 }, modelContextWindow: 200_000,
    } } });
    const indicator = page.getByRole('img', { name: 'Context usage: 10%', exact: true });
    await indicator.hover(); await page.getByRole('tooltip').waitFor();
    assert.match(await page.getByRole('tooltip').innerText(), /20k \/ 200k tokens used/);
    await page.mouse.move(0, 0);
    checks.push('Conversation Goal opens the real right tool tab and retains unsaved drafts; context usage reflects the latest request');
  }
  await page.getByRole('button', { name: reference ? 'Toggle side panel' : 'Open right sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'New tab', exact: true }).first().click();
  const selected = page.getByRole('tab', { name: 'New tab', selected: true, exact: true });
  await selected.waitFor();
  await page.keyboard.down('Control'); await page.waitForTimeout(650);
  await snapshot('new-tab-shortcut');
  if (!reference) {
    await viewportAtBoundary();
    const wrapper = selected.locator('..');
    assert.equal(await selected.locator('svg').count(), 1);
    assert.equal(await selected.locator('kbd').innerText(), 'Ctrl+1');
    const tabBox = await wrapper.boundingBox(), close = await wrapper.getByRole('button', { name: 'Close New tab tab', exact: true }).boundingBox();
    const plus = await page.getByRole('button', { name: 'New tab', exact: true }).boundingBox();
    assert.ok(tabBox && close && plus && close.x >= tabBox.x && close.x + close.width <= tabBox.x + tabBox.width);
    assert.ok(plus.x - tabBox.x - tabBox.width <= 8, 'The plus follows the complete tab without a gap.');
    await page.keyboard.up('Control');
    await selected.locator('kbd').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    const tablist = page.getByRole('tablist', { name: 'Chat tabs', exact: true });
    assert.equal(await tablist.getByRole('tab').count(), 2);
    await editor.press('Control+1');
    assert.equal(await tablist.getByRole('tab').first().getAttribute('aria-selected'), 'true');
    await tablist.getByRole('tab').first().press('ArrowRight');
    assert.equal(await tablist.getByRole('tab').last().getAttribute('aria-selected'), 'true');
    await tablist.locator('[data-active="true"] [data-app-shell-tab-close-button]').click();
    assert.equal(await tablist.getByRole('tab').count(), 1);
    await tablist.getByRole('tab').click({ button: 'middle' });
    await page.getByRole('button', { name: 'Open right sidebar', exact: true }).waitFor();
    checks.push('Original new-tab icon, held-modifier hints, inset close, adjacent plus, tab switching and middle-click close');
    await page.locator('.yard-source-profile-trigger').click();
    const usage = page.getByRole('group', { name: 'Usage remaining', exact: true });
    await usage.getByText('75%', { exact: true }).waitFor();
    await usage.getByText('20%', { exact: true }).waitFor();
    checks.push('Profile account usage renders real daemon quota windows');
    await page.getByRole('menuitem', { name: /^Settings/ }).click();
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 30_000 });
    await page.getByText('Back to app', { exact: true }).click(); await workspace();
    for (const path of ['/settings/pets', '/settings']) {
      await page.evaluate(path => window.postMessage({ type: 'navigate-to-route', path }, location.origin), path);
      await page.locator('meta[name="yard-pinned-tool"]').waitFor({ state: 'attached', timeout: 30_000 });
      await page.getByRole('heading', { name: path.endsWith('pets') ? 'Mini & Pets' : 'General', exact: true }).waitFor({ timeout: 30_000 });
      await page.getByText('Back to app', { exact: true }).click(); await workspace();
      assert.equal(await editor.innerText(), 'The draft survives resizing and settings.');
    }
    await page.evaluate(() => {
      history.pushState(null, '', '/?initialRoute=%2Fsettings%2Fgeneral-settings');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 30_000 });
    await page.goBack(); await workspace();
    await page.goForward();
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 30_000 });
    checks.push('Profile, host settings messages, settings root and history use the correct renderer without manual refresh');
  } else await page.keyboard.up('Control');
  assert.deepEqual(errors, []); passed = true;
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png') });
  await writeFile(join(output, 'failure.aria.txt'), await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed, reference, checks, errors }, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
