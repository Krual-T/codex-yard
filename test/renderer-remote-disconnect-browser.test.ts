import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread } from './fake-codex.ts';

const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('the actual App bounds disconnected remote reads and preserves the draft through explicit reconnect', {
  skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 45_000,
}, async t => {
  const directory = await mkdtemp('/tmp/yard-remote-loss-');
  const cleanup: Array<() => Promise<unknown>> = [() => rm(directory, { recursive: true, force: true })];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const local = await createFakeCodex(directory);
  cleanup.push(() => local.close());
  const remoteRoot = join(directory, 'remote'), codexHome = join(directory, 'codex'), dataDir = join(directory, 'data');
  await mkdir(remoteRoot); await mkdir(codexHome); await mkdir(dataDir);
  const remote = await createFakeCodex(remoteRoot);
  cleanup.push(() => remote.close());
  const remoteHostId = 'remote-owned-disconnect';
  remote.threads.set('remote-check', fixtureThread('remote-check', remoteRoot, { name: 'Retained remote chat' }));
  local.handlers.set('initialize', () => ({ ...local.defaultResult('initialize', {}), codexHome }));
  remote.handlers.set('initialize', () => ({ ...remote.defaultResult('initialize', {}), codexHome: join(remoteRoot, 'codex') }));
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {}, settings: { localeOverride: 'en-US' } }));
  let available = true, connectionAttempts = 0;
  const app = await createNativeWorkbench({ port: 0, socketPath: local.socketPath, codexHome, dataDir, workspace: directory,
    hostCatalog: { hosts: [{ hostId: remoteHostId, displayName: 'Owned remote', sshAlias: 'owned', sshHost: 'owned',
      sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: (_host, onPaths) => {
      connectionAttempts++;
      if (!available) throw new Error('Synthetic remote connection is unavailable');
      onPaths?.({ homeDirectory: remoteRoot, codexHome: join(remoteRoot, 'codex') });
      return createConnection({ path: remote.socketPath });
    } });
  cleanup.push(() => app.close());
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), { executablePath: chrome, headless: true,
    viewport: { width: 1280, height: 800 }, args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking'] });
  cleanup.push(() => context.close());
  await context.addInitScript(() => {
    const stats = { total: 0, active: 0 };
    (window as any).disconnectIdb = stats;
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const transaction = original.apply(this, args);
      stats.total++; stats.active++;
      const complete = () => { stats.active--; };
      transaction.addEventListener('complete', complete, { once: true });
      transaction.addEventListener('abort', complete, { once: true });
      return transaction;
    };
  });
  const page = await context.newPage(), errors: string[] = [];
  page.setDefaultTimeout(8_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === app.url ? route.continue() : route.abort());
  let outage = false, requests = 0;
  let rejectStorm!: (error: Error) => void;
  const storm = new Promise<never>((_resolve, reject) => { rejectStorm = reject; });
  page.on('websocket', socket => socket.on('framesent', frame => {
    let message: { type?: string; hostId?: string };
    try { message = JSON.parse(String(frame.payload)); } catch { return; }
    if (outage && message.type === 'mcp-request' && message.hostId === remoteHostId && ++requests > 64) {
      rejectStorm(new Error('Disconnected remote reads caused more than 64 RPCs without a user action.'));
    }
  }));
  await Promise.race([storm, (async () => {
    await page.goto(app.url + '/local/remote-check?hostId=' + remoteHostId);
    const draft = page.getByRole('textbox', { name: 'Work with Codex', exact: true });
    await draft.fill('KEEP_REMOTE_DRAFT_ACROSS_BRIDGE');
    await page.evaluate(() => {
      const root = document.querySelector('[data-owned-renderer]')!;
      const key = Object.keys(root).find(value => value.startsWith('__reactFiber$'))!;
      for (let fiber = (root as any)[key]; fiber; fiber = fiber.return) {
        if (fiber.memoizedProps?.client) { (window as any).disconnectClient = fiber.memoizedProps.client; return; }
      }
      throw new Error('The actual App client was not mounted.');
    });
    await page.waitForFunction(hostId => {
      try { return !!(window as any).disconnectClient.captureDaemonConnection(hostId).generation; } catch { return false; }
    }, remoteHostId);
    await page.getByRole('button', { name: 'Retained remote chat', exact: true }).waitFor();
    await page.evaluate(hostId => {
      (window as any).originalRemoteConnection = (window as any).disconnectClient.captureDaemonConnection(hostId);
    }, remoteHostId);
    const beforeAtoms = await page.evaluate(() => (window as any).disconnectIdb.total as number);
    const beforeAttempts = connectionAttempts;
    outage = true; available = false; remote.disconnectAll();
    const reconnect = page.getByRole('button', { name: 'Reconnect host', exact: true });
    await reconnect.waitFor();
    await page.evaluate(async () => { const client = (window as any).disconnectClient; client.suspend(); await client.resume(); });
    await reconnect.waitFor();
    await page.getByRole('status').filter({ hasText: 'Host disconnected' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).disconnectClient.connected), true);
    assert.equal(await page.evaluate(hostId => {
      try { (window as any).disconnectClient.captureDaemonConnection(hostId); return true; } catch { return false; }
    }, remoteHostId), false);
    await reconnect.click();
    await page.locator('.yard-error[role="alert"]').filter({ hasText: 'Synthetic remote connection is unavailable' }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 250));
    assert(requests < 20, 'disconnect notifications must not recursively start remote reads');
    assert(connectionAttempts - beforeAttempts < 20, 'unavailable transports must not recursively reconnect');
    const stored = await page.evaluate(async () => (window as any).disconnectClient.host('get-persisted-atom', { key: 'codex-yard.send-recovery.v1' }));
    assert.equal(typeof stored.exists, 'boolean');
    const atoms = await page.evaluate(() => (window as any).disconnectIdb as { total: number; active: number });
    assert(atoms.total - beforeAtoms < 30, 'remote failure must not repeatedly reload unrelated browser atoms');
    assert.equal(await draft.inputValue(), 'KEEP_REMOTE_DRAFT_ACROSS_BRIDGE');
    assert.equal(remote.calls('turn/start').length, 0);
    available = true;
    await reconnect.click();
    await page.waitForFunction(hostId => {
      try { return !!(window as any).disconnectClient.captureDaemonConnection(hostId).generation; } catch { return false; }
    }, remoteHostId);
    assert.equal(await page.evaluate(() => {
      try { (window as any).originalRemoteConnection.assertOriginal(); return true; } catch { return false; }
    }), false);
    assert.equal(await draft.inputValue(), 'KEEP_REMOTE_DRAFT_ACROSS_BRIDGE');
    assert.equal(remote.calls('turn/start').length, 0);
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ requests, reconnectAttempts: connectionAttempts - beforeAttempts,
      atomTransactions: atoms.total - beforeAtoms, source: 'actual browser entry and native host; disposable synthetic remote peer' }));
  })()]);
});
