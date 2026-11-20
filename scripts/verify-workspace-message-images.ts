// Disposable conversation; run under /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Locator } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { composerInput } from '../src/workspace/composer-input.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';

const source = process.argv.includes('--source');
const narrow = process.argv.includes('--narrow');
const dark = process.argv.includes('--dark');
const preview = process.argv.includes('--preview');
const generated = process.argv.includes('--generated');
assert.ok(!preview || source, 'Preview requires --source.');
const evidence = resolve(process.env.AGENTS_IMAGE_MESSAGE_EVIDENCE ?? '.local/workspace-message-images');
const root = await mkdtemp('/tmp/yard-message-images-');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(evidence, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Image fixture', path: root }]));
const fake = await createFakeCodex(root);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerAccountId: null, status: null, error: null }));
const files = fileDaemonFixture();
fake.handlers.set('fs/getMetadata', params => files('fs/getMetadata', params));
fake.handlers.set('fs/readFile', params => files('fs/readFile', params));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), sourceWorkspace: source, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  hasTouch: narrow, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
const transcript = page.getByRole('region', { name: 'Conversation', exact: true });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const evidenceNames: string[] = [];
let passed = false;
async function screenshot(name: string) {
  await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(evidence, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
  evidenceNames.push(name);
}
async function imageSize(image: Locator) {
  return image.evaluate(node => {
    const img = node as HTMLImageElement;
    const { x, y, width, height } = img.getBoundingClientRect();
    const { objectFit, borderRadius } = getComputedStyle(img);
    return { x, y, width, height, objectFit, borderRadius, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  });
}

async function verifyGeneratedImages(images: string[], first: string, mainId: string) {
  const second = join(root, 'generated tall.png');
  await writeFile(second, Buffer.from(images[1]!.split(',')[1]!, 'base64'));
  const generation = (id: string, result: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'imageGeneration', status: 'completed', result, revisedPrompt: null, generationId: null, failure: null, ...extra,
  });
  const turn = { ...fixtureTurn('generated-turn', [
    { id: 'generation-prompt', type: 'userMessage', content: [{ type: 'text', text: 'Generate two pictures.', text_elements: [] }] },
    generation('generated-one', images[0]!.split(',')[1]!), generation('generated-two', images[1]!.split(',')[1]!),
    { type: 'imageView', id: 'view-one', path: first }, { type: 'imageView', id: 'view-two', path: second },
    { ...agentItem('generation-answer', 'Your two pictures are ready.'), phase: 'final_answer' },
  ]), startedAt: Math.floor(Date.now() / 1000) - 30, completedAt: Math.floor(Date.now() / 1000) - 10, durationMs: 20_000 };
  const thread = fixtureThread(mainId, root, { name: 'Generated pictures', turns: [turn] });
  fake.threads.set(mainId, thread);
  const url = app.url + '/?initialRoute=' + encodeURIComponent('/local/' + mainId);
  await page.goto(url, { waitUntil: 'commit' });
  await transcript.getByText('Your two pictures are ready.', { exact: true }).waitFor({ timeout: 25_000 });
  const selected = (number: number) => transcript.getByRole('button', { name: 'Generated image ' + number, exact: true }).getByRole('img');
  await selected(1).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('img[alt="Generated image 1"]')?.naturalWidth === 320);
  const wide = await imageSize(selected(1));
  assert.equal(wide.naturalWidth, 320);
  assert.ok(Math.abs(wide.width / wide.height - 2) < .01);
  await screenshot('generated-history');
  await transcript.getByRole('button', { name: 'Show generated image 2', exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('img[alt="Generated image 2"]')?.naturalWidth === 128);
  const tall = await imageSize(selected(2));
  assert.equal(tall.naturalWidth, 128);
  assert.ok(Math.abs(tall.width / tall.height - 128 / 240) < .01);
  assert.ok(tall.width <= 400);
  await screenshot('generated-selected');
  const checks = ['base64 generation history', 'thumbnail selection and natural aspect ratios'];
  if (source) {
    await selected(2).click();
    const modal = page.getByRole('dialog', { name: 'Image preview', exact: true });
    await modal.getByRole('img', { name: 'Generated image 2', exact: true }).waitFor();
    const downloaded = page.waitForEvent('download');
    await modal.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloaded;
    assert.deepEqual(await readFile((await download.path())!), Buffer.from(images[1]!.split(',')[1]!, 'base64'));
    await page.keyboard.press('ArrowLeft');
    await modal.getByRole('img', { name: 'Generated image 1', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await transcript.getByRole('button', { name: 'Generated image 2', exact: true }).waitFor();
    await transcript.getByRole('button', { name: /^Worked for/ }).first().click();
    const viewed = transcript.getByRole('button', { name: 'Viewed 2 images', exact: true });
    await viewed.waitFor(); await viewed.click();
    const inspected = transcript.getByRole('img', { name: 'Inspected image', exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[alt="Inspected image"]')]
      .length === 2 && [...document.querySelectorAll<HTMLImageElement>('img[alt="Inspected image"]')].every(image => image.naturalWidth > 0));
    assert.deepEqual((await Promise.all([imageSize(inspected.nth(0)), imageSize(inspected.nth(1))])).map(image => image.naturalWidth), [320, 128]);
    await screenshot('generated-inspected');
    checks.push('preview navigation and byte-exact download', 'consecutive image views grouped with host file previews');

    const live = { ...fixtureTurn('generation-live', [], 'inProgress'), startedAt: Math.floor(Date.now() / 1000) - 5 };
    thread.turns.push(live); thread.status = { type: 'active', activeFlags: [] };
    fake.broadcast({ method: 'turn/started', params: { threadId: mainId, turn: live } });
    const pending = generation('generation-pending', '', { status: 'inProgress' }); live.items.push(pending);
    fake.broadcast({ method: 'item/started', params: { threadId: mainId, turnId: live.id, item: pending } });
    const loading = transcript.locator('[aria-label="Generating image..."][aria-busy="true"]').first();
    await loading.waitFor({ timeout: 8_000 });
    await loading.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.yard-source-generated-pending canvas');
      return canvas && canvas.width > 0 && canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
    });
    await screenshot('generated-pending');
    const completed = generation(pending.id, '', { savedPath: first }); live.items = [completed];
    fake.broadcast({ method: 'item/completed', params: { threadId: mainId, turnId: live.id, item: completed } });
    live.status = 'completed'; live.completedAt = Math.floor(Date.now() / 1000); thread.status = { type: 'idle' };
    fake.broadcast({ method: 'turn/completed', params: { threadId: mainId, turn: live } });
    await loading.waitFor({ state: 'detached' });
    const savedImage = transcript.getByRole('button', { name: 'Generated image 1', exact: true }).last().getByRole('img');
    await savedImage.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[alt="Generated image 1"]')].at(-1)?.naturalWidth === 320);
    const request = new URL((await savedImage.getAttribute('src'))!, app.url);
    assert.equal(request.pathname, '/api/files/content'); assert.equal(request.searchParams.get('path'), first);
    assert.equal(request.searchParams.get('hostId'), 'local');
    const reads = fake.calls('thread/turns/list').length;
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await fake.waitFor(() => fake.calls('thread/turns/list').length > reads, 20_000);
    await page.reload({ waitUntil: 'commit' });
    await transcript.getByRole('button', { name: 'Generated image 1', exact: true }).last().waitFor({ timeout: 25_000 });
    assert.equal(await transcript.getByRole('button', { name: 'Generated image 1', exact: true }).count(), 2);
    assert.equal(await transcript.locator('[aria-label="Generating image..."]').count(), 0);
    await screenshot('generated-reopened');
    checks.push('live dot field and completed local file', 'reconnect and reload preserve images without duplicates');
  } else {
    await selected(2).click();
    await page.getByRole('button', { name: 'Remove BG', exact: true }).waitFor({ timeout: 10_000 });
    await screenshot('generated-native-canvas');
  }
  await writeFile(join(evidence, 'geometry.json'), JSON.stringify({ wide, tall, checks }, null, 2) + '\n');
  assert.deepEqual(errors, []);
}

try {
  const images = await page.evaluate(() => [
    { width: 320, height: 160, background: '#e7aa63', ink: '#235a6f' },
    { width: 128, height: 240, background: '#bcd69b', ink: '#4e345d' },
  ].map(({ width, height, background, ink }) => {
    const canvas = document.createElement('canvas');
    Object.assign(canvas, { width, height });
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.fillStyle = ink;
    context.fillRect(width / 8, height / 4, width / 2, height / 8);
    context.fillRect(width / 4, height / 2, width / 8, height / 3);
    return canvas.toDataURL('image/png');
  }));
  const first = join(root, 'sample wide.png');
  const missing = join(root, 'removed.png');
  const mainId = '00000000-0000-4000-8000-000000000421';
  await writeFile(first, Buffer.from(images[0]!.split(',')[1]!, 'base64'));
  if (generated) {
    await verifyGeneratedImages(images, first, mainId);
    passed = true;
  } else {
  const answer = 'Both test pictures are in the conversation.';
  const prompt = 'Compare these two samples.';
  const text = (value: string) => ({ type: 'text', text: value, text_elements: [] });
  fake.threads.set(mainId, fixtureThread(mainId, root, { name: 'Conversation pictures', turns: [
    fixtureTurn('older-image', [{ id: 'local-files', type: 'userMessage', content: [
      ...composerInput('One earlier image was removed.', [{ name: 'sample wide.png', path: first, image: true }]),
      { type: 'localImage', path: missing },
    ] }]),
    fixtureTurn('saved-images', [{ id: 'gallery', type: 'userMessage', content: [
      text(prompt), { type: 'image', url: images[0] }, { type: 'image', url: images[1] },
    ] }, { ...agentItem('gallery-answer', answer), phase: 'final_answer' }]),
  ] }));
  const url = app.url + '/?initialRoute=' + encodeURIComponent('/local/' + mainId);
  const thumbnails = transcript.locator('img[alt="User attachment"]');
  const wide = thumbnails.nth(-2), tall = thumbnails.last();
  async function waitForImages() {
    await transcript.getByText(answer, { exact: true }).waitFor({ timeout: 25_000 });
    await tall.waitFor({ timeout: 8_000 });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[alt="User attachment"]')]
      .slice(-2).every(image => image.naturalWidth > 0));
    assert.deepEqual((await Promise.all([imageSize(wide), imageSize(tall)])).map(({ naturalWidth }) => naturalWidth), [320, 128]);
    if (source) {
      await transcript.getByRole('img', { name: 'Image failed to load', exact: true }).waitFor({ timeout: 8_000 });
      assert.equal(await thumbnails.count(), 3);
      const local = transcript.locator('.yard-source-message-thumbnail[data-state="ready"] img').first();
      await local.waitFor();
      assert.equal((await imageSize(local)).naturalWidth, 320);
      const request = new URL((await local.getAttribute('src'))!, app.url);
      assert.equal(request.pathname, '/api/files/content');
      assert.equal(request.searchParams.get('path'), first);
      assert.equal(request.searchParams.get('hostId'), 'local');
      assert.equal(await transcript.locator('.yard-source-attachment').count(), 0);
    }
  }
  await page.goto(url, { waitUntil: 'commit' });
  await waitForImages();
  await screenshot('history');
  const history = await Promise.all([imageSize(wide), imageSize(tall)]);
  await wide.click();
  const close = page.getByRole('button', { name: 'Close image preview', exact: true });
  await close.waitFor();
  await screenshot('preview');
  const modal = page.getByRole('dialog').filter({ has: close });
  const view = modal.getByRole('img', { name: 'User attachment', exact: true }).last();
  const initial = await imageSize(view);
  assert.equal(initial.naturalWidth, 320);
  const zoomIn = modal.getByRole('button', { name: 'Zoom in image', exact: true });
  const zoomOut = modal.getByRole('button', { name: 'Zoom out image', exact: true });
  const percent = modal.getByText(/^\d+%$/);
  await percent.waitFor();
  const fitLabel = await percent.textContent();
  if (!narrow) assert.equal(fitLabel, '100%');
  await zoomIn.click();
  if (!narrow) await modal.getByText('110%', { exact: true }).waitFor();
  const zoomedWidth = (await imageSize(view)).width;
  assert.ok(zoomedWidth > initial.width);
  if (!narrow) assert.equal(zoomedWidth, 352);
  await zoomOut.click();
  await modal.getByText(fitLabel!, { exact: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[role="dialog"] img[alt="User attachment"]')?.naturalWidth === 128);
  const next = await imageSize(view);
  await modal.getByText('100%', { exact: true }).waitFor();
  const downloadEvent = page.waitForEvent('download', { timeout: 8_000 });
  await modal.getByRole('button', { name: 'Download image', exact: true }).click();
  const download = await downloadEvent;
  assert.deepEqual(await readFile(await download.path()), Buffer.from(images[1]!.split(',')[1]!, 'base64'));
  await screenshot('preview-next');
  await page.keyboard.press('Escape');
  await close.waitFor({ state: 'hidden' });
  const focusRestored = await wide.evaluate(node => node.closest('button,[role="button"]') === document.activeElement);
  if (source) assert.equal(focusRestored, true, 'Escape returns focus to the attachment that opened the gallery.');
  const firstThumb = source ? thumbnails.first() : wide;
  await firstThumb.click();
  await close.waitFor();
  if (source) {
    const localDownload = page.waitForEvent('download', { timeout: 8_000 });
    await modal.getByRole('button', { name: 'Download image', exact: true }).click();
    const downloaded = await localDownload;
    assert.equal(downloaded.suggestedFilename(), 'sample wide.png');
    assert.deepEqual(await readFile(await downloaded.path()), await readFile(first));
  }
  await close.click();
  await close.waitFor({ state: 'hidden' });
  await page.reload({ waitUntil: 'commit' });
  await waitForImages();
  await screenshot('history-reopened');
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'geometry.json'), JSON.stringify({ history, initial, next, fitLabel, zoomedWidth, focusRestored }, null, 2) + '\n');
  passed = true;
  if (preview) {
    await browser.close();
    console.log('PREVIEW_URL=' + url);
    await delay(45 * 60_000);
  }
  }
} catch (error) {
  await screenshot('error').catch(() => {});
  throw error;
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ passed, generated,
    renderer: source ? 'React/TypeScript' : '26.1013.40934', screenshots: evidenceNames, errors }, null, 2) + '\n');
  if (browser.isConnected()) await browser.close();
  await app.close();
  await fake.close();
  await rm(root, { recursive: true, force: true });
}
