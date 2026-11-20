import { record, type HostMessage } from '../native/protocol.ts';
import { readWorkspaceHistory, requestWorkspaceRpc, WorkspaceRequestError } from '../native/browser-workspace-rpc.ts';
import type { SidebarProjectDetails, StartupHost, StartupSidebar } from '../native/startup-sidebar.ts';
import type { ProjectAppearance } from '../native/project-appearance.ts';
import type { SidebarProject } from '../native/backend-sidebar-state.ts';
import type { ProjectSection, ProjectSectionDestination } from '../native/browser-sidebar-sections.ts';
import type { BrowserSidechatThreads } from '../native/browser-sidechat-threads.ts';
import type { ModelSummary, Page, RpcId, SessionConfig, ThreadItemSummary, ThreadResponse, ThreadSettingsResponse, ThreadSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import type { publicPermissions } from '../../lib/permissions.ts';
import type { ProviderSnapshot } from '../native/model-selection.ts';
import { composerInput, type PromptAttachment } from './composer-input.ts';
import { validPluginId, type PluginMention } from './output-types.ts';

type Bridge = { sendMessageFromView(message: HostMessage): Promise<void>; getPathForFile(file: File): string | null };
export type FollowUpMode = 'queue' | 'steer';
export interface QueuedSubmission {
  id: string; clientUserMessageId: string; input: unknown[];
  responsesapiClientMetadata?: Record<string, string> | null;
}
type WorkspaceWindow = Window & {
  electronBridge: Bridge;
  workbenchTakeSourceHistory(threadId: string, hostId: string): ReturnType<typeof readWorkspaceHistory> | undefined;
  workbenchStartupSidebar: { load(hostId?: string, searchTerm?: string, cursor?: string): Promise<StartupSidebar>; hosts(): Promise<StartupHost[]> };
  workbenchSetThreadPinned(threadId: string, pinned: boolean, hostId?: string): Promise<{ success: boolean }>;
  workbenchRespondToServerRequest(id: RpcId, result: unknown, hostId?: string): void;
  workbenchProjectlessThreadCwd(): Promise<{ cwd: string }>;
  workbenchReadWorkspaceDirectory(workspaceRoot: string, directoryPath: string, hostId: string): Promise<{
    parentPath: string | null; entries: WorkspaceEntry[];
  }>;
  workbenchSelectLocalProject(projectId?: string): Promise<{ success: boolean }>;
  workbenchSidebarProject(hostId: string, projectId: string, fields: Record<string, unknown>): Promise<unknown>;
  workbenchFollowUpMode(value?: FollowUpMode): Promise<{ value?: unknown }>;
  workbenchProjectSections: { snapshot(): ProjectSection[]; load(): Promise<ProjectSection[]>; move(id: string, destination: ProjectSectionDestination): Promise<ProjectSection[]> };
  workbenchBrowseProjectFolders(hostId: string, directoryPath?: string): Promise<{
    directoryPath: string; parentPath: string | null; entries: WorkspaceEntry[];
  }>;
  workbenchSidechatThreads: BrowserSidechatThreads;
  workbenchStageFiles(files: File[]): Promise<void>;
  workbenchUploadLocalFileAttachments(hostId: string, files: Array<{ fsPath: string }>): Promise<Array<{ fsPath: string }>>;
  workbenchComposerPermissions(params: unknown): Promise<ComposerPermission[]>;
  workbenchModelProviders(params: unknown): Promise<ProviderSnapshot>;
};
const host = window as unknown as WorkspaceWindow;

export function sidebar(hostId = 'local', searchTerm?: string) {
  return host.workbenchStartupSidebar.load(hostId, searchTerm);
}

export const olderSidebar = (hostId: string, cursor: string) => host.workbenchStartupSidebar.load(hostId, undefined, cursor);
export const remoteHosts = () => host.workbenchStartupSidebar.hosts();
export const selectLocalProject = (projectId?: string) => host.workbenchSelectLocalProject(projectId);
export const readSidebarProject = (hostId: string, id: string) =>
  host.workbenchSidebarProject(hostId, id, { operation: 'read' }) as Promise<SidebarProjectDetails>;
export const readProjectFolders = (hostId: string, id: string) =>
  host.workbenchSidebarProject(hostId, id, { operation: 'folders' }) as Promise<{ roots: string[] }>;
export const archiveProjectTargets = (hostId: string, id: string) =>
  host.workbenchSidebarProject(hostId, id, { operation: 'archive-targets' }) as Promise<string[]>;
export const browseProjectFolders = (hostId: string, path?: string) => host.workbenchBrowseProjectFolders(hostId, path);
export type ProjectAction = { operation: 'pin'; pinned: boolean } | { operation: 'edit'; name: string; roots?: string[] }
  | { operation: 'appearance'; appearance: ProjectAppearance | null } | { operation: 'remove' };
export const updateSidebarProject = (hostId: string, id: string, action: ProjectAction) =>
  host.workbenchSidebarProject(hostId, id, action);
export const projectSections = host.workbenchProjectSections;
export const sendHostMessage = (message: HostMessage) => host.electronBridge.sendMessageFromView(message);

export type WorkspaceEntry = { name: string; path: string; type: 'directory' | 'file' };
export const readWorkspaceDirectory = (root: string, directory: string, hostId: string) => host.workbenchReadWorkspaceDirectory(root, directory, hostId);

export function searchWorkspaceFiles(root: string, query: string, cancellationToken: string, hostId: string) {
  return request<{ files: { root: string; path: string; match_type: 'directory' | 'file' }[] }>('fuzzyFileSearch', {
    roots: [root], query, cancellationToken,
  }, { hostId });
}

export const sidechats = host.workbenchSidechatThreads;

export function listSidechats(params: Record<string, unknown>, hostId = 'local') {
  return request<Page<ThreadSummary>>('thread/list', params, { hostId });
}

export async function listSubagents(parentId: string, hostId: string) {
  const rows = new Map<string, ThreadSummary>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Page<ThreadSummary> = await request('thread/list', {
      ancestorThreadId: parentId, sourceKinds: ['subAgentThreadSpawn'], limit: 50, cursor,
      sortKey: 'created_at', sortDirection: 'asc',
    }, { hostId });
    for (const child of page.data) if (child.parentThreadId === parentId && child.id !== parentId) rows.set(child.id, child);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('The host returned a repeated subagent cursor.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return rows;
}

export { WorkspaceRequestError };

export function request<T>(method: string, params: Record<string, unknown>, options?: { type?: string; hostId?: string }) {
  return requestWorkspaceRpc<T>(sendHostMessage, method, params, options);
}

export type McpAppScope = { hostId: string; threadId: string; server: string };
export const readMcpAppResource = ({ hostId, threadId, server }: McpAppScope, uri: string) =>
  request('mcpServer/resource/read', { threadId, server, uri }, { hostId });
export const readMcpAppTools = ({ hostId, threadId, server }: McpAppScope) =>
  request('mcpServerStatus/list', { threadId, serverName: server, detail: 'toolsAndAuthOnly', limit: 100, cursor: null }, { hostId });
export const callMcpAppTool = ({ hostId, threadId, server }: McpAppScope, tool: string, args: Record<string, unknown>) =>
  request('mcpServer/tool/call', { threadId, server, tool, arguments: args }, { hostId });

export async function listComposerPlugins(cwd: string | undefined, hostId: string) {
  const result = record(await request('plugin/installed', { cwds: cwd ? [cwd] : [] }, { hostId }));
  if (!Array.isArray(result.marketplaces)) throw new Error("Couldn't load plugins");
  const installed = new Map<string, PluginMention>();
  for (const market of result.marketplaces.map(record)) {
    if (!Array.isArray(market.plugins)) continue;
    for (const plugin of market.plugins.map(record)) {
      const { id, name, installed: present, enabled } = plugin;
      if (typeof id !== 'string' || !validPluginId(id) || !present || !enabled) continue;
      const displayName = record(plugin.interface).displayName;
      const label = (typeof displayName === 'string' && displayName || typeof name === 'string' && name || id.split('@')[0]!)
        .replace(/[\]\r\n]/g, ' ').trim();
      if (label) installed.set(id, { plugin: id, label });
    }
  }
  return [...installed.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function history(threadId: string, cursor: string | null = null, hostId = 'local') {
  return readWorkspaceHistory(sendHostMessage, threadId, cursor, hostId);
}

export function initialHistory(threadId: string, hostId: string) {
  return host.workbenchTakeSourceHistory(threadId, hostId)?.catch(() => history(threadId, null, hostId))
    ?? history(threadId, null, hostId);
}

export async function readTranscriptTurns(threadId: string, hostId: string) {
  const seen = new Set<string>();
  const turns = new Map<string, TurnSummary>();
  let cursor: string | null = null;
  do {
    const page: Page<TurnSummary> = await request('thread/turns/list', {
      threadId, cursor, limit: 50, sortDirection: 'desc', itemsView: 'summary',
    }, { hostId });
    for (const turn of page.data) if (!turns.has(turn.id)) turns.set(turn.id, turn);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('The host returned a repeated conversation cursor.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...turns.values()].reverse();
}

export async function readTurnActivity(threadId: string, turnId: string, hostId = 'local') {
  let cursor: string | null = null;
  const seen = new Set<string>();
  const items = new Map<string, ThreadItemSummary>();
  do {
    const page: Page<{ turnId: string; item: ThreadItemSummary }> = await request('thread/items/list', {
      threadId, turnId, cursor, limit: 100, sortDirection: 'asc',
    }, { hostId });
    for (const entry of page.data) if (entry.turnId === turnId) items.set(entry.item.id, entry.item);
    cursor = page.nextCursor;
    if (cursor != null) {
      if (seen.has(cursor)) throw new Error('The host returned a repeated activity cursor.');
      seen.add(cursor);
    }
  } while (cursor != null);
  return [...items.values()];
}

/** Fill the gap back to the last observed turn, then recover active progress.
 * Reading metadata alone neither subscribes nor restores a running transcript. */
export async function recoverConversation(threadId: string, hostId: string, anchor?: string) {
  let latest = await history(threadId, null, hostId);
  const cursors = new Set<string>();
  while (anchor && !latest.turns.some(turn => turn.id === anchor) && latest.nextCursor) {
    const cursor = latest.nextCursor;
    if (cursors.has(cursor)) throw new Error('The host returned a repeated conversation cursor.');
    cursors.add(cursor);
    const older = await history(threadId, cursor, hostId);
    latest = { ...latest, turns: [...older.turns, ...latest.turns], nextCursor: older.nextCursor };
  }
  const turns = await Promise.all(latest.turns.map(async turn => turn.status === 'inProgress' && turn.itemsView !== 'full'
    ? { ...turn, items: await readTurnActivity(threadId, turn.id, hostId), itemsView: 'full' } : turn));
  return { ...latest, turns };
}

export type ComposerModel = ModelSummary & {
  model?: string; displayName?: string; defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: { reasoningEffort: string; description: string }[];
};
export type ComposerPermission = ReturnType<typeof publicPermissions>[number];
type Account = {
  requiresOpenaiAuth?: boolean;
  account?: { type: string; email?: string | null; workspaceName?: string | null } | null;
};

export async function profileLabel() {
  const [identity, gateway] = await Promise.all([
    request<Account>('account/read', { refreshToken: false }).catch(() => null),
    request<{ providerId?: string }>('account/gatewayOAuth/read', {}).catch(() => null),
  ]);
  if (identity?.account?.type === 'chatgpt') {
    return identity.account.workspaceName?.trim() || identity.account.email?.trim() || 'Settings';
  }
  return gateway?.providerId?.trim() || 'Settings';
}

export async function projectRoot(id: string, hostId = 'local') {
  const { project } = await request<{ project: SidebarProject }>('project/read', { projectId: id }, { hostId });
  const cwd = project.roots[0]?.path;
  if (!cwd) throw new Error('This project has no workspace folder.');
  return cwd;
}

export async function readComposerConfig(cwd?: string, hostId = 'local') {
  return (await request<{ config: SessionConfig }>('config/read', { cwd, includeLayers: false }, { hostId })).config;
}

const modelPages = new Map<string, { page: Promise<Page<ComposerModel>>; expiresAt: number }>();
export function composerModelPage(hostId: string, refresh = false) {
  const previous = modelPages.get(hostId);
  if (previous && (previous.expiresAt === Infinity || !refresh && Date.now() < previous.expiresAt)) return previous.page;
  const next = { page: request<Page<ComposerModel>>('model/list', { limit: 100 }, { hostId }), expiresAt: Infinity };
  modelPages.set(hostId, next);
  void next.page.then(() => { next.expiresAt = Date.now() + 60_000; }, () => {
    if (modelPages.get(hostId) === next) modelPages.delete(hostId);
  });
  return next.page;
}

export async function composerModels(hostId = 'local') {
  const [firstPage, providers] = await Promise.all([
    composerModelPage(hostId, true),
    host.workbenchModelProviders({ hostId }).catch((): ProviderSnapshot => ({ providers: [] })),
  ]);
  const models = [...firstPage.data];
  const seen = new Set<string>();
  for (let cursor = firstPage.nextCursor; cursor && !seen.has(cursor);) {
    seen.add(cursor);
    const page = await request<Page<ComposerModel>>('model/list', { limit: 100, cursor }, { hostId });
    models.push(...page.data);
    cursor = page.nextCursor;
  }
  return { models, providers: providers.providers };
}

export function composerPermissions(params: { hostId?: string; cwd?: string; model?: string | null; projectless: boolean; automaticReview: boolean }) {
  return host.workbenchComposerPermissions(params);
}

export function saveComposerModel(config: SessionConfig, model: string, effort?: string, hostId = 'local') {
  const prefix = config.profile ? 'profiles.' + config.profile + '.' : '';
  const edit = (key: string, value: string) => ({ keyPath: prefix + key, value, mergeStrategy: 'upsert' });
  return request('config/batchWrite', { edits: [edit('model', model), ...(effort ? [edit('model_reasoning_effort', effort)] : [])],
    reloadUserConfig: true }, { hostId });
}

export function updateComposerThread(threadId: string, settings: { model?: string; effort?: string; yardPermissionChoice?: string }, hostId = 'local') {
  return request('thread/settings/update', { threadId, ...settings }, { hostId });
}

export function onThreadSettings(threadId: string, update: (settings: ThreadSettingsResponse) => void, hostId = 'local') {
  const receive = (event: MessageEvent<HostMessage & { params?: { threadId?: string; threadSettings?: ThreadSettingsResponse } }>) => {
    if (event.source === window && event.origin === location.origin && event.data?.type === 'mcp-notification' &&
        event.data.hostId === hostId && event.data.method === 'thread/settings/updated' &&
        event.data.params?.threadId === threadId && event.data.params.threadSettings) update(event.data.params.threadSettings);
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}

async function ensureSignedIn(hostId = 'local') {
  const account = await request<Account>('account/read', { refreshToken: false }, { hostId });
  if (account.requiresOpenaiAuth) throw new Error('Sign in to Codex to send a message.');
}

export async function stageComposerFile(file: File, hostId = 'local'): Promise<PromptAttachment> {
  await host.workbenchStageFiles([file]);
  let path = host.electronBridge.getPathForFile(file);
  if (!path) throw new Error('Unable to attach file.');
  if (hostId !== 'local') {
    const [uploaded] = await host.workbenchUploadLocalFileAttachments(hostId, [{ fsPath: path }]);
    if (!uploaded?.fsPath) throw new Error('Unable to transfer file to the conversation host.');
    path = uploaded.fsPath;
  }
  return { name: file.name, path, image: /^image\/(?:png|jpeg|gif|webp)$/i.test(file.type) };
}

function startTurn(threadId: string, text: string, attachments: readonly PromptAttachment[], hostId = 'local', clientUserMessageId = crypto.randomUUID() as string) {
  return request<{ turn: TurnSummary }>('turn/start', {
    threadId, clientUserMessageId,
    input: composerInput(text, attachments),
  }, { hostId });
}

export class MessageEditStopped extends Error {}

export async function replaceLatestMessage(threadId: string, turnId: string, input: readonly unknown[], hostId: string, stillSelected: () => boolean) {
  const check = () => { if (!stillSelected()) throw new Error('The conversation changed before the edit was submitted.'); };
  await ensureSignedIn(hostId);
  check();
  const { thread } = await resumeThread(threadId, hostId);
  if (thread.id !== threadId || thread.ephemeral || thread.status.type === 'active') {
    throw new Error('The latest message is no longer available to edit.');
  }
  const { data } = await request<Page<TurnSummary>>('thread/turns/list', {
    threadId, cursor: null, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded',
  }, { hostId });
  check();
  if (data[0]?.id !== turnId || data[0].status === 'inProgress') {
    throw new Error('The latest message changed. Review the conversation before editing.');
  }
  try {
    const reverted = await request<ThreadResponse>('thread/revert', { threadId, beforeTurnId: turnId }, { hostId });
    if (reverted.thread?.id !== threadId) throw new MessageEditStopped('The host did not confirm which history was reverted.');
  } catch (error) {
    if (error instanceof WorkspaceRequestError && error.uncertain) {
      throw new MessageEditStopped('The host may have reverted the conversation. Review the history before trying again.');
    }
    throw error;
  }
  // Finish the explicitly submitted edit on the same resumed thread, even if
  // the page navigates after the revert. The daemon owns model and permissions.
  try {
    return await request<{ turn: TurnSummary }>('turn/start', {
      threadId, input, clientUserMessageId: crypto.randomUUID(), turnTrigger: 'edit_user_message',
    }, { hostId });
  } catch (error) {
    throw new MessageEditStopped('The previous turn was removed. ' +
      (error instanceof WorkspaceRequestError && error.uncertain
        ? 'Check the conversation to see if the edit was sent.' : 'The edit was not sent: ' + (error instanceof Error ? error.message : String(error))));
  }
}

export async function sendExistingThread(threadId: string, text: string, stillSelected: () => boolean,
  attachments: readonly PromptAttachment[] = [], hostId = 'local', clientUserMessageId?: string) {
  await ensureSignedIn(hostId);
  if (!stillSelected()) throw new Error('The conversation changed before the message was sent.');
  const resumed = await resumeThread(threadId, hostId);
  if (resumed.thread.id !== threadId || !stillSelected()) throw new Error('The conversation changed before the message was sent.');
  // Send on the resumed native session, leaving its permissions and model
  // configuration in the daemon. Do not retry a turn whose outcome is unknown.
  return startTurn(threadId, text, attachments, hostId, clientUserMessageId);
}

export function resumeThread(threadId: string, hostId = 'local') {
  return request<ThreadResponse>('thread/resume', { threadId, excludeTurns: true }, { hostId });
}

export async function forkConversation(threadId: string, lastTurnId?: string, hostId = 'local') {
  const { thread } = await request<ThreadResponse>('thread/fork', {
    threadId, lastTurnId, ephemeral: false, excludeTurns: true,
  }, { hostId });
  if (!thread?.id || thread.id === threadId || thread.ephemeral || thread.attachedToThreadId) {
    throw new Error('The host did not save an independent branch.');
  }
  return thread;
}

export async function forkSidechat(threadId: string, stillSelected: () => boolean, hostId = 'local') {
  await ensureSignedIn(hostId);
  if (!stillSelected()) throw new Error('The conversation changed before the side chat was created.');
  if (!sidechats.supportsHost(hostId)) throw new Error('Side chats require Codex CLI 0.169.1 or later.');
  const { thread } = await request<ThreadResponse>('thread/fork', {
    threadId, attachToSource: true, ephemeral: false, excludeTurns: true,
  }, { hostId });
  if (thread.attachedToThreadId !== threadId || thread.ephemeral) throw new Error('The host did not save this side chat.');
  return thread;
}

export function interruptTurn(threadId: string, turnId: string, hostId = 'local') {
  return request('turn/interrupt', { threadId, turnId }, { hostId });
}

export const readContinuationTurns = (threadId: string, hostId: string) => request('thread/turns/list', {
  threadId, limit: 5, sortDirection: 'desc', itemsView: 'summary',
}, { hostId });

export const followUpMode = (mode?: FollowUpMode) => host.workbenchFollowUpMode(mode);

export async function listQueuedSubmissions(threadId: string, hostId: string) {
  const entries: QueuedSubmission[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Page<QueuedSubmission> = await request('thread/queue/list', { threadId, cursor, limit: 100 }, { hostId });
    entries.push(...page.data);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('The host returned a repeated queue cursor.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return entries;
}

export function enqueueMessage(threadId: string, text: string, attachments: readonly PromptAttachment[], hostId: string) {
  return request<{ queuedSubmission: QueuedSubmission }>('thread/queue/add', {
    threadId, input: composerInput(text, attachments), clientUserMessageId: crypto.randomUUID(),
  }, { hostId });
}

export function steerTurn(threadId: string, expectedTurnId: string, input: readonly unknown[], hostId: string,
  clientUserMessageId = crypto.randomUUID() as string, responsesapiClientMetadata?: Record<string, string> | null) {
  return request<{ turnId: string }>('turn/steer', {
    threadId, expectedTurnId, input, clientUserMessageId, responsesapiClientMetadata,
  }, { hostId });
}

export function deleteQueuedSubmission(threadId: string, queuedSubmissionId: string, hostId: string) {
  return request<{ deleted: boolean }>('thread/queue/delete', { threadId, queuedSubmissionId }, { hostId });
}

export function submitTransferredInput(threadId: string, item: QueuedSubmission, hostId: string) {
  return request<{ turn: TurnSummary }>('turn/start', { threadId, input: item.input,
    clientUserMessageId: item.clientUserMessageId, responsesapiClientMetadata: item.responsesapiClientMetadata,
  }, { hostId });
}

export function reorderQueuedSubmissions(threadId: string, queuedSubmissionIds: string[], hostId: string) {
  return request('thread/queue/reorder', { threadId, queuedSubmissionIds }, { hostId });
}

export async function startQueuedSubmission(threadId: string, queuedSubmissionId: string | undefined, hostId: string,
  stillSelected: () => boolean) {
  await ensureSignedIn(hostId);
  const { thread } = await resumeThread(threadId, hostId);
  if (thread.id !== threadId || !stillSelected()) throw new Error('The conversation changed before the message was sent.');
  return request<{ turn: TurnSummary }>('thread/queue/start', { threadId, queuedSubmissionId }, { hostId });
}

export function renameThread(threadId: string, name: string, hostId = 'local') {
  return request('thread/name/set', { threadId, name }, { hostId });
}

export async function setThreadPinned(threadId: string, pinned: boolean, hostId = 'local') {
  const result = await host.workbenchSetThreadPinned(threadId, pinned, hostId);
  if (!result.success) throw new Error('The host did not save the pin.');
}

export function archiveThread(threadId: string, hostId = 'local') {
  return request('thread/archive', { threadId }, { hostId });
}

export async function activeTurnBeforeArchive(threadId: string, hostId: string) {
  const { thread } = await request<ThreadResponse>('thread/read', { threadId, includeTurns: false }, { hostId });
  if (thread.status.type !== 'active') return;
  const { data } = await request<Page<TurnSummary>>('thread/turns/list', {
    threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary',
  }, { hostId });
  const turn = data[0];
  if (turn?.status !== 'inProgress') throw new Error('Open the chat and stop its active turn before archiving.');
  return turn.id;
}

export function respondToServerRequest(id: RpcId, result: unknown, hostId = 'local') {
  host.workbenchRespondToServerRequest(id, result, hostId);
}

export function onThreadName(update: (threadId: string, name: string, hostId: string) => void) {
  const receive = (event: MessageEvent<HostMessage & { params?: { threadId?: string; threadName?: string } }>) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'mcp-notification' ||
        typeof event.data.hostId !== 'string' || event.data.method !== 'thread/name/updated') return;
    const { threadId, threadName } = event.data.params ?? {};
    if (threadId && threadName) update(threadId, threadName, event.data.hostId);
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}

export type SidebarChange = { hostId?: string; threadId?: string; removed?: boolean; active?: boolean };
export function onSidebarChanged(update: (change: SidebarChange) => void) {
  const methods = new Set(['thread/started', 'thread/name/updated', 'thread/status/changed', 'thread/readState/changed',
    'thread/archived', 'thread/deleted', 'thread/unarchived', 'thread/section/changed', 'thread/project/updated',
    'project/changed', 'turn/started', 'turn/completed']);
  const keys = new Set(['local-projects', 'remote-projects', 'project-order', 'project-appearances',
    'sidebar-project-thread-orders', 'pinned-project-ids', 'pinned-thread-ids', 'thread-project-assignments']);
  const receive = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message.type === 'mcp-notification' && typeof message.hostId === 'string' && methods.has(String(message.method))) {
      const params = record(message.params);
      update({ hostId: message.hostId, threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
        removed: message.method === 'thread/archived' || message.method === 'thread/deleted',
        active: message.method === 'thread/status/changed' ? record(params.status).type === 'active'
          : message.method === 'turn/started' ? true : message.method === 'turn/completed' ? false : undefined });
    } else if (message.type === 'codex-app-server-connection-changed' && message.state === 'connected') {
      update({ hostId: typeof message.hostId === 'string' ? message.hostId : undefined });
    } else if (message.type === 'pinned-threads-updated' || message.type === 'thread-project-memberships-updated' ||
        message.type === 'global-state-updated' && Array.isArray(message.keys) && message.keys.some(key => keys.has(String(key)))) update({});
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}

export async function sendNewThread(projectId: string | undefined, text: string, stillComposing: () => boolean,
  observe: (id: string) => void, permissionChoice?: string, attachments: readonly PromptAttachment[] = [], clientUserMessageId?: string) {
  const check = () => {
    if (!stillComposing()) throw new Error('The workspace changed before the message was sent.');
  };
  await ensureSignedIn();
  check();
  const cwd = projectId === undefined ? (await host.workbenchProjectlessThreadCwd()).cwd : await projectRoot(projectId);
  check();
  // Reuse the native hidden-start flow. A change of destination during start
  // leaves the thread private, to be cleaned up by the same host expiry.
  const { thread } = await request<ThreadResponse>('thread/start', { cwd, historyMode: 'paginated',
    ...(projectId ? { projectId } : {}), ...(permissionChoice ? { yardPermissionChoice: permissionChoice } : {}) }, { type: 'thread-prewarm-start' });
  check();
  observe(thread.id);
  const { turn } = await startTurn(thread.id, text, attachments, 'local', clientUserMessageId);
  return { thread, turn };
}

export function onConversationHistoryChanged(threadId: string, refresh: (reverted: boolean, reattach?: boolean) => void, hostId = 'local') {
  const receive = (event: MessageEvent<HostMessage & { params?: { threadId?: string } }>) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.hostId !== hostId) return;
    if (event.data.type === 'codex-app-server-connection-changed' && event.data.state === 'connected') refresh(false, true);
    if (event.data.type === 'mcp-notification' && event.data.params?.threadId === threadId &&
        ['turn/started', 'turn/completed', 'thread/reverted'].includes(String(event.data.method))) refresh(event.data.method === 'thread/reverted');
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}

export function browserAtoms(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('native-atoms') ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function writeAtom(key: string, value: unknown) {
  return host.electronBridge.sendMessageFromView({ type: 'persisted-atom-update', key, value });
}
