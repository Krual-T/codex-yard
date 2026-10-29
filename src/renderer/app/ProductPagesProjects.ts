import type { WorkbenchClient } from '../workbench-contract.ts';
import type { ProjectChat, ProjectEntry, ProjectPage } from '../pages/projects/catalog.ts';
import { projectForThread, projectsForHost } from './projects.ts';
import type { Project, ProjectState } from './projects.ts';
import { readProductBridge } from './ProductPagesBridge.ts';

type Request = { hostId: string; query: string; cursor: string | null; signal: AbortSignal };
type Thread = { id: string; name: string | null; cwd: string; preview?: string | null; updatedAt?: number | null };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const ensure = (current: () => boolean, signal?: AbortSignal) => {
  if (!current() || signal?.aborted) throw new DOMException('The selected page changed.', 'AbortError');
};

async function projectState(client: WorkbenchClient, current: () => boolean, signal?: AbortSignal): Promise<ProjectState> {
  ensure(current, signal);
  const state = await client.host<ProjectState>('thread-project-state');
  ensure(current, signal);
  if (!object(state) || !object(state.catalog) || !object(state.inventory) || !object(state.inventory.errors) ||
    typeof state.inventory.complete !== 'boolean' || !Array.isArray(state.memberships) || !object(state.unresolved) ||
    !object(state.unresolved.assignments) || !Array.isArray(state.unresolved.projectless) || !Array.isArray(state.unresolved.qualified)) {
    throw new Error('Invalid project state.');
  }
  return state;
}

function entry(project: Project, canCompose: boolean): ProjectEntry {
  return { id: project.id, kind: project.hostId === 'local' ? 'local' : 'remote', hostId: project.hostId,
    name: project.name, location: project.rootPaths[0] ?? null, updatedAt: null, pinned: null,
    canEdit: false, canRemove: false, canArchive: false, canCreateChat: canCompose && project.rootPaths.length > 0 };
}

async function threads(client: WorkbenchClient, request: Request, current: () => boolean): Promise<{ items: Thread[]; nextCursor: string | null }> {
  ensure(current, request.signal);
  const page = await client.rpc<{ data?: unknown; nextCursor?: unknown }>('thread/list',
    { limit: 100, cursor: request.cursor, sortKey: 'updated_at', archived: false }, request.hostId);
  ensure(current, request.signal);
  if (!page || !Array.isArray(page.data) || page.nextCursor != null && typeof page.nextCursor !== 'string') throw new Error('Invalid conversation list.');
  const items = page.data.map(value => {
    if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.cwd !== 'string' ||
      value.name != null && typeof value.name !== 'string' || value.preview != null && typeof value.preview !== 'string' ||
      value.updatedAt != null && (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt))) throw new Error('Invalid conversation.');
    return value as Thread;
  });
  return { items, nextCursor: typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null };
}

const matches = (values: (string | null | undefined)[], query: string) => !query || values.some(value => value?.toLocaleLowerCase().includes(query));
const warnings = (state: ProjectState, hostId: string) => {
  const result: ProjectPage<ProjectEntry>['warnings'] = [];
  if (!state.inventory.complete) result.push({ source: 'Projects', message: state.inventory.errors[hostId] || 'Some project memberships could not be verified.' });
  return result;
};

export function productProjectReaders(client: WorkbenchClient, current: () => boolean, cloudAccess: 'allowed' | 'denied' | 'unknown', canCompose: boolean) {
  async function findProject(value: ProjectEntry): Promise<Project> {
    const state = await projectState(client, current);
    const project = projectsForHost(state, value.hostId).find(item => item.id === value.id);
    if (!project || (project.rootPaths[0] ?? null) !== value.location || value.kind !== (value.hostId === 'local' ? 'local' : 'remote')) {
      throw new Error('The selected project has changed.');
    }
    return project;
  }
  return {
    findProject,
    async list(request: Request): Promise<ProjectPage<ProjectEntry>> {
      if (request.cursor !== null) throw new Error('Invalid project cursor.');
      const state = await projectState(client, current, request.signal);
      const projects = projectsForHost(state, request.hostId);
      const query = request.query.trim().toLocaleLowerCase();
      const selected = new Set(projects.filter(project => matches([project.name, ...project.rootPaths], query)).map(project => project.id));
      const issues = warnings(state, request.hostId);
      if (query) {
        let cursor: string | null = null;
        const seen = new Set<string>();
        try {
          do {
            const page = await threads(client, { ...request, cursor }, current);
            for (const thread of page.items) {
              if (!matches([thread.name, thread.preview, thread.cwd], query)) continue;
              const project = projectForThread(state, projects, request.hostId, thread);
              if (project) selected.add(project.id);
            }
            cursor = page.nextCursor;
            if (cursor && seen.has(cursor)) throw new Error('Conversation pagination did not advance.');
            if (cursor) seen.add(cursor);
          } while (cursor);
        } catch (cause) {
          ensure(current, request.signal);
          issues.push({ source: 'Conversations', message: message(cause) });
        }
      }
      if (cloudAccess === 'allowed') {
        try { await readProductBridge({ kind: 'projects' }, current, request.signal); }
        catch (cause) { ensure(current, request.signal); issues.push({ source: 'ChatGPT projects', message: message(cause) }); }
      } else if (cloudAccess === 'unknown') issues.push({ source: 'ChatGPT projects', message: 'Project access has not been established.' });
      return { items: projects.filter(project => selected.has(project.id)).map(project => entry(project, canCompose)), nextCursor: null, warnings: issues };
    },
    async chats(request: Request & { project: ProjectEntry }): Promise<ProjectPage<ProjectChat>> {
      const state = await projectState(client, current, request.signal);
      const projects = projectsForHost(state, request.hostId);
      const project = projects.find(item => item.id === request.project.id && (item.rootPaths[0] ?? null) === request.project.location);
      if (!project || request.project.hostId !== request.hostId) throw new Error('The selected project has changed.');
      const page = await threads(client, request, current);
      const query = request.query.trim().toLocaleLowerCase();
      return { items: page.items.filter(thread => projectForThread(state, projects, request.hostId, thread)?.id === project.id && matches([thread.name, thread.preview, thread.cwd], query))
        .map(thread => ({ id: thread.id, hostId: request.hostId, origin: 'local' as const, title: thread.name || thread.preview || 'New chat',
          updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt * 1000 : null })), nextCursor: page.nextCursor, warnings: warnings(state, request.hostId) };
    },
  };
}
