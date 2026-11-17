// Run under /tmp/agents-workbench-heavy.lock after building; all state is disposable.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { CodexConnection } from '../lib/codex.ts';
import type { createSshProxyStream } from '../src/native/ssh.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-host-preferences-');
const output = resolve(process.env.AGENTS_PREFERENCES_EVIDENCE ?? '.local/host-preferences');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(output, { recursive: true });
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
const sshConfigPath = join(root, 'ssh-config');
await writeFile(sshConfigPath, 'Host fixture-alias\n  HostName fixture.example\n');
const fake = await createFakeCodex(root);
const id = process.env.AGENTS_TEST_THREAD_ID ?? '00000000-0000-4000-8000-000000000001';
const name = 'SSH and pin fixture';
fake.threads.set(id, fixtureThread(id, root, { name, model: 'gpt-6-sol', turns: [fixtureTurn('fixture-turn', [
  { id: 'fixture-user', type: 'userMessage', clientId: null, content: [{ type: 'text', text: 'Preference test', text_elements: [] }] },
  agentItem('fixture-answer', 'Preference test response'),
])] }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
const sshTargets: string[] = [];
const sshStream: typeof createSshProxyStream = (host, onPaths) => {
  sshTargets.push(host.sshHost);
  onPaths?.({ homeDirectory: root, codexHome: join(root, 'codex') });
  return createConnection(process.env.AGENTS_TEST_CODEX_SOCKET ?? fake.socketPath);
};
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root,
  socketPath: process.env.AGENTS_TEST_CODEX_SOCKET ?? fake.socketPath,
  codexHome: process.env.AGENTS_TEST_CODEX_HOME ?? join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, sshConfigPath, sshStream,
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const inspection = new CodexConnection(process.env.AGENTS_TEST_CODEX_SOCKET ?? fake.socketPath);
await inspection.connect();
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: '26.1013.40934', realDaemonUsed: !!process.env.AGENTS_TEST_CODEX_SOCKET, sshTransport: 'loopback test stream' };
let page: Page | undefined;
async function pins() {
  try { return JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')).globals['pinned-thread-ids'] ?? []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(10000);
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
  const row = page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: name }).first();
  await row.waitFor({ timeout: 60000 });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(Pin|Pin thread|Pin chat|置顶|置顶聊天)$/ }).click();
  await assertEventually(async () => (await pins()).includes(id), 'Pin action must persist');
  await page.reload({ waitUntil: 'commit' });
  await row.waitFor({ timeout: 60000 });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(Unpin|Unpin thread|Unpin chat|取消置顶|取消置顶聊天)$/ }).waitFor();
  await page.screenshot({ path: join(output, 'pinned-after-reload.png') });
  checks.push('The original sidebar pins a chat and retains its pin after reload');
  await page.getByRole('menuitem', { name: /^(Unpin|Unpin thread|Unpin chat|取消置顶|取消置顶聊天)$/ }).click();
  await assertEventually(async () => !(await pins()).includes(id), 'Unpin action must persist');
  checks.push('The original sidebar unpins the same chat');

  await row.hover();
  await row.getByRole('button', { name: /^(Archive chat|归档聊天)$/ }).click();
  if (process.env.AGENTS_LIFECYCLE_ACTIVE === '1') {
    await page.getByRole('button', { name: /^(Stop and archive|停止并归档)$/ }).click();
    checks.push('A running chat asks for confirmation before it is stopped and archived');
  }
  await assertEventually(async () => (await inspection.request('thread/list', { archived: true, limit: 100 })).data.some(thread => thread.id === id),
    'Sidebar archive must reach the daemon and persist');
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/archive'), { waitUntil: 'commit' });
  await page.getByText(name, { exact: true }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: join(output, 'archived-after-reload.png') });
  checks.push('The original sidebar archives the chat in the daemon and the archive page retains it after reload');
  await page.getByRole('button', { name: /^(Unarchive|取消归档|取消归档聊天)$/ }).click();
  await assertEventually(async () => (await inspection.request('thread/list', { archived: false, limit: 100 })).data.some(thread => thread.id === id),
    'Unarchive must restore the chat in the daemon');
  if (process.env.AGENTS_LIFECYCLE_ACTIVE === '1') {
    const { thread } = await inspection.request('thread/read', { threadId: id, includeTurns: true });
    assert.equal(thread.turns.at(-1)?.status, 'interrupted', 'Archiving a running chat must stop its turn');
  }
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
  await row.waitFor({ timeout: 60000 });
  await page.screenshot({ path: join(output, 'restored-chat.png') });
  checks.push('The original archive page restores the chat to the sidebar');

  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/settings/connections/ssh'), { waitUntil: 'commit' });
  await page.getByRole('button', { name: /^(添加|Add)$/ }).last().click({ timeout: 60000 });
  await page.getByRole('dialog').getByText('fixture-alias', { exact: true }).waitFor();
  checks.push('SSH discovery reads the server SSH aliases');
  await page.getByRole('button', { name: /^(手动添加|Add manually)$/ }).click();
  await page.getByLabel(/^(显示名称|Display name)$/).fill('Manual fixture');
  await page.getByLabel(/^(主机名|Hostname|Host)$/).fill('fixture.example');
  await page.getByRole('button', { name: /^(保存|Save)$/ }).click();
  await page.getByText('Manual fixture', { exact: true }).first().waitFor();
  await assertEventually(async () => sshTargets.includes('fixture.example'), 'Saved SSH host must be routable immediately');
  await page.reload({ waitUntil: 'commit' });
  await page.getByText('Manual fixture', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.screenshot({ path: join(output, 'ssh-after-reload.png') });
  checks.push('Manual SSH addition connects through the selected host and survives reload');
  await page.getByRole('button', { name: /^(添加|Add)$/ }).last().click();
  await page.getByRole('checkbox', { name: /^(选择|Select) fixture-alias$/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: /^(添加|Add)$/ }).click();
  await page.getByText('fixture-alias', { exact: true }).first().waitFor();
  await assertEventually(async () => sshTargets.includes('fixture-alias'), 'Discovered alias must use the existing SSH transport');
  checks.push('Selecting a discovered SSH alias saves and connects it');
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('turn/start').length, 0);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); inspection.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}

async function assertEventually(predicate: () => Promise<boolean>, message: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message);
}
