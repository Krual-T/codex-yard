import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window { localRecoveryFixture: any }
}

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('local recovered plugin edits remain available across an unrelated host write', {
  skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConfigurationRecovery} from './src/renderer/settings/ConfigurationRecovery.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    import {readBrowserAtoms, updateBrowserAtom} from './src/renderer/storage/ui-atoms.ts';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    const state={calls:[], pendingEvents:[], authority:true, provideAuthority:true, authorityChecks:0, mode:'unknown', wait:null, statusWait:null, holdStatus:false};
    const client={subscribe:()=>()=>{}, reply:async()=>{}, rpc:async(method)=>{state.calls.push({rpc:method});throw Error('unexpected RPC');},
      host:async(endpoint,input,options)=>{
        options?.assertBeforeSend?.();
        state.calls.push({endpoint,input:structuredClone(input)});
        if(endpoint!=='configuration-write')throw Error('unexpected host request');
        if(input.action==='status'&&state.holdStatus){await new Promise(resolve=>{state.statusWait=resolve;});return {operation:null};}
        if(input.action!=='submit')throw Error('unexpected host request');
        if(state.mode==='pending')await new Promise(resolve=>{state.wait=resolve;});
        if(state.mode==='blocked')return {outcome:'blocked',operation:{operationId:'other-host-operation',hostId:'local',method:'config/batchWrite',state:'pending'}};
        throw Error('fixture original reply lost');
      }};
    const operations=settingsConfigOperations(client);
    const source={hostId:'local',generation:'fixture-generation',homeDirectory:'/fixture/home',codexHome:'/fixture/codex'};
    const submit=(scope,enabled,canDispatch=()=>true)=>operations.submit('local','config/batchWrite',
      {edits:[{keyPath:'plugins.demo.enabled',value:enabled}]},
      {section:'plugins-settings',scope:[scope],source,draft:{pluginId:'demo',enabled,sourceType:'local',extra:'keep'}},canDispatch);
    window.localRecoveryFixture={state,
      async prepare(){await updateBrowserAtom('fixture-unrelated',()=>({keep:['root',1]}));
        await operations.saveDraft('local','plugins-settings',['/other'],'recovered:other',{pluginId:'other',enabled:false,originalSource:source});
        try{await submit('/project-b',true,()=>false);}catch{}},
      start(mode){state.mode=mode;void submit('/project-a',false).catch(()=>{});},
      release(){state.wait?.();},
      releaseStatus(){state.statusWait?.();},
      disconnect(){state.authority=false;state.authorityChecks=0;},
      removeAuthority(){state.provideAuthority=false;state.authorityChecks=0;render();},
      async snapshot(){await operations.refresh();return {operations:operations.getSnapshot(),atoms:await readBrowserAtoms()};}};
    const captureAuthority=()=>()=>{state.authorityChecks++;if(!state.authority)throw Error('original host is disconnected');};
    const root=createRoot(document.getElementById('root'));
    const render=()=>root.render(<I18nProvider locale="en-US"><ConfigurationRecovery client={client} hostId="local"
      captureAuthority={state.provideAuthority?captureAuthority:undefined} onPendingChange={pending=>state.pendingEvents.push(pending)}/></I18nProvider>);
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-sync', '--disable-component-update'] });
  try {
    for (const phase of ['pending', 'unknown', 'blocked'] as const) {
      await t.test(`${phase}: edit and discard only the recovered copy while host save remains fenced`, async () => {
        const context = await browser.newContext();
        const blocked: string[] = [];
        await context.route('**/*', route => {
          if (route.request().url() === 'http://127.0.0.1/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
          blocked.push(route.request().url()); return route.abort();
        });
        const page = await context.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8_000);
        try {
          await page.goto('http://127.0.0.1/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
          await page.evaluate(() => window.localRecoveryFixture.prepare());
          await page.getByRole('button', { name: 'Restore original plugin edit' }).click();
          const row = page.getByRole('article').filter({ hasText: '/project-b' });
          await row.getByRole('switch', { name: 'Plugin enabled' }).waitFor();
          const before = await page.evaluate(() => window.localRecoveryFixture.snapshot());
          const b = before.operations.drafts.find((draft: any) => draft.scope[0] === '/project-b');
          const other = before.operations.drafts.find((draft: any) => draft.editorId === 'recovered:other');
          assert.ok(b && other); assert.equal(b.draft.enabled, true);
          await page.evaluate(value => window.localRecoveryFixture.start(value), phase);
          await page.waitForFunction(expected => window.localRecoveryFixture.state.calls.length === 1
            && document.querySelector('[aria-label="Configuration save recovery"]')?.textContent?.includes('plugins-settings | local | ' + expected), phase);
          const fenced = await page.evaluate(() => window.localRecoveryFixture.snapshot());
          const originalA = fenced.operations.records.find((record: any) => record.origin.scope[0] === '/project-a');
          assert.equal(originalA.phase, phase);
          if (phase === 'pending') assert.equal(fenced.operations.inFlight.length, 1);
          assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
          await page.evaluate(() => window.localRecoveryFixture.disconnect());
          const control = row.getByRole('switch', { name: 'Plugin enabled' });
          assert.equal(await control.isEnabled(), true, 'local edit must not require host write authority');
          assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
          await control.uncheck();
          await page.waitForFunction(revision => {
            const row = [...document.querySelectorAll('article')].find(element => element.textContent?.includes('/project-b'));
            return row?.textContent?.includes('Revision: ' + revision) && !row.textContent?.includes('Unconfirmed choice:');
          }, b.revision + 1);
          let after = await page.evaluate(() => window.localRecoveryFixture.snapshot());
          const edited = after.operations.drafts.find((draft: any) => draft.editorId === b.editorId);
          assert.deepEqual(edited, { ...b, revision: b.revision + 1, draft: { ...b.draft, enabled: false } });
          assert.deepEqual(after.operations.records.find((record: any) => record.operationId === originalA.operationId), originalA);
          assert.deepEqual(after.operations.drafts.find((draft: any) => draft.editorId === other.editorId), other);
          assert.deepEqual(after.atoms['fixture-unrelated'], { keep: ['root', 1] });
          assert.deepEqual(after.atoms['codex-yard.settings-config-writes.v1'].closedNotSent, fenced.atoms['codex-yard.settings-config-writes.v1'].closedNotSent);
          assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
          await row.getByRole('button', { name: 'Discard this copy' }).click();
          await row.getByRole('button', { name: 'Confirm discard of this copy' }).click();
          await row.waitFor({ state: 'detached' });
          after = await page.evaluate(() => window.localRecoveryFixture.snapshot());
          assert.equal(after.operations.drafts.some((draft: any) => draft.editorId === b.editorId), false);
          assert.deepEqual(after.operations.records.find((record: any) => record.operationId === originalA.operationId), originalA);
          assert.deepEqual(after.operations.drafts.find((draft: any) => draft.editorId === other.editorId), other);
          assert.deepEqual(after.atoms['fixture-unrelated'], { keep: ['root', 1] });
          assert.deepEqual(after.atoms['codex-yard.settings-config-writes.v1'].closedNotSent, fenced.atoms['codex-yard.settings-config-writes.v1'].closedNotSent);
          const state = await page.evaluate(() => window.localRecoveryFixture.state);
          assert.equal(state.calls.length, 1, 'only the original host attempt may be dispatched');
          assert.equal(state.authorityChecks, 0); assert.deepEqual(state.pendingEvents, [true, false]);
          assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
          if (phase === 'pending') await page.evaluate(() => window.localRecoveryFixture.release());
        } finally { await context.close(); }
      });
    }
    await t.test('local editing remains available while a host status check is in flight', async () => {
      const context = await browser.newContext();
      const blocked: string[] = [];
      await context.route('**/*', route => {
        if (route.request().url() === 'http://127.0.0.1/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        blocked.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8_000);
      try {
        await page.goto('http://127.0.0.1/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.evaluate(() => window.localRecoveryFixture.prepare());
        await page.getByRole('button', { name: 'Restore original plugin edit' }).click();
        const row = page.getByRole('article').filter({ hasText: '/project-b' });
        await row.getByRole('switch', { name: 'Plugin enabled' }).waitFor();
        await page.evaluate(() => window.localRecoveryFixture.start('unknown'));
        await page.waitForFunction(() => document.querySelector('[aria-label="Configuration save recovery"]')?.textContent?.includes('plugins-settings | local | unknown'));
        const before = await page.evaluate(() => window.localRecoveryFixture.snapshot());
        const originalA = before.operations.records.find((record: any) => record.origin.scope[0] === '/project-a');
        const b = before.operations.drafts.find((draft: any) => draft.scope[0] === '/project-b');
        await page.evaluate(() => { window.localRecoveryFixture.state.holdStatus = true; });
        await page.getByRole('button', { name: 'Check original operation' }).click();
        await page.waitForFunction(() => !!window.localRecoveryFixture.state.statusWait);
        await page.evaluate(() => window.localRecoveryFixture.disconnect());
        assert.equal(await row.getByRole('switch', { name: 'Plugin enabled' }).isEnabled(), true);
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await row.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await page.waitForFunction(revision => [...document.querySelectorAll('article')].find(element => element.textContent?.includes('/project-b'))
          ?.textContent?.includes('Revision: ' + revision), b.revision + 1);
        await row.getByRole('button', { name: 'Discard this copy' }).click();
        await row.getByRole('button', { name: 'Confirm discard of this copy' }).click();
        await row.waitFor({ state: 'detached' });
        const after = await page.evaluate(() => window.localRecoveryFixture.snapshot());
        assert.deepEqual(after.operations.records.find((record: any) => record.operationId === originalA.operationId), originalA);
        assert.equal(after.operations.drafts.some((draft: any) => draft.editorId === b.editorId), false);
        const state = await page.evaluate(() => window.localRecoveryFixture.state);
        assert.deepEqual(state.calls.map((call: any) => call.input.action), ['submit', 'status']);
        assert.equal(state.authorityChecks, 0); assert.deepEqual(state.pendingEvents, [true, false]);
        assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
        await page.evaluate(() => window.localRecoveryFixture.releaseStatus());
      } finally { await context.close(); }
    });
    await t.test('missing host authority still permits only the local draft actions', async () => {
      const context = await browser.newContext();
      const blocked: string[] = [];
      await context.route('**/*', route => {
        if (route.request().url() === 'http://127.0.0.1/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        blocked.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8_000);
      try {
        await page.goto('http://127.0.0.1/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.evaluate(() => window.localRecoveryFixture.prepare());
        await page.getByRole('button', { name: 'Restore original plugin edit' }).click();
        const row = page.getByRole('article').filter({ hasText: '/project-b' });
        await row.getByRole('switch', { name: 'Plugin enabled' }).waitFor();
        const before = await page.evaluate(() => window.localRecoveryFixture.snapshot());
        const b = before.operations.drafts.find((draft: any) => draft.scope[0] === '/project-b');
        await page.evaluate(() => window.localRecoveryFixture.removeAuthority());
        await page.waitForFunction(() => [...document.querySelectorAll('article')].find(element => element.textContent?.includes('/project-b'))
          ?.querySelector<HTMLButtonElement>('button')?.disabled);
        assert.equal(await row.getByRole('switch', { name: 'Plugin enabled' }).isEnabled(), true);
        await row.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await page.waitForFunction(revision => [...document.querySelectorAll('article')].find(element => element.textContent?.includes('/project-b'))
          ?.textContent?.includes('Revision: ' + revision), b.revision + 1);
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await row.getByRole('button', { name: 'Discard this copy' }).click();
        await row.getByRole('button', { name: 'Confirm discard of this copy' }).click();
        await row.waitFor({ state: 'detached' });
        const state = await page.evaluate(() => window.localRecoveryFixture.state);
        assert.deepEqual(state.calls, []); assert.equal(state.authorityChecks, 0);
        assert.deepEqual(state.pendingEvents, [true, false]); assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
