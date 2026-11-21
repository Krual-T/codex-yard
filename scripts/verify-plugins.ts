// Real CLI plugin lifecycle through Yard's WebSocket bridge. All state lives in
// a disposable Codex home; no account, desktop App or model request is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { filePluginNames } from '../lib/standalone-tools.ts';
import { createPlugins } from '../src/native/plugins.ts';
const packages = [...filePluginNames, 'computer-use', 'browser', 'chrome'];

const root = await mkdtemp('/tmp/yard-plugin-cli-');
const codexHome = join(root, 'codex'), workspace = join(root, 'workspace'), dataDir = join(root, 'data');
const socketPath = join(root, 'backend.sock');
await Promise.all([mkdir(codexHome), mkdir(workspace), mkdir(dataDir)]);
const execute = promisify(execFile);
await execute('git', ['init', '-q', workspace]);
await cp(resolve('.agents/plugins'), join(workspace, '.agents/plugins'), { recursive: true });
await cp(resolve('plugins'), join(workspace, 'plugins'), { recursive: true, verbatimSymlinks: true });
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[features]
plugins = true
code_mode = false
[model_providers.fixture]
name = "No-network plugin validation"
base_url = "http://127.0.0.1:9/v1"
wire_api = "responses"
requires_openai_auth = false
`, { mode: 0o600 });
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  cwd: workspace, env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', data => { log = (log + String(data)).slice(-32000); });
child.stderr.on('data', data => { log = (log + String(data)).slice(-32000); });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, socket: WebSocket | undefined;
const checks: string[] = [];
const report: Record<string, unknown> = { checks, modelRequests: 0, root };
const startWorkbench = () => createNativeWorkbench({ port: 0, dataDir, workspace, socketPath, codexHome,
  sourceWorkspace: process.argv.includes('--source-workspace'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  const deadline = Date.now() + 30000;
  for (;;) {
    try { await access(socketPath); break; }
    catch { if (child.exitCode !== null || Date.now() > deadline) throw new Error(log || 'CLI startup timed out'); await delay(50); }
  }
  app = await startWorkbench();
  report.cli = app.control.server?.userAgent;
  const messages: Record<string, any>[] = [];
  async function connect() {
    const connection = new WebSocket(app!.url.replace('http', 'ws') + '/native-host', { origin: app!.url });
    connection.on('message', data => { messages.push(JSON.parse(String(data))); connection.emit('received'); });
    await once(connection, 'open');
    socket = connection;
  }
  await connect();
  let sequence = 0;
  async function rpc<T = Record<string, any>>(method: string, params: unknown = {}): Promise<T> {
    const id = ++sequence;
    const connection = socket!;
    connection.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }));
    const signal = AbortSignal.timeout(30000);
    let reply;
    while (!(reply = messages.find(value => value.type === 'mcp-response' && value.message.id === id))) await once(connection, 'received', { signal });
    if (reply.message.error) throw new Error(method + ': ' + JSON.stringify(reply.message.error));
    return reply.message.result as T;
  }
  const marketplacePath = join(workspace, '.agents/plugins/marketplace.json');
  const added = await rpc('marketplace/add', { source: workspace });
  assert.equal(added.marketplaceName, 'codex-yard');
  const listing = await rpc('plugin/list', { cwds: [workspace], marketplaceKinds: ['local'] });
  const market = listing.marketplaces.find((value: any) => value.name === 'codex-yard');
  assert.deepEqual(market.plugins.map((value: any) => value.name).sort(), [...packages].sort());
  checks.push('Real CLI discovers all eight canonical plugin packages through the Yard bridge');
  for (const name of packages) {
    await rpc('plugin/install', { marketplacePath, pluginName: name, installAttemptId: 'yard-validation-' + name });
    const plugin = await rpc('plugin/read', { marketplacePath, pluginName: name });
    assert.equal(plugin.plugin.summary.installed, true);
    assert.equal(plugin.plugin.summary.enabled, true);
  }
  for (const enabled of [false, true]) {
    await rpc('config/batchWrite', { edits: [{ keyPath: 'plugins."computer-use@codex-yard".enabled', value: enabled, mergeStrategy: 'upsert' }],
      filePath: null, expectedVersion: null, reloadUserConfig: true });
    assert.equal((await rpc('plugin/read', { marketplacePath, pluginName: 'computer-use' })).plugin.summary.enabled, enabled);
  }
  checks.push('Native plugin enable controls use the real CLI configuration contract');
  const allSkills = await rpc('skills/list', { cwds: [workspace], forceReload: true });
  const expectedSkills = ['documents:documents', 'pdf:pdf', 'spreadsheets:Spreadsheets', 'presentations:Presentations',
    'template-creator:template-creator', 'computer-use:computer-use', 'browser:control-in-app-browser', 'chrome:control-chrome'];
  for (const name of expectedSkills) {
    assert.ok(allSkills.data.flatMap((value: any) => value.skills).some((value: any) => value.name === name), name);
  }
  checks.push('Real CLI installs the original packages and loads the five separate file Skills and computer/browser Skills with their original names');
  if (process.argv.includes('--ui')) {
    const output = resolve(process.env.AGENTS_PLUGINS_EVIDENCE ?? '.local/plugins-cli');
    await mkdir(output, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', cause => errors.push(cause.message));
    try {
      await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/plugins'), { waitUntil: 'commit' });
      const documentPlugin = page.getByRole(process.argv.includes('--source-workspace') ? 'button' : 'link', { name: /^Documents$/i }).first();
      await documentPlugin.waitFor({ timeout: 60000 });
      await documentPlugin.click();
      await page.getByText('26.909.61513', { exact: true }).waitFor();
      await page.screenshot({ path: join(output, 'plugins.png') });
      assert.deepEqual(errors, []);
      checks.push('Plugins page renders the installed standalone plugin with the real CLI and no page exceptions');
    } catch (cause) {
      report.uiText = await page.locator('body').innerText();
      await page.screenshot({ path: join(output, 'plugins-failure.png') });
      throw cause;
    } finally { await browser.close(); }
  }
  const thread = await rpc('thread/start', { cwd: workspace, ephemeral: true });
  const threadId = thread.thread.id;
  const inventory = await rpc('mcpServerStatus/list', { threadId, serverName: 'node_repl' });
  const nodeServer = inventory.data.find((value: any) => value.name === 'node_repl');
  assert.equal(nodeServer?.startupStatus?.status ?? 'ready', 'ready', JSON.stringify(nodeServer));
  assert.deepEqual(Object.keys(nodeServer.tools).sort(), ['js', 'js_add_node_module_dir', 'js_reset', 'turn_ended']);
  const originalTools = JSON.parse(await readFile(new URL('../test/fixtures/original-node-repl-tools.json', import.meta.url), 'utf8'));
  // The original binary omits js readOnly annotations when the UI negotiates
  // approval elicitation. Its names, descriptions and schemas stay identical.
  const actualTools = structuredClone(nodeServer.tools);
  const expectedTools = structuredClone(originalTools);
  if (!actualTools.js.annotations) delete expectedTools.js.annotations;
  assert.deepEqual(actualTools, expectedTools);
  report.originalDescriptorsMatch = true;
  const evaluate = (code: string, timeout_ms?: number) => rpc('mcpServer/tool/call', { threadId, server: 'node_repl', tool: 'js', arguments: { code, ...(timeout_ms ? { timeout_ms } : {}) } });
  const evaluated = await evaluate('const count = 41; nodeRepl.write(await Promise.resolve(count + 1));');
  assert.notEqual(evaluated.isError, true, JSON.stringify(evaluated));
  assert.match(JSON.stringify(evaluated.content), /42/);
  assert.notEqual((await evaluate('let count = 42; nodeRepl.write(count);')).isError, true);
  const image = await evaluate('await nodeRepl.emitImage({bytes:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X6AAAAABJRU5ErkJggg==","base64"),mimeType:"image/png"})');
  assert.ok(image.content.some((value: any) => value.type === 'image' && value.mimeType === 'image/png'));
  checks.push('Original node_repl exposes exactly its four native tools, supports redeclaration and returns native image output');
  // Administrative tool calls are read-only even in a full-access thread.
  // Observe persistence through a binding instead of writing marker files.
  void evaluate('await new Promise(resolve => setTimeout(resolve, 1200)); count += 1; nodeRepl.write(count);').catch(() => {});
  await delay(150);
  socket!.terminate();
  await delay(1400);
  await connect();
  assert.match(JSON.stringify((await evaluate('nodeRepl.write(count);')).content), /43/);
  checks.push('Started JavaScript completes after the Yard client disconnects, and the same kernel retains its variable after reconnecting');
  await rpc('mcpServer/tool/call', { threadId, server: 'node_repl', tool: 'js_reset', arguments: {} });
  assert.match(JSON.stringify((await evaluate('nodeRepl.write(typeof count);')).content), /undefined/);
  checks.push('The real CLI resets the standalone JavaScript kernel');
  const originalRoot = process.env.YARD_NODE_REPL_ROOT;
  process.env.YARD_NODE_REPL_ROOT = join(root, 'missing-runtime');
  try {
    // Runtime environment is captured when the host starts. Restart the
    // disposable Yard, keeping the CLI alive, to test a missing deployment.
    socket!.terminate(); await app.close(); app = await startWorkbench(); await connect();
    for (const state of ['disabled', 'optional', 'required'] as const) {
    const config = { 'mcp_servers.node_repl': { enabled: state !== 'disabled', required: state === 'required' } };
    if (state === 'required') {
      await assert.rejects(rpc('thread/start', { cwd: workspace, ephemeral: true, config }), /required|MCP|mcp|spawn|No such file/);
    } else {
      const started = await rpc('thread/start', { cwd: workspace, ephemeral: true, config });
      assert.ok(started.thread.id);
      const status = await rpc('mcpServerStatus/list', { threadId: started.thread.id, serverName: 'node_repl' });
      assert.ok(!status.data.some((server: any) => server.runtimeStatus === 'connected'));
    }
  } } finally {
    if (originalRoot === undefined) delete process.env.YARD_NODE_REPL_ROOT;
    else process.env.YARD_NODE_REPL_ROOT = originalRoot;
  }
  checks.push('Missing original runtime preserves native disabled/optional/required behavior: ordinary chats start, required startup fails');
  for (const name of packages) {
    await rpc('plugin/uninstall', { pluginId: name + '@codex-yard' });
    assert.equal((await rpc('plugin/read', { marketplacePath, pluginName: name })).plugin.summary.installed, false);
  }
  const removedSkills = await rpc('skills/list', { cwds: [workspace], forceReload: true });
  assert.ok(!removedSkills.data.flatMap((value: any) => value.skills).some((value: any) => packages.some(name => value.pluginId === name + '@codex-yard')));
  checks.push('Uninstall removes the canonical packages and their Skills from the real CLI inventory');
  await rpc('marketplace/remove', { marketplaceName: 'codex-yard' });
  checks.push('The native marketplace registration is removed through the same bridge');
  const config = await app.control.request('config/read', { includeLayers: false });
  // Exercise the actual CLI HTTP client through a loopback proxy, using only a
  // synthetic account and an unroutable origin. The proxy never forwards data.
  const proxyHome = join(root, 'proxy-codex');
  await mkdir(proxyHome);
  await writeFile(join(proxyHome, 'config.toml'), 'chatgpt_base_url = "http://plugins.invalid/backend-api"\n[features]\nplugins = true\nremote_plugin = true\n');
  const claims = { sub: 'fixture', email: 'fixture@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_user_id: 'fixture-user', chatgpt_plan_type: 'plus' } };
  const token = [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fixture'].join('.');
  await writeFile(join(proxyHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: {
    id_token: token, access_token: token, refresh_token: 'fixture', account_id: 'fixture-account',
  }, last_refresh: new Date().toISOString() }), { mode: 0o600 });
  const proxyRequests: string[] = [];
  const proxy = createServer((request, response) => {
    proxyRequests.push(request.url!);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ plugins: [], pagination: { next_page_token: null }, featured_plugin_ids: [] }));
  });
  await new Promise<void>(done => proxy.listen(0, '127.0.0.1', done));
  const proxyUrl = 'http://127.0.0.1:' + (proxy.address() as import('node:net').AddressInfo).port;
  const pluginHost = createPlugins({ globals: { 'yard-plugin-network': { cloudEnabled: true, proxyUrl } }, codexHome: proxyHome, home: () => proxyHome,
    persist: async () => {}, request: async (_host, method) => { assert.equal(method, 'config/read'); return { config: {} }; },
    file: async (_host, path) => readFile(path, 'utf8'), directory: async () => [] });
  try {
    await pluginHost.request('local', 'plugin/installed', {});
    assert.ok(proxyRequests.some(url => url.includes('plugins.invalid/backend-api/ps/plugins/installed')), JSON.stringify(proxyRequests));
    await pluginHost.update({ cloudEnabled: false, proxyUrl });
    const count = proxyRequests.length;
    await pluginHost.request('local', 'plugin/installed', {});
    assert.equal(proxyRequests.length, count);
    checks.push('Real CLI cloud inventory uses the configured loopback proxy; disabling cloud access stops the query process and further proxy traffic');
    report.proxyRequests = proxyRequests;
  } finally { await pluginHost.close(); await new Promise<void>(done => proxy.close(() => done())); }
  assert.equal(record(record(config).config).model_provider, 'fixture');
  report.ok = true;
} catch (cause) {
  report.ok = false;
  report.error = cause instanceof Error ? cause.stack : String(cause);
  report.cliLog = log;
  process.exitCode = 1;
} finally {
  socket?.terminate();
  await app?.close();
  child.kill('SIGTERM');
  if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
