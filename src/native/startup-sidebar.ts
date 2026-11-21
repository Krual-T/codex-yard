import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import type { ThreadReadState, ThreadResponse } from '../../lib/codex-protocol.ts';
import { comparePriorityThreads, threadRecency } from './thread-priority.ts';
import type { PriorityThread } from './thread-priority.ts';
import { readProjectAppearance, type ProjectAppearance } from './project-appearance.ts';

export interface StartupThread {
  id: string; title: string; projectId: string | null; active?: true; unread?: true; recencyAt?: number;
  attention?: 'approval' | 'input';
}
export interface StartupProject { id: string; label: string; pinned?: true; appearance?: ProjectAppearance; threadOrder?: string[] }
export interface SidebarProjectDetails { roots: string[]; count: number; active: number; partial: boolean }
export interface StartupHost { hostId: string; displayName: string; autoConnect: boolean }
export type StartupProjectSelection = { type: 'local'; projectId: string } | { type: 'unavailable' };
export interface StartupSidebar {
  threads: StartupThread[];
  projects: StartupProject[];
  pinnedIds: string[];
  selectedProjectId: string | null;
  locale: string;
  selectedProject?: StartupProjectSelection | null;
  nextCursor?: string | null;
}

/** Re-sort all loaded pages using the same backend-derived priority as startup. */
export function compareStartupThreads(a: StartupThread, b: StartupThread) {
  const priority = (thread: StartupThread) => thread.active ? 1 : thread.unread ? 0 : 2;
  return priority(a) - priority(b) || (b.recencyAt ?? 0) - (a.recencyAt ?? 0);
}

/** Preserve the existing order and preview; important rows do not consume or
 * reset the user's history expansion. IDs are scoped to one execution host. */
export function visibleSidebarThreads(threads: readonly StartupThread[], limit: number,
  selectedId?: string, pendingIds?: ReadonlySet<string>) {
  const seen = new Set<string>();
  let hidden = 0;
  const rows = threads.filter(thread => {
    if (seen.has(thread.id)) return false;
    const inPreview = seen.size < limit;
    seen.add(thread.id);
    if (inPreview || thread.active || thread.unread || thread.attention ||
        thread.id === selectedId || pendingIds?.has(thread.id)) return true;
    hidden++;
    return false;
  });
  return { rows, hidden };
}

export function sidebarActivity(threads: readonly StartupThread[], pendingIds?: ReadonlySet<string>) {
  let working = 0, attention = 0, unread = 0;
  const seen = new Set<string>();
  for (const thread of threads) {
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    if (thread.active) working++;
    if (thread.attention || pendingIds?.has(thread.id)) attention++;
    if (!thread.active && thread.unread) unread++;
  }
  return [working ? `${working} working` : '', attention ? `${attention} need attention` : '', unread ? `${unread} unread` : '']
    .filter(Boolean).join(' · ');
}

function startupThreadActivity(value: unknown): Pick<StartupThread, 'active' | 'attention'> {
  const status = record(value);
  if (status.type !== 'active') return {};
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
  return { active: true, ...(flags.includes('waitingOnApproval') ? { attention: 'approval' as const }
    : flags.includes('waitingOnUserInput') ? { attention: 'input' as const } : {}) };
}

/** A single metadata read confirms activity and its read receipt together.
 * Membership and eligibility still come from the ordinary sidebar listing. */
export function reconcileSidebarThread(row: StartupThread, result: ThreadResponse): StartupThread {
  if (result.thread.id !== row.id) return row;
  const { active: _active, attention: _attention, ...rest } = row;
  return { ...rest, ...startupThreadActivity(result.thread.status),
    ...(result.readState ? { unread: result.readState.firstUnread != null ? true : undefined } : {}),
    recencyAt: threadRecency(result.thread) || row.recencyAt };
}

export function startupProjectSelection(value: unknown): StartupProjectSelection | null {
  if (value == null) return null;
  const { type, projectId } = record(value);
  return type === 'local' && typeof projectId === 'string' && projectId !== ''
    ? { type, projectId } : { type: 'unavailable' };
}

export function sidebarProjectRoots(globals: ObjectValue, hostId: string) {
  const local = hostId === 'local';
  return local ? Object.entries(record(globals['local-projects'])).map(([id, value]) => {
    const project = record(value);
    const paths = Array.isArray(project.rootPaths) ? project.rootPaths.filter((path): path is string => typeof path === 'string') : [id];
    return { id, paths, label: String(project.displayName ?? project.name ?? id.split('/').filter(Boolean).at(-1) ?? id) };
  }) : (Array.isArray(globals['remote-projects']) ? globals['remote-projects'] : []).flatMap(value => {
    const { id, hostId: owner, label, remotePath } = record(value);
    return owner === hostId && typeof id === 'string' && typeof remotePath === 'string'
      ? [{ id, paths: Array.isArray(record(value).rootPaths) ? (record(value).rootPaths as unknown[]).filter((path): path is string => typeof path === 'string') : [remotePath],
        label: typeof label === 'string' ? label : remotePath }] : [];
  });
}

export function sidebarThreadProject(globals: ObjectValue, hostId: string, projects = sidebarProjectRoots(globals, hostId)) {
  const local = hostId === 'local';
  const assignments = record(globals['thread-project-assignments']);
  const projectless = new Set(local && Array.isArray(globals['projectless-thread-ids']) ? globals['projectless-thread-ids'] as string[] : []);
  const availableProjects = new Set(projects.map(project => project.id));
  const roots = projects.flatMap(project => project.paths.map(path => ({ id: project.id, path })))
    .sort((a, b) => b.path.length - a.path.length);
  return (thread: ObjectValue) => {
    const id = String(thread.id), assignment = record(assignments[id]);
    const cwd = typeof thread.cwd === 'string' ? thread.cwd : '';
    const assigned = assignment.projectKind === (local ? 'local' : 'remote') && typeof assignment.projectId === 'string' &&
      (local || (assignment.hostId == null || assignment.hostId === hostId) && availableProjects.has(assignment.projectId));
    return projectless.has(id) ? null : assigned ? String(assignment.projectId)
      : typeof thread.projectId === 'string' && availableProjects.has(thread.projectId) ? thread.projectId
      : roots.find(root => cwd === root.path || cwd.startsWith(root.path.replace(/\/$/, '') + '/'))?.id ?? null;
  };
}

/** Only the bounded metadata needed to choose a conversation leaves the host. */
export function startupSidebar(threads: ObjectValue[], globals: ObjectValue, receipts: Record<string, ThreadReadState> = {},
  hostId = 'local', hostPins?: string[], locale = 'zh-CN'): StartupSidebar {
  const local = hostId === 'local';
  const projectRoots = sidebarProjectRoots(globals, hostId);
  const pinnedProjects = new Set(Array.isArray(globals['pinned-project-ids']) ? globals['pinned-project-ids'] : []);
  const appearances = record(globals['project-appearances']);
  const orders = record(globals['sidebar-project-thread-orders']);
  const projects: StartupProject[] = projectRoots.map(({ id, label }) => {
    const appearance = readProjectAppearance(appearances[id]);
    const order = record(orders[id]).threadIds;
    return { id, label, ...(pinnedProjects.has(id) ? { pinned: true } : {}), ...(appearance ? { appearance } : {}),
      ...(Array.isArray(order) ? { threadOrder: order.filter((id): id is string => typeof id === 'string') } : {}) };
  });
  const selected = record(globals['selected-project']);
  const projectFor = sidebarThreadProject(globals, hostId, projectRoots);
  return {
    projects,
    locale,
    selectedProjectId: local && selected.type === 'local' && projects.some(project => project.id === selected.projectId)
      ? String(selected.projectId) : null,
    pinnedIds: hostPins ?? (local && Array.isArray(globals['pinned-thread-ids'])
      ? globals['pinned-thread-ids'].filter((id): id is string => typeof id === 'string') : []),
    threads: threads.filter(thread => typeof thread.id === 'string' && thread.ephemeral !== true && thread.threadSource !== 'ambient_suggestions')
      .slice(0, 50).sort((a, b) => comparePriorityThreads(a as unknown as PriorityThread, b as unknown as PriorityThread, receipts)).map(thread => {
        const id = String(thread.id), projectId = projectFor(thread);
        const name = typeof thread.name === 'string' ? thread.name.trim() : '';
        const preview = typeof thread.preview === 'string' ? thread.preview.trim().split('\n')[0] : '';
        return { id, title: (name || preview || '新对话').slice(0, 240), projectId,
          ...(receipts[id]?.firstUnread != null ? { unread: true } as const : {}),
          ...(threadRecency(thread as unknown as PriorityThread) ? { recencyAt: threadRecency(thread as unknown as PriorityThread) } : {}),
          ...startupThreadActivity(thread.status) };
      }),
  };
}
