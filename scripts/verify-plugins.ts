// Real CLI plugin lifecycle through Yard's WebSocket bridge. All state lives in
// a disposable Codex home; no account, desktop App or model request is used.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';

const root = await mkdtemp('/tmp/yard-plugin-cli-');
const codexHome = join(root, 'codex'), workspace = join(root, 'workspace'), dataDir = join(root, 'data');
const socketPath = join(root, 'backend.sock');
await Promise.all([mkdir(codexHome), mkdir(workspace), mkdir(dataDir)]);
const execute = promisify(execFile);
await execute('git', ['init', '-q', workspace]);
await cp(resolve('.agents/plugins'), join(workspace, '.agents/plugins'), { recursive: true });
await cp(resolve('plugins'), join(workspace, 'plugins'), { recursive: true });
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
  app = await createNativeWorkbench({ port: 0, dataDir, workspace, socketPath, codexHome,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
  const messages: Record<string, any>[] = [];
  socket.on('message', data => { messages.push(JSON.parse(String(data))); socket!.emit('received'); });
  await once(socket, 'open');
  let sequence = 0;
  async function rpc<T = Record<string, any>>(method: string, params: unknown = {}): Promise<T> {
    const id = ++sequence;
    socket!.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }));
    const signal = AbortSignal.timeout(30000);
    let reply;
    while (!(reply = messages.find(value => value.type === 'mcp-response' && value.message.id === id))) await once(socket!, 'received', { signal });
    if (reply.message.error) throw new Error(method + ': ' + JSON.stringify(reply.message.error));
    return reply.message.result as T;
  }
  const marketplacePath = join(workspace, '.agents/plugins/marketplace.json');
  const added = await rpc('marketplace/add', { source: workspace });
  assert.equal(added.marketplaceName, 'codex-yard');
  const listing = await rpc('plugin/list', { cwds: [workspace], marketplaceKinds: ['local'] });
  const market = listing.marketplaces.find((value: any) => value.name === 'codex-yard');
  assert.ok(market?.plugins.some((value: any) => value.name === 'yard-computer'));
  checks.push('Real CLI discovers the repository-owned Codex Yard marketplace through the Web bridge');
  const before = await rpc('plugin/read', { marketplacePath, pluginName: 'yard-computer' });
  assert.equal(before.plugin.summary.installed, false);
  assert.ok(before.plugin.mcpServers.includes('yard_computer'));
  await rpc('plugin/install', { marketplacePath, pluginName: 'yard-computer', installAttemptId: 'yard-validation' });
  const after = await rpc('plugin/read', { marketplacePath, pluginName: 'yard-computer' });
  assert.equal(after.plugin.summary.installed, true);
  assert.equal(after.plugin.summary.enabled, true);
  checks.push('Real CLI installs and enables the self-contained Computer Use plugin without a desktop App');
  const installed = await rpc('plugin/installed', { cwds: [workspace] });
  assert.ok(installed.marketplaces.flatMap((value: any) => value.plugins).some((value: any) => value.id === 'yard-computer@codex-yard' && value.installed));
  const skills = await rpc('skills/list', { cwds: [workspace], forceReload: true });
  assert.ok(skills.data.flatMap((value: any) => value.skills).some((value: any) => value.name === 'yard-computer:use-computer' && value.pluginId === 'yard-computer@codex-yard'));
  checks.push('The installed plugin contributes its Skill to the actual CLI inventory');
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
      await page.getByRole('link', { name: /yard[- ]computer/i }).first().waitFor({ timeout: 60000 });
      await page.getByRole('link', { name: /yard[- ]computer/i }).first().click();
      await page.getByRole('heading', { name: /yard[- ]computer/i }).waitFor();
      await page.screenshot({ path: join(output, 'plugins.png') });
      assert.deepEqual(errors, []);
      checks.push('Pinned original Plugins page renders the installed standalone plugin with the real CLI and no page exceptions');
    } catch (cause) {
      report.uiText = await page.locator('body').innerText();
      await page.screenshot({ path: join(output, 'plugins-failure.png') });
      throw cause;
    } finally { await browser.close(); }
  }
  const thread = await rpc('thread/start', { cwd: workspace, ephemeral: true });
  const threadId = thread.thread.id;
  const inventory = await rpc('mcpServerStatus/list', { threadId, serverName: 'yard_computer' });
  assert.ok(inventory.data.some((value: any) => Object.keys(value.tools ?? {}).includes('computer')),
    'The real CLI must initialize the bundled stdio MCP process and discover its computer tool');
  const unavailable = await rpc('mcpServer/tool/call', { threadId, server: 'yard_computer', tool: 'computer', arguments: { type: 'screenshot' } });
  assert.equal(unavailable.isError, true);
  assert.match(JSON.stringify(unavailable.content), /display|DISPLAY/);
  checks.push('Actual CLI launches the plugin MCP and returns actionable missing-display errors instead of importing desktop services');
  await rpc('plugin/uninstall', { pluginId: 'yard-computer@codex-yard' });
  const removed = await rpc('plugin/read', { marketplacePath, pluginName: 'yard-computer' });
  assert.equal(removed.plugin.summary.installed, false);
  const removedSkills = await rpc('skills/list', { cwds: [workspace], forceReload: true });
  assert.ok(!removedSkills.data.flatMap((value: any) => value.skills).some((value: any) => value.pluginId === 'yard-computer@codex-yard'));
  checks.push('Uninstall removes the package and its Skill from the real CLI inventory');
  await rpc('marketplace/remove', { marketplaceName: 'codex-yard' });
  checks.push('The native marketplace registration is removed through the same bridge');
  const config = await app.control.request('config/read', { includeLayers: false });
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
