import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('composer draft controller preserves current edits across reference removal, owner changes and failed storage', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
    import { writeComposerDraftVersion } from './src/renderer/composer/composer-draft-store.ts';
    const state={controller:null,snapshots:[],removals:[],submissions:[]};
    const client={async rpc(method) {
      if(method==='model/list') return {data:[],nextCursor:null};
      if(method==='config/read') return {config:{}};
      if(method==='thread/queue/list') return {data:[],nextCursor:null};
      throw Error('Unexpected RPC '+method);
    },async host(method,params) {
      if(method==='get-setting') return {value:params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
      throw Error('Unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let resolveRemoval, rejectRemoval, resolveSubmit;
    let props={client,context:{hostId:'local',threadId:'thread-a',draftId:'stable-draft',cwd:'/fixture'},busy:false,
      onDraftController(controller){state.controller=controller;},
      onDraftChange(snapshot){state.snapshots.push(structuredClone(snapshot));},
      onRemoveReference(owner,reference){state.removals.push({owner,reference});return new Promise((resolve,reject)=>{resolveRemoval=resolve;rejectRemoval=reject;});},
      onSubmit(draft){state.submissions.push(structuredClone(draft));return new Promise(resolve=>{resolveSubmit=resolve;});},async onInterrupt(){}};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,writeComposerDraftVersion,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props));},
      resolveRemoval(){resolveRemoval();},rejectRemoval(){rejectRemoval(Error('fixture comment storage failure'));},resolveSubmit(){resolveSubmit();}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot());
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.fill('Initial');
    await page.getByRole('button', { name: '富文本编辑' }).click();
    const rich = page.locator('.ProseMirror');
    await rich.waitFor();
    await rich.focus(); await page.keyboard.press('End'); await page.keyboard.type(' text');
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'Initial text');
    await rich.evaluate(element => {
      const text = element.querySelector('p')!.firstChild!;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 7);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await page.getByRole('button', { name: '粗体' }).click();
    await rich.locator('strong').waitFor();
    const reference = { id: 'browser:one', text: 'Original reference', kind: 'browser',
      context: { hostId: 'local', nested: { keep: true } }, original: { id: 'comment', content: ['original'] } };
    const before = await page.evaluate(async reference => {
      const controller = (window as any).fixture.state.controller, snapshot = controller.snapshot();
      const wrongOwner = { ...snapshot.owner, threadId: 'wrong' };
      const rejected = await controller.update(wrongOwner, (draft: any) => ({ ...draft, text: 'incorrect' }));
      const accepted = await controller.update(snapshot.owner, (draft: any) => ({ ...draft, references: [reference] }));
      return { rejected, accepted, revision: snapshot.revision };
    }, reference);
    assert.equal(before.rejected, false); assert.equal(before.accepted, true);
    await page.getByText('Original reference').waitFor();
    const added = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
    assert.notEqual(added.revision, before.revision);
    assert.equal(added.draft.text, '**Initial** text');
    assert.equal(added.draft.document.type, 'doc');
    assert.equal(added.draft.document.content[0].content[0].marks[0].type, 'strong');
    assert.equal(await rich.locator('strong').innerText(), 'Initial');
    assert.deepEqual(added.draft.references[0], reference);
    const snapshotIsolation = await page.evaluate(() => {
      const controller = (window as any).fixture.state.controller, snapshot = controller.snapshot();
      snapshot.draft.references[0].text = 'external mutation'; snapshot.owner.threadId = 'wrong';
      return controller.snapshot();
    });
    assert.equal(snapshotIsolation.owner.threadId, 'thread-a');
    assert.equal(snapshotIsolation.draft.references[0].text, 'Original reference');

    const failure = await page.evaluate(async () => {
      const controller = (window as any).fixture.state.controller, before = controller.snapshot();
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'atoms') throw Error('fixture quota');
        return original.apply(this, args);
      };
      let message = '';
      try { await controller.update(before.owner, (draft: any) => { draft.text = 'lost'; draft.references.length = 0; return draft; }); }
      catch (error) { message = (error as Error).message; }
      finally { IDBObjectStore.prototype.put = original; }
      return { message, before, after: controller.snapshot() };
    });
    assert.match(failure.message, /未能保存/);
    assert.deepEqual(failure.after, failure.before);
    await page.getByRole('alert').filter({ hasText: '草稿未能保存' }).waitFor();

    const conflict = await page.evaluate(async () => {
      const controller = (window as any).fixture.state.controller, before = controller.snapshot();
      await (window as any).fixture.writeComposerDraftVersion(before.owner, 'stale-revision', {
        revision: 'other-page', draft: { ...before.draft, text: 'other page' }, prefills: [],
      });
      const accepted = await controller.update(before.owner, (draft: any) => ({ ...draft, hints: [] }));
      return { accepted, after: controller.snapshot() };
    });
    assert.equal(conflict.accepted, true);
    assert.equal(conflict.after.draft.text, '**Initial** text');
    await page.getByText('其他页面或旧数据中有 1 份独立草稿。').waitFor();

    await page.getByRole('button', { name: '移除引用' }).click();
    await page.waitForFunction(() => (window as any).fixture.state.removals.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.removals[0]), { owner: added.owner, reference });
    const duringRemoval = await page.evaluate(async () => {
      const controller = (window as any).fixture.state.controller, owner = controller.snapshot().owner;
      return controller.update(owner, (draft: any) => ({ ...draft, references: [{ ...draft.references[0], text: 'Revised reference' }] }));
    });
    assert.equal(duringRemoval, false);
    assert.equal(await page.locator('.standalone-composer > div').first().evaluate(element => element.hasAttribute('inert')), true);
    await page.evaluate(() => (window as any).fixture.resolveRemoval());
    await page.waitForFunction(() => !document.querySelector('.standalone-composer > div')?.hasAttribute('inert'));
    assert.equal(await page.evaluate(async reference => {
      const controller = (window as any).fixture.state.controller, owner = controller.snapshot().owner;
      return controller.update(owner, (draft: any) => ({ ...draft, references: [{ ...reference, text: 'Revised reference' }] }));
    }, reference), true);
    await rich.focus(); await page.keyboard.press('End'); await page.keyboard.type(' newer');
    await page.getByText('Revised reference').waitFor();
    assert.match((await page.evaluate(() => (window as any).fixture.state.controller.snapshot())).draft.text, /newer/);

    await page.getByRole('button', { name: '移除引用' }).click();
    await page.evaluate(() => (window as any).fixture.rejectRemoval());
    await page.getByRole('alert').filter({ hasText: 'fixture comment storage failure' }).waitFor();
    await page.getByText('Revised reference').waitFor();

    await page.getByRole('button', { name: '移除引用' }).click();
    await page.evaluate(() => {
      const fixture = (window as any).fixture;
      fixture.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'atoms') throw Error('fixture quota');
        return fixture.originalPut.apply(this, args);
      };
      fixture.resolveRemoval();
    });
    await page.getByRole('alert').filter({ hasText: '移除引用失败' }).waitFor();
    await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).fixture.originalPut; });
    await page.getByText('Revised reference').waitFor();

    await page.getByRole('button', { name: '移除引用' }).click();
    await page.evaluate(() => (window as any).fixture.resolveRemoval());
    await page.getByText('Revised reference').waitFor({ state: 'detached' });
    await page.waitForFunction(() => !document.querySelector('.standalone-composer > div')?.hasAttribute('inert'));
    assert.equal(await page.evaluate(async () => {
      const controller = (window as any).fixture.state.controller, owner = controller.snapshot().owner;
      return controller.update(owner, (draft: any) => ({ ...draft, references: [...draft.references, { id: 'file:two', text: 'Another reference' }] }));
    }), true);
    await rich.focus(); await page.keyboard.press('End'); await page.keyboard.type(' kept');
    await page.getByText('Another reference').waitFor();
    assert.match((await page.evaluate(() => (window as any).fixture.state.controller.snapshot())).draft.text, /kept/);

    await page.getByRole('button', { name: '移除引用' }).click();
    await page.evaluate(() => {
      const fixture = (window as any).fixture;
      fixture.oldController = fixture.state.controller;
      fixture.oldOwner = fixture.oldController.snapshot().owner;
      fixture.render({ context: { threadId: 'thread-b' } });
    });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.threadId === 'thread-b');
    assert.deepEqual(await page.evaluate(async () => {
      const fixture = (window as any).fixture;
      return { stale: fixture.oldController.snapshot(), accepted: await fixture.oldController.update(fixture.oldOwner, (draft: any) => ({ ...draft, text: 'stale' })) };
    }), { stale: null, accepted: false });
    await editor.fill('thread-b');
    await page.evaluate(() => (window as any).fixture.resolveRemoval());
    assert.equal(await page.getByText('Another reference').count(), 0);
    assert.match((await page.evaluate(() => (window as any).fixture.state.controller.snapshot())).draft.text, /thread-b/);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.snapshots.some((snapshot: any) => snapshot.owner.threadId === 'thread-b')), true);

    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.state.submissions.length === 1);
    await page.evaluate(() => (window as any).fixture.render({ context: { threadId: 'thread-a' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.threadId === 'thread-a');
    await rich.focus(); await page.keyboard.press('End'); await page.keyboard.type(' latest');
    await page.evaluate(() => (window as any).fixture.resolveSubmit());
    await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text.includes('latest'));
    await page.waitForFunction(() => (window as any).fixture.state.snapshots.some((snapshot: any) => snapshot.draft.text.includes('latest')));
    const beforeRefresh = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(await page.evaluate(() => (window as any).fixture.oldController.snapshot()), null);
    await page.evaluate(() => {
      const fixture = (window as any).fixture;
      fixture.oldController = fixture.state.controller; fixture.oldOwner = fixture.oldController.snapshot().owner;
      fixture.render({ context: { hostId: 'ssh-fixture', threadId: 'thread-c', draftId: 'remote-draft' } });
    });
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.hostId === 'ssh-fixture');
    assert.equal(await page.evaluate(async () => {
      const fixture = (window as any).fixture;
      return await fixture.oldController.update(fixture.oldOwner, (draft: any) => ({ ...draft, text: 'stale remote update' }));
    }), false);
    await page.evaluate(() => (window as any).fixture.render({ context: { hostId: 'local', threadId: 'thread-a', draftId: 'stable-draft' } }));
    await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'stable-draft');
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.locator('.ProseMirror').waitFor();
    await page.getByText('Another reference').waitFor();
    const afterRefresh = await page.evaluate(() => (window as any).fixture.state.controller.snapshot().draft);
    assert.equal(afterRefresh.text, beforeRefresh.text);
    assert.deepEqual(afterRefresh.document, beforeRefresh.document);
    assert.deepEqual(afterRefresh.references, beforeRefresh.references);
    assert.equal(await page.locator('.ProseMirror strong').innerText(), beforeRefresh.document.content[0].content[0].text);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('a React parent can consume controller and draft notifications while rerendering', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 30_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    const client={async rpc(method){if(method==='model/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('Unexpected RPC '+method);},
      async host(method,params){if(method==='get-setting')return {value:params.key==='composerEnterBehavior'?'enter':'queue'};
      throw Error('Unexpected host '+method);},subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let renders=0;
    function Parent(){
      const [controller,setController]=useState(null), [snapshot,setSnapshot]=useState(null);
      if(++renders>50)throw Error('Parent rerender loop');
      return React.createElement(React.Fragment,null,
        React.createElement('output',{id:'projection'},(controller?'ready:':'missing:')+(snapshot?.draft.text ?? '')),
        React.createElement(StandaloneComposer,{client,context:{hostId:'local',threadId:null,draftId:'parent',cwd:'/fixture'},busy:false,
          onDraftController:value=>setController(value),onDraftChange:value=>setSnapshot(value),async onSubmit(){},async onInterrupt(){}}));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Parent));
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('projection');
    await page.waitForFunction(() => document.querySelector('#projection')?.textContent === 'ready:projection', null, { timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
