import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { permissionCatalog } from '../lib/permissions.ts';
import type { SessionConfig } from '../lib/codex-protocol.ts';
import { isCyberModel, loadComposerPermissions } from '../src/renderer/composer/composer-permissions.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

test('permission choices derive from the actual profile and administrative requirements', async () => {
  assert.equal(isCyberModel('fixture-DAYBREAK'), true);
  assert.equal(isCyberModel('cyber-fixture'), true);
  assert.equal(isCyberModel('fixture'), false);
  let requirements: unknown = { allowedPermissionProfiles: { ':workspace': true, ':danger-full-access': true },
    allowedApprovalPolicies: ['on-request'], allowedSandboxModes: ['workspace-write'], allowedApprovalsReviewers: ['user'] };
  const client = { async rpc(method: string) {
    if (method === 'config/read') return { config: { model: 'fixture', sandbox_mode: 'workspace-write', approval_policy: 'on-request' } };
    if (method === 'configRequirements/read') return { requirements };
    if (method === 'permissionProfile/list') return { data: [
      { id: ':workspace', allowed: true }, { id: ':read-only', allowed: true }, { id: ':danger-full-access', allowed: true },
    ], nextCursor: null };
    throw new Error('unexpected fixture RPC');
  } } as unknown as WorkbenchClient;
  const choices = await loadComposerPermissions(client, 'ssh:fixture', '/workspace', 'fixture', {}, false);
  assert.equal(choices.find(choice => choice.id === 'ask')?.allowed, true);
  assert.deepEqual(choices.find(choice => choice.id === 'ask')?.patch,
    { permissionProfileId: ':workspace', sandboxMode: undefined, approvalPolicy: 'on-request', approvalsReviewer: 'user' });
  assert.equal(choices.find(choice => choice.id === 'full-access')?.allowed, false);
  assert.equal(choices.find(choice => choice.id === 'sandbox:workspace-write')?.allowed, false);
  assert.equal(choices.find(choice => choice.id === 'sandbox:default')?.allowed, false);
  requirements = { allowedApprovalPolicies: 'invalid' };
  await assert.rejects(loadComposerPermissions(client, 'ssh:fixture', '/workspace', 'fixture', {}, false), /Invalid allowed approval policies/);
  requirements = { autoReview: { requiredOnModels: ['fixture'] }, allowedApprovalsReviewers: ['auto_review'] };
  const guarded = await loadComposerPermissions(client, 'ssh:fixture', '/workspace', 'fixture', {}, false);
  assert.equal(guarded.find(choice => choice.id === 'guardian')?.allowed, true);
  assert.equal(guarded.find(choice => choice.id === 'full-access')?.allowed, false);
  requirements = null;
  const unknownSession = await loadComposerPermissions(client, 'ssh:fixture', '/workspace', 'fixture', {}, false, {});
  assert.equal(unknownSession.find(choice => choice.id === 'policy:never')?.allowed, false);
  assert.equal(unknownSession.find(choice => choice.id === 'sandbox:workspace-write')?.allowed, false);
  assert.equal(unknownSession.find(choice => choice.id === 'ask')?.allowed, true);
  const unknownReviewer = await loadComposerPermissions(client, 'ssh:fixture', '/workspace', 'fixture',
    { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' }, false, {});
  assert.equal(unknownReviewer.find(choice => choice.id === 'policy:never')?.allowed, false);
  requirements = { autoReview: { requiredOnModels: ['protected-model'] } };
  await assert.rejects(loadComposerPermissions(client, 'ssh:fixture', '/workspace', undefined, {}, false, {}), /current model is not confirmed/);
});

test('composer presets match the host catalog for the same scoped inputs', async () => {
  const config: SessionConfig = { model: 'fixture', approval_policy: 'on-request', sandbox_mode: 'workspace-write' };
  const profiles = [{ id: ':workspace', allowed: true }, { id: ':read-only', allowed: true },
    { id: ':danger-full-access', allowed: true }, { id: 'team', allowed: true, description: 'Team profile' }];
  const requirements = { allowedApprovalsReviewers: ['user' as const], allowedSandboxModes: ['read-only' as const, 'workspace-write' as const, 'danger-full-access' as const] };
  const client = { async rpc(method: string) {
    if (method === 'config/read') return { config };
    if (method === 'configRequirements/read') return { requirements };
    if (method === 'permissionProfile/list') return { data: profiles, nextCursor: null };
    throw new Error('unexpected fixture RPC');
  } } as unknown as WorkbenchClient;
  const actual = await loadComposerPermissions(client, 'local', '/workspace', 'fixture', {}, false);
  const expected = permissionCatalog({ config, profiles, requirements, cwd: '/workspace', model: 'fixture' });
  for (const original of expected.filter(item => item.id !== 'config')) {
    const choice = actual.find(item => item.id === original.id);
    assert.equal(choice?.allowed, original.allowed, original.id);
    assert.equal(choice?.patch.permissionProfileId, original.native.permissions, original.id);
    assert.equal(choice?.patch.sandboxMode, undefined, original.id);
    assert.deepEqual(choice?.patch.approvalPolicy, original.native.approvalPolicy, original.id);
    assert.deepEqual(choice?.patch.approvalsReviewer, original.native.approvalsReviewer, original.id);
  }
  config.sandbox_mode = 'read-only';
  config.approval_policy = 'never';
  const custom = await loadComposerPermissions(client, 'local', '/workspace', 'fixture', {}, false);
  assert.deepEqual(custom.find(item => item.id === 'config')?.patch,
    { permissionProfileId: undefined, sandboxMode: 'read-only', approvalPolicy: 'never', approvalsReviewer: 'user' });
  assert.equal(custom.find(item => item.id === 'config')?.allowed, true);
  config.sandbox_mode = 'workspace-write';
  config.sandbox_workspace_write = { writable_roots: ['/outside'] };
  const unsupported = await loadComposerPermissions(client, 'local', '/workspace', 'fixture', {}, false);
  assert.equal(unsupported.find(item => item.id === 'config')?.allowed, false);
  assert.match(unsupported.find(item => item.id === 'config')?.reason ?? '', /cannot be preserved/);
  assert.equal(unsupported.find(item => item.id === 'sandbox:default')?.allowed, false);
});

test('project lease, confirmed permissions, file lookup and owner projection use the real composer', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {StandaloneComposer} from './src/renderer/composer/StandaloneComposer.tsx';
    const state={calls:[],projects:[],projections:[],requirements:null,deferProject:false,releaseProject:null,goals:0,failStorage:false};
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(state.failStorage && this.name==='atoms')throw Error('fixture storage failure');return originalPut.apply(this,args);};
    const client={async rpc(method,params={},hostId){state.calls.push({method,hostId});
      if(method==='model/list')return {data:[{id:'model',model:'model',displayName:'Fixture',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};
      if(method==='config/read')return {config:{model:'model',approval_policy:'on-request',sandbox_mode:'workspace-write'},layers:[{name:{type:'user',file:'/fixture/config.toml',profile:null},version:'1'}],yardConfigSource:{hostId,generation:'g1',homeDirectory:'/fixture',codexHome:'/fixture'}};
      if(method==='configRequirements/read')return {requirements:structuredClone(state.requirements)};
      if(method==='permissionProfile/list')return {data:[{id:':workspace',allowed:true},{id:':read-only',allowed:true},{id:':danger-full-access',allowed:true}],nextCursor:null};
      if(method==='thread/queue/list')return {data:[],nextCursor:null};
      throw Error('unexpected RPC '+method);
    },async host(method,params){if(method==='get-setting')return {exists:true,value:params.key==='composerPlainTextMode'?false:params.key==='composerEnterBehavior'?'enter':'queue'};
      if(method==='codex-home')return {codexHome:'/fixture'};
      if(method==='workspace-root-options')return {roots:['/workspace']};
      if(method==='workspace-directory-entries'){state.calls.push({endpoint:method,params:structuredClone(params)});return {entries:[{name:'alpha.ts',path:'alpha.ts',type:'file'}]};}
      throw Error('unexpected host '+method);
    },subscribe(){return ()=>{}},async reply(){throw Error('unexpected approval')}};
    const root=createRoot(document.getElementById('root'));
    let props={client,context:{hostId:'local',cwd:'/workspace',threadId:null,draftId:'home'},busy:false,
      projectChoices:[{projectId:'one',hostId:'local',cwd:'/workspace',name:'Local project'},{projectId:'one',hostId:'ssh:other',cwd:'/remote',name:'Remote project'}],selectedProjectId:'one',
      async onProjectChange(project,lease){state.projects.push({project,flushed:await lease.flush(),inert:document.querySelector('.standalone-composer > div').inert});
        if(state.deferProject)await new Promise(resolve=>{state.releaseProject=resolve;});},
      onOpenGoal(){state.goals++},onEffectiveOptionsChange(owner,options){state.projections.push({owner,options})},
      async onSubmit(){},async onInterrupt(){}};
    window.fixture={state,render(changes={}){props={...props,...changes,context:{...props.context,...changes.context}};
      root.render(React.createElement(I18nProvider,{locale:'en-US'},React.createElement(StandaloneComposer,props)));}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://contracts.test'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://contracts.test/'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const editor = page.getByRole('textbox', { name: 'Work with Codex' });
    await page.waitForFunction(() => (window as any).fixture.state.projections.length === 1);
    let projected = await page.evaluate(() => (window as any).fixture.state.projections);
    assert.deepEqual(projected[0].owner, { hostId: 'local', threadId: null, draftId: 'home' });
    assert.equal(projected[0].options.approvalPolicy, 'on-request');
    await page.evaluate(() => (window as any).fixture.render());
    assert.equal(await page.evaluate(() => (window as any).fixture.state.projections.length), 1);

    await editor.fill('keep this draft');
    await page.evaluate(() => { (window as any).fixture.state.deferProject = true; });
    await page.locator('.standalone-composer__target summary').click();
    const remote = page.getByRole('button', { name: /Remote project/ });
    assert.equal(await remote.getAttribute('aria-pressed'), 'false');
    await remote.click();
    await page.waitForFunction(() => (window as any).fixture.state.projects.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.projects[0]), {
      project: { projectId: 'one', hostId: 'ssh:other', cwd: '/remote', name: 'Remote project' }, flushed: true, inert: true,
    });
    assert.equal(await editor.inputValue(), 'keep this draft');
    await page.evaluate(() => { (window as any).fixture.state.deferProject = false; (window as any).fixture.state.releaseProject(); });
    await page.waitForFunction(() => !document.querySelector('.standalone-composer > div')?.hasAttribute('inert'));
    await page.getByRole('button', { name: "Don't work in a project" }).click();
    await page.waitForFunction(() => (window as any).fixture.state.projects.length === 2);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.projects[1].project), null);
    assert.equal(await editor.inputValue(), 'keep this draft');
    assert.match(await page.locator('.standalone-composer__target > details > summary').innerText(), /Local project/);

    await page.locator('.standalone-composer__access > summary').click();
    await page.getByRole('button', { name: /Full access/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.projections.at(-1).options.permissionProfileId), undefined);
    await page.locator('.standalone-composer__access > summary').click();
    await page.getByRole('button', { name: /Full access/ }).click();
    await page.evaluate(() => { (window as any).fixture.state.requirements = {allowedApprovalPolicies:['on-request']}; });
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'no longer allowed' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.projections.at(-1).options.permissionProfileId), undefined);
    await page.evaluate(() => { (window as any).fixture.state.requirements = null; });
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => (window as any).fixture.state.projections.at(-1).options.permissionProfileId === ':danger-full-access');
    projected = await page.evaluate(() => (window as any).fixture.state.projections);
    assert.equal(projected.at(-1).options.approvalPolicy, 'never');
    assert.equal(projected.at(-1).options.sandboxMode, undefined);
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.some((call: any) => call.method === 'config/batchWrite')), false);

    const accessMenu = page.locator('.standalone-composer__access');
    if (!await accessMenu.evaluate(element => (element as HTMLDetailsElement).open)) await accessMenu.locator(':scope > summary').click();
    await page.getByText('Other permission settings').click();
    const sandbox = page.getByLabel('Sandbox permissions');
    await sandbox.selectOption('read-only');
    await page.waitForFunction(() => (window as any).fixture.state.projections.at(-1).options.sandboxMode === 'read-only');
    await sandbox.selectOption('');
    await page.waitForFunction(() => (window as any).fixture.state.projections.at(-1).options.sandboxMode === 'workspace-write');
    const policy = page.getByLabel('Approval policy');
    await policy.selectOption('');
    await page.waitForFunction(() => (window as any).fixture.state.projections.at(-1).options.approvalPolicy === 'on-request');

    await editor.fill('before '); await editor.press('End');
    await page.locator('.standalone-composer__add summary').click();
    await page.getByRole('button', { name: 'Find files' }).click();
    await page.getByRole('button', { name: 'alpha.ts' }).waitFor();
    await page.getByRole('textbox', { name: 'Find files' }).fill('alpha');
    await page.getByRole('button', { name: 'alpha.ts' }).click();
    assert.equal(await editor.inputValue(), 'before `/workspace/alpha.ts` ');
    assert.ok(await page.evaluate(() => (window as any).fixture.state.calls.some((call: any) => call.endpoint === 'workspace-directory-entries'
      && call.params.hostId === 'local' && call.params.workspaceRoot === '/workspace')));
    await editor.press('Control+z');
    assert.equal(await editor.inputValue(), 'before ');
    await page.locator('.standalone-composer__add summary').click();
    await page.getByRole('button', { name: 'Find files' }).click();
    await page.getByRole('button', { name: 'alpha.ts' }).waitFor();
    await page.evaluate(() => (window as any).fixture.render({context:{cwd:'/other'}}));
    await page.waitForFunction(() => (window as any).fixture.state.calls.some((call: any) => call.endpoint === 'workspace-directory-entries'
      && call.params.workspaceRoot === '/other'));
    await page.getByRole('button', { name: 'alpha.ts' }).click();
    await page.getByRole('alert').filter({ hasText: 'The draft changed; search for the file again.' }).waitFor();
    assert.equal(await editor.inputValue(), 'before ');
    await page.locator('.standalone-composer__add summary').click();
    await page.evaluate(() => (window as any).fixture.render({context:{cwd:'/workspace'}}));
    await page.locator('.standalone-composer__add summary').click();
    await page.getByRole('button', { name: 'Goal', exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.goals), 1);

    await page.evaluate(() => (window as any).fixture.render({initialOptions:{model:'fixture-daybreak'}}));
    await page.waitForFunction(() => (window as any).fixture.state.projections.at(-1).options.model === 'fixture-daybreak');
    await page.locator('.standalone-composer__access > summary').click();
    await page.getByRole('button', { name: /Full access/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Enable Full Access for Cyber model?' }).waitFor();
    assert.match(await dialog.innerText(), /Cyber models carry a higher risk/);
    assert.match(await dialog.innerText(), /Files and folders/);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    await page.evaluate(() => { (window as any).fixture.state.failStorage = true; });
    await editor.fill('unsaved newer draft');
    await page.getByRole('alert').filter({ hasText: 'fixture storage failure' }).waitFor();
    await page.locator('.standalone-composer__target > details > summary').click();
    await page.getByRole('button', { name: /Remote project/ }).click();
    await page.getByRole('alert').filter({ hasText: 'Draft input could not be saved' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.projects.length), 2);
    assert.equal(await editor.inputValue(), 'unsaved newer draft');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
