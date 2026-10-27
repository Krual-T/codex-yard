import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

export type ProjectAssignment =
  | { projectKind: 'local'; projectId: string; projectOrigin?: 'chatgpt' }
  | { projectKind: 'remote'; projectId: string; hostId?: string };
export interface ThreadMembership { assignment: ProjectAssignment | null; projectless: boolean }
export interface MembershipUpdate extends Partial<ThreadMembership> { threadId: string; hostId?: string }
export type AssignmentRequest = Pick<MembershipUpdate, 'threadId' | 'hostId'> & Pick<ThreadMembership, 'assignment'>;
export type ProjectlessRequest = Pick<MembershipUpdate, 'threadId'> & Pick<ThreadMembership, 'projectless'>;
export type MembershipRequest = Pick<MembershipUpdate, 'threadId' | 'hostId'> & ThreadMembership;
export interface ProjectlessThreadUpdate extends Pick<MembershipUpdate, 'threadId' | 'projectless'> {
  outputDirectory?: string | null;
  workspaceRoot?: string | null;
}
export type ThreadProjectOperation = 'setAssignment' | 'setProjectless' | 'setMembership' | 'restoreMemberships'
  | 'assignIfUnassigned' | 'moveLocalProjectThreadsToProjectless' | 'reset' | 'flush'
  | 'getThreadStartProjectId' | 'updateProjectlessThread';

const assignmentKey = 'thread-project-assignments';
const projectlessKey = 'projectless-thread-ids';
const outputKey = 'thread-projectless-output-directories';
const workspaceKey = 'thread-workspace-root-hints';

function assignment(value: unknown): ProjectAssignment | null {
  if (value === null) return null;
  const item = record(value);
  if (typeof item.projectId !== 'string') throw new Error('需要项目 ID');
  if (item.projectKind === 'local' && (item.projectOrigin === undefined || item.projectOrigin === 'chatgpt')) {
    return { projectKind: 'local', projectId: item.projectId, ...(item.projectOrigin ? { projectOrigin: item.projectOrigin } : {}) };
  }
  if (item.projectKind === 'remote' && (item.hostId === undefined || typeof item.hostId === 'string')) {
    return { projectKind: 'remote', projectId: item.projectId, ...(typeof item.hostId === 'string' ? { hostId: item.hostId } : {}) };
  }
  throw new Error('无效的项目归属');
}

function update(value: unknown, requireAssignment: boolean, requireProjectless: boolean, validHost: (hostId: string) => void): MembershipUpdate {
  const item = record(value);
  if (typeof item.threadId !== 'string' || !item.threadId.trim()) throw new Error('需要会话 ID');
  if (item.hostId !== undefined && typeof item.hostId !== 'string') throw new Error('需要执行主机 ID');
  const hostId = typeof item.hostId === 'string' ? item.hostId : 'local';
  validHost(hostId);
  const result: MembershipUpdate = { threadId: item.threadId, hostId };
  if (requireAssignment) {
    result.assignment = assignment(item.assignment);
    if (result.assignment?.projectKind === 'remote') {
      const target = result.assignment.hostId ?? (hostId !== 'local' ? hostId : undefined);
      if (target) {
        validHost(target);
        if (item.hostId !== undefined && hostId !== target) throw new Error('项目与会话执行主机不一致');
        result.assignment.hostId = target;
      }
    }
  }
  if (requireProjectless) {
    if (typeof item.projectless !== 'boolean') throw new Error('需要 projectless 状态');
    result.projectless = item.projectless;
  }
  return result;
}

function sameAssignment(left: unknown, right: ProjectAssignment | null) {
  const a = record(left), b = record(right);
  return a.projectKind === b.projectKind && a.projectId === b.projectId && a.projectOrigin === b.projectOrigin && a.hostId === b.hostId;
}

// Replaces the native thread-project service at its RPC boundary. Project
// assignment and projectless status are independent fields in that contract.
export function createThreadProjects(globals: ObjectValue, persist: () => Promise<void>, publish: (message: unknown) => void,
  validHost: (hostId: string) => void = hostId => { if (hostId !== 'local') throw new Error('当前仅支持本机'); }) {
  let pending = Promise.resolve<unknown>(undefined);
  const removedProjectlessThreads = new Set<string>();

  function enqueue(action: () => Promise<unknown>) {
    const result = pending.catch(() => {}).then(action);
    pending = result;
    return result;
  }

  async function commit(values: ObjectValue, memberships: Record<string, ThreadMembership>) {
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

  async function apply(updates: MembershipUpdate[], onlyUnassigned = false, extra: ObjectValue = {}) {
    const assignments = { ...record(globals[assignmentKey]) };
    const projectless = new Set(Array.isArray(globals[projectlessKey]) ? globals[projectlessKey] as string[] : []);
    const before = new Map<string, ThreadMembership>();
    for (const item of updates) {
      const current = { assignment: (assignments[item.threadId] as ProjectAssignment | undefined) ?? null, projectless: projectless.has(item.threadId) };
      if (onlyUnassigned && (current.assignment !== null || current.projectless)) continue;
      if (!before.has(item.threadId)) before.set(item.threadId, current);
      if (item.assignment !== undefined) {
        if (item.assignment === null) delete assignments[item.threadId]; else assignments[item.threadId] = item.assignment;
      }
      if (item.projectless !== undefined) {
        if (item.projectless) projectless.add(item.threadId); else projectless.delete(item.threadId);
      }
    }
    const memberships: Record<string, ThreadMembership> = {};
    let assignmentsChanged = false, projectlessChanged = false;
    for (const [threadId, previous] of before) {
      const current = { assignment: (assignments[threadId] as ProjectAssignment | undefined) ?? null, projectless: projectless.has(threadId) };
      const a = !sameAssignment(previous.assignment, current.assignment), p = previous.projectless !== current.projectless;
      assignmentsChanged ||= a; projectlessChanged ||= p;
      if (a || p) memberships[threadId] = current;
    }
    const values: ObjectValue = { ...extra };
    if (assignmentsChanged) values[assignmentKey] = assignments;
    if (projectlessChanged) values[projectlessKey] = [...projectless];
    if (Object.keys(values).length) await commit(values, memberships);
    return Object.keys(memberships).map(threadId => ({ threadId, ...before.get(threadId)! }));
  }

  return async function request(operation: ThreadProjectOperation, value: unknown): Promise<unknown> {
    switch (operation) {
      case 'setAssignment': {
        const item = update(value, true, false, validHost);
        return enqueue(async () => { await apply([item]); });
      }
      case 'setProjectless': {
        const item = update(value, false, true, validHost);
        return enqueue(async () => { await apply([item]); });
      }
      case 'setMembership': {
        const item = update(value, true, true, validHost);
        return enqueue(async () => { await apply([item]); });
      }
      case 'restoreMemberships':
      case 'assignIfUnassigned': {
        if (!Array.isArray(value)) throw new Error('需要项目归属列表');
        const items = value.map(item => update(item, true, true, validHost));
        return enqueue(async () => { await apply(items, operation === 'assignIfUnassigned'); });
      }
      case 'moveLocalProjectThreadsToProjectless': {
        if (typeof value !== 'string' || !value) throw new Error('需要项目 ID');
        return enqueue(() => apply(Object.entries(record(globals[assignmentKey])).flatMap(([threadId, item]) =>
          record(item).projectKind === 'local' && record(item).projectId === value ? [{ threadId, assignment: null, projectless: true }] : [])));
      }
      case 'reset': return enqueue(async () => {
        const ids = new Set([...Object.keys(record(globals[assignmentKey])), ...(Array.isArray(globals[projectlessKey]) ? globals[projectlessKey] as string[] : [])]);
        await apply([...ids].map(threadId => ({ threadId, assignment: null, projectless: false })));
      });
      case 'flush': await pending.catch(() => {}); return;
      case 'getThreadStartProjectId': assignment(value); return null; // No cloud project mapping in the local Web host.
      case 'updateProjectlessThread': {
        const params = record(value), item = update(value, false, params.projectless !== undefined, validHost);
        for (const key of ['outputDirectory', 'workspaceRoot']) {
          if (params[key] !== undefined && params[key] !== null && typeof params[key] !== 'string') throw new Error('无效的工作目录');
        }
        return enqueue(async () => {
          const removing = item.projectless === false && params.outputDirectory == null;
          if (!removing && removedProjectlessThreads.has(item.threadId)) return;
          const extra: ObjectValue = {};
          for (const [field, key] of [['outputDirectory', outputKey], ['workspaceRoot', workspaceKey]] as const) {
            if (params[field] === undefined && !(removing && field === 'workspaceRoot')) continue;
            const hints = { ...record(globals[key]) };
            if (params[field] == null) delete hints[item.threadId]; else hints[item.threadId] = params[field];
            extra[key] = hints;
          }
          await apply([item], false, extra);
          if (removing) removedProjectlessThreads.add(item.threadId);
        });
      }
      default: throw new Error('未知的项目归属操作：' + operation);
    }
  };
}
