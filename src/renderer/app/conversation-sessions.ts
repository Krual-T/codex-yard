import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { LateRpcTerminal, ThreadItemSummary, ThreadResponse, ThreadSettingsResponse, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions, WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { eventItemKey, loadThread, reconcileThreadSnapshot } from './load-thread.ts';
import { sessionOptions } from './session-options.ts';
import { applyThreadEvent, isItemDelta } from './thread-state.ts';
import { readThreadArchived } from './thread-archive.ts';

export interface ConversationIdentity { hostId: string; threadId: string }
export interface EphemeralForkScope {
  hostId: string;
  parentThreadId: string;
  parentCwd: string;
  operationId: string;
  connectionGeneration: string;
  /** Identifies the one endpoint dispatch that actually claimed this fork. */
  forkDispatchId: string;
}
export interface EphemeralForkAuthority { isCurrent(): boolean; isForkUnsent(): boolean }
declare const ephemeralForkCapture: unique symbol;
export interface EphemeralForkCapture { readonly [ephemeralForkCapture]: true }
export interface EphemeralForkReceipt {
  scope: EphemeralForkScope;
  eventCursor: number;
  child: { thread: ThreadSummary & { ephemeral: true; forkedFromId: string }; options: SubmitOptions };
}
export interface ConversationSnapshot {
  thread: ThreadSummary | null;
  options: SubmitOptions | null;
  loading: boolean;
  historyComplete: boolean;
  /** An ephemeral fork's original event subscription is still valid, not a complete history. */
  liveReady: boolean;
  streamGap: boolean;
  error: string | null;
  canSubmit: boolean;
  canStartFirstTurn: boolean;
  archived: boolean | null;
}
interface Creation { thread: ThreadSummary; settings: SubmitOptions }
interface SubscriptionAttempt { kind: 'resume' | 'unsubscribe'; connectionRevision: number }
interface ForkCapture {
  scope: EphemeralForkScope;
  isCurrent: () => boolean;
  events: { event: WorkbenchEvent; bytes: number }[];
  bytes: number;
  overflow: boolean;
}
interface EphemeralEntry {
  scope: EphemeralForkScope;
  isCurrent: () => boolean;
  valid: boolean;
  optionsInvalid: boolean;
  modeUnknown: boolean;
  profileUnknown: boolean;
  lastSeq: number;
}
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
  ephemeral?: EphemeralEntry;
  subscribe(listener: () => void): () => void;
  snapshot(): ConversationSnapshot;
}
const key = (scope: ConversationIdentity) => JSON.stringify([scope.hostId, scope.threadId]);
const empty: ConversationSnapshot = { thread: null, options: null, loading: false, historyComplete: false, liveReady: false, streamGap: false, error: null, canSubmit: false, canStartFirstTurn: false, archived: null };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sameForkOperation = (a: EphemeralForkScope, b: EphemeralForkScope) => a.hostId === b.hostId
  && a.parentThreadId === b.parentThreadId && a.operationId === b.operationId;
const sameForkScope = (a: EphemeralForkScope, b: EphemeralForkScope) => a.hostId === b.hostId
  && a.parentThreadId === b.parentThreadId && a.parentCwd === b.parentCwd && a.operationId === b.operationId
  && a.connectionGeneration === b.connectionGeneration && a.forkDispatchId === b.forkDispatchId;
const sequence = (event: WorkbenchEvent): number | null => typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq > 0 ? event.seq : null;
const isCurrent = (check: () => boolean) => { try { return check() === true; } catch { return false; } };
const forkBufferLimit = 2048;
const forkBufferBytes = 2 * 1024 * 1024;
const invalidOptionsError = '侧聊原会话设置无法完整确认；已见内容和草稿已保留，未发送。';
const unavailableForkError = '侧聊原连接已失效或已关闭；已见内容和草稿已保留，未重新订阅或发送。';

function validForkThread(scope: EphemeralForkScope, thread: EphemeralForkReceipt['child']['thread']): boolean {
  return !!scope?.hostId && !!scope.parentThreadId && !!scope.parentCwd && !!scope.operationId && !!scope.connectionGeneration && !!scope.forkDispatchId
    && !!thread && typeof thread.id === 'string' && !!thread.id && thread.id !== scope.parentThreadId && thread.ephemeral === true
    && thread.forkedFromId === scope.parentThreadId && thread.cwd === scope.parentCwd
    && (thread.name === null || typeof thread.name === 'string') && Array.isArray(thread.turns)
    && thread.turns.every(turn => !!turn && typeof turn.id === 'string' && Array.isArray(turn.items)
      && turn.items.every(item => !!item && typeof item.id === 'string' && typeof item.type === 'string')
      && ['completed', 'interrupted', 'failed', 'inProgress'].includes(turn.status))
    && !!thread.status && ['idle', 'active', 'notLoaded', 'systemError'].includes(thread.status.type)
    && (thread.status.type !== 'active' || Array.isArray(thread.status.activeFlags)
      && thread.status.activeFlags.every(flag => typeof flag === 'string'));
}

function validEphemeralOptions(value: SubmitOptions): boolean {
  const policy = value.approvalPolicy;
  const granular = object(object(policy).granular);
  const validPolicy = policy === 'untrusted' || policy === 'on-request' || policy === 'never'
    || ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations']
      .every(field => typeof granular[field] === 'boolean');
  return typeof value.model === 'string' && value.model.length > 0
    && (value.effort === null || typeof value.effort === 'string' && value.effort.length > 0)
    && (value.serviceTier === null || typeof value.serviceTier === 'string' && value.serviceTier.length > 0)
    && validPolicy && ['user', 'auto_review', 'guardian_subagent'].includes(value.approvalsReviewer ?? '')
    && ['read-only', 'workspace-write', 'danger-full-access'].includes(value.sandboxMode ?? '')
    && (value.permissionProfileId === undefined || typeof value.permissionProfileId === 'string' && value.permissionProfileId.length > 0)
    && (value.mode === undefined || value.mode === 'default' || value.mode === 'plan');
}

function preserveObservedItem(previous: ThreadItemSummary, incoming: ThreadItemSummary, terminal = false): { item: ThreadItemSummary; conflict: boolean } {
  const item: ThreadItemSummary = { ...previous, ...incoming };
  let conflict = false;
  for (const field of ['text', 'aggregatedOutput', 'summary', 'content'] as const) {
    const old = previous[field], next = incoming[field];
    if (typeof old === 'string') {
      if (typeof next !== 'string') item[field] = old;
      else if (!next.startsWith(old) && !(terminal && previous.partialStart === true && next.includes(old))) {
        item[field] = old; if (!old.startsWith(next)) conflict = true;
      }
    } else if (Array.isArray(old) && old.every(part => typeof part === 'string')) {
      if (!Array.isArray(next) || !next.every(part => typeof part === 'string')) item[field] = old;
      else if (old.some((part, index) => typeof next[index] !== 'string' || !next[index].startsWith(part)
        && !(terminal && previous.partialStart === true && next[index].includes(part)))) {
        item[field] = old;
        if (old.some((part, index) => typeof next[index] === 'string' && !next[index].startsWith(part) && !part.startsWith(next[index])
          && !(terminal && previous.partialStart === true && next[index].includes(part)))) conflict = true;
      }
    }
  }
  if (previous.streamComplete === true) item.streamComplete = true;
  if (previous.partialStart === true) item.partialStart = true;
  return { item, conflict };
}

function updatedEphemeralOptions(previous: SubmitOptions | null, raw: Record<string, unknown>): SubmitOptions {
  const next = { ...previous };
  const fields: [string, keyof SubmitOptions][] = [
    ['model', 'model'], ['effort', 'effort'], ['reasoningEffort', 'effort'], ['approvalPolicy', 'approvalPolicy'],
    ['approvalsReviewer', 'approvalsReviewer'], ['activePermissionProfile', 'permissionProfileId'],
    ['sandbox', 'sandboxMode'], ['sandboxPolicy', 'sandboxMode'], ['serviceTier', 'serviceTier'], ['collaborationMode', 'mode'],
  ];
  for (const [source, target] of fields) if (Object.hasOwn(raw, source)) delete next[target];
  const settings = raw as ThreadSettingsResponse & { effort?: string | null; sandboxPolicy?: ThreadSettingsResponse['sandbox'] };
  return { ...next, ...sessionOptions({ ...settings,
    reasoningEffort: Object.hasOwn(raw, 'effort') ? settings.effort : settings.reasoningEffort,
    sandbox: Object.hasOwn(raw, 'sandboxPolicy') ? settings.sandboxPolicy : settings.sandbox }) };
}

/** One projection and daemon subscription for each actual host/thread, shared by its visible consumers. */
export class ConversationSessions {
  private entries = new Map<string, Entry>();
  private unsubscribe?: () => void;
  private hostStates = new Map<string, unknown>();
  private bridgeState: unknown;
  private forkCaptures = new Map<EphemeralForkCapture, ForkCapture>();
  private readonly client: WorkbenchClient;
  private readonly creation: (identity: ConversationIdentity) => Promise<Creation | undefined>;
  constructor(client: WorkbenchClient, creation: (identity: ConversationIdentity) => Promise<Creation | undefined>) {
    this.client = client; this.creation = creation;
    this.unsubscribe = this.client.subscribe(event => this.event(event));
  }

  /** Capture before the side-chat fork is sent, on its original authorized socket. */
  captureEphemeralFork(scope: EphemeralForkScope, authority: EphemeralForkAuthority): EphemeralForkCapture {
    if (!scope.hostId || !scope.parentThreadId || !scope.parentCwd || !scope.operationId || !scope.connectionGeneration || !scope.forkDispatchId
      || this.bridgeState !== 'connected' || this.hostStates.get(scope.hostId) !== 'connected'
      || !this.clientConnected(scope.hostId) || !isCurrent(authority.isCurrent) || !isCurrent(authority.isForkUnsent) || !this.unsubscribe) {
      throw new Error('侧聊原连接或操作身份尚未确认。');
    }
    for (const [token, pending] of this.forkCaptures) {
      if (sameForkOperation(pending.scope, scope)) this.forkCaptures.delete(token);
    }
    const token = Object.freeze({}) as EphemeralForkCapture;
    this.forkCaptures.set(token, { scope: { ...scope }, isCurrent: authority.isCurrent, events: [], bytes: 0, overflow: false });
    return token;
  }

  cancelEphemeralFork(token: EphemeralForkCapture): void { this.forkCaptures.delete(token); }

  /** Install only the original fork receipt; never resume or read an ephemeral history. */
  installEphemeralFork(token: EphemeralForkCapture, receipt: EphemeralForkReceipt): boolean {
    const pending = this.forkCaptures.get(token);
    if (!pending) return false;
    this.forkCaptures.delete(token);
    const thread = receipt?.child?.thread, scope = pending.scope;
    if (!receipt?.scope || !sameForkScope(scope, receipt.scope) || !isCurrent(pending.isCurrent) || !this.clientConnected(scope.hostId)
      || this.bridgeState !== 'connected' || this.hostStates.get(scope.hostId) !== 'connected'
      || !Number.isSafeInteger(receipt.eventCursor) || receipt.eventCursor < 0
      || !validForkThread(scope, thread)
      || !receipt.child.options || Array.isArray(receipt.child.options)
      || typeof receipt.child.options !== 'object' || !validEphemeralOptions(receipt.child.options)) return false;
    let initial: typeof thread, options: SubmitOptions;
    try { initial = structuredClone(thread); options = structuredClone(receipt.child.options); } catch { return false; }
    const identity = { hostId: scope.hostId, threadId: thread.id }, entry = this.view(identity);
    if (entry.ephemeral || entry.owners.size || entry.subscribed || entry.subscription || entry.reading || entry.value.thread) return false;
    entry.generation++; entry.initialized = true; entry.refreshRequested = false; entry.subscribed = true;
    entry.operation = Promise.resolve();
    entry.archiveKnown = true; entry.archived = false;
    entry.ephemeral = { scope, isCurrent: pending.isCurrent, valid: true, optionsInvalid: false, modeUnknown: false, profileUnknown: false, lastSeq: 0 };
    for (const turn of initial.turns) for (const item of turn.items ?? []) entry.observed.add(JSON.stringify([turn.id, item.id]));
    this.publish(entry, { thread: initial, options, loading: false, historyComplete: false, error: null,
      streamGap: pending.overflow || initial.status.type !== 'idle' || initial.turns.some(turn => turn.status === 'inProgress') });
    const matching = pending.events.map(value => value.event).filter(event => object(event.params).threadId === thread.id);
    if (matching.some(event => sequence(event) === null)) this.publish(entry, { streamGap: true });
    const ordered = matching.filter(event => sequence(event) !== null).sort((a, b) => sequence(a)! - sequence(b)!);
    // The fork omits turns, so retain observed turn events even if they raced the receipt.
    for (const event of ordered) if (sequence(event)! <= receipt.eventCursor
      && /^(turn\/(started|completed|plan\/updated|diff\/updated)|item\/)/.test(String(event.method))) this.ephemeralEvent(entry, event);
    entry.ephemeral.lastSeq = Math.max(entry.ephemeral.lastSeq, receipt.eventCursor);
    const reconciled = entry.snapshot().thread;
    if (reconciled) this.publish(entry, { thread: { ...reconciled, status: initial.status },
      streamGap: entry.value.streamGap || initial.status.type === 'idle' && reconciled.turns.some(turn => turn.status === 'inProgress') });
    for (const event of ordered) if (sequence(event)! > receipt.eventCursor) this.ephemeralEvent(entry, event);
    if (!this.ephemeralCurrent(entry)) { this.invalidateEphemeralEntry(entry); return false; }
    return true;
  }

  /** Register a known fork without claiming its former socket or unseen history survived a page reload. */
  registerUnavailableEphemeral(scope: EphemeralForkScope, child: { thread: EphemeralForkReceipt['child']['thread']; options: SubmitOptions | null }): boolean {
    if (!child || !validForkThread(scope, child.thread) || child.options !== null
      && (typeof child.options !== 'object' || Array.isArray(child.options))) return false;
    if ([...this.forkCaptures.values()].some(capture => sameForkOperation(capture.scope, scope))) return false;
    let saved: typeof child;
    try { saved = structuredClone(child); } catch { return false; }
    const entry = this.view({ hostId: scope.hostId, threadId: saved.thread.id });
    if (entry.ephemeral || entry.owners.size || entry.subscribed || entry.subscription || entry.reading || entry.value.thread) return false;
    entry.generation++; entry.initialized = true; entry.refreshRequested = false; entry.subscribed = false;
    entry.operation = Promise.resolve();
    entry.archiveKnown = false;
    entry.ephemeral = { scope: { ...scope }, isCurrent: () => false, valid: false, optionsInvalid: true, modeUnknown: false, profileUnknown: false, lastSeq: 0 };
    this.publish(entry, { thread: saved.thread, options: saved.options, loading: false, historyComplete: false,
      streamGap: true, error: unavailableForkError });
    return true;
  }

  /** The side-chat endpoint, not this projection, owns the actual unsubscribe. */
  invalidateEphemeral(scope: EphemeralForkScope, threadId: string): boolean {
    const entry = this.entries.get(key({ hostId: scope.hostId, threadId }));
    if (!entry?.ephemeral || !sameForkScope(entry.ephemeral.scope, scope)) return false;
    this.invalidateEphemeralEntry(entry);
    return true;
  }

  private ephemeralCurrent(entry: Entry): boolean {
    const state = entry.ephemeral;
    return !!state?.valid && this.clientConnected(entry.identity.hostId) && isCurrent(state.isCurrent);
  }
  private invalidateEphemeralEntry(entry: Entry) {
    if (!entry.ephemeral?.valid) return;
    entry.ephemeral.valid = false; entry.subscribed = false; entry.generation++;
    this.publish(entry, { loading: false, historyComplete: false, streamGap: true, error: unavailableForkError });
  }

  private ephemeralEvent(entry: Entry, incoming: WorkbenchEvent) {
    const state = entry.ephemeral;
    if (!state || !this.ephemeralCurrent(entry)) { this.invalidateEphemeralEntry(entry); return; }
    const seq = sequence(incoming);
    if (seq === null) { this.publish(entry, { streamGap: true }); return; }
    if (seq <= state.lastSeq) { this.publish(entry, { streamGap: true }); return; }
    state.lastSeq = seq;
    const params = object(incoming.params), method = String(incoming.method);
    if (method === 'thread/archived' || method === 'thread/unarchived') {
      entry.archived = method === 'thread/archived'; this.publish(entry, {}); return;
    }
    if (method === 'thread/settings/updated') {
      const raw = object(params.threadSettings), options = updatedEphemeralOptions(entry.value.options, raw);
      const mode = raw.collaborationMode;
      const modeValue = typeof mode === 'string' ? mode : object(mode).mode;
      if (Object.hasOwn(raw, 'collaborationMode')) state.modeUnknown = mode != null && modeValue !== 'default' && modeValue !== 'plan';
      if (Object.hasOwn(raw, 'activePermissionProfile')) state.profileUnknown = raw.activePermissionProfile != null
        && (typeof object(raw.activePermissionProfile).id !== 'string' || object(raw.activePermissionProfile).id === '');
      state.optionsInvalid = !validEphemeralOptions(options) || state.modeUnknown || state.profileUnknown;
      this.publish(entry, { options, error: state.optionsInvalid ? invalidOptionsError
        : entry.value.error === invalidOptionsError ? null : entry.value.error });
      return;
    }
    if (method === 'thread/reverted') {
      this.publish(entry, { streamGap: true }); return;
    }
    const current = entry.value.thread;
    if (!current) return;
    const turnId = typeof params.turnId === 'string' ? params.turnId : object(params.turn).id;
    const turn = current.turns.find(value => value.id === turnId);
    const itemId = typeof params.itemId === 'string' ? params.itemId : object(params.item).id;
    const previous = turn?.items.find(item => item.id === itemId);
    if (previous?.streamComplete === true && (method === 'item/started' || isItemDelta(incoming))) return;
    let event = incoming, conflict = !turn && (method.startsWith('item/') || method === 'turn/plan/updated' || method === 'turn/diff/updated');
    const itemKey = eventItemKey(event);
    if (method === 'item/started' && previous?.partialStart === true) {
      event = { ...event, params: { ...params, item: { ...object(params.item), ...previous } } };
    } else if (method === 'item/completed' && previous) {
      const item = object(params.item) as ThreadItemSummary;
      const preserved = preserveObservedItem(previous, item, true); conflict = preserved.conflict;
      event = { ...event, params: { ...params, item: preserved.item } };
    } else if (method === 'turn/started' || method === 'turn/completed') {
      const summary = object(params.turn);
      if (method === 'turn/completed' && !turn && summary.itemsView !== 'full') conflict = true;
      if (turn && Array.isArray(summary.items)) {
        const full = method === 'turn/completed' && summary.itemsView === 'full';
        let items = summary.items.map(value => {
          const item = object(value) as ThreadItemSummary, old = turn.items.find(candidate => candidate.id === item.id);
          if (!old) return value;
          if (old.type !== item.type) { conflict = true; return old; }
          const preserved = preserveObservedItem(old, item, full); conflict ||= preserved.conflict;
          return preserved.item;
        });
        if (full) {
          const byId = new Map(items.map(value => [object(value).id, value]));
          const previousIds = new Set(turn.items.map(item => item.id));
          if (turn.items.some(item => !byId.has(item.id))) conflict = true;
          items = [...turn.items.map(item => byId.get(item.id) ?? item),
            ...items.filter(value => !previousIds.has(String(object(value).id)))];
        }
        event = { ...event, params: { ...params, turn: { ...summary, items } } };
      }
    }
    if (method === 'item/started' && itemKey) entry.observed.add(itemKey);
    if (isItemDelta(event) && !entry.observed.has(itemKey ?? '')) conflict = true;
    this.publish(entry, { thread: applyThreadEvent(current, event), historyComplete: false,
      streamGap: entry.value.streamGap || conflict });
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
    const ephemeralCurrent = !!entry.ephemeral && this.ephemeralCurrent(entry);
    const writable = entry.archiveKnown && !entry.archived && !entry.subscription && this.clientConnected(entry.identity.hostId)
      && (!entry.ephemeral || ephemeralCurrent && !entry.ephemeral.optionsInvalid)
      && [...entry.owners.values()].some(readOnly => !readOnly);
    entry.value = { ...entry.value, ...change, archived: entry.archiveKnown ? entry.archived : null, canSubmit: writable && entry.subscribed,
      liveReady: !!entry.ephemeral && entry.subscribed && !entry.archived && ephemeralCurrent,
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
      if (entry.ephemeral) { this.publish(entry, {}); return; }
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
    const bridge = this.bridgeState, host = this.hostStates.get(hostId);
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
      if (entry.ephemeral || entry.owners.size || entry.subscription) return;
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
        if (entry.ephemeral) {
          if (!this.ephemeralCurrent(entry)) this.invalidateEphemeralEntry(entry);
          else this.publish(entry, {});
          return;
        }
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
    if (entry.ephemeral && !this.ephemeralCurrent(entry)) { this.invalidateEphemeralEntry(entry); return; }
    delete entry.emptyCreationRevision;
    let conflict = false;
    const previous = entry.ephemeral && entry.value.thread?.turns.find(value => value.id === turn.id);
    if (previous && turn.status === 'inProgress') turn = { ...turn, items: turn.items.map(item => {
      const old = previous.items.find(candidate => candidate.id === item.id);
      if (!old) return item;
      const preserved = preserveObservedItem(old, item); conflict ||= preserved.conflict; return preserved.item;
    }) };
    if (entry.value.thread) this.publish(entry, { thread: applyThreadEvent(entry.value.thread,
      { type: 'mcp-notification', method: 'turn/started', params: { threadId: identity.threadId, turn } }), historyComplete: false,
      streamGap: entry.value.streamGap || !entry.subscribed || conflict, error: entry.ephemeral?.optionsInvalid ? invalidOptionsError : null });
    if (!entry.subscribed && !entry.ephemeral) this.schedule(entry);
  }
  private event(event: WorkbenchEvent) {
    if (event.type === 'thread-created' && typeof event.hostId === 'string') {
      const response = object(event.result) as unknown as ThreadResponse;
      if (typeof response.thread?.id !== 'string') return;
      const entry = this.view({ hostId: event.hostId, threadId: response.thread.id });
      if (entry.ephemeral) return;
      delete entry.emptyCreationRevision;
      entry.subscribed = true; entry.initialized = true; entry.refreshRequested = false;
      entry.archived = false; entry.archiveKnown = true;
      this.publish(entry, { thread: response.thread, options: sessionOptions(response), loading: false, error: null, historyComplete: false });
      return;
    }
    if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed') {
      const bridge = event.type === 'connection-state', hostId = bridge ? null : String(event.hostId);
      const previous = bridge ? this.bridgeState : this.hostStates.get(hostId!);
      if (bridge) this.bridgeState = event.state; else this.hostStates.set(hostId!, event.state);
      if (previous === event.state) return;
      if (event.state !== 'connected') for (const [token, capture] of this.forkCaptures) {
        if (bridge || capture.scope.hostId === hostId) this.forkCaptures.delete(token);
      }
      for (const entry of this.entries.values()) if (bridge || entry.identity.hostId === hostId) {
        if (entry.ephemeral) {
          if (event.state !== 'connected') { entry.connectionRevision++; this.invalidateEphemeralEntry(entry); }
          else if (!this.ephemeralCurrent(entry)) this.invalidateEphemeralEntry(entry);
          continue;
        }
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
    const captures = [...this.forkCaptures.values()].filter(capture => capture.scope.hostId === event.hostId);
    if (captures.length) {
      let bytes = Infinity;
      try { bytes = JSON.stringify(event).length * 2; } catch { /* An unrepresentable event cannot prove continuity. */ }
      for (const capture of captures) {
        if (bytes > forkBufferBytes) { capture.overflow = true; continue; }
        while (capture.events.length && (capture.events.length >= forkBufferLimit || capture.bytes + bytes > forkBufferBytes)) {
          capture.bytes -= capture.events.shift()!.bytes; capture.overflow = true;
        }
        capture.events.push({ event, bytes }); capture.bytes += bytes;
      }
    }
    const entry = this.entries.get(key({ hostId: event.hostId, threadId: params.threadId }));
    if (entry?.ephemeral) { this.ephemeralEvent(entry, event); return; }
    if (entry && (event.method === 'thread/archived' || event.method === 'thread/unarchived')) {
      // An archive-list page may have been read before this newer notification.
      // Reuse the view generation so neither that query nor its history can
      // restore permissions from an older archive state.
      entry.generation++; entry.initialized = false; entry.refreshRequested = true;
      entry.observed.clear(); entry.buffered.length = 0;
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
    this.forkCaptures.clear();
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer); entry.generation++; entry.owners.clear();
      if (entry.ephemeral) this.invalidateEphemeralEntry(entry);
    }
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
