import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    messageCopyHarness: {
      copied: { plain: string; html: string; via: string }[];
      locations: unknown[];
      mode: (value: 'rich' | 'missing' | 'denied' | 'failed') => void;
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
const require = createRequire(import.meta.url);

test('copying a collapsed user message preserves rendered rich content and clipboard fallbacks', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
      const copied = [], locations = [];
      window.ClipboardItem = class { constructor(items) { this.items = items; } async getType(type) { return this.items[type]; } };
      const client = { rpc: async () => { throw Error('unexpected rpc'); }, host: async () => { throw Error('unexpected host'); },
        subscribe: () => () => {}, reply: async () => { throw Error('unexpected approval'); } };
      const input = '# Files mentioned by the user:\\n\\n## File: /work/a%20b#L12.ts (line 4)\\n\\n## My request:\\n'
        + '# Heading\\n\\n**Bold** and [website](https://example.test) and [source](src/main.ts#L12C3).\\n\\n'
        + '- [x] Done\\n- [ ] Todo\\n\\n| One | Two |\\n| --- | --- |\\n| a | b |\\n\\n'
        + '> A quote\\n\\nMath $x^2$.\\n\\n' + '\`\`\`js\\nconst a = 1;\\n\`\`\`\\n\\n'
        + 'Long ' + 'x'.repeat(1250) + ' THE END';
      const thread = {id:'thread',cwd:'/work',name:null,status:{type:'idle'},turns:[{id:'turn',status:'completed',itemsView:'full',items:[
        {id:'user',type:'userMessage',content:[{type:'text',text:input,text_elements:[]}, {type:'image',fileId:'unresolved'}]},
        {id:'image-only',type:'userMessage',content:[{type:'image',fileId:'image-only'}]}
      ]}]};
      const root = createRoot(document.getElementById('root'));
      root.render(React.createElement(StandaloneMessages,{client,hostId:'ssh',thread,onOpenFileAt: value => locations.push(value)}));
      const mode = value => {
        const api = value === 'missing' || value === 'failed' ? undefined : { write: async items => {
          if (value === 'denied') throw Error('denied');
          const item = items[0];
          copied.push({plain:await (await item.getType('text/plain')).text(),html:await (await item.getType('text/html')).text(),via:'rich'});
        } };
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:api});
        document.execCommand = command => {
          if (command !== 'copy' || value === 'failed') return false;
          const data = new DataTransfer();
          const event = new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});
          document.activeElement.dispatchEvent(event);
          copied.push({plain:data.getData('text/plain'),html:data.getData('text/html'),via:'event'});
          return true;
        };
      };
      window.messageCopyHarness = {copied,locations,mode};
      mode('rich');
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
    const message = page.locator('[data-message-id="user"]');
    const copy = message.getByRole('button', { name: 'Copy message' });
    assert.equal(await page.locator('[data-message-id="image-only"]').getByRole('button', { name: 'Copy message' }).count(), 0);
    await message.locator('.yard-user-text.is-collapsed').waitFor();
    await message.getByRole('button', { name: 'source' }).click();
    assert.deepEqual(await page.evaluate(() => window.messageCopyHarness.locations),
      [{ path: '/work/src/main.ts', hostId: 'ssh', cwd: '/work', line: 12, column: 3 }]);
    await message.getByRole('button', { name: 'File', exact: true }).click();
    assert.deepEqual((await page.evaluate(() => window.messageCopyHarness.locations)).at(-1),
      { path: '/work/a%20b#L12.ts', hostId: 'ssh', cwd: '/work', line: 4, column: 1 });
    await copy.click();
    await message.getByRole('button', { name: 'Copied' }).waitFor();
    const rich = (await page.evaluate(() => window.messageCopyHarness.copied))[0]!;
    assert.equal(rich.via, 'rich');
    assert.match(rich.plain, /^Heading\n+Bold and website and source\./);
    assert.match(rich.plain, /- \[x\]\s+Done\n- \[ \]\s+Todo/);
    assert.match(rich.plain, /One\tTwo\na\tb/);
    assert.match(rich.plain, /Math \$x\^2\$\./);
    assert.match(rich.plain, /const a = 1;/);
    assert.match(rich.plain, /THE END$/);
    assert.doesNotMatch(rich.plain, /Files mentioned|unresolved|Copy code/);
    assert.match(rich.html, /<strong>Bold<\/strong>/);
    assert.match(rich.html, /<a href="https:\/\/example\.test"/);
    assert.match(rich.html, /<table>/);
    assert.match(rich.html, /<pre dir="ltr"><code data-language="js">const a = 1;\n<\/code><\/pre>/);
    assert.doesNotMatch(rich.html, /<img|<script|yard-code-toolbar/);
    for (const mode of ['missing', 'denied'] as const) {
      await page.evaluate((value) => window.messageCopyHarness.mode(value), mode);
      await message.getByRole('button', { name: 'Copied' }).click();
      const result = (await page.evaluate(() => window.messageCopyHarness.copied)).at(-1)!;
      assert.deepEqual(result, { ...rich, via: 'event' });
      assert.equal(await message.getByRole('button', { name: 'Copied' }).evaluate((element) => document.activeElement === element), true);
    }
    await page.evaluate(() => window.messageCopyHarness.mode('failed'));
    await message.getByRole('button', { name: 'Copied' }).click();
    await message.getByRole('button', { name: 'Copy failed' }).waitFor();
    await page.close();
  } finally { await browser.close(); }
});
