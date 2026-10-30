import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { fileMethods } from '../src/native/files.ts';
import { createFakeCodex, fixtureThread } from './fake-codex.ts';
import { fileDaemonFixture } from './file-daemon-fixture.ts';
import { nativeFixture } from './native-fixture.ts';
import type {} from './renderer-product-pages-fixture.tsx';

const chrome = '/usr/bin/google-chrome';

test('product parent connects real host reads, guarded writes and rejected product requests', { skip: !existsSync(chrome), timeout: 120_000 }, async t => {
  const directory = await mkdtemp('/tmp/ygp-test-');
  const local = await createFakeCodex(directory);
  const remoteDir = join(directory, 'remote'); await mkdir(remoteDir);
  const remote = await createFakeCodex(remoteDir);
  const localCodexHome = join(directory, 'codex'), remoteCodexHome = join(remoteDir, 'codex');
  await mkdir(localCodexHome); await mkdir(remoteCodexHome);
  local.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome: localCodexHome }));
  remote.handlers.set('initialize', () => ({ userAgent: 'codex/fixture', codexHome: remoteCodexHome }));
  const fileRpc = fileDaemonFixture();
  for (const method of fileMethods) local.handlers.set(method, params => fileRpc(method, params));
  const skillFile = join(directory, 'SKILL.md'); await writeFile(skillFile, 'Synthetic skill instructions');
  const skill = (name: string, path: string) => ({ name, path, description: 'Synthetic description', scope: 'user', enabled: true });
  local.handlers.set('skills/list', params => ({ data: [{ cwd: '/local/project', skills: [skill('Local skill', skillFile)], errors: [] }], params }));
  let releaseRemote: (() => void) | null = null, holdRemote = false;
  remote.handlers.set('skills/list', async () => {
    if (holdRemote) await new Promise<void>(resolve => { releaseRemote = resolve; });
    return { data: [{ cwd: '/remote/project', skills: [skill('Remote skill', '/remote/SKILL.md')], errors: [] }] };
  });
  const plugin = { id: 'fixture-plugin', name: 'fixture-plugin', installed: true, enabled: true, installPolicy: 'AVAILABLE', source: { type: 'local' },
    interface: { displayName: 'Fixture plugin', shortDescription: 'Synthetic plugin' } };
  for (const peer of [local, remote]) {
    peer.handlers.set('plugin/installed', () => ({ marketplaces: [{ name: 'Fixture', path: '/fixture/marketplace', plugins: [plugin] }] }));
    peer.handlers.set('plugin/list', () => ({ marketplaces: [] }));
    peer.handlers.set('plugin/read', () => ({ plugin: { summary: plugin, marketplaceName: 'Fixture', marketplacePath: '/fixture/marketplace',
      apps: [], skills: [], mcpServers: [], hooks: [] } }));
  }
  local.threads.set('local-thread', fixtureThread('local-thread', '/local/project', { name: 'Local chat' }));
  for (let index = 0; index < 100; index++) remote.threads.set(`remote-${index}`, fixtureThread(`remote-${index}`, '/elsewhere', { name: `Other ${index}`, updatedAt: 1_800_000_000 + index }));
  remote.threads.set('remote-needle', fixtureThread('remote-needle', '/remote/project', { name: 'Needle chat', updatedAt: 1_700_000_000 }));
  const dataDir = join(directory, 'data'); await mkdir(dataDir);
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ path: '/local/project', name: 'Local project' }]));
  const { renderer, adapterPath } = await nativeFixture(directory);
  let externalRequests = 0;
  const app = await createNativeWorkbench({ socketPath: local.socketPath, codexHome: localCodexHome, dataDir, workspace: directory,
    renderer, adapterPath, port: 0, hostCatalog: { hosts: [{ hostId: 'remote-ssh-fixture', displayName: 'Synthetic SSH', sshAlias: null,
      sshHost: 'synthetic', sshPort: null, identity: null }], projects: [{ id: 'remote-project', hostId: 'remote-ssh-fixture', label: 'Remote project', remotePath: '/remote/project' }], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: remoteDir, codexHome: remoteCodexHome }); return connect(remote.socketPath); },
    httpFetch: async () => { externalRequests++; throw new Error('Unexpected external HTTP'); } });
  const upgrades: unknown[] = [];
  app.server.prependListener('upgrade', request => { upgrades.push({ url: request.url, host: request.headers.host, origin: request.headers.origin, site: request.headers['sec-fetch-site'] }); });
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  t.after(async () => { await browser.close(); await app.close(); await remote.close(); await local.close(); await rm(directory, { recursive: true, force: true }); });
  const alternateClient = process.env.PRODUCT_PAGES_TEST_CLIENT;
  const bundle = await build({ entryPoints: ['test/renderer-product-pages-fixture.tsx'], bundle: true, write: false,
    outdir: 'product-pages-test-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
    plugins: alternateClient ? [{ name: 'fixed-manager-client', setup(builder) {
      builder.onLoad({ filter: /\/src\/renderer\/app\/client\.ts$/ }, async args => ({ contents: await readFile(alternateClient, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] : [] });
  await writeFile(join(renderer, 'workbench-entry.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.contents);
  await writeFile(join(renderer, 'workbench-entry.css'), bundle.outputFiles.find(file => file.path.endsWith('.css'))!.contents);
  const context = await browser.newContext({ viewport: { width: 800, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const bridge: { url: string; method: string }[] = [];
  const requests: { type?: string; hostId?: string; url?: string; request?: { method?: string; params?: Record<string, unknown> } }[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    try { requests.push(JSON.parse(String(frame.payload))); } catch { /* Ignore non-JSON control frames. */ }
  }));
  page.on('request', request => { if (request.url() === app.url + '/api/http-fetch') {
    const wire = request.postDataJSON() as { url: string; method: string }; bridge.push({ url: wire.url, method: wire.method });
  } });
  const errors: string[] = [], browserErrors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== app.url && url.origin !== app.url.replace('http:', 'ws:')) return route.abort();
    return route.continue();
  });
  await page.goto(app.url + '/');
  await page.evaluate(() => window.productPagesHarness.connect());
  const show = async (url: string, state?: unknown) => page.evaluate(({ url, state }) => window.productPagesHarness.show(url, state), { url, state });

  await show('/projects');
  try { await page.getByRole('button', { name: /Local project/ }).first().waitFor(); }
  catch (error) { console.error('First project page:', await page.locator('body').innerText(), 'browser errors:', browserErrors, 'page errors:', errors, 'upgrades:', upgrades, 'origin:', app.url); throw error; }
  await page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  assert.ok(bridge.some(value => value.url.includes('/gizmos/snorlax/sidebar') && value.method === 'GET'));
  await page.getByRole('button', { name: 'Expand Local project' }).click();
  await page.getByRole('button', { name: 'Local chat' }).click();
  assert.deepEqual(await page.evaluate(() => window.productPagesHarness.calls.find(value => value.kind === 'open-thread')?.value),
    { hostId: 'local', threadId: 'local-thread', archived: false });

  await show('/projects?hostId=remote-ssh-fixture');
  await page.getByRole('button', { name: /Remote project/ }).first().waitFor();
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('Needle');
  await page.getByRole('button', { name: 'Show more chats' }).waitFor();
  assert.ok(remote.calls('thread/list').some(value => value.params.cursor === '100'));
  await page.getByRole('button', { name: 'Needle chat' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Show more chats' }).click();
  await page.getByRole('button', { name: 'Needle chat' }).click();
  assert.deepEqual(await page.evaluate(() => window.productPagesHarness.calls.filter(value => value.kind === 'open-thread').at(-1)?.value),
    { hostId: 'remote-ssh-fixture', threadId: 'remote-needle', archived: false });

  holdRemote = true;
  await show('/skills?hostId=remote-ssh-fixture');
  try { await remote.waitForCall('skills/list'); }
  catch (error) {
    console.error('Remote skill request did not reach the daemon:', await page.locator('body').innerText(),
      'remote methods:', remote.messages.map(message => message.method).filter(Boolean));
    throw error;
  }
  await show('/skills');
  await page.getByRole('button', { name: /Local skill/ }).waitFor();
  assert.ok(releaseRemote); (releaseRemote as () => void)();
  await page.getByRole('button', { name: /Local skill/ }).click();
  await page.getByText('Synthetic skill instructions').waitFor();
  assert.equal(await page.getByText('Remote skill').count(), 0);
  await page.getByRole('button', { name: 'Open file' }).click();
  assert.deepEqual(await page.evaluate(() => window.productPagesHarness.calls.find(value => value.kind === 'open-file')?.value),
    { hostId: 'local', cwd: '/local/project', path: skillFile });

  await show('/plugins?hostId=remote-ssh-fixture');
  await page.getByRole('alert').filter({ hasText: 'Could not load public categories' }).waitFor();
  assert.ok(bridge.some(value => value.url.includes('/ps/plugins/home')));
  await page.getByRole('button', { name: /Fixture plugin/ }).first().click();
  await page.getByRole('dialog').getByText('Fixture plugin').first().waitFor();
  assert.ok(remote.calls('plugin/read').length > 0);
  await page.getByRole('button', { name: 'Close plugin details' }).click();
  await page.getByRole('button', { name: 'Personal' }).click();
  const pluginFailure = page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).first();
  await pluginFailure.waitFor();
  const beforeRetry = bridge.length;
  await Promise.all([page.waitForResponse(response => response.url() === app.url + '/api/http-fetch'), pluginFailure.getByRole('button', { name: 'Retry' }).click()]);
  assert.ok(bridge.length > beforeRetry);
  assert.ok(bridge.some(value => value.url.includes('/ps/plugins/workspace/created')));
  assert.ok(bridge.some(value => value.url.includes('/ps/plugins/list?scope=USER')));
  assert.ok(bridge.some(value => value.url.includes('/ps/plugins/workspace/shared')));

  await show('/plugins?hostId=remote-ssh-fixture&directory=workspace');
  await page.getByRole('button', { name: 'Workspace', pressed: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  assert.ok(bridge.some(value => value.url.includes('/ps/plugins/list?scope=WORKSPACE')));
  await page.getByRole('searchbox', { name: 'Search plugins' }).fill('workspace search');
  await page.getByRole('alert').filter({ hasText: 'plugin/search' }).waitFor();
  assert.ok(requests.some(value => value.type === 'mcp-request' && value.hostId === 'remote-ssh-fixture' &&
    value.request?.method === 'plugin/search' && value.request.params?.scope === 'workspace'));
  const searchCount = requests.length;
  await page.getByRole('button', { name: 'Public', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'plugin/search' }).waitFor();
  assert.ok(requests.slice(searchCount).some(value => value.request?.method === 'plugin/search' && value.request.params?.scope === 'global'));
  await page.evaluate(() => window.productPagesHarness.setWorkspaceDirectory('unknown'));
  await show('/plugins?hostId=remote-ssh-fixture&directory=workspace&search=guarded');
  const beforeGuardedSearch = requests.filter(value => value.request?.method === 'plugin/search').length;
  await page.getByRole('alert').filter({ hasText: 'Workspace plugin access has not been established.' }).waitFor();
  assert.equal(requests.filter(value => value.request?.method === 'plugin/search').length, beforeGuardedSearch);
  await page.evaluate(() => window.productPagesHarness.setWorkspaceDirectory('allowed'));
  await show('/plugins?hostId=remote-ssh-fixture&category=engineering&search=tools');
  await page.getByRole('heading', { name: /engineering/ }).waitFor();
  await page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  assert.ok(bridge.some(value => value.url.includes('/ps/plugin-categories/engineering/plugins?scope=GLOBAL&q=tools')));

  await show('/projects?hostId=remote-ssh-fixture&projectId=cloud-1#fragment', { original: true });
  await page.getByTestId('project-composer').waitFor();
  await page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  const composer = JSON.parse(await page.getByTestId('project-composer').innerText()) as { request: { projectId: string; hostId: string; location: { hash: string; state: unknown } } };
  assert.equal(composer.request.projectId, 'cloud-1'); assert.equal(composer.request.hostId, 'remote-ssh-fixture');
  assert.equal(composer.request.location.hash, '#fragment'); assert.deepEqual(composer.request.location.state, { original: true });
  const detailCount = bridge.filter(value => value.url.includes('/gizmos/cloud-1')).length;
  await Promise.all([page.waitForResponse(response => response.url() === app.url + '/api/http-fetch'), page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()]);
  assert.ok(bridge.filter(value => value.url.includes('/gizmos/cloud-1')).length > detailCount);

  await show('/agents/a/agent-42?hostId=remote-ssh-fixture');
  await page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  assert.ok(bridge.some(value => value.url.includes('/hermes/agent/agent-42/detail-view')));
  await show('/agents/studio/edit/agent-42?hostId=remote-ssh-fixture');
  const agentError = page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' });
  await agentError.waitFor();
  assert.ok(bridge.some(value => value.url.includes('/hermes/agent/agent-42/builder-view')));
  const agentRetries = bridge.filter(value => value.url.includes('/hermes/agent/agent-42/builder-view')).length;
  await Promise.all([page.waitForResponse(response => response.url() === app.url + '/api/http-fetch'), agentError.getByRole('button', { name: 'Retry' }).click()]);
  assert.equal(bridge.filter(value => value.url.includes('/hermes/agent/agent-42/builder-view')).length, agentRetries + 1);
  await page.evaluate(() => window.productPagesHarness.setAgentMismatch(true));
  await show('/agents/a/agent-43?hostId=remote-ssh-fixture');
  await page.getByText('Workspace agent is unavailable for this account.').waitFor();
  assert.equal(bridge.some(value => value.url.includes('/hermes/agent/agent-43/')), false);
  await page.evaluate(() => window.productPagesHarness.setAgentMismatch(false));
  await page.evaluate(() => window.productPagesHarness.setAgentEnabled(false));
  await show('/agents/a/agent-44?hostId=remote-ssh-fixture');
  await page.getByText('Workspace agent is unavailable for this account.').waitFor();
  assert.equal(bridge.some(value => value.url.includes('/hermes/agent/agent-44/')), false);
  await page.evaluate(() => window.productPagesHarness.setAgentEnabled(true));

  await show('/scheduled?hostId=remote-ssh-fixture&view=manage&automationId=task-42&automationSource=cloud#part');
  const taskFailure = page.getByRole('alert').filter({ hasText: 'Could not load this task' });
  await taskFailure.waitFor();
  assert.ok(bridge.some(value => value.url.includes('/automation/task-42')));
  const beforeTaskRetry = bridge.filter(value => value.url.includes('/automation/task-42')).length;
  await Promise.all([page.waitForResponse(response => response.url() === app.url + '/api/http-fetch'), taskFailure.getByRole('button', { name: 'Retry task' }).click()]);
  assert.equal(bridge.filter(value => value.url.includes('/automation/task-42')).length, beforeTaskRetry + 1);
  await show('/scheduled?hostId=remote-ssh-fixture&shared_task=post-42#part', { from: 'share' });
  const share = page.getByRole('dialog');
  await share.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' }).waitFor();
  assert.ok(bridge.some(value => value.url.includes('/share/post/post-42/automation')));
  await share.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => window.productPagesHarness.currentUrl() === '/scheduled?hostId=remote-ssh-fixture#part');

  await page.evaluate(() => window.productPagesHarness.setAuthMethod('apiKey'));
  const beforeApiKey = bridge.length;
  await show('/plugins?directory=personal');
  await page.getByRole('alert').filter({ hasText: 'Sign in with ChatGPT to view personal plugins.' }).waitFor();
  assert.equal(bridge.length, beforeApiKey);
  await show('/plugins?category=engineering');
  const publicError = page.getByRole('alert').filter({ hasText: '当前 HTTP 宿主支持原版功能配置与事件端点' });
  await publicError.waitFor();
  assert.equal(bridge.length, beforeApiKey + 1);
  assert.ok(bridge.at(-1)?.url.includes('/ps/plugin-categories/engineering/plugins'));
  await Promise.all([page.waitForResponse(response => response.url() === app.url + '/api/http-fetch'),
    publicError.getByRole('button', { name: 'Retry' }).click()]);
  assert.equal(bridge.length, beforeApiKey + 2);
  const afterPublic = bridge.length;
  await show('/projects');
  await page.getByRole('button', { name: 'Expand Local project' }).waitFor();
  assert.equal(bridge.length, afterPublic);
  await show('/first-run');
  const statePath = join(dataDir, 'native-state.json');
  const stateBefore = await readFile(statePath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  const hostWritesBefore = requests.filter(value => value.type === 'fetch' && value.url === 'vscode://codex/set-global-state').length;
  await page.evaluate(() => window.productPagesHarness.holdHostSend());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.productPagesHarness.calls.some(value => value.kind === 'host-send-wait'));
  await page.evaluate(() => { window.productPagesHarness.revoke(); window.productPagesHarness.releaseHostSend(); });
  await page.getByRole('alert').filter({ hasText: 'The selected page changed.' }).waitFor();
  assert.equal(requests.filter(value => value.type === 'fetch' && value.url === 'vscode://codex/set-global-state').length, hostWritesBefore);
  assert.equal(await readFile(statePath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; }), stateBefore);
  if (alternateClient) {
    await show('/first-run');
    await page.evaluate(() => window.productPagesHarness.revokeAtHostDispatch());
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('alert').filter({ hasText: 'The selected page changed.' }).waitFor();
    assert.equal(requests.filter(value => value.type === 'fetch' && value.url === 'vscode://codex/set-global-state').length, hostWritesBefore);
    assert.equal(await readFile(statePath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; }), stateBefore);
  }
  await show('/first-run');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.productPagesHarness.calls.some(value => value.kind === 'first-run-complete'));
  const saved = JSON.parse(await readFile(statePath, 'utf8')) as { globals: Record<string, unknown> };
  assert.equal(saved.globals['viewed2025-09-15-nux'], true); assert.equal(saved.globals['viewed2025-09-15-apikey-auth-nux'], true);

  await show('/select-workspace');
  await page.getByText('/local/project').waitFor();
  await page.locator('label').filter({ hasText: '/local/project' }).getByRole('checkbox').check();
  await page.evaluate(() => window.productPagesHarness.holdCommit());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.productPagesHarness.calls.some(value => value.kind === 'workspace-prepare'));
  await page.evaluate(() => { window.productPagesHarness.revoke(); window.productPagesHarness.releaseCommit(); });
  await page.getByRole('alert').getByText('Changed owner').waitFor();
  assert.equal(await page.evaluate(() => window.productPagesHarness.calls.filter(value => value.kind === 'workspace-saved').length), 0);

  await show('/select-workspace');
  await page.getByText('/local/project').waitFor();
  await page.locator('label').filter({ hasText: '/local/project' }).getByRole('checkbox').check();
  await page.evaluate(() => window.productPagesHarness.failNextNavigation());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('alert').getByText('Could not continue').waitFor();
  const writes = await page.evaluate(() => window.productPagesHarness.calls.filter(value => value.kind === 'workspace-saved').length);
  assert.equal(writes, 1);
  const workspaceSaved = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')) as { globals: { 'local-projects': Record<string, { name: string }> } };
  assert.equal(workspaceSaved.globals['local-projects']['/local/project']?.name, 'project');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.productPagesHarness.currentUrl().startsWith('/?hostId=local'));
  assert.equal(await page.evaluate(() => window.productPagesHarness.calls.filter(value => value.kind === 'workspace-saved').length), writes);

  await show('/plan-summary', { hostId: 'local', conversationId: 'plan-thread', planContent: '# Plan text\n\n[Open](./plan.md)' });
  await page.getByRole('heading', { name: 'Plan text' }).waitFor();
  await page.getByRole('button', { name: 'Open' }).click();
  assert.deepEqual(await page.evaluate(() => window.productPagesHarness.calls.filter(value => value.kind === 'open-file').at(-1)?.value),
    { hostId: 'local', cwd: '/plan/conversation', path: '/plan/conversation/./plan.md' });
  assert.equal(externalRequests, 0);
  assert.deepEqual(errors, []);
});
