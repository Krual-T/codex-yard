import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';

async function eventually(page: Page, predicate: () => Promise<unknown>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(30);
  }
  throw new Error('Timed out waiting for the browser condition.');
}

test('MiniWorkspace composes the real Mini, editor and shared services', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 180_000,
}, async t => {
  const bundle = await build({ entryPoints: ['test/mini-workspace-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  async function create(home = false, project = false) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:32148'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://127.0.0.1:32148/' + (home ? '?home=1' + (project ? '&project=1' : '') : ''));
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => !!(window as any).miniWorkspaceFixture?.ready());
    await page.getByRole('button', { name: 'Quick chat', exact: true }).waitFor();
    return { context, page, errors };
  }
  async function open(page: Page) {
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.locator('.yard-mini-conversation textarea').first().waitFor();
    await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
  }
  try {
    await t.test('opens after Main freeze and drain, sends through the shared original client, then yields to Main', async () => {
      const { context, page, errors } = await create();
      try {
        await page.locator('#main textarea').first().fill('main retained');
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdMain(true));
        await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainWaiting());
        assert.equal(await page.locator('#main').evaluate(element => (element as HTMLElement).inert), true);
        assert.equal(await page.locator('.yard-mini-conversation').count(), 0);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.releaseMain());
        await page.locator('.yard-mini-conversation textarea').first().waitFor();
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.deepEqual(await page.evaluate(() => (window as any).miniWorkspaceFixture.leases.slice(0, 3)), ['freeze', 'flush', 'handoff']);
        await page.locator('.yard-mini-conversation textarea').first().fill('mini send');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((call: any) => call.method === 'turn/start'));
        const write = await page.evaluate(() => (window as any).miniWorkspaceFixture.calls.find((call: any) => call.method === 'turn/start'));
        assert.equal(write.hostId, 'local'); assert.equal(write.params.threadId, 'thread-a'); assert.equal(write.params.input[0].text, 'mini send');
        await eventually(page, async () => !Object.keys((await (window as any).miniWorkspaceFixture.records()).requests).length);
        await page.getByRole('button', { name: 'Close Quick chat' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainVisible());
        assert.equal(await page.locator('#main textarea').first().inputValue(), 'main retained');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('failed Main flush and native hide retain the actual original editors', async () => {
      const { context, page, errors } = await create();
      try {
        await page.locator('#main textarea').first().fill('main survives');
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failMain(true));
        await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
        await page.getByText('The draft could not be saved.').waitFor();
        assert.equal(await page.locator('#main textarea').first().inputValue(), 'main survives');
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failMain(false));
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('mini survives hide');
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failHide(true));
        await page.getByRole('button', { name: 'Mini menu' }).click();
        await page.getByRole('menuitem', { name: 'Hide Mini' }).click();
        await page.getByText('Mini host request failed').waitFor();
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.equal(await input.inputValue(), 'mini survives hide');
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.hostCalls.filter((call: any) => call.endpoint === 'pet-overlay'
          && call.params.message.type === 'avatar-overlay-close').length), 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('external hide with IDB failure retains the actual Mini and refuses to release Main', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('durable original');
        await eventually(page, async () => { const f = (window as any).miniWorkspaceFixture, p = JSON.parse(f.pointer());
          return (await f.miniDraft(p))?.draft.text === 'durable original'; });
        await page.evaluate(() => { (window as any).miniWorkspaceFixture.failWrites(true); });
        await input.fill('unsaved change');
        await page.evaluate(() => (window as any).miniWorkspaceFixture.hide());
        await page.getByRole('button', { name: 'Show Quick chat' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        await page.getByRole('button', { name: 'Show Quick chat' }).click();
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.equal(await input.inputValue(), 'unsaved change');
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failWrites(false));
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '重试保存' }).click();
        await eventually(page, async () => { const f = (window as any).miniWorkspaceFixture, p = JSON.parse(f.pointer());
          return (await f.miniDraft(p))?.draft.text === 'unsaved change'; });
        await page.getByRole('button', { name: 'Close Quick chat' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainVisible());
        assert.equal(await input.inputValue(), 'unsaved change');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('follow-up uses actual target metadata and the shared approval controller', async () => {
      const { context, page, errors } = await create();
      try {
        await page.evaluate(() => (window as any).miniWorkspaceFixture.request());
        await page.getByRole('button', { name: 'Approve', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls.some((call: any) => call.endpoint === 'reply'));
        const ref = await page.evaluate(() => (window as any).miniWorkspaceFixture.hostCalls.find((call: any) => call.endpoint === 'reply').params.ref);
        assert.deepEqual(ref, { hostId: 'remote', id: 7, generation: 'fixture-1' });
        await open(page);
        await page.getByRole('button', { name: 'Follow remote' }).click();
        await page.waitForFunction(() => JSON.parse((window as any).miniWorkspaceFixture.pointer()).threadId === 'thread-b');
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        await page.locator('.yard-mini-conversation textarea').first().fill('remote message');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((call: any) => call.method === 'turn/start'));
        const write = await page.evaluate(() => (window as any).miniWorkspaceFixture.calls.find((call: any) => call.method === 'turn/start'));
        assert.equal(write.hostId, 'remote'); assert.equal(write.params.threadId, 'thread-b');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('home creation persists its real binding before the first turn', async () => {
      const { context, page, errors } = await create(true);
      try {
        await open(page);
        await page.locator('.yard-mini-conversation textarea').first().fill('new conversation');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((call: any) => call.method === 'turn/start'));
        const value = await page.evaluate(async () => { const f = (window as any).miniWorkspaceFixture;
          return { calls: f.calls, pointer: JSON.parse(f.pointer()), state: await f.records() }; });
        assert.equal(value.calls.filter((call: any) => call.method === 'thread/start').length, 1);
        assert.equal(value.pointer.threadId, 'created-1');
        assert.equal(value.state.bindings[JSON.stringify(['local', 'created-1'])], value.pointer.draftId);
        assert.equal(value.calls.find((call: any) => call.method === 'turn/start').params.threadId, 'created-1');
        await eventually(page, async () => !Object.keys((await (window as any).miniWorkspaceFixture.records()).requests).length);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.complete('local', 'created-1'));
        await page.waitForFunction(() => !document.querySelector('.yard-mini-conversation .standalone-composer__submit')?.textContent?.includes('排队'));
        await page.locator('.yard-mini-conversation textarea').first().fill('second message');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.filter((call: any) => call.method === 'turn/start').length === 2);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.calls.filter((call: any) => call.method === 'thread/start').length), 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('same-thread message edit transfers through the shared store, then returns to Main', async () => {
      const { context, page, errors } = await create();
      try {
        await page.locator('#main').getByRole('button', { name: 'Edit message' }).click();
        const mainEdit = page.locator('#main').getByRole('textbox', { name: 'Edit message text' });
        await mainEdit.fill('shared edit');
        await eventually(page, async () => (await (window as any).miniWorkspaceFixture.edit())?.recovery?.editor?.edits?.[0]?.text === 'shared edit');
        await open(page);
        const miniEdit = page.locator('.yard-mini-conversation').getByRole('textbox', { name: 'Edit message text' });
        await miniEdit.waitFor();
        assert.equal(await miniEdit.inputValue(), 'shared edit');
        assert.equal(await page.locator('#main').evaluate(element => (element as HTMLElement).inert), true);
        await miniEdit.fill('mini edit');
        await eventually(page, async () => (await (window as any).miniWorkspaceFixture.edit())?.recovery?.editor?.edits?.[0]?.text === 'mini edit');
        await page.getByRole('button', { name: 'Close Quick chat' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainVisible());
        await page.locator('#main').getByRole('textbox', { name: 'Edit message text' }).waitFor();
        assert.equal(await page.locator('#main').getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'mini edit');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a held send cannot borrow a new connection and never auto-replays on reconnect', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('original connection');
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdWrite());
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.writeWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture; f.disconnect(); f.reconnect(); f.releaseWrite(); });
        await page.waitForFunction(() => !(window as any).miniWorkspaceFixture.writeWaiting());
        await page.getByRole('button', { name: 'Retry Mini access' }).click();
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.equal(await input.inputValue(), 'original connection');
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.calls.filter((call: any) => call.method === 'turn/start').length), 0);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('created target persistence failure retries the original receipt without creating twice', async () => {
      const { context, page, errors } = await create(true);
      try {
        await open(page);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failCreatedPointer(true));
        await page.locator('.yard-mini-conversation textarea').first().fill('preserve created receipt');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.getByRole('button', { name: 'Retry original send' }).waitFor();
        assert.equal(await page.evaluate(() => JSON.parse((window as any).miniWorkspaceFixture.pointer()).threadId), null);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.calls.filter((call: any) => call.method === 'turn/start').length), 0);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failCreatedPointer(false));
        await page.getByRole('button', { name: 'Retry original send' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((call: any) => call.method === 'turn/start'));
        const value = await page.evaluate(() => ({ calls: (window as any).miniWorkspaceFixture.calls,
          pointer: JSON.parse((window as any).miniWorkspaceFixture.pointer()) }));
        assert.equal(value.calls.filter((call: any) => call.method === 'thread/start').length, 1);
        assert.equal(value.pointer.threadId, 'created-1');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('reload retains the selected Mini owner and target metadata without saving draft text in the pointer', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        await page.getByRole('button', { name: 'Follow remote' }).click();
        await page.waitForFunction(() => JSON.parse((window as any).miniWorkspaceFixture.pointer()).threadId === 'thread-b');
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('reload retained content');
        await eventually(page, async () => { const f = (window as any).miniWorkspaceFixture, p = JSON.parse(f.pointer());
          return (await f.miniDraft(p))?.draft.text === 'reload retained content'; });
        const pointer = await page.evaluate(() => (window as any).miniWorkspaceFixture.pointer());
        assert.equal(pointer.includes('reload retained content'), false);
        await page.getByRole('button', { name: 'Close Quick chat' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainVisible());
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.waitForFunction(() => !!(window as any).miniWorkspaceFixture?.ready());
        await open(page);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.pointer()), pointer);
        // The shell becomes interactive before the persisted draft is projected into its editor.
        await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('.yard-mini-conversation textarea')?.value === 'reload retained content');
        assert.equal(await page.locator('.yard-mini-conversation textarea').first().inputValue(), 'reload retained content');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('route barrier freezes synchronously and cancellation restores the same Mini editor', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('navigation draft');
        const frozen = await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          (window as any).navigationLease = f.nav().freeze();
          return { lease: !!(window as any).navigationLease, inert: (document.querySelector('.yard-mini-conversation') as HTMLElement).inert };
        });
        assert.deepEqual(frozen, { lease: true, inert: true });
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        assert.equal(await page.evaluate(async () => await (window as any).navigationLease.flush()), true);
        await page.evaluate(() => (window as any).navigationLease.release());
        await page.waitForFunction(() => !(document.querySelector('.yard-mini-conversation') as HTMLElement).inert);
        assert.equal(await input.inputValue(), 'navigation draft');
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('new thread retains its original project and invokes the guarded association before sending', async () => {
      const { context, page, errors } = await create(true, true);
      try {
        await open(page);
        await page.locator('.yard-mini-conversation textarea').first().fill('project message');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((call: any) => call.method === 'turn/start'));
        const value = await page.evaluate(() => ({ projects: (window as any).miniWorkspaceFixture.projects,
          pointer: JSON.parse((window as any).miniWorkspaceFixture.pointer()) }));
        assert.deepEqual(value.projects, [{ hostId: 'local', projectId: 'project-original', threadId: 'created-1', turnsBefore: 0 }]);
        assert.equal(value.pointer.projectId, 'project-original');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('changed target metadata does not replace the original Mini pointer on reload', async () => {
      const { context, page, errors } = await create();
      try {
        const pointer = await page.evaluate(() => (window as any).miniWorkspaceFixture.pointer());
        await page.goto('http://127.0.0.1:32148/?badcwd=1');
        await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.getByRole('alert').filter({ hasText: 'Mini 原目标无法确认' }).waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.pointer()), pointer);
        assert.equal(await page.locator('.yard-mini-conversation').count(), 0);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.calls.filter((call: any) => call.method === 'turn/start').length), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('created receipt read failure before dispatch stays known-unsent and can retry the same thread', async () => {
      const { context, page, errors } = await create(true);
      try {
        await open(page);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failPreSendRead());
        await page.locator('.yard-mini-conversation textarea').first().fill('read failure before send');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.getByRole('button', { name: 'Retry original send' }).waitFor();
        await eventually(page, async () => Object.values((await (window as any).miniWorkspaceFixture.records()).requests)
          .some((request: any) => request.stage === 'failed'));
        const prior = await page.evaluate(async () => { const f = (window as any).miniWorkspaceFixture;
          return { calls: f.calls, requests: Object.values((await f.records()).requests) as { stage: string }[], pointer: JSON.parse(f.pointer()) }; });
        assert.equal(prior.calls.filter((call: any) => call.method === 'turn/start').length, 0);
        assert.equal(prior.requests[0].stage, 'failed');
        assert.equal(prior.pointer.threadId, 'created-1');
        await page.getByRole('button', { name: 'Retry original send' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((call: any) => call.method === 'turn/start'));
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.calls.filter((call: any) => call.method === 'thread/start').length), 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('reconnect after an unsaved Mini draft restores only the original editor for explicit save', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('last saved');
        await eventually(page, async () => { const f = (window as any).miniWorkspaceFixture, p = JSON.parse(f.pointer());
          return (await f.miniDraft(p))?.draft.text === 'last saved'; });
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failWrites(true));
        await input.fill('failed while offline');
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture; f.disconnect(); f.reconnect(); });
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls.filter((call: any) => call.endpoint === 'pet-overlay'
          && call.params.message.type === 'avatar-overlay-open-state-request').length >= 2);
        await page.getByRole('button', { name: 'Retry Mini access' }).click();
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.equal(await input.inputValue(), 'failed while offline');
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.failWrites(false));
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '重试保存' }).click();
        await eventually(page, async () => { const f = (window as any).miniWorkspaceFixture, p = JSON.parse(f.pointer());
          return (await f.miniDraft(p))?.draft.text === 'failed while offline'; });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('late unconfirmed native state cannot grant Mini until an explicit fresh read', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture; f.holdPetRead(); f.invalidatePet(); });
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.petReadWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture; f.expirePetRead(); f.latePetState(); f.releasePetRead(); });
        assert.equal(await page.locator('[data-mini-composer-content]').evaluate(element => (element as HTMLElement).inert), true);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        await page.getByRole('button', { name: 'Retry Mini access' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls.filter((call: any) => call.endpoint === 'pet-overlay'
          && call.params.message.type === 'avatar-overlay-open-state-request').length >= 3);
        assert.equal(await page.locator('[data-mini-composer-content]').evaluate(element => (element as HTMLElement).inert), true);
        await page.getByRole('button', { name: 'Retry Mini access' }).click();
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('an old state during a new native read cannot grant access before that read completes', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const reads = await page.evaluate(() => (window as any).miniWorkspaceFixture.hostCalls.filter((call: any) => call.endpoint === 'pet-overlay'
          && call.params.message.type === 'avatar-overlay-open-state-request').length);
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture; f.holdPetAck(); f.invalidatePet(); });
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.petAckWaiting());
        await page.getByRole('button', { name: 'Retry Mini access' }).click();
        assert.equal(await page.locator('[data-mini-composer-content]').evaluate(element => (element as HTMLElement).inert), true);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.hostCalls.filter((call: any) => call.endpoint === 'pet-overlay'
          && call.params.message.type === 'avatar-overlay-open-state-request').length), reads + 1);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.releasePetAck(false));
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainVisible());
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a timed-out native read remains inert until the actual Mini accepts its new confirmation', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture; f.holdPetRead(); f.invalidatePet(); });
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.petReadWaiting());
        await page.getByRole('alert').filter({ hasText: 'Mini state could not be confirmed' }).waitFor({ timeout: 15_000 });
        await page.evaluate(() => (window as any).miniWorkspaceFixture.releasePetRead());
        await page.getByRole('button', { name: 'Retry Mini access' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls.filter((call: any) => call.endpoint === 'pet-overlay'
          && call.params.message.type === 'avatar-overlay-open-state-request').length >= 3);
        await page.getByRole('button', { name: 'Retry Mini access' }).click();
        assert.equal(await page.locator('[data-mini-composer-content]').evaluate(element => (element as HTMLElement).inert), true);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.mainVisible()), false);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
