import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('pending local draft revisions do not appear as conflicts; real branches remain visible', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
    import { writeComposerDraftVersion, readComposerDraftVersions } from './src/renderer/composer/composer-draft-store.ts';
    const state={controller:null,snapshots:[]};
    const client={async rpc(method){
      if(method==='model/list')return {data:[],nextCursor:null};
      if(method==='config/read')return {config:{}};
      throw Error('unexpected RPC '+method);
    },async host(method){if(method==='get-setting')return {value:'cmdAlways'};throw Error('unexpected host '+method)},
      subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    root.render(React.createElement(StandaloneComposer,{client,context:{hostId:'local',threadId:null,draftId:'pending',cwd:'/fixture'},busy:false,
      onDraftController(value){state.controller=value},onDraftChange(value){state.snapshots.push(value)},async onSubmit(){},async onInterrupt(){}}));
    window.fixture={state,writeComposerDraftVersion,readComposerDraftVersions,async hold(){
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      const tx=db.transaction('atoms','readwrite'),store=tx.objectStore('atoms');let released=false;
      const done=new Promise((resolve,reject)=>{tx.onabort=()=>reject(tx.error);tx.oncomplete=()=>{db.close();resolve()}});
      await new Promise((resolve,reject)=>{let first=true;const loop=()=>{const request=store.get('native-atoms');
        request.onerror=()=>reject(request.error);request.onsuccess=()=>{if(!released)loop();if(first){first=false;resolve()}}};loop()});
      this.release=()=>{released=true;return done};
    }};
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://composer.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => (window as any).fixture.state.snapshots.length > 0);
    await page.evaluate(async () => {
      const fixture = (window as any).fixture;
      fixture.notices = [];
      fixture.observer = new MutationObserver(() => {
        if (document.body.textContent?.includes('其他页面或旧数据中有')) fixture.notices.push('conflict');
      });
      fixture.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      await fixture.hold();
    });
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.fill('one'); await editor.fill('one two'); await editor.fill('one two three');
    await page.evaluate(async () => {
      const fixture = (window as any).fixture;
      await fixture.release();
      const controller = fixture.state.controller;
      await controller.flush(controller.snapshot().owner);
    });
    await page.getByText('正在保存草稿…').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.notices), []);
    assert.equal(await editor.inputValue(), 'one two three');

    await page.evaluate(async () => {
      const fixture = (window as any).fixture, snapshot = fixture.state.controller.snapshot();
      await fixture.writeComposerDraftVersion(snapshot.owner, 'stale-other-page', {
        revision: 'other-page', draft: { ...snapshot.draft, text: 'other page' }, prefills: [],
      });
    });
    await page.getByText('其他页面或旧数据中有 1 份独立草稿。', { exact: false }).waitFor();
    const versions = await page.evaluate(async () => {
      const fixture = (window as any).fixture, owner = fixture.state.controller.snapshot().owner;
      return (await fixture.readComposerDraftVersions(owner)).versions.map((version: any) => version.draft.text).sort();
    });
    assert.deepEqual(versions, ['one two three', 'other page']);
  } finally { await browser.close(); }
});
