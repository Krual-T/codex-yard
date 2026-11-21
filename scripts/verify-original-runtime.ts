// Original Node REPL and Sky, through a disposable real CLI. No model requests.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import { nodeReplConfig } from '../lib/standalone-tools.ts';
import { record } from '../src/native/protocol.ts';
import { projectRoot } from '../lib/app-resources.ts';
import type { RpcMessage } from '../lib/codex-protocol.ts';

const root = await mkdtemp('/tmp/yard-original-runtime-');
const forbidden = join(projectRoot, '.local', 'read-only-denial-' + root.split('/').at(-1));
const home = join(root, 'home'), workspace = join(root, 'workspace'), socket = join(root, 'backend.sock');
await Promise.all([mkdir(home), mkdir(workspace)]);
const checks: string[] = [], processes: ReturnType<typeof spawn>[] = [];
const report: Record<string, unknown> = { checks, externalModelRequests: 0 };
const connection = new CodexConnection(socket);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let stderr = '';
function launch(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  processes.push(child); child.stderr!.on('data', x => { stderr = (stderr + String(x)).slice(-12000); });
  return child;
}
async function until(predicate: () => Promise<boolean> | boolean, label: string) {
  const deadline = Date.now() + 15000;
  while (!(await predicate())) { if (Date.now() > deadline) throw new Error(label + ': ' + stderr); await delay(40); }
}
function emit(response: ServerResponse, item: Record<string, unknown>) {
  const id = 'response-' + Date.now();
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const base = { id, object: 'response', created_at: 0, model: 'fixture', output: [] };
  const event = (type: string, data: Record<string, unknown>) => response.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
  event('response.created', { response: { ...base, status: 'in_progress' } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
  if (item.type === 'function_call') {
    event('response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: item.arguments });
    event('response.function_call_arguments.done', { output_index: 0, item_id: item.id, arguments: item.arguments });
  }
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { ...base, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  response.end();
}
let pendingCode: string | undefined, pendingTimeout: number | undefined, nextCall = 0;
let providerError: unknown;
const provider = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  try {
    const value = record(JSON.parse(body));
    if (pendingCode !== undefined) {
      const tools = (Array.isArray(value.tools) ? value.tools : []).flatMap(raw => {
        const t = record(raw); return t.type === 'namespace' && Array.isArray(t.tools) ? t.tools.map(raw => String(t.name) + '.' + String(record(raw).name)) : [String(t.name)];
      });
      const name = tools.find(name => name.includes('node_repl') && /(?:__|\.)js$/.test(name));
      assert.ok(name, tools.join(','));
      const code = pendingCode; pendingCode = undefined;
      emit(response, { id: 'fixture-item-' + ++nextCall, type: 'function_call', call_id: 'fixture-call-' + nextCall,
        ...(name.includes('.') ? { namespace: name.slice(0, name.lastIndexOf('.')), name: name.slice(name.lastIndexOf('.') + 1) } : { name }), arguments: JSON.stringify({ code, ...(pendingTimeout ? { timeout_ms: pendingTimeout } : {}) }) });
    } else {
      report.lastModelInput = (Array.isArray(value.input) ? value.input : []).filter(item => ['function_call', 'function_call_output'].includes(String(record(item).type))).map(item => JSON.parse(JSON.stringify(item, (key, value) => typeof value === 'string' && value.startsWith('data:image/') ? value.slice(0, 32) + '…' : value)));
      emit(response, { id: 'fixture-done-' + nextCall, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'FIXTURE_DONE', annotations: [] }] });
    }
  } catch (cause) { providerError = cause; response.writeHead(500); response.end(String(cause)); }
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const port = (provider.address() as import('node:net').AddressInfo).port;
try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  await writeFile(join(home, 'config.toml'), `model="fixture"
model_provider="fixture"
approval_policy="never"
sandbox_mode="danger-full-access"
[model_providers.fixture]
name="No external model"
base_url="http://127.0.0.1:${port}/v1"
wire_api="responses"
requires_openai_auth=false
[features]
code_mode=false
plugins=true
`);
  const system = resolve('.local/computer-system/root');
  const env = { ...process.env, LD_LIBRARY_PATH: [join(system, 'usr/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  const xvfb = launch(process.env.AGENTS_TEST_XVFB || join(system, 'usr/bin/Xvfb'),
    ['-displayfd', '1', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-ac'], env);
  let output = ''; xvfb.stdout!.on('data', x => { output += String(x); });
  await until(() => /^\d+\r?\n/m.test(output), 'Xvfb');
  const display = ':' + output.match(/^(\d+)\r?$/m)![1];
  const selectedEnv = { ...env, YARD_COMPUTER_DISPLAY: display, DISPLAY: display, NO_AT_BRIDGE: '0', ACCESSIBILITY_ENABLED: '1' };
  async function inputState(): Promise<{ shift: boolean; mouse: boolean }> {
    const { stdout } = await promisify(execFile)('python3', ['-c', `import ctypes as c,json
x=c.CDLL('libX11.so.6');x.XOpenDisplay.restype=c.c_void_p;d=x.XOpenDisplay(None);assert d
x.XDefaultRootWindow.argtypes=[c.c_void_p];x.XDefaultRootWindow.restype=c.c_ulong;r=x.XDefaultRootWindow(d)
x.XQueryPointer.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.c_int),c.POINTER(c.c_int),c.POINTER(c.c_int),c.POINTER(c.c_int),c.POINTER(c.c_uint)]
a,b=c.c_ulong(),c.c_ulong();i,j,k,l=c.c_int(),c.c_int(),c.c_int(),c.c_int();m=c.c_uint();x.XQueryPointer(d,r,c.byref(a),c.byref(b),c.byref(i),c.byref(j),c.byref(k),c.byref(l),c.byref(m))
x.XKeysymToKeycode.argtypes=[c.c_void_p,c.c_ulong];q=x.XKeysymToKeycode(d,0xffe1);keys=c.create_string_buffer(32);x.XQueryKeymap.argtypes=[c.c_void_p,c.c_void_p];x.XQueryKeymap(d,keys)
print(json.dumps({'shift':bool(keys.raw[q//8]&(1<<(q%8))),'mouse':bool(m.value&(1<<8))}));x.XCloseDisplay.argtypes=[c.c_void_p];x.XCloseDisplay(d)
`], { env: selectedEnv });
    return JSON.parse(stdout);
  }
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM || join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: false, env: selectedEnv, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ozone-platform=x11', '--window-position=0,0', '--window-size=1000,700', '--force-device-scale-factor=1', '--force-renderer-accessibility'] });
  const page = await browser.newPage({ viewport: null });
  await page.setContent('<title>Yard original Sky fixture</title><button style="position:absolute;left:40px;top:60px;width:180px;height:60px" onclick="this.textContent=\'clicked\'">Click</button><input style="position:absolute;left:40px;top:160px;width:450px;height:60px;font-size:24px" aria-label="Fixture text">');
  await page.bringToFront();
  await page.evaluate(() => {
    const observed = window as unknown as { fixtureHeld: { shift: boolean; mouse: boolean } }; observed.fixtureHeld = { shift: false, mouse: false };
    document.addEventListener('keydown', e => { if (e.key === 'Shift') observed.fixtureHeld.shift = true; });
    document.addEventListener('keyup', e => { if (e.key === 'Shift') observed.fixtureHeld.shift = false; });
    document.addEventListener('mousedown', () => { observed.fixtureHeld.mouse = true; });
    document.addEventListener('mouseup', () => { observed.fixtureHeld.mouse = false; });
  });
  launch(process.env.AGENTS_TEST_CODEX_BIN || 'codex', ['app-server', '--listen', 'unix://' + socket], { ...selectedEnv, CODEX_HOME: home });
  await until(async () => { try { await access(socket); return true; } catch { return false; } }, 'CLI socket');
  await connection.connect(); report.cli = connection.server?.userAgent;
  await connection.request('marketplace/add', { source: projectRoot });
  await connection.request('plugin/install', { marketplacePath: join(projectRoot, '.agents/plugins/marketplace.json'), pluginName: 'computer-use', installAttemptId: 'sky-lifecycle-fixture' });
  await connection.request('plugin/install', { marketplacePath: join(projectRoot, '.agents/plugins/marketplace.json'), pluginName: 'chrome', installAttemptId: 'browser-loader-fixture' });
  interface Hook { key: string; currentHash: string; pluginId: string; trustStatus: string }
  const hooks = await connection.request<{ data: { hooks: Hook[] }[] }>('hooks/list', { cwds: [workspace] });
  const computerHooks = hooks.data.flatMap((entry: any) => entry.hooks).filter((hook: any) => hook.pluginId === 'computer-use@codex-yard');
  assert.equal(computerHooks.length, 3);
  // The same native approval used by the Hooks review UI, in this disposable
  // Codex home only. Yard must never approve hooks in a user's home at startup.
  await connection.request('config/batchWrite', { edits: computerHooks.map((hook: any) => ({
    keyPath: `hooks.state.${JSON.stringify(hook.key)}.trusted_hash`, value: hook.currentHash, mergeStrategy: 'upsert',
  })), filePath: null, expectedVersion: null, reloadUserConfig: true });
  report.hooks = await connection.request('hooks/list', { cwds: [workspace] });
  assert.ok((report.hooks as typeof hooks).data.flatMap(entry => entry.hooks).filter(hook => hook.pluginId === 'computer-use@codex-yard').every(hook => hook.trustStatus === 'trusted'));
  const config = nodeReplConfig({}, { ...selectedEnv, YARD_BROWSER_BACKEND_PATHS: join(root, 'no-personal-browser.sock') }, ['chrome@codex-yard']);
  const started = await connection.request('thread/start', { cwd: workspace, ephemeral: true, config });
  const threadId = started.thread.id;
  async function js(code: string, timeout_ms?: number) {
    return record(await connection.request('mcpServer/tool/call', { threadId, server: 'node_repl', tool: 'js', arguments: { code, ...(timeout_ms ? { timeout_ms } : {}) } }));
  }
  async function good(code: string) {
    const result = await js(code); assert.notEqual(result.isError, true, JSON.stringify(result)); return result;
  }
  const events: RpcMessage[] = [];
  connection.on('message', message => events.push(message));
  async function modelJs(code: string, options: { timeout?: number; cancel?: 'interrupt' | 'reset'; drag?: boolean; threadId?: string } = {}) {
    const activeThread = options.threadId || threadId;
    pendingCode = code; pendingTimeout = options.timeout;
    const turn = await connection.request('turn/start', { threadId: activeThread, input: [{ type: 'text', text: 'Run the synthetic original runtime fixture.', text_elements: [] }] });
    if (options.cancel) {
      await until(async () => { const state = await inputState(); return options.drag ? state.mouse : state.shift; }, 'Held input before cancellation');
      if (options.cancel === 'reset') await connection.request('mcpServer/tool/call', { threadId: activeThread, server: 'node_repl', tool: 'js_reset', arguments: {} });
      else await connection.request('turn/interrupt', { threadId: activeThread, turnId: turn.turn.id });
    }
    await until(() => events.some(e => e.method === 'turn/completed' && record(record(e.params).turn).id === turn.turn.id), 'Model tool turn');
    if (providerError) throw providerError;
    assert.equal(record(record(events.find(e => e.method === 'turn/completed' && record(record(e.params).turn).id === turn.turn.id)!.params).turn).status, options.cancel === 'interrupt' ? 'interrupted' : 'completed');
    return turn.turn.id;
  }
  const offset = await page.evaluate(() => ({ x: window.screenX + (window.outerWidth - window.innerWidth) / 2,
    y: window.screenY + window.outerHeight - window.innerHeight }));
  const browserClient = join(home, 'plugins/cache/codex-yard/chrome/26.1103.60933/scripts/browser-client.mjs');
  await access(browserClient);
  await modelJs(`var { setupBrowserRuntime } = await import(${JSON.stringify(browserClient)}); var agent = await setupBrowserRuntime(); nodeRepl.write(await agent.browsers.list());`);
  const browserOutput = JSON.stringify(report.lastModelInput);
  assert.ok(!/Error:|is not defined|not allowed|not trusted/.test(browserOutput), browserOutput);
  checks.push('Original Chrome client bootstraps from the installed plugin cache through the trusted Browser service; discovery is restricted to an empty fixture socket');
  const rawHelper = spawn(join(projectRoot, 'vendor/node-repl/0.0.30-20261014203459-0849368674e2/linux-x64/lib/node_modules/@oai/sky/bin/linux/sky_linux_x64'), ['server'], { env: selectedEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  processes.push(rawHelper);
  let rawOutput = '';
  rawHelper.stdout.on('data', value => { rawOutput += String(value); });
  async function rawRequest(id: number, command: string, input: unknown) {
    rawHelper.stdin.write(JSON.stringify({ id, command, input }) + '\n');
    await until(() => rawOutput.split('\n').some(line => { try { const reply = JSON.parse(line); return reply.id === id && reply.ok; } catch { return false; } }), 'Original helper ACK');
  }
  await rawRequest(1, 'drag_handle', { action: 'start', x: 1100, y: 850 });
  assert.equal((await inputState()).mouse, true);
  await modelJs('var sky = (await import("@oai/sky")).sky; await sky.get_screenshot();');
  await connection.request('mcpServer/tool/call', { threadId, server: 'node_repl', tool: 'js_reset', arguments: {} });
  assert.equal((await inputState()).mouse, true, 'A screenshot-only helper must not release input owned by another helper');
  await rawRequest(2, 'drag_handle', { action: 'end' });
  await rawRequest(3, 'drag_handle', { action: 'start', x: 1100, y: 850 });
  rawHelper.stdin.end();
  await once(rawHelper, 'close');
  assert.equal((await inputState()).mouse, true, 'Pinned original helper EOF reproduces its unreleased drag');
  await modelJs('var sky = (await import("@oai/sky")).sky; await sky.click({x:1100,y:850});');
  assert.equal((await inputState()).mouse, false);
  checks.push('Direct original helper EOF reproduces the drag leak; screenshot-only wrapper teardown preserves input owned by a different helper');
  await modelJs(`var sky = (await import("@oai/sky")).sky;
await nodeRepl.emitImage((await sky.get_screenshot())[0].data_url);
var windows = await sky.list_windows(); nodeRepl.write(windows);
var window = windows.find(w => w.title?.includes("Yard original Sky fixture")); nodeRepl.write((await sky.get_window_state({window,include_screenshot:false})).ax_tree);
await sky.click({x:${offset.x + 100},y:${offset.y + 90}});
await sky.click({x:${offset.x + 100},y:${offset.y + 190}}); await sky.type_text({text:"Yard 中文测试"});
`);
  assert.equal(await page.locator('button').innerText(), 'clicked', JSON.stringify(report.lastModelInput));
  assert.equal(await page.locator('input').inputValue(), 'Yard 中文测试');
  checks.push('Actual CLI/model tool chain uses original Sky for screenshots, window/tree reads, clicks and Chinese input on an isolated X11 desktop');
  await modelJs('await sky.key_down({key:"Shift_L"});');
  await until(async () => !(await inputState()).shift, 'Automatic Stop held Shift release');
  checks.push('Trusted original Stop hook automatically releases held Shift after a real completed turn');
  // A normal desktop key must be lowercase after turn cleanup.
  await page.locator('input').fill('');
  await modelJs('var sky = (await import("@oai/sky")).sky; await sky.press_key({key:"a"});');
  report.afterTurnEndedText = await page.locator('input').inputValue();
  assert.equal(report.afterTurnEndedText, 'a', 'Turn completion must release held modifier keys');
  await modelJs('await sky.key_up({key:"Shift_L"});');
  await connection.request('mcpServer/tool/call', { threadId, server: 'node_repl', tool: 'js_reset', arguments: {} });
  assert.match(JSON.stringify(await good('nodeRepl.write(typeof sky);')), /undefined/);
  checks.push('Native js_reset clears persistent bindings');
  const timed = await js('await new Promise(() => {});', 100);
  assert.equal(timed.isError, true);
  assert.match(JSON.stringify(await good('nodeRepl.write(42);')), /42/);
  checks.push('Original timeout terminates the evaluation and permits a subsequent call');
  for (const mode of ['reset', 'timeout', 'interrupt'] as const) {
    await page.locator('input').fill('');
    await modelJs('var sky = (await import("@oai/sky")).sky; await sky.key_down({key:"Shift_L"}); await new Promise(() => {});',
      mode === 'timeout' ? { timeout: 1000 } : { cancel: mode });
    await until(async () => !(await inputState()).shift, mode + ' held Shift release');
    await modelJs('var sky = (await import("@oai/sky")).sky; await sky.press_key({key:"a"});');
    assert.equal(await page.locator('input').inputValue(), 'a', mode + ' must release held Shift');
    checks.push('Held Shift is released after ' + mode + ' and a subsequent native key stays lowercase');
  }
  for (const mode of ['reset', 'timeout', 'interrupt'] as const) {
    await modelJs(`var sky = (await import("@oai/sky")).sky; var drag = sky.drag_handle(); await drag.start({x:${offset.x + 100},y:${offset.y + 190}}); await new Promise(() => {});`, mode === 'timeout' ? { timeout: 1000 } : { cancel: mode, drag: true });
    await until(async () => !(await inputState()).mouse, mode + ' active drag release');
    checks.push('Original drag releases the desktop mouse button after ' + mode);
  }
  report.finalInputState = await inputState();
  const readOnly = await connection.request('thread/start', { cwd: workspace, ephemeral: true, sandbox: 'read-only', config });
  report.readOnlyThread = readOnly;
  await modelJs(`await (await import("node:fs/promises")).writeFile(${JSON.stringify(forbidden)},"forbidden");`, { threadId: readOnly.thread.id });
  report.readOnlyResult = report.lastModelInput;
  assert.match(JSON.stringify(report.readOnlyResult), /requires approval.*approval policy is never/);
  await assert.rejects(access(forbidden));
  checks.push('Native read-only/never policy rejects the model tool call before it can write a repository file');
  const approvedConfig = structuredClone(config);
  approvedConfig['mcp_servers.node_repl'].tools = { js: { approval_mode: 'approve' } };
  const approved = await connection.request('thread/start', { cwd: workspace, ephemeral: true, sandbox: 'read-only', config: approvedConfig });
  await modelJs(`await (await import("node:fs/promises")).writeFile(${JSON.stringify(forbidden)},"explicit native approval");`, { threadId: approved.thread.id });
  assert.equal(await readFile(forbidden, 'utf8'), 'explicit native approval');
  checks.push('Explicit native per-tool approval authorizes the original MCP execution, including a write; this permission boundary is documented');
  report.ok = true;
} catch (cause) { report.ok = false; report.error = cause instanceof Error ? cause.stack : String(cause); report.log = stderr; process.exitCode = 1; }
finally {
  await connection.close(); await browser?.close(); await new Promise<void>(resolve => provider.close(() => resolve()));
  for (const child of processes.reverse()) { child.kill('SIGTERM'); if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(1500)]); if (child.exitCode === null) child.kill('SIGKILL'); }
  await rm(root, { recursive: true, force: true });
  await rm(forbidden, { force: true });
  console.log(JSON.stringify(report, null, 2));
}
