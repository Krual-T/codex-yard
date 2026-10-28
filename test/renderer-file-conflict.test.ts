import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('known file save conflicts block another write across refresh until explicit reload', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-conflict-');
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { EditorView } from '@codemirror/view';
    import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
    const text = 'base\\n';
    const client = { async host(endpoint) {
      if (endpoint === 'workspace-directory-entries') return {entries: []};
      if (endpoint === 'workspace-files') return {text};
      if (endpoint === 'read-file-binary') return {contentsBase64:btoa(text),mimeType:'text/plain'};
      if (endpoint === 'workspace-file-save') {
        sessionStorage.setItem('writes', String(Number(sessionStorage.getItem('writes') || 0) + 1));
        if (sessionStorage.getItem('mode') === 'late') throw new Error('fixture lost the original receipt');
        return {outcome:'conflict'};
      }
      if (endpoint === 'workspace-file-save-status') return {outcome:'conflict'};
      throw new Error('Unexpected host call: ' + endpoint);
    }, subscribe() { return () => {}; } };
    const props = {client, scopeId:'scope', hostId:'host', cwd:'/work',
      appearance:{theme:'light',codeFontSize:14,codeLineHeight:21},
      request:{id:'open',kind:'file',scopeId:'scope',hostId:'host',cwd:'/work',path:'file.txt'},
      onRequestConsumed(){}, onClose(){}};
    window.fixture = { view() { return EditorView.findFromDOM(document.querySelector('.cm-content')); } };
    createRoot(document.getElementById('root')).render(React.createElement(WorkspacePanels,props));
  ` }, bundle: true, write: false, format: 'iife', outdir: 'conflict-fixture', loader: { '.css': 'css' } });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const style = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  const context = await browser.newContext({ viewport: { width: 780, height: 550 } });
  let completed = false;
  t.after(async () => { await context.close(); await browser.close(); if (completed) await rm(root, { recursive: true, force: true }); });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('dialog', dialog => void dialog.accept());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('http://127.0.0.1:47833/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: script });
      if (path === '/fixture.css') return route.fulfill({ contentType: 'text/css; charset=utf-8', body: style });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"><script defer src="/fixture.js"></script></head><body><div id="root" style="height:500px"></div></body></html>' });
    });
    await page.goto('http://127.0.0.1:47833/');
    const editor = page.getByRole('textbox', { name: 'File: /work/file.txt' });
    await editor.waitFor();
    await page.evaluate(() => sessionStorage.setItem('mode', 'late'));
    await editor.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('draft ');
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByRole('alert').filter({ hasText: 'Save result is unknown' }).waitFor();
    await page.getByRole('button', { name: 'Check save result' }).click();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.view().state.doc.toString()), 'draft base\n');
    await page.reload();
    await editor.waitFor();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    await editor.focus();
    await page.keyboard.press('Control+s');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('writes')), '1');
    assert.equal(await page.evaluate(() => (window as any).fixture.view().state.doc.toString()), 'draft base\n');
    await page.getByRole('button', { name: 'Reload file' }).click();
    await page.waitForFunction(() => (window as any).fixture.view()?.state.doc.toString() === 'base\n');
    await page.evaluate(() => sessionStorage.setItem('mode', 'direct'));
    await editor.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('new ');
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    await page.reload();
    await editor.waitFor();
    await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save file' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('writes')), '2');
    assert.equal(await page.evaluate(() => (window as any).fixture.view().state.doc.toString()), 'new base\n');
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
    await writeFile(join(root, 'errors.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`File conflict browser failure artifacts: ${root}`, { cause: error });
  }
});
