import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ThreadResponse, ThreadSettingsResponse, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions, WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { eventItemKey, loadThread, reconcileThreadSnapshot } from './load-thread.ts';
import { sessionOptions } from './session-options.ts';
import { applyThreadEvent, isItemDelta } from './thread-state.ts';

export interface ConversationIdentity { hostId: string; threadId: string }
export interface ConversationSnapshot {
  thread: ThreadSummary | null;
  options: SubmitOptions | null;
  loading: boolean;
  historyComplete: boolean;
  streamGap: boolean;
  error: string | null;
  revision: number;
}
interface Creation { thread: ThreadSummary; settings: SubmitOptions }
interface Entry {
  identity: ConversationIdentity;
  value: ConversationSnapshot;
  listeners: Set<() => void>;
  owners: Map<symbol, boolean>;
  subscribed: boolean;
  initialized: boolean;
  generation: number;
  connectionRevision: number;
  reading: boolean;
  refreshRequested: boolean;
  observed: Set<string>;
  buffered: WorkbenchEvent[];
  operation: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  created?: { thread: ThreadSummary; settings: ThreadSettingsResponse };
  subscribe(listener: () => void): () => void;
  snapshot(): ConversationSnapshot;
}
const key = (scope: ConversationIdentity) => JSON.stringify([scope.hostId, scope.threadId]);
const empty: ConversationSnapshot = { thread: null, options: null, loading: false, historyComplete: false, streamGap: false, error: null, revision: 0 };
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
  }

  view(identity: ConversationIdentity): Entry {
    const id = key(identity), existing = this.entries.get(id);
    if (existing) return existing;
    const entry: Entry = { identity: { ...identity }, value: { ...empty, loading: true }, listeners: new Set(), owners: new Map(),
      subscribed: false, initialized: false, generation: 0, connectionRevision: 0, reading: false, refreshRequested: false,
      observed: new Set(), buffered: [], operation: Promise.resolve(),
      subscribe(listener) { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; },
      snapshot() { return entry.value; } };
    this.entries.set(id, entry); return entry;
  }
  private publish(entry: Entry, change: Partial<ConversationSnapshot>) {
    entry.value = { ...entry.value, ...change, revision: entry.value.revision + 1 };
    for (const listener of entry.listeners) listener();
  }
  acquire(identity: ConversationIdentity, readOnly: boolean) {
    const entry = this.view(identity), owner = Symbol();
    entry.owners.set(owner, readOnly);
    this.unsubscribe ??= this.client.subscribe(event => this.event(event));
    void this.ensure(entry).catch(error => this.failed(entry, error));
    return () => {
      entry.owners.delete(owner);
      if (entry.owners.size) {
        if ([...entry.owners.values()].every(readOnly => readOnly)) void this.ensure(entry).catch(error => this.failed(entry, error));
        return;
      }
      clearTimeout(entry.timer); entry.timer = undefined; entry.generation++;
      entry.operation = entry.operation.catch(() => {}).then(async () => {
        if (entry.owners.size) return;
        if (entry.subscribed && this.clientConnected()) await this.client.rpc('thread/unsubscribe', { threadId: identity.threadId }, identity.hostId);
        entry.subscribed = false; entry.initialized = false;
      }).catch(error => this.failed(entry, error));
    };
  }
  private clientConnected() {
    return !('connected' in this.client) || this.client.connected === true;
  }
  private failed(entry: Entry, error: unknown) {
    if (entry.owners.size) this.publish(entry, { loading: false, error: error instanceof Error ? error.message : String(error) });
  }
  private ensure(entry: Entry): Promise<void> {
    entry.operation = entry.operation.catch(() => {}).then(async () => {
      if (!entry.owners.size) return;
      const generation = entry.generation;
      const connectionRevision = entry.connectionRevision;
      const writable = [...entry.owners.values()].some(readOnly => !readOnly);
      if (!writable && entry.subscribed) {
        if (this.clientConnected()) await this.client.rpc('thread/unsubscribe', { threadId: entry.identity.threadId }, entry.identity.hostId);
        entry.subscribed = false;
      }
      if (!entry.subscribed && writable) {
        if (entry.created) {
          entry.subscribed = true; entry.initialized = true;
          this.publish(entry, { thread: entry.created.thread, options: sessionOptions(entry.created.settings), loading: false, error: null });
          return;
        }
        this.publish(entry, { error: null, historyComplete: false });
        const { hostId, threadId } = entry.identity;
        try {
          const response = await this.client.rpc<ThreadResponse>('thread/resume', { threadId, excludeTurns: true }, hostId);
          if (connectionRevision !== entry.connectionRevision) return;
          entry.subscribed = true;
          if (generation !== entry.generation || !entry.owners.size) return;
          this.publish(entry, { options: sessionOptions(response) });
        } catch (error) {
          const receipt = await this.creation(entry.identity);
          if (!receipt || !(error instanceof Error) || !error.message.includes('list_turns is not supported yet')) throw error;
          const metadata = await this.client.rpc<ThreadResponse>('thread/read', { threadId, includeTurns: false }, hostId);
          if (generation !== entry.generation || !entry.owners.size) return;
          if (metadata.thread.id !== threadId) throw new Error('The empty-thread receipt belongs to another conversation.');
          entry.initialized = true;
          this.publish(entry, { thread: metadata.thread, options: receipt.settings, loading: false, historyComplete: false,
            error: '新会话尚未形成首轮历史。草稿已保留，未自动发送。' });
          return;
        }
      }
      if (!entry.initialized || entry.refreshRequested) await this.read(entry);
    });
    return entry.operation;
  }
  private async read(entry: Entry) {
    if (!entry.owners.size || entry.reading) return;
    const generation = entry.generation;
    entry.reading = true; entry.refreshRequested = false;
    // Background history reconciliation must retain mounted editors and their
    // pending results; loading belongs to the first view of this identity.
    this.publish(entry, { error: null, historyComplete: false });
    try {
      const snapshot = await loadThread(this.client, entry.identity.hostId, entry.identity.threadId);
      if (!entry.owners.size || generation !== entry.generation) return;
      const observed = new Set(entry.observed), events = entry.buffered.splice(0);
      entry.initialized = true; delete entry.created;
      this.publish(entry, { thread: reconcileThreadSnapshot(snapshot, entry.value.thread, events, observed),
        loading: false, historyComplete: true,
        streamGap: snapshot.thread.turns.some(turn => turn.status === 'inProgress'
          && ![...observed].some(item => item.startsWith(JSON.stringify([turn.id]).slice(0, -1) + ','))) });
    } finally {
      entry.reading = false;
      if (entry.refreshRequested) this.schedule(entry);
    }
  }
  private schedule(entry: Entry) {
    entry.refreshRequested = true;
    if (!entry.owners.size || entry.reading || entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.ensure(entry).catch(error => this.failed(entry, error));
    }, 150);
  }
  refresh(identity: ConversationIdentity) {
    const entry = this.view(identity);
    entry.refreshRequested = true;
    return this.ensure(entry).catch(error => { this.failed(entry, error); throw error; });
  }
  async ready(identity: ConversationIdentity) {
    const entry = this.view(identity);
    await this.ensure(entry);
    if (!entry.owners.size || !entry.value.thread || entry.value.error) throw new Error(entry.value.error ?? 'Conversation is not ready.');
  }
  created(identity: ConversationIdentity, thread: ThreadSummary, settings: ThreadSettingsResponse) {
    if (thread.id !== identity.threadId) throw new Error('Created conversation identity changed.');
    const entry = this.view(identity);
    entry.created = { thread, settings }; entry.subscribed = true; entry.initialized = true;
    this.publish(entry, { thread, options: sessionOptions(settings), loading: false, error: null, historyComplete: false });
  }
  started(identity: ConversationIdentity, turn: TurnSummary) {
    const entry = this.view(identity);
    if (entry.value.thread) this.publish(entry, { thread: applyThreadEvent(entry.value.thread,
      { type: 'mcp-notification', method: 'turn/started', params: { threadId: identity.threadId, turn } }), historyComplete: false });
  }
  private event(event: WorkbenchEvent) {
    if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed') {
      const bridge = event.type === 'connection-state', hostId = bridge ? null : String(event.hostId);
      const previous = this.hostStates.get(hostId ?? 'bridge');
      this.hostStates.set(hostId ?? 'bridge', event.state);
      if (previous === event.state) return;
      for (const entry of this.entries.values()) if (entry.owners.size && (bridge || entry.identity.hostId === hostId)) {
        if (event.state !== 'connected') {
          entry.generation++; entry.connectionRevision++; entry.subscribed = false; entry.initialized = false;
          delete entry.created;
          entry.observed.clear(); entry.buffered.length = 0;
          this.publish(entry, { historyComplete: false, streamGap: true });
        } else void this.refresh(entry.identity).catch(error => this.failed(entry, error));
      }
      return;
    }
    if (event.type !== 'mcp-notification') return;
    const params = object(event.params);
    if (typeof event.hostId !== 'string' || typeof params.threadId !== 'string') return;
    const entry = this.entries.get(key({ hostId: event.hostId, threadId: params.threadId }));
    if (!entry?.owners.size) return;
    if (event.method === 'thread/settings/updated') {
      const settings = object(params.threadSettings) as ThreadSettingsResponse & { effort?: string | null; sandboxPolicy?: ThreadSettingsResponse['sandbox'] };
      this.publish(entry, { options: sessionOptions({ ...settings, reasoningEffort: settings.effort, sandbox: settings.sandboxPolicy }) });
    }
    const itemKey = eventItemKey(event);
    if (event.method === 'item/started' && itemKey) { entry.observed.add(itemKey); this.publish(entry, { streamGap: false }); }
    if (event.method === 'thread/reverted') {
      entry.generation++; entry.buffered.length = 0; entry.observed.clear(); entry.initialized = false;
      this.publish(entry, { thread: null, historyComplete: false }); this.schedule(entry); return;
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
