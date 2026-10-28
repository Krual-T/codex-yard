// Focused acceptance of authored settings in the actual pinned renderer.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/yard-settings-ui-');
const output = resolve(process.env.AGENTS_SETTINGS_EVIDENCE ?? '.local/renderer-settings');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (fixture)' }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
const app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), workspace: root,
  socketPath: fake.socketPath, codexHome: join(root, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM
  ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, checks, errors };
let page: Page | undefined;

async function mounted(page: Page, expected: string[]) {
  const names = await page.locator('body').evaluate(body => {
    type Fiber = { type?: { name?: string; displayName?: string }; return?: Fiber; child?: Fiber; sibling?: Fiber };
    const element = [...body.querySelectorAll('*')].find(node => Object.keys(node).some(key => key.startsWith('__reactFiber$')));
    if (!element) throw new Error('No renderer React host element');
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'))!;
    let root = Reflect.get(element, key) as Fiber;
    while (root.return) root = root.return;
    const queue = [root], names = new Set<string>();
    for (let i = 0; queue.length && i < 50_000; i++) {
      const fiber = queue.pop()!;
      const name = fiber.type?.displayName ?? fiber.type?.name;
      if (name) names.add(name);
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return [...names];
  });
  for (const name of expected) assert.ok(names.includes(name), `The fixed settings page must use ${name}`);
  return expected;
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.AGENTS_SETTINGS_PREFERENCES_ONLY === '1') {
    await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/settings/general-settings'), { waitUntil: 'commit' });
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor({ timeout: 60_000 });
    const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
    await advanced.click();
    await mounted(page, ['ReducedMotion', 'DiffMarkers', 'PointerCursors', 'FontSmoothing']);
    checks.push('The actual Appearance route calls all four authored preference components with the original settings scope');
    const motionOn = page.getByRole('button', { name: 'On', exact: true });
    const symbols = page.getByRole('button', { name: 'Plus / minus diff markers', exact: true });
    const pointers = page.getByRole('switch', { name: 'Use pointer cursors', exact: true });
    await motionOn.click();
    await symbols.click();
    const nextPointers = await pointers.getAttribute('aria-checked') !== 'true';
    await pointers.click();
    await page.waitForFunction(expected => document.querySelector('[role="switch"][aria-label="Use pointer cursors"]')?.getAttribute('aria-checked') === String(expected), nextPointers);
    assert.equal(await motionOn.getAttribute('aria-pressed'), 'true');
    assert.equal(await symbols.getAttribute('aria-pressed'), 'true');
    assert.equal(await pointers.getAttribute('aria-checked'), String(nextPointers));
    checks.push('Original reduced-motion, diff-marker and pointer writes update their authored controls');
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor({ timeout: 60_000 });
    await advanced.click();
    assert.equal(await motionOn.getAttribute('aria-pressed'), 'true');
    assert.equal(await symbols.getAttribute('aria-pressed'), 'true');
    assert.equal(await pointers.getAttribute('aria-checked'), String(nextPointers));
    await mounted(page, ['ReducedMotion', 'DiffMarkers', 'PointerCursors', 'FontSmoothing']);
    checks.push('All three saved preferences survive a full document reload through the original persistence path');
    assert.equal(await page.getByRole('switch', { name: 'Font smoothing', exact: true }).count(), 0);
    report.fontSmoothing = 'Component called on this Linux host; its macOS-only control remains a conditional fixture test';
    await page.setViewportSize({ width: 800, height: 1280 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(output, 'preferences-800.png') });
    await writeFile(join(output, 'final-aria.txt'), await page.locator('body').ariaSnapshot());
    checks.push('The preference rows keep the original 800px layout without horizontal overflow');
  } else {
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/settings/general-settings'), { waitUntil: 'commit' });
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 60_000 });
  await mounted(page, ['SettingsPage', 'GeneralSettings', 'GeneralContent']);
  await page.screenshot({ path: join(output, 'general.png') });
  checks.push('The actual General route mounts GeneralSettings and GeneralContent under the existing SettingsPage');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor();
  await mounted(page, ['AppearanceSettings', 'AppearancePreferences', 'ThemeVariants', 'ThemeForm', 'Mode', 'ModeOption', 'ModePreview']);
  const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
  assert.equal(await advanced.getAttribute('aria-expanded'), 'false');
  // The original radios are sr-only; the visible preview is their native label.
  await page.getByRole('radio', { name: 'Light', exact: true }).locator('..').click();
  await page.getByRole('button', { name: 'Copy Light theme', exact: true }).click();
  const theme = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(theme.length > 20, 'The actual theme service must export a share string');
  await page.getByRole('button', { name: 'Import Light theme', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const share = dialog.getByRole('textbox', { name: 'Light theme share string', exact: true });
  await share.fill('invalid fixture');
  assert.ok(await dialog.getByRole('button', { name: 'Import theme', exact: true }).isDisabled());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Import Light theme', exact: true }).click();
  assert.equal(await share.inputValue(), '', 'Cancel must clear the authored form value');
  await share.fill('  ' + theme + '  ');
  assert.ok(await dialog.getByRole('button', { name: 'Import theme', exact: true }).isEnabled());
  await dialog.getByRole('button', { name: 'Import theme', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  checks.push('Original theme export/clipboard and import validation, cancel/reset and trimmed successful import run through ThemeForm');
  await advanced.click();
  assert.equal(await advanced.getAttribute('aria-expanded'), 'true');
  await mounted(page, ['FontSizeRow']);
  const uiSize = page.getByRole('spinbutton', { name: 'Sans font size', exact: true });
  const codeSize = page.getByRole('spinbutton', { name: 'Code font size', exact: true });
  const originalUi = await uiSize.inputValue(), originalCode = await codeSize.inputValue();
  const nextUi = String(Number(originalUi) === 15 ? 16 : 15);
  await uiSize.fill(nextUi);
  await uiSize.press('Enter');
  await codeSize.fill('999');
  await codeSize.blur();
  assert.equal(await codeSize.inputValue(), originalCode);
  const separate = page.getByRole('switch', { name: 'Separate light and dark modes', exact: true });
  await separate.check();
  await page.getByRole('button', { name: 'Copy Dark theme', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Copy (Light|Dark) theme$/ }).count(), 2);
  await page.screenshot({ path: join(output, 'appearance-separate.png') });
  checks.push('Authored advanced expansion and separate modes show both original theme variants; font commit and invalid-value restoration preserve original settings writers');
  await page.getByRole('radio', { name: 'Dark', exact: true }).locator('..').click();
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label="Dark"]')?.checked);
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor({ timeout: 60_000 });
  assert.ok(await page.getByRole('radio', { name: 'Dark', exact: true }).isChecked());
  assert.equal(await advanced.getAttribute('aria-expanded'), 'false');
  await advanced.click();
  assert.equal(await uiSize.inputValue(), nextUi);
  assert.equal(await separate.getAttribute('aria-checked'), 'false');
  await mounted(page, ['AppearanceSettings', 'AppearancePreferences', 'ThemeVariants', 'ThemeForm', 'Mode', 'FontSizeRow']);
  checks.push('Page reload preserves original saved mode and UI font size while local expansion/separate-mode state starts fresh');
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: join(output, 'appearance-800.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('The authored Appearance route retains the original responsive layout at 800px without horizontal overflow');
  await writeFile(join(output, 'final-aria.txt'), await page.locator('body').ariaSnapshot());
  }
  await context.close();
  assert.equal(fake.calls('turn/start').length, 0);
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
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, output }));
}
