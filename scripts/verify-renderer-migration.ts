// The real pinned page with disposable protocol data; run under the UI lock.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';
import { fileMethods } from '../src/native/files.ts';
import { record } from '../src/native/protocol.ts';

const root = await mkdtemp('/tmp/yard-migration-ui-');
const output = resolve(process.env.AGENTS_MIGRATION_EVIDENCE ?? '.local/renderer-migration');
await mkdir(output, { recursive: true });
const dataDir = join(root, 'data');
await mkdir(dataDir);
if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) {
  await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
}
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Migration project', path: root }]));
const fake = await createFakeCodex(root);
const fileRpc = fileDaemonFixture();
for (const method of fileMethods) fake.handlers.set(method, params => fileRpc(method, record(params)));
const images = [join(root, 'image-a.png'), join(root, 'image-b.png')];
function fixturePng(red: number, green: number, blue: number) {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue]))), chunk('IEND', Buffer.alloc(0))]);
}
await writeFile(images[0]!, fixturePng(32, 120, 220));
await writeFile(images[1]!, fixturePng(220, 90, 32));
const mentionedFile = join(root, 'main.ts');
await writeFile(mentionedFile, 'export const fixture = true;\n');
const id = '00000000-0000-4000-8000-000000000631';
const tail = 'MIGRATION_LAST_LINE';
const text = '# Files mentioned by the user:\n\n## main.ts: ' + mentionedFile + ' (lines 8-10)\n\n## My request:\n'
  + Array.from({ length: 110 }, (_, index) => `Fixture paragraph ${index}: ${'visible sample '.repeat(9)}.`).join('\n\n') + '\n\n' + tail;
const code = 'const greeting = "你好";\n\tconsole.log(greeting);';
const longCode = Array.from({ length: 70 }, (_, index) => `const migrationLine${index} = ${index};`).join('\n');
const markdown = 'Fixture answer:\n\n```ts\n' + code + '\n```\n\n```latex\nx^2+y^2=z^2\n```\n\n```ts\n' + longCode
  + '\n```\n\n```mermaid\nflowchart TD\n  A[Migration] --> B[TypeScript]\n```';
fake.threads.set(id, fixtureThread(id, root, { name: 'Migration conversation', updatedAt: Math.floor(Date.now() / 1000) - 300,
  turns: [fixtureTurn('migration-turn', [
    { id: 'migration-input', type: 'userMessage', content: [{ type: 'text', text, text_elements: [] }, ...images.map(path => ({ type: 'localImage', path }))] },
    agentItem('migration-answer', markdown),
  ])] }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (fixture)' }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
  hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, checks, errors };
let page: Page | undefined;

async function mountedComponents(page: Page) {
  return page.locator('body').evaluate(body => {
    type Fiber = { type?: { name?: string; displayName?: string }; return?: Fiber; child?: Fiber; sibling?: Fiber };
    const element = [...body.querySelectorAll('*')].find(element => Object.keys(element).some(name => name.startsWith('__reactFiber$')));
    if (!element) throw new Error('No React host element was found');
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    if (!key) throw new Error('The real renderer React fiber was not found');
    let root = Reflect.get(element, key) as Fiber;
    while (root.return) root = root.return;
    const queue = [root], names = new Set<string>();
    for (let visited = 0; queue.length && visited < 50_000; visited++) {
      const fiber = queue.pop()!;
      const name = fiber.type?.displayName ?? fiber.type?.name;
      if (name && /^(CollapsibleUserMessageContent|UserMessage|UserMessageBody|UserMessageFileAttachment|UserMessageImageList|UserMessageImage|RelativeTime|CompactRelativeTime|TaskRow|SidebarConversationRow|SidebarStatusBadge|HomeComposerLayout|MainComposerView|ComposerControllerProvider|ComposerDraftScope|SettingsPage|MarkdownCodeBlock|CodeBlockFrame|MermaidLoadingPlaceholder)$/.test(name)) names.add(name);
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return [...names].sort();
  });
}

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 800, height: 1280 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width === 800,
      permissions: ['clipboard-read', 'clipboard-write'] });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const modules: string[] = [];
    page.on('response', response => { if (response.url().endsWith('/renderer-components.js') && response.ok()) modules.push(response.url()); });
    await page.goto(app.url, { waitUntil: 'commit' });
    const homeEditor = page.getByRole('textbox', { name: /^(Do anything|随心输入)$/ });
    await homeEditor.waitFor({ timeout: 60_000 });
    const homeComponents = await mountedComponents(page);
    assert.ok(homeComponents.includes('HomeComposerLayout'), 'The real home route must use the authored composer layout');
    for (const name of ['MainComposerView', 'ComposerControllerProvider', 'ComposerDraftScope']) assert.ok(homeComponents.includes(name), `The real home route must use ${name}`);
    assert.ok(homeComponents.includes('TaskRow') && homeComponents.includes('SidebarConversationRow'));
    const draft = `Unsent home draft ${viewport.width}`;
    await homeEditor.fill(draft);
    await page.getByRole('button', { name: /Fixture model/ }).click();
    await page.getByRole('menuitem', { name: /^(Select model|选择模型)$/ }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await homeEditor.innerText(), draft, 'Opening the existing model menu must preserve the same document');
    assert.equal(modules.length, 1);
    checks.push(`${viewport.width}px: real home mounts HomeComposerLayout, TaskRow and SidebarConversationRow; typing and the original model menu preserve the unsent document`);
    await homeEditor.fill('');
    modules.length = 0;
    await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id), { waitUntil: 'commit' });
    const toggle = page.locator('[data-markdown-copy="exclude"][aria-expanded]').first();
    await toggle.waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector('[data-markdown-copy="exclude"][aria-expanded]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.getByText(tail, { exact: true }).count(), 0);
    // The pinned layout hides inline timestamps in several sidebar variants.
    // Its existing row hover card is also an official YEc consumer.
    await page.locator('[data-app-action-sidebar-thread-row]').first().hover();
    let components = await mountedComponents(page);
    const timestampDeadline = Date.now() + 10_000;
    while (!components.includes('RelativeTime') && Date.now() < timestampDeadline) {
      await page.waitForTimeout(50);
      components = await mountedComponents(page);
    }
    assert.ok(components.includes('CollapsibleUserMessageContent'), 'The authored message component must be mounted in the existing page');
    for (const name of ['UserMessage', 'UserMessageBody', 'UserMessageFileAttachment', 'UserMessageImageList', 'UserMessageImage']) assert.ok(components.includes(name), `The original turn must mount ${name}`);
    await page.getByText('main.ts', { exact: true }).first().waitFor();
    for (const name of ['MainComposerView', 'ComposerControllerProvider', 'ComposerDraftScope']) assert.ok(components.includes(name), `The existing local thread must use ${name}`);
    assert.ok(components.includes('RelativeTime'), 'The authored timestamp component must be mounted in the existing sidebar hover card');
    assert.ok(components.includes('TaskRow') && components.includes('SidebarConversationRow'));
    assert.ok(components.includes('MarkdownCodeBlock') && components.includes('CodeBlockFrame'), 'The original Markdown path must render the authored code components');
    // The original intersection observer may already have rendered the diagram
    // by the time the additional attachment checks finish. B02 separately
    // verifies the authored placeholder while it is outside the visible area.
    const mermaidPlaceholder = page.getByRole('status', { name: 'Loading Mermaid diagram', exact: true });
    if (await mermaidPlaceholder.count()) {
      components = await mountedComponents(page);
      assert.ok(components.includes('MermaidLoadingPlaceholder'), 'The real deferred Mermaid path must use the authored placeholder');
    } else {
      await page.getByRole('img', { name: 'Mermaid diagram', exact: true }).waitFor();
    }
    assert.equal(modules.length, 1, 'All seams import one authored ESM module in this document');
    checks.push(`${viewport.width}px: original page mounts ${components.join(', ')} from one authored module`);
    await page.screenshot({ path: join(output, `${viewport.width}-collapsed.png`) });
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await toggle.click();
    await page.getByText(tail, { exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-markdown-copy="exclude"][aria-expanded]')?.getAttribute('aria-expanded') === 'false');
    checks.push(`${viewport.width}px: the official disclosure expands and collapses the complete user message`);

    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.getByText(tail, { exact: true }).waitFor();
    assert.equal(await toggle.count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByText(tail, { exact: true }).count(), 0);
    checks.push(`${viewport.width}px: original print state shows full text and restores the collapsed state afterward`);

    const copy = page.getByRole('button', { name: /^(Copy code|复制代码)$/ }).first();
    await copy.click();
    await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected), code);
    checks.push(`${viewport.width}px: existing code copy keeps Unicode, tabs and newlines`);
    const codeFrame = page.locator('[data-code-block]').filter({ hasText: 'const greeting' }).first();
    await codeFrame.getByRole('button', { name: 'Enable word wrap', exact: true }).click();
    assert.equal(await codeFrame.getByRole('button', { name: 'Disable word wrap', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await codeFrame.locator('[data-code-block-source]').evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap');
    const latex = page.locator('[data-code-block][data-source-visible]').first();
    await latex.getByRole('button', { name: 'Show source', exact: true }).click();
    assert.equal(await latex.getAttribute('data-source-visible'), 'true');
    assert.equal(await latex.locator('[data-code-block-preview]').getAttribute('data-markdown-copy'), 'exclude');
    await latex.getByRole('button', { name: 'Show preview', exact: true }).click();
    assert.equal(await latex.getAttribute('data-source-visible'), 'false');
    checks.push(`${viewport.width}px: official word-wrap preference and LaTeX source/preview controls work through the authored frame`);
    await page.reload({ waitUntil: 'commit' });
    await toggle.waitFor({ timeout: 60_000 });
    assert.ok((await mountedComponents(page)).includes('CollapsibleUserMessageContent'));
    assert.equal(await codeFrame.getByRole('button', { name: 'Disable word wrap', exact: true }).getAttribute('aria-pressed'), 'true');
    // Restore the fixture preference before the next independent viewport.
    await codeFrame.getByRole('button', { name: 'Disable word wrap', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    checks.push(`${viewport.width}px: reload keeps the original route and has no horizontal overflow`);
    await page.screenshot({ path: join(output, `${viewport.width}-reloaded.png`) });
    const imageButtons = page.getByRole('button', { name: 'User attachment', exact: true });
    assert.equal(await imageButtons.count(), 2);
    await imageButtons.first().click();
    await page.getByRole('dialog').waitFor();
    const firstImage = await page.getByRole('dialog').getByRole('img', { name: 'User attachment', exact: true }).getAttribute('src');
    await page.getByRole('button', { name: 'Next image', exact: true }).click();
    await page.getByRole('button', { name: 'Previous image', exact: true }).waitFor();
    const secondImage = await page.getByRole('dialog').getByRole('img', { name: 'User attachment', exact: true }).getAttribute('src');
    assert.notEqual(secondImage, firstImage);
    await page.getByRole('button', { name: 'Previous image', exact: true }).click();
    await page.waitForFunction(expected => document.querySelector('[role="dialog"] img[alt="User attachment"]')?.getAttribute('src') === expected, firstImage);
    await page.getByRole('button', { name: 'Next image', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.ok(await imageButtons.nth(1).evaluate(element => element === document.activeElement));
    checks.push(`${viewport.width}px: local-host image loading, original preview next/previous, Escape and focus restoration use the authored image family`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/settings/general-settings'), { waitUntil: 'commit' });
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 60_000 });
  assert.ok((await mountedComponents(page)).includes('SettingsPage'), 'The actual settings route must mount the authored root');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor();
  assert.ok((await mountedComponents(page)).includes('SettingsPage'));
  await page.screenshot({ path: join(output, 'settings-appearance.png') });
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor({ timeout: 60_000 });
  assert.ok((await mountedComponents(page)).includes('SettingsPage'));
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
  checks.push('The real settings route mounts SettingsPage; General/Appearance navigation and route reload retain the original section content');
  await page.screenshot({ path: join(output, 'settings-general.png') });
  await page.getByRole('link', { name: 'Back to app', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Do anything', exact: true });
  await editor.waitFor();
  const retainedDraft = 'Unsent draft through settings navigation';
  await editor.fill(retainedDraft);
  await page.getByRole('button', { name: 'Open profile menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Settings/ }).click();
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Back to app', exact: true }).click();
  await editor.waitFor();
  assert.equal(await editor.innerText(), retainedDraft);
  await page.reload({ waitUntil: 'commit' });
  await editor.waitFor({ timeout: 60_000 });
  assert.equal(await editor.innerText(), retainedDraft);
  checks.push('The original home draft survives opening settings, Back to app and a document reload with the authored controller provider');
  assert.ok((await mountedComponents(page)).includes('ComposerDraftScope'));
  await page.screenshot({ path: join(output, 'restored-home-draft.png') });
  await context.close();
  assert.equal(fake.calls('turn/start').length, 0, 'Display, settings navigation and draft restoration do not submit a turn');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot()).catch(() => {});
  }
  throw error;
} finally {
  await browser.close(); await app.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, output }));
}
