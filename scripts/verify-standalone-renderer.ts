import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem, commandItem } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';
import { fileMethods } from '../src/native/files.ts';
import { record } from '../src/native/protocol.ts';
import { defaultThemes } from '../src/renderer/settings/preferences.ts';

// This script exclusively owns a disposable protocol peer, home, port and browser.
const artifacts = process.env.YARD_TEST_ARTIFACTS;
if (!artifacts) throw new Error('Set YARD_TEST_ARTIFACTS to an isolated evidence directory.');
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp('/tmp/yard-owned-ui-');
const fake = await createFakeCodex(temporary);
const fileRpc = fileDaemonFixture();
for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, record(params)));
const user = { id: 'user-one', type: 'userMessage', content: [{ type: 'text', text: 'Show the owned renderer', text_elements: [] }] };
fake.threads.set('owned-conversation', fixtureThread('owned-conversation', temporary, {
  name: 'Owned renderer acceptance',
  turns: [fixtureTurn('turn-one', [user, commandItem('command-one', 'SYNTHETIC_COMMAND_OUTPUT', temporary),
    agentItem('assistant-one', 'Owned **React and TypeScript** conversation.\n\n| Item | State |\n| --- | --- |\n| Renderer | Authored |\n\n```ts\nconst owned = true;\n```')])],
}));
const dataDir = join(temporary, 'data');
await mkdir(dataDir);
await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {}, settings: { appearanceTheme: 'dark',
  appearanceDarkChromeTheme: { ...defaultThemes.dark, surface: '#152535', ink: '#edf5fc', fonts: { ui: 'Arial', content: 'Georgia', code: 'Courier New' } } } }));
const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(temporary, 'codex'),
  dataDir, workspace: temporary, port: 0, hostCatalog: { hosts: [], projects: [], assignments: {} } });
const context = await chromium.launchPersistentContext(join(temporary, 'browser'), { executablePath: '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox'], viewport: { width: 1360, height: 900 } });
await context.addInitScript(() => {
  if (localStorage.getItem('native-atoms') === null) localStorage.setItem('native-atoms', JSON.stringify({ unknown: { keep: true }, 'acceptance-record': {} }));
});
const page = await context.newPage();
const errors: string[] = [], requests: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
try {
  await page.goto(app.url + '/local/owned-conversation');
  await page.locator('[data-owned-renderer="true"]').waitFor();
  await page.getByText('Owned React and TypeScript conversation.', { exact: false }).waitFor();
  await page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true }).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--yard-bg').trim() === '#152535');
  const actualFonts = await page.evaluate(() => ({ ui: getComputedStyle(document.documentElement).fontFamily,
    content: getComputedStyle(document.querySelector('.yard-conversation')!).fontFamily,
    code: getComputedStyle(document.querySelector('.yard-conversation code')!).fontFamily }));
  assert.match(actualFonts.ui, /Arial/); assert.match(actualFonts.content, /Georgia/); assert.match(actualFonts.code, /Courier New/);
  checks.push('owned entry, stored full history, Markdown and persisted theme/fonts');
  const componentNames = await page.evaluate(() => {
    const root = document.querySelector('[data-owned-renderer]')!;
    const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber$'));
    const names = new Set<string>();
    const walk = (fiber: any) => { if (!fiber) return; const type = fiber.type;
      if (typeof type === 'function') names.add(type.displayName || type.name);
      walk(fiber.child); walk(fiber.sibling); };
    if (fiberKey) walk((root as any)[fiberKey]);
    return [...names];
  });
  assert(componentNames.includes('StandaloneMessages')); assert(componentNames.includes('StandaloneComposer'));
  for (const width of [1360, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 800) {
      const sidebar = page.getByRole('complementary', { name: 'Sidebar', exact: true });
      if (await sidebar.isVisible()) await page.getByRole('button', { name: 'Close sidebar', exact: true }).click();
    }
    const bounds = await page.evaluate(() => {
      const content = document.querySelector('.yard-conversation')!.getBoundingClientRect();
      const composer = document.querySelector('.standalone-composer')!.getBoundingClientRect();
      return { viewport: innerWidth, content: { left: content.left, right: content.right }, composer: { left: composer.left, right: composer.right }, scroll: document.documentElement.scrollWidth };
    });
    assert(bounds.content.left >= 0 && bounds.content.right <= width + 1, JSON.stringify(bounds));
    assert(bounds.composer.left >= 0 && bounds.composer.right <= width + 1, JSON.stringify(bounds));
    assert(bounds.scroll <= width + 1, JSON.stringify(bounds));
    await page.screenshot({ path: join(artifacts, `owned-${width}.png`), fullPage: true });
  }
  checks.push('1360/800/390 actual content and composer bounds');
  const installClientProbe = async (target: typeof page) => target.evaluate(() => {
    const root = document.querySelector('[data-owned-renderer]')!;
    const key = Object.keys(root).find(value => value.startsWith('__reactFiber$'))!;
    for (let fiber = (root as any)[key]; fiber; fiber = fiber.return) {
      if (fiber.memoizedProps?.client) { (window as any).acceptanceClient = fiber.memoizedProps.client; return; }
    }
    throw new Error('The owned App client was not mounted.');
  });
  await installClientProbe(page);
  const lightTheme = { ...defaultThemes.light, surface: '#fdf3e9', ink: '#152535', fonts: { ui: 'Arial', content: 'Georgia', code: 'Courier New' } };
  await page.evaluate(async theme => {
    await (window as any).acceptanceClient.host('set-setting', { key: 'appearanceLightChromeTheme', value: theme });
    await (window as any).acceptanceClient.host('set-setting', { key: 'appearanceTheme', value: 'light' });
  }, lightTheme);
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'
    && getComputedStyle(document.querySelector('.yard-markdown')!).color === 'rgb(21, 37, 53)');
  await page.evaluate(async () => { await (window as any).acceptanceClient.host('set-setting', { key: 'appearanceTheme', value: 'dark' }); });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'
    && getComputedStyle(document.querySelector('.yard-markdown')!).color === 'rgb(237, 245, 252)');
  checks.push('persisted light/dark surface and ink reach actual Markdown text');

  // Exercise the production client and IndexedDB readwrite transaction in two renderers.
  const other = await context.newPage();
  await other.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await other.goto(app.url + '/'); await other.locator('[data-owned-renderer="true"]').waitFor(); await installClientProbe(other);
  const writeRecords = (target: typeof page, prefix: string) => target.evaluate(async prefix => {
    for (let index = 0; index < 20; index++) await (window as any).acceptanceClient.host('set-persisted-atom', {
      key: 'acceptance-record', recordUpdate: { entries: { [prefix + index]: { value: index } } },
    });
  }, prefix);
  for (let round = 0; round < 5; round++) {
    await Promise.all([writeRecords(page, `a${round}:`), writeRecords(other, `b${round}:`)]);
    const counts = await Promise.all([page, other].map(target => target.evaluate(async () => {
      const result = await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'acceptance-record' });
      return Object.keys(result.value).length;
    })));
    console.log('Concurrent atom counts', { round, counts });
    assert.deepEqual(counts, [40 * (round + 1), 40 * (round + 1)], 'Every completed cross-page write must survive.');
  }
  const atoms = await page.evaluate(async () => ({
    'acceptance-record': (await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'acceptance-record' })).value,
    unknown: (await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'unknown' })).value,
  }));
  assert.equal(Object.keys(atoms['acceptance-record']).length, 200); assert.deepEqual(atoms.unknown, { keep: true });
  for (const malformed of [null, [], 'unreadable', 2]) {
    const kept = await other.evaluate(async value => {
      await (window as any).acceptanceClient.host('set-persisted-atom', { key: 'invalid-record', value });
      const before = JSON.stringify(await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'invalid-record' }));
      let rejected = false;
      try { await (window as any).acceptanceClient.host('set-persisted-atom', { key: 'invalid-record', recordUpdate: { entries: { lost: { value: true } } } }); }
      catch { rejected = true; }
      return rejected && before === JSON.stringify(await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'invalid-record' }));
    }, malformed);
    assert(kept, 'Malformed atom must be rejected without a write');
  }
  const quotaPreserved = await other.evaluate(async () => {
    const original = IDBObjectStore.prototype.put;
    const before = JSON.stringify(await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'acceptance-record' }));
    IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
    let rejected = false;
    try { await (window as any).acceptanceClient.host('set-persisted-atom', { key: 'acceptance-record', recordUpdate: { entries: { failed: { value: true } } } }); }
    catch { rejected = true; }
    finally { IDBObjectStore.prototype.put = original; }
    return rejected && before === JSON.stringify(await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'acceptance-record' }));
  });
  assert(quotaPreserved); await other.close();
  checks.push('two actual pages preserve concurrent native-atoms records, malformed atoms and quota failures');

  await page.setViewportSize({ width: 1360, height: 900 });
  let rejectEditedStart = true;
  fake.handlers.set('turn/start', params => {
    if (rejectEditedStart) { rejectEditedStart = false; throw new Error('SYNTHETIC_EDIT_START_REJECTED'); }
    return fake.defaultResult('turn/start', record(params));
  });
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit message text', exact: true }).fill('EDIT_RETRY_AFTER_RELOAD');
  await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('SYNTHETIC_EDIT_START_REJECTED', { exact: false }).waitFor();
  assert.equal(fake.calls('thread/revert').length, 1);
  await page.reload();
  const recoveredEdit = page.getByRole('textbox', { name: 'Edit message text', exact: true });
  await recoveredEdit.waitFor(); assert.equal(await recoveredEdit.inputValue(), 'EDIT_RETRY_AFTER_RELOAD');
  await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.yard-message-edit'));
  assert.equal(fake.calls('thread/revert').length, 1); assert.equal(fake.calls('turn/start').length, 2);
  const edited = fake.threads.get('owned-conversation')!; edited.status = { type: 'idle' }; edited.turns[0]!.status = 'completed';
  fake.broadcast({ method: 'turn/completed', params: { threadId: edited.id, turn: edited.turns[0] } });
  fake.handlers.delete('turn/start');
  checks.push('actual inline edit reverts once, retains failure through reload and retries only start');

  // Lose only the browser receipt after the real host/peer accepted draft A.
  // Editing B before checking A must not run the hook's successful-clear path.
  await installClientProbe(page);
  await page.evaluate(() => {
    const client = (window as any).acceptanceClient, host = client.host.bind(client);
    (window as any).editProbeCalls = [];
    let loseFirst = true;
    client.host = async (endpoint: string, params: Record<string, unknown>) => {
      if (endpoint !== 'message-edit') return host(endpoint, params);
      (window as any).editProbeCalls.push(params);
      const result = await host(endpoint, params);
      if (loseFirst) { loseFirst = false; throw new Error('SYNTHETIC_LOST_EDIT_RECEIPT'); }
      return result;
    };
  });
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit message text', exact: true }).fill('OLDER_EDIT_A');
  await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('SYNTHETIC_LOST_EDIT_RECEIPT', { exact: false }).waitFor();
  await page.getByRole('textbox', { name: 'Edit message text', exact: true }).fill('NEWER_UNSENT_EDIT_B');
  await page.locator('.yard-message-edit').getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('较早版本已发送', { exact: false }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Edit message text', exact: true }).inputValue(), 'NEWER_UNSENT_EDIT_B');
  const checkedEdit = await page.evaluate(async () => ({ calls: (window as any).editProbeCalls,
    recovery: Object.values((await (window as any).acceptanceClient.host('get-persisted-atom', { key: 'codex-yard.message-edits.v1' })).value) as any[] }));
  assert.deepEqual(checkedEdit.calls.map((call: any) => call.operation), ['submit', 'check']);
  assert.equal(checkedEdit.calls[0].clientUserMessageId, checkedEdit.calls[1].clientUserMessageId);
  assert(checkedEdit.recovery.some(value => value.recovery.draft.text === 'NEWER_UNSENT_EDIT_B'
    && value.submission.stage === 'started' && value.recovery.editor.revision > value.submission.editorVersion.revision));
  assert.equal(fake.calls('thread/revert').length, 2); assert.equal(fake.calls('turn/start').length, 3);
  await page.reload();
  await page.getByRole('textbox', { name: 'Edit message text', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Edit message text', exact: true }).inputValue(), 'NEWER_UNSENT_EDIT_B');
  await page.locator('.yard-message-edit').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.yard-message-edit'));
  checks.push('actual edit hook retains newer B after checking submitted A, including reload; no replay');
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.getByRole('button', { name: '＋ New chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true });
  await input.fill('OWNED_NEW_THREAD_MESSAGE');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const started = await fake.waitFor(message => message.method === 'turn/start' && JSON.stringify(message.params.input).includes('OWNED_NEW_THREAD_MESSAGE'), 15_000);
  const id = String(started.params.threadId);
  assert(fake.loaded.has(id));
  const resumeIndex = fake.messages.findIndex(message => message.method === 'thread/resume' && message.params.threadId === id);
  assert(resumeIndex >= 0 && resumeIndex < fake.messages.indexOf(started));
  await page.waitForURL('**/local/' + id);
  const turn = fake.threads.get(id)!.turns[0]!;
  const assistant = agentItem('live-assistant', 'STREAMED_OWNED_ANSWER');
  fake.broadcast({ method: 'turn/started', params: { threadId: id, turn: { ...turn, items: [], itemsView: 'notLoaded' } } });
  fake.broadcast({ method: 'item/started', params: { threadId: id, turnId: turn.id, item: { ...assistant, text: '' } } });
  fake.broadcast({ method: 'item/agentMessage/delta', params: { threadId: id, turnId: turn.id, itemId: assistant.id, delta: assistant.text } });
  await page.getByText('STREAMED_OWNED_ANSWER', { exact: true }).waitFor();
  turn.items.push(assistant); turn.status = 'completed'; fake.threads.get(id)!.status = { type: 'idle' };
  fake.broadcast({ method: 'item/completed', params: { threadId: id, turnId: turn.id, item: assistant } });
  fake.broadcast({ method: 'turn/completed', params: { threadId: id, turn: { ...turn, items: [], itemsView: 'summary' } } });
  await page.reload();
  await page.getByText('STREAMED_OWNED_ANSWER', { exact: true }).waitFor();
  checks.push('new thread resumes before first turn; notLoaded start, delta, summary completion and full reload');
  await page.getByRole('button', { name: '⚙ Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert(!requests.some(url => /vendor|codex-app\/|assets\/app-initial|renderer-migration/.test(url)));
  const metafile = JSON.parse(await readFile('.local/renderer-metafile.json', 'utf8'));
  assert(!Object.keys(metafile.inputs).some(path => path.startsWith('vendor/')));
  checks.push('actual settings route; no snapshot renderer requests or bundle inputs');
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ checks, componentNames, actualFonts, errors, requests,
    protocol: fake.messages.map(message => ({ method: message.method, params: message.params })), peer: 'isolated synthetic Codex protocol peer',
    uiReferenceVersion: '26.1013.40934', actualCli: 'not used by this synthetic acceptance' }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, requests,
    atoms: await page.evaluate(() => localStorage.getItem('native-atoms')).catch(() => null),
    protocol: fake.messages.map(message => ({ method: message.method, params: message.params })) }, null, 2));
  throw error;
} finally {
  await page.screenshot({ path: join(artifacts, 'last-page.png'), fullPage: true }).catch(() => {});
  await context.close(); await app.close(); await fake.close(); await rm(temporary, { recursive: true, force: true });
}
