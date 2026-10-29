import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

declare global {
  interface Window { homeBannerFixture: any; homeBannerOptions: any }
}

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('home subagent banner uses the real browser atoms, config operations and composer draft', {
  skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {HomeSubagentsBanner} from './src/renderer/app/HomeSubagentsBanner.tsx';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {browserAtom} from './src/renderer/app/browser-atoms.ts';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';

    const options=window.homeBannerOptions||{};
    const state={host:'local',cwd:'/workspace',grant:1,bannerEpoch:1,sourceGeneration:'generation-1',configVersion:1,
      feature:options.enabled===true,remoteFeature:true,featureError:!!options.featureError,featureHeld:!!options.featureHeld,
      writeMode:'success',failSeen:0,seenSaved:false,featureWaiters:[],writeWaiters:[],events:new Set(),calls:[],errors:[],prefills:[],sends:[],controller:null};
    const grants=new WeakMap();
    const source=hostId=>({hostId,generation:state.sourceGeneration,homeDirectory:'/fixture',codexHome:'/fixture/codex'});
    const client={
      async rpc(method,params={},host='local',dispatch={}) {
        dispatch.assertBeforeSend?.(); state.calls.push({kind:'rpc',method,host,params:structuredClone(params)});
        if(method==='experimentalFeature/list'){
          const enabled=host==='remote' ? state.remoteFeature : state.feature, failed=state.featureError;
          if(state.featureHeld && host==='local') await new Promise(resolve=>state.featureWaiters.push(resolve));
          if(failed)throw Error('fixture feature list failure');
          return params.cursor===null ? {data:[{name:'other',enabled:false}],nextCursor:'page-2'}
            : {data:options.featureMissing?[]:[{name:'multi_agent',enabled}],nextCursor:null};
        }
        if(method==='config/read')return {config:{model:'fixture',model_reasoning_effort:'high',approval_policy:'on-request',sandbox_mode:'read-only'},
          layers:[{name:{type:'user',file:'/fixture/codex/config.toml',profile:null},version:'v'+state.configVersion}],yardConfigSource:source(host)};
        if(method==='model/list')return {data:[{id:'fixture',model:'fixture',displayName:'Fixture',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};
        if(method==='configRequirements/read')return {requirements:null};
        if(method==='permissionProfile/list')return {data:[{id:':read-only',allowed:true}],nextCursor:null};
        throw Error('Unexpected fixture RPC '+method);
      },
      async host(endpoint,params={},dispatch={}) {
        if(endpoint==='get-persisted-atom'||endpoint==='set-persisted-atom') {
          if(endpoint==='set-persisted-atom' && state.failSeen>0){state.failSeen--;throw Error('fixture seen write failure');}
          const result=await browserAtom(endpoint,params,dispatch.assertBeforeSend);
          if(endpoint==='set-persisted-atom')state.seenSaved=true;
          return result;
        }
        if(endpoint==='get-setting')return {exists:false};
        if(endpoint==='configuration-write'){
          if(params.action==='status'||params.action==='retry-persistence'){
            state.calls.push({kind:'host',endpoint,params:structuredClone(params)});
            return {operation:state.receipt||null};
          }
          if(state.writeMode==='hold-before')await new Promise(resolve=>state.writeWaiters.push(resolve));
          try{dispatch.assertBeforeSend?.();}catch(error){throw Object.assign(error,{uncertain:false,sendPhase:'before-send'});}
          state.calls.push({kind:'host',endpoint,params:structuredClone(params)});
          if(params.params.expectedVersion!=='v'+state.configVersion)throw Error('fixture version mismatch');
          const common={operationId:params.operationId,hostId:params.hostId,method:params.method};
          if(state.writeMode==='rejected'){
            state.receipt={...common,state:'failed',terminal:{kind:'rejected',category:'configVersionConflict'}};
            return {outcome:'error',error:{message:'fixture version conflict',uncertain:false},operation:state.receipt};
          }
          state.feature=true;state.configVersion++;
          state.receipt={...common,state:'succeeded',terminal:{kind:state.writeMode==='overridden'?'okOverridden':'ok'}};
          if(state.writeMode==='hold-after')await new Promise(resolve=>state.writeWaiters.push(resolve));
          if(state.writeMode==='lost')throw Object.assign(Error('fixture acknowledgement lost'),{uncertain:true});
          return {outcome:'success',result:{status:state.receipt.terminal.kind},operation:state.receipt};
        }
        if(endpoint==='codex-home')return {codexHome:'/fixture/codex'};
        throw Error('Unexpected fixture host '+endpoint);
      },
      subscribe(listener){state.events.add(listener);return ()=>state.events.delete(listener);},
      async reply(){throw Error('Unexpected approval');},
    };
    const operations=settingsConfigOperations(client);
    const onController=controller=>{state.controller=controller;};
    function captureMain(){
      const controller=state.controller, before=controller?.snapshot(), epoch=state.grant, host=state.host, cwd=state.cwd;
      if(!controller||!before)throw Error('Main composer unavailable');
      let revision=before.revision;
      const check=()=>{const now=controller.snapshot();
        if(state.grant!==epoch||state.host!==host||state.cwd!==cwd||state.controller!==controller||!now||
          JSON.stringify(now.owner)!==JSON.stringify(before.owner)||now.revision!==revision)throw Error('original Main authority changed');};
      check();grants.set(check,{controller,before,advance(){
        if(state.grant!==epoch||state.host!==host||state.cwd!==cwd||state.controller!==controller)throw Error('original Main authority changed');
        const now=controller.snapshot();if(!now||JSON.stringify(now.owner)!==JSON.stringify(before.owner))throw Error('original Main owner changed');
        revision=now.revision;check();
      }});return check;
    }
    async function onTryNow(text,id,check){
      check();const grant=grants.get(check);if(!grant)throw Error('missing original Main grant');
      const operation=grant.controller.beginExternalOperation(grant.before.owner);if(!operation)throw Error('original draft is busy');
      let accepted=false;
      try{check();accepted=await operation.applyPrefill({id,draft:{text,images:[],files:[]}});
        if(!accepted)throw Error('prefill not saved');grant.advance();state.prefills.push({text,id});
      }finally{operation.finish(accepted);}
    }
    const root=createRoot(document.getElementById('root'));
    const render=()=>root.render(<I18nProvider locale={options.locale||'en-US'}><main style={{maxWidth:736,margin:'0 auto'}}>
      <HomeSubagentsBanner key={state.bannerEpoch} client={client} hostId={state.host} cwd={state.cwd} captureMain={captureMain} onTryNow={onTryNow} onError={message=>state.errors.push(message)}/>
      <StandaloneComposer key={state.host} client={client} context={{hostId:state.host,threadId:null,draftId:'fixture-'+state.host,cwd:state.cwd}}
        busy={false} initialOptions={{model:'fixture',effort:'high',approvalPolicy:'on-request',sandboxMode:'read-only'}}
        onDraftController={onController} onSubmit={async (...args)=>{state.sends.push(args);}} onInterrupt={async()=>{}} />
    </main></I18nProvider>);
    window.homeBannerFixture={state,render,
      async snapshot(){await operations.refresh();return structuredClone(operations.getSnapshot());},
      snapshotNow(){return operations.getSnapshot();},
      async atom(){return browserAtom('get-persisted-atom',{key:'has-seen-multi-agent-composer-banner'});},
      async flush(){const c=state.controller;return c?.flush(c.snapshot().owner);},
      changeHost(host){state.grant++;state.host=host;state.cwd=host==='local'?'/workspace':'/remote';render();},
      remountBanner(){state.grant++;state.bannerEpoch++;render();},
      revoke(){state.grant++;},
      releaseFeature(){state.featureHeld=false;for(const done of state.featureWaiters.splice(0))done();},
      releaseWrite(){for(const done of state.writeWaiters.splice(0))done();},
    };
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-sync', '--disable-component-update'] });
  const open = async (options: Record<string, unknown> = {}, width = 1000): Promise<{ context: BrowserContext; page: Page; errors: string[] }> => {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === 'http://banner.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await context.addInitScript(value => { window.homeBannerOptions = value; }, options);
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8_000);
    await page.goto('http://banner.test/');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.addStyleTag({ content: readFileSync('src/renderer/app/app.css', 'utf8') });
    await page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') });
    await page.addStyleTag({ content: readFileSync('src/renderer/app/HomeSubagentsBanner.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('textbox', { name: options.locale === 'zh-CN' ? '与 Codex 协作' : 'Work with Codex' }).waitFor();
    return { context, page, errors };
  };
  const writeDraft = async (page: Page, value: string) => {
    const editor = page.getByRole('textbox', { name: 'Work with Codex' });
    await editor.fill(value);
    await page.waitForFunction(text => window.homeBannerFixture.state.controller?.snapshot()?.draft.text === text, value);
    assert.equal(await page.evaluate(() => window.homeBannerFixture.flush()), true);
  };
  try {
    await t.test('successful versioned write preserves and prefills the existing draft once', async () => {
      const { context, page, errors } = await open();
      try {
        const button = page.getByRole('button', { name: 'Try now' }); await button.waitFor();
        if (process.env.YARD_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.YARD_TEST_ARTIFACTS, 'home-subagents-desktop.png') });
        await writeDraft(page, 'Existing draft'); await button.click();
        await page.waitForFunction(() => window.homeBannerFixture.state.prefills.length === 1);
        await page.waitForFunction(() => window.homeBannerFixture.state.seenSaved);
        const result = await page.evaluate(async () => ({ state: {
          calls: window.homeBannerFixture.state.calls, prefills: window.homeBannerFixture.state.prefills,
          sends: window.homeBannerFixture.state.sends, draft: window.homeBannerFixture.state.controller.snapshot().draft.text,
        }, recovery: await window.homeBannerFixture.snapshot() }));
        const writes = result.state.calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit');
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].params.params, { edits: [{ keyPath: 'features.multi_agent', value: true, mergeStrategy: 'upsert' }],
          filePath: null, expectedVersion: 'v1', reloadUserConfig: true });
        assert.equal(writes[0].params.source.generation, 'generation-1');
        assert.match(result.state.draft, /Existing draft/); assert.match(result.state.draft, /Spawn a subagent to explore this repo\./);
        assert.equal(result.state.prefills[0].id, writes[0].params.operationId);
        assert.equal(result.state.sends.length, 0);
        await page.waitForFunction(() => !window.homeBannerFixture.snapshotNow().records.length);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('loading, pagination, failure retry and persisted dismissal use the actual atom', async () => {
      const { context, page, errors } = await open({ featureHeld: true });
      try {
        await page.getByRole('status').filter({ hasText: 'Loading experimental features' }).waitFor();
        await page.evaluate(() => window.homeBannerFixture.releaseFeature());
        await page.getByRole('button', { name: 'Dismiss subagent banner' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.seenSaved);
        assert.equal((await page.evaluate(() => window.homeBannerFixture.atom())).value, true);
        const calls = await page.evaluate(() => window.homeBannerFixture.state.calls);
        assert.deepEqual(calls.filter((call: any) => call.method === 'experimentalFeature/list').map((call: any) => call.params.cursor), [null, 'page-2']);
        await page.evaluate(() => window.homeBannerFixture.render());
        assert.equal(await page.getByRole('button', { name: 'Try now' }).count(), 0);
        assert.equal(calls.filter((call: any) => call.endpoint === 'configuration-write').length, 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
      const failed = await open({ featureError: true });
      try {
        await failed.page.getByRole('alert').filter({ hasText: 'fixture feature list failure' }).waitFor();
        await failed.page.evaluate(() => { window.homeBannerFixture.state.featureError = false; });
        await failed.page.getByRole('button', { name: 'Retry', exact: true }).click();
        await failed.page.getByRole('button', { name: 'Try now' }).waitFor();
        assert.deepEqual(failed.errors, []);
      } finally { await failed.context.close(); }
    });

    await t.test('enabled features suppress the banner, and a late old-host page cannot change the new gate', async () => {
      const enabled = await open({ enabled: true });
      try {
        await enabled.page.waitForFunction(() => window.homeBannerFixture.state.calls.filter((call: any) => call.method === 'experimentalFeature/list').length === 2);
        await enabled.page.waitForFunction(() => !document.querySelector('.yard-home-subagents-banner'));
        assert.deepEqual(enabled.errors, []);
      } finally { await enabled.context.close(); }
      const old = await open({ featureHeld: true });
      try {
        await old.page.waitForFunction(() => window.homeBannerFixture.state.featureWaiters.length === 1);
        await old.page.evaluate(() => window.homeBannerFixture.changeHost('remote'));
        await old.page.waitForFunction(() => window.homeBannerFixture.state.calls.some((call: any) => call.method === 'experimentalFeature/list' && call.host === 'remote' && call.params.cursor === 'page-2'));
        await old.page.evaluate(() => window.homeBannerFixture.releaseFeature());
        await old.page.waitForFunction(() => !document.querySelector('.yard-home-subagents-banner'));
        assert.equal(await old.page.getByRole('button', { name: 'Try now' }).count(), 0);
        assert.deepEqual(old.errors, []);
      } finally { await old.context.close(); }
    });

    await t.test('a successfully listed missing feature remains eligible', async () => {
      const { context, page, errors } = await open({ featureMissing: true });
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor();
        const calls = await page.evaluate(() => window.homeBannerFixture.state.calls);
        assert.deepEqual(calls.filter((call: any) => call.method === 'experimentalFeature/list').map((call: any) => call.params.cursor), [null, 'page-2']);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('unknown write remains fenced until explicit status and continues the same operation', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'Kept draft');
        await page.evaluate(() => { window.homeBannerFixture.state.writeMode = 'lost'; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.getByRole('button', { name: 'Check original operation' }).waitFor();
        let saved = await page.evaluate(() => window.homeBannerFixture.snapshot());
        assert.equal(saved.records[0].phase, 'unknown'); assert.deepEqual(saved.records[0].origin.scope, ['features.multi_agent']);
        assert.equal((await page.evaluate(() => window.homeBannerFixture.atom())).value, undefined);
        assert.equal(await page.evaluate(() => window.homeBannerFixture.state.prefills.length), 0);
        await page.getByRole('button', { name: 'Check original operation' }).click();
        await page.getByRole('button', { name: 'Continue original request' }).waitFor();
        saved = await page.evaluate(() => window.homeBannerFixture.snapshot());
        assert.equal(saved.records[0].phase, 'finished');
        await page.getByRole('button', { name: 'Continue original request' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.seenSaved);
        const calls = await page.evaluate(() => window.homeBannerFixture.state.calls);
        assert.equal(calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit').length, 1);
        assert.equal(await page.evaluate(() => window.homeBannerFixture.state.prefills.length), 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('remount observes the unknown original without replaying or acquiring its old composer grant', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'Original draft');
        await page.evaluate(() => { window.homeBannerFixture.state.writeMode = 'lost'; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.getByRole('button', { name: 'Check original operation' }).waitFor();
        const original = (await page.evaluate(() => window.homeBannerFixture.snapshot())).records[0].operationId;
        await page.evaluate(() => window.homeBannerFixture.remountBanner());
        await page.getByRole('button', { name: 'Check original operation' }).click();
        await page.waitForFunction((id: string) => window.homeBannerFixture.snapshotNow().records.some((entry: any) => entry.operationId === id && entry.phase === 'finished'), original);
        assert.equal(await page.getByRole('button', { name: 'Continue original request' }).count(), 0);
        const result = await page.evaluate(async () => ({ calls: window.homeBannerFixture.state.calls, prefills: window.homeBannerFixture.state.prefills,
          draft: window.homeBannerFixture.state.controller.snapshot().draft.text, atom: await window.homeBannerFixture.atom() }));
        assert.equal(result.calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit').length, 1);
        assert.equal(result.prefills.length, 0); assert.equal(result.draft, 'Original draft'); assert.equal(result.atom.value, undefined);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('revoked original owner before dispatch preserves the draft and sends no write', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'Keep me');
        await page.evaluate(() => { window.homeBannerFixture.state.writeMode = 'hold-before'; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.writeWaiters.length === 1);
        await page.evaluate(() => { window.homeBannerFixture.revoke(); window.homeBannerFixture.releaseWrite(); });
        await page.getByRole('alert').filter({ hasText: 'original Main authority changed' }).first().waitFor();
        const result = await page.evaluate(async () => ({ snapshot: await window.homeBannerFixture.snapshot(), atom: await window.homeBannerFixture.atom(),
          state: { calls: window.homeBannerFixture.state.calls, prefills: window.homeBannerFixture.state.prefills,
            draft: window.homeBannerFixture.state.controller.snapshot().draft.text } }));
        assert.equal(result.snapshot.records[0].phase, 'not-started');
        assert.equal(result.state.calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit').length, 0);
        assert.equal(result.state.prefills.length, 0); assert.equal(result.atom.value, undefined); assert.equal(result.state.draft, 'Keep me');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a document edit while dispatch waits cannot be replaced or used as the original grant', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'First');
        await page.evaluate(() => { window.homeBannerFixture.state.writeMode = 'hold-before'; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.writeWaiters.length === 1);
        await writeDraft(page, 'Newer document');
        await page.evaluate(() => window.homeBannerFixture.releaseWrite());
        await page.getByRole('alert').filter({ hasText: 'original Main authority changed' }).first().waitFor();
        const result = await page.evaluate(async () => ({ snapshot: await window.homeBannerFixture.snapshot(), atom: await window.homeBannerFixture.atom(),
          calls: window.homeBannerFixture.state.calls, draft: window.homeBannerFixture.state.controller.snapshot().draft.text }));
        assert.equal(result.snapshot.records[0].phase, 'not-started'); assert.equal(result.atom.value, undefined);
        assert.equal(result.calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit').length, 0);
        assert.equal(result.draft, 'Newer document'); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a changed configuration source preserves the successful receipt without prefill or dismissal', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'Source-bound draft');
        await page.evaluate(() => { window.homeBannerFixture.state.writeMode = 'hold-after'; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.writeWaiters.length === 1);
        await page.evaluate(() => { window.homeBannerFixture.state.sourceGeneration = 'generation-2'; window.homeBannerFixture.releaseWrite(); });
        await page.getByRole('alert').filter({ hasText: 'original configuration source changed' }).waitFor();
        const result = await page.evaluate(async () => ({ snapshot: await window.homeBannerFixture.snapshot(), atom: await window.homeBannerFixture.atom(),
          state: { calls: window.homeBannerFixture.state.calls, prefills: window.homeBannerFixture.state.prefills,
            draft: window.homeBannerFixture.state.controller.snapshot().draft.text } }));
        assert.equal(result.snapshot.records[0].phase, 'finished'); assert.equal(result.snapshot.records[0].operation.state, 'succeeded');
        assert.equal(result.state.calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit').length, 1);
        assert.equal(result.state.prefills.length, 0); assert.equal(result.atom.value, undefined);
        assert.equal(result.state.draft, 'Source-bound draft'); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a late old-host write releases the new host UI without moving its original receipt', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'Old host draft');
        await page.evaluate(() => { window.homeBannerFixture.state.writeMode = 'hold-after'; window.homeBannerFixture.state.remoteFeature = false; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.writeWaiters.length === 1);
        await page.evaluate(() => window.homeBannerFixture.changeHost('remote'));
        const button = page.getByRole('button', { name: 'Try now' }); await button.waitFor();
        await page.evaluate(() => window.homeBannerFixture.releaseWrite());
        await page.waitForFunction(() => !(document.querySelector('.yard-home-subagents-banner__try') as HTMLButtonElement)?.disabled);
        const result = await page.evaluate(async () => ({ snapshot: await window.homeBannerFixture.snapshot(), atom: await window.homeBannerFixture.atom(),
          state: { calls: window.homeBannerFixture.state.calls, prefills: window.homeBannerFixture.state.prefills,
            owner: window.homeBannerFixture.state.controller.snapshot().owner } }));
        assert.equal(result.snapshot.records[0].hostId, 'local'); assert.equal(result.snapshot.records[0].phase, 'finished');
        assert.equal(result.state.owner.hostId, 'remote'); assert.equal(result.state.prefills.length, 0); assert.equal(result.atom.value, undefined);
        assert.equal(result.state.calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit').length, 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('settled rejection still prefills and marks seen while retaining the original conflict', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'Draft');
        await page.evaluate(() => { window.homeBannerFixture.state.writeMode = 'rejected'; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.seenSaved && window.homeBannerFixture.state.errors.length > 0
          && window.homeBannerFixture.snapshotNow().records[0]?.phase === 'finished');
        const result = await page.evaluate(async () => ({ snapshot: await window.homeBannerFixture.snapshot(), state: {
          prefills: window.homeBannerFixture.state.prefills, errors: window.homeBannerFixture.state.errors,
          feature: window.homeBannerFixture.state.feature, draft: window.homeBannerFixture.state.controller.snapshot().draft.text } }));
        assert.equal(result.snapshot.records[0]?.operation?.terminal?.category, 'configVersionConflict', JSON.stringify(result.snapshot.records));
        assert.equal(result.state.prefills.length, 1); assert.equal(result.state.feature, false);
        assert.match(result.state.draft, /Draft/); assert.match(result.state.draft, /Spawn a subagent/); assert.ok(result.state.errors.length);
        await page.getByRole('button', { name: 'Close original operation' }).waitFor();
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('failed seen persistence can continue without repeating the prefill or configuration write', async () => {
      const { context, page, errors } = await open();
      try {
        await page.getByRole('button', { name: 'Try now' }).waitFor(); await writeDraft(page, 'Retained');
        await page.evaluate(() => { window.homeBannerFixture.state.failSeen = 1; });
        await page.getByRole('button', { name: 'Try now' }).click();
        await page.getByRole('alert').filter({ hasText: 'fixture seen write failure' }).waitFor();
        await page.getByRole('button', { name: 'Continue original request' }).click();
        await page.waitForFunction(() => window.homeBannerFixture.state.seenSaved);
        const state = await page.evaluate(() => window.homeBannerFixture.state);
        assert.equal(state.prefills.length, 1);
        assert.equal(state.calls.filter((call: any) => call.kind === 'host' && call.params.action === 'submit').length, 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    if (process.env.YARD_HOME_SUBAGENTS_HISTORY_PROBE) await t.test('parent prefill preserves the existing editor undo history', async () => {
      const { context, page } = await open();
      try {
        const button = page.getByRole('button', { name: 'Try now' }); await button.waitFor();
        const editor = page.getByRole('textbox', { name: 'Work with Codex' });
        await editor.pressSequentially('Original draft');
        assert.equal(await page.evaluate(() => window.homeBannerFixture.flush()), true);
        await button.click(); await page.waitForFunction(() => window.homeBannerFixture.state.seenSaved);
        await editor.press('Control+z');
        assert.equal(await editor.inputValue(), 'Original draft');
      } finally { await context.close(); }
    });

    await t.test('Chinese and narrow layout remain readable with theme and font settings', async () => {
      const { context, page, errors } = await open({ locale: 'zh-CN' }, 360);
      try {
        await page.getByRole('button', { name: '立即试用' }).waitFor();
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.setProperty('--yard-ui-font', 'Arial');
          document.documentElement.style.setProperty('--yard-font-size', '16px'); });
        assert.equal(await page.getByText('Codex 中的子智能体').count(), 1);
        const metrics = await page.locator('.yard-home-subagents-banner__content').evaluate(element => {
          const rect = element.getBoundingClientRect(), copy = element.querySelector('.yard-home-subagents-banner__copy')!.getBoundingClientRect();
          const button = element.querySelector('.yard-home-subagents-banner__try')!.getBoundingClientRect();
          return { width: rect.width, height: rect.height, scroll: element.scrollWidth, copy, button, font: getComputedStyle(element).fontFamily };
        });
        assert.ok(metrics.height >= 80); assert.ok(metrics.scroll <= metrics.width + 1);
        assert.ok(metrics.copy.right <= metrics.width + 13 + 1); assert.ok(metrics.button.top >= metrics.copy.bottom);
        assert.match(metrics.font, /Arial/); assert.deepEqual(errors, []);
        if (process.env.YARD_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.YARD_TEST_ARTIFACTS, 'home-subagents-narrow.png') });
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
