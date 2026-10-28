import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    standaloneHarness: {
      calls: { host: { endpoint: string; params: Record<string, unknown> }[]; edits: unknown[]; forks: string[]; files: string[]; copies: string[] };
      stream: () => void;
      finish: (status: string) => void;
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
const require = createRequire(import.meta.url);
test('standalone messages render CLI items and retain interactions while streaming', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
      import { StandaloneMarkdown } from './src/renderer/markdown/StandaloneMarkdown.tsx';
      const calls = { host: [], edits: [], forks: [], files: [], copies: [] };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => calls.copies.push(value) } });
      const gif = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      let retried = false;
      const client = { rpc: async () => { throw Error('unexpected rpc'); }, subscribe: () => () => {},
        host: async (endpoint, params) => { calls.host.push({ endpoint, params });
          if (params.path.endsWith('/retry.gif') && !retried) { retried = true; throw Error('missing image'); }
          return { contentsBase64: gif, mimeType: 'image/gif' };
        } };
      const markdown = '# Result\\n\\nA [source](src/main.ts#L12) and [unsafe](javascript:alert(1)).\\n\\n'
        + '| A | B |\\n| - | - |\\n| 1 | 2 |\\n\\n- [x] done\\n\\nMath $x^2$.\\n\\n'
        + '\`\`\`js\\nconst answer = 42;\\n\`\`\`\\n\\n'
        + '\`\`\`mermaid\\nflowchart LR\\n  A --> B\\n\`\`\`';
      let thread = { id: 'thread', cwd: '/work', name: null, status: { type: 'active', activeFlags: [] }, turns: [
        { id: 'turn-one', status: 'inProgress', items: [
          { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Long user input ' + 'x'.repeat(1250), text_elements: [] },
            { type: 'localImage', path: 'good.gif' }, { type: 'localImage', path: 'retry.gif' }] },
          { id: 'opaque', type: 'userMessage', content: [{ type: 'image', fileId: 'opaque-file' }] },
          { id: 'hooks', type: 'hookPrompt', fragments: [{ text: 'Hook guidance', hookRunId: 'hook-1' }] },
          { id: 'reason', type: 'reasoning', summary: ['Thought summary'], content: ['Reasoning detail'] },
          { id: 'plan', type: 'plan', text: '- Plan step' },
          { id: 'command', type: 'commandExecution', command: 'npm test', cwd: '/work', status: 'inProgress', aggregatedOutput: 'needle-output', exitCode: null },
          { id: 'change', type: 'fileChange', status: 'completed', changes: [{ path: 'src/main.ts', kind: {type:'update', move_path:null}, diff: '+line' }] },
          { id: 'mcp', type: 'mcpToolCall', server: 'tools', tool: 'inspect', status: 'completed', arguments: {a:1}, result: {content:[{type:'text',text:'result'}]} },
          { id: 'dynamic', type: 'dynamicToolCall', namespace: 'custom', tool: 'show', status: 'completed', arguments: {}, contentItems: [{type:'inputText',text:'dynamic result'}], success:true },
          { id: 'search', type: 'webSearch', query: 'test query', action: null, results: [{title:'Example',url:'https://example.test/'}] },
          { id: 'view', type: 'imageView', path: '/work/good.gif' },
          { id: 'collab', type: 'collabAgentToolCall', tool: 'wait', status: 'completed', receiverThreadIds: ['agent'] },
          { id: 'unknown', type: 'futureWidget', payload: 'future data' },
          { id: 'assistant', type: 'agentMessage', text: markdown, phase: 'final_answer', questions: [{title:'Which option?', options:['First','Second']}] },
        ] }
      ] };
      const onEdit = draft => calls.edits.push(draft);
      const onFork = id => calls.forks.push(id);
      const onOpenFile = path => calls.files.push(path);
      const root = createRoot(document.getElementById('root'));
      const render = () => root.render(React.createElement(React.Fragment, null,
        React.createElement(StandaloneMessages, { client, hostId:'ssh-test', thread, onEdit, onFork, onOpenFile }),
        React.createElement('div', {id:'raw'}, React.createElement(StandaloneMarkdown, {client, hostId:'ssh-test', cwd:'/work', allowBasicHtml:true,
          text:'<b>safe</b><script>window.bad = true</script><img src="javascript:alert(1)" onerror="window.bad=true">'}))));
      window.standaloneHarness = { calls, stream() {
        const turn = thread.turns[0];
        thread = {...thread, turns:[{...turn, items:turn.items.map(item => item.id === 'assistant' ? {...item,text:item.text+'\\n\\nStreaming more.'}
          : item.id === 'command' ? {...item,aggregatedOutput:'needle-output\\nsecond line'} : item)}]}; render();
      }, finish(status) { thread = {...thread, turns:[{...thread.turns[0],status,error:status === 'failed' ? {message:'Synthetic failure'} : null}]}; render(); } };
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
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/*', (route) => route.abort());
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<div id="root" style="height:700px"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/messages/standalone-messages.css', import.meta.url), 'utf8').replace(/^@import[^;]+;/, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

    const user = page.locator('[data-message-id="user"]');
    await page.locator('[data-message-id="assistant"]').waitFor();
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.host)).length, 0);
    await user.scrollIntoViewIfNeeded();
    await user.getByRole('button', { name: 'Open good.gif' }).waitFor();
    assert.equal(await user.getByRole('button', { name: 'Open good.gif' }).isVisible(), true);
    await user.getByRole('button', { name: 'Show more' }).click();
    assert.equal(await user.locator('.yard-user-text').evaluate((element) => element.classList.contains('is-collapsed')), false);
    await user.getByRole('button', { name: 'Edit message' }).click();
    await user.getByRole('button', { name: 'Fork from this turn' }).click();
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.edits)).length, 1);
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.forks), ['turn-one']);
    assert.equal(await page.locator('[data-message-id="opaque"] button[aria-label="Edit message"]').isDisabled(), true);
    await page.getByText('Image file ID cannot be resolved by this host.').waitFor();
    await user.getByText('missing image').waitFor();
    await user.getByRole('button', { name: 'Retry' }).click();
    await user.getByRole('button', { name: 'Open retry.gif' }).waitFor();
    const hostCalls = await page.evaluate(() => window.standaloneHarness.calls.host);
    assert.equal(hostCalls[0]?.endpoint, 'read-file-binary');
    assert.equal(hostCalls[0]?.params.hostId, 'ssh-test');
    assert.equal(hostCalls[0]?.params.path, '/work/good.gif');
    await user.getByRole('button', { name: 'Open good.gif' }).click();
    const dialog = page.getByRole('dialog', { name: 'Image preview' });
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('button', { name: 'Next image' }).evaluate((element) => document.activeElement === element), true);
    await dialog.getByRole('button', { name: 'Next image' }).click();
    assert.match(await dialog.innerText(), /retry\.gif 2 \/ 2/);
    await page.keyboard.press('ArrowLeft');
    assert.match(await dialog.innerText(), /good\.gif 1 \/ 2/);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.equal(await user.getByRole('button', { name: 'Open good.gif' }).evaluate((element) => document.activeElement === element), true);

    const assistant = page.locator('[data-message-id="assistant"]');
    assert.equal(await assistant.locator('table').count(), 1);
    assert.equal(await assistant.locator('input[type="checkbox"]:checked').count(), 1);
    assert.ok(await assistant.locator('.katex').count());
    assert.ok(await assistant.locator('.hljs-keyword').count());
    await assistant.getByText('Which option?').waitFor();
    await assistant.getByText('First', { exact: true }).waitFor();
    assert.equal(await assistant.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator('#raw b').innerText(), 'safe');
    assert.equal(await page.locator('#raw script, #raw [onerror]').count(), 0);
    await assistant.getByRole('button', { name: 'source', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.files), ['/work/src/main.ts']);
    await assistant.getByRole('button', { name: 'Copy code' }).first().click();
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.copies)).at(-1), 'const answer = 42;');
    await assistant.locator('.yard-mermaid svg').waitFor({ timeout: 30_000 });
    await assistant.getByRole('button', { name: 'Show source' }).click();

    const command = page.locator('[data-message-id="command"] details');
    await command.locator('summary').click();
    await page.evaluate(() => {
      const scroller = document.querySelector('.yard-message-scroll')!;
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll'));
    });
    await page.getByRole('button', { name: 'Latest' }).waitFor();
    await page.evaluate(() => window.standaloneHarness.stream());
    await page.getByText('Streaming more.').waitFor();
    assert.equal(await command.getAttribute('open'), '');
    assert.match(await command.innerText(), /second line/);
    assert.equal(await assistant.getByRole('button', { name: 'Show diagram' }).count(), 1);
    assert.equal(await page.locator('.yard-message-scroll').evaluate((element) => element.scrollTop), 0);
    await page.locator('[data-message-id="change"] summary').click();
    await page.locator('[data-message-id="change"]').getByRole('button', { name: 'src/main.ts' }).click();
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.files)).at(-1), '/work/src/main.ts');
    assert.match(await page.locator('[data-message-id="unknown"]').innerText(), /Unknown item: futureWidget/);
    await command.locator('summary').click();
    await page.getByRole('textbox', { name: 'Search messages' }).fill('needle-output');
    await page.getByRole('textbox', { name: 'Search messages' }).press('Enter');
    assert.equal(await command.getAttribute('open'), '');
    assert.equal(await page.locator('[data-search-current="true"]').getAttribute('data-message-id'), 'command');
    const reasoning = page.locator('[data-message-id="reason"] details');
    assert.equal(await reasoning.getAttribute('open'), null);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await reasoning.getAttribute('open'), '');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await reasoning.getAttribute('open'), null);
    assert.equal(await command.getAttribute('open'), '');
    await page.evaluate(() => window.standaloneHarness.finish('failed'));
    await page.getByRole('alert').getByText('Synthetic failure', { exact: false }).waitFor();
    await page.getByRole('textbox', { name: 'Search messages' }).fill('Synthetic failure');
    await page.getByRole('textbox', { name: 'Search messages' }).press('Enter');
    assert.equal(await page.locator('[data-search-current="true"]').getByText('Synthetic failure', { exact: false }).count(), 1);
    await page.evaluate(() => window.standaloneHarness.finish('interrupted'));
    await page.getByText('Interrupted', { exact: true }).waitFor();
    await page.setViewportSize({ width: 375, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});
