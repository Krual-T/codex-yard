import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import type { SidebarOptionChange, SidebarOptions, SidebarProjectAction, SidebarThreadAction, StandaloneSidebarProps } from '../sidebar/StandaloneSidebar.tsx';
import type { ThreadListRow } from '../sidebar/use-thread-list.ts';
import { readBrowserAtoms, subscribeBrowserAtoms, updateBrowserAtoms } from '../storage/ui-atoms.ts';
import { projectForThread, projectsForHost } from './projects.ts';
import type { Project, ProjectState } from './projects.ts';

const flatKey = 'flat-project-sidebar-preferences-v1';
const oldSortKey = 'codex-sidebar-sort-mode-v1';
const showKey = 'sidebar-show-projects-in-recents';
const oldOrganizationKey = 'sidebar-organize-mode-v1';
const oldKeepProjectsKey = 'sidebar-keep-projects-in-recent-v1';
const chatOrderKey = 'unified-sidebar-chat-order-v1';
const projectOrderAtomKey = 'unified-sidebar-project-order-v1';
const threadPinsKey = 'pinned-thread-ids';
const projectPinsKey = 'pinned-project-ids';
const threadOrdersKey = 'sidebar-project-thread-orders';
const projectOrderKey = 'project-order';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyOf = (row: Pick<ThreadListRow, 'hostId' | 'id'>) => JSON.stringify([row.hostId, row.id]);
const strings = (value: unknown): string[] | null => value === undefined ? [] :
  Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null;
const sameRoots = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((value, index) => value === right[index]);

/** Captured synchronously by the parent before the first asynchronous operation. */
export interface SidebarAuthority {
  assertBeforeSend(): void;
  daemonConnectionGeneration?: string;
}
export interface SidebarHostResolution { complete: boolean; hosts: readonly string[]; assertCurrent(): void }
export interface SidebarMembershipRequest {
  row: ThreadListRow;
  previous: Project | null;
  target: Project | null;
  /** Native must compare the original membership and project roots in its commit interval. */
  projectState: ProjectState;
}
export interface SidebarBehaviorOptions {
  client: WorkbenchClient;
  hostId: string;
  rows: readonly ThreadListRow[];
  projectState: ProjectState | null;
  captureAuthority(hostId: string): SidebarAuthority;
  /** Complete, current cross-host inventory; an incomplete result is not identity evidence. */
  resolveThreadHosts?(threadId: string): Promise<SidebarHostResolution>;
  /** Changes when the parent's host inventory or identity evidence changes. */
  threadHostResolutionEpoch?: unknown;
  /** Enable only when the host bridge supports the CLI's thread/readState/update method. */
  readStateWriteAvailable?: boolean;
  requestProjectName?(project: Project): Promise<string | null>;
  commitProjectMembership?(request: SidebarMembershipRequest, authority: SidebarAuthority): Promise<void>;
  availableThreadActions?(row: ThreadListRow): readonly SidebarThreadAction[];
  onThreadAction?(row: ThreadListRow, action: SidebarThreadAction, authority: SidebarAuthority): void | Promise<void>;
  availableProjectActions?(project: Project): readonly SidebarProjectAction[];
  onProjectAction?(project: Project, action: SidebarProjectAction, authority: SidebarAuthority): void | Promise<void>;
  onProjectsChanged?(): void;
}
export interface SidebarBehavior extends Pick<StandaloneSidebarProps, 'sidebarOptions' | 'onSidebarOptionChange' | 'orderThreads' | 'orderProjects'
  | 'isThreadPinned' | 'isThreadUnread' | 'availableThreadActions' | 'onThreadAction' | 'onMoveThreadToProject'
  | 'isProjectPinned' | 'availableProjectActions' | 'onProjectAction'> {
  error: string | null;
}
interface Observation { exists: boolean; value?: unknown }
interface ReadState { revision: string; firstUnread: { type: 'threadStart' } | { type: 'turn'; turnId: string } | null }
interface AtomsProjection { options: SidebarOptions; chatOrder: string[]; projectOrder: string[] }
interface GlobalsProjection { threads: string[] | null; projects: string[] | null; projectOrder: string[] | null; threadOrders: unknown }

function readState(value: unknown): ReadState | null {
  if (!isRecord(value) || typeof value.revision !== 'string' || !value.revision || !Object.hasOwn(value, 'firstUnread')) return null;
  const unread = value.firstUnread;
  if (unread === null) return { revision: value.revision, firstUnread: null };
  if (!isRecord(unread)) return null;
  if (unread.type === 'threadStart') return { revision: value.revision, firstUnread: { type: 'threadStart' } };
  if (unread.type === 'turn' && typeof unread.turnId === 'string' && unread.turnId)
    return { revision: value.revision, firstUnread: { type: 'turn', turnId: unread.turnId } };
  return null;
}
function readAtoms(atoms: Record<string, unknown>): AtomsProjection {
  const raw = atoms[flatKey];
  if (raw !== undefined && !isRecord(raw)) throw new Error('Sidebar preferences are unreadable; the original value was retained.');
  const pref = raw ?? {};
  let mode = pref.mode === 'team' ? 'project' : pref.mode ?? 'project';
  const sort = pref.chatSortMode ?? 'updated_at', projectSort = pref.projectSortMode ?? 'updated_at', show = atoms[showKey] ?? true;
  const oldMode = atoms[oldOrganizationKey], oldKeepProjects = atoms[oldKeepProjectsKey];
  if (pref.initialized !== undefined && typeof pref.initialized !== 'boolean')
    throw new Error('Sidebar preferences contain an unsupported value; the original value was retained.');
  if (!pref.initialized && oldMode != null) {
    if (oldMode === 'recent') {
      if (oldKeepProjects != null && typeof oldKeepProjects !== 'boolean')
        throw new Error('Sidebar preferences contain an unsupported value; the original value was retained.');
      mode = oldKeepProjects === false ? 'list' : 'project';
    } else mode = oldMode;
  }
  if ((mode !== 'project' && mode !== 'list') || !['updated_at', 'manual', 'created_at', 'priority'].includes(String(sort))
    || !['updated_at', 'manual', 'created_at', 'priority'].includes(String(projectSort))
    || typeof show !== 'boolean') throw new Error('Sidebar preferences contain an unsupported value; the original value was retained.');
  const chatOrder = strings(atoms[chatOrderKey]), projectOrder = strings(atoms[projectOrderAtomKey]);
  if (!chatOrder || !projectOrder) throw new Error('Sidebar order is unreadable; the original value was retained.');
  return { options: { organization: mode === 'project' ? 'by-project' : 'one-list',
    sort: atoms[oldSortKey] != null || sort !== 'manual' || pref.manualSortVersion !== 1 ? 'last-updated' : 'manual',
    projectSort: atoms[oldSortKey] != null || projectSort !== 'manual' || pref.manualSortVersion !== 1 ? 'last-updated' : 'manual',
    showProjects: show },
  chatOrder, projectOrder };
}
async function observation(client: WorkbenchClient, key: string): Promise<Observation> {
  const result = await client.host<unknown>('get-global-state', { key });
  if (!isRecord(result) || typeof result.exists !== 'boolean') throw new Error('Unable to read the saved sidebar state.');
  return { exists: result.exists, ...(result.exists ? { value: result.value } : {}) };
}
function catalogMatches(state: ProjectState | null, project: Project): boolean {
  if (!state?.inventory.complete || !isRecord(state.catalog.local) || !Array.isArray(state.catalog.remote)) return false;
  const all = [...Object.values(state.catalog.local), ...state.catalog.remote];
  if (all.some(value => !isRecord(value) || typeof value.id !== 'string')) return false;
  const candidates = project.hostId === 'local' ? Object.values(state.catalog.local)
    : state.catalog.remote.filter(value => isRecord(value) && value.hostId === project.hostId);
  const matching = candidates.filter(value => isRecord(value) && value.id === project.id);
  return matching.length === 1 && projectsForHost(state, project.hostId).some(value => value.id === project.id
    && sameRoots(value.rootPaths, project.rootPaths) && value.name === project.name);
}
function projectPinIsUnambiguous(state: ProjectState | null, project: Project): boolean {
  if (!catalogMatches(state, project) || !state || !isRecord(state.catalog.local) || !Array.isArray(state.catalog.remote)) return false;
  return [...Object.values(state.catalog.local), ...state.catalog.remote]
    .filter(value => isRecord(value) && value.id === project.id).length === 1;
}
function renameCatalog(value: unknown, project: Project, name: string): unknown {
  if (project.hostId === 'local') {
    if (!isRecord(value)) throw new Error('The project catalog is unreadable; it was retained.');
    const matches = Object.entries(value).filter(([, item]) => isRecord(item) && item.id === project.id);
    const entry = matches[0];
    if (matches.length !== 1 || !entry || !isRecord(entry[1]) || entry[1].name !== project.name
      || !Array.isArray(entry[1].rootPaths) || !sameRoots(entry[1].rootPaths, project.rootPaths)) throw new Error('The project changed; review it before retrying.');
    return { ...value, [entry[0]]: { ...entry[1], name } };
  }
  if (!Array.isArray(value)) throw new Error('The project catalog is unreadable; it was retained.');
  const matches = value.filter(item => isRecord(item) && item.id === project.id && item.hostId === project.hostId);
  const entry = matches[0];
  if (matches.length !== 1 || !isRecord(entry) || (typeof entry.label === 'string' ? entry.label : entry.remotePath) !== project.name || entry.remotePath !== project.rootPaths[0]
    || project.rootPaths.length !== 1) throw new Error('The project changed; review it before retrying.');
  return value.map(item => item === entry ? { ...entry, label: name } : item);
}

/** Projection and actions over the existing browser atoms, native globals and CLI state. */
export function useSidebarBehavior(options: SidebarBehaviorOptions): SidebarBehavior {
  const latest = useRef(options); latest.current = options;
  const [atoms, setAtoms] = useState<AtomsProjection | null>(null);
  const [globals, setGlobals] = useState<GlobalsProjection>({ threads: null, projects: null, projectOrder: null, threadOrders: null });
  const [reads, setReads] = useState<Record<string, ReadState>>({});
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const readsRef = useRef(reads); readsRef.current = reads;
  const rowGeneration = useRef(0);
  const rowKey = JSON.stringify(options.rows.filter(row => row.hostId === options.hostId).map(row => row.id));

  useEffect(() => {
    let active = true, atomGeneration = 0, globalGeneration = 0;
    const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
    const loadAtoms = async () => {
      const generation = ++atomGeneration;
      try { const value = readAtoms(await readBrowserAtoms()); if (active && generation === atomGeneration) { setAtoms(value); setError(null); } }
      catch (cause) { if (active && generation === atomGeneration) { setAtoms(null); setError(message(cause)); } }
    };
    const loadGlobals = async () => {
      const generation = ++globalGeneration;
      try {
        const [threads, projects, projectOrder, threadOrders] = await Promise.all([threadPinsKey, projectPinsKey, projectOrderKey, threadOrdersKey]
          .map(key => observation(options.client, key)));
        if (active && generation === globalGeneration) setGlobals({ threads: strings(threads!.value), projects: strings(projects!.value),
          projectOrder: strings(projectOrder!.value), threadOrders: threadOrders!.value });
      } catch (cause) { if (active && generation === globalGeneration) { setGlobals({ threads: null, projects: null, projectOrder: null, threadOrders: null }); setError(message(cause)); } }
    };
    const loadRows = async () => {
      const generation = ++rowGeneration.current;
      const rows = latest.current.rows.filter(row => row.hostId === options.hostId);
      const [readEntries, hostEntries] = await Promise.all([
        Promise.all(rows.map(async row => {
          try {
            const result = await options.client.rpc<unknown>('thread/read', { threadId: row.id, includeTurns: false }, row.hostId);
            return [keyOf(row), isRecord(result) ? readState(result.readState) : null] as const;
          } catch { return [keyOf(row), null] as const; }
        })),
        Promise.all(rows.map(async row => {
          try {
            const result = await latest.current.resolveThreadHosts?.(row.id);
            result?.assertCurrent();
            return [keyOf(row), result?.complete === true && result.hosts.length === 1 && result.hosts[0] === row.hostId] as const;
          } catch { return [keyOf(row), false] as const; }
        })),
      ]);
      if (!active || generation !== rowGeneration.current) return;
      const next = Object.fromEntries(readEntries.filter((entry): entry is readonly [string, ReadState] => entry[1] !== null));
      readsRef.current = next; setReads(next);
      setResolved(Object.fromEntries(hostEntries));
    };
    const unsubscribeAtoms = subscribeBrowserAtoms(keys => {
      if (keys.some(key => [flatKey, oldSortKey, showKey, oldOrganizationKey, oldKeepProjectsKey, chatOrderKey, projectOrderAtomKey].includes(key))) void loadAtoms();
    });
    const unsubscribeClient = options.client.subscribe(event => {
      if (event.type === 'global-state-updated') void loadGlobals();
      if (event.type === 'mcp-notification' && event.hostId === options.hostId && event.method === 'thread/readState/changed') void loadRows();
      if (event.type === 'codex-app-server-connection-changed') void loadRows();
    });
    void loadAtoms(); void loadGlobals(); void loadRows();
    return () => { active = false; unsubscribeAtoms(); unsubscribeClient(); };
  }, [options.client, options.hostId, options.threadHostResolutionEpoch, rowKey]);

  const assertRow = (row: ThreadListRow) => {
    if (latest.current.hostId !== row.hostId || !latest.current.rows.some(item => item.hostId === row.hostId && item.id === row.id))
      throw new Error('The original conversation is no longer available.');
  };
  const assertProject = (project: Project) => {
    if (latest.current.hostId !== project.hostId || !catalogMatches(latest.current.projectState, project))
      throw new Error('The original project or its host changed; review it before retrying.');
  };
  const capture = (hostId: string) => { const authority = latest.current.captureAuthority(hostId); authority.assertBeforeSend(); return authority; };
  const onSidebarOptionChange = useCallback(async (change: SidebarOptionChange) => {
    const hostId = latest.current.hostId, client = latest.current.client, authority = capture(hostId);
    await updateBrowserAtoms(current => {
      authority.assertBeforeSend();
      if (latest.current.hostId !== hostId || latest.current.client !== client) throw new Error('The original sidebar host changed.');
      readAtoms({ ...current });
      const pref = isRecord(current[flatKey]) ? current[flatKey] : {};
      if (change.type === 'show-projects') return { value: undefined, updates: { [showKey]: change.value } };
      if (change.type === 'organization') return { value: undefined, updates: { [flatKey]: { ...pref, initialized: true,
        mode: change.value === 'by-project' ? 'project' : 'list' } } };
      const sort = change.value === 'manual' ? 'manual' : 'updated_at';
      return { value: undefined, updates: { [oldSortKey]: undefined, [flatKey]: { ...pref, manualSortVersion: 1,
        chatSortMode: sort, projectSortMode: sort } } };
    });
  }, []);

  const setPin = async (client: WorkbenchClient, key: string, id: string, pinned: boolean, authority: SidebarAuthority, check: () => void) => {
    const before = await observation(client, key); authority.assertBeforeSend(); check();
    const ids = strings(before.value);
    if (!ids) throw new Error('The saved pin list is unreadable; it was retained.');
    const rest = ids.filter(value => value !== id), next = pinned ? [id, ...rest] : rest;
    await client.host('set-global-state', { key, value: next, expected: before },
      { assertBeforeSend: () => { authority.assertBeforeSend(); check(); } });
  };
  const threadPinned = useCallback((row: ThreadListRow) => resolved[keyOf(row)] === true && globals.threads?.includes(row.id) === true,
    [resolved, globals.threads]);
  const projectPinned = useCallback((project: Project) => projectPinIsUnambiguous(latest.current.projectState, project)
    && globals.projects?.includes(project.id) === true, [globals.projects]);
  const onThreadAction = useCallback(async (row: ThreadListRow, action: SidebarThreadAction) => {
    row = { ...row };
    const client = latest.current.client, authority = capture(row.hostId); assertRow(row);
    const checkClient = () => { if (latest.current.client !== client) throw new Error('The original sidebar connection changed.'); };
    if (action === 'pin' || action === 'unpin') {
      const proof = await latest.current.resolveThreadHosts?.(row.id); authority.assertBeforeSend(); assertRow(row);
      if (!proof?.complete || proof.hosts.length !== 1 || proof.hosts[0] !== row.hostId) throw new Error('The conversation host is ambiguous; no pin was changed.');
      proof.assertCurrent();
      await setPin(client, threadPinsKey, row.id, action === 'pin', authority, () => { checkClient(); assertRow(row); proof.assertCurrent(); }); return;
    }
    if (action === 'mark-read' || action === 'mark-unread') {
      const seen = readsRef.current[keyOf(row)];
      if (!latest.current.readStateWriteAvailable || !seen) throw new Error('Durable read state is unavailable.');
      const check = () => { authority.assertBeforeSend(); checkClient(); assertRow(row);
        if (readsRef.current[keyOf(row)]?.revision !== seen.revision) throw new Error('Read state changed; review it before retrying.'); };
      const result = await client.rpc<unknown>('thread/readState/update', { threadId: row.id, expectedRevision: seen.revision,
        operation: { type: action === 'mark-read' ? 'read' : 'unread' } }, row.hostId,
      { assertBeforeSend: check, daemonConnectionGeneration: authority.daemonConnectionGeneration });
      const next = isRecord(result) ? readState(result.readState) : null;
      if (!next) throw new Error('The read-state result could not be confirmed.');
      if (latest.current.client === client && latest.current.hostId === row.hostId && readsRef.current[keyOf(row)]?.revision === seen.revision) {
        rowGeneration.current++; const updated = { ...readsRef.current, [keyOf(row)]: next };
        readsRef.current = updated; setReads(updated);
      }
      return;
    }
    const handler = latest.current.onThreadAction;
    if (!handler) throw new Error('This conversation action is not connected.');
    await handler(row, action, authority);
  }, []);
  const onMoveThreadToProject = useCallback(async (row: ThreadListRow, target: Project | null) => {
    row = { ...row };
    target = target ? { ...target, rootPaths: [...target.rootPaths] } : null;
    const client = latest.current.client;
    const authority = capture(row.hostId); assertRow(row);
    if (target && target.hostId !== row.hostId) throw new Error('The project belongs to another host.');
    const currentState = latest.current.projectState, handler = latest.current.commitProjectMembership;
    if (!currentState || !handler || !currentState.inventory.complete || Object.hasOwn(currentState.unresolved.assignments, row.id)
      || currentState.unresolved.projectless.includes(row.id) || currentState.unresolved.qualified.some(value =>
        (!value.hostId.trim() || value.hostId === row.hostId) && (value.threadId === undefined || value.threadId === row.id))
      || Object.keys(currentState.unresolved.unreadable).length) throw new Error('Project membership cannot be confirmed.');
    const state = structuredClone(currentState);
    if (target) assertProject(target);
    const previous = projectForThread(state, projectsForHost(state, row.hostId), row.hostId, row);
    await handler({ row, previous, target, projectState: state }, { daemonConnectionGeneration: authority.daemonConnectionGeneration, assertBeforeSend: () => {
      authority.assertBeforeSend(); if (latest.current.client !== client) throw new Error('The original sidebar connection changed.');
      assertRow(row); if (target) assertProject(target);
    } });
    latest.current.onProjectsChanged?.();
  }, []);
  const onProjectAction = useCallback(async (project: Project, action: SidebarProjectAction) => {
    project = { ...project, rootPaths: [...project.rootPaths] };
    const client = latest.current.client, authority = capture(project.hostId); assertProject(project);
    const check = () => { authority.assertBeforeSend(); if (latest.current.client !== client) throw new Error('The original sidebar connection changed.'); assertProject(project); };
    if (action === 'pin' || action === 'unpin') {
      const checkPin = () => { check(); if (!projectPinIsUnambiguous(latest.current.projectState, project))
        throw new Error('The project identity is ambiguous; no pin was changed.'); };
      checkPin();
      await setPin(client, projectPinsKey, project.id, action === 'pin', authority, checkPin); return;
    }
    if (action === 'edit') {
      const requestName = latest.current.requestProjectName;
      if (!requestName) throw new Error('Project editing is not connected.');
      const name = await requestName(project); check();
      if (name === null) return;
      if (!name.trim()) throw new Error('A project name is required.');
      const key = project.hostId === 'local' ? 'local-projects' : 'remote-projects';
      const before = await observation(client, key); check();
      const value = renameCatalog(before.value, project, name.trim());
      await client.host('set-global-state', { key, value, expected: before }, { assertBeforeSend: check });
      latest.current.onProjectsChanged?.(); return;
    }
    const handler = latest.current.onProjectAction;
    if (!handler) throw new Error('This project action is not connected.');
    await handler(project, action, authority);
  }, []);

  return useMemo(() => {
    const isThreadUnread = (row: ThreadListRow) => reads[keyOf(row)]?.firstUnread != null;
    const availableThreadActions = (row: ThreadListRow): readonly SidebarThreadAction[] => {
      const actions = [...(options.onThreadAction ? options.availableThreadActions?.(row) ?? [] : [])]
        .filter(action => !['pin', 'unpin', 'mark-read', 'mark-unread', 'move'].includes(action));
      if (globals.threads && resolved[keyOf(row)]) actions.push('pin', 'unpin');
      if (options.readStateWriteAvailable && reads[keyOf(row)]) actions.push('mark-read', 'mark-unread');
      if (options.commitProjectMembership) actions.push('move');
      return actions;
    };
    const availableProjectActions = (project: Project): readonly SidebarProjectAction[] => {
      const actions = [...(options.onProjectAction ? options.availableProjectActions?.(project) ?? [] : [])]
        .filter(action => !['pin', 'unpin', 'edit'].includes(action));
      if (catalogMatches(options.projectState, project)) {
        if (globals.projects && projectPinIsUnambiguous(options.projectState, project)) actions.push('pin', 'unpin');
        if (options.requestProjectName) actions.push('edit');
      }
      return actions;
    };
    const orderThreads = (rows: readonly ThreadListRow[], project: Project | null) => {
      const entry = project && isRecord(globals.threadOrders) ? globals.threadOrders[project.id] : null;
      const order = project && isRecord(entry) ? strings(entry.threadIds) ?? [] : atoms?.chatOrder ?? [];
      const rank = new Map(order.map((id, index) => [id, index]));
      return [...rows].sort((a, b) => {
        const pin = Number(threadPinned(b)) - Number(threadPinned(a)); if (pin) return pin;
        if (threadPinned(a) && threadPinned(b)) return (globals.threads?.indexOf(a.id) ?? 0) - (globals.threads?.indexOf(b.id) ?? 0);
        if ((project ? atoms?.options.projectSort : atoms?.options.sort) === 'manual') {
          const aKey = project ? a.id : `codex:thread:local:${a.id}`, bKey = project ? b.id : `codex:thread:local:${b.id}`;
          const ai = resolved[keyOf(a)] ? rank.get(aKey) : undefined, bi = resolved[keyOf(b)] ? rank.get(bKey) : undefined;
          return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER);
        }
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      });
    };
    const orderProjects = (projects: readonly Project[]) => {
      const order = atoms?.options.projectSort === 'manual' ? atoms.projectOrder.map(value => value.replace(/^codex:project:/, '')) : globals.projectOrder ?? [];
      const rank = new Map(order.map((id, index) => [id, index]));
      return [...projects].sort((a, b) => Number(projectPinned(b)) - Number(projectPinned(a))
        || (projectPinned(a) && projectPinned(b) ? (globals.projects?.indexOf(a.id) ?? 0) - (globals.projects?.indexOf(b.id) ?? 0)
          : (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)));
    };
    return { sidebarOptions: atoms?.options, onSidebarOptionChange, orderThreads, orderProjects, isThreadPinned: threadPinned,
      isThreadUnread, availableThreadActions, onThreadAction, onMoveThreadToProject: options.commitProjectMembership ? onMoveThreadToProject : undefined,
      isProjectPinned: projectPinned, availableProjectActions, onProjectAction, error };
  }, [atoms, globals, reads, resolved, options.availableThreadActions, options.onThreadAction, options.availableProjectActions, options.onProjectAction, options.projectState,
    options.readStateWriteAvailable, options.commitProjectMembership, options.requestProjectName, threadPinned, projectPinned,
    onSidebarOptionChange, onThreadAction, onMoveThreadToProject, onProjectAction, error]);
}
