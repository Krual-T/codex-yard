/** Actual original Browser client/service in native Node REPL, through a
 * disposable Codex CLI and a loopback scripted model. No external model calls. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { connect } from 'node:net';
import { CodexConnection } from '../lib/codex.ts';
import { nodeReplConfig } from '../lib/standalone-tools.ts';
import { projectRoot } from '../lib/app-resources.ts';
import { startIabHost } from '../lib/browser-iab.ts';
import { record } from '../src/native/protocol.ts';
import type { RpcMessage } from '../lib/codex-protocol.ts';

const root = await mkdtemp('/tmp/yard-iab-'), home = join(root, 'home'), workspace = join(root, 'workspace'), socket = join(root, 'codex.sock');
const codex = process.env.AGENTS_TEST_CODEX_BIN || process.env.AGENTS_CODEX_BIN || 'codex';
const evidence = resolve(process.env.AGENTS_IAB_EVIDENCE || '.local/original-iab');
await Promise.all([mkdir(home), mkdir(workspace), mkdir(evidence, { recursive: true })]);
const checks: string[] = [], events: RpcMessage[] = [], report: Record<string, unknown> = { checks, externalModelRequests: 0 };
let code: string | undefined, callId = 0, lastInput = '', providerError: unknown, stderr = '';
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
        const item = record(raw); return item.type === 'namespace' && Array.isArray(item.tools) ? item.tools.map(t => String(item.name) + '.' + String(record(t).name)) : [String(item.name)];
      });
      const name = tools.find(name => name.includes('node_repl') && /(?:__|\.)js$/.test(name)); assert.ok(name, tools.join(','));
      const activeCode = code; code = undefined; ++callId;
      response(res, { id: 'fixture-' + callId, type: 'function_call', call_id: 'call-' + callId,
        ...(name.includes('.') ? { namespace: name.slice(0, name.lastIndexOf('.')), name: name.slice(name.lastIndexOf('.') + 1) } : { name }), arguments: JSON.stringify({ code: activeCode }) });
    } else {
      const inputs = Array.isArray(value.input) ? value.input : [];
      lastInput = JSON.stringify(inputs.filter(v => record(v).type === 'function_call_output').at(-1));
      response(res, { id: 'done-' + callId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'IAB_FIXTURE_DONE', annotations: [] }] });
    }
  } catch (cause) { providerError = cause; res.writeHead(500); res.end(String(cause)); }
});
const site = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (req.url === '/frame') { res.end('<button onclick="this.textContent=\'Frame clicked\'">Frame click</button>'); return; }
  if (req.url === '/popup') { res.end('<title>Fixture popup</title><h1>Fixture popup</h1>'); return; }
  res.end('<title>Yard Browser fixture</title><h1>Original Browser fixture</h1><button onclick="this.textContent=\'Clicked\'">Click</button><input aria-label="Fixture text"><output></output>' +
    // Keep the original client's click point on the link when fonts and the
    // preceding output make the surrounding inline content wrap.
    '<iframe title="Fixture frame" src="http://localhost:' + (site.address() as { port: number }).port + '/frame"></iframe><a target="_blank" href="/popup" style="display:inline-block">Open popup</a>' +
    '<script>document.querySelector("input").oninput=e=>document.querySelector("output").textContent=e.target.value;</script>');
});
await Promise.all([new Promise<void>(r => provider.listen(0, '127.0.0.1', r)), new Promise<void>(r => site.listen(0, '127.0.0.1', r))]);
const providerPort = (provider.address() as { port: number }).port, origin = 'http://127.0.0.1:' + (site.address() as { port: number }).port;
const iab = await startIabHost({ socketPath: join(root, 'browser.sock'), dataDirectory: join(root, 'browser'),
  executablePath: process.env.AGENTS_TEST_CHROMIUM || join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: process.env.AGENTS_TEST_BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
const backend = new CodexConnection(socket);
let child: ReturnType<typeof spawn> | undefined, exited: Promise<void> | undefined;
async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) { if (Date.now() >= deadline) throw new Error(label + ': ' + stderr); await delay(40); }
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  await mkdir(join(home, 'browser'));
  // The approvals belong only to these synthetic loopback pages and this
  // disposable Codex home. Production Yard does not write browser approvals.
  await writeFile(join(home, 'browser/config.toml'), 'approval_mode="never_ask"\n');
  await writeFile(join(home, 'config.toml'), `model="fixture"
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
  child = spawn(codex, ['app-server', '--listen', 'unix://' + socket], { env: { ...process.env, CODEX_HOME: home }, stdio: ['ignore', 'ignore', 'pipe'] });
  let launchError: Error | undefined;
  exited = new Promise(resolve => child!.once('close', () => resolve()));
  child.once('error', error => { launchError = error; });
  child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-12000); });
  await until(async () => { if (launchError) throw launchError; try { await access(socket); return true; } catch { return false; } }, 'CLI start');
  await backend.connect(); report.cli = backend.server?.userAgent;
  backend.on('message', event => events.push(event));
  await backend.request('marketplace/add', { source: projectRoot });
  await backend.request('plugin/install', { marketplacePath: join(projectRoot, '.agents/plugins/marketplace.json'), pluginName: 'browser', installAttemptId: 'original-iab' });
  interface Hook { key: string; currentHash: string; pluginId: string }
  const hooks = await backend.request<{ data: { hooks: Hook[] }[] }>('hooks/list', { cwds: [workspace] });
  const browserHooks = hooks.data.flatMap(entry => entry.hooks).filter(hook => hook.pluginId === 'browser@codex-yard');
  assert.equal(browserHooks.length, 3);
  await backend.request('config/batchWrite', { edits: browserHooks.map(hook => ({ keyPath: `hooks.state.${JSON.stringify(hook.key)}.trusted_hash`, value: hook.currentHash, mergeStrategy: 'upsert' })), filePath: null, expectedVersion: null, reloadUserConfig: true });
  const config = nodeReplConfig({ mcp_servers: { node_repl: { tools: { js: { approval_mode: 'approve' } } } } }, {
    ...process.env, AGENTS_CODEX_BIN: codex, CODEX_HOME: home,
    YARD_IAB_SOCKET: iab.socketPath, YARD_BROWSER_BACKEND_PATHS: iab.socketPath,
  }, ['browser@codex-yard']);
  config['mcp_servers.node_repl'].env.BROWSER_USE_DISABLE_AMBIENT_NETWORK = '1';
  const started = await backend.request('thread/start', { cwd: workspace, ephemeral: true, config }), threadId = started.thread.id;
  report.thread = threadId;
  async function js(source: string, expected: string) {
    lastInput = ''; code = source;
    const turn = await backend.request('turn/start', { threadId, input: [{ type: 'text', text: 'Run the synthetic independent Browser fixture.', text_elements: [] }] });
    await until(() => events.some(e => e.method === 'turn/completed' && record(record(e.params).turn).id === turn.turn.id), expected, 45_000);
    if (providerError) throw providerError;
    assert.ok(lastInput.includes(expected), lastInput.slice(-5000)); checks.push(expected);
    await writeFile(join(evidence, 'last-model-tool-output.json'), lastInput);
  }
  const client = join(projectRoot, 'plugins/browser/scripts/browser-client.mjs');
  await js(`var { setupBrowserRuntime } = await import(${JSON.stringify(client)}); var agent = await setupBrowserRuntime(); var iab = await agent.browsers.get('iab'); nodeRepl.write(await iab.documentation());`, '# Selected Browser');
  await writeFile(join(evidence, 'original-documentation.json'), lastInput);
  await js(`var tab = await iab.tabs.new(); await tab.goto(${JSON.stringify(origin)}); nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markHandoff();`, 'Original Browser fixture');
  await js(`await tab.playwright.getByRole('button',{name:'Click',exact:true}).click(); nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markHandoff();`, 'Clicked');
  await js(`await tab.playwright.getByRole('textbox',{name:'Fixture text'}).fill('Independent Browser'); nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markHandoff();`, 'Independent Browser');
  await js(`await tab.playwright.frameLocator('iframe[title="Fixture frame"]').getByRole('button',{name:'Frame click',exact:true}).click(); nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markHandoff();`, 'Frame clicked');
  await js(`await nodeRepl.emitImage(await tab.screenshot({fullPage:false})); await tab.markHandoff(); nodeRepl.write('IAB_ORIGINAL_SCREENSHOT');`, 'IAB_ORIGINAL_SCREENSHOT');
  await js(`nodeRepl.write(JSON.stringify(await nodeRepl.rpc('browser',{method:'execute',params:{type:'browser_user_get_tab_context',browser_id:'iab'}}))); await tab.markHandoff();`, 'Independent Browser');
  const panel = await iab.panel({ sessionId: threadId, operation: 'state' });
  assert.equal(panel.tabs.length, 1); assert.equal(panel.tabs[0].url, origin + '/'); assert.ok(panel.frame?.image.startsWith('data:image/jpeg;base64,'));
  await writeFile(join(evidence, 'page.jpg'), Buffer.from(panel.frame!.image.split(',')[1], 'base64')); checks.push('UI shares original iab page');
  assert.deepEqual((await iab.panel({ sessionId: 'other-fixture', operation: 'state' })).tabs, []); checks.push('conversation tab isolation');
  // A temporary unmarked tab closes through the original trusted Stop hook.
  await js(`var temporary = await iab.tabs.new(); await temporary.goto(${JSON.stringify(origin)}); await tab.markHandoff(); nodeRepl.write('IAB_TEMPORARY_CREATED');`, 'IAB_TEMPORARY_CREATED');
  await until(async () => (await iab.panel({ sessionId: threadId, operation: 'state' })).tabs.length === 1, 'original temporary tab cleanup'); checks.push('temporary tab Stop cleanup; handoff survives');
  await js(`nodeRepl.write(JSON.stringify(await nodeRepl.rpc('browser',{method:'execute',params:{type:'browser_user_get_tab_context',browser_id:'iab'}}))); await tab.markHandoff();`, 'Independent Browser');
  checks.push('Stop restores the surviving handoff as the active ambient tab');
  // Native MCP reset closes its socket, while the persistent host retains the
  // marked page. A new kernel reconnects through the unchanged original API.
  await backend.request('mcpServer/tool/call', { threadId, server: 'node_repl', tool: 'js_reset', arguments: {} });
  assert.equal((await iab.panel({ sessionId: threadId, operation: 'state' })).tabs.length, 1);
  await js(`var { setupBrowserRuntime } = await import(${JSON.stringify(client)}); var agent = await setupBrowserRuntime(); var iab = await agent.browsers.get('iab'); nodeRepl.write(await iab.documentation());`, '# Selected Browser');
  await js(`var tabs = await iab.tabs.list(); var tab = await iab.tabs.get(tabs[0].id); nodeRepl.write(await tab.playwright.domSnapshot()); await tab.markDeliverable();`, 'Independent Browser');
  checks.push('native reset and original reconnect preserve page');
  await js(`await tab.playwright.getByRole('link',{name:'Open popup',exact:true}).click(); nodeRepl.write(JSON.stringify(await iab.tabs.list())); await tab.markHandoff();`, 'Fixture popup');
  await until(async () => (await iab.panel({ sessionId: threadId, operation: 'state' })).tabs.length === 1, 'unmarked popup cleanup'); checks.push('session popup discovery and cleanup');
  // Verify the host explicitly refuses a real restricted attach on the same
  // tab; no partial network enforcement is presented as support.
  const native = connect(iab.socketPath); await once(native, 'connect');
  const restricted = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'attach', params: { session_id: threadId, turn_id: 'restriction-fixture', tabId: panel.tabs[0].id,
    networkPolicy: { constraints: [{ kind: 'domains', mode: 'allowlist', patterns: [] }] } } }));
  const length = Buffer.alloc(4); length.writeUInt32LE(restricted.length); native.write(Buffer.concat([length, restricted]));
  let reply = Buffer.alloc(0);
  const denied = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('restricted attach response timeout')), 3000);
    native.on('data', chunk => { reply = Buffer.concat([reply, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]); if (reply.length >= 4 && reply.length >= reply.readUInt32LE() + 4) { clearTimeout(timer); resolve(reply.subarray(4).toString()); } });
  });
  try { assert.match(await denied, /does not yet support restricted network policies/); checks.push('restricted network policy refuses attach'); } finally { native.destroy(); }
  report.status = 'passed'; await writeFile(join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error); report.stderr = stderr;
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n'); throw error;
} finally {
  backend.close();
  if (child?.pid && child.exitCode == null) { child.kill('SIGTERM'); const stop = setTimeout(() => child?.kill('SIGKILL'), 3000); await exited; clearTimeout(stop); }
  await iab.close(); site.closeAllConnections(); provider.closeAllConnections();
  await Promise.all([new Promise<void>(r => site.close(() => r())), new Promise<void>(r => provider.close(() => r()))]);
  await rm(root, { recursive: true, force: true });
}
