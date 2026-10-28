import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    editLeaveHarness: {
      ready(): boolean; writes(): number; saving(): boolean; saved(): { editor: { revision: number; edits: { text: string }[]; removedAttachments: unknown[] } } | null;
      setMode(mode: string): void; releaseSave(): void; freezeAndTry(): { origin: { hostId: string; threadId: string; turnId: string; itemId: string }; version: { revision: number; sessionId: string } };
      flush(): void; status(): string; failure(): string; release(): void; editCalls(): number;
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
const require = createRequire(import.meta.url);
test('message navigation freezes the exact draft, waits for storage, retries failure and preserves subsequent edits', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
    const client = { rpc: async () => { throw Error('unexpected RPC'); }, host: async () => { throw Error('unexpected host'); },
      subscribe: () => () => {}, reply: async () => { throw Error('unexpected approval'); } };
    let controller, lease, saved = null, mode = 'ok', releaseSave, writes = 0, status = 'idle', failure = '', editCalls = 0;
    const onEditDraftChange = async (value) => {
      if (mode === 'hold') await new Promise(resolve => { releaseSave = resolve; });
      if (mode === 'fail') throw Error('Synthetic storage failure');
      saved = value && structuredClone(value); writes++;
    };
    const thread = { id:'thread-a', cwd:'/work', name:null, status:{type:'idle'}, turns:[{id:'turn-a',status:'completed',itemsView:'full',items:[
      {id:'user-a',type:'userMessage',content:[{type:'text',text:'original',text_elements:[]},{type:'image',fileId:'image-a',detail:'high'}]}]}] };
    createRoot(document.getElementById('root')).render(React.createElement(StandaloneMessages, {client, hostId:'host-a', thread,
      onEdit:async () => { editCalls++; }, editHistory:{order:'ascending',tailComplete:true}, onEditDraftChange,
      onEditNavigationController:value => { controller = value; }}));
    window.editLeaveHarness = {
      ready:() => !!controller, writes:() => writes, saving:() => !!releaseSave, saved:() => saved,
      setMode:value => { mode = value; }, releaseSave:() => { releaseSave(); releaseSave = undefined; },
      freezeAndTry:() => {
        lease = controller.freeze();
        const form = document.querySelector('.yard-message-edit');
        const input = form.querySelector('textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'blocked during freeze');
        input.dispatchEvent(new Event('input', {bubbles:true}));
        form.querySelector('[aria-label="Remove image 2"]').click();
        form.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
        form.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
        return {origin:lease.origin,version:lease.version};
      },
      flush:() => { status = 'pending'; failure = ''; void lease.flush().then(() => { status = 'saved'; }, error => { status = 'failed'; failure = error.message; }); },
      status:() => status, failure:() => failure, release:() => { lease.release(); }, editCalls:() => editCalls,
    };
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'single-katex', setup(builder) { builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') })); } }] });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root" style="height:680px"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => window.editLeaveHarness.ready());
    const message = page.locator('[data-message-id="user-a"]');
    await message.getByRole('button', { name: 'Edit message' }).click();
    await page.waitForFunction(() => window.editLeaveHarness.writes() > 0);
    const input = message.getByLabel('Edit message text');
    await page.evaluate(() => window.editLeaveHarness.setMode('hold'));
    await input.fill('latest before leaving');
    const captured = await page.evaluate(() => window.editLeaveHarness.freezeAndTry());
    assert.deepEqual(captured.origin, { hostId: 'host-a', threadId: 'thread-a', turnId: 'turn-a', itemId: 'user-a' });
    assert.ok(captured.version.revision > 0);
    assert.equal(await input.isDisabled(), true);
    assert.equal(await message.getByRole('button', { name: 'Remove image 2' }).isDisabled(), true);
    assert.equal(await message.getByRole('button', { name: 'Cancel' }).isDisabled(), true);
    assert.equal(await message.getByRole('button', { name: 'Send' }).isDisabled(), true);
    await page.evaluate(() => window.editLeaveHarness.flush());
    await page.waitForFunction(() => window.editLeaveHarness.saving());
    assert.equal(await page.evaluate(() => window.editLeaveHarness.status()), 'pending');
    await page.evaluate(() => { window.editLeaveHarness.setMode('fail'); window.editLeaveHarness.releaseSave(); });
    await page.waitForFunction(() => window.editLeaveHarness.status() === 'failed');
    assert.match(await page.evaluate(() => window.editLeaveHarness.failure()), /Synthetic storage failure/);
    assert.equal(await input.inputValue(), 'latest before leaving');
    assert.equal(await input.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.editLeaveHarness.editCalls()), 0);
    await page.evaluate(() => { window.editLeaveHarness.setMode('ok'); window.editLeaveHarness.flush(); });
    await page.waitForFunction(() => window.editLeaveHarness.status() === 'saved');
    const saved = await page.evaluate(() => window.editLeaveHarness.saved());
    assert.equal(saved?.editor.revision, captured.version.revision);
    assert.equal(saved?.editor.edits[0]?.text, 'latest before leaving');
    assert.deepEqual(saved?.editor.removedAttachments, []);
    await page.evaluate(() => window.editLeaveHarness.release());
    assert.equal(await input.isDisabled(), false);
    await input.fill('newer after cancelled navigation');
    const newer = await page.evaluate(() => window.editLeaveHarness.freezeAndTry());
    assert.equal(newer.version.sessionId, captured.version.sessionId);
    assert.ok(newer.version.revision > captured.version.revision);
    await page.evaluate(() => window.editLeaveHarness.flush());
    await page.waitForFunction(() => window.editLeaveHarness.status() === 'saved');
    assert.equal((await page.evaluate(() => window.editLeaveHarness.saved()))?.editor.edits[0]?.text, 'newer after cancelled navigation');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
