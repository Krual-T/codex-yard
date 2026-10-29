import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    standaloneHarness: {
      calls: { host: { endpoint: string; params: Record<string, unknown> }[]; edits: unknown[]; forks: string[]; files: string[];
        locations: unknown[]; visualizations: unknown[]; browser: unknown[]; copies: string[] };
      stream: () => void;
      finish: (status: string) => void;
      editMode: (mode: 'reject' | 'pending' | 'resolve') => void;
      resolveEdit: () => void;
      rejectEdit: () => void;
      setBusy: (busy: boolean) => void;
      setItemsView: (view: string) => void;
      changeSource: () => void;
      enableEdit: (enabled: boolean) => void;
      usePlainThread: () => void;
      setHost: (host: string) => void;
      navigateAway: () => void;
      navigateBack: () => void;
      removeTurn: () => void;
      clipboard: (mode: 'missing' | 'denied' | 'failed') => void;
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
      const calls = { host: [], edits: [], forks: [], files: [], locations: [], visualizations: [], browser: [], copies: [] };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => calls.copies.push(value) } });
      const gif = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      let retried = false;
      const client = { rpc: async () => { throw Error('unexpected rpc'); }, subscribe: () => () => {},
        reply: async () => { throw Error('unexpected approval'); },
        host: async (endpoint, params) => { calls.host.push({ endpoint, params });
          if (params.path.endsWith('/retry.gif') && !retried) { retried = true; throw Error('missing image'); }
          return { contentsBase64: gif, mimeType: 'image/gif' };
        } };
      const directive = String.fromCodePoint(0xe200) + 'visualize' + String.fromCodePoint(0xe202)
        + JSON.stringify({path:'/work/reports/view.html',mode:'wide'}) + String.fromCodePoint(0xe201);
      const directiveWithMarkup = String.fromCodePoint(0xe200) + 'visualize' + String.fromCodePoint(0xe202)
        + 'view.html' + String.fromCodePoint(0xe201);
      const invalidDirective = String.fromCodePoint(0xe200) + 'visualize' + String.fromCodePoint(0xe202)
        + JSON.stringify({path:String.fromCharCode(0xd800)}) + String.fromCodePoint(0xe201);
      const markdown = '# Result\\n\\nA [source](src/main.ts#L12C3), [unsafe](javascript:alert(1)) and [spoof](yard-visualization:%2Fnot-real).\\n\\n'
        + '| A | B |\\n| - | - |\\n| 1 | 2 |\\n\\n- [x] done\\n\\nMath $x^2$.\\n\\n'
        + '\`\`\`js\\nconst answer = 42;\\n\`\`\`\\n\\n'
        + '\`\`\`mermaid\\nflowchart LR\\n  A --> B\\n\`\`\`\\n\\n' + directive + ' ' + directiveWithMarkup
        + '\\n\\n' + invalidDirective + '\\n\\n\`\`\`text\\n' + directive + '\\n\`\`\`';
      let thread = { id: 'thread', cwd: '/work', name: null, status: { type: 'idle' }, turns: [
        { id: 'turn-one', status: 'completed', itemsView: 'full', items: [
          { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Long user input ' + 'x'.repeat(1250), text_elements: [] },
            { type: 'localImage', path: 'good.gif' }, { type: 'localImage', path: 'retry.gif' }] },
        ] },
        { id: 'turn-two', status: 'completed', itemsView: 'full', items: [
          { id: 'opaque', type: 'userMessage', format:'markdown', hints:['search'], content: [
            { type: 'text', text:'Before', text_elements:[{byteRange:{start:0,end:6},placeholder:'Before',context:{browser:'element'}}] },
            { type: 'image', fileId: 'opaque-file', detail:'high' },
            { type: 'text', text:'After', text_elements:[] }, {type:'skill',name:'check',path:'/skill'},
            {type:'mention',name:'project',path:'/project'}, {type:'localAudio',path:'/audio.wav'}] },
          { id: 'hooks', type: 'hookPrompt', fragments: [{ text: 'Hook guidance', hookRunId: 'hook-1' }] },
          { id: 'reason', type: 'reasoning', summary: ['Thought summary'], content: ['Reasoning detail'] },
          { id: 'plan', type: 'plan', text: '- Plan step' },
          { id: 'command', type: 'commandExecution', command: 'npm test', cwd: '/work/sub', status: 'inProgress', aggregatedOutput: 'needle-output', exitCode: null,
            commandActions:[{type:'read',command:'cat test.ts',name:'test.ts',path:'test.ts'}] },
          { id: 'change', type: 'fileChange', status: 'completed', changes: [{ path: 'src/main.ts', kind: {type:'update', move_path:null}, diff: '+line' }] },
          { id: 'mcp', type: 'mcpToolCall', server: 'tools', tool: 'inspect', status: 'completed', arguments: {a:1},
            mcpAppUi:{resourceUri:'ui://fixture/panel',preferredModelDisplayMode:'inline'}, result: {content:[{type:'text',text:'result'}]} },
          { id: 'mcp-legacy', type: 'mcpToolCall', server: 'tools', tool: 'legacy', status: 'completed', mcpAppResourceUri:'ui://fixture/old' },
          { id: 'dynamic', type: 'dynamicToolCall', namespace: 'custom', tool: 'show', status: 'completed', arguments: {}, contentItems: [{type:'inputText',text:'dynamic result'}], success:true },
          { id: 'function', type: 'functionCallOutput', name: 'result', namespace: 'custom', output:[
            {type:'input_text',text:'Function result'}, {type:'input_image',file_id:'function-file'}] },
          { id: 'function-future', type: 'functionCallOutput', name: 'future', output:{futureField:'Visible future output'} },
          { id: 'search', type: 'webSearch', query: 'test query', action: {type:'findInPage',url:'https://example.test/page',pattern:'needle'}, results: [{title:'Example',url:'https://example.test/'}] },
          { id: 'view', type: 'imageView', path: '/work/good.gif' },
          { id: 'collab', type: 'collabAgentToolCall', tool: 'wait', status: 'completed', receiverThreadIds: ['agent'],
            agentsStates: {agent:{status:'completed',message:'Found it'}} },
          { id: 'unknown', type: 'futureWidget', payload: 'future data' },
          { id: 'assistant', type: 'agentMessage', text: markdown, phase: 'final_answer', questions: [{title:'Which option?', options:['First','Second']}] },
        ] }
      ] };
      let editMode = 'reject', resolveEdit = () => {}, rejectEdit = () => {}, editEnabled = true, hostId = 'ssh-test', savedThread;
      const onEdit = async (draft, origin, prepare) => {
        await prepare();
        calls.edits.push({draft, origin});
        if (editMode === 'reject') return Promise.reject(Error('Synthetic edit failure'));
        if (editMode === 'pending') return new Promise((resolve, reject) => { resolveEdit = resolve; rejectEdit = reject; });
        return Promise.resolve();
      };
      const onFork = id => calls.forks.push(id);
      const onOpenFile = path => calls.files.push(path);
      const onOpenFileAt = value => calls.locations.push(value);
      const onOpenVisualization = value => calls.visualizations.push(value);
      const onOpenBrowser = value => calls.browser.push(value);
      const root = createRoot(document.getElementById('root'));
      const render = () => root.render(React.createElement(React.Fragment, null,
        React.createElement(StandaloneMessages, { client, hostId, thread, editHistory:{order:'ascending',tailComplete:true}, onEdit:editEnabled ? onEdit : undefined, onFork, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenBrowser }),
        React.createElement('div', {id:'raw'}, React.createElement(StandaloneMarkdown, {client, hostId:'ssh-test', cwd:'/work', allowBasicHtml:true,
          text:'<b>safe</b><script>window.bad = true</script><img src="javascript:alert(1)" onerror="window.bad=true">'})),
        React.createElement('div', {id:'fallback'}, React.createElement(StandaloneMarkdown, {client, hostId:'ssh-test', cwd:'/work', onOpenFile,
          text:'[fallback](rel.ts#L4)'}))));
      window.standaloneHarness = { calls, stream() {
        thread = {...thread, turns:thread.turns.map(turn => turn.id !== 'turn-two' ? turn : {...turn, items:turn.items.map(item => item.id === 'assistant' ? {...item,text:item.text+'\\n\\nStreaming more.'}
          : item.id === 'command' ? {...item,aggregatedOutput:'needle-output\\nsecond line'} : item)})}; render();
      }, finish(status) { thread = {...thread, turns:thread.turns.map(turn => turn.id !== 'turn-two' ? turn : {...turn,status,error:status === 'failed' ? {message:'Synthetic failure'} : null})}; render(); },
      editMode(mode) { editMode = mode; }, resolveEdit() { resolveEdit(); }, rejectEdit() { rejectEdit(Error('Synthetic revert failure')); },
      setBusy(busy) { thread = {...thread,status:busy ? {type:'active',activeFlags:[]} : {type:'idle'}}; render(); },
      setItemsView(view) { thread = {...thread,turns:thread.turns.map(turn => turn.id === 'turn-two' ? {...turn,itemsView:view} : turn)}; render(); },
      changeSource() { thread = {...thread,turns:thread.turns.map(turn => turn.id !== 'turn-two' ? turn : {...turn,items:turn.items.map(item => item.id === 'opaque' ? {...item,hints:['changed'],content:item.content.map(part => part.type === 'skill' ? {...part,name:'changed'} : part)} : item)})}; render(); },
      enableEdit(enabled) { editEnabled = enabled; render(); },
      usePlainThread() { thread = {...thread, status:{type:'idle'}, turns:thread.turns.filter(turn => turn.id === 'turn-one')}; render(); },
      setHost(host) { hostId = host; render(); },
      navigateAway() { savedThread = thread; thread = {...thread, id:'other-thread', turns:[]}; render(); },
      navigateBack() { thread = savedThread; render(); },
      removeTurn() { thread = {...thread,turns:[]}; render(); },
      clipboard(mode) {
        Object.defineProperty(navigator, 'clipboard', { configurable:true, value: mode === 'missing' ? undefined : {writeText:async () => {throw Error('denied')}} });
        document.execCommand = command => { if (command !== 'copy') return false; calls.copies.push(document.activeElement.value); return mode !== 'failed'; };
      } };
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
    assert.equal(await user.getByRole('button', { name: 'Edit message' }).isDisabled(), true);
    await user.getByRole('button', { name: 'Fork from this turn' }).click();
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.edits)).length, 0);
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.forks), ['turn-one']);
    const opaque = page.locator('[data-message-id="opaque"]');
    await opaque.getByRole('button', { name: 'Edit message' }).click();
    await opaque.getByRole('textbox', { name: 'Edit message text 2 of 2' }).fill('Cancelled');
    await opaque.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await opaque.getByRole('button', { name: 'Edit message' }).evaluate((element) => document.activeElement === element), true);
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.edits)).length, 0);
    await opaque.getByRole('button', { name: 'Edit message' }).click();
    await opaque.getByRole('textbox', { name: 'Edit message text 1 of 2' }).press('Escape');
    assert.equal(await opaque.getByRole('button', { name: 'Edit message' }).evaluate((element) => document.activeElement === element), true);
    await opaque.getByRole('button', { name: 'Edit message' }).click();
    await opaque.getByRole('textbox', { name: 'Edit message text 1 of 2' }).fill('中Before');
    await opaque.getByRole('textbox', { name: 'Edit message text 2 of 2' }).fill('After edited');
    await opaque.getByRole('button', { name: 'Send', exact: true }).click();
    await opaque.getByRole('alert').getByText('Synthetic edit failure').waitFor();
    assert.equal(await opaque.getByRole('textbox', { name: 'Edit message text 2 of 2' }).inputValue(), 'After edited');
    await page.evaluate(() => window.standaloneHarness.editMode('pending'));
    await opaque.getByRole('button', { name: 'Send', exact: true }).click();
    await opaque.getByRole('button', { name: 'Sending...' }).waitFor();
    assert.equal(await opaque.getByRole('button', { name: 'Sending...' }).isDisabled(), true);
    assert.equal(await opaque.getByRole('button', { name: 'Cancel' }).isDisabled(), true);
    await page.evaluate(() => window.standaloneHarness.resolveEdit());
    await opaque.getByRole('button', { name: 'Edit message' }).waitFor();
    const edits = await page.evaluate(() => window.standaloneHarness.calls.edits) as { draft: { input: Record<string, unknown>[]; images: { fileId?: string; src: string }[]; skills: unknown[]; hints: unknown[] }; origin: unknown }[];
    assert.equal(edits.length, 2);
    assert.deepEqual(edits[1]?.origin, { hostId: 'ssh-test', threadId: 'thread', turnId: 'turn-two', itemId: 'opaque', format: 'markdown', hints: ['search'] });
    assert.deepEqual(edits[1]?.draft.input, [
      { type: 'text', text: '中Before', text_elements: [{ byteRange: { start: 3, end: 9 }, placeholder: 'Before', context: { browser: 'element' } }] },
      { type: 'image', fileId: 'opaque-file', detail: 'high' }, { type: 'text', text: 'After edited', text_elements: [] },
      { type: 'skill', name: 'check', path: '/skill' }, { type: 'mention', name: 'project', path: '/project' },
      { type: 'localAudio', path: '/audio.wav' },
    ]);
    assert.deepEqual(edits[1]?.draft.images, [{ id: 'image-1', src: '', fileId: 'opaque-file', name: 'Image' }]);
    assert.deepEqual(edits[1]?.draft.skills, [{ name: 'check', path: '/skill' }]);
    assert.deepEqual(edits[1]?.draft.hints, ['search']);
    await page.evaluate(() => window.standaloneHarness.setBusy(true));
    assert.equal(await opaque.getByRole('button', { name: 'Edit message' }).isDisabled(), true);
    await opaque.getByText('Wait for the active turn to finish before editing.').waitFor();
    await page.evaluate(() => window.standaloneHarness.setBusy(false));
    await page.evaluate(() => window.standaloneHarness.setItemsView('summary'));
    assert.equal(await opaque.getByRole('button', { name: 'Edit message' }).isDisabled(), true);
    await page.evaluate(() => window.standaloneHarness.setItemsView('full'));
    await opaque.getByRole('button', { name: 'Edit message' }).click();
    await page.evaluate(() => window.standaloneHarness.changeSource());
    await opaque.getByRole('alert').getByText('This message changed while editing.', { exact: false }).waitFor();
    await opaque.getByText('skill: check', { exact: false }).waitFor();
    assert.equal(await opaque.getByText('skill: changed', { exact: false }).count(), 0);
    assert.equal(await opaque.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    await opaque.getByRole('button', { name: 'Cancel' }).click();
    await opaque.getByRole('button', { name: 'Edit message' }).click();
    await page.evaluate(() => window.standaloneHarness.enableEdit(false));
    await opaque.getByRole('alert').getByText('Message editing is unavailable.').waitFor();
    await opaque.getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(() => window.standaloneHarness.enableEdit(true));
    await opaque.getByText('Image file ID cannot be resolved by this host.').waitFor();
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
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.locations),
      [{ hostId: 'ssh-test', cwd: '/work', path: '/work/src/main.ts', line: 12, column: 3 }]);
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.files), []);
    await page.locator('#fallback').getByRole('button', { name: 'fallback' }).click();
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.files), ['/work/rel.ts']);
    await page.evaluate(() => window.standaloneHarness.clipboard('missing'));
    const copyCode = assistant.getByRole('button', { name: 'Copy code' }).first();
    await copyCode.click();
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.copies)).at(-1), 'const answer = 42;');
    assert.equal(await assistant.getByRole('button', { name: 'Copied' }).first().evaluate((element) => document.activeElement === element), true);
    assert.equal(await assistant.getByRole('button', { name: 'Open visualization' }).count(), 2);
    assert.equal(await assistant.getByRole('button', { name: 'spoof' }).count(), 0);
    await assistant.getByRole('button', { name: 'Open visualization' }).first().click();
    await assistant.getByRole('button', { name: 'Open visualization' }).last().click();
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.visualizations),
      [{ hostId: 'ssh-test', threadId: 'thread', path: '/work/reports/view.html' },
        { hostId: 'ssh-test', threadId: 'thread', path: '/work/view.html' }]);
    await page.evaluate(() => window.standaloneHarness.clipboard('missing'));
    await assistant.getByRole('button', { name: 'Copy', exact: true }).click();
    assert.match((await page.evaluate(() => window.standaloneHarness.calls.copies)).at(-1) ?? '', /^# Result\n\nA \[source\]/);
    await page.evaluate(() => window.standaloneHarness.clipboard('denied'));
    await user.getByRole('button', { name: 'Copy message' }).click();
    assert.equal((await page.evaluate(() => window.standaloneHarness.calls.copies)).at(-1), 'Long user input ' + 'x'.repeat(1250));
    await page.evaluate(() => window.standaloneHarness.clipboard('failed'));
    await opaque.getByRole('button', { name: 'Copy message' }).click();
    await opaque.getByRole('button', { name: 'Copy failed' }).waitFor();
    await assistant.locator('.yard-mermaid svg').waitFor({ timeout: 30_000 });
    await assistant.getByRole('button', { name: 'Show source' }).click();

    const command = page.locator('[data-message-id="command"] details');
    await command.locator('summary').click();
    await command.getByRole('button', { name: 'test.ts' }).click();
    assert.deepEqual((await page.evaluate(() => window.standaloneHarness.calls.locations)).at(-1),
      { hostId: 'ssh-test', cwd: '/work/sub', path: '/work/sub/test.ts' });
    const mcp = page.locator('[data-message-id="mcp"] details');
    await mcp.locator('summary').click();
    await mcp.getByText('Interactive tool view unavailable: ui://fixture/panel (inline)').waitFor();
    const legacyMcp = page.locator('[data-message-id="mcp-legacy"] details');
    await legacyMcp.locator('summary').click();
    await legacyMcp.getByText('Interactive tool view unavailable: ui://fixture/old').waitFor();
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
    assert.deepEqual((await page.evaluate(() => window.standaloneHarness.calls.locations)).at(-1),
      { hostId: 'ssh-test', cwd: '/work', path: '/work/src/main.ts' });
    const search = page.locator('[data-message-id="search"]');
    await search.locator('summary').click();
    await search.getByRole('button', { name: 'https://example.test/page' }).click();
    await search.getByRole('button', { name: 'Example', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.standaloneHarness.calls.browser), [
      { hostId: 'ssh-test', threadId: 'thread', url: 'https://example.test/page' },
      { hostId: 'ssh-test', threadId: 'thread', url: 'https://example.test/' },
    ]);
    await page.locator('[data-message-id="collab"] summary').click();
    assert.match(await page.locator('[data-message-id="collab"]').innerText(), /agent: completed[\s\S]*Found it/);
    const functionResult = page.locator('[data-message-id="function"]');
    await functionResult.locator('summary').click();
    await functionResult.getByText('Function result').waitFor();
    await functionResult.getByText('Image file ID cannot be resolved by this host.').waitFor();
    const futureOutput = page.locator('[data-message-id="function-future"]');
    await futureOutput.locator('summary').click();
    await futureOutput.getByText('Visible future output', { exact: false }).waitFor();
    assert.match(await page.locator('[data-message-id="unknown"]').innerText(), /Unknown item: futureWidget/);
    await command.locator('summary').click();
    await command.locator('summary').press('Control+f');
    await page.getByRole('textbox', { name: 'Search messages' }).fill('needle-output');
    await page.getByRole('textbox', { name: 'Search messages' }).press('Enter');
    assert.equal(await command.getAttribute('open'), '');
    assert.equal(await page.locator('[data-search-current="true"]').getAttribute('data-message-id'), 'command');
    const reasoning = page.locator('[data-message-id="reason"] details');
    assert.equal(await reasoning.getAttribute('open'), null);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await reasoning.getAttribute('open'), '');
    await user.getByRole('button', { name: 'Show less' }).click();
    await page.emulateMedia({ media: 'print' });
    assert.equal(await user.locator('.yard-user-text').evaluate((element) => getComputedStyle(element).maxHeight), 'none');
    assert.equal(await page.locator('.yard-message-search').isVisible(), false);
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await reasoning.getAttribute('open'), null);
    assert.equal(await command.getAttribute('open'), '');
    await page.getByRole('button', { name: 'Clear search' }).click();
    assert.equal(await command.getAttribute('open'), null);
    await command.locator('summary').click();
    await page.getByRole('textbox', { name: 'Search messages' }).fill('needle-output');
    await page.getByRole('textbox', { name: 'Search messages' }).press('Enter');
    await page.getByRole('button', { name: 'Clear search' }).click();
    assert.equal(await command.getAttribute('open'), '');
    await page.evaluate(() => window.standaloneHarness.finish('completed'));
    await page.getByText('Streaming more.').waitFor();
    assert.match(await command.innerText(), /npm test/);
    await page.evaluate(() => window.standaloneHarness.finish('failed'));
    await page.getByRole('alert').getByText('Synthetic failure', { exact: false }).waitFor();
    await page.getByRole('textbox', { name: 'Search messages' }).fill('Synthetic failure');
    await page.getByRole('textbox', { name: 'Search messages' }).press('Enter');
    assert.equal(await page.locator('[data-search-current="true"]').getByText('Synthetic failure', { exact: false }).count(), 1);
    await page.evaluate(() => window.standaloneHarness.finish('interrupted'));
    await page.getByText('Interrupted', { exact: true }).waitFor();
    await page.setViewportSize({ width: 375, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(() => { window.standaloneHarness.editMode('resolve'); window.standaloneHarness.usePlainThread(); });
    await user.getByRole('button', { name: 'Edit message' }).click();
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Updated plain message');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await user.locator('.yard-edit-print-text').innerText(), 'Updated plain message');
    assert.equal(await user.getByRole('button', { name: 'Send', exact: true }).isVisible(), false);
    await page.emulateMedia({ media: 'screen' });
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByRole('button', { name: 'Edit message' }).waitFor();
    const lastEdit = (await page.evaluate(() => window.standaloneHarness.calls.edits)).at(-1) as { origin: unknown; draft: { input: unknown[] } };
    assert.deepEqual(lastEdit.origin, { hostId: 'ssh-test', threadId: 'thread', turnId: 'turn-one', itemId: 'user' });
    assert.deepEqual(lastEdit.draft.input, [{ type: 'text', text: 'Updated plain message', text_elements: [] },
      { type: 'localImage', path: 'good.gif' }, { type: 'localImage', path: 'retry.gif' }]);
    await user.getByRole('button', { name: 'Open good.gif' }).click();
    await page.getByRole('dialog', { name: 'Image preview' }).waitFor();
    await page.evaluate(() => window.standaloneHarness.setHost('ssh-other'));
    await page.getByRole('dialog', { name: 'Image preview' }).waitFor({ state: 'hidden' });
    await user.getByRole('button', { name: 'Edit message' }).click();
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Retained while switching threads');
    await page.evaluate(() => window.standaloneHarness.navigateAway());
    await page.getByText('No messages yet').waitFor();
    await page.evaluate(() => window.standaloneHarness.navigateBack());
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'Retained while switching threads');
    await page.evaluate(() => window.standaloneHarness.editMode('pending'));
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByRole('button', { name: 'Sending...' }).waitFor();
    await page.evaluate(() => window.standaloneHarness.navigateAway());
    await page.getByText('No messages yet').waitFor();
    await page.evaluate(() => window.standaloneHarness.rejectEdit());
    await page.evaluate(() => window.standaloneHarness.navigateBack());
    await user.getByText('Synthetic revert failure').waitFor();
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'Retained while switching threads');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByRole('button', { name: 'Sending...' }).waitFor();
    await page.evaluate(() => window.standaloneHarness.removeTurn());
    await user.getByText('The original message is no longer available.', { exact: false }).waitFor();
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'Retained while switching threads');
    await page.evaluate(() => window.standaloneHarness.rejectEdit());
    await user.getByText('Synthetic revert failure').waitFor();
    assert.equal(await user.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    await user.getByRole('button', { name: 'Cancel' }).click();
    await page.getByText('No messages yet').waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});
