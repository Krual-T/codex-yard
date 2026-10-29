import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    skillsHarness: {
      calls: { kind: string; name: string; params?: Record<string, unknown>; hostId?: string }[];
      switchHost(hostId: string): void;
      resolveOld(): void;
      emit(hostId: string): void;
    };
  }
}

const chrome = '/usr/bin/google-chrome';
test('skills UI handles host changes, reads, failures, mutations, and keyboard focus', {
  skip: !existsSync(chrome) && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SkillsPage } from './src/renderer/pages/skills/SkillsPage.tsx';
    const calls = [], listeners = new Set();
    const skill = {name:'plugin:sample',description:'Synthetic instructions',path:'/work/SKILL.md',scope:'user',enabled:true};
    let hostId = 'old', oldResolve, removed = false, failWrite = true, failRead = true, failCheck = true;
    const unresolved = new Set();
    const client = {
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async rpc(name, params, hostId) {
        calls.push({kind:'rpc',name,params,hostId});
        if (name === 'skills/list') {
          if (hostId === 'old') return await new Promise(resolve => { oldResolve = resolve; });
          return {data:[{cwd:'/work',skills:removed ? [] : [{...skill}],errors:[]}]};
        }
        if (name === 'skills/config/write') {
          if (failWrite) { failWrite = false; throw Error('synthetic timeout'); }
          skill.enabled = params.enabled; return {effectiveEnabled:skill.enabled};
        }
        throw Error('unexpected RPC '+name);
      },
      async host(name, params) {
        calls.push({kind:'host',name,params});
        if (name === 'read-file') {
          if (failRead) { failRead = false; throw Error('synthetic read failure'); }
          return {contents:'# Synthetic skill\\nUseful content'};
        }
        if (name === 'remove-skill') { removed = true; return {success:true}; }
        throw Error('unexpected endpoint '+name);
      }, reply() { throw Error('unused'); }
    };
    const root = createRoot(document.getElementById('root'));
    const onOpenFile = location => calls.push({kind:'open',name:'file',params:location});
    const onTrySkill = value => calls.push({kind:'try',name:'skill',params:value});
    function render() { root.render(<SkillsPage client={client} hostId={hostId} cwd="/work" hasUnresolvedChanges={unresolved.has(hostId)}
      onTrackSkillChange={async (change,operation) => { calls.push({kind:'track',name:change.kind,params:change}); unresolved.add(change.hostId); render();
        try { await operation(); unresolved.delete(change.hostId); } finally { render(); } }}
      onReconcileSkillChanges={async scope => { if(failCheck){failCheck=false;throw Error('synthetic check failure');} unresolved.delete(scope.hostId); render(); }}
      onOpenFile={onOpenFile} onTrySkill={onTrySkill} />); }
    window.skillsHarness = {calls, switchHost(value) { hostId=value; render(); },
      resolveOld() { oldResolve({data:[{cwd:'/old',skills:[{...skill,name:'stale'}],errors:[]}]}); },
      emit(hostId) { for (const fn of listeners) fn({type:'mcp-notification',hostId,method:'skills/changed'}); }};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root" style="--yard-bg:rgb(20, 30, 40);--yard-fg:rgb(240, 241, 242);--yard-ui-font:serif;--yard-font-size:17px"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/pages/skills/skills.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByText('Loading skills...').waitFor();
    await page.evaluate(() => window.skillsHarness.switchHost('local'));
    const row = page.getByRole('button', { name: /plugin:sample/ }); await row.waitFor();
    await page.evaluate(() => window.skillsHarness.resolveOld());
    assert.equal(await page.getByText('stale', { exact: true }).count(), 0);
    assert.equal(await page.locator('.yard-skills').evaluate(element => getComputedStyle(element).fontSize), '17px');
    assert.equal(await page.locator('.yard-skills').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(20, 30, 40)');
    await page.getByRole('searchbox', { name: 'Search skills' }).fill('missing');
    await page.getByText('No skills match your search.').waitFor();
    await page.getByRole('searchbox', { name: 'Search skills' }).fill('sample');
    await row.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog'); await dialog.getByText('Could not read skill:', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await dialog.getByText('Useful content', { exact: false }).waitFor();
    await dialog.getByRole('checkbox', { name: 'Enabled' }).click();
    await dialog.getByText('Could not confirm the change:', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('checkbox', { name: 'Enabled' }).isChecked(), true);
    assert.equal(await dialog.getByRole('checkbox', { name: 'Enabled' }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Refresh skills' }).click();
    await row.click();
    assert.equal(await dialog.getByRole('checkbox', { name: 'Enabled' }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Check changes' }).click();
    await dialog.getByText('synthetic check failure', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('checkbox', { name: 'Enabled' }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Check changes' }).click();
    await dialog.getByRole('checkbox', { name: 'Enabled' }).uncheck();
    await dialog.getByText('plugin:sample disabled.').waitFor();
    const writes = (await page.evaluate(() => window.skillsHarness.calls)).filter(call => call.name === 'skills/config/write');
    assert.deepEqual(writes.map(call => call.params), [{ name: 'plugin:sample', enabled: false }, { name: 'plugin:sample', enabled: false }]);
    await dialog.getByRole('checkbox', { name: 'Enabled' }).check();
    await dialog.getByText('plugin:sample enabled.').waitFor();
    await dialog.getByRole('button', { name: 'Open file' }).click();
    await dialog.getByRole('button', { name: 'Try now' }).click();
    assert.ok((await page.evaluate(() => window.skillsHarness.calls)).some(call => call.kind === 'try'));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await row.evaluate(element => element === document.activeElement), true);
    await page.setViewportSize({ width: 375, height: 800 });
    await row.click(); await dialog.getByRole('button', { name: 'Uninstall', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm uninstall' }).click();
    await page.getByText('No skills found for this workspace.').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
