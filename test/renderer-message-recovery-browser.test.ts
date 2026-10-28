import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    recoveryHarness: {
      calls: { edits: { draft: { input: Record<string, unknown>[] }; origin: unknown }[]; writes: string[]; skippedClears: number };
      saved: () => { draft: { input: Record<string, unknown>[] }; origin: unknown; editor: { sessionId: string; revision: number; edits: { text: string }[] } } | null;
      saveMode: (mode: string) => void;
      editMode: (mode: string) => void;
      clearMode: (mode: string) => void;
      saving: () => boolean;
      releaseSave: () => void;
      canResolve: () => boolean;
      resolveEdit: () => void;
      rejectEdit: () => void;
      show: (visible: boolean) => void;
      host: (host: string) => void;
      thread: (thread: string) => void;
      removeTurn: () => void;
      restoreThread: () => void;
      supersede: () => void;
      restoreMinimal: () => void;
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
const require = createRequire(import.meta.url);
const artifacts = process.env.YARD_MESSAGE_TEST_SCREENSHOTS;

test('inline edit recovery retains unsafe text and delegates rollback retries', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
      const calls = { edits: [], writes: [], skippedClears: 0 };
      const client = { rpc: async () => { throw Error('unexpected rpc'); }, host: async () => { throw Error('unexpected host call'); },
        subscribe: () => () => {}, reply: async () => { throw Error('unexpected approval'); } };
      let hostId = 'host-a', visible = true, saved = null, saveMode = 'ok', editMode = 'reject', clearMode = 'ok', rejectEdit, resolveEdit, releaseSave;
      let thread = { id:'thread-a', cwd:'/work', name:null, status:{type:'idle'}, turns:[{id:'turn-a',status:'completed',itemsView:'full',items:[
        { id:'user-a', type:'userMessage', content:[
          {type:'text',text:'Reference',text_elements:[{byteRange:{start:0,end:9},placeholder:'Reference',context:{browser:'fixture'}}]},
          {type:'image',fileId:'image-a',detail:'high'}] },
        { id:'agent-a', type:'agentMessage', text:'# Result\\n\\nReadable [link](https://example.test)\\n\\n\`\`\`js\\nconst value = "ok";\\n\`\`\`' }
      ]}] };
      const initialThread = structuredClone(thread);
      const onEditDraftChange = async (value, origin, version) => {
        if (saveMode === 'hold') { saveMode = 'ok'; await new Promise(resolve => { releaseSave = resolve; }); }
        if (saveMode === 'fail' || (!value && clearMode === 'fail')) throw Error('Synthetic storage failure');
        if (!value && saved && (saved.editor.sessionId !== version.sessionId || saved.editor.revision !== version.revision)) {
          calls.skippedClears++; return;
        }
        calls.writes.push(value?.editor?.edits?.[0]?.text ?? 'clear');
        saved = value && structuredClone(value);
      };
      const onEdit = (draft, origin) => {
        calls.edits.push({draft:structuredClone(draft),origin:structuredClone(origin)});
        if (editMode === 'reject') return Promise.reject(Error('Synthetic edit failure'));
        if (editMode === 'pending') return new Promise((resolve, reject) => { resolveEdit = resolve; rejectEdit = reject; });
        return Promise.resolve();
      };
      const root = createRoot(document.getElementById('root'));
      function render() { root.render(visible ? React.createElement(StandaloneMessages, { client, hostId, thread, onEdit, editHistory:{order:'ascending',tailComplete:true},
        editRecovery:saved, onEditDraftChange }) : null); }
      window.recoveryHarness = { calls, saved:() => saved, saveMode(value) { saveMode = value; }, editMode(value) { editMode = value; },
        clearMode(value) { clearMode = value; }, saving() { return !!releaseSave; }, releaseSave() { releaseSave(); releaseSave = undefined; },
        canResolve() { return !!resolveEdit; }, resolveEdit() { resolveEdit(); resolveEdit = undefined; },
        rejectEdit() { rejectEdit(Error('Synthetic rollback completed; start failed')); resolveEdit = undefined; },
        show(value) { visible = value; render(); }, host(value) { hostId = value; render(); },
        thread(value) { thread = {...thread,id:value}; render(); },
        removeTurn() { thread = {...thread,turns:[]}; render(); }, restoreThread() { thread = structuredClone(initialThread); render(); },
        supersede() { saved = structuredClone(saved); saved.editor.sessionId = 'newer-session'; saved.editor.revision++; },
        restoreMinimal() { const previous = calls.edits.at(-1); saved = structuredClone({draft:previous.draft, origin:previous.origin});
          thread = {...thread,turns:[]}; render(); } };
      render();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }],
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    await page.route('**/*', (route) => route.abort());
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<div id="root" style="height:680px"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/messages/standalone-messages.css', import.meta.url), 'utf8').replace(/^@import[^;]+;/, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const user = page.locator('[data-message-id="user-a"]');
    await user.getByRole('button', { name: 'Edit message' }).waitFor();

    for (const theme of [
      { name: 'dark', bg: '#181818', fg: '#ffffff', surface: '#212121', muted: '#ababab', border: '#444444', accent: '#339cff', added: '#40c977', removed: '#fa423e', skill: '#ad7bf9', expectedFg: 'rgb(255, 255, 255)', expectedBg: 'rgb(24, 24, 24)' },
      { name: 'light', bg: '#ffffff', fg: '#1a1c1f', surface: '#f6f6f6', muted: '#666666', border: '#cccccc', accent: '#339cff', added: '#00a240', removed: '#ba2623', skill: '#924ff7', expectedFg: 'rgb(26, 28, 31)', expectedBg: 'rgb(255, 255, 255)' },
    ]) {
      await page.evaluate((value) => {
        const style = document.documentElement.style;
        for (const [key, color] of Object.entries({ bg:value.bg, fg:value.fg, surface:value.surface, muted:value.muted,
          border:value.border, accent:value.accent, 'diff-added':value.added, 'diff-removed':value.removed, skill:value.skill, danger:value.removed })) {
          style.setProperty(`--yard-${key}`, color);
        }
        style.setProperty('--yard-content-font', 'Georgia, serif');
        style.setProperty('--yard-code-font', 'monospace');
        style.setProperty('--yard-code-size', '17px');
      }, theme);
      assert.equal(await page.locator('.yard-messages-root').evaluate((element) => getComputedStyle(element).color), theme.expectedFg);
      assert.equal(await page.locator('.yard-messages-root').evaluate((element) => getComputedStyle(element).backgroundColor), theme.expectedBg);
      assert.match(await page.locator('.yard-messages-root').evaluate((element) => getComputedStyle(element).fontFamily), /Georgia/);
      await page.locator('.yard-code-block pre').waitFor();
      assert.equal(await page.locator('.yard-code-block pre').evaluate((element) => getComputedStyle(element).fontSize), '17px');
      await user.getByRole('button', { name: 'Edit message' }).click();
      assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).evaluate((element) => getComputedStyle(element).color), theme.expectedFg);
      assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).evaluate((element) => getComputedStyle(element).backgroundColor), theme.expectedBg);
      if (artifacts) await page.screenshot({ path: join(artifacts, `standalone-b-recovery-${theme.name}.png`) });
      await user.getByRole('button', { name: 'Cancel' }).click();
      await user.getByRole('button', { name: 'Edit message' }).waitFor();
    }

    const priorWrites = (await page.evaluate(() => window.recoveryHarness.calls.writes)).length;
    await page.evaluate(() => window.recoveryHarness.saveMode('hold'));
    await user.getByRole('button', { name: 'Edit message' }).click();
    await page.waitForFunction(() => window.recoveryHarness.saving());
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('First Reference');
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Latest Reference');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    assert.equal((await page.evaluate(() => window.recoveryHarness.calls.edits)).length, 0);
    await page.evaluate(() => window.recoveryHarness.releaseSave());
    await user.getByText('Synthetic edit failure').waitFor();
    assert.deepEqual((await page.evaluate(() => window.recoveryHarness.calls.writes)).slice(priorWrites),
      ['Reference', 'Latest Reference', 'Latest Reference']);
    await user.getByRole('button', { name: 'Cancel' }).click();
    await user.getByRole('button', { name: 'Edit message' }).waitFor();

    await page.evaluate(() => window.recoveryHarness.saveMode('fail'));
    await user.getByRole('button', { name: 'Edit message' }).click();
    await user.getByText('Could not save the edit recovery:', { exact: false }).waitFor();
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Prefix Reference');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByText('Synthetic storage failure', { exact: false }).first().waitFor();
    assert.equal((await page.evaluate(() => window.recoveryHarness.calls.edits)).length, 1);

    await page.evaluate(() => window.recoveryHarness.saveMode('ok'));
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Other Reference');
    await page.waitForFunction(() => window.recoveryHarness.saved()?.editor.edits[0]?.text === 'Other Reference');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByText('Synthetic edit failure').waitFor();
    const first = (await page.evaluate(() => window.recoveryHarness.calls.edits)).at(-1)!;
    assert.deepEqual(first.origin, { hostId:'host-a', threadId:'thread-a', turnId:'turn-a', itemId:'user-a' });
    assert.deepEqual(first.draft.input[1], { type:'image', fileId:'image-a', detail:'high' });
    assert.deepEqual(first.draft.input[0]?.text_elements, [{ byteRange:{start:6,end:15}, placeholder:'Reference', context:{browser:'fixture'} }]);

    await user.getByRole('textbox', { name: 'Edit message text' }).fill('corrupt');
    await page.waitForFunction(() => window.recoveryHarness.saved()?.editor.edits[0]?.text === 'corrupt');
    assert.equal((await page.evaluate(() => window.recoveryHarness.saved()))?.draft.input[0]?.text, 'Reference');
    await page.evaluate(() => window.recoveryHarness.show(false));
    await page.locator('.yard-messages-root').waitFor({ state:'detached' });
    await page.evaluate(() => { window.recoveryHarness.host('host-b'); window.recoveryHarness.show(true); });
    await user.getByRole('button', { name: 'Edit message' }).waitFor();
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).count(), 0);
    await page.evaluate(() => { window.recoveryHarness.thread('thread-b'); window.recoveryHarness.host('host-a'); });
    await user.getByRole('button', { name: 'Edit message' }).waitFor();
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).count(), 0);
    await page.evaluate(() => window.recoveryHarness.thread('thread-a'));
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'corrupt');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByText('overlaps a reference', { exact: false }).waitFor();

    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Prefix Reference');
    await page.evaluate(() => window.recoveryHarness.editMode('pending'));
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByRole('button', { name: 'Sending...' }).waitFor();
    await page.evaluate(() => window.recoveryHarness.removeTurn());
    await user.getByText('The original message is no longer available.', { exact:false }).waitFor();
    await page.evaluate(() => window.recoveryHarness.rejectEdit());
    await user.getByText('Synthetic rollback completed; start failed').waitFor();
    assert.equal(await user.getByRole('button', { name: 'Send', exact: true }).isEnabled(), true);
    await page.evaluate(() => window.recoveryHarness.show(false));
    await page.locator('.yard-messages-root').waitFor({ state:'detached' });
    await page.evaluate(() => window.recoveryHarness.show(true));
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'Prefix Reference');
    await page.evaluate(() => { window.recoveryHarness.editMode('resolve'); window.recoveryHarness.clearMode('fail'); });
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByText('The edit was sent, but its recovery could not be cleared', { exact:false }).waitFor();
    const editCount = (await page.evaluate(() => window.recoveryHarness.calls.edits)).length;
    assert.equal(await user.getByRole('button', { name: 'Send', exact: true }).count(), 0);
    await page.evaluate(() => window.recoveryHarness.clearMode('ok'));
    await user.getByRole('button', { name: 'Clear recovery' }).click();
    await page.getByText('No messages yet').waitFor();
    assert.equal((await page.evaluate(() => window.recoveryHarness.calls.edits)).length, editCount);
    assert.equal(await page.evaluate(() => window.recoveryHarness.saved()), null);

    await page.evaluate(() => { window.recoveryHarness.restoreThread(); window.recoveryHarness.editMode('pending'); });
    await user.getByRole('button', { name: 'Edit message' }).click();
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Last Reference');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.recoveryHarness.canResolve());
    await page.evaluate(() => { window.recoveryHarness.supersede(); window.recoveryHarness.resolveEdit(); });
    await user.getByRole('button', { name: 'Edit message' }).waitFor();
    assert.equal(await page.evaluate(() => window.recoveryHarness.calls.skippedClears), 1);
    assert.equal((await page.evaluate(() => window.recoveryHarness.saved()))?.editor.sessionId, 'newer-session');
    await page.evaluate(() => window.recoveryHarness.show(false));
    await page.locator('.yard-messages-root').waitFor({ state:'detached' });
    await page.evaluate(() => { window.recoveryHarness.restoreMinimal(); window.recoveryHarness.show(true); });
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'Last Reference');
    await page.waitForFunction(() => !!window.recoveryHarness.saved()?.editor?.sessionId);
    await user.getByRole('button', { name: 'Cancel' }).click();
    await page.getByText('No messages yet').waitFor();
    assert.equal(await page.evaluate(() => window.recoveryHarness.saved()), null);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
