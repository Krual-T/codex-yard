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
    import {flushSync} from 'react-dom';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneComposer,draftToInput,readComposerDraft} from './src/renderer/composer/StandaloneComposer.tsx';
    import {StandaloneStructuredInputEditor} from './src/renderer/composer/StandaloneRichEditor.tsx';
    import {composerDraftAtomKey,saveComposerDraftConflict,readComposerDraftVersions,updateComposerDraftVersionInRoot}
      from './src/renderer/composer/composer-draft-store.ts';
    import {updateBrowserAtoms} from './src/renderer/storage/ui-atoms.ts';
    import {createId} from './src/renderer/composer/standalone-draft.ts';
    import {createSummaryOutputPrefill} from './src/renderer/app/summary-output-prefill.ts';
    import {readRichDocument,serializeRichDocument} from './src/renderer/composer/rich-document.ts';
    const state={calls:[],hostCalls:[],submissions:[],snapshots:[],controller:null,grant:1,epochs:{local:1,'ssh:other':1},hold:null,pending:[],failList:false,
      plainOverride:null,listeners:new Set(),appendPort:null,appendOperation:null,appendChecks:0,revokeAt:0,cancelAt:0};
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
        if(method==='skills/list')return {data:[{skills:[{enabled:true,name:'review-skill',path:'/skills/review',description:'Review'},
          {enabled:true,name:'audit-skill',path:'/skills/audit',description:'Audit'}]}]};
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
      onDraftController(controller){state.controller=controller;},onDraftChange(snapshot){state.snapshots.push(structuredClone(snapshot));
        const pending=state.precommit;if(!pending || pending.revision!==snapshot.revision)return;
        state.precommit=null;const element=document.querySelector('[data-composer-input-index="'+(pending.index??0)+'"]');
        element.focus();if(element instanceof HTMLTextAreaElement)element.setSelectionRange(element.value.length,element.value.length);
        const before=element instanceof HTMLTextAreaElement?element.value:element.textContent;
        if(pending.action==='local-redo'){
          const remove=document.querySelector('button[aria-label="Remove file local.txt"]');
          if(!remove)throw Error('fixture attachment control missing');remove.click();
        }
        if(pending.action==='compose'){
          element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,element.value+'Q');
        }
        const dispatched=pending.action==='compose'
          ? element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'Q',isComposing:true}))
          : pending.action==='view-undo'
          ? element.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'z',ctrlKey:true}))
          : pending.action==='undo'||pending.action==='redo'||pending.action==='local-redo'
          ? element.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:pending.action==='undo'?'historyUndo':'historyRedo'}))
          : document.execCommand('insertText',false,'Q');
        state.precommitResult={before,dispatched,after:element instanceof HTMLTextAreaElement?element.value:element.textContent,snapshot:state.controller.snapshot()};},
      onPromptAppendPort(port){state.appendPort=port;},
      async onSubmit(draft,options,action,description,assertAuthority){assertAuthority?.();state.submissions.push({draft:structuredClone(draft),
        input:draftToInput(draft,props.context.hostId,{plainTextMode:description?.documentPlainTextMode}),action});throw Error('fixture send declined');},async onInterrupt(){} };
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};
      root.render(React.createElement(I18nProvider,{locale:'en-US'},React.createElement(StandaloneComposer,props)));},
      read(){const {hostId,threadId,draftId}=props.context;return readComposerDraft({hostId,threadId,draftId});},
      addVersion(draft,revision){const c=state.controller;return saveComposerDraftConflict(c.snapshot().owner,{draft,revision,prefills:[]});},
      versions(){const c=state.controller;return readComposerDraftVersions(c.snapshot().owner);},
      replaceVersion(draft){const before=state.controller.snapshot();return updateBrowserAtoms(atoms=>{
        const result=updateComposerDraftVersionInRoot(atoms[composerDraftAtomKey],before,()=>draft,createId());
        return result.changed?{value:result.after,updates:{[composerDraftAtomKey]:result.root}}:{value:result.after};});},
      mountSegmentProbe(draft){const host=document.createElement('div');document.body.append(host);
        const directRoot=createRoot(host),ref=React.createRef();let current=draft;
        const render=()=>flushSync(()=>directRoot.render(React.createElement(I18nProvider,{locale:'en-US'},
          React.createElement(StandaloneStructuredInputEditor,{ref,draft:current,currentDraft:()=>current,onEdit:()=>false,onKeyDown:()=>false}))));
        render();state.segmentProbe={set(value){current=value;},render,
          prepare(){return !!ref.current.preparePromptAppend(current.document,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'append'}]}]},2,current);},
          close(){directRoot.unmount();host.remove();}};},
      seedRich(document){const c=state.controller,parsed=readRichDocument(document);
        if(!parsed)throw Error('invalid fixture document');
        return c.update(c.snapshot().owner,draft=>({...draft,text:serializeRichDocument(parsed),document}));},
      beginAppend(revokeAt=0,cancelAt=0){const c=state.controller,owner=c.snapshot().owner,grant=state.grant;
        state.appendChecks=0;state.revokeAt=revokeAt;state.cancelAt=cancelAt;
        state.appendOperation=state.appendPort.begin(owner,()=>{state.appendChecks++;
          if(state.cancelAt && state.appendChecks===state.cancelAt)state.appendOperation?.cancel();
          if(state.grant!==grant || state.revokeAt && state.appendChecks>=state.revokeAt)throw Error('fixture original authority revoked');});
        return !!state.appendOperation;},
      append(kind='document',prefillId){const c=props.context;
        return state.appendOperation.append(createSummaryOutputPrefill({kind,context:{hostId:c.hostId,cwd:c.cwd}}).document,prefillId);},
      appendText(text,prefillId){return state.appendOperation.append({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]},prefillId);},
      cancelAppend(){state.appendOperation.cancel();},
      async holdAtoms(){const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('codex-yard.ui-atoms.v1',1);
          req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
        const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
        const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve()}});
        await new Promise((resolve,reject)=>{let first=true;const loop=()=>{const req=store.get('native-atoms');
          req.onerror=()=>reject(req.error);req.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve()}}};loop()});
        this.releaseAtoms=()=>{released=true;return done};},
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

    await t.test('pasting a copied chat into a new empty owner retains the original host and history', async () => {
      const source = await open('chat-copy-source');
      const sourceEditor = source.page.getByRole('textbox', { name: 'Work with Codex' });
      await source.page.locator('.standalone-composer__add > summary').click();
      await source.page.getByRole('button', { name: 'Add chat' }).click();
      await source.page.getByLabel('Chat host').selectOption('ssh:other');
      await source.page.getByRole('button', { name: /Review remote/ }).click();
      const copied = await sourceEditor.evaluate(element => {
        const range = document.createRange(); range.selectNode(element.querySelector('[data-mention="agent"]')!);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return { html: data.getData('text/html'), text: data.getData('text/plain') };
      });
      const target = await open('chat-copy-empty-target');
      const editor = target.page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.focus();
      await editor.evaluate((element, copied) => {
        const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, copied);
      await editor.locator('[data-mention="agent"]').waitFor();
      assert.equal(await editor.locator('[data-mention="agent"]').getAttribute('agent-mention-path'), 'thread://same-id?hostId=ssh%3Aother');
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 0);
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await target.page.getByRole('button', { name: 'Send', exact: true }).click();
      await target.page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      assert.match(JSON.stringify(await target.page.evaluate(() => (window as any).fixture.state.submissions[0].input)), /thread:\/\/same-id\?hostId=ssh%3Aother/);
      assert.deepEqual(target.errors, []); assert.deepEqual(source.errors, []);
      await target.page.close(); await source.page.close();
    });

    await t.test('rich to plain preference keeps copied chat identity on paste', async () => {
      const { page, errors } = await open('chat-rich-plain-copy');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('@Rev'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await editor.press('Enter');
      await page.locator('.standalone-composer__add > summary').click(); await page.getByRole('button', { name: 'Rich text editor' }).click();
      const copied = await editor.evaluate(element => {
        const range = document.createRange(); range.selectNode(element.querySelector('[data-mention="agent"]')!);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return { html: data.getData('text/html'), text: data.getData('text/plain') };
      });
      await page.evaluate(() => { const state = (window as any).fixture.state; state.plainOverride = true;
        for (const listener of state.listeners) listener({ type: 'settings-changed', keys: ['composerPlainTextMode'] }); });
      await page.getByRole('toolbar', { name: 'Text formatting' }).waitFor({ state: 'hidden' });
      await editor.evaluate((element, copied) => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!); range.collapse(false);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, copied);
      assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 1);
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="agent"]').count(), 2);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      assert.equal((JSON.stringify(await page.evaluate(() => (window as any).fixture.state.submissions[0].input)).match(/thread:\/\/same-id\?hostId=local/g) ?? []).length, 2);
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

    await t.test('C review segmented version adoption discards only the replaced document history', async () => {
      const { page, errors } = await open('c-review-segment-version');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'A\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'A', text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
        { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Tail', marks: [{ type: 'em' }] }] },
      ] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      await first.focus(); await first.press('End'); await first.pressSequentially('B');
      assert.equal(await first.inputValue(), 'AB');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller;
        return c.update(c.snapshot().owner, (draft: any) => ({ ...draft, references: [{ id: 'ref', text: 'Retained context' }] })); }), true);
      await first.press('Control+z'); assert.equal(await first.inputValue(), 'A');
      await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'AB');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const alternate = await page.evaluate(() => {
        const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
        draft.document.content[0].content[0].marks = [{ type: 'strong' }]; return draft;
      });
      await page.evaluate(value => (window as any).fixture.addVersion(value, 'c-review-segment-bold'), alternate);
      await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
      await page.getByRole('button', { name: 'AB Tail', exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().revision === 'c-review-segment-bold');
      await first.focus(); await first.press('Control+z');
      assert.equal(await first.inputValue(), 'AB');
      await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'AB');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const saved = await page.evaluate(() => (window as any).fixture.versions());
      const chosen = saved.versions.find((version: any) => version.revision === 'c-review-segment-bold');
      assert.deepEqual(chosen.draft, alternate);
      await first.press('End'); await first.pressSequentially('C');
      await first.press('Control+z'); assert.equal(await first.inputValue(), 'AB');
      await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'ABC');
      assert.deepEqual(errors, []); await page.close();
    });

    for (const action of ['undo', 'type', 'type-marks', 'type-different', 'type-different-plain'] as const) await t.test(`C precommit segmented ${action} uses the accepted document`, async () => {
      const { page, errors } = await open(`c-precommit-${action}`);
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'A\nB\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'A\nB', text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
        { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] } };
      const { document: _document, ...withoutDocument } = original;
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); },
        action === 'type-different-plain' ? withoutDocument : original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      const second = page.getByRole('textbox', { name: 'Work with Codex 2' });
      await second.focus(); await second.press('End'); await second.pressSequentially('Y');
      await first.focus(); await first.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
      await first.pressSequentially('X');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const alternate = await page.evaluate(action => {
        const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
        const changedText = action.startsWith('type-different') ? 'BXY' : 'BX';
        draft.input[0].text = 'A\n' + changedText;
        draft.text = 'A\n' + changedText + '\nTailY';
        if (draft.document) draft.document.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'A', ...(action === 'type-marks' ? { marks: [{ type: 'strong' }] } : {}) }, { type: 'hard_break' },
          { type: 'text', text: changedText }] }, { type: 'paragraph', content: [{ type: 'text', text: 'TailY' }] }];
        return draft;
      }, action);
      const revision = `c-precommit-${action}`;
      await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: alternate, revision });
      await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
      await page.evaluate(({ action, revision }) => { (window as any).fixture.state.precommit = { action, revision }; }, { action, revision });
      await page.getByRole('button', { name: action.startsWith('type-different') ? 'A BXY TailY' : 'A BX TailY', exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.precommitResult);
      const observed = await page.evaluate(() => (window as any).fixture.state.precommitResult);
      assert.equal(observed.before, 'A\nBX');
      assert.equal(observed.dispatched, action !== 'undo');
      if (action.startsWith('type-different')) {
        assert.equal(observed.snapshot.draft.input[0].text, 'A\nBXQ');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), false);
        await page.getByRole('button', { name: 'Save as a separate draft' }).click();
        await page.getByRole('button', { name: 'Save as a separate draft' }).waitFor({ state: 'hidden' });
      }
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      const saved = versions.versions.find((version: any) => version.revision === current.revision);
      t.diagnostic(JSON.stringify({ action, revision: current.revision, input: current.draft.input[0].text,
        storedInput: saved?.draft.input[0].text, firstParagraph: current.draft.document?.content[0] }));
      if (action === 'undo') {
        assert.equal(observed.snapshot.revision, revision);
        assert.deepEqual(observed.snapshot.draft, alternate);
        assert.equal(current.revision, revision);
        assert.deepEqual(current.draft, alternate);
        assert.equal(await first.inputValue(), 'A\nBX');
      } else {
        assert.equal(current.draft.input[0].text, 'A\nBXQ');
        if (!action.startsWith('type-different')) assert.equal(current.draft.document.content[0].content[1].type, 'hard_break');
        if (action === 'type-marks') assert.deepEqual(current.draft.document.content[0].content[0].marks, [{ type: 'strong' }]);
        assert.equal(await first.inputValue(), 'A\nBXQ');
        if (!action.startsWith('type-different')) {
          await first.press('Control+z'); assert.equal(await first.inputValue(), 'A\nBX');
          await first.press('Control+z'); assert.equal(await first.inputValue(), 'A\nBX');
          await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'A\nBXQ');
        } else assert.deepEqual(versions.versions.find((version: any) => version.revision === revision)?.draft, alternate);
      }
      assert.deepEqual(saved?.draft, current.draft);
      assert.deepEqual(current.draft.input[1], original.input[1]);
      await second.focus(); await second.press('Control+z'); assert.equal(await second.inputValue(), 'Tail');
      await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'TailY');
      assert.deepEqual(errors, []); await page.close();
    });

    for (const scenario of ['removed-structure', 'removed-same', 'retained-same', 'mixed-same'] as const) await t.test(`G known precommit skill ownership ${scenario}`, async () => {
      const { page, errors } = await open(`g-known-skill-${scenario}`);
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'A\nB\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'A\nB', text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
        { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      const second = page.getByRole('textbox', { name: 'Work with Codex 2' });
      await second.focus(); await second.press('End'); await second.pressSequentially('Y');
      await second.press('Control+z'); assert.equal(await second.inputValue(), 'Tail');
      await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'TailY');
      await first.focus(); await first.press('End'); await first.pressSequentially(' $rev');
      await page.getByRole('option', { name: /review-skill/ }).click();
      if (scenario === 'mixed-same') {
        await first.focus(); await first.press('End'); await first.pressSequentially(' $aud');
        await page.getByRole('option', { name: /audit-skill/ }).click();
      }
      const originalSkills = [{ name: 'review-skill', path: '/skills/review' },
        ...(scenario === 'mixed-same' ? [{ name: 'audit-skill', path: '/skills/audit' }] : [])];
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), originalSkills);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const alternate = await page.evaluate(scenario => {
        const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
        if (scenario !== 'retained-same') draft.skills = scenario === 'mixed-same'
          ? draft.skills.filter((skill: any) => skill.name === 'audit-skill') : [];
        if (scenario === 'removed-structure') {
          const [a, b, tail] = draft.document.content;
          draft.document.content = [{ type: 'paragraph', content: [...a.content, { type: 'hard_break' }, ...b.content] }, tail];
        }
        return draft;
      }, scenario);
      const revision = `g-known-skill-${scenario}`;
      await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: alternate, revision });
      await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
      await page.evaluate(revision => { (window as any).fixture.state.precommit = { action: 'type', revision, index: 2 }; }, revision);
      await page.getByRole('button', { name: alternate.text.replace(/\s+/g, ' '), exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.precommitResult);
      const observed = await page.evaluate(() => (window as any).fixture.state.precommitResult);
      assert.equal(observed.before, 'TailY');
      assert.equal(observed.snapshot.draft.input[2].text, 'TailYQ');
      assert.deepEqual(observed.snapshot.draft.skills, alternate.skills);
      assert.deepEqual(observed.snapshot.draft.input[1], original.input[1]);
      assert.deepEqual(observed.snapshot.draft.document.content[0], alternate.document.content[0]);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      const expected = structuredClone(alternate);
      expected.text += 'Q'; expected.input[2].text += 'Q';
      expected.document.content.at(-1).content[0].text += 'Q';
      assert.deepEqual(current.draft, expected);
      assert.deepEqual(versions.versions.find((version: any) => version.revision === current.revision)?.draft, expected);
      await second.focus(); await second.press('Control+z'); assert.equal(await second.inputValue(), 'TailY');
      await second.press('Control+z'); assert.equal(await second.inputValue(), 'Tail');
      await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'TailY');
      await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'TailYQ');
      await first.focus(); await first.press('Control+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills),
        scenario === 'retained-same' ? [] : alternate.skills);
      await first.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), alternate.skills);
      assert.deepEqual(errors, []); await page.close();
    });

    for (const scenario of ['removed-immediate', 'removed-deep', 'removed-after-layout', 'retained', 'other-removed',
      'same-empty-immediate', 'same-empty-after-layout', 'same-empty-external', 'same-empty-refresh', 'same-empty-followed-local'] as const) await t.test(`G redo-only skill ownership ${scenario}`, async () => {
      const retained = scenario === 'retained' || scenario === 'other-removed';
      const external = scenario === 'same-empty-external';
      const refresh = scenario === 'same-empty-refresh';
      const followedLocal = scenario === 'same-empty-followed-local';
      const sameEmpty = scenario === 'same-empty-immediate' || scenario === 'same-empty-after-layout' || external || refresh || followedLocal;
      const afterLayout = scenario === 'removed-after-layout' || scenario === 'same-empty-after-layout' || external || refresh;
      const { page, errors } = await open(`g-redo-skill-${scenario}`);
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'First\nSecond\nThird', images: [], files: followedLocal ? [{ name: 'local.txt', path: '/workspace/local.txt' }] : [], references: [], skills: [], input: [
        { type: 'text', text: 'First', text_elements: [] }, { type: 'image', fileId: 'one', detail: 'high' },
        { type: 'text', text: 'Second', text_elements: [] }, { type: 'image', fileId: 'two', detail: 'low' },
        { type: 'text', text: 'Third', text_elements: [] },
      ], document: { type: 'doc', content: ['First', 'Second', 'Third'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      const second = page.getByRole('textbox', { name: 'Work with Codex 2' });
      const third = page.getByRole('textbox', { name: 'Work with Codex 3' });
      await third.focus(); await third.press('End'); await third.pressSequentially('T');
      await third.press('Control+z'); assert.equal(await third.inputValue(), 'Third');
      await third.press('Control+Shift+z'); assert.equal(await third.inputValue(), 'ThirdT');
      await first.focus(); await first.press('End'); await first.pressSequentially(' $rev');
      await page.getByRole('option', { name: /review-skill/ }).click();
      await first.press('Control+z'); assert.equal(await first.inputValue(), 'First $rev');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), []);
      await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'First ');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), [{ name: 'review-skill', path: '/skills/review' }]);
      await first.press('Control+z'); assert.equal(await first.inputValue(), 'First $rev');
      if (scenario === 'removed-deep') { await first.press('Control+z'); assert.equal(await first.inputValue(), 'First'); }
      if (!sameEmpty) {
        await second.focus(); await second.press('End'); await second.pressSequentially(' $rev');
        await page.getByRole('option', { name: /review-skill/ }).click();
      }
      if (scenario === 'other-removed') {
        await second.focus(); await second.press('End'); await second.pressSequentially(' $aud');
        await page.getByRole('option', { name: /audit-skill/ }).click();
      }
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), sameEmpty ? [] :
        [{ name: 'review-skill', path: '/skills/review' }, ...(scenario === 'other-removed' ? [{ name: 'audit-skill', path: '/skills/audit' }] : [])]);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const alternate = await page.evaluate(scenario => {
        const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
        if (scenario === 'other-removed') draft.skills = draft.skills.filter((skill: any) => skill.name !== 'audit-skill');
        else if (scenario !== 'retained') draft.skills = [];
        if (scenario === 'same-empty-external' || scenario === 'same-empty-refresh') draft.files = [{ name: 'external.txt', path: '/workspace/external.txt' }];
        return draft;
      }, scenario);
      let revision = `g-redo-${scenario}`;
      const beforeVersion = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      if (sameEmpty) {
        assert.deepEqual(beforeVersion.draft.input, alternate.input);
        assert.deepEqual(beforeVersion.draft.document, alternate.document);
        assert.deepEqual(beforeVersion.draft.skills, alternate.skills);
        if (!external && !refresh) assert.deepEqual(beforeVersion.draft, alternate);
      }
      if (external) {
        const receipt = await page.evaluate(draft => (window as any).fixture.commitExternal(draft), alternate);
        assert.equal(receipt.accepted, true); revision = receipt.after.revision;
      } else if (refresh) {
        const receipt = await page.evaluate(draft => (window as any).fixture.replaceVersion(draft), alternate);
        revision = receipt.revision;
      } else {
        await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: alternate, revision });
        await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
        if (!afterLayout) await page.evaluate(({ revision, followedLocal }) => {
          (window as any).fixture.state.precommit = { action: followedLocal ? 'local-redo' : 'redo', revision };
        }, { revision, followedLocal });
        await page.getByRole('button', { name: alternate.text.replace(/\s+/g, ' '), exact: true }).click();
      }
      assert.notEqual(beforeVersion.revision, revision);
      let observed;
      if (afterLayout) {
        await page.waitForFunction(revision => (window as any).fixture.state.controller.snapshot().revision === revision, revision);
        const before = await first.inputValue(); await first.focus(); await first.press('Control+Shift+z');
        observed = { before, after: await first.inputValue(), snapshot: await page.evaluate(() => (window as any).fixture.state.controller.snapshot()) };
      } else {
        await page.waitForFunction(() => (window as any).fixture.state.precommitResult);
        observed = await page.evaluate(() => (window as any).fixture.state.precommitResult);
      }
      t.diagnostic(JSON.stringify({ scenario, before: observed.before, after: observed.after,
        revision: observed.snapshot.revision, skills: observed.snapshot.draft.skills }));
      assert.equal(observed.before, scenario === 'removed-deep' ? 'First' : 'First $rev');
      if (!retained) {
        if (followedLocal) {
          assert.notEqual(observed.snapshot.revision, revision);
          assert.deepEqual(observed.snapshot.draft, { ...alternate, files: [] });
        } else {
          assert.equal(observed.snapshot.revision, revision);
          assert.deepEqual(observed.snapshot.draft, alternate);
        }
        await first.focus(); await first.press('Control+Shift+z'); await first.press('Control+Shift+z');
        assert.equal(await first.inputValue(), scenario === 'removed-deep' ? 'First' : 'First $rev');
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), []);
      } else {
        assert.equal(observed.snapshot.draft.input[0].text, 'First ');
        assert.deepEqual(observed.snapshot.draft.skills, alternate.skills);
      }
      await third.focus(); await third.press('Control+z'); assert.equal(await third.inputValue(), 'Third');
      await third.press('Control+Shift+z'); assert.equal(await third.inputValue(), 'ThirdT');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.deepEqual(versions.versions.find((version: any) => version.revision === current.revision)?.draft, current.draft);
      assert.deepEqual(current.draft.skills, alternate.skills);
      assert.deepEqual(current.draft.input[1], original.input[1]); assert.deepEqual(current.draft.input[3], original.input[3]);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('G redo-only skill ownership survives a local attachment edit', async () => {
      const { page, errors } = await open('g-redo-local-attachment');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'First\nSecond\nThird', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'First', text_elements: [] }, { type: 'image', fileId: 'one', detail: 'high' },
        { type: 'text', text: 'Second', text_elements: [] }, { type: 'image', fileId: 'two', detail: 'low' },
        { type: 'text', text: 'Third', text_elements: [] },
      ], document: { type: 'doc', content: ['First', 'Second', 'Third'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      const third = page.getByRole('textbox', { name: 'Work with Codex 3' });
      await third.focus(); await third.press('End'); await third.pressSequentially('T');
      await first.focus(); await first.press('End'); await first.pressSequentially(' $rev');
      await page.getByRole('option', { name: /review-skill/ }).click();
      await first.press('Control+z'); assert.equal(await first.inputValue(), 'First $rev');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), []);
      const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller;
        return c.update(c.snapshot().owner, (draft: any) => ({ ...draft, files: [{ name: 'local.txt', path: '/workspace/local.txt' }] })); }), true);
      const local = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      assert.notEqual(local.revision, before.revision);
      await first.focus(); await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'First ');
      const after = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      assert.deepEqual(after.draft.skills, [{ name: 'review-skill', path: '/skills/review' }]);
      assert.deepEqual(after.draft.files, [{ name: 'local.txt', path: '/workspace/local.txt' }]);
      await third.focus(); await third.press('Control+z'); assert.equal(await third.inputValue(), 'Third');
      await third.press('Control+Shift+z'); assert.equal(await third.inputValue(), 'ThirdT');
      await first.focus(); await first.press('Control+z'); assert.equal(await first.inputValue(), 'First $rev');
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.append('document')), { status: 'accepted' });
      await first.focus(); await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'First ');
      const appended = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.deepEqual(appended.skills, [{ name: 'review-skill', path: '/skills/review' }]);
      assert.deepEqual(appended.files, [{ name: 'local.txt', path: '/workspace/local.txt' }]);
      assert.match(JSON.stringify(appended.document), /plugin:\/\/documents@openai-primary-runtime/);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('G redo-only skill ownership rejects returning to the original revision', async () => {
      const { page, errors } = await open('g-redo-original-revision');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'First\nSecond\nThird', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'First', text_elements: [] }, { type: 'image', fileId: 'one', detail: 'high' },
        { type: 'text', text: 'Second', text_elements: [] }, { type: 'image', fileId: 'two', detail: 'low' },
        { type: 'text', text: 'Third', text_elements: [] },
      ], document: { type: 'doc', content: ['First', 'Second', 'Third'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      const third = page.getByRole('textbox', { name: 'Work with Codex 3' });
      await third.focus(); await third.press('End'); await third.pressSequentially('T');
      await first.focus(); await first.press('End'); await first.pressSequentially(' $rev');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const base = await page.evaluate(() => structuredClone((window as any).fixture.state.controller.snapshot().draft));
      const revision = 'g-redo-returned-ancestor';
      const choose = async () => {
        await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: base, revision });
        await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
        await page.getByRole('button', { name: base.text.replace(/\s+/g, ' '), exact: true }).click();
        await page.waitForFunction(value => (window as any).fixture.state.controller.snapshot().revision === value, revision);
      };
      await choose();
      await first.focus(); await first.press('End'); await first.pressSequentially('x'); await first.press('Backspace');
      await page.getByRole('option', { name: /review-skill/ }).click();
      await first.press('Control+z'); assert.equal(await first.inputValue(), 'First $rev');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      assert.notEqual(before.revision, revision); assert.deepEqual(before.draft, base);
      await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: base, revision });
      const versionMenu = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Select draft version' }) });
      if (!await versionMenu.evaluate((element: HTMLDetailsElement) => element.open)) await versionMenu.locator('summary').click();
      await page.evaluate(value => { (window as any).fixture.state.precommit = { action: 'redo', revision: value }; }, revision);
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.equal(versions.versions.at(-1).revision, revision);
      await page.getByRole('button', { name: base.text.replace(/\s+/g, ' '), exact: true }).last().click();
      await page.waitForFunction(() => (window as any).fixture.state.precommitResult);
      const observed = await page.evaluate(() => (window as any).fixture.state.precommitResult);
      assert.equal(observed.before, 'First $rev'); assert.equal(observed.after, 'First $rev');
      assert.equal(observed.snapshot.revision, revision); assert.deepEqual(observed.snapshot.draft, base);
      await third.focus(); await third.press('Control+z'); assert.equal(await third.inputValue(), 'Third');
      await third.press('Control+Shift+z'); assert.equal(await third.inputValue(), 'ThirdT');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('G known precommit composition retains the produced input and both versions', async () => {
      const { page, errors } = await open('g-known-precommit-composition');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'A\nB\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'A\nB', text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
        { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      await first.focus(); await first.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
      await first.pressSequentially('X');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const alternate = await page.evaluate(() => {
        const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
        draft.input[0].text = 'A\nBXY'; draft.text = 'A\nBXY\nTail';
        draft.document.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hard_break' },
          { type: 'text', text: 'BXY' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }];
        return draft;
      });
      const revision = 'g-known-composition-b';
      await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: alternate, revision });
      await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
      await page.evaluate(revision => { (window as any).fixture.state.precommit = { action: 'compose', revision }; }, revision);
      await page.getByRole('button', { name: 'A BXY Tail', exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.precommitResult);
      const observed = await page.evaluate(() => (window as any).fixture.state.precommitResult);
      assert.equal(observed.before, 'A\nBX');
      assert.equal(observed.snapshot.draft.input[0].text, 'A\nBXQ');
      const save = page.getByRole('button', { name: 'Save as a separate draft' });
      await save.waitFor(); assert.equal(await save.isDisabled(), true);
      await first.evaluate((element: HTMLTextAreaElement) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, element.value + 'R');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'R', isComposing: true }));
      });
      assert.equal(await first.inputValue(), 'A\nBXQR');
      assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.input[0].text), 'A\nBXQR');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), false);
      const beforeSave = await page.evaluate(() => (window as any).fixture.versions());
      assert.deepEqual(beforeSave.versions.find((version: any) => version.revision === revision)?.draft, alternate);
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
      await first.evaluate(async element => {
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      assert.equal(await save.isDisabled(), false);
      await save.click(); await save.waitFor({ state: 'hidden' });
      const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.equal(current.draft.input[0].text, 'A\nBXQR');
      assert.deepEqual(versions.versions.find((version: any) => version.revision === revision)?.draft, alternate);
      assert.deepEqual(versions.versions.find((version: any) => version.revision === current.revision)?.draft, current.draft);
      assert.deepEqual(current.draft.input[1], original.input[1]);
      await first.focus(); await first.press('Control+z'); assert.equal(await first.inputValue(), 'A\nBX');
      await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'A\nBXQR');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('C precommit view history preserves the original agent and accepted document', async () => {
      const { page, errors } = await open('c-precommit-view');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const mention = { type: 'agentMention', attrs: { name: 'Review remote', displayName: 'Review remote',
        conversationId: 'same-id', path: 'thread://same-id?hostId=ssh%3Aother' } };
      const original = { text: 'A\nB Review remote\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'A\nB Review remote', text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
        { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B ' }, mention] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
      await first.locator('[data-mention="agent"]').waitFor(); await first.focus(); await first.press('End'); await first.pressSequentially('X');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const alternate = await page.evaluate(() => {
        const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
        const [first, second, tail] = draft.document.content;
        draft.document.content = [{ type: 'paragraph', content: [...first.content, { type: 'hard_break' }, ...second.content] }, tail];
        return draft;
      });
      const revision = 'c-precommit-view';
      await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: alternate, revision });
      await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
      await page.evaluate(revision => { (window as any).fixture.state.precommit = { action: 'view-undo', revision }; }, revision);
      await page.getByRole('button', { name: alternate.text.replace(/\s+/g, ' '), exact: true }).click();
      await page.waitForFunction(() => (window as any).fixture.state.precommitResult);
      const observed = await page.evaluate(() => (window as any).fixture.state.precommitResult);
      assert.equal(observed.dispatched, false);
      assert.equal(observed.snapshot.revision, revision);
      assert.deepEqual(observed.snapshot.draft, alternate);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.deepEqual(versions.versions.find((version: any) => version.revision === revision)?.draft, alternate);
      assert.equal(await first.locator('[data-mention="agent"]').count(), 1);
      assert.equal(await first.locator('[data-mention="agent"]').getAttribute('agent-mention-path'), mention.attrs.path);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('C precommit append rejects stale segment and separator sources', async () => {
      for (const separator of [false, true]) {
        const { page, errors } = await open(separator ? 'c-precommit-append-separator' : 'c-precommit-append-segment');
        const first = separator ? 'A' : 'A\nB';
        const original = { text: `${first}\nTail`, images: [], files: [], references: [], skills: [], input: [
          { type: 'text', text: first, text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
          { type: 'text', text: 'Tail', text_elements: [] },
        ], document: { type: 'doc', content: separator
          ? [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }]
          : [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] } };
        const replacement = { ...structuredClone(original), document: { type: 'doc', content: separator
          ? [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hard_break' }, { type: 'text', text: 'Tail' }] }]
          : [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hard_break' }, { type: 'text', text: 'B' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] } };
        await page.evaluate(value => (window as any).fixture.mountSegmentProbe(value), original);
        const result = await page.evaluate(value => {
          const probe = (window as any).fixture.state.segmentProbe;
          probe.set(value);
          const beforeLayout = probe.prepare();
          probe.render();
          const afterLayout = probe.prepare();
          probe.close();
          return { beforeLayout, afterLayout };
        }, replacement);
        assert.deepEqual(result, { beforeLayout: false, afterLayout: true });
        assert.deepEqual(errors, []); await page.close();
      }
    });

    await t.test('C final segmented structure adoption discards only the prior version history', async () => {
      for (const fromBreak of [false, true]) {
        const { page, errors } = await open(fromBreak ? 'c-final-break-to-paragraph' : 'c-final-paragraph-to-break');
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
        const firstParagraphs = fromBreak
          ? [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hard_break' }, { type: 'text', text: 'B' }] }]
          : [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }];
        const original = { text: 'A\nB\nTail', images: [], files: [], references: [], skills: [], input: [
          { type: 'text', text: 'A\nB', text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
          { type: 'text', text: 'Tail', text_elements: [] },
        ], document: { type: 'doc', content: [...firstParagraphs, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] } };
        assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
        const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
        const second = page.getByRole('textbox', { name: 'Work with Codex 2' });
        await second.focus(); await second.press('End'); await second.pressSequentially('Y');
        assert.equal(await second.inputValue(), 'TailY');
        await first.focus(); await first.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
        await first.pressSequentially('X'); assert.equal(await first.inputValue(), 'A\nBX');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller;
          return c.update(c.snapshot().owner, (draft: any) => ({ ...draft, files: [{ name: 'notes.txt', path: '/workspace/notes.txt' }] })); }), true);
        await first.press('Control+z'); assert.equal(await first.inputValue(), 'A\nB');
        await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'A\nBX');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        const alternate = await page.evaluate(useBreak => {
          const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
          const tail = draft.document.content.at(-1);
          draft.document.content = useBreak
            ? [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hard_break' }, { type: 'text', text: 'BX' }] }, tail]
            : [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'BX' }] }, tail];
          return draft;
        }, !fromBreak);
        const revision = fromBreak ? 'c-final-paragraph' : 'c-final-break';
        await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: alternate, revision });
        await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
        await page.getByRole('button', { name: 'A BX TailY', exact: true }).click();
        await page.waitForFunction(revision => (window as any).fixture.state.controller.snapshot().revision === revision, revision);
        await first.focus(); await first.press('Control+z');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        const saved = await page.evaluate(() => (window as any).fixture.versions());
        assert.equal(await first.inputValue(), 'A\nBX');
        assert.equal(current.revision, revision);
        assert.deepEqual(current.draft, alternate);
        assert.deepEqual(saved.versions.find((version: any) => version.revision === revision)?.draft, alternate);
        await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'A\nBX');
        await second.focus(); await second.press('Control+z'); assert.equal(await second.inputValue(), 'Tail');
        await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'TailY');
        await first.focus();
        await first.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
        await first.pressSequentially('C'); await first.press('Control+z'); assert.equal(await first.inputValue(), 'A\nBX');
        await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'A\nBXC');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        const persisted = await page.evaluate(() => (window as any).fixture.read());
        assert.deepEqual(persisted.draft.input[1], original.input[1]);
        assert.equal(persisted.draft.input[0].text, 'A\nBXC');
        assert.equal(persisted.draft.document.content[0].content.some((node: any) => node.type === 'hard_break'), !fromBreak);
        await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        assert.equal(await page.getByRole('textbox', { name: 'Work with Codex 1' }).inputValue(), 'A\nBXC');
        assert.deepEqual(errors, []); await page.close();
      }
    });

    await t.test('C final segmented separator structure invalidates both adjacent histories', async () => {
      for (const fromBreak of [false, true]) {
        const { page, errors } = await open(fromBreak ? 'c-final-separator-to-paragraph' : 'c-final-separator-to-break');
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
        const content = fromBreak ? [{ type: 'paragraph', content: [
          { type: 'text', text: 'A' }, { type: 'hard_break' }, { type: 'text', text: 'B' },
        ] }] : [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }];
        const original = { text: 'A\nB', images: [], files: [], references: [], skills: [], input: [
          { type: 'text', text: 'A', text_elements: [] }, { type: 'image', fileId: 'image-one', detail: 'high' },
          { type: 'text', text: 'B', text_elements: [] },
        ], document: { type: 'doc', content } };
        assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
        const first = page.getByRole('textbox', { name: 'Work with Codex 1' }), second = page.getByRole('textbox', { name: 'Work with Codex 2' });
        await first.focus(); await first.press('End'); await first.pressSequentially('X');
        await second.focus(); await second.press('End'); await second.pressSequentially('Y');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        const alternate = await page.evaluate(useBreak => {
          const draft = structuredClone((window as any).fixture.state.controller.snapshot().draft);
          draft.document.content = useBreak ? [{ type: 'paragraph', content: [
            { type: 'text', text: 'AX' }, { type: 'hard_break' }, { type: 'text', text: 'BY' },
          ] }] : [{ type: 'paragraph', content: [{ type: 'text', text: 'AX' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'BY' }] }];
          return draft;
        }, !fromBreak);
        const revision = fromBreak ? 'c-final-separator-paragraph' : 'c-final-separator-break';
        await page.evaluate(({ draft, revision }) => (window as any).fixture.addVersion(draft, revision), { draft: alternate, revision });
        await page.locator('summary').filter({ hasText: 'Select draft version' }).click();
        await page.getByRole('button', { name: 'AX BY', exact: true }).click();
        await page.waitForFunction(revision => (window as any).fixture.state.controller.snapshot().revision === revision, revision);
        await first.focus(); await first.press('Control+z');
        await second.focus(); await second.press('Control+z');
        assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
        const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        const saved = await page.evaluate(() => (window as any).fixture.versions());
        assert.equal(await first.inputValue(), 'AX'); assert.equal(await second.inputValue(), 'BY');
        assert.equal(current.revision, revision); assert.deepEqual(current.draft, alternate);
        assert.deepEqual(saved.versions.find((version: any) => version.revision === revision)?.draft, alternate);
        await first.focus(); await first.press('Control+Shift+z'); assert.equal(await first.inputValue(), 'AX');
        await second.focus(); await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'BY');
        await second.press('End'); await second.pressSequentially('Z');
        await second.press('Control+z'); assert.equal(await second.inputValue(), 'BY');
        await second.press('Control+Shift+z'); assert.equal(await second.inputValue(), 'BYZ');
        assert.deepEqual(errors, []); await page.close();
      }
    });

    await t.test('C review rich composition A ending cannot release newer B', async () => {
      const { page, errors } = await open('c-review-rich-generation');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: '**Original**', images: [], files: [], references: [], skills: [],
        document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original', marks: [{ type: 'strong' }] }] }] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const editor = page.locator('[contenteditable="true"][role="textbox"]'); await editor.waitFor(); await editor.focus();
      const frozen = await editor.evaluate(async element => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const c = (window as any).fixture.state.controller, lease = c.freeze(c.snapshot().owner);
        lease?.release(); return !lease;
      });
      assert.equal(frozen, true);
      await editor.evaluate(async element => {
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      const available = await page.evaluate(() => { const c = (window as any).fixture.state.controller, lease = c.freeze(c.snapshot().owner);
        lease?.release(); return !!lease; });
      assert.equal(available, true);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('C review pending draft and rich composition generation keep the original editor frozen', async () => {
      const { page, errors } = await open('c-review-rich-composition');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: '**Original**', images: [], files: [], references: [], skills: [],
        document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original', marks: [{ type: 'strong' }] }] }] },
        pendingDrafts: [{ text: 'Retained', images: [], files: [], references: [], skills: [] }] };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const editor = page.locator('[contenteditable="true"][role="textbox"]'); await editor.waitFor(); await editor.focus();
      await page.getByRole('button', { name: 'Switch draft' }).waitFor();
      const blockedTail = await editor.evaluate(element => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        (Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Switch draft') as HTMLButtonElement).click();
        return (window as any).fixture.state.controller.snapshot().draft.text;
      });
      assert.equal(blockedTail, original.text);
      await editor.evaluate(async element => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const frozenDuringB = await editor.evaluate(async element => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const c = (window as any).fixture.state.controller, lease = c.freeze(c.snapshot().owner);
        lease?.release();
        (Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Switch draft') as HTMLButtonElement).click();
        return { frozen: !lease, draft: c.snapshot().draft };
      });
      assert.equal(frozenDuringB.frozen, true);
      assert.equal(frozenDuringB.draft.text, original.text);
      assert.equal(await editor.innerText(), 'Original');
      await editor.evaluate(async element => {
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await page.getByRole('button', { name: 'Switch draft' }).click();
      await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Retained');
      assert.equal(await page.getByRole('textbox', { name: 'Work with Codex' }).inputValue(), 'Retained');
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

    await t.test('marked chat paste preserves segmented input, images, byte ranges and undo', async () => {
      const { page, errors } = await open('chat-segmented-marked-paste');
      const original = { text: '文件 @ref\nLook @Rev', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: '文件 @ref', text_elements: [{ byteRange: { start: 7, end: 11 }, placeholder: 'ref' }] },
        { type: 'image', fileId: 'file-1', detail: 'high' },
        { type: 'text', text: 'Look @Rev', text_elements: [] },
      ], document: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '文件 @ref', marks: [{ type: 'strong' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Look @Rev', marks: [{ type: 'em' }] }] },
      ] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const first = page.getByRole('textbox', { name: 'Work with Codex 1' }), second = page.getByRole('textbox', { name: 'Work with Codex 2' });
      await second.focus(); await second.press('End'); await page.getByRole('option', { name: /Review local/ }).waitFor(); await second.press('Enter');
      const copied = await second.evaluate(element => {
        const range = document.createRange(); range.selectNode(element.querySelector('em')!);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return { html: data.getData('text/html'), text: data.getData('text/plain') };
      });
      assert.match(copied.html, /<em>/); assert.match(copied.html, /data-mention="agent"/);
      await first.focus(); await first.press('End');
      await first.evaluate((element, copied) => {
        const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, copied);
      await first.locator('em [data-mention="agent"]').waitFor();
      const after = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.deepEqual(after.input[1], original.input[1]); assert.deepEqual(after.input[0].text_elements, original.input[0].text_elements);
      assert.match(JSON.stringify(after.document.content[0]), /"type":"em"/);
      await first.press('Control+z'); assert.equal(await first.locator('[data-mention="agent"]').count(), 0);
      await first.press('Control+Shift+z'); assert.equal(await first.locator('em [data-mention="agent"]').count(), 1);
      await second.focus(); await second.press('End');
      await second.evaluate((element, copied) => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!); range.collapse(false);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, copied);
      assert.equal(await second.locator('em [data-mention="agent"]').count(), 2, JSON.stringify(await page.getByRole('alert').allTextContents()));
      await second.press('Control+z'); assert.equal(await second.locator('[data-mention="agent"]').count(), 1);
      await second.press('Control+Shift+z'); assert.equal(await second.locator('em [data-mention="agent"]').count(), 2);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      try { await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor(); }
      catch { throw new Error('send did not reach fixture: ' + JSON.stringify({ alerts: await page.getByRole('alert').allTextContents(),
        draft: await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft) })); }
      const input = await page.evaluate(() => (window as any).fixture.state.submissions[0].input);
      assert.deepEqual(input[1], original.input[1]);
      assert.equal(new TextDecoder().decode(new TextEncoder().encode(input[0].text).slice(input[0].text_elements[0].byteRange.start, input[0].text_elements[0].byteRange.end)), '@ref');
      assert.match(input[0].text, /\*.*\[@Review local\]\(thread:\/\/same-id\?hostId=local\).*\*/);
      assert.equal((input[2].text.match(/thread:\/\/same-id\?hostId=local/g) ?? []).length, 2);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('C review marked pasted nodes retain repeated UTF-8 references in the actual submission', async () => {
      for (const kind of ['agent', 'plugin'] as const) {
        const { page, errors } = await open('c-review-paste-range-' + kind);
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
        const original = { text: 'local文\nTail', images: [], files: [], references: [], skills: [], input: [
          { type: 'text', text: 'local文', text_elements: [{ byteRange: { start: 0, end: 8 }, placeholder: 'ref' }] },
          { type: 'image', fileId: 'file-1', detail: 'high' }, { type: 'text', text: 'Tail', text_elements: [] },
        ], document: { type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'local文' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] },
        ] } };
        assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
        const first = page.getByRole('textbox', { name: 'Work with Codex 1' });
        await first.focus(); await first.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(0, 0));
        await first.evaluate((element, kind) => {
          const span = kind === 'agent' ? '<span agent-mention-name="A" agent-mention-display-name="A" agent-mention-path="thread://t?hostId=local">A</span>'
            : '<span plugin-mention-name="A" plugin-mention-display-name="A" plugin-mention-path="plugin://local@openai-primary-runtime">A</span>';
          const data = new DataTransfer(); data.setData('text/html', '<strong>' + span + '</strong>'); data.setData('text/plain', 'A');
          element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
        }, kind);
        await first.locator('strong [data-mention="' + kind + '"]').waitFor();
        const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
        const shift = kind === 'agent' ? 1 : 2;
        assert.deepEqual(current.input[0].text_elements[0].byteRange, { start: shift, end: shift + 8 });
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.state.submissions.length > 0 || !!document.querySelector('[role="alert"]'));
        const state = await page.evaluate(() => ({ submissions: (window as any).fixture.state.submissions,
          alerts: Array.from(document.querySelectorAll('[role="alert"]'), node => node.textContent) }));
        assert.equal(state.submissions.length, 1, JSON.stringify(state.alerts));
        const input = state.submissions[0].input, range = input[0].text_elements[0].byteRange;
        assert.equal(new TextDecoder().decode(new TextEncoder().encode(input[0].text).slice(range.start, range.end)), 'local文');
        assert.deepEqual(input.slice(1), original.input.slice(1));
        assert.deepEqual(errors, []); await page.close();
      }
    });

    await t.test('C review ordinary marked duplicate agent and plugin paste undo and redo', async () => {
      for (const kind of ['agent', 'plugin'] as const) {
        const { page, errors } = await open('c-review-paste-undo-' + kind);
        const editor = page.getByRole('textbox', { name: 'Work with Codex' });
        const before = kind === 'agent' ? 'A' : '@A';
        await editor.fill(before); await editor.press('End');
        await editor.evaluate((element, kind) => {
          const span = kind === 'agent' ? '<span agent-mention-name="A" agent-mention-display-name="A" agent-mention-path="thread://t?hostId=local">A</span>'
            : '<span plugin-mention-name="A" plugin-mention-display-name="A" plugin-mention-path="plugin://local@openai-primary-runtime">A</span>';
          const data = new DataTransfer(); data.setData('text/html', '<strong>' + span + '</strong>'); data.setData('text/plain', 'A');
          element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
        }, kind);
        await editor.locator('strong [data-mention="' + kind + '"]').waitFor();
        assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), before + before);
        await editor.press('Control+z');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), before);
        assert.equal(await editor.locator('[data-mention="' + kind + '"]').count(), 0);
        await editor.press('Control+Shift+z');
        assert.equal(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.text), before + before);
        assert.equal(await editor.locator('strong [data-mention="' + kind + '"]').count(), 1);
        assert.deepEqual(errors, []); await page.close();
      }
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

    await t.test('plugin append uses the original document, history, clipboard and submitted input', async () => {
      const { page, errors } = await open('plugin-append-plain-mode');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      await editor.pressSequentially('Before');
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.append('document', 'output-document-prefill')), { status: 'accepted' });
      const node = editor.locator('[data-mention="plugin"]');
      await node.waitFor();
      assert.equal(await node.textContent(), 'Documents');
      assert.equal(await node.getAttribute('contenteditable'), 'false');
      assert.equal(await node.getAttribute('data-prompt-link-href'), 'plugin://documents@openai-primary-runtime');
      assert.equal(await node.getAttribute('data-prompt-link-label'), '@Documents');
      assert.deepEqual(await node.locator('svg').evaluate(element => ({ namespace: element.namespaceURI,
        width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
        margin: getComputedStyle(element).marginRight, hidden: element.getAttribute('aria-hidden') })),
      { namespace: 'http://www.w3.org/2000/svg', width: 16, height: 16, margin: '3px', hidden: 'true' });
      const saved = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.match(JSON.stringify(saved.document), /"type":"pluginMention"/);
      const snapshot = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.append('document', 'output-document-prefill')), { status: 'accepted' });
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), snapshot);
      assert.equal(await node.count(), 1);
      await editor.press('Control+z'); assert.equal(await editorText(editor), 'Before');
      await editor.press('Control+z'); assert.equal(await editorText(editor), '');
      await editor.press('Control+Shift+z'); assert.equal(await editorText(editor), 'Before');
      await editor.press('Control+Shift+z'); assert.equal(await node.count(), 1);
      const copied = await editor.evaluate(element => {
        const range = document.createRange(); range.selectNode(element.querySelector('[data-mention="plugin"]')!);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return { html: data.getData('text/html'), text: data.getData('text/plain') };
      });
      assert.match(copied.html, /plugin-mention-path="plugin:\/\/documents@openai-primary-runtime"/);
      const target = await open('plugin-copy-empty');
      const targetEditor = target.page.getByRole('textbox', { name: 'Work with Codex' });
      await targetEditor.focus();
      await targetEditor.evaluate((element, copied) => {
        const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, copied);
      await targetEditor.locator('[data-mention="plugin"]').waitFor();
      assert.equal(await targetEditor.locator('[data-mention="plugin"]').getAttribute('data-prompt-link-href'), 'plugin://documents@openai-primary-runtime');
      await targetEditor.press('Control+z'); assert.equal(await targetEditor.locator('[data-mention="plugin"]').count(), 0);
      await targetEditor.press('Control+Shift+z'); assert.equal(await targetEditor.locator('[data-mention="plugin"]').count(), 1);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0].input);
      assert.deepEqual(sent, [{ type: 'text', text: 'Before Create a new document with [@Documents](plugin://documents@openai-primary-runtime). Start by asking me what it should be about.', text_elements: [] }]);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.locator('[data-mention="plugin"]').waitFor();
      assert.equal(await page.locator('[data-mention="plugin"]').getAttribute('data-prompt-link-href'), 'plugin://documents@openai-primary-runtime');
      assert.deepEqual(errors, []); assert.deepEqual(target.errors, []); await target.page.close(); await page.close();
    });

    await t.test('plugin paste accepts the original reference attributes and rejects a conflicting link label', async () => {
      const { page, errors } = await open('plugin-original-clipboard');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' }); await editor.focus();
      const html = '<span plugin-mention-name="Documents" plugin-mention-display-name="Documents" '
        + 'plugin-mention-path="plugin://documents@openai-primary-runtime" plugin-mention-icon="" plugin-mention-brand-color="" '
        + 'data-prompt-link-href="plugin://documents@openai-primary-runtime" data-prompt-link-label="@Documents" '
        + 'data-appearance="inline-mention" data-layout="inline-flow" data-font-weight="medium" data-tone="accent" '
        + 'data-interactive="" data-underline-on-hover="" contenteditable="false"><span>Documents</span></span>';
      const paste = (value: string) => editor.evaluate((element, source) => {
        const data = new DataTransfer(); data.setData('text/html', source); data.setData('text/plain', '@Documents');
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, value);
      await paste(html);
      const node = editor.locator('[data-mention="plugin"]'); await node.waitFor();
      assert.equal(await node.getAttribute('plugin-mention-path'), 'plugin://documents@openai-primary-runtime');
      assert.equal(await node.getAttribute('data-prompt-link-label'), '@Documents');
      await paste(html.replace('plugin-mention-display-name="Documents"', 'plugin-mention-display-name=""'));
      assert.equal(await node.count(), 2);
      await paste(html.replace('data-prompt-link-label="@Documents"', 'data-prompt-link-label="@Different"'));
      assert.equal(await node.count(), 2);
      await page.getByRole('alert').waitFor();
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('plugin append and paste preserve the real rich document in plain preference', async () => {
      const { page, errors } = await open('plugin-rich-plain-mode');
      const fixtureDocument = { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body', marks: [{ type: 'strong' }] }] },
      ] };
      assert.equal(await page.evaluate(value => (window as any).fixture.seedRich(value), fixtureDocument), true);
      const editor = page.locator('[contenteditable="true"][role="textbox"]'); await editor.waitFor();
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.append('site')), { status: 'accepted' });
      const node = editor.locator('[data-mention="plugin"]'); await node.waitFor();
      assert.equal(await node.textContent(), 'Sites');
      const copied = await editor.evaluate(element => {
        const range = document.createRange(); range.selectNode(element.querySelector('[data-mention="plugin"]')!);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return { html: data.getData('text/html'), text: data.getData('text/plain') };
      });
      await editor.evaluate((element, copied) => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!); range.collapse(false);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, copied);
      assert.equal(await node.count(), 2);
      await editor.press('Control+z'); assert.equal(await node.count(), 1);
      await editor.press('Control+z'); assert.equal(await node.count(), 0);
      assert.equal(await editor.locator('h2').textContent(), 'Heading');
      assert.equal(await editor.locator('strong').textContent(), 'Body');
      await editor.press('Control+Shift+z'); await editor.press('Control+Shift+z'); assert.equal(await node.count(), 2);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const sent = await page.evaluate(() => (window as any).fixture.state.submissions[0].input);
      assert.equal((JSON.stringify(sent).match(/plugin:\/\/sites@openai-curated-remote/g) ?? []).length, 2);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.hostCalls.includes('set-setting')), false);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('plugin append preserves marked segments, reference bytes and the image input order', async () => {
      const { page, errors } = await open('plugin-append-segmented');
      const original = { text: '文件 @ref\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: '文件 @ref', text_elements: [{ byteRange: { start: 7, end: 11 }, placeholder: 'ref' }] },
        { type: 'image', fileId: 'file-1', detail: 'high' }, { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '文件 @ref', marks: [{ type: 'strong' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Tail', marks: [{ type: 'em' }] }] },
      ] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const editor = page.getByRole('textbox', { name: 'Work with Codex 2' }); await editor.waitFor();
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.append('presentation')), { status: 'accepted' });
      await editor.locator('[data-mention="plugin"]').waitFor();
      const draft = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.deepEqual(draft.input[0], original.input[0]); assert.deepEqual(draft.input[1], original.input[1]);
      assert.deepEqual(draft.document.content[0], original.document.content[0]);
      await editor.press('Control+z'); assert.equal(await editor.locator('[data-mention="plugin"]').count(), 0,
        JSON.stringify({ alerts: await page.getByRole('alert').allTextContents(), draft: await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft) }));
      await editor.press('Control+Shift+z'); assert.equal(await editor.locator('[data-mention="plugin"]').count(), 1);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'fixture send declined' }).waitFor();
      const input = await page.evaluate(() => (window as any).fixture.state.submissions[0].input);
      assert.deepEqual(input[1], original.input[1]);
      assert.equal(new TextDecoder().decode(new TextEncoder().encode(input[0].text).slice(input[0].text_elements[0].byteRange.start, input[0].text_elements[0].byteRange.end)), '@ref');
      assert.match(input[2].text, /\[@Presentations\]\(plugin:\/\/presentations@openai-primary-runtime\)/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('plugin append rejects a replaced owner and an active composition', async () => {
      const { page, errors } = await open('plugin-append-authority');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' }); await editor.fill('Original');
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), false);
      await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      await page.evaluate(() => (window as any).fixture.render({ context: { hostId: 'ssh:other', threadId: 'new', draftId: 'new', cwd: '/remote' } }));
      const next = page.getByRole('textbox', { name: 'Work with Codex' }); await next.fill('New owner');
      assert.match(await page.evaluate(async () => { try { await (window as any).fixture.append(); return 'accepted'; } catch (error) { return String(error); } }), /原输入区已变化|草稿外部操作已结束|原输入|owner|authority/i);
      assert.equal(await next.inputValue(), 'New owner');
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft)), /pluginMention/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('plugin append cannot replace a newer version from another page of the same owner', async () => {
      const source = await open('plugin-concurrent'), target = await open('plugin-concurrent');
      const original = source.page.getByRole('textbox', { name: 'Work with Codex' }); await original.fill('Original');
      assert.equal(await source.page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await target.page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.draft.text === 'Original');
      assert.equal(await source.page.evaluate(() => (window as any).fixture.beginAppend()), true);
      const newer = target.page.getByRole('textbox', { name: 'Work with Codex' }); await newer.fill('Newer version');
      assert.equal(await target.page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      assert.match(await source.page.evaluate(async () => { try { await (window as any).fixture.append('document', 'concurrent-prefill'); return 'accepted'; } catch (error) { return String(error); } }), /版本|changed|草稿/i);
      assert.equal(await original.inputValue(), 'Original');
      assert.equal((await target.page.evaluate(() => (window as any).fixture.read())).draft.text, 'Newer version');
      assert.doesNotMatch(JSON.stringify(await target.page.evaluate(() => (window as any).fixture.read())), /pluginMention/);
      assert.doesNotMatch(JSON.stringify(await target.page.evaluate(() => (window as any).fixture.versions())), /concurrent-prefill/);
      assert.deepEqual(source.errors, []); assert.deepEqual(target.errors, []); await target.page.close(); await source.page.close();
    });

    await t.test('plugin append freezes input and cancellation prevents a delayed root write', async () => {
      const { page, errors } = await open('plugin-append-cancel');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' }); await editor.fill('Original'); await editor.focus();
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await page.evaluate(() => (window as any).fixture.holdAtoms());
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      await page.evaluate(() => { const f = (window as any).fixture; f.appendResult = f.append('document', 'cancelled-prefill').then((value: any) => ({ value }), (error: unknown) => ({ error: String(error) })); });
      await page.waitForFunction(() => !!document.querySelector('[aria-busy="true"][inert]'));
      await page.keyboard.type('unwanted');
      assert.equal(await editor.inputValue(), 'Original');
      await page.evaluate(() => { (window as any).fixture.cancelAppend(); });
      await page.evaluate(() => (window as any).fixture.releaseAtoms());
      assert.match(await page.evaluate(async () => (await (window as any).fixture.appendResult).error), /original|草稿|authority/i);
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"][inert]'));
      assert.equal(await editor.inputValue(), 'Original');
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.read())), /pluginMention/);
      assert.doesNotMatch(JSON.stringify(await page.evaluate(() => (window as any).fixture.versions())), /cancelled-prefill/);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('plugin append keeps the committed version when original authority expires during acceptance', async () => {
      const { page, errors } = await open('plugin-append-committed');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' }); await editor.fill('Keep original');
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend(4)), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.append('document', 'committed-prefill')), { status: 'committed-unaccepted' });
      assert.equal(await editor.inputValue(), 'Keep original');
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.match(JSON.stringify(versions), /pluginMention/);
      assert.match(JSON.stringify(versions), /committed-prefill/);
      assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('prompt consumer cancellation after the root commit retains the original projection and committed version', async () => {
      const { page, errors } = await open('prompt-consumer-cancel-committed');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' }); await editor.fill('Original');
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend(0, 4)), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.appendText('Spawn a subagent to explore this repo.', 'cancel-after-commit')),
        { status: 'committed-unaccepted' });
      assert.equal(await editor.inputValue(), 'Original');
      const versions = await page.evaluate(() => (window as any).fixture.versions());
      assert.ok(versions.versions.some((version: { prefills: string[]; draft: { text: string } }) =>
        version.prefills.includes('cancel-after-commit') && version.draft.text === 'Original Spawn a subagent to explore this repo.'));
      assert.equal(await page.evaluate(() => (window as any).fixture.state.submissions.length), 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('prompt consumer retries the stable ID after a seen failure and after undo without another write', async () => {
      const { page, errors } = await open('prompt-consumer-seen');
      const editor = page.getByRole('textbox', { name: 'Work with Codex' });
      const prompt = 'Spawn a subagent to explore this repo.', id = 'home-subagent-prompt';
      await editor.pressSequentially('Before');
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      const failure = await page.evaluate(async ({ prompt, id }) => {
        try {
          const result = await (window as any).fixture.appendText(prompt, id);
          if (result.status !== 'accepted') return 'append was not accepted';
          throw new Error('synthetic seen save failure');
        } catch (error) { return String(error); }
      }, { prompt, id });
      assert.match(failure, /synthetic seen save failure/);
      assert.equal(await editorText(editor), `Before ${prompt}`);
      const saved = await page.evaluate(() => (window as any).fixture.versions());
      assert.equal(saved.versions.length, 1);
      assert.deepEqual(saved.versions[0].prefills, [id]);

      const retry = async () => page.evaluate(async ({ prompt, id }) => {
        const f = (window as any).fixture, before = f.state.controller.snapshot();
        const versions = await f.versions(), originalPut = IDBObjectStore.prototype.put;
        let writes = 0;
        IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
          if (this.name === 'atoms') writes++;
          return originalPut.apply(this, args);
        };
        try {
          if (!f.beginAppend()) throw new Error('append operation unavailable');
          const receipt = await f.appendText(prompt, id);
          return { receipt, before, after: f.state.controller.snapshot(), versions, afterVersions: await f.versions(), writes };
        } finally { IDBObjectStore.prototype.put = originalPut; }
      }, { prompt, id });
      const repeated = await retry();
      assert.deepEqual(repeated.receipt, { status: 'accepted' });
      assert.deepEqual(repeated.after, repeated.before);
      assert.deepEqual(repeated.afterVersions, repeated.versions);
      assert.equal(repeated.writes, 0);
      assert.equal(await editorText(editor), `Before ${prompt}`);

      await editor.press('Control+z');
      assert.equal(await editorText(editor), 'Before');
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      const afterUndo = await retry();
      assert.deepEqual(afterUndo.receipt, { status: 'accepted' });
      assert.deepEqual(afterUndo.after, afterUndo.before);
      assert.deepEqual(afterUndo.afterVersions, afterUndo.versions);
      assert.equal(afterUndo.writes, 0);
      assert.equal(await editorText(editor), 'Before');
      await editor.press('Control+Shift+z');
      assert.equal(await editorText(editor), `Before ${prompt}`);
      await editor.press('Control+z'); await editor.press('Control+z');
      assert.equal(await editorText(editor), '');
      await editor.press('Control+Shift+z'); await editor.press('Control+Shift+z');
      assert.equal(await editorText(editor), `Before ${prompt}`);
      assert.equal(await page.evaluate(() => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), true);
      await page.reload(); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.waitForFunction(expected => (window as any).fixture.state.controller?.snapshot()?.draft.text === expected, `Before ${prompt}`);
      const afterReload = await retry();
      assert.deepEqual(afterReload.receipt, { status: 'accepted' });
      assert.deepEqual(afterReload.after, afterReload.before);
      assert.equal(afterReload.writes, 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('prompt consumer appends plain text to rich and ordered segmented drafts with their histories', async () => {
      const prompt = 'Spawn a subagent to explore this repo.';
      const rich = await open('prompt-consumer-rich');
      const document = { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body', marks: [{ type: 'strong' }] }] },
      ] };
      assert.equal(await rich.page.evaluate(value => (window as any).fixture.seedRich(value), document), true);
      const richEditor = rich.page.locator('[contenteditable="true"][role="textbox"]'); await richEditor.waitFor();
      assert.equal(await rich.page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await rich.page.evaluate(value => (window as any).fixture.appendText(value, 'rich-home'), prompt), { status: 'accepted' });
      assert.equal(await richEditor.locator('h2').textContent(), 'Heading');
      assert.equal(await richEditor.locator('strong').textContent(), 'Body');
      assert.match(await richEditor.textContent() ?? '', /Spawn a subagent to explore this repo\./);
      await richEditor.press('Control+z'); assert.equal(await richEditor.locator('p').textContent(), 'Body');
      await richEditor.press('Control+Shift+z'); assert.match(await richEditor.textContent() ?? '', /Spawn a subagent/);

      const segmented = await open('prompt-consumer-segmented');
      const original = { text: '文件 @ref\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: '文件 @ref', text_elements: [{ byteRange: { start: 7, end: 11 }, placeholder: 'ref' }] },
        { type: 'image', fileId: 'file-1', detail: 'high' }, { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '文件 @ref', marks: [{ type: 'strong' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Tail', marks: [{ type: 'em' }] }] },
      ] } };
      assert.equal(await segmented.page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const segmentEditor = segmented.page.getByRole('textbox', { name: 'Work with Codex 2' }); await segmentEditor.waitFor();
      assert.equal(await segmented.page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await segmented.page.evaluate(value => (window as any).fixture.appendText(value, 'segmented-home'), prompt), { status: 'accepted' });
      const draft = await segmented.page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.deepEqual(draft.input[0], original.input[0]); assert.deepEqual(draft.input[1], original.input[1]);
      assert.deepEqual(draft.document.content[0], original.document.content[0]);
      assert.equal(draft.input[2].text, `Tail ${prompt}`);
      assert.deepEqual(draft.document.content[1].content, [{ type: 'text', text: `Tail ${prompt}`, marks: [{ type: 'em' }] }]);
      await segmentEditor.press('Control+z'); assert.equal(await editorText(segmentEditor), 'Tail');
      await segmentEditor.press('Control+Shift+z'); assert.equal(await editorText(segmentEditor), `Tail ${prompt}`);
      await segmentEditor.press('Control+z'); assert.equal(await editorText(segmentEditor), 'Tail');
      assert.deepEqual(rich.errors, []); assert.deepEqual(segmented.errors, []);
      await rich.page.close(); await segmented.page.close();
    });

    await t.test('C review segmented skill before prompt append keeps both history steps', async () => {
      const { page, errors } = await open('c-review-segmented-skill-append');
      await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
      const original = { text: 'First\nTail', images: [], files: [], references: [], skills: [], input: [
        { type: 'text', text: 'First', text_elements: [] }, { type: 'image', fileId: 'file-1', detail: 'high' },
        { type: 'text', text: 'Tail', text_elements: [] },
      ], document: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Tail', marks: [{ type: 'em' }] }] },
      ] } };
      assert.equal(await page.evaluate(value => { const c = (window as any).fixture.state.controller; return c.update(c.snapshot().owner, () => value); }, original), true);
      const editor = page.getByRole('textbox', { name: 'Work with Codex 2' });
      await editor.focus(); await editor.press('End'); await editor.pressSequentially(' $rev');
      await page.getByRole('option', { name: /review-skill/ }).click();
      const before = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
      assert.deepEqual(before.skills, [{ name: 'review-skill', path: '/skills/review' }]);
      assert.equal(await page.evaluate(() => (window as any).fixture.beginAppend()), true);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.appendText('follow up', 'skill-prompt')), { status: 'accepted' });
      await editor.press('Control+z');
      assert.equal(await editorText(editor), before.input[2].text);
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), before.skills);
      await editor.press('Control+Shift+z'); assert.equal(await editorText(editor), before.input[2].text + 'follow up');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), before.skills);
      await editor.press('Control+z'); await editor.press('Control+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), []);
      await editor.press('Control+Shift+z');
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft.skills), before.skills);
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
