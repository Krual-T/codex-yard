import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import type { ThreadReadState } from '../../lib/codex-protocol.ts';
import { comparePriorityThreads } from './thread-priority.ts';
import type { PriorityThread } from './thread-priority.ts';
import { readProjectAppearance, type ProjectAppearance } from './project-appearance.ts';

export interface StartupThread { id: string; title: string; projectId: string | null; active?: true }
export interface StartupProject { id: string; label: string; pinned?: true; appearance?: ProjectAppearance }
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
  const projects: StartupProject[] = projectRoots.map(({ id, label }) => {
    const appearance = readProjectAppearance(appearances[id]);
    return { id, label, ...(pinnedProjects.has(id) ? { pinned: true } : {}), ...(appearance ? { appearance } : {}) };
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
          ...(record(thread.status).type === 'active' ? { active: true } as const : {}) };
      }),
  };
}
