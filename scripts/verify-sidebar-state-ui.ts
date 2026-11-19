// Run under /tmp/agents-workbench-heavy.lock. Uses disposable browser/daemon state.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { record } from '../src/native/protocol.ts';

const root = await mkdtemp('/tmp/yard-sidebar-state-');
const output = resolve(process.env.AGENTS_SIDEBAR_STATE_UI_EVIDENCE ?? '.local/sidebar-state-ui-verification');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [], checks: string[] = [], consoleMessages: string[] = [], nonLocalProtocolMessages: unknown[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', peer: 'disposable 0.164.0 protocol fixture',
  realDaemonUsed: false, errors, checks, consoleMessages, nonLocalProtocolMessages };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
async function eventually(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(50);
  }
  assert.ok(predicate(), message);
}
try {
  const nativeThreadId = '00000000-0000-4000-8000-000000000188';
  const legacyThreadId = '00000000-0000-4000-8000-000000000189';
  const nativeName = 'Native backend section', legacyName = 'Legacy group migration';
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
  fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
  fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), approvalsReviewer: 'user',
    activePermissionProfile: null, turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  const nativeSection = { id: '00000000-0000-4000-8000-000000000288', name: nativeName, appearance: null };
  fake.sections.set(nativeSection.id, nativeSection);
  fake.sectionMembers.set(nativeSection.id, [nativeThreadId]);
  fake.threads.set(nativeThreadId, fixtureThread(nativeThreadId, root, { name: 'Native section member', section: nativeSection,
    turns: [fixtureTurn('fixture-completed-turn', [agentItem('fixture-completed-message', 'Ready for native sidebar verification')])] }));
  fake.threads.set(legacyThreadId, fixtureThread(legacyThreadId, root, { name: 'Imported group member' }));
  const dataDir = join(root, 'data');
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT,
    join(dataDir, 'configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for sidebar fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ legacyThreadId, legacyName }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('yard-sidebar-state-seeded')) return;
    localStorage.setItem('yard-sidebar-state-seeded', 'true');
    localStorage.setItem('native-atoms', JSON.stringify({ 'sidebar-custom-sections-v3': { '': {
      sections: [{ id: 'old-browser-group', name: legacyName, itemKeys: ['codex:thread:local:' + legacyThreadId] }],
      collapsedSectionIds: [], sectionOrder: ['custom:old-browser-group', 'threads'], threadHostIds: { [legacyThreadId]: 'local' },
    } } }));
  }, { legacyThreadId, legacyName });
  page = await context.newPage();
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try {
      const message = record(JSON.parse(String(payload)));
      if (message.hostId && message.hostId !== 'local' && nonLocalProtocolMessages.length < 10) nonLocalProtocolMessages.push(message);
    } catch { /* Only inspect protocol JSON frames. */ }
  }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(message.text()); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + nativeThreadId), { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Native section member', exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 60000 });
  await capture('loaded');
  assert.deepEqual(errors, []);
  checks.push('Fixed renderer starts without page errors using the complete native sections service');
  await fake.waitFor(message => message.method === 'thread/section/move' && message.params.threadId === legacyThreadId, 15000);
  for (let attempt = 0; fake.threads.get(legacyThreadId)?.section == null && attempt < 100; attempt++) await delay(50);
  const migrated = [...fake.sections.values()].find(section => section.name === legacyName);
  assert.ok(migrated);
  assert.equal(record(fake.threads.get(legacyThreadId)?.section).id, migrated.id);
  assert.equal(fake.calls('threadSection/create').length, 1);
  checks.push('Old browser group migrates to native section and thread membership exactly once');
  await page.getByRole('button', { name: nativeName, exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: legacyName, exact: true }).waitFor({ timeout: 15000 });
  checks.push('Existing native groups and imported groups are visible in the sidebar');
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('button', { name: nativeName, exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: legacyName, exact: true }).waitFor();
  // The sidebar can paint before the conversation takes over. Its initial
  // mount replaces open menus, so await the workspace before menu actions.
  await page.locator('main').getByRole('textbox').waitFor({ timeout: 60000 });
  assert.equal(fake.calls('threadSection/create').length, 1);
  await delay(250);
  assert.equal(fake.calls('thread/section/move').length, 1, 'Restoring the native projection must not replay migration moves');
  const atoms = await page.evaluate(() => JSON.parse(localStorage.getItem('native-atoms') || '{}'));
  assert.equal(atoms['sidebar-custom-sections-v3'], undefined);
  checks.push('Reload reconstructs native group state without recreating it or retaining a browser copy');
  await capture('reloaded');
  await page.getByRole('button', { name: /^(?:Chat sidebar options|聊天侧边栏选项)$/ }).press('Enter');
  await capture('options');
  const create = page.getByRole('menuitem', { name: /^(?:New section|新建分区)$/ });
  assert.equal(await create.count(), 1, 'The native create-section command must be available with API key authentication');
  await create.click();
  const groupName = 'Created through native UI';
  await page.getByRole('textbox', { name: /^(?:Section name|分区名称)$/ }).fill(groupName);
  await page.getByRole('button', { name: /^(?:Create section|创建分区)$/ }).click();
  await eventually(() => [...fake.sections.values()].some(section => section.name === groupName), 'Native UI create did not reach the backend');
  const created = [...fake.sections.values()].find(section => section.name === groupName)!;
  await page.getByRole('button', { name: groupName, exact: true }).waitFor();
  checks.push('Creating a group through the existing dialog creates one native backend section');

  const rows = () => page!.locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]');
  async function moveThread(name: string, id: string) {
    await rows().filter({ hasText: name }).first().click({ button: 'right' });
    await page!.getByRole('menuitem', { name: /^(?:Section|Move to section|分区|移至分区)$/ }).click();
    await page!.getByRole('menuitemcheckbox', { name: groupName, exact: true }).click();
    await eventually(() => record(fake.threads.get(id)?.section).id === created.id, 'Native UI move did not reach the backend');
  }
  await moveThread('Native section member', nativeThreadId);
  await moveThread('Imported group member', legacyThreadId);
  checks.push('Existing context-menu actions move both native and migrated members into the backend section');

  const beforePinMembers = [...fake.sectionMembers.get(String(created.id))!];
  await rows().filter({ hasText: 'Native section member' }).first().click({ button: 'right' });
  await capture('pin-options');
  await page.getByRole('menuitem', { name: /^(?:Pin(?: chat)?|置顶(?:聊天|对话)?)$/ }).click();
  await eventually(() => {
    const id = record(fake.threads.get(nativeThreadId)?.section).id;
    return typeof id === 'string' && id !== created.id;
  }, 'Pinning a section member did not reach the native pinned section');
  // The pinned renderer registers app Undo as Ctrl+Z; it does not show a
  // transient Undo button for pin actions. Keep focus outside the composer.
  await page.getByRole('button', { name: 'Native section member', exact: true }).first().focus();
  await page.keyboard.press('Control+z');
  await eventually(() => JSON.stringify(fake.sectionMembers.get(String(created.id))) === JSON.stringify(beforePinMembers),
    'Undoing a pin did not restore the original custom group and position');
  checks.push('Pinning then undoing restores the native custom group and its original member position');

  const initialMembers = [...fake.sectionMembers.get(String(created.id))!];
  assert.equal(initialMembers.length, 2);
  const firstName = initialMembers[0] === nativeThreadId ? 'Native section member' : 'Imported group member';
  const lastName = initialMembers[1] === nativeThreadId ? 'Native section member' : 'Imported group member';
  const source = rows().filter({ hasText: lastName }).first(), target = rows().filter({ hasText: firstName }).first();
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox(), to = await target.boundingBox();
  assert.ok(from && to);
  report.beforeReorder = initialMembers;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 15 });
  await page.mouse.up();
  await eventually(() => JSON.stringify(fake.sectionMembers.get(String(created.id))) === JSON.stringify([...initialMembers].reverse()),
    'Dragging group members did not reorder their native backend membership');
  checks.push('Dragging group members reorders native backend membership');
  await capture('reordered');

  await page.getByRole('button', { name: new RegExp('^(?:Options for ' + groupName + '|' + groupName + ' 的选项)$') }).press('Enter');
  await page.getByRole('menuitem', { name: /^(?:Edit|编辑)$/ }).click();
  const renamed = 'Renamed through native UI';
  await page.getByRole('textbox', { name: /^(?:Section name|分区名称)$/ }).fill(renamed);
  await page.getByRole('button', { name: /^(?:Save|保存)$/ }).click();
  await eventually(() => fake.sections.get(String(created.id))?.name === renamed, 'Native UI rename did not reach the backend');
  await page.getByRole('button', { name: renamed, exact: true }).waitFor();
  checks.push('Renaming a group updates its native backend section');

  await page.getByRole('button', { name: new RegExp('^(?:Options for ' + renamed + '|' + renamed + ' 的选项)$') }).press('Enter');
  await page.getByRole('menuitem', { name: /^(?:Remove section|移除分区)$/ }).click();
  await eventually(() => !fake.sections.has(String(created.id)), 'Native UI delete did not reach the backend');
  assert.equal(fake.threads.size, 2);
  assert.equal(fake.threads.get(nativeThreadId)?.section, null);
  assert.equal(fake.threads.get(legacyThreadId)?.section, null);
  await page.reload({ waitUntil: 'commit' });
  // Await an original sidebar heading before checking absence: the startup
  // layer mounts after navigation commit and also temporarily hides the root.
  await page.getByRole('button', { name: nativeName, exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 60000 });
  await rows().filter({ hasText: 'Native section member' }).first().waitFor();
  await rows().filter({ hasText: 'Imported group member' }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: renamed, exact: true }).count(), 0);
  assert.equal(fake.calls('threadSection/create').length, 2);
  assert.ok(fake.calls('thread/section/move').length <= 20, 'Native UI actions must settle without a migration write loop');
  checks.push('Deleting a group preserves its threads and does not recreate the group after reload');
  await capture('deleted');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  report.startup = await page?.evaluate(() => ({ marks: performance.getEntriesByType('mark').map(entry => ({ name: entry.name, at: entry.startTime })),
    startup: document.getElementById('yard-startup')?.textContent, root: document.getElementById('root')?.textContent?.slice(0, 4000) })).catch(() => null);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  report.nativeSections = [...fake.sections.values()];
  report.requests = fake.messages.filter(message => message.method?.startsWith('threadSection/') || message.method === 'thread/section/move');
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  console.log('Sidebar state evidence:', output);
}
