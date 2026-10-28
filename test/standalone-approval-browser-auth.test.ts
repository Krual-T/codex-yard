import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    authHarness: {
      show(options?: Record<string, unknown>): void;
      update(options: Record<string, unknown>): void;
      publish(index: number, update: Record<string, unknown>): void;
      acknowledge(status?: string): void;
      forgetAcknowledgement(): void;
      failNextAcknowledgement(kind: string): void;
      releaseCheck(): void;
      rejectResponse(): void;
      hide(): void;
      summary(): { subscriptions: { aborted: boolean; cleaned: boolean; scope: Record<string, unknown> }[];
        fills: Record<string, unknown>[]; acknowledgements: Record<string, unknown>[]; responses: unknown[]; checks: number };
    };
  }
}

test('browser auth QR updates and confirmed-fill acknowledgement remain bound to the original request', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const qrModule = process.env.APPROVAL_TEST_QR_MODULE;
  const qrImport = qrModule ? `import { QRCodeSVG } from ${JSON.stringify(qrModule)};`
    : `function QRCodeSVG({value,title}) { return <svg role="img" aria-label={title}><path d={'M'+value.length+' 0h1v1z'} /></svg>; }`;
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: [
    "import React from 'react';",
    "import {createRoot} from 'react-dom/client';",
    "import {flushSync} from 'react-dom';",
    "import {ApprovalDialog} from './src/renderer/app/ApprovalDialog.tsx';",
    qrImport,
    "const root=createRoot(document.getElementById('root'));",
    'let current, next=0, subscriptions=[], fills=[], acknowledgements=[], responses=[], checks=0, failAck, releaseCheck, rejectResponse;',
    'const outcomes=new Map();',
    'const subscribe=(request,publish)=>{const {signal,...scope}=request; const item={scope,publish,signal,cleaned:false}; subscriptions.push(item); return ()=>{item.cleaned=true;};};',
    'function render(){',
    '  const {request,options,ack}=current; const ref=request.ref, key=JSON.stringify(ref);',
    '  const binding={ref,hostId:ref.hostId,threadId:request.params.threadId,challengeId:request.params._meta.browser_auth_challenge_id,accountId:options.account,userId:options.user};',
    '  const scope={...binding,serverName:request.params.serverName,origin:request.params._meta.origin};',
    '  root.render(<ApprovalDialog request={request} stateRef={ref} outcome={outcomes.get(key)??"ready"}',
    '    onOutcome={(r,o)=>{outcomes.set(JSON.stringify(r),o); if(current.request.ref.id===r.id) render();}}',
    '    onInputDraftChange={()=>{}} onFormDraftChange={()=>{}}',
    '    browserAuthBinding={options.badBinding?{...binding,challengeId:"other"}:binding}',
    '    onSubscribeBrowserAuthQr={subscribe} browserAuthQrCode={QRCodeSVG}',
    '    browserAuthAcknowledgement={ack?{scope:ack.mismatch?{...ack.scope,accountId:"other"}:ack.scope,operationId:"operation-1",fillStatus:"submitted",status:ack.status}:undefined}',
    '    onAcknowledgeBrowserAuth={async value=>{acknowledgements.push(structuredClone(value)); if(failAck){const kind=failAck;failAck=undefined;throw Object.assign(Error("synthetic"),{uncertain:kind!=="known"});}}}',
    '    onCheckRequestValidity={async ()=>{checks++;if(options.delayedCheck) return await new Promise(resolve=>{releaseCheck=resolve;}); return options.validity!==false;}}',
    '    onSubmitBrowserAuth={async value=>{fills.push(structuredClone(value));}}',
    '    onRespond={async value=>{responses.push(structuredClone(value));if(options.delayedResponse) await new Promise((resolve,reject)=>{rejectResponse=()=>reject(Object.assign(Error("synthetic"),{uncertain:false}));});}} onUnsupported={async()=>{}} />);',
    '}',
    'window.authHarness={',
    '  show(options={}){const id=++next,ref={hostId:"host-a",generation:"generation-"+id,id};',
    '    options={account:"account-a",user:"user-a",challenge:"a".repeat(32),initial:"https://example.test/initial",qrCode:true,...options};',
    '    const meta={codex_approval_kind:"browser_auth",browser_auth_challenge_id:options.challenge,origin:"https://example.test",reason:"Sign in",fields:options.fields??[],options:[],qrCode:options.qrCode,qrCodePayload:options.initial};',
    '    current={request:{ref,hostId:ref.hostId,id,method:"mcpServer/elicitation/request",params:{threadId:"thread-a",serverName:"node_repl",mode:"form",requestedSchema:{type:"object",properties:{}},_meta:meta}},options,ack:undefined};render();},',
    '  update(options){current.options={...current.options,...options};const p=current.request.params;',
    '    current.request={...current.request,params:{...p,threadId:options.thread??p.threadId,_meta:{...p._meta,browser_auth_challenge_id:options.challenge??p._meta.browser_auth_challenge_id,qrCodePayload:options.initial??p._meta.qrCodePayload}}};flushSync(render);},',
    '  publish(i,update){subscriptions[i].publish(update);},',
    '  acknowledge(status="ready"){const {request,options}=current;const p=request.params;const binding={ref:request.ref,hostId:request.ref.hostId,threadId:p.threadId,challengeId:p._meta.browser_auth_challenge_id,accountId:options.account,userId:options.user};current.ack={status,mismatch:status==="mismatch",scope:{...binding,serverName:p.serverName,origin:p._meta.origin}};if(status==="mismatch")current.ack.status="ready";outcomes.set(JSON.stringify(request.ref),"ready");render();},',
    '  forgetAcknowledgement(){current.ack=undefined;render();},',
    '  failNextAcknowledgement(kind){failAck=kind;}, releaseCheck(){releaseCheck(true);}, rejectResponse(){rejectResponse();}, hide(){root.render(null);},',
    '  summary(){return {subscriptions:subscriptions.map(({signal,cleaned,scope})=>({aborted:signal.aborted,cleaned,scope})),fills,acknowledgements,responses,checks};}',
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
    const show = (options: Record<string, unknown> = {}) => page.evaluate(value => window.authHarness.show(value), options);
    const update = (options: Record<string, unknown>) => page.evaluate(value => window.authHarness.update(value), options);
    const publish = (index: number, value: Record<string, unknown>) => page.evaluate(([i, v]) => window.authHarness.publish(i, v), [index, value] as const);
    const summary = () => page.evaluate(() => window.authHarness.summary());
    const path = () => dialog.locator('svg path').last().getAttribute('d');
    const waitSubscriptions = (count: number) => page.waitForFunction(n => window.authHarness.summary().subscriptions.length >= n, count);

    await show();
    await waitSubscriptions(1);
    const initial = await path();
    assert.ok(initial);
    assert.equal((await dialog.innerText()).includes('example.test/initial'), false);
    const first = (await summary()).subscriptions[0]!;
    assert.equal(first.scope.hostId, 'host-a');
    assert.equal(first.scope.threadId, 'thread-a');
    assert.equal(first.scope.challengeId, 'a'.repeat(32));
    assert.equal(first.scope.accountId, 'account-a');
    assert.equal(first.scope.userId, 'user-a');
    await publish(0, {type:'snapshot',payload:'https://example.test/rotated-longer',timestamp_ms:20});
    await page.waitForFunction(old => document.querySelector('svg path:last-of-type')?.getAttribute('d') !== old, initial);
    const rotated = await path();
    await publish(0, {type:'snapshot',payload:'https://example.test/stale',timestamp_ms:19});
    await publish(0, {type:'no-content'});
    assert.equal(await path(), rotated);
    await publish(0, {type:'error',retrying:true});
    await dialog.getByText('The sign-in code could not be updated.').waitFor();
    await publish(0, {type:'snapshot',payload:'https://example.test/rotated-longer',timestamp_ms:20});
    await dialog.locator('svg').waitFor();
    assert.equal(await path(), rotated);
    await publish(0, {type:'snapshot',payload:'ignored',timestamp_ms:20,disappeared:true});
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();
    let result = await summary();
    assert.equal(result.subscriptions[0]?.aborted, true);
    assert.equal(result.subscriptions[0]?.cleaned, true);
    assert.equal(result.fills.length, 1);
    assert.deepEqual(result.fills[0]?.fields, {});
    assert.equal(result.fills[0]?.accountId, 'account-a');
    assert.equal(result.responses.length, 0);
    await publish(0, {type:'snapshot',payload:'late',timestamp_ms:21});
    assert.equal((await summary()).fills.length, 1);

    await show(); await waitSubscriptions(2);
    await update({challenge:'b'.repeat(32),account:'account-b',initial:'https://example.test/new'});
    await waitSubscriptions(3);
    const newPath = await path();
    assert.equal((await summary()).subscriptions[1]?.aborted, true);
    await publish(1, {type:'snapshot',payload:'old-challenge-payload',timestamp_ms:100});
    assert.equal(await path(), newPath);
    assert.equal((await summary()).subscriptions[2]?.scope.challengeId, 'b'.repeat(32));
    assert.equal((await summary()).subscriptions[2]?.scope.accountId, 'account-b');
    await publish(2, {type:'expired'});
    await dialog.getByText('The sign-in code has expired.').waitFor();
    assert.equal((await summary()).subscriptions[2]?.aborted, true);
    assert.equal(await dialog.getByRole('button', {name:'Done'}).isDisabled(), true);
    await publish(2, {type:'snapshot',payload:'late',timestamp_ms:101});
    assert.equal(await dialog.locator('svg').count(), 0);

    await show({qrCode:false}); await waitSubscriptions(4);
    await publish(3, {type:'snapshot',payload:'ignored',timestamp_ms:1,disappeared:true});
    assert.equal((await summary()).fills.length, 1);
    await dialog.getByRole('button', {name:'Done'}).click();
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();
    assert.equal((await summary()).fills.length, 2);

    await show(); await waitSubscriptions(5);
    await dialog.getByRole('button', {name:'Cancel'}).click();
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();
    assert.equal((await summary()).subscriptions[4]?.aborted, true);
    await publish(4, {type:'snapshot',payload:'late',timestamp_ms:2,disappeared:true});
    assert.equal((await summary()).fills.length, 2);

    await show({badBinding:true});
    await dialog.getByText('The sign-in code requires the original account and browser host.').waitFor();
    assert.equal((await summary()).subscriptions.length, 5);

    await show({fields:[{id:'password',label:'Password',type:'password',required:true}]});
    await dialog.getByLabel('Password').fill('synthetic-value');
    await update({account:'account-b'});
    assert.equal(await dialog.getByLabel('Password').inputValue(), '');

    await show(); await waitSubscriptions(7);
    await page.evaluate(() => window.authHarness.acknowledge('mismatch'));
    await dialog.getByText('The saved sign-in operation does not match this request.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Cancel'}).isDisabled(), true);
    await page.evaluate(() => window.authHarness.forgetAcknowledgement());
    await dialog.getByText('Sign-in operation unavailable').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Cancel'}).isDisabled(), true);
    await page.evaluate(() => window.authHarness.acknowledge());
    assert.equal(await dialog.getByRole('button', {name:'Cancel'}).isDisabled(), true);
    assert.equal(await dialog.locator('input').count(), 0);
    await page.evaluate(() => window.authHarness.failNextAcknowledgement('known'));
    await dialog.getByRole('button', {name:'Retry chat response'}).click();
    await dialog.getByText('The chat response was not sent. You can retry the chat response.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Retry chat response'}).isDisabled(), false);
    await dialog.getByRole('button', {name:'Retry chat response'}).click();
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();
    result = await summary();
    assert.equal(result.fills.length, 2);
    assert.equal(result.acknowledgements.length, 2);
    assert.deepEqual(result.acknowledgements[0], result.acknowledgements[1]);
    assert.deepEqual(Object.keys(result.acknowledgements[0]!).sort(), ['fillStatus','operationId','scope']);
    assert.ok(result.checks >= 3);

    await show(); await page.evaluate(() => window.authHarness.acknowledge());
    await page.evaluate(() => window.authHarness.failNextAcknowledgement('unknown'));
    await dialog.getByRole('button', {name:'Retry chat response'}).click();
    await dialog.getByText('The chat response could not be confirmed. Check the original conversation before retrying.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Retry chat response'}).isDisabled(), true);

    await show({validity:false}); await page.evaluate(() => window.authHarness.acknowledge());
    const beforeInvalid = (await summary()).acknowledgements.length;
    await dialog.getByRole('button', {name:'Retry chat response'}).click();
    await dialog.getByText('The chat response could not be confirmed. Check the original conversation before retrying.').waitFor();
    assert.equal((await summary()).acknowledgements.length, beforeInvalid);

    await show({delayedCheck:true}); await page.evaluate(() => window.authHarness.acknowledge());
    const beforeChange = (await summary()).acknowledgements.length;
    await dialog.getByRole('button', {name:'Retry chat response'}).click();
    await update({challenge:'c'.repeat(32)});
    await dialog.getByText('The saved sign-in operation does not match this request.').waitFor();
    await page.evaluate(() => window.authHarness.releaseCheck());
    await page.waitForTimeout(30);
    assert.equal((await summary()).acknowledgements.length, beforeChange);

    let base = (await summary()).subscriptions.length;
    await show({delayedResponse:true}); await waitSubscriptions(base + 1);
    await dialog.getByRole('button', {name:'Cancel'}).click();
    await page.waitForFunction(i => window.authHarness.summary().subscriptions[i]?.aborted, base);
    await page.evaluate(() => window.authHarness.rejectResponse());
    await dialog.getByText(/The original request is still pending/).waitFor();
    await waitSubscriptions(base + 2);
    assert.equal(await dialog.locator('svg').count(), 0);
    await publish(base + 1, {type:'no-content'});
    assert.equal(await dialog.locator('svg').count(), 0);
    await publish(base + 1, {type:'snapshot',payload:'https://example.test/fresh',timestamp_ms:1});
    await dialog.locator('svg').waitFor();

    base = (await summary()).subscriptions.length;
    await show({initial:''}); await waitSubscriptions(base + 1);
    const beforeEmpty = (await summary()).fills.length;
    await publish(base, {type:'snapshot',payload:'ignored',timestamp_ms:1,disappeared:true});
    await dialog.getByText('The sign-in code is no longer displayed.').waitFor();
    assert.equal((await summary()).fills.length, beforeEmpty);
    assert.equal(await dialog.getByRole('button', {name:'Done'}).isDisabled(), true);

    if (qrModule) {
      base = (await summary()).subscriptions.length;
      await show({initial:'x'.repeat(5000)}); await waitSubscriptions(base + 1);
      await dialog.getByText('The sign-in code could not be displayed.').waitFor();
      assert.equal(await dialog.getByRole('button', {name:'Done'}).isDisabled(), true);
      await publish(base, {type:'snapshot',payload:'https://example.test/recovered',timestamp_ms:1});
      await dialog.locator('svg').waitFor();
      assert.equal(await dialog.getByRole('button', {name:'Done'}).isDisabled(), false);
    }
    await page.evaluate(() => window.authHarness.hide());
  } finally { await browser.close(); }
});
