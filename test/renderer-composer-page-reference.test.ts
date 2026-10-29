import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { ComposerDocument } from '../src/renderer/workbench-contract.ts';
import { draftToInput, normalizeDraft, recoverLegacyDraft } from '../src/renderer/composer/standalone-draft.ts';
import { readRichDocument, serializePlainDocument, serializeRichDocument } from '../src/renderer/composer/rich-document.ts';

const pageMention: ComposerDocument = { type: 'pageReferenceMention', attrs: {
  path: 'page://planning#section', projectId: 'project-fixture', spaceId: 'space-fixture', title: 'Planning',
} };
const loadingLink: ComposerDocument = { type: 'richLink', attrs: {
  displayText: 'Original link', href: 'https://chatgpt.com/space/planning', sourceAppId: 'page-fixture',
  isLoading: true, loadingDisplayText: 'Linked Page', literalMarkdownSource: null,
  literalMarkdownOccurrenceId: null, markdownSourceStart: null, markdownSourceEnd: null,
} };
const document: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'See ' }, pageMention, { type: 'text', text: ' and ', marks: [{ type: 'strong' }] }, loadingLink,
] }] };

function reviewedAppDraft() {
  const text = '\n# MCP app context:\n\n## App fixture\nReviewed text\n\n## My request:\nUser request\n';
  const envelope = { version: 1, promptContextWithoutReviewedMessages: '', reviewedMessageAttachments: [
    { kind: 'message', untrusted: false, id: 'reviewed-1', sourceName: 'App fixture', text: 'Reviewed text', imageAttachments: [] },
  ] };
  return normalizeDraft({ text, images: [], files: [], input: [
    { type: 'text', text, text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(text).length },
      placeholder: 'codex-untrusted-app-input:' + JSON.stringify(envelope) }] },
    { type: 'mention', name: 'fixture', path: '/workspace/fixture' },
  ] });
}

test('original Page atoms preserve metadata and project the original title and path', () => {
  const parsed = readRichDocument(document);
  assert.ok(parsed);
  assert.deepEqual({ ...parsed.toJSON().content[0].content[1].attrs }, pageMention.attrs);
  assert.equal(serializePlainDocument(parsed), 'See [Planning](page://planning#section) and [Original link](https://chatgpt.com/space/planning)');
  const rich = serializeRichDocument(parsed);
  const draft = { text: rich, document, images: [], files: [] };
  assert.equal(draftToInput(draft, 'local', { plainTextMode: false })[0]?.text, rich);
  assert.equal(draftToInput(draft, 'local', { plainTextMode: true })[0]?.text, serializePlainDocument(parsed));
  for (const path of ['page://planning#section', 'space://workspace', 'https://chatgpt.com/codex/app/space/planning#section']) {
    assert.ok(readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
      { ...pageMention, attrs: { ...pageMention.attrs, path } },
    ] }] }));
  }
  for (const path of ['javascript:alert(1)', 'page://bad id', 'space://workspace#section',
    'https://elsewhere.test/space/planning', 'https://chatgpt.com/space/planning?thread=other']) {
    assert.equal(readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
      { ...pageMention, attrs: { ...pageMention.attrs, path } },
    ] }] }), null);
  }
  const future = structuredClone(document);
  future.content![0]!.content![1]!.attrs!.future = { keep: true };
  assert.equal(readRichDocument(future), null);
  const retained = { document, plainTextMode: false };
  const previouslyBlocked = { ...normalizeDraft({ text: '', images: [], files: [], document }),
    blocked: '此草稿包含尚不支持的文档内容，已保留原始数据。',
    preserved: { retainedKey: 'legacy-page', retained } };
  const restored = recoverLegacyDraft(previouslyBlocked);
  assert.ok(restored);
  assert.equal(restored.text, rich);
  assert.deepEqual(restored.preserved, previouslyBlocked.preserved);
});

test('unrecognized multiline source is retained instead of being rewritten as a different link', () => {
  const source: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'a b', marks: [{ type: 'link', attrs: {
      href: 'https://example.test/', literalMarkdownSource: '[a\nb](https://example.test/)', literalMarkdownOccurrenceId: 1,
    } }] },
  ] }] };
  const draft = { text: '[a\nb](https://example.test/)', document: source, images: [], files: [] };
  const before = structuredClone(draft);
  assert.equal(readRichDocument(source), null);
  assert.throws(() => draftToInput(draft, 'local'), /无损对应/);
  assert.deepEqual(draft, before);
});

test('reviewed text app context sends its original ordered input only when the visible context is complete', () => {
  const draft = reviewedAppDraft(), before = structuredClone(draft);
  assert.deepEqual(draftToInput(draft, 'local'), draft.input);
  assert.deepEqual(draft, before);
  const item = draft.input![0]!, element = (item.text_elements as Record<string, unknown>[])[0]!;
  const prefix = 'codex-untrusted-app-input:';
  const envelope = JSON.parse(String(element.placeholder).slice(prefix.length));
  for (const changes of [
    { untrusted: true }, { imageAttachments: [{ src: 'data:image/png;base64,YQ==' }] },
    { structuredContent: { keep: true } }, { future: 'keep' }, { text: 'missing from prompt' },
  ]) {
    const invalid = structuredClone(draft);
    const target = (invalid.input![0]!.text_elements as Record<string, unknown>[])[0]!;
    target.placeholder = prefix + JSON.stringify({ ...envelope, reviewedMessageAttachments: [
      { ...envelope.reviewedMessageAttachments[0], ...changes },
    ] });
    const retained = structuredClone(invalid);
    assert.throws(() => draftToInput(invalid, 'local'), /完整上下文/);
    assert.deepEqual(invalid, retained);
  }
});

test('legacy Page and interrupted lookup survive the actual composer, clipboard, undo, refresh and send', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    const state={controller:null,submissions:[],lease:null};
    const client={async rpc(method){if(method==='model/list'||method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?false:
        params.key==='composerEnterBehavior'?'cmdAlways':'queue'};throw Error('unexpected host '+method)},
      subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    createRoot(document.getElementById('root')).render(React.createElement(StandaloneComposer,{client,
      context:{hostId:'local',threadId:null,draftId:'legacy-page',cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},
      async onSubmit(draft,options,action,description){state.submissions.push({draft:structuredClone(draft),
        input:draftToInput(draft,'local',{plainTextMode:description.documentPlainTextMode}),description})},async onInterrupt(){}}));
    window.fixture=state;
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const prompt = serializeRichDocument(readRichDocument(document)!);
  const atoms = { 'composer-retained-documents-v1': { 'legacy-page': { document, plainTextMode: false, prompt } } };
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await context.newPage(), errors: string[] = [];
    page.setDefaultTimeout(8_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/');
    await page.evaluate(value => localStorage.setItem('native-atoms', JSON.stringify(value)), atoms);
    const mount = () => page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await mount();
    const editor = page.locator('.ProseMirror'); await editor.waitFor();
    const mention = editor.locator('[data-mention="page-reference"]');
    assert.equal(await mention.innerText(), 'Planning');
    assert.equal(await mention.locator('svg').count(), 1);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.controller.snapshot().draft.document.content[0].content[1].attrs), pageMention.attrs);

    const loading = editor.locator('[data-mention="rich-link"]');
    assert.equal(await loading.innerText(), 'Linked Page');
    assert.equal(await loading.locator('svg').count(), 1);
    await loading.click();
    const dialog = page.getByRole('dialog', { name: '链接' });
    assert.match(await dialog.innerText(), /page-fixture/);
    assert.match(await dialog.innerText(), /原链接已保留/);
    assert.equal(await page.evaluate(() => {
      const state = (window as any).fixture, owner = state.controller.snapshot().owner;
      state.lease = state.controller.freeze(owner); return !!state.lease;
    }), true);
    const recover = dialog.getByRole('button', { name: '使用已保存的链接' });
    assert.equal(await recover.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return globalThis.document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) !== element;
    }), true);
    await recover.evaluate((element: HTMLButtonElement) => element.click());
    assert.equal(await page.evaluate(() => (window as any).fixture.controller.snapshot().draft.document.content[0].content[3].attrs.isLoading), true);
    await page.evaluate(() => { (window as any).fixture.lease.release(); });
    await recover.click();
    await page.waitForFunction(() => !(window as any).fixture.controller.snapshot().draft.document.content[0].content[3].attrs.isLoading);
    assert.equal(await loading.innerText(), 'Original link');
    await editor.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.document.content[0].content[3].attrs.isLoading);
    await editor.press('Control+Shift+z');
    await page.waitForFunction(() => !(window as any).fixture.controller.snapshot().draft.document.content[0].content[3].attrs.isLoading);

    await editor.focus(); await editor.press('Control+End');
    await editor.evaluate(element => {
      const copy = element.querySelector('[data-mention="page-reference"]')!.cloneNode(true) as HTMLElement;
      const data = new DataTransfer(); data.setData('text/html', copy.outerHTML); data.setData('text/plain', 'Planning');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="page-reference"]').length === 2);
    await editor.press('Control+z');
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="page-reference"]').length === 1);
    await editor.press('Control+a'); await editor.press('Control+c'); await editor.press('Control+End'); await editor.press('Control+v');
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="page-reference"]').length === 2);
    await editor.press('Control+z');
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="page-reference"]').length === 1);
    await editor.press('Control+End');
    await editor.evaluate(element => {
      const copy = '<span page-reference-mention-path="page://planning#section" page-reference-mention-project-id="project-fixture" '
        + 'page-reference-mention-space-id="space-fixture" page-reference-mention-title="Planning">'
        + '<span><svg viewBox="0 0 24 24"><g><path d="M1 1h8v8H1z"></path></g></svg></span><span>Planning</span></span>';
      const data = new DataTransfer(); data.setData('text/html', copy); data.setData('text/plain', 'Planning');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="page-reference"]').length === 2);
    await editor.press('Control+z');
    await page.waitForFunction(() => window.document.querySelectorAll('[data-mention="page-reference"]').length === 1);
    await editor.evaluate(element => {
      const copy = '<span page-reference-mention-path="page://planning" page-reference-mention-title="Unsafe">'
        + '<svg><path d="M1 1" onload="window.pasteExecuted=true"></path></svg>Unsafe</span>';
      const data = new DataTransfer(); data.setData('text/html', copy); data.setData('text/plain', 'Unsafe');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.getByRole('alert').waitFor();
    assert.equal(await editor.locator('[data-mention="page-reference"]').count(), 1);
    assert.equal(await page.evaluate(() => (window as any).pasteExecuted), undefined);
    await editor.press('Control+End'); await page.keyboard.type('!');
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.text.endsWith('!'));
    assert.equal(await page.evaluate(() => (window as any).fixture.controller.flush((window as any).fixture.controller.snapshot().owner)), true);
    await page.reload(); await mount(); await editor.waitFor();
    assert.equal(await editor.locator('[data-mention="page-reference"]').innerText(), 'Planning');
    const saved = await page.evaluate(() => (window as any).fixture.controller.snapshot().draft);
    assert.deepEqual(saved.document.content[0].content[1].attrs, pageMention.attrs);
    assert.equal(saved.document.content[0].content[3].attrs.isLoading, false);
    assert.equal(saved.document.content[0].content[3].attrs.sourceAppId, 'page-fixture');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.submissions.length === 1);
    const sent = await page.evaluate(() => (window as any).fixture.submissions[0]);
    assert.equal(sent.input[0].text, saved.text);
    assert.deepEqual(sent.draft.document.content[0].content[1].attrs, pageMention.attrs);
    assert.equal(sent.description.documentPlainTextMode, false);
    assert.deepEqual(errors, []);
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.text === '');
    const reviewed = reviewedAppDraft();
    assert.equal(await page.evaluate(async value => {
      const controller = (window as any).fixture.controller;
      return controller.update(controller.snapshot().owner, () => value);
    }, reviewed), true);
    await page.waitForFunction(() => (window as any).fixture.controller.snapshot().draft.input?.length === 2);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.submissions.length === 2);
    const appInput = await page.evaluate(() => (window as any).fixture.submissions[1].input);
    assert.deepEqual(appInput, reviewed.input);
    const blockedContext = await browser.newContext();
    try {
      const blockedPage = await blockedContext.newPage();
      await blockedPage.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
        ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
      await blockedPage.goto('http://localhost/');
      const unknown = structuredClone(document);
      unknown.content![0]!.content![3]!.attrs!.literalMarkdownSource = '[Original\nlink](https://chatgpt.com/space/planning)';
      await blockedPage.evaluate(value => localStorage.setItem('native-atoms', JSON.stringify(value)), {
        'composer-retained-documents-v1': { 'legacy-page': { document: unknown, plainTextMode: false } },
      });
      await blockedPage.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const details = blockedPage.locator('.standalone-composer__retained details');
      await details.waitFor();
      await blockedPage.waitForFunction(() => (window as any).fixture.controller?.snapshot().draft.blocked);
      assert.equal(await details.evaluate(element => (element as HTMLDetailsElement).open), true);
      assert.match(await details.locator('pre').innerText(), /Original\\nlink/);
      await blockedPage.getByRole('button', { name: '发送', exact: true }).click();
      assert.match(await blockedPage.getByRole('alert').innerText(), /无法无损发送/);
      assert.equal(await blockedPage.evaluate(() => (window as any).fixture.submissions.length), 0);
      assert.deepEqual(await blockedPage.evaluate(() => (window as any).fixture.controller.snapshot().draft.document), unknown);
    } finally { await blockedContext.close(); }
  } finally { await context.close(); await browser.close(); }
});
