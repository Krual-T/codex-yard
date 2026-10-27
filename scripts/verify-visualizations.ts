// Run under /tmp/agents-workbench-heavy.lock. No real model turn is submitted.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';

const root = await mkdtemp('/tmp/aw-viz-');
const output = resolve(process.env.AGENTS_VISUALIZATION_EVIDENCE ?? '.local/visualization-verification');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [], consoleErrors: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { realDaemonUsed: false, checks, errors, consoleErrors };
async function capture(name: string) {
  if (!page || page.isClosed()) return;
  await writeFile(join(output, name + '.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, name + '.png') });
  report.frames = page.frames().map(frame => frame.url());
  report.frameDetails = await Promise.all(page.frames().map(async frame => ({ url: frame.url(),
    dom: await frame.evaluate(() => ({ html: document.documentElement.outerHTML.slice(0,4000), ready: document.readyState })).catch(String) })));
}
try {
  const threadId = '00000000-0000-4000-8000-000000000176';
  const path = join(root, 'interactive.html');
  await writeFile(path, `<div id="verification-visualization" class="card">
<h2>交互可视化验收</h2><label for="amount">数量</label>
<input id="amount" type="range" min="1" max="10" value="2"><output id="total">20</output>
<button id="increase" class="btn">增加</button><button id="follow-up" class="btn">继续分析</button>
</div><script>
const root=document.getElementById('verification-visualization');
const amount=root.querySelector('#amount'),total=root.querySelector('#total');
function restore(){amount.value=window.openai.widgetState?.modelContent?.amount??2;total.textContent=String(Number(amount.value)*10)}
function update(){total.textContent=String(Number(amount.value)*10);window.openai.setWidgetState({modelContent:{amount:Number(amount.value)}}).catch(()=>{})}
restore();window.addEventListener('openai:set_globals',restore);
amount.addEventListener('input',update);
root.querySelector('#increase').addEventListener('click',()=>{amount.value=Number(amount.value)+1;update()});
root.querySelector('#follow-up').addEventListener('click',()=>window.openai.sendFollowUpMessage({prompt:'分析当前数量 '+amount.value,title:'继续分析'}));
</script>`);
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.handlers.set('fs/getMetadata', params => fileDaemonFixture()('fs/getMetadata', params));
  fake.threads.set(threadId, fixtureThread(threadId, root, { name: '交互可视化验收',
    turns: [fixtureTurn('visualization-turn', [agentItem('visualization-answer', '可视化开始\n\nvisualize' + JSON.stringify({ path, mode: 'wide' }) + '\n\n可视化结束')])] }));
  const dataDir = join(root, 'data');
  if (process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT) await cp(process.env.AGENTS_TEST_CONFIGURATION_SNAPSHOT, join(dataDir, 'configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0,1500)); });
  page.on('requestfailed', request => consoleErrors.push(request.url() + ': ' + request.failure()?.errorText));
  page.on('response', response => { if (response.status() >= 400) consoleErrors.push(response.status() + ' ' + response.url()); });
  await page.addLocatorHandler(page.getByRole('button', { name: '继续使用当前模型', exact: true }), async button => { await button.click(); });
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText('可视化结束', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('[data-visualization-thread-frame] iframe:not(.invisible)') != null, undefined, { timeout: 30000 });
  const frame = page.frameLocator('[data-visualization-thread-frame] iframe');
  await frame.getByRole('heading', { name: '交互可视化验收' }).waitFor({ timeout: 60000 });
  await capture('01-rendered');
  checks.push('A normal visualize reference renders in the original chat component');
  await frame.getByRole('button', { name: '增加', exact: true }).click();
  await frame.locator('#total').filter({ hasText: '30' }).waitFor();
  checks.push('The button executes inside the sandbox');
  await frame.getByRole('slider', { name: '数量' }).fill('7');
  await frame.locator('#total').filter({ hasText: '70' }).waitFor();
  checks.push('The range input updates the visual');
  const frameElement = page.locator('[data-visualization-thread-frame] iframe');
  assert.equal(await frameElement.getAttribute('sandbox'), 'allow-scripts');
  const inner = await (await frameElement.elementHandle())?.contentFrame();
  assert.ok(inner);
  assert.equal(await inner.evaluate(() => { try { void top!.document.body; return false; } catch { return true; } }), true);
  checks.push('The visualization cannot access the Workbench document');
  assert.equal(await inner.evaluate(async () => { try { await fetch(location.origin + '/api/status'); return false; } catch { return true; } }), true);
  checks.push('The sandbox CSP blocks requests to Workbench APIs');
  await page.reload({ waitUntil: 'commit' });
  await frame.locator('#total').filter({ hasText: '70' }).waitFor({ timeout: 60000 });
  checks.push('Refresh restores interaction state through the official renderer');
  await frame.getByRole('heading', { name: '交互可视化验收' }).hover();
  await page.getByRole('button', { name: '展开可视化预览', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await capture('02-expanded');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await frame.locator('#total').filter({ hasText: '70' }).waitFor();
  checks.push('The original wide preview expands and closes without losing state');
  await frame.getByRole('button', { name: '继续分析', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(fake.calls('turn/start').length, 0);
  await capture('02-follow-up-confirmation');
  await page.keyboard.press('Escape');
  checks.push('Follow-up actions require the original confirmation dialog');
  await page.setViewportSize({ width: 402, height: 874 });
  await capture('03-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('402px layout has no horizontal overflow');
  await rm(path);
  await page.reload({ waitUntil: 'commit' });
  await page.getByText('可视化内部发生错误', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText('可视化结束', { exact: true }).waitFor();
  await capture('04-missing-file');
  checks.push('An unavailable source displays the original error and keeps the chat readable');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await app?.close(); await fake.close();
  await rm(root, { recursive: true, force: true });
  console.log('Visualization evidence:', output);
}
