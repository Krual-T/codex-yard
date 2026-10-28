// Run the complete isolated browser/service lifecycle under the project heavy lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { record } from '../src/native/protocol.ts';
import { createFakeCodex } from '../test/fake-codex.ts';

const root = await mkdtemp('/tmp/aw-model-ui-');
const output = process.env.AGENTS_MODEL_EVIDENCE
  ? resolve(process.env.AGENTS_MODEL_EVIDENCE) : await mkdtemp('/tmp/yard-model-evidence-');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { renderer: 'owned', realDaemonUsed: false, errors };
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
    assert.ok(Date.now() < deadline, 'The configuration write did not reach the synthetic peer');
    await delay(50);
  }
}
async function selectedDefault(label: string, value: string) {
  await page!.waitForFunction(({ label, value }) => {
    const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    return select?.selectedOptions[0]?.textContent?.includes(value) === true;
  }, { label, value }, { timeout: 10000 });
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
    assert.ok(edits.length > 0 && edits.every(edit => [prefix + 'model', prefix + 'model_reasoning_effort'].includes(edit.keyPath)));
    assert.equal(new Set(edits.map(edit => edit.keyPath)).size, edits.length);
    assert.ok(edits.every(edit => edit.mergeStrategy === 'upsert'));
    assert.equal(params.reloadUserConfig, true);
    for (const edit of edits) {
      if (edit.keyPath === prefix + 'model') model = edit.value;
      if (edit.keyPath === prefix + 'model_reasoning_effort') effort = edit.value;
    }
    return { status: 'ok', version: String(fake.calls('config/batchWrite').length), filePath: join(root, 'codex/config.toml'), overriddenMetadata: null };
  });
  const dataDir = join(root, 'data');
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for model fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'] });
  const checks: Record<string, unknown>[] = [];
  const gaps: string[] = [];
  report.checks = checks;
  report.gaps = gaps;
  for (const scope of [null, 'work']) {
    profile = scope; model = 'fixture-model'; effort = 'high';
    const label = profile ?? 'default';
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
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
      phase = 'reload effort';
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Alpha');
      await selectedDefault('推理强度', 'low');
      await capture(label + '-effort-after-refresh');
      phase = 'save model';
      await capture(label + '-model-menu');
      await page.getByLabel('模型').selectOption('fixture-beta');
      await saved('fixture-beta', 'low');
      phase = 'reload model';
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Beta');
      await selectedDefault('推理强度', 'low');
      await capture(label + '-model-after-refresh');
      phase = 'rejection';
      rejectNext = true;
      await page.getByLabel('推理强度').selectOption('high');
      await page.getByText(/Isolated configuration validation failure/).last().waitFor();
      assert.equal(effort, 'low', 'Rejected configuration must keep its previous value');
      await capture(label + '-rejected');
      phase = 'retry';
      await page.getByLabel('推理强度').selectOption('high');
      await saved('fixture-beta', 'high');
      phase = 'reload retry';
      await page.reload({ waitUntil: 'commit' });
      await selectedDefault('模型', 'Fixture Beta');
      await selectedDefault('推理强度', 'high');
      await capture(label + '-retry-after-refresh');
      checks.push({ profile, model, effort, modelAndEffortSaved: true, refreshed: true, rejectionAndRetry: true });
    } catch (error) {
      gaps.push(`${label}: ${phase}: ${String(error)}`);
      await capture(label + '-failure').catch(() => {});
    } finally { rejectNext = false; await page.close(); }
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
