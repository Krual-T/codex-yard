import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import type { StateMutations } from './state-mutations.ts';

/** Read, merge and durably add one project in the native-state commit interval. */
export function createProjectCatalogWrites(globals: ObjectValue, mutations: StateMutations,
  persist: () => Promise<void>, publish: (event: unknown) => void) {
  return (hostId: string, path: unknown, label: unknown) => mutations.run(async () => {
    if (typeof path !== 'string' || !posix.isAbsolute(path) || path.includes('\0')
      || typeof label !== 'string' || !label.trim()) throw new Error('项目需要绝对目录及名称。');
    const key = hostId === 'local' ? 'local-projects' : 'remote-projects';
    const existed = Object.hasOwn(globals, key), previous = globals[key];
    if (previous !== undefined && (hostId === 'local'
      ? previous === null || typeof previous !== 'object' || Array.isArray(previous) : !Array.isArray(previous))) {
      throw new Error('项目目录格式无效，原值已保留。');
    }
    const existing = record(previous)[path];
    if (hostId === 'local' && existing !== undefined && (existing === null || typeof existing !== 'object'
      || Array.isArray(existing) || record(existing).rootPaths !== undefined
        && (!Array.isArray(record(existing).rootPaths) || (record(existing).rootPaths as unknown[]).some(root => typeof root !== 'string')))) {
      throw new Error('既有项目格式无效，原值已保留。');
    }
    const old = record(existing);
    const project = hostId === 'local'
      ? { ...old, id: typeof old.id === 'string' ? old.id : path, name: label, rootPaths: old.rootPaths ?? [path] }
      : { id: randomUUID(), hostId, label, remotePath: path };
    globals[key] = hostId === 'local' ? { ...record(previous), [path]: project } : [...previous as unknown[] ?? [], project];
    try { await persist(); }
    catch (error) { if (existed) globals[key] = previous; else delete globals[key]; throw error; }
    publish({ type: 'global-state-updated', keys: [key] });
    return { project };
  });
}
