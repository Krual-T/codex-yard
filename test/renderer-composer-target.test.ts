import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('composer chooses real host roots through its parent and keeps drafts partitioned', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
    const state={calls:[],changes:[],submissions:[],consumed:[],fail:false,failStorage:false,setThread:null,setPrefill:null};
    const originalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(state.failStorage && key.startsWith('codex-yard.composer.v2:'))throw Error('fixture storage failure');return originalSetItem.call(this,key,value);};
    const hosts=[{hostId:'local',displayName:'Local'},{hostId:'ssh-fixture',displayName:'SSH fixture'}];
    const client={
      async host(endpoint,params={}){
        state.calls.push({endpoint,params});
        if(endpoint==='workspace-root-options')return {roots:params.hostId==='local'?['/work/one','/work/two']:['/remote/project'],canonicalPathByRoot:{}};
        if(endpoint==='get-setting')return {value:params.key==='composerEnterBehavior'?'enter':undefined};
        throw Error('unexpected host');
      },
      async rpc(method,params,hostId){
        state.calls.push({method,params,hostId});
        if(method==='model/list')return {data:[],nextCursor:null};
        if(method==='config/read')return {config:{}};
        if(method==='thread/queue/list')return {data:[],nextCursor:null};
        throw Error('unexpected RPC');
      },subscribe(){return ()=>{};},async reply(){throw Error('unexpected approval in composer fixture');}
    };
    function App(){
      const [context,setContext]=React.useState({hostId:'local',cwd:'/work/one',threadId:null,draftId:'new-draft'});
      const [prefill,setPrefill]=React.useState(null);state.setPrefill=setPrefill;
      state.setThread=id=>setContext(value=>({...value,threadId:id}));
      return React.createElement(StandaloneComposer,{client,context,hosts,prefill,busy:false,
        onPrefillConsumed(id){state.consumed.push(id);setPrefill(value=>value?.id===id?null:value);},
        async onTargetChange(target){if(state.fail)throw Error('fixture rejected');state.changes.push(target);setContext(value=>({...value,...target}));},
        async onSubmit(draft,options,action){state.submissions.push({context,draft,action});},async onInterrupt(){}});
    }
    window.fixture=state;createRoot(document.getElementById('root')).render(React.createElement(App));
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const target = page.getByLabel('运行位置');
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await page.getByRole('option', { name: 'SSH fixture: /remote/project' }).waitFor({ state: 'attached' });
    await editor.fill('local draft');
    await target.selectOption({ label: 'Local: /work/two' });
    await page.waitForFunction(() => (window as any).fixture.changes.length === 1);
    assert.equal(await editor.inputValue(), 'local draft');
    await page.evaluate(() => { const fixture=(window as any).fixture; fixture.failStorage=true; fixture.setPrefill({id:'one-time',draft:{text:'',images:[],files:[],references:[{id:'r',text:'local reference'}]}}); });
    await page.getByText('local reference').waitFor();
    await page.getByRole('alert').filter({ hasText: '草稿未能保存到浏览器' }).waitFor();
    await page.evaluate(() => (window as any).fixture.setPrefill((value: any) => ({ ...value })));
    assert.equal(await page.evaluate(() => (window as any).fixture.consumed.length), 0);
    await page.evaluate(() => { (window as any).fixture.failStorage = false; });
    await editor.fill('local draft after recovery');
    await page.waitForFunction(() => (window as any).fixture.consumed.includes('one-time'));
    await target.selectOption({ label: 'SSH fixture: /remote/project' });
    await page.waitForFunction(() => (window as any).fixture.changes.length === 2);
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === '');
    assert.equal(await page.getByText('local reference').count(), 0);
    await editor.fill('remote draft');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.submissions.length === 1);
    const submission = await page.evaluate(() => (window as any).fixture.submissions[0]);
    assert.equal(submission.context.hostId, 'ssh-fixture');
    assert.equal(submission.context.cwd, '/remote/project');
    assert.equal(submission.draft.text, 'remote draft');
    assert.deepEqual(submission.action, { type: 'send' });
    await target.selectOption({ label: 'Local: /work/two' });
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === 'local draft after recovery');
    await page.getByText('local reference').waitFor();
    await page.evaluate(() => { (window as any).fixture.fail = true; });
    await target.selectOption({ label: 'SSH fixture: /remote/project' });
    await page.getByRole('alert').filter({ hasText: 'fixture rejected' }).waitFor();
    assert.equal(await editor.inputValue(), 'local draft after recovery');
    await page.evaluate(() => (window as any).fixture.setThread('existing-thread'));
    await page.waitForFunction(() => (document.querySelector('select[aria-label="运行位置"]') as HTMLSelectElement)?.disabled);
    const calls = await page.evaluate(() => (window as any).fixture.calls);
    assert.ok(calls.some((call: any) => call.endpoint === 'workspace-root-options' && call.params.hostId === 'local'));
    assert.ok(calls.some((call: any) => call.endpoint === 'workspace-root-options' && call.params.hostId === 'ssh-fixture'));
  } finally { await context.close(); await browser.close(); }
});
