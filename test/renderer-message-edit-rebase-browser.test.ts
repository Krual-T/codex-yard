import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    editRebaseHarness: {
      calls: Record<string, unknown>[];
      commits(): number;
      checks(): number;
      saved(): { recovery: { origin: { turnId: string; itemId: string }; editor: { revision: number; edits: { text: string }[] } }; submission?: { stage: string } } | null;
      entered(): boolean;
      refresh(): void;
      hideSource(): void;
      hide(): void;
      show(): void;
      host(value: string): void;
      thread(value: string): void;
      hold(): void;
      release(): void;
      alterHistory(kind: 'new-user' | 'new-turn' | 'running' | 'attachment' | 'restore'): void;
      leave(): Promise<void>;
    };
  }
}

const require = createRequire(import.meta.url), chromePath = '/usr/bin/google-chrome';
test('real inline editor explicitly rebases a preserved draft after confirming A', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-message-edit-rebase-fixture.ts'], bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url() === 'https://edit-rebase.invalid/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://edit-rebase.invalid/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const original = page.locator('[data-message-id="user-original"]');
    await original.getByRole('button', { name: 'Edit message' }).click();
    await original.getByRole('textbox', { name: 'Edit message text' }).fill('A @item');
    await original.getByRole('button', { name: 'Send', exact: true }).click();
    try { await original.getByText('Synthetic response lost after A started').waitFor(); }
    catch (error) {
      throw new Error(`Synthetic editor state: ${await original.innerText()}; operations: ${await page.evaluate(() => window.editRebaseHarness.calls.map(call => call.operation).join(','))}; page errors: ${errors.join('; ')}`, { cause: error });
    }
    await original.getByRole('textbox', { name: 'Edit message text' }).fill('B @item');
    await page.waitForFunction(() => window.editRebaseHarness.saved()?.recovery.editor.edits[0]?.text === 'B @item');
    await original.getByRole('button', { name: 'Send', exact: true }).click();
    await original.getByText('较早版本已发送', { exact: false }).waitFor();
    await page.evaluate(() => window.editRebaseHarness.refresh());
    await page.evaluate(() => window.editRebaseHarness.hide());
    await page.locator('.yard-messages-root').waitFor({ state: 'detached' });
    await page.evaluate(() => window.editRebaseHarness.show());
    assert.equal(await original.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'B @item');
    const rebase = original.getByRole('button', { name: 'Continue editing from the sent message' });
    await rebase.waitFor();
    assert.equal(await original.getByRole('button', { name: 'Send', exact: true }).isEnabled(), false);

    await page.evaluate(() => window.editRebaseHarness.hold());
    await rebase.click();
    await page.waitForFunction(() => window.editRebaseHarness.entered());
    await original.getByRole('textbox', { name: 'Edit message text' }).fill('C @item');
    await page.waitForFunction(() => window.editRebaseHarness.saved()?.recovery.editor.edits[0]?.text === 'C @item');
    await page.evaluate(() => window.editRebaseHarness.release());
    await original.getByText('The draft changed while checking.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.editRebaseHarness.checks()), 1);
    assert.equal(await page.evaluate(() => window.editRebaseHarness.commits()), 0);

    await page.evaluate(() => window.editRebaseHarness.hold());
    await rebase.click();
    await page.waitForFunction(() => window.editRebaseHarness.entered());
    await original.getByRole('button', { name: 'Cancel check' }).click();
    await page.evaluate(() => window.editRebaseHarness.release());
    await page.waitForFunction(() => window.editRebaseHarness.checks() === 2);
    assert.equal(await original.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'C @item');
    assert.equal(await page.evaluate(() => window.editRebaseHarness.commits()), 0);

    await page.evaluate(() => window.editRebaseHarness.hold());
    await rebase.click();
    await page.waitForFunction(() => window.editRebaseHarness.entered());
    await page.evaluate(() => window.editRebaseHarness.host('host-b'));
    await page.locator('[data-message-id="user-a"]').getByRole('button', { name: 'Edit message' }).waitFor();
    await page.evaluate(() => window.editRebaseHarness.host('host-a'));
    assert.equal(await original.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'C @item');
    await page.evaluate(() => window.editRebaseHarness.release());
    await page.waitForFunction(() => window.editRebaseHarness.checks() === 3);
    assert.equal(await page.evaluate(() => window.editRebaseHarness.commits()), 0);

    await page.evaluate(() => window.editRebaseHarness.hold());
    await rebase.click();
    await page.waitForFunction(() => window.editRebaseHarness.entered());
    await page.evaluate(() => window.editRebaseHarness.thread('thread-b'));
    await page.locator('[data-message-id="user-a"]').getByRole('button', { name: 'Edit message' }).waitFor();
    await page.evaluate(() => window.editRebaseHarness.thread('thread-a'));
    assert.equal(await original.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'C @item');
    await page.evaluate(() => window.editRebaseHarness.release());
    await page.waitForFunction(() => window.editRebaseHarness.checks() === 4);
    assert.equal(await page.evaluate(() => window.editRebaseHarness.commits()), 0);

    await page.evaluate(() => window.editRebaseHarness.hold());
    await rebase.click();
    await page.waitForFunction(() => window.editRebaseHarness.entered());
    await page.evaluate(() => window.editRebaseHarness.leave());
    await page.locator('.yard-messages-root').waitFor({ state: 'detached' });
    await page.evaluate(() => { window.editRebaseHarness.release(); window.editRebaseHarness.show(); });
    await page.waitForFunction(() => window.editRebaseHarness.checks() === 5);
    assert.equal(await original.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'C @item');
    assert.equal(await page.evaluate(() => window.editRebaseHarness.commits()), 0);

    for (const [kind, expected] of [
      ['new-user', '原发送消息不是最新的已完成可编辑消息'],
      ['new-turn', '原发送消息不是最新的已完成可编辑消息'],
      ['running', '会话状态或完整历史无法确认'],
      ['attachment', '原发送消息的输入、附件或格式与请求不一致'],
    ] as const) {
      await page.evaluate(value => window.editRebaseHarness.alterHistory(value), kind);
      await rebase.click();
      await original.getByRole('alert').filter({ hasText: expected }).waitFor();
      assert.equal(await original.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'C @item', kind);
      assert.deepEqual(await page.evaluate(() => window.editRebaseHarness.calls.map(call => call.operation)), ['submit', 'check'], kind);
      assert.equal(await page.evaluate(() => window.editRebaseHarness.commits()), 0, kind);
      await page.evaluate(() => window.editRebaseHarness.alterHistory('restore'));
    }

    await original.getByRole('button', { name: 'Continue editing from the sent message' }).click();
    const sent = page.locator('[data-message-id="user-a"]');
    assert.equal(await sent.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'C @item');
    assert.deepEqual(await page.evaluate(() => window.editRebaseHarness.calls.map(call => call.operation)), ['submit', 'check']);
    assert.equal(await page.evaluate(() => window.editRebaseHarness.commits()), 1);
    await page.evaluate(() => window.editRebaseHarness.hideSource());
    await sent.getByText('Reload the complete conversation before sending this recovered edit.').waitFor();
    assert.equal(await sent.getByRole('button', { name: 'Send', exact: true }).isEnabled(), false);
    await page.evaluate(() => window.editRebaseHarness.refresh());
    await sent.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.editRebaseHarness.calls.length === 3);
    await page.waitForFunction(() => window.editRebaseHarness.saved() === null);
    await sent.getByRole('button', { name: 'Edit message' }).waitFor();
    const calls = await page.evaluate(() => window.editRebaseHarness.calls);
    assert.deepEqual(calls.map(call => call.operation), ['submit', 'check', 'submit']);
    assert.notEqual(calls[0]!.clientUserMessageId, calls[2]!.clientUserMessageId);
    assert.equal((calls[2]!.expectedSource as { clientUserMessageId: string }).clientUserMessageId, calls[0]!.clientUserMessageId);
    assert.deepEqual(calls[2]!.origin, { hostId: 'host-a', threadId: 'thread-a', turnId: 'sent-a', itemId: 'user-a' });
    const input = (calls[2]!.turnParams as { input: Record<string, unknown>[] }).input;
    assert.equal(input[0]!.text, 'C @item');
    assert.deepEqual(input[1], { type: 'image', fileId: 'fixture-file', detail: 'high' });
    assert.deepEqual(input[2], { type: 'mention', name: 'workspace', path: '/work' });
    assert.deepEqual(input[0]!.text_elements, [{ byteRange: { start: 2, end: 7 }, placeholder: '@item', context: { browser: 'synthetic' } }]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
