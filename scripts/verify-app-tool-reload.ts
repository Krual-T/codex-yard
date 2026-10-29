import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CodexConnection } from '../lib/codex.ts';
import { createAppTools } from '../lib/app-tools.ts';
import type { Page, RpcMessage, TurnSummary } from '../lib/codex-protocol.ts';
import { isRecord } from '../lib/codex-protocol.ts';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';

const root = await mkdtemp('/tmp/yard-mcp-rebind-'), home = join(root, 'codex'), socket = join(root, 'backend.sock');
let callModelTool = false, holdResponse = false, releaseResponse: (() => void) | undefined;
let modelToolCalls = 0;
const provider = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (request.url === '/mcp') {
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    if (!isRecord(body) || body.id === undefined) { response.writeHead(202); response.end(); return; }
    const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} },
      serverInfo: { name: 'Synthetic HTTP App', version: '0.0.1' } }
      : body.method === 'tools/list' ? { tools: [{ name: 'native_http_probe', description: 'Synthetic HTTP mount',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] } : {};
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result })); return;
  }
  const names = isRecord(body) && Array.isArray(body.tools) ? body.tools.filter(isRecord).flatMap(tool => {
    if (typeof tool.name !== 'string') return [];
    return tool.type === 'namespace' && Array.isArray(tool.tools)
      ? tool.tools.filter(isRecord).map(child => tool.name + '.' + String(child.name)) : [tool.name];
  }) : [];
  if (holdResponse) {
    holdResponse = false;
    await new Promise<void>(resolve => { releaseResponse = resolve; });
  }
  const toolName = names.find(name => name.includes('codex_app') && name.endsWith('set_thread_title'));
  const invoke = callModelTool;
  callModelTool = false;
  if (invoke) assert.ok(toolName, 'Native tools reach the model');
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const output = invoke && toolName ? { id: 'fixture-function', type: 'function_call' as const, call_id: 'model-native-' + ++modelToolCalls,
    ...(toolName.includes('.') ? { namespace: toolName.slice(0, toolName.lastIndexOf('.')), name: toolName.slice(toolName.lastIndexOf('.') + 1) } : { name: toolName }),
    arguments: JSON.stringify({ title: '🩺 Model invoked native tool' }), status: 'completed' }
    : { id: 'fixture-message', type: 'message' as const, role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Synthetic reply.', annotations: [] }] };
  const base = { id: 'fixture-response', object: 'response', model: 'fixture', created_at: 0, output: [] };
  const events = [{ type: 'response.created', response: { ...base, status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...output, status: 'in_progress',
      ...(output.type === 'function_call' ? { arguments: '' } : { content: [] }) } },
    ...(output.type === 'function_call' ? [
      { type: 'response.function_call_arguments.delta', output_index: 0, item_id: output.id, delta: output.arguments },
      { type: 'response.function_call_arguments.done', output_index: 0, item_id: output.id, arguments: output.arguments },
    ] : []),
    { type: 'response.output_item.done', output_index: 0, item: output },
    { type: 'response.completed', response: { ...base, status: 'completed', output: [output],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
  events.forEach((event, sequence_number) => response.write('data: ' + JSON.stringify({ ...event, sequence_number }) + '\n\n'));
  response.end();
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const address = provider.address();
assert.ok(address && typeof address === 'object');
await mkdir(home);
const baseConfig = `model="fixture"
model_provider="fixture"
approval_policy="never"
sandbox_mode="read-only"
thread_unload_delay_secs=0
[model_providers.fixture]
name="Synthetic only"
base_url="http://127.0.0.1:${address.port}/v1"
wire_api="responses"
requires_openai_auth=false
`;
await writeFile(join(home, 'config.toml'), baseConfig);
const cli = spawn('codex', ['app-server', '--listen', 'unix://' + socket], {
  cwd: root, env: { ...process.env, CODEX_HOME: home }, stdio: ['ignore', 'ignore', 'pipe'],
});
const exited = once(cli, 'exit');
let stderr = '';
cli.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
const app = new CodexConnection(socket), yard = new CodexConnection(socket), linux = new CodexConnection(socket);
const logs: RpcMessage[] = [], adapters: Awaited<ReturnType<typeof createAppTools>>[] = [];
let workbench: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let web: WebSocket | undefined;
let nextToolCall = 0;
let phase = 'reload probe';
async function until(predicate: () => boolean | Promise<boolean>, label: string) {
  const end = Date.now() + 15_000;
  while (!await predicate()) { if (Date.now() > end) throw new Error(label + ': ' + stderr); await setTimeout(25); }
}
async function adapter(name: string) {
  const value = await createAppTools({ tools: [{ namespace: 'codex_app', name, description: 'Synthetic fixture',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
  callTool: () => ({ success: true, contentItems: [{ type: 'inputText', text: name }] }) });
  adapters.push(value);
  return value.config;
}
async function tools(id: string) {
  const page = await app.request<{ data: { runtimeStatus: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list', {
    threadId: id, serverName: 'codex_app', detail: 'toolsAndAuthOnly', limit: 10,
  });
  return { status: page.data[0]?.runtimeStatus, tools: Object.keys(page.data[0]?.tools ?? {}).sort() };
}
async function turn(id: string) {
  const { turn } = await yard.request('turn/start', { threadId: id,
    input: [{ type: 'text', text: 'Synthetic MCP reload probe.', text_elements: [] }] });
  await until(() => logs.some(event => event.method === 'turn/completed' && isRecord(event.params) &&
    isRecord(event.params.turn) && event.params.turn.id === turn.id && event.params.turn.status === 'completed'), 'turn completion');
}
try {
  await until(async () => { try { return (await stat(socket)).isSocket(); } catch { return false; } }, 'backend startup');
  await Promise.all([app.connect(), yard.connect()]);
  for (const client of [app, yard, linux]) client.on('message', event => logs.push(event));
  const appConfig = await adapter('native_app_probe'), yardConfig = await adapter('yard_probe');
  const disabled = await app.request('thread/start', { cwd: root,
    config: { 'mcp_servers.codex_app.command': '', 'mcp_servers.codex_app.enabled': false }, historyMode: 'paginated' });
  const native = await app.request('thread/start', { cwd: root, config: appConfig, historyMode: 'paginated' });
  await turn(disabled.thread.id); await turn(native.thread.id);
  const before = { disabled: await tools(disabled.thread.id), native: await tools(native.thread.id) };
  const config = yardConfig['mcp_servers.codex_app'];
  await writeFile(join(home, 'config.toml'), baseConfig + `
[mcp_servers.codex_app]
command=${JSON.stringify(config.command)}
args=${JSON.stringify(config.args)}
enabled=true
default_tools_approval_mode="approve"
[mcp_servers.codex_app.env]
CODEX_APP_TOOLS_PIPE_PATH=${JSON.stringify(config.env.CODEX_APP_TOOLS_PIPE_PATH)}
CODEX_APP_TOOLS_CALLER_HOST_ID="local"
`);
  await yard.request('config/mcpServer/reload', null, { mutating: true });
  await turn(disabled.thread.id); await turn(native.thread.id);
  const after = { disabled: await tools(disabled.thread.id), native: await tools(native.thread.id) };
  await yard.request('thread/resume', { threadId: disabled.thread.id, excludeTurns: true });
  const bothSubscribed = await yard.request('thread/loaded/list', {});
  const yardUnsubscribe = await yard.request('thread/unsubscribe', { threadId: disabled.thread.id });
  const afterYardUnsubscribe = await app.request('thread/loaded/list', {});
  await yard.request('thread/resume', { threadId: disabled.thread.id, excludeTurns: true, config: yardConfig });
  const stillLoaded = await tools(disabled.thread.id);
  const appUnsubscribe = await app.request('thread/unsubscribe', { threadId: disabled.thread.id });
  const yardFinalUnsubscribe = await yard.request('thread/unsubscribe', { threadId: disabled.thread.id });
  await until(async () => !(await yard.request('thread/loaded/list', {})).data.includes(disabled.thread.id), 'unload after final unsubscribe');
  await yard.request('thread/resume', { threadId: disabled.thread.id, excludeTurns: true, config: yardConfig });
  await turn(disabled.thread.id);
  const recovered = await tools(disabled.thread.id);
  assert.deepEqual(recovered, { status: 'connected', tools: ['yard_probe'] });
  const retained = await app.request('thread/start', { cwd: root,
    config: { ...appConfig, thread_unload_delay_secs: 60 }, historyMode: 'paginated' });
  await turn(retained.thread.id);
  await yard.request('thread/resume', { threadId: retained.thread.id, excludeTurns: true,
    config: { thread_unload_delay_secs: 0 } });
  await app.request('thread/unsubscribe', { threadId: retained.thread.id });
  await yard.request('thread/unsubscribe', { threadId: retained.thread.id });
  await setTimeout(300);
  const loadedAfterResumeRetentionOverride = (await yard.request('thread/loaded/list', {})).data.includes(retained.thread.id);
  // Exercise the actual Yard injection and unmodified official adapter, with
  // a real isolated daemon and no desktop installation or browser renderer.
  const dataDir = join(root, 'yard');
  phase = 'start permanent native host';
  workbench = await createNativeWorkbench({ socketPath: socket, codexHome: home, dataDir, workspace: root, port: 0 });
  web = new WebSocket(workbench.url.replace('http', 'ws') + '/native-host', { origin: workbench.url });
  const webMessages: Record<string, unknown>[] = [];
  web.on('message', bytes => webMessages.push(JSON.parse(String(bytes))));
  await once(web, 'open');
  let requestId = 0;
  async function webRpc(method: string, params: unknown) {
    const id = ++requestId;
    web!.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }));
    await until(() => webMessages.some(message => message.type === 'mcp-response' && isRecord(message.message) && message.message.id === id), method);
    const response = webMessages.find(message => message.type === 'mcp-response' && isRecord(message.message) && message.message.id === id)!.message;
    assert.ok(isRecord(response)); assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result;
  }
  const started = await webRpc('thread/start', { cwd: root, historyMode: 'paginated' });
  assert.ok(isRecord(started) && isRecord(started.thread) && typeof started.thread.id === 'string');
  const yardThreadId = started.thread.id;
  phase = 'first Yard turn';
  await webRpc('turn/start', { threadId: yardThreadId, input: [{ type: 'text', text: 'Synthetic first Yard turn.', text_elements: [] }] });
  await until(() => webMessages.some(message => message.method === 'turn/completed' && isRecord(message.params) && message.params.threadId === yardThreadId), 'first Yard completion');
  phase = 'App resumes Yard-created thread';
  await app.request('thread/resume', { threadId: yardThreadId, excludeTurns: true });
  await turn(yardThreadId);
  const nativeCatalog = await tools(yardThreadId);
  assert.equal(nativeCatalog.status, 'connected');
  assert.equal(nativeCatalog.tools.length, 12);
  phase = 'model invokes native MCP with real caller metadata';
  callModelTool = true;
  await turn(yardThreadId);
  assert.equal((await app.request('thread/read', { threadId: yardThreadId, includeTurns: false })).thread.name, '🩺 Model invoked native tool');
  assert.equal(modelToolCalls, 1);
  async function nativeCall(tool: string, args: unknown, callerId = yardThreadId) {
    phase = tool;
    const result = await app.request<{ isError?: boolean; content: { text: string }[] }>('mcpServer/tool/call', {
      threadId: callerId, server: 'codex_app', tool, arguments: args,
      _meta: { 'x-codex-turn-metadata': JSON.stringify({ thread_id: callerId, turn_id: 'synthetic-explicit' }),
        'openai/toolCallId': 'native-probe-' + ++nextToolCall },
    });
    assert.equal(result.isError, false, JSON.stringify(result.content));
    const value: unknown = JSON.parse(result.content[0]!.text);
    assert.ok(isRecord(value)); return value;
  }
  assert.equal((await nativeCall('list_projects', {})).schemaVersion, 2);
  await nativeCall('set_thread_title', { title: '🩺 Native cross-client fixture' });
  assert.equal((await app.request('thread/read', { threadId: yardThreadId, includeTurns: false })).thread.name, '🩺 Native cross-client fixture');
  const created = await nativeCall('create_thread', { title: '🩺 Native child fixture', prompt: 'Synthetic first message.', target: { type: 'projectless' } });
  assert.equal(typeof created.threadId, 'string'); const targetId = String(created.threadId);
  const joined = await app.request('thread/resume', { threadId: targetId, excludeTurns: true });
  assert.equal(joined.thread.id, targetId);
  const history = await nativeCall('read_thread', { threadId: yardThreadId, turnLimit: 1 });
  assert.equal(history.schemaVersion, 1); assert.ok(Array.isArray(history.turns) && history.turns.length > 0);
  const wait = await nativeCall('wait_threads', { targets: [{ threadId: targetId }], timeoutMs: 2000 });
  assert.equal(wait.timedOut, false);
  const sent = await nativeCall('send_message_to_thread', { threadId: targetId, prompt: 'Synthetic follow-up.' });
  assert.equal(sent.threadId, targetId);
  await nativeCall('wait_threads', { targets: [{ threadId: targetId }], timeoutMs: 2000 });
  phase = 'delegate to active target';
  holdResponse = true;
  const running = await app.request('turn/start', { threadId: targetId,
    input: [{ type: 'text', text: 'Synthetic held turn.', text_elements: [] }] }, { mutating: true });
  await until(() => releaseResponse !== undefined, 'held model response');
  const peers = await Promise.all([app.request('thread/resume', { threadId: targetId, excludeTurns: true }),
    yard.request('thread/resume', { threadId: targetId, excludeTurns: true })]);
  assert.ok(peers.every(value => value.thread.status.type === 'active'));
  await nativeCall('send_message_to_thread', { threadId: targetId, prompt: 'Synthetic supplemental input.' });
  const activeTurns = await app.request<Page<TurnSummary>>('thread/turns/list', { threadId: targetId, limit: 10 });
  assert.ok(activeTurns.data.some(value => value.id === running.turn.id && value.status === 'inProgress'));
  releaseResponse!(); releaseResponse = undefined;
  await until(() => logs.some(event => event.method === 'turn/completed' && isRecord(event.params) &&
    isRecord(event.params.turn) && event.params.turn.id === running.turn.id && event.params.turn.status === 'completed'), 'active target preserved');
  await nativeCall('wait_threads', { targets: [{ threadId: targetId }], timeoutMs: 2000 });
  const fork = await nativeCall('fork_thread', { threadId: targetId });
  assert.equal(typeof fork.threadId, 'string');
  await nativeCall('set_thread_pinned', { threadId: targetId, pinned: true });
  const listing = await nativeCall('list_threads', { limit: 10 });
  assert.ok(Array.isArray(listing.pinnedThreads) && listing.pinnedThreads.some(thread => isRecord(thread) && thread.id === targetId));
  await nativeCall('set_thread_read_state', { threadId: targetId, read: false });
  await nativeCall('set_thread_read_state', { threadId: targetId, read: true });
  await nativeCall('set_thread_archived', { threadId: targetId, archived: true });
  const archived = await nativeCall('list_archived_threads', {});
  assert.ok(Array.isArray(archived.threads) && archived.threads.some(thread => isRecord(thread) && thread.id === targetId));
  await nativeCall('set_thread_archived', { threadId: targetId, archived: false });
  web.close(); await once(web, 'close'); web = undefined;
  await nativeCall('set_thread_title', { threadId: targetId, title: '🩺 All Yard pages closed' });
  assert.equal((await app.request('thread/read', { threadId: targetId, includeTurns: false })).thread.name, '🩺 All Yard pages closed');
  // Native App-shaped thread origins remain on their original healthy pipe.
  assert.deepEqual(await tools(native.thread.id), { status: 'connected', tools: ['native_app_probe'] });
  phase = 'explicit daemon registration';
  const configure = async (apply = false) => {
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./configure-native-tools.ts', import.meta.url)),
      '--socket', socket, '--data-dir', dataDir, ...(apply ? ['--apply'] : [])],
    { cwd: root, env: { ...process.env, CODEX_HOME: home }, timeout: 20_000 });
    return JSON.parse(stdout) as Record<string, unknown>;
  };
  const previousConfig = await readFile(join(home, 'config.toml'), 'utf8');
  const conflictingPlan = await configure();
  assert.equal(conflictingPlan.hostReady, true);
  assert.equal(conflictingPlan.existingDefinition, 'different');
  await assert.rejects(configure(true), /An explicit codex_app definition already exists/);
  assert.equal(await readFile(join(home, 'config.toml'), 'utf8'), previousConfig);
  const preservedConfig = baseConfig + '\n[mcp_servers.unrelated_fixture]\ncommand="unused"\nenabled=false\n';
  await writeFile(join(home, 'config.toml'), preservedConfig);
  await yard.request('config/mcpServer/reload', null, { mutating: true });
  // Existing remote Desktop mounts use HTTP. Registering a stdio default must
  // preserve this loaded runtime; a global reload merges mutually exclusive
  // transport fields in CLI 0.164.0 and fails before migration can take place.
  const httpThread = await app.request('thread/start', { cwd: root, historyMode: 'paginated',
    config: { 'mcp_servers.codex_app': { url: `http://127.0.0.1:${address.port}/mcp`, enabled: true } } });
  await turn(httpThread.thread.id);
  assert.deepEqual(await tools(httpThread.thread.id), { status: 'connected', tools: ['native_http_probe'] });
  // A local desktop can enable its bundled plugin while using a shared daemon.
  // Install a real isolated plugin as a positive control, then verify that the
  // explicit server definition wins the same-name registration collision.
  phase = 'local desktop plugin precedence';
  const marketplace = join(home, '.tmp/bundled-marketplaces/openai-bundled');
  const plugin = join(marketplace, 'plugins/codex-app-tools');
  await mkdir(join(plugin, '.codex-plugin'), { recursive: true });
  await mkdir(join(marketplace, '.agents/plugins'), { recursive: true });
  await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'codex-app-tools', version: '0.0.1',
    description: 'Synthetic native host only', mcpServers: './.mcp.json' }));
  await writeFile(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { codex_app: appConfig['mcp_servers.codex_app'] } }));
  const marketplacePath = join(marketplace, '.agents/plugins/marketplace.json');
  await writeFile(marketplacePath, JSON.stringify({ name: 'openai-bundled', plugins: [{ name: 'codex-app-tools',
    source: { source: 'local', path: './plugins/codex-app-tools' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }));
  await app.request('plugin/install', { marketplacePath, pluginName: 'codex-app-tools' }, { mutating: true });
  await app.request('config/mcpServer/reload', null, { mutating: true });
  const pluginThread = await app.request('thread/start', { cwd: root, historyMode: 'paginated' });
  await turn(pluginThread.thread.id);
  assert.deepEqual(await tools(pluginThread.thread.id), { status: 'connected', tools: ['native_app_probe'] });
  const beforeApplyConfig = await readFile(join(home, 'config.toml'), 'utf8');
  phase = 'explicit daemon registration';
  const plan = await configure();
  assert.equal(plan.existingDefinition, 'absent');
  assert.equal(await readFile(join(home, 'config.toml'), 'utf8'), beforeApplyConfig, 'planning does not write');
  const beforeRegistration = await app.request<{ config: Record<string, unknown> }>('config/read', { includeLayers: false });
  assert.ok(isRecord(beforeRegistration.config.mcp_servers));
  const applied = await configure(true);
  assert.equal(applied.writeState, 'installed');
  assert.equal(typeof applied.backupPath, 'string');
  assert.equal(await readFile(String(applied.backupPath), 'utf8'), beforeApplyConfig);
  assert.equal((await stat(String(applied.backupPath))).mode & 0o777, 0o600);
  const saved = await app.request<{ config: Record<string, unknown> }>('config/read', { includeLayers: false });
  assert.ok(isRecord(saved.config.mcp_servers));
  assert.deepEqual(saved.config.mcp_servers.unrelated_fixture, beforeRegistration.config.mcp_servers.unrelated_fixture);
  assert.equal(saved.config.model, 'fixture');
  assert.equal((await configure(true)).alreadyInstalled, true, 'repeated registration preserves the same definition');
  assert.deepEqual(await tools(httpThread.thread.id), { status: 'connected', tools: ['native_http_probe'] });
  // New App/CLI starts need no per-thread Yard configuration. The desktop
  // remote branch respects this explicit codex_app entry on the execution host.
  phase = 'global App origin with three client subscribers';
  const globalThread = await app.request('thread/start', { cwd: root, historyMode: 'paginated' });
  await turn(globalThread.thread.id);
  assert.deepEqual(await tools(globalThread.thread.id), nativeCatalog);
  await linux.connect();
  const threeClients = await Promise.all([app.request('thread/resume', { threadId: globalThread.thread.id, excludeTurns: true }),
    yard.request('thread/resume', { threadId: globalThread.thread.id, excludeTurns: true }),
    linux.request('thread/resume', { threadId: globalThread.thread.id, excludeTurns: true })]);
  assert.ok(threeClients.every(value => value.thread.id === globalThread.thread.id));
  callModelTool = true;
  await turn(globalThread.thread.id);
  assert.equal(modelToolCalls, 2);
  phase = 'Windows native tool host disappears';
  await adapters[0]!.close();
  await nativeCall('set_thread_title', { title: '🩺 Independent of Windows tools' }, globalThread.thread.id);
  // Migrate an obsolete explicit native mount only after all its subscribers
  // release the idle thread. The public API does not forcibly unload it.
  phase = 'idle old-mount migration to explicit user configuration';
  await app.request('thread/unsubscribe', { threadId: native.thread.id });
  await yard.request('thread/unsubscribe', { threadId: native.thread.id });
  await until(async () => !(await yard.request('thread/loaded/list', {})).data.includes(native.thread.id), 'obsolete native mount unload');
  await linux.request('thread/resume', { threadId: native.thread.id, excludeTurns: true });
  await turn(native.thread.id);
  assert.deepEqual(await tools(native.thread.id), nativeCatalog);
  // Restart only this probe's Yard Node host, preserving the stable socket and
  // state directory. Already-running official adapters reconnect on the next
  // explicit invocation, with no replay of an earlier write.
  phase = 'permanent host restart and adapter reconnection';
  await workbench.close(); workbench = undefined;
  workbench = await createNativeWorkbench({ socketPath: socket, codexHome: home, dataDir, workspace: root, port: 0 });
  await nativeCall('set_thread_title', { title: '🩺 Host reconnected' }, globalThread.thread.id);
  assert.equal((await app.request('thread/read', { threadId: globalThread.thread.id, includeTurns: false })).thread.name, '🩺 Host reconnected');
  const persistedPins = await nativeCall('list_threads', { limit: 10 }, globalThread.thread.id);
  assert.ok(Array.isArray(persistedPins.pinnedThreads) && persistedPins.pinnedThreads.some(thread => isRecord(thread) && thread.id === targetId));
  console.log(JSON.stringify({ backend: app.server, before, after, bothSubscribed, yardUnsubscribe,
    afterYardUnsubscribe, stillLoaded, appUnsubscribe, yardFinalUnsubscribe, recovered, loadedAfterResumeRetentionOverride, nativeCatalog,
    verified: ['original-adapter', 'model-native-call-metadata', 'native-create-read-send-wait-fork-title-pin-readstate-archive',
      'app-yard-peer-continuation', 'simultaneous-clients-active-delegation', 'all-yard-pages-closed', 'healthy-native-mount-preserved',
      'registration-plan-read-only', 'registration-refuses-existing-definition', 'versioned-user-registration-and-private-backup',
      'loaded-http-mount-preserved-with-stdio-default', 'local-desktop-plugin-precedence', 'global-app-origin-three-clients', 'windows-native-host-offline',
      'idle-native-mount-migration', 'host-restart-adapter-reconnection-and-durable-pins'] }));
} catch (cause) {
  throw new Error('Native MCP verification failed at: ' + phase, { cause });
} finally {
  releaseResponse?.(); releaseResponse = undefined;
  web?.terminate(); await workbench?.close();
  app.close(); yard.close(); linux.close(); cli.kill('SIGTERM');
  const timer = globalThis.setTimeout(() => cli.kill('SIGKILL'), 2000);
  try { await exited; } finally { globalThis.clearTimeout(timer); }
  await Promise.all(adapters.map(value => value.close()));
  provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
