import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import { defaultMarkdownParser } from 'prosemirror-markdown';
import type { ComposerDocument } from '../src/renderer/workbench-contract.ts';
import { draftToInput } from '../src/renderer/composer/standalone-draft.ts';
import { readRichDocument, safeRichLinkHref, serializePlainDocument, serializeRichDocument } from '../src/renderer/composer/rich-document.ts';

async function waitForBrowser(check: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for the asynchronous browser condition.')), 8_000);
  });
  try {
    for (;;) {
      if (await Promise.race([check(), timeout])) return;
      await Promise.race([new Promise(resolve => setTimeout(resolve, 30)), timeout]);
    }
  } finally { clearTimeout(timer); }
}

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
  assert.equal(readRichDocument(combined), null);
  assert.equal(combined.content![0]!.content![1]!.marks![1]!.attrs!.literalMarkdownSource, '[a\nb](https://example.test)');
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

test('link destinations allow only explicit safe URL schemes', () => {
  assert.equal(safeRichLinkHref(' https://example.test/a(b) '), 'https://example.test/a(b)');
  assert.equal(safeRichLinkHref('mailto:person@example.test'), 'mailto:person@example.test');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'https://', '/relative', 'https://example.test\n']) {
    assert.equal(safeRichLinkHref(value), null);
  }
});

test('changed links retain empty and escaped titles when serialized and parsed', () => {
  for (const title of ['', 'backslash\\"quote', 'line\nbreak']) {
    const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'label', marks: [{ type: 'link', attrs: { href: 'https://example.test/path', title } }] },
    ] }] };
    const parsed = readRichDocument(doc)!;
    assert.equal(parsed.toJSON().content[0].content[0].marks[0].attrs.title, title);
    for (const text of [serializeRichDocument(parsed), serializePlainDocument(parsed)]) {
      const rendered = defaultMarkdownParser.parse(text);
      if (title === '') assert.ok(text.endsWith(' "")'));
      assert.equal(rendered?.firstChild?.firstChild?.marks[0]?.attrs.title, title || null);
      assert.equal(rendered?.firstChild?.firstChild?.marks[0]?.attrs.href, 'https://example.test/path');
    }
  }
});

test('original null-href auto links serialize from their complete marked text', () => {
  const url = 'https://example.test/path';
  const auto = { type: 'link', attrs: { href: null, sourceAppId: 'fixture', literalMarkdownSource: '<' + url + '>',
    literalMarkdownOccurrenceId: 7 } };
  const single: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: url, marks: [auto] },
  ] }] };
  const parsed = readRichDocument(single);
  assert.ok(parsed);
  assert.equal(serializeRichDocument(parsed), '<' + url + '>');
  assert.equal(serializePlainDocument(parsed), '[' + url + '](' + url + ')');
  assert.equal(serializePlainDocument(parsed, true), '[' + url + '](' + url + ')');
  assert.deepEqual(parsed.toJSON().content[0].content[0].marks[0].attrs.href, null);
  const split: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'https://', marks: [{ type: 'strong' }, auto] },
    { type: 'text', text: 'example.test/path', marks: [auto] },
  ] }] };
  const splitParsed = readRichDocument(split);
  assert.ok(splitParsed);
  const markdown = serializeRichDocument(splitParsed);
  const resulting = defaultMarkdownParser.parse(markdown);
  const urls: unknown[] = [];
  resulting?.descendants(node => { const mark = node.marks.find(value => value.type.name === 'link'); if (mark) urls.push(mark.attrs.href); });
  assert.ok(urls.length && urls.every(value => value === url));
  assert.equal(serializePlainDocument(splitParsed), '[' + url + '](' + url + ')');
  const invalid = structuredClone(single);
  invalid.content![0]!.content![0]!.text = 'not a URL';
  const invalidParsed = readRichDocument(invalid);
  assert.ok(invalidParsed);
  assert.equal(serializeRichDocument(invalidParsed), 'not a URL');
  assert.equal(serializePlainDocument(invalidParsed), 'not a URL');
  assert.equal(invalidParsed.toJSON().content[0].content[0].marks[0].attrs.literalMarkdownOccurrenceId, 7);
});

async function composerBundle(): Promise<string> {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    import {readRichDocument,serializeRichDocument} from './src/renderer/composer/rich-document.ts';
    import {composerDraftAtomKey,readComposerDraftVersions,writeComposerDraftVersion,updateComposerDraftVersionInRoot} from './src/renderer/composer/composer-draft-store.ts';
    import {updateBrowserAtom} from './src/renderer/storage/ui-atoms.ts';
    const state={controller:null,submissions:[],lease:null,holdSubmission:false,submitError:null};
    let resolveSubmit;
    const client={async rpc(method){if(method==='model/list'||method==='thread/queue/list') return {data:[],nextCursor:null};
        if(method==='config/read')return {config:{}};throw Error('Unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'
        ?sessionStorage.getItem('plain')==='true':params.key==='composerEnterBehavior'?'cmdAlways':'queue'};throw Error('Unexpected host '+method)},
      subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    root.render(React.createElement(StandaloneComposer,{client,context:{hostId:'local',threadId:'thread',draftId:'literal',cwd:'/workspace'},busy:false,
      onDraftController(value){state.controller=value},async onSubmit(draft,options,action,description){state.submissions.push({draft:structuredClone(draft),
        input:draftToInput(draft,'local',{plainTextMode:description.documentPlainTextMode}),description});
        if(state.submitError)throw Error(state.submitError);
        if(state.holdSubmission)await new Promise(resolve=>{resolveSubmit=resolve})},async onInterrupt(){}}));
    window.fixture={state,readComposerDraftVersions,writeComposerDraftVersion,resolveSubmit(){resolveSubmit()},
      async commitVersion(before, draft){let committed;
        await updateBrowserAtom(composerDraftAtomKey,root=>{committed=updateComposerDraftVersionInRoot(root,before,()=>draft,'external-after');return committed.root});
        return committed.after},
      async setDocument(document){const controller=state.controller,snapshot=controller.snapshot();
      return controller.update(snapshot.owner,()=>({text:serializeRichDocument(readRichDocument(document)),document,images:[],files:[],references:[],skills:[]}))},
      async hold(){
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
          request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        const transaction=db.transaction('atoms','readwrite'),store=transaction.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{transaction.onabort=()=>reject(transaction.error);transaction.oncomplete=()=>{db.close();resolve()}});
        await new Promise((resolve,reject)=>{let first=true;const poll=()=>{const request=store.get('native-atoms');
          request.onerror=()=>reject(request.error);request.onsuccess=()=>{if(!released)poll();if(first){first=false;resolve()}}};poll()});
        this.release=()=>{released=true;return done};
      }};
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  return bundle.outputFiles[0]!.text;
}

test('main composer retains link source through editing, paste, undo, freeze, reload and captured submit mode', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/');
    const mount = () => page.addScriptTag({ content: bundle });
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
    await page.waitForFunction(() => globalThis.document.querySelectorAll('.ProseMirror a[data-composer-attrs]').length === 6);
    await editor.click(); await editor.press('Control+End');
    await page.keyboard.type('!');
    try { await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('*!*')); }
    catch (error) {
      console.error('synthetic editor diagnostic', await page.evaluate(() => ({
        draft: (window as any).fixture.state.controller.snapshot().draft,
        html: globalThis.document.querySelector('.ProseMirror')?.innerHTML,
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
      return nodes.some((node: any) => node.marks?.some((item: any) => item.type === 'link'
        && item.attrs.literalMarkdownSource === null && Number.isInteger(item.attrs.literalMarkdownOccurrenceId)
        && ![1, 2].includes(item.attrs.literalMarkdownOccurrenceId)));
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

test('main composer edits only the selected link and protects stale or unsafe actions', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    const href = 'https://example.test/docs';
    const node = (id: number) => ({ type: 'richLink', attrs: { displayText: 'Docs', href, sourceAppId: 'fixture-app',
      literalMarkdownSource: '[Docs](https://example.test/docs)', literalMarkdownOccurrenceId: id,
      markdownSourceStart: id * 40, markdownSourceEnd: id * 40 + 28 } });
    const link = { type: 'link', attrs: { href, title: 'Title', sourceAppId: 'fixture-app',
      literalMarkdownSource: '[**Bold** *tail*](https://example.test/docs "Title")', literalMarkdownOccurrenceId: 3 } };
    const rich: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      node(1), { type: 'text', text: ' and ' }, node(2), { type: 'text', text: ' plus ' },
      { type: 'text', text: 'Bold', marks: [{ type: 'strong' }, link] },
      { type: 'text', text: ' ', marks: [link] }, { type: 'text', text: 'tail', marks: [{ type: 'em' }, link] },
    ] }] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), rich), true);
    const editor = page.locator('.ProseMirror');
    const nodes = editor.locator('[data-mention="rich-link"]');
    await page.waitForFunction(() => globalThis.document.querySelectorAll('[data-mention="rich-link"]').length === 2);
    const dialog = page.getByRole('dialog', { name: '链接' });
    await nodes.first().click();
    assert.equal(await dialog.getByRole('link').getAttribute('href'), href);
    assert.match(await dialog.innerText(), /来源: fixture-app/);
    await dialog.getByRole('button', { name: '编辑链接文字' }).click();
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.freeze(c.snapshot().owner); }), null);
    await dialog.getByRole('textbox', { name: '链接文字' }).fill('Docs revised');
    await dialog.getByRole('button', { name: '保存链接文字' }).click();
    await page.waitForFunction(() => globalThis.document.querySelector('[data-mention="rich-link"]')?.textContent === 'Docs revised');
    let snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(snapshot.document.content[0].content[0].attrs.literalMarkdownOccurrenceId, 1);
    assert.equal(snapshot.document.content[0].content[2].attrs.literalMarkdownOccurrenceId, 2);
    await editor.press('Control+z');
    await page.waitForFunction(() => globalThis.document.querySelector('[data-mention="rich-link"]')?.textContent === 'Docs');
    await editor.press('Control+Shift+z');
    await page.waitForFunction(() => globalThis.document.querySelector('[data-mention="rich-link"]')?.textContent === 'Docs revised');

    await nodes.nth(1).click(); await dialog.getByRole('button', { name: '编辑链接地址' }).click();
    const address = dialog.getByRole('textbox', { name: '链接地址' });
    await address.fill('javascript:alert(1)'); await dialog.getByRole('button', { name: '保存链接地址' }).click();
    assert.match(await dialog.getByRole('alert').innerText(), /HTTP/);
    snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(snapshot.document.content[0].content[2].attrs.href, href);
    await address.fill('mailto:editor@example.test'); await dialog.getByRole('button', { name: '保存链接地址' }).click();
    await page.waitForFunction(() => (globalThis.document.querySelectorAll('[data-mention="rich-link"]')[1] as HTMLElement)?.title === 'mailto:editor@example.test');
    await nodes.nth(1).click();
    assert.equal(await dialog.getByRole('link').getAttribute('href'), 'mailto:editor@example.test');
    await dialog.getByRole('button', { name: '编辑链接地址' }).click(); await address.fill('');
    await dialog.getByRole('button', { name: '移除链接' }).click();
    await page.waitForFunction(() => globalThis.document.querySelectorAll('[data-mention="rich-link"]').length === 1);
    assert.match(await editor.innerText(), /Docs revised and Docs plus Bold tail/);
    await editor.press('Control+z');
    await page.waitForFunction(() => globalThis.document.querySelectorAll('[data-mention="rich-link"]').length === 2);

    await editor.locator('a[data-composer-attrs]').first().click();
    assert.match(await dialog.innerText(), /Bold tail/);
    await dialog.getByRole('button', { name: '编辑链接地址' }).click();
    await address.fill('https://example.test/new'); await dialog.getByRole('button', { name: '保存链接地址' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('https://example.test/new'));
    snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    const marked = snapshot.document.content[0].content.filter((item: any) => item.marks?.some((mark: any) => mark.type === 'link'));
    assert.equal(marked.length, 3);
    assert.ok(marked.every((item: any) => item.marks.find((mark: any) => mark.type === 'link').attrs.href === 'https://example.test/new'));
    assert.ok(marked[0].marks.some((mark: any) => mark.type === 'strong'));
    assert.ok(marked[2].marks.some((mark: any) => mark.type === 'em'));
    assert.equal(snapshot.document.content[0].content[0].attrs.displayText, 'Docs revised');
    await editor.press('Control+z'); await page.waitForFunction(() => !(window as any).fixture.state.controller.snapshot().draft.text.includes('https://example.test/new'));
    await editor.press('Control+Shift+z'); await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('https://example.test/new'));
    await editor.locator('a[data-composer-attrs]').first().click();
    await dialog.getByRole('button', { name: '编辑链接文字' }).click();
    await dialog.getByRole('textbox', { name: '链接文字' }).fill('Bold tails');
    await dialog.getByRole('button', { name: '保存链接文字' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('tails'));
    snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    const revised = snapshot.document.content[0].content.filter((item: any) => item.marks?.some((mark: any) => mark.type === 'link'));
    assert.equal(revised.map((item: any) => item.text).join(''), 'Bold tails');
    assert.ok(revised[0].marks.some((mark: any) => mark.type === 'strong'));
    assert.ok(revised.at(-1).marks.some((mark: any) => mark.type === 'em'));
    assert.ok(revised.every((item: any) => item.marks.find((mark: any) => mark.type === 'link').attrs.title === 'Title'));
    assert.equal(snapshot.document.content[0].content[0].attrs.displayText, 'Docs revised');
    const unsafe: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
    ] }] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), unsafe), true);
    const unsafeLink = editor.locator('a[data-composer-attrs]');
    await page.waitForFunction(() => globalThis.document.querySelector('.ProseMirror a[data-composer-attrs]')?.textContent === 'unsafe');
    assert.equal(await unsafeLink.getAttribute('href'), null);
    await unsafeLink.focus(); await page.keyboard.press('Enter');
    assert.equal(await dialog.getByRole('link').count(), 0);
    assert.equal(page.url(), 'http://localhost/');
    await dialog.getByRole('button', { name: '编辑链接地址' }).click(); await address.fill('https://example.test/safe');
    await dialog.getByRole('button', { name: '保存链接地址' }).click();
    await page.waitForFunction(() => globalThis.document.querySelector('.ProseMirror a')?.getAttribute('href') === 'https://example.test/safe');

    await unsafeLink.click(); await dialog.getByRole('button', { name: '编辑链接文字' }).click();
    await dialog.getByRole('textbox', { name: '链接文字' }).fill('pending edit');
    const externallyChanged: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'newer draft' }] }] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), externallyChanged), true);
    await page.waitForFunction(() => globalThis.document.querySelector('.ProseMirror')?.textContent === 'newer draft');
    await dialog.getByRole('button', { name: '保存链接文字' }).click();
    assert.match(await dialog.getByRole('alert').innerText(), /链接已更改/);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), 'newer draft');
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.freeze(c.snapshot().owner); }), null);
    await dialog.getByRole('button', { name: '关闭' }).click();
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), snapshot.document), true);
    await page.waitForFunction(() => globalThis.document.querySelector('.ProseMirror')?.textContent?.includes('Bold tails'));
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => globalThis.document.querySelector('.ProseMirror')?.textContent?.includes('Bold tails'));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(submitted.description.documentPlainTextMode, false);
    assert.equal(submitted.input[0].text, snapshot.text);
    assert.ok(submitted.input[0].text.includes('https://example.test/new'));
    assert.equal(submitted.draft.document.content[0].content[0].attrs.displayText, 'Docs revised');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('main composer creates and restores null-href automatic links without losing the document', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    await page.getByRole('button', { name: '富文本编辑' }).click();
    const editor = page.locator('.ProseMirror'); await editor.waitFor(); await editor.click();
    const url = 'https://example.test/path';
    await page.keyboard.type(url);
    await editor.evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
    });
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.freeze(c.snapshot().owner) === null; }), true);
    assert.equal(await editor.locator('[data-composer-autolink]').count(), 0);
    await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await page.waitForFunction(() => { const state = (window as any).fixture.state, c = state.controller;
      state.lease = c.freeze(c.snapshot().owner); return !!state.lease; });
    await page.evaluate(() => (window as any).fixture.state.lease.release());
    await editor.focus(); await page.keyboard.press('Space');
    try { await page.waitForFunction(() => globalThis.document.querySelector('[data-composer-autolink]')?.textContent === 'https://example.test/path'); }
    catch (error) {
      console.error('synthetic autolink diagnostic', await page.evaluate(() => ({
        draft: (window as any).fixture.state.controller.snapshot().draft,
        html: globalThis.document.querySelector('.ProseMirror')?.innerHTML,
        active: globalThis.document.activeElement?.outerHTML,
      })));
      throw error;
    }
    let draft = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(draft.document.content[0].content[0].marks[0].attrs.href, null);
    assert.equal(draft.text, '<' + url + '> ');
    await editor.press('Control+z');
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-composer-autolink]'));
    await editor.press('Control+Shift+z');
    await page.waitForFunction(() => globalThis.document.querySelector('[data-composer-autolink]')?.textContent === 'https://example.test/path');
    await editor.press('Control+End');
    await page.keyboard.type(' separator ');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('separator'));
    await editor.press('Control+End');
    await editor.evaluate(element => {
      const link = element.querySelector('[data-composer-autolink]')!.cloneNode(true) as HTMLElement;
      const data = new DataTransfer(); data.setData('text/html', link.outerHTML); data.setData('text/plain', link.textContent ?? '');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    try { await page.waitForFunction(() => globalThis.document.querySelectorAll('[data-composer-autolink]').length === 2); }
    catch (error) {
      console.error('synthetic autolink paste diagnostic', await page.evaluate(() => ({
        draft: (window as any).fixture.state.controller.snapshot().draft,
        html: globalThis.document.querySelector('.ProseMirror')?.innerHTML,
        selection: window.getSelection()?.toString(),
      })));
      throw error;
    }
    await editor.press('Control+z');
    await page.waitForFunction(() => globalThis.document.querySelectorAll('[data-composer-autolink]').length === 1);
    await editor.press('Control+End'); await page.keyboard.type('continued');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('continued'));
    draft = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(draft.document.content[0].content[0].marks[0].attrs.href, null);
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => globalThis.document.querySelector('[data-composer-autolink]')?.textContent === 'https://example.test/path');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(sent.description.documentPlainTextMode, false);
    assert.equal(sent.input[0].text, draft.text);
    assert.equal(sent.draft.document.content[0].content[0].marks[0].attrs.href, null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('link text edits preserve interior marks in one undoable transaction', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    const link = { type: 'link', attrs: { href: 'https://example.test/a', title: 'Title', literalMarkdownOccurrenceId: 11,
      literalMarkdownSource: '[A**B***C*D](https://example.test/a "Title")' } };
    const richDocument: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'A', marks: [link] }, { type: 'text', text: 'B', marks: [{ type: 'strong' }, link] },
      { type: 'text', text: 'C', marks: [{ type: 'em' }, link] }, { type: 'text', text: 'D', marks: [link] },
    ] }] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), richDocument), true);
    const editor = page.locator('.ProseMirror'), dialog = page.getByRole('dialog', { name: '链接' });
    await editor.locator('a[data-composer-attrs]').first().click();
    await dialog.getByRole('button', { name: '编辑链接文字' }).click();
    await dialog.getByRole('textbox', { name: '链接文字' }).fill('xABCDy');
    await dialog.getByRole('button', { name: '保存链接文字' }).click();
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'xABCDy');
    const inspect = async () => page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document.content[0].content);
    let nodes = await inspect();
    assert.equal(nodes.map((node: any) => node.text).join(''), 'xABCDy');
    assert.ok(nodes.some((node: any) => node.text.includes('B') && node.marks.some((mark: any) => mark.type === 'strong')));
    assert.ok(nodes.some((node: any) => node.text.includes('C') && node.marks.some((mark: any) => mark.type === 'em')));
    assert.ok(nodes.every((node: any) => node.marks.find((mark: any) => mark.type === 'link').attrs.literalMarkdownOccurrenceId === 11));
    assert.ok(nodes.every((node: any) => node.marks.find((mark: any) => mark.type === 'link').attrs.literalMarkdownSource === null));
    await editor.press('Control+z'); await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'ABCD');
    nodes = await inspect();
    assert.ok(nodes.some((node: any) => node.text === 'B' && node.marks.some((mark: any) => mark.type === 'strong')));
    assert.ok(nodes.some((node: any) => node.text === 'C' && node.marks.some((mark: any) => mark.type === 'em')));
    await editor.press('Control+Shift+z'); await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'xABCDy');
    const editedDocument = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
    const ambiguous: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'A', marks: [{ type: 'strong' }, link] }, { type: 'text', text: 'A', marks: [{ type: 'em' }, link] },
    ] }] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), ambiguous), true);
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'AA');
    const beforeAmbiguous = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    await editor.locator('a[data-composer-attrs]').first().click();
    await dialog.getByRole('button', { name: '编辑链接文字' }).click();
    await dialog.getByRole('textbox', { name: '链接文字' }).fill('A');
    await dialog.getByRole('button', { name: '保存链接文字' }).click();
    await dialog.getByRole('alert').filter({ hasText: '无法安全保留此链接文字修改中的格式' }).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), beforeAmbiguous);
    assert.equal(await dialog.getByRole('textbox', { name: '链接文字' }).inputValue(), 'A');
    await dialog.getByRole('button', { name: '关闭' }).click();
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), editedDocument), true);
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'xABCDy');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    const parsed = defaultMarkdownParser.parse(submitted.input[0].text);
    const marked: { text: string; marks: string[]; href: unknown }[] = [];
    parsed?.descendants(node => { if (node.isText) marked.push({ text: node.text ?? '', marks: node.marks.map(mark => mark.type.name),
      href: node.marks.find(mark => mark.type.name === 'link')?.attrs.href }); });
    assert.ok(marked.some(value => value.text.includes('B') && value.marks.includes('strong')));
    assert.ok(marked.some(value => value.text.includes('C') && value.marks.includes('em')));
    assert.ok(marked.every(value => value.href === 'https://example.test/a'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('adjacent new and pasted links retain distinct instances and send distinct destinations', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value),
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AB' }] }] }), true);
    const editor = page.locator('.ProseMirror'); await editor.waitFor();
    for (const letter of ['A', 'B']) {
      await editor.evaluate((element, target) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          const index = text.textContent?.indexOf(target) ?? -1;
          if (index < 0) continue;
          const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 1);
          const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); break;
        }
      }, letter);
      await page.getByRole('button', { name: '链接', exact: true }).click();
      await page.getByRole('textbox', { name: '链接地址' }).fill('https://example.test/same');
      await page.getByRole('button', { name: '应用', exact: true }).click();
    }
    let nodes = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document.content[0].content);
    assert.deepEqual(nodes.map((node: any) => node.text), ['A', 'B']);
    assert.notEqual(nodes[0].marks[0].attrs.literalMarkdownOccurrenceId, nodes[1].marks[0].attrs.literalMarkdownOccurrenceId);
    const dialog = page.getByRole('dialog', { name: '链接' });
    await editor.locator('a[data-composer-attrs]').first().click();
    await dialog.getByRole('button', { name: '编辑链接地址' }).click();
    await dialog.getByRole('textbox', { name: '链接地址' }).fill('https://example.test/first');
    await dialog.getByRole('button', { name: '保存链接地址' }).click();
    nodes = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document.content[0].content);
    assert.deepEqual(nodes.map((node: any) => node.marks[0].attrs.href), ['https://example.test/first', 'https://example.test/same']);
    await editor.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.document.content[0].content[0].marks[0].attrs.href === 'https://example.test/same');
    await editor.press('Control+Shift+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.document.content[0].content[0].marks[0].attrs.href === 'https://example.test/first');

    const formattedLink = { type: 'link', attrs: { href: 'https://example.test/formatted', literalMarkdownOccurrenceId: 11 } };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'A', marks: [{ type: 'strong' }, formattedLink] },
      { type: 'text', text: 'B', marks: [{ type: 'em' }, formattedLink] },
    ] }] }), true);
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'AB');
    await editor.click(); await editor.press('Control+End');
    await editor.evaluate(element => {
      const paragraph = element.querySelector('p')!;
      const data = new DataTransfer(); data.setData('text/html', paragraph.innerHTML); data.setData('text/plain', 'AB');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'ABAB');
    nodes = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document.content[0].content);
    const linkId = (node: any) => node.marks.find((mark: any) => mark.type === 'link').attrs.literalMarkdownOccurrenceId;
    assert.deepEqual(nodes.map(linkId).slice(0, 2), [11, 11]);
    assert.equal(linkId(nodes[2]), linkId(nodes[3])); assert.notEqual(linkId(nodes[2]), 11);
    await editor.locator('a[data-composer-attrs]').nth(2).click();
    await dialog.getByRole('button', { name: '编辑链接地址' }).click();
    await dialog.getByRole('textbox', { name: '链接地址' }).fill('https://example.test/copy');
    await dialog.getByRole('button', { name: '保存链接地址' }).click();
    nodes = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document.content[0].content);
    assert.deepEqual(nodes.map((node: any) => node.marks.find((mark: any) => mark.type === 'link').attrs.href),
      ['https://example.test/formatted', 'https://example.test/formatted', 'https://example.test/copy', 'https://example.test/copy']);

    const url = 'https://example.test/path';
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: null, literalMarkdownOccurrenceId: 9, literalMarkdownSource: '<' + url + '>' } }] },
    ] }] }), true);
    await page.waitForFunction(() => document.querySelector('[data-composer-autolink]')?.textContent === 'https://example.test/path');
    await editor.click(); await editor.press('Control+End');
    await editor.evaluate(element => {
      const link = element.querySelector('[data-composer-autolink]')!.cloneNode(true) as HTMLElement;
      const data = new DataTransfer(); data.setData('text/html', link.outerHTML); data.setData('text/plain', link.textContent ?? '');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-composer-autolink]').length === 2);
    const copied = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    nodes = copied.document.content[0].content;
    assert.deepEqual(nodes.map((node: any) => node.text), [url, url]);
    assert.equal(nodes[0].marks[0].attrs.literalMarkdownOccurrenceId, 9);
    assert.notEqual(nodes[1].marks[0].attrs.literalMarkdownOccurrenceId, 9);
    assert.equal(nodes[1].marks[0].attrs.literalMarkdownSource, null);
    await editor.press('Control+z'); await page.waitForFunction(() => document.querySelectorAll('[data-composer-autolink]').length === 1);
    await editor.press('Control+Shift+z'); await page.waitForFunction(() => document.querySelectorAll('[data-composer-autolink]').length === 2);
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => document.querySelectorAll('[data-composer-autolink]').length === 2);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    const tokens = defaultMarkdownParser.tokenizer.parse(submitted.input[0].text, {});
    const hrefs = tokens.flatMap(token => token.children ?? []).filter(token => token.type === 'link_open').map(token => token.attrGet('href'));
    assert.deepEqual(hrefs, [url, url]);
    assert.equal(submitted.input[0].text.includes(url + url), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

async function openRichComposer(context: BrowserContext, bundle: string): Promise<Page> {
  const page = await context.newPage(); page.setDefaultTimeout(8_000);
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
  await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
  assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
  return page;
}
const formLinkDocument: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'Original', marks: [{ type: 'link', attrs: { href: 'https://example.test/original', literalMarkdownOccurrenceId: 5 } }] },
] }] };
async function editLinkAddress(page: Page): Promise<void> {
  await page.locator('.ProseMirror a[data-composer-attrs]').first().click();
  const dialog = page.getByRole('dialog', { name: '链接' });
  await dialog.getByRole('button', { name: '编辑链接地址' }).click();
  await dialog.getByRole('textbox', { name: '链接地址' }).fill('https://example.test/pending');
}

test('pending link form blocks capture and dispatch, and survives delayed confirmation until closed', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const context = await browser.newContext();
  try {
    const page = await openRichComposer(context, bundle), blocker = await openRichComposer(context, bundle);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), formLinkDocument), true);
    assert.equal(await page.evaluate(async () => {
      const c = (window as any).fixture.state.controller, s = c.snapshot();
      return c.update(s.owner, (draft: any) => ({ ...draft, pendingDrafts: [{ text: 'retained pending', images: [], files: [], references: [], skills: [] }] }));
    }), true);
    const editor = page.locator('.ProseMirror'), dialog = page.getByRole('dialog', { name: '链接' }); await editor.waitFor();
    await editLinkAddress(page);
    assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); return window.dispatchEvent(e); }), false);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '请先应用或关闭链接编辑' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    await page.getByRole('button', { name: '切换草稿' }).click();
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    assert.equal(await editor.textContent(), 'Original');
    await dialog.getByRole('button', { name: '关闭' }).click();
    assert.equal(await page.evaluate(async () => {
      const c = (window as any).fixture.state.controller, s = c.snapshot();
      return c.update(s.owner, (draft: any) => ({ ...draft, pendingDrafts: undefined }));
    }), true);

    await blocker.evaluate(() => (window as any).fixture.hold());
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '发送中', exact: true }).waitFor();
    await editLinkAddress(page);
    await blocker.evaluate(() => (window as any).fixture.release());
    await page.getByRole('alert').filter({ hasText: '请先应用或关闭链接编辑' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    await dialog.getByRole('button', { name: '关闭' }).click();

    await page.evaluate(() => { (window as any).fixture.state.holdSubmission = true; });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    await editLinkAddress(page);
    await page.evaluate(() => (window as any).fixture.resolveSubmit());
    await waitForBrowser(() => page.evaluate(async () => {
      const f = (window as any).fixture, owner = f.state.controller.snapshot().owner;
      return (await f.readComposerDraftVersions(owner)).versions.every((value: any) => !value.draft.document);
    }));
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    assert.equal(await editor.count(), 1);
    assert.equal((await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft)).document.content[0].content[0].text, 'Original');
    await dialog.getByRole('button', { name: '关闭' }).click();
    await editor.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), '');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('another page clearing a submitted revision preserves and branches a pending link edit', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const context = await browser.newContext();
  try {
    const page = await openRichComposer(context, bundle);
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), formLinkDocument), true);
    const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    const other = await openRichComposer(context, bundle);
    await other.waitForFunction(revision => (window as any).fixture.state.controller.snapshot().revision === revision, before.revision);
    await editLinkAddress(page);
    await other.evaluate(revision => (window as any).fixture.state.controller.clearSubmittedVersion(revision), before.revision);
    await other.locator('.ProseMirror').waitFor({ state: 'detached' });
    const otherDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'other page version' }] }] };
    assert.equal(await other.evaluate(value => (window as any).fixture.setDocument(value), otherDocument), true);
    const dialog = page.getByRole('dialog', { name: '链接' });
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    assert.equal((await page.evaluate(() => (window as any).fixture.state.controller.snapshot())).revision, before.revision);
    await dialog.getByRole('button', { name: '保存链接地址' }).click();
    await page.waitForFunction(() => document.querySelector('.ProseMirror a')?.getAttribute('href') === 'https://example.test/pending');
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
    const versions = await page.evaluate(async () => {
      const f = (window as any).fixture; return (await f.readComposerDraftVersions(f.state.controller.snapshot().owner)).versions.map((value: any) => value.draft.text).sort();
    });
    assert.deepEqual(versions, ['[Original](https://example.test/pending)', 'other page version'].sort());
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => document.querySelector('.ProseMirror a')?.getAttribute('href') === 'https://example.test/pending');
    await page.getByText('选择草稿版本').click();
    assert.equal(await page.getByRole('button', { name: 'other page version' }).count(), 1);
  } finally { await context.close(); await browser.close(); }
});

test('pending link forms prevent immediate and in-flight version switches', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const context = await browser.newContext();
  try {
    const page = await openRichComposer(context, bundle), blocker = await openRichComposer(context, bundle);
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), formLinkDocument), true);
    const original = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    await page.evaluate(async () => {
      const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
      const { document: _document, ...draft } = snapshot.draft;
      await f.writeComposerDraftVersion(snapshot.owner, 'missing-version', { revision: 'other-version', draft: { ...draft, text: 'other version' }, prefills: [] });
    });
    await page.getByText('选择草稿版本').click();
    const other = page.getByRole('button', { name: 'other version', exact: true }); await other.waitFor();
    const dialog = page.getByRole('dialog', { name: '链接' });
    await editLinkAddress(page); await other.click();
    await page.getByRole('alert').filter({ hasText: '请先应用或关闭链接编辑' }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    await dialog.getByRole('button', { name: '关闭' }).click();
    await other.click();
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().revision === 'other-version');
    await page.getByRole('button', { name: original.draft.text, exact: true }).click();
    await page.waitForFunction(revision => (window as any).fixture.state.controller.snapshot().revision === revision, original.revision);
    await page.getByRole('alert').filter({ hasText: '请先应用或关闭链接编辑' }).waitFor({ state: 'detached' });

    await blocker.evaluate(() => (window as any).fixture.hold());
    await other.click();
    await editLinkAddress(page);
    await blocker.evaluate(() => (window as any).fixture.release());
    await page.getByRole('alert').filter({ hasText: '请先应用或关闭链接编辑' }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    assert.equal(await page.locator('.ProseMirror').textContent(), 'Original');
    await dialog.getByRole('button', { name: '关闭' }).click();
    await other.click();
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().revision === 'other-version');
    assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), 'other version');
  } finally { await context.close(); await browser.close(); }
});

test('a committed external version is not accepted over a pending link form', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const context = await browser.newContext();
  try {
    const page = await openRichComposer(context, bundle), other = await openRichComposer(context, bundle);
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), formLinkDocument), true);
    const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    await editLinkAddress(page);
    const after = await other.evaluate(before => (window as any).fixture.commitVersion(before,
      { ...before.draft, text: '', document: undefined }), before);
    assert.equal(await page.evaluate(({ before, after }) => (window as any).fixture.state.controller.acceptCommittedVersion(before, after), { before, after }), false);
    const dialog = page.getByRole('dialog', { name: '链接' });
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
    await dialog.getByRole('button', { name: '关闭' }).click();
    await page.locator('.ProseMirror').waitFor({ state: 'detached' });
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().revision === 'external-after');
    assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), '');
  } finally { await context.close(); await browser.close(); }
});

test('a link form opened during committed-version verification prevents late adoption', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const context = await browser.newContext();
  try {
    const page = await openRichComposer(context, bundle), other = await openRichComposer(context, bundle);
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), formLinkDocument), true);
    const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    await editLinkAddress(page);
    const after = await other.evaluate(before => (window as any).fixture.commitVersion(before,
      { ...before.draft, text: '', document: undefined }), before);
    await other.evaluate(() => (window as any).fixture.hold());
    const dialog = page.getByRole('dialog', { name: '链接' });
    await dialog.getByRole('button', { name: '关闭' }).click();
    await page.evaluate(({ before, after }) => {
      const f = (window as any).fixture; f.done = false;
      f.accept = f.state.controller.acceptCommittedVersion(before, after).then((result: boolean) => { f.done = true; return result; });
    }, { before, after });
    assert.equal(await page.evaluate(() => (window as any).fixture.done), false);
    await editLinkAddress(page);
    await other.evaluate(() => (window as any).fixture.release());
    assert.equal(await page.evaluate(() => (window as any).fixture.accept), false);
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
    await dialog.getByRole('button', { name: '保存链接地址' }).click();
    await page.waitForFunction(() => document.querySelector('.ProseMirror a')?.getAttribute('href') === 'https://example.test/pending');
    assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
    const versions = await page.evaluate(async () => {
      const f = (window as any).fixture; return (await f.readComposerDraftVersions(f.state.controller.snapshot().owner)).versions;
    });
    assert.ok(versions.some((value: any) => value.revision === 'external-after' && value.draft.text === ''));
    assert.ok(versions.some((value: any) => value.draft.text === '[Original](https://example.test/pending)'));
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => document.querySelector('.ProseMirror a')?.getAttribute('href') === 'https://example.test/pending');
    await page.getByText('选择草稿版本').click();
    assert.equal(await page.getByRole('button', { name: '包含附件或保留数据的草稿' }).count(), 1);
  } finally { await context.close(); await browser.close(); }
});

test('closing a link form after delayed acceptance rechecks the committed version', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--process-per-tab'] });
  const context = await browser.newContext();
  try {
    const page = await openRichComposer(context, bundle), other = await openRichComposer(context, bundle);
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), formLinkDocument), true);
    const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    await editLinkAddress(page);
    const after = await other.evaluate(before => (window as any).fixture.commitVersion(before,
      { ...before.draft, text: '', document: undefined }), before);
    await other.evaluate(() => (window as any).fixture.hold());
    const dialog = page.getByRole('dialog', { name: '链接' });
    await dialog.getByRole('button', { name: '关闭' }).click();
    await page.evaluate(({ before, after }) => {
      const f = (window as any).fixture; f.done = false;
      f.accept = f.state.controller.acceptCommittedVersion(before, after).then((result: boolean) => { f.done = true; return result; });
    }, { before, after });
    assert.equal(await page.evaluate(() => (window as any).fixture.done), false);
    await editLinkAddress(page);
    await other.evaluate(() => (window as any).fixture.release());
    assert.equal(await page.evaluate(() => (window as any).fixture.accept), false);
    assert.equal(await dialog.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/pending');
    await dialog.getByRole('button', { name: '关闭' }).click();
    await page.locator('.ProseMirror').waitFor({ state: 'detached' });
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().revision === 'external-after');
    assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), '');
  } finally { await context.close(); await browser.close(); }
});

test('confirmed cleanup errors retain their confirmed meaning', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await composerBundle();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await openRichComposer(context, bundle);
    assert.equal(await page.evaluate(value => (window as any).fixture.setDocument(value), formLinkDocument), true);
    await page.evaluate(() => { (window as any).fixture.state.submitError = '发送已确认，但原草稿清理尚未完成：fixture quota'; });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: '发送已确认，但原草稿清理尚未完成：fixture quota' });
    await alert.waitFor(); assert.doesNotMatch(await alert.innerText(), /发送未确认/);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 1);
    assert.equal(await page.locator('.ProseMirror').textContent(), 'Original');
    const versions = await page.evaluate(async () => {
      const f = (window as any).fixture; return f.readComposerDraftVersions(f.state.controller.snapshot().owner);
    });
    assert.ok(versions.versions.some((value: any) => value.draft.document));
    assert.ok(versions.retained.some((value: any) => value.draft.document));
  } finally { await context.close(); await browser.close(); }
});
