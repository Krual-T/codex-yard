import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';
import type {} from './renderer-browser-computer-settings-fixture.tsx';

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('browser and computer settings use the real host bridge, retain gates and isolate late reads',
  { skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 100_000 }, async t => {
    const directory = await mkdtemp('/tmp/ygb-');
    const cleanup: Array<() => Promise<void>> = [async () => { await rm(directory, { recursive: true, force: true }); }];
    t.after(async () => { for (const close of cleanup.reverse()) await close(); });
    const peer = await createFakeCodex(directory); cleanup.push(async () => { await peer.close(); });
    const codexHome = join(directory, 'codex'), dataDir = join(directory, 'data');
    await mkdir(codexHome); await mkdir(dataDir);
    peer.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome }));
    peer.handlers.set('experimentalFeature/list', () => { throw new Error('The leaf must use its parent observation.'); });
    const plugin = { id: 'browser@openai-bundled', name: 'browser', installed: true, enabled: true,
      installPolicy: 'AVAILABLE', availability: 'AVAILABLE', source: { type: 'local' } };
    const plugins = () => ({ marketplaces: [{ name: 'openai-bundled', path: '/fixture/bundled', plugins: [plugin] }] });
    let holdPlugin = false, pluginEntered: (() => void) | undefined, releasePlugin: (() => void) | undefined;
    peer.handlers.set('plugin/list', async () => {
      if (holdPlugin) { holdPlugin = false; pluginEntered?.(); await new Promise<void>(resolve => { releasePlugin = resolve; }); }
      return plugins();
    });
    peer.handlers.set('plugin/installed', plugins);
    let holdConfig = false, enteredConfig: (() => void) | undefined, releaseConfig: (() => void) | undefined;
    peer.handlers.set('config/read', async () => {
      if (holdConfig) { holdConfig = false; enteredConfig?.(); await new Promise<void>(resolve => { releaseConfig = resolve; }); }
      return { config: {}, layers: [{ name: { type: 'user', file: join(codexHome, 'config.toml'), profile: null }, version: 'v1' }] };
    });
    let holdWrite = false, enteredWrite: (() => void) | undefined, releaseWrite: (() => void) | undefined;
    peer.handlers.set('config/batchWrite', async params => {
      const edit = (params.edits as { keyPath: string; value: boolean }[])[0]!;
      assert.equal(edit.keyPath, 'plugins.browser@openai-bundled.enabled'); assert.equal(params.expectedVersion, 'v1');
      if (holdWrite) { holdWrite = false; enteredWrite?.(); await new Promise<void>(resolve => { releaseWrite = resolve; }); }
      plugin.enabled = edit.value; return { status: 'ok' };
    });
    const resources = await nativeFixture(directory);
    let external = 0;
    const app = await createNativeWorkbench({ ...resources, socketPath: peer.socketPath, codexHome, dataDir, workspace: directory, port: 0,
      hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => { external++; throw new Error('External HTTP is blocked'); } });
    cleanup.push(async () => { await app.close(); });
    const bundle = await build({ entryPoints: ['test/renderer-browser-computer-settings-fixture.tsx'], bundle: true, write: false,
      outdir: 'settings-integration-test-output', format: 'iife', jsx: 'automatic' });
    await writeFile(join(resources.renderer, 'workbench-entry.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.contents);
    await writeFile(join(resources.renderer, 'workbench-entry.css'), bundle.outputFiles.find(file => file.path.endsWith('.css'))!.contents);
    const browser = await chromium.launch({ executablePath: chrome, headless: true,
      args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
    cleanup.push(async () => { await browser.close(); });
    const context = await browser.newContext({ viewport: { width: 800, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const errors: string[] = [], sent: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => socket.on('framesent', frame => sent.push(String(frame.payload))));
    await page.route('**/*', route => new URL(route.request().url()).origin === app.url ? route.continue() : route.abort());
    await page.goto(app.url + '/settings/browser-use?hostId=local&return=fixture#section');
    await page.getByRole('heading', { name: 'Browser', exact: true }).waitFor();
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Browser', exact: true }).isDisabled(), true);
    if (process.env.YARD_SETTINGS_SHOTS) await page.screenshot({ path: join(process.env.YARD_SETTINGS_SHOTS, 'browser.png'), fullPage: true });
    await page.getByRole('switch', { name: 'Show full URL' }).check();
    await page.waitForFunction(() => window.integrationSettingsHarness.saved('browser-show-full-url'));
    assert.equal(JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')).settings['browser-show-full-url'], true);
    await page.getByRole('button', { name: 'Default browser', exact: true }).click();
    const destinations = page.getByRole('menu', { name: 'Web URL and link open destination' });
    await destinations.getByRole('menuitemradio', { name: 'ChatGPT' }).click();
    await page.waitForFunction(() => window.integrationSettingsHarness.saved('open-link-in-target-preference'));
    assert.equal(JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')).settings['open-link-in-target-preference'], 'in-app-browser');
    await page.getByRole('button', { name: 'Always include', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu', { name: 'Annotation screenshots' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Clear all browsing data' }).isDisabled(), true);
    await page.getByRole('alert').filter({ hasText: 'Clearing browsing data is unavailable on this web host.' }).waitFor();
    await page.getByRole('button', { name: 'Show individual browsing data options' }).click();
    assert.equal(await page.getByRole('button', { name: 'Delete cookies' }).isDisabled(), true);
    assert.equal(sent.filter(value => value.includes('browser-browsing-data-clear')).length, 0);
    await page.evaluate(() => window.integrationSettingsHarness.failNextNavigation());
    await page.getByText('Browsing history', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Manage' }).click();
    const navigationFailure = page.getByRole('alert').filter({ hasText: 'Synthetic navigation failure' });
    await navigationFailure.waitFor();
    assert.equal(new URL(page.url()).pathname, '/settings/browser-use');
    await navigationFailure.getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('alert').filter({ hasText: 'Browser history is unavailable on this web host.' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/settings/browser-use/history');
    assert.equal(new URL(page.url()).searchParams.get('return'), 'fixture');
    assert.equal(new URL(page.url()).hash, '#section');
    await page.getByRole('button', { name: 'Back to Browser' }).click();
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();

    await page.evaluate(() => window.integrationSettingsHarness.gate('available'));
    await page.getByRole('switch', { name: 'Browser', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !!document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked);
    holdConfig = true;
    const configPending = new Promise<void>(resolve => { enteredConfig = resolve; });
    await page.getByRole('switch', { name: 'Browser', exact: true }).click();
    await Promise.race([configPending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Configuration read was not dispatched')), 5000))]);
    await page.evaluate(() => window.integrationSettingsHarness.revoke());
    assert.ok(releaseConfig); (releaseConfig as () => void)();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(peer.calls('config/batchWrite').length, 0);
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=save'));
    await page.waitForFunction(() => !!document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked);
    await page.getByRole('switch', { name: 'Browser', exact: true }).click();
    try { await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked); }
    catch (error) { console.error('Plugin save state:', await page.locator('body').innerText(), errors, peer.calls('config/batchWrite')); throw error; }
    assert.equal(plugin.enabled, false); assert.equal(peer.calls('config/batchWrite').length, 1);
    assert.ok(peer.calls('plugin/installed').length > 0);

    holdWrite = true;
    const writePending = new Promise<void>(resolve => { enteredWrite = resolve; });
    await page.getByRole('switch', { name: 'Browser', exact: true }).click();
    await Promise.race([writePending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Configuration write was not dispatched')), 5000))]);
    await page.evaluate(() => window.integrationSettingsHarness.revoke());
    assert.ok(releaseWrite); (releaseWrite as () => void)();
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=recover'));
    const recover = page.getByRole('button', { name: 'Check original operation' });
    await recover.waitFor();
    await recover.click();
    await recover.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !!document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked);
    assert.equal(await page.getByRole('switch', { name: 'Browser', exact: true }).isEnabled(), true);
    assert.equal(plugin.enabled, true);
    assert.equal(peer.calls('config/batchWrite').length, 2);

    plugin.installPolicy = 'INSTALLED_BY_DEFAULT';
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=preinstalled'));
    await page.getByLabel('More actions').click();
    assert.equal(await page.getByRole('menuitem', { name: 'Delete' }).isDisabled(), true);
    assert.equal(peer.calls('plugin/uninstall').length, 0);
    plugin.installPolicy = 'AVAILABLE';
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=uninstall'));
    await page.getByLabel('More actions').click();
    assert.equal(await page.getByRole('menuitem', { name: 'Delete' }).isDisabled(), true);
    assert.equal(await page.getByRole('menuitem', { name: 'Delete' }).getAttribute('title'), 'Plugin installation and removal are unavailable on this web host.');
    assert.equal(await page.getByRole('menuitem', { name: 'Try now' }).isDisabled(), true);
    assert.equal(peer.calls('plugin/uninstall').length, 0);

    plugin.installed = false;
    plugin.installPolicy = 'NOT_AVAILABLE';
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=policy'));
    await page.getByRole('button', { name: 'Install' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install' }).isDisabled(), true);
    assert.equal(peer.calls('plugin/install').length, 0);
    plugin.installPolicy = 'AVAILABLE';
    plugin.availability = 'DISABLED_BY_ADMIN';
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=admin'));
    await page.getByRole('button', { name: 'Install' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install' }).isDisabled(), true);
    assert.equal(peer.calls('plugin/install').length, 0);
    plugin.availability = 'AVAILABLE';
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=install'));
    assert.equal(await page.getByRole('button', { name: 'Install' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Install' }).getAttribute('title'), 'Plugin installation and removal are unavailable on this web host.');
    assert.equal(peer.calls('plugin/install').length, 0);
    assert.equal(sent.filter(value => value.includes('"method":"plugin/install"') || value.includes('"method":"plugin/uninstall"')).length, 0);
    plugin.installed = true;

    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?phase=revoked'));
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    const before = sent.filter(value => value.includes('vscode://codex/set-setting')).length;
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Show full URL"]')!;
      input.addEventListener('click', () => window.integrationSettingsHarness.revoke(), { capture: true, once: true });
      input.click();
    });
    assert.equal(sent.filter(value => value.includes('vscode://codex/set-setting')).length, before);

    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/computer-use?hostId=ssh-demo&return=fixture#computer', { from: 'fixture' }));
    await page.getByRole('heading', { name: 'Computer use' }).waitFor();
    await page.evaluate(() => window.integrationSettingsHarness.gate('restricted'));
    assert.equal(await page.getByRole('switch', { name: 'Google Chrome' }).isDisabled(), true);
    if (process.env.YARD_SETTINGS_SHOTS) await page.screenshot({ path: join(process.env.YARD_SETTINGS_SHOTS, 'computer-use.png'), fullPage: true });
    await page.evaluate(() => window.integrationSettingsHarness.gate('available'));
    await page.getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('alert').filter({ hasText: 'Chrome extension status is unavailable' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/settings/computer-use/chrome');
    assert.equal(new URL(page.url()).searchParams.get('hostId'), 'ssh-demo');
    assert.equal(new URL(page.url()).searchParams.get('return'), 'fixture');
    assert.equal(new URL(page.url()).hash, '#computer');
    assert.deepEqual(await page.evaluate(() => history.state), { from: 'fixture' });
    await page.getByRole('button', { name: 'Back to Computer use' }).click();
    await page.evaluate(() => window.integrationSettingsHarness.gate('unknown'));
    await page.getByText('Availability could not be determined for this connection.').waitFor();
    await page.getByRole('button', { name: 'Retry' }).click();
    assert.equal(await page.evaluate(() => window.integrationSettingsHarness.refreshes()), 1);

    const readsBeforeKnown = peer.calls('experimentalFeature/list').length;
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use'));
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    assert.equal(peer.calls('experimentalFeature/list').length, readsBeforeKnown);
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(null));
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    assert.equal(peer.calls('experimentalFeature/list').length, readsBeforeKnown,
      'The leaf must not turn an unverified parent observation into a trusted second read.');
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    assert.equal(peer.calls('experimentalFeature/list').length, readsBeforeKnown);
    assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0);
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(true));
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    const writesBeforeReconnect = peer.calls('config/batchWrite').length;
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(null));
    await page.evaluate(() => window.integrationSettingsHarness.suspend());
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    await page.evaluate(() => window.integrationSettingsHarness.resume());
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(true));
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    assert.equal(peer.calls('config/batchWrite').length, writesBeforeReconnect);
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(null));
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use/history?step=feature'));
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    await page.evaluate(() => window.integrationSettingsHarness.failNextRefresh());
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic availability refresh failure' }).waitFor();
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?step=feature'));
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0);
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(false));
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use/history?step=false'));
    await page.waitForURL(url => url.pathname === '/settings/browser-use' && url.searchParams.get('step') === 'false');
    assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).count(), 0);

    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(true));
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?step=true'));
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(false));
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(null));
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?step=connection'));
    await page.evaluate(() => window.integrationSettingsHarness.suspend());
    await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(false));
    await page.evaluate(() => window.integrationSettingsHarness.resume());
    await page.waitForFunction(() => !document.body.textContent?.includes('Loading browser settings...') &&
      !document.body.textContent?.includes('The connection was lost'));
    assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).count(), 0);
    assert.equal(peer.calls('config/batchWrite').length, writesBeforeReconnect);

    await page.evaluate(() => window.integrationSettingsHarness.rawFeature(true));
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?step=delayed'));
    await page.evaluate(() => window.integrationSettingsHarness.show('/settings/computer-use?step=next'));
    await page.getByRole('heading', { name: 'Computer use' }).waitFor();
    assert.equal(peer.calls('experimentalFeature/list').length, readsBeforeKnown);
    assert.equal(await page.getByRole('heading', { name: 'Browser', exact: true }).count(), 0);
    assert.equal(new URL(page.url()).searchParams.get('step'), 'next');

    const recoveryContext = await browser.newContext({ viewport: { width: 800, height: 800 }, serviceWorkers: 'block' });
    const writesBeforeRecovery = peer.calls('config/batchWrite').length;
    const recoveryRecords = [
      { operationId: 'browser-operation', hostId: 'local', method: 'config/batchWrite', params: {}, phase: 'not-started',
        origin: { section: 'plugins-settings', scope: ['/fixture/project'], draft: { pluginId: 'browser@openai-bundled', enabled: false } } },
      { operationId: 'other-operation', hostId: 'local', method: 'config/batchWrite', params: {}, phase: 'not-started',
        origin: { section: 'plugins-settings', scope: ['/fixture/project'], draft: { pluginId: 'other@openai-bundled', enabled: false } } },
      { operationId: 'other-scope-operation', hostId: 'local', method: 'config/batchWrite', params: {}, phase: 'not-started',
        origin: { section: 'plugins-settings', scope: ['/fixture/other'], draft: { pluginId: 'browser@openai-bundled', enabled: false } } },
      { operationId: 'other-host-operation', hostId: 'remote', method: 'config/batchWrite', params: {}, phase: 'not-started',
        origin: { section: 'plugins-settings', scope: ['/fixture/project'], draft: { pluginId: 'browser@openai-bundled', enabled: false } } },
    ];
    await recoveryContext.addInitScript(records => {
      localStorage.setItem('native-atoms', JSON.stringify({ 'codex-yard.settings-config-writes.v1':
        { version: 2, nextRevision: 1, operations: records, drafts: [], closedNotSent: [] } }));
    }, recoveryRecords);
    const recoveryPage = await recoveryContext.newPage(); recoveryPage.setDefaultTimeout(8000);
    await recoveryPage.route('**/*', route => new URL(route.request().url()).origin === app.url ? route.continue() : route.abort());
    plugin.id = 'other@openai-bundled'; plugin.name = 'other';
    await recoveryPage.goto(app.url + '/settings/browser-use?step=recovery');
    await recoveryPage.getByRole('heading', { name: 'Browser', exact: true }).waitFor();
    holdPlugin = true;
    const pluginPending = new Promise<void>(resolve => { pluginEntered = resolve; });
    await recoveryPage.evaluate(() => window.integrationSettingsHarness.gate('available'));
    await pluginPending;
    assert.equal(await recoveryPage.getByRole('button', { name: 'Check original operation' }).count(), 0);
    assert.equal(await recoveryPage.getByText('other-operation', { exact: true }).count(), 0);
    assert.ok(releasePlugin); releasePlugin();
    await recoveryPage.getByText('In-app plugin unavailable').waitFor();
    assert.equal(await recoveryPage.getByRole('button', { name: 'Check original operation' }).count(), 0);
    assert.equal(await recoveryPage.getByText('browser-operation', { exact: true }).count(), 0);
    plugin.id = 'browser@openai-bundled'; plugin.name = 'browser';
    await recoveryPage.evaluate(() => window.integrationSettingsHarness.show('/settings/browser-use?step=identified'));
    await recoveryPage.getByText('browser-operation', { exact: true }).waitFor();
    assert.equal(await recoveryPage.getByRole('button', { name: 'Check original operation' }).count(), 1);
    assert.equal(await recoveryPage.getByText('other-operation', { exact: true }).count(), 0);
    assert.equal(await recoveryPage.getByText('other-scope-operation', { exact: true }).count(), 0);
    assert.equal(await recoveryPage.getByText('other-host-operation', { exact: true }).count(), 0);
    const retained = await recoveryPage.evaluate(() => new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const request = open.result.transaction('atoms').objectStore('atoms').get('native-atoms');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result.atoms['codex-yard.settings-config-writes.v1'].operations);
      };
    }));
    assert.deepEqual(retained, recoveryRecords);
    assert.equal(peer.calls('config/batchWrite').length, writesBeforeRecovery);
    await recoveryPage.evaluate(() => window.integrationSettingsHarness.close());
    await recoveryContext.close();
    assert.deepEqual(errors, []); assert.equal(external, 0);
    await page.evaluate(() => window.integrationSettingsHarness.close());
    await context.close();
  });
