import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';

const chromePath = '/usr/bin/google-chrome', require = createRequire(import.meta.url);
async function fixture() {
  const bundle = await build({ entryPoints: ['test/renderer-message-edit-authority-fixture.ts'], bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  const open = async (url = 'http://127.0.0.1:18949/'): Promise<Page> => {
    const page = await context.newPage();
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:18949/')
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    await page.goto(url);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => window.editAuthorityHarness.ready());
    return page;
  };
  return { browser, context, open };
}
const options = { skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000 };
const view = (page: Page, name: 'one' | 'two') => page.locator(`[data-view="${name}"]`);
const editor = (page: Page, name: 'one' | 'two') => view(page, name).getByRole('textbox', { name: 'Edit message text' });
async function savedText(page: Page, text: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for the saved message edit: ${text}`)), 8_000);
  });
  try {
    for (;;) {
      const saved = await Promise.race([page.evaluate(() => window.editAuthorityHarness.saved()), timeout]);
      if (saved?.recovery.editor.edits[0]?.text === text) return;
      await Promise.race([page.waitForTimeout(30), timeout]);
    }
  } finally { clearTimeout(timer); }
}

test('the parent captures connection and authority before the first recovery save waits', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open(), input = editor(page, 'one');
    await input.waitFor();
    await input.fill('captured original click');
    await savedText(page, 'captured original click');
    await page.evaluate(() => window.editAuthorityHarness.holdNextPrepare());
    await view(page, 'one').getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.parentCalls()), 1);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.submission, undefined);
    await page.evaluate(() => { window.editAuthorityHarness.changeConnection(); window.editAuthorityHarness.changeConnection(); window.editAuthorityHarness.releaseGate(); });
    await view(page, 'one').getByRole('alert').filter({ hasText: 'fixture connection changed before dispatch' }).waitFor();
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.hostCalls()), 0);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.submission, undefined);
    assert.equal(await input.inputValue(), 'captured original click');

    await page.evaluate(() => window.editAuthorityHarness.holdNextPrepare());
    await view(page, 'one').getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    await page.evaluate(() => {
      window.editAuthorityHarness.revoke('one');
      if (!window.editAuthorityHarness.acquire('one')) throw new Error('Could not grant a new generation.');
      window.editAuthorityHarness.releaseGate();
    });
    await view(page, 'one').getByRole('alert').filter({ hasText: '使用权已改变' }).waitFor();
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.hostCalls()), 0);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.submission, undefined);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('one')), true);
    assert.equal(await input.inputValue(), 'captured original click');
  } finally { await h.browser.close(); }
});

test('leaving during an IDB read cancels only that acquisition, including after retry', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open('http://127.0.0.1:18949/?unread=1');
    await page.evaluate(() => window.editAuthorityHarness.holdNextRead());
    await view(page, 'one').getByRole('button', { name: 'Edit message' }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.readWaiting());
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.freeze('one')), null);
    await assert.rejects(page.evaluate(() => window.editAuthorityHarness.freeze('one')), /already frozen/);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('one')), false);
    await page.evaluate(async () => { await window.editAuthorityHarness.flush('one'); window.editAuthorityHarness.release('one'); });
    const input = editor(page, 'one');
    await input.waitFor();
    assert.equal(await input.inputValue(), 'original');
    await page.evaluate(() => window.editAuthorityHarness.releaseRead());
    await page.waitForFunction(() => !window.editAuthorityHarness.readWaiting());
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('one')), true);
    await input.fill('new acquisition remains');
    await savedText(page, 'new acquisition remains');

    await page.evaluate(async () => {
      window.editAuthorityHarness.freeze('one'); await window.editAuthorityHarness.flush('one'); window.editAuthorityHarness.handoff('one');
      window.editAuthorityHarness.holdNextRead();
    });
    await view(page, 'two').getByRole('button', { name: 'Edit message' }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.readWaiting());
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.freeze('two')), null);
    await page.evaluate(async () => { await window.editAuthorityHarness.flush('two'); window.editAuthorityHarness.show('two', false); });
    await view(page, 'two').waitFor({ state: 'detached' });
    await page.evaluate(() => { window.editAuthorityHarness.handoff('two'); window.editAuthorityHarness.releaseRead(); });
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), false);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.recovery.editor.edits[0]?.text, 'new acquisition remains');
  } finally { await h.browser.close(); }
});

test('a flushed lease can hand off after unmount, while cancellation and stale leases preserve ownership', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open(), input = editor(page, 'one');
    await input.waitFor();
    await input.fill('durable handoff');
    await savedText(page, 'durable handoff');
    await page.evaluate(async () => { window.editAuthorityHarness.freeze('one'); await window.editAuthorityHarness.flush('one'); window.editAuthorityHarness.show('one', false); });
    await view(page, 'one').waitFor({ state: 'detached' });
    await page.evaluate(() => window.editAuthorityHarness.handoff('one'));
    const second = editor(page, 'two');
    await second.waitFor();
    assert.equal(await second.inputValue(), 'durable handoff');
    await page.evaluate(async () => { window.editAuthorityHarness.freeze('two'); await window.editAuthorityHarness.flush('two'); window.editAuthorityHarness.show('two', false); });
    await view(page, 'two').waitFor({ state: 'detached' });
    await page.evaluate(() => window.editAuthorityHarness.release('two'));
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), true);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.recovery.editor.edits[0]?.text, 'durable handoff');
    await page.evaluate(() => window.editAuthorityHarness.show('two', true));
    await second.waitFor();
    assert.equal(await second.inputValue(), 'durable handoff');
    await page.evaluate(async () => { window.editAuthorityHarness.freeze('two'); await window.editAuthorityHarness.flush('two'); window.editAuthorityHarness.show('two', false); });
    await view(page, 'two').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.acquire('two')), true);
    await assert.rejects(page.evaluate(() => window.editAuthorityHarness.handoff('two')), /使用权已改变/);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), true);
  } finally { await h.browser.close(); }
});

test('a late cancel receipt cannot release a later grant to the same view', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open(), input = editor(page, 'one');
    await input.waitFor();
    await page.evaluate(() => window.editAuthorityHarness.holdNextWrite());
    await view(page, 'one').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    await page.evaluate(() => {
      window.editAuthorityHarness.revoke('one');
      if (!window.editAuthorityHarness.acquire('one')) throw new Error('Could not grant a new generation.');
      window.editAuthorityHarness.releaseGate();
    });
    await page.waitForFunction(() => window.editAuthorityHarness.completedClears() === 1);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('one')), true);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.hostCalls()), 0);
  } finally { await h.browser.close(); }
});

test('a late cancel receipt does not reset the baseline of a newly accepted edit', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open('http://127.0.0.1:18949/?unread=1');
    await view(page, 'one').getByRole('button', { name: 'Edit message' }).click();
    await editor(page, 'one').waitFor();
    await page.evaluate(() => window.editAuthorityHarness.holdNextWrite());
    await view(page, 'one').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    await page.evaluate(() => window.editAuthorityHarness.revoke('one'));
    await view(page, 'two').getByRole('button', { name: 'Edit message' }).click();
    const input = editor(page, 'two');
    await input.waitFor();
    await input.fill('new edit before old receipt');
    await savedText(page, 'new edit before old receipt');
    await page.waitForFunction(() => window.editAuthorityHarness.writtenText() === 'new edit before old receipt');
    assert.deepEqual(await view(page, 'two').getByRole('alert').allTextContents(), []);
    await page.evaluate(() => window.editAuthorityHarness.releaseGate());
    await page.waitForFunction(() => window.editAuthorityHarness.completedClears() === 1);
    await input.fill('new edit after old receipt');
    await savedText(page, 'new edit after old receipt');
    await page.waitForFunction(() => window.editAuthorityHarness.writtenText() === 'new edit after old receipt');
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), true);
    assert.deepEqual(await view(page, 'two').getByRole('alert').allTextContents(), []);
  } finally { await h.browser.close(); }
});

test('an old cancel waiting for its IDB transaction cannot use a later acquisition baseline', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open('http://127.0.0.1:18949/?unread=1');
    await view(page, 'one').getByRole('button', { name: 'Edit message' }).click();
    await editor(page, 'one').waitFor();
    await page.evaluate(() => window.editAuthorityHarness.holdBeforeWrite());
    await view(page, 'one').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => window.editAuthorityHarness.beforeWriteWaiting());
    await page.evaluate(() => window.editAuthorityHarness.revoke('one'));
    await view(page, 'two').getByRole('button', { name: 'Edit message' }).click();
    const input = editor(page, 'two');
    await input.waitFor();
    await page.evaluate(() => window.editAuthorityHarness.releaseBeforeWrite());
    await page.waitForFunction(() => window.editAuthorityHarness.lastWriteError().includes('消息编辑使用权已改变'));
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.recovery.editor.sessionId, 'shared-session');
    await input.fill('new owner keeps recovery');
    await savedText(page, 'new owner keeps recovery');
    await page.waitForFunction(() => window.editAuthorityHarness.writtenText() === 'new owner keeps recovery');
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), true);
  } finally { await h.browser.close(); }
});

test('an empty mounted message view blocks late recovery until its navigation lease is released', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open('http://127.0.0.1:18949/?unread=1');
    await page.evaluate(() => window.editAuthorityHarness.show('two', false));
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.freeze('one')), null);
    await page.evaluate(() => window.editAuthorityHarness.restore());
    assert.equal(await editor(page, 'one').count(), 0);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('one')), false);
    await page.evaluate(() => window.editAuthorityHarness.release('one'));
    await editor(page, 'one').waitFor();
    assert.equal(await editor(page, 'one').inputValue(), 'original');
    await page.evaluate(async () => {
      window.editAuthorityHarness.freeze('one');
      await window.editAuthorityHarness.flush('one');
      window.editAuthorityHarness.handoff('one');
      window.editAuthorityHarness.show('one', false);
      window.editAuthorityHarness.show('two', true);
    });
    await editor(page, 'two').waitFor();
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), true);
  } finally { await h.browser.close(); }
});

test('a cancel queued behind an older write receipt cannot delete a newly accepted edit', options, async () => {
  const h = await fixture();
  try {
    const page = await h.open('http://127.0.0.1:18949/?unread=1');
    await view(page, 'one').getByRole('button', { name: 'Edit message' }).click();
    await editor(page, 'one').waitFor();
    await page.evaluate(() => window.editAuthorityHarness.holdNextWrite());
    await editor(page, 'one').fill('queued replacement');
    await page.waitForFunction(() => window.editAuthorityHarness.waiting());
    await view(page, 'one').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.editAuthorityHarness.revoke('one'));
    await view(page, 'two').getByRole('button', { name: 'Edit message' }).click();
    await editor(page, 'two').waitFor();
    assert.equal(await editor(page, 'two').inputValue(), 'queued replacement');
    await page.evaluate(() => window.editAuthorityHarness.releaseGate());
    await page.waitForFunction(() => window.editAuthorityHarness.authorityFailures() >= 2);
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.completedClears()), 0);
    assert.equal((await page.evaluate(() => window.editAuthorityHarness.saved()))?.recovery.editor.edits[0]?.text, 'queued replacement');
    assert.equal(await page.evaluate(() => window.editAuthorityHarness.owner('two')), true);
  } finally { await h.browser.close(); }
});

test('two pages accept a newly acquired IDB draft without allowing concurrent overwrite', options, async () => {
  const h = await fixture();
  try {
    const a = await h.open(), b = await h.open('http://127.0.0.1:18949/?unread=1');
    const aInput = editor(a, 'one'), bInput = editor(b, 'one');
    await aInput.waitFor();
    await a.evaluate(() => window.editAuthorityHarness.show('two', false));
    await view(a, 'two').waitFor({ state: 'detached' });
    await aInput.fill('page A first');
    await savedText(a, 'page A first');
    await a.evaluate(async () => { window.editAuthorityHarness.freeze('one'); await window.editAuthorityHarness.flush('one'); window.editAuthorityHarness.handoff('one'); });
    await view(b, 'one').getByRole('button', { name: 'Edit message' }).click();
    await bInput.waitFor();
    assert.equal(await bInput.inputValue(), 'page A first');
    await bInput.fill('page B accepted');
    await savedText(b, 'page B accepted');
    await b.evaluate(async () => { window.editAuthorityHarness.freeze('one'); await window.editAuthorityHarness.flush('one'); window.editAuthorityHarness.handoff('one'); });
    await view(a, 'one').getByRole('button', { name: 'Edit message' }).click();
    await aInput.waitFor();
    assert.equal(await aInput.inputValue(), 'page B accepted');
    await aInput.fill('page A accepted');
    await savedText(a, 'page A accepted');

    await view(b, 'one').getByRole('button', { name: 'Edit message' }).click();
    await bInput.waitFor();
    assert.equal(await bInput.inputValue(), 'page A accepted');
    await aInput.fill('page A concurrent');
    await savedText(a, 'page A concurrent');
    assert.equal((await b.evaluate(() => window.editAuthorityHarness.saved()))?.recovery.editor.edits[0]?.text, 'page A concurrent');
    await bInput.fill('page B concurrent');
    await view(b, 'one').getByRole('alert').filter({ hasText: '另一页面已更改此编辑' }).waitFor();
    assert.equal(await bInput.inputValue(), 'page B concurrent');
    assert.equal((await a.evaluate(() => window.editAuthorityHarness.saved()))?.recovery.editor.edits[0]?.text, 'page A concurrent');
  } finally { await h.browser.close(); }
});
