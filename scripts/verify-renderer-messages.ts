// Actual pinned conversation page; all protocol data and browser state are disposable.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, agentItem, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { rendererRoot } from '../lib/app-resources.ts';

const root = await mkdtemp('/tmp/yard-messages-ui-');
const output = resolve(process.env.AGENTS_MESSAGES_EVIDENCE ?? '.local/renderer-messages');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
const id = '00000000-0000-4000-8000-000000000641';
const completed = 'Completed fixture answer with **bold** text and [a link](https://example.com).';
const thread = fixtureThread(id, root, { name: 'Message migration fixture', turns: [fixtureTurn('completed-turn', [
  { id: 'completed-reasoning', type: 'reasoning', summary: ['A completed thought', 'Reasoning body for expansion.'], content: [] },
  agentItem('completed-answer', completed),
])] });
fake.threads.set(id, thread);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (fixture)' }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM
  ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [], notifications: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, checks, errors, notifications };
const upstreamAssistant = process.env.AGENTS_MESSAGES_UPSTREAM_ASSISTANT === '1';
report.upstreamAssistantComparison = upstreamAssistant;
const authoredNames = ['AssistantMessage', 'AssistantMessageActions', 'AssistantMessageOverflow', 'AdaptiveStreamingMarkdown', 'MarkdownRoot', 'ReasoningMessage', 'ThinkingStatusSlot'];
let page: Page | undefined;
async function mounted(page: Page) {
  return page.locator('body').evaluate(body => {
    type Fiber = { type?: { name?: string; displayName?: string }; return?: Fiber; child?: Fiber; sibling?: Fiber };
    const element = [...body.querySelectorAll('*')].find(node => Object.keys(node).some(key => key.startsWith('__reactFiber$')));
    if (!element) throw new Error('No renderer React host element');
    let root = Reflect.get(element, Object.keys(element).find(key => key.startsWith('__reactFiber$'))!) as Fiber;
    while (root.return) root = root.return;
    const queue = [root], names = new Set<string>();
    for (let i = 0; queue.length && i < 50_000; i++) {
      const fiber = queue.pop()!;
      const name = fiber.type?.displayName ?? fiber.type?.name;
      if (name) names.add(name);
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return [...names];
  });
}
function notify(method: string, params: object) { notifications.push(method); fake.broadcast({ method, params }); }

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (upstreamAssistant) {
    await page.route('**/assets/sites-end-resource-b11586198b69.js', route => readFile(join(rendererRoot, 'assets/sites-end-resource-b11586198b69.js')).then(body => route.fulfill({ body, contentType: 'text/javascript' })));
  }
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
  await page.getByText('Completed fixture answer with', { exact: false }).waitFor({ timeout: 60_000 });
  const names = await mounted(page);
  report.completedComponents = names.filter(name => authoredNames.includes(name));
  for (const name of upstreamAssistant ? ['AdaptiveStreamingMarkdown', 'MarkdownRoot'] : ['AssistantMessage', 'AssistantMessageActions', 'AssistantMessageOverflow', 'AdaptiveStreamingMarkdown', 'MarkdownRoot']) {
    assert.ok(names.includes(name), `The real turn must mount ${name}`);
  }
  checks.push(upstreamAssistant ? 'Comparison uses the unmodified pinned assistant resource and authored Markdown' : 'The actual completed turn mounts assistant/actions/overflow, adaptive Markdown and MarkdownRoot from authored source');
  // The pinned local activity classifier deliberately omits reasoning items.
  // pE remains a separate conditional consumer and is not claimed by this check.
  report.reasoningComponentMounted = names.includes('ReasoningMessage');
  await page.getByText('Completed fixture answer with', { exact: false }).hover();
  await page.getByRole('button', { name: 'Copy', exact: true }).first().click();
  await page.waitForFunction(() => navigator.clipboard.readText().then(text => text.includes('Completed fixture answer') && text.includes('bold') && text.includes('a link')));
  checks.push('The original completed response copy action works through the authored components');
  await page.screenshot({ path: join(output, 'completed.png') });

  const active = fixtureTurn('stream-turn', [], 'inProgress');
  thread.turns.push(active);
  thread.status = { type: 'active', activeFlags: [] };
  notify('thread/status/changed', { threadId: id, status: thread.status });
  notify('turn/started', { threadId: id, turn: active });
  const reasoning = { id: 'stream-reasoning', type: 'reasoning', summary: ['**Checking**\n\n'], content: [] };
  active.items.push(reasoning);
  notify('item/started', { threadId: id, turnId: active.id, item: reasoning });
  notify('item/reasoning/summaryTextDelta', { threadId: id, turnId: active.id, itemId: reasoning.id, summaryIndex: 0, delta: 'Live reasoning delta.' });
  await writeFile(join(output, 'reasoning-aria.txt'), await page.locator('body').ariaSnapshot());
  report.activeComponents = (await mounted(page)).filter(name => authoredNames.includes(name));
  reasoning.summary = ['**Checking**\n\nLive reasoning delta.'];
  notify('item/completed', { threadId: id, turnId: active.id, item: reasoning });
  const answer = agentItem('stream-answer', 'Stream prefix');
  active.items.push(answer);
  notify('item/started', { threadId: id, turnId: active.id, item: answer });
  const delta = ' with an actual protocol delta and **Markdown**.';
  notify('item/agentMessage/delta', { threadId: id, turnId: active.id, itemId: answer.id, delta });
  const streamedText = page.locator('p').filter({ hasText: 'Stream prefix with an actual protocol delta and' });
  await streamedText.waitFor();
  assert.ok((await mounted(page)).includes('AdaptiveStreamingMarkdown'));
  await page.screenshot({ path: join(output, 'streaming.png') });
  answer.text = 'Stream prefix' + delta;
  notify('item/completed', { threadId: id, turnId: active.id, item: answer });
  active.status = 'completed';
  thread.status = { type: 'idle' };
  notify('turn/completed', { threadId: id, turn: active });
  notify('thread/status/changed', { threadId: id, status: thread.status });
  await streamedText.hover();
  await page.getByRole('button', { name: 'Copy', exact: true }).last().click();
  await page.waitForFunction(() => navigator.clipboard.readText().then(text => text.includes('Stream prefix with an actual protocol delta') && text.includes('Markdown')));
  checks.push('Actual assistant delta and completion notifications update authored adaptive Markdown and the completed response action row');
  await page.reload({ waitUntil: 'commit' });
  await streamedText.waitFor({ timeout: 60_000 });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const paragraph = [...document.querySelectorAll('p')].find(node => node.textContent?.startsWith('Stream prefix'));
    const rect = paragraph?.getBoundingClientRect();
    return rect != null && rect.x >= 0 && rect.right <= innerWidth;
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, 'reloaded-800.png') });
  await writeFile(join(output, 'final-aria.txt'), await page.locator('body').ariaSnapshot());
  checks.push('The completed protocol data reloads through the same source and retains the original 800px layout');
  await context.close();
  assert.equal(fake.calls('turn/start').length, 0);
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot()).catch(() => {});
  }
  throw error;
} finally {
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, output }));
}
