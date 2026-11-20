import { record } from './protocol.ts';

type RequestHost = (endpoint: string, body: unknown) => Promise<unknown>;
interface LocalProjectInput { projectId: string; name: string; sources: string[] }

// Adapt the renderer's project service to the existing backend-owned catalog
// and membership contracts, just as ThreadProjects and PinnedThreads do.
export function projectService(Base: new () => object, request: RequestHost) {
  const read = async (key: string) => record(await request('get-global-state', { key })).value;
  const write = (key: string, value: unknown) => request('set-global-state', { key, value });
  const membership = (operation: string, value: unknown) => request('thread-projects', { operation, value });
  async function localProjectId(projectId: string) {
    const aliases = record(record(await read('app-server-project-id-by-legacy-project-id-by-host')).local);
    return typeof aliases[projectId] === 'string' ? aliases[projectId] as string : projectId;
  }

  return new class Projects extends Base {
    async removeLocal(projectId: string) {
      const id = await localProjectId(projectId), projects = record(await read('local-projects'));
      if (!Object.hasOwn(projects, id)) throw new Error('项目不存在：' + projectId);
      const previousMemberships = await membership('moveLocalProjectThreadsToProjectless', projectId);
      try {
        delete projects[id];
        await write('local-projects', projects);
      } catch (error) {
        try { await membership('restoreMemberships', previousMemberships); }
        catch (rollback) { throw new AggregateError([error, rollback], '项目移除失败，恢复会话归属时也遇到了错误'); }
        throw error;
      }
      return { previousMemberships };
    }
    async upsertLocal(value: LocalProjectInput) {
      const id = await localProjectId(value.projectId), projects = record(await read('local-projects')), previous = record(projects[id]);
      await write('local-projects', { ...projects, [id]: {
        ...previous, id, name: value.name, rootPaths: value.sources,
        createdAt: previous.createdAt ?? Date.now(), updatedAt: Date.now(),
      } });
      return true;
    }
    async editLocal(value: LocalProjectInput) { return this.upsertLocal(value); }
    async renameLocal(value: { projectId: string; name: string }) {
      const id = await localProjectId(value.projectId), projects = record(await read('local-projects'));
      if (!Object.hasOwn(projects, id)) throw new Error('项目不存在：' + value.projectId);
      await write('local-projects', { ...projects, [id]: { ...record(projects[id]), name: value.name } });
    }
    setProjectOrder(ids: string[]) { return write('project-order', ids); }
    // This host does not probe desktop-specific drive ACL capabilities.
    async getProjectStorageCapabilities(_path: string) { return {}; }
  }();
}
