import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

test('actual composer rechecks Enter behavior after a host isolation and recovery', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {BrowserWorkbenchClient} from './src/renderer/app/client.ts';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    const client=new BrowserWorkbenchClient(), root=createRoot(document.getElementById('root'));
    const submitted=[], events=[];
    client.subscribe(event=>events.push(event));
    const id=new URL(location.href).searchParams.get('id');
    root.render(React.createElement(I18nProvider,{locale:'en-US'},React.createElement(StandaloneComposer,{
      client,context:{hostId:'local',threadId:null,draftId:id,cwd:'/fixture'},busy:false,
      async onSubmit(draft){submitted.push(draft)},async onInterrupt(){}
    })));
    window.recoveryFixture={client,submitted,events};
    void client.connect();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const root = await mkdtemp('/tmp/aw-d-browser-'), fake = await createFakeCodex(root);
  const { renderer, adapterPath } = await nativeFixture(root);
  let failCommit = false, blockRecovery = true;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, renderer, adapterPath, hostCatalog: { hosts: [], projects: [], assignments: {} },
    nativeStateCheckpoint(step) {
      if (step === 'directory-sync' && failCommit) { failCommit = false; throw new Error('fixture lost directory confirmation'); }
      if (step === 'recovery-file-sync' && blockRecovery) throw new Error('fixture recovery blocked');
    } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  t.after(async () => { await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  const context = await browser.newContext({ bypassCSP: true });
  const errors: string[] = [];
  async function open(id: string) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/workbench-entry.js', route => route.abort());
    await page.goto(app.url + '/?id=' + id);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.locator('.standalone-composer__add > summary').click();
    await page.getByLabel('Send method').waitFor();
    await page.waitForFunction(() => {
      const control = document.querySelector('select[aria-label="Send method"]') as HTMLSelectElement | null;
      return !!control && !control.disabled && control.value === 'enter';
    });
    return page;
  }
  const a = await open('a'), b = await open('b');
  const editor = b.getByRole('textbox', { name: 'Work with Codex' });
  await editor.fill('retained draft');
  failCommit = true;
  const failed = await a.evaluate(async () => {
    try { await (window as any).recoveryFixture.client.host('set-setting', { key: 'composerEnterBehavior', value: 'cmdAlways' }); return null; }
    catch (error: any) { return { message: error.message, uncertain: error.uncertain }; }
  });
  assert.equal(failed?.uncertain, true);
  await b.getByRole('alert').filter({ hasText: '无法读取发送方式' }).waitFor();
  await editor.press('Enter');
  assert.equal(await b.evaluate(() => (window as any).recoveryFixture.submitted.length), 0);
  blockRecovery = false;
  assert.equal(await a.evaluate(async () => (await (window as any).recoveryFixture.client.host('get-setting', { key: 'composerEnterBehavior' })).value), 'cmdAlways');
  await b.waitForFunction(() => {
    const control = document.querySelector('select[aria-label="Send method"]') as HTMLSelectElement | null;
    return !!control && !control.disabled && control.value === 'cmdAlways';
  });
  await b.getByRole('alert').filter({ hasText: '无法读取发送方式' }).waitFor({ state: 'detached' });
  await editor.press('Enter');
  assert.equal(await b.evaluate(() => (window as any).recoveryFixture.submitted.length), 0);
  await editor.press('Control+Enter');
  await b.waitForFunction(() => (window as any).recoveryFixture.submitted.length === 1);
  assert.match(await b.evaluate(() => (window as any).recoveryFixture.submitted[0].text), /retained draft/);
  assert.deepEqual(errors, []);
});
