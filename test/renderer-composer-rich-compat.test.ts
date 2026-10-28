import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { ComposerDocument } from '../src/renderer/workbench-contract.ts';
import { canEditStructuredDraft, draftToInput, editStructuredDraftText, normalizeDraft, removeStructuredImage, removeStructuredSkill } from '../src/renderer/composer/standalone-draft.ts';
import { readRichDocument, serializePlainDocument, serializeRichDocument } from '../src/renderer/composer/rich-document.ts';

const richLink: ComposerDocument = { type: 'richLink', attrs: {
  displayText: 'Documentation', href: 'https://example.test/docs', sourceAppId: 'fixture',
  isLoading: false, loadingDisplayText: null, literalMarkdownSource: null,
  literalMarkdownOccurrenceId: null, markdownSourceStart: null, markdownSourceEnd: null,
} };
const document: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'See ' }, richLink, { type: 'text', text: ' now', marks: [{ type: 'strong' }] },
] }] };

test('original rich link subset retains its attributes and has matching plain and Markdown projections', () => {
  const parsed = readRichDocument(document);
  assert.ok(parsed);
  assert.equal(serializePlainDocument(parsed), 'See [Documentation](https://example.test/docs) now');
  assert.equal(serializeRichDocument(parsed), 'See [Documentation](https://example.test/docs) **now**');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.toJSON().content[0].content[1].attrs)), richLink.attrs);
  const draft = { text: serializeRichDocument(parsed), document, images: [], files: [] };
  assert.equal(draftToInput(draft, 'local', { plainTextMode: true })[0]?.text, 'See [Documentation](https://example.test/docs) now');
  assert.equal(draftToInput(draft, 'local', { plainTextMode: false })[0]?.text, 'See [Documentation](https://example.test/docs) **now**');
  for (const extra of [{ literalMarkdownSource: '[Different](https://example.test/docs)' },
    { literalMarkdownSource: '[Documentation](https://example.test/docs "title")' },
    { literalMarkdownOccurrenceId: -1 }, { markdownSourceStart: 2, markdownSourceEnd: 1 }, { future: 'keep' }]) {
    const unknown: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { ...richLink, attrs: { ...richLink.attrs, ...extra } },
    ] }] };
    assert.equal(readRichDocument(unknown), null);
  }
});

test('rich links retain verified literal source and occurrence positions for each node', () => {
  const first = { ...richLink, attrs: { ...richLink.attrs,
    literalMarkdownSource: '[Documentation](<https://example.test/docs>)', literalMarkdownOccurrenceId: 2,
    markdownSourceStart: 4, markdownSourceEnd: 48 } };
  const second = { ...richLink, attrs: { ...richLink.attrs,
    literalMarkdownSource: '[Documentation](https://example.test/docs)', literalMarkdownOccurrenceId: 3,
    markdownSourceStart: 49, markdownSourceEnd: 91, isLoading: true, loadingDisplayText: 'Loading link' } };
  const source: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'See ' }, first, { type: 'text', text: ' and ' }, second,
  ] }] };
  const parsed = readRichDocument(source);
  assert.ok(parsed);
  assert.equal(serializeRichDocument(parsed), 'See [Documentation](<https://example.test/docs>) and [Documentation](https://example.test/docs)');
  assert.equal(serializePlainDocument(parsed), 'See [Documentation](https://example.test/docs) and [Documentation](https://example.test/docs)');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.toJSON().content[0].content[1].attrs)), first.attrs);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.toJSON().content[0].content[3].attrs)), second.attrs);
  const draft = { text: serializeRichDocument(parsed), document: source, images: [], files: [] };
  assert.equal(draftToInput(draft, 'local', { plainTextMode: false })[0]?.text, draft.text);
  assert.equal(draftToInput(draft, 'local', { plainTextMode: true })[0]?.text, serializePlainDocument(parsed));
});

function structuredDraft() {
  return normalizeDraft({ text: '前😀@file tail\nSecond', images: [{ id: 'i', src: '', fileId: 'file-1' }], files: [],
    references: [{ id: 'r', text: 'selected context', context: { selector: '#fixture' }, original: { keep: true } }],
    input: [{ type: 'text', text: '前😀@file tail', text_elements: [{ byteRange: { start: 7, end: 12 }, placeholder: '@file' }] },
      { type: 'image', fileId: 'file-1', detail: 'high' }, { type: 'mention', name: 'file', path: '/fixture/a' },
      { type: 'text', text: 'Second', text_elements: [] }] });
}

test('structured text edits preserve ordered inputs and adjust only proven UTF-8 ranges', () => {
  const draft = structuredDraft(), original = structuredClone(draft);
  assert.equal(canEditStructuredDraft(draft), true);
  const first = editStructuredDraftText(draft, 0, '前😀@file tail', '中前😀@file tail');
  assert.ok(first.draft, first.error ?? 'edit failed');
  assert.deepEqual(first.draft.input?.[0]?.text_elements, [{ byteRange: { start: 10, end: 15 }, placeholder: '@file' }]);
  const second = editStructuredDraftText(first.draft, 3, 'Second', 'Second edited');
  assert.ok(second.draft, second.error ?? 'edit failed');
  assert.deepEqual(draftToInput(second.draft, 'local'), [...second.draft.input!,
    { type: 'text', text: 'selected context', text_elements: [] }]);
  assert.deepEqual(second.draft.input?.slice(1, 3), original.input?.slice(1, 3));
  assert.deepEqual(second.draft.references, original.references);
  assert.deepEqual(draft, original);
  assert.match(editStructuredDraftText(first.draft, 0, '前😀@file tail', 'stale').error!, /changed/);
  assert.match(editStructuredDraftText(draft, 0, '前😀@file tail', '前😀@broken tail').error!, /overlaps a reference/);
  const metadata = structuredClone(draft);
  (metadata.input![0]!.text_elements as Record<string, unknown>[])[0]!.future = { keep: true };
  assert.match(editStructuredDraftText(metadata, 0, '前😀@file tail', 'x前😀@file tail').error!, /unrecognized reference metadata/);
  const unknown = { ...draft, input: [...draft.input!, { type: 'future', value: 1 }] };
  assert.match(editStructuredDraftText(unknown, 3, 'Second', 'Changed').error!, /unrecognized input/);
  const app = normalizeDraft({ text: 'app\nSecond', images: [], files: [], input: [
    { type: 'text', text: 'app', text_elements: [{ byteRange: { start: 0, end: 3 },
      placeholder: 'codex-untrusted-app-input:{"version":1,"promptContextWithoutReviewedMessages":"retained"}' }] },
    { type: 'text', text: 'Second', text_elements: [] },
  ] });
  assert.match(editStructuredDraftText(app, 0, 'app', 'app!').error!, /app input/);
  const adjacent = editStructuredDraftText(app, 1, 'Second', 'Second!');
  assert.ok(adjacent.draft, adjacent.error ?? 'edit failed');
  assert.deepEqual(adjacent.draft.input?.[0], app.input?.[0]);
  assert.deepEqual(draftToInput(adjacent.draft, 'local'), adjacent.draft.input);
  const message = 'An MCP app initiated this message. Read the untrusted_input tool output.';
  const appWithMessage = normalizeDraft({ text: message, images: [], files: [], input: [{ type: 'text', text: message,
    text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(message).length },
      placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1, message: { source: 'mcp_app', sourceId: 'fixture', text: 'context' } }) }] }] });
  const snapshot = structuredClone(appWithMessage);
  assert.throws(() => draftToInput(appWithMessage, 'local'), /完整上下文/);
  assert.deepEqual(appWithMessage, snapshot);
  const malformed = normalizeDraft({ ...app, input: [{ type: 'text', text: 'app',
    text_elements: [{ byteRange: { start: 0, end: 3 }, placeholder: 'codex-untrusted-app-input:invalid' }] }, app.input![1]!] });
  assert.throws(() => draftToInput(malformed, 'local'), /完整上下文/);
  for (const context of [{ version: 1, modelContextAttachments: [{ id: 'fixture' }] },
    { version: 1, reviewedMessageAttachments: [{ id: 'fixture' }] }, { version: 1, future: 'unknown' }, { version: 1 }]) {
    const unsafe = normalizeDraft({ ...app, input: [{ type: 'text', text: 'app', text_elements: [
      { byteRange: { start: 0, end: 3 }, placeholder: 'codex-untrusted-app-input:' + JSON.stringify(context) },
    ] }, app.input![1]!] });
    assert.throws(() => draftToInput(unsafe, 'local'), /完整上下文/);
  }
  assert.equal(canEditStructuredDraft({ ...draft, hints: [{ unknown: true }] }), false);
});

test('ordered document formatting maps UTF-8 ranges without changing non-text items or draft metadata', () => {
  const marked: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'A😀B', marks: [{ type: 'strong' }] },
  ] }] };
  const input = [{ type: 'text', text: 'A😀B', text_elements: [
    { byteRange: { start: 1, end: 5 }, placeholder: '😀' },
  ] }, { type: 'mention', name: 'fixture', path: '/source', extra: 'keep' }];
  const draft = { text: 'A😀B', document: marked, input, images: [], files: [] };
  const original = structuredClone(draft);
  assert.deepEqual(draftToInput(draft, 'local', { plainTextMode: false }), [
    { type: 'text', text: '**A😀B**', text_elements: [{ byteRange: { start: 3, end: 7 }, placeholder: '😀' }] }, input[1],
  ]);
  assert.deepEqual(draftToInput(draft, 'local', { plainTextMode: true }), input);
  const richDraft = { ...draft, text: '**A😀B**', input: [
    { type: 'text', text: '**A😀B**', text_elements: [{ byteRange: { start: 3, end: 7 }, placeholder: '😀' }] }, input[1]!,
  ] };
  assert.deepEqual(draftToInput(richDraft, 'local', { plainTextMode: true }), input);
  assert.deepEqual(draft, original);
  const ambiguous: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: '*', marks: [{ type: 'strong' }] },
  ] }] };
  const unsafe = { text: '*', document: ambiguous, input: [{ type: 'text', text: '*', text_elements: [
    { byteRange: { start: 0, end: 1 }, placeholder: '*' },
  ] }], images: [], files: [] };
  assert.throws(() => draftToInput(unsafe, 'local', { plainTextMode: false }), /引用位置不唯一/);
  assert.equal(unsafe.input[0]!.text, '*');
  const extended = structuredClone(draft);
  (extended.input[0]!.text_elements![0] as Record<string, unknown>).future = { offset: 1 };
  assert.throws(() => draftToInput(extended, 'local', { plainTextMode: false }), /未识别的引用信息/);
  assert.deepEqual(draftToInput(extended, 'local', { plainTextMode: true }), extended.input);
  const protectedApp = { text: 'app', document: { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'app', marks: [{ type: 'strong' }] },
  ] }] }, images: [], files: [], input: [{ type: 'text', text: 'app', text_elements: [{ byteRange: { start: 0, end: 3 },
    placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1, promptContextWithoutReviewedMessages: 'context' }) }] }] };
  assert.throws(() => draftToInput(protectedApp, 'local', { plainTextMode: false }), /无法安全转换/);
  assert.deepEqual(draftToInput(protectedApp, 'local', { plainTextMode: true }), protectedApp.input);
});

test('removing ordered attachments remaps message image identities without deleting a new matching upload', () => {
  const draft = normalizeDraft({ text: 'text', files: [],
    images: [{ id: 'image-1', src: 'https://example.test/same.png' }, { id: 'image-3', src: '', fileId: 'second' },
      { id: 'new-upload', src: 'https://example.test/same.png' }], skills: [{ name: 'review', path: '/review' }],
    input: [{ type: 'text', text: 'text', text_elements: [] }, { type: 'image', url: 'https://example.test/same.png', detail: 'high' },
      { type: 'skill', name: 'review', path: '/review', source: 'retained' }, { type: 'image', fileId: 'second', detail: 'low' }] });
  const removeUpload = removeStructuredImage(draft, 'new-upload');
  assert.ok(removeUpload.draft);
  assert.deepEqual(removeUpload.draft.input, draft.input);
  const first = removeStructuredImage(removeUpload.draft, 'image-1');
  assert.ok(first.draft);
  assert.deepEqual(first.draft.images.map(image => image.id), ['image-2']);
  assert.deepEqual(first.draft.input, [draft.input![0], draft.input![2], draft.input![3]]);
  const skill = removeStructuredSkill(first.draft, 'review', '/review');
  assert.ok(skill.draft);
  assert.deepEqual(skill.draft.images.map(image => image.id), ['image-1']);
  assert.deepEqual(skill.draft.input, [draft.input![0], draft.input![3]]);
  const second = removeStructuredImage(skill.draft, 'image-1');
  assert.ok(second.draft);
  assert.deepEqual(second.draft.input, [draft.input![0]]);
  assert.match(removeStructuredImage({ ...draft, images: [{ ...draft.images[0]!, fileId: 'wrong', src: '' }] }, 'image-1').error!, /no longer matches/);
});

test('retained rich link is editable and survives draft refresh and submission in the real composer', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    const state={controller:null,submissions:[]};
    const client={async rpc(method){if(method==='model/list'||method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?false:
        params.key==='composerEnterBehavior'?'cmdAlways':'queue'};throw Error('unexpected host '+method)},
      subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    createRoot(document.getElementById('root')).render(React.createElement(StandaloneComposer,{client,
      context:{hostId:'local',threadId:null,draftId:'legacy-rich-link',cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},
      async onSubmit(draft,options,action,description){state.submissions.push({draft:structuredClone(draft),description:structuredClone(description),
        input:draftToInput(draft,'local',{plainTextMode:description.documentPlainTextMode})})},async onInterrupt(){}}));
    window.fixture=state;
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const parsed = readRichDocument(document)!;
  const atoms = { 'composer-retained-documents-v1': { 'legacy-rich-link': { document, plainTextMode: false, prompt: serializeRichDocument(parsed) } } };
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://rich-link-fixture.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://rich-link-fixture.test/');
    await page.evaluate(value => localStorage.setItem('native-atoms', JSON.stringify(value)), atoms);
    const mount = () => page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await mount();
    const editor = page.locator('.ProseMirror');
    await editor.waitFor();
    assert.equal(await editor.locator('[data-mention="rich-link"]').innerText(), 'Documentation');
    assert.equal(await editor.locator('strong').innerText(), ' now');
    await editor.click(); await editor.press('Control+End');
    await editor.evaluate(element => {
      const original = element.querySelector('[data-mention="rich-link"]')!;
      const copy = original.cloneNode(true) as HTMLElement;
      const data = new DataTransfer(); data.setData('text/html', copy.outerHTML); data.setData('text/plain', 'Documentation');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="rich-link"]').length === 2);
    await editor.press('Control+z');
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="rich-link"]').length === 1);
    await editor.evaluate(element => {
      const copy = element.querySelector('[data-mention="rich-link"]')!.cloneNode(true) as HTMLElement;
      const attrs = JSON.parse(copy.getAttribute('data-composer-attrs')!); attrs.literalMarkdownSource = '[changed](https://example.test)';
      copy.setAttribute('data-composer-attrs', JSON.stringify(attrs));
      const data = new DataTransfer(); data.setData('text/html', copy.outerHTML); data.setData('text/plain', 'changed');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.getByRole('alert').waitFor();
    assert.equal(await editor.locator('[data-mention="rich-link"]').count(), 1);
    await page.keyboard.type('!');
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.text.endsWith('**now!**'));
    assert.equal(await page.evaluate(() => (window as any).fixture.controller.flush((window as any).fixture.controller.snapshot().owner)), true);
    await page.reload(); await mount(); await editor.waitFor();
    assert.equal(await editor.locator('[data-mention="rich-link"]').innerText(), 'Documentation');
    const saved = await page.evaluate(() => (window as any).fixture.controller.snapshot().draft);
    assert.deepEqual(saved.document.content[0].content[1].attrs, richLink.attrs);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.submissions.length === 1);
    const submitted = await page.evaluate(() => (window as any).fixture.submissions[0]);
    assert.equal(submitted.description.documentPlainTextMode, false);
    assert.equal(submitted.input[0].text, 'See [Documentation](https://example.test/docs) **now!**');
    assert.deepEqual(submitted.draft.document.content[0].content[1].attrs, richLink.attrs);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('segmented editor uses the original draft controller for editing, undo, refresh and submission', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneStructuredInputEditor } from './src/renderer/composer/StandaloneRichEditor.tsx';
    import { canEditStructuredDraft, editStructuredDraftText, draftToInput } from './src/renderer/composer/standalone-draft.ts';
    import { useComposerDraft } from './src/renderer/composer/use-composer-draft.ts';
    const state={controller:null,editor:null,error:'',composition:[],keys:[],submitted:null};
    const context={hostId:'local',threadId:'thread',draftId:'segments',cwd:'/fixture'};
    function Fixture(){
      const {stored,current,loaded,controller,changeDraft}=useComposerDraft(context,value=>{state.controller=value});
      const draft=stored.draft;
      const edit=(index,expected,text)=>{
        const before=current.current.draft,result=editStructuredDraftText(before,index,expected,text);
        if(result.error){state.error=result.error;return}
        state.error='';void changeDraft(value=>value===before?result.draft:value);
      };
      return React.createElement('div',{className:'standalone-composer'},
        React.createElement('div',{className:'standalone-composer__editor'},loaded&&canEditStructuredDraft(draft)
          ?React.createElement(StandaloneStructuredInputEditor,{draft,onEdit:edit,ref(value){state.editor=value},
            onCompositionChange(value){state.composition.push(value)},onKeyDown(event){state.keys.push(event.key);return false}}):null),
        React.createElement('button',{onClick:async()=>{const snapshot=controller.snapshot();
          if(await controller.flush(snapshot.owner)){const value=controller.snapshot();state.submitted={draft:value.draft,input:draftToInput(value.draft,'local')}}}},'Submit'));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
    window.fixture=state;
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://segment-fixture.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://segment-fixture.test/');
    const mount = () => page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await mount();
    await page.waitForFunction(() => (window as any).fixture.controller?.snapshot());
    assert.equal(await page.evaluate(async draft => {
      const controller = (window as any).fixture.controller, snapshot = controller.snapshot();
      return controller.update(snapshot.owner, () => draft);
    }, structuredDraft()), true);
    const first = page.getByRole('textbox', { name: '和 Codex 一起工作 1' });
    const second = page.getByRole('textbox', { name: '和 Codex 一起工作 2' });
    await first.waitFor(); await first.focus(); await first.press('Home'); await page.keyboard.type('中');
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.text.startsWith('中前'));
    let saved = await page.evaluate(() => (window as any).fixture.controller.snapshot().draft);
    assert.deepEqual(saved.input[0].text_elements[0].byteRange, { start: 10, end: 15 });
    await first.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.text.startsWith('前😀'));
    saved = await page.evaluate(() => (window as any).fixture.controller.snapshot().draft);
    assert.deepEqual(saved.input[0].text_elements[0].byteRange, { start: 7, end: 12 });
    await second.fill('Second edited');
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.text.endsWith('Second edited'));
    await first.fill('前😀@broken tail');
    assert.match(await page.evaluate(() => (window as any).fixture.error), /overlaps a reference/);
    assert.equal(await first.inputValue(), '前😀@file tail');
    await first.evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    await page.waitForFunction(() => (window as any).fixture.composition.includes(false));
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.composition), [true, false]);
    assert.equal(await page.evaluate(() => (window as any).fixture.keys.includes('Enter')), false);
    assert.equal(await page.evaluate(() => (window as any).fixture.controller.flush((window as any).fixture.controller.snapshot().owner)), true);
    await page.reload(); await mount(); await second.waitFor();
    assert.equal(await first.inputValue(), '前😀@file tail');
    assert.equal(await second.inputValue(), 'Second edited');
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForFunction(() => (window as any).fixture.submitted !== null);
    const result = await page.evaluate(() => (window as any).fixture.submitted);
    assert.deepEqual(result.input.slice(0, 4), result.draft.input);
    assert.deepEqual(result.input[1], { type: 'image', fileId: 'file-1', detail: 'high' });
    assert.deepEqual(result.input[2], { type: 'mention', name: 'file', path: '/fixture/a' });
    assert.deepEqual(result.input[4], { type: 'text', text: 'selected context', text_elements: [] });
    assert.deepEqual(result.draft.references[0].original, { keep: true });
    const app = normalizeDraft({ text: 'app', images: [], files: [], input: [{ type: 'text', text: 'app',
      text_elements: [{ byteRange: { start: 0, end: 3 },
        placeholder: 'codex-untrusted-app-input:{"version":1,"promptContextWithoutReviewedMessages":"retained"}' }] }] });
    assert.equal(await page.evaluate(async draft => {
      const controller = (window as any).fixture.controller, snapshot = controller.snapshot();
      return controller.update(snapshot.owner, () => draft);
    }, app), true);
    const protectedInput = page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true });
    await protectedInput.waitFor();
    assert.equal(await protectedInput.isEditable(), false);
    assert.equal(await protectedInput.inputValue(), 'app');
    await page.getByRole('status').filter({ hasText: '此应用输入包含保留的上下文' }).waitFor();
    await page.evaluate(() => (window as any).fixture.editor.focus());
    assert.equal(await protectedInput.evaluate(element => window.document.activeElement === element), true);
    await protectedInput.selectText();
    assert.equal(await protectedInput.evaluate(element => (element as HTMLTextAreaElement).selectionEnd), 3);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
