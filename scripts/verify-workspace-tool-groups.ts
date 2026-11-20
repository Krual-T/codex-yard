// Disposable App Server fixture; run under /tmp/agents-workbench-heavy.lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Locator } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { ThreadItemSummary } from '../lib/codex-protocol.ts';
import { agentItem, commandItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';
import { appDetails, appResource, appResult, appTools, appUri } from './mcp-app-fixture.ts';

const source = process.argv.includes('--source');
const narrow = process.argv.includes('--narrow');
const dark = process.argv.includes('--dark');
const probePresentation = process.argv.includes('--probe-presentation');
const probeGroupStates = process.argv.includes('--probe-group-states');
const probeVisualActivity = process.argv.includes('--probe-visual-activity');
const probeComposerFidelity = process.argv.includes('--probe-composer-fidelity');
const probeReasoningStates = process.argv.includes('--probe-reasoning-states');
const probeLiveOperation = process.argv.includes('--probe-live-operation');
const probeMessageLinks = process.argv.includes('--probe-message-links');
const motion = process.argv.includes('--motion');
const probeWorkSettlement = process.argv.includes('--probe-work-settlement');
const probeRepeatedMcp = process.argv.includes('--probe-repeated-mcp');
const probeMcpAppTab = process.argv.includes('--probe-mcp-app-tab');
const probeMcpApp = probeMcpAppTab || process.argv.includes('--probe-mcp-app');
const withoutAtomicMove = process.argv.includes('--no-atomic-move');
const probeSources = process.argv.includes('--probe-sources');
const preview = process.argv.includes('--preview');
assert.ok(!preview || source, 'Preview requires --source.');
const output = resolve(process.env.AGENTS_TOOL_GROUP_EVIDENCE ?? '.local/workspace-tool-groups');
const referenceOutput = process.env.AGENTS_TOOL_GROUP_REFERENCE;
const root = await mkdtemp('/tmp/yard-tool-groups-');
const dataDir = join(root, 'data');
await mkdir(dataDir);
await mkdir(output, { recursive: true });
await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Tool fixture', path: root }]));
const fake = await createFakeCodex(root);
const mainId = '00000000-0000-4000-8000-000000000001';
const childId = '00000000-0000-4000-8000-000000000123';
const seedAnswer = 'Saved tool fixture.';
let tabToolReply: Promise<unknown> | undefined;
const earlier = { ...agentItem('seed-answer', seedAnswer), phase: 'final_answer' };
const thread = fixtureThread(mainId, root, { name: 'Mixed tool fixture', path: join(root, mainId + '.jsonl'),
  turns: [fixtureTurn('fixture-seed', [earlier])] });
fake.threads.set(mainId, thread);
const child = fixtureThread(childId, root, { name: 'Atlas', parentThreadId: mainId, agentNickname: 'Atlas', agentRole: 'explorer',
  source: { subAgent: { thread_spawn: { parent_thread_id: mainId } } },
  path: join(root, childId + '.jsonl'), turns: [fixtureTurn('child-seed', [
    { id: 'child-prompt', type: 'userMessage', content: [{ type: 'text', text: 'Review the sample table.', text_elements: [] }] },
    { ...agentItem('child-answer', 'The child checked both rows.'), phase: 'final_answer' },
  ])] });
fake.threads.set(childId, child);
fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.169.1 (Linux)' }));
fake.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
fake.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
if (probeMcpApp) {
  let retries = 0;
  fake.handlers.set('mcpServerStatus/list', () => ({ data: [{
    name: 'fixture', tools: Object.fromEntries(appTools.map(tool => [tool.name, tool])), resources: [],
    resourceTemplates: [], authStatus: 'notLoggedIn',
  }], nextCursor: null }));
  fake.handlers.set('mcpServer/resource/read', params => {
    assert.equal(params.threadId, mainId);
    assert.equal(params.uri, appUri);
    if (params.server === 'retry_fixture' && ++retries === 1) return { contents: [] };
    assert.ok(params.server === 'fixture' || params.server === 'retry_fixture');
    return { contents: [appResource] };
  });
  fake.handlers.set('mcpServer/tool/call', params => {
    assert.equal(params.threadId, mainId);
    assert.equal(params.server, 'fixture');
    assert.equal(params.tool, 'read_sample_details');
    assert.deepEqual(params.arguments, { sample: 'Sample A' });
    return tabToolReply ?? appDetails;
  });
}
if (probeSources && source) {
  fake.handlers.set('plugin/installed', () => ({
    marketplaces: [{ name: 'fixture', plugins: [
      { id: 'sample-inspector@fixture', name: 'sample-inspector', installed: true, enabled: true, interface: { displayName: 'Sample Inspector' } },
      { id: 'hidden@fixture', name: 'Hidden Fixture', installed: true, enabled: false },
    ] }], marketplaceLoadErrors: [],
  }));
}
if ((probeSources || probeComposerFidelity) && source) {
  const uploadPath = (value: unknown) => {
    assert.ok(typeof value === 'string' && isAbsolute(value));
    const child = relative(root, value);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    return value;
  };
  fake.handlers.set('fs/createDirectory', async params => {
    await mkdir(uploadPath(params.path), { recursive: true });
    return {};
  });
  fake.handlers.set('fs/writeFile', async params => {
    await writeFile(uploadPath(params.path), Buffer.from(String(params.dataBase64), 'base64'), { flag: 'wx' });
    return {};
  });
  fake.handlers.set('fs/getMetadata', async params => {
    const info = await stat(uploadPath(params.path));
    return { isFile: info.isFile(), isDirectory: info.isDirectory(), modifiedAtMs: info.mtimeMs, createdAtMs: info.birthtimeMs };
  });
}
if (probePresentation || probeGroupStates || probeWorkSettlement || probeVisualActivity || probeReasoningStates || probeLiveOperation) fake.handlers.set('turn/start', params => {
  const result = fake.defaultResult('turn/start', params) as { turn: { startedAt: number | null } };
  result.turn.startedAt = Math.floor(Date.now() / 1000);
  return result;
});
fake.handlers.set('thread/resume', params => ({ ...fake.defaultResult('thread/resume', params) as object,
  turnsBackwardsCursor: '0', itemsBackwardsCursor: '0' }));
fake.handlers.set('thread/turns/list', params => {
  const turns = [...fake.threads.get(String(params.threadId))!.turns];
  if (params.sortDirection !== 'asc') turns.reverse();
  const offset = Number(params.cursor ?? 0), limit = Number(params.limit ?? 5);
  return { data: turns.slice(offset, offset + limit).map(turn => ({ ...turn, itemsView: params.itemsView ?? 'full',
    items: params.itemsView === 'notLoaded' ? [] : params.itemsView === 'summary'
      ? turn.items.filter(item => item.type === 'userMessage' || item.type === 'agentMessage' && item.phase !== 'commentary') : turn.items,
  })), nextCursor: offset + limit < turns.length ? String(offset + limit) : null, backwardsCursor: null };
});
const app = await createNativeWorkbench({ port: 0, dataDir, workspace: root, socketPath: fake.socketPath,
  codexHome: join(root, 'codex'), sourceWorkspace: source, hostCatalog: { hosts: [], projects: [], assignments: {} },
  httpFetch: async input => probeMcpApp && new URL(String(input)).pathname === '/v1/initialize'
    ? Response.json({ has_updates: true, time: Date.now(), hash_used: 'none', feature_gates: {}, dynamic_configs: {},
      layer_configs: { '2138468235': { name: '2138468235', value: { enable_mcp_apps: true }, rule_id: 'fixture',
        explicit_parameters: ['enable_mcp_apps'], secondary_exposures: [], undelegated_secondary_exposures: [] } } })
    : new Response('Offline fixture', { status: 503 }) });
const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
  join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  hasTouch: narrow, colorScheme: dark ? 'dark' : 'light', reducedMotion: motion ? 'no-preference' : 'reduce' });
if (withoutAtomicMove) await page.addInitScript(() => Reflect.deleteProperty(Element.prototype, 'moveBefore'));
if (probeSources) await page.route('https://example.test/sample', route => route.fulfill({
  contentType: 'text/html', body: '<!doctype html><title>Fixture source</title><h1>Verified source document</h1>',
}));
if (probePresentation || probeSources || probeRepeatedMcp || probeGroupStates) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.url });
}
page.setDefaultTimeout(8_000);
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const transcript = page.getByRole('region', { name: 'Conversation', exact: true });
const snapshots: string[] = [];
let passed = false;
async function snapshot(name: string) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(output, name + '.aria.txt'), await transcript.ariaSnapshot());
  snapshots.push(name);
}
async function paneSnapshot(name: string) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled', caret: 'hide' });
  await writeFile(join(output, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
  snapshots.push(name);
}
async function assertOrder(rows: Locator[]) {
  const positions = await Promise.all(rows.map(async row => (await row.boundingBox())?.y));
  assert.ok(positions.every((y, index) => typeof y === 'number' && (index === 0 || y > positions[index - 1]!)),
    'Timeline order: ' + positions.join(', '));
}
async function measure(name: string, rows: Record<string, Locator>) {
  const metrics: Record<string, unknown> = {};
  for (const [key, row] of Object.entries(rows)) {
    metrics[key] = await row.evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const { color, backgroundColor, fontSize, lineHeight, borderRadius, gap, opacity } = getComputedStyle(element);
      return { x, y, width, height, color, backgroundColor, fontSize, lineHeight, borderRadius, gap, opacity };
    });
  }
  metrics.viewport = await transcript.evaluate(element => ({
    width: innerWidth, scrollX, scrollWidth: document.documentElement.scrollWidth,
    transcriptWidth: element.getBoundingClientRect().width,
  }));
  if (narrow) metrics.layout = await Object.values(rows)[0]!.evaluate(element => {
    const layout = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const { x, width } = node.getBoundingClientRect();
      const { overflowX, paddingInlineStart, paddingInlineEnd } = getComputedStyle(node);
      layout.push({ tag: node.tagName, x, width, scrollLeft: node.scrollLeft, overflowX, paddingInlineStart, paddingInlineEnd });
    }
    return layout;
  });
  await writeFile(join(output, name + '.json'), JSON.stringify(metrics, null, 2) + '\n');
}

async function verifyTimeline(url: string) {
  await page.goto(url, { waitUntil: 'commit' });
  await page.getByText(seedAnswer, { exact: true }).waitFor({ timeout: 25_000 });
  if (!source) await fake.waitForCall('thread/resume');
  if (narrow && (probeVisualActivity || probeComposerFidelity || probeReasoningStates || probeMessageLinks)) {
    const sidebar = page.getByRole('button', { name: 'Hide sidebar', exact: true });
    if (await sidebar.count()) await sidebar.click();
  }
  const editor = page.getByRole('textbox', { name: 'Work with Codex', exact: true }).first();
  await editor.fill('Inspect the tool fixture.');
  await page.getByRole('button', { name: /^Send(?: message)?$/, exact: true }).click();
  await fake.waitForCall('turn/start');
  const turn = thread.turns.at(-1)!;
  assert.equal(turn.status, 'inProgress');
  const turnId = turn.id;
  const notify = (method: string, params: Record<string, unknown>) =>
    fake.broadcast({ method, params: { threadId: mainId, turnId, ...params } });
  const finish = (item: ThreadItemSummary) => {
    notify('item/started', { item });
    notify('item/completed', { item });
    turn.items.push(item);
  };
  const say = (id: string, text: string, phase: string) => finish({ ...agentItem(id, text), phase });
  await page.locator('[data-user-message-bubble]').getByText('Inspect the tool fixture.', { exact: true }).waitFor();
  notify('thread/status/changed', { status: thread.status });

  if (probeLiveOperation) {
    async function state(name: string, label?: string) {
      await delay(750);
      const rows = await transcript.evaluate(node => [...node.querySelectorAll<HTMLElement>('button,[role="button"],p,div.yard-source-reasoning-title,[class*="group/activity-header"]')]
        .filter(element => element.getBoundingClientRect().height && /Reading sync|Checking sync|Edited|Read files|Reading sync\.ts|Ran commands|Thinking/.test(element.textContent ?? ''))
        .map(element => {
          const visible = element.cloneNode(true) as HTMLElement;
          visible.querySelectorAll('[aria-hidden="true"]').forEach(child => child.remove());
          const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
          const shimmer = element.querySelector('._cadencedShimmer_wne66_2');
          return { text: visible.textContent, className: element.className,
            color: style.color, lineHeight: style.lineHeight, gap: style.gap,
            x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
            shimmer: !!shimmer, shimmerAnimation: shimmer?.querySelector('._cadencedShimmerSweep_wne66_35')?.getAnimations()
              .map(animation => ({ duration: animation.effect?.getTiming().duration })),
            html: element.outerHTML.slice(0, 2500), expanded: element.getAttribute('aria-expanded') };
        }));
      await writeFile(join(output, name + '.json'), JSON.stringify(rows, null, 2));
      if (label) {
        const row = rows.find(row => row.text?.trim() === label);
        assert.ok(row, name + ' shows the current operation: ' + label);
        assert.ok(row.shimmer, name + ' uses the original cadenced shimmer');
      }
      await snapshot(name);
    }
    notify('turn/started', { turn });
    finish({ ...commandItem('mixed-read', 'Read old file.', root),
      command: 'cat old.ts', commandActions: [{ type: 'read', command: 'cat old.ts', name: 'old.ts', path: join(root, 'old.ts') }] });
    finish({ id: 'mixed-edit', type: 'fileChange', status: 'completed', changes: [
      { path: join(root, 'sync.ts'), kind: { type: 'update' }, diff: '+updated' },
    ] });
    finish({ ...commandItem('mixed-shell', 'Check finished.', root), command: 'npm run check' });
    await state('live-mixed-settled', 'Thinking');
    const reason = { id: 'mixed-reason', type: 'reasoning', summary: ['**Reading sync scripts**'] };
    notify('item/started', { item: { ...reason, summary: [] } });
    notify('item/reasoning/summaryTextDelta', { itemId: reason.id, summaryIndex: 0, delta: reason.summary[0] });
    await state('live-mixed-reasoning', 'Reading sync scripts');
    notify('item/completed', { item: reason }); turn.items.push(reason);
    const running = { ...commandItem('mixed-current', 'Current file read.', root),
      command: 'cat sync.ts', commandActions: [{ type: 'read', command: 'cat sync.ts', name: 'sync.ts', path: join(root, 'sync.ts') }] };
    notify('item/started', { item: { ...running, status: 'inProgress', exitCode: null } });
    await state('live-mixed-running', 'Reading sync.ts');
    notify('item/completed', { item: running }); turn.items.push(running);
    await state('live-mixed-completed', 'Reading sync.ts');
    const next = { id: 'mixed-next-reason', type: 'reasoning', summary: ['**Checking sync results**'] };
    notify('item/started', { item: { ...next, summary: [] } });
    notify('item/reasoning/summaryTextDelta', { itemId: next.id, summaryIndex: 0, delta: next.summary[0] });
    await state('live-mixed-next-reasoning', 'Reading sync.ts');
    notify('item/completed', { item: next }); turn.items.push(next);
    say('mixed-progress', 'The sync scripts are ready for the next check.', 'commentary');
    await state('live-mixed-commentary');
    say('mixed-answer', 'Sync checks completed.', 'final_answer');
    turn.status = 'completed'; thread.status = { type: 'idle' };
    notify('turn/completed', { turn });
    await state('live-mixed-turn-completed');
    await transcript.getByText('Sync checks completed.', { exact: true }).waitFor();
    return;
  }

  if (probeMessageLinks) {
    say('link-note', `[本机隔离预览](${app.url}) · [原版截图](<${join(root, 'native.png')}>) · **[React 截图](<${join(root, 'react.png')}>)** · [说明文件](<${join(root, 'report.md')}>)`, 'commentary');
    await transcript.getByText('原版截图', { exact: true }).waitFor();
    const measure = (text: Locator) => text.evaluate(node => {
        const link = node.closest('a,button,[role="button"],[role="link"]') ?? node;
        const { color, textDecorationLine, fontWeight, display, gap, lineHeight } = getComputedStyle(link);
        const mention = link.querySelector('[data-appearance="inline-mention"]') ?? link;
        const label = link.querySelector('._Label_a4hbb_2') ?? node;
        const range = document.createRange();
        range.selectNodeContents(label);
        const glyph = range.getBoundingClientRect();
        return { text: link.textContent, color, textDecorationLine, fontWeight, display, gap, lineHeight, html: link.outerHTML,
          labelColor: getComputedStyle(mention).color, labelWeight: getComputedStyle(label).fontWeight,
          mentionDecoration: getComputedStyle(mention).textDecorationLine,
          mentionDecorationStyle: getComputedStyle(mention).textDecorationStyle,
          mentionDecorationColor: getComputedStyle(mention).textDecorationColor,
          mentionDecorationThickness: getComputedStyle(mention).textDecorationThickness,
          tokens: Object.fromEntries(['--color-text-info', '--color-text', '--inline-mention-base-color',
            '--inline-mention-dark-base-color', '--inline-mention-resolved-base-color'].map(key => [key, getComputedStyle(mention).getPropertyValue(key)])),
          parent: link.parentElement?.outerHTML.slice(0, 4000),
          svg: [...link.querySelectorAll('svg')].map(svg => ({viewBox: svg.getAttribute('viewBox'),
            paths: [...svg.querySelectorAll('path')].map(path => path.getAttribute('d')),
            width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height,
            verticalAlign: getComputedStyle(svg).verticalAlign, margin: getComputedStyle(svg).margin,
            glyphOffset: [svg.getBoundingClientRect().x - glyph.x, svg.getBoundingClientRect().y - glyph.y].map(value => Math.round(value * 10) / 10) })) };
    });
    type Measured = Awaited<ReturnType<typeof measure>>;
    const metrics: (Measured & { hover: { line: string; style: string; color: string; thickness: string } })[] = [];
    for (const label of ['本机隔离预览', '原版截图', 'React 截图', '说明文件']) {
      const text = transcript.getByText(label, { exact: true }).first();
      const normal = await measure(text);
      await text.hover();
      const hovered = await measure(text);
      metrics.push({ ...normal, hover: { line: hovered.mentionDecoration, style: hovered.mentionDecorationStyle,
        color: hovered.mentionDecorationColor, thickness: hovered.mentionDecorationThickness } });
      await page.mouse.move((page.viewportSize()?.width ?? 390) / 2, 1);
    }
    await writeFile(join(output, 'message-links.json'), JSON.stringify(metrics, null, 2) + '\n');
    if (source && referenceOutput) {
      const original = JSON.parse(await readFile(join(referenceOutput, 'message-links.json'), 'utf8')) as typeof metrics;
      const presentation = ({ text, labelColor, labelWeight, textDecorationLine, display, lineHeight, svg, hover }: typeof metrics[number]) =>
        ({ text, labelColor, labelWeight, textDecorationLine, display, lineHeight, svg, hover });
      assert.deepEqual(metrics.map(presentation), original.map(presentation));
    }
    await snapshot('message-links');
    if (source) {
      const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        return canvas.toDataURL('image/png').split(',')[1]!;
      });
      await page.route('**/api/files/content?*', route => route.fulfill({
        contentType: new URL(route.request().url()).searchParams.get('path')?.endsWith('.png') ? 'image/png' : 'text/plain',
        body: new URL(route.request().url()).searchParams.get('path')?.endsWith('.png')
          ? Buffer.from(image, 'base64') : 'Verified message file link.',
      }));
      await transcript.getByRole('button', { name: '原版截图', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('tabpanel', { name: 'native.png', exact: true }).getByRole('img', { name: 'native.png', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close tab', exact: true }).click();
      await transcript.getByRole('button', { name: '说明文件', exact: true }).focus();
      await page.keyboard.press('Space');
      await page.getByRole('tabpanel', { name: 'report.md', exact: true }).getByText('Verified message file link.', { exact: true }).waitFor();
    }
    return;
  }

  if (probeReasoningStates) {
    async function state(name: string) {
      const captions: Record<string, string> = {
        'thought-partial-heading': '**Checking',
        'thought-heading': 'Checking the fixture',
        'thought-paragraph': 'First public paragraph with code and a link.',
        'thought-comment': 'First public paragraph with code and a link.',
        'thought-second-part': 'Second public paragraph.',
        'thought-completed': 'Second public paragraph.',
        'thought-after-tool': 'Running the final check',
        'thought-after-commentary': 'Running the final check',
      };
      if (captions[name]) await transcript.getByText(captions[name]!, { exact: false }).first().waitFor();
      await delay(200);
      await page.mouse.move(page.viewportSize()!.width / 2, 1);
      assert.equal(await transcript.getByText('Raw reasoning must remain private.', { exact: true }).count(), 0);
      const aria = await transcript.ariaSnapshot();
      if (captions[name]) {
        assert.ok(aria.includes(captions[name]!), name + ': latest public line matches the pinned caption');
        assert.equal(await transcript.getByRole('button', { name: captions[name], exact: true }).count(), name === 'thought-after-tool' ? 1 : 0,
          'Live summaries replace an existing tool heading, without adding a disclosure of their own');
      }
      assert.ok(!aria.includes('hidden comment') && !aria.includes('[a link]('), 'No comment or Markdown link syntax in the caption');
      if (['thought-tool-running', 'thought-tool-completed', 'thought-turn-completed',
        'thought-work-open', 'thought-history-open'].includes(name)) {
        assert.ok(!/Checking the fixture|First public|Second public|Running the final check/.test(aria),
          name + ': no stale or historical summary rows');
      }
      const metrics = await transcript.evaluate(element => {
        const rows = [...element.querySelectorAll<HTMLElement>('button,p,span')].filter(node =>
          /^(?:Thought(?: for .*)?|Thinking|Checking|Inspecting|Running|First public|Second public|Streaming)/.test(node.textContent?.trim() ?? '') &&
          node.getBoundingClientRect().height > 0);
        return rows.map(node => {
          const { fontSize, lineHeight, color, maxHeight, overflowY } = getComputedStyle(node);
          const { x, y, width, height } = node.getBoundingClientRect();
          return { tag: node.tagName, text: node.textContent, className: node.className,
            expanded: node.getAttribute('aria-expanded'), fontSize, lineHeight, color, maxHeight, overflowY,
            x, y, width, height, html: node.outerHTML.slice(0, 3000) };
        });
      });
      await writeFile(join(output, name + '.json'), JSON.stringify(metrics, null, 2) + '\n');
      await snapshot(name);
    }
    const thought = { id: 'public-thought', type: 'reasoning', summary: [''],
      content: ['Raw reasoning must remain private.'] };
    const append = (delta: string, index = 0) => {
      thought.summary[index] = (thought.summary[index] ?? '') + delta;
      notify('item/reasoning/summaryTextDelta', { itemId: thought.id, summaryIndex: index, delta });
    };
    notify('turn/started', { turn });
    notify('item/started', { item: { ...thought, summary: [] } });
    notify('item/reasoning/summaryPartAdded', { itemId: thought.id, summaryIndex: 0 });
    append('**Checking');
    await state('thought-partial-heading');
    append(' the fixture**');
    await state('thought-heading');
    append('\n\nFirst public paragraph with `code` and [a link](https://example.test).');
    await state('thought-paragraph');
    append('\n\n<!-- hidden comment -->');
    await state('thought-comment');
    notify('item/reasoning/summaryPartAdded', { itemId: thought.id, summaryIndex: 1 });
    append('**Inspecting the next state**\n\nSecond public paragraph.', 1);
    await state('thought-second-part');
    notify('item/completed', { item: thought });
    turn.items.push(thought);
    await state('thought-completed');
    const command = commandItem('thought-command', 'Check finished.', root);
    notify('item/started', { item: { ...command, status: 'inProgress', exitCode: null, aggregatedOutput: null } });
    await transcript.getByRole('button', { name: 'Running fixture-command', exact: true }).waitFor();
    await state('thought-tool-running');
    notify('item/completed', { item: command });
    turn.items.push(command);
    await state('thought-tool-completed');
    const afterTool = { id: 'public-thought-after-tool', type: 'reasoning', summary: ['**Running the final check**'], content: [] };
    notify('item/started', { item: { ...afterTool, summary: [] } });
    notify('item/reasoning/summaryPartAdded', { itemId: afterTool.id, summaryIndex: 0 });
    notify('item/reasoning/summaryTextDelta', { itemId: afterTool.id, summaryIndex: 0, delta: afterTool.summary[0] });
    await state('thought-after-tool');
    notify('item/completed', { item: afterTool });
    turn.items.push(afterTool);
    say('thought-progress', 'The command is complete.', 'commentary');
    await transcript.getByText('The command is complete.', { exact: true }).waitFor();
    await state('thought-after-commentary');
    say('thought-answer', 'The public summary check finished.', 'final_answer');
    turn.status = 'completed';
    turn.durationMs = 4_000;
    thread.status = { type: 'idle' };
    notify('turn/completed', { turn });
    notify('thread/status/changed', { status: thread.status });
    await transcript.getByText('The public summary check finished.', { exact: true }).waitFor();
    const work = transcript.getByRole('button', { name: 'Worked for 4s', exact: true });
    await work.waitFor();
    await state('thought-turn-completed');
    if (await work.getAttribute('aria-expanded') !== 'true') await work.click();
    await state('thought-work-open');
    const disclosure = transcript.getByRole('button', { name: /^Thought(?: for .*)?$/ }).last();
    if (await disclosure.count()) {
      await disclosure.click();
      await state('thought-disclosure-open');
    }
    await page.reload({ waitUntil: 'commit' });
    await transcript.getByText('The public summary check finished.', { exact: true }).waitFor({ timeout: 25_000 });
    await work.waitFor();
    if (await work.getAttribute('aria-expanded') !== 'true') await work.click();
    await state('thought-history-open');
    if (await disclosure.count()) {
      await disclosure.click();
      await state('thought-history-disclosure-open');
    }
    return;
  }

  if (probeComposerFidelity) {
    await editor.press('ArrowUp');
    assert.equal((await editor.innerText()).trim(), 'Inspect the tool fixture.');
    await editor.press('ArrowDown');
    assert.equal((await editor.innerText()).trim(), '');
    await editor.fill('Unsent draft');
    await editor.press('End');
    await editor.press('ArrowUp');
    assert.equal((await editor.innerText()).trim(), 'Unsent draft');
    await editor.fill('');
    await editor.evaluate(async node => {
      const canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = 50;
      const picture = canvas.getContext('2d')!;
      picture.fillStyle = '#16436d';
      picture.fillRect(0, 0, 80, 50);
      picture.fillStyle = '#ffcc00';
      picture.fillRect(20, 15, 40, 20);
      const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([png], 'image.png', { type: 'image/png' }));
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    const attachmentArea = page.locator('[data-composer-attachments]').filter({ has: page.locator('img') }).first();
    const image = attachmentArea.locator('img').first();
    await image.waitFor();
    await image.evaluate(async node => { await (node as HTMLImageElement).decode(); });
    const imageButton = attachmentArea.getByRole('button', { name: 'image.png', exact: true });
    const remove = attachmentArea.getByRole('button', { name: 'Remove image.png', exact: true });
    assert.equal(await attachmentArea.getByText('image.png', { exact: true }).count(), 0, 'No filename strip for images');
    assert.deepEqual(await image.evaluate(node => [node.clientWidth, node.clientHeight, getComputedStyle(node).objectFit]), [122, 122, 'cover']);
    assert.equal(await remove.evaluate(node => getComputedStyle(node).opacity), narrow ? '1' : '0');
    await paneSnapshot('composer-image');
    await writeFile(join(output, 'composer-image.surface.json'), JSON.stringify(await attachmentArea.evaluate(area =>
      [...area.querySelectorAll('img, [data-attachment], .composer-attachment-surface, .yard-source-attachment, .yard-source-attachment-name, button')]
        .map(node => {
          const { width, height, x, y } = node.getBoundingClientRect();
          const { objectFit, borderRadius, opacity, display, backgroundColor } = getComputedStyle(node);
          return { tag: node.tagName, outer: node.outerHTML.replace(/src="[^"]*"/g, 'src="(fixture)"').slice(0, 1400),
            text: node.textContent, width, height, x, y, objectFit, borderRadius, opacity, display, backgroundColor };
        })), null, 2) + '\n');
    if (!narrow) {
      await imageButton.hover();
      assert.equal(await remove.evaluate(node => getComputedStyle(node).opacity), '1');
    }
    await imageButton.click();
    const previewDialog = page.getByRole('dialog').filter({ has: page.getByRole('img', { name: 'User attachment' }) }).last();
    await previewDialog.waitFor();
    await page.keyboard.press('Escape');
    await previewDialog.waitFor({ state: 'hidden' });
    await remove.click();
    await image.waitFor({ state: 'hidden' });
    return;
  }

  if (probeVisualActivity) {
    async function surface(name: string) {
      const headings = await transcript.getByRole('button', { name: /^(?:Running fixture|Ran fixture|Read files|Edited a file|Working)/i }).elementHandles();
      const metrics = await transcript.evaluate((element, headings) => {
        const box = (node: Element) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          const { margin, padding, gap, color, lineHeight, fontSize, animation, backgroundImage, backgroundSize, maskImage, opacity } = getComputedStyle(node);
          return { x, y, width, height, margin, padding, gap, color, lineHeight, fontSize, animation, backgroundImage, backgroundSize, maskImage, opacity };
        };
        const icon = (node: SVGSVGElement) => {
          const { x, y, width, height } = node.getBBox();
          return { outer: node.outerHTML, viewBox: node.getAttribute('viewBox'),
            paths: [...node.querySelectorAll('path')].map(path => path.getAttribute('d')),
            draw: [x, y, width, height], ...box(node) };
        };
        const row = (node: HTMLElement) => {
          const trigger = node;
          const labelId = node.getAttribute('aria-labelledby');
          const label = labelId ? document.getElementById(labelId) : null;
          if (label && node.parentElement?.contains(label)) node = node.parentElement;
          const range = document.createRange();
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text = walker.nextNode();
          while (text && (!text.textContent?.trim() || text.parentElement?.closest('svg,[aria-hidden="true"]'))) text = walker.nextNode();
          if (text) range.selectNodeContents(text);
          const { x, y, width, height } = range.getBoundingClientRect();
          return { text: trigger.getAttribute('aria-label') || label?.innerText.trim() || node.innerText.trim() || node.textContent?.trim(),
            outer: node.outerHTML.slice(0, 6200), ...box(node), className: node.className, parent: node.parentElement?.className,
            glyph: [x, y, width, height], icons: [...node.querySelectorAll<SVGSVGElement>('svg')].map(icon) };
        };
        const scrollbar = (node: Element, pseudo: string) => {
          const { backgroundColor, borderWidth, borderColor, borderRadius, width, scrollbarColor } = getComputedStyle(node, pseudo);
          return { backgroundColor, borderWidth, borderColor, borderRadius, width, scrollbarColor };
        };
        const ancestors: Element[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(node);
        return { transcript: box(element), ancestors: ancestors.map(node => ({ className: node.className, ...box(node), overflow: getComputedStyle(node).overflow })),
          scrolling: [...ancestors, ...element.querySelectorAll('div')].filter(node => node.clientHeight > 0 && /auto|scroll/.test(getComputedStyle(node).overflowY))
            .map(node => ({ className: node.className, ...box(node), thumb: scrollbar(node, '::-webkit-scrollbar-thumb'),
              track: scrollbar(node, '::-webkit-scrollbar'), color: getComputedStyle(node).scrollbarColor, hovered: node.matches(':hover') })),
          rows: [...element.querySelectorAll<HTMLElement>('summary,button,[role="button"],[role="status"],.yard-source-activity-search')]
            .filter(node => /Working|typecheck|README|ran a command|searched|edit/i.test(node.innerText || node.textContent || ''))
            .concat(headings.filter(node => node instanceof HTMLElement)).map(row),
          reasoning: [...element.querySelectorAll<HTMLElement>('p,span')]
            .filter(node => node.textContent?.trim() === 'Running typecheck' && node.children.length === 0)
            .map(node => ({ ...box(node), outer: node.parentElement?.closest('summary,button,[role="button"]')?.outerHTML.slice(0, 7000) })),
          animations: element.getAnimations({ subtree: true }).filter(a => a instanceof CSSAnimation)
            .map(a => ({ name: (a as CSSAnimation).animationName, timing: a.effect?.getTiming() })),
          sidebar: [...document.querySelectorAll('[data-app-action-sidebar-thread-row] [role="status"]')]
            .map(node => ({ outer: node.outerHTML, ...box(node), icons: [...node.querySelectorAll<SVGSVGElement>('svg')].map(icon),
              children: [...node.children].map(child => box(child)) })),
        };
      }, headings);
      await writeFile(join(output, name + '.surface.json'), JSON.stringify(metrics, null, 2) + '\n');
      if (source && referenceOutput) {
        const original = JSON.parse(await readFile(join(referenceOutput, name + '.surface.json'), 'utf8')) as typeof metrics;
        const compare = (values: number[], expected: number[], label: string) => {
          assert.equal(values.length, expected.length, label);
          values.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) <= 0.125,
            `${name} ${label}: ${values} vs ${expected}`));
        };
        const geometry = (row: typeof metrics.rows[number]) => {
          const [leading, caret] = row.icons;
          return [row.height, row.glyph[0]! - row.x, row.glyph[1]! - row.y,
            leading!.x - row.x, leading!.y - row.y, leading!.width, leading!.height,
            caret!.x + caret!.width - row.x - row.width];
        };
        for (const re of [/^Running fixture/, /^Ran fixture/, /^Read files/, /^Edited a file/]) {
          const want = original.rows.find(row => re.test(row.text ?? '') && row.icons.length === 2);
          if (!want) continue;
          const actual = metrics.rows.find(row => re.test(row.text ?? '') && row.icons.length === 2);
          assert.ok(actual, 'Missing visual heading ' + re);
          if (name.endsWith('-open')) continue; // Caret rotation can still be in flight.
          compare(geometry(actual), geometry(want), 'glyph/label alignment for ' + re);
          assert.deepEqual(actual.icons.map(icon => [icon.viewBox, icon.paths]), want.icons.map(icon => [icon.viewBox, icon.paths]));
          compare(actual.icons[0]!.draw, want.icons[0]!.draw, 'visible SVG ink for ' + re);
        }
        const want = original.sidebar.find(spinner => spinner.width > 0);
        const actual = metrics.sidebar.find(spinner => spinner.width > 0);
        if (!narrow && name === 'reasoning-live') assert.ok(want && actual, 'Visible sidebar spinner in both desktop renderers');
        if (want && actual) {
          compare([actual.width, actual.height], [want.width, want.height], 'sidebar spinner slot');
          assert.deepEqual(actual.icons.map(icon => icon.paths), want.icons.map(icon => icon.paths));
        }
        if (name === 'reasoning-live') {
          compare([metrics.transcript.x, metrics.transcript.width], [original.transcript.x, original.transcript.width], 'scroll pane horizontal bounds');
          assert.equal(metrics.scrolling[0]?.hovered, original.scrolling[0]?.hovered, 'Same transcript hover state');
          assert.equal(metrics.scrolling[0]?.color, original.scrolling[0]?.color, 'Unhovered transcript scrollbar');
          if (motion) for (const animation of original.animations.filter(animation => animation.name.startsWith('_cadencedLoadingShimmer'))) {
            assert.ok(metrics.animations.some(actual => actual.name === animation.name && actual.timing?.duration === animation.timing?.duration),
              'Matching pinned shimmer keyframe ' + animation.name);
          }
        }
        if (name === 'command-hover') assert.equal(metrics.scrolling[0]?.color, original.scrolling[0]?.color, 'Hovered transcript scrollbar');
      }
      await snapshot(name);
    }
    notify('turn/started', { turn });
    say('visual-note', 'I am checking the fixture.', 'commentary');
    const note = transcript.getByText('I am checking the fixture.', { exact: true });
    await note.waitFor();
    const reasoning = { id: 'visual-thinking', type: 'reasoning', summary: ['**Running typecheck**'], content: [] };
    notify('item/started', { item: { ...reasoning, summary: [] } });
    notify('item/reasoning/summaryPartAdded', { itemId: reasoning.id, summaryIndex: 0 });
    notify('item/reasoning/summaryTextDelta', { itemId: reasoning.id, summaryIndex: 0, delta: reasoning.summary[0] });
    await transcript.getByText(/Running typecheck/).first().waitFor({ timeout: 6000 });
    await page.mouse.move((page.viewportSize()?.width ?? 390) / 2, 1);
    if (motion) await delay(750);
    await surface('reasoning-live');
    finish(reasoning);
    const read = { ...commandItem('visual-read', 'One line', root), command: 'cat README.md',
      commandActions: [{ type: 'read', name: 'README.md', path: join(root, 'README.md'), command: 'cat README.md' }] };
    finish(read);
    const command = { ...commandItem('visual-command', 'All checks passed', root), command: 'fixture-typecheck',
      commandActions: [{ type: 'unknown', command: 'fixture-typecheck' }] };
    notify('item/started', { item: { ...command, status: 'inProgress', exitCode: null, aggregatedOutput: null }, startedAtMs: Date.now() });
    const running = transcript.getByRole('button', { name: 'Running fixture-typecheck', exact: true }).first();
    await running.waitFor();
    await surface('command-live');
    if (!narrow) {
      await running.hover();
      await surface('command-hover');
    }
    notify('item/completed', { item: command, completedAtMs: Date.now() });
    turn.items.push(command);
    say('visual-group-note', 'The first two checks finished.', 'commentary');
    await transcript.getByText('The first two checks finished.', { exact: true }).waitFor();
    const group = transcript.getByRole('button', { name: /^Read files,?\s*ran a command$/i });
    await group.waitFor();
    await surface('read-run-group');
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    await transcript.getByText(/Read README.md/).first().waitFor();
    await surface('read-run-open');
    finish({ id: 'visual-edit', type: 'fileChange', status: 'completed',
      changes: [{ path: join(root, 'README.md'), kind: { type: 'update' }, diff: '+Fixture change' }] });
    finish({ id: 'visual-web', type: 'webSearch', query: 'fixture documentation',
      action: { type: 'search', query: 'fixture documentation', queries: ['fixture documentation'] }, results: null });
    say('visual-last-note', 'The edit and lookup finished.', 'commentary');
    await transcript.getByText('The edit and lookup finished.', { exact: true }).waitFor();
    await surface('edit-search-group');
    const editGroup = transcript.getByRole('button', { name: /^Edited a file,?\s*searched the web$/i });
    await editGroup.click();
    await surface('edit-search-open');
    return;
  }

  if (probeWorkSettlement) {
    const scenario = process.argv.find(arg => arg.startsWith('--work-case='))?.slice('--work-case='.length) ?? 'auto-open';
    assert.ok(['auto-open', 'manual-close', 'inspect-tool', 'inspect-result', 'inspect-result-close', 'read-earlier', 'user-stop'].includes(scenario));
    const inspectResult = scenario === 'inspect-result' || scenario === 'inspect-result-close';
    const manuallyFold = scenario === 'manual-close' || scenario === 'inspect-result-close';
    const expectOpen = inspectResult && !manuallyFold;
    const stopping = scenario === 'user-stop';
    notify('turn/started', { turn });
    const checked = commandItem('settle-check', 'Checked the disposable sample', root);
    const toolOutput = transcript.getByText('Checked the disposable sample', { exact: true });
    if (inspectResult) {
      notify('item/started', { item: { ...checked, status: 'inProgress', exitCode: null, aggregatedOutput: null }, startedAtMs: Date.now() });
      const running = transcript.getByRole('button', { name: 'Running fixture-command', exact: true }).first();
      await running.waitFor();
      notify('item/completed', { item: checked, completedAtMs: Date.now() });
      turn.items.push(checked);
      await running.press('Enter');
      await transcript.getByRole('button', { name: 'Ran fixture-command', exact: true }).last().click();
      await toolOutput.waitFor();
    } else finish(checked);
    if (scenario === 'inspect-tool') {
      const group = transcript.getByRole('button', { name: /^(?:Thinking|Ran fixture-command)$/ }).first();
      await group.click();
      assert.equal(await group.getAttribute('aria-expanded'), 'true');
    }
    const note = 'Read the current result. '.repeat(36).trimEnd();
    say('settle-progress', note, 'commentary');
    const working = transcript.getByRole('button', { name: /^Working/ }).last();
    const progress = transcript.getByText(note, { exact: true });
    await working.waitFor();
    await progress.waitFor();
    if (inspectResult) await toolOutput.waitFor();
    if (manuallyFold) {
      await working.click();
      await transcript.getByRole('button', { name: /^Working/, expanded: false }).last().waitFor();
    }
    if (scenario === 'read-earlier') {
      await transcript.evaluate(element => { element.scrollTop -= 180; });
      await transcript.getByRole('button', { name: 'Scroll to bottom', exact: true }).waitFor();
    }
    const before = await working.getAttribute('aria-expanded');
    const liveProgress = await progress.isVisible();
    assert.equal(liveProgress, true, 'The current progress stays visible even with Working folded.');
    if (manuallyFold) {
      await page.mouse.move(2, 2);
      // The reference's activity transition can continue after aria-expanded flips.
      await working.evaluate(() => new Promise<void>(done => setTimeout(done, 450)));
      await measure('work-live-folded', { working, progress });
      await snapshot('work-live-folded');
    }
    const answer = 'Reply: ' + scenario;
    say('settle-answer', answer, 'final_answer');
    await transcript.getByText(answer, { exact: true }).waitFor();
    const holdDetails = source && (stopping || expectOpen);
    let releaseDetails = () => {};
    const savedDetails = new Promise<void>(resolve => { releaseDetails = resolve; });
    const detailReads = fake.calls('thread/items/list').length;
    if (holdDetails) fake.handlers.set('thread/items/list', async params => {
      if (params.threadId === mainId && params.turnId === turn.id) await savedDetails;
      return fake.defaultResult('thread/items/list', params);
    });
    if (stopping) {
      await page.getByRole('button', { name: /^Stop(?: generating)?$/, exact: true }).last().click();
      assert.equal((await fake.waitForCall('turn/interrupt'))?.params.turnId, turn.id);
    }
    turn.status = stopping ? 'interrupted' : 'completed';
    turn.durationMs = 4_000;
    thread.status = { type: 'idle' };
    notify('turn/completed', { turn });
    // The summary's final reply is distinct from the notification's live copy.
    // Wait for that reply to prove that the summary was applied with details still held.
    const savedReply = holdDetails && expectOpen ? 'Reply from the saved summary.' : answer;
    turn.items.find(item => item.id === 'settle-answer')!.text = savedReply;
    notify('thread/status/changed', { status: thread.status });
    try {
      const label = stopping ? transcript.getByText(/^(?:Activity|You stopped(?: after .*)?)$/).last() :
        transcript.getByRole('button', { name: 'Worked for 4s', exact: true, expanded: expectOpen });
      await label.waitFor();
      if (holdDetails) assert.equal((await fake.waitForCall('thread/items/list', detailReads + 1))?.params.turnId, turn.id);
      await transcript.getByText(savedReply, { exact: true }).waitFor();
      await progress.waitFor({ state: expectOpen || stopping ? 'visible' : 'hidden' });
      if (!stopping) await toolOutput.waitFor({ state: 'hidden' });
      assert.equal(await transcript.getByText('Loading activity…', { exact: true }).isVisible(), false);
      const result = { scenario, before, liveProgress, label: (await label.textContent())?.trim(),
        after: await label.getAttribute('aria-expanded'), progress: await progress.isVisible(), output: await toolOutput.isVisible() };
      console.log(JSON.stringify(result));
      await writeFile(join(output, 'work-settlement.json'), JSON.stringify(result, null, 2) + '\n');
      if (holdDetails) turn.items.find(item => item.id === 'settle-progress')!.text = 'Saved activity from the full turn.';
    } finally {
      releaseDetails();
    }
    await snapshot('work-' + scenario);
    if (holdDetails) {
      await transcript.getByText('Saved activity from the full turn.', { exact: true }).waitFor();
      assert.equal(await progress.isVisible(), false);
    }
    await snapshot('work-' + scenario);
    return;
  }

  if (probeMcpApp) {
    let directRequests = 0;
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/workspace/fixture-csp-probe') directRequests++;
    });
    const appView = transcript.getByRole('region', { name: 'Fixture app', exact: true });
    const frame = appView.frameLocator('iframe');
    const byCall = () => fake.calls('mcpServer/tool/call');
    const reads = () => fake.calls('mcpServer/resource/read');
    const shell = { ...commandItem('before-app', 'Sample available', root), command: 'fixture-read-sample' };
    const call: ThreadItemSummary = {
      id: 'interactive-fixture', type: 'mcpToolCall', server: 'fixture', tool: 'inspect_sample', status: 'completed',
      arguments: { sample: 'Sample A' }, result: appResult, mcpAppResourceUri: appUri,
      mcpAppUi: { resourceUri: appUri, preferredModelDisplayMode: 'inline' }, error: null, durationMs: 21,
    };
    say('app-intro', 'Loading the interactive sample.', 'commentary');
    finish(shell);
    notify('item/started', { item: { ...call, result: null, status: 'inProgress' } });
    await transcript.getByText('Opening Fixture', { exact: true }).waitFor();
    await snapshot('app-running');
    notify('item/completed', { item: call });
    turn.items.push(call);
    if (source) {
      await frame.getByText('Sample A', { exact: true }).waitFor();
      assert.equal(await frame.locator('#sample').getAttribute('data-input'), 'Sample A');
      assert.equal(await appView.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
      await frame.getByRole('button', { name: 'Read sample details', exact: true }).click();
      await frame.getByText('Sample details loaded', { exact: true }).waitFor();
      assert.equal(byCall().length, 1);
      await frame.getByRole('button', { name: 'Request model-only tool', exact: true }).click();
      await frame.getByText('Tool is unavailable to this app', { exact: true }).waitFor();
      assert.equal(byCall().length, 1);
      await frame.locator('html').evaluate(async () => {
        let domBlocked = false;
        try { void parent.document.body; } catch { domBlocked = true; }
        if (!domBlocked) throw new Error('The frame can access the workspace document');
        try { await fetch('/api/workspace/fixture-csp-probe'); }
        catch { return; }
        throw new Error('The frame can make direct network requests');
      });
      assert.equal(directRequests, 0, 'The sandbox blocks the request before it reaches the host.');
      await page.evaluate(() => window.postMessage({ jsonrpc: '2.0', id: 55, method: 'tools/call',
        params: { name: 'read_sample_details', arguments: { sample: 'Sample A' } } }, location.origin));
      await appView.getByRole('button', { name: 'Show raw tool call output', exact: true }).focus();
      await appView.getByRole('button', { name: 'Show raw tool call output', exact: true }).press('Enter');
      await page.getByRole('dialog', { name: /Raw fixture\.inspect_sample/ }).waitFor();
      await snapshot('app-raw-result');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: /Raw fixture\.inspect_sample/ }).waitFor({ state: 'hidden' });
      assert.equal(byCall().length, 1, 'An unrelated window message does not run the app tool.');
    }
    await snapshot('app-result-before-answer');
    say('app-final', 'The sample is ready.', 'final_answer');
    turn.status = 'completed';
    turn.durationMs = 4_000;
    thread.status = { type: 'idle' };
    notify('turn/completed', { turn });
    notify('thread/status/changed', { status: thread.status });
    await transcript.getByText('The sample is ready.', { exact: true }).waitFor();
    const work = transcript.getByRole('button', { name: 'Worked for 4s', exact: true });
    await work.waitFor();
    if (source) {
      await frame.getByText('Sample details loaded', { exact: true }).waitFor();
      assert.equal(reads().length, 1, 'History summary retains the existing frame.');
    }
    await snapshot('app-finished');
    if (await work.getAttribute('aria-expanded') === 'false') await work.click();
    await transcript.getByText('Loading the interactive sample.', { exact: true }).waitFor();
    if (source) await frame.getByText('Sample details loaded', { exact: true }).waitFor();
    await snapshot('app-work-expanded');
    if (probeMcpAppTab) {
      const tabDraft = 'Keep the parent draft when opening the app.';
      await editor.fill(tabDraft);
      const openTab = transcript.getByRole('button', { name: 'Open app in tab', exact: true });
      const tab = page.getByRole('tab', { name: 'Fixture', exact: true, selected: true });
      const pane = page.getByRole('tabpanel', { name: 'Fixture', exact: true });
      const appFrame = pane.frameLocator('iframe');
      const exit = page.getByRole('button', { name: 'Exit full screen', exact: true });
      const enter = page.getByRole('button', { name: 'Enter full screen', exact: true });
      const right = (open: boolean) => page.getByRole('button', {
        name: source ? (open ? 'Close right sidebar' : 'Open right sidebar') : 'Toggle side panel', exact: true,
      });
      let finishCallback!: (value: { structuredContent: { detail: string } }) => void;
      const detailAfterDock = withoutAtomicMove ? 'Sample details loaded' : 'Sample details returned after docking';
      if (source && !withoutAtomicMove) {
        await frame.locator('body[data-display-mode="inline"]').waitFor();
        await appView.locator('iframe').evaluate(node => {
          const state = window as Window & { __mcpAppWindow?: Window | null };
          state.__mcpAppWindow = (node as HTMLIFrameElement).contentWindow;
        });
        tabToolReply = new Promise(resolve => { finishCallback = resolve; });
        await frame.getByRole('button', { name: 'Read sample details', exact: true }).click();
        await fake.waitForCall('mcpServer/tool/call', 2);
      }
      await openTab.focus();
      await paneSnapshot('app-tab-trigger');
      await openTab.press('Enter');
      await tab.waitFor();
      await exit.waitFor();
      await pane.waitFor();
      await paneSnapshot('app-tab-open');
      if (source && !withoutAtomicMove) {
        assert.equal(await pane.locator('iframe').evaluate(node =>
          (node as HTMLIFrameElement).contentWindow === (window as Window & { __mcpAppWindow?: Window | null }).__mcpAppWindow), true);
        await appFrame.locator('body[data-display-mode="fullscreen"]').waitFor();
        finishCallback({ structuredContent: { detail: detailAfterDock } });
        tabToolReply = undefined;
      } else if (source) {
        await appFrame.getByText('Sample A', { exact: true }).waitFor();
        assert.equal(await appFrame.locator('#detail').textContent(), '');
        await appFrame.getByRole('button', { name: 'Read sample details', exact: true }).click();
      }
      if (source) {
        await appFrame.getByText(detailAfterDock, { exact: true }).waitFor();
        assert.equal(await page.locator('iframe[src="/api/workspace/mcp-app-sandbox"]').count(), 1);
      }
      await exit.click();
      await enter.waitFor();
      if (!narrow) await openTab.waitFor();
      await paneSnapshot('app-tab-split');
      if (narrow && !source) {
        // In the pinned reference, the pane toggle is offscreen in a
        // phone-width split. Restore fullscreen using the reachable control.
        const toggleBox = await right(true).boundingBox();
        assert.ok(toggleBox && toggleBox.x >= 390, 'Record the reference split toolbar overflow.');
        await enter.click();
        await exit.waitFor();
      }
      await right(true).click();
      await tab.waitFor({ state: 'hidden' });
      await openTab.waitFor();
      await paneSnapshot('app-tab-hidden');
      assert.match(await editor.textContent() ?? '', new RegExp(tabDraft, 'u'));
      await right(false).click();
      await tab.waitFor();
      if (source) {
        await appFrame.getByText(detailAfterDock, { exact: true }).waitFor();
        await page.getByRole('button', { name: 'New tab', exact: true }).click();
        const otherTab = page.getByRole('tab', { name: 'New tab', exact: true });
        await otherTab.and(page.locator('[aria-selected="true"]')).waitFor();
        assert.equal(await pane.isVisible(), false);
        if (!narrow) {
          await otherTab.hover();
          const closeApp = page.getByRole('button', { name: 'Close Fixture tab', exact: true });
          assert.equal(await closeApp.evaluate(node => getComputedStyle(node).opacity), '0');
          await page.getByRole('tab', { name: 'Fixture', exact: true }).hover();
          assert.equal(await closeApp.evaluate(node => getComputedStyle(node).opacity), '1');
        }
        await otherTab.press('ArrowLeft');
        await tab.waitFor();
        await appFrame.getByText(detailAfterDock, { exact: true }).waitFor();
        await otherTab.click();
        await page.getByRole('button', { name: 'Close tab', exact: true }).click();
        await tab.waitFor();
      }
      await page.getByRole('button', { name: 'Close Fixture tab', exact: true }).click();
      await tab.waitFor({ state: 'hidden' });
      await openTab.waitFor();
      if (source) {
        await frame.locator('body[data-display-mode="inline"]').waitFor();
        if (withoutAtomicMove) {
          await frame.getByText('Sample A', { exact: true }).waitFor();
          assert.equal(await frame.locator('#detail').textContent(), '');
        } else await frame.getByText(detailAfterDock, { exact: true }).waitFor();
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open app in tab');
        assert.equal(reads().length, 1, 'A tab move does not fetch another copy of the resource.');
      }
      await paneSnapshot('app-tab-inline');
      assert.match(await editor.textContent() ?? '', new RegExp(tabDraft, 'u'));
      await editor.fill('');
    }
    if (source) {
      await work.click();
      await transcript.getByText('Loading the interactive sample.', { exact: true }).waitFor({ state: 'hidden' });
      await frame.getByText(probeMcpAppTab
        ? withoutAtomicMove ? 'Sample A' : 'Sample details returned after docking'
        : 'Sample details loaded', { exact: true }).waitFor();
      assert.equal(reads().length, 1, 'Toggling Work keeps the card and its input state.');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.reload({ waitUntil: 'commit' });
      await transcript.getByText('The sample is ready.', { exact: true }).waitFor();
      await work.click();
      await frame.getByText('Sample A', { exact: true }).waitFor();
      await snapshot('app-restored');
      assert.equal(reads().length, 2);
      // A separate live call exercises the failed resource and explicit retry.
      await editor.fill('Try another interactive sample.');
      await page.getByRole('button', { name: /^Send(?: message)?$/, exact: true }).click();
      const secondStart = await fake.waitForCall('turn/start', 2);
      assert.match(JSON.stringify(secondStart?.params.input), /Try another interactive sample/);
      const retryTurn = thread.turns.at(-1)!;
      assert.notEqual(retryTurn.id, turnId);
      const missing = { ...call, id: 'interactive-retry', server: 'retry_fixture' };
      retryTurn.items.push(missing);
      fake.broadcast({ method: 'item/completed', params: { threadId: mainId, turnId: retryTurn.id, item: missing } });
      const retryView = transcript.getByRole('region', { name: 'Retry fixture app', exact: true });
      await retryView.getByRole('alert').getByText('Couldn’t open Retry fixture', { exact: false }).waitFor();
      await retryView.getByText('Sample tool result', { exact: true }).waitFor();
      await snapshot('app-resource-failed');
      await retryView.getByRole('button', { name: 'Retry', exact: true }).click();
      await retryView.frameLocator('iframe').getByText('Sample A', { exact: true }).waitFor();
      await snapshot('app-resource-retry');
      assert.equal(reads().filter(call => call.params.server === 'retry_fixture').length, 2);
    } else {
      await transcript.getByRole('button', { name: 'Open app in tab', exact: true }).waitFor();
      assert.ok(reads().some(call => call.params.uri === appUri));
    }
    await writeFile(join(output, 'app-rpc-evidence.json'), JSON.stringify({ reads: reads(), tools: byCall() }, null, 2));
    return;
  }

  if (probeRepeatedMcp) {
    const call = (id: string, text: string): ThreadItemSummary => ({
      id, type: 'mcpToolCall', server: 'fixture', tool: 'inspect_sample', status: 'completed',
      arguments: { sample: id }, result: { content: [{ type: 'text', text }] }, error: null, durationMs: 15,
    });
    const first = call('mcp-first', 'First result from the same tool.');
    const second = call('mcp-second', 'Second result from the same tool.');
    finish(first);
    notify('item/started', { item: { ...second, status: 'inProgress', result: null }, startedAtMs: Date.now() });
    notify('item/mcpToolCall/progress', { itemId: second.id, message: 'Inspecting the second sample' });
    const title = transcript.getByRole('button', { name: 'Inspect sample', exact: true });
    await title.first().press('Enter');
    await title.nth(1).waitFor();
    const twoCalls = transcript.getByRole('button', { name: /^Inspect sample · 2 calls$/i });
    assert.equal(await twoCalls.count(), 0, 'An in-progress call does not merge with a finished one.');
    await snapshot('mcp-repeat-running');

    notify('item/completed', { item: second, completedAtMs: Date.now() });
    turn.items.push(second);
    const third = call('mcp-third', 'Third result from the same tool.');
    notify('item/started', { item: { ...third, status: 'inProgress', result: null }, startedAtMs: Date.now() });
    try { await twoCalls.waitFor(); }
    finally { await snapshot('mcp-repeat-folded'); }
    assert.equal(await twoCalls.getAttribute('aria-expanded'), 'false');
    await twoCalls.press('Enter');
    await title.nth(2).click();
    const secondResult = transcript.getByText('Second result from the same tool.', { exact: true });
    await secondResult.waitFor();
    await snapshot('mcp-repeat-inner');

    // A third result may join the expanded group. A separator and a failed
    // result must remain in chronological order on their own rows.
    notify('item/completed', { item: third, completedAtMs: Date.now() });
    turn.items.push(third);
    finish({ ...commandItem('mcp-separator', 'Separator output', root), command: 'fixture-repeat-boundary' });
    finish(call('mcp-separate', 'Result after a command.'));
    finish({ ...call('mcp-failed', ''), status: 'failed', result: null, error: { message: 'Fixture call failed.' } });
    finish({ ...call('mcp-other', 'Same tool on a different provider.'), server: 'other-fixture' });
    const note = 'The repeated tool fixture is complete.';
    say('mcp-repeat-note', note, 'commentary');
    await transcript.getByText(note, { exact: true }).waitFor();
    const threeCalls = transcript.getByRole('button', { name: /^Inspect sample · 3 calls$/i });
    await threeCalls.waitFor();
    assert.equal(await threeCalls.getAttribute('aria-expanded'), 'true', 'Growing the group preserves disclosure.');
    await secondResult.waitFor();
    assert.equal(await transcript.getByRole('button', { name: /^Inspect sample · \d+ calls$/i }).count(), 1);
    await assertOrder([threeCalls, transcript.getByRole('button', { name: 'Ran fixture-repeat-boundary', exact: true }),
      transcript.getByText(note, { exact: true })]);
    await snapshot('mcp-repeat-boundaries');
    const raw = transcript.getByRole('button', { name: 'Show raw tool call output', exact: true }).first();
    await raw.click();
    const modal = page.getByRole('dialog', { name: 'Raw fixture.inspect_sample tool call output', exact: true });
    const code = modal.locator('code').first();
    await code.waitFor();
    const rawText = (await code.textContent())!;
    const payload = JSON.parse(rawText);
    await writeFile(join(output, 'mcp-repeat-raw.json'), JSON.stringify(payload, null, 2) + '\n');
    await paneSnapshot('mcp-repeat-raw');
    await measure('mcp-repeat-raw-layout', { modal, heading: modal.getByRole('heading'), codeBlock: code.locator('..'), code });
    const tokens = await code.evaluate(element => {
      const styles: Record<string, string> = {};
      for (const span of element.querySelectorAll('span')) {
        const text = span.textContent?.trim() ?? '';
        if (text && text.length < 40) styles[text] = getComputedStyle(span).color;
      }
      return styles;
    });
    await writeFile(join(output, 'mcp-repeat-raw-colors.json'), JSON.stringify(tokens, null, 2) + '\n');
    assert.equal(payload.callId, second.id);
    assert.equal(payload.result.type, 'success');
    assert.deepEqual(payload.result.raw, second.result);
    await modal.getByRole('button', { name: /^Copy(?: code)?$/ }).click();
    if (source) {
      await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('"callId"'));
      assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), payload);
    } else await modal.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await secondResult.waitFor();
    if (source) assert.ok(await raw.evaluate(button => button === document.activeElement));
    await title.nth(4).click();
    await transcript.getByText(/Fixture call failed/).first().waitFor();
    await transcript.getByRole('button', { name: 'Show raw tool call output', exact: true }).last().click();
    await code.waitFor();
    const failure = JSON.parse((await code.textContent())!);
    assert.equal(failure.callId, 'mcp-failed');
    assert.deepEqual(failure.result, { type: 'error', kind: 'protocol', error: 'Fixture call failed.',
      rawError: { message: 'Fixture call failed.' } });
    await paneSnapshot('mcp-repeat-error-raw');
    await modal.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });

    const final = 'The repeated calls were recorded.';
    say('mcp-repeat-final', final, 'final_answer');
    turn.status = 'completed'; turn.durationMs = 42_000;
    thread.status = { type: 'idle' };
    notify('turn/completed', { turn });
    notify('thread/status/changed', { status: thread.status });
    const work = transcript.getByRole('button', { name: 'Worked for 42s', exact: true });
    await transcript.getByRole('button', { name: 'Worked for 42s', exact: true, expanded: true }).waitFor();
    await page.reload({ waitUntil: 'commit' });
    await transcript.getByText(final, { exact: true }).waitFor({ timeout: 25_000 });
    await work.press('Enter');
    const restoredGroup = transcript.getByRole('button', { name: /^Used Fixture.*Other Fixture.*ran a command/i });
    await restoredGroup.press('Enter');
    await threeCalls.waitFor();
    assert.equal(await threeCalls.getAttribute('aria-expanded'), 'false');
    await snapshot('mcp-repeat-restored');
    return;
  }

  if (probeGroupStates) {
    function streamNote(id: string, text: string) {
      const item = { ...agentItem(id, text), phase: 'commentary' };
      notify('item/started', { item: { ...item, text: '' } });
      notify('item/agentMessage/delta', { itemId: id, delta: text });
      notify('item/completed', { item });
      turn.items.push(item);
    }
    notify('turn/started', { turn });
    const stage = { ...commandItem('stage-one', 'First fixture tool finished.', root), command: 'fixture-stage-one',
      commandActions: [{ type: 'unknown', command: 'fixture-stage-one' }] };
    notify('item/started', { item: { ...stage, status: 'inProgress', exitCode: null, aggregatedOutput: null }, startedAtMs: Date.now() });
    const running = transcript.getByRole('button', { name: 'Running fixture-stage-one', exact: true }).first();
    await running.waitFor();
    await snapshot('activity-stage-running');
    notify('item/completed', { item: stage, completedAtMs: Date.now() });
    turn.items.push(stage);
    await running.press('Enter');
    const stageDisclosure = transcript.getByRole('button', { name: 'Ran fixture-stage-one', exact: true }).last();
    await stageDisclosure.click();
    const firstOutput = transcript.getByText('First fixture tool finished.', { exact: true });
    await firstOutput.waitFor();
    assert.equal(await running.getAttribute('aria-expanded'), 'true');
    await snapshot('activity-stage-completed');

    const nextStage = { ...commandItem('stage-two', 'Second fixture tool finished.', root), command: 'fixture-stage-two',
      commandActions: [{ type: 'unknown', command: 'fixture-stage-two' }] };
    notify('item/started', { item: { ...nextStage, status: 'inProgress', exitCode: null, aggregatedOutput: null }, startedAtMs: Date.now() });
    const nextRunning = transcript.getByRole('button', { name: 'Running fixture-stage-two', exact: true }).first();
    await nextRunning.waitFor();
    assert.equal(await nextRunning.getAttribute('aria-expanded'), 'true');
    await firstOutput.waitFor();
    notify('item/completed', { item: nextStage, completedAtMs: Date.now() });
    turn.items.push(nextStage);
    await transcript.getByRole('button', { name: 'Ran fixture-stage-two', exact: true }).last().waitFor();
    await snapshot('activity-stage-next-completed');

    const summaryText = 'The fixture commands have finished.';
    for (let index = 1; index <= 12; index++) {
      const command = 'fixture-log-' + index;
      finish({ ...commandItem(command, 'Log output ' + index, root), command,
        commandActions: [{ type: 'unknown', command }] });
    }
    streamNote('stage-commentary', summaryText);
    const summary = transcript.getByText(summaryText, { exact: true });
    await summary.waitFor();
    const thinking = transcript.getByRole('button', { name: 'Thinking', exact: true });
    await thinking.waitFor();
    assert.equal(await thinking.getAttribute('aria-expanded'), 'true');
    await transcript.getByRole('button', { name: /^Working for \d+秒$/ }).waitFor();
    await firstOutput.waitFor();
    await assertOrder([firstOutput, summary]);
    await snapshot('activity-stage-commentary');
    const tailButton = page.getByRole('button', { name: 'Ran fixture-log-12', exact: true });
    const tail = transcript.getByRole('button', { name: 'Ran fixture-log-12', exact: true });
    await tail.waitFor();
    const scrollClass = source ? '.yard-source-live-activity' : '.vertical-scroll-fade-mask';
    const scope = transcript.locator(scrollClass).filter({ has: tailButton });
    const size = await scope.evaluate(element => {
      const { overflowY, overflowX } = getComputedStyle(element);
      return { height: element.clientHeight, contentHeight: element.scrollHeight, overflowY, overflowX };
    });
    assert.equal(size.height, 224, 'The expanded tool group uses a 224px viewport.');
    assert.ok(size.contentHeight > size.height);
    assert.equal(size.overflowX, 'hidden');
    assert.equal(size.overflowY, 'auto');
    await editor.fill('Draft after tools');
    await tail.scrollIntoViewIfNeeded();
    assert.ok(await scope.evaluate(element => element.scrollTop > 0), 'The bottom result is reached by scrolling the group.');
    await tail.click();
    const lastOutput = transcript.getByText('Log output 12', { exact: true });
    await lastOutput.scrollIntoViewIfNeeded();
    assert.equal(await editor.evaluate(element => element.textContent), 'Draft after tools');
    await snapshot('activity-stage-group-scrolled');
    await thinking.click();
    const followUp = { ...commandItem('stage-followup', 'Follow-up complete.', root), command: 'fixture-follow-up',
      commandActions: [{ type: 'unknown', command: 'fixture-follow-up' }] };
    notify('item/started', { item: { ...followUp, status: 'inProgress', exitCode: null, aggregatedOutput: null }, startedAtMs: Date.now() });
    await transcript.getByRole('button', { name: 'Running fixture-follow-up', exact: true }).waitFor();
    await transcript.getByRole('button', { name: 'Ran commands', exact: true }).waitFor();
    await snapshot('activity-stage-next-group');
    notify('item/completed', { item: followUp, completedAtMs: Date.now() });
    turn.items.push(followUp);
    const followupNote = 'The follow-up check is finished.';
    streamNote('stage-followup-note', followupNote);
    await transcript.getByText(followupNote, { exact: true }).waitFor();
    await thinking.waitFor();
    assert.equal(await thinking.getAttribute('aria-expanded'), 'false');
    await snapshot('activity-stage-later-commentary');
    const final = 'The fixture tool results are ready.';
    notify('item/started', { item: { ...agentItem('stage-final', ''), phase: 'final_answer' } });
    notify('item/agentMessage/delta', { itemId: 'stage-final', delta: final });
    const finalAnswer = transcript.getByText(final, { exact: true });
    await finalAnswer.waitFor();
    await snapshot('activity-stage-streamed-answer');

    const opening = 'const sample = "' + 'fixture'.repeat(55) + '";';
    const ending = '\nconsole.log("<span data-code-fixture>sample</span>");';
    const firstDelta = '\n\n```ts\n' + opening, lastDelta = ending + '\n```';
    notify('item/agentMessage/delta', { itemId: 'stage-final', delta: firstDelta });
    const block = transcript.locator('[data-code-block]');
    const codeSource = block.locator('[data-code-block-source]');
    const code = codeSource.locator('code');
    const keyword = code.locator('.hljs-keyword').filter({ hasText: 'const' });
    const wrap = block.getByRole('button', { name: 'Enable word wrap' });
    const unWrap = block.getByRole('button', { name: 'Disable word wrap' });
    const copyCode = block.getByRole('button', { name: 'Copy code', exact: true });
    const scrollStages: unknown[] = [];
    async function recordScroll(phase: string) {
      scrollStages.push(await transcript.evaluate(async (element, phase) => {
        await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        const bounds = (node: Element | null | undefined) => {
          if (!node) return null;
          const { top, height } = node.getBoundingClientRect();
          return { top, height };
        };
        const work = [...element.querySelectorAll('button[aria-expanded]')].find(node => /^Work(?:ed|ing)\b/.test(node.textContent ?? ''));
        const code = element.querySelector('[data-code-block]');
        const prompt = [...element.querySelectorAll('[data-user-message-bubble]')].at(-1);
        const jump = element.querySelector('button[aria-label="Scroll to bottom"]');
        return { phase, top: element.scrollTop, max: element.scrollHeight - element.clientHeight, viewport: bounds(element),
          prompt: bounds(prompt), code: bounds(code), work: bounds(work), expanded: work?.getAttribute('aria-expanded'),
          focused: document.activeElement?.getAttribute('aria-label'), jump: bounds(jump) };
      }, phase));
    }
    await keyword.waitFor();
    assert.equal(await copyCode.count(), 0, 'Copy is hidden while the streamed code fence is open.');
    assert.ok(await codeSource.evaluate(element => element.scrollWidth > element.clientWidth));
    await wrap.click();
    await unWrap.waitFor();
    assert.ok(await codeSource.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await snapshot('activity-stage-streaming-code');
    const latest = transcript.getByRole('button', { name: 'Scroll to bottom', exact: true });
    await transcript.evaluate(element => { element.scrollTop -= 180; });
    await latest.waitFor();
    const readingTop = await transcript.evaluate(element => element.scrollTop);
    notify('item/agentMessage/delta', { itemId: 'stage-final', delta: lastDelta });
    await code.locator('.hljs-string').filter({ hasText: '<span data-code-fixture>' }).waitFor();
    assert.equal(await code.locator('[data-code-fixture]').count(), 0);
    await unWrap.waitFor();
    assert.ok(Math.abs(await transcript.evaluate(element => element.scrollTop) - readingTop) <= 1,
      'New text does not pull the reader away from earlier activity.');
    await snapshot('activity-stage-reading-tools');
    await latest.click();
    await latest.waitFor({ state: 'hidden' });
    await recordScroll('returned-to-bottom');
    await copyCode.click();
    const expectedCode = opening + ending;
    await page.waitForFunction(async expected => (await navigator.clipboard.readText()).trimEnd() === expected, expectedCode);
    await recordScroll('copied');
    const answer = { ...agentItem('stage-final', final + firstDelta + lastDelta), phase: 'final_answer' };
    notify('item/completed', { item: answer });
    turn.items.push(answer);
    turn.status = 'completed'; turn.durationMs = 42_000;
    thread.status = { type: 'idle' };
    notify('turn/completed', { turn });
    notify('thread/status/changed', { status: thread.status });
    const completed = transcript.getByRole('button', { name: 'Worked for 42s', exact: true, expanded: true });
    await completed.waitFor();
    await summary.waitFor();
    await transcript.getByRole('button', { name: 'Ran commands', exact: true, expanded: false }).waitFor();
    await recordScroll('turn-completed');
    // Capture the automatic transition before making any manual disclosure changes.
    await snapshot('activity-stage-turn-complete');
    await completed.click();
    await finalAnswer.waitFor();
    await unWrap.waitFor();
    await keyword.waitFor();
    await summary.waitFor({ state: 'hidden' });
    assert.equal(await editor.evaluate(element => element.textContent), 'Draft after tools');
    await recordScroll('work-manually-collapsed');
    await writeFile(join(output, 'activity-stage-scroll.json'), JSON.stringify(scrollStages, null, 2) + '\n');
    await snapshot('activity-stage-settled-answer');
    await measure('activity-stage-code-layout', { block, keyword, codeSource, wrap: unWrap, copy: copyCode });
    await page.reload({ waitUntil: 'commit' });
    await keyword.waitFor({ timeout: 20_000 });
    assert.equal((await code.textContent())?.trimEnd(), expectedCode);
    assert.equal(await editor.evaluate(element => element.textContent), 'Draft after tools');
    await snapshot('activity-stage-code-restored');
    return;
  }

  const read = { ...commandItem('read-a', 'Header and two rows', root), command: 'cat sample.md',
    commandActions: [{ type: 'read', command: 'cat sample.md', name: 'sample.md', path: join(root, 'sample.md') }] };
  say('intro', 'Reading the sample and checking the tools.', 'commentary');
  finish(read);
  const command = { ...commandItem('run-b', 'Sample check passed', root), command: 'fixture-check' };
  const mcp = { id: 'mcp-a', type: 'mcpToolCall', server: 'fixture', tool: 'inspect_sample', status: 'completed',
    arguments: { sample: 2 }, result: { content: [{ type: 'text', text: 'MCP inspected two rows.' }], structuredContent: { ready: true } }, error: null };
  const dynamic = { id: 'dynamic-a', type: 'dynamicToolCall', namespace: 'fixture_tools', tool: 'verify_sample',
    status: 'failed', success: false, arguments: { template: 'sample' }, contentItems: [{ type: 'inputText', text: 'Fixture verification failed.' }] };
  finish(command);
  notify('item/started', { item: { ...mcp, status: 'inProgress', result: null } });
  notify('item/mcpToolCall/progress', { itemId: mcp.id, message: 'Comparing rows' });
  await transcript.getByText('Reading the sample and checking the tools.', { exact: true }).waitFor();
  const running = transcript.getByRole('button', { name: 'Inspect sample', exact: true }).first();
  await running.waitFor();
  assert.equal(await transcript.getByRole('button', { name: /^Used Fixture integration/ }).count(), 0);
  await snapshot('mixed-running');
  if (!narrow) {
    await running.hover();
    await snapshot('mixed-running-hover');
  }
  await running.click();
  const shell = transcript.getByRole('button', { name: 'Ran fixture-check', exact: true });
  await shell.waitFor();
  await snapshot('mixed-running-open');
  if (probePresentation) {
    await shell.click();
    const outputText = transcript.getByText('Sample check passed', { exact: true });
    await outputText.waitFor();
    if (!narrow) await outputText.hover();
    await snapshot('shell-success');
    await measure('shell-success', { output: outputText, command: transcript.getByRole('button', { name: '$ fixture-check', exact: true }),
      disclosure: transcript.getByRole('button', { name: 'Ran command', exact: true }) });
    if (source) {
      const shellCard = transcript.getByRole('region', { name: 'Shell', exact: true });
      const copyOutput = shellCard.getByRole('button', { name: 'Copy output', exact: true });
      const copyCommand = shellCard.getByRole('button', { name: 'Copy command', exact: true });
      if (narrow) {
        const opacity = (button: Locator) => button.evaluate(element => getComputedStyle(element).opacity);
        assert.equal(await opacity(copyOutput), '0');
        assert.equal(await opacity(copyCommand), '0');
        await shellCard.getByRole('region', { name: 'Command output', exact: true }).focus();
        assert.equal(await opacity(copyOutput), '1', 'Output copy is revealed on keyboard focus.');
        assert.equal(await opacity(copyCommand), '0');
      }
      await copyOutput.click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Sample check passed');
      await copyCommand.click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'fixture-check');
    }
    await transcript.getByRole('button', { name: 'Ran command', exact: true }).click();
  }
  if (source) {
    await transcript.getByRole('button', { name: 'Inspect sample', exact: true }).last().click();
    await transcript.getByRole('status').filter({ hasText: 'Comparing rows' }).waitFor();
  }
  notify('item/completed', { item: mcp }); turn.items.push(mcp);
  finish(dynamic);
  finish({ id: 'search-a', type: 'webSearch', query: 'fixture sample reference',
    action: { type: 'search', query: 'fixture sample reference', queries: ['fixture sample reference'] }, results: null });
  if (probeSources) {
    finish({ id: 'search-b', type: 'webSearch', query: 'second reference',
      action: { type: 'search', query: null, queries: ['fixture sample reference', 'second reference'] }, results: null });
    finish({ id: 'web-open', type: 'webSearch', query: '', action: { type: 'openPage', url: 'https://example.test/sample' }, results: null });
    finish({ id: 'web-find', type: 'webSearch', query: '', action: { type: 'findInPage', url: 'https://example.test/sample', pattern: 'reference' }, results: null });
    finish({ ...mcp, id: 'mcp-b', arguments: { sample: 3 }, result: { content: [{ type: 'text', text: 'MCP inspected three rows.' }] } });
  }
  say('delegate', 'The main tools are done; handing off the check.', 'commentary');
  const delegated = transcript.getByText('The main tools are done; handing off the check.', { exact: true });
  await delegated.waitFor();
  const completedGroup = transcript.getByRole('button', { name: /^Used Fixture integration.*read files.*ran a command.*searched the web.*verify sample/i });
  const group = completedGroup.or(transcript.getByRole('button', { name: 'Thinking', exact: true })).first();
  await group.waitFor();
  if (source && !probeSources) {
    assert.equal(await group.getAttribute('aria-expanded'), 'true', 'Changing the active caption preserves the disclosure.');
    await transcript.getByText('MCP inspected two rows.', { exact: true }).waitFor();
    const verify = transcript.getByRole('button', { name: 'Verify sample', exact: true });
    await verify.click();
    await transcript.getByText('Fixture verification failed.', { exact: true }).waitFor();
    await snapshot('tool-result-detail');
    await verify.click();
    await transcript.getByRole('button', { name: 'Inspect sample', exact: true }).click();
  }
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  await transcript.getByText('Searched the web for fixture sample reference', { exact: true }).waitFor();
  await snapshot('mixed-finished-open');
  await group.click();
  await assertOrder([transcript.getByText('Reading the sample and checking the tools.', { exact: true }), group, delegated]);
  await snapshot('mixed-finished');

  const agent = { id: 'agent-a', type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: mainId,
    status: 'completed', receiverThreadIds: [childId], prompt: 'Review the sample table.',
    agentsStates: { [childId]: { status: 'running', message: null } }, model: 'fixture-model', reasoningEffort: 'medium' };
  finish(agent);
  const wait = { ...agent, id: 'agent-wait', tool: 'wait', status: 'inProgress', prompt: null };
  notify('item/started', { item: wait });
  say('partial-answer', 'The sample contains two rows.', 'partial_answer');
  const partial = transcript.getByText('The sample contains two rows.', { exact: true });
  const created = transcript.getByRole('button', { name: 'Created an agent', exact: true });
  await partial.waitFor();
  await created.waitFor();
  await assertOrder([delegated, created, partial]);
  await snapshot('agent-waiting');
  const finalWait = { ...wait, status: 'completed', agentsStates: { [childId]: { status: 'completed', message: 'Both rows checked.' } } };
  notify('item/completed', { item: finalWait }); turn.items.push(finalWait);
  say('last-progress', 'The child check finished.', 'commentary');
  const lastCommand = { ...command, id: 'last-command', command: 'fixture-final-check', aggregatedOutput: 'Final sample check passed' };
  if (probePresentation) {
    const started = { ...lastCommand, command: "/bin/bash -lc 'fixture-final-check'", status: 'inProgress', exitCode: null, aggregatedOutput: '' };
    notify('item/started', { item: started });
    const activeCommand = transcript.getByRole('button', { name: /^Running .*fixture-final-check/ }).last();
    await activeCommand.click();
    await transcript.getByRole('button', { name: /^Running (?:command|.*fixture-final-check)/ }).last().click();
    notify('item/commandExecution/outputDelta', { itemId: started.id, delta: 'Checking the output…' });
    const streamed = transcript.getByText('Checking the output…', { exact: true });
    await streamed.waitFor();
    if (!narrow) await streamed.hover();
    await snapshot('shell-stream');
    if (source) {
      const longDelta = Array.from({ length: 30 }, (_, index) => '\nFixture log line ' + (index + 1)).join('');
      notify('item/commandExecution/outputDelta', { itemId: started.id, delta: longDelta });
      const scroll = transcript.getByRole('region', { name: 'Command output', exact: true });
      await scroll.getByText(/Fixture log line 30/).waitFor();
      assert.ok(await scroll.evaluate(element => element.clientHeight <= 144 && element.scrollHeight > element.clientHeight));
      assert.equal(await scroll.evaluate(element => element.scrollTop), 0, 'The newest log lines start in view.');
    }
    const failedCommand = { ...started, status: 'failed', exitCode: 2, aggregatedOutput: 'Fixture check failed' };
    notify('item/completed', { item: failedCommand });
    turn.items.push(failedCommand);
    await transcript.getByText('Fixture check failed', { exact: true }).waitFor();
    await transcript.getByText('Exit code 2', { exact: true }).waitFor();
    await snapshot('shell-failed');
    const foldCommand = transcript.getByRole('button', { name: 'Ran command', exact: true });
    finish({ ...read, id: 'later-read' });
    if (source) {
      await transcript.getByRole('button', { name: /^Read files, ran a command$/i }).waitFor();
      assert.equal(await foldCommand.getAttribute('aria-expanded'), 'true', 'A second tool joining does not close the output.');
      await transcript.getByText('Exit code 2', { exact: true }).waitFor();
      await snapshot('shell-joined');
    }
    await foldCommand.click();
  } else finish(lastCommand);
  say('end', 'The tool fixture is complete.', 'final_answer');
  const answer = transcript.getByText('The tool fixture is complete.', { exact: true });
  await answer.waitFor();
  await assertOrder([partial, transcript.getByText('The child check finished.', { exact: true }), answer]);
  await snapshot('before-completion');
  turn.status = 'completed';
  turn.durationMs = 42_000;
  thread.status = { type: 'idle' };
  notify('turn/completed', { turn });
  notify('thread/status/changed', { status: thread.status });
  const work = transcript.getByRole('button', { name: 'Worked for 42s', exact: true });
  await work.waitFor();
  const retained = await work.getAttribute('aria-expanded') === 'true';
  if (source) assert.ok(retained, 'Work stays expanded after inspecting a tool result.');
  if ((source || probePresentation) && retained) {
    await snapshot('completed-work-retained');
    await work.click();
  }
  await partial.waitFor({ state: 'hidden' });
  assert.ok(await answer.isVisible());
  await snapshot('completed');
  if (probePresentation) {
    if (!narrow) await page.locator('[data-user-message-bubble]').getByText('Inspect the tool fixture.').hover();
    await snapshot('message-controls');
    await measure('message-controls', { prompt: page.locator('[data-user-message-bubble]').last(),
      copy: transcript.getByRole('button', { name: 'Copy message', exact: true }),
      edit: transcript.getByRole('button', { name: 'Edit message', exact: true }) });
    if (source) {
      const controls = transcript.locator('.yard-source-user-turn .yard-source-message-actions');
      const time = controls.locator('time');
      assert.equal(await time.getAttribute('datetime'), new Date(turn.startedAt! * 1000).toISOString());
      assert.equal(await controls.evaluate(element => getComputedStyle(element).opacity), '1');
      assert.equal(await time.evaluate(element => getComputedStyle(element).opacity), narrow ? '0' : '1');
      if (narrow) {
        const box = (await transcript.boundingBox())!;
        assert.equal(box.x, 26);
        assert.equal(box.width, 338);
      }
    }
  }
  if (probeSources) {
    const summaryToggle = page.getByRole('button', { name: /^(?:Toggle )?Summary$/i });
    const viewAll = page.getByRole('button', { name: 'View all', exact: true });
    if (!await viewAll.isVisible()) await summaryToggle.click();
    await viewAll.waitFor();
    await paneSnapshot('sources-summary');
    const addSource = page.getByRole('button', { name: 'Attach files or connect apps', exact: true });
    await addSource.click();
    await paneSnapshot('sources-add');
    const attach = page.getByRole('menuitem', { name: 'Attach files or folders', exact: true });
    await attach.waitFor();
    const plugins = page.getByRole('menuitem', { name: 'Use plugins', exact: true });
    await plugins.click();
    const pluginSearch = page.getByPlaceholder('Search plugins…');
    await pluginSearch.waitFor();
    if (source) {
      const sample = page.getByRole('menuitem', { name: 'Sample Inspector', exact: true });
      await sample.waitFor();
      assert.equal(await page.getByRole('menuitem', { name: 'Hidden Fixture', exact: true }).count(), 0);
      await pluginSearch.fill('nonexistent');
      await page.getByRole('status').filter({ hasText: 'No results' }).waitFor();
      await pluginSearch.fill('Sample');
      await sample.waitFor();
    }
    await paneSnapshot('sources-plugins');
    await page.keyboard.press('Escape');
    if (await attach.isVisible()) await page.keyboard.press('Escape');
    if (!await viewAll.isVisible()) await summaryToggle.click();
    await viewAll.click();
    await paneSnapshot('sources-pane-opening');
    const searched = page.getByRole('button', { name: 'Searched 3 times', exact: true });
    await searched.waitFor();
    if (!source && narrow && await viewAll.isVisible()) {
      // The pinned narrow summary stays above the new tab until an outside tap.
      await page.touchscreen.tap(375, 394);
      await viewAll.waitFor({ state: 'hidden' });
    }
    await paneSnapshot('sources-pane');
    await searched.click();
    await page.getByText('second reference', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Opened one page', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect sample 2 times', exact: true }).click();
    await page.getByText('MCP inspected three rows.', { exact: true }).waitFor();
    await paneSnapshot('sources-expanded');
    const raw = page.getByRole('button', { name: 'Show raw tool call output', exact: true });
    assert.equal(await raw.count(), 2);
    await raw.last().click();
    const rawDialog = page.getByRole('dialog', { name: 'Raw fixture.inspect_sample tool call output', exact: true });
    await rawDialog.waitFor();
    await rawDialog.getByText(/MCP inspected two rows/).first().waitFor();
    if (source) {
      await rawDialog.getByRole('button', { name: 'Copy code', exact: true }).click();
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /"callId": "mcp-a"/);
    }
    await paneSnapshot('sources-raw');
    await page.keyboard.press('Escape');
    await rawDialog.waitFor({ state: 'hidden' });
    const reads = () => fake.calls('thread/items/list').filter(call => call.params.threadId === mainId && call.params.turnId === turnId).length;
    const beforeReload = reads();
    if (source) {
      await editor.fill('Keep the parent draft.');
      await page.getByRole('button', { name: 'example.test/sample', exact: true }).click();
      await page.frameLocator('iframe[title="网页内容"]').getByRole('heading', { name: 'Verified source document' }).waitFor();
      await paneSnapshot('sources-browser');
      await page.getByRole('tab', { name: 'Sources', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Opened one page', exact: true }).getAttribute('aria-expanded'), 'true');
      assert.equal(await editor.innerText(), 'Keep the parent draft.');
    }
    await page.reload({ waitUntil: 'commit' });
    await editor.waitFor({ timeout: 25_000 });
    await paneSnapshot('sources-after-reload');
    if (source) {
      assert.equal(reads(), beforeReload, 'Sources does not eagerly fetch collapsed activity.');
      assert.equal(await editor.innerText(), 'Keep the parent draft.');
      assert.equal(await viewAll.isVisible(), false);
      await work.click();
      if (!await viewAll.isVisible() && await summaryToggle.getAttribute('aria-expanded') === 'false') await summaryToggle.click();
      await viewAll.waitFor();
      assert.ok(reads() > beforeReload, 'Sources gets the activity loaded by Work.');

      // A real file chooser, upload, and turn submission, with no remote model/provider.
      await addSource.click();
      const fileChooser = page.waitForEvent('filechooser');
      await attach.click();
      await (await fileChooser).setFiles({
        name: 'sources-note.md', mimeType: 'text/markdown', buffer: Buffer.from('Fixture attachment contents.'),
      });
      await page.getByRole('link', { name: 'sources-note.md', exact: true }).waitFor();
      await addSource.click();
      await plugins.click();
      await page.getByRole('menuitem', { name: 'Sample Inspector', exact: true }).click();
      await editor.locator('[plugin-mention-path="plugin://sample-inspector@fixture"]').waitFor();
      const sendCount = fake.calls('turn/start').length;
      await page.getByRole('button', { name: /^Send(?: message)?$/, exact: true }).click();
      await fake.waitForCall('turn/start', sendCount + 1);
      const latest = thread.turns.at(-1)!;
      assert.notEqual(latest.id, turnId);
      const input = fake.calls('turn/start').at(-1)!.params.input as { type: string; text: string }[];
      assert.match(input[0]!.text, /sources-note\.md: \/[^\n]+\/sources-note\.md/);
      assert.match(input[0]!.text, /\[@Sample Inspector\]\(plugin:\/\/sample-inspector@fixture\)/);
      latest.status = 'completed';
      thread.status = { type: 'idle' };
      notify('turn/completed', { turnId: latest.id, turn: latest });
      notify('thread/status/changed', { status: thread.status });
      const sourceFile = page.getByRole('list', { name: 'Sources', exact: true }).getByRole('button', { name: 'sources-note.md', exact: true });
      if (!await sourceFile.isVisible() && await summaryToggle.getAttribute('aria-expanded') === 'false') await summaryToggle.click();
      await sourceFile.click();
      await page.getByText('Fixture attachment contents.', { exact: true }).waitFor();
      assert.ok(await page.getByRole('link', { name: 'Download output', exact: true }).isVisible());
      await paneSnapshot('sources-attachment');
      await page.getByRole('button', { name: 'Close tab', exact: true }).click();
      if (preview) {
        if (!await viewAll.isVisible() && await summaryToggle.getAttribute('aria-expanded') === 'false') await summaryToggle.click();
        await viewAll.click();
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    }
  } else {
    await work.scrollIntoViewIfNeeded();
    const beforeOpen = (await work.boundingBox())!.y;
    await work.click();
    await delegated.waitFor();
    await partial.waitFor();
    if (source) assert.ok(Math.abs((await work.boundingBox())!.y - beforeOpen) <= 1, 'Opening Work keeps the reading position.');
    await snapshot('work-open');
    const reads = () => fake.calls('thread/items/list').filter(call => call.params.threadId === mainId && call.params.turnId === turnId).length;
    const beforeReload = reads();
    await page.reload({ waitUntil: 'commit' });
    await answer.waitFor({ timeout: 25_000 });
    await work.waitFor();
    if (source) assert.equal(reads(), beforeReload, 'Closed historical activity is not fetched eagerly.');
    await work.click();
    await partial.waitFor();
    if (source) assert.ok(reads() > beforeReload, 'Reopening reads the persisted, complete timeline.');
    await assertOrder([delegated, created, partial, answer]);
    await snapshot('history-reopened');

    const name = transcript.getByRole('button', { name: 'Atlas', exact: true });
    await editor.fill('Keep this draft in the parent.');
    await name.click();
    const childTranscript = page.getByText('The child checked both rows.', { exact: true });
    await childTranscript.waitFor();
    await paneSnapshot('agent-pane');
    if (source) {
      await page.getByRole('button', { name: 'Close tab', exact: true }).click();
      await answer.waitFor();
      assert.equal(await editor.innerText(), 'Keep this draft in the parent.');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, 'Workspace has no horizontal scroll on the test viewport.');
    }
  }
}

try {
  const route = '/local/' + mainId;
  const url = app.url + '/?initialRoute=' + encodeURIComponent(route);
  await verifyTimeline(url);
  assert.deepEqual(errors, []);
  passed = true;
  if (preview) {
    console.log('PREVIEW_URL=' + url);
    await delay(45 * 60_000);
  }
} catch (error) {
  await paneSnapshot('error').catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ renderer: source ? 'React/TypeScript' : '26.1013.40934',
    backend: 'fixture on 0.169.1 protocol', passed, snapshots, errors }, null, 2) + '\n');
  await browser.close();
  await app.close();
  await fake.close();
  await rm(root, { recursive: true, force: true });
}
