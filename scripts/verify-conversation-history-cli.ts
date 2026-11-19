// Standalone CLI + loopback provider. No account, desktop process or shared daemon.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import type { ThreadSummary, TurnSummary, Page, RpcMessage } from '../lib/codex-protocol.ts';

const root = await mkdtemp('/tmp/yard-history-cli-');
const codexHome = join(root, 'codex'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_HISTORY_CLI_EVIDENCE ?? '.local/conversation-history/cli');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'CLI history fixture', path: root }]));
let responses = 0;
let releaseActiveResponse!: () => void;
const activeResponseGate = new Promise<void>(resolve => { releaseActiveResponse = resolve; });
let markActiveWaiting!: () => void;
const activeWaiting = new Promise<void>(resolve => { markActiveWaiting = resolve; });
const provider = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  if (!request.url?.endsWith('/responses')) { response.writeHead(404).end('{}'); return; }
  const value = record(JSON.parse(body)), input = Array.isArray(value.input) ? value.input.map(record) : [];
  let lastUser = input.length - 1;
  while (lastUser >= 0 && input[lastUser]?.role !== 'user') lastUser--;
  const prompt = JSON.stringify(input[lastUser] ?? {});
  const reentry = prompt.includes('HISTORY_REENTER');
  const command = prompt.includes('HISTORY_COMMAND') && !input.slice(lastUser + 1).some(item => item.type === 'function_call_output');
  const marker = reentry ? 'CLI reentered final reply' : prompt.includes('HISTORY_LIVE_OK') ? 'HISTORY_LIVE_OK' : (prompt.match(/CLI response [01]\/[0-9]+/)?.[0] ?? 'CLI response');
  const id = 'response-' + ++responses;
  const item = command ? { id: 'call-' + responses, type: 'function_call', name: 'exec_command', call_id: 'call-' + responses,
    arguments: JSON.stringify({ cmd: "printf 'HISTORY_ACTIVITY_OK\\n%.0s' {1..8192}", max_output_tokens: 100000 }), status: 'completed' }
    : { id: 'message-' + responses, type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed',
      content: [{ type: 'output_text', text: marker, annotations: [] }] };
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
  if (reentry && !command) { markActiveWaiting(); await activeResponseGate; }
  const commentaryText = reentry ? 'CLI completed progress before reentry' : 'CLI investigation';
  const commentary = { id: 'commentary-' + responses, type: 'message', role: 'assistant', phase: 'commentary', status: 'completed',
    content: [{ type: 'output_text', text: commentaryText, annotations: [] }] };
  if (command) {
    event('response.output_item.added', { output_index: 0, item: { ...commentary, status: 'in_progress' } });
    event('response.content_part.added', { output_index: 0, item_id: commentary.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    event('response.output_text.delta', { output_index: 0, item_id: commentary.id, content_index: 0, delta: commentaryText });
    event('response.output_item.done', { output_index: 0, item: commentary });
  }
  const outputIndex = command ? 1 : 0;
  event('response.output_item.added', { output_index: outputIndex, item: { ...item, status: 'in_progress' } });
  if (!command) {
    event('response.content_part.added', { output_index: 0, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    event('response.output_text.delta', { output_index: 0, item_id: item.id, content_index: 0, delta: marker });
    if (marker === 'HISTORY_LIVE_OK') await delay(500);
  }
  event('response.output_item.done', { output_index: outputIndex, item });
  event('response.completed', { response: { id, object: 'response', status: 'completed', output: command ? [commentary, item] : [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } });
  response.end();
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const port = (provider.address() as import('node:net').AddressInfo).port;
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.fixture]\nname = "History fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\ncode_mode = false\n`, { mode: 0o600 });
const socketPath = join(root, 'backend.sock');
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
  env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { checks, errors, renderer: '26.1013.40934', provider: 'loopback scripted Responses' };
try {
  for (let i = 0; ; i++) {
    try { await access(socketPath); break; } catch {
      if (i >= 100 || child.exitCode !== null) throw new Error(log || 'CLI socket did not start');
      await delay(100);
    }
  }
  app = await createNativeWorkbench({ port: 0, dataDir, codexHome, workspace: root, socketPath,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const { thread } = await app.control.request<{ thread: ThreadSummary }>('thread/start', { cwd: root, historyMode: 'paginated' }, { mutating: true });
    ids.push(thread.id);
    await app.control.request('thread/name/set', { threadId: thread.id, name: index ? 'CLI switch fixture' : 'CLI history fixture' }, { mutating: true });
    for (let turn = 0; turn < 4; turn++) {
      const completed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { app!.control.off('message', listener); reject(new Error('CLI turn timed out')); }, 20000);
        const listener = (message: RpcMessage) => {
          const params = record(message.params);
          if (message.method === 'turn/completed' && params.threadId === thread.id) {
            clearTimeout(timer); app!.control.off('message', listener);
            if (record(params.turn).status === 'failed') reject(new Error(JSON.stringify(params.turn)));
            else resolve();
          }
        };
        app!.control.on('message', listener);
      });
      await app.control.request('turn/start', { threadId: thread.id,
        input: [{ type: 'text', text: `HISTORY_COMMAND. Then reply CLI response ${index}/${turn}`, text_elements: [] }] }, { mutating: true });
      await completed;
    }
  }
  const summary = await app.control.request<Page<TurnSummary>>('thread/turns/list', { threadId: ids[0], itemsView: 'summary', limit: 2, sortDirection: 'desc' });
  const full = await app.control.request<Page<TurnSummary>>('thread/turns/list', { threadId: ids[0], itemsView: 'full', limit: 2, sortDirection: 'desc' });
  assert.equal(summary.data.length, 2); assert.ok(summary.nextCursor);
  assert.ok(summary.data.every(turn => !turn.items.some(item => item.type === 'commandExecution')));
  assert.ok(full.data.every(turn => turn.items.some(item => item.type === 'commandExecution')));
  report.summaryBytes = Buffer.byteLength(JSON.stringify(summary)); report.fullBytes = Buffer.byteLength(JSON.stringify(full));
  checks.push('Real CLI returns two paginated summaries with messages/timing and defers command output');
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  const itemReads: Record<string, unknown>[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    const value = JSON.parse(String(frame.payload));
    if (value.request?.method === 'thread/items/list') itemReads.push(value.request.params);
  }));
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), async button => { await button.click(); });
  const start = performance.now();
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + ids[0]), { waitUntil: 'commit' });
  await page.getByText('CLI response 0/3', { exact: true }).waitFor({ timeout: 30000 });
  report.firstHistoryMs = Math.round(performance.now() - start);
  await page.waitForTimeout(500);
  assert.equal(itemReads.length, 0, 'CLI activity must stay unread while collapsed');
  await page.screenshot({ path: join(output, 'collapsed.png') });
  const worked = page.getByRole('button', { name: /^(Worked for|工作了|耗时)/ }).last();
  await worked.click();
  await page.getByText('CLI investigation', { exact: true }).waitFor({ timeout: 10000 });
  assert.ok(itemReads.length > 0);
  assert.ok(itemReads.every(params => params.threadId === ids[0] && params.turnId === summary.data[0].id));
  report.expandedTurnReads = [...itemReads];
  const activity = page.getByRole('button', { name: /^(Ran|已运行)/ }).last();
  await activity.waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole('button', { name: '查看完整过程', exact: true }).count(), 0);
  await activity.click();
  await page.getByText('HISTORY_ACTIVITY_OK', { exact: false }).first().waitFor({ timeout: 10000 });
  checks.push('Original Worked control loads only its CLI turn; native command control shows the deferred output');
  const sidebar = await page.locator('#app-shell-sidebar').elementHandle();
  const sidebarTrigger = page.locator('[data-app-shell-sidebar-trigger]:visible').first();
  await page.getByRole('textbox').last().fill('CLI sidebar draft');
  for (const open of [false, true]) {
    await sidebarTrigger.click();
    await page.waitForFunction(open => document.querySelector('[data-app-shell-sidebar-open]')?.getAttribute('data-app-shell-sidebar-open') === String(open)
      && !document.getAnimations().some(animation => animation.id === 'yard-sidebar-transition'), open);
  }
  assert.ok(await sidebar!.evaluate(element => element === document.querySelector('#app-shell-sidebar')));
  assert.equal(await page.getByRole('textbox').last().innerText(), 'CLI sidebar draft');
  await page.getByText('CLI response 0/3', { exact: true }).waitFor();
  checks.push('Sidebar collapse/reopen retains its DOM, draft and real CLI conversation');
  await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'CLI switch fixture' }).first().click();
  await page.getByText('CLI response 1/3', { exact: true }).waitFor({ timeout: 10000 });
  const editor = page.getByRole('textbox').last();
  await editor.fill('Reply HISTORY_LIVE_OK');
  const sendStarted = performance.now();
  await editor.press('Enter');
  const sentBubble = page.getByRole('region', { name: /^(Conversation|对话)$/ }).locator('.bg-user-message').filter({ hasText: 'Reply HISTORY_LIVE_OK' });
  await sentBubble.waitFor({ timeout: 800 });
  report.sendBubbleMs = Math.round(performance.now() - sendStarted);
  await page.getByText('HISTORY_LIVE_OK', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await sentBubble.count(), 1, 'the real CLI reply must retain one user bubble after admission');
  checks.push('Existing-thread submission displays a local bubble immediately and reconciles with the real CLI turn');
  checks.push('Same-page switch continues the existing CLI conversation and displays its streamed reply');
  await app.control.request('turn/start', { threadId: ids[0],
    input: [{ type: 'text', text: 'HISTORY_COMMAND HISTORY_REENTER', text_elements: [] }] }, { mutating: true });
  await Promise.race([activeWaiting, delay(20000, undefined, { ref: false }).then(() => { throw new Error('Active CLI fixture did not reach its response gate'); })]);
  const activeSummary = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
    threadId: ids[0], itemsView: 'summary', limit: 1, sortDirection: 'desc' });
  const activeTurn = activeSummary.data[0];
  assert.equal(activeTurn.status, 'inProgress');
  assert.equal(activeTurn.items.some(item => item.type === 'agentMessage'), false, 'the active CLI summary omits completed commentary');
  const beforeActiveReads = itemReads.length;
  // A fresh renderer has no live items cached from this turn's earlier events.
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + ids[0]), { waitUntil: 'commit' });
  await page.getByText('CLI completed progress before reentry', { exact: true }).waitFor({ timeout: 30000 });
  const activeReads = itemReads.slice(beforeActiveReads);
  report.activeTurnReads = activeReads;
  assert.ok(activeReads.length > 0 && activeReads.length <= 2);
  assert.ok(activeReads.every(params => params.threadId === ids[0] && params.turnId === activeTurn.id));
  const activeWork = page.getByRole('button', { name: /^(Work|工作|耗时)/ }).last();
  assert.equal(await activeWork.getAttribute('aria-expanded'), 'true');
  await activeWork.click();
  assert.equal(await activeWork.getAttribute('aria-expanded'), 'false');
  await activeWork.click();
  await page.getByText('CLI completed progress before reentry', { exact: true }).waitFor();
  checks.push('Reentering a real running CLI turn recovers completed commentary omitted by summary; Work remains expandable');
  await page.screenshot({ path: join(output, 'active-reentered.png') });
  releaseActiveResponse();
  await page.getByText('CLI reentered final reply', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByText('CLI reentered final reply', { exact: true }).count(), 1);
  checks.push('The reentered CLI turn receives its final streamed reply once');
  await page.screenshot({ path: join(output, 'continued.png') });
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error); throw error;
} finally {
  releaseActiveResponse();
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'daemon.log'), log);
  await browser?.close(); await app?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
