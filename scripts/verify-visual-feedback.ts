// Run the complete CLI/browser lifecycle under /tmp/agents-workbench-heavy.lock.
// The provider is local and scripted. No personal account or shared daemon is used.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import type { CodexConnection, RpcMessage } from '../lib/codex.ts';
import type { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';

interface LogoFrame { at: number; present: boolean; visible: boolean; editor: boolean; transform?: string; animations: string[] }
interface CaptureWindow extends Window { visualFrames: LogoFrame[] }
interface Tool extends Record<string, unknown> { name?: string; type?: string; namespace?: string }
const source = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(process.env.AGENTS_VISUAL_OUTPUT || join(source, '.local/visual-feedback-verification'));
const binary = process.env.AGENTS_VISUAL_CODEX_BIN || 'codex';
const chrome = process.env.AGENTS_BROWSER_EXECUTABLE || process.env.AGENTS_TEST_CHROMIUM || '/usr/bin/google-chrome';
const inherited = { ...process.env };
const root = await mkdtemp('/tmp/yard-visual-');
const home = join(root, 'home'), codexHome = join(root, 'codex'), workspace = join(root, 'workspace'), dataDir = join(root, 'data');
const env: Record<string, string> = { PATH: inherited.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8',
  HOME: home, CODEX_HOME: codexHome, TMPDIR: root, SHELL: '/bin/sh', ENV: '/dev/null', BASH_ENV: '/dev/null',
  XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'xdg-data') };
const errors: string[] = [], assetErrors: string[] = [], cleanupErrors: string[] = [];
const events: { method: string; status?: string; command?: string }[] = [];
const results: Record<string, unknown> = { renderer: 'owned React + TypeScript', historicalAppUi: '26.1013.40934',
  realInference: false, personalConfig: false, sharedDaemon: false, errors, assetErrors, events,
  scope: 'Disposable CLI Unix listener, local scripted Responses provider, actual owned App and Chrome; fixed sleep command.' };
let native: CodexConnection | undefined, app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let cli: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
let threadId: string | undefined, turnId: string | undefined, turnRunning = false, providerRequests = 0, cliStderr = '';
let stopCompletionWait = () => {};
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(ready: () => boolean | Promise<boolean>, label: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!await ready()) {
    if (errors.length) throw new Error(errors.join('; '));
    if (Date.now() > deadline) throw new Error(label + ' timed out: ' + cliStderr.slice(-1000));
    await wait(50);
  }
}
function flattenTools(value: unknown, namespace?: string): Tool[] {
  return (Array.isArray(value) ? value : []).flatMap(value => {
    const tool = record(value);
    return Array.isArray(tool.tools) ? flattenTools(tool.tools, typeof tool.name === 'string' ? tool.name : namespace)
      : [{ ...tool, ...(namespace ? { namespace } : {}) } as Tool];
  });
}
const provider = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', data => chunks.push(Buffer.from(data)));
  request.on('end', () => {
    try {
      assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses');
      assert.equal(request.headers.authorization, undefined, 'The local provider never uses a real account');
      const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8'))), index = ++providerRequests;
      assert(index <= 3, 'Only setup, the fixed command and its final answer may request the provider');
      const input = Array.isArray(body.input) ? body.input.map(record) : [];
      const id = 'yard-visual-response-' + index;
      const emit = (event: unknown) => response.write('data: ' + JSON.stringify(event) + '\n\n');
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      emit({ type: 'response.created', response: { id } });
      if (index === 2) {
        assert(JSON.stringify(input).includes('YARD_VISUAL_RUN'));
        const tools = flattenTools([...Array.isArray(body.tools) ? body.tools : [],
          ...input.filter(item => item.type === 'additional_tools').flatMap(item => Array.isArray(item.tools) ? item.tools : [])]);
        const tool = tools.find(tool => tool.type === 'function' && ['exec_command', 'shell_command', 'shell'].includes(tool.name || ''))
          || tools.find(tool => tool.type === 'custom' && tool.name === 'exec' && String(tool.description).includes('exec_command'));
        assert(tool, 'The actual CLI must advertise a supported command tool');
        const codeMode = tool.type === 'custom', properties = record(record(tool.parameters).properties);
        const args: Record<string, unknown> = tool.name === 'shell' ? { command: ['/bin/sh', '-c', 'sleep 25'] }
          : tool.name === 'shell_command' ? { command: 'sleep 25' } : { cmd: 'sleep 25' };
        if (codeMode || Object.hasOwn(properties, 'workdir')) args.workdir = workspace;
        if (codeMode || Object.hasOwn(properties, 'yield_time_ms')) args.yield_time_ms = 30000;
        if (Object.hasOwn(properties, 'timeout_ms')) args.timeout_ms = 40000;
        const call = { type: codeMode ? 'custom_tool_call' : 'function_call', id: 'yard-visual-command',
          call_id: 'yard-visual-command-call', name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}),
          ...(codeMode ? { input: 'text(await tools.exec_command(' + JSON.stringify(args) + '));' } : { arguments: JSON.stringify(args) }) };
        results.commandTool = { name: tool.name, namespace: tool.namespace, codeMode };
        emit({ type: 'response.output_item.added', response_id: id, output_index: 0,
          item: { ...call, ...(codeMode ? { input: '' } : { arguments: '' }) } });
        const delta = codeMode ? record(call).input : record(call).arguments;
        emit({ type: codeMode ? 'response.custom_tool_call_input.delta' : 'response.function_call_arguments.delta',
          response_id: id, item_id: call.id, output_index: 0, delta });
        emit({ type: codeMode ? 'response.custom_tool_call_input.done' : 'response.function_call_arguments.done',
          response_id: id, item_id: call.id, output_index: 0, ...(codeMode ? { input: delta } : { arguments: delta }) });
        emit({ type: 'response.output_item.done', response_id: id, output_index: 0, item: call });
      } else {
        if (index === 1) assert(JSON.stringify(input).includes('YARD_VISUAL_READY'));
        else assert(input.some(item => ['function_call_output', 'custom_tool_call_output'].includes(String(item.type))
          && item.call_id === 'yard-visual-command-call'), 'Actual CLI must return the original command result');
        const text = index === 1 ? 'VISUAL_SESSION_READY' : 'VISUAL_FEEDBACK_OK';
        const item = { id: 'yard-visual-message-' + index, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
        emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [], status: 'in_progress' } });
        emit({ type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] } });
        emit({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text });
        emit({ type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text });
        emit({ type: 'response.output_item.done', output_index: 0, item });
      }
      emit({ type: 'response.completed', response: { id } }); response.end();
    } catch (error) {
      errors.push(String(error)); if (!response.headersSent) response.writeHead(500); response.end('Fixture rejected request');
    }
  });
});
function waitForCompletion(label: string) {
  assert(native);
  const connection = native;
  const pending = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { stopCompletionWait(); reject(new Error(label + ' did not complete')); }, 90000);
    const listener = (message: RpcMessage) => {
      const params = record(message.params), turn = record(params.turn);
      if (message.method !== 'turn/completed' || params.threadId !== threadId) return;
      stopCompletionWait(); if (turn.status === 'completed') resolve(); else reject(new Error(label + ' ended with ' + turn.status));
    };
    stopCompletionWait = () => { clearTimeout(timer); connection.off('message', listener); };
    connection.on('message', listener);
  });
  pending.catch(() => {}); return pending;
}
function threadRow() { return page!.locator('.yard-owned-sidebar-thread').filter({ hasText: 'Visual feedback verification' }).first(); }
async function logoFrames() { return page!.evaluate(() => (window as unknown as CaptureWindow).visualFrames); }
async function sampleSpinner() {
  return threadRow().locator('.lucide-loader-circle').evaluate(element => ({ at: performance.now(), transform: getComputedStyle(element).transform,
    animations: element.getAnimations().map(animation => ({ state: animation.playState, name: (animation as CSSAnimation).animationName })) }));
}
async function stopCli() {
  if (!cli?.pid || cli.exitCode !== null || cli.signalCode !== null) return;
  const child = cli;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}
try {
  await mkdir(output, { recursive: true });
  for (const path of [home, codexHome, workspace, dataDir, env.XDG_CONFIG_HOME!, env.XDG_CACHE_HOME!, env.XDG_DATA_HOME!]) await mkdir(path, { mode: 0o700 });
  // Load host modules only after isolating every environment-derived default.
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, env);
  const { CodexConnection: Connection } = await import('../lib/codex.ts');
  const { createNativeWorkbench: createWorkbench } = await import('../src/native/server.ts');
  results.cliVersion = execFileSync(binary, ['--version'], { env, encoding: 'utf8' }).trim();
  results.sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  await new Promise<void>((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); });
  const address = provider.address(); assert(address && typeof address !== 'string');
  const config = 'model_provider="visual_fixture"\nmodel="gpt-6.1-sol"\napproval_policy="never"\nsandbox_mode="read-only"\n[analytics]\nenabled=false\n'
    + '[model_providers.visual_fixture]\nname="Local visual fixture"\nbase_url="http://127.0.0.1:' + address.port
    + '/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\nrequest_max_retries=0\nstream_max_retries=0\n';
  await writeFile(join(codexHome, 'config.toml'), config, { mode: 0o600 });
  const socketPath = join(root, 'cli.sock');
  cli = spawn(binary, ['app-server', '--listen', 'unix://' + socketPath], { cwd: workspace, env, stdio: ['ignore', 'ignore', 'pipe'] });
  cli.on('error', error => errors.push(String(error))); cli.stderr!.on('data', data => { cliStderr = (cliStderr + data).slice(-3000); });
  await until(async () => { assert.equal(cli!.exitCode, null, cliStderr); try { await access(socketPath); return true; } catch { return false; } }, 'CLI Unix listener');
  native = new Connection(socketPath, { cwd: workspace }); await native.connect(); results.initialize = native.server;
  const started = await native.request('thread/start', { cwd: workspace, model: 'gpt-6.1-sol', approvalPolicy: 'never',
    sandbox: 'read-only', historyMode: 'paginated', ephemeral: false });
  threadId = String(started.thread.id); results.threadId = threadId;
  await native.request('thread/name/set', { threadId, name: 'Visual feedback verification' });
  native.on('message', message => {
    const params = record(message.params), turn = record(params.turn), item = record(params.item);
    if (params.threadId !== threadId) return;
    if (typeof turn.id === 'string') turnId = turn.id;
    if (message.method === 'turn/started') turnRunning = true;
    if (message.method === 'turn/completed') turnRunning = false;
    if (message.method.startsWith('turn/') || message.method === 'thread/status/changed' || item.type === 'commandExecution') events.push({ method: message.method,
      status: typeof turn.status === 'string' ? turn.status : typeof item.status === 'string' ? item.status : typeof record(params.status).type === 'string' ? String(record(params.status).type) : undefined,
      command: typeof item.command === 'string' ? item.command : undefined });
  });
  const historyReady = waitForCompletion('Setup turn');
  await native.request('turn/start', { threadId, input: [{ type: 'text', text: 'YARD_VISUAL_READY. Reply VISUAL_SESSION_READY without tools.' }] });
  await historyReady;
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ settings: { localeOverride: 'en-US' } }));
  app = await createWorkbench({ port: 0, dataDir, workspace, socketPath, codexHome,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  results.url = app.url;
  browser = await chromium.launch({ executablePath: chrome, headless: true, env,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(app!.url).origin
      && ['script', 'stylesheet', 'image', 'font', 'manifest'].includes(response.request().resourceType()))
      assetErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(app!.url).origin) { assetErrors.push('Unexpected external browser request: ' + url.origin); await route.abort(); return; }
    // Exercise genuine slow entry loading without adding startup latency to the product.
    if (url.pathname === '/workbench-entry.js') await wait(650);
    await route.continue();
  });
  let submissions = 0;
  page.on('websocket', socket => socket.on('framesent', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.request?.method === 'turn/start' && message.request.params?.threadId === threadId) submissions++;
  }));
  await page.addInitScript(() => {
    const target = window as unknown as CaptureWindow; target.visualFrames = [];
    const timer = setInterval(() => {
      const logo = document.querySelector('.startup-loader__logo'), editor = !!document.querySelector('.standalone-composer [contenteditable="true"]');
      target.visualFrames.push({ at: performance.now(), present: !!logo, visible: !!logo?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        editor, transform: logo ? getComputedStyle(logo).transform : undefined,
        animations: logo ? logo.getAnimations().filter(animation => animation.playState === 'running').map(animation => (animation as CSSAnimation).animationName) : [] });
      if (editor && !logo || target.visualFrames.length > 500) clearInterval(timer);
    }, 80);
  });
  await page.goto(app.url + '/local/' + threadId, { waitUntil: 'commit' });
  const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }); await editor.waitFor({ timeout: 60000 });
  const normalLogo = await logoFrames(); results.normalLogo = normalLogo;
  const breathing = normalLogo.filter(frame => frame.visible && frame.animations.includes('workbench-startup-breathe'));
  assert(breathing.length >= 2 && new Set(breathing.map(frame => frame.transform)).size >= 2, 'Loading logo must visibly animate over time');
  assert.equal(await page.locator('.startup-loader__logo').count(), 0);
  const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  assert.equal(icons.length, 3);
  for (const href of icons) {
    const image = await page.request.get(href); assert.equal(image.status(), 200);
    if (href.endsWith('.svg')) { assert.equal(image.headers()['content-type'], 'image/svg+xml'); assert.match(await image.text(), /<title>Codex Yard<\/title>/); }
    else { assert.equal(image.headers()['content-type'], 'image/png'); assert.deepEqual([...await image.body()].slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]); }
  }
  results.iconSizes = await page.evaluate(async sources => await Promise.all(sources.map(async src => {
    const image = new Image(); image.src = src; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight };
  })), icons);
  assert.deepEqual(results.iconSizes, [{ width: 192, height: 192 }, { width: 64, height: 64 }, { width: 180, height: 180 }]);
  const cdp = await page.context().newCDPSession(page), manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []); assert.equal(JSON.parse(manifest.data!).display, 'standalone'); results.manifest = manifest; await cdp.detach();
  console.log('Owned startup motion, Codex Yard icons and manifest passed');

  await editor.fill('YARD_VISUAL_RUN. Execute exactly one shell command: sleep 25. Then reply VISUAL_FEEDBACK_OK.');
  await until(async () => !await page!.getByRole('button', { name: 'Send', exact: true }).isDisabled(), 'Ready composer');
  const completed = waitForCompletion('UI turn');
  await editor.press('Enter');
  const spinner = threadRow().locator('.lucide-loader-circle'); await spinner.waitFor({ timeout: 15000 });
  const samples = [];
  for (let index = 0; index < 6; index++) {
    samples.push(await sampleSpinner()); if (index === 0 || index === 3) await threadRow().screenshot({ path: join(output, `running-${index}.png`) }); await wait(173);
  }
  results.running = samples;
  assert(new Set(samples.map(sample => sample.transform)).size >= 4, 'Running sidebar ring must rotate across frames');
  assert(samples.every(sample => sample.animations.some(animation => animation.name === 'workbench-thread-spin' && animation.state === 'running')));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await until(async () => (await sampleSpinner()).animations.length === 0, 'Reduced-motion ring');
  const reduced = [await sampleSpinner()]; await wait(211); reduced.push(await sampleSpinner()); results.reducedSpinner = reduced;
  assert(reduced.every(sample => sample.animations.length === 0));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await until(async () => (await sampleSpinner()).animations.some(animation => animation.name === 'workbench-thread-spin' && animation.state === 'running'), 'Resumed ring');
  results.resumedSpinner = await sampleSpinner();
  await page.getByText('VISUAL_FEEDBACK_OK', { exact: true }).last().waitFor({ timeout: 90000 }); await completed;
  results.completedThreadStatus = (await native.request('thread/read', { threadId, includeTurns: false })).thread.status;
  await spinner.waitFor({ state: 'hidden', timeout: 15000 }); assert.equal(submissions, 1); results.submissions = submissions;
  assert(events.some(event => event.command?.includes('sleep 25')), 'Actual CLI command execution must be observed');
  const history = record(await native.request('thread/turns/list', { threadId, limit: 100, sortDirection: 'asc', itemsView: 'full' }));
  assert(Array.isArray(history.data));
  const last = record(history.data.at(-1)); assert.equal(last.status, 'completed'); assert(Array.isArray(last.items));
  assert(last.items.map(record).some(item => item.type === 'commandExecution' && String(item.command).includes('sleep 25') && item.exitCode === 0), 'The actual fixed command must finish successfully');
  await page.screenshot({ path: join(output, 'completed.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload({ waitUntil: 'commit' });
  await page.getByText('VISUAL_FEEDBACK_OK', { exact: true }).last().waitFor({ timeout: 60000 });
  const reducedLogo = await logoFrames(); results.reducedLogo = reducedLogo;
  assert(reducedLogo.some(frame => frame.visible), 'Reduced-motion startup must still show the logo');
  assert(reducedLogo.filter(frame => frame.present).every(frame => frame.animations.length === 0), 'Reduced-motion logo must remain static');
  assert.equal(await threadRow().locator('.lucide-loader-circle').count(), 0); assert.equal(submissions, 1); assert.equal(providerRequests, 3);
  assert.deepEqual(errors, []); assert.deepEqual(assetErrors, []); results.passed = true;
  console.log('Actual CLI command, running/reduced/resumed motion, completion and refresh passed');
} catch (error) {
  results.passed = false; results.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; console.error(results.error);
  if (page && !page.isClosed()) {
    results.body = await page.locator('body').innerText().catch(() => ''); results.logoAtFailure = await logoFrames().catch(() => []);
    await page.screenshot({ path: join(output, 'failed.png'), timeout: 5000 }).catch(() => {});
  }
} finally {
  stopCompletionWait();
  if (turnRunning && turnId && native && threadId) await native.request('turn/interrupt', { threadId, turnId }).catch(error => cleanupErrors.push(String(error)));
  await browser?.close().catch(error => cleanupErrors.push(String(error))); await app?.close().catch(error => cleanupErrors.push(String(error)));
  if (native && threadId) await native.request('thread/archive', { threadId }).catch(error => cleanupErrors.push(String(error)));
  native?.close(); await stopCli().catch(error => cleanupErrors.push(String(error)));
  provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  results.providerRequests = providerRequests;
  if (cleanupErrors.length) { results.cleanupErrors = cleanupErrors; results.passed = false; process.exitCode = 1; }
  assert(root.startsWith('/tmp/yard-visual-'));
  await rm(root, { recursive: true, force: true }).then(() => { results.fixtureRemoved = true; }, error => { results.cleanupError = String(error); results.passed = false; process.exitCode = 1; });
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, inherited);
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'verified.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('Evidence: ' + output);
}
