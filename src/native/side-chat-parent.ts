import { posix, win32 } from 'node:path';
import type { SideChatParent } from './side-chat.ts';

type Value = Record<string, unknown>;

export interface SideChatParentIdentity {
  hostId: string;
  threadId: string;
  connectionGeneration: string;
}

/** Values captured by the host from the original connection and verified host state. */
export interface SideChatParentSnapshot extends SideChatParentIdentity {
  revision: string;
  response: unknown;
  project: unknown;
  forkConfig?: Value;
  developerOverride?: { value: string; source: string };
  archive?: { archived: boolean; source: 'directory' | 'notification' };
}

export interface SideChatParentPort {
  /** Uses the existing shared state interval; callbacks must not reacquire it. */
  runScoped<T>(run: () => T | Promise<T>): Promise<T>;
  /** Called inside runScoped; its response and host-owned fields must have trusted provenance. */
  capture(): SideChatParentSnapshot;
  /** Reject a changed host, thread, socket/generation or captured authority revision. */
  assertCurrent(revision: string): void;
  /** Invoke the original connection inside runScoped; never connect or reconnect here. */
  request(method: 'thread/list', params: Value): Promise<unknown>;
}

const sourceKinds = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact',
  'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const object = (value: unknown): value is Value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const absolute = (value: unknown): value is string => nonempty(value) && (posix.isAbsolute(value) || win32.isAbsolute(value));
const has = (value: Value, key: string) => Object.hasOwn(value, key);
const invalid = (detail: string): never => { throw new Error(`无法确认侧聊父会话的${detail}。`); };

function sameIdentity(value: SideChatParentIdentity, identity: SideChatParentIdentity): boolean {
  return value.hostId === identity.hostId && value.threadId === identity.threadId
    && value.connectionGeneration === identity.connectionGeneration;
}

function rootsFrom(response: Value, thread: Value, cwd: string): string[] {
  let roots: unknown;
  if (has(response, 'runtimeWorkspaceRoots')) roots = response.runtimeWorkspaceRoots;
  else {
    const environments = thread.environments;
    if (!Array.isArray(environments) || environments.length !== 1 || !object(environments[0])
      || environments[0].cwd !== cwd || !has(environments[0], 'runtimeWorkspaceRoots')) return invalid('工作区根目录');
    roots = environments[0].runtimeWorkspaceRoots;
  }
  if (!Array.isArray(roots) || roots.some(root => !absolute(root))) return invalid('工作区根目录');
  return [...roots] as string[];
}

function approval(value: unknown): unknown {
  if (value === 'untrusted' || value === 'on-request' || value === 'never') return value;
  if (object(value) && object(value.granular)
    && ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations']
      .every(key => typeof (value.granular as Value)[key] === 'boolean')) return value;
  return invalid('审批策略');
}

function sandbox(value: unknown): Value {
  if (!object(value) || !nonempty(value.type)) return invalid('沙箱策略');
  if (value.type === 'readOnly' && typeof value.networkAccess !== 'boolean') return invalid('沙箱策略');
  if (value.type === 'workspaceWrite' && (!Array.isArray(value.writableRoots) || value.writableRoots.some(root => !absolute(root))
    || typeof value.networkAccess !== 'boolean' || typeof value.excludeTmpdirEnvVar !== 'boolean'
    || typeof value.excludeSlashTmp !== 'boolean')) return invalid('沙箱策略');
  if (value.type === 'externalSandbox' && value.networkAccess !== 'restricted' && value.networkAccess !== 'enabled') {
    return invalid('沙箱策略');
  }
  return value;
}

function mapSnapshot(snapshot: SideChatParentSnapshot): Omit<SideChatParent, 'archived'> {
  const response = snapshot.response;
  if (!object(response) || !object(response.thread) || response.thread.id !== snapshot.threadId) return invalid('原始会话回执');
  if (!absolute(response.cwd)) return invalid('工作目录');
  const workspaceRoots = rootsFrom(response, response.thread, response.cwd);
  if (!nonempty(response.model) || !nonempty(response.modelProvider)) return invalid('模型及提供方');
  if (!has(response, 'reasoningEffort') || !(response.reasoningEffort === null || nonempty(response.reasoningEffort))) {
    return invalid('推理强度');
  }
  if (!has(response, 'serviceTier') || !(response.serviceTier === null || nonempty(response.serviceTier))) return invalid('服务等级');
  const approvalPolicy = approval(response.approvalPolicy);
  if (!['user', 'auto_review', 'guardian_subagent'].includes(String(response.approvalsReviewer))) return invalid('审批方');
  const sandboxPolicy = sandbox(response.sandbox);
  if (!has(response, 'activePermissionProfile')) return invalid('权限配置');
  const profile = response.activePermissionProfile;
  if (!(profile === null || object(profile) && nonempty(profile.id))) return invalid('权限配置');
  const modes = new Map<string, string>([['readOnly', 'read-only'], ['workspaceWrite', 'workspace-write'],
    ['dangerFullAccess', 'danger-full-access']]);
  const sandboxMode = modes.get(String(sandboxPolicy.type));
  if (!profile && !sandboxMode) return invalid('可用于 fork 的权限配置');
  const modeValue = object(response.collaborationMode) ? response.collaborationMode.mode : response.collaborationMode;
  if (modeValue != null && modeValue !== 'default' && modeValue !== 'plan') return invalid('协作模式');
  const submitOptions: Value = { model: response.model, effort: response.reasoningEffort, serviceTier: response.serviceTier,
    approvalPolicy, approvalsReviewer: response.approvalsReviewer,
    ...(profile ? { permissionProfileId: profile.id } : {}), ...(sandboxMode ? { sandboxMode } : {}),
    ...(modeValue === 'default' || modeValue === 'plan' ? { mode: modeValue } : {}) };
  return { hostId: snapshot.hostId, threadId: snapshot.threadId, connectionGeneration: snapshot.connectionGeneration,
    cwd: response.cwd, workspaceRoots, model: response.model, modelProvider: response.modelProvider,
    effort: response.reasoningEffort as string | null, serviceTier: response.serviceTier as string | null,
    submitOptions, sandboxPolicy, project: snapshot.project,
    ...(snapshot.developerOverride ? { developerOverride: snapshot.developerOverride } : {}),
    ...(snapshot.forkConfig ? { forkConfig: snapshot.forkConfig } : {}) };
}

async function findInDirectory(port: SideChatParentPort, revision: string, threadId: string, archived: boolean): Promise<boolean> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const pending = await port.runScoped(() => {
      port.assertCurrent(revision);
      return { reply: port.request('thread/list', { archived, limit: 100, cursor, sourceKinds: [...sourceKinds] }) };
    });
    const result = await pending.reply;
    const page = await port.runScoped(() => {
      port.assertCurrent(revision);
      return structuredClone(result);
    });
    if (!object(page) || !Array.isArray(page.data) || page.data.some(row => !object(row) || !nonempty(row.id))
      || page.nextCursor != null && !nonempty(page.nextCursor)) return invalid('归档目录回执');
    if (page.data.some(row => row.id === threadId)) return true;
    cursor = page.nextCursor == null ? null : page.nextCursor as string;
    if (cursor === null) return false;
    if (seen.has(cursor)) return invalid('归档目录分页');
    seen.add(cursor);
  }
  return invalid('归档目录分页');
}

/** Map only a host-captured response; this function owns no connection or session state. */
export async function resolveSideChatParent(identity: SideChatParentIdentity, port: SideChatParentPort): Promise<SideChatParent> {
  if (!identity || !nonempty(identity.hostId) || !nonempty(identity.threadId) || !nonempty(identity.connectionGeneration)) {
    return invalid('身份');
  }
  const origin = { hostId: identity.hostId, threadId: identity.threadId, connectionGeneration: identity.connectionGeneration };
  const snapshot = await port.runScoped(() => {
    const current = port.capture();
    if (!current || !sameIdentity(current, origin) || !nonempty(current.revision)
      || !Object.hasOwn(current, 'project') || current.project === undefined
      || current.forkConfig !== undefined && !object(current.forkConfig)
      || current.developerOverride !== undefined && (!object(current.developerOverride)
        || typeof current.developerOverride.value !== 'string' || !nonempty(current.developerOverride.source))
      || current.archive !== undefined && (!object(current.archive) || typeof current.archive.archived !== 'boolean'
        || !['directory', 'notification'].includes(String(current.archive.source)))) return invalid('来源');
    port.assertCurrent(current.revision);
    return structuredClone(current);
  });
  const parent = mapSnapshot(snapshot);
  let archived: boolean;
  if (snapshot.archive) archived = snapshot.archive.archived;
  else if (await findInDirectory(port, snapshot.revision, origin.threadId, false)) archived = false;
  else if (await findInDirectory(port, snapshot.revision, origin.threadId, true)) archived = true;
  else return invalid('归档状态');
  return port.runScoped(() => {
    port.assertCurrent(snapshot.revision);
    return { ...parent, archived };
  });
}
