// Run the complete browser/service lifecycle under /tmp/agents-workbench-heavy.lock.
// Uses a disposable project and one real test thread, which is archived on exit.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import type { RpcMessage } from '../lib/codex.ts';
import { record } from '../src/native/protocol.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { projectRoot } from '../lib/app-resources.ts';

interface LogoFrame { at: number; present: boolean; visible: boolean; editor: boolean; transform?: string; animations: string[] }
interface CaptureWindow extends Window { visualFrames: LogoFrame[] }
const output = process.env.AGENTS_VISUAL_OUTPUT || join(projectRoot, '.local', 'visual-feedback-verification');
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp('/tmp/aw-visual-');
const socketPath = process.env.AGENTS_CODEX_SOCKET || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
const native = new CodexConnection(socketPath, { cwd: dataDir });
const errors: string[] = [], assetErrors: string[] = [];
const results: Record<string, unknown> = { dataDir, errors, assetErrors };
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
let threadId: string | undefined, turnId: string | undefined;
let turnRunning = false;
let stopCompletionWait = () => {};
const phase = (name: string) => console.log(name);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function waitForCompletion(label: string, timeoutMs: number) {
  const pending = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { stopCompletionWait(); reject(new Error(`${label} did not complete`)); }, timeoutMs);
    const listener = (message: RpcMessage) => {
      const params = record(message.params), turn = record(params.turn);
      if (message.method !== 'turn/completed' || params.threadId !== threadId) return;
      stopCompletionWait();
      if (turn.status === 'completed') resolve();
      else reject(new Error(`${label} ended with ${turn.status}`));
    };
    stopCompletionWait = () => { clearTimeout(timer); native.off('message', listener); };
    native.on('message', listener);
  });
  pending.catch(() => {});
  return pending;
}

async function logoFrames() {
  return page!.evaluate(() => (window as unknown as CaptureWindow).visualFrames);
}
function threadRow() {
  // The original sidebar uses a local:<id> key, while daemon RPCs use the raw id.
  return page!.locator(`[data-app-action-sidebar-thread-id="local:${threadId}"]`).first();
}
async function sampleSpinner() {
  return threadRow().locator('[class~="motion-safe:animate-spin"]').first().evaluate(element => ({
    at: performance.now(), transform: getComputedStyle(element).transform,
    animation: getComputedStyle(element).animation,
    animations: element.getAnimations().map(animation => ({ state: animation.playState, time: Number(animation.currentTime), name: (animation as CSSAnimation).animationName })),
  }));
}

try {
  if (process.env.AGENTS_CONFIGURATION_SNAPSHOT) {
    await mkdir(join(dataDir, 'configuration-snapshot'));
    for (const name of ['initialize.json', 'metadata.json']) {
      await copyFile(join(process.env.AGENTS_CONFIGURATION_SNAPSHOT, name), join(dataDir, 'configuration-snapshot', name));
    }
  }
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Visual feedback verification', path: dataDir }]));
  await native.connect();
  const started = await native.request('thread/start', { cwd: dataDir, approvalPolicy: 'never', sandbox: 'read-only' });
  threadId = started.thread.id;
  results.threadId = threadId;
  await native.request('thread/name/set', { threadId, name: '🩺 AgentWorkbench｜图标与动效验证' });
  const events: { method: string; status?: string; command?: string }[] = [];
  native.on('message', message => {
    const params = record(message.params), turn = record(params.turn), item = record(params.item);
    if (params.threadId !== threadId) return;
    if (typeof turn.id === 'string') turnId = turn.id;
    if (message.method === 'turn/started') turnRunning = true;
    if (message.method === 'turn/completed') turnRunning = false;
    if (message.method.startsWith('turn/') || item.command) events.push({ method: message.method,
      status: typeof turn.status === 'string' ? turn.status : typeof item.status === 'string' ? item.status : undefined,
      command: typeof item.command === 'string' ? item.command : undefined });
  });
  results.events = events;
  // An empty prewarm has no rollout for a second daemon client to resume.
  const historyReady = waitForCompletion('Test history', 120000);
  await native.request('turn/start', { threadId, input: [{ type: 'text', text: 'Reply with exactly VISUAL_SESSION_READY. Do not use tools.' }] });
  await historyReady;
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: dataDir, socketPath, hostCatalog: { hosts: [], projects: [], assignments: {} } });
  results.url = app.url;
  browser = await chromium.launch({ executablePath: process.env.AGENTS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'],
    env: { ...process.env, XDG_CONFIG_HOME: join(dataDir, 'browser-config'), XDG_CACHE_HOME: join(dataDir, 'browser-cache') } });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && /\/assets\//.test(response.url())) assetErrors.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => { if (/\/assets\//.test(request.url())) assetErrors.push(`${request.failure()?.errorText} ${request.url()}`); });
  let submissions = 0;
  page.on('websocket', socket => socket.on('framesent', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.request?.method === 'turn/start' && message.request.params?.threadId === threadId) submissions++;
  }));
  await page.addInitScript(() => {
    const target = window as unknown as CaptureWindow;
    target.visualFrames = [];
    const timer = setInterval(() => {
      const logo = document.querySelector('.startup-loader__logo, #root > [role="presentation"] ._Root_4m2sz_11');
      const editor = !!document.querySelector('[contenteditable="true"]');
      target.visualFrames.push({ at: performance.now(), present: !!logo, visible: !!logo?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        editor, transform: logo ? getComputedStyle(logo).transform : undefined,
        animations: logo ? logo.getAnimations({ subtree: true }).filter(a => a.playState === 'running').map(a => (a as CSSAnimation).animationName) : [] });
      if (editor && !logo || target.visualFrames.length > 500) clearInterval(timer);
    }, 80);
  });
  const route = '/?initialRoute=' + encodeURIComponent('/local/' + threadId);
  await page.goto(app.url + route, { waitUntil: 'commit' });
  await page.locator('[contenteditable="true"]').first().waitFor({ timeout: 120000 });
  const normalLogo = await logoFrames();
  results.normalLogo = normalLogo;
  const breathing = normalLogo.filter(f => f.visible && f.animations.includes('workbench-startup-breathe'));
  assert.ok(breathing.length >= 2 && new Set(breathing.map(f => f.transform)).size >= 2, 'Logo must move across time');
  assert.equal(await page.locator('.startup-loader__logo, #root > [role="presentation"] ._Root_4m2sz_11').count(), 0);
  const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll(elements => elements.map(e => (e as HTMLLinkElement).href));
  assert.equal(icons.length, 3);
  for (const href of icons) {
    const image = await page.request.get(href);
    assert.equal(image.status(), 200);
    if (href.endsWith('.svg')) {
      assert.equal(image.headers()['content-type'], 'image/svg+xml');
      assert.match(await image.text(), /<title>Codex Yard<\/title>/);
    } else {
      assert.equal(image.headers()['content-type'], 'image/png');
      assert.deepEqual([...await image.body()].slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  }
  results.iconSizes = await page.evaluate(async sources => await Promise.all(sources.map(async src => {
    const image = new Image(); image.src = src; await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  })), icons);
  assert.deepEqual(results.iconSizes, [{ width: 192, height: 192 }, { width: 64, height: 64 }, { width: 180, height: 180 }]);
  results.icons = icons;
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []);
  assert.equal(JSON.parse(manifest.data!).display, 'standalone');
  results.manifest = manifest;
  await cdp.detach();
  phase('Startup motion, Codex Yard branding and browser manifest passed');

  await page.waitForFunction(() => !document.querySelector('[data-codex-intelligence-trigger][aria-busy="true"]'), undefined, { timeout: 120000 });
  const uiCompleted = waitForCompletion('UI turn', 180000);
  await page.locator('[contenteditable="true"]').first().fill('This is an isolated visual UI test. Execute exactly one shell command: sleep 25. Then reply with exactly VISUAL_FEEDBACK_OK. Do not change files, send messages, or start any agents.');
  await page.locator('[contenteditable="true"]').first().press('Enter');
  const row = threadRow();
  const spinner = row.locator('[class~="motion-safe:animate-spin"]').first();
  await spinner.waitFor({ timeout: 120000 });
  const samples = [];
  for (let index = 0; index < 6; index++) {
    samples.push(await sampleSpinner());
    if (index === 0 || index === 3) await row.screenshot({ path: join(output, `running-${index}.png`), timeout: 10000 });
    await wait(173);
  }
  results.running = samples;
  assert.ok(new Set(samples.map(s => s.transform)).size >= 4, 'Sidebar ring must rotate across frames');
  assert.ok(samples.every(s => s.animations.some(a => a.name === 'workbench-thread-spin' && a.state === 'running')));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await wait(200);
  const reduced = [await sampleSpinner()];
  await wait(211);
  reduced.push(await sampleSpinner());
  results.reducedSpinner = reduced;
  assert.ok(reduced.every(s => s.animations.length === 0));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await wait(200);
  results.resumedSpinner = await sampleSpinner();
  assert.ok((await sampleSpinner()).animations.some(a => a.name === 'workbench-thread-spin' && a.state === 'running'));
  phase('Real running sidebar: six frames, reduced motion and resume passed');
  await page.getByText('VISUAL_FEEDBACK_OK', { exact: true }).last().waitFor({ timeout: 180000 });
  // A reply can precede installed completion hooks; wait for the real host state.
  await uiCompleted;
  await spinner.waitFor({ state: 'hidden', timeout: 15000 });
  assert.equal(submissions, 1);
  results.submissions = submissions;
  const completed = await native.request('thread/read', { threadId, includeTurns: true });
  assert.equal(completed.thread.turns.at(-1)?.status, 'completed');
  assert.ok(events.some(e => e.command?.includes('sleep 25')), 'Real command execution must be observed');
  await page.screenshot({ path: join(output, 'completed.png'), timeout: 10000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'commit' });
  await page.getByText('VISUAL_FEEDBACK_OK', { exact: true }).last().waitFor({ timeout: 120000 });
  const reducedLogo = await logoFrames();
  results.reducedLogo = reducedLogo;
  assert.ok(reducedLogo.some(f => f.visible), 'Reduced-motion startup must still show the logo');
  assert.ok(reducedLogo.filter(f => f.present).every(f => f.animations.length === 0), 'Reduced-motion logo must remain static');
  assert.equal(await threadRow().locator('[class~="motion-safe:animate-spin"]').count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(assetErrors, []);
  results.passed = true;
  phase('Completion, refresh, static reduced-motion startup and renderer assets passed');
} catch (error) {
  results.error = error instanceof Error ? error.stack : String(error);
  console.error(results.error);
  if (page) {
    results.body = await page.locator('body').innerText().catch(() => '');
    results.logoAtFailure = await logoFrames().catch(() => []);
    await page.screenshot({ path: join(output, 'failed.png'), timeout: 5000 }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  stopCompletionWait();
  const cleanupErrors: string[] = [];
  await browser?.close().catch(error => cleanupErrors.push(String(error)));
  await app?.close().catch(error => cleanupErrors.push(String(error)));
  if (threadId) {
    if (turnRunning && turnId) await native.request('turn/interrupt', { threadId, turnId }).catch(() => {});
    await native.request('thread/archive', { threadId }).catch(error => cleanupErrors.push(String(error)));
  }
  native.close();
  if (cleanupErrors.length) { results.cleanupErrors = cleanupErrors; results.passed = false; process.exitCode = 1; }
  await writeFile(join(output, 'verified.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('Evidence: ' + output);
}
