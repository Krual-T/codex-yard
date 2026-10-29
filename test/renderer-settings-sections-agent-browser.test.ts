import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window { agentParityFixture: {
    calls(): { action: string; params: { edits: { keyPath: string; value: unknown }[]; expectedVersion: string }; source: unknown }[];
    failNext(): void;
    snapshot(): Promise<{ drafts: unknown[]; records: { operationId: string; phase: string }[] }>;
    opened(): unknown;
  } }
}

async function bundleFixture() {
  return build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {AgentSection} from './src/renderer/settings/AgentSection.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    const source={hostId:'local',generation:'fixture-generation',homeDirectory:'/fixture',codexHome:'/fixture/codex'};
    const initial={approval_policy:'on-request',sandbox_mode:'read-only',web_search:'cached',model_verbosity:'low',model_reasoning_summary:'auto'};
    let config=structuredClone(initial), version=1, fail=false, opened=null;
    const calls=[];
    const client={subscribe:()=>()=>{},reply:async()=>{},
      rpc:async(method)=>{
        if(method==='config/read') return {config:{...config,profile:null},layers:[{name:{type:'user',file:'/fixture/codex/config.toml',profile:null},version:'v'+version}],yardConfigSource:source,yardAgentConfiguration:{base:structuredClone(config),lockedKeys:[],supportsIndexedWebSearch:true}};
        if(method==='configRequirements/read')return {requirements:null};
        if(method==='experimentalFeature/list')return {data:[],nextCursor:null};
        throw Error('Unexpected RPC '+method);
      },
      host:async(method,input)=>{
        if(method!=='configuration-write')throw Error('Unexpected host '+method);
        if(input.action==='status')return {operation:null};
        if(input.action!=='submit')throw Error('Unexpected action');
        calls.push(structuredClone(input));
        if(fail){fail=false;throw Error('fixture lost acknowledgement');}
        if(input.params.expectedVersion!=='v'+version)throw Error('version mismatch');
        for(const edit of input.params.edits){
          if(edit.keyPath==='sandbox_workspace_write.network_access')config.sandbox_workspace_write={network_access:edit.value};
          else if(edit.value===null)delete config[edit.keyPath];else config[edit.keyPath]=edit.value;
        }
        version++;
        return {outcome:'success',result:{status:'ok'},operation:{operationId:input.operationId,hostId:input.hostId,method:input.method,state:'succeeded',terminal:{kind:'ok'}}};
      }};
    const operations=settingsConfigOperations(client);
    window.agentParityFixture={calls:()=>calls,failNext:()=>{fail=true;},opened:()=>opened,
      snapshot:async()=>{await operations.refresh();return operations.getSnapshot();}};
    createRoot(document.getElementById('root')).render(<I18nProvider locale="en-US"><div className="yard-settings"><main className="yard-settings-content"><AgentSection client={client} hostId="local"
      onDirtyChange={()=>{}} onSavingChange={()=>{}} onOpenConfig={(hostId,file,source)=>{opened={hostId,file,source};}} /></main></div></I18nProvider>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
}

test('actual AgentSection selects and immediately submits all five fields through the persistent editor', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 45_000,
}, async () => {
  const bundle = await bundleFixture();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const page = await context.newPage(); await page.goto('http://agent-parity-fixture.invalid/');
    await page.addStyleTag({ content: await readFile('src/renderer/settings/standalone-settings.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('combobox', { name: 'Web search' }).waitFor();
    assert.deepEqual(await page.getByRole('combobox', { name: 'Web search' }).locator('option').evaluateAll(items => items.map(item => (item as HTMLOptionElement).value)),
      ['disabled', 'cached', 'indexed', 'live']);
    assert.deepEqual(await page.getByRole('combobox', { name: 'Output detail' }).locator('option').evaluateAll(items => items.map(item => (item as HTMLOptionElement).value)),
      ['', 'low', 'medium', 'high']);
    assert.deepEqual(await page.getByRole('combobox', { name: 'Reasoning summary' }).locator('option').evaluateAll(items => items.map(item => (item as HTMLOptionElement).value)),
      ['auto', 'concise', 'detailed', 'none']);
    const changes = [
      ['Approval policy', 'never'], ['Sandbox settings', 'workspace-write'], ['Web search', 'live'],
      ['Output detail', ''], ['Reasoning summary', 'detailed'],
    ];
    for (const [index, [label, value]] of changes.entries()) {
      assert.ok(label !== undefined && value !== undefined);
      const control = page.getByRole('combobox', { name: label, exact: true });
      await control.waitFor();
      await page.waitForFunction(name => !(document.querySelector('select[aria-label="' + name + '"]') as HTMLSelectElement).disabled, label);
      await control.selectOption(value);
      await page.waitForFunction(count => window.agentParityFixture.calls().length === count, index + 1);
      await page.waitForFunction(name => !(document.querySelector('select[aria-label="' + name + '"]') as HTMLSelectElement).disabled, label);
    }
    await page.getByRole('switch', { name: 'Allow network access' }).check();
    await page.waitForFunction(() => window.agentParityFixture.calls().length === 6);
    await page.waitForFunction(() => !(document.querySelector('input[aria-label="Allow network access"]') as HTMLInputElement).disabled);
    const calls = await page.evaluate(() => window.agentParityFixture.calls());
    assert.deepEqual(calls.map(call => call.params.edits[0]), [
      { keyPath: 'approval_policy', value: 'never', mergeStrategy: 'upsert' },
      { keyPath: 'sandbox_mode', value: 'workspace-write', mergeStrategy: 'upsert' },
      { keyPath: 'web_search', value: 'live', mergeStrategy: 'upsert' },
      { keyPath: 'model_verbosity', value: null, mergeStrategy: 'upsert' },
      { keyPath: 'model_reasoning_summary', value: 'detailed', mergeStrategy: 'upsert' },
      { keyPath: 'sandbox_workspace_write.network_access', value: true, mergeStrategy: 'upsert' },
    ]);
    assert.deepEqual(calls.map(call => call.params.expectedVersion), ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    await page.getByRole('button', { name: 'Open config.toml' }).click();
    assert.deepEqual(await page.evaluate(() => window.agentParityFixture.opened()), { hostId: 'local', file: '/fixture/codex/config.toml',
      source: { hostId: 'local', generation: 'fixture-generation', homeDirectory: '/fixture', codexHome: '/fixture/codex' } });
    if (process.env.CONFIG_PARITY_EVIDENCE) await page.screenshot({ path: process.env.CONFIG_PARITY_EVIDENCE, fullPage: true });
    await context.close();
  } finally { await browser.close(); }
});

test('actual AgentSection retains its IndexedDB draft and original unknown request on reload', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 45_000,
}, async () => {
  const bundle = await bundleFixture();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const page = await context.newPage(); await page.goto('http://agent-recovery-fixture.invalid/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('combobox', { name: 'Web search' }).waitFor();
    await page.waitForFunction(() => !(document.querySelector('select[aria-label="Web search"]') as HTMLSelectElement).disabled);
    await page.evaluate(() => window.agentParityFixture.failNext());
    await page.getByRole('combobox', { name: 'Web search' }).selectOption('live');
    await page.getByRole('alert').filter({ hasText: 'fixture lost acknowledgement' }).waitFor();
    const original = await page.evaluate(() => window.agentParityFixture.snapshot());
    assert.equal(original.records[0]?.phase, 'unknown'); assert.ok(original.drafts.length);
    const operationId = original.records[0]?.operationId;
    await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: 'Restore this edit' }).first().click();
    await page.waitForFunction(() => (document.querySelector('select[aria-label="Web search"]') as HTMLSelectElement).value === 'live');
    const recovered = await page.evaluate(() => window.agentParityFixture.snapshot());
    assert.equal(recovered.records[0]?.operationId, operationId);
    assert.equal(recovered.records[0]?.phase, 'unknown');
    assert.equal((await page.evaluate(() => window.agentParityFixture.calls())).length, 0);
    await context.close();
  } finally { await browser.close(); }
});
