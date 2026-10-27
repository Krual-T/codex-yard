import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { record } from '../src/native/protocol.ts';
import type { RpcId, ThreadItemSummary, TurnSummary } from '../lib/codex-protocol.ts';

interface FixtureTurn extends TurnSummary { [key: string]: unknown }
interface FixtureThread {
  id: string; sessionId: string; forkedFromId: string | null; parentThreadId: string | null;
  preview: string; ephemeral: boolean; name: string | null; cwd: string;
  modelProvider: string; model: string; reasoningEffort: string | null;
  createdAt: number; updatedAt: number;
  status: { type: string; activeFlags?: string[] };
  source: string | { subAgent?: { thread_spawn?: { parent_thread_id: string } } };
  turns: FixtureTurn[];
  [key: string]: unknown;
}
interface FixtureMessage extends Record<string, unknown> { id?: RpcId; method?: string; params: Record<string, unknown> }
interface HandlerContext { message: FixtureMessage; socket: WebSocket; send: (value: unknown) => void }
type Handler = (params: Record<string, unknown>, context: HandlerContext) => unknown;
interface QueuedSubmission { id: string; input: unknown[]; clientUserMessageId: unknown }

export const NO_REPLY = Symbol('intentionally missing RPC response');

export function agentItem(id: string, text: string): ThreadItemSummary {
  return { id, type: 'agentMessage', text, phase: null, memoryCitation: null, delivery: null, questions: null };
}

export function fixtureTurn(id: string, items: ThreadItemSummary[] = [], status: TurnSummary['status'] = 'completed'): FixtureTurn {
  return { id, rootTurnId: id, items, itemsView: 'full', status, error: null,
    startedAt: null, completedAt: null, durationMs: null };
}

export function itemEntry(turnId: string, item: ThreadItemSummary) {
  return { turnId, item, startedAtMs: null, completedAtMs: null };
}

export function commandItem(id: string, aggregatedOutput: string, cwd: string): ThreadItemSummary {
  return { id, type: 'commandExecution', pluginId: null, scriptPath: null, command: 'fixture-command', cwd,
    processId: null, source: 'agent', status: 'completed', commandActions: [], aggregatedOutput, exitCode: 0, durationMs: 1 };
}

export function fixtureThread(id: string, cwd: string, overrides: Partial<FixtureThread> = {}): FixtureThread {
  return { id, sessionId: id, forkedFromId: null, parentThreadId: null, preview: '', ephemeral: false,
    section: null, sectionEnteredAt: null, projectId: null, historyMode: 'paginated', modelProvider: 'fixture',
    model: 'fixture-model', reasoningEffort: null, name: null, cwd,
    createdAt: 1_700_000_000, updatedAt: 1_700_000_000, recencyAt: null,
    status: { type: 'idle' }, path: null, cliVersion: 'fixture', originator: null, source: 'appServer',
    threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, turns: [], ...overrides };
}

/** A disposable protocol peer; it never opens a real Codex socket or session. */
export async function createFakeCodex(root: string, options: { perMessageDeflate?: boolean } = {}) {
  const server = createServer();
  const webSockets = new WebSocketServer({ server, ...options });
  const emitter = new EventEmitter();
  const messages: FixtureMessage[] = [];
  const handlers = new Map<string, Handler>();
  const threads = new Map<string, FixtureThread>();
  const archived = new Set<string>();
  const queues = new Map<string, QueuedSubmission[]>();
  const loaded = new Set<string>();
  const pausedQueues = new Set<string>();
  const threadModes = new Map<string, unknown>();
  const threadPermissions = new Map<string, Record<string, unknown>>();
  const socketPath = join(root, 'codex.sock');
  let nextThread = 0;
  let nextTurn = 0;
  let nextQueued = 0;
  let client: WebSocket | undefined;

  function send(message: unknown, socket = client) {
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('Fixture client is disconnected');
    socket.send(JSON.stringify(message));
  }

  function invalid(message: string): never { throw Object.assign(new Error(message), { code: -32600 }); }
  function threadFor(id: unknown): FixtureThread {
    const thread = typeof id === 'string' ? threads.get(id) : undefined;
    if (!thread) invalid('Thread not found');
    return thread;
  }
  function queueFor(id: string) {
    const thread = threads.get(id);
    if (!thread) invalid('Thread not found');
    if (archived.has(id)) invalid('Cannot queue input for an archived thread');
    if (thread.ephemeral) invalid('Ephemeral threads do not support queued messages');
    let queue = queues.get(id);
    if (!queue) { queue = []; queues.set(id, queue); }
    return queue;
  }
  function queueChanged(threadId: string) { send({ method: 'thread/queue/changed', params: { threadId } }); }
  function settingsFor(thread: FixtureThread) {
    return { model: thread.model, modelProvider: thread.modelProvider, reasoningEffort: thread.reasoningEffort,
      approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, serviceTier: null,
      ...(threadModes.has(thread.id) ? { collaborationMode: threadModes.get(thread.id) } : {}),
      ...threadPermissions.get(thread.id) };
  }

  function changePermissions(threadId: string, params: Record<string, unknown>, notify = true) {
    const thread = threads.get(threadId);
    if (!thread) invalid('Thread not found');
    const modes: Record<string, string | undefined> = { ':workspace': 'workspaceWrite', ':read-only': 'readOnly', ':danger-full-access': 'dangerFullAccess' };
    const previous = settingsFor(thread);
    const permissions = { approvalPolicy: params.approvalPolicy ?? previous.approvalPolicy,
      approvalsReviewer: params.approvalsReviewer === 'guardian_subagent' ? 'auto_review' : params.approvalsReviewer ?? threadPermissions.get(threadId)?.approvalsReviewer ?? 'user',
      activePermissionProfile: params.permissions ? { id: params.permissions, extends: null } : null,
      sandbox: params.sandboxPolicy || { type: modes[String(params.permissions)] || 'workspaceWrite' } };
    threadPermissions.set(threadId, permissions);
    if (notify) send({ method: 'thread/settings/updated', params: { threadId,
      threadSettings: { ...settingsFor(thread), effort: thread.reasoningEffort, sandboxPolicy: permissions.sandbox } } });
    return {};
  }

  function defaultResult(method: string, params: Record<string, unknown>): Record<string, unknown> {
    const threadId = typeof params.threadId === 'string' ? params.threadId : '';
    const input: unknown[] = Array.isArray(params.input) ? params.input : [];
    switch (method) {
      case 'initialize': return { userAgent: 'disposable-codex-fixture' };
      case 'model/list': return { data: [{ id: 'fixture-id', model: 'fixture-model', displayName: 'Fixture model', isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }, { reasoningEffort: 'high', description: 'High' }] }] };
      case 'account/read': return { account: null, requiresOpenaiAuth: false };
      case 'configRequirements/read': return { requirements: null };
      case 'permissionProfile/list': return { data: [':read-only', ':workspace', ':danger-full-access'].map(id => ({ id, description: null, allowed: true })), nextCursor: null };
      case 'config/read': return { config: { model: 'fixture-model', model_provider: 'fixture', model_reasoning_effort: 'high',
        approval_policy: 'never', sandbox_mode: 'danger-full-access', service_tier: null }, origins: {}, layers: null };
      case 'mcpServerStatus/list': return { data: [], nextCursor: null };
      case 'app/installed': return { apps: [] };
      case 'collaborationMode/list': return { data: [
        { name: 'Default', mode: 'default', model: null, reasoning_effort: null },
        { name: 'Plan', mode: 'plan', model: null, reasoning_effort: null },
      ] };
      case 'thread/goal/get': return { goal: null };
      case 'thread/loaded/list': return { data: [...loaded] };
      case 'thread/unsubscribe': return { status: 'unsubscribed' };
      case 'thread/backgroundTerminals/clean': return {};
      case 'thread/start': {
        const id = `fixture-thread-${++nextThread}`;
        const thread = fixtureThread(id, typeof params.cwd === 'string' ? params.cwd : root, { model: typeof params.model === 'string' ? params.model : 'fixture-model',
          reasoningEffort: String(record(params.config).model_reasoning_effort || 'high'),
          createdAt: 1_700_000_000 + nextThread, updatedAt: 1_700_000_000 + nextThread });
        threads.set(thread.id, thread);
        loaded.add(thread.id);
        if (params.permissions || params.sandbox) changePermissions(id, { ...params,
          ...(params.sandbox ? { sandboxPolicy: { type: record({ 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'dangerFullAccess' })[String(params.sandbox)] } } : {}) }, false);
        return { thread, ...settingsFor(thread) };
      }
      case 'thread/settings/update': return ['permissions', 'sandboxPolicy', 'approvalPolicy', 'approvalsReviewer'].some(key => Object.hasOwn(params, key))
        ? changePermissions(threadId, params) : {};
      case 'thread/fork': {
        const source = threads.get(threadId);
        if (!source) invalid('Thread not found');
        let turns = source.turns;
        if (params.lastTurnId) {
          const index = turns.findIndex(turn => turn.id === params.lastTurnId);
          if (index < 0) invalid('last turn not found');
          if (turns[index].status === 'inProgress') invalid('last turn cannot be in progress');
          turns = turns.slice(0, index + 1);
        }
        const id = `fixture-thread-${++nextThread}`;
        const thread = { ...structuredClone(source), id, sessionId: id, forkedFromId: source.id, status: { type: 'idle' },
          turns: structuredClone(turns) };
        threads.set(id, thread);
        loaded.add(id);
        if (threadModes.has(source.id)) threadModes.set(id, structuredClone(threadModes.get(source.id)));
        return { thread: { ...thread, turns: [] }, ...settingsFor(thread) };
      }
      case 'thread/list': {
        const candidates = [...threads.values()].filter(thread => {
          const cwdMatches = !params.cwd || (Array.isArray(params.cwd) ? params.cwd.includes(thread.cwd) : thread.cwd === params.cwd);
          const source = typeof thread.source === 'string' ? thread.source : thread.source?.subAgent?.thread_spawn ? 'subAgentThreadSpawn' : 'subAgent';
          let ancestor = thread.parentThreadId || (typeof thread.source === 'object' ? thread.source.subAgent?.thread_spawn?.parent_thread_id : undefined);
          const visited = new Set();
          while (params.ancestorThreadId && ancestor && ancestor !== params.ancestorThreadId && !visited.has(ancestor)) {
            visited.add(ancestor);
            const parent = threads.get(ancestor);
            ancestor = parent?.parentThreadId || (typeof parent?.source === 'object' ? parent.source.subAgent?.thread_spawn?.parent_thread_id : undefined);
          }
          const searchMatches = !params.searchTerm || [thread.name, thread.preview].some(value => value?.includes(String(params.searchTerm)));
          return cwdMatches && searchMatches && (!params.ancestorThreadId || ancestor === params.ancestorThreadId) && archived.has(thread.id) === (params.archived === true) &&
            (!Array.isArray(params.sourceKinds) || !params.sourceKinds.length || params.sourceKinds.includes(source));
        }).sort((a, b) => {
          const key = params.sortKey === 'created_at' ? 'createdAt' : 'updatedAt';
          return (b[key] - a[key]) * (params.sortDirection === 'asc' ? -1 : 1);
        });
        const offset = Number(params.cursor || 0);
        const end = offset + (Number(params.limit) || 50);
        return { data: candidates.slice(offset, end).map(thread => ({ ...thread, turns: [] })),
          nextCursor: end < candidates.length ? String(end) : null, backwardsCursor: null };
      }
      case 'thread/resume':
      case 'thread/read': {
        const thread = threads.get(threadId);
        if (!thread) {
          invalid('Thread not found');
        }
        if (method === 'thread/resume' && archived.has(thread.id)) {
          invalid('Cannot resume an archived thread');
        }
        if (method === 'thread/resume') loaded.add(thread.id);
        return { thread: { ...thread, turns: [] }, ...(method === 'thread/resume' ? settingsFor(thread) : {}) };
      }
      case 'thread/name/set': {
        const thread = threads.get(threadId);
        if (!thread) {
          invalid('Thread not found');
        }
        if (typeof params.name !== 'string') invalid('Missing thread name');
        thread.name = params.name;
        for (const socket of webSockets.clients) {
          if (socket.readyState === WebSocket.OPEN) send({ method: 'thread/name/updated',
            params: { threadId: thread.id, threadName: thread.name } }, socket);
        }
        return {};
      }
      case 'thread/archive':
      case 'thread/unarchive': {
        const thread = threads.get(threadId);
        if (!thread) {
          invalid('Thread not found');
        }
        const archive = method === 'thread/archive';
        if (archive) archived.add(thread.id);
        else archived.delete(thread.id);
        for (const socket of webSockets.clients) {
          if (socket.readyState === WebSocket.OPEN) send({ method: archive ? 'thread/archived' : 'thread/unarchived',
            params: { threadId: thread.id } }, socket);
        }
        return archive ? {} : { thread: { ...thread, turns: [] } };
      }
      case 'thread/turns/list': return {
        data: [...(threads.get(threadId)?.turns || [])].reverse().map(turn => params.itemsView === 'summary'
          ? { ...turn, items: [], itemsView: 'summary' } : turn),
        nextCursor: null, backwardsCursor: null,
      };
      case 'thread/items/list': {
        if (!params.turnId) {
          const entries = (threads.get(threadId)?.turns || []).flatMap(turn => turn.items.map(item => itemEntry(turn.id, item)));
          if (params.sortDirection === 'desc') entries.reverse();
          const offset = Number(params.cursor || 0), end = offset + (Number(params.limit) || 25);
          return { data: entries.slice(offset, end), nextCursor: end < entries.length ? String(end) : null, backwardsCursor: null };
        }
        const turn = threads.get(threadId)?.turns.find(turn => turn.id === params.turnId);
        const items = [...(turn?.items || [])];
        if (params.sortDirection === 'desc') items.reverse();
        return { data: items.map(item => itemEntry(String(params.turnId), item)), nextCursor: null, backwardsCursor: null };
      }
      case 'thread/revert': {
        const thread = threadFor(threadId);
        const index = thread.turns.findIndex(turn => turn.id === params.beforeTurnId);
        if (index == null || index < 0) invalid('turn not found');
        thread.turns.splice(index); thread.status = { type: 'idle' };
        send({ method: 'thread/reverted', params: { threadId: params.threadId } });
        return { thread: { ...thread, turns: [] }, turnsBackwardsCursor: null, itemsBackwardsCursor: null };
      }
      case 'turn/start': {
        const turn = fixtureTurn(`fixture-turn-${++nextTurn}`, input.length ? [
          { id: `fixture-input-${nextTurn}`, type: 'userMessage', clientId: params.clientUserMessageId || null, content: input },
        ] : [], 'inProgress');
        const thread = threadFor(threadId);
        thread.turns.push(turn);
        thread.status = { type: 'active', activeFlags: [] };
        if (params.collaborationMode) threadModes.set(thread.id, structuredClone(params.collaborationMode));
        pausedQueues.delete(thread.id);
        return { turn };
      }
      case 'turn/steer': return { turnId: params.expectedTurnId };
      case 'turn/interrupt': {
        const thread = threads.get(threadId);
        if (thread) {
          thread.status = { type: 'idle' };
          const turn = thread.turns.find(turn => turn.id === params.turnId);
          if (turn) turn.status = 'interrupted';
          pausedQueues.add(thread.id);
        }
        return {};
      }
      case 'thread/queue/list': {
        const items = queueFor(threadId);
        const offset = Number(params.cursor || 0);
        const end = offset + (Number(params.limit) || 25);
        return { data: structuredClone(items.slice(offset, end)), nextCursor: end < items.length ? String(end) : null };
      }
      case 'thread/queue/add': {
        const items = queueFor(threadId);
        if (items.length >= 100) invalid('queue is full');
        const item = { id: `fixture-queued-${++nextQueued}`, input: structuredClone(input), clientUserMessageId: params.clientUserMessageId };
        items.push(item);
        queueChanged(threadId);
        if (loaded.has(threadId) && threadFor(threadId).status.type !== 'active' && !pausedQueues.has(threadId)) {
          defaultResult('thread/queue/start', { threadId: params.threadId });
        }
        return { queuedSubmission: structuredClone(item) };
      }
      case 'thread/queue/update': {
        const item = queueFor(threadId).find(item => item.id === params.queuedSubmissionId);
        if (!item) invalid('queued submission not found: ' + params.queuedSubmissionId);
        item.input = structuredClone(input);
        queueChanged(threadId);
        return { queuedSubmission: structuredClone(item) };
      }
      case 'thread/queue/delete': {
        const items = queueFor(threadId);
        const index = items.findIndex(item => item.id === params.queuedSubmissionId);
        if (index < 0) return { deleted: false };
        items.splice(index, 1);
        queueChanged(threadId);
        return { deleted: true };
      }
      case 'thread/queue/reorder': {
        const items = queueFor(threadId);
        const ids = params.queuedSubmissionIds;
        if (!Array.isArray(ids) || ids.length !== items.length || new Set(ids).size !== items.length ||
            ids.some(id => !items.some(item => item.id === id))) invalid('reorder must include all queued submissions exactly once');
        queues.set(threadId, ids.map(id => items.find(item => item.id === id) ?? invalid('queued submission not found')));
        queueChanged(threadId);
        return {};
      }
      case 'thread/queue/start': {
        const items = queueFor(threadId);
        if (!loaded.has(threadId)) invalid('resume the thread before starting a queued message');
        if (threadFor(threadId).status.type === 'active') invalid('thread already has an active or pending turn');
        const index = params.queuedSubmissionId ? items.findIndex(item => item.id === params.queuedSubmissionId) : 0;
        const item = items[index];
        if (!item) invalid(params.queuedSubmissionId ? 'queued submission not found: ' + params.queuedSubmissionId : 'queue is empty');
        const result = defaultResult('turn/start', { threadId: params.threadId, input: item.input, clientUserMessageId: item.clientUserMessageId });
        items.splice(index, 1);
        queueChanged(threadId);
        send({ method: 'turn/started', params: { threadId: params.threadId, turn: result.turn } });
        return result;
      }
      default: throw new Error(`Unexpected fixture RPC: ${method}`);
    }
  }

  webSockets.on('connection', socket => {
    client = socket;
    socket.on('message', data => {
      const decoded = record(JSON.parse(String(data)));
      const message: FixtureMessage = { ...decoded, params: record(decoded.params),
        id: typeof decoded.id === 'string' || typeof decoded.id === 'number' ? decoded.id : undefined,
        method: typeof decoded.method === 'string' ? decoded.method : undefined };
      messages.push(message);
      emitter.emit('message');
      const method = message.method;
      if (!method || message.id == null) return;
      Promise.resolve().then(async () => {
        const handler = handlers.get(method);
        const result = handler
          ? await handler(message.params || {}, { message, socket, send: value => send(value, socket) })
          : defaultResult(method, message.params);
        if (result !== NO_REPLY && socket.readyState === WebSocket.OPEN) send({ id: message.id, result }, socket);
      }).catch(error => {
        if (socket.readyState === WebSocket.OPEN) send({ id: message.id, error: { code: error.code ?? -32603, message: error.message,
          ...(error.data === undefined ? {} : { data: error.data }) } }, socket);
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  function waitFor(predicate: (message: FixtureMessage) => unknown, timeout = 3_000): Promise<FixtureMessage> {
    const found = messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); emitter.off('message', check); };
      const check = () => {
        const value = messages.find(predicate);
        if (value) { cleanup(); resolve(value); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for fixture protocol message')); }, timeout);
      emitter.on('message', check);
    });
  }

  return {
    socketPath, messages, handlers, threads, archived, queues, loaded, threadModes, threadPermissions, changePermissions, send, defaultResult,
    broadcast(message: unknown) { for (const socket of webSockets.clients) if (socket.readyState === WebSocket.OPEN) send(message, socket); },
    calls(method: string) { return messages.filter(message => message.method === method && message.id != null); },
    waitFor,
    async waitForCall(method: string, count = 1) {
      let value: FixtureMessage | undefined;
      await waitFor(() => { value = messages.filter(message => message.method === method && message.id != null)[count - 1]; return Boolean(value); });
      return value;
    },
    disconnect() { client?.terminate(); },
    async close() {
      const closed = once(webSockets, 'close');
      for (const socket of webSockets.clients) socket.terminate();
      webSockets.close();
      await closed;
      await new Promise(resolve => server.close(resolve));
    },
  };
}
