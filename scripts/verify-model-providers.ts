// Hold /tmp/agents-workbench-heavy.lock. Uses its own CLI home, daemon and chats.
// Optional --live-deepseek uses YARD_TEST_DEEPSEEK_KEY, never written to evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { deepseekModels } from '../src/native/deepseek-models.ts';
import { modelIdentity } from '../src/native/model-selection.ts';
import { record } from '../src/native/protocol.ts';

const live = process.argv.includes('--live-deepseek');
if (live && !process.env.YARD_TEST_DEEPSEEK_KEY) throw new Error('YARD_TEST_DEEPSEEK_KEY is required');
const root = await mkdtemp('/tmp/yard-provider-ui-'), codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_MODEL_PROVIDERS_EVIDENCE ?? '.local/model-providers');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
const checks: string[] = [], errors: string[] = [], requests: Record<string, unknown>[] = [];
const browserRequests: unknown[] = [], browserFailures: unknown[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: '26.1013.40934', liveDeepseek: live };
const upstream = createServer(async (request, response) => {
  if (request.url?.endsWith('/models')) { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'shared-model' }] })); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  if (!request.url?.endsWith('/responses')) { response.writeHead(404).end('{}'); return; }
  const value = record(JSON.parse(body)); requests.push({ provider: request.url.split('/')[1], ...value });
  const input = Array.isArray(value.input) ? value.input.map(record) : [];
  const hasTool = input.some(item => item.type === 'function_call_output');
  const marker = request.url.startsWith('/Beta/') ? 'YARD_BETA_OK' : 'YARD_ALPHA_OK';
  const id = 'response-' + requests.length;
  const item = !hasTool ? { id: 'call-' + requests.length, type: 'function_call', name: 'exec_command', call_id: 'call-' + requests.length,
    arguments: JSON.stringify({ cmd: 'printf YARD_PROVIDER_TOOL_OK', max_output_tokens: 100 }), status: 'completed' }
    : { id: 'message-' + requests.length, type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed',
      content: [{ type: 'output_text', text: marker, annotations: [] }] };
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { id, object: 'response', status: 'completed', output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } }); response.end();
});
await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
const port = (upstream.address() as import('node:net').AddressInfo).port;
await writeFile(join(codexHome, 'models.json'), JSON.stringify({ models: [{ ...deepseekModels[0], slug: 'shared-model', display_name: 'Shared model', shell_type: 'unified_exec',
  supported_reasoning_levels: [{ effort: 'low', description: 'Low' }, { effort: 'high', description: 'High' }] }] }));
await writeFile(join(codexHome, 'config.toml'), `model="shared-model"\nmodel_provider="Alpha"\nmodel_reasoning_effort="high"\nmodel_catalog_json=${JSON.stringify(join(codexHome, 'models.json'))}\napproval_policy="never"\nsandbox_mode="danger-full-access"\n[features]\ncode_mode=false\n` +
  ['Alpha', 'Beta'].map(id => `[model_providers.${id}]\nname="${id}"\nbase_url="http://127.0.0.1:${port}/${id}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`).join('') +
  '[model_providers.DeepSeek]\nname="DeepSeek"\nbase_url="https://api.deepseek.com/"\nwire_api="responses"\nrequires_openai_auth=false\nenv_key="YARD_TEST_DEEPSEEK_KEY"\n', { mode: 0o600 });
const socketPath = join(root, 'backend.sock');
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  env: { PATH: process.env.PATH, LANG: 'C.UTF-8', CODEX_HOME: codexHome, YARD_TEST_DEEPSEEK_KEY: process.env.YARD_TEST_DEEPSEEK_KEY ?? 'unused-test-key' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, page: Page | undefined, socket: WebSocket | undefined;
const replies: Record<string, unknown>[] = []; let nextId = 0;
async function rpc(method: string, params: Record<string, unknown>) {
  const id = ++nextId;
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => { socket?.off('message', listener); reject(new Error('RPC timed out: ' + method)); }, 30_000);
    const listener = (bytes: WebSocket.RawData) => {
      const message = JSON.parse(String(bytes));
      if (message.type !== 'mcp-response' || message.message?.id !== id) return;
      clearTimeout(timer); socket!.off('message', listener);
      if (message.message.error) reject(new Error(message.message.error.message)); else resolve(message.message.result);
    };
    socket!.on('message', listener);
  });
  socket!.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }));
  return result;
}
async function until(read: () => Promise<boolean>, message: string, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!await read()) { if (Date.now() >= deadline) throw new Error(message); await delay(100); }
}
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation =>
    Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))); });
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
}
async function picker() {
  await page!.getByRole('button', { name: /Shared model|DeepSeek/ }).last().click();
  const select = page!.getByRole('menuitem', { name: /^(选择模型|Select model)$/ });
  if (await select.isVisible()) await select.click();
  await page!.locator('[data-yard-provider-menu]').waitFor();
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  await until(async () => { try { await access(socketPath); return true; } catch { if (child.exitCode !== null) throw new Error(log); return false; } }, 'CLI socket did not start');
  app = await createNativeWorkbench({ port: 0, dataDir, codexHome, workspace: root, socketPath, hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('Offline telemetry', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
  socket.on('message', bytes => replies.push(JSON.parse(String(bytes)))); await once(socket, 'open');
  await rpc('config/read', {});
  const started = await rpc('thread/start', { cwd: root, model: modelIdentity('Alpha', 'shared-model'), historyMode: 'paginated' });
  const threadId = String(record(started.thread).id); report.threadId = threadId;
  await rpc('thread/name/set', { threadId, name: 'Provider routing fixture' });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => {
    ws.on('framesent', frame => { const message = JSON.parse(String(frame.payload)); if (message.request) browserRequests.push(message.request); });
    ws.on('framereceived', frame => { const message = JSON.parse(String(frame.payload)); if (message.message?.error || message.responseType === 'error') browserFailures.push(message); });
  });
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByRole('button', { name: /Shared model/ }).last().waitFor({ timeout: 60_000 });
  await picker(); await capture('provider-menu');
  await page.getByRole('menuitem', { name: /^Beta/ }).click();
  await capture('duplicate-model-menu');
  await page.getByRole('menuitemradio', { name: 'Shared model', exact: true }).click();
  await page.getByRole('menuitem', { name: /^(强度|Power)$/ }).press('Enter');
  await until(async () => record((await app!.control.request('thread/read', { threadId, includeTurns: false })).thread).modelProvider === 'Beta', 'UI did not route to Beta');
  checks.push('Pinned UI selects a duplicate model under Beta and switches the same real CLI thread with two subscribers');
  await page.keyboard.press('Escape');
  await rpc('turn/start', { threadId, model: modelIdentity('Beta', 'shared-model'), effort: 'high', input: [{ type: 'text', text: 'YARD_FIRST_PROVIDER_PROMPT', text_elements: [] }] });
  await until(async () => replies.some(message => message.method === 'turn/completed'), 'Beta tool loop did not finish');
  assert.equal(requests[0].provider, 'Beta'); assert.ok(requests.some(request => JSON.stringify(request.input).includes('YARD_PROVIDER_TOOL_OK')));
  await rpc('thread/settings/update', { threadId, model: modelIdentity('Alpha', 'shared-model'), effort: 'high' });
  await rpc('turn/start', { threadId, model: modelIdentity('Alpha', 'shared-model'), effort: 'high', input: [{ type: 'text', text: 'YARD_SECOND_PROVIDER_PROMPT', text_elements: [] }] });
  await until(async () => requests.some(request => request.provider === 'Alpha'), 'Alpha request missing');
  assert.ok(JSON.stringify(requests.at(-1)?.input).includes('YARD_FIRST_PROVIDER_PROMPT'));
  checks.push('Actual CLI executes a command tool, returns its output, and preserves history when switching back');
  await until(async () => (await app!.control.request('thread/read', { threadId, includeTurns: false })).thread.status.type === 'idle', 'Turn did not complete');
  const permissions = await rpc('thread/start', { cwd: root, model: modelIdentity('Alpha', 'shared-model'), sandbox: 'workspace-write', approvalPolicy: 'on-request',
    runtimeWorkspaceRoots: [root], config: { sandbox_workspace_write: { writable_roots: [root], network_access: true, exclude_tmpdir_env_var: true, exclude_slash_tmp: true } } });
  const permissionId = String(record(permissions.thread).id);
  await rpc('thread/name/set', { threadId: permissionId, name: 'Permission preservation fixture' });
  await rpc('thread/settings/update', { threadId: permissionId, collaborationMode: { mode: 'plan', settings: { model: modelIdentity('Alpha', 'shared-model'), reasoning_effort: 'high', developer_instructions: null } } });
  await rpc('thread/settings/update', { threadId: permissionId, model: modelIdentity('Beta', 'shared-model'), effort: 'high' });
  const restored = await rpc('thread/resume', { threadId: permissionId, excludeTurns: true });
  assert.deepEqual(restored.sandbox, permissions.sandbox);
  assert.equal(restored.approvalPolicy, 'on-request'); assert.deepEqual(restored.runtimeWorkspaceRoots, permissions.runtimeWorkspaceRoots);
  assert.equal(record(restored.collaborationMode).mode, 'plan');
  checks.push('Real CLI retains workspace sandbox, network permissions, runtime roots, approvals and Plan mode across a provider change');

  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/settings/general'), { waitUntil: 'commit' });
  const settings = page.locator('[data-yard-provider-settings]');
  await settings.getByRole('switch', { name: '启用 DeepSeek', exact: true }).waitFor({ timeout: 60_000 });
  await settings.getByRole('switch', { name: '启用 DeepSeek', exact: true }).click();
  await until(async () => {
    try { return JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')).globals['model-provider-enabled-by-host-id']?.local?.DeepSeek === false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }, 'Disable was not persisted');
  await capture('settings-disabled');
  await page.reload({ waitUntil: 'commit' });
  await settings.waitFor({ timeout: 60_000 });
  assert.equal(await settings.getByRole('switch', { name: '启用 DeepSeek', exact: true }).getAttribute('aria-checked'), 'false');
  checks.push('Settings reads the actual config providers and persists enablement after reload');
  await page.goto(app.url, { waitUntil: 'commit' });
  await page.getByRole('button', { name: /Shared model/ }).last().waitFor({ timeout: 60_000 });
  await picker(); assert.equal(await page.getByRole('menuitem', { name: /^DeepSeek/ }).count(), 0); await page.keyboard.press('Escape');
  // Enable through the same browser host API, without reloading the model page.
  await page.evaluate(async () => { await window.workbenchModelProviders({ hostId: 'local', operation: 'set-enabled', id: 'DeepSeek', enabled: true }); });
  await picker(); await page.getByRole('menuitem', { name: /^DeepSeek/ }).click();
  await page.getByRole('menuitemradio', { name: 'DeepSeek V4 Pro', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /DeepSeek V4 Pro/ }).waitFor();
  await page.getByRole('button', { name: /DeepSeek V4 Pro/ }).click();
  const power = page.getByRole('menuitem', { name: /^(强度|Power)$/ });
  await power.press('ArrowRight'); await page.keyboard.press('Escape');
  await until(async () => /model_reasoning_effort\s*=\s*"max"/.test(await readFile(join(codexHome, 'config.toml'), 'utf8')), 'DeepSeek Max was not saved');
  await capture('deepseek-max');
  checks.push('Enabling immediately refreshes the two-level menu; DeepSeek Pro exposes and saves Max effort');
  await page.setViewportSize({ width: 393, height: 852 }); await picker(); await capture('phone-provider-menu');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.keyboard.press('Escape');
  if (live) {
    const deepseek = await rpc('thread/start', { cwd: root, model: modelIdentity('DeepSeek', 'deepseek-v4-pro'), historyMode: 'paginated' });
    const id = String(record(deepseek.thread).id);
    const submitted = await rpc('turn/start', { threadId: id, model: modelIdentity('DeepSeek', 'deepseek-v4-pro'), effort: 'low',
      input: [{ type: 'text', text: '调用一次命令工具执行 printf YARD_DEEPSEEK_TOOL_OK，完成后只回复 YARD_DEEPSEEK_OK。不要读其他文件，不要联网。', text_elements: [] }] });
    const turnId = record(submitted.turn).id;
    const completed = () => replies.find(message => message.method === 'turn/completed' && record(message.params).threadId === id && record(record(message.params).turn).id === turnId);
    await until(async () => !!completed(), 'DeepSeek turn did not finish', 180_000);
    const terminal = record(record(completed()!.params).turn);
    report.deepseekTurn = { status: terminal.status, error: terminal.error };
    assert.equal(terminal.status, 'completed', JSON.stringify(terminal.error));
    const result = await app.control.request<{ data: unknown[] }>('thread/turns/list', { threadId: id, itemsView: 'full', sortDirection: 'desc', limit: 1 });
    const text = JSON.stringify(result.data);
    assert.ok(text.includes('YARD_DEEPSEEK_OK')); assert.ok(text.includes('commandExecution'));
    assert.ok(text.includes('YARD_DEEPSEEK_TOOL_OK'));
    report.deepseekToolLoop = true;
    checks.push('DATGS key completes an actual DeepSeek Pro command tool loop through CLI 0.164');
  }
  assert.deepEqual(errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = String(error); await capture('failure').catch(() => {}); throw error; }
finally {
  report.upstream = requests.map(value => ({ provider: value.provider, model: value.model, reasoning: value.reasoning }));
  await writeFile(join(output, 'browser-wire.json'), JSON.stringify({ requests: browserRequests, failures: browserFailures }, null, 2));
  socket?.close(); await browser?.close(); await app?.close();
  child.kill('SIGTERM'); await once(child, 'exit').catch(() => {});
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2).replaceAll(process.env.YARD_TEST_DEEPSEEK_KEY ?? 'unused-test-key', '[redacted]'));
  await writeFile(join(output, 'backend.log'), log.replaceAll(process.env.YARD_TEST_DEEPSEEK_KEY ?? 'unused-test-key', '[redacted]'));
  await rm(root, { recursive: true, force: true }); console.log(JSON.stringify({ ok: report.ok, output }));
}
