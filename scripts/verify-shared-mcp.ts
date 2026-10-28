import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { CodexConnection } from '../lib/codex.ts';
import { createAppTools } from '../lib/app-tools.ts';
import { isRecord } from '../lib/codex-protocol.ts';
import type { RpcMessage } from '../lib/codex-protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';

// This probe never opens the user's Codex home, daemon or model provider. The
// real CLI talks only to this local scripted Responses endpoint and temp data.
const root = await mkdtemp('/tmp/yard-mcp-probe-');
const codexHome = join(root, 'codex');
const socketPath = join(root, 'backend.sock');
const toolNames: string[][] = [];
let requestNumber = 0;
let callSharedTool = false;
let holdResponse = false;
let releaseResponse: (() => void) | undefined;
function releaseHeldResponse() {
  releaseResponse?.();
  releaseResponse = undefined;
}
const provider = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
  const names = Array.isArray(body.tools) ? body.tools.filter(isRecord).flatMap(tool => {
    if (typeof tool.name !== 'string') return [];
    if (tool.type === 'namespace' && Array.isArray(tool.tools)) {
      return tool.tools.filter(isRecord).map(child => tool.name + '.' + String(child.name));
    }
    return [tool.name];
  }) : [];
  toolNames.push(names);
  if (holdResponse) {
    holdResponse = false;
    await new Promise<void>(resolve => { releaseResponse = resolve; });
  }
  const id = 'synthetic-response-' + ++requestNumber;
  const toolName = names.find(name => name.includes('codex_yard') && name.endsWith('set_thread_title'));
  const output = callSharedTool && toolName ? {
    id: 'synthetic-function', type: 'function_call' as const, call_id: 'synthetic-call',
    ...(toolName.includes('.') ? { namespace: toolName.slice(0, toolName.lastIndexOf('.')), name: toolName.slice(toolName.lastIndexOf('.') + 1) } : { name: toolName }),
    arguments: JSON.stringify({ title: '🩺 Shared reload verified' }), status: 'completed',
  } : { id: 'synthetic-message', type: 'message' as const, role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'Synthetic reply.', annotations: [] }] };
  callSharedTool = false;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  let sequence = 0;
  function event(type: string, fields: Record<string, unknown>) {
    response.write('data: ' + JSON.stringify({ type, sequence_number: sequence++, ...fields }) + '\n\n');
  }
  const base = { id, object: 'response', model: 'fixture', created_at: 0, output: [], status: 'in_progress' };
  event('response.created', { response: base });
  event('response.output_item.added', { output_index: 0, item: { ...output, status: 'in_progress',
    ...(output.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
  if (output.type === 'function_call') {
    event('response.function_call_arguments.delta', { output_index: 0, item_id: output.id, delta: output.arguments });
    event('response.function_call_arguments.done', { output_index: 0, item_id: output.id, arguments: output.arguments });
  } else {
    event('response.content_part.added', { output_index: 0, item_id: output.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    event('response.output_text.delta', { output_index: 0, item_id: output.id, content_index: 0, delta: 'Synthetic reply.' });
    event('response.output_text.done', { output_index: 0, item_id: output.id, content_index: 0, text: 'Synthetic reply.' });
  }
  event('response.output_item.done', { output_index: 0, item: output });
  event('response.completed', { response: { ...base, status: 'completed', output: [output],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  response.end();
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const address = provider.address();
assert.ok(address && typeof address === 'object');
await mkdir(codexHome);
const baseConfig = `model = "fixture"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "read-only"
[model_providers.fixture]
name = "Local synthetic provider"
base_url = "http://127.0.0.1:${address.port}/v1"
wire_api = "responses"
requires_openai_auth = false
`;
await writeFile(join(codexHome, 'config.toml'), baseConfig);
const cli = spawn(process.env.AGENTS_CODEX_BIN || 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  cwd: root, env: { ...process.env, CODEX_HOME: codexHome }, stdio: ['ignore', 'ignore', 'pipe'],
});
let stderr = '';
cli.stderr.on('data', bytes => { stderr = (stderr + String(bytes)).slice(-8000); });
const exited = once(cli, 'exit');
const clients: CodexConnection[] = [];
let httpHost: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let nativeTools: Awaited<ReturnType<typeof createAppTools>> | undefined;
async function until(predicate: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out: ' + label + '\n' + stderr);
    await setTimeout(50);
  }
}
async function client() {
  const connection = new CodexConnection(socketPath, { timeout: 15_000 });
  clients.push(connection);
  await connection.connect();
  return connection;
}
try {
  await until(async () => { try { return (await stat(socketPath)).isSocket(); } catch { return false; } }, 'isolated backend startup');
  const app = await client(), yard = await client();
  httpHost = await createNativeWorkbench({ socketPath, codexHome, dataDir: join(root, 'yard-data'), workspace: root, port: 0 });
  nativeTools = await createAppTools({ tools: [{ namespace: 'codex_app', name: 'native_probe', description: 'Synthetic native App tool.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
  callTool: () => ({ success: true, contentItems: [{ type: 'inputText', text: 'native' }] }) });
  const events: RpcMessage[] = [];
  app.on('message', message => events.push(message));
  yard.on('message', message => events.push(message));
  const old = await app.request('thread/start', { cwd: root, config: { 'mcp_servers.codex_app.command': '', 'mcp_servers.codex_app.enabled': false }, historyMode: 'paginated' });
  async function completed(threadId: string, turnId: string) {
    await until(() => events.some(message => message.method === 'turn/completed' && isRecord(message.params) &&
      message.params.threadId === threadId && isRecord(message.params.turn) && message.params.turn.id === turnId), 'synthetic model turn');
    const event = events.find(message => message.method === 'turn/completed' && isRecord(message.params) && isRecord(message.params.turn) && message.params.turn.id === turnId)!;
    assert.equal(isRecord(event.params) && isRecord(event.params.turn) ? event.params.turn.status : null, 'completed');
  }
  async function turn(connection: CodexConnection, threadId: string) {
    const { turn } = await connection.request('turn/start', { threadId, input: [{ type: 'text', text: 'Synthetic probe only.', text_elements: [] }] }, { mutating: true });
    await completed(threadId, turn.id);
  }
  holdResponse = true;
  const original = await app.request('turn/start', { threadId: old.thread.id,
    input: [{ type: 'text', text: 'Synthetic active reload probe.', text_elements: [] }] }, { mutating: true });
  await until(() => releaseResponse != null, 'active turn before MCP reload');
  const mcpConfig = `
[mcp_servers.codex_yard]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(fileURLToPath(new URL('./conversation-mcp.ts', import.meta.url)))}]
startup_timeout_sec = 20
default_tools_approval_mode = "prompt"
[mcp_servers.codex_yard.tools.set_thread_title]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.list_projects]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.list_threads]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.read_thread]
approval_mode = "approve"
[mcp_servers.codex_yard.tools.wait_threads]
approval_mode = "approve"
[mcp_servers.codex_yard.env]
AGENTS_CODEX_SOCKET = ${JSON.stringify(socketPath)}
`;
  await writeFile(join(codexHome, 'config.toml'), baseConfig + mcpConfig);
  await app.request('config/mcpServer/reload', null, { mutating: true });
  const rejoined = await yard.request('thread/resume', { threadId: old.thread.id, excludeTurns: true });
  assert.equal(rejoined.thread.id, old.thread.id);
  assert.equal(rejoined.thread.status.type, 'active');
  releaseHeldResponse();
  await completed(old.thread.id, original.turn.id);
  callSharedTool = true;
  await turn(yard, old.thread.id);
  assert.ok(toolNames.at(-1)?.some(name => name.includes('codex_yard') && name.endsWith('list_threads')), 'the model receives shared tools after reload');
  const renamed = await app.request('thread/read', { threadId: old.thread.id, includeTurns: false });
  assert.equal(renamed.thread.name, '🩺 Shared reload verified', 'real model tool calls include metadata and reach the correct thread');
  const status = await app.request<{ data: { name: string; runtimeStatus: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list', {
    threadId: old.thread.id, serverName: 'codex_yard', detail: 'toolsAndAuthOnly', limit: 10,
  });
  assert.equal(status.data[0]?.runtimeStatus, 'connected');
  assert.equal(Object.keys(status.data[0]?.tools ?? {}).length, 7);
  async function shared(callerId: string, name: string, args: unknown) {
    const _meta = { 'x-codex-turn-metadata': JSON.stringify({ thread_id: callerId, turn_id: 'synthetic-explicit' }), 'openai/toolCallId': 'synthetic-' + name };
    const result = await app.request<{ isError: boolean; content: { text: string }[] }>('mcpServer/tool/call', {
      threadId: callerId, server: 'codex_yard', tool: name, arguments: args, _meta,
    });
    assert.equal(result.isError, false, JSON.stringify(result.content));
    return JSON.parse(result.content[0].text) as Record<string, any>;
  }
  assert.ok(Array.isArray((await shared(old.thread.id, 'list_projects', { limit: 5 })).data));
  const history = await shared(old.thread.id, 'read_thread', { threadId: old.thread.id, limit: 5 });
  assert.ok(history.data.length > 0);
  const created = await shared(old.thread.id, 'create_thread', { title: '🩺 Synthetic creation', message: 'Synthetic first message.' });
  const reverse = await app.request('thread/resume', { threadId: created.threadId, excludeTurns: true });
  assert.equal(reverse.thread.id, created.threadId);

  // Give a separate App-shaped thread its own real native MCP pipe. Rejoining
  // from Yard must preserve it alongside the shared MCP.
  const native = await app.request('thread/start', { cwd: root, config: nativeTools.config, historyMode: 'paginated' });
  await turn(app, native.thread.id);
  await yard.request('thread/resume', { threadId: native.thread.id, excludeTurns: true });
  await turn(yard, native.thread.id);
  const nativeStatus = await app.request<{ data: { runtimeStatus: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list', {
    threadId: native.thread.id, serverName: 'codex_app', detail: 'toolsAndAuthOnly', limit: 10,
  });
  assert.equal(nativeStatus.data[0]?.runtimeStatus, 'connected');
  assert.ok(nativeStatus.data[0]?.tools.native_probe);

  // Keep one real model request active while both clients join and the shared
  // service sends input. The daemon must return the existing turn identity.
  holdResponse = true;
  const running = await yard.request('turn/start', { threadId: created.threadId,
    input: [{ type: 'text', text: 'Synthetic held turn.', text_elements: [] }] }, { mutating: true });
  await until(() => releaseResponse != null, 'held synthetic response');
  const joined = await Promise.all([app.request('thread/resume', { threadId: created.threadId }), yard.request('thread/resume', { threadId: created.threadId })]);
  assert.ok(joined.every(result => result.thread.id === created.threadId && result.thread.status.type === 'active'));
  const sent = await shared(old.thread.id, 'send_message_to_thread', { threadId: created.threadId, message: 'Synthetic supplemental input.' });
  assert.equal(sent.turnId, running.turn.id);
  releaseHeldResponse();
  await until(() => events.some(message => message.method === 'turn/completed' && isRecord(message.params) &&
    isRecord(message.params.turn) && message.params.turn.id === running.turn.id), 'supplemented turn completion');
  const waited = await shared(old.thread.id, 'wait_threads', { threadIds: [created.threadId], timeoutMs: 1000 });
  assert.equal(waited.timedOut, false);
  // Simulate closing the Yard frontend connection. The daemon's MCP remains.
  yard.close();
  await httpHost.close();
  httpHost = undefined;
  assert.ok(Array.isArray((await shared(old.thread.id, 'list_threads', { limit: 5 })).data));
  console.log(JSON.stringify({ backend: 'isolated real CLI', tools: 7, reloadOnLoadedThread: true,
    realModelToolCall: true, reloadDuringActiveTurn: true, appToYard: true, yardToApp: true, simultaneousJoin: true,
    activeTurnPreserved: true, nativeMcpPreserved: true, toolsAfterYardShutdown: true, modelRequests: requestNumber }));
} finally {
  releaseHeldResponse();
  await httpHost?.close();
  await nativeTools?.close();
  for (const connection of clients) connection.close();
  cli.kill('SIGTERM');
  const timer = globalThis.setTimeout(() => { cli.kill('SIGKILL'); }, 3000);
  try { await exited; } finally { globalThis.clearTimeout(timer); }
  provider.closeAllConnections();
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
