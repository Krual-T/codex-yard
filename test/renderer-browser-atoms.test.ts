import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('transactional atom import, concurrent writes, rollback and malformed data survive fresh renderers', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable',
}, async () => {
  const built = await build({ stdin: { contents: `export { browserAtom } from './src/renderer/app/browser-atoms.ts';
    export { readBrowserAtoms, subscribeBrowserAtoms, updateBrowserAtoms } from './src/renderer/storage/ui-atoms.ts';`, resolveDir: process.cwd() },
    bundle: true, format: 'esm', write: false });
  const root = await mkdtemp('/tmp/yard-atoms-test-');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/atoms.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/atoms.js' ? built.outputFiles[0]!.text : '<!doctype html><title>Storage regression</title>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const context = await chromium.launchPersistentContext(join(root, 'browser'), {
    executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
  });
  try {
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await pages[0]!.goto(origin);
    const legacy = JSON.stringify({ unknown: { retain: true }, records: {}, invalid: null });
    await pages[0]!.evaluate(legacy => localStorage.setItem('native-atoms', legacy), legacy);
    await pages[1]!.goto(origin);
    await Promise.all(pages.map(page => page.evaluate(async () => {
      const modulePath = '/atoms.js';
      const { subscribeBrowserAtoms } = await import(modulePath);
      (window as any).atomEvents = [];
      (window as any).unsubscribeAtoms = subscribeBrowserAtoms((keys: string[]) => (window as any).atomEvents.push(keys));
    })));
    for (let round = 0; round < 10; round++) {
      await Promise.all(pages.map((page, writer) => page.evaluate(async ({ round, writer }) => {
        // Runtime import of the actual browser module served by this fixture.
        const modulePath = '/atoms.js';
        const { browserAtom } = await import(modulePath);
        for (let index = 0; index < 20; index++) await browserAtom('set-persisted-atom', {
          key: 'records', recordUpdate: { entries: { [`${round}:${writer}:${index}`]: { value: index } } },
        });
      }, { round, writer })));
      const values = await Promise.all(pages.map(page => page.evaluate(async () => {
        const modulePath = '/atoms.js'; return (await import(modulePath)).readBrowserAtoms();
      })));
      for (const value of values) {
        assert.equal(Object.keys(value.records).length, (round + 1) * 40);
        assert.deepEqual(value.unknown, { retain: true });
      }
    }
    const fresh = await context.newPage(); await fresh.goto(origin);
    assert.equal(await fresh.evaluate(async () => {
      const modulePath = '/atoms.js'; return Object.keys((await (await import(modulePath)).readBrowserAtoms()).records).length;
    }), 400);
    for (const page of pages) {
      assert.equal(await page.evaluate(() => localStorage.getItem('native-atoms')), legacy, 'The imported source stays untouched.');
      await page.waitForFunction(() => (window as any).atomEvents.length >= 400);
    }
    for (const malformed of [null, [], 'text', 2]) {
      const unchanged = await fresh.evaluate(async malformed => {
        const modulePath = '/atoms.js';
        const { browserAtom, readBrowserAtoms } = await import(modulePath);
        await browserAtom('set-persisted-atom', { key: 'invalid', value: malformed });
        const before = JSON.stringify(await readBrowserAtoms());
        let rejected = false;
        try { await browserAtom('set-persisted-atom', { key: 'invalid', recordUpdate: { entries: { unsafe: { value: true } } } }); }
        catch { rejected = true; }
        return rejected && before === JSON.stringify(await readBrowserAtoms());
      }, malformed);
      assert(unchanged, 'Malformed record updates retain the original root.');
    }
    const aborted = await fresh.evaluate(async () => {
      const modulePath = '/atoms.js'; const { browserAtom, readBrowserAtoms } = await import(modulePath);
      const before = JSON.stringify(await readBrowserAtoms()), original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const request = original.apply(this, args); this.transaction.abort(); return request;
      };
      let rejected = false;
      try { await browserAtom('set-persisted-atom', { key: 'records', recordUpdate: { entries: { aborted: { value: true } } } }); }
      catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = original; }
      return rejected && before === JSON.stringify(await readBrowserAtoms());
    });
    assert(aborted, 'An aborted write must reject and preserve committed data.');
    const batch = await fresh.evaluate(async () => {
      const modulePath = '/atoms.js'; const { readBrowserAtoms, updateBrowserAtoms } = await import(modulePath);
      await updateBrowserAtoms(() => ({ value: null, updates: { fileA: { revision: 'A' }, fileB: { revision: 'B' } } }));
      const before = JSON.stringify(await readBrowserAtoms());
      let rejected = false;
      try {
        await updateBrowserAtoms((atoms: Record<string, any>) => {
          const updates: Record<string, unknown> = {};
          if (atoms.fileA.revision === 'A') updates.fileA = null;
          if (atoms.fileB.revision !== 'stale') throw new Error('The other file has a newer owner.');
          updates.fileB = null;
          return { value: null, updates };
        });
      } catch { rejected = true; }
      const unchanged = rejected && before === JSON.stringify(await readBrowserAtoms());
      const result = await updateBrowserAtoms((atoms: Record<string, any>) => {
        if (atoms.fileA.revision !== 'A' || atoms.fileB.revision !== 'B') throw new Error('Unexpected revision');
        return { value: 'discarded-together', updates: { fileA: null, fileB: null } };
      });
      const after = await readBrowserAtoms();
      return { unchanged, result, fileA: after.fileA, fileB: after.fileB, records: Object.keys(after.records).length, unknown: after.unknown };
    });
    assert.deepEqual(batch, { unchanged: true, result: 'discarded-together', fileA: null, fileB: null, records: 400, unknown: { retain: true } });
    await fresh.evaluate(() => localStorage.setItem('native-atoms', '{later legacy corruption'));
    assert.equal(await fresh.evaluate(async () => {
      const modulePath = '/atoms.js'; return Object.keys((await (await import(modulePath)).readBrowserAtoms()).records).length;
    }), 400, 'Legacy storage is not a second authority after import.');

    // Each separate origin has its own first-import transaction.
    for (const raw of ['{invalid JSON', 'null', '[]', '"text"']) {
      const isolated = await chromium.launchPersistentContext(join(root, 'malformed-' + crypto.randomUUID()), {
        executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
      });
      try {
        const target = await isolated.newPage(); await target.goto(origin);
        const kept = await target.evaluate(async raw => {
          localStorage.setItem('native-atoms', raw);
          const modulePath = '/atoms.js'; const { browserAtom } = await import(modulePath);
          let rejected = false;
          try { await browserAtom('set-persisted-atom', { key: 'unrelated', value: true }); } catch { rejected = true; }
          const stored = await new Promise<any>((resolve, reject) => {
            const opening = indexedDB.open('codex-yard.ui-atoms.v1', 1);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
              const db = opening.result, tx = db.transaction('atoms'), read = tx.objectStore('atoms').get('native-atoms');
              read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close();
            };
          });
          return rejected && stored.legacyRaw === raw && typeof stored.importError === 'string'
            && stored.atoms === undefined && localStorage.getItem('native-atoms') === raw;
        }, raw);
        assert(kept, 'An unconvertible legacy root retains its exact bytes and cannot be edited.');
      } finally { await isolated.close(); }
    }
  } finally {
    await context.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
