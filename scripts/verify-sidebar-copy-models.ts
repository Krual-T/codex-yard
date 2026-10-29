// Run under /tmp/agents-workbench-heavy.lock after building. No real conversations are used.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Locator, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, agentItem } from '../test/fake-codex.ts';
import { isolatePublicVerifier } from './public-verifier-environment.ts';

const root = await mkdtemp(join(tmpdir(), 'yard-ui-bugs-'));
const output = process.env.AGENTS_BUG_EVIDENCE
  ? resolve(process.env.AGENTS_BUG_EVIDENCE) : await mkdtemp(join(tmpdir(), 'yard-sidebar-copy-evidence-'));
const dataDir = join(root, 'data');
const codexHome = join(root, 'codex');
await isolatePublicVerifier(root);
await mkdir(dataDir, { mode: 0o700 });
await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Active project', path: root }]));
const fake = await createFakeCodex(root);
const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const code = 'const greeting = "你好";\n\tconsole.log(greeting);';
const message = 'Copy fixture:\n\n```ts\n' + code + '\n```';
fake.threads.set(id, fixtureThread(id, root, { name: 'Code example', model: 'gpt-6-sol',
  status: { type: 'active', activeFlags: [] }, turns: [fixtureTurn('turn-copy', [agentItem('code-copy', message)], 'inProgress')] }));
fake.threads.set(secondId, fixtureThread(secondId, root, { name: 'Second conversation', model: 'gpt-6-sol' }));
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)', codexHome }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
const config = record(fake.defaultResult('config/read', {}).config);
type Values = { model: string | null; model_reasoning_effort: string | null };
type FixtureConfig = { version: number; activeProfile: 'work' | null; base: Values; profiles: { work: Values } };
type ConfigReadObservation = { version: number; activeProfile: FixtureConfig['activeProfile']; effective: Values };
type ConfigTerminal = { status: 'ok' | 'okOverridden'; version: string; filePath: string; overriddenMetadata: { message: string } | null };
const fixturePath = join(root, 'model-config-fixture.json');
const configFile = join(codexHome, 'config.toml');
const overrideMessage = 'Fixture profile overrides the base configuration.';
const configReads: ConfigReadObservation[] = [];
const configTerminals: ConfigTerminal[] = [];
const readFixture = (): FixtureConfig => JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureConfig;
const writeFixture = (value: FixtureConfig) => writeFileSync(fixturePath, JSON.stringify(value), { mode: 0o600 });
writeFixture({ version: 1, activeProfile: null, base: { model: null, model_reasoning_effort: null },
  profiles: { work: { model: 'gpt-6-sol', model_reasoning_effort: 'low' } } });
fake.handlers.set('config/read', () => {
  const state = readFixture();
  const effective = state.activeProfile ? state.profiles[state.activeProfile] : state.base;
  configReads.push({ version: state.version, activeProfile: state.activeProfile, effective: { ...effective } });
  return { config: { ...config, ...effective, profile: state.activeProfile, model_provider: 'openai' }, origins: {},
    layers: [{ name: { type: 'user', file: configFile, profile: null }, version: String(state.version) }] };
});
fake.handlers.set('model/list', () => ({ data: [
  ['gpt-6-sol', 'GPT-6 Sol'], ['gpt-6.1-sol', 'GPT-6.1 Sol'], ['gpt-6.1-terra', 'GPT-6.1 Terra'],
  ['hidden-fixture', 'Hidden fixture'], ['gpt-6.1-hidden-fixture', 'Hidden 6.1 fixture'],
].map(([model, displayName], index) => ({ id: model, model, displayName, description: 'Model visibility fixture', isDefault: index === 0,
  hidden: index >= 3, defaultReasoningEffort: 'high', inputModalities: ['text'],
  supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }, { reasoningEffort: 'high', description: 'High' }] })), nextCursor: null }));
fake.handlers.set('config/batchWrite', params => {
  const state = readFixture();
  assert.equal(params.filePath, null);
  assert.equal(params.expectedVersion, String(state.version));
  assert.equal(params.reloadUserConfig, true);
  assert.ok(Array.isArray(params.edits) && params.edits.length > 0);
  let overridden = false;
  for (const raw of params.edits) {
    const edit = record(raw);
    assert.equal(edit.mergeStrategy, 'upsert');
    assert.ok(typeof edit.value === 'string');
    const key = String(edit.keyPath);
    if (key === 'model' || key === 'model_reasoning_effort') {
      state.base[key] = edit.value;
      overridden ||= state.activeProfile !== null;
    } else throw new Error('Unexpected fixture config edit: ' + key);
  }
  state.version++;
  writeFixture(state);
  const terminal: ConfigTerminal = { status: overridden ? 'okOverridden' : 'ok', version: String(state.version), filePath: configFile,
    overriddenMetadata: overridden ? { message: overrideMessage } : null };
  configTerminals.push(terminal);
  return terminal;
});
const checks: string[] = [], gaps: string[] = [], errors: string[] = [];
const profileObservations: Record<string, unknown>[] = [];
const report: Record<string, unknown> = { checks, gaps, errors, renderer: 'owned', realDaemonUsed: false, locale: 'en-US',
  profileFixture: 'synthetic active override; not a claim of current CLI named-profile support', profileObservations };
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
async function setup(current: Page) {
  assert.ok(app);
  const origin = app.url;
  current.on('pageerror', error => errors.push(error.message));
  current.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await current.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
}
async function checkLocale(current: Page) {
  await current.waitForFunction(() => document.documentElement.lang === 'en-US', undefined, { timeout: 10000 });
  assert.equal(await current.evaluate(() => navigator.language), 'en-US');
}
async function waitValue(locator: Locator, expected: string) {
  const deadline = Date.now() + 10000;
  while (await locator.inputValue() !== expected) {
    assert.ok(Date.now() < deadline, `Expected ${expected} in ${String(locator)}`);
    await delay(50);
  }
}
async function waitWrite(start: number) {
  const deadline = Date.now() + 10000;
  while (fake.calls('config/batchWrite').length <= start) {
    assert.ok(Date.now() < deadline, 'No configuration write reached the fixture');
    await delay(50);
  }
}
async function waitVersion(previous: number) {
  const deadline = Date.now() + 10000;
  while (readFixture().version <= previous) {
    assert.ok(Date.now() < deadline, 'The fixture did not commit the configuration write');
    await delay(50);
  }
}
async function waitEnabled(locator: Locator) {
  const deadline = Date.now() + 10000;
  while (!await locator.isEnabled()) {
    assert.ok(Date.now() < deadline, `Control did not become available: ${String(locator)}`);
    await delay(50);
  }
}
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await page.screenshot({ path: join(output, `${name}.png`) });
  await writeFile(join(output, `${name}.txt`), await page.locator('body').ariaSnapshot());
}
try {
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: join(root, 'home'), CODEX_HOME: codexHome,
      XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'xdg-data'),
      XDG_RUNTIME_DIR: join(root, 'runtime'), TMPDIR: join(root, 'tmp') },
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
      '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 1280 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, locale: 'en-US', serviceWorkers: 'block',
      permissions: ['clipboard-read', 'clipboard-write'] });
    page = await context.newPage();
    await setup(page);
    await page.goto(app.url + '/local/' + id, { waitUntil: 'commit' });
    await page.locator('[data-owned-renderer="true"]').waitFor();
    await checkLocale(page);
    const copy = page.getByRole('button', { name: 'Copy code', exact: true });
    await copy.waitFor({ timeout: 60000 });
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    await copy.tap();
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), code, { timeout: 5000 });
    checks.push(`${viewport.width}px: code copy preserves Unicode, tabs and newlines`);

    const folder = page.getByRole('button', { name: 'Active project', exact: true });
    if (await folder.getAttribute('aria-expanded') === 'true') await folder.tap();
    const indicator = folder.locator('..').getByRole('img', { name: 'In progress', exact: true });
    const newChat = page.getByRole('button', { name: 'New chat in Active project', exact: true });
    try {
      await indicator.waitFor({ timeout: 10000 });
      const indicatorBox = await indicator.boundingBox(), actionBox = await newChat.boundingBox();
      assert.ok(indicatorBox && actionBox);
      assert.ok(indicatorBox.x + indicatorBox.width <= actionBox.x, 'The running indicator and new-chat button must not overlap');
      checks.push(`${viewport.width}px: active collapsed project shows its indicator beside new-chat`);
    } catch (error) { gaps.push(`${viewport.width}px: collapsed project indicator: ${String(error)}`); }
    await folder.screenshot({ path: join(output, `${viewport.width}-active-project.png`) });
    await newChat.tap();
    await page.getByRole('textbox').last().waitFor();
    checks.push(`${viewport.width}px: the new-chat button still opens the composer`);
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage();
  await setup(page);
  await page.goto(app.url + '/local/' + id, { waitUntil: 'commit' });
  await checkLocale(page);
  const copy = page.getByRole('button', { name: 'Copy code', exact: true });
  await copy.waitFor({ timeout: 60000 });
  // Keep the actual read API to verify the OS clipboard while exercising the
  // HTTP/unsupported-API path through the real renderer button and RPC service.
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('legacy-copy-sentinel');
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: undefined });
  });
  await copy.click();
  await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), code, { timeout: 5000 });
  checks.push('Desktop: legacy copy writes the actual clipboard when the async write API is unavailable');
  await page.evaluate(() => { document.execCommand = () => false; });
  await page.getByRole('button', { name: /^(Copy code|Copied)$/ }).click();
  await page.locator('.yard-code-block').getByRole('alert').waitFor({ timeout: 10000 });
  checks.push('Desktop: failed clipboard writes surface an error');
  await context.close();

  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US', serviceWorkers: 'block' });
  await setup(page);
  await page.goto(app.url, { waitUntil: 'commit' });
  await checkLocale(page);
  const modelPicker = page.getByRole('combobox', { name: 'Model', exact: true });
  const effortPicker = page.getByRole('combobox', { name: 'Reasoning effort', exact: true });
  await modelPicker.locator('option[value="gpt-6.1-sol"]').waitFor({ state: 'attached', timeout: 60000 });
  await modelPicker.locator('option[value="gpt-6.1-terra"]').waitFor({ state: 'attached' });
  assert.equal(await modelPicker.locator('option[value="gpt-6.1-sol"]').isDisabled(), false);
  assert.equal(await modelPicker.locator('option[value="gpt-6.1-terra"]').isDisabled(), false);
  assert.equal(await modelPicker.locator('option[value="hidden-fixture"]').count(), 0);
  assert.equal(await modelPicker.locator('option[value="gpt-6.1-hidden-fixture"]').count(), 0);
  await modelPicker.screenshot({ path: join(output, 'models.png') });
  checks.push('Both visible 6.1 models are selectable and hidden models, including a 6.1 fixture, stay hidden');
  try {
    await waitEnabled(modelPicker);
    await waitValue(modelPicker, 'gpt-6-sol');
    assert.equal(readFixture().base.model, null, 'The effective model must not overwrite the null configured baseline');
    let before = readFixture();
    let writes = fake.calls('config/batchWrite').length;
    await effortPicker.selectOption('low');
    await waitWrite(writes); await waitVersion(before.version); await waitEnabled(effortPicker);
    assert.deepEqual(fake.calls('config/batchWrite').at(-1)?.params.edits,
      [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }]);
    const effortWrite = fake.messages.lastIndexOf(fake.calls('config/batchWrite').at(-1)!);
    assert.ok(fake.messages.slice(effortWrite + 1).some(message => message.method === 'config/read'), 'Save must re-read configuration');
    assert.deepEqual(readFixture().base, { model: null, model_reasoning_effort: 'low' });
    await page.reload({ waitUntil: 'commit' });
    await checkLocale(page); await waitEnabled(effortPicker);
    await waitValue(modelPicker, 'gpt-6-sol'); await waitValue(effortPicker, 'low');
    assert.equal(readFixture().base.model, null);
    assert.equal(fake.calls('config/batchWrite').length, writes + 1, 'Reload must not repeat the effort write');
    checks.push('Default effort is written with the versioned base target and survives reload with a null model baseline');

    before = readFixture(); writes = fake.calls('config/batchWrite').length;
    await modelPicker.selectOption('gpt-6.1-sol');
    await waitWrite(writes); await waitVersion(before.version); await waitEnabled(modelPicker);
    assert.deepEqual(fake.calls('config/batchWrite').at(-1)?.params.edits,
      [{ keyPath: 'model', value: 'gpt-6.1-sol', mergeStrategy: 'upsert' }]);
    const modelWrite = fake.messages.lastIndexOf(fake.calls('config/batchWrite').at(-1)!);
    assert.ok(fake.messages.slice(modelWrite + 1).some(message => message.method === 'config/read'), 'Save must re-read configuration');
    assert.deepEqual(readFixture().base, { model: 'gpt-6.1-sol', model_reasoning_effort: 'low' });
    await page.reload({ waitUntil: 'commit' });
    await checkLocale(page); await waitEnabled(modelPicker);
    await waitValue(modelPicker, 'gpt-6.1-sol'); await waitValue(effortPicker, 'low');
    assert.equal(fake.calls('config/batchWrite').length, writes + 1, 'Reload must not repeat the model write');
    checks.push('Selected default model survives a confirmed versioned write and reload');
  } catch (error) {
    gaps.push('Default model/effort persistence: ' + String(error));
    await capture('default-model-failure').catch(() => {});
  }
  await page.close();

  const fixture = readFixture();
  fixture.activeProfile = 'work';
  writeFixture(fixture);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US', serviceWorkers: 'block' });
  await setup(page);
  await page.goto(app.url, { waitUntil: 'commit' });
  await checkLocale(page);
  const profileModel = page.getByRole('combobox', { name: 'Model', exact: true });
  const profileEffort = page.getByRole('combobox', { name: 'Reasoning effort', exact: true });
  await waitEnabled(profileModel); await waitEnabled(profileEffort);
  await waitValue(profileModel, fixture.profiles.work.model!);
  await waitValue(profileEffort, fixture.profiles.work.model_reasoning_effort!);
  for (const test of [
    { field: 'model_reasoning_effort' as const, value: 'high', control: profileEffort },
    { field: 'model' as const, value: 'gpt-6.1-terra', control: profileModel },
  ]) {
    try {
      await waitEnabled(test.control);
      const before = readFixture(), writes = fake.calls('config/batchWrite').length, reads = configReads.length;
      assert.equal(before.activeProfile, 'work');
      await test.control.selectOption(test.value);
      await waitWrite(writes); await waitVersion(before.version);
      const after = readFixture();
      const request = fake.calls('config/batchWrite').at(-1)?.params;
      const terminal = configTerminals.at(-1);
      const observation: Record<string, unknown> = { field: test.field, before, after, request, terminal };
      profileObservations.push(observation);
      assert.deepEqual(request, { edits: [{ keyPath: test.field, value: test.value, mergeStrategy: 'upsert' }],
        filePath: null, expectedVersion: String(before.version), reloadUserConfig: true });
      assert.equal(after.version, before.version + 1);
      assert.deepEqual(after.base, { ...before.base, [test.field]: test.value });
      assert.equal(after.activeProfile, before.activeProfile);
      assert.deepEqual(after.profiles, before.profiles, 'The synthetic effective override must remain unchanged');
      assert.deepEqual(terminal, { status: 'okOverridden', version: String(after.version), filePath: configFile,
        overriddenMetadata: { message: overrideMessage } });
      await page.getByRole('status').filter({ hasText: overrideMessage }).waitFor({ timeout: 10000 });
      await page.getByRole('alert').filter({ hasText: 'The saved configuration differs from your edit.' }).waitFor({ timeout: 10000 });
      assert.equal(await test.control.inputValue(), test.value, 'The unaccepted edit remains visible for review');
      const readback = configReads.slice(reads).reverse().find(read => read.version === after.version);
      assert.deepEqual(readback, { version: after.version, activeProfile: 'work', effective: before.profiles.work });
      observation.readback = readback;
      checks.push(`Profile override: ${test.field} writes versioned base, retains the effective profile and displays the override`);
      await capture(`profile-${test.field}-overridden`);
      const reloadReads = configReads.length;
      await page.reload({ waitUntil: 'commit' });
      await checkLocale(page); await waitEnabled(profileModel); await waitEnabled(profileEffort);
      await waitValue(profileModel, before.profiles.work.model!);
      await waitValue(profileEffort, before.profiles.work.model_reasoning_effort!);
      assert.deepEqual(readFixture(), after, 'Reload must retain the base write and unchanged override');
      assert.equal(fake.calls('config/batchWrite').length, writes + 1, 'Reload must not repeat the base write');
      const refreshed = configReads.slice(reloadReads).reverse().find(read => read.version === after.version);
      assert.deepEqual(refreshed, { version: after.version, activeProfile: 'work', effective: before.profiles.work });
      observation.refreshed = refreshed;
      observation.displayedAfterReload = { model: await profileModel.inputValue(), effort: await profileEffort.inputValue() };
      checks.push(`Profile override: ${test.field} reload shows effective values without replaying the base write`);
    } catch (error) {
      gaps.push(`Profile ${test.field} verification: ${String(error)}`);
      await capture(`profile-${test.field}-setup-failure`).catch(() => {});
    }
  }
  await page.close();

  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US', serviceWorkers: 'block' });
  await setup(page);
  await page.goto(app.url + '/local/' + id, { waitUntil: 'commit' });
  await checkLocale(page);
  const firstTab = page.getByRole('tab', { name: 'Code example', exact: true });
  await firstTab.and(page.locator('[aria-selected="true"]')).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Second conversation', exact: true }).click();
  await page.getByRole('tab', { name: 'Second conversation', exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
  await page.getByText('No messages yet', { exact: true }).waitFor({ timeout: 60000 });
  await page.locator('.yard-conversation:not([inert])').waitFor();
  await page.keyboard.press('Control+1');
  try {
    await firstTab.and(page.locator('[aria-selected="true"]')).waitFor({ timeout: 3000 });
    checks.push('Ctrl+1 selects the first workspace tab');
  } catch { gaps.push('Ctrl+1 did not select the first workspace tab'); await capture('keyboard-selection-failure').catch(() => {}); }
  await page.keyboard.down('Control');
  try {
    await page.getByText('Ctrl+1', { exact: true }).waitFor({ timeout: 3000 });
    checks.push('Holding Ctrl shows workspace tab shortcut hints');
  } catch { gaps.push('Holding Ctrl did not show workspace tab shortcut hints'); await capture('keyboard-hints-failure').catch(() => {}); }
  finally { await page.keyboard.up('Control'); }
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('turn/start').length, 0);
  assert.deepEqual(gaps, [], 'Original project indicator, model persistence, and tab shortcuts must be present');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    await writeFile(join(output, 'failure.txt'), await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  report.configWrites = fake.calls('config/batchWrite').map(message => message.params);
  report.configTerminals = configTerminals;
  report.fixtureConfig = readFixture();
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
