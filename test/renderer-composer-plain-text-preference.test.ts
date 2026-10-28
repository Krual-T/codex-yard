import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('plain text preference updates both pages without losing a rich draft or undo', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer,draftToInput} from './src/renderer/composer/StandaloneComposer.tsx';
    import {readRichDocument,serializeRichDocument} from './src/renderer/composer/rich-document.ts';
    const state={controller:null,snapshot:null,submissions:[],listeners:new Set()};
    const client={async rpc(method){if(method==='model/list'||method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting')return {value:params.key==='composerPlainTextMode'
        ? localStorage.getItem('fixture-plain')==='true' : params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
        throw Error('unexpected host '+method)},
      subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener)},async reply(){throw Error('unexpected approval')}};
    const notify=()=>{for(const listener of state.listeners)listener({type:'settings-changed',keys:['composerPlainTextMode']})};
    window.addEventListener('storage',event=>{if(event.key==='fixture-plain')notify()});
    const root=createRoot(document.getElementById('root'));
    const id=new URL(location.href).searchParams.get('id')||'one';
    root.render(React.createElement(StandaloneComposer,{client,context:{hostId:'local',threadId:'thread-'+id,draftId:id,cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},onDraftChange(value){state.snapshot=value},
      async onSubmit(draft){state.submissions.push({draft:structuredClone(draft),input:draftToInput(draft,'local')})},async onInterrupt(){}}));
    window.fixture={state,setPlain(value){localStorage.setItem('fixture-plain',String(value));notify()},async seed(){
      const document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'bold',marks:[{type:'strong'}]},
        {type:'text',text:' '},{type:'atMention',attrs:{label:'@a',path:'/fixture/a',fsPath:'/fixture/a'}}]}]};
      const text=serializeRichDocument(readRichDocument(document));
      const owner=state.controller.snapshot().owner;
      return state.controller.update(owner,draft=>({...draft,text,document,
        input:[{type:'text',text,text_elements:[]},{type:'skill',name:'fixture',path:'/skills/fixture'}],
        images:[{id:'img',src:'data:image/png;base64,YQ==',previewSrc:'data:image/png;base64,YQ=='}],
        references:[{id:'ref',text:'retained context',original:{keep:true}}]}));
    }};
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const setup = async (id: string) => {
      const page = await context.newPage();
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === 'http://plain.test'
        ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
      await page.goto('http://plain.test/?id=' + id);
      await page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.waitForFunction(() => !!(window as any).fixture.state.controller?.snapshot());
      return { page, failures };
    };
    const a = await setup('one'), b = await setup('two');
    assert.equal(await a.page.evaluate(() => (window as any).fixture.seed()), true);
    const editor = a.page.locator('[contenteditable="true"][aria-label="和 Codex 一起工作"]');
    await editor.waitFor();
    await a.page.getByRole('toolbar', { name: '文本格式' }).waitFor();
    await editor.focus();
    await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await b.page.evaluate(() => (window as any).fixture.setPlain(true));
    await a.page.getByRole('toolbar', { name: '文本格式' }).waitFor({ state: 'detached' });
    const imePrevented = await editor.evaluate(element => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
      element.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(imePrevented, false);
    assert.equal(await a.page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await a.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await a.page.getByText('已开启纯文本模式，现有格式会保留。').waitFor();
    assert.equal(await editor.locator('strong').first().innerText(), 'bold');
    assert.equal(await editor.locator('[data-mention="file"]').innerText(), '@a');
    await editor.click(); await editor.press('Control+End'); await editor.press('Enter');
    await a.page.keyboard.type('# ');
    assert.equal(await editor.locator('h1').count(), 0);
    await editor.evaluate(element => {
      const clipboard = new DataTransfer(); clipboard.setData('text/html', '<strong>pasted</strong>');
      clipboard.setData('text/plain', 'pasted');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    });
    assert.equal(await editor.locator('strong').count(), 1);
    assert.match(await editor.innerText(), /#\s+pasted/);
    await editor.press('Control+z');
    assert.doesNotMatch(await editor.innerText(), /pasted/);
    await editor.press('Control+Shift+z');
    assert.match(await editor.innerText(), /pasted/);
    await a.page.waitForFunction(() => {
      const {controller,snapshot}=(window as any).fixture.state;
      return snapshot?.revision === controller?.snapshot().revision && snapshot?.draft.text.includes('pasted');
    });
    assert.match(await a.page.evaluate(() => (window as any).fixture.state.snapshot.draft.text), /\\# pasted/);
    await a.page.reload();
    await a.page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') });
    await a.page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await editor.waitFor();
    assert.equal(await a.page.getByRole('toolbar', { name: '文本格式' }).count(), 0);
    assert.equal(await editor.locator('strong').first().innerText(), 'bold');
    assert.match(await editor.innerText(), /#\s+pasted/);
    await b.page.evaluate(() => (window as any).fixture.setPlain(false));
    await a.page.getByRole('toolbar', { name: '文本格式' }).waitFor();
    await editor.click(); await editor.press('Control+End'); await editor.press('Enter'); await a.page.keyboard.type('- ');
    await editor.locator('ul').waitFor();
    await a.page.getByRole('button', { name: '发送', exact: true }).click();
    await a.page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const sent = await a.page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(sent.draft.images[0].id, 'img');
    assert.deepEqual(sent.draft.references[0].original, { keep: true });
    assert.equal(sent.input[1].type, 'skill');
    assert.ok(sent.input.some((item: { type: string; text?: string }) => item.text?.includes('retained context')));
    assert.equal(sent.draft.document.content[0].content[0].marks[0].type, 'strong');
    assert.deepEqual(a.failures, []); assert.deepEqual(b.failures, []);
  } finally { await context.close(); await browser.close(); }
});
