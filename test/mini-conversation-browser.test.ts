import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('real Mini conversation uses shared sessions and preserves drafts through sends and failed transitions', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ entryPoints: ['test/mini-conversation-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  async function open() {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:32147'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://127.0.0.1:32147/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.locator('.yard-mini-conversation textarea').first().waitFor();
    await page.waitForFunction(() => !!(window as any).miniFixture.main());
    return { context, page, errors };
  }
  try {
    await t.test('send, queue, steer, interrupt and queue start retain separate main owner', async () => {
      const { context, page, errors } = await open();
      try {
        const main = page.locator('#main textarea').first(), mini = page.locator('.yard-mini-conversation textarea').first();
        await main.fill('main draft'); await mini.fill('mini first');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.some((x: any) => x.method === 'turn/start'));
        await page.waitForFunction(() => (window as any).miniFixture.sessions.view({hostId:'local',threadId:'thread-a'}).snapshot().thread?.turns[0]?.status === 'inProgress');
        await page.waitForFunction(() => document.querySelector('.yard-mini-conversation .standalone-composer__submit')?.textContent?.includes('排队'));
        await mini.fill('queued from mini');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.some((x: any) => x.method === 'thread/queue/add'));
        await page.waitForFunction(async () => !Object.keys((await (window as any).miniFixture.records()).requests).length
          && (document.querySelector('.yard-mini-conversation textarea') as HTMLTextAreaElement)?.value === '');
        await mini.fill('steer from mini');
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '发送到当前任务' }).click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.some((x: any) => x.method === 'turn/steer'));
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.some((x: any) => x.method === 'turn/interrupt'));
        await page.locator('.yard-mini-conversation').getByRole('button', { name: '立即发送待发送消息' }).click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.some((x: any) => x.method === 'thread/queue/start'));
        const data = await page.evaluate(async () => ({ calls: (window as any).miniFixture.calls,
          main: (window as any).miniFixture.main(), records: await (window as any).miniFixture.records() }));
        const writes = data.calls.filter((call: any) => ['turn/start', 'thread/queue/add', 'turn/steer', 'turn/interrupt', 'thread/queue/start'].includes(call.method));
        assert.deepEqual(writes.map((call: any) => call.method), ['turn/start', 'thread/queue/add', 'turn/steer', 'turn/interrupt', 'thread/queue/start']);
        assert.ok(writes.every((call: any) => call.hostId === 'local' && call.params.threadId === 'thread-a'));
        assert.equal(writes[0].params.input[0].text, 'mini first');
        assert.equal(writes[1].params.input[0].text, 'queued from mini');
        assert.equal(writes[2].params.expectedTurnId, 'turn-1');
        assert.equal(data.main.draft.text, 'main draft');
        assert.deepEqual(Object.keys(data.records.requests), []);
        assert.equal(data.calls.filter((call: any) => call.method === 'thread/resume' && call.params.threadId === 'thread-a').length, 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('real rich editor stays mounted on failed save, switch, close and external hide', async () => {
      const { context, page, errors } = await open();
      try {
        const mini = page.locator('.yard-mini-conversation');
        await mini.locator('textarea').first().fill('retain rich');
        await mini.getByRole('button', { name: '富文本编辑' }).click();
        const rich = mini.locator('.ProseMirror'); await rich.waitFor();
        await rich.focus();
        await rich.evaluate(element => { const node = element.querySelector('p')!.firstChild!; const range = document.createRange();
          range.selectNodeContents(node); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
        await mini.getByRole('button', { name: '粗体' }).click();
        await rich.locator('strong').waitFor();
        await page.evaluate(() => (window as any).miniFixture.setFailure(true));
        await rich.click(); await page.keyboard.press('End'); await page.keyboard.insertText(' unsaved');
        await mini.getByRole('alert').filter({ hasText: /保存|存储/ }).first().waitFor();
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', 'thread-b')), false);
        assert.equal(await mini.locator('strong').count(), 1);
        await page.getByRole('button', { name: 'Close Quick chat' }).click();
        await page.getByText('The draft could not be saved.').waitFor();
        await page.evaluate(() => (window as any).miniFixture.hide());
        await page.getByRole('button', { name: 'Show Quick chat' }).click();
        assert.match(await rich.innerText(), /retain rich.*unsaved/);
        await page.evaluate(() => (window as any).miniFixture.setFailure(false));
        await mini.getByRole('button', { name: '重试保存' }).click();
        await page.waitForFunction(async () => (window as any).miniFixture.miniDurable('unsaved'));
        await page.waitForFunction(async () => (window as any).miniFixture.canDrain());
        await page.evaluate(() => (window as any).miniFixture.setTargetFailure(true));
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', 'thread-b')), false);
        assert.equal(await page.evaluate(() => (window as any).miniFixture.controller().target().threadId), 'thread-a');
        assert.match(await rich.innerText(), /retain rich.*unsaved/);
        await page.evaluate(() => (window as any).miniFixture.setTargetFailure(false));
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', 'thread-b')), true);
        await page.waitForFunction(() => (window as any).miniFixture.controller()?.target().threadId === 'thread-b');
        await page.waitForFunction(() => (window as any).miniFixture.miniReady('remote', 'thread-b'));
        await page.waitForFunction(async () => (window as any).miniFixture.canDrain());
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('local', 'thread-a')), true);
        await mini.locator('.ProseMirror strong').waitFor();
        assert.match(await mini.locator('.ProseMirror').innerText(), /retain rich.*unsaved/);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('disconnect freezes the real editor and reconnect requires an explicit send', async () => {
      const { context, page, errors } = await open();
      try {
        const mini = page.locator('.yard-mini-conversation'), input = mini.locator('textarea').first();
        await input.fill('offline draft');
        await page.waitForFunction(async () => (window as any).miniFixture.miniDurable('offline draft'));
        await page.evaluate(() => (window as any).miniFixture.disconnect());
        await page.waitForFunction(() => (document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        assert.equal(await input.inputValue(), 'offline draft');
        assert.equal(await page.evaluate(() => (window as any).miniFixture.calls.filter((x: any) => x.method === 'turn/start').length), 0);
        await page.evaluate(() => (window as any).miniFixture.reconnect());
        await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
        await mini.locator('.standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.some((x: any) => x.method === 'turn/start'));
        const writes = await page.evaluate(() => (window as any).miniFixture.calls.filter((x: any) => x.method === 'turn/start'));
        assert.equal(writes.length, 1); assert.equal(writes[0].params.input[0].text, 'offline draft');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('navigation lease freezes input synchronously until released', async () => {
      const { context, page, errors } = await open();
      try {
        const mini = page.locator('.yard-mini-conversation'), input = mini.locator('textarea').first();
        await input.fill('before freeze');
        await page.waitForFunction(async () => (window as any).miniFixture.miniDurable('before freeze'));
        await page.waitForFunction(async () => (window as any).miniFixture.canDrain());
        await input.focus();
        assert.equal(await page.evaluate(() => (window as any).miniFixture.freeze()), true);
        assert.equal(await mini.evaluate(element => (element as HTMLElement).inert), true);
        await page.keyboard.insertText(' changed while frozen');
        assert.equal(await input.inputValue(), 'before freeze');
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', 'thread-b')), false);
        assert.equal(await page.evaluate(() => (window as any).miniFixture.flush()), true);
        await page.evaluate(() => (window as any).miniFixture.releaseBarrier());
        await input.fill('editable again');
        await page.waitForFunction(async () => (window as any).miniFixture.miniDurable('editable again'));
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('message edit retains its original host, thread, turn and item', async () => {
      const { context, page, errors } = await open();
      try {
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', 'thread-b')), true);
        const mini = page.locator('.yard-mini-conversation'), item = mini.locator('[data-message-id="original-item"]');
        await item.getByText('remote original').waitFor();
        await mini.getByRole('button', { name: 'remote:thread-b' }).click();
        assert.deepEqual(await page.evaluate(() => (window as any).miniFixture.opened), [{ hostId: 'remote', threadId: 'thread-b' }]);
        await item.getByRole('button', { name: 'Edit message' }).click();
        await item.getByRole('textbox', { name: 'Edit message text' }).fill('edited remotely');
        await page.waitForFunction(async () => (await (window as any).miniFixture.editState('remote', 'thread-b'))
          ?.recovery.editor.edits[0]?.text === 'edited remotely');
        await item.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.hostCalls.length === 1);
        const request = await page.evaluate(() => (window as any).miniFixture.hostCalls[0]);
        assert.equal(request.endpoint, 'message-edit');
        assert.deepEqual(request.params.origin, { hostId: 'remote', threadId: 'thread-b', turnId: 'original-turn', itemId: 'original-item' });
        assert.equal(request.params.hostId, 'remote'); assert.equal(request.params.threadId, 'thread-b');
        assert.deepEqual(request.params.expectedTurnIds, ['original-turn']);
        assert.equal(request.params.turnParams.input[0].text, 'edited remotely');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('new thread binds its own draft and unknown send never replays on reconnect', async () => {
      const { context, page, errors } = await open();
      try {
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', null)), true);
        const mini = page.locator('.yard-mini-conversation'), input = mini.locator('textarea').first();
        await input.waitFor(); await input.fill('new remote draft');
        await page.evaluate(() => (window as any).miniFixture.unknown());
        await mini.locator('.standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniFixture.controller()?.target().threadId === 'created-1');
        await page.waitForFunction(async () => Object.values((await (window as any).miniFixture.records()).requests).some((x: any) => x.stage === 'unknown'));
        const before = await page.evaluate(async () => ({ target: (window as any).miniFixture.controller().target(),
          state: await (window as any).miniFixture.records(), calls: (window as any).miniFixture.calls }));
        const intent: any = Object.values(before.state.requests)[0];
        assert.equal(intent.owner.hostId, 'remote'); assert.equal(intent.owner.threadId, null);
        assert.equal(intent.threadId, 'created-1'); assert.equal(intent.draft.text, 'new remote draft');
        assert.equal(before.state.bindings[JSON.stringify(['remote', 'created-1'])], intent.owner.draftId);
        assert.equal(before.target.draftId, intent.owner.draftId);
        await page.evaluate(() => { (window as any).miniFixture.disconnect(); (window as any).miniFixture.reconnect(); });
        await assert.rejects(page.evaluate((id: string) => (window as any).miniFixture.controller().retry(id), intent.id));
        const after = await page.evaluate(() => (window as any).miniFixture.calls);
        assert.equal(after.filter((x: any) => x.method === 'thread/start').length, 1);
        assert.equal(after.filter((x: any) => x.method === 'turn/start').length, 1);
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniFixture.controller()?.target().threadId === 'created-1');
        const restored = await page.evaluate(async () => ({ target: (window as any).miniFixture.controller().target(),
          state: await (window as any).miniFixture.records(), calls: (window as any).miniFixture.calls }));
        assert.equal(restored.target.draftId, intent.owner.draftId);
        assert.equal(restored.state.requests[intent.id].stage, 'unknown');
        assert.equal(restored.calls.filter((x: any) => x.method === 'thread/start' || x.method === 'turn/start').length, 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('new rich draft keeps its original mode and owner through creation and reload', async () => {
      const { context, page, errors } = await open();
      try {
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', null)), true);
        const mini = page.locator('.yard-mini-conversation');
        await mini.locator('textarea').first().fill('created rich');
        await mini.getByRole('button', { name: '富文本编辑' }).click();
        const rich = mini.locator('.ProseMirror'); await rich.waitFor();
        await rich.focus();
        await rich.evaluate(element => { const node = element.querySelector('p')!.firstChild!; const range = document.createRange();
          range.selectNodeContents(node); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
        await mini.getByRole('button', { name: '粗体' }).click();
        await page.evaluate(() => (window as any).miniFixture.hold());
        await mini.locator('.standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniFixture.calls.some((x: any) => x.method === 'turn/start'));
        const pending = await page.evaluate(async () => ({ target: (window as any).miniFixture.controller().target(),
          state: await (window as any).miniFixture.records(), calls: (window as any).miniFixture.calls }));
        const intent: any = Object.values(pending.state.requests)[0];
        assert.equal(intent.stage, 'sending'); assert.equal(intent.documentPlainTextMode, false);
        assert.equal(intent.draft.document.content[0].content[0].marks[0].type, 'strong');
        const start = pending.calls.find((x: any) => x.method === 'thread/start');
        assert.equal(start.hostId, 'remote'); assert.equal(start.params.cwd, '/fixture/remote');
        assert.equal(start.params.model, 'fixture-model'); assert.equal(start.params.approvalPolicy, 'on-request');
        assert.equal(start.params.sandbox, 'workspace-write');
        assert.equal(pending.calls.find((x: any) => x.method === 'turn/start').params.input[0].text, '**created rich**');
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('local', 'thread-a')), false);
        assert.equal(pending.target.threadId, null);
        await page.evaluate(() => (window as any).miniFixture.release());
        await page.waitForFunction(() => (window as any).miniFixture.controller()?.target().threadId === 'created-1');
        await page.waitForFunction(async () => !Object.keys((await (window as any).miniFixture.records()).requests).length);
        const target = await page.evaluate(() => (window as any).miniFixture.controller().target());
        assert.equal(target.draftId, intent.owner.draftId);
        assert.equal((await page.evaluate(() => (window as any).miniFixture.main())).owner.draftId, 'main-draft');
        await mini.locator('textarea').first().fill('after creation');
        await page.waitForFunction(() => !document.querySelector('.yard-mini-conversation .standalone-composer [role=status]')?.textContent?.includes('正在保存'));
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
        await page.locator('.yard-mini-conversation textarea').first().waitFor();
        await page.waitForFunction(() => (window as any).miniFixture.controller()?.target().threadId === 'created-1');
        await page.waitForFunction(() => (document.querySelector('.yard-mini-conversation textarea') as HTMLTextAreaElement)?.value === 'after creation');
        assert.equal(await page.evaluate(() => (window as any).miniFixture.controller().target().draftId), intent.owner.draftId);
        await page.waitForFunction(async () => (window as any).miniFixture.canDrain());
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', null)), true);
        await page.waitForFunction(() => (window as any).miniFixture.miniReady('remote', null));
        const nextHome = await page.evaluate(() => (window as any).miniFixture.controller().target().draftId);
        assert.notEqual(nextHome, intent.owner.draftId);
        await mini.locator('textarea').first().fill('another home');
        await page.waitForFunction(async () => (window as any).miniFixture.miniDurable('another home'));
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', 'created-1')), true);
        await page.waitForFunction(() => (window as any).miniFixture.miniReady('remote', 'created-1'));
        await page.waitForFunction(() => (document.querySelector('.yard-mini-conversation textarea') as HTMLTextAreaElement)?.value === 'after creation');
        assert.equal(await page.evaluate(() => (window as any).miniFixture.target('remote', null)), true);
        await page.waitForFunction(() => (window as any).miniFixture.miniReady('remote', null));
        assert.equal(await page.evaluate(() => (window as any).miniFixture.controller().target().draftId), nextHome);
        await page.waitForFunction(() => (document.querySelector('.yard-mini-conversation textarea') as HTMLTextAreaElement)?.value === 'another home');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
