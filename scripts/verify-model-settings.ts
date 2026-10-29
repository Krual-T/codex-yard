// Run the complete isolated browser/service lifecycle under the project heavy lock.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex } from '../test/fake-codex.ts';
import { isolatePublicVerifier } from './public-verifier-environment.ts';

const root = await mkdtemp(join(tmpdir(), 'aw-model-ui-'));
const output = process.env.AGENTS_MODEL_EVIDENCE
  ? resolve(process.env.AGENTS_MODEL_EVIDENCE) : await mkdtemp(join(tmpdir(), 'yard-model-evidence-'));
await isolatePublicVerifier(root);
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { renderer: 'owned', realDaemonUsed: false, errors,
  profileFixture: 'synthetic legacy override; not a claim that the current CLI supports profile writes' };
type Values = { model: string; model_reasoning_effort: string };
type FixtureConfig = { version: number; activeProfile: 'work' | null; base: Values; profiles: { work: Values } };
const fixturePath = join(root, 'model-config-fixture.json');
const configFile = join(root, 'codex', 'config.toml');
const readFixture = (): FixtureConfig => JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureConfig;
const writeFixture = (value: FixtureConfig) => writeFileSync(fixturePath, JSON.stringify(value), { mode: 0o600 });
let rejectNext = false;
const config = record(fake.defaultResult('config/read', {}).config);
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
async function saved(expectedModel: string, expectedEffort: string) {
  const deadline = Date.now() + 10000;
  while (true) {
    const state = readFixture(), actual = state.activeProfile ? state.profiles.work : state.base;
    if (actual.model === expectedModel && actual.model_reasoning_effort === expectedEffort) return;
    assert.ok(Date.now() < deadline, 'The effective configuration did not reach the expected persisted values');
    await delay(50);
  }
}
async function selectedDefault(label: string, value: string) {
  await page!.waitForFunction(({ label, value }) => {
    const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    return select?.selectedOptions[0]?.textContent?.includes(value) === true;
  }, { label, value }, { timeout: 10000 });
}
async function settled(label: string) {
  await page!.waitForFunction(label => {
    const control = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    return control !== null && !control.disabled;
  }, label, { timeout: 10000 });
}
function assertWriteReadBack() {
  const lastWrite = fake.calls('config/batchWrite').at(-1);
  assert.ok(lastWrite);
  assert.ok(fake.messages.slice(fake.messages.lastIndexOf(lastWrite) + 1).some(message => message.method === 'config/read'),
    'A confirmed write must be followed by a configuration read');
}
try {
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)', codexHome: join(root, 'codex') }));
  fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
  fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('config/read', () => {
    const state = readFixture(), actual = state.activeProfile ? state.profiles.work : state.base;
    return { config: { ...config, ...actual, profile: state.activeProfile }, origins: {},
      layers: [{ name: { type: 'user', file: configFile, profile: null }, version: String(state.version) }] };
  });
  fake.handlers.set('model/list', () => ({ data: [
    ['fixture-model', 'Fixture Alpha'], ['fixture-beta', 'Fixture Beta'],
  ].map(([model, displayName], index) => ({ id: model, model, displayName, description: 'Isolated model settings fixture',
    isDefault: index === 0, hidden: false, defaultReasoningEffort: 'high', inputModalities: ['text'],
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low effort' }, { reasoningEffort: 'high', description: 'High effort' }],
  })), nextCursor: null }));
  fake.handlers.set('config/batchWrite', params => {
    if (rejectNext) { rejectNext = false; throw Object.assign(new Error('Isolated configuration validation failure'), { code: -32600 }); }
    const state = readFixture();
    const edits = params.edits as { keyPath: string; value: string; mergeStrategy: string }[];
    assert.equal(params.filePath, null);
    assert.equal(params.expectedVersion, String(state.version));
    assert.ok(edits.length > 0 && edits.every(edit => ['model', 'model_reasoning_effort', 'profiles.work.model',
      'profiles.work.model_reasoning_effort'].includes(edit.keyPath)));
    assert.equal(new Set(edits.map(edit => edit.keyPath)).size, edits.length);
    assert.ok(edits.every(edit => edit.mergeStrategy === 'upsert'));
    assert.equal(params.reloadUserConfig, true);
    let overridden = false;
    for (const edit of edits) {
      const field = edit.keyPath.endsWith('model_reasoning_effort') ? 'model_reasoning_effort' : 'model';
      if (edit.keyPath.startsWith('profiles.work.')) state.profiles.work[field] = edit.value;
      else { state.base[field] = edit.value; overridden ||= state.activeProfile !== null; }
    }
    state.version++;
    writeFixture(state);
    return { status: overridden ? 'okOverridden' : 'ok', version: String(state.version), filePath: configFile,
      overriddenMetadata: overridden ? { message: 'Fixture profile overrides the base configuration.' } : null };
  });
  const dataDir = join(root, 'data');
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for model fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  const checks: Record<string, unknown>[] = [];
  const gaps: string[] = [];
  const scopes: Record<string, unknown>[] = [];
  report.checks = checks;
  report.gaps = gaps;
  report.scopes = scopes;
  for (const scope of [null, 'work']) {
    const profile = scope as 'work' | null;
    writeFixture({ version: 1, activeProfile: profile, base: { model: 'fixture-model', model_reasoning_effort: 'high' },
      profiles: { work: { model: 'fixture-model', model_reasoning_effort: 'high' } } });
    const label = profile ?? 'default';
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    let phase = 'initial controls';
    try {
      await page.goto(app.url, { waitUntil: 'commit' });
      await page.locator('[data-owned-renderer="true"]').waitFor();
      await selectedDefault('模型', 'Fixture Alpha');
      await capture(label + '-before');
      phase = 'save effort';
      await page.getByLabel('推理强度').selectOption('low');
      await saved('fixture-model', 'low');
      await settled('推理强度');
      assertWriteReadBack();
      phase = 'reload effort';
      let writesBeforeReload = fake.calls('config/batchWrite').length;
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Alpha');
      await selectedDefault('推理强度', 'low');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReload, 'Reload must not replay the effort write');
      checks.push({ profile, action: 'effort-write-and-reload', state: readFixture() });
      await capture(label + '-effort-after-refresh');
      phase = 'save model';
      await capture(label + '-model-menu');
      await page.getByLabel('模型').selectOption('fixture-beta');
      await saved('fixture-beta', 'low');
      await settled('模型');
      assertWriteReadBack();
      phase = 'reload model';
      writesBeforeReload = fake.calls('config/batchWrite').length;
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Beta');
      await selectedDefault('推理强度', 'low');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReload, 'Reload must not replay the model write');
      checks.push({ profile, action: 'model-write-and-reload', state: readFixture() });
      await capture(label + '-model-after-refresh');
      phase = 'rejection';
      rejectNext = true;
      const beforeReject = readFixture(), writesBeforeReject = fake.calls('config/batchWrite').length;
      await page.getByLabel('推理强度').selectOption('high');
      await page.getByRole('alert').filter({ hasText: /configuration write was rejected.*edit is preserved/i }).waitFor();
      assert.deepEqual(readFixture(), beforeReject, 'Rejected configuration must keep its previous value and version');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReject + 1);
      checks.push({ profile, action: 'rejected-write-preserved', state: readFixture() });
      await capture(label + '-rejected');
      phase = 'retry';
      await page.getByRole('button', { name: '重新读取默认设置', exact: true }).click();
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReject + 1, 'Reload must not resend the rejected edit');
      await page.getByRole('button', { name: '保存默认设置', exact: true }).click();
      await saved('fixture-beta', 'high');
      await settled('推理强度');
      assertWriteReadBack();
      phase = 'reload retry';
      writesBeforeReload = fake.calls('config/batchWrite').length;
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Beta');
      await selectedDefault('推理强度', 'high');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReload, 'Reload must not replay the explicit retry');
      await capture(label + '-retry-after-refresh');
      checks.push({ profile, ...readFixture(), modelAndEffortSaved: true, refreshed: true, rejectionAndRetry: true });
    } catch (error) {
      gaps.push(`${label}: ${phase}: ${String(error)}`);
      await capture(label + '-failure').catch(() => {});
    } finally { scopes.push({ profile, phase, state: readFixture() }); rejectNext = false; await page.close(); }
  }
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('turn/start').length, 0);
  assert.deepEqual(gaps, [], 'Model configuration persistence and retry must pass for both scopes');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  report.requests = fake.messages.filter(message => message.method === 'config/batchWrite');
  await browser?.close(); await app?.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, output }));
}
