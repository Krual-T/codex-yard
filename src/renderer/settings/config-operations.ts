import type { WorkbenchClient } from '../workbench-contract.ts';
import { readBrowserAtom, subscribeBrowserAtoms, updateBrowserAtom } from '../storage/ui-atoms.ts';
import type { ConfigReadSource, ConfigWriteMethod, ConfigWriteErrorCategory, ConfigWriteTerminal, ConfigWriteReceipt, ConfigWriteStatus } from '../../../lib/config-write-protocol.ts';
import { configReadSource } from './config-source.ts';

export type SettingsWriteMethod = ConfigWriteMethod;
export type SettingsWriteSection = 'models' | 'agent' | 'worktrees' | 'hooks-settings' | 'skills-settings' | 'plugins-settings';
export interface SettingsWriteOrigin { section: SettingsWriteSection; scope?: readonly string[]; draft: unknown; source?: ConfigReadSource; editorId?: string; revision?: number }
export type WriteErrorCategory = ConfigWriteErrorCategory;
export type WriteTerminal = ConfigWriteTerminal;
export type WriteReceipt = ConfigWriteReceipt;
export type WriteStatus = ConfigWriteStatus;
export interface SettingsWriteRecord {
  operationId: string; hostId: string; method: SettingsWriteMethod; params: Record<string, unknown>;
  origin: SettingsWriteOrigin; phase: 'pending' | 'unknown' | 'finished' | 'not-started' | 'blocked';
  operation?: WriteStatus; blocker?: WriteStatus; result?: unknown; error?: string;
  recoveryReceipt?: WriteReceipt; blockerReceipt?: WriteReceipt;
  notSentEvidence?: { kind: 'host-observed' | 'client-before-send'; operationId: string; hostId: string; method: SettingsWriteMethod; terminal: WriteTerminal };
  hostMissing?: true;
  workingDrafts?: { editorId: string; revision: number; draft: unknown }[];
}
export interface SettingsDraftRecord {
  hostId: string; section: SettingsWriteSection; scope?: readonly string[];
  editorId: string; revision: number; draft: unknown;
}
interface ClosedNotSent { operationId: string; hostId: string; method: SettingsWriteMethod }
interface SettingsWriteData { version: 2; nextRevision: number; operations: SettingsWriteRecord[]; drafts: SettingsDraftRecord[]; closedNotSent: ClosedNotSent[] }
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
const categories = new Set(['configVersionConflict', 'configValidationError', 'configLayerReadonly']);
const sections = new Set(['models', 'agent', 'worktrees', 'hooks-settings', 'skills-settings', 'plugins-settings']);
const phases = new Set(['pending', 'unknown', 'finished', 'not-started', 'blocked']);

export function createSettingsWriteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function records(value: unknown): SettingsWriteRecord[] {
  if (value === undefined) return [];
  if (object(value) && value.version === 2) value = value.operations;
  if (!Array.isArray(value)) throw new Error('Configuration recovery records cannot be read. Writes are blocked.');
  const ids = new Set<string>();
  for (const item of value) {
    if (!object(item) || typeof item.operationId !== 'string' || !item.operationId || ids.has(item.operationId)
      || typeof item.hostId !== 'string' || !item.hostId || !methods.has(String(item.method)) || !object(item.params)
      || !object(item.origin) || !sections.has(String(item.origin.section)) || !Object.hasOwn(item.origin, 'draft')
      || item.origin.source !== undefined && !configReadSource(item.origin.source, item.hostId as string)
      || item.origin.editorId !== undefined && (typeof item.origin.editorId !== 'string' || !item.origin.editorId)
      || item.origin.revision !== undefined && (!Number.isSafeInteger(item.origin.revision) || (item.origin.revision as number) < 1)
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
    if (item.recoveryReceipt !== undefined && !receipt(item.recoveryReceipt, item.operationId, item.hostId, item.method as SettingsWriteMethod)
      || item.blockerReceipt !== undefined && (!object(item.blocker) || typeof item.blocker.operationId !== 'string'
        || typeof item.blocker.hostId !== 'string' || !methods.has(String(item.blocker.method))
        || !receipt(item.blockerReceipt, item.blocker.operationId, item.blocker.hostId, item.blocker.method as SettingsWriteMethod))) {
      throw new Error('A saved configuration recovery receipt cannot be verified. Writes are blocked.');
    }
    const ownReceipt = item.recoveryReceipt as WriteReceipt | undefined;
    if (item.notSentEvidence !== undefined && (!object(item.notSentEvidence) || !['host-observed', 'client-before-send'].includes(String(item.notSentEvidence.kind))
      || item.notSentEvidence.operationId !== item.operationId || item.notSentEvidence.hostId !== item.hostId
      || item.notSentEvidence.method !== item.method || !terminal(item.notSentEvidence.terminal, item.method as SettingsWriteMethod, 'failed')
      || (item.notSentEvidence.terminal as WriteTerminal).kind !== 'not-sent')) {
      throw new Error('The saved not-sent evidence cannot be verified. Writes are blocked.');
    }
    if (item.hostMissing !== undefined && item.hostMissing !== true) throw new Error('Configuration recovery records cannot be read. Writes are blocked.');
    if (ownReceipt && operation && completed(operation) && operation.terminal && !sameTerminal(ownReceipt.terminal, operation.terminal)) {
      throw new Error('The saved configuration terminal does not match its receipt. Writes are blocked.');
    }
    if (item.blockerReceipt && object(item.blocker) && typeof item.blocker.operationId === 'string'
      && typeof item.blocker.hostId === 'string') {
      const blocker = status(item.blocker, item.blocker.operationId, item.blocker.hostId, item.blocker.method as SettingsWriteMethod);
      if (blocker && completed(blocker) && blocker.terminal && !sameTerminal((item.blockerReceipt as WriteReceipt).terminal, blocker.terminal)) {
        throw new Error('The saved blocking terminal does not match its receipt. Writes are blocked.');
      }
    }
    ids.add(item.operationId);
  }
  return value as SettingsWriteRecord[];
}
function data(value: unknown): SettingsWriteData {
  const operations = records(value);
  if (value === undefined) return { version: 2, nextRevision: 1, operations, drafts: [], closedNotSent: [] };
  if (Array.isArray(value)) {
    const drafts: SettingsDraftRecord[] = [];
    for (const item of operations) {
      const scope = item.origin.scope;
      drafts.push({ hostId: item.hostId, section: item.origin.section, scope,
        editorId: `legacy:${item.operationId}`, revision: 1, draft: item.origin.draft });
      for (const copy of item.workingDrafts ?? []) {
        drafts.push({ hostId: item.hostId, section: item.origin.section, scope,
          editorId: `legacy:${item.operationId}:${copy.editorId}`, revision: copy.revision, draft: copy.draft });
      }
    }
    return { version: 2, nextRevision: Math.max(0, ...drafts.map(draft => draft.revision)) + 1, operations, drafts, closedNotSent: [] };
  }
  if (!object(value) || value.version !== 2 || !Array.isArray(value.drafts) || !Number.isSafeInteger(value.nextRevision)
    || (value.nextRevision as number) < 1) throw new Error('Configuration drafts cannot be read. Writes are blocked.');
  const keys = new Set<string>();
  for (const draft of value.drafts) {
    if (!object(draft) || typeof draft.hostId !== 'string' || !draft.hostId || !sections.has(String(draft.section))
      || draft.scope !== undefined && (!Array.isArray(draft.scope) || draft.scope.some((v: unknown) => typeof v !== 'string'))
      || typeof draft.editorId !== 'string' || !draft.editorId || !Number.isSafeInteger(draft.revision) || (draft.revision as number) < 1
      || !Object.hasOwn(draft, 'draft')) throw new Error('Configuration drafts cannot be read. Writes are blocked.');
    const key = JSON.stringify([draft.hostId, draft.section, draft.scope ?? [], draft.editorId]);
    if (keys.has(key)) throw new Error('Configuration drafts contain duplicate editors. Writes are blocked.');
    keys.add(key);
  }
  if ((value.nextRevision as number) <= Math.max(0, ...(value.drafts as SettingsDraftRecord[]).map(draft => draft.revision))) {
    throw new Error('Configuration draft revisions cannot be read. Writes are blocked.');
  }
  const closed = value.closedNotSent === undefined ? [] : value.closedNotSent;
  if (!Array.isArray(closed)) throw new Error('Closed configuration results cannot be read. Writes are blocked.');
  const closedIds = new Set<string>();
  for (const item of closed) {
    if (!object(item) || typeof item.operationId !== 'string' || !item.operationId || closedIds.has(item.operationId)
      || typeof item.hostId !== 'string' || !item.hostId || !methods.has(String(item.method))
      || operations.some(operation => operation.operationId === item.operationId)) {
      throw new Error('Closed configuration results cannot be verified. Writes are blocked.');
    }
    closedIds.add(item.operationId);
  }
  return { version: 2, nextRevision: value.nextRevision as number, operations, drafts: value.drafts as SettingsDraftRecord[], closedNotSent: closed as ClosedNotSent[] };
}
const draftKey = (draft: Pick<SettingsDraftRecord, 'hostId' | 'section' | 'scope' | 'editorId'>) =>
  JSON.stringify([draft.hostId, draft.section, draft.scope ?? [], draft.editorId]);
function terminal(value: unknown, method: SettingsWriteMethod, state: string): value is WriteTerminal {
  if (!object(value)) return false;
  if (state === 'succeeded') return method === 'config/batchWrite' && (value.kind === 'ok' || value.kind === 'okOverridden')
    || method === 'skills/config/write' && value.kind === 'effectiveEnabled' && typeof value.value === 'boolean';
  return state === 'failed' && (value.kind === 'rejected' && (value.code === undefined || Number.isSafeInteger(value.code))
    && (value.category === undefined || categories.has(String(value.category)))
    || value.kind === 'not-sent' && (value.code === undefined || value.code === 'OBSERVER_LIMIT'));
}
function terminalState(value: unknown): 'succeeded' | 'failed' {
  return object(value) && (value.kind === 'ok' || value.kind === 'okOverridden' || value.kind === 'effectiveEnabled') ? 'succeeded' : 'failed';
}
function sameTerminal(left: WriteTerminal, right: WriteTerminal): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'effectiveEnabled' && right.kind === 'effectiveEnabled') return left.value === right.value;
  if (left.kind === 'rejected' && right.kind === 'rejected') return left.code === right.code && left.category === right.category;
  if (left.kind === 'not-sent' && right.kind === 'not-sent') return left.code === right.code;
  return true;
}
function receipt(value: unknown, id: string, hostId: string, method: SettingsWriteMethod): value is WriteReceipt {
  return object(value) && value.operationId === id && value.hostId === hostId && value.method === method
    && typeof value.signature === 'string' && value.signature.length > 0 && value.signature.length <= 4096
    && terminal(value.terminal, method, terminalState(value.terminal));
}
export function writeTerminalMessage(value: WriteTerminal | undefined): string | undefined {
  if (value?.kind !== 'rejected') return undefined;
  if (value.category === 'configVersionConflict') return 'The configuration changed. Reload and review your edits before saving again.';
  if (value.category === 'configValidationError') return 'The configuration was rejected as invalid. Review your edits before saving again.';
  if (value.category === 'configLayerReadonly') return 'The selected configuration layer is read-only. Choose a writable target before saving again.';
  return 'The configuration write was rejected. Review your edits before saving again.';
}
function status(value: unknown, id: string, hostId: string, method?: SettingsWriteMethod): WriteStatus | null {
  if (!object(value) || value.operationId !== id || value.hostId !== hostId
    || value.method !== undefined && !methods.has(String(value.method))
    || method && value.method !== undefined && value.method !== method
    || !['preparing', 'pending', 'unknown', 'succeeded', 'failed'].includes(String(value.state))
    || value.storageError !== undefined && value.storageError !== true
    || value.interrupted !== undefined && (value.interrupted !== true || value.state !== 'preparing')) return null;
  if ((value.state === 'succeeded' || value.state === 'failed')
    && (!method || value.method !== method || !terminal(value.terminal, method, value.state))) return null;
  if (value.terminal !== undefined && value.state !== 'succeeded' && value.state !== 'failed') return null;
  if (value.observedTerminal !== undefined && (value.storageError !== true || !method || value.method !== method
    || !terminal(value.observedTerminal, method, terminalState(value.observedTerminal)))) return null;
  if (value.recoveryReceipt !== undefined && (!method || value.storageError !== true
    || !receipt(value.recoveryReceipt, id, hostId, method) || !value.observedTerminal
    || !sameTerminal(value.recoveryReceipt.terminal, value.observedTerminal as WriteTerminal))) return null;
  return value as unknown as WriteStatus;
}
function active(record: SettingsWriteRecord) { return record.phase === 'pending' || record.phase === 'unknown' || record.phase === 'blocked'; }
export function pluginEditNeedsRecovery(record: SettingsWriteRecord): boolean {
  return record.origin.section === 'plugins-settings' && (!record.origin.editorId || !record.origin.revision)
    && (record.phase === 'not-started' || record.operation?.state === 'failed');
}
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
  readonly operationId?: string;
  readonly blocker?: WriteStatus;
  constructor(message: string, uncertain: boolean, operationId?: string, blocker?: WriteStatus) {
    super(message); this.name = 'SettingsWriteError'; this.uncertain = uncertain; this.operationId = operationId; this.blocker = blocker;
  }
}
export interface SettingsWriteSnapshot { records: SettingsWriteRecord[]; drafts: SettingsDraftRecord[]; loading: boolean; error: string | null; localRetry: string[]; draftRetry: string[]; draftPending: number; inFlight: string[] }
interface PendingDraft { hostId: string; section: SettingsWriteSection; scope?: readonly string[]; draft: unknown; sequence: number }
interface PendingReceipt { patch: Partial<SettingsWriteRecord>; record?: SettingsWriteRecord }
class ObservationMismatch extends Error {}

/** Settings-only recovery records in the existing browser atom transaction. */
export class SettingsConfigOperations {
  private client: WorkbenchClient;
  private storage: SettingsWriteStorage;
  private newId: () => string;
  private snapshot: SettingsWriteSnapshot = { records: [], drafts: [], loading: true, error: null, localRetry: [], draftRetry: [], draftPending: 0, inFlight: [] };
  private listeners = new Set<() => void>();
  private localPending = new Map<string, PendingReceipt>();
  private observationWrites = new Map<string, Promise<void>>();
  private localDraftPending = new Map<string, PendingDraft>();
  private draftSequences = new Map<string, number>();
  private draftQueues = new Map<string, Promise<unknown>>();
  private committedDrafts = new Map<string, { key: string; revision: number }>();
  private inFlight = new Set<string>();
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
    this.snapshot = { ...this.snapshot, ...patch, localRetry: [...this.localPending.keys()], draftRetry: [...this.localDraftPending.keys()], draftPending: this.draftPending, inFlight: [...this.inFlight] };
    for (const listener of this.listeners) listener();
  }
  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    try {
      const value = data(await this.storage.read());
      if (sequence === this.sequence) this.publish({ records: value.operations, drafts: value.drafts, loading: false, error: null });
    } catch (error) { if (sequence === this.sequence) this.publish({ loading: false, error: message(error) }); }
  }
  async find(hostId: string, section: SettingsWriteSection, scope?: readonly string[]): Promise<SettingsWriteRecord | null> {
    const list = data(await this.storage.read()).operations;
    return [...list].reverse().find(item => item.hostId === hostId && item.origin.section === section
      && JSON.stringify(item.origin.scope ?? []) === JSON.stringify(scope ?? [])) ?? null;
  }
  private queueDraft<T>(editorId: string, action: () => Promise<T>): Promise<T> {
    this.draftPending++; this.publish({});
    const previous = this.draftQueues.get(editorId);
    const current = (previous ? previous.catch(() => {}) : Promise.resolve()).then(action);
    this.draftQueues.set(editorId, current);
    return current.finally(() => {
      if (this.draftQueues.get(editorId) === current) this.draftQueues.delete(editorId);
      this.draftPending--; this.publish({});
    });
  }
  private nextDraftSequence(editorId: string): number {
    const sequence = (this.draftSequences.get(editorId) ?? 0) + 1;
    this.draftSequences.set(editorId, sequence); return sequence;
  }
  private persistDraft(editorId: string, pending: PendingDraft): Promise<number | null> {
    return this.queueDraft(editorId, async () => {
      if (this.draftSequences.get(editorId) !== pending.sequence) return null;
      const key = draftKey({ hostId: pending.hostId, section: pending.section, scope: pending.scope, editorId });
      let revision: number | null = null;
      try {
        await this.storage.update(value => {
          const current = data(value);
          if (this.draftSequences.get(editorId) !== pending.sequence) return current;
          if (!Number.isSafeInteger(current.nextRevision + 1)) throw new Error('Configuration draft revisions are exhausted.');
          revision = current.nextRevision++;
          current.drafts = [...current.drafts.filter(item => draftKey(item) !== key),
            { hostId: pending.hostId, section: pending.section, scope: pending.scope, editorId, revision, draft: pending.draft }];
          return current;
        });
        if (revision !== null) this.committedDrafts.set(editorId, { key, revision });
        if (this.draftSequences.get(editorId) === pending.sequence) this.localDraftPending.delete(editorId);
        await this.refresh();
        return revision;
      } catch (error) {
        if (this.draftSequences.get(editorId) === pending.sequence) {
          this.localDraftPending.set(editorId, pending);
          this.publish({ error: `The browser could not save a newer configuration edit: ${message(error)}` });
        }
        throw error;
      }
    });
  }
  saveDraft(hostId: string, section: SettingsWriteSection, scope: readonly string[] | undefined,
    editorId: string, draft: unknown): Promise<number | null> {
    const pending = { hostId, section, scope: scope && [...scope], draft: structuredClone(draft), sequence: this.nextDraftSequence(editorId) };
    this.localDraftPending.delete(editorId);
    return this.persistDraft(editorId, pending);
  }
  async editRecoveredPluginDraft(original: SettingsDraftRecord, enabled: boolean): Promise<void> {
    const expected = structuredClone(original);
    if (typeof enabled !== 'boolean') throw new Error('The plugin target is invalid.');
    await this.queueDraft(expected.editorId, async () => {
      await this.storage.update(value => {
        const current = data(value), key = draftKey(expected), index = current.drafts.findIndex(item => draftKey(item) === key);
        const item = current.drafts[index];
        if (!item || JSON.stringify(item) !== JSON.stringify(expected) || item.section !== 'plugins-settings'
          || !item.editorId.startsWith('recovered:') || !object(item.draft) || typeof item.draft.enabled !== 'boolean') {
          throw new Error('The saved plugin edit changed. Review its original copy before editing.');
        }
        if (item.draft.enabled === enabled) return current;
        if (!Number.isSafeInteger(current.nextRevision + 1)) throw new Error('Configuration draft revisions are exhausted.');
        current.drafts[index] = { ...item, revision: current.nextRevision++, draft: { ...item.draft, enabled } };
        return current;
      });
      await this.refresh();
    });
  }
  async retryDraft(editorId: string): Promise<void> {
    const pending = this.localDraftPending.get(editorId);
    if (!pending) throw new Error('The newer browser edit is no longer available.');
    await this.persistDraft(editorId, pending);
  }
  async discardDraft(draft: SettingsDraftRecord): Promise<void> {
    await this.storage.update(value => {
      const current = data(value), key = draftKey(draft);
      current.drafts = current.drafts.filter(item => draftKey(item) !== key || item.revision !== draft.revision);
      return current;
    });
    await this.refresh();
  }
  clearEditorDraft(hostId: string, section: SettingsWriteSection, scope: readonly string[] | undefined, editorId: string): Promise<null> {
    const sequence = this.nextDraftSequence(editorId), pending = this.localDraftPending.get(editorId);
    return this.queueDraft(editorId, async () => {
      if (this.draftSequences.get(editorId) !== sequence) throw new Error('The edit changed while it was being discarded.');
      const key = draftKey({ hostId, section, scope, editorId });
      try {
        await this.storage.update(value => {
          const current = data(value);
          if (this.draftSequences.get(editorId) !== sequence) throw new Error('The edit changed while it was being discarded.');
          const draft = current.drafts.find(item => draftKey(item) === key), committed = this.committedDrafts.get(editorId);
          if (draft && (!committed || committed.key !== key || committed.revision !== draft.revision)) {
            throw new Error('The saved edit changed. Review it before discarding.');
          }
          if (draft) current.drafts = current.drafts.filter(item => draftKey(item) !== key || item.revision !== draft.revision);
          return current;
        });
        if (this.draftSequences.get(editorId) === sequence) {
          this.localDraftPending.delete(editorId); this.committedDrafts.delete(editorId);
        }
        await this.refresh(); return null;
      } catch (error) {
        if (pending && this.draftSequences.get(editorId) === sequence) this.localDraftPending.set(editorId, { ...pending, sequence });
        throw error;
      }
    });
  }
  private async change(id: string, patch: Partial<SettingsWriteRecord>, fallback?: SettingsWriteRecord) {
    await this.storage.update(value => {
      const current = data(value), list = current.operations, index = list.findIndex(item => item.operationId === id);
      if (index < 0) throw new ObservationMismatch('The original browser record was already closed. Review the current operations.');
      const original = list[index];
      if (!original || original.operationId !== id) throw new Error('The original local configuration record is missing.');
      if (fallback && (original.hostId !== fallback.hostId || original.method !== fallback.method
        || JSON.stringify(original.params) !== JSON.stringify(fallback.params) || JSON.stringify(original.origin) !== JSON.stringify(fallback.origin))) {
        throw new ObservationMismatch('The saved operation no longer matches the original submission. Review the recovery record.');
      }
      const stale = (original.phase === 'finished' || original.phase === 'not-started')
        && (patch.phase === 'unknown' || patch.phase === 'pending' || patch.phase === 'blocked');
      const confirmedTerminal = original.operation && completed(original.operation) ? original.operation.terminal : undefined;
      const incomingTerminal = patch.operation?.terminal ?? patch.operation?.observedTerminal;
      if (original.notSentEvidence && incomingTerminal && !sameTerminal(original.notSentEvidence.terminal, incomingTerminal)) {
        throw new ObservationMismatch('The host returned a result that conflicts with the original not-sent evidence.');
      }
      if (confirmedTerminal && incomingTerminal && !sameTerminal(confirmedTerminal, incomingTerminal)) {
        throw new ObservationMismatch('The host returned conflicting terminal results for the original operation.');
      }
      const safePatch = stale ? patch.result !== undefined && original.result === undefined && confirmedTerminal && incomingTerminal
        && sameTerminal(confirmedTerminal, incomingTerminal) ? { result: patch.result } : {} : patch;
      const own = safePatch.operation?.recoveryReceipt, blocking = safePatch.blocker?.recoveryReceipt;
      const mergeReceipt = (old: WriteReceipt | undefined, next: WriteReceipt | undefined) => {
        if (old && next && (old.operationId !== next.operationId || old.hostId !== next.hostId || old.method !== next.method
          || old.signature !== next.signature || !sameTerminal(old.terminal, next.terminal))) {
          throw new ObservationMismatch('The host returned conflicting original receipts. Check the original operation.');
        }
        return old ?? next;
      };
      const ownReceipt = mergeReceipt(original.recoveryReceipt, own), blockerReceipt = mergeReceipt(original.blockerReceipt, blocking);
      for (const [saved, observed] of [[ownReceipt, safePatch.operation], [blockerReceipt, safePatch.blocker]] as const) {
        if (saved && observed && completed(observed) && observed.terminal && !sameTerminal(saved.terminal, observed.terminal)) {
          throw new ObservationMismatch('The host terminal does not match the original recovery receipt.');
        }
      }
      if (original.operation && completed(original.operation) && safePatch.operation && completed(safePatch.operation)
        && original.operation?.terminal && safePatch.operation.terminal && !sameTerminal(original.operation.terminal, safePatch.operation.terminal)) {
        throw new ObservationMismatch('The host returned conflicting terminal results for the original operation.');
      }
      const next = { ...original, ...safePatch, operationId: original.operationId, hostId: original.hostId,
        method: original.method, params: original.params, origin: original.origin,
        ...(ownReceipt ? { recoveryReceipt: ownReceipt } : {}), ...(blockerReceipt ? { blockerReceipt } : {}) };
      list[index] = next;
      return current;
    });
    this.localPending.delete(id); await this.refresh();
  }
  private async saveObservation(id: string, patch: Partial<SettingsWriteRecord>, fallback?: SettingsWriteRecord, retry = false) {
    const previous = this.observationWrites.get(id);
    const write = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      if (this.localPending.has(id) && !retry) {
        throw new SettingsWriteError('Retry saving the browser receipt before checking the host operation.', true, id);
      }
      try { await this.change(id, patch, fallback); }
      catch (error) {
        if (error instanceof ObservationMismatch) {
          this.publish({ error: error.message });
          throw new SettingsWriteError(error.message, true, id);
        }
        this.localPending.set(id, { patch, record: fallback ?? this.localPending.get(id)?.record });
        this.publish({ error: `The browser could not save the original receipt: ${message(error)}. Retry saving the receipt.` });
        throw new SettingsWriteError('The browser could not save the original receipt. Your edit is preserved.', true, id);
      }
    });
    this.observationWrites.set(id, write);
    try { await write; } finally { if (this.observationWrites.get(id) === write) this.observationWrites.delete(id); }
  }
  async retryLocal(id: string): Promise<void> {
    const pending = this.localPending.get(id);
    if (!pending) throw new Error('The original browser receipt is no longer available. Check the host operation.');
    await this.saveObservation(id, pending.patch, pending.record, true);
  }
  async dismissClosedLocal(id: string): Promise<void> {
    const pending = this.localPending.get(id);
    if (!pending || this.observationWrites.has(id)) throw new Error('The original browser receipt is still being saved.');
    await this.storage.update(value => {
      const current = data(value);
      if (current.operations.some(item => item.operationId === id)) {
        throw new Error('The original operation is still present. Retry saving its browser receipt.');
      }
      return current;
    });
    if (this.localPending.get(id) === pending) this.localPending.delete(id);
    await this.refresh();
  }
  async submit(hostId: string, method: SettingsWriteMethod, params: Record<string, unknown>, origin: SettingsWriteOrigin,
    canDispatch: () => boolean = () => true, onPrepared: (id: string) => void = () => {}): Promise<{ operationId: string; result: unknown }> {
    const operationId = this.newId();
    if (!operationId) throw new SettingsWriteError('Cannot create a configuration operation ID.', false);
    onPrepared(operationId);
    this.inFlight.add(operationId); this.publish({});
    try { return await this.submitPrepared(operationId, hostId, method, params, origin, canDispatch); }
    finally { this.inFlight.delete(operationId); this.publish({}); }
  }
  private async submitPrepared(operationId: string, hostId: string, method: SettingsWriteMethod, params: Record<string, unknown>, origin: SettingsWriteOrigin,
    canDispatch: () => boolean): Promise<{ operationId: string; result: unknown }> {
    if (!configReadSource(origin.source, hostId)) throw new SettingsWriteError('The original configuration source is unavailable. Reload and review your edit.', false, operationId);
    const entry: SettingsWriteRecord = structuredClone({ operationId, hostId, method, params, origin, phase: 'pending' as const });
    try {
      await this.storage.update(value => {
        const current = data(value), list = current.operations;
        if (list.some(active)) throw new Error('An earlier configuration save must be checked before another save.');
        if (list.some(item => item.operationId === operationId) || current.closedNotSent.some(item => item.operationId === operationId)) throw new Error('The configuration operation ID is already in use.');
        if (entry.origin.editorId) {
          const key = draftKey({ hostId, section: entry.origin.section, scope: entry.origin.scope, editorId: entry.origin.editorId });
          const draft = current.drafts.find(item => draftKey(item) === key);
          if (!draft || !entry.origin.revision || draft.revision !== entry.origin.revision) {
            throw new Error('The original editor draft revision changed. Review and save the edit again.');
          }
        }
        current.operations = [...list, entry]; return current;
      });
      await this.refresh();
    } catch (error) { throw new SettingsWriteError(`Could not save the original operation in the browser: ${message(error)}`, false, operationId); }
    if (!canDispatch()) {
      await this.saveObservation(operationId, { phase: 'not-started', error: 'The save was interrupted before it was sent.' }, entry);
      throw new SettingsWriteError('The save was interrupted before it was sent.', false, operationId);
    }
    let response: unknown;
    try { response = await this.client.host('configuration-write', { hostId, action: 'submit', operationId, method, params: entry.params, source: entry.origin.source }, {
      assertBeforeSend: () => {
        if (!canDispatch()) throw Object.assign(new Error('The save was interrupted before it was sent.'), { uncertain: false, sendPhase: 'before-send' });
      },
    }); }
    catch (error) {
      if (error instanceof Error && 'uncertain' in error && error.uncertain === false && 'sendPhase' in error && error.sendPhase === 'before-send') {
        await this.saveObservation(operationId, { phase: 'not-started', error: message(error), notSentEvidence: {
          kind: 'client-before-send', operationId, hostId, method, terminal: { kind: 'not-sent' },
        } }, entry);
        throw new SettingsWriteError(`The original save was not sent: ${message(error)}`, false, operationId);
      }
      await this.saveObservation(operationId, { phase: 'unknown', error: `The original save could not be confirmed: ${message(error)}` }, entry);
      throw new SettingsWriteError(`The original save could not be confirmed: ${message(error)}`, true, operationId);
    }
    const outcome = object(response) ? response.outcome : undefined;
    if (outcome === 'blocked' && object(response) && object(response.operation)) {
      const raw = response.operation;
      const blocker = typeof raw.operationId === 'string' && typeof raw.hostId === 'string' ? status(raw, raw.operationId, raw.hostId, raw.method as SettingsWriteMethod | undefined) : null;
      if (blocker && blocker.operationId !== operationId) {
        await this.saveObservation(operationId, { phase: 'blocked', blocker, error: 'Another configuration save is still unresolved.' }, entry);
        throw new SettingsWriteError('Another configuration save is still unresolved. Check the blocking operation.', true, operationId, blocker);
      }
    }
    if (outcome === 'not-started' && object(response) && response.operation === undefined
      && object(response.error) && response.error.uncertain === false && typeof response.error.message === 'string') {
      const detail = response.error.message;
      await this.saveObservation(operationId, { phase: 'not-started', error: detail }, entry);
      throw new SettingsWriteError(detail, false, operationId);
    }
    const operation = object(response) ? status(response.operation, operationId, hostId, method) : null;
    if (operation) {
      const detail = writeTerminalMessage(operation.terminal ?? operation.observedTerminal)
        ?? (object(response) && object(response.error) && typeof response.error.message === 'string' ? response.error.message : undefined);
      const result = object(response) && outcome === 'success' ? response.result : undefined;
      const compatibleOutcome = outcome === 'existing' || outcome === 'success' && (operation.state === 'succeeded' || !!operation.storageError)
        || (outcome === 'error' || outcome === 'unknown' || outcome === 'not-started') && operation.state !== 'succeeded';
      const resultTerminal = operation.terminal ?? operation.observedTerminal;
      const validResult = outcome !== 'success' || object(result)
        && (method === 'config/batchWrite' ? result.status === resultTerminal?.kind
          : resultTerminal?.kind === 'effectiveEnabled' && result.effectiveEnabled === resultTerminal.value);
      const phase = completed(operation) && compatibleOutcome && validResult ? 'finished' : 'unknown';
      const evidence = outcome === 'not-started' && object(response) && object(response.error) && response.error.uncertain === false
        && operation.storageError && operation.observedTerminal?.kind === 'not-sent'
        ? { kind: 'host-observed' as const, operationId, hostId, method, terminal: operation.observedTerminal } : undefined;
      await this.saveObservation(operationId, { phase, operation, ...(evidence ? { notSentEvidence: evidence } : {}),
        ...(result !== undefined && validResult && compatibleOutcome ? { result } : {}), ...(detail ? { error: detail } : {}) }, entry);
      if (operation.storageError) throw new SettingsWriteError('The host observed a result but could not save its receipt. Retry saving the host receipt.', true, operationId);
      if (phase === 'finished' && operation.state === 'succeeded') {
        const effectiveResult = result ?? terminalResult(operation);
        if (effectiveResult !== undefined) return { operationId, result: effectiveResult };
      }
      if (phase === 'finished' && operation.state === 'failed') throw new SettingsWriteError(detail ?? 'The original save was rejected or not sent.', false, operationId);
    } else await this.saveObservation(operationId, { phase: 'unknown', error: 'The host did not return the original operation identity.' }, entry);
    throw new SettingsWriteError('The original save has an unknown result. Check the original operation before saving again.', true, operationId);
  }
  async originalNotSentClosed(hostId: string, operationId: string, method: SettingsWriteMethod): Promise<boolean> {
    const closed = data(await this.storage.read()).closedNotSent;
    return closed.some(item => item.operationId === operationId && item.hostId === hostId && item.method === method);
  }
  async originalFinished(hostId: string, operationId: string, method: SettingsWriteMethod, assertBeforeSend?: () => void): Promise<boolean> {
    if (await this.originalNotSentClosed(hostId, operationId, method)) return true;
    assertBeforeSend?.();
    const response = await this.client.host<unknown>('configuration-write', { hostId, action: 'status', operationId }, { assertBeforeSend });
    const operation = object(response) ? status(response.operation, operationId, hostId, method) : null;
    return !!operation && completed(operation);
  }
  async check(id: string, retryPersistence = false, assertBeforeSend?: () => void): Promise<void> {
    if (this.localPending.has(id)) throw new Error('Retry saving the browser receipt before checking the host operation.');
    const list = data(await this.storage.read()).operations, entry = list.find(item => item.operationId === id);
    if (!entry) throw new Error('The original local configuration record is missing.');
    const blocker = entry.phase === 'blocked' ? entry.blocker : undefined;
    const targetId = blocker?.operationId ?? id, targetHost = blocker?.hostId ?? entry.hostId;
    const savedReceipt = blocker ? entry.blockerReceipt : entry.recoveryReceipt;
    assertBeforeSend?.();
    const response = await this.client.host<unknown>('configuration-write', { hostId: targetHost,
      action: retryPersistence ? 'retry-persistence' : 'status', operationId: targetId,
      ...(retryPersistence && savedReceipt ? { receipt: savedReceipt } : {}) }, { assertBeforeSend });
    const operation = object(response) ? status(response.operation, targetId, targetHost, blocker?.method ?? entry.method) : null;
    if (!operation) {
      const missing = object(response) && response.operation === null;
      await this.saveObservation(id, { hostMissing: missing ? true : undefined, error: missing && entry.notSentEvidence && !blocker
        ? 'The host no longer has this operation. The original not-sent evidence remains saved in this browser.'
        : 'The host has no confirmed original operation. Its result remains unknown.' }, entry); return;
    }
    if (blocker) {
      await this.saveObservation(id, completed(operation) ? { phase: 'not-started', blocker: operation, error: 'The blocked save was not sent. Review the original edit before retrying.' }
        : { phase: 'blocked', blocker: operation, error: 'Another configuration save is still unresolved.' }, entry);
      return;
    }
    const phase = completed(operation) ? 'finished' : 'unknown';
    const error = writeTerminalMessage(operation.terminal ?? operation.observedTerminal)
      ?? (object(response) && object(response.error) && typeof response.error.message === 'string' ? response.error.message : undefined);
    await this.saveObservation(id, { phase, operation, error, hostMissing: undefined }, entry);
  }
  async confirmNotSent(id: string): Promise<void> {
    if (this.localPending.has(id) || this.observationWrites.has(id)) throw new Error('The original receipt is still being saved.');
    await this.storage.update(value => {
      const current = data(value), index = current.operations.findIndex(item => item.operationId === id), entry = current.operations[index];
      if (!entry || !entry.hostMissing || !entry.notSentEvidence || entry.phase !== 'unknown' || entry.blocker) {
        throw new Error('The original not-sent evidence is unavailable. Check the original operation first.');
      }
      current.operations[index] = { ...entry, phase: 'not-started', operation: undefined,
        error: 'The original save was not sent. Review the preserved edit before trying again.' };
      return current;
    });
    await this.refresh();
  }
  async restoreOriginalPluginEdit(original: SettingsWriteRecord): Promise<void> {
    const expected = structuredClone(original);
    await this.storage.update(value => {
      const current = data(value), item = current.operations.find(record => record.operationId === expected.operationId);
      if (!item || JSON.stringify(item) !== JSON.stringify(expected) || !pluginEditNeedsRecovery(item) || active(item)
        || item.operation?.storageError || this.draftPending || this.localPending.has(item.operationId) || this.observationWrites.has(item.operationId)
        || !object(item.origin.draft) || typeof item.origin.draft.pluginId !== 'string' || !item.origin.draft.pluginId
        || typeof item.origin.draft.enabled !== 'boolean') throw new Error('The original plugin edit changed or still needs confirmation.');
      const editorId = `recovered:${item.operationId}`, key = draftKey({ hostId: item.hostId, section: item.origin.section, scope: item.origin.scope, editorId });
      if (current.drafts.some(draft => draftKey(draft) === key)) throw new Error('This original edit already has a saved copy. Review that copy first.');
      if (!Number.isSafeInteger(current.nextRevision + 1)) throw new Error('Configuration draft revisions are exhausted.');
      current.drafts.push({ hostId: item.hostId, section: item.origin.section, scope: item.origin.scope,
        editorId, revision: current.nextRevision++, draft: { ...structuredClone(item.origin.draft), originalSource: item.origin.source ?? null } });
      if (item.phase === 'not-started' || item.operation?.terminal?.kind === 'not-sent') {
        current.closedNotSent.push({ operationId: item.operationId, hostId: item.hostId, method: item.method });
      }
      current.operations = current.operations.filter(record => record.operationId !== item.operationId);
      return current;
    });
    await this.refresh();
  }
  async finish(id: string, options: { consumeSubmittedDraft?: boolean; discardOriginalEdit?: boolean } = {}): Promise<void> {
    await this.storage.update(value => {
      const current = data(value), list = current.operations, item = list.find(record => record.operationId === id);
      if (!item || active(item) || item.operation?.storageError || this.draftPending || this.localPending.has(id) || this.observationWrites.has(id)
        ) throw new Error('The original operation is not ready to close.');
      if (pluginEditNeedsRecovery(item) && !options.discardOriginalEdit) {
        throw new Error('Restore the original plugin edit or explicitly discard it before closing this operation.');
      }
      if (options.consumeSubmittedDraft && item.operation?.state === 'succeeded' && item.origin.editorId && item.origin.revision) {
        const key = draftKey({ hostId: item.hostId, section: item.origin.section, scope: item.origin.scope, editorId: item.origin.editorId });
        current.drafts = current.drafts.filter(draft => draftKey(draft) !== key || draft.revision !== item.origin.revision);
      }
      if (item.phase === 'not-started' || item.operation?.terminal?.kind === 'not-sent') {
        current.closedNotSent.push({ operationId: item.operationId, hostId: item.hostId, method: item.method });
      }
      current.operations = list.filter(record => record.operationId !== id); return current;
    });
    await this.refresh();
  }
  async finishSuccessfulGroup(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const unique = new Set(ids);
    await this.storage.update(value => {
      const current = data(value), list = current.operations, group = list.filter(item => unique.has(item.operationId));
      if (this.draftPending || group.length !== unique.size || group.some(item => item.phase !== 'finished' || item.operation?.state !== 'succeeded'
        || item.operation.storageError || this.localPending.has(item.operationId) || this.observationWrites.has(item.operationId))) {
        throw new Error('The original configuration receipts or newer edits still need review.');
      }
      for (const item of group) if (item.origin.editorId && item.origin.revision) {
        const key = draftKey({ hostId: item.hostId, section: item.origin.section, scope: item.origin.scope, editorId: item.origin.editorId });
        current.drafts = current.drafts.filter(draft => draftKey(draft) !== key || draft.revision !== item.origin.revision);
      }
      current.operations = list.filter(item => !unique.has(item.operationId)); return current;
    });
    await this.refresh();
  }
}

const instances = new WeakMap<WorkbenchClient, SettingsConfigOperations>();
export function settingsConfigOperations(client: WorkbenchClient): SettingsConfigOperations {
  let instance = instances.get(client);
  if (!instance) { instance = new SettingsConfigOperations(client); instances.set(client, instance); }
  return instance;
}
