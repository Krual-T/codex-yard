import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';

test('composer consumes only an exact, live committed reference version', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    import {composerDraftAtomKey,readComposerDraftVersions,writeComposerDraftVersion,clearComposerDraftRevision,
      updateComposerDraftVersionInRoot} from './src/renderer/composer/composer-draft-store.ts';
    import {updateBrowserAtoms} from './src/renderer/storage/ui-atoms.ts';
    import {createId} from './src/renderer/composer/standalone-draft.ts';
    const state={controller:null,snapshots:[],mode:'default',delay:false,committed:false,removed:false,accepted:null,puts:0,transactions:0};
    const client={async rpc(method){if(method==='model/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};throw Error('unexpected RPC '+method)},
      async host(method,params){if(method==='get-setting')return {exists:true,value:params.key==='composerEnterBehavior'?'cmdAlways':
        params.key==='composerPlainTextMode'?true:'queue'};throw Error('unexpected host '+method)},
      subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    let resumeRemoval;
    const root=createRoot(document.getElementById('root'));
    let props={client,context:{hostId:'local',threadId:null,draftId:'draft-a',cwd:'/fixture'},busy:false,
      onDraftController(controller){state.controller=controller},onDraftChange(snapshot){state.snapshots.push(snapshot)},
      async onRemoveReference(owner,reference,operation){
        if(state.mode==='default'){state.removed=true;return;}
        const receipt=await operation.transaction(async(before,isCurrent)=>{
          state.before=before;
          const after=await fixture.commit(before,draft=>({...draft,references:draft.references.filter(item=>item.id!==reference.id)}),isCurrent);
          state.after=after;state.committed=true;
          if(state.delay)await new Promise(resolve=>{resumeRemoval=resolve});
          return {after,value:null};
        });
        state.accepted=receipt.accepted;
        state.removed=true;
        return 'handled';
      },async onSubmit(){},async onInterrupt(){}};
    const fixture={state,
      render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};root.render(React.createElement(StandaloneComposer,props))},
      async seed(){const s=state.controller.snapshot();return state.controller.update(s.owner,draft=>({...draft,text:'draft A',
        references:[{id:'browser-1',text:'Browser comment',kind:'browser',context:{localBrowserContext:{targetDescription:'Selected element',opaque:{keep:true}}}},
          {id:'ordinary-2',text:'Other reference'}],hints:[],unknownFixture:{keep:true}}))},
      async branch(){const s=state.controller.snapshot();return writeComposerDraftVersion(s.owner,'missing',
        {revision:'independent',draft:{...s.draft,text:'independent branch'},prefills:['other-prefill']})},
      async commit(before,change,isCurrent=()=>true){return updateBrowserAtoms(atoms=>{
        if(!isCurrent())throw Error('owner changed');
        const result=updateComposerDraftVersionInRoot(atoms[composerDraftAtomKey],before,change,createId());
        return result.changed?{value:result.after,updates:{[composerDraftAtomKey]:result.root}}:{value:result.after};
      })},
      versions(owner){return readComposerDraftVersions(owner)},clear(owner,revision){return clearComposerDraftRevision(owner,revision)},
      watchWrites(){this.put=IDBObjectStore.prototype.put;state.puts=0;IDBObjectStore.prototype.put=function(...args){
        if(this.name==='atoms')state.puts++;return fixture.put.apply(this,args)}},
      stopWatchingWrites(){IDBObjectStore.prototype.put=this.put},
      watchTransactions(){this.transaction=IDBDatabase.prototype.transaction;state.transactions=0;IDBDatabase.prototype.transaction=function(...args){
        state.transactions++;return fixture.transaction.apply(this,args)}},
      resumeRemoval(){resumeRemoval()},
    };
    window.fixture=fixture;fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const script = bundle.outputFiles[0]!.text;
  async function pageFor(context: BrowserContext, mount = true): Promise<Page> {
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://comment-fixture.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://comment-fixture.test/');
    if (mount) {
      await page.addScriptTag({ content: script });
      await page.waitForFunction(() => (window as any).fixture.state.snapshots.length > 0);
    }
    return page;
  }
  async function hold(page: Page) {
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction('atoms', 'readwrite'), store = transaction.objectStore('atoms');
      let released = false;
      const done = new Promise<void>((resolve, reject) => {
        transaction.onabort = () => reject(transaction.error); transaction.oncomplete = () => { db.close(); resolve(); };
      });
      await new Promise<void>((resolve, reject) => {
        let first = true;
        const next = () => { const request = store.get('native-atoms'); request.onerror = () => reject(request.error);
          request.onsuccess = () => { if (!released) next(); if (first) { first = false; resolve(); } }; };
        next();
      });
      (window as any).releaseTransaction = () => { released = true; return done; };
    });
  }
  async function seed(page: Page) {
    assert.equal(await page.evaluate(() => (window as any).fixture.seed()), true);
    await page.evaluate(() => (window as any).fixture.branch());
    await page.getByText(/其他页面或旧数据中有/).waitFor();
  }
  async function committed(page: Page) {
    return page.evaluate(async () => {
      const f = (window as any).fixture, before = f.state.controller.snapshot();
      const after = await f.commit(before, (draft: any) => ({ ...draft, references: draft.references.filter((item: any) => item.id !== 'browser-1') }));
      await f.versions(before.owner);
      return { before, after };
    });
  }
  try {
    await t.test('acceptance and repeated acceptance read the active version and never write it', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        const receipt = await committed(page);
        const result = await page.evaluate(async ({ before, after }) => {
          const f = (window as any).fixture, controller = f.state.controller;
          f.watchWrites();
          const first = await controller.acceptCommittedVersion(before, after);
          const repeated = await controller.acceptCommittedVersion(before, after);
          const modified = await controller.acceptCommittedVersion(before, { ...after, draft: { ...after.draft, hints: [{ unexpected: true }] } });
          const missing = await controller.acceptCommittedVersion(before, { ...after, revision: 'fabricated' });
          const current = controller.snapshot(), versions = await f.versions(before.owner), writes = f.state.puts;
          f.stopWatchingWrites();
          return { first, repeated, modified, missing, current, versions, writes };
        }, receipt);
        assert.deepEqual([result.first, result.repeated, result.modified, result.missing, result.writes], [true, true, false, false, 0]);
        assert.deepEqual(result.current, receipt.after);
        assert.deepEqual(result.current.draft.hints, []);
        assert.equal(result.versions.versions.length, 2);
        assert.ok(result.versions.versions.some((v: any) => v.revision === 'independent' && v.prefills[0] === 'other-prefill'));
        assert.ok(result.versions.versions.some((v: any) => v.revision === receipt.after.revision && v.draft.unknownFixture.keep));
      } finally { await context.close(); }
    });

    await t.test('acceptance retains the complete structured draft even when it requires read-only protection', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        const saved = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, owner = c.snapshot().owner;
          return c.update(owner, (draft: any) => ({ ...draft,
            document: { type: 'doc', content: [{ type: 'paragraph', attrs: { custom: 'keep' }, content: [
              { type: 'text', text: 'draft A', marks: [{ type: 'strong', attrs: { custom: true } }] },
            ] }] }, input: [{ type: 'text', text: 'draft A', text_elements: [] }, { type: 'skill', name: 'fixture', path: '/skill' }],
            hints: [{ unrecognized: ['keep'] }] }));
        });
        assert.equal(saved, true);
        const receipt = await committed(page);
        assert.equal(await page.evaluate(({ before, after }) =>
          (window as any).fixture.state.controller.acceptCommittedVersion(before, after), receipt), true);
        const current = await page.evaluate(() => (window as any).fixture.state.controller.snapshot());
        assert.deepEqual(current, receipt.after);
        assert.deepEqual(current.draft.document, receipt.before.draft.document);
        assert.deepEqual(current.draft.input, receipt.before.draft.input);
        assert.deepEqual(current.draft.hints, [{ unrecognized: ['keep'] }]);
        assert.deepEqual(current.draft.unknownFixture, { keep: true });
      } finally { await context.close(); }
    });

    await t.test('an edit while the authoritative read is waiting retains both branches', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context), blocker = await pageFor(context, false); await seed(page);
        const receipt = await committed(page); await hold(blocker);
        await page.evaluate(({ before, after }) => {
          const f = (window as any).fixture; f.watchTransactions();
          f.accepting = f.state.controller.acceptCommittedVersion(before, after);
        }, receipt);
        await page.waitForFunction(() => (window as any).fixture.state.transactions > 0);
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('newer edit B');
        await blocker.evaluate(() => (window as any).releaseTransaction());
        assert.equal(await page.evaluate(() => (window as any).fixture.accepting), false);
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot();
          const flushed = await f.state.controller.flush(current.owner); return { current, flushed, versions: await f.versions(current.owner) };
        });
        assert.equal(result.current.draft.text, 'newer edit B');
        assert.equal(result.current.draft.references[0].id, 'browser-1');
        assert.equal(result.flushed, false);
        assert.ok(result.versions.versions.some((v: any) => v.revision === receipt.after.revision));
        assert.ok(result.versions.versions.some((v: any) => v.revision === 'independent'));
        await page.getByRole('button', { name: '保存为独立草稿' }).click();
        await page.getByRole('button', { name: '保存为独立草稿' }).waitFor({ state: 'detached' });
        const preserved = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot();
          return { current, versions: await f.versions(current.owner) };
        });
        assert.equal(preserved.current.draft.text, 'newer edit B');
        assert.ok(preserved.versions.versions.some((v: any) => v.revision === preserved.current.revision));
        assert.ok(preserved.versions.versions.some((v: any) => v.revision === receipt.after.revision));
      } finally { await context.close(); }
    });

    await t.test('idempotence still verifies that the accepted revision exists', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page); const receipt = await committed(page);
        const result = await page.evaluate(async ({ before, after }) => {
          const f = (window as any).fixture, c = f.state.controller;
          const initial = await c.acceptCommittedVersion(before, after);
          await f.clear(before.owner, after.revision);
          const repeated = await c.acceptCommittedVersion(before, after);
          await f.versions(before.owner);
          return { initial, repeated, current: c.snapshot() };
        }, receipt);
        assert.equal(result.initial, true); assert.equal(result.repeated, false);
        assert.deepEqual(result.current, receipt.after);
      } finally { await context.close(); }
    });

    await t.test('confirmed submission cannot clear the currently unresolved projection', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => {
          const f = (window as any).fixture;
          f.render({ onSubmit: async () => { f.submitting = true; await new Promise<void>(resolve => { f.confirmSubmit = resolve; }); } });
        });
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.submitting);
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, before = c.snapshot();
          const after = await f.commit(before, (draft: any) => ({ ...draft, references: [] }));
          await f.clear(before.owner, after.revision);
          const accepted = await c.acceptCommittedVersion(before, after);
          f.confirmSubmit();
          return { before, accepted };
        });
        assert.equal(result.accepted, false);
        await page.getByRole('alert').filter({ hasText: '发送已确认，但草稿清理失败' }).waitFor();
        const retained = await page.evaluate(async (owner: any) => (window as any).fixture.versions(owner), result.before.owner);
        assert.ok(retained.retained.some((version: any) => version.revision === result.before.revision));
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), result.before);
      } finally { await context.close(); }
    });

    await t.test('parent cleanup uses the same unresolved projection guard before the local submit resolves', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => {
          const f = (window as any).fixture;
          f.render({ onSubmit: async (_draft: unknown, _options: unknown, _action: unknown, description: any) => {
            f.submitting = true; await new Promise<void>(resolve => { f.confirmSubmit = resolve; });
            try { await f.state.controller.clearSubmittedVersion(description.revision); f.parentCleared = true; }
            catch (cause) { f.parentCleanupError = String(cause); throw cause; }
          } });
        });
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.submitting);
        const before = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, before = c.snapshot();
          const after = await f.commit(before, (draft: any) => ({ ...draft, references: [] }));
          await f.clear(before.owner, after.revision);
          if (await c.acceptCommittedVersion(before, after)) throw new Error('Missing durable version was accepted');
          f.confirmSubmit(); return before;
        });
        await page.waitForFunction(() => Boolean((window as any).fixture.parentCleanupError));
        assert.equal(await page.evaluate(() => (window as any).fixture.parentCleared), undefined);
        const versions = await page.evaluate(async (owner: any) => (window as any).fixture.versions(owner), before.owner);
        assert(versions.retained.some((version: any) => version.revision === before.revision));
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), before);
      } finally { await context.close(); }
    });

    await t.test('queued submission cleanup rechecks a projection made unresolved while waiting', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context), blocker = await pageFor(context, false); await seed(page);
        const receipt = await committed(page);
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('later send B');
        const beforeSend = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller;
          await c.flush(c.snapshot().owner);
          f.render({ onSubmit: async () => { f.submitting = true; await new Promise<void>(resolve => { f.confirmSubmit = resolve; }); } });
          return c.snapshot();
        });
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.submitting);
        await hold(blocker);
        await page.evaluate(() => { const f = (window as any).fixture; f.watchTransactions(); f.confirmSubmit(); });
        await page.waitForFunction(() => (window as any).fixture.state.transactions > 0);
        assert.equal(await page.evaluate(({ before, after }) => (window as any).fixture.state.controller.acceptCommittedVersion(before, after), receipt), false);
        await blocker.evaluate(() => (window as any).releaseTransaction());
        await page.getByRole('alert').filter({ hasText: '发送已确认，但草稿清理失败' }).waitFor();
        const retained = await page.evaluate(async (owner: any) => (window as any).fixture.versions(owner), beforeSend.owner);
        assert.ok(retained.retained.some((version: any) => version.revision === beforeSend.revision));
        assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.controller.snapshot()), beforeSend);
      } finally { await context.close(); }
    });

    await t.test('a deleted committed version is not accepted and cannot replace the projection', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context), writer = await pageFor(context), blocker = await pageFor(context, false);
        await seed(page); const receipt = await committed(page); await hold(blocker);
        await writer.evaluate(({ before, after }) => {
          const f = (window as any).fixture; f.watchTransactions(); f.clearing = f.clear(before.owner, after.revision);
        }, receipt);
        await writer.waitForFunction(() => (window as any).fixture.state.transactions > 0);
        await page.evaluate(({ before, after }) => {
          const f = (window as any).fixture; f.watchTransactions(); f.accepting = f.state.controller.acceptCommittedVersion(before, after);
        }, receipt);
        await page.waitForFunction(() => (window as any).fixture.state.transactions > 0);
        await blocker.evaluate(() => (window as any).releaseTransaction());
        assert.equal(await writer.evaluate(() => (window as any).fixture.clearing), true);
        assert.equal(await page.evaluate(() => (window as any).fixture.accepting), false);
        const current = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot(); await f.versions(current.owner); return f.state.controller.snapshot();
        });
        assert.deepEqual(current, receipt.before);
        await page.getByText('Selected element', { exact: true }).waitFor();
        const blocked = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, owner = c.snapshot().owner;
          const lease = c.freeze(owner); const drained = lease && await lease.flush(); lease?.release();
          const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
          return { drained, flushed: await c.flush(owner), beforeUnload: event.defaultPrevented };
        });
        assert.deepEqual(blocked, { drained: false, flushed: false, beforeUnload: true });
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('unsaved local content');
        const unpersisted = await page.evaluate(async () => {
          const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
          return { snapshot, versions: await f.versions(snapshot.owner) };
        });
        assert.ok(!unpersisted.versions.versions.some((v: any) => v.revision === unpersisted.snapshot.revision));
        await page.evaluate(() => {
          const original = IDBObjectStore.prototype.put;
          (window as any).restorePut = () => { IDBObjectStore.prototype.put = original; };
          IDBObjectStore.prototype.put = function() { throw new DOMException('fixture quota', 'QuotaExceededError'); };
        });
        await page.getByRole('button', { name: '保存为独立草稿' }).click();
        await page.getByRole('alert').filter({ hasText: '无法保存独立草稿' }).waitFor();
        assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), 'unsaved local content');
        assert.equal(await page.evaluate(async () => { const c = (window as any).fixture.state.controller; return c.flush(c.snapshot().owner); }), false);
        await page.evaluate(() => (window as any).restorePut());
        await page.getByRole('button', { name: '保存为独立草稿' }).click();
        await page.getByRole('button', { name: '保存为独立草稿' }).waitFor({ state: 'detached' });
        const recovered = await page.evaluate(async () => {
          const f = (window as any).fixture, snapshot = f.state.controller.snapshot();
          return { snapshot, versions: await f.versions(snapshot.owner), flushed: await f.state.controller.flush(snapshot.owner) };
        });
        assert.equal(recovered.flushed, true);
        assert.ok(recovered.versions.versions.some((v: any) => v.revision === 'independent'));
        assert.ok(recovered.versions.versions.some((v: any) => v.revision === recovered.snapshot.revision && v.draft.text === 'unsaved local content'));
        await page.reload(); await page.addScriptTag({ content: script });
        await page.getByText(/其他页面或旧数据中有/).waitFor();
        await page.getByText('选择草稿版本').click();
        await page.getByRole('button', { name: 'unsaved local content' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.text === 'unsaved local content');
        assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).inputValue(), 'unsaved local content');
      } finally { await context.close(); }
    });

    await t.test('a controller from the prior owner cannot adopt a late receipt', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context), blocker = await pageFor(context, false); await seed(page);
        const receipt = await committed(page); await hold(blocker);
        await page.evaluate(({ before, after }) => {
          const f = (window as any).fixture; f.old = f.state.controller; f.watchTransactions();
          f.accepting = f.old.acceptCommittedVersion(before, after);
        }, receipt);
        await page.waitForFunction(() => (window as any).fixture.state.transactions > 0);
        await page.evaluate(() => (window as any).fixture.render({ context: { hostId: 'remote-fixture', draftId: 'draft-b' } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'draft-b');
        await blocker.evaluate(() => (window as any).releaseTransaction());
        assert.equal(await page.evaluate(() => (window as any).fixture.accepting), false);
        await page.waitForFunction(() => (window as any).fixture.state.snapshots.some((s: any) => s.owner.draftId === 'draft-b'));
        const result = await page.evaluate(async ({ before, after }) => {
          const f = (window as any).fixture;
          return { old: f.old.snapshot(), current: f.state.controller.snapshot(), oldVersions: await f.versions(before.owner), after };
        }, receipt);
        assert.equal(result.old, null);
        assert.equal(result.current.owner.hostId, 'remote-fixture');
        assert.equal(result.current.draft.text, '');
        assert.ok(result.oldVersions.versions.some((v: any) => v.revision === receipt.after.revision));
      } finally { await context.close(); }
    });

    await t.test('handled removal writes once, whereas ordinary removal keeps its default update', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'handled'; f.watchWrites(); });
        await page.getByRole('button', { name: '移除引用' }).first().click();
        await page.waitForFunction(() => (window as any).fixture.state.removed);
        const first = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot();
          await f.state.controller.flush(current.owner); const result = { current, after: f.state.after, accepted: f.state.accepted, writes: f.state.puts };
          f.stopWatchingWrites(); return result;
        });
        assert.equal(first.accepted, true); assert.equal(first.writes, 1); assert.deepEqual(first.current, first.after);
        assert.deepEqual(first.current.draft.references.map((item: any) => item.id), ['ordinary-2']);
        await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'default'; f.state.removed = false; f.watchWrites(); });
        await page.getByRole('button', { name: '移除引用' }).click();
        await page.waitForFunction(() => (window as any).fixture.state.controller.snapshot().draft.references.length === 0);
        const second = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot();
          await f.state.controller.flush(current.owner); const result = { current, writes: f.state.puts }; f.stopWatchingWrites(); return result;
        });
        assert.equal(second.writes, 1); assert.notEqual(second.current.revision, first.current.revision);
      } finally { await context.close(); }
    });

    await t.test('a committed removal excludes later input until its version is adopted', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'handled'; f.state.delay = true; f.watchWrites(); });
        await page.getByRole('button', { name: '移除引用' }).first().click();
        await page.waitForFunction(() => (window as any).fixture.state.committed);
        const blocked = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, owner = c.snapshot().owner;
          return { inert: document.querySelector('.standalone-composer > div')!.hasAttribute('inert'),
            update: await c.update(owner, (draft: any) => ({ ...draft, text: 'wrong edit' })) };
        });
        assert.deepEqual(blocked, { inert: true, update: false });
        await page.evaluate(() => (window as any).fixture.resumeRemoval());
        await page.waitForFunction(() => (window as any).fixture.state.removed);
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('newer edit B');
        await page.evaluate(async () => { const c = (window as any).fixture.state.controller; await c.flush(c.snapshot().owner); });
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot(), versions = await f.versions(current.owner);
          const result = { current, versions, accepted: f.state.accepted, after: f.state.after, writes: f.state.puts };
          f.stopWatchingWrites(); return result;
        });
        assert.equal(result.accepted, true); assert.equal(result.writes, 2);
        assert.equal(result.current.draft.text, 'newer edit B');
        assert.deepEqual(result.current.draft.references.map((item: any) => item.id), ['ordinary-2']);
        assert.ok(!result.versions.versions.some((v: any) => v.draft.text === 'newer edit B' && v.draft.references.some((item: any) => item.id === 'browser-1')));
        assert.ok(result.versions.versions.some((v: any) => v.revision === result.current.revision));
        assert.equal(await page.getByRole('alert').filter({ hasText: '无法移除引用' }).count(), 0);
      } finally { await context.close(); }
    });

    await t.test('external work registers before its first await and drains through the owner lease', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        const registered = await page.evaluate(() => {
          const f = (window as any).fixture, c = f.state.controller, owner = c.snapshot().owner;
          const wrong = c.beginExternalOperation({ ...owner, hostId: 'other' });
          f.operation = c.beginExternalOperation(owner);
          const duplicate = c.beginExternalOperation(owner);
          f.receipt = f.operation.transaction(async (before: any, isCurrent: () => boolean) => {
            f.selecting = true; await new Promise<void>(resolve => { f.finishSelection = resolve; });
            const after = await f.commit(before, (draft: any) => ({ ...draft, references: [] }), isCurrent);
            return { after, value: 'selected' };
          });
          f.lease = c.freeze(owner); f.drained = f.lease.flush();
          const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
          return { wrong, duplicate, registered: !!f.operation, inert: document.querySelector('.standalone-composer > div')!.hasAttribute('inert'), unload: unload.defaultPrevented,
            afterFreeze: c.beginExternalOperation(owner) };
        });
        assert.deepEqual(registered, { wrong: null, duplicate: null, registered: true, inert: true, unload: true, afterFreeze: null });
        await page.waitForFunction(() => (window as any).fixture.selecting);
        assert.equal(await page.evaluate(async () => {
          const f = (window as any).fixture;
          return Promise.race([f.drained, Promise.resolve('pending')]);
        }), 'pending');
        await page.evaluate(() => (window as any).fixture.finishSelection());
        const receipt = await page.evaluate(async () => {
          const f = (window as any).fixture, receipt = await f.receipt; f.operation.finish(true); return receipt;
        });
        assert.equal(receipt.accepted, true); assert.equal(receipt.value, 'selected');
        assert.equal(await page.evaluate(() => (window as any).fixture.drained), true);
        await page.evaluate(() => (window as any).fixture.lease.release());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('after transaction');
        const snapshot = await page.evaluate(async () => {
          const c = (window as any).fixture.state.controller; await c.flush(c.snapshot().owner); return c.snapshot();
        });
        assert.equal(snapshot.draft.text, 'after transaction'); assert.deepEqual(snapshot.draft.references, []);
      } finally { await context.close(); }
    });

    await t.test('a late external selection cannot mutate a newly mounted owner', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => {
          const f = (window as any).fixture, c = f.state.controller;
          f.oldOwner = c.snapshot().owner; f.operation = c.beginExternalOperation(f.oldOwner);
          f.receipt = f.operation.transaction(async (before: any, isCurrent: () => boolean) => {
            f.selecting = true; await new Promise<void>(resolve => { f.finishSelection = resolve; });
            const after = await f.commit(before, (draft: any) => ({ ...draft, references: [] }), isCurrent);
            return { after, value: null };
          }).then(() => 'committed', () => 'rejected');
        });
        await page.waitForFunction(() => (window as any).fixture.selecting);
        assert.equal(await page.evaluate(() => {
          try { (window as any).fixture.operation.finish(true); return false; } catch { return true; }
        }), true);
        await page.evaluate(() => (window as any).fixture.render({ context: { hostId: 'remote-fixture', draftId: 'draft-b' } }));
        await page.waitForFunction(() => (window as any).fixture.state.controller?.snapshot()?.owner.draftId === 'draft-b');
        await page.evaluate(() => (window as any).fixture.finishSelection());
        assert.equal(await page.evaluate(() => (window as any).fixture.receipt), 'rejected');
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture; f.operation.finish(false); f.operation.finish(false);
          return { current: f.state.controller.snapshot(), versions: await f.versions(f.oldOwner) };
        });
        assert.equal(result.current.owner.draftId, 'draft-b'); assert.equal(result.current.draft.text, '');
        assert.ok(result.versions.versions.some((v: any) => v.draft.references.some((r: any) => r.id === 'browser-1')));
      } finally { await context.close(); }
    });

    await t.test('an already registered asynchronous prefill finishes inside a frozen owner lease', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => {
          const f = (window as any).fixture, c = f.state.controller;
          f.operation = c.beginExternalOperation(c.snapshot().owner);
          f.prefilling = (async () => {
            await new Promise<void>(resolve => { f.finishSelection = resolve; });
            const saved = await f.operation.applyPrefill({ id: 'external-prefill', draft: {
              text: '', images: [], files: [], skills: [], references: [{ id: 'prefill-ref', text: 'Prefilled reference' }],
            } });
            f.operation.finish(saved); return saved;
          })();
          f.lease = c.freeze(c.snapshot().owner); f.drained = f.lease.flush();
        });
        assert.equal(await page.evaluate(() => (window as any).fixture.finishSelection()), undefined);
        assert.equal(await page.evaluate(() => (window as any).fixture.prefilling), true);
        assert.equal(await page.evaluate(() => (window as any).fixture.drained), true);
        const saved = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, snapshot = c.snapshot();
          const versions = await f.versions(snapshot.owner); f.lease.release(); return { snapshot, versions };
        });
        assert.ok(saved.snapshot.draft.references.some((item: any) => item.id === 'prefill-ref'));
        assert.ok(saved.versions.versions.some((item: any) => item.revision === saved.snapshot.revision && item.prefills.includes('external-prefill')));
        const again = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, snapshot = c.snapshot();
          const operation = c.beginExternalOperation(snapshot.owner);
          const accepted = await operation.applyPrefill({ id: 'external-prefill', draft: {
            text: 'must not be merged twice', images: [], files: [], skills: [], references: [],
          } });
          operation.finish(accepted); return { accepted, current: c.snapshot(), snapshot };
        });
        assert.equal(again.accepted, true); assert.deepEqual(again.current, again.snapshot);
      } finally { await context.close(); }
    });

    await t.test('external failure only resolves a projection that can still be verified in storage', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, before = c.snapshot();
          const aborted = c.beginExternalOperation(before.owner);
          try { await aborted.transaction(async () => { throw Error('not committed'); }); } catch {}
          aborted.finish(false);
          const first = await c.flush(before.owner);
          const committed = c.beginExternalOperation(before.owner);
          try { await committed.transaction(async (snapshot: any, isCurrent: () => boolean) => {
            await f.commit(snapshot, (draft: any) => ({ ...draft, references: [] }), isCurrent);
            throw Error('receipt lost');
          }); } catch {}
          committed.finish(false);
          return { first, second: await c.flush(before.owner), current: c.snapshot(), before, versions: await f.versions(before.owner) };
        });
        assert.equal(result.first, true); assert.equal(result.second, false);
        assert.deepEqual(result.current, result.before);
        assert.ok(result.versions.versions.some((version: any) => version.draft.references.length === 0));
        await page.getByRole('button', { name: '保存为独立草稿' }).waitFor();
      } finally { await context.close(); }
    });

    await t.test('a late rich editor transaction remains unresolved instead of restoring a removed reference', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        assert.equal(await page.evaluate(async () => {
          const c = (window as any).fixture.state.controller, owner = c.snapshot().owner;
          return c.update(owner, (draft: any) => ({ ...draft, document: { type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'draft A' }] },
          ] } }));
        }), true);
        const rich = page.locator('.ProseMirror'); await rich.waitFor();
        await page.evaluate(() => {
          const f = (window as any).fixture, c = f.state.controller;
          f.operation = c.beginExternalOperation(c.snapshot().owner);
          f.receipt = f.operation.transaction(async (before: any, isCurrent: () => boolean) => {
            const after = await f.commit(before, (draft: any) => ({ ...draft, references: [] }), isCurrent);
            f.after = after; f.committed = true;
            await new Promise<void>(resolve => { f.finishSelection = resolve; });
            return { after, value: null };
          });
        });
        await page.waitForFunction(() => (window as any).fixture.committed);
        await rich.evaluate(element => {
          const data = new DataTransfer(); data.setData('text/plain', 'pending editor input');
          element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
        });
        const beforeReceipt = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, current = c.snapshot();
          return { current, flushed: await c.flush(current.owner), versions: await f.versions(current.owner) };
        });
        assert.match(beforeReceipt.current.draft.text, /pending editor input/);
        assert.equal(beforeReceipt.flushed, false);
        assert.ok(!beforeReceipt.versions.versions.some((v: any) => v.draft.text.includes('pending editor input')));
        await page.evaluate(() => (window as any).fixture.finishSelection());
        const receipt = await page.evaluate(async () => {
          const f = (window as any).fixture, value = await f.receipt; f.operation.finish(true); return value;
        });
        assert.equal(receipt.accepted, false);
        await page.getByRole('button', { name: '保存为独立草稿' }).click();
        await page.getByRole('button', { name: '保存为独立草稿' }).waitFor({ state: 'detached' });
        const versions = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot(); return f.versions(current.owner);
        });
        assert.ok(versions.versions.some((v: any) => v.revision === receipt.after.revision && !v.draft.references.length));
        assert.ok(versions.versions.some((v: any) => v.draft.text.includes('pending editor input')));
      } finally { await context.close(); }
    });

    await t.test('in-flight deletion drains its committed receipt through the frozen lease', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'handled'; f.state.delay = true; });
        await page.getByRole('button', { name: '移除引用' }).first().click();
        await page.waitForFunction(() => (window as any).fixture.state.committed);
        const blocked = await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, owner = c.snapshot().owner;
          f.lease = c.freeze(owner); f.drain = f.lease.flush();
          return c.update(owner, (draft: any) => ({ ...draft, text: 'must not write' }));
        });
        assert.equal(blocked, false);
        await page.evaluate(() => (window as any).fixture.resumeRemoval());
        assert.equal(await page.evaluate(() => (window as any).fixture.drain), true);
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot();
          const versions = await f.versions(current.owner); f.lease.release(); return { current, versions, accepted: f.state.accepted, after: f.state.after };
        });
        assert.equal(result.accepted, true); assert.deepEqual(result.current, result.after);
        assert.ok(result.versions.versions.some((v: any) => v.revision === result.after.revision));
      } finally { await context.close(); }
    });

    await t.test('a failed receipt during frozen deletion fails the drain without a second removal', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'handled'; f.state.delay = true; });
        await page.getByRole('button', { name: '移除引用' }).first().click();
        await page.waitForFunction(() => (window as any).fixture.state.committed);
        await page.evaluate(async () => {
          const f = (window as any).fixture, c = f.state.controller, owner = c.snapshot().owner;
          f.lease = c.freeze(owner); f.drain = f.lease.flush(); await f.clear(owner, f.state.after.revision); f.resumeRemoval();
        });
        assert.equal(await page.evaluate(() => (window as any).fixture.drain), false);
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot();
          f.lease.release(); return { current, before: f.state.before, accepted: f.state.accepted, versions: await f.versions(current.owner) };
        });
        assert.equal(result.accepted, false); assert.deepEqual(result.current, result.before);
        assert.ok(result.versions.versions.some((v: any) => v.revision === 'independent'));
        assert.equal(await page.getByRole('alert').filter({ hasText: '无法移除引用' }).count(), 0);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
