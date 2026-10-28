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
    const client={async rpc(method) {
      if(method==='model/list') return {data:[],nextCursor:null};
      if(method==='config/read') return {config:{}};
      if(method==='thread/queue/list') return {data:[{id:'q',clientUserMessageId:'message',input:[{type:'text',text:'Queued message',text_elements:[]}]}],nextCursor:null};
      throw Error('Unexpected RPC '+method);
    },async host(method,params) {
      if(method==='get-setting') return {value:params.key==='composerEnterBehavior'?'enter':'queue'};
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Draft '},{type:'text',text:'inline code',marks:[{type:'code'}]}]}]};
    const draft={text:serializeRichDocument(readRichDocument(doc)),document:doc,images:[],files:[{name:'file.ts',path:'/workspace/file.ts'}],references:[{id:'r',text:'Reference'}]};
    createRoot(document.getElementById('root')).render(React.createElement(StandaloneComposer,{
      client,context:{hostId:'local',threadId:'thread',draftId:'theme',cwd:'/workspace'},busy:false,
      prefill:{id:'fixture',draft},onSubmit:async()=>{},onInterrupt:async()=>{},onStartQueued:async()=>{}
    }));
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
    await page.getByRole('button', { name: '编辑待发送消息' }).click();
    await page.getByRole('button', { name: '链接', exact: true }).click();
    for (const [theme, background, surface, foreground] of [
      ['dark', '#101419', '#20262c', '#f0f5f2'], ['light', '#ffffff', '#f2f4f6', '#202524'],
    ] as const) {
      await page.evaluate(({ background, surface, foreground }) => {
        const style = document.documentElement.style;
        style.setProperty('--yard-bg', background); style.setProperty('--yard-surface', surface); style.setProperty('--yard-fg', foreground);
        style.setProperty('--yard-muted', foreground); style.setProperty('--yard-border', foreground); style.setProperty('--yard-accent', foreground);
      }, { background, surface, foreground });
      const appearance = await page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return {
          container: style('.standalone-composer__editor').backgroundColor,
          rich: style('.ProseMirror').color, richFont: style('.ProseMirror').fontFamily, richSize: style('.ProseMirror').fontSize,
          codeFont: style('.ProseMirror code').fontFamily, codeSize: style('.ProseMirror code').fontSize,
          uiFont: style('.standalone-composer select').fontFamily,
          linkInput: style('.standalone-composer__rich-toolbar input').color,
          linkInputBackground: style('.standalone-composer__rich-toolbar input').backgroundColor,
          controls: style('.standalone-composer select').color,
          queue: style('.standalone-queue').color, queueEditor: style('.standalone-queue textarea').color,
          attachment: style('.standalone-composer__file').color,
          submitColor: style('.standalone-composer__submit').color,
          submitBackground: style('.standalone-composer__submit').backgroundColor,
        };
      });
      const rgb = (hex: string) => `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
      assert.equal(appearance.container, rgb(surface));
      assert.equal(appearance.linkInputBackground, rgb(surface));
      for (const color of [appearance.rich, appearance.linkInput, appearance.controls, appearance.queue, appearance.queueEditor, appearance.attachment]) assert.equal(color, rgb(foreground));
      assert.equal(appearance.submitColor, rgb(background));
      assert.equal(appearance.submitBackground, rgb(foreground));
      assert.match(appearance.richFont, /Georgia/);
      assert.match(appearance.codeFont, /Courier New/);
      assert.match(appearance.uiFont, /Arial/);
      assert.equal(appearance.richSize, '17px');
      assert.equal(appearance.codeSize, '19px');
      if (process.env.YARD_COMPOSER_THEME_ARTIFACT_DIR) {
        await page.screenshot({ path: join(process.env.YARD_COMPOSER_THEME_ARTIFACT_DIR, `standalone-a-composer-${theme}-800.png`) });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.evaluate(() => {
      const style = document.documentElement.style;
      style.setProperty('--yard-content-font', 'Times New Roman');
      style.setProperty('--yard-code-font', 'Consolas');
    });
    assert.match(await page.locator('.ProseMirror').evaluate(element => getComputedStyle(element).fontFamily), /Times New Roman/);
    assert.match(await page.locator('.ProseMirror code').evaluate(element => getComputedStyle(element).fontFamily), /Consolas/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
