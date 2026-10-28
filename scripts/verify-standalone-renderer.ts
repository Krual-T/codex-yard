import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem, commandItem, NO_REPLY } from '../test/fake-codex.ts';
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
// Real CLI 0.164/0.163 cannot list/resume a newly created empty thread.
// Only threads created by this fixture have this first-turn lifecycle.
const createdEmpty = new Set<string>();
fake.handlers.set('thread/start', params => {
  const result = fake.defaultResult('thread/start', record(params)) as { thread: { id: string } };
  fake.threads.get(result.thread.id)!.name = 'Created ' + result.thread.id;
  createdEmpty.add(result.thread.id); return result;
});
for (const method of ['thread/resume', 'thread/turns/list']) fake.handlers.set(method, params => {
  const id = String(params.threadId);
  if (createdEmpty.has(id) && !fake.threads.get(id)?.turns.length) throw new Error('list_turns is not supported yet');
  return fake.defaultResult(method, record(params));
});
const fileRpc = fileDaemonFixture();
for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, record(params)));
const notesPath = join(temporary, 'workspace-notes.txt');
await writeFile(notesPath, '\ufeffone\r\ntwo\nthree');
let shellHandle = '';
fake.handlers.set('process/spawn', (params, peer) => {
  const handle = String(params.processHandle);
  if (!params.tty) {
    for (const processHandle of [handle, shellHandle]) peer.send({ method: 'process/exited', params: { processHandle, exitCode: 0 } });
    return {};
  }
  shellHandle = handle;
  peer.send({ method: 'process/outputDelta', params: { processHandle: handle, stream: 'stdout',
    deltaBase64: Buffer.from(`\x1e${handle}\x1f/bin/bash\x1f1234\x1f\u001b[31mAPP_TERMINAL_READY\u001b[0m\r\n`).toString('base64') } });
  return {};
});
fake.handlers.set('process/writeStdin', (params, peer) => { peer.send({ method: 'process/outputDelta', params: { ...params, stream: 'stdout' } }); return {}; });
fake.handlers.set('process/resizePty', () => ({}));
fake.handlers.set('process/kill', (params, peer) => { peer.send({ method: 'process/exited', params: { processHandle: params.processHandle, exitCode: 137 } }); return {}; });
const user = { id: 'user-one', type: 'userMessage', content: [{ type: 'text', text: 'Show the owned renderer', text_elements: [] }] };
fake.threads.set('owned-conversation', fixtureThread('owned-conversation', temporary, {
  name: 'Owned renderer acceptance',
  turns: [fixtureTurn('turn-one', [user, commandItem('command-one', 'SYNTHETIC_COMMAND_OUTPUT', temporary),
    agentItem('assistant-one', 'Owned **React and TypeScript** conversation.\n\n| Item | State |\n| --- | --- |\n| Renderer | Authored |\n\n```ts\nconst owned = true;\n```\n\n[Workspace notes](./workspace-notes.txt#L2)')])],
}));
Object.assign(fake.threads.get('owned-conversation')!.turns[0]!, { diff: '--- a/workspace-notes.txt\n+++ b/workspace-notes.txt\n@@ -1 +1 @@\n-one\n+two\n' });
const dataDir = join(temporary, 'data');
await mkdir(dataDir);
await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: { 'local-projects': {
  first: { id: 'project-a', name: 'First project', rootPaths: [temporary] },
  second: { id: temporary, name: 'Second project', rootPaths: [temporary] },
} }, settings: { appearanceTheme: 'dark',
  appearanceDarkChromeTheme: { ...defaultThemes.dark, surface: '#152535', ink: '#edf5fc', fonts: { ui: 'Arial', content: 'Georgia', code: 'Courier New' } } } }));
const context = await chromium.launchPersistentContext(join(temporary, 'browser'), { executablePath: '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--disable-background-networking', '--remote-debugging-port=0'], viewport: { width: 1360, height: 900 } });
const debugPort = Number((await readFile(join(temporary, 'browser/DevToolsActivePort'), 'utf8')).split('\n')[0]);
assert(Number.isInteger(debugPort) && debugPort > 0);
const browserUrl = 'http://127.0.0.1:' + debugPort;
const targetServer = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Owned Chrome target</title><style>body{font:24px Arial;padding:35px}button{padding:15px;font:inherit}</style><button id="chosen" aria-label="Owned selected element">Owned Chrome element</button>');
});
targetServer.listen(0, '127.0.0.1'); await once(targetServer, 'listening');
const targetAddress = targetServer.address(); assert(targetAddress && typeof targetAddress !== 'string');
const targetUrl = 'http://127.0.0.1:' + targetAddress.port + '/owned-target';
const targetPage = await context.newPage(); await targetPage.goto(targetUrl);
const app = await createNativeWorkbench({ socketPath: fake.socketPath, codexHome: join(temporary, 'codex'),
  chromeConnection: { browserUrl }, dataDir, workspace: temporary, port: 0, hostCatalog: { hosts: [], projects: [], assignments: {} } });
let inspectorBrowser: { disconnect(): Promise<void> } | undefined;
await context.addInitScript(() => {
  if (window !== window.top) return;
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

  await page.setViewportSize({ width: 1360, height: 900 });
  await page.getByRole('button', { name: 'Workspace notes', exact: true }).click();
  const fileEditor = page.getByRole('textbox', { name: `File: ${notesPath}`, exact: true });
  await fileEditor.waitFor(); assert.equal(await fileEditor.innerText(), 'one\ntwo\nthree');
  await fileEditor.press('ControlOrMeta+End'); await page.keyboard.type(' edited');
  const sidebarButton = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
  if (!await page.getByRole('button', { name: 'Settings', exact: true }).isVisible()) await sidebarButton.click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
  let restoredBeforeGuard = false;
  const guardAnswered = new Promise<void>(resolve => page.once('dialog', async dialog => {
    restoredBeforeGuard = new URL(page.url()).pathname === '/settings/general'; await dialog.dismiss(); resolve();
  }));
  await page.evaluate(() => history.back());
  await guardAnswered;
  await page.waitForFunction(() => location.pathname === '/settings/general');
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
  assert(restoredBeforeGuard, 'Back navigation must restore the committed URL before asking to leave.');
  page.once('dialog', dialog => dialog.accept());
  await page.evaluate(() => history.back());
  await page.waitForURL('**/local/owned-conversation'); await fileEditor.waitFor();
  assert.equal(await fileEditor.innerText(), 'one\ntwo\nthree edited');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await page.getByRole('button', { name: 'Save file', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('button[aria-label="Save file"]')?.disabled);
  assert.equal(await readFile(notesPath, 'utf8'), '\ufeffone\r\ntwo\nthree edited');
  await page.getByRole('button', { name: 'Open turn changes', exact: true }).click();
  await page.getByLabel('Diff', { exact: true }).getByText('+two', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await page.locator('.xterm-rows').getByText('APP_TERMINAL_READY').waitFor();
  await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('app-input');
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('app-input'));
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 1);
  const writes = fake.calls('process/writeStdin').map(call => Buffer.from(String(call.params.deltaBase64), 'base64').toString()).join('');
  assert.equal(writes, 'app-input');
  await page.setViewportSize({ width: 390, height: 900 });
  const mobileSidebar = page.getByRole('button', { name: 'Close sidebar', exact: true });
  if (await mobileSidebar.isVisible()) await mobileSidebar.click();
  assert(await page.getByRole('complementary', { name: 'Workspace panel', exact: true }).isVisible());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(artifacts, 'workspace-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.yard-workspace-panel')?.hasAttribute('hidden'));
  assert.equal(fake.calls('process/spawn').filter(call => call.params.tty).length, 1);
  checks.push('actual App file link/editor/save, BOM/mixed EOL, cancelled Back guard, retained draft, turn diff, ANSI terminal input and narrow panel');

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
  if (!await page.getByRole('button', { name: 'New chat', exact: true }).isVisible()) await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  // A rejected first turn outlives the home composer. Keep B while explicitly
  // retrying immutable A, including the real CLI's unreadable empty phase.
  await page.getByRole('button', { name: 'New chat in Second project', exact: true }).click();
  const input = page.getByRole('textbox', { name: '和 Codex 一起工作', exact: true });
  const creationCount = fake.calls('thread/start').length;
  fake.handlers.set('turn/start', () => { throw new Error('SYNTHETIC_FIRST_SEND_REJECTED'); });
  await input.fill('ORIGINAL_FIRST_SEND_A');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Message send recovery', exact: true });
  await recovery.getByText('SYNTHETIC_FIRST_SEND_REJECTED', { exact: true }).waitFor();
  await input.fill('NEWER_FIRST_SEND_B');
  await page.getByText('正在保存草稿…', { exact: true }).waitFor({ state: 'hidden' });
  const failedThreadId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.reload();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === 'NEWER_FIRST_SEND_B');
  fake.handlers.delete('turn/start');
  await recovery.getByRole('button', { name: 'Retry original send', exact: true }).click();
  await recovery.waitFor({ state: 'hidden' });
  assert.equal(await input.inputValue(), 'NEWER_FIRST_SEND_B');
  assert.equal(fake.calls('thread/start').length, creationCount + 1, 'An explicit first-turn retry must reuse the created thread.');
  const retried = fake.threads.get(failedThreadId)!;
  assert.equal(JSON.stringify(retried.turns[0]?.items).includes('ORIGINAL_FIRST_SEND_A'), true);
  assert.equal(JSON.stringify(retried.turns[0]?.items).includes('NEWER_FIRST_SEND_B'), false);
  retried.turns[0]!.status = 'completed'; retried.status = { type: 'idle' };
  fake.broadcast({ method: 'turn/completed', params: { threadId: failedThreadId, turn: retried.turns[0] } });
  const sendsAfterRetry = fake.calls('turn/start').length;
  await page.reload();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === 'NEWER_FIRST_SEND_B');
  assert.equal(fake.calls('turn/start').length, sendsAfterRetry);
  checks.push('rejected first send survives route unmount and empty-history reload; explicit retry sends exact A once and preserves newer B');

  await page.getByRole('button', { name: 'New chat in Second project', exact: true }).click();
  await input.fill('OWNED_NEW_THREAD_MESSAGE');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const started = await fake.waitFor(message => message.method === 'turn/start' && JSON.stringify(message.params.input).includes('OWNED_NEW_THREAD_MESSAGE'), 15_000);
  const id = String(started.params.threadId);
  assert(fake.loaded.has(id));
  const resumeIndex = fake.messages.findIndex(message => message.method === 'thread/resume' && message.params.threadId === id);
  assert.equal(resumeIndex, -1, 'The authoritative new-thread response must install the listener without resuming unreadable empty history.');
  assert(!fake.calls('thread/turns/list').some(message => message.params.threadId === id), 'No full history before the first turn is accepted.');
  await page.waitForURL('**/local/' + id);
  await installClientProbe(page);
  await recovery.waitFor({ state: 'visible' });
  await recovery.waitFor({ state: 'hidden' });
  const settledSend = await page.evaluate(async () =>
    (window as any).acceptanceClient.host('get-persisted-atom', { key: 'codex-yard.send-recovery.v1' }));
  assert.deepEqual(settledSend.value.requests, {}, 'The first send must finish its durable cleanup before this test reloads the page.');
  await writeFile(join(artifacts, 'send-before-stream.json'), JSON.stringify(settledSend, null, 2));
  const membership = await page.evaluate(async id => {
    const state = await (window as any).acceptanceClient.host('thread-project-state');
    return state.memberships.find((value: any) => value.hostId === 'local' && value.threadId === id);
  }, id);
  assert.equal(membership?.assignment?.projectId, temporary, 'A real project whose id equals the workspace must win over the first matching cwd.');
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
  checks.push('new thread installs from its creation receipt without empty-history resume; notLoaded start, delta, summary completion and full reload');
  const beforeHomeReturn = fake.calls('turn/start').length;
  await page.goto(app.url + '/');
  await input.fill('FRESH_HOME_UNSENT_AFTER_CREATION');
  await page.getByText('正在保存草稿…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Created ' + id, exact: true }).click();
  await page.waitForURL('**/local/' + id);
  await input.waitFor(); assert.equal(await input.inputValue(), '', 'A fresh home must not alias the thread that consumed its old identity.');
  await page.goto(app.url + '/');
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === 'FRESH_HOME_UNSENT_AFTER_CREATION');
  await page.reload();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === 'FRESH_HOME_UNSENT_AFTER_CREATION');
  assert.equal(fake.calls('turn/start').length, beforeHomeReturn);
  await page.getByRole('button', { name: 'Created ' + id, exact: true }).click();
  await page.waitForURL('**/local/' + id); await input.waitFor(); assert.equal(await input.inputValue(), '');
  checks.push('direct home navigation after first send gets a distinct stable draft; sidebar return and complete reload preserve it without an extra turn');
  await installClientProbe(page);
  await writeFile(join(artifacts, 'send-after-reload.json'), JSON.stringify(await page.evaluate(async () =>
    (window as any).acceptanceClient.host('get-persisted-atom', { key: 'codex-yard.send-recovery.v1' })), null, 2));
  await page.evaluate(() => {
    const client = (window as any).acceptanceClient, rpc = client.rpc.bind(client);
    let lose = true;
    client.rpc = async (...args: any[]) => {
      const result = await rpc(...args);
      if (args[0] === 'turn/start' && lose) { lose = false; throw Object.assign(new Error('SYNTHETIC_LOST_SEND_RECEIPT'), { uncertain: true }); }
      return result;
    };
  });
  await input.fill('UNKNOWN_ORDINARY_A');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await recovery.getByText('SYNTHETIC_LOST_SEND_RECEIPT', { exact: true }).waitFor();
  await input.fill('NEWER_ORDINARY_B');
  await page.getByText('正在保存草稿…', { exact: true }).waitFor({ state: 'hidden' });
  const ordinaryCalls = fake.calls('turn/start').length;
  const accepted = fake.threads.get(id)!.turns.at(-1)!;
  accepted.status = 'completed'; fake.threads.get(id)!.status = { type: 'idle' };
  fake.broadcast({ method: 'turn/completed', params: { threadId: id, turn: accepted } });
  await page.reload();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === 'NEWER_ORDINARY_B');
  assert.equal(fake.calls('turn/start').length, ordinaryCalls);
  await recovery.getByRole('button', { name: 'Check send result', exact: true }).click();
  await recovery.getByText('原提交版本已提交；较新的草稿将保留。', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), 'NEWER_ORDINARY_B');
  await recovery.getByRole('button', { name: 'Keep newer draft and close', exact: true }).click();
  await recovery.waitFor({ state: 'hidden' });
  assert.equal(await input.inputValue(), 'NEWER_ORDINARY_B');
  await page.reload();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === 'NEWER_ORDINARY_B');
  assert.equal(fake.calls('turn/start').length, ordinaryCalls);
  assert.equal(fake.calls('turn/start').at(-1)!.params.clientUserMessageId, record(accepted.items[0]).clientId);
  checks.push('ordinary send unknown receipt persists exact clientId; read-only check confirms A and preserves newer B through reload without replay');
  await input.fill('ACTIVE_TURN_FOR_QUEUE_AND_STEER');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === '');
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  const activeForFollowup = fake.threads.get(id)!.turns.at(-1)!;
  fake.handlers.set('turn/steer', params => {
    assert.equal(params.expectedTurnId, activeForFollowup.id);
    activeForFollowup.items.push({ id: 'steered-input', type: 'userMessage', clientId: params.clientUserMessageId,
      content: structuredClone(params.input) });
    return { turnId: activeForFollowup.id };
  });
  for (const action of ['queue', 'steer'] as const) {
    await installClientProbe(page);
    const method = action === 'queue' ? 'thread/queue/add' : 'turn/steer';
    const originalCalls = fake.calls(method).length;
    await page.evaluate(method => {
      const client = (window as any).acceptanceClient, rpc = client.rpc.bind(client);
      let lose = true;
      client.rpc = async (...args: any[]) => {
        const result = await rpc(...args);
        if (args[0] === method && lose) { lose = false; throw Object.assign(new Error('SYNTHETIC_LOST_FOLLOWUP_RECEIPT'), { uncertain: true }); }
        return result;
      };
    }, method);
    await input.fill(action.toUpperCase() + '_SUBMITTED_A');
    await page.getByRole('button', { name: action === 'queue' ? '排队' : '发送到当前任务', exact: true }).click();
    await recovery.getByText('SYNTHETIC_LOST_FOLLOWUP_RECEIPT', { exact: true }).waitFor();
    const submitted = fake.calls(method).at(-1)!;
    assert.equal(fake.calls(method).length, originalCalls + 1);
    await input.fill(action.toUpperCase() + '_NEWER_B');
    await page.getByText('正在保存草稿…', { exact: true }).waitFor({ state: 'hidden' });
    await page.reload(); await installClientProbe(page);
    await page.waitForFunction(expected => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="和 Codex 一起工作"]')?.value === expected, action.toUpperCase() + '_NEWER_B');
    assert.equal(fake.calls(method).length, originalCalls + 1, 'Reload must not replay an uncertain follow-up.');
    const state = await page.evaluate(async () => (window as any).acceptanceClient.host('get-persisted-atom', { key: 'codex-yard.send-recovery.v1' }));
    const original = Object.values(record(record(state).value).requests as Record<string, any>).find(value => value.clientUserMessageId === submitted.params.clientUserMessageId);
    assert.equal(original?.action.type, action);
    if (action === 'steer') assert.equal(original?.action.turnId, activeForFollowup.id);
    await recovery.getByRole('button', { name: 'Check send result', exact: true }).click();
    await recovery.getByText('原提交版本已提交；较新的草稿将保留。', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), action.toUpperCase() + '_NEWER_B');
    await recovery.getByRole('button', { name: 'Keep newer draft and close', exact: true }).click();
    await recovery.waitFor({ state: 'hidden' });
    assert.equal(fake.calls(method).length, originalCalls + 1);
    if (action === 'queue') {
      // Use the actual queue consumer to delete the confirmed pending item.
      const deleteButton = page.getByRole('button', { name: '删除待发送消息', exact: true });
      await deleteButton.click(); await deleteButton.waitFor({ state: 'hidden' });
    }
  }
  activeForFollowup.status = 'completed'; fake.threads.get(id)!.status = { type: 'idle' };
  fake.broadcast({ method: 'turn/completed', params: { threadId: id, turn: activeForFollowup } });
  await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'hidden' });
  checks.push('queue and steer persist immutable request/action and original turn, survive reload without replay and confirm exact peer clientId while retaining newer B');
  await installClientProbe(page);
  fake.handlers.set('thread/name/set', params => {
    fake.threads.get(String(params.threadId))!.name = 'RESTORED_PAGE_THREAD'; return NO_REPLY;
  });
  await page.evaluate(id => {
    void (window as any).acceptanceClient.rpc('thread/name/set', { threadId: id, name: 'RESTORED_PAGE_THREAD' }).catch((error: { uncertain: boolean }) => {
      (window as any).lifecycleWriteResult = { uncertain: error.uncertain };
    });
  }, id);
  await fake.waitFor(message => message.method === 'thread/name/set');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.waitForFunction(() => (window as any).lifecycleWriteResult?.uncertain === true);
  assert.equal(await page.evaluate(() => (window as any).acceptanceClient.connected), false);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.waitForFunction(() => (window as any).acceptanceClient.connected);
  await page.waitForFunction(() => document.querySelector('.yard-conversation-header strong')?.textContent === 'RESTORED_PAGE_THREAD');
  assert.equal(fake.calls('thread/name/set').length, 1, 'Resuming must not replay a write with a lost receipt.');
  checks.push('persisted page lifecycle events reconnect the real client, rehydrate history and retain an unknown write without replay (simulated cache events)');
  const visualizationPath = join(temporary, 'owned-chart.html');
  await writeFile(visualizationPath, '<!doctype html><html><body><div class="viz-carousel"><section data-variant="One"><div id="viz-target" aria-label="Owned chart">Owned visualization</div></section><section data-variant="Two">Second variant</section></div><button id="save-widget" onclick="openai.setWidgetState({modelContent:{choice:7},privateContent:{privateMarker:\'PRIVATE_WIDGET_VALUE\'}}).then(()=>document.querySelector(\'#saved\').textContent=\'Widget saved\')">Save widget state</button><p id="saved"></p><script>const config={width:25};new Tweak({container:document.querySelector(\'#viz-target\'),onChange:()=>document.querySelector(\'#viz-target\').style.width=config.width+\'%\'}).addSlider(config,\'width\',{label:\'Chart width\',min:1,max:100,step:1});</script></body></html>');
  fake.threads.get(id)!.turns[0]!.items.push(agentItem('owned-widget-link', '\uE200visualize\uE202' + JSON.stringify({ path: visualizationPath, title: 'Owned chart' }) + '\uE201'));
  await page.reload(); await installClientProbe(page);
  await page.getByRole('button', { name: 'Owned chart', exact: true }).click();
  const visualizationFrame = page.frameLocator('iframe[title="Visualization content"]');
  await visualizationFrame.getByText('Owned visualization', { exact: true }).waitFor();
  await visualizationFrame.getByRole('button', { name: 'Next variant', exact: true }).click();
  await visualizationFrame.getByText('Second variant', { exact: true }).waitFor();
  await visualizationFrame.getByRole('button', { name: 'Previous variant', exact: true }).click();
  await visualizationFrame.getByRole('button', { name: 'Save widget state', exact: true }).click();
  await visualizationFrame.getByText('Widget saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Annotate', exact: true }).click();
  await visualizationFrame.locator('#viz-target').click();
  await page.getByLabel('Chart width', { exact: true }).fill('70');
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click();
  await page.locator('.standalone-composer__reference').filter({ hasText: 'Visualization changes' }).waitFor();
  await input.fill('WIDGET_CONTEXT_SEND');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const widgetSend = await fake.waitFor(message => message.method === 'turn/start' && JSON.stringify(message.params.input).includes('WIDGET_CONTEXT_SEND'));
  const widgetContextEntries = Object.values(record(widgetSend.params.additionalContext)).map(record);
  assert(widgetContextEntries.length >= 2);
  for (const entry of widgetContextEntries) assert.equal(entry.kind, 'untrusted');
  const widgetContext = widgetContextEntries.map(entry => JSON.parse(String(entry.value)));
  assert(widgetContext.some(entry => entry.field === 'state' && entry.modelContent?.choice === 7));
  assert(widgetContext.some(entry => entry.field === 'interaction' && entry.modelContent?.changes?.some((change: any) => change.edits?.some((edit: any) => edit.label === 'Chart width' && edit.value === 70))));
  assert(!JSON.stringify(widgetContext).includes('PRIVATE_WIDGET_VALUE'));
  await recovery.waitFor({ state: 'visible' }); await recovery.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Open visualization', exact: true }).click();
  await visualizationFrame.getByText('Owned visualization', { exact: true }).waitFor();
  assert.equal(await visualizationFrame.locator('html').getAttribute('lang'), await page.locator('html').getAttribute('lang'));
  await page.getByRole('region', { name: 'Visualization', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  checks.push('actual App visualization directive, carousel, Tweak, widget persistence, structured prefill and model-visible context; private content excluded');

  await page.getByRole('button', { name: 'Open Chrome panel', exact: true }).click();
  const browserSelection = page.getByLabel('浏览器所在电脑');
  await page.waitForFunction(() => { const option = document.querySelector<HTMLOptionElement>('select[aria-label="浏览器所在电脑"] option[value="server"]'); return option !== null && !option.disabled; });
  await browserSelection.selectOption('server');
  const chromeTab = page.getByLabel('已有 Chrome 标签'), targetOption = chromeTab.locator('option').filter({ hasText: '/owned-target' });
  await targetOption.waitFor({ state: 'attached', timeout: 60_000 });
  const targetId = await targetOption.getAttribute('value'); assert(targetId); await chromeTab.selectOption(targetId);
  await page.getByAltText('Chrome 标签的最新画面').waitFor({ timeout: 60_000 });
  const { puppeteer } = await import(new URL('../node_modules/chrome-devtools-mcp/build/src/third_party/index.js', import.meta.url).href);
  const inspector = await puppeteer.connect({ browserURL: browserUrl }); inspectorBrowser = inspector;
  const inspected = (await inspector.pages()).find((item: { url(): string }) => item.url() === targetUrl); assert(inspected);
  const devtools = await inspected.openDevTools();
  await devtools.waitForFunction(() => document.readyState === 'complete');
  await devtools.waitForFunction(async () => {
    const uiPath = '/bundled/ui/legacy/legacy.js', sdkPath = '/bundled/core/sdk/sdk.js';
    const UI = await import(uiPath), SDK = await import(sdkPath);
    return !!UI.Context.Context.instance().flavor(SDK.DOMModel.DOMNode);
  }, { timeout: 15_000 });
  const inspectedSession = await inspected.createCDPSession();
  const { root: documentRoot } = await inspectedSession.send('DOM.getDocument');
  const { nodeId } = await inspectedSession.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '#chosen' });
  const { node } = await inspectedSession.send('DOM.describeNode', { nodeId });
  await devtools.bringToFront();
  await devtools.keyboard.down('Control'); await devtools.keyboard.down('Shift'); await devtools.keyboard.press('C');
  await devtools.keyboard.up('Shift'); await devtools.keyboard.up('Control');
  await inspected.bringToFront(); await inspected.click('#chosen');
  await devtools.waitForFunction(async (expected: number) => {
    const uiPath = '/bundled/ui/legacy/legacy.js', sdkPath = '/bundled/core/sdk/sdk.js';
    const UI = await import(uiPath), SDK = await import(sdkPath);
    return UI.Context.Context.instance().flavor(SDK.DOMModel.DOMNode)?.backendNodeId() === expected;
  }, { timeout: 5_000 }, node.backendNodeId);
  await page.bringToFront(); await page.getByRole('button', { name: '引用所选元素', exact: true }).click();
  const browserChip = page.locator('.standalone-composer__reference').filter({ hasText: 'Owned Chrome element' });
  await browserChip.waitFor({ state: 'attached' });
  await page.screenshot({ path: join(artifacts, 'owned-chrome-panel.png'), fullPage: true });
  await page.getByRole('region', { name: '浏览器', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await browserChip.waitFor({ timeout: 60_000 });
  const quotedComments = await page.evaluate(async () => (window as any).acceptanceClient.host('get-persisted-atom', { key: 'codex-yard.browser-comments.v1' }));
  const quoted = Object.values(record(quotedComments.value.entries)).flat().map(record);
  assert.equal(quoted.length, 1);
  const quotedElement = record(quoted[0].localBrowserContext);
  assert.equal(quotedElement.pageUrl, targetUrl);
  assert.equal(quotedElement.targetName, 'Owned selected element');
  assert.equal(quotedElement.targetImmediateText, 'Owned Chrome element');
  assert.match(String(quotedElement.targetSelector), /#chosen/);
  await page.screenshot({ path: join(artifacts, 'owned-chrome-reference.png'), fullPage: true });
  await browserChip.getByRole('button', { name: '移除引用', exact: true }).click();
  await browserChip.waitFor({ state: 'hidden' });
  const comments = await page.evaluate(async () => (window as any).acceptanceClient.host('get-persisted-atom', { key: 'codex-yard.browser-comments.v1' }));
  assert.equal(Object.values(comments.value.entries).flat().length, 0, 'Removing an actual composer reference must await its authoritative comment deletion.');
  checks.push('actual App Chrome panel selects a disposable real Chrome target through official MCP; real DevTools element reaches composer and transactional removal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
    sendRecovery: await page.evaluate(async () => (window as any).acceptanceClient?.host('get-persisted-atom', { key: 'codex-yard.send-recovery.v1' })).catch(error => String(error)),
    protocol: fake.messages.map(message => ({ method: message.method, params: message.params })) }, null, 2));
  throw error;
} finally {
  await page.screenshot({ path: join(artifacts, 'last-page.png'), fullPage: true }).catch(() => {});
  await inspectorBrowser?.disconnect(); await app.close(); await context.close();
  await new Promise<void>((resolve, reject) => targetServer.close(error => error ? reject(error) : resolve()));
  await fake.close(); await rm(temporary, { recursive: true, force: true });
}
