// Run from a clean build with the desktop installation masked and the heavy-test lock held.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { RpcMessage, ThreadSummary } from '../lib/codex-protocol.ts';
import { deepseekModels } from '../src/native/deepseek-models.ts';
import { record } from '../src/native/protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createCliResponsesFixture } from './cli-responses-fixture.ts';

const root = await mkdtemp('/tmp/yard-navigation-cli-');
const output = resolve(process.env.AGENTS_NAVIGATION_CLI_EVIDENCE ?? '.local/message-navigation/cli');
const codexHome = join(root, 'codex');
await Promise.all([mkdir(codexHome), mkdir(output, { recursive: true })]);
const provider = await createCliResponsesFixture(() => ({ text: 'CLI navigation reply ' + provider.requests + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Paragraph ${index}: independent navigation with the real Codex CLI.`).join('\n\n') }));
const catalog = join(codexHome, 'models.json');
await writeFile(catalog, JSON.stringify({ models: [{ ...deepseekModels[0], slug: 'gpt-5.2-codex', display_name: 'Navigation fixture', shell_type: 'unified_exec' }] }));
await writeFile(join(codexHome, 'config.toml'), [
  'model = "gpt-5.2-codex"', 'model_provider = "fixture"', 'model_catalog_json = ' + JSON.stringify(catalog),
  'approval_policy = "on-request"', 'sandbox_mode = "read-only"', '[model_providers.fixture]', 'name = "Navigation fixture"',
  'base_url = "http://127.0.0.1:' + provider.port + '/v1"', 'wire_api = "responses"', 'requires_openai_auth = false',
].join('\n'), { mode: 0o600 });
const socketPath = join(root, 'backend.sock');
const daemon = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'ignore', 'pipe'],
});
let log = '', spawnError: Error | undefined;
daemon.stderr.on('data', chunk => { log += chunk; });
daemon.on('error', error => { spawnError = error; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { errors, checks, referenceUi: '26.1013.40934', provider: 'loopback scripted Responses' };
try {
  for (let tick = 0; ; tick++) {
    if (spawnError) throw spawnError;
    try { await access(socketPath); break; } catch {
      if (tick >= 100 || daemon.exitCode !== null) throw new Error(log || 'CLI socket did not start');
      await delay(100);
    }
  }
  app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), codexHome, workspace: root, socketPath,
    sourceWorkspace: true, hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  const { thread } = await app.control.request<{ thread: ThreadSummary }>('thread/start', { cwd: root, historyMode: 'paginated' }, { mutating: true });
  for (let turn = 0; turn < 8; turn++) {
    const control = app.control;
    const complete = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { control.off('message', listener); reject(new Error('CLI turn timed out')); }, 20000);
      function listener(message: RpcMessage) {
        const params = record(message.params);
        if (message.method !== 'turn/completed' || params.threadId !== thread.id) return;
        clearTimeout(timer); control.off('message', listener);
        if (record(params.turn).status === 'failed') reject(new Error(JSON.stringify(params.turn))); else resolve();
      }
      control.on('message', listener);
    });
    await control.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'CLI navigation prompt ' + turn, text_elements: [] }] }, { mutating: true });
    await complete;
  }
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  const reads: Record<string, unknown>[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    const message = record(JSON.parse(String(frame.payload))), rpc = record(message.request);
    if (rpc.method === 'thread/turns/list') reads.push(record(rpc.params));
  }));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + thread.id), { waitUntil: 'commit' });
  const rail = page.getByRole('navigation', { name: 'Message navigation', exact: true });
  await rail.getByRole('button').first().waitFor({ timeout: 30000 });
  assert.equal(await rail.getByRole('button').count(), 8);
  const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first();
  await editor.fill('Standalone navigation draft');
  await rail.getByRole('button', { name: 'Go to message 1', exact: true }).hover();
  await page.getByRole('tooltip').getByText('CLI navigation prompt 0', { exact: true }).waitFor();
  await rail.getByRole('button', { name: 'Go to message 1', exact: true }).click();
  await page.getByRole('region', { name: 'Conversation', exact: true }).getByText('CLI navigation prompt 0', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-message-navigation-id]'), root = document.querySelector('.yard-source-transcript');
    return node && root && node.getBoundingClientRect().top >= root.getBoundingClientRect().top;
  });
  assert.equal(await editor.innerText(), 'Standalone navigation draft');
  await page.screenshot({ path: join(output, 'old-message.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click();
  await page.getByRole('region', { name: 'Conversation', exact: true }).getByText('CLI navigation prompt 7', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await rail.waitFor({ state: 'detached' });
  await page.screenshot({ path: join(output, 'right-pane.png'), animations: 'disabled' });
  assert.ok(reads.some(read => read.itemsView === 'notLoaded'));
  assert.ok(reads.some(read => read.itemsView === 'summary' && read.limit === 1));
  assert.ok(!reads.some(read => read.itemsView === 'full'));
  checks.push('Real CLI metadata, delayed summary preview, old-message seek and return to latest', 'Draft retained; right pane hides the rail; no full tool-history reads');
  assert.deepEqual(errors, []); report.ok = true; report.reads = reads;
} catch (error) { report.ok = false; report.failure = String(error); throw error; }
finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close();
  if (daemon.pid && daemon.exitCode === null && daemon.signalCode === null) { daemon.kill('SIGTERM'); await once(daemon, 'exit'); }
  await new Promise<void>(resolve => provider.server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
