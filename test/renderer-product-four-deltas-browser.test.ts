import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import type {} from './renderer-product-routes-fixture.tsx';

const chrome = '/usr/bin/google-chrome';
let browser: Browser;
let script = '';
before(async () => {
  if (!existsSync(chrome)) return;
  const bundle = await build({ entryPoints: ['test/renderer-product-routes-fixture.tsx'], bundle: true, write: false,
    outdir: 'four-deltas-test-output', format: 'iife', jsx: 'automatic', loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' } });
  script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
});
after(async () => { await browser?.close(); });

async function pageFor(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 800, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(3500);
  await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:49007/'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
  await page.goto('http://127.0.0.1:49007/'); await page.addScriptTag({ content: script });
  return page;
}

test('mismatched route closure preserves the other controlled draft', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('scheduled');
      h.showFromUrl('/scheduled?hostId=ssh&automationMode=create&automationDraftId=oauth-draft#source', { origin: 'fixture' }); h.setRouteProof('draft-mismatch'); });
    await page.getByText('The selected scheduled task draft has not been restored.').waitFor();
    const original = await page.evaluate(() => window.productRouteHarness.editorSnapshot());
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate'), null, { timeout: 3500 });
    assert.deepEqual(await page.evaluate(() => window.productRouteHarness.editorSnapshot()), original);
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'editor-change').length), 0);
    const target = await page.evaluate(() => window.productRouteHarness.currentLocation());
    assert.equal(new URLSearchParams(target.search).get('automationDraftId'), null);
    assert.equal(target.hash, '#source'); assert.deepEqual(target.state, { origin: 'fixture' });
  } finally { await page.context().close(); }
});

test('manage Create enters a clean route only after the navigation guard', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    const path = '/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=false&edit_modal=false&runId=run-old#return';
    await page.evaluate(path => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.setNavigationAllowed(false); h.showFromUrl(path, { original: true }); }, path);
    await page.getByRole('heading', { name: 'local first' }).waitFor();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate'), null, { timeout: 3500 });
    assert.equal(await page.evaluate(() => window.productRouteHarness.editorSnapshot()), null);
    assert.equal((await page.evaluate(() => window.productRouteHarness.currentLocation())).search, new URL(path, 'http://fixture').search);
    const attempt = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'navigate')?.data) as { path: string; options: unknown };
    const url = new URL(attempt.path, 'http://fixture');
    assert.equal(url.searchParams.get('hostId'), 'ssh'); assert.equal(url.searchParams.get('view'), 'manage');
    assert.equal(url.searchParams.get('automationMode'), 'create');
    for (const key of ['automationId', 'automationSource', 'automationTeamId', 'automationDraftId', 'edit', 'edit_modal', 'runId']) assert.equal(url.searchParams.has(key), false, key);
    assert.equal(url.hash, '#return'); assert.deepEqual(attempt.options, { replace: true, state: { original: true } });
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByLabel('Prompt', { exact: true }).waitFor();
    assert.equal(new URLSearchParams((await page.evaluate(() => window.productRouteHarness.currentLocation())).search).get('automationId'), null);
  } finally { await page.context().close(); }
});

test('verified reconnect settles the original operation and uses its real task ID', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true#original', { page: 'original' }); h.seedRecovery('update', 'valid'); });
    await page.getByRole('button', { name: 'Check changes' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'finalize'), null, { timeout: 3500 });
    const settled = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'finalize')?.data) as {
      scope: { sessionKey: string }; identity: { sessionKey: string }; change: { sessionKey: string; operationId: string }; outcome: { automationId?: string; item?: unknown }; completion: { sessionKey: string; automationId: string } };
    assert.equal(settled.scope.sessionKey, 'session-ssh-2');
    assert.equal(settled.change.sessionKey, 'session-ssh-1'); assert.equal(settled.identity.sessionKey, 'session-ssh-1');
    assert.equal(settled.completion.sessionKey, 'session-ssh-1'); assert.equal(settled.completion.automationId, 'first');
    assert.equal(settled.outcome.automationId, 'first'); assert.equal(settled.outcome.item, undefined);
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'update-task').length), 0);
  } finally { await page.context().close(); }
});

test('a discard confirmation cannot clear a replacement draft', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('scheduled');
      h.showFromUrl('/scheduled?hostId=ssh&automationMode=create&automationDraftId=oauth-draft'); h.setRouteProof('draft'); });
    await page.getByLabel('Prompt', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.replaceDraft());
    const newer = await page.evaluate(() => window.productRouteHarness.editorSnapshot());
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'navigate'));
    assert.deepEqual(await page.evaluate(() => window.productRouteHarness.editorSnapshot()), newer);
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'editor-change').length), 0);
  } finally { await page.context().close(); }
});

test('a changed draft on the same route remains open for review', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('scheduled');
      h.showFromUrl('/scheduled?hostId=ssh&automationMode=create'); h.setRouteProof('template'); });
    await page.getByLabel('Prompt', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).waitFor();
    await page.evaluate(() => window.productRouteHarness.replaceDraft());
    const newer = await page.evaluate(() => window.productRouteHarness.editorSnapshot());
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await page.getByText('The draft changed. Review it before discarding.').waitFor();
    assert.deepEqual(await page.evaluate(() => window.productRouteHarness.editorSnapshot()), newer);
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['editor-change', 'navigate'].includes(call.method)).length), 0);
  } finally { await page.context().close(); }
});

test('create and delete can settle their own snapshotless S1 receipts under S2', { skip: !existsSync(chrome), timeout: 35_000 }, async () => {
  for (const kind of ['create', 'delete'] as const) {
    const page = await pageFor();
    try {
      const url = kind === 'create' ? '/scheduled?hostId=ssh&view=manage&automationMode=create#original' : '/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local#original';
      await page.evaluate(({ kind, url }) => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.showFromUrl(url, { page: 'original' }); h.seedRecovery(kind, 'valid'); }, { kind, url });
      await page.getByRole('button', { name: 'Check changes' }).click();
      await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
      const value = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'finalize')?.data) as {
        scope: { sessionKey: string }; change: { sessionKey: string; operationId: string }; outcome: { automationId: string; item?: unknown }; completion: { sessionKey: string; automationId: string } };
      assert.equal(value.scope.sessionKey, 'session-ssh-2'); assert.equal(value.change.sessionKey, 'session-ssh-1');
      assert.equal(value.completion.sessionKey, 'session-ssh-1');
      assert.equal(value.outcome.automationId, kind === 'create' ? value.change.operationId : 'first');
      assert.equal(value.completion.automationId, value.outcome.automationId); assert.equal(value.outcome.item, undefined);
      assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['create-task', 'delete-task'].includes(call.method)).length), 0);
    } finally { await page.context().close(); }
  }
});

test('an S1 server-assigned task ID is not reinterpreted using the S2 source policy', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationMode=create'); h.seedRecovery('create', 'server-id'); });
    await page.getByRole('button', { name: 'Check changes' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
    const result = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'finalize')?.data) as {
      change: { sessionKey: string; operationId: string }; completion: { sessionKey: string; automationId: string } };
    assert.equal(result.change.sessionKey, 'session-ssh-1');
    assert.equal(result.completion.sessionKey, 'session-ssh-1');
    assert.equal(result.completion.automationId, 'original-server-id');
    assert.notEqual(result.completion.automationId, result.change.operationId);
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'create-task').length), 0);
  } finally { await page.context().close(); }
});

test('a verified S1 not-sent terminal keeps its original draft without replay', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true'); h.seedRecovery('update', 'not-sent'); });
    const original = await page.evaluate(() => window.productRouteHarness.editorSnapshot());
    await page.getByRole('button', { name: 'Check changes' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'finalize'));
    await page.waitForFunction(() => window.productRouteHarness.editorSnapshot()?.pendingOperationId === null);
    const result = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'finalize')?.data) as {
      scope: { sessionKey: string }; identity: { sessionKey: string }; change: { sessionKey: string }; outcome: { state: string }; completion: unknown };
    assert.equal(result.scope.sessionKey, 'session-ssh-2'); assert.equal(result.change.sessionKey, 'session-ssh-1');
    assert.equal(result.identity.sessionKey, 'session-ssh-1'); assert.equal(result.outcome.state, 'not-sent'); assert.equal(result.completion, null);
    assert.deepEqual(await page.evaluate(() => window.productRouteHarness.editorSnapshot()), { ...original, pendingOperationId: null });
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['navigate', 'ack-navigation', 'update-task'].includes(call.method)).length), 0);
  } finally { await page.context().close(); }
});

test('recovery rejects mismatched owner, draft or task identity', { skip: !existsSync(chrome), timeout: 50_000 }, async () => {
  for (const variant of ['wrong-host', 'wrong-account', 'wrong-installation', 'wrong-user', 'wrong-identity', 'wrong-id'] as const) {
    const page = await pageFor();
    try {
      await page.evaluate(variant => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
        h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true#original'); h.seedRecovery('update', variant); }, variant);
      const original = await page.evaluate(() => window.productRouteHarness.editorSnapshot());
      await page.getByRole('button', { name: 'Check changes' }).click();
      await page.getByText('Could not check changes:', { exact: false }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.productRouteHarness.editorSnapshot()), original, variant);
      assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['finalize', 'navigate', 'update-task'].includes(call.method)).length), 0, variant);
    } finally { await page.context().close(); }
  }
});

test('a recovered delete cannot carry a draft identity to finalization', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local'); h.seedRecovery('delete', 'wrong-identity'); });
    await page.getByRole('button', { name: 'Check changes' }).click();
    await page.getByText('The original operation does not have a draft.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['finalize', 'navigate', 'delete-task'].includes(call.method)).length), 0);
  } finally { await page.context().close(); }
});

test('revoked authority cannot settle a delayed recovery or navigate', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true'); h.seedRecovery('update', 'valid'); h.hold('reconcile'); });
    await page.getByRole('button', { name: 'Check changes' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'held-reconcile'));
    await page.evaluate(() => { window.productRouteHarness.revokeWithoutRender(); window.productRouteHarness.release(); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'released-reconcile'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['finalize', 'navigate', 'update-task'].includes(call.method)).length), 0);
  } finally { await page.context().close(); }
});

test('a changed draft remains pending and cannot navigate after reconciliation', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true'); h.seedRecovery('update', 'valid'); h.hold('finalize'); });
    await page.getByRole('button', { name: 'Check changes' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'held-finalize'));
    await page.evaluate(() => { window.productRouteHarness.replaceDraft(); window.productRouteHarness.release(); });
    await page.getByText('The change is still awaiting confirmation.').waitFor();
    assert.equal((await page.evaluate(() => window.productRouteHarness.editorSnapshot()))?.draftId, 'newer-draft');
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['navigate', 'update-task'].includes(call.method)).length), 0);
    assert.equal(await page.getByRole('button', { name: 'Check changes' }).count(), 1);
  } finally { await page.context().close(); }
});

test('revocation while finalization waits preserves the original draft and prevents navigation', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true'); h.seedRecovery('update', 'valid'); h.hold('finalize'); });
    const original = await page.evaluate(() => window.productRouteHarness.editorSnapshot());
    await page.getByRole('button', { name: 'Check changes' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'held-finalize'));
    await page.evaluate(() => { window.productRouteHarness.revokeWithoutRender(); window.productRouteHarness.release(); });
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'released-finalize'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
    assert.deepEqual(await page.evaluate(() => window.productRouteHarness.editorSnapshot()), original);
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['navigate', 'ack-navigation', 'update-task'].includes(call.method)).length), 0);
  } finally { await page.context().close(); }
});

test('update and delete carry the same operation ID registered by tracking', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow'); h.enableWrites();
      h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationId=first&automationSource=local&edit=true'); });
    await page.getByLabel('Prompt', { exact: true }).fill('Changed once');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.filter(call => call.method === 'ack-navigation').length === 2);
    const calls = await page.evaluate(() => window.productRouteHarness.calls);
    for (const kind of ['update', 'delete']) {
      const tracked = calls.find(call => call.method === 'track-' + kind)?.data;
      const dispatched = calls.find(call => call.method === kind + '-task')?.data as { operationId?: string };
      assert.equal(typeof tracked, 'string'); assert.equal(dispatched.operationId, tracked, kind);
    }
  } finally { await page.context().close(); }
});

test('snapshotless confirmed save refreshes the real detail without replay', { skip: !existsSync(chrome), timeout: 25_000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(() => { const h = window.productRouteHarness; h.setAutomationMode('direct'); h.setAccess('allow'); h.setSnapshotlessSave(true); h.setNavigationAllowed(false);
      h.showFromUrl('/scheduled?hostId=ssh&automationMode=create#saved', { source: 'fixture' }); });
    await page.getByLabel('Prompt', { exact: true }).fill('Save once');
    await page.locator('form').getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Retry opening task' }).waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'create-task').length), 1);
    await page.evaluate(() => window.productRouteHarness.setNavigationAllowed(true));
    await page.getByRole('button', { name: 'Retry opening task' }).click();
    await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
    const id = new URLSearchParams((await page.evaluate(() => window.productRouteHarness.currentLocation())).search).get('automationId');
    assert.ok(id);
    await page.getByText('fixture task detail rejection').waitFor();
    await page.getByRole('button', { name: 'Retry task' }).click();
    await page.getByRole('heading', { name: `local ${id}` }).waitFor();
    assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'create-task').length), 1);
  } finally { await page.context().close(); }
});

test('a snapshotless server ID is accepted only under the declared source contract', { skip: !existsSync(chrome), timeout: 35_000 }, async () => {
  for (const matchesRequestId of [false, true]) {
    const page = await pageFor();
    try {
      await page.evaluate(matches => { const h = window.productRouteHarness; h.setAutomationMode('complete'); h.setAccess('allow');
        h.setSnapshotlessSave(true, 'server-assigned-task', matches); h.showFromUrl('/scheduled?hostId=ssh&view=manage&automationMode=create#source'); }, matchesRequestId);
      await page.getByLabel('Prompt', { exact: true }).fill('Save once');
      await page.locator('form').getByRole('button', { name: 'Create', exact: true }).click();
      if (matchesRequestId) {
        await page.getByText('The saved task could not be confirmed.').waitFor();
        assert.ok((await page.evaluate(() => window.productRouteHarness.editorSnapshot()))?.pendingOperationId);
        assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => ['finalize', 'navigate'].includes(call.method)).length), 0);
      } else {
        await page.waitForFunction(() => window.productRouteHarness.calls.some(call => call.method === 'ack-navigation'));
        assert.equal(new URLSearchParams((await page.evaluate(() => window.productRouteHarness.currentLocation())).search).get('automationId'), 'server-assigned-task');
        const result = await page.evaluate(() => window.productRouteHarness.calls.find(call => call.method === 'finalize')?.data) as { outcome: { automationId: string; item?: unknown } };
        assert.equal(result.outcome.automationId, 'server-assigned-task'); assert.equal(result.outcome.item, undefined);
      }
      assert.equal(await page.evaluate(() => window.productRouteHarness.calls.filter(call => call.method === 'create-task').length), 1);
    } finally { await page.context().close(); }
  }
});
