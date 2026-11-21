import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';
import type { AutomationRun } from '../src/native/automations.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem, NO_REPLY } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-schedule-ui-'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_AUTOMATIONS_EVIDENCE ?? '.local/automations-ui');
const sourceWorkspace = process.argv.includes('--source-workspace');
let documentId: string;
await mkdir(dataDir); await mkdir(output, { recursive: true });
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Schedule project', path: root }]));
const fake = await createFakeCodex(root);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('experimentalFeature/list', () => ({ data: [], nextCursor: null }));
fake.handlers.set('turn/start', params => {
  const result = fake.defaultResult('turn/start', params);
  const thread = fake.threads.get(String(params.threadId))!;
  thread.turns[0].status = 'completed'; thread.turns[0].items.push(agentItem('scheduled-answer', 'SCHEDULE_STANDALONE_OK'));
  thread.status = { type: 'idle' }; return { ...result, turn: thread.turns[0] };
});
fake.threads.set('00000000-0000-4000-8000-000000000001', fixtureThread('00000000-0000-4000-8000-000000000001', root, { name: 'Schedule fixture',
  turns: [fixtureTurn('previous', [agentItem('previous-answer', 'Schedule fixture response')])] }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: process.env.AGENTS_TEST_CODEX_SOCKET ?? fake.socketPath,
  codexHome: process.env.AGENTS_TEST_CODEX_HOME ?? join(root, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} },
  sourceWorkspace, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = process.env.AGENTS_TEST_BROWSER_WS ? await chromium.connect(process.env.AGENTS_TEST_BROWSER_WS)
  : await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [], report: Record<string, unknown> = { errors, realCli: !!process.env.AGENTS_TEST_CODEX_SOCKET, sourceWorkspace };
const calls: unknown[] = [], requestIds = new Set<string>();
page.on('websocket', socket => {
  socket.on('framesent', frame => { const message = JSON.parse(String(frame.payload));
    if (message.type === 'fetch' && /automation|inbox/.test(message.url)) { requestIds.add(message.requestId); calls.push(message); } });
  socket.on('framereceived', frame => { const message = JSON.parse(String(frame.payload)); if (requestIds.has(message.requestId)) calls.push(message); });
});
page.on('pageerror', error => errors.push(error.message));
try {
  if (sourceWorkspace) {
    const startingConversation = process.env.AGENTS_TEST_CODEX_SOCKET
      ? (await app.control.request<{ thread: { id: string } }>('thread/start', { cwd: root, historyMode: 'paginated' })).thread.id
      : '00000000-0000-4000-8000-000000000001';
    const initial = app.url + '/local/' + startingConversation;
    const editor = page.locator('[data-codex-composer="true"][contenteditable="true"]').first();
    await page.goto(initial, { waitUntil: 'commit' });
    await editor.fill('Conversation draft while managing schedules');
    documentId = await page.evaluate(() => { const id = crypto.randomUUID(); Object.assign(window, { scheduleDocumentId: id }); return id; });
    await page.screenshot({ path: join(output, 'source-sidebar.png') });
    await page.getByRole('link', { name: 'Scheduled', exact: true }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).waitFor({ timeout: 45_000 });
    assert.equal(await page.evaluate(() => (window as unknown as { scheduleDocumentId: string }).scheduleDocumentId), documentId);
    await page.goBack();
    assert.equal(await editor.textContent(), 'Conversation draft while managing schedules');
    report.sidebarScheduled = true;
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('combobox').fill('Go to scheduled tasks');
    await page.getByRole('option', { name: 'Go to scheduled tasks' }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).waitFor({ timeout: 45_000 });
    await page.goBack();
    assert.equal(await editor.textContent(), 'Conversation draft while managing schedules');
    await page.goForward();
    assert.equal(await page.evaluate(() => (window as unknown as { scheduleDocumentId: string }).scheduleDocumentId), documentId);
    report.draftPreserved = true;
  } else await page.goto(app.url + '/?initialRoute=%2Fautomations', { waitUntil: 'commit' });
  await page.getByRole('button', { name: /^(Create|创建)$/ }).first().waitFor({ timeout: 45000 });
  await writeFile(join(output, 'initial.txt'), await page.locator('body').ariaSnapshot());
  if (sourceWorkspace) await page.getByRole('button', { name: 'Create', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Create scheduled task options' }).click();
    await page.getByRole('menuitem', { name: 'Set up manually' }).click();
  }
  await page.getByTestId('automation-title-input').waitFor({ timeout: 10000 });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Independent review fixture');
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Reply with SCHEDULE_STANDALONE_OK.');
  if (sourceWorkspace) await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'Schedule project' });
  else {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Schedule project' }).click();
  const model = page.getByRole('button', { name: 'Model', exact: true });
  if ((await model.innerText()).includes('Select model')) {
    await model.click();
    await page.getByRole('menuitem').first().click();
  }
  }
  await page.getByRole('button', { name: 'Create', exact: true }).last().click();
  await page.getByText('Independent review fixture', { exact: true }).first().waitFor({ timeout: 10000 });
  const saved = await app.automations.fetch('list-automations', {}) as {
    items: { id: string; name: string; target: { type: string; projectId: string }; hostId: string; cwds: string[] }[];
  };
  assert.equal(saved.items.length, 1); assert.equal(saved.items[0].name, 'Independent review fixture');
  const nativeProject = [...fake.projects.values()].find(project => project.name === 'Schedule project');
  assert.equal(saved.items[0].target.type, 'project');
  if (nativeProject) assert.equal(saved.items[0].target.projectId, nativeProject.id);
  assert.equal(saved.items[0].hostId, 'local');
  assert.deepEqual(saved.items[0].cwds, [root]);
  report.created = saved.items[0];
  await page.getByRole('button', { name: 'Scheduled task actions', exact: true }).last().click();
  await page.getByRole('menuitem', { name: 'Run now', exact: true }).click();
  let run: AutomationRun | undefined;
  for (let i = 0; i < 100; i++) {
    await app.automations.tick();
    run = (await app.automations.fetch('automation-runs', {}) as { items: AutomationRun[] }).items[0];
    if (run?.status === 'completed') break;
    await delay(100);
  }
  assert.equal(run?.status, 'completed'); report.run = run;
  await page.getByRole('button', { name: 'Pause scheduled task', exact: true }).click();
  await page.getByRole('button', { name: 'Resume scheduled task', exact: true }).waitFor({ timeout: 10000 });
  const paused = (await app.automations.fetch('list-automations', {}) as { items: { status: string }[] }).items[0];
  assert.equal(paused.status, 'PAUSED');
  const runRows = page.getByRole('listitem').getByRole('button', { name: /^Independent review fixture / });
  await writeFile(join(output, 'create.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, 'create.png') });
  if (!process.env.AGENTS_TEST_CODEX_SOCKET) {
    fake.handlers.set('thread/start', (_params, { socket }) => { socket.close(); return NO_REPLY; });
    await page.getByRole('button', { name: 'Scheduled task actions', exact: true }).last().click();
    await page.getByRole('menuitem', { name: 'Run now', exact: true }).click();
    let uncertain: AutomationRun | undefined;
    for (let i = 0; i < 100; i++) {
      uncertain = (await app.automations.fetch('automation-runs', {}) as { items: AutomationRun[] }).items[0];
      if (uncertain?.status === 'uncertain') break;
      await delay(100);
    }
    assert.equal(uncertain?.status, 'uncertain');
    await page.getByRole('button', { name: '核查后解除', exact: true }).click();
    await page.getByText('本次未取得会话 ID，请先检查近期会话。', { exact: false }).waitFor();
    await page.screenshot({ path: join(output, 'recovery.png') });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    if (sourceWorkspace) {
      await page.getByRole('button', { name: '核查后解除', exact: true }).click();
      await page.getByRole('button', { name: '已核查，解除阻塞', exact: true }).click();
      await page.getByText('结果未知，已解除', { exact: false }).waitFor({ timeout: 10000 });
    } else {
    // Exercise the pinned history component's existing result-card branch in
    // the editor fixture, without enabling unrelated cloud task feature gates.
    const details = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    details.on('pageerror', error => errors.push(error.message));
    await details.route('**/automations-page-cf5a9694ba8a.js', async route => {
      const response = await route.fetch(), source = await response.text();
      const history = 'Ec,{automation:l,formatRootLabel:u}';
      assert.equal(source.split(history).length, 2);
      await route.fulfill({ response, body: source.replace(history, 'Ec,{automation:l,formatRootLabel:u,showRunDetails:!0}') });
    });
    await details.goto(app.url + '/?initialRoute=%2Fautomations');
    await details.getByRole('button', { name: 'Paused', exact: true }).click();
    await details.getByRole('main').getByRole('button', { name: 'Independent review fixture', exact: true }).click();
    const recovery = details.getByRole('button', { name: '核查后解除', exact: true });
    await recovery.waitFor({ timeout: 15000 }).catch(async error => {
      await writeFile(join(output, 'details-failure.txt'), await details.locator('body').ariaSnapshot());
      await details.screenshot({ path: join(output, 'details-failure.png') }); throw error;
    });
    await writeFile(join(output, 'details.txt'), await details.locator('body').ariaSnapshot());
    assert.equal(await recovery.count(), 1, 'one recovery action per full result card');
    assert.equal(await details.getByText('与现有 Codex 的连接已断开。', { exact: true }).count(), 1, 'one error description per full result card');
    await recovery.click();
    await details.screenshot({ path: join(output, 'recovery-details.png') });
    await details.getByRole('button', { name: '已核查，解除阻塞', exact: true }).click();
    await page.getByText('结果未知，已解除', { exact: true }).waitFor({ timeout: 10000 });
    await details.close();
    }
    const released = (await app.automations.fetch('automation-runs', {}) as { items: AutomationRun[] }).items[0];
    assert.equal(released.status, 'released'); report.released = released;
  }
  await runRows.last().click();
  await page.waitForURL(url => decodeURIComponent(url.href).includes(run!.threadId!), { timeout: 10000 });
  await page.getByText('SCHEDULE_STANDALONE_OK', { exact: true }).first().waitFor({ timeout: 10000 });
  if (sourceWorkspace) await page.locator('.yard-source-frame').waitFor();
  if (sourceWorkspace) {
    assert.equal(await page.evaluate(() => (window as unknown as { scheduleDocumentId: string }).scheduleDocumentId), documentId!);
    report.noDocumentReload = true;
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
    assert.ok(!scripts.some(name => /(?:workbench-pinned-entry|app-initial-|automations-page-).*\.js(?:$|\?)/.test(name)));
  }
  report.chatUrl = page.url();
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  report.resources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('app-initial'))).catch(() => []);
  report.rpc = fake.messages.filter(m => /experimentalFeature|account|Auth/.test(m.method ?? ''));
  report.url = page.url();
  report.calls = calls;
  report.tasks = await app.automations.fetch('list-automations', {});
  await page.screenshot({ path: join(output, 'failure.png') });
  await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  process.exitCode = 1;
} finally {
  report.status = await fetch(app.url + '/api/status').then(r => r.json());
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
