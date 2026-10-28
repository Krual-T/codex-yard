// Run under /tmp/agents-workbench-heavy.lock. No real model turn is submitted.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';

const root = await mkdtemp('/tmp/aw-viz-');
const output = process.env.AGENTS_VISUALIZATION_EVIDENCE
  ? resolve(process.env.AGENTS_VISUALIZATION_EVIDENCE) : await mkdtemp('/tmp/yard-viz-evidence-');
await mkdir(output, { recursive: true });
const fake = await createFakeCodex(root);
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [], consoleErrors: string[] = [], checks: string[] = [], gaps: string[] = [];
const report: Record<string, unknown> = { renderer: 'owned', realDaemonUsed: false, checks, gaps, errors, consoleErrors };
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
<button id="increase" class="btn">增加</button><button id="follow-up" class="btn">继续分析</button><output id="saved"></output>
</div><script>
const root=document.getElementById('verification-visualization');
const amount=root.querySelector('#amount'),total=root.querySelector('#total');
function restore(){amount.value=window.openai.widgetState?.modelContent?.amount??2;total.textContent=String(Number(amount.value)*10)}
function update(){total.textContent=String(Number(amount.value)*10);document.getElementById('saved').textContent='';window.openai.setWidgetState({modelContent:{amount:Number(amount.value)}}).then(()=>document.getElementById('saved').textContent='已保存')}
restore();window.addEventListener('openai:set_globals',restore);
amount.addEventListener('input',update);
root.querySelector('#increase').addEventListener('click',()=>{amount.value=Number(amount.value)+1;update()});
root.querySelector('#follow-up').addEventListener('click',()=>window.openai.sendFollowUpMessage({prompt:'分析当前数量 '+amount.value,title:'继续分析',context:{amount:Number(amount.value)}}).catch(()=>{}));
</script>`);
  fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.163.0 (Linux)' }));
  fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
  fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
  fake.handlers.set('fs/getMetadata', params => fileDaemonFixture()('fs/getMetadata', params));
  fake.threads.set(threadId, fixtureThread(threadId, root, { name: '交互可视化验收',
    turns: [fixtureTurn('visualization-turn', [agentItem('visualization-answer', '可视化开始\n\nvisualize' + JSON.stringify({ path, title: '交互可视化验收', mode: 'wide' }) + '\n\n可视化结束')])] }));
  const dataDir = join(root, 'data');
  app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} },
    httpFetch: async () => new Response('External telemetry disabled for fixture', { status: 503 }) });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0,1500)); });
  page.on('requestfailed', request => consoleErrors.push(request.url() + ': ' + request.failure()?.errorText));
  page.on('response', response => { if (response.status() >= 400) consoleErrors.push(response.status() + ' ' + response.url()); });
  await page.goto(app.url + '/local/' + threadId, { waitUntil: 'commit' });
  await page.locator('[data-owned-renderer="true"]').waitFor();
  await page.getByText('可视化结束', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('article').getByRole('button', { name: '交互可视化验收', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Visualization content"]');
  await frame.getByRole('heading', { name: '交互可视化验收' }).waitFor({ timeout: 60000 });
  await capture('01-rendered');
  checks.push('A chat visualization directive opens the owned preview');
  await frame.getByRole('button', { name: '增加', exact: true }).click();
  await frame.locator('#total').filter({ hasText: '30' }).waitFor();
  await frame.locator('#saved').filter({ hasText: '已保存' }).waitFor();
  checks.push('The button executes inside the sandbox');
  await frame.getByRole('slider', { name: '数量' }).fill('7');
  await frame.locator('#total').filter({ hasText: '70' }).waitFor();
  await frame.locator('#saved').filter({ hasText: '已保存' }).waitFor();
  checks.push('The range input updates the visual');
  const frameElement = page.locator('iframe[title="Visualization content"]');
  assert.equal(await frameElement.getAttribute('sandbox'), 'allow-scripts');
  const inner = await (await frameElement.elementHandle())?.contentFrame();
  assert.ok(inner);
  assert.equal(await inner.evaluate(() => { try { void top!.document.body; return false; } catch { return true; } }), true);
  checks.push('The visualization cannot access the Workbench document');
  const violation = await inner.evaluate(url => new Promise<string>(resolve => {
    const timeout = setTimeout(() => resolve('no CSP violation'), 3000);
    document.addEventListener('securitypolicyviolation', event => { clearTimeout(timeout); resolve(event.violatedDirective); }, { once: true });
    void fetch(url).catch(() => {});
  }), app.url + '/api/status');
  assert.match(violation, /^connect-src/);
  checks.push('The opaque sandbox cannot access its parent and CSP blocks the actual host API URL');
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('article').getByRole('button', { name: '交互可视化验收', exact: true }).click();
  await frame.locator('#total').filter({ hasText: '70' }).waitFor({ timeout: 60000 });
  checks.push('Refresh restores interaction state through the owned renderer');
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  await page.getByRole('button', { name: 'Exit expanded view', exact: true }).waitFor();
  await capture('02-expanded');
  await frame.getByRole('button', { name: '增加', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expand', exact: true }).waitFor();
  await frame.locator('#total').filter({ hasText: '70' }).waitFor();
  checks.push('Expanded preview closes with Escape without losing state');
  const editor = page.getByRole('textbox', { name: /^(Work with Codex|和 Codex 一起工作)$/ });
  await editor.fill('未发送的原草稿');
  await frame.getByRole('button', { name: '继续分析', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') !== null
    || [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label]')]
      .some(textarea => ['Work with Codex', '和 Codex 一起工作'].includes(textarea.getAttribute('aria-label') ?? '')
        && textarea.value.includes('分析当前数量 7')));
  assert.equal(fake.calls('turn/start').length, 0);
  await capture('02-follow-up-confirmation');
  if (await page.getByRole('dialog').count()) {
    assert.equal(await editor.inputValue(), '未发送的原草稿');
    const canSend = !await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).isDisabled();
    if (!canSend) {
      gaps.push('Visualization confirmed follow-up sending is not connected to the conversation send path.');
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await editor.inputValue(), '未发送的原草稿');
    assert.equal(fake.calls('turn/start').length, 0);
    await frame.getByRole('button', { name: '继续分析', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await editor.inputValue(), '未发送的原草稿');
    assert.equal(fake.calls('turn/start').length, 0);
    checks.push('Follow-up requires a confirmation; Escape and Cancel preserve the existing draft and start no turn');
    if (canSend) {
      await frame.getByRole('button', { name: '继续分析', exact: true }).click();
      await page.getByRole('dialog').getByText('Widget state', { exact: true }).click();
      await page.getByRole('dialog').getByLabel('Widget state JSON').fill('{"amount":8}');
      await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
      await fake.waitFor(() => fake.calls('turn/start').length === 1, 15_000);
      const request = fake.calls('turn/start')[0]!.params;
      assert.equal(request.threadId, threadId);
      assert.ok(Array.isArray(request.input) && request.input.some(item => item?.type === 'text' && typeof item.text === 'string'
        && item.text.includes('分析当前数量 7\n\nCurrent widget context (JSON):\n{\n  "amount": 8\n}')));
      assert.match(JSON.stringify(request.additionalContext), /visualization/);
      assert.equal(await editor.inputValue(), '未发送的原草稿');
      checks.push('Confirm submits one synthetic turn with visualization context while retaining the existing draft');
    }
  } else {
    assert.match(await editor.inputValue(), /分析当前数量 7/);
    gaps.push('Visualization follow-up pre-fills the composer without the original confirmation dialog.');
    checks.push('Follow-up prefills a draft and does not start a turn');
  }
  await page.setViewportSize({ width: 402, height: 874 });
  await capture('03-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('402px layout has no horizontal overflow');
  await rm(path);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('article').getByRole('button', { name: '交互可视化验收', exact: true }).click();
  await page.getByRole('region', { name: 'Visualization', exact: true }).getByRole('alert').waitFor({ timeout: 60000 });
  await page.getByText('可视化结束', { exact: true }).waitFor();
  await capture('04-missing-file');
  checks.push('An unavailable source shows an error while chat remains readable');
  assert.deepEqual(errors, []);
  assert.deepEqual(gaps, [], 'Original visualization follow-up confirmation and sending must be available');
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
