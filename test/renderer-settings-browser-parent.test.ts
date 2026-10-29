import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';
import type {} from './renderer-settings-browser-parent-fixture.tsx';

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('settings parent scopes real host reads, guarded actions and unavailable original gates',
  { skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 120_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'ygsp-'));
    const cleanup: Array<() => Promise<void>> = [async () => { await rm(directory, { recursive: true, force: true }); }];
    t.after(async () => { for (const close of cleanup.reverse()) await close(); });
    const peer = await createFakeCodex(directory); cleanup.push(async () => { await peer.close(); });
    const codexHome = join(directory, 'codex'), dataDir = join(directory, 'data');
    await mkdir(codexHome); await mkdir(dataDir);
    peer.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome }));
    let policy = true, browser = false, external = false, raw = false, includeRaw = true, failPolicy = false;
    let holdPolicy = false, policyEntered: (() => void) | undefined, releasePolicy: (() => void) | undefined;
    peer.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }));
    peer.handlers.set('configRequirements/read', async () => {
      if (failPolicy) throw new Error('Synthetic requirements rejected');
      const captured = policy;
      if (holdPolicy) { holdPolicy = false; policyEntered?.(); await new Promise<void>(resolve => { releasePolicy = resolve; }); }
      return { requirements: { allowBrowserAndComputerUse: captured } };
    });
    peer.handlers.set('experimentalFeature/list', params => params.cursor === 'next' ?
      { data: includeRaw ? [{ name: 'in_app_browser', enabled: raw }] : [], nextCursor: null } :
      { data: [{ name: 'browser_use', enabled: browser }, { name: 'browser_use_external', enabled: external },
        { name: 'computer_use', enabled: false }], nextCursor: 'next' });
    const plugin = { id: 'browser@openai-bundled', name: 'browser', installed: true, enabled: true,
      installPolicy: 'AVAILABLE', availability: 'AVAILABLE', source: { type: 'local' } };
    const plugins = () => ({ marketplaces: [{ name: 'openai-bundled', path: '/fixture/bundled', plugins: [plugin] }] });
    peer.handlers.set('plugin/list', plugins); peer.handlers.set('plugin/installed', plugins);
    let holdConfig = false, configEntered: (() => void) | undefined, releaseConfig: (() => void) | undefined;
    peer.handlers.set('config/read', async () => {
      if (holdConfig) { holdConfig = false; configEntered?.(); await new Promise<void>(resolve => { releaseConfig = resolve; }); }
      return { config: {}, layers: [{ name: { type: 'user', file: join(codexHome, 'config.toml'), profile: null }, version: 'v1' }] };
    });
    peer.handlers.set('config/batchWrite', params => {
      const edit = (params.edits as { keyPath: string; value: boolean }[])[0]!;
      assert.equal(edit.keyPath, 'plugins.browser@openai-bundled.enabled');
      assert.equal(params.expectedVersion, 'v1');
      plugin.enabled = edit.value;
      return { status: 'ok' };
    });
    const resources = await nativeFixture(directory);
    let externalRequests = 0;
    const app = await createNativeWorkbench({ ...resources, socketPath: peer.socketPath, codexHome, dataDir, workspace: directory, port: 0,
      hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => { externalRequests++; throw new Error('External HTTP blocked'); } });
    cleanup.push(async () => { await app.close(); });
    const bundle = await build({ entryPoints: ['test/renderer-settings-browser-parent-fixture.tsx'], bundle: true, write: false,
      outdir: 'settings-browser-parent-test-output', format: 'iife', jsx: 'automatic' });
    await writeFile(join(resources.renderer, 'workbench-entry.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.contents);
    await writeFile(join(resources.renderer, 'workbench-entry.css'), bundle.outputFiles.find(file => file.path.endsWith('.css'))!.contents);
    const browserProcess = await chromium.launch({ executablePath: chrome, headless: true,
      args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
    cleanup.push(async () => { await browserProcess.close(); });
    const context = await browserProcess.newContext({ viewport: { width: 800, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const pageErrors: string[] = [], sent: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('websocket', socket => socket.on('framesent', frame => sent.push(String(frame.payload))));
    await page.route('**/*', route => new URL(route.request().url()).origin === app.url ? route.continue() : route.abort());
    await page.goto(app.url + '/settings/browser-use?return=fixture#section');
    await page.getByRole('heading', { name: 'Browser', exact: true }).waitFor();
    await page.getByText('Disabled by your organization or unavailable in your region').waitFor();
    await page.waitForFunction(() => !document.body.textContent?.includes('Loading browser settings...'));
    assert.ok(peer.calls('experimentalFeature/list').some(call => call.params.cursor === 'next'));
    assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).count(), 0);

    includeRaw = false;
    await page.evaluate(() => window.browserParentHarness.renew());
    await page.waitForFunction(() => !!document.querySelector('[aria-label="Show full URL"]') ||
      !!document.body.textContent?.includes('In-app browser availability cannot be verified'));
    await t.test('a missing host feature remains unknown through the production parent', async () => {
      assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0,
        'The parent must not treat a missing in_app_browser feature as enabled.');
      await page.getByRole('alert').filter({ hasText: 'In-app browser availability cannot be verified' }).waitFor();
    });
    includeRaw = true; browser = true; policy = false;
    await page.evaluate(() => window.browserParentHarness.renew());
    await page.getByText('Disabled by your organization or unavailable in your region').waitFor();
    policy = true;
    await page.evaluate(() => window.browserParentHarness.renew());
    await page.getByText('Availability could not be determined for this connection.').first().waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0);
    await page.evaluate(() => window.browserParentHarness.source('unmodified'));
    await page.getByRole('heading', { name: 'Browser', exact: true }).waitFor();
    await page.waitForFunction(() => !document.body.textContent?.includes('Loading browser settings...'));
    assert.equal(await page.getByRole('switch', { name: 'Show full URL' }).count(), 0);

    raw = true;
    await page.evaluate(() => window.browserParentHarness.source('unmodified'));
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    await page.getByText('Availability could not be determined for this connection.').first().waitFor();
    const beforeRevokedPreference = sent.filter(value => value.includes('vscode://codex/set-setting')).length;
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Show full URL"]')!;
      input.addEventListener('click', () => window.browserParentHarness.revoke(), { capture: true, once: true });
      input.click();
    });
    assert.equal(sent.filter(value => value.includes('vscode://codex/set-setting')).length, beforeRevokedPreference);
    await page.evaluate(() => window.browserParentHarness.renew());
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    await page.getByRole('switch', { name: 'Show full URL' }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="Show full URL"]') as HTMLInputElement | null)?.checked === true);
    const clear = page.getByRole('button', { name: 'Clear all browsing data' });
    assert.equal(await clear.isDisabled(), true);
    assert.equal(await clear.getAttribute('title'), 'Clearing browsing data is unavailable on this web host.');
    await page.getByRole('alert').filter({ hasText: 'Clearing browsing data is unavailable on this web host.' }).waitFor();
    assert.equal(sent.filter(value => value.includes('browser-browsing-data-clear')).length, 0);

    await page.evaluate(() => window.browserParentHarness.gates({ browserAgentRollout: true, externalBrowserRollout: true,
      extensionsRollout: true, runCodexInWsl: false }));
    await page.waitForFunction(() => !!document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked);
    await page.getByLabel('More actions').click();
    await page.getByRole('menuitem', { name: 'Try now' }).click();
    assert.deepEqual(await page.evaluate(() => window.browserParentHarness.tried()), { hostId: 'local', cwd: '/fixture/project', name: 'browser' });
    await page.getByLabel('More actions').click();
    assert.equal(await page.getByRole('menuitem', { name: 'Delete' }).isDisabled(), true);
    assert.equal(await page.getByRole('menuitem', { name: 'Delete' }).getAttribute('title'),
      'Plugin installation and removal are unavailable on this web host.');
    assert.equal(peer.calls('plugin/uninstall').length, 0);
    await page.getByLabel('More actions').click();

    plugin.installed = false;
    await page.evaluate(() => window.browserParentHarness.renew());
    const install = page.getByRole('button', { name: 'Install' });
    await install.waitFor();
    assert.equal(await install.isDisabled(), true);
    assert.equal(await install.getAttribute('title'), 'Plugin installation and removal are unavailable on this web host.');
    assert.equal(peer.calls('plugin/install').length, 0);
    plugin.installed = true;
    await page.evaluate(() => window.browserParentHarness.renew());
    await page.waitForFunction(() => !!document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked);

    holdConfig = true;
    const configPending = new Promise<void>(resolve => { configEntered = resolve; });
    await page.getByRole('switch', { name: 'Browser', exact: true }).click();
    await configPending;
    await page.evaluate(() => window.browserParentHarness.revoke());
    assert.ok(releaseConfig); releaseConfig();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(peer.calls('config/batchWrite').length, 0);

    await page.evaluate(() => window.browserParentHarness.renew());
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    await page.waitForFunction(() => !!document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked);
    await page.getByRole('switch', { name: 'Browser', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('[aria-label="Browser"]')?.checked);
    assert.equal(plugin.enabled, false);
    assert.equal(peer.calls('config/batchWrite').length, 1);
    await page.evaluate(() => window.browserParentHarness.pauseNavigation());
    await page.getByText('Browsing history', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Manage' }).click();
    await page.evaluate(() => { window.browserParentHarness.revoke(); window.browserParentHarness.releaseNavigation(); });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(new URL(page.url()).pathname, '/settings/browser-use');
    await page.evaluate(() => { window.browserParentHarness.renew(); window.browserParentHarness.blockNavigation(true); });
    await page.getByRole('switch', { name: 'Show full URL' }).waitFor();
    await page.getByText('Browsing history', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Manage' }).click();
    const navigationFailure = page.getByRole('alert').filter({ hasText: 'Navigation was not completed' });
    await navigationFailure.waitFor();
    await page.evaluate(() => window.browserParentHarness.blockNavigation(false));
    await navigationFailure.getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('alert').filter({ hasText: 'Browser history is unavailable on this web host.' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/settings/browser-use/history');
    assert.equal(new URL(page.url()).searchParams.get('return'), 'fixture');
    assert.equal(new URL(page.url()).hash, '#section');

    external = false;
    await page.evaluate(() => window.browserParentHarness.show('/settings/computer-use?return=computer#place', { previous: 'fixture' }));
    await page.getByText('Disabled by your organization or unavailable in your region').waitFor();
    external = true;
    await page.evaluate(() => window.browserParentHarness.gates());
    await page.getByText('Availability could not be determined for this connection.').waitFor();
    await page.evaluate(() => window.browserParentHarness.gates({ externalBrowserRollout: true, runCodexInWsl: false }));
    await page.getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('alert').filter({ hasText: 'Chrome extension status is unavailable on this web host.' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('return'), 'computer');
    assert.equal(new URL(page.url()).hash, '#place');
    assert.deepEqual(await page.evaluate(() => history.state), { previous: 'fixture' });

    policy = false; holdPolicy = true;
    const policyPending = new Promise<void>(resolve => { policyEntered = resolve; });
    await page.evaluate(() => window.browserParentHarness.show('/settings/computer-use'));
    await policyPending;
    policy = true;
    peer.send({ method: 'account/updated', params: {} });
    await page.getByRole('button', { name: 'Manage' }).waitFor();
    assert.ok(releasePolicy); releasePolicy();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.getByRole('button', { name: 'Manage' }).count(), 1);

    failPolicy = true;
    await page.evaluate(() => window.browserParentHarness.renew());
    await page.getByRole('alert').filter({ hasText: 'Synthetic requirements rejected' }).waitFor();
    failPolicy = false;
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('button', { name: 'Manage' }).waitFor();
    await page.evaluate(() => window.browserParentHarness.locale('zh-CN'));
    await page.getByRole('heading', { name: '电脑操控' }).waitFor();
    await page.evaluate(() => window.browserParentHarness.gates());
    await page.getByText('无法确定当前连接的可用状态。').waitFor();

    await page.evaluate(() => window.browserParentHarness.suspend());
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => window.browserParentHarness.resume());
    await page.getByRole('heading', { name: '电脑操控' }).waitFor();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const beforeRemote = peer.calls('experimentalFeature/list').length;
    await page.evaluate(() => window.browserParentHarness.show('/settings/browser-use?hostId=missing-ssh'));
    await page.getByRole('alert').waitFor();
    assert.equal(peer.calls('experimentalFeature/list').length, beforeRemote);
    await page.evaluate(() => window.browserParentHarness.show('/settings/computer-use'));
    await page.getByRole('heading', { name: '电脑操控' }).waitFor();
    assert.equal(peer.calls('turn/start').length, 0);
    assert.equal(externalRequests, 0);
    assert.deepEqual(pageErrors, []);
    await page.evaluate(() => window.browserParentHarness.close());
  });
