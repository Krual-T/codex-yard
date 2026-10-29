import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    scopeStatusHarness: {
      calls: { method: string; params?: { cwds?: string[] }; hostId?: string }[];
      retries: number;
      setStatus(state: 'loading' | 'error' | 'ready', error?: string): void;
      setScope(roots: { hostId: string; paths: string[] } | null, cwd: { hostId: string; path: string } | null): void;
      navigate(path: string): void;
      resolveWrite(): void;
    };
  }
}

test('settings waits for host-bound scope and retains pending hook and skill edits', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneSettings } from './src/renderer/settings/StandaloneSettings.tsx';
      import { I18nProvider } from './src/renderer/i18n/index.tsx';
      const calls = [];
      let retries = 0, pendingWrite;
      let location = { pathname:'/settings/hooks-settings', search:'', hash:'', state:{ fixture: true } };
      let roots = { hostId:'local', paths:['/fixture/local'] }, cwd = null;
      let status = { state:'loading', retry:() => { retries++; } };
      const hook = {key:'fixture',eventName:'sessionStart',matcher:null,source:'user',sourcePath:'/fixture/hooks.json',
        trustStatus:'trusted',isManaged:false,enabled:true,handlerType:'command',command:'fixture',async:false};
      const skill = {name:'review',description:'Fixture skill',path:'/fixture/review/SKILL.md',scope:'repo',enabled:true,pluginId:null};
      const client = {
        subscribe:() => () => {},
        reply:async () => { throw Error('Unexpected approval'); },
        host:async (method, params = {}) => {
          if (method === 'refresh-remote-connections') return {remoteConnections:[{hostId:'ssh-fixture',displayName:'Fixture SSH'}]};
          if (method === 'os-info') return {platform:'linux',isSystemBackdropSupported:false};
          if (method === 'get-settings') return {values:{}};
          if (method.startsWith('get-')) return {exists:false};
          if (method === 'codex-home') return {codexHome:'/fixture'};
          if (method === 'configuration-write' && params.action === 'submit') {
            const {hostId,operationId,method:writeMethod,params:writeParams} = params;
            calls.push({method:writeMethod,params:writeParams,hostId});
            return new Promise(resolve => { pendingWrite = () => {
              const result = writeMethod === 'config/batchWrite' ? {status:'ok'} : {effectiveEnabled:false};
              const terminal = writeMethod === 'config/batchWrite' ? {kind:'ok'} : {kind:'effectiveEnabled',value:false};
              resolve({outcome:'success',result,operation:{operationId,hostId,method:writeMethod,state:'succeeded',terminal}});
            }; });
          }
          throw Error('Unexpected host request: ' + method);
        },
        rpc:async (method, params, hostId) => {
          calls.push({method,params,hostId});
          if (method === 'hooks/list') return {data:[{cwd:params.cwds[0],hooks:[hook],warnings:[],errors:[]}]};
          if (method === 'skills/list') return {data:[{cwd:params.cwds[0],skills:[skill],errors:[]}],yardConfigSource:{hostId,generation:'fixture',homeDirectory:'/fixture',codexHome:'/fixture'}};
          if (method === 'plugin/installed' || method === 'plugin/list') return {marketplaces:[]};
          if (method === 'plugin/read') return {plugin:{marketplaceName:'fixture',summary:{id:'fixture',name:'fixture',installed:true,enabled:true,
            interface:{displayName:'Fixture plugin'}},description:null,skills:[],hooks:[],apps:[],appTemplates:[],mcpServers:[],scheduledTasks:null}};
          if (method === 'config/read') return {config:{},layers:[{name:{type:'user',file:'/fixture/config.toml',profile:null},version:'v1'}],yardConfigSource:{hostId,generation:'fixture',homeDirectory:'/fixture',codexHome:'/fixture'}};
          throw Error('Unexpected RPC: ' + method);
        },
      };
      const root = createRoot(document.getElementById('root'));
      const navigate = (path, options) => {
        const url = new URL(path, 'http://fixture.invalid');
        location = {pathname:url.pathname,search:url.search,hash:url.hash,state:options?.state};
        render();
      };
      const render = () => root.render(<I18nProvider locale="en-US"><StandaloneSettings client={client}
        hostId={new URLSearchParams(location.search).get('hostId') || 'local'} location={location}
        projectRoots={roots} sessionCwd={cwd} scopeStatus={status} InstructionEditor={() => null}
        onNavigate={navigate} onClose={() => {}} /></I18nProvider>);
      window.scopeStatusHarness = {calls, get retries() {return retries;},
        setStatus:(state,error) => {status = {state,error,retry:() => {retries++;}}; render();},
        setScope:(nextRoots,nextCwd) => {roots = nextRoots; cwd = nextCwd; render();},
        navigate:path => navigate(path,{state:{fixture:true}}),
        resolveWrite:() => pendingWrite?.()};
      render();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://settings-fixture.invalid/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const main = page.getByRole('main');
    const idle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const openSkills = async (target = page) => {
      await target.getByRole('searchbox', { name: 'Search settings' }).fill('Skills');
      await target.locator('[aria-label="Settings search results"]').getByRole('button', { name: 'Skills', exact: true }).click();
    };
    const scopedCalls = () => page.evaluate(() => window.scopeStatusHarness.calls.filter(call =>
      ['hooks/list', 'skills/list', 'plugin/list', 'plugin/installed'].includes(call.method)));

    for (const section of ['Hooks', 'Skills', 'Plugins']) {
      if (section === 'Skills') await openSkills();
      else await page.getByRole('button', { name: section, exact: true }).click();
      await main.getByRole('status').waitFor();
      await idle();
      assert.deepEqual(await scopedCalls(), []);
    }
    await page.getByRole('button', { name: 'General', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language' }).waitFor();
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('Hooks');
    await page.locator('[aria-label="Settings search results"]').getByRole('button', { name: 'Hooks', exact: true }).click();
    await page.evaluate(() => window.scopeStatusHarness.setStatus('error', 'Fixture metadata failed'));
    const alert = main.getByRole('alert');
    await alert.waitFor();
    assert.match(await alert.innerText(), /Fixture metadata failed/);
    await alert.getByRole('button', { name: 'Retry' }).click();
    assert.equal(await page.evaluate(() => window.scopeStatusHarness.retries), 1);
    assert.deepEqual(await scopedCalls(), []);

    await page.evaluate(() => { window.scopeStatusHarness.setScope(null, null); window.scopeStatusHarness.setStatus('ready'); });
    await main.getByText('Select a project or session with a working directory.').first().waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === 'H2' && document.activeElement.textContent === 'Hooks');
    assert.deepEqual(await scopedCalls(), []);
    await page.evaluate(() => window.scopeStatusHarness.setScope({ hostId: 'local', paths: ['/fixture/local'] }, null));
    await page.getByRole('checkbox', { name: 'SessionStart hook 1' }).waitFor();
    await page.waitForFunction(() => window.scopeStatusHarness.calls.some(call => call.method === 'hooks/list'));
    await openSkills();
    await page.getByRole('checkbox', { name: 'review (repo, /fixture/review/SKILL.md)' }).waitFor();
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    await main.getByText('No installed plugins.').waitFor();
    assert.deepEqual((await scopedCalls()).map(call => [call.method, call.hostId, call.params?.cwds]), [
      ['hooks/list', 'local', ['/fixture/local']], ['skills/list', 'local', ['/fixture/local']],
      ['plugin/installed', 'local', ['/fixture/local']],
    ]);

    await page.getByRole('combobox', { name: 'Settings host' }).selectOption('ssh-fixture');
    await main.getByRole('status').waitFor();
    await idle();
    assert.equal((await scopedCalls()).length, 3);
    await page.evaluate(() => { window.scopeStatusHarness.setStatus('loading'); window.scopeStatusHarness.setScope({ hostId: 'ssh-fixture', paths: ['/fixture/remote'] }, null); });
    await idle();
    assert.equal((await scopedCalls()).length, 3);
    await page.evaluate(() => window.scopeStatusHarness.setStatus('ready'));
    await main.getByText('No installed plugins.').waitFor();
    assert.deepEqual((await scopedCalls()).at(-1), { method: 'plugin/installed', params: { cwds: ['/fixture/remote'] }, hostId: 'ssh-fixture' });
    await page.getByRole('button', { name: 'Hooks', exact: true }).click();
    const hook = page.getByRole('checkbox', { name: 'SessionStart hook 1' });
    await hook.waitFor();
    await hook.uncheck();
    await page.evaluate(() => window.scopeStatusHarness.setStatus('loading'));
    await main.getByRole('status').waitFor();
    await page.getByRole('button', { name: 'General', exact: true }).click();
    await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).waitFor();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await page.evaluate(() => window.scopeStatusHarness.setStatus('ready'));
    await hook.waitFor();
    assert.equal(await hook.isChecked(), false);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.scopeStatusHarness.calls.some(call => call.method === 'config/batchWrite'));
    await page.evaluate(() => window.scopeStatusHarness.setStatus('loading'));
    await main.getByRole('status').waitFor();
    await idle();
    const callsBeforeLate = (await scopedCalls()).length;
    await page.evaluate(() => window.scopeStatusHarness.resolveWrite());
    await page.waitForFunction(() => document.querySelector('[aria-label="Configuration save recovery"]')?.textContent?.includes('Result: ok'));
    await idle();
    assert.equal((await scopedCalls()).length, callsBeforeLate);
    await page.evaluate(() => window.scopeStatusHarness.setStatus('ready'));
    await main.getByText('Current hook state on the host:').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    assert.equal(await hook.isChecked(), false);
    assert.equal((await page.evaluate(() => window.scopeStatusHarness.calls.filter(call => call.method === 'config/batchWrite'))).length, 1);
    const skillPage = await browser.newPage();
    await skillPage.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    skillPage.on('pageerror', error => errors.push(error.message));
    await skillPage.goto('http://settings-fixture.invalid/');
    await skillPage.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await openSkills(skillPage);
    await skillPage.evaluate(() => window.scopeStatusHarness.setStatus('ready'));
    const skill = skillPage.getByRole('checkbox', { name: 'review (repo, /fixture/review/SKILL.md)' });
    await skill.waitFor();
    await skill.uncheck();
    await skillPage.evaluate(() => window.scopeStatusHarness.setStatus('error', 'Fixture metadata failed'));
    await skillPage.getByRole('main').getByRole('alert').waitFor();
    await skillPage.evaluate(() => window.scopeStatusHarness.setStatus('ready'));
    await skill.waitFor();
    assert.equal(await skill.isChecked(), false);
    await skillPage.getByRole('button', { name: 'Save', exact: true }).click();
    await skillPage.waitForFunction(() => window.scopeStatusHarness.calls.some(call => call.method === 'skills/config/write'));
    await skillPage.evaluate(() => window.scopeStatusHarness.setStatus('loading'));
    await skillPage.getByRole('main').getByRole('status').waitFor();
    await skillPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await skillPage.evaluate(() => window.scopeStatusHarness.resolveWrite());
    await skillPage.waitForFunction(() => document.querySelector('[aria-label="Configuration save recovery"]')?.textContent?.includes('Result: effectiveEnabled'));
    await skillPage.evaluate(() => window.scopeStatusHarness.setStatus('ready'));
    await skillPage.getByRole('main').getByText('Current skill state on the host:').waitFor();
    assert.equal(await skillPage.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    assert.equal(await skill.isChecked(), false);
    assert.equal((await skillPage.evaluate(() => window.scopeStatusHarness.calls.filter(call => call.method === 'skills/config/write'))).length, 1);

    const detailPage = await browser.newPage();
    await detailPage.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    detailPage.on('pageerror', error => errors.push(error.message));
    await detailPage.goto('http://settings-fixture.invalid/');
    await detailPage.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await detailPage.evaluate(() => {
      window.scopeStatusHarness.setScope({ hostId: 'ssh-fixture', paths: ['/fixture/remote'] }, null);
      window.scopeStatusHarness.navigate('/settings/plugins-settings/hosts/ssh-fixture/plugins/fixture?pluginName=fixture&marketplacePath=%2Ffixture%2Fmarket');
    });
    await detailPage.getByRole('main').getByRole('status').waitFor();
    await detailPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.deepEqual(await detailPage.evaluate(() => window.scopeStatusHarness.calls.filter(call => call.method === 'plugin/read')), []);
    await detailPage.evaluate(() => window.scopeStatusHarness.setStatus('ready'));
    await detailPage.getByRole('heading', { name: 'Fixture plugin' }).waitFor();
    assert.deepEqual(await detailPage.evaluate(() => window.scopeStatusHarness.calls.filter(call => call.method === 'plugin/read')), [
      { method: 'plugin/read', params: { marketplacePath: '/fixture/market', pluginName: 'fixture' }, hostId: 'ssh-fixture' },
    ]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
