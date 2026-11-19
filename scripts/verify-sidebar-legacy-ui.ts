// Run under /tmp/agents-workbench-heavy.lock. Uses isolated advertised versions,
// synthetic conversations and a loopback SSH stream; no real daemon/account.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-sidebar-legacy-');
const output = resolve(process.env.AGENTS_SIDEBAR_LEGACY_UI_EVIDENCE ?? '.local/sidebar-legacy-ui-verification');
await mkdir(output, { recursive: true });
await mkdir(join(root, 'old'));
const local = await createFakeCodex(root), old = await createFakeCodex(join(root, 'old'));
const oldHost = 'remote-ssh-legacy-fixture';
const localId = '00000000-0000-4000-8000-000000000481';
const oldId = '00000000-0000-4000-8000-000000000482';
const movingId = '00000000-0000-4000-8000-000000000483';
const mixedId = 'mixed-client-group', sourceId = 'legacy-source-group';
const mixedName = 'Mixed native and legacy', renamed = 'Renamed mixed section';
const sourceName = 'Legacy source section', nativeName = 'Native destination section';
const key = (id: string) => 'codex:thread:local:' + id;
const errors: string[] = [], checks: string[] = [], consoleMessages: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', localVersion: '0.164.0', sshVersion: '0.147.0',
  transport: 'disposable protocol fixtures with loopback SSH stream', realDaemonUsed: false, errors, checks, consoleMessages };
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
const dataDir = join(root, 'data');
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
async function eventually(predicate: () => unknown | Promise<unknown>, message: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await delay(50);
  }
  assert.ok(await predicate(), message);
}
async function legacySections() {
  const values = record(await page!.evaluate(() => JSON.parse(localStorage.getItem('native-atoms') || '{}')));
  const account = record(record(values['sidebar-custom-sections-v3'])['yard-app-server']);
  return (Array.isArray(account.sections) ? account.sections : []).map(record);
}
async function persistedPins() {
  const state = record(JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')));
  const pins = record(state.globals)['pinned-thread-ids'];
  // The persistence contract omits an empty legacy array entirely.
  return Array.isArray(pins) ? pins : [];
}
function oldSidebarRequests() {
  return old.messages.filter(message => message.method?.startsWith('project/') || message.method?.startsWith('threadSection/') ||
    message.method?.startsWith('thread/section/'));
}
try {
  for (const [fake, version] of [[local, '0.164.0'], [old, '0.147.0']] as const) {
    fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/' + version + ' (Linux)' }));
    fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
    fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
    fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
    fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), approvalsReviewer: 'user',
      activePermissionProfile: null, turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  }
  for (const method of ['project/list', 'project/create', 'project/import', 'project/update', 'project/move', 'project/delete',
    'threadSection/list', 'threadSection/create', 'threadSection/update', 'threadSection/delete', 'thread/section/move']) {
    old.handlers.set(method, () => { throw Object.assign(new Error('Unsupported by 0.147 fixture: ' + method), { code: -32601 }); });
  }
  local.threads.set(localId, fixtureThread(localId, root, { name: 'Native mixed member',
    turns: [fixtureTurn('native-complete', [agentItem('native-message', 'Ready for mixed-host verification')])] }));
  old.threads.set(oldId, fixtureThread(oldId, root, { name: 'Old host mixed member' }));
  old.threads.set(movingId, fixtureThread(movingId, root, { name: 'Old host moving member' }));
  await mkdir(dataDir);
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {
    'remote-connection-auto-connect-by-host-id': { [oldHost]: true },
  } }));
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: local.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [{ hostId: oldHost, displayName: 'Legacy fixture 0.147', sshAlias: 'legacy-fixture',
      sshHost: 'fixture.invalid', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: root, codexHome: join(root, 'old-codex') }); return createConnection(old.socketPath); },
    httpFetch: async () => new Response('External telemetry disabled for legacy sidebar fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ oldHost, localId, oldId, movingId, mixedId, sourceId, mixedName, sourceName }) => {
    if (window !== window.top || localStorage.getItem('yard-sidebar-legacy-seeded')) return;
    localStorage.setItem('yard-sidebar-legacy-seeded', 'true');
    const key = (id: string) => 'codex:thread:local:' + id;
    localStorage.setItem('native-atoms', JSON.stringify({ 'sidebar-custom-sections-v3': { '': {
      sections: [{ id: mixedId, name: mixedName, itemKeys: [key(localId), key(oldId)], hostSectionIds: { [oldHost]: 'old-mixed-mapping' } },
        { id: sourceId, name: sourceName, itemKeys: [key(movingId)], hostSectionIds: { [oldHost]: 'old-source-mapping' } }],
      collapsedSectionIds: [], sectionOrder: ['custom:' + mixedId, 'custom:' + sourceId, 'threads'],
      threadHostIds: { [localId]: 'local', [oldId]: oldHost, [movingId]: oldHost },
    } } }));
  }, { oldHost, localId, oldId, movingId, mixedId, sourceId, mixedName, sourceName });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(message.text()); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + localId), { waitUntil: 'commit' });
  await page.getByRole('button', { name: mixedName, exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Old host moving member', exact: true }).first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 60000 });
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(host => {
    const supports = (window as unknown as { workbenchSidebarSupportsHost: (host: string) => boolean }).workbenchSidebarSupportsHost;
    return { local: supports('local'), old: supports(host) };
  }, oldHost), { local: true, old: false });
  const nativeMixed = [...local.sections.values()].find(section => section.name === mixedName);
  assert.ok(nativeMixed);
  assert.deepEqual(local.sectionMembers.get(nativeMixed.id), [localId]);
  assert.deepEqual(oldSidebarRequests(), []);
  checks.push('A 0.147 SSH host keeps its browser groups while the local part of a mixed group migrates natively');
  await capture('loaded');
  const rows = () => page!.locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]');
  async function move(name: string, target: string) {
    await rows().filter({ hasText: name }).first().click({ button: 'right' });
    await page!.getByRole('menuitem', { name: /^(?:Section|Move to section|分区|移至分区)$/ }).click();
    await page!.getByRole('menuitemcheckbox', { name: target, exact: true }).click();
  }
  await move('Old host moving member', mixedName);
  await eventually(async () => (await legacySections()).some(section => section.id === mixedId &&
    Array.isArray(section.itemKeys) && section.itemKeys.includes(key(movingId))), 'Moving an old-host thread was not persisted');
  assert.deepEqual(oldSidebarRequests(), []);
  checks.push('Moving a 0.147 thread into a mixed native group persists its client membership without new sidebar RPCs');

  await page.getByRole('button', { name: new RegExp('^(?:Options for ' + mixedName + '|' + mixedName + ' 的选项)$') }).press('Enter');
  await page.getByRole('menuitem', { name: /^(?:Edit|编辑)$/ }).click();
  await page.getByRole('textbox', { name: /^(?:Section name|分区名称)$/ }).fill(renamed);
  await page.getByRole('button', { name: /^(?:Save|保存)$/ }).click();
  await eventually(() => local.sections.get(nativeMixed.id)?.name === renamed, 'Mixed rename did not update the compatible native owner');
  await eventually(async () => (await legacySections()).some(section => section.id === mixedId && section.name === renamed),
    'Mixed rename did not retain the old-host section name');
  assert.deepEqual(oldSidebarRequests(), []);
  checks.push('A mixed-group rename updates the native owner and preserves the legacy name and mapping');
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('button', { name: renamed, exact: true }).waitFor({ timeout: 60000 });
  await rows().filter({ hasText: 'Old host moving member' }).first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 60000 });
  const restored = (await legacySections()).find(section => section.id === mixedId)!;
  assert.equal(record(restored.hostSectionIds)[oldHost], 'old-mixed-mapping');
  assert.ok(Array.isArray(restored.itemKeys) && restored.itemKeys.includes(key(oldId)) && restored.itemKeys.includes(key(movingId)));
  assert.equal(record((await legacySections()).find(section => section.id === sourceId)?.hostSectionIds)[oldHost], 'old-source-mapping');
  assert.equal(local.calls('threadSection/create').length, 1);
  checks.push('Reload keeps both old-host members, their mapping and the renamed mixed group without recreating the native section');

  const legacyRenamed = 'Renamed legacy source';
  await page.getByRole('button', { name: new RegExp('^(?:Options for ' + sourceName + '|' + sourceName + ' 的选项)$') }).press('Enter');
  await page.getByRole('menuitem', { name: /^(?:Edit|编辑)$/ }).click();
  await page.getByRole('textbox', { name: /^(?:Section name|分区名称)$/ }).fill(legacyRenamed);
  await page.getByRole('button', { name: /^(?:Save|保存)$/ }).click();
  await eventually(async () => (await legacySections()).some(section => section.id === sourceId && section.name === legacyRenamed),
    'Renaming an empty old-host group was not persisted');
  assert.equal(local.calls('threadSection/create').length, 1);
  assert.deepEqual(oldSidebarRequests(), []);
  checks.push('An empty legacy group and its mapping survive moving its last member; rename remains a client operation');

  const beforePin = (await legacySections()).find(section => section.id === mixedId)!.itemKeys;
  await rows().filter({ hasText: 'Old host moving member' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(?:Pin(?: chat)?|置顶(?:聊天|对话)?)$/ }).click();
  await eventually(async () => { const pins = await persistedPins(); return Array.isArray(pins) && pins.includes(movingId); },
    'Old-host pin did not use the existing backend legacy pin storage');
  report.pinsAfterPin = await persistedPins();
  await page.getByRole('button', { name: 'Old host moving member', exact: true }).first().focus();
  await page.keyboard.press('Control+z');
  await eventually(async () => JSON.stringify((await legacySections()).find(section => section.id === mixedId)?.itemKeys) === JSON.stringify(beforePin),
    'Undoing an old-host pin did not restore its original mixed group and position');
  await eventually(async () => { const pins = await persistedPins(); return Array.isArray(pins) && !pins.includes(movingId); },
    'Undoing the pin did not update legacy pin storage');
  report.pinsAfterUndo = await persistedPins();
  assert.deepEqual(oldSidebarRequests(), []);
  checks.push('Pin then Undo restores an old-host thread to its mixed group and original position through legacy pins');
  await capture('pin-undone');
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('button', { name: renamed, exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: legacyRenamed, exact: true }).waitFor({ timeout: 60000 });
  await rows().filter({ hasText: 'Old host moving member' }).first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 60000 });
  assert.deepEqual((await legacySections()).find(section => section.id === mixedId)?.itemKeys, beforePin);
  assert.deepEqual(await persistedPins(), []);
  assert.deepEqual(oldSidebarRequests(), []);
  checks.push('Reload preserves the undone pin, mixed-member order and renamed empty legacy group');

  await page.getByRole('button', { name: /^(?:Chat sidebar options|聊天侧边栏选项)$/ }).press('Enter');
  await page.getByRole('menuitem', { name: /^(?:New section|新建分区)$/ }).click();
  await page.getByRole('textbox', { name: /^(?:Section name|分区名称)$/ }).fill(nativeName);
  await page.getByRole('button', { name: /^(?:Create section|创建分区)$/ }).click();
  await page.getByRole('button', { name: nativeName, exact: true }).waitFor();
  const destination = [...local.sections.values()].find(section => section.name === nativeName)!;
  assert.ok(destination);
  await move('Native mixed member', nativeName);
  await eventually(() => record(local.threads.get(localId)?.section).id === destination.id, 'The local member stopped using native section moves');
  checks.push('Local create and move actions continue to use native sections beside the older SSH host');

  await page.getByRole('button', { name: new RegExp('^(?:Options for ' + renamed + '|' + renamed + ' 的选项)$') }).press('Enter');
  await page.getByRole('menuitem', { name: /^(?:Remove section|移除分区)$/ }).click();
  await eventually(() => !local.sections.has(nativeMixed.id), 'Deleting a mixed group did not delete its native owner');
  await eventually(async () => !(await legacySections()).some(section => section.id === mixedId), 'Deleting a mixed group retained its old-host membership');
  assert.equal(old.threads.size, 2);
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('button', { name: nativeName, exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 60000 });
  await rows().filter({ hasText: 'Old host mixed member' }).first().waitFor({ timeout: 60000 });
  await rows().filter({ hasText: 'Old host moving member' }).first().waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('button', { name: renamed, exact: true }).count(), 0);
  assert.deepEqual(oldSidebarRequests(), []);
  assert.equal(local.calls('threadSection/create').length, 2);
  assert.deepEqual(errors, []);
  checks.push('Deleting a mixed group survives reload, preserves both old-host conversations and sends zero new sidebar RPCs to 0.147');
  await capture('deleted');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  report.localSidebarRequests = local.messages.filter(message => message.method?.startsWith('threadSection/') || message.method?.startsWith('thread/section/'));
  report.oldSidebarRequests = oldSidebarRequests();
  report.oldMethods = [...new Set(old.messages.map(message => message.method))];
  report.legacy = await legacySections().catch(() => null);
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks, errors, failure: report.failure, output }, null, 2));
  await browser?.close();
  await app?.close();
  await Promise.all([local.close(), old.close()]);
  await rm(root, { recursive: true, force: true });
}
