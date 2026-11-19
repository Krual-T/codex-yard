// Isolated CLI, scripted local model and Chromium. Web Push envelopes are
// decrypted by a local receiver and delivered through Chrome's test protocol;
// no personal chats, browser profiles or live push subscriptions are touched.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { BrowserContext, CDPSession, Page } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import type { Page as RpcPage, TurnSummary } from '../lib/codex-protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { deepseekModels } from '../src/native/deepseek-models.ts';
import type { BrowserNotification } from '../src/native/notifications.ts';

const root = await mkdtemp('/tmp/yard-notifications-cli-'), codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_NOTIFICATIONS_EVIDENCE ?? '.local/browser-notifications');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
const require = createRequire(import.meta.url);
const ece = require(require.resolve('http_ece', { paths: [dirname(require.resolve('web-push'))] })) as { decrypt(body: Buffer, options: object): Buffer };
const receiver = createECDH('prime256v1'); receiver.generateKeys(); const auth = randomBytes(16);
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/isolated-ui-fixture', keys: {
  p256dh: receiver.getPublicKey().toString('base64url'), auth: auth.toString('base64url'),
} };
let release: (() => void) | undefined;
let releaseQuestion: (() => void) | undefined;
let modelCalls = 0;
const provider = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  const input = JSON.parse(body).input as { type: string; call_id?: string }[];
  const question = body.includes('ASYNC_INPUT_FIXTURE');
  const questionAnswered = input.some(item => item.type === 'function_call_output' && item.call_id === 'async-question-fixture');
  if (body.includes('DELAYED_PUSH_FIXTURE')) await new Promise<void>(resolve => { release = resolve; });
  if (question) await new Promise<void>(resolve => { if (questionAnswered) release = resolve; else releaseQuestion = resolve; });
  const id = 'notification-response-' + ++modelCalls, item = question && !questionAnswered
    ? { id: 'async-question-fixture', call_id: 'async-question-fixture', type: 'function_call', name: 'request_user_input_async',
      arguments: JSON.stringify({ questions: [{ title: 'Which fixture option?', options: ['One', 'Two'] }] }), status: 'completed' }
    : { id: 'notification-message-' + modelCalls, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'NOTIFICATION_FIXTURE_OK', annotations: [] }] };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [type, data] of [
    ['response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } }],
    ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } }],
    ['response.output_item.done', { output_index: 0, item }],
    ['response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
  ] as const) response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  response.end();
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const modelPort = (provider.address() as import('node:net').AddressInfo).port;
await writeFile(join(codexHome, 'models.json'), JSON.stringify({ models: [{ ...deepseekModels[0], slug: 'notification-fixture', display_name: 'Notification fixture',
  experimental_supported_tools: ['request_user_input_async'] }] }));
await writeFile(join(codexHome, 'config.toml'), `model = "notification-fixture"\nmodel_catalog_json = ${JSON.stringify(join(codexHome, 'models.json'))}\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "Notification fixture"\nbase_url = "http://127.0.0.1:${modelPort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\ncode_mode = false\n`);
const socketPath = join(root, 'backend.sock');
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let backendLog = ''; child.stdout.on('data', chunk => { backendLog += chunk; }); child.stderr.on('data', chunk => { backendLog += chunk; });
let startupError: Error | undefined; child.on('error', error => { startupError = error; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, browserContext: BrowserContext | undefined, cdp: CDPSession | undefined, registrationId = '';
let background: CodexConnection | undefined;
const payloads: BrowserNotification[] = [], checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', checks, errors, pushTransport: 'local encrypted receiver + Chromium ServiceWorker.deliverPushMessage' };
async function waitUntil(read: () => Promise<boolean>, label: string) {
  const until = Date.now() + 60000;
  while (Date.now() < until) { if (await read()) return; await delay(100); }
  throw new Error('Notification fixture timed out: ' + label);
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  await waitUntil(async () => { if (startupError) throw startupError; try { await access(socketPath); return true; } catch { if (child.exitCode != null) throw new Error(backendLog); return false; } }, 'CLI startup');
  app = await createNativeWorkbench({ port: 0, socketPath, codexHome, dataDir, workspace: root, hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('Offline fixture', { status: 503 }), notificationFetch: async (_url, init) => {
      const payload = JSON.parse(ece.decrypt(Buffer.from(init!.body as Uint8Array), { version: 'aes128gcm', privateKey: receiver, authSecret: auth }).toString()) as BrowserNotification;
      payloads.push(payload);
      assert.ok(cdp && registrationId);
      await cdp.send('ServiceWorker.deliverPushMessage', { origin: app!.url, registrationId, data: JSON.stringify(payload) });
      return new Response(null, { status: 201 });
    },
  });
  report.cli = app.control.server?.userAgent;
  const { thread } = await app.control.request('thread/start', { cwd: root });
  await app.control.request('thread/name/set', { threadId: thread.id, name: '浏览器通知验收' });
  await app.control.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Initialize the notification fixture.' }] }, { mutating: true });
  await waitUntil(async () => (await app!.control.request('thread/read', { threadId: thread.id, includeTurns: false })).thread.status.type === 'idle', 'seed response');
  const context = browserContext = await chromium.launchPersistentContext(join(root, 'browser'), { executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: !process.env.AGENTS_TEST_HEADED, viewport: { width: 1440, height: 1000 },
    args: ['--no-sandbox', '--disable-dev-shm-usage', ...(process.env.WAYLAND_DISPLAY ? ['--ozone-platform=wayland'] : [])] });
  await context.grantPermissions(['notifications'], { origin: app.url });
  await context.addInitScript(({ fixture }) => {
    function current() {
      if (localStorage.getItem('fixture-notification-subscribed') !== 'true') return null;
      return { ...fixture, options: { applicationServerKey: null }, toJSON: () => fixture,
        unsubscribe: async () => { localStorage.removeItem('fixture-notification-subscribed'); return true; } };
    }
    Object.defineProperty(PushManager.prototype, 'getSubscription', { value: async () => current() });
    Object.defineProperty(PushManager.prototype, 'subscribe', { value: async () => { localStorage.setItem('fixture-notification-subscribed', 'true'); return current(); } });
  }, { fixture: subscription });
  // Keep only a blank control target so CDP can inject a push after all Yard
  // pages close. It does not open Yard, connect a WebSocket or own a task.
  const controller = await context.newPage(); cdp = await context.newCDPSession(controller);
  cdp.on('ServiceWorker.workerRegistrationUpdated', event => {
    for (const registration of event.registrations) if (registration.scopeURL === app!.url + '/' && !registration.isDeleted) registrationId = registration.registrationId;
  });
  await cdp.send('ServiceWorker.enable');
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  // Upstream model onboarding can appear after Settings is already open.
  const keepModel = page.getByRole('button', { name: /^(继续使用当前模型|Continue with current model)$/, includeHidden: true });
  await page.addLocatorHandler(keepModel, async () => { await keepModel.evaluate(button => (button as HTMLButtonElement).click()); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + thread.id));
  const trigger = page.locator('#app-shell-sidebar button[aria-haspopup="menu"]').filter({ has: page.locator('svg[viewBox="0 0 53.225983 18"]') });
  await trigger.click({ timeout: 60000 });
  assert.equal(await page.getByRole('menuitem', { name: /^浏览器通知/ }).count(), 0);
  await page.keyboard.press('Escape');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: /^(打开个人资料菜单|Open profile menu|打开设置|Open settings)$/ }).click();
    try { await page.getByRole('menuitem', { name: /^(设置|Settings)/ }).click({ timeout: 5000 }); break; }
    catch (error) { if (attempt === 2) throw error; }
  }
  const settings = page.locator('#notifications').getByRole('region', { name: '浏览器通知', exact: true }); await settings.waitFor();
  await page.getByRole('button', { name: '开启本设备通知', exact: true }).click();
  await page.getByText('本设备通知已开启', { exact: true }).waitFor();
  await writeFile(join(output, 'enabled.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, 'enabled.png') });
  await waitUntil(async () => !!registrationId, 'worker registration');
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith('/notification-worker.js'));
  assert.ok(worker);
  worker.on('close', () => { report.workerClosed = true; });
  await worker.evaluate(() => {
    const fixture = globalThis as typeof globalThis & { fixtureClicks?: string[]; fixtureErrors?: string[] };
    fixture.fixtureClicks = []; fixture.fixtureErrors = [];
    addEventListener('notificationclick', event => { fixture.fixtureClicks!.push(JSON.stringify((event as NotificationEvent).notification.data)); });
    addEventListener('unhandledrejection', event => { fixture.fixtureErrors!.push(String((event as PromiseRejectionEvent).reason)); });
  });
  report.nativeNotificationClicks = process.env.AGENTS_TEST_NOTIFICATION_DBUS === '1';
  const notifications = () => worker.evaluate(async () => (await (globalThis as unknown as ServiceWorkerGlobalScope).registration.getNotifications()).map(notification => ({ title: notification.title, data: notification.data })));
  // An isolated Linux notification daemon can drive genuine OS click events.
  // Synthetic dispatch lacks the activation required by focus()/openWindow().
  const clickNotification = async (url: string) => {
    if (process.env.AGENTS_TEST_NOTIFICATION_DBUS) {
      const clicks = await worker.evaluate(() => (globalThis as typeof globalThis & { fixtureClicks: string[] }).fixtureClicks.length);
      await worker.evaluate(async url => {
        await (globalThis as unknown as ServiceWorkerGlobalScope).registration.showNotification('Yard · 跳转验收', { tag: 'yard-navigation-fixture', data: { url } });
      }, url);
      await waitUntil(async () => {
        const { stdout } = await promisify(execFile)('gdbus', ['call', '--session', '--dest', 'org.freedesktop.Notifications',
          '--object-path', '/org/freedesktop/Notifications', '--method', 'org.codex.YardNotificationTest.Click', 'Yard · 跳转验收']);
        return stdout.includes('true');
      }, 'native notification click');
      await waitUntil(async () => worker.evaluate(before => (globalThis as typeof globalThis & { fixtureClicks: string[] }).fixtureClicks.length > before, clicks), 'worker handles native click');
      return;
    }
    await worker.evaluate(async url => {
      const scope = globalThis as unknown as ServiceWorkerGlobalScope;
      const tag = 'yard-navigation-fixture';
      await scope.registration.showNotification('Yard · 跳转验收', { tag, data: { url } });
      const notification = (await scope.registration.getNotifications({ tag }))[0];
      const event = new NotificationEvent('notificationclick', { notification });
      let work: Promise<unknown> | undefined;
      Object.defineProperty(event, 'waitUntil', { value: (promise: Promise<unknown>) => { work = promise; } });
      scope.dispatchEvent(event);
      try { await work; } catch (error) { if ((error as Error).name !== 'InvalidAccessError') throw error; }
    }, url);
  };
  await page.getByRole('button', { name: '测试通知', exact: true }).click();
  await waitUntil(async () => (await notifications()).some(notification => notification.title === 'Yard · 测试通知'), 'test notification');
  checks.push('Existing Settings opens browser notification controls without an extra product-menu item; enabling creates a subscription and the real worker displays a test push');
  await settings.getByRole('switch', { name: '执行失败', exact: true }).click();
  await waitUntil(async () => {
    const status = await app!.notifications.request({ operation: 'status', endpoint: subscription.endpoint }); return status.preferences?.failed === false;
  }, 'device preferences');
  await waitUntil(() => settings.getByRole('switch', { name: '执行失败', exact: true }).isEnabled(), 'preference save finished');
  await page.screenshot({ path: join(output, 'desktop.png') });
  await page.reload();
  await settings.waitFor();
  await page.getByText('本设备通知已开启', { exact: true }).waitFor();
  await page.getByRole('heading', { name: /^(常规|General)$/, exact: true }).waitFor();
  assert.equal(await settings.getByRole('switch', { name: '执行失败', exact: true }).getAttribute('aria-checked'), 'false');
  assert.equal(app.notifications.status().devices, 1);
  checks.push('The existing General Notifications section preserves saved preferences and the device subscription across a page reload');
  await page.setViewportSize({ width: 800, height: 1280 });
  const geometry = await settings.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
  assert.ok(geometry.scroll <= geometry.width + 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await settings.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'tablet.png') });
  checks.push('The 800px tablet Settings page fits without horizontal overflow');
  await page.getByRole('button', { name: '关闭本设备通知', exact: true }).click();
  await page.getByText('本设备通知未开启', { exact: true }).waitFor();
  assert.equal(app.notifications.status().devices, 0);
  await page.getByRole('button', { name: '开启本设备通知', exact: true }).click();
  await page.getByText('本设备通知已开启', { exact: true }).waitFor();
  checks.push('Disabling removes the server subscription; re-enabling uses the existing browser permission');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { thread: previous } = await app.control.request('thread/start', { cwd: root });
  await app.control.request('thread/name/set', { threadId: previous.id, name: '通知跳转前的对话' });
  await app.control.request('turn/start', { threadId: previous.id, input: [{ type: 'text', text: 'Initialize the draft fixture.' }] }, { mutating: true });
  await waitUntil(async () => (await app!.control.request('thread/read', { threadId: previous.id, includeTurns: false })).thread.status.type === 'idle', 'draft fixture response');
  await page.evaluate(path => window.postMessage({ type: 'navigate-to-route', path }, location.origin), '/local/' + previous.id);
  await waitUntil(async () => new URL(page.url()).searchParams.get('initialRoute') === '/local/' + previous.id, 'open previous conversation');
  const editor = page.getByRole('textbox').last(); await editor.waitFor();
  const draft = '通知点击前保留的中文草稿'; await editor.fill(draft);
  const identity = await page.evaluate(() => performance.timeOrigin);
  let documentRequests = 0, newSockets = 0;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++; });
  page.on('websocket', socket => { if (socket.url().endsWith('/native-host')) newSockets++; });
  const targetUrl = '/?initialRoute=' + encodeURIComponent('/local/' + thread.id);
  await clickNotification(targetUrl);
  await waitUntil(async () => new URL(page.url()).searchParams.get('initialRoute') === '/local/' + thread.id, 'notification opens target conversation');
  await editor.waitFor(); await editor.fill('目标对话中未发送的内容');
  await clickNotification(targetUrl);
  assert.equal(await editor.innerText(), '目标对话中未发送的内容');
  await clickNotification('/?initialRoute=' + encodeURIComponent('/local/' + previous.id));
  await waitUntil(async () => (await editor.innerText()) === draft, 'previous draft survives notification navigation');
  assert.equal(await page.evaluate(() => performance.timeOrigin), identity);
  assert.equal(documentRequests, 0); assert.equal(newSockets, 0);
  assert.equal(context.pages().filter(page => page.url().startsWith(app!.url)).length, 1);
  checks.push('Worker notification clicks switch the existing full-UI tab to the target and back, preserve both drafts and the document, and create no document requests, host reconnects or extra Yard tabs');
  await app.control.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'DELAYED_PUSH_FIXTURE' }] }, { mutating: true });
  await waitUntil(async () => !!release && app!.notifications.status().watching > 0, 'background turn');
  await page.close();
  assert.equal(context.pages().filter(page => page.url().startsWith(app!.url)).length, 0);
  release!();
  await waitUntil(async () => payloads.some(payload => payload.kind === 'completed' && payload.url === targetUrl), 'completed push');
  await waitUntil(async () => (await notifications()).some(notification => notification.title === 'Yard · 任务已完成' && notification.data.url === targetUrl), 'background notification');
  const completion = (await notifications()).find(notification => notification.title === 'Yard · 任务已完成' && notification.data.url === targetUrl)!;
  assert.equal(completion.data.url, '/?initialRoute=' + encodeURIComponent('/local/' + thread.id));
  await app.notifications.tick(); assert.equal(payloads.filter(payload => payload.kind === 'completed' && payload.url === targetUrl).length, 1);
  checks.push('An actual CLI turn completes with every Yard page closed; the worker displays one notification containing the correct conversation route');
  if (process.env.AGENTS_TEST_NOTIFICATION_DBUS) {
    const opened = context.waitForEvent('page');
    await clickNotification(completion.data.url);
    const reopened: Page = await opened;
    reopened.on('pageerror', error => errors.push(error.message));
    await waitUntil(async () => new URL(reopened.url()).searchParams.get('initialRoute') === '/local/' + thread.id, 'notification opens a new target tab');
    await reopened.getByRole('textbox').last().waitFor({ timeout: 60000 });
    checks.push('With all Yard tabs closed, a worker notification click opens a new tab directly at the corresponding CLI conversation');
  }
  for (const open of context.pages()) if (open.url().startsWith(app.url)) await open.close();
  background = new CodexConnection(socketPath); await background.connect();
  const inputThread = (await background.request('thread/start', { cwd: root })).thread;
  const inputTurn = (await background.request('turn/start', { threadId: inputThread.id, input: [{ type: 'text', text: 'ASYNC_INPUT_FIXTURE' }] }, { mutating: true })).turn;
  app.notifications.watch('local', inputThread.id, inputTurn.id);
  await waitUntil(async () => !!releaseQuestion, 'async question model request');
  background.close(); background = undefined; release = undefined; releaseQuestion!();
  const inputUrl = '/?initialRoute=' + encodeURIComponent('/local/' + inputThread.id);
  await waitUntil(async () => payloads.some(payload => payload.kind === 'waiting' && payload.url === inputUrl), 'background async question push');
  const inputStatus = (await app.control.request('thread/read', { threadId: inputThread.id, includeTurns: false })).thread.status;
  assert.deepEqual(inputStatus, { type: 'active', activeFlags: [] });
  const inputTurns = await app.control.request<RpcPage<TurnSummary>>('thread/turns/list', { threadId: inputThread.id, limit: 1, itemsView: 'full' });
  assert.ok(inputTurns.data[0].items.some(item => item.type === 'agentMessage' && item.delivery === 'async' && Array.isArray(item.questions) && item.questions.length));
  await waitUntil(async () => (await notifications()).some(notification => notification.title === 'Yard · 任务需要你回答' && notification.data.url === inputUrl), 'async question worker notification');
  await app.notifications.tick(); assert.equal(payloads.filter(payload => payload.kind === 'waiting' && payload.url === inputUrl).length, 1);
  assert.equal(context.pages().filter(page => page.url().startsWith(app!.url)).length, 0);
  checks.push('An actual CLI async question with no blocking flags notifies once through the worker after its originating connection and every Yard tab close');
  await waitUntil(async () => !!release, 'async question accepted by CLI'); release!();
  await waitUntil(async () => payloads.some(payload => payload.kind === 'completed' && payload.url === inputUrl), 'async question turn completion');
  report.payloadKinds = payloads.map(payload => payload.kind); report.status = app.notifications.status();
  assert.deepEqual(errors, []); report.ok = true;
} catch (error) {
  const worker = browserContext?.serviceWorkers().find(worker => worker.url().endsWith('/notification-worker.js'));
  if (worker) report.workerDebug = await worker.evaluate(async () => {
    const scope = globalThis as unknown as ServiceWorkerGlobalScope & { fixtureClicks?: string[]; fixtureErrors?: string[] };
    return { clicks: scope.fixtureClicks, errors: scope.fixtureErrors, clients: (await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })).map(client => ({ url: client.url, frameType: client.frameType })) };
  }).catch(() => null);
  for (const page of browserContext?.pages() ?? []) {
    if (page.url().startsWith(app?.url ?? 'invalid:')) {
      await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot()).catch(() => {});
      await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    }
  }
  report.failure = (error as Error).stack; await writeFile(join(output, 'backend.log'), backendLog); process.exitCode = 1;
} finally {
  releaseQuestion?.(); release?.(); background?.close(); await browserContext?.close(); await app?.close(); child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(root, { recursive: true, force: true }); console.log(JSON.stringify(report));
}
