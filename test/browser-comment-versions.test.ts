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
import type { Page } from 'playwright-core';
import { browserOwnerKey } from '../src/renderer/browser/comments.ts';
import type { BrowserOwner } from '../src/renderer/browser/comments.ts';
import type { Fixture } from './browser-consumption-fixture.tsx';

declare global { interface Window { browserConsumption: Fixture } }

test('real composer and browser panel preserve complete comment versions and claim legacy records', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 120_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/browser-consumption-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const root = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'browser-comment-versions-'));
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0]!.text); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  const target: BrowserOwner = { hostId: 'local', threadId: 'thread-a', draftId: 'draft-a' };
  const remote: BrowserOwner = { hostId: 'ssh-test', threadId: 'thread-a', draftId: 'remote-draft' };
  const original = { type: 'comment', origin: 'browser', content: [{ content_type: 'text', text: 'legacy value', future: 1 }],
    position: { side: 'right', path: 'browser:Old', line: 1 },
    localBrowserContext: { pageUrl: 'https://old.invalid/', targetDescription: 'Old', extra: { preserve: true } },
    localBrowserCommentMetadata: { commentId: 'collision', kind: 'element', extra: 2 }, future: { keep: 3 } };
  const saved = { ...original, content: [{ content_type: 'text', text: 'already saved' }] };
  const known = { ...original, content: [{ content_type: 'text', text: 'proven remote' }],
    localBrowserCommentMetadata: { ...original.localBrowserCommentMetadata, commentId: 'proven' } };
  const raced = { ...original, content: [{ content_type: 'text', text: 'one claimant' }],
    localBrowserCommentMetadata: { ...original.localBrowserCommentMetadata, commentId: 'race' } };
  const raw = JSON.stringify({ [browserOwnerKey(target)]: [saved], ambiguous: [original, { future: 'unknown' }],
    proven: [known], racing: [raced], opaque: { unknown: true } }, null, 2) + '\n';
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--process-per-tab'],
  });
  const errors: string[] = [];
  const observe = (page: Page) => page.on('pageerror', error => errors.push(error.message));
  const mount = async (page: Page, owner: BrowserOwner) => {
    await page.evaluate(value => window.browserConsumption.mount(value), owner);
    await page.waitForFunction(value => {
      const snapshot = window.browserConsumption.snapshot();
      return snapshot?.owner.hostId === value.hostId && snapshot.owner.threadId === value.threadId && snapshot.owner.draftId === value.draftId;
    }, owner);
    await page.waitForFunction(async value => {
      const snapshot = window.browserConsumption.snapshot();
      const versions = await window.browserConsumption.versions(value);
      return !!snapshot && versions.versions.some(version => version.revision === snapshot.revision);
    }, owner);
  };
  const waitDurable = (page: Page) => page.waitForFunction(async () => {
    const snapshot = window.browserConsumption.snapshot();
    return !!snapshot && (await window.browserConsumption.versions(snapshot.owner)).versions.some(item => item.revision === snapshot.revision);
  });
  try {
    await context.addInitScript(value => {
      if (location.hostname === '127.0.0.1' && !localStorage.getItem('workbench.browser-comments.v1')) localStorage.setItem('workbench.browser-comments.v1', value);
    }, raw);
    const first = await context.newPage(); observe(first); await first.goto(origin + '/first'); await mount(first, target);
    await first.getByText('待认领的旧浏览器批注').click();
    await first.getByText('核对目标中的同 ID 批注').click();
    assert.match(await first.locator('section[aria-label="浏览器引用"]').innerText(), /legacy value/);
    assert.match(await first.locator('section[aria-label="浏览器引用"]').innerText(), /already saved/);
    await first.getByRole('button', { name: '保留两份并认领到当前草稿' }).click();
    await first.waitForFunction(async owner => (await window.browserConsumption.comments(owner)).comments.length === 2, target);
    const claimed = await first.evaluate(owner => window.browserConsumption.comments(owner), target);
    const values = claimed.comments as typeof original[];
    assert.notEqual(values[0]!.localBrowserCommentMetadata.commentId, values[1]!.localBrowserCommentMetadata.commentId);
    assert.deepEqual(values[1]!.future, { keep: 3 });
    assert.deepEqual(values[1]!.localBrowserContext.extra, { preserve: true });
    assert.equal(values[1]!.content[0]!.future, 1);
    let stored = await first.evaluate(() => window.browserConsumption.atom('codex-yard.browser-comments.v1')) as Record<string, unknown>;
    assert.equal(stored.legacyRaw, raw);
    assert.deepEqual((stored.entries as Record<string, unknown>).ambiguous, [{ future: 'unknown' }]);
    assert.deepEqual((stored.entries as Record<string, unknown>).proven, [known], 'A bare identity is not assigned by matching the current route');
    assert.deepEqual((stored.entries as Record<string, unknown>).opaque, { unknown: true });
    assert.equal(await first.evaluate(() => localStorage.getItem('workbench.browser-comments.v1')), raw);
    await first.getByLabel('浏览器引用批注').nth(1).fill('edited claimed value');
    await first.getByRole('button', { name: '保存批注' }).nth(1).click();
    await first.waitForFunction(async owner => JSON.stringify((await window.browserConsumption.comments(owner)).comments).includes('edited claimed value'), target);
    await first.getByRole('button', { name: '添加到草稿' }).nth(1).click();
    await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.some(ref => ref.text.includes('edited claimed value')));
    await first.reload(); await mount(first, target);
    assert.ok((await first.evaluate(() => window.browserConsumption.input())).some(part => String(part.text).includes('edited claimed value')));
    await first.evaluate(({ owner }) => window.browserConsumption.setLegacyEvidence('proven', owner), { owner: remote });
    await mount(first, remote);
    await first.waitForFunction(async owner => (await window.browserConsumption.comments(owner)).comments.length === 1, remote);
    assert.deepEqual((await first.evaluate(owner => window.browserConsumption.comments(owner), remote)).comments, [known]);
    stored = await first.evaluate(() => window.browserConsumption.atom('codex-yard.browser-comments.v1')) as Record<string, unknown>;
    assert.deepEqual((stored.entries as Record<string, unknown>).ambiguous, [{ future: 'unknown' }]);
    assert.equal((stored.entries as Record<string, unknown>).proven, undefined);
    assert.equal(stored.legacyRaw, raw);

    const owner = { hostId: 'local', threadId: 'version-thread', draftId: 'version-draft' };
    await mount(first, owner);
    const reference = await first.evaluate(value => window.browserConsumption.addComment(value), owner);
    await first.getByRole('button', { name: '添加到草稿' }).click();
    await first.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(ref => ref.id === id), reference.id);
    await waitDurable(first);
    const second = await context.newPage(); observe(second); await second.goto(origin + '/second'); await mount(second, owner);
    await second.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(ref => ref.id === id), reference.id);
    await second.evaluate(() => window.browserConsumption.showBrowser(false));
    const internals = await context.newPage(); await internals.goto('chrome://process-internals/#web-contents');
    await internals.waitForFunction(() => {
      const visit = (root: ParentNode): boolean => [...root.querySelectorAll('*')].some(element => element.shadowRoot !== null
        && (element.shadowRoot.textContent?.includes('/first') || visit(element.shadowRoot)));
      return visit(document);
    });
    const processes = await internals.evaluate(() => {
      const result: number[] = [];
      const visit = (root: ParentNode) => { for (const element of root.querySelectorAll('*')) if (element.shadowRoot) {
        const match = element.shadowRoot.textContent?.match(/Frame\[(\d+):\d+\][^\n]*\| url: ([^\s]+)/);
        if (match && (match[2]!.endsWith('/first') || match[2]!.endsWith('/second'))) result.push(Number(match[1]));
        visit(element.shadowRoot);
      } };
      visit(document); return result;
    });
    assert.equal(processes.length, 2); assert.notEqual(processes[0], processes[1]); await internals.close();
    const raceOwners = [{ hostId: 'local', threadId: 'race', draftId: 'race-local' },
      { hostId: 'ssh-test', threadId: 'race', draftId: 'race-remote' }];
    const race = await Promise.all([first, second].map((page, index) => page.evaluate(async ({ owner, expected }) => {
      try { await window.browserConsumption.claim(owner, 'racing', expected, 0, false); return 'claimed'; }
      catch (error) { return (error as Error).message; }
    }, { owner: raceOwners[index]!, expected: [raced] })));
    assert.equal(race.filter(value => value === 'claimed').length, 1);
    assert.match(race.find(value => value !== 'claimed')!, /旧批注已变化/);
    const raceContents = await Promise.all(raceOwners.map(value => first.evaluate(item => window.browserConsumption.comments(item), value)));
    assert.equal(raceContents.reduce((count, item) => count + item.comments.length, 0), 1);
    assert.equal((await first.evaluate(() => window.browserConsumption.atom('codex-yard.browser-comments.v1')) as Record<string, unknown>).legacyRaw, raw);
    const locker = await context.newPage(); await locker.goto(origin + '/locker');
    await locker.evaluate(async () => {
      const scope = window as unknown as { lockReady: boolean; unlock(): void };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('atoms', 'readwrite'), store = tx.objectStore('atoms'); let held = true;
      scope.unlock = () => { held = false; };
      tx.oncomplete = () => db.close();
      const keep = () => { if (held) { const request = store.get('native-atoms'); request.onsuccess = () => { scope.lockReady = true; keep(); }; } };
      keep();
    });
    await locker.waitForFunction(() => (window as unknown as { lockReady: boolean }).lockReady);
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Page A');
    await second.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Page B');
    await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.text === 'Page A');
    await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.text === 'Page B');
    await locker.evaluate(() => (window as unknown as { unlock(): void }).unlock());
    await waitDurable(first); await waitDurable(second);
    assert.equal((await first.evaluate(value => window.browserConsumption.versions(value), owner)).versions.length, 2);
    await locker.close();
    for (const text of ['R2 from A', 'R3 from A']) {
      await first.getByLabel('浏览器引用批注').fill(text);
      await first.getByRole('button', { name: '保存批注' }).click();
      await first.waitForFunction(async ({ owner, text }) => JSON.stringify((await window.browserConsumption.comments(owner)).comments).includes(text), { owner, text });
      await first.getByText('批注和新草稿版本已保存', { exact: false }).waitFor();
      const choices = first.getByText('选择草稿版本').locator('..');
      if (!await choices.evaluate(element => (element as HTMLDetailsElement).open)) await first.getByText('选择草稿版本').click();
      await first.getByRole('button', { name: 'Page A', exact: true }).click();
      await first.waitForFunction(value => window.browserConsumption.snapshot()?.draft.references?.[0]?.text.includes(value), text);
    }
    await second.evaluate(() => window.browserConsumption.showBrowser(true));
    await second.getByText('草稿中的引用与已保存批注不同', { exact: false }).waitFor();
    assert.equal(await second.getByLabel('浏览器引用批注').inputValue(), 'Chrome 中所选元素');
    assert.equal(await second.getByRole('button', { name: '保存批注' }).isDisabled(), true);
    assert.equal(await second.getByRole('button', { name: '删除引用' }).isDisabled(), true);
    await second.getByText('核对批注版本').click();
    const comparison = await second.locator('section[aria-label="浏览器引用"]').innerText();
    assert.match(comparison, /Chrome 中所选元素/); assert.match(comparison, /R3 from A/);
    const stale = await second.evaluate(async ({ owner, original }) => {
      try { await window.browserConsumption.change(owner, original, 'must not overwrite', window.browserConsumption.snapshot()!); return ''; }
      catch (error) { return (error as Error).message; }
    }, { owner, original: reference.original });
    assert.match(stale, /其他页面修改/);
    const wrongReference = await second.evaluate(async ({ owner, reference }) => {
      try { await window.browserConsumption.removeReference(owner, { ...reference, text: 'different clicked reference' }, window.browserConsumption.snapshot()!); return ''; }
      catch (error) { return (error as Error).message; }
    }, { owner, reference });
    assert.match(wrongReference, /所选浏览器引用或草稿版本已改变/);
    const wrongOwner = await second.evaluate(async ({ owner, original }) => {
      try { await window.browserConsumption.change({ ...owner, hostId: 'other' }, original, null, window.browserConsumption.snapshot()!); return ''; }
      catch (error) { return (error as Error).message; }
    }, { owner, original: reference.original });
    assert.match(wrongOwner, /身份已改变/);
    const input = await second.evaluate(() => window.browserConsumption.input());
    assert.match(JSON.stringify(input), /Chrome 中所选元素/); assert.doesNotMatch(JSON.stringify(input), /R3 from A/);
    const frozen = await second.evaluate(() => window.browserConsumption.prepare());
    assert.deepEqual(frozen.draft.references?.[0], reference);
    await first.getByRole('button', { name: '删除引用' }).click();
    await first.waitForFunction(async value => (await window.browserConsumption.comments(value)).comments.length === 0, owner);
    assert.deepEqual((await second.evaluate(() => window.browserConsumption.recovery())).requests[frozen.id]?.draft.references?.[0], reference);
    assert.deepEqual((await second.evaluate(() => window.browserConsumption.snapshot()))?.draft.references?.[0], reference);

    const failure = { hostId: 'local', threadId: 'failure-thread', draftId: 'failure-draft' };
    await mount(first, failure); await first.evaluate(value => window.browserConsumption.addComment(value), failure);
    await first.getByRole('button', { name: '添加到草稿' }).click();
    await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.length === 1);
    const before = await first.evaluate(async () => ({ comments: await window.browserConsumption.atom('codex-yard.browser-comments.v1'),
      drafts: await window.browserConsumption.atom('codex-yard.composer-drafts.v3') }));
    await first.evaluate(() => {
      const prototype = IDBObjectStore.prototype as IDBObjectStore & { savedPut?: typeof IDBObjectStore.prototype.put };
      prototype.savedPut = prototype.put; prototype.put = function () { throw new Error('fixture atomic failure'); };
    });
    await first.getByLabel('浏览器引用批注').fill('retained unsaved text');
    await first.getByRole('button', { name: '保存批注' }).click();
    await first.getByText('fixture atomic failure').waitFor();
    assert.equal(await first.getByLabel('浏览器引用批注').inputValue(), 'retained unsaved text');
    await first.evaluate(() => {
      const prototype = IDBObjectStore.prototype as IDBObjectStore & { savedPut?: typeof IDBObjectStore.prototype.put };
      prototype.put = prototype.savedPut!; delete prototype.savedPut;
    });
    const after = await first.evaluate(async () => ({ comments: await window.browserConsumption.atom('codex-yard.browser-comments.v1'),
      drafts: await window.browserConsumption.atom('codex-yard.composer-drafts.v3') }));
    assert.deepEqual(after, before);
    await first.getByRole('button', { name: '保存批注' }).click();
    await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.[0]?.text.includes('retained unsaved text'));
    const removed = await first.evaluate(owner => {
      const snapshot = window.browserConsumption.snapshot()!;
      return window.browserConsumption.removeReference(owner, snapshot.draft.references![0] as import('../src/renderer/browser/comments.ts').BrowserReference, snapshot);
    }, failure);
    assert.equal(removed.draft.references?.length, 0);
    assert.equal((await first.evaluate(value => window.browserConsumption.comments(value), failure)).comments.length, 0);
    const malformedOwner = { hostId: 'local', threadId: 'malformed', draftId: 'malformed' };
    await mount(first, malformedOwner);
    const knownReference = await first.evaluate(value => window.browserConsumption.addComment(value), malformedOwner);
    await first.evaluate(reference => window.browserConsumption.injectReference({ id: reference.id, text: 'unrecognized draft version', kind: 'browser' }), knownReference);
    await first.getByText('草稿中相同 ID 的引用无法安全核对', { exact: false }).waitFor();
    await first.getByText('核对草稿和已保存引用').click();
    assert.match(await first.locator('section[aria-label="浏览器引用"]').innerText(), /unrecognized draft version/);
    assert.equal(await first.getByRole('button', { name: '添加到草稿' }).count(), 0);
    assert.equal((await first.evaluate(() => window.browserConsumption.snapshot()))?.draft.references?.[0]?.text, 'unrecognized draft version');
    assert.deepEqual(errors, []);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
