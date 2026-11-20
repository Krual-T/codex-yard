// Disposable source-workspace UI fixture. Run after the normal build/typecheck,
// under /tmp/agents-workbench-heavy.lock; never connects to a real Codex daemon.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import type { ThreadItemSummary } from '../lib/codex-protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { attachedPrompt } from '../src/workspace/composer-input.ts';
import { attachmentUrl } from '../src/workspace/output-types.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';

const evidence = resolve(process.env.AGENTS_IMAGE_EDITOR_EVIDENCE ?? '.local/workspace-image-editor');
const root = await mkdtemp('/tmp/yard-image-editor-');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(evidence, { recursive: true });
await mkdir(join(root, 'codex'));
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Image editor fixture', path: root }]));
await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ settings: { localeOverride: 'en-US' } }));
const fake = await createFakeCodex(root);
type Call = ReturnType<typeof fake.calls>[number];
type Fixture = { id: string; imageIds: readonly [string, string]; answer: string; activeTurn?: string };
type Gate = { promise: Promise<void>; release(): void };
function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>(done => { release = done; });
  return { promise, release };
}
const gates: Gate[] = [];
function held() { const value = gate(); gates.push(value); return value; }
const starts = new Map<string, Gate>();
const steers = new Map<string, Gate>();
const rejected = new Set<string>();
const uncertain = new Set<string>();
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerAccountId: null, status: null, error: null }));
fake.handlers.set('turn/start', async params => {
  await starts.get(String(params.threadId))?.promise;
  if (rejected.has(String(params.threadId))) throw Object.assign(new Error('Fixture image submission rejected'), { code: -32600 });
  if (uncertain.has(String(params.threadId))) {
    fake.defaultResult('turn/start', params);
    throw Object.assign(new Error('Fixture acknowledgement lost after accepting the image edit'), { code: -32001, data: { uncertain: true } });
  }
  return fake.defaultResult('turn/start', params);
});
fake.handlers.set('turn/steer', async params => {
  await steers.get(String(params.threadId))?.promise;
  return fake.defaultResult('turn/steer', params);
});
const files = fileDaemonFixture(path => {
  const suffix = relative(root, path);
  assert.ok(!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('../'), 'fixture file RPC escaped the disposable directory');
  return path;
});
for (const method of ['fs/getMetadata', 'fs/readFile', 'fs/readDirectory', 'fs/createDirectory', 'fs/writeFile']) {
  fake.handlers.set(method, params => files(method, params));
}

const checks: Record<string, unknown> = {};
const screenshots: string[] = [];
const errors: string[] = [];
const report: Record<string, unknown> = { reference: 'Codex App 26.1013.40934', daemon: 'isolated fake 0.169.1',
  sourceWorkspace: true, realDaemonUsed: false, checks, screenshots, errors };
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let activeCase = 'setup';
let passed = false;
let firstBytes: Buffer;
let secondBytes: Buffer;
let secondPath: string;
let upload: { kind: 'reject' | 'hold'; seen: Gate; release: Gate; done: Gate } | undefined;
const backgroundPrompt = 'Remove the background from this image. Keep all foreground subjects unchanged and fully intact, with clean, smooth edges. Make the background transparent.';
const removePrompt = 'Remove the area marked in the second image from the first image';
const ordinaryName = 'ordinary-note.txt';
const ordinaryText = 'An ordinary attachment that must survive immediate image edits.\n';

function composer() { return page!.locator('form[data-codex-composer-root][data-composer-placement="thread"]').last(); }
function editor() { return composer().locator('[data-codex-composer="true"]'); }
function panel() { return page!.locator('.yard-source-image-editor'); }
function transcript() { return page!.getByRole('region', { name: 'Conversation', exact: true, includeHidden: true }); }
function bubble(text: string) { return transcript().locator('.bg-user-message').filter({ hasText: text }); }
function calls(method: string, id: string) { return fake.calls(method).filter(call => call.params.threadId === id); }
function sent(id: string) { return ['turn/start', 'turn/steer', 'thread/queue/add'].flatMap(method => calls(method, id)); }
async function until(predicate: () => boolean | Promise<boolean>, message: string, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(30);
  }
}
async function waitGate(barrier: Gate, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([barrier.promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
async function capture(name: string) {
  await page!.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(evidence, name + '.aria.txt'), await page!.locator('body').ariaSnapshot());
  screenshots.push(name);
}
async function dismissNotices() {
  for (const name of ['Dismiss', 'Dismiss Full access warning for this session']) {
    const button = page!.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}
async function openThread(fixture: Fixture) {
  await page!.goto(app!.url + '/?initialRoute=' + encodeURIComponent('/local/' + fixture.id), { waitUntil: 'commit' });
  await transcript().getByText(fixture.answer, { exact: true }).waitFor({ timeout: 25_000 });
  await editor().waitFor();
  await dismissNotices();
}
async function draft(text: string, ordinary = true) {
  await editor().fill(text);
  if (ordinary) {
    await composer().locator('input[type="file"]').setInputFiles({ name: ordinaryName, mimeType: 'text/plain', buffer: Buffer.from(ordinaryText) });
    await composer().getByRole('link', { name: ordinaryName, exact: true }).waitFor();
  }
  await until(() => composer().locator('.yard-source-send').isEnabled(), 'thread composer or ordinary attachment did not become ready');
}
async function assertDraft(text: string, ordinary = true) {
  assert.equal((await editor().innerText()).trim(), text.trim(), 'image edit changed the existing text draft');
  assert.equal(await composer().getByRole('link', { name: ordinaryName, exact: true }).count(), ordinary ? 1 : 0,
    'image edit changed an ordinary attachment');
}
async function openImage(fixture: Fixture, index = 1) {
  if (index !== 1) await transcript().getByRole('button', { name: 'Show generated image ' + index, exact: true }).click();
  await transcript().getByRole('button', { name: 'Generated image ' + index, exact: true }).click();
  await panel().waitFor();
  await until(async () => await panel().getAttribute('data-active-image') === fixture.imageIds[index - 1], 'wrong image opened in the editor');
  await panel().getByRole('img', { name: 'Generated image ' + index, exact: true }).waitFor();
  await until(async () => (await panel().getByRole('img', { name: 'Generated image ' + index, exact: true }).evaluate(node =>
    (node as HTMLImageElement).naturalWidth)) > 0, 'editor image failed to load');
  assert.equal(await page!.getByRole('button', { name: 'Exit full screen', exact: true }).getAttribute('aria-pressed'), 'true',
    'generated images must open in the expanded right panel');
  assert.equal(await composer().getAttribute('data-image-preview-composer'), '', 'the original composer did not float into the editor');
}
async function mode(name: 'Comment' | 'Remove') {
  await panel().getByRole('button', { name, exact: true }).click();
  await until(async () => await panel().getAttribute('data-mode') === name.toLowerCase(), 'image tool did not open');
}
async function addComment(fixture: Fixture, imageIndex: number, text: string, x: number, y: number) {
  const wrapper = panel().locator('[data-image-id="' + fixture.imageIds[imageIndex - 1] + '"]');
  const surface = wrapper.getByRole('button', { name: 'Image comment surface', exact: true });
  const rect = await surface.boundingBox(); assert.ok(rect, 'comment surface must have image dimensions');
  // Record the browser's actual event coordinates, including subpixel layout.
  await surface.evaluate(element => element.addEventListener('click', event => {
    const box = element.getBoundingClientRect();
    (element as HTMLElement).dataset.fixturePoint = JSON.stringify({ x: ((event as MouseEvent).clientX - box.left) / box.width,
      y: ((event as MouseEvent).clientY - box.top) / box.height });
  }, { capture: true, once: true }));
  await surface.click({ position: { x: rect.width * x, y: rect.height * y } });
  const actual = JSON.parse((await surface.getAttribute('data-fixture-point'))!) as { x: number; y: number };
  await panel().getByRole('textbox', { name: 'Add comment', exact: true }).fill(text);
  await panel().getByRole('button', { name: 'Add comment', exact: true }).click();
  await until(async () => await panel().getAttribute('aria-busy') !== 'true', 'comment attachment remained busy');
  return actual;
}
function point(value: number) {
  // Independent expected text from the pinned mut formatter: one decimal at
  // most, without a forced .0, normalized to the image plane.
  return new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(Math.min(1, Math.max(0, value)));
}
async function waitCall(method: string, id: string) {
  return fake.waitFor(call => call.id != null && call.method === method && call.params.threadId === id, 15_000);
}
function inputOf(call: Call) {
  assert.ok(Array.isArray(call.params.input));
  return call.params.input as Record<string, unknown>[];
}
async function assertInput(call: Call, prompt: string, expected: readonly Buffer[], ordinary = false) {
  const input = inputOf(call);
  assert.equal(input[0]?.type, 'text');
  const parsed = attachedPrompt(String(input[0]?.text));
  assert.equal(parsed.text, prompt, 'daemon received a different image edit prompt');
  assert.deepEqual(parsed.attachments.map(file => file.name), ordinary ? [ordinaryName] : [],
    'generated image edits must not consume an ordinary attachment or list generated images as documents');
  if (ordinary) assert.equal(await readFile(parsed.attachments[0]!.path, 'utf8'), ordinaryText);
  assert.equal(input.length, expected.length + 1);
  for (let index = 0; index < expected.length; index++) {
    assert.equal(input[index + 1]?.type, 'localImage');
    assert.deepEqual(await readFile(String(input[index + 1]!.path)), expected[index], 'image byte order changed at index ' + index);
  }
  if (call.method === 'turn/start') assert.equal(call.params.turnTrigger, 'image_edit');
}
async function observeBubble(text: string, checkThinking = true) {
  await page!.evaluate(({ text, checkThinking }) => {
    const target = window as unknown as { fixtureImageObserver?: MutationObserver;
      fixtureImageProbe?: { maxCount: number; firstSeen: number; orderFailures: string[] } };
    target.fixtureImageObserver?.disconnect();
    const probe = { maxCount: 0, firstSeen: 0, orderFailures: [] as string[] };
    target.fixtureImageProbe = probe;
    const inspect = () => {
      const messages = [...document.querySelectorAll<HTMLElement>('[role="region"][aria-label="Conversation"] .bg-user-message')]
        .filter(node => node.textContent?.includes(text) && node.getClientRects().length);
      probe.maxCount = Math.max(probe.maxCount, messages.length);
      if (messages.length && !probe.firstSeen) probe.firstSeen = Date.now();
      if (!checkThinking) return;
      for (const node of document.querySelectorAll<HTMLElement>('[role="region"][aria-label="Conversation"] *')) {
        if (!/^(Thinking|思考中|正在思考)(?:\.{3}|…)?$/.test(node.textContent?.trim() ?? '') || node.children.length || !node.getClientRects().length) continue;
        if (!messages[0] || !(messages[0].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          probe.orderFailures.push('Thinking appeared ahead of the submitted image-edit message');
        }
      }
    };
    const observer = new MutationObserver(inspect); observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    target.fixtureImageObserver = observer;
  }, { text, checkThinking });
}
async function assertBeforeAck(text: string) {
  await bubble(text).waitFor({ state: 'attached', timeout: 2_000 });
  assert.equal(await bubble(text).count(), 1, 'the optimistic image edit must appear once before daemon acknowledgement');
}
async function assertDeduplicated(text: string) {
  await until(async () => await transcript().locator('[data-preparing-message]').count() === 0, 'canonical acknowledgement did not replace the optimistic message');
  assert.equal(await bubble(text).count(), 1);
  const probe = await page!.evaluate(() => (window as unknown as { fixtureImageProbe: { maxCount: number; firstSeen: number; orderFailures: string[] } }).fixtureImageProbe);
  assert.equal(probe.maxCount, 1, 'acknowledgement briefly rendered duplicate user messages');
  assert.ok(probe.firstSeen > 0);
  assert.deepEqual(probe.orderFailures, []);
  return probe;
}
async function finishStart(fixture: Fixture, text: string, barrier: Gate) {
  barrier.release();
  await until(() => fake.threads.get(fixture.id)!.turns.at(-1)!.id.startsWith('fixture-turn-'), 'turn/start did not complete');
  const thread = fake.threads.get(fixture.id)!, turn = thread.turns.at(-1)!;
  fake.broadcast({ method: 'turn/started', params: { threadId: fixture.id, turn } });
  for (const item of turn.items) for (let duplicate = 0; duplicate < 2; duplicate++) {
    fake.broadcast({ method: 'item/completed', params: { threadId: fixture.id, turnId: turn.id, item } });
  }
  const answerText = 'Image edit acknowledged ' + fixture.id;
  const answer = { ...agentItem('answer-' + turn.id, answerText), phase: 'final_answer' as const };
  turn.items.push(answer); turn.status = 'completed'; thread.status = { type: 'idle' };
  fake.broadcast({ method: 'item/completed', params: { threadId: fixture.id, turnId: turn.id, item: answer } });
  fake.broadcast({ method: 'turn/completed', params: { threadId: fixture.id, turn } });
  await transcript().getByText(answerText, { exact: true }).waitFor({ state: 'attached' });
  return assertDeduplicated(text);
}
async function canvasPixels(canvas: Locator) {
  return canvas.evaluate(node => {
    const target = node as HTMLCanvasElement, pixels = target.getContext('2d')!.getImageData(0, 0, target.width, target.height).data;
    let painted = 0, white = 0, black = 0, transparent = 0, other = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3]! > 0) painted++;
      if (pixels[offset + 3] !== 255) transparent++;
      else if (pixels[offset] === 0 && pixels[offset + 1] === 0 && pixels[offset + 2] === 0) black++;
      else if (pixels[offset] === 255 && pixels[offset + 1] === 255 && pixels[offset + 2] === 255) white++;
      else other++;
    }
    return { width: target.width, height: target.height, painted, white, black, transparent, other };
  });
}

try {
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    sourceWorkspace: true, hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('Offline image-editor fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/files/upload?*', async route => {
    const control = upload;
    if (!control || new URL(route.request().url()).pathname !== '/api/files/upload') { await route.continue(); return; }
    upload = undefined; control.seen.release();
    try {
      if (control.kind === 'hold') { await control.release.promise; const response = await route.fetch(); await route.fulfill({ response }); }
      else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture image upload rejected' }) });
    } finally { control.done.release(); }
  });
  const images = await page.evaluate(() => [[320, 160, '#e65a24', '#1644b9'], [128, 240, '#57a945', '#843aae']].map(([width, height, background, ink]) => {
    const canvas = document.createElement('canvas'); canvas.width = Number(width); canvas.height = Number(height);
    const context = canvas.getContext('2d')!; context.fillStyle = String(background); context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = String(ink); context.fillRect(canvas.width / 4, canvas.height / 4, canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }));
  firstBytes = Buffer.from(images[0]!.split(',')[1]!, 'base64'); secondBytes = Buffer.from(images[1]!.split(',')[1]!, 'base64');
  secondPath = join(root, 'generated tall.png'); await writeFile(secondPath, secondBytes);
  await writeFile(join(evidence, 'fixture-wide.png'), firstBytes); await writeFile(join(evidence, 'fixture-tall.png'), secondBytes);
  let nextThread = 0;
  function fixture(name: string, active = false): Fixture {
    const id = '11111111-2222-4333-8444-' + String(++nextThread).padStart(12, '0');
    const imageIds = [name + '-wide', name + '-tall'] as const, answer = 'Pictures ready for ' + name;
    const generation = (id: string, extra: Record<string, unknown>): ThreadItemSummary => ({ id, type: 'imageGeneration', status: 'completed',
      revisedPrompt: null, generationId: null, failure: null, ...extra });
    const turn = { ...fixtureTurn(name + '-generated-turn', [
      { id: name + '-initial-input', type: 'userMessage', content: [{ type: 'text', text: 'Generate two fixture pictures.', text_elements: [] }] },
      generation(imageIds[0], { result: images[0]!.split(',')[1]! }), generation(imageIds[1], { result: '', savedPath: secondPath }),
      { ...agentItem(name + '-answer', answer), phase: 'final_answer' },
    ]), startedAt: 1_700_000_000, completedAt: 1_700_000_020, durationMs: 20_000 };
    const activeTurn = active ? name + '-active-turn' : undefined;
    fake.threads.set(id, fixtureThread(id, root, { name: 'Canvas ' + name, turns: [turn,
      ...activeTurn ? [fixtureTurn(activeTurn, [agentItem(name + '-progress', 'Active fixture work.')], 'inProgress')] : []],
      status: active ? { type: 'active', activeFlags: [] } : { type: 'idle' } }));
    return { id, imageIds, answer, activeTurn };
  }
  const basic = fixture('basic'), comments = fixture('comments'), background = fixture('background'), resize = fixture('resize'), mask = fixture('mask');
  const steer = fixture('steer', true), queue = fixture('queue', true), sendReject = fixture('send-reject'), uploadReject = fixture('upload-reject');
  const race = fixture('upload-race'), other = fixture('other-thread');
  const visual = fixture('visual'), generation = fixture('generation'), uncertainEdit = fixture('uncertain-edit');
  const railFixture = fixture('thumbnail-navigation');
  const railTurn = fake.threads.get(railFixture.id)!.turns[0]!;
  const extraRailIds = Array.from({ length: 8 }, (_, index) => 'thumbnail-navigation-extra-' + index);
  railTurn.items.splice(railTurn.items.length - 1, 0, ...extraRailIds.map(id => ({ id, type: 'imageGeneration',
    status: 'completed', result: images[0]!.split(',')[1]! })));
  const railIds = [...railFixture.imageIds, ...extraRailIds];
  const menuFixture = fixture('context-menu');
  const menuPath = join(root, 'context menu source.png'); await writeFile(menuPath, firstBytes);
  const menuImageUrl = app.url + attachmentUrl('local', menuPath);
  fake.threads.get(menuFixture.id)!.turns[0]!.items.find(item => item.id === menuFixture.imageIds[0])!.result = menuImageUrl;
  fake.queues.set(queue.id, [{ id: 'existing-queue-item', input: [{ type: 'text', text: 'Existing queued fixture', text_elements: [] }], clientUserMessageId: null }]);

  activeCase = 'basic';
  await openThread(basic); await draft('Preserve this initial draft.');
  const originalEditor = await editor().elementHandle(); assert.ok(originalEditor);
  await openImage(basic, 2); await assertDraft('Preserve this initial draft.');
  const guide = panel().locator('[data-image-canvas-coachmark]');
  await guide.waitFor(); assert.match(await guide.innerText(), /Try Canvas view/);
  assert.match(await guide.innerText(), /Switch between a focused image and all generated images/);
  await capture('00-first-image-view-guide');
  await page.getByRole('button', { name: 'Close Canvas basic tab', exact: true }).click();
  await panel().waitFor({ state: 'detached' });
  await openImage(basic, 2); await guide.waitFor();
  assert.ok(await editor().evaluate((element, original) => element === original, originalEditor), 'closing and reopening the image view remounted its owner Composer');
  assert.ok(await editor().evaluate((element, original) => element === original, originalEditor), 'opening the editor remounted the Composer DOM');
  const composerBox = await composer().boundingBox(), panelBox = await panel().boundingBox();
  assert.ok(composerBox && panelBox);
  assert.ok(Math.abs(composerBox.x + composerBox.width / 2 - panelBox.x - panelBox.width / 2) < 1,
    'the original Composer must be visually centered in the image pane');
  assert.ok(Math.abs(panelBox.y + panelBox.height - composerBox.y - composerBox.height - 16) < 1,
    'the image Composer must keep the native 16px bottom inset');
  const downloadEvent = page.waitForEvent('download'); await panel().getByRole('button', { name: 'Download', exact: true }).click();
  const downloaded = await downloadEvent; assert.deepEqual(await readFile((await downloaded.path())!), secondBytes);
  await panel().getByRole('button', { name: 'Zoom', exact: true }).click();
  await page.getByRole('menu', { name: 'Zoom', exact: true }).getByRole('menuitem', { name: '100%', exact: true }).click();
  assert.match(await panel().getByRole('button', { name: 'Zoom', exact: true }).innerText(), /100%/);
  const zoomSize = await panel().getByRole('img', { name: 'Generated image 2', exact: true }).boundingBox(); assert.ok(zoomSize);
  assert.ok(Math.abs(zoomSize.width - 128) < 1 && Math.abs(zoomSize.height - 240) < 1, '100% zoom must render natural image dimensions');
  await panel().getByRole('button', { name: 'Canvas view', exact: true }).click();
  await guide.waitFor({ state: 'detached' });
  assert.equal(await panel().getAttribute('data-view'), 'canvas');
  assert.equal(await panel().locator('[data-image-id]').count(), 2, 'Canvas must aggregate both generated images');
  await panel().getByRole('button', { name: 'Multi-select', exact: true }).click();
  await panel().locator('[data-image-id="' + basic.imageIds[0] + '"]').getByRole('button', { name: 'Generated image 1', exact: true }).click();
  await until(() => composer().locator('.yard-source-image-attachment').count().then(count => count === 2), 'multi-selection did not attach both generated images');
  await panel().getByRole('button', { name: 'Multi-select', exact: true }).click();
  await until(() => composer().locator('.yard-source-image-attachment').count().then(count => count === 1), 'leaving multi-select did not restore a single selected image');
  await panel().getByRole('button', { name: 'Focused view', exact: true }).click();
  assert.equal(await panel().getAttribute('data-view'), 'focused'); await assertDraft('Preserve this initial draft.');
  await capture('01-focused-and-preserved-composer');
  checks.basic = { downloadBytes: secondBytes.length, zoomSize, composerDomPreserved: true, multiSelect: true };

  activeCase = 'image-context-menu';
  await openThread(menuFixture); await draft('Keep the image menu draft.'); await openImage(menuFixture);
  assert.equal(await panel().locator('[data-image-canvas-coachmark]').count(), 0,
    'choosing a view must persist the guide dismissal after a full page navigation');
  checks.coachmark = { firstUse: true, closingWithoutDismissalPreservesGuide: true, viewSelectionPersistsDismissal: true };
  const actions = page.getByRole('menu', { name: 'Image actions', exact: true });
  const focusedImage = () => panel().locator('img[data-editor-image="' + menuFixture.imageIds[0] + '"]');
  const context = async (target = focusedImage()) => { await target.click({ button: 'right' }); await actions.waitFor(); };
  await context();
  const menuOrder = await actions.getByRole('menuitem').allTextContents();
  assert.deepEqual(menuOrder.filter(label => label !== 'Open in File Manager'),
    ['Open image in new tab', 'Copy image address', 'Add to chat', 'Copy image', 'Download a copy']);
  await actions.getByRole('menuitem', { name: 'Copy image address', exact: true }).click();
  await until(async () => await page!.evaluate(() => navigator.clipboard.readText()) === menuImageUrl,
    'Copy image address did not copy the original HTTP source');
  await context(); await actions.getByRole('menuitem', { name: 'Copy image', exact: true }).click();
  await until(async () => await page!.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png'))),
    'Copy image did not write a PNG ClipboardItem');
  const copiedImage = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const png = items.find(item => item.types.includes('image/png')); if (!png) return null;
    const blob = await png.getType('image/png'), bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
    return { type: blob.type, width: canvas.width, height: canvas.height,
      corner: Array.from(context.getImageData(0, 0, 1, 1).data), center: Array.from(context.getImageData(160, 80, 1, 1).data) };
  });
  assert.deepEqual(copiedImage, { type: 'image/png', width: 320, height: 160, corner: [230, 90, 36, 255], center: [22, 68, 185, 255] });
  await context(); const copyDownload = page.waitForEvent('download');
  await actions.getByRole('menuitem', { name: 'Download a copy', exact: true }).click();
  assert.deepEqual(await readFile((await (await copyDownload).path())!), firstBytes);
  await context(); await actions.getByRole('menuitem', { name: 'Add to chat', exact: true }).click();
  await context(); await actions.getByRole('menuitem', { name: 'Add to chat', exact: true }).click();
  assert.equal(await composer().locator('.yard-source-image-attachment').count(), 1, 'Add to chat duplicated its stable generated attachment');
  await assertDraft('Keep the image menu draft.');
  await context(); await actions.getByRole('menuitem', { name: 'Open image in new tab', exact: true }).click();
  const readOnly = page.locator('.yard-source-image-editor[data-read-only="true"]:visible'); await readOnly.waitFor();
  assert.equal(await readOnly.getByRole('button', { name: 'Remove BG', exact: true }).count(), 0);
  assert.equal(await readOnly.getByRole('button', { name: 'Comment', exact: true }).count(), 0);
  assert.equal(await readOnly.locator('[data-image-canvas-coachmark]').count(), 0);
  await readOnly.getByRole('img', { name: 'Generated image 1', exact: true }).waitFor();
  await capture('06-image-read-only-tab');
  await page.getByRole('button', { name: 'Close Generated image 1 tab', exact: true }).click();
  await panel().locator('[data-editor-image="' + menuFixture.imageIds[0] + '"]').waitFor();
  await assertDraft('Keep the image menu draft.');
  const thumbnail = panel().locator('.yard-image-editor-thumbnails').getByRole('button', { name: 'Generated image 2', exact: true }).locator('img');
  await context(thumbnail);
  assert.equal(await actions.getByRole('menuitem', { name: 'Copy image address', exact: true }).count(), 0,
    'a local saved image must not offer a misleading public image address');
  await page.keyboard.press('Escape');
  await mode('Comment');
  const commentTarget = panel().getByRole('button', { name: 'Image comment surface', exact: true });
  await commentTarget.click({ button: 'right' }); assert.equal(await actions.count(), 0, 'the focused image menu must be blocked while editing');
  await commentTarget.click({ position: { x: 30, y: 25 } });
  const commentInput = panel().getByRole('textbox', { name: 'Add comment', exact: true });
  await commentInput.fill('Preserve native text context menu.'); await commentInput.click({ button: 'right' });
  assert.equal(await actions.count(), 0); await commentInput.press('Escape');
  await panel().getByRole('button', { name: 'Canvas view', exact: true }).click();
  const canvasCard = panel().locator('[data-image-id="' + menuFixture.imageIds[1] + '"]');
  await until(async () => await canvasCard.locator('img[data-editor-image]').evaluate(node =>
    (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0), 'Canvas context image did not become ready');
  await context(canvasCard);
  const canvasDownload = page.waitForEvent('download');
  await actions.getByRole('menuitem', { name: 'Download a copy', exact: true }).click();
  assert.deepEqual(await readFile((await (await canvasDownload).path())!), secondBytes);
  await assertDraft('Keep the image menu draft.');
  checks.contextMenu = { menuOrder, copyAddress: true, clipboardPng: copiedImage, downloadBytes: true, stableAddToChat: true,
    internalReadOnlyTab: true, focusedThumbnailAndCanvas: true, nativeTextContextMenu: true, focusedEditingBlocksMenu: true };

  activeCase = 'thumbnail-navigation';
  await page.setViewportSize({ width: 1440, height: 740 });
  await openThread(railFixture); await draft('Keep the thumbnail navigation draft.', false); await openImage(railFixture);
  const rail = panel().locator('.yard-image-editor-thumbnails');
  const activeImage = async (id: string) => until(async () => await panel().getAttribute('data-active-image') === id,
    'the thumbnail gesture did not select the expected generated image');
  const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => rail.evaluate((node, options) => {
    const event = new WheelEvent('wheel', { ...options, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  }, { deltaY, deltaMode, ctrlKey });
  assert.equal(await rail.getByRole('button').count(), 10);
  assert.equal(await wheel(20), true); assert.equal(await panel().getAttribute('data-active-image'), railIds[0]);
  await wheel(8); await activeImage(railIds[1]!);
  await wheel(4, 1); await activeImage(railIds[2]!);
  const beforeControl = await panel().getAttribute('data-active-image');
  assert.equal(await wheel(600, 0, true), false, 'Ctrl+wheel must remain available to browser zoom');
  assert.equal(await panel().getAttribute('data-active-image'), beforeControl);
  await wheel(99_999); await activeImage(railIds.at(-1)!);
  assert.ok(await rail.evaluate(node => node.scrollTop) > 0, 'selecting an offscreen image must scroll its thumbnail into view');
  const lastThumbnail = rail.getByRole('button').last();
  await lastThumbnail.focus(); await lastThumbnail.press('ArrowDown'); await activeImage(railIds.at(-1)!);
  await lastThumbnail.press('ArrowUp'); await activeImage(railIds.at(-2)!);
  await wheel(-99_999); await activeImage(railIds[0]!);
  const firstThumbnail = rail.getByRole('button').first();
  await firstThumbnail.focus(); await firstThumbnail.press('ArrowLeft'); await activeImage(railIds[0]!);
  await firstThumbnail.press('ArrowRight'); await activeImage(railIds[1]!);
  await wheel(1, 2); await activeImage(railIds.at(-1)!);
  await firstThumbnail.click(); await activeImage(railIds[0]!);
  const railRect = await rail.boundingBox(); assert.ok(railRect);
  await page.mouse.move(railRect.x + railRect.width / 2, railRect.y + 18);
  await page.mouse.wheel(0, 54); await activeImage(railIds[1]!);
  await mode('Comment');
  const commentSurface = panel().getByRole('button', { name: 'Image comment surface', exact: true });
  await commentSurface.click({ position: { x: 20, y: 20 } });
  const unsavedComment = panel().getByRole('textbox', { name: 'Add comment', exact: true });
  await unsavedComment.fill('Preserve this unsaved image comment.');
  assert.equal(await wheel(200), false);
  assert.equal(await panel().getAttribute('data-active-image'), railIds[1]);
  assert.equal(await unsavedComment.inputValue(), 'Preserve this unsaved image comment.');
  await assertDraft('Keep the thumbnail navigation draft.', false);
  await capture('05-thumbnail-navigation');
  checks.railNavigation = { accumulatedPixels: true, lineAndPageUnits: true, nativeWheel: true,
    boundaryAndKeyboard: true, controlWheelUnchanged: true, unsavedCommentPreserved: true };
  await page.setViewportSize({ width: 1440, height: 1000 });

  activeCase = 'empty-editor-layout';
  await page.setViewportSize({ width: 1440, height: 900 });
  await openThread(visual); await openImage(visual, 2);
  const emptyComposer = await composer().boundingBox(); assert.ok(emptyComposer);
  assert.ok(Math.abs(emptyComposer.width - 560) < 1 && Math.abs(emptyComposer.height - 44) < 1,
    'empty image editor must use the native 560 by 44 compact Composer');
  await capture('00-empty-focused');
  checks.emptyLayout = emptyComposer;
  await page.setViewportSize({ width: 1440, height: 1000 });

  activeCase = 'comments';
  await openThread(comments); await draft('  Keep the overall lighting.  '); await openImage(comments); await mode('Comment');
  await addComment(comments, 1, 'Delete this point', .2, .25);
  await panel().getByRole('button', { name: 'Comment 1', exact: true }).click();
  await panel().getByRole('button', { name: 'Delete comment', exact: true }).click();
  assert.equal(await panel().getByRole('button', { name: 'Comment 1', exact: true }).count(), 0);
  const firstPoint = await addComment(comments, 1, 'Keep the blue square.', .25, .4);
  await panel().getByRole('button', { name: 'Canvas view', exact: true }).click();
  if (await panel().getAttribute('data-mode') !== 'comment') await mode('Comment');
  const secondPoint = await addComment(comments, 2, 'Brighten the green area.', .6, .5);
  const commentPrompt = `Image 1:\n1. (x: ${point(firstPoint.x)}, y: ${point(firstPoint.y)}) Keep the blue square.\n\nImage 2:\n1. (x: ${point(secondPoint.x)}, y: ${point(secondPoint.y)}) Brighten the green area.\n\nAdditional instructions:\nKeep the overall lighting.`;
  await capture('02-multi-image-comments');
  const commentGate = held(); starts.set(comments.id, commentGate); await observeBubble(commentPrompt);
  await composer().getByRole('button', { name: 'Send message', exact: true }).click();
  const commentCall = await waitCall('turn/start', comments.id); await assertBeforeAck(commentPrompt);
  await assertInput(commentCall, commentPrompt, [firstBytes, secondBytes], true);
  const commentProbe = await finishStart(comments, commentPrompt, commentGate);
  checks.comments = { prompt: commentPrompt, points: [firstPoint, secondPoint], beforeAckAndDedup: commentProbe, params: commentCall.params };

  for (const [name, target, prompt] of [['remove-background', background, backgroundPrompt], ['resize', resize, 'Make the aspect ratio 16:9']] as const) {
    activeCase = name; const text = 'Preserve the ' + name + ' draft.';
    await openThread(target); await draft(text); await openImage(target, 2);
    const barrier = held(); starts.set(target.id, barrier); await observeBubble(prompt);
    if (name === 'resize') {
      await panel().getByRole('button', { name: 'Resize', exact: true }).click();
      await page.getByRole('menu', { name: 'Resize', exact: true }).getByRole('menuitem', { name: 'Widescreen 16:9', exact: true }).click();
    } else await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
    const call = await waitCall('turn/start', target.id); await assertBeforeAck(prompt); await assertInput(call, prompt, [secondBytes]);
    await assertDraft(text); const probe = await finishStart(target, prompt, barrier); await assertDraft(text);
    checks[name] = { params: call.params, preservedDraft: true, beforeAckAndDedup: probe };
  }

  activeCase = 'mask';
  await openThread(mask); await draft('Preserve the brush draft.'); await openImage(mask); await mode('Remove');
  const brush = panel().getByRole('slider', { name: 'Brush size', exact: true });
  assert.equal(await brush.getAttribute('min'), '5'); assert.equal(await brush.getAttribute('max'), '130');
  await brush.focus(); await brush.press('Home'); for (let step = 0; step < 15; step++) await brush.press('ArrowRight');
  const maskCanvas = panel().locator('canvas[aria-label="Remove mask"]');
  const brushBox = await maskCanvas.boundingBox(); assert.ok(brushBox);
  const stroke = async (x: number, y: number) => {
    await page!.mouse.move(brushBox.x + brushBox.width * x, brushBox.y + brushBox.height * y); await page!.mouse.down();
    await page!.mouse.move(brushBox.x + brushBox.width * (x + .2), brushBox.y + brushBox.height * (y + .15), { steps: 12 }); await page!.mouse.up();
  };
  await stroke(.2, .2); const oneStroke = await canvasPixels(maskCanvas);
  await stroke(.6, .6); const twoStrokes = await canvasPixels(maskCanvas); assert.ok(twoStrokes.painted > oneStroke.painted);
  await panel().getByRole('button', { name: 'Undo', exact: true }).click();
  await until(async () => (await canvasPixels(maskCanvas)).painted === oneStroke.painted, 'Undo did not restore the preceding brush stroke');
  await panel().getByRole('button', { name: 'Redo', exact: true }).click();
  await until(async () => (await canvasPixels(maskCanvas)).painted === twoStrokes.painted, 'Redo did not restore the brush mask');
  await capture('03-remove-brush');
  const maskGate = held(); starts.set(mask.id, maskGate); await observeBubble(removePrompt);
  await panel().getByRole('button', { name: 'Send edits', exact: true }).click();
  const maskCall = await waitCall('turn/start', mask.id); await assertBeforeAck(removePrompt);
  const maskInput = inputOf(maskCall); assert.equal(maskInput.length, 3);
  assert.equal(attachedPrompt(String(maskInput[0]!.text)).text, removePrompt);
  assert.equal(maskInput[1]!.type, 'localImage'); assert.equal(maskInput[2]!.type, 'localImage');
  assert.deepEqual(await readFile(String(maskInput[1]!.path)), firstBytes, 'the first removal attachment must be the original image');
  const maskBytes = await readFile(String(maskInput[2]!.path)); await writeFile(join(evidence, 'submitted-selection-mask.png'), maskBytes);
  const exported = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0, white = 0, transparent = 0, other = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] !== 255) transparent++;
      else if (pixels[index] === 0 && pixels[index + 1] === 0 && pixels[index + 2] === 0) black++;
      else if (pixels[index] === 255 && pixels[index + 1] === 255 && pixels[index + 2] === 255) white++;
      else other++;
    }
    return { width: canvas.width, height: canvas.height, black, white, transparent, other };
  }, maskBytes.toString('base64'));
  assert.equal(exported.width, 320); assert.equal(exported.height, 160); assert.equal(exported.transparent, 0);
  assert.ok(exported.black > 0 && exported.white > 0, 'exported mask needs a black background and white brush strokes');
  assert.ok(exported.other < exported.white, 'brush antialiasing must remain limited to stroke edges');
  assert.equal(maskCall.params.turnTrigger, 'image_edit'); await assertDraft('Preserve the brush draft.');
  await finishStart(mask, removePrompt, maskGate); checks.mask = { exported, oneStroke, twoStrokes, params: maskCall.params };

  activeCase = 'active-steer';
  await openThread(steer); await draft('Preserve the active draft.'); await openImage(steer, 2);
  const steerGate = held(); steers.set(steer.id, steerGate); await observeBubble(backgroundPrompt, false);
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  const steerCall = await waitCall('turn/steer', steer.id); await assertBeforeAck(backgroundPrompt);
  assert.equal(steerCall.params.expectedTurnId, steer.activeTurn); await assertInput(steerCall, backgroundPrompt, [secondBytes]);
  assert.equal(calls('turn/start', steer.id).length, 0); assert.equal(calls('turn/interrupt', steer.id).length, 0); await assertDraft('Preserve the active draft.');
  steerGate.release(); await delay(30);
  const active = fake.threads.get(steer.id)!.turns.at(-1)!;
  const acknowledged: ThreadItemSummary = { id: 'active-steer-ack', type: 'userMessage', clientId: steerCall.params.clientUserMessageId, content: inputOf(steerCall) };
  active.items.push(acknowledged);
  for (let duplicate = 0; duplicate < 2; duplicate++) fake.broadcast({ method: 'item/completed', params: { threadId: steer.id, turnId: active.id, item: acknowledged } });
  checks.activeSteer = { params: steerCall.params, beforeAckAndDedup: await assertDeduplicated(backgroundPrompt), interrupts: 0 };

  activeCase = 'active-queue';
  await openThread(queue); await draft('Preserve the queued edit draft.'); await openImage(queue, 2);
  await composer().getByRole('button', { name: 'Queued message actions', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Turn on queueing', exact: true }).click();
  await until(async () => await composer().locator('.yard-source-send').getAttribute('aria-label') === 'Queue', 'Queue mode did not become active');
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  const queueCall = await waitCall('thread/queue/add', queue.id); await assertInput(queueCall, backgroundPrompt, [secondBytes]);
  await until(() => composer().locator('.yard-source-queued-row').count().then(count => count === 2), 'queued edit did not enter the existing queue');
  await assertDraft('Preserve the queued edit draft.');
  assert.equal(calls('turn/start', queue.id).length, 0); assert.equal(calls('turn/steer', queue.id).length, 0); assert.equal(calls('turn/interrupt', queue.id).length, 0);
  assert.equal(await bubble(backgroundPrompt).count(), 0, 'queueing should wait for queue execution before adding a transcript message');
  await capture('04-active-queue'); checks.activeQueue = { params: queueCall.params, interrupts: 0, queueLength: fake.queues.get(queue.id)!.length };

  activeCase = 'send-rejection';
  await openThread(sendReject); await draft('Recover the rejected comment draft.'); await openImage(sendReject, 2); await mode('Comment');
  await addComment(sendReject, 2, 'Rejected edit point.', .5, .5); rejected.add(sendReject.id);
  await composer().getByRole('button', { name: 'Send message', exact: true }).click();
  const rejectionCall = await waitCall('turn/start', sendReject.id);
  await composer().getByRole('alert').filter({ hasText: 'Fixture image submission rejected' }).waitFor();
  await assertDraft('Recover the rejected comment draft.');
  assert.equal(await composer().locator('.yard-source-image-attachment').count(), 1);
  assert.equal(await transcript().locator('[data-preparing-message]').count(), 0);
  checks.sendRejection = { params: rejectionCall.params, textAndOrdinaryAndGeneratedAttachmentRestored: true };

  activeCase = 'upload-rejection';
  await openThread(uploadReject); await draft('Preserve the failed-upload draft.'); await openImage(uploadReject);
  const rejectedUpload = { kind: 'reject' as const, seen: held(), release: held(), done: held() }; upload = rejectedUpload;
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  await waitGate(rejectedUpload.seen, 'generated image upload did not reach the rejection fixture');
  await waitGate(rejectedUpload.done, 'rejected upload did not complete');
  await page.getByRole('alert').filter({ hasText: /upload|上传|fixture/i }).first().waitFor();
  await until(async () => await panel().getAttribute('aria-busy') !== 'true', 'failed upload left the editor busy');
  await assertDraft('Preserve the failed-upload draft.'); assert.equal(sent(uploadReject.id).length, 0);
  checks.uploadRejection = { sent: 0, draftAndOrdinaryAttachmentPreserved: true };

  activeCase = 'live-generation';
  await openThread(generation); await openImage(generation, 2);
  const loadingId = 'live-image-result', liveTurn = fixtureTurn('live-image-edit', [{ id: loadingId, type: 'imageGeneration', status: 'inProgress', result: '' }], 'inProgress');
  fake.threads.get(generation.id)!.turns.push(liveTurn);
  fake.broadcast({ method: 'turn/started', params: { threadId: generation.id, turn: liveTurn } });
  fake.broadcast({ method: 'item/started', params: { threadId: generation.id, turnId: liveTurn.id, item: liveTurn.items[0] } });
  await panel().locator('[data-loading-image="' + loadingId + '"]').waitFor();
  await until(async () => (await panel().getAttribute('data-active-image')) === loadingId, 'new generation did not become active');
  assert.ok(await panel().getByRole('button', { name: 'Remove BG', exact: true }).isDisabled());
  await capture('04-live-generation');
  const completedImage = { id: loadingId, type: 'imageGeneration', status: 'completed', result: images[0]!.split(',')[1]! };
  liveTurn.items = [completedImage]; liveTurn.status = 'completed';
  fake.broadcast({ method: 'item/completed', params: { threadId: generation.id, turnId: liveTurn.id, item: completedImage } });
  fake.broadcast({ method: 'turn/completed', params: { threadId: generation.id, turn: liveTurn } });
  await until(async () => await panel().locator('[data-loading-image="' + loadingId + '"]').count() === 0 &&
    await panel().getAttribute('data-active-image') === loadingId && await panel().getByRole('button', { name: 'Remove BG', exact: true }).isEnabled(),
  'completed generation did not replace its loading placeholder');
  await panel().getByRole('button', { name: 'Canvas view', exact: true }).click();
  assert.equal(await panel().locator('[data-image-id]').count(), 3, 'Canvas must include the new turn and historical images');
  checks.liveGeneration = { activeId: loadingId, placeholderReplaced: true, aggregateImages: 3 };

  activeCase = 'uncertain-acknowledgement';
  await openThread(uncertainEdit); await draft('Preserve the uncertain edit draft.'); await openImage(uncertainEdit, 2);
  uncertain.add(uncertainEdit.id); await observeBubble(backgroundPrompt);
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  await composer().getByRole('alert').filter({ hasText: 'Delivery is unknown' }).waitFor();
  await assertBeforeAck(backgroundPrompt); await assertDraft('Preserve the uncertain edit draft.');
  assert.ok(await composer().locator('.yard-source-send').isDisabled(), 'unknown delivery must prevent duplicate submission');
  await finishStart(uncertainEdit, backgroundPrompt, held());
  await assertDraft('Preserve the uncertain edit draft.');
  assert.equal(sent(uncertainEdit.id).length, 1, 'recovery must not send a second image edit');
  await until(async () => await composer().locator('.yard-source-send').isEnabled(), 'canonical recovery did not unlock the Composer');
  checks.uncertainAcknowledgement = { sent: 1, draftPreserved: true, recoveredFromCanonicalEvent: true };

  activeCase = 'upload-thread-race';
  await openThread(other); await draft('Other thread remains untouched.', false);
  await openThread(race); await draft('Preserve the racing-upload draft.'); await openImage(race);
  const heldUpload = { kind: 'hold' as const, seen: held(), release: held(), done: held() }; upload = heldUpload;
  await panel().getByRole('button', { name: 'Remove BG', exact: true }).click();
  await waitGate(heldUpload.seen, 'generated image upload did not reach the race barrier');
  const collapse = page.getByRole('button', { name: 'Exit full screen', exact: true }); if (await collapse.isVisible()) await collapse.click();
  await page.locator('[data-app-action-sidebar-thread-id="local:' + other.id + '"]').first().click();
  await transcript().getByText(other.answer, { exact: true }).waitFor(); await assertDraft('Other thread remains untouched.', false);
  heldUpload.release.release(); await waitGate(heldUpload.done, 'held upload did not complete after switching conversations');
  await until(async () => !await panel().isVisible() || await panel().getAttribute('aria-busy') !== 'true', 'old image upload did not settle after switching threads');
  await delay(100);
  assert.equal(sent(other.id).length, 0, 'an old asynchronous image upload submitted to the newly selected thread');
  assert.equal(sent(race.id).length, 0, 'changing conversations must cancel the pending image edit');
  await assertDraft('Other thread remains untouched.', false); checks.uploadThreadRace = { sourceSent: 0, destinationSent: 0, destinationDraftPreserved: true };

  assert.equal(fake.calls('turn/interrupt').length, 0, 'image edits must preserve the active turn');
  assert.deepEqual(errors, [], 'browser had an uncaught exception');
  report.sshRouting = 'Not exercised: this fixture validates local UI and file transport only.';
  passed = true;
} catch (error) {
  report.failure = { case: activeCase, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
  if (page) await capture('failure-' + activeCase).catch(() => {});
  throw error;
} finally {
  for (const barrier of gates) barrier.release();
  report.passed = passed;
  report.mutations = fake.messages.filter(message => message.id != null && ['turn/start', 'turn/steer', 'turn/interrupt', 'thread/queue/add'].includes(message.method ?? ''));
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed, checks: Object.keys(checks), evidence, realDaemonUsed: false }));
