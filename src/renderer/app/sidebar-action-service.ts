import type { ThreadItemSummary, ThreadSummary } from '../../../lib/codex-protocol.ts';
import { captureThreadProjectMembershipExpected } from '../../native/thread-project-condition.ts';
import type { ThreadProjectConditionState } from '../../native/thread-project-condition.ts';
import type { SidebarProjectAction, SidebarThreadAction } from '../sidebar/StandaloneSidebar.tsx';
import type { ThreadListRow } from '../sidebar/use-thread-list.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { loadThread } from './load-thread.ts';
import { projectForThread, projectsForHost } from './projects.ts';
import type { Project, ProjectState } from './projects.ts';
import type { SidebarAuthority } from './use-sidebar-behavior.ts';

export type SidebarActionConfirmation =
  | { type: 'delete-thread'; row: ThreadListRow }
  | { type: 'archive-project'; project: Project; rows: readonly ThreadListRow[] }
  | { type: 'remove-project'; project: Project; assignedThreadIds: readonly string[] };
export type SidebarActionCommit =
  | { type: 'rename' | 'archive' | 'restore' | 'delete'; row: ThreadListRow }
  | { type: 'fork'; row: ThreadListRow; thread: ThreadSummary }
  | { type: 'archive-chats'; project: Project; threadIds: readonly string[] }
  | { type: 'remove-project'; project: Project; removedRecord: unknown; detachedThreadIds: readonly string[] };

export interface SidebarActionServiceOptions {
  client: WorkbenchClient;
  requestName(row: ThreadListRow): string | null | Promise<string | null>;
  confirm(request: SidebarActionConfirmation): boolean | Promise<boolean>;
  /** Check the captured project identity and roots against the parent's current projection. */
  assertProjectCurrent(project: Project): void;
  /** Refresh, and navigate through the parent's existing barrier when necessary. */
  onCommitted(result: SidebarActionCommit, authority: SidebarAuthority): void | Promise<void>;
  /** A custom clipboard implementation must recheck this authority after its own awaits. */
  writeClipboard?(text: string, authority: SidebarAuthority): void | Promise<void>;
  /** Supply only if this host can really open a directory in its file manager. */
  openProjectDirectory?(project: Project, authority: SidebarAuthority): void | Promise<void>;
  /** Native currently permits deletion only for an owned, empty prewarm thread. */
  canDeleteThread?(row: ThreadListRow): boolean;
}

export class SidebarPartialActionError extends Error {
  readonly action: 'archive-chats' | 'remove-project';
  readonly completedThreadIds: readonly string[];
  readonly failedThreadId: string | null;
  readonly originalError: unknown;
  constructor(action: 'archive-chats' | 'remove-project', completedThreadIds: readonly string[],
    failedThreadId: string | null, originalError: unknown) {
    super(`${action} did not finish; ${completedThreadIds.length} conversation changes were confirmed. Review the current state before retrying.`, { cause: originalError });
    this.name = 'SidebarPartialActionError';
    this.action = action;
    this.completedThreadIds = completedThreadIds;
    this.failedThreadId = failedThreadId;
    this.originalError = originalError;
  }
}

export class SidebarCommittedActionError extends Error {
  readonly result: SidebarActionCommit;
  readonly originalError: unknown;
  constructor(result: SidebarActionCommit, originalError: unknown) {
    super('The action was confirmed, but the sidebar could not finish its refresh or navigation.', { cause: originalError });
    this.name = 'SidebarCommittedActionError';
    this.result = result;
    this.originalError = originalError;
  }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameRoots = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

function authorityCheck(authority: SidebarAuthority) {
  authority.assertBeforeSend();
  if (!authority.daemonConnectionGeneration) throw new Error('The original host connection is unavailable.');
}

async function copyText(text: string, authority: SidebarAuthority): Promise<void> {
  authorityCheck(authority);
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; }
    catch { authorityCheck(authority); }
  }
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none';
  document.body.append(field);
  try {
    field.select();
    authorityCheck(authority);
    if (!document.execCommand('copy')) throw new Error('Clipboard copy failed.');
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}

function guardedClient(client: WorkbenchClient, hostId: string, authority: SidebarAuthority, extraCheck?: () => void): WorkbenchClient {
  const check = () => { authorityCheck(authority); extraCheck?.(); };
  return {
    rpc<T>(method: string, params: Record<string, unknown> = {}, requestedHost = hostId) {
      if (requestedHost !== hostId) throw new Error('The original conversation host changed.');
      check();
      return client.rpc<T>(method, params, hostId, { daemonConnectionGeneration: authority.daemonConnectionGeneration, assertBeforeSend: check });
    },
    host<T>(endpoint: string, params: Record<string, unknown> = {}) {
      check();
      return client.host<T>(endpoint, { ...params, hostId, daemonConnectionGeneration: authority.daemonConnectionGeneration }, { assertBeforeSend: check });
    },
    subscribe: listener => client.subscribe(listener),
    reply: (request, response) => client.reply(request, response),
  };
}

function validateProject(project: Project) {
  if (!project.hostId || !project.id || !Array.isArray(project.rootPaths) || project.rootPaths.some(root => typeof root !== 'string')) {
    throw new Error('The original project identity is invalid.');
  }
}

function projectInState(state: ProjectState, project: Project) {
  const candidates = projectsForHost(state, project.hostId).filter(value => value.id === project.id);
  if (candidates.length !== 1 || !sameRoots(candidates[0]!.rootPaths, project.rootPaths) || candidates[0]!.name !== project.name) {
    throw new Error('The project changed; review it before retrying.');
  }
}

type InventoryState = ThreadProjectConditionState & ProjectState & { resolvedThreadHosts: Record<string, string[]> };

async function readProjectState(client: WorkbenchClient, ids: readonly string[]): Promise<InventoryState> {
  const state = await client.host<ThreadProjectConditionState & ProjectState & { resolvedThreadHosts: Record<string, string[]> | null }>(
    'thread-project-state', { resolveThreadIds: [...new Set(ids)] });
  if (!object(state) || !object(state.inventory) || state.inventory.complete !== true || !object(state.resolvedThreadHosts)
    || !object(state.catalog) || !Array.isArray(state.memberships) || !Array.isArray(state.membershipSources)
    || !object(state.unresolved) || !object(state.unresolved.assignments) || !Array.isArray(state.unresolved.projectless)
    || !object(state.unresolved.unreadable) || !Array.isArray(state.unresolved.qualified)) {
    throw new Error('The complete project and host inventory is unavailable.');
  }
  for (const id of ids) {
    const hosts = state.resolvedThreadHosts[id];
    if (!Array.isArray(hosts) || hosts.some(value => typeof value !== 'string')) throw new Error('A conversation host could not be verified.');
  }
  return state as InventoryState;
}

function unresolvedFor(state: ProjectState, hostId: string, threadId: string) {
  const unreadable = state.unresolved.unreadable;
  return Object.hasOwn(state.unresolved.assignments, threadId) || state.unresolved.projectless.includes(threadId)
    || Object.hasOwn(unreadable, 'thread-project-assignments') || Object.hasOwn(unreadable, 'projectless-thread-ids')
    || state.unresolved.qualified.some(value => value.hostId === hostId && (!value.threadId || value.threadId === threadId)
      && ['thread-project-assignments', 'projectless-thread-ids'].includes(value.field));
}

async function listThreads(client: WorkbenchClient, hostId: string, archived: boolean): Promise<ThreadListRow[]> {
  const rows: ThreadListRow[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: unknown = await client.rpc<unknown>('thread/list', { limit: 100, cursor, sortKey: 'updated_at', archived }, hostId);
    if (!object(page) || !Array.isArray(page.data) || page.nextCursor != null && typeof page.nextCursor !== 'string') {
      throw new Error('The conversation list is incomplete.');
    }
    for (const value of page.data) {
      if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.cwd !== 'string'
        || !object(value.status) || typeof value.status.type !== 'string' || ids.has(value.id)) {
        throw new Error('The conversation list contains an invalid or repeated identity.');
      }
      ids.add(value.id);
      rows.push({ ...value, hostId, archived } as unknown as ThreadListRow);
    }
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    if (cursor && cursors.has(cursor)) throw new Error('The conversation list cursor did not advance.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return rows;
}

function projectRows(state: InventoryState, project: Project, rows: readonly ThreadListRow[]): ThreadListRow[] {
  const projects = projectsForHost(state, project.hostId);
  return rows.filter(row => {
    if (row.hostId !== project.hostId || !state.resolvedThreadHosts[row.id]?.includes(row.hostId)
      || unresolvedFor(state, row.hostId, row.id)) {
      throw new Error('A conversation has an unresolved project identity.');
    }
    const membership = state.memberships.find(value => value.hostId === row.hostId && value.threadId === row.id);
    if (!membership && projects.filter(value => value.rootPaths.includes(row.cwd)).length > 1) {
      throw new Error('A conversation directory matches more than one project.');
    }
    return projectForThread(state, projects, row.hostId, row)?.id === project.id;
  });
}

function matchingCatalogEntry(value: unknown, project: Project): { next: unknown; removed: unknown } {
  const match = (item: unknown) => object(item) && item.id === project.id && (project.hostId === 'local' || item.hostId === project.hostId);
  if (project.hostId === 'local') {
    if (!object(value)) throw new Error('The project catalog is unreadable; it was retained.');
    const found = Object.entries(value).filter(([, item]) => match(item));
    if (found.length !== 1 || !object(found[0]![1])) throw new Error('The project identity is unavailable or ambiguous.');
    const key = found[0]![0], item = found[0]![1];
    if (!object(item)) throw new Error('The project identity is unavailable or ambiguous.');
    const roots = item.rootPaths;
    if (!Array.isArray(roots) || !roots.every(root => typeof root === 'string') || !sameRoots(roots, project.rootPaths)
      || (typeof item.name === 'string' ? item.name : item.id) !== project.name) throw new Error('The project changed; review it before retrying.');
    const next = { ...value }; delete next[key];
    return { next, removed: structuredClone(item) };
  }
  if (!Array.isArray(value)) throw new Error('The project catalog is unreadable; it was retained.');
  const matches = value.filter(match);
  if (matches.length !== 1 || !object(matches[0])) throw new Error('The project identity is unavailable or ambiguous.');
  const item = matches[0];
  if (typeof item.remotePath !== 'string' || !sameRoots([item.remotePath], project.rootPaths)
    || (typeof item.label === 'string' ? item.label : item.remotePath) !== project.name) throw new Error('The project changed; review it before retrying.');
  return { next: value.filter(entry => entry !== item), removed: structuredClone(item) };
}

function fencedJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2)?.replaceAll('<', '\\u003c');
  if (json === undefined) throw new Error('A conversation item cannot be represented in Markdown.');
  let longest = 2;
  for (const match of json.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  return `${fence}json\n${json}\n${fence}`;
}

function messageDetails(label: string, value: unknown): string {
  return `<details><summary>${label}</summary>\n\n${fencedJson(value)}\n\n</details>`;
}

function markdownItem(item: ThreadItemSummary): string | null {
  if (item.type === 'reasoning') return null;
  if (item.type === 'agentMessage' && typeof item.text === 'string') {
    const extras = Object.fromEntries(Object.entries(item).filter(([key, value]) =>
      !['id', 'type', 'text', 'phase'].includes(key) && value != null));
    return Object.keys(extras).length ? `${item.text}\n\n${messageDetails('Message context', extras)}` : item.text;
  }
  if (item.type === 'userMessage' && Array.isArray(item.content)) {
    const parts = item.content.map((part: unknown) => {
      if (!object(part) || part.type !== 'text' || typeof part.text !== 'string') return messageDetails('User context', part);
      const text = part.text.replace(/\r\n?/g, '\n').split('\n').map(line => line ? `> ${line}` : '>').join('\n');
      const extras = Object.fromEntries(Object.entries(part).filter(([key, value]) => key !== 'type' && key !== 'text'
        && value != null && !(key === 'text_elements' && Array.isArray(value) && value.length === 0)));
      return Object.keys(extras).length ? `${text}\n\n${messageDetails('User context', extras)}` : text;
    });
    const extras = Object.fromEntries(Object.entries(item).filter(([key, value]) =>
      !['id', 'type', 'content'].includes(key) && value != null));
    if (Object.keys(extras).length) parts.push(messageDetails('Message context', extras));
    return parts.join('\n\n');
  }
  const label = typeof item.type === 'string' ? item.type.replace(/[<>&]/g, '') : 'Item';
  return messageDetails(label, item);
}

/** The complete loaded history is used; unrecognised structured items remain visible as JSON. */
export function sidebarConversationMarkdown(thread: ThreadSummary): string {
  const title = (thread.name || 'Conversation').replace(/\s+/g, ' ').trim().replaceAll('#', '\\#');
  const parts = [`# ${title || 'Conversation'}`];
  for (const turn of thread.turns) {
    if (turn.itemsView !== 'full' || !Array.isArray(turn.items)) throw new Error('Conversation history is incomplete.');
    for (const item of turn.items) {
      if (!object(item) || typeof item.id !== 'string' || typeof item.type !== 'string') throw new Error('Conversation history contains an invalid item.');
      const content = markdownItem(item as ThreadItemSummary);
      if (content?.trim()) parts.push(content);
    }
  }
  return parts.join('\n\n').trimEnd() + '\n';
}

export function createSidebarActionService(options: SidebarActionServiceOptions) {
  const clipboard = options.writeClipboard ?? copyText;
  const availableThreadActions = (row: ThreadListRow): readonly SidebarThreadAction[] => [
    'rename', 'fork', 'copy', 'copy-markdown', 'copy-working-directory', row.archived ? 'restore' : 'archive',
    ...(options.canDeleteThread?.(row) ? ['delete' as const] : []),
  ];
  const availableProjectActions = (_project: Project): readonly SidebarProjectAction[] => [
    'archive-chats', 'remove', ...(options.openProjectDirectory ? ['open-in-file-manager' as const] : []),
  ];
  const notify = async (result: SidebarActionCommit, authority: SidebarAuthority) => {
    try { authorityCheck(authority); await options.onCommitted(result, authority); }
    catch (cause) { throw new SidebarCommittedActionError(result, cause); }
  };
  const onThreadAction = async (original: ThreadListRow, action: SidebarThreadAction, authority: SidebarAuthority): Promise<void> => {
    const row = Object.freeze(structuredClone(original));
    if (!row.hostId || !row.id) throw new Error('The original conversation identity is unavailable.');
    authorityCheck(authority);
    if (!availableThreadActions(row).includes(action)) throw new Error('This conversation action is unavailable on the current host.');
    const client = guardedClient(options.client, row.hostId, authority);
    if (action === 'copy') {
      const query = row.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: row.hostId });
      authorityCheck(authority); await clipboard(`codex://threads/${encodeURIComponent(row.id)}${query}`, authority); return;
    }
    if (action === 'copy-working-directory') {
      const result = await client.rpc<{ thread: ThreadSummary }>('thread/read', { threadId: row.id, includeTurns: false }, row.hostId);
      if (result?.thread?.id !== row.id || typeof result.thread.cwd !== 'string' || !result.thread.cwd) throw new Error('The working directory is unavailable.');
      authorityCheck(authority); await clipboard(result.thread.cwd, authority); return;
    }
    if (action === 'copy-markdown') {
      const { thread } = await loadThread(client, row.hostId, row.id);
      if (thread.id !== row.id) throw new Error('The conversation identity changed.');
      const content = sidebarConversationMarkdown(thread);
      authorityCheck(authority); await clipboard(content, authority); return;
    }
    if (action === 'rename') {
      const name = await options.requestName(row); authorityCheck(authority);
      if (name === null) return;
      if (!name.trim()) throw new Error('A conversation name is required.');
      await client.rpc('thread/name/set', { threadId: row.id, name: name.trim() }, row.hostId);
      await notify({ type: 'rename', row }, authority); return;
    }
    if (action === 'fork') {
      const result = await client.rpc<{ thread: ThreadSummary }>('thread/fork', { threadId: row.id }, row.hostId);
      if (!result?.thread || typeof result.thread.id !== 'string' || !result.thread.id) throw new Error('The fork result could not be confirmed.');
      await notify({ type: 'fork', row, thread: result.thread }, authority); return;
    }
    if (action === 'delete') {
      const confirmed = await options.confirm({ type: 'delete-thread', row }); authorityCheck(authority);
      if (!confirmed) return;
      if (!options.canDeleteThread?.(row)) throw new Error('The original conversation can no longer be deleted.');
      await client.rpc('thread/delete', { threadId: row.id }, row.hostId);
      await notify({ type: 'delete', row }, authority); return;
    }
    if (action === 'archive' || action === 'restore') {
      await client.rpc(action === 'archive' ? 'thread/archive' : 'thread/unarchive', { threadId: row.id }, row.hostId);
      await notify({ type: action, row }, authority); return;
    }
    throw new Error('This conversation action is not handled by the action service.');
  };

  const onProjectAction = async (original: Project, action: SidebarProjectAction, authority: SidebarAuthority): Promise<void> => {
    const project = structuredClone(original);
    Object.freeze(project.rootPaths); Object.freeze(project);
    validateProject(project); authorityCheck(authority); options.assertProjectCurrent(project);
    if (!availableProjectActions(project).includes(action)) throw new Error('This project action is unavailable on the current host.');
    const check = () => options.assertProjectCurrent(project);
    const client = guardedClient(options.client, project.hostId, authority, check);
    if (action === 'open-in-file-manager') {
      authorityCheck(authority); check(); await options.openProjectDirectory!(project, authority); return;
    }
    const current = await listThreads(client, project.hostId, false);
    const archived = action === 'remove' ? await listThreads(client, project.hostId, true) : [];
    const initial = await readProjectState(client, [...current, ...archived].map(row => row.id));
    authorityCheck(authority); check(); projectInState(initial, project);
    if (action === 'archive-chats') {
      const selected = projectRows(initial, project, current);
      if (!selected.length) return;
      const confirmed = await options.confirm({ type: 'archive-project', project, rows: structuredClone(selected) });
      authorityCheck(authority); check();
      if (!confirmed) return;
      const latestRows = await listThreads(client, project.hostId, false);
      const verify = await readProjectState(client, latestRows.map(row => row.id));
      authorityCheck(authority); check(); projectInState(verify, project);
      const verified = projectRows(verify, project, latestRows).map(row => row.id);
      if (verified.length !== selected.length || selected.some(row => !verified.includes(row.id))) throw new Error('Project conversations changed; review them before retrying.');
      const completed: string[] = [];
      for (const row of selected) {
        try { await client.rpc('thread/archive', { threadId: row.id }, row.hostId); completed.push(row.id); }
        catch (cause) { throw new SidebarPartialActionError('archive-chats', completed, row.id, cause); }
      }
      await notify({ type: 'archive-chats', project, threadIds: completed }, authority); return;
    }
    if (action !== 'remove') throw new Error('This project action is not handled by the action service.');
    const assigned = project.hostId === 'local' ? initial.memberships.filter(item => item.hostId === project.hostId
      && item.assignment?.projectKind === 'local' && item.assignment.projectId === project.id).map(item => item.threadId) : [];
    const relevantUnresolved = Object.entries(initial.unresolved.assignments).some(([, value]) => object(value) && value.projectId === project.id)
      || Object.hasOwn(initial.unresolved.unreadable, 'thread-project-assignments')
      || initial.unresolved.qualified.some(value => value.hostId === project.hostId
        && ['thread-project-assignments', 'projectless-thread-ids'].includes(value.field)
        && (value.threadId === undefined || object(value.value) && value.value.projectId === project.id));
    if (relevantUnresolved) throw new Error('Some project memberships cannot be safely resolved.');
    const confirmed = await options.confirm({ type: 'remove-project', project, assignedThreadIds: [...assigned] });
    authorityCheck(authority); check();
    if (!confirmed) return;
    const observed = await readProjectState(client, [...new Set([...current, ...archived].map(row => row.id).concat(assigned))]);
    authorityCheck(authority); check(); projectInState(observed, project);
    const nowAssigned = project.hostId === 'local' ? observed.memberships.filter(item => item.hostId === project.hostId
      && item.assignment?.projectKind === 'local' && item.assignment.projectId === project.id).map(item => item.threadId) : [];
    if (nowAssigned.length !== assigned.length || assigned.some(id => !nowAssigned.includes(id))) throw new Error('Project memberships changed; review them before retrying.');
    const completed: string[] = [];
    let pendingThreadId: string | null = null;
    try {
      for (const threadId of assigned) {
        pendingThreadId = threadId;
        const expected = captureThreadProjectMembershipExpected(observed, { hostId: project.hostId, threadId }, project, null);
        await client.host('thread-projects', { operation: 'setMembership', value: { hostId: project.hostId, threadId,
          assignment: null, projectless: true, expected } });
        completed.push(threadId);
        pendingThreadId = null;
      }
      const remaining = await readProjectState(client, assigned);
      authorityCheck(authority); check(); projectInState(remaining, project);
      if (remaining.memberships.some(item => item.hostId === project.hostId && item.assignment?.projectKind === 'local'
        && item.assignment.projectId === project.id)
        || Object.entries(remaining.unresolved.assignments).some(([, value]) => object(value) && value.projectId === project.id)
        || Object.hasOwn(remaining.unresolved.unreadable, 'thread-project-assignments')
        || remaining.unresolved.qualified.some(value => value.hostId === project.hostId
          && ['thread-project-assignments', 'projectless-thread-ids'].includes(value.field)
          && (value.threadId === undefined || object(value.value) && value.value.projectId === project.id))) {
        throw new Error('Project memberships changed during removal.');
      }
      const key = project.hostId === 'local' ? 'local-projects' : 'remote-projects';
      const before = await client.host<unknown>('get-global-state', { key });
      if (!object(before) || before.exists !== true) throw new Error('The project catalog is unavailable.');
      const { next, removed } = matchingCatalogEntry(before.value, project);
      await client.host('set-global-state', { key, value: next, expected: before });
      await notify({ type: 'remove-project', project, removedRecord: removed, detachedThreadIds: completed }, authority);
    } catch (cause) {
      if (cause instanceof SidebarCommittedActionError) throw cause;
      if (completed.length) throw new SidebarPartialActionError('remove-project', completed, pendingThreadId, cause);
      throw cause;
    }
  };
  return { availableThreadActions, onThreadAction, availableProjectActions, onProjectAction };
}
