// Real CLI + a loopback scripted provider. No personal chats or external model
// requests. Screenshots and optional private Word input stay under .local/.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import type { Page as RpcPage, TurnSummary } from '../lib/codex-protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';

const root = await mkdtemp('/tmp/yard-file-preview-');
const codexHome = join(root, 'codex'), dataDir = join(root, 'data'), files = join(root, 'files');
const output = resolve(process.env.AGENTS_PREVIEW_EVIDENCE ?? '.local/file-previews');
const sshFixture = process.env.AGENTS_PREVIEW_SSH === '1';
const hostId = sshFixture ? 'remote-ssh-discovered:previews' : 'local';
const remoteRoot = join(root, 'remote');
const remoteCommands: string[] = [];
await Promise.all([mkdir(codexHome), mkdir(dataDir), mkdir(files), mkdir(output, { recursive: true })]);
const assets = resolve('vendor/codex-app/26.1013.40934/webview/assets');
// Insert a legal gap before the ZIP central directory to exercise the original
// size regression without committing a large or private document.
function largeZip(input: Buffer) {
  const end = input.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  const directory = input.readUInt32LE(end + 16), padding = 12 * 1024 * 1024;
  const result = Buffer.concat([input.subarray(0, directory), Buffer.alloc(padding), input.subarray(directory)]);
  result.writeUInt32LE(directory + padding, end + padding + 16);
  return result;
}
function pdf() {
  let document = '%PDF-1.4\n';
  const stream = 'BT /F1 24 Tf 50 700 Td (PDF_PREVIEW_OK) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(document.length); document += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = document.length;
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return document + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const word = await readFile(join(assets, 'project-brief-e08b85749970.docx'));
const imageDirectory = join(files, '配图');
await mkdir(imageDirectory);
const imagePath = join(imageDirectory, '图片.svg');
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="green"/></svg>';
await Promise.all([
  writeFile(imagePath, image),
  writeFile(join(imageDirectory, '空格 #1%.svg'), image),
  writeFile(join(root, '外部图片.svg'), image),
]);
const markdownImages = [
  ['绝对路径图片', imagePath],
  ['相对路径图片', './配图/图片.svg'],
  ['父目录图片', '../外部图片.svg'],
  ['文件URL图片', pathToFileURL(imagePath).href],
  ['编码路径图片', './配图/' + encodeURIComponent('空格 #1%.svg')],
];
await Promise.all([
  writeFile(join(files, 'Word.docx'), word),
  process.env.AGENTS_PREVIEW_DOCX ? cp(process.env.AGENTS_PREVIEW_DOCX, join(files, '大文档.docx')) : writeFile(join(files, '大文档.docx'), largeZip(word)),
  cp(join(assets, 'project-tracker-12f7a4dcd6be.xlsx'), join(files, 'Excel.xlsx')),
  cp(join(assets, 'design-review-df0c95705aed.pptx'), join(files, 'PowerPoint.pptx')),
  writeFile(join(files, '文档.pdf'), pdf()),
  writeFile(join(files, '页面.html'), '<!doctype html><meta charset="utf-8"><h1>HTML_PREVIEW_OK 中文</h1><button onclick="this.textContent=\'CLICK_OK\'">点击验证</button>'),
  writeFile(join(files, '说明.md'), '# MARKDOWN_PREVIEW_OK 中文\n\n**加粗正文**\n\n| 列 | 值 |\n|---|---|\n| 测试 | 42 |\n\n'
    + markdownImages.map(([label, path]) => `![${label}](${path})`).join('\n\n')
    + '\n\n![引用式图片][fixture-image]\n\n[fixture-image]: ./配图/图片.svg\n'),
  writeFile(join(files, '数据.csv'), 'name,value\nCSV_PREVIEW_OK,42\n'),
]);
if (sshFixture) {
  await mkdir(remoteRoot);
  await cp(files, join(remoteRoot, 'files'), { recursive: true });
  // Distinct image dimensions detect accidental reads from the local host.
  const remoteImage = image.replaceAll('48', '64');
  await Promise.all([
    writeFile(join(remoteRoot, 'files', '配图', '图片.svg'), remoteImage),
    writeFile(join(remoteRoot, 'files', '配图', '空格 #1%.svg'), remoteImage),
    writeFile(join(remoteRoot, '外部图片.svg'), remoteImage),
    writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: { 'remote-connection-auto-connect-by-host-id': { [hostId]: true } } })),
  ]);
}
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
const names = ['Word.docx', '大文档.docx', 'Excel.xlsx', 'PowerPoint.pptx', '文档.pdf', '页面.html', '说明.md', '数据.csv'];
const answer = '文件预览验收\n\n' + names.map(name => `[${name}](${join(files, name)})`).join('\n\n');
const provider = createServer(async (request, response) => {
  for await (const _chunk of request) { /* Consume the scripted fixture request. */ }
  const id = 'preview-response', item = { id: 'preview-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer, annotations: [] }] };
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
const port = (provider.address() as import('node:net').AddressInfo).port;
await writeFile(join(codexHome, 'config.toml'), `model = "gpt-5.2-codex"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "Preview fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\ncode_mode = false\n`);
const socketPath = join(root, 'backend.sock');
const child = spawn(process.env.AGENTS_TEST_CODEX_BIN ?? 'codex', ['app-server', '--listen', 'unix://' + socketPath], { env: { PATH: process.env.PATH, CODEX_HOME: codexHome, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
let backendLog = ''; child.stdout.on('data', chunk => { backendLog += chunk; }); child.stderr.on('data', chunk => { backendLog += chunk; });
let startupError: Error | undefined; child.on('error', error => { startupError = error; });
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined, browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', hostId, checks, errors };
async function waitUntil(read: () => Promise<boolean>) {
  const until = Date.now() + 60000;
  while (Date.now() < until) { if (await read()) return; await delay(100); }
  throw new Error('Preview fixture timed out');
}
try {
  if (process.env.AGENTS_TEST_MASKED_APP) { assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []); report.desktopInstallationUnavailable = true; }
  await waitUntil(async () => { if (startupError) throw startupError; try { await access(socketPath); return true; } catch { if (child.exitCode != null) throw new Error(backendLog); return false; } });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: files, socketPath, codexHome,
    hostCatalog: { hosts: sshFixture ? [{ hostId, displayName: 'Preview SSH fixture', sshAlias: 'preview-fixture', sshHost: 'preview-fixture', sshPort: null, identity: null }] : [], projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: root, codexHome }); return createConnection(socketPath); },
    remoteFileCommand: async (host, command, maxBytes, signal) => {
      assert.equal(host.hostId, hostId); remoteCommands.push(command);
      return (await promisify(execFile)('/bin/sh', ['-c', command.replaceAll(root, remoteRoot)], { encoding: 'buffer', maxBuffer: maxBytes + 1, signal })).stdout;
    },
    httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  report.cli = app.control.server?.userAgent;
  const { thread } = await app.control.request('thread/start', { cwd: files });
  await app.control.request('thread/name/set', { threadId: thread.id, name: '文件预览验收' });
  await app.control.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Show the preview fixture files.' }] }, { mutating: true });
  await waitUntil(async () => (await app!.control.request<RpcPage<TurnSummary>>('thread/turns/list', { threadId: thread.id, itemsView: 'full' })).data.some(turn => turn.status === 'completed'));
  browser = process.env.AGENTS_TEST_BROWSER_WS ? await chromium.connect(process.env.AGENTS_TEST_BROWSER_WS)
    : await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByRole('button', { name: '继续使用当前模型', exact: true }), async button => { await button.click(); });
  const route = app.url + '/?initialRoute=' + encodeURIComponent('/local/' + thread.id + (sshFixture ? '?hostId=' + hostId : ''));
  const openChat = async () => {
    await page!.goto(route, { waitUntil: 'domcontentloaded' });
    const tab = page!.getByRole('tab', { name: /文件预览验收/ }).first();
    await tab.waitFor({ timeout: 60000 }); await tab.click();
  };
  await openChat();
  const selected = process.argv.slice(2);
  for (const [index, name] of (selected.length ? selected : names).entries()) {
    const card = page.getByRole('button', { name: '打开 ' + name, exact: true }).first();
    // Only the first three artifacts appear as cards; later files remain
    // available as the original output-panel buttons.
    const link = /\.(html|md|csv)$/.test(name) ? page.getByText(name, { exact: true }).first() : await card.isVisible() ? card : page.getByRole('button', { name, exact: true }).last();
    await link.waitFor({ timeout: 60000 }); await link.click();
    if (name.endsWith('.docx')) {
      const text = name === '大文档.docx' ? process.env.AGENTS_PREVIEW_DOCX_TEXT ?? 'Project Brief' : 'Project Brief';
      await page.getByText(text, { exact: false }).last().waitFor({ timeout: 60000 });
      await page.waitForFunction(() => [...document.images].filter(image => image.src.startsWith('blob:') || image.src.startsWith('data:')).every(image => image.complete && image.naturalWidth > 0));
      const images: { complete: boolean; width: number }[] = await page.evaluate(() => [...document.images].filter(image => image.src.startsWith('blob:') || image.src.startsWith('data:')).map(image => ({ complete: image.complete, width: image.naturalWidth })));
      assert.ok(images.every(image => image.complete && image.width > 0));
      checks.push(name + ': document text and ' + images.length + ' embedded images render');
    } else if (name === '页面.html') {
      const frame = page.frameLocator('iframe[title="页面.html"]');
      await frame.getByRole('heading', { name: 'HTML_PREVIEW_OK 中文' }).waitFor();
      await frame.getByRole('button', { name: '点击验证' }).click();
      await frame.getByRole('button', { name: 'CLICK_OK' }).waitFor();
      assert.equal(await frame.locator('body').evaluate(() => { try { return !!parent.document; } catch { return false; } }), false);
      await page.getByRole('button', { name: '源码', exact: true }).click();
      await page.locator('[data-pierre-editor-surface]').waitFor();
      await page.getByRole('button', { name: '预览', exact: true }).click();
      await frame.getByRole('heading').waitFor();
      checks.push('HTML renders, executes its button, switches to source and cannot access the parent document');
    } else if (name.endsWith('.md')) {
      // The upstream rich-text preview marks its DOM as a textbox, so its
      // rendered heading and table cells are not exposed as ARIA roles.
      await page.getByText('MARKDOWN_PREVIEW_OK 中文', { exact: true }).waitFor();
      await page.getByText('加粗正文', { exact: true }).waitFor();
      await page.getByText('测试', { exact: true }).waitFor();
      checks.push('Markdown renders its heading, bold text and table');
      report.markdownRoute = page.url();
      for (const label of [...markdownImages.map(([label]) => label), '引用式图片']) {
        const rendered = page.getByRole('img', { name: label, exact: true });
        await rendered.scrollIntoViewIfNeeded();
        await rendered.evaluate(image => (image as HTMLImageElement).decode());
        assert.equal(await rendered.evaluate(image => (image as HTMLImageElement).naturalWidth), sshFixture ? 64 : 48, label);
        assert.equal(new URL(await rendered.getAttribute('src') ?? '', app.url).searchParams.get('hostId'), hostId, label);
      }
      checks.push('Markdown absolute, relative, parent, file URL, encoded and reference images load');
      if (sshFixture) { assert.ok(remoteCommands.length > 0); checks.push('SSH image requests preserve the selected host and render different remote image bytes'); }
    } else if (name.endsWith('.pdf')) {
      await page.getByText('PDF_PREVIEW_OK', { exact: true }).waitFor({ timeout: 60000 });
      checks.push('PDF renders its page and text layer');
    } else if (name.endsWith('.csv')) {
      await page.locator('[data-pierre-editor-surface]').waitFor();
      await page.getByText('CSV_PREVIEW_OK', { exact: false }).waitFor();
      checks.push('CSV renders its source text');
    } else {
      if (name.endsWith('.pptx')) await page.getByRole('navigation', { name: 'Table of contents' }).getByText(/^[1-9][0-9]* slides$/).waitFor({ timeout: 60000 });
      await page.locator('canvas').first().waitFor({ timeout: 60000 });
      await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some(canvas => canvas.width > 200 && canvas.height > 100));
      assert.doesNotMatch(await page.locator('body').innerText(), /Couldn.t load this preview|无法加载此预览/);
      checks.push(name + ': native document canvas renders');
    }
    await page.screenshot({ path: join(output, `${index + 1}-${name}.png`) });
    await writeFile(join(output, `${index + 1}.txt`), await page.locator('body').ariaSnapshot());
    console.log(checks.at(-1));
    await openChat();
  }
  assert.deepEqual(errors, []);
  const download = await fetch(app.url + '/api/files/download?' + new URLSearchParams({ path: join(files, '大文档.docx') }));
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), await readFile(join(files, '大文档.docx')));
  checks.push('Large Word download preserves the original bytes');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error); process.exitCode = 1;
  if (page && !page.isClosed()) { await page.screenshot({ path: join(output, 'failure.png') }); await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot()); }
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'backend.log'), backendLog);
  await browser?.close(); await app?.close();
  if (child.pid) { child.kill('SIGTERM'); if (child.exitCode == null) await once(child, 'exit'); }
  await new Promise<void>(done => provider.close(() => done()));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
