import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import type { BrowserOwner } from '../src/renderer/browser/comments.ts';
import type { Fixture } from './browser-consumption-fixture.tsx';

declare global { interface Window { browserConsumption: Fixture } }

const owner: BrowserOwner = { hostId: 'local', threadId: 'recovery-thread', draftId: 'recovery-draft' };
const other: BrowserOwner = { hostId: 'ssh-fixture', threadId: 'recovery-thread', draftId: 'other-draft' };

async function withBrowser(run: (context: BrowserContext, origin: string) => Promise<void>) {
  const bundle = await build({ entryPoints: ['test/browser-consumption-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const root = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'browser-final-recovery-'));
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0]!.text); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    executablePath: '/usr/bin/google-chrome', headless: true, downloadsPath: root,
    args: ['--no-sandbox', '--disable-background-networking', '--process-per-tab'],
  });
  try { await run(context, `http://127.0.0.1:${address.port}`); }
  finally {
    await context.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function mount(page: Page, value: BrowserOwner) {
  await page.evaluate(target => window.browserConsumption.mount(target), value);
  await page.waitForFunction(async target => {
    const snapshot = window.browserConsumption.snapshot();
    if (!snapshot || JSON.stringify(snapshot.owner) !== JSON.stringify(target)) return false;
    return (await window.browserConsumption.versions(target)).versions.some(version => version.revision === snapshot.revision);
  }, value);
}

async function addAndAttach(page: Page, value: BrowserOwner, otherOwnerPending = false) {
  const reference = await page.evaluate(target => window.browserConsumption.addComment(target), value);
  await page.getByRole('button', { name: '添加到草稿' }).last().click();
  try {
    await page.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(reference => reference.id === id), reference.id,
      { timeout: 8_000 });
  } catch (error) {
    const details = await page.evaluate(() => ({ snapshot: window.browserConsumption.snapshot(),
      messages: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(element => element.textContent) }));
    throw new Error(`Could not attach fixture reference: ${JSON.stringify(details)}`, { cause: error });
  }
  if (otherOwnerPending) {
    await page.waitForFunction(() => {
      const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="浏览器引用批注"]');
      return editors.length > 0 && !editors[editors.length - 1]!.readOnly;
    });
  } else await page.waitForFunction(() => !window.browserConsumption.dirty());
  return reference;
}

async function roots(page: Page) {
  return page.evaluate(async () => ({ comments: await window.browserConsumption.atom('codex-yard.browser-comments.v1'),
    drafts: await window.browserConsumption.atom('codex-yard.composer-drafts.v3') }));
}

async function assertDifferentRenderers(context: BrowserContext) {
  const internals = await context.newPage(); await internals.goto('chrome://process-internals/#web-contents');
  await internals.waitForFunction(() => {
    const visit = (root: ParentNode): boolean => [...root.querySelectorAll('*')].some(element => element.shadowRoot !== null
      && (element.shadowRoot.textContent?.includes('/writer') || visit(element.shadowRoot)));
    return visit(document);
  });
  const processes = await internals.evaluate(() => {
    const ids: number[] = [];
    const visit = (root: ParentNode) => { for (const element of root.querySelectorAll('*')) if (element.shadowRoot) {
      const match = element.shadowRoot.textContent?.match(/Frame\[(\d+):\d+\][^\n]*\| url: ([^\s]+)/);
      if (match && (match[2]!.endsWith('/first') || match[2]!.endsWith('/writer'))) ids.push(Number(match[1]));
      visit(element.shadowRoot);
    } };
    visit(document); return ids;
  });
  assert.equal(processes.length, 2); assert.notEqual(processes[0], processes[1]);
  await internals.close();
}

test('recovery checks durable activity even when the controller still displays the removed version', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000,
}, async () => withBrowser(async (context, origin) => {
  const first = await context.newPage(); await first.goto(origin + '/first'); await mount(first, owner);
  await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('main draft');
  await addAndAttach(first, owner);
  const writer = await context.newPage(); await writer.goto(origin + '/writer'); await mount(writer, owner);
  await assertDifferentRenderers(context);
  await writer.evaluate(target => window.browserConsumption.forkVersion(target, 'independent-one', 'independent one'), owner);
  await writer.evaluate(target => window.browserConsumption.forkVersion(target, 'independent-two', 'independent two'), owner);
  await first.waitForFunction(async target => (await window.browserConsumption.versions(target)).versions.length === 3, owner);

  await first.evaluate(() => window.browserConsumption.rejectNextCommit());
  await first.getByLabel('浏览器引用批注').fill('saved but unaccepted');
  await first.getByRole('button', { name: '保存批注' }).click();
  const recovery = first.locator('section[role="status"]').filter({ hasText: '批注和新草稿版本已保存' });
  await recovery.waitFor();
  await first.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(button => button.textContent === '核对已保存的草稿版本' && !button.disabled));
  const saved = JSON.parse(await recovery.locator('pre').innerText());
  await first.waitForFunction(revision => window.browserConsumption.snapshot()?.revision === revision, saved.revision);
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false, 'Displaying after alone does not release protection');
  await writer.evaluate(snapshot => window.browserConsumption.replaceVersion(snapshot, 'cross-page-replacement', 'newer cross-page edit'), saved);
  await first.waitForFunction(async ({ target, revision }) => !(await window.browserConsumption.versions(target)).versions
    .some(version => version.revision === revision), { target: owner, revision: saved.revision });
  assert.deepEqual(await first.evaluate(() => window.browserConsumption.snapshot()), saved, 'The old after is still displayed in memory');
  await recovery.getByRole('button', { name: '核对已保存的草稿版本' }).click();
  await first.getByText('当前草稿未能确认此活动版本', { exact: false }).waitFor();
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false);
  assert.deepEqual(JSON.parse(await recovery.locator('pre').innerText()), saved);
  const downloadPromise = first.waitForEvent('download');
  await recovery.getByRole('button', { name: '另存已保存快照' }).click();
  const download = await downloadPromise;
  assert.deepEqual(JSON.parse(await readFile((await download.path())!, 'utf8')), saved);
  const beforeDiscard = await roots(first);
  await recovery.getByRole('button', { name: '放弃此待接收快照' }).click();
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), true);
  assert.deepEqual(await roots(first), beforeDiscard, 'Discard never changes either persistent atom');
  assert.ok(!(await first.evaluate(target => window.browserConsumption.versions(target), owner)).versions
    .some(version => version.revision === saved.revision));
  assert.ok((await first.evaluate(target => window.browserConsumption.versions(target), owner)).versions
    .some(version => version.revision === 'cross-page-replacement' && version.draft.text === 'newer cross-page edit'));
}));

test('cross-renderer replacement before acceptance preserves the committed receipt', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000,
}, async () => withBrowser(async (context, origin) => {
  const first = await context.newPage(); await first.goto(origin + '/first'); await mount(first, owner);
  await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('saved draft');
  await addAndAttach(first, owner);
  const writer = await context.newPage(); await writer.goto(origin + '/writer'); await mount(writer, owner);
  await assertDifferentRenderers(context);
  await first.evaluate(() => window.browserConsumption.holdNextCommit());
  await first.getByLabel('浏览器引用批注').fill('committed reference');
  await first.getByRole('button', { name: '保存批注' }).click();
  await first.waitForFunction(() => window.browserConsumption.commitBlocked());
  const recovery = first.locator('section[role="status"]').filter({ hasText: '批注和新草稿版本已保存' });
  await recovery.waitFor();
  const saved = JSON.parse(await recovery.locator('pre').innerText());
  assert.equal(await first.locator('[aria-label="和 Codex 一起工作"]').evaluate(element => !!element.closest('[inert]')), true);
  await writer.evaluate(snapshot => window.browserConsumption.replaceVersion(snapshot, 'replaced-before-acceptance', 'other renderer'), saved);
  await first.evaluate(() => window.browserConsumption.releaseCommit());
  await first.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(button => button.textContent === '放弃此待接收快照' && !button.disabled));
  assert.deepEqual(JSON.parse(await recovery.locator('pre').innerText()), saved);
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false);
  await first.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; },
  } }));
  await recovery.getByRole('button', { name: '复制已保存版本' }).click();
  assert.deepEqual(JSON.parse(await first.evaluate(() => (window as unknown as { copied: string }).copied)), saved);
  const downloadPromise = first.waitForEvent('download');
  await recovery.getByRole('button', { name: '另存已保存快照' }).click();
  const download = await downloadPromise;
  assert.deepEqual(JSON.parse(await readFile((await download.path())!, 'utf8')), saved);
  const beforeDiscard = await roots(first);
  await recovery.getByRole('button', { name: '放弃此待接收快照' }).click();
  assert.deepEqual(await roots(first), beforeDiscard);
}));

test('a stale thread-scoped browser owner cannot bypass a newly established home binding', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000,
}, async () => withBrowser(async (context, origin) => {
  const home: BrowserOwner = { hostId: 'local', threadId: null, draftId: 'home-bound-race' };
  const stale: BrowserOwner = { ...home, threadId: 'bound-thread' };
  const page = await context.newPage(); await page.goto(origin); await mount(page, home);
  await addAndAttach(page, home);
  await page.evaluate(() => window.browserConsumption.prepare('bound-thread'));
  await mount(page, stale);
  const reference = await page.evaluate(target => window.browserConsumption.addComment(target), stale);
  const snapshot = (await page.evaluate(() => window.browserConsumption.snapshot()))!;
  assert.deepEqual(snapshot.owner, stale);
  const before = await roots(page);
  const error = await page.evaluate(async ({ target, reference, snapshot }) => {
    try { await window.browserConsumption.attach(target, reference, snapshot); return ''; }
    catch (failure) { return (failure as Error).message; }
  }, { target: stale, reference, snapshot });
  assert.match(error, /会话关联无法核实/);
  assert.deepEqual(await roots(page), before);
  const valid = await addAndAttach(page, home);
  assert.ok((await page.evaluate(() => window.browserConsumption.snapshot()))?.draft.references?.some(item => item.id === valid.id));
}));

test('a binding installed by another renderer while the browser action waits rejects the stale owner', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000,
}, async () => withBrowser(async (context, origin) => {
  const stale: BrowserOwner = { hostId: 'local', threadId: 'binding-race', draftId: 'home-race' };
  const first = await context.newPage(); await first.goto(origin + '/first'); await mount(first, stale);
  await addAndAttach(first, stale);
  const writer = await context.newPage(); await writer.goto(origin + '/writer');
  await assertDifferentRenderers(context);
  await first.getByLabel('浏览器引用批注').fill('must remain unsaved');
  const before = await roots(first);
  await first.evaluate(() => window.browserConsumption.holdSnapshot());
  await first.getByRole('button', { name: '保存批注' }).click();
  await first.waitForFunction(() => window.browserConsumption.snapshotBlocked());
  await writer.evaluate(value => window.browserConsumption.setBinding(value.hostId, value.threadId!, value.draftId), stale);
  await first.evaluate(() => window.browserConsumption.releaseSnapshot());
  await first.getByText('草稿与浏览器引用的会话关联无法核实', { exact: false }).waitFor();
  assert.equal(await first.getByLabel('浏览器引用批注').inputValue(), 'must remain unsaved');
  assert.deepEqual(await roots(first), before);
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false);
}));

test('discarding another owner removes only its matching in-memory receipt', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000,
}, async () => withBrowser(async (context, origin) => {
  const page = await context.newPage(); await page.goto(origin); await mount(page, owner);
  await addAndAttach(page, owner);
  await page.evaluate(() => window.browserConsumption.holdNextCommit());
  await page.getByLabel('浏览器引用批注').fill('owner A receipt');
  await page.getByRole('button', { name: '保存批注' }).click();
  await page.waitForFunction(() => window.browserConsumption.commitBlocked());
  await page.getByText('批注和新草稿版本已保存', { exact: false }).first().waitFor();
  await mount(page, other);
  const elsewhere = page.locator('section[role="status"]').filter({ hasText: '其他草稿有已保存但尚未接收的版本' });
  await elsewhere.waitFor();
  assert.equal(await elsewhere.getByRole('button', { name: '放弃此待接收快照' }).isDisabled(), true,
    'A receipt cannot be discarded while its original acceptance is in flight');
  const otherSnapshot = JSON.parse(await elsewhere.locator('pre').innerText());
  const downloadPromise = page.waitForEvent('download');
  await elsewhere.getByRole('button', { name: '另存已保存快照' }).click();
  const download = await downloadPromise;
  assert.deepEqual(JSON.parse(await readFile((await download.path())!, 'utf8')), otherSnapshot);
  await addAndAttach(page, other, true);
  await page.evaluate(() => window.browserConsumption.releaseCommit());
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(button => button.textContent === '放弃此待接收快照' && !button.disabled));
  await page.evaluate(() => window.browserConsumption.rejectNextCommit());
  await page.getByLabel('浏览器引用批注').fill('owner B receipt');
  await page.getByRole('button', { name: '保存批注' }).click();
  const current = page.locator('section[role="status"]').filter({ hasText: '批注和新草稿版本已保存' });
  await current.waitFor();
  const currentSnapshot = JSON.parse(await current.locator('pre').innerText());
  const savedRoots = await roots(page);
  await elsewhere.getByRole('button', { name: '放弃此待接收快照' }).click();
  assert.equal(await elsewhere.count(), 0);
  assert.deepEqual(JSON.parse(await current.locator('pre').innerText()), currentSnapshot);
  assert.equal(await page.evaluate(() => window.browserConsumption.canLeave()), false);
  assert.deepEqual(await roots(page), savedRoots);
  await current.getByRole('button', { name: '放弃此待接收快照' }).click();
  assert.equal(await page.evaluate(() => window.browserConsumption.canLeave()), true);
  assert.deepEqual(await roots(page), savedRoots);
  await mount(page, owner);
  assert.equal(await page.getByText('其他草稿有已保存但尚未接收的版本').count(), 0);
  assert.ok((await page.evaluate(target => window.browserConsumption.comments(target), owner)).comments.length);
}));

test('same-owner actions cannot race the original acceptance or replace its pending receipt', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000,
}, async () => withBrowser(async (context, origin) => {
  const page = await context.newPage(); await page.goto(origin); await mount(page, owner);
  await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('base draft');
  await addAndAttach(page, owner); await addAndAttach(page, owner);
  await page.evaluate(target => window.browserConsumption.forkVersion(target, 'independent-race', 'independent race'), owner);
  await page.waitForFunction(async target => (await window.browserConsumption.versions(target)).versions.length === 2, owner);
  await page.getByLabel('浏览器引用批注').nth(0).fill('first edit');
  await page.getByLabel('浏览器引用批注').nth(1).fill('second edit');
  const beforeRejectedBegin = await roots(page);
  await page.evaluate(() => window.browserConsumption.rejectNextBegin());
  await page.getByRole('button', { name: '保存批注' }).nth(0).click();
  await page.getByText('草稿当前无法接收浏览器操作', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('浏览器引用批注').nth(0).inputValue(), 'first edit');
  assert.deepEqual(await roots(page), beforeRejectedBegin);
  await page.evaluate(() => { window.browserConsumption.holdSnapshot(); window.browserConsumption.holdNextCommit(); });
  const beforeSnapshot = await roots(page);
  await page.getByRole('button', { name: '保存批注' }).nth(0).click();
  await page.waitForFunction(() => window.browserConsumption.snapshotBlocked());
  await page.getByRole('button', { name: '保存批注' }).nth(1).click();
  await page.getByText('此草稿的浏览器操作正在处理', { exact: false }).waitFor();
  assert.deepEqual(await roots(page), beforeSnapshot, 'A competing action cannot start while the first snapshot is pending');
  await page.evaluate(() => window.browserConsumption.releaseSnapshot());
  await page.waitForFunction(() => window.browserConsumption.commitBlocked());
  assert.equal(await page.locator('[aria-label="和 Codex 一起工作"]').evaluate(element => !!element.closest('[inert]')), true);
  const recovery = page.locator('section[role="status"]').filter({ hasText: '批注和新草稿版本已保存' });
  await recovery.waitFor();
  const receipt = JSON.parse(await recovery.locator('pre').innerText());
  assert.equal(await recovery.getByRole('button', { name: '核对已保存的草稿版本' }).isDisabled(), true);
  assert.equal(await recovery.getByRole('button', { name: '放弃此待接收快照' }).isDisabled(), true);
  const committed = await roots(page);
  await page.getByRole('button', { name: '保存批注' }).nth(1).click();
  await page.getByText('此草稿的浏览器操作正在处理', { exact: false }).waitFor();
  assert.deepEqual(await roots(page), committed);
  assert.deepEqual(JSON.parse(await recovery.locator('pre').innerText()), receipt);
  assert.equal(await page.getByLabel('浏览器引用批注').nth(1).inputValue(), 'second edit');
  await page.evaluate(() => window.browserConsumption.releaseCommit());
  await recovery.waitFor({ state: 'hidden' });
  await page.waitForFunction(revision => window.browserConsumption.snapshot()?.revision === revision, receipt.revision);
  assert.equal(await page.evaluate(() => window.browserConsumption.canLeave()), false, 'The second unsaved edit remains protected');
  assert.equal(await page.getByLabel('浏览器引用批注').nth(1).inputValue(), 'second edit');
  await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('newer local edit');
  await page.waitForFunction(async target => (await window.browserConsumption.versions(target)).versions.some(version =>
    version.draft.text === 'newer local edit' && version.draft.references?.some(reference => reference.text.includes('first edit'))), owner);
  await page.getByRole('button', { name: '保存批注' }).nth(1).click();
  await page.waitForFunction(() => !window.browserConsumption.dirty());
  const comments = (await page.evaluate(target => window.browserConsumption.comments(target), owner)).comments;
  assert.match(JSON.stringify(comments), /first edit/);
  assert.match(JSON.stringify(comments), /second edit/);
}));
