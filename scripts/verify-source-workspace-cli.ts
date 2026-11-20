// Real CLI, throwaway Codex home, and a loopback Responses provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { Page, RpcMessage, ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';
import { record } from '../src/native/protocol.ts';
import { deepseekModels } from '../src/native/deepseek-models.ts';
import type { SidebarProject } from '../src/native/backend-sidebar-state.ts';
import { composerInput } from '../src/workspace/composer-input.ts';
import { createCliResponsesFixture } from './cli-responses-fixture.ts';
import { appDetails, appResource, appResult, appTools, appUri } from './mcp-app-fixture.ts';

const root = await mkdtemp('/tmp/yard-source-cli-');
const previewOnly = process.argv.includes('--preview');
const queueOnly = process.argv.includes('--queue-only');
const editOnly = process.argv.includes('--edit-only');
const mcpAppOnly = process.argv.includes('--mcp-app-only');
const syncOnly = process.argv.includes('--sync-only');
const mcpPrompt = 'Open the interactive sample from the fixture service.';
const mcpAnswer = 'Interactive sample loaded by the isolated CLI.';
const mcpCallId = 'fixture-inspect-sample';
const originalMessage = 'Review the attached fixture.';
const revisedMessage = 'Check just the exported constant in the attachment.';
const originalReply = 'Original review from the isolated CLI.';
const revisedReply = 'Revised review from the isolated CLI.';
const answer = 'Confirmed reply from the isolated CLI.';
const seedAnswer = 'Persisted history from the isolated CLI.';
const previewPrompt = '对照原版工作区：请展示一段中文回复、一个表格，以及需要在块内横向滚动的代码。';
const previewAnswer = '### 工作区对照样例\n\n这段会话由隔离的 Codex CLI 保存。可以悬停左侧项目，打开项目详情、编辑目录，或从同一项目开始新的会话。\n\n' +
  '| 内容 | 展示方式 |\n| --- | --- |\n| 中文消息 | 在正文宽度内换行 |\n| 长命令 | 在代码块内横向滚动 |\n| 产物 | 从右侧 Outputs 打开 |\n\n' +
  '```ts\nconst example = "' + 'workspace-preview-'.repeat(16) + '";\n```\n\n' + '打开[示例产物](<./yard report.html>)。';
const prompt = 'Check the source workspace round trip.';
const projectPrompt = 'Start a conversation in the isolated project.';
const projectlessPrompt = 'Start an independent conversation.';
const projectAnswer = 'Project conversation confirmed.';
const projectlessAnswer = 'Independent conversation confirmed.';
const projectName = 'Isolated workspace project';
const interruptPrompt = 'Test the stop control on the current turn.';
const interruptPrefix = 'Reply before interruption';
const queuedPrompt = 'Run this exact message from the durable queue.';
const queuedAnswer = 'Confirmed reply to the resumed queued message.';
const reentryPrompt = 'Start from the other CLI connection.';
const reentryPrefix = 'Reply after conversation attachment';
const reentryAnswer = reentryPrefix + ' and navigation.';
const sidechatPrompt = 'Continue this request in a saved side chat.';
const sidechatPrefix = 'Side chat continued';
const sidechatAnswer = sidechatPrefix + ' while the panel was closed.';
const outputPrompt = 'Create a new document with [@Documents](plugin://documents@openai-primary-runtime). Start by asking me what it should be about.';
const outputName = 'yard report.html';
const outputTitle = 'Verified HTML from the isolated workspace';
const outputBody = '<!doctype html><meta charset="utf-8"><h1>' + outputTitle + '</h1>';
const outputAnswer = 'Created the [Yard output fixture](<./' + outputName + '>).';
const fileFolder = 'source-fixture';
const sourceFileName = 'yard-source-fixture.ts';
const sourceFileBody = 'export const verifiedWorkspaceFile = true;\n';
const attachmentPrompt = 'Review the isolated attachments.';
const attachmentAnswer = 'Confirmed a request with file and image attachments.';
const defaultModel = 'gpt-5.2-codex';
const secondModel = 'yard-second-fixture-model';
function responseGate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const existingStream = responseGate();
const projectStream = responseGate();
const interruptStream = responseGate();
const reentryStart = responseGate();
const reentryEnd = responseGate();
const sidechatEnd = responseGate();
const firstAnswer = 'Confirmed reply';
const firstProjectAnswer = 'Project conversation';
const output = resolve(process.env.AGENTS_SOURCE_WORKSPACE_EVIDENCE ?? '.local/workspace-source-cli');
try {
  const codexHome = join(root, 'codex'), dataDir = join(root, 'data'), workspace = join(root, 'workspace');
  await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(workspace), mkdir(output, { recursive: true })]);
  await writeFile(join(workspace, outputName), outputBody);
  await mkdir(join(workspace, fileFolder));
  await writeFile(join(workspace, fileFolder, sourceFileName), sourceFileBody);
  const provider = await createCliResponsesFixture(body => {
    if (mcpAppOnly && body.includes(mcpPrompt)) {
      const request = record(JSON.parse(body));
      if (Array.isArray(request.input) && request.input.map(record).some(item => item.call_id === mcpCallId && item.type === 'function_call_output')) {
        return { text: mcpAnswer };
      }
      for (const tool of (Array.isArray(request.tools) ? request.tools : []).map(record)) {
        const args = JSON.stringify({ sample: 'Sample A' });
        if (typeof tool.name !== 'string') continue;
        if (Array.isArray(tool.tools) && tool.tools.map(record).some(child => child.name === 'inspect_sample')) {
          return { tool: { name: 'inspect_sample', namespace: tool.name, callId: mcpCallId, arguments: args } };
        }
        if (tool.name.endsWith('inspect_sample')) return { tool: { name: tool.name, callId: mcpCallId, arguments: args } };
      }
      return { text: 'The fixture model did not receive the interactive tool.' };
    }
    if (syncOnly) return body.includes('Hold this synchronization turn.')
      ? { text: reentryAnswer, commentary: 'Checking synchronization while the turn stays active.',
        split: { offset: reentryPrefix.length, wait: reentryEnd.promise } }
      : { text: 'Synchronized reply ' + provider.requests };
    if (previewOnly) return { text: provider.requests === 1 ? previewAnswer :
      body.includes('Create a new ') ? 'What should it be about?' : outputAnswer };
    if (editOnly && body.includes(revisedMessage)) return { text: revisedReply };
    if (editOnly && body.includes(originalMessage)) return { text: originalReply };
    if (body.includes(outputPrompt)) return { text: outputAnswer };
    if (body.includes(attachmentPrompt)) return { text: attachmentAnswer };
    if (queueOnly && body.includes(queuedPrompt)) return { text: queuedAnswer };
    if (body.includes(sidechatPrompt)) return { text: sidechatAnswer,
      split: { offset: sidechatPrefix.length, wait: sidechatEnd.promise } };
    if (body.includes(reentryPrompt)) return { text: reentryAnswer, wait: reentryStart.promise,
      split: { offset: reentryPrefix.length, wait: reentryEnd.promise } };
    if (body.includes(interruptPrompt)) return { text: interruptPrefix + ' that must not complete.',
      split: { offset: interruptPrefix.length, wait: interruptStream.promise } };
    if (body.includes(projectPrompt)) return { text: projectAnswer, split: { offset: firstProjectAnswer.length, wait: projectStream.promise } };
    if (body.includes(projectlessPrompt)) return { text: projectlessAnswer };
    if (body.includes(prompt)) return { text: answer, split: { offset: firstAnswer.length, wait: existingStream.promise } };
    return { text: seedAnswer };
  });
  try {
    const catalogPath = join(codexHome, 'models.json');
    await writeFile(catalogPath, JSON.stringify({ models: [
      { ...deepseekModels[0], slug: defaultModel, display_name: 'Yard Fixture Alpha', shell_type: 'unified_exec' },
      { ...deepseekModels[0], slug: secondModel, display_name: 'Yard Fixture Beta', shell_type: 'unified_exec' },
    ] }));
    const mcpServer = join(root, 'mcp-fixture.mjs');
    if (mcpAppOnly) await writeFile(mcpServer, `
import { createInterface } from 'node:readline';
const tools = ${JSON.stringify(appTools)};
const resource = ${JSON.stringify(appResource)};
const result = ${JSON.stringify(appResult)}, details = ${JSON.stringify(appDetails)};
for await (const line of createInterface({input: process.stdin})) {
  const { id, method, params } = JSON.parse(line);
  if (id == null) continue;
  const reply = method === 'initialize' ? { protocolVersion: '2025-11-25',
    capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'Yard card', version: '1.0.0' } }
    : method === 'tools/list' ? { tools }
    : method === 'resources/list' ? { resources: [{uri: resource.uri, name: 'Sample', mimeType: resource.mimeType}] }
    : method === 'resources/templates/list' ? { resourceTemplates: [] }
    : method === 'resources/read' && params?.uri === resource.uri ? { contents: [resource] }
    : method === 'tools/call' && params?.arguments?.sample === 'Sample A' ?
      params.name === 'inspect_sample' ? result : params.name === 'read_sample_details' ? details : undefined : undefined;
  console.log(JSON.stringify({ jsonrpc: '2.0', id, ...(reply ? { result: reply } : { error: { code: -32601, message: 'Unavailable fixture operation' } }) }));
}
`, { mode: 0o600 });
    await writeFile(join(codexHome, 'config.toml'), [
      'model = "' + defaultModel + '"', 'model_reasoning_effort = "high"',
      'model_catalog_json = ' + JSON.stringify(catalogPath), 'model_provider = "fixture"', 'approval_policy = "on-request"',
      'sandbox_mode = "read-only"', '[model_providers.fixture]', 'name = "Source Workspace Fixture"',
      'base_url = "http://127.0.0.1:' + provider.port + '/v1"', 'wire_api = "responses"', 'requires_openai_auth = false',
      ...(mcpAppOnly ? ['[features]', 'enable_mcp_apps = true', '[mcp_servers.fixture]', 'command = ' + JSON.stringify(process.execPath),
        'args = [' + JSON.stringify(mcpServer) + ']', 'default_tools_approval_mode = "approve"'] : []),
    ].join('\n'), { mode: 0o600 });
    const socketPath = join(root, 'backend.sock');
    const daemon = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], {
      env: { PATH: process.env.PATH, CODEX_HOME: codexHome, HOME: root, LANG: 'C.UTF-8' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let log = '', spawnError: Error | undefined;
    daemon.on('error', error => { spawnError = error; });
    daemon.stderr.on('data', chunk => { log += chunk; });
    try {
      for (let ticks = 0; ticks < 100; ticks++) {
        if (spawnError) throw spawnError;
        if (daemon.exitCode !== null || daemon.signalCode !== null) throw new Error(log || 'The fixture CLI exited.');
        try { await access(socketPath); break; } catch {
          if (ticks === 99) throw new Error(log || 'The fixture CLI socket did not appear.');
          await delay(100);
        }
      }
      const app = await createNativeWorkbench({ port: 0, publicOrigin: '', dataDir, codexHome, workspace, socketPath, sourceWorkspace: true,
        hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
      session: try {
        const { project } = await app.control.request<{ project: SidebarProject }>('project/create', {
          name: projectName, roots: [{ path: workspace }], idempotencyKey: 'yard-source-cli-project',
        }, { mutating: true });
        const { thread, sandbox, approvalPolicy } = await app.control.request('thread/start', { cwd: workspace, historyMode: 'paginated' }, { mutating: true });
        assert.equal(sandbox?.type, 'readOnly');
        assert.equal(approvalPolicy, 'on-request');
        async function seedTurn(input: readonly unknown[]) {
          const seeded = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { app.control.off('message', listener); reject(new Error('Seed turn timed out.')); }, 20_000);
            function listener(message: RpcMessage) {
              const params = record(message.params);
              if (message.method !== 'turn/completed' || params.threadId !== thread.id) return;
              clearTimeout(timer);
              app.control.off('message', listener);
              if (record(params.turn).status === 'completed') resolve();
              else reject(new Error(JSON.stringify(params.turn)));
            }
            app.control.on('message', listener);
          });
          const [, { turn }] = await Promise.all([seeded,
            app.control.request<{ turn: TurnSummary }>('turn/start', { threadId: thread.id, input }, { mutating: true })]);
          return turn;
        }
        const initialTurn = await seedTurn(composerInput(previewOnly ? previewPrompt : 'Prepare an existing conversation.'));
        if (previewOnly) {
          console.log('PREVIEW_URL=' + app.url + '/local/' + thread.id);
          const lifetime = new AbortController();
          const close = () => lifetime.abort();
          process.once('SIGTERM', close);
          process.once('SIGINT', close);
          await delay(45 * 60_000, undefined, { signal: lifetime.signal }).catch(() => {});
          process.off('SIGTERM', close);
          process.off('SIGINT', close);
          break session;
        }
        const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
          join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          const errors: string[] = [];
          page.on('pageerror', error => errors.push(error.message));
          if (syncOnly) {
            const url = app.url + '/local/' + thread.id;
            const trace: unknown[] = [];
            page.on('websocket', socket => {
              socket.on('framesent', frame => {
                const value = record(JSON.parse(String(frame.payload))), request = record(value.request);
                if (typeof request.method === 'string' && /thread\/(?:resume|read|turns\/list|items\/list)/.test(request.method))
                  trace.push({ direction: 'sent', at: Date.now(), id: request.id, method: request.method });
              });
              socket.on('framereceived', frame => {
                const value = record(JSON.parse(String(frame.payload))), message = record(value.message);
                if (value.type === 'codex-app-server-connection-changed' || value.type === 'mcp-response')
                  trace.push({ direction: 'received', at: Date.now(), type: value.type, state: value.state,
                    hostId: value.hostId, id: message.id, error: message.error });
              });
            });
            await page.addInitScript(() => {
              const NativeSocket = WebSocket;
              const sockets: WebSocket[] = [];
              const events: unknown[] = [];
              Object.assign(window, { yardSyncSockets: sockets, yardSyncEvents: events });
              window.addEventListener('message', event => {
                if (event.data?.type === 'codex-app-server-connection-changed') events.push({ type: event.data.type,
                  hostId: event.data.hostId, state: event.data.state, own: event.source === window, origin: event.origin,
                  hidden: document.hidden });
              });
              window.WebSocket = class extends NativeSocket {
                constructor(...args: ConstructorParameters<typeof NativeSocket>) { super(...args); sockets.push(this); }
              };
            });
            const peer = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            peer.on('pageerror', error => errors.push(error.message));
            await page.goto(url, { waitUntil: 'commit' });
            await peer.goto(url, { waitUntil: 'commit' });
            await page.getByText('Synchronized reply 1', { exact: true }).waitFor();
            await peer.getByText('Synchronized reply 1', { exact: true }).waitFor();
            const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true });
            const peerEditor = peer.getByRole('textbox', { name: 'Work with Codex', exact: true });
            await editor.fill('Keep this draft across reconnects.');
            async function sendPeer(index: number) {
              await peerEditor.fill('Peer message ' + index);
              await peer.getByRole('button', { name: 'Send message', exact: true }).click();
              await peer.getByText('Synchronized reply ' + (index + 1), { exact: true }).waitFor({ timeout: 15_000 });
            }
            async function disconnect() {
              await page.context().setOffline(true);
              await page.evaluate(() => {
                const { yardSyncSockets } = window as unknown as { yardSyncSockets: WebSocket[] };
                for (const socket of yardSyncSockets) socket.close();
              });
            }
            await sendPeer(1);
            await page.getByText('Synchronized reply 2', { exact: true }).waitFor({ timeout: 12_000 });
            await disconnect();
            for (let index = 2; index <= 5; index++) await sendPeer(index);
            await page.context().setOffline(false);
            await page.getByText('Synchronized reply 6', { exact: true }).waitFor({ timeout: 15_000 }).catch(async error => {
              await writeFile(join(output, 'reconnect-error.aria.txt'), await page.locator('body').ariaSnapshot());
              await writeFile(join(output, 'reconnect-error.trace.json'), JSON.stringify(trace, null, 2) + '\n');
              await writeFile(join(output, 'reconnect-error.window.json'), JSON.stringify(await page.evaluate(() => ({
                events: (window as unknown as { yardSyncEvents: unknown[] }).yardSyncEvents, hidden: document.hidden,
              })), null, 2) + '\n');
              await writeFile(join(output, 'reconnect-error.errors.json'), JSON.stringify(errors));
              throw error;
            });
            for (let index = 1; index <= 5; index++) {
              await page.getByText('Peer message ' + index, { exact: true }).waitFor();
              assert.equal(await page.getByText('Synchronized reply ' + (index + 1), { exact: true }).count(), 1);
            }
            assert.equal(await editor.textContent(), 'Keep this draft across reconnects.');
            await app.control.request('turn/start', { threadId: thread.id,
              input: composerInput('Hold this synchronization turn.') }, { mutating: true });
            await page.getByText(reentryPrefix, { exact: true }).waitFor({ timeout: 12_000 });
            await page.getByRole('button', { name: /^Working for / }).waitFor({ timeout: 5_000 });
            const active = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
              threadId: thread.id, sortDirection: 'desc', itemsView: 'summary', limit: 1,
            });
            const startedAt = active.data[0]?.startedAt;
            assert.equal(typeof startedAt, 'number');
            await page.waitForFunction(() => [...document.querySelectorAll('.yard-source-turn-activity-toggle')]
              .some(node => /Working for (?:[2-9]|\d{2,})/.test(node.textContent ?? '')));
            await page.reload({ waitUntil: 'commit' });
            await page.getByText('Checking synchronization while the turn stays active.', { exact: true }).waitFor();
            await page.getByRole('button', { name: /^Working for / }).waitFor({ timeout: 5_000 });
            const recoveredElapsed = await page.getByRole('button', { name: /^Working for / }).innerText();
            const elapsedSeconds = Number(/Working for (\d+)/.exec(recoveredElapsed)?.[1]);
            assert.ok(Number.isFinite(elapsedSeconds) && Math.abs(elapsedSeconds - (Date.now() / 1000 - startedAt!)) < 2,
              'reopened elapsed time must follow the saved turn start, including time before navigation');
            await page.waitForFunction(previous => [...document.querySelectorAll('.yard-source-turn-activity-toggle')]
              .some(node => node.textContent?.startsWith('Working for ') && node.textContent.trim() !== previous.trim()), recoveredElapsed);
            await page.screenshot({ path: join(output, 'sync-live.png'), animations: 'disabled', caret: 'hide' });
            await disconnect();
            reentryEnd.release();
            await peer.getByText(reentryAnswer, { exact: true }).waitFor({ timeout: 12_000 });
            await page.context().setOffline(false);
            await page.getByText(reentryAnswer, { exact: true }).waitFor({ timeout: 15_000 });
            assert.equal(await page.getByText(reentryAnswer, { exact: true }).count(), 1);
            await page.getByRole('button', { name: /^Working/ }).waitFor({ state: 'hidden' });
            await page.reload({ waitUntil: 'commit' });
            await page.getByText(reentryAnswer, { exact: true }).waitFor({ timeout: 12_000 });
            assert.equal(await editor.textContent(), 'Keep this draft across reconnects.');
            await page.screenshot({ path: join(output, 'sync-recovered.png'), animations: 'disabled', caret: 'hide' });
            assert.deepEqual(errors, []);
            const report = { cli: app.control.server?.userAgent, twoIndependentPages: true,
              recoveredMoreThanOneHistoryPage: true, recoveredCompletionWhileOffline: true,
              liveElapsedTime: true, restoredActiveProgressOnReload: true, draftRetained: true, noDuplicateReplies: true, errors };
            await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
            console.log(JSON.stringify(report));
            break session;
          }
          if (mcpAppOnly) {
            await page.goto(app.url + '/local/' + thread.id, { waitUntil: 'commit' });
            await page.getByText(seedAnswer, { exact: true }).waitFor();
            const editor = page.locator('[data-codex-composer="true"][contenteditable="true"]');
            await editor.fill(mcpPrompt);
            await page.getByRole('button', { name: 'Send message', exact: true }).click();
            await page.getByText(mcpAnswer, { exact: true }).waitFor({ timeout: 15_000 });
            const card = page.getByRole('region', { name: 'Fixture app', exact: true });
            const frame = card.frameLocator('iframe');
            await frame.getByText('Sample A', { exact: true }).waitFor();
            const draft = 'Keep the parent draft during tool work.';
            await editor.fill(draft);
            await card.getByRole('button', { name: 'Open app in tab', exact: true }).click();
            const tab = page.getByRole('tabpanel', { name: 'Fixture', exact: true });
            const tabFrame = tab.frameLocator('iframe');
            await tabFrame.locator('body[data-display-mode="fullscreen"]').waitFor();
            await tabFrame.getByRole('button', { name: 'Read sample details', exact: true }).click();
            await tabFrame.getByText('Sample details loaded', { exact: true }).waitFor();
            await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
            await tabFrame.getByText('Sample details loaded', { exact: true }).waitFor();
            await page.screenshot({ path: join(output, 'interactive-app-tab.png'), animations: 'disabled', caret: 'hide' });
            await page.getByRole('button', { name: 'Close Fixture tab', exact: true }).click();
            await frame.getByText('Sample details loaded', { exact: true }).waitFor();
            await frame.locator('body[data-display-mode="inline"]').waitFor();
            assert.equal(await editor.textContent(), draft);
            const { data } = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
              threadId: thread.id, limit: 1, sortDirection: 'desc', itemsView: 'full',
            });
            const item = data[0]?.items.find(item => item.type === 'mcpToolCall' && item.tool === 'inspect_sample');
            assert.ok(item && item.status === 'completed');
            assert.equal(record(item.mcpAppUi).resourceUri ?? item.mcpAppResourceUri, appUri);
            await page.screenshot({ path: join(output, 'interactive-app.png'), animations: 'disabled', caret: 'hide' });
            assert.deepEqual(errors, []);
            const report = { cli: app.control.server?.userAgent, widgetFromModelTool: true, realMcpResourceRead: true,
              realMcpButtonReply: true, appStateKeptWhenClosingTab: true, parentDraftKept: true, savedUiResource: appUri,
              errors, approvalPolicy, sandbox: sandbox?.type };
            await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
            console.log(JSON.stringify(report));
            break session;
          }
          if (editOnly) {
            const file = { name: sourceFileName, path: join(workspace, fileFolder, sourceFileName), image: false };
            const previous = await seedTurn(composerInput(originalMessage, [file]));
            await page.goto(app.url + '/local/' + thread.id, { waitUntil: 'commit' });
            await page.getByText(originalReply, { exact: true }).waitFor();
            const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true });
            const unsent = 'Keep this other message as a draft.';
            await editor.fill(unsent);
            await page.getByText(originalMessage, { exact: true }).hover();
            await page.getByRole('button', { name: 'Edit message', exact: true }).click();
            const inline = page.getByRole('textbox', { name: 'Edit message', exact: true });
            assert.equal(await inline.textContent(), originalMessage);
            await inline.press('Control+a');
            await page.keyboard.insertText(revisedMessage);
            await page.getByRole('button', { name: 'Send', exact: true }).click();
            await page.locator('[data-turn-status="completed"]').getByText(revisedReply, { exact: true }).waitFor();
            await page.getByText(originalReply, { exact: true }).waitFor({ state: 'hidden' });
            const { data } = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
              threadId: thread.id, sortDirection: 'desc', itemsView: 'summary', limit: 3,
            });
            assert.equal(data.length, 2);
            assert.equal(data[1].id, initialTurn.id);
            assert.notEqual(data[0].id, previous.id);
            const updated = data[0].items.find(item => item.type === 'userMessage');
            assert.ok(updated && Array.isArray(updated.content));
            assert.deepEqual(updated.content, composerInput(revisedMessage, [file]));
            await page.reload({ waitUntil: 'commit' });
            await page.getByText(revisedReply, { exact: true }).waitFor();
            assert.equal(await editor.textContent(), unsent);
            assert.equal(await readFile(file.path, 'utf8'), sourceFileBody);
            assert.deepEqual(errors, []);
            const report = { cli: app.control.server?.userAgent, retainedEarlierTurn: true, replacedSameThread: true,
              attachmentRetained: true, workspaceFileUnchanged: true, separateDraftRetained: true, errors };
            await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
            console.log(JSON.stringify(report));
            break session;
          }
          const failedRequests: unknown[] = [];
          const submitted: Record<string, unknown>[] = [];
          const settingsWrites: Record<string, unknown>[] = [];
          const configWrites: unknown[] = [];
          const catalogRequests: string[] = [];
          let providerRequests = 0;
          const interrupted: Record<string, unknown>[] = [];
          const scopedLists: Record<string, unknown>[] = [];
          const forks: Record<string, unknown>[] = [];
          const outputRequests: { pathname: string; method: string; filePath: string | null }[] = [];
          const terminalCalls: Record<string, unknown>[] = [];
          const terminalOutput: string[] = [];
          const directoryCalls: Record<string, unknown>[] = [];
          const fileSearchCalls: Record<string, unknown>[] = [];
          page.on('request', request => {
            const url = new URL(request.url());
            if (url.pathname.startsWith('/source-chunks/') || url.pathname.startsWith('/api/files/')) {
              outputRequests.push({ pathname: url.pathname, method: request.method(), filePath: url.searchParams.get('path') });
            }
          });
          const reattached = responseGate();
          let pendingResume: unknown;
          let verifyResume = false;
          page.on('websocket', socket => {
            socket.on('framereceived', frame => {
              const event = record(JSON.parse(String(frame.payload)));
              if (event.type === 'terminal-event' && record(event.event).type === 'data') terminalOutput.push(String(record(event.event).data));
              if (event.type === 'mcp-response' && record(event.message).error) failedRequests.push(event.message);
              if (pendingResume && event.type === 'mcp-response' && record(event.message).id === pendingResume &&
                  !record(event.message).error) reattached.release();
            });
            socket.on('framesent', frame => {
              const event = record(JSON.parse(String(frame.payload)));
              if (event.type === 'fetch' && String(event.url).endsWith('/terminal')) terminalCalls.push(record(JSON.parse(String(event.body))));
              if (event.type === 'fetch' && String(event.url).endsWith('/model-providers')) providerRequests++;
              if (event.type === 'fetch' && String(event.url).endsWith('/workspace-directory-entries')) directoryCalls.push(record(JSON.parse(String(event.body))));
              const request = record(event.request);
              if (request.method === 'fuzzyFileSearch') fileSearchCalls.push(record(request.params));
              if (request.method === 'turn/start') submitted.push(record(request.params));
              if (request.method === 'thread/settings/update') settingsWrites.push(record(request.params));
              if (request.method === 'config/batchWrite') configWrites.push(request.params);
              if (request.method === 'model/list') catalogRequests.push(request.method);
              if (request.method === 'turn/interrupt') interrupted.push(record(request.params));
              if (request.method === 'thread/list' && record(request.params).attachedToThreadId) scopedLists.push(record(request.params));
              if (request.method === 'thread/fork') forks.push(record(request.params));
              if (verifyResume && request.method === 'thread/resume' && record(request.params).threadId === thread.id) pendingResume = request.id;
            });
          });
          const main = page.getByRole('main');
          const editorSelector = '[data-codex-composer="true"][contenteditable="true"]';
          const editor = main.locator(editorSelector);
          const send = main.getByRole('button', { name: 'Send message' });
          if (queueOnly) {
            await page.goto(app.url + '/local/' + thread.id, { waitUntil: 'commit' });
            await main.getByText(seedAnswer, { exact: true }).waitFor();
            await editor.fill(interruptPrompt);
            await send.click();
            await main.locator('[data-turn-status="inProgress"]').getByText(interruptPrefix, { exact: true }).waitFor();
            const scope = main.getByRole('region', { name: 'Queued messages', exact: true });
            await app.control.request('thread/queue/add', { threadId: thread.id, clientUserMessageId: 'external-queue-test',
              input: [{ type: 'text', text: 'Pending message from another client', text_elements: [] }],
            }, { mutating: true });
            await scope.getByRole('button', { name: 'Queued message actions', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Turn on queueing', exact: true }).click();
            await scope.getByRole('button', { name: 'Delete queued message', exact: true }).click();
            await editor.fill(queuedPrompt);
            await main.getByRole('button', { name: 'Queue', exact: true }).click();
            await scope.getByText(queuedPrompt, { exact: true }).waitFor();
            const queued = await app.control.request<Page<{ id: string; input: unknown[] }>>('thread/queue/list', { threadId: thread.id });
            assert.deepEqual(queued.data.map(item => item.input), [[{ type: 'text', text: queuedPrompt, text_elements: [] }]]);
            const queueId = queued.data[0]!.id;
            assert.equal(submitted.length, 1, 'Adding a queued message does not start or interrupt the active turn.');
            await page.reload({ waitUntil: 'commit' });
            await scope.getByText(queuedPrompt, { exact: true }).waitFor();
            await main.getByRole('button', { name: 'Stop generating', exact: true }).click();
            await scope.getByText('Queue paused because you interrupted', { exact: true }).waitFor();
            assert.equal(interrupted.length, 1);
            assert.equal((await app.control.request<Page<{ id: string }>>('thread/queue/list', { threadId: thread.id })).data[0]?.id, queueId);
            interruptStream.release();
            await editor.fill('Keep this separate draft while resuming.');
            await scope.getByRole('button', { name: 'Resume', exact: true }).click();
            await main.locator('[data-turn-status="completed"]').getByText(queuedAnswer, { exact: true }).waitFor();
            assert.equal((await app.control.request<Page<unknown>>('thread/queue/list', { threadId: thread.id })).data.length, 0);
            assert.equal(await editor.textContent(), 'Keep this separate draft while resuming.');
            assert.deepEqual(errors, []);
            const report = { cli: app.control.server?.userAgent, queuedAfterRefresh: true,
              externalQueueNotification: true, pausedAfterStop: true, resumedSameSubmission: true, retainedSeparateDraft: true,
              result: 'Verified a real app-server queue, interruption, and resume with a browser client.', errors };
            await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
            console.log(JSON.stringify(report));
            break session;
          }
          async function seeStreaming(prefix: string, full: string, release: () => void) {
            const active = page.locator('[data-turn-status="inProgress"]').getByText(prefix, { exact: true });
            await active.waitFor({ timeout: 12_000 });
            assert.equal(await page.getByText(full, { exact: true }).count(), 0);
            release();
            const done = page.locator('[data-turn-status="completed"]').getByText(full, { exact: true });
            await done.waitFor({ timeout: 12_000 });
            assert.equal(await page.getByText(full, { exact: true }).count(), 1);
          }
          async function verifyNewConversation(text: string, expectedReply: string, projectId?: string) {
            await editor.fill(text);
            if (projectId) {
              await main.getByRole('button', { name: 'Change permissions', exact: true }).click();
              await page.getByRole('menuitem', { name: /Ask for approval/ }).click();
              assert.equal(await editor.textContent(), text);
            }
            await send.click({ timeout: 10_000 });
            if (projectId) await seeStreaming(firstProjectAnswer, expectedReply, projectStream.release);
            else await page.getByText(expectedReply, { exact: true }).waitFor({ timeout: 20_000 });
            const route = new URL(page.url()).searchParams.get('initialRoute');
            assert.ok(route?.startsWith('/local/'));
            const threadId = route!.slice('/local/'.length);
            assert.notEqual(threadId, thread.id);
            const { thread: started } = await app.control.request('thread/read', { threadId, includeTurns: false });
            assert.equal(started.projectId ?? null, projectId ?? null);
            if (projectId) assert.equal(started.cwd, workspace);
            else assert.ok(started.cwd.startsWith(join(dataDir, 'workspaces') + '/chat-'), started.cwd);
            const { sandbox, approvalPolicy, activePermissionProfile } = await app.control.request('thread/resume', { threadId, excludeTurns: true }, { mutating: true });
            assert.equal(sandbox?.type, 'readOnly');
            assert.equal(approvalPolicy, 'on-request');
            if (projectId) assert.equal(activePermissionProfile?.id, ':read-only');
            assert.equal(await editor.textContent(), '');
            return threadId;
          }
          try {
            await page.goto(app.url + '/local/' + thread.id, { waitUntil: 'commit' });
            await page.getByText(seedAnswer, { exact: true }).waitFor({ timeout: 10000 });
            const projectRow = page.locator('[data-app-action-sidebar-project-row][data-app-action-sidebar-project-id="' + project.id + '"]');
            await projectRow.getByRole('button', { name: projectName, exact: true }).hover();
            const projectCard = page.getByRole('region', { name: projectName, exact: true });
            await projectCard.getByText('1 chat', { exact: true }).waitFor();
            await projectCard.getByRole('button', { name: 'Pin project', exact: true }).click();
            await projectCard.getByRole('button', { name: 'Unpin project', exact: true }).waitFor();
            const persistedProject = () => app.control.request<{ project: SidebarProject }>('project/read', { projectId: project.id });
            assert.equal((await persistedProject()).project.metadata['yard.projectPinned'], 'true');
            await projectCard.getByRole('button', { name: 'Unpin project', exact: true }).click();
            await projectCard.getByRole('button', { name: 'Pin project', exact: true }).waitFor();
            await projectCard.getByRole('button', { name: 'Edit project', exact: true }).click();
            const projectSettings = page.getByRole('dialog', { name: 'Edit project', exact: true });
            await projectSettings.getByRole('button', { name: 'Change marker for ' + projectName, exact: true }).click();
            const markers = page.getByRole('dialog', { name: 'Project marker', exact: true });
            await markers.getByRole('button', { name: 'Use Purple', exact: true }).click();
            await markers.getByRole('button', { name: 'Pencil', exact: true }).click();
            await projectRow.locator('.yard-project-marker[data-marker-color="purple"]').waitFor();
            await page.waitForFunction(() => document.querySelector('[role="gridcell"] button[aria-label="Pencil"][aria-pressed="true"]'));
            for (let attempt = 0; ; attempt++) {
              const appearance = JSON.parse((await persistedProject()).project.metadata['yard.projectAppearance'] ?? 'null');
              if (appearance?.marker?.icon === 'edit') { assert.equal(appearance.color, 'purple'); break; }
              assert.ok(attempt < 30, 'The marker must persist in the CLI project metadata.');
              await delay(100);
            }
            await page.keyboard.press('Escape');
            await markers.waitFor({ state: 'hidden' });
            await projectSettings.getByRole('button', { name: 'Add folder', exact: true }).click();
            const folderPicker = page.getByRole('dialog', { name: 'Add folder', exact: true });
            await folderPicker.getByRole('button', { name: fileFolder, exact: true }).click();
            await folderPicker.getByRole('button', { name: 'Add folder', exact: true }).click();
            await projectSettings.getByRole('button', { name: 'Save', exact: true }).click();
            await projectSettings.waitFor({ state: 'hidden' });
            assert.deepEqual((await persistedProject()).project.roots.map(root => root.path), [workspace, join(workspace, fileFolder)]);
            assert.equal(provider.requests, 1);
            assert.equal(new URL(page.url()).pathname, '/local/' + thread.id);
            const terminalAssets = () => outputRequests.filter(row => row.pathname.startsWith('/source-chunks/terminal-runtime-'));
            assert.deepEqual(terminalAssets(), []);
            assert.equal(terminalCalls.length, 0);
            const terminal = main.getByRole('region', { name: 'Terminal', exact: true });
            await page.getByRole('button', { name: 'Toggle terminal', exact: true }).click();
            const keyboard = terminal.locator('.xterm-helper-textarea');
            await keyboard.waitFor({ state: 'attached' });
            await keyboard.evaluate(element => {
              const hasFocus = () => document.activeElement === element;
              if (!hasFocus()) return new Promise<void>(resolve => element.addEventListener('focus', () => resolve(), { once: true }));
            });
            await page.keyboard.insertText('printf "YARD_TERMINAL_READY:%s\\n" "$PWD"');
            await page.keyboard.press('Enter');
            const terminalResult = 'YARD_TERMINAL_READY:' + workspace;
            await terminal.locator('.xterm-rows').getByText(terminalResult, { exact: true }).waitFor();
            assert.ok(terminalOutput.join('').includes(terminalResult));
            assert.deepEqual(terminalAssets().map(({ pathname }) => pathname.split('.').at(-1)).sort(), ['css', 'js']);
            await page.getByRole('button', { name: 'New chat', exact: true }).click();
            await terminal.waitFor({ state: 'hidden' });
            await page.locator('#app-shell-sidebar [data-app-action-sidebar-thread-id="local:' + thread.id + '"]').first().click();
            await terminal.locator('.xterm-rows').getByText(terminalResult, { exact: true }).waitFor();
            assert.equal(terminalCalls.filter(call => call.operation === 'create').length, 1);
            await terminal.getByRole('button', { name: 'Close terminal', exact: true }).click();
            await terminal.waitFor({ state: 'detached' });
            assert.equal(terminalCalls.filter(call => call.operation === 'close').length, 1);
            await page.getByRole('button', { name: 'New chat', exact: true }).click();
            const homeTerminalDraft = 'Keep this draft when opening the home side panel.';
            await editor.fill(homeTerminalDraft);
            const homePanel = page.getByRole('button', { name: 'Toggle side panel', exact: true });
            await homePanel.click();
            const tab = page.getByRole('tabpanel', { name: 'Terminal 1', exact: true });
            await tab.locator('.xterm-helper-textarea:focus').waitFor({ state: 'attached' });
            await page.keyboard.insertText('printf "YARD_SIDE_TERMINAL:%s\\n" "$PWD"');
            await page.keyboard.press('Enter');
            const sideResult = tab.locator('.xterm-rows').getByText('YARD_SIDE_TERMINAL:' + workspace, { exact: true });
            await sideResult.waitFor();
            await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
            await tab.waitFor({ state: 'hidden' });
            assert.equal(await editor.textContent(), homeTerminalDraft);
            await homePanel.click();
            await sideResult.waitFor();
            assert.equal(terminalCalls.filter(call => call.operation === 'create').length, 2);
            await page.getByRole('button', { name: 'Close Terminal 1 tab', exact: true }).click();
            await tab.waitFor({ state: 'detached' });
            assert.equal(terminalCalls.filter(call => call.operation === 'close').length, 2);
            assert.equal(await editor.textContent(), homeTerminalDraft);
            await editor.fill('');
            await page.locator('#app-shell-sidebar [data-app-action-sidebar-thread-id="local:' + thread.id + '"]').first().click();
            await page.getByText(seedAnswer, { exact: true }).waitFor();
            const permission = main.getByRole('button', { name: 'Change permissions', exact: true });
            const editable = 'Preserve this draft while changing settings.';
            await editor.fill(editable);
            await permission.click();
            await page.getByRole('menuitem', { name: /Ask for approval/ }).click();
            await send.waitFor();
            await page.waitForFunction(() => document.querySelector('main button[aria-label="Send message"]:enabled') != null);
            assert.equal(settingsWrites.at(-1)?.threadId, thread.id);
            const current = await app.control.request('thread/resume', { threadId: thread.id, excludeTurns: true }, { mutating: true });
            assert.equal(current.sandbox?.type, 'readOnly');
            assert.equal(current.activePermissionProfile?.id, ':read-only');
            assert.equal(current.approvalPolicy, 'on-request');
            const defaultOption = main.getByRole('button', { name: /Yard Fixture Alpha High/ });
            await defaultOption.waitFor();
            assert.deepEqual(catalogRequests, ['model/list']);
            assert.equal(providerRequests, 0);
            await defaultOption.click();
            await page.getByRole('slider', { name: 'Power', exact: true }).press('ArrowLeft');
            await main.getByRole('button', { name: /Yard Fixture Alpha Low/ }).waitFor();
            await main.getByRole('button', { name: /Yard Fixture Alpha Low/ }).click();
            await page.getByRole('menuitem', { name: 'Select model', exact: true }).click();
            await page.getByRole('menuitemradio', { name: 'Yard Fixture Beta', exact: true }).click();
            await main.getByRole('button', { name: /Yard Fixture Beta Low/ }).waitFor();
            const switched = await app.control.request('thread/resume', { threadId: thread.id, excludeTurns: true }, { mutating: true });
            assert.equal(switched.model, secondModel);
            assert.equal(switched.activePermissionProfile?.id, ':read-only');
            assert.equal(switched.reasoningEffort, 'low');
            assert.equal(submitted.length, 0);
            assert.equal(await editor.textContent(), editable);
            await editor.fill(prompt);
            await editor.press('Enter');
            await seeStreaming(firstAnswer, answer, existingStream.release);
            assert.equal(provider.requests, 2);
            await page.getByRole('button', { name: 'New chat', exact: true }).click();
            await page.locator('[data-composer-navigation-target="workspace-project"]').click();
            const menu = page.locator('[popover]:popover-open');
            await menu.getByRole('button', { name: projectName, exact: true }).click();
            await page.reload({ waitUntil: 'commit' });
            await page.getByRole('button', { name: 'Change project: ' + projectName, exact: true }).waitFor();
            await verifyNewConversation(projectPrompt, projectAnswer, project.id);
            await page.getByRole('button', { name: 'New chat', exact: true }).click();
            assert.equal(await editor.textContent(), '');
            await page.locator('[data-composer-navigation-target="workspace-project"]').click();
            await menu.getByRole('button', { name: 'No project', exact: true }).click();
            const projectlessId = await verifyNewConversation(projectlessPrompt, projectlessAnswer);
            await editor.fill(interruptPrompt);
            await editor.press('Shift+Enter');
            await page.keyboard.insertText('Second line');
            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
            await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
            await page.keyboard.insertText('\u4e2d\u6587');
            await cdp.detach();
            await editor.press('Enter');
            await page.locator('[data-turn-status="inProgress"]').getByText(interruptPrefix, { exact: true }).waitFor({ timeout: 12_000 });
            assert.equal(submitted.length, 4);
            assert.deepEqual(submitted.at(-1)?.input, [{ type: 'text', text: interruptPrompt + '\nSecond line\u4e2d\u6587', text_elements: [] }]);
            await editor.fill('Retain this next draft while stopping.');
            await main.getByRole('button', { name: 'Steer', exact: true }).waitFor();
            assert.equal(await editor.textContent(), 'Retain this next draft while stopping.');
            await editor.fill('');
            await page.getByRole('button', { name: 'Stop generating' }).click();
            await page.locator('[data-turn-status="interrupted"]').waitFor({ timeout: 12_000 });
            assert.equal(interrupted.length, 1);
            assert.equal(interrupted[0]?.threadId, submitted.at(-1)?.threadId);
            assert.equal(typeof interrupted[0]?.turnId, 'string');
            await editor.fill('Retain this next draft while stopping.');
            interruptStream.release();
            const external = await app.control.request('turn/start', { threadId: thread.id,
              input: [{ type: 'text', text: reentryPrompt, text_elements: [] }] }, { mutating: true });
            const select = (id: string) => page.locator('[data-app-action-sidebar-thread-id="local:' + id + '"]').first().click();
            verifyResume = true;
            await select(thread.id);
            await Promise.race([reattached.promise, delay(12_000, undefined, { ref: false }).then(() => {
              throw new Error('The renderer did not attach to the running CLI thread.');
            })]);
            reentryStart.release();
            await page.locator('[data-turn-status="inProgress"]').getByText(reentryPrefix, { exact: true }).waitFor({ timeout: 12_000 });
            await select(projectlessId);
            await page.getByText(projectlessAnswer, { exact: true }).waitFor({ timeout: 12_000 });
            assert.equal(await page.getByText(reentryPrefix, { exact: true }).count(), 0);
            reentryEnd.release();
            for (let attempts = 0; attempts < 40; attempts++) {
              const latest = await app.control.request<Page<TurnSummary>>('thread/turns/list', { threadId: thread.id,
                sortDirection: 'desc', itemsView: 'summary', limit: 1 });
              if (latest.data[0]?.id === external.turn.id && latest.data[0]?.status === 'completed') break;
              assert.ok(attempts < 39, 'The external turn must persist.');
              await delay(250);
            }
            assert.equal(await page.getByText(reentryAnswer, { exact: true }).count(), 0);
            assert.equal(await editor.textContent(), 'Retain this next draft while stopping.');
            await select(thread.id);
            await page.locator('[data-turn-status="completed"]').getByText(reentryAnswer, { exact: true }).waitFor({ timeout: 12_000 });

            // In the narrow layout, Summary is a popover. Reload with it closed
            // to verify a genuinely fresh store performs no child list query.
            await page.setViewportSize({ width: 390, height: 844 });
            const listsBefore = scopedLists.length;
            await page.reload({ waitUntil: 'commit' });
            await main.getByText(reentryAnswer, { exact: true }).waitFor({ timeout: 12_000 });
            const summary = page.getByRole('button', { name: 'Summary', exact: true });
            assert.equal(await summary.getAttribute('aria-expanded'), 'false');
            assert.equal(scopedLists.length, listsBefore);
            await summary.click();
            const panel = page.getByRole('complementary', { name: 'Conversation summary' });
            await panel.getByRole('button', { name: 'Outputs', exact: true }).waitFor();
            for (let tick = 0; scopedLists.length === listsBefore && tick < 100; tick++) await delay(50);
            assert.equal(scopedLists.length, listsBefore + 1);
            assert.equal(scopedLists.at(-1)?.attachedToThreadId, thread.id);
            await editor.fill('Keep this prior draft.');
            await panel.getByRole('button', { name: 'Create a file or site', exact: true }).first().click();
            const creationMenu = page.getByRole('menu', { name: 'Create a file or site' });
            await creationMenu.getByRole('menuitem', { name: 'Create document' }).waitFor();
            await page.keyboard.press('Escape');
            await creationMenu.waitFor({ state: 'hidden' });
            assert.equal(await summary.getAttribute('aria-expanded'), 'true');
            await panel.getByRole('button', { name: 'Create a file or site', exact: true }).last().press('Enter');
            await creationMenu.locator('[role="menuitem"]:focus').waitFor();
            await page.keyboard.press('ArrowDown');
            assert.equal(await creationMenu.getByRole('menuitem', { name: 'Create presentation' })
              .evaluate(item => item === document.activeElement), true);
            const draftSendCount = submitted.length;
            await page.keyboard.press('Enter');
            const mention = editor.locator('[plugin-mention-path="plugin://presentations@openai-primary-runtime"]');
            await mention.waitFor();
            assert.equal(await editor.textContent(), 'Keep this prior draft. Create a new presentation with Presentations. Start by asking me what it should be about.');
            assert.equal(submitted.length, draftSendCount);
            await editor.press('Control+z');
            assert.equal(await editor.textContent(), 'Keep this prior draft.');
            await editor.press('Control+Shift+z');
            await mention.waitFor();
            await page.reload({ waitUntil: 'commit' });
            await mention.waitFor({ timeout: 12_000 });
            await summary.click();
            await page.keyboard.press('Escape');
            assert.equal(await summary.getAttribute('aria-expanded'), 'false');
            assert.equal(await summary.evaluate(button => button === document.activeElement), true);
            await editor.fill('Keep the parent draft.');
            const terminalCount = (operation: string) => terminalCalls.filter(call => call.operation === operation).length;
            const beforeRightCreate = terminalCount('create'), beforeRightClose = terminalCount('close');
            await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
            const newTab = page.getByRole('complementary', { name: 'New tab', exact: true });
            await newTab.getByRole('button', { name: 'Side chat', exact: true }).waitFor();
            assert.equal(directoryCalls.length, 0, 'Directory I/O waits until the Files card is selected.');
            assert.equal(fileSearchCalls.length, 0, 'Opening tools does not search the filesystem.');
            assert.equal(terminalCount('create'), beforeRightCreate, 'Opening tools does not start a terminal.');
            await newTab.getByRole('button', { name: '更多工具', exact: true }).press('Enter');
            const openBottom = page.getByRole('menuitem', { name: '在底部面板打开终端', exact: true });
            await openBottom.waitFor();
            await page.waitForFunction(() => document.activeElement?.textContent === '在底部面板打开终端');
            await page.keyboard.press('Escape');
            await openBottom.waitFor({ state: 'hidden' });
            await newTab.getByRole('button', { name: 'Terminal', exact: true }).click();
            const rightTerminal = page.getByRole('complementary', { name: 'Terminal', exact: true });
            const terminalTab = rightTerminal.getByRole('tabpanel', { name: 'Terminal 1', exact: true });
            await terminalTab.locator('.xterm-helper-textarea:focus').waitFor({ state: 'attached' });
            await page.keyboard.insertText('printf "YARD_RIGHT_TERMINAL:%s\\n" "$PWD"');
            await page.keyboard.press('Enter');
            const terminalLine = terminalTab.locator('.xterm-rows').getByText(/^YARD_RIGHT_TERMINAL:/);
            await terminalLine.waitFor();
            assert.ok(terminalOutput.join('').includes('YARD_RIGHT_TERMINAL:' + workspace));
            await page.getByRole('button', { name: 'Close right sidebar', exact: true }).click();
            await terminalTab.waitFor({ state: 'hidden' });
            assert.equal(terminalCount('close'), beforeRightClose, 'Hiding the side panel keeps the PTY.');
            await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
            await terminalLine.waitFor();
            assert.equal(terminalCount('create'), beforeRightCreate + 1);
            await rightTerminal.getByRole('button', { name: 'New tab', exact: true }).click();
            await newTab.getByRole('button', { name: 'Files', exact: true }).waitFor();
            await terminalTab.waitFor({ state: 'hidden' });
            assert.equal(terminalCount('close'), beforeRightClose, 'Switching tabs keeps the right-side PTY.');
            await newTab.locator('.yard-source-labeled-tab[data-active="true"] > [data-app-shell-tab-close-button]').click();
            await terminalLine.waitFor();
            assert.equal(terminalCount('create'), beforeRightCreate + 1);
            await rightTerminal.locator('.yard-source-labeled-tab[data-active="true"] > [data-app-shell-tab-close-button]').click();
            await terminalTab.waitFor({ state: 'detached' });
            assert.equal(terminalCount('close'), beforeRightClose + 1);
            assert.equal(await editor.textContent(), 'Keep the parent draft.');
            await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
            await newTab.getByRole('button', { name: 'Files', exact: true }).click();
            const filesPanel = page.getByRole('complementary', { name: 'Files', exact: true });
            await filesPanel.getByRole('button', { name: fileFolder, exact: true }).click();
            await filesPanel.getByRole('button', { name: sourceFileName, exact: true }).click();
            await filesPanel.getByText(sourceFileBody.trim(), { exact: true }).waitFor();
            const [downloaded] = await Promise.all([
              page.waitForEvent('download'),
              filesPanel.getByRole('link', { name: 'Download file', exact: true }).click(),
            ]);
            assert.equal(downloaded.suggestedFilename(), sourceFileName);
            assert.equal(await readFile(await downloaded.path(), 'utf8'), sourceFileBody);
            await filesPanel.getByRole('button', { name: 'Back to files', exact: true }).click();
            await filesPanel.getByRole('button', { name: 'Parent folder', exact: true }).click();
            await filesPanel.getByRole('button', { name: fileFolder, exact: true }).waitFor();
            assert.ok(directoryCalls.every(call => call.workspaceRoot === workspace));
            assert.ok(directoryCalls.some(call => call.directoryPath === fileFolder));
            await filesPanel.locator('.yard-source-labeled-tab[data-active="true"] > [data-app-shell-tab-close-button]').click();
            await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
            const fileQuery = newTab.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true });
            await fileQuery.fill('yard-source-fixture');
            await fileQuery.press('Enter');
            await filesPanel.getByRole('button', { name: fileFolder + '/' + sourceFileName, exact: true }).click();
            await filesPanel.getByText(sourceFileBody.trim(), { exact: true }).waitFor();
            assert.deepEqual(fileSearchCalls.map(call => ({ query: call.query, roots: call.roots })), [
              { query: 'yard-source-fixture', roots: [workspace] },
            ]);
            await filesPanel.locator('.yard-source-labeled-tab[data-active="true"] > [data-app-shell-tab-close-button]').click();
            assert.equal(await editor.textContent(), 'Keep the parent draft.');
            const chatActions = page.getByRole('button', { name: 'Chat actions', exact: true });
            await chatActions.click();
            await page.getByRole('menuitem', { name: 'New side chat', exact: true }).click();
            const child = page.getByRole('complementary', { name: 'Side chat', exact: true });
            const childEditor = child.locator(editorSelector);
            await childEditor.fill(sidechatPrompt);
            await child.getByRole('button', { name: 'Send message' }).click({ timeout: 12_000 });
            await child.locator('[data-turn-status="inProgress"]').getByText(sidechatPrefix, { exact: true }).waitFor({ timeout: 12_000 });
            const { data: children } = await app.control.request<Page<ThreadSummary>>('thread/list', {
              attachedToThreadId: thread.id, limit: 10,
            });
            assert.equal(children.length, 1);
            const childId = children[0]!.id;
            assert.equal(children[0]!.attachedToThreadId, thread.id);
            assert.ok(!children[0]!.ephemeral);
            assert.equal(submitted.at(-1)?.threadId, childId);
            assert.deepEqual(forks, [{ threadId: thread.id, attachToSource: true, ephemeral: false, excludeTurns: true }]);
            assert.equal(await page.locator('[data-app-action-sidebar-thread-id="local:' + childId + '"]').count(), 0);
            await childEditor.fill('Keep the side chat draft.');
            await child.locator('.yard-source-labeled-tab[data-active="true"] > [data-app-shell-tab-close-button]').click();
            await main.getByText(reentryAnswer, { exact: true }).waitFor();
            assert.equal(await editor.textContent(), 'Keep the parent draft.');
            sidechatEnd.release();
            for (let attempts = 0; attempts < 40; attempts++) {
              const latest = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
                threadId: childId, sortDirection: 'desc', itemsView: 'summary', limit: 1,
              });
              if (latest.data[0]?.items.some(item => item.type === 'agentMessage' && item.text === sidechatAnswer)) break;
              assert.ok(attempts < 39, 'Closing the panel must leave the side chat running.');
              await delay(250);
            }
            await summary.click();
            const row = page.locator('[data-attached-thread-id="' + childId + '"]');
            await row.click({ timeout: 10_000 });
            await child.getByText(sidechatAnswer, { exact: true }).waitFor({ timeout: 12_000 });
            assert.equal(await childEditor.textContent(), 'Keep the side chat draft.');
            assert.equal(await main.isVisible(), false);
            assert.equal((await child.boundingBox())?.width, 390);
            assert.match(await child.evaluate(panel => getComputedStyle(panel).backgroundColor), /^rgb\(/);
            await page.screenshot({ path: join(output, 'mobile-side-chat.png') });

            // A fresh wide view reopens from the backend projection, not from
            // local panel state, and leaves both editors hittable.
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.reload({ waitUntil: 'commit' });
            await row.waitFor({ timeout: 12_000 });
            await page.screenshot({ path: join(output, 'desktop-summary.png') });
            await row.click();
            await child.getByText(sidechatAnswer, { exact: true }).waitFor({ timeout: 12_000 });
            assert.equal(await childEditor.textContent(), 'Keep the side chat draft.');
            assert.equal(await editor.textContent(), 'Keep the parent draft.');
            await editor.click({ trial: true });
            await childEditor.click({ trial: true });
            assert.equal(forks.length, 1);
            await page.screenshot({ path: join(output, 'desktop-side-chat.png') });

            await page.setViewportSize({ width: 390, height: 844 });
            await child.locator('.yard-source-labeled-tab[data-active="true"] > [data-app-shell-tab-close-button]').click();
            await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
            await summary.click();
            await editor.fill('');
            await panel.getByRole('button', { name: 'Create a file or site', exact: true }).last().click();
            await creationMenu.getByRole('menuitem', { name: 'Create document' }).click();
            await page.keyboard.press('Escape');
            assert.equal(await summary.getAttribute('aria-expanded'), 'false');
            await send.click();
            await main.locator('.yard-source-agent-message p').filter({ hasText: 'Created the Yard output fixture.' }).waitFor({ timeout: 12_000 });
            await main.locator('.bg-user-message [plugin-mention-path="plugin://documents@openai-primary-runtime"]').waitFor();
            assert.deepEqual(submitted.at(-1)?.input, [{ type: 'text', text: outputPrompt, text_elements: [] }]);
            assert.equal(submitted.at(-1)?.threadId, thread.id);
            assert.ok(outputRequests.some(request => request.pathname.startsWith('/source-chunks/output-files-')));
            const artifactRequests = () => outputRequests.filter(request => request.filePath === join(workspace, outputName))
              .map(({ pathname, method }) => ({ pathname, method }));
            assert.deepEqual(artifactRequests(), []);
            await summary.click();
            await panel.getByRole('button', { name: outputName, exact: true }).waitFor({ timeout: 10_000 });
            assert.ok(outputRequests.some(request => request.pathname.startsWith('/source-chunks/output-files-')));
            assert.deepEqual(artifactRequests(), [{ pathname: '/api/files/content', method: 'HEAD' }]);
            await panel.getByRole('button', { name: outputName, exact: true }).click();
            const preview = page.getByRole('complementary', { name: 'Output preview' });
            await preview.frameLocator('iframe').getByRole('heading', { name: outputTitle }).waitFor();
            assert.equal(await preview.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
            await page.screenshot({ path: join(output, 'mobile-output-preview.png') });
            const download = page.waitForEvent('download');
            await preview.getByRole('link', { name: 'Download output', exact: true }).click();
            const saved = await download;
            assert.equal(saved.suggestedFilename(), outputName);
            assert.equal(await readFile(await saved.path(), 'utf8'), outputBody);

            await page.goto(app.url, { waitUntil: 'commit' });
            const homeDraft = 'Keep the home draft after changing the default model.';
            const homeModel = main.getByRole('button', { name: /Yard Fixture Alpha High/ });
            await editor.fill(homeDraft);
            await homeModel.waitFor();
            const beforeModelMenu = catalogRequests.length;
            await homeModel.click();
            await page.getByRole('menuitem', { name: 'Select model', exact: true }).click();
            await page.getByRole('menuitemradio', { name: 'Yard Fixture Beta', exact: true }).click();
            await main.getByRole('button', { name: /Yard Fixture Beta High/ }).waitFor();
            assert.equal(catalogRequests.length, beforeModelMenu + 1);
            assert.equal(await editor.textContent(), homeDraft);
            const { config } = await app.control.request('config/read', { includeLayers: false });
            assert.equal(config.model, secondModel);
            assert.equal(config.model_reasoning_effort, 'high');
            await page.reload({ waitUntil: 'commit' });
            await main.getByRole('button', { name: /Yard Fixture Beta High/ }).waitFor();
            assert.equal(await editor.textContent(), homeDraft);
            const oldSettings = await app.control.request('thread/resume', { threadId: thread.id, excludeTurns: true }, { mutating: true });
            assert.equal(oldSettings.reasoningEffort, 'low');
            assert.equal(oldSettings.activePermissionProfile?.id, ':read-only');

            await main.getByRole('button', { name: /Yard Fixture Beta High/ }).click();
            const slider = page.getByRole('slider', { name: 'Power' });
            const bounds = await slider.boundingBox();
            assert.ok(bounds);
            const beforeDrag = configWrites.length;
            const sliderY = bounds.y + bounds.height / 2;
            await page.mouse.move(bounds.x + bounds.width - 9, sliderY);
            await page.mouse.down();
            await page.mouse.move(bounds.x + 9, sliderY, { steps: 8 });
            assert.equal(await slider.getAttribute('aria-valuetext'), 'Low');
            assert.equal(configWrites.length, beforeDrag);
            await page.mouse.up();
            await main.getByRole('button', { name: /Yard Fixture Beta Low/ }).waitFor();
            assert.equal(configWrites.length, beforeDrag + 1);
            assert.equal(await editor.textContent(), homeDraft);

            await page.setViewportSize({ width: 1440, height: 900 });
            await editor.fill(attachmentPrompt);
            async function drop(name: string) {
              await editor.evaluate((target, name) => {
                const transfer = new DataTransfer();
                transfer.items.add(new File(['drop fixture'], name, { type: 'text/plain' }));
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
              }, name);
            }
            await page.route('**/api/files/uploads', route => route.fulfill({
              status: 503, json: { error: 'Fixture upload unavailable' },
            }));
            await drop('failed.txt');
            await main.getByRole('alert').getByText('Fixture upload unavailable').waitFor();
            assert.equal(await editor.textContent(), attachmentPrompt);
            await page.unroute('**/api/files/uploads');
            await main.getByRole('button', { name: 'Add files and more' }).click();
            const chooser = page.waitForEvent('filechooser');
            await main.getByRole('button', { name: 'Files and folders', exact: true }).click();
            await (await chooser).setFiles(['first bytes', 'second bytes'].map(bytes => ({
              name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from(bytes),
            })));
            await editor.evaluate(async target => {
              const canvas = document.createElement('canvas');
              canvas.width = 8; canvas.height = 8;
              canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
              const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
              const transfer = new DataTransfer();
              transfer.items.add(new File([blob], 'draft.png', { type: blob.type }));
              target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
            });
            await page.waitForFunction(() => document.querySelector<HTMLImageElement>('main [data-composer-attachments] img')?.naturalWidth === 8);
            assert.equal(await main.getByText('same.txt', { exact: true }).count(), 2);
            const beforeAttachments = submitted.length;
            await send.click();
            await main.getByText(attachmentAnswer, { exact: true }).waitFor({ timeout: 12_000 });
            await main.getByText(attachmentPrompt, { exact: true }).waitFor();
            assert.equal(submitted.length, beforeAttachments + 1);
            const input = submitted.at(-1)!.input as { type: string; text?: string; path?: string }[];
            assert.match(input[0]!.text!, /## My request:\nReview the isolated attachments\./);
            const filePaths = [...input[0]!.text!.matchAll(/## same\.txt: ([^\n]+)/g)].map(match => match[1]!);
            assert.equal(new Set(filePaths).size, 2);
            assert.deepEqual(await Promise.all(filePaths.map(path => readFile(path, 'utf8'))), ['first bytes', 'second bytes']);
            assert.equal(input[1]?.type, 'localImage');
            const imagePath = input[1]?.path;
            assert.ok(typeof imagePath === 'string' && imagePath.endsWith('/draft.png'));
            assert.equal((await readFile(imagePath)).subarray(1, 4).toString(), 'PNG');
            assert.equal(await main.locator('[data-composer-attachments]').count(), 0);
            const sentImage = main.getByRole('region', { name: 'Conversation', exact: true })
              .getByRole('button', { name: 'User attachment', exact: true });
            await sentImage.click();
            await page.getByRole('dialog', { name: 'Image preview', exact: true })
              .getByRole('img', { name: 'User attachment', exact: true }).waitFor();
            await page.keyboard.press('Escape');
            await page.getByRole('dialog', { name: 'Image preview', exact: true }).waitFor({ state: 'hidden' });

            const gate = responseGate();
            const waitForUpload = page.waitForRequest('**/api/files/upload?**');
            const waitForResult = page.waitForResponse('**/api/files/upload?**');
            await page.route('**/api/files/upload?**', async route => { await gate.promise; await route.continue(); }, { times: 1 });
            try {
              await editor.fill('Keep this draft while the attachment uploads.');
              await drop('late.txt');
              await waitForUpload;
              assert.equal(await send.isDisabled(), true);
              await editor.press('Enter');
              assert.equal(submitted.length, beforeAttachments + 1);
              if (await page.getByRole('button', { name: 'Show sidebar', exact: true }).isVisible()) {
                await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
              }
              await select(thread.id);
              await page.waitForURL(url => url.searchParams.get('initialRoute') === '/local/' + thread.id);
              gate.release();
              assert.ok((await waitForResult).ok());
              await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
              assert.equal(await main.getByText('late.txt', { exact: true }).count(), 0);
            } finally { gate.release(); }

            const header = page.locator('[data-app-shell-titlebar]');
            const title = header.locator('[data-source-thread-title] button');
            const titleEdit = header.getByRole('textbox', { name: 'Chat title', exact: true });
            const originalTitle = await title.textContent();
            await title.click();
            await titleEdit.fill('Discard this title change');
            await titleEdit.press('Escape');
            assert.equal(await title.textContent(), originalTitle);
            await title.click();
            const renamed = 'Isolated renamed chat';
            await titleEdit.fill(renamed);
            await titleEdit.press('Enter');
            await header.getByRole('button', { name: renamed, exact: true }).waitFor();
            await page.locator('#app-shell-sidebar [aria-current="page"]').getByText(renamed, { exact: true }).waitFor();
            const currentTitle = await app.control.request('thread/read', { threadId: thread.id, includeTurns: false });
            assert.equal(currentTitle.thread.name, renamed);
            assert.equal(await page.locator('#app-shell-sidebar [aria-current="page"]').count(), 1);

            const side = page.locator('#app-shell-sidebar');
            const chatRow = side.locator('[data-app-action-sidebar-thread-id="local:' + thread.id + '"]');
            const pinned = side.locator('section').filter({ has: page.getByRole('heading', { name: 'Pinned', exact: true }) });
            const rowTitle = 'Renamed from the conversation menu';
            await chatRow.first().click({ button: 'right' });
            const actions = page.getByRole('menu', { name: 'Chat actions', exact: true });
            await actions.waitFor();
            await page.keyboard.press('Escape');
            await actions.waitFor({ state: 'hidden' });
            await chatRow.first().click({ button: 'right' });
            await actions.waitFor();
            await editor.click();
            await actions.waitFor({ state: 'hidden' });
            await chatRow.first().click({ button: 'right' });
            await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
            const titleInSidebar = side.getByRole('textbox', { name: 'Chat title', exact: true });
            await titleInSidebar.fill(rowTitle);
            await titleInSidebar.press('Enter');
            await header.getByRole('button', { name: rowTitle, exact: true }).waitFor();
            await chatRow.first().click({ button: 'right' });
            await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
            await pinned.getByText(rowTitle, { exact: true }).waitFor();
            assert.equal(await chatRow.count(), 1);
            await page.reload({ waitUntil: 'commit' });
            await pinned.getByText(rowTitle, { exact: true }).waitFor();
            assert.equal(await chatRow.count(), 1);
            await chatRow.click({ button: 'right' });
            await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
            await pinned.waitFor({ state: 'hidden' });
            await chatRow.first().waitFor();
            const originalHistory = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
              threadId: thread.id, sortDirection: 'asc', itemsView: 'summary', limit: 10,
            });
            assert.ok(originalHistory.data.length > 1);
            const lastTurnId = originalHistory.data[0]!.id;
            const seed = main.getByText(seedAnswer, { exact: true });
            const turns = main.locator('[data-turn-status]');
            while (!(await seed.count())) {
              const earlier = main.getByRole('button', { name: 'Load earlier messages' });
              assert.ok(await earlier.count(), 'The seed reply can be reached using history pagination.');
              const loaded = await turns.count();
              await earlier.click();
              await turns.nth(loaded).waitFor({ state: 'attached', timeout: 5_000 });
            }
            const branchDraft = 'Preserve the original draft while branching.';
            await editor.fill(branchDraft);
            await main.locator('article').filter({ has: page.getByText(seedAnswer, { exact: true }) })
              .getByRole('button', { name: 'More actions', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Fork chat from here', exact: true }).click();
            await page.waitForURL(url => {
              const to = url.searchParams.get('initialRoute');
              return !!to?.startsWith('/local/') && to !== '/local/' + thread.id;
            });
            const branchId = new URL(page.url()).searchParams.get('initialRoute')!.slice('/local/'.length);
            const branched = await app.control.request('thread/read', { threadId: branchId, includeTurns: false });
            assert.equal(branched.thread.forkedFromId, thread.id);
            assert.ok(!branched.thread.attachedToThreadId && !branched.thread.ephemeral);
            const branchHistory = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
              threadId: branchId, sortDirection: 'asc', itemsView: 'summary', limit: 10,
            });
            assert.equal(branchHistory.data.length, 1);
            assert.ok(branchHistory.data[0]!.items.some(item => item.type === 'agentMessage' && item.text === seedAnswer));
            assert.deepEqual(forks.at(-1), { threadId: thread.id, lastTurnId, ephemeral: false, excludeTurns: true });
            assert.equal((await app.control.request('thread/resume', {
              threadId: branchId, excludeTurns: true,
            }, { mutating: true })).sandbox?.type, 'readOnly');
            await main.getByText(seedAnswer, { exact: true }).waitFor();
            assert.equal(await editor.textContent(), '');
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await header.getByRole('button', { name: rowTitle, exact: true }).waitFor();
            assert.equal(await editor.textContent(), branchDraft);
            await chatActions.click();
            await page.getByRole('menuitem', { name: 'Fork', exact: true }).press('ArrowRight');
            await page.getByRole('menu', { name: 'Fork', exact: true }).getByRole('menuitem', { name: 'Fork chat', exact: true }).click();
            await page.waitForURL(url => {
              const to = url.searchParams.get('initialRoute');
              return !!to?.startsWith('/local/') && to !== '/local/' + thread.id && to !== '/local/' + branchId;
            });
            const wholeBranchId = new URL(page.url()).searchParams.get('initialRoute')!.slice('/local/'.length);
            const wholeBranchHistory = await app.control.request<Page<TurnSummary>>('thread/turns/list', {
              threadId: wholeBranchId, sortDirection: 'asc', itemsView: 'summary', limit: 10,
            });
            assert.equal(wholeBranchHistory.data.length, originalHistory.data.length);
            assert.deepEqual(forks.at(-1), { threadId: thread.id, ephemeral: false, excludeTurns: true });
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await header.getByRole('button', { name: rowTitle, exact: true }).waitFor();
            assert.equal(await editor.textContent(), branchDraft);
            await chatActions.click();
            await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
            await page.waitForURL(url => url.pathname === '/' && !url.searchParams.has('initialRoute'));
            await chatRow.first().waitFor({ state: 'detached' });
            const archived = await app.control.request<Page<ThreadSummary>>('thread/list', { archived: true, useStateDbOnly: true });
            assert.ok(archived.data.some(chat => chat.id === thread.id));
          } catch (error) {
            await writeFile(join(output, 'failure.json'), JSON.stringify({ errors, failedRequests, text: await page.locator('body').innerText() }, null, 2));
            throw error;
          }
          assert.equal(provider.requests, 9);
          const history = await app.control.request<Page<TurnSummary>>('thread/turns/list', { threadId: thread.id, sortDirection: 'desc', itemsView: 'summary', limit: 3 });
          assert.equal(history.data.length, 3);
          assert.equal(history.data[0]?.status, 'completed');
          assert.ok(history.data[2]?.items.some(item => item.type === 'agentMessage' && item.text === answer));
          assert.deepEqual(errors, []);
          const report = { cli: app.control.server?.userAgent, permission: sandbox.type, approvalPolicy,
            result: 'Verified lazy PTY, right tool tab and terminal retention, directory navigation and file search, preview and download, model and permission controls, draft retention, sends and streaming, IME, scoped stop, saved side chats, Outputs, local attachments, rename, durable pinning, native archive, and scoped branching.', errors };
          await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
          console.log(JSON.stringify(report));
        } finally {
          existingStream.release();
          projectStream.release();
          interruptStream.release();
          reentryStart.release();
          reentryEnd.release();
          sidechatEnd.release();
          await browser.close();
        }
      } finally { await app.close(); }
    } finally {
      if (daemon.pid && daemon.exitCode === null && daemon.signalCode === null) {
        const exited = once(daemon, 'exit');
        daemon.kill();
        await exited;
      }
    }
  } finally {
    existingStream.release();
    projectStream.release();
    interruptStream.release();
    reentryStart.release();
    reentryEnd.release();
    sidechatEnd.release();
    await new Promise<void>(resolve => provider.server.close(() => resolve()));
  }
} finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
