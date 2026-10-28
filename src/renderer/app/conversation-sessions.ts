import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { LateRpcTerminal, ThreadResponse, ThreadSettingsResponse, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions, WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { eventItemKey, loadThread, reconcileThreadSnapshot } from './load-thread.ts';
import { sessionOptions } from './session-options.ts';
import { applyThreadEvent, isItemDelta } from './thread-state.ts';
import { readThreadArchived } from './thread-archive.ts';

export interface ConversationIdentity { hostId: string; threadId: string }
export interface ConversationSnapshot {
  thread: ThreadSummary | null;
  options: SubmitOptions | null;
  loading: boolean;
  historyComplete: boolean;
  streamGap: boolean;
  error: string | null;
  canSubmit: boolean;
  canStartFirstTurn: boolean;
  archived: boolean | null;
}
interface Creation { thread: ThreadSummary; settings: SubmitOptions }
interface SubscriptionAttempt { kind: 'resume' | 'unsubscribe'; connectionRevision: number }
interface Entry {
  identity: ConversationIdentity;
  value: ConversationSnapshot;
  listeners: Set<() => void>;
  owners: Map<symbol, boolean>;
  subscribed: boolean;
  archived: boolean;
  archiveKnown: boolean;
  initialized: boolean;
  generation: number;
  connectionRevision: number;
  reading: boolean;
  refreshRequested: boolean;
  observed: Set<string>;
  buffered: WorkbenchEvent[];
  operation: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  subscription?: SubscriptionAttempt;
  emptyCreationRevision?: number;
  subscribe(listener: () => void): () => void;
  snapshot(): ConversationSnapshot;
}
const key = (scope: ConversationIdentity) => JSON.stringify([scope.hostId, scope.threadId]);
const empty: ConversationSnapshot = { thread: null, options: null, loading: false, historyComplete: false, streamGap: false, error: null, canSubmit: false, canStartFirstTurn: false, archived: null };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** One projection and daemon subscription for each actual host/thread, shared by its visible consumers. */
export class ConversationSessions {
  private entries = new Map<string, Entry>();
  private unsubscribe?: () => void;
  private hostStates = new Map<string, unknown>();
  private readonly client: WorkbenchClient;
  private readonly creation: (identity: ConversationIdentity) => Promise<Creation | undefined>;
  constructor(client: WorkbenchClient, creation: (identity: ConversationIdentity) => Promise<Creation | undefined>) {
    this.client = client; this.creation = creation;
    this.unsubscribe = this.client.subscribe(event => this.event(event));
  }

  view(identity: ConversationIdentity): Entry {
    const id = key(identity), existing = this.entries.get(id);
    if (existing) return existing;
    const entry: Entry = { identity: { ...identity }, value: { ...empty, loading: true }, listeners: new Set(), owners: new Map(),
      subscribed: false, archived: false, archiveKnown: false, initialized: false, generation: 0, connectionRevision: 0, reading: false, refreshRequested: false,
      observed: new Set(), buffered: [], operation: Promise.resolve(),
      subscribe(listener) { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; },
      snapshot() { return entry.value; } };
    this.entries.set(id, entry); return entry;
  }
  private publish(entry: Entry, change: Partial<ConversationSnapshot>) {
    const writable = entry.archiveKnown && !entry.archived && !entry.subscription && this.clientConnected(entry.identity.hostId)
      && [...entry.owners.values()].some(readOnly => !readOnly);
    entry.value = { ...entry.value, ...change, archived: entry.archiveKnown ? entry.archived : null, canSubmit: writable && entry.subscribed,
      canStartFirstTurn: writable && !entry.subscribed && entry.emptyCreationRevision === entry.connectionRevision };
    for (const listener of entry.listeners) listener();
  }
  acquire(identity: ConversationIdentity, readOnly: boolean) {
    const entry = this.view(identity), owner = Symbol();
    entry.owners.set(owner, readOnly);
    this.publish(entry, {});
    void this.ensure(entry).catch(() => {});
    return () => {
      entry.owners.delete(owner);
      if (entry.owners.size) {
        if (!readOnly && [...entry.owners.values()].every(readOnly => readOnly)) {
          entry.generation++; entry.initialized = false; entry.refreshRequested = true;
          entry.observed.clear(); entry.buffered.length = 0;
          this.publish(entry, { historyComplete: false, streamGap: entry.value.streamGap || Boolean(entry.value.thread?.turns.some(turn => turn.status === 'inProgress')) });
          void this.ensure(entry).catch(() => {});
        } else this.publish(entry, {});
        return;
      }
      clearTimeout(entry.timer); entry.timer = undefined; entry.generation++;
      delete entry.emptyCreationRevision;
      entry.archiveKnown = false;
      entry.initialized = false; entry.refreshRequested = true; entry.observed.clear(); entry.buffered.length = 0;
      this.publish(entry, { historyComplete: false, streamGap: entry.value.streamGap || Boolean(entry.value.thread?.turns.some(turn => turn.status === 'inProgress')) });
      void this.releaseSubscription(entry).catch(() => {});
    };
  }
  private clientConnected(hostId: string) {
    const bridge = this.hostStates.get('bridge'), host = this.hostStates.get(hostId);
    return (!('connected' in this.client) || this.client.connected === true)
      && (bridge === undefined || bridge === 'connected') && (host === undefined || host === 'connected');
  }
  private failed(entry: Entry, error: unknown, generation = entry.generation, connectionRevision = entry.connectionRevision) {
    if (entry.owners.size && generation === entry.generation && connectionRevision === entry.connectionRevision) {
      this.publish(entry, { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  private releaseSubscription(entry: Entry) {
    const generation = entry.generation, connectionRevision = entry.connectionRevision;
    entry.operation = entry.operation.catch(() => {}).then(async () => {
      if (entry.owners.size || entry.subscription) return;
      if (entry.subscribed && this.clientConnected(entry.identity.hostId)) await this.subscription(entry, 'unsubscribe');
      entry.initialized = false;
    }).catch(error => this.failed(entry, error, generation, connectionRevision));
    return entry.operation;
  }
  private async subscription(entry: Entry, kind: SubscriptionAttempt['kind']) {
    const generation = entry.generation;
    const attempt: SubscriptionAttempt = { kind, connectionRevision: entry.connectionRevision };
    entry.subscription = attempt; this.publish(entry, {});
    const terminal = (receipt: LateRpcTerminal, late: boolean) => {
      if (entry.subscription !== attempt || entry.connectionRevision !== attempt.connectionRevision) return;
      delete entry.subscription;
      if (receipt.outcome === 'success') {
        delete entry.emptyCreationRevision;
        entry.subscribed = kind === 'resume'; entry.initialized = false;
        if (kind === 'resume') {
          const response = receipt.result as ThreadResponse;
          if (response?.thread?.id !== entry.identity.threadId) {
            entry.subscribed = false;
            this.failed(entry, new Error('Subscription response belongs to another conversation.'), late ? entry.generation : generation, attempt.connectionRevision);
            this.publish(entry, {}); return;
          }
          // The result settles the actual connection's subscription even if its
          // original view left. A discarded view must not receive a late snapshot.
          if (entry.owners.size) this.publish(entry, { options: sessionOptions(response), error: null,
            thread: entry.value.thread ? { ...entry.value.thread, ...response.thread, turns: entry.value.thread.turns } : response.thread });
          else this.publish(entry, {});
        } else this.publish(entry, {});
        if (late) {
          if (entry.owners.size) void this.ensure(entry).catch(() => {});
          else void this.releaseSubscription(entry).catch(() => {});
        }
      } else {
        this.publish(entry, {});
        this.failed(entry, new Error(receipt.error.message), late ? entry.generation : generation, attempt.connectionRevision);
      }
    };
    try {
      const result = await this.client.rpc('thread/' + kind,
        { threadId: entry.identity.threadId, ...(kind === 'resume' ? { excludeTurns: true } : {}) }, entry.identity.hostId,
        { onLateTerminal: receipt => terminal(receipt, true) });
      terminal({ outcome: 'success', result }, false);
    } catch (error) {
      if (entry.subscription === attempt && object(error).uncertain !== true) {
        terminal({ outcome: 'error', error: { message: error instanceof Error ? error.message : String(error) } }, false);
      }
      throw error;
    }
  }
  private ensure(entry: Entry): Promise<void> {
    entry.operation = entry.operation.catch(() => {}).then(async () => {
      if (!entry.owners.size) return;
      const generation = entry.generation;
      const connectionRevision = entry.connectionRevision;
      try {
        if (!this.clientConnected(entry.identity.hostId)) throw new Error('会话连接已断开，输入已保留。');
        if (entry.subscription) throw new Error('原订阅操作的结果尚未确认；输入已保留，未重新订阅或发送。');
        if (!entry.archiveKnown) {
          const archived = await readThreadArchived(this.client, entry.identity);
          if (generation !== entry.generation || connectionRevision !== entry.connectionRevision || !entry.owners.size) return;
          entry.archived = archived; entry.archiveKnown = true; this.publish(entry, {});
        }
        const writable = !entry.archived && [...entry.owners.values()].some(readOnly => !readOnly);
        if (!writable && entry.subscribed) {
          await this.subscription(entry, 'unsubscribe');
        }
        if (!entry.subscribed && writable) {
          delete entry.emptyCreationRevision;
          this.publish(entry, { error: null, historyComplete: false });
          const { hostId, threadId } = entry.identity;
          try {
            await this.subscription(entry, 'resume');
          } catch (error) {
            if (generation !== entry.generation || connectionRevision !== entry.connectionRevision || !entry.owners.size) return;
            if (entry.subscription) throw error;
            const receipt = await this.creation(entry.identity);
            if (!receipt || receipt.thread.id !== threadId || receipt.thread.turns.length || entry.value.thread?.turns.length
              || !(error instanceof Error) || !/list_turns is not supported yet|no rollout found for thread/.test(error.message)) throw error;
            const metadata = await this.client.rpc<ThreadResponse>('thread/read', { threadId, includeTurns: false }, hostId);
            if (generation !== entry.generation || connectionRevision !== entry.connectionRevision || !entry.owners.size) return;
            if (metadata.thread.id !== threadId) throw new Error('The empty-thread receipt belongs to another conversation.');
            if (metadata.thread.turns.length || !['idle', 'notLoaded'].includes(metadata.thread.status.type)) throw error;
            entry.initialized = true;
            // A fresh metadata read plus the saved original creation permits an
            // explicit first turn. It does not establish a daemon subscription.
            entry.emptyCreationRevision = connectionRevision;
            this.publish(entry, { thread: metadata.thread, options: receipt.settings, loading: false, historyComplete: false,
              error: '新会话尚未形成首轮历史，当前连接尚未确认订阅。可明确发送首条消息；草稿已保留，未自动发送。' });
            return;
          }
          if (generation !== entry.generation || connectionRevision !== entry.connectionRevision || !entry.owners.size) return;
        }
        if (!entry.initialized || entry.refreshRequested) await this.read(entry);
      } catch (error) { this.failed(entry, error, generation, connectionRevision); throw error; }
    });
    return entry.operation;
  }
  private async read(entry: Entry) {
    if (!entry.owners.size || entry.reading) return;
    const generation = entry.generation, connectionRevision = entry.connectionRevision;
    entry.reading = true; entry.refreshRequested = false;
    // Background history reconciliation must retain mounted editors and their
    // pending results; loading belongs to the first view of this identity.
    this.publish(entry, { error: null, historyComplete: false });
    try {
      const snapshot = await loadThread(this.client, entry.identity.hostId, entry.identity.threadId);
      if (!entry.owners.size || generation !== entry.generation || connectionRevision !== entry.connectionRevision) return;
      const observed = new Set(entry.observed), events = entry.buffered.splice(0);
      entry.initialized = true;
      const thread = reconcileThreadSnapshot(snapshot, entry.value.thread, events, observed);
      const running = thread.turns.filter(turn => turn.status === 'inProgress');
      this.publish(entry, { thread,
        loading: false, historyComplete: true,
        streamGap: running.length > 0 && (entry.value.streamGap || running.some(turn =>
          ![...observed].some(item => item.startsWith(JSON.stringify([turn.id]).slice(0, -1) + ',')))) });
    } finally {
      entry.reading = false;
      if (generation !== entry.generation || connectionRevision !== entry.connectionRevision) entry.refreshRequested = true;
      if (entry.refreshRequested) this.schedule(entry);
    }
  }
  private schedule(entry: Entry) {
    entry.refreshRequested = true;
    if (!entry.owners.size || entry.reading || entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.ensure(entry).catch(() => {});
    }, 150);
  }
  refresh(identity: ConversationIdentity) {
    const entry = this.view(identity);
    entry.refreshRequested = true;
    return this.ensure(entry);
  }
  async ready(identity: ConversationIdentity, allowFirstTurn = false) {
    const entry = this.view(identity);
    await this.ensure(entry);
    if (!entry.value.thread || !(entry.value.canSubmit || allowFirstTurn && entry.value.canStartFirstTurn)) {
      throw Object.assign(new Error(entry.value.error ?? 'Conversation has no current writable subscription.'), { uncertain: false });
    }
  }
  started(identity: ConversationIdentity, turn: TurnSummary) {
    const entry = this.view(identity);
    delete entry.emptyCreationRevision;
    if (entry.value.thread) this.publish(entry, { thread: applyThreadEvent(entry.value.thread,
      { type: 'mcp-notification', method: 'turn/started', params: { threadId: identity.threadId, turn } }), historyComplete: false,
      streamGap: entry.value.streamGap || !entry.subscribed, error: null });
    if (!entry.subscribed) this.schedule(entry);
  }
  private event(event: WorkbenchEvent) {
    if (event.type === 'thread-created' && typeof event.hostId === 'string') {
      const response = object(event.result) as unknown as ThreadResponse;
      if (typeof response.thread?.id !== 'string') return;
      const entry = this.view({ hostId: event.hostId, threadId: response.thread.id });
      delete entry.emptyCreationRevision;
      entry.subscribed = true; entry.initialized = true; entry.refreshRequested = false;
      entry.archived = false; entry.archiveKnown = true;
      this.publish(entry, { thread: response.thread, options: sessionOptions(response), loading: false, error: null, historyComplete: false });
      return;
    }
    if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed') {
      const bridge = event.type === 'connection-state', hostId = bridge ? null : String(event.hostId);
      const previous = this.hostStates.get(hostId ?? 'bridge');
      this.hostStates.set(hostId ?? 'bridge', event.state);
      if (previous === event.state) return;
      for (const entry of this.entries.values()) if (bridge || entry.identity.hostId === hostId) {
        if (event.state !== 'connected') {
          entry.generation++; entry.connectionRevision++; entry.subscribed = false; entry.initialized = false;
          delete entry.subscription; delete entry.emptyCreationRevision; entry.refreshRequested = true;
          entry.archiveKnown = false;
          entry.observed.clear(); entry.buffered.length = 0;
          this.publish(entry, { historyComplete: false, streamGap: true });
        } else if (entry.owners.size) void this.refresh(entry.identity).catch(() => {});
      }
      return;
    }
    if (event.type !== 'mcp-notification') return;
    const params = object(event.params);
    if (typeof event.hostId !== 'string' || typeof params.threadId !== 'string') return;
    const entry = this.entries.get(key({ hostId: event.hostId, threadId: params.threadId }));
    if (entry && (event.method === 'thread/archived' || event.method === 'thread/unarchived')) {
      entry.archived = event.method === 'thread/archived';
      entry.archiveKnown = true;
      delete entry.emptyCreationRevision;
      this.publish(entry, {});
      if (entry.owners.size) void this.ensure(entry).catch(() => {});
      return;
    }
    if (!entry) return;
    if (!entry.owners.size) {
      entry.initialized = false; entry.refreshRequested = true; entry.observed.clear(); entry.buffered.length = 0;
      this.publish(entry, { historyComplete: false, streamGap: entry.value.streamGap || event.method === 'turn/started'
        || event.method === 'item/started' || isItemDelta(event) || Boolean(entry.value.thread?.turns.some(turn => turn.status === 'inProgress')) });
      return;
    }
    if (event.method === 'thread/settings/updated') {
      const settings = object(params.threadSettings) as ThreadSettingsResponse & { effort?: string | null; sandboxPolicy?: ThreadSettingsResponse['sandbox'] };
      this.publish(entry, { options: sessionOptions({ ...settings, reasoningEffort: settings.effort, sandbox: settings.sandboxPolicy }) });
    }
    const itemKey = eventItemKey(event);
    if (event.method === 'item/started' && itemKey) entry.observed.add(itemKey);
    if (event.method === 'thread/reverted') {
      entry.generation++; entry.buffered.length = 0; entry.observed.clear(); entry.initialized = false;
      this.publish(entry, { historyComplete: false }); this.schedule(entry); return;
    }
    if (event.method === 'turn/started' || event.method === 'turn/completed') this.publish(entry, { historyComplete: false });
    if (isItemDelta(event) && !entry.observed.has(itemKey ?? '')) this.publish(entry, { streamGap: true });
    if (entry.reading || !entry.initialized) entry.buffered.push(event);
    else if (entry.value.thread) this.publish(entry, { thread: applyThreadEvent(entry.value.thread, event) });
    if (event.method === 'turn/completed') this.schedule(entry);
  }
  dispose() {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    for (const entry of this.entries.values()) { clearTimeout(entry.timer); entry.generation++; entry.owners.clear(); }
  }
}

export function useConversationSession(sessions: ConversationSessions, identity: ConversationIdentity | null, readOnly: boolean, enabled: boolean, refresh: unknown) {
  const view = useMemo(() => identity ? sessions.view(identity) : null, [sessions, identity?.hostId, identity?.threadId]);
  const previous = useRef<{ view: Entry | null; refresh: unknown } | null>(null);
  useEffect(() => {
    if (!view || !enabled) return;
    return sessions.acquire(view.identity, readOnly);
  }, [sessions, view, readOnly, enabled]);
  useEffect(() => {
    const before = previous.current; previous.current = { view, refresh };
    if (view && enabled && before?.view === view && before.refresh !== refresh) void sessions.refresh(view.identity).catch(() => {});
  }, [sessions, view, refresh, enabled]);
  return useSyncExternalStore(view?.subscribe ?? (() => () => {}), view?.snapshot ?? (() => empty), () => empty);
}
