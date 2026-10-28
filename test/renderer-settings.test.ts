import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    settingsHarness: {
      render: (options?: { dirty?: boolean; active?: string; redirect?: boolean; section?: string; state?: unknown }) => void;
      navigate: { to: unknown; options?: unknown }[];
      prepared: string[];
      hosts: string[];
      discarded: number;
      command: (source: string) => boolean | void;
      reset: () => void;
    };
  }
}

test('settings navigation preserves dirty forms, host routing, search targets and redirects', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable',
}, async () => {
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {createSettingsPageComponent} from './src/renderer/settings/settings-page.tsx';
      const sections = [{slug:'general-settings'},{slug:'appearance'},{slug:'usage'},
        {slug:'cloud-environments'},{slug:'plugins-settings'},{slug:'profile',appRoute:'/profile'}];
      let options = {dirty:false,active:'general-settings',redirect:false,section:'general-settings',state:{source:'fixture'}};
      const navigate = (to,opts) => window.settingsHarness.navigate.push({to,options:opts});
      const actions = {
        prepareHostNavigation: host => window.settingsHarness.prepared.push(host),
        discardChanges: action => { window.settingsHarness.discarded++; action(); },
        trackProfileVisit: () => {}, updateLegacyContentRect: () => {},
      };
      const Page = createSettingsPageComponent(React, {
        useSettingsActions: () => actions, useCodexMicroDeviceModel: () => null,
        useIntl: () => ({formatMessage: m => m.defaultMessage}), useNavigate: () => navigate,
        useLocation: () => ({key:'fixture',pathname:'/settings/'+options.section,search:'',hash:'#anchor',state:options.state}),
        useHostSelection: () => ({selectedHostId:'local',connectedRemoteConnections:[{hostId:'ssh-fixture',displayName:'Fixture SSH'}],
          setSelectedHostId: id => window.settingsHarness.hosts.push(id)}),
        useSectionMatch: () => ({params:{section:options.section}}), useToolMatch: () => null, useAvailableTool: () => null,
        normalizeUsageTab: tab => tab ?? 'usage', isLocalHost: id => id === 'local',
        useVisibleSettings: () => ({activeSettingsSection:options.active,settingsNavigationSections:sections,
          showEnterpriseUsageLabel:false,shouldRedirectToVisibleSettingsSection:options.redirect,
          shouldRenderRouteContent:true,visibleSettingsSections:sections}),
        useReturnPath: () => '/local/fixture', useLayout: () => 'legacy', useHasUnsavedChanges: () => options.dirty,
        shouldNavigateBack: state => state?.back === true,
        resolveSection: slug => ({path:'/settings/'+slug,sectionSlug:slug}), sectionPath: slug => '/settings/'+slug,
        localHostId:'local', useResizeObserver: () => React.useCallback(() => {}, []),
        registerSettingsCommand: callback => { window.settingsHarness.command = callback; return () => {}; },
        HostDropdown: ({onSelectHost}) => <button onClick={() => onSelectHost('ssh-fixture')}>SSH host</button>,
        LocalIcon: () => null, LoadingSection: () => 'loading', SectionTitle: ({slug}) => slug,
        CloudPreferencesError: () => 'error', SectionContainer: ({children}) => <main>{children}</main>,
        Outlet: ({context}) => <div><button onClick={context.onClose}>Close settings</button>
          <button onClick={() => context.onSelectSection('appearance','Color')}>Search Color</button></div>,
        Redirect: ({to,state}) => <output data-redirect={to}>{JSON.stringify(state)}</output>,
        DocumentTitle: () => null,
        Sidebar: props => <aside data-active={props.activeSection}>
          {props.sidebarHostSelector}<button onClick={() => props.onSelect('general-settings')}>General</button>
          <button onClick={() => props.onSelect('appearance')}>Appearance</button>
          <button onClick={() => props.onSelect('profile')}>Profile</button>
          <button onClick={() => props.onSelectTeam('team/name','members')}>Team</button></aside>,
        Content: ({navigationKey,targetId,targetText,children}) => <main data-key={navigationKey} data-target={targetId} data-text={targetText}>{children}</main>,
        Shell: ({legacyContentRef,sidebar,children}) => <div ref={legacyContentRef}>{sidebar}{children}</div>,
        UnsavedChangesDialog: ({pendingNavigation,onClearPendingNavigation}) => pendingNavigation == null ? null : <div role="dialog">
          <button onClick={onClearPendingNavigation}>Cancel navigation</button>
          <button onClick={() => {onClearPendingNavigation();pendingNavigation();}}>Discard and continue</button></div>,
      });
      const root = createRoot(document.getElementById('root'));
      window.settingsHarness = {navigate:[],prepared:[],hosts:[],discarded:0,command:()=>{},
        reset() { this.navigate=[];this.prepared=[];this.hosts=[];this.discarded=0; },
        render(next={}) { options={...options,...next};flushSync(() => root.render(<Page/>)); },
      };
      window.settingsHarness.render();
    ` }, bundle: true, write: false, format: 'iife', jsx: 'transform',
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: built.outputFiles[0]!.text });
    await page.getByRole('button', { name: 'General', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.prepared), []);
    await page.evaluate(() => window.settingsHarness.render({ dirty: true }));
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.navigate), []);
    await page.getByRole('button', { name: 'Cancel navigation' }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.navigate), []);
    await page.getByRole('button', { name: 'Search Color' }).click();
    await page.getByRole('button', { name: 'Discard and continue' }).click();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.navigate), [
      { to: '/settings/appearance', options: { replace: true, state: { source: 'fixture' } } },
    ]);
    assert.equal(await page.evaluate(() => window.settingsHarness.discarded), 1);
    await page.evaluate(() => window.settingsHarness.render({ active: 'appearance', section: 'appearance' }));
    assert.equal(await page.locator('main[data-key]').getAttribute('data-key'), 'fixture:1');
    // The target belongs to the selected route, including its fragment.
    assert.equal(await page.locator('main[data-key]').getAttribute('data-text'), null);
    await page.getByRole('button', { name: 'Search Color' }).click();
    assert.equal(await page.locator('main[data-key]').getAttribute('data-key'), 'fixture:2');
    assert.equal(await page.locator('main[data-key]').getAttribute('data-text'), 'Color');
    assert.equal(await page.getByRole('dialog').count(), 0);

    await page.getByRole('button', { name: 'SSH host' }).click();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.hosts), []);
    await page.getByRole('button', { name: 'Discard and continue' }).click();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.hosts), ['ssh-fixture']);
    await page.evaluate(() => { window.settingsHarness.reset(); window.settingsHarness.render({ dirty: false }); });
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.navigate), [{ to: '/profile', options: undefined }]);
    await page.evaluate(() => window.settingsHarness.reset());
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.navigate), [{
      to: { pathname: '/settings/teams/team%2Fname', search: '?tab=members' },
      options: { replace: true, state: { source: 'fixture' } },
    }]);
    await page.evaluate(() => window.settingsHarness.reset());
    assert.equal(await page.evaluate(() => window.settingsHarness.command('menu')), false);
    await page.evaluate(() => window.settingsHarness.command('keyboard_shortcut'));
    assert.deepEqual(await page.evaluate(() => window.settingsHarness.navigate), [{ to: '/local/fixture', options: { replace: true } }]);
    await page.evaluate(() => window.settingsHarness.render({ redirect: true, section: 'cloud-settings', active: 'cloud-environments' }));
    assert.equal(await page.locator('output').getAttribute('data-redirect'), '/settings/cloud-environments?tab=preferences');
    assert.equal(await page.locator('output').textContent(), '{"source":"fixture"}');
    await page.close();
  } finally { await browser.close(); }
});
