import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { defaultMarkdownParser } from 'prosemirror-markdown';
import type { ComposerDocument } from '../src/renderer/workbench-contract.ts';
import { draftToInput } from '../src/renderer/composer/standalone-draft.ts';
import { readRichDocument, serializePlainDocument, serializeRichDocument } from '../src/renderer/composer/rich-document.ts';

test('literal link marks preserve titles, formatting and per-occurrence spelling in complex documents', () => {
  const href = 'https://example.test/a(b)', title = 'Link title';
  const first = '[**bold** and *ital*](https://example.test/a\\(b\\) "Link title")';
  const second = '[bold and ital](<https://example.test/a(b)> "Link title")';
  const link = (source: string, id: number) => ({ type: 'link', attrs: { href, title,
    sourceAppId: 'fixture', literalMarkdownSource: source, literalMarkdownOccurrenceId: id } });
  const document: ComposerDocument = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
    { type: 'list', content: [{ type: 'regular_list_item', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Before ' },
      { type: 'text', text: 'bold', marks: [{ type: 'strong' }, link(first, 8)] },
      { type: 'text', text: ' and ', marks: [link(first, 8)] },
      { type: 'text', text: 'ital', marks: [{ type: 'em' }, link(first, 8)] },
      { type: 'text', text: ' then ' },
      { type: 'text', text: 'bold and ital', marks: [link(second, 9)] },
    ] }] }] },
  ] };
  const parsed = readRichDocument(document);
  assert.ok(parsed);
  const rendered = serializeRichDocument(parsed);
  assert.equal(rendered, '#'.repeat(2) + ' Heading\n\n- Before ' + first + ' then ' + second);
  assert.equal(JSON.stringify(parsed.toJSON()), JSON.stringify(readRichDocument(document)!.toJSON()));
  const draft = { text: rendered, document, images: [], files: [] };
  assert.equal(draftToInput(draft, 'local', { plainTextMode: false })[0]?.text, rendered);
  const plain = String(draftToInput(draft, 'local', { plainTextMode: true })[0]?.text);
  assert.equal(plain, serializePlainDocument(parsed));
  assert.equal((plain.match(/Link title/g) ?? []).length, 2);
  const links: { href: unknown; title: unknown }[] = [];
  defaultMarkdownParser.parse(rendered)?.descendants(node => {
    const mark = node.marks.find(item => item.type.name === 'link');
    if (mark) links.push({ href: mark.attrs.href, title: mark.attrs.title });
  });
  assert.ok(links.length >= 2 && links.every(item => item.href === href && item.title === title));
});

test('literal matching keeps outer marks, escaped labels and rejects mismatched or synthetic source', () => {
  const source = '[a\\]b](<https://example.test/a(b)>)';
  const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'prefix ', marks: [{ type: 'strong' }] },
    { type: 'text', text: 'a]b', marks: [{ type: 'strong' }, { type: 'link', attrs: {
      href: 'https://example.test/a(b)', literalMarkdownSource: source, literalMarkdownOccurrenceId: 1,
    } }] },
    { type: 'text', text: ' suffix', marks: [{ type: 'strong' }] },
  ] }] };
  const parsed = readRichDocument(doc);
  assert.ok(parsed);
  assert.equal(serializeRichDocument(parsed), '**prefix ' + source + ' suffix**');
  const changed = structuredClone(doc);
  changed.content![0]!.content![1]!.text = 'changed';
  const changedParsed = readRichDocument(changed);
  assert.ok(changedParsed);
  const changedText = serializeRichDocument(changedParsed);
  assert.ok(!changedText.includes(source));
  assert.match(changedText, /changed/);
  assert.equal(changed.content![0]!.content![1]!.marks![1]!.attrs!.literalMarkdownSource, source);
  const combined = structuredClone(doc);
  combined.content![0]!.content![1]!.text = 'ab';
  combined.content![0]!.content![1]!.marks![1]!.attrs!.href = 'https://example.test';
  combined.content![0]!.content![1]!.marks![1]!.attrs!.literalMarkdownSource = '[a](https://example.test)[b](https://example.test)';
  const combinedParsed = readRichDocument(combined);
  assert.ok(combinedParsed);
  assert.ok(!serializeRichDocument(combinedParsed).includes('[a](https://example.test)[b]'));
  combined.content![0]!.content![1]!.marks![1]!.attrs!.literalMarkdownSource = '[a\nb](https://example.test)';
  const multilineParsed = readRichDocument(combined)!;
  assert.ok(!serializeRichDocument(multilineParsed).includes('[a\nb](https://example.test)'));
  assert.equal(readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'literalMarkdownLink', attrs: { source: '[x](https://example.test)' } },
  ] }] }), null);
});

test('rich link literals preserve formatted labels and parentheses only when their semantic target matches', () => {
  const source = '[**docs** and *guide*](<https://example.test/a(b)>)';
  const document: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'richLink', attrs: { displayText: 'docs and guide', href: 'https://example.test/a(b)', sourceAppId: 'fixture',
      literalMarkdownSource: source, literalMarkdownOccurrenceId: 3, markdownSourceStart: 7, markdownSourceEnd: 55 } },
  ] }] };
  const parsed = readRichDocument(document);
  assert.ok(parsed);
  assert.equal(serializeRichDocument(parsed), source);
  const mismatched = structuredClone(document);
  mismatched.content![0]!.content![0]!.attrs!.href = 'https://example.test/other';
  assert.equal(readRichDocument(mismatched), null);
});

test('main composer retains link source through editing, paste, undo, freeze, reload and captured submit mode', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    import {readRichDocument,serializeRichDocument} from './src/renderer/composer/rich-document.ts';
    const state={controller:null,submissions:[],lease:null};
    const client={async rpc(method){if(method==='model/list'||method==='thread/queue/list') return {data:[],nextCursor:null};
        if(method==='config/read')return {config:{}};throw Error('Unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'
        ?sessionStorage.getItem('plain')==='true':params.key==='composerEnterBehavior'?'cmdAlways':'queue'};throw Error('Unexpected host '+method)},
      subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    root.render(React.createElement(StandaloneComposer,{client,context:{hostId:'local',threadId:'thread',draftId:'literal',cwd:'/workspace'},busy:false,
      onDraftController(value){state.controller=value},async onSubmit(draft,options,action,description){state.submissions.push({draft:structuredClone(draft),
        input:draftToInput(draft,'local',{plainTextMode:description.documentPlainTextMode}),description})},async onInterrupt(){}}));
    window.fixture={state,async setDocument(document){const controller=state.controller,snapshot=controller.snapshot();
      return controller.update(snapshot.owner,()=>({text:serializeRichDocument(readRichDocument(document)),document,images:[],files:[],references:[],skills:[]}))}};
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/');
    const mount = () => page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await mount(); await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    const source = '[**Bold** and *ital*](https://example.test/a\\(b\\) "Title")';
    const href = 'https://example.test/a(b)';
    const mark = (id: number) => ({ type: 'link', attrs: { href, title: 'Title', sourceAppId: 'fixture',
      literalMarkdownSource: source, literalMarkdownOccurrenceId: id } });
    const document: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Before ' }, { type: 'text', text: 'Bold', marks: [{ type: 'strong' }, mark(1)] },
      { type: 'text', text: ' and ', marks: [mark(1)] }, { type: 'text', text: 'ital', marks: [{ type: 'em' }, mark(1)] },
      { type: 'text', text: ' then ' }, { type: 'text', text: 'Bold', marks: [{ type: 'strong' }, mark(2)] },
      { type: 'text', text: ' and ', marks: [mark(2)] }, { type: 'text', text: 'ital', marks: [{ type: 'em' }, mark(2)] },
    ] }] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), document), true);
    const editor = page.locator('.ProseMirror'); await editor.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.ProseMirror a[data-composer-attrs]').length === 6);
    await editor.click(); await editor.press('Control+End');
    await page.keyboard.type('!');
    try { await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('*!*')); }
    catch (error) {
      console.error('synthetic editor diagnostic', await page.evaluate(() => ({
        draft: (window as any).fixture.state.controller.snapshot().draft,
        html: document.querySelector('.ProseMirror')?.innerHTML,
        selection: window.getSelection()?.toString(),
      })));
      throw error;
    }
    await editor.press('Control+z');
    await page.waitForFunction(() => !(window as any).fixture.state.controller.snapshot().draft.text.endsWith('*!*'));
    await editor.press('Control+Shift+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('*!*'));
    const original = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(original.text, 'Before ' + source + ' then ' + source + '*!*');
    await editor.evaluate(element => {
      const link = element.querySelector('a[data-composer-attrs]')!.cloneNode(true) as HTMLElement;
      const data = new DataTransfer(); data.setData('text/html', link.outerHTML); data.setData('text/plain', link.textContent ?? '');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.waitForFunction(() => {
      const nodes = (window as any).fixture.state.controller.snapshot().draft.document.content[0].content;
      return nodes.some((node: any) => node.marks?.some((item: any) => item.type === 'link' && item.attrs.literalMarkdownOccurrenceId === null));
    });
    await editor.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Before ' +
      '[**Bold** and *ital*](https://example.test/a\\(b\\) "Title") then [**Bold** and *ital*](https://example.test/a\\(b\\) "Title")*!*');
    await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.freeze(c.snapshot().owner) === null; }), true);
    await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await page.waitForFunction(() => { const state = (window as any).fixture.state, c = state.controller;
      state.lease = c.freeze(c.snapshot().owner); return !!state.lease; });
    assert.equal(await page.evaluate(() => (window as any).fixture.state.lease.flush()), true);
    await page.evaluate(() => (window as any).fixture.state.lease.release());
    await page.reload(); await mount(); await editor.waitFor();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    let sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(sent.description.documentPlainTextMode, false);
    assert.equal(sent.input[0].text, original.text);
    assert.equal(sent.draft.document.content[0].content[1].marks.find((item: any) => item.type === 'link').attrs.literalMarkdownOccurrenceId, 1);
    await page.evaluate(() => sessionStorage.setItem('plain', 'true'));
    await page.reload(); await mount(); await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), document), true);
    await editor.waitFor(); await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(sent.description.documentPlainTextMode, true);
    assert.equal(sent.input[0].text, serializePlainDocument(readRichDocument(document)!));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
