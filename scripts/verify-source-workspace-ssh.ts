// Use disposable peers with the same thread, turn and request IDs on both hosts.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { parseWorkspaceThreadRoute, workspaceThreadRoute } from '../src/native/history-startup.ts';
import { record } from '../src/native/protocol.ts';
import { composerInput } from '../src/workspace/composer-input.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-source-ssh-');
const localDir = join(root, 'local'), remoteDir = join(root, 'remote'), dataDir = join(root, 'data');
await Promise.all([localDir, remoteDir, dataDir].map(path => mkdir(path)));
const local = await createFakeCodex(localDir), remote = await createFakeCodex(remoteDir);
const threadId = '00000000-0000-4000-8000-000000000001';
const hostId = 'remote-ssh-discovered:source-fixture';
const host = { hostId, displayName: 'SSH fixture', sshAlias: 'fixture', sshHost: 'fixture.invalid', sshPort: null, identity: null };
const project = { id: 'ssh-fixture-project', hostId, label: 'SSH fixture project', remotePath: remoteDir };
const remoteRoute = workspaceThreadRoute(hostId, threadId);
const text = 'Test attachment on the selected host.\n';
const childId = 'same-saved-side-chat';
const report = { localWorkspaceMs: 0, checks: [] as string[], errors: [] as string[] };
const output = resolve(process.env.AGENTS_SOURCE_SSH_EVIDENCE ?? '.local/source-workspace-ssh');
await mkdir(output, { recursive: true });
let allowRemote!: () => void;
const remoteGate = new Promise<void>(resolve => { allowRemote = resolve; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

try {
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {
    'remote-connection-auto-connect-by-host-id': { [hostId]: true },
  } }));
  for (const [peer, cwd, name] of [[local, localDir, 'Local'], [remote, remoteDir, 'Remote']] as const) {
    await writeFile(join(cwd, 'report.md'), name + ' output on its own host');
    await mkdir(join(cwd, 'nested'));
    await writeFile(join(cwd, 'nested', 'detail.txt'), name + ' nested file');
    peer.threads.set(threadId, fixtureThread(threadId, cwd, { name: name + ' thread', ...(peer === remote ? { projectId: project.id } : {}),
      turns: [fixtureTurn('saved-turn', [{ id: 'source-file', type: 'userMessage',
        content: composerInput(name + ' attached source', [{ path: join(cwd, 'nested/detail.txt'), name: 'detail.txt', image: false }]) },
        { ...agentItem('answer', name + ' history on its own host'), phase: 'final_answer' },
        agentItem('output', '[report.md](report.md)')])] }));
    peer.threads.set(childId, fixtureThread(childId, cwd, { name: name + ' saved side chat', attachedToThreadId: threadId,
      turns: [fixtureTurn('child-turn', [agentItem('child-answer', name + ' child history on its own host')])] }));
    peer.handlers.set('initialize', async () => {
      if (peer === remote) await remoteGate;
      return { userAgent: 'codex-tui/0.169.1 (Linux)' };
    });
    peer.handlers.set('thread/turns/list', p => peer.defaultResult('thread/turns/list', { ...p, itemsView: 'full' }));
    peer.handlers.set('thread/list', p => {
      if (p.attachedToThreadId) return {
        data: [...peer.threads.values()].filter(thread => thread.attachedToThreadId === p.attachedToThreadId && !peer.archived.has(thread.id))
          .map(thread => ({ ...thread, turns: [] })), nextCursor: null,
      };
      // Like CLI 0.169.1, ordinary history lists exclude attached side chats.
      const result = record(peer.defaultResult('thread/list', p));
      return { ...result, data: (result.data as unknown[]).filter(thread => !record(thread).attachedToThreadId) };
    });
    peer.handlers.set('thread/fork', p => {
      const result = record(peer.defaultResult('thread/fork', p));
      if (p.attachToSource) {
        const child = record(result.thread);
        child.attachedToThreadId = p.threadId;
        peer.threads.get(String(child.id))!.attachedToThreadId = p.threadId;
      }
      return result;
    });
    peer.handlers.set('fs/getMetadata', async p => {
      const path = String(p.path);
      const allowed = [cwd, ...(peer === local ? [join(dataDir, 'uploads')] : [])];
      assert.ok(allowed.some(directory => path === directory || path.startsWith(directory + '/')), 'file metadata stays on its originating host');
      const info = await stat(path);
      return { isFile: info.isFile(), isDirectory: info.isDirectory(), isSymlink: false, modifiedAtMs: info.mtimeMs };
    });
    peer.handlers.set('fs/readDirectory', async p => {
      const path = String(p.path);
      assert.ok(path === cwd || path.startsWith(cwd + '/'));
      const entries = await readdir(path, { withFileTypes: true });
      return { entries: entries.map(entry => ({ fileName: entry.name, isDirectory: entry.isDirectory() })) };
    });
    peer.handlers.set('fuzzyFileSearch', p => {
      assert.deepEqual(p.roots, [cwd]);
      return { files: [{ root: cwd, path: 'nested/detail.txt', match_type: 'file' }] };
    });
    peer.handlers.set('plugin/installed', () => ({ marketplaces: [{ plugins: [{ id: name.toLowerCase() + '@fixture',
      name: name + ' fixture plugin', installed: true, enabled: true }] }] }));
  }
  function fixturePath(value: unknown, directory = join(remoteDir, 'attachments')) {
    assert.equal(typeof value, 'string');
    const path = String(value), name = relative(directory, path);
    assert.ok(!name.startsWith('..'), 'the peer only accesses its own attachment store');
    return path;
  }
  const staging = (path: unknown) => fixturePath(path, join(dataDir, 'uploads'));
  local.handlers.set('fs/createDirectory', async p => { await mkdir(staging(p.path), { recursive: true }); return {}; });
  remote.handlers.set('fs/createDirectory', async p => { await mkdir(fixturePath(p.path), { recursive: p.recursive === true }); return {}; });
  remote.handlers.set('fs/writeFile', async p => {
    await writeFile(fixturePath(p.path), Buffer.from(String(p.dataBase64), 'base64'), { flag: 'wx' });
    return {};
  });
  app = await createNativeWorkbench({ port: 0, sourceWorkspace: true, dataDir, workspace: root,
    codexHome: localDir, socketPath: local.socketPath, hostCatalog: { hosts: [host], projects: [project], assignments: {} },
    sshStream: (_host, paths) => { paths?.({ homeDirectory: remoteDir, codexHome: remoteDir }); return createConnection(remote.socketPath); },
    remoteFileCommand: async (target, command, maxBytes, signal) => {
      assert.equal(target.hostId, hostId);
      assert.ok(command.includes(remoteDir) && /^(stat -L |realpath -ze |test -f )/.test(command), 'only the fixture remote file store is inspected');
      return (await promisify(execFile)('/bin/sh', ['-c', command], { encoding: 'buffer', maxBuffer: maxBytes + 1, signal })).stdout;
    },
    httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const editor = page.locator('.yard-source-main').getByRole('textbox', { name: 'Work with Codex' });
  const sidebar = page.locator('#app-shell-sidebar');
  const localRow = sidebar.getByRole('button', { name: 'Local thread', exact: true });
  const projects = sidebar.locator('[data-app-action-sidebar-section-heading="Projects"]');
  const remoteRow = projects.getByRole('button', { name: 'Remote thread', exact: true });
  const back = page.getByRole('button', { name: 'Back', exact: true });
  const forward = page.getByRole('button', { name: 'Forward', exact: true });
  await page.goto(app.url + workspaceThreadRoute('local', threadId), { waitUntil: 'domcontentloaded' });
  await localRow.waitFor();
  await editor.waitFor();
  await page.getByText('Local history on its own host', { exact: true }).waitFor();
  await sidebar.getByRole('button', { name: 'Connecting…', exact: true }).waitFor();
  assert.equal(await remoteRow.count(), 0);
  report.localWorkspaceMs = await page.evaluate(() => new Promise<number>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
  assert.equal(await localRow.getAttribute('aria-current'), 'page');
  assert.ok(await back.isDisabled() && await forward.isDisabled());
  await editor.fill('local draft kept');
  report.checks.push('Local editor, history and sidebar work while remote initialization is held');
  allowRemote();
  await sidebar.getByRole('button', { name: project.label, exact: true }).waitFor();
  await remoteRow.waitFor();
  const pagedThreads = Array.from({ length: 52 }, (_, index) => fixtureThread(
    '10000000-0000-4000-8000-' + String(index).padStart(12, '0'), localDir,
    { name: 'Paged external ' + index, updatedAt: local.threads.get(threadId)!.updatedAt - index - 1 }));
  for (const thread of pagedThreads) local.threads.set(thread.id, thread);
  local.broadcast({ method: 'thread/started', params: { thread: { ...pagedThreads[0], turns: [] } } });
  const localRecents = sidebar.locator('[data-app-action-sidebar-section-heading="Recents"]')
    .filter({ has: page.locator('[data-app-action-sidebar-thread-host-id="local"]') });
  await localRecents.getByRole('button', { name: pagedThreads[0]!.name!, exact: true }).waitFor();
  const lastPaged = pagedThreads.at(-1)!;
  for (let page = 0; page < 4 && !await localRecents.getByRole('button', { name: lastPaged.name!, exact: true }).isVisible(); page++) {
    await localRecents.getByRole('button', { name: 'Load more chats', exact: true }).press('Enter');
  }
  await localRecents.getByRole('button', { name: lastPaged.name!, exact: true }).waitFor();
  const pageReads = local.calls('thread/list').filter(call => call.params.cursor === '50').length;
  local.archived.add(lastPaged.id);
  local.broadcast({ method: 'thread/archived', params: { threadId: lastPaged.id } });
  await localRecents.getByRole('button', { name: lastPaged.name!, exact: true }).waitFor({ state: 'detached' });
  await local.waitFor(() => local.calls('thread/list').filter(call => call.params.cursor === '50').length > pageReads, 5_000);
  await localRecents.getByRole('button', { name: pagedThreads.at(-2)!.name!, exact: true }).waitFor();
  await delay(200);
  assert.equal(await localRecents.getByRole('button', { name: lastPaged.name!, exact: true }).count(), 0,
    'a refreshed older page cannot revive an archived row');
  for (const thread of pagedThreads) {
    local.archived.add(thread.id);
    local.broadcast({ method: 'thread/archived', params: { threadId: thread.id } });
  }
  await localRecents.getByRole('button', { name: pagedThreads[0]!.name!, exact: true }).waitFor({ state: 'detached' });
  report.checks.push('Refreshing already expanded history re-reads its visible pages and removes archived rows without losing the remaining older page');
  for (const [peer, cwd, owner, label] of [[local, localDir, 'local', 'Local'], [remote, remoteDir, hostId, 'Remote']] as const) {
    const original = peer.threads.get(threadId)!;
    const addedId = '00000000-0000-4000-8000-000000000099';
    const added = fixtureThread(addedId, cwd, { name: label + ' externally created',
      ...(owner === hostId ? { projectId: project.id } : {}), updatedAt: original.updatedAt + 100 });
    const row = sidebar.locator('[data-app-action-sidebar-thread-host-id="' + owner + '"]')
      .filter({ has: page.getByText(added.name!, { exact: true }) }).first();
    peer.threads.set(addedId, added);
    peer.broadcast({ method: 'thread/started', params: { thread: { ...added, turns: [] } } });
    await row.waitFor({ timeout: 5_000 });
    added.status = { type: 'active', activeFlags: [] };
    peer.broadcast({ method: 'thread/status/changed', params: { threadId: addedId, status: added.status } });
    await row.getByRole('status', { name: 'Working', exact: true }).waitFor({ timeout: 2_000 });
    await delay(400); // Let the preceding lifecycle refresh finish before measuring text events.
    const beforeDeltas = peer.calls('thread/list').length;
    for (let index = 0; index < 30; index++) peer.broadcast({ method: 'item/agentMessage/delta',
      params: { threadId: addedId, turnId: 'external-turn', itemId: 'external-answer', delta: '.' } });
    await delay(400);
    assert.equal(peer.calls('thread/list').length, beforeDeltas, 'streamed text does not poll the history list');
    added.status = { type: 'idle' };
    peer.broadcast({ method: 'turn/completed', params: { threadId: addedId, turn: { id: 'external-turn', status: 'completed', items: [] } } });
    await row.getByRole('status', { name: 'Working', exact: true }).waitFor({ state: 'detached', timeout: 2_000 });
    const renamed = label + ' externally renamed';
    added.name = renamed;
    peer.broadcast({ method: 'thread/name/updated', params: { threadId: addedId, threadName: renamed } });
    const changed = sidebar.getByRole('button', { name: renamed, exact: true }).first();
    await changed.waitFor({ timeout: 5_000 });
    const recents = sidebar.locator('[data-app-action-sidebar-section-heading="Recents"]');
    assert.equal(await recents.locator('[data-app-action-sidebar-thread-host-id="' + owner + '"]').first().getAttribute('aria-label'), renamed);
    peer.archived.add(addedId);
    peer.broadcast({ method: 'thread/archived', params: { threadId: addedId } });
    await changed.waitFor({ state: 'detached', timeout: 2_000 });
    peer.archived.delete(addedId);
    peer.broadcast({ method: 'thread/unarchived', params: { threadId: addedId } });
    await changed.waitFor({ timeout: 5_000 });
    // A missed event while offline must be repaired on returning to the page.
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    added.name = label + ' changed while offline';
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sidebar.getByRole('button', { name: added.name, exact: true }).first().waitFor({ timeout: 10_000 });
    peer.archived.add(addedId);
    peer.broadcast({ method: 'thread/archived', params: { threadId: addedId } });
    await sidebar.getByRole('button', { name: added.name, exact: true }).first().waitFor({ state: 'detached', timeout: 2_000 });
    // Archived threads remain readable in the daemon, including on reconnect.
  }
  report.checks.push('Local and SSH history follow external creation, running state, recency, rename, archive and unarchive without per-token reads',
    'Returning online reconciles missed local and SSH sidebar changes');
  await remoteRow.click();
  await page.getByText('Remote history on its own host', { exact: true }).waitFor();
  assert.equal(await page.getByText('Local history on its own host', { exact: true }).count(), 0);
  assert.deepEqual(parseWorkspaceThreadRoute(new URL(page.url()).searchParams.get('initialRoute') ?? ''), { hostId, threadId });
  assert.equal(await editor.textContent(), '');
  await editor.fill('remote draft kept');
  await back.click();
  assert.equal(await editor.innerText(), 'local draft kept');
  await forward.click();
  assert.equal(await editor.innerText(), 'remote draft kept');
  assert.ok(await forward.isDisabled());
  await localRow.click();
  assert.equal(await editor.innerText(), 'local draft kept');
  await remoteRow.click();
  assert.equal(await editor.innerText(), 'remote draft kept');
  await page.reload();
  await page.getByText('Remote history on its own host', { exact: true }).waitFor();
  assert.equal(await editor.innerText(), 'remote draft kept');
  const legacyRoute = workspaceThreadRoute('local', threadId) + '?hostId=' + encodeURIComponent(hostId);
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent(legacyRoute), { waitUntil: 'domcontentloaded' });
  await page.getByText('Remote history on its own host', { exact: true }).waitFor();
  assert.equal(await editor.innerText(), 'remote draft kept');
  report.checks.push('Different persisted drafts for equal thread IDs, including reload and the legacy SSH link');

  const summary = page.getByRole('complementary', { name: 'Conversation summary', exact: true });
  const sidechat = page.getByRole('complementary', { name: 'Side chat', exact: true });
  const childEditor = sidechat.getByRole('textbox', { name: 'Work with Codex', exact: true });
  async function showSummary() {
    if (!await summary.isVisible()) await page.getByRole('button', { name: 'Summary', exact: true }).click();
    await summary.waitFor();
  }
  for (const [row, name] of [[localRow, 'Local'], [remoteRow, 'Remote']] as const) {
    await row.click();
    await showSummary();
    await summary.getByRole('button', { name: name + ' saved side chat', exact: true }).click();
    await sidechat.getByText(name + ' child history on its own host', { exact: true }).waitFor();
    assert.equal(await childEditor.textContent(), '');
    await childEditor.fill(name + ' child draft kept');
    assert.equal(await editor.innerText(), name.toLowerCase() + ' draft kept');
    assert.equal(parseWorkspaceThreadRoute(new URL(page.url()).searchParams.get('initialRoute') ?? '')?.threadId, threadId,
      'opening a remote side chat leaves the main conversation selected');
  }
  for (const [row, name] of [[localRow, 'Local'], [remoteRow, 'Remote']] as const) {
    await row.click();
    await showSummary();
    await summary.getByRole('button', { name: name + ' saved side chat', exact: true }).click();
    await childEditor.waitFor();
    assert.equal(await childEditor.innerText(), name + ' child draft kept');
  }
  await sidechat.getByRole('button', { name: 'Send message', exact: true }).click();
  const childSend = await remote.waitForCall('turn/start');
  assert.equal(childSend?.params.threadId, childId);
  assert.equal(record((childSend?.params.input as unknown[])[0]).text, 'Remote child draft kept');
  assert.equal(local.calls('turn/start').length, 0);
  await page.getByRole('button', { name: 'Close right sidebar', exact: true }).click();
  await sidechat.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
  await childEditor.waitFor();
  assert.equal(remote.calls('turn/start').length, 1, 'reopening a tool never resends a message');
  await sidechat.getByRole('button', { name: 'Close tab', exact: true }).click();
  report.checks.push('Saved SSH side chats stay in the right sidebar; equal child IDs retain separate drafts and send only to their own host');

  for (const [row, name, owner] of [[localRow, 'Local', 'local'], [remoteRow, 'Remote', hostId]] as const) {
    await row.click();
    await showSummary();
    await summary.getByRole('button', { name: 'report.md', exact: true }).click();
    const preview = page.getByRole('complementary', { name: 'Output preview', exact: true });
    await preview.getByText(name + ' output on its own host', { exact: true }).waitFor();
    const href = (await preview.getByRole('link', { name: 'Download output', exact: true }).getAttribute('href'))!;
    assert.equal(new URL(href, app.url).searchParams.get('hostId') ?? 'local', owner);
    const bytes = await context.request.get(app.url + href);
    assert.equal(await bytes.text(), name + ' output on its own host');
    await preview.getByRole('button', { name: 'Close tab', exact: true }).click();
    await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
    const newTab = page.getByRole('complementary', { name: 'New tab', exact: true });
    await newTab.getByRole('button', { name: 'Files', exact: true }).click();
    const files = page.getByRole('complementary', { name: 'Files', exact: true });
    await files.getByRole('button', { name: 'nested', exact: true }).click();
    await files.getByRole('button', { name: 'detail.txt', exact: true }).click();
    await files.getByText(name + ' nested file', { exact: true }).waitFor();
    await files.getByRole('button', { name: 'Back to files', exact: true }).click();
    await files.getByRole('button', { name: 'Parent folder', exact: true }).click();
    const search = files.getByRole('searchbox', { name: 'Search files', exact: true });
    await search.fill('detail');
    await search.press('Enter');
    await files.getByRole('button', { name: 'nested/detail.txt', exact: true }).click();
    await files.getByText(name + ' nested file', { exact: true }).waitFor();
    const fileDownload: URL = new URL((await files.getByRole('link', { name: 'Download file', exact: true }).getAttribute('href'))!, app.url);
    assert.equal(fileDownload.searchParams.get('hostId') ?? 'local', owner);
    await files.getByRole('button', { name: 'Close tab', exact: true }).click();
  }
  assert.ok(remote.calls('fs/readDirectory').some(call => call.params.path === remoteDir));
  assert.ok(remote.calls('fuzzyFileSearch').length > 0 && local.calls('fuzzyFileSearch').length > 0);
  report.checks.push('Outputs, preview, downloads, directory navigation and fuzzy search use their originating host');
  await showSummary();
  await summary.locator('.yard-source-sources-summary').getByRole('button', { name: 'detail.txt', exact: true }).click();
  const sourcePreview = page.getByRole('complementary', { name: 'Output preview', exact: true });
  await sourcePreview.getByText('Remote nested file', { exact: true }).waitFor();
  await sourcePreview.getByRole('button', { name: 'Close tab', exact: true }).click();
  await showSummary();
  await summary.getByRole('button', { name: 'Attach files or connect apps', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Use plugins', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remote fixture plugin', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: 'Local fixture plugin', exact: true }).count(), 0);
  assert.ok(remote.calls('plugin/installed').length > 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  report.checks.push('SSH Sources open remote attachments and read enabled plugins from the same remote host');
  assert.equal(await editor.innerText(), 'remote draft kept');
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New side chat', exact: true }).click();
  await childEditor.waitFor();
  const fork = await remote.waitForCall('thread/fork');
  assert.equal(fork?.params.threadId, threadId);
  assert.equal(fork?.params.attachToSource, true);
  assert.equal(local.calls('thread/fork').length, 0);
  await childEditor.fill('Remote new side chat draft');
  await sidechat.getByRole('button', { name: 'Close tab', exact: true }).click();
  assert.equal(await editor.innerText(), 'remote draft kept');
  report.checks.push('New SSH side chats fork on the remote daemon without replacing the parent or its draft');
  await page.screenshot({ path: join(output, 'remote-summary.png') });

  await page.locator('input[type=file]').setInputFiles({ name: 'host.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  const uploaded = page.locator('.yard-source-main .yard-source-composer .yard-source-attachment-download');
  const uploadError = page.locator('.yard-source-composer-error');
  await uploaded.or(uploadError).first().waitFor({ state: 'attached', timeout: 10_000 });
  if (await uploadError.count()) assert.fail((await uploadError.first().textContent()) ?? 'Attachment transfer failed');
  const transfer = await remote.waitForCall('fs/writeFile');
  const filePath = String(transfer?.params.path);
  assert.equal(await readFile(filePath, 'utf8'), text);
  const download = new URL((await uploaded.getAttribute('href'))!, app.url);
  assert.equal(download.searchParams.get('hostId'), hostId);
  assert.equal(download.searchParams.get('path'), filePath);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const sent = await remote.waitForCall('turn/start', 2);
  assert.equal(sent?.params.threadId, threadId);
  const input = record((sent?.params.input as unknown[])[0]).text;
  assert.ok(typeof input === 'string' && input.includes(filePath) && input.includes('remote draft kept'));
  assert.equal(local.calls('turn/start').length, 0);
  assert.equal(local.calls('fs/writeFile').length, 0);
  report.checks.push('SSH attachment bytes, download URL and turn start are scoped to the same remote host');

  const turnId = remote.threads.get(threadId)!.turns.at(-1)!.id;
  const approval = (command: string) => ({ id: 71, method: 'item/commandExecution/requestApproval', params: {
    threadId, turnId, itemId: 'same-item', command, availableDecisions: ['accept', 'decline'],
  } });
  local.broadcast(approval('printf local-request'));
  remote.broadcast(approval('printf remote-request'));
  await page.getByText('printf remote-request', { exact: true }).waitFor();
  assert.equal(await page.getByText('printf local-request', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  const reply = await remote.waitFor(message => message.id === 71 && record(message.result).decision === 'decline');
  assert.equal(record(reply.result).decision, 'decline');
  assert.ok(!local.messages.some(message => message.id === 71));
  remote.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 71 } });
  await page.getByText('printf remote-request', { exact: true }).waitFor({ state: 'hidden' });
  await localRow.click();
  await page.getByText('printf local-request', { exact: true }).waitFor();
  report.checks.push('Approval with the same numeric request ID reaches only its originating daemon');
  local.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 71 } });
  await remoteRow.click();

  const queued = { id: 'remote-queued', clientUserMessageId: 'queued-transfer-once',
    input: [...composerInput('Continue in a remote side chat')] };
  remote.queues.set(threadId, [queued]);
  remote.broadcast({ method: 'thread/queue/changed', params: { threadId } });
  const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
  await queue.getByRole('button', { name: 'Queued message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open in side chat', exact: true }).click();
  const moved = await remote.waitForCall('turn/start', 3);
  assert.equal(moved?.params.clientUserMessageId, queued.clientUserMessageId);
  assert.notEqual(moved?.params.threadId, threadId);
  assert.deepEqual(moved?.params.input, queued.input);
  assert.equal(remote.queues.get(threadId)?.length, 0);
  await childEditor.waitFor();
  await sidechat.getByRole('button', { name: 'Close tab', exact: true }).click();

  const retry = { id: 'remote-queued-rejected', clientUserMessageId: 'queued-recovery',
    input: [...composerInput('Recover the remote queued draft', [{ path: join(remoteDir, 'nested/detail.txt'), name: 'detail.txt', image: false }])] };
  remote.handlers.set('turn/start', () => { throw new Error('Fixture refused the side chat turn'); });
  remote.queues.set(threadId, [retry]);
  remote.broadcast({ method: 'thread/queue/changed', params: { threadId } });
  await queue.getByRole('button', { name: 'Queued message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open in side chat', exact: true }).click();
  await sidechat.getByRole('alert').getByText(/The message is back in the side chat draft/).waitFor();
  assert.equal(await childEditor.textContent(), 'Recover the remote queued draft');
  const refused = await remote.waitForCall('turn/start', 4);
  const recoveredId = String(refused?.params.threadId);
  assert.equal(remote.queues.get(threadId)?.length, 0);
  assert.equal(local.calls('thread/queue/delete').length, 0);
  assert.equal(local.calls('turn/start').length, 0);
  await sidechat.getByRole('button', { name: 'Close tab', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.yard-source-main').getByText('Remote history on its own host', { exact: true }).waitFor();
  await showSummary();
  await summary.locator('[data-attached-thread-id="' + recoveredId + '"]').click();
  await childEditor.waitFor();
  assert.equal(await childEditor.textContent(), 'Recover the remote queued draft');
  const recoveredFile = new URL((await sidechat.locator('.yard-source-composer .yard-source-attachment-download').getAttribute('href'))!, app.url);
  assert.equal(recoveredFile.searchParams.get('hostId'), hostId);
  assert.equal(recoveredFile.searchParams.get('path'), join(remoteDir, 'nested/detail.txt'));
  assert.equal(remote.calls('turn/start').length, 4, 'a rejected transfer restores the draft without replaying it');
  await sidechat.getByRole('button', { name: 'Close tab', exact: true }).click();
  report.checks.push('Queued SSH messages transfer once; an explicit rejection preserves the remote draft and attachments across reload');

  await localRow.click();
  const completed = fixtureTurn('active-turn', [], 'completed');
  remote.threads.get(threadId)!.status = { type: 'idle' };
  remote.broadcast({ method: 'turn/completed', params: { threadId, turn: completed } });
  remote.broadcast({ method: 'thread/status/changed', params: { threadId, status: { type: 'idle' } } });

  const actions = page.getByRole('menu', { name: 'Chat actions' });
  await remoteRow.press('Shift+F10');
  await actions.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Chat title', exact: true });
  const changed = 'Renamed on the remote host';
  await title.fill(changed);
  await title.press('Enter');
  const updated = projects.getByRole('button', { name: changed, exact: true });
  await updated.waitFor();
  assert.ok(remote.calls('thread/name/set').some(call => call.params.threadId === threadId && call.params.name === changed));
  assert.deepEqual(local.calls('thread/name/set'), []);
  assert.equal(local.threads.get(threadId)!.name, 'Local thread');
  await updated.press('Shift+F10');
  await actions.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  const pinned = sidebar.getByRole('button', { name: changed, exact: true });
  await updated.waitFor({ state: 'hidden' });
  await pinned.waitFor();
  assert.equal(await pinned.count(), 1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await pinned.waitFor();
  assert.equal(await updated.count(), 0);
  await pinned.press('Shift+F10');
  await actions.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
  await updated.waitFor();
  await updated.press('Shift+F10');
  await actions.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await updated.waitFor({ state: 'hidden' });
  assert.equal(await pinned.count(), 0);
  assert.ok(remote.archived.has(threadId));
  assert.ok(!local.archived.has(threadId));
  assert.deepEqual(local.calls('thread/archive'), []);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await localRow.waitFor();
  await sidebar.getByRole('button', { name: project.label, exact: true }).waitFor();
  assert.equal(await pinned.count(), 0);
  report.checks.push('Remote project history, rename, durable pin and unpin, and archive do not write to the local thread with the same ID');
  assert.deepEqual(report.errors, []);
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: join(output, 'error.png') });
    await writeFile(join(output, 'error.aria.txt'), await page.locator('body').ariaSnapshot());
  }
  await writeFile(join(output, 'sidebar-reads.json'), JSON.stringify({ local: local.calls('thread/list').slice(-12),
    remote: remote.calls('thread/list').slice(-12) }, null, 2));
  throw error;
} finally {
  allowRemote();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await app?.close();
  await remote.close();
  await local.close();
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
