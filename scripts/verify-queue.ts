// Run under /tmp/agents-workbench-heavy.lock. Uses disposable daemon state only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem, NO_REPLY } from '../test/fake-codex.ts';
import { isolatePublicVerifier, publicVerifierConfigurationFetch } from './public-verifier-environment.ts';

const root = await mkdtemp(join(tmpdir(), 'aw-queue-ui-'));
const output = process.env.AGENTS_QUEUE_EVIDENCE
  ? resolve(process.env.AGENTS_QUEUE_EVIDENCE) : await mkdtemp(join(tmpdir(), 'yard-queue-evidence-'));
await isolatePublicVerifier(root);
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [];
const checks: string[] = [], gaps: string[] = [];
const report: Record<string, unknown> = { renderer: 'owned', realDaemonUsed: false, checks, gaps, errors };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
try {
  const threadId = '00000000-0000-4000-8000-000000000155';
  const unknownThreadId = '00000000-0000-4000-8000-000000000156';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.threads.set(threadId, fixtureThread(threadId, root, { name: '待发消息编辑与删除验收', status: { type: 'active', activeFlags: [] },
    turns: [fixtureTurn('running-turn', [agentItem('running-message', '队列验收正在进行')], 'inProgress')] }));
  const editText = '验收：编辑这条待发消息';
  const deleteText = '验收：删除这条待发消息';
  fake.queues.set(threadId, [editText, deleteText].map((text, index) => ({
    id: 'queue-ui-' + index, input: [{ type: 'text', text, text_elements: [] }], clientUserMessageId: text,
  })));
  fake.threads.set(unknownThreadId, fixtureThread(unknownThreadId, root, { name: '发送回执未知验收' }));
  fake.queues.set(unknownThreadId, [{ id: 'unknown-queue', input: [{ type: 'text', text: '未知回执不得重发', text_elements: [] }],
    clientUserMessageId: 'unknown-queue-message' }]);
  const dataDir = join(root, 'data');
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: publicVerifierConfigurationFetch });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.goto(app.url + '/local/' + threadId, { waitUntil: 'commit' });
  await page.locator('[data-owned-renderer="true"]').waitFor();
  await page.getByText(editText, { exact: true }).waitFor({ timeout: 60000 });
  await capture('before');
  await page.getByRole('button', { name: '删除待发送消息', exact: true }).nth(1).click();
  await page.getByText(deleteText, { exact: true }).waitFor({ state: 'detached' });
  assert.equal(fake.queues.get(threadId)?.length, 1);
  checks.push('Deletion reached thread/queue/delete and removed only the selected item');
  const editButton = page.getByRole('button', { name: '编辑待发送消息', exact: true });
  assert.equal(await editButton.isEnabled(), true, 'Queue Edit requires the main-composer and Yard queue-edit bindings');
  await editButton.click();
  const editor = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作)$/ });
  const queue = page.getByRole('region', { name: '待发送消息', exact: true });
  await page.waitForFunction(text => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
      .some(input => ['和 Codex 一起工作', '与 Codex 协作'].includes(input.getAttribute('aria-label') ?? '') && input.value === text), editText);
  await capture('editing');
  const changed = '验收：修改后重新排队';
  assert.equal(await editor.inputValue(), editText);
  assert.equal(fake.queues.get(threadId)?.length, 0);
  assert.equal(fake.calls('thread/queue/update').length, 0);
  await editor.fill(changed);
  await page.getByRole('button', { name: /^(排队|Queue)$/ }).click();
  await fake.waitFor(message => message.method === 'thread/queue/add');
  checks.push('Editing moves the original item into the composer and requeues it');
  await queue.getByText(changed, { exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
    .some(input => ['和 Codex 一起工作', '与 Codex 协作'].includes(input.getAttribute('aria-label') ?? '') && input.value === ''));
  assert.deepEqual(fake.queues.get(threadId)?.[0]?.input, [{ type: 'text', text: changed, text_elements: [] }]);
  const added = '验收：另外排队';
  const addsBefore = fake.calls('thread/queue/add').length;
  await editor.fill(added);
  await page.getByRole('button', { name: /^(排队|Queue)$/ }).click();
  await queue.getByText(added, { exact: true }).waitFor();
  await fake.waitFor(message => message.method === 'thread/queue/add');
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
    .some(input => ['和 Codex 一起工作', '与 Codex 协作'].includes(input.getAttribute('aria-label') ?? '') && input.value === ''));
  for (let attempt = 0; attempt < 100 && (fake.queues.get(threadId)?.length ?? 0) < 2; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(fake.queues.get(threadId)?.[1]?.input, [{ type: 'text', text: added, text_elements: [] }]);
  assert.equal(fake.calls('thread/queue/delete').length, 2);
  assert.equal(fake.calls('thread/queue/add').length, addsBefore + 1);
  assert.equal(fake.calls('turn/start').length, 0);
  checks.push('A separate queued submission uses thread/queue/add and starts no turn');
  await page.locator('.standalone-composer__submit').filter({ hasText: '发送到当前任务' }).waitFor();
  const keyboardText = '验收：快捷键排队';
  await editor.fill(keyboardText);
  await editor.press('Control+Enter');
  await queue.getByText(keyboardText, { exact: true }).waitFor();
  assert.equal(fake.calls('thread/queue/add').length, addsBefore + 2);
  assert.deepEqual(fake.queues.get(threadId)?.[2]?.input, [{ type: 'text', text: keyboardText, text_elements: [] }]);
  assert.equal(fake.calls('turn/start').length, 0);
  assert.equal(fake.calls('turn/steer').length, 0);
  checks.push('Ctrl+Enter queues through the real composer without starting a model turn');
  const writesBeforeReload = fake.messages.filter(message => ['thread/queue/add', 'thread/queue/update', 'thread/queue/delete'].includes(message.method ?? '')).length;
  await page.reload({ waitUntil: 'commit' });
  await queue.getByText(changed, { exact: true }).waitFor({ timeout: 60000 });
  await queue.getByText(added, { exact: true }).waitFor();
  await queue.getByText(keyboardText, { exact: true }).waitFor();
  assert.equal(fake.messages.filter(message => ['thread/queue/add', 'thread/queue/update', 'thread/queue/delete'].includes(message.method ?? '')).length, writesBeforeReload);
  assert.equal(fake.calls('turn/start').length, 0);
  await capture('after-refresh');
  checks.push('Edited and added entries survive a page reload without replay');
  fake.handlers.set('thread/queue/start', (_params, { socket }) => { socket.terminate(); return NO_REPLY; });
  await page.goto(app.url + '/local/' + unknownThreadId, { waitUntil: 'commit' });
  await page.getByText('未知回执不得重发', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: '立即发送待发送消息', exact: true }).click();
  await fake.waitFor(message => message.method === 'thread/queue/start' && message.params.threadId === unknownThreadId);
  await page.getByText(/发送结果未知.*不会自动重发/).first().waitFor({ timeout: 30000 });
  assert.equal(fake.calls('thread/queue/start').length, 1);
  await capture('unknown-before-reload');
  await page.reload({ waitUntil: 'commit' });
  await page.getByText(/发送结果未知.*不会自动重发/).first().waitFor({ timeout: 60000 });
  assert.equal(fake.calls('thread/queue/start').length, 1, 'Reload must not retry an unknown queue start');
  assert.equal(fake.calls('turn/start').length, 0);
  checks.push('A disconnected unknown queue start remains visible after reload and is never resent');
  assert.deepEqual(errors, []);
  report.queue = fake.queues.get(threadId);
  assert.deepEqual(gaps, [], 'Original queue edit-to-composer behavior is missing');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  report.requests = fake.messages.filter(message => message.method?.startsWith('thread/queue/'));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  console.log('Queue evidence:', output);
}
