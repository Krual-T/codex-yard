import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex, fixtureThread } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

declare global {
  interface Window {
    sidebarConsumer: {
      init(): Promise<void>;
      mount(): void;
      host(endpoint: string, params?: Record<string, unknown>): Promise<any>;
      atoms(): Promise<Record<string, unknown>>;
      revoke(): void;
      captures(): number;
      setHosts(hosts: string[]): void;
      holdCatalog(): void;
      catalogHeld(): boolean;
      releaseCatalog(): void;
      holdAtoms(): Promise<void>;
      releaseAtoms(): void;
      enableSyntheticReadState(enabled: boolean): void;
      syntheticReadWrites(): Array<{ hostId: string; params: unknown; generation: unknown }>;
    };
  }
}

test('sidebar consumes real browser atoms and host transactions across pages', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-side-');
  const cleanup: Array<() => Promise<unknown>> = [() => rm(root, { recursive: true, force: true })];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const fake = await createFakeCodex(root);
  cleanup.push(() => fake.close());
  const fixture = await nativeFixture(root);
  fake.threads.set('same', fixtureThread('same', '/alpha', { name: 'First chat', updatedAt: 20 }));
  fake.threads.set('older', fixtureThread('older', '/alpha', { name: 'Older chat', updatedAt: 10 }));
  fake.handlers.set('thread/read', params => ({ thread: fake.threads.get(String(params.threadId)),
    readState: { revision: 'observed-revision', firstUnread: params.threadId === 'older' ? { type:'threadStart' } : null } }));
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, renderer: fixture.renderer, adapterPath: fixture.adapterPath,
    hostCatalog: { hosts: [], projects: [], assignments: {} } });
  cleanup.push(() => app.close());
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  cleanup.push(() => browser.close());
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useEffect, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {BrowserWorkbenchClient} from './src/renderer/app/client.ts';
    import {useSidebarBehavior} from './src/renderer/app/use-sidebar-behavior.ts';
    import {StandaloneSidebar} from './src/renderer/sidebar/StandaloneSidebar.tsx';
    import {I18nProvider} from './src/renderer/i18n/index.tsx';
    import {readBrowserAtoms} from './src/renderer/storage/ui-atoms.ts';
    const client = new BrowserWorkbenchClient();
    const realHost = client.host.bind(client);
    let holdCatalog = false, catalogHeld = false, releaseCatalog = () => {}, releaseAtoms = () => {};
    let authorityVersion = 0, captureCount = 0, hosts = ['local'], proofVersion = 0, changeProof = () => {};
    let syntheticRead = false, changeRead = () => {}, readWrites = [];
    const realRpc = client.rpc.bind(client);
    client.rpc = async (method, params, hostId, options) => {
      // The fixed native bridge does not expose this documented CLI method yet.
      if (syntheticRead && method === 'thread/readState/update') {
        options?.assertBeforeSend?.();
        readWrites.push({hostId, params, generation:options?.daemonConnectionGeneration});
        return {readState:{revision:'synthetic-next', firstUnread:null}};
      }
      return realRpc(method, params, hostId, options);
    };
    client.host = async (endpoint, params, options) => {
      const result = await realHost(endpoint, params, options);
      if (holdCatalog && endpoint === 'get-global-state' && params?.key === 'local-projects') {
        holdCatalog = false; catalogHeld = true; await new Promise(resolve => { releaseCatalog = resolve; }); catalogHeld = false;
      }
      return result;
    };
    const resolveThreadHosts = async () => {
      const snapshot = proofVersion, result = [...hosts];
      return {complete:true, hosts:result, assertCurrent() { if (snapshot !== proofVersion) throw Error('host proof changed'); }};
    };
    const rows = [
      {id:'same', hostId:'local', name:'First chat', cwd:'/alpha', updatedAt:20, archived:false, status:{type:'idle'}, turns:[]},
      {id:'older', hostId:'local', name:'Older chat', cwd:'/alpha', updatedAt:10, archived:false, status:{type:'idle'}, turns:[]},
    ];
    function Fixture(){
      const [state,setState] = useState(null), [epoch,setEpoch] = useState(0), [canWriteRead,setCanWriteRead] = useState(false);
      changeProof = () => setEpoch(value => value + 1);
      changeRead = value => setCanWriteRead(value);
      const reload = () => client.host('thread-project-state').then(setState);
      useEffect(() => { void reload(); return client.subscribe(event => {
        if (event.type === 'global-state-updated' || event.type === 'thread-project-memberships-updated') void reload();
      }); }, []);
      const behavior = useSidebarBehavior({client, hostId:'local', rows, projectState:state, resolveThreadHosts,
        threadHostResolutionEpoch:epoch, readStateWriteAvailable:canWriteRead, requestProjectName:async () => 'Renamed project',
        captureAuthority(hostId) { captureCount++; const version=authorityVersion, original=client.captureDaemonConnection(hostId);
          return {daemonConnectionGeneration:original.generation, assertBeforeSend() {
            if(version !== authorityVersion) throw Error('authority revoked'); original.assertOriginal(); }}; },
        onProjectsChanged:() => { void reload(); }});
      return <I18nProvider locale="en-US"><div className="yard-app" data-sidebar-open="true">
        <StandaloneSidebar {...behavior} hostId="local" currentThread={null} projectState={state} rows={rows} nextCursor={null}
          loading={false} error={null} search="" archived={false} onSearchChange={()=>{}} onArchivedChange={()=>{}}
          onOpenThread={()=>{}} onNewChat={()=>{}} onAddProject={()=>{}} onOpenSettings={()=>{}} onClose={()=>{}}
          onRefresh={()=>{}} onLoadMore={()=>{}} /></div></I18nProvider>;
    }
    window.sidebarConsumer = {
      async init(){ await client.connect(); await client.rpc('thread/list',{},'local'); },
      mount(){createRoot(document.getElementById('root')).render(<Fixture/>);},
      host:(endpoint,params={})=>realHost(endpoint,params), atoms:readBrowserAtoms,
      revoke:()=>{authorityVersion++;}, captures:()=>captureCount,
      setHosts:value=>{hosts=value;proofVersion++;changeProof();},
      enableSyntheticReadState:value=>{syntheticRead=value;changeRead(value);}, syntheticReadWrites:()=>readWrites,
      holdCatalog:()=>{holdCatalog=true;}, catalogHeld:()=>catalogHeld, releaseCatalog:()=>releaseCatalog(),
      holdAtoms:()=>new Promise((resolve,reject)=>{
        const request=indexedDB.open('codex-yard.ui-atoms.v1',1);
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const tx=request.result.transaction('atoms','readwrite'), store=tx.objectStore('atoms');
          let holding=true; releaseAtoms=()=>{holding=false;};
          const keep=()=>{const read=store.get('native-atoms');read.onsuccess=()=>{if(holding)keep();};};
          keep();resolve();
        };
      }), releaseAtoms:()=>releaseAtoms(),
    };
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const context = await browser.newContext({ bypassCSP: true });
  const open = async (legacy?: string, pageContext = context) => {
    const page = await pageContext.newPage();
    page.setDefaultTimeout(8_000);
    await page.route('**/workbench-entry.js', route => route.abort());
    await page.goto(app.url);
    if (legacy) await page.evaluate(value => localStorage.setItem('native-atoms', value), legacy);
    await page.addStyleTag({ content: readFileSync('src/renderer/sidebar/standalone-sidebar.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => window.sidebarConsumer.init());
    return page;
  };
  const legacy = JSON.stringify({ 'flat-project-sidebar-preferences-v1': { mode: 'project', initialized: true,
    chatSortMode: 'manual', projectSortMode: 'manual', manualSortVersion: 1, future: { retained: true } },
    'sidebar-show-projects-in-recents': true, 'unified-sidebar-chat-order-v1': ['codex:thread:local:older', 'codex:thread:local:same'],
    unrelated: { opaque: true } });
  const a = await open(legacy);
  await a.evaluate(async () => {
    await window.sidebarConsumer.host('set-global-state', { key:'local-projects', value:{ '/alpha':
      { id:'/alpha', name:'Alpha', rootPaths:['/alpha'], unknown:{ original:true } } } });
    await window.sidebarConsumer.host('set-global-state', { key:'remote-projects', value:[] });
    await window.sidebarConsumer.host('set-global-state', { key:'sidebar-project-thread-orders', value:{ '/alpha':
      { threadIds:['older','same'], future:'preserved' } } });
    window.sidebarConsumer.mount();
  });
  const b = await open();
  await b.evaluate(() => window.sidebarConsumer.mount());
  const sidebarA = a.getByRole('complementary', { name:'Sidebar' });
  const sidebarB = b.getByRole('complementary', { name:'Sidebar' });
  await sidebarA.getByRole('button', { name:'Alpha', exact:true }).waitFor();
  await sidebarB.getByRole('button', { name:'Alpha', exact:true }).waitFor();
  const projectA = sidebarA.getByRole('button', { name:'Alpha', exact:true }).locator('..').locator('..');
  await a.waitForFunction(() => {
    const group = [...document.querySelectorAll('.yard-owned-sidebar-project')].find(node => node.textContent?.includes('Alpha'));
    return group?.querySelectorAll('[data-sidebar-thread]').length === 2;
  });
  await a.waitForFunction(() => {
    const group = [...document.querySelectorAll('.yard-owned-sidebar-project')].find(node => node.textContent?.includes('Alpha'));
    return group?.querySelector('[data-sidebar-thread]')?.textContent?.includes('Older chat');
  });
  await projectA.getByRole('button', { name:'Older chat', exact:true }).click({ button:'right' });
  const olderMenu = a.getByRole('menu', { name:'Conversation menu: Older chat' });
  assert.equal(await olderMenu.getByRole('menuitem', { name:'Mark as read' }).getAttribute('aria-disabled'), 'true');
  await a.evaluate(() => window.sidebarConsumer.enableSyntheticReadState(true));
  await a.waitForFunction(() => !document.querySelector('[role="menu"][aria-label="Conversation menu: Older chat"] [data-menu-item="unread"]')?.hasAttribute('aria-disabled'));
  await olderMenu.getByRole('menuitem', { name:'Mark as read' }).click();
  const readWrites = await a.evaluate(() => window.sidebarConsumer.syntheticReadWrites());
  assert.equal(readWrites.length, 1);
  assert.deepEqual(readWrites[0]?.params, { threadId:'older', expectedRevision:'observed-revision', operation:{ type:'read' } });
  assert.equal(readWrites[0]?.hostId, 'local');
  assert.equal(typeof readWrites[0]?.generation, 'string');
  await a.evaluate(() => window.sidebarConsumer.enableSyntheticReadState(false));

  await sidebarA.getByRole('button', { name:'Chat sidebar options' }).click();
  const optionsA = a.getByRole('menu', { name:'Chat sidebar options' });
  await optionsA.getByRole('menuitemcheckbox', { name:'Projects' }).click();
  await b.waitForFunction(async () => (await window.sidebarConsumer.atoms())['sidebar-show-projects-in-recents'] === false);
  await sidebarB.getByRole('button', { name:'Chat sidebar options' }).click();
  assert.equal(await b.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitemcheckbox', { name:'Projects' }).getAttribute('aria-checked'), 'false');
  await b.reload();
  await b.addStyleTag({ content: readFileSync('src/renderer/sidebar/standalone-sidebar.css', 'utf8') });
  await b.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await b.evaluate(async () => { await window.sidebarConsumer.init(); window.sidebarConsumer.mount(); });
  await sidebarB.getByRole('button', { name:'Alpha', exact:true }).waitFor();
  await sidebarB.getByRole('button', { name:'Chat sidebar options' }).click();
  assert.equal(await b.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitemcheckbox', { name:'Projects' }).getAttribute('aria-checked'), 'false');
  const saved = await b.evaluate(() => window.sidebarConsumer.atoms());
  assert.deepEqual(saved.unrelated, { opaque:true });
  assert.deepEqual((saved['flat-project-sidebar-preferences-v1'] as any).future, { retained:true });
  const importedRaw = await b.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('atoms', 'readonly').objectStore('atoms').get('native-atoms');
      get.onerror = () => { db.close(); reject(get.error); };
      get.onsuccess = () => { db.close(); resolve(get.result.legacyRaw); };
    };
  }));
  assert.equal(importedRaw, legacy);

  await a.keyboard.press('Escape');
  await a.evaluate(() => window.sidebarConsumer.holdAtoms());
  const captures = await b.evaluate(() => window.sidebarConsumer.captures());
  await b.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitemcheckbox', { name:'Projects' }).click();
  await b.waitForFunction(count => window.sidebarConsumer.captures() > count, captures);
  await b.evaluate(() => window.sidebarConsumer.revoke());
  await a.evaluate(() => window.sidebarConsumer.releaseAtoms());
  await b.getByRole('menu', { name:'Chat sidebar options' }).getByRole('alert').getByText('authority revoked').waitFor();
  assert.equal((await b.evaluate(() => window.sidebarConsumer.atoms()))['sidebar-show-projects-in-recents'], false);
  await b.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitemcheckbox', { name:'Projects' }).click();
  await b.waitForFunction(async () => (await window.sidebarConsumer.atoms())['sidebar-show-projects-in-recents'] === true);
  await b.keyboard.press('Escape');

  const first = projectA.getByRole('button', { name:'First chat', exact:true });
  await first.click({ button:'right' });
  const threadMenu = a.getByRole('menu', { name:'Conversation menu: First chat' });
  await threadMenu.getByRole('menuitem', { name:/^Pin/ }).click();
  await a.waitForFunction(async () => (await window.sidebarConsumer.host('get-global-state', { key:'pinned-thread-ids' })).value?.includes('same'));
  await b.waitForFunction(() => !!document.querySelector('[aria-label="Unpin First chat"]'));
  const firstB = sidebarB.getByRole('button', { name:'First chat', exact:true }).first();
  await firstB.hover();
  await b.getByRole('button', { name:'Unpin First chat' }).first().click();
  await a.waitForFunction(async () => !(await window.sidebarConsumer.host('get-global-state', { key:'pinned-thread-ids' })).value?.includes('same'));
  await a.waitForFunction(() => !!document.querySelector('[aria-label="Pin First chat"]'));
  await first.click({ button:'right' });
  await threadMenu.getByRole('menuitem', { name:/^Pin/ }).click();
  await b.waitForFunction(() => !!document.querySelector('[aria-label="Unpin First chat"]'));
  await b.evaluate(() => window.sidebarConsumer.setHosts(['local','remote']));
  await b.waitForFunction(() => !document.querySelector('[aria-label="Unpin First chat"]'));
  await firstB.click({ button:'right' });
  const threadMenuB = b.getByRole('menu', { name:'Conversation menu: First chat' });
  assert.equal(await threadMenuB.getByRole('menuitem', { name:/^Pin/ }).getAttribute('aria-disabled'), 'true');
  assert.equal(await threadMenuB.getByRole('menuitem', { name:/^Mark as unread/ }).getAttribute('aria-disabled'), 'true');
  await b.keyboard.press('Escape');

  await projectA.getByRole('button', { name:'Project actions for Alpha' }).click();
  await a.getByRole('menu', { name:'Project actions for Alpha' }).getByRole('menuitem', { name:'Pin', exact:true }).click();
  await a.waitForFunction(async () => (await window.sidebarConsumer.host('get-global-state', { key:'pinned-project-ids' })).value?.includes('/alpha'));
  await sidebarB.getByRole('button', { name:'Project actions for Alpha' }).click();
  await b.getByRole('menu', { name:'Project actions for Alpha' }).getByRole('menuitem', { name:'Unpin', exact:true }).waitFor();
  await b.getByRole('menu', { name:'Project actions for Alpha' }).getByRole('menuitem', { name:'Unpin', exact:true }).click();
  await a.waitForFunction(async () => !(await window.sidebarConsumer.host('get-global-state', { key:'pinned-project-ids' })).value?.includes('/alpha'));
  await projectA.getByRole('button', { name:'Project actions for Alpha' }).click();
  await a.getByRole('menu', { name:'Project actions for Alpha' }).getByRole('menuitem', { name:'Pin', exact:true }).click();
  await b.waitForFunction(async () => (await window.sidebarConsumer.host('get-global-state', { key:'pinned-project-ids' })).value?.includes('/alpha'));

  await b.evaluate(async () => {
    const current = await window.sidebarConsumer.host('get-global-state', { key:'remote-projects' });
    const changed = [...current.value, { id:'/alpha', hostId:'remote', remotePath:'/elsewhere', label:'Other host' }];
    await window.sidebarConsumer.host('set-global-state', { key:'remote-projects', value:changed, expected:current });
  });
  await a.evaluate(() => window.sidebarConsumer.holdCatalog());
  await projectA.getByRole('button', { name:'Project actions for Alpha' }).click();
  const projectMenu = a.getByRole('menu', { name:'Project actions for Alpha' });
  await a.waitForFunction(() => document.querySelector('[role="menu"][aria-label="Project actions for Alpha"] [data-menu-item="pin"][aria-disabled="true"]'));
  assert.equal(await projectMenu.getByRole('menuitem', { name:'Pin', exact:true }).getAttribute('aria-disabled'), 'true');
  await projectMenu.getByRole('menuitem', { name:'Edit' }).click();
  await a.waitForFunction(() => window.sidebarConsumer.catalogHeld());
  await b.evaluate(async () => {
    const current = await window.sidebarConsumer.host('get-global-state', { key:'local-projects' });
    const changed = structuredClone(current.value);
    changed['/alpha'].external = { retained:true };
    await window.sidebarConsumer.host('set-global-state', { key:'local-projects', value:changed, expected:current });
  });
  await a.evaluate(() => window.sidebarConsumer.releaseCatalog());
  await projectMenu.getByRole('alert').getByText(/saved preference changed/i).waitFor();
  let catalog = (await b.evaluate(() => window.sidebarConsumer.host('get-global-state', { key:'local-projects' }))).value;
  assert.equal(catalog['/alpha'].name, 'Alpha');
  assert.deepEqual(catalog['/alpha'].external, { retained:true });
  await projectMenu.getByRole('menuitem', { name:'Edit' }).click();
  await a.waitForFunction(async () => (await window.sidebarConsumer.host('get-global-state', { key:'local-projects' })).value['/alpha'].name === 'Renamed project');
  catalog = (await b.evaluate(() => window.sidebarConsumer.host('get-global-state', { key:'local-projects' }))).value;
  assert.deepEqual(catalog['/alpha'].external, { retained:true });
  assert.deepEqual(catalog['/alpha'].unknown, { original:true });

  await sidebarA.getByRole('button', { name:'Chat sidebar options' }).click();
  await a.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitem', { name:'Organize sidebar' }).hover();
  await a.getByRole('menu', { name:'Organize sidebar' }).getByRole('menuitemradio', { name:'In one list' }).click();
  await b.waitForFunction(async () => ((await window.sidebarConsumer.atoms())['flat-project-sidebar-preferences-v1'] as { mode?: string } | undefined)?.mode === 'list');
  await sidebarB.getByRole('button', { name:'Project sidebar options' }).waitFor({ state:'detached' });
  await sidebarB.getByRole('button', { name:'Chat sidebar options' }).click();
  await b.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitem', { name:'Organize sidebar' }).hover();
  assert.equal(await b.getByRole('menu', { name:'Organize sidebar' }).getByRole('menuitemradio', { name:'In one list' }).getAttribute('aria-checked'), 'true');
  await b.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitem', { name:'Sort chats by' }).hover();
  await b.getByRole('menu', { name:'Sort chats by' }).getByRole('menuitemradio', { name:'Last updated' }).click();
  await a.waitForFunction(async () => ((await window.sidebarConsumer.atoms())['flat-project-sidebar-preferences-v1'] as { chatSortMode?: string } | undefined)?.chatSortMode === 'updated_at');
  const finalAtoms = await a.evaluate(() => window.sidebarConsumer.atoms());
  assert.equal((finalAtoms['flat-project-sidebar-preferences-v1'] as any).projectSortMode, 'updated_at');
  assert.deepEqual((finalAtoms['flat-project-sidebar-preferences-v1'] as any).future, { retained:true });

  const oldContext = await browser.newContext({ bypassCSP:true });
  const oldPage = await open(JSON.stringify({ 'sidebar-organize-mode-v1':'recent', 'sidebar-keep-projects-in-recent-v1':false,
    'flat-project-sidebar-preferences-v1': { initialized:false, chatSortMode:'manual', projectSortMode:'updated_at', manualSortVersion:1 } }), oldContext);
  await oldPage.evaluate(() => window.sidebarConsumer.mount());
  await oldPage.getByRole('button', { name:'Chat sidebar options' }).click();
  await oldPage.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitem', { name:'Organize sidebar' }).hover();
  const oldChoice = oldPage.getByRole('menu', { name:'Organize sidebar' }).getByRole('menuitemradio', { name:'In one list' });
  await oldPage.waitForFunction(() => document.querySelector('[role="menu"][aria-label="Organize sidebar"] [data-menu-item="one-list"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(await oldChoice.getAttribute('aria-checked'), 'true');
  await oldPage.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitem', { name:'Sort chats by' }).hover();
  assert.equal(await oldPage.getByRole('menu', { name:'Sort chats by' }).getByRole('menuitemradio', { name:'Manual order' }).getAttribute('aria-checked'), 'true');
  await oldPage.getByRole('menu', { name:'Chat sidebar options' }).getByRole('menuitem', { name:'Organize sidebar' }).hover();
  await oldPage.getByRole('menu', { name:'Organize sidebar' }).getByRole('menuitemradio', { name:'By project' }).click();
  await oldPage.getByRole('button', { name:'Project sidebar options' }).click();
  await oldPage.getByRole('menu', { name:'Project sidebar options' }).getByRole('menuitem', { name:'Sort chats by' }).hover();
  assert.equal(await oldPage.getByRole('menu', { name:'Sort chats by' }).getByRole('menuitemradio', { name:'Last updated' }).getAttribute('aria-checked'), 'true');
  await oldContext.close();
});
