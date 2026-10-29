import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { readWorkspaceFile } from '../src/renderer/files/file-service.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

for (const stage of ['before-send', 'workspace-files', 'read-file-binary'] as const) {
  test(`file opens reject a revoked source at ${stage}`, async () => {
    let current = stage !== 'before-send';
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    const assertCurrent = () => { if (!current) throw new Error('source revoked'); };
    const client = { async host(endpoint, _params, options) {
      options?.assertBeforeSend?.();
      calls.push(endpoint);
      if (endpoint === stage) await pending;
      return endpoint === 'workspace-files' ? { text: 'base\n' } : { contentsBase64: btoa('base\n'), mimeType: 'text/plain' };
    } } as WorkbenchClient;
    const reading = readWorkspaceFile(client, 'original-host', '/original/file.txt', assertCurrent);
    if (stage === 'read-file-binary') await Promise.resolve();
    current = false;
    release();
    await assert.rejects(reading, /source revoked/);
    assert.deepEqual(calls, stage === 'before-send' ? [] : stage === 'workspace-files' ? ['workspace-files'] : ['workspace-files', 'read-file-binary']);
  });
}

test('file opens carry their source check through a connection wait', async () => {
  let current = true, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const assertCurrent = () => { if (!current) throw new Error('source revoked'); };
  const client = { async host(endpoint, _params, options) {
    await pending;
    options?.assertBeforeSend?.();
    calls.push(endpoint);
    return { text: 'base\n' };
  } } as WorkbenchClient;
  const reading = readWorkspaceFile(client, 'original-host', '/original/file.txt', assertCurrent);
  current = false;
  release();
  await assert.rejects(reading, /source revoked/);
  assert.deepEqual(calls, []);
});

test('preview file reads stop after navigation or child revocation and retain existing edits', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-open-authority-');
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { EditorView } from '@codemirror/view';
    import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
    const state = { revision: 0, calls: [], delay: null, pending: false, finished: 0 };
    let release;
    const client = { async host(endpoint, params = {}, options) {
      options?.assertBeforeSend?.();
      if (endpoint === 'workspace-directory-entries') return {entries: []};
      state.calls.push({endpoint, path: params.path, guarded: !!options?.assertBeforeSend});
      if (endpoint === state.delay) {
        state.pending = true;
        await new Promise(resolve => { release = resolve; });
        state.pending = false;
      }
      state.finished++;
      if (endpoint === 'workspace-files') return {text: 'base\\n'};
      if (endpoint === 'read-file-binary') return {contentsBase64: btoa('base\\n'), mimeType: 'text/plain'};
      throw new Error('Unexpected host call: ' + endpoint);
    }, subscribe() { return () => {}; } };
    let props = {client, scopeId: 'main', hostId: 'original-host', cwd: '/original',
      appearance: {theme: 'light', codeFontSize: 14, codeLineHeight: 21},
      request: null, onRequestConsumed() {}, onClose() {}};
    const app = createRoot(document.getElementById('root'));
    const render = () => app.render(React.createElement(WorkspacePanels, props));
    window.fixture = {state,
      open(path, guarded = true, revoked = false) {
        const revision = state.revision - (revoked ? 1 : 0);
        props = {...props, request: {id: crypto.randomUUID(), kind: 'file', scopeId: props.scopeId,
          hostId: props.hostId, cwd: props.cwd, path,
          ...(guarded ? {assertCurrent() {if (state.revision !== revision) throw new Error('source revoked');}} : {})}};
        render();
      },
      navigate(scopeId) {state.revision++; props = {...props, scopeId, request: null}; render();},
      revokeChild() {state.revision++;},
      release() {state.delay = null; release?.();},
      view() {const node = document.querySelector('.cm-content'); return node && EditorView.findFromDOM(node);}
    };
    render();
  ` }, bundle: true, write: false, format: 'iife', outdir: 'open-authority-fixture', loader: { '.css': 'css' } });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const style = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  const context = await browser.newContext({ viewport: { width: 900, height: 650 } });
  let completed = false;
  t.after(async () => { await context.close(); await browser.close(); if (completed) await rm(root, { recursive: true, force: true }); });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://127.0.0.1:47839/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill(path === '/fixture.js' ? { contentType: 'text/javascript; charset=utf-8', body: script }
      : path === '/fixture.css' ? { contentType: 'text/css; charset=utf-8', body: style }
        : { contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><script defer src="/fixture.js"></script></head><body><div id="root" style="height:600px"></div></body></html>' });
  });
  try {
    await page.goto('http://127.0.0.1:47839/');
    await page.waitForFunction(() => !!(window as any).fixture);
    await page.evaluate(() => (window as any).fixture.open('notes.txt', false));
    const original = page.getByRole('textbox', { name: 'File: /original/notes.txt' });
    await original.waitFor();
    await original.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('keep ');

    for (const [endpoint, reason] of [['workspace-files', 'navigation'], ['read-file-binary', 'child']] as const) {
      const path = reason + '.txt';
      await page.evaluate(({ endpoint, path }) => {const f = (window as any).fixture; f.state.delay = endpoint; f.open(path);}, {endpoint, path});
      await page.waitForFunction(() => (window as any).fixture.state.pending);
      await page.evaluate(reason => {const f = (window as any).fixture; if (reason === 'navigation') f.navigate('other'); else f.revokeChild(); f.release();}, reason);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (reason === 'navigation') await page.evaluate(() => (window as any).fixture.navigate('main'));
      assert.equal(await page.getByRole('tab').filter({ hasText: path }).count(), 0);
      const calls = await page.evaluate(path => (window as any).fixture.state.calls.filter((call: any) => call.path === '/original/' + path), path);
      assert.deepEqual(calls.map((call: any) => call.endpoint), endpoint === 'workspace-files' ? ['workspace-files'] : ['workspace-files', 'read-file-binary']);
      assert.ok(calls.every((call: any) => call.guarded));
      await page.getByRole('tab', { name: /notes\.txt/ }).click();
      assert.equal(await page.evaluate(() => (window as any).fixture.view().state.doc.toString()), 'keep base\n');
    }

    await page.evaluate(() => (window as any).fixture.open('revoked.txt', true, true));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.path === '/original/revoked.txt').length), 0);
    await page.evaluate(() => (window as any).fixture.open('success.txt'));
    await page.getByRole('textbox', { name: 'File: /original/success.txt' }).waitFor();
    await page.evaluate(() => (window as any).fixture.navigate('other'));
    await page.evaluate(() => (window as any).fixture.navigate('main'));
    await page.getByRole('textbox', { name: 'File: /original/success.txt' }).waitFor();
    await page.getByRole('button', { name: 'Reload file', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.calls.filter((call: any) => call.path === '/original/success.txt').length === 4);
    await page.getByRole('textbox', { name: 'File: /original/success.txt' }).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.path === '/original/success.txt').map((call: any) => call.guarded)), [true, true, false, false]);
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
    await writeFile(join(root, 'errors.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`File open authority failure artifacts: ${root}`, { cause: error });
  }
});
