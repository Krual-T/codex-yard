import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { remoteFileCommand } from '../src/native/files.ts';
import { loadHostCatalog } from '../src/native/hosts.ts';
import { createSshProxyStream } from '../src/native/ssh.ts';
import type { HostMessage, ObjectValue } from '../src/native/protocol.ts';
import { record } from '../src/native/protocol.ts';

// Run the ENTIRE process under /tmp/agents-workbench-heavy.lock. No Agent turn,
// App/daemon lifecycle, existing project mutation or personal browser is used.
// AGENTS_FILES_EVIDENCE must point at an archive that survives worktree cleanup.
const output = process.env.AGENTS_FILES_EVIDENCE;
const focused = process.argv.includes('--errors-and-uploads');
if (!output) throw new Error('Set AGENTS_FILES_EVIDENCE to the retained evidence directory');
await mkdir(output, { recursive: true });
const root = await mkdtemp('/tmp/aw-files-live-');
const dataDir = join(root, 'data'), codexHome = join(homedir(), '.codex');
await mkdir(dataDir);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
const catalog = await loadHostCatalog(codexHome);
const connections: CodexConnection[] = [];
const fixtures: { hostId: string; path: string; name: string; text: string }[] = [];
const attachments: { connection: CodexConnection; path: string }[] = [];
const results: ObjectValue[] = [];
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, browser: Browser | undefined;

async function hostFetch(page: Page, endpoint: string, params: ObjectValue) {
  return page.evaluate(async ({ endpoint, params }) => {
    const requestId = crypto.randomUUID();
    return new Promise<HostMessage>((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('file host response timed out')); }, 25000);
      function listener(event: MessageEvent<HostMessage>) {
        if (event.data?.requestId === requestId && event.data.type === 'fetch-response') {
          clearTimeout(timer); window.removeEventListener('message', listener); resolve(event.data);
        }
      }
      window.addEventListener('message', listener);
      void (window as unknown as { electronBridge: { sendMessageFromView(message: HostMessage): Promise<void> } }).electronBridge.sendMessageFromView({
        type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params),
      }).catch(reject);
    });
  }, { endpoint, params });
}

async function hostRpc(page: Page, hostId: string, method: string, params: ObjectValue) {
  const reply = await page.evaluate(async ({ hostId, method, params }) => {
    const id = crypto.randomUUID();
    return new Promise<HostMessage>((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('file RPC timed out')); }, 25000);
      function listener(event: MessageEvent<HostMessage>) {
        if (event.data?.type === 'mcp-response' && event.data.hostId === hostId && (event.data.message as { id?: string })?.id === id) {
          clearTimeout(timer); window.removeEventListener('message', listener); resolve(event.data);
        }
      }
      window.addEventListener('message', listener);
      void (window as unknown as { electronBridge: { sendMessageFromView(message: HostMessage): Promise<void> } }).electronBridge.sendMessageFromView({
        type: 'mcp-request', hostId, request: { id, method, params },
      }).catch(reject);
    });
  }, { hostId, method, params });
  const message = record(reply.message);
  assert.equal(message.error, undefined, JSON.stringify(message.error));
  return record(message.result);
}

try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=', 'base64');
  for (const [index, host] of [undefined, ...catalog.hosts].entries()) {
    const hostId = host?.hostId ?? 'local';
    const connection = new CodexConnection(host ? '' : join(codexHome, 'app-server-control', 'app-server-control.sock'), host
      ? { createConnection: () => createSshProxyStream(host), connectTimeout: 20000, timeout: 12000 } : { timeout: 12000 });
    connections.push(connection);
    await connection.connect();
    const path = host ? (await remoteFileCommand(host, 'mktemp -d /tmp/aw-files-XXXXXX', 200, AbortSignal.timeout(15000))).toString().trim() : join(root, 'workspace');
    if (!host) await mkdir(path);
    const fixture: typeof fixtures[number] = { hostId, path, name: 'Files-' + index, text: `FILES_${index}_中文\n` }; fixtures.push(fixture);
    const directory = path + '/空目录';
    await connection.request('fs/createDirectory', { path: directory, recursive: false }, { mutating: true });
    await assert.rejects(connection.request('fs/createDirectory', { path: directory, recursive: false }, { mutating: true }));
    for (const [name, data] of [['中文.txt', Buffer.from(fixture.text)], ['image.png', png], ['removed.txt', Buffer.from('Removed after the tree loads')]] as const) {
      await connection.request('fs/writeFile', { path: path + '/' + name, dataBase64: data.toString('base64') }, { mutating: true });
      assert.equal((await connection.request<{ dataBase64: string }>('fs/readFile', { path: path + '/' + name })).dataBase64, data.toString('base64'));
    }
    const info = record(await connection.request('fs/getMetadata', { path: path + '/中文.txt' }));
    assert.equal(info.isFile, true); assert.equal(info.size, undefined); assert.equal(info.sizeBytes, undefined);
    assert.equal((await connection.request<{ entries: unknown[] }>('fs/readDirectory', { path })).entries.length, 4);
    results.push({ hostId, server: connection.server, wireChecks: ['getMetadata', 'readDirectory', 'readFile text/image', 'writeFile text/image', 'createDirectory recursive:false refuses existing'] });
    console.log('Verified fs protocol:', hostId);
  }
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ path: fixtures[0]!.path, name: fixtures[0]!.name }]));
  const projects = fixtures.slice(1).map(fixture => ({ hostId: fixture.hostId, id: fixture.name, remotePath: fixture.path, label: fixture.name }));
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {
    'remote-connection-auto-connect-by-host-id': Object.fromEntries(catalog.hosts.map(host => [host.hostId, true])),
  } }));
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: fixtures[0]!.path,
    hostCatalog: { ...catalog, projects, assignments: {} } });
  browser = await chromium.launch({ headless: true, executablePath: process.env.AGENTS_TEST_CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const keepModel = page.getByRole('button', { name: '继续使用当前模型', exact: true });
  await page.addLocatorHandler(keepModel, button => button.click());
  page.setDefaultTimeout(60000);
  const fileTraffic: HostMessage[] = [], workerResponses: HostMessage[] = [];
  page.on('websocket', socket => {
    socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload)) as HostMessage;
      if (message.type === 'worker-request' && (String(message.request?.id).startsWith('files-contract-') || fixtures.some(fixture => record(message.request?.params).cwd === fixture.path)) ||
        message.type === 'fetch' && /(?:directory-entries|read-file|workspace-files)/.test(String(message.url))) fileTraffic.push(message);
    });
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload)) as HostMessage;
      if (message.type === 'worker-response' && fileTraffic.some(request => request.workerId === message.workerId && request.request?.id === record(message.response).id)) workerResponses.push(message);
    });
  });
  await page.goto(app.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('button', { name: '在 Files-0 中开始新聊天', exact: true }).waitFor({ timeout: 90000 });
  for (const [index, fixture] of fixtures.entries()) {
    await page.goto(app.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    // The project's hover action overlaps the sidebar resizer in this viewport.
    // Dispatch to that original React button so its project context is selected.
    await page.getByRole('button', { name: `在 ${fixture.name} 中开始新聊天`, exact: true }).dispatchEvent('click');
    await page.locator('[contenteditable="true"]').first().waitFor();
    if (await keepModel.isVisible()) await keepModel.click();
    console.log('Selected project:', fixture.hostId);
    const params = { hostId: fixture.hostId, path: fixture.path + '/中文.txt' };
    const checks: string[] = [];
    const result = results[index]!; result.publicChecks = checks; result.fileTraffic = fileTraffic; result.workerResponses = workerResponses;
    if (!focused) {
    assert.equal((await hostFetch(page, 'read-file', params)).responseType, 'success');
    assert.deepEqual((await hostFetch(page, 'workspace-files', { ...params, operation: 'read', representation: 'text' })).body, { text: fixture.text });
    assert.equal((await hostFetch(page, 'read-file-binary', { hostId: fixture.hostId, path: fixture.path + '/image.png' })).responseType, 'success');
    assert.equal((await hostFetch(page, 'read-file', { ...params, path: fixture.path + '/missing' })).responseType, 'error');
    assert.equal((await hostFetch(page, 'workspace-directory-entries', { hostId: fixture.hostId, workspaceRoot: fixture.path, directoryPath: '..' })).responseType, 'error');
    checks.push('public text/image/missing/traversal');
    const download = page.waitForEvent('download');
    const saved = await hostFetch(page, 'save-file', { hostId: fixture.hostId, sourcePath: params.path, suggestedFilename: fixture.name + '.txt' });
    assert.equal(saved.responseType, 'success');
    const actual = await download; assert.equal(await readFile((await actual.path())!, 'utf8'), fixture.text);
    assert.equal((await hostFetch(page, 'save-file', { hostId: fixture.hostId, sourcePath: fixture.path + '/missing' })).responseType, 'error');
    checks.push('browser download bytes and failed save-file');
    console.log('Verified public read/download:', fixture.hostId);
    }
    const newTab = page.getByRole('button', { name: /^新(?:建)?标签页$/ }).first();
    const sidePanel = page.getByRole('button', { name: '切换侧边面板', exact: true });
    // The toolbar mounts after the composer. Wait for an actual control before
    // deciding whether the panel needs opening; the model dialog is handled above.
    await newTab.or(sidePanel).first().waitFor({ timeout: 20000 });
    if (!await newTab.isVisible()) {
      await sidePanel.click();
    }
    await newTab.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^文件/ }).click({ timeout: 10000 });
    await page.screenshot({ path: join(output, index + '-opening.png') });
    const textFile = page.locator('button[aria-label="中文.txt"]');
    await textFile.waitFor({ timeout: 15000 });
    await page.screenshot({ path: join(output, index + '-tree.png') });
    // Verify the two official worker bridge signatures independently of the
    // preview, including callback delivery and matching request id/method.
    const workerId = 'files-contract-' + index;
    const bridgeReply = await page.evaluate(async id => {
      const bridge = (window as unknown as { electronBridge: {
        sendWorkerMessageFromView(workerId: string, message: HostMessage): Promise<void>;
        subscribeToWorkerMessages(workerId: string, callback: (message: HostMessage) => void): () => void;
      } }).electronBridge;
      return new Promise<HostMessage>((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error('worker callback not delivered')); }, 5000);
        const off = bridge.subscribeToWorkerMessages('git', message => {
          if ((message.response as { id?: string })?.id === id) { clearTimeout(timer); off(); resolve(message); }
        });
        void bridge.sendWorkerMessageFromView('git', { type: 'worker-request', request: { id, method: 'stable-metadata', params: {} } }).catch(reject);
      });
    }, workerId);
    assert.equal(record(record(bridgeReply.response).result).type, 'error');
    assert.ok(fileTraffic.some(message => message.workerId === 'git' && message.request?.id === workerId));
    assert.ok(workerResponses.some(message => record(message.response).id === workerId));
    checks.push('worker request leaves browser; error reaches subscribed callback');
    if (!focused) {
    await textFile.click();
    await page.getByText(fixture.text.trim(), { exact: false }).filter({ visible: true }).first().waitFor();
    await page.screenshot({ path: join(output, index + '-text.png') });
    checks.push('official React tree and text preview');
    await page.locator('button[aria-label="image.png"]').click();
    await page.waitForFunction(() => [...document.images].some(img => img.naturalWidth === 1 && img.naturalHeight === 1));
    await page.screenshot({ path: join(output, index + '-image.png') });
    checks.push('official React image preview');
    }
    await connections[index]!.request('fs/remove', { path: fixture.path + '/removed.txt', force: true }, { mutating: true });
    await page.locator('button[aria-label="removed.txt"]').click();
    await page.getByText(/(?:无法|失败|不存在|No such file|os error 2)/).filter({ visible: true }).first().waitFor({ timeout: 20000 });
    const previewRequest = fileTraffic.find(message => message.request?.method === 'stable-metadata' && record(message.request.params).cwd === fixture.path);
    assert.ok(previewRequest, 'original preview emitted its Git metadata request');
    assert.ok(workerResponses.some(message => record(message.response).id === previewRequest.request?.id && record(record(message.response).result).type === 'error'));
    await page.screenshot({ path: join(output, index + '-error.png') });
    checks.push('official React missing-file error');
    // The real picker owns the user gesture and uploads via the private dataDir.
    const choice = page.waitForEvent('filechooser');
    const picked = hostFetch(page, 'pick-file', { imagesOnly: true });
    await (await choice).setFiles({ name: 'picked.png', mimeType: 'image/png', buffer: png });
    const reply = await picked; assert.equal(reply.responseType, 'success');
    const file = (reply.body as { file: { path: string } }).file;
    assert.deepEqual(await readFile(file.path), png);
    checks.push('browser image picker and daemon upload');
    if (fixture.hostId !== 'local') {
      const connection = connections[index]!;
      const home = connection.server?.codexHome;
      assert.equal(typeof home, 'string');
      const path = home + '/attachments/' + randomUUID();
      attachments.push({ connection, path });
      await hostRpc(page, fixture.hostId, 'fs/createDirectory', { path, recursive: true });
      const uploaded = await hostRpc(page, 'local', 'fs/readFile', { path: file.path });
      await hostRpc(page, fixture.hostId, 'fs/writeFile', { path: path + '/picked.png', dataBase64: uploaded.dataBase64 });
      assert.equal((await connection.request<{ dataBase64: string }>('fs/readFile', { path: path + '/picked.png' })).dataBase64, png.toString('base64'));
      checks.push('public RPC attachment copy to selected SSH daemon');
    }
    console.log('Verified public file flows:', fixture.hostId);
    await page.getByRole('button', { name: '关闭removed.txt标签页', exact: true }).click();
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, results }, null, 2));
} catch (error) {
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: false, error: String(error), results }, null, 2));
  if (browser) for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await writeFile(join(output, 'failure-' + index + '-before.txt'), await page.locator('body').innerText().catch(() => ''));
    await page.screenshot({ path: join(output, 'failure-' + index + '.png') }).catch(() => {});
    await writeFile(join(output, 'failure-' + index + '.txt'), await page.locator('body').innerText().catch(() => ''));
    await writeFile(join(output, 'failure-' + index + '-controls.json'), JSON.stringify(await page.locator('button').evaluateAll(elements => elements.map(el => ({ text: el.textContent, aria: el.getAttribute('aria-label'), title: el.getAttribute('title') }))), null, 2));
    await writeFile(join(output, 'failure-' + index + '-file.html'), await page.locator('button[aria-label="中文.txt"]').first().evaluate(el => {
      let node: Element | null = el; const parents: string[] = [];
      while (node) { parents.push(node.outerHTML.slice(0, node.outerHTML.indexOf('>') + 1)); node = node.parentElement; }
      return parents.join('\n');
    }, undefined, { timeout: 1000 }).catch(String));
  }
  throw error;
} finally {
  await browser?.close(); await app?.close();
  for (const attachment of attachments) await attachment.connection.request('fs/remove', { path: attachment.path, recursive: true, force: true }, { mutating: true }).catch(error => console.error('Attachment cleanup failed:', attachment.path, String(error)));
  for (const [index, fixture] of fixtures.entries()) {
    if (fixture.hostId !== 'local') await connections[index]!.request('fs/remove', { path: fixture.path, recursive: true, force: true }, { mutating: true }).catch(error => console.error('Fixture cleanup failed:', fixture.path, String(error)));
  }
  for (const connection of connections) connection.close();
  await rm(root, { recursive: true, force: true });
}
