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
      atom: (endpoint: string, params: Record<string, unknown>) => Promise<unknown>;
      writes: { key: string; value: unknown }[];
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
      const settings = {}, globals = {}, listeners = new Set(), writes = [];
      let fail = false;
      subscribeBrowserAtoms(keys => { for (const listener of listeners) listener({type:'persisted-atom-updated',keys}); });
      const client = {
        rpc: async () => { throw Error('Unexpected RPC'); }, reply: async () => { throw Error('Unexpected approval'); },
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        host: async (endpoint, params = {}) => {
          if (endpoint === 'get-persisted-atom' || endpoint === 'set-persisted-atom') {
            if (endpoint === 'set-persisted-atom') {
              if (fail) { fail = false; throw Error('Synthetic storage failure'); }
              writes.push({key:params.key,value:params.value});
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
            assertPreferenceExpectation(target[params.key],Object.hasOwn(target,params.key),params.expected);
            writes.push({key:params.key,value:params.value}); target[params.key] = params.value; return {success:true};
          }
          throw Error('Unexpected host operation: ' + endpoint);
        },
      };
      window.generalHarness = {failNextAtomWrite: () => {fail = true;}, atom:browserAtom, writes, globals};
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
    await first.getByRole('switch', { name: 'Show Full access in the composer' }).uncheck();
    await second.waitForFunction(() => !(document.querySelector('[aria-label="Show Full access in the composer"]') as HTMLInputElement).checked);
    await first.getByRole('switch', { name: 'Bottom panel' }).uncheck();
    await second.waitForFunction(() => !(document.querySelector('[aria-label="Bottom panel"]') as HTMLInputElement).checked);
    assert.equal(await first.getByRole('group', { name: 'Default terminal location' }).count(), 0);
    await first.getByRole('combobox', { name: 'Confirm before closing a window' }).selectOption('always');
    await second.waitForFunction(() => (document.querySelector('[aria-label="Confirm before closing a window"]') as HTMLSelectElement).value === 'always');
    await first.getByRole('combobox', { name: 'Turn completion notifications' }).selectOption('always');
    await first.getByRole('switch', { name: 'Enable permission notifications' }).uncheck();
    await first.waitForFunction(() => window.generalHarness.globals['notifications-turn-mode'] === 'always' &&
      window.generalHarness.globals['notifications-permissions-enabled'] === false);
    assert.equal(await first.getByText(/Notification delivery is not available/).isVisible(), true);
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
    await first.getByText('The saved preference changed elsewhere. Review the current value before saving.').waitFor();
    await first.getByRole('button', { name: 'Review and reapply' }).click();
    await first.getByRole('button', { name: 'Save', exact: true }).click();
    await first.waitForFunction(async () => {
      const result = await window.generalHarness.atom('get-persisted-atom', {key:'composer-permission-mode-visibility'}) as {value: unknown};
      return JSON.stringify(result.value) === JSON.stringify({'full-access':false,legacy:2,newer:'kept'});
    });
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
