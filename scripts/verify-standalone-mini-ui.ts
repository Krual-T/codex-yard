import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';
import { defaultThemes } from '../src/renderer/settings/preferences.ts';

const artifacts = process.env.YARD_TEST_ARTIFACTS;
if (!artifacts) throw new Error('Set YARD_TEST_ARTIFACTS to a dedicated evidence directory.');
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp('/tmp/yard-mini-app-');
const fake = await createFakeCodex(temporary);
fake.threads.set('mini-app', fixtureThread('mini-app', temporary, { name: 'Mini actual App', turns: [fixtureTurn('mini-turn', [
  { id: 'mini-user', type: 'userMessage', content: [{ type: 'text', text: 'MINI_ORIGINAL', text_elements: [] }] },
  agentItem('mini-answer', 'Mini **actual parent** answer.'),
])] }));
const dataDir = join(temporary, 'data'); await mkdir(dataDir);
await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ settings: {
  localeOverride: 'en-US', appearanceTheme: 'dark', appearanceDarkChromeTheme: {
    ...defaultThemes.dark, surface: '#152535', ink: '#edf5fc',
    fonts: { ui: 'Arial, sans-serif', content: 'Georgia, serif', code: 'Courier New, monospace' },
  },
} }));
const app = await createNativeWorkbench({ socketPath: fake.socketPath, workspace: temporary, dataDir,
  codexHome: join(temporary, 'codex'), port: 0 });
const context = await chromium.launchPersistentContext(join(temporary, 'browser'), { executablePath: '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--disable-background-networking'], viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const checks: string[] = [], errors: string[] = [], requests: string[] = [];
page.on('pageerror', cause => errors.push(cause.message));
page.on('request', request => requests.push(request.url()));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
const readEdit = () => page.evaluate(async () => new Promise<any>((resolve, reject) => {
  const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result, transaction = database.transaction('atoms', 'readonly');
    const read = transaction.objectStore('atoms').get('native-atoms');
    read.onerror = () => reject(read.error);
    read.onsuccess = () => resolve(read.result?.atoms?.['codex-yard.message-edits.v1']);
    transaction.oncomplete = () => database.close();
  };
}));
try {
  await page.goto(app.url + '/local/mini-app');
  const main = page.locator('.yard-chat-pane');
  await main.getByText('Mini actual parent answer.', { exact: false }).waitFor();
  const mainInput = main.getByRole('textbox', { name: 'Work with Codex', exact: true });
  await mainInput.fill('MAIN_INDEPENDENT_DRAFT');
  await main.getByRole('button', { name: 'Edit message', exact: true }).click();
  const mainEdit = main.getByRole('textbox', { name: 'Edit message text', exact: true });
  await mainEdit.fill('MAIN_EDIT_BEFORE_MINI');
  const writesBefore = fake.calls('turn/start').length + fake.calls('thread/revert').length;
  await page.getByRole('button', { name: 'Open Mini', exact: true }).click();
  await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
  const mini = page.getByRole('region', { name: 'Mini conversation', exact: true });
  const miniEdit = mini.getByRole('textbox', { name: 'Edit message text', exact: true });
  await miniEdit.waitFor();
  await page.waitForFunction(() => document.querySelector('.yard-chat-pane')?.hasAttribute('inert')
    && document.querySelector<HTMLTextAreaElement>('.yard-mini-composer textarea[aria-label="Edit message text"]')?.value === 'MAIN_EDIT_BEFORE_MINI');
  const beforeMini = await readEdit();
  await miniEdit.fill('MINI_EDIT_SAVED_BACK');
  await mini.getByRole('button', { name: 'Close Quick chat', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.yard-chat-pane')?.hasAttribute('inert')
    && document.querySelector<HTMLTextAreaElement>('.yard-chat-pane textarea[aria-label="Edit message text"]')?.value === 'MINI_EDIT_SAVED_BACK');
  // Explicit ownership handoff replaces the inactive editor projection. Its
  // exact unsent version, rather than the old DOM node, must survive that transfer.
  assert.equal(await mainEdit.inputValue(), 'MINI_EDIT_SAVED_BACK');
  const afterMini = await readEdit();
  const key = JSON.stringify(['local', 'mini-app']);
  assert.deepEqual(afterMini[key].recovery.origin, beforeMini[key].recovery.origin);
  assert.equal(afterMini[key].recovery.editor.sessionId, beforeMini[key].recovery.editor.sessionId);
  assert(afterMini[key].recovery.editor.revision > beforeMini[key].recovery.editor.revision);
  assert.equal(fake.calls('turn/start').length + fake.calls('thread/revert').length, writesBefore);
  checks.push('actual Main/Mini ownership handoff restores the newer shared edit without dispatch');
  await mainEdit.fill('MAIN_REACQUIRED_EDIT');
  await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('.yard-mini-composer textarea[aria-label="Edit message text"]')?.value === 'MAIN_REACQUIRED_EDIT');
  await mini.getByRole('button', { name: 'Close Quick chat', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.yard-chat-pane')?.hasAttribute('inert'));
  checks.push('Main obtains a fresh edit grant and the next Mini handoff reads its exact new version');
  assert.equal(await mainInput.inputValue(), 'MAIN_INDEPENDENT_DRAFT');
  for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await mini.waitFor({ state: 'visible' });
    const bounds = await mini.boundingBox();
    assert(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y >= -1);
    await page.screenshot({ path: join(artifacts, `mini-app-${width}.png`), fullPage: true });
    await mini.getByRole('button', { name: 'Close Quick chat', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.yard-chat-pane')?.hasAttribute('inert'));
  }
  checks.push('actual Mini parent stays within 1280/800/390 viewports and preserves the independent Main composer');
  const font = await mainEdit.evaluate(node => getComputedStyle(node).fontFamily);
  assert.match(font, /Arial|Georgia/);
  assert.deepEqual(errors, []);
  assert(!requests.some(url => /vendor|codex-app\/|assets\/app-initial|renderer-migration/.test(url)));
  const metafile = JSON.parse(await readFile('.local/renderer-metafile.json', 'utf8'));
  assert(!Object.keys(metafile.inputs).some(path => path.startsWith('vendor/')));
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ checks, errors, requests,
    protocol: fake.messages, actualCli: 'not used: isolated synthetic protocol peer', uiReferenceVersion: '26.1013.40934' }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (cause) {
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ error: String(cause), checks, errors, requests,
    protocol: fake.messages, alerts: await page.locator('[role="alert"], [role="status"]').allTextContents() }, null, 2));
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  throw cause;
} finally {
  await context.close(); await app.close(); await fake.close();
  await rm(temporary, { recursive: true, force: true });
}
