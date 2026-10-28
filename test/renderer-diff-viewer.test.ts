import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { diffRows, splitDiffRows } from '../src/renderer/diff/diff-service.ts';

test('split diff preserves distinct files, hunk positions and header-like content', () => {
  const patch = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -3,2 +3,3 @@',
    '--- removed', ' unchanged', '+++ added', '+extra',
    'diff --git a/b.txt b/b.txt', '--- a/b.txt', '+++ b/b.txt', '@@ -1 +1 @@', '-old', '+new'].join('\n');
  const rows = diffRows(patch);
  assert.deepEqual(rows.find(row => row.text === '--- removed'), { kind:'delete', text:'--- removed', oldLine:3 });
  assert.deepEqual(rows.find(row => row.text === '+++ added'), { kind:'add', text:'+++ added', newLine:4, path:'a.txt' });
  assert.deepEqual(rows.find(row => row.text === '+new'), { kind:'add', text:'+new', newLine:1, path:'b.txt' });
  const split = splitDiffRows(rows);
  const changed = split.find(row => row.kind === 'line' && row.current?.text === '+new');
  assert.ok(changed && changed.kind === 'line');
  assert.equal(changed.old?.text, '-old');
  assert.equal(changed.current?.path, 'b.txt');
});

test('diff layout and wrap controls preserve real change lines and open the target', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-diff-');
  const patch = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,4 @@',
    ' context', '-old one', '-old two', '+new one', '+new two', '+new three'].join('\n');
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader:'js', contents:`
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {DiffViewer} from './src/renderer/diff/DiffViewer.tsx';
      import './src/renderer/panels/workspace-panels.css';
      window.opened = [];
      createRoot(document.getElementById('root')).render(React.createElement(DiffViewer, {
        diff:${JSON.stringify(patch)}, onOpenFile:(path, line) => window.opened.push({path,line})
      }));
    ` },
    bundle:true, write:false, format:'iife', outdir:'diff-fixture', loader:{'.css':'css'},
  });
  const browser = await chromium.launch({ executablePath:'/usr/bin/google-chrome', headless:true, args:['--no-sandbox'],
    env:{...process.env, HOME:root, XDG_CONFIG_HOME:join(root,'config'), XDG_CACHE_HOME:join(root,'cache')} });
  const context = await browser.newContext({viewport:{width:390,height:600}, permissions:['clipboard-read', 'clipboard-write']});
  let completed = false;
  t.after(async () => { await context.close(); await browser.close(); if (completed) await rm(root,{recursive:true,force:true}); });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('http://127.0.0.1:47833/**', route => route.fulfill({ contentType:'text/html',
      body:'<!doctype html><html><body><div id="root" class="yard-workspace-panels" style="height:550px"></div></body></html>' }));
    await page.goto('http://127.0.0.1:47833/');
    await page.addStyleTag({content:bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text});
    await page.addScriptTag({content:bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text});
    await page.getByText('new three', {exact:true}).waitFor();
    await page.getByRole('button', {name:'Copy diff'}).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), patch);
    await page.getByRole('button', {name:'Switch to split diff'}).click();
    assert.equal(await page.locator('.yard-diff-split-row').count(), 4);
    const paired = page.locator('.yard-diff-split-row').filter({hasText:'new one'});
    assert.match(await paired.innerText(), /old one/);
    assert.match(await paired.innerText(), /new one/);
    await page.getByRole('button', {name:'Enable word wrap'}).click();
    assert.equal(await page.locator('.yard-diff-lines').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await page.getByRole('button', {name:'Open a.txt line 4'}).click();
    assert.deepEqual(await page.evaluate(() => (window as any).opened), [{path:'a.txt',line:4}]);
    await page.getByRole('button', {name:'Switch to unified diff'}).click();
    assert.equal(await page.getByText('new three', {exact:true}).count(), 1);
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({path:join(root,'failure.png')}).catch(() => {});
    await writeFile(join(root,'errors.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`Diff browser failure artifacts: ${root}`, {cause:error});
  }
});
