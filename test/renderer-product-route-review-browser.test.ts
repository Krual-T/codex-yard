import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import type {} from './renderer-product-routes-fixture.tsx';

const chrome = '/usr/bin/google-chrome';
async function pageFor(browser: Browser): Promise<Page> {
  const bundle = await build({ entryPoints: ['test/renderer-product-routes-fixture.tsx'], bundle: true, write: false,
    outdir: 'route-review-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' } });
  const context = await browser.newContext({ viewport: { width: 800, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:49007/'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
  await page.goto('http://127.0.0.1:49007/');
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
  return page;
}
async function browserForTest() {
  return chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
}

test('review: legacy project gate, normalized identity, real URL host and locale', { skip: !existsSync(chrome), timeout: 45_000 }, async () => {
  const browser = await browserForTest();
  try {
    const page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAccess('allow'); h.setLegacyProject('loading'); h.showFromUrl('/g/g-p-123-name/project?hostId=ssh#project'); });
    await page.getByText('Checking project access...').waitFor();
    await page.evaluate(() => window.productRouteHarness.setLegacyProject('wrong-user'));
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate'));
    const redirected = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data);
    assert.deepEqual(redirected, { path: '/?hostId=ssh', options: { replace: true, state: { chatGptProjectId: 'g-p-123' } } });
    assert.equal(await page.evaluate(() => window.productRouteHarness.currentHost()), 'ssh');
    await page.evaluate(() => { const h = window.productRouteHarness; h.setLegacyProject('mapped'); h.showFromUrl('/g/g-p-123-name/project?hostId=ssh'); });
    await page.getByTestId('project-composer').waitFor();
    assert.equal((JSON.parse(await page.getByTestId('project-composer').innerText()) as { projectId: string }).projectId, 'g-p-123');
    assert.equal(await page.getByTestId('local-project').innerText(), 'local-project');
    await page.evaluate(() => { const h = window.productRouteHarness; h.setLegacyProject('enabled'); h.showFromUrl('/g/g-abc-title/project?hostId=ssh'); });
    await page.getByTestId('project-composer').waitFor();
    assert.equal((JSON.parse(await page.getByTestId('project-composer').innerText()) as { projectId: string }).projectId, 'g-abc');
    assert.equal(await page.getByTestId('local-project').innerText(), '');
    await page.evaluate(() => { const h = window.productRouteHarness; h.setLocale('zh-CN'); h.setAccess('legacy'); h.showFromUrl('/agents/a/agent?hostId=ssh'); });
    await page.getByRole('button', { name: '返回' }).waitFor();
  } finally { await browser.close(); }
});

test('review: landing gate and run references retain actual run and sidebar context', { skip: !existsSync(chrome), timeout: 45_000 }, async () => {
  const browser = await browserForTest();
  try {
    const page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('direct'); h.setAccess('scheduled'); h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=cloud&runId=latest'); });
    await page.getByRole('heading', { name: 'Scheduled' }).waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length), 0);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAccess('allow'); h.showFromUrl('/scheduled?hostId=ssh&automationId=first&automationSource=cloud&runId=latest'); });
    await page.getByRole('heading', { name: 'Scheduled' }).waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length), 0);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAccess('scheduled'); h.setRunType('chatgpt'); h.showFromUrl('/scheduled?hostId=ssh&automationId=target&automationSource=cloud&runId=latest', { navigationSource: 'fixture', sidebarAutomationAccountId: 'account' }); });
    await page.getByText('fixture run rejection').waitFor();
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'open-run-thread'));
    const opened = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'open-run-thread')?.data);
    assert.deepEqual(opened, { hostId: 'ssh', accountKey: 'account', installationKey: null, sessionKey: 'session-ssh-1', automationId: 'target', runId: 'latest-run-id', chatRef: { type: 'chatgpt', id: 'run-thread' }, replace: true,
      state: { navigationSource: 'fixture', sidebarArea: 'scheduled', sidebarAutomationId: 'target', sidebarAutomationSource: 'cloud', sidebarAutomationRunId: 'latest-run-id', sidebarAutomationAccountId: 'account' } });
    await page.evaluate(() => window.productRouteHarness.showFromUrl('/scheduled?hostId=ssh'));
    await page.getByRole('heading', { name: 'Schedule a task' }).waitFor();
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'New scheduled task' }).waitFor();
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.showFromUrl('/scheduled?hostId=ssh&automationId=first&automationSource=local'); });
    await page.getByText('Your task is saved. You can review its schedule and settings in task details.', { exact: true }).waitFor();
    assert.deepEqual(JSON.parse(await page.getByTestId('task-composer').innerText()), { hostId: 'ssh', automationId: 'first', revision: 'revision-1', confirmation: 'Your task is saved. You can review its schedule and settings in task details.', navigationSource: 'scheduled_page' });
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('timed'); h.showFromUrl('/scheduled?hostId=ssh&automationId=timed&automationSource=local'); });
    await page.locator('p').filter({ hasText: 'Your task is scheduled. Its next run is' }).waitFor();
    assert.match((JSON.parse(await page.getByTestId('task-composer').innerText()) as { confirmation: string }).confirmation, /^Your task is scheduled\. Its next run is /);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('heartbeat'); h.showFromUrl('/scheduled?hostId=ssh&automationId=heartbeat&automationSource=local'); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'open-task-thread'));
    const heartbeat = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'open-task-thread')?.data);
    assert.deepEqual(heartbeat, { hostId: 'ssh', accountKey: 'account', installationKey: null, sessionKey: 'session-ssh-1', threadId: 'heartbeat-thread', replace: true,
      state: { sidebarArea: 'scheduled', sidebarAutomationId: 'heartbeat', sidebarAutomationSource: 'local' } });
    await page.evaluate(() => window.productRouteHarness.showFromUrl('/scheduled?hostId=ssh&automationId=without-chat&automationSource=cloud&runId=run-1'));
    await page.getByText('This run has no chat available').waitFor();
    const before = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length);
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'run-detail').length > count, before);
  } finally { await browser.close(); }
});

test('review: projected cloud confirmation follows source timing and triggers', { skip: !existsSync(chrome), timeout: 45_000 }, async () => {
  const browser = await browserForTest();
  try {
    const page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('direct'); h.setAccess('scheduled'); });
    const expected: [string, string][] = [
      ['gmail', 'Your task is ready. I’ll run it when new email matching your filters arrives in Gmail.'],
      ['slack', 'Your task is ready. I’ll run it for new message in #team on Slack.'],
      ['slackspecial', 'Your task is ready. I’ll run it for mentions $& {channels} in #team on Slack.'],
      ['slackparams', 'Your task is ready. I’ll run it when new messages matching your filters arrive in #team and #alerts on Slack.'],
      ['github', 'Your task is ready. I’ll run it when pull requests by pat matching your filters are merged in org/repo on GitHub.'],
      ['githubpresentation', 'Your task is ready. I’ll monitor org/repo on GitHub and run it when a pull request event matches your trigger settings.'],
      ['fallback', 'Your task is ready. I’ll run it when its trigger fires.'],
      ['null', 'Your task is ready. I’ll run it when its trigger fires.'],
    ];
    for (const [id, confirmation] of expected) {
      await page.evaluate(value => window.productRouteHarness.showFromUrl(`/scheduled?hostId=ssh&automationId=cloud-confirmation-${value}&automationSource=cloud`), id);
      await page.getByText(confirmation, { exact: true }).waitFor();
      assert.equal((JSON.parse(await page.getByTestId('task-composer').innerText()) as { confirmation: string }).confirmation, confirmation);
    }
    const formatted = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' }).format(1_800_000_000_000);
    for (const id of ['time', 'watchtime']) {
      await page.evaluate(value => window.productRouteHarness.showFromUrl(`/scheduled?hostId=ssh&automationId=cloud-confirmation-${value}&automationSource=cloud`), id);
      await page.waitForFunction(value => { const output = document.querySelector('[data-testid="task-composer"]')?.textContent; return output && JSON.parse(output).automationId === `cloud-confirmation-${value}`; }, id);
      await page.getByText(`Your task is scheduled. Its next run is ${formatted}.`, { exact: true }).waitFor();
    }
  } finally { await browser.close(); }
});

test('review: restored drafts and synchronous authority checks protect dispatch', { skip: !existsSync(chrome), timeout: 60_000 }, async () => {
  const browser = await browserForTest();
  try {
    let page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.showFromUrl('/scheduled?hostId=ssh&automationMode=create&automationDraftId=oauth-draft'); h.setRouteProof('draft-mismatch'); });
    await page.getByText('The selected scheduled task draft has not been restored.').waitFor();
    assert.equal(await page.getByLabel('Prompt', { exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.productRouteHarness.editorSnapshot()))?.draftId, 'older-draft');
    await page.evaluate(() => window.productRouteHarness.setRouteProof('draft'));
    await page.getByLabel('Prompt', { exact: true }).waitFor();
    for (const field of ['hostId', 'accountKey', 'sessionKey', 'draftRevision', 'taskId', 'taskRevision', 'sourceKey', 'source', 'teamId'] as const) {
      await page.evaluate(() => window.productRouteHarness.setDraftProof(null));
      await page.getByLabel('Prompt', { exact: true }).waitFor();
      await page.evaluate(value => window.productRouteHarness.setDraftProof(value), field);
      await page.getByText('The selected scheduled task draft has not been restored.').waitFor();
      assert.equal(await page.getByLabel('Prompt', { exact: true }).count(), 0, field);
      assert.equal((await page.evaluate(() => window.productRouteHarness.editorSnapshot()))?.draftId, 'oauth-draft');
    }
    await page.context().close();
    for (const stage of ['prepare', 'track'] as const) {
      page = await pageFor(browser);
      await page.evaluate(stage => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.showFromUrl('/scheduled?hostId=ssh&automationMode=create'); h.hold(stage); }, stage);
      await page.getByLabel('Prompt', { exact: true }).fill('Original draft');
      await page.locator('form').getByRole('button', { name: 'Create', exact: true }).click();
      await page.waitForFunction(stage => window.productRouteHarness.calls.some(call => call.method === 'held-' + stage), stage);
      await page.evaluate(() => { window.productRouteHarness.revokeWithoutRender(); window.productRouteHarness.release(); });
      await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'finalize' && (call.data as { state?: string }).state === 'not-sent'));
      assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'create-task').length), 0);
      if (stage === 'prepare') assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'track-create').length), 0);
      await page.context().close();
    }
    page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local'); h.hold('selection'); });
    await page.getByRole('button', { name: 'Run now' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'held-selection'));
    await page.evaluate(() => { window.productRouteHarness.revokeWithoutRender(); window.productRouteHarness.release(); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'released-selection'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'track-run' || call.method === 'run-now').length), 0);
    await page.context().close();
    page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.hold('navigation'); h.showFromUrl('/explore?hostId=ssh'); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'held-navigation'));
    await page.evaluate(() => { window.productRouteHarness.revokeWithoutRender(); window.productRouteHarness.release(); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'released-navigation'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
    assert.equal((await page.evaluate(() => window.productRouteHarness.currentLocation())).pathname, '/explore');
  } finally { await browser.close(); }
});

test('review: confirmed updates and deletions replace the original route', { skip: !existsSync(chrome), timeout: 45_000 }, async () => {
  const browser = await browserForTest();
  try {
    const page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.enableWrites(); h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true#updated', { from: 'edit' }); });
    await page.getByLabel('Prompt', { exact: true }).fill('Updated prompt');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
    const update = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data) as { path: string; options: unknown };
    const updated = new URL(update.path, 'http://yard.invalid');
    assert.equal(updated.searchParams.get('hostId'), 'ssh');
    assert.equal(updated.searchParams.get('automationId'), 'first');
    assert.equal(updated.searchParams.get('edit'), null);
    assert.equal(updated.hash, '#updated');
    assert.deepEqual(update.options, { replace: true, state: { from: 'edit' } });
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'update-task').length), 1);
    await page.evaluate(() => window.productRouteHarness.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local#deleted', { from: 'delete' }));
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'ack-navigation').length === 2);
    const deletion = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data) as { path: string; options: unknown };
    const deleted = new URL(deletion.path, 'http://yard.invalid');
    assert.equal(deleted.searchParams.get('hostId'), 'ssh');
    assert.equal(deleted.searchParams.get('automationId'), null);
    assert.equal(deleted.searchParams.get('automationSource'), null);
    assert.equal(deleted.searchParams.get('view'), 'manage');
    assert.equal(deleted.hash, '#deleted');
    assert.deepEqual(deletion.options, { replace: true, state: { from: 'delete' } });
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'delete-task').length), 1);
    await page.evaluate(() => { const h = window.productRouteHarness; h.showFromUrl('/scheduled?hostId=ssh#template', { from: 'plugin', pluginId: 'plugin', template: { key: 'daily', name: 'Task', prompt: 'Do work', rrule: 'FREQ=DAILY' } }); h.setRouteProof('template'); });
    await page.getByLabel('Prompt', { exact: true }).waitFor();
    await page.locator('form').getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'ack-navigation').length === 3);
    const template = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data) as { path: string; options: unknown };
    assert.deepEqual(template.options, { replace: true, state: { from: 'plugin' } });
    assert.equal(new URL(template.path, 'http://yard.invalid').hash, '#template');
  } finally { await browser.close(); }
});

test('review: late receipts preserve newer drafts and navigation retries do not write', { skip: !existsSync(chrome), timeout: 60_000 }, async () => {
  const browser = await browserForTest();
  try {
    let page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.showFromUrl('/scheduled?hostId=ssh&automationMode=create#first', { page: 'first' }); h.hold('response'); });
    await page.getByLabel('Prompt', { exact: true }).fill('Earlier draft');
    await page.locator('form').getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'held-response'));
    await page.evaluate(() => { const h = window.productRouteHarness; h.replaceDraft(); h.showFromUrl('/scheduled?hostId=ssh&automationMode=create#second', { page: 'second' }); h.release(); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'finalize' && (call.data as { state?: string }).state === 'confirmed'));
    assert.equal((await page.evaluate(() => window.productRouteHarness.editorSnapshot()))?.draft.prompt, 'Newer draft');
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').length), 0);
    const late = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'finalize')?.data) as { completion: { origin: { hash: string; state: unknown } } };
    assert.deepEqual({ hash: late.completion.origin.hash, state: late.completion.origin.state }, { hash: '#first', state: { page: 'first' } });
    await page.context().close();
    page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.setNavigationAllowed(false); h.showFromUrl('/scheduled?hostId=ssh&automationMode=create#saved', { from: 'origin' }); });
    await page.getByLabel('Prompt', { exact: true }).fill('One write');
    await page.locator('form').getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Retry opening task' }).waitFor();
    const initialAttempts = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').length);
    await page.evaluate(() => window.productRouteHarness.reload());
    await page.waitForFunction(count => window.productRouteHarness.calls.filter(call => call.method === 'navigate').length > count, initialAttempts);
    assert.equal(await page.locator('form').count(), 0);
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('button', { name: 'Retry opening task' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
    const nav = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').at(-1)?.data) as { path: string; options: unknown };
    const target = new URL(nav.path, 'http://yard.invalid');
    assert.equal(target.searchParams.get('hostId'), 'ssh');
    assert.equal(target.searchParams.get('automationMode'), null);
    assert.equal(target.searchParams.get('automationSource'), 'local');
    assert.ok(target.searchParams.get('automationId'));
    assert.equal(target.hash, '#saved');
    assert.deepEqual(nav.options, { replace: true, state: { from: 'origin' } });
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'create-task').length), 1);
    await page.context().close();
    page = await pageFor(browser);
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.setNavigationAllowed(false); h.showFromUrl('/scheduled?hostId=ssh&automationMode=create#same', { page: 'first' }); });
    await page.getByLabel('Prompt', { exact: true }).fill('First location');
    await page.locator('form').getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Retry opening task' }).waitFor();
    const attempts = await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').length);
    await page.evaluate(() => window.productRouteHarness.showFromUrl('/scheduled?hostId=ssh&automationMode=create#same', { page: 'second' }));
    await page.getByLabel('Prompt', { exact: true }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'navigate').length), attempts);
  } finally { await browser.close(); }
});
