import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

export type ProjectAssignment =
  | { projectKind: 'local'; projectId: string; projectOrigin?: 'chatgpt' }
  | { projectKind: 'remote'; projectId: string; hostId?: string };
export interface ThreadIdentity { hostId: string; threadId: string }
export interface ThreadMembership { assignment: ProjectAssignment | null; projectless: boolean }
export interface IdentifiedMembership extends ThreadIdentity, ThreadMembership {}
export interface MembershipUpdate extends Partial<ThreadMembership> { threadId: string; hostId?: string }
export type AssignmentRequest = Pick<MembershipUpdate, 'threadId' | 'hostId'> & Pick<ThreadMembership, 'assignment'>;
export type ProjectlessRequest = Pick<MembershipUpdate, 'threadId' | 'hostId'> & Pick<ThreadMembership, 'projectless'>;
export type MembershipRequest = Pick<MembershipUpdate, 'threadId' | 'hostId'> & ThreadMembership;
export interface ProjectlessThreadUpdate extends Pick<MembershipUpdate, 'threadId' | 'hostId' | 'projectless'> {
  outputDirectory?: string | null;
  workspaceRoot?: string | null;
}
export type ThreadProjectOperation = 'setAssignment' | 'setProjectless' | 'setMembership' | 'restoreMemberships'
  | 'assignIfUnassigned' | 'moveLocalProjectThreadsToProjectless' | 'reset' | 'flush'
  | 'getThreadStartProjectId' | 'updateProjectlessThread';

export interface ThreadProjectCompatibility {
  // Return all possible hosts only when the inventory is complete for this ID.
  // Undefined, an empty list, or multiple hosts cannot identify a legacy hint.
  resolveLegacyThreadHosts?: (threadId: string) => readonly string[] | undefined;
}
export interface ThreadProjectHint extends ThreadIdentity { value: string }
export interface ThreadProjectSnapshot {
  memberships: IdentifiedMembership[];
  outputDirectories: ThreadProjectHint[];
  workspaceRoots: ThreadProjectHint[];
  unresolved: {
    assignments: ObjectValue;
    projectless: unknown[];
    outputDirectories: ObjectValue;
    workspaceRoots: ObjectValue;
    unreadable: ObjectValue;
    qualified: { field: string; hostId: string; threadId?: string; value: unknown }[];
  };
}

const assignmentKey = 'thread-project-assignments';
const projectlessKey = 'projectless-thread-ids';
const outputKey = 'thread-projectless-output-directories';
const workspaceKey = 'thread-workspace-root-hints';
type StoreKey = typeof assignmentKey | typeof projectlessKey | typeof outputKey | typeof workspaceKey;
type Store = { $codexYardThreadProjects: 1; legacy: unknown; hosts: ObjectValue };
type Stores = Record<StoreKey, Store>;

// JSON tuples are unambiguous even when either ID contains punctuation.
export function threadProjectIdentityKey(identity: ThreadIdentity): string {
  return JSON.stringify([identity.hostId, identity.threadId]);
}

function isObject(value: unknown): value is ObjectValue {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
function put(target: ObjectValue, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, enumerable: true, writable: true });
}
function copyLegacy(value: unknown) {
  return Array.isArray(value) ? [...value] : isObject(value) ? { ...value } : value;
}
function loadStore(value: unknown, projectless = false): Store {
  if (isObject(value) && value.$codexYardThreadProjects === 1 && Object.hasOwn(value, 'legacy') && isObject(value.hosts)) {
    return { $codexYardThreadProjects: 1, legacy: copyLegacy(value.legacy), hosts: Object.fromEntries(
      Object.entries(value.hosts).map(([hostId, entries]) => [hostId, isObject(entries) ? { ...entries } : entries])) };
  }
  return { $codexYardThreadProjects: 1, legacy: value === undefined ? (projectless ? [] : {}) : copyLegacy(value), hosts: {} };
}
function storesFrom(globals: ObjectValue): Stores {
  return {
    [assignmentKey]: loadStore(globals[assignmentKey]),
    [projectlessKey]: loadStore(globals[projectlessKey], true),
    [outputKey]: loadStore(globals[outputKey]),
    [workspaceKey]: loadStore(globals[workspaceKey]),
  };
}
function assignment(value: unknown): ProjectAssignment | null {
  if (value === null) return null;
  const item = record(value);
  if (typeof item.projectId !== 'string') throw new Error('需要项目 ID');
  if (item.projectKind === 'local' && (item.projectOrigin === undefined || item.projectOrigin === 'chatgpt')) {
    return { projectKind: 'local', projectId: item.projectId, ...(item.projectOrigin ? { projectOrigin: item.projectOrigin } : {}) };
  }
  if (item.projectKind === 'remote' && (item.hostId === undefined || typeof item.hostId === 'string' && !!item.hostId.trim())) {
    return { projectKind: 'remote', projectId: item.projectId, ...(typeof item.hostId === 'string' ? { hostId: item.hostId } : {}) };
  }
  throw new Error('无效的项目归属');
}
function parsedAssignment(value: unknown): ProjectAssignment | null {
  try { return assignment(value); } catch { return null; }
}
function remoteProjectHosts(globals: ObjectValue, projectId: string): string[] {
  const projects = Array.isArray(globals['remote-projects']) ? globals['remote-projects'] : [];
  return [...new Set(projects.flatMap(value => {
    const project = record(value);
    return project.id === projectId && typeof project.hostId === 'string' && project.hostId.trim() && project.hostId !== 'local'
      ? [project.hostId] : [];
  }))];
}
function candidates(options: ThreadProjectCompatibility, threadId: string): string[] {
  const result = options.resolveLegacyThreadHosts?.(threadId);
  if (result === undefined) return [];
  if (!Array.isArray(result) || result.some(host => typeof host !== 'string' || !host.trim())) throw new Error('无效的旧会话主机解析结果');
  return [...new Set(result)];
}
function legacyAssignment(globals: ObjectValue, options: ThreadProjectCompatibility, threadId: string, value: unknown) {
  const item = parsedAssignment(value);
  if (!item) return undefined;
  const projectHosts = item.projectKind === 'remote' ? remoteProjectHosts(globals, item.projectId) : [];
  const hostId = item.projectKind === 'local' ? 'local' : item.hostId ?? (projectHosts.length === 1 ? projectHosts[0] : undefined);
  if (!hostId || item.projectKind === 'remote' && (hostId === 'local' || projectHosts.length > 0 && !projectHosts.includes(hostId))) return undefined;
  const known = candidates(options, threadId);
  if (known.length !== 1 || known[0] !== hostId) return undefined;
  return { hostId, assignment: item.projectKind === 'remote' ? { ...item, hostId } : item };
}
function legacyHintHost(options: ThreadProjectCompatibility, threadId: string): string | undefined {
  const hosts = candidates(options, threadId);
  return hosts.length === 1 ? hosts[0] : undefined;
}
function cachedCompatibility(options: ThreadProjectCompatibility): ThreadProjectCompatibility {
  if (!options.resolveLegacyThreadHosts) return options;
  const cache = new Map<string, readonly string[] | undefined>();
  return { resolveLegacyThreadHosts(threadId) {
    if (!cache.has(threadId)) cache.set(threadId, options.resolveLegacyThreadHosts!(threadId));
    return cache.get(threadId);
  } };
}
function withQualifiedEvidence(options: ThreadProjectCompatibility, stores: Stores): ThreadProjectCompatibility {
  if (!options.resolveLegacyThreadHosts) return options;
  return { resolveLegacyThreadHosts(threadId) {
    const hosts = candidates(options, threadId);
    if (!hosts.length) return hosts;
    for (const store of Object.values(stores)) for (const [hostId, entries] of Object.entries(store.hosts)) {
      if (hostId.trim() && isObject(entries) && Object.hasOwn(entries, threadId) && !hosts.includes(hostId)) hosts.push(hostId);
    }
    return hosts;
  } };
}
function sameAssignment(left: ProjectAssignment | null, right: ProjectAssignment | null) {
  const a = record(left), b = record(right);
  return a.projectKind === b.projectKind && a.projectId === b.projectId && a.projectOrigin === b.projectOrigin && a.hostId === b.hostId;
}

function snapshot(globals: ObjectValue, stores: Stores, options: ThreadProjectCompatibility, onlyThreadId?: string): ThreadProjectSnapshot {
  options = withQualifiedEvidence(options, stores);
  const memberships = new Map<string, IdentifiedMembership>();
  const outputs = new Map<string, ThreadProjectHint>(), workspaces = new Map<string, ThreadProjectHint>();
  const unresolved: ThreadProjectSnapshot['unresolved'] = {
    assignments: {}, projectless: [], outputDirectories: {}, workspaceRoots: {}, unreadable: {}, qualified: [],
  };
  function membership(hostId: string, threadId: string) {
    const identity = { hostId, threadId }, key = threadProjectIdentityKey(identity);
    let value = memberships.get(key);
    if (!value) { value = { ...identity, assignment: null, projectless: false }; memberships.set(key, value); }
    return value;
  }
  function legacyMap(key: StoreKey): ObjectValue {
    const value = stores[key].legacy;
    if (!isObject(value)) { put(unresolved.unreadable, key, value); return {}; }
    return value;
  }
  function entries(value: ObjectValue): [string, unknown][] {
    return onlyThreadId === undefined ? Object.entries(value) :
      Object.hasOwn(value, onlyThreadId) ? [[onlyThreadId, value[onlyThreadId]]] : [];
  }
  for (const [threadId, value] of entries(legacyMap(assignmentKey))) {
    const resolved = legacyAssignment(globals, options, threadId, value);
    if (resolved) membership(resolved.hostId, threadId).assignment = resolved.assignment;
    else put(unresolved.assignments, threadId, value);
  }
  const legacyProjectless = stores[projectlessKey].legacy;
  if (!Array.isArray(legacyProjectless)) put(unresolved.unreadable, projectlessKey, legacyProjectless);
  else for (const threadId of onlyThreadId === undefined ? legacyProjectless : legacyProjectless.includes(onlyThreadId) ? [onlyThreadId] : []) {
    const hostId = typeof threadId === 'string' ? legacyHintHost(options, threadId) : undefined;
    if (hostId && typeof threadId === 'string') membership(hostId, threadId).projectless = true;
    else unresolved.projectless.push(threadId);
  }
  for (const [key, target, unknown] of [
    [outputKey, outputs, unresolved.outputDirectories], [workspaceKey, workspaces, unresolved.workspaceRoots],
  ] as const) {
    for (const [threadId, value] of entries(legacyMap(key))) {
      const hostId = legacyHintHost(options, threadId);
      if (hostId && typeof value === 'string') target.set(threadProjectIdentityKey({ hostId, threadId }), { hostId, threadId, value });
      else put(unknown, threadId, value);
    }
  }
  for (const key of [assignmentKey, projectlessKey, outputKey, workspaceKey] as const) {
    for (const [hostId, value] of Object.entries(stores[key].hosts)) {
      if (!hostId.trim() || !isObject(value)) { unresolved.qualified.push({ field: key, hostId, value }); continue; }
      for (const [threadId, entry] of entries(value)) {
        const identity = { hostId, threadId }, identityKey = threadProjectIdentityKey(identity);
        if (key === assignmentKey) {
          const item = parsedAssignment(entry);
          if (!item || item.projectKind === 'local' && hostId !== 'local' ||
              item.projectKind === 'remote' && (hostId === 'local' || item.hostId !== undefined && item.hostId !== hostId)) {
            membership(hostId, threadId).assignment = null;
            unresolved.qualified.push({ field: key, ...identity, value: entry });
          } else membership(hostId, threadId).assignment = item.projectKind === 'remote' ? { ...item, hostId } : item;
        } else if (key === projectlessKey && typeof entry === 'boolean') membership(hostId, threadId).projectless = entry;
        else if (key !== projectlessKey && typeof entry === 'string') {
          (key === outputKey ? outputs : workspaces).set(identityKey, { ...identity, value: entry });
        } else {
          if (key === projectlessKey) membership(hostId, threadId).projectless = false;
          else (key === outputKey ? outputs : workspaces).delete(identityKey);
          unresolved.qualified.push({ field: key, ...identity, value: entry });
        }
      }
    }
  }
  return { memberships: [...memberships.values()], outputDirectories: [...outputs.values()], workspaceRoots: [...workspaces.values()], unresolved };
}

// Consumers must render unresolved legacy data separately; it has no inferred host.
export function readThreadProjectState(globals: ObjectValue, options: ThreadProjectCompatibility = {}): ThreadProjectSnapshot {
  return snapshot(globals, storesFrom(globals), cachedCompatibility(options));
}

function parseUpdate(value: unknown, requireAssignment: boolean, requireProjectless: boolean): MembershipUpdate {
  const item = record(value);
  if (typeof item.threadId !== 'string' || !item.threadId.trim()) throw new Error('需要会话 ID');
  if (item.hostId !== undefined && (typeof item.hostId !== 'string' || !item.hostId.trim())) throw new Error('需要执行主机 ID');
  const result: MembershipUpdate = { threadId: item.threadId, ...(typeof item.hostId === 'string' ? { hostId: item.hostId } : {}) };
  if (requireAssignment) result.assignment = assignment(item.assignment);
  if (requireProjectless) {
    if (typeof item.projectless !== 'boolean') throw new Error('需要 projectless 状态');
    result.projectless = item.projectless;
  }
  return result;
}
function unresolvedForThread(state: ThreadProjectSnapshot, threadId: string, membershipOnly = false) {
  const unresolved = state.unresolved;
  return Object.hasOwn(unresolved.assignments, threadId) || unresolved.projectless.includes(threadId) ||
    Object.hasOwn(unresolved.unreadable, assignmentKey) || Object.hasOwn(unresolved.unreadable, projectlessKey) ||
    unresolved.qualified.some(entry => (entry.threadId === undefined || entry.threadId === threadId) &&
      (!membershipOnly || entry.field === assignmentKey || entry.field === projectlessKey)) ||
    (!membershipOnly && (Object.hasOwn(unresolved.outputDirectories, threadId) || Object.hasOwn(unresolved.workspaceRoots, threadId) ||
      Object.hasOwn(unresolved.unreadable, outputKey) || Object.hasOwn(unresolved.unreadable, workspaceKey)));
}
function normalizedUpdate(item: MembershipUpdate, state: ThreadProjectSnapshot, globals: ObjectValue,
  options: ThreadProjectCompatibility, validHost: (hostId: string) => void): MembershipUpdate & ThreadIdentity {
  const known = new Set(candidates(options, item.threadId));
  for (const entry of [...state.memberships, ...state.outputDirectories, ...state.workspaceRoots, ...state.unresolved.qualified]) {
    if (entry.threadId === item.threadId && entry.hostId) known.add(entry.hostId);
  }
  let target: string | undefined;
  if (item.assignment?.projectKind === 'local') target = 'local';
  if (item.assignment?.projectKind === 'remote') {
    const projectHosts = remoteProjectHosts(globals, item.assignment.projectId);
    target = item.assignment.hostId ?? item.hostId ?? (projectHosts.length === 1 ? projectHosts[0] : undefined);
    if (!target || target === 'local') throw new Error('远程项目需要明确的执行主机');
    if (projectHosts.length && !projectHosts.includes(target)) throw new Error('项目与会话执行主机不一致');
  }
  let hostId = item.hostId;
  if (!hostId && target) {
    if (known.size > 1 || unresolvedForThread(state, item.threadId) || known.size && !known.has(target)) throw new Error('会话执行主机不明确');
    hostId = target;
  }
  if (!hostId) {
    if (known.size > 1 || unresolvedForThread(state, item.threadId)) throw new Error('会话执行主机不明确');
    hostId = known.size === 1 ? [...known][0] : 'local';
  }
  validHost(hostId);
  if (target && hostId !== target) throw new Error('项目与会话执行主机不一致');
  return { ...item, hostId, ...(item.assignment?.projectKind === 'remote' ? { assignment: { ...item.assignment, hostId } } : {}) };
}

function writeQualified(store: Store, identity: ThreadIdentity, value: unknown, remove: boolean) {
  const existing = Object.hasOwn(store.hosts, identity.hostId) ? store.hosts[identity.hostId] : undefined;
  if (existing !== undefined && !isObject(existing)) throw new Error('已保存的主机项目数据无法解析');
  const entries = existing ?? {};
  if (remove) delete entries[identity.threadId]; else put(entries, identity.threadId, value);
  if (Object.keys(entries).length) put(store.hosts, identity.hostId, entries); else delete store.hosts[identity.hostId];
}
function removeLegacyMapEntry(store: Store, threadId: string) {
  if (!isObject(store.legacy) || !Object.hasOwn(store.legacy, threadId)) return;
  delete store.legacy[threadId];
}
function removeLegacyProjectless(store: Store, threadId: string) {
  if (Array.isArray(store.legacy)) store.legacy = store.legacy.filter(value => value !== threadId);
}
function membershipAt(state: ThreadProjectSnapshot, identity: ThreadIdentity): ThreadMembership {
  const found = state.memberships.find(entry => entry.hostId === identity.hostId && entry.threadId === identity.threadId);
  return { assignment: found?.assignment ?? null, projectless: found?.projectless ?? false };
}
function hintAt(state: ThreadProjectSnapshot, key: typeof outputKey | typeof workspaceKey, identity: ThreadIdentity) {
  return (key === outputKey ? state.outputDirectories : state.workspaceRoots)
    .find(entry => entry.hostId === identity.hostId && entry.threadId === identity.threadId)?.value;
}
function ensureWritable(state: ThreadProjectSnapshot, key: StoreKey, identity: ThreadIdentity) {
  if (state.unresolved.qualified.some(entry => entry.field === key && entry.hostId === identity.hostId &&
      (entry.threadId === undefined || entry.threadId === identity.threadId))) throw new Error('已保存的主机会话项目数据无法解析');
}

// Each original globals key remains authoritative for its own field. Its v1
// envelope retains the untouched legacy value alongside host-qualified entries.
export function createThreadProjects(globals: ObjectValue, persist: () => Promise<void>, publish: (message: unknown) => void,
  validHost: (hostId: string) => void = hostId => { if (hostId !== 'local') throw new Error('当前仅支持本机'); },
  compatibility: ThreadProjectCompatibility = {}) {
  let pending = Promise.resolve<unknown>(undefined);
  const removedProjectlessThreads = new Set<string>();

  function enqueue(action: () => Promise<unknown>) {
    const result = pending.catch(() => {}).then(action);
    pending = result;
    return result;
  }
  async function commit(values: ObjectValue, memberships: Record<string, IdentifiedMembership>) {
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, globals[key]]));
    Object.assign(globals, values);
    try { await persist(); }
    catch (error) {
      for (const key of Object.keys(values)) if (globals[key] === values[key]) {
        if (previous[key] === undefined) delete globals[key]; else globals[key] = previous[key];
      }
      throw error;
    }
    if (Object.keys(values).length) publish({ type: 'global-state-updated', keys: Object.keys(values) });
    if (Object.keys(memberships).length) publish({ type: 'thread-project-memberships-updated', memberships });
  }
  async function apply(updates: MembershipUpdate[], options: ThreadProjectCompatibility,
    config: { onlyUnassigned?: boolean; hints?: { key: typeof outputKey | typeof workspaceKey; value: string | null }[] } = {}) {
    const stores = storesFrom(globals), dirty = new Set<StoreKey>(), before = new Map<string, IdentifiedMembership>();
    const revived = new Set<string>(), capturedThreads = new Set<string>();
    for (const raw of updates) {
      let state = snapshot(globals, stores, options, raw.threadId);
      const item = normalizedUpdate(raw, state, globals, options, validHost), identity = { hostId: item.hostId, threadId: item.threadId };
      const identityKey = threadProjectIdentityKey(identity), current = membershipAt(state, identity);
      if (config.onlyUnassigned && (current.assignment !== null || current.projectless || unresolvedForThread(state, item.threadId, true))) continue;
      if (!capturedThreads.has(item.threadId)) {
        for (const entry of state.memberships) before.set(threadProjectIdentityKey(entry), entry);
        capturedThreads.add(item.threadId);
      }
      if (!before.has(identityKey)) before.set(identityKey, { ...identity, assignment: null, projectless: false });
      if (item.assignment !== undefined) ensureWritable(state, assignmentKey, identity);
      if (item.assignment !== undefined && !sameAssignment(current.assignment, item.assignment)) {
        const store = stores[assignmentKey], rawLegacy = record(store.legacy)[item.threadId];
        if (legacyAssignment(globals, withQualifiedEvidence(options, stores), item.threadId, rawLegacy)?.hostId === item.hostId) {
          removeLegacyMapEntry(store, item.threadId);
        }
        writeQualified(store, identity, item.assignment, item.assignment === null); dirty.add(assignmentKey);
      }
      if (item.projectless !== undefined) ensureWritable(state, projectlessKey, identity);
      if (item.projectless !== undefined && current.projectless !== item.projectless) {
        const store = stores[projectlessKey];
        if (legacyHintHost(withQualifiedEvidence(options, stores), item.threadId) === item.hostId) removeLegacyProjectless(store, item.threadId);
        writeQualified(store, identity, true, !item.projectless); dirty.add(projectlessKey);
      }
      if (item.projectless === true && !config.hints) revived.add(identityKey);
      if (config.hints) for (const hint of config.hints) {
        state = snapshot(globals, stores, options, raw.threadId);
        ensureWritable(state, hint.key, identity);
        if (hintAt(state, hint.key, identity) === (hint.value ?? undefined)) continue;
        const store = stores[hint.key];
        if (legacyHintHost(withQualifiedEvidence(options, stores), item.threadId) === item.hostId) removeLegacyMapEntry(store, item.threadId);
        writeQualified(store, identity, hint.value, hint.value === null); dirty.add(hint.key);
      }
    }
    const after = snapshot(globals, stores, options), memberships: Record<string, IdentifiedMembership> = {};
    const afterByIdentity = new Map(after.memberships.map(item => [threadProjectIdentityKey(item), item]));
    for (const [key, item] of afterByIdentity) {
      if (capturedThreads.has(item.threadId) && !before.has(key)) before.set(key, { ...item, assignment: null, projectless: false });
    }
    const changed: IdentifiedMembership[] = [];
    for (const [key, previous] of before) {
      const current = afterByIdentity.get(key) ?? { assignment: null, projectless: false };
      if (!sameAssignment(previous.assignment, current.assignment) || previous.projectless !== current.projectless) {
        put(memberships, key, { hostId: previous.hostId, threadId: previous.threadId, ...current });
        changed.push(previous);
      }
    }
    if (dirty.size) await commit(Object.fromEntries([...dirty].map(key => [key, stores[key]])), memberships);
    for (const key of revived) removedProjectlessThreads.delete(key);
    return changed;
  }
  return async function request(operation: ThreadProjectOperation, value?: unknown): Promise<unknown> {
    switch (operation) {
      case 'setAssignment':
      case 'setProjectless':
      case 'setMembership': {
        const item = parseUpdate(value, operation !== 'setProjectless', operation !== 'setAssignment');
        return enqueue(async () => { await apply([item], cachedCompatibility(compatibility)); });
      }
      case 'restoreMemberships':
      case 'assignIfUnassigned': {
        if (!Array.isArray(value)) throw new Error('需要项目归属列表');
        const items = value.map(item => parseUpdate(item, true, true));
        return enqueue(async () => { await apply(items, cachedCompatibility(compatibility), { onlyUnassigned: operation === 'assignIfUnassigned' }); });
      }
      case 'moveLocalProjectThreadsToProjectless': {
        const params = typeof value === 'string' ? { projectId: value, hostId: 'local' } : record(value);
        if (typeof params.projectId !== 'string' || !params.projectId) throw new Error('需要项目 ID');
        if (params.hostId !== undefined && params.hostId !== 'local') throw new Error('本机项目只能属于本机');
        validHost('local');
        return enqueue(() => {
          const options = cachedCompatibility(compatibility), state = snapshot(globals, storesFrom(globals), options);
          return apply(state.memberships.filter(item => item.hostId === 'local' && item.assignment?.projectKind === 'local' &&
            item.assignment.projectId === params.projectId).map(item => ({ ...item, assignment: null, projectless: true })), options);
        });
      }
      case 'reset': {
        const params = value == null ? {} : record(value);
        if (value != null && !isObject(value) || params.hostId !== undefined && (typeof params.hostId !== 'string' || !params.hostId.trim())) {
          throw new Error('需要执行主机 ID');
        }
        if (typeof params.hostId === 'string') validHost(params.hostId);
        return enqueue(async () => {
          const options = cachedCompatibility(compatibility), state = snapshot(globals, storesFrom(globals), options);
          await apply(state.memberships.filter(item => params.hostId === undefined || item.hostId === params.hostId)
            .map(item => ({ hostId: item.hostId, threadId: item.threadId, assignment: null, projectless: false })), options);
        });
      }
      case 'flush': await pending.catch(() => {}); return;
      case 'getThreadStartProjectId': assignment(value); return null;
      case 'updateProjectlessThread': {
        const params = record(value), item = parseUpdate(value, false, params.projectless !== undefined);
        for (const key of ['outputDirectory', 'workspaceRoot']) {
          if (params[key] !== undefined && params[key] !== null && typeof params[key] !== 'string') throw new Error('无效的工作目录');
        }
        return enqueue(async () => {
          const options = cachedCompatibility(compatibility), state = snapshot(globals, storesFrom(globals), options);
          const normalized = normalizedUpdate(item, state, globals, options, validHost), identityKey = threadProjectIdentityKey(normalized);
          const removing = normalized.projectless === false && params.outputDirectory == null;
          if (!removing && removedProjectlessThreads.has(identityKey)) return;
          const hints: { key: typeof outputKey | typeof workspaceKey; value: string | null }[] = [];
          for (const [field, key] of [['outputDirectory', outputKey], ['workspaceRoot', workspaceKey]] as const) {
            if (params[field] !== undefined || removing && field === 'workspaceRoot') {
              hints.push({ key, value: params[field] == null ? null : params[field] as string });
            }
          }
          await apply([normalized], options, { hints });
          if (removing) removedProjectlessThreads.add(identityKey);
        });
      }
      default: throw new Error('未知的项目归属操作：' + operation);
    }
  };
}
