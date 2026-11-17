// Run under /tmp/agents-workbench-heavy.lock. Uses disposable real CLI backends,
// loopback model responses and a private browser; no account or shared daemon.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createConnection, createServer as socketServer } from 'node:net';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import type { ObjectValue } from '../src/native/protocol.ts';
import type { Page as RpcPage, TurnSummary } from '../lib/codex-protocol.ts';
import { fileTransferLimit } from '../src/native/file-limits.ts';

const root = await mkdtemp('/tmp/yard-paste-'), dataDir = join(root, 'data');
const output = resolve(process.env.AGENTS_PASTE_EVIDENCE ?? '.local/file-paste');
await Promise.all([mkdir(dataDir), mkdir(output, { recursive: true })]);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
const report: ObjectValue = { renderer: '26.1013.40934', provider: 'loopback scripted Responses', checks: [], errors: [] };
const checks = report.checks as string[], errors = report.errors as string[];
let replies = 0;
const provider = createServer(async (request, response) => {
  for await (const _chunk of request) { /* Consume fixture input. */ }
  const id = 'paste-response-' + ++replies;
  const item = { id: 'paste-message-' + replies, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PASTE_READY', annotations: [] }] };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [type, data] of [
    ['response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } }],
    ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } }],
    ['response.output_item.done', { output_index: 0, item }],
    ['response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
  ] as const) response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  response.end();
});
await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
const providerPort = (provider.address() as import('node:net').AddressInfo).port;
const backends: { home: string; socket: string; child: ReturnType<typeof spawn>; connection: CodexConnection; threadId: string; log: string }[] = [];
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
let sshd: ReturnType<typeof spawn> | undefined, sshLog = '';
const originalPath = process.env.PATH;
async function until(predicate: () => Promise<boolean> | boolean, label: string) {
  for (let i = 0; i < 600; i++) { if (await predicate()) return; await delay(100); }
  throw new Error('Timed out: ' + label);
}
type InputFile = { name: string; data: string; type: string; size?: number };
async function paste(selected: InputFile[], kind: 'paste' | 'drop' = 'paste') {
  const editor = page!.locator('.ProseMirror[contenteditable=true]').last();
  await editor.evaluate((element, { selected, kind }) => {
    const data = new DataTransfer();
    for (const file of selected) data.items.add(new File([file.size == null ? Uint8Array.from(atob(file.data), char => char.charCodeAt(0)) : new Uint8Array(file.size).fill(37)], file.name, { type: file.type }));
    element.dispatchEvent(kind === 'paste' ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
      : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, { selected, kind });
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  for (const name of ['local', 'remote']) {
    const home = join(root, name); await mkdir(home);
    await writeFile(join(home, 'config.toml'), `model="gpt-5.2-codex"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="danger-full-access"\n[model_providers.fixture]\nname="Paste fixture"\nbase_url="http://127.0.0.1:${providerPort}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[features]\ncode_mode=false\n`);
    const socket = join(root, name + '.sock');
    const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socket], {
      env: { PATH: process.env.PATH, CODEX_HOME: home, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const connection = new CodexConnection(socket), backend = { home, socket, child, connection, threadId: '', log: '' }; backends.push(backend);
    child.stdout!.on('data', chunk => { backend.log += chunk; }); child.stderr!.on('data', chunk => { backend.log += chunk; });
    await until(async () => { try { await access(socket); return true; } catch { if (child.exitCode != null) throw new Error(backend.log); return false; } }, 'CLI socket');
    await connection.connect();
    const { thread } = await connection.request('thread/start', { cwd: root }); backend.threadId = thread.id;
    await connection.request('thread/name/set', { threadId: thread.id, name: 'File paste ' + name });
    await connection.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Reply PASTE_READY' }] }, { mutating: true });
    await until(async () => (await connection.request<RpcPage<TurnSummary>>('thread/turns/list', { threadId: thread.id, itemsView: 'full' })).data.some(turn => turn.status === 'completed'), 'fixture reply');
  }
  const local = backends[0]!, remote = backends[1]!, remoteId = 'remote-ssh-discovered:paste';
  const listener = socketServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
  const sshPort = (listener.address() as import('node:net').AddressInfo).port; await new Promise<void>(done => listener.close(() => done()));
  const execute = promisify(execFile), hostKey = join(root, 'host-key'), clientKey = join(root, 'client-key');
  for (const key of [hostKey, clientKey]) await execute('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  await writeFile(join(root, 'authorized_keys'), await readFile(clientKey + '.pub'), { mode: 0o600 });
  await writeFile(join(root, 'known_hosts'), `[127.0.0.1]:${sshPort} ${await readFile(hostKey + '.pub', 'utf8')}`, { mode: 0o600 });
  await writeFile(join(root, 'sshd.conf'), `Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${hostKey}\nPidFile ${root}/sshd.pid\nAuthorizedKeysFile ${root}/authorized_keys\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes no\nPermitTTY no\n`, { mode: 0o600 });
  sshd = spawn(process.env.AGENTS_TEST_SSHD ?? '/usr/sbin/sshd', ['-D', '-e', '-f', join(root, 'sshd.conf')], { stdio: ['ignore', 'pipe', 'pipe'] });
  sshd.stderr!.on('data', chunk => { sshLog += chunk; });
  await until(() => { if (sshd!.exitCode !== null) throw new Error(sshLog); return sshLog.includes('Server listening'); }, 'temporary SSH server');
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin', 'ssh'), `#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${root}/known_hosts -o IdentitiesOnly=yes "$@"\n`, { mode: 0o700 });
  process.env.PATH = join(root, 'bin') + ':' + originalPath;
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: { 'remote-connection-auto-connect-by-host-id': { [remoteId]: true } } }));
  app = await createNativeWorkbench({ port: 0, dataDir, codexHome: local.home, socketPath: local.socket, workspace: root,
    hostCatalog: { hosts: [{ hostId: remoteId, displayName: 'Paste SSH fixture', sshAlias: null, sshHost: userInfo().username + '@127.0.0.1', sshPort, identity: clientKey }], projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: root, codexHome: remote.home }); return createConnection(remote.socket); },
    httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Continue with current model|继续使用当前模型)$/ }), button => button.click());
  const uploads: { fsPath: string }[] = [], calls: { hostId: string; method: string; params: ObjectValue }[] = [];
  const copyRequests = new Set<string>(), copies: ObjectValue[][] = [];
  // Observe the tiny result inside the page: Chromium's inspector discards
  // response bodies when the associated request exceeds its cache budget.
  await page.exposeFunction('yardObserveUpload', (ok: boolean, value: { fsPath: string }) => {
    if (ok) uploads.push(value); else errors.push('Upload: ' + JSON.stringify(value));
  });
  await page.addInitScript(() => {
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (String(args[0]).includes('/api/files/upload?')) {
        await (window as unknown as { yardObserveUpload: (ok: boolean, value: unknown) => Promise<void> }).yardObserveUpload(response.ok, await response.clone().json());
      }
      return response;
    };
  });
  await page.routeWebSocket('**/native-host', route => {
    const server = route.connectToServer();
    route.onMessage(raw => { const m = record(JSON.parse(String(raw))); if (m.type === 'mcp-request') calls.push({ hostId: String(m.hostId ?? 'local'), ...record(m.request) } as typeof calls[number]); if (m.type === 'fetch' && String(m.url).endsWith('/upload-local-file-attachments')) copyRequests.add(String(m.requestId)); server.send(raw); });
    server.onMessage(raw => { const m = record(JSON.parse(String(raw))); if (copyRequests.has(String(m.requestId))) { if (m.responseType === 'success') copies.push(m.body as ObjectValue[]); else errors.push('SSH copy: ' + String(m.error)); } route.send(raw); });
  });
  const open = async (backend: typeof local, hostId = 'local') => {
    await page!.goto(app!.url + '/?initialRoute=' + encodeURIComponent('/local/' + backend.threadId + (hostId === 'local' ? '' : '?hostId=' + hostId)), { waitUntil: 'domcontentloaded' });
    await page!.getByText('PASTE_READY', { exact: true }).first().waitFor({ timeout: 30000 });
    await page!.locator('.ProseMirror[contenteditable=true]').last().waitFor();
  };
  const selected: InputFile[] = [
    { name: '中文说明.txt', type: 'text/plain', data: Buffer.from('文件粘贴\n').toString('base64') },
    { name: '同名.bin', type: 'application/octet-stream', data: Buffer.from([0, 255, 17]).toString('base64') },
    { name: '同名.bin', type: 'application/octet-stream', data: Buffer.from([17, 255, 0]).toString('base64') },
  ];
  await open(local); await paste(selected);
  await until(() => uploads.length === selected.length, 'ordinary file uploads');
  for (const file of selected) await page.getByText(file.name, { exact: true }).first().waitFor();
  for (const file of selected) assert.ok((await Promise.all(uploads.map(u => readFile(u.fsPath)))).some(bytes => bytes.equals(Buffer.from(file.data, 'base64'))));
  assert.equal(new Set(uploads.map(u => u.fsPath)).size, selected.length);
  checks.push('DOM file paste: Chinese name and equal filenames with distinct bytes attach through the native composer');
  const editor = page.locator('.ProseMirror[contenteditable=true]').last();
  const word = await readFile(resolve('vendor/codex-app/26.1013.40934/webview/assets/project-brief-e08b85749970.docx'));
  await paste([{ name: '拖入的文档.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: word.toString('base64') }], 'drop');
  await page.getByText('拖入的文档.docx', { exact: true }).first().waitFor();
  await until(() => uploads.length === selected.length + 1, 'dropped Word upload');
  assert.deepEqual(await readFile(uploads.at(-1)!.fsPath), word);
  checks.push('DOM file drop: a Word document attaches with exact bytes');
  const large: InputFile = { name: '64MiB附件.bin', type: 'application/octet-stream', data: '', size: fileTransferLimit };
  await paste([large]);
  await until(() => uploads.length === selected.length + 2, '64 MiB local upload');
  await page.getByText(large.name, { exact: true }).first().waitFor();
  assert.ok((await readFile(uploads.at(-1)!.fsPath)).equals(Buffer.alloc(fileTransferLimit, 37)), '64 MiB local bytes match');
  checks.push('64 MiB local file attaches with exact bytes at the supported size boundary');
  await page.evaluate(() => navigator.clipboard.writeText('TRUSTED_TEXT ')); await editor.click(); await editor.press('Control+V');
  assert.match(await editor.innerText(), /TRUSTED_TEXT/);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
    canvas.getContext('2d')!.fillRect(0, 0, 80, 80);
    const png = await new Promise<Blob>(done => canvas.toBlob(blob => done(blob!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
  await editor.press('Control+V');
  await until(() => uploads.length === selected.length + 3, 'trusted image upload');
  await page.waitForFunction(() => [...document.images].some(image => image.naturalWidth === 80 && image.naturalHeight === 80));
  await page.screenshot({ path: join(output, 'local-files.png') });
  await editor.fill('Send local files'); await editor.press('Enter');
  await until(() => calls.some(call => call.method === 'turn/start'), 'local send');
  const localInput = JSON.stringify(calls.find(call => call.method === 'turn/start')!.params.input);
  for (const upload of uploads) assert.ok(localInput.includes(upload.fsPath), 'native local payload includes staged path');
  checks.push('trusted Ctrl+V text and image paste both work; native turn/start includes all local file and image paths');

  await open(remote, remoteId); const remoteStart = uploads.length;
  await paste([selected[0]!, large]);
  await until(() => copies.length > 0, 'SSH copy completion');
  await page.getByText(selected[0]!.name, { exact: true }).first().waitFor();
  await page.getByText(large.name, { exact: true }).first().waitFor({ timeout: 60000 });
  await until(() => uploads.length === remoteStart + 2, 'SSH staging');
  const directories = await readdir(join(remote.home, 'attachments'));
  const remotePaths: string[] = [];
  for (const file of [selected[0]!, large]) {
    const paths = directories.map(directory => join(remote.home, 'attachments', directory, file.name));
    const target = (await Promise.all(paths.map(async path => { try { await access(path); return path; } catch { return null; } }))).find(path => path != null)!;
    assert.ok(target, 'file exists in the selected remote CODEX_HOME'); remotePaths.push(target);
    assert.ok((await readFile(target)).equals(file.size == null ? Buffer.from(file.data, 'base64') : Buffer.alloc(file.size, 37)), 'SSH bytes match');
  }
  assert.equal(calls.filter(call => call.hostId === remoteId && call.method === 'fs/writeFile').length, 0, 'attachment bytes never traverse the browser WebSocket');
  await editor.fill('Send remote file'); await editor.press('Enter');
  await until(() => calls.some(call => call.hostId === remoteId && call.method === 'turn/start'), 'remote send');
  const remoteInput = JSON.stringify(calls.find(call => call.hostId === remoteId && call.method === 'turn/start')!.params.input);
  for (const path of remotePaths) assert.ok(remoteInput.includes(path));
  for (const upload of uploads.slice(remoteStart)) assert.ok(!remoteInput.includes(upload.fsPath));
  checks.push('separate real CLI with loopback RPC and real OpenSSH binary transfer: small and 64 MiB files preserve bytes; native send uses remote paths without large browser WebSocket frames');

  await open(local); const errorStart = uploads.length;
  await page.route('**/api/files/uploads', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"PASTE_UPLOAD_FAILURE"}' }));
  await paste([{ ...selected[0]!, name: 'failed.txt' }]);
  await page.getByText('PASTE_UPLOAD_FAILURE', { exact: true }).waitFor();
  assert.equal(uploads.length, errorStart);
  await page.unroute('**/api/files/uploads');
  await paste([{ ...selected[0]!, name: 'retry.txt' }]);
  await page.getByText('retry.txt', { exact: true }).first().waitFor();
  checks.push('upload failure is visible and a subsequent file paste succeeds');

  let releaseUpload!: () => void;
  const held = new Promise<void>(done => { releaseUpload = done; }); let requested = false;
  await page.route('**/api/files/upload?**', async route => { requested = true; await held; await route.continue(); });
  await paste([{ ...selected[0]!, name: 'late.txt' }]);
  await until(() => requested, 'held upload');
  await page.locator('[data-app-action-sidebar-thread-row]').filter({ hasText: 'File paste remote' }).first().click();
  await page.getByText('PASTE_READY', { exact: true }).first().waitFor();
  releaseUpload(); await until(() => uploads.some(upload => upload.fsPath.endsWith('/late.txt')), 'released upload');
  await page.unroute('**/api/files/upload?**');
  assert.equal(await page.getByText('late.txt', { exact: true }).count(), 0);
  checks.push('same-page conversation switch while an upload is pending discards the stale attachment');
  assert.deepEqual(errors, []); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close();
  if (sshd && sshd.exitCode === null) { sshd.kill('SIGTERM'); await once(sshd, 'exit'); }
  process.env.PATH = originalPath;
  await writeFile(join(output, 'sshd.log'), sshLog);
  for (const backend of backends) {
    backend.connection.close();
    if (backend.child.exitCode === null) { backend.child.kill('SIGTERM'); await once(backend.child, 'exit'); }
    await writeFile(join(output, backend.home.split('/').at(-1)! + '-daemon.log'), backend.log);
  }
  await new Promise<void>(done => provider.close(() => done()));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
