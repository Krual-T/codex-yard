import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type {} from './renderer-browser-preferences-fixture.tsx';

test('the mounted browser consumes saved address preference without losing URL, history or references', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-browser-preferences-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const origin = 'https://fixture.invalid';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--no-proxy-server'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0]!.text });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><div id="root"></div><script src="/fixture.js"></script>' });
      return route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const owner = { hostId: 'local', threadId: 'fixture', draftId: 'draft-a', browserTabId: 'tab-a' };
    const legacyRaw = '{ "unresolved": [{"unknown": "retain"}] }';
    await page.evaluate(({ owner, legacyRaw }) => {
      localStorage.setItem('workbench.browser-comments.v1', legacyRaw);
      window.browserPreferenceFixture.mount(owner);
    }, { owner, legacyRaw });
    const input = page.getByLabel('网页地址');
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'example.invalid');
    let draftReady = false;
    for (let attempt = 0; attempt < 200 && !draftReady; attempt++) {
      draftReady = await page.evaluate(() => window.browserPreferenceFixture.ready());
      if (!draftReady) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(draftReady, true, 'The composer has a durable initial version before attaching a reference');
    await input.focus();
    assert.equal(await input.inputValue(), 'https://www.example.invalid/path?q=1#frag');
    await input.fill('https://other.invalid/a?x=2#new');
    assert.equal(await page.evaluate(() => window.browserPreferenceFixture.save('browser-show-full-url', true)), true);
    assert.equal(await input.inputValue(), 'https://other.invalid/a?x=2#new', 'A setting update does not replace the in-progress edit');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => window.browserPreferenceFixture.calls().some(call =>
      (call.command as { type?: string; url?: string })?.url === 'https://other.invalid/a?x=2#new'));
    await page.locator('header strong').click();
    assert.equal(await input.inputValue(), 'https://other.invalid/a?x=2#new');
    assert.equal(await page.evaluate(() => window.browserPreferenceFixture.save('browser-show-full-url', false)), true);
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'other.invalid');
    await input.focus(); await input.fill('http://localhost:43125/a?q=3#local');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.locator('header strong').click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'localhost:43125/a?q=3#local');
    await input.focus();
    assert.equal(await input.inputValue(), 'http://localhost:43125/a?q=3#local');
    await page.getByRole('button', { name: '后退' }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'other.invalid');
    await page.getByRole('button', { name: '前进' }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'localhost:43125/a?q=3#local');

    await page.getByRole('button', { name: '引用所选元素' }).click();
    await page.waitForFunction(() => (window.browserPreferenceFixture.draft().references?.length ?? 0) === 1);
    await page.evaluate(() => window.browserPreferenceFixture.recordConsumed());
    const consumption = await page.evaluate(async () =>
      (await window.browserPreferenceFixture.store() as Record<string, unknown>)['codex-yard.browser-consumption.v1']);
    assert.ok(consumption && typeof consumption === 'object');
    assert.equal(Object.values(consumption as Record<string, { intentId: string }[]>).flat()[0]?.intentId, 'fixture-intent');
    assert.equal(await page.evaluate(() => window.browserPreferenceFixture.save('browser-annotation-screenshots-mode', 'necessary')), true);
    await page.getByRole('button', { name: '引用所选元素' }).click();
    await page.waitForFunction(() => (window.browserPreferenceFixture.draft().references?.length ?? 0) === 2);
    const beforeReload = await page.evaluate(async () => ({ draft: window.browserPreferenceFixture.draft(), store: await window.browserPreferenceFixture.store() }));
    assert.equal((beforeReload.store as { legacyRaw: string }).legacyRaw, legacyRaw);
    assert.deepEqual((beforeReload.store as Record<string, unknown>)['codex-yard.browser-consumption.v1'], consumption);
    for (const reference of beforeReload.draft.references ?? []) {
      const original = reference.original as { localBrowserContext: { elementMetadata: unknown } };
      assert.deepEqual(original.localBrowserContext.elementMetadata, { fixture: 'preserve' });
      assert.equal(Object.hasOwn(original, 'screenshot'), false, 'The preview frame is not invented as an annotation screenshot');
    }
    assert.equal(await page.evaluate(() => window.browserPreferenceFixture.save('browser-show-full-url', true)), true);
    await page.reload();
    await page.evaluate(owner => window.browserPreferenceFixture.mount(owner), owner);
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'https://www.example.invalid/path?q=1#frag');
    await page.waitForFunction(() => (window.browserPreferenceFixture.draft().references?.length ?? 0) === 2);
    const afterReload = await page.evaluate(async () => ({ draft: window.browserPreferenceFixture.draft(), store: await window.browserPreferenceFixture.store() }));
    assert.deepEqual(afterReload.draft.references, beforeReload.draft.references);
    assert.equal((afterReload.store as { legacyRaw: string }).legacyRaw, legacyRaw);
    assert.deepEqual((afterReload.store as Record<string, unknown>)['codex-yard.browser-consumption.v1'], consumption);

    await page.evaluate(owner => { window.browserPreferenceFixture.holdNext(); window.browserPreferenceFixture.mount({ ...owner, hostId: 'old-host' }); }, owner);
    await page.waitForFunction(() => window.browserPreferenceFixture.pending());
    await page.evaluate(owner => {
      window.browserPreferenceFixture.setRaw('browser-show-full-url', false);
      window.browserPreferenceFixture.mount({ ...owner, hostId: 'new-host' });
    }, owner);
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'example.invalid');
    await page.evaluate(() => window.browserPreferenceFixture.release());
    await page.waitForFunction(() => !window.browserPreferenceFixture.pending());
    assert.equal(await input.inputValue(), 'example.invalid', 'The old host read cannot change the new panel');
    await page.evaluate(() => {
      window.browserPreferenceFixture.holdNext();
      window.browserPreferenceFixture.setRaw('browser-show-full-url', true, true);
    });
    await page.waitForFunction(() => window.browserPreferenceFixture.pending());
    await page.evaluate(() => window.browserPreferenceFixture.setRaw('browser-show-full-url', false, true));
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'example.invalid');
    await page.evaluate(() => window.browserPreferenceFixture.release());
    await page.waitForFunction(() => !window.browserPreferenceFixture.pending());
    assert.equal(await input.inputValue(), 'example.invalid', 'A superseded read cannot restore an older value');
    await page.evaluate(() => window.browserPreferenceFixture.setRaw('browser-show-full-url', { unknown: 'keep' }, true));
    await page.waitForFunction(() => (document.querySelector('[aria-label="网页地址"]') as HTMLInputElement)?.value === 'https://www.example.invalid/path?q=1#frag');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('fixture.browser-settings')!)['browser-show-full-url']), { unknown: 'keep' });
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
