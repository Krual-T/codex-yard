import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('composer surfaces, controls, queue and content follow the supplied appearance', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
    import { readRichDocument, serializeRichDocument } from './src/renderer/composer/rich-document.ts';
    import { applyAppearance } from './src/renderer/app/appearance.ts';
    import { defaultThemes } from './src/renderer/settings/preferences.ts';
    const state={controller:null,queue:[{id:'q',clientUserMessageId:'message',input:[{type:'text',text:'Queued message',text_elements:[]}]},
      {id:'q2',clientUserMessageId:'message2',input:[{type:'text',text:'Remaining queue',text_elements:[]}]}],calls:[]};
    const authorities=new WeakMap();
    const client={async rpc(method,params={},host='local') {
      if(method==='model/list') return {data:[],nextCursor:null};
      if(method==='config/read') return {config:{}};
      if(method==='thread/queue/list') return {data:structuredClone(state.queue),nextCursor:null};
      if(method==='thread/queue/delete'){state.calls.push({method,params:structuredClone(params),host});
        const index=state.queue.findIndex(item=>item.id===params.queuedSubmissionId);
        if(index<0)return {deleted:false};state.queue.splice(index,1);return {deleted:true};}
      throw Error('Unexpected RPC '+method);
    },async host(method,params={},options={}) {
      if(method==='get-setting') return {value:params.key==='composerEnterBehavior'?'enter':params.key==='followUpQueueMode'?'queue':undefined};
      if(method==='queue-edit'){
        options.assertBeforeSend();state.calls.push({method,params:structuredClone(params)});
        const page=await client.rpc('thread/queue/list',{threadId:params.threadId},params.hostId);
        const entry=page.data.find(item=>item.id===params.entry.id);
        if(!entry||JSON.stringify(entry)!==JSON.stringify(params.entry))return 'changed';
        options.assertBeforeSend();const result=await client.rpc('thread/queue/delete',{threadId:params.threadId,queuedSubmissionId:entry.id},params.hostId);
        return result.deleted?'deleted':'changed';
      }
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Draft '},{type:'text',text:'inline code',marks:[{type:'code'}]}]}]};
    const draft={text:serializeRichDocument(readRichDocument(doc)),document:doc,images:[],files:[{name:'file.ts',path:'/workspace/file.ts'}],references:[{id:'r',text:'Reference'}]};
    createRoot(document.getElementById('root')).render(React.createElement(StandaloneComposer,{
      client,context:{hostId:'local',threadId:'thread',draftId:'theme',cwd:'/workspace'},busy:false,
      prefill:{id:'fixture',draft},onSubmit:async()=>{},onInterrupt:async()=>{},onStartQueued:async()=>{},
      onDraftController(controller){state.controller=controller},
      captureSubmissionAuthority(owner){const captured=structuredClone(owner);const authority=()=>{
        if(JSON.stringify(state.controller?.snapshot()?.owner)!==JSON.stringify(captured))throw Error('owner changed');};
        authority();authorities.set(authority,captured);return authority;},
      async removeQueuedOriginal(entry,authority,assertBeforeSend){const owner=authorities.get(authority);
        if(!owner)throw Error('original authority lost');
        return client.host('queue-edit',{hostId:owner.hostId,threadId:owner.threadId,entry},{assertBeforeSend});}
    }));
    window.fixture={state,applyDefaultAppearance(dark,overrides){
      applyAppearance({[dark?'appearanceDarkChromeTheme':'appearanceLightChromeTheme']:
        {...defaultThemes[dark?'dark':'light'],...overrides}},dark);
    },applyTheme(variant,background,foreground){
      const theme={...defaultThemes[variant],surface:background,ink:foreground,
        fonts:{ui:'Arial',content:'Georgia',code:'Courier New'}};
      applyAppearance({[variant==='dark'?'appearanceDarkChromeTheme':'appearanceLightChromeTheme']:theme,
        sansFontSize:17,codeFontSize:19},variant==='dark');
    }};
  ` }, bundle: true, write: false, format: 'iife', outfile: 'fixture.js' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 800, height: 800 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addStyleTag({ content: `
      :root { --yard-bg:#101419; --yard-surface:#20262c; --yard-fg:#f0f5f2; --yard-muted:#a9b3ba;
        --yard-border:#53616c; --yard-accent:#9dbbff; --yard-ui-font:Arial; --yard-content-font:Georgia; --yard-code-font:"Courier New";
        --yard-font-size:17px; --yard-code-size:19px; }
      body { background:var(--yard-bg); margin:16px; }
    ` });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    await page.locator('.ProseMirror').waitFor();
    await page.getByText('Queued message').waitFor();
    await page.getByText('file.ts').waitFor();
    await page.getByRole('button', { name: '编辑待发送消息' }).first().click();
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.draft.text === 'Queued message');
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.queue.map((entry: any) => entry.id)), ['q2']);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((call: any) => call.method === 'queue-edit').length), 1);
    const editedQueue = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作)$/ });
    await editedQueue.fill('Queued message edited');
    await page.evaluate(async () => { const controller = (window as any).fixture.state.controller; await controller.flush(controller.snapshot().owner); });
    await page.getByRole('button', { name: '切换草稿' }).click();
    await page.locator('.ProseMirror code').waitFor();
    const failures: string[] = [];
    const verify = (label: string, check: () => void) => {
      try { check(); } catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    for (const [theme, background, surface, foreground, composerSurface] of [
      ['dark', '#101419', '#20262c', '#f0f5f2', '#2d3135'], ['light', '#ffffff', '#f2f4f6', '#202524', '#ffffff'],
    ] as const) {
      await page.evaluate(({ theme, background, surface, foreground }) => {
        (window as any).fixture.applyTheme(theme,background,foreground);
        const style = document.documentElement.style;
        style.setProperty('--yard-bg', background); style.setProperty('--yard-surface', surface); style.setProperty('--yard-fg', foreground);
        style.setProperty('--yard-muted', foreground); style.setProperty('--yard-border', foreground); style.setProperty('--yard-accent', foreground);
      }, { theme, background, surface, foreground });
      await page.getByRole('button', { name: '切换草稿' }).click();
      const queueEditor = page.getByRole('textbox', { name: /^(和 Codex 一起工作|与 Codex 协作)$/ });
      assert.equal(await queueEditor.inputValue(), 'Queued message edited');
      const queueEditorColor = await queueEditor.evaluate(element => getComputedStyle(element).color);
      await page.setViewportSize({ width: 390, height: 800 });
      const queueFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      verify(`${theme} queue narrow`, () => assert.equal(queueFits, true));
      await page.setViewportSize({ width: 800, height: 800 });
      await page.getByRole('button', { name: '切换草稿' }).click();
      await page.locator('.ProseMirror code').waitFor();
      await page.getByRole('button', { name: '链接', exact: true }).click();
      const appearance = await page.evaluate(queueEditorColor => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return {
          container: style('.standalone-composer__editor').backgroundColor,
          rich: style('.ProseMirror').color, richFont: style('.ProseMirror').fontFamily, richSize: style('.ProseMirror').fontSize,
          codeFont: style('.ProseMirror code').fontFamily, codeSize: style('.ProseMirror code').fontSize,
          uiFont: style('.standalone-composer select').fontFamily,
          linkInput: style('.standalone-composer__rich-toolbar input').color,
          linkInputBackground: style('.standalone-composer__rich-toolbar input').backgroundColor,
          controls: style('.standalone-composer select').color,
          queue: style('.standalone-queue').color, queueEditor: queueEditorColor,
          queueControl: style('.standalone-queue__actions button[aria-label="编辑待发送消息"]').color,
          queueControlFont: style('.standalone-queue__actions button[aria-label="编辑待发送消息"]').fontFamily,
          queueControlSize: (() => { const rect = document.querySelector('.standalone-queue__actions button[aria-label="编辑待发送消息"]')!.getBoundingClientRect();
            return { width: rect.width, height: rect.height }; })(),
          attachment: style('.standalone-composer__file').color,
          submitColor: style('.standalone-composer__submit').color,
          submitBackground: style('.standalone-composer__submit').backgroundColor,
          submitSize: (() => { const rect = document.querySelector('.standalone-composer__submit')!.getBoundingClientRect();
            return { width: rect.width, height: rect.height }; })(),
        };
      }, queueEditorColor);
      const rgb = (hex: string) => `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
      verify(`${theme} editor surface`, () => assert.equal(appearance.container, rgb(composerSurface)));
      verify(`${theme} link surface`, () => assert.equal(appearance.linkInputBackground, rgb(surface)));
      for (const [name, color] of Object.entries({ rich: appearance.rich, link: appearance.linkInput, controls: appearance.controls,
        queue: appearance.queue, queueEditor: appearance.queueEditor, queueControl: appearance.queueControl, attachment: appearance.attachment })) {
        verify(`${theme} ${name} color`, () => assert.equal(color, rgb(foreground)));
      }
      verify(`${theme} submit color`, () => assert.equal(appearance.submitColor, rgb(background)));
      verify(`${theme} submit background`, () => assert.equal(appearance.submitBackground, rgb(foreground)));
      verify(`${theme} rich font`, () => assert.match(appearance.richFont, /Georgia/));
      verify(`${theme} code font`, () => assert.match(appearance.codeFont, /Courier New/));
      verify(`${theme} UI font`, () => assert.match(appearance.uiFont, /Arial/));
      verify(`${theme} queue control font`, () => assert.match(appearance.queueControlFont, /Arial/));
      verify(`${theme} queue control size`, () => assert.ok(appearance.queueControlSize.width > 0 && appearance.queueControlSize.height > 0));
      verify(`${theme} submit size`, () => assert.deepEqual(appearance.submitSize, { width: 28, height: 28 }));
      verify(`${theme} rich size`, () => assert.equal(appearance.richSize, '17px'));
      verify(`${theme} code size`, () => assert.equal(appearance.codeSize, '19px'));
      if (process.env.YARD_COMPOSER_THEME_ARTIFACT_DIR) {
        await page.screenshot({ path: join(process.env.YARD_COMPOSER_THEME_ARTIFACT_DIR, `standalone-a-composer-${theme}-800.png`) });
      }
      const desktopFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      verify(`${theme} desktop`, () => assert.equal(desktopFits, true));
      await page.setViewportSize({ width: 390, height: 800 });
      const narrowFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      verify(`${theme} rich narrow`, () => assert.equal(narrowFits, true));
      await page.setViewportSize({ width: 800, height: 800 });
      await page.getByRole('button', { name: '链接', exact: true }).click();
    }
    await page.evaluate(() => {
      const style = document.documentElement.style;
      style.setProperty('--yard-content-font', 'Times New Roman');
      style.setProperty('--yard-code-font', 'Consolas');
    });
    assert.match(await page.locator('.ProseMirror').evaluate(element => getComputedStyle(element).fontFamily), /Times New Roman/);
    assert.match(await page.locator('.ProseMirror code').evaluate(element => getComputedStyle(element).fontFamily), /Consolas/);
    for (const [dark, overrides, foreground] of [
      [true, {}, 'rgb(223, 223, 223)'], [false, {}, 'rgb(26, 28, 31)'],
      [true, { ink: '#f0f5f2' }, 'rgb(240, 245, 242)'],
      [true, { fonts: { ui: 'Arial', code: null } }, 'rgb(255, 255, 255)'],
    ] as const) {
      await page.evaluate(({ dark, overrides }) => (window as any).fixture.applyDefaultAppearance(dark,overrides), { dark, overrides });
      assert.equal(await page.locator('.ProseMirror').evaluate(element => getComputedStyle(element).color), foreground);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
  } finally { await context.close(); await browser.close(); }
});
