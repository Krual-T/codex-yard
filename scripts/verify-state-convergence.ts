// Run under /tmp/agents-workbench-heavy.lock. Uses a disposable protocol peer.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';
import { record } from '../src/native/protocol.ts';
import type { ObjectValue } from '../src/native/protocol.ts';

const root = await mkdtemp('/tmp/yard-state-ui-');
const output = resolve(process.env.AGENTS_STATE_CONVERGENCE_EVIDENCE ?? '.local/state-convergence-verification');
await mkdir(output, { recursive: true });
const dataDir = join(root, 'data');
await mkdir(dataDir, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', peer: 'disposable 0.164.0 protocol fixture', realDaemonUsed: false, errors };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
try {
  const threadId = '00000000-0000-4000-8000-000000000177';
  const pendingText = '旧兼容队列应进入后台且只接收一次';
  const specialText = '保留带权限设置的真实待发送意图';
  const laterText = '保持特殊设置之后的原始发送顺序';
  const intent = (id: string, text: string) => ({ id, text, context: { prompt: text, addedFiles: [], fileAttachments: [],
    ideContext: null, imageAttachments: [] }, cwd: root, createdAt: 1_700_000_000_000 });
  const localQueue = [{ ...intent('legacy-compatible', pendingText), submissionOptions: { executionHostId: 'local',
    shouldSendPermissionOverrides: false, permissionProfileId: null, serviceTier: null } }, {
    ...intent('legacy-special', specialText), submissionOptions: { executionHostId: 'local', shouldSendPermissionOverrides: true,
      permissionProfileId: null, serviceTier: null },
  }, intent('legacy-after-special', laterText)];
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: { 'queued-follow-ups': { [threadId]: localQueue } }, settings: {} }));
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), approvalsReviewer: 'user',
    activePermissionProfile: null, turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.threads.set(threadId, fixtureThread(threadId, root, { name: '旧持久状态收敛验收', status: { type: 'active', activeFlags: [] },
    turns: [fixtureTurn('running-turn', [agentItem('running-message', '状态迁移验收保持任务进行中')], 'inProgress')] }));
  const attachments = new Map<string, ObjectValue>();
  fake.handlers.set('thread/attachment/list', () => ({ data: [...attachments.values()], nextCursor: null }));
  fake.handlers.set('thread/attachment/add', params => {
    attachments.set(String(params.identityKey), { ...params, createdAt: 1_700_000_001 });
    return { attachment: { ...params, createdAt: 1_700_000_001 } };
  });
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for state fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ threadId, root }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('yard-state-fixture-seeded')) return;
    localStorage.setItem('yard-state-fixture-seeded', 'true');
    localStorage.setItem('native-atoms', JSON.stringify({
      'remote-thread-summaries-v3:ssh-old': [{ conversationId: 'stale', hasUnreadTurn: true }],
      'config-derived-agent-mode-by-host-id': { local: 'read-only' },
      'heartbeat-thread-permissions-by-id': { [threadId]: { sandboxPolicy: { type: 'readOnly' } } },
      'agent-mode-by-host-id': { local: 'read-only' },
      'mcp-global-entrypoints-v2': { old: ['obsolete-tool-projection'] },
      'pull-request-attachment-records-v3': [{ hostId: 'local', conversationId: threadId, attachments: [{
        conversationId: threadId, hostId: 'local', identityKey: '["github.com","fixture","repository",17]',
        url: 'https://github.com/fixture/repository/pull/17', root, headBranch: 'feature', touchedAt: 1_700_000_000_000,
      }] }],
      'pull-request-chat-associations-v2': { fixture: { hostId: 'local', threadId } },
      'pull-request-attachment-backfill-completed-v1': [{ hostId: 'local', conversationId: threadId }],
    }));
    localStorage.setItem('statsig.stable_id.state-fixture', 'state-fixture-stable-id');
    localStorage.setItem('statsig.session_id.state-fixture', '{"sessionID":"state-fixture-session"}');
  }, { threadId, root });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText(pendingText, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText(specialText, { exact: true }).waitFor();
  await page.getByRole('button', { name: /^(?:Change permissions|更改权限)$/ }).getByText(/Full access|完全访问|完全权限/).waitFor();
  await fake.waitFor(message => message.method === 'thread/queue/add' && message.params.clientUserMessageId === 'legacy-compatible', 15000);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('native-atoms') || '{}')['pull-request-attachment-records-v3'] === undefined, undefined, { timeout: 15000 });
  await capture('migrated');
  const state = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8'));
  assert.deepEqual(record(state.globals['queued-follow-ups'])[threadId] && (record(state.globals['queued-follow-ups'])[threadId] as ObjectValue[]).map(item => item.id), ['legacy-special', 'legacy-after-special']);
  assert.equal(fake.calls('thread/queue/add').length, 1);
  assert.equal(fake.calls('turn/start').length, 0);
  assert.equal(fake.calls('thread/attachment/add').length, 1);
  assert.equal(attachments.size, 1);
  const atoms = await page.evaluate(() => JSON.parse(localStorage.getItem('native-atoms') || '{}'));
  assert.equal(atoms['remote-thread-summaries-v3:ssh-old'], undefined);
  assert.equal(atoms['config-derived-agent-mode-by-host-id'], undefined);
  assert.equal(atoms['heartbeat-thread-permissions-by-id'], undefined);
  assert.deepEqual(atoms['agent-mode-by-host-id'], { local: 'read-only' });
  assert.equal(atoms['mcp-global-entrypoints-v2'], undefined);
  assert.ok(atoms['pull-request-chat-associations-v2']);
  assert.ok(atoms['pull-request-attachment-backfill-completed-v1']);
  assert.equal(await page.evaluate(() => localStorage.getItem('statsig.stable_id.state-fixture')), null);
  const identities = await page.evaluate(async () => {
    const request = indexedDB.open('workbench-statsig', 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await Promise.all(['statsig.stable_id.state-fixture', 'statsig.session_id.state-fixture'].map(key => new Promise(resolve => {
        const value = database.transaction('values', 'readonly').objectStore('values').get(key);
        value.onsuccess = () => resolve(value.result);
      })));
    } finally { database.close(); }
  });
  assert.deepEqual(identities, ['state-fixture-stable-id', '{"sessionID":"state-fixture-session"}']);
  await page.reload({ waitUntil: 'commit' });
  await page.getByText(pendingText, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText(specialText, { exact: true }).waitFor();
  await page.getByText(laterText, { exact: true }).waitFor();
  assert.equal(fake.calls('thread/queue/add').length, 1);
  assert.equal(fake.calls('thread/attachment/add').length, 1);
  assert.equal(fake.calls('turn/start').length, 0);
  assert.deepEqual(errors, []);
  await capture('reloaded');
  report.ok = true;
  report.backendQueue = fake.queues.get(threadId);
  report.backendAttachments = [...attachments.values()];
  report.localIntentIds = ['legacy-special', 'legacy-after-special'];
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  report.requests = fake.messages.filter(message => message.method?.startsWith('thread/queue/') || message.method?.startsWith('thread/attachment/'));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  console.log('State convergence evidence:', output);
}
