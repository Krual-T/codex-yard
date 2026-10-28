import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('two settings pages use the real browser atom transaction and retain conflicting drafts', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {Preferences} from './src/renderer/settings/preferences.ts';
    import {browserAtom} from './src/renderer/app/browser-atoms.ts';
    import {subscribeBrowserAtoms} from './src/renderer/storage/ui-atoms.ts';
    const fixture = {muted:false};
    const client = {
      rpc: async () => { throw Error('Unexpected RPC'); },
      reply: async () => { throw Error('Unexpected approval'); },
      subscribe: listener => subscribeBrowserAtoms(keys => { if (!fixture.muted) listener({type:'persisted-atoms-changed',keys}); }),
      host: async (endpoint, params = {}) => {
        if (endpoint === 'get-settings') return {values:{}};
        if (endpoint === 'get-global-state') return {exists:false};
        if (endpoint === 'get-persisted-atom' || endpoint === 'set-persisted-atom') return browserAtom(endpoint,params);
        throw Error('Unexpected host operation: ' + endpoint);
      },
    };
    const preferences = new Preferences(client);
    preferences.start();
    window.fixture = Object.assign(fixture,{preferences,browserAtom});
  ` }, bundle: true, write: false, format: 'iife' });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0]!.text : '<!doctype html><script src="/fixture.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map(page => page.goto(origin)));
    await Promise.all(pages.map(page => page.waitForFunction(() => (window as any).fixture?.preferences.getSnapshot()['primary-number-shortcut-target'].available)));
    await pages[0]!.evaluate(async () => (window as any).fixture.browserAtom('set-persisted-atom', { key: 'unknown', value: { keep: true } }));
    await pages[1]!.evaluate(() => { (window as any).fixture.muted = true; });
    await Promise.all(pages.map(page => page.evaluate(() => (window as any).fixture.preferences.edit('primary-number-shortcut-target', 'sidebar'))));
    assert.equal(await pages[0]!.evaluate(() => (window as any).fixture.preferences.saveOne('primary-number-shortcut-target')), true);
    assert.equal(await pages[1]!.evaluate(() => (window as any).fixture.preferences.saveOne('primary-number-shortcut-target')), false);
    const conflict = await pages[1]!.evaluate(() => (window as any).fixture.preferences.getSnapshot()['primary-number-shortcut-target']);
    assert.equal(conflict.conflict, true); assert.equal(conflict.value, 'sidebar');
    assert.deepEqual(conflict.editBase, { exists: false });
    assert.deepEqual(conflict.observation, { exists: true, value: 'sidebar' });
    await pages[1]!.evaluate(() => {
      const fixture = (window as any).fixture;
      fixture.preferences.resolveConflict('primary-number-shortcut-target', 'current');
      fixture.muted = false;
    });
    await Promise.all(pages.map(page => page.evaluate(() => (window as any).fixture.preferences.edit('show-educational-tips', false))));
    assert.equal(await pages[0]!.evaluate(() => (window as any).fixture.preferences.saveOne('show-educational-tips')), true);
    await pages[1]!.waitForFunction(() => (window as any).fixture.preferences.getSnapshot()['show-educational-tips'].conflict);
    const observed = await pages[1]!.evaluate(async () => ({
      state: (window as any).fixture.preferences.getSnapshot()['show-educational-tips'],
      unknown: await (window as any).fixture.browserAtom('get-persisted-atom', { key: 'unknown' }),
    }));
    assert.equal(observed.state.value, false);
    assert.deepEqual(observed.state.editBase, { exists: false });
    assert.deepEqual(observed.unknown, { exists: true, value: { keep: true } });
    await context.close();
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
