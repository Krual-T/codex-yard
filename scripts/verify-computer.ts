// A real Codex CLI, an isolated Xvfb desktop and a loopback scripted model.
// No personal account, production display or Codex App process is used.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { CodexConnection } from '../lib/codex.ts';
import { projectRoot } from '../lib/app-resources.ts';
import type { RpcMessage } from '../lib/codex-protocol.ts';
import type { DesktopAction } from '../plugins/yard-computer/desktop.ts';
import { X11Desktop } from '../plugins/yard-computer/desktop.ts';

const root = await mkdtemp('/tmp/yard-computer-cli-');
const codexHome = join(root, 'codex'), dataDir = join(root, 'data'), socketPath = join(root, 'backend.sock');
const output = resolve(process.env.AGENTS_COMPUTER_EVIDENCE ?? '.local/computer-cli');
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(output, { recursive: true })]);
const checks: string[] = [], calls: Record<string, unknown>[] = [], requestSummaries: Record<string, unknown>[] = [];
const report: Record<string, unknown> = { checks, calls, requests: requestSummaries, provider: 'loopback scripted Responses', renderer: '26.1013.40934' };
const logs: Record<string, string> = {};
const children: ChildProcess[] = [];
let browser: Browser | undefined, page: Page | undefined, app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let web: WebSocket | undefined, continuation: CodexConnection | undefined;
let stage = 'initial', nextStep = 0, callId = '', pending: Step | undefined, providerFailure: unknown;
let steps: Step[] = [], origin = { x: 0, y: 0 };
let selectionRead: (selection: string, target: string) => Promise<Buffer>;
let selectionWrite: (selection: string, target: string, bytes: Buffer) => Promise<void>;
const clipboardImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X6AAAAABJRU5ErkJggg==', 'base64');
interface Step { label: string; action: () => Promise<DesktopAction> | DesktopAction; verify?: (image: string) => Promise<void> }

async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function until<T>(read: () => Promise<T> | T, matches: (value: T) => boolean, label: string, timeout = 40000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (matches(value)) return value; await delay(50); }
  throw new Error(label + ' timed out');
}
function launch(name: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); logs[name] = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => { logs[name] = (logs[name] + data).slice(-20000); });
  child.on('error', error => { logs[name] += String(error); });
  return child;
}
function imageUrls(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('data:image/png;base64,') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(imageUrls);
  return value && typeof value === 'object' ? Object.values(value).flatMap(imageUrls) : [];
}
function toolNames(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).flatMap(raw => {
    const tool = record(raw);
    if (typeof tool.name !== 'string') return [];
    return tool.type === 'namespace' && Array.isArray(tool.tools)
      ? tool.tools.map(raw => tool.name + '.' + String(record(raw).name)) : [tool.name];
  });
}
function emit(response: ServerResponse, item: Record<string, unknown>, id: string) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const base = { id, object: 'response', created_at: 0, model: 'fixture', output: [] };
  const event = (type: string, data: Record<string, unknown>) => response.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
  event('response.created', { response: { ...base, status: 'in_progress' } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress',
    ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
  if (item.type === 'function_call') {
    event('response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: item.arguments });
    event('response.function_call_arguments.done', { output_index: 0, item_id: item.id, arguments: item.arguments });
  }
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { ...base, status: 'completed', output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } });
  response.end();
}
const desktopHtml = `<!doctype html><meta charset="utf-8"><title>Yard computer fixture</title>
<style>body{margin:0;font:18px sans-serif;overflow:hidden;background:white}#marker{position:absolute;left:0;top:0;width:12px;height:12px;background:rgb(23,244,177)}
button,input{position:absolute;left:24px;font:20px sans-serif}button{top:40px;width:180px;height:48px}input{top:110px;width:500px;height:44px}
#scroll{position:absolute;left:600px;top:40px;width:500px;height:300px;overflow:auto;border:3px solid #333}#long{height:1800px;background:linear-gradient(#eee,#99d)}
#drag{position:absolute;left:24px;top:220px;width:80px;height:60px;background:#36c;color:white}#drop{position:absolute;left:300px;top:220px;width:160px;height:120px;background:#ddd}</style>
<div id="marker"></div><button id="click">Click fixture</button><input id="text" aria-label="Fixture text"><div id="scroll"><div id="long">Scroll fixture</div></div>
<div id="drag" draggable="true">Drag me</div><div id="drop">Drop here</div>
<script>window.fixture={clicks:0,text:'',scrollTop:0,dropped:false};
document.querySelector('#click').onclick=()=>{window.fixture.clicks++;document.querySelector('#click').textContent='Clicks: '+window.fixture.clicks};
document.querySelector('#text').oninput=e=>window.fixture.text=e.target.value;
document.querySelector('#scroll').onscroll=e=>window.fixture.scrollTop=e.target.scrollTop;
document.querySelector('#drag').ondragstart=e=>e.dataTransfer.setData('text/plain','yard-fixture');
document.querySelector('#drop').ondragover=e=>e.preventDefault();
document.querySelector('#drop').ondrop=e=>{e.preventDefault();window.fixture.dropped=e.dataTransfer.getData('text/plain')==='yard-fixture';e.target.textContent='Dropped'};</script>`;

const provider = createServer(async (request, response) => {
  if (request.url === '/desktop') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(desktopHtml); return; }
  if (request.method !== 'POST' || !request.url?.endsWith('/responses')) { response.writeHead(404); response.end(); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  try {
    const value = record(JSON.parse(body)), names = toolNames(value.tools), images = imageUrls(value.input);
    requestSummaries.push({ stage, tools: names.filter(name => name.includes('yard_computer')), imageCount: images.length });
    if (pending) {
      const outputs = (Array.isArray(value.input) ? value.input : []).map(record).filter(item => item.type === 'function_call_output' && item.call_id === callId);
      assert.ok(outputs.length, 'The actual CLI must return the MCP function result to its model');
      assert.ok(!JSON.stringify(outputs).includes('isError":true'), JSON.stringify(outputs));
      assert.ok(images.length, 'A PNG screenshot must reach the model after every computer action');
      await pending.verify?.(images.at(-1)!);
      calls.push({ stage, action: pending.label, modelReceivedPng: true });
      pending = undefined;
    }
    const step = steps[nextStep++];
    if (step) {
      const name = names.find(name => name.includes('yard_computer') && name.endsWith('computer'));
      assert.ok(name, 'The configured standalone MCP tool must appear in the actual model tool catalog');
      pending = step; callId = 'computer-' + requestSummaries.length;
      const action = await step.action();
      emit(response, { id: 'item-' + callId, type: 'function_call', call_id: callId, status: 'completed',
        ...(name.includes('.') ? { namespace: name.slice(0, name.lastIndexOf('.')), name: name.slice(name.lastIndexOf('.') + 1) } : { name }),
        arguments: JSON.stringify(action) }, 'response-' + requestSummaries.length);
    } else {
      emit(response, { id: 'message-' + requestSummaries.length, type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'COMPUTER_STANDALONE_OK', annotations: [] }] }, 'response-' + requestSummaries.length);
    }
  } catch (error) {
    providerFailure = error;
    emit(response, { id: 'failure', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'COMPUTER_FIXTURE_FAILED', annotations: [] }] }, 'failure');
  }
});

async function center(selector: string) {
  const box = await page!.locator(selector).boundingBox(); assert.ok(box);
  return { x: origin.x + Math.round(box.x + box.width / 2), y: origin.y + Math.round(box.y + box.height / 2) };
}
async function contentOrigin(source: string) {
  return page!.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 23 && pixels[i + 1] === 244 && pixels[i + 2] === 177) {
      return { x: (i / 4) % image.width, y: Math.floor(i / 4 / image.width) };
    }
    throw new Error('Synthetic window marker is absent from the actual desktop screenshot');
  }, source);
}
async function fixtureState() {
  return page!.evaluate(() => (window as unknown as { fixture: { clicks: number; text: string; scrollTop: number; dropped: boolean } }).fixture);
}
async function turnComplete(events: RpcMessage[], turnId: string) {
  const event = await until(() => events.find(event => event.method === 'turn/completed' && record(record(event.params).turn).id === turnId), Boolean,
    'CLI computer turn', 90000);
  assert.equal(record(record(event!.params).turn).status, 'completed', JSON.stringify(event));
  if (providerFailure) throw providerFailure;
  assert.equal(nextStep, steps.length + 1);
}

try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  const system = resolve('.local/computer-system/root');
  const library = join(system, 'usr/lib/x86_64-linux-gnu');
  const xvfb = process.env.AGENTS_TEST_XVFB ?? (await exists(join(system, 'usr/bin/Xvfb')) ? join(system, 'usr/bin/Xvfb') : 'Xvfb');
  const systemEnv = { ...process.env, ...(await exists(library) ? { LD_LIBRARY_PATH: library + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') } : {}) };
  const displayProcess = launch('xvfb', xvfb, ['-displayfd', '1', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-ac'], systemEnv);
  await until(() => { if (displayProcess.exitCode !== null) throw new Error(logs.xvfb); return logs.xvfb.match(/^(\d+)\r?$/m)?.[1]; }, Boolean, 'Xvfb startup');
  const display = ':' + logs.xvfb.match(/^(\d+)\r?$/m)![1]; report.display = display;
  const importBinary = process.env.YARD_COMPUTER_IMPORT ?? (await exists(join(system, 'usr/bin/import-im6.q16')) ? join(system, 'usr/bin/import-im6.q16') : 'import');
  const importWrapper = join(root, 'screenshot');
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  const screenshotEnv: Record<string, string> = {
    LD_LIBRARY_PATH: systemEnv.LD_LIBRARY_PATH ?? '',
    MAGICK_CONFIGURE_PATH: process.env.MAGICK_CONFIGURE_PATH ?? join(system, 'etc/ImageMagick-6'),
    MAGICK_CODER_MODULE_PATH: process.env.MAGICK_CODER_MODULE_PATH ?? join(library, 'ImageMagick-6.9.12/modules-Q16/coders'),
  };
  await writeFile(importWrapper, '#!/bin/sh\n' + Object.entries(screenshotEnv).filter(([, value]) => value).map(([key, value]) => `export ${key}=${quote(value)}\n`).join('') +
    'exec ' + quote(importBinary) + ' "$@"\n', { mode: 0o700 });
  process.env.YARD_COMPUTER_DISPLAY = display; process.env.YARD_COMPUTER_IMPORT = importWrapper;
  // Use the runtime's xclip configuration to seed/read a synthetic PNG clipboard.
  const xclip = process.env.AGENTS_TEST_XCLIP ?? (await exists(join(system, 'usr/bin/xclip')) ? join(system, 'usr/bin/xclip') : 'xclip');
  process.env.YARD_COMPUTER_XCLIP = xclip;
  selectionRead = async (selection, target) => (await promisify(execFile)(xclip, ['-selection', selection, '-out', '-target', target],
    { env: { ...process.env, DISPLAY: display }, encoding: 'buffer', timeout: 5000 })).stdout;
  selectionWrite = async (selection, target, bytes) => {
    const owner = spawn(xclip, ['-selection', selection, '-in', '-target', target], { env: { ...process.env, DISPLAY: display }, stdio: ['pipe', 'ignore', 'ignore'] });
    owner.stdin.end(bytes);
    const [code] = await once(owner, 'exit'); assert.equal(code, 0);
  };
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const port = (provider.address() as import('node:net').AddressInfo).port;
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: false, env: { ...process.env, DISPLAY: display }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--ozone-platform=x11'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 } });
  await context.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${port}/`) ? route.continue() : route.abort());
  page = await context.newPage(); await page.goto(`http://127.0.0.1:${port}/desktop`); await page.bringToFront();
  await selectionWrite('clipboard', 'image/png', clipboardImage);
  const assertSelections = async (text: string) => {
    assert.equal((await selectionRead('primary', 'UTF8_STRING')).toString('utf8'), text, 'PRIMARY must keep the new Unicode text');
    assert.ok((await selectionRead('clipboard', 'image/png')).equals(clipboardImage), 'Main CLIPBOARD PNG must remain byte-for-byte intact');
  };
  // Repeated real input catches first-character keymap races that a single CLI
  // example can miss. The model-driven scenarios below use this same driver.
  const probe = new X11Desktop({ display, importCommand: importWrapper, xclipCommand: xclip });
  origin = (await until(async () => {
    const screenshot = (await probe.execute({ type: 'screenshot' })).find(part => part.type === 'image')!;
    assert.equal(screenshot.type, 'image');
    try { return await contentOrigin('data:image/png;base64,' + screenshot.data); }
    catch (error) { if (!String(error).includes('Synthetic window marker is absent')) throw error; return undefined; }
  }, Boolean, 'Initial desktop paint'))!;
  await probe.execute({ type: 'click', ...await center('#text') });
  const probeWords = ['你好', '替换', '蓝藻', '测试', '学术', '种子', '中文', '语言', '智能', '桌面',
    '脚本', '界面', '页面', '点击', '绿色', '继续', '文件', '窗口', '客户', '总计'];
  const unicodeReplacements: string[] = [];
  for (const [index, word] of probeWords.entries()) {
    await probe.execute({ type: 'keypress', keys: ['Ctrl', 'a'] });
    await probe.execute({ type: 'keypress', keys: ['Backspace'] });
    const text = `${word} Yard ${index}`;
    await probe.execute({ type: 'type', text });
    assert.equal((await fixtureState()).text, text);
    await assertSelections(text); unicodeReplacements.push(text);
  }
  report.unicodeReplacements = unicodeReplacements;
  checks.push('Twenty consecutive Unicode replacements with different first characters keep the new PRIMARY text and preserve the main CLIPBOARD PNG');
  const completedAt = Date.now(), delayedPrimaryReads: number[] = [];
  for (const milliseconds of [300, 500]) {
    await delay(Math.max(0, completedAt + milliseconds - Date.now()));
    await assertSelections(unicodeReplacements.at(-1)!); delayedPrimaryReads.push(milliseconds);
  }
  report.delayedPrimaryReads = delayedPrimaryReads;
  checks.push('PRIMARY consumers can read the new Unicode text 300ms and 500ms after the action has returned');
  await probe.execute({ type: 'keypress', keys: ['Ctrl', 'a'] });
  await probe.execute({ type: 'keypress', keys: ['Backspace'] });
  await writeFile(join(codexHome, 'config.toml'), `model="gpt-5.2-codex"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[model_providers.fixture]\nname="Computer fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[features]\ncode_mode=false\n[mcp_servers.yard_computer]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(join(projectRoot, 'plugins/yard-computer/server.ts'))}]\nenabled=false\ndefault_tools_approval_mode="approve"\n`, { mode: 0o600 });
  const cli = launch('cli', process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], { ...process.env, CODEX_HOME: codexHome });
  await until(async () => { if (cli.exitCode !== null) throw new Error(logs.cli); return exists(socketPath); }, Boolean, 'CLI startup');
  app = await createNativeWorkbench({ port: 0, socketPath, codexHome, dataDir, workspace: root,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  const events: RpcMessage[] = [], responses = new Map<number, Record<string, unknown>>();
  web = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
  web.on('message', raw => {
    const message = record(JSON.parse(String(raw)));
    if (message.type === 'mcp-response') responses.set(Number(record(message.message).id), record(message.message));
    if (message.type === 'mcp-notification') events.push({ method: String(message.method), params: message.params, seq: events.length + 1 });
  });
  await once(web, 'open');
  let rpcId = 0;
  async function rpc(method: string, params: Record<string, unknown>) {
    const id = ++rpcId; web!.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', request: { id, method, params } }));
    const reply = await until(() => responses.get(id), Boolean, method);
    assert.equal(reply!.error, undefined, JSON.stringify(reply)); return record(reply!.result);
  }
  stage = 'disabled'; nextStep = 0;
  const disabled = await rpc('thread/start', { cwd: root, historyMode: 'paginated' });
  const disabledId = String(record(disabled.thread).id);
  const disabledTurn = await rpc('turn/start', { threadId: disabledId, input: [{ type: 'text', text: 'Check that disabled desktop tools stay disabled.', text_elements: [] }] });
  await turnComplete(events, String(record(disabledTurn.turn).id));
  assert.deepEqual(requestSummaries.at(-1)!.tools, []);
  checks.push('Saved enabled=false prevents Yard from exposing the computer tool in a new conversation');
  await rpc('config/value/write', { keyPath: 'mcp_servers.yard_computer.enabled', value: true, mergeStrategy: 'upsert' });
  await rpc('config/value/write', { keyPath: 'mcp_servers.yard_computer.disabled_tools', value: ['computer'], mergeStrategy: 'upsert' });
  stage = 'tool disabled'; nextStep = 0;
  const excluded = await rpc('thread/start', { cwd: root, historyMode: 'paginated' });
  const excludedId = String(record(excluded.thread).id);
  const excludedTurn = await rpc('turn/start', { threadId: excludedId, input: [{ type: 'text', text: 'Check saved tool exclusion.', text_elements: [] }] });
  await turnComplete(events, String(record(excludedTurn.turn).id));
  assert.deepEqual(requestSummaries.at(-1)!.tools, []);
  checks.push('Saved disabled_tools policy prevents computer from entering the model catalog');
  await rpc('config/value/write', { keyPath: 'mcp_servers.yard_computer.disabled_tools', value: [], mergeStrategy: 'upsert' });
  const configuration = await app.control.request('config/read', { includeLayers: false });
  assert.equal(record(record(record(configuration.config).mcp_servers).yard_computer).default_tools_approval_mode, 'approve');
  checks.push('Saved default_tools_approval_mode is preserved by the per-thread runtime injection');
  stage = 'initial'; nextStep = 0;
  steps = [
    { label: 'screenshot', action: () => ({ type: 'screenshot' }), verify: async image => {
      origin = await contentOrigin(image);
      report.contentOrigin = origin; await writeFile(join(output, 'initial.png'), Buffer.from(image.split(',')[1], 'base64'));
    } },
    { label: 'click', action: async () => ({ type: 'click', ...await center('#click') }), verify: async () => assert.equal((await fixtureState()).clicks, 1) },
    { label: 'focus text', action: async () => ({ type: 'click', ...await center('#text') }) },
    { label: 'Unicode text', action: () => ({ type: 'type', text: '你好 Yard' }), verify: async () => {
      assert.equal((await fixtureState()).text, '你好 Yard');
      await assertSelections('你好 Yard');
    } },
    { label: 'Ctrl+A', action: () => ({ type: 'keypress', keys: ['Ctrl', 'a'] }), verify: async () => {
      const selection = await page!.locator('#text').evaluate(element => ({ start: (element as HTMLInputElement).selectionStart, end: (element as HTMLInputElement).selectionEnd }));
      assert.deepEqual(selection, { start: 0, end: '你好 Yard'.length });
    } },
    { label: 'delete selected text', action: () => ({ type: 'keypress', keys: ['Backspace'] }), verify: async () => assert.equal((await fixtureState()).text, '') },
    { label: 'first Unicode replacement', action: () => ({ type: 'type', text: '第一轮 Yard 输入' }), verify: async () => {
      assert.equal((await fixtureState()).text, '第一轮 Yard 输入'); await assertSelections('第一轮 Yard 输入');
    } },
    { label: 'select first replacement', action: () => ({ type: 'keypress', keys: ['Ctrl', 'a'] }) },
    { label: 'delete first replacement', action: () => ({ type: 'keypress', keys: ['Backspace'] }), verify: async () => assert.equal((await fixtureState()).text, '') },
    { label: 'second Unicode replacement', action: () => ({ type: 'type', text: '替换后的 Yard 输入' }), verify: async () => {
      assert.equal((await fixtureState()).text, '替换后的 Yard 输入');
      await assertSelections('替换后的 Yard 输入');
    } },
    { label: 'move to scroll area', action: async () => ({ type: 'move', ...await center('#scroll') }) },
    { label: 'scroll', action: () => ({ type: 'scroll', direction: 'down', clicks: 5 }), verify: async () => assert.ok((await fixtureState()).scrollTop > 0) },
    { label: 'drag and drop', action: async () => { const from = await center('#drag'), to = await center('#drop');
      return { type: 'drag', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }; }, verify: async image => {
      assert.equal((await fixtureState()).dropped, true); await writeFile(join(output, 'completed.png'), Buffer.from(image.split(',')[1], 'base64'));
    } },
  ];
  const started = await rpc('thread/start', { cwd: root, historyMode: 'paginated' });
  const threadId = String(record(started.thread).id); report.threadId = threadId;
  const firstTurn = await rpc('turn/start', { threadId, input: [{ type: 'text', text: 'Synthetic standalone computer test.', text_elements: [] }] });
  await turnComplete(events, String(record(firstTurn.turn).id));
  checks.push('Actual CLI receives Yard-injected standalone MCP computer tools and model receives PNG screenshots');
  checks.push('Model tool calls click, type Chinese, select with Ctrl+A, replace text, scroll and drag on the real Xvfb desktop');
  checks.push('Two model-driven Unicode replacements use Ctrl+A → Backspace → type, keep their new PRIMARY text and preserve the main CLIPBOARD PNG');
  web.close(); await once(web, 'close'); web = undefined;
  stage = 'continuation'; nextStep = 0;
  steps = [
    { label: 'screenshot after web closes', action: () => ({ type: 'screenshot' }) },
    { label: 'click after web closes', action: async () => ({ type: 'click', ...await center('#click') }), verify: async () => {
      assert.equal((await fixtureState()).clicks, 2); assert.equal((await fixtureState()).text, '替换后的 Yard 输入');
    } },
  ];
  continuation = new CodexConnection(socketPath);
  const continuedEvents: RpcMessage[] = []; continuation.on('message', event => continuedEvents.push(event));
  await continuation.connect(); await continuation.request('thread/resume', { threadId, excludeTurns: true }, { mutating: true });
  const continued = await continuation.request('turn/start', { threadId, input: [{ type: 'text', text: 'Continue the same computer test with Yard page closed.', text_elements: [] }] }, { mutating: true });
  await turnComplete(continuedEvents, continued.turn.id);
  checks.push('Closing the Yard WebSocket preserves computer tools and desktop state for continuation by a new CLI client');
  report.desktop = await fixtureState(); report.ok = true;
} catch (error) { report.ok = false; report.failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  web?.terminate(); continuation?.close(); await app?.close(); await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    const closed = once(child, 'close'); child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000).unref(); await closed; clearTimeout(kill);
  }
  if (provider.listening) await new Promise<void>(resolve => provider.close(() => resolve()));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  for (const [name, log] of Object.entries(logs)) await writeFile(join(output, name + '.log'), log);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log(JSON.stringify(report));
}
