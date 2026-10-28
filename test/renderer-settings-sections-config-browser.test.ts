import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window { configRecoveryHarness: {
    calls: Record<string, unknown>[];
    submit(): Promise<string>;
    check(id: string): Promise<void>;
    edit(editor: string, model: string): Promise<void>;
    find(): Promise<Record<string, unknown> | null>;
  } }
}

test('browser atom transactions retain the original ID and independent newer drafts across pages and reload', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 45_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConfigurationRecovery} from './src/renderer/settings/ConfigurationRecovery.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    const calls = [];
    const client = {subscribe:() => () => {}, reply:async () => {}, rpc:async () => {throw Error('direct RPC');},
      host:async (endpoint, params) => {calls.push({endpoint,...params}); if (params.action === 'submit') throw Error('lost reply');
        if (params.action === 'status') return {operation:null}; throw Error('unexpected request');}};
    const operations = settingsConfigOperations(client);
    window.configRecoveryHarness = {calls,
      submit:async () => {try {await operations.submit('local','config/batchWrite',{edits:[{keyPath:'model',value:'beta'}]},
        {section:'models',draft:{model:'beta'}}); return 'success';} catch(error) {return error.message;}},
      check:id => operations.check(id),
      edit:(editor,model) => operations.saveDraft('local','models',undefined,editor,{model}),
      find:() => operations.find('local','models')};
    createRoot(document.getElementById('root')).render(<ConfigurationRecovery client={client}/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    for (const page of pages) { await page.goto('http://settings-recovery-fixture.invalid/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); }
    const [first, second] = pages;
    assert.ok(first && second);
    assert.match(await first.evaluate(() => window.configRecoveryHarness.submit()), /lost reply/);
    const original = await first.evaluate(() => window.configRecoveryHarness.find());
    assert.ok(original && typeof original.operationId === 'string');
    const id = original.operationId;
    await second.getByRole('region', { name: 'Configuration save recovery' }).waitFor();
    assert.match(await second.evaluate(() => window.configRecoveryHarness.submit()), /earlier configuration save/);
    await Promise.all([first.evaluate(() => window.configRecoveryHarness.edit('first-page', 'gamma')),
      second.evaluate(() => window.configRecoveryHarness.edit('second-page', 'delta'))]);
    await second.reload(); await second.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const restored = await second.evaluate(() => window.configRecoveryHarness.find());
    assert.equal(restored?.operationId, id);
    assert.deepEqual(restored?.params, { edits: [{ keyPath: 'model', value: 'beta' }] });
    assert.deepEqual((restored?.workingDrafts as { editorId: string }[]).map(item => item.editorId).sort(), ['first-page', 'second-page']);
    await second.evaluate(operationId => window.configRecoveryHarness.check(operationId), id);
    assert.equal((await second.evaluate(() => window.configRecoveryHarness.find()))?.phase, 'unknown');
    assert.equal((await first.evaluate(() => window.configRecoveryHarness.calls.filter(call => call.action === 'submit'))).length, 1);
    assert.equal((await second.evaluate(() => window.configRecoveryHarness.calls.filter(call => call.action === 'submit'))).length, 0);
    await context.close();
  } finally { await browser.close(); }
});
