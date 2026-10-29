import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import { browserOwnerKey, browserReferences } from '../src/renderer/browser/comments.ts';
import type { BrowserOwner } from '../src/renderer/browser/comments.ts';
import type { Fixture } from './browser-consumption-fixture.tsx';

async function waitForBrowser(check: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for the asynchronous browser condition.')), 8_000);
  });
  try {
    for (;;) {
      if (await Promise.race([check(), timeout])) return;
      await Promise.race([new Promise(resolve => setTimeout(resolve, 30)), timeout]);
    }
  } finally { clearTimeout(timer); }
}

declare global { interface Window { browserConsumption: Fixture } }

const owner: BrowserOwner = { hostId: 'local', threadId: 'review-thread', draftId: 'review-draft' };

async function withBrowser(run: (context: BrowserContext, origin: string) => Promise<void>) {
  const bundle = await build({ entryPoints: ['test/browser-consumption-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const root = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'browser-review-'));
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
    executablePath: '/usr/bin/google-chrome', headless: true,
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
  await page.waitForFunction(target => {
    const snapshot = window.browserConsumption.snapshot();
    return snapshot?.owner.hostId === target.hostId && snapshot.owner.threadId === target.threadId && snapshot.owner.draftId === target.draftId;
  }, value);
  await waitForBrowser(() => page.evaluate(async target => {
    const snapshot = window.browserConsumption.snapshot(), versions = await window.browserConsumption.versions(target);
    return !!snapshot && versions.versions.some(version => version.revision === snapshot.revision);
  }, value));
}

async function addAndAttach(page: Page, value: BrowserOwner) {
  const reference = await page.evaluate(target => window.browserConsumption.addComment(target), value);
  await page.getByRole('button', { name: '添加到草稿' }).last().click();
  await page.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(reference => reference.id === id), reference.id);
  return reference;
}

test('unsaved panel edits survive list changes, cross-page deletion and owner switches; saving freezes input', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 120_000,
}, async () => withBrowser(async (context, origin) => {
  const first = await context.newPage(); await first.goto(origin + '/first'); await mount(first, owner);
  const firstRef = await addAndAttach(first, owner), secondRef = await addAndAttach(first, owner);
  await first.getByLabel('浏览器引用批注').nth(1).fill('pending B after A is removed');
  assert.equal(await first.evaluate(() => window.browserConsumption.dirty()), true);
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false);
  await first.getByRole('button', { name: '删除引用' }).first().click();
  await first.waitForFunction(id => !window.browserConsumption.snapshot()?.draft.references?.some(reference => reference.id === id), firstRef.id);
  await first.waitForFunction(() => document.querySelectorAll('textarea[aria-label="浏览器引用批注"]').length === 1);
  assert.equal(await first.getByLabel('浏览器引用批注').inputValue(), 'pending B after A is removed');
  await first.evaluate(() => window.browserConsumption.holdSnapshot());
  await first.getByRole('button', { name: '保存批注' }).click();
  await first.waitForFunction(() => window.browserConsumption.snapshotBlocked());
  assert.equal(await first.getByLabel('浏览器引用批注').isEditable(), false);
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false);
  await first.evaluate(() => window.browserConsumption.releaseSnapshot());
  await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.[0]?.text.includes('pending B after A is removed'));
  await first.waitForFunction(() => !window.browserConsumption.dirty());

  const second = await context.newPage(); await second.goto(origin + '/second'); await mount(second, owner);
  await second.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(reference => reference.id === id), secondRef.id);
  const internals = await context.newPage(); await internals.goto('chrome://process-internals/#web-contents');
  await internals.waitForFunction(() => {
    const visit = (root: ParentNode): boolean => [...root.querySelectorAll('*')].some(element => element.shadowRoot !== null
      && (element.shadowRoot.textContent?.includes('/first') || visit(element.shadowRoot)));
    return visit(document);
  });
  const processes = await internals.evaluate(() => {
    const ids: number[] = [];
    const visit = (root: ParentNode) => { for (const element of root.querySelectorAll('*')) if (element.shadowRoot) {
      const match = element.shadowRoot.textContent?.match(/Frame\[(\d+):\d+\][^\n]*\| url: ([^\s]+)/);
      if (match && (match[2]!.endsWith('/first') || match[2]!.endsWith('/second'))) ids.push(Number(match[1]));
      visit(element.shadowRoot);
    } };
    visit(document); return ids;
  });
  assert.equal(processes.length, 2); assert.notEqual(processes[0], processes[1]);
  await internals.close();
  await first.getByLabel('浏览器引用批注').fill('unsaved text survives deletion');
  await second.getByRole('button', { name: '删除引用' }).click();
  await waitForBrowser(() => second.evaluate(async target => (await window.browserConsumption.comments(target)).comments.length === 0, owner));
  await first.waitForFunction(() => [...document.querySelectorAll('textarea')].some(element => element.value === 'unsaved text survives deletion'));
  await first.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; },
  } }));
  const other = { hostId: 'ssh-review', threadId: 'other-thread', draftId: 'other-draft' };
  await mount(first, other);
  assert.equal(await first.getByLabel('待处理的批注文字').inputValue(), 'unsaved text survives deletion');
  await first.getByRole('button', { name: '复制未保存文字' }).click();
  assert.equal(await first.evaluate(() => (window as unknown as { copied: string }).copied), 'unsaved text survives deletion');
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false);
  await first.getByRole('button', { name: '关闭', exact: true }).click();
  await first.getByText('浏览器批注有待处理的编辑或已保存版本', { exact: false }).waitFor();
  assert.equal(await first.evaluate(() => window.browserConsumption.closes()), 0);
  await mount(first, owner);
  assert.equal(await first.evaluate(() => [...document.querySelectorAll('textarea')].some(element => element.value === 'unsaved text survives deletion')), true);
  await first.getByRole('button', { name: '放弃编辑' }).click();
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), true);
}));

test('a deleted legacy reference remains tombstoned and a manual claim gets an independent identity', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 90_000,
}, async () => withBrowser(async (context, origin) => {
  const original = { type: 'comment', origin: 'browser', content: [{ content_type: 'text', text: 'old editable value', future: true }],
    localBrowserContext: { pageUrl: 'https://fixture.invalid/', targetDescription: 'Legacy', extra: 1 },
    localBrowserCommentMetadata: { commentId: 'old-id', kind: 'element', extra: 2 }, future: { keep: true } };
  const raw = JSON.stringify({ [browserOwnerKey(owner)]: [original], legacy: [original], unknown: { keep: 1 } }, null, 2) + '\n';
  await context.addInitScript(value => localStorage.setItem('workbench.browser-comments.v1', value), raw);
  const page = await context.newPage(); await page.goto(origin); await mount(page, owner);
  const oldRef = browserReferences(owner, [original])[0]!;
  await page.getByRole('button', { name: '添加到草稿' }).click();
  await page.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(reference => reference.id === id), oldRef.id);
  await page.getByRole('button', { name: '删除引用' }).click();
  await waitForBrowser(() => page.evaluate(async target => (await window.browserConsumption.comments(target)).deleted.length === 1, owner));
  await page.evaluate(target => window.browserConsumption.claimProven(target, 'legacy'), owner);
  let stored = await page.evaluate(() => window.browserConsumption.atom('codex-yard.browser-comments.v1')) as Record<string, unknown>;
  assert.deepEqual((stored.entries as Record<string, unknown>).legacy, [original]);
  await page.getByText('待认领的旧浏览器批注').click();
  await page.getByRole('button', { name: '认领可添加的批注' }).click();
  await waitForBrowser(() => page.evaluate(async target => (await window.browserConsumption.comments(target)).comments.length === 1, owner));
  const state = await page.evaluate(target => window.browserConsumption.comments(target), owner);
  const newRef = browserReferences(owner, state.comments)[0]!;
  assert.notEqual(newRef.id, oldRef.id);
  assert.deepEqual(state.deleted, [oldRef]);
  assert.deepEqual(newRef.original.future, original.future);
  stored = await page.evaluate(() => window.browserConsumption.atom('codex-yard.browser-comments.v1')) as Record<string, unknown>;
  assert.equal(stored.legacyRaw, raw);
  assert.deepEqual((stored.entries as Record<string, unknown>).unknown, { keep: 1 });
  await page.getByRole('button', { name: '添加到草稿' }).click();
  await page.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(reference => reference.id === id), newRef.id);
  const prepared = await page.evaluate(() => window.browserConsumption.prepare());
  assert.deepEqual(prepared.draft.references, [newRef]);
  await page.reload(); await mount(page, owner);
  await page.waitForFunction(value => JSON.stringify(window.browserConsumption.snapshot()?.draft.references) === JSON.stringify([value]), newRef);
  assert.deepEqual((await page.evaluate(() => window.browserConsumption.snapshot()))?.draft.references, [newRef]);
}));

test('R1 confirmation and removal preserve shared R2 and an explicitly selected durable version', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 120_000,
}, async () => withBrowser(async (context, origin) => {
  const first = await context.newPage(); await first.goto(origin + '/first'); await mount(first, owner);
  const original = await addAndAttach(first, owner);
  const second = await context.newPage(); await second.goto(origin + '/second'); await mount(second, owner);
  await second.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(reference => reference.id === id), original.id);

  const locker = await context.newPage(); await locker.goto(origin + '/locker');
  await locker.evaluate(async () => {
    const state = window as unknown as { ready: boolean; unlock(): void };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('atoms', 'readwrite'), store = tx.objectStore('atoms'); let held = true;
    state.unlock = () => { held = false; };
    tx.oncomplete = () => db.close();
    const keep = () => { if (held) { const request = store.get('native-atoms'); request.onsuccess = () => { state.ready = true; keep(); }; } };
    keep();
  });
  await locker.waitForFunction(() => (window as unknown as { ready: boolean }).ready);
  await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Page A');
  await second.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Page B');
  await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.text === 'Page A');
  await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.text === 'Page B');
  await locker.evaluate(() => (window as unknown as { unlock(): void }).unlock());
  await waitForBrowser(() => first.evaluate(async target => (await window.browserConsumption.versions(target)).versions.length === 2, owner));
  await locker.close();
  const intent = await second.evaluate(() => window.browserConsumption.prepare());
  assert.deepEqual(intent.draft.references, [original]);

  await first.evaluate(() => window.browserConsumption.rejectNextCommit());
  await first.getByLabel('浏览器引用批注').fill('shared R2');
  await first.getByRole('button', { name: '保存批注' }).click();
  await first.getByText('批注和新草稿版本已保存', { exact: false }).first().waitFor();
  const recovery = first.locator('section[role="status"]').filter({ hasText: '批注和新草稿版本已保存' });
  const displayed = JSON.parse(await recovery.locator('pre').innerText());
  assert.deepEqual(displayed.owner, owner);
  assert.equal(displayed.draft.text, 'Page A');
  assert.match(displayed.draft.references[0].text, /shared R2/);
  assert.equal(typeof displayed.revision, 'string');
  await first.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; },
  } }));
  await recovery.getByRole('button', { name: '复制已保存版本' }).click();
  assert.deepEqual(JSON.parse(await first.evaluate(() => (window as unknown as { copied: string }).copied)), displayed);
  assert.equal(await first.evaluate(() => window.browserConsumption.canLeave()), false);
  await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.[0]?.text.includes('shared R2'));
  await recovery.getByRole('button', { name: '核对已保存的草稿版本' }).click();
  await first.waitForFunction(() => !window.browserConsumption.dirty());
  const r2 = (await first.evaluate(target => window.browserConsumption.comments(target), owner)).comments;
  const r2Ref = browserReferences(owner, r2)[0]!;
  assert.notDeepEqual(r2Ref, original);

  const confirmed = await second.evaluate(id => window.browserConsumption.confirm(id), intent.id);
  await second.evaluate(value => window.browserConsumption.acknowledge(value), confirmed);
  const marked = await second.evaluate(target => window.browserConsumption.comments(target), owner);
  assert.deepEqual(marked.consumed, [original]);
  assert.deepEqual(marked.consumptionRecords, [{ intentId: intent.id, owner, revision: intent.revision, reference: original }]);
  await second.getByText('已提交').waitFor();
  await second.getByRole('button', { name: '从当前草稿移除' }).click();
  await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.length === 0);
  await second.waitForFunction(() => !window.browserConsumption.dirty());
  let state = await second.evaluate(target => window.browserConsumption.comments(target), owner);
  assert.deepEqual(state.comments, r2);
  assert.deepEqual(state.deleted, []);
  await second.getByRole('button', { name: '添加到草稿' }).click();
  await second.waitForFunction(value => JSON.stringify(window.browserConsumption.snapshot()?.draft.references) === JSON.stringify([value]), r2Ref);
  state = await second.evaluate(target => window.browserConsumption.comments(target), owner);
  assert.deepEqual(state.consumed, [original]);
  assert.deepEqual(state.deleted, []);
  const beforeRemoval = (await second.evaluate(() => window.browserConsumption.snapshot()))!.revision;
  const beforeCalls = await second.evaluate(() => window.browserConsumption.deletionCalls());
  const previousAtom = JSON.stringify(await second.evaluate(() => window.browserConsumption.atom('codex-yard.composer-drafts.v3')));
  await second.evaluate(() => {
    const scope = window as unknown as { draftWrites: string[]; originalPut: typeof IDBObjectStore.prototype.put };
    scope.draftWrites = []; scope.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      const atom = value?.atoms?.['codex-yard.composer-drafts.v3'];
      if (atom) scope.draftWrites.push(JSON.stringify(atom));
      return scope.originalPut.call(this, value, key);
    };
  });
  await second.getByRole('button', { name: '移除引用', exact: true }).click();
  await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.length === 0);
  assert.equal(await second.evaluate(() => window.browserConsumption.settle()), true);
  const afterRemoval = (await second.evaluate(() => window.browserConsumption.snapshot()))!;
  assert.notEqual(afterRemoval.revision, beforeRemoval);
  assert.equal(await second.evaluate(() => window.browserConsumption.deletionCalls()), beforeCalls + 1);
  assert.equal(await second.evaluate(() => window.browserConsumption.deletionReceipt()), null);
  const writes = await second.evaluate(() => {
    const scope = window as unknown as { draftWrites: string[]; originalPut: typeof IDBObjectStore.prototype.put };
    IDBObjectStore.prototype.put = scope.originalPut;
    return scope.draftWrites;
  });
  assert.equal(new Set(writes.filter(value => value !== previousAtom)).size, 1, 'Handled removal commits one draft version');
  const branches = await second.evaluate(target => window.browserConsumption.versions(target), owner);
  assert.equal(branches.versions.filter(version => version.draft.text === 'Page B').length, 1);
  assert.equal(branches.versions.find(version => version.draft.text === 'Page B')?.revision, afterRemoval.revision);
  state = await second.evaluate(target => window.browserConsumption.comments(target), owner);
  assert.deepEqual(state.comments, []);
  assert.deepEqual(state.deleted, [r2Ref]);
}));
