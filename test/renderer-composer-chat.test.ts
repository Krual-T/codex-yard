import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('chat lookup uses the real composer, original editor and host-scoped list', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneComposer,draftToInput,readComposerDraft} from './src/renderer/composer/StandaloneComposer.tsx';
    const state={calls:[],submissions:[],snapshots:[],controller:null,grant:1,epochs:{local:1,'ssh:other':1},hold:null,pending:[],failList:false};
    const pages=(host,cursor)=>host==='local' ? cursor ? {data:[{id:'same-id',name:'Review local',cwd:'/workspace'}],nextCursor:null}
      : {data:[{id:'first',name:'Other local',cwd:'/workspace'},{id:'bad/id',name:'Unsupported identifier',cwd:'/workspace'}],nextCursor:'page-2'}
      : {data:[{id:'same-id',name:'Review remote',cwd:'/remote'}],nextCursor:null};
    let props;
    const client={
      captureDaemonConnection(host){const epoch=state.epochs[host];if(!epoch)throw Error('connection unavailable');
        return {generation:host+'-1',assertOriginal(){if(state.epochs[host]!==epoch)throw Error('original connection revoked')}};},
      async rpc(method,params={},host='local',options={}){
        options.assertBeforeSend?.();state.calls.push({method,params:structuredClone(params),host,generation:options.daemonConnectionGeneration});
        if(method==='thread/list'){
          if(state.failList){state.failList=false;throw Error('fixture list failed');}
          if(state.hold===host)return new Promise(resolve=>state.pending.push(()=>resolve(pages(host,params.cursor))));
          return pages(host,params.cursor);
        }
        if(method==='skills/list')return {data:[{skills:[{enabled:true,name:'review-skill',path:'/skills/review',description:'Review'}]}]};
        if(method==='model/list')return {data:[{id:'model',model:'model',displayName:'Fixture',isDefault:true,supportedReasoningEfforts:[]}],nextCursor:null};
        if(method==='config/read')return {config:{model:'model',approval_policy:'on-request',sandbox_mode:'workspace-write',sandbox_workspace_write:null}};
        if(method==='configRequirements/read')return {requirements:null};
        if(method==='permissionProfile/list')return {data:[],nextCursor:null};
        if(method==='thread/queue/list')return {data:[],nextCursor:null};
        throw Error('unexpected RPC '+method);
      },
      async host(method,params={}){
        if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?location.hostname.includes('plain-mode'):params.key==='composerEnterBehavior'?'enter':'queue'};
        if(method==='workspace-directory-entries')return {entries:[]};
        if(method==='codex-home')return {codexHome:'/fixture'};
        if(method==='workspace-root-options')return {roots:['/workspace']};
        throw Error('unexpected host '+method);
      },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')},
    };
    props={client,context:{hostId:'local',threadId:null,draftId:'chat-fixture',cwd:'/workspace'},busy:false,
      hosts:[{hostId:'local',displayName:'Local'},{hostId:'ssh:other',displayName:'Remote'}],
      captureSubmissionAuthority(owner){const expected=JSON.stringify(owner),grant=state.grant;
        return ()=>{const c=props.context;if(grant!==state.grant || expected!==JSON.stringify({hostId:c.hostId,threadId:c.threadId,draftId:c.draftId}))throw Error('original route authority revoked');};},
      onDraftController(controller){state.controller=controller;},onDraftChange(snapshot){state.snapshots.push(structuredClone(snapshot));},
      async onSubmit(draft,options,action,description,assertAuthority){assertAuthority?.();state.submissions.push({draft:structuredClone(draft),
        input:draftToInput(draft,props.context.hostId,{plainTextMode:description?.documentPlainTextMode}),action});throw Error('fixture send declined');},async onInterrupt(){} };
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};
      root.render(React.createElement(I18nProvider,{locale:'en-US'},React.createElement(StandaloneComposer,props)));},
      read(){const {hostId,threadId,draftId}=props.context;return readComposerDraft({hostId,threadId,draftId});},
      releaseOne(){state.pending.shift()?.();},
      release(){const pending=state.pending.splice(0);state.hold=null;for(const resolve of pending)resolve();}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext();
  const open = async (name: string) => {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://' + name + '.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://' + name + '.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('textbox', { name: 'Work with Codex' }).waitFor();
    return { page, errors };
  };
  const enterRich = async (page: Awaited<ReturnType<typeof open>>['page']) => {
    await page.locator('.standalone-composer__add > summary').click();
    await page.getByRole('button', { name: 'Rich text editor' }).click();
    const editor = page.locator('[contenteditable="true"][role="textbox"]');
    await editor.waitFor(); await editor.focus(); return editor;
  };
  try {
    await t.test('typed mention searches paged threads, persists and survives a failed send and reload', async () => {
      const { page, errors } = await open('chat-typed');
      const editor = await enterRich(page);
      await editor.pressSequentially('Start @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor();
      assert.ok(await page.evaluate(() => (window as any).fixture.state.calls.some((call: any) =>
        call.method === 'thread/list' && call.host === 'local' && call.params.cursor === 'page-2' && call.generation === 'local-1')));
      await editor.press('Enter');
      const mention = editor.locator('[data-mention="agent"]');
      await mention.waitFor();
      assert.equal(await mention.getAttribute('agent-mention-path'), 'thread://same-id?hostId=local');
      await page.waitForFunction(async () => {
        const value = await (window as any).fixture.read();
        return JSON.stringify(value?.draft?.document).includes('thread://same-id?hostId=local');
      });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const submission = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
      assert.match(JSON.stringify(submission.input), /thread:\/\/same-id\?hostId=local/);
      assert.equal(submission.draft.document.content[0].content[1].type, 'agentMention');
      await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.locator('[contenteditable="true"] [data-mention="agent"]').waitFor();
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('menu preserves host identity and refuses a revoked original grant', async () => {
      const { page, errors } = await open('chat-host');
      const editor = await enterRich(page); await editor.pressSequentially('Context ');
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByLabel('Chat host').selectOption('ssh:other');
      await page.getByRole('button', { name: /Review remote/ }).waitFor();
      await page.getByRole('button', { name: /Review remote/ }).click();
      assert.equal(await editor.locator('[data-mention="agent"]').getAttribute('agent-mention-path'), 'thread://same-id?hostId=ssh%3Aother');
      await editor.press('End');
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: 'More chats' }).click();
      await page.getByRole('button', { name: /Review local/ }).click();
      assert.deepEqual(await editor.locator('[data-mention="agent"]').evaluateAll(nodes =>
        nodes.map(node => node.getAttribute('agent-mention-path'))), [
        'thread://same-id?hostId=ssh%3Aother', 'thread://same-id?hostId=local',
      ]);
      await editor.press('End');
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).waitFor();
      await page.evaluate(() => { (window as any).fixture.state.grant++; });
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'original route authority revoked' }).waitFor();
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      assert.ok(await page.evaluate(() => (window as any).fixture.state.calls.some((call: any) =>
        call.method === 'thread/list' && call.host === 'ssh:other' && call.generation === 'ssh:other-1')));
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('menu replaces a marked selection and preserves editor undo and redo', async () => {
      const { page, errors } = await open('chat-marked-selection');
      const editor = await enterRich(page);
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      await editor.pressSequentially('Before TARGET after');
      await editor.evaluate(element => {
        const text = element.querySelector('strong')!.firstChild!, range = document.createRange();
        range.setStart(text, 7); range.setEnd(text, 13);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).click();
      assert.equal(await editor.locator('strong [data-mention="agent"]').count(), 1);
      await editor.press('Control+z');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      assert.equal(await editor.innerText(), 'Before TARGET after');
      await editor.press('Control+Shift+z');
      assert.equal(await editor.locator('strong [data-mention="agent"]').count(), 1);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('late old-owner results cannot replace the new draft', async () => {
      const { page, errors } = await open('chat-late');
      const editor = await enterRich(page); await editor.pressSequentially('Old ');
      await page.evaluate(() => { (window as any).fixture.state.hold = 'local'; });
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.pending.length > 0);
      await page.evaluate(() => (window as any).fixture.render({context:{hostId:'ssh:other',threadId:'new',draftId:'new',cwd:'/remote'}}));
      const newEditor = page.getByRole('textbox', { name: 'Work with Codex' });
      await newEditor.fill('New draft');
      await page.evaluate(() => (window as any).fixture.release());
      await page.waitForFunction(() => (window as any).fixture.state.pending.length === 0);
      assert.equal(await newEditor.inputValue(), 'New draft');
      assert.equal(await page.locator('[data-mention="agent"]').count(), 0);
      await page.evaluate(() => (window as any).fixture.render({context:{hostId:'local',threadId:null,draftId:'chat-fixture',cwd:'/workspace'}}));
      await page.locator('[contenteditable="true"][role="textbox"]').waitFor();
      assert.match(await page.locator('[contenteditable="true"][role="textbox"]').innerText(), /Old/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a changed document rejects a late result from the same owner', async () => {
      const { page, errors } = await open('chat-changed-document');
      const editor = await enterRich(page); await editor.pressSequentially('Original ');
      await page.evaluate(() => { (window as any).fixture.state.hold = 'local'; });
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.pending.length === 1);
      await editor.focus(); await editor.press('End'); await editor.pressSequentially('new');
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('button', { name: /Other local/ }).waitFor();
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'original draft or selection changed' }).waitFor();
      assert.equal(await editor.innerText(), 'Original new');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a reopened picker ignores its older result and inserts only at the new selection', async () => {
      const { page, errors } = await open('chat-reopen');
      const editor = await enterRich(page); await editor.pressSequentially('First ');
      await page.evaluate(() => { (window as any).fixture.state.hold = 'local'; });
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.pending.length === 1);
      await editor.click(); await editor.press('End'); await editor.pressSequentially('new ');
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.pending.length === 2);
      await page.evaluate(() => (window as any).fixture.releaseOne());
      await page.waitForFunction(() => (window as any).fixture.state.pending.length === 1);
      assert.equal(await page.getByRole('button', { name: /Other local/ }).count(), 0);
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('button', { name: /Other local/ }).click();
      assert.match(await editor.innerText(), /First new\s+Other local/);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      assert.equal(await editor.locator('[data-mention="agent"]').getAttribute('agent-mention-path'), 'thread://first?hostId=local');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('list errors retry and a replaced host connection cannot insert its old result', async () => {
      const { page, errors } = await open('chat-retry');
      const editor = await enterRich(page); await editor.pressSequentially('Draft ');
      await page.evaluate(() => { (window as any).fixture.state.failList = true; });
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture list failed' }).waitFor();
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('button', { name: /Other local/ }).waitFor();
      await page.getByRole('alert').filter({ hasText: 'Some chat identifiers cannot be represented' }).waitFor();
      await page.evaluate(() => { (window as any).fixture.state.epochs.local++; });
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'original connection revoked' }).waitFor();
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      assert.match(await editor.innerText(), /Draft/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('default input inserts an agent node, preserves history, sends and reloads', async () => {
      const { page, errors } = await open('chat-default');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      assert.equal(await editor.getAttribute('placeholder'), 'Do anything');
      await editor.pressSequentially('Plain @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor();
      await editor.press('Enter');
      await page.waitForFunction(() => JSON.stringify((window as any).fixture.state.controller.snapshot().draft.document).includes('thread://same-id?hostId=local'));
      assert.equal(await editor.inputValue(), 'Plain Review local ');
      await editor.press('Control+z');
      assert.equal(await editor.inputValue(), 'Plain @Rev');
      await editor.press('Control+z');
      assert.notEqual(await editor.inputValue(), 'Plain @Rev');
      await editor.press('Control+Shift+z');
      assert.equal(await editor.inputValue(), 'Plain @Rev');
      await editor.press('Control+Shift+z');
      assert.equal(await editor.inputValue(), 'Plain Review local ');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
      assert.deepEqual(submitted.input[0], { type: 'text', text: 'Plain [@Review local](thread://same-id?hostId=local) ', text_elements: [] });
      assert.equal(submitted.draft.document.content[0].content[1].type, 'agentMention');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.locator('[contenteditable="true"] [data-mention="agent"]').waitFor();
      assert.equal(await page.locator('[data-mention="agent"]').getAttribute('agent-mention-path'), 'thread://same-id?hostId=local');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('plain-text mode menu replaces the selected range and retains host identity', async () => {
      const { page, errors } = await open('chat-plain-mode');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.fill('Before TARGET after');
      await editor.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(7, 13); element.dispatchEvent(new Event('select', { bubbles: true })); });
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByLabel('Chat host').selectOption('ssh:other');
      await page.getByRole('button', { name: /Review remote/ }).click();
      assert.equal(await editor.inputValue(), 'Before Review remote after');
      const draft = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.match(JSON.stringify(draft.document), /thread:\/\/same-id\?hostId=ssh%3Aother/);
      await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'Before TARGET after');
      await editor.press('Control+Shift+z'); assert.equal(await editor.inputValue(), 'Before Review remote after');
      await editor.press('End');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: 'More chats' }).click();
      await page.getByRole('button', { name: /Review local/ }).click();
      const both = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      const paths = both.content[0].content.filter((node: any) => node.type === 'agentMention').map((node: any) => node.attrs.path);
      assert.deepEqual(paths, ['thread://same-id?hostId=ssh%3Aother', 'thread://same-id?hostId=local']);
      await editor.pressSequentially('@Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor();
      await editor.press('Enter');
      const withCompletion = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      assert.equal(withCompletion.content[0].content.filter((node: any) => node.type === 'agentMention').length, 3);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.submissions[0].input)), /thread:\/\/same-id\?hostId=ssh%3Aother/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('editing inside a text-mode agent label removes that node and undo restores it', async () => {
      const { page, errors } = await open('chat-atom-edit');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).click();
      assert.equal(await editor.inputValue(), 'Other local ');
      await editor.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(2, 2); element.dispatchEvent(new Event('select', { bubbles: true })); });
      await editor.pressSequentially('X');
      assert.equal(await editor.inputValue(), 'OtXher local ');
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /agentMention/);
      await editor.press('Control+z');
      assert.equal(await editor.inputValue(), 'Other local ');
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /agentMention/);
      await editor.press('Control+Shift+z'); assert.equal(await editor.inputValue(), 'OtXher local ');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('skill completion after an agent remains in the same undo history', async () => {
      const { page, errors } = await open('chat-agent-then-skill');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).click();
      await editor.pressSequentially('$rev');
      await page.getByRole('option', { name: /review-skill/ }).click();
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.some((skill: any) => skill.name === 'review-skill'));
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /thread:\/\/first\?hostId=local/);
      await editor.press('Control+z');
      assert.equal(await editor.inputValue(), 'Other local $rev');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), []);
      await editor.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), [{ name: 'review-skill', path: '/skills/review' }]);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('segmented retained input keeps marks, ordered items and UTF-8 reference ranges', async () => {
      const { page, errors } = await open('chat-segmented');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'file @ref\nLook @Rev', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'file @ref', text_elements: [{ byteRange: { start: 5, end: 9 }, placeholder: 'ref' }] },
        { type: 'image', fileId: 'file-1', detail: 'high' },
        { type: 'text', text: 'Look @Rev', text_elements: [] },
      ], document: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'file @ref', marks: [{ type: 'strong' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Look @Rev' }] },
      ] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      const second = page.getByRole('textbox', { name: 'Work with Codex 2' });
      await second.focus(); await second.press('End');
      await page.getByRole('option', { name: /Review local/ }).waitFor();
      await second.press('Enter');
      assert.equal(await second.inputValue(), 'Look Review local ');
      await second.press('Control+z'); assert.equal(await second.inputValue(), 'Look @Rev');
      await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'Look Review local ');
      assert.equal(await first.inputValue(), 'file @ref');
      const draft = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.deepEqual(draft.input[0], original.input[0]); assert.deepEqual(draft.input[1], original.input[1]);
      assert.deepEqual(draft.document.content[0].content[0].marks, [{ type: 'strong' }]);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const input = await page.evaluate(() => (window as any).fixture.state.submissions[0].input);
      assert.deepEqual(input[1], original.input[1]);
      assert.match(input[0].text, /file @ref/); assert.match(input[2].text, /\[@Review local\]\(thread:\/\/same-id\?hostId=local\)/);
      assert.equal(new TextDecoder().decode(new TextEncoder().encode(input[0].text).slice(input[0].text_elements[0].byteRange.start, input[0].text_elements[0].byteRange.end)), '@ref');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await second.waitFor(); assert.equal(await second.inputValue(), 'Look Review local ');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('an unchanged text selection cannot replace an existing reference with an agent', async () => {
      const { page, errors } = await open('chat-reference-overlap');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'Other local ', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'Other local ', text_elements: [{ byteRange: { start: 0, end: 11 }, placeholder: 'existing-reference' }] },
      ] };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, 11); element.dispatchEvent(new Event('select', { bubbles: true })); });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'without changing retained formatting or input' }).waitFor();
      const draft = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.deepEqual(draft.input, original.input); assert.equal(draft.document, undefined);
      assert.equal(await editor.inputValue(), original.text);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('plain lookup cannot insert into a different owner after navigation', async () => {
      const { page, errors } = await open('chat-plain-owner');
      const old = page.getByRole('textbox', { name: 'Work with Codex' });
      await old.fill('Old draft');
      await page.evaluate(() => { (window as any).fixture.state.hold = 'local'; });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.pending.length === 1);
      await page.evaluate(() => (window as any).fixture.render({ context: { hostId: 'ssh:other', threadId: 'thread-2', draftId: 'new', cwd: '/remote' } }));
      const next = page.getByRole('textbox', { name: 'Work with Codex' });
      await next.fill('New draft');
      await page.evaluate(() => (window as any).fixture.release());
      assert.equal(await next.inputValue(), 'New draft');
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft)), /agentMention/);
      await page.evaluate(() => (window as any).fixture.render({ context: { hostId: 'local', threadId: null, draftId: 'chat-fixture', cwd: '/workspace' } }));
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.draft.text === 'Old draft');
      assert.equal(await page.getByRole('textbox', { name: 'Work with Codex' }).inputValue(), 'Old draft');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a changed plain selection cannot be replaced by an older picker', async () => {
      const { page, errors } = await open('chat-plain-selection');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.fill('First second');
      await editor.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, 5); element.dispatchEvent(new Event('select', { bubbles: true })); });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).waitFor();
      await editor.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(6, 12); element.dispatchEvent(new Event('select', { bubbles: true })); });
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'original draft or selection changed' }).waitFor();
      assert.equal(await editor.inputValue(), 'First second');
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft)), /agentMention/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('late plain lookup cannot replace a newer draft or a revoked connection', async () => {
      const { page, errors } = await open('chat-plain-late');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.fill('Original ');
      await page.evaluate(() => { (window as any).fixture.state.hold = 'local'; });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.pending.length === 1);
      await editor.focus(); await editor.press('End'); await editor.pressSequentially('new');
      await page.evaluate(() => (window as any).fixture.release());
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'original draft or selection changed' }).waitFor();
      assert.equal(await editor.inputValue(), 'Original new');
      await page.locator('.standalone-composer__add > summary').click();
      await editor.focus(); await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).waitFor();
      await page.evaluate(() => { (window as any).fixture.state.epochs.local++; });
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'original connection revoked' }).waitFor();
      assert.equal(await editor.inputValue(), 'Original new');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('skill history and active composition survive default-input chat selection', async () => {
      const { page, errors } = await open('chat-skill-ime');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('$rev');
      await page.getByRole('option', { name: /review-skill/ }).click();
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.some((skill: any) => skill.name === 'review-skill'));
      await editor.pressSequentially(' @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor();
      await editor.press('Enter');
      await editor.press('Control+z');
      assert.equal(await editor.inputValue(), ' @Rev');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), [{ name: 'review-skill', path: '/skills/review' }]);
      await editor.press('Control+Shift+z');
      assert.match(await editor.inputValue(), /Review local/);
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).waitFor();
      await editor.focus();
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await page.getByRole('button', { name: /Other local/ }).click();
      await page.getByRole('alert').filter({ hasText: 'original draft or selection changed' }).waitFor();
      const saved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.equal((JSON.stringify(saved.document).match(/agentMention/g) ?? []).length, 1);
      assert.deepEqual(saved.skills, [{ name: 'review-skill', path: '/skills/review' }]);
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('the conversation placeholder differs from the home placeholder', async () => {
      const { page, errors } = await open('chat-placeholder');
      await page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') });
      const homeRich = await enterRich(page);
      assert.equal(await homeRich.getAttribute('aria-placeholder'), 'Do anything');
      assert.equal(await homeRich.evaluate(element => getComputedStyle(element, '::before').content), '"Do anything"');
      await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-1', draftId: 'thread-draft' } }));
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.waitFor();
      assert.equal(await editor.getAttribute('placeholder'), 'Work with Codex');
      const rich = await enterRich(page);
      assert.equal(await rich.getAttribute('aria-placeholder'), 'Work with Codex');
      assert.equal(await rich.evaluate(element => getComputedStyle(element, '::before').content), '"Work with Codex"');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('keyboard Add chat works before the empty editor has been focused', async () => {
      const { page, errors } = await open('chat-keyboard');
      const summary = page.locator('.standalone-composer__add > summary');
      await summary.focus(); await summary.press('Enter');
      const add = page.getByRole('button', { name: 'Add chat' });
      await add.focus(); await add.press('Enter');
      const result = page.getByRole('button', { name: /Other local/ });
      await result.focus(); await result.press('Enter');
      assert.equal(await page.getByRole('textbox', { name: 'Work with Codex' }).inputValue(), 'Other local ');
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /thread:\/\/first\?hostId=local/);
      assert.deepEqual(errors, []); await page.close();
    });
  } finally { await context.close(); await browser.close(); }
});
