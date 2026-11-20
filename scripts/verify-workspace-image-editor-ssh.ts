// Run after the normal build/typecheck, under /tmp/agents-workbench-heavy.lock.
// Real private loopback OpenSSH transports two fake 0.169.1 protocol peers.
// No installed Codex account, user SSH profile, or model provider is contacted.
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Duplex, Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import type { ThreadItemSummary } from '../lib/codex-protocol.ts';
import { workspaceThreadRoute, parseWorkspaceThreadRoute } from '../src/native/history-startup.ts';
import { record, type ObjectValue } from '../src/native/protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { sshArguments } from '../src/native/ssh.ts';
import { attachedPrompt } from '../src/workspace/composer-input.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';

const output = resolve(process.env.AGENTS_IMAGE_EDITOR_SSH_EVIDENCE ?? '.local/workspace-image-editor-ssh');
const root = await mkdtemp('/tmp/yard-image-ssh-');
const dataDir = join(root, 'data'), localDir = join(root, 'local'), remoteStore = join(root, 'remote-store');
// The same absolute path contains different bytes on the two simulated hosts.
// The SSH command dispatcher and remote daemon map this namespace to remoteStore.
const remoteRoot = join(root, 'remote-path'), remoteHome = join(remoteRoot, 'codex');
await Promise.all([dataDir, localDir, remoteStore, remoteRoot, join(root, 'bin'), output].map(path => mkdir(path, { recursive: true, mode: 0o700 })));
const local = await createFakeCodex(localDir), remote = await createFakeCodex(remoteStore);
type Peer = typeof remote;
type Call = ReturnType<Peer['calls']>[number];
type Fixture = { id: string; name: string; images: readonly [string, string]; savedPath: string; activeTurn?: string };
type Gate = { promise: Promise<void>; release(): void };
const gates: Gate[] = [];
function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>(done => { release = done; });
  const barrier = { promise, release }; gates.push(barrier); return barrier;
}
const hostId = 'remote-ssh-discovered:image-editor-fixture';
const ordinaryName = 'ordinary-ssh-note.txt', ordinaryText = 'Keep this ordinary SSH attachment and the typed draft.\n';
const backgroundPrompt = 'Remove the background from this image. Keep all foreground subjects unchanged and fully intact, with clean, smooth edges. Make the background transparent.';
const removalPrompt = 'Remove the area marked in the second image from the first image';
const originalPath = process.env.PATH;
const execute = promisify(execFile);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let sshd: ChildProcess | undefined;
const sshChildren: ChildProcess[] = [];
let sshLog = '', activeCase = 'setup', passed = false, rpcTransports = 0;
let rejectWrite = false;
let heldWrite: { seen: Gate; release: Gate; finished: Gate } | undefined;
const rejectedTurns = new Set<string>();
const checks: Record<string, unknown> = {}, errors: string[] = [], screenshots: string[] = [];
const browserCalls: { hostId: string; method: string; params: ObjectValue }[] = [];
const copyRequestIds = new Set<string>(), copyReplies: ObjectValue[] = [];
const report: Record<string, unknown> = { reference: 'Codex App 26.1013.40934', sourceWorkspace: true,
  transport: 'Private loopback OpenSSH sshd + /usr/bin/ssh', backend: 'Two isolated fake peers, protocol 0.169.1',
  realCliUsed: false, realModelRequests: 0, userSshProfilesUsed: false, checks, errors, screenshots };

function within(directory: string, path: string) {
  const suffix = relative(directory, path);
  return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('../');
}
function physical(path: string) {
  assert.ok(within(remoteRoot, path), 'remote daemon escaped its disposable namespace');
  return join(remoteStore, relative(remoteRoot, path));
}
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function until(predicate: () => boolean | Promise<boolean>, message: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < deadline, message); await delay(40); }
}
async function waitGate(barrier: Gate, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([barrier.promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 15_000); })]); }
  finally { clearTimeout(timer); }
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  await Promise.race([ended, delay(1_000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
}
function calls(peer: Peer, method: string, id: string) { return peer.calls(method).filter(call => call.params.threadId === id); }
function mutations(peer: Peer, id?: string) { return peer.messages.filter(call => call.id != null &&
  ['turn/start', 'turn/steer', 'turn/interrupt', 'thread/queue/add'].includes(call.method ?? '') && (!id || call.params.threadId === id)); }
function mainForm() { return page!.locator('.yard-source-main > .yard-source-composer > form[data-codex-composer-root]'); }
function textEditor(form = mainForm()) { return form.locator('[data-codex-composer="true"]'); }
function panel() { return page!.locator('.yard-source-image-editor:visible'); }
function transcript(label = 'Conversation') { return page!.getByRole('region', { name: label, exact: true, includeHidden: true }); }
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(output, name + '.aria.txt'), await page.locator('body').ariaSnapshot()); screenshots.push(name);
}
async function open(fixture: Fixture, owner = hostId) {
  await page!.goto(app!.url + '/?initialRoute=' + encodeURIComponent(workspaceThreadRoute(owner, fixture.id)), { waitUntil: 'commit' });
  await transcript().getByText((owner === 'local' ? 'Local' : 'SSH') + ' pictures ready: ' + fixture.name, { exact: true }).waitFor({ timeout: 30_000 });
  await textEditor().waitFor();
  for (const name of ['Dismiss', 'Dismiss Full access warning for this session']) {
    const button = page!.getByRole('button', { name, exact: true }); if (await button.isVisible()) await button.click();
  }
  assert.deepEqual(parseWorkspaceThreadRoute(new URL(page!.url()).searchParams.get('initialRoute') ?? ''), { hostId: owner, threadId: fixture.id });
}
async function draft(text: string, form = mainForm(), ordinary = true) {
  await textEditor(form).fill(text);
  if (ordinary) {
    await form.locator('input[type="file"]').setInputFiles({ name: ordinaryName, mimeType: 'text/plain', buffer: Buffer.from(ordinaryText) });
    await form.getByRole('link', { name: ordinaryName, exact: true }).waitFor();
    const url = new URL((await form.getByRole('link', { name: ordinaryName, exact: true }).getAttribute('href'))!, app!.url);
    assert.equal(url.searchParams.get('hostId'), hostId);
    const path = url.searchParams.get('path')!; assert.ok(path.startsWith(remoteHome + '/attachments/'));
    assert.equal(await readFile(physical(path), 'utf8'), ordinaryText);
    assert.equal(await exists(path), false, 'an SSH attachment was written at the local path with the same name');
  }
  await until(() => form.locator('.yard-source-send').isEnabled(), 'composer did not become ready');
}
async function assertDraft(text: string, form = mainForm(), ordinary = true) {
  // Expanded image tabs hide the parent main area with visibility:hidden.
  // innerText omits those retained text nodes; textContent checks the draft
  // independently of which conversation is currently painted.
  assert.equal((await textEditor(form).textContent())?.trim(), text.trim());
  assert.equal(await form.getByRole('link', { name: ordinaryName, exact: true, includeHidden: true }).count(), ordinary ? 1 : 0);
}
async function image(fixture: Fixture, index: 1 | 2, region = transcript()) {
  if (index === 2) await region.getByRole('button', { name: 'Show generated image 2', exact: true }).click();
  await region.getByRole('button', { name: 'Generated image ' + index, exact: true }).click(); await panel().waitFor();
  await until(async () => await panel().getAttribute('data-active-image') === fixture.images[index - 1], 'wrong SSH image editor target');
  await until(() => panel().getByRole('img', { name: 'Generated image ' + index, exact: true }).evaluate(node => (node as HTMLImageElement).naturalWidth > 0), 'SSH image did not load');
  if (index === 2) {
    const url = new URL((await panel().getByRole('img', { name: 'Generated image 2', exact: true }).getAttribute('src'))!, app!.url);
    assert.equal(url.searchParams.get('hostId'), hostId); assert.equal(url.searchParams.get('path'), fixture.savedPath);
  }
}
async function waitCall(method: string, id: string) {
  return remote.waitFor(call => call.id != null && call.method === method && call.params.threadId === id, 20_000);
}
function input(call: Call) { assert.ok(Array.isArray(call.params.input)); return call.params.input as ObjectValue[]; }
async function assertInput(call: Call, prompt: string, expected: readonly Buffer[], uploaded: boolean) {
  const parts = input(call), parsed = attachedPrompt(String(parts[0]?.text));
  assert.equal(parts[0]?.type, 'text'); assert.equal(parsed.text, prompt); assert.deepEqual(parsed.attachments, []);
  assert.equal(parts.length, expected.length + 1);
  for (let index = 0; index < expected.length; index++) {
    const part = parts[index + 1]!; assert.equal(part.type, 'localImage'); const path = String(part.path);
    assert.ok(within(remoteRoot, path), 'image edit used a local staging path');
    assert.deepEqual(await readFile(physical(path)), expected[index], 'remote image attachment byte order changed');
    if (uploaded) { assert.ok(path.startsWith(remoteHome + '/attachments/')); assert.equal(await exists(path), false, 'SSH-uploaded image leaked into the local namespace'); }
  }
  if (call.method === 'turn/start') assert.equal(call.params.turnTrigger, 'image_edit');
  assert.equal(mutations(local).length, 0, 'a remote image edit mutated the local peer with the same IDs');
}

for (const peer of [local, remote]) {
  peer.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
  peer.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
  peer.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerAccountId: null, status: null, error: null }));
  peer.handlers.set('thread/list', params => {
    if (params.attachedToThreadId) return { data: [...peer.threads.values()].filter(thread =>
      thread.attachedToThreadId === params.attachedToThreadId && !peer.archived.has(thread.id)).map(thread => ({ ...thread, turns: [] })), nextCursor: null };
    const result = peer.defaultResult('thread/list', params);
    return { ...result, data: (result.data as unknown[]).filter(thread => !record(thread).attachedToThreadId) };
  });
}
const localFiles = fileDaemonFixture(path => { assert.ok(within(root, path), 'local fixture file escaped its private root'); return path; });
const remoteFiles = fileDaemonFixture(physical);
for (const method of ['fs/getMetadata', 'fs/readFile', 'fs/readDirectory', 'fs/createDirectory', 'fs/writeFile']) {
  local.handlers.set(method, params => localFiles(method, params));
  remote.handlers.set(method, async params => {
    if (method === 'fs/writeFile') {
      if (rejectWrite) { rejectWrite = false; throw Object.assign(new Error('Fixture SSH image write rejected'), { code: -32600 }); }
      const held = heldWrite;
      if (held && String(params.path).endsWith('/Generated image 1.png')) {
        heldWrite = undefined; held.seen.release(); await held.release.promise;
        try { return await remoteFiles(method, params); } finally { held.finished.release(); }
      }
    }
    return remoteFiles(method, params);
  });
}
remote.handlers.set('turn/start', params => {
  if (rejectedTurns.has(String(params.threadId))) throw Object.assign(new Error('Fixture SSH image turn rejected'), { code: -32600 });
  return remote.defaultResult('turn/start', params);
});

try {
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
  page.setDefaultTimeout(12_000); page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    socket.on('framesent', frame => {
      const message = record(JSON.parse(String(frame.payload)));
      if (message.type === 'mcp-request') {
        const request = record(message.request); browserCalls.push({ hostId: String(message.hostId ?? 'local'), method: String(request.method), params: record(request.params) });
      }
      if (message.type === 'fetch' && String(message.url).endsWith('/upload-local-file-attachments')) copyRequestIds.add(String(message.requestId));
    });
    socket.on('framereceived', frame => {
      const message = record(JSON.parse(String(frame.payload)));
      if (copyRequestIds.has(String(message.requestId)) && message.responseType) copyReplies.push(message);
    });
  });
  const pngs = await page.evaluate(() => [[256, 128, '#2f9c52'], [128, 192, '#de6728'], [256, 128, '#247ad9'], [128, 192, '#7026ba']].map(([width, height, color]) => {
    const canvas = document.createElement('canvas'); canvas.width = Number(width); canvas.height = Number(height);
    const context = canvas.getContext('2d')!; context.fillStyle = String(color); context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f9dc32'; context.fillRect(canvas.width / 4, canvas.height / 4, canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }));
  const remoteInline = Buffer.from(pngs[0]!.split(',')[1]!, 'base64'), remoteSaved = Buffer.from(pngs[1]!.split(',')[1]!, 'base64');
  const localSaved = Buffer.from(pngs[3]!.split(',')[1]!, 'base64'); assert.notDeepEqual(remoteSaved, localSaved);
  await writeFile(join(output, 'remote-inline.png'), remoteInline); await writeFile(join(output, 'remote-saved.png'), remoteSaved);
  await writeFile(join(output, 'local-same-path-shadow.png'), localSaved);
  let sequence = 0;
  async function fixture(name: string, active = false, parent?: Fixture): Promise<Fixture> {
    const id = '22222222-3333-4444-8555-' + String(++sequence).padStart(12, '0');
    const images = [name + '-inline', name + '-saved'] as const, savedPath = join(remoteRoot, name + '.png');
    await writeFile(savedPath, localSaved); await writeFile(physical(savedPath), remoteSaved);
    const activeTurn = active ? name + '-active-turn' : undefined;
    for (const [peer, label, inline] of [[local, 'Local', pngs[2]!], [remote, 'SSH', pngs[0]!]] as const) {
      const generation = (id: string, extra: ObjectValue): ThreadItemSummary => ({ id, type: 'imageGeneration', status: 'completed',
        revisedPrompt: null, generationId: null, failure: null, ...extra });
      const saved = { ...fixtureTurn(name + '-generated-turn', [
        { id: name + '-user', type: 'userMessage', content: [{ type: 'text', text: 'Generate isolated SSH fixture images.', text_elements: [] }] },
        generation(images[0], { result: inline }), generation(images[1], { result: '', savedPath }),
        { ...agentItem(name + '-answer', label + ' pictures ready: ' + name), phase: 'final_answer' },
      ]), startedAt: 1_700_000_000, completedAt: 1_700_000_020, durationMs: 20_000 };
      peer.threads.set(id, fixtureThread(id, peer === remote ? remoteRoot : localDir, { name: label + ' ' + name,
        ...(parent ? { attachedToThreadId: parent.id } : {}), turns: [saved,
          ...activeTurn ? [fixtureTurn(activeTurn, [agentItem(name + '-progress', label + ' active fixture work.')], 'inProgress')] : []],
        status: active ? { type: 'active', activeFlags: [] } : { type: 'idle' } }));
    }
    return { id, name, images, savedPath, activeTurn };
  }
  const saved = await fixture('saved-path'), inline = await fixture('inline-upload'), mask = await fixture('mask-upload');
  const steer = await fixture('active-steer', true), queue = await fixture('active-queue', true);
  const writeFailure = await fixture('write-rejection'), sendFailure = await fixture('send-rejection'), race = await fixture('host-switch-race');
  const parent = await fixture('sidechat-parent'), child = await fixture('sidechat-child', false, parent);
  remote.queues.set(queue.id, [{ id: 'existing-remote-queue', input: [{ type: 'text', text: 'Existing SSH queue fixture', text_elements: [] }], clientUserMessageId: null }]);

  const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
  const port = (listener.address() as import('node:net').AddressInfo).port; await new Promise<void>(done => listener.close(() => done()));
  const hostKey = join(root, 'host-key'), clientKey = join(root, 'client-key'), commandLog = join(root, 'ssh-commands.jsonl');
  for (const key of [hostKey, clientKey]) await execute('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  await writeFile(join(root, 'authorized_keys'), await readFile(clientKey + '.pub'), { mode: 0o600 });
  await writeFile(join(root, 'known_hosts'), `[127.0.0.1]:${port} ${await readFile(hostKey + '.pub', 'utf8')}`, { mode: 0o600 });
  const relay = join(root, 'relay.py'), dispatch = join(root, 'dispatch.py');
  await writeFile(relay, `import os, selectors, socket, sys
peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
peer.connect(${JSON.stringify(remote.socketPath)})
events = selectors.DefaultSelector()
events.register(0, selectors.EVENT_READ)
events.register(peer, selectors.EVENT_READ)
while events.get_map():
    for key, _ in events.select():
        data = os.read(0, 65536) if key.fileobj == 0 else peer.recv(65536)
        if not data:
            if key.fileobj == 0:
                events.unregister(0)
                peer.shutdown(socket.SHUT_WR)
                continue
            sys.exit(0)
        if key.fileobj == 0:
            peer.sendall(data)
        else:
            remaining = memoryview(data)
            while remaining:
                remaining = remaining[os.write(1, remaining):]
`, { mode: 0o600 });
  await writeFile(dispatch, `import json, os, subprocess, sys, time
command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
logical = ${JSON.stringify(remoteRoot)}
physical = ${JSON.stringify(remoteStore)}
with open(${JSON.stringify(commandLog)}, 'a') as log:
    log.write(json.dumps({'kind': 'rpc' if command == 'yard-image-rpc' else 'file', 'command': command, 'at': time.time()}) + '\\n')
if command == 'yard-image-rpc':
    os.execv(sys.executable, [sys.executable, ${JSON.stringify(relay)}])
if logical not in command or not any(part in command for part in ('stat -L ', 'realpath -ze ', 'test -f ')):
    sys.stderr.write('Command outside the disposable SSH file fixture\\n')
    sys.exit(126)
result = subprocess.run(['/bin/sh', '-c', command.replace(logical, physical)], stdin=sys.stdin.buffer, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
stdout = result.stdout.replace(physical.encode(), logical.encode()) if 'realpath -ze ' in command else result.stdout
sys.stdout.buffer.write(stdout)
sys.stderr.buffer.write(result.stderr)
sys.exit(result.returncode)
`, { mode: 0o600 });
  await writeFile(join(root, 'sshd.conf'), `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${hostKey}\nPidFile ${root}/sshd.pid\nAuthorizedKeysFile ${root}/authorized_keys\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes no\nPermitTTY no\nPermitUserRC no\nPermitUserEnvironment no\nAllowTcpForwarding no\nAllowAgentForwarding no\nX11Forwarding no\nAllowUsers ${userInfo().username}\nForceCommand /usr/bin/python3 ${dispatch}\n`, { mode: 0o600 });
  sshd = spawn(process.env.AGENTS_TEST_SSHD ?? '/usr/sbin/sshd', ['-D', '-e', '-f', join(root, 'sshd.conf')], { stdio: ['ignore', 'pipe', 'pipe'] });
  sshd.stderr!.on('data', chunk => { sshLog += chunk; });
  await until(() => { if (sshd!.exitCode !== null) throw new Error(sshLog || 'private sshd exited'); return sshLog.includes('Server listening'); }, 'private loopback sshd did not start');
  await writeFile(join(root, 'bin', 'ssh'), `#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${root}/known_hosts -o IdentitiesOnly=yes "$@"\n`, { mode: 0o700 });
  process.env.PATH = join(root, 'bin') + ':' + (originalPath ?? '/usr/bin:/bin');
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ settings: { localeOverride: 'en-US' }, globals: {
    'remote-connection-auto-connect-by-host-id': { [hostId]: true },
  } }));
  app = await createNativeWorkbench({ port: 0, sourceWorkspace: true, dataDir, workspace: localDir, codexHome: localDir, socketPath: local.socketPath,
    hostCatalog: { hosts: [{ hostId, displayName: 'Image editor SSH fixture', sshAlias: null, sshHost: userInfo().username + '@127.0.0.1', sshPort: port, identity: clientKey }], projects: [], assignments: {} },
    sshStream: (host, onPaths) => {
      assert.equal(host.hostId, hostId); rpcTransports++; onPaths?.({ homeDirectory: remoteRoot, codexHome: remoteHome });
      const child = spawn('ssh', [...sshArguments(host), 'yard-image-rpc'], { stdio: ['pipe', 'pipe', 'pipe'] }); sshChildren.push(child);
      const stream = Duplex.fromWeb({ readable: Readable.toWeb(child.stdout!), writable: Writable.toWeb(child.stdin!) });
      let stderr = ''; child.stderr!.on('data', chunk => { stderr += chunk; });
      child.once('error', error => stream.destroy(error));
      child.once('exit', code => { if (code && !stream.destroyed) stream.destroy(new Error('Fixture SSH RPC exited: ' + stderr)); });
      stream.once('close', () => { child.kill('SIGTERM'); }); return stream;
    },
    // File reads deliberately use the production remoteFileCommand over SSH.
    httpFetch: async () => new Response('Offline SSH image fixture', { status: 503 }) });

  activeCase = 'saved-path';
  await open(saved); await draft('Preserve the saved remote image draft.'); await image(saved, 2);
  const downloadEvent = page.waitForEvent('download'); await panel().getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadEvent; const downloaded = await readFile((await download.path())!);
  assert.deepEqual(downloaded, remoteSaved); assert.notDeepEqual(downloaded, await readFile(saved.savedPath), 'remote download fell back to the same local path');
  await panel().locator('img[data-editor-image="' + saved.images[1] + '"]').click({ button: 'right' });
  const imageMenu = page.getByRole('menu', { name: 'Image actions', exact: true });
  assert.equal(await imageMenu.getByRole('menuitem', { name: 'Open in File Manager', exact: true }).count(), 0,
    'a remote image must not offer the Yard machine file manager');
  await imageMenu.getByRole('menuitem', { name: 'Open image in new tab', exact: true }).click();
  const readOnly = page.locator('.yard-source-image-editor[data-read-only="true"]:visible'); await readOnly.waitFor();
  const readOnlyImage = readOnly.getByRole('img', { name: 'Generated image 2', exact: true });
  await until(async () => await readOnlyImage.evaluate(node => (node as HTMLImageElement).naturalWidth > 0), 'readonly SSH image failed to load');
  const readOnlySource = new URL((await readOnlyImage.getAttribute('src'))!, app.url);
  assert.equal(readOnlySource.searchParams.get('hostId'), hostId);
  assert.equal(readOnlySource.searchParams.get('path'), saved.savedPath);
  const readOnlyResponse = await page.request.get(readOnlySource.href);
  assert.equal(readOnlyResponse.status(), 200); assert.deepEqual(await readOnlyResponse.body(), remoteSaved);
  assert.equal(await readOnly.getByRole('button', { name: 'Remove BG', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Close Generated image 2 tab', exact: true }).click();
  await readOnly.waitFor({ state: 'detached' });
  await assertDraft('Preserve the saved remote image draft.');
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  const savedCall = await waitCall('turn/start', saved.id); await assertInput(savedCall, backgroundPrompt, [remoteSaved], false);
  assert.equal(input(savedCall)[1]!.path, saved.savedPath); await assertDraft('Preserve the saved remote image draft.');
  await capture('01-remote-saved-image'); checks.savedPath = { params: savedCall.params, byteExactDownload: true, localShadowDifferent: true,
    contextMenuReadOnlyTab: true, readOnlyHostPreserved: true };

  activeCase = 'inline-upload';
  await open(inline); await draft('Preserve the remote data URL draft.'); await image(inline, 1);
  await panel().getByRole('button', { name: 'Resize', exact: true }).click();
  await page.getByRole('menu', { name: 'Resize', exact: true }).getByRole('menuitem', { name: 'Widescreen 16:9', exact: true }).click();
  const inlineCall = await waitCall('turn/start', inline.id); await assertInput(inlineCall, 'Make the aspect ratio 16:9', [remoteInline], true);
  await assertDraft('Preserve the remote data URL draft.'); checks.inline = { params: inlineCall.params, remoteUpload: true };

  activeCase = 'mask-upload';
  await open(mask); await draft('Preserve the remote mask draft.'); await image(mask, 1);
  await panel().getByRole('button', { name: 'Remove', exact: true }).click();
  const brushSize = panel().getByRole('slider', { name: 'Brush size', exact: true }); await brushSize.focus(); await brushSize.press('Home');
  for (let index = 0; index < 20; index++) await brushSize.press('ArrowRight');
  const canvas = panel().locator('canvas[aria-label="Remove mask"]'), box = await canvas.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .35); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .55, { steps: 12 }); await page.mouse.up();
  await panel().getByRole('button', { name: 'Send edits', exact: true }).click();
  const maskCall = await waitCall('turn/start', mask.id), maskInput = input(maskCall); assert.equal(maskInput.length, 3);
  const maskPath = String(maskInput[2]!.path); assert.ok(maskPath.startsWith(remoteHome + '/attachments/'));
  const maskBytes = await readFile(physical(maskPath)); await assertInput(maskCall, removalPrompt, [remoteInline, maskBytes], true);
  await writeFile(join(output, 'remote-submitted-mask.png'), maskBytes);
  const maskPixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0, white = 0, transparent = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] !== 255) transparent++;
      else if (pixels[index] === 0 && pixels[index + 1] === 0 && pixels[index + 2] === 0) black++;
      else if (pixels[index] === 255 && pixels[index + 1] === 255 && pixels[index + 2] === 255) white++;
    }
    return { width: canvas.width, height: canvas.height, black, white, transparent };
  }, maskBytes.toString('base64'));
  assert.equal(maskPixels.width, 256); assert.equal(maskPixels.height, 128); assert.equal(maskPixels.transparent, 0); assert.ok(maskPixels.black && maskPixels.white);
  await assertDraft('Preserve the remote mask draft.'); await capture('02-remote-mask'); checks.mask = { params: maskCall.params, pixels: maskPixels, originalFirstMaskSecond: true };

  activeCase = 'active-steer';
  await open(steer); await draft('Preserve the SSH Steer draft.'); await image(steer, 2);
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  const steerCall = await waitCall('turn/steer', steer.id); assert.equal(steerCall.params.expectedTurnId, steer.activeTurn);
  await assertInput(steerCall, backgroundPrompt, [remoteSaved], false); assert.equal(calls(remote, 'turn/start', steer.id).length, 0);
  await assertDraft('Preserve the SSH Steer draft.'); checks.steer = { params: steerCall.params, interrupts: 0 };

  activeCase = 'active-queue';
  await open(queue); await draft('Preserve the SSH Queue draft.'); await image(queue, 1);
  await mainForm().getByRole('button', { name: 'Queued message actions', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Turn on queueing', exact: true }).click();
  await until(async () => await mainForm().locator('.yard-source-send').getAttribute('aria-label') === 'Queue', 'SSH composer did not switch to Queue');
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  const queueCall = await waitCall('thread/queue/add', queue.id); await assertInput(queueCall, backgroundPrompt, [remoteInline], true);
  await until(() => mainForm().locator('.yard-source-queued-row').count().then(count => count === 2), 'SSH edit did not enter the remote queue');
  assert.equal(calls(remote, 'turn/start', queue.id).length, 0); assert.equal(calls(remote, 'turn/steer', queue.id).length, 0);
  await assertDraft('Preserve the SSH Queue draft.'); checks.queue = { params: queueCall.params, interrupts: 0 };

  activeCase = 'write-rejection';
  await open(writeFailure); await draft('Preserve the rejected SSH upload draft.'); await image(writeFailure, 1); rejectWrite = true;
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture SSH image write rejected' }).first().waitFor();
  await until(async () => await panel().getAttribute('aria-busy') !== 'true', 'SSH write rejection left image editing busy');
  await assertDraft('Preserve the rejected SSH upload draft.'); assert.equal(mutations(remote, writeFailure.id).length, 0);
  checks.writeRejection = { sent: 0, draftAndOrdinaryAttachmentPreserved: true };

  activeCase = 'send-rejection';
  await open(sendFailure); await draft('Preserve the rejected SSH send draft.'); await image(sendFailure, 2); rejectedTurns.add(sendFailure.id);
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  const rejectedCall = await waitCall('turn/start', sendFailure.id); await assertInput(rejectedCall, backgroundPrompt, [remoteSaved], false);
  await page.getByRole('alert').filter({ hasText: 'Fixture SSH image turn rejected' }).first().waitFor();
  await assertDraft('Preserve the rejected SSH send draft.'); assert.equal(remote.threads.get(sendFailure.id)!.turns.length, 1);
  checks.sendRejection = { params: rejectedCall.params, draftAndOrdinaryAttachmentPreserved: true };

  activeCase = 'same-id-host-switch';
  await open(race, 'local'); await draft('Local host draft must stay untouched.', mainForm(), false);
  await open(race); await draft('Preserve the pending SSH image draft.'); await image(race, 1);
  const held = { seen: gate(), release: gate(), finished: gate() }; heldWrite = held; const beforeCopies = copyReplies.length;
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click(); await waitGate(held.seen, 'SSH image upload did not reach the remote write barrier');
  const collapse = page.getByRole('button', { name: 'Exit full screen', exact: true }); if (await collapse.isVisible()) await collapse.click();
  await page.locator('[data-app-action-sidebar-thread-id="local:' + race.id + '"]').first().click();
  await transcript().getByText('Local pictures ready: ' + race.name, { exact: true }).waitFor(); await assertDraft('Local host draft must stay untouched.', mainForm(), false);
  held.release.release(); await waitGate(held.finished, 'held remote image write did not complete');
  await until(() => copyReplies.length > beforeCopies, 'SSH copy response did not return after switching hosts');
  await until(async () => !await panel().isVisible() || await panel().getAttribute('aria-busy') !== 'true', 'stale SSH editor did not settle');
  await delay(100); assert.equal(mutations(local, race.id).length, 0); assert.equal(mutations(remote, race.id).length, 0);
  await assertDraft('Local host draft must stay untouched.', mainForm(), false); assert.equal(await mainForm().locator('.yard-source-image-attachment').count(), 0);
  checks.hostSwitch = { sameThreadIdOnBothHosts: race.id, localSent: 0, remoteSent: 0, destinationDraftPreserved: true };

  activeCase = 'remote-sidechat-owner';
  await open(parent); await draft('Parent SSH draft stays with its owner.');
  const parentDraft = 'Parent SSH draft stays with its owner.';
  const parentEditorDom = await textEditor().elementHandle(); assert.ok(parentEditorDom);
  const parentDraftStates: ObjectValue[] = []; report.sidechatParentDraftStates = parentDraftStates;
  async function assertParentDraft(stage: string, visible = false) {
    const state = await parentEditorDom!.evaluate(element => ({ connected: element.isConnected,
      textContent: element.textContent, innerText: (element as HTMLElement).innerText,
      visibility: getComputedStyle(element).visibility }));
    parentDraftStates.push({ stage, ...state });
    assert.equal(state.connected, true, 'opening a child image detached the original parent editor at ' + stage);
    assert.ok(await textEditor().evaluate((element, original) => element === original, parentEditorDom!),
      'the parent composer selector changed to a different editor at ' + stage);
    assert.equal(state.textContent?.trim(), parentDraft, 'the original parent editor lost its draft at ' + stage);
    await assertDraft(parentDraft);
    if (visible) {
      await textEditor().waitFor({ state: 'visible' });
      assert.equal((await textEditor().innerText()).trim(), parentDraft, 'the visible parent draft changed at ' + stage);
    }
  }
  await assertParentDraft('parent draft entered', true);
  const summary = page.getByRole('complementary', { name: 'Conversation summary', exact: true });
  if (!await summary.isVisible()) await page.getByRole('button', { name: 'Summary', exact: true }).click();
  await summary.getByRole('button', { name: 'SSH ' + child.name, exact: true }).click();
  const side = page.getByRole('complementary', { name: 'Side chat', exact: true });
  await side.getByText('SSH pictures ready: ' + child.name, { exact: true }).waitFor();
  await assertParentDraft('side chat opened', true);
  const childForm = side.locator('form[data-codex-composer-root]');
  await childForm.evaluate(form => form.setAttribute('data-fixture-ssh-child-composer', ''));
  const ownerForm = page.locator('form[data-fixture-ssh-child-composer]'); await draft('Child SSH draft stays with its owner.', ownerForm);
  await assertParentDraft('child draft entered', true);
  const ownerDom = await textEditor(ownerForm).elementHandle(); assert.ok(ownerDom);
  await image(child, 1, transcript('Side chat conversation'));
  await assertParentDraft('child image editor expanded');
  assert.equal(await ownerForm.getAttribute('data-image-preview-composer'), '');
  assert.ok(await textEditor(ownerForm).evaluate((element, original) => element === original, ownerDom));
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  const childCall = await waitCall('turn/start', child.id); await assertInput(childCall, backgroundPrompt, [remoteInline], true);
  assert.equal(calls(remote, 'turn/start', parent.id).length, 0); await assertDraft('Child SSH draft stays with its owner.', ownerForm);
  assert.ok(await textEditor(ownerForm).evaluate((element, original) => element === original, ownerDom),
    'sending the child image edit replaced its original composer DOM');
  await assertParentDraft('child image edit sent');
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await assertParentDraft('image editor collapsed', true);
  assert.deepEqual(parseWorkspaceThreadRoute(new URL(page.url()).searchParams.get('initialRoute') ?? ''), { hostId, threadId: parent.id });
  await capture('03-ssh-sidechat-owner'); checks.sidechat = { parent: parent.id, child: child.id, params: childCall.params,
    originalComposerDomPreserved: true, originalParentComposerDomPreserved: true, parentDraftVisibleAfterCollapse: true };

  const commands = (await readFile(commandLog, 'utf8')).trim().split('\n').filter(Boolean).map(line => record(JSON.parse(line)));
  assert.ok(commands.some(command => command.kind === 'rpc'), 'no RPC bytes crossed the private OpenSSH connection');
  assert.ok(commands.some(command => command.kind === 'file' && String(command.command).includes('stat -L ')));
  assert.ok(commands.some(command => command.kind === 'file' && String(command.command).includes('head -c ')), 'remote image bytes did not use the production SSH file reader');
  assert.ok(remote.calls('fs/writeFile').length > 0);
  assert.equal(local.calls('fs/writeFile').length, 0, 'image uploads must be written by the selected SSH peer');
  assert.equal(local.calls('fs/getMetadata').filter(call => call.params.path === saved.savedPath).length, 0, 'the SSH saved image consulted local metadata');
  assert.equal(browserCalls.filter(call => call.method === 'fs/writeFile').length, 0, 'image bytes must use the server attachment copy, not a browser RPC frame');
  assert.equal(local.calls('turn/interrupt').length + remote.calls('turn/interrupt').length, 0);
  assert.equal(mutations(local).length, 0); assert.deepEqual(errors, []);
  report.ssh = { port, rpcTransports, commandCount: commands.length, fileCommands: commands.filter(command => command.kind === 'file').length };
  await writeFile(join(output, 'ssh-commands.json'), JSON.stringify(commands, null, 2)); passed = true;
} catch (error) {
  report.failure = { case: activeCase, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
  await capture('failure-' + activeCase).catch(() => {}); throw error;
} finally {
  for (const barrier of gates) barrier.release();
  const cleanupErrors: string[] = [];
  const cleanup = async (run: () => Promise<unknown>) => { try { await run(); } catch (error) { cleanupErrors.push(String(error)); } };
  try {
    await cleanup(async () => browser?.close()); await cleanup(async () => app?.close());
    for (const child of sshChildren) await cleanup(() => stop(child));
    await cleanup(() => stop(sshd)); process.env.PATH = originalPath;
    report.passed = passed && !cleanupErrors.length; report.cleanupErrors = cleanupErrors; report.rpcTransports = rpcTransports;
    report.localMutations = mutations(local); report.remoteMutations = mutations(remote);
    report.remoteWrites = remote.calls('fs/writeFile').map(call => ({ path: call.params.path, bytes: Buffer.byteLength(String(call.params.dataBase64), 'base64') }));
    report.browserCalls = browserCalls.filter(call => ['turn/start', 'turn/steer', 'turn/interrupt', 'thread/queue/add'].includes(call.method));
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); await writeFile(join(output, 'sshd.log'), sshLog);
  } finally {
    process.env.PATH = originalPath;
    await cleanup(() => remote.close()); await cleanup(() => local.close()); await rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(cleanupErrors, [], 'isolated SSH fixture cleanup failed');
}
console.log(JSON.stringify({ passed, checks: Object.keys(checks), output, transport: report.transport, backend: report.backend }));
