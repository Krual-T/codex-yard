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
  profileFixture: 'synthetic active override; not a claim of current CLI named-profile support' };
type Values = { model: string | null; model_reasoning_effort: string | null };
type FixtureConfig = { version: number; activeProfile: 'work' | null; base: Values; profiles: { work: Values } };
type ConfigRead = { version: number; activeProfile: FixtureConfig['activeProfile']; effective: Values };
type ConfigTerminal = { status: 'ok' | 'okOverridden'; version: string; filePath: string; overriddenMetadata: { message: string } | null };
type HostAction = { action: unknown; operationId: unknown; hostId: unknown; method: unknown; params: unknown };
const fixturePath = join(root, 'model-config-fixture.json');
const configFile = join(root, 'codex', 'config.toml');
const overrideMessage = 'Fixture profile overrides the base configuration.';
const configReads: ConfigRead[] = [], configTerminals: ConfigTerminal[] = [], hostActions: HostAction[] = [];
const readFixture = (): FixtureConfig => JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureConfig;
const writeFixture = (value: FixtureConfig) => writeFileSync(fixturePath, JSON.stringify(value), { mode: 0o600 });
let rejectNext = false;
const config = record(fake.defaultResult('config/read', {}).config);
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
async function saved(expectedModel: string | null, expectedEffort: string | null) {
  const deadline = Date.now() + 10000;
  while (true) {
    const state = readFixture(), actual = state.activeProfile ? state.profiles.work : state.base;
    if (actual.model === expectedModel && actual.model_reasoning_effort === expectedEffort) return;
    assert.ok(Date.now() < deadline, 'The effective configuration did not reach the expected persisted values');
    await delay(50);
  }
}
async function waitVersion(previous: number) {
  const deadline = Date.now() + 10000;
  while (readFixture().version <= previous) {
    assert.ok(Date.now() < deadline, 'The base configuration write did not commit');
    await delay(50);
  }
}
function observePage(current: Page) {
  current.on('pageerror', error => errors.push(error.message));
  current.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  current.on('websocket', socket => socket.on('framesent', ({ payload }) => {
    const message = record(JSON.parse(String(payload)));
    if (message.type !== 'fetch' || message.url !== 'vscode://codex/configuration-write' || typeof message.body !== 'string') return;
    const body = record(JSON.parse(message.body));
    hostActions.push({ action: body.action, operationId: body.operationId, hostId: body.hostId, method: body.method, params: body.params });
  }));
}
function submittedSince(start: number, expectedParams: unknown): string {
  const submitted = hostActions.slice(start).filter(action => action.action === 'submit');
  assert.equal(submitted.length, 1, 'Exactly one original configuration operation must be submitted');
  const action = submitted[0]!;
  assert.equal(action.hostId, 'local');
  assert.equal(action.method, 'config/batchWrite');
  assert.deepEqual(action.params, expectedParams);
  assert.ok(typeof action.operationId === 'string' && action.operationId.length > 0);
  return action.operationId;
}
function assertNotResubmitted(operationId: string) {
  assert.equal(hostActions.filter(action => action.action === 'submit' && action.operationId === operationId).length, 1,
    'The original operation must not be submitted again');
}
async function readSettingsAtom(): Promise<Record<string, unknown>> {
  const value = await page!.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('atoms', 'readonly').objectStore('atoms').get('native-atoms');
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => {
        const root = request.result as { atoms?: Record<string, unknown> } | undefined;
        db.close(); resolve(root?.atoms?.['codex-yard.settings-config-writes.v1']);
      };
    };
  }));
  return record(value);
}
async function retainedOverride(operationId: string, field: 'model' | 'effort', value: string) {
  const deadline = Date.now() + 10000;
  while (true) {
    const atom = await readSettingsAtom();
    const operations = Array.isArray(atom.operations) ? atom.operations.map(record) : [];
    const drafts = Array.isArray(atom.drafts) ? atom.drafts.map(record) : [];
    const operation = operations.find(item => item.operationId === operationId);
    const origin = record(operation?.origin);
    const draft = drafts.find(item => item.editorId === origin.editorId && item.hostId === 'local' && item.section === 'models');
    const contents = record(draft?.draft), terminal = record(record(operation?.operation).terminal);
    if (operation && draft && operation.phase === 'finished' && terminal.kind === 'okOverridden' && contents[field] === value
      && contents.profile === 'work' && Array.isArray(contents.conflicts) && contents.conflicts.includes(field)) {
      return { operation, draft };
    }
    assert.ok(Date.now() < deadline, 'The original override receipt and conflicting draft were not retained in browser storage');
    await delay(50);
  }
}
async function observedRead(start: number, expected: ConfigRead) {
  const deadline = Date.now() + 10000;
  while (true) {
    const found = configReads.slice(start).find(read => read.version === expected.version && read.activeProfile === expected.activeProfile
      && read.effective.model === expected.effective.model && read.effective.model_reasoning_effort === expected.effective.model_reasoning_effort);
    if (found) return found;
    assert.ok(Date.now() < deadline, 'The expected effective configuration was not read');
    await delay(50);
  }
}
async function verifyOverride(test: { field: 'model' | 'effort'; key: 'model' | 'model_reasoning_effort'; label: string; value: string;
  name?: string; action: () => Promise<unknown> }, checks: Record<string, unknown>[]) {
  const before = readFixture(), writes = fake.calls('config/batchWrite').length, actions = hostActions.length, reads = configReads.length;
  assert.equal(before.activeProfile, 'work');
  const request = { edits: [{ keyPath: test.key, value: test.value, mergeStrategy: 'upsert' }], filePath: null,
    expectedVersion: String(before.version), reloadUserConfig: true };
  await test.action();
  await waitVersion(before.version);
  const after = readFixture();
  assert.equal(fake.calls('config/batchWrite').length, writes + 1);
  assert.deepEqual(fake.calls('config/batchWrite').at(-1)?.params, request);
  const operationId = submittedSince(actions, request);
  assert.equal(after.version, before.version + 1);
  assert.deepEqual(after.base, { ...before.base, [test.key]: test.value });
  assert.equal(after.activeProfile, before.activeProfile);
  assert.deepEqual(after.profiles, before.profiles);
  assert.deepEqual(configTerminals.at(-1), { status: 'okOverridden', version: String(after.version), filePath: configFile,
    overriddenMetadata: { message: overrideMessage } });
  await page!.getByRole('status').filter({ hasText: overrideMessage }).waitFor({ timeout: 10000 });
  await page!.getByRole('alert').filter({ hasText: 'The saved configuration differs from your edit.' }).waitFor({ timeout: 10000 });
  assert.equal(await page!.getByLabel(test.label).inputValue(), test.value, 'The unaccepted edit remains visible');
  const effective = { version: after.version, activeProfile: 'work' as const, effective: before.profiles.work };
  const readback = await observedRead(reads, effective);
  const retained = await retainedOverride(operationId, test.field, test.value);
  await capture(`work-${test.name ?? test.key}-overridden`);

  const reviewReads = configReads.length;
  await page!.getByRole('button', { name: '重新读取默认设置', exact: true }).click();
  const reviewed = await observedRead(reviewReads, effective);
  assert.equal(fake.calls('config/batchWrite').length, writes + 1, 'Reading current defaults must not resend the write');
  assertNotResubmitted(operationId);

  const refreshReads = configReads.length;
  await page!.reload({ waitUntil: 'commit' });
  await selectedDefault('模型', 'Fixture Alpha');
  await selectedDefault('推理强度', 'high');
  await settled('模型'); await settled('推理强度');
  assert.equal(await page!.getByLabel('模型').inputValue(), before.profiles.work.model);
  assert.equal(await page!.getByLabel('推理强度').inputValue(), before.profiles.work.model_reasoning_effort);
  assert.deepEqual(readFixture(), after);
  const refreshed = await observedRead(refreshReads, effective);
  const retainedAfterRefresh = await retainedOverride(operationId, test.field, test.value);
  assert.equal(fake.calls('config/batchWrite').length, writes + 1, 'Refresh must not resend the write');
  assertNotResubmitted(operationId);
  await capture(`work-${test.name ?? test.key}-after-refresh`);
  checks.push({ profile: 'work', action: `${test.name ?? test.key}-base-write-overridden-and-reload`, before, after, request, operationId,
    terminal: configTerminals.at(-1), readback, reviewed, refreshed,
    retained: { operationId: retained.operation.operationId, phase: retained.operation.phase, draft: retained.draft.draft },
    retainedAfterRefresh: { operationId: retainedAfterRefresh.operation.operationId, phase: retainedAfterRefresh.operation.phase,
      draft: retainedAfterRefresh.draft.draft } });
  return operationId;
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
    configReads.push({ version: state.version, activeProfile: state.activeProfile, effective: { ...actual } });
    return { config: { ...config, ...actual, profile: state.activeProfile }, origins: {},
      layers: [{ name: { type: 'user', file: configFile, profile: null }, version: String(state.version) }] };
  });
  fake.handlers.set('model/list', () => ({ data: [
    ['fixture-model', 'Fixture Alpha'], ['fixture-beta', 'Fixture Beta'], ['fixture-hidden', 'Hidden fixture'],
  ].map(([model, displayName], index) => ({ id: model, model, displayName, description: 'Isolated model settings fixture',
    isDefault: index === 0, hidden: index === 2, defaultReasoningEffort: 'high', inputModalities: ['text'],
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low effort' }, { reasoningEffort: 'high', description: 'High effort' }],
  })), nextCursor: null }));
  fake.handlers.set('config/batchWrite', params => {
    const state = readFixture();
    const edits = params.edits as { keyPath: string; value: string; mergeStrategy: string }[];
    assert.equal(params.filePath, null);
    assert.equal(params.expectedVersion, String(state.version));
    assert.ok(Array.isArray(edits) && edits.length > 0 && edits.every(edit => ['model', 'model_reasoning_effort'].includes(edit.keyPath)));
    assert.equal(new Set(edits.map(edit => edit.keyPath)).size, edits.length);
    assert.ok(edits.every(edit => edit.mergeStrategy === 'upsert' && typeof edit.value === 'string'));
    assert.equal(params.reloadUserConfig, true);
    if (rejectNext) { rejectNext = false; throw Object.assign(new Error('Isolated configuration validation failure'), { code: -32600 }); }
    let overridden = false;
    for (const edit of edits) {
      const field = edit.keyPath === 'model_reasoning_effort' ? 'model_reasoning_effort' : 'model';
      state.base[field] = edit.value;
      overridden ||= state.activeProfile !== null;
    }
    state.version++;
    writeFixture(state);
    const terminal: ConfigTerminal = { status: overridden ? 'okOverridden' : 'ok', version: String(state.version), filePath: configFile,
      overriddenMetadata: overridden ? { message: overrideMessage } : null };
    configTerminals.push(terminal);
    return terminal;
  });
  const dataDir = join(root, 'data');
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for model fixture', { status: 503 }) });
  const appOrigin = app.url;
  assert.notEqual(new URL(appOrigin).port, '8765');
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
    observePage(page);
    await page.route('**/*', route => new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort());
    let phase = 'initial controls';
    try {
      await page.goto(app.url, { waitUntil: 'commit' });
      await page.locator('[data-owned-renderer="true"]').waitFor();
      await selectedDefault('模型', 'Fixture Alpha');
      assert.equal(await page.getByLabel('模型').locator('option[value="fixture-model"]').isDisabled(), false);
      assert.equal(await page.getByLabel('模型').locator('option[value="fixture-beta"]').isDisabled(), false);
      assert.equal(await page.getByLabel('模型').locator('option[value="fixture-hidden"]').count(), 0);
      await capture(label + '-before');
      if (profile) {
        for (const test of [
          { field: 'effort' as const, key: 'model_reasoning_effort' as const, label: '推理强度', value: 'low' },
          { field: 'model' as const, key: 'model' as const, label: '模型', value: 'fixture-beta' },
        ]) {
          phase = `override ${test.key}`;
          await verifyOverride({ ...test, action: () => page!.getByLabel(test.label).selectOption(test.value) }, checks);
        }
        phase = 'override rejection';
        rejectNext = true;
        const beforeReject = readFixture(), writesBeforeReject = fake.calls('config/batchWrite').length, actionsBeforeReject = hostActions.length;
        const rejectedRequest = { edits: [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }], filePath: null,
          expectedVersion: String(beforeReject.version), reloadUserConfig: true };
        await page.getByLabel('推理强度').selectOption('low');
        await page.getByRole('alert').filter({ hasText: /configuration write was rejected.*edit is preserved/i }).waitFor();
        assert.deepEqual(readFixture(), beforeReject, 'Rejected configuration must keep its previous value and version');
        assert.equal(fake.calls('config/batchWrite').length, writesBeforeReject + 1);
        assert.deepEqual(fake.calls('config/batchWrite').at(-1)?.params, rejectedRequest);
        const rejectedId = submittedSince(actionsBeforeReject, rejectedRequest);
        assert.equal(await page.getByLabel('推理强度').inputValue(), 'low');
        await capture('work-rejected');
        const reviewReads = configReads.length;
        await page.getByRole('button', { name: '重新读取默认设置', exact: true }).click();
        await observedRead(reviewReads, { version: beforeReject.version, activeProfile: 'work', effective: beforeReject.profiles.work });
        assert.equal(fake.calls('config/batchWrite').length, writesBeforeReject + 1, 'Reading defaults must not resend the rejected operation');
        assertNotResubmitted(rejectedId);
        phase = 'override explicit retry';
        const retryId = await verifyOverride({ field: 'effort', key: 'model_reasoning_effort', label: '推理强度', value: 'low',
          name: 'rejected-retry', action: () => page!.getByRole('button', { name: '保存默认设置', exact: true }).click() }, checks);
        assert.notEqual(retryId, rejectedId, 'An explicit retry must use a new operation ID');
        assertNotResubmitted(rejectedId); assertNotResubmitted(retryId);
        checks.push({ profile, action: 'rejected-write-preserved-and-explicit-retry', beforeReject, rejectedRequest, rejectedId, retryId });
        continue;
      }
      phase = 'save effort';
      const effortBefore = readFixture(), effortActions = hostActions.length;
      await page.getByLabel('推理强度').selectOption('low');
      await saved('fixture-model', 'low');
      await settled('推理强度');
      assertWriteReadBack();
      const effortId = submittedSince(effortActions, { edits: [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }],
        filePath: null, expectedVersion: String(effortBefore.version), reloadUserConfig: true });
      phase = 'reload effort';
      let writesBeforeReload = fake.calls('config/batchWrite').length;
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Alpha');
      await selectedDefault('推理强度', 'low');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReload, 'Reload must not replay the effort write');
      assertNotResubmitted(effortId);
      checks.push({ profile, action: 'effort-write-and-reload', state: readFixture() });
      await capture(label + '-effort-after-refresh');
      phase = 'save model';
      await capture(label + '-model-menu');
      const modelBefore = readFixture(), modelActions = hostActions.length;
      await page.getByLabel('模型').selectOption('fixture-beta');
      await saved('fixture-beta', 'low');
      await settled('模型');
      assertWriteReadBack();
      const modelId = submittedSince(modelActions, { edits: [{ keyPath: 'model', value: 'fixture-beta', mergeStrategy: 'upsert' }],
        filePath: null, expectedVersion: String(modelBefore.version), reloadUserConfig: true });
      phase = 'reload model';
      writesBeforeReload = fake.calls('config/batchWrite').length;
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Beta');
      await selectedDefault('推理强度', 'low');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReload, 'Reload must not replay the model write');
      assertNotResubmitted(modelId);
      checks.push({ profile, action: 'model-write-and-reload', state: readFixture() });
      await capture(label + '-model-after-refresh');
      phase = 'rejection';
      rejectNext = true;
      const beforeReject = readFixture(), writesBeforeReject = fake.calls('config/batchWrite').length, actionsBeforeReject = hostActions.length;
      await page.getByLabel('推理强度').selectOption('high');
      await page.getByRole('alert').filter({ hasText: /configuration write was rejected.*edit is preserved/i }).waitFor();
      assert.deepEqual(readFixture(), beforeReject, 'Rejected configuration must keep its previous value and version');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReject + 1);
      const rejectedRequest = { edits: [{ keyPath: 'model_reasoning_effort', value: 'high', mergeStrategy: 'upsert' }], filePath: null,
        expectedVersion: String(beforeReject.version), reloadUserConfig: true };
      const rejectedId = submittedSince(actionsBeforeReject, rejectedRequest);
      checks.push({ profile, action: 'rejected-write-preserved', state: readFixture() });
      await capture(label + '-rejected');
      phase = 'retry';
      await page.getByRole('button', { name: '重新读取默认设置', exact: true }).click();
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReject + 1, 'Reload must not resend the rejected edit');
      assertNotResubmitted(rejectedId);
      const retryActions = hostActions.length;
      await page.getByRole('button', { name: '保存默认设置', exact: true }).click();
      await saved('fixture-beta', 'high');
      await settled('推理强度');
      assertWriteReadBack();
      const retryId = submittedSince(retryActions, rejectedRequest);
      assert.notEqual(retryId, rejectedId, 'An explicit retry must use a new operation ID');
      phase = 'reload retry';
      writesBeforeReload = fake.calls('config/batchWrite').length;
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Beta');
      await selectedDefault('推理强度', 'high');
      assert.equal(fake.calls('config/batchWrite').length, writesBeforeReload, 'Reload must not replay the explicit retry');
      assertNotResubmitted(rejectedId); assertNotResubmitted(retryId);
      await capture(label + '-retry-after-refresh');
      checks.push({ profile, ...readFixture(), modelAndEffortSaved: true, refreshed: true, rejectionAndRetry: true,
        operationIds: { effortId, modelId, rejectedId, retryId } });
    } catch (error) {
      gaps.push(`${label}: ${phase}: ${String(error)}`);
      await capture(label + '-failure').catch(() => {});
    } finally { scopes.push({ profile, phase, state: readFixture() }); rejectNext = false; await page.close(); }
  }
  writeFixture({ version: 1, activeProfile: null, base: { model: null, model_reasoning_effort: null },
    profiles: { work: { model: 'fixture-model', model_reasoning_effort: 'high' } } });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  observePage(page);
  await page.route('**/*', route => new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort());
  try {
    await page.goto(app.url, { waitUntil: 'commit' });
    await page.locator('[data-owned-renderer="true"]').waitFor();
    await selectedDefault('模型', 'Fixture Alpha');
    await settled('模型'); await settled('推理强度');
    assert.equal(await page.getByLabel('推理强度').inputValue(), '');
    assert.deepEqual(readFixture().base, { model: null, model_reasoning_effort: null });
    const before = readFixture(), writes = fake.calls('config/batchWrite').length, actions = hostActions.length;
    await page.getByLabel('推理强度').selectOption('low');
    await saved(null, 'low'); await settled('推理强度');
    const request = { edits: [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }], filePath: null,
      expectedVersion: String(before.version), reloadUserConfig: true };
    assert.deepEqual(fake.calls('config/batchWrite').at(-1)?.params, request);
    const operationId = submittedSince(actions, request);
    assert.equal(readFixture().version, before.version + 1);
    assertWriteReadBack();
    await page.reload({ waitUntil: 'commit' });
    await selectedDefault('模型', 'Fixture Alpha'); await selectedDefault('推理强度', 'low');
    assert.deepEqual(readFixture().base, { model: null, model_reasoning_effort: 'low' });
    assert.equal(fake.calls('config/batchWrite').length, writes + 1);
    assertNotResubmitted(operationId);
    await capture('null-default-after-refresh');
    checks.push({ profile: null, action: 'null-model-and-effort-baseline', before, after: readFixture(), request, operationId });
  } catch (error) {
    gaps.push(`null default: ${String(error)}`);
    await capture('null-default-failure').catch(() => {});
  } finally { await page.close(); }
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('turn/start').length, 0);
  const submittedIds = hostActions.filter(action => action.action === 'submit').map(action => action.operationId);
  assert.equal(new Set(submittedIds).size, submittedIds.length, 'Original configuration operation IDs must not be reused');
  assert.deepEqual(gaps, [], 'Model configuration persistence and retry must pass for both scopes');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  report.requests = fake.messages.filter(message => message.method === 'config/batchWrite');
  report.configReads = configReads;
  report.configTerminals = configTerminals;
  report.hostActions = hostActions;
  await browser?.close(); await app?.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, output }));
}
