import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

async function waitForBrowser(check: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for the asynchronous browser condition.')), 8_000);
  });
  try {
    for (;;) {
      if (await Promise.race([check(), timeout])) return;
      await Promise.race([new Promise(resolve => setTimeout(resolve, 30)), timeout]);
    }
  } finally { clearTimeout(timer); }
}

declare global {
  interface Window {
    settingsReviewHarness: {
      snapshot(): Promise<{ drafts: { editorId: string; section: string; draft: Record<string, unknown> }[] }>;
      failNextWrite(): void;
      holdTransaction(): Promise<void>;
      releaseTransaction(): void;
      setConfig(config: { model: string; effort: string; version: string }): void;
      setScope(path: string): void;
      setScopeStatus(state: 'ready' | 'loading'): void;
      actions(): string[];
    };
  }
}

async function fixture() {
  return build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneSettings} from './src/renderer/settings/StandaloneSettings.tsx';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    let location={pathname:locationPath(),search:'',hash:'',state:null};
    function locationPath(){const section=new URL(window.location.href).searchParams.get('section');return section==='hooks'?'/settings/hooks-settings':section==='skills'?'/settings/skills-settings':'/settings/models';}
    let rootPath='/fixture/one', scopeState='ready', fail=false, locked=false;
    const actions=[];
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(fail && key==='native-atoms' && value?.atoms?.['codex-yard.settings-config-writes.v1']) {fail=false;throw Error('fixture IDB write failure');}
      return originalPut.call(this,value,key);
    };
    const source={hostId:'local',generation:'fixture',homeDirectory:'/fixture',codexHome:'/fixture/codex'};
    const hook={key:'one',eventName:'sessionStart',matcher:null,source:'user',sourcePath:'/fixture/hooks.json',trustStatus:'trusted',isManaged:false,enabled:true,handlerType:'command',command:'fixture',async:false};
    const client={subscribe:()=>()=>{},reply:async()=>{throw Error('Unexpected approval');},
      host:async(method,input={})=>{
        if(method==='refresh-remote-connections')return {remoteConnections:[]};
        if(method==='os-info')return {platform:'linux',isSystemBackdropSupported:false};
        if(method==='get-settings')return {values:{}};
        if(method.startsWith('get-'))return {exists:false};
        if(method==='configuration-write'){
          actions.push(input.action+':'+(input.method||''));
          if(input.action==='status')return {operation:null};
          if(input.action==='submit')return {outcome:'not-started',error:{message:'fixture prepare failed',uncertain:false},operation:{operationId:input.operationId,hostId:input.hostId,method:input.method,state:'preparing',storageError:true,observedTerminal:{kind:'not-sent'}}};
        }
        throw Error('Unexpected host call: '+method);
      },
      rpc:async(method,params)=>{
        const current=JSON.parse(localStorage.getItem('config')||'{"model":"alpha","effort":"high","version":"v1"}');
        if(method==='model/list')return {data:['alpha','beta','gamma'].map(model=>({id:model,model,displayName:model,isDefault:model==='alpha',supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'low'}]})),nextCursor:null};
        if(method==='config/read')return {config:{model:current.model,model_reasoning_effort:current.effort,profile:null},layers:[{name:{type:'user',file:'/fixture/codex/config.toml',profile:null},version:current.version}],yardConfigSource:source};
        if(method==='hooks/list')return {data:[{cwd:params.cwds[0],hooks:[hook],warnings:[],errors:[]}]};
        if(method==='skills/list')return {data:[{cwd:params.cwds[0],skills:[{name:'review',description:'Fixture skill',path:'/fixture/review/SKILL.md',scope:'repo',enabled:true}],errors:[]}],yardConfigSource:source};
        throw Error('Unexpected RPC: '+method);
      }};
    const ops=settingsConfigOperations(client), root=createRoot(document.getElementById('root'));
    const render=()=>root.render(<I18nProvider locale="en-US"><StandaloneSettings client={client} hostId="local" location={location}
      projectRoots={{hostId:'local',paths:[rootPath]}} sessionCwd={null} scopeStatus={{state:scopeState,retry:()=>{}}}
      InstructionEditor={()=>null} onClose={()=>{}} onNavigate={(path,options)=>{const url=new URL(path,window.location.href);
        location={pathname:url.pathname,search:url.search,hash:url.hash,state:options?.state};render();}} /></I18nProvider>);
    window.settingsReviewHarness={snapshot:async()=>{await ops.refresh();return ops.getSnapshot();},failNextWrite:()=>{fail=true;},
      setConfig:value=>localStorage.setItem('config',JSON.stringify(value)),setScope:path=>{rootPath=path;render();},
      setScopeStatus:state=>{scopeState=state;render();},actions:()=>actions,
      holdTransaction:()=>new Promise((resolve,reject)=>{const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
        request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('atoms','readwrite');locked=true;
          const next=()=>{if(!locked)return;const item=tx.objectStore('atoms').get('native-atoms');item.onsuccess=next;};
          tx.oncomplete=()=>db.close();tx.onabort=()=>db.close();next();resolve();};}),
      releaseTransaction:()=>{locked=false;}};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
}

test('actual settings navigation waits for exact IDB cleanup, preserves another page, and retries a failed discard', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await fixture();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const first = await context.newPage(), second = await context.newPage();
    for (const page of [first, second]) { await page.goto('http://settings-review-fixture.invalid/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); }
    await first.getByRole('combobox', { name: 'Model', exact: true }).selectOption('beta');
    await second.getByRole('combobox', { name: 'Reasoning effort' }).selectOption('low');
    await waitForBrowser(() => second.evaluate(async () => (await window.settingsReviewHarness.snapshot()).drafts.length === 2));
    const prior = await second.evaluate(() => window.settingsReviewHarness.snapshot());
    const other = prior.drafts.find(item => item.draft.effort === 'low'); assert.ok(other);
    await first.getByRole('button', { name: 'General', exact: true }).click();
    const dialog = first.getByRole('dialog', { name: 'Discard unsaved changes?' }); await dialog.waitFor();
    await first.evaluate(() => window.settingsReviewHarness.failNextWrite());
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await dialog.getByRole('alert').getByText(/Could not discard/).waitFor();
    assert.equal(await first.getByRole('combobox', { name: 'Model', exact: true }).inputValue(), 'beta');
    assert.equal((await second.evaluate(() => window.settingsReviewHarness.snapshot())).drafts.length, 2);
    await second.evaluate(() => window.settingsReviewHarness.holdTransaction());
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await first.waitForFunction(() => (document.querySelector('[aria-label="Model"]') as HTMLSelectElement | null)?.disabled === true);
    assert.equal(await dialog.getByRole('button', { name: 'Keep editing' }).isDisabled(), true);
    await second.evaluate(() => window.settingsReviewHarness.releaseTransaction());
    await first.getByRole('combobox', { name: 'Language' }).waitFor();
    await waitForBrowser(() => second.evaluate(async () => (await window.settingsReviewHarness.snapshot()).drafts.length === 1));
    const remaining = await second.evaluate(() => window.settingsReviewHarness.snapshot());
    assert.equal(remaining.drafts[0]?.editorId, other.editorId);
    assert.equal(remaining.drafts[0]?.draft.effort, 'low');
    await context.close();
  } finally { await browser.close(); }
});

test('live hook and skill pages release only their closed not-sent identities after host restart', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await fixture();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    for (const kind of ['hooks', 'skills'] as const) {
      const page = await context.newPage(); await page.goto(`http://settings-review-receipt.invalid/?section=${kind}`);
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const input = page.getByRole('checkbox', { name: kind === 'hooks' ? 'SessionStart hook 1' : 'review (repo, /fixture/review/SKILL.md)' });
      await input.uncheck(); await page.locator('.yard-inline-save').getByRole('button', { name: 'Save' }).click();
      const recovery = page.getByRole('region', { name: 'Configuration save recovery' });
      await recovery.getByText('The host has not saved its observed receipt yet.').waitFor();
      await recovery.getByRole('button', { name: 'Check original operation' }).click();
      await recovery.getByRole('button', { name: 'Confirm original save was not sent' }).click();
      await recovery.getByRole('button', { name: 'Close original operation' }).click();
      await recovery.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      const review = page.getByRole('button', { name: 'Use current state and keep edits' });
      await review.waitFor(); assert.equal(await review.isDisabled(), false); await review.click();
      assert.equal(await input.isChecked(), false);
      assert.deepEqual(await page.evaluate(() => window.settingsReviewHarness.actions()), [
        `submit:${kind === 'hooks' ? 'config/batchWrite' : 'skills/config/write'}`, 'status:',
      ]);
      await page.close();
    }
    await context.close();
  } finally { await browser.close(); }
});

test('scope discard and restored conflict remain visible through real component and browser transactions', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await fixture();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const hooks = await context.newPage(); await hooks.goto('http://settings-review-fixture.invalid/?section=hooks'); await hooks.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await hooks.getByRole('checkbox', { name: 'SessionStart hook 1' }).uncheck();
    await waitForBrowser(() => hooks.evaluate(async () => (await window.settingsReviewHarness.snapshot()).drafts.some(item => item.section === 'hooks-settings')));
    await hooks.evaluate(() => window.settingsReviewHarness.setScope('/fixture/two'));
    const scopeWarning = hooks.getByRole('alert').filter({ hasText: 'The selected project changed' }); await scopeWarning.waitFor();
    await hooks.evaluate(() => window.settingsReviewHarness.failNextWrite());
    await scopeWarning.getByRole('button', { name: 'Discard edits and switch scope' }).click();
    await hooks.getByText(/Could not save the newer edit in this browser/).waitFor();
    assert.match(await hooks.getByText('Scope:', { exact: false }).innerText(), /\/fixture\/one/);
    const holder = await context.newPage(); await holder.goto('http://settings-review-fixture.invalid/'); await holder.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await holder.getByRole('combobox', { name: 'Model', exact: true }).waitFor();
    await holder.evaluate(() => window.settingsReviewHarness.holdTransaction());
    await scopeWarning.getByRole('button', { name: 'Discard edits and switch scope' }).click();
    await hooks.waitForFunction(() => (document.querySelector('[aria-label="SessionStart hook 1"]') as HTMLInputElement | null)?.disabled === true);
    await hooks.evaluate(() => window.settingsReviewHarness.setScopeStatus('loading'));
    await hooks.getByRole('main').getByRole('status').waitFor();
    await holder.evaluate(() => window.settingsReviewHarness.releaseTransaction());
    await hooks.evaluate(() => window.settingsReviewHarness.setScopeStatus('ready'));
    await hooks.getByText('Scope: /fixture/two').waitFor();
    assert.equal((await hooks.evaluate(() => window.settingsReviewHarness.snapshot())).drafts.length, 0);

    const model = await context.newPage(); await model.goto('http://settings-review-fixture.invalid/'); await model.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await model.getByRole('combobox', { name: 'Model', exact: true }).selectOption('beta');
    await waitForBrowser(() => model.evaluate(async () => (await window.settingsReviewHarness.snapshot()).drafts.some(item => item.section === 'models')));
    await model.evaluate(() => window.settingsReviewHarness.setConfig({ model: 'gamma', effort: 'high', version: 'v2' }));
    await model.locator('.yard-inline-save').getByRole('button', { name: 'Save' }).click();
    await model.getByRole('button', { name: 'Reload', exact: true }).click();
    await model.getByRole('button', { name: 'Keep my change' }).waitFor();
    await waitForBrowser(() => model.evaluate(async () => (await window.settingsReviewHarness.snapshot()).drafts.some(item => Array.isArray(item.draft.conflicts) && item.draft.conflicts.includes('model'))));
    const original = (await model.evaluate(() => window.settingsReviewHarness.snapshot())).drafts.find(item => item.section === 'models'); assert.ok(original);
    await model.reload(); await model.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const saved = model.getByRole('region', { name: 'Saved configuration edits' });
    await saved.getByText(original.editorId, { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Restore this edit' }).click();
    await model.getByRole('button', { name: 'Keep my change' }).waitFor();
    assert.equal(await model.getByRole('combobox', { name: 'Model', exact: true }).inputValue(), 'beta');
    assert.equal(await model.locator('.yard-inline-save').getByRole('button', { name: 'Save' }).isDisabled(), true);
    await waitForBrowser(() => model.evaluate(async id => (await window.settingsReviewHarness.snapshot()).drafts.some(item => item.editorId !== id && item.section === 'models'), original.editorId));
    await model.evaluate(() => { window.settingsReviewHarness.setConfig({ model: 'beta', effort: 'high', version: 'v3' }); window.settingsReviewHarness.failNextWrite(); });
    await model.getByRole('button', { name: 'Reload', exact: true }).click();
    await model.getByText(/Could not save the newer edit in this browser/).waitFor();
    assert.equal(await model.getByRole('button', { name: 'Keep my change' }).count(), 0);
    await model.getByRole('button', { name: 'General', exact: true }).click();
    const dialog = model.getByRole('dialog', { name: 'Discard unsaved changes?' }); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await model.getByRole('combobox', { name: 'Language' }).waitFor();
    const remaining = (await model.evaluate(() => window.settingsReviewHarness.snapshot())).drafts;
    assert.deepEqual(remaining.map(item => item.editorId), [original.editorId]);
    await context.close();
  } finally { await browser.close(); }
});
