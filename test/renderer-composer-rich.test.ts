import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { documentFromText, draftToInput, emptyDraft, hasContent, normalizeDraft, richEditIssue, updateRichDraft } from '../src/renderer/composer/standalone-draft.ts';
import { readRichDocument, serializeRichDocument } from '../src/renderer/composer/rich-document.ts';
import type { ComposerDocument } from '../src/renderer/workbench-contract.ts';

const document: ComposerDocument = { type: 'doc', content: [
  { type: 'paragraph', content: [
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
    { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
    { type: 'text', text: 'inline', marks: [{ type: 'code' }] },
    { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.test/path', title: 'title', sourceAppId: 'source' } }] },
    { type: 'hard_break' },
    { type: 'atMention', attrs: { label: '@file', path: '/workspace/a.ts', fsPath: '/workspace/a.ts' } },
    { type: 'text', text: ' ' },
    { type: 'skillMention', attrs: { name: 'fixture', path: '/skills/fixture/SKILL.md', description: 'fixture skill', displayName: 'Fixture', iconSmall: '', brandColor: '', promptLinkLabel: '$fixture', skillIcon: null } },
  ] },
  { type: 'list', content: [{ type: 'regular_list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
  { type: 'ordered_list', attrs: { startingNumber: 4 }, content: [{ type: 'regular_list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ordered' }] }] }] },
  { type: 'code_block', attrs: { autoDetectLanguage: false, language: 'ts' }, content: [{ type: 'text', text: 'const x = 1;' }] },
] };

test('rich drafts preserve ordered input and reject unsupported document or hint data', () => {
  const node = readRichDocument(document);
  assert.ok(node);
  const text = serializeRichDocument(node);
  assert.match(text, /\*\*bold\*\*/);
  assert.match(text, /\[@file\]\(\/workspace\/a\.ts\)/);
  assert.match(text, /\[\$fixture\]\(\/skills\/fixture\/SKILL\.md\)/);
  assert.match(text, /4\. ordered/);
  assert.match(text, /```ts\nconst x = 1;\n```/);
  const input = [{ type: 'future', content: { keep: true } }, { type: 'text', text, text_elements: [] },
    { type: 'skill', name: 'fixture', path: '/skills/fixture/SKILL.md' }];
  const draft = normalizeDraft({ text, document, input, images: [], files: [], references: [{ id: 'r', text: 'context', original: { keep: true } }] });
  assert.equal(richEditIssue(draft), null);
  const changed: ComposerDocument = { ...document, content: [...document.content!, { type: 'paragraph', content: [{ type: 'text', text: 'new' }] }] };
  const edited = updateRichDraft(draft, changed);
  assert.equal(edited.input?.[0]?.type, 'future');
  assert.equal(edited.input?.[1]?.text, edited.text);
  assert.deepEqual(edited.references, draft.references);
  assert.deepEqual(draftToInput(edited, 'local'), [...edited.input!, { type: 'text', text: 'context', text_elements: [] }]);
  const hintDraft = { ...draft, hints: [{ byteRange: [1, 3] }] };
  assert.match(richEditIssue(hintDraft) ?? '', /提示/);
  assert.deepEqual(updateRichDraft(hintDraft, changed), hintDraft);
  assert.equal(readRichDocument({ type: 'doc', attrs: { unknown: true }, content: document.content }), null);
  assert.equal(readRichDocument({ type: 'doc', content: [{ type: 'futureNode', attrs: { keep: true } }] }), null);
  assert.equal(readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'strong', attrs: { unknown: true } }] }] }] }), null);
  assert.equal(readRichDocument({ type: 'doc', content: [{ type: 'paragraph', text: 'hidden' }] }), null);
  assert.match(richEditIssue({ ...draft, text: 'different saved text', input: undefined }) ?? '', /不一致/);
  assert.throws(() => draftToInput({ ...draft, document: { type: 'doc', attrs: { unknown: true }, content: document.content } }, 'local'), /无损/);
  assert.throws(() => draftToInput({ ...draft, text: 'different saved text' }, 'local'), /无损/);
  assert.equal(hasContent({ ...emptyDraft(), document: documentFromText('') }), false);
  const plain = normalizeDraft({ text: 'literal *text*', document: documentFromText('literal *text*'), images: [], files: [] });
  assert.equal(updateRichDraft(plain, documentFromText('literal *text*!')).text, 'literal *text*!');
});

test('ProseMirror mounts, edits a legacy document, restores it after refresh and submits it', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    const state={submissions:[],listeners:new Set()};
    const client={async rpc(method) {
      if(method==='model/list') return {data:[],nextCursor:null};
      if(method==='config/read') return {config:{}};
      if(method==='thread/queue/list') return {data:[],nextCursor:null};
      throw Error('Unexpected RPC '+method);
    },async host(method,params) {
      if(method==='get-setting') return {value:params.key==='composerEnterBehavior'?'enter':'queue'};
      throw Error('Unexpected host '+method);
    },subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener)},async reply(){throw Error('unexpected approval')}};
    let props={client,context:{hostId:'local',threadId:'thread-1',draftId:'legacy',cwd:'/workspace'},busy:false,
      onSubmit:async(draft,options,action)=>state.submissions.push({draft:structuredClone(draft),input:draftToInput(draft,'local'),options,action}),
      onInterrupt:async()=>{}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', outfile: 'fixture.js' });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/');
    const prompt = serializeRichDocument(readRichDocument(document)!);
    const atoms = { 'composer-prompt-drafts-v2': { legacy: { prompt: { document, plainTextMode: false } } },
      'composer-retained-documents-v1': { legacy: { document, plainTextMode: false, prompt } } };
    await page.evaluate(value => localStorage.setItem('native-atoms', JSON.stringify(value)), atoms);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.waitFor();
    assert.equal(await editor.getAttribute('contenteditable'), 'true');
    assert.equal(await page.locator('textarea[aria-label="和 Codex 一起工作"]').count(), 0);
    assert.equal(await editor.locator('[data-mention="file"]').innerText(), '@file');
    assert.equal(await editor.locator('[data-mention="skill"]').innerText(), 'Fixture');
    assert.equal(await editor.locator('em').innerText(), 'italic');
    assert.equal(await editor.locator('p code').innerText(), 'inline');
    assert.equal(await editor.locator('ol').getAttribute('start'), '4');
    assert.equal(await editor.locator('pre').innerText(), 'const x = 1;');
    await page.setViewportSize({ width: 375, height: 800 });
    assert.equal(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await editor.locator('p').first().click();
    await editor.press('Control+Home');
    await page.getByRole('button', { name: '粗体' }).click();
    await page.keyboard.type('Edited ');
    await page.keyboard.press('Control+z');
    assert.doesNotMatch(await editor.innerText(), /^Edited/);
    await page.keyboard.press('Control+Shift+z');
    assert.match(await editor.innerText(), /^Edited/);
    await editor.locator('a').click();
    await editor.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.match(await editor.locator('a').innerText(), /X/);
    await editor.locator('ul p').click();
    await editor.press('End');
    await page.keyboard.type(' updated');
    await editor.locator('pre').click();
    await editor.press('End');
    await page.keyboard.type(' // updated');
    const imePrevented = await editor.evaluate(element => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(imePrevented, false);
    assert.equal(await editor.locator('p').count(), 3);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    await page.reload();
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await editor.waitFor();
    assert.match(await editor.innerText(), /^Edited/);
    assert.match(await editor.locator('ul p').innerText(), /item updated/);
    assert.match(await editor.locator('pre').innerText(), /const x = 1; \/\/ updated/);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('native-atoms')!)), atoms);
    await editor.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.match(submitted.input[0].text, /^\*\*Edited/);
    assert.match(submitted.input[0].text, /\*\*bold\*\*/);
    assert.match(submitted.input[0].text, /\*italic\*/);
    assert.match(submitted.input[0].text, /`inline`/);
    assert.match(submitted.input[0].text, /\[[^\]]*X[^\]]*\]\(https:\/\/example\.test\/path/);
    assert.match(submitted.input[0].text, /item updated/);
    assert.match(submitted.input[0].text, /const x = 1; \/\/ updated/);
    assert.deepEqual(submitted.input[1], { type: 'skill', name: 'fixture', path: '/skills/fixture/SKILL.md' });
    assert.equal(submitted.draft.document.content[0].content.find((item: any) => item.type === 'atMention').attrs.fsPath, '/workspace/a.ts');
    assert.equal(submitted.draft.document.content[0].content.find((item: any) => item.marks?.[0]?.type === 'link').marks[0].attrs.sourceAppId, 'source');

    await page.evaluate(({ original, text }) => (window as any).fixture.render({ context: { draftId: 'ordered' }, prefill: { id: 'ordered-prefill', draft: {
      text, document: original, images: [], files: [], input: [
        { type: 'future', metadata: { keep: true } }, { type: 'text', text, text_elements: [] },
        { type: 'skill', name: 'fixture', path: '/skills/fixture/SKILL.md' },
      ],
    } } }), { original: document, text: prompt });
    await editor.locator('[data-mention="skill"]').waitFor();
    await editor.locator('[data-mention="skill"]').click();
    await editor.press('Backspace');
    assert.equal(await editor.locator('[data-mention="skill"]').count(), 0);
    await editor.locator('[data-mention="file"]').click();
    await editor.press('Backspace');
    assert.equal(await editor.locator('[data-mention="file"]').count(), 0);
    await page.reload();
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'ordered' } }));
    await editor.waitFor();
    assert.equal(await editor.locator('[data-mention="skill"]').count(), 0);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const ordered = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.deepEqual(ordered.input[0], { type: 'future', metadata: { keep: true } });
    assert.equal(ordered.input[1].type, 'text');
    assert.equal(ordered.input.some((item: any) => item.type === 'skill'), false);
    assert.doesNotMatch(ordered.input[1].text, /\/workspace\/a\.ts/);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'unsupported' }, prefill: { id: 'unsupported', draft: {
      text: 'retained', images: [], files: [], input: [{ type: 'text', text: 'retained', text_elements: [] }],
      document: { type: 'doc', attrs: { unknown: 'preserve' }, content: [{ type: 'paragraph' }] },
    } } }));
    await page.getByText('此草稿包含尚不支持的文档内容，已保留原始数据。').waitFor();
    assert.equal(await editor.getAttribute('readonly'), '');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '无法无损发送' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 1);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'new-rich' }, prefill: null }));
    await editor.fill('new plain draft');
    await page.getByRole('button', { name: '富文本编辑' }).click();
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor();
    await editor.press('End');
    await page.keyboard.type(' extended');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 2);
    const fresh = await page.evaluate(() => (window as any).fixture.state.submissions[1]);
    assert.match(fresh.input[0].text, /new plain draft extended/);
    assert.deepEqual(failures, []);
  } finally { await context.close(); await browser.close(); }
});
