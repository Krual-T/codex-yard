import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('the main composer edits ordered input, retains attachments and survives refresh and freeze', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer, draftToInput } from './src/renderer/composer/StandaloneComposer.tsx';
    const state={controller:null,submissions:[],lease:null};
    const client={async rpc(method){
      if(method==='model/list'||method==='thread/queue/list') return {data:[],nextCursor:null};
      if(method==='config/read') return {config:{}};
      if(method==='skills/list') return {data:[{cwd:'/workspace',skills:[{name:'review-helper',path:'/skills/review/SKILL.md',enabled:true}]}]};
      throw Error('Unexpected RPC '+method);
    },async host(method,params){
      if(method==='get-setting') return {exists:true,value:params.key==='composerPlainTextMode'?false:
        params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
      if(method==='workspace-directory-entries') return {entries:[{name:'foo.ts',path:'foo.ts',type:'file'}]};
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    let props={client,context:{hostId:'fixture-remote',threadId:'thread',draftId:'segments',cwd:'/workspace'},busy:false,
      onDraftController(value){state.controller=value},
      async onSubmit(draft,options,action,description){state.submissions.push({draft:structuredClone(draft),
        input:draftToInput(draft,'fixture-remote',{plainTextMode:description.documentPlainTextMode}),action,description})},async onInterrupt(){}};
    window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};
      root.render(React.createElement(StandaloneComposer,props))},
      async setDraft(value){const controller=state.controller,snapshot=controller.snapshot();return controller.update(snapshot.owner,()=>value)}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://localhost/');
    const mount = () => page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await mount();
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    const draft = { text: '前😀@file tail\nSecond',
      images: [{ id: 'image-1', src: '', fileId: 'file-1', name: 'one.png' }, { id: 'image-3', src: '', fileId: 'file-2', name: 'two.png' }],
      files: [], references: [{ id: 'r', text: 'selected context', context: { selector: '#fixture' }, original: { keep: true } },
        { id: 'remove', text: 'remove context' }],
      input: [{ type: 'text', text: '前😀@file tail', text_elements: [{ byteRange: { start: 7, end: 12 }, placeholder: '@file' }] },
        { type: 'image', fileId: 'file-1', detail: 'high' }, { type: 'mention', name: 'file', path: '/fixture/a', extra: 'retained' },
        { type: 'image', fileId: 'file-2', detail: 'low' }, { type: 'text', text: 'Second', text_elements: [] }] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), draft), true);
    const first = page.getByRole('textbox', { name: '和 Codex 一起工作 1' });
    const second = page.getByRole('textbox', { name: '和 Codex 一起工作 2' });
    await first.waitFor(); await first.focus(); await first.press('Home'); await page.keyboard.type('中');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.startsWith('中前'));
    let saved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.deepEqual(saved.input[0].text_elements[0].byteRange, { start: 10, end: 15 });
    await first.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.startsWith('前😀'));
    await second.focus(); await second.press('End');
    await page.evaluate(() => navigator.clipboard.writeText(' pasted'));
    await second.press('Control+v');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('Second pasted'));
    await page.keyboard.type(' @foo');
    await page.getByRole('option', { name: /foo\.ts/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('`/workspace/foo.ts`'));
    await second.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('@foo'));
    await second.press('End');
    await page.getByRole('option', { name: /foo\.ts/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('`/workspace/foo.ts`'));
    await page.keyboard.type('$rev');
    await page.getByRole('option', { name: /review-helper/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.length === 1);
    await second.press('Control+z');
    await page.waitForFunction(() => {
      const draft = (window as any).fixture.state.controller.snapshot().draft;
      return draft.text.endsWith('$rev') && draft.skills.length === 0;
    });
    await second.press('Control+Shift+z');
    await page.waitForFunction(() => {
      const draft = (window as any).fixture.state.controller.snapshot().draft;
      return !draft.text.endsWith('$rev') && draft.skills.length === 1;
    });
    await page.getByRole('button', { name: '移除图片 one.png' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.images[0]?.id === 'image-2');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '添加附件' }).click();
    await (await chooser).setFiles({ name: 'added.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.images.some((item: any) => item.name === 'added.png'));
    saved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.deepEqual(saved.input.slice(1, 3), [draft.input[2], draft.input[3]]);
    assert.deepEqual(saved.references, draft.references);
    assert.equal(saved.images[0].id, 'image-2');
    await page.getByRole('button', { name: '移除引用' }).nth(1).click();
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.references.length === 1);

    await second.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    assert.equal(await page.evaluate(() => {
      const controller = (window as any).fixture.state.controller;
      return controller.freeze(controller.snapshot().owner) === null;
    }), true);
    await second.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
    await second.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await page.waitForFunction(() => {
      const state = (window as any).fixture.state, controller = state.controller;
      state.lease = controller.freeze(controller.snapshot().owner); return !!state.lease;
    });
    assert.equal(await page.evaluate(() => (window as any).fixture.state.lease.flush()), true);
    const beforeFrozen = await second.inputValue();
    await page.keyboard.type('must not edit');
    assert.equal(await second.inputValue(), beforeFrozen);
    await page.evaluate(() => (window as any).fixture.state.lease.release());
    await page.reload(); await mount(); await second.waitFor();
    assert.equal(await first.inputValue(), '前😀@file tail');
    assert.equal(await second.inputValue(), beforeFrozen);
    saved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.deepEqual(saved.references, [draft.references[0]]);
    assert.deepEqual(saved.input.slice(1, 3), [draft.input[2], draft.input[3]]);
    assert.equal(saved.images[0].id, 'image-2');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.deepEqual(sent.input.slice(0, 4), saved.input);
    assert.ok(sent.input.some((item: any) => item.type === 'skill' && item.name === 'review-helper'));
    assert.ok(sent.input.some((item: any) => item.type === 'text' && item.text === 'selected context'));
    assert.ok(sent.input.some((item: any) => item.type === 'image' && typeof item.url === 'string' && item.url.startsWith('data:image/png')));
    assert.deepEqual(sent.draft.references, [draft.references[0]]);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'marked' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'marked');
    const marked = { text: 'Alpha\nBeta', images: [], files: [], input: [
      { type: 'text', text: 'Alpha', text_elements: [{ byteRange: { start: 1, end: 4 }, placeholder: 'lph' }] },
      { type: 'mention', name: 'source', path: '/workspace/source' },
      { type: 'text', text: 'Beta', text_elements: [] },
    ], document: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha', marks: [{ type: 'strong' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Beta', marks: [{ type: 'em' }] }] },
    ] } };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), marked), true);
    await second.waitFor(); await second.focus(); await second.press('End'); await page.keyboard.type('!');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Alpha\nBeta!');
    await second.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Alpha\nBeta');
    await second.press('Control+Shift+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Alpha\nBeta!');
    assert.equal(await page.evaluate(() => {
      const controller = (window as any).fixture.state.controller; return controller.flush(controller.snapshot().owner);
    }), true);
    await page.reload(); await mount();
    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'marked' } }));
    await second.waitFor(); assert.equal(await second.inputValue(), 'Beta!');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const markedSent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.deepEqual(markedSent.input, [
      { ...marked.input[0], text: '**Alpha**', text_elements: [{ byteRange: { start: 3, end: 6 }, placeholder: 'lph' }] },
      marked.input[1], { ...marked.input[2], text: '*Beta!*' },
    ]);
    assert.deepEqual(markedSent.draft.document.content[0], marked.document.content[0]);
    assert.deepEqual(markedSent.draft.document.content[1].content[0].marks, [{ type: 'em' }]);
    assert.equal(markedSent.draft.document.content[1].content[0].text, 'Beta!');
    assert.equal(markedSent.description.documentPlainTextMode, false);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'protected' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'protected');
    const app = { text: 'app\nSecond', images: [], files: [], input: [
      { type: 'text', text: 'app', text_elements: [{ byteRange: { start: 0, end: 3 },
        placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1, message: { source: 'mcp_app', sourceId: 'fixture', text: 'context' } }) }] },
      { type: 'text', text: 'Second', text_elements: [] },
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), app), true);
    await first.waitFor(); assert.equal(await first.isEditable(), false);
    assert.match(await page.getByRole('status').allTextContents().then(values => values.join(' ')), /保留.*上下文/);
    await first.focus(); await first.press('Control+a'); await first.press('Control+c');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'app');
    await second.focus(); await second.press('End'); await page.keyboard.type('!');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'app\nSecond!');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '完整上下文' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 1);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.input[0]), app.input[0]);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'recognized-app' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'recognized-app');
    const recognizedApp = { ...app, input: [
      { type: 'text', text: 'app', text_elements: [{ byteRange: { start: 0, end: 3 },
        placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1, promptContextWithoutReviewedMessages: 'retained context' }) }] },
      app.input[1]!,
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), recognizedApp), true);
    await second.waitFor(); await second.focus(); await second.press('End'); await page.keyboard.type('!');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'app\nSecond!');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 2);
    const appSent = await page.evaluate(() => (window as any).fixture.state.submissions[1]);
    assert.deepEqual(appSent.input[0], recognizedApp.input[0]);
    assert.deepEqual(appSent.input[1], { ...recognizedApp.input[1], text: 'Second!' });

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'single' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'single');
    const single = { text: 'Single', images: [], files: [], input: [
      { type: 'text', text: 'Single', text_elements: [] }, { type: 'mention', name: 'source', path: '/fixture/source' },
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), single), true);
    const singleEditor = page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true });
    await singleEditor.waitFor(); await singleEditor.focus(); await singleEditor.press('End'); await page.keyboard.type(' @foo');
    await page.getByRole('option', { name: /foo\.ts/ }).waitFor(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('`/workspace/foo.ts`'));
    await singleEditor.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith('@foo'));
    await singleEditor.press('End');
    await page.getByRole('option', { name: /foo\.ts/ }).waitFor(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('`/workspace/foo.ts`'));
    const singleSaved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(singleSaved.input[0].text, singleSaved.text);
    assert.deepEqual(singleSaved.input[1], single.input[1]);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 3);
    const singleSent = await page.evaluate(() => (window as any).fixture.state.submissions[2]);
    assert.equal(singleSent.input[0].text, singleSaved.text);
    assert.deepEqual(singleSent.input[1], single.input[1]);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'single-middle' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'single-middle');
    const singleMiddle = { text: 'X @foobar tail', images: [], files: [], input: [
      { type: 'text', text: 'X @foobar tail', text_elements: [] }, single.input[1],
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), singleMiddle), true);
    await singleEditor.waitFor(); await singleEditor.focus(); await singleEditor.press('Home');
    for (let index = 0; index < 'X @fo'.length; index++) await singleEditor.press('ArrowRight');
    await page.getByRole('option', { name: /foo\.ts/ }).waitFor(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'X `/workspace/foo.ts`  tail');
    await singleEditor.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'X @foobar tail');

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'rich-link' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'rich-link');
    const literal = '[Documentation](<https://example.test/docs>)';
    const linkAttrs = { displayText: 'Documentation', href: 'https://example.test/docs', sourceAppId: 'fixture', isLoading: false,
      loadingDisplayText: null, literalMarkdownSource: literal, literalMarkdownOccurrenceId: 2, markdownSourceStart: 4, markdownSourceEnd: 48 };
    const loadingAttrs = { ...linkAttrs, isLoading: true, loadingDisplayText: 'Loading link',
      literalMarkdownSource: '[Documentation](https://example.test/docs)', literalMarkdownOccurrenceId: 3,
      markdownSourceStart: 53, markdownSourceEnd: 95 };
    const linkDraft = { text: 'See ' + literal + ' and [Documentation](https://example.test/docs)', images: [], files: [],
      document: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'See ' }, { type: 'richLink', attrs: linkAttrs }, { type: 'text', text: ' and ' },
        { type: 'richLink', attrs: loadingAttrs },
      ] }] } };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), linkDraft), true);
    const rich = page.locator('.ProseMirror'), links = rich.locator('[data-mention="rich-link"]');
    await links.first().waitFor();
    assert.equal(await links.nth(1).getAttribute('aria-busy'), 'true');
    assert.equal(await links.nth(1).innerText(), 'Loading link');
    await links.first().click();
    assert.equal(await links.first().getAttribute('aria-expanded'), 'true');
    assert.equal(await page.getByRole('dialog', { name: '链接' }).getByRole('link').getAttribute('href'), linkAttrs.href);
    await page.getByRole('dialog', { name: '链接' }).getByRole('button', { name: '关闭' }).click();
    assert.equal(await links.first().getAttribute('aria-expanded'), 'false');
    await links.first().focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: '链接' }).waitFor();
    await page.getByRole('dialog', { name: '链接' }).getByRole('button', { name: '关闭' }).click();
    await rich.click(); await rich.press('Control+End');
    await rich.evaluate(element => {
      const copy = element.querySelector('[data-mention="rich-link"]')!.cloneNode(true) as HTMLElement;
      const data = new DataTransfer(); data.setData('text/html', copy.outerHTML); data.setData('text/plain', 'Documentation');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-mention="rich-link"]').length === 3);
    const pasted = JSON.parse((await links.nth(2).getAttribute('data-composer-attrs'))!);
    assert.equal(pasted.literalMarkdownSource, null);
    assert.ok(Number.isInteger(pasted.literalMarkdownOccurrenceId));
    assert.ok(![2, 3].includes(pasted.literalMarkdownOccurrenceId));
    assert.equal(pasted.markdownSourceStart, null); assert.equal(pasted.markdownSourceEnd, null);
    await rich.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('[data-mention="rich-link"]').length === 2);
    await page.keyboard.type('!');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.endsWith(')!'));
    assert.equal(await page.evaluate(() => {
      const controller = (window as any).fixture.state.controller; return controller.flush(controller.snapshot().owner);
    }), true);
    await page.reload(); await mount();
    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'rich-link' } }));
    await links.first().waitFor();
    assert.equal(await links.nth(1).getAttribute('aria-busy'), 'true');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const linkSent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.equal(linkSent.input[0].text, linkDraft.text + '!');
    assert.deepEqual(linkSent.draft.document.content[0].content[1].attrs, linkAttrs);
    assert.deepEqual(linkSent.draft.document.content[0].content[3].attrs, loadingAttrs);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'skill-history' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'skill-history');
    const skillDraft = { text: 'X \nKeep', images: [{ id: 'image-0', src: '', fileId: 'picture', name: 'picture.png' }], files: [], input: [
      { type: 'image', fileId: 'picture' }, { type: 'text', text: 'X ', text_elements: [] },
      { type: 'text', text: 'Keep', text_elements: [] }, { type: 'skill', name: 'independent', path: '/skills/independent' },
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), skillDraft), true);
    await first.waitFor(); await first.focus(); await first.press('End');
    const chooseSkill = async () => {
      await page.keyboard.type('$rev');
      await page.getByRole('option', { name: /review-helper/ }).waitFor();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.some((skill: any) => skill.name === 'review-helper'));
    };
    await chooseSkill(); await chooseSkill();
    await first.press('Control+z');
    await page.waitForFunction(() => {
      const draft = (window as any).fixture.state.controller.snapshot().draft;
      return draft.input[1].text === 'X $rev' && draft.skills.some((skill: any) => skill.name === 'review-helper');
    });
    await first.press('Control+Shift+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[1].text === 'X ');
    await page.getByRole('button', { name: '移除图片 picture.png' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[0].type === 'text');
    await first.focus();
    await first.evaluate(element => {
      (window as any).undoEvents = [];
      for (const type of ['beforeinput', 'input']) element.addEventListener(type, event => {
        (window as any).undoEvents.push({ type, inputType: (event as InputEvent).inputType, cancelable: event.cancelable,
          value: (element as HTMLTextAreaElement).value });
      });
    });
    assert.equal(await first.evaluate(() => document.execCommand('undo')), true);
    try { await page.waitForFunction(() => {
      const draft = (window as any).fixture.state.controller.snapshot().draft;
      return draft.input[0].text === 'X $rev' && draft.skills.some((skill: any) => skill.name === 'review-helper');
    }); } catch (cause) {
      throw new Error('Native undo state: ' + JSON.stringify(await page.evaluate(() => ({ events: (window as any).undoEvents,
        draft: (window as any).fixture.state.controller.snapshot().draft }))), { cause });
    }
    assert.equal(await first.evaluate(() => document.execCommand('redo')), true);
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[0].text === 'X ');
    assert.equal(await first.evaluate(() => document.execCommand('undo')), true);
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[0].text === 'X $rev');
    await first.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[0].text === 'X ');
    await first.press('Control+z');
    await page.waitForFunction(() => {
      const draft = (window as any).fixture.state.controller.snapshot().draft;
      return draft.input[0].text === 'X $rev' && !draft.skills.some((skill: any) => skill.name === 'review-helper');
    });
    await first.press('Control+Shift+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.some((skill: any) => skill.name === 'review-helper'));
    await first.press('End'); await page.keyboard.type('$rev'); await first.press('Control+z');
    await page.waitForFunction(() => {
      const draft = (window as any).fixture.state.controller.snapshot().draft;
      return draft.input[0].text === 'X ' && draft.skills.some((skill: any) => skill.name === 'review-helper');
    });
    assert.equal(await first.evaluate(element => element.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'historyUndo', bubbles: true, cancelable: true,
    }))), false);
    await page.waitForFunction(() => {
      const draft = (window as any).fixture.state.controller.snapshot().draft;
      return draft.input[0].text === 'X $rev' && !draft.skills.some((skill: any) => skill.name === 'review-helper');
    });
    await first.press('Control+Shift+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.some((skill: any) => skill.name === 'review-helper'));
    assert.equal(await page.evaluate(() => {
      const controller = (window as any).fixture.state.controller; return controller.flush(controller.snapshot().owner);
    }), true);
    await page.reload(); await mount();
    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'skill-history' } }));
    await first.waitFor();
    const reloadedSkills = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(reloadedSkills.input[0].text, 'X ');
    assert.equal(reloadedSkills.skills.filter((skill: any) => skill.name === 'review-helper').length, 1);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    const skillSent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
    assert.deepEqual(skillSent.input.slice(0, 3), [
      { type: 'text', text: 'X ', text_elements: [] }, { type: 'text', text: 'Keep', text_elements: [] }, skillDraft.input[3],
    ]);
    assert.equal(skillSent.input.filter((item: any) => item.type === 'skill' && item.name === 'review-helper').length, 1);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'independent-skill' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'independent-skill');
    const independentSkill = { type: 'skill', name: 'review-helper', path: '/skills/review/SKILL.md', metadata: 'keep' };
    const independentDraft = { text: 'X \nKeep', images: [], files: [], input: [
      { type: 'text', text: 'X ', text_elements: [] }, independentSkill, { type: 'text', text: 'Keep', text_elements: [] },
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), independentDraft), true);
    await first.waitFor(); await first.focus(); await first.press('End'); await page.keyboard.type('$rev');
    await page.getByRole('option', { name: /review-helper/ }).waitFor(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[0].text === 'X ');
    await first.press('Control+z');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[0].text === 'X $rev');
    const independentSaved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.deepEqual(independentSaved.input[1], independentSkill);
    assert.equal(independentSaved.skills.some((skill: any) => skill.name === 'review-helper'), false);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 2);
    const independentSent = await page.evaluate(() => (window as any).fixture.state.submissions[1]);
    assert.deepEqual(independentSent.input[1], independentSkill);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'middle-completion' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'middle-completion');
    const middleText = '前😀 @foobar tail';
    const middleDraft = { text: middleText + '\nKeep', images: [], files: [], input: [
      { type: 'text', text: middleText, text_elements: [{ byteRange: { start: Buffer.byteLength('前😀 @foobar '), end: Buffer.byteLength(middleText) }, placeholder: 'tail' }] },
      { type: 'text', text: 'Keep', text_elements: [] },
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), middleDraft), true);
    await first.waitFor(); await first.focus();
    await first.press('Home');
    for (let index = 0; index < Array.from('前😀 @fo').length; index++) await first.press('ArrowRight');
    await page.getByRole('option', { name: /foo\.ts/ }).waitFor(); await page.keyboard.press('Enter');
    const expectedMiddle = '前😀 `/workspace/foo.ts`  tail';
    await page.waitForFunction(value => (window as any).fixture.state.controller.snapshot().draft.input[0].text === value, expectedMiddle);
    const middleSaved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.deepEqual(middleSaved.input[0].text_elements[0].byteRange,
      { start: Buffer.byteLength(expectedMiddle.slice(0, -4)), end: Buffer.byteLength(expectedMiddle) });
    assert.deepEqual(middleSaved.input[1], middleDraft.input[1]);
    await first.press('Control+z');
    await page.waitForFunction(value => (window as any).fixture.state.controller.snapshot().draft.input[0].text === value, middleText);
    await first.press('Control+Shift+z');
    await page.waitForFunction(value => (window as any).fixture.state.controller.snapshot().draft.input[0].text === value, expectedMiddle);

    await page.evaluate(() => (window as any).fixture.render({ context: { draftId: 'composition-owner' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'composition-owner');
    const compositionDraft = { text: '$rev\n$rev', images: [{ id: 'image-0', src: '', fileId: 'ime-image', name: 'ime.png' }], files: [], input: [
      { type: 'image', fileId: 'ime-image' }, { type: 'text', text: '$rev', text_elements: [] }, { type: 'text', text: '$rev', text_elements: [] },
    ] };
    assert.equal(await page.evaluate(value => (window as any).fixture.setDraft(value), compositionDraft), true);
    await first.waitFor(); await first.focus();
    await page.evaluate(() => {
      const input = document.querySelector('textarea[aria-label="和 Codex 一起工作 1"]') as HTMLTextAreaElement;
      const remove = document.querySelector('button[aria-label="移除图片 ime.png"]') as HTMLButtonElement;
      input.setSelectionRange(4, 4);
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      remove.focus(); input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); remove.click();
    });
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.input[0].type === 'text');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.getByRole('listbox').count(), 0);
    await first.focus(); await first.press('End');
    await page.getByRole('option', { name: /review-helper/ }).waitFor(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.some((skill: any) => skill.name === 'review-helper'));
    const compositionSaved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(compositionSaved.input[0].text, ''); assert.equal(compositionSaved.input[1].text, '$rev');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
