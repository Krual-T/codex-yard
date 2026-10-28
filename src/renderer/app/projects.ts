import type { ThreadProjectSnapshot } from '../../native/thread-projects.ts';

export interface Project { id: string; name: string; rootPaths: string[]; hostId: string }
export interface ProjectState extends ThreadProjectSnapshot {
  inventory: { complete: boolean; errors: Record<string, string> };
  catalog: { local: unknown; remote: unknown };
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
export function projectsForHost(state: ProjectState, hostId: string): Project[] {
  if (hostId !== 'local') return (Array.isArray(state.catalog.remote) ? state.catalog.remote : []).flatMap(value => {
    const project = record(value);
    return project.hostId === hostId && typeof project.id === 'string' && typeof project.remotePath === 'string'
      ? [{ id: project.id, name: typeof project.label === 'string' ? project.label : project.remotePath, rootPaths: [project.remotePath], hostId }] : [];
  });
  return Object.values(record(state.catalog.local)).flatMap(value => {
    const project = record(value);
    return typeof project.id === 'string' && Array.isArray(project.rootPaths) && project.rootPaths.every(path => typeof path === 'string')
      ? [{ id: project.id, name: typeof project.name === 'string' ? project.name : project.id, rootPaths: project.rootPaths as string[], hostId }] : [];
  });
}
/** Qualified assignments override cwd. Bare unresolved IDs never become local assignments. */
export function projectForThread(state: ProjectState | null, projects: Project[], hostId: string, thread: { id: string; cwd?: string | null }): Project | null {
  const membership = state?.memberships.find(value => value.hostId === hostId && value.threadId === thread.id);
  if (membership?.projectless) return null;
  if (membership?.assignment) {
    const assignment = membership.assignment;
    return projects.find(project => project.hostId === hostId && project.id === assignment.projectId
      && (assignment.projectKind === 'local' ? hostId === 'local' : hostId !== 'local' && (!assignment.hostId || assignment.hostId === hostId))) ?? null;
  }
  if (membership || state && (Object.hasOwn(state.unresolved.assignments, thread.id) || state.unresolved.projectless.includes(thread.id)
    || state.unresolved.qualified.some(value => value.threadId === thread.id && value.hostId === hostId))) return null;
  return projects.find(project => project.hostId === hostId && project.rootPaths.includes(thread.cwd ?? '')) ?? null;
}
