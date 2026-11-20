// Run under /tmp/agents-workbench-heavy.lock. Only disposable daemon state is used.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn, NO_REPLY } from '../test/fake-codex.ts';
import { fileDaemonFixture } from '../test/file-daemon-fixture.ts';
import { readPinnedWorkspaceIcons } from './build-workspace-icons.ts';
import type { ThreadGoal } from '../src/workspace/conversation-metrics.ts';

const reference = process.argv.includes('--reference');
const root = await mkdtemp('/tmp/yard-goal-usage-'), output = resolve('.local/workspace-goal-usage');
const threadId = '00000000-0000-4000-8000-000000000277', codexHome = join(root, 'codex'), dataDir = join(root, 'data');
await mkdir(codexHome); await mkdir(dataDir); await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Goal usage fixture', path: root }]));
const fake = await createFakeCodex(root), fileDaemon = fileDaemonFixture();
let goal: ThreadGoal | null = { threadId, objective: 'Finish the Goal and usage fixture', status: 'active', tokenBudget: 100_000,
  tokensUsed: 12_500, timeUsedSeconds: 70, createdAt: Math.floor(Date.now() / 1_000), updatedAt: Math.floor(Date.now() / 1_000) };
const quota = { rateLimits: { limitId: 'codex', limitName: 'codex', planType: 'pro',
  primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1_000) + 3_600 },
  secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1_000) + 172_800 }, credits: null },
  rateLimitsByLimitId: null };
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerAccountId: null, status: null, error: null }));
fake.handlers.set('account/rateLimits/read', () => quota);
for (const method of ['fs/getMetadata', 'fs/readFile', 'fs/createDirectory', 'fs/writeFile']) fake.handlers.set(method, params => fileDaemon(method, params));
fake.handlers.set('thread/goal/get', () => ({ goal }));
fake.handlers.set('thread/goal/set', params => {
  assert.equal(params.threadId, threadId);
  if (!reference) assert.equal(params.origin, 'user');
  if (params.objective === 'fail goal') throw new Error('Fixture goal save failed');
  goal = { ...goal!, ...params, updatedAt: Math.floor(Date.now() / 1_000) } as ThreadGoal;
  fake.broadcast({ method: 'thread/goal/updated', params: { threadId, turnId: null, goal } });
  return { goal };
});
fake.handlers.set('thread/goal/clear', params => {
  assert.equal(params.threadId, threadId); goal = null;
  fake.broadcast({ method: 'thread/goal/cleared', params: { threadId } }); return { cleared: true };
});
fake.threads.set(threadId, fixtureThread(threadId, root, { name: 'Goal usage fixture', turns: [fixtureTurn('goal-turn', [agentItem('goal-answer', 'Disposable Goal and usage fixture')])] }));
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath, codexHome,
  sourceWorkspace: !reference, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors: string[] = [], checks: string[] = [], failedRequests: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => failedRequests.push(request.url() + ': ' + request.failure()?.errorText));
page.on('response', response => { if (response.status() >= 400) failedRequests.push(response.url() + ': ' + response.status()); });
page.setDefaultTimeout(10_000);
async function capture(name: string) {
  await page.screenshot({ path: join(output, (reference ? 'original-' : 'candidate-') + name + '.png') });
  await writeFile(join(output, (reference ? 'original-' : 'candidate-') + name + '.txt'), await page.locator('body').ariaSnapshot());
}
const usage = { total: { totalTokens: 900_000, inputTokens: 850_000, cachedInputTokens: 500_000, outputTokens: 50_000, reasoningOutputTokens: 10_000 },
  last: { totalTokens: 20_000, inputTokens: 18_000, cachedInputTokens: 15_000, outputTokens: 2_000, reasoningOutputTokens: 500 }, modelContextWindow: 200_000 };
try {
  await page.addInitScript(() => { try { localStorage.setItem('native-atoms', JSON.stringify({ 'show-context-window-usage': true })); } catch {} });
  if (!reference) {
    const fixture = await build({ stdin: { contents: `
      import { createRoot } from 'react-dom/client'; import { useState } from 'react';
      import { ConversationGoal, ConversationGoalEditor, useConversationGoal } from './src/workspace/conversation-goal.tsx';
      import { ContextUsageIndicator, ConversationUsageMenu, useConversationUsage } from './src/workspace/conversation-usage.tsx';
      function Fixture() {
        const goal = useConversationGoal(${JSON.stringify(threadId)}, 'local'), usage = useConversationUsage(${JSON.stringify(threadId)}, 'local');
        const [editing, setEditing] = useState(false);
        return <main className="yard-source-frame" style={{padding: 40, gap: 40, alignItems: 'center'}}>
          <section style={{width: 720}}><ConversationGoal controller={goal} onEdit={() => setEditing(true)}/>
            <div style={{border: '1px solid var(--color-border)',borderRadius: '0 0 16px 16px',padding:20}}>
            <p>Disposable Goal and usage fixture</p><footer style={{display:'flex',gap:12,alignItems:'center',paddingTop:20}}>
              <ContextUsageIndicator usage={usage.contextUsage}/><span>Model</span>
              <ConversationUsageMenu controller={usage}/>
            </footer></div>
          </section><button hidden id="fixture-close-goal" onClick={() => setEditing(false)}>Close fixture editor</button>
          {editing && <aside style={{width:420,height:600,border:'1px solid var(--color-border)'}}><ConversationGoalEditor controller={goal}/></aside>}
        </main>;
      } document.documentElement.dataset.theme='light'; createRoot(document.getElementById('root')).render(<Fixture/>);`,
      resolveDir: process.cwd(), sourcefile: 'goal-usage-fixture.tsx', loader: 'tsx' }, bundle: true, write: false,
      format: 'esm', jsx: 'automatic', outfile: 'fixture.js', define: { 'process.env.NODE_ENV': '"production"', __yardWorkspaceIcons: JSON.stringify(await readPinnedWorkspaceIcons()) } });
    await page.route('**/workbench-entry.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture.outputFiles.find(file => file.path.endsWith('.js'))!.text }));
    await page.route('**/source-workspace.css', async route => route.fulfill({ contentType: 'text/css', body:
      await readFile('src/workspace/workspace.css', 'utf8') + '\n' + fixture.outputFiles.find(file => file.path.endsWith('.css'))!.text }));
  }
  await page.goto(app.url + '/?initialRoute=' + encodeURIComponent('/local/' + threadId), { waitUntil: 'commit' });
  await page.getByText('Disposable Goal and usage fixture', { exact: true }).waitFor({ timeout: reference ? 60_000 : 15_000 });
  if (reference) {
    for (const label of ['Dismiss', 'Dismiss Full access warning for this session']) {
      const button = page.getByRole('button', { name: label, exact: true }); if (await button.isVisible()) await button.click();
    }
    fake.broadcast({ method: 'thread/goal/updated', params: { threadId, turnId: null, goal } });
  }
  await page.getByText('Pursuing goal', { exact: true }).waitFor();
  fake.broadcast({ method: 'thread/tokenUsage/updated', params: { threadId, turnId: 'goal-turn', tokenUsage: usage } });
  await capture('01-active');
  if (reference) {
    const row = page.getByRole('button', { name: 'Edit goal', exact: true });
    checks.push('Original Goal row captured from shipped renderer: ' + JSON.stringify(await row.evaluate(button => {
      let element: Element = button;
      while (element.parentElement && !element.textContent?.includes('Pursuing goal')) element = element.parentElement;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, padding: style.padding, fontSize: style.fontSize };
    })));
    const indicators = await page.locator('[aria-label^="Context usage"]').count();
    if (indicators) { await page.locator('[aria-label^="Context usage"]').hover(); await page.getByRole('tooltip').waitFor(); await capture('02-context'); }
    await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Goal', exact: true });
    const available = await editor.waitFor({ timeout: 2_000 }).then(() => true, () => false);
    if (available) { await capture('03-editor'); checks.push('Original Goal editor captured from shipped renderer'); }
    else checks.push('Original Goal editor did not open in the isolated renderer fixture; editor contract is backed by pinned bundle evidence');
  } else {
    const donut = page.getByRole('img', { name: 'Context usage: 10%', exact: true }); await donut.waitFor(); await donut.hover();
    await page.getByRole('tooltip').waitFor(); assert.match(await page.getByRole('tooltip').innerText(), /20k \/ 200k tokens used/);
    await capture('02-context'); await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Select where to run the chat', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Usage remaining', exact: true }).hover();
    const quotaMenu = page.getByRole('menu', { name: 'Usage remaining', exact: true }); await quotaMenu.waitFor();
    assert.match(await quotaMenu.innerText(), /75%/); assert.match(await quotaMenu.innerText(), /20%/); await capture('03-account');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    fake.broadcast({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: null, secondary: null } } });
    await page.getByRole('menuitem', { name: 'Usage remaining', exact: true }).waitFor({ state: 'detached' });
    fake.broadcast({ method: 'account/rateLimits/updated', params: { rateLimits: quota.rateLimits } });
    await page.getByRole('button', { name: 'Pause goal', exact: true }).click(); await page.getByText('Paused goal', { exact: true }).waitFor();
    assert.equal(fake.calls('turn/interrupt').length, 0); await page.getByRole('button', { name: 'Resume goal', exact: true }).click();
    await page.getByText('Pursuing goal', { exact: true }).waitFor();
    await page.evaluate(({ threadId, usage }) => {
      window.postMessage({ type: 'mcp-notification', hostId: 'other-host', method: 'thread/tokenUsage/updated', params: { threadId, tokenUsage: { ...usage, last: { ...usage.last, totalTokens: 150_000 } } } }, location.origin);
      window.postMessage({ type: 'mcp-notification', hostId: 'local', method: 'thread/goal/updated', params: { threadId: 'other-thread', goal: { threadId: 'other-thread', objective: 'Wrong conversation', status: 'paused', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 } } }, location.origin);
    }, { threadId, usage });
    assert.equal(await donut.count(), 1); assert.equal(await page.getByText('Wrong conversation', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Goal', exact: true }); await editor.waitFor(); await editor.fill('Changed draft');
    await page.getByRole('button', { name: 'Revert', exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(() => document.getElementById('fixture-close-goal')!.click());
    await editor.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
    await editor.waitFor(); assert.equal(await editor.innerText(), 'Changed draft');
    await editor.press('End'); await editor.press('Enter'); await page.keyboard.insertText('Second line');
    assert.equal(await editor.locator('p').count(), 2); assert.match(await editor.innerText(), /Second line/);
    await page.getByRole('button', { name: 'Revert', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[aria-label="Goal"]')?.textContent === 'Finish the Goal and usage fixture');
    const rich = '# Rich objective\n\nFinish **bold** with [context](https://example.com).\n\n```ts\nconst goal = true;\n```';
    await editor.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await page.keyboard.press('Backspace');
    await editor.evaluate((element, text) => {
      const data = new DataTransfer(); data.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, rich);
    assert.equal(await editor.locator('h1').innerText(), 'Rich objective');
    assert.equal(await editor.locator('strong').innerText(), 'bold');
    assert.equal(await editor.locator('pre code').innerText(), 'const goal = true;');
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !(document.querySelector('.yard-goal-save') as HTMLButtonElement)?.disabled);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await fake.waitFor(message => message.method === 'thread/goal/set' && String(message.params.objective).startsWith('# Rich objective'));
    await page.waitForFunction(() => (document.querySelector('.yard-goal-save') as HTMLButtonElement)?.disabled);
    await page.locator('.yard-goal-editor[aria-busy="false"]').waitFor();
    assert.equal(goal!.objective, rich); await capture('04-rich-editor');
    checks.push('Goal draft survives editor close/reopen; normal Enter adds a paragraph; Markdown headings, marks, links and code blocks survive paste and Mod-Enter save');
    await editor.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
    await editor.fill('fail goal'); await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture goal save failed' }).first().waitFor(); assert.equal(await editor.innerText(), 'fail goal');
    const long = 'Fixture Goal objective 🚀\n'.repeat(240);
    await editor.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
    await editor.fill(long); await page.getByRole('button', { name: 'Save', exact: true }).click();
    await fake.waitFor(message => message.method === 'thread/goal/set' && String(message.params.objective).startsWith('Read the Codex goal objective file at '));
    await page.waitForFunction(() => (document.querySelector('.yard-goal-save') as HTMLButtonElement)?.disabled);
    await page.locator('.yard-goal-editor[aria-busy="false"]').waitFor();
    assert.match(goal!.objective, /\/attachments\/[a-f0-9-]{36}\/goal-objective\.md before continuing\.$/);
    const target = goal!.objective.slice('Read the Codex goal objective file at '.length, -' before continuing.'.length);
    assert.equal(await readFile(target, 'utf8'), long.trim()); await capture('04-editor');
    for (const status of ['blocked', 'usageLimited', 'budgetLimited', 'complete'] as const) {
      goal = { ...goal!, status }; fake.broadcast({ method: 'thread/goal/updated', params: { threadId, turnId: null, goal } });
      await page.locator(`[data-goal-status="${status}"]`).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Resume goal', exact: true }).count(), status === 'blocked' || status === 'usageLimited' ? 1 : 0);
    }
    await page.getByRole('button', { name: 'Clear goal', exact: true }).click(); await page.locator('.yard-conversation-goal').waitFor({ state: 'detached' });
    assert.equal(fake.calls('turn/start').length, 0); checks.push('Goal get/update/pause/resume/edit/revert/failure/long attachment/clear, all six statuses, scoped notifications and both usage surfaces');
    // A racing initial get must not overwrite a newer daemon notification.
    fake.handlers.set('thread/goal/get', (_params, context) => {
      setTimeout(() => context.send({ id: context.message.id, result: { goal: null } }), 200); return NO_REPLY;
    });
    const nextRead = fake.calls('thread/goal/get').length + 1;
    await page.reload({ waitUntil: 'commit' }); await fake.waitForCall('thread/goal/get', nextRead);
    goal = { threadId, objective: 'Newer Goal notification', status: 'paused', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 };
    fake.broadcast({ method: 'thread/goal/updated', params: { threadId, turnId: null, goal } });
    await page.getByText('Newer Goal notification', { exact: false }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await page.locator('[data-goal-status="paused"]').count(), 1);
    checks.push('A stale initial get response cannot overwrite a newer Goal notification');
  }
  assert.deepEqual(errors, []);
} finally {
  await capture('final').catch(() => {});
  await writeFile(join(output, (reference ? 'original' : 'candidate') + '-report.json'), JSON.stringify({ realDaemonUsed: false, checks, errors, failedRequests,
    mutations: fake.messages.filter(message => message.method?.startsWith('thread/goal/')), turnsStarted: fake.calls('turn/start').length }, null, 2));
  await browser.close(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ reference, output, checks, errors }));
