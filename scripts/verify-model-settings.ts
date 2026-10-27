// Run the complete isolated browser/service lifecycle under the project heavy lock.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/aw-model-ui-');
const output = resolve(process.env.AGENTS_MODEL_EVIDENCE ?? '.local/model-settings-verification');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { renderer: '26.1013.40934', realDaemonUsed: false, errors };
let model = 'fixture-model', effort = 'high', profile: string | null = null, rejectNext = false;
const config = record(fake.defaultResult('config/read', {}).config);
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
}
async function saved(expectedModel: string, expectedEffort: string) {
  const deadline = Date.now() + 10000;
  while (model !== expectedModel || effort !== expectedEffort) {
    assert.ok(Date.now() < deadline, 'The official config batch did not reach the fixture');
    await delay(50);
  }
}
async function openPicker(name: string) {
  await page!.getByRole('button', { name: new RegExp(name) }).click();
  await page!.getByRole('menuitem', { name: /^(强度|Power)$/ }).waitFor();
}
try {
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
  fake.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('config/read', () => ({ config: { ...config, model, model_reasoning_effort: effort, profile }, origins: {}, layers: null }));
  fake.handlers.set('model/list', () => ({ data: [
    ['fixture-model', 'Fixture Alpha'], ['fixture-beta', 'Fixture Beta'],
  ].map(([model, displayName], index) => ({ id: model, model, displayName, description: 'Isolated model settings fixture',
    isDefault: index === 0, hidden: false, defaultReasoningEffort: 'high', inputModalities: ['text'],
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low effort' }, { reasoningEffort: 'high', description: 'High effort' }],
  })), nextCursor: null }));
  fake.handlers.set('config/batchWrite', params => {
    if (rejectNext) { rejectNext = false; throw Object.assign(new Error('Isolated configuration validation failure'), { code: -32600 }); }
    const prefix = profile ? `profiles.${profile}.` : '';
    const edits = params.edits as { keyPath: string; value: string; mergeStrategy: string }[];
    assert.deepEqual(edits.map(edit => edit.keyPath), [prefix + 'model', prefix + 'model_reasoning_effort']);
    assert.ok(edits.every(edit => edit.mergeStrategy === 'upsert'));
    assert.equal(params.reloadUserConfig, true);
    model = edits[0].value; effort = edits[1].value;
    return { status: 'ok', version: String(fake.calls('config/batchWrite').length), filePath: join(root, 'codex/config.toml'), overriddenMetadata: null };
  });
  const dataDir = join(root, 'data');
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for model fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const checks: Record<string, unknown>[] = [];
  report.checks = checks;
  for (const scope of [null, 'work']) {
    profile = scope; model = 'fixture-model'; effort = 'high';
    const label = profile ?? 'default';
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.url, { waitUntil: 'commit' });
    await page.getByRole('button', { name: /Fixture Alpha/ }).waitFor({ timeout: 60000 });
    await capture(label + '-before');
    await openPicker('Fixture Alpha');
    await page.getByRole('menuitem', { name: /^(强度|Power)$/ }).press('ArrowLeft');
    await saved('fixture-model', 'low');
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('button', { name: /Fixture Alpha.*(?:轻度|低|Low|Light)/ }).waitFor({ timeout: 60000 });
    await capture(label + '-effort-after-refresh');
    await openPicker('Fixture Alpha');
    await page.getByRole('menuitem', { name: /^(选择模型|Select model)$/ }).click();
    await capture(label + '-model-menu');
    await page.getByRole('menuitemradio', { name: 'Fixture Beta', exact: true }).click({ timeout: 10000 });
    await saved('fixture-beta', 'low');
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('button', { name: /Fixture Beta.*(?:轻度|低|Low|Light)/ }).waitFor({ timeout: 60000 });
    await capture(label + '-model-after-refresh');
    rejectNext = true;
    await openPicker('Fixture Beta');
    await page.getByRole('menuitem', { name: /^(强度|Power)$/ }).press('ArrowRight');
    await page.getByText(/Isolated configuration validation failure/).last().waitFor();
    assert.equal(effort, 'low', 'Rejected configuration must keep its previous value');
    await capture(label + '-rejected');
    await page.keyboard.press('Escape');
    await openPicker('Fixture Beta');
    await page.getByRole('menuitem', { name: /^(强度|Power)$/ }).press('ArrowRight');
    await saved('fixture-beta', 'high');
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('button', { name: /Fixture Beta.*(?:深度|高|High|Extended)/ }).waitFor({ timeout: 60000 });
    await capture(label + '-retry-after-refresh');
    checks.push({ profile, model, effort, modelAndEffortSaved: true, refreshed: true, rejectionAndRetry: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.equal(fake.calls('turn/start').length, 0);
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
