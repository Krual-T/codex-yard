import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
test('standalone long messages are searchable and expand for print', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneMessages} from './src/renderer/messages/StandaloneMessages.tsx';
      const client = {rpc:async () => {throw Error('Unexpected RPC');}, reply:async () => {},
        subscribe:() => () => {}, host:async () => {throw Error('Unexpected host operation');}};
      const text = 'long message '.repeat(300) + 'unique-end-marker';
      const thread = {id:'thread',cwd:'/work',status:{type:'idle'},turns:[{id:'turn',status:'completed',itemsView:'full',items:[
        {id:'user',type:'userMessage',content:[{type:'text',text,text_elements:[]}]}
      ]}]};
      createRoot(document.getElementById('root')).render(<StandaloneMessages client={client} hostId="fixture" thread={thread}/>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }],
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root" style="height:650px"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/messages/standalone-messages.css', import.meta.url), 'utf8').replace(/^@import[^;]+;/, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

    const message = page.locator('[data-message-id="user"]');
    const body = message.locator('.yard-user-text');
    await message.getByRole('button', { name: 'Show more' }).waitFor();
    assert.equal(await body.evaluate(element => element.classList.contains('is-collapsed')), true);
    const search = page.getByRole('textbox', { name: 'Search messages' });
    await search.fill('unique-end-marker');
    await search.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-message-id="user"]')?.hasAttribute('data-search-current'));
    assert.equal(await body.evaluate(element => element.classList.contains('is-collapsed')), false);
    assert.equal(await body.getByText('unique-end-marker', { exact: false }).count(), 1);
    await page.getByRole('button', { name: 'Clear search' }).click();
    assert.equal(await body.evaluate(element => element.classList.contains('is-collapsed')), true);

    await page.emulateMedia({ media: 'print' });
    assert.equal(await body.evaluate(element => getComputedStyle(element).maxHeight), 'none');
    assert.equal(await page.getByRole('button', { name: 'Show more' }).isVisible(), false);
    await page.emulateMedia({ media: 'screen' });
    await message.getByRole('button', { name: 'Show more' }).click();
    assert.equal(await body.evaluate(element => element.classList.contains('is-collapsed')), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
