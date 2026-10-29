import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('compact composer keeps its real controls, keyboard access and original option state', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    const state={submissions:[],changes:[]};
    const client={async host(method,params={}){
      if(method==='workspace-root-options')return {roots:['/fixture/project','/fixture/other']};
      if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?false:params.key==='composerEnterBehavior'?'enter':'queue'};
      if(method==='codex-home')return {codexHome:'/fixture/codex'};
      if(method==='set-setting')return {success:true};
      throw Error('unexpected host '+method);
    },async rpc(method){
      if(method==='model/list')return {data:[{id:'fixture-a',model:'fixture-a',displayName:'Fixture model',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'low'}]},{id:'fixture-b',model:'fixture-b',displayName:'Other model',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null};
      if(method==='config/read')return {config:{model:'fixture-a',model_reasoning_effort:'high',sandbox_mode:'danger-full-access',approval_policy:'never'},layers:[{name:{type:'user',file:'/fixture/codex/config.toml',profile:null},version:'1'}],yardConfigSource:{hostId:'local',generation:'fixture',homeDirectory:'/fixture',codexHome:'/fixture/codex'}};
      if(method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='skills/list')return {data:[]};
      throw Error('unexpected rpc '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    let props={client,context:{hostId:'local',cwd:'/fixture/project',threadId:null,draftId:'parity-home'},busy:false,
      initialOptions:{model:'fixture-a',effort:'high',sandboxMode:'danger-full-access',approvalPolicy:'never'},
      projectDisplay:{hostId:'local',cwd:'/fixture/project',name:'Parity Project'},
      async onTargetChange(target,lease){state.changes.push({target,flushed:await lease.flush()});},
      async onSubmit(draft,options,action){state.submissions.push({draft,options,action})},async onInterrupt(){}};
    window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};
      root.render(React.createElement(I18nProvider,{locale:'en-US'},React.createElement(StandaloneComposer,props)));}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://composer.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://composer.test/');
    await page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') + `
      body { margin:0; background:#f7f7f7; color:#222; }
      #root { position:absolute; bottom:16px; left:0; right:0; margin:auto; width:min(736px,calc(100% - 32px)); max-height:55dvh; overflow:auto; }
    ` });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => (document.querySelector('select[aria-label="Model"]') as HTMLSelectElement)?.value === 'fixture-a');
    const access = page.locator('.standalone-composer__access summary');
    const model = page.locator('.standalone-composer__model > summary');
    const editor = page.getByRole('textbox', { name: 'Work with Codex' });
    assert.equal(await editor.getAttribute('placeholder'), 'Do anything');
    assert.match(await access.innerText(), /Full access/);
    assert.match(await model.innerText(), /Fixture model High/);
    assert.match(await page.locator('.standalone-composer__target summary').innerText(), /Parity Project/);
    assert.equal(await page.getByRole('button', { name: 'Dictation' }).isDisabled(), true);
    assert.equal(await page.getByLabel('Approval policy').isVisible(), false);
    assert.equal(await page.getByLabel('Send method').isVisible(), false);
    const bounds = await page.locator('.standalone-composer__editor').boundingBox();
    assert.ok(bounds && bounds.height >= 90 && bounds.height <= 120 && bounds.width === 736);
    const artifacts = process.env.YARD_TEST_ARTIFACTS;
    if (artifacts) { await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: join(artifacts, 'composer-light-1280.png') }); }

    await access.focus(); await page.keyboard.press('Enter');
    await page.getByLabel('Sandbox permissions').selectOption('read-only');
    assert.match(await access.innerText(), /Read only/);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByLabel('Sandbox permissions').isVisible(), false);
    assert.equal(await access.evaluate(element => document.activeElement === element), true);
    await page.locator('.standalone-composer__add summary').click();
    const addPanel = page.locator('.standalone-composer__add-panel');
    const addBounds = await addPanel.boundingBox();
    assert.ok(addBounds && addBounds.y >= 0 && addBounds.x >= 0 && addBounds.x + addBounds.width <= 1280);
    if (artifacts) await page.screenshot({ path: join(artifacts, 'composer-add-menu-1280.png') });
    await page.getByLabel('Send method').selectOption('cmdAlways');
    await editor.click();
    assert.equal(await page.getByLabel('Send method').isVisible(), false);
    await page.evaluate(() => (window as any).fixture.render({busy:true}));
    await model.click();
    await page.locator('.standalone-composer__model-choices summary').click();
    assert.equal(await page.getByLabel('Model').isDisabled(), true);
    await page.locator('.standalone-composer__add summary').click();
    assert.equal(await page.getByLabel('Send method').isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Rich text editor' }).isEnabled(), true);
    await page.evaluate(() => (window as any).fixture.render({busy:false,context:{threadId:'fixture-thread',draftId:'fixture-thread'}}));
    await model.click();
    await page.getByLabel('Effort', { exact: true }).fill('1');
    await page.locator('.standalone-composer__model-choices summary').click();
    await page.getByLabel('Model').selectOption('fixture-b');
    await editor.fill('retained actual draft');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submission = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(submission.draft.text, 'retained actual draft');
    assert.equal(submission.options.model, 'fixture-b');
    assert.equal(submission.options.effort, 'low');

    await page.setViewportSize({ width: 390, height: 700 });
    await page.evaluate(() => (window as any).fixture.render({context:{threadId:null,draftId:'parity-home'},
      projectDisplay:{hostId:'wrong-host',cwd:'/fixture/project',name:'Unrelated project'},
      initialOptions:{model:'fixture-a',effort:'high',permissionProfileId:'a-very-long-explicit-permission-profile-identifier'}}));
    await page.waitForFunction(() => document.querySelector('.standalone-composer__target summary')?.textContent?.includes('/fixture/project'));
    await page.waitForFunction(() => document.querySelector('.standalone-composer__access summary')?.textContent?.includes('a-very-long-explicit-permission-profile-identifier'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    const accessBounds = await access.boundingBox();
    const footerBounds = await page.locator('.standalone-composer__footer').boundingBox();
    assert.ok(accessBounds && footerBounds && accessBounds.width <= footerBounds.width * 0.4);
    if (artifacts) await page.screenshot({ path: join(artifacts, 'composer-light-390.png') });
    await page.evaluate(() => { document.documentElement.style.cssText = '--yard-fg:#f3f3f3;--yard-bg:#161616;--yard-surface:#252525;--yard-border:#777;--yard-muted:#ccc;--yard-accent:#8eb8ff'; document.body.style.background = '#161616'; });
    if (artifacts) await page.screenshot({ path: join(artifacts, 'composer-dark-390.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
