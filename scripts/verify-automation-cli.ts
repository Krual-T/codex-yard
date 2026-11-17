// An actual CLI backend with a loopback scripted provider. No personal account,
// external model requests, desktop installation or shared daemon is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { AutomationRun } from '../src/native/automations.ts';
import { CodexConnection } from '../lib/codex.ts';
import type { RpcMessage, TurnSummary, Page } from '../lib/codex-protocol.ts';
import { record } from '../src/native/protocol.ts';

const root = await mkdtemp('/tmp/yard-schedule-cli-'), codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_AUTOMATIONS_CLI_EVIDENCE ?? '.local/automations-cli');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
const requests: Record<string, unknown>[] = [];
const provider = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  if (!request.url?.endsWith('/responses')) { response.writeHead(404); response.end('{}'); return; }
  const value = JSON.parse(body) as Record<string, unknown>; requests.push(value);
  const input = JSON.stringify(value.input), approval = input.includes('APPROVAL_FIXTURE');
  const toolOutput = Array.isArray(value.input) && value.input.some(item => record(item).type === 'function_call_output');
  const id = 'response-' + requests.length;
  const item = approval && !toolOutput
    ? { id: 'call-' + requests.length, type: 'function_call', name: 'exec_command', call_id: 'call-' + requests.length,
      arguments: JSON.stringify({ cmd: 'printf SCHEDULE_APPROVAL_OK', sandbox_permissions: 'require_escalated', justification: 'Allow this isolated scheduling test to print its marker?' }), status: 'completed' }
    : { id: 'message-' + requests.length, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'SCHEDULE_STANDALONE_OK', annotations: [] }] };
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { id, object: 'response', status: 'completed', output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } });
  response.end();
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const providerPort = (provider.address() as import('node:net').AddressInfo).port;
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"\nmodel_provider = "fixture"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "Scheduling fixture"\nbase_url = "http://127.0.0.1:${providerPort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\ncode_mode = false\n`, { mode: 0o600 });
const socketPath = join(root, 'backend.sock');
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, pageConnection: CodexConnection | undefined;
const checks: string[] = [], report: Record<string, unknown> = { checks, provider: 'loopback scripted Responses', root };
const appOptions = { port: 0, dataDir, workspace: root, socketPath, codexHome,
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) };
async function waitUntil<T>(read: () => Promise<T>, matches: (value: T) => boolean, timeout = 30000): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await read(); if (matches(value)) return value; await delay(100); }
  throw new Error('Condition timed out');
}
async function history() { return (await app!.automations.fetch('automation-runs', {}) as { items: AutomationRun[] }).items; }
try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  await waitUntil(async () => { try { await access(socketPath); return true; } catch { if (child.exitCode !== null) throw new Error(log); return false; } }, Boolean);
  app = await createNativeWorkbench(appOptions);
  report.cli = app.control.server?.userAgent;
  const due = Math.floor(Date.now() / 1000) * 1000 + 2000;
  const rdate = new Date(due).toISOString().replaceAll('-', '').replaceAll(':', '').replace('.000', '');
  await app.automations.fetch('automation-create', { params: { name: 'Standalone schedule fixture', prompt: 'Reply with SCHEDULE_STANDALONE_OK.',
    rrule: 'RDATE:' + rdate, timeZone: 'UTC' } });
  await waitUntil(async () => Date.now(), at => at >= due);
  await app.automations.tick();
  let run = (await waitUntil(history, runs => runs[0]?.status === 'running' || runs[0]?.status === 'completed'))[0];
  await waitUntil(async () => { await app!.automations.tick(); return (await history())[0]; }, r => r.status === 'completed');
  checks.push('Actual CLI completes a due scheduled prompt with zero browser clients');
  await app.close(); app = await createNativeWorkbench(appOptions);
  await app.automations.tick();
  assert.equal((await history())[0].id, run.id);
  const turns = await app.control.request<Page<TurnSummary>>('thread/turns/list', { threadId: run.threadId, itemsView: 'full' });
  assert.equal(turns.data.length, 1);
  assert.ok(turns.data[0].items.some(item => item.type === 'userMessage' && item.clientId === run.id));
  checks.push('CLI preserves the run client message ID and restart does not resend');
  const approvalTask = await app.automations.fetch('automation-create', { params: { name: 'Approval fixture', prompt: 'APPROVAL_FIXTURE',
    rrule: 'FREQ=DAILY', status: 'PAUSED', timeZone: 'UTC' } }) as { item: { id: string } };
  const backgroundRequests: RpcMessage[] = [];
  app.control.on('message', message => { if (message.id != null) backgroundRequests.push(message); });
  await app.automations.fetch('automation-run-now', { id: approvalTask.item.id });
  await waitUntil(async () => backgroundRequests, list => list.some(m => /requestApproval|requestUserInput/.test(m.method)));
  run = (await history())[0];
  const original = backgroundRequests.find(m => /requestApproval|requestUserInput/.test(m.method))!;
  report.backgroundRequest = { method: original.method, params: original.params };
  checks.push('Actual CLI pauses for approval with no browser connected');
  await app.close(); app = await createNativeWorkbench(appOptions);
  pageConnection = new CodexConnection(socketPath); const replay: RpcMessage[] = [];
  pageConnection.on('message', message => { if (message.id != null) replay.push(message); });
  await pageConnection.connect();
  await pageConnection.request('thread/resume', { threadId: run.threadId, excludeTurns: true }, { mutating: true });
  await waitUntil(async () => replay, list => list.some(m => m.method === original.method));
  const pending = replay.find(m => m.method === original.method)!;
  assert.equal(record(pending.params).threadId, run.threadId);
  await pageConnection.respond(pending.id!, { decision: 'accept' });
  await waitUntil(async () => { await app!.automations.tick(); return (await history())[0]; }, r => r.status === 'completed');
  checks.push('After Yard restart, a later conversation connection receives and answers the pending approval');
  assert.equal((await history())[0].id, run.id);
  if (process.argv.includes('--ui')) {
    const ui = spawn(process.execPath, ['scripts/verify-automations.ts'], { cwd: process.cwd(),
      env: { ...process.env, AGENTS_TEST_CODEX_SOCKET: socketPath, AGENTS_TEST_CODEX_HOME: codexHome,
        AGENTS_AUTOMATIONS_EVIDENCE: join(output, 'ui') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let uiLog = ''; ui.stdout.on('data', chunk => { uiLog += chunk; }); ui.stderr.on('data', chunk => { uiLog += chunk; });
    const [exitCode] = await once(ui, 'exit'); await writeFile(join(output, 'ui.log'), uiLog);
    assert.equal(exitCode, 0, uiLog); checks.push('Pinned Scheduled UI creates, runs and pauses a task on the actual CLI backend');
  }
  report.ok = true;
} catch (error) { report.ok = false; report.failure = String(error); process.exitCode = 1; }
finally {
  report.runs = app ? await history() : [];
  report.requestCount = requests.length;
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2));
  await writeFile(join(output, 'backend.log'), log);
  pageConnection?.close(); await app?.close();
  child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit');
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
