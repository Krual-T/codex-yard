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

async function waitForBrowser(check: () => Promise<unknown>) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for the asynchronous browser condition.');
}

declare global { interface Window { browserConsumption: Fixture } }

test('confirmed browser references consume only the submitted version across pages and recovery', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 120_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/browser-consumption-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const root = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'browser-consumption-'));
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0]!.text); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server has no address');
  const origin = `http://127.0.0.1:${address.port}`;
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
      return snapshot?.owner.hostId === value.hostId && snapshot.owner.threadId === value.threadId
        && snapshot.owner.draftId === value.draftId;
    }, owner);
  };
  const addReference = async (page: Page, owner: BrowserOwner) => {
    const reference = await page.evaluate(value => window.browserConsumption.addComment(value), owner);
    await page.getByRole('button', { name: '添加到草稿' }).click();
    await page.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(item => item.id === id), reference.id);
    return reference;
  };
  const durable = async (page: Page) => {
    await waitForBrowser(() => page.evaluate(async () => {
      const snapshot = window.browserConsumption.snapshot();
      if (!snapshot) return false;
      const versions = await window.browserConsumption.versions(snapshot.owner);
      return versions.versions.some(value => value.revision === snapshot.revision);
    }));
  };
  const initial = { hostId: 'local', threadId: 'thread-a', draftId: 'draft-a' };
  try {
    const first = await context.newPage(); observe(first); await first.goto(origin + '/first'); await mount(first, initial);
    const reference = await addReference(first, initial);
    const remote = { ...initial, hostId: 'ssh-fixture' };
    await first.evaluate(({ owner, comment }) => window.browserConsumption.seedComment(owner, comment), { owner: remote, comment: reference.original });
    await first.evaluate(() => window.browserConsumption.preserveUnknown());
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Original A');
    const intent = await first.evaluate(() => window.browserConsumption.prepare());
    assert.equal(intent.draft.references?.[0]?.id, reference.id);

    const second = await context.newPage(); observe(second); await second.goto(origin + '/second'); await mount(second, initial);
    const internals = await context.newPage(); await internals.goto('chrome://process-internals/#web-contents');
    await internals.waitForFunction(() => {
      const contains = (root: ParentNode): boolean => [...root.querySelectorAll('*')].some(element => element.shadowRoot !== null
        && (element.shadowRoot.textContent?.includes('/first') || contains(element.shadowRoot)));
      return contains(document);
    });
    const frames = await internals.evaluate(() => {
      const result: { process: number; url: string }[] = [];
      const visit = (root: ParentNode) => {
        for (const element of root.querySelectorAll('*')) if (element.shadowRoot) {
          const match = element.shadowRoot.textContent?.match(/Frame\[(\d+):\d+\][^\n]*\| url: ([^\s]+)/);
          if (match && (match[2]!.endsWith('/first') || match[2]!.endsWith('/second'))) result.push({ process: Number(match[1]), url: match[2]! });
          visit(element.shadowRoot);
        }
      };
      visit(document); return result;
    });
    assert.equal(frames.length, 2);
    assert.notEqual(frames[0]!.process, frames[1]!.process, 'The two pages use distinct Chrome renderers');
    await internals.close();
    await second.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(item => item.id === id), reference.id);
    await second.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Newer B');
    await durable(second);
    const newer = await second.evaluate(() => window.browserConsumption.snapshot());
    assert.notEqual(newer?.revision, intent.revision);
    await second.getByLabel('浏览器引用批注').fill('B has an unsaved comment');

    await mount(first, { hostId: 'ssh-other', threadId: 'thread-other', draftId: 'other-draft' });
    await first.evaluate(id => window.browserConsumption.confirm(id), intent.id);
    await first.evaluate(id => window.browserConsumption.finish(id), intent.id);
    const remoteState = await first.evaluate(value => window.browserConsumption.comments(value), remote);
    assert.deepEqual(remoteState.comments, [reference.original]);
    assert.equal(remoteState.consumed.length, 0);
    await second.getByText('已提交').waitFor();
    assert.equal(await second.getByLabel('浏览器引用批注').inputValue(), 'B has an unsaved comment');
    assert.equal((await second.evaluate(() => window.browserConsumption.snapshot()))?.draft.references?.[0]?.id, reference.id);
    assert.equal((await second.evaluate(value => window.browserConsumption.versions(value), initial)).retained.length, 0);
    await second.getByRole('button', { name: '保存批注' }).click();
    await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.[0]?.text.includes('B has an unsaved comment'));
    await durable(second);
    await second.reload(); await mount(second, initial);
    await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.[0]?.text.includes('B has an unsaved comment'));
    assert.equal(await second.getByLabel('浏览器引用批注').inputValue(), 'B has an unsaved comment');
    await second.getByRole('button', { name: '删除引用' }).click();
    await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.length === 0);
    assert.equal((await second.evaluate(value => window.browserConsumption.comments(value), initial)).comments.length, 0);

    const changedOwner = { hostId: 'local', threadId: 'thread-changed', draftId: 'changed' };
    await mount(first, changedOwner); await addReference(first, changedOwner);
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Before comment edit');
    const beforeEdit = await first.evaluate(() => window.browserConsumption.prepare());
    await mount(second, changedOwner);
    await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.length === 1);
    await second.getByLabel('浏览器引用批注').fill('Changed before confirmation');
    await second.getByRole('button', { name: '保存批注' }).click();
    await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.references?.[0]?.text.includes('Changed before confirmation'));
    await durable(second);
    await first.evaluate(id => window.browserConsumption.confirm(id), beforeEdit.id);
    await first.evaluate(id => window.browserConsumption.finish(id), beforeEdit.id);
    const changedState = await second.evaluate(value => window.browserConsumption.comments(value), changedOwner);
    assert.deepEqual(changedState.consumed, [beforeEdit.draft.references![0]], 'The confirmed original is recorded even after the shared comment changed');
    assert.notDeepEqual(changedState.consumed[0]?.original, changedState.comments[0], 'The edited comment is not marked as the original');
    assert.match((await second.evaluate(() => window.browserConsumption.snapshot()))!.draft.references![0]!.text, /Changed before confirmation/);
    const beforeDelete = await second.evaluate(() => window.browserConsumption.prepare());
    await first.waitForFunction(revision => window.browserConsumption.snapshot()?.revision === revision, beforeDelete.revision);
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
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Independent A after submit');
    await second.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Newer C after submit');
    await first.waitForFunction(() => window.browserConsumption.snapshot()?.draft.text === 'Independent A after submit');
    await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.text === 'Newer C after submit');
    await locker.evaluate(() => (window as unknown as { unlock(): void }).unlock());
    await durable(first); await durable(second); await locker.close();
    assert.equal((await second.evaluate(value => window.browserConsumption.versions(value), changedOwner)).versions.length, 2);
    const newerC = (await second.evaluate(() => window.browserConsumption.snapshot()))!.revision;
    await mount(second, { hostId: 'ssh-other', threadId: 'elsewhere', draftId: 'elsewhere' });
    await first.getByRole('button', { name: '删除引用' }).click();
    await waitForBrowser(() => first.evaluate(async value => (await window.browserConsumption.comments(value)).comments.length === 0, changedOwner));
    await second.evaluate(id => window.browserConsumption.confirm(id), beforeDelete.id);
    await second.evaluate(id => window.browserConsumption.finish(id), beforeDelete.id);
    assert.equal((await second.evaluate(value => window.browserConsumption.comments(value), changedOwner)).comments.length, 0);
    const blocked = await second.evaluate(async ({ owner, revision }) => {
      try { await window.browserConsumption.reserveVersion(owner, revision); return ''; }
      catch (error) { return (error as Error).message; }
    }, { owner: changedOwner, revision: newerC });
    assert.match(blocked, /浏览器引用已在其他页面删除/);
    assert.deepEqual((await second.evaluate(() => window.browserConsumption.recovery())).requests, {},
      'The actual prepare transaction rejects a stale deleted reference without reserving a send');
    await second.evaluate(() => window.browserConsumption.showBrowser(false));
    await mount(second, changedOwner);
    const chooseNewer = async (requirePruned = false) => {
      await second.waitForFunction(requireNoReferences => {
        const selected = window.browserConsumption.snapshot();
        if (selected?.draft.text === 'Newer C after submit' && (!requireNoReferences || selected.draft.references?.length === 0)) return true;
        const choices = [...document.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent === '选择草稿版本');
        const target = choices && [...choices.querySelectorAll('button')].find(item => item.textContent === 'Newer C after submit');
        if (!choices || !target) return false;
        choices.open = true; target.click(); return true;
      }, requirePruned);
    };
    if ((await second.evaluate(() => window.browserConsumption.snapshot()))?.draft.text !== 'Newer C after submit') await chooseNewer();
    await waitForBrowser(() => second.evaluate(async owner => (await window.browserConsumption.versions(owner)).versions.some(value =>
      value.draft.text === 'Newer C after submit' && value.draft.references?.length === 0), changedOwner));
    if ((await second.evaluate(() => window.browserConsumption.snapshot()))?.draft.references?.length !== 0) {
      await chooseNewer(true);
    }
    try {
      await second.waitForFunction(() => window.browserConsumption.snapshot()?.draft.text === 'Newer C after submit'
        && window.browserConsumption.snapshot()?.draft.references?.length === 0, undefined, { timeout: 8_000 });
    } catch (error) {
      console.error('Detached explicit delete:', JSON.stringify(await second.evaluate(async owner => ({
        snapshot: window.browserConsumption.snapshot(), versions: await window.browserConsumption.versions(owner),
        comments: await window.browserConsumption.comments(owner),
      }), changedOwner)));
      throw error;
    }
    await second.evaluate(() => window.browserConsumption.showBrowser(true));

    const detached = { hostId: 'local', threadId: 'thread-detached', draftId: 'detached' };
    await mount(first, detached); const detachedReference = await addReference(first, detached);
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Detached A');
    const detachedIntent = await first.evaluate(() => window.browserConsumption.prepare());
    await mount(first, { hostId: 'local', threadId: 'elsewhere', draftId: 'elsewhere' });
    await first.evaluate(id => window.browserConsumption.confirm(id), detachedIntent.id);
    await first.evaluate(id => window.browserConsumption.finish(id), detachedIntent.id);
    await mount(first, detached);
    await first.getByText('已提交').waitFor();
    assert.equal((await first.evaluate(() => window.browserConsumption.snapshot()))?.draft.references?.length, 0);
    assert.equal((await first.evaluate(value => window.browserConsumption.comments(value), detached)).consumed[0]?.id, detachedReference.id);
    await first.reload(); await mount(first, detached);
    await first.getByText('已提交').waitFor();
    assert.equal((await first.evaluate(() => window.browserConsumption.snapshot()))?.draft.references?.length, 0);
    await first.getByRole('button', { name: '添加到草稿' }).click();
    await first.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(item => item.id === id), detachedReference.id);

    const failureOwner = { hostId: 'ssh-fixture', threadId: 'thread-failure', draftId: 'failure' };
    await mount(first, failureOwner); await addReference(first, failureOwner);
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Retry A');
    const failure = await first.evaluate(() => window.browserConsumption.prepare());
    const confirmed = await first.evaluate(id => window.browserConsumption.confirm(id), failure.id);
    const forged = { ...confirmed, revision: 'another-revision' };
    const rejected = await first.evaluate(async value => {
      try { await window.browserConsumption.acknowledge(value); return ''; }
      catch (error) { return (error as Error).message; }
    }, forged);
    assert.match(rejected, /原发送或草稿版本尚未确认/);
    for (const failAt of [1, 2]) {
      const result = await first.evaluate(async ({ id, failAt }) => {
        const original = IDBObjectStore.prototype.put; let writes = 0, message = '';
        IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
          if (this.name === 'atoms' && ++writes === failAt) throw new Error('fixture write failure ' + failAt);
          return original.apply(this, args);
        };
        try { await window.browserConsumption.finish(id); } catch (error) { message = (error as Error).message; }
        finally { IDBObjectStore.prototype.put = original; }
        return { message, writes, state: await window.browserConsumption.recovery() };
      }, { id: failure.id, failAt });
      assert.match(result.message, /fixture write failure/);
      assert.equal(result.state.requests[failure.id]?.stage, 'confirmed');
      assert.equal(result.state.requests[failure.id]?.revision, failure.revision);
      assert.equal((await first.evaluate(value => window.browserConsumption.versions(value), failureOwner)).retained.length, 1);
    }
    assert.equal(await first.evaluate(() => window.browserConsumption.attempts()), 1);
    await first.reload(); await mount(first, failureOwner);
    assert.equal((await first.evaluate(() => window.browserConsumption.recovery())).requests[failure.id]?.stage, 'confirmed');
    await first.evaluate(id => window.browserConsumption.finish(id), failure.id);
    assert.equal((await first.evaluate(() => window.browserConsumption.recovery())).requests[failure.id], undefined);
    assert.equal(await first.evaluate(() => window.browserConsumption.attempts()), 0, 'Recovery did not send again');
    const stored = await first.evaluate(() => window.browserConsumption.atom('codex-yard.browser-comments.v1')) as Record<string, unknown>;
    assert.deepEqual(stored.futureField, { preserved: true });
    assert.deepEqual((stored.entries as Record<string, unknown>)['legacy-unknown'], [{ future: 1 }]);

    const home = { hostId: 'local', threadId: null, draftId: 'home-bound' };
    await mount(first, home); const homeReference = await addReference(first, home);
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Home A');
    const homeIntent = await first.evaluate(() => window.browserConsumption.prepare('created-thread'));
    await mount(first, { ...home, threadId: 'created-thread' });
    await first.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(item => item.id === id), homeReference.id);
    await first.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('Bound B'); await durable(first);
    await second.evaluate(id => window.browserConsumption.confirm(id), homeIntent.id);
    await second.evaluate(id => window.browserConsumption.finish(id), homeIntent.id);
    await first.waitForFunction(id => window.browserConsumption.snapshot()?.draft.references?.some(item => item.id === id), homeReference.id);
    const homeState = await first.evaluate(value => window.browserConsumption.comments(value), home);
    assert.equal(homeState.consumed[0]?.id, homeReference.id);
    assert.equal((await first.evaluate(() => window.browserConsumption.snapshot()))?.draft.text, 'Bound B');
    const boundIntent = await first.evaluate(() => window.browserConsumption.prepare());
    assert.equal(boundIntent.owner.threadId, 'created-thread');
    await second.evaluate(id => window.browserConsumption.confirm(id), boundIntent.id);
    await second.evaluate(id => window.browserConsumption.finish(id), boundIntent.id);
    const homeStore = await first.evaluate(() => window.browserConsumption.atom('codex-yard.browser-comments.v1')) as Record<string, unknown>;
    const markers = (homeStore['codex-yard.browser-consumption.v1'] as Record<string, { owner: BrowserOwner; revision: string }[]>)[browserOwnerKey(home)]!;
    assert.ok(markers.some(value => value.owner.threadId === 'created-thread' && value.revision === boundIntent.revision));
    assert.deepEqual(errors, []);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
