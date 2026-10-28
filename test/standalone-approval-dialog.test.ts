import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    approvalHarness: {
      show(method: string, params: Record<string, unknown>, options?: {
        completion?: boolean; wrongHost?: boolean; noInterrupt?: boolean; dismissEmpty?: boolean; completionHost?: string; authCheck?: boolean | 'delayed';
      }): void;
      update(params: Record<string, unknown>): void;
      hide(): void;
      reopen(): void;
      failNext(): void;
      releaseAuth(): void;
      calls: { ref: { hostId: string; generation: string; id: number }; result?: unknown; interrupt?: unknown; unsupported?: boolean }[];
      searches: { kind: string; params: Record<string, unknown>; hostId?: string }[];
      authChecks: unknown[];
    };
  }
}

test('approval UI preserves source, once-only outcomes, forms and input interactions', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { ApprovalDialog } from './src/renderer/app/ApprovalDialog.tsx';",
    "const root = createRoot(document.getElementById('root'));",
    'const calls = [], searches = [], authChecks = [], outcomes = new Map(), inputDrafts = new Map(), formDrafts = new Map();',
    'let next = 0, current, fail = false, releaseAuth;',
    'const client = {',
    "  host: async (kind, params) => { searches.push({kind, params}); return {entries:[{type:'file', name:'readme.md', path:'readme.md'}]}; },",
    "  rpc: async (kind, params, hostId) => { searches.push({kind, params, hostId}); return {data:[{skills:[{enabled:true,name:'review',path:'/skills/review',description:'Review'}]}]}; },",
    '  reply: async () => {}, subscribe: () => () => {}',
    '};',
    'function render() {',
    '  const {request, options} = current, ref = request.ref, key = JSON.stringify(ref);',
    '  root.render(React.createElement(ApprovalDialog, { request,',
    '    outcome:outcomes.get(key), inputDraft:inputDrafts.get(key), formDraft:formDrafts.get(key),',
    '    onOutcome:(_ref, value) => outcomes.set(key, value),',
    '    onInputDraftChange:(_ref, value) => inputDrafts.set(key, structuredClone(value)),',
    '    onFormDraftChange:(_ref, value) => formDrafts.set(key, structuredClone(value)),',
    "    completionContext:options.completion ? {client, hostId:options.completionHost ?? 'ssh-test',threadId:'thread-a',cwd:'/source-work'} : undefined,",
    "    inputDismissMode:options.dismissEmpty ? 'reply-empty' : 'interrupt',",
    "    onCheckConnectorAuthorization:options.authCheck ? async value => { authChecks.push(structuredClone(value)); if (options.authCheck === 'delayed') return await new Promise(resolve => {releaseAuth=resolve;}); return true; } : undefined,",
    '    onRespond:async result => { calls.push({ref,result:structuredClone(result)});',
    "      if (fail) { fail=false; throw Object.assign(Error('Synthetic reply failure'), {uncertain:true}); } root.render(null); },",
    '    onUnsupported:async () => { calls.push({ref,unsupported:true}); root.render(null); },',
    '    onInputEscape:options.noInterrupt ? undefined : async origin => { calls.push({ref,interrupt:structuredClone(origin)});',
    "      if (fail) { fail=false; throw Object.assign(Error('Synthetic interrupt failure'), {uncertain:true}); } root.render(null); }",
    '  }));',
    '}',
    'window.approvalHarness = { calls, searches, authChecks, failNext() {fail=true;}, releaseAuth() {releaseAuth(true);}, hide() {root.render(null);}, reopen() {render();},',
    '  update(params) {current.request.params={...current.request.params,...params}; render();},',
    '  show(method, params, options={}) { const id=++next, ref={hostId:"ssh-test",generation:"generation-"+id,id};',
    "    current={request:{ref,hostId:options.wrongHost?'wrong-host':ref.hostId,id,method,params:{threadId:'thread-a',turnId:'turn-a',...params}},options}; render(); } };",
  ].join('\n') }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<button id="outside">Outside</button><div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/app/app.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const dialog = page.getByRole('dialog');
    const show = (method: string, params: Record<string, unknown>, options?: {
      completion?: boolean; wrongHost?: boolean; noInterrupt?: boolean; dismissEmpty?: boolean; completionHost?: string; authCheck?: boolean | 'delayed';
    }) =>
      page.evaluate(([m, p, o]) => window.approvalHarness.show(m, p, o), [method, params, options] as const);
    const calls = () => page.evaluate(() => window.approvalHarness.calls);
    const hide = async () => { await page.evaluate(() => window.approvalHarness.hide()); await dialog.waitFor({ state: 'detached' }); };
    const reopen = async () => { await page.evaluate(() => window.approvalHarness.reopen()); await dialog.waitFor(); };

    await show('mcpServer/elicitation/request', { mode:'url', serverName:'fixture', message:'Verify', elicitationId:'e1', url:'https://example.test/verify' });
    await dialog.getByRole('link', { name:'https://example.test/verify' }).waitFor();
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    assert.match(await dialog.innerText(), /Host: ssh-test.*Thread: thread-a.*Turn: turn-a/);
    await page.locator('#outside').focus();
    assert.notEqual(await page.locator('#outside').evaluate(element => document.activeElement === element), true);
    await page.evaluate(() => window.approvalHarness.failNext());
    await dialog.getByRole('button', { name:'Continue' }).click();
    await dialog.getByText(/Response could not be confirmed/).waitFor();
    assert.equal(await dialog.getByRole('button', { name:'Continue' }).isDisabled(), true);
    await hide(); await reopen();
    assert.equal(await dialog.getByRole('button', { name:'Continue' }).isDisabled(), true);
    assert.equal((await calls()).length, 1);
    assert.deepEqual((await calls())[0]?.result, { action:'accept', content:{}, _meta:null });

    await show('mcpServer/elicitation/request', { mode:'url', elicitationId:'e2', url:'http://example.test/', message:'Not HTTPS' });
    await dialog.getByText('This URL request cannot be opened safely.').waitFor();
    assert.equal(await dialog.getByRole('link').count(), 0);
    await dialog.getByRole('button', { name:'Decline' }).click();
    assert.deepEqual((await calls()).at(-1)?.result, {action:'decline',content:null,_meta:null});

    await show('mcpServer/elicitation/request', { mode:'url', serverName:'codex_apps', elicitationId:'auth',
      url:'https://chatgpt.com.attacker.test/', _meta:{ _codex_apps:{connector_auth_failure:{is_auth_failure:true,
        connector_id:'c',connector_name:'Connector',install_url:'https://chatgpt.com/'}}} });
    await dialog.getByText('This connector authentication request cannot be verified.').waitFor();
    assert.equal(await dialog.getByRole('button', { name:'Continue' }).count(), 0);
    await dialog.getByRole('button', { name:'Cancel' }).click();
    await show('mcpServer/elicitation/request', {mode:'url',serverName:'codex_apps',elicitationId:'auth-ok',
      url:'https://auth.chatgpt.com/verify',_meta:{_codex_apps:{connector_auth_failure:{is_auth_failure:true,
        connector_id:'c',connector_name:'Connector',install_url:'https://chatgpt.com/',requested_scopes:['read'],
        connection_consent:{type:'consent',origin:'https://chatgpt.com/',connection_id:'conn',scopes:[{scope:'write',label:'Write'}]}}}}});
    await dialog.getByText(/Requested scopes: read/).waitFor();
    await dialog.getByText(/Consent origin: https:\/\/chatgpt.com/).waitFor();
    await dialog.getByText('Write (write)').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Continue'}).count(), 0);
    assert.equal(await dialog.getByRole('button', {name:'Check connection'}).count(), 0);
    await dialog.getByRole('button', {name:'Decline'}).click();
    await show('mcpServer/elicitation/request', {mode:'url',serverName:'codex_apps',elicitationId:'auth-check',
      url:'https://auth.chatgpt.com/verify',_meta:{_codex_apps:{connector_auth_failure:{is_auth_failure:true,
        connector_id:'c',connector_name:'Connector',install_url:'https://chatgpt.com/',requested_scopes:['read']}}}}, {authCheck:true});
    await dialog.getByRole('button', {name:'Check connection'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {action:'accept',content:{},_meta:null});
    const authChecks = await page.evaluate(() => window.approvalHarness.authChecks) as {hostId:string;threadId:string;connectorId:string;scopes:string[]}[];
    assert.deepEqual({hostId:authChecks[0]?.hostId,threadId:authChecks[0]?.threadId,connectorId:authChecks[0]?.connectorId,scopes:authChecks[0]?.scopes},
      {hostId:'ssh-test',threadId:'thread-a',connectorId:'c',scopes:['read']});
    await show('mcpServer/elicitation/request', {mode:'url',serverName:'codex_apps',elicitationId:'auth-delay',
      url:'https://auth.chatgpt.com/verify',_meta:{_codex_apps:{connector_auth_failure:{is_auth_failure:true,
        connector_id:'c',connector_name:'Connector',install_url:'https://chatgpt.com/'}}}}, {authCheck:'delayed'});
    await dialog.getByRole('button', {name:'Check connection'}).click();
    const callsBeforeLateAuth = (await calls()).length;
    await hide();
    await page.evaluate(() => window.approvalHarness.releaseAuth());
    await page.waitForTimeout(50);
    assert.equal((await calls()).length, callsBeforeLateAuth);
    await show('mcpServer/elicitation/request', {mode:'url',serverName:'codex_apps',elicitationId:'auth-source',
      url:'https://auth.chatgpt.com/verify',_meta:{_codex_apps:{connector_auth_failure:{is_auth_failure:true,
        connector_id:'c',connector_name:'Connector',install_url:'https://chatgpt.com/'}}}}, {authCheck:'delayed'});
    await dialog.getByRole('button', {name:'Check connection'}).click();
    const callsBeforeSourceChange = (await calls()).length;
    await page.evaluate(() => window.approvalHarness.update({threadId:'thread-b'}));
    await dialog.getByText(/Thread: thread-b/).waitFor();
    await page.evaluate(() => window.approvalHarness.releaseAuth());
    await page.waitForTimeout(50);
    assert.equal((await calls()).length, callsBeforeSourceChange);

    for (const mode of ['openai/form', 'openaiForm', 'form']) {
      const schema = { type:'object', required:['choice','empty'], properties:{
        choice:{type:'string',title:'Choice',enum:['','x']}, empty:{type:'string',title:'Empty',default:'',minLength:0},
        optional:{type:'string',title:'Optional'}, age:{type:'integer',title:'Age',minimum:1,maximum:10} } };
      await show('mcpServer/elicitation/request', { mode, requestedSchema:mode === 'form' ? {type:'object',properties:{}} : schema,
        ...(mode === 'form' ? {_meta:{'openai/elicitation':{requestedSchema:schema}}} : {}) });
      await dialog.getByRole('button', { name:'Submit' }).click();
      await dialog.getByText('Correct the fields below before submitting.').waitFor();
      await dialog.getByLabel('Choice (required)').selectOption({label:'(empty string)'});
      await dialog.getByLabel('Optional').fill('  ');
      await dialog.getByLabel('Age').fill('11');
      await dialog.getByRole('button', { name:'Submit' }).click();
      await dialog.getByText('Maximum is 10.').waitFor();
      await dialog.getByLabel('Age').fill('4');
      if (mode === 'form') { await hide(); await reopen(); assert.equal(await dialog.getByLabel('Optional').inputValue(), '  '); }
      await dialog.getByRole('button', { name:'Submit' }).click();
      assert.deepEqual((await calls()).at(-1)?.result, {action:'accept',content:{choice:'',empty:'',optional:'  ',age:4},_meta:null});
    }
    await page.evaluate(() => window.approvalHarness.show('mcpServer/elicitation/request', {mode:'form', requestedSchema:JSON.parse(
      '{"type":"object","required":["constructor","__proto__"],"properties":{"constructor":{"type":"string"},"__proto__":{"type":"string"}}}')}));
    await dialog.getByLabel('constructor (required)').fill('first');
    await dialog.getByLabel('__proto__ (required)').fill('second');
    await dialog.getByRole('button', {name:'Submit'}).click();
    const specialResult = await page.evaluate(() => JSON.stringify(window.approvalHarness.calls.at(-1)?.result));
    assert.deepEqual(JSON.parse(specialResult),
      JSON.parse('{"action":"accept","content":{"constructor":"first","__proto__":"second"},"_meta":null}'));
    await show('mcpServer/elicitation/request', {mode:'futureMode',requestedSchema:{type:'object',properties:{}}});
    await dialog.getByText('This elicitation mode is not supported.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Submit'}).count(), 0);
    await dialog.getByRole('button', {name:'Cancel'}).click();

    const baseMeta = {codex_approval_kind:'mcp_tool_call',connector_id:'connector_20205bf7d4e99a89d7154bb849718324',
      tool_name:'sites.execute_database_delete',tool_params:{confirmation_summary:'{}',plan_token:'fixture'}};
    await show('mcpServer/elicitation/request', {mode:'form',serverName:'codex_apps',requestedSchema:{type:'object',properties:{}},_meta:baseMeta});
    await dialog.getByText('The database change confirmation is invalid; approval is unavailable.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Approve'}).count(), 0);
    assert.equal(await dialog.getByRole('button', {name:'Submit'}).count(), 0);
    await dialog.getByRole('button', {name:'Decline'}).click();
    const summary = JSON.stringify({approval_version:1,binding_name:'app',deployment_id:'d',operation:'delete',
      primary_key_column:'id',primary_key_value:'7',project_id:'p',table_name:'records',values:{id:7}});
    await show('mcpServer/elicitation/request', {mode:'form',serverName:'codex_apps',requestedSchema:{type:'object',properties:{}},
      _meta:{...baseMeta,tool_params:{confirmation_summary:summary,plan_token:'fixture'}}});
    await dialog.getByText(/Review this specific database change/).waitFor();
    assert.match(await dialog.innerText(), /records/);
    assert.doesNotMatch(await dialog.innerText(), /plan_token/);
    await dialog.getByRole('button', {name:'Approve'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {action:'accept',content:{},_meta:null});

    await show('mcpServer/elicitation/request', {mode:'form',message:'Confirm change',
      requestedSchema:{type:'object',required:['approved'],properties:{approved:{type:'boolean',title:'Approved'}}},
      _meta:{'openai/confirmation':{version:1,field:'approved',presentation:{title:'Review',triggerLabel:'Review',confirmLabel:'Confirm',
        destructive:true,fields:[{label:'Record',value:'seven'},{label:'Action',value:'delete'}],
        sections:[{title:'Target',bodyField:0,captionField:1}]}}}});
    await dialog.getByText('Record:').waitFor();
    await dialog.getByText('Target', {exact:true}).waitFor();
    await dialog.getByText('Destructive change').waitFor();
    await dialog.getByLabel('Approved (required)').selectOption({label:'False'});
    await dialog.getByRole('button', {name:'Confirm'}).click();
    await dialog.getByText('Explicit confirmation is required.').waitFor();
    await dialog.getByLabel('Approved (required)').selectOption({label:'True'});
    await dialog.getByRole('button', {name:'Confirm'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {action:'accept',content:{approved:true},_meta:null});

    await show('item/commandExecution/requestApproval', {availableDecisions:['decline']});
    await dialog.getByRole('button', {name:'Decline'}).waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Approve',exact:true}).count(), 0);
    await dialog.getByRole('button', {name:'Decline'}).click();
    await show('item/commandExecution/requestApproval', {proposedExecpolicyAmendment:['git','status']});
    await dialog.getByRole('button', {name:'Approve and save command rule'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {decision:{acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}}});
    const denyNetwork = {applyNetworkPolicyAmendment:{network_policy_amendment:{host:'example.test',action:'deny'}}};
    await show('item/commandExecution/requestApproval', {availableDecisions:[denyNetwork]});
    await dialog.getByRole('button', {name:'Deny network for example.test'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {decision:denyNetwork});
    await show('item/fileChange/requestApproval', {});
    await dialog.getByRole('button', {name:'Approve for session'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {decision:'acceptForSession'});
    await show('item/permissions/requestApproval', {permissions:{network:null,fileSystem:{read:['/work'],write:null}}});
    await dialog.getByRole('button', {name:'Approve for session'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {permissions:{fileSystem:{read:['/work'],write:null}},scope:'session'});
    await show('execCommandApproval', {command:['echo','fixture']});
    await dialog.getByRole('button', {name:'Decline'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {decision:{denied:{rejection:'Declined by user.'}}});

    await show('item/tool/requestUserInput', {isBlocking:false,questions:[
      {id:'choice',header:'Choice',question:'Pick one',isOther:true,options:[{label:'First'},{label:'Second'}]},
      {id:'free',header:'Free',question:'Your answer',isOther:false,options:null}]}, {completion:true});
    await dialog.getByLabel('First').waitFor();
    assert.equal(await dialog.getByLabel('First').isChecked(), true);
    assert.equal(await dialog.getAttribute('aria-modal'), null);
    await page.locator('#outside').focus();
    assert.equal(await page.locator('#outside').evaluate(element => document.activeElement === element), true);
    await dialog.getByLabel('Other', {exact:true}).check();
    await dialog.getByLabel('Pick one').fill('First line\nSecond line');
    await dialog.getByLabel('Second').check();
    await dialog.getByLabel('Other', {exact:true}).check();
    assert.equal(await dialog.getByLabel('Pick one').inputValue(), 'First line\nSecond line');
    await dialog.getByLabel('Your answer').fill('@read');
    await dialog.getByRole('button', {name:'@readme.md'}).click();
    assert.equal(await dialog.getByLabel('Your answer').inputValue(), '`/source-work/readme.md` ');
    const search = (await page.evaluate(() => window.approvalHarness.searches)).at(-1);
    assert.deepEqual(search, {kind:'workspace-directory-entries',params:{hostId:'ssh-test',workspaceRoot:'/source-work',directoryPath:''}});
    await dialog.getByLabel('Your answer').fill('$rev');
    await dialog.getByRole('button', {name:'$review'}).click();
    assert.equal(await dialog.getByLabel('Your answer').inputValue(), '[$review](/skills/review) ');
    assert.deepEqual((await page.evaluate(() => window.approvalHarness.searches)).at(-1),
      {kind:'skills/list',params:{cwds:['/source-work']},hostId:'ssh-test'});
    await hide(); await reopen();
    assert.equal(await dialog.getByLabel('Pick one').inputValue(), 'First line\nSecond line');
    assert.equal(await dialog.getByLabel('Your answer').inputValue(), '[$review](/skills/review) ');
    await dialog.getByRole('button', {name:'Submit'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {answers:{choice:{answers:['First line\nSecond line']},free:{answers:['[$review](/skills/review)']}}});

    await show('item/tool/requestUserInput', {questions:[
      {id:'choice',question:'Choose',options:[{label:'First'},{label:'Second'}]},
      {id:'free',question:'Optional answer',options:null}]});
    await dialog.getByRole('button', {name:'Submit'}).click();
    assert.deepEqual((await calls()).at(-1)?.result, {answers:{choice:{answers:['First']}}});
    await show('item/tool/requestUserInput', {questions:[{id:'q',question:'Empty answer',options:null}]});
    const beforeEmpty = (await calls()).length;
    await dialog.getByRole('button', {name:'Submit'}).click();
    await dialog.getByText('Answer at least one question before submitting.').waitFor();
    assert.equal((await calls()).length, beforeEmpty);

    await show('item/tool/requestUserInput', {questions:[{id:'q',question:'Answer',options:null}]});
    await dialog.getByLabel('Answer').fill('Draft');
    const beforeEscape = (await calls()).length;
    await dialog.getByLabel('Answer').evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',isComposing:true,bubbles:true})));
    assert.equal((await calls()).length, beforeEscape);
    await page.evaluate(() => window.approvalHarness.failNext());
    await dialog.getByLabel('Answer').press('Escape');
    await dialog.getByText(/Synthetic interrupt failure/).waitFor();
    assert.equal(await dialog.getByLabel('Answer').inputValue(), 'Draft');
    const last = (await calls()).at(-1)!;
    assert.deepEqual(last.interrupt, {ref:last.ref,hostId:'ssh-test',threadId:'thread-a',turnId:'turn-a'});
    await hide(); await reopen();
    assert.equal(await dialog.getByRole('button', {name:'Submit'}).isDisabled(), true);
    assert.equal((await calls()).length, beforeEscape + 1);

    await show('item/tool/requestUserInput', {questions:[{id:'q',question:'No interrupt callback',options:null}]}, {noInterrupt:true});
    await dialog.getByLabel('No interrupt callback').press('Escape');
    await dialog.getByText('The original turn cannot be interrupted here. Open its conversation to stop it.').waitFor();
    assert.equal((await calls()).length, beforeEscape + 1);
    await show('item/tool/requestUserInput', {questions:[{id:'q',question:'Dismiss special input',options:null}]}, {dismissEmpty:true});
    await dialog.getByLabel('Dismiss special input').press('Escape');
    assert.deepEqual((await calls()).at(-1)?.result, {answers:{}});

    await show('item/tool/requestUserInput', {questions:[{id:'q',question:'Wrong completion host',options:null}]},
      {completion:true,completionHost:'another-host'});
    const searchesBefore = (await page.evaluate(() => window.approvalHarness.searches)).length;
    await dialog.getByLabel('Wrong completion host').fill('@read');
    await page.waitForTimeout(250);
    assert.equal((await page.evaluate(() => window.approvalHarness.searches)).length, searchesBefore);

    await show('item/fileChange/requestApproval', {}, {wrongHost:true});
    await dialog.getByText('This request has inconsistent host or request identity.').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Approve',exact:true}).isDisabled(), true);
    await page.close();
  } finally { await browser.close(); }
});
