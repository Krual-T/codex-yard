import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('locale changes update composer controls without replacing the draft or rich editor', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    const state={submissions:[]};
    const client={async rpc(method) {
      if(method==='model/list') return {data:[{model:'fixture-model',displayName:'Fixture Model',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};
      if(method==='config/read') return {config:{model:'fixture-model',sandbox_mode:'workspace-write'}};
      throw Error('unexpected RPC '+method);
    },async host(endpoint){if(endpoint==='get-setting') return {value:undefined}; throw Error('unexpected host '+endpoint);},
      subscribe(){return ()=>{};},async reply(){throw Error('unexpected approval');}};
    const props={client,context:{hostId:'local',threadId:null,draftId:'locale-fixture',cwd:'/fixture'},busy:false,
      async onSubmit(draft,options,action){state.submissions.push({draft,options,action});},async onInterrupt(){}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(locale){root.render(React.createElement(I18nProvider,{locale},React.createElement(StandaloneComposer,props)));}};
    window.fixture.render('zh-CN');
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://composer.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://composer.test/');
    await page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const chinese = page.getByRole('textbox', { name: '与 Codex 协作' });
    await chinese.fill('draft stays');
    await chinese.focus();
    await page.evaluate(() => { (window as any).originalEditor = document.activeElement; (window as any).fixture.render('en-US'); });
    const english = page.getByRole('textbox', { name: 'Work with Codex' });
    await english.waitFor();
    assert.equal(await english.inputValue(), 'draft stays');
    assert.equal(await page.evaluate(() => document.activeElement === (window as any).originalEditor), true);
    await page.waitForFunction(() => document.querySelector('[aria-label="Model"]')?.getAttribute('title') === 'Configured default (Fixture Model)');
    await page.getByLabel('Sandbox permissions').selectOption('read-only');
    await page.getByRole('button', { name: 'Rich text editor' }).click();
    const rich = page.getByRole('textbox', { name: 'Work with Codex' });
    await rich.waitFor();
    await rich.focus();
    await rich.press('End');
    await rich.type(' more');
    await page.evaluate(() => { (window as any).richEditor = document.activeElement; (window as any).fixture.render('ja-JP'); });
    const japanese = page.getByRole('textbox', { name: 'Codex と作業' });
    await japanese.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement === (window as any).richEditor), true);
    assert.match(await japanese.innerText(), /draft stays more/);
    assert.equal(await page.getByLabel('サンドボックス権限').inputValue(), 'read-only');
    await japanese.press('Control+z');
    assert.match(await japanese.innerText(), /draft stays/);
    await page.evaluate(() => (window as any).fixture.render('en-US'));
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submission = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(submission.options.sandboxMode, 'read-only');
    assert.match(submission.draft.text, /draft stays/);
    await page.screenshot({ path: '/home/Shaokun.Tang/Projects/LifeKernel/projects/agents-workbench/.local/workspaces/chat-mD5SDx/standalone-a-composer-locale-light.png' });
    await page.evaluate(() => { document.documentElement.style.cssText = '--yard-fg:#f3f3f3;--yard-bg:#161616;--yard-surface:#252525;--yard-border:#777;--yard-muted:#ccc;--yard-accent:#8eb8ff'; document.body.style.background = '#161616'; document.body.style.color = '#f3f3f3'; });
    await page.screenshot({ path: '/home/Shaokun.Tang/Projects/LifeKernel/projects/agents-workbench/.local/workspaces/chat-mD5SDx/standalone-a-composer-locale-dark.png' });
  } finally { await browser.close(); }
});

test('goal and queue controls follow the same locale while retaining edits and user content', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneGoal} from './src/renderer/composer/StandaloneGoal.tsx';
    import {StandaloneQueue} from './src/renderer/composer/standalone-queue.tsx';
    const state={goal:{threadId:'fixture',objective:'User goal',status:'paused',tokenBudget:10000,tokensUsed:1234,timeUsedSeconds:75,createdAt:1,updatedAt:2},
      queue:[{id:'queued',clientUserMessageId:'client',input:[{type:'text',text:'User queue',text_elements:[]}]}],calls:[]};
    const client={async rpc(method,params){state.calls.push({method,params});
      if(method==='thread/goal/get')return {goal:state.goal};
      if(method==='thread/goal/set'){state.goal={...state.goal,...params};return {goal:state.goal};}
      if(method==='thread/queue/list')return {data:state.queue,nextCursor:null};
      if(method==='thread/queue/update'){state.queue=state.queue.map(item=>item.id===params.queuedSubmissionId?{...item,input:params.input}:item);return {};}
      throw Error('unexpected RPC '+method);
    },async host(){throw Error('unexpected host')},subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(locale){root.render(React.createElement(I18nProvider,{locale},React.createElement(React.Fragment,null,
      React.createElement(StandaloneGoal,{client,hostId:'local',threadId:'fixture',readOnly:false}),
      React.createElement(StandaloneQueue,{client,hostId:'local',threadId:'fixture',busy:false,refreshVersion:0}))));}};
    window.fixture.render('en-US');
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://composer.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('region', { name: 'Conversation goal' }).waitFor();
    await page.getByText('User goal').waitFor();
    await page.getByText('User queue').waitFor();
    assert.match(await page.locator('.standalone-goal__progress').innerText(), /1,234 \/ 10,000/);
    await page.getByRole('button', { name: 'Resume goal' }).click();
    await page.getByText('Active', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit queued message' }).click();
    await page.getByRole('textbox', { name: 'Edit queued message' }).fill('Edited user queue');
    await page.evaluate(() => (window as any).fixture.render('zh-CN'));
    assert.equal(await page.getByRole('textbox', { name: '编辑待发送消息' }).inputValue(), 'Edited user queue');
    assert.equal(await page.getByText('进行中', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('Edited user queue').waitFor();
    await page.evaluate(() => (window as any).fixture.render('ja-JP'));
    await page.getByRole('region', { name: '会話の目標' }).waitFor();
    await page.getByRole('region', { name: '送信待ちのメッセージ' }).waitFor();
    assert.equal(await page.getByText('User goal').count(), 1);
    assert.equal(await page.getByText('Edited user queue').count(), 1);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.queue[0].input[0]),
      { type: 'text', text: 'Edited user queue', text_elements: [] });
  } finally { await browser.close(); }
});

test('protected draft warnings follow locale without changing retained document data', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    const documentValue={type:'doc',content:[{type:'unknown_node',attrs:{keep:'untouched'}}]};
    const state={controller:null,consumed:false,documentValue};
    const client={async rpc(method){if(method==='model/list') return {data:[],nextCursor:null};
      if(method==='config/read') return {config:{}}; throw Error('unexpected RPC '+method);},
      async host(endpoint){if(endpoint==='get-setting') return {value:undefined}; throw Error('unexpected host '+endpoint);},
      subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const props={client,context:{hostId:'local',threadId:null,draftId:'protected-locale',cwd:'/fixture'},busy:false,
      prefill:{id:'opaque',draft:{text:'Retained text',images:[],files:[],references:[],document:documentValue}},
      onDraftController(value){state.controller=value},onPrefillConsumed(){state.consumed=true},
      async onSubmit(){throw Error('unexpected submit')},async onInterrupt(){}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(locale){root.render(React.createElement(I18nProvider,{locale},React.createElement(StandaloneComposer,props)));}};
    window.fixture.render('en-US');
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://protected-composer.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const warning = 'This draft contains unsupported document content. The original data has been retained.';
    await page.getByText(warning).waitFor();
    await page.waitForFunction(() => (window as any).fixture.state.consumed);
    const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    assert.equal(await page.getByRole('textbox', { name: 'Work with Codex' }).getAttribute('readonly'), '');
    await page.evaluate(() => (window as any).fixture.render('zh-TW'));
    await page.getByText('此草稿包含尚不支援的文件內容，原始資料已保留。').waitFor();
    const after = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    assert.deepEqual(after, before);
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByText(warning).waitFor();
    const restored = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    assert.deepEqual(restored.draft.document, before.draft.document);
    assert.equal(restored.revision, before.revision);
    await page.evaluate(async () => {
      const controller = (window as any).fixture.state.controller, owner = controller.snapshot().owner;
      await controller.update(owner, (draft: any) => ({ ...draft, blocked: 'An unrecognized retained warning' }));
      (window as any).fixture.render('zh-CN');
    });
    await page.getByText('An unrecognized retained warning').waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document), before.draft.document);
  } finally { await browser.close(); }
});
