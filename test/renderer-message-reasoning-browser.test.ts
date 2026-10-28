import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    reasoningHarness: {
      update: (status: 'inProgress' | 'completed' | 'failed', summary: string, content: string) => void;
      forks: string[];
      copies: string[];
    };
  }
}

const require = createRequire(import.meta.url);
test('standalone reasoning retains disclosure and updates as the turn changes', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneMessages} from './src/renderer/messages/StandaloneMessages.tsx';
      const client = {rpc:async () => {throw Error('Unexpected RPC');}, reply:async () => {},
        subscribe:() => () => {}, host:async () => {throw Error('Unexpected host operation');}};
      let thread = {id:'thread',cwd:'/work',status:{type:'active',activeFlags:[]},turns:[
        {id:'turn',status:'inProgress',itemsView:'full',items:[
          {id:'reason',type:'reasoning',summary:['Initial thought'],content:['Initial detail']},
          {id:'answer',type:'agentMessage',text:'Partial answer',memoryCitation:{path:'/notes/memory.md',lineStart:3,note:'saved detail'}}
        ]}
      ]};
      const root = createRoot(document.getElementById('root'));
      const forks = [], copies = [];
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => copies.push(text)}});
      const render = () => root.render(<StandaloneMessages client={client} hostId="fixture" thread={thread}
        onFork={turn => forks.push(turn)}/>);
      window.reasoningHarness = {forks,copies,update(status,summary,content) {
        thread = {...thread,turns:thread.turns.map(turn => ({...turn,status,
          error:status === 'failed' ? {message:'Synthetic failure'} : null,
          items:turn.items.map(item => item.id === 'reason' ? {...item,summary:[summary],content:[content]} : item) }))};
        render();
      }};
      render();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }],
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

    const reason = page.locator('[data-message-id="reason"] details');
    await reason.locator('summary').getByText('Initial thought').waitFor();
    assert.equal(await reason.getAttribute('open'), null);
    assert.equal(await page.getByRole('status').getByText('In progress').isVisible(), true);
    await reason.locator('summary').click();
    await reason.getByText('Initial detail').waitFor();
    await page.evaluate(() => window.reasoningHarness.update('inProgress', 'Updated thought', 'Updated **detail**'));
    await reason.getByText('Updated thought').waitFor();
    assert.equal(await reason.getAttribute('open'), '');
    assert.equal(await reason.locator('strong').textContent(), 'detail');

    const answer = page.locator('[data-message-id="answer"]');
    const citation = answer.locator('details').filter({ hasText: 'Memory citations' });
    await citation.locator('summary').click();
    assert.match(await citation.locator('pre').textContent() ?? '', /\/notes\/memory\.md/);
    assert.match(await citation.locator('pre').textContent() ?? '', /saved detail/);
    await answer.getByRole('button', { name: 'Copy message' }).click();
    assert.deepEqual(await page.evaluate(() => window.reasoningHarness.copies), ['Partial answer']);
    await answer.getByRole('button', { name: 'Fork from this turn' }).click();
    await page.waitForFunction(() => window.reasoningHarness.forks.length === 1);
    assert.deepEqual(await page.evaluate(() => window.reasoningHarness.forks), ['turn']);

    await page.evaluate(() => window.reasoningHarness.update('failed', 'Failed thought', 'Preserved detail'));
    await page.getByRole('alert').getByText('Failed: Synthetic failure').waitFor();
    await reason.getByText('Preserved detail').waitFor();
    await page.evaluate(() => window.reasoningHarness.update('completed', 'Final thought', 'Final detail'));
    await reason.getByText('Final detail').waitFor();
    assert.equal(await page.getByRole('status').getByText('In progress').count(), 0);
    await reason.locator('summary').click();
    assert.equal(await reason.getAttribute('open'), null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
