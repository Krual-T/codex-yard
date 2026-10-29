import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    pluginHarness: {
      calls: { name: string; params?: Record<string, unknown>; hostId?: string }[];
      switchHost(hostId: string): void;
      resolveOld(): void;
      resolveSearch(): void;
      rejectLateInstall(): void;
      releaseDeferred(): void;
      delayInventory(): void;
      releaseInventory(): void;
    };
  }
}

const chrome = '/usr/bin/google-chrome';
test('plugins use real protocol shapes, preserve failures, and isolate hosts', {
  skip: !existsSync(chrome) && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PluginsPage } from './src/renderer/pages/plugins/PluginsPage.tsx';
    const calls = [], listeners = new Set();
    const plugin = {id:'writer@sample',name:'writer',installed:false,enabled:false,installPolicy:'AVAILABLE',source:{type:'local'},interface:{displayName:'Document writer'}};
    const marketplace = {name:'sample',path:'/catalog',plugins:[plugin]};
    let hostId='old', oldResolve, searchResolve, lateReject, releaseDeferred, releaseInventory, delayInventory=false, failInventory=true, failRead=true, failInstall=true, failSetting=true, failAdd=true, failShared=true, failSearch=true, failCheck=true;
    const unresolved=new Set();
    const client = {
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async rpc(name, params, hostId) {
        calls.push({name,params,hostId});
        if (name === 'plugin/installed') {
          if (hostId === 'local' && failInventory) { failInventory=false; throw Error('synthetic inventory failure'); }
          if (delayInventory) { delayInventory=false; calls.push({name:'inventory-pending'}); return await new Promise(resolve => releaseInventory=() => resolve({marketplaces:plugin.installed ? [marketplace] : []})); }
          return {marketplaces:plugin.installed ? [marketplace] : []};
        }
        if (name === 'plugin/list') {
          if (hostId === 'old') return await new Promise(resolve => oldResolve=resolve);
          return {marketplaces:[marketplace]};
        }
        if (name === 'plugin/search') {
          if (params.searchTerm === 'stale') return await new Promise(resolve => searchResolve=resolve);
          if (failSearch) { failSearch=false; throw Error('synthetic search failure'); }
          const item = params.cursor ? {...plugin,id:'second@sample',name:'second',interface:{displayName:'Second result'}} : plugin;
          return {data:[{marketplaceName:'sample',marketplacePath:'/catalog',plugin:item}],nextCursor:params.cursor ? null : 'search-next'};
        }
        if (name === 'plugin/read') {
          if (failRead) { failRead=false; throw Error('synthetic detail failure'); }
          return {plugin:{summary:{...plugin},marketplaceName:'sample',apps:[{id:'app',name:'Example app'}],skills:[],mcpServers:[],hooks:[]}};
        }
        if (name === 'plugin/install') {
          if (hostId === 'late') return await new Promise((resolve,reject) => lateReject=reject);
          if (failInstall) { failInstall=false; throw Error('synthetic install timeout'); }
          plugin.installed=true; plugin.enabled=true;
          return {authPolicy:'ON_INSTALL',appsNeedingAuth:[{id:'app',name:'Example app'}]};
        }
        if (name === 'config/read') return {layers:[{name:{type:'user',file:'/isolated/config.toml'},version:'v1'}]};
        if (name === 'config/batchWrite') {
          if (failSetting) { failSetting=false; throw Error('synthetic config timeout'); }
          plugin.enabled=params.edits[0].value; return {status:'ok'};
        }
        if (name === 'plugin/uninstall') { plugin.installed=false; plugin.enabled=false; return {}; }
        if (name === 'marketplace/add') {
          if (failAdd) { failAdd=false; throw Error('synthetic add timeout'); }
          return {marketplaceName:'added',installedRoot:'/added',alreadyAdded:false};
        }
        throw Error('unexpected RPC '+name);
      }, async host() { throw Error('unused'); }, reply() { throw Error('unused'); }
    };
    const root = createRoot(document.getElementById('root'));
    function render() { root.render(<PluginsPage client={client} hostId={hostId} cwd="/work" accountKey={hostId==='unavailable'?null:'synthetic-account'} hasUnresolvedChanges={unresolved.has(hostId)}
      onTrackPluginChange={hostId==='unavailable' ? undefined : async (change,operation) => { calls.push({name:'track',params:change}); unresolved.add(change.hostId); render();
        if (change.hostId==='defer') await new Promise(resolve => releaseDeferred=resolve);
        try { await operation(); unresolved.delete(change.hostId); } catch(error) { calls.push({name:'track-failed',hostId:change.hostId}); throw error; } finally { render(); } }}
      onReconcilePluginChanges={async scope => { calls.push({name:'check',params:scope}); if(failCheck){failCheck=false;throw Error('synthetic check failure');} unresolved.delete(scope.hostId); render(); }} onBrowseSkills={() => calls.push({name:'skills'})}
      onManagePlugins={() => calls.push({name:'manage'})} onConnectApp={value => calls.push({name:'connect',params:value})}
      onTryPlugin={value => calls.push({name:'try',params:value})}
      onLoadPersonalPlugins={async value => { calls.push({name:'personal',params:value});
        if (value.section==='shared' && failShared) { failShared=false; throw Error('synthetic shared failure'); }
        if (value.section==='shared') return {entries:[],nextCursor:null};
        const item=value.cursor ? {...plugin,id:'personal-two@sample',name:'personal-two',interface:{displayName:'Second personal'}} : plugin;
        return {entries:[{marketplaceName:'sample',marketplacePath:'/catalog',plugin:item}],nextCursor:value.cursor ? null : 'personal-next'}; }} />); }
    window.pluginHarness = {calls, switchHost(value) { hostId=value; render(); }, resolveOld() { oldResolve({marketplaces:[{...marketplace,plugins:[{...plugin,name:'stale',interface:{displayName:'Stale plugin'}}]}]}); },
      resolveSearch() { searchResolve({data:[{marketplaceName:'sample',marketplacePath:'/catalog',plugin:{...plugin,interface:{displayName:'Stale search'}}}],nextCursor:null}); },
      rejectLateInstall() { lateReject(Error('synthetic late timeout')); }, releaseDeferred() { releaseDeferred(); },
      delayInventory() { delayInventory=true; }, releaseInventory() { releaseInventory(); }};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root" style="--yard-bg:rgb(20,30,40);--yard-font-size:17px;--yard-ui-font:serif"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/pages/plugins/plugins.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => window.pluginHarness.calls.some(call => call.name === 'plugin/list' && call.hostId === 'old'));
    await page.evaluate(() => window.pluginHarness.switchHost('local'));
    await page.getByText('synthetic inventory failure', { exact: false }).waitFor();
    await page.evaluate(() => window.pluginHarness.resolveOld());
    assert.equal(await page.getByText('Stale plugin').count(), 0);
    assert.equal(await page.locator('.yard-plugins').evaluate(element => getComputedStyle(element).fontSize), '17px');
    const row = page.getByRole('button', { name: /Document writer/ }); await row.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('synthetic detail failure', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await dialog.getByText('synthetic inventory failure', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Install', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Refresh plugins' }).click();
    await dialog.getByRole('button', { name: 'Install', exact: true }).click();
    await dialog.getByText('synthetic install timeout', { exact: false }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Refresh plugins' }).click();
    await row.click();
    assert.equal(await dialog.getByRole('button', { name: 'Install', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Check changes' }).click();
    await dialog.getByText('synthetic check failure', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Install', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.pluginHarness.delayInventory());
    await dialog.getByRole('button', { name: 'Check changes' }).click();
    await page.waitForFunction(() => window.pluginHarness.calls.some(call => call.name === 'inventory-pending'));
    assert.equal(await dialog.getByRole('button', { name: 'Install', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.pluginHarness.releaseInventory());
    await dialog.getByRole('button', { name: 'Install', exact: true }).click();
    const enabled = dialog.getByRole('checkbox', { name: 'Enabled' }); await enabled.waitFor();
    await enabled.click(); await dialog.getByText('synthetic config timeout', { exact: false }).waitFor();
    assert.equal(await enabled.isChecked(), true);
    await dialog.getByRole('button', { name: 'Check changes' }).click();
    await enabled.uncheck();
    await page.waitForFunction(() => window.pluginHarness.calls.filter(call => call.name === 'config/batchWrite').length === 2);
    await enabled.check();
    await dialog.getByRole('button', { name: 'Try in chat' }).click();
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await dialog.getByRole('button', { name: 'Uninstall', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm uninstall' }).click();
    await dialog.getByRole('button', { name: 'Install', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const add = page.getByRole('dialog');
    await add.getByLabel('Marketplace source').fill('https://example.com/catalog.git');
    await add.getByLabel('Git ref (optional)').fill('main');
    await add.getByRole('button', { name: 'Add marketplace' }).click();
    await add.getByText('synthetic add timeout', { exact: false }).waitFor();
    assert.equal(await add.getByLabel('Marketplace source').inputValue(), 'https://example.com/catalog.git');
    await add.getByRole('button', { name: 'Check changes' }).click();
    await add.getByRole('button', { name: 'Add marketplace' }).click();
    await add.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Personal' }).click();
    const created = page.locator('.yard-plugins-paged').filter({ has: page.getByRole('heading', { name: 'Created by you' }) });
    const shared = page.locator('.yard-plugins-paged').filter({ has: page.getByRole('heading', { name: 'Shared with you' }) });
    await shared.getByText('synthetic shared failure', { exact: false }).waitFor();
    await shared.getByRole('button', { name: 'Retry' }).click();
    await shared.getByText('No plugins shared with you.').waitFor();
    await created.getByRole('button', { name: 'Load more' }).click();
    await created.getByRole('button', { name: /Second personal/ }).waitFor();
    await page.getByRole('searchbox', { name: 'Search plugins' }).fill('writer');
    await page.getByText('synthetic search failure', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('button', { name: 'Load more' }).click();
    await page.getByRole('button', { name: /Second result/ }).waitFor();
    const calls = await page.evaluate(() => window.pluginHarness.calls);
    assert.ok(calls.some(call => call.name === 'config/batchWrite' && call.params?.expectedVersion === 'v1'));
    assert.ok(calls.some(call => call.name === 'track' && call.params?.kind === 'install' && call.params?.hostId === 'local'));
    assert.ok(calls.some(call => call.name === 'track' && call.params?.kind === 'addMarketplace' && call.params?.refName === 'main'));
    assert.ok(calls.some(call => call.name === 'try'));
    assert.ok(calls.some(call => call.name === 'connect'));
    assert.ok(calls.some(call => call.name === 'personal' && call.params?.cursor === 'personal-next' && call.params?.accountKey === 'synthetic-account'));
    assert.ok(calls.some(call => call.name === 'plugin/search' && call.params?.scope === 'personal' && call.params?.cursor === 'search-next'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('searchbox', { name: 'Search plugins' }).fill('stale');
    await page.waitForFunction(() => window.pluginHarness.calls.some(call => call.name === 'plugin/search' && call.params?.searchTerm === 'stale'));
    await page.evaluate(() => window.pluginHarness.switchHost('unavailable'));
    await page.getByRole('button', { name: 'Personal' }).click();
    await page.getByText('Personal plugin directory is unavailable on this host.').waitFor();
    await page.evaluate(() => window.pluginHarness.resolveSearch());
    assert.equal(await page.getByText('Stale search').count(), 0);
    await page.getByText('Plugin changes are unavailable on this host.').waitFor();
    await page.evaluate(() => window.pluginHarness.switchHost('late'));
    await page.getByRole('button', { name: /Document writer/ }).click();
    await dialog.getByRole('button', { name: 'Install', exact: true }).click();
    await page.waitForFunction(() => window.pluginHarness.calls.some(call => call.name === 'plugin/install' && call.hostId === 'late'));
    await page.evaluate(() => window.pluginHarness.switchHost('local'));
    await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => window.pluginHarness.rejectLateInstall());
    await page.waitForFunction(() => window.pluginHarness.calls.some(call => call.name === 'track-failed' && call.hostId === 'late'));
    await page.evaluate(() => window.pluginHarness.switchHost('late'));
    await page.getByRole('button', { name: /Document writer/ }).click();
    await dialog.getByText('A plugin change needs verification.').waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Install', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Check changes' }).click();
    await dialog.getByRole('button', { name: 'Install', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].some(button => button.textContent === 'Install' && !button.disabled));
    await page.evaluate(() => window.pluginHarness.switchHost('defer'));
    await page.getByRole('button', { name: /Document writer/ }).click();
    await dialog.getByRole('button', { name: 'Install', exact: true }).click();
    await page.waitForFunction(() => window.pluginHarness.calls.some(call => call.name === 'track' && call.params?.hostId === 'defer'));
    const localLoads = (await page.evaluate(() => window.pluginHarness.calls)).filter(call => call.name === 'plugin/installed' && call.hostId === 'local').length;
    await page.evaluate(() => window.pluginHarness.switchHost('local'));
    await page.waitForFunction(count => window.pluginHarness.calls.filter(call => call.name === 'plugin/installed' && call.hostId === 'local').length > count, localLoads);
    await page.evaluate(() => window.pluginHarness.releaseDeferred());
    await page.waitForFunction(() => window.pluginHarness.calls.some(call => call.name === 'track-failed' && call.hostId === 'defer'));
    assert.equal((await page.evaluate(() => window.pluginHarness.calls)).some(call => call.name === 'plugin/install' && call.hostId === 'defer'), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
