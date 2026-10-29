import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';
import { draftKey, emptyDraft } from '../src/renderer/composer/standalone-draft.ts';
import { composerDraftAtomKey } from '../src/renderer/composer/composer-draft-store.ts';

const artifacts = process.env.YARD_TEST_ARTIFACTS;
if (!artifacts) throw new Error('Set YARD_TEST_ARTIFACTS to a dedicated evidence directory.');
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp('/tmp/yard-disabled-mini-');
const fake = await createFakeCodex(temporary);
for (const [id, name] of [['main-a', 'Main scope A'], ['main-b', 'Main scope B']] as const) {
  fake.threads.set(id, fixtureThread(id, temporary, { name, turns: [fixtureTurn(id + '-turn', [agentItem(id + '-answer', name + ' answer')])] }));
}
const dataDir = join(temporary, 'data'); await mkdir(dataDir);
const originalGlobals = { 'electron-avatar-overlay-open': true, 'web-pet-position': { x: 0.8, y: 0.2 } };
await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: originalGlobals, settings: {
  localeOverride: 'en-US', 'avatar-overlay-pet-visible': true, 'pet-visibility': 'always-visible', 'selected-avatar-id': 'cat',
} }));
const miniOwner = { hostId: 'local', threadId: 'main-a', draftId: 'mini:preserved-user-draft' };
const miniKey = draftKey({ ...miniOwner, cwd: temporary });
const miniEntry = { versions: [{ owner: miniOwner, revision: 'preserved-revision', prefills: [],
  draft: { ...emptyDraft(), text: 'EXISTING_MINI_DRAFT_MUST_SURVIVE' } }], retained: [] };
const pointer = JSON.stringify({ ...miniOwner, cwd: temporary });
const app = await createNativeWorkbench({ socketPath: fake.socketPath, workspace: temporary, dataDir,
  codexHome: join(temporary, 'codex'), port: 0 });
const context = await chromium.launchPersistentContext(join(temporary, 'browser'), { executablePath: '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--disable-background-networking'], viewport: { width: 1280, height: 900 } });
const page = await context.newPage(); page.setDefaultTimeout(15_000);
const checks: string[] = [], errors: string[] = [], requests: string[] = [];
page.on('pageerror', cause => errors.push(cause.message));
page.on('request', request => requests.push(request.url()));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
let staleWake: WebSocket | undefined;
const readDrafts = () => page.evaluate(async atom => new Promise<Record<string, { versions: { owner: { threadId: string | null }; draft: { text: string } }[] }>>((resolve, reject) => {
  const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result, transaction = database.transaction('atoms', 'readonly');
    const read = transaction.objectStore('atoms').get('native-atoms');
    read.onerror = () => reject(read.error);
    read.onsuccess = () => resolve(read.result.atoms[atom].entries);
    transaction.oncomplete = () => database.close();
  };
}), composerDraftAtomKey);
try {
  await page.goto(app.url + '/site.webmanifest');
  await page.evaluate(({ atom, miniKey, miniEntry, pointer }) => {
    localStorage.setItem('native-atoms', JSON.stringify({ [atom]: { version: 1, archive: {}, claims: {}, initialized: {}, entries: { [miniKey]: miniEntry } } }));
    sessionStorage.setItem('codex-yard.mini-target.v1', pointer);
    sessionStorage.setItem('codex-yard.mini-draft-identities.v1', JSON.stringify({ '["local","main-a"]': 'mini:preserved-user-draft' }));
  }, { atom: composerDraftAtomKey, miniKey, miniEntry, pointer });
  await page.goto(app.url + '/local/main-a');
  const main = page.locator('.yard-chat-pane');
  await main.getByText('Main scope A answer', { exact: true }).waitFor();
  const input = main.getByRole('textbox', { name: 'Work with Codex', exact: true });
  await input.fill('MAIN_DRAFT_BEFORE_NAVIGATION');
  await page.getByRole('button', { name: 'Main scope B', exact: true }).click();
  await main.getByText('Main scope B answer', { exact: true }).waitFor();
  assert(Object.values(await readDrafts()).some(entry => entry.versions.some(version =>
    version.owner.threadId === 'main-a' && version.draft.text === 'MAIN_DRAFT_BEFORE_NAVIGATION')));
  await page.getByRole('button', { name: 'Main scope A', exact: true }).click();
  await main.getByText('Main scope A answer', { exact: true }).waitFor();
  // Thread rendering and the composer's IDB hydration are separate operations.
  // Check the committed draft above, then await that exact projection below.
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('.yard-chat-pane textarea[aria-label="Work with Codex"]')?.value === 'MAIN_DRAFT_BEFORE_NAVIGATION');
  assert.equal(await input.inputValue(), 'MAIN_DRAFT_BEFORE_NAVIGATION');
  checks.push('Main navigation saves and restores its draft without Mini ownership or navigation leases');

  const socketOpened = page.waitForEvent('websocket');
  await page.reload();
  const mainSocket = await socketOpened;
  await main.getByText('Main scope A answer', { exact: true }).waitFor();
  const broadcastReceived = mainSocket.waitForEvent('framereceived', { timeout: 15_000, predicate: event => {
    try { const message = JSON.parse(String(event.payload)); return message.type === 'workbench-pet-state' && message.state?.isOpen === true; }
    catch { return false; }
  } });
  staleWake = new WebSocket(app.url.replace(/^http/, 'ws') + '/native-host', { headers: { origin: app.url } });
  await once(staleWake, 'open');
  const replied = new Promise<void>((resolve, reject) => staleWake!.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.requestId !== 'stale-mini-wake') return;
    if (message.responseType === 'error') reject(new Error(String(message.error))); else resolve();
  }));
  staleWake.send(JSON.stringify({ type: 'fetch', requestId: 'stale-mini-wake', url: 'vscode://codex/pet-overlay',
    body: JSON.stringify({ message: { type: 'workbench-pet-position', position: originalGlobals['web-pet-position'] } }) }));
  await Promise.all([replied, broadcastReceived]);
  for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('.yard-mini, .yard-mini-pet, [aria-label="Open Mini"], [aria-label="Mini conversation"]').count(), 0);
    assert.equal(await main.getAttribute('inert'), null);
    assert.equal(await input.isEditable(), true);
    await page.screenshot({ path: join(artifacts, `disabled-mini-${width}.png`), fullPage: true });
  }
  checks.push('Persisted pet-enabled state and a real stale host wake broadcast create no Mini/Pets overlay or input freeze at 1280/800/390');
  await input.fill('MAIN_SEND_WITH_MINI_DISABLED');
  await main.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('.standalone-composer textarea[aria-label="Work with Codex"]')?.value === '');
  assert.equal(fake.calls('turn/start').length, 1);
  assert.equal(fake.calls('turn/start')[0]!.params.threadId, 'main-a');
  assert(fake.calls('turn/start')[0]!.params.input && JSON.stringify(fake.calls('turn/start')[0]!.params.input).includes('MAIN_SEND_WITH_MINI_DISABLED'));
  checks.push('The actual Main composer sends once to its original thread through the real browser client and host');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('complementary', { name: 'Settings navigation', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pets', exact: true }).count(), 0);
  checks.push('Settings has no Pets entry');
  const preserved = await page.evaluate(async ({ atom, key }) => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('atoms', 'readonly');
      const read = transaction.objectStore('atoms').get('native-atoms');
      read.onerror = () => reject(read.error);
      read.onsuccess = () => resolve(read.result.atoms[atom].entries[key]);
      transaction.oncomplete = () => database.close();
    };
  }), { atom: composerDraftAtomKey, key: miniKey });
  assert.deepEqual(preserved, miniEntry);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('codex-yard.mini-target.v1')), pointer);
  const persisted = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8'));
  for (const [key, value] of Object.entries(originalGlobals)) assert.deepEqual(persisted.globals[key], value);
  checks.push('Existing Mini draft, target identity and enabled pet preferences remain intact');
  const metafile = JSON.parse(await readFile('.local/renderer-metafile.json', 'utf8'));
  assert(!Object.keys(metafile.inputs).some(path => /src\/renderer\/(?:mini\/|app\/MiniWorkspace)/.test(path)));
  assert(!requests.some(url => /vendor\/codex-app|\/pets\//.test(url)));
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ checks, errors, requests, protocol: fake.messages,
    actualCli: 'not used: isolated synthetic protocol peer', uiReferenceVersion: '26.1013.40934' }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (cause) {
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ error: String(cause), checks, errors, requests, protocol: fake.messages,
    drafts: await readDrafts().catch(error => String(error)) }, null, 2));
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  throw cause;
} finally {
  staleWake?.terminate(); await context.close(); await app.close(); await fake.close();
  await rm(temporary, { recursive: true, force: true });
}
