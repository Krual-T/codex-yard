/** Yard's complete original Browser integration, using a disposable real CLI,
 * a loopback scripted model and the actual React workspace. No model account or
 * desktop App is used. The explicit fixture approvals affect only this home. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { projectRoot } from '../lib/app-resources.ts';

const root = await mkdtemp('/tmp/yard-iab-ui-'), codexHome = join(root, 'home'), workspace = join(root, 'workspace'), dataDir = join(root, 'data');
const socketPath = join(root, 'codex.sock'), evidence = resolve(process.env.AGENTS_IAB_EVIDENCE || '.local/original-iab-ui');
await Promise.all([mkdir(codexHome), mkdir(workspace), mkdir(dataDir), mkdir(evidence, { recursive: true })]);
const checks: string[] = [], errors: string[] = [], messages: Record<string, any>[] = [];
const report: Record<string, unknown> = { checks, externalModelRequests: 0 };
let code: string | undefined, lastInput = '', callId = 0, providerError: unknown, stderr = '', sequence = 0;
function response(res: ServerResponse, item: Record<string, unknown>) {
  const base = { id: 'response-' + callId, object: 'response', created_at: 0, model: 'fixture', output: [] };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type: string, value: Record<string, unknown>) => res.write('data: ' + JSON.stringify({ type, ...value }) + '\n\n');
  event('response.created', { response: { ...base, status: 'in_progress' } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
  if (item.type === 'function_call') {
    event('response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: item.arguments });
    event('response.function_call_arguments.done', { output_index: 0, item_id: item.id, arguments: item.arguments });
  }
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { ...base, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }); res.end();
}
const provider = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  try {
    const value = record(JSON.parse(body));
    if (code !== undefined) {
      const tools = (Array.isArray(value.tools) ? value.tools : []).flatMap(raw => {
        const tool = record(raw); return tool.type === 'namespace' && Array.isArray(tool.tools) ? tool.tools.map(child => String(tool.name) + '.' + String(record(child).name)) : [String(tool.name)];
      });
      const name = tools.find(value => value.includes('node_repl') && /(?:__|\.)js$/.test(value)); assert.ok(name, tools.join(','));
      const source = code; code = undefined; ++callId;
      response(res, { id: 'fixture-' + callId, type: 'function_call', call_id: 'call-' + callId,
        ...(name.includes('.') ? { namespace: name.slice(0, name.lastIndexOf('.')), name: name.slice(name.lastIndexOf('.') + 1) } : { name }), arguments: JSON.stringify({ code: source }) });
    } else {
      lastInput = JSON.stringify((Array.isArray(value.input) ? value.input : []).filter(value => record(value).type === 'function_call_output').at(-1));
      response(res, { id: 'done-' + callId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'IAB_UI_FIXTURE_DONE', annotations: [] }] });
    }
  } catch (cause) { providerError = cause; res.writeHead(500); res.end(String(cause)); }
});
const site = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>Shared original Browser</title><style>body{font:20px sans-serif;margin:0}h1{margin:20px 32px}' +
    'button{position:absolute;left:32px;top:72px;width:180px;height:36px}input{position:absolute;left:32px;top:124px;width:220px;height:36px}' +
    'output{position:absolute;left:32px;top:184px}</style><h1>Original Browser shared page</h1>' +
    '<button onclick="this.textContent=\'UI clicked\'">Click fixture</button><input aria-label="Shared text"><output></output>' +
    '<script>document.querySelector("input").oninput=e=>document.querySelector("output").textContent=e.target.value;</script>');
});
await Promise.all([new Promise<void>(r => provider.listen(0, '127.0.0.1', r)), new Promise<void>(r => site.listen(0, '127.0.0.1', r))]);
const providerPort = (provider.address() as { port: number }).port, siteOrigin = 'http://127.0.0.1:' + (site.address() as { port: number }).port;
const executable = process.env.AGENTS_TEST_CHROMIUM || join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome');
const oldExecutable = process.env.YARD_BROWSER_EXECUTABLE, oldHeadless = process.env.YARD_BROWSER_HEADLESS;
const oldCodex = process.env.AGENTS_CODEX_BIN;
const codex = process.env.AGENTS_TEST_CODEX_BIN || oldCodex || 'codex';
let child: ReturnType<typeof spawn> | undefined, exited: Promise<void> | undefined;
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, web: WebSocket | undefined, browser: Browser | undefined, page: Page | undefined;
async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) { if (Date.now() >= deadline) throw new Error(label + ': ' + stderr); await delay(40); }
}
async function rpc<T = Record<string, any>>(method: string, params: unknown = {}): Promise<T> {
  const id = ++sequence, socket = web!;
  socket.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }));
  await until(() => messages.some(value => value.type === 'mcp-response' && value.message.id === id), method, 60_000);
  const message = messages.find(value => value.type === 'mcp-response' && value.message.id === id)!.message;
  if (message.error) throw new Error(method + ': ' + JSON.stringify(message.error));
  return message.result as T;
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  await mkdir(join(codexHome, 'browser'));
  await writeFile(join(codexHome, 'browser/config.toml'), 'approval_mode="never_ask"\n');
  await writeFile(join(codexHome, 'config.toml'), `model="fixture"
model_provider="fixture"
approval_policy="never"
sandbox_mode="danger-full-access"
[model_providers.fixture]
name="No external model"
base_url="http://127.0.0.1:${providerPort}/v1"
wire_api="responses"
requires_openai_auth=false
[features]
code_mode=false
plugins=true
`);
  // Only this disposable fixture may explicitly disable Chromium's sandbox.
  // The production Yard launcher does not add this flag.
  if (process.env.AGENTS_TEST_BROWSER_NO_SANDBOX === '1') {
    const wrapper = join(root, 'chromium-fixture');
    await writeFile(wrapper, '#!/bin/sh\nexec \'' + executable.replaceAll("'", "'\\''") + '\' --no-sandbox "$@"\n');
    await chmod(wrapper, 0o700); process.env.YARD_BROWSER_EXECUTABLE = wrapper;
  } else process.env.YARD_BROWSER_EXECUTABLE = executable;
  process.env.YARD_BROWSER_HEADLESS = 'true';
  // The native REPL's config helper must use the same independent CLI as the
  // backend, including when the caller selects only AGENTS_TEST_CODEX_BIN.
  process.env.AGENTS_CODEX_BIN = codex;
  child = spawn(codex, ['app-server', '--listen', 'unix://' + socketPath], { env: { ...process.env, CODEX_HOME: codexHome }, stdio: ['ignore', 'ignore', 'pipe'] });
  let launchError: Error | undefined;
  exited = new Promise(resolve => child!.once('close', () => resolve())); child.once('error', error => { launchError = error; });
  child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-12000); });
  await until(async () => { if (launchError) throw launchError; try { await access(socketPath); return true; } catch { return false; } }, 'CLI startup');
  app = await createNativeWorkbench({ port: 0, codexHome, workspace, socketPath, dataDir, sourceWorkspace: true,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  web = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
  web.on('message', data => messages.push(JSON.parse(String(data)))); await once(web, 'open');
  await rpc('marketplace/add', { source: projectRoot });
  await rpc('plugin/install', { marketplacePath: join(projectRoot, '.agents/plugins/marketplace.json'), pluginName: 'browser', installAttemptId: 'original-iab-ui' });
  const hooks = await rpc<{ data: { hooks: { key: string; currentHash: string; pluginId: string }[] }[] }>('hooks/list', { cwds: [workspace] });
  const browserHooks = hooks.data.flatMap(value => value.hooks).filter(value => value.pluginId === 'browser@codex-yard');
  assert.equal(browserHooks.length, 3);
  await rpc('config/batchWrite', { edits: browserHooks.map(hook => ({ keyPath: `hooks.state.${JSON.stringify(hook.key)}.trusted_hash`, value: hook.currentHash, mergeStrategy: 'upsert' })), filePath: null, expectedVersion: null, reloadUserConfig: true });
  // Yard supplies the native runtime, trusted service and session socket. The
  // only caller override authorizes js for our disposable loopback fixture.
  const started = await rpc('thread/start', { cwd: workspace, config: { 'mcp_servers.node_repl.tools.js.approval_mode': 'approve' } });
  const threadId = started.thread.id; report.thread = threadId;
  checks.push('Yard starts its IAB host and injects the original browser service through sessionToolsConfig');
  async function js(source: string, expected: string) {
    code = source; lastInput = '';
    const turn = await rpc('turn/start', { threadId, input: [{ type: 'text', text: 'Run the synthetic Browser UI fixture.', text_elements: [] }] });
    await until(() => messages.some(value => value.type === 'mcp-notification' && value.method === 'turn/completed' && record(record(value.params).turn).id === turn.turn.id), expected, 60_000);
    if (providerError) throw providerError;
    assert.ok(lastInput.includes(expected), lastInput.slice(-5000));
    await writeFile(join(evidence, 'last-model-tool-output.json'), lastInput);
  }
  const client = join(projectRoot, 'plugins/browser/scripts/browser-client.mjs');
  await js(`var {setupBrowserRuntime}=await import(${JSON.stringify(client)}); var agent=await setupBrowserRuntime(); var iab=await agent.browsers.get('iab'); nodeRepl.write(await iab.documentation());`, '# Selected Browser');
  await js(`var tab=await iab.tabs.new(); await tab.goto(${JSON.stringify(siteOrigin)}); nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markHandoff();`, 'Original Browser shared page');
  checks.push('The real model tool call uses the unchanged Browser client and marks the created tab for handoff');
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByRole('textbox', { name: /^(和 Codex 一起工作|Work with Codex)$/ }).waitFor({ timeout: 60_000 });
  async function openPanel() {
    const newTab = page!.getByRole('button', { name: 'New tab', exact: true }).first();
    const toggle = page!.getByRole('button', { name: 'Open right sidebar', exact: true });
    if (!await newTab.isVisible() && await toggle.count()) await toggle.click();
    const more = page!.getByRole('button', { name: '更多工具', exact: true });
    if (!await more.count()) await newTab.click();
    await more.click();
    await page!.getByRole('menuitem', { name: 'Agent Browser', exact: true }).click();
    await page!.getByRole('region', { name: 'Yard Browser', exact: true }).getByRole('img', { name: 'Shared original Browser', exact: true }).waitFor();
  }
  await openPanel();
  const panel = page.getByRole('region', { name: 'Yard Browser', exact: true });
  const image = panel.getByRole('img', { name: 'Shared original Browser', exact: true });
  assert.equal(await panel.getByRole('textbox', { name: 'Browser URL', exact: true }).inputValue(), siteOrigin + '/');
  await page.screenshot({ path: join(evidence, '01-agent-browser-shared.png') });
  checks.push('New tab → Agent Browser displays the original session URL and screenshot through Yard fetch routing');
  async function clickPage(x: number, y: number) {
    const size = await image.evaluate(node => ({ width: (node as HTMLImageElement).naturalWidth, height: (node as HTMLImageElement).naturalHeight }));
    const box = await image.boundingBox(); assert.ok(box && size.width && size.height);
    await image.click({ position: { x: x / size.width * box.width, y: y / size.height * box.height } });
  }
  await clickPage(100, 90); await clickPage(100, 142);
  await panel.getByRole('textbox', { name: 'Text for focused browser field', exact: true }).fill('UI shared input');
  await panel.getByRole('button', { name: '输入', exact: true }).click();
  await js(`nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markHandoff();`, 'UI shared input');
  assert.ok(lastInput.includes('UI clicked'), lastInput); checks.push('Screenshot clicks and text input in React reach the same page observed by the original Browser API');
  await page.getByRole('button', { name: 'Close Agent Browser tab', exact: true }).click();
  await openPanel();
  assert.equal(await panel.getByRole('textbox', { name: 'Browser URL', exact: true }).inputValue(), siteOrigin + '/');
  await js(`nodeRepl.write(JSON.stringify(await nodeRepl.rpc('browser',{method:'execute',params:{type:'browser_user_get_tab_context',browser_id:'iab'}}))); await tab.markHandoff();`, 'UI shared input');
  await page.screenshot({ path: join(evidence, '02-reopened-page-preserved.png') });
  checks.push('Closing and reopening the tool tab preserves its handoff page and input');
  await page.close();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByRole('textbox', { name: /^(和 Codex 一起工作|Work with Codex)$/ }).waitFor({ timeout: 60_000 });
  await openPanel();
  await js(`nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markHandoff();`, 'UI shared input');
  await page.screenshot({ path: join(evidence, '03-yard-page-reconnected.png') });
  checks.push('Closing the Yard page and opening a new client preserves the original browser and marked tab');
  assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); report.stderr = stderr;
  if (page) { report.uiText = await page.locator('body').innerText().catch(() => 'unavailable'); await page.screenshot({ path: join(evidence, 'failure.png'), timeout: 10_000 }).catch(() => {}); }
  process.exitCode = 1;
} finally {
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); web?.terminate(); await app?.close();
  if (child?.pid && child.exitCode == null) { child.kill('SIGTERM'); const stop = setTimeout(() => child?.kill('SIGKILL'), 3000); await exited; clearTimeout(stop); }
  site.closeAllConnections(); provider.closeAllConnections();
  await Promise.all([new Promise<void>(r => site.close(() => r())), new Promise<void>(r => provider.close(() => r()))]);
  if (oldExecutable === undefined) delete process.env.YARD_BROWSER_EXECUTABLE; else process.env.YARD_BROWSER_EXECUTABLE = oldExecutable;
  if (oldHeadless === undefined) delete process.env.YARD_BROWSER_HEADLESS; else process.env.YARD_BROWSER_HEADLESS = oldHeadless;
  if (oldCodex === undefined) delete process.env.AGENTS_CODEX_BIN; else process.env.AGENTS_CODEX_BIN = oldCodex;
  await rm(root, { recursive: true, force: true }); console.log(JSON.stringify(report, null, 2));
}
