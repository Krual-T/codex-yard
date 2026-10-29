import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    messageParity: { showUser(value: boolean): void; showAssistant(value: boolean): void; failFork(value: boolean): void;
      forks: string[]; copies: string[]; edits: unknown[] };
  }
}

const require = createRequire(import.meta.url);
test('message presentation keeps compact original actions and searchable editing', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
    const calls = { forks: [], copies: [], edits: [] };
    let failFork = false;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => calls.copies.push(value) } });
    const client = { rpc: async () => { throw Error('unexpected RPC'); }, reply: async () => {},
      host: async () => { throw Error('unexpected host operation'); }, subscribe: () => () => {} };
    function Fixture() {
      const [searchOpen, setSearchOpen] = React.useState(false);
      const [user, setUser] = React.useState(false);
      const [assistant, setAssistant] = React.useState(true);
      window.messageParity = { ...calls, showUser: setUser, showAssistant: setAssistant, failFork: value => { failFork = value; } };
      document.getElementById('open-search').onclick = () => setSearchOpen(true);
      const items = [];
      if (user) items.push({ id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Synthetic user question', text_elements: [] }] });
      if (assistant) items.push({ id: 'answer', type: 'agentMessage', text: 'UI parity fixture reply' });
      const thread = { id: 'thread', cwd: '/work', status: { type: 'idle' }, turns: [{ id: 'turn', status: 'completed', itemsView: 'full', items }] };
      const onEdit = async (draft, origin, prepare) => { await prepare(); calls.edits.push({ draft, origin }); };
      return <StandaloneMessages client={client} hostId="local" thread={thread} editHistory={{ order: 'ascending', tailComplete: true }}
        searchOpen={searchOpen} onSearchOpenChange={setSearchOpen} onEdit={onEdit} onFork={id => {
          calls.forks.push(id); if (failFork) throw Error('Synthetic fork failed');
        }} />;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'single-katex', setup(builder) { builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') })); } }] });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    await page.route('**/*', route => route.abort());
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<style>
      body { margin: 0; } #root { position: absolute; left: 340px; right: 0; top: 46px; height: 600px; }
      :root { --yard-bg: #fff; --yard-fg: #1a1c1f; --yard-muted: #858585; --yard-panel: #f3f3f4; --yard-surface: #f9f9f9;
        --yard-border: #e3e3e3; --yard-font-size: 14px; --yard-content-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      :root[data-theme='dark'] { --yard-bg: #181818; --yard-fg: #ececec; --yard-muted: #969696; --yard-panel: #272727; --yard-surface: #202020; --yard-border: #343434; }
      @media (max-width: 600px) { #root { left: 0; } }
    </style><button id="open-search">Find</button><div id="root"></div>`);
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/messages/standalone-messages.css', import.meta.url), 'utf8').replace(/^@import[^;]+;/, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const answer = page.locator('[data-message-id="answer"]');
    await answer.getByText('UI parity fixture reply').waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Search messages' }).count(), 0);
    assert.equal(await answer.locator('.yard-message-label').count(), 0);
    assert.equal(await answer.getByRole('heading', { name: 'ChatGPT said:' }).count(), 1);
    const box = await answer.locator('.yard-markdown p').boundingBox();
    assert.ok(box && Math.abs(box.x - 442) < 1 && Math.abs(box.y - 78) < 2 && box.width <= 736);
    const typography = await answer.locator('.yard-markdown p').evaluate((element) => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight };
    });
    assert.deepEqual(typography, { size: '14px', lineHeight: '22.75px', weight: '430' });
    assert.equal(await answer.getByRole('button', { name: 'Copy', exact: true }).count(), 1);
    assert.equal(await answer.getByRole('button', { name: 'More actions' }).count(), 1);
    assert.equal(await answer.getByRole('button', { name: 'Fork from this turn' }).count(), 0);
    const artifacts = process.env.YARD_TEST_ARTIFACTS;
    if (artifacts) { mkdirSync(artifacts, { recursive: true }); await page.locator('.yard-messages-root').screenshot({ path: join(artifacts, 'message-light.png') }); }
    await answer.getByRole('button', { name: 'Copy', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.messageParity.copies), ['UI parity fixture reply']);
    const more = answer.getByRole('button', { name: 'More actions' });
    await more.click();
    await answer.getByRole('menuitem', { name: 'Fork chat from here' }).press('Escape');
    assert.equal(await more.evaluate(element => document.activeElement === element), true);
    await page.evaluate(() => window.messageParity.failFork(true));
    await more.click();
    await answer.getByRole('menuitem', { name: 'Fork chat from here' }).click();
    await answer.getByRole('alert').getByText('Synthetic fork failed').waitFor();
    await page.evaluate(() => window.messageParity.failFork(false));
    await more.click();
    await answer.getByRole('menuitem', { name: 'Fork chat from here' }).click();
    await page.waitForFunction(() => window.messageParity.forks.length === 2);
    assert.deepEqual(await page.evaluate(() => window.messageParity.forks), ['turn', 'turn']);
    assert.equal(await answer.getByRole('alert').count(), 0);
    await page.locator('#open-search').click();
    const search = page.getByRole('textbox', { name: 'Search messages' });
    await search.fill('fixture reply'); await search.press('Enter');
    assert.equal(await answer.getAttribute('data-search-current'), 'true');
    await search.press('Escape');
    assert.equal(await search.count(), 0);
    assert.equal(await page.locator('#open-search').evaluate(element => document.activeElement === element), true);
    assert.equal(await answer.getAttribute('data-search-current'), null);
    assert.equal(await page.getByRole('button', { name: 'Latest' }).count(), 0);
    await page.evaluate(() => window.messageParity.showUser(true));
    const user = page.locator('[data-message-id="user"]');
    await user.getByText('Synthetic user question').waitFor();
    const bubble = await user.locator('.yard-user-bubble').boundingBox();
    assert.ok(bubble && bubble.width < 250 && Math.abs(bubble.height - 42.75) < 1
      && Math.abs(bubble.x + bubble.width - 1178) < 2);
    assert.equal(await user.getByRole('heading', { name: 'You said:' }).count(), 1);
    assert.equal(await user.getByRole('button', { name: 'Fork from this turn' }).count(), 0);
    await user.hover();
    await user.getByRole('button', { name: 'Edit message' }).click();
    const editor = user.getByRole('textbox', { name: 'Edit message text' });
    await editor.fill('Edited question');
    await editor.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'f', ctrlKey: true, keyCode: 229, isComposing: true, bubbles: true })));
    assert.equal(await search.count(), 0);
    await editor.press('Control+f');
    await search.waitFor(); await search.press('Escape');
    assert.equal(await editor.evaluate(element => document.activeElement === element), true);
    assert.equal(await editor.inputValue(), 'Edited question');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.messageParity.edits.length === 1);
    assert.equal((await page.evaluate(() => window.messageParity.edits) as { draft: { text: string } }[])[0]?.draft.text, 'Edited question');
    await page.evaluate(() => window.messageParity.showAssistant(false));
    await user.getByRole('button', { name: 'Fork from this turn' }).click();
    await page.waitForFunction(() => window.messageParity.forks.length === 3);
    assert.deepEqual(await page.evaluate(() => window.messageParity.forks), ['turn', 'turn', 'turn']);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.messageParity.showAssistant(true); });
    if (artifacts) await page.locator('.yard-messages-root').screenshot({ path: join(artifacts, 'message-dark.png') });
    await page.setViewportSize({ width: 375, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (artifacts) await page.locator('.yard-messages-root').screenshot({ path: join(artifacts, 'message-narrow.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
