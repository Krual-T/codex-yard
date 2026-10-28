import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    miniInteractionHarness: {
      calls: { messages: { type: string }[]; hosts: string[]; replies: { ref: { id: string }; response: unknown }[]; outcomes: unknown[]; actions: unknown[]; targets: unknown[]; submissions: number };
      disconnect(host: string): void;
      reconnect(host: string): void;
      refresh(host: string, revision: string): void;
      remount(): void;
      resolveHeld(): void;
      resolveTarget(): void;
      renewRequests(host: string): void;
    };
  }
}

test('Mini freezes stale hosts, preserves reply certainty, and renders real question and action requests', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneMini } from './src/renderer/mini/index.tsx';
      const listeners = new Set();
      const calls = {messages:[],hosts:[],replies:[],outcomes:[],actions:[],targets:[],submissions:0};
      const emit = event => { for (const listener of [...listeners]) listener(event); };
      const state = {isOpen:true,visibility:'always-visible',position:null};
      const hostConnections = {local:{state:'connected',fresh:true,revision:'l1',requestGeneration:'g2'},'ssh-a':{state:'connected',fresh:true,revision:'r1',requestGeneration:'g1'}};
      let draft='', retryCount=0, actionCount=0, root, resolveHeld, pendingTarget;
      let quickChatTarget={hostId:'ssh-a',threadId:'questions'};
      const heldReply = new Promise(resolve=>{resolveHeld=resolve;});
      const activities = [
        {hostId:'ssh-a',threadId:'remote',title:'Remote work',status:'waiting',detail:'Approval requested',
          approval:{requestRef:{hostId:'ssh-a',generation:'g1',id:'retry'},title:'Run command?',detail:'Fixture command',choices:[{label:'Allow once',result:{decision:'accept'}}]},
          actions:[{id:'stop-1',kind:'stop',label:'Stop task',turnId:'turn-r'},
            {id:'follow-1',kind:'follow-up',label:'Follow up'},
            {id:'plan-1',kind:'implement-plan',label:'Implement plan',turnId:'turn-r',planContent:'- [ ] Fixture',collaborationMode:{mode:'default'}}]},
        {hostId:'local',threadId:'local',title:'Local work',status:'waiting',
          approval:{requestRef:{hostId:'local',generation:'g2',id:'unknown'},title:'Apply changes?',choices:[{label:'Apply changes',result:{decision:'accept'}}]}},
        {hostId:'local',threadId:'held',title:'Pending work',status:'waiting',
          approval:{requestRef:{hostId:'local',generation:'g2',id:'held'},title:'Pending approval',choices:[{label:'Send held approval',result:{decision:'accept'}}]}},
        {hostId:'local',threadId:'forwarded',title:'Forwarded work',status:'waiting',
          approval:{requestRef:{hostId:'local',generation:'g2',id:'forwarded'},title:'Forwarded approval',choices:[{label:'Forward approval',result:{decision:'accept'}}]}},
        {hostId:'ssh-a',threadId:'queue',title:'Pending requests',status:'waiting',requests:[
          {kind:'approval',request:{requestRef:{hostId:'ssh-a',generation:'g1',id:'permission'},title:'More access?',choices:[{label:'Deny access',result:{permissions:{},scope:'turn'}}]}},
          {kind:'approval',request:{requestRef:{hostId:'ssh-a',generation:'g1',id:'elicitation'},title:'Tool request',choices:[{label:'Decline tool',result:{action:'decline',content:null,_meta:null}}]}}]},
        {hostId:'ssh-a',threadId:'questions',title:'Questions',status:'waiting',
          question:{requestRef:{hostId:'ssh-a',generation:'g1',id:'question'},title:'Choose settings',questions:[
            {id:'first',header:'Environment',question:'Which environment?',isOther:true,isSecret:false,options:[{label:'Staging',description:'Test changes'}]},
            {id:'secret',header:'Access',question:'Access code?',isOther:false,isSecret:true,options:null}]}}
      ];
      const client = {rpc:async()=>{throw Error('Unexpected RPC');},
        subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
        host:async(endpoint,params)=>{calls.hosts.push(endpoint);if(endpoint==='get-settings')return {values:{}};
          if(endpoint==='custom-avatars')return {avatars:[]};throw Error('Unexpected host write');},
        reply:async(ref,response)=>{calls.replies.push({ref,response});
          if(ref.id==='retry' && retryCount++===0)throw Object.assign(Error('Host refused before forwarding'),{forwarded:false,uncertain:false});
          if(ref.id==='unknown')throw Object.assign(Error('Reply acknowledgement lost'),{uncertain:true});
          if(ref.id==='forwarded')throw Object.assign(Error('Forwarded to the daemon'),{forwarded:true,uncertain:false});
          if(ref.id==='held')await heldReply;}
      };
      const send = async message=>{calls.messages.push(message);if(message.type==='avatar-overlay-open-state-request')emit({type:'workbench-pet-state',state});};
      function render(){root.render(React.createElement(StandaloneMini,{client,send,activities,hostConnections,quickChatTarget,shortcut:true,
        onOpenThread:()=>{},onExpand:()=>{},
        onQuickChatTarget:identity=>{calls.targets.push(identity);pendingTarget=identity;render();},
        onApprovalOutcome:(ref,outcome)=>{calls.outcomes.push({ref,outcome});for(const activity of activities){
          for(const request of [activity.approval,activity.question,...(activity.requests??[]).map(item=>item.request)])if(request?.requestRef.id===ref.id)request.outcome=outcome;}render();},
        onNotificationAction:async(identity,action)=>{calls.actions.push({identity,action:{...action}});
          if(actionCount++===0)throw Object.assign(Error('Stop was not forwarded'),{uncertain:false});},
        onNotificationActionOutcome:(identity,action,outcome)=>{calls.outcomes.push({identity,id:action.id,outcome});action.outcome=outcome;render();}},
        React.createElement('div',null,React.createElement('code',null,'Fixture code'),React.createElement('textarea',{'aria-label':'Quick draft',value:draft,onChange:e=>{draft=e.target.value;render();}}),
          React.createElement('button',{type:'button',onClick:()=>{calls.submissions++;}},'Send draft'))));}
      function mount(){root=createRoot(document.getElementById('root'));render();}
      window.miniInteractionHarness={calls,
        disconnect(host){hostConnections[host]={...hostConnections[host],state:'disconnected',fresh:false};emit({type:'codex-app-server-connection-changed',hostId:host,state:'disconnected'});render();},
        reconnect(host){hostConnections[host]={...hostConnections[host],state:'connected',fresh:false};emit({type:'codex-app-server-connection-changed',hostId:host,state:'connected'});render();},
        refresh(host,revision){const generations={r1:'g1',r2:'g3',r3:'g4',l2:'g5'};
          hostConnections[host]={...hostConnections[host],state:'connected',fresh:true,revision,requestGeneration:generations[revision]};render();},
        renewRequests(host){for(const activity of activities)if(activity.hostId===host){
          for(const request of [activity.approval,activity.question,...(activity.requests??[]).map(item=>item.request)])
            if(request)request.requestRef={...request.requestRef,generation:hostConnections[host].requestGeneration};}render();},
        remount(){root.unmount();mount();},resolveHeld(){resolveHeld();},resolveTarget(){quickChatTarget=pendingTarget;render();}};
      mount();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<style>:root{--yard-fg:#edf3f4;--yard-bg:#101719;--yard-surface:#242c2e;--yard-muted:#b6c2c5;--yard-border:#627276;--yard-accent:#8acaff;--yard-ui-font:monospace;--yard-content-font:serif;--yard-code-font:sans-serif;--yard-font-size:18px;--yard-code-size:19px}body{background:#101719}</style><div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/mini/mini.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByText('Remote work').waitFor();
    assert.equal(await page.locator('.yard-mini-activity').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 44, 46)');
    assert.equal(await page.locator('.yard-mini-activity').first().evaluate(el => getComputedStyle(el).color), 'rgb(237, 243, 244)');
    assert.match(await page.locator('.yard-mini').evaluate(el => getComputedStyle(el).fontFamily), /monospace/);
    assert.equal(await page.locator('.yard-mini').evaluate(el => getComputedStyle(el).fontSize), '18px');
    assert.match(await page.getByText('Fixture command').evaluate(el => getComputedStyle(el).fontFamily), /serif/);

    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    assert.equal(await page.getByText('Fixture code').evaluate(el => getComputedStyle(el).fontSize), '19px');
    assert.match(await page.getByText('Fixture code').evaluate(el => getComputedStyle(el).fontFamily), /sans-serif/);
    assert.equal(await page.getByRole('textbox', { name: 'Quick draft' }).evaluate(element => document.activeElement === element), true);
    await page.getByRole('textbox', { name: 'Quick draft' }).fill('retained draft');
    await page.evaluate(() => {
      const approval = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Allow once')!;
      window.miniInteractionHarness.disconnect('ssh-a'); approval.click();
    });
    await page.getByText('Connection lost. Activity paused.').first().waitFor();
    assert.equal((await page.evaluate(() => window.miniInteractionHarness.calls.replies)).length, 0, 'a click in the same event turn as disconnect cannot send');
    assert.equal(await page.getByRole('button', { name: 'Allow once' }).isDisabled(), true);
    assert.equal(await page.locator('.yard-mini-composer [inert]').count(), 1);
    await page.getByRole('button', { name: 'Quick chat', exact: true }).focus();
    await page.evaluate(() => window.miniInteractionHarness.reconnect('ssh-a'));
    await page.evaluate(() => window.miniInteractionHarness.refresh('ssh-a', 'r1'));
    assert.equal(await page.getByRole('button', { name: 'Allow once' }).isDisabled(), true, 'old revision cannot unfreeze a reconnected host');
    await page.evaluate(() => window.miniInteractionHarness.refresh('ssh-a', 'r2'));
    await page.waitForFunction(() => !document.querySelector('.yard-mini-composer [inert]'));
    assert.equal(await page.getByRole('button', { name: 'Quick chat', exact: true }).evaluate(element => document.activeElement === element), true);
    assert.equal(await page.getByRole('button', { name: 'Allow once' }).isDisabled(), true, 'a refreshed host cannot reuse an old request generation');
    await page.getByText('Request expired. Open the conversation to check its status.').first().waitFor();
    await page.evaluate(() => window.miniInteractionHarness.renewRequests('ssh-a'));
    assert.equal(await page.getByRole('button', { name: 'Allow once' }).isEnabled(), true);
    assert.equal(await page.getByRole('textbox', { name: 'Quick draft' }).inputValue(), 'retained draft');

    const beforeLocalLoss = await page.evaluate(() => ({ messages: window.miniInteractionHarness.calls.messages.length,
      hosts: window.miniInteractionHarness.calls.hosts.length, replies: window.miniInteractionHarness.calls.replies.length }));
    await page.evaluate(() => window.miniInteractionHarness.disconnect('local'));
    await page.getByText('Connection lost. Activity is paused.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Apply changes' }).isDisabled(), true);
    await page.keyboard.press('Meta+Alt+p');
    await page.evaluate(() => window.miniInteractionHarness.reconnect('local'));
    await page.evaluate(() => window.miniInteractionHarness.refresh('local', 'l2'));
    assert.equal(await page.getByRole('button', { name: 'Allow once' }).isDisabled(), true, 'local bridge loss invalidates remote projections too');
    await page.evaluate(() => window.miniInteractionHarness.refresh('ssh-a', 'r3'));
    await page.waitForFunction(() => !document.querySelector('.yard-mini-composer [inert]'));
    assert.equal(await page.getByRole('button', { name: 'Allow once' }).isDisabled(), true);
    await page.evaluate(() => { window.miniInteractionHarness.renewRequests('local'); window.miniInteractionHarness.renewRequests('ssh-a'); });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Allow once')?.disabled);
    const afterLocalLoss = await page.evaluate(() => window.miniInteractionHarness.calls);
    assert.deepEqual(afterLocalLoss.messages.slice(beforeLocalLoss.messages).map(value => value.type), ['avatar-overlay-open-state-request']);
    assert.deepEqual(afterLocalLoss.hosts.slice(beforeLocalLoss.hosts), ['get-settings', 'custom-avatars']);
    assert.equal(afterLocalLoss.replies.length, beforeLocalLoss.replies);
    assert.equal(afterLocalLoss.submissions, 0);
    assert.equal(await page.getByRole('textbox', { name: 'Quick draft' }).inputValue(), 'retained draft');
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.getByRole('button', { name: 'Follow up' }).click();
    await page.getByText('Opening conversation...').waitFor();
    assert.equal(await page.locator('.yard-mini-composer [inert]').count(), 1);
    assert.deepEqual(await page.evaluate(() => window.miniInteractionHarness.calls.targets), [{ hostId: 'ssh-a', threadId: 'remote' }]);
    await page.evaluate(() => window.miniInteractionHarness.resolveTarget());
    await page.waitForFunction(() => !document.querySelector('.yard-mini-composer [inert]'));
    assert.equal(await page.getByRole('textbox', { name: 'Quick draft' }).inputValue(), 'retained draft');
    assert.equal(await page.getByRole('textbox', { name: 'Quick draft' }).evaluate(element => document.activeElement === element), true);
    await page.getByRole('button', { name: 'Close Quick chat' }).click();
    assert.equal(await page.getByRole('button', { name: 'Quick chat', exact: true }).evaluate(element => document.activeElement === element), true);
    assert.equal((await page.evaluate(() => window.miniInteractionHarness.calls.submissions)), 0);

    const allow = page.getByRole('button', { name: 'Allow once' });
    await allow.click();
    await page.getByRole('alert').filter({ hasText: 'Not sent: Host refused before forwarding' }).waitFor();
    assert.equal(await allow.isEnabled(), true);
    assert.equal((await page.evaluate(() => window.miniInteractionHarness.calls.outcomes)).length, 0);
    await allow.click();
    await page.getByText('Response sent').first().waitFor();
    const retried = (await page.evaluate(() => window.miniInteractionHarness.calls.replies)).filter(value => value.ref.id === 'retry');
    assert.equal(retried.length, 2);
    assert.deepEqual(retried[0], retried[1]);
    assert.deepEqual(retried[1], { ref: { hostId: 'ssh-a', generation: 'g4', id: 'retry' }, response: { result: { decision: 'accept' } } });

    await page.getByRole('button', { name: 'Apply changes' }).click();
    await page.getByRole('alert').filter({ hasText: 'Reply acknowledgement lost' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Apply changes' }).isDisabled(), true);
    await page.evaluate(() => window.miniInteractionHarness.remount());
    await page.getByText('Remote work').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Apply changes' }).isDisabled(), true);
    assert.equal((await page.evaluate(() => window.miniInteractionHarness.calls.replies)).filter(value => value.ref.id === 'unknown').length, 1);

    await page.getByRole('button', { name: 'Send held approval' }).click();
    await page.evaluate(() => window.miniInteractionHarness.remount());
    await page.getByText('Pending work').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Send held approval' }).isDisabled(), true);
    await page.evaluate(() => window.miniInteractionHarness.resolveHeld());
    await page.waitForFunction(() => window.miniInteractionHarness.calls.outcomes.some(value => JSON.stringify(value).includes('held')));
    assert.equal((await page.evaluate(() => window.miniInteractionHarness.calls.replies)).filter(value => value.ref.id === 'held').length, 1);
    assert.equal(await page.getByRole('button', { name: 'Send held approval' }).isDisabled(), true);

    await page.getByRole('button', { name: 'Forward approval' }).click();
    await page.getByText('Response sent: Forwarded to the daemon').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Forward approval' }).isDisabled(), true);
    assert.ok((await page.evaluate(() => window.miniInteractionHarness.calls.outcomes)).some(value => JSON.stringify(value).includes('"id":"forwarded"') && JSON.stringify(value).includes('"outcome":"sent"')));

    await page.getByRole('button', { name: 'Stop task' }).click();
    await page.getByRole('alert').filter({ hasText: 'Not sent: Stop was not forwarded' }).waitFor();
    await page.getByRole('button', { name: 'Stop task' }).click();
    assert.equal(await page.getByRole('button', { name: 'Stop task' }).isDisabled(), true);
    const actions = await page.evaluate(() => window.miniInteractionHarness.calls.actions);
    assert.equal(actions.length, 2);
    assert.deepEqual(actions[0], { identity: { hostId: 'ssh-a', threadId: 'remote' }, action: { id: 'stop-1', kind: 'stop', label: 'Stop task', turnId: 'turn-r' } });
    await page.getByRole('button', { name: 'Implement plan' }).click();
    assert.deepEqual((await page.evaluate(() => window.miniInteractionHarness.calls.actions)).at(-1), {
      identity: { hostId: 'ssh-a', threadId: 'remote' }, action: { id: 'plan-1', kind: 'implement-plan', label: 'Implement plan',
        turnId: 'turn-r', planContent: '- [ ] Fixture', collaborationMode: { mode: 'default' } },
    });

    await page.getByRole('button', { name: 'Deny access' }).click();
    await page.getByRole('button', { name: 'Decline tool' }).click();
    const queued = await page.evaluate(() => window.miniInteractionHarness.calls.replies.filter(value => value.ref.id === 'permission' || value.ref.id === 'elicitation'));
    assert.deepEqual(queued, [
      { ref: { hostId: 'ssh-a', generation: 'g4', id: 'permission' }, response: { result: { permissions: {}, scope: 'turn' } } },
      { ref: { hostId: 'ssh-a', generation: 'g4', id: 'elicitation' }, response: { result: { action: 'decline', content: null, _meta: null } } },
    ]);

    await page.getByRole('radio', { name: /Staging/ }).check();
    const secret = page.getByLabel('Access code? answer');
    assert.equal(await secret.getAttribute('type'), 'password');
    await secret.fill('fixture-code');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await page.waitForFunction(() => window.miniInteractionHarness.calls.replies.some(value => value.ref.id === 'question'));
    assert.deepEqual((await page.evaluate(() => window.miniInteractionHarness.calls.replies)).find(value => value.ref.id === 'question'),
      { ref: { hostId: 'ssh-a', generation: 'g4', id: 'question' }, response: { result: { answers: { first: { answers: ['Staging'] }, secret: { answers: ['fixture-code'] } } } } });

    await page.setViewportSize({ width: 360, height: 700 });
    await page.waitForFunction(() => { const rect = document.querySelector('[data-workbench-mini]')?.getBoundingClientRect();
      return rect && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; });
    const mini = await page.locator('[data-workbench-mini]').boundingBox();
    assert.ok(mini && mini.x >= 0 && mini.y >= 0 && mini.x + mini.width <= 360 && mini.y + mini.height <= 700);
    assert.ok((await page.getByRole('button', { name: 'Quick chat', exact: true }).boundingBox())!.height >= 40);
    assert.equal(await page.locator('.yard-mini-content').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (process.env.MINI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MINI_EVIDENCE_DIR, 'mini-dark-mobile.png') });
    await page.evaluate(() => { document.documentElement.style.setProperty('--yard-fg', '#202123'); document.documentElement.style.setProperty('--yard-surface', '#fff');
      document.documentElement.style.setProperty('--yard-bg', '#f4f5f6'); document.documentElement.style.setProperty('--yard-muted', '#596369'); document.documentElement.style.setProperty('--yard-border', '#aab4b7'); });
    assert.equal(await page.locator('.yard-mini-activity').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    assert.equal(await page.locator('.yard-mini-activity').first().evaluate(el => getComputedStyle(el).color), 'rgb(32, 33, 35)');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
