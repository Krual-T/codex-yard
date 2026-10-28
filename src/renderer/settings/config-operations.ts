import type { WorkbenchClient } from '../workbench-contract.ts';
import { readBrowserAtom, subscribeBrowserAtoms, updateBrowserAtom } from '../storage/ui-atoms.ts';

export type SettingsWriteMethod = 'config/batchWrite' | 'skills/config/write';
export type SettingsWriteSection = 'models' | 'agent' | 'worktrees' | 'hooks-settings' | 'skills-settings';
export interface SettingsWriteOrigin { section: SettingsWriteSection; scope?: readonly string[]; draft: unknown }
export type WriteTerminal = { kind: 'ok' | 'okOverridden' } | { kind: 'effectiveEnabled'; value: boolean }
  | { kind: 'rejected'; code?: number } | { kind: 'not-sent'; code?: 'OBSERVER_LIMIT' };
export interface WriteStatus {
  operationId: string; hostId: string; method?: SettingsWriteMethod;
  state: 'pending' | 'unknown' | 'succeeded' | 'failed'; terminal?: WriteTerminal;
  observedTerminal?: WriteTerminal; storageError?: true;
}
export interface SettingsWriteRecord {
  operationId: string; hostId: string; method: SettingsWriteMethod; params: Record<string, unknown>;
  origin: SettingsWriteOrigin; phase: 'pending' | 'unknown' | 'finished' | 'not-started' | 'blocked';
  operation?: WriteStatus; blocker?: WriteStatus; result?: unknown; error?: string;
  workingDrafts?: { editorId: string; revision: number; draft: unknown }[];
}
export interface SettingsWriteStorage {
  read(): Promise<unknown>;
  update(change: (value: unknown) => unknown): Promise<unknown>;
  subscribe(listener: () => void): () => void;
}

const atomKey = 'codex-yard.settings-config-writes.v1';
const browserStorage: SettingsWriteStorage = {
  read: () => readBrowserAtom(atomKey),
  update: change => updateBrowserAtom(atomKey, change),
  subscribe: listener => subscribeBrowserAtoms(keys => { if (!keys.length || keys.includes(atomKey)) listener(); }),
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const methods = new Set(['config/batchWrite', 'skills/config/write']);
const sections = new Set(['models', 'agent', 'worktrees', 'hooks-settings', 'skills-settings']);
const phases = new Set(['pending', 'unknown', 'finished', 'not-started', 'blocked']);

export function createSettingsWriteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function records(value: unknown): SettingsWriteRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Configuration recovery records cannot be read. Writes are blocked.');
  const ids = new Set<string>();
  for (const item of value) {
    if (!object(item) || typeof item.operationId !== 'string' || !item.operationId || ids.has(item.operationId)
      || typeof item.hostId !== 'string' || !item.hostId || !methods.has(String(item.method)) || !object(item.params)
      || !object(item.origin) || !sections.has(String(item.origin.section)) || !Object.hasOwn(item.origin, 'draft')
      || item.origin.scope !== undefined && (!Array.isArray(item.origin.scope) || item.origin.scope.some((v: unknown) => typeof v !== 'string'))
      || item.workingDrafts !== undefined && (!Array.isArray(item.workingDrafts) || item.workingDrafts.some((entry: unknown) => !object(entry)
        || typeof entry.editorId !== 'string' || !Number.isSafeInteger(entry.revision) || !Object.hasOwn(entry, 'draft')))
      || !phases.has(String(item.phase))) throw new Error('Configuration recovery records cannot be read. Writes are blocked.');
    const operation = item.operation === undefined ? null : status(item.operation, item.operationId, item.hostId, item.method as SettingsWriteMethod);
    if (item.operation !== undefined && !operation || item.phase === 'finished' && (!operation || !completed(operation))) {
      throw new Error('A configuration receipt cannot be verified. Writes are blocked.');
    }
    if (item.phase === 'blocked' && (!object(item.blocker) || typeof item.blocker.operationId !== 'string'
      || item.blocker.operationId === item.operationId || typeof item.blocker.hostId !== 'string'
      || !status(item.blocker, item.blocker.operationId, item.blocker.hostId, item.blocker.method as SettingsWriteMethod | undefined))) {
      throw new Error('A blocking configuration operation cannot be verified. Writes are blocked.');
    }
    ids.add(item.operationId);
  }
  return value as SettingsWriteRecord[];
}
function terminal(value: unknown, method: SettingsWriteMethod, state: string): value is WriteTerminal {
  if (!object(value)) return false;
  if (state === 'succeeded') return method === 'config/batchWrite' && (value.kind === 'ok' || value.kind === 'okOverridden')
    || method === 'skills/config/write' && value.kind === 'effectiveEnabled' && typeof value.value === 'boolean';
  return state === 'failed' && (value.kind === 'rejected' && (value.code === undefined || Number.isSafeInteger(value.code))
    || value.kind === 'not-sent' && (value.code === undefined || value.code === 'OBSERVER_LIMIT'));
}
function status(value: unknown, id: string, hostId: string, method?: SettingsWriteMethod): WriteStatus | null {
  if (!object(value) || value.operationId !== id || value.hostId !== hostId
    || method && value.method !== undefined && value.method !== method
    || !['pending', 'unknown', 'succeeded', 'failed'].includes(String(value.state))
    || value.storageError !== undefined && value.storageError !== true) return null;
  if ((value.state === 'succeeded' || value.state === 'failed') && (!method || !terminal(value.terminal, method, value.state))) return null;
  return value as unknown as WriteStatus;
}
function active(record: SettingsWriteRecord) { return record.phase === 'pending' || record.phase === 'unknown' || record.phase === 'blocked'; }
function completed(operation: WriteStatus) {
  return !operation.storageError && (operation.state === 'succeeded' || operation.state === 'failed');
}
function terminalResult(operation: WriteStatus): unknown {
  const result = operation.terminal;
  if (result?.kind === 'ok' || result?.kind === 'okOverridden') return { status: result.kind };
  if (result?.kind === 'effectiveEnabled') return { effectiveEnabled: result.value };
  return undefined;
}

export class SettingsWriteError extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain: boolean) { super(message); this.name = 'SettingsWriteError'; this.uncertain = uncertain; }
}
export interface SettingsWriteSnapshot { records: SettingsWriteRecord[]; loading: boolean; error: string | null; localRetry: string[]; draftRetry: string[]; draftPending: number }
interface PendingDraft { hostId: string; section: SettingsWriteSection; scope?: readonly string[]; draft: unknown; record: SettingsWriteRecord | null }
interface PendingReceipt { patch: Partial<SettingsWriteRecord>; record?: SettingsWriteRecord }

/** Settings-only recovery records in the existing browser atom transaction. */
export class SettingsConfigOperations {
  private client: WorkbenchClient;
  private storage: SettingsWriteStorage;
  private newId: () => string;
  private snapshot: SettingsWriteSnapshot = { records: [], loading: true, error: null, localRetry: [], draftRetry: [], draftPending: 0 };
  private listeners = new Set<() => void>();
  private localPending = new Map<string, PendingReceipt>();
  private localDraftPending = new Map<string, PendingDraft>();
  private draftPending = 0;
  private sequence = 0;
  private unsubscribe: (() => void) | null = null;
  constructor(client: WorkbenchClient, storage: SettingsWriteStorage = browserStorage,
    newId: () => string = createSettingsWriteId) {
    this.client = client; this.storage = storage; this.newId = newId;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.unsubscribe) this.unsubscribe = this.storage.subscribe(() => { void this.refresh(); });
    return () => { this.listeners.delete(listener); if (!this.listeners.size) { this.unsubscribe?.(); this.unsubscribe = null; } };
  };
  private publish(patch: Partial<SettingsWriteSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, localRetry: [...this.localPending.keys()], draftRetry: [...this.localDraftPending.keys()], draftPending: this.draftPending };
    for (const listener of this.listeners) listener();
  }
  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    try {
      const value = records(await this.storage.read());
      if (sequence === this.sequence) this.publish({ records: value, loading: false, error: null });
    } catch (error) { if (sequence === this.sequence) this.publish({ loading: false, error: message(error) }); }
  }
  async find(hostId: string, section: SettingsWriteSection, scope?: readonly string[]): Promise<SettingsWriteRecord | null> {
    const list = records(await this.storage.read());
    return [...list].reverse().find(item => item.hostId === hostId && item.origin.section === section
      && JSON.stringify(item.origin.scope ?? []) === JSON.stringify(scope ?? [])) ?? null;
  }
  async saveDraft(hostId: string, section: SettingsWriteSection, scope: readonly string[] | undefined,
    editorId: string, draft: unknown): Promise<void> {
    let previous = this.localDraftPending.get(editorId)?.record ?? null;
    const copy = structuredClone(draft);
    this.draftPending++; this.publish({});
    try {
      const found = await this.find(hostId, section, scope);
      previous = found ?? previous;
      if (!previous) {
        if (this.localDraftPending.has(editorId)) throw new Error('The original saved operation is unavailable; the newer edit remains in this page.');
        return;
      }
      const original = previous;
      await this.storage.update(value => {
        const list = records(value), index = list.findIndex(item => item.operationId === original.operationId);
        const item = index < 0 ? original : list[index]!;
        const existing = item.workingDrafts ?? [];
        const revision = Math.max(0, ...existing.map(entry => entry.revision)) + 1;
        const next = { ...item, workingDrafts: [...existing.filter(entry => entry.editorId !== editorId), { editorId, revision, draft: copy }] };
        if (index < 0) list.push(next); else list[index] = next;
        return list;
      });
      this.localDraftPending.delete(editorId);
      await this.refresh();
    } catch (error) {
      this.localDraftPending.set(editorId, { hostId, section, scope, draft: copy, record: previous });
      this.publish({ error: `The browser could not save a newer configuration edit: ${message(error)}` });
      throw error;
    } finally { this.draftPending--; this.publish({}); }
  }
  async retryDraft(editorId: string): Promise<void> {
    const pending = this.localDraftPending.get(editorId);
    if (!pending) throw new Error('The newer browser edit is no longer available.');
    await this.saveDraft(pending.hostId, pending.section, pending.scope, editorId, pending.draft);
  }
  private async change(id: string, patch: Partial<SettingsWriteRecord>, fallback?: SettingsWriteRecord) {
    await this.storage.update(value => {
      const list = records(value), index = list.findIndex(item => item.operationId === id);
      const original = index < 0 ? fallback : list[index];
      if (!original || original.operationId !== id) throw new Error('The original local configuration record is missing.');
      const stale = (original.phase === 'finished' || original.phase === 'not-started')
        && (patch.phase === 'unknown' || patch.phase === 'pending' || patch.phase === 'blocked');
      const safePatch = stale ? patch.result !== undefined && original.result === undefined ? { result: patch.result } : {} : patch;
      const next = { ...original, ...safePatch, operationId: original.operationId, hostId: original.hostId,
        method: original.method, params: original.params, origin: original.origin };
      if (index < 0) list.push(next); else list[index] = next;
      return list;
    });
    this.localPending.delete(id); await this.refresh();
  }
  private async saveObservation(id: string, patch: Partial<SettingsWriteRecord>, fallback?: SettingsWriteRecord) {
    try { await this.change(id, patch, fallback); }
    catch (error) {
      this.localPending.set(id, { patch, record: fallback ?? this.localPending.get(id)?.record });
      this.publish({ error: `The browser could not save the original receipt: ${message(error)}. Retry saving the receipt.` });
      throw new SettingsWriteError('The browser could not save the original receipt. Your edit is preserved.', true);
    }
  }
  async retryLocal(id: string): Promise<void> {
    const pending = this.localPending.get(id);
    if (!pending) throw new Error('The original browser receipt is no longer available. Check the host operation.');
    await this.saveObservation(id, pending.patch, pending.record);
  }
  async submit(hostId: string, method: SettingsWriteMethod, params: Record<string, unknown>, origin: SettingsWriteOrigin,
    canDispatch: () => boolean = () => true): Promise<{ operationId: string; result: unknown }> {
    const operationId = this.newId();
    if (!operationId) throw new SettingsWriteError('Cannot create a configuration operation ID.', false);
    const entry: SettingsWriteRecord = structuredClone({ operationId, hostId, method, params, origin, phase: 'pending' as const });
    try {
      await this.storage.update(value => {
        const list = records(value);
        if (list.some(active)) throw new Error('An earlier configuration save must be checked before another save.');
        if (list.some(item => item.operationId === operationId)) throw new Error('The configuration operation ID is already in use.');
        return [...list, entry];
      });
      await this.refresh();
    } catch (error) { throw new SettingsWriteError(`Could not save the original operation in the browser: ${message(error)}`, false); }
    if (!canDispatch()) {
      await this.saveObservation(operationId, { phase: 'not-started', error: 'The save was interrupted before it was sent.' }, entry);
      throw new SettingsWriteError('The save was interrupted before it was sent.', false);
    }
    let response: unknown;
    try { response = await this.client.host('configuration-write', { hostId, action: 'submit', operationId, method, params: entry.params }); }
    catch (error) {
      await this.saveObservation(operationId, { phase: 'unknown', error: `The original save could not be confirmed: ${message(error)}` }, entry);
      throw new SettingsWriteError(`The original save could not be confirmed: ${message(error)}`, true);
    }
    const outcome = object(response) ? response.outcome : undefined;
    if (outcome === 'blocked' && object(response) && object(response.operation)) {
      const raw = response.operation;
      const blocker = typeof raw.operationId === 'string' && typeof raw.hostId === 'string' ? status(raw, raw.operationId, raw.hostId, raw.method as SettingsWriteMethod | undefined) : null;
      if (blocker && blocker.operationId !== operationId) {
        await this.saveObservation(operationId, { phase: 'blocked', blocker, error: 'Another configuration save is still unresolved.' }, entry);
        throw new SettingsWriteError('Another configuration save is still unresolved. Check the blocking operation.', true);
      }
    }
    if (outcome === 'not-started' && object(response) && response.operation === undefined
      && object(response.error) && response.error.uncertain === false && typeof response.error.message === 'string') {
      const detail = response.error.message;
      await this.saveObservation(operationId, { phase: 'not-started', error: detail }, entry);
      throw new SettingsWriteError(detail, false);
    }
    const operation = object(response) ? status(response.operation, operationId, hostId, method) : null;
    if (operation) {
      const detail = object(response) && object(response.error) && typeof response.error.message === 'string' ? response.error.message : undefined;
      const result = object(response) && outcome === 'success' ? response.result : undefined;
      const compatibleOutcome = outcome === 'existing' || outcome === 'success' && (operation.state === 'succeeded' || !!operation.storageError)
        || (outcome === 'error' || outcome === 'unknown' || outcome === 'not-started') && operation.state !== 'succeeded';
      const validResult = outcome !== 'success' || operation.state !== 'succeeded' || object(result)
        && (method === 'config/batchWrite' ? result.status === operation.terminal?.kind
          : operation.terminal?.kind === 'effectiveEnabled' && result.effectiveEnabled === operation.terminal.value);
      const phase = completed(operation) && compatibleOutcome && validResult ? 'finished' : 'unknown';
      await this.saveObservation(operationId, { phase, operation, ...(result !== undefined ? { result } : {}), ...(detail ? { error: detail } : {}) }, entry);
      if (operation.storageError) throw new SettingsWriteError('The host observed a result but could not save its receipt. Retry saving the host receipt.', true);
      if (phase === 'finished' && operation.state === 'succeeded') {
        const effectiveResult = result ?? terminalResult(operation);
        if (effectiveResult !== undefined) return { operationId, result: effectiveResult };
      }
      if (phase === 'finished' && operation.state === 'failed') throw new SettingsWriteError(detail ?? 'The original save was rejected or not sent.', false);
    } else await this.saveObservation(operationId, { phase: 'unknown', error: 'The host did not return the original operation identity.' }, entry);
    throw new SettingsWriteError('The original save has an unknown result. Check the original operation before saving again.', true);
  }
  async check(id: string, retryPersistence = false): Promise<void> {
    const list = records(await this.storage.read()), entry = list.find(item => item.operationId === id);
    if (!entry) throw new Error('The original local configuration record is missing.');
    const blocker = entry.phase === 'blocked' ? entry.blocker : undefined;
    const targetId = blocker?.operationId ?? id, targetHost = blocker?.hostId ?? entry.hostId;
    const response = await this.client.host<unknown>('configuration-write', { hostId: targetHost,
      action: retryPersistence ? 'retry-persistence' : 'status', operationId: targetId });
    const operation = object(response) ? status(response.operation, targetId, targetHost, blocker?.method ?? entry.method) : null;
    if (!operation) {
      await this.saveObservation(id, { error: 'The host has no confirmed original operation. Its result remains unknown.' }, entry); return;
    }
    if (blocker) {
      await this.saveObservation(id, completed(operation) ? { phase: 'not-started', blocker: operation, error: 'The blocked save was not sent. Review the original edit before retrying.' }
        : { phase: 'blocked', blocker: operation, error: 'Another configuration save is still unresolved.' }, entry);
      return;
    }
    const phase = completed(operation) ? 'finished' : 'unknown';
    const error = object(response) && object(response.error) && typeof response.error.message === 'string' ? response.error.message : undefined;
    const pending = this.localPending.get(id);
    await this.saveObservation(id, { ...pending?.patch, phase, operation, error }, pending?.record ?? entry);
  }
  async finish(id: string, discardDrafts = false): Promise<void> {
    await this.storage.update(value => {
      const list = records(value), item = list.find(record => record.operationId === id);
      if (!item || active(item) || item.operation?.storageError || this.draftPending || this.localPending.has(id)
        || [...this.localDraftPending.values()].some(pending => pending.record?.operationId === id)) throw new Error('The original operation is not ready to close.');
      if (item.workingDrafts?.length && !discardDrafts) throw new Error('Newer edits still have a saved copy. Review them before closing this operation.');
      if (!discardDrafts && list.some(other => other.operationId !== id && other.hostId === item.hostId
        && other.origin.section === item.origin.section && JSON.stringify(other.origin.scope ?? []) === JSON.stringify(item.origin.scope ?? []))) return list;
      return list.filter(record => record.operationId !== id);
    });
    await this.refresh();
  }
  async finishSuccessfulGroup(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const unique = new Set(ids);
    await this.storage.update(value => {
      const list = records(value), group = list.filter(item => unique.has(item.operationId));
      if (this.draftPending || group.length !== unique.size || group.some(item => item.phase !== 'finished' || item.operation?.state !== 'succeeded'
        || item.operation.storageError || item.workingDrafts?.length || this.localPending.has(item.operationId)
        || [...this.localDraftPending.values()].some(pending => pending.record?.operationId === item.operationId))) {
        throw new Error('The original configuration receipts or newer edits still need review.');
      }
      if (group.some(item => list.some(other => !unique.has(other.operationId) && other.hostId === item.hostId
        && other.origin.section === item.origin.section && JSON.stringify(other.origin.scope ?? []) === JSON.stringify(item.origin.scope ?? [])))) return list;
      return list.filter(item => !unique.has(item.operationId));
    });
    await this.refresh();
  }
}

export function latestSettingsDraft(record: SettingsWriteRecord): unknown {
  const copies = record.workingDrafts;
  if (!Array.isArray(copies) || !copies.length) return record.origin.draft;
  return copies.reduce((a, b) => a.revision > b.revision ? a : b).draft;
}

const instances = new WeakMap<WorkbenchClient, SettingsConfigOperations>();
export function settingsConfigOperations(client: WorkbenchClient): SettingsConfigOperations {
  let instance = instances.get(client);
  if (!instance) { instance = new SettingsConfigOperations(client); instances.set(client, instance); }
  return instance;
}
