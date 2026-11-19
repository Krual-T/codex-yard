// Run under /tmp/agents-workbench-heavy.lock. Actual CLI, disposable history,
// loopback Responses provider and a fresh browser; no account or shared daemon.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import type { ObjectValue } from '../src/native/protocol.ts';
import type { Page as RpcPage, RpcMessage, ThreadSummary } from '../lib/codex-protocol.ts';
import { supportsAttachedThreads } from '../lib/codex-protocol.ts';
import { createCliResponsesFixture } from './cli-responses-fixture.ts';

const root = await mkdtemp('/tmp/yard-sidechat-'), codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_SIDECHAT_EVIDENCE ?? '.local/sidechat-threads');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT,
  join(dataDir, 'configuration-snapshot'), { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Sidechat project', path: root }]));
await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ settings: { localeOverride: 'en-US' } }));
let release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
let renameTo: string | undefined;
let renameWait: Promise<void> | undefined;
const titleTools: string[] = [], titleResults: string[] = [];
const provider = await createCliResponsesFixture(body => {
  const request = record(JSON.parse(body)), input = request.input;
  if (Array.isArray(input)) for (const item of input.map(record)) {
    if (item.type === 'function_call_output') titleResults.push(JSON.stringify(item.output));
  }
  if (renameTo) {
    const names = (Array.isArray(request.tools) ? request.tools.map(record) : []).flatMap(tool =>
      tool.type === 'namespace' && Array.isArray(tool.tools)
        ? tool.tools.map(record).map(child => String(tool.name) + '.' + String(child.name)) : [String(tool.name)]);
    const name = names.find(name => name.includes('codex_app') && name.endsWith('set_thread_title'));
    assert.ok(name, 'The sidechat model receives the existing title tool');
    titleTools.push(name);
    const title = renameTo, wait = renameWait; renameTo = undefined; renameWait = undefined;
    return { toolCall: { ...(name.includes('.') ? {
      namespace: name.slice(0, name.lastIndexOf('.')), name: name.slice(name.lastIndexOf('.') + 1),
    } : { name }), arguments: { title } }, wait };
  }
  const user = Array.isArray(input) ? input.map(record).reverse().find(item => item.role === 'user') : null;
  const text = JSON.stringify(user);
  return text.includes('SIDECHAT_RUNNING') ? { text: 'Sidechat background response', wait: gate }
    : { text: text.includes('SIDECHAT_REPLY') ? 'Sidechat saved response' : 'Parent saved response' };
});
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.fixture]
name = "Sidechat fixture"
base_url = "http://127.0.0.1:${provider.port}/v1"
wire_api = "responses"
requires_openai_auth = false
[features]
code_mode = false
`, { mode: 0o600 });
const socketPath = join(root, 'backend.sock');
let backend: ReturnType<typeof spawn>;
let log = '';
async function startBackend() {
  backend = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
    env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout!.on('data', bytes => { log += bytes; }); backend.stderr!.on('data', bytes => { log += bytes; });
  for (let attempt = 0; ; attempt++) {
    try { await access(socketPath); break; } catch {
      if (attempt > 100 || backend.exitCode != null) throw new Error(log || 'CLI did not start');
      await delay(50);
    }
  }
}
async function stopBackend() {
  backend.kill('SIGTERM'); if (backend.exitCode == null) await once(backend, 'exit');
}
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, browser: Browser | undefined, page: Page | undefined;
const checks: string[] = [], errors: string[] = [], requests: ObjectValue[] = [];
const report: ObjectValue = { checks, errors, renderer: '26.1013.40934', provider: 'loopback scripted Responses' };
async function startYard() {
  app = await createNativeWorkbench({ port: 0, dataDir, codexHome, workspace: root, socketPath,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
}
function complete(id: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { app!.control.off('message', listener); reject(new Error('Fixture turn timed out')); }, 20000);
    function listener(message: RpcMessage) {
      if (message.method !== 'turn/completed' || record(message.params).threadId !== id) return;
      clearTimeout(timer); app!.control.off('message', listener);
      const turn = record(record(message.params).turn);
      if (turn.status === 'failed') reject(new Error(JSON.stringify(turn))); else resolve();
    }
    app!.control.on('message', listener);
  });
}
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await writeFile(join(output, name + '-summary.json'), JSON.stringify(await summaryState(), null, 2));
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
}
async function summaryState() {
  return page!.evaluate(() => [...document.querySelectorAll('[data-summary-panel-variant]')].map(node => {
    const ancestors = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      ancestors.push({ tag: element.tagName, variant: element.getAttribute('data-summary-panel-variant'),
        aria: element.getAttribute('aria-hidden'), inert: element.hasAttribute('inert'),
        opacity: style.opacity, visibility: style.visibility, rect: [rect.x, rect.y, rect.width, rect.height] });
    }
    return ancestors;
  }));
}
const summary = () => page!.locator('[data-summary-panel-variant]:visible:not([aria-hidden="true"] *):not([inert] *)').first();
const row = (id: string) => summary().locator('[data-yard-sidechat-id="' + id + '"]').first();
const rootRows = (id: string) => page!.locator('#app-shell-sidebar [data-app-action-sidebar-thread-id="local:' + id + '"]');
async function openSummary(id: string) {
  const exit = page!.getByRole('button', { name: /^(退出完整视图|Exit full view)$/ });
  if (await exit.count()) await exit.click();
  // Inline-to-popover transitions retain their exiting DOM until animation end.
  await page!.waitForTimeout(350);
  const trigger = page!.getByRole('button', { name: /summary|摘要|概要|总结/i }).last();
  await summary().waitFor({ timeout: 2000 }).catch(() => {});
  if (!await summary().isVisible()) await trigger.click();
  await summary().waitFor();
  await page!.waitForFunction(summaryPainted, true);
  await page!.waitForFunction(id => (window as unknown as {
    workbenchSidechatThreads: { snapshot(host: string, id: string): { loaded: boolean } }
  }).workbenchSidechatThreads.snapshot('local', id).loaded, id);
}
function summaryPainted(wanted: boolean) {
  const painted = [...document.querySelectorAll('[data-summary-panel-variant]')].some(node => {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.right <= 0 || rect.left >= innerWidth) return false;
    for (let element: Element | null = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || Number(style.opacity) < 0.99 || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  });
  return painted === wanted;
}
async function openSidechat() {
  await page!.getByRole('button', { name: /^(新(?:建)?标签页|New tab)$/ }).first().click();
  const exit = page!.getByRole('button', { name: /^(退出完整视图|Exit full view)$/ });
  if (await exit.count()) await exit.click();
  await page!.locator('.yard-new-tab-card').getByText(/^(侧边聊天|Side chat)$/).click();
  await page!.getByText('This side chat is saved with its parent. Closing this panel keeps its history and running tasks.', { exact: true }).waitFor({ timeout: 20000 });
}
async function closeSidechat() {
  const right = page!.getByRole('complementary').last();
  await right.locator('[data-tab-id]:has([role="tab"][aria-selected="true"]) [data-app-shell-tab-close-button]').click();
  assert.equal(await page!.getByRole('dialog').filter({ hasNot: page!.locator('[data-summary-panel-variant]') }).count(), 0,
    'Saved sidechats do not show the unrecoverable-close dialog');
}
async function openPage(id: string) {
  page = await browser!.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', frame => {
    const value = record(JSON.parse(String(frame.payload)));
    if (value.request) requests.push(record(value.request));
  }));
  await page.addLocatorHandler(page.getByRole('button', { name: /^(继续使用当前模型|Continue with current model)$/ }), async button => { await button.click(); });
  await page.goto(app!.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
  await page.getByRole('textbox').last().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 60000 });
}

try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  await startBackend(); await startYard();
  report.cli = app!.control.server?.userAgent;
  assert.ok(supportsAttachedThreads(String(report.cli)), 'This validation requires CLI 0.169.1 or later');
  const { thread: parent } = await app!.control.request('thread/start', { cwd: root, historyMode: 'paginated' }, { mutating: true });
  await app!.control.request('thread/name/set', { threadId: parent.id, name: 'Parent conversation' }, { mutating: true });
  const completed = complete(parent.id);
  await app!.control.request('turn/start', { threadId: parent.id,
    input: [{ type: 'text', text: 'Create parent history', text_elements: [] }] }, { mutating: true });
  await completed;
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await openPage(parent.id);
  await page!.getByText('Parent saved response', { exact: true }).waitFor();
  assert.ok(requests.filter(request => record(request.params).attachedToThreadId)
    .every(request => record(request.params).attachedToThreadId === parent.id), 'Only the visible Summary reads children');
  assert.equal(await page!.locator('#app-shell-sidebar .yard-thread-disclosure').count(), 0);
  assert.equal(await page!.locator('#app-shell-sidebar .yard-thread-branch').count(), 0);
  await openSummary(parent.id);
  assert.equal(await summary().getByText('Side chats', { exact: true }).count(), 0, 'Empty parents have no Side chats section');
  await page!.getByRole('button', { name: /summary|摘要|概要|总结/i }).last().press('Enter');
  await page!.waitForFunction(summaryPainted, false);
  await page!.waitForTimeout(350);
  const childReads = () => requests.filter(request => record(request.params).attachedToThreadId).length;
  const before = childReads();
  await page!.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page!.waitForTimeout(300);
  assert.equal(childReads(), before, 'A hidden Summary does not read children after focus');
  await openSummary(parent.id);
  assert.equal(await summary().getByText('Side chats', { exact: true }).count(), 0);
  checks.push('Native sidebar rows have no wrapper or disclosure; the original Summary lazily loads sidechats');

  await openSidechat();
  const fork = requests.find(request => request.method === 'thread/fork')!;
  assert.equal(record(fork.params).attachToSource, true); assert.equal(record(fork.params).ephemeral, false);
  assert.ok(String(record(fork.params).developerInstructions).includes('You may rename this side conversation with the available set_thread_title tool.'));
  assert.ok(String(record(fork.params).developerInstructions).includes('Omit threadId so the tool targets this side conversation.'));
  const children = await app!.control.request<RpcPage<ThreadSummary>>('thread/list', { attachedToThreadId: parent.id });
  assert.equal(children.data.length, 1);
  const id = children.data[0]!.id;
  assert.equal(children.data[0]!.attachedToThreadId, parent.id);
  assert.equal(children.data[0]!.ephemeral, false);
  await openSummary(parent.id);
  await row(id).waitFor();
  assert.equal(await summary().getByText('Side chats', { exact: true }).count(), 1, 'Only the original localized section is rendered');
  assert.equal(await summary().locator('[data-yard-sidechat-id="' + id + '"]').count(), 1, 'An open saved child has one row');
  assert.equal(await page!.locator('[data-yard-sidechat-summary]').count(), 0, 'The added Summary surface has been removed');
  assert.equal(await rootRows(id).count(), 0);
  assert.ok(await rootRows(parent.id).count() > 0);
  await capture('01-created');
  checks.push('The actual Side chat action creates a persistent attachment in the parent Summary, without a child at the sidebar root');

  renameTo = '🩺 Sidechat named by its agent';
  await page!.getByRole('textbox').last().fill('SIDECHAT_REPLY');
  await page!.getByRole('textbox').last().press('Enter');
  await page!.getByText('Sidechat saved response', { exact: true }).waitFor({ timeout: 20000 });
  await openSummary(parent.id);
  const titled = (await app!.control.request('thread/read', { threadId: id, includeTurns: false })).thread;
  assert.equal(titled.name, '🩺 Sidechat named by its agent', 'The model can rename its own saved sidechat');
  assert.equal((await app!.control.request('thread/read', { threadId: parent.id, includeTurns: false })).thread.name, 'Parent conversation');
  assert.ok(titleResults.some(result => result.includes(id) && result.includes('🩺 Sidechat named by its agent')), 'Tool success returns to the sidechat model with its own ID');
  await row(id).getByText(titled.name, { exact: true }).waitFor();
  checks.push('A model-generated MCP call omits threadId and renames only the sidechat; its tool result and native Summary update agree');
  await app!.control.request('thread/name/set', { threadId: id, name: 'Side chat' }, { mutating: true });
  await row(id).getByText('SIDECHAT_REPLY', { exact: true }).waitFor();
  await app!.control.request('thread/name/set', { threadId: id, name: 'Saved side conversation' }, { mutating: true });
  await row(id).getByText('Saved side conversation', { exact: true }).waitFor();
  await capture('02-before-close');
  await closeSidechat();
  await openSummary(parent.id);
  const forksBeforeOpen = requests.filter(request => request.method === 'thread/fork').length;
  await row(id).click();
  await page!.getByRole('tabpanel').getByText('Sidechat saved response', { exact: true }).waitFor();
  assert.ok(await page!.getByText('Parent saved response', { exact: true }).isVisible(), 'The parent remains in the main transcript');
  assert.ok(decodeURIComponent(page!.url()).includes('/local/' + parent.id), 'Opening a sidechat does not navigate the main route');
  assert.equal(requests.filter(request => request.method === 'thread/fork').length, forksBeforeOpen, 'Opening a saved child does not fork another conversation');
  const roots = await app!.control.request<RpcPage<ThreadSummary>>('thread/list', {});
  assert.equal(roots.data.some(thread => thread.id === id), false);
  checks.push('Content titles persist; manual rename, one native section, closing and reopening in the right panel preserve the parent route without another fork');

  await page!.reload({ waitUntil: 'commit' });
  await page!.getByText('Parent saved response', { exact: true }).waitFor({ timeout: 60000 });
  await page!.waitForFunction(() => !document.getElementById('yard-startup'));
  await openSummary(parent.id);
  await row(id).waitFor();
  assert.equal(await rootRows(id).count(), 0);
  await page!.setViewportSize({ width: 800, height: 1100 });
  await openSummary(parent.id);
  assert.ok(await row(id).isVisible());
  await row(id).click();
  await page!.getByRole('tabpanel').getByText('Sidechat saved response', { exact: true }).waitFor();
  assert.ok(decodeURIComponent(page!.url()).includes('/local/' + parent.id));
  assert.ok(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture('03-reloaded-tablet');
  checks.push('Refreshing reconstructs the relationship from app-server without a duplicate root; tablet navigation fits');

  await page!.setViewportSize({ width: 1440, height: 1000 });
  await page!.close();
  await openPage(id);
  await openSummary(id);
  await openSidechat();
  const nested = await app!.control.request<RpcPage<ThreadSummary>>('thread/list', { attachedToThreadId: id });
  assert.equal(nested.data.length, 1);
  const nestedId = nested.data[0]!.id;
  await openSummary(id);
  await row(nestedId).waitFor();
  renameTo = '🩺 Sidechat renamed in the background'; renameWait = gate;
  await page!.getByRole('textbox').last().fill('SIDECHAT_RUNNING');
  await page!.getByRole('textbox').last().press('Enter');
  for (let attempt = 0; ; attempt++) {
    if ((await app!.control.request('thread/read', { threadId: nestedId, includeTurns: false })).thread.status.type === 'active') break;
    if (attempt > 100) throw new Error('The nested sidechat did not start');
    await delay(50);
  }
  await closeSidechat();
  assert.equal((await app!.control.request('thread/read', { threadId: nestedId, includeTurns: false })).thread.status.type, 'active');
  release();
  // A control connection that only reads a thread is not subscribed to its
  // turn notifications. Verify the backend's state, then the saved reply.
  for (let attempt = 0; ; attempt++) {
    if ((await app!.control.request('thread/read', { threadId: nestedId, includeTurns: false })).thread.status.type === 'idle') break;
    if (attempt > 200) throw new Error('The background sidechat did not complete');
    await delay(50);
  }
  await openSummary(id);
  await row(nestedId).getByText('🩺 Sidechat renamed in the background', { exact: true }).waitFor();
  assert.equal((await app!.control.request('thread/read', { threadId: id, includeTurns: false })).thread.name, 'Saved side conversation');
  await row(nestedId).click();
  await page!.getByText('Sidechat background response', { exact: true }).waitFor();
  await capture('04-background');
  checks.push('A nested sidechat can rename itself and finish through the permanent tool host after its running panel closes');

  await page!.close(); await app!.close(); await stopBackend();
  await rm(socketPath, { force: true });
  await startBackend(); await startYard();
  const restored = await app!.control.request<RpcPage<ThreadSummary>>('thread/list', { attachedToThreadId: parent.id });
  assert.equal(restored.data.find(thread => thread.id === id)?.name, 'Saved side conversation');
  await openPage(parent.id);
  await openSummary(parent.id);
  await row(id).click();
  await page!.getByText('Sidechat saved response', { exact: true }).waitFor({ timeout: 20000 });
  renameTo = '🩺 Sidechat renamed after restart';
  await page!.getByRole('textbox').last().fill('SIDECHAT_REPLY after restart');
  await page!.getByRole('textbox').last().press('Enter');
  await page!.getByText('Sidechat saved response', { exact: true }).last().waitFor({ timeout: 20000 });
  await openSummary(parent.id);
  await row(id).getByText('🩺 Sidechat renamed after restart', { exact: true }).waitFor({ timeout: 20000 });
  assert.equal((await app!.control.request('thread/read', { threadId: parent.id, includeTurns: false })).thread.name, 'Parent conversation');
  assert.equal(titleTools.length, 3);
  checks.push('After Yard and app-server restart, the existing sidechat can call the same tool to rename itself again');
  await capture('05-restarted');
  checks.push('A new Yard process, new app-server process and new page restore the Summary child and its saved messages');
  await closeSidechat();
  await openSummary(parent.id);
  await app!.control.request('thread/archive', { threadId: id }, { mutating: true });
  await row(id).waitFor({ state: 'hidden' });
  assert.equal(await summary().getByText('Side chats', { exact: true }).count(), 0);
  checks.push('Archiving the only child removes the native section');
  assert.deepEqual(errors, []);
  report.scriptedModelRequests = provider.requests; report.titleTools = titleTools; report.titleResults = titleResults; report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  report.titleTools = titleTools; report.titleResults = titleResults;
  await capture('failure').catch(() => {}); throw error;
} finally {
  release();
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'backend.log'), log);
  await writeFile(join(output, 'requests.json'), JSON.stringify(requests, null, 2) + '\n');
  await browser?.close(); await app?.close();
  if (backend! && backend.exitCode == null) await stopBackend();
  provider.server.closeAllConnections(); await new Promise<void>(resolve => provider.server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
