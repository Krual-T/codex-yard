import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { PluginBuild } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { nativeFixture } from './native-fixture.ts';
import type {} from './renderer-product-workspace-fixture.tsx';

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('product workspace uses the browser client and existing host capabilities', { skip: !existsSync(chrome), timeout: 120_000 }, async t => {
  const directory = await mkdtemp('/tmp/ygc-');
  const cleanup: Array<() => Promise<void>> = [async () => { await rm(directory, { recursive: true, force: true }); }];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const peer = await createFakeCodex(directory);
  cleanup.push(async () => { await peer.close(); });
  const files = fileDaemonFixture();
  for (const method of fileMethods) peer.handlers.set(method, params => files(method, params));
  const remoteDirectory = join(directory, 'remote'); await mkdir(remoteDirectory);
  const remote = await createFakeCodex(remoteDirectory);
  cleanup.push(async () => { await remote.close(); });
  const remoteCodexHome = join(remoteDirectory, 'codex'); await mkdir(remoteCodexHome);
  remote.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome: remoteCodexHome }));
  const codexDir = join(directory, 'codex'); await mkdir(codexDir);
  peer.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome: codexDir }));
  const skillFile = join(directory, 'SKILL.md'); await writeFile(skillFile, 'Synthetic skill instructions');
  let mode: 'apiKey' | 'chatgpt' | 'signed-out' | 'unknown' = 'apiKey';
  let holdAccount = false, accountEntered: (() => void) | undefined, releaseAccount: (() => void) | undefined;
  let localAutomation = true, pluginsEnabled = true, failFeatureRead = false;
  let holdFeature = false, featureEntered: (() => void) | undefined, releaseFeature: (() => void) | undefined;
  peer.handlers.set('account/read', async () => {
    const value = { account: mode === 'signed-out' ? null : mode === 'chatgpt' ? { type: 'chatgpt', email: 'not-an-identity', planType: 'plus' } :
      mode === 'unknown' ? { type: 'unknown-fixture' } : { type: 'apiKey' }, requiresOpenaiAuth: true, workspaceRouting: null };
    if (holdAccount) { holdAccount = false; accountEntered?.(); await new Promise<void>(resolve => { releaseAccount = resolve; }); }
    return value;
  });
  peer.handlers.set('getAuthStatus', () => ({ authMethod: mode === 'apiKey' ? 'apikey' : mode === 'chatgpt' ? 'chatgpt' : null,
    authToken: 'synthetic-secret', requiresOpenaiAuth: true }));
  peer.handlers.set('experimentalFeature/list', async params => {
    if (failFeatureRead) throw new Error('Synthetic feature read failure');
    if (holdFeature) { holdFeature = false; featureEntered?.(); await new Promise<void>(resolve => { releaseFeature = resolve; }); }
    return params.cursor === 'next' ?
      { data: [{ name: 'in_app_local_automation', enabled: localAutomation }, { name: 'plugins', enabled: pluginsEnabled }], nextCursor: null } :
      { data: [{ name: 'unrelated', enabled: true }], nextCursor: 'next' };
  });
  peer.handlers.set('skills/list', () => ({ data: [{ cwd: '/fixture/project', skills: [{ name: 'Fixture skill', path: skillFile,
    description: 'Fixture instructions', scope: 'user', enabled: true }], errors: [] }] }));
  remote.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }));
  let holdRemote = false, remoteEntered: (() => void) | undefined, releaseRemote: (() => void) | undefined;
  remote.handlers.set('skills/list', async () => {
    if (holdRemote) { holdRemote = false; remoteEntered?.(); await new Promise<void>(resolve => { releaseRemote = resolve; }); }
    return { data: [{ cwd: '/remote/project', skills: [{ name: 'Remote skill', path: '/remote/SKILL.md',
      description: 'Remote instructions', scope: 'user', enabled: true }], errors: [] }] };
  });
  const plugin = { id: 'fixture-plugin', name: 'fixture-plugin', installed: true, enabled: true, installPolicy: 'AVAILABLE', source: { type: 'local' },
    interface: { displayName: 'Fixture plugin', shortDescription: 'Fixture plugin' } };
  peer.handlers.set('plugin/installed', () => ({ marketplaces: [{ name: 'Fixture', path: '/fixture/marketplace', plugins: [plugin] }] }));
  peer.handlers.set('plugin/list', () => ({ marketplaces: [] }));
  peer.handlers.set('plugin/read', () => ({ plugin: { summary: plugin, marketplaceName: 'Fixture', marketplacePath: '/fixture/marketplace', apps: [], skills: [], mcpServers: [], hooks: [] } }));
  peer.handlers.set('config/read', () => ({ config: {}, origins: {}, layers: [{ name: { type: 'user', file: join(codexDir, 'config.toml'), profile: null }, version: 'version-1' }] }));
  peer.handlers.set('config/batchWrite', params => {
    const edit = (params.edits as { keyPath: string; value: boolean }[])[0]!;
    assert.equal(edit.keyPath, 'plugins.fixture-plugin.enabled');
    assert.equal(params.expectedVersion, 'version-1');
    plugin.enabled = edit.value;
    return { status: 'ok' };
  });
  peer.threads.set('fixture-thread', fixtureThread('fixture-thread', '/fixture/project', { name: 'Fixture chat' }));
  const dataDir = join(directory, 'data'); await mkdir(dataDir);
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ path: '/fixture/project', name: 'Fixture project' }]));
  const resources = await nativeFixture(directory);
  let externalRequests = 0;
  const app = await createNativeWorkbench({ ...resources, socketPath: peer.socketPath, codexHome: codexDir,
    dataDir, workspace: directory, port: 0, hostCatalog: { hosts: [{ hostId: 'remote-ssh-fixture', displayName: 'Fixture SSH', sshAlias: null,
      sshHost: 'fixture', sshPort: null, identity: null }], projects: [{ id: 'remote-project', hostId: 'remote-ssh-fixture', label: 'Remote project', remotePath: '/remote/project' }], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: remoteDirectory, codexHome: remoteCodexHome }); return connect(remote.socketPath); },
    httpFetch: async () => { externalRequests++; throw new Error('External HTTP is blocked'); } });
  cleanup.push(async () => { await app.close(); });
  const alternateClient = process.env.PRODUCT_WORKSPACE_TEST_CLIENT;
  const extendController = process.env.PRODUCT_WORKSPACE_TEST_CONFIG_EXTENSION === '1';
  const bundle = await build({ entryPoints: ['test/renderer-product-workspace-fixture.tsx'], bundle: true, write: false,
    outdir: 'product-workspace-test-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
    plugins: [...alternateClient ? [{ name: 'fixed-manager-client', setup(builder: PluginBuild) {
      builder.onLoad({ filter: /\/src\/renderer\/app\/client\.ts$/ }, async args => ({ contents: await readFile(alternateClient, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] : [], ...extendController ? [{ name: 'conditional-settings-controller-extension', setup(builder: PluginBuild) {
      builder.onLoad({ filter: /\/test\/renderer-product-workspace-fixture\.tsx$/ }, async args => {
        const input = await readFile(args.path, 'utf8');
        const marker = 'const client = new BrowserWorkbenchClient() as ProductPagesClient;';
        assert.ok(input.includes(marker));
        return { contents: `import { settingsConfigOperations } from '../src/renderer/settings/config-operations.ts';\n` +
          input.replace(marker, `${marker}\nwindow.productWorkspaceConfiguration = settingsConfigOperations(client) as unknown as ProductConfigurationWrites;`),
        loader: 'tsx', resolveDir: dirname(args.path) };
      });
      builder.onLoad({ filter: /\/src\/renderer\/settings\/config-operations\.ts$/ }, async args => {
        const input = await readFile(args.path, 'utf8');
        const sections = "const sections = new Set(['models', 'agent', 'worktrees', 'hooks-settings', 'skills-settings']);";
        const send = "this.client.host('configuration-write', { hostId, action: 'submit', operationId, method, params: entry.params, source: entry.origin.source })";
        assert.ok(input.includes(sections) && input.includes(send));
        return { contents: input.replace(sections, sections.replace("'skills-settings']);", "'skills-settings', 'plugins-settings']);"))
          .replace(send, `${send.slice(0, -1)}, { assertBeforeSend: () => { if (!canDispatch()) throw new Error('The selected page changed.'); } })`),
        loader: 'ts', resolveDir: dirname(args.path) };
      });
    } }] : []] });
  await writeFile(join(resources.renderer, 'workbench-entry.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.contents);
  await writeFile(join(resources.renderer, 'workbench-entry.css'), bundle.outputFiles.find(file => file.path.endsWith('.css'))!.contents);
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  cleanup.push(async () => { await browser.close(); });
  const context = await browser.newContext({ viewport: { width: 800, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const bridge: string[] = [], frames: string[] = [], errors: string[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => frames.push(String(frame.payload))));
  page.on('request', request => { if (request.url() === app.url + '/api/http-fetch') {
    const wire = request.postDataJSON() as { url: string }; bridge.push(wire.url);
  } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if (origin === app.url) return route.continue();
    console.error('Blocked browser origin:', origin);
    return route.abort();
  });
  await page.goto(app.url + '/');
  const show = (path: string, state?: unknown) => page.evaluate(({ path, state }) => window.productWorkspaceHarness.show(path, state), { path, state });
  const waitForEntered = async (entered: Promise<void>, description: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([entered, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), 8000);
      })]);
    } catch (error) {
      console.error(`While waiting for ${description}:`, await page.locator('body').innerText(),
        'local methods:', peer.messages.map(message => message.method).filter(Boolean),
        'remote methods:', remote.messages.map(message => message.method).filter(Boolean));
      throw error;
    } finally { clearTimeout(timer); }
  };
  try { await page.getByRole('button', { name: /Fixture skill/ }).waitFor(); }
  catch (error) { console.error('Initial product workspace:', await page.locator('body').innerText(), errors); throw error; }
  assert.ok(peer.calls('account/read').length > 0); assert.ok(peer.calls('skills/list').length > 0);
  await page.getByRole('button', { name: /Fixture skill/ }).click();
  await page.getByText('Synthetic skill instructions').waitFor();
  await page.getByRole('button', { name: 'Open file' }).click();
  assert.deepEqual(await page.evaluate(() => window.productWorkspaceHarness.calls.find(call => call.kind === 'open-file')?.value),
    { hostId: 'local', cwd: '/fixture/project', path: skillFile });
  await page.getByRole('button', { name: 'Try now' }).click();
  assert.ok(await page.evaluate(() => window.productWorkspaceHarness.calls.some(call => call.kind === 'try-skill')));
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Enabled' }).click();
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: /skills\/config\/write|Configuration changes require/ }).waitFor();
  assert.equal(peer.calls('skills/config/write').length, 0);
  assert.equal(await page.getByRole('dialog').getByRole('checkbox', { name: 'Enabled' }).isEnabled(), true);

  await show('/plugins');
  await page.getByRole('alert').filter({ hasText: 'Could not load public categories' }).waitFor();
  assert.ok(bridge.some(url => url.includes('/ps/plugins/home')));
  await page.getByRole('button', { name: /Fixture plugin/ }).first().click();
  const pluginDialog = page.getByRole('dialog');
  await pluginDialog.getByRole('checkbox', { name: 'Enabled' }).click();
  if (extendController) {
    try { await page.getByText('Plugin setting saved. Refreshing inventory...').waitFor(); }
    catch (error) { console.error('Plugin configuration result:', await page.locator('body').innerText(),
      peer.calls('config/read'), peer.calls('config/batchWrite'), errors); throw error; }
    await pluginDialog.getByRole('checkbox', { name: 'Enabled' }).waitFor();
    assert.equal(plugin.enabled, false);
    assert.equal(peer.calls('config/batchWrite').length, 1);
    assert.ok(peer.calls('config/read').length > 0 && peer.calls('plugin/read').length > 0);
  } else {
    await pluginDialog.getByRole('alert').filter({ hasText: 'Plugin settings cannot be saved on this host' }).waitFor();
    assert.equal(plugin.enabled, true);
    assert.equal(peer.calls('config/batchWrite').length, 0);
    assert.equal(await pluginDialog.getByRole('checkbox', { name: 'Enabled' }).isEnabled(), true);
  }
  await pluginDialog.getByRole('button', { name: 'Uninstall' }).click();
  await pluginDialog.getByRole('button', { name: 'Confirm uninstall' }).click();
  await pluginDialog.getByRole('alert').filter({ hasText: 'plugin/uninstall' }).waitFor();
  assert.equal(peer.calls('plugin/uninstall').length, 0);

  await show('/plugins?host=local&return=projects#plugin', { origin: 'fixture' });
  await page.getByRole('button', { name: /Fixture plugin/ }).first().waitFor();
  failFeatureRead = true;
  await page.getByRole('button', { name: 'Manage' }).click();
  const manageError = page.getByRole('alert').filter({ hasText: 'Synthetic feature read failure' });
  await manageError.waitFor();
  assert.equal(new URL(page.url()).pathname, '/plugins');
  failFeatureRead = false;
  await manageError.getByRole('button', { name: 'Retry' }).click();
  await page.waitForFunction(() => window.location.pathname === '/settings/plugins-settings');
  assert.equal(new URL(page.url()).searchParams.get('hostId'), 'local');
  assert.equal(new URL(page.url()).searchParams.get('return'), 'projects');
  assert.equal(new URL(page.url()).hash, '#plugin');
  assert.deepEqual(await page.evaluate(() => history.state), { origin: 'fixture' });

  pluginsEnabled = false;
  await show('/plugins?hostId=local');
  await page.getByRole('button', { name: /Fixture plugin/ }).first().waitFor();
  await page.getByRole('button', { name: 'Manage' }).click();
  await page.waitForFunction(() => window.location.pathname === '/skills');
  assert.equal(new URL(page.url()).searchParams.get('hostId'), 'local');
  pluginsEnabled = true;

  await show('/plugins');
  await page.getByRole('button', { name: /Fixture plugin/ }).first().waitFor();
  holdFeature = true;
  const enteredFeature = new Promise<void>(resolve => { featureEntered = resolve; });
  await page.getByRole('button', { name: 'Manage' }).click();
  await waitForEntered(enteredFeature, 'plugin feature read');
  await show('/projects');
  await page.getByRole('button', { name: /Fixture project/ }).first().waitFor();
  assert.ok(releaseFeature); (releaseFeature as () => void)();
  await page.evaluate(async () => { await window.productWorkspaceHarness.status(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  assert.equal(new URL(page.url()).pathname, '/projects');

  await show('/projects');
  await page.getByRole('button', { name: /Fixture project/ }).first().waitFor();
  await page.getByRole('button', { name: 'Expand Fixture project' }).click();
  await page.getByRole('button', { name: 'Fixture chat' }).click();
  assert.deepEqual(await page.evaluate(() => window.productWorkspaceHarness.calls.find(call => call.kind === 'open-thread')?.value),
    { hostId: 'local', threadId: 'fixture-thread', archived: false });
  await show('/projects?projectId=example#overview');
  await page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  assert.ok(bridge.some(url => url.includes('/gizmos/example')));
  assert.equal(new URL(page.url()).hash, '#overview');

  await show('/select-workspace');
  await page.getByRole('checkbox', { name: /\/fixture\/project/ }).check();
  await page.evaluate(() => window.productWorkspaceHarness.failNavigation());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic navigation failure' }).waitFor();
  assert.equal((await page.evaluate(() => window.productWorkspaceHarness.calls.filter(call => call.kind === 'project-saved'))).length, 1);
  assert.match(await readFile(join(dataDir, 'native-state.json'), 'utf8'), /fixture\/project/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Fixture skill/ }).waitFor();
  assert.equal((await page.evaluate(() => window.productWorkspaceHarness.calls.filter(call => call.kind === 'project-saved'))).length, 1);

  await show('/first-run');
  await page.getByRole('heading', { name: 'Before you continue' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.productWorkspaceHarness.calls.some(call => call.kind === 'first-run'));
  const firstRunState = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')) as { globals: Record<string, unknown> };
  assert.equal(firstRunState.globals['viewed2025-09-15-nux'], true);
  assert.equal(firstRunState.globals['viewed2025-09-15-apikey-auth-nux'], true);

  await show('/scheduled?view=manage&automationId=task-42&automationSource=local#details');
  await page.getByRole('alert').filter({ hasText: 'list-automations' }).first().waitFor();
  assert.ok(peer.calls('experimentalFeature/list').some(call => call.params.cursor === 'next'));
  assert.equal(new URL(page.url()).hash, '#details');
  localAutomation = false;
  await show('/scheduled');
  await page.waitForFunction(() => window.location.pathname === '/');
  localAutomation = true;
  await show('/agents/a/fixture-agent');
  await page.getByRole('heading', { name: 'Open this agent in ChatGPT' }).waitFor();
  assert.ok(!bridge.some(url => url.includes('/hermes/')));

  holdRemote = true;
  const enteredRemote = new Promise<void>(resolve => { remoteEntered = resolve; });
  await show('/skills?hostId=remote-ssh-fixture'); await waitForEntered(enteredRemote, 'remote skill read');
  await show('/skills'); await page.getByRole('button', { name: /Fixture skill/ }).waitFor();
  assert.ok(releaseRemote); (releaseRemote as () => void)();
  assert.equal(await page.getByRole('button', { name: /Remote skill/ }).count(), 0);

  mode = 'chatgpt'; peer.broadcast({ method: 'account/updated', params: {} });
  await page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  assert.ok(bridge.some(url => url.includes('/wham/accounts/check')));
  const accountChecks = bridge.filter(url => url.includes('/wham/accounts/check')).length;
  await Promise.all([page.waitForResponse(response => response.url() === app.url + '/api/http-fetch'),
    page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()]);
  assert.ok(bridge.filter(url => url.includes('/wham/accounts/check')).length > accountChecks);
  assert.equal((await page.evaluate(() => window.productWorkspaceHarness.status()) as { authToken: unknown }).authToken, null);
  await show('/first-run');
  await page.getByRole('heading', { name: 'Before you continue' }).waitFor();

  mode = 'signed-out'; peer.broadcast({ method: 'account/updated', params: {} });
  await page.getByRole('heading', { name: 'Sign in to Codex' }).waitFor();
  mode = 'unknown'; peer.broadcast({ method: 'account/updated', params: {} });
  await page.getByRole('alert').filter({ hasText: 'The account type could not be verified.' }).waitFor();
  mode = 'apiKey'; peer.broadcast({ method: 'account/updated', params: {} });
  await show('/skills'); await page.getByRole('button', { name: /Fixture skill/ }).waitFor();
  holdAccount = true;
  const enteredAccount = new Promise<void>(resolve => { accountEntered = resolve; });
  await show('/skills'); await waitForEntered(enteredAccount, 'account read');
  await show('/projects'); await page.getByRole('button', { name: /Fixture project/ }).first().waitFor();
  assert.ok(releaseAccount); (releaseAccount as () => void)();
  assert.equal(await page.getByRole('button', { name: /Fixture skill/ }).count(), 0);

  if (extendController) {
    await show('/plugins');
    await page.getByRole('button', { name: /Fixture plugin/ }).first().click();
    const lostWriteCount = peer.calls('config/batchWrite').length;
    peer.handlers.set('config/batchWrite', (_params, context) => { context.socket.terminate(); return NO_REPLY; });
    await page.getByRole('dialog').getByRole('checkbox', { name: 'Enabled' }).click();
    try { await page.getByRole('alert').filter({ hasText: /Could not confirm the change|A plugin change needs verification|connection was lost/ }).first().waitFor(); }
    catch (error) { console.error('Unknown plugin configuration result:', await page.locator('body').innerText(), peer.calls('config/batchWrite'), errors); throw error; }
    await show('/plugins');
    await page.getByRole('alert').filter({ hasText: 'A plugin change needs verification' }).waitFor();
    await page.getByRole('button', { name: /Fixture plugin/ }).first().click();
    assert.equal(await page.getByRole('dialog').getByRole('checkbox', { name: 'Enabled' }).isEnabled(), false);
    assert.equal(peer.calls('config/batchWrite').length, lostWriteCount + 1);
  }
  assert.equal(externalRequests, 0);
  assert.ok(frames.every(frame => !frame.includes('synthetic-secret')));
  assert.deepEqual(errors, []);
});
