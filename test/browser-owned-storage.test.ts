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
import { browserOwnerKey } from '../src/renderer/browser/comments.ts';

test('browser comments import once into transactions and preserve invalid archives', {
  skip: !existsSync('/usr/bin/google-chrome'), timeout: 60_000,
}, async () => {
  const module = await build({ stdin: { resolveDir: process.cwd(), contents: `
    export { addBrowserComment, adoptLegacyBrowserComments } from './test/browser-comment-fixture.ts';
    export { readBrowserComments, readLegacyBrowserComments } from './src/renderer/browser/comments.ts';
    export { readBrowserAtom, updateBrowserAtom } from './src/renderer/storage/ui-atoms.ts';
  ` }, bundle: true, format: 'esm', write: false });
  const ui = await build({ entryPoints: ['test/browser-owned-fixture.tsx'], bundle: true, format: 'iife', write: false, loader: { '.css': 'empty' } });
  const root = await mkdtemp(join(process.env.YARD_TEST_ARTIFACTS ?? tmpdir(), 'browser-comment-storage-'));
  const server = createServer(async (request, response) => {
    if (request.url === '/module.js' || request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(request.url === '/module.js' ? module.outputFiles[0]!.text : ui.outputFiles[0]!.text); return;
    }
    if (request.url === '/host') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const { endpoint } = JSON.parse(Buffer.concat(chunks).toString()) as { endpoint: string };
      const value = endpoint === 'chrome-connections' ? { client: { connected: false }, server: { configured: false } }
        : { configured: false, location: 'Fixture', pages: [] };
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ value })); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'],
  });
  try {
    const local = { hostId: 'local', threadId: 'same-thread', draftId: 'local-draft' };
    const remote = { ...local, hostId: 'ssh-host' };
    const adopted = { ...local, draftId: 'adopted-draft' };
    const localKey = browserOwnerKey(local), remoteKey = browserOwnerKey(remote), adoptedKey = browserOwnerKey(adopted);
    const legacyEntry = { type: 'comment', content: [{ text: 'user edit', extra: true }], unknown: { keep: 1 } };
    const raw = JSON.stringify({ 'legacy-uuid': [legacyEntry, { opaque: true }], [localKey]: [{ local: true }],
      [remoteKey]: [{ remote: true }], unknown: { keep: ['unrecognized'] } }, null, 2) + '\n';
    const first = await context.newPage(); await first.goto(origin);
    await first.evaluate(value => localStorage.setItem('workbench.browser-comments.v1', value), raw);
    const second = await context.newPage(); await second.goto(origin);
    const [localComments, remoteComments] = await Promise.all([first.evaluate(async owner => {
      const path = '/module.js'; return (await import(path)).readBrowserComments(owner);
    }, local), second.evaluate(async owner => {
      const path = '/module.js'; return (await import(path)).readBrowserComments(owner);
    }, remote)]);
    assert.deepEqual(localComments, [{ local: true }]);
    assert.deepEqual(remoteComments, [{ remote: true }]);
    const anchor = { kind: 'element', pageUrl: origin + '/fixture', framePath: [], title: 'new selection', immediateText: 'fixture',
      role: 'button', name: 'fixture', selector: '#fixture', elementPath: '#fixture', nearbyText: 'fixture',
      rect: { x: 1, y: 1, width: 1, height: 1 }, elementMetadata: { tag: 'button' } };
    const imported = await first.evaluate(async ({ local, adopted, anchor }) => {
      const path = '/module.js'; const m = await import(path);
      const bare = await m.readLegacyBrowserComments('legacy-uuid');
      await m.updateBrowserAtom('codex-yard.browser-comments.v1', (previous: Record<string, unknown>) => ({ ...previous, futureField: { keep: true } }));
      await m.addBrowserComment(local, anchor);
      await m.adoptLegacyBrowserComments(adopted, 'legacy-uuid', bare);
      return { bare, store: await m.readBrowserAtom('codex-yard.browser-comments.v1'), archive: localStorage.getItem('workbench.browser-comments.v1') };
    }, { local, adopted, anchor });
    assert.deepEqual(imported.bare, [legacyEntry, { opaque: true }]);
    assert.equal(imported.store.legacyRaw, raw);
    assert.equal(imported.archive, raw);
    assert.equal(imported.store.entries['legacy-uuid'], undefined);
    assert.deepEqual(imported.store.entries[adoptedKey], [legacyEntry, { opaque: true }]);
    assert.deepEqual(imported.store.entries[remoteKey], [{ remote: true }]);
    assert.deepEqual(imported.store.entries.unknown, { keep: ['unrecognized'] });
    assert.deepEqual(imported.store.futureField, { keep: true });
    assert.equal(imported.store.entries[localKey].length, 2);
    const failed = await first.evaluate(async ({ local, anchor }) => {
      const path = '/module.js'; const m = await import(path);
      const before = await m.readBrowserAtom('codex-yard.browser-comments.v1');
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new Error('synthetic transaction failure'); };
      let message = '';
      try { await m.addBrowserComment(local, anchor); } catch (error) { message = (error as Error).message; }
      finally { IDBObjectStore.prototype.put = original; }
      return { message, before, after: await m.readBrowserAtom('codex-yard.browser-comments.v1') };
    }, { local, anchor });
    assert.match(failed.message, /synthetic transaction failure/);
    assert.deepEqual(failed.after, failed.before);
    await first.evaluate(() => localStorage.setItem('workbench.browser-comments.v1', '{later external alteration'));
    assert.deepEqual(await first.evaluate(async owner => {
      const path = '/module.js'; return (await import(path)).readBrowserComments(owner);
    }, remote), [{ remote: true }], 'The archived key is not an authority after import');
    assert.equal((await first.evaluate(async () => {
      const path = '/module.js'; return (await import(path)).readBrowserAtom('codex-yard.browser-comments.v1');
    })).legacyRaw, raw);

    const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
      args: ['--no-sandbox', '--disable-background-networking'] });
    try {
      const collision = await browser.newContext();
      try {
        const page = await collision.newPage(); await page.goto(origin);
        const result = await page.evaluate(async ({ raw, local, anchor }) => {
          localStorage.setItem('workbench.browser-comments.v1', raw);
          const path = '/module.js'; const m = await import(path);
          await m.updateBrowserAtom('codex-yard.browser-comments.v1', () => ({ unrelated: { keep: true } }));
          let message = '';
          try { await m.addBrowserComment(local, anchor); } catch (error) { message = (error as Error).message; }
          return { message, value: await m.readBrowserAtom('codex-yard.browser-comments.v1'),
            archive: localStorage.getItem('workbench.browser-comments.v1') };
        }, { raw, local, anchor });
        assert.match(result.message, /浏览器批注存储格式无法识别/);
        assert.deepEqual(result.value, { unrelated: { keep: true } });
        assert.equal(result.archive, raw);
      } finally { await collision.close(); }
      for (const malformed of ['{bad', 'null', '[]', '"text"']) {
        const isolated = await browser.newContext();
        try {
          const page = await isolated.newPage(); await page.goto(origin);
          await page.evaluate(value => localStorage.setItem('workbench.browser-comments.v1', value), malformed);
          await page.evaluate(owner => window.browserHarness.mount({ ...owner, browserTabId: 'fixture' }), local);
          await page.getByText('旧浏览器批注无法转换，原始数据已保留，未改写。').waitFor();
          await page.getByText('取回旧批注原文').click();
          assert.equal(await page.getByLabel('旧批注原文').inputValue(), malformed);
          await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; },
          } }));
          await page.getByRole('button', { name: '复制旧批注原文' }).click();
          assert.equal(await page.evaluate(() => (window as unknown as { copied: string }).copied), malformed);
          const result = await page.evaluate(async ({ local, anchor }) => {
            const path = '/module.js'; const m = await import(path);
            let readError = '', writeError = '';
            try { await m.readBrowserComments(local); } catch (error) { readError = (error as Error).message; }
            try { await m.addBrowserComment(local, anchor); } catch (error) { writeError = (error as Error).message; }
            return { readError, writeError, store: await m.readBrowserAtom('codex-yard.browser-comments.v1'),
              archive: localStorage.getItem('workbench.browser-comments.v1') };
          }, { local, anchor });
          assert.match(result.readError, /旧浏览器批注无法转换/);
          assert.match(result.writeError, /旧浏览器批注无法转换/);
          assert.equal(result.store.legacyRaw, malformed);
          assert.equal(result.archive, malformed);
          assert.equal(result.store.entries, undefined);
          await page.reload();
          await page.evaluate(owner => window.browserHarness.mount({ ...owner, browserTabId: 'fixture' }), local);
          await page.getByText('旧浏览器批注无法转换，原始数据已保留，未改写。').waitFor();
          await page.getByText('取回旧批注原文').click();
          assert.equal(await page.getByLabel('旧批注原文').inputValue(), malformed);
        } finally { await isolated.close(); }
      }
    } finally { await browser.close(); }
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
