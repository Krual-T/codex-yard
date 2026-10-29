import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('home model preferences use versioned single-field writes and thread choices remain local', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    const saved=()=>JSON.parse(localStorage.getItem('fixture-config')||'{"model":null,"model_reasoning_effort":null,"profile":"work","version":1}');
    const state={calls:[],submissions:[],mode:'ok'};
    const models=['alpha','beta','gamma'].map((model,index)=>({id:model,model,displayName:model.toUpperCase(),isDefault:index===0,
      defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}));
    const client={async rpc(method,params={},hostId){state.calls.push({method,params:structuredClone(params),hostId});
      if(method==='model/list')return {data:models,nextCursor:null};
      if(method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read'){const config=saved();return {config,layers:[{name:{type:'user',file:'/fixture/codex/config.toml',profile:null},version:String(config.version)}],
        yardConfigSource:{hostId,generation:'fixture-generation',homeDirectory:'/fixture',codexHome:'/fixture/codex'}};}
      if(method==='config/batchWrite'){
        const config=saved();if(params.expectedVersion!==String(config.version))throw Error('version conflict');
        if(state.mode==='reject'){state.mode='ok';throw Error('fixture rejected');}
        for(const edit of params.edits)config[edit.keyPath]=edit.value;
        config.version++;localStorage.setItem('fixture-config',JSON.stringify(config));
        if(state.mode==='unknown'){state.mode='ok';throw Error('fixture response lost');}
        return {status:'ok',version:String(config.version)};
      }
      throw Error('unexpected RPC '+method)},
      async host(method,params){if(method==='codex-home')return {codexHome:'/fixture/codex'};
        if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?false:params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
        if(method==='configuration-write' && params.action==='submit'){
          const operation={operationId:params.operationId,hostId:params.hostId,method:params.method};
          try {const result=await client.rpc(params.method,params.params,params.hostId);
            return {outcome:'success',result,operation:{...operation,state:'succeeded',terminal:{kind:result.status}}};
          } catch(error) {if(error.message==='fixture response lost')throw error;
            return {outcome:'error',error:{message:error.message},operation:{...operation,state:'failed',terminal:{kind:'rejected'}}};}
        }
        throw Error('unexpected host '+method)},subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    let props={client,context:{hostId:'ssh:fixture',threadId:null,draftId:'home-model',cwd:'/fixture'},busy:false,
      async onSubmit(draft,options,action,description){state.submissions.push({draft,options,action,description})},async onInterrupt(){}};
    window.fixture={state,saved,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));},
      external(model){const config=saved();config.model=model;config.version++;localStorage.setItem('fixture-config',JSON.stringify(config));}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://models.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://models.test/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const model = page.getByLabel('模型'), effort = page.getByLabel('推理强度');
    await page.waitForFunction(() => (document.querySelector('select[aria-label="模型"]') as HTMLSelectElement)?.value === 'alpha');
    // An explicit model equal to the effective default is still a changed configured value.
    await page.evaluate(() => (window as any).fixture.external('alpha'));
    await effort.selectOption('low');
    await page.getByRole('alert').filter({ hasText: 'Configuration changed elsewhere' }).waitFor();
    assert.equal((await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'))).length, 0);
    await page.evaluate(() => (window as any).fixture.external(null));
    await page.getByRole('button', { name: '重新读取默认设置' }).click();
    await page.getByRole('button', { name: '保存默认设置' }).click();
    await page.waitForFunction(() => (window as any).fixture.saved().model_reasoning_effort === 'low');
    let calls = await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'));
    assert.deepEqual(calls[0], { method: 'config/batchWrite', hostId: 'ssh:fixture', params: {
      edits: [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }], filePath: null,
      expectedVersion: '3', reloadUserConfig: true,
    } });
    assert.equal(await page.evaluate(() => (window as any).fixture.saved().model), null);
    await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => (document.querySelector('select[aria-label="推理强度"]') as HTMLSelectElement)?.value === 'low');
    await model.selectOption('beta');
    await page.waitForFunction(() => (window as any).fixture.saved().model === 'beta');
    await page.waitForFunction(() => !(document.querySelector('select[aria-label="模型"]') as HTMLSelectElement)?.disabled);
    calls = await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'));
    assert.deepEqual(calls[0].params.edits, [{ keyPath: 'model', value: 'beta', mergeStrategy: 'upsert' }]);
    assert.equal(await page.evaluate(() => (window as any).fixture.saved().model_reasoning_effort), 'low');
    await page.evaluate(() => (window as any).fixture.external('alpha'));
    await model.selectOption('gamma');
    await page.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
    assert.equal((await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'))).length, 1);
    await page.getByRole('button', { name: '重新读取默认设置' }).click();
    await page.getByRole('button', { name: '保留我的更改' }).click();
    await page.getByRole('button', { name: '保存默认设置' }).click();
    await page.waitForFunction(() => (window as any).fixture.saved().model === 'gamma');
    calls = await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'));
    assert.equal(calls[1].params.expectedVersion, '6');
    assert.deepEqual(calls[1].params.edits, [{ keyPath: 'model', value: 'gamma', mergeStrategy: 'upsert' }]);
    await page.waitForFunction(() => !(document.querySelector('select[aria-label="模型"]') as HTMLSelectElement)?.disabled);
    await page.evaluate(() => { (window as any).fixture.state.mode = 'reject'; });
    await model.selectOption('alpha');
    await page.getByRole('alert').filter({ hasText: /configuration write was rejected/i }).waitFor();
    await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('waiting for settings');
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.saved().model), 'gamma');
    await page.getByRole('button', { name: '重新读取默认设置' }).click();
    await page.getByRole('button', { name: '保存默认设置' }).click();
    await page.waitForFunction(() => (window as any).fixture.saved().model === 'alpha');
    await page.waitForFunction(() => !(document.querySelector('select[aria-label="模型"]') as HTMLSelectElement)?.disabled);
    await page.evaluate(() => { (window as any).fixture.state.mode = 'unknown'; });
    await model.selectOption('beta');
    await page.getByRole('alert').filter({ hasText: 'fixture response lost' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.saved().model), 'beta');
    assert.equal((await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'))).length, 5);
    await page.getByRole('button', { name: '重新读取默认设置' }).click();
    await page.getByRole('button', { name: '重新读取默认设置' }).waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'))).length, 5);
    await page.evaluate(() => (window as any).fixture.render({context:{threadId:'existing',draftId:'existing'},initialOptions:{model:'beta',effort:'low'}}));
    await page.waitForFunction(() => (window as any).fixture.state.calls.some((call: any) => call.method === 'thread/queue/list'));
    await model.selectOption('alpha');
    await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('thread choice');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submission = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(submission.options.model, 'alpha');
    assert.equal((await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'config/batchWrite'))).length, 5);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
