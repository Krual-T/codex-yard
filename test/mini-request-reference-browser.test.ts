import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('Mini opens the original request and shares reply state with its parent', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneMini } from './src/renderer/mini/index.tsx';
    const listeners=new Set(), calls={threads:[],opens:[],writes:[],rejected:0};
    const emit=event=>{for(const listener of [...listeners])listener(event)};
    const client={subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
      async host(endpoint){return endpoint==='get-settings'?{values:{}}:{avatars:[]}}};
    const send=async()=>emit({type:'workbench-pet-state',state:{isOpen:true,visibility:'always-visible',position:null}});
    const refs={
      old:{hostId:'local',id:'same',generation:'old'}, newer:{hostId:'local',id:'same',generation:'new'},
      other:{hostId:'local',id:'other',generation:'other'}, remote:{hostId:'ssh-a',id:'same',generation:'new'},
      question:{hostId:'local',id:'question',generation:'q1'},
      oldReply:{hostId:'local',id:'reply',generation:'r1'}, newReply:{hostId:'local',id:'reply',generation:'r2'}
    };
    const open=(ref,title,outcome)=>({kind:'open',request:{requestRef:ref,title,outcome}});
    const oldReply={kind:'approval',request:{requestRef:refs.oldReply,title:'Old reply',outcome:'ready',choices:[{label:'Reply old',result:{decision:'accept'}}]}};
    const newReply={kind:'approval',request:{requestRef:refs.newReply,title:'New reply',outcome:'ready',choices:[{label:'Reply new',result:{decision:'accept'}}]}};
    const question={kind:'question',request:{requestRef:refs.question,title:'Shared question',outcome:'ready',inputDraft:{},questions:[
      {id:'q',header:'Choice',question:'Choose one',isOther:false,isSecret:false,options:[{label:'First',description:''},{label:'Second',description:''}]}]}};
    const records=[open(refs.old,'Old complex','expired'),open(refs.newer,'New complex','ready'),
      open(refs.other,'Other complex','sending'),open(refs.remote,'Remote complex','unknown'),oldReply,newReply,question];
    let bridge='connected',pending=[refs.newer,refs.other,refs.remote,refs.newReply,refs.question], release;
    const hosts={local:{state:'connected',fresh:true,revision:'l1'},'ssh-a':{state:'connected',fresh:true,revision:'s1'}};
    const same=(a,b)=>a.hostId===b.hostId&&a.id===b.id&&a.generation===b.generation;
    const entry=ref=>records.find(item=>same(item.request.requestRef,ref));
    function changeDraft(ref,draft){const item=entry(ref);
      if(item?.request.outcome==='ready'&&pending.some(value=>same(value,ref))){item.request.inputDraft=draft;render()}}
    async function respond(ref,result,source){const item=entry(ref);
      if(!item||item.request.outcome!=='ready'||!pending.some(value=>same(value,ref))||bridge!=='connected'){
        calls.rejected++;throw Error('Original request unavailable');}
      item.request.outcome='sending';calls.writes.push({ref,result,source,original:ref===item.request.requestRef});render();
      if(ref===refs.question)await new Promise(resolve=>{release=resolve});
      if(item.request.outcome==='sending')item.request.outcome='sent';render();
    }
    const root=createRoot(document.getElementById('root'));
    function render(){const activities=['local','ssh-a'].map(hostId=>({hostId,threadId:'shared-thread',title:hostId+' thread',status:'waiting',
      requests:records.filter(item=>item.request.requestRef.hostId===hostId).map(item=>({...item,request:{...item.request}}))}));
      const selected=question.request.inputDraft.q?.selected??'First';
      root.render(React.createElement(React.Fragment,null,
        React.createElement('section',{'aria-label':'Main approval'},
          React.createElement('span',null,'Main selected: '+selected),
          React.createElement('button',{disabled:question.request.outcome!=='ready',onClick:()=>changeDraft(refs.question,{q:{selected:'First',other:''}})},'Main choose First'),
          React.createElement('button',{disabled:question.request.outcome!=='ready',onClick:()=>void respond(refs.question,{answers:{q:{answers:[selected]}}},'main').catch(()=>{})},'Main submit')),
        React.createElement(StandaloneMini,{client,send,activities,bridgeState:bridge,hostConnections:hosts,pendingRequests:pending,
          onOpenThread:identity=>calls.threads.push(identity),
          onOpenRequest:(identity,ref)=>calls.opens.push({identity,ref,original:Object.values(refs).includes(ref)}),
          onExpand(){},onBeforeQuickChatClose:async()=>true,onInputDraftChange:changeDraft,
          onRespond:(ref,result)=>respond(ref,result,'mini')})));
    }
    window.referenceHarness={calls,refs,records,
      mainThenStaleMini(){void respond(refs.question,{answers:{q:{answers:['First']}}},'main').catch(()=>{});
        document.querySelector('.yard-mini-question button[type=submit]').click()},
      disconnectRemote(){hosts['ssh-a']={...hosts['ssh-a'],state:'disconnected',fresh:false};
        pending=pending.filter(ref=>ref.hostId!=='ssh-a');emit({type:'codex-app-server-connection-changed',hostId:'ssh-a',state:'disconnected'});render()},
      disconnectBridge(){bridge='disconnected';pending=[];
        for(const item of records)if(item.request.outcome==='sending')item.request.outcome='unknown';
        else if(item.request.outcome==='ready')item.request.outcome='expired';
        emit({type:'connection-state',state:'disconnected'});render()},
      reconnect(){bridge='connected';hosts.local={state:'connected',fresh:true,revision:'l2'};
        hosts['ssh-a']={state:'connected',fresh:true,revision:'s2'};
        emit({type:'connection-state',state:'connected'});emit({type:'codex-app-server-connection-changed',hostId:'ssh-a',state:'connected'});render()},
      finish(){release?.()},dispose(){root.unmount()}};
    render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  try {
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://mini-reference.test/');
    await page.addStyleTag({ content: readFileSync('src/renderer/mini/mini.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const request = (title: string) => page.locator('.yard-mini-request').filter({ has: page.getByText(title, { exact: true }) });
    await request('Old complex').getByRole('button', { name: 'Open conversation' }).click();
    await request('New complex').getByRole('button', { name: 'Open conversation' }).click();
    await request('Other complex').getByRole('button', { name: 'Open conversation' }).click();
    await request('Remote complex').getByRole('button', { name: 'Open conversation' }).click();
    await page.getByRole('button', { name: /local thread/ }).click();
    const opens = await page.evaluate(() => (window as any).referenceHarness.calls.opens);
    assert.deepEqual(opens, [
      {identity:{hostId:'local',threadId:'shared-thread'},ref:{hostId:'local',id:'same',generation:'old'},original:true},
      {identity:{hostId:'local',threadId:'shared-thread'},ref:{hostId:'local',id:'same',generation:'new'},original:true},
      {identity:{hostId:'local',threadId:'shared-thread'},ref:{hostId:'local',id:'other',generation:'other'},original:true},
      {identity:{hostId:'ssh-a',threadId:'shared-thread'},ref:{hostId:'ssh-a',id:'same',generation:'new'},original:true},
    ]);
    assert.deepEqual(await page.evaluate(() => (window as any).referenceHarness.calls.threads), [{hostId:'local',threadId:'shared-thread'}]);
    assert.equal(await page.getByRole('button', { name: 'Reply old' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Reply new' }).click();
    await page.getByText('Response sent', { exact: true }).waitFor();
    await page.getByRole('radio', { name: 'Second' }).check();
    await page.getByText('Main selected: Second').waitFor();
    await page.getByRole('button', { name: 'Main choose First' }).click();
    assert.equal(await page.getByRole('radio', { name: 'First' }).isChecked(), true);
    await page.evaluate(() => (window as any).referenceHarness.disconnectRemote());
    assert.equal(await page.getByRole('button', { name: 'Submit answer' }).isEnabled(), true);
    await request('Remote complex').getByRole('button', { name: 'Open conversation' }).click();
    await page.evaluate(() => (window as any).referenceHarness.mainThenStaleMini());
    await request('Shared question').getByText('Sending...', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Submit answer' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Main submit' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).referenceHarness.calls.rejected), 1);
    await page.evaluate(() => (window as any).referenceHarness.disconnectBridge());
    await request('Shared question').getByText('Response could not be confirmed.', { exact: false }).waitFor();
    await request('New complex').getByRole('button', { name: 'Open conversation' }).click();
    await page.evaluate(() => { (window as any).referenceHarness.reconnect(); (window as any).referenceHarness.finish(); });
    assert.equal(await page.getByRole('button', { name: 'Submit answer' }).isDisabled(), true);
    await request('Shared question').getByText('Response could not be confirmed.', { exact: false }).waitFor();
    const calls = await page.evaluate(() => (window as any).referenceHarness.calls);
    assert.deepEqual(calls.writes, [
      {ref:{hostId:'local',id:'reply',generation:'r2'},result:{decision:'accept'},source:'mini',original:true},
      {ref:{hostId:'local',id:'question',generation:'q1'},result:{answers:{q:{answers:['First']}}},source:'main',original:true},
    ]);
    assert.equal(calls.opens.length, 6);
    assert.deepEqual(calls.opens[4].ref, {hostId:'ssh-a',id:'same',generation:'new'});
    assert.deepEqual(calls.opens[5].ref, {hostId:'local',id:'same',generation:'new'});
    assert.deepEqual(errors, []);
    await page.evaluate(() => (window as any).referenceHarness.dispose());
  } finally {
    await context.close();
    await browser.close();
  }
});
