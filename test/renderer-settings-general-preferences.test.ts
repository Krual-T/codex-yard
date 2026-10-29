import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    generalHarness: {
      failNextAtomWrite: () => void;
      failNextSettingWrite: () => void;
      holdNextAtomWrite: () => void;
      releaseAtomWrite: () => void;
      changeSetting: (key: string, value: unknown) => void;
      atom: (endpoint: string, params: Record<string, unknown>) => Promise<unknown>;
      writes: { endpoint: string; key: string; value: unknown; expected: unknown }[];
      settings: Record<string, unknown>;
      globals: Record<string, unknown>;
    };
  }
}

test('General controls use original atom storage, confirmation, and cross-page conflict recovery', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneSettings} from './src/renderer/settings/StandaloneSettings.tsx';
      import {I18nProvider} from './src/renderer/i18n/index.tsx';
      import {browserAtom} from './src/renderer/app/browser-atoms.ts';
      import {subscribeBrowserAtoms} from './src/renderer/storage/ui-atoms.ts';
      import {assertPreferenceExpectation} from './src/native/protocol.ts';
      const settings = {autoArchiveAfterDays:42}, globals = {}, listeners = new Set(), writes = [];
      let fail = false, failSetting = false, atomWait = null, releaseAtom = () => {};
      subscribeBrowserAtoms(keys => { for (const listener of listeners) listener({type:'persisted-atom-updated',keys}); });
      const client = {
        rpc: async () => { throw Error('Unexpected RPC'); }, reply: async () => { throw Error('Unexpected approval'); },
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        host: async (endpoint, params = {}) => {
          if (endpoint === 'get-persisted-atom' || endpoint === 'set-persisted-atom') {
            if (endpoint === 'set-persisted-atom') {
              if (fail) { fail = false; throw Error('Synthetic storage failure'); }
              writes.push({endpoint,key:params.key,value:params.value,expected:params.expected});
              if (atomWait) { const wait = atomWait; atomWait = null; await wait; }
            }
            return browserAtom(endpoint, params);
          }
          if (endpoint === 'refresh-remote-connections') return {remoteConnections:[]};
          if (endpoint === 'os-info') return {platform:'linux'};
          if (endpoint === 'get-settings') return {values:{...settings}};
          if (endpoint === 'get-setting' || endpoint === 'get-global-state') {
            const target = endpoint === 'get-setting' ? settings : globals;
            return {exists:Object.hasOwn(target,params.key),value:target[params.key]};
          }
          if (endpoint === 'set-setting' || endpoint === 'set-global-state') {
            const target = endpoint === 'set-setting' ? settings : globals;
            if (endpoint === 'set-setting' && failSetting) { failSetting = false; throw Error('Synthetic setting failure'); }
            assertPreferenceExpectation(target[params.key],Object.hasOwn(target,params.key),params.expected);
            writes.push({endpoint,key:params.key,value:params.value,expected:params.expected}); target[params.key] = params.value; return {success:true};
          }
          throw Error('Unexpected host operation: ' + endpoint);
        },
      };
      window.generalHarness = {failNextAtomWrite: () => {fail = true;}, failNextSettingWrite: () => {failSetting = true;},
        holdNextAtomWrite: () => {atomWait = new Promise(resolve => {releaseAtom = resolve;});}, releaseAtomWrite: () => releaseAtom(),
        changeSetting: (key, value) => {settings[key] = value; for (const listener of listeners) listener({type:'settings-changed',keys:[key]});},
        atom:browserAtom, writes, settings, globals};
      createRoot(document.getElementById('root')).render(<I18nProvider locale="en-US">
        <StandaloneSettings client={client} hostId="local" location={{pathname:'/settings/general',search:'',hash:'',state:null}}
          onNavigate={() => {}} onClose={() => {}} />
      </I18nProvider>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>' }));
    const first = await context.newPage(), second = await context.newPage();
    const errors: string[] = [];
    for (const page of [first, second]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://settings-fixture.invalid/');
      await page.addStyleTag({ content: await readFile('src/renderer/settings/standalone-settings.css', 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.waitForFunction(() => !(document.querySelector('[aria-label="Show Full access in the composer"]') as HTMLInputElement).disabled);
    }
    if (process.env.YARD_GENERAL_SCREENSHOT) await first.screenshot({ path: process.env.YARD_GENERAL_SCREENSHOT });
    assert.equal(await first.getByRole('switch', { name: 'Default permissions are always shown' }).isDisabled(), true);
    assert.equal(await first.getByRole('switch', { name: 'Default permissions are always shown' }).isChecked(), true);
    const sleep = first.getByRole('switch', { name: 'Prevent sleep while running' });
    const archive = first.getByRole('combobox', { name: 'Automatically archive inactive chats' });
    assert.equal(await sleep.isEnabled(), true);
    assert.equal(await archive.isEnabled(), true);
    assert.equal(await archive.inputValue(), '42');
    assert.deepEqual(await archive.locator('option').allTextContents(), ['42 days', 'Never', '1 day', '7 days', '14 days', '30 days', '90 days']);
    assert.equal(await first.evaluate(() => window.generalHarness.writes.some(write => write.key === 'autoArchiveAfterDays')), false);
    await sleep.check();
    await first.waitForFunction(() => window.generalHarness.settings.preventSleepWhileRunning === true);
    assert.deepEqual(await first.evaluate(() => window.generalHarness.writes.find(write => write.key === 'preventSleepWhileRunning')),
      {endpoint:'set-setting',key:'preventSleepWhileRunning',value:true,expected:{exists:false}});
    await first.evaluate(() => window.generalHarness.failNextSettingWrite());
    await archive.selectOption('7');
    await first.getByText(/Synthetic setting failure/).waitFor();
    assert.equal(await archive.inputValue(), '7');
    assert.equal(await first.evaluate(() => window.generalHarness.settings.autoArchiveAfterDays), 42);
    await first.evaluate(() => window.generalHarness.changeSetting('autoArchiveAfterDays', 14));
    const conflictPanel = first.getByRole('region', { name: 'Conflicting preferences' });
    await conflictPanel.getByText('Automatically archive inactive chats', { exact:true }).waitFor();
    assert.equal(await first.getByRole('button', { name:'Save', exact:true }).isDisabled(), true);
    await conflictPanel.getByRole('button', { name:'Review and reapply' }).click();
    await first.getByRole('button', { name:'Save', exact:true }).click();
    await first.waitForFunction(() => window.generalHarness.settings.autoArchiveAfterDays === 7);
    assert.deepEqual(await first.evaluate(() => window.generalHarness.writes.filter(write => write.key === 'autoArchiveAfterDays').at(-1)),
      {endpoint:'set-setting',key:'autoArchiveAfterDays',value:7,expected:{exists:true,value:14}});
    await archive.selectOption('90');
    await first.waitForFunction(() => window.generalHarness.settings.autoArchiveAfterDays === 90);
    await first.getByRole('switch', { name: 'Show Full access in the composer' }).uncheck();
    await second.waitForFunction(() => !(document.querySelector('[aria-label="Show Full access in the composer"]') as HTMLInputElement).checked);
    await first.evaluate(() => window.generalHarness.holdNextAtomWrite());
    await first.getByRole('switch', { name: 'Bottom panel' }).uncheck();
    await first.getByRole('status').filter({ hasText: 'Saving preferences' }).waitFor({ state:'attached' });
    assert.equal(await first.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await first.evaluate(() => window.generalHarness.releaseAtomWrite());
    await second.waitForFunction(() => !(document.querySelector('[aria-label="Bottom panel"]') as HTMLInputElement).checked);
    assert.equal(await first.getByRole('group', { name: 'Default terminal location' }).count(), 0);
    await first.getByRole('combobox', { name: 'Confirm before closing a window' }).selectOption('always');
    await second.waitForFunction(() => (document.querySelector('[aria-label="Confirm before closing a window"]') as HTMLSelectElement).value === 'always');
    await first.getByRole('combobox', { name: 'Turn completion notifications' }).selectOption('always');
    await first.getByRole('switch', { name: 'Enable permission notifications' }).uncheck();
    await first.waitForFunction(() => window.generalHarness.globals['notifications-turn-mode'] === 'always' &&
      window.generalHarness.globals['notifications-permissions-enabled'] === false);
    assert.equal(await first.getByText("Set when ChatGPT alerts you that it's finished").isVisible(), true);
    await first.getByRole('switch', { name: 'Show Full access in the composer' }).click();
    await first.getByRole('dialog', { name: 'Make Full Access available?' }).getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await first.getByRole('switch', { name: 'Show Full access in the composer' }).isChecked(), false);
    await first.getByRole('switch', { name: 'Show Full access in the composer' }).click();
    await first.getByRole('dialog', { name: 'Make Full Access available?' }).getByRole('button', { name: 'Confirm' }).click();
    await second.waitForFunction(() => (document.querySelector('[aria-label="Show Full access in the composer"]') as HTMLInputElement).checked);
    await second.evaluate(async () => {
      await window.generalHarness.atom('set-persisted-atom', {key:'composer-permission-mode-visibility',
        value:{'full-access':true, legacy:1},expected:{exists:true,value:true}});
    });
    await first.reload();
    await first.addStyleTag({ content: await readFile('src/renderer/settings/standalone-settings.css', 'utf8') });
    await first.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await first.waitForFunction(() => !(document.querySelector('[aria-label="Show Full access in the composer"]') as HTMLInputElement).disabled);
    await first.evaluate(() => window.generalHarness.failNextAtomWrite());
    await first.getByRole('switch', { name: 'Show Full access in the composer' }).uncheck();
    await first.getByText(/Synthetic storage failure/).waitFor();
    await second.evaluate(async () => {
      await window.generalHarness.atom('set-persisted-atom', {key:'composer-permission-mode-visibility',
        value:{'full-access':true,legacy:2,newer:'kept'}, expected:{exists:true,value:{'full-access':true,legacy:1}}});
    });
    await conflictPanel.getByText('Full access', { exact:true }).waitFor();
    assert.equal(await first.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    assert.equal(await first.getByRole('button', { name: 'Review and reapply' }).count(), 1);
    await conflictPanel.getByRole('button', { name: 'Review and reapply' }).click();
    await first.getByRole('button', { name: 'Save', exact: true }).click();
    await first.waitForFunction(async () => {
      const result = await window.generalHarness.atom('get-persisted-atom', {key:'composer-permission-mode-visibility'}) as {value: unknown};
      return JSON.stringify(result.value) === JSON.stringify({'full-access':false,legacy:2,newer:'kept'});
    });
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
