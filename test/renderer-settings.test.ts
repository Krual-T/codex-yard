import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    settingsHarness: {
      calls: { navigation: { path: string; options: unknown }[]; writes: { endpoint: string; key: string; value: unknown }[]; closed: number };
      settings: Record<string, unknown>;
      globals: Record<string, unknown>;
      lightTheme: string;
      requestLeave: () => Promise<boolean>;
      updateSetting: (key: string, value: unknown) => void;
    };
  }
}

test('standalone settings guard navigation, locate controls and save appearance through the host', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneSettings} from './src/renderer/settings/StandaloneSettings.tsx';
      import {defaultThemes, exportTheme} from './src/renderer/settings/preferences.ts';
      import {I18nProvider, resolveLocale} from './src/renderer/i18n/index.tsx';
      import {assertPreferenceExpectation} from './src/native/protocol.ts';
      const calls = {navigation: [], writes: [], closed: 0};
      const settings = {appearanceTheme:'system', codeFontSize:12, localeOverride:null};
      const globals = {'reduced-motion-preference':'system'};
      const atoms = {};
      const listeners = new Set();
      let location = {pathname:'/settings/general',search:'?tab=fixture',hash:'',state:{source:'fixture'}};
      let guard;
      const client = {
        rpc: async () => { throw Error('Unexpected RPC'); },
        reply: async () => { throw Error('Unexpected approval'); },
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        host: async (endpoint, params = {}) => {
          if (endpoint === 'refresh-remote-connections') return {remoteConnections:[{hostId:'ssh-fixture',displayName:'Fixture SSH'}]};
          if (endpoint === 'os-info') return {platform:'linux',isSystemBackdropSupported:false};
          if (endpoint === 'get-settings') return {values:{...settings}};
          const target = endpoint.endsWith('setting') ? settings : endpoint.endsWith('global-state') ? globals : atoms;
          if (endpoint.startsWith('get-')) return {value:target[params.key],exists:Object.hasOwn(target,params.key)};
          if (endpoint.startsWith('set-')) {
            assertPreferenceExpectation(target[params.key],Object.hasOwn(target,params.key),params.expected);
            calls.writes.push({endpoint,key:params.key,value:params.value});
            if (params.value === undefined) delete target[params.key]; else target[params.key] = params.value;
            if (endpoint === 'set-setting' && params.key === 'localeOverride') render();
            return {success:true};
          }
          throw Error('Unexpected host operation: ' + endpoint);
        },
      };
      const root = createRoot(document.getElementById('root'));
      const navigate = (path, options) => {
        calls.navigation.push({path,options});
        const next = new URL(path, 'http://settings-fixture.invalid');
        location = {pathname:next.pathname,search:next.search,hash:next.hash,state:options?.state};
        render();
      };
      const registerNavigationGuard = value => { guard = value; };
      const render = () => root.render(<I18nProvider locale={resolveLocale(settings.localeOverride, ['en-US'])}>
        <StandaloneSettings client={client} hostId="local" location={location}
          onNavigate={navigate} onClose={() => {calls.closed++;}} registerNavigationGuard={registerNavigationGuard}/>
        </I18nProvider>);
      window.settingsHarness = {calls,settings,globals,
        lightTheme:exportTheme('light',{...defaultThemes.light,accent:'#123456'},'codex'),
        updateSetting:(key,value) => {settings[key] = value; for (const listener of listeners) listener({type:'settings-changed',keys:[key]});},
        requestLeave:() => guard.requestLeave()};
      render();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

    const language = page.getByRole('combobox', { name: 'Language' });
    await language.waitFor();
    await page.waitForFunction(() => !(document.querySelector('[aria-label="Language"]') as HTMLSelectElement).disabled);
    await language.selectOption('fr-FR');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.calls.navigation), []);
    await page.getByRole('button', { name: 'Keep editing' }).click();
    assert.equal(await language.inputValue(), 'fr-FR');

    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.calls.navigation), [
      { path: '/settings/appearance', options: { state: { source: 'fixture' } } },
    ]);

    await page.getByRole('searchbox', { name: 'Search settings' }).fill('Code font size');
    await page.getByRole('button', { name: /Code font size/ }).click();
    const codeSize = page.getByRole('spinbutton', { name: 'Code font size' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Code font size');
    await codeSize.fill('18');
    await page.getByRole('combobox', { name: 'Reduce motion' }).selectOption('on');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import light theme' });
    await dialog.getByRole('textbox', { name: 'Theme share string' }).fill('invalid theme');
    await dialog.getByRole('button', { name: 'Import' }).click();
    assert.equal(await dialog.getByRole('alert').isVisible(), true);
    const theme = await page.evaluate(() => window.settingsHarness.lightTheme);
    await dialog.getByRole('textbox', { name: 'Theme share string' }).fill(theme);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByLabel('light Accent').inputValue(), '#123456');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.settingsHarness.settings.codeFontSize === 18 &&
      window.settingsHarness.globals['reduced-motion-preference'] === 'on');
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'hidden' });
    const writes = await page.evaluate(() => window.settingsHarness.calls.writes);
    assert.ok(writes.some(write => write.endpoint === 'set-setting' && write.key === 'appearanceLightChromeTheme'));
    assert.ok(writes.some(write => write.endpoint === 'set-global-state' && write.key === 'reduced-motion-preference'));

    await codeSize.fill('19');
    await page.getByRole('combobox', { name: 'Settings host' }).selectOption('ssh-fixture');
    await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).waitFor();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    assert.equal(await codeSize.inputValue(), '19');
    assert.equal(await page.getByRole('combobox', { name: 'Settings host' }).inputValue(), 'local');
    await page.getByRole('combobox', { name: 'Settings host' }).selectOption('ssh-fixture');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.waitForFunction(() => window.settingsHarness.calls.navigation.some(call => call.path === '/settings/appearance?hostId=ssh-fixture'));
    assert.equal(await codeSize.inputValue(), '18');

    await codeSize.fill('20');
    const leave = page.evaluate(() => window.settingsHarness.requestLeave());
    await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).waitFor();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    assert.equal(await leave, false);
    assert.equal(await codeSize.inputValue(), '20');

    await page.evaluate(() => window.settingsHarness.updateSetting('codeFontSize', 21));
    const conflicts = page.getByRole('region', { name: 'Conflicting preferences' });
    await conflicts.waitFor();
    assert.equal(await codeSize.inputValue(), '20');
    assert.match(await conflicts.innerText(), /Code font size[\s\S]*21/);
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await conflicts.getByRole('button', { name: 'Review and reapply' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.settingsHarness.settings.codeFontSize === 20);
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'General', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('zh-CN');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('heading', { name: '通用', exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '语言' }).inputValue(), 'zh-CN');
    assert.equal(await page.evaluate(() => window.settingsHarness.settings.localeOverride), 'zh-CN');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
