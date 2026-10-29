import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window { s12SettingsHarness: {
    snapshot(): Promise<{ drafts: { editorId: string; revision: number; draft: { model: string; effort: string } }[]; records: unknown[] }>;
    current(): { drafts: { editorId: string; revision: number; draft: { model: string; effort: string } }[]; records: unknown[] };
    durable(): Promise<{ drafts: { editorId: string; revision: number; draft: { model: string; effort: string } }[]; operations: unknown[] }>;
    isSaving(): boolean;
    release(): void; calls: Record<string, unknown>[];
  }; s12NotSentHarness: { submit(): Promise<string>; calls: Record<string, unknown>[]; drafts(): Promise<number> } }
}

test('two settings pages keep independent edits through an original receipt and explicit restoration', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 45_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {ModelSection} from './src/renderer/settings/ModelSection.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    import {readBrowserAtom} from './src/renderer/storage/ui-atoms.ts';
    const calls = [], source = {hostId:'local',generation:'fixture-generation',homeDirectory:'/fixture',codexHome:'/fixture/codex'};
    const current = () => JSON.parse(localStorage.getItem('synthetic-config') || '{"model":"alpha","effort":"high","version":"v1"}');
    let release, saving = false;
    const client = {subscribe:() => () => {}, reply:async () => {},
      rpc:async (method) => {
        const config = current();
        if (method === 'model/list') return {data:['alpha','beta'].map(model => ({id:model,model,displayName:model,isDefault:model==='alpha',
          supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'low'}]})),nextCursor:null};
        if (method === 'config/read') return {config:{model:config.model,model_reasoning_effort:config.effort,profile:null},
          layers:[{name:{type:'user',file:'/fixture/codex/config.toml',profile:null},version:config.version}],yardConfigSource:source};
        throw Error('Unexpected RPC');
      },
      host:async (endpoint,input) => {
        if (endpoint !== 'configuration-write' || input.action !== 'submit') throw Error('Unexpected host call');
        calls.push(structuredClone(input));
        await new Promise(resolve => {release=resolve});
        const config = current();
        if (input.params.expectedVersion !== config.version) throw Error('Fixture version changed');
        for (const edit of input.params.edits) if (edit.keyPath==='model') config.model=edit.value;
        config.version='v2'; localStorage.setItem('synthetic-config',JSON.stringify(config));
        return {outcome:'success',result:{status:'ok'},operation:{operationId:input.operationId,hostId:'local',
          method:input.method,state:'succeeded',terminal:{kind:'ok'}}};
      }};
    const ops = settingsConfigOperations(client);
    window.s12SettingsHarness={calls,release:() => release(),isSaving:() => saving,current:() => ops.getSnapshot(),
      snapshot:async () => {await ops.refresh();return ops.getSnapshot();},
      durable:() => readBrowserAtom('codex-yard.settings-config-writes.v1')};
    createRoot(document.getElementById('root')).render(<I18nProvider locale="en-US"><ModelSection client={client} hostId="local"
      onDirtyChange={() => {}} onSavingChange={value => {saving=value}} /></I18nProvider>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const first = await context.newPage(), second = await context.newPage();
    for (const page of [first, second]) {
      await page.goto('http://settings-s12-fixture.invalid/');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    }
    await first.getByRole('combobox', { name: 'Model', exact: true }).selectOption('beta');
    await second.getByRole('combobox', { name: 'Reasoning effort' }).selectOption('low');
    await second.waitForFunction(() => window.s12SettingsHarness.current().drafts.length === 2);
    const before = await second.evaluate(() => window.s12SettingsHarness.snapshot());
    const other = before.drafts.find(draft => draft.draft.effort === 'low'); assert.ok(other);
    const original = before.drafts.find(draft => draft.editorId !== other.editorId); assert.ok(original);
    await first.locator('.yard-inline-save').getByRole('button', { name: 'Save' }).click();
    await first.waitForFunction(() => window.s12SettingsHarness.calls.length === 1 && window.s12SettingsHarness.isSaving());
    await second.getByRole('combobox', { name: 'Model', exact: true }).selectOption('beta');
    await second.waitForFunction(id => window.s12SettingsHarness.current().drafts.some(draft =>
      draft.editorId === id && draft.draft.model === 'beta'), other.editorId);
    await first.evaluate(() => window.s12SettingsHarness.release());
    await first.waitForFunction(() => !window.s12SettingsHarness.isSaving() && !document.querySelector('.yard-inline-save')
      && window.s12SettingsHarness.current().records.length === 0);
    const durable = await second.evaluate(() => window.s12SettingsHarness.durable());
    assert.equal(durable.operations.length, 0, JSON.stringify(durable));
    assert.equal(durable.drafts.length, 1, JSON.stringify(durable));
    assert.equal(durable.drafts[0]?.editorId, other.editorId);
    assert.notEqual(durable.drafts[0]?.editorId, original.editorId);
    assert.ok(durable.drafts[0]!.revision > other.revision);
    assert.deepEqual({ model: durable.drafts[0]!.draft.model, effort: durable.drafts[0]!.draft.effort }, { model: 'beta', effort: 'low' });
    await second.waitForFunction(() => window.s12SettingsHarness.current().records.length === 0
      && window.s12SettingsHarness.current().drafts.length === 1);
    const after = await second.evaluate(() => window.s12SettingsHarness.snapshot());
    assert.equal(after.records.length, 0, JSON.stringify(after));
    assert.equal(after.drafts.length, 1, JSON.stringify(after));
    assert.equal(after.drafts[0]?.editorId, other.editorId);
    assert.ok(after.drafts[0]!.revision > other.revision);
    assert.deepEqual({ model: after.drafts[0]!.draft.model, effort: after.drafts[0]!.draft.effort }, { model: 'beta', effort: 'low' });
    await second.reload(); await second.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const saved = second.getByRole('region', { name: 'Saved configuration edits' });
    await saved.getByText(other.editorId, { exact: true }).waitFor();
    assert.equal(await second.getByRole('combobox', { name: 'Reasoning effort' }).inputValue(), 'high');
    await saved.getByText(other.editorId, { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Restore this edit' }).click();
    await second.waitForFunction(() => (document.querySelector('[aria-label="Reasoning effort"]') as HTMLSelectElement | null)?.value === 'low');
    assert.equal((await first.evaluate(() => window.s12SettingsHarness.calls)).length, 1);
    await context.close();
  } finally { await browser.close(); }
});

test('the recovery panel uses persisted original not-sent evidence after host restart', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 45_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConfigurationRecovery} from './src/renderer/settings/ConfigurationRecovery.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    const calls=[], source={hostId:'local',generation:'fixture',homeDirectory:'/fixture',codexHome:'/fixture/codex'};
    const client={subscribe:() => () => {},reply:async () => {},rpc:async () => {throw Error('Unexpected RPC');},
      host:async (endpoint,input) => {calls.push(structuredClone(input));
        if (endpoint !== 'configuration-write') throw Error('Unexpected endpoint');
        if (input.action === 'submit') return {outcome:'not-started',error:{message:'prepare failed',uncertain:false},operation:{
          operationId:input.operationId,hostId:input.hostId,method:input.method,state:'preparing',storageError:true,observedTerminal:{kind:'not-sent'}}};
        return {operation:null};
      }};
    const ops=settingsConfigOperations(client);
    window.s12NotSentHarness={calls,drafts:async () => {await ops.refresh();return ops.getSnapshot().drafts.length;},submit:async () => {
      const revision=await ops.saveDraft('local','models',undefined,'fixture-editor',{model:'beta',baseline:'alpha'});
      try {await ops.submit('local','config/batchWrite',{edits:[]},{section:'models',editorId:'fixture-editor',revision,source,draft:{model:'beta'}});
        return 'unexpected success';} catch(error) {return error.message;}
    }};
    createRoot(document.getElementById('root')).render(<ConfigurationRecovery client={client}/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const first = await context.newPage(), resumed = await context.newPage();
    for (const page of [first, resumed]) {
      await page.goto('http://settings-s12-not-sent.invalid/');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    }
    assert.match(await first.evaluate(() => window.s12NotSentHarness.submit()), /host.*receipt/i);
    const panel = resumed.getByRole('region', { name: 'Configuration save recovery' });
    await panel.getByText('The host has not saved its observed receipt yet.').waitFor();
    await resumed.reload(); await resumed.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await panel.getByRole('button', { name: 'Check original operation' }).click();
    await panel.getByText('The host no longer has this operation. The original not-sent evidence remains saved in this browser.').waitFor();
    await panel.getByRole('button', { name: 'Confirm original save was not sent' }).click();
    await panel.getByRole('button', { name: 'Close original operation' }).click();
    await resumed.waitForFunction(() => !document.querySelector('[aria-label="Configuration save recovery"]'));
    assert.equal(await resumed.evaluate(() => window.s12NotSentHarness.drafts()), 1);
    assert.deepEqual((await first.evaluate(() => window.s12NotSentHarness.calls)).map(call => call.action), ['submit']);
    assert.deepEqual((await resumed.evaluate(() => window.s12NotSentHarness.calls)).map(call => call.action), ['status']);
    await context.close();
  } finally { await browser.close(); }
});
