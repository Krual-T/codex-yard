// Hold /tmp/agents-workbench-heavy.lock for the entire run, after npm run build.
// This runner uses a disposable daemon fixture. It never starts a real Agent turn.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { chromium } from 'playwright-core';
import type { Browser, Frame, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { rendererAssets } from '../src/native/renderer-assets.ts';
import { rendererRoot } from './copy-renderer.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

const output = resolve(process.env.AGENTS_PET_EVIDENCE || '.local/mini-evidence');
const lifecycleOnly = process.argv.includes('--lifecycle-only');
const root = await mkdtemp('/tmp/aw-official-mini-');
const checks: string[] = [], errors: string[] = [];
const windowMessages: string[] = [];
const hostProbeEvidence: { url?: string; upgrades: Record<string, unknown>[]; responses: Record<string, unknown>[]; errors: string[] } = {
  upgrades: [], responses: [], errors: [],
};
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let fake: Awaited<ReturnType<typeof createFakeCodex>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
let failure: string | undefined;
const passed = (name: string) => { checks.push(name); console.log('PASS', name); };
const threadId = '00000000-0000-4000-8000-000000000071';
const title = 'Mini 协议验收任务';
const now = Math.floor(Date.now() / 1000);

async function until(check: () => Promise<boolean>, reason: string, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!await check()) { assert.ok(Date.now() < end, reason); await new Promise(resolve => setTimeout(resolve, 100)); }
}
async function miniFrame(): Promise<Frame> {
  await until(async () => Boolean(page?.frames().some(frame => frame.url().includes('/avatar-overlay'))), 'Mini frame did not load');
  return page!.frames().find(frame => frame.url().includes('/avatar-overlay'))!;
}
try {
  await mkdir(output, { recursive: true });
  const renderer = join(root, 'renderer');
  await mkdir(renderer);
  await symlink(join(rendererRoot, 'index.html'), join(renderer, 'index.html'));
  await symlink(join(rendererRoot, 'renderer.json'), join(renderer, 'renderer.json'));
  await symlink(join(rendererRoot, 'assets'), join(renderer, 'assets'));
  // A real loopback response keeps Chromium's local-network classification.
  // Intercepted synthetic HTML can be treated as public and block its socket.
  await writeFile(join(renderer, 'mini-host-probe.html'), '<!doctype html><script src="/native-host.js"></script>');
  if (process.env.AGENTS_MINI_SNAPSHOT) await cp(process.env.AGENTS_MINI_SNAPSHOT, join(root, 'data/configuration-snapshot'), { recursive: true });
  fake = await createFakeCodex(root);
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  // Keep the anonymous targeting profile compatible with the copied snapshot.
  fake.handlers.set('getAuthStatus', () => ({ authMethod: null, authToken: null, requiresOpenaiAuth: false }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('experimentalFeature/list', () => ({ data: [], nextCursor: null }));
  fake.handlers.set('thread/resume', (params: Record<string, unknown>) => ({ ...fake!.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  const thread = fixtureThread(threadId, root, { name: title, createdAt: now, updatedAt: now,
    status: { type: 'active', activeFlags: [] }, turns: [fixtureTurn('mini-turn', [agentItem('mini-message', '正在执行 Mini 验收')], 'inProgress')] });
  fake.threads.set(threadId, thread);
  fake.loaded.add(threadId);
  app = await createNativeWorkbench({ port: 0, renderer, dataDir: join(root, 'data'), workspace: root, codexHome: join(root, 'home'),
    httpFetch: async () => new Response('Isolated Mini fixture: external telemetry disabled', { status: 503 }),
    hostCatalog: { hosts: [], projects: [], assignments: {} }, socketPath: fake.socketPath });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', event => {
    try {
      const message = JSON.parse(event.payload.toString()) as { type?: string };
      if (message.type?.startsWith('avatar-overlay-')) windowMessages.push(message.type);
    } catch { /* Ignore non-JSON frames. */ }
  }));
  page.setDefaultTimeout(20000);
  await page.goto(app.url);
  // Slow only the independent Mini entry to verify the first-frame click boundary.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let continued!: () => void;
  const routed = new Promise<void>(resolve => { continued = resolve; });
  await page.route('**/avatar-overlay?*', async route => {
    await held;
    try { await route.continue(); } catch { /* The page may close after an assertion failure. */ }
    finally { continued(); }
  });
  const editor = page.locator('[contenteditable=true]').first();
  await editor.waitFor({ timeout: 30000 });
  // Real-daemon evidence covers the profile menu. This isolated protocol run
  // opens the window through the same official host message without gate edits.
  await page.evaluate(() => (window as unknown as { electronBridge: { sendMessageFromView(message: unknown): Promise<void> } })
    .electronBridge.sendMessageFromView({ type: 'avatar-overlay-open' }));
  const shell = page.locator('[data-workbench-mini]'), iframe = shell.locator('iframe');
  await iframe.waitFor({ state: 'attached' });
  assert.equal(await iframe.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  const editorBounds = await editor.boundingBox(), frameBounds = await iframe.boundingBox();
  assert.ok(editorBounds && frameBounds);
  const x = (Math.max(editorBounds.x, frameBounds.x) + Math.min(editorBounds.x + editorBounds.width, frameBounds.x + frameBounds.width)) / 2;
  const y = (Math.max(editorBounds.y, frameBounds.y) + Math.min(editorBounds.y + editorBounds.height, frameBounds.y + frameBounds.height)) / 2;
  assert.ok(x >= editorBounds.x && x <= editorBounds.x + editorBounds.width && x >= frameBounds.x && x <= frameBounds.x + frameBounds.width);
  assert.ok(y >= editorBounds.y && y <= editorBounds.y + editorBounds.height && y >= frameBounds.y && y <= frameBounds.y + frameBounds.height);
  await editor.click({ position: { x: x - editorBounds.x, y: y - editorBounds.y } });
  await editor.fill('Mini 加载时仍可编辑，不发送');
  await editor.fill('');
  release();
  await routed;
  await page.unroute('**/avatar-overlay?*');
  let frame = await miniFrame();
  await frame.locator('[data-codex-pet-id]').first().waitFor({ timeout: 60000 });
  assert.ok(await frame.evaluate(asset => performance.getEntriesByType('resource').some(entry => entry.name.includes(asset)), rendererAssets.mini));
  await until(async () => (await iframe.evaluate(element => getComputedStyle(element).pointerEvents)) === 'auto', 'Official hit regions did not arrive');
  if (!lifecycleOnly) {
  passed('official avatar-overlay-open mounts AvatarOverlayNativePage; a click in the loading iframe/editor overlap reaches the editor');
  await until(async () => (await frame.locator('body').innerText()).includes(title), 'Active task is missing from the official Mini activity stack');
  await page.screenshot({ path: join(output, 'active.png') });
  passed('the official activity stack consumes an active daemon thread');
  await page.evaluate(() => (window as unknown as { electronBridge: { sendMessageFromView(message: unknown): Promise<void> } })
    .electronBridge.sendMessageFromView({ type: 'fetch', requestId: crypto.randomUUID(), url: 'vscode://codex/set-setting',
      body: JSON.stringify({ key: 'selected-avatar-id', value: 'hoots' }) }));
  await frame.locator('[data-codex-pet-id="hoots"]').waitFor();
  passed('the official page updates its pet from the shared settings subscription without reloading');

  // Same-origin messages from a sibling frame and from the parent itself cannot
  // act as Mini. This exercises the actual browser MessageEvent.source boundary.
  await page.evaluate(() => {
    window.postMessage({ type: 'workbench-mini-focus-main', path: '/settings/pets' }, location.origin);
    const sibling = document.createElement('iframe');
    sibling.id = 'mini-spoof-test'; document.body.append(sibling);
  });
  const sibling = page.frames().find(candidate => candidate !== page!.mainFrame() && candidate !== frame)!;
  await sibling.evaluate(() => parent.postMessage({ type: 'workbench-mini-error', error: 'SPOOF' }, parent.location.origin));
  await page.waitForTimeout(150);
  assert.equal(await page.getByText('SPOOF', { exact: true }).count(), 0);
  assert.ok(!page.url().includes('/settings'));
  await page.locator('#mini-spoof-test').evaluate(element => element.remove());
  passed('parent and sibling messages cannot spoof the Mini frame');

  // The fixture broadcasts the real experimental protocol shape. No production
  // task, command, approval or external state is changed by this interaction.
  fake.broadcast({ method: 'turn/started', params: { threadId, turn: thread.turns[0] } });
  thread.status = { type: 'active', activeFlags: ['waitingOnApproval'] };
  fake.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
  fake.broadcast({ id: 'mini-approval', method: 'item/commandExecution/requestApproval', params: {
    kind: 'command', threadId, turnId: 'mini-turn', itemId: 'mini-command', startedAtMs: Date.now(),
    environmentId: null, command: 'printf mini-fixture', cwd: root, commandActions: [], reason: 'Mini 验收等待', availableDecisions: ['accept', 'decline'] } });
  const deny = frame.getByRole('button', { name: /^(拒绝|Deny)$/ });
  await deny.waitFor();
  await frame.getByRole('button', { name: /^(运行一次|Run once)$/ }).waitFor();
  await writeFile(join(output, 'waiting-tree.txt'), await frame.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, 'waiting.png') });
  await frame.getByRole('button', { name: new RegExp(title) }).first().click(); // Expand the official activity stack.
  await deny.click();
  const approval = await fake.waitFor((message: Record<string, unknown>) => message.id === 'mini-approval' && 'result' in message);
  assert.deepEqual(approval.result, { decision: 'decline' });
  thread.status = { type: 'active', activeFlags: [] };
  fake.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
  await deny.waitFor({ state: 'detached' });
  passed('official waiting card shows the requested command; Deny replies to the fixture approval');

  // Use the original notification action to return to its task in the main app.
  const notification = frame.getByRole('button', { name: new RegExp(title) }).first();
  await notification.click();
  await until(async () => fake!.calls('thread/resume').some(message => message.params.threadId === threadId), 'Official notification did not load its task in the main window');
  await page.getByText('正在执行 Mini 验收', { exact: true }).waitFor();
  passed('an official Mini notification opens its thread in the main window');

  await page.reload();
  frame = await miniFrame();
  await frame.locator('[data-codex-pet-id]').first().waitFor({ timeout: 60000 });
  passed('the open Mini restores after refresh using its own official providers');
  // A caught or uncaught entry failure must remove the frame and its daemon
  // connection, and the shell must remain usable for retry and close.
  await frame.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Mini fixture failure' }));
    // Late layout/ready delivery must not cancel error cleanup in the parent.
    parent.postMessage({ type: 'workbench-mini-ready' }, location.origin);
  });
  await page.getByRole('alert').filter({ hasText: 'Mini 页面运行失败' }).waitFor();
  await until(async () => (await (await fetch(app!.url + '/api/status')).json()).clients === 1, 'Failed Mini left a host connection');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  frame = await miniFrame();
  await frame.locator('[data-codex-pet-id]').first().waitFor({ timeout: 60000 });
  passed('a Mini error removes its frame/connection and Retry restores it');
  }

  // Run the exact persisted event against the main browser-host script alone:
  // synthesizing pagehide on the official app would also dispose its providers.
  const hostProbe = await page.context().newPage();
  hostProbe.on('console', message => { if (message.type() === 'error') hostProbeEvidence.errors.push(message.text()); });
  const onProbeUpgrade = (request: IncomingMessage) => hostProbeEvidence.upgrades.push({ path: request.url,
    origin: request.headers.origin ?? null, secFetchSite: request.headers['sec-fetch-site'] ?? null });
  app.server.on('upgrade', onProbeUpgrade);
  const probeNetwork = await context.newCDPSession(hostProbe);
  await probeNetwork.send('Network.enable');
  probeNetwork.on('Network.webSocketHandshakeResponseReceived', event => {
    hostProbeEvidence.responses.push({ status: event.response.status, statusText: event.response.statusText });
  });
  await hostProbe.addInitScript(() => {
    const sockets: WebSocket[] = [], Base = WebSocket;
    Object.assign(window, { hostStates: [], testSockets: sockets, WebSocket: class extends Base {
      constructor(url: string | URL, protocols: string | string[] = []) { super(url, protocols); sockets.push(this); }
    } });
    addEventListener('message', event => {
      if (event.source === window && event.data.type === 'codex-app-server-connection-changed')
        (window as unknown as { hostStates: unknown[] }).hostStates.push(event.data.state);
    });
  });
  hostProbeEvidence.url = app.url + '/mini-host-probe.html';
  await hostProbe.goto(hostProbeEvidence.url);
  await hostProbe.evaluate(() => (window as unknown as { electronBridge: { sendMessageFromView(message: unknown): Promise<void> } })
    .electronBridge.sendMessageFromView({ type: 'ready' }));
  await until(async () => hostProbe.evaluate(() => (window as unknown as { hostStates: unknown[] }).hostStates.includes('connected')), 'Main host probe did not connect');
  await hostProbe.evaluate(() => {
    const probe = window as unknown as { hostStates: unknown[]; testSockets: WebSocket[] };
    probe.hostStates.length = 0;
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    probe.testSockets[0].close();
  });
  assert.equal(await iframe.count(), 1);
  await until(async () => hostProbe.evaluate(() => (window as unknown as { hostStates: unknown[] }).hostStates.includes('connected')), 'Main host did not reconnect after persisted pagehide');
  await hostProbe.close();
  app.server.off('upgrade', onProbeUpgrade);
  await until(async () => (await (await fetch(app!.url + '/api/status')).json()).clients === 2, 'Main and Mini host connections were affected by the probe');
  passed('main browser-host reconnects its socket after persisted pagehide/pageshow; the original main page and Mini remain connected');

  await page.setViewportSize({ width: 402, height: 844 });
  const bounds = await iframe.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 402 && bounds.y + bounds.height <= 844);
  await page.screenshot({ path: join(output, 'narrow.png') });
  // Close from the official pet context menu, not a replacement toy toolbar.
  assert.equal(await frame.evaluate(() => 'showContextMenu' in (window as unknown as { electronBridge: object }).electronBridge), false);
  await frame.getByTestId('avatar-mascot-button').click({ button: 'right' });
  const close = frame.getByRole('menuitem', { name: /关闭|隐藏|Close|Hide/ }).last();
  await close.waitFor();
  await writeFile(join(output, 'close-menu-tree.txt'), await frame.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, 'close-menu.png') });
  await close.click();
  await iframe.waitFor({ state: 'detached' });
  assert.ok(windowMessages.includes('avatar-overlay-close'), 'The official menu did not send its close callback');
  await until(async () => (await (await fetch(app!.url + '/api/status')).json()).clients === 1, 'Closed Mini left a host connection');
  await page.reload();
  await page.getByRole('button', { name: /^(打开个人资料菜单|Open profile menu)$/i }).waitFor({ timeout: 60000 });
  assert.equal(await iframe.count(), 0);
  assert.equal(JSON.parse(await readFile(join(root, 'data/native-state.json'), 'utf8')).globals['electron-avatar-overlay-open'], false);
  passed('official close persists after refresh and releases the iframe connection; the window fits a narrow viewport');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error);
  console.log('FIXTURE_METHODS', [...new Set(fake?.messages.map(message => message.method))]);
  console.log('BODY', await page?.locator('body').innerText().catch(() => 'unavailable'));
  await page?.screenshot({ path: join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, lifecycleOnly ? 'lifecycle-report.json' : 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
    entry: 'official avatar-overlay-open host message; isolated anonymous protocol fixture',
    asset: rendererAssets.mini, checks, errors, windowMessages, failure }, null, 2));
  await writeFile(join(output, 'host-probe.json'), JSON.stringify(hostProbeEvidence, null, 2));
  try { await browser?.close(); } finally {
    try { await app?.close(); } finally { await fake?.close(); await rm(root, { recursive: true, force: true }); }
  }
}
