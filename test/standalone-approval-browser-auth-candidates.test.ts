import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    candidateHarness: {
      show(options?: Record<string, unknown>): void;
      update(options: Record<string, unknown>): void;
      setSnapshot(options: Record<string, unknown>): void;
      releasePage(): void;
      advanceTime(ms: number): void;
      failNext(kind: string): void;
      summary(): { uses: Record<string, unknown>[]; responses: unknown[]; pages: { page: string; aborted: boolean }[]; checks: number };
    };
  }
}

test('saved sign-in choices remain scoped, expire, and use only the private host action', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: [
    "import React from 'react';",
    "import {createRoot} from 'react-dom/client';",
    "import {flushSync} from 'react-dom';",
    "import {ApprovalDialog} from './src/renderer/app/ApprovalDialog.tsx';",
    'const root=createRoot(document.getElementById("root"));',
    'const realNow=Date.now.bind(Date);let offset=0;Date.now=()=>realNow()+offset;',
    'let current,next=0,uses=[],responses=[],pages=[],checks=0,fail,releasePage;',
    'const outcomes=new Map();',
    'function scope(){const {request,options}=current;return {ref:request.ref,hostId:request.ref.hostId,threadId:request.params.threadId,challengeId:request.params._meta.browser_auth_challenge_id,accountId:options.account,userId:"user-a",serverName:"node_repl",origin:"https://example.test"};}',
    'function render(){const {request,snapshot}=current;const binding=scope();root.render(<ApprovalDialog request={request} stateRef={request.ref} outcome={outcomes.get(JSON.stringify(request.ref))??"ready"}',
    '  onOutcome={(ref,value)=>{outcomes.set(JSON.stringify(ref),value);if(current.request.ref.id===ref.id)render();}} onInputDraftChange={()=>{}} onFormDraftChange={()=>{}}',
    '  browserAuthBinding={binding} browserAuthCandidates={snapshot}',
    '  onRequestBrowserAuthCandidates={async request=>{pages.push(request);if(current.options.delayPage) await new Promise(resolve=>{releasePage=resolve;});}}',
    '  onUseBrowserAuthCandidate={async request=>{uses.push(structuredClone(request));if(fail){const kind=fail;fail=undefined;throw Object.assign(Error("synthetic private error"),{uncertain:kind!=="known"});}}}',
    '  onCheckRequestValidity={async()=>{checks++;return current.options.valid!==false;}} onRespond={async value=>{responses.push(value);}} onUnsupported={async()=>{}} />);}',
    'window.candidateHarness={',
    ' show(options={}){let id=++next,ref={hostId:"host-a",generation:"generation-"+id,id};options={account:"account-a",...options};',
    '  current={options,request:{ref,hostId:ref.hostId,id,method:"mcpServer/elicitation/request",params:{threadId:"thread-a",serverName:"node_repl",mode:"form",requestedSchema:{type:"object",properties:{}},_meta:{codex_approval_kind:"browser_auth",browser_auth_challenge_id:"a".repeat(32),origin:"https://example.test",reason:"Sign in",fields:[]}}}};',
    '  const expiry=Math.floor(Date.now()/1000)+100;current.snapshot={scope:scope(),status:"ready",hasMore:true,candidates:[{choiceId:"choice-1",accountLabel:"alpha",origin:"https://example.test",expiresAt:expiry},{choiceId:"choice-2",accountLabel:"beta",origin:"https://example.test",expiresAt:expiry}]};render();},',
    ' update(options){current.options={...current.options,...options};if(options.challenge)current.request={...current.request,params:{...current.request.params,_meta:{...current.request.params._meta,browser_auth_challenge_id:options.challenge}}};flushSync(render);},',
    ' setSnapshot(options){current.snapshot={...current.snapshot,...options,...(options.currentScope?{scope:scope()}:{} )};delete current.snapshot.currentScope;flushSync(render);},',
    ' releasePage(){releasePage?.();},advanceTime(ms){offset+=ms;},failNext(kind){fail=kind;},',
    ' summary(){return {uses,responses,pages:pages.map(({page,signal})=>({page,aborted:signal.aborted})),checks};}',
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
    const show = (value: Record<string, unknown> = {}) => page.evaluate(options => window.candidateHarness.show(options), value);
    const update = (value: Record<string, unknown>) => page.evaluate(options => window.candidateHarness.update(options), value);
    const snapshot = (value: Record<string, unknown>) => page.evaluate(options => window.candidateHarness.setSnapshot(options), value);
    const summary = () => page.evaluate(() => window.candidateHarness.summary());

    await show();
    await dialog.getByText('Saved sign-ins', {exact:true}).waitFor();
    assert.equal(await dialog.getByRole('radio', {name:/alpha/}).isChecked(), true);
    await dialog.getByRole('radio', {name:/beta/}).check();
    await dialog.getByRole('button', {name:'Use saved sign-in'}).click();
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();
    let result = await summary();
    assert.equal(result.uses.length, 1);
    assert.deepEqual(Object.keys(result.uses[0]!).sort(), ['choiceId','scope']);
    assert.equal(result.uses[0]?.choiceId, 'choice-2');
    assert.equal(result.responses.length, 0);

    await show();
    await page.evaluate(() => window.candidateHarness.failNext('known'));
    await dialog.getByRole('button', {name:'Use saved sign-in'}).click();
    await dialog.getByText(/The original request is still pending/).waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Use saved sign-in'}).isDisabled(), false);
    assert.ok((await summary()).checks > 0);
    await dialog.getByRole('button', {name:'Use saved sign-in'}).click();
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();

    await show();
    await page.evaluate(() => window.candidateHarness.failNext('unknown'));
    await dialog.getByRole('button', {name:'Use saved sign-in'}).click();
    await dialog.getByText(/Response could not be confirmed/).waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Use saved sign-in'}).isDisabled(), true);

    await show();
    const beforeExpiry = (await summary()).uses.length;
    await dialog.getByRole('button', {name:'Use saved sign-in'}).waitFor();
    await page.evaluate(() => window.candidateHarness.advanceTime(120_000));
    await dialog.getByRole('button', {name:'Use saved sign-in'}).click();
    await dialog.getByText('No current saved sign-ins.').waitFor();
    assert.equal((await summary()).uses.length, beforeExpiry);

    await show({delayPage:true});
    await dialog.getByRole('button', {name:'More saved sign-ins'}).click();
    await page.waitForFunction(() => window.candidateHarness.summary().pages.length > 0);
    await update({challenge:'b'.repeat(32),account:'account-b'});
    await dialog.getByText('Saved sign-in choices do not match this request.').waitFor();
    result = await summary();
    assert.equal(result.pages.at(-1)?.page, 'next');
    assert.equal(result.pages.at(-1)?.aborted, true);
    await page.evaluate(() => window.candidateHarness.releasePage());
    await snapshot({currentScope:true,status:'ready',hasMore:false,candidates:[{choiceId:'choice-new',accountLabel:'new\u202Elabel',origin:'https://example.test',expiresAt:Math.floor(Date.now()/1000)+1000}]});
    await dialog.getByText('new\\u202Elabel').waitFor();
    await dialog.getByRole('button', {name:'Use saved sign-in'}).click();
    await dialog.getByText('Response sent; waiting for the request to resolve.').waitFor();
    result = await summary();
    assert.equal((result.uses.at(-1)?.scope as Record<string, unknown>).accountId, 'account-b');
    assert.equal(result.uses.at(-1)?.choiceId, 'choice-new');
    assert.equal(result.responses.length, 0);

    await show();
    const expiration = Math.floor(Date.now() / 1000) + 1000;
    await snapshot({candidates:[{choiceId:'duplicate',accountLabel:'one',origin:'https://example.test',expiresAt:expiration},
      {choiceId:'duplicate',accountLabel:'two',origin:'https://example.test',expiresAt:expiration}]});
    await dialog.getByText('Saved sign-in choices could not be verified.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Use saved sign-in'}).count(), 0);
    await snapshot({status:'error',candidates:[],hasMore:false});
    await dialog.getByRole('button', {name:'Retry saved sign-ins'}).click();
    await page.waitForFunction(() => window.candidateHarness.summary().pages.some(item => item.page === 'refresh'));
  } finally { await browser.close(); }
});
