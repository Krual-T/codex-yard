import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window { receiptEditorHarness: {
    calls: Record<string, unknown>[];
    setHost(host: string): void;
    setScopeStatus(state: 'loading' | 'ready'): void;
    rejectWrite(): void;
    reset(): void;
    requestLeave(): Promise<boolean>;
    record(): Promise<{ operationId: string; phase: string } | null>;
    drafts(): Promise<{ draft: Record<string, unknown> }[]>;
  }; receiptPanelHarness: { calls: Record<string, unknown>[]; submit(preparing?: boolean): Promise<string> } }
}

test('real settings editors restore rejected submissions and newer drafts after unmount', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneSettings} from './src/renderer/settings/StandaloneSettings.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    const section = new URLSearchParams(window.location.search).get('section');
    const calls = []; let host = 'ssh-fixture', scopeState = 'ready', guard, pending;
    const location = {pathname:'/settings/' + section,search:'',hash:'',state:null};
    const hook = key => ({key,eventName:'sessionStart',matcher:null,source:'user',sourcePath:'/fixture/hooks.json',
      trustStatus:'trusted',isManaged:false,enabled:true,handlerType:'command',command:'fixture',async:false});
    const skill = name => ({name,description:'Fixture skill',path:'/fixture/' + name + '/SKILL.md',scope:'repo',enabled:true,pluginId:null});
    const client = {subscribe:() => () => {}, reply:async () => {throw Error('Unexpected approval');},
      host:async (method, params = {}) => {
        if (method === 'refresh-remote-connections') return {remoteConnections:[{hostId:'ssh-fixture',displayName:'Fixture SSH'}]};
        if (method === 'os-info') return {platform:'linux',isSystemBackdropSupported:false};
        if (method === 'get-settings') return {values:{}};
        if (method.startsWith('get-')) return {exists:false};
        if (method === 'codex-home') return {codexHome:'/fixture'};
        if (method === 'configuration-write') {
          calls.push(structuredClone(params));
          if (params.action === 'submit') return new Promise(resolve => {pending = () => resolve({outcome:'error',
            error:{message:'configuration rejected',uncertain:false,category:'configVersionConflict'},
            operation:{operationId:params.operationId,hostId:params.hostId,method:params.method,state:'failed',
              terminal:{kind:'rejected',category:'configVersionConflict'}}});});
          return {operation:null};
        }
        throw Error('Unexpected host endpoint: ' + method);
      },
      rpc:async (method, params, hostId) => {
        const source = {hostId,generation:'fixture',homeDirectory:'/fixture',codexHome:'/fixture'};
        if (method === 'config/read') return {config:{model:'alpha',model_reasoning_effort:'high',approval_policy:'on-request',
          sandbox_mode:'read-only',profile:null,desktop:{}},layers:[{name:{type:'user',file:'/fixture/config.toml',profile:null},version:'v1'}],yardConfigSource:source};
        if (method === 'configRequirements/read') return {requirements:null};
        if (method === 'model/list') return {data:['alpha','beta'].map(name => ({id:name,model:name,displayName:name,
          isDefault:name === 'alpha',supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'low'}]})),nextCursor:null};
        if (method === 'hooks/list') return {data:[{cwd:params.cwds[0],hooks:[hook('first'),hook('second')],warnings:[],errors:[]}]};
        if (method === 'skills/list') return {data:[{cwd:params.cwds[0],skills:[skill('first'),skill('second')],errors:[]}],yardConfigSource:source};
        throw Error('Unexpected RPC: ' + method);
      }};
    let root = createRoot(document.getElementById('root'));
    const render = () => root.render(<I18nProvider locale="en-US"><StandaloneSettings client={client} hostId={host} location={location}
      projectRoots={{hostId:host,paths:['/fixture/project']}} sessionCwd={null} scopeStatus={{state:scopeState,retry:() => {}}}
      InstructionEditor={() => null} onNavigate={() => {}} onClose={() => {}} registerNavigationGuard={value => {guard = value;}} /></I18nProvider>);
    window.receiptEditorHarness = {calls, setHost:value => {host = value;render();},
      setScopeStatus:value => {scopeState = value;render();}, rejectWrite:() => pending(),
      reset:() => {root.unmount();root = createRoot(document.getElementById('root'));render();},
      requestLeave:() => guard.requestLeave(),
      record:() => settingsConfigOperations(client).find('ssh-fixture',section,
        section === 'hooks-settings' || section === 'skills-settings' ? ['/fixture/project'] : undefined),
      drafts:async () => {const ops=settingsConfigOperations(client);await ops.refresh();return ops.getSnapshot().drafts;}};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    for (const section of ['models', 'agent', 'worktrees', 'hooks-settings', 'skills-settings']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
      await page.goto(`http://settings-receipt-fixture.invalid/?section=${section}`);
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const main = page.getByRole('main');
      if (section === 'models') await main.getByRole('combobox', { name: 'Model', exact: true }).selectOption('beta');
      if (section === 'agent') await main.getByRole('combobox', { name: 'Approval policy' }).selectOption('never');
      if (section === 'worktrees') await main.getByRole('textbox', { name: 'Worktree root' }).fill('/fixture/worktree');
      if (section === 'hooks-settings') await main.getByRole('checkbox', { name: 'SessionStart hook 1' }).uncheck();
      if (section === 'skills-settings') await main.getByRole('checkbox', { name: 'first (repo, /fixture/first/SKILL.md)' }).uncheck();
      await main.locator('.yard-inline-save').getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => window.receiptEditorHarness.calls.some(call => call.action === 'submit'));
      if (section === 'hooks-settings' || section === 'skills-settings') {
        await page.evaluate(() => window.receiptEditorHarness.setScopeStatus('loading'));
        await main.getByRole('status').waitFor();
      } else {
        await page.evaluate(() => window.receiptEditorHarness.setHost('local'));
        await page.getByRole('combobox', { name: 'Settings host' }).waitFor();
      }
      assert.equal(await page.evaluate(() => window.receiptEditorHarness.requestLeave()), false, section);
      await page.evaluate(() => window.receiptEditorHarness.rejectWrite());
      await page.waitForFunction(async () => (await window.receiptEditorHarness.record())?.phase === 'finished');
      await page.getByRole('region', { name: 'Configuration save recovery' })
        .getByText('The configuration changed. Reload and review your edits before saving again.', { exact: true }).waitFor();
      const original = await page.evaluate(() => window.receiptEditorHarness.record());
      assert.ok(original?.operationId);
      if (section === 'hooks-settings' || section === 'skills-settings') await page.evaluate(() => window.receiptEditorHarness.setScopeStatus('ready'));
      else await page.evaluate(() => window.receiptEditorHarness.setHost('ssh-fixture'));
      if (section !== 'hooks-settings' && section !== 'skills-settings') {
        await main.getByRole('region', { name: 'Saved configuration edits' }).getByRole('button', { name: 'Restore this edit' }).last().click();
      }
      if (section === 'models') {
        await page.waitForFunction(() => (document.querySelector('[aria-label="Model"]') as HTMLSelectElement | null)?.value === 'beta');
        await main.getByRole('combobox', { name: 'Reasoning effort' }).selectOption('low');
      }
      if (section === 'agent') {
        await page.waitForFunction(() => (document.querySelector('[aria-label="Approval policy"]') as HTMLSelectElement | null)?.value === 'never');
        await main.getByRole('combobox', { name: 'Sandbox mode' }).selectOption('workspace-write');
      }
      if (section === 'worktrees') {
        await page.waitForFunction(() => (document.querySelector('[aria-label="Worktree root"]') as HTMLInputElement | null)?.value === '/fixture/worktree');
        await main.getByRole('spinbutton', { name: 'Auto-delete limit' }).fill('4');
      }
      if (section === 'hooks-settings' || section === 'skills-settings') {
        await main.getByRole('button', { name: 'Use current state and keep edits' }).click();
        if (section === 'hooks-settings') await main.getByRole('checkbox', { name: 'SessionStart hook 2' }).uncheck();
        else await main.getByRole('checkbox', { name: 'second (repo, /fixture/second/SKILL.md)' }).uncheck();
      }
      await page.waitForFunction(async section => (await window.receiptEditorHarness.drafts()).some(({draft}) =>
        section === 'models' ? draft.effort === 'low' : section === 'agent' ? (draft.values as {sandbox?: string})?.sandbox === 'workspace-write' :
        section === 'worktrees' ? (draft.draft as {keepCount?: string})?.keepCount === '4' : Array.isArray(draft.drafts) && draft.drafts.length === 2), section);
      await page.evaluate(() => window.receiptEditorHarness.reset());
      await main.getByRole('region', { name: 'Saved configuration edits' }).getByRole('button', { name: 'Restore this edit' }).last().click();
      if (section === 'models') {
        await page.waitForFunction(() => (document.querySelector('[aria-label="Model"]') as HTMLSelectElement | null)?.value === 'beta'
          && (document.querySelector('[aria-label="Reasoning effort"]') as HTMLSelectElement | null)?.value === 'low');
      }
      if (section === 'agent') {
        await page.waitForFunction(() => (document.querySelector('[aria-label="Approval policy"]') as HTMLSelectElement | null)?.value === 'never'
          && (document.querySelector('[aria-label="Sandbox mode"]') as HTMLSelectElement | null)?.value === 'workspace-write');
      }
      if (section === 'worktrees') {
        await page.waitForFunction(() => (document.querySelector('[aria-label="Worktree root"]') as HTMLInputElement | null)?.value === '/fixture/worktree'
          && (document.querySelector('[aria-label="Auto-delete limit"]') as HTMLInputElement | null)?.value === '4');
      }
      if (section === 'hooks-settings' || section === 'skills-settings') {
        const first = section === 'hooks-settings' ? 'SessionStart hook 1' : 'first (repo, /fixture/first/SKILL.md)';
        const second = section === 'hooks-settings' ? 'SessionStart hook 2' : 'second (repo, /fixture/second/SKILL.md)';
        await main.getByRole('checkbox', { name: second }).waitFor();
        assert.equal(await main.getByRole('checkbox', { name: first }).isChecked(), false, section);
        assert.equal(await main.getByRole('checkbox', { name: second }).isChecked(), false, section);
      }
      assert.equal((await page.evaluate(() => window.receiptEditorHarness.record()))?.operationId, original.operationId);
      assert.equal((await page.evaluate(() => window.receiptEditorHarness.calls.filter(call => call.action === 'submit'))).length, 1);
      assert.deepEqual(errors, [], section);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('recovery panel carries a saved signed receipt across pages without reconnecting the removed host', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 45_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConfigurationRecovery} from './src/renderer/settings/ConfigurationRecovery.tsx';
    import {settingsConfigOperations} from './src/renderer/settings/config-operations.ts';
    const calls = [];
    const client = {subscribe:() => () => {}, reply:async () => {}, rpc:async () => {throw Error('direct RPC');},
      host:async (endpoint, input) => {
        calls.push(structuredClone(input));
        if (endpoint !== 'configuration-write' || input.hostId !== 'removed-host') throw Error('unexpected endpoint or host');
        if (input.action === 'submit' && input.params.preparingFixture) return {outcome:'existing',
          operation:{operationId:input.operationId,hostId:input.hostId,method:input.method,state:'preparing'}};
        if (input.action === 'submit') {
          const terminal = {kind:'okOverridden'}, receipt = {operationId:input.operationId,hostId:input.hostId,
            method:input.method,terminal,signature:'fixture-signature'};
          return {outcome:'success',result:{status:'okOverridden'},operation:{operationId:input.operationId,hostId:input.hostId,
            method:input.method,state:'pending',storageError:true,observedTerminal:terminal,recoveryReceipt:receipt}};
        }
        if (input.action === 'status') return input.operationId === preparingId ? {operation:{operationId:input.operationId,
          hostId:input.hostId,method:'config/batchWrite',state:'preparing',interrupted:true}} : {operation:null};
        if (input.operationId === preparingId && input.action === 'retry-persistence' && !input.receipt) return {operation:{
          operationId:input.operationId,hostId:input.hostId,method:'config/batchWrite',state:'failed',terminal:{kind:'not-sent'}}};
        const receipt = input.receipt;
        if (input.action !== 'retry-persistence' || receipt?.operationId !== input.operationId || receipt.hostId !== input.hostId
          || receipt.method !== 'config/batchWrite' || receipt.signature !== 'fixture-signature' || receipt.terminal?.kind !== 'okOverridden') {
          throw Error('original receipt mismatch');
        }
        return {operation:{operationId:input.operationId,hostId:input.hostId,method:receipt.method,state:'succeeded',terminal:receipt.terminal}};
      }};
    const operations = settingsConfigOperations(client);
    let preparingId;
    window.receiptPanelHarness = {calls, submit:async preparing => {
      try {await operations.submit('removed-host','config/batchWrite',{edits:[{keyPath:'model',value:'beta'}],...(preparing ? {preparingFixture:true} : {})},
        {section:'models',source:{hostId:'removed-host',generation:'fixture',homeDirectory:'/fixture',codexHome:'/fixture/codex'},draft:{model:'beta'}},undefined,id => {if (preparing) preparingId = id;});return 'unexpected success';} catch(error) {return error.message;}
    }};
    createRoot(document.getElementById('root')).render(<ConfigurationRecovery client={client}/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const first = await context.newPage(), second = await context.newPage();
    for (const page of [first, second]) {
      await page.goto('http://receipt-panel-fixture.invalid/');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    }
    assert.match(await first.evaluate(() => window.receiptPanelHarness.submit()), /host.*receipt/i);
    const panel = second.getByRole('region', { name: 'Configuration save recovery' });
    await panel.getByText('The original recovery receipt is saved in this browser.').waitFor();
    await panel.getByRole('button', { name: 'Check original operation' }).click();
    await panel.getByText('The host has no confirmed original operation. Its result remains unknown.').waitFor();
    await panel.getByRole('button', { name: 'Retry saving host receipt' }).click();
    await second.waitForFunction(() => [...document.querySelectorAll('[aria-label="Configuration save recovery"] p')]
      .some(node => node.textContent?.includes('models | removed-host | finished')));
    await panel.getByText(/Result: okOverridden/).waitFor();
    const original = await first.evaluate(() => window.receiptPanelHarness.calls);
    const recovered = await second.evaluate(() => window.receiptPanelHarness.calls);
    assert.deepEqual(original.map(call => call.action), ['submit']);
    assert.deepEqual(recovered.map(call => call.action), ['status', 'retry-persistence']);
    assert.equal(recovered[1]?.operationId, original[0]?.operationId);
    assert.equal((recovered[1]?.receipt as { operationId: string }).operationId, original[0]?.operationId);
    await panel.getByRole('button', { name: 'Close original operation' }).click();
    await first.waitForFunction(() => !document.querySelector('[aria-label="Configuration save recovery"]'));
    assert.match(await first.evaluate(() => window.receiptPanelHarness.submit(true)), /unknown result/);
    const firstPanel = first.getByRole('region', { name: 'Configuration save recovery' });
    await firstPanel.getByText('Preparing the original configuration save.').waitFor();
    await firstPanel.getByRole('button', { name: 'Check original operation' }).click();
    await firstPanel.getByText('Preparation was interrupted before sending. Save the host status to finish recovery.').waitFor();
    await firstPanel.getByRole('button', { name: 'Retry saving host receipt' }).click();
    await firstPanel.getByText(/Result: not-sent/).waitFor();
    assert.equal((await first.evaluate(() => window.receiptPanelHarness.calls.filter(call => call.action === 'submit'))).length, 2);
    await context.close();
  } finally { await browser.close(); }
});
