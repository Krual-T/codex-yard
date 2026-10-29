import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    categoryHarness: {
      calls: { name: string; accountKey?: string; categorySlug?: string; searchTerm?: string; cursor?: string | null }[];
      switchAccount(value: string): void;
      resolveOldSections(): void;
      resolveOldCategory(): void;
    };
  }
}

const chrome = '/usr/bin/google-chrome';
test('public plugin categories paginate, retry, search, and isolate account changes', {
  skip: !existsSync(chrome) && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PluginsPage } from './src/renderer/pages/plugins/PluginsPage.tsx';
    const calls=[]; let accountKey='old', oldSections, oldCategory, failSections=true, failCategory=true;
    const plugin=name=>({id:name+'@sample',name,installed:false,enabled:false,installPolicy:'AVAILABLE',source:{type:'local'},interface:{displayName:name}});
    const entry=name=>({marketplaceName:'sample',marketplacePath:'/market',plugin:plugin(name)});
    const client={subscribe(){return ()=>{};},async rpc(name){
      if(name==='plugin/installed'||name==='plugin/list') return {marketplaces:[]};
      if(name==='plugin/read') return {plugin:{summary:plugin('result'),marketplaceName:'sample',apps:[],skills:[],mcpServers:[],hooks:[]}};
      throw Error('unexpected RPC '+name);
    },async host(){throw Error('unused');},reply(){throw Error('unused');}};
    const root=createRoot(document.getElementById('root'));
    function render(){root.render(<PluginsPage client={client} hostId="local" cwd="/work" accountKey={accountKey} hasUnresolvedChanges={false}
      onLoadPublicSections={async value=>{calls.push({name:'sections',accountKey:value.accountKey});
        if(value.accountKey==='old') return await new Promise(resolve=>oldSections=resolve);
        if(failSections){failSections=false;throw Error('synthetic categories failure');}
        return [{id:'featured',title:'Featured tools',categorySlug:'featured',entries:[entry('home-result')]}];}}
      onLoadPublicCategory={async value=>{calls.push({name:'category',...value});
        if(value.searchTerm==='stale') return await new Promise(resolve=>oldCategory=resolve);
        if(failCategory){failCategory=false;throw Error('synthetic category failure');}
        const name=value.searchTerm ? 'search-result' : value.cursor ? 'second-result' : 'first-result';
        return {entries:[entry(name)],nextCursor:value.cursor||value.searchTerm?null:'next'};}} />);}
    window.categoryHarness={calls,switchAccount(value){accountKey=value;render();},
      resolveOldSections(){oldSections([{id:'old',title:'Stale categories',categorySlug:'old',entries:[]}]);},
      resolveOldCategory(){oldCategory({entries:[entry('stale-result')],nextCursor:null});}};render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/pages/plugins/plugins.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => window.categoryHarness.calls.some(call => call.name === 'sections' && call.accountKey === 'old'));
    await page.evaluate(() => window.categoryHarness.switchAccount('new'));
    await page.getByText('synthetic categories failure', { exact: false }).waitFor();
    await page.evaluate(() => window.categoryHarness.resolveOldSections());
    assert.equal(await page.getByText('Stale categories').count(), 0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Featured tools' }).click();
    const back = page.getByRole('button', { name: 'Back to public plugins' });
    assert.equal(await back.evaluate(element => element === document.activeElement), true);
    await page.getByText('synthetic category failure', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: /first-result/ }).waitFor();
    await page.getByRole('button', { name: 'Load more' }).click();
    await page.getByRole('button', { name: /second-result/ }).waitFor();
    const search = page.getByRole('searchbox', { name: 'Search plugins' });
    await search.fill('needle');
    await page.getByRole('button', { name: /search-result/ }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'result' }).waitFor();
    await page.keyboard.press('Escape');
    await search.fill('stale');
    await page.waitForFunction(() => window.categoryHarness.calls.some(call => call.name === 'category' && call.searchTerm === 'stale'));
    await page.evaluate(() => window.categoryHarness.switchAccount('third'));
    await page.getByRole('button', { name: 'Featured tools' }).waitFor();
    await page.evaluate(() => window.categoryHarness.resolveOldCategory());
    assert.equal(await page.getByText('stale-result').count(), 0);
    await page.getByRole('button', { name: 'Featured tools' }).click();
    await page.getByRole('button', { name: 'Back to public plugins' }).click();
    assert.equal(await search.evaluate(element => element === document.activeElement), true);
    const calls = await page.evaluate(() => window.categoryHarness.calls);
    assert.ok(calls.some(call => call.name === 'category' && call.accountKey === 'new' && call.categorySlug === 'featured' && call.cursor === 'next'));
    assert.ok(calls.some(call => call.name === 'category' && call.searchTerm === 'needle'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
