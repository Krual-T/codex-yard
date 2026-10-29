import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { success } from '../lib/native-tool-kernel.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';
import type {} from './renderer-thread-summary-parity-fixture.tsx';

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';
const metadata = { isFile: true, isDirectory: false, isSymlink: false, modifiedAtMs: 1, createdAtMs: 1 };

test('summary original create card, shared expansion atoms, and scoped generated-image reads', {
  skip: !existsSync(chrome) && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ysp-'));
  const cleanup: Array<() => Promise<void>> = [async () => { await rm(root, { recursive: true, force: true }); }];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const local = await createFakeCodex(root); cleanup.push(() => local.close());
  const remoteRoot = join(root, 'remote'); await mkdir(remoteRoot);
  const remote = await createFakeCodex(remoteRoot); cleanup.push(() => remote.close());
  let releaseSlow!: () => void;
  const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
  let releaseSlowChild!: () => void;
  const slowChild = new Promise<void>(resolve => { releaseSlowChild = resolve; });
  let failRead = true;
  local.handlers.set('fs/getMetadata', async params => {
    if (params.path === '/fixture/project/slow.png') { await slow; return metadata; }
    if (params.path === '/fixture/project/retry.png' && failRead) throw Error('controlled metadata failure');
    return metadata;
  });
  remote.handlers.set('fs/getMetadata', () => metadata);
  remote.handlers.set('thread/read', async params => {
    if (params.threadId === 'slow-child') await slowChild;
    return remote.defaultResult('thread/read', params);
  });
  local.threads.set('empty', fixtureThread('empty', '/fixture/project'));
  local.threads.set('local-image', fixtureThread('local-image', '/fixture/project', { turns: [fixtureTurn('turn-local', [
    { id: 'image', type: 'imageGeneration', status: 'completed', savedPath: '/fixture/project/slow.png' },
    { id: 'excluded', type: 'imageGeneration', status: 'completed', savedPath: '/fixture/project/work/internal.png' },
    { id: 'relative', type: 'imageGeneration', status: 'completed', savedPath: 'relative.png' },
    { id: 'pending', type: 'imageGeneration', status: 'inProgress', savedPath: '/fixture/project/pending.png' },
    { id: 'change', type: 'fileChange', changes: [{ path: '/fixture/project/not-output.txt' }] },
  ])] }));
  local.threads.set('retry-image', fixtureThread('retry-image', '/fixture/project', { turns: [fixtureTurn('turn-retry', [
    { id: 'retry', type: 'imageGeneration', status: 'completed', savedPath: '/fixture/project/retry.png' },
  ])] }));
  remote.threads.set('local-image', fixtureThread('local-image', '/remote/project', { turns: [fixtureTurn('turn-remote', [
    { id: 'remote', type: 'imageGeneration', status: 'completed', savedPath: '/remote/project/remote.png' },
  ])] }));
  const created = success({ threadId: 'remote-child', hostId: 'remote-fixture' });
  local.threads.set('creator', fixtureThread('creator', '/fixture/project', { turns: [fixtureTurn('turn-create', [
    { id: 'failed', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed', success: false,
      contentItems: success({ threadId: 'failed-child', hostId: 'remote-fixture' }).contentItems },
    { id: 'wrong-tool', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'read_thread', status: 'completed',
      ...success({ threadId: 'wrong-child', hostId: 'remote-fixture' }) },
    { id: 'slow-created', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed',
      ...success({ threadId: 'slow-child', hostId: 'remote-fixture' }) },
    { id: 'created', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed', ...created },
  ])] }));
  remote.threads.set('remote-child', fixtureThread('remote-child', '/remote/project', { name: 'Actual child title' }));
  remote.threads.set('slow-child', fixtureThread('slow-child', '/remote/project', { name: 'Late child title' }));
  const resources = await nativeFixture(root);
  const bundle = await build({ entryPoints: ['test/renderer-thread-summary-parity-fixture.tsx'], bundle: true, write: false,
    outdir: 'summary-parity-fixture-output', format: 'iife', jsx: 'automatic' });
  await writeFile(join(resources.renderer, 'workbench-entry.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))!.contents);
  await writeFile(join(resources.renderer, 'workbench-entry.css'), bundle.outputFiles.find(file => file.path.endsWith('.css'))!.contents);
  const app = await createNativeWorkbench({ ...resources, socketPath: local.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, port: 0,
    hostCatalog: { hosts: [{ hostId: 'remote-fixture', displayName: 'Synthetic remote', sshAlias: null, sshHost: 'fixture', sshPort: null, identity: null }],
      projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: remoteRoot, codexHome: join(remoteRoot, 'codex') }); return connect(remote.socketPath); },
    httpFetch: async () => { throw Error('External HTTP is blocked'); },
  });
  cleanup.push(() => app.close());
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    env: { ...process.env, HOME: root, CODEX_HOME: join(root, 'codex'), XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  cleanup.push(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const other = await context.newPage(); other.setDefaultTimeout(10_000);
  const errors: string[] = [];
  let observedSlowReply!: () => void;
  const slowReply = new Promise<void>(resolve => { observedSlowReply = resolve; });
  let observedSlowChildReply!: () => void;
  const slowChildReply = new Promise<void>(resolve => { observedSlowChildReply = resolve; });
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try {
      const message = JSON.parse(String(frame.payload)) as { type?: string; body?: { existingPaths?: unknown }; message?: { result?: { thread?: { id?: string } } } };
      if (message.type === 'fetch-response' && Array.isArray(message.body?.existingPaths)
        && message.body.existingPaths.includes('/fixture/project/slow.png')) observedSlowReply();
      if (message.type === 'mcp-response' && message.message?.result?.thread?.id === 'slow-child') observedSlowChildReply();
    } catch { /* Other socket messages need not contain JSON. */ }
  }));
  for (const target of [page, other]) {
    target.on('pageerror', error => errors.push(error.message));
    await target.route('**/*', route => new URL(route.request().url()).origin === app.url ? route.continue() : route.abort());
  }
  const artifactDir = process.env.YARD_TEST_ARTIFACTS;
  const key = 'thread-summary-panel-section-expanded-artifacts';
  try {
    await page.goto(app.url + '/');
    const toggle = page.getByRole('button', { name: 'Outputs', exact: true });
    await toggle.waitFor();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.yard-thread-summary__toggle')?.disabled);
    assert.equal(await page.getByText('Summary', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Create a file or site' }).count(), 2);
    const box = await page.locator('.yard-thread-summary').boundingBox();
    assert.ok(box && box.width === 300 && box.height >= 60 && box.height <= 100);
    if (artifactDir) { await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: join(artifactDir, 'card-desktop.png') }); }
    await page.getByRole('button', { name: 'Create a file or site' }).first().click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Create document', 'Create presentation', 'Create spreadsheet', 'Create site']);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('menuitem', { name: 'Create presentation' }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    for (const [label, kind] of [['Create document', 'document'], ['Create presentation', 'presentation'],
      ['Create spreadsheet', 'spreadsheet'], ['Create site', 'site']] as const) {
      await page.getByRole('button', { name: 'Create a file or site' }).last().click();
      await page.getByRole('menuitem', { name: label }).click();
      assert.deepEqual((await page.evaluate(() => window.summaryParityFixture.calls)).at(-1),
        { kind: 'create', value: kind, hostId: 'local', threadId: 'empty' });
    }
    await page.evaluate(() => window.summaryParityFixture.failCreate(true));
    await page.getByRole('button', { name: 'Create a file or site' }).first().click();
    await page.getByRole('menuitem', { name: 'Create document' }).click();
    await page.getByRole('alert').filter({ hasText: 'controlled create failure' }).waitFor();
    await page.evaluate(() => window.summaryParityFixture.failCreate(false));
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('.yard-thread-summary__toggle')?.getAttribute('aria-expanded') === 'false');
    await other.goto(app.url + '/');
    await other.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('.yard-thread-summary__toggle');
      return button && !button.disabled && button.getAttribute('aria-expanded') === 'false';
    });
    assert.deepEqual(await other.evaluate(key => window.summaryParityFixture.atom(key), key), { exists: true, value: false });
    await other.getByRole('button', { name: 'Outputs', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.yard-thread-summary__toggle')?.getAttribute('aria-expanded') === 'true');
    await page.evaluate(() => window.summaryParityFixture.show(false));
    await page.evaluate(() => window.summaryParityFixture.show(true));
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('.yard-thread-summary__toggle');
      return button && !button.disabled && button.getAttribute('aria-expanded') === 'true';
    });
    await other.evaluate(key => window.summaryParityFixture.setAtom(key, 'invalid'), key);
    await page.getByRole('alert').filter({ hasText: 'Invalid section preference' }).waitFor();
    assert.deepEqual(await other.evaluate(key => window.summaryParityFixture.atom(key), key), { exists: true, value: 'invalid' });
    assert.equal(await toggle.isEnabled(), false);
    await other.evaluate(key => window.summaryParityFixture.setAtom(key, true), key);
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.yard-thread-summary__toggle')?.disabled);
    assert.equal(await page.getByText('Invalid section preference').count(), 0);

    await page.evaluate(() => window.summaryParityFixture.select('local', 'local-image', true));
    await local.waitForCall('fs/getMetadata');
    await page.evaluate(() => window.summaryParityFixture.select('remote-fixture', 'local-image', true));
    await page.getByRole('button', { name: 'remote.png' }).waitFor();
    releaseSlow();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('No late host response')), 10_000);
      void slowReply.then(() => { clearTimeout(timeout); resolve(); }, error => { clearTimeout(timeout); reject(error); });
    });
    await page.getByRole('button', { name: 'remote.png' }).click();
    assert.equal(await page.getByText('slow.png').count(), 0);
    assert.equal(await page.getByText('not-output.txt').count(), 0);
    assert.deepEqual((await page.evaluate(() => window.summaryParityFixture.calls)).at(-1), {
      kind: 'file', value: { hostId: 'remote-fixture', cwd: '/remote/project', path: '/remote/project/remote.png' },
      hostId: 'remote-fixture', threadId: 'local-image',
    });
    assert.deepEqual(local.calls('fs/getMetadata').map(call => call.params.path), ['/fixture/project/slow.png']);
    assert.deepEqual(remote.calls('fs/getMetadata').map(call => call.params.path), ['/remote/project/remote.png']);
    await page.evaluate(() => window.summaryParityFixture.select('local', 'creator', false));
    await page.getByRole('button', { name: 'Actual child title' }).click();
    assert.deepEqual((await page.evaluate(() => window.summaryParityFixture.calls)).at(-1), {
      kind: 'created', hostId: 'local', threadId: 'creator', value: {
        hostId: 'remote-fixture', threadId: 'remote-child', label: 'Actual child title',
        source: { hostId: 'local', threadId: 'creator', turnId: 'turn-create', itemId: 'created' },
      },
    });
    assert.ok(remote.calls('thread/read').some(call => call.params.threadId === 'remote-child'));
    assert.equal(remote.calls('thread/read').some(call => ['failed-child', 'wrong-child'].includes(String(call.params.threadId))), false);
    await remote.waitFor(message => message.method === 'thread/read' && message.params.threadId === 'slow-child');
    await page.evaluate(() => window.summaryParityFixture.select('local', 'retry-image', true));
    releaseSlowChild();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('No late child response')), 10_000);
      void slowChildReply.then(() => { clearTimeout(timeout); resolve(); }, error => { clearTimeout(timeout); reject(error); });
    });
    assert.equal(await page.getByText('Late child title').count(), 0);
    await page.getByRole('alert').filter({ hasText: 'controlled metadata failure' }).waitFor();
    failRead = false;
    await page.getByRole('alert').filter({ hasText: 'controlled metadata failure' }).getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('button', { name: 'retry.png' }).waitFor();
    await page.setViewportSize({ width: 390, height: 800 });
    assert.equal(await page.locator('.yard-thread-summary').evaluate(element => element.scrollWidth > element.clientWidth), false);
    if (artifactDir) await page.screenshot({ path: join(artifactDir, 'card-mobile.png') });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.summaryParityFixture.close());
    await other.evaluate(() => window.summaryParityFixture.close());
  } catch (error) {
    releaseSlow();
    releaseSlowChild();
    if (artifactDir) { await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: join(artifactDir, 'failure.png') }); }
    throw error;
  }
});
