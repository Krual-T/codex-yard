// Run under the shared heavy-browser lock. Conversations and hosts are synthetic.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const source = resolve(process.env.AGENTS_STARTUP_SOURCE ?? '.');
const sourceCandidate = process.argv.includes('--source-candidate');
const directHistory = process.argv.includes('--source-direct-history');
assert.ok(!directHistory || sourceCandidate, 'Direct-history mode measures only the source workspace.');
const requireFullUnderOneSecond = process.argv.includes('--require-full-under-1s');
assert.ok(!sourceCandidate || (!requireFullUnderOneSecond && !process.argv.includes('--check-handoff')),
  'The source candidate benchmark does not certify the unchanged production renderer or handoff.');
const { createNativeWorkbench } = await import(pathToFileURL(join(source, 'src/native/server.ts')).href) as typeof import('../src/native/server.ts');
const { rendererAssets } = await import(pathToFileURL(join(source, 'src/native/renderer-assets.ts')).href) as typeof import('../src/native/renderer-assets.ts');
const output = resolve(process.env.AGENTS_STARTUP_EVIDENCE ?? (sourceCandidate ? '.local/source-startup' : '.local/sidebar-startup'));
const root = await mkdtemp('/tmp/yard-startup-');
const dataDir = join(root, 'data');
await mkdir(output, { recursive: true });
await mkdir(dataDir);
if (process.env.AGENTS_STARTUP_CONFIGURATION) {
  await cp(process.env.AGENTS_STARTUP_CONFIGURATION, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
const fake = await createFakeCodex(root);
const ids = Array.from({ length: 180 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const projectPaths = Array.from({ length: 5 }, (_, i) => join(root, 'project-' + i));
await Promise.all(projectPaths.map(path => mkdir(path)));
await writeFile(join(dataDir, 'projects.json'), JSON.stringify(projectPaths.map((path, i) => ({ path, name: `Startup project ${i}` }))));
for (const [i, id] of ids.entries()) {
  fake.threads.set(id, fixtureThread(id, projectPaths[i % 5]!, { name: `Startup conversation ${i}`,
    preview: `Startup question ${i}`, updatedAt: 1_700_001_000 - i, path: join(root, id + '.jsonl'),
    turns: [fixtureTurn(`turn-${i}`, [
      { id: `user-${i}`, type: 'userMessage', content: [{ type: 'text', text: `Startup question ${i}`, text_elements: [] }] },
      { ...agentItem(`answer-${i}`, `Startup answer ${i}`), phase: 'final_answer' },
    ])] }));
}
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params) as object,
  turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('thread/turns/list', params => {
  const turns = [...fake.threads.get(String(params.threadId))!.turns];
  if (params.sortDirection !== 'asc') turns.reverse();
  const offset = Number(params.cursor ?? 0), limit = Number(params.limit ?? 5);
  return { data: turns.slice(offset, offset + limit).map(turn => ({ ...turn,
    items: params.itemsView === 'notLoaded' ? [] : turn.items, itemsView: params.itemsView ?? 'full',
  })), nextCursor: offset + limit < turns.length ? String(offset + limit) : null, backwardsCursor: null };
});
const hosts = Array.from({ length: 3 }, (_, i) => ({ hostId: `remote-ssh-startup-${i}`,
  displayName: `Startup host ${i}`, sshAlias: `fixture-${i}`, sshHost: 'fixture.invalid', sshPort: null, identity: null }));
await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {
  'remote-connection-auto-connect-by-host-id': Object.fromEntries(hosts.map(host => [host.hostId, true])),
} }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), renderer: process.env.AGENTS_STARTUP_RENDERER, sourceWorkspace: sourceCandidate,
  hostCatalog: { hosts, projects: [], assignments: {} },
  sshStream: (_host, onPaths) => {
    onPaths?.({ homeDirectory: root, codexHome: join(root, 'codex') });
    return createConnection(fake.socketPath);
  }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
if (process.env.AGENTS_STARTUP_RENDERER) {
  const assets = rendererAssets;
  await Promise.all([assets.client, assets.shared, assets.rpc, assets.application, assets.primary, assets.locale,
    assets.applicationStyle, assets.userMessageStyle].map(async path => {
    const response = await fetch(new URL(path, app.url), { headers: { 'Accept-Encoding': 'gzip' } });
    assert.ok(response.ok, `Priming ${path} failed: ${response.status}`);
    await response.arrayBuffer();
  }));
}
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const reports: Record<string, unknown>[] = [];
const earlyInputAt = Number(process.env.AGENTS_STARTUP_EARLY_INPUT_AT ?? '-1');
const readyMark = sourceCandidate ? 'startup-probe-source-ready' : 'startup-probe-original-ready';
const paintMark = sourceCandidate ? readyMark : 'workbench-workspace-visible';
const coldFullTimings: number[] = [];
assert.ok(!(requireFullUnderOneSecond || sourceCandidate) || earlyInputAt < 0, 'Workspace checks do not use the temporary startup input');
try {
  for (let round = 1; round <= Number(process.env.AGENTS_STARTUP_ROUNDS ?? 3); round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(({ checkReadiness, sourceCandidate, readyMark, directHistory }) => {
      const state = { firstRow: 0, paint: 0, inputEvent: 0, inputProcessed: 0, inputPaint: 0, earlyInput: 0, earlyPaint: 0,
        hosts: [] as string[], longTasks: [] as { at: number; ms: number }[] };
      Object.assign(window, { yardStartupProbe: state });
      document.addEventListener('input', event => {
        if (!state.earlyInput && event.target instanceof HTMLTextAreaElement && event.target.id === 'pending-yard-home-input') {
          state.earlyInput = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => { state.earlyPaint = performance.now(); }));
        }
        if (state.inputEvent || !(event.target instanceof Element) || !event.target.closest('[data-codex-composer="true"]')) return;
        state.inputEvent = event.timeStamp;
        state.inputProcessed = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => { state.inputPaint = performance.now(); }));
      }, { capture: true });
      window.addEventListener('message', event => {
        if (event.source !== window || event.origin !== location.origin) return;
        const message = event.data;
        if (message?.type === 'codex-app-server-connection-changed' && message.state === 'connected' && !state.hosts.includes(message.hostId)) {
          state.hosts.push(message.hostId);
        }
      });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.longTasks.push({ at: entry.startTime, ms: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
      let scheduled = false;
      const observer = new MutationObserver(() => {
        if (scheduled || state.firstRow) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          const row = [...document.querySelectorAll('[data-yard-startup-thread-row], #app-shell-sidebar [data-app-action-sidebar-thread-row]')]
            .find(row => !row.closest('[inert]') && row.getBoundingClientRect().height > 0 && row.textContent?.trim());
          if (!row) return;
          state.firstRow = performance.now();
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => { state.paint = performance.now(); }));
        });
      });
      observer.observe(document, { childList: true, subtree: true });
      if (!checkReadiness) return;
      function isPointerTarget(element: Element) {
        if (element.closest('[inert], [aria-hidden="true"]')) return false;
        const { x, y, width, height } = element.getBoundingClientRect();
        return width > 0 && height > 0 && element.contains(document.elementFromPoint(x + Math.min(8, width / 2), y + height / 2));
      }
      function workspaceIsInteractive() {
        if (document.getElementById('yard-startup')) return false;
        const root = document.querySelector('#root:not([inert])');
        if (!root) return false;
        if (sourceCandidate && !root.querySelector('.yard-source-frame')) return false;
        const editor = root.querySelector<HTMLElement>('[data-app-shell-frame] [data-codex-composer="true"][contenteditable="true"]');
        if (!editor?.isContentEditable || !isPointerTarget(editor)) return false;
        if (directHistory && ![...root.querySelectorAll('[role="region"][aria-label="Conversation"] p')]
          .some(paragraph => paragraph.textContent === 'Startup answer 0' && isPointerTarget(paragraph))) return false;
        return [...root.querySelectorAll('#app-shell-sidebar [data-app-action-sidebar-thread-row]')]
          .some(row => row.textContent?.trim() && isPointerTarget(row));
      }
      function probeWorkspace() {
        if (!workspaceIsInteractive()) {
          requestAnimationFrame(probeWorkspace);
          return;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (workspaceIsInteractive()) performance.mark(readyMark);
          else requestAnimationFrame(probeWorkspace);
        }));
      }
      requestAnimationFrame(probeWorkspace);
    }, { checkReadiness: requireFullUnderOneSecond || sourceCandidate, sourceCandidate, readyMark, directHistory });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('crash', () => errors.push('Browser renderer process crashed'));
    for (const warm of [false, true]) {
      const conditions = process.env.AGENTS_STARTUP_NETWORK_MBPS || process.env.AGENTS_STARTUP_CPU_RATE
        ? await context.newCDPSession(page) : undefined;
      if (conditions) {
        if (process.env.AGENTS_STARTUP_CPU_RATE) await conditions.send('Emulation.setCPUThrottlingRate', {
          rate: Number(process.env.AGENTS_STARTUP_CPU_RATE),
        });
        if (process.env.AGENTS_STARTUP_NETWORK_MBPS) {
          await conditions.send('Network.enable');
          await conditions.send('Network.emulateNetworkConditions', { offline: false,
            latency: Number(process.env.AGENTS_STARTUP_NETWORK_LATENCY ?? 50),
            downloadThroughput: Number(process.env.AGENTS_STARTUP_NETWORK_MBPS) * 1_000_000 / 8,
            uploadThroughput: Number(process.env.AGENTS_STARTUP_NETWORK_MBPS) * 1_000_000 / 8,
          });
        }
      }
      const profiler = process.env.AGENTS_STARTUP_PROFILE === '1' ? await context.newCDPSession(page) : undefined;
      if (profiler) {
        await profiler.send('Profiler.enable');
        await profiler.send('Performance.enable');
        await profiler.send('Profiler.start');
      }
      const coverage = !warm && process.env.AGENTS_STARTUP_COVERAGE === '1' ? await context.newCDPSession(page) : undefined;
      if (coverage) {
        await coverage.send('Profiler.enable');
        await coverage.send('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
      }
      const target = app.url + (directHistory ? '/local/' + ids[0] : '/');
      const selectedHistoryReads = () => fake.calls('thread/turns/list')
        .filter(call => call.params.threadId === ids[0] && call.params.cursor == null).length;
      const previousHistoryReads = directHistory ? selectedHistoryReads() : 0;
      if (warm && page.url() === target) await page.reload({ waitUntil: 'commit' });
      else await page.goto(target, { waitUntil: 'commit' });
      const started = Date.now();
      let attempted = 0;
      const earlyDraft = !warm && earlyInputAt >= 0 ? 'Early startup benchmark draft' : undefined;
      if (earlyDraft) {
        const pending = page.locator('#pending-yard-home-input');
        await pending.waitFor({ timeout: 15000 });
        const box = await pending.boundingBox();
        assert.ok(box);
        await delay(Math.max(0, started + earlyInputAt - Date.now()));
        attempted = Date.now() - started;
        await page.mouse.click(box.x + 14, box.y + 15);
        await page.keyboard.insertText(earlyDraft);
        await page.waitForFunction(() => Reflect.get(window, 'yardStartupProbe')?.earlyPaint > 0, undefined, { timeout: 15000 });
      }
      try {
        await page.waitForFunction(() => (window as unknown as { yardStartupProbe: { paint: number } }).yardStartupProbe.paint > 0,
          undefined, { timeout: 30000 });
      } catch (error) {
        await page.screenshot({ path: join(output, 'failure.png') });
        await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
        await writeFile(join(output, 'failure.json'), JSON.stringify({ errors, messages: fake.messages }, null, 2));
        throw error;
      }
      const report = await page.evaluate(() => ({
        ...(window as unknown as { yardStartupProbe: object }).yardStartupProbe,
        marks: performance.getEntriesByType('mark').map(entry => ({ name: entry.name, at: entry.startTime })),
        resources: performance.getEntriesByType('resource').map(entry => {
          const resource = entry as PerformanceResourceTiming;
          return { name: resource.name, at: resource.startTime, ms: resource.duration, transfer: resource.transferSize, decoded: resource.decodedBodySize };
        }),
      }));
      const entry = { round, warm, sourceCandidate, directHistory, attempted, ...report, errors: [...errors] };
      reports.push(entry);
      console.log(JSON.stringify({ ...entry, resources: undefined, longTasks: undefined }));
      if (!warm && !sourceCandidate) await page.screenshot({ path: join(output, `cold-${round}.png`) });
      try {
        await page.waitForFunction(mark => !document.getElementById('yard-startup') &&
          (!('workbenchStartupSidebar' in window) || performance.getEntriesByName(mark).length > 0), paintMark, { timeout: 30000 });
      } catch (error) {
        const name = `${warm ? 'warm' : 'cold'}-${round}-workspace-failure`;
        const diagnostics = await Promise.allSettled([
          page.screenshot({ path: join(output, name + '.png') }),
          page.locator('body').ariaSnapshot().then(value => writeFile(join(output, name + '.txt'), value)),
          page.evaluate(() => ({
            probe: (window as unknown as { yardStartupProbe: object }).yardStartupProbe,
            marks: performance.getEntriesByType('mark').map(entry => entry.toJSON()),
            resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()),
            rootChildren: document.getElementById('root')?.childElementCount,
          })),
        ]);
        await writeFile(join(output, name + '.json'), JSON.stringify({ errors, cause: String(error),
          state: diagnostics[2].status === 'fulfilled' ? diagnostics[2].value : undefined,
          diagnosticErrors: diagnostics.filter(result => result.status === 'rejected').map(result => String(result.reason)),
          messages: fake.messages,
        }, null, 2));
        throw error;
      }
      Object.assign(entry, await page.evaluate(mark => ({
        workspaceVisible: performance.getEntriesByName(mark)[0]?.startTime ?? null,
        workspaceMarks: performance.getEntriesByType('mark').map(entry => ({ name: entry.name, at: entry.startTime })),
        workspaceLongTasks: (window as unknown as { yardStartupProbe: { longTasks: object[] } }).yardStartupProbe.longTasks,
        stageMeasures: performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('yard-init:'))
          .map(entry => ({ name: entry.name, at: entry.startTime, ms: entry.duration })),
        workspaceResources: performance.getEntriesByType('resource').map(entry => entry.toJSON()),
      }), paintMark));
      if (sourceCandidate) {
        const pinnedModules = [rendererAssets.client, rendererAssets.shared, rendererAssets.application, rendererAssets.primary, '/workbench-pinned-entry.js'];
        assert.deepEqual(await page.evaluate(paths => performance.getEntriesByType('resource')
          .map(resource => new URL(resource.name).pathname)
          .filter(path => paths.includes(path)), pinnedModules), [], 'The interactive source workspace must not need the pinned JavaScript runtime.');
      }
      if (requireFullUnderOneSecond) {
        await page.waitForFunction(() => performance.getEntriesByName('startup-probe-original-ready').length > 0);
        const observed = await page.evaluate(() => Math.max(
          performance.getEntriesByName('startup-probe-original-ready')[0]!.startTime,
          performance.getEntriesByName('workbench-workspace-visible')[0]!.startTime,
        ));
        Object.assign(entry, { originalWorkspaceReady: observed });
        if (!warm) coldFullTimings.push(observed);
      }
      if (coverage) {
        const { result } = await coverage.send('Profiler.takePreciseCoverage');
        await coverage.send('Profiler.stopPreciseCoverage');
        await coverage.detach();
        await writeFile(join(output, `cold-${round}-coverage.json`),
          JSON.stringify(result.filter(script => /\/assets\/[^/]+\.js$/.test(script.url))));
      }
      if (profiler) {
        const { profile } = await profiler.send('Profiler.stop');
        await writeFile(join(output, `${warm ? 'warm' : 'cold'}-${round}.cpuprofile`), JSON.stringify(profile));
        await writeFile(join(output, `${warm ? 'warm' : 'cold'}-${round}-metrics.json`), JSON.stringify(await profiler.send('Performance.getMetrics')));
        await profiler.detach();
        if (round === 1 && !warm) {
          const urls = [...new Set(profile.nodes.map((node: { callFrame: { url: string } }) => node.callFrame.url))]
            .filter((url): url is string => typeof url === 'string' && /\/assets\/app-(initial|shared|primary)-[^/]+\.js$/.test(url));
          await Promise.all(urls.map(async url => writeFile(join(output, new URL(url).pathname.split('/').at(-1)!), await (await fetch(url)).text())));
        }
      }
      // Exercise the real editor after handoff. Request-to-paint includes
      // Playwright's command/actionability delay; event-to-paint measures the
      // dispatched input event. Neither is a field INP measurement.
      const editor = page.locator('#root [data-codex-composer="true"]').last();
      const previousInput = await editor.textContent() ?? '';
      if (earlyDraft) assert.equal(previousInput, earlyDraft);
      await page.evaluate(() => performance.mark('startup-probe-input-request'));
      await editor.click();
      await page.keyboard.press('y');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        performance.mark('startup-probe-input-painted');
        resolve();
      }))));
      assert.equal(await editor.textContent(), previousInput + 'y');
      Object.assign(entry, await page.evaluate(mark => {
        const painted = performance.getEntriesByName('startup-probe-input-painted')[0]!.startTime;
        const input = (window as unknown as { yardStartupProbe: { inputEvent: number; inputPaint: number } }).yardStartupProbe;
        return {
          firstInputPaint: painted,
          inputEventToPaintMs: input.inputPaint - input.inputEvent,
          inputRequestToPaintMs: painted - performance.getEntriesByName('startup-probe-input-request')[0]!.startTime,
          workspaceToInputPaintMs: painted - performance.getEntriesByName(mark)[0]!.startTime,
        };
      }, paintMark));
      if (directHistory) {
        assert.equal(selectedHistoryReads() - previousHistoryReads, 1, 'The source workspace must consume the initial history read once.');
        assert.ok(await page.evaluate(() => {
          const requested = performance.getEntriesByName('workbench-source-history-requested')[0];
          const consumed = performance.getEntriesByName('workbench-source-history-consumed')[0];
          return requested && consumed && requested.startTime < consumed.startTime;
        }), 'Initial history must start in the browser host before React takes it.');
      }
      await editor.fill('');
      if (!directHistory && (warm || requireFullUnderOneSecond || sourceCandidate)) {
        const previousHistoryReads = selectedHistoryReads();
        await page.evaluate(() => {
          document.addEventListener('click', () => performance.mark('startup-probe-click'), { once: true, capture: true });
        });
        const click = performance.now();
        await page.locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]')
          .filter({ hasText: 'Startup conversation 0' }).first().click();
        try { await page.getByText('Startup answer 0', { exact: true }).waitFor({ timeout: 15000 }); }
        catch (error) {
          await page.screenshot({ path: join(output, 'history-failure.png') });
          await writeFile(join(output, 'history-failure.txt'), await page.locator('body').ariaSnapshot());
          await writeFile(join(output, 'history-failure.json'), JSON.stringify({ errors, messages: fake.messages }, null, 2));
          throw error;
        }
        Object.assign(entry, { clickToHistoryMs: performance.now() - click,
          firstHistoryPaint: await page.evaluate(() => new Promise<number>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))))),
          clickDispatchMs: await page.evaluate(() => {
            const event = performance.getEntriesByName('startup-probe-click')[0];
            const ready = (window as unknown as { yardStartupProbe: { paint: number } }).yardStartupProbe.paint;
            return event ? event.startTime - ready : null;
          }) });
        await page.screenshot({ path: join(output, `history-${round}.png`) });
        if (sourceCandidate) {
          assert.equal(selectedHistoryReads() - previousHistoryReads, 1, 'A selected conversation should read its first history page once.');
          const connectedHosts = await page.evaluate(() => Reflect.get(window, 'yardStartupProbe').hosts as string[]);
          Object.assign(entry, { connectedHosts });
          console.log(JSON.stringify({ round, warm, sourceCandidate, connectedHosts,
            ...Object.fromEntries(Object.entries(entry).filter(([key]) => ['workspaceVisible', 'firstInputPaint', 'firstHistoryPaint'].includes(key))) }));
        } else {
          await page.waitForFunction(() => (window as unknown as { yardStartupProbe: { hosts: string[] } }).yardStartupProbe.hosts.length === 4,
            undefined, { timeout: 10000 });
          assert.ok(fake.calls('thread/list').some(call => call.params.cursor != null), 'background pagination must resume');
        }
      }
      await conditions?.detach();
      assert.deepEqual(errors, []);
    }
    await context.close();
  }
  if (requireFullUnderOneSecond) {
    assert.ok(coldFullTimings.length > 0 && coldFullTimings.every(ms => ms < 1000),
      `Original workspace exceeded the cold-start budget: ${coldFullTimings.map(ms => ms.toFixed(1)).join(', ')} ms`);
  }
  if (process.argv.includes('--check-handoff')) {
    const homeGeometry = (page: Page, startup: boolean) => page.evaluate(startup => {
      const box = (selector: string) => {
        const element = document.querySelector(selector)!;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        composer: box(startup ? '.yard-startup-composer' : '[data-composer-body]'),
        heading: box(startup ? '.yard-startup-hero h1' : '.heading-xl[data-feature="game-source"]'),
        icon: box(startup ? '.yard-startup-hero img' : '[data-testid="home-icon"]'),
        homeFrame: box(startup ? '.yard-startup-home' : '[class^="group/home-composer-layout"]'),
        heroRegion: box(startup ? '.yard-startup-hero-region' : '[class*="min-h-fit grow basis-0 pb-24"]'),
        headingText: document.querySelector(startup ? '.yard-startup-hero h1' : '.heading-xl[data-feature="game-source"]')!.textContent,
        headingFont: getComputedStyle(document.querySelector(startup ? '.yard-startup-hero h1' : '.heading-xl[data-feature="game-source"]')!).font,
      };
    }, startup);
    type HomeGeometry = Awaited<ReturnType<typeof homeGeometry>>;
    const assertSameHome = (before: HomeGeometry, after: HomeGeometry) => {
      for (const region of ['composer', 'heading', 'icon'] as const) for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
        assert.ok(Math.abs(before[region][coordinate] - after[region][coordinate]) < 1,
          `${region}.${coordinate}: startup ${before[region][coordinate]}, native ${after[region][coordinate]}`);
      }
    };
    // Hold the original runtime and styles to prove recent metadata can paint
    // independently, then release them and verify the normal app takes over.
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const first = await isolated.newPage();
    await first.addInitScript(() => localStorage.setItem('native-atoms', JSON.stringify({ 'sidebar-width': 480 })));
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let releaseLists!: () => void;
    const blockedLists = new Promise<void>(resolve => { releaseLists = resolve; });
    fake.handlers.set('thread/list', async params => { await blockedLists; return fake.defaultResult('thread/list', params); });
    const firstErrors: string[] = [];
    let initialHome!: HomeGeometry;
    first.on('pageerror', error => firstErrors.push(error.message));
    await first.route('**/assets/app-shared-*.js', async route => { await blocked; await route.continue(); });
    await first.route('**/assets/*.css', async route => { await blocked; await route.continue(); });
    try {
      await first.goto(app.url, { waitUntil: 'commit' });
      await first.locator('[data-yard-startup-skeleton]').first().waitFor({ timeout: 10000 });
      assert.equal(await first.locator('#yard-startup nav').getAttribute('aria-busy'), 'true');
      assert.equal((await first.locator('#yard-startup aside').boundingBox())!.width, 480);
      await first.screenshot({ path: join(output, 'startup-skeleton-dark.png') });
      releaseLists();
      await first.locator('[data-yard-startup-thread-row]').first().waitFor({ timeout: 10000 });
      assert.equal(await first.locator('[data-yard-startup-skeleton]').count(), 0, 'Real metadata replaces the loading rows');
      assert.equal(await first.locator('#yard-startup nav').getAttribute('aria-busy'), 'false');
      initialHome = await homeGeometry(first, true);
      assert.ok(initialHome.composer.y > 900 * .75, 'The home composer starts at the bottom of the workspace');
      assert.equal(await first.locator('#pending-yard-home-input').evaluate(element => getComputedStyle(element).resize), 'none');
      assert.equal(await first.evaluate(() => performance.getEntriesByName('workbench-rpc-ready').length), 0);
      assert.equal(await first.locator('#yard-startup').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(33, 33, 33)');
      const icons = first.locator('.yard-startup-project svg');
      assert.equal(await icons.count(), projectPaths.length, 'Each startup project must show its folder before deferred assets load');
      for (const icon of await icons.all()) {
        assert.deepEqual(await icon.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height, hasPath: !!element.querySelector('path[d]'),
            inheritsColor: getComputedStyle(element).stroke === getComputedStyle(element.parentElement!).color };
        }), { width: 16, height: 16, hasPath: true, inheritsColor: true });
      }
      await first.screenshot({ path: join(output, 'startup-independent-dark.png') });
    } finally { releaseLists(); fake.handlers.delete('thread/list'); release(); }
    await first.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 30000 });
    assert.equal((await first.locator('#app-shell-sidebar').boundingBox())!.width, 480, 'The native sidebar keeps the startup width');
    const nativeHome = await homeGeometry(first, false);
    await writeFile(join(output, 'home-layout-dark.json'), JSON.stringify({ before: initialHome, after: nativeHome }, null, 2));
    await first.screenshot({ path: join(output, 'native-home-dark.png') });
    assertSameHome(initialHome, nativeHome);
    await first.locator('[data-codex-composer="true"]').last().fill('Independent React root handoff');
    assert.deepEqual(firstErrors, []);
    reports.push({ startupIndependentOfWorkspaceRuntime: true, startupProjectIconsIndependentOfDeferredAssets: true,
      slowMetadataShowsSkeleton: true, savedSidebarWidthMatchesHandoff: true, homeLayoutMatchesNative: true, initialHome });
    await isolated.close();
    for (const layout of [
      { name: 'zoom', viewport: { width: 1440, height: 900 }, zoom: 1.2 },
      { name: 'mobile', viewport: { width: 390, height: 844 }, zoom: 1 },
    ]) {
      const layoutContext = await browser.newContext({ viewport: layout.viewport, colorScheme: 'light', reducedMotion: 'reduce' });
      const layoutPage = await layoutContext.newPage();
      const layoutErrors: string[] = [];
      layoutPage.on('pageerror', error => layoutErrors.push(error.message));
      await layoutPage.addInitScript(zoom => localStorage.setItem('native-atoms', JSON.stringify({
        'sidebar-width': 480, 'electron:window-zoom': zoom,
      })), layout.zoom);
      let releaseCss!: () => void, releaseJs!: () => void;
      const css = new Promise<void>(resolve => { releaseCss = resolve; });
      const js = new Promise<void>(resolve => { releaseJs = resolve; });
      await layoutPage.route('**/assets/app-shared-*.js', async route => { await js; await route.continue(); });
      await layoutPage.route('**/assets/*.css', async route => { await css; await route.continue(); });
      const geometry = () => layoutPage.locator('[data-yard-startup-thread-row]').first().evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: getComputedStyle(element).font };
      });
      let initialHome!: HomeGeometry;
      try {
        await layoutPage.goto(app.url, { waitUntil: 'commit' });
        if (layout.name === 'mobile') await layoutPage.getByRole('button', { name: '打开侧栏', exact: true }).click();
        await layoutPage.locator('[data-yard-startup-thread-row]').first().waitFor({ timeout: 10000 });
        assert.equal(await layoutPage.locator('.yard-startup-skeleton').first().evaluate(element => getComputedStyle(element).animationName), 'none');
        assert.equal(await layoutPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const overlay = (await layoutPage.locator('#yard-startup').boundingBox())!;
        assert.ok(Math.abs(overlay.width - layout.viewport.width) < 1 && Math.abs(overlay.height - layout.viewport.height) < 1,
          'The startup surface must cover the viewport at the saved zoom');
        if (layout.name === 'zoom') {
          const sidebar = (await layoutPage.locator('#yard-startup aside').boundingBox())!;
          const input = (await layoutPage.locator('#pending-yard-home-input').boundingBox())!;
          assert.ok(input.x >= sidebar.x + sidebar.width && input.x + input.width <= layout.viewport.width,
            'Early input must stay inside the workspace');
        }
        const before = await geometry();
        initialHome = await homeGeometry(layoutPage, true);
        assert.ok(before.width > 0);
        await layoutPage.screenshot({ path: join(output, `startup-independent-${layout.name}.png`) });
        releaseCss();
        await layoutPage.waitForFunction(() => [...document.querySelectorAll<HTMLLinkElement>('link[data-yard-workspace-style]')].every(link => !!link.sheet));
        assert.deepEqual(await geometry(), before, 'Enabling the deferred stylesheet must not restyle the startup rows');
        assert.deepEqual(await homeGeometry(layoutPage, true), initialHome, 'Deferred CSS keeps the startup home layout');
        if (layout.name === 'zoom') assert.equal((await layoutPage.locator('#yard-startup aside').boundingBox())!.width, 480 * layout.zoom);
      } finally { releaseCss(); releaseJs(); }
      await layoutPage.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 30000 });
      if (layout.name === 'zoom') assert.equal((await layoutPage.locator('#app-shell-sidebar').boundingBox())!.width, 480 * layout.zoom);
      const nativeHome = await homeGeometry(layoutPage, false);
      await writeFile(join(output, `home-layout-${layout.name}.json`), JSON.stringify({ before: initialHome, after: nativeHome }, null, 2));
      await layoutPage.screenshot({ path: join(output, `native-home-${layout.name}.png`) });
      assertSameHome(initialHome, nativeHome);
      assert.deepEqual(layoutErrors, []);
      reports.push({ layout: layout.name, reducedMotion: true, deferredCssKeepsGeometryAndFont: true, homeLayoutMatchesNative: true, initialHome, errors: layoutErrors });
      await layoutContext.close();
    }
    const draftContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const draftPage = await draftContext.newPage();
    let releaseDraftRuntime!: () => void;
    const draftRuntime = new Promise<void>(resolve => { releaseDraftRuntime = resolve; });
    await draftPage.route('**/assets/app-shared-*.js', async route => { await draftRuntime; await route.continue(); });
    const draftErrors: string[] = [];
    draftPage.on('pageerror', error => draftErrors.push(error.message));
    const draftText = '启动草稿\n第二行内容\n第三行内容';
    try {
      await draftPage.goto(app.url, { waitUntil: 'commit' });
      const pending = draftPage.locator('#pending-yard-home-input');
      await pending.fill(draftText);
      assert.ok((await pending.boundingBox())!.height >= 60, 'The startup card grows for multiline input');
      await pending.evaluate((element: HTMLTextAreaElement) => {
        element.setSelectionRange(2, 4);
      });
      releaseDraftRuntime();
      await draftPage.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 30000 });
      assert.deepEqual(await draftPage.locator('[data-codex-composer="true"] p').allTextContents(), draftText.split('\n'));
      assert.equal(await draftPage.evaluate(() => window.getSelection()?.toString()), '草稿');
      assert.equal(await draftPage.locator('[data-codex-composer="true"]').evaluate(element => element.contains(document.activeElement)), true);
      assert.deepEqual(draftErrors, []);
      reports.push({ multilineHomeDraftAdopted: true, selectionAndFocusTransferred: true, errors: draftErrors });
    } finally { releaseDraftRuntime(); await draftContext.close(); }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (location.pathname !== '/') return;
      const observer = new MutationObserver(() => {
        const row = [...document.querySelectorAll<HTMLButtonElement>('[data-yard-startup-thread-row]')]
          .find(row => row.textContent === 'Startup conversation 0');
        if (!row) return;
        observer.disconnect();
        requestAnimationFrame(() => {
          row.click();
          performance.mark('startup-probe-early-selection');
        });
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto(app.url, { waitUntil: 'commit' });
    await page.getByText('Startup answer 0', { exact: true }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('yard-startup'), undefined, { timeout: 15000 });
    const marks = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map(entry => [entry.name, entry.startTime])));
    assert.ok(marks['startup-probe-early-selection'] < marks['workbench-render-requested'], 'selection must happen before the full renderer mounts');
    assert.equal(new URL(page.url()).searchParams.get('initialRoute'), '/local/' + ids[0]);
    assert.equal(await page.locator('#root').getAttribute('inert'), null, 'handoff must restore input and accessibility');
    assert.deepEqual(errors, []);
    reports.push({ earlySelectionPassed: true, marks });
    await page.screenshot({ path: join(output, 'early-selection.png') });
    // Extensionless links use the server's initial-route meta tag; startup
    // must follow that same route and also release non-conversation pages.
    for (const route of ['/local/' + ids[0], '/plugins', '/settings/connections/ssh']) {
      await page.goto(app.url + route, { waitUntil: 'commit' });
      try { await page.waitForFunction(conversation => conversation ? performance.getEntriesByName('workbench-workspace-visible').length > 0 :
        !!document.querySelector('#root [data-app-shell-frame]') && !document.getElementById('root')?.inert && !document.getElementById('yard-startup'),
      route.startsWith('/local/'), { timeout: 20000 }); }
      catch (error) {
        await writeFile(join(output, 'route-failure.json'), JSON.stringify({ route, state: await page.evaluate(() => ({
          route: (window as unknown as { workbenchStartupSidebar: { route(): string | null } }).workbenchStartupSidebar.route(),
          shell: !!document.querySelector('[data-app-shell-frame]'), rows: document.querySelectorAll('[data-app-action-sidebar-thread-row]').length,
          text: document.body.innerText, marks: performance.getEntriesByType('mark').map(entry => ({ name: entry.name, at: entry.startTime })),
        })) }, null, 2));
        throw error;
      }
      assert.equal(await page.locator('#root').getAttribute('inert'), null);
      if (route.startsWith('/local/')) await page.getByText('Startup answer 0', { exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    reports.push({ directRoutesTakeOver: true });
    await context.close();

    // Restored, collapsed projects intentionally contain no mounted thread
    // rows. They must still take over from the initial metadata view.
    hosts.splice(0); // Offer only the local fixture to this new browser client.
    const collapsed = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const collapsedPage = await collapsed.newPage();
    const projectIds = [...fake.projects.keys()];
    assert.equal(projectIds.length, projectPaths.length);
    await collapsedPage.addInitScript(ids => {
      localStorage.setItem('native-atoms', JSON.stringify({
        ...Object.fromEntries(ids.map(id => [`sidebar-project-expanded-v1-codex:${id}`, false])),
      }));
    }, projectIds);
    await collapsedPage.goto(app.url, { waitUntil: 'commit' });
    try { await collapsedPage.waitForFunction(() => performance.getEntriesByName('workbench-workspace-visible').length > 0, undefined, { timeout: 20000 }); }
    catch (error) {
      await writeFile(join(output, 'collapsed-failure.json'), JSON.stringify(await collapsedPage.evaluate(() => ({
        text: document.body.innerText, shell: !!document.querySelector('[data-app-shell-frame]'),
        projects: [...document.querySelectorAll('[data-app-action-sidebar-project-id]')].map(project => ({ id: project.getAttribute('data-app-action-sidebar-project-id'), collapsed: project.getAttribute('data-app-action-sidebar-project-collapsed') })),
        marks: performance.getEntriesByType('mark').map(entry => ({ name: entry.name, at: entry.startTime })),
      })), null, 2));
      throw error;
    }
    await collapsedPage.locator('[data-app-action-sidebar-project-collapsed="true"]').first().waitFor();
    assert.equal(await collapsedPage.locator('[data-app-action-sidebar-project-collapsed="true"]').count(), projectPaths.length);
    reports.push({ collapsedProjectsTakeOver: true });
    await collapsedPage.addInitScript(() => {
      const saved = JSON.parse(localStorage.getItem('native-atoms') ?? '{}');
      saved['sidebar-collapsed-sections-v1'] = { chats: true, cloud: true, pinned: true, threads: true };
      localStorage.setItem('native-atoms', JSON.stringify(saved));
    });
    await collapsedPage.reload({ waitUntil: 'commit' });
    await collapsedPage.waitForFunction(() => performance.getEntriesByName('workbench-workspace-visible').length > 0, undefined, { timeout: 20000 });
    assert.equal(await collapsedPage.locator('#app-shell-sidebar [data-app-action-sidebar-thread-row]:visible').count(), 0);
    reports.push({ collapsedSectionsTakeOver: true });
    await collapsed.close();
  }
  if (process.argv.includes('--check-empty')) {
    fake.threads.clear();
    const context = await browser.newContext();
    const page = await context.newPage();
    const previous = fake.calls('model/list').length;
    await page.goto(app.url, { waitUntil: 'commit' });
    await page.locator('#app-shell-sidebar').waitFor({ timeout: 15000 });
    await fake.waitForCall('model/list', previous + 1);
    assert.equal(await page.locator('[data-app-action-sidebar-thread-row]').count(), 0);
    reports.push({ emptySidebarLoads: true });
    await context.close();

    // A hidden mobile sidebar has no visible rows. Model setup must still run
    // without relying on the sidebar being opened.
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mobilePage = await mobile.newPage();
    const previousMobile = fake.calls('model/list').length;
    await mobilePage.goto(app.url, { waitUntil: 'commit' });
    await mobilePage.locator('[data-app-shell-sidebar-trigger][aria-expanded="false"]:visible').first().waitFor({ timeout: 15000 });
    await fake.waitForCall('model/list', previousMobile + 1);
    reports.push({ collapsedSidebarLoads: true });
    await mobile.close();
  }
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify({ source, reports }, null, 2));
  await browser.close();
  await app.close();
  await fake.close();
  await rm(root, { recursive: true, force: true });
}
