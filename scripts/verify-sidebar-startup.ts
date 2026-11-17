// Run under the shared heavy-browser lock. Conversations and hosts are synthetic.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const source = resolve(process.env.AGENTS_STARTUP_SOURCE ?? '.');
const { createNativeWorkbench } = await import(pathToFileURL(join(source, 'src/native/server.ts')).href) as typeof import('../src/native/server.ts');
const output = resolve(process.env.AGENTS_STARTUP_EVIDENCE ?? '.local/sidebar-startup');
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
  codexHome: join(root, 'codex'), hostCatalog: { hosts, projects: [], assignments: {} },
  sshStream: (_host, onPaths) => {
    onPaths?.({ homeDirectory: root, codexHome: join(root, 'codex') });
    return createConnection(fake.socketPath);
  }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const reports: Record<string, unknown>[] = [];
try {
  for (let round = 1; round <= Number(process.env.AGENTS_STARTUP_ROUNDS ?? 3); round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const state = { firstRow: 0, paint: 0, hosts: [] as string[], longTasks: [] as { at: number; ms: number }[] };
      Object.assign(window, { yardStartupProbe: state });
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
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const warm of [false, true]) {
      const profiler = process.env.AGENTS_STARTUP_PROFILE === '1' ? await context.newCDPSession(page) : undefined;
      if (profiler) {
        await profiler.send('Profiler.enable');
        await profiler.send('Performance.enable');
        await profiler.send('Profiler.start');
      }
      if (warm) await page.reload({ waitUntil: 'commit' });
      else await page.goto(app.url, { waitUntil: 'commit' });
      try {
        await page.waitForFunction(() => (window as unknown as { yardStartupProbe: { paint: number } }).yardStartupProbe.paint > 0,
          undefined, { timeout: 30000 });
      } catch (error) {
        await page.screenshot({ path: join(output, 'failure.png') });
        await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
        await writeFile(join(output, 'failure.json'), JSON.stringify({ errors, messages: fake.messages }, null, 2));
        throw error;
      }
      if (profiler) {
        const { profile } = await profiler.send('Profiler.stop');
        await writeFile(join(output, `${warm ? 'warm' : 'cold'}-${round}.cpuprofile`), JSON.stringify(profile));
        await writeFile(join(output, `${warm ? 'warm' : 'cold'}-${round}-metrics.json`), JSON.stringify(await profiler.send('Performance.getMetrics')));
        await profiler.detach();
      }
      const report = await page.evaluate(() => ({
        ...(window as unknown as { yardStartupProbe: object }).yardStartupProbe,
        marks: performance.getEntriesByType('mark').map(entry => ({ name: entry.name, at: entry.startTime })),
        resources: performance.getEntriesByType('resource').map(entry => {
          const resource = entry as PerformanceResourceTiming;
          return { name: resource.name, at: resource.startTime, ms: resource.duration, transfer: resource.transferSize, decoded: resource.decodedBodySize };
        }),
      }));
      const entry = { round, warm, ...report, errors: [...errors] };
      reports.push(entry);
      console.log(JSON.stringify({ ...entry, resources: undefined, longTasks: undefined }));
      if (!warm) await page.screenshot({ path: join(output, `cold-${round}.png`) });
      await page.waitForFunction(() => !document.getElementById('yard-startup') &&
        (!('workbenchStartupSidebar' in window) || performance.getEntriesByName('workbench-workspace-visible').length > 0), undefined, { timeout: 15000 });
      Object.assign(entry, await page.evaluate(() => ({
        workspaceVisible: performance.getEntriesByName('workbench-workspace-visible')[0]?.startTime ?? null,
        workspaceMarks: performance.getEntriesByType('mark').map(entry => ({ name: entry.name, at: entry.startTime })),
      })));
      if (warm) {
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
          clickDispatchMs: await page.evaluate(() => {
            const event = performance.getEntriesByName('startup-probe-click')[0];
            const ready = (window as unknown as { yardStartupProbe: { paint: number } }).yardStartupProbe.paint;
            return event ? event.startTime - ready : null;
          }) });
        await page.screenshot({ path: join(output, `history-${round}.png`) });
        await page.waitForFunction(() => (window as unknown as { yardStartupProbe: { hosts: string[] } }).yardStartupProbe.hosts.length === 4,
          undefined, { timeout: 10000 });
        assert.ok(fake.calls('thread/list').some(call => call.params.cursor != null), 'background pagination must resume');
      }
      assert.deepEqual(errors, []);
    }
    await context.close();
  }
  if (process.argv.includes('--check-handoff')) {
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
    await collapsedPage.addInitScript(paths => {
      localStorage.setItem('native-atoms', JSON.stringify({
        ...Object.fromEntries(paths.map(path => [`sidebar-project-expanded-v1-codex:${path}`, false])),
      }));
    }, projectPaths);
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
