import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('rich completion and Markdown list operations survive editing, undo, refresh and submission', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    import { readRichDocument, serializeRichDocument } from './src/renderer/composer/rich-document.ts';
    const state={submissions:[],calls:[],enter:'enter',controller:null,persisted:null};
    const client={async rpc(method,params,host) {
      state.calls.push({method,params,host});
      if(method==='model/list') return {data:[{id:'fixture',model:'fixture',displayName:'Fixture',isDefault:true,supportedReasoningEfforts:[]}],nextCursor:null};
      if(method==='config/read') return {config:{}};
      if(method==='thread/queue/list') return {data:[],nextCursor:null};
      if(method==='skills/list') return {data:[{cwd:'/workspace',skills:[{name:'review-helper',path:'/skills/review/SKILL.md',enabled:true,shortDescription:'Review'}]}]};
      throw Error('Unexpected RPC '+method);
    },async host(method,params) {
      state.calls.push({method,params});
      if(method==='get-setting') return {value:params.key==='composerEnterBehavior'?state.enter:'queue'};
      if(method==='set-setting') { if(params.key==='composerEnterBehavior') state.enter=params.value; return {success:true}; }
      if(method==='workspace-directory-entries') return {entries:params.directoryPath==='src'
        ? [{name:'main.ts',path:'src/main.ts',type:'file'}] : [{name:'src',path:'src',type:'directory'}]};
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const initial={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Begin ',marks:[{type:'strong'}]},{type:'text',text:'end'}]}]};
    const initialText=serializeRichDocument(readRichDocument(initial));
    const draft={text:initialText,document:initial,images:[],files:[],references:[{id:'r',text:'retained context'}],
      input:[{type:'future',metadata:{keep:true}},{type:'text',text:initialText,text_elements:[]}]};
    let props={client,context:{hostId:'local',threadId:'thread',draftId:'completion',cwd:'/workspace'},busy:false,
      prefill:{id:'initial',draft},onPrefillConsumed(id){state.ready=id;},
      onDraftController(value){state.controller=value},onDraftChange(value){state.persisted=value},
      async onSubmit(draft,options,action){state.submissions.push({draft:structuredClone(draft),input:draftToInput(draft,'local'),action});},async onInterrupt(){}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));},
      newDraft(id){this.render({context:{draftId:id},prefill:{id,draft:{text:'',document:{type:'doc',content:[{type:'paragraph'}]},images:[],files:[]}}});}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', outfile: 'fixture.js' });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 800, height: 800 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    const saved = () => page.waitForFunction(() => {
      const state = (window as any).fixture.state, snapshot = state.controller?.snapshot();
      return snapshot && state.persisted?.revision === snapshot.revision;
    });
    await editor.locator('strong').waitFor();
    await editor.evaluate(element => {
      (element as HTMLElement).focus();
      const last = element.querySelector('p')!.lastChild!;
      const range = document.createRange(); range.setStart(last, 0); range.setEnd(last, 3);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.type('@sr');
    await page.getByRole('option', { name: /src/ }).waitFor();
    assert.equal(await editor.getAttribute('aria-controls'), await page.getByRole('listbox', { name: '工作区文件' }).getAttribute('id'));
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: /main\.ts/ }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    await page.keyboard.press('Tab');
    const file = editor.locator('[data-mention="file"]');
    await file.waitFor();
    assert.deepEqual(JSON.parse((await file.getAttribute('data-composer-attrs'))!), {
      label: '@src/main.ts', path: '/workspace/src/main.ts', fsPath: '/workspace/src/main.ts',
    });
    await page.keyboard.press('Control+z');
    assert.equal(await file.count(), 0);
    assert.match(await editor.innerText(), /@src\//);
    await page.keyboard.press('Control+Shift+z');
    await file.waitFor();
    await page.keyboard.type('$rev');
    const skillOption = page.getByRole('option', { name: /review-helper/ });
    await skillOption.waitFor();
    await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await skillOption.waitFor({ state: 'hidden' });
    const prevented = await editor.evaluate(element => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
      element.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(prevented, false);
    assert.equal(await editor.locator('[data-mention="skill"]').count(), 0);
    await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await skillOption.waitFor();
    await skillOption.click();
    const skill = editor.locator('[data-mention="skill"]');
    await skill.waitFor();
    await page.keyboard.press('Control+z');
    assert.equal(await skill.count(), 0);
    await page.keyboard.press('Control+Shift+z');
    await skill.waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    await saved();
    await page.reload();
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await file.waitFor(); await skill.waitFor();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const completed = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.deepEqual(completed.input[0], { type: 'future', metadata: { keep: true } });
    assert.match(completed.input[1].text, /\*\*Begin\*\*/);
    assert.match(completed.input[1].text, /\[@src\/main\.ts\]\(\/workspace\/src\/main\.ts\)/);
    assert.match(completed.input[1].text, /\[\$review-helper\]\(\/skills\/review\/SKILL\.md\)/);
    assert.deepEqual(completed.input.find((item: any) => item.type === 'skill'), { type: 'skill', name: 'review-helper', path: '/skills/review/SKILL.md' });
    assert.ok(completed.input.some((item: any) => item.type === 'text' && item.text === 'retained context'));

    await page.evaluate(() => (window as any).fixture.newDraft('list'));
    await page.waitForFunction(() => (window as any).fixture.state.ready === 'list');
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor();
    await page.getByRole('combobox', { name: '发送方式' }).selectOption('cmdAlways');
    await editor.click();
    await page.keyboard.type('- first');
    await editor.locator('ul > li').waitFor();
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    assert.equal(await editor.locator('ul > li').count(), 2);
    await page.keyboard.press('Tab');
    assert.equal(await editor.locator('ul > li > ul > li').count(), 1);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await editor.locator('ul > li > ul > li').count(), 0);
    assert.equal(await editor.locator('ul').count(), 1);
    assert.equal(await editor.locator('ul > li').count(), 2);
    await page.keyboard.press('Control+z');
    assert.equal(await editor.locator('ul > li > ul > li').count(), 1);
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await editor.locator('ul > li > ul > li').count(), 0);
    await saved();
    await page.reload();
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => (window as any).fixture.newDraft('list'));
    await page.waitForFunction(() => (window as any).fixture.state.ready === 'list');
    await editor.locator('ul > li').first().waitFor();
    assert.equal(await editor.locator('ul > li').count(), 2);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const list = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.match(list.input[0].text, /^- first\n\n- second$/);

    await page.evaluate(() => (window as any).fixture.newDraft('rule-undo'));
    await page.waitForFunction(() => (window as any).fixture.state.ready === 'rule-undo');
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor();
    await editor.click();
    await page.keyboard.type('- ');
    await editor.locator('ul > li').waitFor();
    await page.keyboard.press('Backspace');
    assert.equal(await editor.locator('ul').count(), 0);
    assert.equal(await editor.innerText(), '- ');

    await page.evaluate(() => (window as any).fixture.newDraft('middle'));
    await page.waitForFunction(() => (window as any).fixture.state.ready === 'middle');
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor();
    await editor.click();
    await page.keyboard.type('@src/main.ts tail');
    await editor.evaluate(element => {
      const range = document.createRange(); range.setStart(element.querySelector('p')!.firstChild!, 3); range.collapse(true);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await page.getByRole('option', { name: /src/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: /main\.ts/ }).waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await editor.locator('[data-mention="file"]').count(), 1);
    assert.equal(await editor.innerText(), '@src/main.ts  tail');
    await editor.evaluate(element => {
      const range = document.createRange(); range.setStartBefore(element.querySelector('[data-mention="file"]')!); range.collapse(true);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.type('@sr');
    await page.getByRole('option', { name: /src/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: /main\.ts/ }).waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await editor.locator('[data-mention="file"]').count(), 2);
    assert.match(await editor.innerText(), /tail$/);

    await page.evaluate(() => (window as any).fixture.newDraft('slash-model'));
    await page.waitForFunction(() => (window as any).fixture.state.ready === 'slash-model');
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor();
    await editor.click();
    await page.keyboard.type('/mod');
    await page.getByRole('option', { name: /model.*选择模型/ }).waitFor();
    const countBeforeCommand = await page.evaluate(() => (window as any).fixture.state.submissions.length);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '模型');
    assert.equal(await editor.textContent(), '');
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), countBeforeCommand);

    for (const [id, typed, selector, expected] of [
      ['ordered', '4. numbered', 'ol[start="4"] li', /4\. numbered/],
      ['zero', '0. plain', 'p', /^0\. plain$/],
      ['heading', '## Heading', 'h2', /## Heading/],
      ['quote', '> Quote', 'blockquote', /> Quote/],
      ['code', '```ts code', 'pre', /```ts\ncode\n```/],
    ] as const) {
      await page.evaluate(id => (window as any).fixture.newDraft(id), id);
      await page.waitForFunction(id => (window as any).fixture.state.ready === id, id);
      await page.locator('.ProseMirror[contenteditable="true"]').waitFor();
      await editor.click();
      await page.keyboard.type(typed);
      await editor.locator(selector).waitFor();
      const count = await page.evaluate(() => (window as any).fixture.state.submissions.length);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.waitForFunction(count => (window as any).fixture.state.submissions.length === count + 1, count);
      const submitted = await page.evaluate(() => (window as any).fixture.state.submissions.at(-1));
      assert.match(submitted.input[0].text, expected);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
