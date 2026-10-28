// Run under /tmp/agents-workbench-heavy.lock. Uses disposable daemon state only.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/aw-queue-ui-');
const output = resolve(process.env.AGENTS_QUEUE_EVIDENCE ?? '.local/queue-verification');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, errors };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
try {
  const threadId = '00000000-0000-4000-8000-000000000155';
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
  const dataDir = join(root, 'data');
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    // The original coordinator uses these gates before reading thread/queue.
    // Serve a disposable configuration response through the actual host fetch;
    // do not depend on a personal cached configuration or patch React state.
    httpFetch: async input => new URL(String(input)).pathname.endsWith('/initialize')
      ? Response.json({ has_updates: true, time: Date.now(), feature_gates: Object.fromEntries(
        ['1189013788', '2120612410'].map(name => [name, { name, value: true, rule_id: 'queue-fixture', secondary_exposures: [] }]),
      ), dynamic_configs: {}, layer_configs: {} })
      : new Response('External telemetry disabled for queue fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText(editText, { exact: true }).waitFor({ timeout: 60000 });
  await capture('before');
  await page.getByRole('button', { name: /^(删除排队的消息|Delete queued message)$/ }).nth(1).click();
  await page.getByText(deleteText, { exact: true }).waitFor({ state: 'detached' });
  assert.equal(fake.queues.get(threadId)?.length, 1);
  await page.getByRole('button', { name: /^(排队消息操作|Queued message actions)$/ }).click();
  await capture('edit-menu');
  await page.getByRole('menuitem', { name: /^(编辑|Edit)/ }).click();
  const editor = page.getByRole('textbox', { name: /^(和 Codex 一起工作|Work with Codex)$/ });
  await editor.getByText(editText, { exact: true }).waitFor();
  assert.equal(fake.queues.get(threadId)?.length, 0);
  await capture('editing');
  const changed = '验收：修改后重新排队';
  await editor.fill(changed);
  await page.getByRole('button', { name: /^(排队|Queue)$/ }).click();
  await page.getByRole('group', { name: new RegExp(changed) }).waitFor();
  await fake.waitFor(message => message.method === 'thread/queue/add');
  await page.getByRole('status').filter({ hasText: /^(正在发送|Sending)$/ }).waitFor({ state: 'detached' });
  assert.deepEqual(fake.queues.get(threadId)?.[0]?.input, [{ type: 'text', text: changed + '\n', text_elements: [] }]);
  assert.equal(fake.calls('thread/queue/delete').length, 2);
  assert.equal(fake.calls('thread/queue/add').length, 1);
  assert.equal(fake.calls('turn/start').length, 0);
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('group', { name: new RegExp(changed) }).waitFor({ timeout: 60000 });
  await capture('after-refresh');
  assert.deepEqual(errors, []);
  report.queue = fake.queues.get(threadId);
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
