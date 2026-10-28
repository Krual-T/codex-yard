import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    markdownHarness: {
      render: (text: string) => void;
      copies: string[];
      files: { hostId: string; cwd: string; path: string; line?: number; column?: number }[];
    };
  }
}

const require = createRequire(import.meta.url);
test('standalone Markdown renders updated code and preserves copy, diagram and file actions', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneMarkdown} from './src/renderer/markdown/StandaloneMarkdown.tsx';
      const client = {rpc:async () => {throw Error('Unexpected RPC');}, reply:async () => {},
        subscribe:() => () => {}, host:async () => {throw Error('Unexpected host operation');}};
      const copies = [], files = [], root = createRoot(document.getElementById('root'));
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => copies.push(text)}});
      window.markdownHarness = {copies,files,render(text) {
        root.render(<StandaloneMarkdown client={client} hostId="ssh-fixture" cwd="/work" text={text}
          onOpenFileAt={location => files.push(location)}/>);
      }};
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

    await page.evaluate(() => window.markdownHarness.render('```ts\nconst answer = 42;\n```\n\n[source](src/main.ts#L12C3)'));
    const block = page.locator('[data-markdown-copy="code-block"]');
    await block.locator('code').waitFor();
    assert.equal(await block.getAttribute('data-markdown-copy-text'), 'const answer = 42;\n');
    assert.equal(await block.getAttribute('data-markdown-copy-language'), 'ts');
    await block.getByRole('button', { name: 'Copy code' }).click();
    assert.deepEqual(await page.evaluate(() => window.markdownHarness.copies), ['const answer = 42;']);
    await page.getByRole('button', { name: 'source' }).click();
    assert.deepEqual(await page.evaluate(() => window.markdownHarness.files), [
      { hostId: 'ssh-fixture', cwd: '/work', path: '/work/src/main.ts', line: 12, column: 3 },
    ]);

    await page.evaluate(() => window.markdownHarness.render('```ts\nconst answer = 43;'));
    await page.locator('pre code').getByText('const answer = 43;').waitFor();
    assert.equal(await page.getByRole('button', { name: 'source' }).count(), 0);
    await page.evaluate(() => window.markdownHarness.render('```mermaid\nflowchart LR\n  A --> B\n```'));
    const diagram = page.locator('[data-markdown-copy="code-block"]');
    await diagram.getByRole('button', { name: 'Show source' }).click();
    assert.match(await diagram.locator('pre').textContent() ?? '', /flowchart LR/);
    await diagram.getByRole('button', { name: 'Show diagram' }).click();
    await diagram.locator('.yard-mermaid svg').waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
