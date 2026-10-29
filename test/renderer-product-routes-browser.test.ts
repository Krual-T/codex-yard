import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { configurationRequest, httpFailure } from '../src/native/http-fetch.ts';
import type {} from './renderer-product-routes-fixture.tsx';

const chrome = '/usr/bin/google-chrome';

test('review: redirects retain the host parsed from the destination URL', {
  skip: !existsSync(chrome) && 'An isolated headless browser is unavailable', timeout: 30_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-product-routes-fixture.tsx'], bundle: true, write: false,
    outdir: 'route-review-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:49007/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    await page.goto('http://127.0.0.1:49007/');
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    await page.evaluate(() => window.productRouteHarness.showFromUrl('/explore?hostId=ssh'));
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate'));
    assert.equal(await page.evaluate(() => window.productRouteHarness.currentHost()), 'ssh');
    const navigation = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'navigate')?.data);
    assert.deepEqual(navigation, { path: '/?hostId=ssh', options: { replace: true, state: undefined } });
  } finally { await browser.close(); }
});

test('review: a failed optional project detail does not remove the authorized composer', {
  skip: !existsSync(chrome) && 'An isolated headless browser is unavailable', timeout: 30_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-product-routes-fixture.tsx'], bundle: true, write: false,
    outdir: 'route-review-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:49007/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    await page.goto('http://127.0.0.1:49007/');
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    await page.evaluate(() => window.productRouteHarness.showFromUrl('/projects?projectId=alpha&hostId=ssh'));
    await page.getByRole('alert').getByText('fixture project detail rejection', { exact: false }).waitFor();
    assert.equal(await page.getByTestId('project-composer').count(), 1);
  } finally { await browser.close(); }
});

test('real product route composition keeps host, parameters, guards, errors and late reads scoped', {
  skip: !existsSync(chrome) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-product-routes-fixture.tsx'], bundle: true, write: false,
    outdir: 'route-test-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:49007/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:49007/');
    await page.addStyleTag({ content: 'html,body,#root{height:100%;margin:0}' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'projects' && call.hostId === 'old'));
    await page.evaluate(() => window.productRouteHarness.show('/projects?hostId=new', 'new'));
    await page.getByRole('alert').getByText('fixture projects failure', { exact: false }).waitFor();
    await page.evaluate(() => window.productRouteHarness.resolveOld());
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.getByText('Current project').waitFor();
    assert.equal(await page.getByText('Stale project').count(), 0);
    await page.evaluate(() => window.productRouteHarness.show('/projects?hostId=same', 'same'));
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'projects' && call.hostId === 'same' && (call.data as { sessionKey?: string }).sessionKey === 'session-same-1'));
    await page.evaluate(() => window.productRouteHarness.setGeneration(2));
    await page.getByText('Current generation project').waitFor();
    await page.evaluate(() => window.productRouteHarness.resolveOld());
    assert.equal(await page.getByText('Stale generation project').count(), 0);
    await page.evaluate(() => window.productRouteHarness.show('/projects?projectId=&hostId=new#details', 'new', { origin: 'fixture' }));
    const unresolved = page.getByTestId('unresolved');
    await page.getByRole('alert').getByText('fixture empty project ID', { exact: false }).waitFor();
    const project = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'project-detail'));
    assert.equal(project?.hostId, 'new');
    assert.equal((project?.data as { projectId: string }).projectId, '');

    const skillsBefore = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'skills/list').length);
    await page.evaluate(() => window.productRouteHarness.show('/skills?host=other', 'new'));
    assert.equal(JSON.parse(await unresolved.innerText()).reason, 'host-mismatch');
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'skills/list').length), skillsBefore);
    await page.evaluate(() => window.productRouteHarness.show('/skills?hostId=new', 'new'));
    await page.getByText('Synthetic skill').first().waitFor();
    const skill = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'skills/list'));
    assert.equal(skill?.hostId, 'new');
    assert.deepEqual(skill?.data, { cwds: ['/work'], forceReload: false });
    await page.evaluate(() => window.productRouteHarness.show('/plugins?hostId=new', 'new'));
    await page.getByRole('alert').getByText('fixture installed failure', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Personal', exact: true }).click();
    await page.getByText('fixture HTTP allowlist rejection', { exact: false }).first().waitFor();
    const personalBefore = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'personal-plugins').length);
    await page.getByRole('alert').filter({ hasText: 'fixture HTTP allowlist rejection' }).first().getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'personal-plugins').length > count, personalBefore);
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(false));
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByRole('alert').getByText('Navigation was not completed.').waitFor();
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByText('Synthetic skill').first().waitFor();
    const navigations = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate'));
    assert.deepEqual((navigations.at(-1)?.data as { path: string }).path, '/skills?hostId=new');

    await page.evaluate(() => window.productRouteHarness.show('/agents/a/agent%2F42?hostId=new', 'new'));
    await page.getByRole('alert').getByText('fixture detail failure', { exact: false }).waitFor();
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('heading', { name: 'Synthetic agent' }).waitFor();
    const agent = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'agent-detail'));
    assert.equal(agent?.hostId, 'new'); assert.equal(agent?.data, 'agent/42');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('heading', { name: 'Workspace Agents' }).waitFor();
    await page.getByText('fixture HTTP allowlist rejection', { exact: false }).first().waitFor();

    await page.evaluate(() => window.productRouteHarness.show('/agents/studio/edit/agent%2F42?hostId=new', 'new'));
    await page.getByRole('heading', { name: 'Agent configuration' }).waitFor();
    await page.getByText('Agent configuration is unavailable on this host.').waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'editor-back'));
    const editorBack = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'editor-back'));
    assert.equal(editorBack?.hostId, 'new'); assert.deepEqual(editorBack?.data, { agentId: 'agent/42', dirty: false });
    await page.evaluate(() => window.productRouteHarness.show('/agents/studio/new?hostId=new', 'new'));
    await page.getByRole('heading', { name: 'Create agent' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start blank' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('heading', { name: 'Workspace Agents' }).waitFor();

    await page.evaluate(() => window.productRouteHarness.show('/first-run?hostId=new', 'new'));
    await page.getByRole('heading', { name: 'Before you continue' }).waitFor();
    await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
    await page.evaluate(() => window.productRouteHarness.show('/select-workspace?hostId=new', 'new'));
    await page.getByRole('heading', { name: 'Select a project' }).waitFor();
    await page.getByRole('alert').getByText('fixture host rejection: workspace-root-options', { exact: false }).waitFor();
    assert.ok(await page.evaluate(() => window.productRouteHarness.calls.some(call => call.method === 'workspace-root-options' && call.hostId === 'new')));

    await page.evaluate(() => window.productRouteHarness.show('/plan-summary', 'new', { hostId: 'new', conversationId: 'thread-1', planContent: '# Scoped plan' }));
    await page.getByRole('heading', { name: 'Scoped plan' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.show('/plan-summary', 'new', { hostId: 'other', conversationId: 'thread-2', planContent: '# Wrong owner' }));
    assert.equal(JSON.parse(await unresolved.innerText()).reason, 'host-mismatch');
    assert.equal(await page.getByRole('heading', { name: 'Wrong owner' }).count(), 0);

    await page.evaluate(() => { window.productRouteHarness.setAccess('scheduled'); window.productRouteHarness.showFromUrl('/automations?hostId=new&view=shared_task&automationId=a%2Fb#part', { from: 'chat' }); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new&view=shared_task&automationId=a%2Fb#part'));
    const redirect = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'navigate' && (call.data as { path?: string }).path?.startsWith('/scheduled')));
    assert.deepEqual((redirect?.data as { options: unknown }).options, { replace: true, state: { from: 'chat' } });
    await page.getByText('fixture host rejection: list-automations', { exact: false }).waitFor();
    await page.evaluate(() => { window.productRouteHarness.setAccess('allow'); window.productRouteHarness.show('/scheduled?hostId=new', 'new'); });
    await page.getByText('fixture host rejection: list-automations', { exact: false }).waitFor();
    const loadBefore = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'list-automations').length);
    await page.getByRole('alert').filter({ hasText: 'fixture host rejection: list-automations' }).getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'list-automations').length > count, loadBefore);
    assert.ok(await page.evaluate(() => window.productRouteHarness.calls.some(call => call.method === 'list-automations' && call.hostId === 'new')));
    await page.evaluate(() => { window.productRouteHarness.setNavigationAllowed(false); window.productRouteHarness.showFromUrl('/inbox?hostId=new'); });
    await page.getByRole('alert').getByText('Navigation was not completed.').waitFor();
    const inboxAttempts = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/automations?hostId=new').length);
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/automations?hostId=new').length > count, inboxAttempts);
    await page.evaluate(() => window.productRouteHarness.show('/explore?hostId=new#x', 'new', { old: true }));
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/?hostId=new'));
    const homeRedirect = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/?hostId=new'));
    assert.equal((homeRedirect?.data as { options: { replace: boolean } }).options.replace, true);
    assert.equal((homeRedirect?.data as { options: { state?: unknown } }).options.state, undefined);

    await page.evaluate(() => window.productRouteHarness.show('/space/file/example?hostId=new#x', 'new'));
    const other = JSON.parse(await unresolved.innerText());
    assert.equal(other.reason, 'other'); assert.equal(other.route.location.pathname, '/space/file/example');
    await page.evaluate(() => { window.productRouteHarness.setAuth('required'); window.productRouteHarness.show('/skills', 'new'); });
    await page.getByRole('heading', { name: 'Sign in to Codex' }).waitFor();
    assert.ok(await page.evaluate(() => window.productRouteHarness.calls.some(call => call.method === 'account/read' && call.hostId === 'new')));
    await page.evaluate(() => { window.productRouteHarness.setAuth('ready'); window.productRouteHarness.show('/login', 'new'); });
    await page.getByRole('heading', { name: 'Sign in to Codex' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.setAccess('app'));
    assert.equal(JSON.parse(await unresolved.innerText()).reason, 'app');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('project homes, legacy agents and scheduled parameter views use scoped consumers', {
  skip: !existsSync(chrome) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({ entryPoints: ['test/renderer-product-routes-fixture.tsx'], bundle: true, write: false,
    outdir: 'route-test-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const baselineRequests: { url: string; method: string; headers?: Record<string, string> }[] = [];
    await page.route('**/*', async route => {
      if (route.request().url() === 'http://127.0.0.1:49007/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' });
      if (route.request().url() !== 'http://127.0.0.1:49007/api/http-fetch') return route.abort();
      const request = route.request().postDataJSON() as { url: string; method: string; headers?: Record<string, string> };
      baselineRequests.push(request);
      let failure: unknown;
      try { configurationRequest(request); } catch (error) { failure = error; }
      if (!failure) return route.fulfill({ status: 500, body: 'Unexpectedly allowed product endpoint' });
      return route.fulfill({ status: 502, headers: { 'Content-Type': 'application/json', 'X-Workbench-Fetch-Error': '1' }, body: JSON.stringify(httpFailure(failure)) });
    });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.goto('http://127.0.0.1:49007/');
    await page.addStyleTag({ content: 'html,body,#root{height:100%;margin:0}' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    await page.evaluate(() => window.productRouteHarness.show('/projects?projectId=alpha&hostId=new#part', 'new', { from: 'chat' }));
    await page.getByRole('alert').getByText('fixture project detail rejection', { exact: false }).waitFor();
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('heading', { name: 'Project composer: Project alpha' }).waitFor();
    const composer = JSON.parse(await page.getByTestId('project-composer').innerText());
    assert.deepEqual(composer, { hostId: 'new', projectId: 'alpha', location: { pathname: '/projects', search: '?projectId=alpha&hostId=new', hash: '#part', state: { from: 'chat' } } });
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(false));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('alert').getByText('Navigation was not completed.').waitFor();
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const projectBack = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data);
    assert.deepEqual(projectBack, { path: '/projects?projectId=alpha&hostId=new#part', options: { delta: -1 } });
    await page.evaluate(() => window.productRouteHarness.show('/projects?projectId=alias&hostId=new', 'new'));
    await page.getByRole('heading', { name: 'Project composer: Project alias' }).waitFor();
    assert.equal(await page.getByTestId('canonical-project').innerText(), 'canonical');
    await page.evaluate(() => window.productRouteHarness.show('/projects?projectId=slow&hostId=old', 'old'));
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'project-detail' && (call.data as { projectId?: string }).projectId === 'slow'));
    await page.evaluate(() => window.productRouteHarness.show('/projects?projectId=fast&hostId=new', 'new'));
    await page.getByRole('heading', { name: 'Project composer: Project fast' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.resolveDetail());
    assert.equal(await page.getByRole('heading', { name: 'Project composer: Project slow' }).count(), 0);
    const priorSlowReads = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'project-detail' && (call.data as { projectId?: string }).projectId === 'slow').length);
    await page.evaluate(() => window.productRouteHarness.show('/projects?projectId=slow&hostId=new#same', 'new', { from: 'first' }));
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'project-detail' && (call.data as { projectId?: string }).projectId === 'slow').length > count, priorSlowReads);
    await page.evaluate(() => window.productRouteHarness.show('/projects?projectId=slow&hostId=new#same', 'new', { from: 'second' }));
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'project-detail' && (call.data as { projectId?: string }).projectId === 'slow').length > count + 1, priorSlowReads);
    await page.evaluate(async () => { window.productRouteHarness.resolveDetail(); await new Promise(requestAnimationFrame); });
    assert.equal(await page.getByRole('heading', { name: 'Project composer: Project slow' }).count(), 0);
    await page.evaluate(() => window.productRouteHarness.resolveDetail());
    await page.getByRole('heading', { name: 'Project composer: Project slow' }).waitFor();
    assert.deepEqual(JSON.parse(await page.getByTestId('project-composer').innerText()).location.state, { from: 'second' });

    await page.evaluate(() => { window.productRouteHarness.setAccess('legacy'); window.productRouteHarness.show('/agents/a/agent%2F42?hostId=new#part', 'new', { from: 'route' }); });
    await page.getByRole('heading', { name: 'Open this agent in ChatGPT' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open in ChatGPT' }).getAttribute('href'), 'https://chatgpt.com/agents/a/agent%2F42');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const legacyBack = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data);
    assert.deepEqual(legacyBack, { path: '/agents/a/agent%2F42?hostId=new#part', options: { delta: -1 } });

    await page.evaluate(() => { window.productRouteHarness.setAccess('allow'); window.productRouteHarness.setAutomationMode('pages'); window.productRouteHarness.show('/scheduled?hostId=new&view=manage&automationId=target&automationSource=local#part', 'new', { from: 'chat' }); });
    await page.getByText('This task is not in the available results.').waitFor();
    assert.equal(await page.getByText('Scheduled task unavailable.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Show more', exact: true }).click();
    await page.getByRole('heading', { name: 'local target' }).waitFor();
    await page.getByRole('button', { name: 'Back to scheduled tasks' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new&view=manage#part'));
    const autoBack = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data);
    assert.deepEqual(autoBack, { path: '/scheduled?hostId=new&view=manage#part', options: { replace: true, state: { from: 'chat' } } });
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationMode=create', 'new'));
    await page.getByRole('heading', { name: 'New scheduled task' }).waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.some(call => call.method === 'task-write')), false);
    await page.evaluate(() => { window.productRouteHarness.setAutomationMode('create-failing'); window.productRouteHarness.show('/scheduled?hostId=new&automationMode=create#failed', 'new'); });
    await page.getByRole('heading', { name: 'New scheduled task' }).waitFor();
    await page.getByText('fixture host rejection: list-automations', { exact: false }).waitFor();
    assert.equal(await page.locator('form').getByRole('button', { name: 'Create', exact: true }).isDisabled(), true);
    await page.locator('form').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new#failed'));

    await page.evaluate(() => { window.productRouteHarness.setAutomationMode('direct'); window.productRouteHarness.show('/scheduled?hostId=new&automationId=direct&automationSource=cloud', 'new'); });
    await page.getByRole('alert').getByText('fixture task detail rejection', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Retry task' }).click();
    await page.getByRole('heading', { name: 'cloud direct' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=old&automationId=slow', 'old'));
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'automation-detail' && (call.data as { automationId?: string }).automationId === 'slow'));
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationId=fast', 'new'));
    await page.getByRole('heading', { name: 'local fast' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.resolveDetail());
    assert.equal(await page.getByRole('heading', { name: 'local slow' }).count(), 0);

    await page.evaluate(() => { window.productRouteHarness.setAutomationMode('direct'); window.productRouteHarness.show('/scheduled?hostId=new&automationId=editable&automationSource=cloud&edit_modal=true#edit', 'new'); });
    await page.getByRole('heading', { name: 'Edit scheduled task' }).waitFor();
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'cloud editable');
    assert.equal(await page.locator('form').getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await page.locator('form').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new&automationId=editable&automationSource=cloud#edit'));

    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationId=mismatch&automationSource=cloud&automationTeamId=team-a', 'new'));
    await page.getByRole('alert').getByText('The task does not match this team.', { exact: false }).waitFor();
    assert.ok(await page.evaluate(() => window.productRouteHarness.calls.some(call => call.method === 'automation-detail' && (call.data as { teamId?: string }).teamId === 'team-a')));
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationId=team-task&automationSource=cloud&automationTeamId=team-a', 'new'));
    await page.getByRole('heading', { name: 'cloud team-task' }).waitFor();

    await page.evaluate(() => { window.productRouteHarness.setAccess('scheduled'); window.productRouteHarness.show('/scheduled?hostId=new&automationId=denied-403&automationSource=cloud', 'new'); });
    await page.getByRole('alert').getByText('fixture upstream denied', { exact: false }).waitFor();
    const deniedReads = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'automation-detail' && (call.data as { automationId?: string }).automationId === 'denied-403').length);
    await page.getByRole('button', { name: 'Retry task' }).click();
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'automation-detail' && (call.data as { automationId?: string }).automationId === 'denied-403').length > count, deniedReads);
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new').length), 0);
    await page.evaluate(() => { window.productRouteHarness.setNavigationAllowed(false); window.productRouteHarness.show('/scheduled?hostId=new&automationId=missing-404&automationSource=cloud#missing', 'new', { from: 'prior' }); });
    await page.getByRole('alert').getByText('Navigation was not completed.').waitFor();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'automation-detail' && (call.data as { automationId?: string }).automationId === 'missing-404').length), 1);
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new').length), 1);
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('button', { name: 'Retry opening scheduled tasks' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string; options?: { state?: unknown } }).path === '/scheduled?hostId=new' && (call.data as { options?: { state?: unknown } }).options?.state === null).length >= 2);
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationId=missing-410&automationSource=cloud', 'new'));
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string; options?: { state?: unknown } }).path === '/scheduled?hostId=new' && (call.data as { options?: { state?: unknown } }).options?.state === null).length >= 3);
    await page.evaluate(() => { window.productRouteHarness.setAutomationMode('empty-complete'); window.productRouteHarness.show('/scheduled?hostId=new&automationId=missing-local', 'new'); });
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string; options?: { state?: unknown } }).path === '/scheduled?hostId=new' && (call.data as { options?: { state?: unknown } }).options?.state === null).length >= 4);
    await page.evaluate(() => { window.productRouteHarness.setAutomationMode('pages'); window.productRouteHarness.show('/scheduled?hostId=new&automationId=target&automationSource=local', 'new'); });
    await page.getByText('This task is not in the available results.').waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new').length), 4);
    await page.getByRole('button', { name: 'Show more', exact: true }).click();
    await page.getByRole('heading', { name: 'local target' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.setAccess('allow'));

    await page.evaluate(() => { window.productRouteHarness.setRouteProof('none'); window.productRouteHarness.setAutomationMode('pages'); window.productRouteHarness.show('/scheduled?hostId=new&automationMode=create&automationTeamId=team-a', 'new'); });
    await page.getByText('The selected team for this scheduled task has not been resolved.').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'New scheduled task' }).count(), 0);
    await page.evaluate(() => window.productRouteHarness.setRouteProof('team'));
    await page.getByRole('heading', { name: 'New scheduled task' }).waitFor();
    await page.evaluate(() => { window.productRouteHarness.setRouteProof('none'); window.productRouteHarness.show('/scheduled?hostId=new&automationMode=create&automationDraftId=oauth-draft', 'new'); });
    await page.getByText('The selected scheduled task draft has not been restored.').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'New scheduled task' }).count(), 0);
    await page.evaluate(() => window.productRouteHarness.setRouteProof('draft'));
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Restored draft');
    await page.evaluate(() => { window.productRouteHarness.setRouteProof('none'); window.productRouteHarness.show('/scheduled?hostId=new#template', 'new', { from: 'plugin', pluginId: 'plugin', template: { key: 'daily', name: 'A task', prompt: 'Do work', rrule: 'FREQ=DAILY' } }); });
    await page.getByText('The scheduled task template has not been restored.').waitFor();
    await page.evaluate(() => window.productRouteHarness.setRouteProof('template'));
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Restored template');
    await page.locator('form').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string; options?: { state?: unknown } }).path === '/scheduled?hostId=new#template' && JSON.stringify((call.data as { options?: { state?: unknown } }).options?.state) === JSON.stringify({ from: 'plugin' })));
    assert.equal(await page.getByText('The scheduled task template has not been restored.').count(), 0);
    await page.evaluate(() => window.productRouteHarness.setRouteProof('none'));

    await page.evaluate(() => { window.productRouteHarness.setAutomationMode('reject'); window.productRouteHarness.setAccess('shared'); window.productRouteHarness.show('/scheduled?hostId=new&shared_task=post%2F1#part', 'new', { from: 'share' }); });
    const shared = page.getByRole('dialog');
    await shared.getByText('fixture shared task rejection', { exact: false }).waitFor();
    await shared.getByRole('button', { name: 'Retry' }).click();
    await shared.getByRole('heading', { name: 'Shared fixture' }).waitFor();
    assert.ok(await page.evaluate(() => window.productRouteHarness.calls.some(call => call.method === 'shared-task' && call.hostId === 'new' && call.data === 'post/1')));
    const dialogRect = await shared.boundingBox();
    assert.ok(dialogRect && dialogRect.x >= 0 && dialogRect.x + dialogRect.width <= 390);
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(false));
    await shared.getByRole('button', { name: 'Close' }).click();
    await shared.getByRole('alert').getByText('Navigation was not completed.').waitFor();
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await shared.getByRole('button', { name: 'Close' }).click();
    const sharedBack = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data);
    assert.deepEqual(sharedBack, { path: '/scheduled?hostId=new#part', options: { replace: true, state: { from: 'share' } } });

    await page.evaluate(() => { window.productRouteHarness.setShareAllowed(false); window.productRouteHarness.show('/scheduled?hostId=new&automationId=target&automationSource=cloud&share_dialog=true', 'new'); });
    await page.getByRole('dialog').getByText('fixture share denied').waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'share').length), 0);
    await page.evaluate(() => window.productRouteHarness.setShareAllowed(true));
    await page.getByRole('dialog').getByText('fixture share rejection').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('dialog').getByText('No shared link.').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    await page.evaluate(() => { window.productRouteHarness.setNavigationAllowed(false); window.productRouteHarness.show('/scheduled?hostId=new&shared_task=owner&edit_modal=true#owner', 'new', { from: 'owner' }); });
    await page.getByRole('dialog').getByRole('alert').getByText('Navigation was not completed.').waitFor();
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('dialog').getByRole('button', { name: 'Retry opening task' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new&automationId=owned-task&automationSource=cloud&share_dialog=true#owner').length === 2);
    const ownerRedirect = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data);
    assert.deepEqual(ownerRedirect, { path: '/scheduled?hostId=new&automationId=owned-task&automationSource=cloud&share_dialog=true#owner', options: { replace: true, state: { from: 'owner' } } });

    await page.evaluate(() => { window.productRouteHarness.setAccess('scheduled'); window.productRouteHarness.setRunAccountId(undefined); window.productRouteHarness.show('/scheduled?hostId=new&automationId=target&automationSource=cloud&runId=latest#run', 'new', { sidebarAutomationAccountId: 'account' }); });
    await page.getByRole('alert').getByText('The scheduled task account has not been established.').waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length), 0);
    await page.evaluate(() => { window.productRouteHarness.setRunAccountId('account'); window.productRouteHarness.setRunAccess(false); });
    await page.getByRole('alert').getByText('fixture run access denied').waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length), 0);
    await page.evaluate(() => window.productRouteHarness.setRunAccess(true));
    await page.getByRole('alert').getByText('fixture run rejection').waitFor();
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.getByText('Synthetic run').waitFor();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'open-run-thread' && call.hostId === 'new' && (call.data as { chatRef?: { id?: string } }).chatRef?.id === 'run-thread'));
    const runRead = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'run-detail')?.data);
    assert.deepEqual(runRead, { automationId: 'target', runId: null });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new#run'));
    await page.evaluate(() => { window.productRouteHarness.setNavigationAllowed(false); window.productRouteHarness.show('/scheduled?hostId=new&automationId=without-chat&automationSource=cloud&runId=latest#empty', 'new', { from: 'empty-run' }); });
    await page.getByRole('alert').getByText('Navigation was not completed.').first().waitFor();
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('button', { name: 'Retry opening task' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/scheduled?hostId=new&automationId=without-chat&automationSource=cloud#empty').length === 2);
    const previousRunReads = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length);
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationId=foreign&automationSource=cloud&runId=run', 'new', { sidebarAutomationAccountId: 'other-account' }));
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string; options?: { state?: unknown } }).path === '/scheduled?hostId=new' && (call.data as { options?: { state?: unknown } }).options?.state === null));
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length), previousRunReads);

    const projectFailure = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/gizmos/'));
    await page.evaluate(() => { window.productRouteHarness.setBridgeFallback(true); window.productRouteHarness.show('/projects?projectId=proj%2F42&hostId=new', 'new'); });
    await projectFailure;
    await page.getByRole('alert').getByText('当前 HTTP 宿主支持原版功能配置与事件端点', { exact: false }).waitFor();
    const projectRetry = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/gizmos/'));
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await projectRetry;
    assert.equal(baselineRequests.filter(value => value.url.includes('/gizmos/')).length, 2);
    assert.ok(baselineRequests.some(value => value.url === 'https://chatgpt.com/backend-api/gizmos/proj%2F42?include_file_limits=true'));

    const sharedFailure = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/share/post/'));
    await page.evaluate(() => { window.productRouteHarness.setAccess('shared'); window.productRouteHarness.show('/scheduled?hostId=new&shared_task=post%2F2', 'new'); });
    await sharedFailure;
    await page.getByRole('dialog').getByText('当前 HTTP 宿主支持原版功能配置与事件端点', { exact: false }).waitFor();
    const sharedRetry = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/share/post/'));
    await page.getByRole('dialog').getByRole('button', { name: 'Retry' }).click();
    await sharedRetry;
    assert.equal(baselineRequests.filter(value => value.url.includes('/share/post/')).length, 2);
    assert.ok(baselineRequests.some(value => value.url === 'https://chatgpt.com/backend-api/share/post/post%2F2/automation'));
    const shareFailure = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/share/automation/'));
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationId=target&automationSource=cloud&share_dialog=true', 'new'));
    await shareFailure;
    await page.getByRole('dialog').getByText('当前 HTTP 宿主支持原版功能配置与事件端点', { exact: false }).waitFor();
    assert.ok(baselineRequests.some(value => value.url === 'https://chatgpt.com/backend-api/share/automation/target/current'));
    const detailFailure = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url === 'https://chatgpt.com/backend-api/automation/task%2F1');
    await page.evaluate(() => { window.productRouteHarness.setAccess('allow'); window.productRouteHarness.show('/scheduled?hostId=new&automationId=task%2F1&automationSource=cloud', 'new'); });
    await detailFailure;
    await page.getByRole('alert').getByText('Could not load this task:', { exact: false }).waitFor();
    const detailRetry = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url === 'https://chatgpt.com/backend-api/automation/task%2F1');
    await page.getByRole('button', { name: 'Retry task' }).click();
    await detailRetry;
    assert.equal(baselineRequests.filter(value => value.url === 'https://chatgpt.com/backend-api/automation/task%2F1').length, 2);
    const runFailure = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/runs/latest'));
    await page.evaluate(() => { window.productRouteHarness.setAccess('scheduled'); window.productRouteHarness.show('/scheduled?hostId=new&automationId=task%2F1&automationSource=cloud&runId=latest', 'new', { sidebarAutomationAccountId: 'account' }); });
    await runFailure;
    await page.getByRole('alert').getByText('当前 HTTP 宿主支持原版功能配置与事件端点', { exact: false }).waitFor();
    const runRetry = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/runs/latest'));
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await runRetry;
    assert.equal(baselineRequests.filter(value => value.url === 'https://chatgpt.com/backend-api/automation/task%2F1/runs/latest').length, 2);
    const specificRun = page.waitForResponse(response => response.url().endsWith('/api/http-fetch') && response.request().postDataJSON().url.includes('/runs/run%2F2'));
    await page.evaluate(() => window.productRouteHarness.show('/scheduled?hostId=new&automationId=task%2F1&automationSource=cloud&runId=run%2F2', 'new'));
    await specificRun;
    assert.ok(baselineRequests.some(value => value.url === 'https://chatgpt.com/backend-api/automation/task%2F1/runs/run%2F2'));
    assert.ok(baselineRequests.every(value => value.method === 'GET' && !value.headers));

    await page.evaluate(() => { window.productRouteHarness.setAccess('denied'); window.productRouteHarness.show('/scheduled?shared_task=post', 'new'); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate' && (call.data as { path?: string }).path === '/?hostId=new'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
