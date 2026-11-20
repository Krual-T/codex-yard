import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Locator } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const source = process.argv.includes('--source');
const dark = process.argv.includes('--dark');
const narrow = process.argv.includes('--narrow');
const preview = process.argv.includes('--preview');
const evidence = resolve(process.env.AGENTS_MESSAGE_ACTIONS_EVIDENCE ?? '.local/workspace-message-actions');
const root = await mkdtemp('/tmp/yard-message-actions-');
await mkdir(evidence, { recursive: true });
await writeFile(join(root, 'projects.json'), JSON.stringify([{ name: 'Message actions fixture', path: root }]));
const fake = await createFakeCodex(root);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerAccountId: null, status: null, error: null }));
const id = '00000000-0000-4000-8000-000000000422';
const older = 'Check the earlier message.';
const newer = 'Check the latest message.';
const replies = ['The **earlier** reply is ready.', 'The **latest** reply is ready.'];
fake.threads.set(id, fixtureThread(id, root, { name: 'Message actions', turns: [older, newer].map((text, index) => ({
  ...fixtureTurn('turn-' + index, [
    { id: 'user-' + index, type: 'userMessage', content: [{ type: 'text', text, text_elements: [] }] },
    { ...agentItem('reply-' + index, replies[index]!), phase: 'final_answer' },
  ]), startedAt: 1795008000 + index * 300, completedAt: 1795008042 + index * 300, durationMs: 42_000,
})) }));
const app = await createNativeWorkbench({ port: 0, dataDir: root, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), sourceWorkspace: source, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  hasTouch: narrow, isMobile: narrow, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.url });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const url = app.url + '/?initialRoute=' + encodeURIComponent('/local/' + id);
const transcript = page.getByRole('region', { name: 'Conversation', exact: true });
const prompts = transcript.locator('[data-user-message-bubble]');
const latest = transcript.getByText('The latest reply is ready.', { exact: true });
const earlier = transcript.getByText('The earlier reply is ready.', { exact: true });
const userCopies = transcript.getByRole('button', { name: 'Copy message', exact: true });
const responseCopies = transcript.getByRole('button', { name: /^(?:Copy|Copy response)$/ });
const triggers = transcript.getByRole('button', { name: 'More actions', exact: true });
const branchMenu = page.getByRole('menu').filter({ hasText: 'Branch in new chat' });
const edit = transcript.getByRole('button', { name: 'Edit message', exact: true });

async function measure(locator: Locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const { color, backgroundColor, borderRadius, fontSize } = getComputedStyle(element);
    let opacity = 1;
    for (let cursor: Element | null = element; cursor; cursor = cursor.parentElement) {
      opacity *= Number(getComputedStyle(cursor).opacity);
    }
    return { x: box.x, y: box.y, width: box.width, height: box.height, opacity, color, backgroundColor, borderRadius, fontSize };
  });
}
async function frame(name: string) {
  await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled', caret: 'hide' });
}
async function copy(expected: string, control: Locator) {
  await control.click();
  await page.waitForFunction(async value => (await navigator.clipboard.readText()).trimEnd() === value, expected, { timeout: 6000 });
}

try {
  await page.goto(url, { waitUntil: 'commit' });
  await latest.waitFor({ timeout: 30_000 });
  await earlier.waitFor();
  if (narrow) {
    const sidebar = page.locator('[data-app-shell-sidebar-trigger][aria-expanded="true"]:visible').first();
    if (await sidebar.isVisible()) await sidebar.tap();
  }
  if (preview) {
    await browser.close();
    console.log('PREVIEW_URL=' + url);
    await delay(45 * 60_000);
  } else {
    assert.equal(await triggers.count(), 2);
    assert.equal(await userCopies.count(), 2);
    if (!narrow) await page.mouse.move(2, 2);
    const rest = { prompt: await measure(userCopies.last()), earlier: await measure(triggers.first()), latest: await measure(triggers.last()) };
    await frame('rest');
    if (!narrow) {
      await prompts.last().hover();
      await userCopies.last().hover();
      const hint = page.getByRole('tooltip').filter({ hasText: 'Copy message' });
      await hint.waitFor({ timeout: 5_000 });
      if (source) {
        const tip = await measure(hint);
        const control = await measure(userCopies.last());
        assert.ok(Math.abs(tip.x + tip.width / 2 - control.x - control.width / 2) <= 1);
        assert.equal(tip.height, 30);
        assert.equal(await hint.evaluate(node => node.matches(':popover-open')), true);
      }
      await frame('copy-hint');
    }
    const prompt = { copy: await measure(userCopies.last()), edit: await measure(edit.last()) };
    await frame('prompt-controls');
    if (narrow) {
      await userCopies.last().tap();
      await page.waitForFunction(async expected => await navigator.clipboard.readText() === expected, newer);
    } else await copy(newer, userCopies.last());
    const copied = transcript.getByRole('button', { name: 'Copied', exact: true });
    await copied.waitFor({ timeout: 3_000 });
    if (source) assert.equal((await measure(copied)).width, prompt.copy.width);
    await frame('prompt-copied');
    if (narrow) await earlier.tap();
    else await earlier.hover();
    const oldHover = await measure(triggers.first());
    await frame('earlier-controls');
    await copy(replies[0]!, responseCopies.first());
    const more = triggers.last();
    if (narrow) await more.tap(); else await more.press('Enter');
    await branchMenu.waitFor({ timeout: 8000 });
    const menu = await measure(branchMenu);
    const anchor = await measure(more);
    const focusedOnOpen = await branchMenu.evaluate(element => element.contains(document.activeElement));
    const item = branchMenu.getByRole('menuitem');
    await frame('menu');
    await page.keyboard.press('Escape');
    await branchMenu.waitFor({ state: 'hidden' });
    const focusedOnClose = await more.evaluate(element => element === document.activeElement);
    assert.equal(fake.calls('thread/fork').length, 0);
    await writeFile(join(evidence, 'metrics.json'), JSON.stringify({ rest, prompt, oldHover, menu, anchor, focusedOnOpen, focusedOnClose }, null, 2));
    assert.equal(rest.latest.opacity, 1);
    assert.equal(rest.prompt.opacity, narrow ? 1 : 0);
    assert.equal(rest.earlier.opacity, 0);
    assert.equal(focusedOnOpen && focusedOnClose, true);
    assert.equal(prompt.copy.opacity, 1);
    assert.equal(oldHover.opacity, narrow ? 0 : 1);
    if (source) {
      const replyTime = transcript.locator('time.yard-source-reply-time').last();
      assert.equal(await replyTime.getAttribute('datetime'), new Date(1795008342 * 1000).toISOString());
      if (!narrow) {
        await latest.hover();
        assert.equal((await measure(replyTime)).opacity, 1);
        await more.press('ArrowDown');
        await branchMenu.waitFor();
        await page.keyboard.press('Tab');
        await branchMenu.waitFor({ state: 'hidden' });
        assert.equal(fake.calls('thread/fork').length, 0);
        await earlier.hover();
        await triggers.first().click();
      } else {
        await triggers.first().tap();
      }
      await item.click();
      await fake.waitFor(message => message.method === 'thread/fork' && message.id != null, 8_000);
      const forks = fake.calls('thread/fork');
      assert.equal(forks.length, 1);
      assert.equal(forks[0]?.params.threadId, id);
      const child = [...fake.threads.values()].find(thread => thread.forkedFromId === id);
      assert.ok(child);
      await page.waitForURL(target => target.searchParams.get('initialRoute') === '/local/' + child.id, { timeout: 8000 });
      assert.deepEqual(child.turns.map(turn => turn.id), ['turn-0']);
      await earlier.waitFor();
      assert.equal(await latest.count(), 0);
      await frame('branched');
    }
    assert.deepEqual(errors, []);
  }
} catch (error) {
  await frame('error').catch(() => {});
  throw error;
} finally {
  if (browser.isConnected()) await browser.close();
  await app.close();
  await fake.close();
  await rm(root, { recursive: true, force: true });
}
