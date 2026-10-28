import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    interactionHarness: {
      show(options?: Record<string, unknown>): void;
      update(options: Record<string, unknown>): void;
      setManual(phase: string, revision: number): void;
      setManager(phase: string, revision: number): void;
      removeManual(): void;
      restoreManual(): void;
      addAcknowledgement(): void;
      release(): void;
      summary(): { actions: { kind: string; action: string; provider?: string; scope: Record<string, unknown>; aborted: boolean }[];
        replies: unknown[]; acknowledgements: Record<string, unknown>[] };
    };
  }
}

test('passkey takeover and password-manager actions stay with the original browser host', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: [
    "import React from 'react';",
    "import {createRoot} from 'react-dom/client';",
    "import {flushSync} from 'react-dom';",
    "import {ApprovalDialog} from './src/renderer/app/ApprovalDialog.tsx';",
    'const root=createRoot(document.getElementById("root"));let current,next=0,actions=[],replies=[],acknowledgements=[],release;',
    'const outcomes=new Map();',
    'function scope(){const {request,options}=current;return {ref:request.ref,hostId:request.ref.hostId,threadId:"thread-a",challengeId:request.params._meta.browser_auth_challenge_id,accountId:options.account,userId:"user-a",serverName:"node_repl",origin:"https://example.test"};}',
    'function action(kind,request){actions.push({kind,...request});if(current.options.fail)throw Error("synthetic private failure");if(current.options.deferred)return new Promise(resolve=>{release=resolve;});return Promise.resolve();}',
    'function render(){const {request,manual,manager,ack,options}=current;const binding=scope();root.render(<ApprovalDialog request={request} stateRef={request.ref} outcome={outcomes.get(JSON.stringify(request.ref))??"ready"}',
    ' onOutcome={(ref,value)=>{outcomes.set(JSON.stringify(ref),value);if(current.request.ref.id===ref.id)render();}} onInputDraftChange={()=>{}} onFormDraftChange={()=>{}} browserAuthBinding={binding}',
    ' browserAuthManual={manual} onBrowserAuthManualAction={options.manualCallback===false?undefined:request=>action("manual",request)}',
    ' browserAuthPasswordManager={manager} onBrowserAuthPasswordManagerAction={options.managerCallback===false?undefined:request=>action("manager",request)}',
    ' browserAuthAcknowledgement={ack} onAcknowledgeBrowserAuth={async value=>{acknowledgements.push(structuredClone(value));}} onCheckRequestValidity={async()=>true}',
    ' onSubmitBrowserAuth={async()=>{throw Error("unexpected private field submission");}} onRespond={async value=>{replies.push(value);}} onUnsupported={async()=>{}} />);}',
    'window.interactionHarness={',
    ' show(options={}){let id=++next,ref={hostId:"host-a",generation:"generation-"+id,id};options={account:"account-a",...options};',
    '  current={options,request:{ref,hostId:ref.hostId,id,method:"mcpServer/elicitation/request",params:{threadId:"thread-a",serverName:"node_repl",mode:"form",requestedSchema:{type:"object",properties:{}},_meta:{codex_approval_kind:"browser_auth",browser_auth_challenge_id:"a".repeat(32),origin:"https://example.test",reason:"Sign in",fields:options.fields??[],webauthn:options.webauthn?{}:null}}}};',
    '  if(options.manual){current.manual={scope:scope(),revision:1,phase:"available"};current.originalManual=current.manual;}if(options.manager)current.manager={scope:scope(),revision:1,phase:"available",provider:"onepassword"};flushSync(render);},',
    ' update(options){current.options={...current.options,...options};if(options.challenge)current.request={...current.request,params:{...current.request.params,_meta:{...current.request.params._meta,browser_auth_challenge_id:options.challenge}}};flushSync(render);},',
    ' setManual(phase,revision){current.manual={...current.manual,phase,revision};flushSync(render);},setManager(phase,revision){current.manager={...current.manager,phase,revision};flushSync(render);},',
    ' removeManual(){current.manual=undefined;flushSync(render);},restoreManual(){current.manual=current.originalManual;flushSync(render);},addAcknowledgement(){current.ack={scope:scope(),operationId:"operation-1",fillStatus:"submitted",status:"ready"};flushSync(render);},',
    ' release(){release?.();},summary(){return {actions:actions.map(({kind,action,provider,scope,signal})=>({kind,action,...(provider?{provider}:{}),scope,aborted:signal.aborted})),replies,acknowledgements};}',
    '};',
  ].join('\n') }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  alias: { react: `${process.cwd()}/node_modules/react` } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-sync', '--no-first-run'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const dialog = page.getByRole('dialog');
    const show = (options: Record<string, unknown> = {}) => page.evaluate(value => window.interactionHarness.show(value), options);
    const manual = (phase: string, revision: number) => page.evaluate(([p, r]) => window.interactionHarness.setManual(p, r), [phase, revision] as const);
    const manager = (phase: string, revision: number) => page.evaluate(([p, r]) => window.interactionHarness.setManager(p, r), [phase, revision] as const);
    const summary = () => page.evaluate(() => window.interactionHarness.summary());

    await show({webauthn:true});
    await dialog.getByText('Continue signing in on the website.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Take over to sign in'}).isDisabled(), true);

    await show({webauthn:true,manual:true});
    const takeOver = dialog.getByRole('button', {name:'Take over to sign in'});
    await takeOver.focus();
    await page.keyboard.press('Enter');
    await dialog.getByText('Waiting for the browser host...').waitFor();
    assert.equal(await takeOver.isDisabled(), true);
    assert.equal(await dialog.getByRole('button', {name:'Cancel'}).isDisabled(), true);
    await manual('active', 2);
    await dialog.getByText("Let me know when you're done signing in").waitFor();
    await dialog.getByRole('button', {name:'Back to sign in'}).click();
    await dialog.getByText('Waiting for the browser host...').waitFor();
    await manual('available', 3);
    await dialog.getByText('Continue signing in on the website.').waitFor();
    await dialog.getByRole('button', {name:'Take over to sign in'}).click();
    await manual('active', 4);
    await dialog.getByRole('button', {name:'Done', exact:true}).click();
    await manual('finishing', 5);
    await dialog.getByText('Finishing sign-in...').waitFor();
    let result = await summary();
    assert.deepEqual(result.actions.slice(0, 4).map(item => item.action), ['open','back','open','finish']);
    assert.equal(result.actions[0]?.scope.challengeId, 'a'.repeat(32));
    assert.equal(result.replies.length, 0);

    await show({manual:true,deferred:true,webauthn:true});
    await dialog.getByRole('button', {name:'Take over to sign in'}).click();
    await page.evaluate(() => window.interactionHarness.removeManual());
    await dialog.getByText('The browser sign-in state does not match this request.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Cancel'}).isDisabled(), true);
    result = await summary();
    assert.equal(result.actions.at(-1)?.aborted, true);
    await page.evaluate(() => window.interactionHarness.restoreManual());
    assert.equal(await dialog.getByRole('button', {name:'Take over to sign in'}).isDisabled(), true);
    await page.evaluate(() => window.interactionHarness.release());
    assert.equal((await summary()).replies.length, 0);
    await manual('available', 2);
    assert.equal(await dialog.getByRole('button', {name:'Take over to sign in'}).isDisabled(), false);

    await show({manual:true,deferred:true});
    await dialog.getByRole('button', {name:'Take over to sign in'}).click();
    await manual('available', 2);
    await page.evaluate(() => window.interactionHarness.removeManual());
    await dialog.getByText('The browser sign-in state does not match this request.').waitFor();
    await page.evaluate(() => window.interactionHarness.release());
    assert.equal(await dialog.getByRole('button', {name:'Cancel'}).isDisabled(), true);

    await show({manual:true,deferred:true});
    await dialog.getByRole('button', {name:'Take over to sign in'}).click();
    await page.evaluate(() => window.interactionHarness.update({challenge:'b'.repeat(32),account:'account-b'}));
    await dialog.getByText('The browser sign-in state does not match this request.').waitFor();
    assert.equal((await summary()).actions.at(-1)?.aborted, true);
    await page.evaluate(() => window.interactionHarness.release());
    assert.equal((await summary()).replies.length, 0);

    await show({manual:true,fail:true,webauthn:true});
    await dialog.getByRole('button', {name:'Take over to sign in'}).click();
    await dialog.getByText('The browser host could not confirm this action.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Take over to sign in'}).isDisabled(), true);
    assert.equal((await dialog.innerText()).includes('synthetic private failure'), false);
    await manual('available', 2);
    assert.equal(await dialog.getByRole('button', {name:'Take over to sign in'}).isDisabled(), false);

    await show({manual:true,webauthn:true});
    await manual('active', 2);
    await dialog.getByRole('button', {name:'Not now'}).click();
    await manual('finishing', 3);
    assert.equal((await summary()).actions.at(-1)?.action, 'not-now');
    assert.equal((await summary()).replies.length, 0);

    await show({manual:true,manager:true});
    await manual('active', 2);
    await manager('waiting', 2);
    await dialog.getByText('The browser host reported conflicting sign-in operations.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Done', exact:true}).isDisabled(), true);
    assert.equal(await dialog.getByRole('button', {name:'Open 1Password'}).isDisabled(), true);

    await show({manager:true,fields:[{id:'password',label:'Password',type:'password',required:true}]});
    await dialog.getByRole('button', {name:'Fill with 1Password'}).click();
    await dialog.getByText('Waiting for the browser host...').waitFor();
    assert.equal(await dialog.getByLabel('Password', {exact:true}).count(), 0);
    assert.equal(await dialog.getByRole('button', {name:'Decline'}).isDisabled(), true);
    await manager('waiting', 2);
    await dialog.getByText('Approve the login request in 1Password.').waitFor();
    await dialog.getByRole('button', {name:'Open 1Password'}).click();
    await dialog.getByRole('button', {name:'Use another method'}).click();
    await manager('available', 3);
    await dialog.getByLabel('Password', {exact:true}).waitFor();
    result = await summary();
    assert.deepEqual(result.actions.slice(-3).map(item => item.action), ['start','reopen','back']);
    assert.ok(result.actions.slice(-3).every(item => item.provider === 'onepassword'));
    assert.equal(result.replies.length, 0);

    await show({manager:true,fields:[{id:'password',label:'Password',type:'password',required:true}]});
    await dialog.getByRole('button', {name:'Fill with 1Password'}).click();
    await manager('unknown', 2);
    await dialog.getByText('The private sign-in result could not be confirmed.').waitFor();
    assert.equal(await dialog.getByLabel('Password', {exact:true}).count(), 0);
    assert.equal(await dialog.getByRole('button', {name:'Decline'}).isDisabled(), true);

    await show({manager:true,fields:[{id:'password',label:'Password',type:'password',required:true}]});
    await dialog.getByRole('button', {name:'Fill with 1Password'}).click();
    await manager('filling', 2);
    const before = (await summary()).actions.length;
    await page.evaluate(() => window.interactionHarness.addAcknowledgement());
    await dialog.getByRole('button', {name:'Retry chat response'}).click();
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();
    result = await summary();
    assert.equal(result.actions.length, before);
    assert.equal(result.acknowledgements.length, 1);
    assert.equal(result.replies.length, 0);
  } finally { await browser.close(); }
});
