// Use the heavy-browser lock. All accounts, projects and conversations are disposable.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContextOptions, Locator, Page } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { rendererAssets } from '../src/native/renderer-assets.ts';
import { agentItem, commandItem, createFakeCodex, fixtureThread, fixtureTurn } from '../test/fake-codex.ts';

const editorSelector = '#root [data-codex-composer="true"][contenteditable="true"]';
const rowSelector = '#app-shell-sidebar [data-app-action-sidebar-thread-row]:visible';
const sidebarToggle = '[data-app-shell-sidebar-trigger]:visible';
const output = resolve(process.env.AGENTS_WORKSPACE_STYLE_EVIDENCE ?? '.local/workspace-style');
const conversation = 'Workspace parity conversation';
const answer = 'Workspace parity answer.';
const draft = 'Workspace parity draft';
const savedDraft = 'Restored workspace draft';
const attachment = 'workspace-fixture.txt';
const date = new Date('2026-11-18T12:00:00Z');
const firstThreadId = '00000000-0000-4000-8000-000000000001';
const probeOutputs = process.argv.includes('--probe-outputs');
const probeToolbar = process.argv.includes('--probe-toolbar');
const probeAttachments = process.argv.includes('--probe-attachments');
const probeHeader = process.argv.includes('--probe-header');
const probeMobileSidebar = process.argv.includes('--probe-mobile-sidebar');
const probeSidebarActions = process.argv.includes('--probe-sidebar-actions');
const probeProjectHover = process.argv.includes('--probe-project-hover');
const probeProjectMarker = process.argv.includes('--probe-project-marker');
const probeProjectOperations = process.argv.includes('--probe-project-operations');
const probeProjectTouch = process.argv.includes('--probe-project-touch');
const probeApproval = process.argv.includes('--probe-approval');
const probeInputRequests = process.argv.includes('--probe-input-requests');
const probeExternalRequests = process.argv.includes('--probe-external-requests');
const probeMcpHistory = process.argv.includes('--probe-mcp-history');
const probeMcpConfirmation = probeMcpHistory || process.argv.includes('--probe-mcp-confirmation');
const probeMessages = process.argv.includes('--probe-messages');
const probeActivity = process.argv.includes('--probe-activity');
const probeActivityStream = process.argv.includes('--probe-activity-stream');
const probeProfile = process.argv.includes('--probe-profile');
const probeTurnPresentation = process.argv.includes('--probe-turn-presentation');
const previewTurn = process.argv.includes('--preview-turn');
assert.ok(!previewTurn || probeTurnPresentation && process.argv.includes('--candidate-only'), 'Use --preview-turn with the candidate turn probe.');
const probeProduct = process.argv.includes('--probe-product');
const probeToolRoutes = process.argv.includes('--probe-tool-routes');
const probeMessageMenu = process.argv.includes('--probe-message-menu');
const probeSearch = process.argv.includes('--probe-search');
const probeHomeProject = process.argv.includes('--probe-home-project');
const probeHomeTerminal = process.argv.includes('--probe-home-terminal');
const probeShellActions = process.argv.includes('--probe-shell-actions');
const probeChatCopy = process.argv.includes('--probe-chat-copy');
const probeRecents = process.argv.includes('--probe-recents');
const probeScheduleFork = process.argv.includes('--probe-schedule-fork');
const probePaneResize = process.argv.includes('--probe-pane-resize');
const probeRightTools = probePaneResize || process.argv.includes('--probe-right-tools');
assert.ok(!probeScheduleFork || process.argv.includes('--reference-only'), 'The attached scheduler probe applies to the reference.');
const fixtureModel = /^fixture model(?:\s|$)/i;
const olderChat = 'Unique chat beyond the first sidebar page';
const olderAnswer = 'Answer from the historical search fixture.';
const activityText = 'Investigating the isolated workspace';
const copyHistorySize = 51;
const copyPrompt = (index: number) => 'Stored question ' + index + '.';
const copyAnswer = (index: number) => 'Stored answer ' + index + '.';
const messageHeading = 'Rendered workspace report';
const messageList = 'Scoped history';
const messageCode = 'printf "yard"';
const messageMarkdown = '### ' + messageHeading + '\n\n**Status:** ready.\n\n- ' + messageList +
  '\n- Copy with formatting\n\n```sh\n' + messageCode + '\n```';

type Variant = { name: string; options: BrowserContextOptions };
const variants: Variant[] = [
  { name: 'desktop-light', options: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
  { name: 'desktop-dark', options: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  { name: 'mobile-light', options: { viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true } },
];
type Frame = { name: string; png: Buffer };

function contextOptions(variant: Variant): BrowserContextOptions {
  return { ...variant.options, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1, reducedMotion: 'reduce' };
}

async function capture(page: Page, variant: Variant, directory: string, url: string, reference: boolean,
  checkSend?: (page: Page) => Promise<void>, peer?: Awaited<ReturnType<typeof createFakeCodex>>) {
  const frames: Frame[] = [];
  const sidebarProjectCalls: string[] = [];
  const markerWrites: unknown[] = [];
  if (probeProjectHover || probeProjectTouch || probeProjectMarker) page.on('websocket', socket => {
    if (!socket.url().endsWith('/native-host')) return;
    socket.on('framesent', frame => {
      const message = JSON.parse(String(frame.payload));
      if (message.type === 'fetch' && message.url === 'vscode://codex/source-sidebar-project') sidebarProjectCalls.push(JSON.parse(message.body).operation);
      if (message.type === 'fetch' && message.url === 'vscode://codex/set-global-state') {
        const body = JSON.parse(message.body ?? '{}');
        if (body.key === 'project-appearances') markerWrites.push(body.value);
      }
    });
  });
  const documentIconPath = '/images/ecosystem/apps/documents/icon.png';
  let documentIconRequested = false;
  if (probeOutputs) page.on('request', request => {
    if (new URL(request.url()).pathname === documentIconPath) documentIconRequested = true;
  });
  const forwardingCalls: string[] = [];
  const forwardingChunks: string[] = [];
  if (probeProduct) {
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/source-chunks/port-forwarding-view-')) forwardingChunks.push(path);
    });
    page.on('websocket', socket => {
      if (!socket.url().endsWith('/native-host')) return;
      socket.on('framesent', frame => {
        const message = JSON.parse(String(frame.payload));
        if (message.type === 'fetch' && message.url === 'vscode://codex/port-forwarding') forwardingCalls.push(JSON.parse(message.body).operation);
      });
    });
  }
  const scheduledRequests = new Set<string>();
  const scheduledResponses: Array<{ responseType?: string; error?: string }> = [];
  if (probeScheduleFork) page.on('websocket', socket => {
    if (!socket.url().endsWith('/native-host')) return;
    socket.on('framesent', frame => {
      const message = JSON.parse(String(frame.payload));
      if (message.type === 'fetch' && message.url === 'vscode://codex/automation-create') scheduledRequests.add(message.requestId);
    });
    socket.on('framereceived', frame => {
      const message = JSON.parse(String(frame.payload));
      if (scheduledRequests.has(message.requestId)) scheduledResponses.push({ responseType: message.responseType, error: message.error });
    });
  });
  const projectState: Array<{ phase: string; method: string; key?: string; value?: unknown }> = [];
  function traceProjectState(target: Page, phase: string) {
    if (!probeHomeProject) return;
    target.on('websocket', socket => {
      if (!socket.url().endsWith('/native-host')) return;
      socket.on('framesent', frame => {
        const message = JSON.parse(String(frame.payload));
        const method = message.type === 'fetch' ? String(message.url).split('/').at(-1) : message.type;
        if (!['get-global-state', 'set-global-state'].includes(method)) return;
        const fields = JSON.parse(message.body ?? '{}');
        if (fields.key === 'selected-project') projectState.push({ phase, method, key: fields.key, value: fields.value });
      });
    });
  }
  traceProjectState(page, 'open');
  const editor = page.locator(editorSelector).last();
  const row = page.locator(rowSelector).and(page.getByLabel(conversation, { exact: true })).first();
  const pinnedRequests = new Set<string>();
  if (probeToolRoutes) page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/workbench-pinned-entry.js' || pathname === rendererAssets.application) pinnedRequests.add(pathname);
  });
  const activate = (target: Locator) => variant.options.hasTouch ? target.tap() : target.click();
  const waitForModel = (target: Page) => target.getByText(fixtureModel).first()
    .waitFor({ state: 'attached', timeout: 12_000 }).catch(async error => {
      await take('model-not-ready', target);
      throw error;
    });
  const sidebarHit = () => page.evaluate(() => document.querySelector('#app-shell-sidebar')?.contains(document.elementFromPoint(20, 100)) ?? false);
  async function toggleSidebar() {
    const toggles = page.locator(sidebarToggle);
    const clickable = await toggles.evaluateAll(elements => elements.findIndex(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    }));
    assert.ok(clickable >= 0, 'A sidebar toggle must be hit-testable.');
    await activate(toggles.nth(clickable));
  }
  async function take(state: string, target = page, keepPointer = false) {
    if (!variant.options.hasTouch && !keepPointer) await target.mouse.move(0, 0);
    await target.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    });
    const name = variant.name + '-' + state;
    const png = await target.screenshot({ path: join(directory, name + '.png'), animations: 'disabled', caret: 'hide', scale: 'css' });
    await writeFile(join(directory, name + '.html'), await target.locator('html').evaluate(html => html.outerHTML));
    const layout = await target.evaluate(selectors => Object.fromEntries(Object.entries(selectors).flatMap(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const { x, y, width, height } = element.getBoundingClientRect();
      const { fontFamily, fontSize, fontWeight, lineHeight, color, backgroundColor, letterSpacing,
        paddingInlineStart, paddingInlineEnd, gap, borderRadius, opacity } = getComputedStyle(element);
      const placeholder = element.matches('[data-empty-paragraph]') ? getComputedStyle(element, '::before') : null;
      return [[name, { x, y, width, height, fontFamily, fontSize, fontWeight, lineHeight, color, backgroundColor,
        letterSpacing, paddingInlineStart, paddingInlineEnd, gap, borderRadius, opacity,
        ...(placeholder ? { placeholderColor: placeholder.color, placeholderOpacity: placeholder.opacity } : {}) }]];
    })), {
      root: 'html', frame: '[data-app-shell-frame]', titlebar: '[data-app-shell-titlebar]',
      sidebar: '#app-shell-sidebar', row: '[data-app-action-sidebar-thread-row]', main: '[data-app-shell-main-content-layout]',
      sidebarScroll: '[data-app-action-sidebar-scroll], .yard-source-nav',
      rowTitle: '[data-app-action-sidebar-thread-row] [data-marquee-content] span span, .yard-source-thread > span:first-child',
      projectHeading: '[data-app-action-sidebar-section-heading="Projects"] button:first-child, [data-app-action-sidebar-section-heading="Projects"] h2',
      recentsHeading: '[data-app-action-sidebar-section-heading="Recents"] button:first-child',
      recentRow: '[data-app-action-sidebar-section-heading="Recents"] [data-app-action-sidebar-thread-row]',
      projectRow: '[data-app-action-sidebar-project-row], .yard-source-nav [data-app-action-sidebar-section-heading="Projects"] > div > button',
      newChat: '#app-shell-sidebar button[aria-label="New chat"], #app-shell-sidebar > button.yard-source-action',
      threadTitle: '[data-app-shell-titlebar] button.truncate.leading-6, button.yard-source-chat-title',
      welcomeIcon: '[data-testid=home-icon]', welcomeTitle: '.heading-xl', editor: editorSelector,
      composer: '[data-codex-composer-root]', composerFrame: '[data-composer-body]',
      draftText: editorSelector + ' p', utility: '[data-composer-utility-rail]',
      projectTrigger: '[data-composer-navigation-target="workspace-project"], .yard-source-project-trigger',
      addContext: 'button[aria-label="Add files and more"]', send: '[data-codex-composer-root] button:is([aria-label="Send"], [aria-label="Send message"])',
      dictate: 'button[aria-label="Dictate"]', model: 'button:has(._ModelPickerTriggerContent_b9jvu_2), .yard-source-toolbar-end',
      modelText: '._ModelPickerTriggerModelText_b9jvu_2, .yard-source-toolbar-end > span > span:first-child',
      terminal: 'button[aria-label="Toggle bottom panel"], button[aria-label="Toggle terminal"]',
      sidePanel: 'button[aria-label="Toggle side panel"], button[aria-label="Open right sidebar"]',
      summary: '[data-summary-panel-variant="summary"]',
      menu: '[role="menu"]:popover-open, [data-radix-menu-content][data-state="open"]',
      projectCard: '.yard-source-project-card:popover-open, [role="tooltip"]:has(button:where([aria-label="Pin project"], [aria-label="Unpin project"]))',
      projectDialog: '.yard-source-project-edit:modal, [role="dialog"].codex-dialog',
      projectDialogHeading: '.yard-source-project-edit:modal h2, [role="dialog"].codex-dialog h2',
      projectActions: '[data-app-action-sidebar-project-row] button[aria-haspopup="menu"]',
      permissionTrigger: 'button[aria-label="Change permissions"]',
      notice: '[data-source-full-access-notice], aside[role="status"]:has(h3)',
      noticeHeading: '[data-source-full-access-notice] h3, aside[role="status"] h3',
      noticeLearnMore: '[data-source-full-access-notice] a, aside[role="status"] a',
      userBubble: '[data-user-message-bubble], .yard-source-user-message',
      userText: '[data-user-message-bubble] p, .yard-source-user-message p',
      formattedHeading: '[aria-label="Conversation"] ._MarkdownRoot_1fgd0_2 h3',
      formattedCode: '[aria-label="Conversation"] [data-code-block="true"]',
      userCopy: 'button[aria-label="Copy message"]',
      activityToggle: 'div.text-size-chat.text-secondary > button[aria-expanded], .yard-source-turn-activity-toggle',
      activityShell: '.yard-source-shell-log, [data-testid="exec-shell-body"] .rounded-lg',
      activityOutput: '.yard-source-shell-log pre, [data-testid="exec-shell-body"] code',
      assistantText: '[data-local-conversation-final-assistant] p, .yard-source-agent-message p',
      assistantCopy: 'button[aria-label="Copy"], button[aria-label="Copy response"]',
      assistantActions: 'button[aria-label="More actions"]',
      chatActions: 'button[aria-label="Chat actions"]',
      summaryToggle: 'button[aria-label="Toggle pinned summary"], button[aria-label="Summary"]',
      rightTools: '[data-new-tab-scroll-root]',
      rightToolCard: '.yard-new-tab-card',
    });
    await writeFile(join(directory, name + '.json'), JSON.stringify(layout, null, 2));
    frames.push({ name, png });
  }

  await page.clock.setFixedTime(date);
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.getElementById('yard-startup') &&
    !!document.querySelector('#root [data-app-shell-frame]'), undefined, { timeout: 30000 });
  await editor.waitFor();
  if (!variant.options.isMobile) await row.waitFor();
  const localEditorReadyAt = await editor.evaluate(async target => {
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const { x, y, width, height } = target.getBoundingClientRect();
    return width && height && target.contains(document.elementFromPoint(x + 8, y + height / 2)) ? performance.now() : null;
  });
  assert.ok(localEditorReadyAt, 'The local editor must be hit-testable.');
  await waitForModel(page);
  if (probeToolbar) {
    await page.getByRole('button', { name: fixtureModel }).click({ timeout: 15_000 });
    await page.getByRole(reference ? 'menuitem' : 'slider', { name: /^(Power|强度)$/ }).waitFor({ timeout: 10_000 });
    await take('model-menu');
    await page.keyboard.press('Escape');
  }
  await take('home');
  if (probeProjectOperations) {
    const name = 'Workspace parity project';
    const actions = page.getByRole('button', { name: 'Project actions for ' + name, exact: true });
    await actions.press('Enter');
    const section = page.getByRole('menuitem', { name: 'Section', exact: true });
    await section.press('ArrowRight');
    const submenu = page.getByRole('menu').nth(1);
    await submenu.waitFor({ timeout: 5_000 });
    await submenu.getByRole('menuitem', { name: 'New section…', exact: true }).click({ trial: true });
    const itemBox = await section.boundingBox(), surface = await submenu.boundingBox();
    assert.ok(itemBox && surface && Math.abs(itemBox.y - surface.y) <= 6 && surface.x > itemBox.x + itemBox.width,
      'The project submenu follows its launcher after keyboard navigation.');
    await take('project-section', page, true);
    const sectionItems = await page.getByRole('menu').nth(1).getByRole('menuitem').allTextContents();
    await page.getByRole('menuitem', { name: 'New section…', exact: true }).click();
    const newSection = page.getByRole('dialog').last();
    await newSection.waitFor();
    await take('project-new-section');
    const newSectionText = await newSection.innerText();
    await newSection.getByRole('textbox').fill('Fixture focus');
    await newSection.getByRole('button', { name: 'Create section', exact: true }).click();
    await newSection.waitFor({ state: 'hidden' });
    await page.locator('#app-shell-sidebar').getByRole('button', { name: 'Fixture focus', exact: true }).waitFor();
    await take('project-moved');
    const archive = page.getByRole('menuitem', { name: 'Archive chats', exact: true });
    if (!(await archive.isVisible())) await actions.press('Enter');
    await archive.click();
    const confirmation = page.getByRole('dialog').last();
    await confirmation.waitFor();
    await take('project-archive', page, true);
    const archiveText = await confirmation.innerText();
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.equal(peer?.calls('thread/archive').length, 0);
    if (!reference) {
      const group = page.locator('[data-app-action-sidebar-section-heading="Fixture focus"]');
      const projectRow = () => group.getByRole('button', { name, exact: true });
      await projectRow().waitFor();
      assert.equal(await page.locator('[data-app-action-sidebar-section-heading="Recents"]').getByText(conversation, { exact: true }).count(), 0);
      await editor.fill('Project operations leave the draft in place');
      await actions.press('Enter');
      await page.getByRole('menuitem', { name: 'Open in File Manager', exact: true }).click();
      const files = page.getByRole('dialog', { name, exact: true });
      await files.getByRole('button', { name: 'fixture-folder', exact: true }).click();
      await files.getByRole('button', { name: 'Close dialog', exact: true }).click();
      assert.equal(await editor.textContent(), 'Project operations leave the draft in place');
      await page.reload({ waitUntil: 'commit' });
      await waitForModel(page);
      await projectRow().waitFor();
      await actions.press('Enter');
      await section.press('ArrowRight');
      await page.getByRole('menuitem', { name: 'Remove from section', exact: true }).click();
      await page.locator('[data-app-action-sidebar-section-heading="Projects"]').getByRole('button', { name, exact: true }).waitFor();
      assert.equal(await editor.textContent(), 'Project operations leave the draft in place');
      await editor.fill('');
    }
    await writeFile(join(directory, 'project-operations.json'), JSON.stringify({ sectionItems, newSectionText, archiveText }, null, 2));
  }
  if (probeProjectHover || probeProjectMarker) {
    const projectName = 'Workspace parity project';
    const project = page.locator('[data-app-action-sidebar-project-row]').filter({ hasText: projectName });
    const actions = project.getByRole('button', { name: 'Project actions for ' + projectName, exact: true });
    const newChat = project.getByRole('button', { name: 'Start new chat in ' + projectName, exact: true });
    const edit = page.getByRole('button', { name: 'Edit project', exact: true });
    const initialUrl = page.url();
    const actionOpacity = () => actions.evaluate(element => {
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return opacity;
    });
    assert.deepEqual(sidebarProjectCalls, []);
    if (!reference) assert.equal(await project.locator('[role="menuitem"]').count(), 0, 'Closed project menus do not mount actions.');
    assert.equal(await actionOpacity(), 0);
    await project.getByText(projectName, { exact: true }).hover();
    await edit.waitFor({ timeout: 8_000 });
    await page.getByText('2 chats', { exact: true }).waitFor({ timeout: 8_000 });
    if (!reference) await page.getByText('1 active', { exact: true }).waitFor({ timeout: 8_000 });
    assert.equal(await actionOpacity(), 1);
    await take('project-hover', page, true);
    await edit.hover();
    assert.equal(await edit.isVisible(), true, 'The pointer can move from the project into its detail card.');
    assert.equal(page.url(), initialUrl);
    await page.mouse.move(0, 0);
    await edit.waitFor({ state: 'hidden' });
    if (!reference) {
      const trigger = project.getByRole('button', { name: projectName, exact: true });
      await trigger.press('ArrowRight');
      await edit.waitFor();
      await page.keyboard.press('Escape');
      await edit.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
      await page.keyboard.press('Tab');
      assert.equal(await actions.evaluate(element => element === document.activeElement), true);
      assert.equal(await actionOpacity(), 1);
    }
    await actions.press('Enter');
    const menu = page.getByRole('menu').last();
    await menu.waitFor();
    await take('project-menu');
    const anchorBox = await actions.boundingBox(), menuBox = await menu.boundingBox();
    assert.ok(anchorBox && menuBox && Math.abs(anchorBox.x - menuBox.x) < 8 && Math.abs(anchorBox.y + anchorBox.height - menuBox.y) < 8,
      'The project actions menu opens next to its own button.');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    async function exerciseMarker() {
      const marker = page.getByRole('button', { name: 'Change marker for ' + projectName, exact: true });
      const picker = reference ? page.locator('[data-slot="popover-content"]').last() : page.getByRole('dialog', { name: 'Project marker', exact: true });
      const search = picker.getByRole('searchbox', { name: 'Search icons', exact: true });
      await marker.click();
      await search.click({ trial: true, timeout: 15_000 });
      await take('project-marker', page, true);
      await writeFile(join(directory, 'project-marker.txt'), await picker.ariaSnapshot());
      await picker.getByRole('button', { name: 'Use Blue', exact: true }).click();
      await search.fill('pencil');
      await picker.getByRole('button', { name: 'Pencil', exact: true }).click();
      await peer!.waitFor(message => message.method === 'project/update' &&
        JSON.parse((message.params.metadata as Record<string, string> | undefined)?.['yard.projectAppearance'] ?? 'null')?.marker?.icon === 'edit');
      assert.equal(await picker.isVisible(), true, 'The picker stays open after a marker change.');
      await writeFile(join(directory, 'project-marker-after-icon.json'), JSON.stringify({ writes: markerWrites,
        updates: peer!.calls('project/update').map(({ params }) => (params.metadata as Record<string, string> | undefined)?.['yard.projectAppearance']).filter(Boolean),
      }, null, 2));
      await picker.getByRole('button', { name: 'Emoji', exact: true }).click();
      await picker.getByRole('grid', { name: 'Emojis', exact: true }).waitFor();
      await take('project-emoji', page, true);
      await writeFile(join(directory, 'project-emoji.txt'), (await picker.ariaSnapshot()).slice(0, 12_000));
      await picker.getByRole('searchbox', { name: 'Search emojis', exact: true }).fill('rocket');
      await picker.getByRole('button', { name: 'rocket', exact: true }).first().click();
      await peer!.waitFor(message => message.method === 'project/update' &&
        JSON.parse((message.params.metadata as Record<string, string> | undefined)?.['yard.projectAppearance'] ?? 'null')?.marker?.emoji === '🚀');
      await page.keyboard.press('Escape');
      await picker.waitFor({ state: 'hidden' });
      await marker.waitFor();
    }
    if (reference) {
      await actions.press('Enter');
      await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor();
      await take('project-edit');
      if (probeProjectMarker) await exerciseMarker();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
    if (!reference) {
      assert.equal(await actions.evaluate(element => element === document.activeElement), true);
      await actions.press('Enter');
      await menu.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      await actions.press('Enter');
      await menu.getByRole('menuitem', { name: 'Unpin', exact: true }).waitFor();
      await menu.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
      await actions.press('Enter');
      await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit project', exact: true });
      await dialog.getByRole('button', { name: 'Add folder', exact: true }).waitFor();
      await take('project-edit');
      if (probeProjectMarker) await exerciseMarker();
      await dialog.getByRole('textbox', { name: 'Project name' }).fill('Renamed fixture project');
      await dialog.getByRole('button', { name: 'Add folder', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Add folder', exact: true });
      await picker.getByRole('button', { name: 'fixture-folder', exact: true }).click();
      await picker.getByRole('button', { name: 'Add folder', exact: true }).click();
      await dialog.getByText('fixture-folder', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(peer!.calls('project/update').at(-1)?.params.name, 'Renamed fixture project');
      assert.equal((peer!.calls('project/update').at(-1)?.params.roots as { path: string }[]).length, 2);
      const renamed = page.getByRole('button', { name: 'Project actions for Renamed fixture project', exact: true });
      await renamed.press('Enter');
      await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      await dialog.getByRole('button', { name: /^Remove folder: .*fixture-folder$/ }).click();
      await dialog.getByRole('textbox', { name: 'Project name' }).fill(projectName);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(sidebarProjectCalls.filter(operation => operation !== 'appearance'), ['read', 'read', 'pin', 'pin', 'folders', 'edit', 'folders', 'edit']);
      if (probeProjectMarker) {
        await page.reload({ waitUntil: 'commit' });
        await waitForModel(page);
        await project.locator('.yard-project-marker-emoji').filter({ hasText: '🚀' }).waitFor();
        await project.getByText(projectName, { exact: true }).hover();
        await page.getByRole('button', { name: 'Change marker for ' + projectName, exact: true }).click();
        const picker = page.getByRole('dialog', { name: 'Project marker', exact: true });
        await picker.getByRole('button', { name: 'Clear', exact: true }).click();
        await project.locator('.yard-project-marker-emoji').waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');
        await picker.waitFor({ state: 'hidden' });
        assert.equal(await edit.isVisible(), true, 'Escape closes the marker picker before dismissing project details.');
        await page.keyboard.press('Escape');
        await edit.waitFor({ state: 'hidden' });
      } else {
        const working = page.locator('[data-app-action-sidebar-thread-row] [aria-label="Working"]');
        assert.equal(await working.count(), 2);
        const thread = peer!.threads.get(firstThreadId)!;
        peer!.threads.set(firstThreadId, { ...thread, status: { type: 'idle' } });
        peer!.broadcast({ method: 'thread/status/changed', params: { threadId: firstThreadId, status: { type: 'idle' } } });
        await working.first().waitFor({ state: 'detached' });
      }
    }
    await project.getByText(projectName, { exact: true }).hover();
    await newChat.click({ timeout: 6_000 });
    await editor.waitFor();
    await page.locator('[data-composer-navigation-target="workspace-project"], .yard-source-project-trigger').getByText(projectName, { exact: true }).waitFor();
  }
  if (probeProjectTouch) {
    await toggleSidebar();
    const projectName = 'Workspace parity project';
    const actions = page.getByRole('button', { name: 'Project actions for ' + projectName, exact: true });
    await actions.tap();
    const menu = page.getByRole('menu').last();
    await menu.getByRole('menuitem', { name: 'Edit', exact: true }).waitFor();
    await take('project-touch-menu');
    await menu.getByRole('menuitem', { name: 'Edit', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Edit project', exact: true });
    await dialog.getByRole('button', { name: 'Change marker for ' + projectName, exact: true }).tap();
    const markerPicker = page.getByRole('dialog', { name: 'Project marker', exact: true });
    await markerPicker.getByRole('button', { name: 'Plane', exact: true }).waitFor();
    const box = await markerPicker.boundingBox();
    assert.ok(box && box.x >= 8 && box.x + box.width <= variant.options.viewport!.width - 8,
      'The touch marker picker fits the viewport.');
    await markerPicker.getByRole('button', { name: 'Use Green', exact: true }).tap();
    await markerPicker.getByRole('button', { name: 'Plane', exact: true }).tap();
    await markerPicker.getByRole('button', { name: 'Plane', exact: true, pressed: true }).waitFor();
    await take('project-touch-marker');
    await markerPicker.getByRole('button', { name: 'Clear', exact: true }).tap();
    await markerPicker.getByRole('button', { name: 'Folder', exact: true, pressed: true }).waitFor();
    await dialog.getByRole('button', { name: 'Change marker for ' + projectName, exact: true }).tap();
    await markerPicker.waitFor({ state: 'hidden' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(sidebarProjectCalls.every(operation => operation === 'folders' || operation === 'appearance'));
    await page.getByRole('button', { name: 'Start new chat in ' + projectName, exact: true }).tap();
    await editor.waitFor();
    await page.locator('.yard-source-project-trigger').getByText(projectName, { exact: true }).waitFor();
    assert.equal(await sidebarHit(), false, 'Starting a project chat closes the drawer on touch devices.');
    await editor.fill('Unsaved draft through project management');
    await toggleSidebar();
    await actions.tap();
    await menu.getByRole('menuitem', { name: 'Remove project', exact: true }).tap();
    const remove = page.getByRole('dialog', { name: 'Remove local project?', exact: true });
    await remove.getByRole('button', { name: 'Cancel', exact: true }).tap();
    assert.equal(peer!.calls('project/delete').length, 0);
    await actions.tap();
    await menu.getByRole('menuitem', { name: 'Remove project', exact: true }).tap();
    await remove.getByRole('button', { name: 'Remove project', exact: true }).tap();
    await actions.waitFor({ state: 'detached' });
    assert.equal(peer!.calls('project/delete').length, 1);
    assert.equal(peer!.calls('thread/delete').length, 0);
    assert.match(await editor.textContent() ?? '', /Unsaved draft through project management/);
    await editor.fill('');
    await toggleSidebar();
  }
  if (probeProduct) {
    const trigger = page.getByRole('button', { name: 'Switch mode, current mode: Codex', exact: true });
    const openForwarding = page.getByRole('menuitem', { name: /^端口转发管理/ });
    assert.deepEqual(forwardingChunks, []);
    assert.deepEqual(forwardingCalls, []);
    await trigger.press('Enter');
    await openForwarding.waitFor();
    await take('product-menu');
    await page.keyboard.press('Escape');
    await openForwarding.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    assert.deepEqual(forwardingChunks, []);
    assert.deepEqual(forwardingCalls, []);
    await trigger.press('Enter');
    await openForwarding.press('Enter');
    const dialog = page.getByRole('dialog', { name: '端口转发管理', exact: true });
    await dialog.getByRole('combobox', { name: '本设备', exact: true }).waitFor();
    assert.ok(forwardingCalls.length > 0 && forwardingCalls.every(operation => operation === 'list'));
    assert.equal(forwardingChunks.length, reference ? 0 : 1);
    await take('port-forwarding');
    await dialog.getByRole('button', { name: '关闭端口转发管理', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    if (!reference) assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  }
  if (probeRecents && peer) {
    const scroll = page.locator('[data-app-action-sidebar-scroll], .yard-source-nav');
    const rows = page.locator('[data-app-action-sidebar-section-heading="Recents"]')
      .locator('[data-app-action-sidebar-thread-row]');
    const older = scroll.getByLabel(olderChat, { exact: true });
    const calls = () => peer.calls('thread/list').filter(call => !call.params.searchTerm)
      .map(call => ({ cursor: call.params.cursor ?? null, limit: call.params.limit, sortKey: call.params.sortKey }));
    const before = { count: await rows.count(), calls: calls() };
    assert.equal(before.count, 20);
    if (!reference) assert.deepEqual(before.calls.filter(call => call.sortKey === 'recency_at'), [{ cursor: null, limit: 50, sortKey: 'recency_at' }]);
    const recents = scroll.getByRole('button', { name: 'Recents', exact: true });
    await recents.click();
    await rows.first().waitFor({ state: 'hidden' });
    await recents.click();
    assert.equal(await rows.count(), 20);
    const project = scroll.getByRole('button', { name: 'Workspace parity project', exact: true });
    await project.click();
    await scroll.hover({ position: { x: 100, y: 320 } });
    for (let step = 0; step < 12; step++) {
      await page.mouse.wheel(0, 560);
      await delay(120);
      if (await older.first().isVisible() && await older.first().evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + 20, rect.y + 12));
      })) break;
    }
    const after = { count: await rows.count(), calls: calls() };
    await writeFile(join(directory, 'recents-paging.json'), JSON.stringify({ before, after }, null, 2));
    await older.first().click({ timeout: 5_000 });
    await page.getByText(olderAnswer, { exact: true }).waitFor();
    await take('older-recent');
    if (!reference) assert.deepEqual(after.calls.filter(call => call.cursor).map(call => call.cursor), ['50']);
    await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await editor.waitFor();
    await project.click();
  }
  if (probeHomeTerminal) {
    const panel = page.getByRole('button', { name: 'Toggle side panel', exact: true }).filter({ visible: true }).first();
    await panel.click();
    await panel.and(page.locator('[aria-pressed="true"]')).waitFor();
    await take('home-side-panel');
    await writeFile(join(directory, 'home-side-panel.txt'), await page.locator('body').ariaSnapshot());
    await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
    await panel.and(page.locator('[aria-pressed="false"]')).waitFor();
    await editor.waitFor();
  }
  const sidebar = page.locator('#app-shell-sidebar');
  const profile = reference ? sidebar.getByText('fixture', { exact: true }).first() :
    sidebar.getByRole('button', { name: 'fixture', exact: true });
  if (probeToolRoutes) {
    assert.deepEqual([...pinnedRequests], [], 'The original renderer must be absent from a source startup.');
    await row.click();
    await page.getByText(answer, { exact: true }).waitFor();
    const pending = 'Preserve this draft while visiting settings and plugins.';
    await editor.fill(pending);
    await profile.click();
    await page.getByRole('menuitem', { name: /^Settings/ }).click();
    await page.getByText('Default terminal location', { exact: true }).waitFor({ timeout: 25_000 }).catch(async error => {
      await take('settings-failure');
      console.error({ url: page.url(), pinnedRequests: [...pinnedRequests] });
      throw error;
    });
    assert.equal(new URL(page.url()).searchParams.get('initialRoute'), '/settings/general-settings');
    assert.deepEqual([...pinnedRequests].sort(), ['/workbench-pinned-entry.js', rendererAssets.application].sort());
    await take('settings-route');
    await page.getByText('Back to app', { exact: true }).click();
    await page.locator('.yard-source-frame').waitFor();
    await page.getByText(answer, { exact: true }).waitFor();
    await editor.waitFor();
    assert.equal(await editor.textContent(), pending);

    await sidebar.getByRole('link', { name: 'Plugins', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('initialRoute') === '/plugins', { waitUntil: 'commit' });
    await page.getByRole('heading', { name: 'Plugins', exact: true }).waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('.yard-source-frame').count(), 0);
    await take('plugins-route');
    await page.goBack({ waitUntil: 'commit' });
    await editor.waitFor();
    assert.equal(await editor.textContent(), pending);

    await profile.click();
    const help = page.getByRole('menuitem', { name: 'Help', exact: true });
    await help.press('ArrowRight');
    const submenu = page.getByRole('menu', { name: 'Help', exact: true });
    await submenu.getByRole('menuitem', { name: "What's new", exact: true }).waitFor();
    await page.keyboard.press('ArrowLeft');
    await submenu.waitFor({ state: 'hidden' });
    await page.getByRole('menuitem', { name: /^Show Pet/ }).click();
    const mini = page.locator('[data-workbench-mini] iframe');
    await mini.contentFrame().locator('[data-codex-pet-id]').first().waitFor({ timeout: 45_000 });
    await take('mini');
    await profile.click();
    await page.getByRole('menuitem', { name: /^Hide Pet/ }).click();
    await mini.waitFor({ state: 'detached' });
    assert.equal(await editor.textContent(), pending);
    await editor.fill('');
    await sidebar.getByRole('button', { name: 'New chat', exact: true }).click();
  }
  if (probeProfile) {
    await profile.click({ timeout: 10_000 });
    await page.getByRole('menu').getByRole('menuitem').first().waitFor({ timeout: 15_000 });
    await take('profile-menu');
    await page.keyboard.press('Escape');
  }
  if (!(variant.options.hasTouch ? await sidebarHit() : await row.isVisible())) await toggleSidebar();
  await row.waitFor();
  await take('sidebar');
  if (probeSearch) {
    assert.equal(peer?.calls('thread/list').some(call => call.params.searchTerm != null), false);
    const project = sidebar.locator('section[data-app-action-sidebar-section-heading="Projects"]');
    const projectRows = project.locator('[data-app-action-sidebar-thread-row]');
    assert.equal(await projectRows.count(), 5);
    await project.getByRole('button', { name: 'Show more', exact: true }).first().click();
    await projectRows.nth(14).waitFor();
    assert.equal(await projectRows.count(), 15);
    await sidebar.getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Command menu', exact: true });
    const query = dialog.getByRole('combobox', { name: 'Command menu', exact: true });
    await query.and(page.locator(':focus')).waitFor();
    await take('search');
    await writeFile(join(directory, variant.name + '-search.aria.txt'), await page.locator('body').ariaSnapshot());
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    if (!reference) {
      assert.equal(await sidebar.getByLabel(olderChat, { exact: true }).count(), 0);
      await editor.fill(savedDraft);
      await sidebar.getByRole('button', { name: 'Search', exact: true }).click();
      await query.fill(olderChat);
      await dialog.getByRole('option', { name: new RegExp('^' + olderChat) }).waitFor();
      await query.press('Enter');
      await page.getByText(olderAnswer, { exact: true }).waitFor();
      assert.ok(peer?.calls('thread/list').some(call => call.params.searchTerm === olderChat && call.params.useStateDbOnly === true));
      await page.goBack();
      await page.waitForFunction(({ selector, draft }) => document.querySelector(selector)?.textContent === draft,
        { selector: editorSelector, draft: savedDraft });
      await editor.fill('');
      await page.keyboard.press('Control+k');
      await query.and(page.locator(':focus')).waitFor();
      await query.fill('Toggle sidebar');
      await query.press('Enter');
      await row.waitFor({ state: 'hidden' });
      await toggleSidebar();
    }
  }
  await activate(row);
  if (probeMessages) await page.getByRole('heading', { name: messageHeading, exact: true }).waitFor();
  else await page.getByText(answer, { exact: true }).waitFor();
  await waitForModel(page);
  await take('conversation');
  if (probeScheduleFork) {
    const trigger = page.getByRole('button', { name: 'Chat actions', exact: true });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Fork', exact: true }).press('ArrowRight');
    const fork = page.getByRole('menu', { name: 'Fork', exact: true });
    await fork.waitFor({ timeout: 5_000 });
    await take('fork-menu');
    await writeFile(join(directory, 'fork-menu.txt'), await fork.ariaSnapshot());
    await page.keyboard.press('Escape');
    await fork.waitFor({ state: 'hidden' });
    const schedule = page.getByRole('menuitem', { name: /^Add scheduled task/ });
    if (await schedule.isVisible()) await page.keyboard.press('Escape');
    await schedule.waitFor({ state: 'hidden' });
    await trigger.click();
    const messages: object[] = [];
    const before = peer?.calls('thread/start').length;
    page.on('framenavigated', frame => messages.push({ type: 'navigation', url: frame.url() }));
    page.on('popup', popup => messages.push({ type: 'popup', url: popup.url() }));
    const hostTrace = () => peer?.messages.filter(message => message.method?.startsWith('thread/') || message.method?.startsWith('turn/'))
      .map(message => message.method) ?? [];
    const priorHostTrace = hostTrace().length;
    await schedule.press('Enter', { timeout: 5_000 });
    const panel = page.getByRole('tab', { name: conversation, exact: true });
    await panel.waitFor({ timeout: 8_000 });
    const form = page.getByRole('tabpanel', { name: conversation, exact: true });
    const prompt = form.getByRole('textbox', { name: 'Prompt', exact: true });
    await prompt.waitFor({ timeout: 8_000 });
    await take('schedule-open');
    assert.equal(peer?.calls('thread/start').length, before, 'Opening the schedule composer must not start a turn.');
    await writeFile(join(directory, 'schedule-open.json'), JSON.stringify({ url: page.url(), messages,
      calls: hostTrace().slice(priorHostTrace), drafts: await page.locator(editorSelector).allTextContents(),
      dialogs: await page.getByRole('dialog').allTextContents(), panels: await page.getByRole('tab').allTextContents(),
      tree: await page.locator('body').ariaSnapshot() }, null, 2));
    await prompt.fill('An isolated attached schedule fixture');
    await form.getByRole('button', { name: 'Create scheduled task', exact: true }).click();
    for (let i = 0; !scheduledResponses.length && i < 80; i++) await delay(100);
    await writeFile(join(directory, 'schedule-create.json'), JSON.stringify(scheduledResponses, null, 2));
    assert.equal(scheduledResponses[0]?.responseType, 'error');
    assert.match(scheduledResponses[0]?.error ?? '', /请使用独立任务/);
    assert.equal(peer?.calls('thread/start').length, before, 'The unsupported attach operation did not launch an independent task.');
    return { frames, localEditorReadyAt };
  }
  if (probeChatCopy) {
    const copies: Record<string, string> = {};
    const exportReads = () => peer?.calls('thread/turns/list').filter(call => call.params.threadId === firstThreadId && call.params.limit === 50) ?? [];
    const trigger = page.getByRole('button', { name: 'Chat actions', exact: true });
    const copyItem = page.getByRole('menuitem', { name: 'Copy', exact: true });
    const submenu = page.getByRole('menu', { name: 'Copy', exact: true });
    if (!reference) {
      await trigger.click();
      await copyItem.press('ArrowRight');
      await submenu.waitFor();
      await page.keyboard.press('Escape');
      await submenu.waitFor({ state: 'hidden' });
      assert.equal(await page.locator(':focus').textContent(), 'Copy');
      await page.keyboard.press('Escape');
      await copyItem.waitFor({ state: 'hidden' });
      assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Chat actions');
    }
    for (const label of ['Copy deeplink', 'Copy as Markdown', 'Copy working directory']) {
      if (!reference && label !== 'Copy working directory') assert.deepEqual(exportReads(), []);
      await page.evaluate(() => navigator.clipboard.writeText('yard fixture clipboard'));
      await trigger.click();
      await copyItem.press('ArrowRight');
      if (label === 'Copy deeplink') await take('conversation-header-copy');
      await submenu.getByRole('menuitem', { name: label, exact: true }).click();
      const deadline = performance.now() + 5_000;
      do {
        copies[label] = await page.evaluate(() => navigator.clipboard.readText());
        if (copies[label] && copies[label] !== 'yard fixture clipboard') break;
        await delay(60);
      } while (performance.now() < deadline);
      assert.notEqual(copies[label], 'yard fixture clipboard', label + ' did not update the clipboard');
      assert.ok(copies[label], label + ' copied an empty result');
    }
    await writeFile(join(directory, 'conversation-copies.json'), JSON.stringify(copies, null, 2));
    assert.equal(copies['Copy deeplink'], 'codex://threads/' + firstThreadId);
    assert.equal(copies['Copy working directory'], peer?.threads.get(firstThreadId)?.cwd);
    assert.equal(copies['Copy as Markdown'], [
      '# ' + conversation,
      ...Array.from({ length: copyHistorySize }, (_, index) => ['> ' + copyPrompt(index), copyAnswer(index)]).flat(),
      '> Workspace parity question.', answer,
    ].join('\n\n') + '\n');
    if (!reference) assert.deepEqual(exportReads().map(call => call.params.cursor), [null, '50']);
  }
  if (probeShellActions) {
    const trigger = page.getByRole('button', { name: 'Chat actions', exact: true });
    await trigger.click();
    const menu = page.getByRole('menu').filter({ visible: true }).last();
    await menu.waitFor();
    for (const action of ['Rename', 'Pin', 'Fork', 'Archive']) {
      await menu.getByRole('menuitem', { name: action, exact: true }).waitFor();
    }
    await take('conversation-header-actions');
    await writeFile(join(directory, 'conversation-header-actions.txt'), await menu.ariaSnapshot());
    await menu.getByRole('menuitem', { name: 'Rename', exact: true }).press('End');
    if (!reference) {
      assert.equal(await page.locator(':focus').textContent(), 'Archive');
      await page.keyboard.press('Home');
      assert.equal(await page.locator(':focus').textContent(), 'Rename');
    }
    await menu.getByRole('menuitem', { name: 'Fork', exact: true }).press('ArrowRight');
    const fork = page.getByRole('menu', { name: 'Fork', exact: true });
    await fork.getByRole('menuitem', { name: 'Fork chat', exact: true }).waitFor();
    await take('fork-menu');
    await page.keyboard.press('ArrowLeft');
    await fork.waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
  }
  if (probeMessageMenu) {
    const transcript = page.locator('[data-app-shell-main-content-layout]');
    await transcript.getByRole('button', { name: 'More actions', exact: true }).last().click();
    await page.getByRole('menu').waitFor();
    await take('message-menu');
    await page.keyboard.press('Escape');
  }
  if (probeMobileSidebar) {
    assert.equal(await sidebarHit(), true, 'The sidebar remains open after selecting a conversation.');
    const main = page.locator('[data-app-shell-main-content-layout]');
    const openSidebar = await sidebar.boundingBox();
    const openMain = await main.boundingBox();
    assert.ok(openSidebar && openMain);
    assert.ok(openMain.x - openSidebar.x - openSidebar.width <= 1 &&
      openMain.x >= openSidebar.x + openSidebar.width, 'The sidebar reserves space beside the conversation.');
    assert.equal(openMain.x + openMain.width, variant.options.viewport?.width);
    if (!reference) {
      async function checkComposerControls() {
        const overlap = await page.locator('.yard-source-composer-footer').evaluate(footer => {
          const controls = Array.from(footer.querySelectorAll(':scope > button')).filter(button => button.getClientRects().length);
          const enclosure = footer.getBoundingClientRect();
          return controls.flatMap((button, index) => {
            const rect = button.getBoundingClientRect();
            const covered = controls.slice(index + 1).some(other => {
              const next = other.getBoundingClientRect();
              return rect.right > next.left && rect.left < next.right && rect.bottom > next.top && rect.top < next.bottom;
            });
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return rect.left >= enclosure.left && rect.right <= enclosure.right && rect.width >= 24 && !covered &&
              button.contains(hit)
              ? [] : [{ control: button.getAttribute('aria-label'), rect: rect.toJSON(), footer: enclosure.toJSON(),
                hit: hit?.tagName, hitClass: hit?.className, viewport: [innerWidth, innerHeight, visualViewport?.width, visualViewport?.height] }];
          });
        });
        assert.deepEqual(overlap, [], 'Toolbar buttons fit and remain hit-testable beside the sidebar.');
      }
      async function checkHeaderControls() {
        const covered = await page.locator([
          '[data-source-thread-title] > button', 'button[aria-label="Chat actions"]',
          'button[aria-label="Toggle terminal"]', 'button[aria-label="Open right sidebar"]', 'button[aria-label="Summary"]',
        ].join(',')).evaluateAll(buttons => buttons.flatMap((button, index) => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          const overlaps = buttons.slice(index + 1).some(other => {
            const next = other.getBoundingClientRect();
            return rect.left < next.right && rect.right > next.left && rect.top < next.bottom && rect.bottom > next.top;
          });
          return rect.width > 0 && button.contains(hit) && !overlaps ? [] : [{
            control: button.getAttribute('aria-label') ?? button.textContent, rect: rect.toJSON(), overlaps, hit: hit?.tagName,
          }];
        }));
        assert.deepEqual(covered, [], 'The conversation title and header controls remain separately hit-testable.');
      }
      await checkComposerControls();
      await checkHeaderControls();
      const originalViewport = variant.options.viewport!;
      await page.setViewportSize({ width: 320, height: originalViewport.height });
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      await checkComposerControls();
      await checkHeaderControls();
      await page.setViewportSize(originalViewport);
    }
    await page.touchscreen.tap(380, 415);
    await take('after-sidebar-outside-click');
    assert.equal(await sidebarHit(), true, 'Tapping the transcript does not close the mobile sidebar.');
    await toggleSidebar();
    await take('conversation-with-sidebar-closed');
    assert.equal(await sidebarHit(), false, 'The control closes the sidebar.');
    const closedMain = await main.boundingBox();
    assert.equal(closedMain?.x, 0);
    assert.equal(closedMain?.width, variant.options.viewport?.width);
  }
  if (probeRightTools) {
    const main = page.locator('[data-app-shell-main-content-layout]').first();
    const mainBefore = await main.boundingBox();
    const openRight = page.getByRole('button', { name: reference ? 'Toggle side panel' : 'Open right sidebar', exact: true });
    const tools = page.locator('[data-new-tab-scroll-root]:visible');
    async function openTools() {
      if (!await tools.count()) await openRight.click();
      if (reference && !await tools.count()) {
        await page.getByRole('button', { name: /^(新(?:建)?标签页|New tab)$/ }).first().click({ timeout: 4_000 });
      }
      await tools.getByRole('button', { name: 'Terminal', exact: true }).waitFor({ timeout: 6_000 });
      if (reference) {
        const exit = page.getByRole('button', { name: /^(退出完整视图|Exit full (?:view|screen))$/ });
        if (await exit.count()) await exit.click();
      }
    }
    try {
      await openTools();
      await tools.getByRole('button', { name: 'Terminal', exact: true }).waitFor({ timeout: 6_000 });
      await tools.getByRole('button', { name: 'Side chat', exact: true }).waitFor({ timeout: 6_000 });
      await tools.getByRole('button', { name: 'Files', exact: true }).waitFor({ timeout: 6_000 });
      await tools.getByRole('searchbox', { name: '搜索文件或输入网址', exact: true }).waitFor({ timeout: 6_000 });
    } catch (error) {
      await take('right-tools-unavailable');
      throw error;
    }
    await take('right-tools');
    if (probePaneResize) {
      const label = 'Resize workspace panes';
      const splitter = page.getByRole('separator', { name: label, exact: true });
      const widthAtom = 'app-shell:right-panel-width:v3';
      const measure = async () => Number(await splitter.getAttribute('aria-valuenow'));
      async function waitForWidth(width: number) {
        await page.waitForFunction(({ label, width }) => {
          const separator = document.querySelector(`[role="separator"][aria-label="${label}"]`);
          return separator?.hasAttribute('aria-valuenow') && Math.abs(Number(separator.getAttribute('aria-valuenow')) - width) < 0.5;
        }, { label, width }, { timeout: 7_000 });
      }
      await splitter.waitFor();
      const initial = await measure();
      assert.ok(initial > 520 && initial < 700, 'The first split follows the reference default width.');
      await splitter.press('ArrowRight');
      await waitForWidth(initial - 10);
      await splitter.press('Home');
      await waitForWidth(Number(await splitter.getAttribute('aria-valuemin')));
      const largest = Number(await splitter.getAttribute('aria-valuemax'));
      await splitter.press('End');
      await waitForWidth(largest);
      await splitter.dblclick();
      // The reference computes its reset width from the actual workspace available after the border.
      await waitForWidth(640);
      const beforeDrag = await splitter.boundingBox();
      assert.ok(beforeDrag);
      const x = beforeDrag.x + beforeDrag.width / 2, y = beforeDrag.y + beforeDrag.height / 2;
      const draftBefore = await editor.textContent();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 84, y, { steps: 4 });
      await page.mouse.up();
      const adjusted = 640 - 84;
      await waitForWidth(adjusted);
      await page.waitForFunction(key => {
        const width = JSON.parse(localStorage.getItem('native-atoms') ?? '{}')[key] as unknown;
        return typeof width === 'number' && width > 0.4 && width < 0.7;
      }, widthAtom, { timeout: 7_000 });
      assert.equal(await editor.textContent(), draftBefore);
      await take('right-tools-resized');
      await page.reload({ waitUntil: 'commit' });
      await editor.waitFor();
      await waitForModel(page);
      await openTools();
      await waitForWidth(adjusted);
      await writeFile(join(directory, 'pane-resize.json'), JSON.stringify({ initial, adjusted, reloaded: await measure() }, null, 2));
    }
    if (!reference) {
      const draftBefore = await editor.textContent();
      for (const width of [800, 390]) {
        const viewport = page.viewportSize()!;
        await page.setViewportSize({ ...viewport, width });
        assert.ok(await tools.getByRole('button', { name: 'Terminal', exact: true }).isVisible());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.setViewportSize(viewport);
      }
      assert.equal(await editor.textContent(), draftBefore);
    }
    await page.getByRole('button', { name: reference ? 'Toggle side panel' : 'Close right sidebar', exact: true }).click();
    await tools.waitFor({ state: 'hidden' });
    await editor.waitFor({ state: 'visible' });
    if (!reference) assert.equal((await main.boundingBox())?.width, mainBefore?.width, 'Hiding the tool tab restores editor width.');
  }
  if (probeHeader) {
    const titlebar = page.locator('[data-app-shell-titlebar]');
    await titlebar.getByRole('button', { name: conversation, exact: true }).click();
    const title = titlebar.getByRole('textbox');
    await title.waitFor();
    assert.equal(await title.inputValue(), conversation);
    await take('rename');
    await title.press('Escape');
  }
  if (probeActivity && peer) {
    const details = page.getByRole('button', { name: /^Worked for/ }).last();
    await details.waitFor();
    const scoped = () => peer.calls('thread/items/list').filter(call => call.params.turnId === 'parity-turn-0');
    assert.equal(scoped().length, 0);
    assert.equal(await page.getByText(activityText, { exact: true }).count(), 0);
    await details.click();
    await page.getByText(activityText, { exact: true }).waitFor();
    assert.ok(scoped().every(call => call.params.threadId === firstThreadId) && scoped().length > 0);
    await page.getByText('Ran fixture-command', { exact: true }).waitFor();
    await take('expanded-activity');
    if (!reference) assert.ok(scoped().some(call => call.params.cursor != null), 'Expanded activity receives additional pages.');
    await page.getByRole('button', { name: 'Ran fixture-command', exact: true }).click();
    const output = page.getByText('Recorded activity output', { exact: true });
    await output.waitFor({ timeout: 7_000 });
    await output.click({ trial: true, timeout: 3_000 });
    await take('expanded-command');
    await details.click();
    await page.getByText(activityText, { exact: true }).waitFor({ state: 'hidden' });
    const count = scoped().length;
    await details.click();
    await page.getByText(activityText, { exact: true }).waitFor();
    assert.equal(scoped().length, count);
    await details.click();
    await page.getByText(answer, { exact: true }).waitFor();
  }
  if (probeActivityStream && peer) {
    const thread = peer.threads.get(firstThreadId)!;
    const turnId = 'live-workspace-tools';
    const send = (method: string, params: object, threadId = thread.id) =>
      peer.broadcast({ method, params: { threadId, turnId, ...params } });
    const command = { ...commandItem('same-command', '', thread.cwd), status: 'inProgress', exitCode: null };
    const file = { id: 'patch', type: 'fileChange', status: 'inProgress', changes: [] };
    const tool = { id: 'mcp', type: 'mcpToolCall', server: 'fixture', tool: 'inspect', status: 'inProgress', arguments: { count: 2 } };
    const reason = { id: 'reason', type: 'reasoning', summary: [] };
    const plan = { id: 'plan', type: 'plan', text: '' };
    const started = fixtureTurn(turnId, [], 'inProgress');
    thread.turns.push(started);
    send('turn/started', { turn: started });
    const firstComment = { ...agentItem('narration-before', ''), text: '先检查工具输出。', phase: 'commentary' };
    const secondComment = { ...agentItem('narration-after', ''), text: '再核对已记录的回复。', phase: 'commentary' };
    for (const item of [firstComment, file, tool, reason]) send('item/started', { item });
    send('item/commandExecution/outputDelta', { itemId: command.id, delta: 'first line\n' });
    send('item/started', { item: command });
    for (const item of [secondComment, plan]) send('item/started', { item });
    const grouped = page.getByText('Used Fixture integration, edited files, ran a command', { exact: true });
    await grouped.waitFor();
    const first = page.getByText(firstComment.text, { exact: true });
    const second = page.getByText(secondComment.text, { exact: true });
    assert.ok((await first.boundingBox())!.y < (await grouped.boundingBox())!.y);
    assert.ok((await grouped.boundingBox())!.y < (await second.boundingBox())!.y);
    await grouped.click();
    await page.getByText('Running fixture-command', { exact: true }).click();
    const output = page.getByLabel('Command output', { exact: true });
    await page.getByText('first line', { exact: true }).waitFor();
    send('item/commandExecution/outputDelta', { itemId: command.id, delta: 'Unrelated thread\n' }, '00000000-0000-4000-8000-000000000002');
    send('item/commandExecution/outputDelta', { itemId: command.id, delta: 'second line' });
    await page.getByText('first line second line', { exact: true }).waitFor();
    assert.equal(await output.textContent(), 'first line\nsecond line');
    const changes = [{ path: 'example.ts', kind: { type: 'add' }, diff: '+ fixture data' }];
    send('item/fileChange/patchUpdated', { itemId: file.id, changes });
    await page.getByText('Editing files', { exact: true }).click();
    await page.getByText('+ fixture data', { exact: true }).waitFor();
    send('item/mcpToolCall/progress', { itemId: tool.id, message: 'Reading tool fixture' });
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await page.getByText('Reading tool fixture', { exact: true }).waitFor();
    send('item/reasoning/summaryTextDelta', { itemId: reason.id, summaryIndex: 0, delta: 'Reviewing the fixture' });
    send('item/reasoning/textDelta', { itemId: reason.id, contentIndex: 0, delta: 'Private reasoning fixture' });
    send('item/plan/delta', { itemId: plan.id, delta: 'Planned fixture step' });
    await page.getByText('Reviewing the fixture', { exact: true }).waitFor();
    await page.getByText('Planned fixture step', { exact: true }).waitFor();
    assert.equal(await page.getByText('Private reasoning fixture', { exact: true }).count(), 0);
    await take('tools-live');
    const result = { ...tool, status: 'completed', result: { content: [{ type: 'text', text: 'Stored MCP result' }] } };
    const finished = { ...command, status: 'completed', aggregatedOutput: 'canonical command output', exitCode: 0 };
    send('item/completed', { item: finished });
    send('item/commandExecution/outputDelta', { itemId: command.id, delta: 'Late output that must not be shown' });
    await page.getByText('canonical command output', { exact: true }).waitFor();
    assert.equal(await output.textContent(), 'canonical command output');
    send('item/completed', { item: result });
    await page.getByText('Stored MCP result', { exact: true }).waitFor();
    const persisted = { ...fixtureTurn(turnId, [finished, result, { ...file, status: 'completed', changes },
      { ...agentItem('live-answer', 'Finished with recorded activity.'), phase: 'final_answer' }]), durationMs: 42_000 };
    thread.turns[thread.turns.length - 1] = persisted;
    send('turn/completed', { turn: { ...persisted, items: [], itemsView: 'summary' } });
    await page.getByText('Finished with recorded activity.', { exact: true }).waitFor();
    const itemReads = () => peer.calls('thread/items/list').filter(call => call.params.turnId === turnId);
    assert.ok(itemReads().every(call => call.params.threadId === firstThreadId));
    const count = itemReads().length;
    await page.reload({ waitUntil: 'commit' });
    await page.getByText('Finished with recorded activity.', { exact: true }).waitFor();
    assert.equal(itemReads().length, count, 'Reloading a collapsed turn leaves its activity unread.');
    await page.getByRole('button', { name: 'Worked for 42s', exact: true }).click();
    await page.getByText('Used Fixture integration, edited a file, ran a command', { exact: true }).click();
    await page.getByText('Ran fixture-command', { exact: true }).click();
    await page.getByText('canonical command output', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await page.getByText('Stored MCP result', { exact: true }).waitFor();
    await page.getByText('Changed files', { exact: true }).click();
    await page.getByText('+ fixture data', { exact: true }).waitFor();
    assert.ok(itemReads().length > count && itemReads().every(call => call.params.threadId === firstThreadId));
    await take('tools-recorded');
    const transcript = page.getByRole('region', { name: 'Conversation', exact: true });
    const long = 'AnUnbrokenToken'.repeat(80);
    const text = '### 验证中文长文和工具日志 ' + long + '\n\n' +
      '| 路径 | 用途 | 状态 | 备注 |\n| --- | --- | --- | --- |\n| ' + long + ' | 显示 | 完成 | 对照 |\n\n' +
      '```ts\nconst fixture = "' + long + '";\n```';
    const rich = fixtureTurn('rich-fixture', [
      { ...agentItem('rich-answer', text), phase: 'final_answer' },
    ]);
    thread.turns.push(rich);
    send('turn/completed', { turn: { ...rich, items: [], itemsView: 'summary' } });
    await transcript.locator('[data-code-block-source]').waitFor();
    for (const width of [1440, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await transcript.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      assert.ok(await transcript.locator('[data-code-block-source]').evaluate(element => element.scrollWidth > element.clientWidth));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await take('rich-content-390');
    await page.setViewportSize(variant.options.viewport!);
  }
  if (probeTurnPresentation && peer) {
    const thread = peer.threads.get(firstThreadId)!;
    const threadId = thread.id;
    const save = async (state: string) => {
      await take(state, page, true);
      await writeFile(join(directory, variant.name + '-' + state + '.aria.txt'), await page.locator('body').ariaSnapshot());
    };
    if (variant.name.startsWith('mobile') && await page.locator('#app-shell-sidebar').isVisible()) {
      await page.locator(sidebarToggle).first().click();
    }
    const promptText = '检查工作区的工具记录。';
    const editor = page.locator(editorSelector).first();
    await editor.fill(promptText);
    await page.getByRole('button', { name: /^Send(?: message)?$/, exact: true }).click({ timeout: 6_000 });
    await peer.waitFor(message => message.method === 'turn/start' && message.params.threadId === threadId, 5_000);
    try { await page.locator('[data-user-message-bubble]').getByText(promptText, { exact: true }).waitFor({ timeout: 6_000 }); }
    finally { await save('turn-waiting'); }
    const started = thread.turns.at(-1)!;
    assert.equal(started.status, 'inProgress', 'Use the turn accepted by the host.');
    const turnId = started.id, prompt = started.items[0]!;
    const send = (method: string, params: object) => peer.broadcast({ method, params: { threadId, turnId, ...params } });
    send('thread/status/changed', { status: thread.status });

    const first = { ...agentItem('turn-first-progress', ''), text: '先读取报告和目录，再做修改。', phase: 'commentary' as const };
    const firstLine = page.locator('p').filter({ hasText: first.text }).first();
    send('item/started', { item: { ...first, text: '' } });
    send('item/agentMessage/delta', { itemId: first.id, delta: first.text });
    send('item/completed', { item: first });
    await firstLine.waitFor({ timeout: 6_000 });
    const working = page.getByRole('button', { name: /^Working(?: for .+)?$/ }).last();
    const read = { ...commandItem('turn-read-report', 'report', thread.cwd), command: 'cat report.md',
      commandActions: [{ type: 'read', command: 'cat report.md', name: 'report.md', path: join(thread.cwd, 'report.md') }] };
    const list = { ...commandItem('turn-list-files', 'report.md', thread.cwd), command: 'ls',
      commandActions: [{ type: 'listFiles', command: 'ls', path: thread.cwd }] };
    send('item/started', { item: { ...read, status: 'inProgress', exitCode: null, aggregatedOutput: '' } });
    await page.getByText('Reading report.md', { exact: true }).first().waitFor({ timeout: 5_000 });
    assert.equal(await working.getAttribute('aria-expanded', { timeout: 5_000 }), 'true');
    await save('turn-reading');
    send('item/completed', { item: read });
    send('item/started', { item: list });
    send('item/completed', { item: list });
    const file = { id: 'turn-update-report', type: 'fileChange' as const, status: 'completed',
      changes: [{ path: join(thread.cwd, 'report.md'), kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new' }] };
    send('item/started', { item: file });
    send('item/completed', { item: file });
    const patch = (line: string) => 'diff --git a/report.md b/report.md\n--- a/report.md\n+++ b/report.md\n@@ -1 +1 @@\n-old\n+' + line;
    send('turn/diff/updated', { diff: patch('new') });
    const run = { ...commandItem('turn-run-check', 'sample check passed', thread.cwd), command: 'fixture-check' };
    send('item/started', { item: run });
    send('item/completed', { item: run });
    const group = page.getByRole('button', { name: /^Edited a file.*read files.*ran a command$/i }).last();

    const second = { ...agentItem('turn-second-progress', ''), text: '修改完成，接着验证结果。', phase: 'commentary' as const };
    send('item/started', { item: { ...second, text: '' } });
    send('item/agentMessage/delta', { itemId: second.id, delta: second.text });
    send('item/completed', { item: second });
    await page.getByText(second.text, { exact: true }).first().waitFor({ timeout: 6_000 });
    try { await group.waitFor({ timeout: 6_000 }); }
    finally { await save('turn-grouped'); }
    const outputPath = join(thread.cwd, 'turn-presentation-report.md');
    await writeFile(outputPath, '# Disposable report\n');
    const final = { ...agentItem('turn-final-response', ''), text: '报告已完成。\n\n[打开报告](' + outputPath + ')', phase: 'final_answer' as const };
    send('item/started', { item: { ...final, text: '' } });
    send('item/agentMessage/delta', { itemId: final.id, delta: final.text });
    await page.getByText('报告已完成。', { exact: true }).first().waitFor({ timeout: 6_000 });
    await save('turn-streaming-answer');
    const changed = page.getByRole('button', { name: /^1 file changed/ }).last();
    if (!reference) {
      await changed.waitFor({ timeout: 6_000 });
      await page.getByRole('heading', { name: 'Full access is on', exact: true }).waitFor({ state: 'hidden' });
    }
    await changed.click({ timeout: 6_000 });
    const closeRight = page.getByRole('button', { name: reference ? 'Toggle side panel' : 'Close right sidebar', exact: true });
    const changesPanel = page.getByRole('region', { name: 'Turn changes', exact: true });
    const changesTab = page.getByRole('tabpanel', { name: 'Changes', exact: true });
    try {
      await changesTab.getByRole('button', { name: 'report.md', exact: true }).waitFor({ timeout: 6_000 });
      await page.getByRole('button', { name: 'Exit full screen', pressed: true }).waitFor();
      await (reference ? page.getByRole('textbox', { name: 'Working…', exact: true }) : editor)
        .waitFor({ state: 'visible', timeout: 6_000 });
    } finally { await save('turn-live-changes'); }
    if (!reference) {
      send('turn/diff/updated', { diff: patch('new from the current turn') });
      await changesPanel.getByText('new from the current turn', { exact: true }).waitFor({ timeout: 6_000 });
      send('turn/diff/updated', { diff: patch('new') });
      await changesPanel.getByText('new', { exact: true }).waitFor();
      const diff = changesPanel.getByLabel('Diff', { exact: true });
      assert.equal(await diff.getAttribute('data-split'), variant.name.startsWith('mobile') ? 'false' : 'true');
      await changesPanel.getByRole('button', { name: 'Auto diff: switch to unified diff', exact: true }).click();
      assert.equal(await diff.getAttribute('data-split'), 'false');
      await changesPanel.getByRole('button', { name: 'Word wrap', exact: true }).click();
      assert.equal(await diff.getAttribute('data-wrap'), 'true');
      await changesPanel.getByRole('button', { name: 'Collapse all diffs', exact: true }).click();
      await diff.waitFor({ state: 'hidden' });
      await changesPanel.getByRole('button', { name: 'Jump to file', exact: true }).click();
      await changesPanel.locator('[popover]').getByRole('button', { name: 'report.md', exact: true }).click();
      await diff.waitFor();
      await changesPanel.getByRole('button', { name: 'Word wrap', exact: true }).click();
      await changesPanel.getByRole('button', { name: 'Unified diff: switch to split diff', exact: true }).click();
      await changesPanel.getByRole('button', { name: 'Split diff: switch to auto diff', exact: true }).click();
      await editor.fill('Unsent Changes draft');
    }
    await closeRight.click({ timeout: 6_000 });
    if (!reference) {
      await editor.getByText('Unsent Changes draft', { exact: true }).waitFor();
      await editor.fill('');
    }
    await working.click();
    await firstLine.waitFor({ state: 'hidden', timeout: 6_000 });
    await page.getByText('报告已完成。', { exact: true }).first().waitFor({ timeout: 6_000 });
    await working.click();
    await group.waitFor({ timeout: 6_000 });
    send('item/completed', { item: final });
    const completed = { ...fixtureTurn(turnId, [prompt, first, read, list, file, run, second, final]), durationMs: 42_000 };
    thread.turns[thread.turns.length - 1] = completed;
    thread.status = { type: 'idle' };
    send('turn/completed', { turn: completed });
    send('thread/status/changed', { status: thread.status });
    const work = page.getByRole('button', { name: 'Worked for 42s', exact: true }).last();
    await work.waitFor({ timeout: 6_000 });
    assert.equal(await work.getAttribute('aria-expanded'), 'true', 'Keep the explicit expansion when the turn completes.');
    const collapsed = page.getByRole('button', { name: 'Worked for 42s', exact: true, expanded: false }).last();
    await work.press('Enter');
    try { await collapsed.waitFor({ timeout: 6_000 }); }
    finally { await save('turn-completed'); }
    const changeCard = page.getByRole('button', { name: 'View changed files', exact: true }).last();
    await changeCard.focus();
    await changeCard.press('Enter', { timeout: 6_000 });
    try {
      if (reference) await changesTab.getByRole('button', { name: 'report.md', exact: true }).waitFor({ timeout: 6_000 });
      else {
        await changesPanel.getByText('new', { exact: true }).waitFor({ timeout: 6_000 });
        assert.equal(await page.getByRole('tab', { name: 'Changes', exact: true }).count(), 1);
      }
    } finally { await save('turn-completed-changes'); }
    await closeRight.click({ timeout: 6_000 });
    await work.press('Enter');
    await page.getByRole('button', { name: 'Worked for 42s', exact: true, expanded: true }).last().waitFor({ timeout: 6_000 });
    await firstLine.waitFor({ timeout: 6_000 });
    await group.waitFor({ timeout: 6_000 });
    await save('turn-work-open');
    await work.press('Enter');
    await collapsed.waitFor({ timeout: 6_000 });
    await firstLine.waitFor({ state: 'hidden', timeout: 6_000 });
    if (!reference) {
      const artifact = page.getByRole('button', { name: '打开报告', exact: true });
      await artifact.click();
      await page.getByText('# Disposable report', { exact: true }).waitFor({ timeout: 6_000 });
      const name = 'turn-presentation-report.md';
      const fileTab = page.getByRole('tab', { name, exact: true });
      await fileTab.waitFor();
      await page.screenshot({ path: join(directory, variant.name + '-turn-file-preview.png'), animations: 'disabled', caret: 'hide' });
      await page.getByRole('button', { name: 'Summary', exact: true }).click();
      const summaryFile = page.getByRole('button', { name, exact: true });
      await summaryFile.click({ timeout: 6_000 });
      assert.equal(await fileTab.count(), 1, 'Outputs and the message link share a single file tab.');
      await page.getByRole('button', { name: 'Close right sidebar', exact: true }).click();
      await page.getByText('报告已完成。', { exact: true }).first().waitFor();
      await page.reload({ waitUntil: 'commit' });
      await page.getByRole('button', { name: 'View changes', exact: true }).last().click({ timeout: 8_000 });
      await changesPanel.getByText('new', { exact: true }).waitFor({ timeout: 5_000 });
      await closeRight.click({ timeout: 6_000 });
    }
  }
  if (probeMessages) {
    const transcript = page.getByRole('region', { name: 'Conversation', exact: true });
    try {
      await transcript.getByRole('heading', { name: messageHeading, exact: true }).waitFor({ timeout: 10_000 });
      await transcript.getByRole('listitem').getByText(messageList, { exact: true }).waitFor();
    } finally {
      await take('formatted-messages');
      await writeFile(join(directory, variant.name + '-formatted-messages.aria.txt'), await transcript.ariaSnapshot());
    }
    const copy = transcript.getByRole('button', { name: 'Copy', exact: true }).last();
    await copy.click();
    await page.waitForFunction(async expected => (await navigator.clipboard.readText()).trimEnd() === expected, messageMarkdown, { timeout: 6_000 });
    const code = transcript.getByRole('button', { name: 'Copy code', exact: true });
    await code.click();
    await page.waitForFunction(async expected => (await navigator.clipboard.readText()).trimEnd() === expected, messageCode, { timeout: 6_000 });
    await transcript.getByRole('button', { name: 'Enable word wrap', exact: true }).click();
    await transcript.getByRole('button', { name: 'Disable word wrap', exact: true }).waitFor();
    const first = transcript.getByText('First stored reply.', { exact: true });
    if (!await first.count()) {
      await transcript.getByRole('heading', { name: messageHeading }).hover();
      for (let attempt = 0; attempt < 3 && !await first.count(); attempt++) {
        await page.mouse.wheel(0, -2000);
        await first.waitFor({ timeout: 1_200 }).catch(() => {});
      }
    }
    await first.waitFor({ timeout: 10_000 });
    if (!reference) assert.ok(await transcript.evaluate(element => element.scrollTop) > 100,
      'Prepending older turns retains the visible transcript instead of scrolling to the oldest turn.');
    await take('earlier-messages');
    await transcript.evaluate(element => { element.scrollTop = 0; });
    await page.waitForFunction(() => {
      const region = document.querySelector('[aria-label="Conversation"]');
      const reply = [...(region?.querySelectorAll('p') ?? [])].find(element => element.textContent === 'First stored reply.');
      return region && reply && reply.getBoundingClientRect().top >= region.getBoundingClientRect().top;
    });
  }
  if (probeSidebarActions) {
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Pin(?: chat)?$/ }).waitFor({ timeout: 10_000 });
    await take('sidebar-actions');
    await page.getByRole('menuitem', { name: /^Pin(?: chat)?$/ }).click();
    await page.getByText('Pinned', { exact: true }).waitFor();
    assert.equal(await row.count(), 1, 'A pinned conversation is omitted from the project and recents.');
    await take('sidebar-pinned');
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Unpin(?: chat)?$/ }).click();
    await page.getByText('Pinned', { exact: true }).waitFor({ state: 'hidden' });
  }
  await editor.fill(draft);
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes('Workspace parity draft'), editorSelector);
  await take('draft');
  if (probeSearch) {
    const project = sidebar.locator('section[data-app-action-sidebar-section-heading="Projects"]');
    const projectRows = project.locator('[data-app-action-sidebar-thread-row]');
    await project.getByRole('button', { name: 'Show more', exact: true }).first().click();
    await projectRows.nth(24).waitFor();
    assert.equal(await projectRows.count(), 25);
    await take('expanded-project');
  }
  if (probeMobileSidebar && peer) {
    await toggleSidebar();
    const quick = (name: string) => (reference ? row : row.locator('..')).getByRole('button', { name, exact: true });
    await quick('Pin chat').tap();
    const pinned = page.getByText('Pinned', { exact: true });
    await pinned.waitFor();
    assert.equal(await row.count(), 1);
    await quick('Unpin chat').tap();
    await pinned.waitFor({ state: 'hidden' });
    assert.equal(await editor.textContent(), draft);
    if (!reference) {
      const thread = peer.threads.get(firstThreadId)!;
      thread.status = { type: 'active', activeFlags: [] };
      const first = fixtureTurn('first-active', [], 'inProgress');
      thread.turns.push(first);
      const confirm = page.getByRole('dialog', { name: 'Stop and archive chat?', exact: true });
      const stop = confirm.getByRole('button', { name: 'Stop and archive', exact: true });
      await quick('Archive chat').tap();
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).tap();
      await confirm.waitFor({ state: 'hidden' });
      assert.equal(peer.calls('turn/interrupt').length, 0);
      assert.equal(peer.calls('thread/archive').length, 0);
      await quick('Archive chat').tap();
      await confirm.waitFor();
      const previousDialog = await confirm.elementHandle();
      assert.ok(previousDialog);
      first.status = 'completed';
      const second = fixtureTurn('second-active', [], 'inProgress');
      thread.turns.push(second);
      await stop.tap();
      await previousDialog.waitForElementState('hidden');
      await stop.waitFor();
      assert.equal(peer.calls('turn/interrupt').length, 0);
      await stop.tap();
      const interrupted = await peer.waitForCall('turn/interrupt');
      assert.deepEqual(interrupted?.params, { threadId: firstThreadId, turnId: second.id });
    } else await quick('Archive chat').tap();
    await row.waitFor({ state: 'detached' });
    await page.waitForURL(url => url.pathname === '/' && !url.searchParams.has('initialRoute'));
    const archived = peer.calls('thread/archive');
    assert.equal(archived.length, 1);
    assert.equal(archived[0]?.params.threadId, firstThreadId);
  }
  if (probeSidebarActions) {
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Archive$/ }).click();
    await row.waitFor({ state: 'detached', timeout: 10_000 });
    await page.waitForURL(url => url.pathname === '/' && !url.searchParams.has('initialRoute'));
    await take('sidebar-after-archive');
    await writeFile(join(directory, variant.name + '-archive-result.json'), JSON.stringify({
      url: page.url(), draft: await editor.textContent(),
    }, null, 2));
  }
  if (probeAttachments) {
    const add = page.getByRole('button', { name: 'Add files and more', exact: true });
    await add.click();
    await add.and(page.locator('[aria-expanded="true"]')).waitFor();
    await take('attachments-menu');
    const fileChooser = page.waitForEvent('filechooser');
    await page.getByText('Files and folders', { exact: true }).click();
    const picker = await fileChooser;
    await picker.setFiles({ name: attachment, mimeType: 'text/plain', buffer: Buffer.from('An isolated attachment.') });
    await page.getByText(attachment, { exact: true }).first().waitFor();
    await take('attachment-draft');
  }
  if (probeToolbar) {
    await page.getByRole('button', { name: 'Change permissions', exact: true }).click();
    await page.getByRole('menuitem', { name: /Ask for approval/ }).waitFor();
    await take('permission-menu');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Don.t show again/ }).click();
    await page.getByText('Full access is on', { exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(key => JSON.parse(localStorage.getItem('native-atoms') || '{}')[key] === Date.now(),
      'full-access-warning-dismissed-at-v2');
  }
  if (probeOutputs) {
    const before = peer?.calls('turn/start').length;
    const summary = page.locator('[data-summary-panel-variant="summary"]:visible').first();
    await summary.getByText('Outputs', { exact: true }).waitFor();
    const create = summary.getByRole('button', { name: 'Create a file or site', exact: true }).first();
    if (reference) await create.click();
    else {
      assert.equal(documentIconRequested, false, 'A closed Outputs menu must not request its document icon.');
      await create.press('Enter');
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem' &&
        document.activeElement.closest('[role="menu"]')?.getAttribute('aria-label') === 'Create a file or site');
    }
    await page.getByText('Create document', { exact: true }).waitFor();
    await take('outputs-menu');
    await page.getByText('Create document', { exact: true }).click();
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes('Create a new document'), editorSelector);
    await take('output-draft');
    assert.equal(await editor.textContent(),
      draft + ' Create a new document with Documents. Start by asking me what it should be about.');
    assert.equal(await editor.locator('[plugin-mention-path]').getAttribute('plugin-mention-path'),
      'plugin://documents@openai-primary-runtime');
    assert.equal(peer?.calls('turn/start').length, before, 'Creating an output must not send a turn.');
  }
  if (probeApproval && peer) {
    const approvalPeer = peer;
    const command = 'printf yard-approval-fixture';
    const id = 'workspace-approval', turnId = 'workspace-approval-turn', itemId = 'workspace-approval-item';
    const thread = approvalPeer.threads.get(firstThreadId)!;
    const turn = fixtureTurn(turnId, [], 'inProgress');
    thread.turns.push(turn);
    approvalPeer.broadcast({ method: 'turn/started', params: { threadId: firstThreadId, turn } });
    thread.status = { type: 'active', activeFlags: ['waitingOnApproval'] };
    approvalPeer.broadcast({ method: 'thread/status/changed', params: { threadId: firstThreadId, status: thread.status } });
    const item = { id: itemId, type: 'commandExecution', command, cwd: thread.cwd, status: 'inProgress', commandActions: [],
      processId: null, aggregatedOutput: null, exitCode: null, durationMs: null };
    approvalPeer.broadcast({ method: 'item/started', params: { threadId: firstThreadId, turnId, item } });
    approvalPeer.broadcast({ id, method: 'item/commandExecution/requestApproval', params: { kind: 'command', threadId: firstThreadId, turnId, itemId,
      startedAtMs: Date.now(), environmentId: null, command, cwd: thread.cwd, commandActions: [],
      reason: 'Allow the isolated command?', availableDecisions: ['accept', 'decline'] } });
    try {
      await page.getByText('Allow the isolated command?', { exact: true }).first().waitFor({ timeout: 6_000 });
      await page.getByText('Awaiting approval', { exact: true }).first().waitFor({ timeout: 6_000 });
      await editor.waitFor({ state: 'hidden' });
    } finally {
      await take('command-approval');
      await writeFile(join(directory, variant.name + '-command-approval.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    await page.getByRole('button', { name: 'Allow once', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Allow for this session', exact: true }).count(), 0);
    if (!reference) {
      const other = '00000000-0000-4000-8000-000000000002', otherRequest = 901;
      const otherReason = 'Deny only the other conversation';
      approvalPeer.broadcast({ id: otherRequest, method: 'item/commandExecution/requestApproval', params: {
        threadId: other, turnId: 'other-turn', itemId: 'other-item', command: 'printf other-fixture',
        reason: otherReason, availableDecisions: ['decline'],
      } });
      await page.getByText('Awaiting approval', { exact: true }).nth(3).waitFor();
      assert.equal(await page.getByText(otherReason, { exact: true }).count(), 0);
      await page.locator(rowSelector).and(page.getByLabel('Another workspace parity conversation', { exact: true })).first().click();
      await page.getByText(otherReason, { exact: true }).waitFor();
      assert.equal(await page.getByText('Allow the isolated command?', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Deny', exact: true }).click();
      const otherReply = await approvalPeer.waitFor(message => message.id === otherRequest && 'result' in message);
      assert.deepEqual(otherReply.result, { decision: 'decline' });
      await page.getByRole('button', { name: 'Deny', exact: true }).and(page.locator(':disabled')).waitFor();
      assert.equal(await page.getByText(otherReason, { exact: true }).count(), 1, 'Wait for the server to clear the request.');
      approvalPeer.broadcast({ method: 'serverRequest/resolved', params: { threadId: other, requestId: otherRequest } });
      await page.getByText(otherReason, { exact: true }).waitFor({ state: 'hidden' });
      await row.click();
      await page.getByText('Allow the isolated command?', { exact: true }).waitFor();
    }
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    const reply = await approvalPeer.waitFor(message => message.id === id && 'result' in message);
    assert.deepEqual(reply.result, { decision: 'decline' });
    const completed = fixtureTurn(turnId, [{ ...item, status: 'declined' }]);
    thread.turns[thread.turns.length - 1] = completed;
    thread.status = { type: 'idle' };
    approvalPeer.broadcast({ method: 'serverRequest/resolved', params: { threadId: firstThreadId, requestId: id } });
    approvalPeer.broadcast({ method: 'item/completed', params: { threadId: firstThreadId, turnId, item: completed.items[0] } });
    approvalPeer.broadcast({ method: 'turn/completed', params: { threadId: firstThreadId, turn: completed } });
    approvalPeer.broadcast({ method: 'thread/status/changed', params: { threadId: firstThreadId, status: thread.status } });
    await page.getByRole('button', { name: 'Deny', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(({ selector, draft }) => document.querySelector(selector)?.textContent === draft,
      { selector: editorSelector, draft });
  }
  if (probeInputRequests && peer) {
    const threadId = firstThreadId, turnId = 'input-request-fixture', itemId = 'requested-file-change', fileRequest = 731;
    const thread = peer.threads.get(threadId)!;
    if (variant.name.startsWith('mobile') && await page.locator(sidebarToggle).first().getAttribute('aria-expanded') === 'true') {
      await page.locator(sidebarToggle).first().click();
    }
    const retainedDraft = 'Draft kept while reviewing a request';
    await page.locator(editorSelector).fill(retainedDraft);
    const turn = fixtureTurn(turnId, [], 'inProgress');
    thread.turns.push(turn);
    peer.broadcast({ method: 'turn/started', params: { threadId, turn } });
    thread.status = { type: 'active', activeFlags: ['waitingOnApproval'] };
    peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
    const item = { id: itemId, type: 'fileChange', status: 'inProgress',
      changes: [{ path: join(thread.cwd, 'proposed-fixture.txt'), kind: { type: 'add' }, diff: '+isolated fixture\n' }] };
    turn.items.push(item);
    peer.broadcast({ method: 'item/started', params: { threadId, turnId, item } });
    peer.broadcast({ id: fileRequest, method: 'item/fileChange/requestApproval', params: {
      threadId, turnId, itemId, reason: 'Review the isolated edit', grantRoot: null, startedAtMs: Date.now(),
    } });
    try {
      await page.getByRole('button', { name: /^(?:Deny|Reject|Don't allow)$/i }).waitFor({ timeout: 8_000 });
    } finally { await take('file-approval', page, true); }
    const approvalOptions = page.getByRole('button', { name: 'Approval options', exact: true });
    await approvalOptions.click();
    await take('file-approval-menu', page, true);
    await writeFile(join(directory, variant.name + '-file-approval-menu.aria.txt'), await page.locator('body').ariaSnapshot());
    await approvalOptions.click();
    await page.getByRole('button', { name: /^(?:Deny|Reject|Don't allow)$/i }).click();
    const response = await peer.waitFor(message => message.id === fileRequest && 'result' in message);
    assert.deepEqual(response.result, { decision: 'decline' });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: fileRequest } });
    peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: { ...item, status: 'declined' } } });
    const beforeQuestions = { ...commandItem('before-questions', 'Prepared questions.', thread.cwd), command: 'fixture-prepare-questions' };
    turn.items.push(beforeQuestions);
    peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: beforeQuestions } });
    const questions = [
      { id: 'color', header: 'Theme', question: 'Which theme should the isolated fixture use?', isOther: true, isSecret: false,
        options: [{ label: 'Light (Recommended)', description: 'Use the light theme' }, { label: 'Dark', description: 'Use the dark theme' }] },
      { id: 'label', header: 'Label', question: 'Which label should appear in the fixture?', isOther: true, isSecret: false,
        options: [{ label: 'Example', description: 'A normal example' }, { label: 'Fixture', description: 'A fixture label' }] },
    ];
    const inputRequest = 732;
    thread.status = { type: 'active', activeFlags: ['waitingOnUserInput'] };
    peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
    peer.broadcast({ id: inputRequest, method: 'item/tool/requestUserInput', params: {
      threadId, turnId, itemId: 'input-questions', isBlocking: true, autoResolutionMs: null, questions,
    } });
    try {
      await page.getByText(questions[0]!.question, { exact: true }).waitFor({ timeout: 8_000 });
    } finally { await take('input-request', page, true); }
    if (variant.name.startsWith('desktop')) await page.getByText('Needs input', { exact: true }).first().waitFor({ timeout: 5_000 });
    await page.getByText('Waiting for your answer', { exact: true }).first().waitFor({ timeout: 5_000 });
    await writeFile(join(directory, variant.name + '-input-request.aria.txt'), await page.locator('body').ariaSnapshot());
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await writeFile(join(directory, variant.name + '-input-request-selected.aria.txt'), await page.locator('body').ariaSnapshot());
    await page.getByRole('radio', { name: 'Dark', exact: true }).press('Enter');
    await page.getByText(questions[1]!.question, { exact: true }).waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Previous question', exact: true }).click();
    assert.equal(await page.getByRole('radio', { name: 'Dark', exact: true }).getAttribute('aria-checked'), 'true');
    await page.getByRole('button', { name: 'Next question', exact: true }).click();
    await page.getByRole('textbox', { name: 'No, and tell ChatGPT what to do differently' }).fill('Custom fixture');
    await take('input-request-last', page, true);
    await writeFile(join(directory, variant.name + '-input-request-last.aria.txt'), await page.locator('body').ariaSnapshot());
    const finish = page.getByRole('button', { name: /^(?:Submit|Send|Continue)$/ });
    await finish.click({ timeout: 6_000 });
    const answer = await peer.waitFor(message => message.id === inputRequest && 'result' in message);
    assert.deepEqual(answer.result, { answers: { color: { answers: ['Dark'] }, label: { answers: ['Custom fixture'] } } });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: inputRequest } });
    await page.getByText(questions[1]!.question, { exact: true }).waitFor({ state: 'hidden' });
    await page.locator(editorSelector).waitFor({ state: 'visible' });
    assert.equal(await page.locator(editorSelector).textContent(), retainedDraft);
    const afterQuestions = { ...commandItem('after-questions', 'Used answers.', thread.cwd), command: 'fixture-continue-questions' };
    const processed = { ...agentItem('processed-questions', 'The fixture used the answers.'), phase: 'commentary' };
    turn.items.push(afterQuestions, processed);
    peer.broadcast({ method: 'item/started', params: { threadId, turnId, item: { ...afterQuestions, status: 'inProgress' } } });
    peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: afterQuestions } });
    peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: processed } });
    const receipt = page.getByRole('button', { name: 'Asked 2 questions', exact: true });
    try {
      await receipt.press('Enter', { timeout: 6_000 });
      await page.getByText('Custom fixture', { exact: true }).waitFor({ timeout: 6_000 });
      await page.getByText('Dark', { exact: true }).waitFor({ timeout: 6_000 });
      const earlier = page.getByRole('button', { name: /edited a file.*ran a command/i }).first();
      const later = page.getByRole('button', { name: 'Ran fixture-continue-questions', exact: true });
      await later.waitFor({ timeout: 6_000 });
      const middle = (await receipt.boundingBox())!.y;
      assert.ok((await earlier.boundingBox())!.y < middle && middle < (await later.boundingBox())!.y,
        'The question receipt keeps its position between tool calls.');
      const work = page.getByRole('button', { name: /^Working(?: for .+)?$/ }).last();
      const workBox = (await work.boundingBox())!;
      const firstTool = (await earlier.boundingBox())!;
      const labelWidth = await work.evaluate(button => {
        const label = document.createRange();
        label.selectNodeContents(button);
        return label.getBoundingClientRect().width;
      });
      assert.ok(Math.abs(workBox.width - labelWidth) < 1,
        'Only the title and arrow toggle Work; the divider is separate.');
      const firstToolOffset = firstTool.y - workBox.y;
      const lines = await Promise.all([
        work, page.getByText(questions[0]!.question, { exact: true }), page.getByText('Dark', { exact: true }),
        page.getByText(questions[1]!.question, { exact: true }), page.getByText('Custom fixture', { exact: true }),
      ].map(line => line.evaluate(element => {
        const css = getComputedStyle(element);
        return { fontSize: parseFloat(css.fontSize), lineHeight: parseFloat(css.lineHeight) };
      })));
      await writeFile(join(directory, variant.name + '-input-request-work-layout.json'),
        JSON.stringify({ workWidth: workBox.width, firstToolOffset, lines }, null, 2));
      for (const { fontSize, lineHeight } of lines) assert.ok(Math.abs(lineHeight - fontSize * 1.5) < 0.05);
      assert.ok(Math.abs(firstToolOffset - (lines[0]!.lineHeight + 21)) < 1,
        'The title is followed by 4 px, the 1 px divider, and the standard 16 px activity inset.');
    } finally {
      await take('input-request-answered');
      await writeFile(join(directory, variant.name + '-input-request-answered.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    await receipt.click();
    const secondEdit = { ...item, id: 'requested-second-file-change' };
    turn.items.push(secondEdit);
    peer.broadcast({ method: 'item/started', params: { threadId, turnId, item: secondEdit } });
    peer.broadcast({ id: 733, method: 'item/fileChange/requestApproval', params: {
      threadId, turnId, itemId: secondEdit.id, grantRoot: null, startedAtMs: Date.now(),
    } });
    await page.getByRole('button', { name: 'Allow once', exact: true }).click({ timeout: 5_000 });
    assert.deepEqual((await peer.waitFor(message => message.id === 733 && 'result' in message)).result, { decision: 'accept' });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 733 } });
    const thirdEdit = { ...item, id: 'requested-third-file-change' };
    turn.items.push(thirdEdit);
    peer.broadcast({ method: 'item/started', params: { threadId, turnId, item: thirdEdit } });
    peer.broadcast({ id: 734, method: 'item/fileChange/requestApproval', params: {
      threadId, turnId, itemId: thirdEdit.id, grantRoot: null, startedAtMs: Date.now(),
    } });
    await approvalOptions.click({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Allow all edits', exact: true }).click({ timeout: 5_000 });
    await writeFile(join(directory, variant.name + '-file-approval-all.aria.txt'), await page.locator('body').ariaSnapshot());
    assert.deepEqual((await peer.waitFor(message => message.id === 734 && 'result' in message, 5_000)).result, { decision: 'acceptForSession' });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 734 } });
    peer.broadcast({ id: 735, method: 'item/tool/requestUserInput', params: {
      threadId, turnId, itemId: 'dismissed-input', isBlocking: true, autoResolutionMs: null, questions: questions.slice(0, 1),
    } });
    const dismissStart = peer.messages.length;
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click({ timeout: 5_000 });
    const dismissal = await peer.waitFor(message => message.id === 735 && 'result' in message, 5_000);
    assert.deepEqual(dismissal.result, { answers: {} });
    const interruption = await peer.waitFor(message => message.method === 'turn/interrupt' &&
      message.params.threadId === threadId && message.params.turnId === turnId, 5_000);
    assert.ok(peer.messages.indexOf(dismissal) < peer.messages.indexOf(interruption));
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 735 } });
    turn.status = 'interrupted';
    turn.durationMs = 2_000;
    thread.status = { type: 'idle' };
    peer.broadcast({ method: 'turn/completed', params: { threadId, turn } });
    peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
    await page.locator(editorSelector).waitFor({ state: 'visible' });
    assert.equal(await page.locator(editorSelector).textContent(), retainedDraft);
    await page.getByText(/^You stopped(?: after)?/).last().waitFor({ timeout: 6_000 });
    const stoppedWork = page.getByRole('button', { name: /^You stopped(?: after)?/ }).last();
    if (await stoppedWork.count() && await stoppedWork.getAttribute('aria-expanded') === 'false') await stoppedWork.click();
    const dismissed = page.getByRole('button', { name: 'Asked 1 question', exact: true });
    try {
      await dismissed.click({ timeout: 6_000 });
      await page.getByText('No answer provided', { exact: true }).waitFor({ timeout: 6_000 });
    } finally {
      await take('input-request-dismissed');
      await writeFile(join(directory, variant.name + '-input-request-dismissed.aria.txt'), await page.locator('body').ariaSnapshot());
      await writeFile(join(directory, variant.name + '-input-request-dismissed.rpc.json'), JSON.stringify(
        peer.messages.slice(dismissStart).filter(message => message.id === 735 || message.method === 'turn/interrupt')
      ));
    }
    await dismissed.click();
    const continuedTurn = fixtureTurn('input-skip-fixture', [], 'inProgress');
    thread.turns.push(continuedTurn);
    thread.status = { type: 'active', activeFlags: ['waitingOnUserInput'] };
    peer.broadcast({ method: 'turn/started', params: { threadId, turn: continuedTurn } });
    peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
    const continuationStart = peer.messages.length;
    const questionOnContinuation = { threadId, turnId: continuedTurn.id, isBlocking: true, autoResolutionMs: null };
    peer.broadcast({ id: 736, method: 'item/tool/requestUserInput', params: {
      ...questionOnContinuation, itemId: 'skipped-input', questions: questions.slice(0, 1),
    } });
    await page.getByRole('button', { name: 'Skip', exact: true }).click({ timeout: 6_000 });
    assert.deepEqual((await peer.waitFor(message => message.id === 736 && 'result' in message, 5_000)).result, { answers: {} });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 736 } });
    await page.locator(editorSelector).waitFor({ state: 'visible' });
    assert.ok(!peer.messages.slice(continuationStart).some(message => message.method === 'turn/interrupt'));
    const clearedQuestion = 'Should the fixture keep going?';
    peer.broadcast({ id: 737, method: 'item/tool/requestUserInput', params: {
      ...questionOnContinuation, itemId: 'cleared-input',
      questions: [{ ...questions[0], id: 'cleared', question: clearedQuestion }],
    } });
    const questionText = page.getByText(clearedQuestion, { exact: true });
    await questionText.waitFor({ timeout: 6_000 });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 737 } });
    await questionText.waitFor({ state: 'hidden', timeout: 6_000 });
    await page.locator(editorSelector).waitFor({ state: 'visible', timeout: 6_000 });
    assert.equal(await page.locator(editorSelector).textContent(), retainedDraft);
    assert.ok(!peer.messages.some(message => message.id === 737 && 'result' in message));
    assert.ok(!peer.messages.slice(continuationStart).some(message => message.method === 'turn/interrupt'));
    try {
      if (!reference) {
        await page.locator('.yard-source-turn[data-turn-status="inProgress"]').last()
          .getByRole('button', { name: 'Asked 1 question', exact: true }).nth(1).click({ timeout: 6_000 });
        await questionText.waitFor({ timeout: 6_000 });
        await page.getByText('No answer provided', { exact: true }).waitFor({ timeout: 6_000 });
      }
    } finally {
      await take('input-request-cleared');
      await writeFile(join(directory, variant.name + '-input-request-cleared.aria.txt'), await page.locator('body').ariaSnapshot());
    }
  }
  if (probeExternalRequests && peer) {
    const threadId = firstThreadId, turnId = 'external-request-fixture';
    const thread = peer.threads.get(threadId)!;
    if (variant.name.startsWith('mobile') && await page.locator(sidebarToggle).first().getAttribute('aria-expanded') === 'true') {
      await page.locator(sidebarToggle).first().click();
    }
    const retainedDraft = 'Draft retained during app approval';
    await page.locator(editorSelector).fill(retainedDraft);
    const turn = fixtureTurn(turnId, [], 'inProgress');
    thread.turns.push(turn);
    peer.broadcast({ method: 'turn/started', params: { threadId, turn } });
    thread.status = { type: 'active', activeFlags: ['waitingOnApproval'] };
    peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
    const reason = 'Allow isolated report access?';
    const permissions = { network: { enabled: true }, fileSystem: null };
    peer.broadcast({ id: 811, method: 'item/permissions/requestApproval', params: {
      threadId, turnId, itemId: 'external-permissions', environmentId: null, startedAtMs: Date.now(),
      cwd: thread.cwd, reason, permissions,
    } });
    try { await page.getByText(reason, { exact: true }).first().waitFor({ timeout: 6_000 }); }
    finally {
      await take('permissions-request', page, true);
      await writeFile(join(directory, variant.name + '-permissions-request.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    await page.getByRole('button', { name: 'Approval options', exact: true }).click({ timeout: 5_000 });
    await take('permissions-menu', page, true);
    await writeFile(join(directory, variant.name + '-permissions-menu.aria.txt'), await page.locator('body').ariaSnapshot());
    await page.getByRole('button', { name: 'Approval options', exact: true }).click();
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    assert.deepEqual((await peer.waitFor(message => message.id === 811 && 'result' in message)).result, { permissions: {}, scope: 'turn' });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 811 } });
    const beforePermission = { ...commandItem('before-permission', 'Prepared the report.', thread.cwd), command: 'fixture-prepare-permission' };
    turn.items.push(beforePermission);
    peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: beforePermission } });
    const requestedPath = join(thread.cwd, 'report');
    const fileSystem = { read: null, write: [requestedPath], entries: [{ path: { type: 'path', path: requestedPath }, access: 'write' }] };
    peer.broadcast({ id: 813, method: 'item/permissions/requestApproval', params: {
      threadId, turnId, itemId: 'external-file-permissions', environmentId: null, startedAtMs: Date.now(),
      cwd: thread.cwd, reason: 'Allow isolated report writes?', permissions: { network: null, fileSystem },
    } });
    const permissionProgressText = 'The fixture is preparing the report.';
    const permissionProgress = { ...agentItem('permission-progress', permissionProgressText), phase: 'commentary' };
    turn.items.push(permissionProgress);
    peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: permissionProgress } });
    await page.getByText('Allow isolated report writes?', { exact: true }).first().waitFor({ timeout: 6_000 });
    await take('permissions-files', page, true);
    await writeFile(join(directory, variant.name + '-permissions-files.aria.txt'), await page.locator('body').ariaSnapshot());
    const activityWaiting = page.getByText('Awaiting approval', { exact: true })
      .and(page.locator('body :not(#app-shell-sidebar *)'));
    await page.getByText(permissionProgressText, { exact: true }).waitFor({ timeout: 6_000 });
    assert.equal(await activityWaiting.count(), 0);
    await page.getByRole('button', { name: 'Allow once', exact: true }).click({ timeout: 5_000 });
    const fileReply = (await peer.waitFor(message => message.id === 813 && 'result' in message)).result;
    assert.deepEqual(fileReply, { permissions: { fileSystem }, scope: 'turn', strictAutoReview: false });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 813 } });
    await page.getByText('Allow isolated report writes?', { exact: true }).first().waitFor({ state: 'hidden', timeout: 6_000 });
    assert.equal(await activityWaiting.count(), 0);
    await take('permissions-files-resolved');
    peer.broadcast({ id: 814, method: 'item/permissions/requestApproval', params: {
      threadId, turnId, itemId: 'external-session-permissions', environmentId: null, startedAtMs: Date.now(),
      cwd: thread.cwd, reason, permissions,
    } });
    await page.getByRole('button', { name: 'Approval options', exact: true }).click({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Allow this conversation', exact: true }).click({ timeout: 5_000 });
    assert.deepEqual((await peer.waitFor(message => message.id === 814 && 'result' in message)).result,
      { permissions: { network: permissions.network }, scope: 'session', strictAutoReview: false });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 814 } });
    thread.status = { type: 'active', activeFlags: ['waitingOnUserInput'] };
    peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
    const message = 'Configure the isolated report integration.';
    const formRequest = {
      threadId, turnId, serverName: 'report-fixture', mode: 'form', _meta: null, message,
      requestedSchema: { type: 'object', required: ['title', 'copies'], properties: {
        title: { type: 'string', title: 'Report title', description: 'Name shown on the report' },
        copies: { type: 'integer', title: 'Copies', minimum: 1, maximum: 9, default: 2 },
        detailed: { type: 'boolean', title: 'Include details', default: true },
        format: { type: 'string', title: 'Format', enum: ['Markdown', 'HTML'], default: 'HTML' },
        sections: { type: 'array', title: 'Sections', items: { type: 'string', enum: ['Summary', 'Changes'] } },
      } },
    };
    peer.broadcast({ id: 812, method: 'mcpServer/elicitation/request', params: formRequest });
    try { await page.getByText(message, { exact: true }).first().waitFor({ timeout: 6_000 }); }
    finally {
      await take('mcp-form', page, true);
      await writeFile(join(directory, variant.name + '-mcp-form.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    await page.getByRole('textbox', { name: 'Report title', exact: true }).fill('Disposable report');
    for (const [index, label] of ['Copies', 'Include details', 'Format', 'Sections'].entries()) {
      if (index === 3) await page.getByRole('radio', { name: 'Markdown', exact: true }).press('Space', { timeout: 5_000 });
      else await page.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 5_000 });
      await page.getByText(label, { exact: true }).first().waitFor({ timeout: 5_000 });
      await take('mcp-field-' + index, page, true);
      await writeFile(join(directory, variant.name + '-mcp-field-' + index + '.aria.txt'), await page.locator('body').ariaSnapshot());
      if (index === 0) {
        await page.getByRole('button', { name: 'Previous question', exact: true }).click({ timeout: 5_000 });
        assert.equal(await page.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(), 'Disposable report');
        await page.getByRole('button', { name: 'Next question', exact: true }).click({ timeout: 5_000 });
        await page.getByRole('spinbutton', { name: 'Copies' }).fill('3', { timeout: 5_000 });
      }
      if (index === 1) await page.getByRole('checkbox', { name: 'Include details' }).press('Space', { timeout: 5_000 });
    }
    await page.getByRole('checkbox', { name: 'Changes', exact: true }).press('Space', { timeout: 5_000 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 5_000 });
    const submittedForm = (await peer.waitFor(message => message.id === 812 && 'result' in message, 5_000)).result;
    assert.deepEqual(submittedForm, {
      action: 'accept', content: { title: 'Disposable report', copies: 3, detailed: false, format: 'Markdown', sections: ['Changes'] }, _meta: null,
    });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 812 } });
    peer.broadcast({ id: 817, method: 'mcpServer/elicitation/request', params: formRequest });
    await page.getByRole('textbox', { name: 'Report title', exact: true }).fill('Retained answer');
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click({ timeout: 5_000 });
    await page.getByRole('spinbutton', { name: 'Copies' }).waitFor({ timeout: 5_000 });
    await assert.rejects(peer.waitFor(message => message.id === 817 && 'result' in message, 300), /Timed out/);
    await page.getByRole('button', { name: 'Previous question', exact: true }).click({ timeout: 5_000 });
    assert.equal(await page.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(), 'Retained answer');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 5_000 });
    assert.deepEqual((await peer.waitFor(message => message.id === 817 && 'result' in message, 5_000)).result,
      { action: 'cancel', content: null, _meta: null });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 817 } });
    const websiteRequest = {
      threadId, turnId: null, serverName: 'report-fixture', mode: 'url', _meta: null, message: 'Finish the isolated report setup.',
      url: 'https://example.invalid/setup', elicitationId: 'report-setup-fixture',
    };
    peer.broadcast({ id: 815, method: 'mcpServer/elicitation/request', params: websiteRequest });
    try { await page.getByText('Finish the isolated report setup.', { exact: true }).first().waitFor({ timeout: 6_000 }); }
    finally {
      await take('mcp-url', page, true);
      await writeFile(join(directory, variant.name + '-mcp-url.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    await page.getByRole('button', { name: /^Not now/ }).click({ timeout: 5_000 });
    assert.deepEqual((await peer.waitFor(message => message.id === 815 && 'result' in message, 5_000)).result,
      { action: 'decline', content: null, _meta: null });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 815 } });
    const context = page.context();
    await context.route(websiteRequest.url, route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Disposable setup fixture' }));
    peer.broadcast({ id: 816, method: 'mcpServer/elicitation/request', params: {
      ...websiteRequest, elicitationId: 'allowed-setup-fixture',
    } });
    const opened = page.waitForEvent('popup', { timeout: 6_000 }).catch(() => undefined);
    await page.getByRole('button', { name: /^Open link/ }).click({ timeout: 5_000 });
    await page.getByRole('button', { name: /^Continue/ }).waitFor({ timeout: 5_000 });
    await take('mcp-url-continue', page, true);
    await assert.rejects(peer.waitFor(message => message.id === 816 && 'result' in message, 300), /Timed out/);
    const popup = await opened;
    assert.ok(popup, 'The consented URL opens in a separate browser tab.');
    await popup.waitForURL(websiteRequest.url, { timeout: 5_000 });
    await popup.close();
    await context.unroute(websiteRequest.url);
    await page.getByRole('button', { name: /^Continue/ }).click({ timeout: 5_000 });
    assert.deepEqual((await peer.waitFor(message => message.id === 816 && 'result' in message, 5_000)).result,
      { action: 'accept', content: {}, _meta: null });
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 816 } });
    await page.locator(editorSelector).waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await page.locator(editorSelector).textContent(), retainedDraft);
  }
  if (probeMcpConfirmation && peer) {
    const threadId = firstThreadId, turnId = 'mcp-confirmation-fixture';
    const thread = peer.threads.get(threadId)!;
    if (variant.name.startsWith('mobile') && await page.locator('#app-shell-sidebar').isVisible()) {
      await page.locator(sidebarToggle).first().click();
    }
    const retainedDraft = 'Draft retained during a confirmation';
    await page.locator(editorSelector).fill(retainedDraft);
    const turn = fixtureTurn(turnId, [], 'inProgress');
    thread.turns.push(turn);
    peer.broadcast({ method: 'turn/started', params: { threadId, turn } });
    const previousTool = { ...commandItem('mcp-history-before', 'Prepared the report', thread.cwd), command: 'fixture-prepare-report' };
    if (probeMcpHistory) {
      turn.items.push(previousTool);
      peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: previousTool } });
    }
    thread.status = { type: 'active', activeFlags: ['waitingOnApproval'] };
    peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
    const params = {
      threadId, turnId, serverName: 'report-fixture', mode: 'form', message: 'Approve changes to the isolated report project.',
      requestedSchema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] },
      _meta: { 'openai/confirmation': { version: 1, field: 'approved', presentation: {
        title: 'Review report change', triggerLabel: 'Review change', confirmLabel: 'Save report rule', icon: 'shield',
        fields: [
          { label: 'Rule', value: 'Include weekly reports.\nPreserve any draft.' },
          { label: 'Scope', value: 'Isolated project only' },
        ],
        sections: [{ title: 'Proposed rule', bodyField: 0, captionField: 1 }],
      } } },
    };
    peer.broadcast({ id: 821, method: 'mcpServer/elicitation/request', params });
    const trigger = page.getByRole('button', { name: 'Review change', exact: true }).last();
    try { await trigger.waitFor({ timeout: 6_000 }); }
    finally {
      await take('mcp-confirmation-request', page, true);
      await writeFile(join(directory, variant.name + '-mcp-confirmation-request.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    await trigger.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Review report change', exact: true });
    const approve = dialog.getByRole('button', { name: 'Save report rule', exact: true });
    try {
      await dialog.waitFor({ timeout: 6_000 });
      await dialog.getByText('Proposed rule', { exact: true }).waitFor();
      await dialog.getByText('Isolated project only', { exact: true }).waitFor();
      const geometry = await dialog.evaluate(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x, y, width, height, viewport: { width: innerWidth, height: innerHeight },
          background: style.backgroundColor, radius: style.borderRadius, overflow: element.scrollWidth - element.clientWidth };
      });
      assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= geometry.viewport.width,
        'The review stays within the viewport.');
      assert.ok(geometry.overflow <= 1, 'Review details fit without horizontal scrolling.');
      await writeFile(join(directory, variant.name + '-mcp-confirmation-geometry.json'), JSON.stringify(geometry, null, 2));
    } finally {
      await take('mcp-confirmation-dialog', page, true);
      await writeFile(join(directory, variant.name + '-mcp-confirmation-dialog.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    await assert.rejects(peer.waitFor(message => message.id === 821 && 'result' in message, 250), /Timed out/);
    if (!reference) {
      assert.ok(await approve.evaluate(element => element === document.activeElement));
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    if (!reference) {
      assert.ok(await trigger.evaluate(element => element === document.activeElement), 'Focus returns to the review trigger.');
    }
    await assert.rejects(peer.waitFor(message => message.id === 821 && 'result' in message, 250), /Timed out/);
    await trigger.click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await assert.rejects(peer.waitFor(message => message.id === 821 && 'result' in message, 250), /Timed out/);
    await trigger.click();
    await approve.click();
    assert.deepEqual((await peer.waitFor(message => message.id === 821 && 'result' in message, 5_000)).result,
      { action: 'accept', content: { approved: true }, _meta: null });
    if (!reference) {
      await dialog.waitFor({ state: 'hidden' });
      await trigger.and(page.locator(':disabled')).waitFor({ timeout: 5_000 });
      assert.equal(await page.locator(editorSelector).isVisible(), false, 'Wait for the host to resolve the request.');
    }
    assert.equal(peer.messages.filter(message => message.id === 821 && 'result' in message).length, 1);
    peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 821 } });
    const restoredDraft = async () => {
      await page.locator(editorSelector).waitFor({ state: 'visible', timeout: 5_000 });
      assert.equal(await page.locator(editorSelector).textContent(), retainedDraft);
    };
    await restoredDraft();

    const receipt = page.getByRole('button', { name: 'report-fixture requested information', exact: true }).first();
    const unsupported = {
      ...params, message: 'Fill in the isolated report form.',
      _meta: { 'openai/elicitation': { requestedSchema: {
        type: 'object', properties: { rule: { type: 'object', properties: { name: { type: 'string' } } } }, required: ['rule'],
      } } },
    };
    for (const { id, action, name } of [
      { id: 822, action: 'decline', name: 'Skip' }, { id: 823, action: 'cancel', name: 'Dismiss' },
    ]) {
      peer.broadcast({ id, method: 'mcpServer/elicitation/request', params: unsupported });
      const unsupportedHeading = page.getByText('This form isn’t supported in this version', { exact: true });
      try { await unsupportedHeading.waitFor({ timeout: 6_000 }); }
      finally { if (id === 822) await take('mcp-confirmation-unsupported', page, true); }
      if (probeMcpHistory && id === 822) {
        try {
          await receipt.click({ timeout: 6_000 });
          await page.getByText('Accepted', { exact: true }).waitFor({ timeout: 6_000 });
          await page.getByText('Awaiting approval', { exact: true }).first().waitFor({ timeout: 6_000 });
        } finally { await take('mcp-history-accepted'); }
      }
      await page.getByRole('button', { name, exact: true }).click();
      const response: unknown = (await peer.waitFor(message => message.id === id && 'result' in message, 5_000)).result;
      assert.deepEqual(response, { action, content: null, _meta: null });
      peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: id } });
      await restoredDraft();
    }
    if (probeMcpHistory) {
      const clearedMessage = 'The MCP server withdrew this review.';
      peer.broadcast({ id: 825, method: 'mcpServer/elicitation/request', params: {
        ...params, serverName: 'withdrawn-fixture', message: clearedMessage,
      } });
      await trigger.waitFor({ timeout: 6_000 });
      peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 825 } });
      await restoredDraft();
      const cleared = page.getByRole('button', { name: 'withdrawn-fixture requested information', exact: true });
      assert.ok(!peer.messages.some(message => message.id === 825 && 'result' in message));
      const final = { ...agentItem('mcp-receipt-final', 'The isolated review is complete.'), phase: 'final_answer' };
      const progress = { ...agentItem('mcp-receipt-progress', 'The report was checked.'), phase: 'commentary' };
      const command = commandItem('mcp-receipt-command', 'Report review complete', thread.cwd);
      thread.status = { type: 'idle' };
      const completed = { ...turn, status: 'completed' as const, items: [previousTool, command, progress, final], durationMs: 3_000 };
      thread.turns[thread.turns.indexOf(turn)] = completed;
      peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: command } });
      peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: progress } });
      peer.broadcast({ method: 'item/completed', params: { threadId, turnId, item: final } });
      peer.broadcast({ method: 'turn/completed', params: { threadId, turn: { ...completed, itemsView: 'summary', items: [final] } } });
      peer.broadcast({ method: 'thread/status/changed', params: { threadId, status: thread.status } });
      const reply = page.getByText('The isolated review is complete.', { exact: true }).first();
      const work = page.getByRole('button', { name: 'Worked for 3s', exact: true }).last();
      const expand = async () => {
        await reply.waitFor({ timeout: 6_000 });
        if (await work.getAttribute('aria-expanded', { timeout: 6_000 }) !== 'true') await work.click();
      };
      await expand();
      await receipt.waitFor({ timeout: 6_000 });
      await cleared.click({ timeout: 6_000 });
      await page.getByText(clearedMessage, { exact: true }).waitFor({ timeout: 6_000 });
      await page.getByText('Completed', { exact: true }).waitFor({ timeout: 6_000 });
      assert.ok(await page.getByText('Accepted', { exact: true }).count() <= 1);
      await cleared.click();
      const earlier = page.getByRole('button', { name: 'Ran fixture-prepare-report', exact: true }).first();
      const later = page.getByRole('button', { name: 'Ran fixture-command', exact: true }).first();
      assert.ok((await earlier.boundingBox())!.y < (await receipt.boundingBox())!.y && (await receipt.boundingBox())!.y < (await later.boundingBox())!.y,
        'The receipt stays in its original position between tool calls.');
      await take('mcp-history-work');
      const other = page.locator(rowSelector).getByText('Another workspace parity conversation', { exact: true }).first();
      const original = page.locator(rowSelector).getByText(conversation, { exact: true }).first();
      async function choose(thread: Locator) {
        const toggle = page.locator(sidebarToggle).first();
        if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        await thread.click({ timeout: 6_000 });
      }
      await choose(other);
      await page.getByText('Another workspace parity answer.', { exact: true }).first().waitFor({ timeout: 6_000 });
      await choose(original);
      await expand();
      await receipt.waitFor({ timeout: 6_000 });
      await take('mcp-history-switched');

      const itemReads = () => peer.calls('thread/items/list').filter(call => call.params.threadId === threadId && call.params.turnId === turnId).length;
      const beforeReload = itemReads();
      await page.reload({ waitUntil: 'domcontentloaded' });
      try {
        await expand();
        await peer.waitFor(() => itemReads() > beforeReload, 6_000);
        if (!reference) await page.getByText('The report was checked.', { exact: true }).first().waitFor({ timeout: 6_000 });
        assert.equal(await receipt.count(), 0, 'A reload does not recreate a local user decision from ordinary history.');
      } finally {
        await take('mcp-history-reloaded');
        await writeFile(join(directory, variant.name + '-mcp-history-reloaded.aria.txt'), await page.locator('body').ariaSnapshot());
      }
      await writeFile(join(directory, variant.name + '-mcp-history-reloaded.json'),
        JSON.stringify({ receipts: await receipt.count() }, null, 2));
    }
    if (!reference && !probeMcpHistory) {
      const confirmation = params._meta['openai/confirmation'];
      peer.broadcast({ id: 824, method: 'mcpServer/elicitation/request', params: {
        ...params, _meta: { 'openai/confirmation': {
          ...confirmation, presentation: { ...confirmation.presentation, destructive: true },
        } },
      } });
      await trigger.press('Enter', { timeout: 5_000 });
      await dialog.waitFor({ timeout: 5_000 });
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      assert.ok(await cancel.evaluate(element => element === document.activeElement));
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      await assert.rejects(peer.waitFor(message => message.id === 824 && 'result' in message, 250), /Timed out/);
      peer.broadcast({ method: 'serverRequest/resolved', params: { threadId, requestId: 824 } });
      await restoredDraft();
    }
  }
  // The reference may open a native destination chooser; validate the source action against the real CLI separately.
  if (probeMessageMenu && peer && !reference) {
    const more = page.locator('[data-app-shell-main-content-layout]').getByRole('button', { name: 'More actions', exact: true }).last();
    await more.click();
    await page.getByRole('menuitem', { name: 'Fork chat from here', exact: true }).click();
    const call = await peer.waitForCall('thread/fork');
    assert.equal(call?.params.threadId, firstThreadId);
    assert.equal(call?.params.lastTurnId, 'parity-turn-0');
    const branched = [...peer.threads.values()].find(thread => thread.forkedFromId === firstThreadId);
    assert.ok(branched, 'The host saved an independent branch');
    await page.waitForURL(url => decodeURIComponent(url.href).includes(branched.id));
  }
  if (probeProjectOperations && peer && !reference) {
    const name = 'Workspace parity project';
    const actions = page.getByRole('button', { name: 'Project actions for ' + name, exact: true });
    const outside = '00000000-0000-4000-8000-999999999999';
    peer.threads.set(outside, fixtureThread(outside, '/var/tmp/outside-project', { name: 'Unrelated fixture chat' }));
    await actions.press('Enter');
    await page.getByRole('menuitem', { name: 'Archive chats', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive 2 chats?', exact: true });
    await confirm.waitFor();
    const thread = peer.threads.get(firstThreadId)!;
    const current = 'newly-running-project-turn';
    thread.turns.push(fixtureTurn(current, [], 'inProgress'));
    thread.status = { type: 'active', activeFlags: [] };
    await confirm.getByRole('button', { name: 'Archive all', exact: true }).click();
    const stop = page.getByRole('dialog', { name: 'Stop and archive 2 chats?', exact: true });
    await stop.waitFor();
    assert.deepEqual(peer.calls('turn/interrupt'), []);
    assert.deepEqual(peer.calls('thread/archive'), []);
    await stop.getByRole('button', { name: 'Stop and archive', exact: true }).click();
    await stop.waitFor({ state: 'hidden' });
    assert.deepEqual(peer.calls('turn/interrupt').map(call => call.params.turnId), [current]);
    assert.equal(peer.calls('thread/archive').length, 2);
    assert.equal(peer.archived.has(outside), false);
    assert.deepEqual(peer.calls('thread/delete'), []);
  }
  // Isolate the saved-home snapshot from the conversation and its active draft.
  const browser = page.context().browser()!;
  await page.close();
  const restored = await browser.newContext({
    ...contextOptions(variant), storageState: { cookies: [], origins: [{
      origin: new URL(url).origin, localStorage: [{ name: 'native-atoms',
        value: JSON.stringify({ 'composer-prompt-drafts-v1': { 'new-conversation': savedDraft } }) }],
    }] },
  });
  try {
    const home = await restored.newPage();
    traceProjectState(home, 'restore');
    const errors: string[] = [];
    home.on('pageerror', error => errors.push(error.message));
    await home.clock.setFixedTime(date);
    await home.goto(url, { waitUntil: 'commit' });
    try {
      await home.waitForFunction(({ selector, draft }) => document.querySelector(selector)?.textContent === draft,
        { selector: editorSelector, draft: savedDraft });
      await waitForModel(home);
      if (reference) {
        await home.getByText('Full access', { exact: true }).first().waitFor({ state: 'attached' });
        await home.getByRole('button', { name: 'Toggle side panel', exact: true }).first().waitFor({ state: 'attached' });
      }
      await take('restored-home-draft', home);
      if (probeHomeProject) {
        const title = await home.locator('.heading-xl').first().textContent();
        assert.equal(title, 'What should we work on in Workspace parity project?');
        const clear = home.getByRole('button', { name: "Don't work in a project", exact: true });
        await home.locator('[data-composer-navigation-target="workspace-project"]').first().hover();
        await clear.click();
        await home.getByText('What should we build?', { exact: true }).waitFor();
        await waitForModel(home);
        assert.equal(await home.locator(editorSelector).textContent(), savedDraft);
        await home.reload({ waitUntil: 'commit' });
        await waitForModel(home);
        await home.getByText('What should we build?', { exact: true }).waitFor();
        assert.equal(await home.locator(editorSelector).textContent(), savedDraft);
        await writeFile(join(directory, 'home-project-state.json'), JSON.stringify({
          title,
          projectState,
        }, null, 2));
      }
    } catch (error) {
      await take('restored-home-draft-failed', home);
      throw new Error(variant.name + ' restored draft failed: ' + errors.join('; '), { cause: error });
    }
    await checkSend?.(home);
    assert.deepEqual(errors, []);
  } finally { await restored.close(); }
  return { frames, localEditorReadyAt };
}

async function difference(browser: Browser, expected: Frame[], actual: Frame[]) {
  assert.deepEqual(actual.map(frame => frame.name), expected.map(frame => frame.name));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return await page.evaluate(async inputs => {
      async function load(encoded: string) {
        const image = new Image();
        image.src = 'data:image/png;base64,' + encoded;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      const differences = [];
      for (const { name, reference, candidate } of inputs) {
        const a = await load(reference), b = await load(candidate);
        if (a.width !== b.width || a.height !== b.height) {
          differences.push({ name, referenceSize: [a.width, a.height], candidateSize: [b.width, b.height] });
          continue;
        }
        let changedPixels = 0;
        let x0 = a.width, y0 = a.height, x1 = 0, y1 = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
              a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
            changedPixels++;
            const x = i / 4 % a.width, y = Math.floor(i / 4 / a.width);
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          }
        }
        if (changedPixels) differences.push({ name, changedPixels, totalPixels: a.width * a.height, bounds: [x0, y0, x1, y1] });
      }
      return differences;
    }, expected.map((frame, index) => ({ name: frame.name, reference: frame.png.toString('base64'),
      candidate: actual[index]!.png.toString('base64') })));
  } finally { await context.close(); }
}

async function exerciseSend(page: Page, backend: Awaited<ReturnType<typeof createFakeCodex>>) {
  const row = page.locator(rowSelector).and(page.getByLabel(conversation, { exact: true })).first();
  await row.click();
  await page.getByText(answer, { exact: true }).waitFor();
  const editor = page.locator(editorSelector).last();
  const placeholder = editor.locator('p[data-placeholder]');
  await editor.fill('');
  await placeholder.waitFor();
  const send = page.getByRole('button', { name: 'Send message' });
  const text = 'Check the existing workspace permissions';
  await editor.fill(text);
  await placeholder.waitFor({ state: 'detached' });
  backend.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true }));
  await send.click();
  await page.getByRole('alert').getByText('Sign in to Codex to send a message.').waitFor();
  assert.equal(await editor.textContent(), text);
  assert.equal(backend.calls('turn/start').length, 0);

  backend.handlers.delete('account/read');
  backend.changePermissions(firstThreadId, { permissions: ':read-only', approvalPolicy: 'on-request' });
  await send.click();
  const sent = await backend.waitFor(message => message.method === 'turn/start');
  assert.equal(sent.params.threadId, firstThreadId);
  assert.deepEqual(sent.params.input, [{ type: 'text', text, text_elements: [] }]);
  assert.ok(sent.params.clientUserMessageId);
  for (const key of ['permissions', 'sandbox', 'sandboxPolicy', 'approvalPolicy', 'approvalsReviewer']) assert.ok(!(key in sent.params), key);
  assert.deepEqual(backend.threadPermissions.get(firstThreadId)?.activePermissionProfile, { id: ':read-only', extends: null });
  await page.getByText(text, { exact: true }).waitFor();
  assert.equal(await editor.textContent(), '');
  await placeholder.waitFor();
  assert.equal(backend.calls('turn/start').length, 1);

  // Homepage sign-in failures must not allocate an empty native thread.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const homeDraft = 'Preserve this draft without starting a session';
  const starts = backend.calls('thread/start').length;
  backend.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true }));
  await editor.fill(homeDraft);
  await send.click();
  await page.getByRole('alert').getByText('Sign in to Codex to send a message.').waitFor();
  assert.equal(await editor.textContent(), homeDraft);
  assert.equal(backend.calls('thread/start').length, starts);
  assert.equal(backend.calls('turn/start').length, 1);
}

async function createFixture(directory: string, project: string) {
  const backend = await createFakeCodex(directory);
  try {
    for (const [index, name] of [conversation, 'Another workspace parity conversation'].entries()) {
      const id = '00000000-0000-4000-8000-00000000000' + (index + 1);
      backend.threads.set(id, fixtureThread(id, project, {
        name, reasoningEffort: 'high', updatedAt: date.getTime() / 1000 - 3_600 - index * 60, path: join(directory, id + '.jsonl'),
        ...((probeProjectHover || probeProjectMarker) && index === 0 ? { status: { type: 'active', activeFlags: [] } as const } : {}),
        turns: [
          ...(probeChatCopy && index === 0 ? Array.from({ length: copyHistorySize }, (_, position) =>
            fixtureTurn('export-' + position, [
              { id: 'export-question-' + position, type: 'userMessage', content: [{ type: 'text', text: copyPrompt(position), text_elements: [] }] },
              { ...agentItem('export-answer-' + position, copyAnswer(position)), phase: 'final_answer' },
            ])) : []),
          ...(probeMessages && index === 0 ? ['First', 'Second', 'Third'].map(word =>
            fixtureTurn('old-' + word, [
              { id: 'old-question-' + word, type: 'userMessage', content: [{ type: 'text', text: word + ' stored prompt.', text_elements: [] }] },
              { ...agentItem('old-answer-' + word, word + ' stored reply.'), phase: 'final_answer' },
            ])) : []),
          {
            ...fixtureTurn('parity-turn-' + index, [
          { id: 'question-' + index, type: 'userMessage', content: [{ type: 'text', text: 'Workspace parity question.', text_elements: [] }] },
          ...(probeActivity && index === 0 ? [
            { ...agentItem('activity-comment', activityText), phase: 'commentary' },
            commandItem('activity-command', 'Recorded activity output', project),
          ] : []),
          { ...agentItem('answer-' + index, index ? 'Another workspace parity answer.' : probeMessages ? messageMarkdown : answer), phase: 'final_answer' },
            ]),
            ...(probeActivity && index === 0 ? { durationMs: 60_000, startedAt: 1_700_000_000, completedAt: 1_700_000_060 } : {}),
          }],
      }));
    }
    if (probeSearch || probeRecents) {
      for (let index = 0; index < 51; index++) {
        const id = '00000000-0000-4000-8000-' + String(100 + index).padStart(12, '0');
        backend.threads.set(id, fixtureThread(id, project, { name: 'Previous chat ' + index, updatedAt: 1_700_000_000 - index }));
      }
      const id = '00000000-0000-4000-8000-000000000999';
      backend.threads.set(id, fixtureThread(id, project, { name: olderChat, updatedAt: 1_699_990_000,
        turns: [fixtureTurn('historical-turn', [{ ...agentItem('historical-answer', olderAnswer), phase: 'final_answer' }])],
      }));
    }
    backend.handlers.set('getAuthStatus', () => ({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }));
    backend.handlers.set('initialize', () => ({ userAgent: probeRightTools || probeProjectHover || probeProjectMarker || probeProjectOperations || probeProjectTouch ? 'codex-tui/0.169.1 (Linux)' : 'codex-tui/0.163.0 (Linux)' }));
    backend.handlers.set('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: false }));
    const { config } = backend.defaultResult('config/read', {}) as { config: Record<string, unknown> };
    backend.handlers.set('config/read', () => ({ config: { ...config, profile: null }, origins: {}, layers: null }));
    backend.handlers.set('model/list', () => ({ data: ['fixture-model', 'fixture-beta'].map((model, index) => ({
      id: model, model, displayName: index ? 'Fixture Beta' : 'Fixture model', description: 'Isolated workspace model',
      isDefault: index === 0, hidden: false, defaultReasoningEffort: 'high', inputModalities: ['text'], supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Low effort' }, { reasoningEffort: 'high', description: 'High effort' },
      ],
    })), nextCursor: null }));
    if (probeAttachments) {
      backend.handlers.set('fs/createDirectory', async params => {
        assert.ok(String(params.path).startsWith(join(directory, 'uploads', 'pick-')));
        await mkdir(String(params.path), { recursive: true });
        return {};
      });
    }
    if (probeProjectHover || probeProjectMarker || probeProjectOperations || probeProjectTouch || probeTurnPresentation) {
      await mkdir(join(project, 'fixture-folder'), { recursive: true });
      backend.handlers.set('fs/getMetadata', async params => {
        const path = String(params.path);
        assert.ok(path === project || path.startsWith(project + '/'));
        const info = await stat(path);
        return { isDirectory: info.isDirectory(), isFile: info.isFile(), isSymlink: false, createdAtMs: info.birthtimeMs, modifiedAtMs: info.mtimeMs };
      });
      backend.handlers.set('fs/readDirectory', async params => {
        const path = String(params.path);
        assert.ok(path === project || path.startsWith(project + '/'));
        return { entries: (await readdir(path, { withFileTypes: true })).map(entry => ({
          fileName: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile(),
        })) };
      });
    }
    backend.handlers.set('account/gatewayOAuth/read', () => ({ providerId: 'fixture', providerName: 'Fixture', required: false, status: null, error: null }));
    backend.handlers.set('thread/resume', params => ({
      ...backend.defaultResult('thread/resume', params), turnsBackwardsCursor: '0', itemsBackwardsCursor: '0',
    }));
    if (probeActivity) backend.handlers.set('thread/items/list', params =>
      backend.defaultResult('thread/items/list', params.turnId ? { ...params, limit: 2 } : params));
    backend.handlers.set('thread/turns/list', params => {
      const turns = [...(backend.threads.get(String(params.threadId))?.turns ?? [])];
      if (params.sortDirection !== 'asc') turns.reverse();
      const start = Number(params.cursor ?? '0'), end = start + Number(params.limit ?? 50);
      return {
        data: turns.slice(start, end).map(turn => ({ ...turn,
          items: params.itemsView === 'notLoaded' ? [] : (probeActivity || probeActivityStream) && params.itemsView === 'summary'
            ? turn.items.filter(item => item.type === 'userMessage' || item.type === 'agentMessage' && item.phase !== 'commentary') : turn.items,
          itemsView: params.itemsView ?? 'full',
        })),
        nextCursor: end < turns.length ? String(end) : null, backwardsCursor: null,
      };
    });
    return backend;
  } catch (error) {
    await backend.close();
    throw error;
  }
}

const root = await mkdtemp('/tmp/yard-style-');
try {
  const project = join(root, 'workspace');
  await Promise.all([mkdir(project), mkdir(output, { recursive: true })]);
  const browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM ??
    join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
      const control = process.argv.includes('--control');
      const sendOnly = process.argv.includes('--exercise-send');
      const candidateOnly = process.argv.includes('--candidate-only') || sendOnly || probeToolRoutes || probeActivityStream || probeProjectTouch;
      const entries = candidateOnly ? [{ name: 'candidate', sourceWorkspace: true }] : [{ name: 'reference', sourceWorkspace: false }];
      if (!candidateOnly && !process.argv.includes('--reference-only')) entries.push({ name: 'candidate', sourceWorkspace: !control });
      const captures: Frame[][] = [];
      const editorTimings: Record<string, number> = {};
      for (const entry of entries) {
        const directory = join(output, entry.name);
        await mkdir(directory, { recursive: true });
        const frames: Frame[] = [];
        const selectedVariants = previewTurn ? variants.slice(0, 1) :
          probeInputRequests || probeExternalRequests || probeMcpConfirmation || probeTurnPresentation ? variants : probeMobileSidebar || probeProjectTouch ? variants.slice(-1)
          : probeProjectHover ? variants.slice(0, 2) : probeProjectOperations || probeProjectMarker ? variants.slice(0, 1)
          : sendOnly || probeOutputs || probeToolbar || probeAttachments || probeHeader || probeSidebarActions || probeApproval || probeMessages || probeActivity || probeActivityStream || probeProfile || probeProduct || probeMessageMenu || probeToolRoutes || probeSearch || probeHomeProject || probeHomeTerminal || probeShellActions || probeChatCopy || probeRecents || probeScheduleFork || probeRightTools
            ? variants.slice(0, 1) : variants;
        for (const variant of selectedVariants) {
          // A click can update native state; give every snapshot flow a fresh host.
          const profile = join(root, entry.name + '-' + variant.name);
          await mkdir(profile);
          await writeFile(join(profile, 'projects.json'), JSON.stringify([{ name: 'Workspace parity project', path: project }]));
          const backend = await createFixture(profile, project);
          try {
            const app = await createNativeWorkbench({ port: 0, dataDir: profile, workspace: project, socketPath: backend.socketPath,
              codexHome: join(profile, 'codex'), hostCatalog: { hosts: [], projects: [], assignments: {} },
              sourceWorkspace: entry.sourceWorkspace, publicOrigin: '', httpFetch: async () => new Response('Offline fixture', { status: 503 }) });
            try {
              const context = await browser.newContext(contextOptions(variant));
              try {
                if (probeMessages || probeChatCopy) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.url });
                const page = await context.newPage();
                const errors: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                const captureResult = await capture(page, variant, directory, app.url, !entry.sourceWorkspace,
                  sendOnly ? page => exerciseSend(page, backend) : undefined, backend);
                frames.push(...captureResult.frames);
                editorTimings[entry.name + ':' + variant.name] = Math.round(captureResult.localEditorReadyAt);
                assert.deepEqual(errors, [], variant.name);
              } finally { await context.close(); }
              if (previewTurn) {
                await browser.close();
                console.log('PREVIEW_URL=' + app.url + '/local/' + firstThreadId);
                await delay(45 * 60_000);
              }
            } finally { await app.close(); }
          } finally { await backend.close(); }
        }
        captures.push(frames);
      }
      const differences = captures[1] ? await difference(browser, captures[0]!, captures[1]) : null;
      const report = { compared: captures.length === 2, control, differences, editorTimings,
        sendVerified: sendOnly, toolRoutesVerified: probeToolRoutes, mobileSidebarVerified: probeMobileSidebar,
        searchVerified: probeSearch && entries.some(entry => entry.sourceWorkspace), homeProjectVerified: probeHomeProject,
        homeTerminalVerified: probeHomeTerminal, chatCopyVerified: probeChatCopy, recentsVerified: probeRecents,
        activityStreamVerified: probeActivityStream, projectHoverVerified: probeProjectHover,
        projectMarkerVerified: probeProjectMarker && entries.some(entry => entry.sourceWorkspace),
        projectOperationsVerified: probeProjectOperations, projectTouchVerified: probeProjectTouch, inputRequestsVerified: probeInputRequests,
        externalRequestsVerified: probeExternalRequests, mcpConfirmationVerified: probeMcpConfirmation,
        turnPresentationVerified: probeTurnPresentation, mcpHistoryVerified: probeMcpHistory };
      await writeFile(join(output, 'report.json'), JSON.stringify({ screenshots: captures[0]!.map(frame => frame.name), ...report }, null, 2));
      console.log(JSON.stringify({ output, screenshots: captures[0]!.length, ...report }));
      assert.ok(!differences?.length, 'Workspace screenshots differ from the pinned UI; see report.json');
  } finally { await browser.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
