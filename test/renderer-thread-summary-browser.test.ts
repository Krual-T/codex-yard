import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';
import type {} from './renderer-thread-summary-fixture.tsx';

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('summary consumes the shared conversation and host read with scoped actions and recovery', {
  skip: !existsSync(chrome) && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ys-'));
  const cleanup: Array<() => Promise<void>> = [async () => { await rm(root, { recursive: true, force: true }); }];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const local = await createFakeCodex(root); cleanup.push(() => local.close());
  const remoteRoot = join(root, 'remote'); await mkdir(remoteRoot);
  const remote = await createFakeCodex(remoteRoot); cleanup.push(() => remote.close());
  const turn = fixtureTurn('turn-a', [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'fixture' }, { type: 'localImage', path: '/fixture/project/input.png' }] },
    { id: 'plan', type: 'plan', text: '# Inspect the change' },
    { id: 'search', type: 'webSearch', query: 'integration query', action: { type: 'openPage', url: 'https://example.test/page' } },
    { id: 'tool', type: 'mcpToolCall', server: 'fixture-tool', tool: 'lookup' },
    { id: 'change', type: 'fileChange', changes: [{ path: '/fixture/project/not-output.ts' }] },
  ]);
  local.threads.set('thread-a', fixtureThread('thread-a', '/fixture/project', { turns: [turn] }));
  local.threads.set('thread-b', fixtureThread('thread-b', '/fixture/project', { turns: [] }));
  remote.threads.set('thread-a', fixtureThread('thread-a', '/remote/project', { turns: [
    fixtureTurn('remote-turn', [{ id: 'remote-plan', type: 'plan', text: '# Remote plan' }]),
  ] }));
  const resources = await nativeFixture(root);
  const bundle = await build({ entryPoints: ['test/renderer-thread-summary-fixture.tsx'], bundle: true, write: false,
    outdir: 'summary-fixture-output', format: 'iife', jsx: 'automatic' });
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
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  cleanup.push(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === app.url ? route.continue() : route.abort());
  const artifactDir = process.env.YARD_TEST_ARTIFACTS;
  try {
    await page.goto(app.url + '/');
    await page.getByRole('button', { name: 'input.png' }).waitFor();
    assert.ok(local.calls('thread/read').some(call => call.params.threadId === 'thread-a'));
    assert.ok(local.calls('thread/turns/list').some(call => call.params.threadId === 'thread-a'));
    assert.equal(local.calls('thread/goal/get').length, 0);
    await page.getByRole('button', { name: 'Saved goal' }).click();
    await page.getByRole('button', { name: /Scheduled task/ }).click();
    await page.getByRole('button', { name: 'Inspect the change', exact: true }).click();
    await page.getByRole('button', { name: 'input.png' }).click();
    await page.getByRole('button', { name: 'fixture-tool' }).click();
    await page.getByRole('button', { name: 'Web search' }).click();
    assert.equal(await page.getByRole('button', { name: 'Current side chat' }).locator('.yard-thread-summary__spinner').count(), 1);
    await page.getByRole('button', { name: 'Current side chat' }).click();
    await page.getByRole('button', { name: 'Saved side chat' }).click();
    await page.getByRole('alert').filter({ hasText: 'synthetic restore failure' }).waitFor();
    await page.evaluate(() => window.threadSummaryFixture.restoreFailure(false));
    await page.getByRole('button', { name: 'Saved side chat' }).click();
    await page.getByRole('alert').filter({ hasText: 'synthetic association read failure' }).getByRole('button', { name: 'Retry' }).click();
    assert.equal(await page.getByText('synthetic association read failure').count(), 0);
    await page.getByRole('button', { name: 'Side chats', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Current side chat' }).count(), 0);
    await page.getByRole('button', { name: 'Side chats 2' }).click();
    assert.equal(await page.getByText('Wrong host side chat').count(), 0);
    assert.equal(await page.getByText('Wrong thread side chat').count(), 0);
    assert.equal(await page.getByText('Duplicate saved association').count(), 0);
    const outputs = page.locator('section').filter({ has: page.getByRole('button', { name: 'Outputs', exact: true }) });
    assert.equal(await outputs.getByText('output-four.txt').count(), 0);
    await outputs.getByRole('button', { name: 'View all' }).click();
    await outputs.getByRole('button', { name: 'output-four.txt' }).click();
    await outputs.getByRole('button', { name: 'Retry' }).click();
    assert.equal(await outputs.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: /Review agent/ }).click();
    await page.getByRole('button', { name: /npm test/ }).click();
    await page.getByRole('button', { name: 'Stop all background terminals' }).click();
    await page.getByRole('button', { name: 'Created chat', exact: true }).click();
    await page.getByRole('button', { name: 'Add sources' }).click();
    const calls = await page.evaluate(() => window.threadSummaryFixture.calls);
    assert.deepEqual(calls.find(call => call.kind === 'show')?.value,
      { hostId: 'local', parentThreadId: 'thread-a', draftId: 'active-draft', prepareId: 'active-prepare' });
    assert.deepEqual(calls.filter(call => call.kind === 'restore').map(call => call.value), [
      { hostId: 'local', parentThreadId: 'thread-a', draftId: 'saved-draft', prepareId: 'saved-prepare' },
      { hostId: 'local', parentThreadId: 'thread-a', draftId: 'saved-draft', prepareId: 'saved-prepare' },
    ]);
    assert.deepEqual(calls.find(call => call.kind === 'file')?.value,
      { hostId: 'local', cwd: '/fixture/project', path: '/fixture/project/input.png' });
    assert.deepEqual(calls.find(call => call.kind === 'plan')?.value,
      { hostId: 'local', threadId: 'thread-a', cwd: '/fixture/project', turnId: 'turn-a', itemId: 'plan', text: '# Inspect the change' });
    assert.deepEqual(calls.find(call => call.kind === 'web')?.value,
      { kind: 'web', queries: ['integration query'], urls: ['https://example.test/page'] });
    assert.deepEqual(calls.filter(call => call.kind === 'automation').map(call => {
      const value = call.value as { kind: string; entry: { sourceKey: string; item: { id: string } } };
      return [value.kind, value.entry.sourceKey, value.entry.item.id];
    }), [['goal', 'local', 'saved-goal'], ['scheduled', 'local', 'scheduled-task']]);
    for (const kind of ['tool', 'output', 'retry-outputs', 'retry-side-chats', 'agent', 'process', 'stop-processes', 'created', 'add-source']) {
      assert.ok(calls.some(call => call.kind === kind), kind);
    }
    await page.evaluate(() => window.threadSummaryFixture.locale('zh-CN'));
    await page.getByRole('button', { name: '侧聊', exact: true }).waitFor();
    await page.getByText('网页搜索').waitFor();
    await page.evaluate(() => window.threadSummaryFixture.locale('zh-TW'));
    await page.getByRole('button', { name: '側聊', exact: true }).waitFor();
    await page.evaluate(() => window.threadSummaryFixture.locale('en-US'));
    await page.locator('.yard-thread-summary__content').evaluate(element => { element.scrollTop = 0; });
    const overflow = await page.locator('.yard-thread-summary').evaluate(element => element.scrollWidth > element.clientWidth);
    assert.equal(overflow, false);
    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true });
      await page.screenshot({ path: join(artifactDir, 'summary-mobile.png') });
      await page.setViewportSize({ width: 1100, height: 800 });
      await page.screenshot({ path: join(artifactDir, 'summary-desktop.png') });
    }

    await page.evaluate(() => window.threadSummaryFixture.holdShow(true));
    await page.getByRole('button', { name: 'Current side chat' }).click();
    await page.evaluate(() => window.threadSummaryFixture.select('remote-fixture', 'thread-a'));
    await page.getByRole('button', { name: 'Remote plan' }).waitFor();
    assert.ok(remote.calls('thread/read').some(call => call.params.threadId === 'thread-a'));
    assert.equal(remote.calls('thread/goal/get').length, 0);
    await page.evaluate(() => window.threadSummaryFixture.failHeldShow());
    assert.equal(await page.getByText('late synthetic show failure').count(), 0);
    assert.equal(await page.getByText('input.png').count(), 0);
    assert.equal(await page.getByText('Saved goal').count(), 0);
    assert.equal(await page.getByText('Current side chat').count(), 0);
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.threadSummaryFixture.close());
  } catch (error) {
    if (artifactDir) { await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: join(artifactDir, 'summary-failure.png') }); }
    throw error;
  }
});
