import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendSidebarState, PINNED_SECTION_ID, sidebarMetadata } from '../src/native/backend-sidebar-state.ts';
import type { BackendSidebarState, SidebarProject, SidebarSection } from '../src/native/backend-sidebar-state.ts';
import { createThreadProjects } from '../src/native/thread-projects.ts';
import { projectService } from '../src/native/browser-projects.ts';
import type { ObjectValue } from '../src/native/protocol.ts';

interface Thread { id: string; projectId: string | null; section: SidebarSection | null; cwd: string; archived?: boolean }
function project(id: string, path: string, metadata: Record<string, string> = {}): SidebarProject {
  return { id, name: id, roots: [{ path }], metadata, position: 0, createdAt: 1, updatedAt: 2 };
}
function fixture(globals: ObjectValue = {}, hostIds = ['local'], supportedHosts = hostIds) {
  const stores = new Map(hostIds.map(hostId => [hostId, { projects: [] as SidebarProject[],
    sections: [{ id: PINNED_SECTION_ID, name: 'Pinned', appearance: null }] as SidebarSection[],
    threads: new Map<string, Thread>(), members: new Map<string, string[]>([[PINNED_SECTION_ID, []]]), keys: new Map<string, string>() }]));
  const calls: { hostId: string; method: string; params: ObjectValue; mutating: boolean }[] = [], events: unknown[] = [];
  let fail: ((method: string, params: ObjectValue) => Error | undefined) | undefined;
  let diskFailure = false, saved: ObjectValue = {}, sequence = 0;
  let activeHosts = hostIds;
  const supported = new Set(supportedHosts);
  let backend: BackendSidebarState;
  const request = async (hostId: string, method: string, params: ObjectValue, mutating = false): Promise<unknown> => {
    calls.push({ hostId, method, params, mutating });
    const failure = fail?.(method, params); if (failure) throw failure;
    const store = stores.get(hostId)!;
    const requiredProject = () => { const p = store.projects.find(project => project.id === params.projectId); if (!p) throw new Error('project not found'); return p; };
    const requiredThread = () => { const t = store.threads.get(String(params.threadId)); if (!t) throw new Error('thread not found: ' + params.threadId); return t; };
    const paged = (data: unknown[]) => {
      // Force pagination independently of the requested page size.
      const start = Number(params.cursor ?? 0), end = start + 2;
      return { data: structuredClone(data.slice(start, end)), nextCursor: end < data.length ? String(end) : null };
    };
    switch (method) {
      case 'project/list': return paged(store.projects.map((project, position) => ({ ...project, position })));
      case 'project/read': return { project: structuredClone(requiredProject()) };
      case 'project/create': {
        const existing = store.keys.get(String(params.idempotencyKey));
        if (existing && store.projects.some(project => project.id === existing)) return { project: structuredClone(store.projects.find(project => project.id === existing)) };
        const p = { ...project('native-' + ++sequence, ''), name: params.name as string,
          roots: params.roots as SidebarProject['roots'], metadata: params.metadata as Record<string, string> ?? {} };
        store.projects.push(p); store.keys.set(String(params.idempotencyKey), p.id); return { project: structuredClone(p) };
      }
      case 'project/update': {
        const p = requiredProject();
        for (const key of ['name', 'roots', 'metadata'] as const) if (Object.hasOwn(params, key)) Object.assign(p, { [key]: structuredClone(params[key]) });
        return { project: structuredClone(p) };
      }
      case 'project/move': {
        const p = requiredProject(); store.projects = store.projects.filter(project => project !== p);
        const at = store.projects.findIndex(project => project.id === params.beforeProjectId);
        store.projects.splice(at < 0 ? store.projects.length : at, 0, p); return {};
      }
      case 'project/delete': {
        const p = requiredProject(); store.projects = store.projects.filter(project => project !== p);
        for (const thread of store.threads.values()) if (thread.projectId === p.id) thread.projectId = null;
        return {};
      }
      case 'thread/read': return { thread: structuredClone(requiredThread()) };
      case 'thread/list': {
        assert.ok(Object.hasOwn(params, 'sectionId') || Object.hasOwn(params, 'projectId'), 'no whole-history scan');
        const ids = params.sectionId ? store.members.get(String(params.sectionId)) ?? [] : [...store.threads.keys()];
        return paged(ids.map(id => store.threads.get(id)!).filter(thread => (params.projectId === undefined || thread.projectId === params.projectId) &&
          (thread.archived ?? false) === (params.archived === true)));
      }
      case 'thread/metadata/update': {
        const thread = requiredThread(); if (params.projectId) requiredProject(); thread.projectId = params.projectId ? String(params.projectId) : null; return {};
      }
      case 'threadSection/list': return paged(store.sections);
      case 'threadSection/create': {
        const section = { id: 'section-' + ++sequence, name: String(params.name), appearance: params.appearance as SidebarSection['appearance'] ?? null };
        store.sections.push(section); store.members.set(section.id, []); return { section: structuredClone(section) };
      }
      case 'threadSection/update': {
        const section = store.sections.find(section => section.id === params.sectionId)!;
        section.name = String(params.name); if (Object.hasOwn(params, 'appearance')) section.appearance = params.appearance as SidebarSection['appearance'];
        return { section: structuredClone(section) };
      }
      case 'threadSection/delete': {
        store.sections = store.sections.filter(section => section.id !== params.sectionId); store.members.delete(String(params.sectionId));
        for (const thread of store.threads.values()) if (thread.section?.id === params.sectionId) thread.section = null; return {};
      }
      case 'thread/section/move': {
        const thread = requiredThread();
        for (const [id, members] of store.members) store.members.set(id, members.filter(id => id !== thread.id));
        thread.section = store.sections.find(section => section.id === params.sectionId) ?? null;
        if (thread.section) {
          const ids = store.members.get(thread.section.id) ?? [], at = ids.indexOf(String(params.beforeThreadId));
          ids.splice(at < 0 ? ids.length : at, 0, thread.id); store.members.set(thread.section.id, ids);
        }
        return {};
      }
      default: throw new Error('unexpected request: ' + method);
    }
  };
  backend = createBackendSidebarState({ globals, hostIds: () => activeHosts, knownHostIds: () => hostIds, supportsHost: id => supported.has(id),
    validHost: id => { if (!stores.has(id)) throw new Error('unknown host'); },
    request, publish: event => events.push(event), async persist() { if (diskFailure) throw new Error('disk full'); saved = structuredClone(backend.persistenceGlobals()); } });
  function thread(id: string, { hostId = 'local', projectId = null, sectionId = null }: { hostId?: string; projectId?: string | null; sectionId?: string | null } = {}) {
    const store = stores.get(hostId)!, section = store.sections.find(section => section.id === sectionId) ?? null;
    const thread: Thread = { id, projectId, section, cwd: '/cwd/' + id }; store.threads.set(id, thread);
    if (section) store.members.set(section.id, [...store.members.get(section.id) ?? [], id]); return thread;
  }
  return { backend, globals, stores, calls, events, request, thread, get saved() { return saved; },
    fail(value: typeof fail) { fail = value; }, diskFail(value: boolean) { diskFailure = value; },
    activeHosts(value: string[]) { activeHosts = value; },
    supportedHost(hostId: string, value: boolean) { if (value) supported.add(hostId); else supported.delete(hostId); },
    persist: async () => { if (diskFailure) throw new Error('disk full'); saved = structuredClone(backend.persistenceGlobals()); } };
}

test('legacy catalog, assignments and pins merge into backend and contract the old store', async () => {
  const h = fixture({ 'local-projects': { '/old': { id: '/old', name: 'old name', rootPaths: ['/old'] }, '/new': { id: '/new', name: 'new name', rootPaths: ['/new'] } },
    'thread-project-assignments': { nativeWins: { projectKind: 'local', projectId: '/old' }, migrated: { projectKind: 'local', projectId: '/new' } },
    'pinned-thread-ids': ['legacy', 'custom', 'nativePin'], 'project-order': ['/new', '/old'],
    'project-appearances': { '/old': { color: 'red' } }, 'sidebar-project-thread-orders': { '/new': { threadIds: ['migrated'] } },
    'thread-workspace-root-hints': { migrated: '/cwd/migrated', pending: '/future' }, 'projectless-thread-ids': ['nativeWins'] });
  const store = h.stores.get('local')!;
  store.projects.push(project('existing', '/old', { [sidebarMetadata.appearance]: JSON.stringify({ color: 'blue' }) }), project('external', '/external'));
  const section = { id: 'custom', name: 'Native custom', appearance: null }; store.sections.push(section); store.members.set('custom', []);
  h.thread('nativeWins', { projectId: 'external' }); h.thread('migrated'); h.thread('nativePin', { sectionId: PINNED_SECTION_ID });
  h.thread('legacy'); h.thread('custom', { sectionId: 'custom' });
  await h.backend.ensureHost();
  const added = store.projects.find(project => project.roots[0].path === '/new')!;
  assert.equal(store.projects[0].id, 'existing'); assert.equal(store.projects[0].name, 'existing');
  assert.equal(store.threads.get('nativeWins')!.projectId, 'external'); assert.equal(store.threads.get('migrated')!.projectId, added.id);
  assert.deepEqual((await h.backend.pins.list()).threadIds, ['nativePin', 'legacy']);
  assert.equal(store.threads.get('custom')!.section?.id, 'custom');
  assert.deepEqual(JSON.parse(store.projects[0].metadata[sidebarMetadata.appearance]), { color: 'blue' });
  assert.deepEqual(JSON.parse(added.metadata[sidebarMetadata.threadOrder]), { threadIds: ['migrated'] });
  for (const key of ['local-projects', 'thread-project-assignments', 'pinned-thread-ids', 'project-appearances', 'sidebar-project-thread-orders', 'project-order']) assert.equal(h.saved[key], undefined, key);
  assert.deepEqual(h.backend.persistenceGlobals()['thread-workspace-root-hints'], { pending: '/future' });
  assert.deepEqual(h.saved['projectless-thread-ids'], ['nativeWins']);
  await h.backend.ensureHost(); assert.equal(h.calls.filter(call => call.method === 'project/create').length, 1);
});

test('failed backend migration and cleanup keep original inputs and retry without duplicate projects', async () => {
  const input = { 'local-projects': { '/old': { rootPaths: ['/old'], name: 'old' } },
    'thread-project-assignments': { chat: { projectKind: 'local', projectId: '/old' } }, 'pinned-thread-ids': ['chat'] };
  const h = fixture(structuredClone(input)); h.thread('chat');
  h.fail(method => method === 'thread/metadata/update' ? new Error('network down') : undefined);
  await assert.rejects(h.backend.ensureHost(), /network down/);
  assert.deepEqual(h.backend.persistenceGlobals(), input); assert.deepEqual(h.globals, input);
  h.fail(undefined); h.diskFail(true);
  await assert.rejects(h.backend.ensureHost(), /disk full/);
  assert.deepEqual(h.backend.persistenceGlobals(), input);
  assert.equal(h.stores.get('local')!.projects.length, 1);
  h.diskFail(false); await h.backend.ensureHost();
  assert.equal(h.stores.get('local')!.projects.length, 1); assert.deepEqual(h.saved, {});
});

test('deleted legacy threads and orphaned project references are pruned, real protocol errors reject', async () => {
  const h = fixture({ 'thread-project-assignments': { missing: { projectKind: 'local', projectId: '/gone' },
    live: { projectKind: 'local', projectId: '/gone' } }, 'pinned-thread-ids': ['missing'] });
  h.thread('live'); await h.backend.ensureHost(); assert.deepEqual(h.saved, {});
  const failed = fixture({ 'pinned-thread-ids': ['chat'] }); failed.thread('chat');
  failed.fail(method => method === 'thread/read' ? new Error('unsupported thread protocol') : undefined);
  await assert.rejects(failed.backend.ensureHost(), /unsupported/);
  assert.deepEqual(failed.backend.persistenceGlobals(), { 'pinned-thread-ids': ['chat'] });
});

test('legacy missing read errors prune stale IDs while existing unloaded threads keep their migrated membership and pins', async () => {
  const assignment = { projectKind: 'local', projectId: '/project' };
  const h = fixture({ 'local-projects': { '/project': { name: 'Project', rootPaths: ['/project'] } },
    'thread-project-assignments': { history: assignment, stale: assignment }, 'pinned-thread-ids': ['stale', 'history'] });
  const history = h.thread('history');
  h.fail((method, params) => method === 'thread/read' && params.threadId === 'stale' ?
    Object.assign(new Error('thread not loaded: stale'), { code: -32600 }) : undefined);
  await h.backend.ensureHost();
  assert.equal(history.projectId, h.backend.resolveProjectId('local', '/project'));
  assert.equal(history.section?.id, PINNED_SECTION_ID);
  assert.deepEqual((await h.backend.pins.list()).threadIds, ['history']);
  assert.equal(h.calls.some(call => call.method === 'thread/resume'), false);
  for (const key of ['local-projects', 'thread-project-assignments', 'pinned-thread-ids']) assert.equal(h.saved[key], undefined, key);
});

test('not-loaded write failures and mismatched read errors preserve migration input and reject without replaying writes', async () => {
  const input = { 'local-projects': { '/project': { name: 'Project', rootPaths: ['/project'] } },
    'thread-project-assignments': { history: { projectKind: 'local', projectId: '/project' } }, 'pinned-thread-ids': ['history'] };
  for (const [method, message, code] of [['thread/metadata/update', 'thread not loaded: history', -32600],
    ['thread/section/move', 'thread not loaded: history', -32600], ['thread/read', 'thread not loaded: another-thread', -32600],
    ['thread/read', 'thread not loaded: history', -32603]] as const) {
    const h = fixture(structuredClone(input)); h.thread('history');
    h.fail(current => current === method ? Object.assign(new Error(message), { code }) : undefined);
    await assert.rejects(h.backend.ensureHost(), { message });
    assert.deepEqual(h.backend.persistenceGlobals(), input);
    if (method !== 'thread/read') assert.equal(h.calls.filter(call => call.method === method).length, 1);
  }
});

test('host ownership remains distinct and ambiguous remote pins are retained until that host is read', async () => {
  const h = fixture({ 'remote-projects': [{ id: 'oldRemote', hostId: 'ssh', label: 'Remote', remotePath: '/remote' }],
    'thread-project-assignments': { remote: { projectKind: 'remote', hostId: 'ssh', projectId: 'oldRemote' } },
    'pinned-thread-ids': ['unassignedRemote'], 'projectless-thread-ids': ['remote'] }, ['local', 'ssh']);
  h.thread('remote', { hostId: 'ssh' }); h.thread('unassignedRemote', { hostId: 'ssh' });
  await h.backend.ensureHost('local'); assert.deepEqual(h.backend.persistenceGlobals()['pinned-thread-ids'], ['unassignedRemote']);
  await h.backend.ensureHost('ssh');
  const id = h.stores.get('ssh')!.projects[0].id;
  assert.deepEqual(h.globals['thread-project-assignments'], { remote: { projectKind: 'remote', hostId: 'ssh', projectId: id } });
  assert.deepEqual((await h.backend.pins.list({ hostId: 'ssh' })).threadIds, ['unassignedRemote']);
  assert.equal(h.backend.persistenceGlobals()['pinned-thread-ids'], undefined);
  await assert.rejects(h.backend.setAssignment('remote', 'ssh', { projectKind: 'local', projectId: id }), /执行主机/);
  assert.deepEqual(h.backend.persistenceGlobals()['projectless-thread-ids'], ['remote']);
});

test('pins read real backend state, preserve external additions, and cancel queued writes before delivery', async () => {
  const h = fixture(); h.thread('a', { sectionId: PINNED_SECTION_ID }); h.thread('b'); h.thread('c');
  await h.backend.ensureHost(); await h.backend.pins.set({ threadId: 'b', pinned: true });
  assert.deepEqual((await h.backend.pins.list()).threadIds, ['b', 'a']);
  await h.request('local', 'thread/section/move', { threadId: 'c', sectionId: PINNED_SECTION_ID }, true);
  await h.backend.pins.setOrder({ threadIds: ['a', 'b'], movedThreadId: 'a' });
  assert.deepEqual((await h.backend.pins.list()).threadIds, ['a', 'b', 'c']);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  const before = h.calls.filter(call => call.mutating).length;
  await assert.rejects(h.backend.pins.set({ threadId: 'a', pinned: false }, controller.signal), /cancelled/);
  assert.equal(h.calls.filter(call => call.mutating).length, before);
  h.fail(method => method === 'thread/section/move' ? new Error('backend rejected') : undefined);
  await assert.rejects(h.backend.pins.set({ threadId: 'a', pinned: false }), /backend rejected/);
  assert.deepEqual(h.globals['pinned-thread-ids'], ['a', 'b', 'c']);
});

test('sections merge once, rename and move members across sections, and refresh external changes', async () => {
  const h = fixture(); for (const id of ['a', 'b', 'c']) h.thread(id);
  await h.backend.ensureHost();
  const first = await h.backend.setSections('local', [{ id: 'oldA', name: 'A', appearance: null, threadIds: ['a'] },
    { id: 'oldB', name: 'B', appearance: { icon: 'star', color: 'red' }, threadIds: ['b', 'c'] }]);
  await h.backend.setSections('local', [{ id: 'oldA', name: 'A', appearance: null, threadIds: ['a'] }]);
  assert.equal(h.stores.get('local')!.sections.length, 3);
  const a = first.sectionIds.oldA, b = first.sectionIds.oldB;
  await h.backend.setSections('local', [{ id: a, name: 'Renamed A', appearance: null, threadIds: ['b'] },
    { id: b, name: 'B', appearance: null, threadIds: ['a', 'c'] }], { mode: 'replace' });
  const snapshot = await h.backend.sectionSnapshot();
  assert.deepEqual(snapshot.sections.map(section => [section.name, section.threadIds]), [['Renamed A', ['b']], ['B', ['a', 'c']]]);
  await h.request('local', 'thread/section/move', { threadId: 'c', sectionId: PINNED_SECTION_ID }, true);
  assert.deepEqual((await h.backend.sectionSnapshot()).pinnedThreadIds, ['c']);
  await h.backend.setSections('local', [{ id: a, name: 'Renamed A', appearance: null, threadIds: ['b'] }], { mode: 'replace' });
  assert.deepEqual((await h.backend.sectionSnapshot()).sections.map(section => section.id), [a]);
});

test('explicit section deletions preserve a section created by another client after the page snapshot', async () => {
  const h = fixture(); h.thread('a'); h.thread('b'); await h.backend.ensureHost();
  const initial = await h.backend.setSections('local', [{ id: 'oldA', name: 'A', appearance: null, threadIds: ['a'] }]);
  const a = initial.sectionIds.oldA;
  const external = await h.request('local', 'threadSection/create', { name: 'External', appearance: null }, true) as { section: SidebarSection };
  await h.backend.setSections('local', [{ id: a, name: 'Edited A', appearance: null, threadIds: ['b'] }], { mode: 'replace', deleteSectionIds: [] });
  assert.deepEqual((await h.backend.sectionSnapshot()).sections.map(section => section.name), ['Edited A', 'External']);
  await h.backend.setSections('local', [], { mode: 'replace', deleteSectionIds: [a] });
  assert.deepEqual((await h.backend.sectionSnapshot()).sections.map(section => section.id), [external.section.id]);
  const before = h.calls.filter(call => call.mutating).length;
  await assert.rejects(h.backend.setSections('local', [{ id: 'invalid', name: 'Invalid', appearance: null, threadIds: ['', 'a'] }]), /无效/);
  assert.equal(h.calls.filter(call => call.mutating).length, before);
});

test('cancellation after a pin request queues prevents its backend write', async () => {
  const h = fixture(); h.thread('a'); h.thread('b'); await h.backend.ensureHost();
  const controller = new AbortController();
  const first = h.backend.pins.set({ threadId: 'a', pinned: true });
  const second = h.backend.pins.set({ threadId: 'b', pinned: true }, controller.signal);
  controller.abort(new Error('queued cancelled'));
  await assert.rejects(second, /queued cancelled/); await first;
  assert.deepEqual((await h.backend.pins.list()).threadIds, ['a']);
  assert.equal(h.calls.some(call => call.mutating && call.params.threadId === 'b'), false);
});

test('renderer global writes update native catalog, metadata, order and deletion without durable projections', async () => {
  const h = fixture(); h.thread('chat');
  await h.backend.ensureHost();
  await h.backend.setGlobal('local-projects', { '/a': { name: 'A', rootPaths: ['/a'] }, '/b': { name: 'B', rootPaths: ['/b'] } });
  const a = h.backend.resolveProjectId('local', '/a')!, b = h.backend.resolveProjectId('local', '/b')!;
  await h.backend.setGlobal('project-appearances', { [a]: { color: 'green', marker: 'circle' } });
  await h.backend.setGlobal('sidebar-project-thread-orders', { [a]: { threadIds: ['chat'] } });
  await h.backend.setGlobal('pinned-project-ids', [a]);
  await h.backend.setGlobal('project-order', [b, a]);
  await h.backend.setGlobal('thread-project-assignments', { chat: { projectKind: 'local', projectId: '/a' } });
  assert.deepEqual(h.stores.get('local')!.projects.map(project => project.id), [b, a]);
  assert.equal(h.stores.get('local')!.threads.get('chat')!.projectId, a);
  const metadata = h.stores.get('local')!.projects.find(project => project.id === a)!.metadata;
  assert.deepEqual(JSON.parse(metadata[sidebarMetadata.appearance]), { color: 'green', marker: 'circle' });
  assert.deepEqual(JSON.parse(metadata[sidebarMetadata.threadOrder]), { threadIds: ['chat'] });
  await h.backend.setGlobal('local-projects', { [b]: { name: 'B renamed', rootPaths: ['/b'] } });
  assert.equal(h.stores.get('local')!.projects[0].name, 'B renamed');
  assert.equal(h.stores.get('local')!.threads.get('chat')!.projectId, null);
  assert.equal(h.backend.resolveProjectId('local', '/a'), undefined);
  assert.equal((h.globals['thread-project-assignments'] as ObjectValue).chat, undefined);
  assert.equal(h.saved['local-projects'], undefined); assert.equal(h.saved['project-appearances'], undefined);
  assert.equal(h.saved['sidebar-project-thread-orders'], undefined); assert.equal(h.saved['thread-project-assignments'], undefined);
  assert.equal(h.saved['project-order'], undefined, 'deleting a project cannot turn native same-host ordering into a client-owned copy');
});

function rendererProjects(h: ReturnType<typeof fixture>) {
  const memberships = createThreadProjects(h.globals, h.persist, event => h.events.push(event), () => {}, h.backend);
  return projectService(class {}, async (endpoint, body) => {
    const value = body as ObjectValue;
    if (endpoint === 'get-global-state') return { value: structuredClone(h.globals[String(value.key)]) };
    if (endpoint === 'set-global-state') return h.backend.setGlobal(String(value.key), value.value);
    if (endpoint === 'thread-projects') return memberships(value.operation as Parameters<typeof memberships>[0], value.value);
    throw new Error('unexpected host endpoint: ' + endpoint);
  });
}

test('removing an empty duplicate preserves the other project and Undo restores a distinct identity', async () => {
  const h = fixture(), store = h.stores.get('local')!;
  store.projects.push(project('kept', '/same'), project('empty', '/same'));
  h.thread('existing', { projectId: 'kept' });
  await h.backend.ensureHost();
  const projects = rendererProjects(h);
  const removed = await projects.removeLocal('empty');
  assert.deepEqual(removed.previousMemberships, []);
  assert.deepEqual(store.projects.map(project => project.id), ['kept']);
  assert.equal(store.threads.get('existing')!.projectId, 'kept');
  await projects.upsertLocal({ projectId: 'empty', name: 'Restored', sources: ['/same'] });
  const restored = h.backend.resolveProjectId('local', 'empty');
  assert.ok(restored && restored !== 'kept');
  assert.equal(store.projects.length, 2);
  await projects.setProjectOrder(['kept', 'empty', restored]);
  assert.ok(h.calls.filter(call => call.method === 'project/move').every(call => call.params.projectId !== call.params.beforeProjectId));
  assert.deepEqual(store.projects.map(project => project.id), ['kept', restored]);
  await projects.removeLocal('empty'); // Redo uses the old renderer ID.
  assert.deepEqual(store.projects.map(project => project.id), ['kept']);
  assert.equal(store.threads.get('existing')!.projectId, 'kept');
  assert.equal(h.calls.some(call => call.method === 'thread/delete'), false);
});

test('local project removal preserves ordinary and archived threads and restores both memberships', async () => {
  const h = fixture(), store = h.stores.get('local')!;
  store.projects.push(project('removed', '/removed'));
  h.thread('ordinary', { projectId: 'removed' });
  h.thread('archived', { projectId: 'removed' }).archived = true;
  await h.backend.ensureHost();
  const projects = rendererProjects(h), memberships = createThreadProjects(h.globals, h.persist, () => {}, () => {}, h.backend);
  const { previousMemberships } = await projects.removeLocal('removed');
  assert.equal(store.threads.size, 2);
  assert.ok([...store.threads.values()].every(thread => thread.projectId === null));
  await projects.upsertLocal({ projectId: 'removed', name: 'Restored', sources: ['/removed'] });
  await memberships('restoreMemberships', previousMemberships);
  const restored = h.backend.resolveProjectId('local', 'removed');
  assert.ok([...store.threads.values()].every(thread => thread.projectId === restored));
  assert.deepEqual(h.globals['projectless-thread-ids'], []);
  assert.equal(store.threads.get('archived')!.archived, true);
});

test('a rejected project deletion restores the memberships changed before the catalog write', async () => {
  const h = fixture(), store = h.stores.get('local')!;
  store.projects.push(project('kept', '/kept')); h.thread('existing', { projectId: 'kept' });
  await h.backend.ensureHost();
  h.fail(method => method === 'project/delete' ? new Error('deletion rejected') : undefined);
  await assert.rejects(rendererProjects(h).removeLocal('kept'), /deletion rejected/);
  assert.equal(store.projects.length, 1);
  assert.equal(store.threads.get('existing')!.projectId, 'kept');
  assert.deepEqual(h.globals['projectless-thread-ids'], []);
});

test('projectless state stays independent and local persistence failure compensates native assignment', async () => {
  const h = fixture(); h.stores.get('local')!.projects.push(project('a', '/a'), project('b', '/b')); h.thread('chat', { projectId: 'a' });
  await h.backend.ensureHost();
  const memberships = createThreadProjects(h.globals, h.persist, event => h.events.push(event), () => {}, h.backend);
  h.diskFail(true);
  await assert.rejects(memberships('setMembership', { threadId: 'chat', assignment: { projectKind: 'local', projectId: 'b' }, projectless: true }), /disk full/);
  assert.equal(h.stores.get('local')!.threads.get('chat')!.projectId, 'a');
  assert.equal(h.globals['projectless-thread-ids'], undefined);
  h.diskFail(false);
  await memberships('setMembership', { threadId: 'chat', assignment: { projectKind: 'local', projectId: 'b' }, projectless: true });
  assert.equal(h.stores.get('local')!.threads.get('chat')!.projectId, 'b');
  assert.deepEqual(h.saved['projectless-thread-ids'], ['chat']);
  await h.backend.observeBackend('local', { method: 'thread/project/updated', params: { threadId: 'chat', projectId: 'a' } });
  assert.deepEqual(h.globals['thread-project-assignments'], { chat: { projectKind: 'local', projectId: 'a' } });
  assert.deepEqual(h.globals['projectless-thread-ids'], ['chat']);
});

test('thread-start project IDs resolve legacy identities and confirming the assignment never writes metadata', async () => {
  const h = fixture({ 'local-projects': { '/old': { name: 'Old', rootPaths: ['/old'] } } });
  await h.backend.ensureHost(); const id = h.backend.resolveProjectId('local', '/old')!;
  const chat = h.thread('project-chat', { projectId: id }), projectless = h.thread('projectless');
  await h.backend.observeResponse('local', 'thread/start', { thread: chat });
  await h.backend.observeResponse('local', 'thread/start', { thread: projectless });
  const memberships = createThreadProjects(h.globals, h.persist, () => {}, () => {}, h.backend);
  assert.equal(await memberships('getThreadStartProjectId', { projectKind: 'local', projectId: '/old' }), id);
  assert.equal(await memberships('getThreadStartProjectId', null), null);
  h.fail(method => method === 'thread/metadata/update' || method === 'thread/read' ? new Error('no rollout before first turn') : undefined);
  await memberships('setMembership', { threadId: 'project-chat', assignment: { projectKind: 'local', projectId: '/old' }, projectless: false });
  await memberships('setMembership', { threadId: 'projectless', assignment: null, projectless: true });
  assert.equal(h.calls.some(call => call.method === 'thread/metadata/update'), false);
  await memberships('updateProjectlessThread', { threadId: 'projectless', projectless: true, outputDirectory: '/cwd/projectless' });
  assert.deepEqual(h.saved['thread-projectless-output-directories'], { projectless: '/cwd/projectless' }, 'pending creation keeps its output intent before a rollout exists');
  await h.backend.observeBackend('local', { method: 'turn/completed', params: { threadId: 'projectless' } });
  await h.persist(); assert.equal(h.saved['thread-projectless-output-directories'], undefined);
});

test('projectless cwd is reconstructed as a memory projection and follows later backend cwd changes', async () => {
  const h = fixture({ 'projectless-thread-ids': ['chat'] }); const thread = h.thread('chat');
  await h.backend.ensureHost(); await h.backend.observeThreadList('local', { data: [thread] });
  assert.deepEqual(h.globals['thread-projectless-output-directories'], { chat: '/cwd/chat' });
  assert.equal(h.backend.persistenceGlobals()['thread-projectless-output-directories'], undefined);
  await h.backend.observeThreadList('local', { data: [{ ...thread, cwd: '/new/cwd' }] });
  assert.deepEqual(h.globals['thread-projectless-output-directories'], { chat: '/new/cwd' });
  assert.equal(h.backend.persistenceGlobals()['thread-projectless-output-directories'], undefined);
});

test('default pins read only connected hosts and distinguish pending legacy pins from native ordered pins', async () => {
  const h = fixture({ 'pinned-thread-ids': ['remote'] }, ['local', 'ssh']); h.activeHosts(['local']);
  h.thread('remote', { hostId: 'ssh' });
  assert.deepEqual(await h.backend.pins.list(), { threadIds: ['remote'], serverOrderedThreadIds: [] });
  assert.equal(h.calls.some(call => call.hostId === 'ssh'), false);
  assert.deepEqual(await h.backend.pins.list({ hostId: 'ssh' }), { threadIds: ['remote'], serverOrderedThreadIds: ['remote'] });
  const count = h.calls.filter(call => call.hostId === 'ssh').length;
  assert.deepEqual(await h.backend.pins.list(), { threadIds: ['remote'], serverOrderedThreadIds: ['remote'] });
  assert.equal(h.calls.filter(call => call.hostId === 'ssh').length, count);
});

test('two sections with the same name keep distinct native identities through retry', async () => {
  const h = fixture(); h.thread('a'); h.thread('b'); await h.backend.ensureHost();
  const wanted = [{ id: 'first', name: 'Same', appearance: null, threadIds: ['a'] }, { id: 'second', name: 'Same', appearance: null, threadIds: ['b'] }];
  const first = await h.backend.setSections('local', wanted);
  assert.notEqual(first.sectionIds.first, first.sectionIds.second);
  const second = await h.backend.setSections('local', wanted);
  assert.deepEqual(second.sectionIds, first.sectionIds); assert.equal(second.sections.length, 2);
});

test('cross-host project slots persist while each host manual order belongs to native projects', async () => {
  const h = fixture({ 'local-projects': { '/a': { name: 'A', rootPaths: ['/a'] }, '/c': { name: 'C', rootPaths: ['/c'] } },
    'remote-projects': [{ id: 'oldRemote', label: 'Remote', remotePath: '/remote', hostId: 'ssh' }],
    'project-order': ['/a', 'oldRemote', '/c'] }, ['local', 'ssh']);
  await h.backend.ensureHost('local'); await h.backend.ensureHost('ssh');
  const a = h.backend.resolveProjectId('local', '/a')!, c = h.backend.resolveProjectId('local', '/c')!, remote = h.backend.resolveProjectId('ssh', 'oldRemote')!;
  assert.deepEqual(h.globals['project-order'], [a, remote, c]);
  await h.backend.setGlobal('project-order', [c, remote, a]);
  assert.deepEqual(h.stores.get('local')!.projects.map(project => project.id), [c, a]);
  assert.deepEqual(h.globals['project-order'], [c, remote, a]);
  assert.deepEqual(h.backend.persistenceGlobals()['project-order'], [c, remote, a]);
  assert.equal(h.backend.persistenceGlobals()['local-projects'], undefined);
});

test('membership rollback preserves an intervening external backend assignment and later retry remains usable', async () => {
  const h = fixture(); h.stores.get('local')!.projects.push(project('a', '/a'), project('b', '/b'), project('external', '/external'));
  const thread = h.thread('chat', { projectId: 'a' }); await h.backend.ensureHost();
  let fail = true;
  const membership = createThreadProjects(h.globals, async () => {
    if (fail) { thread.projectId = 'external'; throw new Error('disk full'); } await h.persist();
  }, () => {}, () => {}, h.backend);
  await assert.rejects(membership('setMembership', { threadId: 'chat', assignment: { projectKind: 'local', projectId: 'b' }, projectless: true }), AggregateError);
  assert.equal(thread.projectId, 'external');
  assert.deepEqual(h.globals['thread-project-assignments'], { chat: { projectKind: 'local', projectId: 'external' } });
  fail = false;
  await membership('setMembership', { threadId: 'chat', assignment: { projectKind: 'local', projectId: 'b' }, projectless: true });
  assert.equal(thread.projectId, 'b');
});

test('client-owned cloud assignments remain editable and deleting one cannot resurrect its old migration value', async () => {
  const cloud = { projectKind: 'local', projectId: 'cloud-project', projectOrigin: 'chatgpt' };
  const h = fixture({ 'thread-project-assignments': { cloud: cloud } }); const thread = h.thread('cloud');
  h.stores.get('local')!.projects.push(project('native', '/native')); await h.backend.ensureHost();
  await h.backend.observeThreadList('local', { data: [thread] });
  assert.deepEqual(h.globals['thread-project-assignments'], { cloud });
  assert.deepEqual(h.saved['thread-project-assignments'], { cloud });
  await h.backend.setGlobal('thread-project-assignments', {}); assert.equal(h.saved['thread-project-assignments'], undefined);
  const memberships = createThreadProjects(h.globals, h.persist, () => {}, () => {}, h.backend);
  await memberships('setAssignment', { threadId: 'cloud', assignment: cloud });
  assert.deepEqual(h.saved['thread-project-assignments'], { cloud });
  await memberships('setAssignment', { threadId: 'cloud', assignment: null }); await h.backend.refreshHost();
  assert.equal(h.saved['thread-project-assignments'], undefined); assert.deepEqual(h.globals['thread-project-assignments'], {});
  await memberships('setAssignment', { threadId: 'cloud', assignment: cloud });
  await memberships('setAssignment', { threadId: 'cloud', assignment: { projectKind: 'local', projectId: 'native' } });
  await h.backend.refreshHost(); assert.equal(thread.projectId, 'native');
  assert.deepEqual(h.globals['thread-project-assignments'], { cloud: { projectKind: 'local', projectId: 'native' } });
  assert.equal(h.saved['thread-project-assignments'], undefined);
});

test('known old hosts retain editable legacy state without new RPCs and migrate its latest values after reconnecting with native support', async () => {
  const old = { id: 'old-project', hostId: 'old', label: 'Old project', remotePath: '/old' };
  const h = fixture({ 'local-projects': { '/local': { name: 'Local', rootPaths: ['/local'] } },
    'remote-projects': [old], 'thread-project-assignments': { oldChat: { projectKind: 'remote', projectId: old.id, hostId: 'old' } },
    'pinned-thread-ids': ['oldChat'] }, ['local', 'old'], ['local']);
  const oldChat = h.thread('oldChat', { hostId: 'old' }), nextChat = h.thread('nextChat', { hostId: 'old' });
  h.thread('unassignedPin', { hostId: 'old' });
  await h.backend.ensureHost('local'); await h.backend.ensureHost('old'); await h.backend.refreshHost('old');
  await h.backend.observeThreadList('old', { data: [{ id: 'oldChat', cwd: '/old' }] });
  assert.deepEqual(await h.backend.pins.list({ hostId: 'old' }), { threadIds: ['oldChat'], serverOrderedThreadIds: [] });
  assert.deepEqual(h.saved['remote-projects'], [old]);
  assert.deepEqual(h.saved['thread-project-assignments'], { oldChat: { projectKind: 'remote', projectId: old.id, hostId: 'old' } });
  assert.equal(h.calls.some(call => call.hostId === 'old'), false);
  const nextProject = { id: 'next-project', hostId: 'old', label: 'Next project', remotePath: '/next' };
  await h.backend.setGlobal('remote-projects', [{ ...old, label: 'Renamed old project' }, nextProject]);
  await h.backend.setGlobal('thread-project-assignments', { oldChat: { projectKind: 'remote', projectId: old.id, hostId: 'old' },
    nextChat: { projectKind: 'remote', projectId: nextProject.id } });
  assert.deepEqual((h.saved['thread-project-assignments'] as ObjectValue).nextChat,
    { projectKind: 'remote', projectId: nextProject.id, hostId: 'old' });
  await h.backend.setGlobal('project-appearances', { [nextProject.id]: { color: 'green' } });
  await h.backend.setGlobal('sidebar-project-thread-orders', { [nextProject.id]: { threadIds: ['nextChat'] } });
  await h.backend.setGlobal('pinned-project-ids', [nextProject.id]);
  const localId = h.backend.resolveProjectId('local', '/local')!;
  await h.backend.setGlobal('project-order', [nextProject.id, old.id, localId]);
  const memberships = createThreadProjects(h.globals, h.persist, () => {}, () => {}, h.backend);
  assert.equal(await memberships('getThreadStartProjectId', { projectKind: 'remote', projectId: nextProject.id }), null);
  await memberships('setMembership', { threadId: 'nextChat', assignment: { projectKind: 'remote', projectId: nextProject.id }, projectless: true });
  await memberships('setAssignment', { threadId: 'oldChat', hostId: 'old', assignment: null });
  await h.backend.pins.set({ threadId: 'oldChat', hostId: 'old', pinned: false });
  await h.backend.pins.set({ threadId: 'nextChat', hostId: 'old', pinned: true });
  await h.backend.pins.set({ threadId: 'unassignedPin', hostId: 'old', pinned: true });
  await h.backend.pins.setOrder({ hostId: 'old', threadIds: ['nextChat', 'unassignedPin'], movedThreadId: 'nextChat' });
  assert.deepEqual(h.saved['thread-project-assignments'], { nextChat: { projectKind: 'remote', projectId: nextProject.id, hostId: 'old' } });
  assert.deepEqual(h.saved['pinned-thread-ids'], ['nextChat', 'unassignedPin']);
  assert.deepEqual(h.saved['project-appearances'], { [nextProject.id]: { color: 'green' } });
  assert.equal(h.calls.some(call => call.hostId === 'old'), false, 'compatibility writes must not call the newer project or section protocols');
  h.supportedHost('old', true); await h.backend.ensureHost('old');
  const native = h.backend.resolveProjectId('old', nextProject.id)!;
  assert.equal(nextChat.projectId, native); assert.equal(oldChat.projectId, null);
  assert.equal(h.stores.get('old')!.projects.find(project => project.roots[0].path === '/old')!.name, 'Renamed old project');
  assert.deepEqual(JSON.parse(h.stores.get('old')!.projects.find(project => project.id === native)!.metadata[sidebarMetadata.appearance]), { color: 'green' });
  assert.deepEqual(await h.backend.pins.list({ hostId: 'old' }), { threadIds: ['nextChat', 'unassignedPin'], serverOrderedThreadIds: ['nextChat', 'unassignedPin'] });
  for (const key of ['remote-projects', 'thread-project-assignments', 'pinned-thread-ids', 'project-appearances', 'sidebar-project-thread-orders', 'pinned-project-ids']) assert.equal(h.saved[key], undefined, key);
  assert.deepEqual(h.saved['projectless-thread-ids'], ['nextChat']);
  await h.backend.ensureHost('old'); assert.equal(h.stores.get('old')!.projects.length, 2);
});

test('legacy compatibility assignment and pin persistence failures roll back and remain retryable', async () => {
  const original = { projectKind: 'remote', projectId: 'old-project', hostId: 'old' };
  const h = fixture({ 'remote-projects': [{ id: 'old-project', hostId: 'old', label: 'Old', remotePath: '/old' }],
    'thread-project-assignments': { chat: original }, 'pinned-thread-ids': ['chat'] }, ['local', 'old'], ['local']);
  await h.backend.ensureHost('local');
  const memberships = createThreadProjects(h.globals, h.persist, () => {}, () => {}, h.backend);
  h.diskFail(true);
  await assert.rejects(memberships('setMembership', { threadId: 'chat', hostId: 'old', assignment: null, projectless: true }), /disk full/);
  await assert.rejects(h.backend.pins.set({ threadId: 'newPin', hostId: 'old', pinned: true }), /disk full/);
  assert.deepEqual(h.backend.persistenceGlobals()['thread-project-assignments'], { chat: original });
  assert.deepEqual(h.backend.persistenceGlobals()['pinned-thread-ids'], ['chat']);
  assert.equal(h.backend.persistenceGlobals()['thread-project-membership-host-ids'], undefined);
  assert.equal(h.globals['projectless-thread-ids'], undefined);
  h.diskFail(false);
  await memberships('setAssignment', { threadId: 'chat', hostId: 'old', assignment: null });
  await h.backend.pins.set({ threadId: 'chat', hostId: 'old', pinned: false });
  assert.equal(h.saved['thread-project-assignments'], undefined); assert.equal(h.saved['pinned-thread-ids'], undefined);
  assert.equal(h.calls.some(call => call.hostId === 'old'), false);
});

test('an old local backend keeps renderer catalog, assignment, metadata and pin edits until native support becomes available', async () => {
  const h = fixture({}, ['local'], []); h.thread('chat'); h.thread('other');
  await h.backend.ensureHost();
  await h.backend.setGlobal('local-projects', { '/first': { name: 'First', rootPaths: ['/first'] }, '/second': { name: 'Second', rootPaths: ['/second'] } });
  await h.backend.setGlobal('thread-project-assignments', { chat: { projectKind: 'local', projectId: '/first' } });
  await h.backend.setGlobal('thread-project-assignments', {});
  await h.backend.refreshHost(); assert.deepEqual(h.globals['thread-project-assignments'], {});
  await h.backend.setGlobal('thread-project-assignments', { other: { projectKind: 'local', projectId: '/second' } });
  await h.backend.setGlobal('project-appearances', { '/second': { color: 'orange' } });
  await h.backend.setGlobal('project-order', ['/second', '/first']);
  await h.backend.setGlobal('pinned-thread-ids', ['other', 'chat']);
  assert.deepEqual(h.saved['project-order'], ['/second', '/first']);
  assert.deepEqual(h.saved['pinned-thread-ids'], ['other', 'chat']);
  assert.deepEqual(await h.backend.pins.list(), { threadIds: ['other', 'chat'], serverOrderedThreadIds: [] });
  assert.equal(h.calls.length, 0);
  h.supportedHost('local', true); await h.backend.ensureHost();
  const second = h.backend.resolveProjectId('local', '/second')!, first = h.backend.resolveProjectId('local', '/first')!;
  assert.deepEqual(h.globals['project-order'], [second, first]);
  assert.equal(h.stores.get('local')!.threads.get('other')!.projectId, second);
  assert.equal(h.stores.get('local')!.threads.get('chat')!.projectId, null);
  for (const key of ['local-projects', 'thread-project-assignments', 'project-appearances', 'project-order', 'pinned-thread-ids']) assert.equal(h.saved[key], undefined, key);
});
