import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('Mini preserves the actual composer after failed close, target switch and external hide', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneMini } from './src/renderer/mini/index.tsx';
    import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
    const listeners = new Set(), calls = {messages:[],targets:[],flushes:[],opened:[],settings:[]};
    const channel = new BroadcastChannel('mini-test-pet');
    const emit = event => { for (const listener of [...listeners]) listener(event); };
    channel.onmessage = event => emit(event.data);
    let pet = {isOpen:true,visibility:'always-visible',position:null};
    const settings={'selected-avatar-id':'codex','avatar-overlay-mascot-width-px':112,'avatar-overlay-pet-visible':true};
    let context = {hostId:'local',threadId:'thread-a',draftId:'draft-a',cwd:'/fixture',placement:'mini'};
    let controller = null, releaseGate = null, gate = false, holdHide = false, holdRead = false;
    const client = {
      subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
      async host(endpoint,params={}) {
        if(endpoint==='get-settings')return {values:{...settings}};
        if(endpoint==='custom-avatars')return {avatars:[{id:'custom:legacy',displayName:'Legacy',spriteVersionNumber:1,
          spritesheetDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRaoAAAAASUVORK5CYII='}]};
        if(endpoint==='set-setting'){calls.settings.push(params);settings[params.key]=params.value;
          emit({type:'workbench-mini-setting',key:params.key,value:params.value});return {success:true};}
        if(endpoint==='get-setting')return {value:params.key==='composerEnterBehavior'?'cmdAlways':'queue'};
        throw Error('Unexpected host '+endpoint);
      },
      async rpc(method){if(method==='model/list'||method==='thread/queue/list'||method==='skills/list')return {data:[],nextCursor:null};
        if(method==='config/read')return {config:{}};throw Error('Unexpected RPC '+method);},
      async reply(){throw Error('Unexpected reply')}
    };
    const send = async message => {calls.messages.push(message);
      if(message.type==='avatar-overlay-open-state-request'&&holdRead)return;
      if((message.type==='avatar-overlay-close'||message.type==='avatar-overlay-hide')&&holdHide)return;
      if(message.type==='avatar-overlay-close'||message.type==='avatar-overlay-hide')pet={...pet,isOpen:false};
      if(message.type==='avatar-overlay-open'&&message.isOpen===pet.isOpen)pet={...pet,isOpen:!pet.isOpen};
      if(message.type==='workbench-pet-position')pet={...pet,position:message.position};
      emit({type:'workbench-pet-state',state:pet});};
    const connections={local:{state:'connected',fresh:true,revision:'local-1'},'ssh-a':{state:'connected',fresh:true,revision:'remote-1'}};
    const activities=[{hostId:'ssh-a',threadId:'thread-b',title:'Target B',status:'idle',actions:[{id:'follow',kind:'follow-up',label:'Follow B'}]},
      {hostId:'local',threadId:'thread-a',title:'Target A',status:'idle',actions:[{id:'follow',kind:'follow-up',label:'Follow A'}]}];
    async function flush(){const current=controller, snapshot=current?.snapshot(); calls.flushes.push(snapshot?.owner);
      if(gate) await new Promise(resolve=>{releaseGate=resolve});
      return !!snapshot && await current.flush(snapshot.owner);}
    const root=createRoot(document.getElementById('root'));
    function render(){root.render(React.createElement(StandaloneMini,{client,send,activities,bridgeState:'connected',hostConnections:connections,
      pendingRequests:[],quickChatTarget:{hostId:context.hostId,threadId:context.threadId},onOpenThread:x=>calls.opened.push(x),onOpenRequest(){},onExpand(){},
      onRespond:async()=>{},onInputDraftChange(){},onBeforeQuickChatClose:flush,
      onQuickChatTarget:async target=>{calls.targets.push(target);if(!await flush())return false;
        context={hostId:target.hostId,threadId:target.threadId,draftId:target.threadId==='thread-a'?'draft-a':'draft-b',cwd:'/fixture',placement:'mini'};
        render();return true;}},
      React.createElement(StandaloneComposer,{client,context,busy:false,onDraftController:value=>{controller=value},
        onSubmit:async()=>{throw Error('Unexpected submission')},onInterrupt:async()=>{}})));}
    window.miniDraftHarness={calls,render,controller:()=>controller,context:()=>context,
      failWrites(){this.put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){
        if(this.name==='atoms')throw Error('fixture quota');return window.miniDraftHarness.put.apply(this,args)}},
      restoreWrites(){IDBObjectStore.prototype.put=this.put},
      visibility(value){pet={...pet,visibility:value};emit({type:'workbench-pet-state',state:pet})},
      reopen(){pet={...pet,isOpen:true};emit({type:'workbench-pet-state',state:pet})},
      holdHide(){holdHide=true},settleHide(success){holdHide=false;if(success)pet={...pet,isOpen:false};
        emit({type:'workbench-pet-state',state:pet});if(!success)emit({type:'workbench-pet-error',error:'fixture persistence failed'})},
      unconfirm(){holdRead=true;emit({type:'workbench-pet-error',error:'fixture unconfirmed',stateUnconfirmed:true})},
      resumeRead(){holdRead=false},
      gate(){gate=true},release(){gate=false;releaseGate?.()},
      remember(){this.input=document.querySelector('.yard-mini-composer textarea')},
      sameInput(){return this.input===document.querySelector('.yard-mini-composer textarea')},
      dispose(){channel.close();root.unmount()}};
    render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  try {
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<button id="outside">Outside</button><div id="root"></div>' }));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://mini-draft.test/');
    await page.addStyleTag({ content: readFileSync('src/renderer/mini/mini.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    await editor.waitFor();
    await page.waitForFunction(() => !!(window as any).miniDraftHarness.controller()?.snapshot());
    await editor.fill('/');
    await page.getByRole('listbox').waitFor();
    await editor.press('Escape');
    await page.getByRole('listbox').waitFor({ state: 'detached' });
    assert.equal(await editor.isVisible(), true, 'composer handles completion Escape before Mini');
    await editor.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true, isComposing:true })));
    assert.equal(await editor.isVisible(), true, 'IME composition does not close Quick chat');
    await page.locator('#outside').focus();
    await page.keyboard.press('Escape');
    assert.equal(await editor.isVisible(), true, 'main page Escape does not close Quick chat');
    await page.evaluate(() => { (window as any).miniDraftHarness.remember(); (window as any).miniDraftHarness.failWrites(); });
    await editor.fill('unsaved only in the actual composer');
    await page.getByRole('alert').filter({ hasText: '草稿未能保存' }).waitFor();

    await page.getByRole('button', { name: 'Close Quick chat' }).click();
    await page.locator('.yard-mini-composer-status[role="alert"]').filter({ hasText: '草稿未能保存' }).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);

    await page.evaluate(() => (window as any).miniDraftHarness.unconfirm());
    await page.getByRole('alert').filter({ hasText: 'fixture unconfirmed' }).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    const beforeUnconfirmed = await page.evaluate(() => (window as any).miniDraftHarness.calls.messages.length);
    await page.keyboard.press('Meta+Alt+p');
    await page.waitForFunction((before: number) => (window as any).miniDraftHarness.calls.messages.length > before, beforeUnconfirmed);
    assert.equal((await page.evaluate(() => (window as any).miniDraftHarness.calls.messages)).slice(beforeUnconfirmed)
      .some((message: any) => message.type === 'avatar-overlay-open'), false);
    await page.getByRole('button', { name: 'Hide Mini' }).click();
    await page.locator('.yard-mini-composer-status[role="alert"]').filter({ hasText: '草稿未能保存' }).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);
    assert.equal((await page.evaluate(() => (window as any).miniDraftHarness.calls.messages))
      .some((message: any) => message.type === 'avatar-overlay-close'), false);
    await page.evaluate(() => (window as any).miniDraftHarness.resumeRead());
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Mini menu' }).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');

    await page.getByRole('button', { name: 'Follow B' }).click();
    await page.waitForFunction(() => (window as any).miniDraftHarness.calls.targets.length === 1 &&
      !(document.querySelector('[data-mini-composer-content]')?.parentElement as HTMLElement)?.inert &&
      !document.body.textContent?.includes('Opening conversation...'));
    await page.locator('.yard-mini-composer-status[role="alert"]').filter({ hasText: '草稿未能保存' }).waitFor();
    assert.equal((await page.evaluate(() => (window as any).miniDraftHarness.context())).threadId, 'thread-a');
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);
    assert.equal(await page.getByText('Opening conversation...').count(), 0);

    await page.evaluate(() => (window as any).miniDraftHarness.visibility('on-demand'));
    await page.locator('#outside').click();
    await page.waitForFunction(() => (window as any).miniDraftHarness.calls.flushes.length >= 3 &&
      !(document.querySelector('[data-mini-composer-content]')?.parentElement as HTMLElement)?.inert);
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal((await page.evaluate(() => (window as any).miniDraftHarness.calls.messages)).some((m: any) => m.type === 'avatar-overlay-hide'), false);
    await page.evaluate(() => (window as any).miniDraftHarness.visibility('always-visible'));

    const other = await context.newPage();
    await other.goto('http://mini-draft.test/');
    await other.evaluate(() => { const channel = new BroadcastChannel('mini-test-pet');
      channel.postMessage({type:'workbench-pet-state',state:{isOpen:false,visibility:'always-visible',position:null}}); });
    await page.getByRole('button', { name: 'Show Quick chat' }).click();
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);
    await page.getByRole('alert').filter({ hasText: '草稿未能保存' }).first().waitFor();
    await page.evaluate(() => (window as any).miniDraftHarness.restoreWrites());
    await page.getByRole('button', { name: '重试保存' }).click();
    await page.getByRole('button', { name: '重试保存' }).waitFor({ state: 'detached' });
    await page.evaluate(() => (window as any).miniDraftHarness.reopen());
    await page.getByRole('button', { name: 'Follow B' }).click();
    await page.waitForFunction(() => (window as any).miniDraftHarness.controller()?.snapshot()?.owner.threadId === 'thread-b');
    assert.equal(await editor.inputValue(), '');
    await page.getByRole('button', { name: 'Follow A' }).click();
    await page.waitForFunction(() => (window as any).miniDraftHarness.controller()?.snapshot()?.owner.threadId === 'thread-a' &&
      (document.querySelector('.yard-mini-composer textarea') as HTMLTextAreaElement)?.value === 'unsaved only in the actual composer');
    await page.evaluate(() => (window as any).miniDraftHarness.remember());
    await page.evaluate(() => (window as any).miniDraftHarness.holdHide());
    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Hide Mini' }).click();
    await page.waitForFunction(() => !!document.querySelector('[data-mini-composer-content]')?.parentElement?.inert);
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    await page.evaluate(() => (window as any).miniDraftHarness.settleHide(false));
    await page.getByRole('alert').filter({ hasText: 'fixture persistence failed' }).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();

    const hidesBefore = (await page.evaluate(() => (window as any).miniDraftHarness.calls.messages))
      .filter((message: any) => message.type === 'avatar-overlay-close' || message.type === 'avatar-overlay-hide').length;
    await page.evaluate(() => (window as any).miniDraftHarness.gate());
    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Hide Mini' }).click();
    await page.waitForFunction(() => !!document.querySelector('[data-mini-composer-content]')?.parentElement?.inert);
    await page.evaluate(() => { (window as any).miniDraftHarness.unconfirm(); (window as any).miniDraftHarness.release(); });
    await page.locator('.yard-mini-composer-status[role="alert"]').filter({ hasText: 'Mini state changed while saving' }).waitFor();
    assert.equal((await page.evaluate(() => (window as any).miniDraftHarness.calls.messages))
      .filter((message: any) => message.type === 'avatar-overlay-close' || message.type === 'avatar-overlay-hide').length, hidesBefore);
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);
    await page.evaluate(() => (window as any).miniDraftHarness.resumeRead());
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Mini menu' }).waitFor();

    await page.evaluate(() => (window as any).miniDraftHarness.gate());
    await page.getByRole('button', { name: 'Close Quick chat' }).click();
    await page.waitForFunction(() => !!document.querySelector('[data-mini-composer-content]')?.parentElement?.inert);
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);
    await page.evaluate(() => (window as any).miniDraftHarness.release());
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    assert.equal(await editor.inputValue(), 'unsaved only in the actual composer');
    assert.equal(await page.evaluate(() => (window as any).miniDraftHarness.sameInput()), true);

    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Choose pet' }).click();
    await page.getByRole('button', { name: 'Legacy' }).click();
    await page.locator('[data-codex-pet-id="custom:legacy"]').waitFor();
    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Choose pet' }).click();
    await page.getByRole('button', { name: 'Hoots' }).click();
    await page.locator('[data-codex-pet-id="hoots"]').waitFor();
    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Choose pet' }).click();
    const slider = page.getByRole('slider', { name: 'Size' });
    await slider.focus(); await slider.press('End');
    await page.waitForFunction(() => (window as any).miniDraftHarness.calls.settings.some((value: any) =>
      value.key === 'avatar-overlay-mascot-width-px' && value.value === 224));
    await page.getByRole('button', { name: 'Close pet picker' }).click();
    const mascot = page.getByTestId('avatar-mascot-button');
    const bounds = await mascot.boundingBox(); assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 - 80, bounds.y + bounds.height / 2 - 40); await page.mouse.up();
    await page.waitForFunction(() => (window as any).miniDraftHarness.calls.messages.some((value: any) => value.type === 'workbench-pet-position'));
    await page.setViewportSize({ width:360, height:700 });
    await page.waitForFunction(() => {const rect=document.querySelector('[data-workbench-mini]')?.getBoundingClientRect();
      return rect && rect.x>=0 && rect.y>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight});
    assert.deepEqual(errors, []);
    await other.close();
    await page.evaluate(() => (window as any).miniDraftHarness.dispose());
  } finally { await context.close(); await browser.close(); }
});
