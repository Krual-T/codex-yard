import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    menuFixture: {
      calls: Array<Record<string, unknown>>;
      setHost(host: string): void;
      setConnected(value: boolean): void;
      setUnresolved(value: boolean): void;
      setMoveConnected(value: boolean): void;
      holdNextThreadAction(): void;
      releaseThreadAction(): void;
    };
  }
}

test('sidebar menus use the original hierarchy and host-qualified, controlled actions', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneSidebar} from './src/renderer/sidebar/StandaloneSidebar.tsx';
      import {I18nProvider} from './src/renderer/i18n/index.tsx';
      const calls=[];
      let setHost=()=>{},setConnected=()=>{},setUnresolved=()=>{},setMoveConnected=()=>{},failEdit=true,holdNext=false,release=()=>{};
      function App(){
        const [host,hostChange]=useState('local'),[connected,connectedChange]=useState(true),
          [unresolved,unresolvedChange]=useState(false),[moveConnected,moveConnectedChange]=useState(true),
          [options,setOptions]=useState({organization:'by-project',sort:'last-updated',showProjects:true});
        setHost=hostChange;setConnected=connectedChange;setUnresolved=unresolvedChange;setMoveConnected=moveConnectedChange;
        const state={catalog:{local:{one:{id:'one',name:'Project One',rootPaths:['/one']},two:{id:'two',name:'Project Two',rootPaths:['/two']}},
          remote:[{id:'two',hostId:'remote',label:'Remote Project',remotePath:'/remote'}]},inventory:{complete:true,errors:{}},
          memberships:[{hostId:'local',threadId:'same',assignment:{projectKind:'local',projectId:'one'},projectless:false},
            {hostId:'remote',threadId:'same',assignment:{projectKind:'remote',projectId:'two',hostId:'remote'},projectless:false}],
          unresolved:{assignments:unresolved?{same:'legacy'}:{},projectless:[],qualified:[],outputDirectories:{},workspaceRoots:{},unreadable:{}},outputDirectories:[],workspaceRoots:[]};
        const rows=[{id:'same',name:'A conversation',hostId:host,archived:false,cwd:host==='local'?'/one':'/remote',status:{type:'idle'},preview:''}];
        const actions=['rename','pin','unpin','mark-unread','mark-read','move','fork','copy','copy-markdown','copy-working-directory','archive','restore','delete'];
        const projectActions=['pin','unpin','edit','open-in-file-manager','archive-chats','remove'];
        return React.createElement(I18nProvider,{locale:'en-US'},React.createElement('div',{className:'yard-app','data-sidebar-open':'true'},
          React.createElement(StandaloneSidebar,{hostId:host,currentThread:null,projectState:state,rows,nextCursor:null,loading:false,error:null,search:'',archived:false,
            onSearchChange:()=>{},onArchivedChange:()=>{},onOpenThread:()=>{},onNewChat:()=>{},onAddProject:()=>{},onClose:()=>{},onRefresh:()=>{},onLoadMore:()=>{},
            onOpenSettings:()=>calls.push({kind:'settings'}),accountLabel:'fixture',
            onSwitchProductMode:connected?mode=>calls.push({kind:'mode',mode}):undefined,
            onHelpAction:connected?action=>calls.push({kind:'help',action}):undefined,
            sidebarOptions:options,onSidebarOptionChange:connected?change=>{calls.push({kind:'option',...change});setOptions(old=>({...old,
              ...(change.type==='organization'?{organization:change.value}:change.type==='sort'?{sort:change.value}:{showProjects:change.value})}));}:undefined,
            onOpenExplore:()=>calls.push({kind:'explore'}),
            availableThreadActions:connected?()=>actions:undefined,isThreadPinned:connected?()=>false:undefined,isThreadUnread:connected?()=>false:undefined,
            onThreadAction:connected?(row,action)=>{calls.push({kind:'thread',host:row.hostId,id:row.id,action,target:null});
              if(holdNext){holdNext=false;return new Promise(resolve=>{release=resolve;});}}:undefined,
            onMoveThreadToProject:connected&&moveConnected?(row,project)=>calls.push({kind:'thread',host:row.hostId,id:row.id,action:'move',target:project}):undefined,
            availableProjectActions:connected?()=>projectActions:undefined,isProjectPinned:connected?()=>false:undefined,
            onProjectAction:connected?(project,action)=>{calls.push({kind:'project',host:project.hostId,id:project.id,action});
              if(action==='edit'&&failEdit){failEdit=false;throw Error('Project update failed');}}:undefined}),React.createElement('main')));
      }
      window.menuFixture={calls,setHost:value=>setHost(value),setConnected:value=>setConnected(value),setUnresolved:value=>setUnresolved(value),setMoveConnected:value=>setMoveConnected(value),
        holdNextThreadAction:()=>{holdNext=true;},releaseThreadAction:()=>release()};
      createRoot(document.getElementById('root')).render(React.createElement(App));
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(8_000);
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://sidebar.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      if (url.pathname === '/brand/icon.svg') return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync('public/brand/icon.svg') });
      return route.abort();
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://sidebar.test/');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.addStyleTag({ content: readFileSync('src/renderer/app/app.css', 'utf8') });
    await page.addStyleTag({ content: readFileSync('src/renderer/sidebar/standalone-sidebar.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const brand = sidebar.getByRole('button', { name: 'Switch mode, current mode: Codex' });
    await brand.click();
    const mode = page.getByRole('menu', { name: 'Switch mode, current mode: Codex' });
    assert.match(await mode.innerText(), /ChatGPT\s+Create, learn, and explore\s+Codex\s+Build, debug, and ship/);
    assert.equal(await mode.getByRole('menuitemradio', { name: /Codex/ }).getAttribute('aria-checked'), 'true');
    if (process.env.SIDEBAR_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SIDEBAR_EVIDENCE_DIR, 'sidebar-original-mode.png') });
    await mode.getByRole('menuitem', { name: /ChatGPT/ }).click();
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).at(-1), { kind: 'mode', mode: 'chatgpt' });

    const project = sidebar.getByRole('button', { name: 'Project One', exact: true }).locator('..');
    await project.hover();
    await project.getByRole('button', { name: 'Project actions for Project One' }).click();
    const projectMenu = page.getByRole('menu', { name: 'Project actions for Project One' });
    assert.deepEqual(await projectMenu.getByRole('menuitem').allTextContents(),
      ['Pin', 'Edit', 'Open in File Manager', 'Archive chats', 'Remove project']);
    assert.equal(await projectMenu.getByRole('separator').count(), 3);
    assert.ok((await projectMenu.locator('[data-menu-item="open-in-file-manager"] .yard-sidebar-menu-copy > span').boundingBox())!.height < 20);
    if (process.env.SIDEBAR_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SIDEBAR_EVIDENCE_DIR, 'sidebar-original-project.png') });
    await projectMenu.getByRole('menuitem', { name: 'Edit' }).click();
    await projectMenu.getByRole('alert').getByText('Project update failed').waitFor();
    await projectMenu.getByRole('menuitem', { name: 'Edit' }).click();
    await projectMenu.waitFor({ state: 'hidden' });
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).slice(-2), [
      { kind: 'project', host: 'local', id: 'one', action: 'edit' }, { kind: 'project', host: 'local', id: 'one', action: 'edit' },
    ]);
    await project.click({ button: 'right' });
    await projectMenu.waitFor();
    await page.keyboard.press('Escape');

    const projectGroup = project.locator('..');
    const row = projectGroup.getByRole('button', { name: 'A conversation', exact: true });
    await row.click({ button: 'right' });
    const threadMenu = page.getByRole('menu', { name: 'Conversation menu: A conversation' });
    assert.deepEqual(await threadMenu.locator(':scope > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-menu-item'))),
      ['rename', 'pin', 'unread', 'project', 'fork', 'copy', 'archive', 'delete']);
    assert.ok((await threadMenu.locator('[data-menu-item="unread"] .yard-sidebar-menu-copy > span').boundingBox())!.height < 20);
    if (process.env.SIDEBAR_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SIDEBAR_EVIDENCE_DIR, 'sidebar-original-thread.png') });
    const projectItem = threadMenu.getByRole('menuitem', { name: 'Project', exact: true });
    await projectItem.hover();
    await projectItem.focus();
    await page.keyboard.press('ArrowRight');
    const projectSubmenu = page.getByRole('menu', { name: 'Project', exact: true });
    const target = projectSubmenu.getByRole('menuitem', { name: 'Project Two' });
    assert.equal(await target.evaluate(element => element === document.activeElement), true);
    await target.click();
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).at(-1), {
      kind: 'thread', host: 'local', id: 'same', action: 'move',
      target: { id: 'two', name: 'Project Two', rootPaths: ['/two'], hostId: 'local' },
    });
    await row.click({ button: 'right' });
    await threadMenu.getByRole('menuitem', { name: 'Project', exact: true }).hover();
    await projectSubmenu.getByRole('menuitem', { name: 'Remove from Project One' }).click();
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).at(-1),
      { kind: 'thread', host: 'local', id: 'same', action: 'move', target: null });
    await row.click({ button: 'right' });
    await threadMenu.getByRole('menuitem', { name: 'Copy', exact: true }).hover();
    const copy = page.getByRole('menu', { name: 'Copy', exact: true });
    assert.match(await copy.innerText(), /Copy deeplink[\s\S]*Copy as Markdown[\s\S]*Copy working directory/);
    await copy.getByRole('menuitem', { name: 'Copy as Markdown' }).click();
    assert.equal((await page.evaluate(() => window.menuFixture.calls)).at(-1)?.action, 'copy-markdown');
    await row.click({ button: 'right' });
    await threadMenu.getByRole('menuitem', { name: 'Fork', exact: true }).hover();
    await page.getByRole('menu', { name: 'Fork', exact: true }).getByRole('menuitem', { name: 'Fork chat' }).click();
    assert.equal((await page.evaluate(() => window.menuFixture.calls)).at(-1)?.action, 'fork');
    await row.focus();
    await page.keyboard.press('Control+Alt+L');
    assert.equal((await page.evaluate(() => window.menuFixture.calls)).at(-1)?.action, 'copy');
    await page.keyboard.press('Control+Shift+C');
    assert.equal((await page.evaluate(() => window.menuFixture.calls)).at(-1)?.action, 'copy-working-directory');
    await page.keyboard.press('Shift+F10');
    await threadMenu.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await row.evaluate(element => element === document.activeElement), true);

    await page.evaluate(() => window.menuFixture.holdNextThreadAction());
    await row.hover();
    const quickArchive = projectGroup.getByRole('button', { name: 'Archive A conversation' });
    await quickArchive.click();
    assert.equal(await quickArchive.isDisabled(), true);
    await projectGroup.getByRole('button', { name: 'Conversation menu: A conversation' }).click();
    const heldArchive = threadMenu.getByRole('menuitem', { name: /^Archive/ });
    assert.equal(await heldArchive.getAttribute('aria-disabled'), 'true');
    assert.equal(await heldArchive.getAttribute('title'), 'Another conversation action is in progress.');
    const heldCount = (await page.evaluate(() => window.menuFixture.calls)).length;
    await heldArchive.click({ force: true });
    assert.equal((await page.evaluate(() => window.menuFixture.calls)).length, heldCount);
    await page.keyboard.press('Escape');
    const duplicateRow = sidebar.locator('.yard-owned-sidebar-recents').locator('..').getByRole('button', { name: 'A conversation', exact: true }).last();
    await duplicateRow.hover();
    const duplicateArchive = duplicateRow.locator('..').getByRole('button', { name: 'Archive A conversation' });
    assert.equal(await duplicateArchive.isDisabled(), true);
    await page.evaluate(() => window.menuFixture.releaseThreadAction());
    await page.waitForFunction(() => !document.querySelector('[aria-label="Archive A conversation"]')?.hasAttribute('disabled'));

    await row.click({ button: 'right' });
    await page.evaluate(() => window.menuFixture.setHost('remote'));
    await threadMenu.waitFor({ state: 'hidden' });
    const remote = sidebar.getByRole('button', { name: 'A conversation', exact: true }).first();
    await remote.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Project', exact: true }).hover();
    assert.equal(await page.getByRole('menu', { name: 'Project', exact: true }).getByRole('menuitem', { name: 'Project Two' }).count(), 0);
    await page.getByRole('menu', { name: 'Project', exact: true }).getByRole('menuitem', { name: 'Remove from Remote Project' }).click();
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).at(-1),
      { kind: 'thread', host: 'remote', id: 'same', action: 'move', target: null });

    await page.evaluate(() => window.menuFixture.setHost('local'));
    await page.evaluate(() => window.menuFixture.setMoveConnected(false));
    const legacyRow = sidebar.getByRole('button', { name: 'A conversation', exact: true }).last();
    await legacyRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Project', exact: true }).hover();
    const legacyTarget = page.getByRole('menu', { name: 'Project', exact: true }).getByRole('menuitem', { name: 'Project Two' });
    assert.equal(await legacyTarget.getAttribute('aria-disabled'), 'true');
    assert.equal(await legacyTarget.getAttribute('title'), 'Moving a conversation is not connected.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.menuFixture.setMoveConnected(true));
    await page.evaluate(() => window.menuFixture.setUnresolved(true));
    const recentRow = sidebar.getByRole('button', { name: 'A conversation', exact: true }).last();
    await recentRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Project', exact: true }).hover();
    const unresolvedTarget = page.getByRole('menu', { name: 'Project', exact: true }).getByRole('menuitem', { name: 'Project Two' });
    assert.equal(await unresolvedTarget.getAttribute('aria-disabled'), 'true');
    assert.equal(await unresolvedTarget.getAttribute('title'), 'Project membership is not confirmed.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.menuFixture.setUnresolved(false));

    const projectHeading = sidebar.locator('.yard-owned-sidebar-projects-heading');
    await projectHeading.hover();
    await sidebar.getByRole('button', { name: 'Project sidebar options' }).click();
    const group = page.getByRole('menu', { name: 'Project sidebar options' });
    assert.deepEqual(await group.getByRole('menuitem').allTextContents(), ['Organize sidebar', 'Sort chats by']);
    await group.getByRole('menuitem', { name: 'Sort chats by' }).hover();
    const sort = page.getByRole('menu', { name: 'Sort chats by' });
    assert.equal(await sort.getByRole('menuitemradio', { name: 'Last updated' }).getAttribute('aria-checked'), 'true');
    await sort.getByRole('menuitemradio', { name: 'Manual order' }).click();
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).at(-1), { kind: 'option', type: 'sort', value: 'manual' });
    await sidebar.locator('.yard-owned-sidebar-recents').hover();
    await sidebar.getByRole('button', { name: 'Chat sidebar options' }).click();
    const chatGroup = page.getByRole('menu', { name: 'Chat sidebar options' });
    const showProjects = chatGroup.getByRole('menuitemcheckbox', { name: 'Projects' });
    assert.equal(await showProjects.getAttribute('aria-checked'), 'true');
    await showProjects.click();
    assert.equal(await showProjects.getAttribute('aria-checked'), 'false');
    assert.equal(await chatGroup.isVisible(), true);
    assert.equal(await sidebar.getByRole('button', { name: 'A conversation', exact: true }).count(), 1);
    assert.equal(await sidebar.getByRole('button', { name: 'Project One', exact: true }).count(), 1);
    await showProjects.click();
    assert.equal(await showProjects.getAttribute('aria-checked'), 'true');
    assert.equal(await sidebar.getByRole('button', { name: 'A conversation', exact: true }).count(), 2);
    await chatGroup.getByRole('menuitem', { name: 'Organize sidebar' }).hover();
    await page.getByRole('menu', { name: 'Organize sidebar' }).getByRole('menuitemradio', { name: 'In one list' }).click();
    assert.equal(await sidebar.getByRole('button', { name: 'Explore' }).count(), 1);
    assert.equal(await sidebar.getByRole('button', { name: 'Project One', exact: true }).count(), 0);

    await sidebar.getByRole('button', { name: 'Open profile menu' }).click();
    const profile = page.getByRole('menu', { name: 'Open profile menu' });
    assert.equal(await profile.getByRole('menuitem', { name: 'fixture' }).getAttribute('aria-disabled'), 'true');
    assert.equal(await profile.getByText('Show Pet').count(), 0);
    assert.match(await profile.getByRole('menuitem', { name: /^Settings/ }).innerText(), /Ctrl\+,/);
    if (process.env.SIDEBAR_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SIDEBAR_EVIDENCE_DIR, 'sidebar-original-profile.png') });
    await profile.getByRole('menuitem', { name: 'Help' }).hover();
    const help = page.getByRole('menu', { name: 'Help' });
    assert.match(await help.innerText(), /What's new[\s\S]*Full changelog[\s\S]*Keyboard shortcuts[\s\S]*User guide/);
    await help.getByRole('menuitem', { name: 'User guide' }).click();
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).at(-1), { kind: 'help', action: 'guide' });
    await brand.focus();
    await page.keyboard.press('Control+,');
    assert.deepEqual((await page.evaluate(() => window.menuFixture.calls)).at(-1), { kind: 'settings' });

    await page.evaluate(() => window.menuFixture.setConnected(false));
    await brand.click();
    assert.equal(await mode.getByRole('menuitem', { name: /ChatGPT/ }).getAttribute('title'), 'ChatGPT is not connected.');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 650 });
    await sidebar.locator('.yard-owned-sidebar-recents').hover();
    await sidebar.getByRole('button', { name: 'Chat sidebar options' }).click();
    const bounds = await chatGroup.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 320 && bounds.y + bounds.height <= 650);
    await chatGroup.getByRole('menuitem', { name: 'Sort chats by' }).hover();
    const disabledManual = page.getByRole('menu', { name: 'Sort chats by' }).getByRole('menuitemradio', { name: 'Last updated' });
    assert.equal(await disabledManual.getAttribute('aria-disabled'), 'true');
    assert.equal(await disabledManual.getAttribute('title'), 'Sidebar preferences are not connected.');
    const before = (await page.evaluate(() => window.menuFixture.calls)).length;
    await disabledManual.click({ force: true });
    await page.getByRole('menu', { name: 'Sort chats by' }).getByRole('alert').getByText('Sidebar preferences are not connected.').waitFor();
    assert.equal((await page.evaluate(() => window.menuFixture.calls)).length, before);
    if (process.env.SIDEBAR_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SIDEBAR_EVIDENCE_DIR, 'sidebar-original-menus-mobile.png') });

    const touchContext = await browser.newContext({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true });
    try {
      const touch = await touchContext.newPage();
      touch.setDefaultTimeout(8_000);
      await touch.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://sidebar.test') return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        if (url.pathname === '/brand/icon.svg') return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync('public/brand/icon.svg') });
        return route.abort();
      });
      touch.on('pageerror', error => errors.push(error.message));
      await touch.goto('http://sidebar.test/');
      await touch.addStyleTag({ content: readFileSync('src/renderer/app/app.css', 'utf8') });
      await touch.addStyleTag({ content: readFileSync('src/renderer/sidebar/standalone-sidebar.css', 'utf8') });
      await touch.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const touchGroup = touch.getByRole('button', { name: 'Project One', exact: true }).locator('..').locator('..');
      await touchGroup.getByRole('button', { name: 'Conversation menu: A conversation' }).tap();
      await touch.getByRole('menuitem', { name: 'Project', exact: true }).tap();
      await touch.getByRole('menu', { name: 'Project', exact: true }).getByRole('menuitem', { name: 'Project Two' }).tap();
      assert.deepEqual((await touch.evaluate(() => window.menuFixture.calls)).at(-1), {
        kind: 'thread', host: 'local', id: 'same', action: 'move',
        target: { id: 'two', name: 'Project Two', rootPaths: ['/two'], hostId: 'local' },
      });
      await touch.evaluate(() => window.menuFixture.setConnected(false));
      await touch.getByRole('button', { name: 'Switch mode, current mode: Codex' }).tap();
      const unavailableMode = touch.getByRole('menuitem', { name: /ChatGPT/ });
      const unavailableBounds = await unavailableMode.boundingBox();
      assert.ok(unavailableBounds);
      await touch.touchscreen.tap(unavailableBounds.x + unavailableBounds.width / 2, unavailableBounds.y + unavailableBounds.height / 2);
      await touch.getByRole('menu').getByRole('alert').getByText('ChatGPT is not connected.').waitFor();
      assert.equal((await touch.evaluate(() => window.menuFixture.calls)).length, 1);
    } finally { await touchContext.close(); }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
