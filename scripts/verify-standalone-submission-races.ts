import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';

// Real App and IndexedDB; the disposable protocol peer never requests a model.
const artifacts = process.env.YARD_TEST_ARTIFACTS;
if (!artifacts) throw new Error('Set an isolated YARD_TEST_ARTIFACTS directory.');
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp('/tmp/yard-send-races-');
const fake = await createFakeCodex(root);
fake.threads.set('race', fixtureThread('race', root, { turns: [fixtureTurn('prior', [agentItem('ready', 'Race thread ready')])] }));
fake.handlers.set('thread/goal/get', () => ({ goal: null }));
let resolveTurn: (() => void) | undefined;
fake.handlers.set('turn/start', params => new Promise(resolve => {
  resolveTurn = () => { resolveTurn = undefined; resolve(fake.defaultResult('turn/start', params)); };
}));
const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  dataDir: join(root, 'data'), workspace: root, port: 0, hostCatalog: { hosts: [], projects: [], assignments: {} } });
const browser = await chromium.launchPersistentContext(join(root, 'browser'), { executablePath: '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
const errors: string[] = [], checks: string[] = [];
const open = async () => {
  const target = await browser.newPage(); target.on('pageerror', error => errors.push(error.message));
  await target.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  return target;
};
const readSends = (target: Page) => target.evaluate(async () => {
  const element = document.querySelector('[data-owned-renderer]')!;
  const fiber = Object.keys(element).find(key => key.startsWith('__reactFiber$'))!;
  for (let node = (element as any)[fiber]; node; node = node.return) {
    if (node.memoizedProps?.client) return (await node.memoizedProps.client.host('get-persisted-atom', { key: 'codex-yard.send-recovery.v1' })).value;
  }
  throw new Error('Actual App client missing');
});
let first: Page | undefined;
try {
  first = await open();
  await first.goto(app.url + '/local/race');
  await first.getByText('Race thread ready', { exact: true }).waitFor();
  const input = first.locator('.standalone-composer textarea');
  await input.fill('ORIGINAL_SAME_TOKEN_SEND');
  await first.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const value = args[0] as any;
      const intent = Object.values(value?.atoms?.['codex-yard.send-recovery.v1']?.requests ?? {}).find((entry: any) =>
        entry.draft?.text === 'ORIGINAL_SAME_TOKEN_SEND' && entry.stage === 'prepared');
      if (intent) {
        IDBObjectStore.prototype.put = original;
        const transaction = this.transaction, complete = transaction.oncomplete;
        // Commit the real transaction, but hold its original caller's completion.
        // Another document can now observe prepared with the same original token.
        transaction.oncomplete = event => {
          (window as any).preparePaused = true;
          (window as any).releasePrepare = () => { complete?.call(transaction, event); };
        };
      }
      return original.apply(this, args);
    };
  });
  await first.locator('.standalone-composer__submit').click();
  await first.waitForFunction(() => (window as any).preparePaused === true);
  const original = Object.values((await readSends(first)).requests)[0] as any;
  assert.equal(original.stage, 'prepared');
  const second = await open();
  await second.addInitScript(() => {
    const Original = BroadcastChannel;
    (window as any).holdAtomNotifications = true;
    (window as any).BroadcastChannel = class extends Original {
      constructor(name: string) {
        super(name);
        this.addEventListener('message', event => {
          if ((window as any).holdAtomNotifications) event.stopImmediatePropagation();
        });
      }
    };
  });
  await second.goto(app.url + '/local/race');
  const recovery = second.getByRole('region', { name: 'Message send recovery', exact: true });
  await recovery.getByRole('button', { name: 'Retry original send', exact: true }).waitFor();
  assert.equal((Object.values((await readSends(second)).requests)[0] as any).attemptId, original.attemptId);
  await first.evaluate(() => (window as any).releasePrepare());
  await first.waitForFunction(() => document.querySelector('.standalone-composer__submit')?.hasAttribute('disabled'));
  await fake.waitFor(message => message.method === 'turn/start');
  const sending = (await readSends(first)).requests[original.id];
  assert.equal(sending.stage, 'sending'); assert.equal(sending.attemptId, original.attemptId);
  await recovery.getByRole('button', { name: 'Retry original send', exact: true }).click();
  await recovery.getByText('原发送结果尚未核对，未重复发送。', { exact: true }).waitFor();
  const after = (await readSends(second)).requests[original.id];
  assert.equal(after.stage, 'sending', 'A retry without a newly acquired attempt cannot downgrade the original in-flight send.');
  assert.equal(after.attemptId, original.attemptId);
  assert.equal(fake.calls('turn/start').length, 1);
  checks.push('two real App documents share the original prepared token; an unacquired retry cannot alter its in-flight phase or send again');
  resolveTurn!();
  await first.getByRole('region', { name: 'Message send recovery', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual((await readSends(first)).requests, {});
  assert.deepEqual(errors, []);
  await first.screenshot({ path: join(artifacts, 'confirmed.png'), fullPage: true });
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ checks, errors, original, before: sending, after,
    protocol: fake.messages.map(message => ({ method: message.method, params: message.params })),
    backend: 'isolated synthetic peer; no CLI or real inference' }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ error: String(error), checks, errors,
    sends: first ? await readSends(first).catch(String) : null }, null, 2));
  throw error;
} finally {
  resolveTurn?.();
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
