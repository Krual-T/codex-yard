import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { loadHostCatalog } from '../src/native/hosts.ts';
import { createSshProxyStream } from '../src/native/ssh.ts';
import type { ObjectValue } from '../src/native/protocol.ts';

// Build first, then hold /tmp/agents-workbench-heavy.lock for this entire process.
// Uses a private dataDir/port/profile. It attaches to existing daemons only.
// --ssh additionally exercises one disposable conversation on each registered host.
// AGENTS_TEST_BASELINE_HOST can point to a saved pre-fix native-host.js to verify
// the original trusted-paste failure; this mode does not submit image turns.
// AGENTS_TEST_CHROMIUM and AGENTS_TEST_CONFIGURATION_SNAPSHOT are optional paths.
// AGENTS_TEST_MODEL selects an available fixture model without changing host configuration.
const project = resolve(import.meta.dirname, '..');
const dataDir = await mkdtemp('/tmp/aw-clipboard-ui-');
const output = join(project, '.local', 'clipboard-evidence', String(Date.now()));
await mkdir(output, { recursive: true });
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const catalog = await loadHostCatalog(codexHome);
const onlyHost = process.argv.find(value => value.startsWith('--host='))?.slice('--host='.length);
const targets = [{ hostId: 'local', cwd: dataDir, projectId: dataDir },
  ...(process.argv.includes('--ssh') ? catalog.hosts.flatMap(host => {
    const item = catalog.projects.find(item => item.hostId === host.hostId);
    return item ? [{ hostId: host.hostId, cwd: item.remotePath, projectId: item.id }] : [];
  }) : [])].filter(target => !onlyHost || target.hostId === onlyHost);
assert.ok(targets.length, 'No matching clipboard test host');
const fixtures: { hostId: string; cwd: string; projectId: string; threadId: string; connection: CodexConnection }[] = [];
const results: ObjectValue[] = [];
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let passed = false;

async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(150); }
  throw new Error('Timed out: ' + label);
}
async function imageCount(page: Page) {
  return page.locator('img').evaluateAll(elements => elements.filter(image => image instanceof HTMLImageElement && image.naturalWidth === 80 && image.naturalHeight === 80).length);
}
async function copyImage(page: Page, color: string) {
  return page.evaluate(async color => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 80, 80);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return canvas.toDataURL();
  }, color);
}

try {
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ path: dataDir, name: 'Clipboard acceptance fixture' }]));
  for (const target of targets) {
    const host = catalog.hosts.find(host => host.hostId === target.hostId);
    const connection = new CodexConnection(host ? '' : join(codexHome, 'app-server-control', 'app-server-control.sock'), host ? {
      createConnection: () => createSshProxyStream(host), connectTimeout: 20000,
    } : {});
    try {
      await connection.connect();
      const { thread } = await connection.request('thread/start', { cwd: target.cwd, approvalPolicy: 'never', sandbox: 'read-only',
        ...(process.env.AGENTS_TEST_MODEL ? { model: process.env.AGENTS_TEST_MODEL } : {}), config: { model_reasoning_effort: 'low' } });
      fixtures.push({ ...target, threadId: thread.id, connection });
      await connection.request('thread/name/set', { threadId: thread.id, name: 'Clipboard acceptance fixture' });
      // A new thread has no persisted rollout until its first turn. Seed only
      // this disposable conversation so the native renderer can resume it.
      await connection.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Reply exactly CLIPBOARD_READY. Do not use any tools.' }] });
      await until(async () => {
        const current = await connection.request('thread/read', { threadId: thread.id, includeTurns: true });
        const failed = current.thread.turns.find(turn => turn.status === 'failed');
        if (failed) throw new Error('Fixture initialization failed: ' + JSON.stringify(failed.error));
        return current.thread.turns.length > 0 && current.thread.turns.every((turn: { status: string }) => turn.status === 'completed');
      }, 'fixture initialization', 120000);
    } catch (error) {
      if (!fixtures.some(fixture => fixture.connection === connection)) connection.close();
      throw error;
    }
  }
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {
    'thread-project-assignments': Object.fromEntries(fixtures.map(f => [f.threadId, f.hostId === 'local'
      ? { projectKind: 'local', projectId: f.projectId }
      : { projectKind: 'remote', projectId: f.projectId, hostId: f.hostId }])),
    'remote-connection-auto-connect-by-host-id': Object.fromEntries(fixtures.filter(f => f.hostId !== 'local').map(f => [f.hostId, true])),
  } }));
  app = await createNativeWorkbench({ dataDir, workspace: dataDir, port: 0 });
  browser = await chromium.launch({ headless: true, ...(process.env.AGENTS_TEST_CHROMIUM ? { executablePath: process.env.AGENTS_TEST_CHROMIUM } : {}) });
  for (const [index, fixture] of fixtures.entries()) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.addLocatorHandler(page.getByRole('button', { name: '继续使用当前模型', exact: true }), async button => { await button.click(); });
    if (process.env.AGENTS_TEST_BASELINE_HOST) {
      const baselineHost = await readFile(process.env.AGENTS_TEST_BASELINE_HOST, 'utf8');
      await page.route('**/native-host.js', route => route.fulfill({ contentType: 'text/javascript', body: baselineHost }));
    }
    const errors: string[] = [], calls: { hostId: string; method: string; params: ObjectValue }[] = [];
    const uploads: { fsPath: string }[] = [];
    const checks: string[] = [];
    const result: ObjectValue = { hostId: fixture.hostId, threadId: fixture.threadId, checks, errors };
    results.push(result);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().includes('/api/files/upload?') && response.ok()) void response.json().then(value => uploads.push(value));
    });
    await page.routeWebSocket('**/native-host', route => {
      const server = route.connectToServer();
      route.onMessage(raw => {
        const m = JSON.parse(String(raw));
        if (m.type === 'mcp-request') calls.push({ hostId: m.hostId ?? 'local', ...m.request });
        server.send(raw);
      });
      server.onMessage(raw => route.send(raw));
    });
    try {
      const url = app.url + '/?initialRoute=' + encodeURIComponent('/local/' + fixture.threadId);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.getByText('CLIPBOARD_READY', { exact: true }).waitFor({ timeout: 60000 });
      const editor = page.locator('.ProseMirror[contenteditable=true]').last();
      await editor.waitFor({ timeout: 60000 });
      await editor.click();
      await page.evaluate(() => {
        (window as unknown as { clipboardPastes: unknown[] }).clipboardPastes = [];
        document.addEventListener('paste', event => {
          const files = [...event.clipboardData!.files];
          const entry = { trusted: event.isTrusted, types: [...event.clipboardData!.types],
            files: files.map(f => ({ type: f.type, size: f.size, dataBase64: '' })) };
          (window as unknown as { clipboardPastes: unknown[] }).clipboardPastes.push(entry);
          void Promise.all(files.map(async (file, index) => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            entry.files[index]!.dataBase64 = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
          }));
        }, true);
      });
      const red = await copyImage(page, '#ff0000');
      await editor.press('Control+V');
      if (process.env.AGENTS_TEST_BASELINE_HOST) {
        await until(() => errors.some(error => error.includes('persistImageFileToTemp')), 'baseline missing AppHost service');
        assert.equal(await imageCount(page), 0);
        result.pastes = await page.evaluate(() => (window as unknown as { clipboardPastes: unknown[] }).clipboardPastes);
        checks.push('baseline trusted Ctrl+V fails before thumbnail because fileAttachments service is absent');
        await page.screenshot({ path: join(output, `${index}-baseline.png`) });
        console.log(JSON.stringify(result));
        continue;
      }
      await until(async () => await imageCount(page) === 1 && uploads.length === 1, 'trusted paste thumbnail and staging upload');
      const pastes = await page.evaluate(() => (window as unknown as { clipboardPastes: { trusted: boolean; files: { dataBase64: string }[] }[] }).clipboardPastes);
      assert.ok(pastes.some(p => p.trusted)); result.pastes = pastes;
      // Chromium can re-encode a PNG when writing the OS clipboard. Fidelity
      // starts at the File delivered by the trusted paste event.
      const pastedBase64 = pastes.find(p => p.trusted)!.files[0]!.dataBase64;
      assert.ok(pastedBase64);
      assert.deepEqual(await readFile(uploads[0]!.fsPath), Buffer.from(pastedBase64, 'base64'));
      checks.push('real browser ClipboardItem write + trusted Ctrl+V; original thumbnail; exact staged PNG bytes');

      let expectedImages = 1;
      if (fixture.hostId === 'local') {
        // Chromium exposes one native ClipboardItem per write. Multiple file
        // items use an explicit DOM fixture, handled by the same native editor.
        await editor.evaluate(element => {
          const data = new DataTransfer();
          for (const color of ['#0000ff', '#00ff00']) {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
            const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 80, 80);
            const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]!), c => c.charCodeAt(0));
            data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
          }
          element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
        });
        await until(async () => await imageCount(page) === 3 && uploads.length === 3, 'multiple image paste');
        assert.equal(new Set(uploads.map(u => u.fsPath)).size, 3);
        await page.evaluate(() => navigator.clipboard.writeText('CLIPBOARD_TEXT_COEXISTENCE '));
        await editor.press('Control+V');
        assert.match(await editor.innerText(), /CLIPBOARD_TEXT_COEXISTENCE/);
        // The official mixed text/image policy prefers non-filename text.
        await editor.evaluate((element, red) => {
          const data = new DataTransfer(); data.setData('text/plain', 'MIXED_TEXT_PRESERVED ');
          const bytes = Uint8Array.from(atob(red.split(',')[1]!), c => c.charCodeAt(0));
          data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
          element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
        }, red);
        assert.match(await editor.innerText(), /MIXED_TEXT_PRESERVED/);
        assert.equal(await imageCount(page), 3);
        checks.push('two images with equal filenames keep distinct attachments; text coexists; native mixed clipboard text preference retained');
        await page.route('**/api/files/uploads', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Clipboard acceptance upload failure' }) }));
        await copyImage(page, '#0000ff');
        await editor.press('Control+V');
        await page.getByText('图片暂存失败', { exact: true }).waitFor();
        await page.getByText('Clipboard acceptance upload failure', { exact: true }).waitFor();
        await until(async () => await imageCount(page) === 4, 'official data URL fallback thumbnail');
        await page.unroute('**/api/files/uploads');
        expectedImages = 4;
        checks.push('upload failure uses original toast and preserves original data URL fallback');
      } else {
        await until(() => calls.some(c => c.hostId === fixture.hostId && c.method === 'fs/writeFile'), 'official SSH attachment transfer');
        const remoteWrite = calls.find(c => c.hostId === fixture.hostId && c.method === 'fs/writeFile')!;
        result.remoteAttachmentPath = remoteWrite.params.path;
        assert.ok(String(remoteWrite.params.path).includes('/attachments/'));
        assert.equal(remoteWrite.params.dataBase64, pastedBase64);
        checks.push('official attachment manager copied exact local bytes to the selected SSH host');
      }
      // Allow the original queued persistence callback to apply localPath.
      await delay(500);
      await editor.fill(`Name the solid colors of the ${expectedImages} attached images in order, using English color names only. Do not call any tools.`);
      await page.screenshot({ path: join(output, `${index}-composer.png`) });
      await editor.press('Enter');
      await until(() => calls.some(c => c.method === 'turn/start'), 'original turn/start payload');
      const sent = calls.find(c => c.method === 'turn/start')!;
      assert.equal(sent.hostId, fixture.hostId);
      const input = sent.params.input as ObjectValue[];
      const images = input.filter(i => i.type === 'image' || i.type === 'localImage');
      assert.equal(images.length, expectedImages);
      if (fixture.hostId === 'local') {
        assert.equal(images.filter(i => i.type === 'localImage').length, 3);
        assert.equal(images.filter(i => i.type === 'image').length, 1);
        for (const image of images.filter(i => i.type === 'localImage')) assert.ok(uploads.some(u => u.fsPath === image.path));
      } else {
        assert.ok(images.every(i => i.type === 'image' && String(i.url).startsWith('data:image/')));
        assert.ok(!JSON.stringify(input).includes(dataDir), 'remote input must never reference Web host staging paths');
      }
      result.input = input;
      let reply = '';
      await until(async () => {
        const response = await fixture.connection.request('thread/read', { threadId: fixture.threadId, includeTurns: true });
        const turns = response.thread.turns as { status: string; items: ObjectValue[] }[];
        reply = (turns.at(-1)?.items ?? []).filter(i => i.type === 'agentMessage').map(i => String(i.text)).join('\n');
        return turns.length > 1 && turns.every(t => t.status === 'completed');
      }, 'model completion', 120000);
      assert.match(reply.toLowerCase(), /red/);
      if (fixture.hostId === 'local') assert.match(reply.toLowerCase(), /blue[\s\S]*green[\s\S]*blue/);
      result.reply = reply;
      checks.push('unmodified official send payload reached model; model recognized fixture colors');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await until(async () => await imageCount(page) >= expectedImages, 'history images after page reload', 60000);
      await page.screenshot({ path: join(output, `${index}-history.png`) });
      checks.push('official history restores all image previews after reload');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ hostId: fixture.hostId, checks, reply }));
    } catch (error) {
      result.failure = String(error);
      await page.screenshot({ path: join(output, `${index}-failure.png`) }).catch(() => {});
      console.error((await page.locator('body').innerText()).slice(-2200));
      throw error;
    } finally { await context.close(); }
  }
  passed = true;
} finally {
  await browser?.close();
  await app?.close();
  for (const fixture of fixtures) {
    try {
      const response = await fixture.connection.request('thread/read', { threadId: fixture.threadId, includeTurns: true });
      for (const turn of response.thread.turns) if (turn.status === 'inProgress') await fixture.connection.request('turn/interrupt', { threadId: fixture.threadId, turnId: turn.id });
      await fixture.connection.request('thread/archive', { threadId: fixture.threadId });
      const attachment = results.find(r => r.threadId === fixture.threadId)?.remoteAttachmentPath;
      if (typeof attachment === 'string') await fixture.connection.request('fs/remove', { path: dirname(attachment), recursive: true, force: true });
    } catch (error) { results.push({ hostId: fixture.hostId, cleanupError: String(error) }); }
    finally { fixture.connection.close(); }
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed, results }, null, 2));
  await rm(dataDir, { recursive: true, force: true });
  console.log(JSON.stringify({ passed, evidence: output }));
}
