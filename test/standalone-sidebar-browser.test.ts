import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    sidebarUIHarness: {
      calls: { projects: ({ id: string; hostId: string; rootPaths: string[] } | null)[]; add: number; settings: number; close: number };
      pending(): number;
      resolveNext(rows: unknown[]): void;
      rejectNext(message: string): void;
      setLocale(locale: string): void;
    };
  }
}

test('standalone sidebar keeps row identity, project controls, search and narrow keyboard navigation', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneSidebar} from './src/renderer/sidebar/StandaloneSidebar.tsx';
      import {I18nProvider} from './src/renderer/i18n/index.tsx';
      import {useThreadList} from './src/renderer/sidebar/use-thread-list.ts';
      const calls={projects:[],add:0,settings:0,close:0}, waiting=[];
      let changeLocale=()=>{};
      const row=(id,name,cwd,status={type:'idle'})=>({id,name,cwd,preview:'',turns:[],status,updatedAt:1700000000});
      const active=[row('one','Running task','/repo',{type:'active',activeFlags:[]}),
        row('two','Assigned second','/repo',{type:'active',activeFlags:['waitingOnApproval']}),row('recent','Recent task','/other')];
      const archived=[row('archive','Archived task','/other')];
      const projectState={catalog:{local:{one:{id:'one',name:'Project One',rootPaths:['/repo']},
        two:{id:'two',name:'Project Two',rootPaths:['/repo']},three:{id:'three',name:'Project Three',rootPaths:['/third']}},remote:[]},
        inventory:{complete:true,errors:{}},memberships:[{hostId:'local',threadId:'two',
          assignment:{projectKind:'local',projectId:'two'},projectless:false}],
        unresolved:{assignments:{},projectless:[],qualified:[],outputDirectories:{},workspaceRoots:{},unreadable:{}},
        outputDirectories:[],workspaceRoots:[]};
      const client={rpc:(method,params)=>{
        if(method!=='thread/list')throw Error('Unexpected RPC');
        if(params.cursor)return new Promise((resolve,reject)=>waiting.push({resolve,reject}));
        return Promise.resolve({data:params.archived?archived:active,nextCursor:params.archived?null:'next'});
      }};
      function App(){
        const [locale,setLocale]=useState('en-US'); changeLocale=setLocale;
        const [search,setSearch]=useState(''),[showArchived,setArchived]=useState(false),[tabs,setTabs]=useState([]),[current,setCurrent]=useState(null);
        const list=useThreadList(client,{hostId:'local',archived:showArchived,search,refreshKey:0});
        const open=row=>{const tab={id:row.id,name:row.name,hostId:row.hostId,archived:row.archived};
          setTabs(old=>old.some(item=>item.id===tab.id&&item.hostId===tab.hostId)?old:[...old,tab]);setCurrent(tab);};
        return React.createElement(I18nProvider,{locale},React.createElement('div',{className:'yard-app','data-sidebar-open':'true'},
          React.createElement(StandaloneSidebar,{hostId:'local',currentThread:current&&{hostId:current.hostId,threadId:current.id},
            projectState,rows:[...list.rows,{...row('foreign','Remote task','/third',{type:'active',activeFlags:[]}),hostId:'remote',archived:false}],nextCursor:list.nextCursor,loading:list.loading,error:list.error,search,archived:showArchived,
            onSearchChange:setSearch,onArchivedChange:setArchived,onOpenThread:open,onNewChat:project=>calls.projects.push(project),
            onAddProject:()=>calls.add++,onOpenSettings:()=>calls.settings++,onClose:()=>calls.close++,
            onRefresh:()=>void list.refresh(),onLoadMore:()=>void list.loadMore()}),
          React.createElement('main',{className:'yard-main'},React.createElement('div',{role:'tablist'},tabs.map(tab=>
            React.createElement('button',{role:'tab',key:tab.hostId+tab.id,'aria-selected':current?.id===tab.id,
              onClick:()=>setCurrent(tab)},'Tab '+tab.name))),React.createElement('output',{id:'selected'},JSON.stringify(current)))));
      }
      window.sidebarUIHarness={calls,pending:()=>waiting.length,resolveNext:rows=>waiting.shift().resolve({data:rows,nextCursor:null}),
        rejectNext:message=>waiting.shift().reject(Error(message)),setLocale:locale=>changeLocale(locale)};
      createRoot(document.getElementById('root')).render(React.createElement(App));
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    const icon = readFileSync('public/brand/icon.svg');
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://sidebar.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      if (url.pathname === '/brand/icon.svg') return route.fulfill({ contentType: 'image/svg+xml', body: icon });
      return route.abort();
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://sidebar.test/');
    await page.addStyleTag({ content: readFileSync('src/renderer/app/app.css', 'utf8') });
    await page.addStyleTag({ content: readFileSync('src/renderer/sidebar/standalone-sidebar.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const projectOne = sidebar.getByRole('button', { name: 'Project One', exact: true });
    const projectTwo = sidebar.getByRole('button', { name: 'Project Two', exact: true });
    await sidebar.getByRole('button', { name: /Running task/ }).waitFor();
    assert.equal(await sidebar.getByRole('img', { name: 'In progress' }).count(), 1);
    assert.equal(await sidebar.getByRole('img', { name: 'Waiting for approval' }).count(), 1);
    await page.evaluate(() => window.sidebarUIHarness.setLocale('zh-CN'));
    await page.getByRole('complementary', { name: '侧边栏' }).waitFor();
    assert.equal(await page.getByRole('img', { name: '等待审批' }).count(), 1);
    const chineseTitle = await page.getByRole('button', { name: /Running task/ }).getAttribute('title');
    assert.ok(chineseTitle?.includes(await page.evaluate(() => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(1700000000 * 1000)))));
    await page.evaluate(() => window.sidebarUIHarness.setLocale('ja-JP'));
    await page.getByRole('img', { name: '承認待ち' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Project One', exact: true }).count(), 1);
    await page.evaluate(() => window.sidebarUIHarness.setLocale('en-US'));
    await sidebar.waitFor();
    const projectsToggle = sidebar.getByRole('button', { name: 'Projects', exact: true });
    await projectsToggle.click();
    assert.equal(await projectsToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await projectOne.isVisible(), false);
    assert.equal(page.url(), 'http://sidebar.test/');
    await projectsToggle.click();
    assert.equal(await projectOne.getAttribute('aria-expanded'), 'true');
    await projectOne.click();
    assert.equal(await projectOne.getAttribute('aria-expanded'), 'false');
    const headingOne = projectOne.locator('..');
    await headingOne.getByRole('img', { name: 'In progress', exact: true }).waitFor();
    assert.equal(await sidebar.getByRole('button', { name: /Running task/ }).isVisible(), false);
    assert.equal(await sidebar.getByRole('button', { name: /Assigned second/ }).isVisible(), true);
    await projectTwo.click();
    await projectTwo.locator('..').getByRole('img', { name: 'Waiting for approval', exact: true }).waitFor();
    const projectThree = sidebar.getByRole('button', { name: 'Project Three', exact: true });
    await projectThree.click();
    assert.equal(await projectThree.locator('..').getByRole('img').count(), 0);
    await page.evaluate(() => window.sidebarUIHarness.setLocale('zh-CN'));
    await page.getByRole('img', { name: '进行中', exact: true }).waitFor();
    await page.getByRole('img', { name: '等待审批', exact: true }).waitFor();
    await page.evaluate(() => window.sidebarUIHarness.setLocale('en-US'));
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 800 });
      const indicator = await headingOne.getByRole('img', { name: 'In progress', exact: true }).boundingBox();
      const action = await sidebar.getByRole('button', { name: 'New chat in Project One' }).boundingBox();
      assert.ok(indicator && action && indicator.x + indicator.width <= action.x);
    }
    await projectTwo.click();
    await projectOne.click();
    await sidebar.getByRole('button', { name: 'New chat in Project Two' }).click();
    await sidebar.getByRole('button', { name: 'New chat', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Add project' }).click();
    await sidebar.getByRole('button', { name: 'Settings' }).click();
    const calls = await page.evaluate(() => window.sidebarUIHarness.calls);
    assert.deepEqual(calls.projects[0], { id: 'two', name: 'Project Two', rootPaths: ['/repo'], hostId: 'local' });
    assert.equal(calls.projects[1], null);
    assert.equal(calls.add, 1);
    assert.equal(calls.settings, 1);
    assert.equal(await projectTwo.getAttribute('aria-expanded'), 'true');

    await sidebar.getByRole('button', { name: /Running task/ }).click();
    assert.deepEqual(JSON.parse(await page.locator('#selected').innerText()), { id: 'one', name: 'Running task', hostId: 'local', archived: false });
    await sidebar.getByRole('button', { name: 'Archived chats' }).click();
    await sidebar.getByRole('button', { name: 'Archived task' }).waitFor();
    await page.getByRole('tab', { name: 'Tab Running task' }).click();
    assert.equal(JSON.parse(await page.locator('#selected').innerText()).archived, false);
    await sidebar.getByRole('button', { name: 'Archived task' }).click();
    assert.equal(JSON.parse(await page.locator('#selected').innerText()).archived, true);
    await sidebar.getByRole('button', { name: 'Show recent chats' }).click();
    await sidebar.getByRole('button', { name: /Running task/ }).waitFor();
    await page.getByRole('tab', { name: 'Tab Archived task' }).click();
    assert.equal(JSON.parse(await page.locator('#selected').innerText()).archived, true);

    await projectOne.click();
    await projectsToggle.click();
    assert.equal(await projectsToggle.getAttribute('aria-expanded'), 'false');
    await sidebar.getByRole('searchbox', { name: 'Search conversations' }).fill('NEEDLE');
    await page.waitForFunction(() => window.sidebarUIHarness.pending() === 1);
    assert.equal(await projectsToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await projectOne.getAttribute('aria-expanded'), 'true');
    assert.equal(await sidebar.getByText('Searching conversations...').isVisible(), true);
    assert.equal(await sidebar.getByText('No matching conversations').count(), 0);
    await page.evaluate(() => window.sidebarUIHarness.resolveNext([{ id: 'hit', name: 'Later result', cwd: '/repo',
      preview: 'a needle in the preview', turns: [], status: { type: 'idle' } }]));
    await sidebar.getByRole('button', { name: 'Later result' }).waitFor();
    assert.equal(await sidebar.getByText('No matching conversations').count(), 0);
    await sidebar.getByRole('searchbox', { name: 'Search conversations' }).fill('unfindable');
    await page.waitForFunction(() => window.sidebarUIHarness.pending() === 1);
    assert.equal(await sidebar.getByText('No matching conversations').count(), 0);
    await page.evaluate(() => window.sidebarUIHarness.rejectNext('Search page unavailable'));
    await sidebar.getByRole('alert').getByText('Search page unavailable').waitFor();
    assert.equal(await sidebar.getByText('No matching conversations').count(), 0);
    await sidebar.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => window.sidebarUIHarness.pending() === 1);
    await page.evaluate(() => window.sidebarUIHarness.resolveNext([]));
    await sidebar.getByText('No matching conversations').waitFor();
    await sidebar.getByRole('searchbox', { name: 'Search conversations' }).fill('');
    assert.equal(await projectsToggle.getAttribute('aria-expanded'), 'false');
    await projectsToggle.click();
    assert.equal(await projectOne.getAttribute('aria-expanded'), 'false');
    await projectOne.click();
    await sidebar.getByRole('button', { name: 'Load more' }).click();
    await page.waitForFunction(() => window.sidebarUIHarness.pending() === 1);
    await page.evaluate(() => window.sidebarUIHarness.rejectNext('Unable to load next page'));
    await sidebar.getByRole('alert').getByText('Unable to load next page').waitFor();
    assert.equal(await sidebar.getByRole('button', { name: /Running task/ }).isVisible(), true);
    await sidebar.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => window.sidebarUIHarness.pending() === 1);
    await page.evaluate(() => window.sidebarUIHarness.resolveNext([{ id: 'loaded', name: 'Loaded later', cwd: '/other',
      preview: '', turns: [], status: { type: 'idle' } }]));
    await sidebar.getByRole('button', { name: 'Loaded later' }).waitFor();

    if (process.env.SIDEBAR_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SIDEBAR_EVIDENCE_DIR, 'sidebar-desktop.png') });
    await page.setViewportSize({ width: 320, height: 650 });
    await sidebar.getByRole('searchbox', { name: 'Search conversations' }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await projectsToggle.evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Enter');
    assert.equal(await projectsToggle.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Enter');
    await projectOne.focus();
    await page.keyboard.press('Enter');
    assert.equal(await projectOne.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Enter');
    assert.equal(await projectOne.getAttribute('aria-expanded'), 'true');
    const bounds = await sidebar.evaluate(element => {
      const aside = element.getBoundingClientRect();
      const toggle = element.querySelector('.yard-owned-sidebar-project-toggle')!.getBoundingClientRect();
      const add = element.querySelector('.yard-owned-sidebar-project-heading .yard-owned-sidebar-icon')!.getBoundingClientRect();
      return { width: aside.width, right: aside.right, toggleRight: toggle.right, addLeft: add.left, addHeight: add.height,
        bodyWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert.ok(bounds.width <= bounds.viewport && bounds.right <= bounds.viewport);
    assert.ok(bounds.toggleRight <= bounds.addLeft && bounds.addHeight >= 40);
    assert.equal(bounds.bodyWidth, bounds.viewport);
    if (process.env.SIDEBAR_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SIDEBAR_EVIDENCE_DIR, 'sidebar-mobile.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
