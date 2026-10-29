import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    editAuthorityHarness: {
      ready(): boolean;
      saved(): Promise<{ recovery: { editor: { sessionId: string; revision: number; edits: { text: string }[] } }; submission?: { stage: string; operationId: string } } | null>;
      owner(name: 'one' | 'two'): boolean;
      revoke(name: 'one' | 'two'): void;
      failNextSave(): void;
      holdNextSubmit(): void;
      waiting(): boolean;
      targetValid(value: boolean): void;
      releaseGate(): void;
      hostCalls(): number;
      freeze(name: 'one' | 'two'): { sessionId: string; revision: number };
      flush(name: 'one' | 'two'): Promise<void>;
      handoff(name: 'one' | 'two'): void;
      release(name: 'one' | 'two'): void;
      capture(name: 'one' | 'two'): void;
      capturedValid(): boolean;
    };
  }
}

const chromePath = '/usr/bin/google-chrome', require = createRequire(import.meta.url);
test('two real message views share one saved edit and transfer authority only after a durable flush', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-message-edit-authority-fixture.ts'], bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:18949/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:18949/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => window.editAuthorityHarness.ready());
    const one = page.locator('[data-view="one"]'), two = page.locator('[data-view="two"]');
    const first = one.getByRole('textbox', { name: 'Edit message text' });
    await first.waitFor();
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('one')), true);
    assert.equal(await two.getByRole('textbox', { name: 'Edit message text' }).count(), 0);
    assert.equal(await two.getByRole('button', { name: 'Edit message' }).isDisabled(), true);
    await first.fill('first draft');
    await page.waitForFunction(async () => (await window.editAuthorityHarness.saved())?.recovery.editor.edits[0]?.text === 'first draft');
    await page.evaluate(() => { window.editAuthorityHarness.capture('one'); window.editAuthorityHarness.freeze('one'); });
    await assert.rejects(page.evaluate(() => window.editAuthorityHarness.handoff('one')), /must be saved/);
    await page.evaluate(() => window.editAuthorityHarness.failNextSave());
    await assert.rejects(page.evaluate(() => window.editAuthorityHarness.flush('one')), /fixture IDB failure/);
    await assert.rejects(page.evaluate(() => window.editAuthorityHarness.handoff('one')), /must be saved/);
    assert.equal(await first.inputValue(), 'first draft');
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('one')), true);
    assert.equal(await two.getByRole('textbox', { name: 'Edit message text' }).count(), 0);
    await page.evaluate(() => window.editAuthorityHarness.release('one'));
    await first.fill('latest before handoff');
    const version = await page.evaluate(() => window.editAuthorityHarness.freeze('one'));
    await page.evaluate(async () => { await window.editAuthorityHarness.flush('one'); window.editAuthorityHarness.handoff('one'); });
    const second = two.getByRole('textbox', { name: 'Edit message text' });
    await second.waitFor();
    assert.equal(await second.inputValue(), 'latest before handoff');
    assert.equal(await first.count(), 0);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.capturedValid()), false);
    await second.fill('second view edit');
    await page.waitForFunction(async () => (await window.editAuthorityHarness.saved())?.recovery.editor.edits[0]?.text === 'second view edit');
    const saved = await page.evaluate(() => window.editAuthorityHarness.saved());
    assert.equal(saved?.recovery.editor.sessionId, 'shared-session');
    assert.ok(saved!.recovery.editor.revision > version.revision);
    await page.evaluate(async () => {
      window.editAuthorityHarness.freeze('two');
      await window.editAuthorityHarness.flush('two');
      window.editAuthorityHarness.handoff('two');
    });
    await first.waitFor();
    assert.equal(await first.inputValue(), 'second view edit');
    assert.equal(await second.count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('real message editor checks its captured target after IDB preparation and preserves dispatched uncertainty', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-message-edit-authority-fixture.ts'], bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:18949/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:18949/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const one = page.locator('[data-view="one"]');
    const input = one.getByRole('textbox', { name: 'Edit message text' });
    await input.waitFor();
    await input.fill('retain this draft');
    await page.waitForFunction(async () => (await window.editAuthorityHarness.saved())?.recovery.editor.edits[0]?.text === 'retain this draft');
    await page.evaluate(() => window.editAuthorityHarness.holdNextSubmit());
    await one.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    const pending = await page.evaluate(() => window.editAuthorityHarness.saved());
    assert.equal(pending?.submission?.stage, 'revertUnknown');
    await assert.rejects(page.evaluate(() => window.editAuthorityHarness.freeze('one')), /Wait for the current message edit/);
    await page.evaluate(() => { window.editAuthorityHarness.targetValid(false); window.editAuthorityHarness.releaseGate(); });
    await one.getByRole('alert').filter({ hasText: 'fixture target changed before dispatch' }).waitFor();
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.hostCalls()), 0);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.submission, undefined);
    assert.equal(await input.inputValue(), 'retain this draft');
    await page.evaluate(() => window.editAuthorityHarness.targetValid(true));
    await one.getByRole('button', { name: 'Send', exact: true }).click();
    await one.getByRole('alert').filter({ hasText: 'fixture connection lost after dispatch' }).waitFor();
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.hostCalls()), 1);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.submission?.stage, 'revertUnknown');
    assert.equal(await input.inputValue(), 'retain this draft');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('starting before a recovery prop arrives reads the existing IDB draft before opening an editor', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-message-edit-authority-fixture.ts'], bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:18949/?unread=1'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    await page.goto('http://127.0.0.1:18949/?unread=1');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => window.editAuthorityHarness.ready());
    const one = page.locator('[data-view="one"]'), two = page.locator('[data-view="two"]');
    await one.getByRole('button', { name: 'Edit message' }).click();
    const input = one.getByRole('textbox', { name: 'Edit message text' });
    await input.waitFor();
    assert.equal(await input.inputValue(), 'original');
    await input.fill('saved session retained');
    await page.waitForFunction(async () => (await window.editAuthorityHarness.saved())?.recovery.editor.edits[0]?.text === 'saved session retained');
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.recovery.editor.sessionId, 'shared-session');
    assert.equal(await two.getByRole('textbox', { name: 'Edit message text' }).count(), 0);
    assert.equal(await two.getByRole('button', { name: 'Edit message' }).isDisabled(), true);
  } finally { await browser.close(); }
});

test('revoking captured authority during IDB preparation prevents the old editor from dispatching', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-message-edit-authority-fixture.ts'], bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:18949/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    await page.goto('http://127.0.0.1:18949/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const one = page.locator('[data-view="one"]'), two = page.locator('[data-view="two"]');
    const input = one.getByRole('textbox', { name: 'Edit message text' });
    await input.waitFor();
    await input.fill('draft before revoked authority');
    await page.waitForFunction(async () => (await window.editAuthorityHarness.saved())?.recovery.editor.edits[0]?.text === 'draft before revoked authority');
    await page.evaluate(() => window.editAuthorityHarness.holdNextSubmit());
    await one.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    await page.evaluate(() => window.editAuthorityHarness.revoke('one'));
    const other = two.getByRole('textbox', { name: 'Edit message text' });
    await other.waitFor();
    await page.evaluate(() => window.editAuthorityHarness.releaseGate());
    await page.waitForFunction(async () => (await window.editAuthorityHarness.saved())?.submission === undefined);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.hostCalls()), 0);
    assert.equal(await other.inputValue(), 'draft before revoked authority');
    assert.equal(await input.count(), 0);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), true);
  } finally { await browser.close(); }
});

test('a failed IDB recovery write keeps the original pending record and the visible draft', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-message-edit-authority-fixture.ts'], bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:18949/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    await page.goto('http://127.0.0.1:18949/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const one = page.locator('[data-view="one"]'), input = one.getByRole('textbox', { name: 'Edit message text' });
    await input.waitFor();
    await input.fill('preserve this edit');
    await page.waitForFunction(async () => (await window.editAuthorityHarness.saved())?.recovery.editor.edits[0]?.text === 'preserve this edit');
    await page.evaluate(() => window.editAuthorityHarness.holdNextSubmit());
    await one.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    const operationId = (await page.evaluate(() => window.editAuthorityHarness.saved()))?.submission?.operationId;
    await page.evaluate(() => {
      window.editAuthorityHarness.targetValid(false);
      window.editAuthorityHarness.failNextSave();
      window.editAuthorityHarness.releaseGate();
    });
    await one.getByRole('alert').filter({ hasText: '恢复阶段未能写回' }).waitFor();
    const saved = await page.evaluate(() => window.editAuthorityHarness.saved());
    assert.equal(saved?.submission?.operationId, operationId);
    assert.equal(saved?.submission?.stage, 'revertUnknown');
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.hostCalls()), 0);
    assert.equal(await input.inputValue(), 'preserve this edit');
  } finally { await browser.close(); }
});
