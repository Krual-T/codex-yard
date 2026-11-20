// Pinned renderer + an isolated real CLI; all model responses come from loopback.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import type { RpcMessage, ThreadSummary } from '../lib/codex-protocol.ts';
import { record } from '../src/native/protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createCliResponsesFixture } from './cli-responses-fixture.ts';

const root = await mkdtemp('/tmp/yard-hooks-review-');
const codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_HOOKS_EVIDENCE ?? '.local/hooks-review');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Hooks review fixture', path: root }]));
const provider = await createCliResponsesFixture(() => ({ text: 'Hooks review fixture response' }));
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[features]
code_mode = false
[model_providers.fixture]
name = "Hooks review fixture"
base_url = "http://127.0.0.1:${provider.port}/v1"
wire_api = "responses"
requires_openai_auth = false
`, { mode: 0o600 });
await writeFile(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: Object.fromEntries(
  ['UserPromptSubmit', 'PostToolUse', 'Stop'].map(event => [event, [{ hooks: [{ type: 'command', command: 'node -e ""' }] }]]),
) }));
const socketPath = join(root, 'backend.sock');
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  cwd: root, env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', data => { log = (log + String(data)).slice(-32000); });
child.stderr.on('data', data => { log = (log + String(data)).slice(-32000); });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, browser: Browser | undefined, page: Page | undefined;
const checks: string[] = [], errors: string[] = [], failedChunks: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', checks, errors, failedChunks };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await page.screenshot({ path: join(output, name + '.png') });
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
}
async function hooks() {
  const result = await app!.control.request<{ data: { hooks: { trustStatus: string }[] }[] }>('hooks/list', { cwds: [root] });
  return result.data.flatMap(entry => entry.hooks);
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  for (let attempt = 0; ; attempt++) {
    try { await access(socketPath); break; }
    catch {
      if (attempt >= 200 || child.exitCode !== null) throw new Error(log || 'CLI startup timed out');
      await delay(100);
    }
  }
  app = await createNativeWorkbench({ port: 0, dataDir, codexHome, workspace: root, socketPath,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  const { thread } = await app.control.request<{ thread: ThreadSummary }>('thread/start', { cwd: root, historyMode: 'paginated' }, { mutating: true });
  await app.control.request('thread/name/set', { threadId: thread.id, name: 'Hooks review fixture' }, { mutating: true });
  const completed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { app!.control.off('message', listener); reject(new Error('CLI turn timed out')); }, 20000);
    const listener = (message: RpcMessage) => {
      if (message.method === 'turn/completed' && record(message.params).threadId === thread.id) {
        clearTimeout(timer); app!.control.off('message', listener); resolve();
      }
    };
    app!.control.on('message', listener);
  });
  await app.control.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Hooks review fixture', text_elements: [] }] }, { mutating: true });
  await completed;
  assert.equal((await hooks()).filter(hook => hook.trustStatus === 'untrusted').length, 3);
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const url = app.url + '/?initialRoute=' + encodeURIComponent('/local/' + thread.id);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
  await page.goto(url, { waitUntil: 'commit' });
  const review = () => page!.getByRole('button', { name: /Review hooks|审查钩子|审核钩子/ });
  await review().click({ timeout: 60000 });
  await page.getByRole('dialog').waitFor();
  await capture('normal-dialog');
  assert.equal((await hooks()).filter(hook => hook.trustStatus === 'untrusted').length, 3,
    'Opening the review dialog must not approve any hook');
  await page.getByRole('button', { name: /^(Not now|暂不|暂时不要)$/ }).click();
  checks.push('The native review dialog opens with three real CLI hooks; opening and dismissing it leaves them untrusted');
  await context.close();

  // Only rewrite the lazy dialog import; the document, other assets and backend
  // stay unchanged. A fresh context avoids the already-cached successful import.
  const stale = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await stale.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
  page.on('response', response => {
    if (response.status() === 404 && response.url().includes('dialog-233ee8504409.js')) failedChunks.push(response.url());
  });
  await page.route('**/assets/button-2bc83ab46227.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const original = 'import(`./dialog-233ee8504409.js`)';
    assert.ok(body.includes(original), 'Pinned Hooks button changed; update the missing-chunk fixture');
    await route.fulfill({ response, body: body.replace(original, 'import(`/web-renderer-removed/assets/dialog-233ee8504409.js`)') });
  });
  await page.goto(url, { waitUntil: 'commit' });
  const composer = () => page!.locator('main [contenteditable="true"]').first();
  await composer().fill('Keep this unsent Hooks review draft', { timeout: 60000 });
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page!.mainFrame()) navigations++; });
  await review().click();
  await page.getByText('页面组件加载失败', { exact: true }).waitFor({ timeout: 10000 });
  const refresh = page.getByRole('button', { name: '刷新页面', exact: true });
  await refresh.waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.ok(failedChunks.length > 0, 'The failed dialog import must really return 404');
  // The normal toast expires after five seconds. Recovery must remain available
  // while the user reviews their unsent text and decides when to reload.
  await delay(5500);
  assert.equal(navigations, 0);
  assert.equal(await composer().innerText(), 'Keep this unsent Hooks review draft');
  assert.equal(await refresh.isVisible(), true);
  assert.equal((await hooks()).filter(hook => hook.trustStatus === 'untrusted').length, 3);
  await capture('missing-chunk-recovery');
  checks.push('A real missing dialog chunk shows a persistent refresh action, keeps the unsent draft and never reloads or approves automatically');

  await page.unrouteAll();
  await refresh.click();
  await review().waitFor({ timeout: 60000 });
  await composer().waitFor();
  assert.equal(await composer().innerText(), 'Keep this unsent Hooks review draft');
  await review().click();
  await page.getByRole('dialog').waitFor();
  await capture('recovered-dialog');
  await page.getByRole('button', { name: /^(Allow all|允许全部|全部允许)$/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await hooks()).filter(hook => hook.trustStatus === 'trusted').length, 3);
  await page.reload({ waitUntil: 'commit' });
  await composer().waitFor({ timeout: 60000 });
  await page.getByText('Hooks review fixture response', { exact: true }).waitFor();
  assert.equal(await review().count(), 0);
  assert.equal((await hooks()).filter(hook => hook.trustStatus === 'trusted').length, 3);
  checks.push('The refresh action restores the native dialog and draft; Allow all persists trust in the real CLI and removes the pending review after reload');
  assert.deepEqual(errors, []);
  report.modelRequests = provider.requests;
  report.ok = true;
} catch (cause) {
  report.ok = false;
  report.error = cause instanceof Error ? cause.stack : String(cause);
  report.cliLog = log;
  await capture('failure');
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
  child.kill('SIGTERM');
  if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(3000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  provider.server.closeAllConnections();
  await new Promise<void>(resolve => provider.server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
