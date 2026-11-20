import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexConnection } from '../lib/codex.ts';
import { createBackendSidebarState } from '../src/native/backend-sidebar-state.ts';
import { BrowserSidebarSections, sectionAtom } from '../src/native/browser-sidebar-sections.ts';
import { BrowserSidebarOrders } from '../src/native/browser-sidebar-orders.ts';
import { adaptSidebarState } from '../src/native/sidebar-state-renderer.ts';
import { createFakeCodex, fixtureThread } from './fake-codex.ts';
import { record } from '../src/native/protocol.ts';

function storage(initial: Record<string, unknown>) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, values };
}
test('moving a sidebar project preserves native chat membership and restores the placement from disk', async () => {
  const local = storage({ 'native-atoms': { draft: 'untouched' } });
  const requests: Record<string, unknown>[] = [];
  const request = async (params: Record<string, unknown>) => {
    requests.push(params);
    assert.equal(params.operation, 'snapshot');
    return { sections: [{ id: 'native', name: 'Shared group', appearance: null, threadIds: ['chat'] }] };
  };
  const sidebar = new BrowserSidebarSections(local, request, () => ['local']);
  assert.deepEqual(sidebar.projectSections(), []);
  assert.equal(requests.length, 0);
  const created = await sidebar.moveProject('project', { name: 'Projects for later' });
  assert.deepEqual(created.find(section => section.name === 'Projects for later')?.projectIds, ['project']);
  const projected = await sidebar.moveProject('project', { id: 'native' });
  assert.deepEqual(projected.find(section => section.id === 'native')?.projectIds, ['project']);
  const value = sidebar.value()['yard-app-server']!;
  assert.deepEqual(value.sections.find(section => section.id === 'native')?.itemKeys, ['codex:thread:local:chat', 'codex:project:project']);
  const reads = requests.length;
  const restarted = new BrowserSidebarSections(local, request, () => ['local']);
  assert.deepEqual(restarted.projectSections().find(section => section.id === 'native')?.projectIds, ['project']);
  assert.equal(requests.length, reads);
  assert.equal(JSON.parse(local.getItem('native-atoms')!).draft, 'untouched');
});

test('custom sections migrate once, keep only independent preferences and refresh external native edits', async t => {
  const root = await mkdtemp('/tmp/yard-sidebar-browser-');
  const fake = await createFakeCodex(root), connection = new CodexConnection(fake.socketPath);
  await connection.connect();
  t.after(async () => { connection.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  fake.threads.set('one', fixtureThread('one', root)); fake.threads.set('two', fixtureThread('two', root));
  const backend = createBackendSidebarState({ globals: {}, persist: async () => {}, publish() {},
    request: async (_host, method, params, mutating) => connection.request(method, params, { mutating }) });
  const old = { account: { sections: [{ id: 'old', name: 'Legacy group', itemKeys: ['codex:thread:local:one', 'codex:thread:local:two', 'space:page:nav:one'] }],
    collapsedSectionIds: ['old'], sectionOrder: ['pinned', 'custom:old', 'threads'] } };
  const local = storage({ 'native-atoms': { [sectionAtom]: old, 'prompt-drafts': { draft: 'keep' } } });
  const request = async (params: Record<string, unknown>) => params.operation === 'snapshot' ? backend.sectionSnapshot(String(params.hostId)) :
    backend.setSections(String(params.hostId), params.sections as Parameters<typeof backend.setSections>[1], { mode: 'merge' });
  const page = new BrowserSidebarSections(local, request, () => ['local']);
  const migrated = await page.load(), section = migrated.account!.sections[0]!;
  const nativeId = section.hostSectionIds!.local!;
  assert.equal(fake.sections.get(nativeId)?.name, 'Legacy group');
  assert.deepEqual(fake.sectionMembers.get(nativeId), ['one', 'two']);
  assert.deepEqual(migrated.account!.collapsedSectionIds, ['old']);
  assert.deepEqual(migrated.account!.sectionOrder, ['pinned', 'custom:old', 'threads']);
  const persisted = JSON.parse(local.getItem('native-atoms')!);
  assert.equal(persisted[sectionAtom], undefined); assert.deepEqual(persisted['prompt-drafts'], { draft: 'keep' });
  const preferences = JSON.parse(local.getItem('yard-sidebar-section-preferences-v1')!);
  assert.equal(JSON.stringify(preferences).includes('Legacy group'), false);
  assert.equal(JSON.stringify(preferences).includes('codex:thread:'), false);
  assert.deepEqual(preferences.account.links[0].mixedItemKeys, ['space:page:nav:one']);
  await connection.request('threadSection/update', { sectionId: nativeId, name: 'External rename' }, { mutating: true });
  await connection.request('thread/section/move', { threadId: 'two', sectionId: nativeId, beforeThreadId: 'one' }, { mutating: true });
  const reloaded = await new BrowserSidebarSections(local, request, () => ['local']).load();
  assert.equal(reloaded.account!.sections[0]!.name, 'External rename');
  assert.deepEqual(reloaded.account!.sections[0]!.itemKeys, ['space:page:nav:one', 'codex:thread:local:two', 'codex:thread:local:one']);
  assert.equal(fake.calls('threadSection/create').length, 1);
  // Optimistic UI persistence must leave the native command as the sole writer.
  const writes = fake.calls('threadSection/update').length;
  reloaded.account!.sections[0]!.name = 'Pending UI rename';
  await page.replace(reloaded);
  assert.equal(fake.calls('threadSection/update').length, writes);
  assert.equal(JSON.stringify(local.getItem('yard-sidebar-section-preferences-v1')).includes('Pending UI rename'), false);
});

test('anonymous sections share one bucket, isolate remote failures and forget only deleted hosts', async t => {
  t.mock.method(console, 'warn', () => {});
  const key = (id: string) => 'codex:thread:local:' + id;
  const local = storage({
    'yard-sidebar-section-preferences-v1': {
      '': { links: [{ id: 'remote', hostSectionIds: { 'ssh:remote': 'remote' }, mixedItemKeys: ['space:page:keep'] }],
        collapsedSectionIds: ['remote'], sectionOrder: ['custom:remote'] },
      'yard-app-server': { links: [{ id: 'local', hostSectionIds: { local: 'local' }, mixedItemKeys: [] }],
        collapsedSectionIds: [], sectionOrder: ['custom:local'] },
    },
    'native-atoms': { [sectionAtom]: { '': {
      sections: [
        { id: 'pending', name: 'Offline input', itemKeys: [key('pending-thread')], hostSectionIds: { 'ssh:broken': 'pending' } },
        { id: 'deleted-input', name: 'Deleted input', itemKeys: [key('deleted-thread')], hostSectionIds: { 'ssh:deleted': 'deleted-input' } },
      ], threadHostIds: { 'pending-thread': 'ssh:broken', 'deleted-thread': 'ssh:deleted' },
      collapsedSectionIds: ['deleted-input'], sectionOrder: ['custom:pending', 'custom:deleted-input'],
    } } },
  });
  const native = new Map([
    ['local', [{ id: 'local', name: 'Local', appearance: null, threadIds: ['local-thread'] }]],
    ['ssh:remote', [{ id: 'remote', name: 'Remote', appearance: null, threadIds: ['remote-thread'] }]],
  ]);
  const failed = new Set(['ssh:broken', 'ssh:deleted']);
  let hosts = ['local', 'ssh:remote', 'ssh:broken', 'ssh:deleted'];
  let requests = 0;
  const request = async (params: Record<string, unknown>) => {
    requests++;
    const host = String(params.hostId);
    if (failed.has(host)) throw new Error('offline');
    return params.operation === 'snapshot' ? { sections: native.get(host) ?? [] } : { sectionIds: {} };
  };
  const page = new BrowserSidebarSections(local, request, () => hosts);
  const initial = await page.load();
  assert.deepEqual(initial[''], initial['yard-app-server']);
  assert.ok(initial['yard-app-server']!.sections.some(section => section.id === 'local'));
  assert.ok(initial['yard-app-server']!.sections.some(section => section.itemKeys.includes(key('pending-thread'))));
  let preferences = JSON.parse(local.getItem('yard-sidebar-section-preferences-v1')!);
  assert.deepEqual(Object.keys(preferences), ['yard-app-server']);
  assert.deepEqual(preferences['yard-app-server'].links.find((link: { id: string }) => link.id === 'remote').mixedItemKeys, ['space:page:keep']);
  let legacy = JSON.parse(local.getItem('native-atoms')!)[sectionAtom];
  assert.deepEqual(Object.keys(legacy), ['yard-app-server']);
  assert.ok(legacy['yard-app-server'].sections.some((section: { id: string }) => section.id === 'pending'));

  // A failed refresh keeps the old remote snapshot while local still advances.
  failed.add('ssh:remote');
  native.get('local')![0]!.name = 'Local renamed';
  const refreshed = (await page.load())['yard-app-server']!;
  assert.equal(refreshed.sections.find(section => section.id === 'local')!.name, 'Local renamed');
  assert.ok(refreshed.sections.some(section => section.itemKeys.includes(key('remote-thread'))));
  hosts = ['local'];
  assert.ok((await page.load())['yard-app-server']!.sections.some(section => section.itemKeys.includes(key('remote-thread'))));

  // Only a complete catalog removes a profile; the offline profile is retained.
  const beforeRetain = requests;
  const retained = (await page.retainHosts(['ssh:broken']))['yard-app-server']!;
  assert.equal(requests, beforeRetain);
  assert.ok(retained.sections.some(section => section.itemKeys.includes(key('pending-thread'))));
  assert.equal(retained.sections.some(section => section.itemKeys.includes(key('remote-thread')) || section.itemKeys.includes(key('deleted-thread'))), false);
  assert.equal(retained.threadHostIds!['remote-thread'], undefined);
  assert.equal(retained.appServerMigratedHostIds!.includes('ssh:remote'), false);
  legacy = JSON.parse(local.getItem('native-atoms')!)[sectionAtom]['yard-app-server'];
  assert.deepEqual(legacy.sections.map((section: { id: string }) => section.id), ['pending']);
  assert.equal(legacy.threadHostIds['deleted-thread'], undefined);
  preferences = JSON.parse(local.getItem('yard-sidebar-section-preferences-v1')!);
  assert.equal(JSON.stringify(preferences).includes('ssh:remote'), false);
  assert.equal(JSON.stringify(preferences).includes('ssh:deleted'), false);
  assert.ok(retained.sections.find(section => section.id === 'remote')!.itemKeys.includes('space:page:keep'));
  assert.equal(preferences['yard-app-server'].links.find((link: { id: string }) => link.id === 'remote').name, 'Remote');
  assert.equal(preferences['yard-app-server'].links.find((link: { id: string }) => link.id === 'local').name, undefined);
  const mixedReload = (await page.load())['yard-app-server']!.sections.find(section => section.id === 'remote')!;
  assert.equal(mixedReload.name, 'Remote');
  assert.deepEqual(mixedReload.itemKeys, ['space:page:keep']);
  const restarted = await new BrowserSidebarSections(local, request, () => hosts).load();
  assert.deepEqual(restarted['yard-app-server']!.sections.find(section => section.id === 'remote'), mixedReload);

  const value = page.value();
  value['']!.sections.push({ id: 'alias-only', name: 'Stale alias', itemKeys: [] });
  await page.replace(value);
  assert.equal(page.value()['yard-app-server']!.sections.some(section => section.id === 'alias-only'), false);
  assert.deepEqual(Object.keys(JSON.parse(local.getItem('yard-sidebar-section-preferences-v1')!)), ['yard-app-server']);
  const fresh = await new BrowserSidebarSections(storage({ 'yard-sidebar-section-preferences-v1': {
    otherAccount: { links: [], collapsedSectionIds: [], sectionOrder: [] },
  } }), request, () => ['local']).load();
  assert.ok(fresh['yard-app-server']);
  assert.deepEqual(fresh[''], fresh['yard-app-server']);
});

test('renderer migration stays confirmed across replacements and pending removals survive reload', async () => {
  const source = await readFile('vendor/codex-app/26.1013.40934/webview/assets/app-initial-a68277f60b93.js', 'utf8');
  const migration = source.slice(source.indexOf('async function hAl('), source.indexOf('var gAl,_Al;'));
  const normalize = source.slice(source.indexOf('function g5n('), source.indexOf('function SO('));
  assert.ok(migration.startsWith('async function hAl('));
  // Exercise the actual fixed renderer's migration guard. An already confirmed
  // projection must return before consulting any native mutation services.
  const migrate = new Function(normalize + ';return (' + migration + ')')() as
    (scope: unknown, account: string, host: string, value: unknown, snapshot: unknown) => Promise<string>;
  const local = storage({});
  let merges = 0;
  const request = async (params: Record<string, unknown>) => {
    if (params.operation !== 'snapshot') { merges++; return { sectionIds: {} }; }
    return { sections: [
      { id: 'group', name: 'Native name', appearance: null, threadIds: ['member'] },
      { id: 'doomed', name: 'Pending native deletion', appearance: null, threadIds: [] },
    ] };
  };
  const page = new BrowserSidebarSections(local, request, () => ['local']);
  const initial = await page.load(), account = initial['yard-app-server']!;
  account.appServerDeletedSectionIds = ['doomed'];
  account.sections = account.sections.filter(section => section.id !== 'doomed');
  const pendingKey = 'codex:thread:local:unresolved';
  account.sections[0]!.itemKeys.push(pendingKey);
  account.sections[0]!.pendingDeletionHostIdsByItemKey = { [pendingKey]: ['ssh:offline'] };
  let current = initial;
  for (let iteration = 0; iteration < 3; iteration++) {
    // The read alias may lag behind a canonical UI write; it must never become
    // a second source for legacy migration or overwrite the current markers.
    current['']!.appServerMigratedHostIds = [];
    delete current['']!.appServerLegacySectionIds;
    const replaced = (await page.replace(current))['yard-app-server']!;
    assert.deepEqual(replaced.appServerMigratedHostIds, ['local']);
    assert.deepEqual(replaced.appServerLegacySectionIds, []);
    assert.deepEqual(replaced.appServerDeletedSectionIds, ['doomed']);
    assert.deepEqual(replaced.sections[0]!.pendingDeletionHostIdsByItemKey, { [pendingKey]: ['ssh:offline'] });
    assert.equal(await migrate({}, 'yard-app-server', 'local', replaced, {}), 'unchanged');
    current = await page.load();
    assert.equal(current['yard-app-server']!.sections.some(section => section.id === 'doomed'), false);
    assert.equal(await migrate({}, 'yard-app-server', 'local', current['yard-app-server'], {}), 'unchanged');
  }
  assert.equal(merges, 0);
  const preferences = JSON.parse(local.getItem('yard-sidebar-section-preferences-v1')!);
  const link = preferences['yard-app-server'].links.find((link: { id: string }) => link.id === 'group');
  assert.deepEqual(link.pendingDeletionHostIdsByItemKey, { [pendingKey]: ['ssh:offline'] });
  assert.equal(link.name, undefined);
  assert.equal(JSON.stringify(preferences).includes('appServer'), false);
  assert.equal(JSON.stringify(preferences).includes('Native name'), false);
  assert.equal(JSON.parse(local.getItem('native-atoms')!)[sectionAtom], undefined);

  const restarted = new BrowserSidebarSections(local, request, () => ['local']);
  const restored = await restarted.load(), section = restored['yard-app-server']!.sections.find(section => section.id === 'group')!;
  assert.ok(section.itemKeys.includes(pendingKey));
  assert.deepEqual(section.pendingDeletionHostIdsByItemKey, { [pendingKey]: ['ssh:offline'] });
  assert.equal(await migrate({}, 'yard-app-server', 'local', restored['yard-app-server'], {}), 'unchanged');
  delete section.pendingDeletionHostIdsByItemKey;
  section.itemKeys = section.itemKeys.filter(key => key !== pendingKey);
  await restarted.replace(restored);
  assert.equal(local.getItem('yard-sidebar-section-preferences-v1')!.includes('unresolved'), false);
  assert.equal((await restarted.load())['yard-app-server']!.sections.find(section => section.id === 'group')!.itemKeys.includes(pendingKey), false);
  assert.equal(merges, 0);
});

test('legacy hosts keep only their mixed-group members and converge after native support arrives', async () => {
  const key = (id: string) => 'codex:thread:local:' + id;
  const local = storage({});
  const native = new Map<string, { id: string; name: string; appearance: unknown; threadIds: string[] }[]>([
    ['local', [{ id: 'native-group', name: 'Mixed name', appearance: null, threadIds: ['native-member'] }]],
  ]);
  let hosts = ['local'];
  const merges: { hostId: string; sections: { id: string; name: string; threadIds: string[] }[] }[] = [];
  const request = async (params: Record<string, unknown>) => {
    const host = String(params.hostId);
    assert.ok(hosts.includes(host), 'unsupported/offline hosts are browser state, not native RPC destinations');
    if (params.operation === 'snapshot') return { sections: native.get(host) ?? [] };
    const sections = params.sections as { id: string; name: string; threadIds: string[] }[];
    merges.push({ hostId: host, sections: structuredClone(sections) });
    const sectionIds: Record<string, string> = {};
    const result = native.get(host) ?? [];
    for (const section of sections) {
      const id = 'upgraded-' + section.id;
      sectionIds[section.id] = id;
      if (!result.some(value => value.id === id)) result.push({ id, name: section.name, appearance: null, threadIds: [...section.threadIds] });
    }
    native.set(host, result);
    return { sectionIds };
  };
  const emptyLegacy = new BrowserSidebarSections(storage({ 'native-atoms': { [sectionAtom]: { 'yard-app-server': {
    sections: [{ id: 'old-empty', name: 'Historic empty group', itemKeys: [], hostSectionIds: { 'ssh:old': 'old-empty-native-id' } }],
    collapsedSectionIds: [], sectionOrder: ['custom:old-empty'],
  } } } }), request, () => hosts);
  const emptyGroup = (await emptyLegacy.load())['yard-app-server']!.sections.find(section => section.id === 'old-empty')!;
  assert.equal(emptyGroup.name, 'Historic empty group');
  assert.deepEqual(emptyGroup.hostSectionIds, { 'ssh:old': 'old-empty-native-id' });
  assert.equal(merges.length, 0);
  const page = new BrowserSidebarSections(local, request, () => hosts);
  const initial = await page.load(), account = initial['yard-app-server']!;
  account.sections[0]!.itemKeys = [key('old-two'), key('native-member'), key('old-one')];
  account.sections.push({ id: 'old-only', name: 'Old host group', itemKeys: [key('old-last')] });
  account.threadHostIds = { 'native-member': 'local', 'old-one': 'ssh:old', 'old-two': 'ssh:old', 'old-last': 'ssh:old' };
  account.sectionOrder = ['custom:old-only', 'custom:native-group', 'threads'];
  account.collapsedSectionIds = ['old-only'];
  await page.replace(initial);
  const pending = JSON.parse(local.getItem('native-atoms')!)[sectionAtom]['yard-app-server'];
  assert.deepEqual(pending.sections.find((section: { id: string }) => section.id === 'native-group').itemKeys, [key('old-two'), key('old-one')]);
  assert.equal(JSON.stringify(pending).includes('native-member'), false);
  assert.equal(local.getItem('yard-sidebar-section-preferences-v1')!.includes('native-member'), false);
  assert.deepEqual(pending.threadHostIds, { 'old-one': 'ssh:old', 'old-two': 'ssh:old', 'old-last': 'ssh:old' });
  await page.retainHosts(['ssh:old']);
  const restarted = new BrowserSidebarSections(local, request, () => hosts);
  let view = await restarted.load();
  assert.deepEqual(view['yard-app-server']!.sections.find(section => section.id === 'native-group')!.itemKeys,
    [key('old-two'), key('native-member'), key('old-one')]);
  assert.deepEqual(view['yard-app-server']!.sectionOrder, ['custom:old-only', 'custom:native-group', 'threads']);
  assert.deepEqual(view['yard-app-server']!.collapsedSectionIds, ['old-only']);

  // Pinning the last old-host member leaves its empty browser group available
  // for Undo and reload, without creating an unrelated local native group.
  const old = view['yard-app-server']!.sections.find(section => section.id === 'old-only')!;
  old.name = 'Renamed on old host'; old.itemKeys = [];
  await restarted.replace(view);
  view = await new BrowserSidebarSections(local, request, () => hosts).load();
  assert.equal(view['yard-app-server']!.sections.find(section => section.id === 'old-only')!.name, 'Renamed on old host');
  assert.deepEqual(view['yard-app-server']!.sections.find(section => section.id === 'old-only')!.itemKeys, []);
  assert.equal(merges.length, 0);
  const undo = view['yard-app-server']!.sections.find(section => section.id === 'old-only')!;
  undo.itemKeys = [key('old-last')];
  view['yard-app-server']!.threadHostIds!['old-last'] = 'ssh:old';
  await restarted.replace(view);
  view = await restarted.load();
  assert.deepEqual(view['yard-app-server']!.sections.find(section => section.id === 'old-only')!.itemKeys, [key('old-last')]);
  view['yard-app-server']!.sections = view['yard-app-server']!.sections.filter(section => section.id !== 'old-only');
  await restarted.replace(view);
  assert.equal((await restarted.load())['yard-app-server']!.sections.some(section => section.id === 'old-only'), false);

  // A later backend upgrade imports only its pending members. Shared host
  // slots retain cross-host placement without persisting native thread IDs.
  hosts = ['local', 'ssh:old'];
  const upgraded = (await restarted.load())['yard-app-server']!;
  assert.equal(merges.length, 1);
  assert.equal(merges[0]!.hostId, 'ssh:old');
  assert.deepEqual(merges[0]!.sections[0]!.threadIds, ['old-two', 'old-one']);
  assert.deepEqual(upgraded.sections.find(section => section.id === 'native-group')!.itemKeys,
    [key('old-two'), key('native-member'), key('old-one')]);
  assert.equal(JSON.parse(local.getItem('native-atoms')!)[sectionAtom], undefined);
  const preferences = JSON.parse(local.getItem('yard-sidebar-section-preferences-v1')!)['yard-app-server'];
  assert.equal(preferences.links[0].legacyHostIds, undefined);
  assert.equal(JSON.stringify(preferences).includes('codex:thread:'), false);
  const reloaded = await new BrowserSidebarSections(local, request, () => hosts).load();
  assert.deepEqual(reloaded['yard-app-server']!.sections.find(section => section.id === 'native-group')!.itemKeys,
    [key('old-two'), key('native-member'), key('old-one')]);
  assert.equal(merges.length, 1);
});

test('sidebar ordering respects native host order and persists only mixed navigation slots', async () => {
  const local = storage({ 'native-atoms': { 'unified-sidebar-project-order-v1': ['codex:project:old-b', 'codex:project:old-a'],
    'app-server-pinned-thread-order-v1': ['two', 'one'] } });
  const state = { projects: [{ id: 'a', hostId: 'local' }, { id: 'b', hostId: 'local' }],
    pins: [{ id: 'one', hostId: 'local' }, { id: 'two', hostId: 'local' }], aliases: { local: { 'old-a': 'a', 'old-b': 'b' } } };
  const writes: unknown[] = [];
  const orders = new BrowserSidebarOrders(local, async params => {
    if (params.operation === 'project-order') { writes.push(params.ids); state.projects.reverse(); return {}; }
    return state;
  });
  const first = await orders.load();
  assert.deepEqual(first['unified-sidebar-project-order-v1'], ['codex:project:a', 'codex:project:b']);
  assert.deepEqual(first['app-server-pinned-thread-order-v1'], ['one', 'two']);
  assert.deepEqual(JSON.parse(local.getItem('native-atoms')!), {});
  await orders.update('unified-sidebar-project-order-v1', ['codex:project:b', 'space:page:nav', 'codex:project:a']);
  assert.deepEqual(writes, [['b', 'a']]);
  assert.deepEqual(JSON.parse(local.getItem('native-atoms')!)['unified-sidebar-project-order-v1'], ['codex:project:b', 'space:page:nav', 'codex:project:a']);
  const mixed = await orders.update('unified-sidebar-pinned-order-v1', ['codex:thread:local:two', 'site:nav', 'codex:thread:local:one']);
  assert.deepEqual(mixed, ['codex:thread:local:one', 'site:nav', 'codex:thread:local:two']);
});

test('the fixed renderer uses the supplied native section command service', async () => {
  const path = '/assets/app-initial-a68277f60b93.js';
  const input = await readFile(join('vendor/codex-app/26.1013.40934/webview', path));
  const output = adaptSidebarState(path, input).toString();
  assert.ok(output.includes('xT=Z(q,()=>!0)'));
  assert.ok(output.includes('o.listSections()')); assert.ok(output.includes('e.service.setThreadSection('));
  assert.throws(() => adaptSidebarState(path, Buffer.from('changed upstream')), /版本不匹配/);
  assert.deepEqual(record(null), {});
});
