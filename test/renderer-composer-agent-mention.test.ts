import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { ComposerDocument } from '../src/renderer/workbench-contract.ts';
import { parseAgentThreadPath, readRichDocument, serializePlainDocument, serializeRichDocument } from '../src/renderer/composer/rich-document.ts';
import { draftToInput, legacyDraftCandidates, normalizeDraft, richEditIssue } from '../src/renderer/composer/standalone-draft.ts';

const mention = (path: string, name = 'Review'): ComposerDocument => ({
  type: 'agentMention', attrs: { name, displayName: name, conversationId: null, path },
});

test('legacy agent mentions preserve qualified identity, ordering, marks and both submission formats', () => {
  const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Start ', marks: [{ type: 'strong' }] },
    mention('thread://same-id?hostId=ssh%3Aone'), { type: 'text', text: ' then ' },
    mention('thread://same-id?hostId=ssh%3Atwo'), { type: 'text', text: ' end' },
  ] }] };
  const parsed = readRichDocument(doc);
  assert.ok(parsed);
  const rich = '**Start** [@Review](thread://same-id?hostId=ssh%3Aone) then [@Review](thread://same-id?hostId=ssh%3Atwo) end';
  const plain = 'Start [@Review](thread://same-id?hostId=ssh%3Aone) then [@Review](thread://same-id?hostId=ssh%3Atwo) end';
  assert.equal(serializeRichDocument(parsed), rich);
  assert.equal(serializePlainDocument(parsed), plain);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.toJSON())), doc);
  const draft = normalizeDraft({ text: rich, document: doc, images: [], files: [] });
  assert.equal(richEditIssue(draft), null);
  assert.equal(draftToInput(draft, 'local', { plainTextMode: false })[0]?.text, rich);
  assert.equal(draftToInput(draft, 'local', { plainTextMode: true })[0]?.text, plain);
  const legacy = legacyDraftCandidates({ hostId: 'local', threadId: null, draftId: 'legacy', cwd: '/fixture' }, {
    'composer-retained-documents-v1': { legacy: { document: doc, plainTextMode: true, prompt: plain } },
  })[0]!.draft;
  assert.equal(richEditIssue(legacy), null);
  assert.deepEqual(legacy.document, doc);
  assert.equal(draftToInput(legacy, 'local')[0]?.text, plain);
  const agent = readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'agentMention', attrs: { name: 'Assistant', path: 'agent://prior', conversationId: 'prior' } },
  ] }] });
  assert.ok(agent);
  assert.equal(serializeRichDocument(agent), '[@Assistant](agent://prior)');
  assert.equal(agent.firstChild!.firstChild!.attrs.conversationId, 'prior');
  for (const mark of [{ type: 'code' }, { type: 'link', attrs: { href: 'https://example.test' } }]) {
    const protectedDoc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { ...mention('thread://id?hostId=local'), marks: [mark] },
    ] }] };
    assert.equal(readRichDocument(protectedDoc), null);
    assert.match(richEditIssue(normalizeDraft({ text: '', document: protectedDoc, images: [], files: [] })) ?? '', /保留/);
  }
  assert.deepEqual(parseAgentThreadPath('thread://same-id?hostId=ssh%3Aone'), { threadId: 'same-id', hostId: 'ssh:one' });
  assert.deepEqual(parseAgentThreadPath('thread://same-id'), { threadId: 'same-id' });
  for (const path of ['thread://bad/id', 'thread://id?hostId=invalid%2Fhost', 'thread://id?hostId=%', 'thread://id?hostId=x&extra=1']) {
    assert.equal(parseAgentThreadPath(path), null);
  }
  const future = structuredClone(doc);
  future.content![0]!.content![1]!.attrs!.future = { retained: true };
  const original = structuredClone(future);
  assert.equal(readRichDocument(future), null);
  const protectedDraft = normalizeDraft({ text: rich, document: future, images: [], files: [] });
  assert.match(richEditIssue(protectedDraft) ?? '', /保留/);
  assert.deepEqual(protectedDraft.document, original);
  assert.deepEqual(future, original);
  assert.throws(() => draftToInput(protectedDraft, 'local'));
  const retained = { document: future, plainTextMode: true, prompt: plain };
  const imported = legacyDraftCandidates({ hostId: 'local', threadId: null, draftId: 'legacy', cwd: '/fixture' }, {
    'composer-retained-documents-v1': { legacy: retained },
  })[0]!.draft;
  assert.match(imported.blocked ?? '', /保留/);
  assert.deepEqual(imported.document, original);
  assert.deepEqual((imported.preserved as { retained: unknown }).retained, retained);
});

test('agent mention insertion uses the real editor selection, history and clipboard', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React, {useRef,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneRichEditor} from './src/renderer/composer/StandaloneRichEditor.tsx';
    import {readRichDocument,serializeRichDocument} from './src/renderer/composer/rich-document.ts';
    import {normalizeDraft,updateRichDraft,draftToInput} from './src/renderer/composer/standalone-draft.ts';
    function Fixture(){
      const initial=JSON.parse(localStorage.getItem('agent-fixture') || 'null') || window.initialAgentDraft;
      const [draft,setDraft]=useState(initial), editor=useRef(null), target=useRef(null);
      const current=useRef({draft:initial,owner:{hostId:'local',threadId:null,draftId:'fixture'},revision:0,active:{},editable:true,errors:[],changes:0});
      const save=value=>{current.current.draft=value;current.current.revision++;current.current.changes++;localStorage.setItem('agent-fixture',JSON.stringify(value));setDraft(value)};
      window.agentFixture={
        capture(query){const active=current.current.active;return !!(target.current=editor.current.captureAgentMentionTarget(()=>active===current.current.active
          ? {owner:current.current.owner,revision:String(current.current.revision)} : null,query));},
        insert(choice){return !!target.current && editor.current.insertAgentMention(target.current,choice)},
        switchOwner(){current.current.active={};current.current.owner={hostId:'other',threadId:'other',draftId:'other'}},
        disable(){current.current.editable=false}, enable(){current.current.editable=true},
        snapshot(){return current.current.draft}, errors(){return current.current.errors}, changes(){return current.current.changes},
        submit(plain){return draftToInput(current.current.draft,'local',{plainTextMode:plain})},
      };
      return React.createElement(StandaloneRichEditor,{ref:editor,document:draft.document,currentDocument:()=>current.current.draft.document,
        ariaLabel:'Rich input',canEdit:()=>current.current.editable,onChange:value=>save(updateRichDraft(current.current.draft,value)),
        onKeyDown:()=>false,onImages:()=>{},onInvalid:value=>current.current.errors.push(value || 'invalid'),onCompletionContext:()=>{}});
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const open = async (doc: ComposerDocument) => {
    const parsed = readRichDocument(doc)!;
    const initial = normalizeDraft({ text: serializeRichDocument(parsed), document: doc, images: [], files: [] });
    const page = await context.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://fixture.test/');
    await page.evaluate(value => { localStorage.clear(); (window as any).initialAgentDraft = value; }, initial);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    return page;
  };
  try {
    await t.test('selected marked text becomes an atom and survives undo, redo, paste and reload', async () => {
      const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Before TARGET after', marks: [{ type: 'strong' }] },
      ] }] };
      const page = await open(doc), editor = page.getByRole('textbox', { name: 'Rich input' });
      await editor.focus();
      await editor.evaluate(element => {
        const text = element.querySelector('strong')!.firstChild!, range = document.createRange();
        range.setStart(text, 7); range.setEnd(text, 13);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      assert.equal(await page.evaluate(() => (window as any).agentFixture.capture()), true);
      assert.equal(await page.evaluate(() => (window as any).agentFixture.insert({ threadId: 'same-id', title: 'Review' })), false);
      assert.equal(await page.evaluate(() => (window as any).agentFixture.insert({ threadId: 'same-id', hostId: 'bad/host', title: 'Review' })), false);
      await page.evaluate(() => { const button = document.createElement('button'); button.textContent = 'Choose chat'; document.body.append(button); });
      await page.getByRole('button', { name: 'Choose chat' }).click();
      assert.equal(await page.evaluate(() => (window as any).agentFixture.insert({ threadId: 'same-id', hostId: 'ssh:one', title: 'Review' })), true);
      assert.equal(await editor.locator('strong [data-mention="agent"]').count(), 1);
      assert.equal(await page.evaluate(() => (window as any).agentFixture.changes()), 1);
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).agentFixture.submit(false))), /thread:\/\/same-id\?hostId=ssh%3Aone/);
      await editor.press('Control+z');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      assert.equal(await editor.innerText(), 'Before TARGET after');
      await editor.press('Control+Shift+z');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      const copied = await editor.evaluate(element => {
        const paragraph = element.querySelector('p')!, range = document.createRange(); range.selectNodeContents(paragraph);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }));
        return { html: clipboard.getData('text/html'), text: clipboard.getData('text/plain') };
      });
      assert.match(copied.html, /data-mention="agent"/);
      assert.match(copied.text, /@Review/);
      assert.doesNotMatch(copied.text, /thread:\/\//);
      await editor.evaluate((element, value) => {
        const paragraph = element.querySelector('p')!, range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(false);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); clipboard.setData('text/html', value.html); clipboard.setData('text/plain', value.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      }, copied);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      const beforeReload = await page.evaluate(() => (window as any).agentFixture.snapshot());
      await page.reload();
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      assert.deepEqual(await page.evaluate(() => (window as any).agentFixture.snapshot()), beforeReload);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).agentFixture.submit(true))), /thread:\/\/same-id\?hostId=ssh%3Aone/);
      await page.close();
    });

    await t.test('completion replaces the complete token and preserves another host', async () => {
      const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'A @thSuffix B ' }, mention('thread://same-id?hostId=ssh%3Aone'),
      ] }] };
      const page = await open(doc), editor = page.getByRole('textbox', { name: 'Rich input' });
      await editor.focus();
      await editor.evaluate(element => {
        const text = element.querySelector('p')!.firstChild!, range = document.createRange(); range.setStart(text, 5); range.collapse(true);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      assert.equal(await page.evaluate(() => (window as any).agentFixture.capture({ start: 2, end: 5, token: '@th' })), true);
      assert.equal(await page.evaluate(() => (window as any).agentFixture.insert({ threadId: 'same-id', hostId: 'ssh:two', title: 'Other' })), true);
      const snapshot = await page.evaluate(() => (window as any).agentFixture.snapshot());
      assert.doesNotMatch(snapshot.text, /Suffix/);
      assert.match(snapshot.text, /thread:\/\/same-id\?hostId=ssh%3Atwo/);
      assert.match(snapshot.text, /thread:\/\/same-id\?hostId=ssh%3Aone/);
      await editor.press('Control+z');
      assert.match((await page.evaluate(() => (window as any).agentFixture.snapshot())).text, /@thSuffix/);
      await page.close();
    });

    await t.test('an inline-code selection is retained when it cannot carry a Markdown reference', async () => {
      const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'target', marks: [{ type: 'code' }] },
      ] }] };
      const page = await open(doc), editor = page.getByRole('textbox', { name: 'Rich input' });
      await editor.focus();
      await editor.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('code')!);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      assert.equal(await page.evaluate(() => (window as any).agentFixture.capture()), true);
      assert.equal(await page.evaluate(() => (window as any).agentFixture.insert({ threadId: 'id', hostId: 'local', title: 'Chat' })), false);
      assert.equal(await editor.locator('code').innerText(), 'target');
      assert.equal(await page.evaluate(() => (window as any).agentFixture.changes()), 0);
      await page.close();
    });

    await t.test('stale selection, editing, owner, freeze and composition reject a delayed choice', async () => {
      const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ABC' }] }] };
      const page = await open(doc), editor = page.getByRole('textbox', { name: 'Rich input' });
      const capture = () => page.evaluate(() => (window as any).agentFixture.capture());
      const insert = () => page.evaluate(() => (window as any).agentFixture.insert({ threadId: 'id', hostId: 'local', title: 'Chat' }));
      await editor.focus();
      assert.equal(await capture(), true);
      await editor.press('End'); await editor.type('!');
      assert.equal(await insert(), false);
      assert.equal(await capture(), true);
      await editor.press('ArrowLeft');
      assert.equal(await insert(), false);
      assert.equal(await capture(), true);
      await page.evaluate(() => (window as any).agentFixture.disable());
      assert.equal(await insert(), false);
      assert.equal(await capture(), false);
      await page.evaluate(() => (window as any).agentFixture.enable());
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      assert.equal(await insert(), false);
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal(await capture(), true);
      await page.evaluate(() => (window as any).agentFixture.switchOwner());
      assert.equal(await insert(), false);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      assert.equal(await editor.innerText(), 'ABC!');
      await page.close();
    });

    await t.test('original DOM mention paste retains attributes and rejects unknown copied data', async () => {
      const doc: ComposerDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start ' }] }] };
      const page = await open(doc), editor = page.getByRole('textbox', { name: 'Rich input' });
      await editor.focus(); await editor.press('End');
      const paste = async (html: string) => editor.evaluate((element, value) => {
        const clipboard = new DataTransfer(); clipboard.setData('text/html', value); clipboard.setData('text/plain', 'Chat');
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      }, html);
      await paste('<span agent-mention-name="Chat" agent-mention-display-name="Chat title" agent-mention-path="thread://id?hostId=ssh%3Aone" agent-mention-conversation-id="legacy" data-appearance="inline-mention" data-layout="inline-flow" data-font-weight="medium" data-tone="accent" data-interactive data-underline-on-hover><span contenteditable="false"><svg viewBox="0 0 16 16"><path d="M1 1" /></svg></span><span>Chat title</span></span>');
      const snapshot = await page.evaluate(() => (window as any).agentFixture.snapshot());
      const node = snapshot.document.content[0].content.find((item: { type: string }) => item.type === 'agentMention');
      assert.deepEqual(node.attrs, { name: 'Chat', displayName: 'Chat title', conversationId: 'legacy', path: 'thread://id?hostId=ssh%3Aone' });
      await paste('<span data-mention="agent" data-composer-attrs=\'{"name":"x","path":"thread://id","future":"retain"}\'>x</span>');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      assert.equal((await page.evaluate(() => (window as any).agentFixture.errors())).length, 1);
      await page.close();
    });
  } finally { await context.close(); await browser.close(); }
});
