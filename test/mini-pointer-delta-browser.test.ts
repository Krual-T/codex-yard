import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('a departed Mini initialization cannot overwrite the new Mini target', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/mini-workspace-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:32148'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://127.0.0.1:32148/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: 'Quick chat', exact: true }).waitFor();
    await page.evaluate(async () => {
      const f = (window as any).miniWorkspaceFixture;
      await f.leaveMini(); f.holdTargetResolution(); f.mountMini();
    });
    await page.waitForFunction(() => (window as any).miniWorkspaceFixture.targetResolutionWaiting());
    await page.evaluate(async () => { const f = (window as any).miniWorkspaceFixture; await f.leaveMini(); f.mountMini(); });
    await page.getByRole('button', { name: 'Quick chat', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.locator('.yard-mini-conversation textarea').first().waitFor();
    await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
    await page.getByRole('button', { name: 'Follow remote' }).click();
    await page.waitForFunction(() => JSON.parse((window as any).miniWorkspaceFixture.pointer()).threadId === 'thread-b');
    await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
    const input = page.locator('.yard-mini-conversation textarea').first();
    await input.fill('new target draft');
    const pointer = await page.evaluate(() => JSON.parse((window as any).miniWorkspaceFixture.pointer()));
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !await page.evaluate(async value =>
      (await (window as any).miniWorkspaceFixture.miniDraft(value))?.draft.text === 'new target draft', pointer)) {
      await page.waitForTimeout(30);
    }
    assert.equal(await page.evaluate(async value => (await (window as any).miniWorkspaceFixture.miniDraft(value))?.draft.text, pointer), 'new target draft');
    await page.evaluate(() => (window as any).miniWorkspaceFixture.releaseTargetResolution());
    assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.targetResolutionWaiting()), false);
    assert.deepEqual(await page.evaluate(() => JSON.parse((window as any).miniWorkspaceFixture.pointer())), pointer);
    assert.equal(await input.inputValue(), 'new target draft');
    assert.equal(await page.evaluate(async value => (await (window as any).miniWorkspaceFixture.miniDraft(value))?.draft.text, pointer), 'new target draft');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
