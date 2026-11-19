// Run under /tmp/agents-workbench-heavy.lock. All conversations are disposable.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const source = resolve(process.env.AGENTS_SIDEBAR_TOGGLE_SOURCE ?? '.');
const { createNativeWorkbench } = await import(pathToFileURL(join(source, 'src/native/server.ts')).href) as typeof import('../src/native/server.ts');
const output = resolve(process.env.AGENTS_SIDEBAR_TOGGLE_EVIDENCE ?? '.local/sidebar-toggle');
const measureOnly = process.argv.includes('--measure-only');
const root = await mkdtemp('/tmp/yard-toggle-'), dataDir = join(root, 'data');
await mkdir(output, { recursive: true });
await mkdir(dataDir);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT,
  join(dataDir, 'configuration-snapshot'), { recursive: true });
const fake = await createFakeCodex(root);
const projects = Array.from({ length: 5 }, (_, i) => join(root, 'project-' + i));
await Promise.all(projects.map(path => mkdir(path)));
await writeFile(join(dataDir, 'projects.json'), JSON.stringify(projects.map((path, i) => ({ path, name: 'Toggle project ' + i }))));
for (let i = 0; i < 180; i++) {
  const id = '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
  fake.threads.set(id, fixtureThread(id, projects[i % projects.length]!, { name: 'Toggle conversation ' + i,
    updatedAt: 1_700_001_000 - i, turns: [fixtureTurn('turn-' + i, [agentItem('answer-' + i, 'Toggle answer ' + i)])] }));
}
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('thread/turns/list', params => ({ data: fake.threads.get(String(params.threadId))!.turns
  .map(turn => ({ ...turn, items: params.itemsView === 'notLoaded' ? [] : turn.items, itemsView: params.itemsView ?? 'full' })),
  nextCursor: null, backwardsCursor: null }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline sidebar fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [], measurements: unknown[] = [], trajectories: unknown[] = [];
interface ToggleProbe {
  click: number; frames: number[]; widths: number[]; initialWidth: number;
  mainPositions: number[]; initialMainPosition: number; animating: boolean[];
}
interface ContinuityFrame { time: number; editor: number; message: number; opacity: number }
interface ContinuityProbe { initial: ContinuityFrame; frames: ContinuityFrame[] }
const cpuRate = Number(process.env.AGENTS_SIDEBAR_TOGGLE_CPU_RATE ?? 1);
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, source,
  cpuRate, checks, errors, measurements, trajectories };
let page: Page | undefined;
const trigger = () => page!.locator('[data-app-shell-sidebar-trigger]:visible').first();
async function settled(open: boolean) {
  await page!.waitForFunction(open => {
    const panel = document.querySelector('[data-yard-sidebar-slot], .app-shell-left-panel');
    const width = panel?.getBoundingClientRect().width ?? 0;
    const content = document.querySelector('#app-shell-sidebar');
    const target = content?.getBoundingClientRect().width ?? 0;
    const animating = document.getAnimations().some(animation => animation.id === 'yard-sidebar-transition' && animation.playState === 'running');
    const synchronizing = (window as unknown as { workbenchAnimateSidebar?: { synchronizing?: () => boolean } })
      .workbenchAnimateSidebar?.synchronizing?.();
    return !synchronizing && !animating && (open ? width > 200 && Math.abs(width - target) < 0.5 : width < 0.5);
  }, open);
  await page!.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function toggle(open: boolean) { await trigger().click(); await settled(open); }
async function windowZoom(zoom: number) {
  await page!.evaluate(async value => {
    const host = window as unknown as { electronBridge: { sendMessageFromView(message: unknown): Promise<void> } };
    await host.electronBridge.sendMessageFromView({ type: 'persisted-atom-update', key: 'electron:window-zoom', value });
  }, zoom);
  await page!.waitForFunction(value => Number(getComputedStyle(document.documentElement)
    .getPropertyValue('--codex-window-zoom') || 1) === value, zoom);
}

try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('Renderer crashed'));
  await page.goto(app.url, { waitUntil: 'commit' });
  await page.getByRole('textbox', { name: '随心输入', exact: true }).waitFor({ timeout: 60000 });
  // Let the delayed homepage pagination finish before measuring toggles.
  await page.waitForTimeout(2000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  for (const location of ['home', 'conversation']) {
    if (location === 'conversation') {
      await page.locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]').first().click();
      await page.getByText('Toggle answer 0', { exact: true }).waitFor();
    }
    // One warm-up pair excludes lazy toolbar initialization from repeated use.
    await toggle(false); await toggle(true);
    for (let index = 0; index < 6; index++) {
      const open = index % 2 === 1;
      await page.evaluate(() => {
        const initialWidth = document.querySelector('[data-yard-sidebar-slot], .app-shell-left-panel')?.getBoundingClientRect().width ?? 0;
        const main = document.querySelector('[data-app-shell-main-content-layout]')!;
        const anchor = main.querySelector('[contenteditable="true"][role="textbox"]') ?? main;
        const initialMainPosition = anchor.getBoundingClientRect().left;
        const probe = { click: 0, done: false, initialWidth, initialMainPosition, frames: [] as number[], widths: [] as number[],
          mainPositions: [] as number[], animating: [] as boolean[] };
        Object.assign(window, { yardToggleProbe: probe });
        document.addEventListener('click', event => {
          if (!(event.target instanceof Element) || !event.target.closest('[data-app-shell-sidebar-trigger]')) return;
          probe.click = performance.now();
          const frame = () => {
            probe.frames.push(performance.now());
            probe.widths.push(document.querySelector('[data-yard-sidebar-slot], .app-shell-left-panel')?.getBoundingClientRect().width ?? 0);
            probe.mainPositions.push(anchor.getBoundingClientRect().left);
            probe.animating.push(document.getAnimations().some(animation => animation.id === 'yard-sidebar-transition' && animation.playState === 'running'));
            if (performance.now() - probe.click < 1000) requestAnimationFrame(() => setTimeout(frame, 0));
            else probe.done = true;
          };
          requestAnimationFrame(() => setTimeout(frame, 0));
        }, { once: true, capture: true });
      });
      const before = await cdp.send('Performance.getMetrics');
      await trigger().click();
      await page.waitForFunction(() => (window as unknown as { yardToggleProbe: { done: boolean } }).yardToggleProbe.done);
      const after = await cdp.send('Performance.getMetrics');
      const probe: ToggleProbe = await page.evaluate(() => (window as unknown as { yardToggleProbe: ToggleProbe }).yardToggleProbe);
      const delta = (key: string) => (after.metrics.find(m => m.name === key)?.value ?? 0) - (before.metrics.find(m => m.name === key)?.value ?? 0);
      const gaps = probe.frames.map((time, i) => time - (i ? probe.frames[i - 1]! : probe.click));
      const change = probe.mainPositions.findIndex(left => Math.abs(left - probe.initialMainPosition) > 1);
      const target = probe.widths.at(-1)!;
      const end = probe.widths.findIndex((width, i) => !probe.animating[i] && Math.abs(width - target) < 0.5 && probe.widths.slice(i).every(w => Math.abs(w - target) < 0.5));
      assert.ok(change >= 0 && end >= 0, 'A real click must change sidebar geometry');
      const movingGaps = gaps.filter((_, i) => i > change && probe.animating[i]);
      measurements.push({ location, open, index, firstFrameMs: gaps[0], firstChangeMs: probe.frames[change]! - probe.click,
        settledMs: probe.frames[end]! - probe.click, longestFrameMs: Math.max(...gaps), scriptMs: delta('ScriptDuration') * 1000,
        movingFrameMaxMs: Math.max(0, ...movingGaps), firstStepPx: Math.abs(probe.mainPositions[change]! - probe.initialMainPosition),
        styleMs: delta('RecalcStyleDuration') * 1000, styleCount: delta('RecalcStyleCount'),
        layoutMs: delta('LayoutDuration') * 1000, layoutCount: delta('LayoutCount'), nodeCountChange: delta('Nodes'), probe });
    }
  }
  checks.push('Six measured toggles each on the homepage and in a conversation');
  if (!measureOnly) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true });
    await editor.fill('Sidebar toggle draft');
    await toggle(false);
    const triggerPosition = await trigger().boundingBox();
    const editorPosition = await editor.boundingBox();
    await trigger().click();
    const animatedSurfaces = await page.evaluate(() => {
      const animations = document.getAnimations().filter(animation => animation.id === 'yard-sidebar-transition');
      for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
      return animations.map(animation => ({ properties: Object.keys((animation.effect as KeyframeEffect).getKeyframes()[0]!),
        sidebar: ((animation.effect as KeyframeEffect).target as HTMLElement).matches('.app-shell-left-panel'),
        workspace: ((animation.effect as KeyframeEffect).target as HTMLElement).matches('[data-app-shell-main-content-layout]') }));
    });
    assert.ok(animatedSurfaces.some(surface => surface.sidebar) && animatedSurfaces.some(surface => surface.workspace), 'Sidebar and workspace must both animate');
    for (const surface of animatedSurfaces) assert.ok(!surface.properties.includes('width'), 'Transitions must not animate layout width');
    const editorAtStart = await editor.boundingBox();
    assert.ok(editorPosition && editorAtStart && Math.abs(editorPosition.x - editorAtStart.x) < 1,
      'Centered content must start at its previous visual position');
    await page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.id === 'yard-sidebar-transition') animation.currentTime = 120; });
    const midpointTriggerPosition = await trigger().boundingBox();
    assert.ok(triggerPosition && midpointTriggerPosition && Math.abs(triggerPosition.x - midpointTriggerPosition.x) < 1,
      'Fixed sidebar trigger must stay in place during the transition');
    await page.screenshot({ path: join(output, 'opening-midpoint.png') });
    await page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.id === 'yard-sidebar-transition') animation.finish(); });
    await settled(true);
    checks.push('Sidebar and workspace animate with transform/opacity, without width keyframes or text scaling');

    const closing = await page.evaluate(() => {
      const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-app-shell-sidebar-trigger]'))
        .find(element => !element.closest('.app-shell-left-panel'))!;
      trigger.click();
      for (const animation of document.getAnimations()) if (animation.id === 'yard-sidebar-transition') animation.pause();
      const panel = document.querySelector<HTMLElement>('.app-shell-left-panel')!;
      const button = panel.querySelector<HTMLElement>('button:not([disabled])')!;
      button.focus();
      let activations = 0;
      const activated = () => { activations++; };
      button.addEventListener('click', activated);
      button.addEventListener('contextmenu', activated);
      button.click();
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      button.removeEventListener('click', activated);
      button.removeEventListener('contextmenu', activated);
      return { inert: panel.inert, activations, focusedInside: panel.contains(document.activeElement) };
    });
    assert.equal(closing.inert, false, 'Inherited inert work must wait until motion completes');
    assert.equal(closing.activations, 0, 'Closing controls must block click and context-menu activation');
    assert.equal(closing.focusedInside, false, 'Closing controls must refuse focus');
    assert.equal(await page.getByRole('navigation', { name: '聊天记录', exact: true }).count(), 0);
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !document.activeElement?.closest('.app-shell-left-panel')));
    // Interrupt a paused transition using an actual viewport resize. Native
    // inert must settle even when no animation.finished promise can resolve.
    await page.setViewportSize({ width: 1438, height: 900 });
    await settled(false);
    assert.ok(await page.locator('.app-shell-left-panel').evaluate(element => element.hasAttribute('inert')));
    await trigger().click();
    await page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.id === 'yard-sidebar-transition') animation.pause(); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settled(true);
    assert.ok(await page.locator('.app-shell-left-panel').evaluate(element => !element.hasAttribute('inert')));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    checks.push('Closing blocks focus/click/menu immediately; resize and reduced-motion interruption settle native inert');
    const sidebar = await page.locator('#app-shell-sidebar').elementHandle();
    const scroller = page.locator('#app-shell-sidebar .sidebar-navigation .overflow-y-auto').first();
    const scrollTop = await scroller.evaluate(element => { element.scrollTop = 160; return element.scrollTop; });
    assert.ok(scrollTop > 0);
    await toggle(false);
    assert.ok(await sidebar!.evaluate(element => element.isConnected), 'Collapse must preserve the sidebar DOM');
    assert.equal(await page.getByRole('navigation', { name: '聊天记录', exact: true }).count(), 0, 'Collapsed navigation must leave the accessibility tree');
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !document.activeElement?.closest('.app-shell-left-panel')), 'Tab must skip collapsed navigation');
    await toggle(true);
    assert.ok(await sidebar!.evaluate(element => element === document.querySelector('#app-shell-sidebar')), 'Reopen must reuse the same sidebar');
    assert.equal(await scroller.evaluate(element => element.scrollTop), scrollTop);
    assert.equal(await editor.innerText(), 'Sidebar toggle draft');
    checks.push('Collapse/reopen retains the same DOM, scroll position and draft; collapsed navigation is inert');

    // Native hover peeks temporarily own the sidebar instead of duplicating it.
    await toggle(false);
    await page.mouse.move(900, 500);
    await trigger().hover();
    await page.getByTestId('app-shell-floating-left-panel').waitFor();
    assert.equal(await page.locator('#app-shell-sidebar').count(), 1);
    await page.mouse.move(1000, 600);
    await page.getByTestId('app-shell-floating-left-panel').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#app-shell-sidebar').count(), 1);
    await trigger().press('Enter'); await settled(true);
    checks.push('Hover peek and keyboard reopen retain one sidebar and preserve the native floating behavior');

    // Physical clicks can reverse an in-flight animation without Playwright's
    // locator stability wait hiding the case.
    for (let i = 0; i < 4; i++) {
      const box = await trigger().boundingBox(); assert.ok(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(40);
    }
    await settled(true);
    assert.equal(await trigger().getAttribute('aria-expanded'), 'true');
    assert.ok(await page.locator('.app-shell-left-panel').evaluate(element => !element.hasAttribute('inert')));
    assert.equal(await page.locator('#app-shell-sidebar').count(), 1);
    checks.push('Four rapid reversals finish expanded with a single sidebar');

    const panel = page.locator('.app-shell-left-panel');
    const beforeResize = (await panel.boundingBox())!.width;
    const handle = page.locator('.app-shell-left-panel [role="separator"]').first();
    const box = await handle.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 58, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(before => document.querySelector('.app-shell-left-panel')!.getBoundingClientRect().width > before + 20, beforeResize);
    await toggle(false); await toggle(true);
    assert.ok((await panel.boundingBox())!.width > beforeResize + 20);
    checks.push('Dragging the native resize handle changes sidebar width and survives collapse/reopen');

    // A wide sidebar crosses the native Summary/Outputs layout breakpoint.
    // Its content offset used to spring independently of the sidebar FLIP,
    // making both the message and composer overshoot and then reverse.
    await page.setViewportSize({ width: 1920, height: 1012 });
    const wideHandle = await handle.boundingBox(); assert.ok(wideHandle);
    await page.mouse.move(wideHandle.x + wideHandle.width - 2, wideHandle.y + wideHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(wideHandle.x + wideHandle.width + 200, wideHandle.y + wideHandle.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.ok((await panel.boundingBox())!.width >= 500, 'Exercise the wide-sidebar layout breakpoint');
    const previousZoom = await page.evaluate(() => Number(JSON.parse(localStorage.getItem('native-atoms') ?? '{}')['electron:window-zoom'] ?? 1));
    for (const zoom of [1, 1.25]) {
      await windowZoom(zoom);
      // Allow the native resize (outside the sidebar toggle) to settle first.
      await page.waitForTimeout(500);
      for (let index = 0; index < 6; index++) {
        const open = index % 2 === 1;
        await page.evaluate(() => {
          const main = document.querySelector('[data-app-shell-main-content-layout]')!;
          const editor = main.querySelector('[contenteditable="true"][role="textbox"]')!;
          const message = main.querySelector('p')!;
          const panel = document.querySelector('.app-shell-left-panel')!;
          const sample = () => ({ time: performance.now(), editor: editor.getBoundingClientRect().left,
            message: message.getBoundingClientRect().left, opacity: Number(getComputedStyle(panel).opacity) });
          const probe = { initial: sample(), frames: [] as ReturnType<typeof sample>[], done: false };
          Object.assign(window, { yardContinuity: probe });
          document.addEventListener('click', event => {
            if (!(event.target instanceof Element) || !event.target.closest('[data-app-shell-sidebar-trigger]')) return;
            const start = performance.now();
            const frame = () => {
              probe.frames.push(sample());
              if (performance.now() - start < 700) requestAnimationFrame(() => setTimeout(frame, 0));
              else probe.done = true;
            };
            // Sample after all rAF callbacks, including native postRender.
            // A pre-render geometry read can observe an unpainted FLIP layout.
            requestAnimationFrame(() => setTimeout(frame, 0));
          }, { once: true, capture: true });
        });
        await trigger().click();
        await page.waitForFunction(() => (window as unknown as { yardContinuity: { done: boolean } }).yardContinuity.done);
        const probe: ContinuityProbe = await page.evaluate(() => (window as unknown as { yardContinuity: ContinuityProbe }).yardContinuity);
        const paths: Record<string, { distance: number; reversePx: number; overshootPx: number }> =
          Object.fromEntries((['editor', 'message', 'opacity'] as const).map(key => {
            const values = [probe.initial[key], ...probe.frames.map(frame => frame[key])];
            const direction = Math.sign(values.at(-1)! - values[0]!);
            return [key, { distance: Math.abs(values.at(-1)! - values[0]!),
              reversePx: Math.max(0, ...values.slice(1).map((value, i) => (values[i]! - value) * direction)),
              overshootPx: Math.max(0, ...values.map(value => (value - values.at(-1)!) * direction)) }];
          }));
        trajectories.push({ zoom, open, index, paths, probe });
        for (const key of ['editor', 'message']) {
          assert.ok(paths[key]!.distance > 1, 'The ' + key + ' must actually move');
          assert.ok(paths[key]!.reversePx <= 0.5 && paths[key]!.overshootPx <= 0.5,
            `${zoom}x ${open ? 'opening' : 'closing'} ${key} must approach its final position without reversing: ${JSON.stringify(paths[key])}`);
        }
        assert.ok(paths.opacity!.reversePx <= 0.02, 'Sidebar opacity must not flash during a toggle');
        assert.ok(probe.frames.some(frame => frame.opacity > 0.05 && frame.opacity < 0.95), 'The sidebar must have visible intermediate frames');
        await settled(open);
      }
      checks.push(`${zoom}x zoom: wide-sidebar messages, composer and opacity remain continuous across six toggles`);
    }
    await windowZoom(previousZoom);

    for (const viewport of [{ width: 800, height: 1100 }, { width: 402, height: 874 }]) {
      await page.setViewportSize(viewport);
      await toggle(false); await toggle(true);
      assert.equal(await page.locator('#app-shell-sidebar').count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, 'open-' + viewport.width + '.png') });
      await toggle(false);
      await page.screenshot({ path: join(output, 'closed-' + viewport.width + '.png') });
      await toggle(true);
      assert.equal(await editor.innerText(), 'Sidebar toggle draft');
      checks.push(viewport.width + 'px: toggling keeps draft, one sidebar and no horizontal overflow');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggle(false); await toggle(true);
    assert.ok(await page.locator('.app-shell-left-panel').evaluate(element => !element.hasAttribute('inert')));
    checks.push('Reduced-motion preference still supports collapse and reopen');
    await page.screenshot({ path: join(output, 'open-desktop.png') });
  }
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('turn/start').length, 0, 'UI checks must not send the draft');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  if (page) await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot()).catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: report.ok, checks, errors, evidence: output }));
}
