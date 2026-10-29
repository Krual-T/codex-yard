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

test('Sites gate uses the selected daemon and fresh public SDK evaluation', {
  skip: !existsSync(chrome) && 'Isolated Chrome is unavailable', timeout: 90_000,
}, async t => {
  const directory = await mkdtemp('/tmp/yga-');
  const cleanup: Array<() => Promise<void>> = [async () => { await rm(directory, { recursive: true, force: true }); }];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const peer = await createFakeCodex(directory);
  cleanup.push(() => peer.close());
  const resources = await nativeFixture(directory);
  const codexHome = join(directory, 'codex'), dataDir = join(directory, 'data');
  await mkdir(codexHome); await mkdir(dataDir);
  let account: 'apiKey' | 'chatgpt' | 'none' = 'apiKey';
  peer.handlers.set('account/read', () => ({ account: account === 'apiKey' ? { type: 'apiKey' }
    : account === 'chatgpt' ? { type: 'chatgpt', email: 'fixture@example.invalid', planType: 'plus' } : null,
  requiresOpenaiAuth: false }));
  const accountRead = peer.handlers.get('account/read')!;
  type Mode = 'true' | 'false' | 'hashed' | 'malformed' | 'missing' | 'error' | 'non200' | 'hold';
  let mode: Mode = 'true';
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers; mode: Mode }> = [];
  const held: Array<(response: Response) => void> = [];
  const response = (value: boolean | string | undefined, hashed = false, status = 200) => Response.json({ has_updates: true, time: Date.now(), hash_used: hashed ? 'djb2' : 'none',
    feature_gates: value === undefined ? {} : { [hashed ? '2976137496' : '637432221']: { name: hashed ? '2976137496' : '637432221',
      value, rule_id: 'fixture', secondary_exposures: [] } },
    dynamic_configs: {}, layer_configs: {}, param_stores: {}, sdkParams: {} }, { status });
  const app = await createNativeWorkbench({ ...resources, socketPath: peer.socketPath, codexHome, dataDir,
    workspace: directory, port: 0, hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async (input, init) => {
      const url = String(input), current = mode;
      const target = new URL(url);
      assert.equal(target.origin, 'https://ab.chatgpt.com');
      assert.equal(target.pathname, '/v1/initialize');
      assert.equal(init?.method, 'POST');
      assert.equal(typeof init?.body, 'string');
      requests.push({ url, body: JSON.parse(init!.body as string) as Record<string, unknown>, headers: new Headers(init?.headers), mode: current });
      if (current === 'hold') return await new Promise<Response>(resolve => held.push(resolve));
      if (current === 'error') return new Response('unavailable', { status: 400 });
      return response(current === 'missing' ? undefined : current === 'malformed' ? 'true' : current === 'true' || current === 'hashed' || current === 'non200', current === 'hashed', current === 'non200' ? 201 : 200);
    },
  });
  cleanup.push(() => app.close());
  cleanup.push(async () => { for (const resolve of held.splice(0)) resolve(response(undefined)); });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import { StrictMode, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { BrowserWorkbenchClient } from './src/renderer/app/client.ts';
    import { useAppgenGate } from './src/renderer/app/use-appgen-gate.ts';
    const client = new BrowserWorkbenchClient();
    const root = createRoot(document.getElementById('root')!);
    let current: ReturnType<typeof useAppgenGate>, setHost: (host: string) => void;
    const captured: Array<ReturnType<typeof useAppgenGate>> = [];
    function valid(gate: ReturnType<typeof useAppgenGate>) {
      try { gate.assertCurrent(); return true; } catch { return false; }
    }
    function Probe() {
      const [host, set] = useState('local'); setHost = set;
      current = useAppgenGate(client, host);
      return <div id="gate">{current.enabled === undefined ? 'unknown' : String(current.enabled)}</div>;
    }
    root.render(<StrictMode><Probe /></StrictMode>);
    (window as any).gateFixture = {
      snapshot: () => ({ enabled: current?.enabled ?? null, sourceKey: current?.sourceKey, valid: current ? valid(current) : false }),
      capture: () => { captured.push(current); return captured.length - 1; },
      capturedValid: (index: number) => valid(captured[index]!),
      host: (host: string) => flushSync(() => setHost(host)),
      suspend: () => client.suspend(), resume: () => client.resume(),
      connectDaemon: () => client.rpc('account/read', { refreshToken: false }, 'local'),
      close: () => { root.unmount(); client.close(); },
    };
  ` }, bundle: true, format: 'iife', jsx: 'automatic', write: false });
  await writeFile(join(resources.renderer, 'workbench-entry.js'), bundle.outputFiles[0]!.contents);
  await writeFile(join(resources.renderer, 'workbench-entry.css'), '');
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  cleanup.push(() => context.close());
  const page = await context.newPage();
  const errors: string[] = [], blocked: string[] = [], consoleErrors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === app.url) return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  await page.goto(app.url);
  try {
    await page.waitForFunction(() => (window as any).gateFixture?.snapshot().enabled === true, undefined, { timeout: 8_000 });
  } catch {
    assert.fail(JSON.stringify({ snapshot: await page.evaluate(() => (window as any).gateFixture?.snapshot()),
      accountReads: peer.calls('account/read').length, requests: requests.length, errors, consoleErrors, blocked }));
  }
  const first = await page.evaluate(() => (window as any).gateFixture.capture());
  const firstSnapshot = await page.evaluate(() => (window as any).gateFixture.snapshot());
  assert.equal(firstSnapshot.valid, true);
  assert.ok(peer.calls('account/read').some(call => call.params.refreshToken === false));
  assert.equal(requests[0]?.headers.has('authorization'), false);
  const user = requests[0]?.body.user as Record<string, unknown>;
  const ids = user.customIDs as Record<string, unknown>;
  assert.equal(user.userID, `ua-${ids.stableID}`);
  assert.equal(ids.source_surface_stable_id, ids.stableID);
  assert.equal((user.custom as Record<string, unknown>).auth_method, 'apikey');
  assert.ok(!JSON.stringify(requests[0]?.body).includes('fixture@example.invalid'));

  mode = 'hold';
  peer.broadcast({ method: 'account/updated', params: {} });
  await page.waitForFunction(() => (window as any).gateFixture?.snapshot().enabled === null);
  await t.test('a pending evaluation is revoked on account change', async () => {
    await waitFor(() => held.length === 1);
    assert.equal(await page.evaluate(index => (window as any).gateFixture.capturedValid(index), first), false);
    account = 'chatgpt'; mode = 'false';
    peer.broadcast({ method: 'account/updated', params: {} });
    await page.waitForFunction(() => (window as any).gateFixture?.snapshot().enabled === false);
    const chatgpt = requests.at(-1)?.body.user as Record<string, unknown>;
    assert.equal(chatgpt.email, 'fixture@example.invalid');
    assert.equal(chatgpt.userID, undefined);
    assert.equal((chatgpt.custom as Record<string, unknown>).auth_status, 'logged_in');
    assert.equal((chatgpt.custom as Record<string, unknown>).auth_method, 'chatgpt');
    assert.equal((chatgpt.custom as Record<string, unknown>).plan_type, 'plus');
    assert.equal((chatgpt.customIDs as Record<string, unknown>).stableID, ids.stableID);
    held.shift()!(response(true));
    await page.waitForTimeout(150);
    assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, false);
    assert.ok(!JSON.stringify(requests.at(-1)?.body).includes('authToken'));
  });

  account = 'apiKey'; mode = 'false';
  const chatgptSource = (await page.evaluate(() => (window as any).gateFixture.snapshot())).sourceKey;
  peer.broadcast({ method: 'account/updated', params: {} });
  await page.waitForFunction(previous => {
    const value = (window as any).gateFixture?.snapshot();
    return value?.enabled === false && value.sourceKey !== previous;
  }, chatgptSource);
  const second = await page.evaluate(() => (window as any).gateFixture.capture());
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).valid, true);
  assert.notEqual((await page.evaluate(() => (window as any).gateFixture.snapshot())).sourceKey, firstSnapshot.sourceKey);
  assert.equal((requests.at(-1)?.body.user as Record<string, unknown>).userID, user.userID);
  assert.equal(await page.evaluate(index => (window as any).gateFixture.capturedValid(index), first), false);

  mode = 'missing';
  const missingResponse = page.waitForResponse(res => res.url().endsWith('/api/http-fetch'));
  peer.broadcast({ method: 'account/updated', params: {} });
  await missingResponse;
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, null);
  assert.equal(await page.evaluate(index => (window as any).gateFixture.capturedValid(index), second), false);
  assert.ok(requests.every(request => request.body.sinceTime === undefined || request.body.sinceTime === 0));

  mode = 'error';
  const errorResponse = page.waitForResponse(res => res.url().endsWith('/api/http-fetch'));
  peer.broadcast({ method: 'account/updated', params: {} });
  await errorResponse;
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, null);

  mode = 'non200';
  const non200Response = page.waitForResponse(res => res.url().endsWith('/api/http-fetch'));
  peer.broadcast({ method: 'account/updated', params: {} });
  await non200Response;
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, null);

  const previousReads = peer.calls('account/read').length, previousRequests = requests.length;
  const failedSource = (await page.evaluate(() => (window as any).gateFixture.snapshot())).sourceKey;
  peer.handlers.set('account/read', () => { throw new Error('Synthetic account read failed'); });
  peer.broadcast({ method: 'account/updated', params: {} });
  await page.waitForFunction(previous => {
    const value = (window as any).gateFixture?.snapshot();
    return value?.enabled === null && value.sourceKey !== previous;
  }, failedSource);
  await waitFor(() => peer.calls('account/read').length > previousReads);
  await page.waitForTimeout(100);
  assert.equal(requests.length, previousRequests);
  peer.handlers.set('account/read', accountRead);

  mode = 'malformed';
  const malformedResponse = page.waitForResponse(res => res.url().endsWith('/api/http-fetch'));
  peer.broadcast({ method: 'account/updated', params: {} });
  await malformedResponse;
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, null);

  mode = 'hashed';
  peer.broadcast({ method: 'account/updated', params: {} });
  await page.waitForFunction(() => (window as any).gateFixture?.snapshot().enabled === true);
  assert.equal(requests.at(-1)?.body.hash, 'djb2');

  const hashedSource = (await page.evaluate(() => (window as any).gateFixture.snapshot())).sourceKey;
  account = 'none'; mode = 'true';
  peer.broadcast({ method: 'account/updated', params: {} });
  await page.waitForFunction(previous => {
    const value = (window as any).gateFixture?.snapshot();
    return value?.enabled === true && value.sourceKey !== previous;
  }, hashedSource);
  const signedOut = requests.at(-1)?.body.user as Record<string, unknown>;
  assert.equal(signedOut.userID, undefined);
  assert.equal(signedOut.email, undefined);
  assert.equal((signedOut.custom as Record<string, unknown>).auth_method, undefined);
  assert.equal((signedOut.custom as Record<string, unknown>).auth_status, 'logged_out');

  const signedOutSource = (await page.evaluate(() => (window as any).gateFixture.snapshot())).sourceKey;
  account = 'apiKey';
  mode = 'true';
  peer.broadcast({ method: 'account/updated', params: {} });
  await page.waitForFunction(previous => {
    const value = (window as any).gateFixture?.snapshot();
    return value?.enabled === true && value.sourceKey !== previous;
  }, signedOutSource);
  const third = await page.evaluate(() => (window as any).gateFixture.capture());
  await page.evaluate(() => (window as any).gateFixture.host('missing-host'));
  assert.equal(await page.evaluate(index => (window as any).gateFixture.capturedValid(index), third), false);
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, null);
  await page.evaluate(() => (window as any).gateFixture.host('local'));
  await page.waitForFunction(() => (window as any).gateFixture?.snapshot().enabled === true);
  assert.equal(await page.evaluate(index => (window as any).gateFixture.capturedValid(index), third), false);

  mode = 'hold';
  peer.broadcast({ method: 'account/updated', params: {} });
  await waitFor(() => held.length === 1);
  const pendingSource = (await page.evaluate(() => (window as any).gateFixture.snapshot())).sourceKey;
  peer.disconnectAll();
  await page.waitForFunction(previous => {
    const value = (window as any).gateFixture?.snapshot();
    return value?.enabled === null && value.sourceKey !== previous;
  }, pendingSource);
  held.shift()!(response(true));
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, null);
  mode = 'false';
  await page.evaluate(() => (window as any).gateFixture.connectDaemon());
  await page.waitForFunction(() => (window as any).gateFixture?.snapshot().enabled === false);
  const fourth = await page.evaluate(() => (window as any).gateFixture.capture());
  await page.evaluate(() => (window as any).gateFixture.suspend());
  assert.equal(await page.evaluate(index => (window as any).gateFixture.capturedValid(index), fourth), false);
  assert.equal((await page.evaluate(() => (window as any).gateFixture.snapshot())).enabled, null);
  await page.evaluate(() => (window as any).gateFixture.resume());
  await page.evaluate(() => (window as any).gateFixture.connectDaemon());
  await page.waitForFunction(() => (window as any).gateFixture?.snapshot().enabled === false);
  const last = await page.evaluate(() => (window as any).gateFixture.capture());
  await page.evaluate(() => (window as any).gateFixture.close());
  assert.equal(await page.evaluate(index => (window as any).gateFixture.capturedValid(index), last), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the synthetic configuration request');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
