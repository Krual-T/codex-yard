import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('workspace and skill completions use the selected host and produce real submit input', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
      const state = {calls:[], queue:[], submitted:[], blockLocal:false, release:null};
      const client = {
        async rpc(method,params={},host='local') {
          state.calls.push({method,params,host});
          if(method==='model/list') return {data:[{id:'fixture',model:'fixture',displayName:'Fixture',isDefault:true,supportedReasoningEfforts:[]}],nextCursor:null};
          if(method==='config/read') return {config:{}};
          if(method==='skills/list') return {data:[{cwd:params.cwds[0],skills:[{name:'review-helper',path:'/fixture/skills/review/SKILL.md',enabled:true,shortDescription:'Review changes'}, {name:'disabled-skill',path:'/fixture/disabled',enabled:false}]}]};
          if(method==='thread/queue/list') return {data:state.queue,nextCursor:null};
          if(method==='thread/queue/add') {state.queue.push({id:'q',input:params.input,clientUserMessageId:params.clientUserMessageId});return {queuedSubmission:state.queue[0]};}
          throw Error('unexpected RPC ' + method);
        },
        async host(endpoint,params={}) {
          state.calls.push({endpoint,params});
          if(endpoint==='get-setting') return {value:params.key==='composerEnterBehavior'?'enter':undefined};
          if(endpoint==='workspace-directory-entries') {
            if(state.blockLocal && params.hostId==='local') return new Promise(resolve=>{state.release=()=>resolve({entries:[{name:'stale.txt',path:'stale.txt',type:'file'}]});});
            if(params.hostId==='ssh-fixture') return {entries:[{name:'remote.ts',path:'remote.ts',type:'file'}]};
            return {entries:params.directoryPath==='src' ? [{name:'main.ts',path:'src/main.ts',type:'file'}] : [{name:'src',path:'src',type:'directory'},{name:'README.md',path:'README.md',type:'file'}]};
          }
          throw Error('unexpected host ' + endpoint);
        },
        subscribe(){return ()=>{};}, async reply(){throw Error('unexpected approval in composer fixture');}
      };
      let props={client,context:{hostId:'local',threadId:'t',draftId:'t',cwd:'/workspace'},busy:true,
        async onSubmit(draft,options,action){if(action.type==='queue') return client.rpc('thread/queue/add',{threadId:props.context.threadId,input:draftToInput(draft,props.context.hostId),clientUserMessageId:'fixture'},props.context.hostId);state.submitted.push({draft,options,input:draftToInput(draft,props.context.hostId)});}, async onInterrupt(){}};
      const root=createRoot(document.getElementById('root'));
      window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));}};
      window.fixture.render();
    ` },
    bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.fill('@sr');
    await page.getByRole('option', { name: /src/ }).waitFor();
    await editor.press('Enter');
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === '@src/');
    await page.getByRole('option', { name: /main\.ts/ }).waitFor();
    await editor.press('Enter');
    assert.equal(await editor.inputValue(), '`/workspace/src/main.ts` ');
    assert.equal(await page.evaluate(() => (window as any).fixture.state.queue.length), 0);
    await editor.fill('/rev');
    await page.getByRole('option', { name: /review-helper/ }).waitFor();
    assert.equal(await page.getByRole('option', { name: /disabled-skill/ }).count(), 0);
    await editor.press('Enter');
    await page.getByText('技能：review-helper').waitFor();
    await editor.fill('Please review');
    await page.getByRole('button', { name: '排队' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.queue.length === 1);
    const queued = await page.evaluate(() => (window as any).fixture.state.queue[0].input);
    assert.deepEqual(queued, [{ type: 'text', text: 'Please review', text_elements: [] },
      { type: 'skill', name: 'review-helper', path: '/fixture/skills/review/SKILL.md' }]);
    await page.evaluate(() => (window as any).fixture.render({busy:false}));
    await editor.fill('/mod');
    await page.getByRole('option', { name: /model.*选择模型/ }).waitFor();
    await editor.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '模型: Fixture');
    assert.equal(await editor.inputValue(), '');
    await editor.fill('$rev');
    await page.getByRole('option', { name: /review-helper/ }).click();
    await page.getByText('技能：review-helper').waitFor();
    await editor.fill('Inspect');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submitted.length === 1);
    const submission = await page.evaluate(() => (window as any).fixture.state.submitted[0]);
    assert.deepEqual(submission.draft.skills, [{ name: 'review-helper', path: '/fixture/skills/review/SKILL.md' }]);
    assert.deepEqual(submission.input[1], { type: 'skill', name: 'review-helper', path: '/fixture/skills/review/SKILL.md' });
    await page.evaluate(() => { (window as any).fixture.state.blockLocal = true; });
    await editor.fill('@st');
    await page.waitForFunction(() => typeof (window as any).fixture.state.release === 'function');
    await page.evaluate(() => (window as any).fixture.render({context:{hostId:'ssh-fixture',threadId:'remote',draftId:'remote',cwd:'/remote'}}));
    await editor.fill('@re');
    await page.getByRole('option', { name: /remote\.ts/ }).waitFor();
    await page.evaluate(() => (window as any).fixture.state.release());
    await page.waitForTimeout(150);
    assert.equal(await page.getByRole('option', { name: /stale\.txt/ }).count(), 0);
    await page.getByRole('option', { name: /remote\.ts/ }).click();
    assert.equal(await editor.inputValue(), '`/remote/remote.ts` ');
    const calls = await page.evaluate(() => (window as any).fixture.state.calls);
    assert.ok(calls.some((call: any) => call.endpoint === 'workspace-directory-entries' && call.params.hostId === 'local' && call.params.workspaceRoot === '/workspace' && call.params.directoryPath === 'src'));
    assert.ok(calls.some((call: any) => call.method === 'skills/list' && call.host === 'local' && call.params.cwds[0] === '/workspace'));
    assert.ok(calls.some((call: any) => call.endpoint === 'workspace-directory-entries' && call.params.hostId === 'ssh-fixture' && call.params.workspaceRoot === '/remote'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
