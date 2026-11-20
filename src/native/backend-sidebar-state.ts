import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import type { ProjectAssignment } from './thread-projects.ts';
import { createThreadPins } from './thread-pins.ts';

// Codex CLI 0.164.0's built-in section, verified with an independent app-server.
export const PINNED_SECTION_ID = '01984de2-8f74-7c91-a3b2-5c5e937cf318';
export const sidebarMetadata = {
  legacyIds: 'yard.legacyProjectIds', appearance: 'yard.projectAppearance',
  threadOrder: 'yard.projectThreadOrder', pinned: 'yard.projectPinned',
} as const;

export interface SidebarProject {
  id: string; name: string; roots: { path: string }[]; metadata: Record<string, string>;
  position: number; createdAt: number; updatedAt: number; recencyAt?: number | null;
}
export interface SidebarSection { id: string; name: string; appearance: { icon: string | null; color: string | null } | null }
export interface SidebarSectionInput extends SidebarSection { threadIds: string[] }
interface SidebarThread { id: string; projectId: string | null; section: SidebarSection | null; cwd?: string }
interface HostState {
  ready: boolean; refreshing: boolean; projects: SidebarProject[]; sections: SidebarSection[];
  projectChangeVersion: number;
  members: Map<string, string[]>; threads: Map<string, SidebarThread>; aliases: Map<string, string>;
  started: Set<string>;
  sectionAliases: Map<string, string>; pending: Promise<unknown>;
}
export interface BackendSidebarOptions {
  globals: ObjectValue;
  persist(): Promise<void>;
  publish(message: unknown): void;
  request(hostId: string, method: string, params: ObjectValue, mutating?: boolean): Promise<unknown>;
  hostIds?(): string[];
  /** Registered hosts, including disconnected ones; enumeration never connects. */
  knownHostIds?(): string[];
  /** A connected backend's advertised protocol version, not a failed RPC fallback. */
  supportsHost?(hostId: string): boolean;
  isThreadVisible?(hostId: string, threadId: string): boolean;
  validHost?(hostId: string): void;
}
export interface SidebarPinsRequest { hostId?: string; signal?: AbortSignal }

const projectKeys = ['local-projects', 'remote-projects', 'project-order', 'project-appearances',
  'sidebar-project-thread-orders', 'pinned-project-ids'] as const;
const assignmentKey = 'thread-project-assignments', pinKey = 'pinned-thread-ids';
const membershipHostKey = 'thread-project-membership-host-ids';
function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((value): value is string => typeof value === 'string' && !!value))] : [];
}
function json(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}
function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function checkSignal(signal?: AbortSignal) { signal?.throwIfAborted(); }
function missingLegacyThreadRead(error: unknown, threadId: string) {
  const item = record(error), message = error instanceof Error ? error.message : String(item.message ?? error);
  // CLI 0.164's metadata-only read can read unloaded persistent threads. It
  // uses this exact error for an ID absent from both memory and stored history.
  // Apply that classification only to legacy read lookups, never write errors.
  return item.code === 'ENOENT' || item.code === -32600 && message === 'thread not loaded: ' + threadId ||
    /(?:thread|conversation|会话).{0,80}(?:not found|does not exist|不存在)|(?:not found|no such).{0,40}(?:thread|conversation)/i.test(message);
}
function assignmentHost(value: unknown, hosts: ObjectValue, remote: unknown[]): string {
  const item = record(value);
  if (typeof item.hostId === 'string') return item.hostId;
  if (item.projectKind === 'remote') {
    const project = remote.map(record).find(project => project.id === item.projectId);
    if (typeof project?.hostId === 'string') return project.hostId;
  }
  return 'local';
}

/** Backend-owned sidebar data, with globals used only as the renderer's projection.
 * persistenceGlobals() keeps unmigrated input until the backend and cleanup save
 * both succeed. No failed backend read is replaced with the old Yard snapshot.
 */
export function createBackendSidebarState(options: BackendSidebarOptions) {
  const { globals } = options;
  const legacy: ObjectValue = structuredClone(Object.fromEntries([...projectKeys, assignmentKey, pinKey, membershipHostKey]
    .filter(key => Object.hasOwn(globals, key)).map(key => [key, globals[key]])));
  const hosts = new Map<string, HostState>();
  const originalRemote = Array.isArray(legacy['remote-projects']) ? legacy['remote-projects'] as unknown[] : [];
  const originalAssignments = { ...record(legacy[assignmentKey]) };
  const originalHosts = { ...record(legacy[membershipHostKey]) };
  const projectOrderHosts = new Map<string, string>();
  for (const [id, value] of Object.entries(record(legacy['local-projects']))) if (record(value).projectOrigin !== 'chatgpt') projectOrderHosts.set(id, 'local');
  for (const value of originalRemote.map(record)) if (typeof value.id === 'string' && typeof value.hostId === 'string') projectOrderHosts.set(value.id, value.hostId);
  const knownThreadHosts = new Map<string, string>();
  const derivedOutputs = new Map<string, string>();
  const handledPins = new Map<string, Set<string>>(), missingPinHosts = new Map<string, Set<string>>();
  for (const [id, value] of Object.entries(originalHosts)) if (typeof value === 'string') knownThreadHosts.set(id, value);
  for (const [id, value] of Object.entries(originalAssignments)) knownThreadHosts.set(id, assignmentHost(value, originalHosts, originalRemote));

  function supportsHost(hostId: string) {
    options.validHost?.(hostId);
    return options.supportsHost?.(hostId) ?? true;
  }
  function clientAssignment(value: unknown) {
    return record(value).projectOrigin === 'chatgpt' || options.supportsHost?.(assignmentHost(value, originalHosts,
      Array.isArray(legacy['remote-projects']) ? legacy['remote-projects'] as unknown[] : originalRemote)) === false;
  }

  function state(hostId: string) {
    options.validHost?.(hostId);
    let value = hosts.get(hostId);
    if (!value) {
      value = { ready: false, refreshing: false, projectChangeVersion: 0, projects: [], sections: [], members: new Map(), threads: new Map(),
        aliases: new Map(), sectionAliases: new Map(), started: new Set(), pending: Promise.resolve() };
      hosts.set(hostId, value);
    }
    return value;
  }
  function enqueue<T>(hostId: string, action: () => Promise<T>): Promise<T> {
    const item = state(hostId), next = item.pending.catch(() => {}).then(action);
    item.pending = next;
    return next;
  }
  async function page<T>(hostId: string, method: string, params: ObjectValue): Promise<T[]> {
    const data: T[] = [], seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = record(await options.request(hostId, method, { ...params, limit: 100, ...(cursor ? { cursor } : {}) }));
      if (!Array.isArray(result.data)) throw new Error('后端未返回列表：' + method);
      data.push(...result.data as T[]);
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (cursor && seen.has(cursor)) throw new Error('后端返回重复分页游标：' + method);
      if (cursor) seen.add(cursor);
    } while (cursor);
    return data;
  }
  function remember(hostId: string, value: unknown) {
    const item = record(value);
    if (typeof item.id !== 'string') return;
    knownThreadHosts.set(item.id, hostId);
    const host = state(hostId), previous = host.threads.get(item.id);
    if (!Object.hasOwn(item, 'projectId') && !Object.hasOwn(item, 'section')) return;
    host.threads.set(item.id, { id: item.id, projectId: typeof item.projectId === 'string' ? item.projectId :
      Object.hasOwn(item, 'projectId') ? null : previous?.projectId ?? null,
    section: Object.hasOwn(item, 'section') ? (item.section as SidebarSection | null) ?? null : previous?.section ?? null,
    ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : previous?.cwd ? { cwd: previous.cwd } : {}) });
  }
  async function readThread(hostId: string, threadId: string) {
    const response = record(await options.request(hostId, 'thread/read', { threadId, includeTurns: false }));
    const thread = record(response.thread);
    if (typeof thread.id !== 'string' || !Object.hasOwn(thread, 'projectId') || !Object.hasOwn(thread, 'section')) {
      throw new Error('后端缺少会话项目或分组字段，请使用 Codex CLI 0.156.0 或兼容版本');
    }
    remember(hostId, thread);
    state(hostId).started.delete(threadId);
    return state(hostId).threads.get(threadId)!;
  }
  function aliases(hostId: string) {
    const host = state(hostId);
    host.aliases.clear();
    for (const project of host.projects) {
      host.aliases.set(project.id, project.id);
      projectOrderHosts.set(project.id, hostId);
      for (const id of strings(json(project.metadata[sidebarMetadata.legacyIds]))) {
        host.aliases.set(id, project.id); projectOrderHosts.set(id, hostId);
      }
    }
  }
  async function catalog(hostId: string) {
    const host = state(hostId);
    const projects = await page<SidebarProject>(hostId, 'project/list', { sortKey: 'position', sortDirection: 'asc' });
    const sections = await page<SidebarSection>(hostId, 'threadSection/list', {});
    if (projects.some(project => typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.roots) ||
      project.roots.some(root => typeof root.path !== 'string') || !project.metadata || Object.values(project.metadata).some(value => typeof value !== 'string')) ||
      sections.some(section => typeof section.id !== 'string' || typeof section.name !== 'string' || !Object.hasOwn(section, 'appearance'))) {
      throw new Error('后端项目或分组协议不兼容，请使用 Codex CLI 0.156.0 或兼容版本');
    }
    if (!sections.some(section => section.id === PINNED_SECTION_ID)) throw new Error('后端缺少内置 Pinned 分组');
    host.projects = projects;
    host.sections = sections;
    aliases(hostId);
  }
  async function sectionMembers(hostId: string) {
    const host = state(hostId), members = new Map<string, string[]>();
    for (const section of host.sections) {
      const threads = await page<SidebarThread>(hostId, 'thread/list', { sectionId: section.id,
        sortKey: 'section_position', sortDirection: 'asc', useStateDbOnly: true });
      members.set(section.id, threads.map(thread => thread.id));
      for (const thread of threads) { remember(hostId, thread); host.started.delete(thread.id); }
    }
    // A thread moved out of a section is absent from every section query.
    const allMembers = new Set([...members.values()].flat());
    for (const [id, thread] of host.threads) if (thread.section && !allMembers.has(id)) {
      host.threads.set(id, { ...thread, section: null });
    }
    host.members = members;
  }
  function backendAssignment(hostId: string, projectId: string | null): ProjectAssignment | null {
    return projectId === null ? null : hostId === 'local' ? { projectKind: 'local', projectId } :
      { projectKind: 'remote', projectId, hostId };
  }
  function projectRows(hostId: string): ObjectValue[] {
    if (hostId === 'local') return Object.entries(record(legacy['local-projects'])).map(([id, value]) => ({ id, ...record(value) }));
    return (Array.isArray(legacy['remote-projects']) ? legacy['remote-projects'] as unknown[] : []).map(record)
      .filter(value => value.hostId === hostId);
  }
  function projectRoots(value: ObjectValue): { path: string }[] {
    const roots = strings(value.rootPaths);
    return roots.length ? roots.map(path => ({ path })) : typeof value.remotePath === 'string' ? [{ path: value.remotePath }] : [];
  }
  async function patchMetadata(hostId: string, projectId: string, patch: Record<string, string | undefined>) {
    // Metadata update replaces the map. Read immediately before patching so
    // unrelated metadata written by another client survives our change.
    const { project } = record(await options.request(hostId, 'project/read', { projectId }));
    const metadata = { ...record(record(project).metadata) };
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete metadata[key]; else metadata[key] = value;
    await options.request(hostId, 'project/update', { projectId, metadata }, true);
    const current = state(hostId).projects.find(project => project.id === projectId);
    if (current) current.metadata = metadata as Record<string, string>;
  }
  async function migrateProjects(hostId: string) {
    const host = state(hostId), existingIds = host.projects.map(project => project.id), createdIds: string[] = [];
    const appearances = record(legacy['project-appearances']), orders = record(legacy['sidebar-project-thread-orders']);
    const pinned = strings(legacy['pinned-project-ids']);
    for (const old of projectRows(hostId)) {
      if (typeof old.id !== 'string' || old.projectOrigin === 'chatgpt') continue;
      const oldId = old.id;
      const roots = projectRoots(old);
      if (!roots.length) throw new Error('旧项目缺少根目录：' + old.id);
      let project = host.projects.find(project => project.id === host.aliases.get(oldId)) ??
        host.projects.find(project => equal(project.roots, roots));
      if (!project) {
        const response = record(await options.request(hostId, 'project/create', {
          name: String(old.name ?? old.label ?? old.id), roots,
          metadata: { [sidebarMetadata.legacyIds]: JSON.stringify([old.id]) },
          idempotencyKey: 'yard-project:' + hostId + ':' + old.id,
        }, true));
        project = response.project as SidebarProject;
        if (!project?.id) throw new Error('后端未返回新建项目');
        host.projects.push(project); createdIds.push(project.id);
      }
      const ids = strings(json(project.metadata[sidebarMetadata.legacyIds]));
      const patch: Record<string, string> = {};
      if (!ids.includes(old.id)) patch[sidebarMetadata.legacyIds] = JSON.stringify([...ids, old.id]);
      for (const [key, value] of [[sidebarMetadata.appearance, appearances[old.id]],
        [sidebarMetadata.threadOrder, orders[old.id]], [sidebarMetadata.pinned, pinned.includes(old.id) ? true : undefined]] as const) {
        if (value !== undefined && project.metadata[key] === undefined) patch[key] = JSON.stringify(value);
      }
      if (Object.keys(patch).length) await patchMetadata(hostId, project.id, patch);
      host.aliases.set(old.id, project.id);
    }
    // Existing backend positions win. Import-only projects retain the old
    // relative order, appended after all projects that were already present.
    const oldOrder = strings(legacy['project-order']);
    const imported = [...oldOrder.map(id => host.aliases.get(id)).filter((id): id is string => !!id && createdIds.includes(id)),
      ...createdIds.filter(id => !oldOrder.some(old => host.aliases.get(old) === id))];
    if (imported.length > 1) await moveProjectOrder(hostId, [...existingIds, ...imported]);
  }
  function pinHost(threadId: string) { return knownThreadHosts.get(threadId) ?? 'local'; }
  async function migrateMembershipsAndPins(hostId: string) {
    const host = state(hostId);
    const assignments = record(legacy[assignmentKey]);
    for (const [threadId, value] of Object.entries(assignments)) {
      const old = record(value);
      if (old.projectOrigin === 'chatgpt' || assignmentHost(old, originalHosts, originalRemote) !== hostId) continue;
      let thread: SidebarThread;
      try { thread = await readThread(hostId, threadId); }
      catch (error) { if (missingLegacyThreadRead(error, threadId)) continue; throw error; }
      const projectId = typeof old.projectId === 'string' ? host.aliases.get(old.projectId) : undefined;
      // A stale reference must not recreate a deleted project. Existing native
      // assignments still win even if their legacy project no longer exists.
      if (!projectId) continue;
      if (thread.projectId === null) {
        await options.request(hostId, 'thread/metadata/update', { threadId, projectId }, true);
        remember(hostId, { ...thread, projectId });
      }
    }
    const handled = handledPins.get(hostId) ?? new Set<string>();
    handledPins.set(hostId, handled);
    for (const threadId of strings(legacy[pinKey]).filter(id => !knownThreadHosts.has(id) || pinHost(id) === hostId)) {
      let thread: SidebarThread;
      try { thread = await readThread(hostId, threadId); }
      catch (error) {
        if (!missingLegacyThreadRead(error, threadId)) throw error;
        const missing = missingPinHosts.get(threadId) ?? new Set<string>();
        missing.add(hostId); missingPinHosts.set(threadId, missing);
        if (knownThreadHosts.has(threadId) || (options.knownHostIds?.() ?? options.hostIds?.() ?? ['local']).every(id => missing.has(id))) handled.add(threadId);
        continue;
      }
      // An existing backend section (including custom ones) takes precedence.
      if (thread.section === null) await options.request(hostId, 'thread/section/move', { threadId, sectionId: PINNED_SECTION_ID }, true);
      handled.add(threadId);
    }
  }
  function cleanupLegacy(hostId: string) {
    const host = state(hostId), ids = new Set<string>();
    for (const [id, backendId] of host.aliases) { ids.add(id); ids.add(backendId); }
    if (hostId === 'local') legacy['local-projects'] = Object.fromEntries(Object.entries(record(legacy['local-projects']))
      .filter(([id, item]) => !ids.has(id) || record(item).projectOrigin === 'chatgpt'));
    else legacy['remote-projects'] = (Array.isArray(legacy['remote-projects']) ? legacy['remote-projects'] as unknown[] : [])
      .filter(item => record(item).hostId !== hostId);
    for (const key of ['project-appearances', 'sidebar-project-thread-orders'] as const) legacy[key] =
      Object.fromEntries(Object.entries(record(legacy[key])).filter(([id]) => !ids.has(id)));
    legacy['pinned-project-ids'] = strings(legacy['pinned-project-ids']).filter(id => !ids.has(id));
    legacy[assignmentKey] = Object.fromEntries(Object.entries(record(legacy[assignmentKey])).filter(([, value]) =>
      record(value).projectOrigin === 'chatgpt' || assignmentHost(value, originalHosts, originalRemote) !== hostId));
    legacy[pinKey] = strings(legacy[pinKey]).filter(id => !handledPins.get(hostId)?.has(id));
    legacy[membershipHostKey] = Object.fromEntries(Object.entries(record(legacy[membershipHostKey])).filter(([, value]) => value !== hostId));
  }
  function projection() {
    const local = { ...record(legacy['local-projects']) };
    const remote = Array.isArray(legacy['remote-projects']) ? [...legacy['remote-projects'] as unknown[]] : [];
    const assignments = { ...record(legacy[assignmentKey]) }, threadHosts = { ...record(legacy[membershipHostKey]) };
    const appearances = { ...record(legacy['project-appearances']) }, orders = { ...record(legacy['sidebar-project-thread-orders']) };
    const pinnedProjects = strings(legacy['pinned-project-ids']), pins = strings(legacy[pinKey]);
    const allProjects: string[] = [];
    const outputs = { ...record(globals['thread-projectless-output-directories']) };
    const projectless = new Set(strings(globals['projectless-thread-ids']));
    const mappings: ObjectValue = {};
    for (const [hostId, host] of hosts) {
      if (!host.ready) continue;
      mappings[hostId] = Object.fromEntries(host.aliases);
      for (const project of host.projects) {
        const roots = project.roots.map(root => root.path);
        if (hostId === 'local') local[project.id] = { id: project.id, name: project.name, rootPaths: roots,
          createdAt: project.createdAt * 1000, updatedAt: project.updatedAt * 1000 };
        else remote.push({ id: project.id, hostId, label: project.name, remotePath: roots[0] ?? '', rootPaths: roots });
        allProjects.push(project.id);
        const appearance = json(project.metadata[sidebarMetadata.appearance]);
        if (appearance !== undefined) appearances[project.id] = appearance;
        const order = json(project.metadata[sidebarMetadata.threadOrder]);
        if (order !== undefined) orders[project.id] = order;
        if (json(project.metadata[sidebarMetadata.pinned]) === true) pinnedProjects.push(project.id);
      }
      for (const [threadId, thread] of host.threads) {
        if (options.isThreadVisible?.(hostId, threadId) === false) continue;
        const item = backendAssignment(hostId, thread.projectId);
        if (item) assignments[threadId] = item; else delete assignments[threadId];
        threadHosts[threadId] = hostId;
        if (projectless.has(threadId) && thread.cwd && (outputs[threadId] === undefined || outputs[threadId] === derivedOutputs.get(threadId))) {
          outputs[threadId] = thread.cwd; derivedOutputs.set(threadId, thread.cwd);
        }
      }
      pins.push(...host.members.get(PINNED_SECTION_ID) ?? []);
    }
    // Cloud project membership has its own client contract. Its saved value
    // survives loading the same conversation from the local backend.
    Object.assign(assignments, Object.fromEntries(Object.entries(record(legacy[assignmentKey]))
      .filter(([, value]) => record(value).projectOrigin === 'chatgpt')));
    // Keep cross-host slots, but consume each host's projects in its canonical
    // backend order. Reordering within one host never reorders another host.
    const remaining = new Map([...hosts].filter(([, host]) => host.ready).map(([hostId, host]) => [hostId, host.projects.map(project => project.id)]));
    const unmigratedIds = new Set([...Object.keys(record(legacy['local-projects'])),
      ...(Array.isArray(legacy['remote-projects']) ? legacy['remote-projects'] as unknown[] : []).map(value => record(value).id)]);
    const composite: string[] = [];
    for (const oldId of strings(legacy['project-order'])) {
      const owner = projectOrderHosts.get(oldId);
      const id = owner ? remaining.has(owner) ? remaining.get(owner)?.shift() : unmigratedIds.has(oldId) ? oldId : undefined : oldId;
      if (id && !composite.includes(id)) composite.push(id);
    }
    for (const id of allProjects) if (!composite.includes(id)) composite.push(id);
    const values: ObjectValue = { 'local-projects': local, 'remote-projects': remote, [assignmentKey]: assignments,
      [membershipHostKey]: threadHosts, [pinKey]: strings(pins), 'project-appearances': appearances,
      ...(Object.keys(outputs).length ? { 'thread-projectless-output-directories': outputs } : {}),
      'sidebar-project-thread-orders': orders, 'pinned-project-ids': strings(pinnedProjects),
      'app-server-project-id-by-legacy-project-id-by-host': mappings, 'project-order': composite };
    const changed = Object.keys(values).filter(key => !equal(values[key], globals[key]));
    const beforeAssignments = record(globals[assignmentKey]);
    Object.assign(globals, values);
    if (changed.length) options.publish({ type: 'global-state-updated', keys: changed });
    if (changed.includes(pinKey)) options.publish({ type: 'pinned-threads-updated' });
    if (changed.includes(assignmentKey)) {
      const memberships: ObjectValue = {};
      for (const id of new Set([...Object.keys(beforeAssignments), ...Object.keys(assignments)])) if (!equal(beforeAssignments[id], assignments[id])) {
        memberships[id] = { assignment: assignments[id] ?? null, projectless: strings(globals['projectless-thread-ids']).includes(id) };
      }
      options.publish({ type: 'thread-project-memberships-updated', memberships });
    }
  }
  async function initialize(hostId: string) {
    const host = state(hostId);
    if (!supportsHost(hostId)) return;
    if (host.ready) return;
    host.refreshing = true;
    const previous = structuredClone(legacy);
    try {
      await catalog(hostId);
      await migrateProjects(hostId);
      await migrateMembershipsAndPins(hostId);
      const version = host.projectChangeVersion;
      await catalog(hostId);
      await sectionMembers(hostId);
      cleanupLegacy(hostId);
      host.ready = true;
      // Persist only the contraction of the old store, using persistenceGlobals.
      // If the disk write fails, retry sees backend values and preserves them.
      await options.persist();
      if (host.projectChangeVersion !== version) await refresh(hostId); else projection();
    } catch (error) {
      for (const key of Object.keys(legacy)) delete legacy[key];
      Object.assign(legacy, previous);
      host.ready = false;
      throw error;
    } finally { host.refreshing = false; }
  }
  function ensureHost(hostId = 'local') { return enqueue(hostId, () => initialize(hostId)); }
  async function refresh(hostId: string) {
    if (!supportsHost(hostId)) return;
    const host = state(hostId);
    host.refreshing = true;
    try {
      let version: number;
      do {
        version = host.projectChangeVersion;
        await catalog(hostId);
        const ids = new Set(host.projects.map(project => project.id));
        for (const thread of [...host.threads.values()]) if (thread.projectId && !ids.has(thread.projectId)) await readThread(hostId, thread.id);
        await sectionMembers(hostId);
        // A project notification can arrive after project/list captured its
        // snapshot. Keep that invalidation and read again before publishing.
      } while (version !== host.projectChangeVersion);
      projection();
    }
    finally { host.refreshing = false; }
  }
  function refreshHost(hostId = 'local') { return enqueue(hostId, async () => { await initialize(hostId); await refresh(hostId); }); }
  async function moveProjectOrder(hostId: string, ids: string[]) {
    let beforeProjectId: string | null = null;
    for (const projectId of [...ids].reverse()) {
      await options.request(hostId, 'project/move', { projectId, beforeProjectId }, true);
      beforeProjectId = projectId;
    }
  }
  function resolveProjectId(hostId: string, projectId: string) {
    return state(hostId).aliases.get(projectId) ?? (state(hostId).projects.some(project => project.id === projectId) ? projectId : undefined);
  }
  async function getAssignment(threadId: string, hostId = 'local') {
    if (!supportsHost(hostId)) return (record(legacy[assignmentKey])[threadId] as ProjectAssignment | undefined) ?? null;
    await ensureHost(hostId);
    const host = state(hostId), thread = host.started.has(threadId) ? host.threads.get(threadId)! : await readThread(hostId, threadId);
    projection();
    return backendAssignment(hostId, thread.projectId);
  }
  async function setAssignment(threadId: string, hostId: string, assignment: ProjectAssignment | null) {
    if (!supportsHost(hostId)) {
      const assignments = { ...record(legacy[assignmentKey]) };
      if (assignment === null) delete assignments[threadId]; else assignments[threadId] = assignment;
      await saveClientValue(assignmentKey, assignments); return assignment;
    }
    await ensureHost(hostId);
    return enqueue(hostId, async () => {
      if (assignment?.projectKind === 'local' && (hostId !== 'local' || assignment.projectOrigin === 'chatgpt') ||
          assignment?.projectKind === 'remote' && (hostId === 'local' || assignment.hostId && assignment.hostId !== hostId)) {
        throw new Error('项目与会话执行主机不一致');
      }
      const projectId = assignment === null ? '' : resolveProjectId(hostId, assignment.projectId);
      if (projectId === undefined) throw new Error('项目不存在：' + assignment?.projectId);
      const host = state(hostId), current = host.started.has(threadId) ? host.threads.get(threadId)! : await readThread(hostId, threadId);
      // thread/start.projectId already owns the assignment before a rollout
      // exists. Rewriting metadata at that point is rejected by CLI 0.164.0.
      if (current.projectId === (projectId || null)) {
        projection(); return backendAssignment(hostId, current.projectId);
      }
      await options.request(hostId, 'thread/metadata/update', { threadId, projectId }, true);
      // Acknowledge from the backend before changing the UI projection.
      await readThread(hostId, threadId);
      projection();
      return backendAssignment(hostId, state(hostId).threads.get(threadId)!.projectId);
    });
  }
  async function restoreAssignment(threadId: string, hostId: string, previous: ProjectAssignment | null, expected: ProjectAssignment | null) {
    const current = await getAssignment(threadId, hostId);
    if (!equal(current, expected)) throw new Error('会话归属已被其他客户端修改，已保留后端当前值');
    return setAssignment(threadId, hostId, previous);
  }
  function persistenceGlobals() {
    const result: ObjectValue = { ...globals };
    for (const key of [...projectKeys, assignmentKey, pinKey, membershipHostKey]) {
      const value = legacy[key];
      if (value === undefined || Array.isArray(value) && !value.length || value && typeof value === 'object' && !Object.keys(value).length) delete result[key];
      else result[key] = structuredClone(value);
    }
    // ID maps are derived from backend metadata; the initial migration inputs
    // remain above until they are durably contracted.
    for (const key of ['app-server-project-id-by-legacy-project-id-by-host', 'app-server-projects-migration-by-host',
      'app-server-migrated-pinned-thread-ids-by-host']) delete result[key];
    // A known thread's cwd is supplied by thread/read/list. Pending creation
    // hints and explicit projectless output intentions remain client-owned.
    for (const key of ['thread-workspace-root-hints', 'thread-projectless-output-directories']) {
      const entries = Object.entries(record(result[key])).filter(([threadId, value]) => {
        const hostId = knownThreadHosts.get(threadId), thread = hostId ? hosts.get(hostId)?.threads.get(threadId) : undefined;
        if (hostId && hosts.get(hostId)?.started.has(threadId)) return true;
        return value !== derivedOutputs.get(threadId) && (!thread?.cwd || value !== thread.cwd);
      });
      if (entries.length) result[key] = Object.fromEntries(entries); else delete result[key];
    }
    // Only cross-host / cloud project mixing has an independent local order.
    const oldOrder = strings(legacy['project-order']);
    const orderHosts = new Set(oldOrder.map(id => projectOrderHosts.get(id) ?? 'client'));
    if (orderHosts.size <= 1 && !orderHosts.has('client') && [...orderHosts].every(hostId => supportsHost(hostId) && hosts.get(hostId)?.ready)) delete result['project-order'];
    return result;
  }
  async function observeResponse(hostId: string, method: string, value: unknown) {
    if (!method.startsWith('thread/')) return;
    const response = record(value);
    const host = state(hostId);
    if (Array.isArray(response.data)) for (const thread of response.data) {
      remember(hostId, thread);
      if (method === 'thread/list' && typeof record(thread).id === 'string') host.started.delete(String(record(thread).id));
    }
    if (response.thread) {
      remember(hostId, response.thread);
      const id = record(response.thread).id;
      if (typeof id === 'string') {
        if (method === 'thread/start') host.started.add(id);
        else host.started.delete(id);
      }
    }
    if (state(hostId).ready) projection();
  }
  async function observeBackend(hostId: string, message: { method?: string; params?: unknown }) {
    if (message.method === 'thread/project/updated') {
      const params = record(message.params);
      if (typeof params.threadId === 'string') {
        const host = state(hostId), old = host.threads.get(params.threadId);
        remember(hostId, { ...old, id: params.threadId, projectId: params.projectId ?? null });
        if (host.ready) projection();
      }
    } else if (message.method === 'project/changed') {
      const host = state(hostId);
      host.projectChangeVersion++;
      if (host.ready && !host.refreshing) await refreshHost(hostId);
    } else if (message.method === 'thread/started') {
      const thread = record(message.params).thread;
      remember(hostId, thread);
      if (typeof record(thread).id === 'string') state(hostId).started.add(String(record(thread).id));
      if (state(hostId).ready) projection();
    } else if (message.method === 'turn/started' || message.method === 'turn/completed') {
      const id = record(message.params).threadId;
      if (typeof id === 'string') state(hostId).started.delete(id);
    }
  }
  async function request(hostId: string, method: string, params: ObjectValue = {}) {
    if (!supportsHost(hostId)) throw new Error('当前主机不支持原生项目和会话分组');
    await ensureHost(hostId);
    return enqueue(hostId, async () => {
      const mutating = !method.endsWith('/list') && !method.endsWith('/read');
      const result = await options.request(hostId, method, params, mutating);
      if (method.startsWith('project/') || method.startsWith('threadSection/') || method === 'thread/section/move') {
        await refresh(hostId);
        if (method === 'thread/section/move' && typeof params.threadId === 'string') await readThread(hostId, params.threadId);
      }
      await observeResponse(hostId, method, result);
      return result;
    });
  }
  async function sectionSnapshot(hostId = 'local') {
    if (!supportsHost(hostId)) throw new Error('当前主机不支持原生会话分组');
    await refreshHost(hostId);
    return cachedSectionSnapshot(hostId);
  }
  function cachedSectionSnapshot(hostId = 'local') {
    const host = state(hostId);
    return { sections: host.sections.filter(section => section.id !== PINNED_SECTION_ID).map(section => ({ ...section,
      threadIds: [...host.members.get(section.id) ?? []] })), pinnedThreadIds: [...host.members.get(PINNED_SECTION_ID) ?? []] };
  }
  async function setSections(hostId: string, desired: SidebarSectionInput[], settings: { mode?: 'merge' | 'replace'; deleteSectionIds?: string[] } = {}) {
    if (!supportsHost(hostId)) throw new Error('当前主机不支持原生会话分组');
    if (!Array.isArray(desired) || desired.some(section => !section.id || !section.name?.trim() || !Array.isArray(section.threadIds) ||
      section.threadIds.some(id => typeof id !== 'string' || !id) || strings(section.threadIds).length !== section.threadIds.length) ||
      new Set(desired.map(section => section.id)).size !== desired.length) throw new Error('无效的会话分组');
    if (settings.deleteSectionIds !== undefined && (!Array.isArray(settings.deleteSectionIds) || settings.deleteSectionIds.some(id => typeof id !== 'string'))) {
      throw new Error('无效的待删除会话分组');
    }
    await ensureHost(hostId);
    return enqueue(hostId, async () => {
      await refresh(hostId);
      const host = state(hostId), replace = settings.mode === 'replace', mappings: Record<string, string> = {};
      const claimed = new Set<string>();
      for (const wanted of desired) {
        if (wanted.id === PINNED_SECTION_ID) throw new Error('请通过置顶接口编辑 Pinned 分组');
        let section = host.sections.find(section => section.id === (host.sectionAliases.get(wanted.id) ?? wanted.id));
        // create has no idempotency key. Recover a lost create response by
        // matching the existing destination before attempting another create.
        section ??= host.sections.find(section => section.id !== PINNED_SECTION_ID && !claimed.has(section.id) && section.name === wanted.name && equal(section.appearance, wanted.appearance));
        if (!section) {
          const result = record(await options.request(hostId, 'threadSection/create', { name: wanted.name, appearance: wanted.appearance }, true));
          section = result.section as SidebarSection;
          if (!section?.id) throw new Error('后端未返回新建分组');
          host.sections.push(section); host.members.set(section.id, []);
        } else if (replace && (section.name !== wanted.name || !equal(section.appearance, wanted.appearance))) {
          await options.request(hostId, 'threadSection/update', { sectionId: section.id, name: wanted.name, appearance: wanted.appearance }, true);
        }
        host.sectionAliases.set(wanted.id, section.id); mappings[wanted.id] = section.id; claimed.add(section.id);
        const current = host.members.get(section.id) ?? [];
        if (replace) {
          for (const threadId of current.filter(id => !wanted.threadIds.includes(id))) {
            if ((await readThread(hostId, threadId)).section?.id === section.id) {
              await options.request(hostId, 'thread/section/move', { threadId, sectionId: null }, true);
            }
          }
          let beforeThreadId: string | null = null;
          for (const threadId of [...strings(wanted.threadIds)].reverse()) {
            await options.request(hostId, 'thread/section/move', { threadId, sectionId: section.id, beforeThreadId }, true);
            beforeThreadId = threadId;
          }
        } else for (const threadId of strings(wanted.threadIds)) {
          const thread = await readThread(hostId, threadId);
          if (thread.section === null) await options.request(hostId, 'thread/section/move', { threadId, sectionId: section.id }, true);
        }
      }
      if (replace) for (const section of host.sections) if (section.id !== PINNED_SECTION_ID && !Object.values(mappings).includes(section.id) &&
        (settings.deleteSectionIds === undefined || settings.deleteSectionIds.some(id => (host.sectionAliases.get(id) ?? id) === section.id))) {
        await options.request(hostId, 'threadSection/delete', { sectionId: section.id }, true);
      }
      await refresh(hostId);
      return { sectionIds: mappings, sections: host.sections.filter(section => section.id !== PINNED_SECTION_ID)
        .map(section => ({ ...section, threadIds: [...host.members.get(section.id) ?? []] })) };
    });
  }
  const legacyPins = createThreadPins(legacy, async () => { await options.persist(); projection(); }, options.publish);
  const pins = {
    async list(value: SidebarPinsRequest = {}) {
      checkSignal(value.signal);
      if (value.hostId && !supportsHost(value.hostId)) return { threadIds: strings(legacy[pinKey])
        .filter(id => knownThreadHosts.get(id) === value.hostId), serverOrderedThreadIds: [] as string[] };
      const ids = value.hostId ? [value.hostId] : options.hostIds?.() ?? ['local'];
      for (const hostId of ids) { checkSignal(value.signal); await refreshHost(hostId); }
      const confirmed = value.hostId ? [...state(value.hostId).members.get(PINNED_SECTION_ID) ?? []] :
        strings([...hosts.values()].filter(host => host.ready).flatMap(host => host.members.get(PINNED_SECTION_ID) ?? []));
      return { threadIds: value.hostId ? confirmed : strings([...strings(legacy[pinKey]), ...confirmed]), serverOrderedThreadIds: confirmed };
    },
    async set(value: unknown, signalOverride?: AbortSignal): Promise<{ success: boolean }> {
      const params = record(value), { threadId, pinned, beforeThreadId } = params;
      if (typeof threadId !== 'string' || !threadId || typeof pinned !== 'boolean' ||
        beforeThreadId != null && (typeof beforeThreadId !== 'string' || !beforeThreadId)) throw new Error('无效的对话固定参数');
      const hostId = typeof params.hostId === 'string' ? params.hostId : pinHost(threadId), signal = signalOverride ?? params.signal as AbortSignal | undefined;
      checkSignal(signal); await ensureHost(hostId);
      return enqueue(hostId, async () => {
        checkSignal(signal);
        if (!supportsHost(hostId)) {
          const previous = legacy[membershipHostKey], previousHost = knownThreadHosts.get(threadId);
          const owners = { ...record(previous), [threadId]: hostId };
          legacy[membershipHostKey] = owners; knownThreadHosts.set(threadId, hostId);
          try { return await legacyPins.set(value); }
          catch (error) {
            if (legacy[membershipHostKey] === owners) { if (previous === undefined) delete legacy[membershipHostKey]; else legacy[membershipHostKey] = previous; }
            if (previousHost === undefined) knownThreadHosts.delete(threadId); else knownThreadHosts.set(threadId, previousHost);
            throw error;
          }
        }
        const current = await readThread(hostId, threadId);
        if (pinned) {
          const ids = (await page<SidebarThread>(hostId, 'thread/list', { sectionId: PINNED_SECTION_ID,
            sortKey: 'section_position', sortDirection: 'asc', useStateDbOnly: true })).map(thread => thread.id);
          if (beforeThreadId === threadId && current.section?.id === PINNED_SECTION_ID) return { success: true };
          const before = typeof beforeThreadId === 'string' ? beforeThreadId : beforeThreadId === null ? null : ids.find(id => id !== threadId) ?? null;
          await options.request(hostId, 'thread/section/move', { threadId, sectionId: PINNED_SECTION_ID, beforeThreadId: before }, true);
        } else if (current.section?.id === PINNED_SECTION_ID) {
          await options.request(hostId, 'thread/section/move', { threadId, sectionId: null }, true);
        }
        await refresh(hostId); return { success: true };
      });
    },
    async setOrder(value: unknown): Promise<{ success: boolean }> {
      const params = record(value), { threadIds, movedThreadId } = params;
      if (!Array.isArray(threadIds) || threadIds.some(id => typeof id !== 'string' || !id) || new Set(threadIds).size !== threadIds.length) throw new Error('无效的固定对话顺序');
      const hostId = typeof params.hostId === 'string' ? params.hostId : typeof movedThreadId === 'string' ? pinHost(movedThreadId) : 'local';
      const signal = params.signal as AbortSignal | undefined;
      checkSignal(signal); await ensureHost(hostId);
      return enqueue(hostId, async () => {
        checkSignal(signal);
        if (!supportsHost(hostId)) return legacyPins.setOrder(value);
        const ids = (await page<SidebarThread>(hostId, 'thread/list', { sectionId: PINNED_SECTION_ID,
          sortKey: 'section_position', sortDirection: 'asc', useStateDbOnly: true })).map(thread => thread.id);
        if (movedThreadId != null && !ids.includes(String(movedThreadId))) return { success: false };
        const order = [...strings(threadIds).filter(id => ids.includes(id)), ...ids.filter(id => !threadIds.includes(id))];
        let beforeThreadId: string | null = null;
        for (const threadId of [...order].reverse()) {
          checkSignal(signal);
          await options.request(hostId, 'thread/section/move', { threadId, sectionId: PINNED_SECTION_ID, beforeThreadId }, true);
          beforeThreadId = threadId;
        }
        await refresh(hostId); return { success: true };
      });
    },
  };

  async function setProjectMetadata(hostId: string, projectId: string, values: { appearance?: unknown; threadOrder?: unknown; pinned?: boolean }) {
    if (!supportsHost(hostId)) throw new Error('当前主机不支持原生项目元数据');
    await ensureHost(hostId);
    return enqueue(hostId, async () => {
      const id = resolveProjectId(hostId, projectId);
      if (!id) throw new Error('项目不存在：' + projectId);
      const patch: Record<string, string | undefined> = {};
      for (const [field, key] of [['appearance', sidebarMetadata.appearance], ['threadOrder', sidebarMetadata.threadOrder], ['pinned', sidebarMetadata.pinned]] as const) {
        if (Object.hasOwn(values, field)) patch[key] = values[field] === undefined ? undefined : JSON.stringify(values[field]);
      }
      await patchMetadata(hostId, id, patch); await refresh(hostId);
    });
  }
  async function setProjectOrder(hostId: string, projectIds: string[]) {
    if (!supportsHost(hostId)) throw new Error('当前主机不支持原生项目排序');
    await ensureHost(hostId);
    return enqueue(hostId, async () => {
      await catalog(hostId);
      const host = state(hostId), ids = strings(projectIds).map(id => resolveProjectId(hostId, id));
      if (ids.some(id => !id)) throw new Error('项目顺序包含未知项目');
      // Undo can supply both the old renderer ID and the restored native ID.
      // Collapse aliases after resolution so a project never moves before itself.
      const order = strings([...ids as string[], ...host.projects.map(project => project.id).filter(id => !ids.includes(id))]);
      await moveProjectOrder(hostId, order); await refresh(hostId);
    });
  }
  async function projectThreadIds(hostId: string, projectId: string) {
    if (!supportsHost(hostId)) return Object.entries(record(legacy[assignmentKey])).flatMap(([threadId, value]) =>
      assignmentHost(value, originalHosts, originalRemote) === hostId && record(value).projectId === projectId ? [threadId] : []);
    await ensureHost(hostId);
    const id = resolveProjectId(hostId, projectId);
    if (!id) throw new Error('项目不存在：' + projectId);
    const threads = (await Promise.all([false, true].map(archived =>
      page<SidebarThread>(hostId, 'thread/list', { projectId: id, archived, useStateDbOnly: true })))).flat();
    for (const thread of threads) remember(hostId, thread);
    projection(); return threads.map(thread => thread.id);
  }
  function ownsGlobal(key: string) { return [...projectKeys, assignmentKey, pinKey].includes(key as typeof projectKeys[number]); }
  function hostForProject(projectId: string) {
    return [...hosts].find(([, host]) => host.aliases.has(projectId))?.[0] ??
      projectOrderHosts.get(projectId) ?? (Array.isArray(legacy['remote-projects']) ? legacy['remote-projects'] as unknown[] : originalRemote)
        .map(record).find(project => project.id === projectId)?.hostId as string | undefined;
  }
  async function saveClientValue(key: string, value: unknown) {
    const previous = legacy[key];
    legacy[key] = value;
    try { await options.persist(); }
    catch (error) {
      if (previous === undefined) delete legacy[key]; else legacy[key] = previous;
      projection(); throw error;
    }
    projection();
  }
  async function setProjectCatalog(hostId: string, desired: ObjectValue[]) {
    // Validate the entire request before its first backend mutation.
    for (const project of desired) if (typeof project.id !== 'string' || !project.id || !projectRoots(project).length) throw new Error('无效的项目目录');
    if (!supportsHost(hostId)) {
      for (const project of desired) projectOrderHosts.set(String(project.id), hostId);
      if (hostId === 'local') await saveClientValue('local-projects', Object.fromEntries(desired.map(project => [String(project.id), project])));
      else await saveClientValue('remote-projects', [...(Array.isArray(legacy['remote-projects']) ? legacy['remote-projects'] as unknown[] : [])
        .filter(project => record(project).hostId !== hostId), ...desired]);
      return;
    }
    await ensureHost(hostId);
    return enqueue(hostId, async () => {
      const host = state(hostId);
      await catalog(hostId);
      const keep = new Set<string>();
      try {
        for (const wanted of desired) {
          const legacyId = String(wanted.id), roots = projectRoots(wanted);
          // Catalog edits address project identities. Equal roots can belong
          // to distinct projects, including a project restored through Undo.
          // Root matching belongs only to the one-time legacy migration.
          let project = host.projects.find(project => project.id === resolveProjectId(hostId, legacyId));
          if (!project) {
            const response = record(await options.request(hostId, 'project/create', { name: String(wanted.name ?? wanted.label ?? legacyId), roots,
              metadata: { [sidebarMetadata.legacyIds]: JSON.stringify([legacyId]) }, idempotencyKey: 'yard-project:' + hostId + ':' + legacyId }, true));
            project = response.project as SidebarProject;
            if (!project?.id) throw new Error('后端未返回新建项目');
            host.projects.push(project);
          } else {
            const name = typeof wanted.name === 'string' ? wanted.name : typeof wanted.label === 'string' ? wanted.label : project.name;
            if (name !== project.name || !equal(roots, project.roots)) await options.request(hostId, 'project/update', { projectId: project.id, name, roots }, true);
            if (legacyId !== project.id && !strings(json(project.metadata[sidebarMetadata.legacyIds])).includes(legacyId)) {
              await patchMetadata(hostId, project.id, { [sidebarMetadata.legacyIds]: JSON.stringify([...strings(json(project.metadata[sidebarMetadata.legacyIds])), legacyId]) });
            }
          }
          host.aliases.set(legacyId, project.id); keep.add(project.id);
        }
        for (const project of host.projects.filter(project => !keep.has(project.id))) await options.request(hostId, 'project/delete', { projectId: project.id }, true);
      } catch (error) {
        // Confirmed mutations remain backend facts. Refresh what the backend
        // accepted, then report the failed operation without replaying it.
        try { await refresh(hostId); } catch { /* Preserve the original error. */ }
        throw error;
      }
      await refresh(hostId);
    });
  }
  async function setGlobal(key: string, value: unknown) {
    if (!ownsGlobal(key)) throw new Error('此全局状态不属于后端侧栏：' + key);
    if (key === 'local-projects') {
      const entries = Object.entries(record(value));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要本机项目表');
      const client = Object.fromEntries(entries.filter(([, value]) => record(value).projectOrigin === 'chatgpt'));
      if (!supportsHost('local')) {
        for (const [id, value] of entries) {
          if (record(value).projectOrigin !== 'chatgpt' && !projectRoots(record(value)).length) throw new Error('无效的项目目录');
          projectOrderHosts.set(id, 'local');
        }
        await saveClientValue(key, Object.fromEntries(entries)); return { success: true };
      }
      await setProjectCatalog('local', entries.filter(([, value]) => record(value).projectOrigin !== 'chatgpt')
        .map(([id, value]) => ({ ...record(value), id })));
      await saveClientValue(key, client); return { success: true };
    }
    if (key === 'remote-projects') {
      if (!Array.isArray(value) || value.some(value => typeof record(value).hostId !== 'string')) throw new Error('需要远端项目列表');
      const previous = Array.isArray(globals[key]) ? globals[key] as unknown[] : [];
      const ids = strings([...previous, ...value].map(value => record(value).hostId));
      for (const hostId of ids) {
        const wanted = value.map(record).filter(project => project.hostId === hostId);
        if (!equal(previous.filter(project => record(project).hostId === hostId), wanted)) await setProjectCatalog(hostId, wanted);
      }
      return { success: true };
    }
    await ensureHost('local');
    if (key === 'project-order') {
      if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id) || strings(value).length !== value.length) throw new Error('无效的项目顺序');
      const byHost = new Map<string, string[]>();
      for (const id of value as string[]) {
        const hostId = hostForProject(id);
        if (hostId) byHost.set(hostId, [...byHost.get(hostId) ?? [], id]);
      }
      for (const [hostId, ids] of byHost) if (supportsHost(hostId)) await setProjectOrder(hostId, ids);
      await saveClientValue(key, value); return { success: true };
    }
    if (key === 'project-appearances' || key === 'sidebar-project-thread-orders' || key === 'pinned-project-ids') {
      const pinned = key === 'pinned-project-ids';
      if (pinned ? !Array.isArray(value) || strings(value).length !== value.length : !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的项目元数据');
      const before = pinned ? Object.fromEntries(strings(globals[key]).map(id => [id, true])) : record(globals[key]);
      const next = pinned ? Object.fromEntries(strings(value).map(id => [id, true])) : record(value);
      const client: ObjectValue = {};
      for (const id of new Set([...Object.keys(before), ...Object.keys(next)])) {
        const hostId = hostForProject(id);
        if (!hostId || !supportsHost(hostId)) { if (next[id] !== undefined) client[id] = next[id]; continue; }
        if (!equal(before[id], next[id])) await setProjectMetadata(hostId, id, pinned ? { pinned: next[id] === true } :
          key === 'project-appearances' ? { appearance: next[id] } : { threadOrder: next[id] });
      }
      await saveClientValue(key, pinned ? Object.keys(client) : client); return { success: true };
    }
    if (key === assignmentKey) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要会话归属表');
      const previous = record(globals[key]), next = record(value), client: ObjectValue = {};
      for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        const assignment = next[id] as ProjectAssignment | undefined;
        if (record(assignment).projectOrigin === 'chatgpt') { client[id] = assignment; continue; }
        if (record(previous[id]).projectOrigin === 'chatgpt' && assignment === undefined) continue;
        const hostId = assignment ? assignment.projectKind === 'remote' ? assignment.hostId ?? hostForProject(assignment.projectId) ??
          assignmentHost(assignment, originalHosts, originalRemote) : 'local' : knownThreadHosts.get(id) ??
          assignmentHost(previous[id], originalHosts, originalRemote);
        if (!supportsHost(hostId)) {
          if (assignment !== undefined) client[id] = assignment.projectKind === 'remote' ? { ...assignment, hostId } : assignment;
          continue;
        }
        if (!equal(previous[id], assignment)) {
          await setAssignment(id, hostId, assignment ?? null);
        }
      }
      await saveClientValue(key, client); return { success: true };
    }
    if (key === pinKey) {
      if (!Array.isArray(value) || strings(value).length !== value.length) throw new Error('需要置顶会话列表');
      const desired = strings(value), current = strings(globals[key]);
      for (const threadId of current.filter(id => !desired.includes(id))) await pins.set({ threadId, hostId: pinHost(threadId), pinned: false });
      for (const threadId of desired.filter(id => !current.includes(id))) await pins.set({ threadId, hostId: pinHost(threadId), pinned: true, beforeThreadId: null });
      for (const hostId of new Set(desired.map(pinHost))) await pins.setOrder({ hostId, threadIds: desired.filter(id => pinHost(id) === hostId) });
      return { success: true };
    }
    throw new Error('未知的侧栏状态：' + key);
  }
  async function forgetHost(hostId: string) {
    const host = hosts.get(hostId);
    if (!host) return;
    host.refreshing = true;
    await host.pending.catch(() => {});
    hosts.delete(hostId);
    for (const [threadId, owner] of knownThreadHosts) if (owner === hostId) {
      const remaining = [...hosts].find(([, host]) => host.threads.has(threadId));
      if (remaining) knownThreadHosts.set(threadId, remaining[0]); else knownThreadHosts.delete(threadId);
    }
    projection();
  }
  function stageClientAssignments(assignments: ObjectValue) {
    const previous = legacy[assignmentKey];
    const next = { ...Object.fromEntries(Object.entries(record(previous)).filter(([, value]) => !clientAssignment(value))),
      ...Object.fromEntries(Object.entries(assignments).filter(([, value]) => clientAssignment(value))) };
    legacy[assignmentKey] = next;
    return () => { if (legacy[assignmentKey] === next) { if (previous === undefined) delete legacy[assignmentKey]; else legacy[assignmentKey] = previous; } };
  }
  return { supportsHost, ensureHost, refreshHost, observeResponse, observeThreadList: (hostId: string, value: unknown) => observeResponse(hostId, 'thread/list', value),
    observeBackend, persistenceGlobals, snapshotForPersistence: persistenceGlobals, request, pins, sectionSnapshot, cachedSectionSnapshot, setSections,
    getAssignment, setAssignment, restoreAssignment, resolveProjectId, setProjectMetadata, setProjectOrder, projectThreadIds, ownsGlobal, setGlobal, forgetHost, stageClientAssignments,
    hostForThread: (threadId: string) => knownThreadHosts.get(threadId) ?? 'local',
    projects: (hostId = 'local') => state(hostId).projects.map(project => ({ ...project })),
    async flush() { await Promise.all([...hosts.values()].map(host => host.pending.catch(() => {}))); },
  };
}

export type BackendSidebarState = ReturnType<typeof createBackendSidebarState>;
