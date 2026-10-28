import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { defaultMarkdownParser } from 'prosemirror-markdown';
import type { ComposerContext, ComposerDocument } from '../src/renderer/workbench-contract.ts';
import { documentFromText, draftToInput, legacyDraftCandidates, recoverLegacyDraft, richEditIssue, updateRichDraft } from '../src/renderer/composer/standalone-draft.ts';
import { readRichDocument, serializePlainDocument, serializeRichDocument } from '../src/renderer/composer/rich-document.ts';

const context: ComposerContext = { hostId: 'local', threadId: null, draftId: 'legacy', cwd: '/fixture' };
const document: ComposerDocument = { type: 'doc', content: [
  { type: 'paragraph', content: [
    { type: 'text', text: '粗 ' }, { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
    { type: 'text', text: ' and ' }, { type: 'text', text: 'ital', marks: [{ type: 'em' }] },
    { type: 'text', text: ' ' }, { type: 'text', text: 'Read', marks: [{ type: 'link', attrs: { href: 'https://example.test/guide' } }] },
    { type: 'text', text: ' ' }, { type: 'atMention', attrs: { label: '@a', path: '/fixture/a', fsPath: '/fixture/a' } },
    { type: 'text', text: ' ' }, { type: 'skillMention', attrs: { name: 's', path: '/skills/s', description: 'skill' } },
    { type: 'text', text: ' ' }, { type: 'chatGptSystemHint', attrs: { label: 'Search', systemHint: 'search' } },
  ] },
  { type: 'list', content: [{ type: 'regular_list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
] };
const retainedText = '粗 bold and ital [Read](codex-text-link://https://example.test/guide) [@a](/fixture/a) [$s](/skills/s) [Search](chatgpt-system-hint://search)\n- item';
const sentText = '粗 bold and ital [Read](https://example.test/guide) [@a](/fixture/a) [$s](/skills/s) [Search](chatgpt-system-hint://search)\n- item';
const atoms = () => ({ 'composer-prompt-drafts-v2': { legacy: { prompt: { document, plainTextMode: true }, pullRequestChecks: [] } },
  'composer-retained-documents-v1': { legacy: { document, plainTextMode: true, prompt: retainedText } } });

test('legacy plain rich documents keep their original mode, saved links, metadata and editable structure', () => {
  const parsed = readRichDocument(document);
  assert.ok(parsed);
  assert.equal(serializePlainDocument(parsed, true), retainedText);
  assert.equal(serializePlainDocument(parsed), sentText);
  assert.match(serializeRichDocument(parsed), /\*\*bold\*\*/);
  const draft = legacyDraftCandidates(context, atoms())[0]!.draft;
  assert.equal(draft.blocked, undefined);
  assert.equal(draft.text, retainedText);
  assert.equal(richEditIssue(draft), null);
  assert.deepEqual(draftToInput(draft, 'local'), [{ type: 'text', text: sentText, text_elements: [] },
    { type: 'skill', name: 's', path: '/skills/s' }]);
  const changed = structuredClone(document);
  changed.content![1]!.content![0]!.content![0]!.content![0]!.text = 'edited';
  const edited = updateRichDraft(draft, changed);
  assert.equal(edited.text, retainedText.replace('- item', '- edited'));
  assert.deepEqual(edited.preserved, draft.preserved);
  assert.deepEqual(draftToInput(edited, 'local')[0], { type: 'text', text: sentText.replace('- item', '- edited'), text_elements: [] });
  assert.match(String(draftToInput(edited, 'local', { plainTextMode: false })[0]!.text), /\*\*bold\*\*/);
  assert.equal(readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'chatGptSystemHint', attrs: { label: 'Future', systemHint: 'unknown' } },
  ] }] }), null);
});

test('conflicting or unknown legacy modes and unknown document data are retained', () => {
  const conflict = atoms();
  conflict['composer-retained-documents-v1'].legacy.plainTextMode = false;
  const draft = legacyDraftCandidates(context, conflict)[0]!.draft;
  assert.match(draft.blocked ?? '', /保留/);
  assert.deepEqual((draft.preserved as { retained: unknown }).retained, conflict['composer-retained-documents-v1'].legacy);
  const unknown = { ...document, attrs: { future: true } };
  assert.throws(() => draftToInput({ text: 'text', images: [], files: [], document: unknown }, 'local'), /无损/);
  assert.throws(() => draftToInput({ text: 'text', images: [], files: [], hints: [{ future: 'context' }] }, 'local'), /提示/);
});

test('plain serialization keeps nested block text, hard breaks and code fences', () => {
  const nested: ComposerDocument = { type: 'doc', content: [
    { type: 'ordered_list', attrs: { startingNumber: 3 }, content: [{ type: 'regular_list_item', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'first' }, { type: 'hard_break' }, { type: 'text', text: 'second' }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested text' }] }] },
      { type: 'code_block', attrs: { autoDetectLanguage: true, language: 'plaintext' }, content: [{ type: 'text', text: 'x`' }] },
    ] }] },
  ] };
  const parsed = readRichDocument(nested);
  assert.ok(parsed);
  assert.equal(serializePlainDocument(parsed), '3. first\nsecond\n   nested text\n   ```\n   x`\n   ```');
  const invalid: ComposerDocument = { type: 'doc', content: [{ type: 'code_block', attrs: { language: 'bad\nvalue' } }] };
  const invalidLanguage = readRichDocument(invalid);
  assert.ok(invalidLanguage);
  assert.equal(serializePlainDocument(invalidLanguage), '```\n\n```');
  assert.equal(invalidLanguage.firstChild?.attrs.language, 'bad\nvalue');
  const paragraphs: ComposerDocument = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
  ] };
  const conflicting = { 'composer-retained-documents-v1': { legacy: { document: paragraphs, plainTextMode: true, prompt: 'first\n\nsecond' } } };
  assert.match(legacyDraftCandidates(context, conflicting)[0]!.draft.blocked ?? '', /不一致/);
  assert.deepEqual(draftToInput({ text: 'first\n\nsecond', images: [], files: [], document: documentFromText('first\n\nsecond') }, 'local',
    { plainTextMode: true }), [{ type: 'text', text: 'first\n\nsecond', text_elements: [] }]);
});

test('plain submission keeps link destinations and titles valid Markdown', () => {
  const source: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'A*B', marks: [{ type: 'link', attrs: { href: 'https://example.test/a b', title: 'line\n"quoted")' } }] },
  ] }] };
  const document = readRichDocument(source);
  assert.ok(document);
  const sent = serializePlainDocument(document);
  assert.equal(draftToInput({ text: serializeRichDocument(document), images: [], files: [], document: source }, 'local',
    { plainTextMode: true })[0]?.text, sent);
  const link = defaultMarkdownParser.parse(sent).firstChild?.firstChild?.marks[0];
  assert.ok(link);
  assert.equal(link.attrs.href, 'https://example.test/a%20b');
  assert.equal(link.attrs.title, 'line\n"quoted")');
});

test('unformatted legacy Markdown saves its escapes but submits ordinary text', () => {
  const plain = documentFromText('literal * and _');
  const parsed = readRichDocument(plain);
  assert.ok(parsed);
  const saved = serializeRichDocument(parsed);
  assert.notEqual(saved, 'literal * and _');
  const source = { 'composer-retained-documents-v1': { legacy: { document: plain, plainTextMode: false, prompt: saved } } };
  const draft = legacyDraftCandidates(context, source)[0]!.draft;
  assert.equal(draft.blocked, undefined);
  assert.equal(draft.text, saved);
  assert.deepEqual(draftToInput(draft, 'local', { plainTextMode: false }),
    [{ type: 'text', text: 'literal * and _', text_elements: [] }]);
  assert.equal(draft.document?.content?.[0]?.content?.[0]?.text, 'literal * and _');
});

test('previously imported blocked versions recover only when their original envelope and text still agree', () => {
  const draft = legacyDraftCandidates(context, atoms())[0]!.draft;
  const blocked = { ...draft, blocked: '此草稿的文档与保存的文本不一致，已保留两个版本。' };
  assert.deepEqual(recoverLegacyDraft(blocked), { ...draft, blocked: undefined });
  assert.equal(recoverLegacyDraft({ ...blocked, text: 'newer text' }), null);
  assert.equal(recoverLegacyDraft({ ...blocked, document: { type: 'doc', content: [{ type: 'paragraph' }] } }), null);
  assert.equal(recoverLegacyDraft({ ...blocked, hints: [{ unknown: true }] }), null);
  const jsonArchived = JSON.parse(JSON.stringify({ ...blocked, preserved: { promptKey: 'legacy', draft: { prompt: { document, plainTextMode: true } } } }));
  assert.ok(recoverLegacyDraft(jsonArchived));
});

test('ordered input and UTF-8 ranges are sent unchanged and inconsistent ranges cannot be sent', () => {
  const elements = [{ byteRange: { start: 7, end: 9 }, placeholder: '@a', extension: { keep: true } }];
  const input = [
    { type: 'text', text: '前😀@a', text_elements: elements },
    { type: 'image', url: 'https://example.test/a.png', detail: 'high' },
    { type: 'mention', name: 'file', path: '/fixture/a' },
    { type: 'text', text: 'é end', text_elements: [{ byteRange: { start: 0, end: 2 }, placeholder: null }] },
    { type: 'future', metadata: { preserve: true } },
  ];
  const draft = { text: '前😀@a\né end', images: [{ id: 'image-1', src: 'https://example.test/a.png' }],
    files: [{ name: 'a', path: '/fixture/a' }], references: [{ id: 'ref', text: 'selected context', original: { keep: true } }], input };
  const snapshot = structuredClone(draft);
  assert.deepEqual(draftToInput(draft, 'local', { plainTextMode: true }), [...input,
    { type: 'text', text: 'selected context', text_elements: [] }]);
  assert.deepEqual(draft, snapshot);
  assert.throws(() => draftToInput({ ...draft, text: '前😀@a\nchanged' }, 'local'), /不一致/);
  assert.throws(() => draftToInput({ ...draft, input: [{ type: 'text', text: '前😀@a\né end',
    text_elements: [{ byteRange: { start: 1, end: 3 }, placeholder: null }] }] }, 'local'), /UTF-8/);
  assert.deepEqual(draft, snapshot);
});

test('legacy plain rich document is edited, refreshed and submitted by the mounted composer', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    const state={snapshot:null,controller:null,submissions:[],listeners:new Set(),plainFails:false,releasePlain:null};
    const plainGate=localStorage.getItem('fixture-plain-gate')==='true'
      ? new Promise(resolve=>{state.releasePlain=resolve}) : Promise.resolve();
    const client={async rpc(method){if(method==='model/list'||method==='thread/queue/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting'){if(params.key==='composerPlainTextMode'){
        await plainGate;if(state.plainFails)throw Error('fixture preference read failed');
        return {exists:true,value:localStorage.getItem('fixture-plain')!=='false'}}
        return {exists:true,value:params.key==='composerEnterBehavior'?'cmdAlways':'queue'}}throw Error('unexpected host '+method)},
      subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener)},async reply(){throw Error('unexpected approval')}};
    createRoot(document.getElementById('root')).render(React.createElement(StandaloneComposer,{client,
      context:{hostId:'local',threadId:null,draftId:'legacy',cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},onDraftChange(value){state.snapshot=value},
      async onSubmit(draft,options,action,description){state.submissions.push({draft:structuredClone(draft),description:structuredClone(description),
        input:draftToInput(draft,'local',{plainTextMode:description.documentPlainTextMode})})},async onInterrupt(){}}));
    window.fixture={state,async blockOldVersion(){const owner=state.controller.snapshot().owner;
      return state.controller.update(owner,draft=>({...draft,blocked:'此草稿的文档与保存的文本不一致，已保留两个版本。'}))},
      async restoreSubmission(){const owner=state.controller.snapshot().owner;return state.controller.update(owner,()=>state.submissions[0].draft)},
      releasePlain(){localStorage.removeItem('fixture-plain-gate');state.releasePlain()},
      failPlain(value){state.plainFails=value;for(const listener of state.listeners)
        listener({type:'settings-changed',keys:['composerPlainTextMode']})},
      setPlain(value){localStorage.setItem('fixture-plain',String(value));for(const listener of state.listeners)
        listener({type:'settings-changed',keys:['composerPlainTextMode']})}};
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const browserContext = await browser.newContext();
  try {
    const page = await browserContext.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://composer-fixture.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://composer-fixture.test/');
    await page.evaluate(value => localStorage.setItem('native-atoms', JSON.stringify(value)), atoms());
    await page.evaluate(() => localStorage.setItem('fixture-plain-gate', 'true'));
    const mount = () => page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await mount();
    const editor = page.locator('[contenteditable="true"][aria-label="和 Codex 一起工作"]');
    await editor.waitFor();
    assert.equal(await editor.locator('strong').innerText(), 'bold');
    assert.equal(await editor.locator('[data-system-hint-type="search"]').innerText(), 'Search');
    const sendButton = page.getByRole('button', { name: '发送', exact: true });
    assert.equal(await sendButton.isDisabled(), true);
    await page.evaluate(() => (window as any).fixture.releasePlain());
    await page.waitForFunction(() => !(window.document.querySelector('.standalone-composer__submit') as HTMLButtonElement).disabled);
    await page.evaluate(() => {
      (window as any).fixture.failPlain(true);
      (window.document.querySelector('.standalone-composer__submit') as HTMLButtonElement).click();
    });
    await page.getByText('fixture preference read failed', { exact: false }).waitFor();
    assert.equal(await sendButton.isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    await page.evaluate(() => { (window as any).fixture.state.plainFails = false; });
    await page.getByRole('button', { name: '重试读取', exact: true }).click();
    await page.waitForFunction(() => !(window.document.querySelector('.standalone-composer__submit') as HTMLButtonElement).disabled);
    assert.equal(await page.evaluate(() => (window as any).fixture.blockOldVersion()), true);
    await page.reload(); await mount();
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    await editor.waitFor();
    assert.equal(await editor.locator('strong').innerText(), 'bold');
    await editor.click(); await editor.press('Control+End'); await page.keyboard.type('!');
    await page.waitForFunction(() => (window as any).fixture.state.snapshot?.draft.text.endsWith('- item!'));
    assert.equal(await page.evaluate(() => (window as any).fixture.blockOldVersion()), true);
    // A previous importer retained the pre-edit document; do not overwrite a newer edited version.
    assert.equal(await page.getByRole('button', { name: '恢复', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.update(
      (window as any).fixture.state.controller.snapshot().owner, (draft: any) => ({ ...draft, blocked: undefined }))), true);
    await page.reload(); await mount(); await editor.waitFor();
    assert.equal(await editor.locator('strong').innerText(), 'bold');
    assert.equal(await editor.locator('[data-system-hint-type="search"]').innerText(), 'Search');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(sent.description.documentPlainTextMode, true);
    assert.equal(sent.input[0].text, sentText + '!');
    assert.equal(sent.draft.document.content[0].content[1].marks[0].type, 'strong');
    assert.deepEqual(sent.input[1], { type: 'skill', name: 's', path: '/skills/s' });
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot()?.draft.text === '');
    assert.equal(await page.evaluate(() => (window as any).fixture.restoreSubmission()), true);
    await page.evaluate(() => (window as any).fixture.setPlain(false));
    await page.getByRole('toolbar', { name: '文本格式' }).waitFor();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 2);
    const richSent = await page.evaluate(() => (window as any).fixture.state.submissions[1]);
    assert.equal(richSent.description.documentPlainTextMode, false);
    assert.match(richSent.input[0].text, /\*\*bold\*\*/);
    assert.match(richSent.input[0].text, /chatgpt-system-hint:\/\/search/);
    assert.deepEqual(errors, []);
  } finally { await browserContext.close(); await browser.close(); }
});
