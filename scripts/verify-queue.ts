// Run under /tmp/agents-workbench-heavy.lock. Uses disposable daemon state only.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { composerInput } from '../src/workspace/composer-input.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/aw-queue-ui-');
const sourceWorkspace = process.argv.includes('--source');
const mobile = process.argv.includes('--mobile');
const output = resolve(process.env.AGENTS_QUEUE_EVIDENCE ?? '.local/queue-verification');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', sourceWorkspace, mobile, realDaemonUsed: false, errors };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
}
try {
  const threadId = '00000000-0000-4000-8000-000000000155';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), approvalsReviewer: 'user',
    activePermissionProfile: null, turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.handlers.set('thread/fork', params => {
    const result = fake.defaultResult('thread/fork', params);
    if (!params.attachToSource) return result;
    const id = String(record(result.thread).id);
    const thread = { ...fake.threads.get(id)!, attachedToThreadId: String(params.threadId), turns: [] };
    fake.threads.set(id, thread);
    return { ...result, thread };
  });
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
    sourceWorkspace,
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for queue fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + (sourceWorkspace ? '/local/' + threadId : '/?initialRoute=' + encodeURIComponent('/local/' + threadId)), { waitUntil: 'commit' });
  await page.getByText(editText, { exact: true }).waitFor({ timeout: 60000 });
  if (mobile) {
    const preview = await page.getByRole('group', { name: new RegExp(editText) }).boundingBox();
    assert.ok(preview && preview.x >= 0 && preview.x + preview.width <= 390, 'Queued message fits the mobile viewport.');
  }
  await capture('before');
  const editor = page.getByRole('textbox', { name: /^(?:和 Codex 一起工作|Work with Codex)$/ });
  await editor.fill('Unsent follow-up');
  await capture('active-draft');
  await editor.fill('');
  await page.getByRole('button', { name: /^(?:删除排队的消息|Delete queued message)$/ }).nth(1).click();
  await page.getByText(deleteText, { exact: true }).waitFor({ state: 'detached' });
  assert.equal(fake.queues.get(threadId)?.length, 1);
  await page.getByRole('button', { name: /^(?:排队消息操作|Queued message actions)$/ }).click();
  await capture('edit-menu');
  await page.getByRole('menuitem', { name: /^(?:编辑|Edit)/ }).click();
  await editor.getByText(editText, { exact: true }).waitFor();
  assert.equal(fake.queues.get(threadId)?.length, 0);
  await capture('editing');
  const changed = '验收：修改后重新排队';
  await editor.fill(changed);
  await page.getByRole('button', { name: /^(?:排队|Queue)$/ }).click();
  await page.getByRole('group', { name: new RegExp(changed) }).waitFor();
  await fake.waitFor(message => message.method === 'thread/queue/add');
  await page.getByRole('status').filter({ hasText: /^(?:正在发送|Sending)$/ }).waitFor({ state: 'detached' });
  assert.deepEqual(fake.queues.get(threadId)?.[0]?.input, [{ type: 'text', text: sourceWorkspace ? changed : changed + '\n', text_elements: [] }]);
  assert.equal(fake.calls('thread/queue/delete').length, 2);
  assert.equal(fake.calls('thread/queue/add').length, 1);
  assert.equal(fake.calls('turn/start').length, 0);
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('group', { name: new RegExp(changed) }).waitFor({ timeout: 60000 });
  await capture('after-refresh');
  if (sourceWorkspace && !mobile) {
    const composer = page.locator('[data-composer-placement="thread"]').first();
    const buttons = composer.getByRole('button', { name: 'Queued message actions', exact: true });
    await buttons.click();
    await composer.getByRole('menuitem', { name: 'Turn on queueing', exact: true }).click();
    await editor.fill('Keep this message behind the active turn');
    await composer.getByRole('button', { name: 'Queue', exact: true }).click();
    const row = composer.locator('.yard-source-queued-row');
    const newest = row.filter({ hasText: 'Keep this message behind the active turn' });
    await newest.waitFor();
    await newest.dragTo(row.first());
    await fake.waitForCall('thread/queue/reorder');
    await page.waitForFunction(expected => document.querySelector('.yard-source-queued-row')?.textContent?.includes(expected),
      'Keep this message behind the active turn');
    const sent = fake.queues.get(threadId)![0]!;
    await newest.getByRole('button', { name: 'Steer', exact: true }).click();
    await newest.waitFor({ state: 'detached' });
    assert.deepEqual(fake.calls('turn/steer').at(-1)?.params, {
      threadId, expectedTurnId: 'running-turn', input: sent.input, clientUserMessageId: sent.clientUserMessageId,
    });
    await buttons.click();
    await composer.getByRole('menuitem', { name: 'Turn off queueing', exact: true }).click();
    await editor.fill('Steer directly from the composer');
    await composer.getByRole('button', { name: 'Steer', exact: true }).last().click();
    await fake.waitForCall('turn/steer', 2);
    assert.equal(fake.calls('turn/start').length, 0, 'The active turn is not interrupted by a follow-up.');
    await buttons.click();
    await composer.getByRole('menuitem', { name: 'Open in side chat', exact: true }).click();
    const moved = await fake.waitFor(message => message.method === 'turn/start' && message.params.threadId !== threadId);
    assert.deepEqual(moved.params.input, [{ type: 'text', text: changed, text_elements: [] }]);
    await composer.getByRole('group', { name: new RegExp(changed) }).waitFor({ state: 'detached' });
    const pausedText = 'Resume this message after interrupting';
    fake.queues.set(threadId, [{ id: 'paused-message', input: [{ type: 'text', text: pausedText, text_elements: [] }], clientUserMessageId: 'paused-message' }]);
    const prior = fake.threads.get(threadId)!;
    const interrupted = { ...prior.turns[0]!, status: 'interrupted' as const };
    fake.threads.set(threadId, { ...prior, status: { type: 'idle' }, turns: [interrupted] });
    fake.broadcast({ method: 'turn/completed', params: { threadId, turn: interrupted } });
    fake.broadcast({ method: 'thread/queue/changed', params: { threadId } });
    await composer.getByText('Queue paused because you interrupted', { exact: true }).waitFor();
    await capture('paused');
    await composer.getByRole('button', { name: 'Resume', exact: true }).click();
    await fake.waitFor(message => message.method === 'thread/queue/start' && message.params.queuedSubmissionId === 'paused-message');
    await composer.getByRole('group', { name: new RegExp(pausedText) }).waitFor({ state: 'detached' });
    const attachmentName = 'queue-draft-fixture.txt';
    const attachmentPath = join(root, attachmentName);
    await writeFile(attachmentPath, 'An attachment to restore in the editor.');
    fake.queues.set(threadId, [{ id: 'with-file', clientUserMessageId: 'with-file',
      input: [...composerInput('This draft includes a file', [{ name: attachmentName, path: attachmentPath, image: false }])],
    }]);
    fake.broadcast({ method: 'thread/queue/changed', params: { threadId } });
    await buttons.click();
    await composer.getByRole('menuitem', { name: 'Edit message', exact: true }).click();
    const removeFile = composer.getByRole('button', { name: 'Remove ' + attachmentName, exact: true });
    await removeFile.waitFor();
    await page.reload({ waitUntil: 'commit' });
    await removeFile.waitFor();
    assert.equal(await composer.getByRole('textbox', { name: 'Work with Codex', exact: true }).textContent(), 'This draft includes a file');
    await removeFile.click();
    await page.reload({ waitUntil: 'commit' });
    await composer.getByText('This draft includes a file', { exact: true }).waitFor();
    assert.equal(await removeFile.count(), 0);
  }
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
