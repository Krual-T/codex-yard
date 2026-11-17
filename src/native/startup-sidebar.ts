import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

export interface StartupThread { id: string; title: string; projectId: string | null }
export interface StartupProject { id: string; label: string }
export interface StartupSidebar {
  threads: StartupThread[];
  projects: StartupProject[];
  pinnedIds: string[];
}

/** Only the bounded metadata needed to choose a conversation leaves the host. */
export function startupSidebar(threads: ObjectValue[], globals: ObjectValue): StartupSidebar {
  const projectRoots = Object.entries(record(globals['local-projects'])).map(([id, value]) => {
    const project = record(value);
    const paths = Array.isArray(project.rootPaths) ? project.rootPaths.filter((path): path is string => typeof path === 'string') : [id];
    return { id, paths, label: String(project.displayName ?? project.name ?? id.split('/').filter(Boolean).at(-1) ?? id) };
  });
  const projects = projectRoots.map(({ id, label }) => ({ id, label }));
  const assignments = record(globals['thread-project-assignments']);
  const projectless = new Set(Array.isArray(globals['projectless-thread-ids']) ? globals['projectless-thread-ids'] as string[] : []);
  const roots = projectRoots.flatMap(project => project.paths.map(path => ({ id: project.id, path })))
    .sort((a, b) => b.path.length - a.path.length);
  return {
    projects,
    pinnedIds: Array.isArray(globals['pinned-thread-ids']) ? globals['pinned-thread-ids'].filter((id): id is string => typeof id === 'string') : [],
    threads: threads.filter(thread => typeof thread.id === 'string' && thread.ephemeral !== true && thread.threadSource !== 'ambient_suggestions')
      .slice(0, 50).map(thread => {
        const id = String(thread.id), assignment = record(assignments[id]);
        const cwd = typeof thread.cwd === 'string' ? thread.cwd : '';
        const projectId = projectless.has(id) ? null : assignment.projectKind === 'local' && typeof assignment.projectId === 'string'
          ? assignment.projectId : roots.find(root => cwd === root.path || cwd.startsWith(root.path.replace(/\/$/, '') + '/'))?.id ?? null;
        const name = typeof thread.name === 'string' ? thread.name.trim() : '';
        const preview = typeof thread.preview === 'string' ? thread.preview.trim().split('\n')[0] : '';
        return { id, title: (name || preview || '新对话').slice(0, 240), projectId };
      }),
  };
}
