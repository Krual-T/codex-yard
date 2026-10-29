import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';

// Run the production entry from a separately archived, fixed source tree.
function requiredDirectory(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to an isolated directory.`);
  return resolve(value);
}
const source = requiredDirectory('YARD_MAIN_EDIT_SOURCE');
const runtime = requiredDirectory('YARD_MAIN_EDIT_RUNTIME');
const artifacts = requiredDirectory('YARD_TEST_ARTIFACTS');
const selected = process.env.YARD_MAIN_EDIT_SCENARIOS?.split(',').filter(Boolean);
const knownScenarios = new Set(['same-thread-dom', 'navigation-drain-and-restore', 'history-failure-unfreezes',
  'pending-acquisition-navigation', 'pending-submit-navigation', 'pending-submit-reconnect', 'cross-page-adopt-latest',
  'late-receipt-preserves-newer-page', 'settings-update-does-not-carry-overrides', 'archive-during-navigation', 'history-current-replace-failure',
  'history-initial-replace-failure', 'idb-wait-requires-persisted-text', 'cold-load-navigation', 'cold-load-navigation-failure',
  'cold-history-failure-retry-navigation']);
if (selected && (!selected.length || selected.some(name => !knownScenarios.has(name)))) {
  throw new Error('YARD_MAIN_EDIT_SCENARIOS must contain known scenario names.');
}
await mkdir(artifacts, { recursive: true });
for (const name of ['workspace', 'data', 'browser']) await mkdir(join(runtime, name), { recursive: true });
await readFile(join(source, '.local/renderer/workbench-entry.js'));
const load = (path: string) => pathToFileURL(join(source, path)).href;
const { createNativeWorkbench } = await import(load('src/native/server.ts')) as typeof import('../src/native/server.ts');
const { createFakeCodex, fixtureThread, fixtureTurn, agentItem } = await import(load('test/fake-codex.ts')) as typeof import('../test/fake-codex.ts');

const workspace = join(runtime, 'workspace');
const fake = await createFakeCodex(runtime);
const names = ['same', 'navigation', 'history', 'acquire', 'connection', 'pending-navigation', 'cross-page', 'late', 'settings',
  'archive-during-navigation', 'history-current-replace-failure', 'history-initial-replace-failure', 'idb-wait-requires-persisted-text',
  'cold-load-navigation', 'cold-load-navigation-failure', 'cold-history-failure-retry-navigation'];
for (const name of names) {
  fake.threads.set(name, fixtureThread(name, workspace, { name: `Edit ${name}`, turns: [fixtureTurn('turn-' + name, [
    { id: 'user-' + name, type: 'userMessage', content: [{ type: 'text', text: 'Original ' + name, text_elements: [] }] },
    agentItem('agent-' + name, 'Fixture ' + name),
  ])] }));
}
await writeFile(join(runtime, 'data/native-state.json'), JSON.stringify({
  globals: { 'local-projects': { fixture: { id: 'fixture', name: 'Edit fixture', rootPaths: [workspace] } } },
  settings: { localeOverride: 'en-US' },
}));
await writeFile(join(runtime, 'data/projects.json'), JSON.stringify([{ path: workspace, name: 'Edit fixture' }]));
const browser = await chromium.launchPersistentContext(join(runtime, 'browser'), {
  executablePath: process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-background-networking'], viewport: { width: 1360, height: 900 },
}).catch(async error => { await fake.close(); throw error; });
const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(runtime, 'codex'),
  dataDir: join(runtime, 'data'), workspace, port: 0 }).catch(async error => {
  try { await browser.close(); } finally { await fake.close(); }
  throw error;
});
const errors: string[] = [];
const results: { name: string; status: 'pass' | 'fail'; details?: string }[] = [];
const observations: Record<string, unknown> = {};
const openPages: Page[] = [];

async function newPage(thread: string, options?: { path?: string; beforeGoto?: (page: Page) => Promise<void>; cold?: boolean }) {
  const page = await browser.newPage(); openPages.push(page);
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => errors.push(error.message));
  const entryResponses: number[] = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/workbench-entry.js') entryResponses.push(response.status());
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await options?.beforeGoto?.(page);
  const response = await page.goto(app.url + (options?.path ?? '/local/' + thread));
  assert.equal(response?.status(), 200);
  assert.match(await response!.text(), /<script type="module" src="\/workbench-entry\.js"><\/script>/);
  assert.deepEqual(entryResponses, [200]);
  if (options?.cold) await page.locator('.yard-conversation .yard-loading').waitFor();
  else {
    await page.getByText('Fixture ' + thread, { exact: true }).waitFor();
    await page.locator('.yard-message-edit, button[aria-label="Edit message"]').first().waitFor({ state: 'visible' });
  }
  await page.waitForFunction(() => document.querySelector('.yard-connection')?.getAttribute('title') === 'Browser: connected; Host: connected');
  return page;
}
const editor = (page: Page) => page.getByRole('textbox', { name: 'Edit message text', exact: true });
async function startEdit(page: Page, text: string) {
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  await editor(page).fill(text);
}
async function waitForEdit(page: Page, thread: string, text: string, timeoutMs = 10_000) {
  let observed: EditRecord | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = async () => {
    while (!stopped) {
      observed = await readEdit(page, thread);
      if (stopped || observed?.recovery.draft.text === text) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for persisted edit ${JSON.stringify(text)}; last text: ${JSON.stringify(observed?.recovery.draft.text)}`)), timeoutMs);
  });
  try { await Promise.race([wait(), timeout]); }
  finally { stopped = true; clearTimeout(timer); }
}
type EditRecord = { recovery: { draft: { text: string }; editor: { sessionId: string; revision: number } };
  submission?: { operationId: string; stage: string } };
async function readEdit(page: Page, thread: string): Promise<EditRecord | undefined> {
  return page.evaluate(async id => new Promise<EditRecord | undefined>((done, reject) => {
    const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('atoms', 'readonly');
      const request = tx.objectStore('atoms').get('native-atoms');
      request.onsuccess = () => done(request.result?.atoms?.['codex-yard.message-edits.v1']?.[JSON.stringify(['local', id])]);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    };
  }), thread);
}
async function holdUiWrites(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((done, reject) => {
      const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('atoms', 'readwrite'), store = tx.objectStore('atoms');
        let held = true, entered = false;
        const state = window as unknown as { releaseEditGate?: () => void; editGateTransaction?: IDBTransaction };
        state.releaseEditGate = () => { held = false; }; state.editGateTransaction = tx;
        tx.oncomplete = () => db.close();
        const keep = () => { const request = store.get('native-atoms'); request.onsuccess = () => {
          if (!entered) { entered = true; done(); }
          if (held) keep();
        }; };
        keep();
      };
    });
  });
}
async function releaseUiWrites(page: Page) {
  await page.evaluate(() => (window as unknown as { releaseEditGate?: () => void }).releaseEditGate?.());
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}
function calls(method: string, thread: string) {
  return fake.calls(method).filter(message => message.params.threadId === thread);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function scenario(name: string, run: () => Promise<void>) {
  if (selected && !selected.includes(name)) return;
  try {
    await run();
    const screenshotPage = openPages.find(page => !page.isClosed());
    if (screenshotPage) await screenshotPage.screenshot({ path: join(artifacts, name + '.png') });
    results.push({ name, status: 'pass' });
  } catch (error) {
    const details = error instanceof Error ? error.stack ?? error.message : String(error);
    results.push({ name, status: 'fail', details });
    for (let i = 0; i < openPages.length; i++) {
      const page = openPages[i]!;
      if (page.isClosed()) continue;
      await page.screenshot({ path: join(artifacts, `${name}-failure-${i}.png`), fullPage: true }).catch(() => {});
      const diagnostic = await page.evaluate(() => ({ url: location.href,
        connection: document.querySelector('.yard-connection')?.getAttribute('title'),
        active: document.activeElement?.outerHTML, alerts: [...document.querySelectorAll('[role="alert"]')].map(item => item.textContent),
        editors: [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Edit message text"]')].map(item => ({ value: item.value, disabled: item.disabled, inert: !!item.closest('[inert]') })),
        text: document.body.innerText,
      })).catch(() => ({}));
      await writeFile(join(artifacts, `${name}-diagnostic-${i}.json`), JSON.stringify(diagnostic, null, 2));
    }
  } finally {
    for (const page of openPages.splice(0)) {
      if (!page.isClosed()) { await releaseUiWrites(page).catch(() => {}); await page.close().catch(() => {}); }
    }
  }
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ source, chrome: browser.browser()?.version(), results, observations,
    peerCalls: [...fake.calls('thread/revert'), ...fake.calls('turn/start'), ...fake.calls('thread/settings/update')], errors }, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}

async function coldLoadNavigation(thread: string, failNavigation: boolean, initialHistoryFailure = false) {
  const fixturePath = join(workspace, 'barrier.txt');
  await writeFile(fixturePath, 'file recovery barrier fixture\n');
  const seed = await newPage(thread);
  await startEdit(seed, 'cold persisted draft'); await waitForEdit(seed, thread, 'cold persisted draft');
  const saved = await readEdit(seed, thread);
  assert(saved);
  await seed.close();

  const historyEntered = deferred(), releaseHistory = deferred(), firstResumeEntered = deferred(), releaseFirstResume = deferred(),
    releaseRetryResume = deferred();
  let rejectFirstResume = initialHistoryFailure;
  if (initialHistoryFailure) fake.handlers.set('thread/resume', async params => {
    if (params.threadId === thread && rejectFirstResume) {
      rejectFirstResume = false; firstResumeEntered.resolve(); await releaseFirstResume.promise;
      throw new Error('fixture first history failure');
    }
    if (params.threadId === thread) await releaseRetryResume.promise;
    return fake.defaultResult('thread/resume', params);
  });
  fake.handlers.set('thread/turns/list', async params => {
    if (params.threadId === thread) { historyEntered.resolve(); await releaseHistory.promise; }
    return fake.defaultResult('thread/turns/list', params);
  });
  fake.handlers.set('fs/getMetadata', params => {
    const file = params.path === fixturePath;
    if (!file && params.path !== workspace) throw new Error('Unexpected fixture path: ' + String(params.path));
    return { isFile: file, isDirectory: !file, isSymlink: false, createdAtMs: 1, modifiedAtMs: 1 };
  });
  fake.handlers.set('fs/readDirectory', params => {
    assert.equal(params.path, workspace);
    return { entries: [{ fileName: 'barrier.txt', isFile: true, isDirectory: false }] };
  });
  let page: Page | undefined;
  try {
    page = await newPage(thread, { cold: true });
    if (initialHistoryFailure) {
      await Promise.race([firstResumeEntered.promise, new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('First history request did not reach the peer')), 10_000).unref();
      })]);
      releaseFirstResume.resolve();
      const initialAlert = page.getByRole('alert').filter({ hasText: 'fixture first history failure' });
      await initialAlert.waitFor();
      await page.locator('.yard-messages-root .yard-message-empty').filter({ hasText: 'Select a conversation' }).waitFor();
      assert.equal(await page.locator('.yard-conversation .yard-loading, .yard-message-edit, button[aria-label="Edit message"]').count(), 0);
      await page.screenshot({ path: join(artifacts, `${thread}-empty-before-retry.png`) });
      await initialAlert.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    const waitForHistory = () => Promise.race([historyEntered.promise, new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Cold history request did not reach the peer')), 10_000).unref();
    })]);
    if (!initialHistoryFailure) await waitForHistory();
    assert.equal(new URL(page.url()).pathname, '/local/' + thread);
    assert.equal(await page.locator('.yard-message-edit, button[aria-label="Edit message"]').count(), 0);
    await page.getByRole('button', { name: 'Workspace files', exact: true }).click();
    await page.getByRole('button', { name: 'barrier.txt', exact: true }).waitFor();

    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      if (!descriptor?.set || !descriptor.get) throw new Error('Cannot intercept the IDB transaction completion callback');
      const gate: { armed: boolean; held: boolean; released: boolean; stack: string; release?: () => void } =
        { armed: true, held: false, released: false, stack: '' };
      (window as unknown as { fileRecoveryGate: typeof gate }).fileRecoveryGate = gate;
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
        configurable: true,
        get(this: IDBTransaction) { return descriptor.get!.call(this); },
        set(this: IDBTransaction, handler: ((this: IDBTransaction, event: Event) => void) | null) {
          if (!gate.armed || !handler) { descriptor.set!.call(this, handler); return; }
          gate.armed = false; gate.stack = new Error('file recovery transaction').stack ?? '';
          const transaction = this;
          descriptor.set!.call(transaction, (event: Event) => {
            gate.held = true;
            gate.release = () => {
              if (gate.released) return;
              gate.released = true;
              Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor);
              handler.call(transaction, event);
            };
          });
        },
      });
    });
    await page.getByRole('button', { name: 'barrier.txt', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { fileRecoveryGate: { held: boolean } }).fileRecoveryGate.held);
    await page.locator('.yard-file-status').getByText('Loading...', { exact: true }).waitFor();
    const beforeLeave = {
      url: page.url(),
      loading: await page.locator('.yard-conversation .yard-loading').count(),
      messageRoots: await page.locator('.yard-conversation .yard-messages-root').count(),
      editors: await editor(page).count(),
    };
    assert.equal(beforeLeave.loading, initialHistoryFailure ? 0 : 1);
    assert.equal(beforeLeave.messageRoots, initialHistoryFailure ? 1 : 0);
    assert.equal(beforeLeave.editors, 0);
    if (failNavigation) await page.evaluate(() => {
      const original = history.pushState;
      history.pushState = function () {
        history.pushState = original;
        throw new DOMException('fixture cold navigation failure', 'SecurityError');
      };
    });
    page.on('dialog', dialog => { void dialog.accept(); });
    await settings(page);
    await page.waitForFunction(() => !!document.querySelector('.yard-conversation[inert]'));
    assert.equal(new URL(page.url()).pathname, '/local/' + thread);
    assert.equal(await page.locator('.yard-conversation .yard-loading').count(), initialHistoryFailure ? 0 : 1);
    if (initialHistoryFailure) assert.equal(await page.locator('.yard-messages-root .yard-message-empty').count(), 1);
    assert.deepEqual(await readEdit(page, thread), saved);

    if (initialHistoryFailure) { releaseRetryResume.resolve(); await waitForHistory(); }
    releaseHistory.resolve();
    await page.getByText('Fixture ' + thread, { exact: true }).waitFor();
    await page.locator('.yard-conversation .yard-message-edit, .yard-conversation button[aria-label="Edit message"]').first().waitFor();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const gate = await page.evaluate(() => {
      const state = (window as unknown as { fileRecoveryGate: { held: boolean; released: boolean; stack: string } }).fileRecoveryGate;
      return { ...state, loading: !!document.querySelector('.yard-conversation .yard-loading'),
        inert: !!document.querySelector('.yard-conversation[inert]'), fileLoading: !!document.querySelector('.yard-file-status[role="status"]') };
    });
    assert.equal(gate.held, true); assert.equal(gate.released, false);
    assert.match(gate.stack, /readFileRecovery/, 'the held transaction must belong to the real file recovery barrier');
    assert.equal(gate.loading, false); assert.equal(gate.inert, true); assert.equal(gate.fileLoading, true);
    assert.equal(new URL(page.url()).pathname, '/local/' + thread);
    const editorCount = await editor(page).count();
    observations[thread] = { saved, beforeLeave, gate, editorCount, urlWhileBlocked: page.url() };
    if (editorCount) await page.screenshot({ path: join(artifacts, `${thread}-blocked-failure.png`) });
    assert.equal(editorCount, 0, 'cold recovery must not acquire an editable session during the leave barrier');
    await page.evaluate(() => (window as unknown as { fileRecoveryGate: { release(): void } }).fileRecoveryGate.release());

    if (failNavigation) {
      await page.getByRole('alert').filter({ hasText: 'fixture cold navigation failure' }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/local/' + thread);
      await page.waitForFunction(() => !document.querySelector('.yard-conversation[inert]'));
    } else {
      await page.waitForURL('**/settings/general**');
      assert.deepEqual(await readEdit(page, thread), saved);
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      await page.waitForURL('**/local/' + thread);
    }
    await editor(page).waitFor();
    assert.equal(await editor(page).inputValue(), 'cold persisted draft');
    const nextText = initialHistoryFailure ? 'cold edit after history retry and return'
      : failNavigation ? 'cold edit after failed navigation' : 'cold edit after return';
    await editor(page).fill(nextText); await waitForEdit(page, thread, nextText);
    const next = await readEdit(page, thread);
    assert.equal(next?.recovery.editor.sessionId, saved.recovery.editor.sessionId);
    assert((next?.recovery.editor.revision ?? -1) > saved.recovery.editor.revision);
    observations[thread] = { saved, beforeLeave, gate, editorCount, next, failNavigation, initialHistoryFailure, url: page.url() };
  } finally {
    releaseHistory.resolve(); releaseFirstResume.resolve(); releaseRetryResume.resolve();
    if (page && !page.isClosed()) await page.evaluate(() => {
      (window as unknown as { fileRecoveryGate?: { release?(): void } }).fileRecoveryGate?.release?.();
    }).catch(() => {});
    fake.handlers.delete('thread/turns/list'); fake.handlers.delete('thread/resume');
    fake.handlers.delete('fs/getMetadata'); fake.handlers.delete('fs/readDirectory');
  }
}

try {
  await scenario('idb-wait-requires-persisted-text', async () => {
    const thread = 'idb-wait-requires-persisted-text', page = await newPage(thread);
    await startEdit(page, 'persisted first'); await waitForEdit(page, thread, 'persisted first');
    const before = await readEdit(page, thread);
    await assert.rejects(waitForEdit(page, thread, 'not yet persisted', 200), /Timed out waiting for persisted edit/);
    await editor(page).fill('persisted second'); await waitForEdit(page, thread, 'persisted second');
    const after = await readEdit(page, thread);
    assert.equal(after?.recovery.editor.sessionId, before?.recovery.editor.sessionId);
    assert((after?.recovery.editor.revision ?? -1) > (before?.recovery.editor.revision ?? -1));
    observations['idb-wait-requires-persisted-text'] = { before, after };
  });

  await scenario('cold-load-navigation', () => coldLoadNavigation('cold-load-navigation', false));
  await scenario('cold-load-navigation-failure', () => coldLoadNavigation('cold-load-navigation-failure', true));
  await scenario('cold-history-failure-retry-navigation', () => coldLoadNavigation('cold-history-failure-retry-navigation', false, true));

  await scenario('same-thread-dom', async () => {
    const page = await newPage('same');
    await startEdit(page, 'same-thread unsent'); await waitForEdit(page, 'same', 'same-thread unsent');
    await editor(page).evaluate(element => { (window as unknown as { savedEditNode: Element }).savedEditNode = element; });
    const historyLength = await page.evaluate(() => history.length);
    await page.locator('[data-sidebar-thread]').filter({ hasText: 'Edit same' }).first().click();
    await page.waitForFunction(length => {
      const saved = (window as unknown as { savedEditNode: HTMLTextAreaElement }).savedEditNode;
      return history.length > length && saved.isConnected && !saved.closest('[inert]')
        && saved === document.querySelector('textarea[aria-label="Edit message text"]');
    }, historyLength);
    assert.equal(await editor(page).inputValue(), 'same-thread unsent');
    assert.equal(new URL(page.url()).pathname, '/local/same');
  });

  await scenario('navigation-drain-and-restore', async () => {
    const page = await newPage('navigation');
    await startEdit(page, 'navigation unsent'); await waitForEdit(page, 'navigation', 'navigation unsent');
    await holdUiWrites(page);
    await settings(page);
    await page.waitForFunction(() => !!document.querySelector('.yard-message-edit')?.closest('[inert]'));
    assert.equal(new URL(page.url()).pathname, '/local/navigation');
    assert.equal(await editor(page).isDisabled(), true);
    await releaseUiWrites(page);
    await page.waitForURL('**/settings/general**');
    assert.equal(await editor(page).count(), 0);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.waitForURL('**/local/navigation'); await editor(page).waitFor();
    assert.equal(await editor(page).inputValue(), 'navigation unsent');
    await waitForEdit(page, 'navigation', 'navigation unsent');
  });

  await scenario('history-failure-unfreezes', async () => {
    const page = await newPage('history');
    await startEdit(page, 'history retained'); await waitForEdit(page, 'history', 'history retained');
    await editor(page).evaluate(element => { (window as unknown as { savedEditNode: Element }).savedEditNode = element; });
    await page.evaluate(() => {
      const original = history.pushState;
      history.pushState = function (...args) {
        history.pushState = original;
        throw new DOMException('fixture history failure', 'SecurityError');
      };
    });
    await settings(page);
    await page.getByRole('alert').filter({ hasText: 'fixture history failure' }).waitFor();
    await page.waitForFunction(() => {
      const saved = (window as unknown as { savedEditNode: HTMLTextAreaElement }).savedEditNode;
      return saved.isConnected && !saved.disabled && !saved.closest('[inert]');
    });
    assert.equal(new URL(page.url()).pathname, '/local/history');
    assert.equal(await editor(page).inputValue(), 'history retained');
    await editor(page).fill('history still writable'); await waitForEdit(page, 'history', 'history still writable');
  });

  await scenario('archive-during-navigation', async () => {
    const thread = 'archive-during-navigation', page = await newPage(thread);
    await startEdit(page, 'archived while navigation waits'); await waitForEdit(page, thread, 'archived while navigation waits');
    await holdUiWrites(page);
    await settings(page);
    await page.waitForFunction(() => !!document.querySelector('.yard-message-edit')?.closest('[inert]'));
    assert.equal(new URL(page.url()).pathname, '/local/' + thread);
    fake.archived.add(thread);
    fake.broadcast({ method: 'thread/archived', params: { threadId: thread } });
    await page.waitForFunction(() => !!document.querySelector('.yard-dialog[role="alert"]')
      || document.body.innerText.includes('此会话已归档'));
    assert.equal(await page.getByRole('heading', { name: 'Unable to display Codex Yard' }).count(), 0,
      'a host archive event must not finish an unflushed navigation lease or replace the page');
    assert.equal(new URL(page.url()).pathname, '/local/' + thread);
    assert.equal(await editor(page).inputValue(), 'archived while navigation waits');
    await releaseUiWrites(page);
    await page.waitForURL('**/settings/general**');
    await waitForEdit(page, thread, 'archived while navigation waits');
  });

  await scenario('history-current-replace-failure', async () => {
    const thread = 'history-current-replace-failure';
    const path = `/local/${thread}?fixture=original#fragment`;
    const page = await newPage(thread, { path });
    await startEdit(page, 'replace failure retained'); await waitForEdit(page, thread, 'replace failure retained');
    const savedBefore = await readEdit(page, thread);
    const originalIndex = await page.evaluate(() => history.state?.__yardIndex);
    await page.evaluate(() => {
      const state = window as unknown as { historyReplaceAttempts: number; historyReplaceAllowed: boolean; historyRetryClicked: boolean;
        historyReplaceBeforeRetry: string[]; historyReplaceAfterRetry: string[]; releaseHistoryReplace?: () => void };
      state.historyReplaceAttempts = 0; state.historyReplaceAllowed = false; state.historyRetryClicked = false;
      state.historyReplaceBeforeRetry = []; state.historyReplaceAfterRetry = [];
      const original = history.replaceState;
      state.releaseHistoryReplace = () => { state.historyReplaceAllowed = true; };
      document.addEventListener('click', event => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (button?.textContent?.trim() === 'Retry' && button.closest('[role="alert"]')?.textContent?.includes('fixture current URL replace failure')) {
          state.historyRetryClicked = true;
        }
      }, true);
      history.replaceState = function (data, unused, url) {
        if (url && new URL(url, location.href).searchParams.has('archived')) {
          if (!state.historyReplaceAllowed) {
            state.historyReplaceAttempts++;
            throw new DOMException('fixture current URL replace failure', 'SecurityError');
          }
          (state.historyRetryClicked ? state.historyReplaceAfterRetry : state.historyReplaceBeforeRetry).push(new URL(url, location.href).href);
        }
        return original.call(this, data, unused, url);
      };
    });
    fake.archived.add(thread);
    fake.broadcast({ method: 'thread/archived', params: { threadId: thread } });
    await page.waitForFunction(() => (window as unknown as { historyReplaceAttempts: number }).historyReplaceAttempts > 0);
    assert.equal(await page.getByRole('heading', { name: 'Unable to display Codex Yard' }).count(), 0,
      'a current-page History replace failure must not replace the editor');
    assert.equal(new URL(page.url()).pathname, '/local/' + thread);
    assert.equal(await editor(page).inputValue(), 'replace failure retained');
    assert.equal(await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.equal(page.url(), app.url + path);
    const alert = page.getByRole('alert').filter({ hasText: 'fixture current URL replace failure' });
    await alert.waitFor();
    const failedAttempts = await page.evaluate(() => {
      const state = window as unknown as { historyReplaceAttempts: number; releaseHistoryReplace(): void };
      state.releaseHistoryReplace();
      return state.historyReplaceAttempts;
    });
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('archived') === '1');
    const retryCalls = await page.evaluate(() => {
      const state = window as unknown as { historyRetryClicked: boolean; historyReplaceBeforeRetry: string[]; historyReplaceAfterRetry: string[] };
      return { clicked: state.historyRetryClicked, before: state.historyReplaceBeforeRetry, after: state.historyReplaceAfterRetry };
    });
    assert.equal(retryCalls.clicked, true);
    assert.deepEqual(retryCalls.before, []);
    assert(retryCalls.after.some(url => new URL(url).searchParams.get('archived') === '1'));
    const after = new URL(page.url());
    assert.equal(after.searchParams.get('fixture'), 'original');
    assert.equal(after.hash, '#fragment');
    assert.equal(await page.evaluate(() => history.state?.__yardIndex), originalIndex);
    assert.equal(await editor(page).inputValue(), 'replace failure retained');
    assert.equal(await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.deepEqual(await readEdit(page, thread), savedBefore);
    assert.equal(await alert.count(), 0);
    observations['history-current-replace-failure'] = { savedBefore, failedAttempts, retryCalls, urlAfterRetry: after.href, historyIndex: originalIndex };
  });

  await scenario('history-initial-replace-failure', async () => {
    const thread = 'history-initial-replace-failure';
    const original = await newPage(thread);
    await startEdit(original, 'saved before router initialization');
    await waitForEdit(original, thread, 'saved before router initialization');
    const savedBefore = await readEdit(original, thread);
    assert(savedBefore);
    await original.close();
    const path = `/local/${thread}?fixture=original#fragment`;
    const page = await newPage(thread, { path, beforeGoto: page => page.addInitScript(() => {
      const state = { count: 0, initialUrl: location.href, targetUrl: '', appMounted: false, oldState: null as unknown };
      (window as unknown as { initialHistoryFault: typeof state }).initialHistoryFault = state;
      const originalReplace = history.replaceState;
      history.replaceState = function (data, unused, url) {
        const target = new URL(url ?? location.href, location.href).href;
        if (!state.count && data && typeof data === 'object' && Object.hasOwn(data, '__yardIndex') && target === location.href) {
          state.count++; state.targetUrl = target; state.appMounted = !!document.querySelector('#root .yard-toolbar');
          state.oldState = history.state; history.replaceState = originalReplace;
          throw new DOMException('fixture initial history replace failure', 'SecurityError');
        }
        return originalReplace.call(this, data, unused, url);
      };
    }) });
    const fault = await page.evaluate(() => (window as unknown as { initialHistoryFault: {
      count: number; initialUrl: string; targetUrl: string; appMounted: boolean; oldState: unknown;
    } }).initialHistoryFault);
    assert.equal(fault.count, 1);
    assert.equal(fault.appMounted, true);
    assert.equal(fault.initialUrl, app.url + path);
    assert.equal(fault.targetUrl, app.url + path);
    assert.equal(fault.oldState, null);
    assert.equal(page.url(), app.url + path);
    await page.getByRole('alert').filter({ hasText: 'fixture initial history replace failure' }).first().waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Unable to display Codex Yard' }).count(), 0);
    await editor(page).waitFor();
    assert.equal(await editor(page).inputValue(), 'saved before router initialization');
    const savedAfter = await readEdit(page, thread);
    assert.deepEqual(savedAfter, savedBefore);
    const alert = page.getByRole('alert').filter({ hasText: 'fixture initial history replace failure' });
    assert.equal(await page.evaluate(() => Object.hasOwn(history.state ?? {}, '__yardIndex')), false);
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => Object.hasOwn(history.state ?? {}, '__yardIndex'));
    assert.equal(await page.evaluate(() => history.state.__yardIndex), 0);
    assert.equal(page.url(), app.url + path);
    assert.equal(await alert.count(), 0);
    assert.equal(await editor(page).inputValue(), 'saved before router initialization');
    await editor(page).fill('still editable after router initialization');
    await waitForEdit(page, thread, 'still editable after router initialization');
    const savedEdited = await readEdit(page, thread);
    await settings(page);
    await page.waitForURL('**/settings/general**');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.waitForURL(app.url + path);
    await editor(page).waitFor();
    assert.equal(await editor(page).inputValue(), 'still editable after router initialization');
    assert.deepEqual(await readEdit(page, thread), savedEdited);
    observations['history-initial-replace-failure'] = { fault, savedBefore, savedAfter, savedEdited, urlAfterReturn: page.url(),
      historyIndexAfterReturn: await page.evaluate(() => history.state?.__yardIndex) };
  });

  await scenario('pending-acquisition-navigation', async () => {
    const page = await newPage('acquire');
    await holdUiWrites(page);
    await page.evaluate(() => {
      const state = window as unknown as { editGateTransaction: IDBTransaction; pendingAtomReads: number; firstAtomReadFinished: boolean };
      state.pendingAtomReads = 0; state.firstAtomReadFinished = false;
      const original = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
        const request = original.apply(this, args);
        if (this.transaction !== state.editGateTransaction && args[0] === 'native-atoms') {
          state.pendingAtomReads++;
          if (state.pendingAtomReads === 1) request.addEventListener('success', () => { state.firstAtomReadFinished = true; });
        }
        return request;
      };
    });
    await page.getByRole('button', { name: 'Edit message', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { pendingAtomReads: number }).pendingAtomReads > 0);
    assert.equal(await editor(page).count(), 0);
    await settings(page);
    await page.waitForURL('**/settings/general**');
    assert.equal(await page.evaluate(() => (window as unknown as { firstAtomReadFinished: boolean }).firstAtomReadFinished), false);
    assert.equal(await editor(page).count(), 0);
    await releaseUiWrites(page);
    await page.waitForFunction(() => (window as unknown as { firstAtomReadFinished: boolean }).firstAtomReadFinished);
    assert.equal(await editor(page).count(), 0);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.waitForURL('**/local/acquire');
    await page.getByRole('button', { name: 'Edit message', exact: true }).waitFor();
    assert.equal(await editor(page).count(), 0);
    await startEdit(page, 'new acquisition after return');
    await waitForEdit(page, 'acquire', 'new acquisition after return');
  });

  await scenario('pending-submit-navigation', async () => {
    const page = await newPage('pending-navigation');
    await startEdit(page, 'pending navigation unsent'); await waitForEdit(page, 'pending-navigation', 'pending navigation unsent');
    await holdUiWrites(page);
    await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.yard-message-edit').getByRole('button', { name: 'Sending...', exact: true }).waitFor();
    assert.equal(calls('thread/revert', 'pending-navigation').length, 0);
    await settings(page);
    await page.getByRole('alert').filter({ hasText: 'Wait for the current message edit operation before leaving.' }).first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/local/pending-navigation');
    await releaseUiWrites(page);
    await page.getByRole('alert').filter({ hasText: '会话已切换' }).first().waitFor();
    assert.equal(await editor(page).inputValue(), 'pending navigation unsent');
    await waitForEdit(page, 'pending-navigation', 'pending navigation unsent');
    const saved = await readEdit(page, 'pending-navigation');
    assert.equal(saved?.submission, undefined);
    observations['pending-submit-navigation'] = saved;
    assert.equal(calls('thread/revert', 'pending-navigation').length, 0);
    assert.equal(calls('turn/start', 'pending-navigation').length, 0);
  });

  await scenario('pending-submit-reconnect', async () => {
    const page = await newPage('connection');
    await startEdit(page, 'connection unsent'); await waitForEdit(page, 'connection', 'connection unsent');
    const before = await readEdit(page, 'connection');
    assert(before);
    await holdUiWrites(page);
    await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.yard-message-edit').getByRole('button', { name: 'Sending...', exact: true }).waitFor();
    fake.disconnectAll();
    await page.getByRole('button', { name: 'Reconnect host', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reconnect host', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.yard-connection')?.getAttribute('title') === 'Browser: connected; Host: connected');
    await releaseUiWrites(page);
    await page.getByRole('alert').filter({ hasText: /^(?:原连接或输入使用权已改变，原稿已保留，未发送。|消息编辑的原连接已改变，编辑稿已保留，未发送。)$/ }).first().waitFor();
    assert.equal(await editor(page).inputValue(), 'connection unsent');
    await waitForEdit(page, 'connection', 'connection unsent');
    const saved = await readEdit(page, 'connection');
    assert.equal(saved?.submission, undefined);
    assert.deepEqual(saved, before);
    observations['pending-submit-reconnect'] = saved;
    assert.equal(calls('thread/revert', 'connection').length, 0);
    assert.equal(calls('turn/start', 'connection').length, 0);
  });

  await scenario('cross-page-adopt-latest', async () => {
    const first = await newPage('cross-page');
    await startEdit(first, 'first page version'); await waitForEdit(first, 'cross-page', 'first page version');
    const firstVersion = await readEdit(first, 'cross-page');
    await settings(first); await first.waitForURL('**/settings/general**');
    const second = await newPage('cross-page');
    await editor(second).waitFor(); assert.equal(await editor(second).inputValue(), 'first page version');
    await editor(second).fill('second page version'); await waitForEdit(second, 'cross-page', 'second page version');
    const secondVersion = await readEdit(second, 'cross-page');
    await settings(second); await second.waitForURL('**/settings/general**');
    await first.getByRole('button', { name: 'Close settings', exact: true }).click();
    await first.waitForURL('**/local/cross-page'); await editor(first).waitFor();
    assert.equal(await editor(first).inputValue(), 'second page version');
    await editor(first).fill('accepted latest and edited again');
    await waitForEdit(first, 'cross-page', 'accepted latest and edited again');
    const thirdVersion = await readEdit(first, 'cross-page');
    assert.equal(firstVersion?.recovery.editor.sessionId, secondVersion?.recovery.editor.sessionId);
    assert.equal(secondVersion?.recovery.editor.sessionId, thirdVersion?.recovery.editor.sessionId);
    assert((firstVersion?.recovery.editor.revision ?? -1) < (secondVersion?.recovery.editor.revision ?? -1));
    assert((secondVersion?.recovery.editor.revision ?? -1) < (thirdVersion?.recovery.editor.revision ?? -1));
    observations['cross-page-adopt-latest'] = [firstVersion, secondVersion, thirdVersion];
    assert.equal(await first.locator('.yard-message-edit [role="alert"]').count(), 0);
  });

  await scenario('late-receipt-preserves-newer-page', async () => {
    const entered = deferred(), release = deferred();
    fake.handlers.set('thread/revert', async params => {
      if (params.threadId === 'late') { entered.resolve(); await release.promise; }
      return fake.defaultResult('thread/revert', params);
    });
    try {
      const first = await newPage('late');
      await startEdit(first, 'earlier submitted edit'); await waitForEdit(first, 'late', 'earlier submitted edit');
      await first.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
      await Promise.race([entered.promise, new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('no real thread/revert reached the fixture')), 10_000).unref();
      })]);
      const original = await readEdit(first, 'late');
      assert.equal(original?.submission?.stage, 'revertUnknown');
      const second = await newPage('late');
      await editor(second).waitFor(); assert.equal(await editor(second).inputValue(), 'earlier submitted edit');
      await editor(second).fill('newer second page edit'); await waitForEdit(second, 'late', 'newer second page edit');
      const newer = await readEdit(second, 'late');
      assert.equal(newer?.submission?.operationId, original?.submission?.operationId);
      assert((newer?.recovery.editor.revision ?? -1) > (original?.recovery.editor.revision ?? -1));
      release.resolve();
      await fake.waitFor(message => message.method === 'turn/start' && message.params.threadId === 'late', 10_000);
      await first.getByRole('alert').filter({ hasText: '另一页面已更改此编辑' }).first().waitFor();
      await waitForEdit(second, 'late', 'newer second page edit');
      const after = await readEdit(second, 'late');
      assert.equal(after?.submission?.operationId, original?.submission?.operationId);
      assert.equal(after?.recovery.editor.revision, newer?.recovery.editor.revision);
      observations['late-receipt-preserves-newer-page'] = [original, newer, after];
      assert.equal(await editor(second).inputValue(), 'newer second page edit');
      assert.equal(calls('thread/revert', 'late').length, 1);
      assert.equal(calls('turn/start', 'late').length, 1);
    } finally { release.resolve(); fake.handlers.delete('thread/revert'); }
  });

  await scenario('settings-update-does-not-carry-overrides', async () => {
    fake.handlers.set('model/list', () => ({ data: [
      { id: 'fixture-id', model: 'fixture-model', displayName: 'Fixture model', isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }, { reasoningEffort: 'high', description: 'High' }] },
      { id: 'alternate-id', model: 'fixture-alternate', displayName: 'Alternate model', isDefault: false,
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }, { reasoningEffort: 'high', description: 'High' }] },
    ] }));
    try {
      const page = await newPage('settings');
      await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).selectOption('high');
      await startEdit(page, 'edit after settings update'); await waitForEdit(page, 'settings', 'edit after settings update');
      const thread = fake.threads.get('settings')!;
      thread.model = 'fixture-alternate'; thread.reasoningEffort = 'low';
      fake.broadcast({ method: 'thread/settings/updated', params: { threadId: 'settings', threadSettings: {
        model: thread.model, modelProvider: 'fixture', effort: 'low', approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' }, serviceTier: null,
      } } });
      await page.waitForFunction(() => (document.querySelector('select[aria-label="Model"]') as HTMLSelectElement | null)?.value === 'fixture-alternate');
      assert.equal(await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).inputValue(), 'high');
      await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
      await fake.waitFor(message => message.method === 'turn/start' && message.params.threadId === 'settings', 10_000);
      const params = calls('turn/start', 'settings')[0]!.params;
      observations['settings-update-does-not-carry-overrides'] = params;
      for (const key of ['model', 'effort', 'approvalPolicy', 'approvalsReviewer', 'sandboxPolicy', 'permissions', 'serviceTier', 'collaborationMode']) {
        assert.equal(Object.hasOwn(params, key), false, `${key} must not be carried into the edit`);
      }
      assert.equal(calls('thread/settings/update', 'settings').length, 0);
    } finally { fake.handlers.delete('model/list'); }
  });
} finally {
  try { await browser.close(); } finally { try { await app.close(); } finally { await fake.close(); } }
}
if (!results.length || results.some(result => result.status === 'fail') || errors.length) process.exitCode = 1;
