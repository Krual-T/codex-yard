import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

const source = resolve(process.env.YARD_PARENT_SOURCE ?? join(import.meta.dirname, '..'));
const artifactRoot = process.env.YARD_TEST_ARTIFACTS;
if (!artifactRoot) throw new Error('Set YARD_TEST_ARTIFACTS to an isolated evidence directory.');
const selectedScenarios = process.env.YARD_PARENT_SCENARIOS?.split(',').filter(Boolean);
const knownScenarios = new Set(['file-loading-and-drain', 'home-target-lease', 'visualization-source-retained',
  'browser-reference-retry', 'browser-reference-changed-draft', 'browser-reference-owner-guard', 'confirmed-send', 'deleted-reference-ime',
  'pending-deletion-after-ime', 'pending-deletion-composition-end-only', 'pending-deletion-independent-text',
  'pending-deletion-different-reference']);
if (selectedScenarios && (!selectedScenarios.length || selectedScenarios.some(name => !knownScenarios.has(name)))) {
  throw new Error('YARD_PARENT_SCENARIOS must name at least one known scenario.');
}
await mkdir(artifactRoot, { recursive: true });
const artifacts = await mkdtemp(join(resolve(artifactRoot), 'parent-recovery-'));
const actualRuntime = join(artifacts, 'runtime');
await mkdir(actualRuntime);
// Unix-domain sockets have a short path limit. The actual disposable data stays in artifacts.
const shortDirectory = await mkdtemp(join(tmpdir(), 'yard-parent-'));
const runtime = join(shortDirectory, 'data');
await symlink(actualRuntime, runtime, 'dir');
for (const directory of ['home', 'home/config', 'home/cache', 'codex']) await mkdir(join(runtime, directory), { recursive: true });
process.env.HOME = join(runtime, 'home');
process.env.CODEX_HOME = join(runtime, 'codex');
process.env.XDG_CONFIG_HOME = join(runtime, 'home/config');
process.env.XDG_CACHE_HOME = join(runtime, 'home/cache');

const build = spawnSync(process.execPath, ['scripts/build-native.ts'], { cwd: source, encoding: 'utf8' });
await writeFile(join(artifacts, 'build.log'), `${build.stdout ?? ''}${build.stderr ?? ''}`);
if (build.status !== 0) {
  await rm(shortDirectory, { recursive: true, force: true });
  throw new Error(`Real renderer build failed: ${build.status}; see ${artifacts}/build.log`);
}
const load = (path: string) => pathToFileURL(join(source, path)).href;
const { createNativeWorkbench } = await import(load('src/native/server.ts')) as typeof import('../src/native/server.ts');
const { createFakeCodex, fixtureThread, fixtureTurn, agentItem } = await import(load('test/fake-codex.ts')) as typeof import('../test/fake-codex.ts');
const { fileDaemonFixture } = await import(load('test/file-daemon-fixture.ts')) as typeof import('../test/file-daemon-fixture.ts');
const { fileMethods } = await import(load('src/native/files.ts')) as typeof import('../src/native/files.ts');
const { record } = await import(load('src/native/protocol.ts')) as typeof import('../src/native/protocol.ts');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const localRoot = join(runtime, 'workspace'), secondRoot = join(runtime, 'second'), remoteRoot = join(runtime, 'remote');
for (const directory of [localRoot, secondRoot, remoteRoot, join(runtime, 'data')]) await mkdir(directory);
const fixtureFile = join(localRoot, 'parent-recovery-notes.txt');
await writeFile(fixtureFile, 'Synthetic source content\n');
const fixtureVisualization = join(localRoot, 'parent-widget.html');
await writeFile(fixtureVisualization, '<!doctype html><html><body><div id="parent-target">Synthetic visualization target</div></body></html>');
const fake = await createFakeCodex(runtime), remote = await createFakeCodex(remoteRoot);
const loading = deferred<void>(), turn = deferred<void>();
let holdLoading = true, holdTurn = false;
fake.handlers.set('thread/resume', async params => {
  if (params.threadId === 'loading' && holdLoading) await loading.promise;
  return fake.defaultResult('thread/resume', params);
});
fake.handlers.set('turn/start', async params => {
  if (holdTurn) await turn.promise;
  return fake.defaultResult('turn/start', params);
});
const fileRpc = fileDaemonFixture();
for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, record(params)));
for (const name of ['loading', 'other', 'viz', 'retry', 'retry-changed', 'retry-owner', 'send', 'ime', 'ime-pending', 'ime-end',
  'ime-conflict-text', 'ime-conflict-ref']) {
  fake.threads.set(name, fixtureThread(name, localRoot, { name: `Parent ${name}`,
    turns: [fixtureTurn('turn-' + name, [agentItem('message-' + name, 'Parent fixture ' + name)])] }));
}
fake.threads.get('viz')!.turns[0]!.items.push(agentItem('fixture-widget', '\uE200visualize\uE202'
  + JSON.stringify({ path: fixtureVisualization, title: 'Parent visualization' }) + '\uE201'));
const remoteId = 'remote-ssh-parent-fixture';
const globals = { 'local-projects': {
  first: { id: 'first', name: 'Parent first', rootPaths: [localRoot] },
  second: { id: 'second', name: 'Parent second', rootPaths: [secondRoot] },
} };
await writeFile(join(runtime, 'data/native-state.json'), JSON.stringify({ globals, settings: { localeOverride: 'en-US' } }));
await writeFile(join(runtime, 'data/projects.json'), JSON.stringify([
  { path: localRoot, name: 'Parent first' }, { path: secondRoot, name: 'Parent second' },
]));

const entries: Record<string, unknown[]> = {};
for (const name of ['retry', 'retry-changed', 'retry-owner', 'send', 'ime', 'ime-pending', 'ime-end', 'ime-conflict-text', 'ime-conflict-ref']) {
  const owner = { hostId: 'local', threadId: name, draftId: name };
  const key = 'codex-yard.browser-owner.v1:' + JSON.stringify([owner.hostId, owner.threadId, owner.draftId]);
  entries[key] = [{ type: 'comment', origin: 'browser', content: [{ content_type: 'text', text: `Fixture ${name} comment` }],
    position: { side: 'right', path: 'browser:synthetic', line: 1 },
    localBrowserContext: { pageUrl: 'http://127.0.0.1/synthetic', targetDescription: `Fixture ${name} reference` },
    localBrowserCommentMetadata: { commentId: `comment-${name}`, kind: 'element', hasAnnotationFeatures: true } }];
  if (name === 'ime-conflict-ref') entries[key]!.push({ type: 'comment', origin: 'browser',
    content: [{ content_type: 'text', text: 'Fixture alternate comment' }],
    position: { side: 'right', path: 'browser:alternate', line: 2 },
    localBrowserContext: { pageUrl: 'http://127.0.0.1/alternate', targetDescription: 'Fixture alternate reference' },
    localBrowserCommentMetadata: { commentId: 'comment-ime-conflict-ref-alternate', kind: 'element', hasAnnotationFeatures: true } });
}
const seed = { 'codex-yard.browser-comments.v1': { version: 1, legacyRaw: null, entries } };
const browser: BrowserContext = await chromium.launchPersistentContext(join(runtime, 'browser'), {
  executablePath: process.env.YARD_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-background-networking', '--remote-debugging-port=0'], viewport: { width: 1360, height: 900 },
});
const debugPort = Number((await readFile(join(runtime, 'browser/DevToolsActivePort'), 'utf8')).split('\n')[0]);
assert(Number.isInteger(debugPort) && debugPort > 0);
await browser.addInitScript(value => {
  if (window === window.top && localStorage.getItem('native-atoms') === null) localStorage.setItem('native-atoms', JSON.stringify(value));
}, seed);
const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(runtime, 'codex'),
  dataDir: join(runtime, 'data'), workspace: localRoot, port: 0, chromeConnection: { browserUrl: `http://127.0.0.1:${debugPort}` },
  hostCatalog: { hosts: [{ hostId: remoteId, displayName: 'Parent remote', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }],
    projects: [{ id: 'remote-project', hostId: remoteId, label: 'Remote project', remotePath: remoteRoot }], assignments: {} },
  sshStream: (_host, paths) => { paths?.({ homeDirectory: remoteRoot, codexHome: join(runtime, 'codex') }); return createConnection({ path: remote.socketPath }); },
});

const results: { name: string; status: 'pass' | 'fail'; details?: string }[] = [];
const errors: string[] = [];
const active: { page?: Page } = {};
const currentPage = () => active.page;
async function newPage(path: string) {
  const page = await browser.newPage(); active.page = page;
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto(app.url + path);
  return page;
}
async function ready(page: Page, thread: string) {
  await page.getByText('Parent fixture ' + thread, { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Work with Codex', exact: true }).waitFor();
}
async function scenario(name: string, run: () => Promise<void>) {
  if (selectedScenarios && !selectedScenarios.includes(name)) return;
  active.page = undefined;
  try {
    await run();
    results.push({ name, status: 'pass' });
  } catch (error) {
    const details = error instanceof Error ? error.stack ?? error.message : String(error);
    results.push({ name, status: 'fail', details });
    const target = currentPage();
    if (target && !target.isClosed()) {
      await target.screenshot({ path: join(artifacts, name + '-failure.png'), fullPage: true }).catch(() => {});
      const diagnostics = await target.evaluate(() => ({
        fault: (window as unknown as { parentFault?: unknown }).parentFault,
        targets: [...document.querySelectorAll<HTMLSelectElement>('select[aria-label="Run location"]')]
          .map(select => ({ value: select.value, disabled: select.disabled, options: [...select.options].map(option => option.value) })),
        alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent),
      })).catch(() => ({}));
      await writeFile(join(artifacts, name + '-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    }
  } finally {
    const target = currentPage();
    if (target && !target.isClosed()) await target.close().catch(() => {});
  }
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ source, results, errors }, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}

async function holdUiWrites(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('atoms', 'readwrite'), store = tx.objectStore('atoms');
        let held = true;
        (window as unknown as { releaseParentWrite: () => void }).releaseParentWrite = () => { held = false; };
        tx.oncomplete = () => db.close();
        const keep = () => { const read = store.get('native-atoms'); read.onsuccess = () => { if (held) keep(); }; };
        keep(); resolve();
      };
    });
  });
}
async function releaseUiWrites(page: Page) {
  await page.evaluate(() => (window as unknown as { releaseParentWrite: () => void }).releaseParentWrite());
}
async function openFile(page: Page) {
  if (!await page.getByRole('button', { name: 'parent-recovery-notes.txt', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Workspace files', exact: true }).click();
  }
  await page.getByRole('button', { name: 'parent-recovery-notes.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Add file to conversation', exact: true }).waitFor();
}
async function attachBrowserReference(page: Page, name: string) {
  await page.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
  await page.getByText(`Fixture ${name} reference`, { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加到草稿', exact: true }).click();
  await page.locator('.standalone-composer__reference').filter({ hasText: `Fixture ${name} reference` }).waitFor();
}
async function failNextCommittedRead(page: Page, name: string) {
  await page.evaluate(name => {
    const state: { armed: boolean; fired: number; reads: number; stacks: string[]; held: boolean; events: string[] } =
      { armed: false, fired: 0, reads: 0, stacks: [], held: false, events: [] };
    (window as unknown as { parentFault: typeof state }).parentFault = state;
    const originalPut = IDBObjectStore.prototype.put, originalGet = IDBObjectStore.prototype.get;
    const watched = new WeakSet<IDBTransaction>();
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const value = args[0] as { atoms?: Record<string, unknown> } | undefined;
      const comments = value?.atoms?.['codex-yard.browser-comments.v1'];
      const deleted = comments && typeof comments === 'object' ? (comments as Record<string, unknown>)['codex-yard.browser-deletions.v1'] : undefined;
      if (!state.armed && !state.fired && !watched.has(this.transaction) && JSON.stringify(deleted ?? null).includes(`comment-${name}`)) {
        watched.add(this.transaction);
        state.events.push('matching-put');
        const oncomplete = this.transaction.oncomplete;
        this.transaction.oncomplete = function (event) {
          state.armed = true; state.events.push('matching-commit');
          oncomplete?.call(this, event);
        };
      }
      return originalPut.apply(this, args);
    };
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
      const stack = new Error().stack ?? '';
      if (stack.includes('readComposerDraftVersions') && state.events.length < 30) {
        state.events.push('read:armed=' + state.armed + ':recovery=' + !!document.querySelector('[aria-label="Browser draft recovery"]')
          + ':references=' + document.querySelectorAll('.standalone-composer__reference').length);
      }
      if (state.armed && stack.includes('readComposerDraftVersions')) state.reads++;
      // The first post-commit read is the subscribed version refresh; the next
      // is the external operation's adoption read in this fixed source.
      if (state.armed && state.reads === 2 && stack.includes('readComposerDraftVersions')) {
        if (state.stacks.length < 10) state.stacks.push(stack);
        state.armed = false; state.fired++; state.held = true;
        // Queue a separate public IDB transaction before the failure propagates,
        // making any subsequent automatic retry wait until the fixture releases it.
        const hold = this.transaction.db.transaction('atoms', 'readwrite');
        const store = hold.objectStore('atoms');
        (window as unknown as { releaseParentFault: () => void }).releaseParentFault = () => { state.held = false; };
        const keep = () => { const read = originalGet.call(store, 'native-atoms'); read.onsuccess = () => { if (state.held) keep(); }; };
        keep();
        this.transaction.abort();
        throw new DOMException('Synthetic committed-version read failure', 'AbortError');
      }
      return originalGet.apply(this, args);
    };
  }, name);
}
async function removeWithReadFailure(page: Page, name: string) {
  await failNextCommittedRead(page, name);
  await page.locator('.standalone-composer__reference').filter({ hasText: `Fixture ${name} reference` })
    .getByRole('button', { name: 'Remove reference', exact: true }).click();
  const recovery = page.getByRole('status', { name: 'Browser draft recovery', exact: true });
  await page.waitForFunction(() => (window as unknown as { parentFault?: { fired: number } }).parentFault?.fired === 1);
  await recovery.waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { parentFault: { fired: number } }).parentFault.fired), 1,
    'The actual committed-version IndexedDB read must fail once.');
  await recovery.locator('summary').click();
  const receipt = JSON.parse(await recovery.locator('pre').innerText()) as {
    before: { owner: { threadId: string }; revision: string; draft: { references: unknown[] } };
    after: { owner: { threadId: string }; revision: string; draft: { references: unknown[] } };
  };
  assert.equal(receipt.before.owner.threadId, name); assert.equal(receipt.after.owner.threadId, name);
  assert.notEqual(receipt.before.revision, receipt.after.revision);
  assert.equal(receipt.before.draft.references.length, 1); assert.equal(receipt.after.draft.references.length, 0);
  await page.evaluate(() => (window as unknown as { releaseParentFault: () => void }).releaseParentFault());
  return { recovery, receipt };
}
async function readAtoms(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('atoms', 'readonly'), read = tx.objectStore('atoms').get('native-atoms');
      read.onsuccess = () => resolve((read.result as { atoms: Record<string, unknown> }).atoms);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }));
}
async function activeVersions(page: Page, threadId: string) {
  const atoms = await readAtoms(page), repository = record(atoms['codex-yard.composer-drafts.v3']);
  return Object.values(record(repository.entries)).flatMap(entry => {
    const versions = record(entry).versions;
    return Array.isArray(versions) ? versions.map(record).filter(version => {
      const owner = record(version.owner);
      return owner.hostId === 'local' && owner.threadId === threadId && owner.draftId === threadId;
    }).map(version => ({ revision: version.revision, draft: version.draft })) : [];
  });
}
async function waitForVersion(page: Page, threadId: string, text: string, reference: string | null) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for the saved draft version for ${threadId}.`)), 10_000);
  });
  try {
    for (;;) {
      const matched = await Promise.race([page.evaluate(async expected => {
        const raw = await new Promise<unknown>((resolve, reject) => {
          const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result, tx = db.transaction('atoms', 'readonly'), request = tx.objectStore('atoms').get('native-atoms');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            tx.oncomplete = () => db.close();
          };
        });
        const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown> : {};
        const entries = obj(obj(obj(raw).atoms)['codex-yard.composer-drafts.v3']).entries;
        const versions = Object.values(obj(entries)).flatMap(entry => Array.isArray(obj(entry).versions) ? obj(entry).versions as unknown[] : []);
        const matching = versions.map(obj).filter(version => {
          const owner = obj(version.owner), draft = obj(version.draft);
          return owner.hostId === 'local' && owner.threadId === expected.threadId && owner.draftId === expected.threadId
            && draft.text === expected.text && (expected.reference === null || JSON.stringify(draft.references).includes(expected.reference));
        });
        return matching.length === 1;
      }, { threadId, text, reference }), timeout]);
      if (matched) return;
      await Promise.race([page.waitForTimeout(30), timeout]);
    }
  } finally { clearTimeout(timer); }
}
async function holdDeletionReads(page: Page, threadId: string) {
  await page.evaluate(threadId => {
    const state = { fired: 0, holding: true };
    (window as unknown as { parentFault: typeof state }).parentFault = state;
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
      const request = originalGet.apply(this, args);
      if ((new Error().stack ?? '').includes('readComposerDraftVersions')) {
        request.addEventListener('success', () => {
          const root = request.result as { atoms?: Record<string, unknown> } | undefined;
          const comments = root?.atoms?.['codex-yard.browser-comments.v1'];
          const deleted = comments && typeof comments === 'object' ? (comments as Record<string, unknown>)['codex-yard.browser-deletions.v1'] : undefined;
          if (state.holding && JSON.stringify(deleted ?? null).includes(`comment-${threadId}`)) {
            state.fired++; request.transaction?.abort();
          }
        }, { once: true });
      }
      return request;
    };
  }, threadId);
}

async function conflictingDeletion(name: 'ime-conflict-text' | 'ime-conflict-ref') {
  const first = await newPage('/local/' + name); await ready(first, name);
  let second: Page | undefined;
  try {
    await first.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
    const primary = first.getByRole('listitem').filter({ hasText: `Fixture ${name} reference` });
    await primary.getByRole('button', { name: '添加到草稿', exact: true }).click();
    const chip = first.locator('.standalone-composer__reference').filter({ hasText: `Fixture ${name} reference` });
    await chip.waitFor();
    if (name === 'ime-conflict-ref') {
      const alternate = first.getByRole('listitem').filter({ hasText: 'Fixture alternate reference' });
      await alternate.getByRole('button', { name: '添加到草稿', exact: true }).click();
      await first.locator('.standalone-composer__reference').filter({ hasText: 'Fixture alternate reference' }).waitFor();
    }
    const original = await activeVersions(first, name);
    assert.equal(original.length, 1);
    second = await newPage('/local/' + name); await ready(second, name); active.page = first;
    const otherChip = second.locator('.standalone-composer__reference').filter({ hasText: `Fixture ${name} reference` });
    await otherChip.waitFor();
    const input = first.getByRole('textbox', { name: 'Work with Codex', exact: true });
    await input.dispatchEvent('compositionstart', { data: 'a' });
    await holdDeletionReads(first, name);
    await otherChip.getByRole('button', { name: 'Remove reference', exact: true }).click();
    await otherChip.waitFor({ state: 'hidden' });
    await first.waitForFunction(() => (window as unknown as { parentFault?: { fired: number } }).parentFault?.fired);
    assert.equal(await chip.isVisible(), true);
    const otherInput = second.getByRole('textbox', { name: 'Work with Codex', exact: true });
    if (name === 'ime-conflict-text') {
      await otherInput.fill('INDEPENDENT_OTHER_PAGE_TEXT');
      await waitForVersion(second, name, 'INDEPENDENT_OTHER_PAGE_TEXT', null);
    } else {
      await second.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
      const alternate = second.getByRole('listitem').filter({ hasText: 'Fixture alternate reference' });
      await alternate.getByRole('textbox', { name: '浏览器引用批注', exact: true }).fill('INDEPENDENT_CHANGED_COMMENT');
      await alternate.getByRole('button', { name: '保存批注', exact: true }).click();
      await second.locator('.standalone-composer__reference').filter({ hasText: 'INDEPENDENT_CHANGED_COMMENT' }).waitFor();
      await waitForVersion(second, name, '', 'INDEPENDENT_CHANGED_COMMENT');
    }
    const before = await activeVersions(second, name);
    assert.equal(before.length, 1, 'The competing durable version must be unique before retry.');
    if (name === 'ime-conflict-ref') {
      const initialReferences = record(original[0]!.draft).references, changedReferences = record(before[0]!.draft).references;
      assert(Array.isArray(initialReferences) && Array.isArray(changedReferences));
      const originalAlternate = initialReferences.map(record).find(reference => String(reference.id).includes('comment-ime-conflict-ref-alternate'));
      assert(originalAlternate && changedReferences.length === 1);
      assert.equal(record(changedReferences[0]).id, originalAlternate.id);
      assert.notDeepEqual(changedReferences[0], originalAlternate, 'The same reference id must carry different complete content.');
    }
    await writeFile(join(artifacts, name + '-before.json'), JSON.stringify({ original, before }, null, 2));
    assert.equal(await chip.isVisible(), true, 'The original projection must remain until the retry.');
    const conflictAlert = first.getByRole('alert').filter({ hasText: '草稿版本已改变，请核对后重试。' });
    assert.equal(await conflictAlert.count(), 0, 'The rejection must be observed after the composition-end retry.');
    await first.evaluate(() => { (window as unknown as { parentFault: { holding: boolean } }).parentFault.holding = false; });
    await input.dispatchEvent('compositionend', { data: 'a' });
    await conflictAlert.waitFor();
    assert.equal(await chip.isVisible(), true, 'A different complete draft must not be silently adopted.');
    assert.equal(await input.inputValue(), '');
    if (name === 'ime-conflict-text') assert.equal(await otherInput.inputValue(), 'INDEPENDENT_OTHER_PAGE_TEXT');
    else {
      assert.equal(await first.locator('.standalone-composer__reference').filter({ hasText: 'Fixture alternate comment' }).isVisible(), true);
      assert.equal(await second.locator('.standalone-composer__reference').filter({ hasText: 'INDEPENDENT_CHANGED_COMMENT' }).isVisible(), true);
    }
    const after = await activeVersions(second, name);
    assert.deepEqual(after, before, 'A rejected retry must preserve the competing durable version.');
    const fault = await first.evaluate(() => (window as unknown as { parentFault: { fired: number; holding: boolean } }).parentFault);
    assert(fault.fired >= 1 && !fault.holding);
    await writeFile(join(artifacts, name + '-evidence.json'), JSON.stringify({ fault, original, before, after }, null, 2));
  } finally {
    if (second && !second.isClosed()) await second.close();
    if (!first.isClosed() && currentPage() !== first) await first.close();
  }
}

try {
  await scenario('file-loading-and-drain', async () => {
    const page = await newPage('/local/loading');
    await page.getByText('Loading session settings…', { exact: true }).waitFor();
    await openFile(page);
    await page.getByRole('button', { name: 'Add file to conversation', exact: true }).click();
    await page.getByText('原输入区尚未就绪，引用未加入，请保留来源后重试。', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Add file to conversation', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('textbox', { name: 'Work with Codex', exact: true }).count(), 0);
    holdLoading = false; loading.resolve();
    await ready(page, 'loading');
    await openFile(page);
    await holdUiWrites(page);
    try {
      await page.getByRole('button', { name: 'Add file to conversation', exact: true }).click();
      await page.waitForFunction(() => !!document.querySelector('textarea[aria-label="Work with Codex"]')?.closest('[inert]'));
      const oldUrl = page.url();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      assert.equal(page.url(), oldUrl, 'Navigation must not commit while the original prefill transaction is blocked.');
      assert.equal(await page.getByRole('button', { name: 'Add file to conversation', exact: true }).isVisible(), true);
    } finally { await releaseUiWrites(page); }
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
    await page.goBack();
    await ready(page, 'loading');
    await page.reload();
    await ready(page, 'loading');
    await page.locator('.standalone-composer__file').filter({ hasText: 'parent-recovery-notes.txt' }).waitFor();
  });
  await scenario('home-target-lease', async () => {
    const page = await newPage('/');
    const input = page.getByRole('textbox', { name: 'Work with Codex', exact: true });
    const select = page.getByRole('combobox', { name: 'Run location', exact: true });
    await input.waitFor();
    await page.waitForFunction(() => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="Run location"]');
      return !!select && !select.disabled && [...select.options].some(option => option.value.includes('remote-ssh-parent-fixture'))
        && [...select.options].some(option => option.value.includes('/second'));
    });
    const options = await select.locator('option').evaluateAll(values => values.map(value => (value as HTMLOptionElement).value));
    const local = options.find(value => value.includes('/second') && JSON.parse(value)[0] === 'local');
    const remoteTarget = options.find(value => JSON.parse(value)[0] === 'remote-ssh-parent-fixture');
    assert(local && remoteTarget);
    await input.fill('LOCAL_DRAFT_FOR_TARGET_SWITCH');
    const original = await select.inputValue();
    await input.dispatchEvent('compositionstart', { data: 'a' });
    await select.selectOption(local);
    await page.getByRole('alert').filter({ hasText: 'Draft input is not ready to switch.' }).waitFor();
    assert.equal(await select.inputValue(), original);
    assert.equal(await input.inputValue(), 'LOCAL_DRAFT_FOR_TARGET_SWITCH');
    await input.dispatchEvent('compositionend', { data: 'a' });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await holdUiWrites(page);
    try {
      await input.fill('LOCAL_DRAFT_FOR_TARGET_SWITCH_PENDING');
      await select.selectOption(local);
      await page.waitForFunction(() => !!document.querySelector('textarea[aria-label="Work with Codex"]')?.closest('[inert]'));
      assert.equal(await input.evaluate(element => element.closest('[inert]') !== null), true);
      assert.notEqual(await select.inputValue(), local, 'The new location must not be usable before the original draft drains.');
    } finally { await releaseUiWrites(page); }
    await page.waitForFunction(value => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="Run location"]');
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Work with Codex"]');
      return select?.value === value && !select.disabled && !!input && !input.closest('[inert]');
    }, local);
    assert.equal(await input.inputValue(), 'LOCAL_DRAFT_FOR_TARGET_SWITCH_PENDING');
    await select.selectOption(remoteTarget);
    await page.waitForFunction(value => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="Run location"]');
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Work with Codex"]');
      return select?.value === value && !select.disabled && !!input && !input.closest('[inert]');
    }, remoteTarget);
    assert.equal(new URL(page.url()).searchParams.get('hostId'), remoteId);
    await input.fill('REMOTE_TARGET_COMMIT');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const sent = await remote.waitFor(message => message.method === 'turn/start' && JSON.stringify(message.params.input).includes('REMOTE_TARGET_COMMIT'));
    assert.equal(sent.params.threadId != null, true);
    assert.equal(remote.calls('thread/start').at(-1)?.params.cwd, remoteRoot);
    assert.equal(fake.calls('turn/start').some(call => JSON.stringify(call.params.input).includes('REMOTE_TARGET_COMMIT')), false);
  });
  await scenario('visualization-source-retained', async () => {
    const page = await newPage('/local/viz'); await ready(page, 'viz');
    await page.getByRole('button', { name: 'Parent visualization', exact: true }).click();
    const frame = page.frameLocator('iframe[title="Visualization content"]');
    await frame.getByText('Synthetic visualization target', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    await frame.locator('#parent-target').click();
    await page.getByRole('textbox', { name: 'Annotation feedback', exact: true }).fill('RETAIN_VISUALIZATION_FEEDBACK');
    const input = page.getByRole('textbox', { name: 'Work with Codex', exact: true });
    await input.dispatchEvent('compositionstart', { data: 'a' });
    await page.getByRole('button', { name: 'Add to draft', exact: true }).click();
    await page.getByText('原输入区正在处理其他输入，引用未加入，请重试。', { exact: false }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Annotation feedback', exact: true }).inputValue(), 'RETAIN_VISUALIZATION_FEEDBACK');
    await input.dispatchEvent('compositionend', { data: 'a' });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await page.getByRole('button', { name: 'Add to draft', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Work with Codex"]')?.value
      .includes('Feedback: RETAIN_VISUALIZATION_FEEDBACK'));
    const value = await input.inputValue();
    assert(value.includes('parent-widget.html') && value.includes('Selection: Synthetic visualization target'));
  });
  await scenario('browser-reference-retry', async () => {
    const page = await newPage('/local/retry'); await ready(page, 'retry');
    await attachBrowserReference(page, 'retry');
    const { recovery } = await removeWithReadFailure(page, 'retry');
    assert.equal(await page.locator('.standalone-composer__reference').filter({ hasText: 'Fixture retry reference' }).count(), 1,
      'The visible projection must still contain the before-version reference when retrying.');
    await recovery.getByRole('button', { name: '核对已保存版本', exact: true }).click();
    await recovery.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.standalone-composer__reference').filter({ hasText: 'Fixture retry reference' }).count(), 0);
  });
  await scenario('browser-reference-changed-draft', async () => {
    const page = await newPage('/local/retry-changed'); await ready(page, 'retry-changed');
    await attachBrowserReference(page, 'retry-changed');
    const { recovery } = await removeWithReadFailure(page, 'retry-changed');
    const input = page.getByRole('textbox', { name: 'Work with Codex', exact: true });
    await input.fill('NEWER_CHANGED_DRAFT');
    await recovery.getByRole('button', { name: '核对已保存版本', exact: true }).click();
    await recovery.getByText('当前输入未能核对此版本，请复制、另存或处理输入区冲突。', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), 'NEWER_CHANGED_DRAFT');
  });
  await scenario('browser-reference-owner-guard', async () => {
    const page = await newPage('/local/retry-owner'); await ready(page, 'retry-owner');
    await attachBrowserReference(page, 'retry-owner');
    const { recovery, receipt } = await removeWithReadFailure(page, 'retry-owner');
    const original = page.url();
    await page.getByRole('button', { name: 'Parent other', exact: true }).click();
    await page.getByText('当前草稿版本已变化；可见内容尚未确认保存，请先处理冲突。', { exact: false }).waitFor();
    assert.equal(page.url(), original, 'The unresolved original projection must not navigate to another owner.');
    assert.equal(await recovery.isVisible(), true);
    assert.equal(receipt.before.owner.threadId, 'retry-owner');
  });
  await scenario('confirmed-send', async () => {
    const page = await newPage('/local/send'); await ready(page, 'send');
    await attachBrowserReference(page, 'send');
    holdTurn = true;
    await page.getByRole('textbox', { name: 'Work with Codex', exact: true }).fill('CONFIRMED_WITH_BROWSER_REFERENCE');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await fake.waitFor(message => message.method === 'turn/start' && message.params.threadId === 'send');
    const { recovery, receipt } = await removeWithReadFailure(page, 'send');
    turn.resolve(); holdTurn = false;
    const sending = page.getByRole('region', { name: 'Message send recovery', exact: true })
      .filter({ hasText: 'CONFIRMED_WITH_BROWSER_REFERENCE' });
    await sending.getByText('消息已发送；原提交版本的草稿清理待处理，较新的草稿将保留。', { exact: true }).waitFor();
    const atoms = await readAtoms(page), sendStore = record(atoms['codex-yard.send-recovery.v1']);
    const intents = Object.values(record(sendStore.requests)).map(record);
    const intent = intents.find(item => item.stage === 'confirmed' && record(item.draft).text === 'CONFIRMED_WITH_BROWSER_REFERENCE');
    assert(intent, 'The original confirmed intent must remain available.');
    assert.equal(intent.revision, receipt.before.revision);
    const repository = record(atoms['codex-yard.composer-drafts.v3']);
    assert(Object.values(record(repository.entries)).map(record).some(entry => Array.isArray(entry.retained)
      && entry.retained.some(version => record(version).revision === intent.revision)), 'The submitted draft revision must remain retained.');
    await sending.getByRole('button', { name: 'Keep newer draft and close', exact: true }).click();
    await sending.getByRole('alert').waitFor();
    const blocked = await readAtoms(page), blockedRequests = record(record(blocked['codex-yard.send-recovery.v1']).requests);
    assert.equal(record(blockedRequests[String(intent.id)]).stage, 'confirmed', 'Failed cleanup must retain the same confirmed intent.');
    assert(Object.values(record(record(blocked['codex-yard.composer-drafts.v3']).entries)).map(record)
      .some(entry => Array.isArray(entry.retained) && entry.retained.some(version => record(version).revision === intent.revision)),
    'Failed cleanup must retain the original submitted draft revision.');
    assert.equal(fake.calls('turn/start').filter(call => call.params.threadId === 'send').length, 1);
    await recovery.getByRole('button', { name: '核对已保存版本', exact: true }).click();
    await recovery.waitFor({ state: 'hidden' });
    await sending.getByRole('button', { name: 'Keep newer draft and close', exact: true }).click();
    await sending.waitFor({ state: 'hidden' });
    const finished = await readAtoms(page);
    assert.equal(record(record(finished['codex-yard.send-recovery.v1']).requests)[String(intent.id)], undefined);
    assert.equal(Object.values(record(record(finished['codex-yard.composer-drafts.v3']).entries)).map(record)
      .some(entry => Array.isArray(entry.retained) && entry.retained.some(version => record(version).revision === intent.revision)), false);
    assert.equal(fake.calls('turn/start').filter(call => call.params.threadId === 'send').length, 1);
  });
  await scenario('deleted-reference-ime', async () => {
    const page = await newPage('/local/ime'); await ready(page, 'ime');
    await attachBrowserReference(page, 'ime');
    await page.locator('.standalone-composer__reference').filter({ hasText: 'Fixture ime reference' })
      .getByRole('button', { name: 'Remove reference', exact: true }).click();
    await page.locator('.standalone-composer__reference').filter({ hasText: 'Fixture ime reference' }).waitFor({ state: 'hidden' });
    const input = page.getByRole('textbox', { name: 'Work with Codex', exact: true });
    await page.evaluate(() => {
      const input = document.querySelector('textarea[aria-label="Work with Codex"]')!;
      const state = { freezes: 0 };
      (window as unknown as { imeObservation: typeof state }).imeObservation = state;
      new MutationObserver(() => { if (input.closest('[inert]')) state.freezes++; }).observe(document.body,
        { subtree: true, attributes: true, attributeFilter: ['inert'] });
    });
    await input.dispatchEvent('compositionstart', { data: 'a' });
    await input.fill('UNRELATED_IME_INPUT');
    assert.equal(await input.evaluate(element => element.closest('[inert]') !== null), false);
    assert.equal(await page.getByText('请先完成输入法输入。', { exact: false }).count(), 0);
    await input.dispatchEvent('compositionend', { data: 'a' });
    assert.equal(await input.inputValue(), 'UNRELATED_IME_INPUT');
    assert.equal(await page.evaluate(() => (window as unknown as { imeObservation: { freezes: number } }).imeObservation.freezes), 0);
  });
  await scenario('pending-deletion-after-ime', async () => {
    const first = await newPage('/local/ime-pending'); await ready(first, 'ime-pending');
    let second: Page | undefined;
    try {
      await attachBrowserReference(first, 'ime-pending');
      second = await newPage('/local/ime-pending'); await ready(second, 'ime-pending');
      active.page = first;
      const otherChip = second.locator('.standalone-composer__reference').filter({ hasText: 'Fixture ime-pending reference' });
      await otherChip.waitFor();
      const input = first.getByRole('textbox', { name: 'Work with Codex', exact: true });
      await input.focus();
      await input.dispatchEvent('compositionstart', { data: 'a' });
      await first.keyboard.insertText('IME_PENDING_TEXT');
      await second.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Work with Codex"]')?.value === 'IME_PENDING_TEXT');
      const oldUrl = first.url();
      await first.getByRole('button', { name: 'Settings', exact: true }).click();
      await first.getByRole('alert').filter({ hasText: 'Finish text composition first.' }).waitFor();
      assert.equal(first.url(), oldUrl);
      await otherChip.getByRole('button', { name: 'Remove reference', exact: true }).click();
      await otherChip.waitFor({ state: 'hidden' });
      const chip = first.locator('.standalone-composer__reference').filter({ hasText: 'Fixture ime-pending reference' });
      assert.equal(await input.inputValue(), 'IME_PENDING_TEXT', 'Cross-page deletion must preserve the active composition text.');
      await input.dispatchEvent('compositionend', { data: 'a' });
      await first.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      active.page = first;
      await chip.waitFor({ state: 'hidden' });
      assert.equal(await input.inputValue(), 'IME_PENDING_TEXT');
      assert.equal(await input.evaluate(element => element.closest('[inert]') !== null), false);
    } finally {
      if (second && !second.isClosed()) await second.close();
      if (!first.isClosed() && currentPage() !== first) await first.close();
    }
  });
  await scenario('pending-deletion-composition-end-only', async () => {
    const first = await newPage('/local/ime-end'); await ready(first, 'ime-end');
    let second: Page | undefined;
    try {
      await attachBrowserReference(first, 'ime-end');
      second = await newPage('/local/ime-end'); await ready(second, 'ime-end');
      active.page = first;
      const chip = first.locator('.standalone-composer__reference').filter({ hasText: 'Fixture ime-end reference' });
      await chip.waitFor();
      const otherChip = second.locator('.standalone-composer__reference').filter({ hasText: 'Fixture ime-end reference' });
      await otherChip.waitFor();
      const input = first.getByRole('textbox', { name: 'Work with Codex', exact: true });
      await input.dispatchEvent('compositionstart', { data: 'a' });
      await first.evaluate(() => {
        const state = { fired: 0, inputEvents: 0, trackWrites: false, rootWrites: 0 };
        (window as unknown as { parentFault: typeof state }).parentFault = state;
        window.addEventListener('input', () => { state.inputEvents++; });
        const get = IDBObjectStore.prototype.get;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
          if (state.trackWrites && this.name === 'atoms' && args[1] === 'native-atoms') state.rootWrites++;
          return put.apply(this, args);
        };
        IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
          const request = get.apply(this, args);
          if ((new Error().stack ?? '').includes('readComposerDraftVersions')) {
            request.addEventListener('success', () => {
              const root = request.result as { atoms?: Record<string, unknown> } | undefined;
              const comments = root?.atoms?.['codex-yard.browser-comments.v1'];
              const deleted = comments && typeof comments === 'object' ? (comments as Record<string, unknown>)['codex-yard.browser-deletions.v1'] : undefined;
              if (!state.fired && JSON.stringify(deleted ?? null).includes('comment-ime-end')) {
                state.fired++; request.transaction?.abort();
              }
            }, { once: true });
          }
          return request;
        };
      });
      await otherChip.getByRole('button', { name: 'Remove reference', exact: true }).click();
      await otherChip.waitFor({ state: 'hidden' });
      await first.waitForFunction(() => (window as unknown as { parentFault?: { fired: number } }).parentFault?.fired === 1);
      assert.equal(await chip.isVisible(), true, 'The pending reference must remain while composing.');
      const beforeRetry = await activeVersions(second, 'ime-end');
      assert.equal(beforeRetry.length, 1);
      assert.deepEqual(record(beforeRetry[0]!.draft).references, []);
      await first.evaluate(() => { (window as unknown as { parentFault: { trackWrites: boolean } }).parentFault.trackWrites = true; });
      await input.dispatchEvent('compositionend', { data: 'a' });
      try { await chip.waitFor({ state: 'hidden' }); }
      catch (failure) {
        // Diagnostic only: preserve the original failure even if a later input wakes the watcher.
        await input.dispatchEvent('input');
        const recovered = await chip.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false);
        await first.evaluate(value => { (window as unknown as { parentFault: { recoveredAfterInput: boolean } }).parentFault.recoveredAfterInput = value; }, recovered);
        throw failure;
      }
      assert.equal(await input.evaluate(element => element.closest('[inert]') !== null), false);
      const afterRetry = await activeVersions(first, 'ime-end');
      assert.deepEqual(afterRetry, beforeRetry, 'The exact committed deletion must be adopted without another draft write.');
      const fault = await first.evaluate(() => (window as unknown as {
        parentFault: { fired: number; inputEvents: number; rootWrites: number }
      }).parentFault);
      assert.equal(fault.fired, 1);
      assert.equal(fault.inputEvents, 0, 'No later input event may trigger this recovery.');
      assert.equal(fault.rootWrites, 0, 'Adopting the committed deletion must not write the root again.');
      await writeFile(join(artifacts, 'pending-deletion-composition-end-only-evidence.json'),
        JSON.stringify({ fault, beforeRetry, afterRetry }, null, 2));
    } finally {
      if (second && !second.isClosed()) await second.close();
      if (!first.isClosed() && currentPage() !== first) await first.close();
    }
  });
  await scenario('pending-deletion-independent-text', () => conflictingDeletion('ime-conflict-text'));
  await scenario('pending-deletion-different-reference', () => conflictingDeletion('ime-conflict-ref'));
} finally {
  loading.resolve(); turn.resolve();
  await browser.close(); await app.close(); await fake.close(); await remote.close();
  await rm(shortDirectory, { recursive: true, force: true });
}
await writeFile(join(artifacts, 'results.json'), JSON.stringify({ source, results, errors }, null, 2));
if (results.some(result => result.status === 'fail') || errors.length) process.exitCode = 1;
console.log(JSON.stringify({ artifacts, results: results.map(({ name, status }) => ({ name, status })), errors }));
