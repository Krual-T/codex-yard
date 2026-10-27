import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { appToolCatalog } from '../lib/host-tools.ts';

// Hold /tmp/agents-workbench-heavy.lock for this process's full lifetime.
// The shared daemon is only a client endpoint. No model turn or title write occurs.
interface McpStatus {
  name: string; pluginId: string | null; runtimeStatus: string | null;
  toolsError: string | null; tools: Record<string, unknown>;
}
interface McpResult { content: unknown[]; isError?: boolean }

const startedAt = new Date().toISOString();
const root = await mkdtemp('/tmp/aw-tools-');
const workspace = join(root, 'workspace'), dataDir = join(root, 'data');
const socketPath = process.env.AGENTS_CODEX_SOCKET ?? join(homedir(), '.codex/app-server-control/app-server-control.sock');
const projects = [{ path: workspace, name: 'Isolated App Tools acceptance' }];
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let client: WebSocket | undefined;
let threadId: string | undefined;
let createdEmpty = false;
let cleanupVerified = false;
let modelTurns = 0;
let sequence = 0;
const pending = new Map<number, { resolve: (result: unknown) => void; reject: (cause: Error) => void; timer: NodeJS.Timeout }>();
let evidence: Record<string, unknown> | undefined;
let failure: unknown;

function rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out: ' + method)); }, 45_000);
    pending.set(id, { resolve, reject, timer });
    client!.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }));
  });
}

function readText(result: McpResult) {
  const text = result.content.map(record).find(item => item.type === 'text')?.text;
  assert.equal(typeof text, 'string', 'official MCP adapter returns text content');
  return JSON.parse(String(text)) as unknown;
}

async function cleanThread() {
  if (!threadId || !app) return;
  assert.ok(createdEmpty && modelTurns === 0, 'delete only this probe’s new thread with no model turns');
  const { thread } = await app.control.request('thread/read', { threadId, includeTurns: false });
  assert.equal(thread.id, threadId);
  assert.equal(thread.cwd, workspace);
  assert.equal(thread.status.type, 'idle');
  assert.equal(thread.name, null, 'the probe never renames its thread');
  // The daemon rejects includeTurns even for empty persistent threads. Use its
  // official delete RPC only for this probe; production deletion is unchanged.
  await app.control.request('thread/delete', { threadId }, { mutating: true });
  cleanupVerified = true;
}

try {
  await mkdir(workspace);
  await mkdir(dataDir, { mode: 0o700 });
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify(projects));
  app = await createNativeWorkbench({ port: 0, dataDir, workspace, socketPath,
    codexHome: join(root, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} } });
  client = new WebSocket(app.url.replace('http:', 'ws:') + '/native-host', { origin: app.url });
  client.on('message', bytes => {
    const message = record(JSON.parse(String(bytes)));
    if (message.type === 'mcp-notification' && message.method === 'turn/started' && record(message.params).threadId === threadId) modelTurns++;
    if (message.type !== 'mcp-response') return;
    const reply = record(message.message), call = pending.get(Number(reply.id));
    if (!call) return;
    pending.delete(Number(reply.id)); clearTimeout(call.timer);
    if (reply.error) call.reject(new Error(String(record(reply.error).message)));
    else call.resolve(reply.result);
  });
  client.on('error', () => {});
  client.on('close', () => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Private Web host disconnected')); }
    pending.clear();
  });
  await once(client, 'open');
  const started = record(await rpc('thread/start', { cwd: workspace, ephemeral: false,
    approvalPolicy: 'never', sandbox: 'read-only' }));
  const thread = record(started.thread);
  assert.equal(typeof thread.id, 'string');
  threadId = String(thread.id);
  console.error(JSON.stringify({ stage: 'private-thread-created', threadId, endpoint: app.url }));
  assert.equal(thread.ephemeral, false);
  assert.deepEqual(thread.turns, []);
  createdEmpty = true;

  const status = await app.control.request<{ data: McpStatus[]; nextCursor: string | null }>('mcpServerStatus/list',
    { threadId, serverName: 'codex_app', detail: 'toolsAndAuthOnly', limit: 100 });
  assert.equal(status.nextCursor, null);
  assert.equal(status.data.length, 1);
  const server = status.data[0]!;
  assert.equal(server.runtimeStatus, 'connected');
  assert.equal(server.toolsError, null);
  const names = Object.keys(server.tools).sort();
  assert.deepEqual(names, appToolCatalog.map(tool => tool.name).sort());

  // This exercises daemon -> official MCP adapter -> this private Web host.
  const result = await app.control.request<McpResult>('mcpServer/tool/call',
    { threadId, server: 'codex_app', tool: 'list_projects', arguments: {} });
  assert.notEqual(result.isError, true);
  assert.deepEqual(readText(result), { projects, workspace });
  const rejected = await app.control.request<McpResult>('mcpServer/tool/call',
    { threadId, server: 'codex_app', tool: 'list_projects', arguments: { unexpected: true } });
  assert.equal(rejected.isError, true, 'a host failure must remain an MCP failure');
  assert.deepEqual(readText(rejected), { error: '工具参数无效。', uncertain: false });

  assert.equal(modelTurns, 0, 'read-only MCP inspection starts no model turn');
  evidence = { startedAt, endpoint: app.url, privateDataDir: dataDir, threadId, ephemeral: false,
    runtimeStatus: server.runtimeStatus, pluginId: server.pluginId, tools: names,
    listProjects: 'passed', invalidArgumentsRemainError: true, modelTurns, titleWrites: 0 };
} catch (cause) {
  failure = cause;
} finally {
  try { await cleanThread(); }
  catch (cause) { failure = failure === undefined ? cause : new AggregateError([failure, cause], 'Verification and cleanup failed'); }
  finally {
    client?.terminate();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
}
if (failure !== undefined) throw failure;
assert.ok(cleanupVerified, 'the private thread must be cleaned up before reporting success');
console.log(JSON.stringify({ ...evidence, cleanupMethod: 'thread/delete', cleanupVerified, finishedAt: new Date().toISOString() }, null, 2));
