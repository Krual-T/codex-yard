import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';

async function eventually(page: Page, predicate: () => Promise<unknown>) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(30);
  }
  throw new Error('Timed out waiting for the browser condition.');
}

test('Mini lifecycle and original authority use real components and browser storage', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ entryPoints: ['test/mini-conversation-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  async function pageForFixture() {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:32147'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://127.0.0.1:32147/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => !!(window as any).miniFixture.main());
    return { context, page, errors };
  }
  async function open(page: Page) {
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.locator('.yard-mini-conversation textarea').first().waitFor();
    await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
  }
  try {
    await t.test('opening freezes Main synchronously, rejects cleanly and grants only after the committed Mini', async () => {
      const { context, page, errors } = await pageForFixture();
      try {
        const main = page.locator('#main textarea').first();
        await main.fill('main survives failed opening');
        await page.evaluate(() => { const f = (window as any).miniFixture;
          f.renderQuickGrant(false); f.fenceParent(true); f.rejectOpen(true); f.holdOpen(); });
        await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.openWaiting());
        assert.equal(await page.locator('.yard-mini-conversation').count(), 0);
        assert.equal(await page.locator('#main .standalone-composer > div').first().evaluate(e => (e as HTMLElement).inert), true);
        await page.evaluate(() => (window as any).miniFixture.releaseOpen());
        await page.getByText('The draft could not be saved.').waitFor();
        assert.equal(await main.inputValue(), 'main survives failed opening');
        assert.equal(await page.locator('.yard-mini-conversation').count(), 0);
        await page.evaluate(() => { const f = (window as any).miniFixture; f.rejectOpen(false); f.holdOpen(); });
        await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.openWaiting());
        assert.equal(await page.locator('.yard-mini-conversation').count(), 0);
        await page.evaluate(() => (window as any).miniFixture.releaseOpen());
        await page.locator('.yard-mini-conversation textarea').first().waitFor();
        await page.waitForFunction(() => (window as any).miniFixture.quickStates.some((s: any) => s.mounted && s.visible && !s.interactive && s.contentInert));
        assert.equal(await page.locator('#main .standalone-composer > div').first().evaluate(e => (e as HTMLElement).inert), true);
        await page.evaluate(() => (window as any).miniFixture.grantMini());
        await page.waitForFunction(() => (window as any).miniFixture.quickStates.some((s: any) => s.visible && s.interactive && s.contentInert === false));
        assert.equal(await page.locator('#main').evaluate(e => (e as HTMLElement).inert), true);
        assert.equal(await main.inputValue(), 'main survives failed opening');
        await page.getByRole('button', { name: 'Close Quick chat' }).click();
        await page.waitForFunction(() => { const s = (window as any).miniFixture.quickStates.at(-1);
          return s.mounted && !s.visible && !s.interactive && !s.transitioning && s.contentInert; });
        await page.evaluate(() => (window as any).miniFixture.grantMain());
        assert.equal(await page.locator('#main').evaluate(e => (e as HTMLElement).inert), false);
        const requests = await page.evaluate(() => (window as any).miniFixture.quickRequests);
        assert.deepEqual(requests.map((x: any) => x.source), ['open', 'open']);
        assert.equal(requests[0].previous.mounted, false);
        const unmounted = await page.evaluate(() => { const f = (window as any).miniFixture; f.dispose(); return f.quickStates.at(-1); });
        assert.deepEqual({ mounted: unmounted.mounted, visible: unmounted.visible, interactive: unmounted.interactive,
          target: unmounted.target, contentInert: unmounted.contentInert },
        { mounted: false, visible: false, interactive: false, target: null, contentInert: null });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('external hide and follow-up use the barrier and retain the mounted original editor on refusal', async () => {
      const { context, page, errors } = await pageForFixture();
      try {
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('hidden draft');
        await eventually(page, async () => (window as any).miniFixture.miniDurable('hidden draft'));
        await input.evaluate(element => { (window as any).originalInput = element; });
        const frozenOnHide = await page.evaluate(() => { const f = (window as any).miniFixture; f.renderQuickGrant(false); f.hide();
          return (document.querySelector('[data-mini-composer-content]')?.parentElement as HTMLElement).inert; });
        assert.equal(frozenOnHide, true);
        await page.getByRole('button', { name: 'Show Quick chat' }).waitFor();
        await page.waitForFunction(() => (window as any).miniFixture.quickStates.some((s: any) => s.mounted && !s.visible && !s.interactive && s.contentInert));
        await page.evaluate(() => (window as any).miniFixture.rejectOpen(true));
        await page.getByRole('button', { name: 'Show Quick chat' }).click();
        await page.getByText('The draft could not be saved.').waitFor();
        assert.equal(await input.evaluate(e => e === (window as any).originalInput), true);
        assert.equal(await input.inputValue(), 'hidden draft');
        assert.equal(await page.evaluate(() => (window as any).miniFixture.controller().target().threadId), 'thread-a');
        await page.evaluate(() => (window as any).miniFixture.rejectOpen(false));
        await page.getByRole('button', { name: 'Show Quick chat' }).click();
        await input.waitFor();
        assert.equal(await page.locator('[data-mini-composer-content]').evaluate(e => (e as HTMLElement).inert), true);
        await page.evaluate(() => (window as any).miniFixture.renderQuickGrant(true));
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement).inert);
        await page.evaluate(() => (window as any).miniFixture.show());
        await page.evaluate(() => { const f = (window as any).miniFixture; f.fenceMini(true); f.rejectOpen(true); f.holdOpen(); });
        await page.getByRole('button', { name: 'Follow remote' }).click();
        await page.waitForFunction(() => (window as any).miniFixture.openWaiting());
        assert.equal(await page.evaluate(() => (window as any).miniFixture.canDrain()), false);
        assert.equal(await input.inputValue(), 'hidden draft');
        await page.evaluate(() => (window as any).miniFixture.releaseOpen());
        await page.getByText('The draft could not be saved.').first().waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniFixture.controller().target().threadId), 'thread-a');
        assert.equal(await input.inputValue(), 'hidden draft');
        await page.evaluate(() => { const f = (window as any).miniFixture; f.rejectOpen(false); f.setTargetFailure(true); });
        await page.getByRole('button', { name: 'Follow remote' }).click();
        await page.getByText('The draft could not be saved.').first().waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniFixture.controller().target().threadId), 'thread-a');
        assert.equal(await input.inputValue(), 'hidden draft');
        await page.evaluate(() => (window as any).miniFixture.setTargetFailure(false));
        await page.getByRole('button', { name: 'Follow remote' }).click();
        await page.waitForFunction(() => (window as any).miniFixture.controller().target().threadId === 'thread-b');
        const requests = await page.evaluate(() => (window as any).miniFixture.quickRequests);
        assert.deepEqual(requests.map((x: any) => x.source), ['open', 'recover', 'recover', 'follow-up', 'follow-up', 'follow-up']);
        assert.deepEqual(requests.at(-1).target, { hostId: 'remote', threadId: 'thread-b' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('first follow-up waits for the parent before creating or selecting a Mini target', async () => {
      const { context, page, errors } = await pageForFixture();
      try {
        await page.evaluate(() => { const f = (window as any).miniFixture;
          f.renderQuickGrant(false); f.fenceParent(true); f.rejectOpen(true); f.holdOpen(); });
        await page.getByRole('button', { name: 'Follow remote' }).click();
        await page.waitForFunction(() => (window as any).miniFixture.openWaiting());
        assert.equal(await page.locator('.yard-mini-conversation').count(), 0);
        assert.equal(await page.evaluate(() => (window as any).miniFixture.targets.length), 0);
        await page.evaluate(() => (window as any).miniFixture.releaseOpen());
        await page.getByText('The draft could not be saved.').waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniFixture.targets.length), 0);
        await page.evaluate(() => { const f = (window as any).miniFixture; f.rejectOpen(false); f.holdOpen(); });
        await page.getByRole('button', { name: 'Follow remote' }).click();
        await page.waitForFunction(() => (window as any).miniFixture.openWaiting());
        assert.equal(await page.evaluate(() => (window as any).miniFixture.targets.length), 0);
        await page.evaluate(() => (window as any).miniFixture.releaseOpen());
        await page.waitForFunction(() => (window as any).miniFixture.quickStates.some((s: any) =>
          s.mounted && s.visible && !s.interactive && s.target?.hostId === 'remote' && s.target?.threadId === 'thread-b'));
        await page.evaluate(() => (window as any).miniFixture.grantMini());
        await page.waitForFunction(() => (window as any).miniFixture.miniReady('remote', 'thread-b'));
        assert.equal(await page.evaluate(() => (window as any).miniFixture.targets.length), 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('failed close and disconnect preserve the editor and report committed interaction state', async () => {
      const { context, page, errors } = await pageForFixture();
      try {
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('unsaved on close');
        await page.evaluate(() => (window as any).miniFixture.setFailure(true));
        await input.fill('unsaved on close and disconnect');
        await page.locator('.yard-mini-conversation [role="alert"]').first().waitFor();
        await page.getByRole('button', { name: 'Close Quick chat' }).click();
        await page.getByText('The draft could not be saved.').waitFor();
        assert.equal(await input.inputValue(), 'unsaved on close and disconnect');
        await page.waitForFunction(() => { const s = (window as any).miniFixture.quickStates.at(-1); return s.visible && s.interactive && !s.transitioning; });
        const frozenOnDisconnect = await page.evaluate(() => { const f = (window as any).miniFixture; f.renderQuickGrant(false); f.disconnect();
          return (document.querySelector('[data-mini-composer-content]')?.parentElement as HTMLElement).inert; });
        assert.equal(frozenOnDisconnect, true);
        await page.waitForFunction(() => { const s = (window as any).miniFixture.quickStates.at(-1); return s.mounted && !s.interactive && s.contentInert; });
        await page.evaluate(() => (window as any).miniFixture.reconnect());
        await page.waitForFunction(() => !(window as any).miniFixture.quickStates.at(-1).interactive);
        assert.equal(await input.inputValue(), 'unsaved on close and disconnect');
        await page.evaluate(() => { const f = (window as any).miniFixture; f.setFailure(false); f.renderQuickGrant(true); });
        await page.waitForFunction(() => (window as any).miniFixture.quickStates.at(-1).interactive);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('old Mini cancel cannot clear a later message editor acquisition in the IDB transaction', async () => {
      const { context, page, errors } = await pageForFixture();
      try {
        await open(page);
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', 'thread-b')), true);
        const item = page.locator('.yard-mini-conversation [data-message-id="original-item"]');
        await item.getByRole('button', { name: 'Edit message' }).click();
        const editor = item.getByRole('textbox', { name: 'Edit message text' });
        await editor.fill('keep original edit');
        await eventually(page, async () => (await (window as any).miniFixture.editState('remote', 'thread-b'))
          ?.recovery.editor.edits[0]?.text === 'keep original edit');
        await page.evaluate(() => (window as any).miniFixture.holdEditTransaction());
        await item.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.editTransactionWaiting());
        assert.equal(await page.evaluate(() => (window as any).miniFixture.transferEdit()), true);
        await page.evaluate(() => (window as any).miniFixture.releaseEditTransaction());
        await page.waitForFunction(() => !!(window as any).miniFixture.editTransactionError());
        const record = await page.evaluate(() => (window as any).miniFixture.editState('remote', 'thread-b'));
        assert.equal(record.recovery.editor.edits[0].text, 'keep original edit');
        await page.evaluate(() => (window as any).miniFixture.showPeer());
        const peer = page.locator('#peer-messages [data-message-id="original-item"]');
        await peer.getByRole('textbox', { name: 'Edit message text' }).waitFor();
        assert.equal(await peer.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'keep original edit');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('interrupt checks the original parent and socket after the actual client wait; unknown is not replayed', async () => {
      const { context, page, errors } = await pageForFixture();
      try {
        await open(page);
        await page.locator('.yard-mini-conversation textarea').first().fill('start one task');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '停止', exact: true }).waitFor();
        await page.evaluate(async () => { const f = (window as any).miniFixture; await f.useRealInterrupt(); f.holdInterrupt(); });
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.interruptWaiting());
        await page.evaluate(() => { const f = (window as any).miniFixture; f.revokeEditGrant(); f.releaseInterrupt(); });
        await page.locator('.yard-mini-conversation [role="alert"]').filter({ hasText: 'Mini 原连接或停止任务权限已改变' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniFixture.calls.filter((x: any) => x.method === 'turn/interrupt').length), 0);
        await page.evaluate(() => { const f = (window as any).miniFixture; f.restoreAuthority(); f.renderConnection(true); });
        await page.waitForFunction(() => !(document.querySelector('.yard-mini-conversation .standalone-composer')?.parentElement as HTMLElement)?.inert);
        await page.evaluate(() => (window as any).miniFixture.holdInterrupt());
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.interruptWaiting());
        await page.evaluate(async () => { const f = (window as any).miniFixture; await f.replaceInterruptSocket(); f.releaseInterrupt(); });
        await page.locator('.yard-mini-conversation [role="alert"]').filter({ hasText: '原页面连接已改变' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniFixture.calls.filter((x: any) => x.method === 'turn/interrupt').length), 0);
        await page.evaluate(() => (window as any).miniFixture.dropInterrupt());
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.filter((x: any) => x.method === 'turn/interrupt').length === 1);
        await page.locator('.yard-mini-conversation [role="alert"]').filter({ hasText: '操作结果未知' }).waitFor();
        const writes = await page.evaluate(() => (window as any).miniFixture.calls.filter((x: any) => x.method === 'turn/interrupt'));
        assert.deepEqual(writes, [{ method: 'turn/interrupt', hostId: 'local', params: { threadId: 'thread-a', turnId: 'turn-1' } }]);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => (window as any).miniFixture.calls.filter((x: any) => x.method === 'turn/interrupt').length), 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
