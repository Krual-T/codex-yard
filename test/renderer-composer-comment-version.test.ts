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
      async onRemoveReference(owner,reference){
        if(state.mode==='default'){state.removed=true;return;}
        const controller=state.controller, before=controller.snapshot();
        state.before=before;
        const after=await fixture.commit(before,draft=>({...draft,references:draft.references.filter(item=>item.id!==reference.id)}));
        state.after=after;state.committed=true;
        if(state.delay)await new Promise(resolve=>{resumeRemoval=resolve});
        state.accepted=await controller.acceptCommittedVersion(before,after);
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
      async commit(before,change){return updateBrowserAtoms(atoms=>{
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
          await f.state.controller.flush(current.owner); return { current, versions: await f.versions(current.owner) };
        });
        assert.equal(result.current.draft.text, 'newer edit B');
        assert.equal(result.current.draft.references[0].id, 'browser-1');
        assert.ok(result.versions.versions.some((v: any) => v.revision === receipt.after.revision));
        assert.ok(result.versions.versions.some((v: any) => v.revision === result.current.revision));
        assert.ok(result.versions.versions.some((v: any) => v.revision === 'independent'));
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
        await page.getByText('Selected element').waitFor();
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

    await t.test('a committed removal with newer input stays handled without deleting from the newer draft', async () => {
      const context = await browser.newContext();
      try {
        const page = await pageFor(context); await seed(page);
        await page.evaluate(() => { const f = (window as any).fixture; f.state.mode = 'handled'; f.state.delay = true; f.watchWrites(); });
        await page.getByRole('button', { name: '移除引用' }).first().click();
        await page.waitForFunction(() => (window as any).fixture.state.committed);
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).fill('newer edit B');
        await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot(); await f.state.controller.flush(current.owner); f.resumeRemoval();
        });
        await page.waitForFunction(() => (window as any).fixture.state.removed);
        const result = await page.evaluate(async () => {
          const f = (window as any).fixture, current = f.state.controller.snapshot(), versions = await f.versions(current.owner);
          const result = { current, versions, accepted: f.state.accepted, after: f.state.after, writes: f.state.puts };
          f.stopWatchingWrites(); return result;
        });
        assert.equal(result.accepted, false); assert.equal(result.writes, 2);
        assert.equal(result.current.draft.text, 'newer edit B');
        assert.equal(result.current.draft.references[0].id, 'browser-1');
        assert.ok(result.versions.versions.some((v: any) => v.revision === result.after.revision));
        assert.ok(result.versions.versions.some((v: any) => v.revision === result.current.revision));
        assert.equal(await page.getByRole('alert').filter({ hasText: '无法移除引用' }).count(), 0);
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
