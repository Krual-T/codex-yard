import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Locator } from 'playwright-core';

test('chat lookup uses the real composer, original editor and host-scoped list', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneComposer,draftToInput,readComposerDraft} from './src/renderer/composer/StandaloneComposer.tsx';
    import {composerDraftAtomKey,saveComposerDraftConflict,readComposerDraftVersions,updateComposerDraftVersionInRoot}
      from './src/renderer/composer/composer-draft-store.ts';
    import {updateBrowserAtoms} from './src/renderer/storage/ui-atoms.ts';
    import {createId} from './src/renderer/composer/standalone-draft.ts';
    const state={calls:[],hostCalls:[],submissions:[],snapshots:[],controller:null,grant:1,epochs:{local:1,'ssh:other':1},hold:null,pending:[],failList:false,
      plainOverride:null,listeners:new Set()};
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
        state.hostCalls.push(method);
        if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?(state.plainOverride??location.hostname.includes('plain-mode')):params.key==='composerEnterBehavior'?(location.hostname.includes('rich-blocks')?'cmdAlways':'enter'):'queue'};
        if(method==='workspace-directory-entries')return {entries:location.hostname.includes('rich-completion')
          ? [{name:'example.ts',path:'example.ts',type:'file'}] : []};
        if(method==='codex-home')return {codexHome:'/fixture'};
        if(method==='workspace-root-options')return {roots:['/workspace']};
        throw Error('unexpected host '+method);
      },subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener)},async reply(){throw Error('unexpected approval')},
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
      addVersion(draft,revision){const c=state.controller;return saveComposerDraftConflict(c.snapshot().owner,{draft,revision,prefills:[]});},
      versions(){const c=state.controller;return readComposerDraftVersions(c.snapshot().owner);},
      async commitExternal(draft){const c=state.controller,operation=c.beginExternalOperation(c.snapshot().owner);
        if(!operation)throw Error('external operation unavailable');
        try {const receipt=await operation.transaction(async(before,isCurrent)=>{
          if(!isCurrent())throw Error('owner changed before root update');
          const after=await updateBrowserAtoms(atoms=>{if(!isCurrent())throw Error('owner changed during root update');
            const result=updateComposerDraftVersionInRoot(atoms[composerDraftAtomKey],before,()=>draft,createId());
            return result.changed?{value:result.after,updates:{[composerDraftAtomKey]:result.root}}:{value:result.after};});
          return {after,value:null};});operation.finish(receipt.accepted);return receipt;
        } catch(error){operation.finish(false);throw error;}},
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
    await page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') });
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
  const editorText = (editor: Locator) => editor.evaluate(element => element instanceof HTMLTextAreaElement ? element.value : element.textContent);
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
      const mention = editor.locator('[data-mention="agent"]');
      await mention.waitFor();
      assert.equal(await editor.getAttribute('contenteditable'), 'true');
      assert.equal(await mention.getAttribute('agent-mention-path'), 'thread://same-id?hostId=local');
      assert.equal(await mention.locator('svg').count(), 1);
      assert.equal(await editorText(editor), 'Plain Review local ');
      await editor.press('Control+z');
      assert.equal(await editorText(editor), 'Plain @Rev');
      assert.equal(await mention.count(), 0);
      await editor.press('Control+z');
      assert.notEqual(await editorText(editor), 'Plain @Rev');
      await editor.press('Control+Shift+z');
      assert.equal(await editorText(editor), 'Plain @Rev');
      await editor.press('Control+Shift+z');
      assert.equal(await editorText(editor), 'Plain Review local ');
      assert.equal(await mention.count(), 1);
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

    await t.test('opening rich mode before a chat keeps earlier textarea typing in the same history', async () => {
      const { page, errors } = await open('chat-rich-before-mention');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Prior ');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await page.getByRole('toolbar', { name: 'Text formatting' }).waitFor();
      await editor.pressSequentially('@Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.press('Control+z'); assert.equal(await editorText(editor), 'Prior @Rev');
      await editor.press('Control+z'); assert.equal(await editorText(editor), 'Prior ');
      await editor.press('Control+z'); assert.equal(await editorText(editor), '');
      await editor.press('Control+Shift+z'); assert.equal(await editorText(editor), 'Prior ');
      await editor.press('Control+Shift+z'); assert.equal(await editorText(editor), 'Prior @Rev');
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('rich action after a chat keeps the original history, formatting and submitted reference', async () => {
      const { page, errors } = await open('chat-inline-format');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Typed @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await page.locator('.standalone-composer__add > summary').click();
      await page.getByRole('button', { name: 'Rich text editor' }).click();
      await page.getByRole('toolbar', { name: 'Text formatting' }).waitFor();
      await editor.evaluate(element => {
        const text = element.querySelector('p')!.firstChild!, range = document.createRange();
        range.setStart(text, 0); range.setEnd(text, 5);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      assert.equal(await editor.locator('strong').innerText(), 'Typed');
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /"type":"strong"/);
      await editor.press('Control+z'); assert.equal(await editor.locator('strong').count(), 0);
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      assert.equal(await editorText(editor), 'Typed @Rev');
      await editor.press('Control+z'); assert.notEqual(await editorText(editor), 'Typed @Rev');
      await editor.press('Control+Shift+z'); assert.equal(await editorText(editor), 'Typed @Rev');
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('strong').innerText(), 'Typed');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const submitted = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
      assert.equal(submitted.input[0].text, '**Typed** [@Review local](thread://same-id?hostId=local) ');
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await page.reload(); await page.addStyleTag({ content: readFileSync('src/renderer/composer/standalone-composer.css', 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const reloaded = page.getByRole('textbox', { name: 'Work with Codex' });
      await reloaded.locator('[data-mention="agent"]').waitFor();
      assert.equal(await reloaded.locator('strong').innerText(), 'Typed');
      assert.equal(await reloaded.locator('[data-mention="agent"]').getAttribute('agent-mention-path'), 'thread://same-id?hostId=local');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a retained legacy plain serialization keeps the same history when rich actions are enabled', async () => {
      const { page, errors } = await open('chat-inline-legacy');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      assert.equal(await page.evaluate(() => {
        const controller = (window as any).fixture.state.controller;
        return controller.update(controller.snapshot().owner, (draft: any) => ({ ...draft,
          preserved: { promptKey: 'fixture', draft: { plainTextMode: true } } }));
      }), true);
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Old @Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await editor.evaluate(element => {
        const text = element.querySelector('p')!.firstChild!, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 3);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      assert.equal(await editor.locator('strong').innerText(), 'Old');
      const saved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.equal(saved.text, 'Old [@Review local](thread://same-id?hostId=local) ');
      assert.equal(saved.preserved.draft.plainTextMode, true);
      await editor.press('Control+z'); assert.equal(await editor.locator('strong').count(), 0);
      await editor.press('Control+z'); assert.equal(await editorText(editor), 'Old @Rev');
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('strong').innerText(), 'Old');
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('multi-line text retains its original document structure through rich actions', async () => {
      const { page, errors } = await open('chat-inline-multiline');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Lead @Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await editor.press('Shift+Enter'); await editor.pressSequentially('Next');
      assert.equal(await editorText(editor), 'Lead Review local \nNext');
      const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await editor.evaluate(element => {
        const paragraph = element.querySelector('p')!, text = paragraph.lastChild!, range = document.createRange();
        range.setStart(text, text.textContent!.length - 4); range.setEnd(text, text.textContent!.length);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      assert.equal(await editor.locator('strong').innerText(), 'Next');
      const after = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      const withoutMarks = (value: unknown): any => {
        if (Array.isArray(value)) return value.map(withoutMarks).reduce((items: any[], item: any) => {
          const last = items.at(-1);
          if (last?.type === 'text' && item?.type === 'text') last.text += item.text; else items.push(item);
          return items;
        }, []);
        return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'marks')
          .map(([key, item]) => [key, withoutMarks(item)])) : value;
      };
      assert.deepEqual(withoutMarks(after), withoutMarks(before));
      await editor.press('Control+z'); assert.equal(await editor.locator('strong').count(), 0);
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('strong').innerText(), 'Next');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const text = await page.evaluate(() => (window as any).fixture.state.submissions[0].input[0].text);
      assert.match(text, /^Lead \[@Review local\]\(thread:\/\/same-id\?hostId=local\) \n\*\*Next\*\*$/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('paragraphs typed before a chat insertion retain their undo history in rich mode', async () => {
      const { page, errors } = await open('chat-inline-prior-paragraphs');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('First'); await editor.press('Shift+Enter'); await editor.pressSequentially('Second @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      const inserted = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      assert.equal(inserted.content.length, 2);
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      assert.deepEqual(await editor.locator('p').allTextContents(), ['First', 'Second Review local ']);
      await editor.press('Control+z');
      assert.deepEqual(await editor.locator('p').allTextContents(), ['First', 'Second @Rev']);
      await editor.press('Control+z');
      assert.notDeepEqual(await editor.locator('p').allTextContents(), ['First', 'Second @Rev']);
      await editor.press('Control+Shift+z');
      assert.deepEqual(await editor.locator('p').allTextContents(), ['First', 'Second @Rev']);
      await editor.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document), inserted);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a skill selected before a chat survives rich activation and follows the same history', async () => {
      const { page, errors } = await open('chat-inline-prior-skill');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('$rev'); await page.getByRole('option', { name: /review-skill/ }).click();
      await editor.pressSequentially(' @Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), [{ name: 'review-skill', path: '/skills/review' }]);
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      await editor.press('Control+z');
      await editor.press('Control+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), []);
      await editor.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), [{ name: 'review-skill', path: '/skills/review' }]);
      await editor.press('Control+Shift+z'); await editor.press('Control+Shift+z');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /"type":"skill"/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('rich block input and the earlier chat insertion share one undo and redo history', async () => {
      const { page, errors } = await open('chat-inline-rich-blocks');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Before @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('- Item');
      await editor.locator('ul li').waitFor();
      assert.equal(await editor.locator('ul li').innerText(), 'Item');
      const completed = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      assert.equal(completed.content[1].type, 'list');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      let undos = 0;
      while (await editor.locator('[data-mention="agent"]').count() && undos++ < 8) await editor.press('Control+z');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      assert.equal(await editorText(editor), 'Before @Rev');
      for (let index = 0; index < undos; index++) await editor.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document), completed);
      assert.equal(await editor.locator('ul li').innerText(), 'Item');
      await editor.press('End'); await editor.pressSequentially(' @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      assert.equal(await editor.locator('ul li [data-mention="agent"]').count(), 1);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0].input[0].text);
      assert.match(sent, /\[@Review local\]\(thread:\/\/same-id\?hostId=local\)/);
      assert.match(sent, /- Item/);
      await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.locator('[contenteditable="true"] ul li').waitFor();
      assert.equal(await page.locator('[contenteditable="true"] [data-mention="agent"]').count(), 2);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('rich structured clipboard remains editable beside the original chat atom', async () => {
      const { page, errors } = await open('chat-inline-paste-blocks');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      const reference = await open('chat-existing-rich-paste-blocks');
      await reference.page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      assert.equal(await reference.page.evaluate(() => {
        const controller = (window as any).fixture.state.controller;
        return controller.update(controller.snapshot().owner, (draft: any) => ({ ...draft,
          document: { type: 'doc', content: [{ type: 'paragraph' }] } }));
      }), true);
      const referenceEditor = reference.page.locator('[contenteditable="true"][role="textbox"]');
      await referenceEditor.waitFor(); await referenceEditor.focus();
      assert.equal(await referenceEditor.getAttribute('data-composer-input-index'), null);
      await editor.pressSequentially('Before @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await referenceEditor.pressSequentially('Before @Rev');
      await reference.page.getByRole('option', { name: /Review local/ }).waitFor(); await referenceEditor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      const pasteBlocks = (target: Locator, lead: boolean) => target.evaluate((element, includeLead) => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!); range.collapse(false);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); clipboard.setData('text/html', (includeLead ? '<p>Lead</p>' : '') + '<blockquote><p>Quoted</p></blockquote><ul><li><p>Item</p></li></ul>');
        clipboard.setData('text/plain', (includeLead ? 'Lead\n' : '') + 'Quoted\nItem');
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      }, lead);
      await pasteBlocks(editor, false); await pasteBlocks(referenceEditor, false);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document),
        await reference.page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document));
      assert.equal(await editor.locator('ul li').innerText(), 'Item');
      await editor.press('Control+z'); assert.equal(await editor.locator('ul').count(), 0);
      await pasteBlocks(editor, true);
      assert.equal(await editor.locator('blockquote').innerText(), 'Quoted');
      assert.equal(await editor.locator('ul li').innerText(), 'Item');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      const pasted = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      await editor.press('Control+z'); assert.equal(await editor.locator('blockquote').count(), 0);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document), pasted);
      assert.deepEqual(errors, []); assert.deepEqual(reference.errors, []); await reference.page.close(); await page.close();
    });

    await t.test('rich file, skill and autolink actions keep their real nodes after a chat insertion', async () => {
      const { page, errors } = await open('chat-inline-rich-completion');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Before @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await editor.press('End'); await editor.pressSequentially('@exam');
      await page.getByRole('option', { name: /example\.ts/ }).click();
      const file = editor.locator('[data-mention="file"]');
      assert.equal(await file.count(), 1);
      assert.match(await file.getAttribute('data-composer-attrs') ?? '', /\/workspace\/example\.ts/);
      await editor.pressSequentially('$rev');
      await page.getByRole('option', { name: /review-skill/ }).click();
      assert.equal(await editor.locator('[data-mention="skill"]').count(), 1);
      await editor.pressSequentially('https://example.test ');
      assert.equal(await editor.locator('[data-composer-autolink]').innerText(), 'https://example.test');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0].input);
      assert.match(JSON.stringify(sent), /thread:\/\/same-id\?hostId=local/);
      assert.match(JSON.stringify(sent), /\/workspace\/example\.ts/);
      assert.ok(sent.some((item: any) => item.type === 'skill' && item.path === '/skills/review'));
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('an external plain preference change follows composition without replacing the history', async () => {
      const { page, errors } = await open('chat-inline-rich-blocks-preference-change');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Before @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await page.getByRole('toolbar', { name: 'Text formatting' }).waitFor();
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await page.evaluate(() => {
        const state = (window as any).fixture.state; state.plainOverride = true;
        for (const listener of state.listeners) listener({ type: 'settings-changed', keys: ['composerPlainTextMode'] });
      });
      await page.getByRole('toolbar', { name: 'Text formatting' }).waitFor({ state: 'hidden' });
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('- plain');
      assert.equal(await editor.locator('ul').count(), 0);
      assert.equal(await editor.locator('p').last().innerText(), '- plain');
      await page.evaluate(() => {
        const state = (window as any).fixture.state; state.plainOverride = false;
        for (const listener of state.listeners) listener({ type: 'settings-changed', keys: ['composerPlainTextMode'] });
      });
      await page.getByRole('toolbar', { name: 'Text formatting' }).waitFor();
      await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('- rich');
      assert.equal(await editor.locator('ul li').innerText(), 'rich');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('changing owners after rich activation does not carry the previous editor state', async () => {
      const { page, errors } = await open('chat-inline-rich-owner');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Old @Rev');
      await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await page.waitForFunction(async () => JSON.stringify(await (window as any).fixture.read()).includes('thread://same-id?hostId=local'));
      await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'other', draftId: 'other' } }));
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner?.draftId === 'other');
      assert.equal(await editorText(editor), '');
      await editor.pressSequentially('New owner');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      await page.evaluate(() => (window as any).fixture.render({ context: { threadId: null, draftId: 'chat-fixture' } }));
      await page.locator('[contenteditable="true"] [data-mention="agent"]').waitFor();
      assert.match(await editorText(editor), /Old Review local/);
      assert.doesNotMatch(await editorText(editor), /New owner/);
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
      assert.equal(await editorText(editor), 'Before Review remote after');
      assert.equal(await editor.locator('[data-mention="agent"]').getAttribute('agent-mention-path'), 'thread://same-id?hostId=ssh%3Aother');
      await page.locator('.standalone-composer__add > summary').click();
      assert.equal(await page.getByRole('button', { name: 'Rich text editor' }).count(), 0);
      await page.locator('.standalone-composer__add > summary').click();
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      const draft = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.match(JSON.stringify(draft.document), /thread:\/\/same-id\?hostId=ssh%3Aother/);
      await editor.press('Control+z'); assert.equal(await editorText(editor), 'Before TARGET after');
      await editor.press('Control+Shift+z'); assert.equal(await editorText(editor), 'Before Review remote after');
      await editor.press('End');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: 'More chats' }).click();
      await page.getByRole('button', { name: /Review local/ }).click();
      const both = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      const paths = both.content[0].content.filter((node: any) => node.type === 'agentMention').map((node: any) => node.attrs.path);
      assert.deepEqual(paths, ['thread://same-id?hostId=ssh%3Aother', 'thread://same-id?hostId=local']);
      await editor.pressSequentially('@Rev');
      assert.equal(await editorText(editor), 'Before Review remote afterReview local @Rev');
      assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), 'Before Review remote afterReview local @Rev');
      assert.ok(await editor.getAttribute('aria-controls'), JSON.stringify(await editor.evaluate(element => ({
        text: element.textContent, focused: document.activeElement === element, selection: document.getSelection()?.focusOffset,
        selectionText: document.getSelection()?.focusNode?.textContent,
      }))));
      await page.getByRole('option', { name: /Review local/ }).waitFor();
      await editor.press('Enter');
      const withCompletion = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document);
      assert.equal(withCompletion.content[0].content.filter((node: any) => node.type === 'agentMention').length, 3);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.submissions[0].input)), /thread:\/\/same-id\?hostId=ssh%3Aother/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('the inline agent is atomic and deleting it can be undone', async () => {
      const { page, errors } = await open('chat-atom-edit');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).click();
      const mention = editor.locator('[data-mention="agent"]');
      assert.equal(await editorText(editor), 'Other local ');
      assert.equal(await mention.getAttribute('contenteditable'), 'false');
      await editor.evaluate(element => {
        (element as HTMLElement).focus();
        const node = element.querySelector('[data-mention="agent"]')!;
        const selection = document.getSelection()!, range = document.createRange();
        range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await editor.press('Backspace');
      assert.equal(await editorText(editor), ' ');
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /agentMention/);
      await editor.press('Control+z');
      assert.equal(await editorText(editor), 'Other local ');
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /agentMention/);
      await editor.press('Control+Shift+z'); assert.equal(await editorText(editor), ' ');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('copying and pasting the inline chat preserves its node and original host', async () => {
      const { page, errors } = await open('chat-inline-clipboard-plain-mode');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByLabel('Chat host').selectOption('ssh:other'); await page.getByRole('button', { name: /Review remote/ }).click();
      const copied = await editor.evaluate(element => {
        const range = document.createRange(); range.selectNode(element.querySelector('[data-mention="agent"]')!);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }));
        return { html: clipboard.getData('text/html'), text: clipboard.getData('text/plain') };
      });
      assert.match(copied.html, /data-mention="agent"/); assert.match(copied.text, /@Review remote/);
      await editor.evaluate((element, data) => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!); range.collapse(false);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); clipboard.setData('text/html', data.html); clipboard.setData('text/plain', data.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      }, copied);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      assert.deepEqual(await editor.locator('[data-mention="agent"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('agent-mention-path'))),
        ['thread://same-id?hostId=ssh%3Aother', 'thread://same-id?hostId=ssh%3Aother']);
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      assert.equal((JSON.stringify(await page.evaluate(() => (window as any).fixture.state.submissions[0].input)).match(/thread:\/\/same-id\?hostId=ssh%3Aother/g) ?? []).length, 2);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('rich action keeps link creation, editing and marked paste on the same node history', async () => {
      const { page, errors } = await open('chat-inline-link');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Link @Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await editor.evaluate(element => {
        const text = element.querySelector('p')!.firstChild!, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 4);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.getByRole('button', { name: 'Link', exact: true }).click();
      await page.getByLabel('Link address').fill('https://example.test/one'); await page.getByRole('button', { name: 'Apply' }).click();
      const link = editor.locator('a'); assert.equal(await link.getAttribute('href'), 'https://example.test/one');
      await link.click(); const dialog = page.getByRole('dialog', { name: 'Link' }); await dialog.getByRole('button', { name: 'Edit link URL' }).click();
      await dialog.getByLabel('Link address').fill('https://example.test/two'); await dialog.getByRole('button', { name: 'Save link URL' }).click();
      assert.equal(await link.getAttribute('href'), 'https://example.test/two');
      await editor.press('Control+z'); assert.equal(await link.getAttribute('href'), 'https://example.test/one');
      await editor.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!); range.collapse(false);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); clipboard.setData('text/html', '<strong>pasted</strong>'); clipboard.setData('text/plain', 'pasted');
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      });
      assert.equal(await editor.locator('strong').innerText(), 'pasted');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const text = await page.evaluate(() => (window as any).fixture.state.submissions[0].input[0].text);
      assert.match(text, /\[Link\]\(https:\/\/example\.test\/one\)/);
      assert.match(text, /\[@Review local\]\(thread:\/\/same-id\?hostId=local\)/);
      assert.match(text, /\*\*pasted\*\*/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a same-text external link revision is displayed before editing and sending', async () => {
      const { page, errors } = await open('chat-inline-new-source');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Link @Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      await editor.evaluate(element => {
        const text = element.querySelector('p')!.firstChild!, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 4);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.getByRole('button', { name: 'Link', exact: true }).click();
      await page.getByLabel('Link address').fill('https://example.test/source'); await page.getByRole('button', { name: 'Apply' }).click();
      const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text);
      assert.equal(await page.evaluate(() => {
        const controller = (window as any).fixture.state.controller;
        return controller.update(controller.snapshot().owner, (draft: any) => {
          const next = structuredClone(draft), link = next.document.content[0].content[0].marks.find((mark: any) => mark.type === 'link');
          link.attrs.literalMarkdownOccurrenceId = 99; return next;
        });
      }), true);
      await page.waitForFunction(() => {
        const link = document.querySelector('[contenteditable="true"] a[data-composer-attrs]');
        return !!link && JSON.parse(link.getAttribute('data-composer-attrs') || '{}').literalMarkdownOccurrenceId === 99;
      });
      await editor.press('End'); await editor.pressSequentially('X');
      const after = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.equal(after.text, before + 'X'); assert.equal(after.document.content[0].content[0].marks[0].attrs.literalMarkdownOccurrenceId, 99);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
      assert.equal(sent.draft.text, after.text); assert.match(sent.input[0].text, /source\).*X$/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('choosing another same-owner document updates the editor and submitted version', async () => {
      const { page, errors } = await open('chat-inline-select-version');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Original @Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const old = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      const replacement = { text: '**Replacement**', images: [], files: [], references: [], skills: [],
        document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Replacement', marks: [{ type: 'strong' }] }] }] } };
      await page.evaluate(value => (window as any).fixture.addVersion(value, 'fixture-alternate'), replacement);
      await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
      await page.getByRole('button', { name: '**Replacement**', exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().revision === 'fixture-alternate');
      await page.locator('[contenteditable="true"] strong').filter({ hasText: 'Replacement' }).waitFor();
      assert.equal(await editorText(editor), 'Replacement');
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.ok(versions.versions.some((version: any) => JSON.stringify(version.draft) === JSON.stringify(old)));
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
      assert.equal(sent.draft.text, replacement.text); assert.equal(sent.input[0].text, replacement.text);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('an externally committed document replaces the visible version before send', async () => {
      const { page, errors } = await open('chat-inline-committed-version');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Original @Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      const replacement = { text: '**Committed**', images: [], files: [], references: [], skills: [],
        document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Committed', marks: [{ type: 'strong' }] }] }] } };
      const receipt = await page.evaluate(value => (window as any).fixture.commitExternal(value), replacement);
      assert.equal(receipt.accepted, true);
      await page.locator('[contenteditable="true"] strong').filter({ hasText: 'Committed' }).waitFor();
      assert.equal(await editorText(editor), 'Committed');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0]);
      assert.deepEqual(sent.draft.document, replacement.document); assert.equal(sent.input[0].text, replacement.text);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a slow textarea composition is one undo event and blocks another draft adoption', async () => {
      const { page, errors } = await open('chat-slow-composition');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('before ');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await page.evaluate(() => (window as any).fixture.addVersion({ text: 'Other version', images: [], files: [], references: [], skills: [] }, 'ime-other'));
      await page.locator('summary').filter({ hasText: 'Select draft version' }).waitFor();
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      const input = async (value: string, time: number) => editor.evaluate((element, data) => {
        const originalNow = Date.now; Date.now = () => data.time;
        try {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, data.value);
          element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: data.value, isComposing: true }));
        } finally { Date.now = originalNow; }
      }, { value, time });
      await input('before に', 10_000); await input('before 日本', 11_000);
      assert.equal(await editor.inputValue(), 'before 日本');
      assert.equal(await page.evaluate(() => {
        const c = (window as any).fixture.state.controller;
        return c.update(c.snapshot().owner, (draft: any) => ({ ...draft, text: 'other' }));
      }), false);
      await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
      await page.getByRole('button', { name: 'Other version', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '请先完成输入法输入' }).waitFor();
      assert.equal(await editor.inputValue(), 'before 日本');
      assert.notEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().revision), 'ime-other');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
      await editor.evaluate(async element => {
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'before ');
      await editor.press('Control+Shift+z'); assert.equal(await editor.inputValue(), 'before 日本');
      await editor.pressSequentially('!'); await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'before 日本');
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.ok(versions.versions.some((version: any) => version.revision === 'ime-other' && version.draft.text === 'Other version'));
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('skill completion after an agent remains in the same undo history', async () => {
      const { page, errors } = await open('chat-agent-then-skill');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Add chat' }).click();
      await page.getByRole('button', { name: /Other local/ }).click();
      await editor.pressSequentially('$rev');
      assert.equal(await editorText(editor), 'Other local $rev');
      assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), 'Other local $rev');
      assert.ok(await editor.getAttribute('aria-controls'), JSON.stringify(await editor.evaluate(element => ({
        text: element.textContent, focused: document.activeElement === element, selection: document.getSelection()?.focusOffset,
        selectionText: document.getSelection()?.focusNode?.textContent,
      }))));
      await page.getByRole('option', { name: /review-skill/ }).click();
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.skills.some((skill: any) => skill.name === 'review-skill'));
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /thread:\/\/first\?hostId=local/);
      await editor.press('Control+z');
      assert.equal(await editorText(editor), 'Other local $rev');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), []);
      await editor.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), [{ name: 'review-skill', path: '/skills/review' }]);
      const copied = await editor.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }));
        return { html: clipboard.getData('text/html'), text: clipboard.getData('text/plain') };
      });
      assert.doesNotMatch(copied.html, /data-text-skill/); assert.match(copied.html, /data-mention="agent"/);
      await editor.evaluate((element, data) => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!); range.collapse(false);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const clipboard = new DataTransfer(); clipboard.setData('text/html', data.html); clipboard.setData('text/plain', data.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      }, copied);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
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
        { type: 'paragraph', content: [{ type: 'text', text: 'Look @Rev', marks: [{ type: 'em' }] }] },
      ] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      const second = page.getByRole('textbox', { name: 'Work with Codex 2' });
      await second.focus(); await second.press('End');
      await page.getByRole('option', { name: /Review local/ }).waitFor();
      await second.press('Enter');
      assert.equal(await editorText(second), 'Look Review local ');
      assert.equal(await second.locator('[data-mention="agent"]').count(), 1);
      assert.equal(await second.locator('em [data-mention="agent"]').count(), 1);
      await second.press('Control+z'); assert.equal(await editorText(second), 'Look @Rev');
      await second.press('Control+Shift+z'); assert.equal(await editorText(second), 'Look Review local ');
      assert.equal(await second.locator('em [data-mention="agent"]').count(), 1);
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
      await second.waitFor(); assert.equal(await editorText(second), 'Look Review local ');
      assert.equal(await second.locator('[data-mention="agent"]').count(), 1);
      assert.equal(await second.locator('em [data-mention="agent"]').count(), 1);
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
      assert.equal(await editorText(editor), ' @Rev');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), [{ name: 'review-skill', path: '/skills/review' }]);
      await editor.press('Control+Shift+z');
      assert.match(await editorText(editor) ?? '', /Review local/);
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
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      assert.equal(await editorText(editor), 'Other local ');
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.document)), /thread:\/\/first\?hostId=local/);
      assert.deepEqual(errors, []); await page.close();
    });
  } finally { await context.close(); await browser.close(); }
});
