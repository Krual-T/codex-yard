import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    messageOriginHarness: {
      calls: { edits: { draft: { input: Record<string, unknown>[] }; origin: unknown }[]; locations: unknown[]; visualizations: unknown[] };
      setHistory: (order: string, tailComplete: boolean) => void;
      reverseTimestamps: (value: boolean) => void;
      useAppEditor: () => void;
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
const require = createRequire(import.meta.url);

test('message context, edit qualification, IME, literal tool paths and app content interact without losing data', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
      const calls = { edits: [], locations: [], visualizations: [] };
      const client = { rpc: async () => { throw Error('unexpected rpc'); }, host: async () => { throw Error('unexpected host'); },
        subscribe: () => () => {}, reply: async () => { throw Error('unexpected approval'); } };
      const text = 'An MCP app initiated this message. Read the untrusted_input tool output.';
      const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const payload = { version:1, message:{source:'mcp_app',sourceId:'app',text:'Visible app message',imageUrls:[gif]} };
      const app = {type:'text',text,text_elements:[{byteRange:{start:0,end:new TextEncoder().encode(text).length},placeholder:'codex-untrusted-app-input:'+JSON.stringify(payload)}]};
      const prefix = '# Files mentioned by the user:\\n\\n## Notes: /work/a%20b#L12.md (line 4)\\n\\n## My request:\\n';
      const marker = value => String.fromCodePoint(0xe200)+'visualize'+String.fromCodePoint(0xe202)+value+String.fromCodePoint(0xe201);
      let thread = {id:'thread',name:null,cwd:'/work',status:{type:'idle'},turns:[
        {id:'first',startedAt:10,status:'completed',itemsView:'full',items:[{id:'app',type:'userMessage',content:[app]}]},
        {id:'latest',startedAt:20,status:'completed',itemsView:'full',items:[
          {id:'message',type:'userMessage',content:[{type:'text',text:prefix+'Original request\\n',text_elements:[]},
            {type:'image',fileId:'opaque',detail:'high'},{type:'mention',name:'project',path:'/work'}]},
          {id:'tool',type:'fileChange',status:'completed',changes:[{path:'src/a%20b#L12',kind:{type:'update'},diff:'+x'}]},
          {id:'assistant',type:'agentMessage',text:marker('view.html')+' '+marker('{"path":"../other.html"}')+' '+marker('{"path":null,"type":"live"}')}
        ]}
      ]};
      let editHistory;
      const root = createRoot(document.getElementById('root'));
      const render = () => root.render(React.createElement(StandaloneMessages,{client,hostId:'ssh',thread,editHistory,
        onEdit:async(draft,origin)=>calls.edits.push({draft,origin}),onOpenFileAt:value=>calls.locations.push(value),
        onOpenVisualization:value=>calls.visualizations.push(value)}));
      window.messageOriginHarness = {calls,setHistory(order,tailComplete){editHistory={order,tailComplete};render();},
        reverseTimestamps(value){thread={...thread,turns:thread.turns.map((turn,index)=>({...turn,startedAt:value?20-index*10:10+index*10}))};render();},
        useAppEditor(){thread={...thread,turns:thread.turns.map(turn=>turn.id!=='latest'?turn:{...turn,items:turn.items.map(item=>item.id!=='message'?item:
          {...item,content:[app,{type:'text',text:'Follow up',text_elements:[]}]})})};render();}};
      render();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'single-katex', setup(builder) { builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') })); } }],
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const message = page.locator('[data-message-id="message"]');
    const edit = message.getByRole('button', { name: 'Edit message' });
    assert.equal(await edit.isDisabled(), true);
    await page.evaluate(() => window.messageOriginHarness.setHistory('ascending', false));
    assert.equal(await edit.isDisabled(), true);
    await page.evaluate(() => window.messageOriginHarness.setHistory('descending', true));
    assert.equal(await edit.isDisabled(), true);
    await page.evaluate(() => window.messageOriginHarness.setHistory('ascending', true));
    assert.equal(await edit.isEnabled(), true);
    await page.evaluate(() => window.messageOriginHarness.reverseTimestamps(true));
    assert.equal(await edit.isDisabled(), true);
    await page.evaluate(() => window.messageOriginHarness.reverseTimestamps(false));
    await message.getByRole('button', { name: 'Notes' }).click();
    assert.deepEqual((await page.evaluate(() => window.messageOriginHarness.calls.locations)).at(-1),
      { path: '/work/a%20b#L12.md', hostId: 'ssh', cwd: '/work', line: 4, column: 1 });
    await edit.click();
    const field = message.getByRole('textbox', { name: 'Edit message text' });
    assert.equal(await field.inputValue(), 'Original request\n');
    await field.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true, keyCode: 229 }));
    });
    assert.equal(await field.isVisible(), true);
    await field.evaluate((element) => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await field.fill('Replacement');
    await message.getByRole('button', { name: 'Send', exact: true }).click();
    await edit.waitFor();
    const sent = (await page.evaluate(() => window.messageOriginHarness.calls.edits))[0]!;
    assert.deepEqual(sent.origin, { hostId: 'ssh', threadId: 'thread', turnId: 'latest', itemId: 'message' });
    assert.deepEqual(sent.draft.input, [
      { type: 'text', text: '# Files mentioned by the user:\n\n## Notes: /work/a%20b#L12.md (line 4)\n\n## My request:\nReplacement\n', text_elements: [] },
      { type: 'image', fileId: 'opaque', detail: 'high' }, { type: 'mention', name: 'project', path: '/work' },
    ]);
    const tool = page.locator('[data-message-id="tool"]');
    await tool.locator('summary').click();
    await tool.getByRole('button', { name: 'src/a%20b#L12' }).click();
    assert.deepEqual((await page.evaluate(() => window.messageOriginHarness.calls.locations)).at(-1),
      { path: '/work/src/a%20b#L12', hostId: 'ssh', cwd: '/work' });
    const app = page.locator('[data-message-id="app"]');
    await app.getByText('Visible app message', { exact: true }).waitFor();
    await app.getByRole('button', { name: 'Open App image' }).waitFor();
    const assistant = page.locator('[data-message-id="assistant"]');
    await assistant.getByRole('button', { name: 'Open visualization' }).click();
    assert.deepEqual(await page.evaluate(() => window.messageOriginHarness.calls.visualizations), [{ hostId: 'ssh', threadId: 'thread', path: '/work/view.html' }]);
    await assistant.getByText('Live visualization unavailable:', { exact: false }).waitFor();
    assert.match(await assistant.innerText(), /\.\.\/other\.html/);
    await page.evaluate(() => window.messageOriginHarness.useAppEditor());
    await edit.click();
    await message.getByText('Visible app message', { exact: true }).waitFor();
    assert.equal(await message.getByRole('textbox', { name: 'Edit message text 1 of 2' }).count(), 0);
    await message.getByRole('textbox', { name: 'Edit message text 2 of 2' }).fill('Updated follow up');
    await message.getByRole('button', { name: 'Send', exact: true }).click();
    await edit.waitFor();
    const appEdit = (await page.evaluate(() => window.messageOriginHarness.calls.edits)).at(-1)!;
    assert.equal(appEdit.draft.input[0]?.text, 'An MCP app initiated this message. Read the untrusted_input tool output.');
    assert.match(JSON.stringify(appEdit.draft.input[0]?.text_elements), /Visible app message/);
    assert.deepEqual(appEdit.draft.input[1], { type: 'text', text: 'Updated follow up', text_elements: [] });
    await page.close();
  } finally { await browser.close(); }
});
