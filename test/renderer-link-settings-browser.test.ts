import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('link projection uses the real browser client, host settings and browser atom', {
  skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 90_000,
}, async t => {
  const directory = await mkdtemp('/tmp/yg-link-');
  const cleanup: Array<() => Promise<void>> = [async () => { await rm(directory, { recursive: true, force: true }); }];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const peer = await createFakeCodex(directory);
  cleanup.push(async () => { await peer.close(); });
  const resources = await nativeFixture(directory);
  const codexDir = join(directory, 'codex'), dataDir = join(directory, 'data');
  await mkdir(codexDir); await mkdir(dataDir);
  let externalRequests = 0;
  const app = await createNativeWorkbench({ ...resources, socketPath: peer.socketPath, codexHome: codexDir,
    dataDir, workspace: directory, port: 0, hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => { externalRequests++; throw new Error('External HTTP is blocked'); } });
  cleanup.push(async () => { await app.close(); });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { BrowserWorkbenchClient } from './src/renderer/app/client.ts';
    import { LinkSettings } from './src/renderer/browser/link-settings.ts';
    const client = new BrowserWorkbenchClient();
    let links: LinkSettings | undefined, scope = 0;
    async function start() {
      links?.close();
      await client.connect();
      await client.rpc('thread/list', { limit: 1 }, 'local');
      const connection = client.captureDaemonConnection('local');
      const originalScope = ++scope;
      links = new LinkSettings(client, { assertCurrent() {
        if (scope !== originalScope) throw new Error('Original page changed');
        connection.assertOriginal();
      } });
      links.start();
    }
    (window as any).linkFixture = {
      start, snapshot: () => links?.getSnapshot(),
      resolve: (url: string, browserPaneEnabled: boolean | null) => links?.resolve(url, { browserPaneEnabled }),
      setSetting: (key: string, value: unknown) => client.host('set-setting', { key, value }),
      setLegacy: (value: unknown) => client.host('set-persisted-atom', { key: 'desktop-link-default-destination', value }),
      changeScope: () => { scope++; }, suspend: () => client.suspend(), resume: () => client.resume(),
      close: () => { links?.close(); client.close(); },
    };
  ` }, bundle: true, format: 'iife', write: false });
  await writeFile(join(resources.renderer, 'workbench-entry.js'), bundle.outputFiles[0]!.contents);
  await writeFile(join(resources.renderer, 'workbench-entry.css'), '');
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  cleanup.push(async () => { await context.close(); });
  const page = await context.newPage();
  const sent: string[] = [], errors: string[] = [], blocked: string[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => sent.push(String(frame.payload))));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === app.url) return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  await page.goto(app.url);
  await page.waitForFunction(() => Boolean((window as any).linkFixture));
  await page.evaluate(() => (window as any).linkFixture.start());
  await page.waitForFunction(() => {
    const state = (window as any).linkFixture.snapshot();
    return state?.web.status === 'missing' && state?.local.status === 'missing' && state?.legacy.status === 'missing';
  });
  assert.equal(await page.evaluate(() => (window as any).linkFixture.snapshot().webTarget), 'external-browser');
  assert.equal(await page.evaluate(() => (window as any).linkFixture.snapshot().localTarget), 'in-app-browser');
  assert.deepEqual(await page.evaluate(() => (window as any).linkFixture.resolve('http://localhost:4311/a', null)),
    { kind: 'unavailable', reason: 'browser-capability' });

  await page.evaluate(() => (window as any).linkFixture.setLegacy('in-app-browser'));
  await page.waitForFunction(() => (window as any).linkFixture.snapshot().webTarget === 'in-app-browser');
  assert.deepEqual(await page.evaluate(() => (window as any).linkFixture.resolve('https://example.invalid/a', null)),
    { kind: 'unavailable', reason: 'browser-capability' });
  assert.deepEqual(await page.evaluate(() => (window as any).linkFixture.resolve('https://example.invalid/a', true)),
    { kind: 'open', url: 'https://example.invalid/a', local: false, target: 'in-app-browser' });
  assert.deepEqual(await page.evaluate(() => (window as any).linkFixture.resolve('https://example.invalid/a', false)),
    { kind: 'open', url: 'https://example.invalid/a', local: false, target: 'external-browser' });

  await page.evaluate(() => (window as any).linkFixture.setSetting('open-link-in-target-preference', 'external-browser'));
  await page.evaluate(() => (window as any).linkFixture.setSetting('open-local-url-in-target-preference', 'external-browser'));
  await page.waitForFunction(() => {
    const state = (window as any).linkFixture.snapshot();
    return state?.webTarget === 'external-browser' && state?.localTarget === 'external-browser';
  });
  await page.evaluate(() => (window as any).linkFixture.setSetting('open-link-in-target-preference', 'invalid-fixture-value'));
  await page.waitForFunction(() => (window as any).linkFixture.snapshot()?.web.status === 'invalid');
  assert.equal(await page.evaluate(() => (window as any).linkFixture.snapshot().webTarget), null);
  await page.evaluate(() => (window as any).linkFixture.setSetting('open-link-in-target-preference', 'external-browser'));
  await page.waitForFunction(() => (window as any).linkFixture.snapshot()?.webTarget === 'external-browser');
  const beforeClick = sent.length;
  assert.deepEqual(await page.evaluate(() => (window as any).linkFixture.resolve('http://localhost:4311/a', null)),
    { kind: 'open', url: 'http://localhost:4311/a', local: true, target: 'external-browser' });
  assert.equal(sent.length, beforeClick, 'A click does not request a new authority or setting');
  assert.ok(sent.some(frame => frame.includes('vscode://codex/get-setting') && frame.includes('open-link-in-target-preference')));
  assert.ok(sent.some(frame => frame.includes('vscode://codex/get-setting') && frame.includes('open-local-url-in-target-preference')));

  await page.evaluate(() => (window as any).linkFixture.changeScope());
  assert.deepEqual(await page.evaluate(() => (window as any).linkFixture.resolve('https://example.invalid/', false)),
    { kind: 'unavailable', reason: 'authority' });
  await page.evaluate(() => (window as any).linkFixture.start());
  await page.waitForFunction(() => (window as any).linkFixture.snapshot()?.web.status === 'value');
  await page.evaluate(() => (window as any).linkFixture.suspend());
  assert.equal(await page.evaluate(() => (window as any).linkFixture.snapshot().status), 'revoked');
  await page.evaluate(async () => { await (window as any).linkFixture.resume(); await (window as any).linkFixture.start(); });
  await page.waitForFunction(() => (window as any).linkFixture.snapshot()?.webTarget === 'external-browser');
  await page.evaluate(() => (window as any).linkFixture.close());
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).linkFixture));
  await page.evaluate(() => (window as any).linkFixture.start());
  await page.waitForFunction(() => {
    const state = (window as any).linkFixture.snapshot();
    return state?.webTarget === 'external-browser' && state?.localTarget === 'external-browser' &&
      state?.legacy.status === 'value' && state.legacy.value === 'in-app-browser';
  });
  await page.evaluate(() => (window as any).linkFixture.close());
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  assert.equal(externalRequests, 0);
});
