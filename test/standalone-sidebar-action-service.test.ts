import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createSidebarActionService, SidebarCommittedActionError } from '../src/renderer/app/sidebar-action-service.ts';
import type { SidebarActionCommit } from '../src/renderer/app/sidebar-action-service.ts';
import type { SidebarAuthority } from '../src/renderer/app/use-sidebar-behavior.ts';
import type { ThreadListRow } from '../src/renderer/sidebar/use-thread-list.ts';
import type { WorkbenchClient, WorkbenchDispatchOptions } from '../src/renderer/workbench-contract.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

const row: ThreadListRow = { id: 'chat', hostId: 'ssh-1', cwd: '/work', name: 'Chat', updatedAt: 1,
  archived: false, status: { type: 'idle' }, turns: [] };
const authority = (current: () => boolean): SidebarAuthority => ({ daemonConnectionGeneration: 'original-generation',
  assertBeforeSend() { if (!current()) throw new Error('original authority revoked'); } });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

test('thread actions preserve captured host and authority across confirmation and notify confirmed writes', async () => {
  let current = true;
  const name = deferred<string | null>();
  const calls: { method: string; params: Record<string, unknown>; host: string; generation?: string }[] = [];
  const commits: SidebarActionCommit[] = [];
  const clipboard: string[] = [];
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params = {}, host = 'local', options?: WorkbenchDispatchOptions): Promise<T> {
      options?.assertBeforeSend?.();
      calls.push({ method, params, host, generation: options?.daemonConnectionGeneration });
      if (method === 'thread/read') return { thread: fixtureThread('chat', '/fresh') } as T;
      if (method === 'thread/fork') return { thread: fixtureThread('fork', '/fresh') } as T;
      return {} as T;
    },
    async host<T>(): Promise<T> { throw new Error('unexpected host request'); },
    subscribe() { return () => {}; }, async reply() { throw new Error('unexpected approval'); },
  };
  const service = createSidebarActionService({ client, requestName: () => name.promise, confirm: () => true,
    assertProjectCurrent() {}, onCommitted: result => { commits.push(result); }, writeClipboard: text => { clipboard.push(text); } });
  const pending = service.onThreadAction(row, 'rename', authority(() => current));
  current = false; name.resolve('New name');
  await assert.rejects(pending, /authority revoked/);
  assert.equal(calls.length, 0);
  current = true;
  await service.onThreadAction(row, 'copy', authority(() => current));
  await service.onThreadAction(row, 'copy-working-directory', authority(() => current));
  await service.onThreadAction(row, 'fork', authority(() => current));
  await service.onThreadAction(row, 'archive', authority(() => current));
  await service.onThreadAction({ ...row, archived: true }, 'restore', authority(() => current));
  assert.deepEqual(clipboard, ['codex://threads/chat?hostId=ssh-1', '/fresh']);
  assert.deepEqual(calls.map(call => [call.method, call.host, call.generation]), [
    ['thread/read', 'ssh-1', 'original-generation'], ['thread/fork', 'ssh-1', 'original-generation'],
    ['thread/archive', 'ssh-1', 'original-generation'], ['thread/unarchive', 'ssh-1', 'original-generation'],
  ]);
  assert.deepEqual(commits.map(item => item.type), ['fork', 'archive', 'restore']);
  const rename = createSidebarActionService({ client, requestName: () => ' Renamed ', confirm: () => true,
    assertProjectCurrent() {}, onCommitted: result => { commits.push(result); } });
  await rename.onThreadAction(row, 'rename', authority(() => current));
  assert.deepEqual(calls.at(-1), { method: 'thread/name/set', params: { threadId: 'chat', name: 'Renamed' },
    host: 'ssh-1', generation: 'original-generation' });
  assert.ok(!service.availableThreadActions(row).includes('delete'));
  await assert.rejects(service.onThreadAction(row, 'delete', authority(() => current)), /unavailable/);
  const failing = createSidebarActionService({ client, requestName: () => null, confirm: () => true,
    assertProjectCurrent() {}, onCommitted() { throw new Error('navigation failed'); } });
  await assert.rejects(failing.onThreadAction(row, 'archive', authority(() => current)),
    (error: unknown) => error instanceof SidebarCommittedActionError && error.result.type === 'archive');
});

test('Markdown copy loads every history and item page, preserving structured context and rejecting cursor loops', async () => {
  let looping = false, copied = '';
  const calls: string[] = [];
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params: Record<string, unknown> = {}, _host?: string, options?: WorkbenchDispatchOptions): Promise<T> {
      options?.assertBeforeSend?.(); calls.push(method);
      if (method === 'thread/read') return { thread: fixtureThread('chat', '/work', { name: 'Title' }) } as T;
      if (method === 'thread/turns/list') {
        if (looping) return { data: [], nextCursor: 'same' } as T;
        return (params.cursor ? { data: [fixtureTurn('second', [agentItem('a', 'Answer')])], nextCursor: null }
          : { data: [{ ...fixtureTurn('first'), itemsView: 'summary' }], nextCursor: 'two' }) as T;
      }
      if (method === 'thread/items/list') return (params.cursor
        ? { data: [{ item: { id: 'context', type: 'tool', value: '</details> ```' } }], nextCursor: null }
        : { data: [{ item: { id: 'user', type: 'userMessage', content: [
          { type: 'text', text: 'Question', text_elements: [{ byteRange: { start: 0, end: 8 }, future: true }] },
          { type: 'image', url: 'fixture:image' },
        ] } }], nextCursor: 'more' }) as T;
      throw new Error('unexpected request');
    },
    async host<T>(): Promise<T> { throw new Error('unexpected host request'); },
    subscribe() { return () => {}; }, async reply() { throw new Error('unexpected approval'); },
  };
  const service = createSidebarActionService({ client, requestName: () => null, confirm: () => false,
    assertProjectCurrent() {}, onCommitted() {}, writeClipboard: text => { copied = text; } });
  await service.onThreadAction(row, 'copy-markdown', authority(() => true));
  assert.match(copied, /^# Title\n\n> Question/);
  assert.match(copied, /fixture:image/);
  assert.match(copied, /"byteRange"/);
  assert.match(copied, /\\u003c\/details>/);
  assert.match(copied, /Answer/);
  assert.equal(calls.filter(method => method === 'thread/turns/list').length, 2);
  assert.equal(calls.filter(method => method === 'thread/items/list').length, 2);
  looping = true; copied = '';
  await assert.rejects(service.onThreadAction(row, 'copy-markdown', authority(() => true)), /游标重复/);
  assert.equal(copied, '');
});

test('clipboard fallback does not dispatch after the original authority is revoked', async () => {
  let current = true, rejectClipboard!: (reason: Error) => void, touchedFallback = false;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    writeText: () => new Promise<void>((_, reject) => { rejectClipboard = reject; }),
  } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, get() { touchedFallback = true; throw new Error('unexpected fallback'); } });
  try {
    const client: WorkbenchClient = {
      async rpc<T>(): Promise<T> { throw new Error('unexpected RPC'); },
      async host<T>(): Promise<T> { throw new Error('unexpected host request'); },
      subscribe() { return () => {}; }, async reply() { throw new Error('unexpected approval'); },
    };
    const service = createSidebarActionService({ client, requestName: () => null, confirm: () => false,
      assertProjectCurrent() {}, onCommitted() {} });
    const pending = service.onThreadAction(row, 'copy', authority(() => current));
    current = false; rejectClipboard(new Error('clipboard denied'));
    await assert.rejects(pending, /authority revoked/);
    assert.equal(touchedFallback, false);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('remote project actions keep identical thread and project IDs on other hosts separate', async () => {
  const catalog = [
    { id: 'project', hostId: 'ssh-1', remotePath: '/alpha', label: 'Alpha', unknown: 1 },
    { id: 'project', hostId: 'ssh-2', remotePath: '/beta', label: 'Other', unknown: 2 },
  ];
  const writes: Array<{ host: string; method: string; threadId: unknown }> = [];
  let saved = structuredClone(catalog);
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params: Record<string, unknown> = {}, host = 'local', options?: WorkbenchDispatchOptions): Promise<T> {
      options?.assertBeforeSend?.();
      if (method === 'thread/list') return { data: params.archived ? [] : [{ ...row, id: 'same', cwd: '/alpha' }], nextCursor: null } as T;
      writes.push({ host, method, threadId: params.threadId }); return {} as T;
    },
    async host<T>(endpoint: string, params: Record<string, unknown> = {}, options?: Pick<WorkbenchDispatchOptions, 'assertBeforeSend'>): Promise<T> {
      options?.assertBeforeSend?.();
      assert.equal(params.hostId, 'ssh-1');
      if (endpoint === 'thread-project-state') return {
        inventory: { complete: true, errors: {} }, catalog: { local: {}, remote: saved },
        memberships: ['ssh-1', 'ssh-2'].map(hostId => ({ hostId, threadId: 'same', projectless: false,
          assignment: { projectKind: 'remote', projectId: 'project', hostId } })),
        membershipSources: [], outputDirectories: [], workspaceRoots: [],
        unresolved: { assignments: {}, projectless: [], outputDirectories: {}, workspaceRoots: {}, unreadable: {}, qualified: [] },
        resolvedThreadHosts: { same: ['ssh-1', 'ssh-2'] },
      } as T;
      if (endpoint === 'get-global-state') return { exists: true, value: structuredClone(saved) } as T;
      if (endpoint === 'set-global-state') {
        assert.deepEqual(params.expected, { exists: true, value: saved });
        saved = structuredClone(params.value as typeof saved); return {} as T;
      }
      throw new Error('unexpected host request');
    },
    subscribe() { return () => {}; }, async reply() { throw new Error('unexpected approval'); },
  };
  const project = { id: 'project', hostId: 'ssh-1', name: 'Alpha', rootPaths: ['/alpha'] };
  const service = createSidebarActionService({ client, requestName: () => null, confirm: () => true,
    assertProjectCurrent() {}, onCommitted() {} });
  assert.ok(!service.availableProjectActions(project).includes('open-in-file-manager'));
  await assert.rejects(service.onProjectAction(project, 'open-in-file-manager', authority(() => true)), /unavailable/);
  await service.onProjectAction(project, 'archive-chats', authority(() => true));
  await service.onProjectAction(project, 'remove', authority(() => true));
  assert.deepEqual(writes, [{ host: 'ssh-1', method: 'thread/archive', threadId: 'same' }]);
  assert.deepEqual(saved, [catalog[1]]);
});

declare global {
  interface Window {
    sidebarActions: {
      init(): Promise<void>;
      host(endpoint: string, params?: Record<string, unknown>): Promise<any>;
      rpc(method: string, params?: Record<string, unknown>): Promise<any>;
      perform(action: string): Promise<void>;
      revoke(): void;
      holdConfirm(): void;
      confirmHeld(): boolean;
      releaseConfirm(): void;
      holdMembership(): void;
      membershipHeld(): boolean;
      releaseMembership(): void;
      commits(): unknown[];
    };
  }
}

test('real browser client and native project transactions preserve other hosts and report revocation', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-side-actions-');
  const cleanup: Array<() => Promise<unknown>> = [() => rm(root, { recursive: true, force: true })];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const fake = await createFakeCodex(root); cleanup.push(() => fake.close());
  const fixture = await nativeFixture(root);
  fake.threads.set('one', fixtureThread('one', '/alpha'));
  fake.threads.set('two', fixtureThread('two', '/alpha'));
  fake.threads.set('other', fixtureThread('other', '/other'));
  fake.handlers.set('thread/list', params => fake.defaultResult('thread/list', { ...params, limit: 1 }));
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, renderer: fixture.renderer, adapterPath: fixture.adapterPath,
    hostCatalog: { hosts: [], projects: [], assignments: {} } });
  cleanup.push(() => app.close());
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  cleanup.push(() => browser.close());
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import {BrowserWorkbenchClient} from './src/renderer/app/client.ts';
    import {createSidebarActionService} from './src/renderer/app/sidebar-action-service.ts';
    const client = new BrowserWorkbenchClient();
    const project = {id:'p', name:'Alpha', hostId:'local', rootPaths:['/alpha']};
    let epoch=0, hold=false, held=false, release=()=>{}, commits=[];
    let holdMembership=false, membershipHeld=false, releaseMembership=()=>{};
    const realHost=client.host.bind(client);
    client.host=async (endpoint,params,options)=>{
      if(holdMembership && endpoint==='thread-projects' && params?.operation==='setMembership'){
        membershipHeld=true;await new Promise(resolve=>{releaseMembership=resolve;});membershipHeld=false;holdMembership=false;
      }
      return realHost(endpoint,params,options);
    };
    const service = createSidebarActionService({client, requestName:()=>null,
      confirm:async()=>{if(hold){held=true;await new Promise(resolve=>{release=resolve;});held=false;hold=false;}return true;},
      assertProjectCurrent(value){if(JSON.stringify(value)!==JSON.stringify(project))throw Error('project changed');},
      onCommitted(value, authority){authority.assertBeforeSend();commits.push(value);}});
    window.sidebarActions = {
      async init(){await client.connect();await client.rpc('thread/list',{},'local');},
      host:(endpoint,params={})=>client.host(endpoint,params),
      rpc:(method,params={})=>client.rpc(method,params,'local'),
      perform(action){const original=client.captureDaemonConnection('local'), captured=epoch;
        return service.onProjectAction(project,action,{daemonConnectionGeneration:original.generation,assertBeforeSend(){
          if(captured!==epoch)throw Error('authority revoked');original.assertOriginal();}});},
      revoke(){epoch++;},holdConfirm(){hold=true;},confirmHeld(){return held;},releaseConfirm(){release();},
      holdMembership(){holdMembership=true;},membershipHeld(){return membershipHeld;},releaseMembership(){releaseMembership();},
      commits(){return commits;}
    };
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();
  await page.route('**/workbench-entry.js', route => route.abort());
  await page.goto(app.url);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.evaluate(() => window.sidebarActions.init());
  const otherPage = await context.newPage();
  await otherPage.route('**/workbench-entry.js', route => route.abort());
  await otherPage.goto(app.url);
  await otherPage.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await otherPage.evaluate(() => window.sidebarActions.init());
  await page.evaluate(async () => {
    await window.sidebarActions.host('set-global-state', { key: 'local-projects', value: {
      '/alpha': { id: 'p', name: 'Alpha', rootPaths: ['/alpha'], future: { keep: true } },
      '/other': { id: 'q', name: 'Other', rootPaths: ['/other'], future: 3 },
    } });
    await window.sidebarActions.host('set-global-state', { key: 'remote-projects', value: [] });
    await window.sidebarActions.host('set-global-state', { key: 'thread-project-assignments', value: {
      $codexYardThreadProjects: 1, legacy: {}, hosts: {
        local: { one: { projectKind: 'local', projectId: 'p' }, two: { projectKind: 'local', projectId: 'p' } },
        'ssh-other': { one: { projectKind: 'remote', projectId: 'remote', hostId: 'ssh-other' } },
      }, future: { untouched: true },
    } });
    await window.sidebarActions.host('set-global-state', { key: 'thread-workspace-root-hints', value: { one: '/keep' } });
  });
  await page.evaluate(() => window.sidebarActions.holdConfirm());
  const blocked = page.evaluate(async () => {
    try { await window.sidebarActions.perform('archive-chats'); return 'unexpected success'; }
    catch (error) { return String(error); }
  });
  await page.waitForFunction(() => window.sidebarActions.confirmHeld());
  await page.evaluate(() => { window.sidebarActions.revoke(); window.sidebarActions.releaseConfirm(); });
  assert.match(await blocked, /authority revoked/);
  assert.equal(fake.calls('thread/archive').length, 0);
  await page.evaluate(() => window.sidebarActions.holdConfirm());
  const changedMembership = page.evaluate(async () => {
    try { await window.sidebarActions.perform('archive-chats'); return 'unexpected success'; }
    catch (error) { return String(error); }
  });
  await page.waitForFunction(() => window.sidebarActions.confirmHeld());
  await otherPage.evaluate(() => window.sidebarActions.host('thread-projects', { operation: 'setMembership',
    value: { hostId: 'local', threadId: 'one', assignment: null, projectless: true } }));
  await page.evaluate(() => window.sidebarActions.releaseConfirm());
  assert.match(await changedMembership, /conversations changed/);
  assert.equal(fake.calls('thread/archive').length, 0);
  await otherPage.evaluate(() => window.sidebarActions.host('thread-projects', { operation: 'setMembership',
    value: { hostId: 'local', threadId: 'one', assignment: { projectKind: 'local', projectId: 'p' }, projectless: false } }));
  fake.handlers.set('thread/archive', params => {
    if (params.threadId === 'two') throw new Error('fixture archive rejected');
    return fake.defaultResult('thread/archive', params);
  });
  const partial = await page.evaluate(async () => {
    try { await window.sidebarActions.perform('archive-chats'); return null; }
    catch (error) { const value = error as { name: string; completedThreadIds: string[]; failedThreadId: string };
      return { name: value.name, completed: value.completedThreadIds, failed: value.failedThreadId }; }
  });
  assert.deepEqual(partial, { name: 'SidebarPartialActionError', completed: ['one'], failed: 'two' });
  fake.handlers.delete('thread/archive');
  await page.evaluate(() => window.sidebarActions.rpc('thread/unarchive', { threadId: 'one' }));
  await page.evaluate(() => window.sidebarActions.perform('archive-chats'));
  assert.deepEqual([...fake.archived].sort(), ['one', 'two']);
  assert.ok(fake.calls('thread/list').some(call => call.params.cursor));
  await page.evaluate(() => window.sidebarActions.holdMembership());
  const staleMembership = page.evaluate(async () => {
    try { await window.sidebarActions.perform('remove'); return 'unexpected success'; }
    catch (error) { return String(error); }
  });
  await page.waitForFunction(() => window.sidebarActions.membershipHeld());
  await otherPage.evaluate(() => window.sidebarActions.host('thread-projects', { operation: 'setMembership',
    value: { hostId: 'local', threadId: 'one', assignment: { projectKind: 'local', projectId: 'q' }, projectless: false } }));
  await page.evaluate(() => window.sidebarActions.releaseMembership());
  assert.match(await staleMembership, /changed|变更|改变|不一致/);
  const intact = await otherPage.evaluate(() => window.sidebarActions.host('get-global-state', { key: 'local-projects' }));
  assert.ok(intact.value['/alpha']);
  await otherPage.evaluate(() => window.sidebarActions.host('thread-projects', { operation: 'setMembership',
    value: { hostId: 'local', threadId: 'one', assignment: { projectKind: 'local', projectId: 'p' }, projectless: false } }));
  await page.evaluate(() => window.sidebarActions.perform('remove'));
  const saved = await page.evaluate(async () => ({
    catalog: await window.sidebarActions.host('get-global-state', { key: 'local-projects' }),
    assignments: await window.sidebarActions.host('get-global-state', { key: 'thread-project-assignments' }),
    hints: await window.sidebarActions.host('get-global-state', { key: 'thread-workspace-root-hints' }),
    commits: window.sidebarActions.commits(),
  }));
  assert.deepEqual(saved.catalog.value, { '/other': { id: 'q', name: 'Other', rootPaths: ['/other'], future: 3 } });
  assert.deepEqual(saved.assignments.value.hosts['ssh-other'].one, { projectKind: 'remote', projectId: 'remote', hostId: 'ssh-other' });
  assert.deepEqual(saved.assignments.value.future, { untouched: true });
  assert.deepEqual(saved.hints.value, { one: '/keep' });
  assert.deepEqual(saved.commits.map(value => (value as { type: string }).type), ['archive-chats', 'remove-project']);
});
