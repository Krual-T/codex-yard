import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import type { SettingsDraftRecord } from '../src/renderer/settings/config-operations.ts';

declare global {
  interface Window { pluginRecoveryFixture: any; pluginRecoveryOptions: any }
}

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';
const original: SettingsDraftRecord & { extra: unknown } = {
  hostId: 'local', section: 'plugins-settings', scope: ['/project/alpha', '/shared workspace'],
  editorId: 'recovered:original', revision: 4,
  draft: { pluginId: 'sample-plugin', enabled: true,
    originalSource: { hostId: 'local', generation: 'generation-1', homeDirectory: '/fixture/home', codexHome: '/fixture/codex', extraSource: 'preserve' },
    extraDraft: { key: 'value' } },
  extra: { outer: ['preserve', 2] },
};

test('recovered plugin edits use the real controlled React leaf', {
  skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {PluginEditRecovery} from './src/renderer/settings/PluginEditRecovery.tsx';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    const options=window.pluginRecoveryOptions||{};
    const state={drafts:options.drafts||[], activeHostId:'local', disabled:false, saves:[], edits:[], discards:[], copied:[], saveCompleted:[], editCompleted:[], discardCompleted:[], pending:false, pendingEvents:[], editPendingAtCall:[],
      saveMode:'resolve', editMode:'resolve', discardMode:'resolve', guardMode:'resolve', clipboardFail:false, waiters:[], removeOnDiscard:false};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{
      if(state.clipboardFail)throw Error('clipboard denied'); state.copied.push(text);
    }}});
    const wait=()=>new Promise((resolve,reject)=>state.waiters.push({resolve,reject}));
    const key=item=>JSON.stringify([item.hostId,item.section,item.scope??null,item.editorId,item.revision]);
    const onSave=async item=>{state.saves.push(item);if(state.saveMode==='hold')await wait();
      if(state.saveMode==='reject')throw Error('fixture save rejected');state.saveCompleted.push(item);};
    const onEdit=async (item,enabled)=>{state.edits.push({draft:item,enabled});state.editPendingAtCall.push(state.pending);if(state.editMode==='hold')await wait();
      if(state.editMode==='reject')throw Error('fixture edit rejected');state.editCompleted.push({draft:item,enabled});};
    const onDiscard=async item=>{state.discards.push(item);if(state.discardMode==='hold')await wait();
      if(state.discardMode==='reject')throw Error('fixture discard rejected');
      if(state.removeOnDiscard){state.drafts=state.drafts.filter(current=>key(current)!==key(item));render();}state.discardCompleted.push(item);};
    const root=createRoot(document.getElementById('root'));
    const onPendingChange=pending=>{state.pendingEvents.push(pending);if(pending&&state.guardMode==='throw')throw Error('guard rejected');
      if((pending&&state.guardMode==='async')||(!pending&&state.guardMode==='async-release'))return Promise.resolve();
      state.pending=pending;if(options.autoHide)render();};
    const render=()=>root.render(<I18nProvider locale={options.locale||'en-US'}><div className="yard-settings"><main className="yard-settings-content">
      {(!options.autoHide||state.drafts.length||state.pending)&&<PluginEditRecovery drafts={state.drafts} activeHostId={state.activeHostId} disabled={state.disabled}
        onEdit={options.editable?onEdit:undefined} onPendingChange={options.editable&&options.pendingBridge?onPendingChange:undefined} onSave={onSave} onDiscard={onDiscard}/>}
    </main></div></I18nProvider>);
    window.pluginRecoveryFixture={state,render, resolve(){state.waiters.shift()?.resolve();},
      reject(message){state.waiters.shift()?.reject(Error(message));}};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-sync', '--disable-component-update'] });
  const open = async (drafts: unknown[], width = 960, editable = false, autoHide = false, pendingBridge = true): Promise<{ context: BrowserContext; page: Page; errors: string[]; blocked: string[] }> => {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const blocked: string[] = [];
    await context.route('**/*', route => {
      if (route.request().url() === 'http://127.0.0.1/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      blocked.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(value => { window.pluginRecoveryOptions = value; }, { drafts, editable, autoHide, pendingBridge });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8_000);
    await page.goto('http://127.0.0.1/');
    await page.addStyleTag({ content: readFileSync('src/renderer/settings/standalone-settings.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('region', { name: 'Saved plugin edits' }).waitFor();
    return { context, page, errors, blocked };
  };
  const article = (page: Page, editor: string) => page.getByRole('article').filter({ hasText: editor });
  try {
    await t.test('shows exact identity and original data, copying valid and damaged records without writes', async () => {
      const remote = { ...original, hostId: 'remote', scope: ['/remote/work'], editorId: 'recovered:remote', revision: 5,
        draft: { pluginId: 'remote-plugin', enabled: false } };
      const damaged = { ...original, editorId: 'recovered:damaged', revision: 6, draft: { pluginId: 'broken', enabled: 'yes', future: [1, 2] } };
      const wrongSource = { ...original, editorId: 'recovered:source', revision: 7,
        draft: { pluginId: 'wrong-source', enabled: true, originalSource: { hostId: 'remote', generation: 'g', homeDirectory: '/x', codexHome: '/x' } } };
      const missingScope = { ...original, scope: undefined, editorId: 'recovered:missing-scope', revision: 8 };
      const { context, page, errors, blocked } = await open([original, remote, damaged, wrongSource, missingScope]);
      try {
        const local = article(page, 'recovered:original');
        assert.match(await local.innerText(), /local/); assert.match(await local.innerText(), /\/project\/alpha/);
        assert.match(await local.innerText(), /\/shared workspace/); assert.match(await local.innerText(), /sample-plugin/);
        assert.match(await local.innerText(), /Enabled/); assert.match(await local.innerText(), /Revision: 4/);
        assert.match(await local.innerText(), /generation-1/); assert.match(await local.innerText(), /\/fixture\/codex/);
        assert.equal(await local.getByRole('button', { name: 'Save this plugin edit' }).isEnabled(), true);
        assert.equal(await local.getByRole('switch', { name: 'Plugin enabled' }).isDisabled(), true);
        const other = article(page, 'recovered:remote');
        assert.match(await other.innerText(), /Disabled/); assert.match(await other.innerText(), /\(not recorded\)/);
        assert.equal(await other.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        for (const editor of ['recovered:damaged', 'recovered:source', 'recovered:missing-scope']) {
          assert.equal(await article(page, editor).getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        }
        await local.getByRole('button', { name: 'Copy saved edit' }).click();
        await article(page, 'recovered:damaged').getByRole('button', { name: 'Copy saved edit' }).click();
        const captured = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(JSON.parse(captured.copied[0]), original);
        assert.deepEqual(JSON.parse(captured.copied[1]), damaged);
        assert.deepEqual(captured.saves, []); assert.deepEqual(captured.discards, []);
        await page.evaluate(() => { window.pluginRecoveryFixture.state.activeHostId = 'remote'; window.pluginRecoveryFixture.render(); });
        await page.waitForFunction(() => [...document.querySelectorAll('article')].find(e => e.textContent?.includes('recovered:remote'))
          ?.querySelector<HTMLButtonElement>('button')?.disabled === false);
        assert.equal(await local.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      } finally { await context.close(); }
    });

    await t.test('save captures the original revision, blocks duplicate actions, and exposes rejection', async () => {
      const { context, page, errors } = await open([original]);
      try {
        await page.evaluate(() => { window.pluginRecoveryFixture.state.saveMode = 'hold';
          const button = [...document.querySelectorAll('button')].find(element => element.textContent === 'Save this plugin edit')!;
          button.click(); button.click(); });
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        assert.equal(await page.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        assert.equal(await page.getByRole('button', { name: 'Discard this copy' }).isDisabled(), true);
        await page.getByRole('button', { name: 'Copy saved edit' }).click();
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.drafts[0].revision = 5; fixture.state.drafts[0].draft.enabled = false; fixture.render(); });
        await page.waitForFunction(() => document.body.textContent?.includes('Revision: 5'));
        await page.evaluate(() => window.pluginRecoveryFixture.reject('fixture save denied'));
        await page.getByRole('alert').filter({ hasText: 'revision 4' }).waitFor();
        const snapshot = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(snapshot.saves.length, 1); assert.deepEqual(snapshot.saves[0], original);
        assert.equal(snapshot.drafts[0].revision, 5); assert.equal(snapshot.drafts[0].draft.enabled, false);
        assert.deepEqual(JSON.parse(snapshot.copied[0]), original);
        assert.equal(await page.getByRole('button', { name: 'Save this plugin edit' }).isEnabled(), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a successful parent save is awaited and only the parent can remove the copy', async () => {
      const { context, page, errors } = await open([original]);
      try {
        await page.evaluate(() => { window.pluginRecoveryFixture.state.saveMode = 'hold'; });
        await page.getByRole('button', { name: 'Save this plugin edit' }).click();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        let state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(state.saves.length, 1); assert.deepEqual(state.saveCompleted, []); assert.equal(state.drafts.length, 1);
        assert.equal(await page.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await page.evaluate(() => window.pluginRecoveryFixture.resolve());
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.saveCompleted.length === 1);
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(e => e.textContent === 'Save this plugin edit')?.disabled);
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.saveCompleted[0], original); assert.equal(state.drafts.length, 1);
        assert.equal(await page.getByRole('article').count(), 1); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('discard confirmation follows identity across reorder and only sends the captured revision', async () => {
      const other = { ...original, scope: ['/project/other'], revision: 11, draft: { pluginId: 'other-plugin', enabled: false } };
      const { context, page, errors } = await open([original, other]);
      try {
        const alpha = page.getByRole('article').filter({ hasText: 'sample-plugin' });
        const beta = page.getByRole('article').filter({ hasText: 'other-plugin' });
        await alpha.getByRole('button', { name: 'Discard this copy' }).click();
        assert.equal(await page.getByRole('group', { name: 'Confirm discard of saved plugin edit' }).count(), 1);
        assert.match(await alpha.innerText(), /only this saved copy/);
        assert.deepEqual(await page.evaluate(() => window.pluginRecoveryFixture.state.discards), []);
        await alpha.getByRole('button', { name: 'Cancel' }).click();
        assert.equal(await page.getByRole('group', { name: 'Confirm discard of saved plugin edit' }).count(), 0);
        assert.deepEqual(await page.evaluate(() => window.pluginRecoveryFixture.state.discards), []);
        await alpha.getByRole('button', { name: 'Discard this copy' }).click();
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.drafts.reverse(); fixture.state.discardMode = 'hold'; fixture.state.removeOnDiscard = true; fixture.render(); });
        await page.waitForFunction(() => document.querySelector('article')?.textContent?.includes('other-plugin'));
        assert.equal(await beta.getByRole('group', { name: 'Confirm discard of saved plugin edit' }).count(), 0);
        assert.equal(await alpha.getByRole('group', { name: 'Confirm discard of saved plugin edit' }).count(), 1);
        await page.evaluate(() => { const button = [...document.querySelectorAll('button')]
          .find(element => element.textContent === 'Confirm discard of this copy')!; button.click(); button.click(); });
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        assert.equal(await page.getByRole('button', { name: 'Confirm discard of this copy' }).isDisabled(), true);
        assert.equal(await page.getByRole('article').count(), 2);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.drafts.find((item: any) => item.draft.pluginId === 'sample-plugin').revision = 12; fixture.render(); });
        await page.waitForFunction(() => document.body.textContent?.includes('Revision: 12'));
        await page.evaluate(() => window.pluginRecoveryFixture.resolve());
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.discardCompleted.length === 1);
        const state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(state.discards.length, 1); assert.deepEqual(state.discards[0], original);
        assert.equal(state.drafts.length, 2); assert.deepEqual(state.drafts.map((item: any) => item.revision).sort((a: number, b: number) => a - b), [11, 12]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('discard rejection and unavailable clipboard leave the original visible and selectable', async () => {
      const { context, page, errors } = await open([original], 360);
      try {
        await page.evaluate(() => { window.pluginRecoveryFixture.state.discardMode = 'reject'; window.pluginRecoveryFixture.state.clipboardFail = true; });
        await page.getByRole('button', { name: 'Discard this copy' }).click();
        await page.getByRole('button', { name: 'Confirm discard of this copy' }).click();
        await page.getByRole('alert').filter({ hasText: 'fixture discard rejected' }).waitFor();
        await page.getByRole('button', { name: 'Copy saved edit' }).click();
        await page.getByRole('status').filter({ hasText: 'Clipboard unavailable' }).waitFor();
        assert.equal(await page.locator('details').evaluate(element => (element as HTMLDetailsElement).open), true);
        assert.deepEqual(JSON.parse(await page.locator('pre').innerText()), original);
        const state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(state.discards.length, 1); assert.equal(state.drafts.length, 1); assert.deepEqual(state.saves, []);
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
        assert.equal(fits, true); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('parent disabled state blocks changes but retains copy and does not trigger an action on re-enable', async () => {
      const { context, page, errors } = await open([original]);
      try {
        await page.evaluate(() => { window.pluginRecoveryFixture.state.disabled = true; window.pluginRecoveryFixture.render(); });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].find(e => e.textContent === 'Save this plugin edit')?.disabled);
        assert.equal(await page.getByRole('button', { name: 'Discard this copy' }).isDisabled(), true);
        await page.getByRole('button', { name: 'Copy saved edit' }).click();
        await page.evaluate(() => { window.pluginRecoveryFixture.state.disabled = false; window.pluginRecoveryFixture.render(); });
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(e => e.textContent === 'Save this plugin edit')?.disabled);
        const state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.saves, []); assert.deepEqual(state.discards, []); assert.deepEqual(JSON.parse(state.copied[0]), original);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('editing waits for the matching newer snapshot before an explicit save', async () => {
      const { context, page, errors, blocked } = await open([original], 960, true);
      try {
        const row = article(page, 'recovered:original'), control = row.getByRole('switch', { name: 'Plugin enabled' });
        assert.equal(await control.isChecked(), true); assert.equal(await control.isEnabled(), true);
        await page.evaluate(() => { window.pluginRecoveryFixture.state.editMode = 'hold'; });
        await control.uncheck();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        assert.equal(await control.isChecked(), false); assert.equal(await control.isDisabled(), true);
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await page.evaluate(() => { const button = [...document.querySelectorAll('button')]
          .find(element => element.textContent === 'Save this plugin edit')!; button.click(); button.click(); });
        let state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits, [{ draft: original, enabled: false }]); assert.deepEqual(state.saves, []);
        assert.deepEqual(state.pendingEvents, [true]); assert.deepEqual(state.editPendingAtCall, [true]);
        await page.evaluate(() => window.pluginRecoveryFixture.resolve());
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.editCompleted.length === 1);
        await row.getByRole('status').filter({ hasText: 'Waiting for the updated saved edit' }).waitFor();
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.previous = structuredClone(fixture.state.drafts[0]);
          const next = structuredClone(fixture.state.drafts[0]); next.revision = 5; next.draft.enabled = false;
          fixture.state.drafts = [next]; fixture.render(); });
        await page.waitForFunction(() => document.body.textContent?.includes('Revision: 5'));
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(e => e.textContent === 'Save this plugin edit')?.disabled);
        assert.equal(await control.isChecked(), false);
        await row.getByRole('button', { name: 'Save this plugin edit' }).click();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.saves.length === 1);
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.saves[0], { ...original, revision: 5, draft: { ...(original.draft as object), enabled: false } });
        assert.equal(state.edits.length, 1); assert.deepEqual(state.discards, []); assert.deepEqual(state.pendingEvents, [true, false]);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.drafts = [fixture.state.previous]; fixture.render(); });
        await row.getByRole('status').filter({ hasText: 'older than a version already seen' }).waitFor();
        assert.equal(await control.isDisabled(), true);
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      } finally { await context.close(); }
    });

    await t.test('a failed selection survives reorder, host change and removal of its saved snapshot', async () => {
      const other = { ...original, scope: ['/project/other'], editorId: 'recovered:other', revision: 11,
        draft: { pluginId: 'other-plugin', enabled: false } };
      const { context, page, errors } = await open([original, other], 960, true);
      try {
        const alpha = article(page, 'recovered:original'), beta = article(page, 'recovered:other');
        await page.evaluate(() => { window.pluginRecoveryFixture.state.editMode = 'hold'; });
        await alpha.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.drafts.reverse(); const current = fixture.state.drafts.find((d: any) => d.editorId === 'recovered:original');
          current.revision = 5; current.draft.enabled = false; fixture.state.activeHostId = 'remote'; fixture.render(); });
        await page.waitForFunction(() => document.querySelector('article')?.textContent?.includes('recovered:other'));
        await page.evaluate(() => window.pluginRecoveryFixture.reject('fixture revision conflict'));
        await alpha.getByRole('alert').filter({ hasText: 'fixture revision conflict' }).waitFor();
        assert.equal(await alpha.getByRole('switch', { name: 'Plugin enabled' }).isChecked(), false);
        assert.equal(await alpha.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        assert.equal(await alpha.getByRole('button', { name: 'Retry saving edit' }).isDisabled(), true);
        assert.equal(await beta.getByText('Unconfirmed choice:', { exact: false }).count(), 0);
        await alpha.getByRole('button', { name: 'Copy unsaved choice' }).click();
        let state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(JSON.parse(state.copied[0]), { original, selectedEnabled: false });
        assert.deepEqual(state.edits, [{ draft: original, enabled: false }]);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.activeHostId = 'local'; fixture.state.editMode = 'resolve'; fixture.render(); });
        await beta.getByRole('switch', { name: 'Plugin enabled' }).check();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.editCompleted.length === 1);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          const next = structuredClone(fixture.state.drafts.find((item: any) => item.editorId === 'recovered:other'));
          next.revision = 12; next.draft.enabled = true;
          fixture.state.drafts = fixture.state.drafts.map((item: any) => item.editorId === 'recovered:other' ? next : item); fixture.render(); });
        await page.waitForFunction(() => [...document.querySelectorAll('article')].find(e => e.textContent?.includes('recovered:other'))
          ?.querySelector<HTMLButtonElement>('button')?.disabled === false);
        assert.equal(await alpha.getByRole('switch', { name: 'Plugin enabled' }).isChecked(), false);
        assert.equal(await alpha.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits[1], { draft: other, enabled: true }); assert.deepEqual(state.saves, []);
        assert.deepEqual(state.pendingEvents, [true]);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.activeHostId = 'remote'; fixture.state.drafts = fixture.state.drafts.filter((item: any) => item.editorId !== 'recovered:original'); fixture.render(); });
        await alpha.getByRole('status').filter({ hasText: 'no longer in the current saved edits' }).waitFor();
        assert.equal(await alpha.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await alpha.getByRole('button', { name: 'Copy saved edit' }).click();
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(JSON.parse(state.copied[1]), original);
        await alpha.getByRole('button', { name: 'Discard unsaved choice' }).click();
        assert.equal(await alpha.count(), 0); assert.equal(await beta.count(), 1);
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(state.edits.length, 2); assert.deepEqual(state.saves, []); assert.deepEqual(state.discards, []);
        assert.deepEqual(state.pendingEvents, [true, false]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a rejected edit can be explicitly retried only against the exact original revision', async () => {
      const { context, page, errors } = await open([original], 960, true);
      try {
        const row = article(page, 'recovered:original');
        await page.evaluate(() => { window.pluginRecoveryFixture.state.editMode = 'reject'; });
        await row.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await row.getByRole('alert').filter({ hasText: 'fixture edit rejected' }).waitFor();
        assert.equal(await row.getByRole('button', { name: 'Retry saving edit' }).isEnabled(), true);
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await page.evaluate(() => { window.pluginRecoveryFixture.state.editMode = 'hold';
          const button = [...document.querySelectorAll('button')].find(element => element.textContent === 'Retry saving edit')!;
          button.click(); button.click(); });
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        let state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits, [{ draft: original, enabled: false }, { draft: original, enabled: false }]);
        assert.deepEqual(state.saves, []);
        await page.evaluate(() => window.pluginRecoveryFixture.resolve());
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.editCompleted.length === 1);
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          const next = structuredClone(fixture.state.drafts[0]); next.revision = 6; next.draft.enabled = false;
          fixture.state.drafts = [next]; fixture.render(); });
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(e => e.textContent === 'Save this plugin edit')?.disabled);
        await row.getByRole('button', { name: 'Save this plugin edit' }).click();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.saves.length === 1);
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(state.saves[0].revision, 6); assert.equal(state.saves[0].draft.enabled, false);
        assert.equal(state.edits.length, 2); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a newer but different snapshot cannot silently accept the choice', async () => {
      const { context, page, errors } = await open([original], 960, true);
      try {
        const row = article(page, 'recovered:original');
        await page.evaluate(() => { window.pluginRecoveryFixture.state.editMode = 'hold'; });
        await row.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          fixture.state.previous = structuredClone(fixture.state.drafts[0]);
          const next = structuredClone(fixture.state.drafts[0]); next.revision = 6; next.draft.enabled = false;
          next.draft.extraDraft.key = 'different'; fixture.state.drafts = [next]; fixture.render(); });
        await page.waitForFunction(() => document.body.textContent?.includes('Revision: 6'));
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          const next = structuredClone(fixture.state.previous); next.revision = 5; next.draft.enabled = false;
          fixture.state.drafts = [next]; fixture.render(); });
        await row.getByRole('status').filter({ hasText: 'older than a version already seen' }).waitFor();
        await page.evaluate(() => window.pluginRecoveryFixture.resolve());
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.editCompleted.length === 1);
        assert.equal(await row.getByText('Unconfirmed choice:', { exact: false }).count(), 1);
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          const next = structuredClone(fixture.state.previous); next.revision = 7; next.draft.enabled = false;
          next.draft.extraDraft.key = 'different'; fixture.state.drafts = [next]; fixture.render(); });
        await row.getByRole('status').filter({ hasText: 'The saved edit changed' }).waitFor();
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isDisabled(), true);
        assert.equal(await row.getByRole('button', { name: 'Discard unsaved choice' }).isEnabled(), true);
        await row.getByRole('button', { name: 'Copy unsaved choice' }).click();
        const before = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(JSON.parse(before.copied[0]), { original, selectedEnabled: false }); assert.deepEqual(before.saves, []);
        await row.getByRole('button', { name: 'Discard unsaved choice' }).click();
        assert.equal(await row.getByRole('button', { name: 'Save this plugin edit' }).isEnabled(), true);
        await row.getByRole('button', { name: 'Save this plugin edit' }).click();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.saves.length === 1);
        const state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(state.saves[0].revision, 7); assert.equal(state.saves[0].draft.extraDraft.key, 'different');
        assert.equal(state.edits.length, 1); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('the parent keeps an unresolved choice mounted and receives the synchronous guard before edit', async () => {
      const { context, page, errors } = await open([original], 960, true, true);
      try {
        const row = article(page, 'recovered:original');
        await page.evaluate(() => { window.pluginRecoveryFixture.state.editMode = 'hold'; });
        await row.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.waiters.length === 1);
        let state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.pendingEvents, [true]); assert.deepEqual(state.editPendingAtCall, [true]);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture; fixture.state.drafts = []; fixture.render(); });
        await row.getByRole('status').filter({ hasText: 'no longer in the current saved edits' }).waitFor();
        await page.evaluate(() => window.pluginRecoveryFixture.reject('original removed'));
        await row.getByRole('alert').filter({ hasText: 'original removed' }).waitFor();
        await row.getByRole('button', { name: 'Copy unsaved choice' }).click();
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(JSON.parse(state.copied[0]), { original, selectedEnabled: false });
        assert.equal(state.pending, true); assert.deepEqual(state.saves, []);
        await row.getByRole('button', { name: 'Discard unsaved choice' }).click();
        await page.getByRole('region', { name: 'Saved plugin edits' }).waitFor({ state: 'detached' });
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.pendingEvents, [true, false]); assert.deepEqual(state.discards, []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a parent with no pending lifecycle guard cannot enable the edit control', async () => {
      const { context, page, errors } = await open([original], 960, true, false, false);
      try {
        assert.equal(await page.getByRole('switch', { name: 'Plugin enabled' }).isDisabled(), true);
        const state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits, []); assert.deepEqual(state.pendingEvents, []); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a missing scope cannot share an editor identity with an empty scope', async () => {
      const empty = { ...original, scope: [], revision: 8 };
      const missing = { ...original, scope: undefined, revision: 8 };
      const { context, page, errors } = await open([missing, empty], 960, true);
      try {
        const incomplete = page.getByRole('article').filter({ hasText: '(not recorded)' });
        const complete = page.getByRole('article').filter({ hasText: 'Scope: []' });
        assert.equal(await incomplete.getByRole('switch', { name: 'Plugin enabled' }).isDisabled(), true);
        await complete.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.editCompleted.length === 1);
        assert.equal(await incomplete.getByText('Unconfirmed choice:', { exact: false }).count(), 0);
        await page.evaluate(() => { const fixture = window.pluginRecoveryFixture;
          const next = structuredClone(fixture.state.drafts[1]); next.revision = 9; next.draft.enabled = false;
          fixture.state.drafts = [next, fixture.state.drafts[0]]; fixture.render(); });
        await page.waitForFunction(() => ![...document.querySelectorAll('article')].find(e => e.textContent?.includes('Scope: []'))
          ?.querySelector<HTMLButtonElement>('button')?.disabled);
        await complete.getByRole('button', { name: 'Save this plugin edit' }).click();
        const state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits, [{ draft: empty, enabled: false }]);
        assert.equal(state.saves[0].revision, 9); assert.deepEqual(state.saves[0].scope, []);
        assert.equal(state.pending, false); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a failed or asynchronous pending guard never dispatches the edit and retry reacquires it', async () => {
      const { context, page, errors } = await open([original], 960, true);
      try {
        const row = article(page, 'recovered:original');
        await page.evaluate(() => { window.pluginRecoveryFixture.state.guardMode = 'throw'; });
        await row.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await row.getByRole('alert').filter({ hasText: 'guard rejected' }).waitFor();
        let state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits, []); assert.equal(await row.getByRole('switch', { name: 'Plugin enabled' }).isChecked(), false);
        await page.evaluate(() => { window.pluginRecoveryFixture.state.guardMode = 'async'; });
        await row.getByRole('button', { name: 'Retry saving edit' }).click();
        await row.getByRole('alert').filter({ hasText: 'guard must be synchronous' }).waitFor();
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits, []); assert.deepEqual(state.saves, []);
        await page.evaluate(() => { window.pluginRecoveryFixture.state.guardMode = 'resolve'; });
        await row.getByRole('button', { name: 'Retry saving edit' }).click();
        await page.waitForFunction(() => window.pluginRecoveryFixture.state.editCompleted.length === 1);
        state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.deepEqual(state.edits, [{ draft: original, enabled: false }]); assert.deepEqual(state.editPendingAtCall, [true]);
        assert.deepEqual(state.pendingEvents, [true, true, true]); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('an asynchronous guard release cannot overlap a new edit', async () => {
      const { context, page, errors } = await open([original], 960, true);
      try {
        const row = article(page, 'recovered:original');
        await page.evaluate(() => { const state = window.pluginRecoveryFixture.state;
          state.editMode = 'reject'; state.guardMode = 'async-release'; });
        await row.getByRole('switch', { name: 'Plugin enabled' }).uncheck();
        await row.getByRole('alert').filter({ hasText: 'fixture edit rejected' }).waitFor();
        await row.getByRole('button', { name: 'Discard unsaved choice' }).click();
        await page.getByRole('alert').filter({ hasText: 'guard must be synchronous' }).waitFor();
        assert.equal(await row.getByRole('switch', { name: 'Plugin enabled' }).isDisabled(), true);
        const state = await page.evaluate(() => window.pluginRecoveryFixture.state);
        assert.equal(state.edits.length, 1); assert.deepEqual(state.pendingEvents, [true, false]);
        assert.deepEqual(state.saves, []); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
