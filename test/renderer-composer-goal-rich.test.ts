import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { goalMarkdownDocument, serializeGoalDocument } from '../src/renderer/composer/standalone-goal-markdown.ts';
import { composerSchema, readRichDocument } from '../src/renderer/composer/rich-document.ts';

test('goal Markdown conversion never changes the source on entering rich mode', () => {
  for (const source of ['', 'Goal **important**', '# Heading', '- first\n- second', 'First\n\nSecond', '[site](https://example.test)']) {
    const document = goalMarkdownDocument(source);
    assert.ok(document, source);
    const rich = readRichDocument(document);
    assert.ok(rich, source);
    assert.equal(serializeGoalDocument(rich), source);
  }
  for (const source of ['![photo](image.png)', '$x$', '~~deleted~~', '| A | B |\n| --- | --- |\n| 1 | 2 |', 'First\nSecond']) {
    assert.equal(goalMarkdownDocument(source), null, source);
  }
  const literal = composerSchema.node('doc', null, [composerSchema.node('paragraph', null, [composerSchema.text('$x$ | y')])]);
  assert.equal(serializeGoalDocument(literal), '\\$x\\$ \\| y');
});

test('goal rich editor edits, saves and restores through the real React consumer', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneGoal } from './src/renderer/composer/StandaloneGoal.tsx';
    const state={calls:[],listeners:new Set()};
    const goal=()=>JSON.parse(localStorage.getItem('goal-fixture'));
    const client={async rpc(method,params,host){
      state.calls.push({method,params:structuredClone(params),host});
      if(method==='thread/goal/get')return {goal:goal()};
      if(method==='thread/goal/set'){const next={...goal(),...params};localStorage.setItem('goal-fixture',JSON.stringify(next));return {goal:next};}
      throw Error('unexpected RPC '+method);
    },async host(){throw Error('unexpected host')},subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener)},
      async reply(){throw Error('unexpected approval')}};
    let props={client,hostId:'local',threadId:'goal-thread',readOnly:false};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(changes={}){props={...props,...changes};root.render(React.createElement(StandaloneGoal,props));},
      notify(next){localStorage.setItem('goal-fixture',JSON.stringify(next));for(const listener of state.listeners)
        listener({type:'mcp-notification',hostId:'local',method:'thread/goal/updated',params:{threadId:'goal-thread',goal:next}})}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    const goal = { threadId: 'goal-thread', objective: 'Write summary', status: 'paused', tokenBudget: 5000,
      tokensUsed: 42, timeUsedSeconds: 9, createdAt: 1, updatedAt: 2 };
    await page.evaluate(value => localStorage.setItem('goal-fixture', JSON.stringify(value)), goal);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: '编辑目标' }).click();
    await page.getByRole('button', { name: '富文本编辑' }).click();
    const editor = page.getByRole('textbox', { name: '目标内容' });
    assert.equal(await editor.getAttribute('contenteditable'), 'true');
    assert.equal(await editor.getAttribute('aria-autocomplete'), null);
    await editor.focus(); await editor.press('Control+A'); await page.getByRole('button', { name: '粗体' }).click();
    assert.equal(await editor.locator('strong').innerText(), 'Write summary');
    await editor.press('ArrowRight'); await editor.press('Enter'); await page.keyboard.type('- first');
    assert.match(await editor.innerHTML(), /<li[ >]/, 'list shortcut should create a list in the editor');
    await editor.press('Enter'); await page.keyboard.type('extra');
    await editor.press('Control+z');
    await page.waitForFunction(() => !document.querySelector('.ProseMirror')?.textContent?.includes('extra'));
    await page.keyboard.type('second');
    assert.equal(await editor.locator('li').count(), 2);
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.getByRole('button', { name: '编辑目标' }).waitFor();
    const set = await page.evaluate(() => (window as any).fixture.state.calls.find((call: any) => call.method === 'thread/goal/set'));
    assert.equal(set.host, 'local');
    assert.equal(set.params.threadId, 'goal-thread');
    assert.equal(set.params.origin, 'user');
    assert.equal(set.params.status, undefined);
    assert.match(set.params.objective, /\*\*Write summary\*\*/);
    assert.match(set.params.objective, /- first/);
    assert.match(set.params.objective, /- second/);
    await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: '编辑目标' }).click();
    await page.getByRole('button', { name: '富文本编辑' }).click();
    await editor.locator('strong').waitFor(); await editor.locator('li').first().waitFor();
    await editor.focus(); await editor.press('End'); await page.keyboard.type(' local');
    const local = await editor.innerText();
    await page.evaluate(value => (window as any).fixture.notify({ ...value, objective: 'Remote update' }), goal);
    await page.getByRole('alert').filter({ hasText: '其他位置更改' }).waitFor();
    assert.equal(await editor.innerText(), local);
    assert.equal(await page.getByRole('button', { name: '保存目标' }).isDisabled(), true);
    await page.evaluate(() => (window as any).fixture.render({ readOnly: true }));
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'false');
    assert.equal(await page.getByRole('button', { name: '粗体' }).isDisabled(), true);
    await page.evaluate(() => (window as any).fixture.render({ readOnly: false }));
    await page.getByRole('button', { name: '载入最新目标' }).click();
    assert.equal(await page.getByLabel('目标内容').inputValue(), 'Remote update');
    await page.getByLabel('目标内容').fill('![photo](image.png)');
    await page.getByRole('button', { name: '富文本编辑' }).click();
    await page.getByRole('alert').filter({ hasText: '不能无损转换' }).waitFor();
    assert.equal(await page.getByLabel('目标内容').inputValue(), '![photo](image.png)');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
