// Real CLI, isolated data, the shared loopback provider, and actual Yard RPCs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { CodexConnection } from '../lib/codex.ts';
import type { RequestOptions, RpcMessage, RpcResult, ThreadSummary } from '../lib/codex-protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { PINNED_SECTION_ID, sidebarMetadata } from '../src/native/backend-sidebar-state.ts';
import type { SidebarProject, SidebarSection, SidebarSectionInput } from '../src/native/backend-sidebar-state.ts';
import { record } from '../src/native/protocol.ts';
import type { ObjectValue } from '../src/native/protocol.ts';
import { createCliResponsesFixture } from './cli-responses-fixture.ts';

const root = await mkdtemp('/tmp/yard-sidebar-state-'), codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_SIDEBAR_STATE_EVIDENCE ?? '.local/sidebar-state');
const roots = [join(root, 'alpha'), join(root, 'beta'), join(root, 'external')];
await Promise.all([codexHome, dataDir, output, ...roots].map(path => mkdir(path, { recursive: true })));
await Promise.all(['result.json', 'failure.json', 'cli.log'].map(name => rm(join(output, name), { force: true })));
const provider = await createCliResponsesFixture(() => ({ text: 'SIDEBAR_STANDALONE_OK' }));
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.fixture]
name = "Sidebar fixture"
base_url = "http://127.0.0.1:${provider.port}/v1"
wire_api = "responses"
requires_openai_auth = false
[features]
code_mode = false
`, { mode: 0o600 });
const socketPath = join(root, 'backend.sock');
let log = '';
function startBackend() {
  const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
    env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  return child;
}
let child = startBackend(), external = new CodexConnection(socketPath, { cwd: root });
const calls: { method: string; params: ObjectValue }[] = [], checks: string[] = [];
const report: ObjectValue = { checks, provider: 'shared loopback Responses fixture', ordinaryThreadCount: 53 };
const originalRequest = CodexConnection.prototype.requestWithCursor;
let projectListBarrier: { armed: boolean; captured: boolean; wait: Promise<void>; release(): void } | undefined;
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let client: Awaited<ReturnType<typeof connectClient>> | undefined;
const appOptions = { port: 0, dataDir, codexHome, workspace: root, socketPath,
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) };

async function connectClient(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/native-host', { origin: url });
  const pending = new Map<string, { resolve(value: ObjectValue): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const messages: ObjectValue[] = [];
  let sequence = 0;
  socket.on('message', bytes => {
    const value = record(JSON.parse(String(bytes))), reply = record(value.message);
    messages.push(value);
    const id = value.type === 'fetch-response' ? value.requestId : value.type === 'mcp-response' ? reply.id : undefined;
    if (id === undefined) return;
    const item = pending.get(String(id));
    if (item) { clearTimeout(item.timer); pending.delete(String(id)); item.resolve(value); }
  });
  socket.on('close', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Yard test socket closed')); } pending.clear(); });
  await once(socket, 'open');
  function send(message: ObjectValue, id: number) {
    return new Promise<ObjectValue>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(String(id)); reject(new Error('Yard RPC timed out: ' + JSON.stringify(message))); }, 15000);
      pending.set(String(id), { resolve, reject, timer }); socket.send(JSON.stringify(message));
    });
  }
  return { socket, messages,
    async host<T = unknown>(endpoint: string, params: ObjectValue = {}): Promise<T> {
      const id = ++sequence, value = await send({ type: 'fetch', requestId: String(id), url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) }, id);
      assert.equal(value.responseType, 'success', String(value.error)); return value.body as T;
    },
    async rpc<T = unknown>(method: string, params: ObjectValue = {}): Promise<T> {
      const id = ++sequence, value = await send({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }, id);
      const reply = record(value.message); assert.equal(reply.error, undefined, JSON.stringify(reply.error)); return reply.result as T;
    },
  };
}
async function global<T = unknown>(key: string): Promise<T> { return (await client!.host<{ value: T }>('get-global-state', { key })).value; }
async function waitUntil<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  let value: T | undefined;
  for (let i = 0; i < 100; i++) { value = await read(); if (accepts(value)) return value; await delay(50); }
  throw new Error('Sidebar state did not converge: ' + JSON.stringify(value));
}
async function materialize(index: number) {
  const { thread } = await external.request('thread/start', { cwd: root, historyMode: 'paginated' }, { mutating: true });
  let listener!: (message: RpcMessage) => void, timer!: ReturnType<typeof setTimeout>;
  const done = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Fixture turn timed out')), 20000);
    listener = message => { if (message.method === 'turn/completed' && record(message.params).threadId === thread.id) {
      const turn = record(record(message.params).turn); if (turn.status === 'failed') reject(new Error(JSON.stringify(turn))); else resolve();
    } };
    external.on('message', listener);
  });
  try { await external.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Sidebar fixture ' + index, text_elements: [] }] }, { mutating: true }); await done; }
  finally { clearTimeout(timer); external.off('message', listener); }
  return thread.id;
}
async function restart() {
  client?.socket.terminate(); client = undefined; await app?.close();
  app = await createNativeWorkbench(appOptions); client = await connectClient(app.url);
}
async function connectBackend() {
  for (let i = 0; ; i++) {
    try { await access(socketPath); break; } catch { if (i >= 100 || child.exitCode !== null) throw new Error(log || 'CLI socket did not start'); await delay(100); }
  }
  await external.connect();
}
async function restartBackend() {
  external.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  await rm(socketPath, { force: true });
  child = startBackend(); external = new CodexConnection(socketPath, { cwd: root });
  await connectBackend();
}
async function savedGlobals() { return record(record(JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8'))).globals); }

try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true;
  }
  await connectBackend(); report.cli = external.server?.userAgent;
  const native = (await external.request<{ project: SidebarProject }>('project/create', { name: 'Backend priority', roots: [{ path: roots[0] }],
    metadata: { [sidebarMetadata.appearance]: JSON.stringify({ color: 'blue' }) }, idempotencyKey: 'native-project' }, { mutating: true })).project;
  const other = (await external.request<{ project: SidebarProject }>('project/create', { name: 'External project', roots: [{ path: roots[2] }],
    idempotencyKey: 'external-project' }, { mutating: true })).project;
  const ids: string[] = [];
  for (let i = 0; i < 53; i++) ids.push(await materialize(i));
  const deletedId = '00000000-0000-4000-8000-000000000999';
  await external.request('thread/metadata/update', { threadId: ids[0], projectId: other.id }, { mutating: true });
  await external.request('thread/section/move', { threadId: ids[3], sectionId: PINNED_SECTION_ID }, { mutating: true });
  const focus = (await external.request<{ section: SidebarSection }>('threadSection/create', { name: 'Backend Focus', appearance: null }, { mutating: true })).section;
  await external.request('thread/section/move', { threadId: ids[4], sectionId: focus.id }, { mutating: true });
  await restartBackend();
  assert.deepEqual((await external.request<{ data: string[] }>('thread/loaded/list', {})).data, []);
  const historical = await external.request<{ thread: ThreadSummary }>('thread/read', { threadId: ids[1], includeTurns: false });
  assert.equal(historical.thread.id, ids[1]); assert.equal(historical.thread.projectId, null);
  assert.deepEqual((await external.request<{ data: string[] }>('thread/loaded/list', {})).data, [], 'metadata-only history reads must not load a conversation');
  await assert.rejects(external.request('thread/read', { threadId: deletedId, includeTurns: false }), error =>
    record(error).code === -32600 && error instanceof Error && error.message === 'thread not loaded: ' + deletedId);
  report.backendRestart = { loadedThreadCount: 0, historicalThreadReadable: true, staleIdError: 'thread not loaded: ' + deletedId };
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify(roots.slice(0, 2).map((path, index) => ({ path, name: 'Old project ' + index }))));
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ settings: {}, globals: {
    'yard-legacy-catalog-imported': true,
    'local-projects': Object.fromEntries(roots.slice(0, 2).map(path => [path, { name: 'Legacy name', rootPaths: [path] }])),
    'thread-project-assignments': { [ids[0]]: { projectKind: 'local', projectId: roots[1] }, [ids[1]]: { projectKind: 'local', projectId: roots[1] },
      [deletedId]: { projectKind: 'local', projectId: roots[1] } },
    'thread-project-membership-host-ids': { [deletedId]: 'local' },
    'pinned-thread-ids': [ids[2], ids[4], ids[3], deletedId], 'project-order': [roots[1], roots[0]],
    'project-appearances': { [roots[0]]: { color: 'red' } }, 'sidebar-project-thread-orders': { [roots[1]]: { threadIds: [ids[1]] } },
    'projectless-thread-ids': [ids[0]], 'thread-projectless-output-directories': { [ids[0]]: root, pending: join(root, 'pending') },
    'thread-workspace-root-hints': { [ids[0]]: root, pending: root },
  } }));
  CodexConnection.prototype.requestWithCursor = function(this: CodexConnection, method: string, params?: unknown, options?: RequestOptions): Promise<RpcResult<unknown>> {
    calls.push({ method, params: record(params) });
    const result = originalRequest.call(this, method, params, options);
    if (method === 'project/list' && projectListBarrier?.armed) {
      const barrier = projectListBarrier; barrier.armed = false;
      return result.then(async value => { barrier.captured = true; await barrier.wait; return value; });
    }
    return result;
  } as typeof originalRequest;
  await restart();
  const migrationLists = calls.filter(call => call.method === 'thread/list');
  assert.ok(migrationLists.length > 0 && migrationLists.every(call => Object.hasOwn(call.params, 'sectionId') || Object.hasOwn(call.params, 'projectId')));
  const projects = await global<ObjectValue>('local-projects');
  const beta = Object.entries(projects).find(([, value]) => (record(value).rootPaths as string[]).includes(roots[1]))![0];
  assert.equal(record(projects[native.id]).name, 'Backend priority');
  const assignments = await global<ObjectValue>('thread-project-assignments');
  assert.equal(record(assignments[ids[0]]).projectId, other.id); assert.equal(record(assignments[ids[1]]).projectId, beta);
  assert.equal(assignments[deletedId], undefined);
  assert.equal(calls.some(call => call.params.threadId === deletedId && call.method !== 'thread/read'), false);
  assert.deepEqual(await client!.host('list-pinned-threads'), { threadIds: [ids[3], ids[2]], serverOrderedThreadIds: [ids[3], ids[2]] });
  const saved = await savedGlobals();
  for (const key of ['local-projects', 'thread-project-assignments', 'pinned-thread-ids', 'project-order', 'project-appearances', 'sidebar-project-thread-orders']) assert.equal(saved[key], undefined, key);
  assert.deepEqual(saved['projectless-thread-ids'], [ids[0]]);
  assert.deepEqual(saved['thread-projectless-output-directories'], { pending: join(root, 'pending') });
  checks.push('After a CLI restart, unloaded history keeps migrated membership and pins; stale references are removed, backend values win and durable projections contract');
  const beforeStartup = calls.length;
  const startup = await client!.host<{ threads: { id: string }[] }>('startup-sidebar');
  const ordinary = calls.slice(beforeStartup).filter(call => call.method === 'thread/list' && !Object.hasOwn(call.params, 'sectionId') && !Object.hasOwn(call.params, 'projectId'));
  assert.equal(startup.threads.length, 50); assert.equal(ordinary.length, 1); assert.equal(ordinary[0].params.limit, 50); assert.equal(ordinary[0].params.useStateDbOnly, true);
  report.startup = { returned: startup.threads.length, params: ordinary[0].params }; report.migrationReads = migrationLists.map(call => call.params);
  checks.push('With 53 materialized conversations, ordinary startup reads one bounded page of 50; migration performs only directed reads');

  const merged = await client!.host<{ sectionIds: Record<string, string> }>('sidebar-sections', { operation: 'merge',
    sections: [{ id: focus.id, name: 'Legacy Focus', appearance: null, threadIds: [ids[4], ids[6]] }] });
  assert.equal(merged.sectionIds[focus.id], focus.id);
  const beforeStart = calls.length;
  const assignment = { projectKind: 'local', projectId: roots[1] };
  const startId = await client!.host<string>('thread-projects', { operation: 'getThreadStartProjectId', value: assignment });
  const started = await client!.rpc<{ thread: ThreadSummary }>('thread/start', { cwd: root, projectId: startId });
  await client!.host('thread-projects', { operation: 'setMembership', value: { threadId: started.thread.id, assignment, projectless: false } });
  const projectless = await client!.rpc<{ thread: ThreadSummary }>('thread/start', { cwd: root });
  await client!.host('thread-projects', { operation: 'setMembership', value: { threadId: projectless.thread.id, assignment: null, projectless: true } });
  assert.equal(calls.slice(beforeStart).some(call => ['thread/read', 'thread/metadata/update'].includes(call.method) &&
    [started.thread.id, projectless.thread.id].includes(String(call.params.threadId))), false);
  checks.push('Before the first rollout, thread/start.projectId and its confirmed response supply project and projectless membership');

  // Hold a real catalog response so the subsequent move notification lands
  // while Yard is still refreshing from the rename's older project snapshot.
  let releaseProjectList!: () => void;
  const projectListWait = new Promise<void>(resolve => { releaseProjectList = resolve; });
  projectListBarrier = { armed: true, captured: false, wait: projectListWait, release: releaseProjectList };
  await external.request('project/update', { projectId: native.id, name: 'External renamed project' }, { mutating: true });
  await waitUntil(async () => projectListBarrier!.captured, captured => captured);
  await external.request('thread/metadata/update', { threadId: ids[1], projectId: other.id }, { mutating: true });
  const notificationStart = client!.messages.length;
  await external.request('project/move', { projectId: beta, beforeProjectId: native.id }, { mutating: true });
  await waitUntil(async () => client!.messages.slice(notificationStart), messages => messages.some(message =>
    message.type === 'mcp-notification' && message.method === 'project/changed' && record(message.params).projectId === beta));
  projectListBarrier.release();
  await waitUntil(() => global<ObjectValue>('local-projects'), value => record(value[native.id]).name === 'External renamed project');
  await waitUntil(() => global<ObjectValue>('thread-project-assignments'), value => record(value[ids[1]]).projectId === other.id);
  const expectedOrder = [beta, native.id, other.id];
  assert.deepEqual(await waitUntil(() => global<string[]>('project-order'), value => JSON.stringify(value) === JSON.stringify(expectedOrder)), expectedOrder);
  report.projectChangeDuringRefresh = true;
  await external.request('threadSection/update', { sectionId: focus.id, name: 'External renamed section', appearance: { icon: 'star', color: 'green' } }, { mutating: true });
  await external.request('thread/section/move', { threadId: ids[2], sectionId: focus.id, beforeThreadId: ids[4] }, { mutating: true });
  await external.request('thread/section/move', { threadId: ids[5], sectionId: PINNED_SECTION_ID, beforeThreadId: ids[3] }, { mutating: true });
  await client!.host('sidebar-refresh');
  const snapshot = await client!.host<{ sections: SidebarSectionInput[] }>('sidebar-sections', { operation: 'snapshot' });
  assert.equal(snapshot.sections[0].name, 'External renamed section'); assert.deepEqual(snapshot.sections[0].threadIds, [ids[2], ids[4], ids[6]]);
  assert.deepEqual(await client!.host('list-pinned-threads'), { threadIds: [ids[5], ids[3]], serverOrderedThreadIds: [ids[5], ids[3]] });
  checks.push('External project changes during an in-flight catalog refresh converge through notifications; explicit refresh reconciles section names, members and native pin order');

  const projectIds = Object.keys(await global<ObjectValue>('local-projects'));
  await restart(); assert.deepEqual(Object.keys(await global<ObjectValue>('local-projects')), projectIds);
  assert.equal((await external.request<{ data: SidebarProject[] }>('project/list', {})).data.length, 3);
  assert.deepEqual(await client!.host('list-pinned-threads'), { threadIds: [ids[5], ids[3]], serverOrderedThreadIds: [ids[5], ids[3]] });
  const sectionIds = snapshot.sections.map(section => section.id);
  assert.deepEqual((await client!.host<{ sections: SidebarSectionInput[] }>('sidebar-sections', { operation: 'snapshot' })).sections.map(section => section.id), sectionIds);
  await client!.rpc('project/delete', { projectId: beta }); await restart();
  assert.equal(Object.values(await global<ObjectValue>('local-projects')).some(value => (record(value).rootPaths as string[]).includes(roots[1])), false);
  assert.equal((await external.request<{ data: SidebarProject[] }>('project/list', {})).data.length, 2);
  checks.push('Yard restart keeps native identities and order; deleting a migrated project stays deleted despite the old projects.json input');
  report.providerRequests = provider.requests;
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ ...report, error: String(error) }, null, 2));
  await writeFile(join(output, 'cli.log'), log); throw error;
} finally {
  projectListBarrier?.release();
  CodexConnection.prototype.requestWithCursor = originalRequest;
  client?.socket.terminate(); await app?.close(); external.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  provider.server.closeAllConnections(); await new Promise<void>(resolve => provider.server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
