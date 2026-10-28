import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('file preview uses the live draft and retains editor history, wrap and navigation', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-preview-');
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { EditorView } from '@codemirror/view';
      import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
      import { I18nProvider } from './src/renderer/i18n/index.tsx';
      const state = {files: {'/work/docs/readme.md':'# Original\\n\\n[Other](other.txt#L2)\\n', '/work/docs/other.txt':'other file\\nsecond line'}, calls: []};
      const client = { async host(endpoint, params) {
        state.calls.push({endpoint, params});
        if (endpoint === 'workspace-directory-entries') return {entries: []};
        if (endpoint === 'workspace-files') return {text: state.files[params.path]};
        if (endpoint === 'read-file-binary') {
          const bytes = new TextEncoder().encode(state.files[params.path]);
          return {contentsBase64: btoa(Array.from(bytes, value => String.fromCharCode(value)).join('')), mimeType:'text/plain'};
        }
        throw new Error('Unexpected host call: ' + endpoint);
      }, subscribe() { return () => {}; } };
      let props = {client, scopeId:'s', hostId:'h', cwd:'/work', appearance:{theme:'light',codeFontSize:14,codeLineHeight:21},
        request:{id:'open',kind:'file',scopeId:'s',hostId:'h',cwd:'/work',path:'docs/readme.md'}, onRequestConsumed(){}, onClose(){}};
      const root = createRoot(document.getElementById('root'));
      let locale = 'en-US';
      window.fixture = {state, render(changes) {
        if (changes.locale) { locale = changes.locale; changes = {...changes}; delete changes.locale; }
        props = {...props,...changes}; root.render(React.createElement(I18nProvider,{locale},React.createElement(WorkspacePanels,props))); },
        view() { return EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content')); }};
      window.fixture.render({});
    ` },
    bundle: true, write: false, format: 'iife', outdir: 'preview-fixture', loader: { '.css': 'css' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  const context = await browser.newContext({ viewport: { width: 780, height: 550 }, permissions: ['clipboard-read', 'clipboard-write'] });
  let completed = false;
  t.after(async () => { await context.close(); await browser.close(); if (completed) await rm(root, { recursive: true, force: true }); });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('http://127.0.0.1:47832/**', route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0"><div id="root" style="height:500px"></div></body></html>' }));
    await page.goto('http://127.0.0.1:47832/');
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    const editor = page.getByRole('textbox', { name: 'File: /work/docs/readme.md' });
    await editor.waitFor();
    await editor.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('New draft');
    await page.getByRole('button', { name: 'Enable word wrap' }).click();
    assert.ok(['pre-wrap', 'break-spaces'].includes(await page.locator('.cm-editor').evaluate(node => getComputedStyle(node.querySelector('.cm-content')!).whiteSpace)));
    await page.getByRole('button', { name: 'Copy file contents' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '# Original\n\n[Other](other.txt#L2)\nNew draft');
    await page.getByRole('button', { name: 'View preview' }).click();
    await page.getByRole('heading', { name: 'Original' }).waitFor();
    assert.equal(await page.locator('.yard-markdown-preview').getByText('New draft').count(), 1);
    assert.equal(await editor.isVisible(), false);
    await page.getByRole('button', { name: 'View source' }).click();
    await editor.waitFor();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).fixture.view().state.doc.toString()), '# Original\n\n[Other](other.txt#L2)\n');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.getByRole('button', { name: 'View preview' }).click();
    await page.getByRole('button', { name: 'Other' }).click();
    await page.getByRole('textbox', { name: 'File: /work/docs/other.txt' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.view().state.selection.main.from), 'other file\n'.length);
    await page.getByRole('tab', { name: 'readme.md' }).click();
    await page.getByRole('heading', { name: 'Original' }).waitFor();
    await page.keyboard.press('Control+f');
    await page.getByRole('textbox', { name: 'Replace', exact: true }).fill('replacement');
    await page.getByLabel('match case').check();
    await page.getByRole('textbox', { name: 'Find', exact: true }).fill('draft');
    assert.equal(await editor.isVisible(), true);
    await page.getByRole('textbox', { name: 'Find', exact: true }).evaluate(element => {
      (element as HTMLInputElement).setSelectionRange(1, 3);
    });
    await page.evaluate(() => (window as any).fixture.render({locale:'zh-CN',request:null}));
    const chineseFind = page.getByRole('textbox', { name: '查找', exact:true });
    await chineseFind.waitFor();
    assert.equal(await chineseFind.inputValue(), 'draft');
    assert.equal(await page.getByRole('textbox', {name:'替换',exact:true}).inputValue(), 'replacement');
    assert.equal(await page.getByLabel('区分大小写').isChecked(), true);
    assert.deepEqual(await chineseFind.evaluate(element => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd]), [1, 3]);
    assert.equal(await page.getByRole('button', {name:'保存文件'}).count(), 1);
    assert.equal(await page.getByRole('textbox', {name:'文件：/work/docs/readme.md'}).count(), 1);
    await page.evaluate(() => (window as any).fixture.render({locale:'en-US'}));
    assert.equal(await page.getByRole('textbox', {name:'Find',exact:true}).inputValue(), 'draft');
    assert.match(await page.evaluate(() => (window as any).fixture.view().state.doc.toString()), /New draft$/);
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
    await writeFile(join(root, 'errors.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`File preview browser failure artifacts: ${root}`, { cause: error });
  }
});
